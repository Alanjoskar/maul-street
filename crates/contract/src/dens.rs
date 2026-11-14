//! Fighting the house fighters, and backing them.

use maul_core::battle::{self, Battle, Build, Fighter, Rng};
use maul_core::{data, npc, rules};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::views::MatchView;
use crate::{fail, mul_div, near_text, put, take, tokens, Contract, ContractExt, Match, Rival};

/// Keeps the den's choice of move apart from the fight's own rolls on the same seed.
const DEN_CHOICE_SALT: u64 = 0x006e_7063;

#[near]
impl Contract {
    /// Starts a fight against a den. `stake` is "0" for a free spar. Otherwise it is a
    /// multiple of 0.01 NEAR, no more than the den will take, and comes off the balance.
    pub fn start_den_fight(&mut self, den_id: u8, squad: [u64; 3], stake: U128) -> MatchView {
        let caller = env::predecessor_account_id();
        let stake = stake.0;
        let den = data::den(den_id).unwrap_or_else(|| fail("There is no such den."));
        if let Some(last) = self.player(&caller).den_match {
            require!(
                self.matches.get(&last).is_none_or(|fight| fight.over()),
                "Finish your den fight first, or forfeit it."
            );
            self.matches.remove(&last);
        }
        let book = &self.dens[den_id as usize];
        let training_levels = rules::den_training_levels(book.training_spent);
        if stake > 0 {
            if !rules::den_is_open(book.bankroll) {
                let (wins, fights) = (book.recent_wins(), book.memory.len() as u32);
                fail(&rules::den_reason(den.name, book.bankroll, wins, fights, training_levels));
            }
            require!(
                stake.is_multiple_of(rules::DEN_STAKE_STEP),
                "A stake against a den is a whole number of hundredths of a NEAR."
            );
            let most = rules::den_max_stake(book.bankroll);
            require!(stake <= most, format!("{} takes stakes of up to {} NEAR right now.", den.name, near_text(most)));
        }
        let payout_bps = book.payout_bps();
        let team = self.field_squad(&caller, &squad, 0);
        let house_team = self.den_team(den, &squad, stake > 0, rules::den_level_bonus(training_levels));
        self.debit(&caller, stake);
        self.escrow += stake;
        self.den_fights += 1;
        self.last_match_id += 1;
        self.player_mut(&caller).den_match = Some(self.last_match_id);
        self.save_match(Match {
            id: self.last_match_id,
            host: caller,
            rival: Rival::Den(den_id),
            stake,
            level_cap: 0,
            payout_bps,
            battle: Battle::new(team, house_team),
            seals: [None, None],
            moves: [None, None],
            deadline: 0,
            steps: Vec::new(),
            last_events: "[]".to_string(),
            void: false,
            payout: 0,
            essence: [0, 0],
            xp: [[0; 3]; 2],
            levels: [[0; 3]; 2],
        })
    }

    /// Plays the caller's action in their den fight: 0 Strike, 1 Guard, 2 Break, 3 Special,
    /// 10, 11, 12 to send in the beast in slot 0, 1, 2 when it is time to pick, or 20, 21, 22
    /// to swap the beast in the pit for that one instead of a move. The den chooses its own action in
    /// the same call, from NEAR's random seed, before it sees the caller's. If the step
    /// leaves only the den with something to do, that plays out here too.
    pub fn den_act(&mut self, action: u8) -> MatchView {
        let caller = env::predecessor_account_id();
        let mut fight = self.take_den_fight(&caller);
        let Rival::Den(den_id) = fight.rival else { fail("That is not a den fight.") };
        let style = data::DENS[den_id as usize].style;
        if let Err(problem) = fight.battle.check(0, action) {
            fail(problem);
        }
        let mut events = Vec::new();
        let mut player_action = Some(action);
        loop {
            let turn = fight.battle.turn;
            let mut seed = env::random_seed();
            seed.extend(fight.id.to_le_bytes());
            seed.extend(turn.to_le_bytes());
            let mut rng = Rng::new(&seed, DEN_CHOICE_SALT ^ turn as u64);
            let den_action = fight.battle.need()[1].then(|| npc::npc_action(&fight.battle, 1, style, &mut rng));
            let step = fight.battle.step([player_action.take(), den_action], &seed).unwrap_or_else(|problem| fail(problem));
            fight.record_step(&step);
            events.extend(step);
            if fight.battle.over() || fight.battle.need() != [false, true] {
                break;
            }
        }
        fight.last_events = crate::events_json(&events);
        if fight.battle.over() {
            self.settle_den_fight(&mut fight);
        }
        self.save_match(fight)
    }

    /// Gives up the caller's den fight. It counts as a loss.
    pub fn forfeit_den(&mut self) -> MatchView {
        let caller = env::predecessor_account_id();
        let mut fight = self.take_den_fight(&caller);
        fight.concede(1);
        self.settle_den_fight(&mut fight);
        self.save_match(fight)
    }

    /// Moves `amount` from the caller's balance into a den's bankroll, for shares at the
    /// value a share has now. Returns the shares minted.
    pub fn back_den(&mut self, den_id: u8, amount: U128) -> U128 {
        let caller = env::predecessor_account_id();
        self.debit(&caller, amount.0);
        let shares = self.grow_den(den_id, amount.0);
        put(&mut self.player_mut(&caller).backing, den_id, shares);
        tokens::log_mint(&caller, &[tokens::den_token(den_id)], &[shares]);
        U128(shares)
    }

    /// Burns the caller's shares in a den and pays their part of its bankroll into the
    /// balance. Returns the amount paid.
    pub fn unback_den(&mut self, den_id: u8, shares: U128) -> U128 {
        let caller = env::predecessor_account_id();
        let shares = shares.0;
        require!(shares > 0, "Name how many shares to cash out.");
        require!(
            take(&mut self.player_mut(&caller).backing, &den_id, shares),
            "You don't hold that many shares in this den."
        );
        let book = &mut self.dens[den_id as usize];
        let was_open = rules::den_is_open(book.bankroll);
        let amount =
            mul_div(shares, book.bankroll, book.shares).unwrap_or_else(|| fail("This den's shares can't be priced right now."));
        book.shares -= shares;
        book.bankroll -= amount;
        self.credit(&caller, amount);
        self.note_doors(den_id, was_open);
        tokens::log_burn(&caller, &[tokens::den_token(den_id)], &[shares]);
        U128(amount)
    }

    /// The house backs a den from its treasury. Only the contract's owner may call this.
    pub fn house_back_den(&mut self, den_id: u8, amount: U128) {
        require!(env::predecessor_account_id() == self.owner, "Only the house can do that.");
        require!(self.treasury >= amount.0, "The treasury does not hold that much.");
        self.treasury -= amount.0;
        let shares = self.grow_den(den_id, amount.0);
        self.dens[den_id as usize].house_shares += shares;
        tokens::log_mint(&env::current_account_id(), &[tokens::den_token(den_id)], &[shares]);
    }
}

impl Contract {
    /// Takes the caller's unfinished den fight out of storage, to be changed and saved again.
    fn take_den_fight(&mut self, caller: &AccountId) -> Match {
        self.player(caller)
            .den_match
            .and_then(|match_id| self.matches.remove(&match_id))
            .filter(|fight| !fight.over())
            .unwrap_or_else(|| fail("You have no den fight in progress."))
    }

    /// The den's three beasts. In a staked fight they match the challenger: their level is
    /// the average level of the challenger's squad. In a free spar it is the level of the
    /// den's tier. Either way, the training the den has paid for adds `bonus` levels on top.
    fn den_team(&self, den: &data::Den, squad: &[u64; 3], staked: bool, bonus: u32) -> Vec<Fighter> {
        let base = if staked {
            let total: u64 = squad.iter().map(|beast_id| self.beast(*beast_id).level as u64).sum();
            (total / 3) as u32
        } else {
            rules::den_spar_level(den.tier)
        };
        let level = base.saturating_add(bonus);
        den.squad
            .iter()
            .map(|species| battle::fighter(&Build { token: 0, species: *species, level, relic: 0, aura: 0, finisher: 0 }, 0))
            .collect()
    }

    /// Pays out a den fight that has just ended, and writes it into everyone's record.
    fn settle_den_fight(&mut self, fight: &mut Match) {
        let Rival::Den(den_id) = fight.rival else { fail("That is not a den fight.") };
        let den = &data::DENS[den_id as usize];
        let won = fight.battle.winner == 0;
        let book = &mut self.dens[den_id as usize];
        let was_open = rules::den_is_open(book.bankroll);
        if won {
            book.total_losses += 1;
        } else {
            book.total_wins += 1;
        }
        let stake = fight.stake;
        if stake > 0 {
            if won {
                // The den pays the profit from its bankroll, and never more than it holds.
                let profit = rules::den_payout(stake, fight.payout_bps).saturating_sub(stake).min(book.bankroll);
                book.bankroll -= profit;
                fight.payout = stake + profit;
            } else {
                let training = rules::bps(stake, rules::DEN_TRAINING_BPS);
                book.training_spent += training;
                book.bankroll += stake - training;
                self.treasury += training;
                fight.payout = stake - training;
            }
            book.memory.push(!won);
            if book.memory.len() > rules::DEN_MEMORY as usize {
                book.memory.remove(0);
            }
            self.escrow -= stake;
            self.volume += stake;
            if won {
                self.credit(&fight.host, fight.payout);
                self.player_mut(&fight.host).won += fight.payout;
                self.announce(format!("{} won {} NEAR from {}", fight.host, near_text(fight.payout), den.name));
            } else {
                self.announce(format!("{} took {} NEAR from {}", den.name, near_text(stake), fight.host));
            }
            self.note_doors(den_id, was_open);
        }
        let essence = rules::den_essence(den.tier, won);
        fight.essence = [essence, 0];
        self.award_essence(&fight.host, essence);
        let player = self.player_mut(&fight.host);
        if won {
            player.den_wins += 1;
        } else {
            player.den_losses += 1;
        }
        let fight_xp = rules::den_xp(den.tier, won, stake > 0);
        (fight.xp[0], fight.levels[0]) = self.record_fight(&fight.battle.teams[0], won, fight_xp);
    }

    /// Adds `amount` to a den's bankroll. Returns the shares that buys at the value a share
    /// has now: one share per yoctoNEAR if the den has none yet.
    fn grow_den(&mut self, den_id: u8, amount: u128) -> u128 {
        require!(amount > 0, "Back a den with more than nothing.");
        let book = self.dens.get_mut(den_id as usize).unwrap_or_else(|| fail("There is no such den."));
        let was_open = rules::den_is_open(book.bankroll);
        let shares = if book.shares == 0 {
            amount
        } else {
            mul_div(amount, book.shares, book.bankroll).unwrap_or_else(|| fail("This den's shares can't be priced right now."))
        };
        require!(shares > 0, "That is too little to buy a share.");
        book.bankroll += amount;
        book.shares += shares;
        self.note_doors(den_id, was_open);
        shares
    }

    /// Tells the ticker when a change to its bankroll has closed a den or opened it again.
    fn note_doors(&mut self, den_id: u8, was_open: bool) {
        let open = rules::den_is_open(self.dens[den_id as usize].bankroll);
        if open != was_open {
            let name = data::DENS[den_id as usize].name;
            self.announce(if open { format!("{name} is open for stakes again") } else { format!("{name} has closed its doors") });
        }
    }
}
