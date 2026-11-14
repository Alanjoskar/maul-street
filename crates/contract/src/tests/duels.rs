//! Challenges and duels.

use maul_core::battle::{self, Event, MOVE_BREAK, MOVE_GUARD, MOVE_STRIKE};
use maul_core::rules;

use super::*;

const OPENING_CLOCK: u64 = 180;
const MOVE_CLOCK: u64 = rules::MOVE_CLOCK_SECS;

/// The hash a client seals a move under.
fn seal(action: u8, salt: &str) -> String {
    env::sha256(format!("{action}:{salt}")).iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Ava and Theo, each with three starters and 5 NEAR, and Mira with nothing but her beasts.
struct Pit {
    chain: Chain,
    avas: [u64; 3],
    theos: [u64; 3],
    miras: [u64; 3],
}

const SIDES: [&str; 2] = [AVA, THEO];

impl Pit {
    fn new() -> Pit {
        let mut chain = Chain::deploy(15 * NEAR);
        let avas = chain.join(AVA, [0, 1, 2], 5);
        let theos = chain.join(THEO, [2, 3, 4], 5);
        let miras = chain.join(MIRA, [0, 3, 4], 0);
        Pit { chain, avas, theos, miras }
    }

    /// Ava posts a challenge and Theo accepts it.
    fn start(&mut self, stake: u128) -> MatchView {
        let (avas, theos) = (self.avas, self.theos);
        let challenge = self.chain.ok(AVA, |contract| contract.create_challenge(avas, yocto(stake), 0, None));
        self.chain.ok(THEO, |contract| contract.accept_challenge(challenge.id, theos))
    }

    fn duel(&mut self) -> MatchView {
        let match_id = self.chain.player(AVA).duel.expect("Ava has a duel");
        self.chain.view(|contract| contract.get_match(match_id)).unwrap()
    }

    fn commit(&mut self, side: usize, action: u8, salt: &str) -> MatchView {
        let hash = seal(action, salt);
        self.chain.ok(SIDES[side], |contract| contract.duel_commit(hash))
    }

    fn reveal(&mut self, side: usize, action: u8, salt: &str) -> MatchView {
        self.chain.ok(SIDES[side], |contract| contract.duel_reveal(action, salt.to_string()))
    }

    /// Plays one step the sealed way: every side that has to act seals, then each opens.
    fn sealed_step(&mut self, actions: [u8; 2]) -> MatchView {
        let mut after = self.duel();
        let turn = after.battle.turn;
        let sides: Vec<usize> = (0..2).filter(|side| after.need[*side]).collect();
        let salt = |side: usize| format!("salt-{side}-{turn}");
        for side in &sides {
            let sealed = self.commit(*side, actions[*side], &salt(*side));
            assert!(sealed.sealed[*side] && !sealed.open[*side]);
            assert_eq!(sealed.battle.turn, turn, "sealing plays nothing");
        }
        for side in &sides {
            after = self.reveal(*side, actions[*side], &salt(*side));
        }
        assert_eq!((after.sealed, after.open), ([false, false], [false, false]), "a played step clears the table");
        after
    }

    /// Both sides send in their first beast.
    fn open(&mut self) -> MatchView {
        self.sealed_step([battle::ACT_PICK, battle::ACT_PICK])
    }

    /// Plays sealed steps, Ava striking and Theo breaking, until `done` says stop.
    fn play_until(&mut self, done: impl Fn(&MatchView) -> bool) -> MatchView {
        let mut duel = self.duel();
        while !done(&duel) {
            let actions = [legal_action(&duel, 0, MOVE_STRIKE), legal_action(&duel, 1, MOVE_BREAK)];
            duel = self.sealed_step(actions);
        }
        duel
    }
}

#[test]
fn a_seal_is_the_sha256_of_action_and_salt() {
    // Worked out with `printf '2:9f3a61c0' | sha256sum`, outside this code.
    assert_eq!(seal(2, "9f3a61c0"), "2961623c9e717b0f6d9ecd8b356e0f05bd9e82f36b148ef0fd1ab40533936d46");
    let mut pit = Pit::new();
    pit.start(0);
    // The contract accepts exactly that hash for that move and salt.
    let hash = "a0fe63b1f265d6d0310fe662cacce8f17293ef650f1ea882df731cb35230a187".to_string();
    pit.chain.ok(AVA, |contract| contract.duel_commit(hash));
    pit.commit(1, 10, "theo");
    assert!(pit.chain.ok(AVA, |contract| contract.duel_reveal(10, String::new())).open[0]);
}

#[test]
fn a_sealed_move_stays_shut_until_the_other_side_locks_in() {
    let mut pit = Pit::new();
    pit.start(10 * CENT);
    // Ava seals first. If she could open now, Theo would see her pick before choosing his.
    pit.commit(0, 11, "a");
    let too_soon = "Wait for the other side to lock in before you open your move.";
    pit.chain.fails(AVA, |contract| contract.duel_reveal(11, "a".to_string()), too_soon);
    let duel = pit.duel();
    assert_eq!((duel.sealed, duel.open), ([true, false], [false, false]), "the refused reveal showed nothing");

    // Once Theo has sealed, both may open, in either order.
    pit.commit(1, 12, "b");
    assert_eq!(pit.reveal(1, 12, "b").open, [false, true]);
    assert_eq!(pit.reveal(0, 11, "a").battle.active, [1, 2]);

    // An open move from the other side locks it in just as well.
    pit.commit(0, MOVE_STRIKE, "c");
    pit.chain.fails(AVA, |contract| contract.duel_reveal(MOVE_STRIKE, "c".to_string()), too_soon);
    pit.chain.ok(THEO, |contract| contract.duel_play(MOVE_GUARD));
    assert_eq!(pit.reveal(0, MOVE_STRIKE, "c").battle.turn, 2);

    // When only one side has to act, nobody is left to wait for.
    let duel = pit.play_until(|duel| duel.need[0] != duel.need[1]);
    let picker = if duel.need[0] { 0 } else { 1 };
    let pick = legal_action(&duel, picker, MOVE_STRIKE);
    pit.commit(picker, pick, "d");
    assert_eq!(pit.reveal(picker, pick, "d").need, [true, true]);

    // Waiting to open is not stalling: if Theo never locks in, the clock runs out on him.
    pit.commit(0, MOVE_STRIKE, "e");
    pit.chain.fails(AVA, |contract| contract.duel_reveal(MOVE_STRIKE, "e".to_string()), too_soon);
    pit.chain.wait(MOVE_CLOCK + 1);
    assert_eq!(pit.chain.ok(AVA, |contract| contract.claim_timeout()).winner, Some(0));
}

#[test]
fn challenges_hold_the_stake_until_cancelled_or_accepted() {
    let mut pit = Pit::new();
    let (avas, theos, miras) = (pit.avas, pit.theos, pit.miras);
    let chain = &mut pit.chain;
    let stake = 10 * CENT;

    chain.fails(AVA, |contract| contract.create_challenge(avas, yocto(CENT - 1), 0, None), "at least 0.01 NEAR");
    chain.fails(AVA, |contract| contract.create_challenge([avas[0]; 3], yocto(stake), 0, None), "three different beasts");
    chain.fails(AVA, |contract| contract.create_challenge(theos, yocto(stake), 0, None), "is not yours to field");
    chain.fails(AVA, |contract| contract.create_challenge(avas, yocto(100 * NEAR), 0, None), "Your balance is too low.");
    chain.fails(AVA, |contract| contract.create_challenge(avas, yocto(stake), 0, Some(account(AVA))), "someone other than yourself");
    chain.fails(AVA, |contract| contract.cancel_challenge(), "You have no challenge open.");

    let challenge = chain.ok(AVA, |contract| contract.create_challenge(avas, yocto(stake), 0, None));
    assert_eq!((challenge.id, challenge.stake.0, challenge.level_cap, challenge.created), (1, stake, 0, chain.now));
    assert_eq!((challenge.creator.as_str(), challenge.invite.is_none()), (AVA, true));
    let listed: Vec<_> = challenge.squad.iter().map(|beast| (beast.token, beast.species, beast.level, beast.power)).collect();
    let own = chain.player(AVA).beasts;
    assert_eq!(listed, own.iter().map(|beast| (beast.id, beast.species, beast.level, beast.power)).collect::<Vec<_>>());
    assert_eq!((chain.balance(AVA), chain.escrow()), (5 * NEAR - stake, stake));
    assert_eq!(chain.player(AVA).challenge, Some(1));
    assert_eq!(chain.headline(), "ava.testnet is looking for a fight for 0.1 NEAR");
    chain.fails(AVA, |contract| contract.create_challenge(avas, yocto(stake), 0, None), "already have a challenge open");
    chain.fails(AVA, |contract| contract.accept_challenge(1, avas), "You can't accept your own challenge.");
    chain.fails(THEO, |contract| contract.accept_challenge(9, theos), "That challenge is no longer open.");
    chain.fails(MIRA, |contract| contract.accept_challenge(1, miras), "Your balance is too low.");
    chain.fails(THEO, |contract| contract.accept_challenge(1, avas), "is not yours to field");

    // Cancelling gives the stake back.
    chain.ok(AVA, |contract| contract.cancel_challenge());
    assert_eq!((chain.balance(AVA), chain.escrow(), chain.player(AVA).challenge), (5 * NEAR, 0, None));
    assert!(chain.view(|contract| contract.get_challenges(None, None)).is_empty());
    chain.fails(THEO, |contract| contract.accept_challenge(1, theos), "That challenge is no longer open.");

    // An invitation is for one player only. The list shows the newest challenge first.
    chain.ok(AVA, |contract| contract.create_challenge(avas, yocto(stake), 0, Some(account(THEO))));
    assert_eq!(chain.headline(), "ava.testnet called out theo.testnet for 0.1 NEAR");
    chain.fails(MIRA, |contract| contract.accept_challenge(2, miras), "That challenge is for someone else.");
    chain.ok(MIRA, |contract| contract.create_challenge(miras, yocto(0), 0, None));
    assert_eq!(chain.headline(), "mira.testnet is looking for a fight for a friendly duel");
    let open = chain.view(|contract| contract.get_challenges(None, None));
    assert_eq!(open.iter().map(|challenge| challenge.id).collect::<Vec<_>>(), vec![3, 2]);
    assert_eq!(open[1].invite, Some(account(THEO)));
    let second_page = chain.view(|contract| contract.get_challenges(Some(1), Some(5)));
    assert_eq!(second_page.iter().map(|challenge| challenge.id).collect::<Vec<_>>(), vec![2]);

    // Accepting takes the same stake and starts the duel on the opening clock.
    let duel = chain.ok(THEO, |contract| contract.accept_challenge(2, theos));
    assert_eq!((duel.kind, duel.den, duel.stake.0, duel.payout_bps), ("duel", None, stake, 0));
    assert_eq!(duel.players, [AVA.to_string(), THEO.to_string()]);
    assert_eq!((duel.need, duel.sealed, duel.open, duel.over), ([true, true], [false, false], [false, false], false));
    assert_eq!(duel.deadline, chain.now + OPENING_CLOCK);
    assert_eq!(duel.battle.teams[0].iter().map(|fighter| fighter.token).collect::<Vec<_>>(), avas);
    assert_eq!(duel.battle.teams[1].iter().map(|fighter| fighter.token).collect::<Vec<_>>(), theos);
    assert_eq!((chain.balance(AVA), chain.balance(THEO), chain.escrow()), (5 * NEAR - stake, 5 * NEAR - stake, 2 * stake));
    let (ava, theo) = (chain.player(AVA), chain.player(THEO));
    assert_eq!((ava.challenge, ava.duel, theo.duel), (None, Some(duel.id), Some(duel.id)));
    assert_eq!(chain.view(|contract| contract.get_challenges(None, None)).len(), 1);
    assert_eq!(chain.view(|contract| contract.get_stats()).duels, 1);
    chain.assert_books_balance();
}

#[test]
fn a_challenge_needs_its_squad_when_the_duel_starts() {
    let mut pit = Pit::new();
    let (avas, theos, miras) = (pit.avas, pit.theos, pit.miras);
    let chain = &mut pit.chain;
    // Ava names a beast she has hired from Mira for one fight, then spends that fight on a den.
    chain.ok(MIRA, |contract| contract.list_for_hire(miras[0], yocto(CENT)));
    chain.ok(AVA, |contract| contract.hire(miras[0], 1));
    let squad = [miras[0], avas[1], avas[2]];
    let challenge = chain.ok(AVA, |contract| contract.create_challenge(squad, yocto(0), 0, None));
    assert_eq!(chain.player(AVA).hires[0].fights_left, 1, "posting a challenge uses no paid fight");
    chain.ok(AVA, |contract| contract.start_den_fight(0, squad, yocto(0)));
    chain.fails(THEO, |contract| contract.accept_challenge(challenge.id, theos), "can no longer field the squad");

    // With another paid fight the duel can start, and that uses the fight up.
    chain.ok(AVA, |contract| contract.hire(miras[0], 1));
    let duel = chain.ok(THEO, |contract| contract.accept_challenge(challenge.id, theos));
    assert_eq!(duel.battle.teams[0][0].token, miras[0]);
    assert!(chain.player(AVA).hires.is_empty());
}

#[test]
fn a_level_cap_holds_every_beast_down() {
    let mut pit = Pit::new();
    let (avas, theos) = (pit.avas, pit.theos);
    let chain = &mut pit.chain;
    for _ in 0..3 {
        chain.ok(AVA, |contract| contract.level_up(avas[0], false));
    }
    let uncapped = chain.beast(avas[0]);
    assert_eq!(uncapped.level, 4);

    // The challenge shows each beast as it would fight under a cap of 2: the level 4 beast
    // at level 2, the others as they are.
    let challenge = chain.ok(AVA, |contract| contract.create_challenge(avas, yocto(0), 2, None));
    let shown: Vec<(u32, u32)> = challenge.squad.iter().map(|beast| (beast.level, beast.power)).collect();
    let capped = [410, 78, 48, 62].map(|base| rules::stat_at_level(base, 2));
    assert_eq!(shown[0], (2, battle::power(&capped)));
    assert_eq!(shown[1], (1, chain.beast(avas[1]).power));
    assert!(shown[0].1 < uncapped.power);

    let duel = chain.ok(THEO, |contract| contract.accept_challenge(challenge.id, theos));
    assert_eq!(duel.level_cap, 2);
    let fighter = &duel.battle.teams[0][0];
    assert_eq!((fighter.level, fighter.atk), (2, rules::stat_at_level(78, 2)));
    assert_eq!(duel.battle.teams[1][0].level, 1);

    // What the fight teaches goes to the beast as it really is: level 4, and counting from there.
    let over = chain.ok(THEO, |contract| contract.forfeit_duel());
    assert_eq!((over.xp[0], over.levels[0]), ([60; 3], [4, 1, 1]));
    assert_eq!((chain.beast(avas[0]).level, chain.beast(avas[0]).xp), (4, 60));
}

#[test]
fn a_duel_played_to_the_end_pays_the_pot_less_the_rake() {
    let mut pit = Pit::new();
    let stake = 20 * CENT;
    let treasury = pit.chain.treasury();
    pit.start(stake);

    // Every step: both seal, both open, the step plays and the clock restarts.
    let mut duel = pit.duel();
    while !duel.over {
        let turn = duel.battle.turn;
        let actions = [legal_action(&duel, 0, MOVE_STRIKE), legal_action(&duel, 1, MOVE_BREAK)];
        duel = pit.sealed_step(actions);
        assert_eq!(duel.battle.turn, turn + 1);
        assert_eq!(duel.steps.last().unwrap().turn, turn + 1);
        assert_eq!(duel.steps.last().unwrap().events, duel.last_events);
        assert!(duel.steps.len() <= 4);
        assert_eq!(duel.deadline, pit.chain.now + MOVE_CLOCK);
        pit.chain.wait(3);
    }
    let chain = &mut pit.chain;
    let winner = duel.winner.unwrap() as usize;
    let (victor, beaten) = (SIDES[winner], SIDES[1 - winner]);
    assert!(!duel.void);
    assert_eq!(duel.last_events.last(), Some(&Event::Over { winner: winner as u8 }));

    // The pot is both stakes. The house keeps 3% and the winner gets the rest.
    let (pot, rake) = (2 * stake, 2 * stake * 3 / 100);
    assert_eq!(rake, rules::bps(pot, rules::DUEL_RAKE_BPS));
    assert_eq!(duel.payout.0, pot - rake);
    assert_eq!(chain.balance(victor), 5 * NEAR - stake + pot - rake);
    assert_eq!(chain.balance(beaten), 5 * NEAR - stake);
    assert_eq!((chain.treasury(), chain.escrow()), (treasury + rake, 0));
    assert_eq!(chain.headline(), format!("{victor} won 0.39 NEAR from {beaten}"));

    // Ratings, Essence and records move for both.
    let (won, lost) = (chain.player(victor), chain.player(beaten));
    assert_eq!((won.rating, lost.rating), rules::ratings_after(rules::RATING_START, rules::RATING_START));
    assert_eq!((won.rating, lost.rating), (1012, 988));
    assert_eq!((won.wins, won.losses, lost.wins, lost.losses), (1, 0, 0, 1));
    assert_eq!((won.won.0, lost.won.0), (pot - rake, 0));
    assert_eq!(won.essence, rules::STARTING_ESSENCE + rules::duel_essence(true));
    assert_eq!(lost.essence, rules::STARTING_ESSENCE + rules::duel_essence(false));
    assert_eq!(duel.essence[winner], rules::duel_essence(true));
    assert_eq!(duel.essence[1 - winner], rules::duel_essence(false));
    assert!(won.beasts.iter().all(|beast| (beast.fights, beast.wins) == (1, 1)));
    assert!(lost.beasts.iter().all(|beast| (beast.fights, beast.wins) == (1, 0)));
    assert_eq!(won.beasts.iter().map(|beast| beast.kills).sum::<u32>(), 3);

    // Every beast learns: the winner's squad more, a beast that fought more than one that
    // watched, and a little for each beast it put down.
    for side in 0..2 {
        let (fight_xp, now) = (rules::duel_xp(side == winner), chain.player(SIDES[side]).beasts);
        for (slot, fighter) in duel.battle.teams[side].iter().enumerate() {
            let earned = rules::beast_xp(fight_xp, fighter.entered, fighter.kills);
            assert_eq!(duel.xp[side][slot], earned);
            assert_eq!((now[slot].level, now[slot].xp), rules::add_xp(1, 0, earned));
            assert_eq!(duel.levels[side][slot], now[slot].level);
        }
    }
    assert!(duel.levels[winner].contains(&2), "a winner that fought has grown a level");

    let board = chain.view(|contract| contract.get_leaderboard(None));
    assert_eq!(board.iter().map(|row| row.account_id.as_str()).collect::<Vec<_>>(), vec![victor, MIRA, beaten]);
    assert_eq!((board[0].rating, board[0].wins, board[0].won.0), (1012, 1, pot - rake));
    assert_eq!(chain.view(|contract| contract.get_leaderboard(Some(1))).len(), 1);
    let stats = chain.view(|contract| contract.get_stats());
    assert_eq!((stats.duels, stats.volume.0), (1, pot));
    chain.fails(AVA, |contract| contract.forfeit_duel(), "You have no duel in progress.");
    chain.assert_books_balance();
}

#[test]
fn open_moves_are_allowed_only_when_nothing_can_be_copied() {
    let mut pit = Pit::new();
    pit.start(10 * CENT);
    // At the opening both sides choose: an open move would tell the other what to counter.
    pit.chain.fails(AVA, |contract| contract.duel_play(10), "Seal your move");
    pit.chain.fails(MIRA, |contract| contract.duel_play(10), "You have no duel in progress.");

    // Once Ava has sealed, Theo may answer in the open.
    pit.commit(0, 10, "a");
    let duel = pit.chain.ok(THEO, |contract| contract.duel_play(11));
    assert_eq!((duel.sealed, duel.open, duel.battle.turn), ([true, false], [false, true], 0));
    pit.chain.fails(THEO, |contract| contract.duel_play(11), "already locked in a move");
    pit.chain.fails(THEO, |contract| contract.duel_commit(seal(11, "b")), "already locked in a move");
    pit.chain.fails(AVA, |contract| contract.duel_play(10), "already locked in a move");
    pit.chain.fails(AVA, |contract| contract.duel_commit(seal(10, "c")), "already locked in a move");
    let duel = pit.reveal(0, 10, "a");
    assert_eq!((duel.battle.active, duel.battle.turn), ([0, 1], 1));
    assert_eq!(duel.last_events, vec![Event::Pick { side: 0, slot: 0 }, Event::Pick { side: 1, slot: 1 }]);

    // An open move has to be legal.
    pit.commit(1, MOVE_GUARD, "d");
    pit.chain.fails(AVA, |contract| contract.duel_play(3), "The Special needs a full Rage bar.");
    pit.chain.fails(AVA, |contract| contract.duel_play(10), "Unknown move.");
    let duel = pit.chain.ok(AVA, |contract| contract.duel_play(MOVE_STRIKE));
    assert_eq!((duel.sealed, duel.open), ([false, true], [true, false]));
    let duel = pit.reveal(1, MOVE_GUARD, "d");
    assert_eq!(duel.last_events[0], Event::Moves { m: [MOVE_STRIKE, MOVE_GUARD] });

    // After a kill only the side whose beast fell has to act, so it may pick in the open.
    let duel = pit.play_until(|duel| duel.need[0] != duel.need[1]);
    let picker = if duel.need[0] { 0 } else { 1 };
    let pick = legal_action(&duel, picker, MOVE_STRIKE);
    pit.chain.fails(SIDES[1 - picker], |contract| contract.duel_play(MOVE_STRIKE), "It is not your turn to act.");
    pit.chain.fails(SIDES[1 - picker], |contract| contract.duel_commit(seal(0, "e")), "It is not your turn to act.");
    let duel = pit.chain.ok(SIDES[picker], |contract| contract.duel_play(pick));
    assert_eq!(duel.need, [true, true]);
    assert!(matches!(duel.last_events[..], [Event::Pick { .. }]));
}

#[test]
fn a_reveal_must_match_the_seal() {
    let mut pit = Pit::new();
    pit.start(10 * CENT);
    let chain = &mut pit.chain;
    chain.fails(AVA, |contract| contract.duel_commit("abc".to_string()), "64 lowercase hex characters");
    chain.fails(AVA, |contract| contract.duel_commit(seal(10, "s").to_uppercase()), "64 lowercase hex characters");
    chain.fails(AVA, |contract| contract.duel_reveal(10, "s".to_string()), "You have no sealed move to open.");
    chain.fails(MIRA, |contract| contract.duel_commit(seal(10, "s")), "You have no duel in progress.");

    chain.ok(AVA, |contract| contract.duel_commit(seal(10, "ava's salt")));
    chain.ok(THEO, |contract| contract.duel_commit(seal(12, "theo's salt")));
    chain.fails(AVA, |contract| contract.duel_reveal(11, "ava's salt".to_string()), "That is not the move you sealed.");
    chain.fails(AVA, |contract| contract.duel_reveal(10, "theo's salt".to_string()), "That is not the move you sealed.");
    chain.fails(AVA, |contract| contract.duel_reveal(10, "x".repeat(129)), "A salt is at most 128 characters.");
    let duel = chain.ok(AVA, |contract| contract.duel_reveal(10, "ava's salt".to_string()));
    assert_eq!((duel.sealed, duel.open, duel.battle.turn), ([false, true], [true, false], 0));
    chain.fails(AVA, |contract| contract.duel_reveal(10, "ava's salt".to_string()), "Your move is already open.");
    let duel = chain.ok(THEO, |contract| contract.duel_reveal(12, "theo's salt".to_string()));
    assert_eq!(duel.battle.active, [0, 2]);
}

#[test]
fn an_illegal_sealed_move_becomes_a_safe_one() {
    let mut pit = Pit::new();
    pit.start(0);
    // Sealing a Strike when it is time to pick sends in the first living beast.
    // Sealing a slot that does not exist does the same.
    let duel = pit.sealed_step([MOVE_STRIKE, 13]);
    assert_eq!(duel.last_events, vec![Event::Pick { side: 0, slot: 0 }, Event::Pick { side: 1, slot: 0 }]);
    // Sealing a Special with an empty Rage bar, or a pick in mid-round, becomes a Strike.
    let duel = pit.sealed_step([battle::MOVE_SPECIAL, 11]);
    assert_eq!(duel.last_events[0], Event::Moves { m: [MOVE_STRIKE, MOVE_STRIKE] });

    // Sealing a beast that is already down sends in the next one still standing.
    let duel = pit.play_until(|duel| duel.need[0] != duel.need[1]);
    let picker = if duel.need[0] { 0 } else { 1 };
    let fallen = duel.battle.teams[picker].iter().position(|fighter| fighter.hp == 0).unwrap();
    let standing = duel.battle.teams[picker].iter().position(|fighter| fighter.hp > 0).unwrap();
    let duel = pit.sealed_step([battle::ACT_PICK + fallen as u8; 2]);
    assert_eq!(duel.last_events, vec![Event::Pick { side: picker as u8, slot: standing as u8 }]);
}

#[test]
fn a_sealed_swap_sends_in_another_beast() {
    let mut pit = Pit::new();
    pit.start(0);
    pit.open();
    // Instead of a move, Ava calls her beast back and sends in her third. Theo's Strike
    // lands on the beast that came in.
    let duel = pit.sealed_step([battle::ACT_SWAP + 2, MOVE_STRIKE]);
    assert_eq!(duel.last_events[0], Event::Moves { m: [battle::ACT_SWAP + 2, MOVE_STRIKE] });
    assert_eq!(duel.last_events[1], Event::Swap { side: 0, slot: 2 });
    assert_eq!(duel.battle.active[0], 2);
    assert!(duel.battle.teams[0][2].entered);
    assert!(duel.last_events.iter().any(|event| matches!(event, Event::Hit { by: 1, .. })));
    assert!(!duel.last_events.iter().any(|event| matches!(event, Event::Hit { by: 0, .. })));
    assert!(duel.battle.teams[0][2].hp < duel.battle.teams[0][2].max_hp);
    assert_eq!(duel.battle.teams[0][0].hp, duel.battle.teams[0][0].max_hp);
    // A sealed swap to the beast already in the pit becomes a Strike.
    let duel = pit.sealed_step([battle::ACT_SWAP + 2, MOVE_GUARD]);
    assert_eq!(duel.last_events[0], Event::Moves { m: [MOVE_STRIKE, MOVE_GUARD] });
}

#[test]
fn a_duel_nobody_opens_is_void() {
    let mut pit = Pit::new();
    let stake = 10 * CENT;
    pit.start(stake);
    // Even with one opening pick sealed, a duel that never got its first beasts in is void.
    pit.commit(0, 10, "a");
    pit.chain.fails(THEO, |contract| contract.claim_timeout(), "The clock has not run out yet.");
    pit.chain.wait(OPENING_CLOCK);
    pit.chain.fails(THEO, |contract| contract.claim_timeout(), "The clock has not run out yet.");
    pit.chain.wait(1);
    let duel = pit.chain.ok(THEO, |contract| contract.claim_timeout());
    assert_eq!((duel.over, duel.void, duel.winner, duel.payout.0, duel.essence), (true, true, None, 0, [0, 0]));
    assert!(duel.last_events.is_empty());

    let chain = &mut pit.chain;
    assert_eq!((chain.balance(AVA), chain.balance(THEO), chain.escrow()), (5 * NEAR, 5 * NEAR, 0));
    let (ava, theo) = (chain.player(AVA), chain.player(THEO));
    assert_eq!((ava.rating, theo.rating, ava.wins + ava.losses + theo.wins + theo.losses), (1000, 1000, 0));
    assert_eq!((ava.essence, theo.essence), (rules::STARTING_ESSENCE, rules::STARTING_ESSENCE));
    assert!(ava.beasts.iter().all(|beast| (beast.fights, beast.xp) == (0, 0)));
    assert_eq!((duel.xp, duel.levels), ([[0; 3]; 2], [[0; 3]; 2]), "a void duel teaches nothing");
    assert_eq!(chain.headline(), "The duel between ava.testnet and theo.testnet was called off");
    chain.fails(AVA, |contract| contract.claim_timeout(), "You have no duel in progress.");
    chain.fails(AVA, |contract| contract.duel_commit(seal(10, "a")), "You have no duel in progress.");
    chain.assert_books_balance();
}

/// Starts a duel, plays the opening, lets `stall` set the scene, runs the clock out and
/// has Theo claim. Returns the pit and the result.
fn timed_out(stall: impl FnOnce(&mut Pit)) -> (Pit, MatchView) {
    let mut pit = Pit::new();
    pit.start(10 * CENT);
    pit.open();
    stall(&mut pit);
    pit.chain.fails(THEO, |contract| contract.claim_timeout(), "The clock has not run out yet.");
    pit.chain.wait(MOVE_CLOCK + 1);
    let duel = pit.chain.ok(THEO, |contract| contract.claim_timeout());
    pit.chain.assert_books_balance();
    (pit, duel)
}

#[test]
fn the_side_that_stalls_loses_on_the_clock() {
    let (stake, payout) = (10 * CENT, 2 * 10 * CENT * 97 / 100);

    // Ava seals and Theo does nothing: Theo loses, even though he is the one who claims.
    let (mut pit, duel) = timed_out(|pit| {
        pit.commit(0, MOVE_STRIKE, "a");
    });
    assert_eq!((duel.over, duel.void, duel.winner, duel.payout.0), (true, false, Some(0), payout));
    assert_eq!(duel.last_events, vec![Event::Over { winner: 0 }]);
    assert_eq!((pit.chain.balance(AVA), pit.chain.balance(THEO)), (5 * NEAR - stake + payout, 5 * NEAR - stake));
    assert_eq!((pit.chain.player(AVA).rating, pit.chain.player(THEO).rating), (1012, 988));
    assert_eq!(pit.chain.headline(), "ava.testnet won 0.19 NEAR from theo.testnet");
    // A win on the clock teaches like any other: Ava's side as winners, Theo's as losers.
    let lead = |side: usize| duel.battle.teams[side].iter().position(|fighter| fighter.entered).unwrap();
    assert_eq!((duel.xp[0][lead(0)], duel.xp[1][lead(1)]), (rules::duel_xp(true), rules::duel_xp(false)));
    assert_eq!((duel.xp[0].iter().sum::<u64>(), duel.xp[1].iter().sum::<u64>()), (120 + 60 + 60, 40 + 20 + 20));

    // Both seal and only Ava opens: Theo is holding the duel up.
    let (_, duel) = timed_out(|pit| {
        pit.commit(0, MOVE_STRIKE, "a");
        pit.commit(1, MOVE_GUARD, "b");
        pit.reveal(0, MOVE_STRIKE, "a");
    });
    assert_eq!(duel.winner, Some(0));

    // Ava seals, Theo answers in the open, and Ava never opens: now Ava is holding it up.
    let (_, duel) = timed_out(|pit| {
        pit.commit(0, MOVE_STRIKE, "a");
        pit.chain.ok(THEO, |contract| contract.duel_play(MOVE_GUARD));
    });
    assert_eq!(duel.winner, Some(1));

    // A beast falls and its owner will not send in the next one, sealed or not.
    for seals in [false, true] {
        let (_, duel) = timed_out(|pit| {
            let duel = pit.play_until(|duel| duel.need[0] != duel.need[1]);
            if seals {
                let picker = if duel.need[0] { 0 } else { 1 };
                pit.commit(picker, legal_action(&duel, picker, MOVE_STRIKE), "never opened");
            }
        });
        // The side that never picked still has nobody in the pit.
        let picker = duel.battle.active.iter().position(|slot| *slot == battle::NONE).unwrap();
        assert_eq!((duel.void, duel.winner), (false, Some(1 - picker as u8)));
    }
}

#[test]
fn a_duel_both_sides_abandon_is_void() {
    // Nobody moves at all.
    let (mut pit, duel) = timed_out(|_| {});
    assert_eq!((duel.over, duel.void, duel.winner), (true, true, None));
    assert_eq!((pit.chain.balance(AVA), pit.chain.balance(THEO), pit.chain.escrow()), (5 * NEAR, 5 * NEAR, 0));

    // Both seal and neither opens.
    let (mut pit, duel) = timed_out(|pit| {
        pit.commit(0, MOVE_STRIKE, "a");
        pit.commit(1, MOVE_GUARD, "b");
    });
    assert_eq!((duel.void, duel.winner), (true, None));
    assert_eq!((pit.chain.balance(AVA), pit.chain.balance(THEO)), (5 * NEAR, 5 * NEAR));
    assert_eq!(pit.chain.player(AVA).rating, 1000);
}

#[test]
fn a_move_gives_the_other_side_a_full_clock() {
    let mut pit = Pit::new();
    let accepted = pit.start(10 * CENT).deadline;
    // An early seal does not shorten the opening clock.
    pit.chain.wait(10);
    assert_eq!(pit.commit(0, 10, "a").deadline, accepted);
    // A late one stretches it, so the other side still has a full clock to answer.
    pit.chain.wait(OPENING_CLOCK - 15);
    let stretched = pit.commit(1, 10, "b").deadline;
    assert_eq!(stretched, pit.chain.now + MOVE_CLOCK);
    assert!(stretched > accepted);
    pit.chain.wait(10);
    pit.chain.fails(THEO, |contract| contract.claim_timeout(), "The clock has not run out yet.");
    assert_eq!(pit.reveal(0, 10, "a").deadline, pit.chain.now + MOVE_CLOCK);
    // The step that plays restarts the clock from now.
    pit.chain.wait(20);
    assert_eq!(pit.reveal(1, 10, "b").deadline, pit.chain.now + MOVE_CLOCK);
}

#[test]
fn forfeiting_a_duel_hands_the_other_side_the_pot() {
    let mut pit = Pit::new();
    let stake = 10 * CENT;
    pit.start(stake);
    pit.open();
    let duel = pit.chain.ok(THEO, |contract| contract.forfeit_duel());
    assert_eq!((duel.over, duel.void, duel.winner), (true, false, Some(0)));
    assert_eq!(duel.last_events, vec![Event::Over { winner: 0 }]);
    assert_eq!(duel.steps.len(), 1, "a forfeit is not a step");
    assert_eq!(pit.chain.balance(AVA), 5 * NEAR - stake + 2 * stake * 97 / 100);
    assert_eq!(pit.chain.balance(THEO), 5 * NEAR - stake);
    pit.chain.assert_books_balance();
}

#[test]
fn a_friendly_duel_moves_ratings_and_no_near() {
    let mut pit = Pit::new();
    let treasury = pit.chain.treasury();
    pit.start(0);
    let duel = pit.chain.ok(AVA, |contract| contract.forfeit_duel());
    assert_eq!((duel.winner, duel.payout.0, duel.essence), (Some(1), 0, [10, 40]));
    // Nobody went into the pit, so every beast gets half: of a loss for Ava's, of a win for Theo's.
    assert_eq!(duel.xp, [[20; 3], [60; 3]]);
    let chain = &mut pit.chain;
    assert_eq!((chain.balance(AVA), chain.balance(THEO), chain.treasury(), chain.escrow()), (5 * NEAR, 5 * NEAR, treasury, 0));
    assert_eq!((chain.player(AVA).rating, chain.player(THEO).rating), (988, 1012));
    assert_eq!(chain.headline(), "theo.testnet beat ava.testnet in a friendly duel");
}

#[test]
fn finished_duels_are_cleared_once_both_players_move_on() {
    let mut pit = Pit::new();
    let (avas, theos, miras) = (pit.avas, pit.theos, pit.miras);
    let first = pit.start(0).id;
    let chain = &mut pit.chain;

    // One duel at a time, for the challenger and for whoever accepts.
    let side_bet = chain.ok(AVA, |contract| contract.create_challenge(avas, yocto(0), 0, None)).id;
    chain.fails(MIRA, |contract| contract.accept_challenge(side_bet, miras), "The challenger is in the middle of another duel.");
    let miras_challenge = chain.ok(MIRA, |contract| contract.create_challenge(miras, yocto(0), 0, None)).id;
    chain.fails(THEO, |contract| contract.accept_challenge(miras_challenge, theos), "Finish your duel first");

    // The finished duel stays readable while either player still points at it.
    chain.ok(THEO, |contract| contract.forfeit_duel());
    assert_eq!((chain.player(AVA).duel, chain.player(THEO).duel), (Some(first), Some(first)));
    let second = chain.ok(MIRA, |contract| contract.accept_challenge(side_bet, miras)).id;
    assert_eq!((chain.player(AVA).duel, chain.player(THEO).duel), (Some(second), Some(first)));
    assert!(chain.view(|contract| contract.get_match(first)).unwrap().over);

    // When Theo starts his next duel too, nobody needs the first one any more.
    chain.ok(MIRA, |contract| contract.forfeit_duel());
    let third = chain.ok(THEO, |contract| contract.accept_challenge(miras_challenge, theos)).id;
    assert!(chain.view(|contract| contract.get_match(first)).is_none());
    // Ava still points at the second, so it stays although Mira has moved on.
    assert!(chain.view(|contract| contract.get_match(second)).is_some());
    assert_eq!((chain.player(MIRA).duel, chain.player(THEO).duel), (Some(third), Some(third)));
}
