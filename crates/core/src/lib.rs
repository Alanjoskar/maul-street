//! The rules of Maul Street.
//!
//! This crate has no chain code in it. The contract (`crates/contract`) and the
//! browser module (`crates/browser`) both build on it, so a fight, a price or a
//! payout is worked out by exactly the same code on chain and on screen.
//!
//! - `data`: the beasts, the bazaar items and the house fighters.
//! - `rules`: every price, fee and payout, with the reasoning in words.
//! - `battle`: the fight engine.
//! - `npc`: how the house fighters choose their moves.

pub mod battle;
pub mod data;
pub mod npc;
pub mod rules;
