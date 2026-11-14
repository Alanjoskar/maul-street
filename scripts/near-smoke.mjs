// Smoke test for the NEAR plumbing in web/src/near, against live NEAR testnet.
//
//   node scripts/near-smoke.mjs              everything below except the duel (about five minutes)
//   node scripts/near-smoke.mjs duel         the same, then a friendly duel between the two test accounts
//                                            (about six minutes more: every turn is four transactions)
//   node scripts/near-smoke.mjs duel quick   the duel alone, without the slow parts before it
//
// What it proves:
//   1. the modules load in Node and the small helpers are right;
//   2. JSON-RPC rotation: a dead node is skipped, for reads and for sends;
//   3. the Signer builds and signs valid transactions: NEAR Social writes (profile, post, follow)
//      go out with a function-call key and are read back from the FastData KV API;
//   4. nonces: five writes sent back to back all land, and a key that has fallen behind recovers;
//   5. the api facade and its NEAR Social state;
//   6. the game contract: register, a refusal as the contract's own sentence, a free den fight
//      played to the end through api.startDenFight / api.denAct (and the XP its beasts earn),
//      api.levelUp with NEAR and with Essence, and the stable, bazaar, den-backing, hiring,
//      challenge and money calls, with the "money arrived" toast;
//   7. (duel) a whole duel through api.duelMove: sealing, opening, playing openly, the 'duel'
//      event, api.watchDuel, and a sealed move opened by a fresh copy of the game after a "reload".
//
// It uses two throwaway testnet accounts made for this (maul-smoke-…). Their full-access keys stay
// in ~/.near-credentials/testnet and are only used by near-cli: to add function-call keys, and for
// one deposit. The function-call keys are kept in ~/.near-credentials/maul-smoke/. No key is
// printed, and none is written into the project. To make the accounts on another machine:
//   near account create-account sponsor-by-faucet-service NAME.testnet autogenerate-new-keypair \
//     --signature-scheme ed25519 save-to-legacy-keychain network-config testnet create
// then set MAUL_SMOKE_A and MAUL_SMOKE_B to their names.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

import { api } from '../web/src/near/api.js'
import * as chain from '../web/src/near/chain.js'
import { CONFIG } from '../web/src/near/config.js'
import { near, shortAccount, timeAgo, toYocto } from '../web/src/near/format.js'
import * as social from '../web/src/near/social.js'
import { store, useStorage } from '../web/src/near/storage.js'
import * as wallet from '../web/src/near/wallet.js'

const A = process.env.MAUL_SMOKE_A || 'maul-smoke-a-5cc35f.testnet'
const B = process.env.MAUL_SMOKE_B || 'maul-smoke-b-5cc35f.testnet'
const KEYCHAIN = path.join(os.homedir(), '.near-credentials')
const SMOKE_KEYS = path.join(KEYCHAIN, 'maul-smoke')
const DEFAULT_CLI = path.join(os.homedir(), 'AppData/Local/Programs/near-dev/near-cli/near-cli-rs-x86_64-pc-windows-msvc/near.exe')
const NEAR_CLI = process.env.NEAR_CLI || (fs.existsSync(DEFAULT_CLI) ? DEFAULT_CLI : 'near')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const tgas = (gas) => `${(Number(gas) / 1e12).toFixed(2)} Tgas`
const cost = (yocto) => `${near(yocto, 6)} NEAR`
const big = (yocto) => BigInt(yocto)
const MOVES = { 0: 'Strike', 1: 'Guard', 2: 'Break', 3: 'Special', 10: 'send in slot 0', 11: 'send in slot 1', 12: 'send in slot 2' }

function check(condition, message) {
  if (!condition) throw new Error(message)
}

// ----- near-cli and keys ------------------------------------------------------------------------------

/** Never let a secret reach the terminal, even inside another tool's error text. */
const scrub = (text) => String(text).replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/g, 'ed25519:<secret>')

function smokeAccount(account) {
  check(/^maul-smoke-[a-z0-9-]+\.testnet$/.test(account), `${account} is not a smoke-test account. This script only touches maul-smoke-… accounts.`)
  check(fs.existsSync(path.join(KEYCHAIN, 'testnet', `${account}.json`)), `No credentials for ${account} in ~/.near-credentials/testnet. See the top of this file.`)
  return account
}

/** Runs near-cli, signing as a smoke account with its own key from the legacy keychain. */
function cli(args, account) {
  try {
    return execFileSync(NEAR_CLI, [...args, 'network-config', 'testnet', 'sign-with-legacy-keychain', 'send'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error(`near-cli failed for ${account}: ${scrub(`${error.stdout || ''}${error.stderr || ''}${error.message || ''}`).slice(-400)}`)
  }
}

/** A function-call key for `account` on `receiver`, made once and kept outside the project. */
async function functionCallKey(account, receiver, methods, allowance) {
  const file = path.join(SMOKE_KEYS, `${account}.${receiver}.json`)
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    const key = await chain.accessKey(account, saved.public_key)
    if (chain.keyAllows(key, receiver, methods[0] ?? null)) return saved.private_key
  }
  smokeAccount(account)
  const pair = chain.generateKey()
  cli(
    ['account', 'add-key', account, 'grant-function-call-access', '--allowance', allowance, '--contract-account-id', receiver, '--function-names', methods.join(','), 'use-manually-provided-public-key', pair.publicKey],
    account,
  )
  let added = false
  for (let i = 0; i < 30 && !added; i++) {
    added = await chain.hasKey(account, pair.publicKey).catch(() => false)
    if (!added) await sleep(700)
  }
  check(added, `The new key did not appear on ${account}.`)
  fs.mkdirSync(SMOKE_KEYS, { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ account_id: account, public_key: pair.publicKey, private_key: pair.secretKey, receiver, methods }, null, 2))
  return pair.secretKey
}

const socialKey = (account) => functionCallKey(account, CONFIG.socialReceiver, ['__fastdata_kv'], '0.25 NEAR')
const gameKey = (account) => functionCallKey(account, CONFIG.contract, [], '1 NEAR')

/** Storage kept in a file, so that a second copy of the game can find what the first one saved: a "reload". */
function fileStorage(file) {
  let data = {}
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    data = {}
  }
  const save = () => fs.writeFileSync(file, JSON.stringify(data))
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value)
      save()
    },
    removeItem: (key) => {
      delete data[key]
      save()
    },
  }
}

// ----- Playing a fight ------------------------------------------------------------------------------------

function legalActions(match, side) {
  const battle = match.battle
  if (match.over || !match.need[side]) return []
  if (battle.active[side] === 255) {
    return battle.teams[side].map((fighter, slot) => (fighter.hp > 0 ? 10 + slot : -1)).filter((action) => action >= 0)
  }
  const moves = [0, 1, 2]
  if (battle.teams[side][battle.active[side]].rage >= 100) moves.push(3)
  return moves
}

function chooseAction(match, side) {
  const actions = legalActions(match, side)
  check(actions.length > 0, 'There is no legal action, yet the fight is not over.')
  if (actions.includes(3)) return 3
  return actions[Math.floor(Math.random() * actions.length)]
}

function standing(match) {
  const line = (side) => {
    const battle = match.battle
    const alive = battle.teams[side].filter((fighter) => fighter.hp > 0).length
    const active = battle.active[side] === 255 ? 'nobody in' : `${battle.teams[side][battle.active[side]].hp} hp`
    return `${alive} left, ${active}`
  }
  return `${line(0)} | ${line(1)}`
}

const squadOf = (player) => player.beasts.slice(0, 3).map((beast) => beast.id)

// ----- Where the requests went ------------------------------------------------------------------------------

/** Counts every request chain.js makes, by node and by how it ended. */
function countTraffic() {
  const traffic = {} // host → { 'ok': n, 'rate limit': n, … }
  chain.watchRpc(({ url, problem }) => {
    const host = new URL(url).host
    const kind = problem === null ? 'ok' : /^no answer/.test(problem) ? 'no answer' : problem
    traffic[host] = traffic[host] || {}
    traffic[host][kind] = (traffic[host][kind] || 0) + 1
  })
  return traffic
}

function addTraffic(into, from) {
  for (const [host, kinds] of Object.entries(from || {})) {
    into[host] = into[host] || {}
    for (const [kind, count] of Object.entries(kinds)) into[host][kind] = (into[host][kind] || 0) + count
  }
}

/**
 * The player's duel if one is on. `player.duel` alone does not say: the contract leaves the
 * id of a finished duel there until the next one starts.
 */
async function duelInProgress() {
  const id = api.state.player && api.state.player.duel
  if (id == null) return null
  const match = await api.getMatch(id)
  return match && !match.over ? match : null
}

// ----- The opponent in a duel: this same file, run in a worker so that it has its own copy of the api -------

async function duelOpponent() {
  const say = (text) => parentPort.postMessage({ say: text })
  const traffic = countTraffic()
  try {
    useStorage(fileStorage(workerData.storeFile))
    await api._useSession({ accountId: B, secretKey: workerData.secretKey })
    if (!api.state.player.registered) {
      await api.register([2, 3, 4])
      say('B registered')
    }
    let match = await duelInProgress()
    if (!match) {
      let challenge = null
      for (let i = 0; i < 120 && !challenge; i++) {
        await api.refresh('challenges')
        challenge = api.state.challenges.find((entry) => entry.creator === A && (!entry.invite || entry.invite === B)) || null
        if (!challenge) await sleep(1_000)
      }
      check(challenge, 'B never saw the challenge.')
      match = await api.acceptChallenge(challenge.id, squadOf(api.state.player))
      say(`B accepted challenge ${challenge.id}: duel ${match.id}`)
    } else {
      say(`B is back in duel ${match.id} at turn ${match.battle.turn}${match.sealed[match.players.indexOf(B)] ? ', with a sealed move waiting' : ''}`)
    }
    parentPort.postMessage({ ready: true })
    const id = match.id
    const side = match.players.indexOf(B)
    // From here B asks the chain nothing of its own: like the game, it follows the 'duel' event.
    let latest = match
    api.on('duel', (now) => {
      if (now.id === id) latest = now
    })
    let moves = 0
    const retried = []
    while (!latest.over) {
      const now = latest
      // A move of ours that is sealed is left alone: the facade opens it by itself when it may.
      if (now.need[side] && !now.sealed[side] && !now.open[side]) {
        try {
          const after = await api.duelMove(chooseAction(now, side))
          if (after.over) latest = after
          moves++
        } catch (error) {
          // What a player does when a move does not go through: try again.
          retried.push(error.message)
          check(retried.length <= 10, `ten moves in a row failed: ${error.message}`)
          await sleep(1_500)
        }
      } else {
        await sleep(250)
      }
    }
    parentPort.postMessage({ done: true, moves, retried, calls: api._calls.slice(), traffic })
  } catch (error) {
    parentPort.postMessage({ error: error.message, traffic })
  } finally {
    api._stop()
  }
}

if (!isMainThread) {
  await duelOpponent()
} else {
  await main()
}

// ----- The test -------------------------------------------------------------------------------------------

async function main() {
  const wantDuel = process.argv.includes('duel')
  // `quick` leaves out the slow parts (the NEAR Social writes, the den fight, the stable and the money):
  // with `duel` it gets to the duel in under a minute.
  const quick = process.argv.includes('quick')
  const results = []
  const costs = [] // { what, gasBurnt, tokensBurnt }
  const traffic = countTraffic()

  const section = (title) => console.log(`\n${title}`)
  async function step(name, run) {
    const started = Date.now()
    try {
      const note = await run()
      results.push({ name, ok: true })
      console.log(`  ok    ${name}${note ? ` — ${note}` : ''} (${Date.now() - started} ms)`)
      return true
    } catch (error) {
      results.push({ name, ok: false })
      console.log(`  FAIL  ${name} — ${scrub(error.message)}`)
      return false
    }
  }
  /** A step that `quick` leaves out. */
  const slow = (name, run) => (quick ? true : step(name, run))
  const spent = (what, result) => {
    costs.push({ what, gasBurnt: result.gasBurnt, tokensBurnt: result.tokensBurnt })
    return `${tgas(result.gasBurnt)}, ${cost(result.tokensBurnt)}`
  }
  /** What the last call on the game contract cost, noted under its method name. */
  const lastCall = () => spent(api._calls.at(-1).method, api._calls.at(-1))
  const kvLatest = async (account, key) => {
    const response = await fetch(`${CONFIG.kv}/v0/latest/${CONFIG.socialReceiver}/${account}/${key}`)
    check(response.ok, `The KV API answered ${response.status}.`)
    return (await response.json()).entries[0] ?? null
  }

  console.log(`Maul Street NEAR smoke test — ${CONFIG.network}, contract ${CONFIG.contract}`)
  console.log(`accounts: ${A} and ${B}`)

  // ---------------------------------------------------------------------------------------------------
  section('1. Modules and helpers (no network)')

  await step('format.js', () => {
    check(near('390000000000000000000000') === '0.39', 'near() of 0.39 NEAR')
    check(near('1') === '<0.01', 'near() of dust')
    check(near('1234567890000000000000000', 3) === '1.234', 'near() rounds down')
    check(near('0') === '0.00', 'near() of nothing')
    check(toYocto('0.39') === '390000000000000000000000', 'toYocto("0.39")')
    check(toYocto('') === '0' && toYocto('x') === '0' && toYocto('0,5') === '500000000000000000000000', 'toYocto() of odd text')
    check(toYocto(near('12340000000000000000000000', 4)) === '12340000000000000000000000', 'near() and toYocto() agree')
    check(shortAccount('someone-very-long.testnet') === 'someone-very…testnet', 'shortAccount()')
    check(timeAgo(Date.now() / 1000 - 120) === '2 min ago', 'timeAgo()')
  })

  await step('keys, hashes and base58', () => {
    const pair = chain.generateKey()
    check(chain.publicKeyOf(pair.secretKey) === pair.publicKey, 'a generated key pair does not match itself')
    const seed = `ed25519:${chain.base58Encode(chain.base58Decode(pair.secretKey.slice(8)).slice(0, 32))}`
    check(chain.publicKeyOf(seed) === pair.publicKey, 'the 32-byte form of a key gives another public key')
    check(chain.sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256Hex("abc")')
    check(chain.sha256Hex('2:9f3a61c0').length === 64, 'a sealed move is 64 hex characters')
    check(chain.cleanPanic('Smart contract panicked: You do not have that much.') === 'You do not have that much.', 'cleanPanic() plain')
    check(chain.cleanPanic("Smart contract panicked: panicked at 'Not yours.', src/lib.rs:43:1") === 'Not yours.', 'cleanPanic() old Rust form')
    check(chain.cleanPanic('Smart contract panicked: panicked at src/lib.rs:43:1:\nNot yours.') === 'Not yours.', 'cleanPanic() new Rust form')
  })

  await step('storage can be injected, and saved sessions read back', () => {
    const kept = new Map()
    useStorage({ getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value), removeItem: (key) => kept.delete(key) })
    const pair = chain.generateKey()
    wallet.saveSession({ accountId: A, ...pair })
    check(kept.has('maul-session'), 'the session was not saved under maul-session')
    const saved = wallet.savedSession()
    check(saved && saved.accountId === A && saved.publicKey === pair.publicKey, 'the saved session did not read back')
    kept.set('maul-session', '{"accountId":"x","publicKey":"nope","secretKey":"nope"}')
    check(wallet.savedSession() === null, 'a damaged session was accepted')
    wallet.saveSocialKey({ accountId: A, ...pair })
    check(kept.has('maul-social-key') && wallet.savedSocialKey().accountId === A, 'the social key was not saved under maul-social-key')
    useStorage()
    check(store.get('maul-session') === null, 'memory storage was not empty')
  })

  await step('wallet.js refuses politely outside a browser', async () => {
    const said = []
    let message = ''
    try {
      await wallet.connectWallet((text) => said.push(text))
    } catch (error) {
      message = error.message
    }
    check(message === 'A wallet can only be connected in a browser.', `connectWallet said: ${message || 'nothing'}`)
    await wallet.disconnectWallet()
    return `progress: "${said.join('", "')}"`
  })

  // ---------------------------------------------------------------------------------------------------
  section('2. JSON-RPC')

  let deployed = false
  await step('reads: balances, accounts, the game contract', async () => {
    const [a, b] = await Promise.all([chain.accountBalance(A), chain.accountBalance(B)])
    check(a !== null && b !== null, 'A smoke account is missing. See the top of this file.')
    check((await chain.accountExists('no-such-account-maul-smoke.testnet')) === false, 'accountExists() of a missing account')
    check((await chain.accountBalance('no-such-account-maul-smoke.testnet')) === null, 'accountBalance() of a missing account')
    deployed = await chain.contractDeployed()
    return `A ${near(a, 3)} NEAR, B ${near(b, 3)} NEAR, ${CONFIG.contract} ${deployed ? 'has a contract' : 'has no contract yet'}`
  })

  await step('a dead node is skipped and rested', async () => {
    const real = [...CONFIG.rpc]
    const asked = []
    const realFetch = globalThis.fetch
    try {
      CONFIG.rpc = ['https://rpc-one.invalid', ...real]
      chain.resetNodes()
      globalThis.fetch = (url, init) => {
        asked.push(new URL(url).host)
        return realFetch(url, init)
      }
      check((await chain.accountBalance(A)) !== null, 'no answer through the second node')
      check((await chain.accountBalance(A)) !== null, 'no answer the second time')
      check(asked[0] === 'rpc-one.invalid', `the dead node was not tried first: ${asked.join(', ')}`)
      check(asked.filter((host) => host === 'rpc-one.invalid').length === 1, 'the dead node was asked again instead of resting')
      return `asked ${asked.join(' → ')}`
    } finally {
      globalThis.fetch = realFetch
      CONFIG.rpc = real
      chain.resetNodes()
    }
  })

  // ---------------------------------------------------------------------------------------------------
  section('3. NEAR Social: signed writes with a function-call key, read back from the KV API')

  let signerA = null
  let signerB = null
  const ready = await step('function-call keys for `social` are on both accounts', async () => {
    signerA = new chain.Signer(A, await socialKey(A))
    signerB = new chain.Signer(B, await socialKey(B))
    const key = await chain.accessKey(A, signerA.publicKey)
    check(key.permission.FunctionCall.receiver_id === CONFIG.socialReceiver, 'the key is for another receiver')
    return `methods ${JSON.stringify(key.permission.FunctionCall.method_names)}, gas for a write: ${social.SOCIAL_GAS}`
  })

  const run = Date.now().toString(36)
  let postId = null
  if (ready && !quick) {
    await step('a raw write "fails" on chain by design, and is included', async () => {
      const sent = await signerA.call(CONFIG.socialReceiver, '__fastdata_kv', { 'profile/links/smoke_run': run }, { gas: social.SOCIAL_GAS })
      check(sent.included && sent.hash, `the chain did not take it: ${sent.error}`)
      check(sent.ok === false && sent.failure, 'the receipt was expected to fail: there is no contract at `social`')
      return `tx ${sent.hash}: "${sent.error}" — ${spent('social write (raw)', sent)}`
    })

    await step('profile/name through social.js', async () => {
      const name = `Smoke A ${run}`
      const written = await social.setProfile(signerA, { name, about: 'Maul Street smoke test account. Automated.' })
      check(written.confirmed, 'the KV API did not show the write within ten seconds')
      const entry = await kvLatest(A, 'profile/name')
      check(entry && entry.value === name, `the KV API has ${JSON.stringify(entry && entry.value)}`)
      const profile = await social.readProfile(A, { fresh: true })
      check(profile.name === name && profile.about.startsWith('Maul Street smoke'), 'readProfile() disagrees')
      await social.setProfile(signerB, { name: 'Smoke B', about: 'Maul Street smoke test account. Automated.' })
      return `"${name}" — ${spent('social.setProfile (2 keys)', written)}`
    })

    await step('post/{id} with #maulstreet through social.js', async () => {
      const posted = await social.post(signerA, `Smoke run ${run}: calling out @${B} for a friendly.`)
      postId = posted.id
      check(posted.text.endsWith('#maulstreet'), 'the hashtag was not added')
      const entry = await kvLatest(A, `post/${posted.id}`)
      check(entry && entry.value && entry.value.text === posted.text, 'the KV API does not have the post')
      return `post/${posted.id} — ${spent('social.post', posted)}`
    })

    await step('the feed finds it, with the author name, and it mentions B', async () => {
      const feed = await social.readFeed()
      check(feed !== null, 'the KV API could not be reached')
      const mine = feed.find((entry) => entry.author === A && entry.id === postId)
      check(mine, 'the post is not in the feed')
      check(mine.name === `Smoke A ${run}`, `the author name is ${JSON.stringify(mine.name)}`)
      check(social.mentionsOf(feed, B).some((entry) => entry.id === postId), 'B is not mentioned')
      check(social.mentionsOf(feed, A).every((entry) => entry.id !== postId), 'A is told about its own post')
      check(feed.every((entry, i) => i === 0 || feed[i - 1].ts >= entry.ts), 'the feed is not newest first')
      return `${feed.length} tagged post(s) among the latest writes; newest ${timeAgo(feed[0].ts)}`
    })

    await step('follow: unfollow first, then follow, seen from both sides', async () => {
      const off = await social.unfollow(signerA, B)
      check(off.confirmed, 'the unfollow did not show')
      check(!(await social.readFollowing(A)).includes(B), 'B is still followed after null was written')
      check(!(await social.readFollowers(B)).includes(A), 'A is still a follower after null was written')
      const on = await social.follow(signerA, B)
      check(on.confirmed, 'the follow did not show')
      check((await social.readFollowing(A)).includes(B), `${B} is not in A's following`)
      check((await social.readFollowers(B)).includes(A), `${A} is not in B's followers`)
      return `${spent('social.follow', on)}`
    })

    // Two ways a send can go wrong on the wire. In both the signer must offer the SAME signed bytes
    // to the next node, and the write must happen exactly once.
    for (const [name, lose] of [
      ['a send that never reaches the first node goes to the next, with the same signed bytes', 'request'],
      ['a send whose answer is lost is not made twice: the next node reports the same transaction', 'answer'],
    ]) {
      await step(name, async () => {
        const sends = []
        const realFetch = globalThis.fetch
        const key = `profile/links/smoke_${lose}`
        let sent
        // Whatever node the signer addresses, the request is really carried by the last one in the
        // list, so that a real rate limit on the first cannot blur what is being tested here.
        const carrier = CONFIG.rpc[CONFIG.rpc.length - 1]
        const nodes = new Set(CONFIG.rpc.map((url) => new URL(url).host))
        try {
          chain.resetNodes()
          globalThis.fetch = async (url, init) => {
            if (!nodes.has(new URL(url).host)) return realFetch(url, init)
            const body = JSON.parse(init.body)
            if (body.method !== 'send_tx') return realFetch(carrier, init)
            sends.push({ host: new URL(url).host, bytes: body.params.signed_tx_base64 })
            if (sends.length > 1) return realFetch(carrier, init)
            if (lose === 'answer') await (await realFetch(carrier, init)).text() // a node runs it, and we never hear
            throw new TypeError('simulated network failure')
          }
          sent = await signerB.call(CONFIG.socialReceiver, '__fastdata_kv', { [key]: run }, { gas: social.SOCIAL_GAS })
        } finally {
          globalThis.fetch = realFetch
          chain.resetNodes()
        }
        check(sent.included, `not included: ${sent.error}`)
        check(sends.length >= 2 && sends[0].host !== sends[1].host, `sends went to: ${sends.map((send) => send.host).join(', ')}`)
        check(sends.every((send) => send.bytes === sends[0].bytes), 'the transaction was signed again')
        let writes = []
        for (let i = 0; i < 15 && writes.length === 0; i++) {
          await sleep(700)
          const response = await fetch(`${CONFIG.kv}/v0/history/${CONFIG.socialReceiver}/${B}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key, include_metadata: true, limit: 20 }),
          })
          writes = (await response.json()).entries.filter((entry) => entry.value === run)
        }
        check(writes.length === 1, `the KV history shows ${writes.length} writes of this value`)
        check(writes[0].tx_hash === sent.hash, 'the write came from another transaction')
        return `offered to ${sends.map((send) => send.host).join(' then ')}; one write, tx ${sent.hash}`
      })
    }

    // -------------------------------------------------------------------------------------------------
    section('4. Nonces')

    await step('five writes sent back to back all land', async () => {
      const keys = [1, 2, 3, 4, 5].map((n) => `profile/links/smoke_${n}`)
      const sent = await Promise.all(keys.map((key, i) => social.write(signerA, { [key]: `${run}-${i + 1}` })))
      check(sent.every((write) => write.confirmed), 'a write was not confirmed')
      check(new Set(sent.map((write) => write.hash)).size === 5, 'two writes share a transaction')
      for (const [i, key] of keys.entries()) {
        const entry = await kvLatest(A, key)
        check(entry && entry.value === `${run}-${i + 1}`, `${key} holds ${JSON.stringify(entry && entry.value)}`)
      }
      sent.forEach((write) => spent('social write (1 key)', write))
      return `5 transactions, 5 keys read back`
    })

    await step('a key that fell behind the chain reads its nonce again and goes through', async () => {
      const secret = await socialKey(A)
      const one = new chain.Signer(A, secret)
      const two = new chain.Signer(A, secret)
      const first = await two.call(CONFIG.socialReceiver, '__fastdata_kv', { 'profile/links/smoke_n': `${run}-a` }, { gas: social.SOCIAL_GAS })
      const second = await one.call(CONFIG.socialReceiver, '__fastdata_kv', { 'profile/links/smoke_n': `${run}-b` }, { gas: social.SOCIAL_GAS })
      // `two` still counts from where it was: its next nonce is already used.
      const third = await two.call(CONFIG.socialReceiver, '__fastdata_kv', { 'profile/links/smoke_n': `${run}-c` }, { gas: social.SOCIAL_GAS })
      check(first.included && second.included && third.included, `not all included: ${[first, second, third].map((sent) => sent.error).join(' | ')}`)
    })

    await step('a call the key may not make is refused in plain words, before it costs anything', async () => {
      const sent = await signerA.call(CONFIG.socialReceiver, 'something_else', {}, { gas: social.SOCIAL_GAS })
      check(!sent.ok && !sent.included && sent.gasBurnt === 0, 'the call was not refused')
      return `"${sent.error}"`
    })
  }

  // ---------------------------------------------------------------------------------------------------
  section('5. The api facade')

  const events = []
  const toasts = []
  api.on('change', (key) => events.push(key))
  api.on('toast', (toast) => toasts.push(toast))
  const moneyToasts = () => toasts.filter((toast) => toast.kind === 'near').map((toast) => toast.text)

  let connected = false
  await step('api._useSession adopts a function-call key for the game contract', async () => {
    check((await chain.accountExists(CONFIG.contract)) === true, `${CONFIG.contract} does not exist yet, so no key can be made for it`)
    const before = api.state
    const session = await api._useSession({ accountId: A, secretKey: await gameKey(A) })
    check(session.accountId === A && api.state.session.accountId === A, 'no session')
    check(api.state !== before, 'the state object was not replaced')
    check(events.includes('session'), "no 'change' event for session")
    check(wallet.savedSession().accountId === A, 'the session was not saved')
    check(typeof api.state.walletBalance === 'string', 'the wallet balance did not load')
    connected = true
    return `wallet balance ${near(api.state.walletBalance, 3)} NEAR`
  })

  if (connected && ready && !quick) {
    await step('api.social: key, refresh, state', async () => {
      const before = api.state.social
      await api._useSocialKey(await socialKey(A))
      check(api.state.social.enabled === true, 'social is not enabled')
      check(api.state.social !== before, 'the social state changed, but the object was not replaced')
      await api.social.refresh()
      const now = api.state.social
      await api.social.refresh()
      check(api.state.social === now, 'a refresh that found nothing new replaced the state object')
      check(now.profile && now.profile.name === `Smoke A ${run}`, `profile is ${JSON.stringify(now.profile)}`)
      check(now.following.includes(B), 'following does not include B')
      check(now.feed.some((entry) => entry.id === postId && entry.name === `Smoke A ${run}`), 'the feed does not hold the post')
      check(Array.isArray(now.followers) && Array.isArray(now.mentions), 'followers or mentions is not a list')
      const other = await api.social.profileOf(B)
      check(other.accountId === B && other.name === 'Smoke B', `profileOf(B) is ${JSON.stringify(other)}`)
      check(api.social.url(A) === null && api.social.url(A, postId) === null, 'testnet should have no near.social link')
      return `feed ${now.feed.length}, following ${now.following.length}, followers ${now.followers.length}, mentions ${now.mentions.length}`
    })

    await step('api.social.follow and unfollow update the state, and a bad name is a plain sentence', async () => {
      await api.social.unfollow(B)
      check(!api.state.social.following.includes(B), 'still following after unfollow')
      await api.social.follow(B)
      check(api.state.social.following.includes(B), 'not following after follow')
      let message = ''
      try {
        await api.social.follow('no-such-account-maul-smoke.testnet')
      } catch (error) {
        message = error.message
      }
      check(message === 'There is no account called no-such-account-maul-smoke.testnet.', `said: ${message}`)
      check(toasts.some((toast) => toast.kind === 'error' && toast.text === message), 'no error toast was raised')
      check(Object.keys(api.state.pending).length === 0, `pending flags were left behind: ${JSON.stringify(api.state.pending)}`)
      return `"${message}"`
    })
  }

  if (ready && postId) {
    await step('the test post is taken down again: null removes it from the feed', async () => {
      // Everything tagged #maulstreet shows in the game's own feed, so this test does not leave its post there.
      const gone = await social.write(signerA, { [`post/${postId}`]: null })
      check(gone.confirmed, 'the removal did not show')
      const feed = await social.readFeed()
      check(feed !== null && !feed.some((entry) => entry.author === A && entry.id === postId), 'the post is still in the feed')
      check((await social.readPosts(A)).every((entry) => entry.id !== postId), "the post is still among A's posts")
      return spent('social write (1 key)', gone)
    })
  }

  // ---------------------------------------------------------------------------------------------------
  section(`6. The game contract at ${CONFIG.contract}`)

  if (!deployed) {
    console.log('  --    not deployed yet (no code on the account): nothing in this section was run')
  } else if (connected) {
    await step('public state loads', async () => {
      await api.refresh()
      const { dens, market, stats, ticker, leaderboard, hireMarket, challenges } = api.state
      check(Array.isArray(dens) && dens.length === 5, `expected five dens, got ${dens.length}`)
      check(market && Array.isArray(market.items) && Array.isArray(market.species), 'no market')
      check(stats && typeof stats.players === 'number', 'no stats')
      check(Array.isArray(ticker) && Array.isArray(leaderboard) && Array.isArray(hireMarket) && Array.isArray(challenges), 'a list is missing')
      return `${dens.length} dens, ${market.items.length} items, ${market.species.length} species, ${stats.players} players, ${ticker.length} ticker lines, ${leaderboard.length} on the leaderboard`
    })

    await step('register (skipped if already registered)', async () => {
      check(api.state.player, 'the player did not load')
      if (api.state.player.registered) return `already registered: ${api.state.player.beasts.length} beasts`
      const before = api.state.player
      const player = await api.register([0, 1, 2])
      check(player.registered && api.state.player.registered, 'not registered after register()')
      check(api.state.player !== before, 'the player object was not replaced')
      return `three beasts minted — ${lastCall()}`
    })

    await step('api.state.player', () => {
      const player = api.state.player
      check(player.account_id === A && player.registered, 'wrong player')
      check(player.beasts.length >= 3, 'fewer than three beasts')
      return `balance ${near(player.balance)} NEAR, ${player.essence} Essence, rating ${player.rating}, beasts: ${player.beasts.map((beast) => `${beast.name}#${beast.id} L${beast.level}`).join(', ')}`
    })

    // Beasts level up (the four upgrade tracks are gone). The views must say so.
    const levels = await step('the views carry levels and forms', () => {
      const beast = api.state.player.beasts[0]
      for (const field of ['level', 'xp', 'xp_next', 'form']) check(typeof beast[field] === 'number', `BeastView.${field} is ${JSON.stringify(beast[field])}`)
      check(typeof beast.form_name === 'string' && beast.form_name, 'BeastView has no form_name')
      check(!('up' in beast), 'BeastView still has the old upgrade tracks (`up`): the contract at this address is the earlier one')
      const den = api.state.dens[0]
      for (const field of ['training_levels', 'level_bonus', 'spar_level']) check(typeof den[field] === 'number', `DenView.${field} is ${JSON.stringify(den[field])}`)
      return `${beast.name}: level ${beast.level}, ${beast.xp}/${beast.xp_next} XP, form ${beast.form} (${beast.form_name}); dens spar at levels ${api.state.dens.map((entry) => entry.spar_level).join(', ')}`
    })

    await slow("a bad call returns the contract's own sentence", async () => {
      const before = toasts.length
      let message = ''
      try {
        await api.withdraw(toYocto('123456'))
      } catch (error) {
        message = error.message
      }
      check(message, 'withdrawing far more than the balance did not fail')
      check(!/panicked|Smart contract|src\/|\.rs/.test(message), `the message is not plain: ${message}`)
      check(toasts.length > before && toasts.at(-1).kind === 'error' && toasts.at(-1).text === message, 'no error toast')
      check(Object.keys(api.state.pending).length === 0, 'the pending flag was left behind')
      return `"${message}" — ${spent('withdraw (refused)', api._calls.at(-1))}`
    })

    await slow('a free den fight, played to the end', async () => {
      // `player.den_match` is the player's latest den fight. The contract leaves it there once
      // the fight is over, until the next one starts, so it has to be looked at.
      const before = { wins: api.state.player.den_wins, losses: api.state.player.den_losses, essence: api.state.player.essence }
      const grown = (beast) => beast.level * 1e9 + beast.xp // level first, then XP towards the next
      let match = api.state.player.den_match != null ? await api.getMatch(api.state.player.den_match) : null
      if (match && !match.over) {
        console.log(`        resuming den fight ${match.id} at turn ${match.battle.turn}`)
      } else {
        match = await api.startDenFight(0, squadOf(api.state.player), '0')
        console.log(`        fight ${match.id} against ${api.state.dens[0].name} started — ${lastCall()}`)
        check(api.state.player.den_match === match.id, 'the player does not show the fight')
      }
      check(match.kind === 'den' && match.players[0] === A && match.players[1] === 'den:0', 'not a den fight of ours')
      // The three beasts in the pit, as they were before it.
      const squad = match.battle.teams[0].map((fighter) => api.state.player.beasts.find((beast) => beast.id === fighter.token))
      check(squad.every(Boolean), 'the fighters are not the player\'s beasts')
      if (levels) check(match.battle.teams.flat().every((fighter) => typeof fighter.level === 'number'), 'the fighters carry no level')
      let moves = 0
      while (!match.over) {
        check(moves < 200, 'the fight did not end in 200 moves')
        const action = chooseAction(match, 0)
        const next = await api.denAct(action)
        moves++
        check(next.battle.turn > match.battle.turn, 'the turn did not advance')
        check(Array.isArray(next.last_events) && next.last_events.length > 0, 'no events came back')
        check(Array.isArray(next.steps) && next.steps.length >= 1 && next.steps.length <= 4, 'steps is not the last 1 to 4 steps')
        console.log(`        turn ${String(match.battle.turn).padStart(2)}: ${MOVES[action].padEnd(15)} → ${next.last_events.length} events, ${standing(next)} — ${lastCall()}`)
        match = next
      }
      check(match.winner === 0 || match.winner === 1, 'no winner')
      // denAct() reloads the player before it resolves, so the result must already be in the state.
      const now = api.state.player
      check(now.den_wins + now.den_losses === before.wins + before.losses + 1, 'the den record did not move: the player was read before the fight settled')
      check(now.essence === before.essence + match.essence[0], `Essence went from ${before.essence} to ${now.essence}, but the fight paid ${match.essence[0]}`)
      const stored = await api.getMatch(match.id)
      check(stored && stored.over && stored.winner === match.winner, 'get_match does not show the finished fight')
      let refusal = ''
      try {
        await api.denAct(0)
      } catch (error) {
        refusal = error.message
      }
      check(refusal, 'a move in a finished fight was accepted')
      let learned = ''
      if (levels) {
        // Every beast that was fielded learns from the fight, win or lose.
        check(Array.isArray(match.xp) && match.xp[0].length === 3 && Array.isArray(match.levels) && match.levels[0].length === 3, 'the finished fight carries no xp and levels')
        const after = squad.map((beast) => now.beasts.find((entry) => entry.id === beast.id))
        check(after.some((beast, i) => grown(beast) > grown(squad[i])), "no beast's XP or level rose")
        check(after.every((beast, i) => grown(beast) >= grown(squad[i])), 'a beast lost XP')
        check(after.every((beast, i) => beast.level === match.levels[0][i]), `the fight says levels ${match.levels[0].join(', ')}, the player's beasts say ${after.map((beast) => beast.level).join(', ')}`)
        check(match.xp[0].every((xp, i) => (xp > 0) === grown(after[i]) > grown(squad[i])), `the fight says XP ${match.xp[0].join(', ')}, but that is not what the beasts show`)
        learned = `; XP earned ${match.xp[0].join(', ')}: ${after.map((beast, i) => `${beast.name} L${squad[i].level} ${squad[i].xp}/${squad[i].xp_next} → L${beast.level} ${beast.xp}/${beast.xp_next}`).join('; ')}`
      }
      return `${moves} moves, ${match.winner === 0 ? 'won' : 'lost'}, +${match.essence[0]} Essence (now ${now.essence}), den record ${now.den_wins}-${now.den_losses}${learned}; a move after the end: "${refusal}"`
    })

    await slow('forfeitDen ends a fight at once', async () => {
      const losses = api.state.player.den_losses
      const started = await api.startDenFight(1, squadOf(api.state.player), '0')
      const ended = await api.forfeitDen()
      check(ended.id === started.id && ended.over && ended.winner === 1, 'the fight was not lost')
      check(api.state.player.den_losses === losses + 1, 'the loss is not on the record')
      return lastCall()
    })

    await slow("money from outside raises a 'near' toast", async () => {
      // Another client pays into the player's pit balance: here near-cli, signing as the same account.
      const before = big(api.state.player.balance)
      toasts.length = 0
      cli(['contract', 'call-function', 'as-transaction', CONFIG.contract, 'deposit', 'json-args', '{}', 'prepaid-gas', '30 Tgas', 'attached-deposit', '0.4 NEAR', 'sign-as', smokeAccount(A)], A)
      for (let i = 0; i < 12 && big(api.state.player.balance) === before; i++) {
        await sleep(700)
        await api.refresh('player')
      }
      check(big(api.state.player.balance) - before === big(toYocto('0.4')), `the balance went from ${near(before, 4)} to ${near(api.state.player.balance, 4)}`)
      check(moneyToasts().length === 1 && moneyToasts()[0] === '+0.40 NEAR', `toasts: ${JSON.stringify(toasts)}`)
      await api.refresh('player')
      check(moneyToasts().length === 1, 'the same money was announced twice')
      return `"${moneyToasts()[0]}", pit balance now ${near(api.state.player.balance)} NEAR`
    })

    await slow('backDen takes NEAR out of the balance quietly; unbackDen brings it back with a toast', async () => {
      toasts.length = 0
      const balance = big(api.state.player.balance)
      const dens = api.state.dens
      const stake = toYocto('0.1')
      const shares = await api.backDen(4, stake)
      const backed = lastCall()
      check(/^\d+$/.test(shares) && big(shares) > 0n, `shares: ${shares}`)
      check(big(api.state.player.balance) === balance - big(stake), 'the balance did not fall by the amount backed')
      const backing = api.state.player.backing.find((entry) => entry.den === 4)
      check(backing && big(backing.shares) >= big(shares), 'the player does not show the shares')
      check(api.state.dens !== dens, 'the dens were not reloaded')
      check(moneyToasts().length === 0, 'a money toast for money going out')
      const paid = await api.unbackDen(4, backing.shares)
      check(big(paid) > 0n && big(api.state.player.balance) === balance - big(stake) + big(paid), 'the balance did not rise by what was paid')
      check(!api.state.player.backing.some((entry) => entry.den === 4 && big(entry.shares) > 0n), 'the shares are still there')
      check(moneyToasts().length === 1 && moneyToasts()[0] === `+${near(paid)} NEAR`, `toasts: ${JSON.stringify(toasts)}`)
      return `${near(stake)} NEAR in for ${shares} shares (${backed}); ${near(paid, 4)} NEAR back (${lastCall()}); toast "${moneyToasts()[0]}"`
    })

    if (levels) {
      await slow('levelUp with NEAR', async () => {
        const beast = api.state.player.beasts[0]
        const balance = big(api.state.player.balance)
        const raised = await api.levelUp(beast.id, false)
        check(raised.id === beast.id && raised.level === beast.level + 1, `the level went from ${beast.level} to ${raised.level}`)
        check(raised.stats.every((stat, i) => stat >= beast.stats[i]) && raised.power > beast.power, 'the beast did not get stronger')
        const paid = balance - big(api.state.player.balance)
        check(paid > 0n, 'the level cost no NEAR')
        const now = api.state.player.beasts.find((entry) => entry.id === beast.id)
        check(now.level === raised.level && now.xp === raised.xp, 'the state does not show the new level')
        return `${beast.name}: level ${beast.level} → ${raised.level} for ${near(paid, 4)} NEAR, power ${beast.power} → ${raised.power}, form ${raised.form} (${raised.form_name}) — ${lastCall()}`
      })

      await slow('levelUp with Essence: the price is the XP the beast still lacks', async () => {
        // The beast nearest its next level is the cheapest to feed.
        const beast = [...api.state.player.beasts].sort((a, b) => a.xp_next - a.xp - (b.xp_next - b.xp))[0]
        const price = beast.xp_next - beast.xp
        const essence = api.state.player.essence
        if (essence < price) {
          // Not enough to feed any beast: the contract must say so in plain words, and nothing may change.
          let refusal = ''
          try {
            await api.levelUp(beast.id, true)
          } catch (error) {
            refusal = error.message
          }
          check(refusal && !/panicked|Smart contract|\.rs/.test(refusal), 'feeding too little Essence was not refused in plain words')
          check(api.state.player.essence === essence, 'Essence was taken although the level was refused')
          return `the player has ${essence} Essence and the cheapest level costs ${price}, so this run could only see it refused: "${refusal}" — ${lastCall()}`
        }
        const raised = await api.levelUp(beast.id, true)
        check(raised.id === beast.id && raised.level === beast.level + 1, `the level went from ${beast.level} to ${raised.level}`)
        check(api.state.player.essence === essence - price, `Essence went from ${essence} to ${api.state.player.essence}, and the price was ${price}`)
        check(api.state.player.beasts.find((entry) => entry.id === beast.id).level === raised.level, 'the state does not show the new level')
        return `${beast.name}: level ${beast.level} → ${raised.level} for ${price} Essence (${essence} → ${api.state.player.essence}) — ${lastCall()}`
      })
    }

    await slow('renameBeast, listForHire and unlist', async () => {
      const beast = api.state.player.beasts[0]
      const name = `Smoke ${run.slice(-5)}`
      const renamed = await api.renameBeast(beast.id, name)
      const renameCost = lastCall()
      check(renamed.name === name && api.state.player.beasts[0].name === name, 'the name did not change')
      const price = toYocto('0.002')
      await api.listForHire(beast.id, price)
      const listCost = lastCall()
      check(api.state.player.beasts[0].hire_price === price, 'the beast does not show its price')
      check(api.state.hireMarket.some((entry) => entry.id === beast.id && entry.hire_price === price), 'the beast is not in the hire market')
      await api.unlist(beast.id)
      check(api.state.player.beasts[0].hire_price === null && !api.state.hireMarket.some((entry) => entry.id === beast.id), 'the beast is still listed')
      let refusal = ''
      try {
        await api.renameBeast(beast.id, '')
      } catch (error) {
        refusal = error.message
      }
      check(refusal, 'an empty name was accepted')
      return `"${name}" (${renameCost}); listed and unlisted (${listCost}); an empty name: "${refusal}"`
    })

    await slow('buyItem (the first time only), equip and unequip', async () => {
      const slotOf = (beast, itemId) => ['relic', 'aura', 'finisher'].findIndex((slot) => beast[slot] === itemId)
      let note = ''
      const beast = api.state.player.beasts[1]
      // An item is bought once and then reused by later runs: take off whatever is worn to find it.
      for (const [kind, slot] of ['relic', 'aura', 'finisher'].entries()) {
        if (api.state.player.beasts[1][slot]) await api.unequip(beast.id, kind)
      }
      if (api.state.player.items.length === 0) {
        const cheapest = [...api.state.market.items].sort((a, b) => (big(a.price) < big(b.price) ? -1 : 1))[0]
        const balance = big(api.state.player.balance)
        const paid = await api.buyItem(cheapest.id, cheapest.price)
        check(big(paid) <= big(cheapest.price) && big(api.state.player.balance) === balance - big(paid), 'the price paid does not match the balance')
        note = `bought item ${cheapest.id} for ${near(paid, 3)} NEAR (${lastCall()}); `
      }
      const [itemId, count] = api.state.player.items[0]
      const worn = await api.equip(beast.id, itemId)
      const kind = slotOf(worn, itemId)
      check(kind >= 0, 'the item is in no slot')
      const left = api.state.player.items.find((entry) => entry[0] === itemId)
      check((left ? left[1] : 0) === count - 1, 'the inventory did not give the item up')
      const equipCost = lastCall()
      const bare = await api.unequip(beast.id, kind)
      check(slotOf(bare, itemId) < 0 && api.state.player.items.find((entry) => entry[0] === itemId)[1] === count, 'the item did not come back')
      return `${note}item ${itemId} into slot ${kind} (${equipCost}) and out again (${lastCall()})`
    })

    await slow('withdraw sends NEAR to the wallet', async () => {
      // Everything but 0.05 NEAR goes back, so that runs of this test do not pile NEAR up in the pit.
      await api.refresh('walletBalance')
      const pit = big(api.state.player.balance)
      const own = big(api.state.walletBalance)
      const out = pit - big(toYocto('0.05'))
      check(out > 0n, `only ${near(pit, 4)} NEAR in the pit`)
      await api.withdraw(out.toString())
      const paid = lastCall()
      check(big(api.state.player.balance) === pit - out, 'the pit balance did not fall')
      for (let i = 0; i < 8 && big(api.state.walletBalance) <= own; i++) {
        await sleep(700)
        await api.refresh('walletBalance')
      }
      const rise = big(api.state.walletBalance) - own
      // The wallet pays the gas of the call out of the same balance, so it rises by a little less.
      check(rise > out - big(toYocto('0.01')) && rise <= out, `the wallet rose by ${near(rise, 5)} NEAR, and ${near(out, 5)} was withdrawn`)
      return `pit ${near(pit)} → ${near(api.state.player.balance)} NEAR, wallet +${near(rise, 4)} NEAR — ${paid}`
    })

    await slow('hire: B lists a beast and A hires it for one fight', async () => {
      // B is not behind the facade here: its calls go straight through a Signer with its own game key.
      const other = new chain.Signer(B, await gameKey(B))
      const asB = async (method, args) => {
        const sent = await other.call(CONFIG.contract, method, args)
        check(sent.ok, `${method} as B: ${sent.error}`)
        return sent.value
      }
      let theirs = await chain.view('get_player', { account_id: B })
      if (!theirs.registered) theirs = await asB('register', { picks: [2, 3, 4] })
      const beast = theirs.beasts[0]
      const held = (api.state.player.hires.find((entry) => entry.beast.id === beast.id) || { fights_left: 0 }).fights_left
      if (held >= 20) return `left out: A already holds ${held} paid fights with ${beast.name}, the most the contract allows`
      const price = toYocto('0.002')
      await asB('list_for_hire', { beast_id: beast.id, price })
      await api.refresh('hireMarket')
      check(api.state.hireMarket.some((entry) => entry.id === beast.id && entry.owner === B && entry.hire_price === price), "B's beast is not in the hire market")
      const balance = big(api.state.player.balance)
      const player = await api.hire(beast.id, 1)
      const paid = lastCall()
      check(player.account_id === A, 'hire() did not return the hirer')
      const hire = api.state.player.hires.find((entry) => entry.beast.id === beast.id)
      check(hire && hire.fights_left === held + 1, 'the paid fight is not on the player')
      check(big(api.state.player.balance) === balance - big(price), 'the price did not come off the balance')
      await asB('unlist', { beast_id: beast.id })
      await api.refresh('hireMarket')
      check(!api.state.hireMarket.some((entry) => entry.id === beast.id), 'the beast is still listed')
      return `${beast.name}#${beast.id} of ${B}, one fight for ${near(price, 3)} NEAR; A now holds ${hire.fights_left} — ${paid}`
    })

    await slow('a staked challenge holds the stake; cancelling returns it', async () => {
      if (api.state.player.challenge != null) await api.cancelChallenge()
      toasts.length = 0
      const balance = big(api.state.player.balance)
      const stake = toYocto('0.01')
      // Named for B, so that nobody else on testnet can pick it up in the seconds it is open.
      const challenge = await api.createChallenge(squadOf(api.state.player), stake, 0, B)
      const made = lastCall()
      check(challenge.creator === A && challenge.stake === stake && challenge.invite === B, 'the challenge is not as asked')
      if (levels) check(challenge.squad.length === 3 && challenge.squad.every((entry) => typeof entry.level === 'number' && typeof entry.power === 'number'), 'the challenge does not show the level of each beast')
      check(api.state.player.challenge === challenge.id && big(api.state.player.balance) === balance - big(stake), 'the stake was not held')
      check(api.state.challenges.some((entry) => entry.id === challenge.id), 'the challenge is not among the open ones')
      await api.cancelChallenge()
      check(api.state.player.challenge == null && big(api.state.player.balance) === balance, 'the stake did not come back')
      check(!api.state.challenges.some((entry) => entry.id === challenge.id), 'the challenge is still open')
      check(moneyToasts().length === 1 && moneyToasts()[0] === '+0.01 NEAR', `toasts: ${JSON.stringify(toasts)}`)
      return `challenge ${challenge.id} (${made}), cancelled (${lastCall()}); toast "${moneyToasts()[0]}"`
    })

    if (wantDuel) await duel({ step, spent, lastCall, traffic })
  }

  // ---------------------------------------------------------------------------------------------------
  api._stop()
  section('What the calls cost')
  const groups = new Map()
  for (const entry of costs) {
    const group = groups.get(entry.what) || { count: 0, gas: 0, tokens: 0n }
    group.count++
    group.gas += Number(entry.gasBurnt)
    group.tokens += BigInt(entry.tokensBurnt)
    groups.set(entry.what, group)
  }
  for (const [what, group] of groups) {
    console.log(`  ${what.padEnd(28)} ×${String(group.count).padEnd(3)} avg ${tgas(group.gas / group.count)}, ${cost(group.tokens / BigInt(group.count))}`)
  }

  section('Where the requests went')
  for (const [host, kinds] of Object.entries(traffic)) {
    const total = Object.values(kinds).reduce((sum, count) => sum + count, 0)
    const rest = Object.entries(kinds).filter(([kind]) => kind !== 'ok').map(([kind, count]) => `${count} × ${kind}`)
    console.log(`  ${host.padEnd(28)} ${String(total).padStart(4)} requests, ${kinds.ok || 0} answered${rest.length ? `; ${rest.join(', ')}` : ''}`)
  }

  const failed = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failed.length} of ${results.length} steps passed${failed.length ? `; FAILED: ${failed.map((result) => result.name).join('; ')}` : ''}`)
  process.exitCode = failed.length ? 1 : 0
}

/**
 * A friendly duel. A posts a challenge for B. B runs in a worker with its own copy of the api and
 * its storage in a file. B's first copy accepts, seals its opening pick and is then stopped, as if
 * the page were closed. A second copy of B starts from the same storage, as after a reload: it must
 * open the sealed move by itself once A has moved. Then both play to the end with api.duelMove.
 */
async function duel({ step, spent, lastCall, traffic }) {
  console.log('\n7. A friendly duel between the two smoke accounts')
  const storeFile = path.join(SMOKE_KEYS, 'duel-b-storage.json')
  fs.rmSync(storeFile, { force: true })
  let opponent = null
  let outcome = null // what B's last copy reported when it was done: { done, moves, calls } or { error }
  let readyCount = 0
  const startOpponent = async () => {
    opponent = new Worker(fileURLToPath(import.meta.url), { workerData: { secretKey: await gameKey(B), storeFile } })
    opponent.on('message', (message) => {
      if (message.say) console.log(`        ${message.say}`)
      else if (message.ready) readyCount++
      else {
        outcome = message
        addTraffic(traffic, message.traffic)
      }
    })
    opponent.on('error', (error) => {
      outcome = { error: error.message }
    })
  }
  const failIfOpponentFailed = () => check(!(outcome && outcome.error), `B failed: ${outcome && outcome.error}`)

  const seen = []
  const watched = []
  const stop = api.on('duel', (match) => seen.push(`${match.battle.turn}${match.over ? ' over' : ''}`))
  let stopWatching = () => {}
  let match = null
  let latest = null // the duel as api.watchDuel last reported it: after the start, A asks the chain nothing itself
  let side = 0
  let moves = 0
  let reloaded = false // the sealed-move-after-a-reload part ran
  const retried = [] // moves of A's that failed and were made again

  try {
    const stale = await duelInProgress()
    if (stale) {
      // An earlier run of this test was stopped mid-duel. Its sealed moves died with it, so give that duel up.
      await step('a duel left unfinished by an earlier run is forfeited', async () => {
        const ended = await api.forfeitDuel()
        check(ended.id === stale.id && ended.over && ended.winner === 1 - ended.players.indexOf(A), 'the duel was not conceded')
        return `duel ${ended.id} — ${lastCall()}`
      })
      seen.length = 0
    }

    await step("A's challenge is accepted: the facade notices and raises 'duel'", async () => {
      await startOpponent()
      if (api.state.player.challenge != null) await api.cancelChallenge()
      const challenge = await api.createChallenge(squadOf(api.state.player), '0', 0, B)
      console.log(`        challenge ${challenge.id} posted for ${B} — ${lastCall()}`)
      // Nothing more is asked of the chain here: the facade's own six-second look at the player sees the duel.
      for (let i = 0; i < 240 && seen.length === 0; i++) {
        failIfOpponentFailed()
        await sleep(500)
      }
      check(seen.length > 0, "no 'duel' event was raised")
      match = await duelInProgress()
      check(match, 'the duel never started')
      side = match.players.indexOf(A)
      latest = match
      stopWatching = api.watchDuel(match.id, (now) => {
        watched.push(now.battle.turn)
        latest = now
      })
      return `duel ${match.id}, A is side ${side}, ${match.deadline - Math.floor(Date.now() / 1000)} s on the opening clock`
    })

    await step("B seals, B's page is closed, a fresh copy of B opens the seal by itself after A moves", async () => {
      check(match, 'there is no duel')
      // A duel left unfinished by an earlier run of this test is simply played out.
      if (match.battle.turn !== 0) return `left out: duel ${match.id} was already at turn ${match.battle.turn} (an earlier run did not finish it)`
      const id = match.id
      const rival = 1 - side
      for (let i = 0; i < 240 && !latest.sealed[rival]; i++) {
        failIfOpponentFailed()
        await sleep(250)
      }
      match = latest
      check(match.sealed[rival] && !match.open[rival], 'B did not seal its opening pick')
      await opponent.terminate()
      check(fs.readFileSync(storeFile, 'utf8').includes(`maul-seal:${id}:0`), "B's storage does not hold the sealed move")
      console.log("        B has sealed its pick and its copy of the game is gone; the seal is in B's storage")
      const before = readyCount
      await startOpponent()
      for (let i = 0; i < 120 && readyCount === before; i++) {
        failIfOpponentFailed()
        await sleep(500)
      }
      check(readyCount > before, 'the second copy of B did not start')
      // A sees that B has locked in, so it plays openly. B's new copy then has to open its seal unasked.
      const from = api._calls.length
      match = await api.duelMove(chooseAction(match, side))
      moves++
      const made = api._calls.slice(from)
      made.forEach((call) => spent(call.method, call))
      check(made.length === 1 && made[0].method === 'duel_play', `A sent ${made.map((call) => call.method).join(' + ')}`)
      for (let i = 0; i < 160 && latest.battle.turn === 0 && !latest.over; i++) {
        failIfOpponentFailed()
        await sleep(250)
      }
      match = latest
      check(match.battle.turn === 1 && match.battle.active[0] !== 255 && match.battle.active[1] !== 255, 'the opening picks did not play')
      reloaded = true
      return `A played openly (duel_play); B's seal was opened; turn 1: ${standing(match)}`
    })

    await step('both play with api.duelMove until it is over', async () => {
      check(latest, 'there is no duel')
      while (!latest.over) {
        failIfOpponentFailed()
        const now = latest
        if (now.need[side] && !now.sealed[side] && !now.open[side]) {
          const from = api._calls.length
          const action = chooseAction(now, side)
          let after
          try {
            after = await api.duelMove(action)
          } catch (error) {
            // What a player does when a move does not go through: try again.
            retried.push(error.message)
            check(retried.length <= 10, `ten moves failed: ${error.message}`)
            console.log(`        A: ${MOVES[action]} did not go through ("${error.message}"); trying again`)
            await sleep(1_500)
            continue
          }
          if (after.over) latest = after
          moves++
          const made = api._calls.slice(from)
          made.forEach((call) => spent(call.method, call))
          console.log(`        A: ${MOVES[action].padEnd(15)} (${made.map((call) => call.method).join(' + ')}) → turn ${after.battle.turn}, ${standing(after)}`)
        } else {
          await sleep(250)
        }
        check(moves < 300, 'the duel did not end in 300 moves')
      }
      match = latest
      for (let i = 0; i < 40 && !outcome; i++) await sleep(500)
      check(outcome, 'B did not report back')
      failIfOpponentFailed()
      outcome.calls.forEach((call) => spent(`${call.method} (B)`, call))
      check(match.over && (match.winner === 0 || match.winner === 1), 'the duel has no winner')
      if (reloaded) check(outcome.calls[0].method === 'duel_reveal', `the first thing B's fresh copy sent was ${outcome.calls[0].method}, not the opening of its seal`)
      check(seen.at(-1).endsWith('over'), `the last 'duel' event was not the end: ${seen.join(', ')}`)
      check(watched.length > 1, 'watchDuel() reported nothing')
      check(Object.keys(api.state.pending).length === 0, `pending flags were left behind: ${JSON.stringify(api.state.pending)}`)
      // When the other side makes the last move, the facade reloads the player by itself, a moment later.
      await api.refresh('player')
      check(api.state.player.wins + api.state.player.losses > 0, "the duel is not on A's record")
      // Every beast of both squads learns from a duel that has a winner.
      const earned = (match.xp || [])[side] || []
      const levelsNow = (match.levels || [])[side] || []
      check(earned.length === 3 && earned.every((xp) => xp > 0), `the duel shows no XP for A's beasts: ${JSON.stringify(match.xp)}`)
      check(levelsNow.every((level, slot) => api.state.player.beasts.find((beast) => beast.id === match.battle.teams[side][slot].token).level === level), "the duel's levels are not what A's beasts show")
      const again = retried.length + (outcome.retried || []).length
      return `${moves} moves by A, ${outcome.moves} by B${again ? ` (${again} moves had to be made again after "${[...retried, ...(outcome.retried || [])][0]}")` : ''}, ${match.winner === side ? 'A' : 'B'} won; A's rating is now ${api.state.player.rating}; A's beasts earned ${earned.join(', ')} XP; 'duel' events at turns ${seen.join(', ')}; watchDuel reported ${watched.length} changes`
    })
  } finally {
    stop()
    stopWatching()
    if (opponent) await opponent.terminate()
    fs.rmSync(storeFile, { force: true })
  }
}
