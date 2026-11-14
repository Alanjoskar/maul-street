//! Fighting the dens, and backing them.

use maul_core::battle::{Event, MOVE_BREAK, MOVE_STRIKE};
use maul_core::{data, rules};

use super::books::assert_floor_of;
use super::*;

/// Runs one den fight for `who` and checks every number against the rules for the way it
/// ended. With a `habit` the fight is played to its end. Without one it is forfeited.
fn fight_and_check(chain: &mut Chain, who: &str, den_id: u8, squad: [u64; 3], stake: u128, habit: Option<u8>) -> MatchView {
    let tier = data::den(den_id).unwrap().tier;
    let (player, den, treasury, escrow) = (chain.player(who), chain.den(den_id), chain.treasury(), chain.escrow());
    assert_eq!(den.payout_bps, rules::den_payout_bps(den.wins, den.fights));

    let start = chain.ok(who, |contract| contract.start_den_fight(den_id, squad, yocto(stake)));
    assert_eq!((start.kind, start.den, start.deadline), ("den", Some(den_id), 0));
    assert_eq!(start.players, [who.to_string(), format!("den:{den_id}")]);
    assert_eq!((start.stake.0, start.payout_bps), (stake, den.payout_bps), "the payout is fixed at the start");
    assert_eq!((start.need, start.over), ([true, true], false));
    assert_eq!((start.xp, start.levels), ([[0; 3]; 2], [[0; 3]; 2]));
    assert_eq!(chain.balance(who), player.balance.0 - stake);
    assert_eq!(chain.escrow(), escrow + stake);
    assert_eq!(chain.player(who).den_match, Some(start.id));

    let end = match habit {
        Some(habit) => chain.play_den_fight(who, habit),
        None => chain.ok(who, |contract| contract.forfeit_den()),
    };
    let won = end.winner == Some(0);
    assert!(end.over && !end.void && (won || end.winner == Some(1)));
    assert_eq!(end.last_events.last(), Some(&Event::Over { winner: end.winner.unwrap() }));
    let essence = rules::den_essence(tier, won);
    assert_eq!(end.essence, [essence, 0]);

    let (after, den_after) = (chain.player(who), chain.den(den_id));
    assert_eq!(after.essence, player.essence + essence);
    assert_eq!((after.den_wins, after.den_losses), (player.den_wins + won as u32, player.den_losses + !won as u32));
    assert_eq!(
        (den_after.total_wins, den_after.total_losses),
        (den.total_wins + !won as u32, den.total_losses + won as u32)
    );
    assert_eq!(chain.escrow(), escrow);
    if stake == 0 {
        // A free spar pays Essence and moves no NEAR at all.
        assert_eq!((after.balance.0, den_after.bankroll.0, chain.treasury()), (player.balance.0, den.bankroll.0, treasury));
        assert_eq!((den_after.fights, end.payout.0, after.won.0), (den.fights, 0, player.won.0));
    } else if won {
        // The den pays the profit out of its bankroll.
        let payout = rules::den_payout(stake, den.payout_bps);
        assert_eq!(end.payout.0, payout);
        assert_eq!(after.balance.0, player.balance.0 - stake + payout);
        assert_eq!(den_after.bankroll.0, den.bankroll.0 - (payout - stake));
        assert_eq!((chain.treasury(), after.won.0), (treasury, player.won.0 + payout));
        assert_eq!(den_after.fights, (den.fights + 1).min(10));
        assert!(den_after.wins <= den.wins);
    } else {
        // The stake is lost: a tenth goes to the house as training, the rest to the bankroll.
        let training = rules::bps(stake, rules::DEN_TRAINING_BPS);
        assert_eq!(training, stake / 10);
        assert_eq!(after.balance.0, player.balance.0 - stake);
        assert_eq!(den_after.bankroll.0, den.bankroll.0 + stake - training);
        assert_eq!(chain.treasury(), treasury + training);
        assert_eq!(den_after.training_spent.0, den.training_spent.0 + training);
        assert_eq!((end.payout.0, den_after.fights), (stake - training, (den.fights + 1).min(10)));
        assert!(den_after.wins >= den.wins);
    }
    assert_eq!(den_after.training_levels, rules::den_training_levels(den_after.training_spent.0));
    assert_eq!(den_after.level_bonus, rules::den_level_bonus(den_after.training_levels));
    assert_eq!(den_after.spar_level, rules::den_spar_level(tier));

    // Every fielded beast has the fight on its record and has learnt from it: the fight's XP
    // for a beast that went into the pit, half for one that did not, and more for each kill.
    let fight_xp = rules::den_xp(tier, won, stake > 0);
    let mut kills = 0;
    for (slot, (before, now)) in player.beasts.iter().zip(&after.beasts).enumerate() {
        assert_eq!((now.fights, now.wins), (before.fights + 1, before.wins + won as u32));
        kills += now.kills - before.kills;
        let fighter = &end.battle.teams[0][slot];
        assert_eq!(end.xp[0][slot], rules::beast_xp(fight_xp, fighter.entered, fighter.kills));
        assert_eq!((now.level, now.xp), rules::add_xp(before.level, before.xp, end.xp[0][slot]));
        assert_eq!(end.levels[0][slot], now.level);
        assert!(now.xp < now.xp_next);
    }
    assert_eq!((end.xp[1], end.levels[1]), ([0; 3], [0; 3]), "a den's beasts learn nothing");
    let downed = end.battle.teams[1].iter().filter(|fighter| fighter.hp == 0).count() as u32;
    assert_eq!(kills, downed);
    assert!(!won || downed == 3);
    chain.assert_books_balance();
    end
}

#[test]
fn den_fights_pay_by_the_rules() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 5);
    let stake = 5 * CENT;

    // Free spars, played out: Essence and no NEAR.
    let mut results = Vec::new();
    for den_id in 0..5 {
        results.push(fight_and_check(&mut chain, AVA, den_id, squad, 0, Some(MOVE_STRIKE)).winner);
    }
    assert!(chain.view(|contract| contract.get_ticker()).is_empty(), "free spars stay off the ticker");

    // Staked fights against Old Grist, who swings first: striking back mostly wins...
    let mut won = false;
    for _ in 0..20 {
        let end = fight_and_check(&mut chain, AVA, 0, squad, stake, Some(MOVE_STRIKE));
        if end.winner == Some(0) {
            let paid = crate::near_text(end.payout.0);
            assert_eq!(chain.headline(), format!("ava.testnet won {paid} NEAR from Old Grist"));
            won = true;
            break;
        }
    }
    assert!(won, "a striker should beat the Brawler within twenty tries");

    // ...and winding up a Break against him mostly loses.
    let mut lost = false;
    for _ in 0..20 {
        if fight_and_check(&mut chain, AVA, 0, squad, stake, Some(MOVE_BREAK)).winner == Some(1) {
            assert_eq!(chain.headline(), "Old Grist took 0.05 NEAR from ava.testnet");
            lost = true;
            break;
        }
    }
    assert!(lost, "a breaker should lose to the Brawler within twenty tries");

    let stats = chain.view(|contract| contract.get_stats());
    assert!(stats.den_fights >= 7);
    assert!(results.iter().all(|winner| winner.is_some()));
}

#[test]
fn a_den_fight_keeps_its_last_four_steps() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 0);
    let start = chain.ok(AVA, |contract| contract.start_den_fight(1, squad, yocto(0)));
    assert!(start.steps.is_empty() && start.last_events.is_empty());

    // The opening: both sides send a beast in, in one step.
    let opening = chain.ok(AVA, |contract| contract.den_act(11));
    assert_eq!(opening.battle.active[0], 1);
    assert_eq!((opening.steps.len(), opening.steps[0].turn, opening.battle.turn), (1, 1, 1));
    assert_eq!(opening.steps[0].events, opening.last_events);
    assert!(matches!(opening.last_events[..], [Event::Pick { side: 0, slot: 1 }, Event::Pick { side: 1, .. }]));

    // Played to the end, every kept step is one turn after the one before it.
    let end = chain.play_den_fight(AVA, MOVE_STRIKE);
    assert_eq!(end.steps.len(), 4);
    let turns: Vec<u32> = end.steps.iter().map(|step| step.turn).collect();
    assert_eq!(turns, (end.battle.turn - 3..=end.battle.turn).collect::<Vec<_>>());
    // A read of the stored match gives the same thing the call returned.
    let stored = chain.view(|contract| contract.get_match(end.id)).unwrap();
    assert_eq!((stored.steps.len(), stored.last_events), (4, end.last_events));

    // A forfeit is not a step: it leaves the history alone and reports only the ending.
    chain.ok(AVA, |contract| contract.start_den_fight(1, squad, yocto(0)));
    chain.ok(AVA, |contract| contract.den_act(10));
    let forfeit = chain.ok(AVA, |contract| contract.forfeit_den());
    assert_eq!(forfeit.steps.len(), 1);
    assert_eq!(forfeit.last_events, vec![Event::Over { winner: 1 }]);
}

#[test]
fn the_den_answers_in_the_same_call() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 0);
    let mut saw_den_pick_alone = false;
    for _ in 0..6 {
        let mut fight = chain.ok(AVA, |contract| contract.start_den_fight(0, squad, yocto(0)));
        while !fight.over {
            let (turn, action) = (fight.battle.turn, legal_action(&fight, 0, MOVE_STRIKE));
            fight = chain.ok(AVA, |contract| contract.den_act(action));
            if fight.battle.turn == turn + 2 {
                // The den's beast fell, and the den sent in its next one before the call returned.
                let [.., exchange, den_pick] = &fight.steps[..] else { panic!("two steps were played") };
                assert!(exchange.events.iter().any(|event| matches!(event, Event::Ko { side: 1, .. })));
                assert!(matches!(den_pick.events[..], [Event::Pick { side: 1, .. }]));
                assert_eq!(fight.need, [true, true]);
                saw_den_pick_alone = true;
            }
        }
    }
    assert!(saw_den_pick_alone);
}

#[test]
fn payout_follows_the_last_ten_staked_fights() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 5);
    let mut memory: Vec<bool> = Vec::new();
    let mut lowest = rules::DEN_PAYOUT_HIGH_BPS;
    // Four forfeits, then nine fights played out: thirteen staked results in all.
    for round in 0..13 {
        let habit = (round >= 4).then_some(MOVE_STRIKE);
        let end = fight_and_check(&mut chain, AVA, 0, squad, CENT, habit);
        memory.push(end.winner == Some(1));
        if memory.len() > 10 {
            memory.remove(0);
        }
        let den = chain.den(0);
        let wins = memory.iter().filter(|den_won| **den_won).count() as u32;
        assert_eq!((den.wins, den.fights), (wins, memory.len() as u32));
        assert_eq!(den.payout_bps, rules::den_payout_bps(wins, memory.len() as u32));
        assert!(den.reason.contains("Old Grist"));
        lowest = lowest.min(den.payout_bps);
        match round {
            0 | 1 => assert_eq!(den.payout_bps, rules::DEN_PAYOUT_NEW_BPS, "too few fights on record"),
            2 | 3 => assert_eq!(den.payout_bps, rules::DEN_PAYOUT_HIGH_BPS, "a den on a winning run pays the most"),
            _ => {}
        }
    }
    assert_eq!(chain.den(0).fights, 10);
    assert!(lowest < rules::DEN_PAYOUT_HIGH_BPS, "losses bring the payout down");
    // A free spar is not remembered.
    fight_and_check(&mut chain, AVA, 0, squad, 0, None);
    assert_eq!(chain.den(0).fights, 10);
}

#[test]
fn a_den_takes_stakes_within_its_limits() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 1);
    let theos = chain.join(THEO, [0, 1, 2], 0);

    chain.fails(AVA, |contract| contract.start_den_fight(0, squad, yocto(CENT + CENT / 2)), "whole number of hundredths");
    chain.fails(AVA, |contract| contract.start_den_fight(0, squad, yocto(16 * CENT)), "takes stakes of up to 0.15 NEAR");
    chain.fails(THEO, |contract| contract.start_den_fight(0, theos, yocto(CENT)), "Your balance is too low.");
    chain.fails(AVA, |contract| contract.start_den_fight(5, squad, yocto(0)), "There is no such den.");
    chain.fails(AVA, |contract| contract.start_den_fight(0, [squad[0], squad[1], squad[0]], yocto(0)), "three different beasts");
    chain.fails(AVA, |contract| contract.start_den_fight(0, [squad[0], squad[1], theos[0]], yocto(0)), "is not yours to field");
    chain.fails(AVA, |contract| contract.start_den_fight(0, [squad[0], squad[1], 77], yocto(0)), "There is no beast #77.");
    chain.fails(AVA, |contract| contract.den_act(10), "You have no den fight in progress.");
    chain.fails(AVA, |contract| contract.forfeit_den(), "You have no den fight in progress.");

    // The most the den takes is fine, and only one fight runs at a time.
    let first = chain.ok(AVA, |contract| contract.start_den_fight(0, squad, yocto(15 * CENT)));
    chain.fails(AVA, |contract| contract.start_den_fight(1, squad, yocto(0)), "Finish your den fight first");

    // Only legal actions are played.
    chain.fails(AVA, |contract| contract.den_act(0), "Choose which beast to send in.");
    chain.fails(AVA, |contract| contract.den_act(13), "Choose which beast to send in.");
    chain.ok(AVA, |contract| contract.den_act(12));
    chain.fails(AVA, |contract| contract.den_act(3), "The Special needs a full Rage bar.");
    chain.fails(AVA, |contract| contract.den_act(10), "Unknown move.");
    chain.fails(AVA, |contract| contract.den_act(22), "That beast is already in the pit.");
    let turn = chain.view(|contract| contract.get_match(first.id)).unwrap().battle.turn;
    assert_eq!(turn, 1, "a refused action changes nothing");
    // A swap instead of a move: Ava's first beast comes in and her third goes back.
    let swapped = chain.ok(AVA, |contract| contract.den_act(20));
    assert!(swapped.last_events.contains(&Event::Swap { side: 0, slot: 0 }));
    assert_eq!(swapped.battle.active[0], 0);

    chain.ok(AVA, |contract| contract.forfeit_den());
    chain.fails(AVA, |contract| contract.forfeit_den(), "You have no den fight in progress.");
    chain.fails(AVA, |contract| contract.den_act(0), "You have no den fight in progress.");

    // The finished fight stays readable until the next one starts, then it is cleared away.
    assert!(chain.view(|contract| contract.get_match(first.id)).unwrap().over);
    assert_eq!(chain.player(AVA).den_match, Some(first.id));
    let second = chain.ok(AVA, |contract| contract.start_den_fight(1, squad, yocto(0)));
    assert!(chain.view(|contract| contract.get_match(first.id)).is_none());
    assert_eq!(chain.player(AVA).den_match, Some(second.id));
    chain.assert_books_balance();
}

#[test]
fn a_closed_den_refuses_stakes() {
    // 2 NEAR between five dens is 0.4 each: under the half NEAR a den needs to stay open.
    let mut chain = Chain::deploy(2 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 1);
    let den = chain.den(3);
    assert!(!den.open);
    assert_eq!(den.max_stake.0, 0);
    assert!(den.reason.contains("closed its doors"));
    chain.fails(AVA, |contract| contract.start_den_fight(3, squad, yocto(CENT)), "has closed its doors");
    // A free spar is still on offer.
    fight_and_check(&mut chain, AVA, 3, squad, 0, None);
}

/// The level of a den's beasts in a fight that has just started. All three share it, carry
/// no relic, and have the stats the rules give their species at that level.
fn den_level(fight: &MatchView, den_id: u8) -> u32 {
    let level = fight.battle.teams[1][0].level;
    for (fighter, species) in fight.battle.teams[1].iter().zip(data::DENS[den_id as usize].squad) {
        let kind = data::species(species).unwrap();
        assert_eq!((fighter.token, fighter.species, fighter.relic, fighter.level), (0, species, 0, level));
        let stats = [kind.hp, kind.atk, kind.def, kind.spd].map(|base| rules::stat_at_level(base, level));
        assert_eq!([fighter.max_hp, fighter.atk, fighter.def, fighter.spd], stats);
    }
    level
}

#[test]
fn a_den_matches_the_challenger_only_when_there_is_a_stake() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 20);
    // A squad of three level 11 beasts.
    for beast in squad {
        for _ in 0..10 {
            chain.ok(AVA, |contract| contract.level_up(beast, false));
        }
    }

    // In a free spar a den's beasts have the level of its tier, whatever the challenger
    // brings: Old Grist (tier 1) is at level 1, and the tougher dens at 5, 9, 13 and 17.
    for (den, level) in data::DENS.iter().zip([1, 5, 9, 13, 17]) {
        let spar = chain.ok(AVA, |contract| contract.start_den_fight(den.id, squad, yocto(0)));
        assert_eq!(den_level(&spar, den.id), level);
        assert_eq!((chain.den(den.id).spar_level, rules::den_spar_level(den.tier)), (level, level));
        chain.ok(AVA, |contract| contract.forfeit_den());
    }

    // With a stake on it, the den matches the challenger level for level.
    let staked = chain.ok(AVA, |contract| contract.start_den_fight(0, squad, yocto(CENT)));
    assert_eq!(den_level(&staked, 0), 11);
}

#[test]
fn a_staked_den_takes_the_average_level_rounded_down() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 5);
    // Levels 4, 1 and 2 average 2.
    for (beast, levels) in squad.iter().zip([3, 0, 1]) {
        for _ in 0..levels {
            chain.ok(AVA, |contract| contract.level_up(*beast, false));
        }
    }
    let staked = chain.ok(AVA, |contract| contract.start_den_fight(0, squad, yocto(CENT)));
    assert_eq!(den_level(&staked, 0), 2);
}

#[test]
fn a_den_trains_on_its_winnings_up_to_four_levels() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 20);
    // How far Old Grist's beasts are above the challenger's average level in a staked fight,
    // and above the den's own spar level in a free one.
    let edge = |chain: &mut Chain| {
        let average = squad.iter().map(|beast_id| chain.beast(*beast_id).level).sum::<u32>() / 3;
        let staked = chain.ok(AVA, |contract| contract.start_den_fight(0, squad, yocto(CENT)));
        chain.ok(AVA, |contract| contract.forfeit_den());
        let spar = chain.ok(AVA, |contract| contract.start_den_fight(0, squad, yocto(0)));
        chain.ok(AVA, |contract| contract.forfeit_den());
        (den_level(&staked, 0) - average, den_level(&spar, 0) - rules::den_spar_level(1))
    };
    assert_eq!(edge(&mut chain), (0, 0));

    // Staked losses pay for the den's training. Once it has bought 4 levels, its beasts
    // fight one level higher, in staked fights and free spars alike.
    while chain.den(0).training_levels < 4 {
        fight_and_check(&mut chain, AVA, 0, squad, 15 * CENT, None);
    }
    let den = chain.den(0);
    assert_eq!((den.level_bonus, rules::den_level_bonus(den.training_levels)), (1, 1));
    assert!(den.reason.contains("1 level above yours"), "{}", den.reason);
    assert_eq!(edge(&mut chain), (1, 1));

    // However much more it trains, they are never more than four levels higher.
    while chain.den(0).training_levels < 20 {
        let most = chain.den(0).max_stake.0;
        fight_and_check(&mut chain, AVA, 0, squad, most, None);
    }
    let den = chain.den(0);
    assert_eq!(den.level_bonus, rules::DEN_BONUS_MAX);
    assert!(den.reason.contains("4 levels above yours"), "{}", den.reason);
    assert_eq!(edge(&mut chain), (4, 4));
}

#[test]
fn den_shares_follow_the_bankroll_up_and_down() {
    let mut chain = Chain::deploy(15 * NEAR);
    chain.join(AVA, [0, 1, 2], 20);
    chain.join(THEO, [0, 1, 2], 20);
    let miras = chain.join(MIRA, [0, 1, 2], 20);

    // While the den has only won nothing and lost nothing, a share is worth one yoctoNEAR.
    assert_eq!(chain.ok(AVA, |contract| contract.back_den(0, yocto(NEAR))).0, NEAR);
    assert!(chain.events("mt_mint")[0].contains(r#""token_ids":["den:0"]"#));
    let den = chain.den(0);
    assert_eq!((den.bankroll.0, den.shares.0), (4 * NEAR, 4 * NEAR));
    let backing = chain.player(AVA).backing;
    assert_eq!(backing.len(), 1);
    assert_eq!((backing[0].den, backing[0].shares.0, backing[0].value.0), (0, NEAR, NEAR));
    assert_eq!(chain.balance(AVA), 19 * NEAR);

    // The den wins five stakes of 0.2 NEAR and banks 0.18 of each: 4.9 NEAR behind the same shares.
    for _ in 0..5 {
        fight_and_check(&mut chain, MIRA, 0, miras, 20 * CENT, None);
    }
    let den = chain.den(0);
    assert_eq!((den.bankroll.0, den.shares.0), (4 * NEAR + 90 * CENT, 4 * NEAR));
    assert_eq!(chain.player(AVA).backing[0].value.0, NEAR + 225 * rules::MILLI);

    // A new backer now gets fewer shares for the same NEAR: 1 × 4 / 4.9 of a share per yoctoNEAR.
    let minted = chain.ok(THEO, |contract| contract.back_den(0, yocto(NEAR))).0;
    assert_eq!(minted, 40 * NEAR / 49);
    assert_floor_of(minted, NEAR, 4 * NEAR, 4 * NEAR + 90 * CENT);
    let theos_value = chain.player(THEO).backing[0].value.0;
    assert!(theos_value <= NEAR && NEAR - theos_value <= 3, "a backer gets what they paid for, less only dust");
    assert_eq!(chain.player(AVA).backing[0].value.0, NEAR + 225 * rules::MILLI, "old backers are not diluted");

    // The den loses two stakes: every share is worth less.
    let mut losses = 0;
    while losses < 2 {
        losses += (fight_and_check(&mut chain, MIRA, 0, miras, 20 * CENT, Some(MOVE_STRIKE)).winner == Some(0)) as u32;
    }

    // Cashing out pays exactly shares × bankroll / all shares, rounded down.
    for (who, shares) in [(AVA, NEAR), (THEO, minted)] {
        let (den, balance, value) = (chain.den(0), chain.balance(who), chain.player(who).backing[0].value.0);
        chain.fails(who, |contract| contract.unback_den(0, yocto(shares + 1)), "You don't hold that many shares");
        let half = shares / 2;
        let paid = chain.ok(who, |contract| contract.unback_den(0, yocto(half))).0;
        assert_floor_of(paid, half, den.bankroll.0, den.shares.0);
        assert!(chain.events("mt_burn")[0].contains(r#""token_ids":["den:0"]"#));
        let den_after = chain.den(0);
        assert_eq!((den_after.bankroll.0, den_after.shares.0), (den.bankroll.0 - paid, den.shares.0 - half));
        assert_eq!(chain.balance(who), balance + paid);
        let rest = chain.ok(who, |contract| contract.unback_den(0, yocto(shares - half))).0;
        assert!(value.abs_diff(paid + rest) <= 1, "cashing out in two parts is within a yoctoNEAR of doing it at once");
        assert!(chain.player(who).backing.is_empty());
        chain.fails(who, |contract| contract.unback_den(0, yocto(1)), "You don't hold that many shares");
    }
    // Only the house's first shares are left.
    assert_eq!(chain.den(0).shares.0, 3 * NEAR);
    assert_eq!(chain.view(|contract| contract.mt_balance_of(account(HOUSE), "den:0".to_string())).0, 3 * NEAR);

    chain.fails(AVA, |contract| contract.unback_den(0, yocto(0)), "Name how many shares");
    chain.fails(AVA, |contract| contract.back_den(0, yocto(0)), "Back a den with more than nothing.");
    chain.fails(AVA, |contract| contract.back_den(0, yocto(100 * NEAR)), "Your balance is too low.");
    chain.fails(AVA, |contract| contract.back_den(9, yocto(NEAR)), "There is no such den.");
    chain.assert_books_balance();
}

#[test]
fn the_house_backs_dens_from_its_treasury() {
    let mut chain = Chain::deploy(15 * NEAR);
    chain.join(AVA, [0, 1, 2], 5);
    chain.ok(AVA, |contract| contract.buy_item(1, yocto(NEAR)));
    assert_eq!(chain.treasury(), 25 * CENT);

    chain.fails(AVA, |contract| contract.house_back_den(1, yocto(CENT)), "Only the house can do that.");
    chain.fails(HOUSE, |contract| contract.house_back_den(1, yocto(NEAR)), "The treasury does not hold that much.");
    chain.fails(HOUSE, |contract| contract.house_back_den(1, yocto(0)), "Back a den with more than nothing.");
    chain.ok(HOUSE, |contract| contract.house_back_den(1, yocto(20 * CENT)));
    let den = chain.den(1);
    assert_eq!((den.bankroll.0, den.shares.0), (3 * NEAR + 20 * CENT, 3 * NEAR + 20 * CENT));
    assert_eq!(chain.treasury(), 5 * CENT);
    assert_eq!(chain.view(|contract| contract.mt_balance_of(account(HOUSE), "den:1".to_string())).0, 3 * NEAR + 20 * CENT);
    assert!(chain.events("mt_mint")[0].contains(r#""owner_id":"maulstreet.testnet""#));
    chain.assert_books_balance();
}

#[test]
fn backers_open_and_close_a_den() {
    let mut chain = Chain::deploy(2 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 1);
    assert!(!chain.den(2).open);

    // A tenth of a NEAR lifts Coin-Eyed Vesh to the half NEAR it needs.
    let shares = chain.ok(AVA, |contract| contract.back_den(2, yocto(10 * CENT))).0;
    assert!(chain.den(2).open);
    assert_eq!(chain.den(2).max_stake.0, 2 * CENT);
    assert_eq!(chain.headline(), "Coin-Eyed Vesh is open for stakes again");
    fight_and_check(&mut chain, AVA, 2, squad, 2 * CENT, None);
    assert_eq!(chain.headline(), "Coin-Eyed Vesh took 0.02 NEAR from ava.testnet");

    chain.ok(AVA, |contract| contract.unback_den(2, yocto(shares)));
    assert!(!chain.den(2).open);
    assert_eq!(chain.headline(), "Coin-Eyed Vesh has closed its doors");
    chain.fails(AVA, |contract| contract.start_den_fight(2, squad, yocto(CENT)), "has closed its doors");
    chain.assert_books_balance();
}
