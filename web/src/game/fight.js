// One fight, from the gates opening to the last beast falling.
//
// The rules engine (on chain, or in the browser for practice) says what
// happened as a list of events. This file turns each event into a few seconds
// of choreography: who lunges, where the sparks fly, when time slows down.

import * as THREE from 'three'
import { Beast } from './beast/beast.js'
import { ASPECT_COLOURS } from './beast/species.js'
import { ASPECT_FX } from './effects.js'
import { evolve } from './evolve.js'

const NONE = 255
const STRIKE = 0
const GUARD = 1
const BREAK = 2
const SPECIAL = 3
const HIT = { strike: 0, counter: 1, brk: 2, special: 3, chip: 4, interrupt: 5, specialGuarded: 6, crush: 7 }
const HOME = 3.3
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const EFFECT_WORDS = ['Burning', 'Winded', 'Sundered', 'Shocked', 'Soaked']
const EFFECT_COLOURS = ['#ff7a1a', '#ff3a4a', '#e0a84a', '#b79cff', '#5ad8ff']

const ease = {
  linear: (t) => t,
  out: (t) => 1 - (1 - t) * (1 - t),
  in: (t) => t * t,
  inOut: (t) => t * t * (3 - 2 * t),
  snap: (t) => 1 - Math.pow(1 - t, 4),
}

export class Fight {
  constructor(game, session) {
    this.game = game
    this.stage = game.stage
    this.arena = game.arena
    this.effects = game.effects
    this.hud = game.hud
    this.tables = game.tables
    this.session = session
    this.me = session.me
    this.jobs = []
    this.beasts = [null, null] // by screen side: 0 left (the player), 1 right
    this.pool = [[], []] // by battle side and slot
    this.lives = [null, null]
    this.view = JSON.parse(JSON.stringify(session.battle))
    this.moves = [null, null]
    this.done = false
    this.extras = []
    this.tick = (dt, realDt) => this.update(dt, realDt)
    // What the player's beasts were before the fight, to show what they became after it.
    this.before = new Map()
    const player = game.api?.state?.player
    for (const beast of [...(player?.beasts || []), ...(player?.hires || []).map((hire) => hire.beast)]) this.before.set(beast.id, beast.level)
  }

  // ----- Small tools ----------------------------------------------------------------

  sfx(name, options) {
    this.game.audio?.sfx?.(name, options)
  }

  /** Screen side (0 left, 1 right) of a battle side. */
  scr(side) {
    return side === this.me ? 0 : 1
  }

  /** Runs `fn(k)` with k from 0 to 1 over `seconds` of game time (or real time). */
  tween(seconds, fn, { real = false, curve = 'inOut' } = {}) {
    return new Promise((resolve) => {
      if (seconds <= 0) {
        fn(1)
        resolve()
        return
      }
      this.jobs.push({ t: 0, seconds, fn, real, curve: ease[curve] || ease.inOut, resolve })
    })
  }

  wait(seconds) {
    return this.tween(seconds, () => {})
  }

  waitReal(seconds) {
    return this.tween(seconds, () => {}, { real: true })
  }

  update(dt, realDt) {
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const job = this.jobs[i]
      job.t += job.real ? realDt : dt
      const k = Math.min(1, job.t / job.seconds)
      job.fn(job.curve(k))
      if (k >= 1) {
        this.jobs.splice(i, 1)
        job.resolve()
      }
    }
    for (const team of this.pool) {
      for (const beast of team) if (beast && beast.group.parent) beast.update(dt)
    }
    for (const beast of this.extras) if (beast.group.parent) beast.update(dt)
    // Health running low shows: the beast tires, from about 60% of its health down.
    for (let side = 0; side < 2; side++) {
      const beast = this.beasts[this.scr(side)]
      const f = this.fighterOf(side)
      if (!beast || !f || beast.dead) continue
      const share = f.max_hp ? f.hp / f.max_hp : 1
      const goal = Math.max(0, Math.min(1, (0.6 - share) / 0.48))
      beast.tired += (goal - (beast.tired || 0)) * Math.min(1, realDt * 2.5)
    }
    // The move clock, in a duel.
    this.clockTimer = (this.clockTimer || 0) + realDt
    if (this.clockTimer > 0.2) {
      this.clockTimer = 0
      const left = this.session.clock()
      this.hud.clock(left)
      if (left !== null && left <= 10 && left > 0 && Math.ceil(left) !== this.lastTick) {
        this.lastTick = Math.ceil(left)
        this.sfx('tick')
      }
      if (left === 0 && this.session.kind === 'duel' && !this.claimed && !this.session.match.over) {
        const [mine, theirs] = this.session.progress()
        const need = this.session.need()
        const rivalStalls = need[1 - this.me] && (theirs === 'none' || (theirs === 'sealed' && mine !== 'none'))
        const iStall = need[this.me] && (mine === 'none' || (mine === 'sealed' && theirs !== 'none'))
        if (rivalStalls && !iStall) {
          this.claimed = true
          this.session.claimTimeout().catch(() => (this.claimed = false))
        }
      }
    }
  }

  /** What a fighter is called: the name of the form its level wears. */
  nameOf(f) {
    return this.game.core.formName(f.species, f.level ?? 1)
  }

  /** "Old Grist sends in", but "You send in": a side's name with the verb that fits it. */
  who(scr, verb, plain) {
    const name = this.session.names[scr]
    return `${name} ${name === 'You' ? plain : verb}`
  }

  fighterOf(side) {
    const slot = this.view.active[side]
    return slot === NONE ? null : this.view.teams[side][slot]
  }

  /** Where a side stands: closer together for small beasts, so the camera can come in close. */
  homeX(scr) {
    const sizes = this.beasts.map((beast) => (beast ? beast.height : 1.6))
    const mean = ((sizes[0] ?? 1.6) + (sizes[1] ?? 1.6)) / 2
    const home = Math.min(HOME, Math.max(2.1, 1.35 + mean * 0.8))
    return scr === 0 ? -home : home
  }

  /** The camera's normal place: side-on, both beasts in the frame. */
  shotFight(speed = 2.6) {
    const [a, b] = this.beasts
    const xa = a ? a.group.position.x : this.homeX(0)
    const xb = b ? b.group.position.x : this.homeX(1)
    const mid = (xa + xb) / 2
    const spread = Math.abs(xb - xa)
    const tall = Math.max(a ? a.height : 2, b ? b.height : 2)
    // Half the width that has to fit: the gap between them plus a body length each side.
    const half = spread / 2 + 1.1 + tall * 0.75
    const aspect = this.stage.camera.aspect || 1.78
    let fov = 38
    let distance = half / (Math.tan((fov * Math.PI) / 360) * aspect)
    if (distance > 11.2) {
      // Against the wall already: widen the lens instead.
      distance = 11.2
      fov = Math.min(64, (Math.atan(half / (distance * aspect)) * 360) / Math.PI)
    }
    distance = Math.max(distance, 3.8 + tall * 1.1)
    this.stage.rig.move({ pos: V(mid, 0.9 + tall * 0.6, distance), look: V(mid, 0.35 + tall * 0.45, 0), fov }, speed)
  }

  number(beast, text, options) {
    const p = beast.point('head')
    p.y += 0.5
    const s = this.stage.project(p)
    this.hud.number(Math.min(0.92, Math.max(0.08, s.x)), Math.min(0.8, Math.max(0.2, 1 - s.y)), text, options)
  }

  // ----- The fight, start to finish ------------------------------------------------------

  async run() {
    const { session, hud, stage } = this
    stage.add(this.tick)
    this.effects.clear()
    const stake = BigInt(session.stake || '0')
    const pot = stake > 0n ? `${this.game.format.near(session.kind === 'duel' ? (stake * 2n).toString() : stake.toString())} NEAR` : ''
    hud.setup({ names: session.names, labels: session.labels, kind: session.labels[0], pot })
    hud.fighter(0, null)
    hud.fighter(1, null)
    this.refreshTeams()
    hud.onForfeit = () => this.giveUp()
    hud.show()
    this.game.audio?.music?.('battle')
    session.onChange = () => this.rivalNews()

    await this.intro()
    while (!this.done) {
      if (session.battle.winner !== NONE || session.match?.over) break
      const need = session.need()
      let steps = []
      try {
        if (need[this.me]) {
          const action = await this.ask()
          if (this.done) break
          hud.wait(session.kind === 'duel' ? 'Sealed. <b>Waiting for your rival…</b>' : action >= 10 ? '' : 'Both moves are in. <b>Clash!</b>')
          this.brace(true)
          steps = await session.act(action)
        } else {
          hud.wait(session.kind === 'duel' ? '<b>Your rival is choosing…</b>' : '')
          steps = await session.wait()
        }
      } catch (error) {
        hud.log(error.message || String(error))
        this.sfx('ui_error')
        this.brace(false)
        await this.waitReal(0.8)
        continue
      }
      this.brace(false)
      hud.wait('')
      for (const step of steps) await this.play(step.events)
      this.sync()
    }
    // The fight can end while a step is still on screen (the rival's move finished it, or a
    // move was settled from elsewhere): show whatever has not been shown before the result.
    const rest = !this.done && session.rest ? session.rest() : []
    if (rest.length) {
      this.brace(false)
      hud.wait('')
      for (const step of rest) await this.play(step.events)
      this.sync()
    }
    const result = session.result()
    await this.outro(result)
    await this.growth(result)
    this.close()
    return result
  }

  async giveUp() {
    if (!this.confirming) {
      this.confirming = true
      this.hud.giveUp.textContent = 'Really give up?'
      setTimeout(() => {
        this.confirming = false
        if (this.hud.giveUp) this.hud.giveUp.textContent = 'Give up'
      }, 3000)
      return
    }
    try {
      await this.session.forfeit()
    } catch (error) {
      this.hud.log(error.message || String(error))
    }
    this.done = true
    if (this.hud.pending) {
      const resolve = this.hud.pending
      this.hud.pending = null
      resolve(0)
    }
  }

  rivalNews() {
    if (this.session.kind !== 'duel' || !this.hud.pending) return
    const [, theirs] = this.session.progress()
    if (theirs !== 'none') this.hud.setHint('<b>Your rival has locked in.</b> Choose your move.')
  }

  /** While the chain confirms a move, both beasts coil and the camera leans in. */
  brace(on) {
    for (const beast of this.beasts) if (beast) beast.tense = on
    if (on) {
      const rig = this.stage.rig
      rig.move({ pos: rig.goal.pos.clone().multiply(V(1, 0.94, 0.9)), look: rig.goal.look, fov: 33 }, 1.2)
    }
  }

  async ask() {
    const battle = this.session.battle
    const me = this.me
    if (battle.active[me] === NONE) {
      const foeSlot = battle.active[1 - me]
      const foe = foeSlot === NONE ? null : battle.teams[1 - me][foeSlot]
      const slot = await this.hud.choosePick(battle.teams[me], foe, battle.turn === 0)
      return 10 + slot
    }
    const team = battle.teams[me]
    const active = battle.active[me]
    const bench = team.map((f, slot) => ({ f, slot, name: this.nameOf(f) })).filter(({ f, slot }) => slot !== active && f.hp > 0)
    // Sudden death (battle.rs SUDDEN_DEATH_TURN): nobody swaps from the 20th turn of a round.
    const locked = (battle.round_turn ?? 0) >= 20
    return this.hud.chooseMove(team[active], battle.teams[1 - me][battle.active[1 - me]], { bench, locked })
  }

  refreshTeams() {
    for (let side = 0; side < 2; side++) {
      const hide = this.session.kind === 'duel' && side !== this.me
      this.hud.team(this.scr(side), this.view.teams[side], this.view.active[side], hide)
    }
  }

  /** After a step: take the authoritative numbers (Rage, effects) and walk everyone home. */
  sync() {
    const battle = this.session.battle
    const seen = this.view.teams.map((team) => team.map((f) => !!f.seen))
    this.view = JSON.parse(JSON.stringify(battle))
    this.view.teams.forEach((team, s) => team.forEach((f, i) => (f.seen = seen[s][i])))
    for (let side = 0; side < 2; side++) {
      const beast = this.beasts[this.scr(side)]
      const f = this.fighterOf(side)
      if (!beast || !f || beast.dead) continue
      this.hud.hp(this.scr(side), f.hp, f.max_hp)
      this.hud.rage(this.scr(side), f.rage)
      this.hud.effects(this.scr(side), f)
      beast.status = { burn: f.burn, bleed: f.bleed, sunder: f.sunder, shock: f.shock, soak: f.soak }
      beast.setTint(f.burn ? '#ff5a10' : f.soak ? '#2a8ad0' : f.shock ? '#7a5cff' : f.sunder ? '#8a7450' : null, f.burn || f.soak || f.shock || f.sunder ? 0.13 : 0)
      if (f.rage >= 100 && beast.rage < 100) {
        this.effects.rageFull(beast)
        this.sfx('rage_full')
        this.hud.log(`${this.nameOf(f)}'s Rage is full.`)
      }
      beast.rage = f.rage
    }
    this.refreshTeams()
  }

  // ----- Entrances -----------------------------------------------------------------------

  /** Builds (or reuses) the beast for a fighter. */
  make(side, slot) {
    if (this.pool[side][slot]) return this.pool[side][slot]
    const f = this.view.teams[side][slot]
    const beast = new Beast(f.species, { level: f.level ?? 1, aura: f.aura, finisher: f.finisher, token: f.token || side * 100 + slot + 1 })
    beast.aspect = f.aspect
    beast.title = this.nameOf(f)
    this.pool[side][slot] = beast
    return beast
  }

  async intro() {
    const rig = this.stage.rig
    const resumed = this.view.turn > 0
    rig.cut({ pos: V(-7, 8.5, 10.5), look: V(0, 1, 0), fov: 42 })
    rig.move({ pos: V(0, 3.0, 11.2), look: V(0, 1.5, 0), fov: 40 }, 0.9)
    this.sfx('crowd_roar', { volume: 0.7 })
    if (resumed) {
      // Back from a reload: put whoever is in the pit where they stand.
      for (let side = 0; side < 2; side++) {
        const slot = this.view.active[side]
        if (slot !== NONE) this.place(side, slot)
      }
      await this.waitReal(0.9)
      this.shotFight()
      return
    }
    await this.hud.flash('MAUL STREET', { sub: `${this.session.names[0]}  vs  ${this.session.names[1]}`, seconds: 2.1, colour: '#efe6d6' })
  }

  /** Puts a beast straight at its mark (used when a fight is resumed). */
  place(side, slot) {
    const scr = this.scr(side)
    const beast = this.make(side, slot)
    const f = this.view.teams[side][slot]
    f.seen = true
    beast.face(scr === 0 ? 1 : -1)
    this.beasts[scr] = beast
    beast.group.position.set(this.homeX(scr), 0, 0)
    this.stage.scene.add(beast.group)
    this.lives[scr] = this.effects.life(beast)
    this.hud.fighter(scr, f)
    beast.rage = f.rage
  }

  /** A beast still standing turns and runs back out through its gate (a swap). */
  async recall(scr) {
    const beast = this.beasts[scr]
    if (!beast) return
    const dir = scr === 0 ? 1 : -1
    if (this.lives[scr]) this.lives[scr].stop()
    this.lives[scr] = null
    this.beasts[scr] = null
    this.arena.setGate(scr, true)
    this.effects.dust(beast.group.position, 0.6)
    beast.face(-dir)
    beast.anim.state.run = 1
    if (beast.spec.rig === 'winged') beast.anim.state.fly = 1
    const startX = beast.group.position.x
    await this.tween(0.7, (k) => (beast.group.position.x = startX + (-dir * 12.4 - startX) * k), { curve: 'in' })
    beast.anim.state.run = 0
    beast.anim.state.fly = 0
    this.stage.scene.remove(beast.group)
    beast.face(dir)
  }

  /** Beasts called back and others sent in, before the rival's move lands. */
  async swapIn(swaps) {
    for (const swap of swaps) {
      const scr = this.scr(swap.side)
      const out = this.fighterOf(swap.side)
      if (out) this.hud.log(`${this.who(scr, 'calls', 'call')} ${this.nameOf(out)} back.`)
    }
    this.sfx('whoosh_light')
    await Promise.all(swaps.map((swap) => this.recall(this.scr(swap.side))))
    await this.enter(swaps, { swap: true })
  }

  /** One or both sides send a beast in through their gate. */
  async enter(picks, { swap = false } = {}) {
    const jobs = picks.map(async (pick, i) => {
      const side = pick.side
      const scr = this.scr(side)
      const f = this.view.teams[side][pick.slot]
      f.seen = true
      this.view.active[side] = pick.slot
      const old = this.beasts[scr]
      if (old) this.retire(old, scr)
      const beast = this.make(side, pick.slot)
      const dir = scr === 0 ? 1 : -1
      beast.face(dir)
      beast.dead = false
      beast.group.position.set(-dir * 12.4, 0, 0)
      this.stage.scene.add(beast.group)
      this.beasts[scr] = beast
      this.lives[scr] = this.effects.life(beast)
      this.arena.setGate(scr, true)
      await this.wait(0.25 + i * 0.3)
      this.sfx('entrance', { pan: -dir * 0.5 })
      // A run, then a leap to the mark.
      const flyer = beast.spec.rig === 'winged'
      beast.anim.state.run = 1
      if (flyer) beast.anim.state.fly = 1
      const startX = -dir * 12.4
      const endX = this.homeX(scr)
      await this.tween(
        0.95,
        (k) => {
          beast.group.position.x = startX + (endX - startX) * k
          beast.group.position.y = Math.sin(Math.min(1, k * 1.05) * Math.PI) * (flyer ? 2.6 : 1.3) * (k > 0.35 || flyer ? 1 : k / 0.35)
        },
        { curve: 'out' },
      )
      beast.group.position.y = 0
      beast.anim.state.run = 0
      beast.anim.state.fly = 0
      this.effects.landing(beast.group.position)
      this.sfx('body_fall', { volume: 0.5 })
      this.arena.setGate(scr, false)
      this.hud.fighter(scr, f)
      this.refreshTeams()
      beast.play('land')
      await this.wait(0.3)
      this.roar(beast)
      this.hud.log(`${swap ? this.who(scr, 'swaps in', 'swap in') : this.who(scr, 'sends in', 'send in')} ${this.nameOf(f)}.`)
      await beast.play('roar')
    })
    // The camera favours whoever is coming in.
    if (picks.length === 1) {
      const scr = this.scr(picks[0].side)
      const dir = scr === 0 ? -1 : 1
      this.stage.rig.move({ pos: V(dir * 1.2, 2.5, 10.8), look: V(dir * 4.0, 1.5, 0), fov: 38 }, 2.4)
    } else {
      this.stage.rig.move({ pos: V(0, 2.9, 11.3), look: V(0, 1.6, 0), fov: 42 }, 1.6)
    }
    await Promise.all(jobs)
    this.shotFight()
    if (this.view.turn === 0 && picks.length === 2) {
      this.sfx('gong')
      await this.hud.flash('FIGHT', { seconds: 1.0, colour: '#fff', glow: 'rgba(200,16,46,.9)' })
    }
  }

  roar(beast) {
    const voice = { quadruped: 'roar_quad', biped: 'roar_biped', serpent: 'roar_serpent', winged: 'roar_winged' }[beast.spec.rig]
    this.sfx(voice, { pan: beast.facing > 0 ? -0.4 : 0.4 })
    this.effects.roar(beast)
  }

  /** A fallen beast sinks into the sand and is taken away. */
  retire(beast, scr) {
    if (this.lives[scr]) this.lives[scr].stop()
    this.tween(1.3, (k) => (beast.group.position.y = -k * 2.4), { curve: 'in' }).then(() => {
      this.stage.scene.remove(beast.group)
    })
  }

  // ----- Playing a step ---------------------------------------------------------------------

  async play(events) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i]
      const next = events[i + 1]
      if (e.e === 'pick') {
        const picks = [e]
        if (next && next.e === 'pick') {
          picks.push(next)
          i++
        }
        await this.enter(picks)
      } else if (e.e === 'swap') {
        const swaps = [e]
        if (next && next.e === 'swap') {
          swaps.push(next)
          i++
        }
        await this.swapIn(swaps)
      } else if (e.e === 'moves') {
        await this.reveal(e.m)
      } else if (e.e === 'standoff') {
        await this.standoff()
      } else if (e.e === 'hit') {
        const ko = next && next.e === 'ko' && next.side !== e.by ? next : null
        if (ko) i++
        await this.hit(e, ko)
      } else if (e.e === 'status') {
        this.status(e)
      } else if (e.e === 'heal') {
        this.heal(e)
      } else if (e.e === 'dot') {
        const ko = next && next.e === 'ko' && next.side === e.side ? next : null
        if (ko) i++
        await this.dot(e, ko)
      } else if (e.e === 'ko') {
        await this.fall(e.side, null)
      } else if (e.e === 'round_end') {
        await this.roundEnd(e)
      } else if (e.e === 'rage') {
        await this.settle()
        for (let side = 0; side < 2; side++) {
          const f = this.fighterOf(side)
          if (f) f.rage = e.r[side]
          this.hud.rage(this.scr(side), e.r[side])
        }
      } else if (e.e === 'over') {
        this.view.winner = e.winner
      }
    }
    await this.settle()
  }

  /** Both moves are turned face up. Guards go up; a Break starts to wind up. */
  async reveal(m) {
    this.moves = m
    for (let side = 0; side < 2; side++) {
      const beast = this.beasts[this.scr(side)]
      this.hud.reveal(this.scr(side), m[side])
      const f = this.fighterOf(side)
      if (m[side] === SPECIAL && f) {
        f.rage = 0
        this.hud.rage(this.scr(side), 0)
        if (beast) beast.rage = 0
      }
      if (!beast) continue
      if (m[side] === GUARD) beast.play('guard')
      if (m[side] === BREAK && m[1 - side] === STRIKE) beast.play('heavy', { speed: 0.55 })
    }
    this.sfx('ui_click')
    await this.wait(0.55)
  }

  async standoff() {
    const [a, b] = this.beasts
    this.hud.flash('STAND-OFF', { seconds: 1.0, sub: 'Both guarded. Both gain Rage.' })
    this.stage.rig.move({ pos: V(0, 1.8, 8.4), look: V(0, 1.4, 0), fov: 33 }, 2)
    for (const beast of [a, b]) if (beast) this.effects.dust(beast.group.position, 0.8)
    await this.wait(0.95)
  }

  /** Releases held poses and walks both beasts back to their marks. */
  async settle() {
    const jobs = []
    this.beasts.forEach((beast, scr) => {
      if (!beast || beast.dead) return
      if (beast.anim.current?.hold) beast.anim.release()
      const home = this.homeX(scr)
      const from = beast.group.position.x
      const fromY = beast.group.position.y
      if (Math.abs(from - home) > 0.05 || fromY > 0.01) {
        jobs.push(
          this.tween(0.36, (k) => {
            beast.group.position.x = from + (home - from) * k
            beast.group.position.y = fromY * (1 - k) + Math.sin(k * Math.PI) * 0.3
          }),
        )
      }
    })
    if (jobs.length) {
      await Promise.all(jobs)
      this.shotFight()
    }
  }

  /** Moves the attacker into range of the target over `seconds`. `arc` lifts it off the ground on the way. */
  approach(attacker, target, seconds, arc = 0) {
    const gap = attacker.reach * 0.62 + 1.25
    const to = target.group.position.x - attacker.facing * gap
    const from = attacker.group.position.x
    if (Math.abs(to - from) < 0.25 && arc === 0) return Promise.resolve()
    attacker.anim.state.run = 1
    if (arc > 0 && attacker.spec.rig === 'winged') attacker.anim.state.fly = 1
    const job = this.tween(
      seconds,
      (k) => {
        attacker.group.position.x = from + (to - from) * k
        attacker.group.position.y = Math.sin(k * Math.PI) * arc
      },
      { curve: 'in' },
    )
    job.then(() => {
      attacker.anim.state.run = 0
      attacker.anim.state.fly = 0
      attacker.group.position.y = 0
    })
    this.shotFight(4)
    return job
  }

  async hit(e, ko) {
    const attacker = this.beasts[this.scr(e.by)]
    const target = this.beasts[this.scr(1 - e.by)]
    if (!attacker || !target) return
    if (e.kind === HIT.special || e.kind === HIT.specialGuarded) return this.special(attacker, target, e, ko)
    const heavy = e.kind === HIT.brk || e.kind === HIT.crush
    const counter = e.kind === HIT.counter
    const clip = heavy ? 'heavy' : counter || Math.random() < 0.45 ? 'claw' : 'strike'
    const dur = attacker.anim.clips[clip].dur
    let contact
    const landed = new Promise((resolve) => (contact = resolve))
    const speed = counter ? 1.3 : 1
    const anim = attacker.play(clip, { speed, on: (name) => name === 'hit' && contact() })
    this.sfx(heavy ? 'whoosh_heavy' : 'whoosh_light', { delay: (dur * (heavy ? 0.45 : 0.3)) / speed })
    this.wait((dur * (heavy ? 0.3 : 0.18)) / speed).then(() => this.approach(attacker, target, (dur * (heavy ? 0.3 : 0.24)) / speed, heavy ? 0.5 : 0))
    await landed
    await this.land(attacker, target, e, ko)
    if (!ko) await anim
  }

  /** The moment of contact: the flash, the numbers, and the target's reaction. */
  async land(attacker, target, e, ko) {
    const side = 1 - e.by
    const f = this.fighterOf(side)
    const from = attacker.point('mouth')
    const centre = target.point('chest')
    const dir = V(centre.x - from.x, 0.25, centre.z - from.z).normalize()
    const max = f ? f.max_hp : 400
    const share = e.dmg / max
    const blocked = e.kind === HIT.chip || e.kind === HIT.specialGuarded
    const big = e.crit || share > 0.17 || e.kind === HIT.brk || e.kind === HIT.crush || e.kind === HIT.special
    const pan = target.group.position.x / 8

    if (blocked) {
      const at = centre.clone().addScaledVector(dir, -0.9)
      this.effects.block(at, dir)
      this.sfx('block', { pan })
      if (!ko) target.play('guardHit')
      this.stage.hitStop(0.05)
    } else {
      if (e.kind === HIT.crush) {
        this.effects.guardCrush(centre.clone().addScaledVector(dir, -0.8), attacker.aspect)
        this.sfx('guard_crush', { pan })
      }
      // Where the blow lands: the side of the body facing the attacker.
      const at = target.point('chest').addScaledVector(dir, -0.5)
      this.effects.impact(at, { power: big ? 1.45 : 0.85, dir })
      target.hitFlash(0.55)
      this.sfx(e.crit ? 'hit_crit' : big ? 'hit_heavy' : 'hit_light', { pan })
      this.stage.hitStop(big ? 0.12 : 0.06)
      if (!ko) {
        this.sfx('pain', { pan, delay: 0.05, rate: target.spec.rig === 'biped' ? 0.8 : target.spec.rig === 'winged' ? 1.3 : 1 })
        target.play(e.kind === HIT.interrupt ? 'stuffed' : big ? 'hitHeavy' : 'hit')
        const push = target.group.position.x + attacker.facing * (big ? 0.85 : 0.4)
        const start = target.group.position.x
        this.tween(0.2, (k) => (target.group.position.x = start + (push - start) * k), { curve: 'out' })
        if (big) this.effects.dust(target.group.position, 1)
      }
    }
    if (f) {
      f.hp = e.hp
      this.hud.hp(this.scr(side), e.hp, max)
    }
    const how = e.kind === HIT.interrupt ? 'Interrupt' : e.kind === HIT.crush ? 'Guard crushed' : e.kind === HIT.counter ? 'Counter' : blocked ? 'Blocked' : e.crit ? 'Critical' : ''
    // The aspect's effect always shows, so a player learns the ring from the hits themselves.
    const label = how ? `${how}${e.eff > 0 ? ' · 2× damage' : e.eff < 0 ? ' · ½ damage' : ''}` : e.eff > 0 ? 'Double damage' : e.eff < 0 ? 'Half damage' : ''
    this.number(target, `-${e.dmg}`, { kind: blocked ? 'chip' : e.crit ? 'crit' : '', sub: label })
    const names = [attacker.title, target.title]
    this.hud.log(`${names[0]} hits ${names[1]} for ${e.dmg}${label ? ` (${label.toLowerCase()})` : ''}.`)
    if (ko) await this.fall(side, attacker, e)
  }

  /** The Special: the beast gathers itself, the world slows, and the blow lands. */
  async special(attacker, target, e, ko) {
    const stage = this.stage
    const rig = stage.rig
    const look = ASPECT_FX[attacker.aspect]
    const species = this.tables.species[attacker.species]
    const guarded = e.kind === HIT.specialGuarded
    const dir = attacker.facing
    stage.setGrade({ bars: 1 })
    const head = attacker.point('head')
    rig.cut({ pos: V(head.x + dir * 3.3, head.y * 0.55 + 0.4, 3.7), look: V(head.x - dir * 0.2, head.y * 0.82, 0), fov: 30 })
    rig.move({ pos: V(head.x + dir * 2.5, head.y * 0.6 + 0.3, 3.0), look: V(head.x - dir * 0.2, head.y * 0.85, 0), fov: 27 }, 1.1)
    this.hud.flash(species.special.toUpperCase(), { sub: `${this.tables.aspects[attacker.aspect]} Special`, colour: look.core, glow: look.mid, seconds: 1.7 })
    this.sfx('special_charge')
    this.roar(attacker)
    const gather = this.effects.charge(attacker)
    attacker.play('charge')
    stage.setTimeScale(0.5, 0.2)
    this.game.audio?.setTimeScale?.(0.5)
    await this.waitReal(1.15)
    gather.stop()

    // The leap. Time drags as it closes.
    const mid = (attacker.group.position.x + target.group.position.x) / 2
    rig.cut({ pos: V(mid - dir * 2.5, 1.5, 7.6), look: V(mid + dir * 1.2, 1.6, 0), fov: 34 })
    rig.move({ pos: V(target.group.position.x - dir * 2.2, 1.7, 5.4), look: V(target.group.position.x, 1.4, 0), fov: 30 }, 2.2)
    stage.setTimeScale(0.34, 0.05)
    this.game.audio?.setTimeScale?.(0.3)
    this.sfx('slowmo_in')
    let contact
    const landed = new Promise((resolve) => (contact = resolve))
    const clip = attacker.anim.clips.pounce
    const anim = attacker.play('pounce', { on: (name) => name === 'hit' && contact() })
    this.approach(attacker, target, clip.dur * 0.43, attacker.spec.rig === 'serpent' ? 0 : attacker.spec.rig === 'winged' ? 2.6 : 1.5)
    this.sfx('whoosh_heavy')
    await landed
    const at = target.point('chest')
    this.effects.special(attacker.aspect, attacker.group.position, at, { guarded })
    this.sfx(['special_ember', 'special_thorn', 'special_stone', 'special_storm', 'special_tide'][attacker.aspect])
    stage.setTimeScale(0.08, 0.02)
    await this.land(attacker, target, e, null)
    if (ko) {
      await this.fall(1 - e.by, attacker, e)
    } else {
      await this.waitReal(0.85)
      stage.setTimeScale(1, 0.4)
      this.game.audio?.setTimeScale?.(1)
      this.sfx('slowmo_out')
      stage.setGrade({ bars: 0 })
      this.shotFight(2.2)
      await anim
    }
  }

  status(e) {
    const beast = this.beasts[this.scr(e.side)]
    const f = this.fighterOf(e.side)
    if (!beast || !f) return
    const key = ['burn', 'bleed', 'sunder', 'shock', 'soak'][e.kind]
    f[key] = e.turns
    beast.status = { ...(beast.status || {}), [key]: e.turns }
    this.effects.statusBurst(beast, e.kind)
    this.sfx(['status_burn', 'status_winded', 'status_sunder', 'status_shock', 'status_soak'][e.kind])
    this.hud.effects(this.scr(e.side), f)
    this.number(beast, EFFECT_WORDS[e.kind].toUpperCase(), { kind: 'word', colour: EFFECT_COLOURS[e.kind] })
    if (e.kind === 3) {
      f.rage = Math.max(0, f.rage - 40)
      this.hud.rage(this.scr(e.side), f.rage)
    }
  }

  heal(e) {
    const beast = this.beasts[this.scr(e.side)]
    const f = this.fighterOf(e.side)
    if (!beast || !f) return
    f.hp = e.hp
    this.effects.heal(beast)
    this.hud.hp(this.scr(e.side), e.hp, f.max_hp)
    this.number(beast, `+${e.amt}`, { kind: 'heal' })
  }

  /** A burn, or being winded, takes its toll at the end of the turn. */
  async dot(e, ko) {
    const beast = this.beasts[this.scr(e.side)]
    const f = this.fighterOf(e.side)
    if (!beast || !f) return
    f.hp = e.hp
    this.effects.statusBurst(beast, e.kind)
    beast.hitFlash(0.4)
    this.sfx(e.kind === 0 ? 'status_burn' : 'whoosh_light', { volume: 0.7 })
    this.hud.hp(this.scr(e.side), e.hp, f.max_hp)
    this.number(beast, `-${e.dmg}`, { kind: 'chip', sub: e.kind === 0 ? 'Burn' : 'Winded' })
    if (ko) await this.fall(e.side, null)
    else await this.wait(0.45)
  }

  /** A beast is knocked out. With an attacker, this is the finishing blow, shown in slow motion. */
  async fall(side, killer, e) {
    const scr = this.scr(side)
    const beast = this.beasts[scr]
    const f = this.fighterOf(side)
    if (!beast) return
    const stage = this.stage
    const rig = stage.rig
    if (f) f.hp = 0
    beast.dead = true
    beast.status = {}
    beast.setTint(null, 0)
    this.hud.hp(scr, 0, f ? f.max_hp : 1)
    const x = beast.group.position.x
    const d = killer ? killer.facing : scr === 0 ? -1 : 1
    stage.setGrade({ bars: 1, desat: 0.3 })
    stage.setTimeScale(killer ? 0.1 : 0.3, 0.03)
    this.game.audio?.setTimeScale?.(0.2)
    this.sfx('slowmo_in')
    this.sfx('ko_boom')
    rig.cut({ pos: V(x - d * 3.0, 0.9, 4.4), look: V(x + d * 0.3, beast.chest * 0.8, 0), fov: 30 })
    rig.move({ pos: V(x - d * 1.2, 1.3, 5.2), look: V(x + d * 0.6, beast.chest * 0.6, 0), fov: 27 }, 0.8)
    if (killer) this.effects.kill(beast, killer.point('mouth'), killer.wear.finisher)
    else this.effects.thud(beast)
    this.sfx('faint', { delay: 0.1 })
    // A bought finisher is heard as well as seen.
    const finisher = killer?.wear.finisher || 0
    if (finisher >= 40 && finisher <= 42) this.sfx(['finisher_bolt', 'finisher_bell', 'finisher_redmoon'][finisher - 40], { delay: 0.15 })
    let fainted = false
    const faint = () => {
      if (fainted) return
      fainted = true
      this.effects.faint(beast)
      this.sfx('dizzy', { volume: 0.7 })
    }
    const down = beast.play('ko', {
      on: (name) => {
        if (name !== 'thud') return
        this.effects.thud(beast)
        this.sfx('body_fall')
        faint()
      },
    })
    // Knocked off its feet in the direction of the blow.
    if (killer) this.tween(0.5, (k) => (beast.group.position.x = x + d * 0.9 * k), { curve: 'out' })
    const word = killer && e && (e.kind === HIT.special || e.kind === HIT.specialGuarded) ? 'OBLITERATED' : killer ? 'KNOCKOUT' : 'WORN DOWN'
    this.hud.flash(word, { seconds: 2.0, colour: '#ff2a3a', glow: 'rgba(255,20,40,.9)' })
    await this.waitReal(killer ? 1.5 : 0.9)
    stage.setTimeScale(1, 0.5)
    this.game.audio?.setTimeScale?.(1)
    this.sfx('slowmo_out')
    await down
    faint()
    this.view.active[side] = NONE
    this.refreshTeams()
    this.hud.log(`${beast.title} is down.`)
    stage.setGrade({ bars: 0, desat: 0, tintAmount: 0 })
    if (killer) {
      this.shotFight(1.8)
      this.sfx('crowd_roar', { volume: 0.8 })
      this.roar(killer)
      await killer.play('roar')
    } else {
      await this.wait(0.5)
    }
  }

  /** The round is over: the winner's beast gets its second wind, the body is taken away. */
  async roundEnd(e) {
    const winner = this.beasts[this.scr(e.winner)]
    const f = this.fighterOf(e.winner)
    if (winner && f) {
      f.hp = e.hp
      f.burn = f.bleed = f.sunder = f.shock = f.soak = 0
      winner.status = {}
      winner.setTint(null, 0)
      if (e.heal > 0) {
        this.effects.heal(winner)
        this.number(winner, `+${e.heal}`, { kind: 'heal', sub: 'Second wind' })
      }
      this.hud.hp(this.scr(e.winner), e.hp, f.max_hp)
      this.hud.effects(this.scr(e.winner), f)
    }
    const loserScr = this.scr(1 - e.winner)
    const body = this.beasts[loserScr]
    if (body) {
      this.retire(body, loserScr)
      this.beasts[loserScr] = null
      this.hud.fighter(loserScr, null)
    }
    await this.wait(0.9)
  }

  // ----- The end ----------------------------------------------------------------------------

  async outro(result) {
    const stage = this.stage
    const hud = this.hud
    hud.wait('')
    if (result.void) {
      await hud.flash('NO CONTEST', { sub: 'Stakes returned', seconds: 2.4 })
      return
    }
    const winnerScr = result.won ? 0 : 1
    const winner = this.beasts[winnerScr]
    stage.setGrade({ bars: 1 })
    if (winner && !winner.dead) {
      const x = winner.group.position.x
      const d = winner.facing
      stage.rig.cut({ pos: V(x + d * 4.2, 1.1, 4.6), look: V(x, winner.height * 0.6, 0), fov: 32 })
      stage.rig.move({ pos: V(x + d * 2.4, 1.6, 6.2), look: V(x, winner.height * 0.62, 0), fov: 30 }, 0.5)
      this.roar(winner)
      winner.play('victory')
    }
    this.sfx('crowd_roar')
    this.game.audio?.stinger?.(result.won ? 'victory' : 'defeat')
    await hud.flash(result.won ? 'VICTORY' : 'DEFEAT', {
      sub: result.won ? `${this.session.names[0]} takes the pit` : `${this.session.names[1]} takes the pit`,
      colour: result.won ? '#ffd27a' : '#c8102e',
      glow: result.won ? 'rgba(255,190,80,.8)' : 'rgba(200,16,46,.8)',
      seconds: 3.4,
    })
  }

  /**
   * After a fight on chain: which of the player's beasts levelled up, and for
   * any that reached a new form, the change itself, in the pit.
   */
  async growth(result) {
    const match = result.match
    if (!match || result.void || !match.levels) return
    const core = this.game.core
    const levelled = []
    const changed = []
    match.battle.teams[this.me].forEach((f, slot) => {
      const after = match.levels[this.me]?.[slot]
      const before = this.before.get(f.token) ?? f.level
      if (!f.token || !after || after <= before) return
      if (core.form(after) > core.form(before)) changed.push({ f, before, after })
      else levelled.push(`${core.formName(f.species, after)} is now level ${after}`)
    })
    if (levelled.length) {
      this.sfx('upgrade')
      await this.hud.flash('LEVEL UP', { sub: levelled.join('  ·  '), colour: '#ffd27a', glow: 'rgba(255,190,80,.8)', seconds: 2.2 })
    }
    for (const { f, before, after } of changed) {
      // Clear the pit and bring the beast back as it was, to change in front of everyone.
      for (const team of this.pool) for (const beast of team) if (beast) this.stage.scene.remove(beast.group)
      for (const handle of this.lives) if (handle) handle.stop()
      this.hud.clearFlash()
      const old = new Beast(f.species, { level: before, aura: f.aura, finisher: f.finisher, token: f.token })
      old.aspect = f.aspect
      old.face(1)
      old.group.rotation.y = -0.5
      old.group.position.set(0, 0, 0)
      this.stage.scene.add(old.group)
      this.extras.push(old)
      this.stage.rig.cut({ pos: V(1.4, 1.5 + old.height * 0.4, 5 + old.height * 1.4), look: V(0, old.height * 0.5, 0), fov: 34 })
      await this.waitReal(0.5)
      const grown = await evolve(this.game, old, after, { names: [core.formName(f.species, before), core.formName(f.species, after)] })
      this.extras.push(grown)
      await this.waitReal(0.8)
      grown.life?.stop()
      this.stage.scene.remove(grown.group)
      old.dispose()
      grown.dispose()
    }
  }

  close() {
    this.done = true
    this.stage.remove(this.tick)
    for (const handle of this.lives) if (handle) handle.stop()
    for (const team of this.pool) {
      for (const beast of team) {
        if (!beast) continue
        this.stage.scene.remove(beast.group)
        beast.dispose()
      }
    }
    this.beasts = [null, null]
    this.session.close?.()
    this.stage.setTimeScale(1, 0.1)
    this.game.audio?.setTimeScale?.(1)
    this.effects.clear()
    this.hud.hide()
  }
}

export { ASPECT_COLOURS }
