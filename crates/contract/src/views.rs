//! What the game reads. The shapes are written up in `docs/CONTRACT.md`.

use maul_core::battle::{self, Battle, Event};
use maul_core::{data, rules};
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{near, serde_json, AccountId};

use crate::{mul_div, Challenge, Contract, ContractExt, DenBook, Match, Rival, Shelf, TickerLine};

/// The most rows a paged view returns in one call.
const MAX_PAGE: u32 = 100;

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BeastView {
    pub id: u64,
    pub species: u8,
    /// The name its owner gave it, or else `form_name`.
    pub name: String,
    pub owner: AccountId,
    pub level: u32,
    /// XP earned towards the next level, and how much that level takes.
    pub xp: u64,
    pub xp_next: u64,
    /// The form its level gives it (0 to 4), and what its line is called in that form.
    pub form: u8,
    pub form_name: &'static str,
    pub relic: u8,
    pub aura: u8,
    pub finisher: u8,
    /// Health, attack, defence and speed, with level and relic counted in.
    pub stats: [u32; 4],
    pub power: u32,
    pub kills: u32,
    pub fights: u32,
    pub wins: u32,
    pub hire_price: Option<U128>,
    pub earned: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct HireView {
    pub beast: BeastView,
    pub fights_left: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BackingView {
    pub den: u8,
    pub shares: U128,
    /// What the shares would pay if cashed out now.
    pub value: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PlayerView {
    pub account_id: AccountId,
    pub registered: bool,
    pub balance: U128,
    pub essence: u64,
    pub rating: u32,
    pub wins: u32,
    pub losses: u32,
    pub den_wins: u32,
    pub den_losses: u32,
    pub won: U128,
    pub hire_income: U128,
    pub beasts: Vec<BeastView>,
    pub items: Vec<(u8, u32)>,
    pub hires: Vec<HireView>,
    pub den_match: Option<u64>,
    pub duel: Option<u64>,
    pub challenge: Option<u64>,
    pub backing: Vec<BackingView>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DenView {
    pub id: u8,
    pub name: &'static str,
    pub title: &'static str,
    pub style: u8,
    pub tier: u8,
    pub squad: [u8; 3],
    pub bankroll: U128,
    pub shares: U128,
    pub open: bool,
    pub max_stake: U128,
    pub payout_bps: u32,
    /// Its wins among its last ten staked fights, and how many of those there are.
    pub wins: u32,
    pub fights: u32,
    /// Every fight it has finished, staked or not.
    pub total_wins: u32,
    pub total_losses: u32,
    pub training_spent: U128,
    /// The levels its training money has bought, and the levels that puts its beasts up.
    pub training_levels: u32,
    pub level_bonus: u32,
    /// The level its beasts have in a free spar, before the bonus.
    pub spar_level: u32,
    pub reason: String,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ShelfView {
    pub id: u8,
    pub price: U128,
    pub floor: U128,
    pub heat: u32,
    pub sold: u32,
    pub reason: String,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct MarketView {
    pub items: Vec<ShelfView>,
    pub species: Vec<ShelfView>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ChallengeBeastView {
    pub token: u64,
    pub species: u8,
    /// The level and power it would fight at in this duel, under the level cap.
    pub level: u32,
    pub power: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ChallengeView {
    pub id: u64,
    pub creator: AccountId,
    pub stake: U128,
    pub level_cap: u32,
    pub invite: Option<AccountId>,
    pub squad: Vec<ChallengeBeastView>,
    pub created: u64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct StepView {
    pub turn: u32,
    pub events: Vec<Event>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct MatchView {
    pub id: u64,
    pub kind: &'static str,
    pub players: [String; 2],
    pub den: Option<u8>,
    pub stake: U128,
    pub level_cap: u32,
    pub payout_bps: u32,
    pub battle: Battle,
    pub need: [bool; 2],
    pub sealed: [bool; 2],
    pub open: [bool; 2],
    pub deadline: u64,
    pub steps: Vec<StepView>,
    pub last_events: Vec<Event>,
    pub over: bool,
    pub winner: Option<u8>,
    pub void: bool,
    pub payout: U128,
    pub essence: [u64; 2],
    /// The XP each beast earned, by side and slot, and the level that left it at.
    pub xp: [[u64; 3]; 2],
    pub levels: [[u32; 3]; 2],
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct LeaderView {
    pub account_id: AccountId,
    pub rating: u32,
    pub wins: u32,
    pub losses: u32,
    pub won: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct StatsView {
    pub players: u32,
    pub beasts: u64,
    pub den_fights: u64,
    pub duels: u64,
    pub volume: U128,
    pub treasury: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct LedgerView {
    pub balances: U128,
    pub bankrolls: U128,
    pub escrow: U128,
    pub treasury: U128,
    pub deposited: U128,
    pub withdrawn: U128,
}

#[near]
impl Contract {
    /// A player's account, beasts and everything else they hold. A stranger gets
    /// `registered: false` and empty lists.
    pub fn get_player(&self, account_id: AccountId) -> PlayerView {
        self.player_view(&account_id)
    }

    /// One beast, or null if there is none with that id.
    pub fn get_beast(&self, beast_id: u64) -> Option<BeastView> {
        self.beasts.contains_key(&beast_id).then(|| self.beast_view(beast_id))
    }

    /// Several beasts, in the order asked for. Ids that don't exist are left out.
    pub fn get_beasts(&self, ids: Vec<u64>) -> Vec<BeastView> {
        ids.into_iter().filter_map(|beast_id| self.get_beast(beast_id)).collect()
    }

    /// The five dens: their bankrolls, records and what they pay right now.
    pub fn get_dens(&self) -> Vec<DenView> {
        data::DENS.iter().zip(&self.dens).map(|(den, book)| den_view(den, book)).collect()
    }

    /// Every bazaar price right now, with the reason for it.
    pub fn get_market(&self) -> MarketView {
        let shelf = |id: u8, price_milli: u32, shelf: &Shelf| {
            let (floor, heat) = (price_milli as u128 * rules::MILLI, shelf.heat_now());
            ShelfView {
                id,
                price: U128(shelf.price(floor)),
                floor: U128(floor),
                heat,
                sold: shelf.sold,
                reason: rules::price_reason(heat),
            }
        };
        MarketView {
            items: data::ITEMS.iter().zip(&self.item_shelves).map(|(item, s)| shelf(item.id, item.price_milli, s)).collect(),
            species: data::SPECIES.iter().zip(&self.species_shelves).map(|(kind, s)| shelf(kind.id, kind.price_milli, s)).collect(),
        }
    }

    /// The beasts listed for hire, a page at a time.
    pub fn get_hire_market(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<BeastView> {
        let (skip, count) = page(from_index, limit);
        self.for_hire.iter().skip(skip).take(count).map(|beast_id| self.beast_view(*beast_id)).collect()
    }

    /// The open challenges, newest first, a page at a time.
    pub fn get_challenges(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<ChallengeView> {
        let (skip, count) = page(from_index, limit);
        let mut ids: Vec<u64> = self.challenges.keys().copied().collect();
        ids.sort_unstable_by(|a, b| b.cmp(a));
        ids.iter()
            .skip(skip)
            .take(count)
            .filter_map(|id| self.challenges.get(id))
            .map(|challenge| self.challenge_view(challenge))
            .collect()
    }

    /// A fight, or null if there is none with that id (finished fights are cleared away
    /// when their players start new ones).
    pub fn get_match(&self, match_id: u64) -> Option<MatchView> {
        self.matches.get(&match_id).map(MatchView::of)
    }

    /// The last 30 things that happened, newest first.
    pub fn get_ticker(&self) -> Vec<TickerLine> {
        self.ticker.get().clone()
    }

    /// The players with the highest pit ratings.
    pub fn get_leaderboard(&self, limit: Option<u32>) -> Vec<LeaderView> {
        let mut rows: Vec<LeaderView> = self
            .players
            .iter()
            .map(|(account_id, player)| LeaderView {
                account_id: account_id.clone(),
                rating: player.rating,
                wins: player.wins,
                losses: player.losses,
                won: U128(player.won),
            })
            .collect();
        rows.sort_by(|a, b| {
            b.rating.cmp(&a.rating).then(b.wins.cmp(&a.wins)).then_with(|| a.account_id.cmp(&b.account_id))
        });
        rows.truncate(page(None, limit).1);
        rows
    }

    /// Counts for the front page.
    pub fn get_stats(&self) -> StatsView {
        StatsView {
            players: self.players.len(),
            beasts: self.last_beast_id,
            den_fights: self.den_fights,
            duels: self.duels,
            volume: U128(self.volume),
            treasury: U128(self.treasury),
        }
    }

    /// The contract's books. Everything it holds for players, dens and the house
    /// (`balances + bankrolls + escrow + treasury`) always equals `deposited - withdrawn`.
    /// Reads every player, so it is meant for audits.
    pub fn get_ledger(&self) -> LedgerView {
        LedgerView {
            balances: U128(self.players.values().map(|player| player.balance).sum()),
            bankrolls: U128(self.dens.iter().map(|book| book.bankroll).sum()),
            escrow: U128(self.escrow),
            treasury: U128(self.treasury),
            deposited: U128(self.deposited),
            withdrawn: U128(self.withdrawn),
        }
    }
}

impl Contract {
    pub(crate) fn beast_view(&self, beast_id: u64) -> BeastView {
        let beast = self.beast(beast_id);
        let stats = battle::stats(&beast.build(beast_id), 0);
        BeastView {
            id: beast_id,
            species: beast.species,
            name: beast.display_name(),
            owner: beast.owner.clone(),
            level: beast.level,
            xp: beast.xp,
            xp_next: rules::xp_for_level(beast.level),
            form: rules::form_of(beast.level),
            form_name: beast.form_name(),
            relic: beast.relic,
            aura: beast.aura,
            finisher: beast.finisher,
            stats,
            power: battle::power(&stats),
            kills: beast.kills,
            fights: beast.fights,
            wins: beast.wins,
            hire_price: beast.hire_price.map(U128),
            earned: U128(beast.earned),
        }
    }

    pub(crate) fn player_view(&self, account_id: &AccountId) -> PlayerView {
        let Some(player) = self.players.get(account_id) else {
            return PlayerView {
                account_id: account_id.clone(),
                registered: false,
                balance: U128(0),
                essence: 0,
                rating: rules::RATING_START,
                wins: 0,
                losses: 0,
                den_wins: 0,
                den_losses: 0,
                won: U128(0),
                hire_income: U128(0),
                beasts: Vec::new(),
                items: Vec::new(),
                hires: Vec::new(),
                den_match: None,
                duel: None,
                challenge: None,
                backing: Vec::new(),
            };
        };
        let mut items = player.items.clone();
        items.sort_unstable();
        PlayerView {
            account_id: account_id.clone(),
            registered: true,
            balance: U128(player.balance),
            essence: player.essence,
            rating: player.rating,
            wins: player.wins,
            losses: player.losses,
            den_wins: player.den_wins,
            den_losses: player.den_losses,
            won: U128(player.won),
            hire_income: U128(player.hire_income),
            beasts: player.beasts.iter().map(|beast_id| self.beast_view(*beast_id)).collect(),
            items,
            hires: player
                .hires
                .iter()
                .map(|(beast_id, fights_left)| HireView { beast: self.beast_view(*beast_id), fights_left: *fights_left })
                .collect(),
            den_match: player.den_match,
            duel: player.duel,
            challenge: player.challenge,
            backing: player
                .backing
                .iter()
                .map(|(den_id, shares)| {
                    let book = &self.dens[*den_id as usize];
                    let value = mul_div(*shares, book.bankroll, book.shares).unwrap_or(0);
                    BackingView { den: *den_id, shares: U128(*shares), value: U128(value) }
                })
                .collect(),
        }
    }

    pub(crate) fn challenge_view(&self, challenge: &Challenge) -> ChallengeView {
        ChallengeView {
            id: challenge.id,
            creator: challenge.creator.clone(),
            stake: U128(challenge.stake),
            level_cap: challenge.level_cap,
            invite: challenge.invite.clone(),
            squad: challenge
                .squad
                .iter()
                .map(|beast_id| {
                    let build = self.beast(*beast_id).build(*beast_id);
                    let level = battle::fighting_level(&build, challenge.level_cap);
                    let power = battle::power(&battle::stats(&build, challenge.level_cap));
                    ChallengeBeastView { token: *beast_id, species: build.species, level, power }
                })
                .collect(),
            created: challenge.created,
        }
    }
}

impl MatchView {
    pub(crate) fn of(fight: &Match) -> MatchView {
        let (kind, rival, den) = match &fight.rival {
            Rival::Den(den_id) => ("den", format!("den:{den_id}"), Some(*den_id)),
            Rival::Player(account) => ("duel", account.to_string(), None),
        };
        let winner = fight.battle.winner;
        MatchView {
            id: fight.id,
            kind,
            players: [fight.host.to_string(), rival],
            den,
            stake: U128(fight.stake),
            level_cap: fight.level_cap,
            payout_bps: fight.payout_bps,
            battle: fight.battle.clone(),
            need: fight.battle.need(),
            sealed: [0, 1].map(|side| fight.seals[side].is_some() && fight.moves[side].is_none()),
            open: [0, 1].map(|side| fight.moves[side].is_some()),
            deadline: fight.deadline,
            steps: fight.steps.iter().map(|step| StepView { turn: step.turn, events: parse_events(&step.events) }).collect(),
            last_events: parse_events(&fight.last_events),
            over: fight.over(),
            winner: (winner != battle::NONE).then_some(winner),
            void: fight.void,
            payout: U128(fight.payout),
            essence: fight.essence,
            xp: fight.xp,
            levels: fight.levels,
        }
    }
}

fn den_view(den: &data::Den, book: &DenBook) -> DenView {
    let (wins, fights) = (book.recent_wins(), book.memory.len() as u32);
    let training_levels = rules::den_training_levels(book.training_spent);
    DenView {
        id: den.id,
        name: den.name,
        title: den.title,
        style: den.style,
        tier: den.tier,
        squad: den.squad,
        bankroll: U128(book.bankroll),
        shares: U128(book.shares),
        open: rules::den_is_open(book.bankroll),
        max_stake: U128(rules::den_max_stake(book.bankroll)),
        payout_bps: book.payout_bps(),
        wins,
        fights,
        total_wins: book.total_wins,
        total_losses: book.total_losses,
        training_spent: U128(book.training_spent),
        training_levels,
        level_bonus: rules::den_level_bonus(training_levels),
        spar_level: rules::den_spar_level(den.tier),
        reason: rules::den_reason(den.name, book.bankroll, wins, fights, training_levels),
    }
}

/// Stored events, back as events. They were written by `events_json`, so they always read.
fn parse_events(json: &str) -> Vec<Event> {
    serde_json::from_str(json).unwrap_or_default()
}

/// How many rows to skip and how many to return, for a paged view.
fn page(from_index: Option<u32>, limit: Option<u32>) -> (usize, usize) {
    (from_index.unwrap_or(0) as usize, limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize)
}
