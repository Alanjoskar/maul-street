#!/usr/bin/env node
// Clears a contract account's storage on NEAR testnet, so that a contract with a
// different state layout can be deployed and initialised in its place.
//
//   node scripts/wipe-state.mjs maulstreet.testnet
//
// It deploys the little contract in scripts/wipe-state to the account (build it
// first: see scripts/README.md), reads every storage key the account holds from
// an RPC node, and has the account call `wipe` on itself until none are left.
//
// The account, its keys and its NEAR are not touched. What the old contract kept
// track of is forgotten: players' balances, bankrolls, beasts. The NEAR behind
// them stays in the account. Afterwards deploy the game and call `new` again.
//
// Settings (environment variables): NEAR_CLI (path to near.exe), MAUL_RPC
// (comma-separated testnet RPCs), WIPE_WASM (path to the built wipe_state.wasm).

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NEAR_CLI =
  process.env.NEAR_CLI ??
  'C:/Users/HP/AppData/Local/Programs/near-dev/near-cli/near-cli-rs-x86_64-pc-windows-msvc/near.exe';
const RPCS = (
  process.env.MAUL_RPC ??
  'https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com,https://near-testnet.drpc.org'
).split(',');
const WASM =
  process.env.WIPE_WASM ?? fileURLToPath(new URL('../target/near/wipe_state.wasm', import.meta.url));
const account = process.argv[2];

/** Runs near.exe. Resolves with whether it failed and what it printed, colours stripped. */
function nearCli(args) {
  return new Promise((resolve) => {
    execFile(NEAR_CLI, args, { maxBuffer: 8 * 1024 * 1024, timeout: 180_000 }, (error, stdout, stderr) => {
      resolve({ failed: Boolean(error), printed: `${stdout}\n${stderr}`.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') });
    });
  });
}

/** One JSON-RPC request, tried on each node in turn. */
async function rpc(method, params) {
  let problem;
  for (const url of [...RPCS, ...RPCS]) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = response.ok ? await response.json() : { error: `HTTP ${response.status}` };
      if (body.result) return body.result;
      problem = JSON.stringify(body.error).slice(0, 300);
    } catch (error) {
      problem = error.message;
    }
  }
  throw new Error(`RPC ${method} failed on every node: ${problem}`);
}

/** Every storage key the account holds, in base64. */
async function storageKeys() {
  const state = await rpc('query', { request_type: 'view_state', finality: 'final', account_id: account, prefix_base64: '' });
  return state.values.map((entry) => entry.key);
}

async function main() {
  if (!account?.endsWith('.testnet')) throw new Error('Name the testnet account to clear: node scripts/wipe-state.mjs <account>.testnet');
  if (!existsSync(WASM)) throw new Error(`Build the wipe contract first (see scripts/README.md). Not found: ${WASM}`);

  let keys = await storageKeys();
  console.log(`${account} holds ${keys.length} storage keys.`);
  if (keys.length === 0) return;

  // What is about to be forgotten, if the contract there now can say.
  const ledger = await rpc('query', {
    request_type: 'call_function', finality: 'final', account_id: account, method_name: 'get_ledger', args_base64: 'e30=',
  }).catch(() => null);
  if (ledger?.result) console.log(`Its books before the wipe: ${Buffer.from(ledger.result).toString()}`);

  const deployed = await nearCli([
    'contract', 'deploy', account, 'use-file', WASM, 'without-init-call',
    'network-config', 'testnet', 'sign-with-legacy-keychain', 'send',
  ]);
  if (deployed.failed) throw new Error(`Could not deploy the wipe contract:\n${deployed.printed.trim().split('\n').slice(-8).join('\n')}`);
  console.log(`Deployed the wipe contract (${/Transaction ID:\s*(\w+)/.exec(deployed.printed)?.[1]}).`);

  for (let round = 0; keys.length > 0 && round < 50; round += 1) {
    const batch = keys.slice(0, 100);
    const args = Buffer.from(JSON.stringify({ keys: batch })).toString('base64');
    const wiped = await nearCli([
      'contract', 'call-function', 'as-transaction', account, 'wipe', 'base64-args', args,
      'prepaid-gas', '300 Tgas', 'attached-deposit', '0 NEAR', 'sign-as', account,
      'network-config', 'testnet', 'sign-with-legacy-keychain', 'send',
    ]);
    if (wiped.failed) throw new Error(`wipe failed:\n${wiped.printed.trim().split('\n').slice(-8).join('\n')}`);
    console.log(`Removed ${batch.length} keys (${/Transaction ID:\s*(\w+)/.exec(wiped.printed)?.[1]}).`);
    keys = await storageKeys();
  }
  if (keys.length > 0) throw new Error(`${keys.length} keys are still there.`);
  console.log(`${account} holds no storage now. Deploy the game and call new.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
