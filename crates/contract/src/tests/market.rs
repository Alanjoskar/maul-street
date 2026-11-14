//! Levels, the bazaar, equipment and hiring.

use maul_core::{data, rules};

use super::*;

#[test]
fn a_level_bought_with_near_costs_the_rules_price() {
    let mut chain = Chain::deploy(15 * NEAR);
    let [cub, ..] = chain.join(AVA, [0, 1, 2], 1);
    chain.join(THEO, [0, 1, 2], 1);
    let kind = data::species(0).unwrap();

    // Three levels: 0.01 NEAR, then 0.011, then 0.0121. The house gets every yoctoNEAR.
    let mut paid = 0;
    for level in 1..=3 {
        let (balance, treasury) = (chain.balance(AVA), chain.treasury());
        let beast = chain.ok(AVA, |contract| contract.level_up(cub, false));
        let cost = rules::level_cost_near(level);
        paid += cost;
        assert_eq!(chain.balance(AVA), balance - cost);
        assert_eq!(chain.treasury(), treasury + cost);
        assert_eq!((beast.level, beast.xp, beast.xp_next), (level + 1, 0, rules::xp_for_level(level + 1)));
        // Each level adds 3% of the species' base stats.
        assert_eq!(beast.stats, [kind.hp, kind.atk, kind.def, kind.spd].map(|base| rules::stat_at_level(base, level + 1)));
    }
    assert_eq!(paid, 331 * rules::MILLI / 10);
    assert_eq!(chain.player(AVA).essence, rules::STARTING_ESSENCE, "a level bought with NEAR costs no Essence");
    assert_eq!(chain.view(|contract| contract.get_stats()).volume.0, paid);

    chain.fails(THEO, |contract| contract.level_up(cub, false), "Only the beast's owner can do that.");
    chain.fails(AVA, |contract| contract.level_up(99, false), "There is no such beast.");
    chain.ok(AVA, |contract| contract.withdraw(yocto(NEAR - paid)).detach());
    chain.fails(AVA, |contract| contract.level_up(cub, false), "Your balance is too low.");
    assert_eq!(chain.beast(cub).level, 4);
    chain.assert_books_balance();
}

#[test]
fn a_level_bought_with_essence_costs_the_xp_still_missing() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 1);
    let [cub, second, _] = squad;

    // A new beast has no XP, so its first level takes the 100 Essence a trainer starts with.
    let beast = chain.ok(AVA, |contract| contract.level_up(cub, true));
    assert_eq!((beast.level, beast.xp, beast.xp_next), (2, 0, 110));
    assert_eq!((chain.player(AVA).essence, chain.balance(AVA)), (0, NEAR), "a level bought with Essence costs no NEAR");
    chain.fails(AVA, |contract| contract.level_up(cub, true), "You don't have enough Essence. This level takes 110.");

    // Seven spars given up at once. Each leaves 8 Essence, and 7 XP on every beast that
    // stayed on the bench. The level now takes 110 - 49 = 61 Essence, and there are 56.
    let give_up = |chain: &mut Chain| {
        chain.ok(AVA, |contract| contract.start_den_fight(0, squad, yocto(0)));
        chain.ok(AVA, |contract| contract.forfeit_den());
    };
    for _ in 0..7 {
        give_up(&mut chain);
    }
    assert_eq!((chain.beast(cub).xp, chain.player(AVA).essence), (49, 56));
    chain.fails(AVA, |contract| contract.level_up(cub, true), "You don't have enough Essence. This level takes 61.");
    // One more spar: 54 Essence missing, 64 in hand. The Essence spent is burnt.
    give_up(&mut chain);
    let supply = |chain: &mut Chain| chain.view(|contract| contract.mt_supply("essence".to_string())).unwrap().0;
    let before = supply(&mut chain);
    let beast = chain.ok(AVA, |contract| contract.level_up(cub, true));
    assert_eq!((beast.level, beast.xp, beast.xp_next), (3, 0, 121));
    assert_eq!((chain.player(AVA).essence, supply(&mut chain)), (10, before - 54));

    // A level bought with NEAR leaves the beast the XP it has earned.
    assert_eq!((chain.beast(second).level, chain.beast(second).xp), (1, 56));
    let beast = chain.ok(AVA, |contract| contract.level_up(second, false));
    assert_eq!((beast.level, beast.xp, beast.xp_next), (2, 56, 110));
    assert_eq!(chain.balance(AVA), NEAR - rules::level_cost_near(1));
    chain.fails(THEO, |contract| contract.level_up(cub, true), "Only the beast's owner can do that.");
    chain.assert_books_balance();
}

#[test]
fn a_beast_goes_by_its_form_until_its_owner_names_it() {
    let mut chain = Chain::deploy(0);
    let [beast, other, _] = chain.join(AVA, [0, 1, 2], 1);
    chain.join(THEO, [0, 1, 2], 0);
    // A Cindermaw starts out as a Cinderpup, and is an Emberjaw from level 5.
    let cub = chain.beast(beast);
    assert_eq!((cub.name.as_str(), cub.form, cub.form_name), ("Cinderpup", 0, "Cinderpup"));
    for _ in 0..4 {
        chain.ok(AVA, |contract| contract.level_up(beast, false));
    }
    let grown = chain.beast(beast);
    assert_eq!((grown.level, grown.name.as_str(), grown.form, grown.form_name), (5, "Emberjaw", 1, "Emberjaw"));

    // A name from its owner stays, whatever form the beast grows into.
    assert_eq!(chain.ok(AVA, |contract| contract.rename_beast(beast, "Old Smoky #1".to_string())).name, "Old Smoky #1");
    for _ in 0..7 {
        chain.ok(AVA, |contract| contract.level_up(beast, false));
    }
    let named = chain.beast(beast);
    assert_eq!((named.level, named.name.as_str(), named.form, named.form_name), (12, "Old Smoky #1", 2, "Cindermaw"));
    assert_eq!(chain.beast(other).name, "Sproutling");

    chain.fails(AVA, |contract| contract.rename_beast(beast, String::new()), "A name is 1 to 24");
    chain.fails(AVA, |contract| contract.rename_beast(beast, "x".repeat(25)), "A name is 1 to 24");
    chain.fails(AVA, |contract| contract.rename_beast(beast, "Fluffy\n".to_string()), "A name is 1 to 24");
    chain.fails(AVA, |contract| contract.rename_beast(beast, "Flüffy".to_string()), "A name is 1 to 24");
    chain.fails(THEO, |contract| contract.rename_beast(beast, "Mine".to_string()), "Only the beast's owner");
}

#[test]
fn bazaar_prices_heat_up_and_cool_down() {
    let mut chain = Chain::deploy(15 * NEAR);
    chain.join(AVA, [0, 1, 2], 5);
    let floor = 250 * rules::MILLI;
    let shelf = |chain: &mut Chain| chain.view(|contract| contract.get_market()).items.swap_remove(0);
    assert_eq!((shelf(&mut chain).price.0, shelf(&mut chain).heat), (floor, 0));

    // Each purchase lifts the price by 4% of the floor.
    for bought in 0..3u128 {
        let (balance, treasury) = (chain.balance(AVA), chain.treasury());
        let price = floor + floor * 4 * bought / 100;
        chain.fails(AVA, |contract| contract.buy_item(1, yocto(price - 1)), "above the most you offered");
        assert_eq!(chain.ok(AVA, |contract| contract.buy_item(1, yocto(price))).0, price);
        assert_eq!(chain.balance(AVA), balance - price);
        assert_eq!(chain.treasury(), treasury + price);
        assert_eq!(chain.events("mt_mint").len(), 1);
    }
    let hot = shelf(&mut chain);
    assert_eq!((hot.heat, hot.sold, hot.price.0), (3, 3, floor * 112 / 100));
    assert_eq!(hot.floor.0, floor);
    assert_eq!(hot.reason, rules::price_reason(3));
    assert_eq!(chain.player(AVA).items, vec![(1, 3)]);

    // It cools one purchase's worth every ten quiet minutes, down to the floor.
    chain.wait(rules::HEAT_COOL_SECS - 1);
    assert_eq!(shelf(&mut chain).heat, 3);
    chain.wait(1);
    assert_eq!((shelf(&mut chain).heat, shelf(&mut chain).price.0), (2, floor * 108 / 100));
    // Buying at the cooled price heats it again from there.
    assert_eq!(chain.ok(AVA, |contract| contract.buy_item(1, yocto(NEAR))).0, floor * 108 / 100);
    assert_eq!(shelf(&mut chain).heat, 3);
    chain.wait(100 * rules::HEAT_COOL_SECS);
    assert_eq!((shelf(&mut chain).heat, shelf(&mut chain).price.0), (0, floor));

    // Other shelves are not touched.
    let market = chain.view(|contract| contract.get_market());
    assert_eq!(market.items.len(), data::ITEMS.len());
    assert_eq!(market.species.len(), data::SPECIES.len());
    assert!(market.items[1..].iter().all(|shelf| shelf.sold == 0));
    chain.fails(AVA, |contract| contract.buy_item(7, yocto(NEAR)), "The bazaar has no such item.");
    chain.fails(THEO, |contract| contract.buy_item(1, yocto(NEAR)), "Join Maul Street first");
    chain.assert_books_balance();
}

#[test]
fn rare_beasts_are_bought_and_make_the_ticker() {
    let mut chain = Chain::deploy(15 * NEAR);
    chain.join(AVA, [0, 1, 2], 5);
    let floor = 1200 * rules::MILLI;
    chain.fails(AVA, |contract| contract.buy_beast(5, yocto(floor - 1)), "above the most you offered");
    let beast = chain.ok(AVA, |contract| contract.buy_beast(5, yocto(floor)));
    assert_eq!((beast.id, beast.species, beast.level, beast.name.as_str()), (4, 5, 1, "Sparkwyrm"));
    assert_eq!(beast.owner, account(AVA));
    assert_eq!(chain.balance(AVA), 5 * NEAR - floor);
    assert_eq!(chain.headline(), "ava.testnet bought a rare Ashwyrm for 1.2 NEAR");
    assert!(chain.events("mt_mint")[0].contains(r#""token_ids":["beast:4"]"#));
    assert_eq!(chain.player(AVA).beasts.len(), 4);
    assert_eq!(chain.view(|contract| contract.get_market()).species[5].price.0, floor * 104 / 100);

    // A common beast costs less and stays off the ticker.
    let common = chain.ok(AVA, |contract| contract.buy_beast(3, yocto(NEAR)));
    assert_eq!(common.name, "Zapling");
    assert_eq!(chain.balance(AVA), 5 * NEAR - floor - 300 * rules::MILLI);
    assert_eq!(chain.headline(), "ava.testnet bought a rare Ashwyrm for 1.2 NEAR");
    chain.fails(AVA, |contract| contract.buy_beast(10, yocto(NEAR)), "There is no such kind of beast.");
    chain.assert_books_balance();
}

#[test]
fn equipment_moves_between_inventory_and_beast() {
    let mut chain = Chain::deploy(15 * NEAR);
    let [cindermaw, briarhorn, _] = chain.join(AVA, [0, 1, 2], 5);
    chain.join(THEO, [0, 1, 2], 1);
    for item in [1, 1, 2, 20, 40] {
        chain.ok(AVA, |contract| contract.buy_item(item, yocto(NEAR)));
    }
    let supply = |chain: &mut Chain, item: u8| chain.view(|contract| contract.mt_supply(format!("item:{item}"))).unwrap().0;
    assert_eq!(supply(&mut chain, 1), 2);

    // A Wildfang adds 10% attack, and leaves the inventory while it is worn.
    let beast = chain.ok(AVA, |contract| contract.equip(cindermaw, 1));
    assert_eq!((beast.relic, beast.stats[1]), (1, 85));
    assert_eq!(chain.player(AVA).items, vec![(1, 1), (2, 1), (20, 1), (40, 1)]);
    assert_eq!(supply(&mut chain, 1), 1);
    assert_eq!(chain.events("mt_burn").len(), 1);

    // An Ironhide Plate takes its place in the relic slot, and the Wildfang comes back.
    let beast = chain.ok(AVA, |contract| contract.equip(cindermaw, 2));
    assert_eq!((beast.relic, beast.stats[1], beast.stats[2]), (2, 78, 53));
    assert_eq!(chain.player(AVA).items, vec![(1, 2), (20, 1), (40, 1)]);
    assert_eq!((chain.events("mt_burn").len(), chain.events("mt_mint").len()), (1, 1));

    // Auras and finishers have slots of their own.
    chain.ok(AVA, |contract| contract.equip(cindermaw, 20));
    let beast = chain.ok(AVA, |contract| contract.equip(cindermaw, 40));
    assert_eq!((beast.relic, beast.aura, beast.finisher), (2, 20, 40));
    assert_eq!(chain.player(AVA).items, vec![(1, 2)]);

    let beast = chain.ok(AVA, |contract| contract.unequip(cindermaw, 0));
    assert_eq!((beast.relic, beast.stats[2]), (0, 48));
    assert_eq!(chain.player(AVA).items, vec![(1, 2), (2, 1)]);
    chain.fails(AVA, |contract| contract.unequip(cindermaw, 0), "That slot is already empty.");
    chain.fails(AVA, |contract| contract.unequip(cindermaw, 3), "Slots are");
    assert_eq!(chain.ok(AVA, |contract| contract.unequip(cindermaw, 1)).aura, 0);
    assert_eq!(chain.ok(AVA, |contract| contract.unequip(cindermaw, 2)).finisher, 0);

    chain.fails(AVA, |contract| contract.equip(briarhorn, 3), "You don't have that item.");
    chain.fails(AVA, |contract| contract.equip(briarhorn, 9), "The bazaar has no such item.");
    chain.fails(THEO, |contract| contract.equip(cindermaw, 1), "Only the beast's owner can do that.");
    chain.fails(THEO, |contract| contract.unequip(cindermaw, 0), "Only the beast's owner can do that.");
    // A failed equip leaves the beast as it was.
    assert_eq!(chain.view(|contract| contract.get_beast(briarhorn)).unwrap().relic, 0);
    assert_eq!(chain.player(AVA).items, vec![(1, 2), (2, 1), (20, 1), (40, 1)]);
}

#[test]
fn hiring_pays_the_owner_and_runs_out() {
    let mut chain = Chain::deploy(15 * NEAR);
    let [star, ..] = chain.join(AVA, [0, 1, 2], 1);
    let [_, theos_second, theos_third] = chain.join(THEO, [0, 1, 2], 1);
    let price = CENT;

    chain.fails(AVA, |contract| contract.list_for_hire(star, yocto(rules::MILLI - 1)), "The lowest hire price");
    chain.fails(THEO, |contract| contract.list_for_hire(star, yocto(price)), "Only the beast's owner can do that.");
    chain.fails(THEO, |contract| contract.hire(star, 1), "That beast is not for hire.");
    chain.ok(AVA, |contract| contract.list_for_hire(star, yocto(price)));
    let listed = chain.view(|contract| contract.get_hire_market(None, None));
    assert_eq!(listed.len(), 1);
    assert_eq!((listed[0].id, listed[0].hire_price.unwrap().0), (star, price));

    chain.fails(AVA, |contract| contract.hire(star, 1), "That beast is already yours.");
    chain.fails(THEO, |contract| contract.hire(star, 0), "Hire a beast for 1 to 20 fights");
    chain.fails(THEO, |contract| contract.hire(star, 21), "Hire a beast for 1 to 20 fights");

    // Three fights: 95% to the owner, 5% to the house.
    let (ava, theo, treasury) = (chain.balance(AVA), chain.balance(THEO), chain.treasury());
    let hirer = chain.ok(THEO, |contract| contract.hire(star, 3));
    let (cost, fee) = (3 * price, 3 * price * 5 / 100);
    assert_eq!(chain.balance(THEO), theo - cost);
    assert_eq!(chain.balance(AVA), ava + cost - fee);
    assert_eq!(chain.treasury(), treasury + fee);
    assert_eq!(chain.player(AVA).hire_income.0, cost - fee);
    assert_eq!(chain.view(|contract| contract.get_beast(star)).unwrap().earned.0, cost - fee);
    assert_eq!(hirer.hires.len(), 1);
    assert_eq!((hirer.hires[0].beast.id, hirer.hires[0].fights_left), (star, 3));
    assert_eq!(chain.headline(), "theo.testnet hired ava.testnet's Cinderpup for 3 fights (0.03 NEAR)");
    chain.fails(THEO, |contract| contract.hire(star, 18), "at most 20 paid fights");

    // The owner levels the beast up after it was hired. The hirer fields it as it is now.
    let trained = chain.ok(AVA, |contract| contract.level_up(star, false));
    let squad = [star, theos_second, theos_third];
    let fight = chain.ok(THEO, |contract| contract.start_den_fight(0, squad, yocto(0)));
    let fielded = &fight.battle.teams[0][0];
    assert_eq!((fielded.token, fielded.level, fielded.atk), (star, 2, trained.stats[1]));
    // A fight uses up one paid fight when it starts.
    assert_eq!(chain.player(THEO).hires[0].fights_left, 2);
    // The hired beast goes into the pit. What it learns there stays with it: it is the
    // owner's beast that comes back from hire stronger.
    chain.ok(THEO, |contract| contract.den_act(10));
    let lost = chain.ok(THEO, |contract| contract.forfeit_den());
    assert_eq!((lost.xp[0], lost.levels[0]), ([15, 7, 7], [2, 1, 1]));
    assert_eq!((chain.beast(star).owner, chain.beast(star).xp), (account(AVA), 15));

    // Taking the offer down stops new hires. Fights already paid for stay valid.
    chain.ok(AVA, |contract| contract.unlist(star));
    assert!(chain.view(|contract| contract.get_hire_market(None, None)).is_empty());
    assert!(chain.view(|contract| contract.get_beast(star)).unwrap().hire_price.is_none());
    chain.fails(THEO, |contract| contract.hire(star, 1), "That beast is not for hire.");
    for left in [1, 0] {
        chain.ok(THEO, |contract| contract.start_den_fight(0, squad, yocto(0)));
        chain.ok(THEO, |contract| contract.forfeit_den());
        assert_eq!(chain.player(THEO).hires.first().map_or(0, |hire| hire.fights_left), left);
    }
    assert!(chain.player(THEO).hires.is_empty());
    chain.fails(THEO, |contract| contract.start_den_fight(0, squad, yocto(0)), "is not yours to field");

    // The hired beast's record shows the three fights it was fielded in, and what they taught it.
    let star = chain.beast(star);
    assert_eq!((star.fights, star.level, star.xp), (3, 2, 15 + 7 + 7));
    chain.assert_books_balance();
}
