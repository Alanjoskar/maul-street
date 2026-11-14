//! What a fight teaches: XP for every beast in a squad, and the levels it adds up to.

use maul_core::battle::{self, Fighter};
use maul_core::rules;

use super::*;

/// Writes a finished fight worth `fight_xp` into a squad's record, as the contract does when
/// a fight ends. `parts` says, for each beast, whether it went into the pit and how many
/// beasts it put down. Returns the XP and the levels the contract reports.
fn teach(chain: &mut Chain, squad: [u64; 3], won: bool, fight_xp: u64, parts: [(bool, u8); 3]) -> ([u64; 3], [u32; 3]) {
    chain.ok(HOUSE, |contract| {
        let mut team: Vec<Fighter> = squad.iter().map(|id| battle::fighter(&contract.beast(*id).build(*id), 0)).collect();
        for (fighter, (entered, kills)) in team.iter_mut().zip(parts) {
            fighter.entered = entered;
            fighter.kills = kills;
        }
        contract.record_fight(&team, won, fight_xp)
    })
}

#[test]
fn a_fight_teaches_the_whole_squad() {
    let mut chain = Chain::deploy(0);
    let squad = chain.join(AVA, [0, 1, 2], 0);
    let progress = |chain: &mut Chain| -> Vec<(u32, u64)> {
        chain.player(AVA).beasts.iter().map(|beast| (beast.level, beast.xp)).collect()
    };

    // A fight worth 90 XP. One beast fought and put two down, one fought, one only watched.
    let (earned, levels) = teach(&mut chain, squad, true, 90, [(true, 2), (true, 0), (false, 0)]);
    assert_eq!(earned, [90 + 2 * rules::KILL_XP, 90, 90 * rules::BENCH_XP_PCT / 100]);
    assert_eq!((earned, levels), ([120, 90, 45], [2, 1, 1]));
    assert_eq!(progress(&mut chain), vec![(2, 20), (1, 90), (1, 45)]);
    let record: Vec<_> = chain.player(AVA).beasts.iter().map(|beast| (beast.fights, beast.wins, beast.kills)).collect();
    assert_eq!(record, vec![(1, 1, 2), (1, 1, 0), (1, 1, 0)]);

    // XP carries over from fight to fight, and one award can be worth several levels:
    // 100 + 110 + 121 XP take a new beast to level 4.
    let (earned, levels) = teach(&mut chain, squad, false, 340, [(false, 0), (true, 0), (true, 1)]);
    assert_eq!((earned, levels), ([170, 340, 355], [3, 4, 4]));
    assert_eq!(progress(&mut chain), vec![(3, 80), (4, 99), (4, 69)]);
    let beasts = chain.player(AVA).beasts;
    assert!(beasts.iter().all(|beast| (beast.fights, beast.wins, beast.form) == (2, 1, 0)));
    assert_eq!(beasts.iter().map(|beast| beast.xp_next).collect::<Vec<_>>(), vec![121, 133, 133]);

    // At level 5 a beast grows into its second form and takes that form's name.
    teach(&mut chain, squad, true, 133, [(true, 0); 3]);
    let grown = chain.beast(squad[1]);
    assert_eq!((grown.level, grown.xp, grown.form, grown.form_name, grown.name.as_str()), (5, 99, 1, "Thicketbuck", "Thicketbuck"));
    // Stats follow the level: 3% of the base for each level above the first.
    assert_eq!(grown.stats, [460, 70, 54, 52].map(|base| rules::stat_at_level(base, 5)));
    assert_eq!(grown.stats[0], 460 * 112 / 100);
}

#[test]
fn a_fight_given_up_still_teaches_a_little() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 1);
    // Given up before any beast went in: every beast only watched, so each gets half of what
    // a lost spar is worth.
    chain.ok(AVA, |contract| contract.start_den_fight(2, squad, yocto(0)));
    let lost = chain.ok(AVA, |contract| contract.forfeit_den());
    assert_eq!(rules::den_xp(3, false, false), 15);
    assert_eq!((lost.xp, lost.levels), ([[7; 3], [0; 3]], [[1; 3], [0; 3]]));

    // With one beast sent in first, that one gets the whole of it. A fight with NEAR on it
    // is worth half as much again.
    chain.ok(AVA, |contract| contract.start_den_fight(0, squad, yocto(CENT)));
    chain.ok(AVA, |contract| contract.den_act(11));
    let lost = chain.ok(AVA, |contract| contract.forfeit_den());
    assert_eq!(rules::den_xp(1, false, true), 22);
    assert_eq!(lost.xp[0], [11, 22, 11]);
    let xp: Vec<u64> = chain.player(AVA).beasts.iter().map(|beast| beast.xp).collect();
    assert_eq!(xp, vec![18, 29, 18]);
}
