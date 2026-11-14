//! Spending: levels, the bazaar, equipment and hiring.

use maul_core::{data, rules};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::views::{BeastView, PlayerView};
use crate::{fail, held, near_text, put, take, tokens, Beast, Contract, ContractExt};

#[near]
impl Contract {
    /// Takes the caller's beast up one level without waiting for it to earn the XP. NEAR
    /// from the balance buys the level at the rules' price, and the beast keeps the XP it
    /// has. Essence stands in for the XP the beast still lacks, one for one.
    pub fn level_up(&mut self, beast_id: u64, with_essence: bool) -> BeastView {
        let caller = env::predecessor_account_id();
        let beast = self.own_beast_mut(beast_id, &caller);
        let (level, xp) = (beast.level, beast.xp);
        if with_essence {
            let missing = rules::xp_for_level(level).saturating_sub(xp);
            let player = self.player_mut(&caller);
            require!(player.essence >= missing, format!("You don't have enough Essence. This level takes {missing}."));
            player.essence -= missing;
            self.essence_supply -= missing;
        } else {
            let cost = rules::level_cost_near(level);
            self.debit(&caller, cost);
            self.treasury += cost;
            self.volume += cost;
        }
        let beast = self.own_beast_mut(beast_id, &caller);
        beast.level = level + 1;
        // Bought with NEAR, the XP it has stays, held just short of the level after.
        beast.xp = if with_essence { 0 } else { xp.min(rules::xp_for_level(level + 1) - 1) };
        self.beast_view(beast_id)
    }

    /// Gives the caller's beast a new name: 1 to 24 printable ASCII characters.
    pub fn rename_beast(&mut self, beast_id: u64, name: String) -> BeastView {
        let caller = env::predecessor_account_id();
        require!(
            (1..=24).contains(&name.len()) && name.bytes().all(|byte| (0x20..=0x7e).contains(&byte)),
            "A name is 1 to 24 plain letters, digits, spaces or symbols."
        );
        self.own_beast_mut(beast_id, &caller).name = Some(name);
        self.beast_view(beast_id)
    }

    /// Buys one bazaar item at its current price, unless that is above `max_price`.
    /// Returns the price paid.
    pub fn buy_item(&mut self, item_id: u8, max_price: U128) -> U128 {
        let caller = env::predecessor_account_id();
        let index = item_index(item_id);
        let price = self.item_shelves[index].price(data::ITEMS[index].price_milli as u128 * rules::MILLI);
        self.pay_price(&caller, price, max_price.0);
        self.item_shelves[index].sell();
        self.stock_item(&caller, item_id);
        U128(price)
    }

    /// Mints a new beast of any species at its current price, unless that is above `max_price`.
    pub fn buy_beast(&mut self, species: u8, max_price: U128) -> BeastView {
        let caller = env::predecessor_account_id();
        let kind = data::species(species).unwrap_or_else(|| fail("There is no such kind of beast."));
        let price = self.species_shelves[species as usize].price(kind.price_milli as u128 * rules::MILLI);
        self.pay_price(&caller, price, max_price.0);
        self.species_shelves[species as usize].sell();
        let beast_id = self.mint_beast(&caller, species);
        tokens::log_mint(&caller, &[tokens::beast_token(beast_id)], &[1]);
        if kind.rare {
            self.announce(format!("{caller} bought a rare {} for {} NEAR", kind.name, near_text(price)));
        }
        self.beast_view(beast_id)
    }

    /// Moves one item from the caller's inventory onto their beast. Whatever was in that
    /// slot goes back to the inventory.
    pub fn equip(&mut self, beast_id: u64, item_id: u8) -> BeastView {
        let caller = env::predecessor_account_id();
        let kind = data::ITEMS[item_index(item_id)].kind;
        let slot = self.own_beast_mut(beast_id, &caller).slot_mut(kind);
        let replaced = std::mem::replace(slot, item_id);
        require!(
            take(&mut self.player_mut(&caller).items, &item_id, 1),
            "You don't have that item. Buy one in the bazaar first."
        );
        self.loose_items[item_index(item_id)] -= 1;
        tokens::log_burn(&caller, &[tokens::item_token(item_id)], &[1]);
        if replaced != 0 {
            self.stock_item(&caller, replaced);
        }
        self.beast_view(beast_id)
    }

    /// Takes whatever the caller's beast wears in one slot (0 relic, 1 aura, 2 finisher)
    /// back into the inventory.
    pub fn unequip(&mut self, beast_id: u64, kind: u8) -> BeastView {
        let caller = env::predecessor_account_id();
        require!(kind <= data::KIND_FINISHER, "Slots are 0 relic, 1 aura and 2 finisher.");
        let removed = std::mem::replace(self.own_beast_mut(beast_id, &caller).slot_mut(kind), 0);
        require!(removed != 0, "That slot is already empty.");
        self.stock_item(&caller, removed);
        self.beast_view(beast_id)
    }

    /// Offers the caller's beast for hire at `price` a fight (at least 0.001 NEAR).
    pub fn list_for_hire(&mut self, beast_id: u64, price: U128) {
        let caller = env::predecessor_account_id();
        require!(price.0 >= rules::MILLI, "The lowest hire price is 0.001 NEAR a fight.");
        self.own_beast_mut(beast_id, &caller).hire_price = Some(price.0);
        self.for_hire.insert(beast_id);
    }

    /// Takes the caller's beast off the hire market. Fights already paid for stay valid.
    pub fn unlist(&mut self, beast_id: u64) {
        let caller = env::predecessor_account_id();
        self.own_beast_mut(beast_id, &caller).hire_price = None;
        self.for_hire.remove(&beast_id);
    }

    /// Hires a listed beast for 1 to 20 fights. The price comes off the caller's balance:
    /// the house keeps its cut and the owner gets the rest.
    pub fn hire(&mut self, beast_id: u64, fights: u32) -> PlayerView {
        let caller = env::predecessor_account_id();
        let limit = rules::MAX_HIRE_FIGHTS;
        require!((1..=limit).contains(&fights), format!("Hire a beast for 1 to {limit} fights at a time."));
        let beast = self.beast(beast_id);
        let price = beast.hire_price.unwrap_or_else(|| fail("That beast is not for hire."));
        let (owner, name) = (beast.owner.clone(), beast.display_name());
        require!(owner != caller, "That beast is already yours.");
        require!(
            held(&self.player(&caller).hires, &beast_id) + fights <= limit,
            format!("You can hold at most {limit} paid fights with one beast.")
        );
        let cost = price.checked_mul(fights as u128).unwrap_or_else(|| fail("Your balance is too low."));
        self.debit(&caller, cost);
        let fee = rules::bps(cost, rules::HIRE_FEE_BPS);
        let income = cost - fee;
        self.treasury += fee;
        self.volume += cost;
        let landlord = self.player_mut(&owner);
        landlord.balance += income;
        landlord.hire_income += income;
        self.own_beast_mut(beast_id, &owner).earned += income;
        put(&mut self.player_mut(&caller).hires, beast_id, fights);
        let count = if fights == 1 { "1 fight".to_string() } else { format!("{fights} fights") };
        self.announce(format!("{caller} hired {owner}'s {name} for {count} ({} NEAR)", near_text(cost)));
        self.player_view(&caller)
    }
}

impl Contract {
    /// Charges a bazaar price to the buyer and passes it to the house.
    fn pay_price(&mut self, buyer: &AccountId, price: u128, max_price: u128) {
        if price > max_price {
            fail(&format!("The price is now {} NEAR, above the most you offered.", near_text(price)));
        }
        self.debit(buyer, price);
        self.treasury += price;
        self.volume += price;
    }

    /// Puts one item into a player's inventory.
    fn stock_item(&mut self, owner: &AccountId, item_id: u8) {
        put(&mut self.player_mut(owner).items, item_id, 1);
        self.loose_items[item_index(item_id)] += 1;
        tokens::log_mint(owner, &[tokens::item_token(item_id)], &[1]);
    }
}

impl Beast {
    /// The slot an item of this kind goes in: relic, aura or finisher.
    fn slot_mut(&mut self, kind: u8) -> &mut u8 {
        match kind {
            data::KIND_RELIC => &mut self.relic,
            data::KIND_AURA => &mut self.aura,
            _ => &mut self.finisher,
        }
    }
}

/// Where an item sits in `data::ITEMS`, and so on the contract's shelves.
pub(crate) fn item_index(item_id: u8) -> usize {
    data::ITEMS
        .iter()
        .position(|item| item.id == item_id)
        .unwrap_or_else(|| fail("The bazaar has no such item."))
}
