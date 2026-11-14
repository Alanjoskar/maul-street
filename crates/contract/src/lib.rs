//! Maul Street on NEAR.
//!
//! One contract holds every beast, item, Essence and den share, keeps the
//! players' NEAR, referees every fight and pays out. The fight rules and every
//! price live in `maul-core`. This crate keeps the books and calls them.
//! The interface is written up in `docs/CONTRACT.md`.
//!
//! - `lib`: the state, joining, and NEAR in and out.
//! - `market`: levels, the bazaar, equipment and hiring.
//! - `dens`: fights against the house fighters, and backing them.
//! - `duels`: challenges and sealed-move fights between players.
//! - `tokens`: everything a player holds, as NEP-245 tokens.
//! - `views`: what the game reads.

mod dens;
mod duels;
mod market;
mod tokens;
mod views;

#[cfg(test)]
mod tests;

use std::ops::{Add, Sub};

use maul_core::battle::{self, Battle, Build, Event, Fighter};
use maul_core::{data, rules};
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, IterableSet, Lazy, LookupMap};
use near_sdk::{env, near, require, serde_json, AccountId, NearToken, PanicOnDefault, Promise};

use crate::views::{MatchView, PlayerView};

/// How many lines the ticker keeps.
const TICKER_LINES: usize = 30;
/// How many played steps a match keeps for the game to replay.
const STEPS_KEPT: usize = 4;

// ----- The state --------------------------------------------------------------

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// The house. It may back dens from the treasury.
    owner: AccountId,
    /// Prices, fees and den training money.
    treasury: u128,
    /// Stakes held for open challenges and unfinished fights.
    escrow: u128,
    /// All NEAR ever paid in (the dens' first bankrolls included)...
    deposited: u128,
    /// ...and all NEAR ever paid back out.
    withdrawn: u128,
    /// NEAR that has changed hands: settled stakes, hire fees, prices and levels bought.
    volume: u128,
    den_fights: u64,
    duels: u64,
    essence_supply: u64,
    /// Ids count up from 1. Each of these is the last one given out.
    last_beast_id: u64,
    last_match_id: u64,
    last_challenge_id: u64,
    /// One book per den, in the order of `data::DENS`.
    dens: Vec<DenBook>,
    /// One shelf per bazaar item, in the order of `data::ITEMS`...
    item_shelves: Vec<Shelf>,
    /// ...and how many of each item sit in inventories, not worn by a beast.
    loose_items: Vec<u32>,
    /// One shelf per species, in the order of `data::SPECIES`.
    species_shelves: Vec<Shelf>,
    players: IterableMap<AccountId, Player>,
    beasts: LookupMap<u64, Beast>,
    /// The beasts listed for hire.
    for_hire: IterableSet<u64>,
    challenges: IterableMap<u64, Challenge>,
    matches: LookupMap<u64, Match>,
    /// The last things that happened, newest first.
    ticker: Lazy<Vec<TickerLine>>,
}

/// A player's account inside the game.
#[near(serializers = [borsh])]
pub struct Player {
    /// NEAR the player can spend in the game or withdraw.
    balance: u128,
    essence: u64,
    rating: u32,
    wins: u32,
    losses: u32,
    den_wins: u32,
    den_losses: u32,
    /// Lifetime total of the payouts of fights won.
    won: u128,
    /// Lifetime income from hiring beasts out, after the house's cut.
    hire_income: u128,
    beasts: Vec<u64>,
    /// (item id, how many), not counting what the beasts wear.
    items: Vec<(u8, u32)>,
    /// (beast id, paid fights left) for beasts hired from other players.
    hires: Vec<(u64, u32)>,
    /// (den id, shares held).
    backing: Vec<(u8, u128)>,
    /// The latest den fight and duel. Each stays here after it ends, until the next one starts.
    den_match: Option<u64>,
    duel: Option<u64>,
    /// The player's open challenge.
    challenge: Option<u64>,
}

#[near(serializers = [borsh])]
pub struct Beast {
    species: u8,
    /// The name its owner gave it. Until then it goes by the name of the form it has grown into.
    name: Option<String>,
    owner: AccountId,
    /// 1 and up. There is no top level.
    level: u32,
    /// XP earned towards the next level.
    xp: u64,
    relic: u8,
    aura: u8,
    finisher: u8,
    kills: u32,
    fights: u32,
    wins: u32,
    /// The price of one fight, while the beast is listed for hire.
    hire_price: Option<u128>,
    /// Lifetime hire income, after the house's cut.
    earned: u128,
}

/// A den's money and record.
#[near(serializers = [borsh])]
pub struct DenBook {
    bankroll: u128,
    shares: u128,
    /// The shares the house holds, out of `shares`.
    house_shares: u128,
    /// Its last ten staked fights, oldest first. `true` is a fight the den won.
    memory: Vec<bool>,
    total_wins: u32,
    total_losses: u32,
    training_spent: u128,
}

/// How hot one bazaar price is.
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Shelf {
    heat: u32,
    last_buy: u64,
    sold: u32,
}

#[near(serializers = [borsh])]
pub struct Challenge {
    id: u64,
    creator: AccountId,
    stake: u128,
    level_cap: u32,
    invite: Option<AccountId>,
    squad: [u64; 3],
    created: u64,
}

/// Who stands on side 1 of a fight.
#[near(serializers = [borsh])]
pub enum Rival {
    Den(u8),
    Player(AccountId),
}

/// A fight against a den, or a duel between two players.
#[near(serializers = [borsh])]
pub struct Match {
    id: u64,
    /// Side 0: the den's challenger, or the player whose challenge started the duel.
    host: AccountId,
    rival: Rival,
    /// What each player put up.
    stake: u128,
    level_cap: u32,
    /// What a win pays against this den, fixed when the fight started. 0 in a duel.
    payout_bps: u32,
    battle: Battle,
    /// Duel: the hash each side sealed its move under, this step.
    seals: [Option<String>; 2],
    /// Duel: each side's opened move this step, and the salt it was sealed with.
    moves: [Option<(u8, String)>; 2],
    /// Duel: when the clock runs out, in Unix seconds. 0 in a den fight.
    deadline: u64,
    /// The last few played steps, oldest first.
    steps: Vec<Step>,
    /// The events of the latest call, as a JSON array.
    last_events: String,
    /// A duel called off on the clock: nobody won and the stakes went back.
    void: bool,
    /// What the winner was paid.
    payout: u128,
    /// The Essence each side earned.
    essence: [u64; 2],
    /// The XP each beast of each squad earned, by side and slot...
    xp: [[u64; 3]; 2],
    /// ...and the level that left it at. Zeros until the fight is over, and for a den's beasts.
    levels: [[u32; 3]; 2],
}

/// One played step of a fight.
#[near(serializers = [borsh])]
pub struct Step {
    /// `battle.turn` once the step had played.
    turn: u32,
    /// Its events, as a JSON array.
    events: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct TickerLine {
    pub ts: u64,
    pub text: String,
}

// ----- Joining, and NEAR in and out -------------------------------------------

#[near]
impl Contract {
    /// Sets the contract up. The caller becomes the house, and the attached NEAR is split
    /// evenly between the five dens as their first bankrolls.
    #[init]
    #[payable]
    pub fn new() -> Self {
        let seed = env::attached_deposit().as_yoctonear();
        let den_count = data::DENS.len() as u128;
        let each = seed / den_count;
        if each > 0 {
            let token_ids: Vec<String> = data::DENS.iter().map(|den| tokens::den_token(den.id)).collect();
            tokens::log_mint(&env::current_account_id(), &token_ids, &vec![each; token_ids.len()]);
        }
        Contract {
            owner: env::predecessor_account_id(),
            // Whatever does not split evenly stays with the house.
            treasury: seed - each * den_count,
            escrow: 0,
            deposited: seed,
            withdrawn: 0,
            volume: 0,
            den_fights: 0,
            duels: 0,
            essence_supply: 0,
            last_beast_id: 0,
            last_match_id: 0,
            last_challenge_id: 0,
            dens: data::DENS
                .iter()
                .map(|_| DenBook {
                    bankroll: each,
                    shares: each,
                    house_shares: each,
                    memory: Vec::new(),
                    total_wins: 0,
                    total_losses: 0,
                    training_spent: 0,
                })
                .collect(),
            item_shelves: vec![Shelf::default(); data::ITEMS.len()],
            loose_items: vec![0; data::ITEMS.len()],
            species_shelves: vec![Shelf::default(); data::SPECIES.len()],
            players: IterableMap::new(b"p"),
            beasts: LookupMap::new(b"b"),
            for_hire: IterableSet::new(b"h"),
            challenges: IterableMap::new(b"c"),
            matches: LookupMap::new(b"m"),
            ticker: Lazy::new(b"t", Vec::new()),
        }
    }

    /// Joins the game: mints the caller's three starting beasts, which must be three
    /// different common species, and gives them their first Essence.
    pub fn register(&mut self, picks: [u8; 3]) -> PlayerView {
        let caller = env::predecessor_account_id();
        require!(!self.players.contains_key(&caller), "You have already joined Maul Street.");
        require!(
            picks.iter().all(|pick| data::species(*pick).is_some_and(|species| !species.rare)),
            "Pick your starters from the five common beasts (0 to 4)."
        );
        require!(all_different(&picks), "Pick three different beasts.");
        self.players.insert(
            caller.clone(),
            Player {
                balance: 0,
                essence: rules::STARTING_ESSENCE,
                rating: rules::RATING_START,
                wins: 0,
                losses: 0,
                den_wins: 0,
                den_losses: 0,
                won: 0,
                hire_income: 0,
                beasts: Vec::new(),
                items: Vec::new(),
                hires: Vec::new(),
                backing: Vec::new(),
                den_match: None,
                duel: None,
                challenge: None,
            },
        );
        self.essence_supply += rules::STARTING_ESSENCE;
        let token_ids: Vec<String> =
            picks.iter().map(|species| tokens::beast_token(self.mint_beast(&caller, *species))).collect();
        tokens::log_mint(&caller, &token_ids, &[1, 1, 1]);
        self.player_view(&caller)
    }

    /// Adds the attached NEAR to the caller's balance and returns the new balance.
    #[payable]
    pub fn deposit(&mut self) -> U128 {
        let caller = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Attach the NEAR you want to deposit.");
        self.credit(&caller, amount);
        self.deposited += amount;
        U128(self.player(&caller).balance)
    }

    /// Takes `amount` off the caller's balance and sends it to their account.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let caller = env::predecessor_account_id();
        require!(amount.0 > 0, "Name an amount to withdraw.");
        self.debit(&caller, amount.0);
        self.withdrawn += amount.0;
        Promise::new(caller).transfer(NearToken::from_yoctonear(amount.0))
    }
}

// ----- Shared helpers -----------------------------------------------------------

impl Contract {
    fn player(&self, account: &AccountId) -> &Player {
        self.players.get(account).unwrap_or_else(|| fail("Join Maul Street first: pick your three starting beasts."))
    }

    fn player_mut(&mut self, account: &AccountId) -> &mut Player {
        self.players
            .get_mut(account)
            .unwrap_or_else(|| fail("Join Maul Street first: pick your three starting beasts."))
    }

    fn beast(&self, beast_id: u64) -> &Beast {
        self.beasts.get(&beast_id).unwrap_or_else(|| fail("There is no such beast."))
    }

    /// The beast, if the caller owns it.
    fn own_beast_mut(&mut self, beast_id: u64, caller: &AccountId) -> &mut Beast {
        let beast = self.beasts.get_mut(&beast_id).unwrap_or_else(|| fail("There is no such beast."));
        require!(beast.owner == *caller, "Only the beast's owner can do that.");
        beast
    }

    /// Takes NEAR off a player's balance.
    fn debit(&mut self, account: &AccountId, amount: u128) {
        let player = self.player_mut(account);
        require!(player.balance >= amount, "Your balance is too low.");
        player.balance -= amount;
    }

    /// Adds NEAR to a player's balance. Every call is matched by NEAR leaving somewhere else.
    fn credit(&mut self, account: &AccountId, amount: u128) {
        self.player_mut(account).balance += amount;
    }

    /// Gives a player Essence.
    fn award_essence(&mut self, account: &AccountId, amount: u64) {
        self.player_mut(account).essence += amount;
        self.essence_supply += amount;
    }

    /// Creates a level 1 beast and returns its id.
    fn mint_beast(&mut self, owner: &AccountId, species: u8) -> u64 {
        self.last_beast_id += 1;
        let beast_id = self.last_beast_id;
        self.beasts.insert(
            beast_id,
            Beast {
                species,
                name: None,
                owner: owner.clone(),
                level: 1,
                xp: 0,
                relic: 0,
                aura: 0,
                finisher: 0,
                kills: 0,
                fights: 0,
                wins: 0,
                hire_price: None,
                earned: 0,
            },
        );
        self.player_mut(owner).beasts.push(beast_id);
        beast_id
    }

    /// Why this player can't field this squad right now, if they can't. A squad is three
    /// different beasts, each owned by the player or hired with a paid fight left.
    fn squad_problem(&self, account: &AccountId, squad: &[u64; 3]) -> Option<String> {
        if !all_different(squad) {
            return Some("A squad is three different beasts.".to_string());
        }
        let player = self.player(account);
        for beast_id in squad {
            let Some(beast) = self.beasts.get(beast_id) else {
                return Some(format!("There is no beast #{beast_id}."));
            };
            if beast.owner != *account && held(&player.hires, beast_id) == 0 {
                let name = beast.display_name();
                return Some(format!("{name} (#{beast_id}) is not yours to field. Own it, or hire it for a fight."));
            }
        }
        None
    }

    /// Sends a squad into a fight that starts now. Each hired beast in it uses up one paid fight.
    fn field_squad(&mut self, account: &AccountId, squad: &[u64; 3], level_cap: u32) -> Vec<Fighter> {
        if let Some(problem) = self.squad_problem(account, squad) {
            fail(&problem);
        }
        let mut fighters = Vec::with_capacity(squad.len());
        for beast_id in squad {
            let beast = self.beast(*beast_id);
            let hired = beast.owner != *account;
            fighters.push(battle::fighter(&beast.build(*beast_id), level_cap));
            if hired {
                take(&mut self.player_mut(account).hires, beast_id, 1);
            }
        }
        fighters
    }

    /// Writes a finished fight into the record of every beast of a squad and gives each its
    /// XP, which may take it up a level or several. A hired beast learns like any other.
    /// Returns what each beast earned and the level that leaves it at, by slot.
    fn record_fight(&mut self, team: &[Fighter], won: bool, fight_xp: u64) -> ([u64; 3], [u32; 3]) {
        let (mut earned, mut levels) = ([0; 3], [0; 3]);
        for (slot, fighter) in team.iter().enumerate().take(3) {
            let Some(beast) = self.beasts.get_mut(&fighter.token) else { continue };
            beast.fights += 1;
            beast.kills += fighter.kills as u32;
            beast.wins += won as u32;
            earned[slot] = rules::beast_xp(fight_xp, fighter.entered, fighter.kills);
            (beast.level, beast.xp) = rules::add_xp(beast.level, beast.xp, earned[slot]);
            levels[slot] = beast.level;
        }
        (earned, levels)
    }

    /// Stores a match and returns what the game sees of it.
    fn save_match(&mut self, fight: Match) -> MatchView {
        let view = MatchView::of(&fight);
        self.matches.insert(fight.id, fight);
        view
    }

    /// Puts a line at the top of the ticker.
    fn announce(&mut self, text: String) {
        let ticker = self.ticker.get_mut();
        ticker.insert(0, TickerLine { ts: now(), text });
        ticker.truncate(TICKER_LINES);
    }
}

impl Beast {
    /// What the beast brings to a fight.
    fn build(&self, beast_id: u64) -> Build {
        Build {
            token: beast_id,
            species: self.species,
            level: self.level,
            relic: self.relic,
            aura: self.aura,
            finisher: self.finisher,
        }
    }

    /// What its line is called in the form its level gives it.
    fn form_name(&self) -> &'static str {
        data::SPECIES[self.species as usize].forms[rules::form_of(self.level) as usize]
    }

    /// What the beast is called: the name its owner gave it, or else the name of its form.
    fn display_name(&self) -> String {
        self.name.clone().unwrap_or_else(|| self.form_name().to_string())
    }
}

impl DenBook {
    /// How many of its remembered staked fights the den won.
    fn recent_wins(&self) -> u32 {
        self.memory.iter().filter(|won| **won).count() as u32
    }

    /// What a staked win against the den pays right now.
    fn payout_bps(&self) -> u32 {
        rules::den_payout_bps(self.recent_wins(), self.memory.len() as u32)
    }
}

impl Shelf {
    /// The heat left, now that time has passed since the last purchase.
    fn heat_now(&self) -> u32 {
        rules::cooled_heat(self.heat, self.last_buy, now())
    }

    /// The price right now, for something with this floor price.
    fn price(&self, floor: u128) -> u128 {
        rules::heated_price(floor, self.heat_now())
    }

    /// Records a purchase, which heats the price up.
    fn sell(&mut self) {
        self.heat = rules::heat_after_buy(self.heat_now());
        self.last_buy = now();
        self.sold += 1;
    }
}

impl Match {
    fn over(&self) -> bool {
        self.void || self.battle.over()
    }

    /// The account on each side. Side 1 of a den fight has none.
    fn account(&self, side: usize) -> Option<&AccountId> {
        match (side, &self.rival) {
            (0, _) => Some(&self.host),
            (_, Rival::Player(account)) => Some(account),
            (_, Rival::Den(_)) => None,
        }
    }

    /// Adds a step that has just played to the short history the game replays from.
    fn record_step(&mut self, events: &[Event]) {
        self.steps.push(Step { turn: self.battle.turn, events: events_json(events) });
        if self.steps.len() > STEPS_KEPT {
            self.steps.remove(0);
        }
    }

    /// Ends the fight in `winner`'s favour without another step: a forfeit, or a loss on the clock.
    fn concede(&mut self, winner: usize) {
        self.battle.concede(winner);
        self.last_events = events_json(&[Event::Over { winner: winner as u8 }]);
    }
}

/// The current time in Unix seconds.
fn now() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

/// Stops the call with a sentence the game can show as it is.
fn fail(message: &str) -> ! {
    env::panic_str(message)
}

fn all_different<T: PartialEq>(three: &[T; 3]) -> bool {
    three[0] != three[1] && three[0] != three[2] && three[1] != three[2]
}

fn events_json(events: &[Event]) -> String {
    serde_json::to_string(events).unwrap_or_else(|_| fail("The fight's events could not be written down."))
}

/// A NEAR amount as a plain decimal with up to two places, like "0.39". An amount too
/// small to show that way gets a third place.
fn near_text(yocto: u128) -> String {
    let hundredths = (yocto + 5 * rules::MILLI) / (10 * rules::MILLI);
    let (units, places) = if hundredths > 0 { (hundredths, 2) } else { ((yocto + rules::MILLI / 2) / rules::MILLI, 3) };
    let scale = 10u128.pow(places);
    let text = format!("{}.{:0width$}", units / scale, units % scale, width = places as usize);
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// `a * b / c` rounded down, without overflowing on the way. `None` if `c` is zero or the
/// answer does not fit.
fn mul_div(a: u128, b: u128, c: u128) -> Option<u128> {
    if c == 0 {
        return None;
    }
    if let Some(product) = a.checked_mul(b) {
        return Some(product / c);
    }
    // The 256-bit product, as a high and a low half.
    const LOW: u128 = u64::MAX as u128;
    let (a_high, a_low, b_high, b_low) = (a >> 64, a & LOW, b >> 64, b & LOW);
    let (low_low, low_high, high_low) = (a_low * b_low, a_low * b_high, a_high * b_low);
    let middle = (low_low >> 64) + (low_high & LOW) + (high_low & LOW);
    let low = (low_low & LOW) | (middle << 64);
    let high = a_high * b_high + (low_high >> 64) + (high_low >> 64) + (middle >> 64);
    if high >= c {
        return None;
    }
    // Long division, one bit at a time. The remainder always stays below `c`.
    let (mut quotient, mut remainder) = (0u128, high);
    for bit in (0..128).rev() {
        let carried = remainder >> 127 == 1;
        remainder = (remainder << 1) | ((low >> bit) & 1);
        quotient <<= 1;
        if carried || remainder >= c {
            remainder = remainder.wrapping_sub(c);
            quotient |= 1;
        }
    }
    Some(quotient)
}

// A bag is a short list of (thing, how many): an inventory, a set of hires, a den backing.

/// How many of `key` the bag holds.
fn held<K: PartialEq, N: Copy + Default>(bag: &[(K, N)], key: &K) -> N {
    bag.iter().find(|(k, _)| k == key).map_or(N::default(), |(_, count)| *count)
}

/// Adds `amount` of `key` to the bag.
fn put<K: PartialEq, N: Copy + Add<Output = N>>(bag: &mut Vec<(K, N)>, key: K, amount: N) {
    match bag.iter_mut().find(|(k, _)| *k == key) {
        Some((_, count)) => *count = *count + amount,
        None => bag.push((key, amount)),
    }
}

/// Takes `amount` of `key` out of the bag. Returns false, changing nothing, if it holds less.
fn take<K: PartialEq, N: Copy + PartialOrd + Sub<Output = N>>(bag: &mut Vec<(K, N)>, key: &K, amount: N) -> bool {
    let Some(index) = bag.iter().position(|(k, _)| k == key) else {
        return false;
    };
    let count = bag[index].1;
    if count < amount {
        return false;
    }
    if count == amount {
        bag.remove(index);
    } else {
        bag[index].1 = count - amount;
    }
    true
}
