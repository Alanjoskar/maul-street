// The one object the menus and the 3D game talk to.
//
//   import { api } from './near/api.js'
//
// It keeps a copy of what the contract and NEAR Social say (`api.state`), keeps
// that copy fresh by polling, and turns every button into a contract call signed
// by the key on this device. `api.state` and everything in it are replaced, never
// changed in place, so `===` tells a caller whether something changed.

import { CONFIG, isAccountId } from './config.js'
import { Signer, accessKey, accountBalance, accountExists, generateKey, keyAllows, publicKeyOf, randomHex, sha256Hex, underPressure, view } from './chain.js'
import { near } from './format.js'
import * as social from './social.js'
import { store } from './storage.js'
import * as wallet from './wallet.js'

const PUBLIC_KEYS = ['dens', 'market', 'hireMarket', 'challenges', 'ticker', 'leaderboard', 'stats']
const CHAIN_KEYS = ['player', 'walletBalance', ...PUBLIC_KEYS]

const POLL_PUBLIC_MS = 12_000
const POLL_PLAYER_MS = 6_000
const POLL_SOCIAL_MS = 45_000
const POLL_DUEL_MS = 1_000
/** The most rows the contract's paged views return in one call. The leaderboard gives that many at most. */
const PAGE = 100
const LEADERBOARD_ROWS = PAGE

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hidden = () => typeof document !== 'undefined' && document.hidden === true
const later = (fn, ms) => {
  const timer = setTimeout(fn, ms)
  // In Node (tests) a waiting poll must not keep the process alive.
  if (timer && typeof timer.unref === 'function') timer.unref()
  return timer
}

// ----- Events ----------------------------------------------------------------------------------------

const listeners = new Map()

function emit(event, payload) {
  const set = listeners.get(event)
  if (!set) return
  for (const fn of [...set]) {
    try {
      fn(payload)
    } catch (error) {
      console.error(`[maul near] a '${event}' listener failed`, error)
    }
  }
}

const toast = (kind, text) => emit('toast', { kind, text })

function plain(error) {
  const text = error && typeof error.message === 'string' ? error.message.trim() : ''
  return text || 'That did not go through. Try again.'
}

// ----- State -------------------------------------------------------------------------------------------

const noSocial = () => ({ enabled: false, profile: null, following: [], followers: [], feed: [], mentions: [] })

function blankState() {
  return {
    session: null,
    player: null,
    walletBalance: null,
    dens: [],
    market: null,
    hireMarket: [],
    challenges: [],
    ticker: [],
    leaderboard: [],
    stats: null,
    social: noSocial(),
    pending: {},
  }
}

/** Replaces one key of the state and says so. Nothing happens when the value is the same as before. */
function put(key, value) {
  const before = api.state[key]
  if (before === value || JSON.stringify(before) === JSON.stringify(value)) return false
  api.state = { ...api.state, [key]: value }
  emit('change', key)
  return true
}

const patchSocial = (changes) => put('social', { ...api.state.social, ...changes })

let signer = null // signs calls on the game contract
let socialSigner = null // signs writes to NEAR Social
let localSession = false // the key was handed in by api._useSession: there is no wallet behind it
let ownDeposits = 0n // deposits the player has just made, which are not "money arriving"
let depositedAt = 0
let denMatch = null // the den fight in progress, as last seen
let justPosted = [] // the player's own posts of the last moments, shown before the index has them

const accountId = () => (api.state.session ? api.state.session.accountId : null)

// ----- Pending flags -------------------------------------------------------------------------------------

const inFlight = {}

function setPending(name, on) {
  inFlight[name] = (inFlight[name] || 0) + (on ? 1 : -1)
  const next = { ...api.state.pending }
  if (inFlight[name] > 0) next[name] = true
  else {
    delete next[name]
    delete inFlight[name]
  }
  put('pending', next)
}

/**
 * Runs one action: sets its pending flag, and on failure raises an error toast and
 * throws an Error whose message is a plain sentence.
 */
async function act(name, run, { silent = false } = {}) {
  setPending(name, true)
  try {
    return await run()
  } catch (error) {
    const message = plain(error)
    if (!silent) toast('error', message)
    if (error instanceof Error && error.message === message) throw error
    throw new Error(message)
  } finally {
    setPending(name, false)
  }
}

// ----- Calls on the game contract ---------------------------------------------------------------------------

function requireSigner() {
  if (!signer) throw new Error('Connect your wallet first.')
  return signer
}

/** The last calls sent to the game contract and what they cost. Read by tests as api._calls. */
const callLog = []

/** One signed call on the game contract. Resolves with its parsed return value, or throws a plain sentence. */
async function send(method, args = {}, options) {
  const active = requireSigner()
  const result = await active.call(CONFIG.contract, method, args, options)
  callLog.push({ method, ok: result.ok, hash: result.hash, gasBurnt: result.gasBurnt, tokensBurnt: result.tokensBurnt })
  if (callLog.length > 200) callLog.shift()
  if (result.ok) return result.value
  // A key that is gone or spent cannot be used again: the player has to connect afresh.
  if ((result.code === 'key-gone' || result.code === 'allowance') && signer === active) {
    wallet.forgetSession()
    dropSession()
  }
  const error = new Error(result.error || 'That did not go through. Try again.')
  error.code = result.code
  error.unknown = result.unknown === true
  throw error
}

const amount = (yocto) => {
  const text = String(yocto ?? '0').trim()
  if (!/^\d+$/.test(text)) throw new Error('That is not an amount of NEAR.')
  return text
}

/**
 * How far a fight has got: the turn, then who has sealed or opened a move this turn.
 * A view that is behind another has a lower number.
 */
function progress(match) {
  if (!match) return -1
  if (match.over) return Number.MAX_SAFE_INTEGER
  let flags = 0
  for (const side of [0, 1]) flags += match.open && match.open[side] ? 2 : match.sealed && match.sealed[side] ? 1 : 0
  return ((match.battle && match.battle.turn) || 0) * 10 + flags
}

/**
 * A move in a fight. If the network drops while it is being sent, the move may still
 * have landed, so the fight is read back before the player is told it failed.
 */
async function sendMove(method, args, before) {
  try {
    return await send(method, args)
  } catch (error) {
    if (!error.unknown || !before) throw error
    for (let i = 0; i < 3; i++) {
      await sleep(1_000)
      const now = await view('get_match', { match_id: before.id }).catch(() => null)
      if (now && progress(now) > progress(before)) return now
    }
    throw error
  }
}

// ----- Loading state ------------------------------------------------------------------------------------------

async function viewPaged(method) {
  const rows = []
  for (let page = 0; page < 10; page++) {
    const part = await view(method, { from_index: rows.length, limit: PAGE })
    if (!Array.isArray(part)) break
    rows.push(...part)
    if (part.length < PAGE) break
  }
  return rows
}

const loaders = {
  async session() {},
  async pending() {},
  async player(fresh) {
    const id = accountId()
    if (!id) {
      put('player', null)
      return
    }
    const player = await view('get_player', { account_id: id })
    if (fresh() && accountId() === id) notePlayer(player)
  },
  async walletBalance(fresh) {
    const id = accountId()
    if (!id) {
      put('walletBalance', null)
      return
    }
    const balance = await accountBalance(id)
    if (fresh() && accountId() === id) put('walletBalance', balance)
  },
  async dens(fresh) {
    const dens = await view('get_dens')
    if (fresh()) put('dens', dens || [])
  },
  async market(fresh) {
    const market = await view('get_market')
    if (fresh()) put('market', market || null)
  },
  async hireMarket(fresh) {
    const beasts = await viewPaged('get_hire_market')
    if (fresh()) put('hireMarket', beasts)
  },
  async challenges(fresh) {
    const challenges = await viewPaged('get_challenges')
    if (fresh()) put('challenges', challenges)
  },
  async ticker(fresh) {
    const ticker = await view('get_ticker')
    if (fresh()) put('ticker', ticker || [])
  },
  async leaderboard(fresh) {
    const rows = await view('get_leaderboard', { limit: LEADERBOARD_ROWS })
    if (fresh()) put('leaderboard', rows || [])
  },
  async stats(fresh) {
    const stats = await view('get_stats')
    if (fresh()) put('stats', stats || null)
  },
  async social(fresh) {
    const id = accountId()
    const [profile, following, followers, feed] = await Promise.all([
      id ? social.readProfile(id, { fresh: true }) : null,
      id ? social.readFollowing(id) : [],
      id ? social.readFollowers(id) : [],
      social.readFeed(),
    ])
    if (!fresh() || accountId() !== id) return
    // A list that could not be read (null) stays as it was rather than going blank.
    const before = api.state.social
    let posts = feed || before.feed
    // A post the player has just made stays in view until the index catches up with it.
    justPosted = justPosted.filter((post) => Date.now() - post.at < 90_000 && post.author === id && !posts.some((entry) => entry.author === post.author && entry.id === post.id))
    if (justPosted.length) {
      posts = [...justPosted.map(({ at, ...post }) => post), ...posts].sort((a, b) => b.ts - a.ts)
    }
    put('social', {
      enabled: Boolean(socialSigner),
      profile: id ? profile : null,
      following: following || before.following,
      followers: followers || before.followers,
      feed: posts,
      mentions: id ? social.mentionsOf(posts, id) : [],
    })
  },
}

const newest = {} // key → the number of the latest load started
const running = {} // key → the load in flight
const complaints = {}

/**
 * Loads one key of the state. A poll joins a load already in flight; `force` starts a new
 * one, and whichever load started last is the one whose answer is kept.
 */
function load(key, force) {
  if (!loaders[key]) return Promise.resolve()
  if (!force && running[key]) return running[key]
  const mine = (newest[key] = (newest[key] || 0) + 1)
  const job = loaders[key](() => newest[key] === mine)
    .then(
      () => {
        delete complaints[key]
      },
      (error) => {
        // Say it once in the console, not every twelve seconds.
        const text = plain(error)
        if (complaints[key] !== text) {
          complaints[key] = text
          console.warn(`[maul near] ${key} did not load: ${text}`)
        }
      },
    )
    .finally(() => {
      if (running[key] === job) delete running[key]
    })
  running[key] = job
  return job
}

const reload = (...keys) => Promise.all(keys.map((key) => load(key, true)))

/** A fresh PlayerView: the money toast, and the player's duel. */
function notePlayer(player) {
  const before = api.state.player
  put('player', player || null)
  if (before && before.registered && player && player.registered && before.account_id === player.account_id) {
    let rise = 0n
    try {
      rise = BigInt(player.balance) - BigInt(before.balance)
    } catch {
      rise = 0n
    }
    // A deposit that has not shown up a minute after the wallet answered is not coming.
    if (ownDeposits > 0n && !inFlight.deposit && Date.now() - depositedAt > 60_000) ownDeposits = 0n
    if (rise > 0n) {
      const own = rise < ownDeposits ? rise : ownDeposits
      ownDeposits -= own
      // Small sums keep a third decimal, so a 0.019 NEAR hire fee does not read as 0.01.
      if (rise > own) toast('near', `+${near(rise - own, rise - own < 100_000_000_000_000_000_000_000n ? 3 : 2)} NEAR`)
    }
  }
  // A duel id that appears while the player is being watched is a duel that has just started.
  const sameVisit = Boolean(before && before.registered && player && before.account_id === player.account_id)
  followDuel(player && player.registered && player.duel != null ? player.duel : null, sameVisit)
}

// ----- Fights that are watched: one poll per match, shared by everyone watching ---------------------------------

const feeds = new Map() // match id → { id, subs, last, mark, timer }

const markOf = (match) =>
  JSON.stringify([match.battle && match.battle.turn, match.sealed, match.open, match.need, match.over, match.winner, match.void])

/** A fresh MatchView from anywhere. Tells whoever watches that match, if it shows something new. */
function pushMatch(match) {
  if (!match || match.id == null) return
  const feed = feeds.get(match.id)
  if (!feed) return
  if (feed.last && progress(match) < progress(feed.last)) return // an older view that arrived late
  feed.last = match
  const mark = markOf(match)
  if (mark === feed.mark) return
  feed.mark = mark
  for (const fn of [...feed.subs]) {
    try {
      fn(match)
    } catch (error) {
      console.error('[maul near] a fight watcher failed', error)
    }
  }
  if (match.over) closeFeed(feed)
}

/** The furthest-on view of this match that is known: the one given, or a later one its watchers have seen. */
function latestOf(match) {
  const feed = match && feeds.get(match.id)
  return feed && feed.last && progress(feed.last) > progress(match) ? feed.last : match
}

function closeFeed(feed) {
  clearTimeout(feed.timer)
  feed.timer = null
  if (feeds.get(feed.id) === feed) feeds.delete(feed.id)
}

/** While the page is hidden, a fight is only polled if a sealed move of the player's waits to be opened. */
function mustKeepWatching(feed) {
  const match = feed.last
  if (!match || match.over || feed.id !== duel.id) return false
  const me = sideOf(match)
  return me >= 0 && Boolean(match.sealed[me]) && !match.open[me]
}

async function pollFeed(feed) {
  feed.timer = null
  if (feeds.get(feed.id) !== feed || feed.subs.size === 0) return
  if (!hidden() || mustKeepWatching(feed)) {
    try {
      const match = await view('get_match', { match_id: feed.id })
      if (match) {
        feed.missing = 0
        pushMatch(match)
      } else if (++feed.missing >= 10) {
        // Ten seconds of "no such match": it has been cleared away, and ids are never used twice.
        // (Once is not enough: a node a block behind does not know a match that has just begun.)
        closeFeed(feed)
        return
      }
    } catch {
      // The next second will try again.
    }
  }
  if (feeds.get(feed.id) === feed && feed.subs.size > 0 && !feed.timer) feed.timer = later(() => pollFeed(feed), POLL_DUEL_MS)
}

/** Watches a match. `fn(match)` runs when its turn, its sealed or open flags, or its end changes. Returns stop(). */
function watchMatch(matchId, fn) {
  let feed = feeds.get(matchId)
  if (!feed) {
    feed = { id: matchId, subs: new Set(), last: null, mark: '', timer: null, missing: 0 }
    feeds.set(matchId, feed)
    feed.timer = later(() => pollFeed(feed), 0)
  } else if (feed.last) {
    // Someone else is already watching: start this watcher off with what is known.
    const known = feed.last
    Promise.resolve().then(() => {
      if (feed.subs.has(fn)) fn(known)
    })
  }
  feed.subs.add(fn)
  return () => {
    feed.subs.delete(fn)
    if (feed.subs.size === 0) closeFeed(feed)
  }
}

// ----- The player's own duel ---------------------------------------------------------------------------------

// The contract keeps `player.duel` pointing at the player's last duel after it has ended
// (until their next one starts), so an id there does not mean a duel is on. `live` says
// this duel has been seen unfinished, or began during this visit: only then is its end news.
let duel = { id: null, stop: null, live: false }
const opening = new Map() // `${match id}:${turn}` → the reveal in flight
const openTries = new Map()
const cannotOpen = new Set()

const sealKey = (matchId, turn) => `maul-seal:${matchId}:${turn}`
const sideOf = (match) => (match && Array.isArray(match.players) ? match.players.indexOf(accountId()) : -1)

function followDuel(id, startedNow = false) {
  if (duel.id === id) return
  if (duel.stop) duel.stop()
  duel = { id, stop: null, live: startedNow }
  if (id != null) duel.stop = watchMatch(id, onDuel)
}

function onDuel(match) {
  if (sideOf(match) < 0) return
  // A duel that was already over when this visit began: nothing has started or changed.
  if (match.over && !duel.live) return
  duel.live = true
  emit('duel', match)
  if (match.over) {
    for (let turn = 0; turn <= ((match.battle && match.battle.turn) || 0); turn++) store.remove(sealKey(match.id, turn))
    // Pots, ratings and Essence have just moved.
    reload('player', 'leaderboard', 'ticker', 'stats')
  } else {
    openSealIfDue(match)
  }
}

/** True when the player's sealed move can be opened: the other side has locked theirs in, or has nothing to do. */
function sealIsDue(match, me) {
  const rival = 1 - me
  return Boolean(match.sealed[me]) && !match.open[me] && (Boolean(match.sealed[rival]) || Boolean(match.open[rival]) || !match.need[rival])
}

/** Opens the player's sealed move for this turn. Resolves with the new MatchView, or null when no seal is kept here. */
function openSeal(match) {
  const turn = match.battle.turn
  const key = `${match.id}:${turn}`
  if (opening.has(key)) return opening.get(key)
  const seal = store.getJson(sealKey(match.id, turn))
  if (!seal || !signer) return Promise.resolve(null)
  const job = (async () => {
    try {
      const opened = await sendMove('duel_reveal', { action: seal.action, salt: seal.salt }, match)
      store.remove(sealKey(match.id, turn))
      pushMatch(opened)
      return opened
    } finally {
      opening.delete(key)
    }
  })()
  opening.set(key, job)
  return job
}

/** Called whenever the player's duel changes, and after a reload: a sealed move is opened as soon as it may be. */
function openSealIfDue(match) {
  const me = sideOf(match)
  if (me < 0 || match.over || !sealIsDue(match, me)) return
  const key = `${match.id}:${match.battle.turn}`
  if (opening.has(key)) return
  if (!store.get(sealKey(match.id, match.battle.turn))) {
    if (!cannotOpen.has(key)) {
      cannotOpen.add(key)
      toast('error', 'Your sealed move was made on another device and cannot be opened from this one.')
    }
    return
  }
  const tries = openTries.get(key) || 0
  if (tries >= 4) return
  openTries.set(key, tries + 1)
  openSeal(match).catch((error) => {
    toast('error', plain(error))
    lookAgainAtSeal(match.id)
  })
}

/** A seal that could not be opened (the network blinked) is tried again shortly: the clock is running. */
function lookAgainAtSeal(matchId) {
  later(() => {
    const feed = feeds.get(matchId)
    if (feed && feed.last) openSealIfDue(feed.last)
  }, 2_500)
}

/** After sealing: waits for the other side, opens the seal, and resolves once the player's part of the turn is done. */
async function finishSeal(matchId, turn, me) {
  for (;;) {
    if (!signer) throw new Error('You are no longer connected.')
    const feed = feeds.get(matchId)
    let match = feed && feed.last
    if (!feed) {
      // Nobody is watching it any more. Either the duel has ended, or the watch was dropped: take it up again.
      match = await view('get_match', { match_id: matchId }).catch(() => null)
      if (!match) throw new Error('That duel has ended.')
      if (!match.over) {
        if (duel.stop) duel.stop()
        duel = { id: matchId, stop: watchMatch(matchId, onDuel), live: true }
        pushMatch(match)
      }
    }
    if (match) {
      if (match.over || match.battle.turn !== turn || match.open[me]) return match
      if (sealIsDue(match, me)) {
        let opened
        try {
          opened = await openSeal(match)
        } catch (error) {
          lookAgainAtSeal(matchId)
          throw error
        }
        if (opened) return opened
        throw new Error('Your sealed move was made on another device and cannot be opened from this one.')
      }
    }
    await sleep(400)
  }
}

// ----- Sessions ------------------------------------------------------------------------------------------------

function useSession(session, local) {
  signer = new Signer(session.accountId, session.secretKey)
  localSession = Boolean(local)
  ownDeposits = 0n
  denMatch = null
  followDuel(null)
  socialSigner = null
  const saved = wallet.savedSocialKey()
  if (saved && saved.accountId === session.accountId) {
    try {
      socialSigner = new Signer(saved.accountId, saved.secretKey)
    } catch {
      socialSigner = null
    }
  }
  put('session', { accountId: session.accountId })
  put('player', null)
  put('walletBalance', null)
  put('social', { ...noSocial(), enabled: Boolean(socialSigner), feed: api.state.social.feed })
  if (socialSigner) checkSocialKey(socialSigner)
}

/** Drops the social key if it is no longer on the account. A network failure leaves it be. */
async function checkSocialKey(active) {
  try {
    const key = await accessKey(active.accountId, active.publicKey)
    if (keyAllows(key, CONFIG.socialReceiver, '__fastdata_kv') || socialSigner !== active) return
    socialSigner = null
    wallet.forgetSocialKey()
    patchSocial({ enabled: false })
  } catch {
    // Not now. A write will say so if the key is gone.
  }
}

function dropSession() {
  signer = null
  socialSigner = null
  localSession = false
  ownDeposits = 0n
  denMatch = null
  followDuel(null)
  put('session', null)
  put('player', null)
  put('walletBalance', null)
  put('social', { ...noSocial(), feed: api.state.social.feed })
}

// ----- Polling --------------------------------------------------------------------------------------------------

let polling = false
let stopPolling = []

function every(ms, job) {
  let stopped = false
  let timer = null
  const turn = async () => {
    if (stopped) return
    if (!hidden()) {
      try {
        await job()
      } catch {
        // A poll that fails is tried again next time.
      }
    }
    if (!stopped) timer = later(turn, ms)
  }
  timer = later(turn, ms)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

let publicLoaded = false // the public lists have been read at least once
let publicRound = 0
let publicSkipped = 0
let publicTick = 0

/**
 * One round of the public lists. They are read one after another, not all at once: the
 * public nodes count requests in short windows, and turn a burst away. While a fight is
 * being watched every second, the lists are read a third as often (about every 36 seconds).
 */
async function pollPublic() {
  publicTick++
  if (feeds.size > 0 && publicTick % 3 !== 0) return
  // The public nodes allow only so many requests. When one has just turned a request away,
  // the lists give way to what matters more (the player, a fight, the player's own calls),
  // though never for more than two rounds running.
  if (underPressure() && publicSkipped < 2) {
    publicSkipped++
    return
  }
  publicSkipped = 0
  publicRound++
  // The wallet's own NEAR moves rarely: every third round is enough.
  const keys = publicRound % 3 === 1 ? [...PUBLIC_KEYS, 'walletBalance'] : PUBLIC_KEYS
  for (const key of keys) await load(key, false)
  publicLoaded = true
}

/** After a session starts: the player, and the public lists if nothing has loaded them yet. */
async function loadForSession() {
  await reload('player', 'walletBalance')
  if (!publicLoaded) {
    await reload(...PUBLIC_KEYS)
    publicLoaded = true
  }
  load('social', true)
}

function onVisible() {
  // Back in view: catch up at once rather than waiting out the timers.
  if (hidden()) return
  load('player', false)
  load('social', false)
  pollPublic().catch(() => {})
}

function startPolling() {
  if (polling) return
  polling = true
  stopPolling = [
    every(POLL_PUBLIC_MS, pollPublic),
    every(POLL_PLAYER_MS, () => (accountId() ? load('player', false) : null)),
    every(POLL_SOCIAL_MS, () => load('social', false)),
  ]
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', onVisible)
    stopPolling.push(() => document.removeEventListener('visibilitychange', onVisible))
  }
}

// ----- NEAR Social ------------------------------------------------------------------------------------------------

function requireSocial() {
  if (!accountId()) throw new Error('Connect your wallet first.')
  if (!socialSigner) throw new Error('Turn on NEAR Social first.')
  return socialSigner
}

/** A write the chain took but NEAR Social's index has not shown yet. */
function noteSlowIndex(result) {
  if (result && result.confirmed === false) toast('info', 'NEAR Social is slow to show that. It will appear shortly.')
}

const socialApi = {
  /** One wallet approval adds a key that can only write to NEAR Social. After it, posts and follows are silent. */
  enable: () =>
    act('social.enable', async () => {
      const id = accountId()
      if (!id) throw new Error('Connect your wallet first.')
      if (socialSigner) return true
      if (localSession) throw new Error('This session has no wallet behind it. Hand it a NEAR Social key instead.')
      const key = generateKey()
      await wallet.walletAddSocialKey(key.publicKey)
      if (accountId() !== id) throw new Error('You are no longer connected.')
      wallet.saveSocialKey({ accountId: id, ...key })
      socialSigner = new Signer(id, key.secretKey)
      patchSocial({ enabled: true })
      return true
    }),

  /** { accountId, name, about } for any account. Kept for a minute. */
  profileOf: (id) => social.readProfile(id),

  setProfile: (fields) =>
    act('social.setProfile', async () => {
      const active = requireSocial()
      const result = await social.setProfile(active, fields || {})
      noteSlowIndex(result)
      const profile = await social.readProfile(active.accountId)
      if (accountId() === active.accountId) patchSocial({ profile })
      return profile
    }),

  follow: (target) =>
    act('social.follow', async () => {
      const active = requireSocial()
      const id = String(target ?? '').trim().toLowerCase()
      if (isAccountId(id) && id !== active.accountId && !(await accountExists(id))) throw new Error(`There is no account called ${id}.`)
      noteSlowIndex(await social.follow(active, id))
      if (accountId() === active.accountId && !api.state.social.following.includes(id)) {
        patchSocial({ following: [...api.state.social.following, id] })
      }
      return true
    }),

  unfollow: (target) =>
    act('social.unfollow', async () => {
      const active = requireSocial()
      const id = String(target ?? '').trim().toLowerCase()
      noteSlowIndex(await social.unfollow(active, id))
      if (accountId() === active.accountId) patchSocial({ following: api.state.social.following.filter((other) => other !== id) })
      return true
    }),

  /** Posts to NEAR Social. ' #maulstreet' is added when the text does not carry the tag. Resolves with { id }. */
  post: (text) =>
    act('social.post', async () => {
      const active = requireSocial()
      const posted = await social.post(active, text)
      noteSlowIndex(posted)
      if (accountId() === active.accountId) {
        // Show it at once. The next refresh brings the indexed copy, with its block time.
        const mine = { author: active.accountId, id: posted.id, text: posted.text, ts: Math.floor(Date.now() / 1000), name: (api.state.social.profile && api.state.social.profile.name) || '' }
        justPosted.push({ ...mine, at: Date.now() })
        if (!api.state.social.feed.some((entry) => entry.author === mine.author && entry.id === mine.id)) {
          patchSocial({ feed: [mine, ...api.state.social.feed] })
        }
        load('social', true)
      }
      return { id: posted.id }
    }),

  /** Reloads profile, following, followers, feed and mentions into api.state.social. */
  refresh: () => load('social', true),

  /** A link to show for an account or a post. There is no near.social for testnet, so there it is null. */
  url: (id, postId) => social.socialUrl(id, postId),
}

// ----- The facade ------------------------------------------------------------------------------------------------

let starting = null

export const api = {
  /** { aspects, species[], items[], dens[], rules }: set once by the game with api.setTables(). */
  tables: null,
  state: blankState(),

  setTables(tables) {
    api.tables = tables
  },

  /** Listens for 'change' (key), 'toast' ({ kind, text }) or 'duel' (MatchView). Returns a function that stops listening. */
  on(event, fn) {
    if (typeof fn !== 'function') return () => {}
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(fn)
    return () => {
      const set = listeners.get(event)
      if (set) set.delete(fn)
    }
  },

  // ----- Lifecycle -----

  /** Restores a saved session, loads the public data, starts polling. Never throws. */
  init() {
    if (!starting) {
      starting = (async () => {
        try {
          const saved = wallet.savedSession()
          if (saved && !signer) {
            let usable = true
            try {
              usable = keyAllows(await accessKey(saved.accountId, saved.publicKey), CONFIG.contract)
            } catch {
              // The network is down. Keep the session: the first call will tell.
            }
            if (usable) useSession(saved, saved.local === true)
            else {
              wallet.forgetSession()
              toast('info', 'The key on this device is no longer on your account. Connect your wallet again.')
            }
          }
          // On a bad connection the first load can take half a minute to give up. The page should
          // not wait for that: after eight seconds it carries on, and the loads finish in their own time.
          await Promise.race([reload(...CHAIN_KEYS), new Promise((resolve) => later(resolve, 8_000))])
          publicLoaded = true
          load('social', true)
          startPolling()
        } catch (error) {
          console.warn('[maul near] start-up did not finish', error)
        }
      })()
    }
    return starting
  },

  /**
   * Opens the wallet chooser and adds the game key to the player's account.
   * `onProgress(text)` is told what is happening. Throws an Error with a plain sentence on failure or cancel.
   */
  connect(onProgress) {
    // The caller shows what went wrong where the player is looking, so no toast is raised here.
    return act(
      'connect',
      async () => {
        const session = await wallet.connectWallet(onProgress)
        if (accountId() !== session.accountId || !signer || signer.publicKey !== session.publicKey) {
          useSession(session, session.local === true)
        }
        if (typeof onProgress === 'function') {
          try {
            onProgress('Loading your stable…')
          } catch {
            // The caller's display failed. Carry on.
          }
        }
        await loadForSession()
        startPolling()
        return api.state.session
      },
      { silent: true },
    )
  },

  /** Forgets the wallet on this device. */
  async disconnect() {
    dropSession()
    await wallet.disconnectWallet()
  },

  /** Reloads the named keys of the state, or all of them. Never throws: a key that cannot be read keeps its value. */
  async refresh(...keys) {
    const wanted = keys.length ? keys.flat() : Object.keys(loaders)
    await reload(...wanted)
  },

  // ----- Money -----

  register: (picks) =>
    act('register', async () => {
      const player = await send('register', { picks })
      await reload('player', 'stats', 'ticker', 'leaderboard')
      return player
    }),

  /** The one call that opens the wallet: it attaches NEAR. Resolves with the new pit balance. */
  deposit: (yocto) =>
    act('deposit', async () => {
      const id = accountId()
      if (!id) throw new Error('Connect your wallet first.')
      const attached = BigInt(amount(yocto))
      if (attached <= 0n) throw new Error('Enter an amount of NEAR to deposit.')
      // Counted before the wallet is asked: a poll may see the money on chain before the wallet answers.
      ownDeposits += attached
      depositedAt = Date.now()
      let balance
      try {
        if (localSession) balance = await send('deposit', {}, { deposit: attached })
        else balance = (await wallet.walletDeposit(attached.toString())).value
      } catch (error) {
        ownDeposits = ownDeposits > attached ? ownDeposits - attached : 0n
        throw error
      }
      depositedAt = Date.now()
      await reload('player', 'walletBalance', 'stats')
      return balance ?? (api.state.player ? api.state.player.balance : null)
    }),

  withdraw: (yocto) =>
    act('withdraw', async () => {
      const value = await send('withdraw', { amount: amount(yocto) })
      await reload('player', 'walletBalance')
      return value
    }),

  // ----- Beasts, the bazaar, hiring -----

  /**
   * Buys the beast's next level: with NEAR from the pit balance, or by feeding it Essence
   * (the price in Essence is the XP it still lacks). Resolves with the BeastView.
   */
  levelUp: (beastId, withEssence) =>
    act('levelUp', async () => {
      const beast = await send('level_up', { beast_id: beastId, with_essence: Boolean(withEssence) })
      await reload('player', 'hireMarket')
      return beast
    }),

  renameBeast: (beastId, name) =>
    act('renameBeast', async () => {
      const beast = await send('rename_beast', { beast_id: beastId, name: String(name ?? '') })
      await reload('player', 'hireMarket')
      return beast
    }),

  buyItem: (itemId, maxPriceYocto) =>
    act('buyItem', async () => {
      const paid = await send('buy_item', { item_id: itemId, max_price: amount(maxPriceYocto) })
      await reload('player', 'market')
      return paid
    }),

  buyBeast: (speciesId, maxPriceYocto) =>
    act('buyBeast', async () => {
      const beast = await send('buy_beast', { species: speciesId, max_price: amount(maxPriceYocto) })
      await reload('player', 'market', 'stats')
      return beast
    }),

  equip: (beastId, itemId) =>
    act('equip', async () => {
      const beast = await send('equip', { beast_id: beastId, item_id: itemId })
      await reload('player', 'hireMarket')
      return beast
    }),

  unequip: (beastId, kind) =>
    act('unequip', async () => {
      const beast = await send('unequip', { beast_id: beastId, kind })
      await reload('player', 'hireMarket')
      return beast
    }),

  listForHire: (beastId, priceYocto) =>
    act('listForHire', async () => {
      const value = await send('list_for_hire', { beast_id: beastId, price: amount(priceYocto) })
      await reload('player', 'hireMarket')
      return value
    }),

  unlist: (beastId) =>
    act('unlist', async () => {
      const value = await send('unlist', { beast_id: beastId })
      await reload('player', 'hireMarket')
      return value
    }),

  hire: (beastId, fights) =>
    act('hire', async () => {
      const player = await send('hire', { beast_id: beastId, fights })
      await reload('player', 'hireMarket')
      return player
    }),

  // ----- Dens -----

  backDen: (denId, yocto) =>
    act('backDen', async () => {
      const shares = await send('back_den', { den_id: denId, amount: amount(yocto) })
      await reload('player', 'dens')
      return shares
    }),

  unbackDen: (denId, shares) =>
    act('unbackDen', async () => {
      const paid = await send('unback_den', { den_id: denId, shares: amount(shares) })
      await reload('player', 'dens')
      return paid
    }),

  startDenFight: (denId, squadIds, stakeYocto) =>
    act('startDenFight', async () => {
      const match = await send('start_den_fight', { den_id: denId, squad: squadIds, stake: amount(stakeYocto) })
      denMatch = match
      await reload('player', 'dens')
      return match
    }),

  /** The player's move against a den. The events of the step(s) just played are in `.last_events` and `.steps`. */
  denAct: (action) =>
    act('denAct', async () => {
      const match = await sendMove('den_act', { action }, denMatch)
      denMatch = match
      if (match && match.over) await reload('player', 'dens', 'ticker', 'stats')
      return match
    }),

  forfeitDen: () =>
    act('forfeitDen', async () => {
      const match = await send('forfeit_den')
      denMatch = match
      await reload('player', 'dens', 'ticker', 'stats')
      return match
    }),

  // ----- Duels -----

  createChallenge: (squadIds, stakeYocto, levelCap, inviteOrNull) =>
    act('createChallenge', async () => {
      const challenge = await send('create_challenge', {
        squad: squadIds,
        stake: amount(stakeYocto),
        level_cap: Number(levelCap) || 0,
        invite: inviteOrNull ? String(inviteOrNull).trim().toLowerCase() : null,
      })
      await reload('player', 'challenges', 'ticker')
      return challenge
    }),

  cancelChallenge: () =>
    act('cancelChallenge', async () => {
      const value = await send('cancel_challenge')
      await reload('player', 'challenges')
      return value
    }),

  acceptChallenge: (challengeId, squadIds) =>
    act('acceptChallenge', async () => {
      const match = await send('accept_challenge', { id: challengeId, squad: squadIds })
      if (match) {
        followDuel(match.id, true)
        pushMatch(match)
      }
      await reload('player', 'challenges', 'ticker')
      return match
    }),

  /**
   * The player's move in their duel. Plays it openly when the contract allows that
   * (only this side has to act, or the other side has locked in). Otherwise seals it,
   * waits for the other side, and opens it. Resolves with the MatchView once the
   * player's part of the turn is done. The sealed move and its salt are kept in this
   * browser per match and turn, so a reload can still open it.
   */
  duelMove: (action) =>
    act('duelMove', async () => {
      requireSigner()
      const id = api.state.player && api.state.player.duel != null ? api.state.player.duel : duel.id
      if (id == null) throw new Error('You are not in a duel.')
      const read = await view('get_match', { match_id: id })
      if (!read) throw new Error('That duel has ended.')
      if (sideOf(read) < 0) throw new Error('You are not in that duel.')
      followDuel(id)
      pushMatch(read)
      // Whoever watches this duel may already have been shown a later moment than this read.
      // Decide on, and hand back, nothing older than that.
      const match = latestOf(read)
      const me = sideOf(match)
      if (match.over) return match
      if (!match.need[me]) throw new Error('It is not your turn to act.')
      const rival = 1 - me
      const turn = match.battle.turn
      let result
      if (match.open[me]) {
        result = match
      } else if (match.sealed[me]) {
        // Sealed before a reload: all that is left is to open it.
        result = await finishSeal(id, turn, me)
      } else if (!match.need[rival] || match.sealed[rival] || match.open[rival]) {
        result = await sendMove('duel_play', { action }, match)
        pushMatch(result)
      } else {
        const salt = randomHex(16)
        store.setJson(sealKey(id, turn), { action, salt })
        let sealed
        try {
          sealed = await sendMove('duel_commit', { hash: sha256Hex(`${action}:${salt}`) }, match)
        } catch (error) {
          // Refused outright: there is no seal on the chain to open. (If the outcome is unknown, keep it.)
          if (!error.unknown) store.remove(sealKey(id, turn))
          throw error
        }
        pushMatch(sealed)
        result = await finishSeal(id, turn, me)
      }
      if (result && result.over) await reload('player', 'leaderboard', 'ticker', 'stats')
      return latestOf(result)
    }),

  /** Polls a match every second. `onMatch(match)` runs when its turn, its sealed or open flags, or its end changes. Returns stop(). */
  watchDuel(matchId, onMatch) {
    if (typeof onMatch !== 'function') return () => {}
    return watchMatch(matchId, onMatch)
  },

  /** A fight by its id, or null when there is none. Throws a plain sentence when the network cannot be reached. */
  async getMatch(matchId) {
    const match = await view('get_match', { match_id: matchId })
    if (!match) return null
    if (match.kind === 'den' && match.players && match.players[0] === accountId() && !(denMatch && denMatch.id === match.id && progress(denMatch) > progress(match))) {
      denMatch = match
    }
    pushMatch(match)
    return latestOf(match)
  },

  claimTimeout: () =>
    act('claimTimeout', async () => {
      const match = await send('claim_timeout')
      pushMatch(match)
      await reload('player', 'leaderboard', 'ticker', 'stats')
      return match
    }),

  forfeitDuel: () =>
    act('forfeitDuel', async () => {
      const match = await send('forfeit_duel')
      pushMatch(match)
      await reload('player', 'leaderboard', 'ticker', 'stats')
      return match
    }),

  social: socialApi,

  // ----- Test hooks: not part of the interface the game is written against -----

  /**
   * Adopts a key that is already on an account (function-call for the game contract, or
   * full access) with no wallet. For automated tests and scripted players.
   */
  async _useSession({ accountId: id, secretKey }) {
    if (!isAccountId(id)) throw new Error('That is not a NEAR account name.')
    const publicKey = publicKeyOf(secretKey)
    const key = await accessKey(id, publicKey)
    if (!key) throw new Error(`That key is not on ${id}.`)
    if (!keyAllows(key, CONFIG.contract)) throw new Error(`That key cannot call ${CONFIG.contract}.`)
    const session = { accountId: id, publicKey, secretKey, local: true }
    wallet.saveSession(session)
    useSession(session, true)
    await loadForSession()
    startPolling()
    return api.state.session
  },

  /** Adopts a key that may write to NEAR Social for the connected account. */
  async _useSocialKey(secretKey) {
    const id = accountId()
    if (!id) throw new Error('Connect first.')
    const publicKey = publicKeyOf(secretKey)
    const key = await accessKey(id, publicKey)
    if (!keyAllows(key, CONFIG.socialReceiver, '__fastdata_kv')) throw new Error(`That key cannot write to NEAR Social for ${id}.`)
    wallet.saveSocialKey({ accountId: id, publicKey, secretKey })
    socialSigner = new Signer(id, secretKey)
    patchSocial({ enabled: true })
    return true
  },

  /** Every call sent to the game contract this session: [{ method, ok, hash, gasBurnt, tokensBurnt }]. For tests. */
  _calls: callLog,

  /** Stops every poll. For tests. */
  _stop() {
    stopPolling.forEach((stop) => stop())
    stopPolling = []
    polling = false
    for (const feed of [...feeds.values()]) closeFeed(feed)
    duel = { id: null, stop: null, live: false }
  },
}
