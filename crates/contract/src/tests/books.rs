//! The books: the helper maths, and a long random session after which every
//! yoctoNEAR is still accounted for.

use std::collections::BTreeMap;

use maul_core::battle::Rng;
use maul_core::{data, rules};

use super::*;
use crate::{mul_div, near_text};

/// `a × b` as four 64-bit digits, most significant first, so that the arrays compare the
/// way the numbers do.
fn wide(a: u128, b: u128) -> [u64; 4] {
    let (a, b) = ([a as u64, (a >> 64) as u64], [b as u64, (b >> 64) as u64]);
    let mut digits = [0u64; 4];
    for i in 0..2 {
        let mut carry = 0u128;
        for j in 0..2 {
            let sum = digits[i + j] as u128 + a[i] as u128 * b[j] as u128 + carry;
            digits[i + j] = sum as u64;
            carry = sum >> 64;
        }
        digits[i + 2] = carry as u64;
    }
    digits.reverse();
    digits
}

/// Checks that `quotient` is `a × b / c` rounded down, with arithmetic that shares nothing
/// with `mul_div`.
pub(super) fn assert_floor_of(quotient: u128, a: u128, b: u128, c: u128) {
    assert!(wide(quotient, c) <= wide(a, b), "{quotient} is more than {a} × {b} / {c}");
    assert!(wide(a, b) < wide(quotient + 1, c), "{quotient} is less than {a} × {b} / {c} rounded down");
}

#[test]
fn wide_products_compare_like_numbers() {
    assert_eq!(wide(0, u128::MAX), [0; 4]);
    assert_eq!(wide(3, 5), [0, 0, 0, 15]);
    assert_eq!(wide(1 << 64, 1 << 64), [0, 1, 0, 0]);
    assert_eq!(wide(u128::MAX, u128::MAX), [u64::MAX, u64::MAX - 1, 0, 1]);
    assert!(wide(1 << 100, 1 << 100) > wide(u128::MAX, 1 << 60));
}

#[test]
fn mul_div_is_exact_where_plain_maths_overflows() {
    assert_eq!(mul_div(6, 7, 4), Some(10));
    assert_eq!(mul_div(0, u128::MAX, 3), Some(0));
    assert_eq!(mul_div(5, 5, 0), None, "nothing divides by zero");
    assert_eq!(mul_div(u128::MAX, u128::MAX, u128::MAX), Some(u128::MAX));
    assert_eq!(mul_div(u128::MAX, 2, 2), Some(u128::MAX));
    assert_eq!(mul_div(u128::MAX, 2, 1), None, "the answer has to fit");
    assert_eq!(mul_div(1 << 127, 4, 2), None);
    assert_eq!(mul_div(1 << 127, 4, 8), Some(1 << 126));
    // A NEAR, times a bankroll, over the shares: far past 128 bits on the way.
    assert_eq!(mul_div(NEAR, 49 * NEAR, 40 * NEAR), Some(NEAR + 225 * rules::MILLI));

    let mut rng = Rng::new(b"mul_div", 1);
    let number = |rng: &mut Rng| ((rng.next() as u128) << 64 | rng.next() as u128) >> rng.below(128);
    let mut exact = 0;
    for _ in 0..4_000 {
        let (a, b, c) = (number(&mut rng), number(&mut rng), number(&mut rng).max(1));
        match mul_div(a, b, c) {
            Some(quotient) if quotient < u128::MAX => {
                assert_floor_of(quotient, a, b, c);
                exact += 1;
            }
            Some(_) => {}
            // No answer means the true one is 2^128 or more: a × b ≥ 2^128 × c.
            None => assert!(wide(a, b)[..2] >= [(c >> 64) as u64, c as u64][..], "{a} × {b} / {c} fits"),
        }
    }
    assert!(exact > 1_000);
}

#[test]
fn near_reads_as_a_plain_decimal() {
    for (yocto, text) in [
        (0, "0"),
        (NEAR, "1"),
        (39 * NEAR, "39"),
        (NEAR / 10, "0.1"),
        (CENT, "0.01"),
        (388 * rules::MILLI, "0.39"),
        (194 * rules::MILLI, "0.19"),
        (1_200 * rules::MILLI, "1.2"),
        (12 * NEAR + 345 * rules::MILLI, "12.35"),
        (100 * NEAR, "100"),
        (995 * rules::MILLI, "1"),
        // Too small for two places: a third one shows it.
        (rules::MILLI, "0.001"),
        (4 * rules::MILLI, "0.004"),
        (5 * rules::MILLI, "0.01"),
        (1, "0"),
    ] {
        assert_eq!(near_text(yocto), text);
    }
}

#[test]
fn the_ticker_keeps_the_last_thirty_lines() {
    let mut chain = Chain::deploy(15 * NEAR);
    let squad = chain.join(AVA, [0, 1, 2], 5);
    for round in 0..35 {
        chain.wait(7);
        chain.ok(AVA, |contract| contract.create_challenge(squad, yocto(round * CENT), 0, None));
        chain.ok(AVA, |contract| contract.cancel_challenge());
    }
    let ticker = chain.view(|contract| contract.get_ticker());
    assert_eq!(ticker.len(), 30);
    assert_eq!((ticker[0].ts, ticker[0].text.as_str()), (chain.now, "ava.testnet is looking for a fight for 0.34 NEAR"));
    assert_eq!(ticker[29].text, "ava.testnet is looking for a fight for 0.05 NEAR");
    assert!(ticker.windows(2).all(|pair| pair[0].ts > pair[1].ts), "newest first");
}

// ----- A long random session ------------------------------------------------------

const PLAYERS: [&str; 4] = [AVA, THEO, MIRA, "zed.testnet"];

struct Session {
    chain: Chain,
    rng: Rng,
    /// NEAR the players have paid in and taken out, counted here as it happens.
    paid_in: u128,
    paid_out: u128,
    /// How often each kind of thing has happened.
    seen: BTreeMap<&'static str, u32>,
}

impl Session {
    fn roll(&mut self, sides: u32) -> u32 {
        self.rng.below(sides)
    }

    fn note(&mut self, what: &'static str) {
        *self.seen.entry(what).or_default() += 1;
    }

    /// Makes a call that is allowed to be refused. A refusal must be one of the contract's
    /// own sentences, never arithmetic gone wrong.
    fn attempt<R>(&mut self, what: &'static str, who: &str, deposit: u128, run: impl FnOnce(&mut Contract) -> R) -> Option<R> {
        match self.chain.call(who, deposit, run) {
            Ok(value) => {
                self.note(what);
                Some(value)
            }
            Err(error) => {
                let broken = ["attempt to", "out of bounds", "Option::unwrap", "overflow"];
                assert!(!broken.iter().any(|sign| error.contains(sign)), "{what} by {who} broke: {error}");
                None
            }
        }
    }

    fn someone_else(&mut self, who: &str) -> &'static str {
        loop {
            let other = PLAYERS[self.roll(4) as usize];
            if other != who {
                return other;
            }
        }
    }

    /// Three beasts at random from those the player owns or has hired.
    fn squad(&mut self, who: &str) -> [u64; 3] {
        let player = self.chain.player(who);
        let mut pool: Vec<u64> = player.beasts.iter().map(|beast| beast.id).chain(player.hires.iter().map(|hire| hire.beast.id)).collect();
        let mut squad = [0; 3];
        for slot in &mut squad {
            if !pool.is_empty() {
                *slot = pool.swap_remove(self.roll(pool.len() as u32) as usize);
            }
        }
        squad
    }

    fn any_beast(&mut self, who: &str) -> u64 {
        let beasts = self.chain.player(who).beasts;
        if beasts.is_empty() || self.roll(10) == 0 {
            1 + self.roll(14) as u64
        } else {
            beasts[self.roll(beasts.len() as u32) as usize].id
        }
    }

    /// Plays up to ten actions of the player's den fight, or gives it up.
    fn den_turn(&mut self, who: &str) {
        let Some(match_id) = self.chain.player(who).den_match else { return };
        let mut fight = self.chain.view(|contract| contract.get_match(match_id)).unwrap();
        if !fight.over && self.roll(12) == 0 {
            fight = self.attempt("forfeit_den", who, 0, |contract| contract.forfeit_den()).unwrap();
        }
        for _ in 0..10 {
            if fight.over {
                break;
            }
            let action = legal_action(&fight, 0, self.roll(3) as u8);
            fight = self.attempt("den_act", who, 0, |contract| contract.den_act(action)).unwrap();
        }
        if fight.over && fight.stake.0 > 0 {
            self.note(if fight.winner == Some(0) { "staked den win" } else { "staked den loss" });
        }
    }

    /// Moves the player's duel on by a few steps, or ends it some other way.
    fn duel_turn(&mut self, who: &str) {
        let Some(match_id) = self.chain.player(who).duel else { return };
        for _ in 0..6 {
            let duel = self.chain.view(|contract| contract.get_match(match_id)).unwrap();
            if duel.over {
                return;
            }
            let sides = [duel.players[0].clone(), duel.players[1].clone()];
            let acting: Vec<usize> = (0..2).filter(|side| duel.need[*side]).collect();
            let moves = [0, 1].map(|side| legal_action(&duel, side, self.roll(3) as u8));
            let salt = format!("{match_id}/{}", duel.battle.turn);
            let end = match self.roll(40) {
                0 => self.attempt("forfeit_duel", who, 0, |contract| contract.forfeit_duel()),
                1 => {
                    // Everyone walks away.
                    self.chain.wait(400);
                    self.attempt("claim_timeout", who, 0, |contract| contract.claim_timeout())
                }
                2 => {
                    // One side seals, and the clock runs out on the other.
                    let hash = seal(moves[acting[0]], &salt);
                    self.attempt("duel_commit", &sides[acting[0]], 0, |contract| contract.duel_commit(hash));
                    self.chain.wait(400);
                    self.attempt("claim_timeout", who, 0, |contract| contract.claim_timeout())
                }
                roll => {
                    // The first side seals. The second seals too, or answers in the open.
                    let hash = seal(moves[acting[0]], &salt);
                    self.attempt("duel_commit", &sides[acting[0]], 0, |contract| contract.duel_commit(hash)).unwrap();
                    if let Some(second) = acting.get(1).copied() {
                        if roll % 2 == 0 {
                            let hash = seal(moves[second], &salt);
                            self.attempt("duel_commit", &sides[second], 0, |contract| contract.duel_commit(hash)).unwrap();
                            let salt = salt.clone();
                            self.attempt("duel_reveal", &sides[second], 0, |contract| contract.duel_reveal(moves[second], salt)).unwrap();
                        } else {
                            self.attempt("duel_play", &sides[second], 0, |contract| contract.duel_play(moves[second])).unwrap();
                        }
                    }
                    self.attempt("duel_reveal", &sides[acting[0]], 0, |contract| contract.duel_reveal(moves[acting[0]], salt))
                }
            };
            match end {
                Some(duel) if duel.void => self.note("duel void"),
                Some(duel) if duel.over => self.note("duel won"),
                _ => {}
            }
        }
    }

    /// One thing a player might do, chosen at random.
    fn act(&mut self) {
        let who = PLAYERS[self.roll(4) as usize];
        let cents = |session: &mut Session, most: u32| (1 + session.roll(most)) as u128 * CENT;
        match self.roll(26) {
            0 => {
                let amount = cents(self, 150);
                if self.attempt("deposit", who, amount, |contract| contract.deposit()).is_some() {
                    self.paid_in += amount;
                }
            }
            1 => {
                let amount = cents(self, 120) + self.roll(1_000) as u128;
                if self.attempt("withdraw", who, 0, |contract| contract.withdraw(yocto(amount)).detach()).is_some() {
                    assert_eq!(self.chain.transfers, vec![(account(who), amount)]);
                    self.paid_out += amount;
                }
            }
            2 | 3 => {
                let (beast, with_essence) = (self.any_beast(who), self.roll(2) == 0);
                self.attempt("level_up", who, 0, |contract| contract.level_up(beast, with_essence));
            }
            4 | 5 => {
                let item = data::ITEMS[self.roll(data::ITEMS.len() as u32) as usize].id;
                self.attempt("buy_item", who, 0, |contract| contract.buy_item(item, yocto(NEAR)));
            }
            6 => {
                let species = self.roll(10) as u8;
                self.attempt("buy_beast", who, 0, |contract| contract.buy_beast(species, yocto(3 * NEAR)));
            }
            7 | 8 => {
                let (beast, items) = (self.any_beast(who), self.chain.player(who).items);
                if !items.is_empty() {
                    let item = items[self.roll(items.len() as u32) as usize].0;
                    self.attempt("equip", who, 0, |contract| contract.equip(beast, item));
                }
            }
            9 => {
                let (beast, kind) = (self.any_beast(who), self.roll(3) as u8);
                self.attempt("unequip", who, 0, |contract| contract.unequip(beast, kind));
            }
            10 => {
                let (beast, price) = (self.any_beast(who), (1 + self.roll(40)) as u128 * rules::MILLI);
                self.attempt("list_for_hire", who, 0, |contract| contract.list_for_hire(beast, yocto(price)));
            }
            11 => {
                let listed = self.chain.view(|contract| contract.get_hire_market(None, None));
                if !listed.is_empty() {
                    let (beast, fights) = (listed[self.roll(listed.len() as u32) as usize].id, 1 + self.roll(3));
                    self.attempt("hire", who, 0, |contract| contract.hire(beast, fights));
                }
                if self.roll(6) == 0 {
                    let beast = self.any_beast(who);
                    self.attempt("unlist", who, 0, |contract| contract.unlist(beast));
                }
            }
            12 | 13 | 14 => {
                let (den, squad) = (self.roll(5) as u8, self.squad(who));
                let stake = if self.roll(4) == 0 { 0 } else { cents(self, 15) };
                self.attempt("start_den_fight", who, 0, |contract| contract.start_den_fight(den, squad, yocto(stake)));
                self.den_turn(who);
            }
            15 | 16 => self.den_turn(who),
            17 => {
                let (den, amount) = (self.roll(5) as u8, cents(self, 120));
                self.attempt("back_den", who, 0, |contract| contract.back_den(den, yocto(amount)));
            }
            18 => {
                let backing = self.chain.player(who).backing;
                if !backing.is_empty() {
                    let position = &backing[self.roll(backing.len() as u32) as usize];
                    let (den, shares) = (position.den, position.shares.0 * (1 + self.roll(4)) as u128 / 4);
                    self.attempt("unback_den", who, 0, |contract| contract.unback_den(den, yocto(shares)));
                }
            }
            19 | 20 => {
                let (squad, cap) = (self.squad(who), self.roll(3));
                let stake = if self.roll(4) == 0 { 0 } else { cents(self, 30) };
                let invite = (self.roll(5) == 0).then(|| account(self.someone_else(who)));
                self.attempt("create_challenge", who, 0, |contract| contract.create_challenge(squad, yocto(stake), cap, invite));
                if self.roll(5) == 0 {
                    self.attempt("cancel_challenge", who, 0, |contract| contract.cancel_challenge());
                }
            }
            21 | 22 => {
                let open = self.chain.view(|contract| contract.get_challenges(None, None));
                if !open.is_empty() {
                    let (id, squad) = (open[self.roll(open.len() as u32) as usize].id, self.squad(who));
                    self.attempt("accept_challenge", who, 0, |contract| contract.accept_challenge(id, squad));
                }
                self.duel_turn(who);
            }
            23 => self.duel_turn(who),
            24 => {
                let (player, to) = (self.chain.player(who), account(self.someone_else(who)));
                let (token_id, amount) = match self.roll(5) {
                    0 => (format!("beast:{}", self.any_beast(who)), 1),
                    1 => ("essence".to_string(), self.roll(30) as u128),
                    2 if !player.backing.is_empty() => (format!("den:{}", player.backing[0].den), player.backing[0].shares.0 / 3),
                    _ if !player.items.is_empty() => (format!("item:{}", player.items[0].0), 1),
                    _ => ("item:1".to_string(), 1),
                };
                self.attempt("mt_transfer", who, 1, |contract| contract.mt_transfer(to, token_id, yocto(amount), None, None));
            }
            _ => {
                let (den, amount) = (self.roll(5) as u8, self.chain.treasury() / (2 + self.roll(6)) as u128);
                self.attempt("house_back_den", HOUSE, 0, |contract| contract.house_back_den(den, yocto(amount)));
                let pause = self.roll(900) as u64;
                self.chain.wait(pause);
            }
        }
    }

    /// Checks the books. A thorough audit also counts every token and every held stake.
    fn audit(&mut self, thorough: bool, seed: u128) {
        let ledger = self.chain.view(|contract| contract.get_ledger());
        assert_eq!((ledger.deposited.0, ledger.withdrawn.0), (seed + self.paid_in, self.paid_out));
        assert_eq!(
            ledger.balances.0 + ledger.bankrolls.0 + ledger.escrow.0 + ledger.treasury.0,
            seed + self.paid_in - self.paid_out,
            "NEAR was made or lost"
        );
        if !thorough {
            return;
        }
        let players: Vec<PlayerView> = PLAYERS.iter().map(|who| self.chain.player(who)).collect();
        assert_eq!(players.iter().map(|player| player.balance.0).sum::<u128>(), ledger.balances.0);
        let supply = |chain: &mut Chain, token_id: String| chain.view(|contract| contract.mt_supply(token_id)).unwrap().0;

        // Every stake in escrow belongs to an open challenge or an unfinished fight.
        let mut held: u128 = self.chain.view(|contract| contract.get_challenges(None, None)).iter().map(|challenge| challenge.stake.0).sum();
        for player in &players {
            for match_id in [player.den_match, player.duel].into_iter().flatten() {
                let fight = self.chain.view(|contract| contract.get_match(match_id)).unwrap();
                held += if fight.over { 0 } else { fight.stake.0 };
            }
        }
        assert_eq!(held, ledger.escrow.0);

        // Tokens: what the holders have is what exists.
        let essence: u64 = players.iter().map(|player| player.essence).sum();
        assert_eq!(supply(&mut self.chain, "essence".to_string()), essence as u128);
        for den in self.chain.view(|contract| contract.get_dens()) {
            let token_id = format!("den:{}", den.id);
            let house = self.chain.view(|contract| contract.mt_balance_of(account(HOUSE), token_id)).0;
            let backers: u128 =
                players.iter().flat_map(|player| &player.backing).filter(|position| position.den == den.id).map(|position| position.shares.0).sum();
            assert_eq!(house + backers, den.shares.0);
            assert_eq!(den.payout_bps, rules::den_payout_bps(den.wins, den.fights));
        }
        for item in data::ITEMS.iter() {
            let loose: u32 = players.iter().flat_map(|player| &player.items).filter(|(id, _)| *id == item.id).map(|(_, count)| *count).sum();
            assert_eq!(supply(&mut self.chain, format!("item:{}", item.id)), loose as u128);
        }
        let beasts = self.chain.view(|contract| contract.get_stats()).beasts;
        assert_eq!(players.iter().map(|player| player.beasts.len() as u64).sum::<u64>(), beasts);
        // Every beast is short of its next level, and wears the form of the level it has.
        for beast in players.iter().flat_map(|player| &player.beasts) {
            assert!(beast.level >= 1 && beast.xp < beast.xp_next && beast.xp_next == rules::xp_for_level(beast.level));
            assert_eq!(beast.form, rules::form_of(beast.level));
        }
    }
}

fn seal(action: u8, salt: &str) -> String {
    env::sha256(format!("{action}:{salt}")).iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn near_is_conserved_through_a_long_random_session() {
    let seed = 15 * NEAR + 4;
    let mut session =
        Session { chain: Chain::deploy(seed), rng: Rng::new(b"maul street", 2026), paid_in: 0, paid_out: 0, seen: BTreeMap::new() };
    for (index, who) in PLAYERS.iter().enumerate() {
        let picks = [index as u8 % 5, (index as u8 + 1) % 5, (index as u8 + 3) % 5];
        session.chain.join(who, picks, 12);
        session.paid_in += 12 * NEAR;
    }
    for round in 0..3_000 {
        session.act();
        session.audit(round % 40 == 0, seed);
    }
    session.audit(true, seed);

    println!("{:#?}", session.seen);
    // The session is only worth something if it went everywhere.
    for what in [
        "deposit", "withdraw", "level_up", "buy_item", "buy_beast", "equip", "unequip", "list_for_hire", "hire",
        "start_den_fight", "den_act", "forfeit_den", "staked den win", "staked den loss", "back_den", "unback_den",
        "house_back_den", "create_challenge", "cancel_challenge", "accept_challenge", "duel_commit", "duel_reveal",
        "duel_play", "forfeit_duel", "claim_timeout", "duel won", "duel void", "mt_transfer",
    ] {
        assert!(session.seen.get(what).copied().unwrap_or(0) >= 3, "the session saw too little of: {what}");
    }
}
