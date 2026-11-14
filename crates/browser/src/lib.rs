//! The rules of Maul Street, compiled for the browser.
//!
//! The page loads this module as plain WebAssembly and talks to it in JSON:
//! write a request into memory from `ms_alloc`, call `ms_call`, read the answer
//! and hand both buffers back with `ms_free`. Every answer comes from the same
//! `maul-core` code the contract runs, so practice fights, stat previews and
//! price explanations cannot drift from what the chain will do.

use maul_core::battle::{self, Battle, Build};
use maul_core::{data, npc, rules};
use serde_json::{json, Value};

#[no_mangle]
pub extern "C" fn ms_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len.max(1));
    let pointer = buffer.as_mut_ptr();
    core::mem::forget(buffer);
    pointer
}

/// # Safety
/// `pointer` and `len` must come from `ms_alloc` or `ms_call`.
#[no_mangle]
pub unsafe extern "C" fn ms_free(pointer: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(pointer, 0, len.max(1)));
}

/// Answers one JSON request. Returns the answer's address in the high 32 bits
/// and its length in the low 32 bits.
///
/// # Safety
/// `pointer` and `len` must describe a buffer from `ms_alloc` holding UTF-8 JSON.
#[no_mangle]
pub unsafe extern "C" fn ms_call(pointer: *const u8, len: usize) -> u64 {
    let request = core::slice::from_raw_parts(pointer, len);
    let answer = match serde_json::from_slice::<Value>(request) {
        Ok(request) => handle(&request).unwrap_or_else(|error| json!({ "error": error })),
        Err(error) => json!({ "error": format!("Bad request: {error}") }),
    };
    let bytes = serde_json::to_vec(&answer).unwrap_or_default();
    let out_len = bytes.len();
    let out = ms_alloc(out_len);
    core::ptr::copy_nonoverlapping(bytes.as_ptr(), out, out_len);
    ((out as u64) << 32) | out_len as u64
}

fn yocto(value: &Value) -> Result<u128, String> {
    match value {
        Value::String(text) => text.parse::<u128>().map_err(|_| "Bad amount.".to_string()),
        Value::Number(number) => number.as_u64().map(|n| n as u128).ok_or_else(|| "Bad amount.".to_string()),
        _ => Err("Bad amount.".to_string()),
    }
}

fn number(request: &Value, key: &str) -> Result<u64, String> {
    request[key].as_u64().ok_or_else(|| format!("Missing number `{key}`."))
}

fn builds(value: &Value) -> Result<Vec<Build>, String> {
    serde_json::from_value::<Vec<Build>>(value.clone()).map_err(|error| format!("Bad squad: {error}"))
}

fn handle(request: &Value) -> Result<Value, String> {
    match request["fn"].as_str().unwrap_or("") {
        "tables" => Ok(tables()),
        "stats" => {
            let build: Build = serde_json::from_value(request["build"].clone()).map_err(|e| format!("Bad build: {e}"))?;
            let cap = request["cap"].as_u64().unwrap_or(0) as u32;
            let stats = battle::stats(&build, cap);
            Ok(json!({ "stats": stats, "power": battle::power(&stats) }))
        }
        "level" => {
            // Everything the menus need to show about a level: what the next one
            // costs in NEAR and in XP, and which form the beast wears.
            let level = (number(request, "level")? as u32).max(1);
            Ok(json!({
                "level": level,
                "near": rules::level_cost_near(level).to_string(),
                "xp": rules::xp_for_level(level),
                "form": rules::form_of(level),
                "next_form_at": rules::FORM_LEVELS.iter().find(|start| **start > level),
            }))
        }
        "add_xp" => {
            let level = number(request, "level")? as u32;
            let xp = number(request, "xp")?;
            let gained = number(request, "gained")?;
            let (level, xp) = rules::add_xp(level, xp, gained);
            Ok(json!({ "level": level, "xp": xp, "form": rules::form_of(level) }))
        }
        "price" => {
            let floor = yocto(&request["floor"])?;
            let heat = number(request, "heat")? as u32;
            Ok(json!({
                "price": rules::heated_price(floor, heat).to_string(),
                "reason": rules::price_reason(heat),
            }))
        }
        "den" => {
            let bankroll = yocto(&request["bankroll"])?;
            let wins = number(request, "wins")? as u32;
            let fights = number(request, "fights")? as u32;
            let training = request["training"].as_u64().unwrap_or(0) as u32;
            let name = request["name"].as_str().unwrap_or("The den");
            Ok(json!({
                "open": rules::den_is_open(bankroll),
                "max_stake": rules::den_max_stake(bankroll).to_string(),
                "payout_bps": rules::den_payout_bps(wins, fights),
                "level_bonus": rules::den_level_bonus(training),
                "spar_level": rules::den_spar_level(request["tier"].as_u64().unwrap_or(1) as u8),
                "reason": rules::den_reason(name, bankroll, wins, fights, training),
            }))
        }
        "battle_new" => {
            let cap = request["cap"].as_u64().unwrap_or(0) as u32;
            let a = builds(&request["a"])?;
            let b = builds(&request["b"])?;
            if a.len() != 3 || b.len() != 3 {
                return Err("A squad is three beasts.".to_string());
            }
            let team = |squad: &[Build]| squad.iter().map(|build| battle::fighter(build, cap)).collect::<Vec<_>>();
            let fight = Battle::new(team(&a), team(&b));
            Ok(json!({ "battle": fight, "need": fight.need() }))
        }
        "battle_step" => {
            let mut fight: Battle = serde_json::from_value(request["battle"].clone()).map_err(|e| format!("Bad battle: {e}"))?;
            let act = |side: usize| request["acts"][side].as_u64().map(|a| a as u8);
            let seed = request["seed"].as_str().unwrap_or("");
            let events = fight.step([act(0), act(1)], seed.as_bytes()).map_err(|e| e.to_string())?;
            Ok(json!({ "battle": fight, "events": events, "need": fight.need() }))
        }
        "npc_action" => {
            let fight: Battle = serde_json::from_value(request["battle"].clone()).map_err(|e| format!("Bad battle: {e}"))?;
            let side = number(request, "side")? as usize;
            let style = number(request, "style")? as u8;
            let seed = request["seed"].as_str().unwrap_or("");
            if side > 1 {
                return Err("Side is 0 or 1.".to_string());
            }
            let mut rng = battle::Rng::new(seed.as_bytes(), fight.turn as u64 ^ 0x006e_7063);
            Ok(json!({
                "act": npc::npc_action(&fight, side, style, &mut rng),
                "weights": npc::move_weights(&fight, side, style),
            }))
        }
        other => Err(format!("Unknown request `{other}`.")),
    }
}

fn tables() -> Value {
    let species: Vec<Value> = data::SPECIES
        .iter()
        .map(|s| {
            json!({
                "id": s.id, "name": s.name, "aspect": s.aspect, "rig": s.rig,
                "hp": s.hp, "atk": s.atk, "def": s.def, "spd": s.spd,
                "rare": s.rare, "special": s.special, "lore": s.lore, "forms": s.forms,
                "price": (s.price_milli as u128 * rules::MILLI).to_string(),
            })
        })
        .collect();
    let items: Vec<Value> = data::ITEMS
        .iter()
        .map(|i| {
            json!({
                "id": i.id, "name": i.name, "kind": i.kind, "text": i.text,
                "price": (i.price_milli as u128 * rules::MILLI).to_string(),
            })
        })
        .collect();
    let dens: Vec<Value> = data::DENS
        .iter()
        .map(|d| {
            json!({
                "id": d.id, "name": d.name, "title": d.title, "style": d.style,
                "tier": d.tier, "squad": d.squad, "teaches": d.teaches,
            })
        })
        .collect();
    json!({
        "aspects": data::ASPECT_NAMES,
        "species": species,
        "items": items,
        "dens": dens,
        "rules": {
            "level_stat_pct": rules::LEVEL_STAT_PCT,
            "form_levels": rules::FORM_LEVELS,
            "form_names": rules::FORM_NAMES,
            "kill_xp": rules::KILL_XP,
            "duel_rake_bps": rules::DUEL_RAKE_BPS.to_string(),
            "hire_fee_bps": rules::HIRE_FEE_BPS.to_string(),
            "min_duel_stake": rules::MIN_DUEL_STAKE.to_string(),
            "max_hire_fights": rules::MAX_HIRE_FIGHTS,
            "move_clock_secs": rules::MOVE_CLOCK_SECS,
            "den_min_bankroll": rules::DEN_MIN_BANKROLL.to_string(),
            "starting_essence": rules::STARTING_ESSENCE,
        },
    })
}
