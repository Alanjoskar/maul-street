//! The NEP-245 face of beasts, items, Essence and den shares.

use maul_core::rules;

use super::*;

/// Ava holds a bit of everything. Theo has just joined. Mira has not.
fn holdings() -> (Chain, [u64; 3], [u64; 3]) {
    let mut chain = Chain::deploy(15 * NEAR);
    let avas = chain.join(AVA, [0, 1, 2], 5);
    let theos = chain.join(THEO, [2, 3, 4], 1);
    for item in [1, 1, 20] {
        chain.ok(AVA, |contract| contract.buy_item(item, yocto(NEAR)));
    }
    chain.ok(AVA, |contract| contract.back_den(0, yocto(NEAR)));
    (chain, avas, theos)
}

fn balance_of(chain: &mut Chain, who: &str, token_id: &str) -> u128 {
    chain.view(|contract| contract.mt_balance_of(account(who), token_id.to_string())).0
}

fn supply_of(chain: &mut Chain, token_id: &str) -> Option<u128> {
    chain.view(|contract| contract.mt_supply(token_id.to_string())).map(|supply| supply.0)
}

/// A transfer with the one yoctoNEAR the standard asks for.
fn send(chain: &mut Chain, from: &str, to: &str, token_id: &str, amount: u128, memo: Option<&str>) -> Result<(), String> {
    let (to, token_id, memo) = (account(to), token_id.to_string(), memo.map(str::to_string));
    chain.call(from, 1, |contract| contract.mt_transfer(to, token_id, yocto(amount), None, memo))
}

fn send_fails(chain: &mut Chain, from: &str, to: &str, token_id: &str, amount: u128, expected: &str) {
    let error = send(chain, from, to, token_id, amount, None).unwrap_err();
    assert!(error.contains(expected), "expected `{expected}`, got `{error}`");
}

#[test]
fn balances_and_supplies_read_like_tokens() {
    let (mut chain, avas, _) = holdings();
    let chain = &mut chain;
    assert_eq!(balance_of(chain, AVA, "beast:1"), 1);
    assert_eq!(balance_of(chain, THEO, "beast:1"), 0);
    assert_eq!(balance_of(chain, AVA, "item:1"), 2);
    assert_eq!(balance_of(chain, AVA, "item:20"), 1);
    assert_eq!(balance_of(chain, AVA, "item:2"), 0);
    assert_eq!(balance_of(chain, AVA, "essence"), rules::STARTING_ESSENCE as u128);
    assert_eq!(balance_of(chain, AVA, "den:0"), NEAR);
    assert_eq!(balance_of(chain, HOUSE, "den:0"), 3 * NEAR);
    assert_eq!(balance_of(chain, MIRA, "essence"), 0);
    assert_eq!(balance_of(chain, AVA, "gold"), 0);
    let ids = ["beast:2", "item:1", "essence", "den:0", "den:1"].map(str::to_string).to_vec();
    let batch = chain.view(|contract| contract.mt_batch_balance_of(account(AVA), ids));
    assert_eq!(batch.iter().map(|balance| balance.0).collect::<Vec<_>>(), vec![1, 2, 100, NEAR, 0]);

    assert_eq!(supply_of(chain, "beast:6"), Some(1));
    assert_eq!(supply_of(chain, "beast:7"), None);
    assert_eq!(supply_of(chain, "item:1"), Some(2));
    assert_eq!(supply_of(chain, "item:2"), Some(0));
    assert_eq!(supply_of(chain, "essence"), Some(2 * rules::STARTING_ESSENCE as u128));
    assert_eq!(supply_of(chain, "den:0"), Some(4 * NEAR));
    // Only ids written the way the contract writes them name a token.
    for stranger in ["item:7", "den:5", "beast:01", "beast:", "beast", "essence:1", "Essence", ""] {
        assert_eq!(supply_of(chain, stranger), None, "{stranger}");
    }
    // An item a beast wears leaves the inventory, and the supply with it.
    chain.ok(AVA, |contract| contract.equip(avas[0], 1));
    assert_eq!((balance_of(chain, AVA, "item:1"), supply_of(chain, "item:1")), (1, Some(1)));

    let ids = ["beast:1", "beast:99", "item:1", "essence", "den:4", "nonsense"].map(str::to_string).to_vec();
    let tokens = chain.view(|contract| contract.mt_token(ids));
    let owners: Vec<Option<Option<&str>>> =
        tokens.iter().map(|token| token.as_ref().map(|token| token.owner_id.as_ref().map(|owner| owner.as_str()))).collect();
    assert_eq!(owners, vec![Some(Some(AVA)), None, Some(None), Some(None), Some(None), None]);
    assert_eq!(tokens[0].as_ref().unwrap().token_id, "beast:1");

    let held = |chain: &mut Chain, from: Option<u128>, limit: Option<u32>| -> Vec<String> {
        chain
            .view(|contract| contract.mt_tokens_for_owner(account(AVA), from.map(U128), limit))
            .into_iter()
            .map(|token| token.token_id)
            .collect()
    };
    assert_eq!(held(chain, None, None), ["beast:1", "beast:2", "beast:3", "item:1", "item:20", "essence", "den:0"]);
    assert_eq!(held(chain, Some(2), Some(3)), ["beast:3", "item:1", "item:20"]);
    assert!(chain.view(|contract| contract.mt_tokens_for_owner(account(MIRA), None, None)).is_empty());
}

#[test]
fn the_house_holds_its_den_shares_under_the_contract_account() {
    let (mut chain, _, _) = holdings();
    let chain = &mut chain;
    let held = |chain: &mut Chain| -> Vec<String> {
        chain.view(|contract| contract.mt_tokens_for_owner(account(HOUSE), None, None)).into_iter().map(|token| token.token_id).collect()
    };
    assert_eq!(held(chain), ["den:0", "den:1", "den:2", "den:3", "den:4"]);
    assert_eq!(balance_of(chain, HOUSE, "den:3"), 3 * NEAR);
    assert_eq!(balance_of(chain, HOUSE, "essence"), 0);

    // If the house account also plays, what it holds as a player is counted with the house's shares.
    chain.join(HOUSE, [0, 1, 2], 2);
    let shares = chain.ok(HOUSE, |contract| contract.back_den(3, yocto(NEAR))).0;
    assert_eq!(balance_of(chain, HOUSE, "den:3"), 3 * NEAR + shares);
    assert_eq!(supply_of(chain, "den:3"), Some(3 * NEAR + shares));
    assert_eq!(held(chain)[..4], ["beast:7", "beast:8", "beast:9", "essence"]);
    assert_eq!(held(chain).len(), 9);
    chain.assert_books_balance();
}

#[test]
fn a_beast_changes_hands_with_what_it_wears() {
    let (mut chain, avas, _) = holdings();
    let chain = &mut chain;
    let beast = avas[0];
    chain.ok(AVA, |contract| contract.equip(beast, 1));
    chain.ok(AVA, |contract| contract.list_for_hire(beast, yocto(CENT)));
    chain.ok(THEO, |contract| contract.hire(beast, 2));

    // The standard asks for exactly one yoctoNEAR, and the receiver must be a player.
    let (to, token_id) = (account(THEO), "beast:1".to_string());
    chain.fails(AVA, |contract| contract.mt_transfer(to, token_id, yocto(1), None, None), "exactly 1 yoctoNEAR");
    send_fails(chain, AVA, MIRA, "beast:1", 1, "The receiver has not joined Maul Street yet.");
    send_fails(chain, AVA, AVA, "beast:1", 1, "You can't transfer to yourself.");
    send_fails(chain, THEO, AVA, "beast:1", 1, "Only the beast's owner can do that.");
    send_fails(chain, AVA, THEO, "beast:1", 2, "transfer exactly 1");
    send_fails(chain, AVA, THEO, "beast:1", 0, "Transfer more than nothing.");
    send_fails(chain, AVA, THEO, "beast:99", 1, "There is no such beast.");
    send_fails(chain, AVA, THEO, "dragon:1", 1, "There is no such token.");
    let (to, token_id, approval) = (account(THEO), "beast:1".to_string(), Some((account(AVA), 0)));
    let error = chain.call(AVA, 1, |contract| contract.mt_transfer(to, token_id, yocto(1), approval, None)).unwrap_err();
    assert!(error.contains("Approvals are not supported."), "{error}");

    send(chain, AVA, THEO, "beast:1", 1, Some("a gift")).unwrap();
    let event = chain.events("mt_transfer")[0].clone();
    for part in [
        r#""standard":"nep245""#,
        r#""version":"1.0.0""#,
        r#""old_owner_id":"ava.testnet""#,
        r#""new_owner_id":"theo.testnet""#,
        r#""token_ids":["beast:1"]"#,
        r#""amounts":["1"]"#,
        r#""memo":"a gift""#,
    ] {
        assert!(event.contains(part), "{part} is missing from {event}");
    }

    // The beast is Theo's now, relic and all, and it is off the hire market.
    let moved = chain.view(|contract| contract.get_beast(beast)).unwrap();
    assert_eq!((moved.owner.as_str(), moved.relic, moved.hire_price.is_none()), (THEO, 1, true));
    assert!(chain.view(|contract| contract.get_hire_market(None, None)).is_empty());
    assert_eq!((balance_of(chain, AVA, "beast:1"), balance_of(chain, THEO, "beast:1")), (0, 1));
    assert_eq!(chain.player(AVA).beasts.iter().map(|beast| beast.id).collect::<Vec<_>>(), vec![2, 3]);
    assert_eq!(chain.player(THEO).beasts.iter().map(|beast| beast.id).collect::<Vec<_>>(), vec![4, 5, 6, 1]);
    assert_eq!(chain.view(|contract| contract.mt_token(vec!["beast:1".to_string()]))[0].as_ref().unwrap().owner_id, Some(account(THEO)));
    // Theo owns it, so the fights he had paid for are forgotten. He can level it up, and Ava no longer can.
    assert!(chain.player(THEO).hires.is_empty());
    chain.fails(AVA, |contract| contract.level_up(beast, false), "Only the beast's owner can do that.");
    assert_eq!(chain.ok(THEO, |contract| contract.level_up(beast, true)).level, 2);
    chain.assert_books_balance();
}

#[test]
fn a_transferred_beast_keeps_its_paid_fights() {
    let (mut chain, avas, theos) = holdings();
    let chain = &mut chain;
    let mira = chain.join(MIRA, [0, 1, 2], 1);
    chain.ok(AVA, |contract| contract.list_for_hire(avas[0], yocto(CENT)));
    chain.ok(MIRA, |contract| contract.hire(avas[0], 2));
    send(chain, AVA, THEO, "beast:1", 1, None).unwrap();
    // Mira paid Ava for two fights with it. They stand, whoever owns the beast now.
    assert_eq!(chain.player(MIRA).hires[0].fights_left, 2);
    chain.ok(MIRA, |contract| contract.start_den_fight(0, [avas[0], mira[1], mira[2]], yocto(0)));
    assert_eq!(chain.player(MIRA).hires[0].fights_left, 1);
    // Ava can no longer field it, and Theo can.
    chain.fails(AVA, |contract| contract.start_den_fight(0, avas, yocto(0)), "is not yours to field");
    chain.ok(THEO, |contract| contract.start_den_fight(0, [avas[0], theos[1], theos[2]], yocto(0)));
}

#[test]
fn a_batch_moves_everything_or_nothing() {
    let (mut chain, _, _) = holdings();
    let chain = &mut chain;
    let batch = |chain: &mut Chain, token_ids: &[&str], amounts: &[u128]| {
        let token_ids = token_ids.iter().map(|id| id.to_string()).collect();
        let amounts = amounts.iter().map(|amount| yocto(*amount)).collect();
        chain.call(AVA, 1, |contract| contract.mt_batch_transfer(account(THEO), token_ids, amounts, None, None))
    };

    // The last line asks for more Essence than Ava has, so nothing moves at all.
    let error = batch(chain, &["item:1", "beast:2", "essence"], &[1, 1, 101]).unwrap_err();
    assert!(error.contains("You don't hold that much to transfer."), "{error}");
    assert_eq!((balance_of(chain, AVA, "item:1"), balance_of(chain, AVA, "beast:2")), (2, 1));
    let error = batch(chain, &["item:1", "essence"], &[1]).unwrap_err();
    assert!(error.contains("Give one amount for each token."), "{error}");
    let error = batch(chain, &[], &[]).unwrap_err();
    assert!(error.contains("Give one amount for each token."), "{error}");
    let error = batch(chain, &["item:1"], &[3]).unwrap_err();
    assert!(error.contains("You don't hold that much to transfer."), "{error}");
    let error = batch(chain, &["den:0"], &[NEAR + 1]).unwrap_err();
    assert!(error.contains("You don't hold that much to transfer."), "{error}");

    batch(chain, &["item:1", "item:20", "beast:2", "essence", "den:0"], &[2, 1, 1, 60, NEAR / 4]).unwrap();
    let events = chain.events("mt_transfer");
    assert_eq!(events.len(), 1, "one event for the whole batch");
    assert!(events[0].contains(r#""token_ids":["item:1","item:20","beast:2","essence","den:0"]"#));
    assert!(events[0].contains(r#""amounts":["2","1","1","60","250000000000000000000000"]"#));
    assert!(!events[0].contains("memo"));

    for (token_id, ava, theo) in [("item:1", 0, 2), ("item:20", 0, 1), ("beast:2", 0, 1), ("essence", 40, 160), ("den:0", 3 * NEAR / 4, NEAR / 4)] {
        assert_eq!((balance_of(chain, AVA, token_id), balance_of(chain, THEO, token_id)), (ava, theo), "{token_id}");
    }
    // Nothing was made or lost on the way.
    assert_eq!(supply_of(chain, "item:1"), Some(2));
    assert_eq!(supply_of(chain, "essence"), Some(200));
    assert_eq!(supply_of(chain, "den:0"), Some(4 * NEAR));
    assert_eq!(chain.player(THEO).items, vec![(1, 2), (20, 1)]);

    // Theo's shares are as good as Ava's: he cashes his quarter out.
    assert_eq!(chain.player(THEO).backing[0].value.0, NEAR / 4);
    assert_eq!(chain.ok(THEO, |contract| contract.unback_den(0, yocto(NEAR / 4))).0, NEAR / 4);
    let approvals = Some(vec![None, Some((account(AVA), 1))]);
    let error = chain
        .call(AVA, 1, |contract| {
            contract.mt_batch_transfer(account(THEO), vec!["essence".into(), "essence".into()], vec![yocto(1), yocto(1)], approvals, None)
        })
        .unwrap_err();
    assert!(error.contains("Approvals are not supported."), "{error}");
    chain.assert_books_balance();
}

#[test]
fn mints_and_burns_are_logged() {
    let mut chain = Chain::deploy(15 * NEAR);
    let avas = chain.join(AVA, [0, 1, 2], 5);
    let logged = |chain: &Chain, kind: &str, token_id: &str, amount: u128| {
        let events = chain.events(kind);
        assert_eq!(events.len(), 1, "one {kind} event");
        let parts =
            [format!(r#""amounts":["{amount}"]"#), r#""owner_id":"ava.testnet""#.to_string(), format!(r#""token_ids":["{token_id}"]"#)];
        for part in parts {
            assert!(events[0].contains(&part), "{part} is missing from {}", events[0]);
        }
    };
    chain.ok(AVA, |contract| contract.buy_item(40, yocto(NEAR)));
    logged(&chain, "mt_mint", "item:40", 1);
    chain.ok(AVA, |contract| contract.buy_beast(7, yocto(2 * NEAR)));
    logged(&chain, "mt_mint", "beast:4", 1);
    chain.ok(AVA, |contract| contract.equip(avas[0], 40));
    logged(&chain, "mt_burn", "item:40", 1);
    chain.ok(AVA, |contract| contract.unequip(avas[0], 2));
    logged(&chain, "mt_mint", "item:40", 1);
    let shares = chain.ok(AVA, |contract| contract.back_den(4, yocto(NEAR / 2))).0;
    logged(&chain, "mt_mint", "den:4", shares);
    chain.ok(AVA, |contract| contract.unback_den(4, yocto(shares)));
    logged(&chain, "mt_burn", "den:4", shares);
}
