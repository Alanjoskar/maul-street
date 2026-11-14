//! Unit tests.
//!
//! Every call runs as its own transaction on a mocked chain, the way it would on NEAR:
//! the contract is loaded from storage, the call runs, and what it changed is kept only
//! if it did not panic. Each call gets a different random seed.

mod books;
mod dens;
mod duels;
mod levels;
mod market;
mod money;
mod shapes;
mod tokens;

use std::any::Any;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

use maul_core::battle;
use maul_core::rules::NEAR;
use near_sdk::json_types::U128;
use near_sdk::mock::{with_mocked_blockchain, MockAction};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{env, test_vm_config, AccountId, MockedBlockchain, NearToken, RuntimeFeesConfig, VMContext};

use crate::views::{BeastView, DenView, MatchView, PlayerView};
use crate::Contract;

/// The contract's own account, which is also the house.
const HOUSE: &str = "maulstreet.testnet";
const AVA: &str = "ava.testnet";
const THEO: &str = "theo.testnet";
const MIRA: &str = "mira.testnet";

/// A hundredth of a NEAR.
const CENT: u128 = NEAR / 100;

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

type Storage = HashMap<Vec<u8>, Vec<u8>>;

struct Chain {
    /// Points the mocked chain at a call with this context, over this storage.
    mock: Box<dyn Fn(VMContext, Storage)>,
    /// The time, in Unix seconds.
    now: u64,
    /// How many calls have run. Each gets its own random seed.
    calls: u64,
    /// The logs of the last call that worked...
    logs: Vec<String>,
    /// ...and the NEAR it sent out, as (receiver, yoctoNEAR).
    transfers: Vec<(AccountId, u128)>,
}

impl Chain {
    /// Deploys the contract with `seed` yoctoNEAR attached to `new`.
    fn deploy(seed: u128) -> Chain {
        // Building the VM's settings is slow, so it is done once and copied for every call.
        let config = test_vm_config();
        let mock = move |context, storage| {
            let fees = RuntimeFeesConfig::test();
            let chain = MockedBlockchain::new(context, config.clone(), fees, Vec::new(), storage, Default::default(), None);
            env::set_blockchain_interface(chain);
        };
        let mut chain = Chain { mock: Box::new(mock), now: 1_800_000_000, calls: 0, logs: Vec::new(), transfers: Vec::new() };
        chain.enter(&account(HOUSE), seed, false, HashMap::new());
        let contract = Contract::new();
        env::state_write(&contract);
        drop(contract);
        chain.logs = get_logs();
        chain
    }

    /// Points the mocked chain at one call.
    fn enter(&self, who: &AccountId, deposit: u128, view: bool, storage: Storage) {
        let mut seed = [0u8; 32];
        for (index, chunk) in seed.chunks_mut(8).enumerate() {
            let mixed = (self.calls + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15).rotate_left(index as u32 * 13);
            chunk.copy_from_slice(&mixed.to_le_bytes());
        }
        let context = VMContextBuilder::new()
            .current_account_id(account(HOUSE))
            .signer_account_id(who.clone())
            .predecessor_account_id(who.clone())
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(self.now * 1_000_000_000)
            .random_seed(seed)
            .is_view(view)
            .build();
        (self.mock)(context, storage);
    }

    /// Runs one call as a transaction from `who` with `deposit` attached. A panic rolls
    /// everything back and comes out as the error text.
    fn call<R>(&mut self, who: &str, deposit: u128, run: impl FnOnce(&mut Contract) -> R) -> Result<R, String> {
        self.calls += 1;
        let who = account(who);
        let before = with_mocked_blockchain(|chain| chain.take_storage());
        self.enter(&who, deposit, false, before.clone());
        let mut contract: Contract = env::state_read().expect("the contract is deployed");
        match catch_unwind(AssertUnwindSafe(|| run(&mut contract))) {
            Ok(value) => {
                env::state_write(&contract);
                drop(contract);
                self.logs = get_logs();
                self.transfers = get_created_receipts()
                    .into_iter()
                    .flat_map(|receipt| {
                        let receiver = receipt.receiver_id;
                        receipt.actions.into_iter().filter_map(move |action| match action {
                            MockAction::Transfer { deposit, .. } => Some((receiver.clone(), deposit.as_yoctonear())),
                            _ => None,
                        })
                    })
                    .collect();
                Ok(value)
            }
            Err(panic) => {
                // The half-changed contract must not reach storage.
                std::mem::forget(contract);
                self.enter(&who, 0, false, before);
                Err(panic_text(panic))
            }
        }
    }

    /// A call with no deposit that must work.
    fn ok<R>(&mut self, who: &str, run: impl FnOnce(&mut Contract) -> R) -> R {
        self.call(who, 0, run).unwrap_or_else(|error| panic!("the call should have worked: {error}"))
    }

    /// A call with no deposit that must fail with a message containing `expected`.
    fn fails<R>(&mut self, who: &str, run: impl FnOnce(&mut Contract) -> R, expected: &str) {
        match self.call(who, 0, run) {
            Ok(_) => panic!("the call should have failed with: {expected}"),
            Err(error) => assert!(error.contains(expected), "expected `{expected}`, got `{error}`"),
        }
    }

    /// Reads the contract the way a view call does.
    fn view<R>(&mut self, read: impl FnOnce(&Contract) -> R) -> R {
        let storage = with_mocked_blockchain(|chain| chain.take_storage());
        self.enter(&account(HOUSE), 0, true, storage);
        let contract: Contract = env::state_read().expect("the contract is deployed");
        read(&contract)
    }

    /// Lets time pass.
    fn wait(&mut self, seconds: u64) {
        self.now += seconds;
    }

    /// Registers `who` with three starters and puts `near` whole NEAR on their balance.
    fn join(&mut self, who: &str, picks: [u8; 3], near: u128) -> [u64; 3] {
        let player = self.ok(who, |contract| contract.register(picks));
        if near > 0 {
            self.call(who, near * NEAR, |contract| contract.deposit()).unwrap();
        }
        [player.beasts[0].id, player.beasts[1].id, player.beasts[2].id]
    }

    fn player(&mut self, who: &str) -> PlayerView {
        self.view(|contract| contract.get_player(account(who)))
    }

    fn beast(&mut self, beast_id: u64) -> BeastView {
        self.view(|contract| contract.get_beast(beast_id)).expect("the beast exists")
    }

    fn balance(&mut self, who: &str) -> u128 {
        self.player(who).balance.0
    }

    fn den(&mut self, den_id: u8) -> DenView {
        self.view(|contract| contract.get_dens()).swap_remove(den_id as usize)
    }

    fn treasury(&mut self) -> u128 {
        self.view(|contract| contract.get_stats()).treasury.0
    }

    fn escrow(&mut self) -> u128 {
        self.view(|contract| contract.get_ledger()).escrow.0
    }

    /// The newest ticker line.
    fn headline(&mut self) -> String {
        self.view(|contract| contract.get_ticker()).first().map(|line| line.text.clone()).unwrap_or_default()
    }

    /// The last call's NEP-245 events of one kind, as JSON text.
    fn events(&self, kind: &str) -> Vec<&String> {
        let marker = format!("\"event\":\"{kind}\"");
        self.logs.iter().filter(|log| log.starts_with("EVENT_JSON:") && log.contains(&marker)).collect()
    }

    /// Checks that the books balance: everything the contract holds for players, dens and
    /// the house is exactly what was paid in, less what was paid out.
    fn assert_books_balance(&mut self) {
        let ledger = self.view(|contract| contract.get_ledger());
        assert_eq!(
            ledger.balances.0 + ledger.bankrolls.0 + ledger.escrow.0 + ledger.treasury.0,
            ledger.deposited.0 - ledger.withdrawn.0,
            "the books do not balance"
        );
    }

    /// Plays the caller's den fight to its end with one habitual move, checking each
    /// step's bookkeeping on the way. Returns the finished fight.
    fn play_den_fight(&mut self, who: &str, habit: u8) -> MatchView {
        let match_id = self.player(who).den_match.expect("a den fight is on");
        let mut fight = self.view(|contract| contract.get_match(match_id)).unwrap();
        loop {
            let (turn_before, action) = (fight.battle.turn, legal_action(&fight, 0, habit));
            fight = self.ok(who, |contract| contract.den_act(action));
            assert!(fight.over || fight.need[0], "the den never leaves the player waiting on it");
            assert!(fight.steps.len() <= 4, "at most four steps are kept");
            assert_eq!(fight.steps.last().unwrap().turn, fight.battle.turn);
            // The call's events are exactly the events of the steps it played.
            let played = (fight.battle.turn - turn_before) as usize;
            let replay: Vec<_> = fight.steps[fight.steps.len() - played..].iter().flat_map(|step| step.events.clone()).collect();
            assert_eq!(replay, fight.last_events);
            if fight.over {
                return fight;
            }
        }
    }
}

/// A legal action for `side`: the first living beast when it is time to pick, the Special
/// on a full Rage bar, and otherwise the same `habit` every time.
fn legal_action(fight: &MatchView, side: usize, habit: u8) -> u8 {
    let (team, active) = (&fight.battle.teams[side], fight.battle.active[side]);
    if active == battle::NONE {
        battle::ACT_PICK + team.iter().position(|fighter| fighter.hp > 0).unwrap() as u8
    } else if team[active as usize].rage >= 100 {
        battle::MOVE_SPECIAL
    } else {
        habit
    }
}

fn panic_text(panic: Box<dyn Any + Send>) -> String {
    match panic.downcast::<String>() {
        Ok(text) => *text,
        Err(panic) => panic.downcast_ref::<&str>().map(|text| text.to_string()).unwrap_or_default(),
    }
}

fn yocto(amount: u128) -> U128 {
    U128(amount)
}
