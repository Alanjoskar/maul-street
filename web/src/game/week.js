// A week on Maul Street, in a minute.
//
// A simulation, clearly labelled as one: nothing here touches the chain. Thirty
// made-up challengers and a handful of made-up backers act for seven days, and
// every number comes from the same rules module the contract runs (the fights,
// the dens' stake limits and payouts, their training, the bazaar's prices). It
// exists so anyone can watch the economy move without waiting a week.

import './week.css'

const HOURS = 168
const NEAR = 10n ** 24n
const MILLI = 10n ** 21n
const DEN_COLOURS = ['#d8a548', '#7bd23c', '#ff6a2a', '#a78bff', '#35c9ff']
const yocto = (near) => (BigInt(Math.round(near * 1000)) * MILLI).toString()
const near = (y) => Number(BigInt(y) / MILLI) / 1000
const el = (tag, cls, html) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (html !== undefined) node.innerHTML = html
  return node
}

function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Week {
  constructor(core, tables) {
    this.core = core
    this.tables = tables
    this.random = mulberry(20261111)
    this.hour = 0
    this.events = []
    this.dens = tables.dens.map((den) => ({ den, bankroll: 3, shares: 3, results: [], spent: 0, rank: 0, wins: 0, losses: 0, history: [3], closedAt: null }))
    this.challengers = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      // How they fight: one of the five house styles, standing in for a human's habits.
      style: Math.floor(this.random() * 5),
      // Two in five are sharps: they have learned each den's habit and play against it.
      sharp: this.random() < 0.4,
      wallet: 2 + this.random() * 6,
      squad: [0, 1, 2].map(() => Math.floor(this.random() * 10)),
      level: 1 + Math.floor(this.random() * 6),
      seen: tables.dens.map(() => ({ wins: 1, fights: 2 })),
    }))
    this.backers = Array.from({ length: 6 }, () => ({ wallet: 4 + this.random() * 6, shares: tables.dens.map(() => 0) }))
    this.item = { name: tables.items[0].name, floor: near(tables.items[0].price), heat: 0, history: [] }
    this.totals = { fights: 0, staked: 0, toChallengers: 0, toDens: 0 }
  }

  stamp() {
    return `Day ${Math.floor(this.hour / 24) + 1} · ${String(this.hour % 24).padStart(2, '0')}:00`
  }

  note(text, colour) {
    this.events.unshift({ at: this.stamp(), text, colour })
    if (this.events.length > 40) this.events.pop()
  }

  rules(d) {
    const fights = d.results.length
    const wins = d.results.filter(Boolean).length
    return this.core.den(d.den.name, yocto(d.bankroll), wins, fights, d.rank)
  }

  /** One fight, both sides played by the rules module. Returns true if the challenger won. */
  fight(challenger, d) {
    const mine = challenger.squad.map((species) => ({ token: 0, species, level: challenger.level, relic: 0, aura: 0, finisher: 0 }))
    // A staked fight: the den matches the challenger's level, plus what its training has bought.
    const level = challenger.level + this.rules(d).level_bonus
    const theirs = d.den.squad.map((species) => ({ token: 0, species, level, relic: 0, aura: 0, finisher: 0 }))
    let battle = this.core.battleNew(mine, theirs).battle
    for (let step = 0; step < 300 && battle.winner === 255; step++) {
      const seed = `${this.hour}:${challenger.id}:${step}:${Math.floor(this.random() * 1e9)}`
      const picking = [battle.active[0] === 255, battle.active[1] === 255]
      const need = picking[0] || picking[1] ? picking : [true, true]
      let mine = need[0] ? this.core.npcAction(battle, 0, challenger.style, `${seed}a`).act : null
      // A sharp answers the den's favourite move: Guard for a brawler, Break for a wall, Strike for a gambler.
      const answer = [1, 2, 0][d.den.style]
      if (mine !== null && mine < 3 && challenger.sharp && answer !== undefined && this.random() < 0.62) mine = answer
      const acts = [mine, need[1] ? this.core.npcAction(battle, 1, d.den.style, `${seed}b`).act : null]
      battle = this.core.battleStep(battle, acts, seed).battle
    }
    return battle.winner === 0
  }

  /** One hour: a couple of fights, the backers look at the books, the bazaar cools. */
  tick() {
    if (this.hour >= HOURS) return false
    for (let n = 0; n < 2; n++) {
      const c = this.challengers[Math.floor(this.random() * this.challengers.length)]
      // Go where the odds look best, judging by how it went there before.
      let best = null
      let bestEdge = -Infinity
      this.dens.forEach((d, i) => {
        const r = this.rules(d)
        if (!r.open) return
        const rate = c.seen[i].wins / c.seen[i].fights
        const edge = rate * (r.payout_bps / 10000) - 1 + (this.random() - 0.5) * 0.25
        if (edge > bestEdge) {
          bestEdge = edge
          best = { d, i, r }
        }
      })
      if (!best) continue
      const { d, i, r } = best
      const max = near(r.max_stake)
      const stake = bestEdge > -0.12 ? Math.floor(Math.min(max, c.wallet * 0.25) * 100) / 100 : 0
      const won = this.fight(c, d)
      c.seen[i].fights++
      if (won) c.seen[i].wins++
      this.totals.fights++
      if (stake >= 0.01) {
        this.totals.staked += stake
        const before = this.rules(d)
        if (won) {
          const profit = Math.min(d.bankroll, stake * (r.payout_bps / 10000 - 1))
          d.bankroll -= profit
          c.wallet += profit
          d.losses++
          this.totals.toChallengers += profit
          // Winners spend: sometimes on a relic, which lifts its price for everyone.
          if (this.random() < 0.35 && c.wallet > this.price()) {
            c.wallet -= this.price()
            this.item.heat = Math.min(100, this.item.heat + 1)
          } else if (this.random() < 0.4) {
            c.level++
          }
        } else {
          const training = stake * 0.1
          d.bankroll += stake - training
          d.spent += training
          c.wallet -= stake
          d.wins++
          this.totals.toDens += stake
          let bought = 0
          let left = d.spent
          while (true) {
            const cost = near(this.core.level(bought + 1).near)
            if (cost > left) break
            left -= cost
            bought++
          }
          const bonusBefore = this.rules(d).level_bonus
          d.rank = bought
          const bonus = this.rules(d).level_bonus
          if (bonus > bonusBefore) this.note(`${d.den.name}'s winnings paid for training: its beasts now fight ${bonus} level${bonus === 1 ? '' : 's'} above their challengers.`, DEN_COLOURS[i])
        }
        d.results.push(!won)
        if (d.results.length > 10) d.results.shift()
        const after = this.rules(d)
        if (before.open && !after.open) {
          d.closedAt = this.hour
          this.note(`${d.den.name} is down to ${d.bankroll.toFixed(2)} NEAR and closes its doors.`, '#c8102e')
        } else if (after.payout_bps !== before.payout_bps && d.results.length >= 3 && Math.abs(after.payout_bps - before.payout_bps) >= 500) {
          this.note(after.payout_bps > before.payout_bps ? `${d.den.name} keeps winning, so it raises its payout to ${(after.payout_bps / 10000).toFixed(2)}x to tempt challengers.` : `${d.den.name} keeps losing, so it cuts its payout to ${(after.payout_bps / 10000).toFixed(2)}x.`, DEN_COLOURS[i])
        }
      }
      if (c.wallet < 0.5) c.wallet += 3 // a new face with fresh NEAR takes the place of one who went broke
    }
    // Backers.
    this.dens.forEach((d, i) => {
      const open = this.rules(d).open
      const dayAgo = d.history[Math.max(0, d.history.length - 24)]
      const b = this.backers[Math.floor(this.random() * this.backers.length)]
      const price = d.shares > 0 ? d.bankroll / d.shares : 1
      if (!open && this.hour - (d.closedAt ?? this.hour) >= 5 && b.wallet >= 1 && this.random() < 0.3) {
        b.wallet -= 1
        b.shares[i] += 1 / Math.max(price, 0.01)
        d.shares += 1 / Math.max(price, 0.01)
        d.bankroll += 1
        d.closedAt = null
        this.note(`A backer puts 1.00 NEAR behind ${d.den.name}. It reopens.`, '#d8a548')
      } else if (open && d.bankroll > dayAgo * 1.1 && b.wallet >= 0.5 && this.random() < 0.1) {
        b.wallet -= 0.5
        b.shares[i] += 0.5 / price
        d.shares += 0.5 / price
        d.bankroll += 0.5
        this.note(`A backer buys into ${d.den.name}, which is up ${(((d.bankroll - 0.5) / dayAgo - 1) * 100).toFixed(0)}% on the day.`, DEN_COLOURS[i])
      } else if (open && d.bankroll < dayAgo * 0.85 && b.shares[i] > 0 && this.random() < 0.2) {
        const sell = b.shares[i] / 2
        const out = Math.min(d.bankroll - 0.5, sell * price)
        if (out > 0.05) {
          b.shares[i] -= out / price
          d.shares -= out / price
          d.bankroll -= out
          b.wallet += out
          this.note(`A backer cashes ${out.toFixed(2)} NEAR out of ${d.den.name}.`, '#9c8f7c')
        }
      }
      d.history.push(d.bankroll)
    })
    // The bazaar cools six notches an hour, as it does on chain (one every ten minutes).
    this.item.history.push(this.price())
    this.item.heat = Math.max(0, this.item.heat - 6)
    this.hour++
    return true
  }

  price() {
    return near(this.core.price(yocto(this.item.floor), this.item.heat).price)
  }
}

/** Opens the simulation over the page. Returns a function that closes it. */
export function openWeek({ core, tables, audio }) {
  const sim = new Week(core, tables)
  const overlay = el('div', 'week')
  overlay.innerHTML = `
    <div class="week-panel">
      <div class="week-head">
        <div>
          <div class="week-title">A WEEK ON MAUL STREET</div>
          <div class="week-sub">A simulation. Nothing here is on chain. Thirty made-up challengers (some of them sharp enough to play each den's habit) and six made-up backers act for seven days. Every fight, payout and price comes from the same rules file the contract runs.</div>
        </div>
        <div class="week-controls">
          <button class="week-btn primary" data-act="run">Start</button>
          <button class="week-btn" data-act="speed">Speed x1</button>
          <button class="week-btn" data-act="close">Close</button>
        </div>
      </div>
      <div class="week-body">
        <div class="week-chart"><canvas></canvas><div class="week-clock">Day 1 · 00:00</div></div>
        <div class="week-side">
          <div class="week-dens"></div>
          <div class="week-item"></div>
        </div>
      </div>
      <div class="week-foot">
        <div class="week-feed"></div>
        <div class="week-totals"></div>
      </div>
    </div>`
  document.body.append(overlay)
  const canvas = overlay.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const densBox = overlay.querySelector('.week-dens')
  const feed = overlay.querySelector('.week-feed')
  const clock = overlay.querySelector('.week-clock')
  const itemBox = overlay.querySelector('.week-item')
  const totals = overlay.querySelector('.week-totals')
  let running = false
  let speed = 1
  let carry = 0
  let last = performance.now()
  let alive = true

  const draw = () => {
    const box = canvas.parentElement.getBoundingClientRect()
    const scale = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(box.width * scale) || canvas.height !== Math.round(box.height * scale)) {
      canvas.width = Math.round(box.width * scale)
      canvas.height = Math.round(box.height * scale)
    }
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    const pad = { l: 46 * scale, r: 12 * scale, t: 14 * scale, b: 26 * scale }
    const top = Math.max(4, ...sim.dens.flatMap((d) => d.history)) * 1.1
    const x = (hour) => pad.l + ((w - pad.l - pad.r) * hour) / HOURS
    const y = (value) => h - pad.b - ((h - pad.t - pad.b) * value) / top
    ctx.font = `${12 * scale}px Barlow Condensed, sans-serif`
    ctx.fillStyle = '#9c8f7c'
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.lineWidth = scale
    for (let day = 0; day <= 7; day++) {
      ctx.beginPath()
      ctx.moveTo(x(day * 24), pad.t)
      ctx.lineTo(x(day * 24), h - pad.b)
      ctx.stroke()
      if (day < 7) ctx.fillText(`DAY ${day + 1}`, x(day * 24) + 6 * scale, h - 8 * scale)
    }
    for (let v = 0; v <= top; v += top > 12 ? 4 : top > 6 ? 2 : 1) {
      ctx.beginPath()
      ctx.moveTo(pad.l, y(v))
      ctx.lineTo(w - pad.r, y(v))
      ctx.stroke()
      ctx.fillText(`${v} N`, 8 * scale, y(v) + 4 * scale)
    }
    // The line below which a den closes.
    ctx.strokeStyle = 'rgba(200,16,46,0.6)'
    ctx.setLineDash([6 * scale, 6 * scale])
    ctx.beginPath()
    ctx.moveTo(pad.l, y(0.5))
    ctx.lineTo(w - pad.r, y(0.5))
    ctx.stroke()
    ctx.setLineDash([])
    sim.dens.forEach((d, i) => {
      ctx.strokeStyle = DEN_COLOURS[i]
      ctx.lineWidth = 2.5 * scale
      ctx.lineJoin = 'round'
      ctx.beginPath()
      d.history.forEach((value, hour) => (hour === 0 ? ctx.moveTo(x(hour), y(value)) : ctx.lineTo(x(hour), y(value))))
      ctx.stroke()
      const lastValue = d.history[d.history.length - 1]
      ctx.fillStyle = DEN_COLOURS[i]
      ctx.beginPath()
      ctx.arc(x(d.history.length - 1), y(lastValue), 4 * scale, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  const render = () => {
    clock.textContent = sim.hour >= HOURS ? 'The week is over' : sim.stamp()
    densBox.innerHTML = sim.dens
      .map((d, i) => {
        const r = sim.rules(d)
        const dots = Array.from({ length: 10 }, (_, k) => {
          const result = d.results[d.results.length - 10 + k]
          return `<i class="${result === undefined ? '' : result ? 'won' : 'lost'}"></i>`
        }).join('')
        return `<div class="week-den${r.open ? '' : ' closed'}" style="--c:${DEN_COLOURS[i]}" title="${r.reason.replace(/"/g, '&quot;')}">
          <div class="week-den-name">${d.den.name}<span>${d.den.title}</span></div>
          <div class="week-den-row"><b>${d.bankroll.toFixed(2)} N</b><span>${r.open ? `pays ${(r.payout_bps / 10000).toFixed(2)}x · max stake ${near(r.max_stake).toFixed(2)}` : 'closed until backed'}</span></div>
          <div class="week-den-row"><span class="week-dots">${dots}</span><span>${r.level_bonus ? `trained: +${r.level_bonus} level${r.level_bonus === 1 ? '' : 's'}` : ''}</span></div>
          <div class="week-den-why">${r.reason}</div>
        </div>`
      })
      .join('')
    feed.innerHTML = sim.events
      .slice(0, 7)
      .map((e) => `<div><span>${e.at}</span><b style="color:${e.colour || '#efe6d6'}">${e.text}</b></div>`)
      .join('')
    const price = sim.price()
    const over = Math.round((price / sim.item.floor - 1) * 100)
    itemBox.innerHTML = `<div class="week-item-name">Bazaar · ${sim.item.name}</div><div class="week-item-price">${price.toFixed(3)} N ${over > 0 ? `<em>▲ ${over}%</em>` : '<span>at its floor</span>'}</div><div class="week-item-why">${core.price(yocto(sim.item.floor), sim.item.heat).reason}</div>`
    totals.innerHTML = `<div><b>${sim.totals.fights}</b> fights</div><div><b>${sim.totals.staked.toFixed(1)} N</b> staked</div><div><b>${sim.totals.toChallengers.toFixed(1)} N</b> won from dens</div><div><b>${sim.totals.toDens.toFixed(1)} N</b> lost to dens</div>`
    draw()
  }

  const frame = (now) => {
    if (!alive) return
    requestAnimationFrame(frame)
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (!running) return
    // A week in about a minute at normal speed.
    carry += dt * (HOURS / 60) * speed
    let stepped = false
    const started = performance.now()
    while (carry >= 1 && performance.now() - started < 24) {
      carry -= 1
      stepped = true
      if (!sim.tick()) {
        running = false
        overlay.querySelector('[data-act="run"]').textContent = 'Finished'
        break
      }
    }
    if (stepped) render()
  }
  requestAnimationFrame(frame)
  render()
  const close = () => {
    alive = false
    overlay.remove()
  }
  overlay.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act
    if (!act) return
    audio?.sfx?.('ui_click')
    if (act === 'close') close()
    if (act === 'run' && sim.hour < HOURS) {
      running = !running
      event.target.textContent = running ? 'Pause' : 'Resume'
    }
    if (act === 'speed') {
      speed = speed === 1 ? 4 : speed === 4 ? 12 : 1
      event.target.textContent = `Speed x${speed}`
    }
  })
  window.addEventListener('resize', draw)
  return close
}

export { Week, NEAR }
