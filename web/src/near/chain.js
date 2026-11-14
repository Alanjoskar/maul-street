// Talking to NEAR testnet: JSON-RPC over three public nodes, contract views,
// and a signer that builds, signs and sends function calls with a key held in
// the browser. No wallet and no popup are involved in anything in this file.

import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { CONFIG, isAccountId } from './config.js'

// noble's synchronous API needs to be told which SHA-512 to use.
ed.hashes.sha512 = sha512

const REST_MS = 20_000
const VIEW_TIMEOUT_MS = 12_000
const SEND_TIMEOUT_MS = 30_000
const BLOCK_HASH_TTL_MS = 30_000
const DEFAULT_GAS = 30_000_000_000_000n

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ----- Bytes -----------------------------------------------------------------------------------

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function base58Encode(bytes) {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  let n = 0n
  for (const byte of bytes) n = (n << 8n) | BigInt(byte)
  let out = ''
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out
    n /= 58n
  }
  return '1'.repeat(zeros) + out
}

export function base58Decode(text) {
  let n = 0n
  for (const char of text) {
    const digit = BASE58.indexOf(char)
    if (digit < 0) throw new Error('That is not base58 text.')
    n = n * 58n + BigInt(digit)
  }
  let zeros = 0
  while (zeros < text.length && text[zeros] === '1') zeros++
  const tail = []
  while (n > 0n) {
    tail.push(Number(n & 0xffn))
    n >>= 8n
  }
  const bytes = new Uint8Array(zeros + tail.length)
  for (let i = 0; i < tail.length; i++) bytes[bytes.length - 1 - i] = tail[i]
  return bytes
}

function toBase64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64()
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(text) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(text)
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toHex(bytes) {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** Lowercase hex SHA-256 of a piece of text. */
export function sha256Hex(text) {
  return toHex(sha256(encoder.encode(String(text))))
}

/** `count` random bytes as lowercase hex. */
export function randomHex(count = 16) {
  return toHex(crypto.getRandomValues(new Uint8Array(count)))
}

// ----- JSON-RPC with rotation ------------------------------------------------------------------
//
// What the public testnet nodes were seen to do (November 2026). All of it is per address,
// so every tab and tool on one connection shares it:
//   - FastNEAR's two hosts share one rate limit. Under a request a second they were never
//     seen to refuse; a dozen or two requests within a few seconds and they answer 429 for a
//     while. That 429 has no CORS header, so a browser reports a failed request, not a 429.
//     Hence a failed request rests the whole provider.
//   - dRPC's free plan drops any request after two seconds. A send that takes longer comes
//     back as a timeout although the transaction is on its way: its result is then read with
//     `tx`, never by sending again. It also has a rate limit of its own, and now and then
//     answers "Temporary internal error. Please retry".

/** What went wrong with one request to one node. `elsewhere` means another node may do better. */
export class RpcError extends Error {
  constructor(message, fields = {}) {
    super(message)
    this.name = 'RpcError'
    this.kind = 'rpc' // 'network' (no answer), 'http' (the node is busy or broken), 'rpc' (the node answered no)
    this.status = 0
    this.code = null
    this.cause = null // NEAR's name for it, such as UNKNOWN_ACCOUNT
    this.info = null
    this.data = null
    this.elsewhere = false
    this.rest = false
    this.timeout = false // the node gave up waiting; what was asked may still happen
    this.limited = false // the node turned the request away: too many
    this.unreachable = false // set by rpc(): no node could be reached at all
    Object.assign(this, fields)
  }
}

/** Trouble with the node that was asked, not with the question. */
const NODE_TROUBLE = new Set([
  'TIMEOUT_ERROR',
  'NO_SYNCED_BLOCKS',
  'NOT_SYNCED_YET',
  'UNAVAILABLE_SHARD',
  'DOES_NOT_TRACK_SHARD',
  'INTERNAL_ERROR',
  'UNKNOWN_BLOCK',
  'GARBAGE_COLLECTED_BLOCK',
])
const NODE_NEEDS_REST = new Set(['NO_SYNCED_BLOCKS', 'NOT_SYNCED_YET', 'UNAVAILABLE_SHARD', 'DOES_NOT_TRACK_SHARD', 'INTERNAL_ERROR'])

const resting = new Map() // node url → { until, limited }: left alone until then; `limited` if it said "too many requests"
let requestId = 0

function providerOf(url) {
  try {
    return new URL(url).hostname.split('.').slice(-2).join('.')
  } catch {
    return url
  }
}

const wakes = (url) => (resting.has(url) ? resting.get(url).until : 0)

/** Nodes in the order to try them: as configured, resting ones last (the one that wakes soonest first). */
function nodeOrder() {
  const now = Date.now()
  const urls = [...CONFIG.rpc]
  const awake = urls.filter((url) => wakes(url) <= now)
  const asleep = urls.filter((url) => wakes(url) > now).sort((a, b) => wakes(a) - wakes(b))
  return awake.concat(asleep)
}

/**
 * The next node to try for a request, or null when there is none left worth asking.
 * A resting node is not asked: one that has just turned requests away would only do so
 * again, and every refused request counts against the allowance. Two exceptions:
 *   - on a second try (`again`), a node resting after a hiccup, not after a rate limit, is asked;
 *   - when every node is resting, the one that wakes soonest is asked, once.
 */
function nextNode(tried, again = false) {
  const now = Date.now()
  const order = nodeOrder().filter((candidate) => !tried.has(candidate))
  let url = order.find((candidate) => wakes(candidate) <= now) || null
  if (!url && again) url = order.find((candidate) => !resting.get(candidate).limited) || null
  if (!url && tried.size === 0) url = order[0] || null
  if (url) tried.add(url)
  return url
}

let pressedAt = 0 // when a node was last put to rest

/**
 * True for a while after a node has turned requests away or failed. The public nodes allow
 * only so many requests, so whatever can wait (routine polling) should wait while this is true.
 */
export function underPressure(windowMs = REST_MS) {
  return Date.now() - pressedAt < windowMs
}

/** Leaves a node alone for 20 seconds. `wide` rests every host of its provider: they share one rate limit. */
function rest(url, wide = false, limited = false) {
  const mark = { until: Date.now() + REST_MS, limited }
  pressedAt = Date.now()
  resting.set(url, mark)
  if (!wide) return
  const provider = providerOf(url)
  for (const other of CONFIG.rpc) {
    if (providerOf(other) === provider) resting.set(other, mark)
  }
}

/** Rests a node after a failure, as widely as the failure calls for. */
function restAfter(url, error) {
  if (error.rest) rest(url, error.kind !== 'rpc' || error.limited, error.limited)
}

/** Forgets which nodes are resting. For tests that change CONFIG.rpc. */
export function resetNodes() {
  resting.clear()
  pressedAt = 0
}

function rpcFailure(error, status) {
  const cause = error.cause && typeof error.cause === 'object' ? error.cause.name || null : null
  const words = String(error.message || '')
  const message = typeof error.data === 'string' && error.data ? error.data : words || 'The node refused the request.'
  // A node that gave up waiting: NEAR's own TIMEOUT_ERROR (HTTP 408), or a gateway's time limit.
  const timeout = cause === 'TIMEOUT_ERROR' || status === 408 || (!cause && /time(d)?[ -]?out/i.test(words))
  const limited = status === 429 || error.code === -429 || (!cause && /rate.?limit|too many/i.test(words))
  // A gateway's own hiccup, such as dRPC's "Temporary internal error. Please retry": worth asking
  // again, here or elsewhere, and no reason to leave the node alone.
  const passing = !cause && !timeout && !limited && error.code !== -32601 && /temporar|retry|try again/i.test(words)
  const broken = !timeout && !limited && !passing && (status >= 500 || (!cause && error.code !== -32601 && /capacity|overload|unavailable/i.test(words)))
  return new RpcError(message, {
    kind: 'rpc',
    status,
    code: error.code ?? null,
    cause,
    info: (error.cause && error.cause.info) || null,
    data: error.data ?? null,
    timeout,
    limited,
    elsewhere: timeout || limited || passing || broken || NODE_TROUBLE.has(cause),
    rest: limited || broken || NODE_NEEDS_REST.has(cause),
  })
}

let watcher = null

/**
 * For tests and for finding out what a node is doing: `fn({ url, method, ms, status, problem })`
 * runs after every request to a node. `problem` is null when the node answered with a result.
 */
export function watchRpc(fn) {
  watcher = typeof fn === 'function' ? fn : null
}

/** One request to one node. Resolves with `result`, or throws an RpcError. */
async function rpcOn(url, method, params, timeout) {
  const started = Date.now()
  let status = 0
  const tell = (problem) => {
    if (!watcher) return
    try {
      watcher({ url, method, ms: Date.now() - started, status, problem })
    } catch {
      // A watcher must not break a request.
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  let text = ''
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      signal: controller.signal,
    })
    status = response.status
    text = await response.text()
  } catch (error) {
    tell(controller.signal.aborted ? `no answer in ${timeout} ms` : `no answer: ${(error && error.message) || 'the request failed'}`)
    throw new RpcError(`No answer from ${url}.`, { kind: 'network', elsewhere: true, rest: true })
  } finally {
    clearTimeout(timer)
  }
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    // Not JSON: a gateway page or an empty reply.
  }
  if (body && typeof body === 'object' && body.error) {
    const failure = rpcFailure(body.error, status)
    tell(failure.limited ? 'rate limit' : failure.timeout ? 'timeout' : failure.cause || `error ${failure.code}: ${failure.message}`.slice(0, 120))
    throw failure
  }
  if (!body || typeof body !== 'object' || !('result' in body)) {
    tell(`no result: ${text.slice(0, 80)}`)
    throw new RpcError(`${url} answered ${status} with no result.`, { kind: 'http', status, elsewhere: true, rest: true, limited: status === 429 })
  }
  tell(null)
  return body.result
}

/** One pass over the nodes. Resolves with the first result, or throws the last failure. */
async function rpcPass(method, params, timeout, again = false) {
  const tried = new Set()
  let last = null
  let reached = false
  for (;;) {
    // Asked afresh each time: a failure may just have put this node's siblings to rest.
    const url = nextNode(tried, again)
    if (!url) break
    try {
      return await rpcOn(url, method, params, timeout)
    } catch (error) {
      last = error
      if (!(error instanceof RpcError) || !error.elsewhere) throw error
      if (error.kind !== 'network') reached = true
      restAfter(url, error)
    }
  }
  if (!last) last = new RpcError('No NEAR nodes are configured.', { kind: 'network', elsewhere: true })
  if (!reached) last.unreachable = true
  throw last
}

/**
 * One JSON-RPC request, tried on each node in turn until one answers.
 * A node that is unreachable, rate-limited or broken rests for 20 seconds.
 * If every node fails, the nodes are tried once more after a moment: rate limits and
 * gateway timeouts pass quickly, and a request that could have worked should not be lost to one.
 */
export async function rpc(method, params, { timeout = VIEW_TIMEOUT_MS } = {}) {
  try {
    return await rpcPass(method, params, timeout)
  } catch (error) {
    if (!(error instanceof RpcError) || !error.elsewhere) throw error
  }
  await sleep(900)
  return rpcPass(method, params, timeout, true)
}

/** True when the failure was the network or the nodes, not an answer from the chain. */
export function isNetworkTrouble(error) {
  return error instanceof RpcError && (error.kind !== 'rpc' || error.elsewhere)
}

// ----- Reading -----------------------------------------------------------------------------------

// After one of our own calls runs, a view must answer from the block it ran in or a
// later one, or the page would show the world as it was before the call (the nodes sit
// behind load balancers, and one backend can be a block behind another). `floor` is
// the height to wait for. Learning it costs one request, so it is only looked up when
// a view actually follows a call within a few seconds.
const SETTLE_WINDOW_MS = 4_000
let floor = 0
let ranIn = [] // { hash, at }: blocks our own calls have just run in
let raising = null

function settle(blockHashes) {
  const at = Date.now()
  for (const hash of new Set(blockHashes.filter(Boolean))) ranIn.push({ hash, at })
  if (ranIn.length > 4) ranIn = ranIn.slice(-4)
}

/** The height of a block our call ran in, asked of the node that reads will go to. 0 when it cannot be learned. */
async function heightOf(hash) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = nodeOrder()[0]
    if (!url) return 0
    try {
      const block = await rpcOn(url, 'block', { block_id: hash }, 4_000)
      return Number(block && block.header && block.header.height) || 0
    } catch (error) {
      // A node that does not know the block yet is behind our call. That is the very thing
      // being guarded against: give it a moment and ask again. Anything else: do without.
      if (!(error instanceof RpcError) || error.cause !== 'UNKNOWN_BLOCK') {
        if (error instanceof RpcError) restAfter(url, error)
        return 0
      }
      await sleep(300)
    }
  }
  return 0
}

async function raiseFloor() {
  const due = ranIn.filter((run) => Date.now() - run.at < SETTLE_WINDOW_MS).slice(-2)
  ranIn = []
  const heights = await Promise.all(due.map((run) => heightOf(run.hash)))
  for (const height of heights) {
    if (height > floor) floor = height
  }
}

async function query(params) {
  if (ranIn.length && !raising) {
    raising = raiseFloor().finally(() => {
      raising = null
    })
  }
  if (raising) await raising
  let result = null
  for (let attempt = 0; ; attempt++) {
    result = await rpc('query', params)
    const height = Number(result && result.block_height) || 0
    if (!height || height >= floor || attempt >= 5) return result
    await sleep(250)
  }
}

/** Reads `Debug`-printed Rust text back into plain text. */
function unescapeRust(text) {
  return text.replace(/\\(n|t|r|"|'|\\)/g, (_, char) => ({ n: '\n', t: '\t', r: '\r' })[char] ?? char)
}

/**
 * A contract's panic text as a plain sentence: without the "Smart contract panicked:"
 * prefix, Rust's "panicked at" wrapper, or a source location.
 */
export function cleanPanic(text) {
  let message = String(text ?? '').trim()
  message = message.replace(/^Smart contract panicked:\s*/, '')
  let match = /^panicked at '([\s\S]*)',\s*[^\s',]+:\d+(?::\d+)?$/.exec(message)
  if (match) message = match[1]
  match = /^panicked at [^\s:]+:\d+:\d+:\s*([\s\S]*)$/.exec(message)
  if (match) message = match[1]
  message = message.replace(/,\s*[^\s,']+\.rs:\d+(?::\d+)?$/, '')
  return message.trim() || 'The contract refused that call.'
}

function viewFailure(text, contract, method) {
  if (/CodeDoesNotExist|NO_CONTRACT_CODE|UNKNOWN_ACCOUNT|does not exist while viewing/.test(text)) {
    return { code: 'no-contract', message: `There is no contract at ${contract} yet.` }
  }
  if (/MethodNotFound/.test(text)) {
    return { code: 'no-method', message: `The contract at ${contract} has no method called ${method}.` }
  }
  const panic = /panic_msg: "((?:[^"\\]|\\.)*)"/.exec(text)
  if (panic) return { code: 'panic', message: cleanPanic(unescapeRust(panic[1])) }
  return { code: 'failed', message: text.replace(/^wasm execution failed with error:\s*/, '') || 'The contract could not answer.' }
}

function plainError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

const OFFLINE = 'The NEAR network did not answer. Check your connection and try again.'
const UNCONFIRMED = 'The NEAR network took that but has not confirmed it yet. It may have gone through: give it a moment before trying again.'

/**
 * Calls a read-only method and returns its parsed JSON.
 * Throws an Error with a plain sentence; `error.code` is 'network', 'no-contract', 'no-method', 'panic' or 'failed'.
 */
export async function view(method, args = {}, contract = CONFIG.contract) {
  let result
  try {
    result = await query({
      request_type: 'call_function',
      finality: 'optimistic',
      account_id: contract,
      method_name: method,
      args_base64: toBase64(encoder.encode(JSON.stringify(args ?? {}))),
    })
  } catch (error) {
    if (isNetworkTrouble(error)) throw plainError(OFFLINE, 'network')
    const failure = viewFailure(`${error.cause || ''} ${error.message || ''}`, contract, method)
    throw plainError(failure.message, failure.code)
  }
  if (result && result.error) {
    const failure = viewFailure(String(result.error), contract, method)
    throw plainError(failure.message, failure.code)
  }
  const text = decoder.decode(Uint8Array.from((result && result.result) || []))
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** The account as the chain sees it, or null when there is no such account. */
async function viewAccount(accountId) {
  let result
  try {
    result = await query({ request_type: 'view_account', finality: 'optimistic', account_id: accountId })
  } catch (error) {
    if (error instanceof RpcError && (error.cause === 'UNKNOWN_ACCOUNT' || error.cause === 'INVALID_ACCOUNT')) return null
    if (isNetworkTrouble(error)) throw plainError(OFFLINE, 'network')
    throw plainError(error.message, 'failed')
  }
  if (result && result.error) {
    if (/does not exist/i.test(String(result.error))) return null
    throw plainError(String(result.error), 'failed')
  }
  return result
}

/** The account's own NEAR in yoctoNEAR (a string), or null when there is no such account. */
export async function accountBalance(accountId) {
  if (!isAccountId(accountId)) return null
  const account = await viewAccount(accountId)
  return account ? String(account.amount) : null
}

export async function accountExists(accountId) {
  if (!isAccountId(accountId)) return false
  return (await viewAccount(accountId)) !== null
}

/** True when the account has a contract on it. */
export async function contractDeployed(accountId = CONFIG.contract) {
  if (!isAccountId(accountId)) return false
  const account = await viewAccount(accountId)
  if (!account) return false
  const local = account.code_hash && account.code_hash !== '11111111111111111111111111111111'
  return Boolean(local || account.global_contract_hash || account.global_contract_account_id)
}

/**
 * One access key of an account: { nonce, permission }, or null when the key is not on the account.
 * `permission` is 'FullAccess' or { FunctionCall: { receiver_id, method_names, allowance } }.
 */
export async function accessKey(accountId, publicKey) {
  let result
  try {
    result = await query({ request_type: 'view_access_key', finality: 'optimistic', account_id: accountId, public_key: publicKey })
  } catch (error) {
    if (error instanceof RpcError && (error.cause === 'UNKNOWN_ACCESS_KEY' || error.cause === 'UNKNOWN_ACCOUNT')) return null
    if (isNetworkTrouble(error)) throw plainError(OFFLINE, 'network')
    throw plainError(error.message, 'failed')
  }
  if (result && result.error) {
    if (/does not exist/i.test(String(result.error))) return null
    throw plainError(String(result.error), 'failed')
  }
  return { nonce: BigInt(result.nonce), permission: result.permission }
}

/** True when `publicKey` is an access key of `accountId`. Throws only when the network cannot be reached. */
export async function hasKey(accountId, publicKey) {
  return (await accessKey(accountId, publicKey)) !== null
}

/** True when the key may call `method` on `receiver` (a full-access key may call anything). */
export function keyAllows(key, receiver, method = null) {
  if (!key) return false
  if (key.permission === 'FullAccess') return true
  const grant = key.permission && key.permission.FunctionCall
  if (!grant || grant.receiver_id !== receiver) return false
  const names = grant.method_names || []
  return names.length === 0 || method === null || names.includes(method)
}

// ----- Keys --------------------------------------------------------------------------------------

/** Reads NEAR's `ed25519:<base58>` secret key text: 64 bytes (seed then public key) or a 32-byte seed. */
function readSecretKey(secretKey) {
  const text = String(secretKey ?? '').trim()
  const colon = text.indexOf(':')
  const curve = colon < 0 ? 'ed25519' : text.slice(0, colon)
  if (curve !== 'ed25519') throw new Error('Only ed25519 keys can be used here.')
  let bytes
  try {
    bytes = base58Decode(text.slice(colon + 1))
  } catch {
    throw new Error('That secret key is not valid.')
  }
  if (bytes.length !== 64 && bytes.length !== 32) throw new Error('That secret key is not valid.')
  const seed = bytes.slice(0, 32)
  const publicKey = ed.getPublicKey(seed)
  if (bytes.length === 64 && !bytes.slice(32).every((byte, i) => byte === publicKey[i])) {
    throw new Error('That secret key is damaged.')
  }
  return { seed, publicKey }
}

/** The `ed25519:…` public key that goes with a secret key. */
export function publicKeyOf(secretKey) {
  return `ed25519:${base58Encode(readSecretKey(secretKey).publicKey)}`
}

/** A new key pair in NEAR's text form: { publicKey, secretKey }. */
export function generateKey() {
  const seed = crypto.getRandomValues(new Uint8Array(32))
  const publicKey = ed.getPublicKey(seed)
  const both = new Uint8Array(64)
  both.set(seed, 0)
  both.set(publicKey, 32)
  return { publicKey: `ed25519:${base58Encode(publicKey)}`, secretKey: `ed25519:${base58Encode(both)}` }
}

// ----- Building a transaction (borsh, by hand) -----------------------------------------------------

class Writer {
  constructor() {
    this.parts = []
    this.length = 0
  }
  bytes(bytes) {
    this.parts.push(bytes)
    this.length += bytes.length
    return this
  }
  u8(value) {
    return this.bytes(Uint8Array.of(value & 0xff))
  }
  u32(value) {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, value, true)
    return this.bytes(out)
  }
  u64(value) {
    const out = new Uint8Array(8)
    new DataView(out.buffer).setBigUint64(0, BigInt.asUintN(64, BigInt(value)), true)
    return this.bytes(out)
  }
  u128(value) {
    const big = BigInt.asUintN(128, BigInt(value))
    const out = new Uint8Array(16)
    const data = new DataView(out.buffer)
    data.setBigUint64(0, big & 0xffffffffffffffffn, true)
    data.setBigUint64(8, big >> 64n, true)
    return this.bytes(out)
  }
  string(text) {
    const bytes = encoder.encode(text)
    return this.u32(bytes.length).bytes(bytes)
  }
  done() {
    const out = new Uint8Array(this.length)
    let offset = 0
    for (const part of this.parts) {
      out.set(part, offset)
      offset += part.length
    }
    return out
  }
}

const KEY_ED25519 = 0
const ACTION_FUNCTION_CALL = 2

/** A NEAR transaction with one FunctionCall action, borsh-serialised. */
function buildTransaction({ signerId, publicKey, nonce, receiverId, blockHash, methodName, args, gas, deposit }) {
  return new Writer()
    .string(signerId)
    .u8(KEY_ED25519)
    .bytes(publicKey)
    .u64(nonce)
    .string(receiverId)
    .bytes(blockHash)
    .u32(1) // one action
    .u8(ACTION_FUNCTION_CALL)
    .string(methodName)
    .u32(args.length)
    .bytes(args)
    .u64(gas)
    .u128(deposit)
    .done()
}

function signTransaction(body, seed) {
  const hash = sha256(body)
  const signature = ed.sign(hash, seed)
  const signed = new Uint8Array(body.length + 1 + signature.length)
  signed.set(body, 0)
  signed[body.length] = KEY_ED25519
  signed.set(signature, body.length + 1)
  return { base64: toBase64(signed), hash: base58Encode(hash) }
}

let recentBlock = null // { hash: Uint8Array(32), at: ms }

/** The hash of a final block, at most half a minute old. A transaction names one to prove it is fresh. */
async function recentBlockHash() {
  if (recentBlock && Date.now() - recentBlock.at < BLOCK_HASH_TTL_MS) return recentBlock.hash
  const block = await rpc('block', { finality: 'final' })
  const hash = base58Decode(block.header.hash)
  if (hash.length !== 32) throw new RpcError('The node sent a block hash of the wrong size.', { kind: 'http', elsewhere: true })
  recentBlock = { hash, at: Date.now() }
  return hash
}

// ----- Sending -------------------------------------------------------------------------------------

/** Digs the chain's reason for refusing a transaction out of an error or a failure. */
function invalidTxOf(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return null
  if ('InvalidTxError' in value) return value.InvalidTxError
  for (const key of Object.keys(value)) {
    const found = invalidTxOf(value[key], depth + 1)
    if (found) return found
  }
  return null
}

function invalidTxSentence(reason) {
  if (reason === 'Expired' || reason === 'InvalidChain') {
    return { code: 'refused', message: 'That call took too long to reach the chain. Try again.' }
  }
  if (reason && typeof reason === 'object') {
    if (reason.InvalidNonce || reason.NonceTooLarge) {
      return { code: 'refused', message: 'The key on this device fell out of step with the chain. Try again.' }
    }
    if (reason.NotEnoughBalance) {
      return { code: 'no-gas', message: 'Your NEAR account does not hold enough NEAR to pay for gas.' }
    }
    if (reason.LackBalanceForState) {
      return { code: 'no-gas', message: 'Your NEAR account needs more NEAR to cover its storage.' }
    }
    if (reason.SignerDoesNotExist || reason.InvalidSignerId) {
      return { code: 'key-gone', message: 'That NEAR account does not exist.' }
    }
    if (reason.ShardCongested || reason.ShardStuck) {
      return { code: 'busy', message: 'The network is busy right now. Try again in a moment.' }
    }
    const key = reason.InvalidAccessKeyError
    if (key === 'DepositWithFunctionCall' || key === 'RequiresFullAccess') {
      return { code: 'refused', message: 'The key on this device cannot attach NEAR. That takes your wallet.' }
    }
    if (key && typeof key === 'object') {
      if (key.AccessKeyNotFound) {
        return { code: 'key-gone', message: 'The key on this device is no longer on your account. Connect your wallet again.' }
      }
      if (key.NotEnoughAllowance) {
        return { code: 'allowance', message: 'The key on this device has used up its gas allowance. Connect your wallet again to renew it.' }
      }
      if (key.ReceiverMismatch || key.MethodNameMismatch) {
        return { code: 'refused', message: 'The key on this device is not allowed to make that call.' }
      }
    }
  }
  return { code: 'refused', message: 'The chain refused that call.' }
}

/** A failed call's reason as a plain sentence. */
function failureSentence(failure) {
  const action = failure && failure.ActionError
  const kind = action && action.kind
  if (kind && typeof kind === 'object') {
    const call = kind.FunctionCallError
    if (call && typeof call === 'object') {
      if (typeof call.ExecutionError === 'string') {
        if (/^Exceeded the (prepaid gas|maximum amount of gas)/.test(call.ExecutionError)) {
          return { code: 'gas', message: 'The call ran out of gas.' }
        }
        return { code: 'panic', message: cleanPanic(call.ExecutionError) }
      }
      const host = call.HostError
      if (host && typeof host === 'object' && host.GuestPanic) {
        return { code: 'panic', message: cleanPanic(host.GuestPanic.panic_msg) }
      }
      if (host === 'GasExceeded' || host === 'GasLimitExceeded') return { code: 'gas', message: 'The call ran out of gas.' }
      if (call.MethodResolveError) return { code: 'no-method', message: 'The contract has no such method.' }
      const compile = call.CompilationError
      if (compile && typeof compile === 'object' && compile.CodeDoesNotExist) {
        return { code: 'no-contract', message: `There is no contract at ${compile.CodeDoesNotExist.account_id}.` }
      }
      return { code: 'failed', message: 'The contract could not run that call.' }
    }
    if (kind.AccountDoesNotExist) {
      return { code: 'no-account', message: `The account ${kind.AccountDoesNotExist.account_id} does not exist.` }
    }
    if (kind.LackBalanceForState) {
      return { code: 'no-gas', message: 'The account needs more NEAR to cover its storage.' }
    }
    return { code: 'failed', message: `The call failed (${Object.keys(kind)[0] || 'unknown reason'}).` }
  }
  const refused = invalidTxOf(failure)
  if (refused) return invalidTxSentence(refused)
  return { code: 'failed', message: 'The call failed.' }
}

/** Asks one node to run signed bytes and wait for the result. */
async function sendOn(url, base64) {
  try {
    return await rpcOn(url, 'send_tx', { signed_tx_base64: base64, wait_until: 'EXECUTED_OPTIMISTIC' }, SEND_TIMEOUT_MS)
  } catch (error) {
    // A node that does not know `send_tx` gets the older call with the same bytes.
    if (error instanceof RpcError && error.kind === 'rpc' && error.code === -32601) {
      return rpcOn(url, 'broadcast_tx_commit', [base64], SEND_TIMEOUT_MS)
    }
    throw error
  }
}

function finished(result) {
  const status = result && result.status
  return Boolean(status && typeof status === 'object' && ('SuccessValue' in status || 'Failure' in status))
}

/**
 * Waits for a transaction that is already on its way. Resolves with its result, or null
 * when the time runs out or no node can be reached at all.
 */
async function awaitOutcome(hash, senderId, budgetMs, firstUrl = null) {
  const deadline = Date.now() + budgetMs
  const params = { tx_hash: hash, sender_account_id: senderId, wait_until: 'EXECUTED_OPTIMISTIC' }
  let unreachable = 0
  for (let round = 0; ; round++) {
    try {
      const timeout = Math.max(2_000, Math.min(15_000, deadline - Date.now()))
      // The node that refused the bytes is the one that knows why: ask it first.
      const result = round === 0 && firstUrl ? await rpcOn(firstUrl, 'tx', params, timeout) : await rpc('tx', params, { timeout })
      if (finished(result)) return result
      unreachable = 0
    } catch (error) {
      // UNKNOWN_TRANSACTION (not seen yet) and a timeout (seen, still running) both mean: ask again.
      // Only when no node at all can be reached is there no point in waiting.
      const cutOff = error instanceof RpcError && (error.unreachable || (round === 0 && Boolean(firstUrl) && error.kind === 'network'))
      unreachable = cutOff ? unreachable + 1 : 0
      if (unreachable >= 3) return null
    }
    if (Date.now() + 1_200 >= deadline) return null
    await sleep(1_200)
  }
}

/**
 * Offers signed bytes to the nodes, one at a time, until one runs them.
 * The bytes are never changed, so however many nodes see them the call happens once.
 * Resolves with { result }, { refusal } (the chain would not take them) or { lost }.
 */
async function broadcast(signed, senderId) {
  let offered = false // the bytes may be on their way already
  let last = null
  // Two rounds at most, and always the same bytes: a second offer can never make a second call.
  for (let round = 0; round < 2; round++) {
    let taken = false // a node took the bytes and is waiting for them to run
    let refusal = null
    let refusedBy = null
    const tried = new Set()
    for (;;) {
      const url = nextNode(tried, round > 0)
      if (!url) break
      try {
        const result = await sendOn(url, signed.base64)
        if (finished(result)) return { result }
        taken = true
        break
      } catch (error) {
        last = error
        if (!(error instanceof RpcError)) continue
        if (error.kind !== 'rpc') {
          // No answer, or a gateway's error page. The bytes may have got through all the same:
          // a browser cannot tell a rate limit (when they surely did not) from a lost answer.
          restAfter(url, error)
          if (!error.limited) offered = true
          continue
        }
        if (error.timeout) {
          // The node took the bytes and gave up waiting for them to run.
          taken = true
          break
        }
        if (error.elsewhere && !invalidTxOf(error.data)) {
          restAfter(url, error)
          if (!error.limited) offered = true
          continue
        }
        refusal = error
        refusedBy = url
        break
      }
    }
    if (refusal) {
      if (offered) {
        // An earlier node may have taken the bytes even though it never said so: a refusal such
        // as "nonce already used" is then the sign that they went through.
        const result = await awaitOutcome(signed.hash, senderId, 30_000, refusedBy)
        if (result) return { result }
        // Nobody can say what became of them. After a node took them, "nonce already used" means
        // they most likely ran: signing the call again would make it happen twice (a second move,
        // a second purchase). It is reported as unconfirmed, and the caller looks at the chain.
        const reason = invalidTxOf(refusal.data) ?? invalidTxOf(refusal.info)
        if (reason && typeof reason === 'object' && reason.InvalidNonce) return { lost: refusal, offered: true }
      }
      return { refusal }
    }
    if (taken) {
      offered = true
      const result = await awaitOutcome(signed.hash, senderId, 45_000)
      if (result) return { result }
      break
    }
    if (offered) {
      // Nobody confirmed the bytes. Look for them before offering them again.
      const result = await awaitOutcome(signed.hash, senderId, round === 0 ? 5_000 : 30_000)
      if (result) return { result }
    } else if (round === 0) {
      // Every node turned the request away before taking it. That passes quickly.
      await sleep(900)
    }
  }
  return { lost: last, offered }
}

/**
 * Signs and sends function calls for one account with one key, with no wallet.
 *
 * Calls are sent one at a time so their nonces stay in order. The nonce is read
 * from the chain once and counted up here. A call is signed once: if a node does
 * not answer, the same signed bytes go to the next node, so a move cannot happen twice.
 */
export class Signer {
  #seed
  #publicKeyBytes
  #nonce = null
  #queue = Promise.resolve()

  constructor(accountId, secretKey) {
    const { seed, publicKey } = readSecretKey(secretKey)
    this.accountId = accountId
    this.#seed = seed
    this.#publicKeyBytes = publicKey
    this.publicKey = `ed25519:${base58Encode(publicKey)}`
  }

  /**
   * Calls `method` on `receiver`. Never throws.
   * Resolves with { ok, value, error, hash, gasBurnt } plus:
   *   tokensBurnt (yoctoNEAR string), logs, failure (the chain's own failure object),
   *   included (the chain ran it), unknown (sent, but no node confirmed it), code (a short machine word).
   * `value` is the parsed JSON return value. `error` is a plain sentence, or null.
   */
  call(receiver, method, args = {}, { gas = DEFAULT_GAS, deposit = 0n } = {}) {
    const run = () =>
      this.#send(receiver, method, args, BigInt(gas), BigInt(deposit)).catch((error) =>
        failed(error && error.message ? error.message : 'That call could not be sent.', 'failed'),
      )
    const result = this.#queue.then(run, run)
    this.#queue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  async #sign(receiver, method, argBytes, gas, deposit) {
    if (this.#nonce === null) {
      let key = await accessKey(this.accountId, this.publicKey)
      if (!key) {
        // A key added a moment ago may not have reached the backend that answered. Look once more
        // before telling the player it is gone.
        await sleep(900)
        key = await accessKey(this.accountId, this.publicKey)
      }
      if (!key) throw plainError('The key on this device is no longer on your account. Connect your wallet again.', 'key-gone')
      this.#nonce = key.nonce
    }
    const blockHash = await recentBlockHash()
    this.#nonce += 1n
    const body = buildTransaction({
      signerId: this.accountId,
      publicKey: this.#publicKeyBytes,
      nonce: this.#nonce,
      receiverId: receiver,
      blockHash,
      methodName: method,
      args: argBytes,
      gas,
      deposit,
    })
    return signTransaction(body, this.#seed)
  }

  async #send(receiver, method, args, gas, deposit) {
    const argBytes = args instanceof Uint8Array ? args : encoder.encode(JSON.stringify(args ?? {}))
    let signedAgain = false
    for (;;) {
      let signed
      try {
        signed = await this.#sign(receiver, method, argBytes, gas, deposit)
      } catch (error) {
        if (error instanceof RpcError) return failed(OFFLINE, 'network')
        return failed(error.message, error.code || 'failed')
      }
      const sent = await broadcast(signed, this.accountId)
      if (sent.result) return outcomeOf(sent.result, signed.hash)
      if (sent.refusal) {
        const reason = invalidTxOf(sent.refusal.data) ?? invalidTxOf(sent.refusal.info)
        const stale = reason === 'Expired' || reason === 'InvalidChain'
        const outOfStep = reason && typeof reason === 'object' && (reason.InvalidNonce || reason.NonceTooLarge)
        // The chain refused these bytes without running them, so signing again is safe. Once.
        this.#nonce = null
        if (stale) recentBlock = null
        if ((stale || outOfStep) && !signedAgain) {
          signedAgain = true
          continue
        }
        const sentence = reason ? invalidTxSentence(reason) : { code: 'refused', message: sent.refusal.message || 'The chain refused that call.' }
        return failed(sentence.message, sentence.code, { hash: signed.hash })
      }
      // Sent, but nobody confirmed it: it may well have gone through, so the player is told to look before trying again.
      if (sent.offered) return failed(UNCONFIRMED, 'network', { hash: signed.hash, unknown: true })
      return failed(OFFLINE, 'network', { hash: signed.hash, unknown: false })
    }
  }
}

function failed(message, code, extra = {}) {
  return {
    ok: false,
    value: null,
    error: message,
    hash: null,
    gasBurnt: 0,
    tokensBurnt: '0',
    logs: [],
    failure: null,
    included: false,
    unknown: false,
    code,
    ...extra,
  }
}

/**
 * Reads a transaction outcome that came from somewhere else (a wallet) into the shape
 * Signer.call gives. A wallet that hands back nothing readable is taken at its word:
 * ok, with `unknown` set and no value.
 */
export function readOutcome(outcome) {
  const result = Array.isArray(outcome) ? outcome[0] : outcome
  const hash =
    (result && result.transaction && result.transaction.hash) || (result && result.transaction_outcome && result.transaction_outcome.id) || null
  if (!finished(result)) return { ...failed(null, null, { hash }), ok: true, unknown: true }
  return outcomeOf(result, hash)
}

function outcomeOf(result, hash) {
  const outcomes = [result.transaction_outcome, ...(result.receipts_outcome || [])].filter((entry) => entry && entry.outcome)
  let gasBurnt = 0n
  let tokensBurnt = 0n
  const logs = []
  for (const { outcome } of outcomes) {
    gasBurnt += BigInt(outcome.gas_burnt || 0)
    tokensBurnt += BigInt(outcome.tokens_burnt || 0)
    if (Array.isArray(outcome.logs)) logs.push(...outcome.logs)
  }
  settle((result.receipts_outcome || []).map((entry) => entry && entry.block_hash))
  const base = {
    hash,
    gasBurnt: Number(gasBurnt),
    tokensBurnt: tokensBurnt.toString(),
    logs,
    included: true,
    unknown: false,
  }
  const status = result.status
  if ('SuccessValue' in status) {
    let value = null
    const text = status.SuccessValue ? decoder.decode(fromBase64(status.SuccessValue)) : ''
    if (text) {
      try {
        value = JSON.parse(text)
      } catch {
        value = text
      }
    }
    return { ok: true, value, error: null, failure: null, code: null, ...base }
  }
  const sentence = failureSentence(status.Failure)
  return { ok: false, value: null, error: sentence.message, failure: status.Failure, code: sentence.code, ...base }
}
