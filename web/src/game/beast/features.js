// Things that grow on a beast, shared by every body plan: armour shells,
// horns and antlers, fins and frills, tufts of flame, leaf and fur, crests
// along the spine, and the five mythic crowns.

import { ball, loft, shard, sheet, tuft, TAPER } from './shape.js'
import { bump, dice, horn, hornPaint, ruff, sm } from './parts.js'
import { addPos, addRot } from './rig.js'

const RAD = Math.PI / 180
export const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Paint for flame: deep at the root, hot at the tip, glowing all the way. */
export function flamePaint(coat, { root = 'flameDeep', tip = 'hot', glow = 1 } = {}) {
  const T = coat.T
  const a = T[root] || T.accent
  const m = T.accent
  const b = T[tip] || T.hot
  const g = coat.S.glow ?? 1
  return (u, v, p, ink) => {
    if (u < 0.5) ink.copy(a).lerp(m, sm(0.05, 0.5, u))
    else ink.copy(m).lerp(b, sm(0.6, 1, u))
    ink.glow = (0.3 + 0.7 * Math.pow(u, 1.3)) * glow * g
  }
}

/** Paint for fur that smoulders: the coat's colour at the root, glowing embers at the tips. */
export function emberPaint(coat, { root = 'top', mid = 'side', glow = 1 } = {}) {
  const T = coat.T
  const a = T[root]
  const m = T[mid]
  const g = coat.S.glow ?? 1
  return (u, v, p, ink) => {
    ink.copy(a).lerp(m, sm(0.05, 0.45, u)).lerp(T.accent, sm(0.45, 0.85, u)).lerp(T.hot, sm(0.82, 1, u) * 0.7)
    ink.glow = sm(0.5, 1, u) * 0.85 * glow * g
  }
}

/** Paint for a leaf or petal: `a` at the root to `b` at the tip, with a glowing edge or vein. */
export function leafPaint(coat, { a = 'leaf', b = 'leafTip', glow = 0.5, vein = 0 } = {}) {
  const T = coat.T
  const ca = T[a] || T.side
  const cb = T[b] || T.accent
  const g = coat.S.glow ?? 1
  return (u, v, p, ink) => {
    ink.copy(ca).lerp(cb, sm(0.2, 1, u))
    const edge = sm(0.18, 0.25, Math.abs(Math.sin(v * Math.PI * 2)))
    const mid = vein ? (1 - sm(0.02, 0.09, Math.min(v, 1 - v))) * sm(0.1, 0.4, u) * vein : 0
    ink.glow = (sm(0.55, 1, u) * glow + mid * 0.5) * g * (0.6 + 0.4 * edge)
  }
}

/**
 * A rounded armour shell lying on the body: `at` is its middle, `normal` the way it
 * faces out, `along` its long direction. It is a flattened pebble.
 */
export function shell(body, { at, normal, along, len, wide, thick, bone, paint, material = 'hard', curl = 0.25 }) {
  const n = norm3(normal)
  let a = norm3(add3(along, n, -dot3(along, n)))
  const pts = []
  for (let k = 0; k < 5; k++) {
    const t = k / 4 - 0.5
    const w = Math.cos(t * Math.PI * 0.92)
    // The ends curl in towards the body, so the shell hugs it.
    const p = add3(add3(at, a, t * len), n, -Math.abs(t) * Math.abs(t) * len * curl)
    pts.push({ p, r: [Math.max(0.004, wide * (0.35 + 0.65 * w)), Math.max(0.003, thick * (0.4 + 0.6 * w)), Math.max(0.003, thick * 0.5 * (0.4 + 0.6 * w))] })
  }
  body.add(material, loft({ points: pts, bone, radial: 16, span: 3, up: n, sq: 2.3, paint, uv: [1, 1] }))
}

/** Armour paint: a dark glossy plate with a pale rim and, on later forms, a glowing seam or gold edge. */
export function platePaint(coat, { tone = 'plate', rim = 'plateRim', seam = 0 } = {}) {
  const T = coat.T
  const base = T[tone] || T.dark
  const edge = T[rim] || T.side
  const gild = coat.S.gild ?? 0
  const g = coat.S.glow ?? 1
  return (u, v, p, ink) => {
    // u along the plate; v round it (0 on top). The rim is where the shell turns under.
    const side = Math.abs(Math.cos(v * Math.PI * 2))
    const lip = 1 - sm(0.2, 0.55, side)
    ink.copy(base).lerp(edge, lip * 0.6)
    ink.glow = 0
    if (gild) {
      ink.lerp(T.gold, lip * gild)
      ink.glow = lip * gild * 0.4
    }
    if (seam) {
      const line = bump(u, 0.5, 0.08) * sm(0.6, 0.95, side)
      ink.lerp(T.accent, line * seam)
      ink.glow = Math.max(ink.glow, line * seam * g)
    }
  }
}

/**
 * A fan fin or frill: a smooth membrane carried by `ribs` (each a list of points from the
 * root outwards), all on one bone or a bone per rib. Ribs are drawn as thin spines in `hard`.
 */
export function fan(body, coat, { ribs, bones, paint, ribPaint = null, ribRadius = 0, sag = 0.05, detail = 5 }) {
  const rows = []
  const len = ribs[0].length
  for (let k = 0; k < len; k++) rows.push(ribs.map((rib, i) => ({ p: rib[k], bone: Array.isArray(bones) ? bones[i] : bones })))
  body.add('fin', sheet(rows, { paint, detail, sag, uv: [1, 1] }))
  if (ribRadius > 0) {
    ribs.forEach((rib, i) => {
      body.add('hard', loft({ points: rib.map((p, k) => ({ p, r: ribRadius * (1 - (k / (len - 1)) * 0.85) })), bone: Array.isArray(bones) ? bones[i] : bones, radial: 6, span: 3, capStart: 'flat', capEnd: 'round', paint: ribPaint || coat.flat('horn') }))
    })
  }
}

/** Fin paint: the body's colour at the root, the accent at the edge, glowing along the rim and in streaks. */
export function finPaint(coat, { root = 'fin', edge = 'finEdge', glow = 0.8, streaks = 5 } = {}) {
  const T = coat.T
  const a = T[root] || T.side
  const b = T[edge] || T.accent
  const g = coat.S.glow ?? 1
  return (u, v, p, ink) => {
    // u across the ribs, v from the root (0) to the edge (1).
    ink.copy(a).lerp(b, sm(0.35, 1, v))
    const streak = streaks ? Math.pow(Math.abs(Math.cos(u * Math.PI * streaks)), 8) * sm(0.2, 0.8, v) : 0
    ink.lerp(T.hot, streak * 0.25)
    ink.glow = (sm(0.7, 1, v) * 0.9 + streak * 0.35) * glow * g
  }
}

/** A lightning bolt: a flat zigzag, as a glowing loft. */
export function bolt(body, { base, dir, side, len, width, bone, paint, material = 'flame' }) {
  const d = norm3(dir)
  const s = norm3(side)
  const pts = []
  const zig = [0, 0.32, -0.22, 0.28, -0.08]
  for (let k = 0; k < 5; k++) {
    const t = k / 4
    pts.push({ p: add3(add3(base, d, t * len), s, zig[k] * width * 2.2), r: [Math.max(0.004, width * (1 - t * 0.85)), Math.max(0.003, width * 0.32 * (1 - t * 0.8))] })
  }
  body.add(material, loft({ points: pts, bone, radial: 6, span: 2, up: cross3(d, s), capStart: 'round', capEnd: 'round', paint }))
}

/** A flower: a ring of petals round a glowing heart. `normal` is the way it opens. */
export function flower(body, coat, { at, normal, size, bone, petals = 5, paint, heart = 'hot', open = 55, material = 'hide', seed = 1 }) {
  const n = norm3(normal)
  const u = norm3(cross3(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]))
  const w = cross3(n, u)
  for (let i = 0; i < petals; i++) {
    const a = ((i + dice(seed, 3) * 0.5) / petals) * Math.PI * 2
    const out = norm3(add3([u[0] * Math.cos(a), u[1] * Math.cos(a), u[2] * Math.cos(a)], w, Math.sin(a)))
    const o = open * RAD
    const dir = norm3(add3([out[0] * Math.sin(o), out[1] * Math.sin(o), out[2] * Math.sin(o)], n, Math.cos(o)))
    body.add(material, tuft({ base: add3(at, dir, size * 0.05), tip: add3(at, dir, size), bend: add3([0, 0, 0], n, -size * 0.12), width: size * 0.34, thick: size * 0.08, bone, face: norm3(add3(n, out, -0.4)), radial: 7, span: 2, taper: TAPER.petal, capEnd: 'round', paint }))
  }
  body.add(material, ball({ at: add3(at, n, size * 0.08), r: size * 0.2, bone, paint: coat.flat(heart, 1.1 * (coat.S.glow ?? 1)), around: 10, rings: 6 }))
}

/**
 * Antlers: a beam that sweeps up, out and back, with tines along it. Returns the tips,
 * for leaves and flowers. `size` 0..1+ grows them from velvet nubs to a full rack.
 */
export function antlers(body, coat, head, { size, tines = 3, bone, spread = 1, radius = 0.1, paint = null }) {
  const { Q, D, hs } = head
  const tips = []
  const fn = paint || hornPaint(coat)
  for (const side of [1, -1]) {
    const base = Q(-0.02, 0.4, 0.2 * side)
    const len = hs * (0.35 + 1.25 * size)
    const beam = []
    let p = base
    const steps = 6
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      beam.push(p)
      const dir = norm3(D(-0.35 + 0.75 * t * t, 1 - 0.55 * t, side * (0.55 + 0.25 * spread - 0.4 * t)))
      p = add3(p, dir, len / steps)
    }
    const r0 = hs * radius * (0.7 + 0.5 * size)
    body.add('hard', loft({ points: beam.map((q, k) => ({ p: q, r: r0 * (1 - (k / steps) * 0.75) })), bone, radial: 10, span: 3, capStart: 'flat', capEnd: 'round', paint: fn, uv: [1, 1] }))
    tips.push(beam[steps])
    for (let i = 0; i < tines; i++) {
      const at = 0.28 + (i / Math.max(1, tines)) * 0.62
      const k = Math.min(steps - 1, Math.floor(at * steps))
      const from = mix3(beam[k], beam[k + 1], at * steps - k)
      const tl = len * (0.42 - i * 0.06)
      const fwd = i % 2 === 0
      const end = horn(body, coat, { base: from, dir: D(fwd ? 0.85 : -0.3, 0.6, side * 0.25), to: D(fwd ? 0.3 : -0.5, 1, side * 0.1), length: tl, radius: r0 * (0.62 - i * 0.06), bone, curl: 1, radial: 8, steps: 4, paint: fn, tipSize: 0.2 })
      tips.push(end)
    }
  }
  return tips
}

/** Horns that sweep back from the brow, curving up at the ends. Returns their tips. */
export function sweptHorns(body, coat, head, { size, bone, radius = 0.09, at = [-0.02, 0.36, 0.24], up = 0.55, out = 0.4, ridges = 0, glowTip = 0 }) {
  const { Q, D, hs } = head
  const tips = []
  for (const side of [1, -1]) {
    tips.push(
      horn(body, coat, {
        base: Q(at[0], at[1], at[2] * side),
        dir: D(-0.6, up, side * out),
        to: D(-1, up * 0.7 + 0.3, side * out * 0.4),
        length: hs * size,
        radius: hs * radius * (0.6 + 0.4 * Math.min(1.4, size)),
        bone,
        curl: 1,
        ridges,
        paint: hornPaint(coat, { glowTip }),
      }),
    )
  }
  return tips
}

/** Ram horns: a thick ridged curl that comes back, down and forward round each ear. */
export function ramHorns(body, coat, head, { size, bone, turns = 0.85, glowTip = 0 }) {
  const { Q, D, hs } = head
  const tips = []
  for (const side of [1, -1]) {
    const pts = []
    const n = 12
    const R = hs * 0.34 * size
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const a = t * Math.PI * 2 * turns
      // A spiral: back over the ear, down behind it, forward under it, widening outwards.
      const f = -0.05 - Math.sin(a) * (R / hs) * (1 - t * 0.35)
      const u = 0.34 + (Math.cos(a) - 1) * (R / hs) * 0.85 * (1 - t * 0.3) + 0.1
      const z = (0.3 + t * 0.32 * size) * side
      pts.push({ p: Q(f, u, z), r: hs * 0.14 * size * (1 - t * 0.78) + hs * 0.012 })
    }
    body.add('hard', loft({ points: pts, bone, radial: 12, span: 3, capStart: 'flat', capEnd: 'round', paint: hornPaint(coat, { glowTip }), shape: (u) => 1 + 0.06 * Math.sin(u * 34) * (1 - sm(0.75, 0.95, u)), uv: [1, 1] }))
    tips.push(pts[n].p)
    void D
  }
  return tips
}

/**
 * A row of tufts down a spine, sampled from a body's rails: `rails` is what `rails()` returned for the
 * torso (or tail), `from`/`to` the stretch of it (0..1), `count` how many, `size(t)` their size.
 */
export function spinePoints(rl, { from, to, count, size = () => 1, v = 0, lift = 0 }) {
  const pts = []
  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * (i + 0.5)) / count
    const hit = rl.at(t, v)
    const ring = hit.ring
    const bone = ring.w < 0.5 ? ring.boneA : ring.boneB
    const back = [-ring.tan.x, -ring.tan.y, -ring.tan.z]
    pts.push({ p: add3(hit.p.toArray(), hit.d.toArray(), lift), up: hit.d.toArray(), back, bone, s: size(t, i), t })
  }
  return pts
}

/**
 * The mythic crowns, one per aspect: a halo of flame, a blossoming crown, floating crystal shards,
 * a crest of lightning feathers, a pearl-and-fin diadem. They sit on a `crown` bone on the head
 * that the body plan's living motion turns and bobs.
 */
export function crown(body, S, coat, head, { kind, size = 1, lift = 0 }) {
  const { Q, D, hs, fwd } = head
  const at = Q(-0.18, 0.62 + lift)
  const centre = Q(-0.32, 0.3 + lift)
  // The flame halo turns about its own middle; everything else about the top of the head.
  body.bone('crown', 'head', kind === 'flame' ? centre : at)
  const bone = body.b('crown')
  const glow = S.glow ?? 1
  if (kind === 'flame') {
    // A ring of flame tongues standing round the back of the head, like the rays of a sun.
    ruff(body, { material: 'flame', centre, axis: [-fwd[0], -fwd[1], 0], up: head.up, radius: hs * 0.55 * size, count: 13, from: -118, to: 118, len: hs * 0.62 * size, width: hs * 0.15 * size, thick: hs * 0.05, lean: -8, bone, paint: flamePaint(coat, { root: 'accent', tip: 'hot', glow: 1.15 }), taper: TAPER.flame, jitter: 0.3, seed: 5, radial: 7, bow: 0.1 })
    // A ring of gold under the flames.
    const ringPts = []
    for (let i = 0; i <= 24; i++) {
      const a = (-125 + (250 * i) / 24) * RAD
      ringPts.push({ p: add3(centre, add3([0, 0, Math.sin(a)], head.up, Math.cos(a)), hs * 0.55 * size), r: hs * 0.035 })
    }
    body.add('hard', loft({ points: ringPts, bone, radial: 8, span: 2, paint: coat.flat('gold', 0.5 * glow) }))
  } else if (kind === 'bloom') {
    // Flowers round the brow, and a big one in the middle.
    for (let i = 0; i < 5; i++) {
      const a = (-60 + i * 30) * RAD
      const p = Q(-0.05 + Math.cos(a) * 0.05, 0.5 + lift + Math.cos(a) * 0.08, Math.sin(a) * 0.42)
      flower(body, coat, { at: p, normal: norm3(D(0.2, 1, Math.sin(a) * 0.9)), size: hs * (i === 2 ? 0.3 : 0.2) * size, bone, petals: i === 2 ? 7 : 5, paint: leafPaint(coat, { a: 'petal', b: 'petalTip', glow: 0.9 }), seed: i + 1 })
    }
  } else if (kind === 'shards') {
    // Crystals that float above the head in a slow ring.
    const n = 7
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const r = hs * 0.52 * size
      const base = add3(at, [Math.cos(a) * r, 0.04 * Math.sin(a * 3) * hs, Math.sin(a) * r])
      const tall = hs * (0.34 + 0.12 * (i % 2)) * size
      body.add('crystal', shardOf(base, add3(base, norm3([Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25]), tall), tall * 0.24, bone, coat, i))
    }
    body.add('crystal', shardOf(add3(at, [0, hs * 0.08, 0]), add3(at, [0, hs * 0.08 + hs * 0.55 * size, 0]), hs * 0.15 * size, bone, coat, 9))
  } else if (kind === 'bolts') {
    // A crest of lightning feathers sweeping back from the brow.
    for (let i = 0; i < 7; i++) {
      const k = i - 3
      const base = Q(0.05 - Math.abs(k) * 0.07, 0.42 + lift - Math.abs(k) * 0.03, k * 0.11)
      bolt(body, { base, dir: norm3(D(-0.55 - Math.abs(k) * 0.08, 1 - Math.abs(k) * 0.12, k * 0.22)), side: [0, 0, 1], len: hs * (0.72 - Math.abs(k) * 0.1) * size, width: hs * 0.075 * size, bone, paint: flamePaint(coat, { root: 'accent', tip: 'hot', glow: 1.2 }) })
    }
  } else if (kind === 'pearl') {
    // Fins fanning up from the brow, beaded with pearls, and one great pearl on the forehead.
    for (const side of [1, -1]) {
      const ribs = []
      for (let r = 0; r < 4; r++) {
        const a = (14 + r * 22) * RAD
        const root = Q(0.12 - r * 0.07, 0.4 + lift, 0.1 * side)
        const dir = norm3(D(-0.35 - r * 0.25, Math.cos(a), side * Math.sin(a)))
        const len = hs * (0.62 - r * 0.06) * size
        ribs.push([root, add3(root, dir, len * 0.5), add3(add3(root, dir, len), D(-0.1, 0, 0), len * 0.3)])
      }
      fan(body, coat, { ribs, bones: bone, paint: finPaint(coat, { root: 'crownFin', edge: 'finEdge', glow: 1.1, streaks: 4 }), ribRadius: hs * 0.02, ribPaint: coat.flat('gold', 0.45 * glow) })
      for (const rib of ribs) body.add('hard', ball({ at: rib[2], r: hs * 0.045 * size, bone, paint: coat.flat('pearl', 0.35 * glow), around: 10, rings: 7 }))
    }
    body.add('hard', ball({ at: Q(0.22, 0.42 + lift), r: hs * 0.11 * size, bone, paint: coat.flat('pearl', 0.5 * glow), around: 14, rings: 10 }))
    const band = []
    for (let i = 0; i <= 12; i++) {
      const a = (-70 + (140 * i) / 12) * RAD
      band.push({ p: Q(0.2 - (1 - Math.cos(a)) * 0.25, 0.37 + lift, Math.sin(a) * 0.42), r: hs * 0.03 })
    }
    body.add('hard', loft({ points: band, bone, radial: 8, span: 2, paint: coat.flat('gold', 0.4 * glow) }))
  }
  return bone
}

/** The crown's own life: shards circle and bob, a flame halo sways, the rest breathe. */
export function crownAlive(pose, t, kind) {
  if (kind === 'shards') {
    addRot(pose, 'crown', 0, (t * 24) % 360, 0)
    addPos(pose, 'crown', 0, Math.sin(t * 1.4) * 0.035, 0)
  } else if (kind === 'flame') {
    addRot(pose, 'crown', Math.sin(t * 0.9) * 5, 0, Math.sin(t * 1.3) * 2)
  } else {
    addPos(pose, 'crown', 0, Math.sin(t * 1.1) * 0.006, 0)
  }
}

function shardOf(base, tip, radius, bone, coat, seed) {
  return shard({ base, tip, radius, bone, sides: 6, twist: dice(seed, 2) * 2, paint: crystalTone(coat) })
}
function crystalTone(coat) {
  const T = coat.T
  const a = T.crystalDeep || T.accent
  const b = T.crystal || T.hot
  const g = coat.S.glow ?? 1
  return (t, v, p, ink) => {
    ink.copy(a).lerp(b, sm(0.1, 0.95, t))
    ink.glow = (0.35 + 0.65 * t) * g
  }
}
