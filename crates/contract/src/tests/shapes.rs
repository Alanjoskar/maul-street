//! The JSON the game receives has exactly the fields `docs/CONTRACT.md` lists.

use near_sdk::serde::Serialize;
use near_sdk::serde_json::{self, Value};

use super::*;

/// Checks that `view` is a JSON object with exactly these fields.
fn assert_fields(view: &impl Serialize, fields: &str) -> Value {
    let json = serde_json::to_value(view).unwrap();
    let mut found: Vec<&str> = json.as_object().expect("a JSON object").keys().map(String::as_str).collect();
    let mut expected: Vec<&str> = fields.split_whitespace().collect();
    found.sort_unstable();
    expected.sort_unstable();
    assert_eq!(found, expected);
    json
}

const BEAST: &str = "id species name owner level xp xp_next form form_name relic aura finisher stats power kills fights \
                     wins hire_price earned";
const MATCH: &str = "id kind players den stake level_cap payout_bps battle need sealed open deadline steps last_events \
                     over winner void payout essence xp levels";

#[test]
fn views_have_the_documented_fields() {
    let mut chain = Chain::deploy(15 * NEAR);
    let avas = chain.join(AVA, [0, 1, 2], 5);
    let theos = chain.join(THEO, [2, 3, 4], 5);
    chain.ok(AVA, |contract| contract.buy_item(1, yocto(NEAR)));
    chain.ok(AVA, |contract| contract.back_den(0, yocto(NEAR)));
    chain.ok(THEO, |contract| contract.list_for_hire(theos[0], yocto(CENT)));
    chain.ok(AVA, |contract| contract.hire(theos[0], 2));

    let player = assert_fields(
        &chain.player(AVA),
        "account_id registered balance essence rating wins losses den_wins den_losses won hire_income beasts items \
         hires den_match duel challenge backing",
    );
    assert_eq!(player["balance"], "3730000000000000000000000", "NEAR is a decimal string of yoctoNEAR");
    assert_eq!(player["items"], serde_json::json!([[1, 1]]));
    assert_eq!(player["den_match"], Value::Null);
    assert_eq!(player["hires"][0]["fights_left"], 2);
    assert_fields(&chain.player(AVA).hires[0], "beast fights_left");
    assert_fields(&chain.player(AVA).backing[0], "den shares value");
    assert_fields(&chain.player(MIRA), "account_id registered balance essence rating wins losses den_wins den_losses won hire_income beasts items hires den_match duel challenge backing");

    let beast = assert_fields(&chain.view(|contract| contract.get_beast(theos[0])).unwrap(), BEAST);
    assert_eq!(beast["hire_price"], "10000000000000000000000");
    assert_eq!(beast["stats"], serde_json::json!([520, 70, 66, 34]));
    assert_eq!((&beast["level"], &beast["xp"], &beast["xp_next"]), (&Value::from(1), &Value::from(0), &Value::from(100)));
    assert_eq!((&beast["name"], &beast["form"], &beast["form_name"]), (&Value::from("Pebblit"), &Value::from(0), &Value::from("Pebblit")));
    assert_eq!(assert_fields(&chain.player(AVA).beasts[0], BEAST)["hire_price"], Value::Null);

    assert_fields(
        &chain.den(0),
        "id name title style tier squad bankroll shares open max_stake payout_bps wins fights total_wins \
         total_losses training_spent training_levels level_bonus spar_level reason",
    );
    let market = chain.view(|contract| contract.get_market());
    assert_fields(&market, "items species");
    assert_fields(&market.items[0], "id price floor heat sold reason");
    assert_fields(&market.species[0], "id price floor heat sold reason");
    assert_fields(&chain.view(|contract| contract.get_stats()), "players beasts den_fights duels volume treasury");
    assert_fields(&chain.view(|contract| contract.get_ledger()), "balances bankrolls escrow treasury deposited withdrawn");
    assert_fields(&chain.view(|contract| contract.get_leaderboard(None))[0], "account_id rating wins losses won");
    assert_fields(&chain.view(|contract| contract.get_ticker())[0], "ts text");
    assert_fields(&chain.view(|contract| contract.mt_token(vec!["beast:1".to_string()]))[0], "token_id owner_id");

    let challenge = chain.ok(AVA, |contract| contract.create_challenge(avas, yocto(CENT), 0, None));
    let challenge = assert_fields(&challenge, "id creator stake level_cap invite squad created");
    assert_eq!(challenge["invite"], Value::Null);
    assert_eq!(challenge["squad"][0], serde_json::json!({ "token": 1, "species": 0, "level": 1, "power": 270 }));

    // A den fight, one step in.
    chain.ok(AVA, |contract| contract.start_den_fight(0, avas, yocto(0)));
    let fight = assert_fields(&chain.ok(AVA, |contract| contract.den_act(10)), MATCH);
    assert_eq!((&fight["kind"], &fight["den"], &fight["deadline"]), (&Value::from("den"), &Value::from(0), &Value::from(0)));
    assert_eq!(fight["players"], serde_json::json!(["ava.testnet", "den:0"]));
    assert_eq!(fight["winner"], Value::Null);
    assert_eq!(fight["last_events"][0], serde_json::json!({ "e": "pick", "side": 0, "slot": 0 }));
    assert_eq!(fight["steps"][0]["turn"], 1);
    assert_eq!((&fight["xp"], &fight["levels"]), (&serde_json::json!([[0, 0, 0], [0, 0, 0]]), &serde_json::json!([[0, 0, 0], [0, 0, 0]])));
    assert_fields(&fight["battle"]["teams"][0][0], "token species level aspect max_hp hp atk def spd rage relic aura finisher burn bleed sunder shock soak kills entered");
    assert_eq!(fight["steps"][0]["events"], fight["last_events"]);
    assert_fields(&fight["steps"][0], "turn events");
    assert_fields(&fight["battle"], "teams active turn round_turn winner hist");

    // A duel, with one move sealed.
    chain.ok(THEO, |contract| contract.accept_challenge(1, theos));
    let hash = "a0fe63b1f265d6d0310fe662cacce8f17293ef650f1ea882df731cb35230a187".to_string();
    let duel = assert_fields(&chain.ok(AVA, |contract| contract.duel_commit(hash)), MATCH);
    assert_eq!((&duel["kind"], &duel["den"], &duel["payout_bps"]), (&Value::from("duel"), &Value::Null, &Value::from(0)));
    assert_eq!(duel["players"], serde_json::json!(["ava.testnet", "theo.testnet"]));
    assert_eq!((&duel["sealed"], &duel["open"]), (&serde_json::json!([true, false]), &serde_json::json!([false, false])));
    assert_eq!(duel["stake"], "10000000000000000000000");
    assert_eq!(duel["essence"], serde_json::json!([0, 0]));
}
