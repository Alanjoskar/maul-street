//! Everything a player holds, as NEP-245 multi tokens.
//!
//! Token ids: `beast:{id}` (one of each), `item:{id}` (what sits in inventories),
//! `essence`, and `den:{id}` (shares in a den). The house's den shares are held
//! under the contract's own account.

use maul_core::data;
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::serde_json::{json, Value};
use near_sdk::{assert_one_yocto, env, near, require, AccountId};

use crate::{fail, held, put, take, Contract, ContractExt};

pub(crate) const ESSENCE: &str = "essence";

pub(crate) fn beast_token(beast_id: u64) -> String {
    format!("beast:{beast_id}")
}

pub(crate) fn item_token(item_id: u8) -> String {
    format!("item:{item_id}")
}

pub(crate) fn den_token(den_id: u8) -> String {
    format!("den:{den_id}")
}

/// What a token id names.
#[derive(Clone, Copy)]
enum Token {
    Beast(u64),
    Item(u8),
    Essence,
    DenShare(u8),
}

/// Reads a token id. `None` if it is not one of ours, written the way we write it.
fn parse_token(token_id: &str) -> Option<Token> {
    let token = match token_id.split_once(':') {
        None if token_id == ESSENCE => Token::Essence,
        Some(("beast", number)) => Token::Beast(number.parse().ok()?),
        Some(("item", number)) => Token::Item(number.parse().ok().filter(|id| data::item(*id).is_some())?),
        Some(("den", number)) => Token::DenShare(number.parse().ok().filter(|id| data::den(*id).is_some())?),
        _ => return None,
    };
    let canonical = match &token {
        Token::Beast(beast_id) => beast_token(*beast_id),
        Token::Item(item_id) => item_token(*item_id),
        Token::Essence => ESSENCE.to_string(),
        Token::DenShare(den_id) => den_token(*den_id),
    };
    (canonical == token_id).then_some(token)
}

/// A token as NEP-245 describes it. Only a beast has a single owner.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TokenView {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[near]
impl Contract {
    /// Moves `amount` of one token from the caller to `receiver_id`, who must have joined
    /// the game. Needs exactly 1 yoctoNEAR attached. Approvals are not supported.
    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        require!(approval.is_none(), "Approvals are not supported.");
        self.transfer_tokens(receiver_id, vec![token_id], vec![amount], memo);
    }

    /// Moves several tokens from the caller to `receiver_id` at once. Needs exactly
    /// 1 yoctoNEAR attached. Approvals are not supported.
    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        require!(approvals.is_none_or(|list| list.iter().all(Option::is_none)), "Approvals are not supported.");
        self.transfer_tokens(receiver_id, token_ids, amounts, memo);
    }

    /// How much of a token an account holds. An item a beast wears is not counted.
    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.token_balance(&account_id, &token_id))
    }

    /// `mt_balance_of` for several tokens at once.
    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|token_id| U128(self.token_balance(&account_id, token_id))).collect()
    }

    /// How much of a token exists, or null if there is no such token.
    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        let supply = match parse_token(&token_id)? {
            Token::Beast(beast_id) => self.beasts.contains_key(&beast_id).then_some(1)?,
            Token::Item(item_id) => self.loose_items[crate::market::item_index(item_id)] as u128,
            Token::Essence => self.essence_supply as u128,
            Token::DenShare(den_id) => self.dens[den_id as usize].shares,
        };
        Some(U128(supply))
    }

    /// Describes each token asked for, or null where there is no such token.
    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<TokenView>> {
        token_ids
            .into_iter()
            .map(|token_id| {
                let owner_id = match parse_token(&token_id)? {
                    Token::Beast(beast_id) => Some(self.beasts.get(&beast_id)?.owner.clone()),
                    _ => None,
                };
                Some(TokenView { token_id, owner_id })
            })
            .collect()
    }

    /// The tokens an account holds: its beasts, then its items, Essence and den shares.
    pub fn mt_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u32>) -> Vec<TokenView> {
        let mut tokens = Vec::new();
        if let Some(player) = self.players.get(&account_id) {
            tokens.extend(player.beasts.iter().map(|beast_id| (beast_token(*beast_id), Some(account_id.clone()))));
            tokens.extend(player.items.iter().map(|(item_id, _)| (item_token(*item_id), None)));
            tokens.extend((player.essence > 0).then(|| (ESSENCE.to_string(), None)));
        }
        let shares = data::DENS.iter().map(|den| den_token(den.id)).filter(|token_id| self.token_balance(&account_id, token_id) > 0);
        tokens.extend(shares.map(|token_id| (token_id, None)));
        tokens
            .into_iter()
            .skip(from_index.map_or(0, |index| index.0 as usize))
            .take(limit.unwrap_or(u32::MAX) as usize)
            .map(|(token_id, owner_id)| TokenView { token_id, owner_id })
            .collect()
    }
}

impl Contract {
    /// Moves tokens from the caller to another player and logs one `mt_transfer` event.
    fn transfer_tokens(&mut self, receiver: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, memo: Option<String>) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        require!(sender != receiver, "You can't transfer to yourself.");
        require!(self.players.contains_key(&receiver), "The receiver has not joined Maul Street yet.");
        require!(!token_ids.is_empty() && token_ids.len() == amounts.len(), "Give one amount for each token.");
        for (token_id, amount) in token_ids.iter().zip(&amounts) {
            self.move_token(&sender, &receiver, token_id, amount.0);
        }
        let mut transfer = json!({
            "old_owner_id": sender,
            "new_owner_id": receiver,
            "token_ids": token_ids,
            "amounts": amounts,
        });
        if let Some(memo) = memo {
            transfer["memo"] = Value::String(memo);
        }
        log_event("mt_transfer", transfer);
    }

    fn move_token(&mut self, sender: &AccountId, receiver: &AccountId, token_id: &str, amount: u128) {
        require!(amount > 0, "Transfer more than nothing.");
        let short = "You don't hold that much to transfer.";
        match parse_token(token_id).unwrap_or_else(|| fail("There is no such token.")) {
            Token::Beast(beast_id) => {
                require!(amount == 1, "A beast is one of a kind: transfer exactly 1.");
                // A beast changes hands with what it wears, and comes off the hire market.
                let beast = self.own_beast_mut(beast_id, sender);
                beast.owner = receiver.clone();
                beast.hire_price = None;
                self.for_hire.remove(&beast_id);
                self.player_mut(sender).beasts.retain(|owned| *owned != beast_id);
                let new_owner = self.player_mut(receiver);
                new_owner.beasts.push(beast_id);
                new_owner.hires.retain(|(hired, _)| *hired != beast_id);
            }
            Token::Item(item_id) => {
                let count = u32::try_from(amount).unwrap_or_else(|_| fail(short));
                require!(take(&mut self.player_mut(sender).items, &item_id, count), short);
                put(&mut self.player_mut(receiver).items, item_id, count);
            }
            Token::Essence => {
                let essence = u64::try_from(amount).unwrap_or_else(|_| fail(short));
                let player = self.player_mut(sender);
                require!(player.essence >= essence, short);
                player.essence -= essence;
                self.player_mut(receiver).essence += essence;
            }
            Token::DenShare(den_id) => {
                require!(take(&mut self.player_mut(sender).backing, &den_id, amount), short);
                put(&mut self.player_mut(receiver).backing, den_id, amount);
            }
        }
    }

    fn token_balance(&self, account: &AccountId, token_id: &str) -> u128 {
        let Some(token) = parse_token(token_id) else { return 0 };
        // The house's den shares sit under the contract's own account.
        let house = match token {
            Token::DenShare(den_id) if *account == env::current_account_id() => self.dens[den_id as usize].house_shares,
            _ => 0,
        };
        let Some(player) = self.players.get(account) else { return house };
        house
            + match token {
                Token::Beast(beast_id) => player.beasts.contains(&beast_id) as u128,
                Token::Item(item_id) => held(&player.items, &item_id) as u128,
                Token::Essence => player.essence as u128,
                Token::DenShare(den_id) => held(&player.backing, &den_id),
            }
    }
}

// ----- NEP-245 events ---------------------------------------------------------------

fn log_event(event: &str, data: Value) {
    let log = json!({ "standard": "nep245", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{log}"));
}

fn amount_strings(amounts: &[u128]) -> Vec<String> {
    amounts.iter().map(u128::to_string).collect()
}

/// Logs tokens coming into being in `owner`'s hands.
pub(crate) fn log_mint(owner: &AccountId, token_ids: &[String], amounts: &[u128]) {
    log_event("mt_mint", json!({ "owner_id": owner, "token_ids": token_ids, "amounts": amount_strings(amounts) }));
}

/// Logs tokens leaving `owner`'s hands for good.
pub(crate) fn log_burn(owner: &AccountId, token_ids: &[String], amounts: &[u128]) {
    log_event("mt_burn", json!({ "owner_id": owner, "token_ids": token_ids, "amounts": amount_strings(amounts) }));
}
