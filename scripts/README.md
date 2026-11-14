# Building, testing, deploying and running Maul Street on testnet

Everything here is for NEAR **testnet**. The contract lives at `maulstreet.testnet`. Its interface is written up in [`docs/CONTRACT.md`](../docs/CONTRACT.md).

The commands are for Git Bash on Windows, run from the project root. They use the tools installed under `C:\Users\HP\AppData\Local\Programs\near-dev`.

## Once per shell

```bash
export PATH="/c/Users/HP/AppData/Local/Programs/near-dev/w64devkit/bin:/c/Users/HP/AppData/Local/Programs/near-dev/node-v26.13.0-win-x64:$PATH"
export LIBRARY_PATH="C:/Users/HP/AppData/Local/Programs/near-dev/stub"
NEAR="/c/Users/HP/AppData/Local/Programs/near-dev/near-cli/near-cli-rs-x86_64-pc-windows-msvc/near.exe"
CARGO_NEAR="/c/Users/HP/AppData/Local/Programs/near-dev/cargo-near/cargo-near-x86_64-pc-windows-msvc/cargo-near.exe"
```

## Test

```bash
export AWS_LC_SYS_PREBUILT_NASM=1 AWS_LC_SYS_CMAKE_BUILDER=0
export CARGO_TARGET_DIR="$HOME/maul-target"     # any short path: see below
cargo test -p maul-contract                     # the contract: 53 tests
cargo test -p maul-core                         # the rules: 32 tests
unset CARGO_TARGET_DIR
```

If the machine is short of memory, add `-j 1` to build one crate at a time. A build that ran out of memory can leave the next one saying `can't find crate` or `found staticlib std`: run it again.

The short target folder matters on Windows. The test build compiles `aws-lc-sys` (a dependency of near-sdk's `unit-testing` feature, not of the contract itself), and from this project's long path its object files pass the 260-character limit: the build then stops with `ar: ... socket_helper.o: No such file or directory`. The wasm build is not affected.

The first test build takes a few minutes. The tests themselves take about half a minute. Every test call runs as its own transaction on a mocked chain and is rolled back if it panics (`crates/contract/src/tests/mod.rs`). `near_is_conserved_through_a_long_random_session` plays 3,000 random actions by four accounts and checks the books after each one.

To check that the contract compiles for the chain without building it: `cargo check -p maul-contract --target wasm32-unknown-unknown`.

## The signer test

`node scripts/signer-once.mjs` needs no network: it fakes the nodes. One takes a signed call and never answers, the next refuses it as "nonce already used", and nobody can say what became of it. The signer must then report the call as unconfirmed and never sign it again, because a second signature with a new nonce is a second move.

## Build the wasm

```bash
(cd crates/contract && "$CARGO_NEAR" near build non-reproducible-wasm --no-abi)
```

This writes `target/near/maul_contract/maul_contract.wasm` (about 417 KB after `wasm-opt`) and prints its SHA-256.

## Deploy

The accounts already exist: `maulstreet.testnet` (the contract and the house), `maulstreet-bank1`, `-bank2`, `-bank3` (they funded it), and the test players `maul-e2e-a.testnet` and `maul-e2e-b.testnet`. Their keys are in `~/.near-credentials/testnet`.

To put a new build of the code on the existing contract (its state stays as it is, so the state layout in `crates/contract/src/lib.rs` must not have changed):

```bash
"$NEAR" contract deploy maulstreet.testnet use-file target/near/maul_contract/maul_contract.wasm \
  without-init-call network-config testnet sign-with-legacy-keychain send
```

A contract with no state is initialised once. The attached NEAR is split between the five dens as their first bankrolls (this is what was run for `maulstreet.testnet`, with 15 NEAR):

```bash
"$NEAR" contract call-function as-transaction maulstreet.testnet new json-args '{}' \
  prepaid-gas '100 Tgas' attached-deposit '15 NEAR' \
  sign-as maulstreet.testnet network-config testnet sign-with-legacy-keychain send
```

### Onto clean state

When the stored layout changes (a field added to a beast, a player or a match), the old state has to go first, or every call fails with `Cannot deserialize the contract state`. The account cannot simply be deleted and made again: NEAR refuses to delete an account that holds more than 10 KB, and the contract's code alone is 400 KB. Instead a small contract that deletes storage keys takes the game's place for a moment:

```bash
(cd scripts/wipe-state && "$CARGO_NEAR" near build non-reproducible-wasm --no-abi)   # writes target/near/wipe_state.wasm
node scripts/wipe-state.mjs maulstreet.testnet     # deploys it, then removes every storage key
```

Then deploy the game and call `new`, as above. The account, its key and its NEAR are not touched. Everything the old contract kept track of is forgotten: players, beasts, bankrolls, and the balances players had inside it (that NEAR stays in the contract's account, no longer counted as anyone's). The script prints the old books before it wipes them.

This was done on 11 November 2026 for the change from upgrade tracks to levels.

For the record, this is how the accounts were made:

```bash
# A new account with 10 testnet NEAR from the faucet (it allows only a few an hour).
"$NEAR" account create-account sponsor-by-faucet-service maulstreet.testnet \
  autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain network-config testnet create
# The same for maulstreet-bank1, -bank2, -bank3 and maul-e2e-a. Each bank then sent the contract 9.9 NEAR:
"$NEAR" tokens maulstreet-bank1.testnet send-near maulstreet.testnet '9.9 NEAR' \
  network-config testnet sign-with-legacy-keychain send
# The faucet refused a sixth account, so maul-e2e-b was created and funded by maul-e2e-a:
"$NEAR" account create-account fund-myself maul-e2e-b.testnet '4.5 NEAR' autogenerate-new-keypair \
  save-to-legacy-keychain sign-as maul-e2e-a.testnet network-config testnet sign-with-legacy-keychain send
```

## Run the end-to-end script

```bash
node scripts/e2e.mjs
```

It needs nothing but Node (no `npm install`). With the two test players it registers both, deposits 2 NEAR each, buys a beast a level with Essence and one with NEAR, buys and equips an item, lists a beast and hires it from the other account, plays a free den fight and a 0.05 NEAR staked one to the end, backs and cashes out a den, posts and accepts a 0.1 NEAR challenge, and plays the whole duel with sealed moves on both sides. It checks the XP every fight gave every beast against the rules, and that the levels they reached are the ones that XP pays for. Then both players withdraw what they have left. Each step prints `PASS` or `FAIL`. At the end it prints every balance that changed, the gas each method burnt, and `E2E PASS` or `E2E FAIL` (exit code 1).

A run sends about 140 transactions and takes about 6 minutes. It can be run again and again: players who have joined are not registered twice, and a fight an earlier run left unfinished is forfeited first. A run costs the two players about 0.25 NEAR between them in prices and fees (most of it the item), and under 0.05 NEAR in gas.

How it talks to the chain: `near.exe` holds the keys, so it signs every transaction, offline. The script sends the signed transaction to a public RPC node itself and reads views from the node too. (When `near.exe` sends, it makes about ten requests per transaction, and the public nodes refuse that many after a minute or so.) Every call attaches 30 Tgas, which is what a key in the browser attaches by default, so the run also shows that no method needs more.

The last step checks the books: `get_ledger` must balance before and after, what the contract holds must have moved by exactly what was paid in less what was paid out, and the contract's own account must have moved by the same amount on chain. Other accounts may use the contract during a run.

Settings, all optional:

| Variable | Default | |
|---|---|---|
| `NEAR_CLI` | the `near.exe` above | near-cli-rs, which signs every transaction |
| `MAUL_CONTRACT` | `maulstreet.testnet` | the contract |
| `MAUL_PLAYER_A`, `MAUL_PLAYER_B` | `maul-e2e-a.testnet`, `maul-e2e-b.testnet` | accounts with a full-access key in `~/.near-credentials/testnet` and 3 NEAR or more each |
| `MAUL_RPC` | three public testnet RPCs | comma-separated. A node that is busy is passed over for the next |
| `MAUL_KEEP` | unset | `1` leaves the players' balances in the contract at the end |

## Looking at the contract by hand

```bash
# A view (free):
"$NEAR" contract call-function as-read-only maulstreet.testnet get_dens json-args '{}' network-config testnet now
"$NEAR" contract call-function as-read-only maulstreet.testnet get_player \
  json-args '{"account_id":"maul-e2e-a.testnet"}' network-config testnet now
# The books: balances + bankrolls + escrow + treasury always equals deposited - withdrawn.
"$NEAR" contract call-function as-read-only maulstreet.testnet get_ledger json-args '{}' network-config testnet now
# A change call:
"$NEAR" contract call-function as-transaction maulstreet.testnet level_up \
  json-args '{"beast_id":1,"with_essence":true}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as maul-e2e-a.testnet network-config testnet sign-with-legacy-keychain send
```

Transactions show up at `https://testnet.nearblocks.io/address/maulstreet.testnet`.
