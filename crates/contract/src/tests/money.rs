//! Joining, and NEAR in and out.

use maul_core::{battle, data, rules};

use super::*;

#[test]
fn new_splits_its_deposit_between_the_dens() {
    let mut chain = Chain::deploy(15 * NEAR + 3);
    for den in chain.view(|contract| contract.get_dens()) {
        assert_eq!(den.bankroll.0, 3 * NEAR);
        assert_eq!(den.shares.0, 3 * NEAR);
        assert!(den.open);
        assert_eq!(den.max_stake.0, rules::den_max_stake(3 * NEAR));
        assert_eq!(den.payout_bps, rules::DEN_PAYOUT_NEW_BPS);
        // The house holds those first shares, under the contract's own account.
        let token_id = format!("den:{}", den.id);
        assert_eq!(chain.view(|contract| contract.mt_balance_of(account(HOUSE), token_id)).0, 3 * NEAR);
    }
    // The three yoctoNEAR that do not split five ways stay with the house.
    assert_eq!(chain.treasury(), 3);
    assert_eq!(chain.events("mt_mint").len(), 1);
    chain.assert_books_balance();
}

#[test]
fn register_takes_three_different_commons() {
    let mut chain = Chain::deploy(15 * NEAR);
    let stranger = chain.player(AVA);
    assert!(!stranger.registered);
    assert!(stranger.beasts.is_empty() && stranger.items.is_empty() && stranger.backing.is_empty());

    chain.fails(AVA, |contract| contract.register([0, 0, 1]), "Pick three different beasts.");
    chain.fails(AVA, |contract| contract.register([0, 1, 5]), "five common beasts");
    chain.fails(AVA, |contract| contract.register([0, 1, 200]), "five common beasts");

    let player = chain.ok(AVA, |contract| contract.register([0, 2, 4]));
    assert!(player.registered);
    assert_eq!(player.essence, rules::STARTING_ESSENCE);
    assert_eq!(player.rating, rules::RATING_START);
    assert_eq!(player.balance.0, 0);
    assert_eq!(player.beasts.len(), 3);
    for (beast, species) in player.beasts.iter().zip([0u8, 2, 4]) {
        let kind = data::species(species).unwrap();
        assert_eq!(beast.species, species);
        // A new beast is a level 1 cub, and goes by its cub's name.
        assert_eq!((beast.name.as_str(), beast.form, beast.form_name), (kind.forms[0], 0, kind.forms[0]));
        assert_eq!((beast.level, beast.xp, beast.xp_next), (1, 0, 100));
        assert_eq!(beast.owner, account(AVA));
        assert_eq!(beast.stats, [kind.hp, kind.atk, kind.def, kind.spd]);
        assert_eq!(beast.power, battle::power(&beast.stats));
    }
    assert_eq!(player.beasts.iter().map(|beast| beast.id).collect::<Vec<_>>(), vec![1, 2, 3]);
    let minted = chain.events("mt_mint");
    assert_eq!(minted.len(), 1);
    assert!(minted[0].contains(r#""token_ids":["beast:1","beast:2","beast:3"]"#));
    assert!(minted[0].contains(r#""owner_id":"ava.testnet""#));

    chain.fails(AVA, |contract| contract.register([1, 2, 3]), "already joined");

    let stats = chain.view(|contract| contract.get_stats());
    assert_eq!((stats.players, stats.beasts), (1, 3));
    assert_eq!(chain.view(|contract| contract.get_beast(2)).unwrap().name, "Pebblit");
    assert!(chain.view(|contract| contract.get_beast(4)).is_none());
    assert_eq!(chain.view(|contract| contract.get_beasts(vec![3, 9, 1])).iter().map(|b| b.id).collect::<Vec<_>>(), vec![3, 1]);
}

#[test]
fn deposits_and_withdrawals_add_up() {
    let mut chain = Chain::deploy(15 * NEAR);
    let error = chain.call(AVA, NEAR, |contract| contract.deposit()).unwrap_err();
    assert!(error.contains("Join Maul Street first"), "{error}");
    chain.join(AVA, [0, 1, 2], 0);
    chain.fails(AVA, |contract| contract.deposit(), "Attach the NEAR");

    let balance = chain.call(AVA, 2 * NEAR, |contract| contract.deposit()).unwrap();
    assert_eq!(balance.0, 2 * NEAR);
    let balance = chain.call(AVA, NEAR / 4, |contract| contract.deposit()).unwrap();
    assert_eq!(balance.0, 2 * NEAR + NEAR / 4);

    chain.ok(AVA, |contract| contract.withdraw(yocto(NEAR / 2)).detach());
    assert_eq!(chain.transfers, vec![(account(AVA), NEAR / 2)]);
    assert_eq!(chain.balance(AVA), NEAR + 3 * NEAR / 4);

    chain.fails(AVA, |contract| contract.withdraw(yocto(2 * NEAR)), "Your balance is too low.");
    chain.fails(AVA, |contract| contract.withdraw(yocto(0)), "Name an amount");
    chain.fails(THEO, |contract| contract.withdraw(yocto(1)), "Join Maul Street first");
    assert_eq!(chain.balance(AVA), NEAR + 3 * NEAR / 4);

    let ledger = chain.view(|contract| contract.get_ledger());
    assert_eq!(ledger.deposited.0, 15 * NEAR + 2 * NEAR + NEAR / 4);
    assert_eq!(ledger.withdrawn.0, NEAR / 2);
    assert_eq!(ledger.balances.0, NEAR + 3 * NEAR / 4);
    chain.assert_books_balance();

    // Down to the last yoctoNEAR.
    chain.ok(AVA, |contract| contract.withdraw(yocto(NEAR + 3 * NEAR / 4)).detach());
    assert_eq!(chain.balance(AVA), 0);
    chain.assert_books_balance();
}
