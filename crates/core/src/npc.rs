//! How the house fighters think.
//!
//! Each den has a style. A style is a set of weights over the four moves that
//! shifts with what is happening in the pit. The contract rolls against those
//! weights with NEAR's random seed, in the same transaction that carries the
//! player's move, so the den can't see the player's choice and the player can't
//! see the den's.

use crate::battle::{aspect_pct, Battle, Fighter, Rng, ACT_PICK, ACT_SWAP, MOVE_BREAK, MOVE_GUARD, MOVE_STRIKE, NONE, SUDDEN_DEATH_TURN};
use crate::data::{STYLE_BRAWLER, STYLE_CLOSER, STYLE_GAMBLER, STYLE_READER, STYLE_WALL};

/// The weights a den gives Strike, Guard, Break and Special right now.
pub fn move_weights(battle: &Battle, side: usize, style: u8) -> [u32; 4] {
    let (me, foe) = match (battle.fighter(side), battle.fighter(1 - side)) {
        (Some(me), Some(foe)) => (me, foe),
        _ => return [1, 0, 0, 0],
    };
    let foe_hist = battle.hist[1 - side];
    let foe_moves: u32 = foe_hist.iter().map(|n| *n as u32).sum();

    // Strike, Guard, Break.
    let mut w: [u32; 3] = match style {
        STYLE_BRAWLER => [60, 12, 28],
        STYLE_WALL => [25, 50, 25],
        STYLE_GAMBLER => [34, 18, 48],
        STYLE_READER => {
            // Counter whatever the challenger has leaned on so far:
            // Guard answers Strike, Break answers Guard, Strike answers Break.
            if foe_moves < 2 {
                [34, 33, 33]
            } else {
                let lean = |m: u8| 12 + 60 * foe_hist[m as usize] as u32 / foe_moves;
                [lean(MOVE_BREAK), lean(MOVE_STRIKE), lean(MOVE_GUARD)]
            }
        }
        _ => {
            if foe.rage >= 100 {
                // A Special is coming, or a Break to punish the guard it invites.
                [30, 45, 25]
            } else if me.hp * 100 / me.max_hp.max(1) < 30 {
                [36, 40, 24]
            } else {
                [38, 27, 35]
            }
        }
    };

    // Everyone but the two simplest dens goes for the throat when one Strike would end it.
    if style >= STYLE_GAMBLER {
        let strike = me.atk as u64 * 100 / (100 + foe.def as u64) * aspect_pct(me.aspect, foe.aspect) / 100;
        if strike * 9 / 10 >= foe.hp as u64 {
            w[0] += 60;
        }
    }

    let mut special = 0;
    if me.rage >= 100 {
        // How readily each style spends a full Rage bar, out of 100.
        let eager: u32 = match style {
            STYLE_BRAWLER => 75,
            STYLE_WALL => 45,
            STYLE_GAMBLER => 50,
            STYLE_READER => {
                // Hold it against someone who guards a lot.
                if foe_moves >= 3 && foe_hist[MOVE_GUARD as usize] as u32 * 100 / foe_moves > 40 {
                    25
                } else {
                    60
                }
            }
            _ => 55,
        };
        let rest: u32 = w.iter().sum();
        special = rest * eager / (100 - eager);
    }
    [w[0], w[1], w[2], special]
}

/// The den's move for this exchange.
pub fn npc_move(battle: &Battle, side: usize, style: u8, rng: &mut Rng) -> u8 {
    let weights = move_weights(battle, side, style);
    let total: u32 = weights.iter().sum();
    let mut roll = rng.below(total.max(1));
    for (m, weight) in weights.iter().enumerate() {
        if roll < *weight {
            return m as u8;
        }
        roll -= weight;
    }
    MOVE_STRIKE
}

/// Which beast the den sends in next, as an action (ACT_PICK + slot).
pub fn npc_pick(battle: &Battle, side: usize, style: u8, rng: &mut Rng) -> u8 {
    let living: Vec<usize> = (0..battle.teams[side].len()).filter(|slot| battle.teams[side][*slot].hp > 0).collect();
    if living.is_empty() {
        return ACT_PICK;
    }
    let random = living[rng.below(living.len() as u32) as usize];
    let foe_slot = battle.active[1 - side];
    if foe_slot == NONE {
        return ACT_PICK + random as u8;
    }
    // Sharper dens pick the better match-up more often.
    let care: u32 = match style {
        STYLE_BRAWLER => 35,
        STYLE_WALL => 55,
        STYLE_GAMBLER => 50,
        STYLE_READER => 85,
        STYLE_CLOSER => 95,
        _ => 50,
    };
    if rng.below(100) >= care {
        return ACT_PICK + random as u8;
    }
    let foe = &battle.teams[1 - side][foe_slot as usize];
    let score = |slot: usize| -> i64 {
        let mine = &battle.teams[side][slot];
        aspect_pct(mine.aspect, foe.aspect) as i64 - aspect_pct(foe.aspect, mine.aspect) as i64
    };
    let best = living.iter().copied().max_by_key(|slot| score(*slot)).unwrap_or(random);
    ACT_PICK + best as u8
}

/// How a beast fares against the rival in the pit: positive when its aspect beats the
/// rival's, negative when the rival's beats it, 0 for an even match-up.
fn match_up(mine: &Fighter, foe: &Fighter) -> i64 {
    aspect_pct(mine.aspect, foe.aspect) as i64 - aspect_pct(foe.aspect, mine.aspect) as i64
}

/// Whether the den calls its beast back for a better match-up this turn, as an action
/// (ACT_SWAP + slot). Every den swaps out of a losing match-up some of the time; the
/// sharper ones also swap in a beast that has the edge.
pub fn npc_swap(battle: &Battle, side: usize, style: u8, rng: &mut Rng) -> Option<u8> {
    let (mine, theirs) = (battle.active[side], battle.active[1 - side]);
    if mine == NONE || theirs == NONE || battle.round_turn >= SUDDEN_DEATH_TURN {
        return None;
    }
    let foe = &battle.teams[1 - side][theirs as usize];
    let now = match_up(&battle.teams[side][mine as usize], foe);
    let best = (0..battle.teams[side].len())
        .filter(|slot| *slot != mine as usize && battle.teams[side][*slot].hp > 0)
        .max_by_key(|slot| match_up(&battle.teams[side][*slot], foe))?;
    let better = match_up(&battle.teams[side][best], foe);
    if better <= now {
        return None;
    }
    // Out of 100, how readily each style swaps: out of a bad match-up, and into a good one.
    let (escape, press): (u32, u32) = match style {
        STYLE_BRAWLER => (20, 0),
        STYLE_WALL => (35, 0),
        STYLE_GAMBLER => (30, 10),
        STYLE_READER => (55, 20),
        STYLE_CLOSER => (65, 30),
        _ => (30, 0),
    };
    let chance = if now < 0 { escape } else { press };
    (rng.below(100) < chance).then_some(ACT_SWAP + best as u8)
}

/// The den's action, whatever the fight needs from it now.
pub fn npc_action(battle: &Battle, side: usize, style: u8, rng: &mut Rng) -> u8 {
    if battle.active[side] == NONE {
        npc_pick(battle, side, style, rng)
    } else if let Some(swap) = npc_swap(battle, side, style, rng) {
        swap
    } else {
        npc_move(battle, side, style, rng)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::battle::{fighter, Build, Fighter, MOVE_SPECIAL};
    use crate::data::{DENS, SPECIES};

    fn squad(species: [u8; 3], rank: u32) -> Vec<Fighter> {
        species
            .iter()
            .map(|s| fighter(&Build { token: 0, species: *s, level: rank + 1, relic: 0, aura: 0, finisher: 0 }, 0))
            .collect()
    }

    /// Two styles fight it out. Returns the winner and the number of steps.
    fn bout(a: [u8; 3], style_a: u8, b: [u8; 3], style_b: u8, seed: u64) -> (u8, u32) {
        let mut battle = Battle::new(squad(a, 0), squad(b, 0));
        let mut steps = 0;
        while !battle.over() {
            let seed_bytes = (seed * 1_000 + steps as u64).to_le_bytes();
            let mut rng = Rng::new(&seed_bytes, 7);
            let need = battle.need();
            let acts = [
                need[0].then(|| npc_action(&battle, 0, style_a, &mut rng)),
                need[1].then(|| npc_action(&battle, 1, style_b, &mut rng)),
            ];
            battle.step(acts, &seed_bytes).expect("a den never makes an illegal move");
            steps += 1;
            assert!(steps < 400, "a fight must end");
        }
        (battle.winner, steps)
    }

    #[test]
    fn every_den_can_finish_a_fight_against_every_other() {
        let mut longest = 0;
        let mut total = 0;
        let mut fights = 0;
        for a in DENS.iter() {
            for b in DENS.iter() {
                for seed in 0..20 {
                    let (_, steps) = bout(a.squad, a.style, b.squad, b.style, seed);
                    longest = longest.max(steps);
                    total += steps;
                    fights += 1;
                }
            }
        }
        println!("fights: {fights}, average steps: {}, longest: {longest}", total / fights);
        assert!(longest < 200);
    }

    #[test]
    fn no_species_is_hopeless() {
        // Every species leads a mirrored squad against every other, both sides
        // playing the same balanced style. Nobody should win almost never.
        let mut wins = [0u32; 10];
        let mut games = [0u32; 10];
        for a in 0..10u8 {
            for b in 0..10u8 {
                if a == b {
                    continue;
                }
                for seed in 0..30 {
                    let (winner, _) = bout([a, a, a], STYLE_CLOSER, [b, b, b], STYLE_CLOSER, seed);
                    games[a as usize] += 1;
                    games[b as usize] += 1;
                    if winner == 0 {
                        wins[a as usize] += 1;
                    } else {
                        wins[b as usize] += 1;
                    }
                }
            }
        }
        for s in SPECIES.iter() {
            let rate = wins[s.id as usize] * 100 / games[s.id as usize];
            println!("{:<12} wins {rate}%", s.name);
            assert!(rate >= 22 && rate <= 78, "{} wins {rate}% of mirrored fights", s.name);
        }
    }

    #[test]
    fn the_reader_punishes_a_habit() {
        // Against a challenger who only ever Strikes, the Reader should lean on Guard.
        let mut battle = Battle::new(squad([0, 1, 2], 0), squad([4, 7, 6], 0));
        battle.step([Some(ACT_PICK), Some(ACT_PICK)], b"x").unwrap();
        battle.hist[0] = [9, 0, 0, 0];
        let w = move_weights(&battle, 1, STYLE_READER);
        assert!(w[MOVE_GUARD as usize] > w[MOVE_STRIKE as usize] * 3);
        assert_eq!(w[MOVE_SPECIAL as usize], 0);
    }

    #[test]
    fn a_den_swaps_out_of_a_bad_match_up() {
        // The den's Ember (0) faces Tide (4), which beats it; it has Stone (2) and Storm (3) behind.
        let mut battle = Battle::new(squad([4, 4, 4], 0), squad([0, 2, 3], 0));
        battle.step([Some(ACT_PICK), Some(ACT_PICK)], b"x").unwrap();
        let mut swaps = 0;
        for seed in 0..400u64 {
            let mut rng = Rng::new(&seed.to_le_bytes(), 3);
            let action = npc_action(&battle, 1, STYLE_CLOSER, &mut rng);
            if action >= ACT_SWAP {
                // Storm beats Tide: that is the beast to send in.
                assert_eq!(action, ACT_SWAP + 2);
                swaps += 1;
            }
            assert!(battle.check(1, action).is_ok());
        }
        assert!(swaps > 200 && swaps < 330, "swapped {swaps} times out of 400");
        // In sudden death it has to stand and fight.
        battle.round_turn = SUDDEN_DEATH_TURN;
        for seed in 0..100u64 {
            let mut rng = Rng::new(&seed.to_le_bytes(), 3);
            assert!(npc_action(&battle, 1, STYLE_CLOSER, &mut rng) < ACT_SWAP);
        }
    }

    #[test]
    fn nobody_fires_an_empty_special() {
        let mut battle = Battle::new(squad([0, 1, 2], 0), squad([4, 7, 6], 0));
        battle.step([Some(ACT_PICK), Some(ACT_PICK)], b"x").unwrap();
        for style in 0..5 {
            for seed in 0..200u64 {
                let mut rng = Rng::new(&seed.to_le_bytes(), 1);
                assert_ne!(npc_move(&battle, 1, style, &mut rng), MOVE_SPECIAL);
            }
        }
    }
}
