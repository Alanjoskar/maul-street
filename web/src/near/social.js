// NEAR Social on testnet, by the near.social standard `social-kv/1`
// (https://api2.near.social/standard.md).
//
// Writing: a function call `__fastdata_kv` to the account `social`, signed by the
// player's own account with a key that can do nothing else. There is no contract
// at `social`, so the chain reports every such call as failed. That is how the
// standard works: FastData indexes the call's arguments whatever its result. A
// write is confirmed by reading the key back.
//
// Reading: the public FastData KV API. The near.social indexer (api2.near.social)
// covers mainnet only, so on testnet the feed, mentions and followers are worked
// out here from the raw keys.

import { CONFIG, isAccountId } from './config.js'

/** The smallest gas a function call may carry. The call does no work, and testnet accepts it. */
export const SOCIAL_GAS = 1n

const KV_TIMEOUT_MS = 10_000
const PAGE = 200
const PROFILE_TTL_MS = 60_000
const FEED_SCAN = 400 // how many recent post writes to look through
const FEED_KEEP = 60
const EDGE_CAP = 2_000
const CONFIRM_MS = 10_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const receiver = () => encodeURIComponent(CONFIG.socialReceiver)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const chars = (text) => [...text].length

// ----- The KV API --------------------------------------------------------------------------------

/** One request. Resolves with the parsed answer, or null when the API cannot be reached. */
async function kv(path, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), KV_TIMEOUT_MS)
  try {
    const response = await fetch(CONFIG.kv + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const data = await response.json()
    return data && Array.isArray(data.entries) ? data : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Follows page tokens up to `cap` entries. Null when the API cannot be reached. */
async function pages(path, body, cap) {
  const entries = []
  let token = null
  do {
    const data = await kv(path, { ...body, limit: Math.min(PAGE, cap - entries.length), ...(token ? { page_token: token } : {}) })
    if (!data) return entries.length ? entries : null
    entries.push(...data.entries)
    token = data.page_token || null
  } while (token && entries.length < cap)
  return entries
}

// ----- Text: mentions and hashtags, by the standard's rules (section 5) -----------------------------

/** Blanks out URLs, so that nothing inside one is read as a mention or a hashtag. */
function withoutUrls(text) {
  return text.replace(/https?:\/\/[^\s<>"]+/g, (found) => {
    const url = found.replace(/[.,:;!?'")\]}]+$/, '')
    return ' '.repeat(url.length) + found.slice(url.length)
  })
}

/** Account ids mentioned in a text as @name, in order, without repeats. */
export function mentionsIn(text) {
  const found = []
  for (const match of withoutUrls(String(text ?? '')).matchAll(/(?:^|[^A-Za-z0-9_@.])@([a-z0-9][a-z0-9._-]{0,63})/g)) {
    const name = match[1].replace(/[._-]+$/, '')
    if (isAccountId(name) && !found.includes(name)) found.push(name)
  }
  return found
}

/** Hashtags in a text, lowercase, without the #, in order, without repeats. */
export function hashtagsIn(text) {
  const found = []
  for (const match of withoutUrls(String(text ?? '')).matchAll(/(?:^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]{1,64})/gu)) {
    if (!/\p{L}/u.test(match[1])) continue
    const tag = match[1].toLowerCase()
    if (!found.includes(tag)) found.push(tag)
  }
  return found
}

// ----- What counts as a post (section 3.2) -----------------------------------------------------------

const POST_ID = /^[1-9][0-9]{0,15}$/
const MEDIA_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/avif'])

function isPostId(id) {
  return POST_ID.test(id) && Number(id) <= Number.MAX_SAFE_INTEGER
}

function isPostRef(value) {
  if (typeof value !== 'string') return false
  const slash = value.lastIndexOf('/')
  return slash > 0 && isAccountId(value.slice(0, slash)) && isPostId(value.slice(slash + 1))
}

function isMediaUri(value) {
  if (typeof value !== 'string') return false
  const match = /^fastfs:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(value)
  if (!match || !isAccountId(match[1]) || !isAccountId(match[2])) return false
  const path = match[3]
  return /^[A-Za-z0-9._\-/]{1,1024}$/.test(path) && !path.startsWith('/') && !path.includes('..')
}

function isMedia(item) {
  if (!isObject(item) || !isMediaUri(item.src) || !MEDIA_TYPES.has(item.mime)) return false
  for (const side of ['w', 'h']) {
    if (side in item && !(Number.isInteger(item[side]) && item[side] >= 1 && item[side] <= 16384)) return false
  }
  return !('alt' in item) || (typeof item.alt === 'string' && chars(item.alt) <= 5_000)
}

/** The post's text when `value` is a valid post by `author` under `id`, otherwise null. */
function postText(value, author, id) {
  if (!isObject(value)) return null
  const text = 'text' in value ? value.text : ''
  if (typeof text !== 'string' || chars(text) > 25_000) return null
  const media = 'media' in value ? value.media : []
  if (!Array.isArray(media) || media.length > 10 || !media.every(isMedia)) return null
  for (const field of ['reply_to', 'root', 'quote']) {
    if (field in value && !isPostRef(value[field])) return null
  }
  if (value.reply_to === `${author}/${id}`) return null
  if (!text.trim() && media.length === 0 && !('quote' in value)) return null
  return text
}

// ----- Profiles --------------------------------------------------------------------------------------

const profiles = new Map() // account id → { at, profile }

function field(value, max) {
  return typeof value === 'string' && chars(value) <= max ? value : ''
}

/**
 * Profiles of several accounts in one go: Map(account id → { accountId, name, about }).
 * Kept for a minute. An account with no profile, or an unreachable API, gives empty text.
 */
export async function readProfiles(accountIds, { fresh = false } = {}) {
  const wanted = [...new Set(accountIds)].filter(isAccountId)
  const now = Date.now()
  const missing = wanted.filter((id) => fresh || !profiles.has(id) || now - profiles.get(id).at > PROFILE_TTL_MS)
  // Two keys per account, and the API takes 100 keys a request.
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50)
    const keys = batch.flatMap((id) => [`${CONFIG.socialReceiver}/${id}/profile/name`, `${CONFIG.socialReceiver}/${id}/profile/about`])
    const data = await kv('/v0/multi', { keys })
    if (!data || data.entries.length !== keys.length) continue
    batch.forEach((id, index) => {
      const name = data.entries[index * 2]
      const about = data.entries[index * 2 + 1]
      profiles.set(id, {
        at: Date.now(),
        profile: { accountId: id, name: field(name && name.value, 256), about: field(about && about.value, 10_000) },
      })
    })
  }
  const out = new Map()
  for (const id of wanted) out.set(id, profiles.has(id) ? profiles.get(id).profile : { accountId: id, name: '', about: '' })
  return out
}

let gathering = null // lookups asked for in the same moment: { ids, done }

/**
 * One account's profile: { accountId, name, about }.
 * Lookups made in the same moment (a leaderboard's worth of names) share one request.
 */
export function readProfile(accountId, { fresh = false } = {}) {
  const none = { accountId, name: '', about: '' }
  if (!isAccountId(accountId)) return Promise.resolve(none)
  if (fresh) return readProfiles([accountId], { fresh: true }).then((found) => found.get(accountId) || none)
  const known = profiles.get(accountId)
  if (known && Date.now() - known.at <= PROFILE_TTL_MS) return Promise.resolve(known.profile)
  if (!gathering) {
    const ids = new Set()
    const done = sleep(25).then(() => {
      gathering = null
      return readProfiles([...ids])
    })
    gathering = { ids, done }
  }
  gathering.ids.add(accountId)
  return gathering.done.then((found) => found.get(accountId) || none)
}

function rememberProfile(accountId, changes) {
  const known = profiles.has(accountId) ? profiles.get(accountId).profile : { accountId, name: '', about: '' }
  profiles.set(accountId, { at: Date.now(), profile: { ...known, ...changes } })
}

// ----- The graph -----------------------------------------------------------------------------------------

/** Accounts that `accountId` follows. Null when the API cannot be reached. */
export async function readFollowing(accountId) {
  if (!isAccountId(accountId)) return []
  const entries = await pages(`/v0/latest/${receiver()}/${encodeURIComponent(accountId)}`, { key_prefix: 'graph/follow/' }, EDGE_CAP)
  if (!entries) return null
  const out = []
  for (const entry of entries) {
    const target = String(entry.key).slice('graph/follow/'.length)
    // An edge is live only while its latest value is a JSON object. null takes it away.
    if (isObject(entry.value) && isAccountId(target) && target !== accountId && !out.includes(target)) out.push(target)
  }
  return out
}

/** Accounts that follow `accountId`. Null when the API cannot be reached. */
export async function readFollowers(accountId) {
  if (!isAccountId(accountId)) return []
  const entries = await pages(`/v0/latest/${receiver()}`, { key: `graph/follow/${accountId}` }, EDGE_CAP)
  if (!entries) return null
  const out = []
  for (const entry of entries) {
    const follower = entry.predecessor_id
    if (isObject(entry.value) && isAccountId(follower) && follower !== accountId && !out.includes(follower)) out.push(follower)
  }
  return out
}

// ----- The feed ------------------------------------------------------------------------------------------

/**
 * Recent posts tagged with the game's hashtag, newest first: [{ author, id, text, ts, name }].
 * `ts` is the block time in Unix seconds; `name` is the author's profile name ('' when unset).
 * Null when the API cannot be reached.
 *
 * The API lists a receiver's keys in key order, and the newest post ids sort last, so this reads
 * the write history of `post/` keys from the top (highest ids first) instead of the latest values
 * from the bottom. The first write met for a post is its latest, which is what decides if it is live.
 */
export async function readFeed({ scan = FEED_SCAN, keep = FEED_KEEP } = {}) {
  const writes = await pages(`/v0/history/${receiver()}`, { key_prefix: 'post/' }, scan)
  if (!writes) return null
  const seen = new Set()
  const posts = []
  for (const write of writes) {
    const author = write.predecessor_id
    const id = String(write.key).slice('post/'.length)
    const ref = `${author}/${id}`
    if (seen.has(ref)) continue
    seen.add(ref)
    if (!isAccountId(author) || !isPostId(id)) continue
    const text = postText(write.value, author, id)
    if (text === null || !hashtagsIn(text).includes(CONFIG.hashtag)) continue
    posts.push({ author, id, text, ts: Math.floor(Number(write.block_timestamp) / 1e9), name: '', height: Number(write.block_height) || 0 })
  }
  posts.sort((a, b) => b.ts - a.ts || b.height - a.height || Number(b.id) - Number(a.id))
  const kept = posts.slice(0, keep)
  const names = await readProfiles(kept.map((post) => post.author))
  return kept.map(({ height, ...post }) => ({ ...post, name: names.get(post.author)?.name || '' }))
}

/**
 * One account's own posts, newest first, tagged or not: [{ author, id, text, ts, name }].
 * Null when the API cannot be reached.
 */
export async function readPosts(accountId, { scan = 100 } = {}) {
  if (!isAccountId(accountId)) return []
  const writes = await pages(`/v0/history/${receiver()}/${encodeURIComponent(accountId)}`, { key_prefix: 'post/' }, scan)
  if (!writes) return null
  const seen = new Set()
  const posts = []
  for (const write of writes) {
    const id = String(write.key).slice('post/'.length)
    if (seen.has(id)) continue
    seen.add(id)
    if (!isPostId(id)) continue
    const text = postText(write.value, accountId, id)
    if (text === null) continue
    posts.push({ author: accountId, id, text, ts: Math.floor(Number(write.block_timestamp) / 1e9), name: '' })
  }
  posts.sort((a, b) => b.ts - a.ts || Number(b.id) - Number(a.id))
  const name = (await readProfile(accountId)).name
  return posts.map((post) => ({ ...post, name }))
}

/** The posts of a feed that mention `accountId` as @name. */
export function mentionsOf(feed, accountId) {
  if (!accountId) return []
  return (feed || []).filter((post) => post.author !== accountId && mentionsIn(post.text).includes(accountId))
}

// ----- Writing -------------------------------------------------------------------------------------------

async function latestWrite(accountId, key) {
  const data = await kv(`/v0/latest/${receiver()}/${encodeURIComponent(accountId)}`, { key, include_metadata: true, limit: 1 })
  return data ? data.entries[0] || null : undefined
}

/** Waits until the KV API shows the write made by transaction `hash`. */
async function confirmWrite(accountId, key, value, hash) {
  const expected = JSON.stringify(value)
  const deadline = Date.now() + CONFIRM_MS
  for (;;) {
    const entry = await latestWrite(accountId, key)
    if (entry) {
      if (entry.tx_hash ? entry.tx_hash === hash : JSON.stringify(entry.value) === expected) return true
    }
    if (Date.now() + 700 >= deadline) break
    await sleep(700)
  }
  // A later write to the same key may have overtaken this one. The history still has it.
  const history = await kv(`/v0/history/${receiver()}/${encodeURIComponent(accountId)}`, { key, include_metadata: true, limit: 10 })
  return Boolean(history && history.entries.some((entry) => entry.tx_hash === hash))
}

/**
 * Writes keys under the signer's account. `entries` is { key: value }, at most 256 keys.
 * Resolves with { hash, gasBurnt, tokensBurnt, confirmed }. Throws a plain sentence when the
 * chain would not take the call. `confirmed` is false when the chain took it but the KV API
 * had not shown it within ten seconds.
 */
export async function write(signer, entries) {
  const keys = Object.keys(entries || {})
  if (!signer) throw new Error('Turn on NEAR Social first.')
  if (keys.length === 0 || keys.length > 256) throw new Error('A NEAR Social write holds 1 to 256 keys.')
  // eslint-disable-next-line no-control-regex
  if (keys.some((key) => key.length > 1024 || /[^\x00-\x7f]/.test(key))) throw new Error('That NEAR Social key is not valid.')
  const sent = await signer.call(CONFIG.socialReceiver, '__fastdata_kv', entries, { gas: SOCIAL_GAS })
  // `included` with a failed receipt is the normal case: there is no contract at `social`.
  if (!sent.included && !sent.unknown) throw new Error(sent.error || 'That could not be sent.')
  const confirmed = await confirmWrite(signer.accountId, keys[0], entries[keys[0]], sent.hash)
  if (!confirmed && !sent.included) throw new Error(sent.error || 'That could not be sent.')
  return { hash: sent.hash, gasBurnt: sent.gasBurnt, tokensBurnt: sent.tokensBurnt, confirmed }
}

/** Sets the profile's name and about text. A field left out is not touched; '' clears it. */
export async function setProfile(signer, { name, about } = {}) {
  const entries = {}
  if (name !== undefined) {
    const text = String(name ?? '').trim()
    if (chars(text) > 256) throw new Error('That name is too long. Keep it under 256 characters.')
    entries['profile/name'] = text
  }
  if (about !== undefined) {
    const text = String(about ?? '').trim()
    if (chars(text) > 10_000) throw new Error('That is too long. Keep it under 10,000 characters.')
    entries['profile/about'] = text
  }
  if (Object.keys(entries).length === 0) throw new Error('There is nothing to change.')
  const result = await write(signer, entries)
  const changes = {}
  if ('profile/name' in entries) changes.name = entries['profile/name']
  if ('profile/about' in entries) changes.about = entries['profile/about']
  rememberProfile(signer.accountId, changes)
  return result
}

function followTarget(signer, accountId) {
  const target = String(accountId ?? '').trim().toLowerCase()
  if (!isAccountId(target)) throw new Error('That is not a NEAR account name.')
  if (signer && target === signer.accountId) throw new Error('You cannot follow yourself.')
  return target
}

export async function follow(signer, accountId) {
  return write(signer, { [`graph/follow/${followTarget(signer, accountId)}`]: {} })
}

export async function unfollow(signer, accountId) {
  return write(signer, { [`graph/follow/${followTarget(signer, accountId)}`]: null })
}

let lastPostId = 0

/** Posts a text. The game's hashtag is added when the text does not carry it. Resolves with { id, text, … }. */
export async function post(signer, text) {
  let body = String(text ?? '').trim()
  if (!body) throw new Error('Write something first.')
  if (!hashtagsIn(body).includes(CONFIG.hashtag)) body += ` #${CONFIG.hashtag}`
  if (chars(body) > 25_000) throw new Error('That post is too long.')
  // The standard's post id: the time in milliseconds, pushed on by one if that id was just used.
  lastPostId = Math.max(Date.now(), lastPostId + 1)
  const id = String(lastPostId)
  const result = await write(signer, { [`post/${id}`]: { text: body } })
  return { id, text: body, ...result }
}

/** A link to a profile or a post on near.social. Testnet has no such site, so there it is null. */
export function socialUrl(accountId, postId) {
  if (CONFIG.network !== 'mainnet' || !isAccountId(accountId)) return null
  return postId ? `https://near.social/${accountId}/post/${postId}` : `https://near.social/${accountId}`
}
