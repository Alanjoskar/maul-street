#!/usr/bin/env node
// Maul Street, end to end on NEAR testnet.
//
// Two test players go through the whole game against the deployed contract:
// join, deposit, level up, shop, hire, fight the dens, back a den, and duel each
// other with sealed moves. Every step prints PASS or FAIL. At the end the script
// prints every balance that changed and checks that no NEAR was made or lost.
//
// Plain Node, no dependencies. near-cli-rs (near.exe) holds the players' keys in
// ~/.near-credentials and signs every transaction. The script sends the signed
// transactions to a testnet RPC node and reads the contract's views from it.
//
//   node scripts/e2e.mjs
//
// Settings (environment variables):
//   NEAR_CLI        path to near.exe
//   MAUL_CONTRACT   the contract account          (default maulstreet.testnet)
//   MAUL_PLAYER_A   first test player             (default maul-e2e-a.testnet)
//   MAUL_PLAYER_B   second test player            (default maul-e2e-b.testnet)
//   MAUL_RPC        comma-separated testnet RPCs
//   MAUL_KEEP=1     leave the players' balances in the contract at the end
//
// The script can be run again and again: players who have already joined are not
// registered twice, and a fight left unfinished by an earlier run is forfeited first.

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const NEAR_CLI =
  process.env.NEAR_CLI ??
  'C:/Users/HP/AppData/Local/Programs/near-dev/near-cli/near-cli-rs-x86_64-pc-windows-msvc/near.exe';
const CONTRACT = process.env.MAUL_CONTRACT ?? 'maulstreet.testnet';
const A = process.env.MAUL_PLAYER_A ?? 'maul-e2e-a.testnet';
const B = process.env.MAUL_PLAYER_B ?? 'maul-e2e-b.testnet';
const RPCS = (
  process.env.MAUL_RPC ??
  'https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com,https://near-testnet.drpc.org'
).split(',');
const KEEP = process.env.MAUL_KEEP === '1';

const NEAR = 10n ** 24n;
const CENT = NEAR / 100n;
const [STRIKE, BREAK, SPECIAL, PICK, NOBODY] = [0, 2, 3, 10, 255];
/** The gas attached to every call. A key in the browser attaches this much by default, so no call may need more. */
const PREPAID_GAS = '30 Tgas';

// ----- Talking to the chain ---------------------------------------------------
//
// near.exe signs offline: it never touches the network. The script sends the signed
// bytes to an RPC node itself, one request per transaction. (Letting near.exe send
// takes about ten requests per transaction, which the public nodes soon refuse.)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const base64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64');

/** The contract refused a call. `message` is the sentence it panicked with. */
class Refused extends Error {}

/** An RPC node answered with an error of its own, such as an unknown block or a used nonce. */
class RpcError extends Error {}

/** The node that answered last. Requests go to it first. */
let rpcIndex = 0;

/** One JSON-RPC request. A node that is busy or out of reach is passed over for the next. */
async function rpc(method, params) {
  let problem;
  for (let attempt = 0; attempt < RPCS.length * 4; attempt += 1) {
    const index = (rpcIndex + attempt) % RPCS.length;
    try {
      const response = await fetch(RPCS[index], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`${RPCS[index]} answered HTTP ${response.status}`);
      const body = await response.json();
      const error = body.error && JSON.stringify(body.error);
      if (error && /rate limit|too many requests/i.test(error)) throw new Error(`${RPCS[index]} is rate limited`);
      rpcIndex = index;
      if (error) throw new RpcError(error);
      return body.result;
    } catch (error) {
      if (error instanceof RpcError) throw error;
      problem = error;
      await sleep(300 * (attempt + 1));
    }
  }
  throw new Error(`no RPC node answered ${method}: ${problem?.message}`);
}

/** The block each signer's latest transaction finished in, until its height has been looked up. */
const unsettled = new Map();
/** Views are read from a block at least this high, so they show every transaction already sent. */
let floor = 0;
let settling = Promise.resolve();

/** Raises `floor` to the blocks the latest transactions finished in. */
function settle() {
  settling = settling
    .catch(() => {})
    .then(async () => {
      for (const [signer, blockHash] of [...unsettled]) {
        for (let attempt = 0; ; attempt += 1) {
          try {
            floor = Math.max(floor, (await rpc('block', { block_id: blockHash })).header.height);
            break;
          } catch (error) {
            // A node may not have seen the newest block yet.
            if (!(error instanceof RpcError) || attempt >= 40) throw error;
            await sleep(250);
          }
        }
        if (unsettled.get(signer) === blockHash) unsettled.delete(signer);
      }
    });
  return settling;
}

/** Reads the chain's latest state, never older than the transactions this script has sent. */
async function query(params) {
  await settle();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await rpc('query', { finality: 'optimistic', ...params });
    if (result.block_height >= floor) return result;
    await sleep(250);
  }
  throw new Error('the RPC nodes are behind the chain');
}

/** Calls a view method of the contract. */
async function view(method, args = {}) {
  const result = await query({ request_type: 'call_function', account_id: CONTRACT, method_name: method, args_base64: base64(args) });
  if (result.error) throw new Error(`view ${method} failed: ${result.error}`);
  return JSON.parse(Buffer.from(result.result).toString());
}

/** The NEAR an account holds on chain, in yoctoNEAR. */
async function wallet(accountId) {
  return BigInt((await query({ request_type: 'view_account', account_id: accountId })).amount);
}

/** Runs near.exe and resolves with what it printed, colours stripped. */
function nearCli(args) {
  return new Promise((resolve) => {
    execFile(NEAR_CLI, args, { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 }, (error, stdout, stderr) => {
      resolve(`${stdout}\n${stderr}`.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ''));
    });
  });
}

/** Each signer's public key and the last nonce used with it. */
const signers = new Map();

async function signerOf(accountId, refresh = false) {
  if (refresh || !signers.has(accountId)) {
    const { keys } = await rpc('query', { request_type: 'view_access_key_list', finality: 'optimistic', account_id: accountId });
    const key = keys.find((entry) => entry.access_key.permission === 'FullAccess');
    if (!key) throw new Error(`${accountId} has no full-access key`);
    // Nonces only go up. Keep the higher of the chain's and our own, in case a transaction is still on its way.
    const nonce = Math.max(key.access_key.nonce, signers.get(accountId)?.nonce ?? 0);
    signers.set(accountId, { publicKey: key.public_key, nonce });
  }
  return signers.get(accountId);
}

/** A recent block for transactions to name. One is good for hours; a new one is fetched every few minutes. */
let anchor = null;

async function recentBlock(refresh = false) {
  if (refresh || !anchor || Date.now() - anchor.at > 180_000) {
    const { header } = await rpc('block', { finality: 'final' });
    anchor = { hash: header.hash, height: header.height, at: Date.now() };
  }
  return anchor;
}

function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let text = '';
  for (; number > 0n; number /= 58n) text = alphabet[Number(number % 58n)] + text;
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}

/** Has near.exe sign one call to the contract. Returns the signed transaction and its hash. */
async function sign(accountId, method, args, deposit) {
  const [signer, block] = await Promise.all([signerOf(accountId), recentBlock()]);
  signer.nonce += 1;
  const printed = await nearCli([
    '--offline', '--quiet', 'contract', 'call-function', 'as-transaction', CONTRACT, method, 'base64-args', base64(args),
    'prepaid-gas', PREPAID_GAS, 'attached-deposit', deposit, 'sign-as', accountId, 'network-config', 'testnet',
    'sign-with-legacy-keychain', '--signer-public-key', signer.publicKey, '--nonce', String(signer.nonce),
    '--block-hash', block.hash, '--block-height', String(block.height), 'display',
  ]);
  const signed = /Signed transaction \(serialized as base64\):\s*([A-Za-z0-9+/=]+)/.exec(printed)?.[1];
  if (!signed) throw new Error(`near.exe did not sign ${method} for ${accountId}:\n${printed.trim().split('\n').slice(-6).join('\n')}`);
  // A transaction's hash is the SHA-256 of its bytes, without the 65 bytes of signature at the end.
  const bytes = Buffer.from(signed, 'base64');
  return { signed, hash: base58(createHash('sha256').update(bytes.subarray(0, -65)).digest()) };
}

/** Sends a signed transaction and waits until it has run. */
async function deliver(accountId, signed, hash) {
  try {
    return await rpc('send_tx', { signed_tx_base64: signed, wait_until: 'EXECUTED_OPTIMISTIC' });
  } catch (error) {
    // A transaction the node turned down was not run. Anything else may still be on its way: look for it.
    if (error instanceof RpcError && /INVALID_TRANSACTION|InvalidTxError/.test(error.message)) throw error;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(1_000);
      const found = await rpc('tx', { tx_hash: hash, sender_account_id: accountId, wait_until: 'EXECUTED_OPTIMISTIC' }).catch(() => null);
      if (found) return found;
    }
    throw new Error(`the transaction did not get through: ${error.message.slice(0, 300)}`);
  }
}

/** What every call burnt, for the gas table: method → [{ call, total, hash, signer }]. */
const gasLog = new Map();

/**
 * Makes one call to the contract as `accountId` and waits until it has run. Returns what the
 * method returned. Throws `Refused` if the contract panicked.
 */
async function call(accountId, method, args = {}, deposit = '0 NEAR') {
  for (let attempt = 0; ; attempt += 1) {
    const { signed, hash } = await sign(accountId, method, args, deposit);
    let result;
    try {
      result = await deliver(accountId, signed, hash);
    } catch (error) {
      // A used nonce or an old block: nothing was run, so sign again with fresh ones.
      if (!(error instanceof RpcError && /InvalidNonce|Expired/.test(error.message)) || attempt >= 3) throw error;
      await Promise.all([signerOf(accountId, true), recentBlock(true)]);
      continue;
    }
    const outcomes = [result.transaction_outcome, ...result.receipts_outcome];
    unsettled.set(accountId, outcomes.at(-1).block_hash);
    const failure = result.status.Failure;
    if (failure) {
      const reason = failure.ActionError?.kind?.FunctionCallError?.ExecutionError ?? JSON.stringify(failure);
      throw new Refused(`${method}: ${reason.replace('Smart contract panicked: ', '')}`);
    }
    // The first receipt is the function call itself. Before it comes the cost of sending the transaction.
    const burnt = outcomes.map((entry) => BigInt(entry.outcome.gas_burnt));
    if (!gasLog.has(method)) gasLog.set(method, []);
    gasLog.get(method).push({ call: burnt[1], total: burnt.reduce((sum, gas) => sum + gas, 0n), hash, signer: accountId });
    const value = Buffer.from(result.status.SuccessValue ?? '', 'base64').toString();
    return value ? JSON.parse(value) : null;
  }
}

/** Everything a transaction burnt once it is final, the refund of unused gas included. */
async function finalGas({ hash, signer }) {
  const status = await rpc('tx', { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' });
  return [status.transaction_outcome, ...status.receipts_outcome].reduce((sum, entry) => sum + BigInt(entry.outcome.gas_burnt), 0n);
}

// ----- Small helpers ------------------------------------------------------------

/** YoctoNEAR as a readable number of NEAR. */
function near(yocto) {
  const sign = yocto < 0n ? '-' : '';
  const micro = ((yocto < 0n ? -yocto : yocto) + 5n * 10n ** 17n) / 10n ** 18n;
  const text = `${micro / 1_000_000n}.${String(micro % 1_000_000n).padStart(6, '0')}`;
  return sign + text.replace(/0+$/, '').replace(/\.$/, '');
}

/** The hash a move is sealed under: SHA-256 of "{action}:{salt}", in lowercase hex. */
const seal = (action, salt) => createHash('sha256').update(`${action}:${salt}`).digest('hex');

/**
 * A legal action: the first living beast when it is time to pick, otherwise `habit`.
 * With `special`, a full Rage bar is spent on the Special.
 */
function legalAction(match, side, habit, special = true) {
  const team = match.battle.teams[side];
  const active = match.battle.active[side];
  if (active === NOBODY) return PICK + team.findIndex((fighter) => fighter.hp > 0);
  return special && team[active].rage >= 100 ? SPECIAL : habit;
}

// The rules of levels and XP, worked out again here from crates/core/src/rules.rs, so the
// script checks the contract's sums against its own.

/** XP a beast at `level` needs to reach the next one. */
function xpForLevel(level) {
  let need = 100;
  for (let i = 1; i < level; i += 1) need = Math.floor((need * 110) / 100);
  return need;
}

/** What it costs in NEAR to buy a beast at `level` its next level. */
function levelCostNear(level) {
  let cost = CENT;
  for (let i = 1; i < level; i += 1) cost = (cost * 110n) / 100n;
  return cost;
}

/** A beast's [level, XP] after it earns `gained` more XP. */
function addXp(level, xp, gained) {
  let left = xp + gained;
  for (; left >= xpForLevel(level); level += 1) left -= xpForLevel(level);
  return [level, left];
}

/** XP for a fight against a den, and for a duel. */
const denXp = (tier, won, staked) => Math.floor(((won ? 40 + 15 * tier : 15) * (staked ? 3 : 2)) / 2);
const duelXp = (won) => (won ? 120 : 40);
/** What one beast of the squad gets: all of it if it went into the pit, half if not, and 15 a kill. */
const beastXp = (fightXp, entered, kills) => (entered ? fightXp : Math.floor(fightXp / 2)) + 15 * kills;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const equal = (actual, expected, what) =>
  check(actual === expected, `${what}: expected ${typeof expected === 'bigint' ? near(expected) : expected}, got ${typeof actual === 'bigint' ? near(actual) : actual}`);

const player = (accountId) => view('get_player', { account_id: accountId });
const balance = async (accountId) => BigInt((await player(accountId)).balance);

/** Everything the run can change, read in one go. */
async function snapshot() {
  const [ledger, dens, stats, a, b, walletA, walletB, walletContract] = await Promise.all([
    view('get_ledger'), view('get_dens'), view('get_stats'), player(A), player(B), wallet(A), wallet(B), wallet(CONTRACT),
  ]);
  const big = (value) => BigInt(value);
  return {
    wallets: { [A]: walletA, [B]: walletB, [CONTRACT]: walletContract },
    balances: { [A]: big(a.balance), [B]: big(b.balance) },
    bankrolls: dens.map((den) => ({ name: den.name, bankroll: big(den.bankroll) })),
    treasury: big(stats.treasury),
    ledger: Object.fromEntries(Object.entries(ledger).map(([key, value]) => [key, big(value)])),
  };
}

const held = (ledger) => ledger.balances + ledger.bankrolls + ledger.escrow + ledger.treasury;

// ----- The steps -----------------------------------------------------------------

const results = [];

/** Runs one step and prints PASS or FAIL. A step returns a short note for its PASS line. */
async function step(name, run) {
  const started = Date.now();
  try {
    const note = await run();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${note ? `  (${note})` : ''}  [${((Date.now() - started) / 1000).toFixed(0)}s]`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').join('\n      ')}`);
    throw error;
  }
}

/** Gives up whatever an earlier run left unfinished, so this one starts clean. */
async function clearTheDecks(accountId) {
  const state = await player(accountId);
  if (!state.registered) return 'not joined yet';
  const done = [];
  for (const [pointer, forfeit] of [['den_match', 'forfeit_den'], ['duel', 'forfeit_duel']]) {
    const fight = state[pointer] === null ? null : await view('get_match', { match_id: state[pointer] });
    if (fight && !fight.over) {
      await call(accountId, forfeit);
      done.push(forfeit);
    }
  }
  if (state.challenge !== null) {
    await call(accountId, 'cancel_challenge');
    done.push('cancel_challenge');
  }
  return done.join(', ') || 'nothing to clear';
}

/** Plays the signer's den fight to its end, striking. Returns the finished fight and the calls it took. */
async function playDenFight(signer, fight) {
  let calls = 0;
  let stumbles = 0;
  while (!fight.over) {
    const turn = fight.battle.turn;
    try {
      fight = await call(signer, 'den_act', { action: legalAction(fight, 0, STRIKE) });
      calls += 1;
      check(fight.battle.turn > turn, 'den_act did not move the fight on');
      check(fight.over || fight.need[0], 'the den left the player waiting on it');
      const played = fight.steps.slice(-(fight.battle.turn - turn)).flatMap((entry) => entry.events);
      check(JSON.stringify(played) === JSON.stringify(fight.last_events), 'steps and last_events disagree');
    } catch (error) {
      // A call that did not get through may still have landed: read the fight and carry on.
      if (error instanceof Refused || (stumbles += 1) > 5) throw error;
      await sleep(3_000);
      fight = await view('get_match', { match_id: fight.id });
    }
  }
  return { fight, calls };
}

/**
 * Plays a duel to its end. Every step both sides seal their moves, then both open them.
 * The loop works from what the contract says is sealed and open, so it can pick up after
 * a call that failed half way. Neither side spends its Rage on a Special, so a side that
 * only Strikes always beats one that only Breaks: the Break never lands.
 */
async function playDuel(matchId, habits) {
  const sealedMoves = [null, null];
  let turn = -1;
  let stumbles = 0;
  for (let rounds = 0; rounds < 400; rounds += 1) {
    const duel = await view('get_match', { match_id: matchId });
    if (duel.over) return duel;
    if (duel.battle.turn !== turn) {
      turn = duel.battle.turn;
      sealedMoves.fill(null);
    }
    const acting = [0, 1].filter((side) => duel.need[side] && !duel.open[side]);
    const unsealed = acting.filter((side) => !duel.sealed[side]);
    const jobs = unsealed.length
      ? unsealed.map((side) => {
          sealedMoves[side] = { action: legalAction(duel, side, habits[side], false), salt: randomBytes(8).toString('hex') };
          return call([A, B][side], 'duel_commit', { hash: seal(sealedMoves[side].action, sealedMoves[side].salt) });
        })
      : acting.map((side) => {
          check(sealedMoves[side], `side ${side} has a sealed move this script did not make`);
          return call([A, B][side], 'duel_reveal', sealedMoves[side]);
        });
    for (const outcome of await Promise.allSettled(jobs)) {
      if (outcome.status === 'fulfilled') continue;
      if (outcome.reason instanceof Refused || (stumbles += 1) > 5) throw outcome.reason;
      await sleep(3_000);
    }
  }
  throw new Error('the duel did not end');
}

async function main() {
  console.log(`Maul Street end to end on testnet\ncontract ${CONTRACT}, players ${A} and ${B}\n`);
  const startedAt = Date.now();
  let before;
  let paidIn = 0n;
  let paidOut = 0n;
  let squadA;
  let squadB;
  let hired;
  /** A's first beast: it leads every squad A fields. */
  let lead;
  /** Every beast as it stood before the fights, and the XP the fights then gave it. */
  const stable = new Map();
  const learned = new Map();

  /** Checks the XP a finished fight gave one squad against the rules, and counts it towards `learned`. */
  const learn = (fight, side, fightXp) => {
    fight.battle.teams[side].forEach((fighter, slot) => {
      equal(fight.xp[side][slot], beastXp(fightXp, fighter.entered, fighter.kills), `XP for beast ${fighter.token}`);
      learned.set(fighter.token, (learned.get(fighter.token) ?? 0) + fight.xp[side][slot]);
    });
  };

  await step('the contract answers and its books balance', async () => {
    before = await snapshot();
    equal(held(before.ledger), before.ledger.deposited - before.ledger.withdrawn, 'NEAR held against NEAR paid in');
    return `${near(held(before.ledger))} NEAR held`;
  });

  await step('unfinished business from earlier runs is cleared', async () => {
    const notes = await Promise.all([A, B].map(clearTheDecks));
    return notes.join(' / ');
  });

  await step('both players are registered', async () => {
    const picks = { [A]: [0, 1, 2], [B]: [2, 3, 4] };
    const notes = await Promise.all(
      [A, B].map(async (who) => {
        if ((await player(who)).registered) return 'already joined';
        const joined = await call(who, 'register', { picks: picks[who] });
        check(joined.registered && joined.beasts.length === 3 && joined.essence === 100, 'register returned a bad player');
        check(joined.beasts.map((beast) => beast.species).join() === picks[who].join(), 'the starters are not the ones picked');
        return 'joined';
      }),
    );
    const [a, b] = await Promise.all([player(A), player(B)]);
    squadA = a.beasts.slice(0, 3).map((beast) => beast.id);
    squadB = b.beasts.slice(0, 3).map((beast) => beast.id);
    let refused = false;
    await call(A, 'register', { picks: [0, 1, 2] }).catch((error) => (refused = error instanceof Refused));
    check(refused, 'a second register was not refused');
    return notes.join(' / ');
  });

  await step('each player deposits 2 NEAR', async () => {
    const start = await Promise.all([balance(A), balance(B)]);
    const returned = await Promise.all([A, B].map((who) => call(who, 'deposit', {}, '2 NEAR')));
    paidIn += 4n * NEAR;
    const now = await Promise.all([balance(A), balance(B)]);
    [0, 1].forEach((i) => {
      equal(now[i], start[i] + 2n * NEAR, 'balance after the deposit');
      equal(BigInt(returned[i]), now[i], 'the balance deposit returned');
    });
    return `balances ${near(now[0])} and ${near(now[1])} NEAR`;
  });

  await step('a beast is bought a level with Essence, and one with NEAR', async () => {
    lead = squadA[0];
    const notes = [];
    // Essence stands in for the XP a beast still lacks, so the beast that lacks least gets it.
    const mine = (await player(A)).beasts;
    const pupil = mine.reduce((best, beast) => (beast.xp_next - beast.xp < best.xp_next - best.xp ? beast : best));
    equal(pupil.xp_next, xpForLevel(pupil.level), 'the XP the next level takes');
    const [essence, missing] = [(await player(A)).essence, pupil.xp_next - pupil.xp];
    if (essence >= missing) {
      const taught = await call(A, 'level_up', { beast_id: pupil.id, with_essence: true });
      equal(taught.level, pupil.level + 1, 'level after buying one with Essence');
      equal(taught.xp, 0, 'XP after buying a level with Essence');
      equal((await player(A)).essence, essence - missing, 'Essence after buying a level');
      notes.push(`${pupil.name} to level ${taught.level} for ${missing} Essence`);
    } else {
      // Not enough Essence for it this time: the contract has to say so.
      const refusal = await call(A, 'level_up', { beast_id: pupil.id, with_essence: true }).then(
        () => '',
        (error) => (error instanceof Refused ? error.message : ''),
      );
      check(refusal.includes("You don't have enough Essence"), 'a level was sold for Essence the player does not have');
      notes.push(`a level for ${missing} Essence refused with ${essence} in hand`);
    }
    // NEAR buys a level at the rules' price, and the beast keeps the XP it has.
    const [start, was] = [await balance(A), await view('get_beast', { beast_id: lead })];
    const bought = await call(A, 'level_up', { beast_id: lead, with_essence: false });
    const cost = levelCostNear(was.level);
    equal(bought.level, was.level + 1, 'level after buying one with NEAR');
    equal(bought.xp, was.xp, 'XP after buying a level with NEAR');
    equal(await balance(A), start - cost, 'balance after buying a level');
    check(bought.power > was.power && bought.stats.every((stat, i) => stat >= was.stats[i]), 'the level did not make the beast stronger');
    notes.push(`${bought.name} to level ${bought.level} for ${near(cost)} NEAR`);
    return notes.join('; ');
  });

  await step('an item is bought and equipped', async () => {
    const item = 20; // Ember Haze, an aura: the cheapest thing in the bazaar.
    const count = async () => (await player(A)).items.find(([id]) => id === item)?.[1] ?? 0;
    const [start, had, wearing] = [await balance(A), await count(), (await view('get_beast', { beast_id: squadA[0] })).aura];
    const shelf = (await view('get_market')).items.find((entry) => entry.id === item);
    // Offer a little over the price shown, in case someone else buys one first.
    const most = (BigInt(shelf.price) * 110n) / 100n;
    const paid = BigInt(await call(A, 'buy_item', { item_id: item, max_price: String(most) }));
    check(paid >= BigInt(shelf.floor) && paid <= most, `paid ${near(paid)} NEAR, outside the floor and the most offered`);
    equal(await balance(A), start - paid, 'balance after buying');
    equal(await count(), had + 1, 'items in the inventory after buying');
    const worn = await call(A, 'equip', { beast_id: squadA[0], item_id: item });
    equal(worn.aura, item, 'the aura slot');
    // The new one is on the beast. If the beast already wore one, that one came back.
    equal(await count(), had + (wearing === item ? 1 : 0), 'items in the inventory after equipping');
    return `paid ${near(paid)} NEAR`;
  });

  await step('a beast is listed for hire and hired by the other player', async () => {
    const price = CENT;
    hired = squadA[0];
    await call(A, 'list_for_hire', { beast_id: hired, price: String(price) });
    const listed = (await view('get_hire_market', { from_index: 0, limit: 100 })).find((beast) => beast.id === hired);
    check(listed && BigInt(listed.hire_price) === price, 'the beast is not on the hire market at its price');
    const [startA, startB] = await Promise.all([balance(A), balance(B)]);
    const leftBefore = (await player(B)).hires.find((hire) => hire.beast.id === hired)?.fights_left ?? 0;
    const hirer = await call(B, 'hire', { beast_id: hired, fights: 1 });
    equal(hirer.hires.find((hire) => hire.beast.id === hired)?.fights_left, leftBefore + 1, 'paid fights with the hired beast');
    equal(await balance(B), startB - price, 'the hirer pays the price');
    equal(await balance(A), startA + (price * 95n) / 100n, 'the owner gets 95%');
    // The offer comes down again. The fight B paid for stays good.
    await call(A, 'unlist', { beast_id: hired });
    equal((await view('get_beast', { beast_id: hired })).hire_price, null, 'the hire price after unlisting');
    return `1 fight for ${near(price)} NEAR, ${near((price * 95n) / 100n)} to the owner`;
  });

  await step('a free den fight and a staked one are played to the end', async () => {
    const stake = 5n * CENT;
    const dens = await view('get_dens');
    const den = dens.find((entry) => entry.open && BigInt(entry.max_stake) >= stake);
    check(den, 'no den takes a 0.05 NEAR stake right now');
    const [startA, startB] = await Promise.all([player(A), player(B)]);
    // Where every beast stands before the fights, to check afterwards what they taught it.
    for (const beast of [...startA.beasts, ...startB.beasts]) stable.set(beast.id, beast);

    // B spars for free with the beast hired from A. A stakes 0.05 NEAR. Both fights run side by side.
    const freeSquad = [hired, squadB[0], squadB[1]];
    const [free, staked] = await Promise.all([
      call(B, 'start_den_fight', { den_id: 1, squad: freeSquad, stake: '0' }).then((fight) => playDenFight(B, fight)),
      call(A, 'start_den_fight', { den_id: den.id, squad: squadA, stake: String(stake) }).then((fight) => playDenFight(A, fight)),
    ]);
    const [endA, endB] = await Promise.all([player(A), player(B)]);

    equal(free.fight.kind, 'den', 'kind');
    equal(BigInt(endB.balance), BigInt(startB.balance), 'a free spar moves no NEAR');
    equal(endB.essence, startB.essence + free.fight.essence[0], 'Essence from the free spar');
    check(free.fight.battle.teams[0][0].token === hired, 'the hired beast did not fight');
    const paidFights = (list) => list.hires.find((hire) => hire.beast.id === hired)?.fights_left ?? 0;
    equal(paidFights(endB), paidFights(startB) - 1, 'the hired fight is used up');

    // A win pays the stake times the payout that was fixed when the fight started.
    const won = staked.fight.winner === 0;
    check(staked.fight.payout_bps >= 15_000 && staked.fight.payout_bps <= 20_000, 'the payout is outside 1.5x to 2x');
    const payout = (stake * BigInt(staked.fight.payout_bps)) / 10_000n;
    equal(BigInt(endA.balance), BigInt(startA.balance) - stake + (won ? payout : 0n), 'balance after the staked fight');
    equal(BigInt(staked.fight.payout), won ? payout : stake - stake / 10n, 'the payout recorded on the fight');
    equal(endA.essence, startA.essence + staked.fight.essence[0], 'Essence from the staked fight');
    equal(endA.den_wins + endA.den_losses, startA.den_wins + startA.den_losses + 1, 'den fights on record');

    // Both squads learn from their fights. The hired beast's XP is the beast's own.
    learn(free.fight, 0, denXp(dens[1].tier, free.fight.winner === 0, false));
    learn(staked.fight, 0, denXp(den.tier, won, true));
    equal(`${free.fight.xp[1]} ${staked.fight.xp[1]}`, '0,0,0 0,0,0', "XP for the dens' beasts");
    const outcome = (label, { fight, calls }) =>
      `${label}: ${fight.winner === 0 ? 'won' : 'lost'} in ${fight.battle.turn} steps and ${calls} calls, +${fight.essence[0]} Essence`;
    return `${outcome('free', free)}; ${outcome(`staked at ${den.name}`, staked)}, ${won ? `paid ${near(payout)}` : `lost ${near(stake)}`} NEAR`;
  });

  await step('a den is backed and cashed out', async () => {
    const [den, amount] = [4, NEAR / 2n];
    const fightsSoFar = async () => {
      const book = (await view('get_dens'))[den];
      return book.total_wins + book.total_losses;
    };
    const [start, fights] = [await balance(B), await fightsSoFar()];
    const shares = BigInt(await call(B, 'back_den', { den_id: den, amount: String(amount) }));
    check(shares > 0n, 'no shares were minted');
    const position = (await player(B)).backing.find((entry) => entry.den === den);
    check(position && BigInt(position.shares) >= shares, 'the shares are not in the backing list');
    equal(await balance(B), start - amount, 'balance after backing');
    const paid = BigInt(await call(B, 'unback_den', { den_id: den, shares: String(shares) }));
    equal(await balance(B), start - amount + paid, 'balance after cashing out');
    // Cashing out straight away gives the money back, less rounding, unless someone fought the den in between.
    const quiet = (await fightsSoFar()) === fights;
    check(!quiet || (paid <= amount && amount - paid < 1_000n), `cashing out straight away paid ${near(paid)} for ${near(amount)}`);
    return `${near(amount)} NEAR in, ${shares} shares, ${near(paid)} NEAR out${quiet ? '' : ' (the den fought in between)'}`;
  });

  let duelId;
  await step('a 0.1 NEAR challenge is posted and accepted', async () => {
    const stake = 10n * CENT;
    const [startA, startB] = await Promise.all([balance(A), balance(B)]);
    const challenge = await call(A, 'create_challenge', { squad: squadA, stake: String(stake), level_cap: 0, invite: B });
    equal(BigInt(challenge.stake), stake, 'the stake on the challenge');
    const open = await view('get_challenges', { from_index: 0, limit: 100 });
    check(open.some((entry) => entry.id === challenge.id && entry.creator === A), 'the challenge is not listed');
    const duel = await call(B, 'accept_challenge', { id: challenge.id, squad: squadB });
    duelId = duel.id;
    equal(duel.kind, 'duel', 'kind');
    equal(duel.players.join(), [A, B].join(), 'the duellists');
    check(duel.deadline > Date.now() / 1000 && duel.need.every(Boolean), 'the duel did not start on the opening clock');
    equal(await balance(A), startA - stake, 'the challenger put up the stake');
    equal(await balance(B), startB - stake, 'the acceptor put up the stake');
    return `challenge ${challenge.id}, duel ${duel.id}`;
  });

  await step('the duel is played with sealed moves until someone wins', async () => {
    const stake = 10n * CENT;
    const [startA, startB] = await Promise.all([player(A), player(B)]);
    const duel = await playDuel(duelId, [STRIKE, BREAK]);
    check(duel.over && !duel.void && (duel.winner === 0 || duel.winner === 1), 'the duel ended without a winner');
    const payout = (2n * stake * 97n) / 100n;
    equal(BigInt(duel.payout), payout, 'the pot less the 3% rake');
    const [endA, endB] = await Promise.all([player(A), player(B)]);
    const [winner, loser] = duel.winner === 0 ? [[startA, endA], [startB, endB]] : [[startB, endB], [startA, endA]];
    equal(BigInt(winner[1].balance), BigInt(winner[0].balance) + payout, "the winner's balance");
    equal(BigInt(loser[1].balance), BigInt(loser[0].balance), "the loser's balance");
    check(winner[1].rating > winner[0].rating && loser[1].rating < loser[0].rating, 'the ratings did not move');
    equal(winner[1].wins, winner[0].wins + 1, "the winner's wins");
    equal(loser[1].losses, loser[0].losses + 1, "the loser's losses");
    equal(winner[1].essence, winner[0].essence + 40, "the winner's Essence");
    equal(loser[1].essence, loser[0].essence + 10, "the loser's Essence");

    // Strike interrupts every Break, so the challenger's lead beast wins the duel untouched.
    equal(duel.winner, 0, 'the side that won');
    learn(duel, 0, duelXp(true));
    learn(duel, 1, duelXp(false));
    equal(duel.xp[0].join(), '165,60,60', "XP for the winner's lead beast and the two that watched");
    const levelsOf = (owner, squad) => squad.map((id) => owner.beasts.find((beast) => beast.id === id).level).join();
    equal(duel.levels[0].join(), levelsOf(endA, squadA), "the levels the duel reports for the challenger's beasts");
    equal(duel.levels[1].join(), levelsOf(endB, squadB), "the levels the duel reports for the acceptor's beasts");
    return `${duel.players[duel.winner]} won ${near(payout)} NEAR in ${duel.battle.turn} steps`;
  });

  await step('every beast kept what the fights taught it', async () => {
    const now = new Map([...(await player(A)).beasts, ...(await player(B)).beasts].map((beast) => [beast.id, beast]));
    const rose = [];
    for (const [id, gained] of learned) {
      const [was, is] = [stable.get(id), now.get(id)];
      const [level, xp] = addXp(was.level, was.xp, gained);
      equal(is.level, level, `the level of beast ${id} after ${gained} XP`);
      equal(is.xp, xp, `the XP of beast ${id}`);
      if (is.level > was.level) rose.push(`${is.name} ${was.level} to ${is.level}`);
    }
    // The duel alone is worth 165 XP to the lead beast: a level, for any beast below level 7.
    check(rose.length > 0 || stable.get(lead).level >= 7, 'the fights did not raise a single level');
    return rose.length ? `levels gained from XP: ${rose.join(', ')}` : 'no beast was within reach of a level';
  });

  await step(KEEP ? 'balances stay in the contract (MAUL_KEEP=1)' : 'both players withdraw what they have left', async () => {
    if (KEEP) return '';
    const amounts = await Promise.all([balance(A), balance(B)]);
    const wallets = await Promise.all([wallet(A), wallet(B)]);
    await Promise.all([A, B].map((who, i) => (amounts[i] > 0n ? call(who, 'withdraw', { amount: String(amounts[i]) }) : null)));
    paidOut += amounts[0] + amounts[1];
    for (const [i, who] of [A, B].entries()) {
      equal(await balance(who), 0n, 'balance after withdrawing everything');
      const gain = (await wallet(who)) - wallets[i];
      check(gain <= amounts[i] && amounts[i] - gain < NEAR / 100n, `the wallet got ${near(gain)} of ${near(amounts[i])} NEAR`);
    }
    return `${near(amounts[0])} and ${near(amounts[1])} NEAR back to the wallets`;
  });

  const after = await snapshot();
  await step('no NEAR was made or lost', async () => {
    // The contract's books balance now, as they did before...
    equal(held(after.ledger), after.ledger.deposited - after.ledger.withdrawn, 'NEAR held against NEAR paid in');
    // ...so everything it holds moved by exactly what went in and out during the run.
    const [inflow, outflow] = [after.ledger.deposited - before.ledger.deposited, after.ledger.withdrawn - before.ledger.withdrawn];
    equal(held(after.ledger) - held(before.ledger), inflow - outflow, 'change in NEAR held');
    check(inflow >= paidIn && outflow >= paidOut, 'the contract counted less than this run paid in or took out');
    // And the contract's own account moved by the same amount on chain. (It may also earn a share of gas fees.)
    const extra = after.wallets[CONTRACT] - before.wallets[CONTRACT] - (inflow - outflow);
    check(extra >= 0n && extra < NEAR / 5n, `the contract account is off by ${near(extra)} NEAR`);
    const others = inflow === paidIn && outflow === paidOut ? '' : ', other accounts were active too';
    return `${near(inflow)} in, ${near(outflow)} out, and the contract account moved by ${extra === 0n ? 'exactly that' : `that plus ${extra} yoctoNEAR`}${others}`;
  });

  // ----- The report ---------------------------------------------------------------

  const rows = [
    ...[A, B, CONTRACT].map((who) => [`wallet   ${who}`, before.wallets[who], after.wallets[who]]),
    ...[A, B].map((who) => [`in game  ${who}`, before.balances[who], after.balances[who]]),
    ...before.bankrolls.map((den, i) => [`bankroll ${den.name}`, den.bankroll, after.bankrolls[i].bankroll]),
    ['treasury', before.treasury, after.treasury],
    ['escrow', before.ledger.escrow, after.ledger.escrow],
    ['all the contract holds', held(before.ledger), held(after.ledger)],
    ['paid in less paid out', before.ledger.deposited - before.ledger.withdrawn, after.ledger.deposited - after.ledger.withdrawn],
  ];
  console.log(`\nBalances in NEAR${' '.repeat(22)}before${' '.repeat(10)}after${' '.repeat(9)}change`);
  for (const [label, was, is] of rows) {
    const change = is - was;
    console.log(`  ${label.padEnd(34)}${near(was).padStart(13)}${near(is).padStart(15)}${((change > 0n ? '+' : '') + near(change)).padStart(15)}`);
  }

  const tgas = (gas) => (Number(gas / 10n ** 9n) / 1000).toFixed(2);
  console.log(`\nGas burnt, in Tgas. "call" is the function call itself, which has to fit in the ${PREPAID_GAS} attached.`);
  console.log('"all" is the dearest call of each method once final, with sending the transaction and refunding unused gas.');
  for (const [method, calls] of [...gasLog].sort()) {
    const each = calls.map((entry) => entry.call).sort((a, b) => (a < b ? -1 : 1));
    const average = each.reduce((sum, gas) => sum + gas, 0n) / BigInt(each.length);
    const dearest = calls.reduce((most, entry) => (entry.call > most.call ? entry : most));
    const all = await finalGas(dearest).then(tgas, () => 'n/a');
    console.log(
      `  ${method.padEnd(18)}calls ${String(each.length).padStart(3)}   call: least ${tgas(each[0]).padStart(5)}  average ${tgas(average).padStart(5)}  most ${tgas(each.at(-1)).padStart(5)}   all: ${all.padStart(5)}`,
    );
  }
  const sent = [...gasLog.values()].reduce((count, calls) => count + calls.length, 0);
  console.log(`\n${sent} transactions in ${((Date.now() - startedAt) / 60_000).toFixed(1)} minutes`);
}

main().then(
  () => {
    console.log(`\nE2E PASS: ${results.length} of ${results.length} steps`);
  },
  (error) => {
    if (!results.some((result) => !result.ok)) console.log(`FAIL  ${error.stack ?? error}`);
    console.log(`\nE2E FAIL: ${results.filter((result) => result.ok).length} steps passed before the failure`);
    process.exitCode = 1;
  },
);
