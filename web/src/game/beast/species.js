// What each line looks like. The numbers that matter in a fight (health,
// attack and so on) live in crates/core; this file is only the body: its
// proportions, its colours and markings, its face, what grows out of it and
// how all of that changes over the five forms.
//
// Each sheet describes the grown beast (the Alpha). `byForm(cub, prowler,
// alpha, dread, mythic)` gives a value per form; forms.js grows the rest
// (big-headed cubs, heavier Dreads, gilded Mythics). Adding a line is one sheet.
//
// `marks(c)` paints a line's markings over the coat, one vertex at a time.
// `c.part` says which part is being painted; `c.p` is the rest position,
// `c.h` the place on the head [forward, up, out] in head lengths, `c.lift`
// +1 on the back and -1 on the belly, `c.u` along the part; `c.ink` is the
// colour to change and `c.ink.glow` how much it shines.

import { buildQuadruped } from './quadruped.js'
import { buildBiped } from './biped.js'
import { buildSerpent } from './serpent.js'
import { buildWinged } from './winged.js'
import { sm } from './parts.js'
import { byForm } from './forms.js'

export const BUILDERS = {
  quadruped: buildQuadruped,
  biped: buildBiped,
  serpent: buildSerpent,
  winged: buildWinged,
}

export const ASPECT_COLOURS = ['#ff5a1f', '#7bd23c', '#b9a27a', '#a78bff', '#35c9ff']

// ----- Marking helpers ------------------------------------------------------------

/** A soft round spot on the head: centre [f, u, |z|] in head lengths, radius r. */
const headSpot = (h, f, u, z, r, soft = 0.35) => {
  const d = Math.hypot(h[0] - f, h[1] - u, Math.abs(h[2]) - z)
  return 1 - sm(r * (1 - soft), r, d)
}
/** Below a height, softly. */
const below = (y, at, soft) => sm(at + soft, at - soft, y)
/** Quadruped torso landmarks from a sheet. */
const quad = (S) => {
  const G = S.girth
  const H = S.leg + G * 0.92
  return { G, H, L: S.length, shX: S.length / 2, hipX: -S.length / 2 }
}
const paintGlow = (c, tone, amount, glow) => {
  if (amount <= 0) return
  c.ink.lerp(c.T[tone], amount)
  c.ink.glow = Math.max(c.ink.glow, amount * glow * (c.S.glow ?? 1))
}
const paintTone = (c, tone, amount) => {
  if (amount > 0) c.ink.lerp(c.T[tone], amount)
}
/** Inner ear: the side the ear opens towards. */
const innerEar = (c) => sm(-0.05, 0.35, c.d.x * 0.8 + c.d.z * c.side * 0.6)

// ----- The face shared by the furred four-legged lines (each sheet adjusts it) -----

const DOG_FACE = {
  wide: 1,
  tall: 1,
  back: 1,
  face: 1,
  stop: 0.46,
  cheek: 0.12,
  muzzle: { len: 0.42, wide: 0.27, up: 0.2, down: 0.16, drop: 0.1, taper: 0.8, sq: 2.4, blunt: 0.85, pads: 1 },
  jaw: { wide: 0.84, len: 0.93, deep: 0.06 },
  teeth: { fang: 0.085, at: 0.72, spread: 0.9, row: 1, small: 0.035, lower: 0.05 },
  nose: { r: 0.075, wide: 1.3, up: 0.42, out: 0.66 },
  eye: { f: 0.3, ang: 57, r: 0.16, tall: 1.08, yaw: 38, pitch: 8, tilt: 6, sink: 0.64, open: 58, low: -38, size: 0.64, pupil: 0.5, slit: 0, look: [0.1, 0.02], spark: 1 },
  ear: { kind: 'pointed', f: -0.1, ang: 40, len: 0.44, wide: 0.17, thick: 0.28, out: 24, back: 16, turn: 34, curl: 0.05 },
}

// ----- The lines ------------------------------------------------------------------------

export const VISUALS = {
  // ======================================================================= 0 Ember
  // A fire lion-hound: a russet pup with soot socks and a candle-flame forelock
  // grows a mane of fire, then obsidian armour, then a halo of flame.
  0: {
    name: 'Cindermaw',
    rig: 'quadruped',
    seed: 11,
    head: 0.6,
    headAngle: -6,
    girth: 0.47,
    length: 0.98,
    leg: 0.74,
    neck: 0.36,
    neckAngle: 40,
    neckThick: 1.08,
    chestDeep: 1.12,
    waist: 0.84,
    tail: 1.0,
    tailLift: 0.55,
    tailDroop: 0.22,
    tailThick: 0.95,
    tailTip: 'flame',
    tailTipSize: byForm(0.7, 0.85, 1, 1.1, 1.25),
    paw: 1.1,
    claw: byForm(0.4, 0.7, 0.9, 1.15, 1.1),
    tones: {
      top: '#9c2f17',
      side: '#d9652a',
      belly: '#ffe3bd',
      dark: '#2e1b1a',
      accent: '#ff6a1c',
      hot: '#ffd774',
      flameDeep: '#ff3a0a',
      nose: '#2a1a1b',
      lid: '#c65a2a',
      lash: '#2a1312',
      ear: '#ffd0b4',
      horn: '#2b1d1d',
      hornTip: '#6b4b3d',
      claw: '#2a2020',
      plate: '#3a1d17',
      plateRim: '#9a4424',
      tooth: '#fff6e4',
    },
    face: {
      ...DOG_FACE,
      cheek: 0.16,
      muzzle: { ...DOG_FACE.muzzle, len: 0.36, wide: 0.32, up: 0.22, down: 0.17, taper: 0.86, blunt: 1 },
      teeth: { ...DOG_FACE.teeth, fang: byForm(0.05, 0.075, 0.09, 0.11, 0.1) },
      nose: { r: 0.085, wide: 1.35, up: 0.45, out: 0.66 },
      eye: { ...DOG_FACE.eye, iris: '#ffae1a', inner: '#ffe987', ring: '#6e2400', slit: byForm(0, 0.3, 0.55, 0.8, 0.6) },
      ear: { kind: 'round', f: -0.08, ang: 42, len: byForm(0.32, 0.32, 0.31, 0.3, 0.3), wide: 0.19, thick: 0.32, out: 30, back: 14, turn: 32, curl: 0.04 },
    },
    // A lion's mane of thick locks that smoulder at the tips.
    mane: byForm(
      null,
      { kind: 'ember', size: 0.2, rows: 1, count: 12, width: 0.46, thick: 0.24 },
      { kind: 'ember', size: 0.28, rows: 2, count: 13, width: 0.44, thick: 0.24 },
      { kind: 'ember', size: 0.33, rows: 2, count: 14, width: 0.42, thick: 0.23 },
      { kind: 'ember', size: 0.37, rows: 3, count: 14, width: 0.42, thick: 0.23 },
    ),
    // The cub's single flame, like a candle between the ears.
    forelock: byForm({ kind: 'flame', size: 0.42, count: 3 }, { kind: 'flame', size: 0.32, count: 3 }, null, null, null),
    crest: byForm(null, null, null, { kind: 'flame', size: 0.22, from: 0.34, to: 0.62, count: 5 }, { kind: 'flame', size: 0.26, from: 0.3, to: 0.64, count: 6 }),
    horns: byForm(null, null, null, { kind: 'swept', size: 0.55, ridges: 5 }, { kind: 'swept', size: 0.7, ridges: 6, glowTip: 0.8 }),
    plates: byForm(null, null, null, { size: 1, seam: 1 }, { size: 1.05, seam: 1 }),
    crown: byForm(null, null, null, null, 'flame'),
    marks(c) {
      const { S } = c
      const form = S.form
      if (c.part === 'head' || c.part === 'jaw') {
        const [f, u] = c.h
        // A cream muzzle below a line from under the eye to the top of the nose, a cream chin,
        // and cream "eyebrow" spots that make the face read.
        const line = 0.15 - (f - 0.3) * 0.3
        paintTone(c, 'belly', c.part === 'jaw' ? 1 : sm(line + 0.035, line - 0.035, u) * sm(0.14, 0.28, f))
        paintTone(c, 'belly', headSpot(c.h, 0.25, 0.49, 0.24, 0.07) * (form < 3 ? 1 : 0.4))
        if (form >= 3) paintTone(c, 'dark', sm(0.25, 0.4, u) * (1 - sm(0.15, 0.3, f)) * 0.35)
      } else if (c.part === 'ear') {
        paintTone(c, 'ear', innerEar(c) * (1 - sm(0.55, 0.75, c.u)))
        paintTone(c, 'dark', sm(0.62, 0.78, c.u))
      } else if (c.part === 'leg' || c.part === 'paw') {
        // Soot socks; a cub's are only smudged.
        paintTone(c, 'dark', (c.part === 'paw' ? 1 : below(c.p.y, S.leg * 0.42, S.leg * 0.08)) * (form === 0 ? 0.6 : 0.92))
      } else if (c.part === 'body') {
        // Ember stripes along the back of the Dread and the Mythic.
        if (form >= 3) {
          const stripe = sm(0.72, 0.9, Math.sin((c.p.x * 5.2 + Math.abs(c.p.z) * 1.5) * Math.PI)) * sm(0.15, 0.55, c.lift)
          paintGlow(c, 'accent', stripe * 0.85, 0.55)
        }
      } else if (c.part === 'tail') {
        paintTone(c, 'dark', sm(0.55, 0.85, c.u))
      }
    },
    materials: { hide: { grain: 'fur', rough: 0.72 } },
    fx: { ambient: 'embers', colour: '#ff7a2a' },
  },

  // ======================================================================= 1 Thorn
  // A forest stag: a spotted fawn with sprouting nubs becomes a stag whose antlers
  // carry leaves, then bark armour, then a crown of glowing blossom.
  1: {
    name: 'Briarhorn',
    rig: 'quadruped',
    seed: 23,
    head: 0.52,
    headAngle: -14,
    girth: 0.44,
    length: 1.18,
    leg: 0.86,
    neck: 0.62,
    neckAngle: 54,
    neckThick: 0.95,
    chestDeep: 1.05,
    waist: 0.86,
    tail: 0.32,
    tailLift: 0.9,
    tailDroop: 0,
    tailThick: 0.9,
    tailTip: 'tuft',
    tailTipSize: 0.8,
    hooves: true,
    paw: 0.82,
    stage: { leg: [0.68, 0.88, 1, 1, 1.02] },
    tones: {
      top: '#6a4528',
      side: '#986b3e',
      belly: '#f4e7c8',
      dark: '#4b3521',
      tip: '#fff8ea',
      accent: '#7bd23c',
      hot: '#dcff8e',
      leaf: '#3f8f2f',
      leafTip: '#a6e852',
      petal: '#ffd2e6',
      petalTip: '#ff79b6',
      nose: '#2c211a',
      lid: '#8e6a40',
      lash: '#2a1a10',
      ear: '#f6dcc6',
      horn: '#6b5034',
      hornTip: '#c9ac80',
      claw: '#3a2a1e',
      plate: '#5a4128',
      plateRim: '#8a6a40',
      moss: '#5f9a35',
    },
    face: {
      ...DOG_FACE,
      wide: 0.9,
      tall: 0.96,
      stop: 0.42,
      cheek: 0.04,
      muzzle: { len: 0.56, wide: 0.22, up: 0.17, down: 0.15, drop: 0.13, taper: 0.86, sq: 2.3, blunt: 0.9, pads: 0.25 },
      teeth: { fang: 0, row: 0, lower: 0 },
      nose: { r: 0.085, wide: 1.35, up: 0.5, out: 0.6 },
      eye: { ...DOG_FACE.eye, f: 0.26, ang: 62, r: 0.165, yaw: 30, tilt: 2, iris: '#5a3a1e', inner: '#b07a3a', ring: '#1a0e06', pupil: 0.56, look: [0.06, 0], spark: 1.15 },
      ear: { kind: 'leaf', f: -0.06, ang: 62, len: byForm(0.5, 0.5, 0.48, 0.46, 0.46), wide: 0.2, thick: 0.22, out: 72, back: 8, turn: 40, curl: 0.04 },
    },
    horns: byForm(
      { kind: 'antler', size: 0.08, tines: 0, leaves: 1 },
      { kind: 'antler', size: 0.42, tines: 1, leaves: 2 },
      { kind: 'antler', size: 0.78, tines: 2, leaves: 2 },
      { kind: 'antler', size: 1.0, tines: 3, leaves: 2 },
      { kind: 'antler', size: 1.12, tines: 3, leaves: 1, bloom: 1.5 },
    ),
    mane: byForm(null, { kind: 'leaf', size: 0.12, rows: 1, count: 10, width: 0.4, lean: 70 }, { kind: 'leaf', size: 0.18, rows: 1, count: 12, width: 0.4, lean: 70 }, { kind: 'leaf', size: 0.22, rows: 2, count: 12, width: 0.38, lean: 68 }, { kind: 'leaf', size: 0.24, rows: 2, count: 14, width: 0.38, lean: 66 }),
    crest: byForm(null, null, null, { kind: 'leaf', size: 0.14, from: 0.3, to: 0.66, count: 6, lean: 55 }, { kind: 'leaf', size: 0.16, from: 0.28, to: 0.68, count: 7, lean: 55 }),
    // The Mythic's crown is its own antlers, in bloom.
    marks(c) {
      const { S } = c
      const form = S.form
      if (c.part === 'head' || c.part === 'jaw') {
        const [f, u] = c.h
        paintTone(c, 'belly', sm(0.02, -0.08, u + 0.1 * (f - 0.42)) * sm(0.2, 0.36, f))
        // A pale ring round each eye and a pale chin.
        paintTone(c, 'belly', headSpot(c.h, 0.27, 0.36, 0.33, 0.2, 0.5) * 0.55)
      } else if (c.part === 'ear') {
        paintTone(c, 'ear', innerEar(c) * (1 - sm(0.6, 0.8, c.u)))
        paintTone(c, 'dark', sm(0.8, 0.95, c.u) * 0.6)
      } else if (c.part === 'body') {
        const { G, L } = quad(S)
        // Fawn spots: two soft rows along each side of the back, fading as the stag grows.
        // Measured on the skin itself: u runs rump to head, v round the body (0 on the spine).
        const fade = [1, 0.85, 0.55, 0.3, 0.35][form]
        const vv = Math.min(c.v, 1 - c.v)
        let spot = 0
        for (let i = 0; i < 5; i++) {
          for (const [row, shift] of [[0.085, 0], [0.165, 0.5]]) {
            const su = 0.12 + ((i + shift) / 5) * 0.5
            const d = Math.hypot((c.u - su) * L * 1.6, (vv - row) * G * 6.3)
            spot = Math.max(spot, 1 - sm(G * 0.06, G * 0.17, d))
          }
        }
        paintTone(c, 'belly', spot * fade * 0.9)
        // Moss and glowing leaf-veins along the spine on later forms.
        if (form >= 2) paintGlow(c, 'accent', (1 - sm(0.02, 0.06, Math.abs(c.p.z))) * sm(0.7, 0.9, c.lift) * 0.8, 0.6)
      } else if (c.part === 'leg') {
        paintTone(c, 'dark', below(c.p.y, S.leg * 0.22, S.leg * 0.06) * 0.7)
      } else if (c.part === 'tailTip' || c.part === 'tail') {
        paintTone(c, 'tip', c.part === 'tailTip' ? 1 : sm(-0.1, -0.5, c.lift))
      }
    },
    materials: { hide: { grain: 'fur', rough: 0.78 } },
    fx: { ambient: 'spores', colour: '#b6ff5a' },
  },

  // ======================================================================= 7 Stone (rare)
  // An obsidian panther: a glossy black kitten with two violet chips on its
  // shoulders grows a ridge of crystal, sabre fangs, then a ring of floating shards.
  7: {
    name: 'Shardfang',
    rig: 'quadruped',
    seed: 37,
    head: 0.48,
    headAngle: -4,
    girth: 0.42,
    length: 1.1,
    leg: 0.7,
    limb: 1.06,
    neck: 0.3,
    neckAngle: 32,
    neckThick: 1.02,
    chestDeep: 1.22,
    waist: 0.7,
    tail: 1.5,
    tailLift: 0.25,
    tailDroop: 0.12,
    tailThick: 0.8,
    tailTip: byForm(null, null, 'blade', 'blade', 'blade'),
    tailTipSize: byForm(0.5, 0.7, 0.8, 1, 1.1),
    paw: 1.12,
    claw: byForm(0.5, 0.8, 1, 1.2, 1.2),
    tones: {
      top: '#1f1c2b',
      side: '#2f2a42',
      belly: '#5b5474',
      dark: '#110f18',
      accent: '#9b6bff',
      hot: '#efe4ff',
      crystal: '#d7c4ff',
      crystalDeep: '#5a2fd0',
      nose: '#191521',
      lid: '#2a2538',
      lash: '#0c0a10',
      ear: '#6a5a8a',
      horn: '#1a1622',
      hornTip: '#b9a6e6',
      claw: '#c9b6ff',
      mouth: '#5a1a40',
      tooth: '#f4eeff',
    },
    face: {
      ...DOG_FACE,
      wide: 1.06,
      tall: 0.94,
      stop: 0.5,
      cheek: 0.2,
      muzzle: { len: 0.2, wide: 0.27, up: 0.17, down: 0.14, drop: 0.1, taper: 0.88, sq: 2.6, blunt: 1, pads: 1.3 },
      teeth: { fang: byForm(0.05, 0.08, 0.12, 0.17, 0.17), at: 0.6, spread: 0.92, row: 1, small: 0.03, lower: 0.04 },
      nose: { r: 0.06, wide: 1.4, up: 0.5, out: 0.6 },
      eye: { ...DOG_FACE.eye, f: 0.34, ang: 56, r: 0.16, yaw: 32, tilt: 14, iris: '#ffcc3a', inner: '#fff09a', ring: '#7a3a00', slit: byForm(0, 0.55, 0.8, 0.9, 0.85), pupil: 0.46 },
      ear: { kind: 'round', f: -0.08, ang: 44, len: 0.24, wide: 0.16, thick: 0.3, out: 34, back: 14, turn: 30, curl: 0.03 },
    },
    crest: byForm(
      { kind: 'crystal', size: 0.1, from: 0.6, to: 0.66, count: 1 },
      { kind: 'crystal', size: 0.16, from: 0.5, to: 0.68, count: 2 },
      { kind: 'crystal', size: 0.24, from: 0.34, to: 0.7, count: 4, tail: 2 },
      { kind: 'crystal', size: 0.3, from: 0.3, to: 0.72, count: 5, tail: 3 },
      { kind: 'crystal', size: 0.32, from: 0.28, to: 0.72, count: 5, tail: 3 },
    ),
    flankCrystals: byForm(0, 0, 0, 0.16, 0.18),
    legSpikes: byForm(null, null, null, { size: 0.7 }, { size: 0.8 }),
    crown: byForm(null, null, null, null, 'shards'),
    rim: '#9b6bff',
    marks(c) {
      const { S } = c
      const form = S.form
      if (c.part === 'head' || c.part === 'jaw') {
        const [f, u] = c.h
        paintTone(c, 'belly', sm(0.0, -0.08, u + 0.1 * (f - 0.45)) * sm(0.22, 0.38, f) * 0.8)
        // A violet gem-mark on the brow.
        if (form >= 1) paintGlow(c, 'accent', headSpot(c.h, 0.12, 0.47, 0, 0.07), 0.9)
      } else if (c.part === 'ear') {
        paintTone(c, 'ear', innerEar(c) * (1 - sm(0.6, 0.8, c.u)) * 0.8)
      } else if (c.part === 'paw') {
        // Violet paw pads that glow a little.
        paintGlow(c, 'accent', sm(-0.4, -0.8, c.lift) * 0.7, 0.4)
      }
    },
    materials: { hide: { grain: null, rough: 0.42, metal: 0.04 } },
    fx: { ambient: 'glints', colour: '#b99cff' },
  },

  // ======================================================================= 9 Tide (rare)
  // A sea-wolf: a round blue pup with a white mask and little cheek fins grows a
  // dorsal sail and a fluked tail that glow at the edges, then a pearl diadem.
  9: {
    name: 'Tidereaver',
    rig: 'quadruped',
    seed: 41,
    head: 0.56,
    headAngle: -6,
    girth: 0.44,
    length: 1.04,
    leg: 0.72,
    neck: 0.34,
    neckAngle: 38,
    neckThick: 1.04,
    chestDeep: 1.08,
    waist: 0.84,
    tail: 1.05,
    tailLift: 0.3,
    tailDroop: 0.15,
    tailThick: 1.05,
    tailTip: 'fluke',
    tailTipSize: byForm(0.6, 0.8, 1, 1.1, 1.2),
    paw: 1.12,
    claw: byForm(0.4, 0.6, 0.8, 1.05, 1),
    tones: {
      top: '#1d4c86',
      side: '#3584c2',
      belly: '#eef8ff',
      dark: '#15365c',
      accent: '#35c9ff',
      hot: '#d4f8ff',
      fin: '#2c79b8',
      finEdge: '#5edcff',
      crownFin: '#3aa6dc',
      pearl: '#fff4ec',
      nose: '#13213a',
      lid: '#2a5a92',
      lash: '#0c1626',
      ear: '#d6ecff',
      horn: '#173a62',
      hornTip: '#7ab8e6',
      claw: '#1a2a44',
      plate: '#173a62',
      plateRim: '#5aa8e0',
      mouth: '#5a1a3a',
    },
    face: {
      ...DOG_FACE,
      muzzle: { ...DOG_FACE.muzzle, len: 0.46, wide: 0.26, up: 0.18 },
      teeth: { ...DOG_FACE.teeth, fang: byForm(0.05, 0.07, 0.085, 0.11, 0.1) },
      eye: { ...DOG_FACE.eye, iris: '#2fd6ff', inner: '#c4fbff', ring: '#0a3a5a', slit: 0, pupil: 0.48 },
      ear: { ...DOG_FACE.ear, len: 0.36, wide: 0.16, out: 30, back: 24 },
    },
    cheekFins: byForm(0.5, 0.75, 1, 1.15, 1.2),
    backFin: byForm(0, 0.6, 0.9, 1.05, 1.1),
    crest: byForm(null, null, null, { kind: 'spine', size: 0.12, from: 0.82, to: 0.9, count: 2 }, null),
    plates: byForm(null, null, null, { size: 0.8, seam: 1 }, { size: 0.8, seam: 1 }),
    crown: byForm(null, null, null, null, 'pearl'),
    marks(c) {
      const { S } = c
      const form = S.form
      if (c.part === 'head' || c.part === 'jaw') {
        const [f, u] = c.h
        // A white mask: muzzle, cheeks and a stripe up between the eyes.
        paintTone(c, 'belly', sm(0.1, 0.0, u + 0.16 * (f - 0.42)) * sm(0.1, 0.28, f))
        paintTone(c, 'belly', (1 - sm(0.05, 0.08, Math.abs(c.h[2]))) * sm(0.2, 0.3, f) * sm(0.25, 0.32, u) * 0.9)
        paintGlow(c, 'accent', headSpot(c.h, 0.1, 0.48, 0.2, 0.04) * (form >= 1 ? 1 : 0), 1)
      } else if (c.part === 'ear') {
        paintTone(c, 'ear', innerEar(c) * (1 - sm(0.6, 0.8, c.u)))
      } else if (c.part === 'leg' || c.part === 'paw') {
        paintTone(c, 'belly', below(c.p.y, S.leg * 0.3, S.leg * 0.07))
      } else if (c.part === 'body') {
        const { G, H, L } = quad(S)
        // A row of glowing spots down each side, like lights in deep water.
        let dot = 0
        for (let i = 0; i < 6; i++) {
          const x = -L * 0.4 + (i / 5) * L * 0.78
          const d = Math.hypot(c.p.x - x, c.p.y - (H - G * 0.12), Math.abs(c.p.z) - G * 0.86)
          dot = Math.max(dot, 1 - sm(G * 0.05, G * 0.085, d))
        }
        paintGlow(c, 'accent', dot * [0.4, 0.8, 1, 1, 1][form], 1)
      } else if (c.part === 'tail') {
        paintTone(c, 'belly', sm(-0.2, -0.55, c.lift))
      }
    },
    materials: { hide: { grain: 'fur', rough: 0.6, grainScale: 0.25 } },
    fx: { ambient: 'drips', colour: '#7fe4ff' },
  },
}

// ----- Shared faces for the other body plans -------------------------------------------

const APE_FACE = {
  wide: 1.04,
  tall: 0.96,
  back: 0.92,
  face: 1.02,
  stop: 0.44,
  cheek: 0.2,
  brow: 0.05,
  muzzle: { len: 0.27, wide: 0.33, up: 0.19, down: 0.17, drop: 0.12, taper: 0.9, sq: 2.8, blunt: 1, pads: 0.6 },
  jaw: { wide: 0.9, len: 0.95, deep: 0.08 },
  teeth: { fang: 0.04, at: 0.62, spread: 0.85, row: 1, small: 0.03, lower: 0 },
  nose: { r: 0.075, wide: 1.6, up: 0.55, out: 0.55 },
  eye: { f: 0.32, ang: 58, r: 0.155, tall: 1.05, yaw: 30, pitch: 6, tilt: 4, sink: 0.68, open: 58, low: -38, size: 0.64, pupil: 0.52, slit: 0, look: [0.12, 0.02], spark: 1 },
  ear: { kind: 'round', f: -0.04, ang: 76, len: 0.2, wide: 0.15, thick: 0.34, out: 74, back: 10, turn: 20, curl: 0.03 },
}

const WYRM_FACE = {
  wide: 0.92,
  tall: 0.88,
  back: 1.05,
  face: 0.98,
  stop: 0.42,
  cheek: 0.1,
  muzzle: { len: 0.46, wide: 0.25, up: 0.16, down: 0.13, drop: 0.06, taper: 0.76, sq: 2.5, blunt: 0.85, pads: 0 },
  jaw: { wide: 0.86, len: 0.95, deep: 0.05 },
  teeth: { fang: 0.07, at: 0.72, spread: 0.85, row: 1, small: 0.035, lower: 0.04 },
  nose: { r: 0, nostril: 0.03 },
  eye: { f: 0.26, ang: 54, r: 0.15, tall: 1.06, yaw: 42, pitch: 10, tilt: 10, sink: 0.64, open: 58, low: -38, size: 0.64, pupil: 0.48, slit: 0, look: [0.1, 0.02], spark: 1 },
  ear: { kind: 'none' },
}


Object.assign(VISUALS, {
  // ======================================================================= 2 Stone
  // A boulder ape: a pebble-grey baby with one amber chip on its back grows into a
  // mountain of shoulder crowned with glowing crystal, then with floating shards.
  2: {
    name: 'Gravemaul',
    rig: 'biped',
    seed: 53,
    head: 0.6,
    headAngle: -2,
    girth: 0.52,
    shoulders: 0.74,
    torso: 0.96,
    hunch: 22,
    waist: 1.02,
    leg: 0.6,
    arm: 1.32,
    forearm: 1.28,
    fist: byForm(1.2, 1.1, 1.15, 1.22, 1.25),
    paw: 1.1,
    stage: { leg: [0.7, 0.88, 1, 1, 1.02], head: [1.42, 1.15, 1, 0.98, 1] },
    tones: {
      top: '#525866',
      side: '#727986',
      belly: '#a9a69e',
      dark: '#383c46',
      skin: '#c4b69a',
      accent: '#f0a63a',
      hot: '#ffe0a0',
      crystal: '#ffd27a',
      crystalDeep: '#b8620e',
      nose: '#3a3430',
      lid: '#7a7468',
      lash: '#2a2622',
      ear: '#a69c88',
      horn: '#4a443c',
      hornTip: '#c8bba0',
      plate: '#57524a',
      plateRim: '#8e8676',
      tooth: '#fff4dc',
    },
    face: {
      ...APE_FACE,
      teeth: { ...APE_FACE.teeth, fang: byForm(0.03, 0.04, 0.05, 0.06, 0.06), lower: byForm(0, 0, 0, 0.09, 0.08), lowerAt: 0.5, tusk: true },
      eye: { ...APE_FACE.eye, iris: '#ffb43a', inner: '#ffe08a', ring: '#7a3a00' },
    },
    crest: byForm(
      { kind: 'crystal', size: 0.16, from: 0.66, to: 0.7, count: 1 },
      { kind: 'crystal', size: 0.24, from: 0.58, to: 0.74, count: 2 },
      { kind: 'crystal', size: 0.36, from: 0.42, to: 0.82, count: 4 },
      { kind: 'crystal', size: 0.42, from: 0.36, to: 0.84, count: 5, rows: 3 },
      { kind: 'crystal', size: 0.46, from: 0.34, to: 0.84, count: 5, rows: 3 },
    ),
    plates: byForm(null, { kind: 'boulder', size: 0.7 }, { kind: 'boulder', size: 0.95 }, { kind: 'boulder', size: 1.15 }, { kind: 'boulder', size: 1.2 }),
    knuckles: byForm(null, null, null, null, { size: 0.8 }),
    crown: byForm(null, null, null, null, 'shards'),
    marks(c) {
      const { S } = c
      const form = S.form
      if (c.part === 'head' || c.part === 'jaw') {
        const [f, u] = c.h
        // A pale sandstone face: the muzzle and a mask round the eyes.
        paintTone(c, 'skin', c.part === 'jaw' ? 1 : Math.max(sm(0.2, 0.32, f) * sm(0.48, 0.38, u), headSpot(c.h, 0.3, 0.32, 0.3, 0.2, 0.5)))
      } else if (c.part === 'body') {
        // A pale sandstone chest, and in it a glowing heart-stone from the Prowler on.
        paintTone(c, 'skin', sm(-0.35, -0.75, c.lift) * 0.85)
        const heart = 1 - sm(0.45, 1, Math.hypot(c.d.y * 2.2, c.d.z * 2.6, (c.u - 0.66) * 9))
        if (form >= 1) paintGlow(c, 'accent', heart * sm(-0.5, -0.85, c.lift), [0, 0.6, 0.85, 1, 1.1][form])
      } else if (c.part === 'fist' || c.part === 'paw') {
        paintTone(c, 'skin', 0.45)
      }
    },
    materials: { hide: { grain: 'stone', rough: 0.86, grainScale: 0.45 } },
    fx: { ambient: 'dust', colour: '#c9b48a' },
  },

  // ======================================================================= 3 Storm
  // A storm raptor-wyvern: a fluffy indigo chick with a yellow beak grows bolt-striped
  // wings, then a crest of lightning feathers.
  3: {
    name: 'Skyrazor',
    rig: 'winged',
    seed: 97,
    size: 1,
    head: 0.54,
    headAngle: -8,
    girth: 0.38,
    leg: 0.62,
    neck: 0.5,
    neckThick: 1.3,
    tail: 1.3,
    tailLift: 0.1,
    tailDroop: 0.2,
    wingspan: byForm(1.05, 1.4, 1.75, 1.9, 2.0),
    talon: byForm(0.6, 0.8, 1, 1.2, 1.2),
    beak: true,
    stage: { head: [1.45, 1.15, 1, 1, 1.02] },
    tones: {
      top: '#2b3276',
      side: '#4c58b6',
      belly: '#ebe9ff',
      dark: '#1b1f46',
      accent: '#a78bff',
      hot: '#f4efff',
      wing: '#4a56b2',
      wingRoot: '#283070',
      wingEdge: '#b6a2ff',
      beak: byForm('#ffd23a', '#e9b53a', '#3c4268', '#33385c', '#3c4268'),
      cere: '#ffcf3a',
      claw: '#2a2a44',
      horn: '#262a5a',
      hornTip: '#c6bcff',
      lid: '#3a4290',
      lash: '#141634',
      mouth: '#5a2040',
    },
    face: {
      ...WYRM_FACE,
      wide: 0.96,
      tall: 0.94,
      stop: 0.4,
      brow: 0.45,
      stopWide: 0.2,
      muzzle: { len: 0.36, wide: 0.15, up: 0.16, down: 0.1, drop: 0.11, taper: 0.38, sq: 2, blunt: 0.4, pads: 0 },
      teeth: { fang: 0, row: 0, lower: 0 },
      nose: { r: 0 },
      eye: { ...WYRM_FACE.eye, f: 0.24, ang: 58, r: 0.17, iris: '#ffc81f', inner: '#fff08a', ring: '#7a4a00', slit: byForm(0, 0.4, 0.7, 0.9, 0.75) },
    },
    headCrest: byForm({ kind: 'feather', size: 0.3, count: 3 }, { kind: 'feather', size: 0.55, count: 4 }, { kind: 'storm', size: 0.8, count: 5 }, { kind: 'storm', size: 0.95, count: 5 }, { kind: 'storm', size: 0.6, count: 3 }),
    wingEdge: byForm(null, { kind: 'feather', size: 0.12 }, { kind: 'storm', size: 0.16 }, { kind: 'storm', size: 0.2 }, { kind: 'storm', size: 0.22 }),
    tailTip: byForm('blade', 'blade', 'storm', 'storm', 'storm'),
    tailTipSize: byForm(0.6, 0.8, 1, 1.15, 1.25),
    crest: byForm(null, null, null, { kind: 'storm', size: 0.2, from: 0.3, to: 0.62, count: 4 }, { kind: 'storm', size: 0.22, from: 0.3, to: 0.64, count: 5 }),
    crown: byForm(null, null, null, null, 'bolts'),
    marks(c) {
      const { S } = c
      const form = S.form
      if (c.part === 'head' || c.part === 'jaw') {
        const f = c.h[0]
        const u = c.h[1]
        // A yellow beak, and a dark stripe back from the eye like a falcon's.
        const beak = sm(S.face.stop - 0.04, S.face.stop + 0.04, f)
        paintTone(c, 'beak', beak)
        // A yellow cere where the beak meets the face.
        if (form >= 2) paintTone(c, 'cere', beak * (1 - sm(S.face.stop + 0.06, S.face.stop + 0.12, f)))
        paintTone(c, 'belly', sm(0.08, -0.06, u) * (1 - beak) * 0.9)
      } else if (c.part === 'wing') {
        // A broad pale band across the wing that glows with stored lightning.
        const band = sm(0.5, 0.58, c.v) * (1 - sm(0.7, 0.78, c.v))
        paintGlow(c, 'accent', band * 0.7, [0.06, 0.12, 0.2, 0.26, 0.3][form])
      } else if (c.part === 'leg') {
        paintTone(c, 'beak', sm(S.leg * 0.45, S.leg * 0.3, c.p.y))
      }
    },
    materials: { hide: { grain: 'fur', rough: 0.7, grainScale: 0.28 } },
    fx: { ambient: 'sparks', colour: '#c8b8ff' },
  },

  // ======================================================================= 4 Tide
  // A sea serpent: a round little ripplet with fin-ears grows a frill that glows at
  // the edges, a sail down its back, and finally a pearl-and-fin diadem.
  4: {
    name: 'Undertow',
    rig: 'serpent',
    ridge: 0.05,
    bellyLine: -0.72,
    backLine: 0.15,
    seed: 71,
    head: 0.5,
    headAngle: -8,
    girth: 0.3,
    length: byForm(2.0, 2.6, 3.0, 3.2, 3.4),
    coil: 0.9,
    rise: byForm(0.62, 0.82, 1, 1.05, 1.1),
    stage: { head: [1.5, 1.18, 1, 1, 1.02] },
    tones: {
      top: '#1b6898',
      side: '#39a5cf',
      belly: '#ecf8ee',
      dark: '#11476a',
      accent: '#35c9ff',
      hot: '#dcfbff',
      fin: '#2c8ec2',
      finEdge: '#76e6ff',
      crownFin: '#48b6e2',
      pearl: '#fff6ee',
      horn: '#1a4a6a',
      hornTip: '#8ad4f0',
      lid: '#2a78a6',
      lash: '#0c2436',
      mouth: '#5a1a3c',
    },
    face: {
      ...WYRM_FACE,
      wide: 1,
      cheek: 0.16,
      muzzle: { len: 0.38, wide: 0.27, up: 0.18, down: 0.14, drop: 0.05, taper: 0.82, sq: 2.3, blunt: 1, pads: 0.4 },
      teeth: { fang: byForm(0.03, 0.05, 0.06, 0.08, 0.07), at: 0.7, spread: 0.85, row: 1, small: 0.03, lower: 0.03 },
      eye: { ...WYRM_FACE.eye, r: 0.165, iris: '#2fd8ff', inner: '#c8fbff', ring: '#0a3a5a', pupil: 0.5 },
    },
    frill: byForm(0.55, 0.78, 1, 1.15, 1.25),
    barbels: byForm(0, 0.5, 0.8, 1, 1),
    crest: byForm(null, { kind: 'fin', size: 0.18, from: 0.3, to: 0.8, count: 9 }, { kind: 'fin', size: 0.28, from: 0.2, to: 0.84, count: 12 }, { kind: 'fin', size: 0.34, from: 0.15, to: 0.86, count: 13 }, { kind: 'fin', size: 0.36, from: 0.15, to: 0.86, count: 13 }),
    plates: byForm(null, null, null, { size: 0.9, seam: 1 }, { size: 0.9, seam: 1 }),
    tailTip: 'fin',
    tailTipSize: byForm(0.7, 0.85, 1, 1.1, 1.2),
    crown: byForm(null, null, null, null, 'pearl'),
    marks(c) {
      const { S } = c
      const form = S.form
      if (c.part === 'head' || c.part === 'jaw') {
        const [f, u] = c.h
        paintTone(c, 'belly', c.part === 'jaw' ? 1 : sm(0.04, -0.06, u + 0.12 * (f - 0.4)) * sm(0.1, 0.26, f))
        paintGlow(c, 'accent', headSpot(c.h, 0.06, 0.46, 0.22, 0.045) * (form >= 1 ? 1 : 0.5), 1)
      } else if (c.part === 'body') {
        // Belly scutes in pale bands, and lights along each side.
        const under = 1 - sm(0.12, 0.2, Math.abs(c.v - 0.5))
        const scute = 0.82 + 0.18 * sm(0.3, 0.5, Math.abs(Math.sin(c.u * 90)))
        if (under > 0) c.ink.multiplyScalar(1 - under * (1 - scute))
        const line = 1 - sm(0.025, 0.06, Math.abs(Math.min(c.v, 1 - c.v) - 0.27))
        paintGlow(c, 'accent', line * sm(0.08, 0.3, c.u) * (1 - sm(0.9, 0.97, c.u)), [0.18, 0.24, 0.3, 0.34, 0.38][form])
      }
    },
    materials: { hide: { grain: 'scales', rough: 0.42, grainScale: 0.1 } },
    fx: { ambient: 'drips', colour: '#7fe4ff' },
  },

  // ======================================================================= 5 Ember (rare)
  // A lava wyrm: a dark little spark with a glowing belly grows swept horns and a
  // crest of flame, obsidian plates, and at last the rays of a sun behind its head.
  5: {
    name: 'Ashwyrm',
    rig: 'serpent',
    bellyLine: -0.72,
    backLine: 0.15,
    seed: 83,
    head: 0.52,
    headAngle: -10,
    girth: 0.32,
    length: byForm(2.0, 2.6, 3.0, 3.2, 3.4),
    coil: 1,
    rise: byForm(0.62, 0.84, 1.02, 1.08, 1.12),
    hood: byForm(0, 0.15, 0.3, 0.4, 0.4),
    stage: { head: [1.5, 1.18, 1, 1, 1.02] },
    ridge: 0.08,
    tones: {
      top: '#2c2126',
      side: '#a8401e',
      belly: '#4c1d15',
      dark: '#1a1012',
      accent: '#ff5a1f',
      hot: '#ffd774',
      flameDeep: '#ff2a0a',
      horn: '#2a1c1c',
      hornTip: '#8a4a30',
      lid: '#4a2a24',
      lash: '#140c0c',
      plate: '#2a1f22',
      plateRim: '#6a2e1e',
      mouth: '#5a1010',
    },
    face: {
      ...WYRM_FACE,
      brow: 0.15,
      teeth: { ...WYRM_FACE.teeth, fang: byForm(0.04, 0.06, 0.08, 0.1, 0.09) },
      eye: { ...WYRM_FACE.eye, r: 0.165, iris: '#ffb21a', inner: '#fff0a0', ring: '#6e1a00', slit: byForm(0, 0.5, 0.75, 0.9, 0.8) },
    },
    horns: byForm({ kind: 'swept', size: 0.2 }, { kind: 'swept', size: 0.34 }, { kind: 'swept', size: 0.55, ridges: 4 }, { kind: 'swept', size: 0.75, ridges: 5, glowTip: 0.5 }, { kind: 'swept', size: 0.85, ridges: 6, glowTip: 0.9 }),
    // Fire on the reared neck; cooled crust on the coils, split by molten seams.
    crest: byForm({ kind: 'flame', size: 0.14, from: 0.8, to: 0.9, count: 3 }, { kind: 'flame', size: 0.2, from: 0.72, to: 0.9, count: 5 }, { kind: 'flame', size: 0.28, from: 0.66, to: 0.9, count: 7 }, { kind: 'flame', size: 0.32, from: 0.62, to: 0.9, count: 8 }, { kind: 'flame', size: 0.34, from: 0.6, to: 0.9, count: 8 }),
    plates: byForm({ size: 0.55, seam: 1, from: 0.3, to: 0.68, count: 4 }, { size: 0.65, seam: 1, from: 0.24, to: 0.7, count: 6 }, { size: 0.78, seam: 1, from: 0.16, to: 0.7, count: 9 }, { size: 0.92, seam: 1, from: 0.12, to: 0.7, count: 11 }, { size: 0.96, seam: 1, from: 0.12, to: 0.7, count: 11 }),
    tailTip: 'flame',
    tailTipSize: byForm(0.6, 0.8, 1, 1.1, 1.25),
    crown: byForm(null, null, null, null, 'flame'),
    marks(c) {
      const { S } = c
      const form = S.form
      if (c.part === 'head' || c.part === 'jaw') {
        // Glowing scales above the eyes, and a molten jaw line.
        paintGlow(c, 'accent', headSpot(c.h, 0.2, 0.5, 0.2, 0.06) * (form >= 1 ? 1 : 0.6), 0.9)
        paintGlow(c, 'belly', c.part === 'jaw' ? sm(-0.3, -0.6, c.lift) : 0, 0.8)
      } else if (c.part === 'body') {
        // Dark belly plates with molten seams between them, brighter with each form.
        const under = 1 - sm(0.08, 0.14, Math.abs(c.v - 0.5))
        const seam = 1 - sm(0.12, 0.3, Math.abs(Math.sin(c.u * 40)))
        paintGlow(c, 'accent', under * seam * sm(0.06, 0.18, c.u), [0.5, 0.65, 0.8, 0.95, 1.05][form])
      }
    },
    materials: { hide: { grain: 'scales', rough: 0.5, grainScale: 0.1 } },
    fx: { ambient: 'embers', colour: '#ff7a2a' },
  },

  // ======================================================================= 6 Thorn (rare)
  // A flower drake: a round green hatchling with a bud on its head unfolds petal
  // wings and a crest of blossom, and at last wears a crown of flowers.
  6: {
    name: 'Mirewing',
    rig: 'winged',
    seed: 101,
    size: 1,
    head: 0.56,
    headAngle: -10,
    girth: 0.4,
    leg: 0.6,
    neck: 0.52,
    neckThick: 1.35,
    tail: 1.4,
    tailLift: 0.15,
    tailDroop: 0.25,
    tailThick: 1.05,
    wingspan: byForm(1.0, 1.35, 1.7, 1.85, 1.95),
    talon: byForm(0.5, 0.7, 0.9, 1.05, 1),
    stage: { head: [1.45, 1.15, 1, 1, 1.02] },
    tones: {
      top: '#3c7632',
      side: '#71ae4c',
      belly: '#f2eeb6',
      dark: '#28461f',
      accent: '#7bd23c',
      hot: '#eaffb4',
      petal: '#ffc2da',
      petalTip: '#ff5c9e',
      leaf: '#3f8f2f',
      leafTip: '#a6e852',
      wingRoot: '#3c7632',
      wing: '#ffb3cf',
      wingEdge: '#ff6aa8',
      horn: '#6a4a2a',
      hornTip: '#d2ac78',
      claw: '#5a3e24',
      lid: '#4f8a3e',
      lash: '#1c2a12',
      ear: '#ffd2e4',
      mouth: '#6a1a40',
      tongue: '#ff8ab0',
    },
    face: {
      ...WYRM_FACE,
      wide: 1,
      cheek: 0.14,
      muzzle: { len: 0.38, wide: 0.25, up: 0.17, down: 0.13, drop: 0.05, taper: 0.78, sq: 2.3, blunt: 0.95, pads: 0.3 },
      teeth: { fang: byForm(0.02, 0.035, 0.05, 0.065, 0.06), at: 0.72, spread: 0.85, row: 0, lower: 0 },
      eye: { ...WYRM_FACE.eye, r: 0.165, iris: '#ff5fa6', inner: '#ffd0e6', ring: '#6a0a3a', pupil: 0.5 },
      ear: { kind: 'leaf', f: -0.12, ang: 50, len: 0.36, wide: 0.17, thick: 0.2, out: 48, back: 26, turn: 40, curl: 0.06 },
    },
    headCrest: byForm({ kind: 'petal', size: 0.3, count: 3 }, { kind: 'petal', size: 0.45, count: 4 }, { kind: 'petal', size: 0.6, count: 5 }, { kind: 'petal', size: 0.7, count: 5 }, null),
    horns: byForm(null, null, { kind: 'swept', size: 0.4 }, { kind: 'swept', size: 0.6, ridges: 4 }, { kind: 'swept', size: 0.65, ridges: 5 }),
    wingEdge: byForm(null, { kind: 'petal', size: 0.1 }, { kind: 'petal', size: 0.14 }, { kind: 'petal', size: 0.17 }, { kind: 'petal', size: 0.19 }),
    tailTip: 'leaf',
    tailTipSize: byForm(0.6, 0.8, 1, 1.1, 1.2),
    tailBloom: byForm(0, 0, 0.8, 1, 1.2),
    crest: byForm(null, null, { kind: 'leaf', size: 0.16, from: 0.2, to: 0.85, count: 6, tail: 2 }, { kind: 'leaf', size: 0.2, from: 0.15, to: 0.88, count: 7, tail: 3 }, { kind: 'leaf', size: 0.22, from: 0.15, to: 0.88, count: 7, tail: 3 }),
    crown: byForm(null, null, null, null, 'bloom'),
    marks(c) {
      const { S } = c
      const form = S.form
      if (c.part === 'head' || c.part === 'jaw') {
        const [f, u] = c.h
        paintTone(c, 'belly', c.part === 'jaw' ? 1 : sm(0.02, -0.08, u + 0.1 * (f - 0.4)) * sm(0.12, 0.3, f))
        paintTone(c, 'petal', headSpot(c.h, 0.22, 0.24, 0.36, 0.08) * 0.7)
      } else if (c.part === 'wing') {
        // Three broad veins that glow, fanning from the root.
        const vein = 1 - sm(0.05, 0.12, Math.abs(Math.sin(c.u * Math.PI * 1.5)))
        paintGlow(c, 'leafTip', vein * sm(0.1, 0.35, c.v) * (1 - sm(0.75, 0.95, c.v)), [0.2, 0.4, 0.6, 0.7, 0.8][form])
      } else if (c.part === 'body') {
        // A pink saddle of petals along the back.
        paintTone(c, 'petal', sm(0.55, 0.85, c.lift) * sm(0.2, 0.35, c.u) * (1 - sm(0.6, 0.75, c.u)) * 0.75)
      }
    },
    materials: { hide: { grain: 'scales', rough: 0.6, grainScale: 0.09 } },
    fx: { ambient: 'spores', colour: '#d8ff7a' },
  },

  // ======================================================================= 8 Storm (rare)
  // A storm yeti: a snowball of a cub with tiny horn buds grows ram horns that
  // spark at the tips, fur that crackles violet, and a crown of lightning.
  8: {
    name: 'Thunderhide',
    rig: 'biped',
    seed: 67,
    head: 0.6,
    headAngle: -2,
    girth: 0.52,
    shoulders: 0.7,
    torso: 0.92,
    hunch: 18,
    waist: 1.04,
    leg: 0.62,
    arm: 1.26,
    forearm: 1.18,
    fist: byForm(1.1, 1.0, 1.05, 1.12, 1.15),
    paw: 1.1,
    stage: { leg: [0.7, 0.88, 1, 1, 1.02], head: [1.42, 1.15, 1, 0.98, 1] },
    tones: {
      top: '#b5afe0',
      side: '#dddaf4',
      belly: '#eceaf9',
      dark: '#36365e',
      skin: '#4c4c7e',
      accent: '#a78bff',
      hot: '#f2ecff',
      nose: '#24223c',
      lid: '#5a5890',
      lash: '#16142a',
      ear: '#6a6898',
      horn: '#3a3658',
      hornTip: '#cfc6f6',
      plate: '#3c3a62',
      plateRim: '#8a84c8',
      mouth: '#4a1a40',
    },
    face: {
      ...APE_FACE,
      brow: 0.2,
      muzzle: { ...APE_FACE.muzzle, len: 0.25, wide: 0.3, up: 0.18, drop: 0.1 },
      teeth: { ...APE_FACE.teeth, fang: byForm(0.03, 0.045, 0.06, 0.08, 0.07) },
      eye: { ...APE_FACE.eye, r: 0.15, iris: '#9ad8ff', inner: '#e8fbff', ring: '#1a3a6a' },
      ear: { ...APE_FACE.ear, ang: 70, len: 0.16 },
    },
    mane: byForm(null, { kind: 'storm', size: 0.28, rows: 1, count: 13, width: 0.46 }, { kind: 'storm', size: 0.36, rows: 2, count: 13, width: 0.44 }, { kind: 'storm', size: 0.42, rows: 2, count: 15, width: 0.42 }, { kind: 'storm', size: 0.46, rows: 2, count: 15, width: 0.42 }),
    forelock: byForm({ kind: 'fur', size: 0.42, count: 3 }, { kind: 'fur', size: 0.3, count: 3 }, null, null, null),
    horns: byForm(null, { kind: 'ram', size: 0.5, turns: 0.5 }, { kind: 'ram', size: 0.85, turns: 0.85 }, { kind: 'ram', size: 1.05, turns: 1.0, glowTip: 0.6 }, { kind: 'ram', size: 1.1, turns: 1.05, glowTip: 1 }),
    crest: byForm(null, null, null, { kind: 'bolts', size: 0.36, from: 0.4, to: 0.82, count: 4 }, { kind: 'bolts', size: 0.4, from: 0.38, to: 0.82, count: 4 }),
    plates: byForm(null, null, null, { size: 0.6, seam: 1, forearm: true }, { size: 0.6, seam: 1, forearm: true }),
    crown: byForm(null, null, null, null, 'bolts'),
    marks(c) {
      const { S } = c
      const form = S.form
      if (c.part === 'head' || c.part === 'jaw') {
        const [f, u] = c.h
        // A dark face: muzzle and round the eyes; white fur everywhere else.
        paintTone(c, 'skin', c.part === 'jaw' ? 0.9 : Math.max(sm(0.22, 0.34, f) * sm(0.44, 0.34, u), headSpot(c.h, 0.3, 0.32, 0.3, 0.2, 0.5)))
      } else if (c.part === 'fist' || c.part === 'paw') {
        paintTone(c, 'skin', 0.85)
      } else if (c.part === 'body') {
        // A storm-cloud saddle across the shoulders that holds a soft glow.
        paintGlow(c, 'accent', sm(0.55, 0.9, c.lift) * sm(0.6, 0.8, c.u) * 0.6, [0, 0.2, 0.35, 0.5, 0.6][form])
      }
    },
    materials: { hide: { grain: 'fur', rough: 0.86, grainScale: 0.42 } },
    fx: { ambient: 'sparks', colour: '#c8b8ff' },
  },
})

/** Adds or replaces a line. */
export function registerVisual(id, sheet) {
  VISUALS[id] = sheet
}

