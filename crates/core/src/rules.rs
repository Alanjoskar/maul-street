//! Every price and payout on Maul Street, in one readable file.
//!
//! The contract runs these functions to charge and pay. The browser runs the
//! same functions (compiled to WebAssembly) to show a price and the reason for
//! it before the player commits. Nothing here is tuned by hand after launch:
//! the numbers move because players buy, win, lose, back and cash out.

/// One NEAR, in yoctoNEAR.
pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
/// A thousandth of a NEAR.
pub const MILLI: u128 = NEAR / 1_000;

// ---------------------------------------------------------------------------
// Levels: every beast starts at 1 and there is no top.
// ---------------------------------------------------------------------------

/// A beast needs 100 XP to go from level 1 to level 2...
pub const LEVEL_FIRST_XP: u64 = 100;
/// ...or its owner can buy that level for 0.01 NEAR.
pub const LEVEL_FIRST_NEAR: u128 = 10 * MILLI;
/// Each level takes 10% more than the one before it, in XP and in NEAR alike.
pub const LEVEL_GROWTH_PCT: u128 = 110;
/// Each level adds 3% of the beast's base health, attack, defence and speed.
/// The gain is steady while the price compounds, so the next level is always
/// possible and never free.
pub const LEVEL_STAT_PCT: u64 = 3;

/// XP a beast at `level` needs to reach the next one.
pub fn xp_for_level(level: u32) -> u64 {
    let mut need = LEVEL_FIRST_XP as u128;
    for _ in 1..level.max(1) {
        if need > u64::MAX as u128 {
            return u64::MAX;
        }
        need = need * LEVEL_GROWTH_PCT / 100;
    }
    need.min(u64::MAX as u128) as u64
}

/// What it costs in NEAR to buy a beast at `level` its next level.
pub fn level_cost_near(level: u32) -> u128 {
    let mut cost = LEVEL_FIRST_NEAR;
    for _ in 1..level.max(1) {
        if cost > u128::MAX / LEVEL_GROWTH_PCT {
            return u128::MAX;
        }
        cost = cost * LEVEL_GROWTH_PCT / 100;
    }
    cost
}

/// A base stat at a level.
pub fn stat_at_level(base: u32, level: u32) -> u32 {
    let value = base as u64 * (100 + LEVEL_STAT_PCT * (level.max(1) - 1) as u64) / 100;
    value.min(u32::MAX as u64) as u32
}

/// Adds XP to a beast and takes it up as many levels as that buys.
/// Returns its new (level, XP towards the next level).
pub fn add_xp(level: u32, xp: u64, gained: u64) -> (u32, u64) {
    let mut level = level.max(1);
    let mut xp = xp.saturating_add(gained);
    loop {
        let need = xp_for_level(level);
        if xp < need || level == u32::MAX {
            return (level, xp);
        }
        xp -= need;
        level += 1;
    }
}

/// A beast changes form as it grows. The five forms begin at these levels.
pub const FORM_LEVELS: [u32; 5] = [1, 5, 12, 25, 50];
/// What the forms are called for every line of beasts.
pub const FORM_NAMES: [&str; 5] = ["Cub", "Prowler", "Alpha", "Dread", "Mythic"];

/// Which form (0 to 4) a beast of this level wears.
pub fn form_of(level: u32) -> u8 {
    let mut form = 0;
    for (i, start) in FORM_LEVELS.iter().enumerate() {
        if level >= *start {
            form = i as u8;
        }
    }
    form
}

// ----- XP: earned by every beast in a squad whenever a fight ends -------------

/// XP for a fight against a den. Tougher dens teach more, and a fight with
/// NEAR on it teaches half as much again. Losing still teaches something.
pub fn den_xp(tier: u8, won: bool, staked: bool) -> u64 {
    let base = if won { 40 + 15 * tier as u64 } else { 15 };
    if staked {
        base * 3 / 2
    } else {
        base
    }
}

/// XP for a duel against another player.
pub fn duel_xp(won: bool) -> u64 {
    if won {
        120
    } else {
        40
    }
}

/// Extra XP for each beast this one put down.
pub const KILL_XP: u64 = 15;
/// A beast that was in the squad but never entered the pit learns half as much.
pub const BENCH_XP_PCT: u64 = 50;

/// What one beast of a squad earns from a fight worth `fight_xp`.
pub fn beast_xp(fight_xp: u64, entered: bool, kills: u8) -> u64 {
    let share = if entered { fight_xp } else { fight_xp * BENCH_XP_PCT / 100 };
    share + KILL_XP * kills as u64
}

// ---------------------------------------------------------------------------
// The bazaar: prices heat up when people buy and cool when they don't.
// ---------------------------------------------------------------------------

/// Each purchase lifts the price by 4% of its floor.
pub const HEAT_STEP_PCT: u128 = 4;
/// One purchase's worth of heat cools off every ten quiet minutes.
pub const HEAT_COOL_SECS: u64 = 600;
/// Heat stops at 100, so a price never passes five times its floor.
pub const HEAT_MAX: u32 = 100;

/// How hot a price still is, given when it was last bought.
pub fn cooled_heat(heat: u32, last_buy_secs: u64, now_secs: u64) -> u32 {
    let quiet = now_secs.saturating_sub(last_buy_secs) / HEAT_COOL_SECS;
    heat.saturating_sub(quiet.min(u32::MAX as u64) as u32)
}

/// The price right now.
pub fn heated_price(floor: u128, heat: u32) -> u128 {
    floor + floor * HEAT_STEP_PCT * heat.min(HEAT_MAX) as u128 / 100
}

/// Heat after one more purchase.
pub fn heat_after_buy(heat: u32) -> u32 {
    (heat + 1).min(HEAT_MAX)
}

/// The sentence the bazaar shows under a price.
pub fn price_reason(heat: u32) -> String {
    let heat = heat.min(HEAT_MAX);
    if heat == 0 {
        return "Nobody has bought this lately, so it sits at its floor price. Every purchase lifts it 4%.".to_string();
    }
    let over = HEAT_STEP_PCT as u32 * heat;
    let buys = if heat == 1 { "1 recent purchase".to_string() } else { format!("{heat} recent purchases") };
    format!(
        "{buys} pushed this {over}% over its floor. It cools 4% for every ten minutes nobody buys."
    )
}

// ---------------------------------------------------------------------------
// The house fighters (dens). Each has its own bankroll and these rules.
// ---------------------------------------------------------------------------

/// Below half a NEAR a den closes its doors until someone backs it.
pub const DEN_MIN_BANKROLL: u128 = NEAR / 2;
/// A den never risks more than 5% of its bankroll on one fight.
pub const DEN_RISK_PCT: u128 = 5;
/// Stakes are whole hundredths of a NEAR.
pub const DEN_STAKE_STEP: u128 = 10 * MILLI;
/// A den that has been losing pays 1.5x on a staked win...
pub const DEN_PAYOUT_LOW_BPS: u32 = 15_000;
/// ...and one that has been winning pays up to 2x, to tempt challengers.
pub const DEN_PAYOUT_HIGH_BPS: u32 = 20_000;
/// Until it has three staked fights on record it pays 1.8x.
pub const DEN_PAYOUT_NEW_BPS: u32 = 18_000;
/// It remembers its last ten staked fights.
pub const DEN_MEMORY: u32 = 10;
/// A tenth of everything a den wins is spent on training its beasts.
pub const DEN_TRAINING_BPS: u128 = 1_000;

pub fn den_is_open(bankroll: u128) -> bool {
    bankroll >= DEN_MIN_BANKROLL
}

/// The most a challenger may stake against this den right now.
pub fn den_max_stake(bankroll: u128) -> u128 {
    if !den_is_open(bankroll) {
        return 0;
    }
    bankroll * DEN_RISK_PCT / 100 / DEN_STAKE_STEP * DEN_STAKE_STEP
}

/// What a staked win pays, in hundredths of a percent of the stake.
/// `wins` and `fights` count the den's last ten staked fights.
pub fn den_payout_bps(wins: u32, fights: u32) -> u32 {
    if fights < 3 {
        return DEN_PAYOUT_NEW_BPS;
    }
    let wins = wins.min(fights);
    DEN_PAYOUT_LOW_BPS + (DEN_PAYOUT_HIGH_BPS - DEN_PAYOUT_LOW_BPS) * wins / fights
}

/// What the challenger receives for winning a staked fight (stake included).
pub fn den_payout(stake: u128, payout_bps: u32) -> u128 {
    stake * payout_bps as u128 / 10_000
}

/// In a free spar a den's beasts have a fixed level set by its tier: 1, 5, 9,
/// 13 and 17. Levelling a squad is how a trainer climbs to the tougher dens,
/// which pay more XP and Essence. (In a staked fight the den matches the
/// challenger's own levels instead, so the odds are about skill.)
pub const DEN_SPAR_LEVELS_PER_TIER: u32 = 4;

pub fn den_spar_level(tier: u8) -> u32 {
    1 + (tier as u32).saturating_sub(1) * DEN_SPAR_LEVELS_PER_TIER
}

/// How many levels a den's training money has bought so far. It pays the same
/// rising price players pay, one level at a time.
pub fn den_training_levels(spent: u128) -> u32 {
    let mut left = spent;
    let mut bought = 0u32;
    loop {
        let cost = level_cost_near(bought + 1);
        if cost > left {
            return bought;
        }
        left -= cost;
        bought += 1;
    }
}

/// Every four levels of training put a den's beasts one level higher...
pub const DEN_BONUS_EVERY: u32 = 4;
/// ...up to four. Training gives a winning den an edge, never a runaway lead.
pub const DEN_BONUS_MAX: u32 = 4;

/// How many levels a den's beasts get on top of their spar level or the challenger's.
pub fn den_level_bonus(training_levels: u32) -> u32 {
    (training_levels / DEN_BONUS_EVERY).min(DEN_BONUS_MAX)
}

/// The den's thinking, as shown in its tooltip.
pub fn den_reason(name: &str, bankroll: u128, wins: u32, fights: u32, training_levels: u32) -> String {
    let near = |yocto: u128| -> String {
        let hundredths = yocto / (10 * MILLI);
        format!("{}.{:02}", hundredths / 100, hundredths % 100)
    };
    if !den_is_open(bankroll) {
        return format!(
            "{name} is down to {} NEAR and has closed its doors. It reopens when backers lift its bankroll to 0.50 NEAR.",
            near(bankroll)
        );
    }
    let bps = den_payout_bps(wins, fights);
    let pays = format!("{}.{:02}x", bps / 10_000, bps % 10_000 / 100);
    let record = if fights < 3 {
        format!("{name} has too few staked fights on record to judge its form, so it pays {pays}.")
    } else if wins * 2 > fights {
        format!("{name} won {wins} of its last {fights} staked fights, so it raises its payout to {pays} to tempt challengers.")
    } else if wins * 2 < fights {
        format!("{name} lost {} of its last {fights} staked fights, so it cuts its payout to {pays}.", fights - wins)
    } else {
        format!("{name} split its last {fights} staked fights evenly, so it pays {pays}.")
    };
    let bonus = den_level_bonus(training_levels);
    let training = if bonus == 0 {
        String::new()
    } else if bonus == 1 {
        " Its winnings have paid for training: its beasts fight 1 level above yours.".to_string()
    } else {
        format!(" Its winnings have paid for training: its beasts fight {bonus} levels above yours.")
    };
    format!(
        "{record} It risks at most 5% of its {} NEAR bankroll on a fight: {} NEAR.{training}",
        near(bankroll),
        near(den_max_stake(bankroll))
    )
}

// ---------------------------------------------------------------------------
// Essence: won in every fight, fed to any beast as XP. Never NEAR.
// ---------------------------------------------------------------------------

/// A new trainer starts with enough to give one beast its first level.
pub const STARTING_ESSENCE: u64 = 100;

/// Essence for a fight against a den. Tougher dens pay more.
pub fn den_essence(tier: u8, won: bool) -> u64 {
    if won {
        20 + 10 * tier as u64
    } else {
        8
    }
}

/// Essence for a duel against another player.
pub fn duel_essence(won: bool) -> u64 {
    if won {
        40
    } else {
        10
    }
}

// ---------------------------------------------------------------------------
// Fees and limits.
// ---------------------------------------------------------------------------

/// The house keeps 3% of a duel's pot.
pub const DUEL_RAKE_BPS: u128 = 300;
/// The house keeps 5% of a hire fee. The owner gets the rest.
pub const HIRE_FEE_BPS: u128 = 500;
/// The smallest duel stake: 0.01 NEAR.
pub const MIN_DUEL_STAKE: u128 = 10 * MILLI;
/// A beast is hired for at most this many fights at a time.
pub const MAX_HIRE_FIGHTS: u32 = 20;
/// Seconds a player has to answer in a duel before losing on the clock.
pub const MOVE_CLOCK_SECS: u64 = 75;

pub fn bps(amount: u128, bps: u128) -> u128 {
    amount * bps / 10_000
}

// ---------------------------------------------------------------------------
// Pit rating: a plain Elo with K = 24, in whole numbers.
// ---------------------------------------------------------------------------

pub const RATING_START: u32 = 1_000;

/// The winner's expected score in thousandths, by rating gap in steps of 50.
const EXPECTED: [u32; 17] = [
    500, 571, 640, 703, 760, 808, 849, 882, 909, 930, 947, 960, 969, 977, 983, 987, 990,
];

/// New ratings for (winner, loser).
pub fn ratings_after(winner: u32, loser: u32) -> (u32, u32) {
    let gap = winner.abs_diff(loser).min(800);
    let favourite = EXPECTED[(gap / 50) as usize];
    let expected = if winner >= loser { favourite } else { 1_000 - favourite };
    let gain = (24 * (1_000 - expected) / 1_000).max(1);
    (winner + gain, loser.saturating_sub(gain).max(100))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_level_costs_more_than_the_last() {
        let mut last_near = 0;
        let mut last_xp = 0;
        for level in 1..500 {
            let near = level_cost_near(level);
            let xp = xp_for_level(level);
            assert!(near >= last_near && xp >= last_xp);
            last_near = near;
            last_xp = xp;
        }
        assert_eq!(level_cost_near(1), 10 * MILLI);
        assert_eq!(level_cost_near(2), 11 * MILLI);
        assert_eq!(level_cost_near(0), 10 * MILLI);
        assert_eq!(level_cost_near(100_000), u128::MAX);
        assert_eq!(xp_for_level(1), 100);
        assert_eq!(xp_for_level(2), 110);
        assert_eq!(xp_for_level(100_000), u64::MAX);
    }

    #[test]
    fn stats_grow_steadily() {
        assert_eq!(stat_at_level(100, 1), 100);
        assert_eq!(stat_at_level(100, 11), 130);
        assert_eq!(stat_at_level(100, 0), 100);
        assert_eq!(stat_at_level(400, u32::MAX), u32::MAX);
    }

    #[test]
    fn xp_carries_a_beast_up_through_levels() {
        assert_eq!(add_xp(1, 0, 99), (1, 99));
        assert_eq!(add_xp(1, 99, 1), (2, 0));
        // 100 + 110 + 121 = 331 takes a new beast to level 4.
        assert_eq!(add_xp(1, 0, 340), (4, 9));
        assert_eq!(add_xp(7, 50, 0), (7, 50));
        let (level, _) = add_xp(1, 0, u64::MAX);
        assert!(level > 300);
    }

    #[test]
    fn forms_change_at_their_levels() {
        assert_eq!(form_of(1), 0);
        assert_eq!(form_of(4), 0);
        assert_eq!(form_of(5), 1);
        assert_eq!(form_of(11), 1);
        assert_eq!(form_of(12), 2);
        assert_eq!(form_of(25), 3);
        assert_eq!(form_of(49), 3);
        assert_eq!(form_of(50), 4);
        assert_eq!(form_of(9_999), 4);
        assert_eq!(form_of(0), 0);
    }

    #[test]
    fn fights_teach_and_kills_teach_more() {
        assert_eq!(den_xp(1, true, false), 55);
        assert_eq!(den_xp(5, true, false), 115);
        assert_eq!(den_xp(5, true, true), 172);
        assert_eq!(den_xp(3, false, false), 15);
        assert_eq!(duel_xp(true), 120);
        assert_eq!(beast_xp(100, true, 2), 130);
        assert_eq!(beast_xp(100, false, 0), 50);
    }

    #[test]
    fn prices_heat_and_cool() {
        let floor = 250 * MILLI;
        assert_eq!(heated_price(floor, 0), floor);
        assert_eq!(heated_price(floor, 5), floor * 120 / 100);
        assert_eq!(heated_price(floor, 1_000), floor * 5);
        assert_eq!(cooled_heat(5, 0, 599), 5);
        assert_eq!(cooled_heat(5, 0, 1_800), 2);
        assert_eq!(cooled_heat(5, 0, 1_000_000), 0);
        assert!(price_reason(0).contains("floor"));
        assert!(price_reason(3).contains("12%"));
    }

    #[test]
    fn dens_protect_their_bankroll() {
        assert_eq!(den_max_stake(NEAR / 4), 0);
        assert_eq!(den_max_stake(10 * NEAR), NEAR / 2);
        assert_eq!(den_max_stake(3 * NEAR + 7), 150 * MILLI);
        assert_eq!(den_payout_bps(0, 0), DEN_PAYOUT_NEW_BPS);
        assert_eq!(den_payout_bps(0, 10), DEN_PAYOUT_LOW_BPS);
        assert_eq!(den_payout_bps(10, 10), DEN_PAYOUT_HIGH_BPS);
        assert_eq!(den_payout_bps(5, 10), 17_500);
        // The most a den can lose on one fight is the stake itself.
        let stake = den_max_stake(10 * NEAR);
        assert!(den_payout(stake, DEN_PAYOUT_HIGH_BPS) - stake <= stake);
        assert!(den_reason("Old Grist", NEAR / 4, 0, 0, 0).contains("closed"));
        assert!(den_reason("Old Grist", 10 * NEAR, 8, 10, 9).contains("2 levels above"));
    }

    #[test]
    fn training_is_bought_at_the_player_price_and_helps_only_so_far() {
        assert_eq!(den_training_levels(0), 0);
        assert_eq!(den_training_levels(10 * MILLI), 1);
        assert_eq!(den_training_levels(20 * MILLI), 1);
        assert_eq!(den_training_levels(21 * MILLI), 2);
        assert_eq!(den_level_bonus(0), 0);
        assert_eq!(den_level_bonus(3), 0);
        assert_eq!(den_level_bonus(4), 1);
        assert_eq!(den_level_bonus(16), 4);
        assert_eq!(den_level_bonus(4_000), 4);
    }

    #[test]
    fn tougher_dens_spar_at_higher_levels() {
        assert_eq!(den_spar_level(1), 1);
        assert_eq!(den_spar_level(3), 9);
        assert_eq!(den_spar_level(5), 17);
        assert_eq!(den_spar_level(0), 1);
    }

    #[test]
    fn ratings_move_toward_the_upset() {
        let (w, l) = ratings_after(1_000, 1_000);
        assert_eq!((w, l), (1_012, 988));
        let (w, l) = ratings_after(1_000, 1_400);
        assert!(w - 1_000 > 20 && 1_400 - l > 20);
        let (w, _) = ratings_after(1_400, 1_000);
        assert!(w - 1_400 <= 3);
    }
}
