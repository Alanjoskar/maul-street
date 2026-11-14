// Maul Street audio: plays the music and effects that tools/audio/build.py generates.
//
// Web Audio only, no dependencies. Nothing here throws: before `init` succeeds
// (no user gesture yet, no audio device, files missing) every call is a silent
// no-op. The last track asked for is remembered and starts once `init` succeeds.
//
//   audio.init()                     call from the first click
//   audio.music('street' | 'battle' | null, { fade })
//   audio.stinger('victory' | 'defeat')
//   audio.sfx('hit_light', { volume, rate, pan, delay })
//   audio.loop('heartbeat', true | false)
//   audio.setTimeScale(0.2) ... audio.setTimeScale(1)
//   audio.setVolumes({ master, music, sfx }), getVolumes(), setMuted(bool), isMuted()
//   audio.log                        every call, when the page URL has film=1

const STORE_KEY = 'maul-audio'
const DEFAULT_VOLUMES = { master: 0.9, music: 0.6, sfx: 0.9 }
const MAX_VOICES = 28            // effects sounding at once; the oldest is dropped beyond this
const SAME_SOUND_GAP = 0.03      // seconds: the same file is not started twice inside this window
const LATE_LIMIT = 0.35          // a one-shot that could not be decoded in time is dropped, not played late
const RESTORE_TIME = 0.13        // time constant: slow motion is fully restored in about 0.4 s

// Used to choose a variant when the manifest has not loaded (film logging with no audio).
const VARIANT_COUNTS = { hit_light: 3, hit_heavy: 3, pain: 3, faint: 2 }

const FILM = (() => {
  try {
    return new URLSearchParams(globalThis.location.search).get('film') === '1'
  } catch {
    return false
  }
})()

function baseCandidates(explicit) {
  const list = []
  if (explicit) list.push(explicit.endsWith('/') ? explicit : `${explicit}/`)
  try {
    const env = import.meta.env
    if (env && typeof env.BASE_URL === 'string') list.push(`${env.BASE_URL}audio/`)
  } catch {
    // no bundler: import.meta.env does not exist
  }
  list.push('./audio/')
  list.push('./public/audio/') // the folder served as it is, without Vite
  return [...new Set(list)]
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

let ctx = null
let ready = false
let starting = null
let manifest = null
let base = './audio/'
let graph = null // { master, music, musicFilter, sfx }
let volumes = loadSettings()
let muted = volumes.muted
let timeScale = 1
let wantedMusic = null // { name, fade }
let musicToken = 0
let current = { name: null, voice: null }
let stingerUntil = 0
const buffers = new Map() // 'sfx:name' | 'music:name' -> AudioBuffer
const pending = new Map() // same keys -> Promise
const loops = new Map() // name -> { wanted, source, gain }
const lastVariant = new Map()
const lastStart = new Map()
const voices = [] // sources of one-shot effects that are sounding

function loadSettings() {
  const out = { ...DEFAULT_VOLUMES, muted: false }
  try {
    const saved = JSON.parse(globalThis.localStorage.getItem(STORE_KEY) || 'null')
    if (saved && typeof saved === 'object') {
      for (const key of ['master', 'music', 'sfx']) {
        if (Number.isFinite(saved[key])) out[key] = clamp(saved[key], 0, 1)
      }
      out.muted = !!saved.muted
    }
  } catch {
    // private mode or no storage: keep the defaults
  }
  return out
}

function saveSettings() {
  try {
    globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({ master: volumes.master, music: volumes.music, sfx: volumes.sfx, muted }))
  } catch {
    // nothing to do
  }
}

function record(kind, name, volume = 1, rate = 1, extra) {
  if (!FILM) return
  audio.log.push({ t: now(), kind, name, volume, rate, ...extra })
}

async function fetchManifest(explicit) {
  if (typeof fetch !== 'function') return null
  for (const candidate of baseCandidates(explicit)) {
    try {
      const response = await fetch(`${candidate}manifest.json`, { cache: 'no-cache' })
      if (!response.ok) continue
      const data = await response.json()
      if (data && data.sfx && data.music) {
        base = candidate
        return data
      }
    } catch {
      // try the next place
    }
  }
  return null
}

function buildGraph() {
  const master = ctx.createGain()
  const music = ctx.createGain()
  const sfx = ctx.createGain()
  const musicFilter = ctx.createBiquadFilter()
  musicFilter.type = 'lowpass'
  musicFilter.frequency.value = 20000
  musicFilter.Q.value = 0.707
  // A safety net for the moments when a roar, a boom and the music all peak together.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -5
  limiter.knee.value = 4
  limiter.ratio.value = 12
  limiter.attack.value = 0.003
  limiter.release.value = 0.16
  const duck = ctx.createGain() // big effects push the music down for a moment (see duckMusic)
  music.connect(duck)
  duck.connect(musicFilter)
  musicFilter.connect(master)
  sfx.connect(master)
  master.connect(limiter)
  limiter.connect(ctx.destination)
  graph = { master, music, musicFilter, sfx, duck }
  applyVolumes(0)
}

const ducking = { floor: 1, until: 0 }

// A roar or a killing blow should not have to fight the battle music: the manifest gives
// such effects a `duck` amount, and the music dips by that much while they sound.
function duckMusic(amount, when, seconds) {
  if (!(amount > 0)) return
  let floor = clamp(1 - amount, 0.1, 1)
  if (when < ducking.until) floor = Math.min(floor, ducking.floor)
  ducking.floor = floor
  ducking.until = Math.max(ducking.until, when + Math.max(0.2, seconds * 0.6))
  const gain = graph.duck.gain
  gain.cancelScheduledValues(when)
  gain.setTargetAtTime(floor, when, 0.03)
  gain.setTargetAtTime(1, ducking.until, 0.3)
}

function applyVolumes(smooth = 0.03) {
  if (!graph) return
  const t = ctx.currentTime
  const set = (param, value) => {
    if (smooth > 0) param.setTargetAtTime(value, t, smooth)
    else param.value = value
  }
  set(graph.master.gain, muted ? 0 : volumes.master)
  set(graph.music.gain, volumes.music)
  set(graph.sfx.gain, volumes.sfx)
}

function decode(data) {
  return new Promise((resolve, reject) => {
    const promise = ctx.decodeAudioData(data, resolve, reject)
    if (promise && typeof promise.catch === 'function') promise.catch(reject)
  })
}

function load(kind, name) {
  const key = `${kind}:${name}`
  if (buffers.has(key)) return Promise.resolve(buffers.get(key))
  if (pending.has(key)) return pending.get(key)
  const entry = manifest && manifest[kind] && manifest[kind][name]
  if (!entry || !ctx) return Promise.resolve(null)
  const job = fetch(base + entry.file)
    .then((response) => {
      if (!response.ok) throw new Error(`${entry.file}: ${response.status}`)
      return response.arrayBuffer()
    })
    .then(decode)
    .then((buffer) => {
      buffers.set(key, buffer)
      return buffer
    })
    .catch(() => null)
    .finally(() => pending.delete(key))
  pending.set(key, job)
  return job
}

function preload() {
  // The fight set first, four files at a time, then the fight music and the stingers,
  // so that a fight starts on the beat even on a slow connection. All in the background.
  const jobs = ((manifest && manifest.preload) || []).map((name) => ['sfx', name])
  for (const name of ['battle', 'victory', 'defeat']) if (manifest.music[name]) jobs.push(['music', name])
  let index = 0
  const next = () => {
    if (!ready || index >= jobs.length) return
    const [kind, name] = jobs[index++]
    load(kind, name).then(next)
  }
  for (let lane = 0; lane < 4; lane++) next()
}

function variantsOf(name) {
  if (manifest) {
    if (manifest.sfx[name]) return [name]
    return (manifest.variants && manifest.variants[name]) || []
  }
  const count = VARIANT_COUNTS[name]
  return count ? Array.from({ length: count }, (_, i) => `${name}_${i + 1}`) : [name]
}

function pickVariant(name) {
  const options = variantsOf(name)
  if (options.length === 0) return null
  if (options.length === 1) return options[0]
  let choice = options[Math.floor(Math.random() * options.length)]
  if (choice === lastVariant.get(name)) choice = options[(options.indexOf(choice) + 1) % options.length]
  lastVariant.set(name, choice)
  return choice
}

const musicRateFor = (scale) => (scale >= 1 ? 1 : 0.5 + 0.5 * scale) // 0.2 -> 0.6
const cutoffFor = (scale) => (scale >= 1 ? 20000 : 500 * Math.pow(40, scale)) // 0.2 -> about 1 kHz
const sfxRateFor = (scale) => (scale >= 1 ? 1 : 0.75 + 0.25 * scale) // 0.2 -> 0.8

function startOneShot(buffer, id, volume, rate, pan, when) {
  const entry = manifest.sfx[id] || {}
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = rate
  const gain = ctx.createGain()
  gain.gain.value = clamp(volume, 0, 4) * (Number.isFinite(entry.gain) ? entry.gain : 1)
  source.connect(gain)
  let tail = gain
  if (pan && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner()
    panner.pan.value = clamp(pan, -1, 1)
    gain.connect(panner)
    tail = panner
  }
  tail.connect(graph.sfx)
  source.onended = () => {
    const index = voices.indexOf(source)
    if (index >= 0) voices.splice(index, 1)
    try {
      tail.disconnect()
    } catch {
      // already gone
    }
  }
  voices.push(source)
  if (voices.length > MAX_VOICES) {
    try {
      voices.shift().stop()
    } catch {
      // it had not started yet
    }
  }
  source.start(when)
  duckMusic(entry.duck * clamp(volume, 0, 1), when, buffer.duration / rate)
}

function fadeOutVoice(voice, seconds) {
  if (!voice) return
  const t = ctx.currentTime
  const span = Math.max(0.02, seconds)
  try {
    voice.gain.gain.cancelScheduledValues(t)
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, t)
    voice.gain.gain.linearRampToValueAtTime(0, t + span)
    voice.source.stop(t + span + 0.05)
  } catch {
    // the source was never started
  }
}

function loopRegion(entry, buffer) {
  // The file holds the loop with a little of its own end before it and of its own start after it,
  // so any window of exactly loopLength seconds inside the file joins up. Keep the window inside
  // the decoded buffer (decoders differ by a few milliseconds in how they trim MP3 padding).
  // The exact length is a whole number of samples; the seconds in the manifest are rounded.
  const length = entry.loopSamples && entry.sampleRate ? entry.loopSamples / entry.sampleRate : entry.loopLength || entry.loopEnd - entry.loopStart
  const start = clamp(entry.loopStart || 0, 0, Math.max(0, buffer.duration - length))
  return [start, start + length]
}

function startMusic(name, fade) {
  const token = ++musicToken
  const entry = manifest.music[name]
  if (!entry) return
  // After a stinger, come in under its tail rather than on top of it.
  const earliest = Math.max(ctx.currentTime, stingerUntil - 1.2)
  load('music', name).then((buffer) => {
    if (!buffer || token !== musicToken || !ready) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    let offset = 0
    if (entry.loop) {
      const [from, to] = loopRegion(entry, buffer)
      source.loop = true
      source.loopStart = from
      source.loopEnd = to
      offset = from
    }
    source.playbackRate.value = musicRateFor(timeScale)
    const gain = ctx.createGain()
    const when = Math.max(ctx.currentTime + 0.02, earliest)
    const span = Math.max(0.02, fade)
    gain.gain.setValueAtTime(0, when)
    gain.gain.linearRampToValueAtTime(1, when + span)
    source.connect(gain)
    gain.connect(graph.music)
    source.start(when, offset)
    current = { name, voice: { source, gain } }
  })
}

function startLoop(name, state) {
  load('sfx', name).then((buffer) => {
    if (!buffer || !ready || !state.wanted || state.source) return
    const entry = manifest.sfx[name] || {}
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const gain = ctx.createGain()
    const t = ctx.currentTime
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(Number.isFinite(entry.gain) ? entry.gain : 1, t + 0.08)
    source.connect(gain)
    gain.connect(graph.sfx)
    source.start(t)
    state.source = source
    state.gain = gain
  })
}

export const audio = {
  /**
   * Call from the first click or key press. Creates the AudioContext, loads the manifest and
   * starts decoding the fight sounds in the background. Safe to call again; resolves either way.
   * `options.baseUrl` overrides where the audio folder is looked for.
   */
  init(options = {}) {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
    if (starting) return starting
    starting = (async () => {
      try {
        if (!manifest) manifest = await fetchManifest(options.baseUrl)
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext
        if (!manifest || !Context) throw new Error('audio unavailable')
        if (!ctx) {
          ctx = new Context({ latencyHint: 'interactive' })
          buildGraph()
          // If this was not a real gesture the context stays suspended: wake it on the next one.
          const wake = () => {
            if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {})
          }
          for (const type of ['pointerdown', 'keydown', 'touchend']) globalThis.addEventListener?.(type, wake, { passive: true })
          globalThis.document?.addEventListener?.('visibilitychange', wake)
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
        ready = true
        preload()
        if (wantedMusic && wantedMusic.name) {
          current = { name: wantedMusic.name, voice: null }
          startMusic(wantedMusic.name, wantedMusic.fade)
        }
        for (const [name, state] of loops) if (state.wanted) startLoop(name, state)
      } catch {
        ready = false
        starting = null // let a later click try again
      }
    })()
    return starting
  },

  /** 'street', 'battle' or null (silence). Loops without a gap and cross-fades from whatever was playing. */
  music(name, { fade = 1.5 } = {}) {
    const next = name || null
    record('music', next, 1, 1, { fade })
    wantedMusic = { name: next, fade }
    if (!ready) return
    if (next === current.name && (current.voice || pending.has(`music:${next}`))) return
    musicToken++
    fadeOutVoice(current.voice, fade)
    current = { name: next, voice: null }
    if (next) startMusic(next, fade)
  },

  /** 'victory' or 'defeat': the music fades away and the stinger plays once. */
  stinger(name) {
    record('stinger', name, 1, 1)
    wantedMusic = null
    if (!ready || !manifest.music[name]) return
    musicToken++
    fadeOutVoice(current.voice, 0.5)
    current = { name: null, voice: null }
    const startAt = ctx.currentTime + 0.05
    stingerUntil = startAt + (manifest.music[name].duration || 6)
    load('music', name).then((buffer) => {
      if (!buffer || !ready) return
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const gain = ctx.createGain()
      source.connect(gain)
      gain.connect(graph.music)
      const when = Math.max(startAt, ctx.currentTime)
      stingerUntil = when + buffer.duration
      source.start(when)
    })
  },

  /**
   * One effect. A name without its _1/_2/_3 suffix picks a variant at random (never the same
   * twice running). Pitch is varied by up to 4% unless `rate` is given. `pan` is -1..1, `delay` seconds.
   */
  sfx(name, { volume = 1, rate, pan = 0, delay = 0 } = {}) {
    const id = pickVariant(name)
    const fixed = Number.isFinite(rate) && rate > 0
    const playRate = (fixed ? rate : 1 + (Math.random() * 2 - 1) * 0.04) * sfxRateFor(timeScale)
    const entry = manifest && id && manifest.sfx[id]
    record('sfx', id || name, volume, playRate, { request: name, pan, delay, gain: entry ? entry.gain : undefined })
    if (!ready || !id || !entry) return
    if (ctx.state !== 'running') return // no gesture yet: do not queue sounds to burst out later
    const wait = Math.max(0, Number(delay) || 0)
    const asked = ctx.currentTime
    const when = asked + wait
    if (wait === 0) {
      const last = lastStart.get(id)
      if (last !== undefined && asked - last < SAME_SOUND_GAP) return
      lastStart.set(id, asked)
    }
    const buffer = buffers.get(`sfx:${id}`)
    if (buffer) {
      startOneShot(buffer, id, volume, playRate, pan, when)
      return
    }
    load('sfx', id).then((decoded) => {
      if (!decoded || !ready) return
      if (ctx.currentTime - when > LATE_LIMIT) return
      startOneShot(decoded, id, volume, playRate, pan, Math.max(when, ctx.currentTime))
    })
  },

  /** Start or stop a looping effect such as 'heartbeat'. */
  loop(name, on) {
    record('sfx', name, 1, 1, { loop: !!on })
    let state = loops.get(name)
    if (!state) {
      state = { wanted: false, source: null, gain: null }
      loops.set(name, state)
    }
    state.wanted = !!on
    if (!ready) return
    if (on) {
      if (!state.source) startLoop(name, state)
      return
    }
    if (state.source) {
      const t = ctx.currentTime
      try {
        state.gain.gain.cancelScheduledValues(t)
        state.gain.gain.setValueAtTime(state.gain.gain.value, t)
        state.gain.gain.linearRampToValueAtTime(0, t + 0.15)
        state.source.stop(t + 0.2)
      } catch {
        // already stopped
      }
      state.source = null
      state.gain = null
    }
  },

  /**
   * Slow motion. 1 is normal. Below 1 the music slows (0.2 plays it at about 0.6 speed), a
   * low-pass closes over it and effects started from now on are pitched down a little.
   * Going back to 1 restores everything in about 0.4 s.
   */
  setTimeScale(scale) {
    const value = clamp(Number.isFinite(scale) ? scale : 1, 0.05, 1)
    record('timescale', null, 1, value)
    timeScale = value
    if (!ready) return
    const t = ctx.currentTime
    graph.musicFilter.frequency.setTargetAtTime(cutoffFor(value), t, RESTORE_TIME)
    if (current.voice) current.voice.source.playbackRate.setTargetAtTime(musicRateFor(value), t, RESTORE_TIME)
  },

  setVolumes({ master, music, sfx } = {}) {
    if (Number.isFinite(master)) volumes.master = clamp(master, 0, 1)
    if (Number.isFinite(music)) volumes.music = clamp(music, 0, 1)
    if (Number.isFinite(sfx)) volumes.sfx = clamp(sfx, 0, 1)
    saveSettings()
    applyVolumes()
  },

  getVolumes() {
    return { master: volumes.master, music: volumes.music, sfx: volumes.sfx }
  },

  setMuted(value) {
    muted = !!value
    saveSettings()
    applyVolumes()
  },

  isMuted() {
    return muted
  },

  /** True once `init` has succeeded and sound can play. */
  get ready() {
    return ready
  },

  /** The loaded manifest.json (null before `init`): every file with its duration and peak. */
  get manifest() {
    return manifest
  },

  /** With film=1 in the page URL: { t, kind, name, volume, rate, ... } for every call, for re-scoring a film. */
  log: [],
}
