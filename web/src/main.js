// Maul Street: start-up.
//
// Loads the rules module, starts the 3D game on the canvas, connects the NEAR
// layer and mounts the menus. Each part is loaded on its own so that one
// failing never leaves the player with a blank page.

import { loadCore, core } from './core.js'
import { bridge } from './bridge.js'

// The parts that may be missing or broken without stopping the rest.
const parts = import.meta.glob(['./audio.js', './near/api.js', './near/format.js', './ui/index.js'])

async function optional(path, label) {
  const load = parts[path]
  if (!load) {
    console.warn(`${label} is not in this build.`)
    return null
  }
  try {
    return await load()
  } catch (error) {
    console.warn(`${label} did not load:`, error)
    return null
  }
}

const fallbackFormat = {
  near(yocto, digits = 2) {
    const value = BigInt(yocto || '0')
    const unit = 10n ** BigInt(24 - digits)
    const whole = value / unit
    if (whole === 0n && value > 0n) return `<0.${'0'.repeat(digits - 1)}1`
    const text = whole.toString().padStart(digits + 1, '0')
    return `${text.slice(0, -digits)}.${text.slice(-digits)}`
  },
}

async function boot() {
  const params = new URLSearchParams(window.location.search)
  const tables = await loadCore(new URL(`${import.meta.env.BASE_URL}maul_core.wasm`, window.location.href))
  window.maul = { tables, bridge, core }

  if (params.get('view') === 'beast' || params.get('view') === 'line') {
    const { beastBench } = await import('./game/debug.js')
    beastBench(document.getElementById('stage'), params)
    return
  }

  // Sound. Starts on the first click or key, as browsers require.
  const audioModule = await optional('./audio.js', 'Sound')
  const audio = audioModule?.audio ?? bridge.audio
  bridge.audio = audio
  const wake = () => {
    Promise.resolve(audio.init?.()).then(() => audio.music?.(document.body.classList.contains('in-fight') ? 'battle' : 'street'))
    window.removeEventListener('pointerdown', wake)
    window.removeEventListener('keydown', wake)
  }
  window.addEventListener('pointerdown', wake)
  window.addEventListener('keydown', wake)

  // NEAR.
  const near = await optional('./near/api.js', 'The NEAR layer')
  const formatModule = await optional('./near/format.js', 'Number formatting')
  const format = formatModule?.near ? formatModule : fallbackFormat
  const api = near?.api ?? null
  if (api) {
    if (api.setTables) api.setTables(tables)
    else api.tables = tables
  }

  // The 3D game.
  const { createGame } = await import('./game/game.js')
  const game = createGame({ canvas: document.getElementById('stage'), hudRoot: document.getElementById('hud'), tables, core, audio, api, format })
  bridge.stage.show = (builds, options) => game.showcase.show(builds, options)
  bridge.stage.frame = (el) => game.showcase.frame(el)
  bridge.stage.clear = () => game.showcase.clear()
  bridge.fight = (options) => game.fight(options)
  bridge.week = () => {
    let close = () => {}
    import('./game/week.js').then((module) => {
      close = module.openWeek({ core, tables, audio })
    })
    return () => close()
  }
  bridge.quality = () => game.stage.quality
  bridge.setQuality = (name) => {
    game.stage.governed = false
    game.stage.setQuality(name)
    try {
      localStorage.setItem('maul-quality', name)
    } catch {
      // A private window may refuse storage: the choice then lasts for this visit.
    }
  }
  window.maul.game = game
  // For scripted play (tests and the film): the same api the menus use.
  window.maul.api = api
  if (params.has('week')) bridge.week()

  // A straight-to-the-pit link for testing: /?fight=practice&squad=0,1,2&den=0
  if (params.get('fight') === 'practice') {
    const squad = (params.get('squad') || '0,1,2').split(',').map((s) => ({ species: Number(s), level: Number(params.get('level') || 1), relic: 0, aura: Number(params.get('aura') || 0), finisher: Number(params.get('finisher') || 0), token: 0 }))
    window.maul.result = game.fight({ mode: 'practice', squad, den: Number(params.get('den') || 0) })
    return
  }

  // The menus.
  const ui = await optional('./ui/index.js', 'The menus')
  if (api?.init) await api.init()
  if (ui?.mountUi) ui.mountUi(document.getElementById('ui'), { api, bridge, core, format })
  else game.showcase.show([{ species: 0 }], { layout: 'single' })
}

boot().catch((error) => {
  console.error(error)
  const note = document.createElement('div')
  note.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#efe6d6;font:18px system-ui;padding:40px;text-align:center'
  note.textContent = `Maul Street could not start: ${error.message || error}`
  document.body.append(note)
})
