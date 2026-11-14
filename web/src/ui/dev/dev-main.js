// The menus on their own: the mock api, the real rules module, and stand-ins
// for the 3D stage, the fight, the sound and the game's settings.
// See ui-dev.html for the switches.

import { loadCore, core } from '../../core.js'
import { bridge } from '../../bridge.js'
import { mountUi } from '../index.js'
import { createMockApi } from './mock-api.js'

const params = new URLSearchParams(window.location.search)
const flag = (name, fallback) => (params.has(name) ? params.get(name) !== '0' : fallback)
const number = (name, fallback) => (params.has(name) && Number.isFinite(Number(params.get(name))) ? Number(params.get(name)) : fallback)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function boot() {
  const tables = await loadCore(new URL(`${import.meta.env.BASE_URL}maul_core.wasm`, window.location.href))
  const api = createMockApi({
    core,
    tables,
    connected: flag('connected', true),
    registered: flag('registered', true),
    socialEnabled: flag('social', false),
    flaky: number('flaky', 0.1),
    simulate: flag('sim', false),
    midDuel: flag('duel', false),
    delay: number('delay', 400),
  })
  api.setTables(tables)

  // Everything the menus asked of the game, in order, for the test scripts.
  const calls = { stage: [], fights: [], sounds: [], week: 0 }
  const dev = { api, bridge, core, calls, force: null, leaveUnfinished: false }

  // ----- The stage: paint the rectangle the menus hand over -------------------
  const box = document.getElementById('dev-stage')
  const caption = box.querySelector('span')
  let frame = null

  function place() {
    if (frame && frame.isConnected) {
      const rect = frame.getBoundingClientRect()
      box.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none'
      box.style.left = `${rect.left}px`
      box.style.top = `${rect.top}px`
      box.style.width = `${rect.width}px`
      box.style.height = `${rect.height}px`
    } else {
      box.style.display = 'none'
    }
    requestAnimationFrame(place)
  }
  requestAnimationFrame(place)

  const describe = (build) => {
    const worn = [build.aura, build.finisher].filter(Boolean).map((id) => tables.items.find((item) => item.id === id)?.name)
    return `${core.formName(build.species, build.level || 1)} lv ${build.level || 1}${worn.length ? ` + ${worn.join(', ')}` : ''}`
  }
  bridge.stage.frame = (el) => {
    frame = el || null
    calls.stage.push({ frame: el ? 'element' : null })
  }
  bridge.stage.show = (builds, opts) => {
    caption.textContent = `3D stage · ${builds.map(describe).join('  ·  ')}  (${opts.layout}, ${opts.mood}${opts.preview ? ', preview' : ''})`
    calls.stage.push({ show: builds, opts })
  }
  bridge.stage.clear = () => {
    caption.textContent = '3D stage · cleared'
    calls.stage.push({ clear: true })
  }

  // ----- The fight: hide the menus for a moment, then let the rules decide ------
  bridge.fight = async (opts) => {
    calls.fights.push(opts)
    document.body.classList.add('in-fight')
    await sleep(number('fight', 900))
    let result
    if (opts.mode === 'practice') {
      result = { won: dev.force ? dev.force === 'win' : true, match: null }
    } else if (dev.leaveUnfinished) {
      result = { won: false, match: opts.match }
    } else {
      const match = api.dev.playOut(opts.match.id, dev.force)
      result = { won: match.winner === match.players.indexOf(api.dev.me), match }
    }
    document.body.classList.remove('in-fight')
    return result
  }

  // ----- Sound and settings: keep a note instead of doing anything ---------------
  let muted = false
  let volumes = { master: 0.8, music: 0.6, sfx: 1 }
  let quality = 'medium'
  bridge.audio = {
    ...bridge.audio,
    sfx: (name) => calls.sounds.push(name),
    music: (name) => calls.sounds.push(`music:${name}`),
    setMuted: (value) => {
      muted = !!value
    },
    isMuted: () => muted,
    getVolumes: () => ({ ...volumes }),
    setVolumes: (next = {}) => {
      volumes = { ...volumes, ...next }
    },
  }
  bridge.quality = () => quality
  bridge.setQuality = (name) => {
    quality = name
  }
  bridge.week = () => {
    calls.week += 1
    return () => {}
  }

  await api.init()
  const { app } = mountUi(document.getElementById('ui'), { api, bridge, core })
  dev.app = app
  window.maulDev = dev

  if (params.get('tab') && app) app.go(params.get('tab'), { pitView: params.get('pit') || undefined })
}

boot().catch((error) => {
  console.error(error)
  document.getElementById('ui').textContent = `The dev page did not start: ${error.message}`
})
