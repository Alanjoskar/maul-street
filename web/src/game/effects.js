// Effect recipes: what a bite, a Special or a kill looks like. Each one is a
// short function that throws particles, light and camera kicks at the stage.

import * as THREE from 'three'
import { SPRITE } from './fx.js'
import { surface } from './textures.js'
import { ASPECT_COLOURS } from './beast/species.js'

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const tmp = V()

// The look of each aspect's power: [core, mid, dark].
export const ASPECT_FX = [
  { core: '#fff2c0', mid: '#ff8a1e', dark: '#c21a00' }, // Ember
  { core: '#f0ffc0', mid: '#8ee63a', dark: '#2f6a12' }, // Thorn
  { core: '#fff0c8', mid: '#e0a84a', dark: '#6a4a1c' }, // Stone
  { core: '#ffffff', mid: '#b79cff', dark: '#5a3cff' }, // Storm
  { core: '#f0ffff', mid: '#5ad8ff', dark: '#1474c8' }, // Tide
]

export class Effects {
  constructor(stage, arena, fx) {
    this.stage = stage
    this.arena = arena
    this.fx = fx
    this.scene = stage.scene
    this.props = []
    this.lights = []
    this.rock = null
    stage.add((dt) => this.update(dt))
    this.torches()
    this.motes()
  }

  r(a = 1, b) {
    return this.fx.rand(a, b)
  }

  // ----- Always on ----------------------------------------------------------------

  torches() {
    const fx = this.fx
    const handle = fx.emitter((dt) => {
      for (const torch of this.arena.torches) {
        const p = torch.position
        if (this.r() < dt * 26 * fx.detail) {
          fx.spawn({ p: [p.x + this.r(-0.07, 0.07), p.y - 0.12, p.z + this.r(-0.07, 0.07)], v: [this.r(-0.15, 0.15), this.r(1.2, 2.1), this.r(-0.15, 0.15)], life: this.r(0.4, 0.75), size: this.r(0.45, 0.7), size2: 0.1, colour: '#ffc866', colour2: '#ff3a05', alpha: 0.85, sprite: SPRITE.flame, add: true, swirl: 1.5, rot: 0, boost: 1.6 })
        }
        if (this.r() < dt * 2.2 * fx.detail) {
          fx.spawn({ p: [p.x, p.y + 0.2, p.z], v: [this.r(-0.3, 0.3), this.r(0.8, 1.8), this.r(-0.3, 0.3)], life: this.r(1.2, 2.6), size: 0.05, colour: '#ffb050', colour2: '#ff3a05', sprite: SPRITE.mote, add: true, swirl: 2.2, boost: 2.5 })
        }
      }
    })
    handle.keep = true
  }

  /** Dust hanging in the lamp's shaft of light, and embers drifting across the pit. */
  motes() {
    const fx = this.fx
    const handle = fx.emitter((dt) => {
      if (this.r() < dt * 9 * fx.detail) {
        const a = this.r(6.28)
        const d = this.r(0.5, 6.5)
        fx.spawn({ p: [Math.cos(a) * d, this.r(0.4, 7), Math.sin(a) * d], v: [this.r(-0.12, 0.12), this.r(-0.05, 0.1), this.r(-0.12, 0.12)], life: this.r(4, 8), size: this.r(0.025, 0.06), colour: '#ffdcae', alpha: 0.5, sprite: SPRITE.mote, add: true, swirl: 0.25, fadeIn: 0.3, fadeOut: 0.6 })
      }
      if (this.r() < dt * 1.6 * fx.detail) {
        const a = this.r(6.28)
        fx.spawn({ p: [Math.cos(a) * 11, this.r(0.5, 3), Math.sin(a) * 11], v: [-Math.cos(a) * this.r(0.3, 0.9), this.r(0.3, 0.9), -Math.sin(a) * this.r(0.3, 0.9)], life: this.r(3, 6), size: 0.05, colour: '#ff9a40', colour2: '#ff3000', sprite: SPRITE.mote, add: true, swirl: 1.2, boost: 2.2 })
      }
    })
    handle.keep = true
  }

  /**
   * Everything that clings to one beast while it is in the pit: the species'
   * own atmosphere, a bought aura, tiredness, and lasting effects
   * (set `beast.status = { burn, bleed, sunder, shock, soak }`; bleed is shown as Winded).
   */
  life(beast) {
    const fx = this.fx
    const kind = beast.spec.fx?.ambient
    const colour = beast.spec.fx?.colour ?? '#ffffff'
    const aura = beast.wear?.aura ?? 0
    const p = V()
    const pick = () => beast.vertex(beast.outer[Math.floor(this.r() * beast.outer.length)], p)
    let t = 0
    return fx.emitter((dt) => {
      if (!beast.group.parent) return false
      t += dt
      const d = fx.detail
      const alive = !beast.dead
      // ----- The species' own atmosphere.
      if (alive && kind === 'embers') {
        // Fire lives in the mane and along the spine.
        for (const socket of ['head', 'back']) {
          if (this.r() < dt * 16 * d) {
            beast.point(socket, p)
            const back = socket === 'head' ? -0.45 * beast.facing : 0
            fx.spawn({ p: [p.x + back + this.r(-0.22, 0.22), p.y + this.r(-0.05, 0.15), p.z + this.r(-0.22, 0.22)], v: [this.r(-0.15, 0.15), this.r(1.1, 2.1), this.r(-0.15, 0.15)], life: this.r(0.22, 0.45), size: this.r(0.13, 0.26), size2: 0.03, colour: '#ffb347', colour2: '#ff3a00', alpha: 0.72, sprite: SPRITE.flame, add: true, swirl: 1.6, rot: 0, boost: 1.1 })
          }
        }
        if (this.r() < dt * 5 * d) {
          pick()
          fx.spawn({ p, v: [this.r(-0.4, 0.4), this.r(0.8, 2), this.r(-0.4, 0.4)], life: this.r(0.8, 1.8), size: 0.045, colour: '#ffb050', colour2: '#ff2a00', sprite: SPRITE.mote, add: true, swirl: 2.5, boost: 2.6 })
        }
      } else if (alive && kind === 'spores') {
        if (this.r() < dt * 7 * d) {
          pick()
          fx.spawn({ p, v: [this.r(-0.25, 0.25), this.r(0.1, 0.5), this.r(-0.25, 0.25)], life: this.r(2, 4), size: this.r(0.03, 0.07), colour, alpha: 0.8, sprite: SPRITE.mote, add: true, swirl: 0.8, fadeIn: 0.2, boost: 1.6 })
        }
      } else if (alive && kind === 'dust') {
        if (this.r() < dt * 5 * d) {
          pick()
          fx.spawn({ p, v: [this.r(-0.2, 0.2), -0.2, this.r(-0.2, 0.2)], life: this.r(0.8, 1.4), size: this.r(0.03, 0.06), colour: '#8a7a62', sprite: SPRITE.chip, gravity: 6, ground: true, spin: 6 })
        }
      } else if (alive && kind === 'sparks') {
        if (this.r() < dt * 5 * d) {
          pick()
          fx.spawn({ p, life: this.r(0.06, 0.14), size: this.r(0.25, 0.6), colour, sprite: SPRITE.arc, add: true, fadeIn: 0.01, fadeOut: 0.5, boost: 2.5 })
        }
      } else if (alive && kind === 'drips') {
        if (this.r() < dt * 7 * d) {
          beast.point(this.r() < 0.5 ? 'belly' : 'mouth', p)
          fx.spawn({ p: [p.x + this.r(-0.4, 0.4), p.y, p.z + this.r(-0.2, 0.2)], v: [0, -0.5, 0], life: 1.5, size: this.r(0.035, 0.06), colour: '#bfefff', alpha: 0.85, sprite: SPRITE.drop, gravity: 9, ground: true, stretch: 1.2 })
        }
      } else if (alive && kind === 'glints') {
        if (this.r() < dt * 3 * d) {
          beast.point('back', p)
          fx.spawn({ p: [p.x + this.r(-0.9, 0.9), p.y + this.r(-0.1, 0.5), p.z + this.r(-0.2, 0.2)], life: this.r(0.25, 0.5), size: this.r(0.2, 0.5), colour, sprite: SPRITE.flare, add: true, fadeIn: 0.3, fadeOut: 0.5, boost: 2 })
        }
      }
      // ----- A bought aura.
      if (alive && aura === 20 && this.r() < dt * 9 * d) {
        beast.point('belly', p)
        fx.spawn({ p: [p.x + this.r(-1, 1), this.r(0.1, 1.2), p.z + this.r(-0.7, 0.7)], v: [this.r(-0.2, 0.2), this.r(0.1, 0.5), this.r(-0.2, 0.2)], life: this.r(1.2, 2.2), size: this.r(0.7, 1.2), size2: 1.8, colour: '#ff8a3a', alpha: 0.14, sprite: SPRITE.smoke, add: true, fadeIn: 0.3 })
      } else if (alive && aura === 21 && this.r() < dt * 12 * d) {
        beast.point('chest', p)
        const a = t * 1.4 + this.r(6.28)
        const rad = beast.height * 0.55
        fx.spawn({ p: [p.x + Math.cos(a) * rad, p.y + this.r(-0.5, 0.9), p.z + Math.sin(a) * rad], v: [-Math.sin(a) * 0.9, 0.25, Math.cos(a) * 0.9], life: this.r(0.8, 1.5), size: this.r(0.05, 0.1), colour: '#ffe9a0', colour2: '#d8a548', sprite: SPRITE.mote, add: true, boost: 2.4 })
      } else if (alive && aura === 22 && this.r() < dt * 9 * d) {
        beast.point('back', p)
        fx.spawn({ p: [p.x + this.r(-0.6, 0.6), p.y, p.z + this.r(-0.3, 0.3)], v: [this.r(-0.15, 0.15), this.r(0.7, 1.4), this.r(-0.15, 0.15)], life: this.r(0.9, 1.6), size: this.r(0.25, 0.45), size2: 0.05, colour: '#3a1a6a', colour2: '#0a0418', alpha: 0.75, sprite: SPRITE.flame, swirl: 1.6, rot: 0 })
      } else if (alive && aura === 23 && this.r() < dt * 7 * d) {
        beast.point('head', p)
        fx.spawn({ p: [p.x + this.r(-0.45, 0.45), p.y + this.r(0.2, 0.6), p.z + this.r(-0.45, 0.45)], life: this.r(0.06, 0.12), size: this.r(0.3, 0.7), colour: '#cfd8ff', sprite: SPRITE.arc, add: true, fadeIn: 0.01, boost: 3 })
      }
      const status = beast.status || {}
      if (!alive) return
      // ----- Tired: as health runs low, sweat flies off the brow and breath comes in puffs.
      const tired = beast.tired || 0
      if (tired > 0.2) {
        if (this.r() < dt * 2.4 * tired * d) {
          beast.point('head', p)
          fx.spawn({ p: [p.x + this.r(-0.15, 0.15), p.y + this.r(0.05, 0.25), p.z + this.r(-0.15, 0.15)], v: [this.r(-0.9, 0.9), this.r(1.3, 2.3), this.r(-0.4, 0.4)], life: 0.9, size: this.r(0.05, 0.085), colour: '#e6f6ff', alpha: 0.95, sprite: SPRITE.drop, gravity: 7, stretch: 1.2 })
        }
        if (this.r() < dt * 3.4 * tired * d) {
          beast.point('mouth', p)
          fx.spawn({ p: [p.x + beast.facing * 0.08, p.y - 0.02, p.z], v: [beast.facing * this.r(0.4, 0.9), this.r(0.05, 0.3), this.r(-0.15, 0.15)], life: this.r(0.5, 0.8), size: this.r(0.1, 0.16), size2: this.r(0.35, 0.5), colour: '#ffffff', alpha: 0.32, sprite: SPRITE.smoke, drag: 1.6, grow: true, fadeIn: 0.05 })
        }
      }
      // ----- Lasting effects.
      if (status.burn && this.r() < dt * 30 * d) {
        pick()
        fx.spawn({ p, v: [this.r(-0.2, 0.2), this.r(1, 2), this.r(-0.2, 0.2)], life: this.r(0.3, 0.6), size: this.r(0.3, 0.55), size2: 0.05, colour: '#ffd27a', colour2: '#ff2a00', alpha: 0.9, sprite: SPRITE.flame, add: true, swirl: 1.4, rot: 0, boost: 1.6 })
        if (this.r() < 0.2) fx.spawn({ p, v: [0, 1.2, 0], life: 1.1, size: 0.4, size2: 1.1, colour: '#1a1614', alpha: 0.3, sprite: SPRITE.smoke, drag: 1 })
      }
      if (status.shock && this.r() < dt * 16 * d) {
        pick()
        fx.spawn({ p, life: this.r(0.05, 0.12), size: this.r(0.4, 0.9), colour: '#d8ccff', sprite: SPRITE.arc, add: true, fadeIn: 0.01, boost: 3 })
      }
      if (status.soak && this.r() < dt * 22 * d) {
        pick()
        fx.spawn({ p, v: [this.r(-0.2, 0.2), -0.4, this.r(-0.2, 0.2)], life: 1.4, size: this.r(0.04, 0.07), colour: '#bfefff', alpha: 0.9, sprite: SPRITE.drop, gravity: 10, ground: true, stretch: 1.3 })
      }
      if (status.sunder && this.r() < dt * 14 * d) {
        pick()
        fx.spawn({ p, v: [this.r(-0.5, 0.5), this.r(0, 0.6), this.r(-0.5, 0.5)], life: 1.2, size: this.r(0.04, 0.09), colour: '#9a8a6a', sprite: SPRITE.chip, gravity: 9, ground: true, spin: 8, bounce: 0.3 })
      }
    })
  }

  // ----- Blows -----------------------------------------------------------------------

  /** The flash and sparks where a blow lands. `power` 0.5 (a jab) to 2 (a killing blow). */
  impact(pos, { power = 1, colour = '#ffe6b0', dir = null } = {}) {
    const fx = this.fx
    fx.spawn({ p: pos, life: 0.09, size: 0.7 * power, size2: 1.6 * power, colour, alpha: 0.6, sprite: SPRITE.flare, add: true, fadeIn: 0.01, fadeOut: 0.2, boost: 1.1, rot: this.r(6) })
    fx.spawn({ p: pos, life: 0.2, size: 0.35 * power, size2: 2.2 * power, colour, alpha: 0.42, sprite: SPRITE.ring, add: true, grow: true, fadeIn: 0.01, fadeOut: 0.2, boost: 1.2 })
    const n = Math.round(10 + power * 12)
    for (let i = 0; i < n; i++) {
      const a = this.r(6.28)
      const up = this.r(-0.4, 1)
      const speed = this.r(4, 12) * (0.6 + power * 0.4)
      const d = dir ? 0.6 : 0
      fx.spawn({ p: pos, v: [(Math.cos(a) * (1 - d) + (dir?.x ?? 0) * d) * speed, up * speed * 0.7, (Math.sin(a) * (1 - d) + (dir?.z ?? 0) * d) * speed], life: this.r(0.2, 0.5), size: this.r(0.05, 0.1), colour: '#ffffff', colour2: colour, sprite: SPRITE.streak, add: true, gravity: 9, drag: 1.5, stretch: 2.2, boost: 3 })
    }
    this.stage.kick({ chroma: 0.012 * power, blur: 0.22 * power, flash: 0.02 * power, flashColour: colour })
    this.stage.rig.shake(0.22 * power)
    this.flashLight(pos, colour, 60 * power, 0.25)
  }

  /** Sand kicked up at `pos`. */
  dust(pos, amount = 1, colour = '#a08a6a') {
    const fx = this.fx
    const n = Math.round(8 * amount * Math.max(0.5, fx.detail)) + 3
    for (let i = 0; i < n; i++) {
      const a = this.r(6.28)
      const speed = this.r(0.8, 3.2) * Math.sqrt(amount)
      fx.spawn({ p: [pos.x + Math.cos(a) * 0.2, 0.12, pos.z + Math.sin(a) * 0.2], v: [Math.cos(a) * speed, this.r(0.3, 1.4), Math.sin(a) * speed], life: this.r(0.8, 1.6), size: this.r(0.35, 0.7), size2: this.r(1.2, 2.2), colour, alpha: 0.34, sprite: SPRITE.smoke, drag: 2.2, grow: true, fadeIn: 0.05, fadeOut: 0.25, spin: this.r(-0.6, 0.6) })
    }
  }

  /** Chunks of whatever was hit, bouncing away. */
  debris(pos, n = 12, colour = '#7a6c58', speed = 1) {
    for (let i = 0; i < n; i++) {
      const a = this.r(6.28)
      const s = this.r(2, 7) * speed
      this.fx.spawn({ p: [pos.x, Math.max(0.1, pos.y), pos.z], v: [Math.cos(a) * s, this.r(2, 7.5) * speed, Math.sin(a) * s], life: this.r(1.2, 2.2), size: this.r(0.06, 0.18), colour, sprite: this.r() < 0.5 ? SPRITE.chip : SPRITE.shard, gravity: 15, ground: true, bounce: 0.38, spin: this.r(-9, 9), fadeOut: 0.85 })
    }
  }

  /** A strike caught on a guard: hard sparks. */
  block(pos, dir) {
    this.impact(pos, { power: 0.75, colour: '#cfe0ff', dir })
    for (let i = 0; i < 14; i++) {
      const a = this.r(6.28)
      this.fx.spawn({ p: pos, v: [Math.cos(a) * this.r(2, 8) - dir.x * 3, this.r(0, 5), Math.sin(a) * this.r(2, 8) - dir.z * 3], life: this.r(0.25, 0.6), size: 0.06, colour: '#ffffff', colour2: '#ffb050', sprite: SPRITE.streak, add: true, gravity: 12, stretch: 2.4, boost: 3 })
    }
  }

  /** A guard shattering under a Break. */
  guardCrush(pos, aspect) {
    const look = ASPECT_FX[aspect] ?? ASPECT_FX[2]
    this.impact(pos, { power: 1.5, colour: look.core })
    this.debris(pos, 22, look.mid, 1.2)
    this.fx.ring(V(pos.x, 0, pos.z), { colour: look.mid, to: 5, life: 0.45, power: 2.2 })
  }

  /** A short-lived light at a point: every big hit lights the pit for a moment. */
  flashLight(pos, colour, power = 120, seconds = 0.3) {
    let light = this.lights.find((l) => l.left <= 0)
    if (!light) {
      if (this.lights.length >= 3) return
      light = { light: new THREE.PointLight(0xffffff, 0, 16, 1.8), left: 0, total: 1, power: 0 }
      this.scene.add(light.light)
      this.lights.push(light)
    }
    light.light.color.set(colour)
    // Held well above the sand: a light close to the pale floor floods the whole frame white.
    light.light.position.set(pos.x, Math.max(1.6, pos.y + 1.0), pos.z)
    light.left = light.total = seconds
    light.power = power * 0.2
  }

  // ----- The Rage bar and the Special ----------------------------------------------------

  /** The moment a Rage bar fills. */
  rageFull(beast) {
    const look = ASPECT_FX[beast.aspect] ?? ASPECT_FX[0]
    const p = beast.point('chest')
    this.fx.ring(V(p.x, 0, p.z), { colour: look.mid, to: 3.4, life: 0.5, power: 2.4 })
    for (let i = 0; i < 26; i++) {
      const a = this.r(6.28)
      const d = this.r(0.3, 1.3)
      this.fx.spawn({ p: [p.x + Math.cos(a) * d, 0.1, p.z + Math.sin(a) * d], v: [0, this.r(2.5, 6), 0], life: this.r(0.5, 0.9), size: this.r(0.06, 0.12), colour: look.core, colour2: look.mid, sprite: SPRITE.streak, add: true, stretch: 2.5, boost: 3 })
    }
    beast.glowBoost = 1
  }

  /** Power gathering before a Special. Returns a handle to stop it. */
  charge(beast) {
    const look = ASPECT_FX[beast.aspect] ?? ASPECT_FX[0]
    const centre = V()
    let t = 0
    return this.fx.emitter((dt) => {
      t += dt
      beast.point('chest', centre)
      beast.glowBoost = Math.min(1.5, t * 1.4)
      const rate = 60 + t * 60
      const n = Math.floor(rate * dt + this.r())
      for (let i = 0; i < n; i++) {
        const a = this.r(6.28)
        const b = this.r(-0.3, 1.2)
        const d = this.r(2.2, 3.6)
        const from = [centre.x + Math.cos(a) * Math.cos(b) * d, Math.max(0.1, centre.y + Math.sin(b) * d), centre.z + Math.sin(a) * Math.cos(b) * d]
        const life = this.r(0.35, 0.55)
        this.fx.spawn({ p: from, v: [(centre.x - from[0]) / life, (centre.y - from[1]) / life, (centre.z - from[2]) / life], life, size: this.r(0.08, 0.16), size2: 0.03, colour: look.mid, colour2: look.core, sprite: SPRITE.streak, add: true, stretch: 2.2, fadeIn: 0.2, fadeOut: 0.9, boost: 2.6 })
      }
      if (this.r() < dt * 9) {
        this.fx.spawn({ p: centre, life: 0.3, size: 0.6, size2: 2.2 + t, colour: look.mid, alpha: 0.5, sprite: SPRITE.glow, add: true, grow: true })
      }
      if (this.r() < dt * 3) this.fx.ring(V(centre.x, 0, centre.z), { colour: look.dark, from: 3.6, to: 0.5, life: 0.4, power: 1.6 })
    })
  }

  /**
   * A Special lands. Each aspect has its own way of ruining a beast.
   * `from` is where the attacker is, `at` where the blow lands (the target's chest).
   */
  special(aspect, from, at, { guarded = false } = {}) {
    const look = ASPECT_FX[aspect] ?? ASPECT_FX[0]
    const fx = this.fx
    const scale = guarded ? 0.6 : 1
    const ground = V(at.x, 0, at.z)
    const dir = V(at.x - from.x, 0, at.z - from.z).normalize()
    this.stage.kick({ chroma: 0.045 * scale, blur: 0.8 * scale, flash: 0.14 * scale, flashColour: look.mid })
    this.stage.rig.shake(0.9 * scale)
    this.flashLight(at, look.mid, 260 * scale, 0.5)
    fx.ring(ground, { colour: look.mid, to: 9 * scale, life: 0.7, width: 0.5, power: 3 })
    fx.spawn({ p: at, life: 0.1, size: 1.6, size2: 4.2 * scale, colour: look.core, alpha: 0.8, sprite: SPRITE.flare, add: true, fadeIn: 0.01, fadeOut: 0.2, boost: 1.6 })

    if (aspect === 0) {
      // Ember: a blast of fire, then smoke and a scorched ring.
      for (let i = 0; i < 70 * scale; i++) {
        const a = this.r(6.28)
        const s = this.r(1, 8)
        fx.spawn({ p: [at.x, at.y * this.r(0.3, 1), at.z], v: [Math.cos(a) * s, this.r(1, 7), Math.sin(a) * s], life: this.r(0.5, 1.1), size: this.r(0.6, 1.3), size2: 0.15, colour: '#fff0b0', colour2: '#ff2a00', alpha: 0.95, sprite: SPRITE.flame, add: true, drag: 2.2, swirl: 2, rot: 0, boost: 1.8 })
      }
      for (let i = 0; i < 24 * scale; i++) {
        const a = this.r(6.28)
        fx.spawn({ p: [at.x, at.y * 0.6, at.z], v: [Math.cos(a) * this.r(0.5, 2.5), this.r(1, 3), Math.sin(a) * this.r(0.5, 2.5)], life: this.r(1.4, 2.6), size: 0.9, size2: 3.2, colour: '#1c1612', alpha: 0.5, sprite: SPRITE.smoke, drag: 1.2, grow: true, fadeIn: 0.15, fadeOut: 0.3 })
      }
      for (let i = 0; i < 60 * scale; i++) {
        const a = this.r(6.28)
        const s = this.r(3, 14)
        fx.spawn({ p: at, v: [Math.cos(a) * s, this.r(2, 12), Math.sin(a) * s], life: this.r(0.6, 1.6), size: 0.07, colour: '#ffe9a0', colour2: '#ff3a00', sprite: SPRITE.streak, add: true, gravity: 7, drag: 1, stretch: 2, boost: 3 })
      }
    } else if (aspect === 1) {
      // Thorn: roots burst from the sand and take what they hold.
      this.roots(ground, at, scale)
      for (let i = 0; i < 46 * scale; i++) {
        const a = this.r(6.28)
        const s = this.r(1, 6)
        fx.spawn({ p: [at.x, at.y * this.r(0.2, 1), at.z], v: [Math.cos(a) * s, this.r(1, 6), Math.sin(a) * s], life: this.r(1.2, 2.4), size: this.r(0.12, 0.26), colour: '#8ee63a', colour2: '#3a5a12', sprite: SPRITE.leaf, gravity: 3.5, drag: 1.6, spin: this.r(-7, 7), swirl: 3 })
      }
      this.dust(ground, 2.5, '#6a5a3a')
      // What it drains flows back to the attacker.
      for (let i = 0; i < 30 * scale; i++) {
        const life = this.r(0.7, 1.1)
        const start = [at.x + this.r(-0.5, 0.5), at.y + this.r(-0.6, 0.6), at.z + this.r(-0.5, 0.5)]
        fx.spawn({ p: start, v: [(from.x - start[0]) / life, (from.y + 0.2 - start[1]) / life + this.r(0.5, 2), (from.z - start[2]) / life], life, size: this.r(0.14, 0.28), size2: 0.06, colour: '#e6ffb0', colour2: '#6fd13a', sprite: SPRITE.glow, add: true, gravity: 3, fadeIn: 0.25, boost: 2.4 })
      }
    } else if (aspect === 2) {
      // Stone: the ground itself comes up.
      this.spikes(from, ground, dir, scale, look)
      this.debris(at, Math.round(46 * scale), '#8a7a62', 1.5)
      this.dust(ground, 5, '#8a7860')
      this.stage.rig.shake(0.6)
    } else if (aspect === 3) {
      // Storm: the sky answers.
      const strikes = guarded ? 1 : 3
      for (let i = 0; i < strikes; i++) {
        fx.over(i * 0.09 + 0.001, () => {}, () => {
          const top = V(at.x + this.r(-3, 3), 20, at.z + this.r(-3, 3))
          fx.bolt(top, V(at.x + this.r(-0.3, 0.3), at.y * this.r(0.2, 1), at.z + this.r(-0.3, 0.3)), { colour: '#d9ccff', width: 0.11, life: 0.3, forks: 3, jag: 0.7 })
          this.stage.kick({ flash: 0.22, flashColour: '#cfc0ff' })
          this.flashLight(at, '#cfc0ff', 420, 0.2)
        })
      }
      for (let i = 0; i < 70 * scale; i++) {
        const a = this.r(6.28)
        const s = this.r(4, 16)
        fx.spawn({ p: at, v: [Math.cos(a) * s, this.r(-1, 9), Math.sin(a) * s], life: this.r(0.2, 0.6), size: 0.07, colour: '#ffffff', colour2: '#8f7bff', sprite: SPRITE.streak, add: true, gravity: 6, stretch: 2.6, boost: 3.5 })
      }
      for (let i = 0; i < 12; i++) {
        fx.over(this.r(0.05, 0.7), () => {}, () => {
          fx.spawn({ p: [at.x + this.r(-1.2, 1.2), this.r(0.2, at.y + 0.8), at.z + this.r(-1.2, 1.2)], life: 0.1, size: this.r(0.7, 1.6), colour: '#d8ccff', sprite: SPRITE.arc, add: true, fadeIn: 0.01, boost: 3 })
        })
      }
    } else {
      // Tide: a wall of water closes on the target, then falls as rain.
      for (let i = 0; i < 110 * scale; i++) {
        const a = this.r(6.28)
        const s = this.r(1, 7)
        fx.spawn({ p: [at.x + Math.cos(a) * 0.5, this.r(0.1, at.y), at.z + Math.sin(a) * 0.5], v: [Math.cos(a) * s, this.r(3, 13), Math.sin(a) * s], life: this.r(0.9, 1.8), size: this.r(0.05, 0.13), colour: '#e8fbff', colour2: '#5ad8ff', alpha: 0.9, sprite: SPRITE.drop, gravity: 14, drag: 0.5, stretch: 1.8, ground: true })
      }
      for (let i = 0; i < 26 * scale; i++) {
        const a = this.r(6.28)
        fx.spawn({ p: [at.x, this.r(0.2, at.y + 0.5), at.z], v: [Math.cos(a) * this.r(1, 4), this.r(0.5, 3), Math.sin(a) * this.r(1, 4)], life: this.r(0.7, 1.3), size: 0.8, size2: 2.8, colour: '#bfeaff', alpha: 0.4, sprite: SPRITE.mist, drag: 2, grow: true })
      }
      // The coil: two streams winding up around the target.
      let t = 0
      fx.emitter((dt) => {
        t += dt
        if (t > 0.9) return false
        for (let k = 0; k < 2; k++) {
          for (let i = 0; i < 5; i++) {
            const a = t * 13 + k * Math.PI + i * 0.12
            const rad = 1.5 - t * 0.8
            const y = 0.2 + t * 3.2 + i * 0.05
            fx.spawn({ p: [at.x + Math.cos(a) * rad, y, at.z + Math.sin(a) * rad], v: [-Math.sin(a) * 2, 1.5, Math.cos(a) * 2], life: 0.5, size: this.r(0.12, 0.26), size2: 0.04, colour: '#ffffff', colour2: '#35c9ff', sprite: SPRITE.glow, add: true, boost: 2.2 })
          }
        }
      })
    }
  }

  /** Thorn's roots: tapered vines that whip up out of the sand around a point. */
  roots(ground, at, scale) {
    const bark = surface('bark', { seed: 4 })
    const material = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, color: 0x3d4a22, roughness: 0.9 })
    const count = Math.round(7 * scale)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.r(0.4)
      const points = []
      const turns = this.r(0.6, 1.1)
      for (let k = 0; k <= 10; k++) {
        const t = k / 10
        const ang = a + t * turns * Math.PI * 2
        const rad = 1.7 * (1 - t * 0.72)
        points.push(V(ground.x + Math.cos(ang) * rad, t * (at.y + 1.1) - 0.2, ground.z + Math.sin(ang) * rad))
      }
      const curve = new THREE.CatmullRomCurve3(points)
      const geometry = new THREE.TubeGeometry(curve, 44, 0.14, 7, false)
      // Taper towards the tip.
      const pos = geometry.attributes.position
      for (let v = 0; v < pos.count; v++) {
        const ring = Math.floor(v / 8)
        const t = ring / 44
        const c = curve.getPoint(t)
        const k = 1.15 - t * 1.05
        pos.setXYZ(v, c.x + (pos.getX(v) - c.x) * k, c.y + (pos.getY(v) - c.y) * k, c.z + (pos.getZ(v) - c.z) * k)
      }
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      geometry.setDrawRange(0, 0)
      this.scene.add(mesh)
      const total = geometry.index.count
      this.props.push({ mesh, age: -i * 0.03, life: 2.6, update: (age) => {
        const grow = Math.min(1, Math.max(0, age / 0.3))
        geometry.setDrawRange(0, Math.floor((total * (1 - Math.pow(1 - grow, 3))) / 3) * 3)
        if (age > 1.9) mesh.position.y = -(age - 1.9) * 4
      } })
    }
  }

  /** Stone's spikes: a line of rock that races from the attacker and erupts under the target. */
  spikes(from, ground, dir, scale, look) {
    if (!this.rock) {
      const rock = surface('rock', { seed: 3 })
      this.rock = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normalMap, color: 0x8a7c68, roughness: 0.9, flatShading: true })
    }
    const start = V(from.x, 0, from.z)
    const distance = start.distanceTo(ground)
    const place = (x, z, height, lean, delay) => {
      const geometry = new THREE.ConeGeometry(height * 0.2, height, 5, 2)
      geometry.translate(0, height / 2, 0)
      const pos = geometry.attributes.position
      for (let v = 0; v < pos.count; v++) pos.setX(v, pos.getX(v) + this.r(-0.05, 0.05) * height)
      geometry.computeVertexNormals()
      const mesh = new THREE.Mesh(geometry, this.rock)
      mesh.position.set(x, 0, z)
      mesh.rotation.set(this.r(-0.25, 0.25) + lean * dir.z, this.r(6), this.r(-0.25, 0.25) - lean * dir.x)
      mesh.scale.set(1, 0.001, 1)
      mesh.castShadow = true
      this.scene.add(mesh)
      let burst = false
      this.props.push({ mesh, age: -delay, life: 2.8, update: (age) => {
        const up = Math.min(1, Math.max(0, age / 0.12))
        const over = up < 1 ? up * 1.2 : 1 + 0.2 * Math.max(0, 1 - (age - 0.12) / 0.15)
        mesh.scale.y = Math.max(0.001, over)
        if (!burst && age > 0) {
          burst = true
          this.dust(mesh.position, 0.6, '#8a7860')
          this.debris(V(x, 0.2, z), 4, '#8a7a62', 0.8)
        }
        if (age > 2.1) mesh.position.y = -(age - 2.1) * height * 2
      } })
    }
    const steps = Math.max(3, Math.round(distance / 0.8))
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      place(start.x + dir.x * distance * t + this.r(-0.3, 0.3), start.z + dir.z * distance * t + this.r(-0.3, 0.3), 0.5 + t * 0.9, 0.3, t * 0.22)
    }
    for (let i = 0; i < Math.round(9 * scale); i++) {
      const a = this.r(6.28)
      const d = this.r(0, 1.3)
      place(ground.x + Math.cos(a) * d, ground.z + Math.sin(a) * d, this.r(1.4, 2.9) * scale, 0, 0.24 + this.r(0.06))
    }
    this.fx.over(0.26, () => {}, () => {
      this.stage.rig.shake(0.8)
      this.fx.ring(ground, { colour: look.mid, to: 7, life: 0.6, power: 2 })
    })
  }

  // ----- Effects that last --------------------------------------------------------------

  /** A lasting effect taking hold: 0 burn, 1 winded, 2 sunder, 3 shock, 4 soak. */
  statusBurst(beast, kind) {
    const p = beast.point(kind === 1 ? 'mouth' : 'chest')
    const colours = ['#ff7a1a', '#f2f8ff', '#e0a84a', '#b79cff', '#5ad8ff']
    const sprites = [SPRITE.flame, SPRITE.smoke, SPRITE.chip, SPRITE.arc, SPRITE.drop]
    for (let i = 0; i < 18; i++) {
      const a = this.r(6.28)
      const puff = kind === 1
      this.fx.spawn({ p: [p.x + Math.cos(a) * (puff ? 0.15 : 0.5), p.y + this.r(-0.5, 0.5) * (puff ? 0.3 : 1), p.z + Math.sin(a) * (puff ? 0.15 : 0.5)], v: [Math.cos(a) * this.r(0.5, 2), this.r(0.5, 2.5) * (puff ? 0.4 : 1), Math.sin(a) * this.r(0.5, 2)], life: this.r(0.4, 0.8), size: puff ? this.r(0.2, 0.35) : this.r(0.14, 0.3), size2: puff ? 0.8 : undefined, grow: puff, alpha: puff ? 0.45 : 1, drag: puff ? 2 : 0, colour: colours[kind], sprite: sprites[kind], add: kind === 0 || kind === 3, gravity: kind === 2 || kind === 4 ? 8 : 0, boost: 2, ground: kind === 4 })
    }
  }

  /** Health coming back. */
  heal(beast) {
    const p = beast.point('chest')
    this.fx.ring(V(p.x, 0, p.z), { colour: '#9dffb0', to: 2.6, life: 0.6, power: 1.4 })
    for (let i = 0; i < 26; i++) {
      const a = this.r(6.28)
      const d = this.r(0.3, 1.2)
      this.fx.spawn({ p: [p.x + Math.cos(a) * d, this.r(0.1, 0.6), p.z + Math.sin(a) * d], v: [0, this.r(1, 2.6), 0], life: this.r(0.7, 1.3), size: this.r(0.06, 0.13), colour: '#e6ffe0', colour2: '#5ae07a', sprite: SPRITE.mote, add: true, swirl: 1, boost: 2.2 })
    }
  }

  /** A beast enters: the sand jumps. */
  landing(pos) {
    this.dust(pos, 3)
    this.debris(pos, 8, '#7a6a52', 0.7)
    this.fx.ring(V(pos.x, 0, pos.z), { colour: '#c9a878', to: 4, life: 0.5, power: 0.7 })
    this.stage.rig.shake(0.35)
  }

  /** The sound of a roar, made visible: rings of force from the mouth. */
  roar(beast) {
    const p = beast.point('mouth')
    const look = ASPECT_FX[beast.aspect] ?? ASPECT_FX[0]
    for (let i = 0; i < 3; i++) {
      this.fx.over(i * 0.12 + 0.001, () => {}, () => {
        this.fx.spawn({ p: [p.x + beast.facing * 0.3, p.y, p.z], v: [beast.facing * 5, 0, 0], life: 0.5, size: 0.5, size2: 3.6, colour: look.mid, alpha: 0.5, sprite: SPRITE.ring, add: true, grow: true, rot: 0 })
      })
    }
    this.stage.rig.shake(0.3)
    this.stage.kick({ blur: 0.2 })
  }

  // ----- The knockout -------------------------------------------------------------------

  /** A beast is knocked out. `finisher` is the winner's bought finisher effect (0 for none). */
  kill(beast, from, finisher = 0) {
    const fx = this.fx
    const p = beast.point('chest')
    this.impact(p, { power: 2, colour: '#ffe2b0' })
    this.dust(V(p.x, 0, p.z), 2)
    if (finisher === 40) {
      // Thunderclap.
      fx.over(0.35, () => {}, () => {
        const at = beast.point('chest')
        fx.bolt(V(at.x + 1.5, 22, at.z - 2), at, { colour: '#fff4c8', width: 0.2, life: 0.55, forks: 4, jag: 0.6 })
        this.stage.kick({ flash: 0.4, flashColour: '#fff0c0', blur: 1, chroma: 0.05 })
        this.flashLight(at, '#fff0c0', 600, 0.4)
        fx.ring(V(at.x, 0, at.z), { colour: '#ffe9a0', to: 11, life: 0.8, width: 0.6, power: 3.5 })
        this.stage.rig.shake(1.1)
      })
    } else if (finisher === 41) {
      // Spirit Bell: golden rings ring out over the pit and rise.
      fx.over(0.45, () => {}, () => {
        const at = beast.point('head')
        for (let i = 0; i < 4; i++) {
          fx.over(i * 0.2 + 0.001, () => {}, () => {
            fx.spawn({ p: [at.x, at.y + 0.5 + i * 0.4, at.z], v: [0, 1.1, 0], life: 1.1, size: 0.4, size2: 3.4, colour: '#ffe9a0', alpha: 0.85, sprite: SPRITE.ring, add: true, grow: true, rot: 0, boost: 1.6 })
          })
        }
        for (let i = 0; i < 30; i++) {
          const a = this.r(6.28)
          fx.spawn({ p: [at.x + Math.cos(a) * 0.5, at.y + this.r(0, 1), at.z + Math.sin(a) * 0.5], v: [Math.cos(a) * 0.6, this.r(1, 2.4), Math.sin(a) * 0.6], life: this.r(0.9, 1.6), size: this.r(0.08, 0.14), colour: '#fff4c8', colour2: '#ffc850', sprite: SPRITE.star, add: true, boost: 2, rot: a })
        }
        this.stage.setGrade({ tint: '#ffe2a0', tintAmount: 0.22 })
      })
    } else if (finisher === 42) {
      // Red Moon: the sky turns red over the winner.
      this.arena.setRedMoon(1)
      this.stage.setGrade({ tint: '#ff5a2a', tintAmount: 0.35 })
      fx.over(5, () => {}, () => this.arena.setRedMoon(0))
    }
  }

  /** A knocked-out beast sees stars: a little ring of them circles over its head for a few seconds. */
  faint(beast) {
    const fx = this.fx
    const head = V()
    const count = 5
    let t = 0
    fx.emitter((dt) => {
      t += dt
      if (t > 3.4 || !beast.group.parent) return false
      if (this.r() < dt * 26) {
        beast.point('head', head)
        const a = t * 4.4 + Math.floor(this.r() * count) * ((Math.PI * 2) / count)
        const rad = 0.3 + beast.height * 0.08
        fx.spawn({ p: [head.x + Math.cos(a) * rad, head.y + 0.32 + beast.height * 0.05, head.z + Math.sin(a) * rad], life: 0.15, size: 0.17, colour: '#fff0a0', colour2: '#ffbe30', sprite: SPRITE.star, add: true, boost: 1.8, rot: a })
      }
    })
  }

  /** The body hits the sand. */
  thud(beast) {
    const p = beast.point('chest')
    this.dust(V(p.x, 0, p.z), 4)
    this.stage.rig.shake(0.5)
  }

  update(dt) {
    for (const item of this.lights) {
      if (item.left <= 0) {
        item.light.intensity = 0
        continue
      }
      item.left -= dt
      const k = Math.max(0, item.left / item.total)
      item.light.intensity = item.power * k * k
    }
    for (let i = this.props.length - 1; i >= 0; i--) {
      const prop = this.props[i]
      prop.age += dt
      if (prop.age >= 0) prop.update(prop.age)
      if (prop.age > prop.life) {
        this.scene.remove(prop.mesh)
        prop.mesh.geometry.dispose()
        this.props.splice(i, 1)
      }
    }
  }

  /** Clears the pit between fights. */
  clear() {
    for (const prop of this.props) {
      this.scene.remove(prop.mesh)
      prop.mesh.geometry.dispose()
    }
    this.props.length = 0
    this.fx.clear()
    this.arena.setRedMoon(0)
    this.stage.setGrade({ desat: 0, tintAmount: 0, bars: 0 })
  }
}

export { ASPECT_COLOURS }
