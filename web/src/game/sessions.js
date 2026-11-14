// Where a fight's moves go and where its results come from. Three kinds:
//
// - practice: nothing on chain. The rules module plays both the referee and the house fighter.
// - den: the contract referees and picks the house fighter's move in the same call as the player's.
// - duel: two players. Moves are sealed, then opened; the contract plays the step when both are open.
//
// All three look the same to the fight scene:
//   session.me            which side the local player is (0 or 1)
//   session.battle        the latest battle state (maul_core::battle::Battle as JSON)
//   session.names         [left name, right name] as people should read them
//   await session.act(a)  send the local player's action → steps that have been played since ([{ turn, events }])
//   await session.wait()  (duel) wait for the other side → steps
//   session.clock()       seconds left on the move clock, or null
//   session.result()      { won, match } once battle.winner is set

import { core } from '../core.js'

const NONE = 255

// Filming draws the page one frame at a time, so its clock runs far behind the chain's.
const FILM = (() => {
  try {
    return new URLSearchParams(globalThis.location.search).get('film') === '1'
  } catch {
    return false
  }
})()

function seed() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Keeps only the steps the fight scene has not shown yet. */
function unseen(match, sinceTurn) {
  const steps = (match.steps || []).filter((step) => step.turn > sinceTurn)
  if (!steps.length && match.battle.turn > sinceTurn && match.last_events?.length) {
    steps.push({ turn: match.battle.turn, events: match.last_events })
  }
  return steps
}

export class PracticeSession {
  constructor({ squad, den, tables }) {
    this.kind = 'practice'
    this.me = 0
    this.den = tables.dens[den] || tables.dens[0]
    this.tables = tables
    // As in a free spar on chain: the house fighter's beasts have the fixed level of its tier.
    const level = core.den(this.den.name, '0', 0, 0, 0, this.den.tier).spar_level
    const foes = this.den.squad.map((species) => ({ token: 0, species, level, relic: 0, aura: 0, finisher: 0 }))
    const mine = squad.map((build) => ({ token: build.token ?? 0, species: build.species, level: build.level ?? 1, relic: build.relic ?? 0, aura: build.aura ?? 0, finisher: build.finisher ?? 0 }))
    this.battle = core.battleNew(mine, foes).battle
    this.names = ['You', this.den.name]
    this.labels = ['Practice', 'House fighter · computer-run']
    this.stake = '0'
  }

  need() {
    if (this.battle.winner !== NONE) return [false, false]
    const picking = [this.battle.active[0] === NONE, this.battle.active[1] === NONE]
    return picking[0] || picking[1] ? picking : [true, true]
  }

  async act(action) {
    const steps = []
    let mine = action
    // Play the player's step, then any steps where only the house has to act.
    for (let guard = 0; guard < 6; guard++) {
      const need = this.need()
      if (!need[0] && !need[1]) break
      if (need[0] && mine === null) break
      const foe = need[1] ? core.npcAction(this.battle, 1, this.den.style, seed()).act : null
      const out = core.battleStep(this.battle, [need[0] ? mine : null, foe], seed())
      this.battle = out.battle
      steps.push({ turn: this.battle.turn, events: out.events })
      mine = null
    }
    return steps
  }

  async wait() {
    return this.act(null)
  }

  /** Steps that have been played but not yet handed to the fight. Practice hands every step over at once. */
  rest() {
    return []
  }

  clock() {
    return null
  }

  async forfeit() {
    this.battle = { ...this.battle, winner: 1 }
  }

  result() {
    return { won: this.battle.winner === 0, match: null, practice: true }
  }
}

export class DenSession {
  constructor({ match, api, tables }) {
    this.kind = 'den'
    this.me = 0
    this.api = api
    this.match = match
    this.battle = match.battle
    this.seen = match.battle.turn
    this.den = tables.dens[match.den] || tables.dens[0]
    this.names = [api.state.session?.accountId ?? 'You', this.den.name]
    this.labels = [BigInt(match.stake) > 0n ? 'Staked fight' : 'Spar', 'House fighter · computer-run']
    this.stake = match.stake
  }

  need() {
    return this.match.need
  }

  take(match) {
    const steps = unseen(match, this.seen)
    this.match = match
    this.battle = match.battle
    this.seen = match.battle.turn
    return steps
  }

  async act(action) {
    return this.take(await this.api.denAct(action))
  }

  async wait() {
    return []
  }

  /** Steps that have been played but not yet handed to the fight. */
  rest() {
    return this.take(this.match)
  }

  clock() {
    return null
  }

  async forfeit() {
    this.take(await this.api.forfeitDen())
  }

  result() {
    return { won: this.match.winner === 0, match: this.match }
  }
}

export class DuelSession {
  constructor({ match, api }) {
    this.kind = 'duel'
    this.api = api
    this.match = match
    this.battle = match.battle
    this.seen = match.battle.turn
    const account = api.state.session?.accountId
    this.me = match.players[1] === account ? 1 : 0
    this.names = [match.players[this.me], match.players[1 - this.me]]
    this.labels = [BigInt(match.stake) > 0n ? 'Duel for NEAR' : 'Friendly duel', 'Rival']
    this.stake = match.stake
    this.waiters = []
    this.stop = api.watchDuel(match.id, (latest) => this.onMatch(latest))
  }

  need() {
    return this.match.need
  }

  onMatch(match) {
    if (!match) return
    this.match = match
    this.battle = match.battle
    const ready = match.battle.turn > this.seen || match.over
    if (ready) {
      const waiters = this.waiters
      this.waiters = []
      for (const resolve of waiters) resolve()
    }
    if (this.onChange) this.onChange(match)
  }

  take() {
    const steps = unseen(this.match, this.seen)
    this.seen = this.match.battle.turn
    return steps
  }

  /** Sends the local player's move. The step plays when the rival's move is open too. */
  async act(action) {
    const match = await this.api.duelMove(action)
    this.onMatch(match)
    return this.wait()
  }

  /**
   * Steps that have been played but not yet handed to the fight: the last one, when the duel
   * ended while the fight was still showing the one before it.
   */
  rest() {
    return this.take()
  }

  /** Resolves with the new steps once the battle has moved on (or is over). */
  async wait() {
    if (!(this.match.battle.turn > this.seen || this.match.over)) {
      await new Promise((resolve) => this.waiters.push(resolve))
    }
    return this.take()
  }

  clock() {
    if (!this.match.deadline || this.match.over) return null
    // Never more than the clock the contract gives (180 s to open, 75 s a move), even if
    // this machine's clock runs behind the chain's.
    const most = this.match.battle.turn === 0 ? 180 : 75
    if (FILM) {
      // While filming, count down on the page's own clock from each new deadline, as a player would see it.
      if (this.deadlineKey !== this.match.deadline) {
        this.deadlineKey = this.match.deadline
        this.deadlineAt = Date.now() / 1000
      }
      return Math.max(0, most - (Date.now() / 1000 - this.deadlineAt))
    }
    return Math.max(0, Math.min(most, this.match.deadline - Date.now() / 1000))
  }

  /** What the two sides have done this turn: [mine, theirs], each 'none' | 'sealed' | 'open'. */
  progress() {
    const of = (side) => (this.match.open?.[side] ? 'open' : this.match.sealed?.[side] ? 'sealed' : 'none')
    return [of(this.me), of(1 - this.me)]
  }

  async claimTimeout() {
    this.onMatch(await this.api.claimTimeout())
  }

  async forfeit() {
    this.onMatch(await this.api.forfeitDuel())
  }

  result() {
    return { won: this.match.winner === this.me, match: this.match, void: !!this.match.void }
  }

  close() {
    if (this.stop) this.stop()
  }
}
