// The fight screen's overlay. It only shows and asks; the fight scene decides.

import '@fontsource/bebas-neue'
import '@fontsource/barlow-condensed/500.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import './hud.css'
import { ASPECT_COLOURS } from './beast/species.js'

const NONE = 255
const ICON = {
  // Strike: three claw marks.
  0: '<svg viewBox="0 0 32 32" fill="currentColor"><path d="M6 3l4 0 6 26-3 0zM14 3l4 0 6 26-3 0zM22 3l4 0 4 20-3 0z"/></svg>',
  // Guard: a shield.
  1: '<svg viewBox="0 0 32 32" fill="currentColor"><path d="M16 2l11 4v9c0 8-5 13-11 15C10 28 5 23 5 15V6zM16 6l-7 2.6V15c0 5.4 3.2 9.2 7 10.8z"/></svg>',
  // Break: a hammer blow.
  2: '<svg viewBox="0 0 32 32" fill="currentColor"><path d="M4 8l14-5 4 9-6 2 8 15-4 2-8-15-6 2z"/><path d="M24 20l2 3 4-1-3 3 1 4-3-2-3 2 1-4-3-2 4 0z" opacity=".7"/></svg>',
  // Special: a starburst.
  3: '<svg viewBox="0 0 32 32" fill="currentColor"><path d="M16 1l3.4 9.8L30 9l-7.2 7L30 23l-10.6-1.8L16 31l-3.4-9.8L2 23l7.2-7L2 9l10.6 1.8z"/></svg>',
  // Swap: two arrows passing each other.
  swap: '<svg viewBox="0 0 32 32" fill="currentColor"><path d="M4 8h18V4l7 6-7 6v-4H4zM28 20H10v-4l-7 6 7 6v-4h18z"/></svg>',
}
const MOVE_NAMES = ['Strike', 'Guard', 'Break', 'Special']
const MOVE_TEXT = ['Fast hit. Stops a Break cold.', 'Blocks a Strike and counters. Halves a Special.', 'Slow and heavy. Crushes a Guard.', 'Needs a full Rage bar.']
const KEYS = ['1', '2', '3', '4', '5', '6']
/** Actions 20, 21, 22: swap in the beast in slot 0, 1, 2 instead of a move. */
const SWAP = 20
const EFFECTS = [
  ['Burning', '#ff7a1a'],
  ['Winded', '#cfe6f5'],
  ['Sundered', '#e0a84a'],
  ['Shocked', '#b79cff'],
  ['Soaked', '#5ad8ff'],
]

const el = (tag, cls, html) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (html !== undefined) node.innerHTML = html
  return node
}
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export class Hud {
  constructor(root, { tables, core, audio, format }) {
    this.root = root
    this.tables = tables
    this.core = core
    this.audio = audio
    this.format = format
    this.pending = null
    this.onForfeit = null
    root.innerHTML = ''
    root.classList.add('maul-hud')
    this.top = el('div', 'hud-top')
    this.plates = [this.plate('left'), this.plate('right')]
    this.mid = el('div', 'hud-mid', '<div class="hud-kind"></div><div class="hud-pot"></div><div class="hud-clock"></div>')
    this.top.append(this.plates[0].node, this.mid, this.plates[1].node)
    this.banner = el('div', 'hud-banner', '<div class="banner-main"></div><div class="banner-sub"></div>')
    this.numbers = el('div', 'hud-numbers')
    this.reveals = [el('div', 'reveal left'), el('div', 'reveal right')]
    this.bottom = el('div', 'hud-bottom')
    this.hint = el('div', 'hud-hint')
    this.tray = el('div', 'moves')
    this.rule = el(
      'div',
      'hud-rule',
      '<div><b>Strike</b> beats <b>Break</b> <span>·</span> <b>Break</b> beats <b>Guard</b> <span>·</span> <b>Guard</b> beats <b>Strike</b></div>' +
        '<div class="hud-ring"><b>Ember</b> › <b>Thorn</b> › <b>Stone</b> › <b>Storm</b> › <b>Tide</b> › <b>Ember</b> <span>·</span> double damage to the one you beat</div>',
    )
    this.bottom.append(this.hint, this.tray, this.rule)
    this.logBox = el('div', 'hud-log')
    this.corner = el('div', 'hud-corner')
    this.giveUp = el('button', 'hud-small', 'Give up')
    this.giveUp.addEventListener('click', () => this.onForfeit && this.onForfeit())
    this.corner.append(this.giveUp)
    root.append(this.top, this.numbers, this.reveals[0], this.reveals[1], this.banner, this.bottom, this.logBox, this.corner)
    this.onKey = (event) => {
      if (!this.pending || event.repeat) return
      const i = KEYS.indexOf(event.key)
      if (i < 0) return
      const button = this.tray.children[i]
      if (button && !button.disabled) button.click()
    }
    window.addEventListener('keydown', this.onKey)
  }

  plate(side) {
    const node = el(
      'div',
      `plate ${side}`,
      `<div class="plate-head"><span class="plate-name"></span><span class="plate-level"></span><span class="plate-aspect"></span></div>
       <div class="plate-owner"></div>
       <div class="bar hp"><em></em><i></i><span class="bar-text"></span></div>
       <div class="bar rage"><i></i></div>
       <div class="plate-row"><div class="pips"></div><div class="effects"></div><div class="trail"></div></div>`,
    )
    const q = (s) => node.querySelector(s)
    return { node, name: q('.plate-name'), level: q('.plate-level'), aspect: q('.plate-aspect'), owner: q('.plate-owner'), hp: q('.hp'), hpFill: q('.hp i'), hpTrail: q('.hp em'), hpText: q('.bar-text'), rage: q('.rage'), rageFill: q('.rage i'), pips: q('.pips'), effects: q('.effects'), trail: q('.trail') }
  }

  show() {
    this.root.classList.add('on')
  }

  hide() {
    this.root.classList.remove('on')
    this.cancel()
  }

  /** The header: who is fighting whom, and for what. */
  setup({ names, labels, kind, pot }) {
    this.names = names
    for (let s = 0; s < 2; s++) {
      this.plates[s].owner.innerHTML = `<b>${escape(names[s])}</b> · ${escape(labels[s])}`
      this.plates[s].trail.innerHTML = ''
    }
    this.mid.querySelector('.hud-kind').textContent = kind
    this.mid.querySelector('.hud-pot').textContent = pot || ''
    this.mid.querySelector('.hud-clock').textContent = ''
    this.logBox.innerHTML = ''
    this.hint.textContent = ''
    this.tray.innerHTML = ''
  }

  /** Shows one side's fighter (or an empty plate while nobody is in). `side` is 0 left, 1 right. */
  fighter(side, fighter, name) {
    const plate = this.plates[side]
    if (!fighter) {
      plate.name.textContent = '—'
      plate.level.textContent = ''
      plate.aspect.textContent = ''
      plate.aspect.style.display = 'none'
      this.hp(side, 0, 1, true)
      this.rage(side, 0)
      this.effects(side, {})
      return
    }
    const species = this.tables.species[fighter.species]
    plate.name.textContent = name || this.core.formName(fighter.species, fighter.level ?? 1)
    plate.level.textContent = `LV ${fighter.level ?? 1}`
    plate.aspect.style.display = ''
    plate.aspect.textContent = this.tables.aspects[fighter.aspect]
    plate.aspect.style.color = ASPECT_COLOURS[fighter.aspect]
    this.hp(side, fighter.hp, fighter.max_hp, true)
    this.rage(side, fighter.rage)
    this.effects(side, fighter)
    plate.trail.innerHTML = ''
  }

  hp(side, hp, max, instant = false) {
    const plate = this.plates[side]
    const k = Math.max(0, Math.min(1, hp / Math.max(1, max)))
    plate.hpFill.style.transform = `scaleX(${k})`
    if (instant) {
      plate.hpTrail.style.transition = 'none'
      plate.hpTrail.style.transform = `scaleX(${k})`
      void plate.hpTrail.offsetWidth
      plate.hpTrail.style.transition = ''
    } else {
      plate.hpTrail.style.transform = `scaleX(${k})`
    }
    plate.hpText.textContent = max > 1 ? `${hp} / ${max}` : ''
    plate.hp.classList.toggle('low', k > 0 && k < 0.3)
  }

  rage(side, rage) {
    const plate = this.plates[side]
    plate.rageFill.style.transform = `scaleX(${Math.min(1, rage / 100)})`
    plate.rage.classList.toggle('full', rage >= 100)
  }

  /** The lasting effects on a fighter: reads burn, bleed (shown as Winded), sunder, shock, soak (turns left). */
  effects(side, f) {
    const turns = [f.burn, f.bleed, f.sunder, f.shock, f.soak]
    this.plates[side].effects.innerHTML = turns
      .map((n, i) => (n > 0 ? `<span class="effect" style="color:${EFFECTS[i][1]}">${EFFECTS[i][0]} ${n}</span>` : ''))
      .join('')
  }

  /** The three markers under a plate: who is in, who is down, who is unseen. */
  team(side, team, active, hideUnseen) {
    this.plates[side].pips.innerHTML = team
      .map((f, i) => {
        const cls = f.hp <= 0 ? 'down' : i === active ? 'in' : hideUnseen && !f.seen ? 'hidden' : ''
        return `<span class="pip ${cls}" style="--c:${ASPECT_COLOURS[f.aspect]}" title="${escape(this.tables.species[f.species].name)}"></span>`
      })
      .join('')
  }

  pot(text) {
    this.mid.querySelector('.hud-pot').textContent = text || ''
  }

  clock(seconds) {
    const node = this.mid.querySelector('.hud-clock')
    if (seconds === null || seconds === undefined) {
      node.textContent = ''
      return
    }
    const s = Math.ceil(seconds)
    node.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    node.classList.toggle('low', s <= 10)
  }

  log(text) {
    this.logBox.append(el('div', '', escape(text)))
    while (this.logBox.children.length > 5) this.logBox.firstChild.remove()
  }

  setHint(html) {
    this.hint.innerHTML = html || ''
  }

  /** A big word across the screen. Resolves when it has gone (or at once when held). */
  flash(text, { sub = '', colour = '', glow = '', seconds = 1.6, hold = false } = {}) {
    const node = this.banner
    node.querySelector('.banner-main').textContent = text
    node.querySelector('.banner-sub').textContent = sub
    node.style.setProperty('--c', colour || 'var(--bone)')
    node.style.setProperty('--glow', glow || 'rgba(200,16,46,.65)')
    node.style.setProperty('--t', `${seconds}s`)
    node.classList.remove('on', 'hold')
    void node.offsetWidth
    node.classList.add(hold ? 'hold' : 'on')
    return new Promise((resolve) => setTimeout(resolve, hold ? 450 : seconds * 1000))
  }

  clearFlash() {
    this.banner.classList.remove('on', 'hold')
  }

  /** Shows which move a side chose (or that it swapped), and remembers it under their plate. */
  reveal(side, move) {
    const node = this.reveals[side]
    const swap = move >= SWAP
    const icon = swap ? ICON.swap : ICON[move]
    const name = swap ? 'Swap' : MOVE_NAMES[move]
    const colour = swap ? '#7fd0ff' : move === 3 ? '#ffd27a' : move === 1 ? '#9fc4ff' : move === 2 ? '#ff9a5a' : '#efe6d6'
    node.style.setProperty('--c', colour)
    node.innerHTML = `${icon}<span>${name}</span>`
    node.classList.remove('on')
    void node.offsetWidth
    node.classList.add('on')
    const trail = this.plates[side].trail
    const mark = el('span', '', icon)
    mark.style.color = colour
    mark.title = name
    trail.append(mark)
    while (trail.children.length > 6) trail.firstChild.remove()
  }

  /** A number or a word that floats up from a point on screen (x, y in 0..1 from the top-left). */
  number(x, y, text, { kind = '', sub = '', colour = '' } = {}) {
    const node = el('div', `num ${kind}`, `${escape(text)}${sub ? `<small>${escape(sub)}</small>` : ''}`)
    node.style.left = `${x * 100}%`
    node.style.top = `${y * 100}%`
    if (colour) node.style.setProperty('--c', colour)
    this.numbers.append(node)
    setTimeout(() => node.remove(), 1100)
  }

  /** How beast `f` fares against `foe`, as a short note and its colour class. */
  matchUp(f, foe) {
    if (!foe) return { note: '', cls: '' }
    const foeName = this.tables.aspects[foe.aspect]
    if ((f.aspect + 1) % 5 === foe.aspect) return { note: `Double damage to ${foeName}`, cls: 'good' }
    if ((foe.aspect + 1) % 5 === f.aspect) return { note: `${foeName} hits it double`, cls: 'bad' }
    return { note: 'Even match-up', cls: '' }
  }

  /**
   * Asks the player for a move. Resolves with 0..3, or 20 + slot to swap in a beast from
   * `bench` ([{ f, slot, name }]) instead. `locked` greys the swaps out (sudden death).
   */
  chooseMove(fighter, foe, { bench = [], locked = false } = {}) {
    this.cancel()
    const species = this.tables.species[fighter.species]
    this.tray.className = 'moves'
    this.tray.innerHTML = ''
    this.rule.classList.add('on')
    return new Promise((resolve) => {
      this.pending = resolve
      const offer = (button, value) => {
        button.addEventListener('mouseenter', () => this.audio?.sfx('ui_hover', { volume: 0.5 }))
        button.addEventListener('click', () => {
          if (!this.pending) return
          this.pending = null
          this.audio?.sfx('ui_confirm')
          for (const other of this.tray.children) other.disabled = true
          button.classList.add('chosen')
          resolve(value)
        })
        this.tray.append(button)
      }
      MOVE_NAMES.forEach((name, i) => {
        const special = i === 3
        const ready = special && fighter.rage >= 100
        const button = el(
          'button',
          `move${special ? ' special' : ''}${ready ? ' ready' : ''}`,
          `${ICON[i]}<span class="move-name${special && species.special.length > 10 ? ' long' : ''}">${special ? escape(species.special) : name}</span><span class="move-text">${special && !ready ? `Needs a full Rage bar (${fighter.rage}/100).` : special ? this.specialText(fighter.aspect) : MOVE_TEXT[i]}</span><kbd>${KEYS[i]}</kbd>`,
        )
        if (special) button.style.setProperty('--c', ASPECT_COLOURS[fighter.aspect])
        button.disabled = special && !ready
        offer(button, i)
      })
      // The rest of the squad, to swap in instead of a move.
      bench.forEach(({ f, slot, name }, k) => {
        const { note, cls } = this.matchUp(f, foe)
        const button = el(
          'button',
          `move swap${k === 0 ? ' first' : ''}`,
          `${ICON.swap}<span class="move-name${name.length > 10 ? ' long' : ''}">${escape(name)}</span><span class="move-text ${locked ? '' : cls}">${locked ? 'Sudden death: no swapping.' : `Swap in. ${escape(note)}.`}</span><kbd>${KEYS[4 + k]}</kbd>`,
        )
        button.style.setProperty('--c', ASPECT_COLOURS[f.aspect])
        button.title = `Swap in ${name} instead of a move. It takes your rival's move this turn.`
        button.disabled = locked
        offer(button, SWAP + slot)
      })
      const beaten = foe && (foe.aspect + 1) % 5 === fighter.aspect
      const better = beaten && !locked && bench.some(({ f }) => this.matchUp(f, foe).cls !== 'bad')
      if (foe && foe.rage >= 100) this.setHint(`Their Rage is full. <b>Expect the Special.</b>`)
      else if (better) this.setHint(`${this.tables.aspects[foe.aspect]} beats ${this.tables.aspects[fighter.aspect]}. <b>Swap in a better beast?</b>`)
      else this.setHint('Choose your move. <b>They are choosing too.</b>')
    })
  }

  specialText(aspect) {
    return ['Huge fire damage. Leaves a burn.', 'Huge damage. Heals you for half of it.', 'Huge damage. Breaks their defence.', 'Huge damage. Slows them and drains Rage.', 'Huge damage. Weakens their attack.'][aspect]
  }

  /** Asks the player which beast to send in. Resolves with the slot (0..2). */
  choosePick(team, foe, opening) {
    this.cancel()
    this.tray.className = 'picks'
    this.tray.innerHTML = ''
    return new Promise((resolve) => {
      this.pending = resolve
      team.forEach((f, slot) => {
        const species = this.tables.species[f.species]
        let note = ''
        let noteClass = ''
        if (f.hp <= 0) note = 'Down'
        else if (foe) ({ note, cls: noteClass } = this.matchUp(f, foe))
        else if (opening) note = 'Your rival is choosing too'
        const k = Math.max(0, f.hp / f.max_hp)
        const button = el(
          'button',
          'pick',
          `<div class="pick-name">${escape(f.name || this.core.formName(f.species, f.level ?? 1))}</div>
           <div class="pick-aspect">${this.tables.aspects[f.aspect]} · Level ${f.level ?? 1}</div>
           <div class="bar hp"><i style="transform:scaleX(${k})"></i></div>
           <div class="pick-note ${noteClass}">${note}</div>`,
        )
        button.style.setProperty('--c', ASPECT_COLOURS[f.aspect])
        button.disabled = f.hp <= 0
        button.addEventListener('mouseenter', () => this.audio?.sfx('ui_hover', { volume: 0.5 }))
        button.addEventListener('click', () => {
          if (!this.pending) return
          this.pending = null
          this.audio?.sfx('ui_confirm')
          for (const other of this.tray.children) other.disabled = true
          resolve(slot)
        })
        this.tray.append(button)
      })
      this.setHint(opening ? 'Who goes in first?' : 'Your beast is down. <b>Who goes in next?</b>')
    })
  }

  /** Clears the buttons and shows a line instead ("Waiting for your rival…"). */
  wait(html) {
    this.cancel()
    this.tray.innerHTML = ''
    this.setHint(html)
  }

  cancel() {
    this.pending = null
    this.rule.classList.remove('on')
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey)
    this.root.innerHTML = ''
  }
}

export { NONE, MOVE_NAMES, SWAP }
