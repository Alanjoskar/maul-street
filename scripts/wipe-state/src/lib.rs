//! Deletes storage keys.
//!
//! When the layout of the game's stored state changes, the old state has to go
//! before the new contract can be initialised. An account cannot simply be
//! deleted and made again while it holds more than 10 KB. So this contract is
//! deployed in the game's place for a moment, told every key the account holds,
//! and removes them. `scripts/wipe-state.mjs` does all of that.

use near_sdk::json_types::Base64VecU8;
use near_sdk::{env, near};

#[near(contract_state)]
#[derive(Default)]
pub struct WipeState {}

#[near]
impl WipeState {
    /// Removes the given storage keys and returns how many of them were there. Only the
    /// account itself may call this.
    #[private]
    pub fn wipe(keys: Vec<Base64VecU8>) -> u32 {
        keys.iter().filter(|key| env::storage_remove(&key.0)).count() as u32
    }
}
