// The 3D game as the rest of the app sees it: a stage to show beasts on behind
// the menus, and `fight()` to run a fight to the end.

import * as THREE from 'three'
import { Stage } from './stage.js'
import { Arena } from './arena.js'
import { Fx } from './fx.js'
import { Effects } from './effects.js'
import { Hud } from './hud.js'
import { Fight } from './fight.js'
import { Beast } from './beast/beast.js'
import { DenSession, DuelSession, PracticeSession } from './sessions.js'
import { evolve } from './evolve.js'

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const DETAIL = { low: 0.45, medium: 0.8, high: 1 }

export function createGame({ canvas, hudRoot, tables, core, audio, api, format }) {
  const params = new URLSearchParams(window.location.search)
  const film = params.has('film')
  let saved = null
  try {
    saved = localStorage.getItem('maul-quality')
  } catch {
    saved = null
  }
  const quality = params.get('quality') || saved || (film ? 'high' : 'medium')
  const stage = new Stage(canvas, { quality, film, governed: !film && !params.get('quality') && !saved })
  const arena = new Arena(stage)
  const fx = new Fx(stage)
  fx.detail = DETAIL[stage.quality] ?? 0.8
  stage.onQuality = (name) => {
    fx.detail = DETAIL[name] ?? 0.8
    arena.setQuality(name)
  }
  arena.setQuality(stage.quality)
  const effects = new Effects(stage, arena, fx)
  const hud = new Hud(hudRoot, { tables, core, audio, format })
  const game = { stage, arena, fx, effects, hud, tables, core, audio, api, format, busy: false }
  const showcase = new Showcase(game)
  stage.start()

  async function fight(options) {
    if (game.busy) throw new Error('A fight is already under way.')
    game.busy = true
    document.body.classList.add('in-fight')
    showcase.pause()
    let session
    let run
    let result
    try {
      if (options.mode === 'practice') session = new PracticeSession({ squad: options.squad, den: options.den ?? 0, tables })
      else if (options.mode === 'den') session = new DenSession({ match: options.match, api, tables })
      else session = new DuelSession({ match: options.match, api })
      run = new Fight(game, session)
      // For tests and the film: the fight in progress.
      game.current = run
      result = await run.run()
    } catch (error) {
      console.error(error)
      if (run) run.close()
      result = { won: false, match: session?.match ?? null, error: error.message || String(error) }
    }
    document.body.classList.remove('in-fight')
    game.busy = false
    showcase.resume()
    audio?.music?.('street')
    return result
  }

  return { game, showcase, fight, stage }
}

/**
 * The stage behind the menus: one to three beasts under the lamp, and a camera
 * that keeps them inside whatever rectangle the menus leave clear.
 */
class Showcase {
  constructor(game) {
    this.game = game
    this.stage = game.stage
    this.beasts = []
    this.cache = new Map()
    this.frameEl = null
    this.last = null
    this.paused = false
    this.t = 0
    this.stage.add((dt, realDt) => this.update(dt, realDt))
    this.idle()
  }

  key(build) {
    // One body per form: levels inside a form look the same.
    return `${build.species}:${build.aura ?? 0}:${this.game.core.form(build.level ?? 1)}`
  }

  /** builds: [{ species, level, aura, finisher, token }] — one to three. */
  show(builds, options = {}) {
    this.last = { builds, options }
    if (this.paused) return
    if (this.evolving) {
      // A beast is changing form: whatever was asked for is shown once it has finished.
      this.waiting = { builds, options }
      return
    }
    // The same beast, shown again at a level that wears a later form: play the change.
    const now = this.beasts.length === 1 ? this.beasts[0] : null
    const next = builds && builds.length === 1 ? builds[0] : null
    if (now && next && !options.preview && now.species === next.species && (now.wear.token ?? -1) === (next.token ?? next.species + 1) && this.game.core.form(next.level ?? 1) > now.form) {
      this.evolving = true
      for (const life of this.lives || []) life.stop()
      this.lives = []
      evolve(this.game, now, next.level, { camera: false })
        .then((grown) => {
          this.cache.set(this.key(next), grown)
          this.beasts = [grown]
          this.lives = [grown.life]
        })
        .catch((error) => console.error(error))
        .finally(() => {
          this.evolving = false
          const waiting = this.waiting
          this.waiting = null
          if (waiting) this.show(waiting.builds, waiting.options)
        })
      return
    }
    for (const beast of this.beasts) this.stage.scene.remove(beast.group)
    for (const life of this.lives || []) life.stop()
    this.beasts = []
    this.lives = []
    const list = (builds || []).slice(0, 3)
    const layout = options.layout || (list.length > 1 ? 'lineup' : 'single')
    list.forEach((build, i) => {
      const key = this.key(build)
      let beast = this.cache.get(key)
      if (!beast || this.beasts.includes(beast)) {
        beast = new Beast(build.species, { level: build.level ?? 1, aura: build.aura ?? 0, finisher: build.finisher ?? 0, token: build.token ?? build.species + 1 })
        this.cache.set(key, beast)
        if (this.cache.size > 6) {
          const [oldKey, old] = this.cache.entries().next().value
          if (!this.beasts.includes(old) && old !== beast) {
            this.cache.delete(oldKey)
            old.dispose()
          }
        }
      }
      beast.dead = false
      beast.rage = 0
      if (layout === 'versus') {
        beast.face(i === 0 ? 1 : -1)
        beast.group.position.set(i === 0 ? -3.1 : 3.1, 0, 0)
      } else if (layout === 'lineup') {
        const x = (i - (list.length - 1) / 2) * 4.1
        beast.face(1)
        beast.group.position.set(x, 0, i === (options.focus ?? 1) ? 0.6 : -0.6)
        beast.group.rotation.y = -0.55
      } else {
        beast.face(1)
        beast.group.position.set(0, 0, 0)
        beast.group.rotation.y = -0.5
      }
      this.stage.scene.add(beast.group)
      this.beasts.push(beast)
      this.lives.push(this.game.effects.life(beast))
    })
    this.aim(layout)
  }

  aim(layout) {
    const rig = this.stage.rig
    const tall = Math.max(2, ...this.beasts.map((b) => b.height))
    if (layout === 'lineup' && this.beasts.length > 1) {
      rig.move({ pos: V(0.5, 2.0 + tall * 0.2, 10.9), look: V(0, tall * 0.42, 0), fov: 40 }, 2.2)
    } else if (layout === 'versus') {
      rig.move({ pos: V(0, 2.1 + tall * 0.2, 10.6), look: V(0, tall * 0.45, 0), fov: 38 }, 2.2)
    } else {
      rig.move({ pos: V(1.5, 1.4 + tall * 0.24, Math.min(10.8, 5.6 + tall * 1.2)), look: V(0.2, tall * 0.46, 0), fov: 33 }, 2.2)
    }
  }

  /** The camera at rest over an empty pit. */
  idle() {
    this.stage.rig.move({ pos: V(-3, 3.2, 11), look: V(0, 1.4, 0), fov: 40 }, 1)
  }

  /** The DOM element whose rectangle the beast should sit in. Null for the middle of the screen. */
  frame(el) {
    this.frameEl = el || null
  }

  clear() {
    this.last = null
    for (const beast of this.beasts) this.stage.scene.remove(beast.group)
    for (const life of this.lives || []) life.stop()
    this.beasts = []
    this.lives = []
    this.idle()
  }

  pause() {
    this.paused = true
    for (const beast of this.beasts) this.stage.scene.remove(beast.group)
    for (const life of this.lives || []) life.stop()
    this.beasts = []
    this.lives = []
    this.stage.rig.setOffset(0, 0)
  }

  resume() {
    this.paused = false
    if (this.last) this.show(this.last.builds, this.last.options)
    else this.idle()
  }

  update(dt, realDt) {
    if (this.paused) return
    this.t += realDt
    for (const beast of this.beasts) beast.update(dt)
    // Keep the subject in the clear part of the screen.
    const rig = this.stage.rig
    if (this.frameEl && this.frameEl.isConnected) {
      const rect = this.frameEl.getBoundingClientRect()
      const w = window.innerWidth
      const h = window.innerHeight
      if (rect.width > 10 && rect.height > 10) {
        rig.setOffset(((rect.left + rect.width / 2) / w) * 2 - 1, -(((rect.top + rect.height / 2) / h) * 2 - 1))
        return
      }
    }
    rig.setOffset(0, 0)
  }
}
