// What the menus need to know about the game, read from `api.state`, the
// static tables and the rules module. Nothing here changes anything on chain.

export const SQUAD_KEY = 'maul-squad'

/** The four things a beast is measured by, in the order the rules module gives them. */
export const STATS = [
  { plain: 'Health', short: 'HP' },
  { plain: 'Attack', short: 'ATK' },
  { plain: 'Defence', short: 'DEF' },
  { plain: 'Speed', short: 'SPD' },
]

/** The lasting effect a Special leaves, by aspect (0 Ember .. 4 Tide). From the design: GAME_LOOP.md, "The fight". */
export const MARKS = ['Burn', 'Leech', 'Sunder', 'Shock', 'Soak']

export const KINDS = [
  { key: 'relic', label: 'Relic', plural: 'Relics', does: 'Changes how a beast fights', icon: 'fang' },
  { key: 'aura', label: 'Aura', plural: 'Auras', does: 'Changes how a beast looks', icon: 'spark' },
  { key: 'finisher', label: 'Finisher', plural: 'Finishers', does: 'Changes how a beast wins', icon: 'crown' },
]

/** A yoctoNEAR string (or anything else) as a BigInt. Never throws. */
export function B(value) {
  if (typeof value === 'bigint') return value
  try {
    return BigInt(String(value ?? '0').trim() || '0')
  } catch {
    return 0n
  }
}

const HUNDREDTH = 10n ** 22n

/** Whole hundredths of a NEAR in a yocto amount, rounded down. */
export const hundredths = (yocto) => Number(B(yocto) / HUNDREDTH)
export const fromHundredths = (count) => (BigInt(Math.max(0, Math.round(count))) * HUNDREDTH).toString()

function readSquad() {
  try {
    const raw = JSON.parse(localStorage.getItem(SQUAD_KEY) || 'null')
    if (Array.isArray(raw)) return [0, 1, 2].map((i) => (Number.isFinite(raw[i]) ? raw[i] : null))
  } catch {
    /* a private window, or something else wrote the key */
  }
  return [null, null, null]
}

export function attachDomain(app) {
  const { api, core } = app
  const ui = app.ui
  ui.squad = readSquad()

  app.tables = () => api.tables || (core && core.tables) || null
  app.player = () => api.state.player || null
  app.account = () => (api.state.session && api.state.session.accountId) || null
  app.registered = () => !!(app.player() && app.player().registered)

  app.species = (id) => {
    const tables = app.tables()
    return (tables && tables.species[id]) || { id, name: `Beast ${id}`, aspect: 0, hp: 1, atk: 1, def: 1, spd: 1, special: '', lore: '', rare: false, price: '0' }
  }
  app.aspectName = (index) => {
    const tables = app.tables()
    return (tables && tables.aspects[index]) || ''
  }
  app.item = (id) => {
    const tables = app.tables()
    return (tables && tables.items.find((item) => item.id === id)) || null
  }
  app.denTable = (id) => {
    const tables = app.tables()
    return (tables && tables.dens[id]) || {}
  }
  app.rule = (name, fallback) => {
    const tables = app.tables()
    const value = tables && tables.rules ? tables.rules[name] : undefined
    return value == null ? fallback : value
  }

  // ----- Beasts ----------------------------------------------------------

  app.owned = () => (app.player() && app.player().beasts) || []
  app.hires = () => ((app.player() && app.player().hires) || []).filter((hire) => hire && hire.beast && hire.fights_left > 0)
  /** Every beast the player can field: [{ beast, hired, fightsLeft }]. */
  app.roster = () => [
    ...app.owned().map((beast) => ({ beast, hired: false, fightsLeft: null })),
    ...app.hires().map((hire) => ({ beast: hire.beast, hired: true, fightsLeft: hire.fights_left })),
  ]
  app.entry = (id) => app.roster().find((entry) => entry.beast.id === id) || null
  /** A beast by id among everything the player record carries, whether or not any hired fights are left. */
  app.anyBeast = (id) => {
    const player = app.player()
    if (!player) return null
    const own = (player.beasts || []).find((beast) => beast.id === id)
    if (own) return { beast: own, hired: false }
    const hire = (player.hires || []).find((entry) => entry && entry.beast && entry.beast.id === id)
    return hire ? { beast: hire.beast, hired: true } : null
  }

  const levelOf = (beast) => Math.max(1, Number(beast && beast.level) || 1)
  app.levelOf = levelOf

  /** What the 3D stage needs to draw a beast: { species, level, aura, finisher, token }. */
  app.buildOf = (beast, changes = null) => ({
    species: beast.species,
    level: levelOf(beast),
    aura: beast.aura || 0,
    finisher: beast.finisher || 0,
    token: beast.id ?? beast.token ?? 0,
    ...(changes || {}),
  })
  app.speciesBuild = (speciesId, level = 1) => ({ species: speciesId, level, aura: 0, finisher: 0, token: 0 })

  const statCache = new Map()
  /** { stats: [hp, atk, def, spd], power } for a species at a level, from the rules module. `cap` of 0 is no level cap. */
  app.stats = (speciesId, level = 1, relic = 0, cap = 0) => {
    const key = `${speciesId}|${level}|${relic}|${cap}`
    let found = statCache.get(key)
    if (!found) {
      try {
        found = core.stats({ species: speciesId, level: Math.max(1, level), relic: relic || 0 }, cap)
      } catch {
        const s = app.species(speciesId)
        const values = [s.hp, s.atk, s.def, s.spd]
        found = { stats: values, power: Math.floor(values[0] / 5) + values[1] + values[2] + values[3] }
      }
      if (statCache.size > 800) statCache.clear()
      statCache.set(key, found)
    }
    return found
  }
  app.statsOf = (beast, cap = 0) => app.stats(beast.species, levelOf(beast), beast.relic || 0, cap)

  const levelCache = new Map()
  /** { level, near, xp, form, next_form_at }: what the NEXT level costs, and the form this one wears. Null when the rules are not loaded. */
  app.levelInfo = (level) => {
    const at = Math.max(1, Number(level) || 1)
    if (!levelCache.has(at)) {
      try {
        levelCache.set(at, core.level(at))
      } catch {
        return null
      }
    }
    return levelCache.get(at)
  }

  // ----- Forms: a beast changes body and name as it grows --------------------

  /** The levels at which the five forms begin: [1, 5, 12, 25, 50]. */
  app.formLevels = () => app.rule('form_levels', [1, 5, 12, 25, 50])
  /** What the five forms are called for every line: Cub, Prowler, Alpha, Dread, Mythic. */
  app.formLabels = () => app.rule('form_names', ['Cub', 'Prowler', 'Alpha', 'Dread', 'Mythic'])
  /** Which form (0..4) a level wears. */
  app.formAt = (level) => {
    let form = 0
    app.formLevels().forEach((start, i) => {
      if (level >= start) form = i
    })
    return form
  }
  /** The five names of a line, cub first: Cinderpup, Emberjaw, Cindermaw, Blazemaw, Solarmaw. */
  app.formNames = (speciesId) => {
    const species = app.species(speciesId)
    return Array.isArray(species.forms) && species.forms.length ? species.forms : [species.name, species.name, species.name, species.name, species.name]
  }
  /** What a beast of this line is called at this level. */
  app.formName = (speciesId, level) => app.formNames(speciesId)[app.formAt(level)] || app.species(speciesId).name
  /** The form a BeastView wears: { index, name, label }. Uses the contract's own fields when they are there. */
  app.formOf = (beast) => {
    const level = levelOf(beast)
    const index = Number.isInteger(beast.form) ? beast.form : app.formAt(level)
    return { index, name: beast.form_name || app.formName(beast.species, level), label: app.formLabels()[index] || '' }
  }

  /** The most any species has of each stat, for drawing stat bars to one scale. */
  app.statCeiling = () => {
    const tables = app.tables()
    const top = [1, 1, 1, 1]
    if (tables) {
      for (const s of tables.species) {
        top[0] = Math.max(top[0], s.hp)
        top[1] = Math.max(top[1], s.atk)
        top[2] = Math.max(top[2], s.def)
        top[3] = Math.max(top[3], s.spd)
      }
    }
    return top
  }

  // ----- Money -----------------------------------------------------------

  app.balance = () => B(app.player() && app.player().balance)
  app.essence = () => Number((app.player() && app.player().essence) || 0)

  /** A NEAR amount for people. With more than two digits, trailing zeros are dropped: "0.25", "0.011". */
  app.near = (yocto, digits = 2) => {
    let text = app.fmt.near(String(B(yocto)), digits)
    if (digits > 2 && /^-?\d+\.\d+$/.test(text)) {
      const [whole, fraction] = text.split('.')
      text = `${whole}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`
    }
    return text
  }

  app.itemsOwned = () => {
    const map = new Map()
    for (const pair of (app.player() && app.player().items) || []) map.set(pair[0], pair[1])
    return map
  }

  app.backing = (denId) => {
    const row = ((app.player() && app.player().backing) || []).find((entry) => entry.den === denId)
    return { shares: B(row && row.shares), value: B(row && row.value) }
  }

  // ----- The squad of three ----------------------------------------------

  function saveSquad() {
    try {
      localStorage.setItem(SQUAD_KEY, JSON.stringify(ui.squad))
    } catch {
      /* nothing to do */
    }
  }

  /** The three slots, checked against the beasts the player can field right now. */
  app.squad = () => {
    if (!app.registered()) return ui.squad
    const roster = app.roster()
    const fieldable = new Set(roster.map((entry) => entry.beast.id))
    const seen = new Set()
    let changed = false
    const next = ui.squad.map((id) => {
      if (id == null) return null
      if (!fieldable.has(id) || seen.has(id)) {
        changed = true
        return null
      }
      seen.add(id)
      return id
    })
    // A new trainer's first three walk straight into the squad.
    if (!ui.squadEdited && next.every((id) => id == null) && app.owned().length >= 3) {
      app.owned().slice(0, 3).forEach((beast, i) => {
        next[i] = beast.id
      })
      changed = true
    }
    if (changed) {
      ui.squad = next
      saveSquad()
    }
    return ui.squad
  }
  app.squadEntries = () => app.squad().map((id) => (id == null ? null : app.entry(id)))
  app.squadReady = () => app.squad().every((id) => id != null)
  app.squadIds = () => app.squad().slice()
  app.squadBuilds = () => app.squadEntries().filter(Boolean).map((entry) => app.buildOf(entry.beast))
  app.squadPower = (cap = 0) => app.squadEntries().reduce((sum, entry) => sum + (entry ? app.statsOf(entry.beast, cap).power : 0), 0)
  /** The average level of the squad, rounded down: what a den matches in a staked fight. */
  app.squadLevel = () => {
    const entries = app.squadEntries().filter(Boolean)
    return entries.length ? Math.floor(entries.reduce((sum, entry) => sum + levelOf(entry.beast), 0) / entries.length) : 1
  }
  app.setSquad = (next) => {
    ui.squad = next
    ui.squadEdited = true
    saveSquad()
    app.render()
  }
  /** Puts a beast in a slot. If it was in another slot, the two swap. */
  app.assignSlot = (slot, beastId) => {
    const next = app.squad().slice()
    const from = next.indexOf(beastId)
    if (from === slot) {
      next[slot] = null
    } else {
      if (from >= 0) next[from] = next[slot]
      next[slot] = beastId
    }
    app.setSquad(next)
  }
  app.quickSquad = (beastId) => {
    const next = app.squad().slice()
    const at = next.indexOf(beastId)
    if (at >= 0) {
      next[at] = null
      app.setSquad(next)
      return 'removed'
    }
    const free = next.indexOf(null)
    if (free < 0) return 'full'
    next[free] = beastId
    app.setSquad(next)
    return 'added'
  }

  // ----- People ----------------------------------------------------------

  ui.names = {}
  /** The NEAR Social name for an account, if it has one. Looks it up once, quietly. */
  app.nameOf = (accountId) => {
    if (!accountId) return ''
    const mine = api.state.social && api.state.social.profile
    if (mine && mine.accountId === accountId && mine.name) return mine.name
    if (accountId in ui.names) return ui.names[accountId]
    ui.names[accountId] = ''
    try {
      const lookup = api.social && api.social.profileOf ? api.social.profileOf(accountId) : null
      Promise.resolve(lookup)
        .then((profile) => {
          if (profile && profile.name) {
            ui.names = { ...ui.names, [accountId]: String(profile.name) }
            app.render()
          }
        })
        .catch(() => {})
    } catch {
      /* no profile, no name */
    }
    return ''
  }
  app.label = (accountId) => app.nameOf(accountId) || app.fmt.shortAccount(accountId)
  app.isHouse = (accountId) => typeof accountId === 'string' && accountId.startsWith('den:')
}
