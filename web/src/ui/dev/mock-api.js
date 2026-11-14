// An in-memory stand-in for web/src/near/api.js, for building the menus alone.
//
// It keeps a small pretend world (one player, other trainers, five dens, a
// bazaar, a hire market, challenges, NEAR Social) and implements the whole
// `api` interface against it. Every action waits a moment, changes the world,
// republishes the state it touched and sometimes fails with a plain sentence,
// the way a real transaction can. It follows docs/CONTRACT.md closely: levels,
// XP and forms, what a fight pays, what the player record keeps pointing at.
// Prices, den rules, levels and the fights themselves come from the real rules
// module, so the numbers behave like the chain's.
//
// Nothing here is shipped: the game passes the real `api` to mountUi.

import { near as fmtNear } from '../format-fallback.js'

const MILLI = 10n ** 21n
const y = (nearAmount) => BigInt(Math.round(nearAmount * 1000)) * MILLI
const NONE = 255

const ME = 'rook.testnet'

const PEOPLE = {
  'rook.testnet': { name: 'Rook', about: 'Three beasts and one rule: never guard twice.' },
  'ironjaw.testnet': { name: 'Ironjaw', about: 'Stone, patience, and a heavy right hand.' },
  'nightshade.testnet': { name: 'Nightshade', about: 'I hire out. I do not lose.' },
  'pip.testnet': { name: '', about: '' },
  'mordecai-the-patient.testnet': { name: 'Mordecai', about: 'Slow money is still money.' },
  'brakk.testnet': { name: 'Brakk', about: 'Break first. Ask after.' },
  'vex.testnet': { name: 'Vex', about: 'Glass cuts both ways.' },
  'saltmother.testnet': { name: 'Saltmother', about: 'Tide waits for everyone.' },
  'oleander.testnet': { name: '', about: '' },
  'tallow.testnet': { name: 'Tallow', about: 'New to the Street.' },
  'quill-and-fang.testnet': { name: 'Quill', about: 'Backs dens. Reads tape.' },
  'hobbe.testnet': { name: '', about: '' },
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createMockApi({
  core,
  tables,
  connected = true,
  registered = true,
  socialEnabled = false,
  flaky = 0.1,
  simulate = false,
  midDuel = false,
  delay = 400,
  seed = 7,
} = {}) {
  const rng = mulberry(seed)
  const now = () => Math.floor(Date.now() / 1000)
  const listeners = { change: new Set(), toast: new Set(), duel: new Set() }
  const emit = (type, payload) => {
    for (const fn of Array.from(listeners[type] || [])) {
      try {
        fn(payload)
      } catch (error) {
        console.error(error)
      }
    }
  }

  const species = (id) => tables.species[id]
  const itemDef = (id) => tables.items.find((item) => item.id === id)

  // ----- The rules, as the contract uses them --------------------------------

  const levelOf = (level) => core.level(Math.max(1, level)) // { near, xp, form, next_form_at } for the NEXT level
  const xpForLevel = (level) => Number(levelOf(level).xp)
  const levelCostNear = (level) => BigInt(levelOf(level).near)
  const denXp = (tier, won, staked) => {
    const base = won ? 40 + 15 * tier : 15
    return staked ? Math.floor((base * 3) / 2) : base
  }
  const duelXp = (won) => (won ? 120 : 40)
  const beastXp = (fightXp, entered, kills) => (entered ? fightXp : Math.floor(fightXp / 2)) + Number(tables.rules.kill_xp || 15) * kills
  const denEssence = (tier, won) => (won ? 20 + 10 * tier : 8)
  const duelEssence = (won) => (won ? 40 : 10)
  function trainingLevels(spent) {
    let left = spent
    let bought = 0
    for (;;) {
      const cost = levelCostNear(bought + 1)
      if (cost > left) return bought
      left -= cost
      bought += 1
    }
  }

  // ----- The world --------------------------------------------------------

  const beasts = new Map()
  let nextBeast = 200
  function addBeast(beast) {
    const full = { custom: null, level: 1, xp: 0, relic: 0, aura: 0, finisher: 0, kills: 0, fights: 0, wins: 0, hire_price: null, earned: 0n, ...beast }
    if (full.id == null) full.id = nextBeast++
    beasts.set(full.id, full)
    return full
  }
  const buildOf = (b) => ({ token: b.id, species: b.species, level: b.level, relic: b.relic, aura: b.aura, finisher: b.finisher })
  const formName = (b) => core.formName(b.species, b.level)
  const nameOf = (b) => b.custom || formName(b)

  // The player's stable: five beasts at different points along their lines.
  const veteran = [
    addBeast({ id: 12, species: 0, custom: 'Cinder', owner: ME, level: 7, xp: 96, relic: 1, aura: 20, fights: 23, wins: 15, kills: 31, hire_price: y(0.02), earned: y(0.361) }),
    addBeast({ id: 13, species: 2, custom: 'Old Mason', owner: ME, level: 11, xp: 210, relic: 2, fights: 19, wins: 11, kills: 17 }),
    addBeast({ id: 14, species: 4, owner: ME, level: 4, xp: 60, fights: 9, wins: 5, kills: 8 }),
    addBeast({ id: 31, species: 3, custom: 'Needle', owner: ME, level: 13, xp: 40, relic: 3, finisher: 40, fights: 14, wins: 9, kills: 16 }),
    addBeast({ id: 47, species: 7, custom: 'Glasswork', owner: ME, level: 3, xp: 20, aura: 22, fights: 4, wins: 3, kills: 6 }),
  ]

  // Other trainers' beasts. The first twelve are offered for hire.
  addBeast({ id: 88, species: 8, custom: 'Anvil', owner: 'ironjaw.testnet', level: 27, xp: 310, relic: 2, aura: 23, finisher: 40, fights: 61, wins: 44, kills: 97, hire_price: y(0.04), earned: y(2.31) })
  addBeast({ id: 102, species: 6, custom: 'Hex', owner: 'nightshade.testnet', level: 18, xp: 120, relic: 5, aura: 22, finisher: 41, fights: 48, wins: 35, kills: 71, hire_price: y(0.05), earned: y(1.94) })
  addBeast({ id: 67, species: 2, custom: 'Skarn', owner: 'brakk.testnet', level: 26, xp: 90, relic: 4, fights: 77, wins: 49, kills: 88, hire_price: y(0.03), earned: y(1.12) })
  addBeast({ id: 119, species: 5, custom: 'Pyre', owner: 'nightshade.testnet', level: 22, xp: 400, relic: 1, aura: 20, finisher: 42, fights: 39, wins: 31, kills: 66, hire_price: y(0.08), earned: y(2.6) })
  addBeast({ id: 54, species: 3, custom: 'Whistle', owner: 'pip.testnet', level: 4, xp: 33, fights: 12, wins: 5, kills: 9, hire_price: y(0.005), earned: y(0.03) })
  addBeast({ id: 131, species: 9, custom: 'Brine', owner: 'saltmother.testnet', level: 14, xp: 77, relic: 6, aura: 21, fights: 33, wins: 22, kills: 40, hire_price: y(0.045), earned: y(0.9) })
  addBeast({ id: 73, species: 1, custom: 'Old Root', owner: 'mordecai-the-patient.testnet', level: 16, xp: 150, relic: 6, fights: 58, wins: 33, kills: 51, hire_price: y(0.02), earned: y(0.74) })
  addBeast({ id: 140, species: 7, custom: 'Mirror', owner: 'vex.testnet', level: 12, xp: 10, relic: 1, finisher: 40, fights: 27, wins: 19, kills: 37, hire_price: y(0.06), earned: y(0.66) })
  addBeast({ id: 95, species: 0, owner: 'tallow.testnet', level: 3, xp: 44, fights: 8, wins: 3, kills: 5, hire_price: y(0.008), earned: y(0.016) })
  addBeast({ id: 150, species: 4, custom: 'Lull', owner: 'saltmother.testnet', level: 9, xp: 101, relic: 3, fights: 21, wins: 13, kills: 22, hire_price: y(0.025), earned: y(0.3) })
  addBeast({ id: 158, species: 8, custom: 'Gavel', owner: 'quill-and-fang.testnet', level: 52, xp: 900, relic: 2, aura: 23, finisher: 42, fights: 90, wins: 68, kills: 141, hire_price: y(0.12), earned: y(6.84) })
  addBeast({ id: 161, species: 6, custom: 'Moth', owner: 'oleander.testnet', level: 6, xp: 12, fights: 15, wins: 8, kills: 13, hire_price: y(0.012), earned: y(0.07) })
  // Squad fillers for the open challenges (not for hire).
  addBeast({ id: 170, species: 3, custom: 'Hush', owner: 'nightshade.testnet', level: 17, relic: 3 })
  addBeast({ id: 171, species: 2, custom: 'Plinth', owner: 'ironjaw.testnet', level: 24, relic: 4 })
  addBeast({ id: 172, species: 7, custom: 'Shiv', owner: 'ironjaw.testnet', level: 19, relic: 1 })
  addBeast({ id: 173, species: 0, owner: 'pip.testnet', level: 3 })
  addBeast({ id: 174, species: 4, owner: 'pip.testnet', level: 5 })
  addBeast({ id: 175, species: 2, custom: 'Ledger', owner: 'mordecai-the-patient.testnet', level: 15, relic: 2 })
  addBeast({ id: 176, species: 9, owner: 'mordecai-the-patient.testnet', level: 13 })
  addBeast({ id: 177, species: 8, custom: 'Hod', owner: 'brakk.testnet', level: 29, relic: 2 })
  addBeast({ id: 178, species: 5, custom: 'Kiln', owner: 'brakk.testnet', level: 31, relic: 5 })

  const me = {
    registered,
    balance: y(3.42),
    essence: 264,
    rating: 1084,
    wins: 7,
    losses: 4,
    den_wins: 21,
    den_losses: 9,
    won: y(2.15),
    hire_income: y(0.361),
    beasts: veteran.map((b) => b.id),
    items: new Map([
      [4, 1],
      [5, 1],
      [21, 2],
      [41, 1],
    ]),
    hires: [
      { id: 88, fights_left: 3 },
      { id: 102, fights_left: 1 },
    ],
    den_match: null,
    duel: null,
    challenge: null,
    backing: new Map([[2, y(0.48)]]),
  }
  if (!registered) {
    for (const b of veteran) beasts.delete(b.id)
    Object.assign(me, {
      balance: 0n, essence: 0, rating: 1000, wins: 0, losses: 0, den_wins: 0, den_losses: 0, won: 0n, hire_income: 0n,
      beasts: [], items: new Map(), hires: [], backing: new Map(),
    })
  }

  let session = connected ? { accountId: ME } : null
  let wallet = y(48.25)

  // Dens: bankroll, total shares, and the last ten staked results (1 = the den won).
  const dens = [
    { id: 0, bankroll: y(12.4), shares: y(10), memory: [1, 1, 0, 1, 1, 1, 0, 1, 0, 1], total_wins: 61, total_losses: 38, training_spent: y(0.0335) },
    { id: 1, bankroll: y(8.05), shares: y(10), memory: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0], total_wins: 34, total_losses: 47, training_spent: y(0.011) },
    { id: 2, bankroll: y(21.7), shares: y(10.48), memory: [1, 1, 1, 1, 0, 1, 1, 1, 1, 1], total_wins: 88, total_losses: 29, training_spent: y(0.16) },
    { id: 3, bankroll: y(0.31), shares: y(10), memory: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0], total_wins: 19, total_losses: 52, training_spent: y(0.0) },
    { id: 4, bankroll: y(5.2), shares: y(10), memory: [1, 0], total_wins: 2, total_losses: 1, training_spent: y(0.05) },
  ]

  // The bazaar: heat and the time of the last purchase.
  const heatOf = { 1: 6, 2: 1, 3: 0, 4: 2, 5: 11, 6: 3, 20: 0, 21: 2, 22: 0, 23: 1, 40: 0, 41: 1, 42: 4 }
  const market = {
    items: tables.items.map((item) => ({ id: item.id, heat: heatOf[item.id] || 0, last_buy: now() - 120, sold: 4 + ((item.id * 7) % 23) + (heatOf[item.id] || 0) * 3 })),
    species: tables.species.map((s) => ({ id: s.id, heat: { 3: 1, 5: 3, 7: 5, 8: 2 }[s.id] || 0, last_buy: now() - 200, sold: s.rare ? 3 + (s.id % 4) : 14 + s.id * 3 })),
  }

  let nextChallenge = 32
  const challenges = [
    { id: 31, creator: 'nightshade.testnet', stake: y(0.25), level_cap: 12, invite: ME, squad: [102, 119, 170], created: now() - 140 },
    { id: 29, creator: 'ironjaw.testnet', stake: y(0.5), level_cap: 0, invite: null, squad: [88, 171, 172], created: now() - 9 * 60 },
    { id: 27, creator: 'pip.testnet', stake: 0n, level_cap: 5, invite: null, squad: [54, 173, 174], created: now() - 26 * 60 },
    { id: 25, creator: 'mordecai-the-patient.testnet', stake: y(0.1), level_cap: 0, invite: null, squad: [73, 175, 176], created: now() - 71 * 60 },
    { id: 24, creator: 'brakk.testnet', stake: y(1), level_cap: 25, invite: 'vex.testnet', squad: [67, 177, 178], created: now() - 132 * 60 },
  ]

  let nextMatch = 40
  const matches = new Map()

  // The tape, in the contract's own sentences (docs/CONTRACT.md, "The ticker").
  const ticker = [
    { ts: now() - 40, text: 'ironjaw.testnet won 0.97 NEAR from nightshade.testnet' },
    { ts: now() - 95, text: 'Coin-Eyed Vesh took 0.09 NEAR from pip.testnet' },
    { ts: now() - 150, text: 'nightshade.testnet called out rook.testnet for 0.25 NEAR' },
    { ts: now() - 210, text: "vex.testnet hired quill-and-fang.testnet's Gavel for 5 fights (0.6 NEAR)" },
    { ts: now() - 300, text: 'saltmother.testnet won 0.37 NEAR from Old Grist' },
    { ts: now() - 380, text: 'brakk.testnet bought a rare Ashwyrm for 1.34 NEAR' },
    { ts: now() - 470, text: 'The Auditor has closed its doors' },
    { ts: now() - 560, text: 'pip.testnet is looking for a friendly duel' },
    { ts: now() - 700, text: 'ironjaw.testnet is looking for a fight for 0.5 NEAR' },
    { ts: now() - 820, text: 'mordecai-the-patient.testnet won 0.33 NEAR from Mother Thorne' },
    { ts: now() - 960, text: 'oleander.testnet beat tallow.testnet in a friendly duel' },
    { ts: now() - 1100, text: 'Madam Ruin took 0.18 NEAR from hobbe.testnet' },
    { ts: now() - 1300, text: "tallow.testnet hired pip.testnet's Whistle for 2 fights (0.01 NEAR)" },
    { ts: now() - 1500, text: 'Coin-Eyed Vesh is open for stakes again' },
  ]
  function tick(text) {
    ticker.unshift({ ts: now(), text })
    if (ticker.length > 30) ticker.length = 30
  }

  const leaderboard = [
    { account_id: 'quill-and-fang.testnet', rating: 1312, wins: 41, losses: 12, won: y(18.42) },
    { account_id: 'nightshade.testnet', rating: 1267, wins: 35, losses: 13, won: y(11.07) },
    { account_id: 'ironjaw.testnet', rating: 1221, wins: 44, losses: 22, won: y(9.8) },
    { account_id: 'brakk.testnet', rating: 1164, wins: 29, losses: 19, won: y(6.31) },
    { account_id: 'saltmother.testnet', rating: 1118, wins: 22, losses: 15, won: y(4.02) },
    { account_id: ME, rating: 1084, wins: 7, losses: 4, won: y(2.15) },
    { account_id: 'vex.testnet', rating: 1071, wins: 19, losses: 17, won: y(1.9) },
    { account_id: 'mordecai-the-patient.testnet', rating: 1040, wins: 33, losses: 30, won: y(1.12) },
    { account_id: 'oleander.testnet', rating: 992, wins: 8, losses: 9, won: y(0.2) },
    { account_id: 'pip.testnet', rating: 951, wins: 5, losses: 11, won: 0n },
  ]

  const stats = { players: 37, beasts: 151, den_fights: 412, duels: 58, volume: y(184.6), treasury: y(31.2) }

  let nextPost = 900
  const post = (author, minutesAgo, text) => ({ author, id: `p${nextPost++}`, text, ts: now() - minutesAgo * 60, name: PEOPLE[author]?.name || '' })
  const social = {
    enabled: socialEnabled,
    following: ['ironjaw.testnet', 'nightshade.testnet', 'pip.testnet'],
    followers: ['nightshade.testnet', 'tallow.testnet'],
    feed: [
      post('nightshade.testnet', 2, '@rook.testnet 0.25 on the table, level cap 12. Your Cinder against my Hex. Come and get it. #maulstreet'),
      post('ironjaw.testnet', 9, 'Anvil is 44 and 17. Half a NEAR says nobody on this street beats him tonight. #maulstreet'),
      post('quill-and-fang.testnet', 21, 'Gavel hit level 50 and came back a Skybreaker. Hire him for 0.12 a fight and see for yourself. #maulstreet'),
      post('saltmother.testnet', 34, 'Took 0.37 off Old Grist. Guard, wait, punish. He never learns. #maulstreet'),
      post('pip.testnet', 47, 'Friendly up, cap 5. No stake, no shame. First one in meets my Whistle. #maulstreet'),
      post('brakk.testnet', 88, 'Skarn is a Cragmaul now. Level 26. Hire him for 0.03 a fight before I notice what he is worth. #maulstreet'),
      post('tallow.testnet', 131, 'First night on the Street with three cubs: Cinderpup, Sproutling, Zapling. Be gentle. #maulstreet'),
      post('vex.testnet', 205, 'The Auditor is closed again. 0.19 NEAR reopens it and you own the door. #maulstreet'),
    ],
    mentions: [],
  }
  social.mentions = social.feed.filter((p) => p.text.includes(`@${ME}`))

  const cooled = (entry) => Math.max(0, entry.heat - Math.floor((now() - entry.last_buy) / 600))

  // ----- Views (what the contract would return) ----------------------------

  function beastView(b) {
    const { stats: values, power } = core.stats({ species: b.species, level: b.level, relic: b.relic })
    return {
      id: b.id,
      species: b.species,
      name: nameOf(b),
      owner: b.owner,
      level: b.level,
      xp: b.xp,
      xp_next: xpForLevel(b.level),
      form: core.form(b.level),
      form_name: formName(b),
      relic: b.relic,
      aura: b.aura,
      finisher: b.finisher,
      stats: values,
      power,
      kills: b.kills,
      fights: b.fights,
      wins: b.wins,
      hire_price: b.hire_price == null ? null : b.hire_price.toString(),
      earned: b.earned.toString(),
    }
  }

  function denView(d) {
    const t = tables.dens[d.id]
    const wins = d.memory.filter(Boolean).length
    const fights = d.memory.length
    const training_levels = trainingLevels(d.training_spent)
    const rule = core.den(t.name, d.bankroll.toString(), wins, fights, training_levels, t.tier)
    return {
      id: d.id,
      name: t.name,
      title: t.title,
      style: t.style,
      tier: t.tier,
      squad: [...t.squad],
      bankroll: d.bankroll.toString(),
      shares: d.shares.toString(),
      open: rule.open,
      max_stake: rule.max_stake,
      payout_bps: rule.payout_bps,
      wins,
      fights,
      total_wins: d.total_wins,
      total_losses: d.total_losses,
      training_spent: d.training_spent.toString(),
      training_levels,
      level_bonus: rule.level_bonus,
      spar_level: rule.spar_level,
      reason: rule.reason,
    }
  }

  function playerView() {
    if (!session) return null
    if (!me.registered) {
      return {
        account_id: ME, registered: false, balance: '0', essence: 0, rating: 1000,
        wins: 0, losses: 0, den_wins: 0, den_losses: 0, won: '0', hire_income: '0',
        beasts: [], items: [], hires: [], den_match: null, duel: null, challenge: null, backing: [],
      }
    }
    return {
      account_id: ME,
      registered: true,
      balance: me.balance.toString(),
      essence: me.essence,
      rating: me.rating,
      wins: me.wins,
      losses: me.losses,
      den_wins: me.den_wins,
      den_losses: me.den_losses,
      won: me.won.toString(),
      hire_income: me.hire_income.toString(),
      beasts: me.beasts.map((id) => beastView(beasts.get(id))),
      items: Array.from(me.items.entries()).filter(([, count]) => count > 0).sort((a, b) => a[0] - b[0]),
      hires: me.hires.filter((hire) => hire.fights_left > 0).map((hire) => ({ beast: beastView(beasts.get(hire.id)), fights_left: hire.fights_left })),
      // These two keep pointing at the last fight after it has ended, as the contract's do.
      den_match: me.den_match,
      duel: me.duel,
      challenge: me.challenge,
      // Only the dens the player holds shares in.
      backing: dens
        .filter((d) => (me.backing.get(d.id) || 0n) > 0n)
        .map((d) => {
          const shares = me.backing.get(d.id)
          return { den: d.id, shares: shares.toString(), value: (d.shares > 0n ? (shares * d.bankroll) / d.shares : 0n).toString() }
        }),
    }
  }

  function marketView() {
    const row = (entry, floor) => {
      const heat = cooled(entry)
      const priced = core.price(floor, heat)
      return { id: entry.id, price: priced.price, floor, heat, sold: entry.sold, reason: priced.reason }
    }
    return {
      items: market.items.map((entry) => row(entry, itemDef(entry.id).price)),
      species: market.species.map((entry) => row(entry, species(entry.id).price)),
    }
  }

  const challengeView = (c) => ({
    id: c.id,
    creator: c.creator,
    stake: c.stake.toString(),
    level_cap: c.level_cap,
    invite: c.invite,
    // Power as it would fight, under the level cap.
    squad: c.squad.map((id) => {
      const b = beasts.get(id)
      return { token: id, species: b.species, level: b.level, power: core.stats({ species: b.species, level: b.level, relic: b.relic }, c.level_cap).power }
    }),
    created: c.created,
  })

  const matchView = (m) => (m ? JSON.parse(JSON.stringify(m)) : null)

  const views = {
    session: () => session,
    player: playerView,
    walletBalance: () => (session ? wallet.toString() : null),
    dens: () => dens.map(denView),
    market: marketView,
    hireMarket: () => Array.from(beasts.values()).filter((b) => b.hire_price != null).sort((a, b) => b.fights - a.fights).map(beastView),
    challenges: () => challenges.slice().sort((a, b) => b.created - a.created).map(challengeView),
    ticker: () => ticker.map((line) => ({ ...line })),
    leaderboard: () => leaderboard.slice().sort((a, b) => b.rating - a.rating).map((row) => ({ ...row, won: row.won.toString() })),
    stats: () => ({ ...stats, volume: stats.volume.toString(), treasury: stats.treasury.toString() }),
    social: () => ({
      enabled: social.enabled,
      profile: session ? { accountId: ME, name: PEOPLE[ME].name, about: PEOPLE[ME].about } : null,
      following: session ? [...social.following] : [],
      followers: session ? [...social.followers] : [],
      feed: social.feed.map((p) => ({ ...p, name: PEOPLE[p.author]?.name || '' })),
      mentions: session ? social.mentions.map((p) => ({ ...p })) : [],
    }),
  }

  const api = {
    tables,
    state: {
      session: null, player: null, walletBalance: null, dens: [], market: null, hireMarket: [],
      challenges: [], ticker: [], leaderboard: [], stats: null,
      social: { enabled: false, profile: null, following: [], followers: [], feed: [], mentions: [] },
      pending: {},
    },
    setTables(next) {
      api.tables = next
    },
    on(type, fn) {
      if (typeof fn !== 'function' || !listeners[type]) return () => {}
      listeners[type].add(fn)
      return () => listeners[type].delete(fn)
    },
  }

  const snapshot = {}
  let ownDeposits = 0n
  /**
   * Republishes every part of the state that changed. `force` also replaces unchanged
   * parts, as a careless poll would. Like the real api, it raises a 'near' toast when the
   * pit balance has gone up by more than the player's own deposits.
   */
  function publish(force = false) {
    const before = api.state.player
    for (const key in views) {
      const value = views[key]()
      const text = JSON.stringify(value)
      if (!force && snapshot[key] === text) continue
      snapshot[key] = text
      api.state = { ...api.state, [key]: value }
      emit('change', key)
    }
    const after = api.state.player
    if (before && before.registered && after && after.registered) {
      const rise = BigInt(after.balance) - BigInt(before.balance)
      if (rise > 0n) {
        const own = rise < ownDeposits ? rise : ownDeposits
        ownDeposits -= own
        if (rise > own) emit('toast', { kind: 'near', text: `+${fmtNear(rise - own)} NEAR` })
      }
    }
  }

  function setPending(name, on) {
    const pending = { ...api.state.pending }
    if (on) pending[name] = true
    else delete pending[name]
    api.state = { ...api.state, pending }
    emit('change', 'pending')
  }

  let failNext = null
  /** Wraps a change to the world as an api action: a pending flag, a wait, and on failure an error toast and a throw. */
  function action(name, fn, { wait = 1, canFlake = true, silent = false } = {}) {
    return async (...args) => {
      setPending(name, true)
      try {
        await sleep(delay * wait)
        if (!session) throw new Error('Connect your wallet first.')
        if (failNext) {
          const message = failNext
          failNext = null
          throw new Error(message)
        }
        if (canFlake && flaky > 0 && rng() < flaky) throw new Error('The network dropped that transaction. Nothing was spent. Try again.')
        return fn(...args)
      } catch (error) {
        if (!silent) emit('toast', { kind: 'error', text: error.message })
        throw error
      } finally {
        setPending(name, false)
        publish()
      }
    }
  }

  // ----- Helpers the actions share -------------------------------------------

  const say = (yocto, digits = 2) => `${fmtNear(yocto, digits)} NEAR`
  /** NEAR as the ticker writes it: up to two decimals. */
  const shortNear = (yocto) => `${fmtNear(yocto, 2).replace(/\.?0+$/, '') || '0'} NEAR`

  function need(condition, sentence) {
    if (!condition) throw new Error(sentence)
  }
  function registeredOnly() {
    need(me.registered, 'Register first: choose your three beasts.')
  }
  function spend(amount, what) {
    need(me.balance >= amount, `Your pit balance is ${say(me.balance)}. ${what} costs ${say(amount, 3)}.`)
    me.balance -= amount
  }
  function ownBeast(id) {
    const beast = beasts.get(Number(id))
    need(beast && beast.owner === ME, 'That beast is not yours.')
    return beast
  }
  /** Checks a squad of three and returns the beasts. `spendHire` uses up one hired fight each. */
  function squadOf(ids, spendHire) {
    need(Array.isArray(ids) && ids.length === 3 && new Set(ids).size === 3, 'A squad is three different beasts.')
    const squad = ids.map((id) => {
      const beast = beasts.get(Number(id))
      need(beast, 'One of those beasts does not exist.')
      if (beast.owner === ME) return beast
      const hire = me.hires.find((entry) => entry.id === beast.id && entry.fights_left > 0)
      need(hire, `${nameOf(beast)} is not yours and you have no hired fights left with it.`)
      return beast
    })
    if (spendHire) {
      for (const beast of squad) {
        const hire = me.hires.find((entry) => entry.id === beast.id)
        if (hire && beast.owner !== ME) hire.fights_left -= 1
      }
    }
    return squad
  }

  /**
   * Writes a finished fight into the record of the three beasts on `side`: a fight, their
   * knockouts, a win, and the XP each earned. Returns [xp earned by slot, level after by slot].
   */
  function recordFight(match, side, won, fightXp) {
    const earned = [0, 0, 0]
    const levels = [0, 0, 0]
    match.battle.teams[side].forEach((fighter, slot) => {
      const beast = beasts.get(fighter.token)
      if (!beast) {
        levels[slot] = fighter.level || 0
        return
      }
      beast.fights += 1
      beast.kills += fighter.kills
      if (won) beast.wins += 1
      earned[slot] = beastXp(fightXp, !!fighter.entered, fighter.kills)
      const grown = core.addXp(beast.level, beast.xp, earned[slot])
      beast.level = grown.level
      beast.xp = grown.xp
      levels[slot] = beast.level
    })
    return [earned, levels]
  }

  function finishDen(match, playerWon) {
    const den = dens[match.den]
    const table = tables.dens[match.den]
    const stake = BigInt(match.stake)
    const wasOpen = denView(den).open
    match.over = true
    match.winner = playerWon ? 0 : 1
    match.need = [false, false]
    const essence = denEssence(table.tier, playerWon)
    match.essence = [essence, 0]
    me.essence += essence
    const [earned, levels] = recordFight(match, 0, playerWon, denXp(table.tier, playerWon, stake > 0n))
    match.xp = [earned, [0, 0, 0]]
    match.levels = [levels, match.battle.teams[1].map((fighter) => fighter.level || 0)]
    stats.den_fights += 1
    if (playerWon) {
      me.den_wins += 1
      den.total_losses += 1
      if (stake > 0n) {
        let profit = (stake * BigInt(match.payout_bps)) / 10000n - stake
        if (profit > den.bankroll) profit = den.bankroll
        den.bankroll -= profit
        me.balance += stake + profit
        me.won += stake + profit
        match.payout = (stake + profit).toString()
        den.memory.push(0)
        stats.volume += stake
        tick(`${ME} won ${shortNear(stake + profit)} from ${table.name}`)
      }
    } else {
      me.den_losses += 1
      den.total_wins += 1
      if (stake > 0n) {
        const training = (stake * 1000n) / 10000n
        den.training_spent += training
        den.bankroll += stake - training
        // After a den's win, `payout` is the part of the stake that joined its bankroll.
        match.payout = (stake - training).toString()
        den.memory.push(1)
        stats.volume += stake
        tick(`${table.name} took ${shortNear(stake)} from ${ME}`)
      }
    }
    if (den.memory.length > 10) den.memory.splice(0, den.memory.length - 10)
    const isOpen = denView(den).open
    if (wasOpen && !isOpen) tick(`${table.name} has closed its doors`)
    if (!wasOpen && isOpen) tick(`${table.name} is open for stakes again`)
    // me.den_match keeps pointing at this fight until the next one starts.
  }

  function finishDuel(match, winnerSide, voided = false) {
    const mySide = match.players.indexOf(ME)
    const stake = BigInt(match.stake)
    const rival = match.players[1 - mySide]
    match.over = true
    match.need = [false, false]
    // me.duel keeps pointing at this duel until the next one starts.
    if (voided) {
      match.void = true
      match.winner = null
      match.last_events = []
      me.balance += stake
      tick(`The duel between ${match.players[0]} and ${match.players[1]} was called off`)
      return
    }
    match.winner = winnerSide
    const won = winnerSide === mySide
    const pot = stake * 2n
    const payout = pot - (pot * 300n) / 10000n
    match.payout = payout.toString()
    match.essence = [duelEssence(winnerSide === 0), duelEssence(winnerSide === 1)]
    me.essence += match.essence[mySide]
    const xp = [[0, 0, 0], [0, 0, 0]]
    const levels = [[0, 0, 0], [0, 0, 0]]
    for (const side of [0, 1]) [xp[side], levels[side]] = recordFight(match, side, winnerSide === side, duelXp(winnerSide === side))
    match.xp = xp
    match.levels = levels
    stats.duels += 1
    stats.volume += pot
    const row = leaderboard.find((entry) => entry.account_id === ME)
    if (won) {
      me.wins += 1
      me.rating += 12
      me.balance += payout
      me.won += payout
      tick(stake > 0n ? `${ME} won ${shortNear(payout)} from ${rival}` : `${ME} beat ${rival} in a friendly duel`)
    } else {
      me.losses += 1
      me.rating = Math.max(100, me.rating - 12)
      tick(stake > 0n ? `${rival} won ${shortNear(payout)} from ${ME}` : `${rival} beat ${ME} in a friendly duel`)
    }
    if (row) Object.assign(row, { rating: me.rating, wins: me.wins, losses: me.losses, won: me.won })
  }

  /** Plays one step of a match. `mine` is the player's action, or null when only the other side acts. */
  function stepMatch(match, mine) {
    const mySide = match.players.indexOf(ME)
    const other = 1 - mySide
    const style = match.kind === 'den' ? tables.dens[match.den].style : 4
    const acts = [null, null]
    if (match.need[mySide]) acts[mySide] = mine
    if (match.need[other]) acts[other] = core.npcAction(match.battle, other, style, `npc-${match.id}-${match.battle.turn}-${rng()}`).act
    const played = core.battleStep(match.battle, acts, `seed-${match.id}-${match.battle.turn}-${rng()}`)
    match.battle = played.battle
    match.need = played.need
    match.last_events.push(...played.events)
    // The last four played steps, oldest first.
    match.steps.push({ turn: played.battle.turn, events: played.events })
    if (match.steps.length > 4) match.steps.splice(0, match.steps.length - 4)
  }

  function advance(match, mine) {
    const mySide = match.players.indexOf(ME)
    match.last_events = []
    stepMatch(match, mine)
    // Keep going while only the other side has to act.
    while (match.battle.winner === NONE && !match.need[mySide]) stepMatch(match, null)
    if (match.kind === 'duel') match.deadline = now() + Number(tables.rules.move_clock_secs)
    if (match.battle.winner !== NONE) {
      if (match.kind === 'den') finishDen(match, match.battle.winner === mySide)
      else finishDuel(match, match.battle.winner)
    }
  }

  function newMatch(kind, players, teamA, teamB, extra) {
    const cap = extra.level_cap || 0
    const { battle, need: needs } = core.battleNew(teamA, teamB, cap)
    const match = {
      id: nextMatch++, kind, players, den: null, stake: '0', level_cap: cap, payout_bps: 0,
      battle, need: needs, sealed: [false, false], open: [false, false], deadline: 0,
      steps: [], last_events: [], over: false, winner: null, void: false, payout: '0', essence: [0, 0],
      xp: [[0, 0, 0], [0, 0, 0]], levels: [[0, 0, 0], [0, 0, 0]],
      ...extra,
    }
    matches.set(match.id, match)
    return match
  }

  const pushDuel = (match) => {
    const view = matchView(match)
    queueMicrotask(() => emit('duel', view))
    return view
  }

  // ----- Lifecycle ---------------------------------------------------------

  api.init = async () => {
    publish()
  }

  api.connect = async (onProgress = () => {}) => {
    setPending('connect', true)
    try {
      onProgress('Opening the wallet chooser…')
      await sleep(delay * 1.2)
      if (failNext) {
        const message = failNext
        failNext = null
        throw new Error(message)
      }
      onProgress('Waiting for your approval in the wallet…')
      await sleep(delay * 1.6)
      onProgress('Loading your stable…')
      await sleep(delay * 1.2)
      session = { accountId: ME }
      return session
    } finally {
      setPending('connect', false)
      publish()
    }
  }

  api.disconnect = async () => {
    await sleep(120)
    session = null
    publish()
  }

  api.refresh = async () => {
    await sleep(Math.min(delay, 150))
    publish()
  }

  // ----- Money, beasts, the bazaar, hiring -----------------------------------

  api.register = action('register', (picks) => {
    need(!me.registered, 'This account has already registered.')
    need(Array.isArray(picks) && picks.length === 3 && new Set(picks).size === 3 && picks.every((p) => p >= 0 && p <= 4), 'Choose three different common beasts.')
    me.registered = true
    me.essence = Number(tables.rules.starting_essence)
    me.beasts = picks.map((id) => addBeast({ species: id, owner: ME }).id)
    stats.players += 1
    stats.beasts += 3
    return playerView()
  })

  api.deposit = action(
    'deposit',
    (yocto) => {
      registeredOnly()
      const amount = BigInt(yocto)
      need(amount > 0n, 'Enter an amount of NEAR to deposit.')
      need(amount <= wallet, `Your wallet holds ${say(wallet)}.`)
      wallet -= amount
      me.balance += amount
      ownDeposits += amount
      return me.balance.toString()
    },
    { wait: 2.5, canFlake: false },
  )

  api.withdraw = action('withdraw', (yocto) => {
    registeredOnly()
    const amount = BigInt(yocto)
    need(amount > 0n, 'Enter an amount to withdraw.')
    need(amount <= me.balance, `Your pit balance is ${say(me.balance)}.`)
    me.balance -= amount
    wallet += amount
    return me.balance.toString()
  })

  /** level_up: NEAR buys the level and the beast keeps its XP. Essence stands in for the XP it still lacks, one for one. */
  api.levelUp = action('levelUp', (beastId, withEssence) => {
    const beast = ownBeast(beastId)
    const { level, xp } = beast
    if (withEssence) {
      const missing = Math.max(0, xpForLevel(level) - xp)
      need(me.essence >= missing, `You don't have enough Essence. This level takes ${missing}.`)
      me.essence -= missing
    } else {
      const cost = levelCostNear(level)
      spend(cost, `Level ${level + 1}`)
      stats.volume += cost
    }
    beast.level = level + 1
    beast.xp = withEssence ? 0 : Math.min(xp, xpForLevel(level + 1) - 1)
    return beastView(beast)
  })

  api.renameBeast = action('renameBeast', (beastId, name) => {
    const beast = ownBeast(beastId)
    need(/^[\x20-\x7e]{1,24}$/.test(String(name)), 'A name is 1 to 24 plain letters, digits, spaces or symbols.')
    beast.custom = String(name)
    return beastView(beast)
  })

  api.buyItem = action('buyItem', (itemId, maxPrice) => {
    registeredOnly()
    const entry = market.items.find((row) => row.id === Number(itemId))
    need(entry, 'The bazaar does not sell that.')
    const heat = cooled(entry)
    const price = BigInt(core.price(itemDef(entry.id).price, heat).price)
    need(price <= BigInt(maxPrice), `The price moved to ${say(price, 3)}, above your limit of ${say(maxPrice, 3)}.`)
    spend(price, itemDef(entry.id).name)
    me.items.set(entry.id, (me.items.get(entry.id) || 0) + 1)
    entry.heat = Math.min(100, heat + 1)
    entry.last_buy = now()
    entry.sold += 1
    stats.volume += price
    return price.toString()
  })

  api.buyBeast = action('buyBeast', (speciesId, maxPrice) => {
    registeredOnly()
    const entry = market.species.find((row) => row.id === Number(speciesId))
    need(entry, 'The bazaar does not sell that beast.')
    const heat = cooled(entry)
    const price = BigInt(core.price(species(entry.id).price, heat).price)
    need(price <= BigInt(maxPrice), `The price moved to ${say(price, 3)}, above your limit of ${say(maxPrice, 3)}.`)
    spend(price, `A ${species(entry.id).forms[0]}`)
    const beast = addBeast({ species: entry.id, owner: ME })
    me.beasts.push(beast.id)
    entry.heat = Math.min(100, heat + 1)
    entry.last_buy = now()
    entry.sold += 1
    stats.beasts += 1
    stats.volume += price
    if (species(entry.id).rare) tick(`${ME} bought a rare ${species(entry.id).name} for ${shortNear(price)}`)
    return beastView(beast)
  })

  const SLOT = ['relic', 'aura', 'finisher']

  api.equip = action('equip', (beastId, itemId) => {
    const beast = ownBeast(beastId)
    const def = itemDef(Number(itemId))
    need(def && (me.items.get(def.id) || 0) > 0, 'You do not have that item.')
    const slot = SLOT[def.kind]
    if (beast[slot]) me.items.set(beast[slot], (me.items.get(beast[slot]) || 0) + 1)
    me.items.set(def.id, me.items.get(def.id) - 1)
    beast[slot] = def.id
    return beastView(beast)
  })

  api.unequip = action('unequip', (beastId, kind) => {
    const beast = ownBeast(beastId)
    const slot = SLOT[kind]
    need(slot && beast[slot], 'That slot is already empty.')
    me.items.set(beast[slot], (me.items.get(beast[slot]) || 0) + 1)
    beast[slot] = 0
    return beastView(beast)
  })

  api.listForHire = action('listForHire', (beastId, price) => {
    const beast = ownBeast(beastId)
    const amount = BigInt(price)
    need(amount >= MILLI, 'The lowest hire price is 0.001 NEAR a fight.')
    beast.hire_price = amount
  })

  api.unlist = action('unlist', (beastId) => {
    const beast = ownBeast(beastId)
    need(beast.hire_price != null, 'That beast is not listed.')
    beast.hire_price = null
  })

  api.hire = action('hire', (beastId, fights) => {
    registeredOnly()
    const beast = beasts.get(Number(beastId))
    need(beast && beast.hire_price != null, 'That beast is no longer for hire.')
    need(beast.owner !== ME, 'You cannot hire your own beast.')
    const most = Number(tables.rules.max_hire_fights)
    const count = Number(fights)
    need(Number.isInteger(count) && count >= 1 && count <= most, `Hire for 1 to ${most} fights.`)
    const existing = me.hires.find((entry) => entry.id === beast.id)
    need((existing ? existing.fights_left : 0) + count <= most, `You can hold at most ${most} fights with one beast.`)
    const total = beast.hire_price * BigInt(count)
    spend(total, `Hiring ${nameOf(beast)}`)
    beast.earned += total - (total * 500n) / 10000n
    if (existing) existing.fights_left += count
    else me.hires.push({ id: beast.id, fights_left: count })
    stats.volume += total
    tick(`${ME} hired ${beast.owner}'s ${nameOf(beast)} for ${count} fight${count === 1 ? '' : 's'} (${shortNear(total)})`)
    return playerView()
  })

  // ----- Dens ----------------------------------------------------------------

  api.backDen = action('backDen', (denId, yocto) => {
    registeredOnly()
    const den = dens[Number(denId)]
    need(den, 'There is no such den.')
    const amount = BigInt(yocto)
    need(amount > 0n, 'Enter an amount to put behind the den.')
    const wasOpen = denView(den).open
    spend(amount, 'Backing the den')
    const minted = den.shares === 0n || den.bankroll === 0n ? amount : (amount * den.shares) / den.bankroll
    den.bankroll += amount
    den.shares += minted
    me.backing.set(den.id, (me.backing.get(den.id) || 0n) + minted)
    if (!wasOpen && denView(den).open) tick(`${tables.dens[den.id].name} is open for stakes again`)
    return minted.toString()
  })

  api.unbackDen = action('unbackDen', (denId, shares) => {
    registeredOnly()
    const den = dens[Number(denId)]
    need(den, 'There is no such den.')
    const burn = BigInt(shares)
    const held = me.backing.get(den.id) || 0n
    need(burn > 0n && burn <= held, 'You do not hold that many shares.')
    const wasOpen = denView(den).open
    const amount = (burn * den.bankroll) / den.shares
    den.bankroll -= amount
    den.shares -= burn
    me.backing.set(den.id, held - burn)
    me.balance += amount
    if (wasOpen && !denView(den).open) tick(`${tables.dens[den.id].name} has closed its doors`)
    return amount.toString()
  })

  api.startDenFight = action('startDenFight', (denId, squadIds, stakeYocto) => {
    registeredOnly()
    const last = matches.get(me.den_match)
    need(!last || last.over, 'Finish your den fight first.')
    const den = dens[Number(denId)]
    need(den, 'There is no such den.')
    const view = denView(den)
    const stake = BigInt(stakeYocto || '0')
    if (stake > 0n) {
      need(view.open, view.reason)
      need(stake % (10n * MILLI) === 0n, 'A stake is a whole number of hundredths of a NEAR.')
      need(stake <= BigInt(view.max_stake), `${view.name} takes at most ${say(view.max_stake)} on a fight.`)
    }
    const squad = squadOf(squadIds, false)
    if (stake > 0n) spend(stake, 'That stake')
    squadOf(squadIds, true)
    // Staked: the average level of the challenger's squad. Spar: the level of the den's tier. Training adds to either.
    const base = stake > 0n ? Math.floor(squad.reduce((sum, beast) => sum + beast.level, 0) / 3) : view.spar_level
    const level = base + view.level_bonus
    const house = view.squad.map((id) => ({ token: 0, species: id, level, relic: 0, aura: 0, finisher: 0 }))
    // The finished fight the record was pointing at is deleted when the next one starts.
    if (last) matches.delete(last.id)
    const match = newMatch('den', [ME, `den:${den.id}`], squad.map(buildOf), house, { den: den.id, stake: stake.toString(), payout_bps: view.payout_bps })
    me.den_match = match.id
    return matchView(match)
  })

  api.denAct = action(
    'denAct',
    (act) => {
      const match = matches.get(me.den_match)
      need(match && !match.over, 'You have no den fight in progress.')
      advance(match, Number(act))
      return matchView(match)
    },
    { canFlake: false },
  )

  api.forfeitDen = action(
    'forfeitDen',
    () => {
      const match = matches.get(me.den_match)
      need(match && !match.over, 'You have no den fight in progress.')
      match.battle.winner = 1
      match.last_events = [{ e: 'over', winner: 1 }]
      finishDen(match, false)
      return matchView(match)
    },
    { canFlake: false },
  )

  // ----- Duels -------------------------------------------------------------

  api.createChallenge = action('createChallenge', (squadIds, stakeYocto, levelCap, invite) => {
    registeredOnly()
    need(me.challenge == null, 'You already have a challenge up. Cancel it first.')
    const stake = BigInt(stakeYocto || '0')
    need(stake === 0n || stake >= BigInt(tables.rules.min_duel_stake), 'A stake is at least 0.01 NEAR, or nothing for a friendly.')
    const squad = squadOf(squadIds, false)
    if (stake > 0n) spend(stake, 'That stake')
    const challenge = { id: nextChallenge++, creator: ME, stake, level_cap: Number(levelCap) || 0, invite: invite || null, squad: squad.map((b) => b.id), created: now() }
    challenges.push(challenge)
    me.challenge = challenge.id
    tick(invite ? `${ME} called out ${invite} for ${shortNear(stake)}` : stake > 0n ? `${ME} is looking for a fight for ${shortNear(stake)}` : `${ME} is looking for a friendly duel`)
    return challengeView(challenge)
  })

  api.cancelChallenge = action('cancelChallenge', () => {
    const index = challenges.findIndex((c) => c.id === me.challenge)
    need(index >= 0, 'You have no challenge up.')
    me.balance += challenges[index].stake
    ownDeposits += challenges[index].stake // a stake coming home is not money arriving
    challenges.splice(index, 1)
    me.challenge = null
  })

  const inDuel = () => {
    const match = matches.get(me.duel)
    return !!match && !match.over
  }

  api.acceptChallenge = action('acceptChallenge', (challengeId, squadIds) => {
    registeredOnly()
    need(!inDuel(), 'Finish the duel you are in first.')
    const index = challenges.findIndex((c) => c.id === Number(challengeId))
    need(index >= 0, 'That challenge is gone. Someone else took it, or it was cancelled.')
    const challenge = challenges[index]
    need(challenge.creator !== ME, 'That is your own challenge.')
    need(!challenge.invite || challenge.invite === ME, `That challenge is for ${challenge.invite} only.`)
    const squad = squadOf(squadIds, false)
    if (challenge.stake > 0n) spend(challenge.stake, 'Matching that stake')
    squadOf(squadIds, true)
    challenges.splice(index, 1)
    const match = newMatch('duel', [challenge.creator, ME], challenge.squad.map((id) => buildOf(beasts.get(id))), squad.map(buildOf), {
      stake: challenge.stake.toString(),
      level_cap: challenge.level_cap,
      deadline: now() + 180,
    })
    me.duel = match.id
    return pushDuel(match)
  })

  api.duelMove = action(
    'duelMove',
    (act) => {
      const match = matches.get(me.duel)
      need(match && !match.over, 'You are not in a duel.')
      advance(match, Number(act))
      return pushDuel(match)
    },
    { canFlake: false },
  )

  api.forfeitDuel = action(
    'forfeitDuel',
    () => {
      const match = matches.get(me.duel)
      need(match && !match.over, 'You are not in a duel.')
      const winner = 1 - match.players.indexOf(ME)
      match.battle.winner = winner
      match.last_events = [{ e: 'over', winner }]
      finishDuel(match, winner)
      return pushDuel(match)
    },
    { canFlake: false },
  )

  api.claimTimeout = action(
    'claimTimeout',
    () => {
      const match = matches.get(me.duel)
      need(match && !match.over, 'You are not in a duel.')
      need(now() >= match.deadline, 'The clock has not run out yet.')
      if (match.battle.active.includes(NONE) && match.battle.turn === 0) {
        finishDuel(match, null, true)
      } else {
        const winner = match.players.indexOf(ME)
        match.battle.winner = winner
        match.last_events = [{ e: 'over', winner }]
        finishDuel(match, winner)
      }
      return pushDuel(match)
    },
    { canFlake: false },
  )

  api.getMatch = async (matchId) => {
    await sleep(Math.min(delay, 120))
    return matchView(matches.get(Number(matchId)))
  }

  api.watchDuel = (matchId, onMatch) => {
    if (typeof onMatch !== 'function') return () => {}
    let last = ''
    const timer = setInterval(() => {
      const match = matches.get(Number(matchId))
      if (!match) return
      const key = JSON.stringify([match.battle.turn, match.sealed, match.open, match.need, match.over, match.winner, match.void])
      if (key === last) return
      last = key
      onMatch(matchView(match))
    }, 1000)
    return () => clearInterval(timer)
  }

  // ----- NEAR Social -------------------------------------------------------

  const socialOnly = () => need(social.enabled, 'Turn on NEAR Social first.')
  const socialAction = (name, fn) => action(`social.${name}`, fn, { canFlake: false })

  api.social = {
    enable: action(
      'social.enable',
      () => {
        social.enabled = true
        return true
      },
      { wait: 2, canFlake: false },
    ),
    async profileOf(accountId) {
      await sleep(60 + Math.floor(rng() * 180))
      const person = PEOPLE[accountId] || { name: '', about: '' }
      return { accountId, name: person.name, about: person.about }
    },
    setProfile: socialAction('setProfile', ({ name, about } = {}) => {
      socialOnly()
      need(String(name || '').trim().length <= 40, 'A name is at most 40 characters.')
      PEOPLE[ME] = { name: String(name || '').trim(), about: String(about || '').trim() }
      return { accountId: ME, ...PEOPLE[ME] }
    }),
    follow: socialAction('follow', (accountId) => {
      socialOnly()
      need(accountId !== ME, 'You cannot follow yourself.')
      if (!social.following.includes(accountId)) social.following.push(accountId)
      return true
    }),
    unfollow: socialAction('unfollow', (accountId) => {
      socialOnly()
      social.following = social.following.filter((id) => id !== accountId)
      return true
    }),
    post: socialAction('post', (text) => {
      socialOnly()
      let body = String(text || '').trim()
      need(body.length > 0, 'Write something first.')
      need(body.length <= 500, 'Keep it under 500 characters.')
      if (!/#maulstreet\b/i.test(body)) body += ' #maulstreet'
      const entry = { author: ME, id: `p${nextPost++}`, text: body, ts: now(), name: PEOPLE[ME].name }
      social.feed.unshift(entry)
      return { id: entry.id }
    }),
    async refresh() {
      await sleep(Math.min(delay, 150))
      publish()
    },
    url() {
      return null
    },
  }

  // ----- Hooks for the dev page and the test scripts -----------------------

  api.dev = {
    me: ME,
    world: { beasts, dens, market, challenges, matches, me, social },
    publish,
    setFlaky(value) {
      flaky = value
    },
    setDelay(value) {
      delay = value
    },
    /** The next action fails with this sentence. */
    failNext(message = 'The network dropped that transaction. Nothing was spent. Try again.') {
      failNext = message
    },
    /** A careless poll: every part of the state is replaced, changed or not. */
    poll() {
      publish(true)
    },
    /** What the menus see before the contract has answered, or on a brand-new deployment: nothing. */
    blank() {
      const keys = ['dens', 'market', 'hireMarket', 'challenges', 'ticker', 'leaderboard', 'stats', 'social']
      api.state = {
        ...api.state,
        dens: [], market: null, hireMarket: [], challenges: [], ticker: [], leaderboard: [], stats: null,
        social: { ...api.state.social, following: [], followers: [], feed: [], mentions: [] },
      }
      keys.forEach((key) => emit('change', key))
    },
    /**
     * Plays a whole match at once, the way the 3D game will over a minute or two.
     * `force`: 'win' | 'lose' | 'void' to decide the result, otherwise the rules decide.
     */
    playOut(matchId, force) {
      const match = matches.get(Number(matchId))
      if (!match || match.over) return matchView(match)
      const mySide = match.players.indexOf(ME)
      if (force === 'void' && match.kind === 'duel') {
        finishDuel(match, null, true)
      } else {
        let guard = 0
        while (match.battle.winner === NONE && guard++ < 400) {
          const mine = match.need[mySide] ? core.npcAction(match.battle, mySide, 4, `me-${match.id}-${guard}-${rng()}`).act : null
          match.last_events = []
          stepMatch(match, mine)
        }
        const winner = force === 'win' ? mySide : force === 'lose' ? 1 - mySide : match.battle.winner === NONE ? 1 - mySide : match.battle.winner
        match.battle.winner = winner
        if (match.kind === 'den') finishDen(match, winner === mySide)
        else finishDuel(match, winner)
      }
      publish()
      const view = matchView(match)
      if (match.kind === 'duel') emit('duel', view)
      return view
    },
    /** Another trainer takes the player's open challenge. */
    rivalAccepts(rival = 'ironjaw.testnet') {
      const index = challenges.findIndex((c) => c.id === me.challenge)
      if (index < 0) return null
      const challenge = challenges[index]
      challenges.splice(index, 1)
      me.challenge = null
      const theirs = [88, 171, 172].map((id) => buildOf(beasts.get(id)))
      const match = newMatch('duel', [ME, rival], challenge.squad.map((id) => buildOf(beasts.get(id))), theirs, {
        stake: challenge.stake.toString(),
        level_cap: challenge.level_cap,
        deadline: now() + 180,
      })
      me.duel = match.id
      publish()
      const view = matchView(match)
      emit('duel', view)
      return view
    },
    /** A hirer pays for one of the player's beasts: NEAR arrives. */
    hireIncome(amount = 0.057, hirer = 'vex.testnet') {
      const beast = me.beasts.map((id) => beasts.get(id)).find((b) => b.hire_price != null) || beasts.get(me.beasts[0])
      if (!beast) return
      const paid = y(amount)
      beast.earned += paid
      me.balance += paid
      me.hire_income += paid
      tick(`${hirer} hired ${ME}'s ${nameOf(beast)} for 3 fights (${shortNear(paid)})`)
      publish()
    },
    /** Something happens on the Street that has nothing to do with the player. */
    stir() {
      const lines = [
        'saltmother.testnet won 0.33 NEAR from Mother Thorne',
        'Old Grist took 0.04 NEAR from tallow.testnet',
        'oleander.testnet is looking for a fight for 0.05 NEAR',
        "hobbe.testnet hired saltmother.testnet's Lull for 2 fights (0.05 NEAR)",
      ]
      tick(lines[Math.floor(rng() * lines.length)])
      const entry = market.items[Math.floor(rng() * market.items.length)]
      entry.heat = Math.min(100, cooled(entry) + 1)
      entry.last_buy = now()
      dens[0].bankroll += y(0.036)
      publish(true)
    },
  }

  if (simulate) setInterval(() => api.dev.stir(), 5000)

  // The page was reloaded in the middle of a duel: the player record points at an unfinished match.
  if (midDuel && registered) {
    const match = newMatch('duel', [ME, 'ironjaw.testnet'], me.beasts.slice(0, 3).map((id) => buildOf(beasts.get(id))), [88, 171, 172].map((id) => buildOf(beasts.get(id))), {
      stake: y(0.25).toString(),
      deadline: now() + 60,
    })
    me.duel = match.id
  }

  return api
}
