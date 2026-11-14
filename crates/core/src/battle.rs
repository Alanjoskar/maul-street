//! The fight engine.
//!
//! Two squads of three. Each side has one beast in the pit at a time. Both
//! sides choose a move at the same moment and `step` plays the exchange.
//! Instead of a move, a side may swap its beast for another of its living
//! three: the one coming in takes the rival's move. Aspects decide a lot: a
//! beast hits the aspect it beats for double and the one that beats it for
//! half, so sending in the right beast matters. When a beast falls, the
//! winner's beast stays in and the loser sends the next. A side with no beasts
//! left loses.
//!
//! Everything is whole-number arithmetic driven by a seed, so the contract and
//! the browser always agree on what happened.

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

use crate::data::{self, RELIC_WILDFANG, RELIC_HEARTSTONE, RELIC_IRONHIDE, RELIC_LEECH_THORN, RELIC_QUICKENING, RELIC_RAGE_EMBER};
use crate::rules::stat_at_level;

// ----- What a player can send ----------------------------------------------

pub const MOVE_STRIKE: u8 = 0;
pub const MOVE_GUARD: u8 = 1;
pub const MOVE_BREAK: u8 = 2;
pub const MOVE_SPECIAL: u8 = 3;
/// Actions 10, 11 and 12 send the beast in slot 0, 1 or 2 into the pit.
pub const ACT_PICK: u8 = 10;
/// Actions 20, 21 and 22, instead of a move: call the beast in the pit back and
/// send in the one in slot 0, 1 or 2. It takes whatever the rival threw this turn.
pub const ACT_SWAP: u8 = 20;
/// "Nobody": no beast in the pit, or no winner yet.
pub const NONE: u8 = 255;

// ----- The numbers of a fight ----------------------------------------------

/// Hitting the aspect you beat does double. Hitting the one that beats you does half.
pub const ASPECT_STRONG_PCT: u64 = 200;
pub const ASPECT_WEAK_PCT: u64 = 50;

/// Every hit is scaled by this, to set how long a round lasts.
pub const DAMAGE_SCALE_PCT: u64 = 200;

pub const POWER_STRIKE: u64 = 100;
/// A Strike that catches a Break winding up.
pub const POWER_INTERRUPT: u64 = 120;
/// A Strike into a Guard only chips.
pub const POWER_CHIP: u64 = 20;
/// The counter that follows a blocked Strike.
pub const POWER_COUNTER: u64 = 70;
pub const POWER_BREAK: u64 = 130;
/// A Break into a Guard crushes it.
pub const POWER_GUARD_CRUSH: u64 = 150;
pub const POWER_SPECIAL: u64 = 220;
/// A Special into a Guard is halved and leaves no lasting effect.
pub const POWER_SPECIAL_GUARDED: u64 = 110;

pub const CRIT_BASE_PCT: i64 = 8;
pub const CRIT_MIN_PCT: i64 = 3;
pub const CRIT_MAX_PCT: i64 = 30;
pub const CRIT_DAMAGE_PCT: u64 = 150;

/// Burn takes 5% of full health a turn, for three turns.
pub const BURN_PCT: u64 = 5;
pub const BURN_TURNS: u8 = 3;
/// A critical hit leaves the target winded: 3% of full health a turn, for two turns.
pub const BLEED_PCT: u64 = 3;
pub const BLEED_TURNS: u8 = 2;
/// Sunder: defence down 40% for three turns.
pub const SUNDER_DEF_PCT: u64 = 60;
pub const SUNDER_TURNS: u8 = 3;
/// Shock: speed halved for two turns, and 40 Rage lost.
pub const SHOCK_SPD_PCT: u64 = 50;
pub const SHOCK_TURNS: u8 = 2;
pub const SHOCK_RAGE_LOSS: u8 = 40;
/// Soak: attack down 25% for three turns.
pub const SOAK_ATK_PCT: u64 = 75;
pub const SOAK_TURNS: u8 = 3;
/// Leech: the attacker heals for half the damage its Special dealt.
pub const LEECH_PCT: u64 = 50;
/// The Leech Thorn relic heals 12% of all damage dealt.
pub const RELIC_LEECH_PCT: u64 = 12;

/// A beast that wins a round gets 15% of its health back and keeps up to 60 Rage.
pub const SECOND_WIND_PCT: u64 = 15;
pub const RAGE_KEPT: u8 = 60;
/// Rage simmers up 5 a turn on its own.
pub const RAGE_PER_TURN: u8 = 5;
/// After 20 turns in one round every hit does double and nobody may swap, so a
/// round always ends.
pub const SUDDEN_DEATH_TURN: u32 = 20;

// ----- Kinds of hit and effect (as they appear in events) -------------------

pub const HIT_STRIKE: u8 = 0;
pub const HIT_COUNTER: u8 = 1;
pub const HIT_BREAK: u8 = 2;
pub const HIT_SPECIAL: u8 = 3;
pub const HIT_CHIP: u8 = 4;
pub const HIT_INTERRUPT: u8 = 5;
pub const HIT_SPECIAL_GUARDED: u8 = 6;
pub const HIT_GUARD_CRUSH: u8 = 7;
/// A beast worn down by its burn or by being winded.
pub const KO_BURN: u8 = 10;
pub const KO_BLEED: u8 = 11;

pub const ST_BURN: u8 = 0;
pub const ST_BLEED: u8 = 1;
pub const ST_SUNDER: u8 = 2;
pub const ST_SHOCK: u8 = 3;
pub const ST_SOAK: u8 = 4;

/// How one aspect fares against another, in percent.
pub fn aspect_pct(attacker: u8, defender: u8) -> u64 {
    if (attacker + 1) % 5 == defender {
        ASPECT_STRONG_PCT
    } else if (defender + 1) % 5 == attacker {
        ASPECT_WEAK_PCT
    } else {
        100
    }
}

// ----- Beasts in a fight ----------------------------------------------------

/// What a beast brings to a fight: its species, its level and what it wears.
#[derive(Clone, Debug, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct Build {
    /// The beast's token number, or 0 for a house beast.
    pub token: u64,
    pub species: u8,
    /// 1 and up. There is no top level.
    pub level: u32,
    pub relic: u8,
    pub aura: u8,
    pub finisher: u8,
}

#[derive(Clone, Debug, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct Fighter {
    pub token: u64,
    pub species: u8,
    /// The level it fights at (after any level cap). It decides the form it wears.
    pub level: u32,
    pub aspect: u8,
    pub max_hp: u32,
    pub hp: u32,
    pub atk: u32,
    pub def: u32,
    pub spd: u32,
    pub rage: u8,
    pub relic: u8,
    pub aura: u8,
    pub finisher: u8,
    /// Turns left on each lasting effect.
    pub burn: u8,
    pub bleed: u8,
    pub sunder: u8,
    pub shock: u8,
    pub soak: u8,
    /// Beasts this one has put down in this fight.
    pub kills: u8,
    /// Whether it has been sent into the pit in this fight.
    pub entered: bool,
}

/// The level a build fights at. `level_cap` (0 for none) holds it down.
pub fn fighting_level(build: &Build, level_cap: u32) -> u32 {
    let level = build.level.max(1);
    if level_cap > 0 {
        level.min(level_cap)
    } else {
        level
    }
}

/// The four stats of a build: health, attack, defence, speed.
pub fn stats(build: &Build, level_cap: u32) -> [u32; 4] {
    let species = data::species(build.species).unwrap_or(&data::SPECIES[0]);
    let level = fighting_level(build, level_cap);
    let relic = |stat: u32, wearing: u8, pct: u64| -> u32 {
        if build.relic == wearing {
            (stat as u64 * pct / 100).min(u32::MAX as u64) as u32
        } else {
            stat
        }
    };
    [
        relic(stat_at_level(species.hp, level), RELIC_HEARTSTONE, 112),
        relic(stat_at_level(species.atk, level), RELIC_WILDFANG, 110),
        relic(stat_at_level(species.def, level), RELIC_IRONHIDE, 112),
        relic(stat_at_level(species.spd, level), RELIC_QUICKENING, 112),
    ]
}

/// One number for comparing beasts at a glance.
pub fn power(stats: &[u32; 4]) -> u32 {
    let total = stats[0] as u64 / 5 + stats[1] as u64 + stats[2] as u64 + stats[3] as u64;
    total.min(u32::MAX as u64) as u32
}

pub fn fighter(build: &Build, level_cap: u32) -> Fighter {
    let species = data::species(build.species).unwrap_or(&data::SPECIES[0]);
    let [hp, atk, def, spd] = stats(build, level_cap);
    Fighter {
        token: build.token,
        species: species.id,
        level: fighting_level(build, level_cap),
        aspect: species.aspect,
        max_hp: hp,
        hp,
        atk,
        def,
        spd,
        rage: 0,
        relic: build.relic,
        aura: build.aura,
        finisher: build.finisher,
        burn: 0,
        bleed: 0,
        sunder: 0,
        shock: 0,
        soak: 0,
        kills: 0,
        entered: false,
    }
}

// ----- What happened, for the browser to play back --------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "e", rename_all = "snake_case")]
pub enum Event {
    /// A beast enters the pit.
    Pick { side: u8, slot: u8 },
    /// `side` calls its beast back and sends in the one in `slot`, before anything lands.
    Swap { side: u8, slot: u8 },
    /// Both moves, revealed.
    Moves { m: [u8; 2] },
    /// Both guarded. Nothing lands and both gain Rage.
    Standoff,
    /// `by` hit the other side. `hp` is what the target has left. `eff` is 1
    /// when the aspect was strong, -1 when weak.
    Hit { by: u8, kind: u8, dmg: u32, crit: bool, eff: i8, hp: u32 },
    /// A lasting effect lands on `side`.
    Status { side: u8, kind: u8, turns: u8 },
    Heal { side: u8, amt: u32, hp: u32 },
    /// A burn or being winded takes its toll at the end of the turn.
    Dot { side: u8, kind: u8, dmg: u32, hp: u32 },
    /// `side`'s beast is down. `by` is the kind of hit or effect that did it.
    Ko { side: u8, by: u8, slot: u8 },
    /// The round is over. The winner's beast catches its breath.
    RoundEnd { winner: u8, heal: u32, hp: u32 },
    /// Both Rage bars at the end of the turn.
    Rage { r: [u8; 2] },
    Over { winner: u8 },
}

// ----- The seed ---------------------------------------------------------------

/// A small, fast generator. The contract seeds it from NEAR's random seed (or
/// from both duellists' secrets), so nobody can know a roll in advance.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: &[u8], salt: u64) -> Self {
        let mut state: u64 = 0xcbf2_9ce4_8422_2325 ^ salt.wrapping_mul(0x9e37_79b9_7f4a_7c15);
        for byte in seed {
            state ^= *byte as u64;
            state = state.wrapping_mul(0x0000_0100_0000_01b3);
        }
        let mut rng = Rng(state | 1);
        rng.next();
        rng.next();
        rng
    }

    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    /// A whole number from 0 up to, but not including, `n`.
    pub fn below(&mut self, n: u32) -> u32 {
        if n == 0 {
            return 0;
        }
        ((self.next() >> 33) % n as u64) as u32
    }
}

// ----- The fight ----------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct Battle {
    pub teams: [Vec<Fighter>; 2],
    /// The slot each side has in the pit, or NONE.
    pub active: [u8; 2],
    /// Steps played so far.
    pub turn: u32,
    /// Exchanges in the current round.
    pub round_turn: u32,
    /// NONE while the fight is on, then 0 or 1.
    pub winner: u8,
    /// How often each side has used each move. The Reader studies this.
    pub hist: [[u16; 4]; 2],
}

impl Battle {
    pub fn new(a: Vec<Fighter>, b: Vec<Fighter>) -> Self {
        Battle { teams: [a, b], active: [NONE, NONE], turn: 0, round_turn: 0, winner: NONE, hist: [[0; 4]; 2] }
    }

    pub fn over(&self) -> bool {
        self.winner != NONE
    }

    /// Which sides have to act now. Both pick at the start, both move during a
    /// round, and only the side whose beast fell picks after a kill.
    pub fn need(&self) -> [bool; 2] {
        if self.over() {
            return [false, false];
        }
        let picking = [self.active[0] == NONE, self.active[1] == NONE];
        if picking[0] || picking[1] {
            picking
        } else {
            [true, true]
        }
    }

    pub fn fighter(&self, side: usize) -> Option<&Fighter> {
        self.teams[side].get(self.active[side] as usize)
    }

    fn f(&self, side: usize) -> &Fighter {
        &self.teams[side][self.active[side] as usize]
    }

    fn f_mut(&mut self, side: usize) -> &mut Fighter {
        let slot = self.active[side] as usize;
        &mut self.teams[side][slot]
    }

    pub fn alive(&self, side: usize) -> usize {
        self.teams[side].iter().filter(|f| f.hp > 0).count()
    }

    /// Checks one side's action without changing anything.
    pub fn check(&self, side: usize, act: u8) -> Result<(), &'static str> {
        if !self.need()[side] {
            return Err("It is not your turn to act.");
        }
        if self.active[side] == NONE {
            let slot = act.wrapping_sub(ACT_PICK) as usize;
            if act < ACT_PICK || slot >= self.teams[side].len() {
                return Err("Choose which beast to send in.");
            }
            if self.teams[side][slot].hp == 0 {
                return Err("That beast is already down.");
            }
            return Ok(());
        }
        match act {
            MOVE_STRIKE | MOVE_GUARD | MOVE_BREAK => Ok(()),
            MOVE_SPECIAL => {
                if self.f(side).rage >= 100 {
                    Ok(())
                } else {
                    Err("The Special needs a full Rage bar.")
                }
            }
            swap if swap >= ACT_SWAP && ((swap - ACT_SWAP) as usize) < self.teams[side].len() => {
                let slot = swap - ACT_SWAP;
                if slot == self.active[side] {
                    Err("That beast is already in the pit.")
                } else if self.teams[side][slot as usize].hp == 0 {
                    Err("That beast is already down.")
                } else if self.round_turn >= SUDDEN_DEATH_TURN {
                    Err("Sudden death: no more swapping this round.")
                } else {
                    Ok(())
                }
            }
            _ => Err("Unknown move."),
        }
    }

    /// Plays one step: picks if a side has no beast in the pit, otherwise one
    /// exchange of moves. Returns what happened, in order.
    pub fn step(&mut self, acts: [Option<u8>; 2], seed: &[u8]) -> Result<Vec<Event>, &'static str> {
        let need = self.need();
        for side in 0..2 {
            match (need[side], acts[side]) {
                (true, Some(act)) => self.check(side, act)?,
                (true, None) => return Err("An action is missing."),
                (false, Some(_)) => return Err("It is not your turn to act."),
                (false, None) => {}
            }
        }
        let mut events = Vec::new();
        let mut rng = Rng::new(seed, self.turn as u64);
        if self.active[0] == NONE || self.active[1] == NONE {
            for side in 0..2 {
                if let (true, Some(act)) = (need[side], acts[side]) {
                    let slot = act - ACT_PICK;
                    self.active[side] = slot;
                    self.teams[side][slot as usize].entered = true;
                    events.push(Event::Pick { side: side as u8, slot });
                }
            }
            self.round_turn = 0;
        } else {
            self.exchange([acts[0].unwrap_or(MOVE_STRIKE), acts[1].unwrap_or(MOVE_STRIKE)], &mut rng, &mut events);
        }
        self.turn += 1;
        Ok(events)
    }

    fn speed(&self, side: usize) -> u64 {
        let f = self.f(side);
        f.spd as u64 * if f.shock > 0 { SHOCK_SPD_PCT } else { 100 } / 100
    }

    fn exchange(&mut self, m: [u8; 2], rng: &mut Rng, events: &mut Vec<Event>) {
        self.round_turn += 1;
        for side in 0..2 {
            if m[side] <= MOVE_SPECIAL {
                let used = &mut self.hist[side][m[side] as usize];
                *used = used.saturating_add(1);
            }
            // A Special spends the whole bar, whatever it meets.
            if m[side] == MOVE_SPECIAL {
                self.f_mut(side).rage = 0;
            }
        }
        events.push(Event::Moves { m });

        // Swaps happen before anything lands: the beast coming in takes the rival's move.
        // A swapping side throws nothing this turn (it falls through `plan` below).
        for side in 0..2 {
            if m[side] >= ACT_SWAP {
                let slot = m[side] - ACT_SWAP;
                self.active[side] = slot;
                self.teams[side][slot as usize].entered = true;
                events.push(Event::Swap { side: side as u8, slot });
            }
        }

        let (speed_a, speed_b) = (self.speed(0), self.speed(1));
        let faster = if speed_a > speed_b {
            0
        } else if speed_b > speed_a {
            1
        } else {
            rng.below(2) as usize
        };

        // What each side's move becomes against the other's: (kind, power, leaves its mark).
        let plan = |side: usize| -> Option<(u8, u64, bool)> {
            match (m[side], m[1 - side]) {
                (MOVE_STRIKE, MOVE_GUARD) => Some((HIT_CHIP, POWER_CHIP, false)),
                (MOVE_STRIKE, MOVE_BREAK) => Some((HIT_INTERRUPT, POWER_INTERRUPT, false)),
                (MOVE_STRIKE, _) => Some((HIT_STRIKE, POWER_STRIKE, false)),
                (MOVE_GUARD, MOVE_STRIKE) => Some((HIT_COUNTER, POWER_COUNTER, false)),
                (MOVE_GUARD, _) => None,
                // A Break is too slow against a Strike: it never lands.
                (MOVE_BREAK, MOVE_STRIKE) => None,
                (MOVE_BREAK, MOVE_GUARD) => Some((HIT_GUARD_CRUSH, POWER_GUARD_CRUSH, false)),
                (MOVE_BREAK, _) => Some((HIT_BREAK, POWER_BREAK, false)),
                (MOVE_SPECIAL, MOVE_GUARD) => Some((HIT_SPECIAL_GUARDED, POWER_SPECIAL_GUARDED, false)),
                (MOVE_SPECIAL, _) => Some((HIT_SPECIAL, POWER_SPECIAL, true)),
                _ => None,
            }
        };

        // The faster beast lands first, except that a blocked Strike always
        // comes before its counter, and a Special always beats a Break to the hit.
        let mut order = [faster, 1 - faster];
        for side in 0..2 {
            let leads = (m[side] == MOVE_STRIKE && m[1 - side] == MOVE_GUARD)
                || (m[side] == MOVE_SPECIAL && m[1 - side] == MOVE_BREAK);
            if leads {
                order = [side, 1 - side];
            }
        }

        if m[0] == MOVE_GUARD && m[1] == MOVE_GUARD {
            events.push(Event::Standoff);
            for side in 0..2 {
                self.add_rage(side, 10);
            }
        }

        let mut fallen: Option<(usize, u8)> = None;
        for side in order {
            if fallen.is_some() {
                break;
            }
            if let Some((kind, power, marks)) = plan(side) {
                fallen = self.hit(side, kind, power, marks, rng, events);
            }
        }

        // No knockout this turn: burns and winding take their toll, slower beast first.
        if fallen.is_none() {
            for side in [1 - faster, faster] {
                fallen = self.toll(side, events);
                if fallen.is_some() {
                    break;
                }
            }
        }

        match fallen {
            Some((side, by)) => self.fell(side, by, events),
            None => {
                for side in 0..2 {
                    let f = self.f_mut(side);
                    f.burn = f.burn.saturating_sub(1);
                    f.bleed = f.bleed.saturating_sub(1);
                    f.sunder = f.sunder.saturating_sub(1);
                    f.shock = f.shock.saturating_sub(1);
                    f.soak = f.soak.saturating_sub(1);
                    f.rage = f.rage.saturating_add(RAGE_PER_TURN).min(100);
                }
                events.push(Event::Rage { r: [self.f(0).rage, self.f(1).rage] });
            }
        }
    }

    fn add_rage(&mut self, side: usize, amount: u64) {
        let f = self.f_mut(side);
        let amount = if f.relic == RELIC_RAGE_EMBER { amount * 125 / 100 } else { amount };
        f.rage = (f.rage as u64 + amount).min(100) as u8;
    }

    /// One hit lands. Returns the side that fell, if the target died.
    fn hit(&mut self, by: usize, kind: u8, power: u64, marks: bool, rng: &mut Rng, events: &mut Vec<Event>) -> Option<(usize, u8)> {
        let target = 1 - by;
        let attacker = self.f(by).clone();
        let defender = self.f(target).clone();

        let attack = attacker.atk as u64 * if attacker.soak > 0 { SOAK_ATK_PCT } else { 100 } / 100;
        let defence = defender.def as u64 * if defender.sunder > 0 { SUNDER_DEF_PCT } else { 100 } / 100;
        let aspect = aspect_pct(attacker.aspect, defender.aspect);

        let mut damage = attack * power / 100 * DAMAGE_SCALE_PCT / 100;
        damage = damage * 100 / (100 + defence);
        damage = damage * aspect / 100;
        damage = damage * (90 + rng.below(21) as u64) / 100;

        // A blocked hit never finds a weak spot.
        let blocked = kind == HIT_CHIP || kind == HIT_SPECIAL_GUARDED;
        let mut crit = false;
        if !blocked {
            let edge = (self.speed(by) as i64 - self.speed(target) as i64) / 4;
            let chance = (CRIT_BASE_PCT + edge).clamp(CRIT_MIN_PCT, CRIT_MAX_PCT);
            crit = (rng.below(100) as i64) < chance;
            if crit {
                damage = damage * CRIT_DAMAGE_PCT / 100;
            }
        }
        if self.round_turn > SUDDEN_DEATH_TURN {
            damage *= 2;
        }
        let damage = damage.max(1).min(defender.hp as u64) as u32;

        self.f_mut(target).hp -= damage;
        let left = self.f(target).hp;
        let eff = if aspect > 100 {
            1
        } else if aspect < 100 {
            -1
        } else {
            0
        };
        events.push(Event::Hit { by: by as u8, kind, dmg: damage, crit, eff, hp: left });

        // Rage: for landing it, and for taking it.
        let earned = match kind {
            HIT_STRIKE => 18,
            HIT_INTERRUPT => 20,
            HIT_COUNTER | HIT_BREAK | HIT_GUARD_CRUSH => 14,
            HIT_CHIP => 6,
            _ => 0,
        };
        self.add_rage(by, earned);
        if left > 0 {
            let pain = (damage as u64 * 80 / defender.max_hp.max(1) as u64 + 2).min(35);
            // A clean block fires the blocker up.
            self.add_rage(target, pain + if kind == HIT_CHIP { 15 } else { 0 });
        }

        if attacker.relic == RELIC_LEECH_THORN {
            self.heal(by, damage as u64 * RELIC_LEECH_PCT / 100, events);
        }
        if left == 0 {
            return Some((target, kind));
        }
        if crit {
            self.f_mut(target).bleed = BLEED_TURNS;
            events.push(Event::Status { side: target as u8, kind: ST_BLEED, turns: BLEED_TURNS });
        }
        if marks {
            match attacker.aspect {
                data::ASPECT_EMBER => {
                    self.f_mut(target).burn = BURN_TURNS;
                    events.push(Event::Status { side: target as u8, kind: ST_BURN, turns: BURN_TURNS });
                }
                data::ASPECT_THORN => {
                    self.heal(by, damage as u64 * LEECH_PCT / 100, events);
                }
                data::ASPECT_STONE => {
                    // One more than it lasts, because effects fade at the end of this turn too.
                    self.f_mut(target).sunder = SUNDER_TURNS + 1;
                    events.push(Event::Status { side: target as u8, kind: ST_SUNDER, turns: SUNDER_TURNS });
                }
                data::ASPECT_STORM => {
                    let f = self.f_mut(target);
                    f.shock = SHOCK_TURNS + 1;
                    f.rage = f.rage.saturating_sub(SHOCK_RAGE_LOSS);
                    events.push(Event::Status { side: target as u8, kind: ST_SHOCK, turns: SHOCK_TURNS });
                }
                _ => {
                    self.f_mut(target).soak = SOAK_TURNS + 1;
                    events.push(Event::Status { side: target as u8, kind: ST_SOAK, turns: SOAK_TURNS });
                }
            }
        }
        None
    }

    fn heal(&mut self, side: usize, amount: u64, events: &mut Vec<Event>) {
        let f = self.f_mut(side);
        let amount = amount.min((f.max_hp - f.hp) as u64) as u32;
        if amount == 0 {
            return;
        }
        f.hp += amount;
        let hp = f.hp;
        events.push(Event::Heal { side: side as u8, amt: amount, hp });
    }

    /// Burn, then winded. Returns the side if its beast was worn down by them.
    fn toll(&mut self, side: usize, events: &mut Vec<Event>) -> Option<(usize, u8)> {
        for (kind, pct, by) in [(ST_BURN, BURN_PCT, KO_BURN), (ST_BLEED, BLEED_PCT, KO_BLEED)] {
            let f = self.f_mut(side);
            let turns = if kind == ST_BURN { f.burn } else { f.bleed };
            if turns == 0 {
                continue;
            }
            let damage = ((f.max_hp as u64 * pct / 100).max(1) as u32).min(f.hp);
            f.hp -= damage;
            let hp = f.hp;
            events.push(Event::Dot { side: side as u8, kind, dmg: damage, hp });
            if hp == 0 {
                return Some((side, by));
            }
        }
        None
    }

    /// A beast is down. The other side's beast catches its breath, or wins it all.
    fn fell(&mut self, side: usize, by: u8, events: &mut Vec<Event>) {
        let winner = 1 - side;
        events.push(Event::Ko { side: side as u8, by, slot: self.active[side] });
        self.active[side] = NONE;
        self.round_turn = 0;
        let victor = self.f_mut(winner);
        victor.kills = victor.kills.saturating_add(1);
        if self.alive(side) == 0 {
            self.winner = winner as u8;
            events.push(Event::Over { winner: winner as u8 });
            return;
        }
        let victor = self.f_mut(winner);
        let heal = ((victor.max_hp as u64 * SECOND_WIND_PCT / 100) as u32).min(victor.max_hp - victor.hp);
        victor.hp += heal;
        victor.burn = 0;
        victor.bleed = 0;
        victor.sunder = 0;
        victor.shock = 0;
        victor.soak = 0;
        victor.rage = victor.rage.min(RAGE_KEPT);
        let hp = victor.hp;
        events.push(Event::RoundEnd { winner: winner as u8, heal, hp });
    }

    /// Ends the fight at once in `winner`'s favour (a forfeit or a timeout).
    pub fn concede(&mut self, winner: usize) {
        self.winner = winner as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn squad(species: [u8; 3]) -> Vec<Fighter> {
        species
            .iter()
            .map(|s| fighter(&Build { token: 0, species: *s, level: 1, relic: 0, aura: 0, finisher: 0 }, 0))
            .collect()
    }

    fn started(a: [u8; 3], b: [u8; 3]) -> Battle {
        let mut battle = Battle::new(squad(a), squad(b));
        battle.step([Some(ACT_PICK), Some(ACT_PICK)], b"seed").unwrap();
        battle
    }

    fn hits(events: &[Event]) -> Vec<(u8, u8)> {
        events
            .iter()
            .filter_map(|e| match e {
                Event::Hit { by, kind, .. } => Some((*by, *kind)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn the_ring_of_aspects() {
        assert_eq!(aspect_pct(0, 1), 200);
        assert_eq!(aspect_pct(1, 0), 50);
        assert_eq!(aspect_pct(4, 0), 200);
        assert_eq!(aspect_pct(0, 4), 50);
        assert_eq!(aspect_pct(0, 2), 100);
        assert_eq!(aspect_pct(3, 3), 100);
    }

    #[test]
    fn a_swap_comes_in_and_takes_the_hit() {
        let mut battle = started([0, 1, 2], [3, 4, 0]);
        let events = battle.step([Some(ACT_SWAP + 2), Some(MOVE_STRIKE)], b"w").unwrap();
        assert!(events.contains(&Event::Swap { side: 0, slot: 2 }));
        assert_eq!(battle.active[0], 2);
        assert!(battle.teams[0][2].entered);
        // Only the rival lands anything, and it lands on the beast that came in.
        assert_eq!(hits(&events), vec![(1, HIT_STRIKE)]);
        assert!(battle.teams[0][2].hp < battle.teams[0][2].max_hp);
        assert_eq!(battle.teams[0][0].hp, battle.teams[0][0].max_hp);
        // A swap is not a move: the Reader does not count it.
        assert_eq!(battle.hist[0], [0, 0, 0, 0]);
    }

    #[test]
    fn a_swap_into_a_guard_or_a_swap_is_quiet() {
        let mut battle = started([0, 1, 2], [3, 4, 0]);
        let events = battle.step([Some(ACT_SWAP + 1), Some(MOVE_GUARD)], b"w").unwrap();
        assert!(hits(&events).is_empty());
        let events = battle.step([Some(ACT_SWAP), Some(ACT_SWAP + 2)], b"w").unwrap();
        assert!(hits(&events).is_empty());
        assert_eq!(battle.active, [0, 2]);
        assert!(events.contains(&Event::Swap { side: 0, slot: 0 }) && events.contains(&Event::Swap { side: 1, slot: 2 }));
    }

    #[test]
    fn a_break_lands_on_a_beast_coming_in() {
        let mut battle = started([0, 1, 2], [3, 4, 0]);
        let events = battle.step([Some(MOVE_BREAK), Some(ACT_SWAP + 1)], b"w").unwrap();
        assert_eq!(hits(&events), vec![(0, HIT_BREAK)]);
    }

    #[test]
    fn who_can_swap_in() {
        let mut battle = started([0, 1, 2], [3, 4, 0]);
        assert_eq!(battle.check(0, ACT_SWAP), Err("That beast is already in the pit."));
        battle.teams[0][1].hp = 0;
        assert_eq!(battle.check(0, ACT_SWAP + 1), Err("That beast is already down."));
        assert_eq!(battle.check(0, ACT_SWAP + 3), Err("Unknown move."));
        assert!(battle.check(0, ACT_SWAP + 2).is_ok());
        battle.round_turn = SUDDEN_DEATH_TURN;
        assert_eq!(battle.check(0, ACT_SWAP + 2), Err("Sudden death: no more swapping this round."));
        // Nobody swaps while picking.
        let fresh = Battle::new(squad([0, 1, 2]), squad([3, 4, 0]));
        assert!(fresh.check(0, ACT_SWAP + 1).is_err());
    }

    #[test]
    fn the_right_beast_hits_far_harder() {
        // Tide (4) beats Ember (0): the same Strike from the same beast lands double on
        // Ember and half on Storm (3), which beats Tide.
        let strike_on = |foe: u8| -> u32 {
            let mut battle = started([4, 4, 4], [foe, foe, foe]);
            let events = battle.step([Some(MOVE_STRIKE), Some(MOVE_STRIKE)], b"d").unwrap();
            events
                .iter()
                .find_map(|e| match e {
                    Event::Hit { by: 0, dmg, eff, .. } => Some((*dmg, *eff)),
                    _ => None,
                })
                .map(|(dmg, eff)| {
                    assert_eq!(eff, if foe == 0 { 1 } else if foe == 3 { -1 } else { 0 });
                    dmg
                })
                .unwrap()
        };
        // Four times as hard before the dice and the defences: at least twice after them.
        let (strong, weak) = (strike_on(0), strike_on(3));
        assert!(strong >= weak * 2, "strong {strong}, weak {weak}");
    }

    #[test]
    fn both_pick_first() {
        let mut battle = Battle::new(squad([0, 1, 2]), squad([3, 4, 0]));
        assert_eq!(battle.need(), [true, true]);
        assert!(battle.step([Some(MOVE_STRIKE), Some(ACT_PICK)], b"s").is_err());
        assert!(battle.step([Some(ACT_PICK + 3), Some(ACT_PICK)], b"s").is_err());
        let events = battle.step([Some(ACT_PICK + 1), Some(ACT_PICK + 2)], b"s").unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(battle.active, [1, 2]);
        assert_eq!(battle.need(), [true, true]);
        assert!(battle.teams[0][1].entered && !battle.teams[0][0].entered);
    }

    #[test]
    fn strike_beats_break() {
        let mut battle = started([0, 1, 2], [0, 1, 2]);
        let events = battle.step([Some(MOVE_STRIKE), Some(MOVE_BREAK)], b"a").unwrap();
        assert_eq!(hits(&events), vec![(0, HIT_INTERRUPT)]);
    }

    #[test]
    fn guard_beats_strike() {
        let mut battle = started([0, 1, 2], [0, 1, 2]);
        let events = battle.step([Some(MOVE_STRIKE), Some(MOVE_GUARD)], b"a").unwrap();
        assert_eq!(hits(&events), vec![(0, HIT_CHIP), (1, HIT_COUNTER)]);
    }

    #[test]
    fn break_beats_guard() {
        let mut battle = started([0, 1, 2], [0, 1, 2]);
        let events = battle.step([Some(MOVE_GUARD), Some(MOVE_BREAK)], b"a").unwrap();
        assert_eq!(hits(&events), vec![(1, HIT_GUARD_CRUSH)]);
    }

    #[test]
    fn two_guards_stand_off() {
        let mut battle = started([0, 1, 2], [0, 1, 2]);
        let events = battle.step([Some(MOVE_GUARD), Some(MOVE_GUARD)], b"a").unwrap();
        assert!(events.contains(&Event::Standoff));
        assert!(hits(&events).is_empty());
        assert_eq!(battle.f(0).rage, 15);
    }

    #[test]
    fn special_needs_rage_and_leaves_a_mark() {
        let mut battle = started([0, 1, 2], [2, 1, 0]);
        assert!(battle.step([Some(MOVE_SPECIAL), Some(MOVE_STRIKE)], b"a").is_err());
        battle.f_mut(0).rage = 100;
        let events = battle.step([Some(MOVE_SPECIAL), Some(MOVE_BREAK)], b"a").unwrap();
        // The Special lands before the Break, and Ember leaves a burn.
        assert_eq!(hits(&events)[0], (0, HIT_SPECIAL));
        assert!(events.iter().any(|e| matches!(e, Event::Status { side: 1, kind: ST_BURN, .. })));
        assert!(events.iter().any(|e| matches!(e, Event::Dot { side: 1, kind: ST_BURN, .. })));
        assert!(battle.f(0).rage < 100);
    }

    #[test]
    fn guard_halves_a_special() {
        let mut battle = started([0, 1, 2], [2, 1, 0]);
        battle.f_mut(0).rage = 100;
        let events = battle.step([Some(MOVE_SPECIAL), Some(MOVE_GUARD)], b"a").unwrap();
        assert_eq!(hits(&events), vec![(0, HIT_SPECIAL_GUARDED)]);
        assert!(!events.iter().any(|e| matches!(e, Event::Status { .. })));
    }

    #[test]
    fn winner_stays_and_loser_picks() {
        let mut battle = started([0, 1, 2], [0, 1, 2]);
        battle.f_mut(1).hp = 1;
        let events = battle.step([Some(MOVE_STRIKE), Some(MOVE_STRIKE)], b"zz").unwrap();
        // Whoever is faster this turn, side 1 has 1 health and side 0 has plenty.
        assert!(events.iter().any(|e| matches!(e, Event::Ko { side: 1, .. })));
        assert!(events.iter().any(|e| matches!(e, Event::RoundEnd { winner: 0, .. })));
        assert_eq!(battle.active[1], NONE);
        assert_eq!(battle.need(), [false, true]);
        assert!(battle.step([None, Some(ACT_PICK)], b"zz").is_err(), "a fallen beast can't come back");
        battle.step([None, Some(ACT_PICK + 2)], b"zz").unwrap();
        assert_eq!(battle.active, [0, 2]);
        assert_eq!(battle.teams[0][0].kills, 1);
    }

    #[test]
    fn last_beast_down_ends_it() {
        let mut battle = started([0, 1, 2], [0, 1, 2]);
        battle.teams[1][1].hp = 0;
        battle.teams[1][2].hp = 0;
        battle.f_mut(1).hp = 1;
        let events = battle.step([Some(MOVE_STRIKE), Some(MOVE_GUARD)], b"q").unwrap();
        assert!(events.contains(&Event::Over { winner: 0 }));
        assert_eq!(battle.winner, 0);
        assert_eq!(battle.need(), [false, false]);
    }

    #[test]
    fn relics_change_the_numbers() {
        let plain = Build { token: 1, species: 0, level: 1, relic: 0, aura: 0, finisher: 0 };
        let fanged = Build { relic: RELIC_WILDFANG, ..plain.clone() };
        assert_eq!(stats(&plain, 0)[1], 78);
        assert_eq!(stats(&fanged, 0)[1], 85);
        let ranked = Build { level: 11, ..plain.clone() };
        assert_eq!(stats(&ranked, 0), [533, 101, 62, 80]);
        assert_eq!(stats(&ranked, 6), [471, 89, 55, 71]);
        assert_eq!(fighter(&ranked, 6).level, 6);
        assert_eq!(fighter(&ranked, 0).level, 11);
    }

    #[test]
    fn events_read_as_json() {
        let json = serde_json::to_string(&Event::Hit { by: 0, kind: 3, dmg: 91, crit: true, eff: 1, hp: 40 }).unwrap();
        assert_eq!(json, r#"{"e":"hit","by":0,"kind":3,"dmg":91,"crit":true,"eff":1,"hp":40}"#);
        let json = serde_json::to_string(&Event::Swap { side: 1, slot: 2 }).unwrap();
        assert_eq!(json, r#"{"e":"swap","side":1,"slot":2}"#);
    }
}
