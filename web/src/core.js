// The rules of Maul Street, as the browser sees them.
//
// `maul_core.wasm` is the same Rust code the contract runs (crates/core), built
// for the browser by crates/browser. This file loads it and passes JSON in and
// out. Practice fights, stat previews and price explanations all come from here,
// so the page can never disagree with the chain about a number.

let wasm = null
let tables = null

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Loads the module. `source` is a URL in the browser, or the file's bytes in Node. */
export async function loadCore(source) {
  if (wasm) return tables
  let bytes = source
  if (typeof source === 'string' || source instanceof URL) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`The rules module did not load (${response.status}).`)
    bytes = await response.arrayBuffer()
  }
  const { instance } = await WebAssembly.instantiate(bytes, {})
  wasm = instance.exports
  tables = call('tables')
  return tables
}

/** One request to the rules module. Throws with the module's own plain-English reason. */
export function call(fn, args = {}) {
  if (!wasm) throw new Error('The rules module has not loaded yet.')
  const request = encoder.encode(JSON.stringify({ fn, ...args }))
  const input = wasm.ms_alloc(request.length)
  new Uint8Array(wasm.memory.buffer, input, request.length).set(request)
  const packed = wasm.ms_call(input, request.length)
  wasm.ms_free(input, request.length)
  const pointer = Number(packed >> 32n)
  const length = Number(packed & 0xffffffffn)
  const text = decoder.decode(new Uint8Array(wasm.memory.buffer, pointer, length))
  wasm.ms_free(pointer, length)
  const answer = JSON.parse(text)
  if (answer && answer.error) throw new Error(answer.error)
  return answer
}

export const core = {
  get tables() {
    return tables
  },
  /** { stats: [hp, atk, def, spd], power } for a build { species, level, relic, ... }. `cap` of 0 means no level cap. */
  stats: (build, cap = 0) => call('stats', { build: { token: 0, relic: 0, aura: 0, finisher: 0, ...build }, cap }),
  /** About a level: { level, near, xp, form, next_form_at }. `near` and `xp` are what the NEXT level costs. */
  level: (level) => call('level', { level }),
  /** Where `gained` XP takes a beast: { level, xp, form }. */
  addXp: (level, xp, gained) => call('add_xp', { level, xp, gained }),
  /** Which of the five forms (0..4) a level wears. */
  form: (level) => {
    const starts = tables.rules.form_levels
    let form = 0
    starts.forEach((start, i) => {
      if (level >= start) form = i
    })
    return form
  },
  /** What a beast of this species is called at this level. */
  formName: (species, level) => tables.species[species].forms[core.form(level)],
  /** { price, reason } for a floor price and a heat. */
  price: (floor, heat) => call('price', { floor, heat }),
  /** { open, max_stake, payout_bps, level_bonus, spar_level, reason } for a den. */
  den: (name, bankroll, wins, fights, training = 0, tier = 1) => call('den', { name, bankroll, wins, fights, training, tier }),
  /** A new fight between two squads of three builds. → { battle, need } */
  battleNew: (a, b, cap = 0) => call('battle_new', { a, b, cap }),
  /** Plays one step. acts: [actionOrNull, actionOrNull]. → { battle, events, need } */
  battleStep: (battle, acts, seed) => call('battle_step', { battle, acts, seed }),
  /** The house fighter's choice. → { act, weights } */
  npcAction: (battle, side, style, seed) => call('npc_action', { battle, side, style, seed }),
}
