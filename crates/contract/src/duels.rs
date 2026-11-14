//! Duels: one player's three beasts against another's, for a stake.
//!
//! Both sides choose at the same moment, so a move is first sealed as a hash
//! (`duel_commit`) and opened once the other side has sealed theirs
//! (`duel_reveal`). A step plays as soon as every side that has to act has an
//! open move. A player who stops answering loses on the clock.

use maul_core::battle::{self, Battle};
use maul_core::rules;
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::views::{ChallengeView, MatchView};
use crate::{events_json, fail, near_text, now, Challenge, Contract, ContractExt, Match, Rival};

/// How long both duellists have to send in their first beasts.
const OPENING_CLOCK_SECS: u64 = 180;
/// The longest salt a move may be sealed with.
const MAX_SALT_LEN: usize = 128;

#[near]
impl Contract {
    /// Posts a challenge with the caller's squad. `stake` is "0" for a friendly, or at
    /// least 0.01 NEAR, which is held until the challenge is cancelled or the duel ends.
    /// A `level_cap` above 0 has every beast fight at that level at most.
    /// `invite` names the only account that may accept.
    pub fn create_challenge(
        &mut self,
        squad: [u64; 3],
        stake: U128,
        level_cap: u32,
        invite: Option<AccountId>,
    ) -> ChallengeView {
        let caller = env::predecessor_account_id();
        let stake = stake.0;
        require!(self.player(&caller).challenge.is_none(), "You already have a challenge open. Cancel it first.");
        require!(stake == 0 || stake >= rules::MIN_DUEL_STAKE, "A duel is a friendly, or for at least 0.01 NEAR.");
        require!(invite.as_ref() != Some(&caller), "Invite someone other than yourself.");
        if let Some(problem) = self.squad_problem(&caller, &squad) {
            fail(&problem);
        }
        self.debit(&caller, stake);
        self.escrow += stake;
        self.last_challenge_id += 1;
        let challenge = Challenge { id: self.last_challenge_id, creator: caller.clone(), stake, level_cap, invite, squad, created: now() };
        self.player_mut(&caller).challenge = Some(challenge.id);
        let terms = if stake > 0 { format!("for {} NEAR", near_text(stake)) } else { "for a friendly duel".to_string() };
        self.announce(match &challenge.invite {
            Some(invited) => format!("{caller} called out {invited} {terms}"),
            None => format!("{caller} is looking for a fight {terms}"),
        });
        let view = self.challenge_view(&challenge);
        self.challenges.insert(challenge.id, challenge);
        view
    }

    /// Takes the caller's open challenge down and returns its stake.
    pub fn cancel_challenge(&mut self) {
        let caller = env::predecessor_account_id();
        let challenge = self
            .player_mut(&caller)
            .challenge
            .take()
            .and_then(|id| self.challenges.remove(&id))
            .unwrap_or_else(|| fail("You have no challenge open."));
        self.escrow -= challenge.stake;
        self.credit(&caller, challenge.stake);
    }

    /// Accepts a challenge with the caller's squad, matching its stake from the balance.
    /// The duel starts at once. The challenger is side 0.
    pub fn accept_challenge(&mut self, id: u64, squad: [u64; 3]) -> MatchView {
        let caller = env::predecessor_account_id();
        let challenge = self.challenges.remove(&id).unwrap_or_else(|| fail("That challenge is no longer open."));
        let creator = challenge.creator.clone();
        require!(caller != creator, "You can't accept your own challenge.");
        require!(challenge.invite.as_ref().is_none_or(|invited| *invited == caller), "That challenge is for someone else.");
        if self.squad_problem(&creator, &challenge.squad).is_some() {
            fail("The challenger can no longer field the squad they named.");
        }
        self.clear_last_duel(&creator, "The challenger is in the middle of another duel.");
        self.clear_last_duel(&caller, "Finish your duel first, or forfeit it.");
        self.debit(&caller, challenge.stake);
        self.escrow += challenge.stake;
        let teams = [
            self.field_squad(&creator, &challenge.squad, challenge.level_cap),
            self.field_squad(&caller, &squad, challenge.level_cap),
        ];
        self.duels += 1;
        self.last_match_id += 1;
        let match_id = self.last_match_id;
        let challenger = self.player_mut(&creator);
        challenger.challenge = None;
        challenger.duel = Some(match_id);
        self.player_mut(&caller).duel = Some(match_id);
        let [team, rival_team] = teams;
        self.save_match(Match {
            id: match_id,
            host: creator,
            rival: Rival::Player(caller),
            stake: challenge.stake,
            level_cap: challenge.level_cap,
            payout_bps: 0,
            battle: Battle::new(team, rival_team),
            seals: [None, None],
            moves: [None, None],
            deadline: now() + OPENING_CLOCK_SECS,
            steps: Vec::new(),
            last_events: "[]".to_string(),
            void: false,
            payout: 0,
            essence: [0, 0],
            xp: [[0; 3]; 2],
            levels: [[0; 3]; 2],
        })
    }

    /// Seals the caller's move for this step. `hash` is the lowercase hex SHA-256 of
    /// "{action}:{salt}", for example "2:9f3a61c0".
    pub fn duel_commit(&mut self, hash: String) -> MatchView {
        let (mut duel, side) = self.take_duel(&env::predecessor_account_id());
        require!(duel.battle.need()[side], "It is not your turn to act.");
        require!(duel.seals[side].is_none() && duel.moves[side].is_none(), "You have already locked in a move this turn.");
        require!(
            hash.len() == 64 && hash.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')),
            "A sealed move is a SHA-256 hash: 64 lowercase hex characters."
        );
        duel.seals[side] = Some(hash);
        self.play_if_ready(duel)
    }

    /// Opens the caller's sealed move, once the other side has locked its own in (or has
    /// nothing to do this step): a move opened sooner could still be countered. An action
    /// that is not legal becomes a Strike, or the first living beast when it is time to pick one.
    pub fn duel_reveal(&mut self, action: u8, salt: String) -> MatchView {
        let (mut duel, side) = self.take_duel(&env::predecessor_account_id());
        require!(duel.moves[side].is_none(), "Your move is already open.");
        let seal = duel.seals[side].as_ref().unwrap_or_else(|| fail("You have no sealed move to open."));
        require!(duel.locked_in(1 - side), "Wait for the other side to lock in before you open your move.");
        require!(salt.len() <= MAX_SALT_LEN, format!("A salt is at most {MAX_SALT_LEN} characters."));
        require!(*seal == seal_of(action, &salt), "That is not the move you sealed.");
        let action = if duel.battle.check(side, action).is_ok() { action } else { fallback_action(&duel.battle, side) };
        duel.moves[side] = Some((action, salt));
        self.play_if_ready(duel)
    }

    /// Plays an open move with no seal. Allowed when the caller is the only side that has
    /// to act, or when the other side has already sealed or opened its move.
    pub fn duel_play(&mut self, action: u8) -> MatchView {
        let (mut duel, side) = self.take_duel(&env::predecessor_account_id());
        if let Err(problem) = duel.battle.check(side, action) {
            fail(problem);
        }
        require!(duel.seals[side].is_none() && duel.moves[side].is_none(), "You have already locked in a move this turn.");
        require!(duel.locked_in(1 - side), "Seal your move: the other side has not locked theirs in yet.");
        duel.moves[side] = Some((action, String::new()));
        self.play_if_ready(duel)
    }

    /// Ends the caller's duel once its clock has run out. Before the first beasts are in,
    /// the duel is void. After that the side that is stalling loses, and if both are
    /// stalling the duel is void. A void duel returns both stakes.
    pub fn claim_timeout(&mut self) -> MatchView {
        let (mut duel, _) = self.take_duel(&env::predecessor_account_id());
        require!(now() > duel.deadline, "The clock has not run out yet.");
        let need = duel.battle.need();
        // A side stalls if it owes a move and has done nothing, or has sealed one and not
        // opened it although the other side has locked in, so nothing stops it.
        let stalls = |side: usize| {
            need[side] && duel.moves[side].is_none() && (duel.seals[side].is_none() || duel.locked_in(1 - side))
        };
        let loser = match (stalls(0), stalls(1)) {
            _ if duel.battle.turn == 0 => None,
            (true, false) => Some(0),
            (false, true) => Some(1),
            _ => None,
        };
        match loser {
            Some(side) => {
                duel.concede(1 - side);
                self.settle_duel(&mut duel);
            }
            None => self.void_duel(&mut duel),
        }
        self.save_match(duel)
    }

    /// Concedes the caller's duel. The other side wins.
    pub fn forfeit_duel(&mut self) -> MatchView {
        let (mut duel, side) = self.take_duel(&env::predecessor_account_id());
        duel.concede(1 - side);
        self.settle_duel(&mut duel);
        self.save_match(duel)
    }
}

impl Contract {
    /// Takes the caller's unfinished duel out of storage, to be changed and saved again.
    /// Also returns which side the caller is on.
    fn take_duel(&mut self, caller: &AccountId) -> (Match, usize) {
        let duel = self
            .player(caller)
            .duel
            .and_then(|match_id| self.matches.remove(&match_id))
            .filter(|duel| !duel.over())
            .unwrap_or_else(|| fail("You have no duel in progress."));
        let side = if duel.host == *caller { 0 } else { 1 };
        (duel, side)
    }

    /// Makes room for a player's next duel. Their last one must be over. It is deleted once
    /// the other duellist has moved on from it too.
    fn clear_last_duel(&mut self, account: &AccountId, still_fighting: &str) {
        let Some(last) = self.player(account).duel else { return };
        if let Some(duel) = self.matches.get(&last) {
            require!(duel.over(), still_fighting);
            let other = (0..2).filter_map(|side| duel.account(side)).find(|other| *other != account);
            if other.is_none_or(|other| self.player(other).duel != Some(last)) {
                self.matches.remove(&last);
            }
        }
        self.player_mut(account).duel = None;
    }

    /// Plays the step if every side that has to act has an open move. Otherwise the move
    /// just made gives the other side a full clock to answer it.
    fn play_if_ready(&mut self, mut duel: Match) -> MatchView {
        let need = duel.battle.need();
        let next_deadline = now() + rules::MOVE_CLOCK_SECS;
        if (0..2).any(|side| need[side] && duel.moves[side].is_none()) {
            duel.deadline = duel.deadline.max(next_deadline);
            return self.save_match(duel);
        }
        // The seed is both salts and NEAR's random seed, so neither side can steer it.
        let mut seed = Vec::new();
        let actions = [0, 1].map(|side| {
            let (action, salt) = duel.moves[side].take()?;
            seed.extend(salt.into_bytes());
            Some(action)
        });
        seed.extend(env::random_seed());
        let events = duel.battle.step(actions, &env::sha256(&seed)).unwrap_or_else(|problem| fail(problem));
        duel.seals = [None, None];
        duel.deadline = next_deadline;
        duel.record_step(&events);
        duel.last_events = events_json(&events);
        if duel.battle.over() {
            self.settle_duel(&mut duel);
        }
        self.save_match(duel)
    }

    /// Pays the pot of a duel that has a winner, and writes it into everyone's record.
    fn settle_duel(&mut self, duel: &mut Match) {
        let winning_side = duel.battle.winner as usize;
        let (Some(winner), Some(loser)) = (duel.account(winning_side).cloned(), duel.account(1 - winning_side).cloned())
        else {
            fail("That is not a duel.")
        };
        let pot = duel.stake * 2;
        let rake = rules::bps(pot, rules::DUEL_RAKE_BPS);
        duel.payout = pot - rake;
        self.escrow -= pot;
        self.treasury += rake;
        self.volume += pot;
        let (winner_rating, loser_rating) = rules::ratings_after(self.player(&winner).rating, self.player(&loser).rating);
        let victor = self.player_mut(&winner);
        victor.balance += duel.payout;
        victor.won += duel.payout;
        victor.wins += 1;
        victor.rating = winner_rating;
        let beaten = self.player_mut(&loser);
        beaten.losses += 1;
        beaten.rating = loser_rating;
        for (side, won) in [(winning_side, true), (1 - winning_side, false)] {
            duel.essence[side] = rules::duel_essence(won);
            (duel.xp[side], duel.levels[side]) = self.record_fight(&duel.battle.teams[side], won, rules::duel_xp(won));
        }
        self.award_essence(&winner, rules::duel_essence(true));
        self.award_essence(&loser, rules::duel_essence(false));
        self.announce(if pot > 0 {
            format!("{winner} won {} NEAR from {loser}", near_text(duel.payout))
        } else {
            format!("{winner} beat {loser} in a friendly duel")
        });
    }

    /// Calls a duel off: nobody wins and both stakes go back.
    fn void_duel(&mut self, duel: &mut Match) {
        duel.void = true;
        duel.last_events = "[]".to_string();
        let Rival::Player(rival) = &duel.rival else { fail("That is not a duel.") };
        self.escrow -= duel.stake * 2;
        self.credit(&duel.host, duel.stake);
        self.credit(rival, duel.stake);
        self.announce(format!("The duel between {} and {rival} was called off", duel.host));
    }
}

impl Match {
    /// Whether a side has locked its move in for this step: it has sealed or opened one, or
    /// it does not have to act. From then on, nothing the other side shows can change its move.
    fn locked_in(&self, side: usize) -> bool {
        !self.battle.need()[side] || self.seals[side].is_some() || self.moves[side].is_some()
    }
}

/// The hash a move is sealed under: the lowercase hex SHA-256 of "{action}:{salt}".
fn seal_of(action: u8, salt: &str) -> String {
    env::sha256(format!("{action}:{salt}")).iter().map(|byte| format!("{byte:02x}")).collect()
}

/// What stands in for a sealed move that turns out not to be legal.
fn fallback_action(battle: &Battle, side: usize) -> u8 {
    if battle.active[side] != battle::NONE {
        return battle::MOVE_STRIKE;
    }
    let first_living = battle.teams[side].iter().position(|fighter| fighter.hp > 0).unwrap_or(0);
    battle::ACT_PICK + first_living as u8
}
