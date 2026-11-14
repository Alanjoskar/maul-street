// The five forms a line grows through, and how one form's look sheet is made
// from the line's own sheet.
//
// A line's sheet describes the grown beast (the Alpha, form 2). Any value in it
// may instead be `byForm(cub, prowler, alpha, dread, mythic)`, and the whole
// sheet then reads as the form being built. On top of that every line follows
// the same growth: a cub has a big head, big eyes, a short muzzle, short
// chunky legs and soft light colours; a Dread is heavier, darker and scowls;
// a Mythic is the biggest, the brightest and wears gold.

import * as THREE from 'three'

export const FORM_LEVELS = [1, 5, 12, 25, 50]
export const FORM_NAMES = ['Cub', 'Prowler', 'Alpha', 'Dread', 'Mythic']

/** The form a level wears: 0 cub, 1 prowler, 2 alpha, 3 dread, 4 mythic. */
export function formOf(level) {
  let form = 0
  FORM_LEVELS.forEach((start, i) => {
    if (level >= start) form = i
  })
  return form
}

/** A value that differs by form. */
export class Forms extends Array {}
export function byForm(...values) {
  const out = new Forms()
  out.push(...values)
  return out
}

/** How every line grows, form by form. A sheet may override any row with `stage: { row: [...] }`. */
export const STAGE = {
  // The size of the whole beast.
  scale: [0.6, 0.8, 1, 1.14, 1.26],
  // Proportions, as multiples of the sheet's own numbers.
  head: [1.5, 1.18, 1, 0.98, 1.0],
  eye: [1.3, 1.1, 1, 0.92, 0.94],
  muzzle: [0.58, 0.82, 1, 1.04, 1.04],
  leg: [0.72, 0.9, 1, 1.0, 1.02],
  limb: [1.18, 1.0, 1, 1.08, 1.12],
  length: [0.8, 0.94, 1, 1.02, 1.04],
  girth: [1.06, 0.97, 1, 1.07, 1.1],
  neck: [0.62, 0.86, 1, 1.0, 1.04],
  tail: [0.6, 0.85, 1, 1.06, 1.12],
  paw: [1.22, 1.06, 1, 1.06, 1.08],
  arm: [0.8, 0.92, 1, 1.04, 1.06],
  // How strongly the accent glows.
  glow: [0.45, 0.7, 0.9, 1.12, 1.35],
  // A heavy brow over the eyes.
  brow: [0, 0.15, 0.4, 1, 0.6],
  // Colours: cubs are lighter and softer; Dreads a shade darker.
  soft: [0.18, 0.07, 0, 0, 0],
  dark: [0, 0, 0, 0.14, 0.04],
  // Gold trim on horns and claws.
  gild: [0, 0, 0, 0, 1],
  // Motion: cubs bounce, mythics are slow and heavy.
  bounce: [1, 0.55, 0.3, 0.18, 0.1],
  heavy: [0, 0.15, 0.35, 0.7, 1],
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof THREE.Color)

/** Copies a sheet, replacing every byForm value by the one for `form`. Functions are kept as they are. */
function resolve(value, form) {
  if (value instanceof Forms) return resolve(value[Math.min(form, value.length - 1)], form)
  if (Array.isArray(value)) return value.map((v) => resolve(v, form))
  if (isPlain(value)) {
    const out = {}
    for (const key in value) out[key] = resolve(value[key], form)
    return out
  }
  return value
}

/** Merges `extra` into `target`, depth first. */
function merge(target, extra) {
  for (const key in extra) {
    const v = extra[key]
    if (isPlain(v) && isPlain(target[key])) merge(target[key], v)
    else target[key] = v
  }
  return target
}

/**
 * The look sheet for one form of a line. The body plans read only what this returns.
 * Each sheet's numbers are its Alpha; here the cub, prowler, dread and mythic are grown from them.
 */
export function formSheet(base, form) {
  const S = resolve(base, form)
  if (base.forms && base.forms[form]) merge(S, resolve(base.forms[form], form))
  const stage = { ...STAGE, ...(base.stage || {}) }
  const k = (row) => stage[row][form]
  S.form = form
  S.scale = (S.scale ?? 1) * k('scale')
  S.head *= k('head')
  if (S.face) {
    S.face.eye.r *= k('eye')
    S.face.muzzle.len *= k('muzzle')
    S.face.brow = (S.face.brow ?? 0) + k('brow')
  }
  for (const row of ['leg', 'limb', 'length', 'girth', 'neck', 'tail', 'paw', 'arm']) {
    if (typeof S[row] === 'number') S[row] *= k(row)
  }
  S.glow = (S.glow ?? 1) * k('glow')
  S.gild = Math.max(S.gild ?? 0, k('gild'))
  S.life = { bounce: k('bounce'), heavy: k('heavy'), ...(S.life || {}) }
  // Colours.
  const soft = k('soft')
  const dark = k('dark')
  const white = new THREE.Color('#fff8ee')
  const tones = {}
  for (const name in S.tones) {
    const c = new THREE.Color(S.tones[name])
    if (soft && !['accent', 'hot', 'mouth', 'tongue', 'nose', 'lash'].includes(name)) {
      const hsl = {}
      c.getHSL(hsl)
      c.setHSL(hsl.h, hsl.s * (1 - soft * 0.35), hsl.l + (1 - hsl.l) * soft * 0.55)
      c.lerp(white, soft * 0.15)
    }
    if (dark && ['top', 'side', 'dark', 'horn'].includes(name)) c.multiplyScalar(1 - dark)
    tones[name] = c
  }
  S.tones = tones
  // Cubs and gentle lines have round pupils.
  if (form === 0 && S.face) S.face.eye.slit = 0
  return S
}
