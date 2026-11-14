// Shared pieces every body plan uses: the coat (colour and markings), the head
// with its eyes, lids, mouth, teeth, ears and nose, paws and hooves, manes,
// crests, crystals, horns and crowns, the living face, and the leg solver that
// keeps feet planted.

import * as THREE from 'three'
import { ball, lens, lid, loft, rails, shard, tuft, TAPER } from './shape.js'
import { addRot, channel } from './rig.js'

export const sm = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** A smooth hump: 1 at `centre`, 0 beyond `width` either side. */
export const bump = (x, centre, width) => {
  const d = (x - centre) / width
  return d * d >= 1 ? 0 : (1 - d * d) * (1 - d * d)
}
const RAD = Math.PI / 180
const DOWN = [0, -1, 0]
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** A repeatable number in 0..1 from an index. */
export const dice = (i, seed = 1) => {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453
  return x - Math.floor(x)
}

// ----- The coat ------------------------------------------------------------------

/**
 * The colours of a beast. `S.tones` names them: `top`, `side` and `belly` shade
 * the body from back to underside; everything else (dark, mark, accent, horn,
 * claw, nose, mouth…) is for the line's own markings, which `S.marks(c)` paints
 * on top, part by part. `c` is { part, u, v, p, d, lift, h, k, side, ink, T, S }:
 *   u along the part, v around it, p the position, d the way the skin faces,
 *   lift +1 on the back to -1 on the belly, h the place on the head
 *   [forward, up, out] in head lengths, k a number the part passes (an index).
 */
export class Coat {
  constructor(S) {
    this.S = S
    const T = (this.T = {})
    for (const name in S.tones) T[name] = new THREE.Color(S.tones[name])
    T.side ||= T.top.clone()
    T.belly ||= T.side.clone()
    T.dark ||= T.top.clone().multiplyScalar(0.45)
    T.accent ||= new THREE.Color('#ffffff')
    T.hot ||= T.accent.clone().lerp(new THREE.Color('#ffffff'), 0.55)
    T.mouth ||= new THREE.Color('#7c1f33')
    T.tongue ||= new THREE.Color('#f08a9c')
    T.tooth ||= new THREE.Color('#fff7e6')
    T.nose ||= new THREE.Color('#2a1d20')
    T.horn ||= T.dark.clone()
    T.hornTip ||= T.horn.clone().lerp(new THREE.Color('#ffffff'), 0.35)
    T.claw ||= T.horn.clone()
    T.lid ||= T.side.clone().multiplyScalar(0.84)
    T.lash ||= new THREE.Color('#15101a')
    T.ear ||= T.belly.clone()
    T.gold ||= new THREE.Color('#ffc94d')
    this.bellyLine = S.bellyLine ?? -0.3
    this.backLine = S.backLine ?? 0.4
  }

  c(tone) {
    return tone instanceof THREE.Color ? tone : this.T[tone] || (this.T[tone] = new THREE.Color(tone))
  }

  /**
   * The paint for one named part.
   * `belly` is the way the underside faces (down for most parts, forward for an upright chest);
   * `by: 'v'` shades round the section instead (serpents); `base` forces one tone.
   */
  part(name, { belly = DOWN, by = null, base = null, frame = null, side = 0, k = 0, after = null } = {}) {
    const { T, S } = this
    const ctx = { part: name, u: 0, v: 0, p: null, d: null, lift: 0, h: frame ? [0, 0, 0] : null, k, side, ink: null, T, S }
    const fixed = base ? this.c(base) : null
    const low = this.bellyLine
    const high = this.backLine
    return (u, v, p, ink, d) => {
      const lift = by === 'v' ? Math.cos(v * Math.PI * 2) : -(d.x * belly[0] + d.y * belly[1] + d.z * belly[2])
      if (fixed) ink.copy(fixed)
      else ink.copy(T.belly).lerp(T.side, sm(low - 0.2, low + 0.2, lift)).lerp(T.top, sm(high - 0.25, high + 0.25, lift))
      ctx.u = u
      ctx.v = v
      ctx.p = p
      ctx.d = d
      ctx.lift = lift
      ctx.ink = ink
      if (frame) frame(p, ctx.h)
      if (S.marks) S.marks(ctx)
      if (after) after(ctx)
    }
  }

  /** One flat colour. */
  flat(tone, glow = 0) {
    const c = this.c(tone)
    return (u, v, p, ink) => {
      ink.copy(c)
      ink.glow = glow
    }
  }

  /** A colour that runs from `a` at the root to `b` at the tip, with glow from `glow[0]` to `glow[1]`. */
  ramp(a, b, { glow = [0, 0], from = 0.15, to = 0.9, mid = null } = {}) {
    const ca = this.c(a)
    const cb = this.c(b)
    const cm = mid ? this.c(mid) : null
    return (u, v, p, ink) => {
      const t = sm(from, to, u)
      if (cm) {
        if (t < 0.5) ink.copy(ca).lerp(cm, t * 2)
        else ink.copy(cm).lerp(cb, t * 2 - 1)
      } else ink.copy(ca).lerp(cb, t)
      ink.glow = glow[0] + (glow[1] - glow[0]) * t
    }
  }
}

// ----- Small solids ----------------------------------------------------------------

/** A tapering spike with a soft tip: a tooth, a claw, a thorn, a horn nub. */
export function spike({ base, tip, radius, bend = [0, 0, 0], bone, radial = 7, span = 2, paint = null, squash = 1, blunt = 0.16, up = [0.02, 1, 0.03], capStart = 'flat' }) {
  const mid = add3(mix3(base, tip, 0.5), bend)
  const q = add3(mix3(base, mid, 0.5), bend, 0.25)
  const s = mix3(mid, tip, 0.55)
  const points = [
    { p: base, r: [radius, radius * squash] },
    { p: q, r: [radius * 0.84, radius * 0.84 * squash] },
    { p: mid, r: [radius * 0.62, radius * 0.62 * squash] },
    { p: s, r: [radius * 0.36, radius * 0.36 * squash] },
    { p: tip, r: [radius * blunt, radius * blunt * squash] },
  ]
  return loft({ points, bone, radial, span, capStart, capEnd: 'round', paint, up, uv: [1, 1] })
}

/** A curved horn from `base`: it starts along `dir` and bends towards `to` as it grows. Ridged like a ram's or a stag's. */
export function horn(body, coat, { base, dir, to, length, radius, bone, curl = 1, ridges = 0, radial = 10, steps = 6, paint = null, material = 'hard', squash = 1, tipSize = 0.1 }) {
  const points = []
  let p = base
  const a = norm3(dir)
  const b = norm3(to)
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    points.push({ p, r: [radius * (1 - t * (1 - tipSize)) * (k === 0 ? 1.05 : 1), radius * squash * (1 - t * (1 - tipSize))] })
    const d = norm3(mix3(a, b, Math.min(1, (t + 0.5 / steps) * curl)))
    p = add3(p, d, length / steps)
  }
  const tipAt = points[points.length - 1].p
  const fn = paint || hornPaint(coat)
  body.add(
    material,
    loft({
      points,
      bone,
      radial,
      span: 3,
      capStart: 'flat',
      capEnd: 'round',
      paint: fn,
      up: [0.05, 0.3, 1],
      shape: ridges ? (u) => 1 + 0.07 * Math.sin(u * ridges * Math.PI * 2) * (1 - sm(0.7, 0.95, u)) : null,
      uv: [1, 1],
    }),
  )
  return tipAt
}

/** Horn colour: dark at the root, pale at the tip; gilded forms wear gold bands and a glowing gold tip. */
export function hornPaint(coat, { glowTip = 0 } = {}) {
  const { T, S } = coat
  const gild = S.gild ?? 0
  return (u, v, p, ink) => {
    ink.copy(T.horn).lerp(T.hornTip, sm(0.25, 1, u))
    ink.glow = 0
    if (gild) {
      const band = Math.max(bump(u, 0.24, 0.05), sm(0.74, 0.88, u))
      ink.lerp(T.gold, band * gild)
      ink.glow = band * gild * 0.55
    }
    if (glowTip) {
      const g = sm(0.6, 1, u) * glowTip
      ink.lerp(T.accent, g * 0.8)
      ink.glow = Math.max(ink.glow, g)
    }
  }
}

/** Claw and hoof colour: dark horn, or gold for a mythic. */
function clawPaint(coat) {
  const { T, S } = coat
  const gild = S.gild ?? 0
  return (u, v, p, ink) => {
    ink.copy(T.claw)
    ink.glow = 0
    if (gild) {
      ink.lerp(T.gold, gild * 0.9)
      ink.glow = gild * 0.45
    }
  }
}

// ----- The head --------------------------------------------------------------------

/**
 * Builds a head on the `head` bone: a rounded skull that narrows to a muzzle,
 * a hinged lower jaw, the inside of the mouth, teeth, a nose, eyes with lids
 * on their own bones, and ears. `frame` = { o: [x, y], a } places it: `o` is
 * where the skull meets the neck and `a` the angle its nose points at.
 * All of `S.face` is in head lengths (`S.head` metres).
 * Returns places on the head for horns and crests to grow from.
 */
export function buildHead(body, S, coat, frame) {
  const hs = S.head
  const F = S.face
  const m = F.muzzle
  const { T } = coat
  const B = (n) => body.b(n)
  const head = B('head')
  const fwd = [Math.cos(frame.a), Math.sin(frame.a), 0]
  const up = [-Math.sin(frame.a), Math.cos(frame.a), 0]
  const out = [0, 0, 1]
  /** Head lengths (forward, up, out) → the beast's rest space. */
  const Q = (f, u, z = 0) => [frame.o[0] + (fwd[0] * f + up[0] * u) * hs, frame.o[1] + (fwd[1] * f + up[1] * u) * hs, z * hs]
  const toHead = (p, h) => {
    const x = p.x - frame.o[0]
    const y = p.y - frame.o[1]
    h[0] = (x * fwd[0] + y * fwd[1]) / hs
    h[1] = (x * up[0] + y * up[1]) / hs
    h[2] = p.z / hs
  }
  /** A direction given as (forward, up, out) → rest space. */
  const D = (f, u, z) => [fwd[0] * f + up[0] * u, fwd[1] * f + up[1] * u, z]

  // ----- Skull and muzzle: one skin, from the back of the head to the nose.
  const W = F.wide ?? 1
  const Tl = F.tall ?? 1
  const back = F.back ?? 1
  const stop = F.stop ?? 0.46
  const tipF = stop + m.len
  const fw = F.face ?? 1
  const stations = [
    { f: -0.42 * back, c: 0.05, r: [0.27 * W, 0.28 * Tl, 0.25] },
    { f: -0.2 * back, c: 0.09, r: [0.45 * W, 0.43 * Tl, 0.38] },
    { f: 0.06, c: 0.11, r: [0.52 * W, 0.47 * Tl, 0.42] },
    { f: 0.3, c: 0.07, r: [0.47 * W * fw, 0.39 * Tl, 0.36] },
    // The muzzle is widest where it leaves the face and tapers to the nose, like a soft wedge.
    { f: stop, c: -m.drop * 0.45, r: [Math.max(m.wide * 1.3, (F.stopWide ?? 0.34) * W * fw), m.up * 1.12, m.down * 1.08], sq: (m.sq + 2) / 2 },
    { f: stop + m.len * 0.55, c: -m.drop * 0.85, r: [m.wide * 1.04, m.up, m.down], sq: m.sq },
    { f: tipF, c: -m.drop, r: [m.wide * m.taper, m.up * m.taper * 0.92, m.down * 0.94], sq: m.sq },
  ]
  const last = stations.length - 1
  const tOf = (f) => {
    for (let i = 0; i < last; i++) {
      if (f <= stations[i + 1].f || i === last - 1) return (i + Math.min(1, Math.max(0, (f - stations[i].f) / (stations[i + 1].f - stations[i].f)))) / last
    }
    return 1
  }
  const tCheek = tOf(0.2)
  const tBrow = tOf(F.eye.f)
  const tPads = tOf(stop + m.len * 0.3)
  const tMouth = [tOf(stop - 0.1), tOf(stop + 0.04)]
  const cheek = F.cheek ?? 0
  const pads = m.pads ?? 0
  const brow = F.brow ?? 0
  const browV = F.eye.ang / 360 - 0.07
  const shape = (u, v) => {
    let k = 1
    if (cheek) k += cheek * (bump(v, 0.32, 0.13) + bump(v, 0.68, 0.13)) * bump(u, tCheek, 0.2)
    if (pads) {
      const front = sm(tPads, 1, u)
      k += pads * front * (0.1 * (bump(v, 0.36, 0.11) + bump(v, 0.64, 0.11)) - 0.03 * bump(v, 0.5, 0.05))
    }
    if (brow) k += brow * 0.12 * (bump(v, browV, 0.075) + bump(v, 1 - browV, 0.075)) * bump(u, tBrow, 0.09)
    return k
  }
  const skullSpec = {
    points: stations.map((s) => ({ p: Q(s.f, s.c), r: s.r.map((x) => x * hs), sq: s.sq ?? 2 })),
    bone: head,
    span: 6,
    up,
    shape,
    capStart: 'round',
    capEnd: 'round',
  }
  const skull = rails(skullSpec)
  const mouthLine = (c) => {
    // The roof of the mouth: dark under the muzzle, inside the lip line.
    const under = sm(tMouth[0], tMouth[1], c.u) * (1 - sm(0.1, 0.15, Math.abs(c.v - 0.5)))
    if (under > 0) {
      c.ink.lerp(T.mouth, under)
      c.ink.glow *= 1 - under
    }
  }
  body.add('hide', loft({ ...skullSpec, rails: skull, radial: 30, paint: coat.part('head', { frame: toHead, after: mouthLine }), uv: [2.2, 3], capLength: [0.9, m.blunt ?? 0.75] }), { outer: true })

  /** A place on the skull: `f` head lengths forward, `ang` degrees down from the crown, on one side. */
  const on = (f, ang, side = 1) => {
    const hit = skull.at(tOf(f), side > 0 ? ang / 360 : 1 - ang / 360)
    return { p: hit.p.toArray(), d: hit.d.toArray() }
  }

  // ----- Lower jaw, hinged under the eye.
  const hinge = Q(0.1, -0.2)
  body.bone('jaw', 'head', hinge)
  const jaw = B('jaw')
  const J = F.jaw ?? {}
  const jw = J.wide ?? 0.84
  const jl = J.len ?? 0.93
  const chin = (J.deep ?? 0.08) + m.down * 0.18
  const lipY = (f) => {
    // The top of the jaw: a little way up inside the muzzle, so the upper lip overlaps it.
    const k = sm(stop, tipF, f)
    return -m.drop * (0.5 + 0.5 * k) - m.down * 0.52
  }
  const jawTop = 0.05
  const jawPts = [
    { f: 0.0, c: lipY(stop) - 0.02, r: [0.38 * W, 0.06, 0.1] },
    { f: stop - 0.12, c: lipY(stop) - 0.01, r: [Math.max(m.wide * 1.1, 0.34 * W) * jw, jawTop, m.down * 0.5 + chin], sq: 2.3 },
    { f: stop + m.len * 0.5, c: lipY(stop + m.len * 0.5), r: [m.wide * jw, jawTop, m.down * 0.5 + chin], sq: m.sq },
    { f: stop + m.len * jl, c: lipY(tipF), r: [m.wide * m.taper * jw * 0.94, jawTop * 0.9, m.down * 0.46 + chin * 0.8], sq: m.sq },
  ]
  const jawPaint = coat.part('jaw', {
    frame: toHead,
    after: (c) => {
      // The floor of the mouth.
      const inside = 1 - sm(0.12, 0.19, Math.min(c.v, 1 - c.v))
      if (inside > 0) {
        c.ink.lerp(T.mouth, inside)
        c.ink.glow *= 1 - inside
      }
    },
  })
  body.add('hide', loft({ points: jawPts.map((s) => ({ p: Q(s.f, s.c), r: s.r.map((x) => x * hs), sq: s.sq ?? 2 })), bone: jaw, radial: 20, span: 5, up, paint: jawPaint, uv: [2.2, 3], capLength: [0.9, 0.7] }))

  // The dark of the throat (it stays with the skull) and the tongue (it goes with the jaw).
  body.add('hard', ball({ at: Q(stop + m.len * 0.16, lipY(stop) - m.down * 0.2), r: [Math.min(m.len * 0.5 + 0.1, m.len * 0.8) * hs, m.down * 0.6 * hs, m.wide * 0.8 * hs], bone: head, paint: coat.flat('mouth'), around: 10, rings: 6, axes: [fwd, up, out] }))
  body.add(
    'hard',
    loft({
      points: [
        { p: Q(stop - 0.1, lipY(stop) + 0.01), r: [m.wide * 0.5 * hs, 0.03 * hs] },
        { p: Q(stop + m.len * 0.45, lipY(stop + m.len * 0.45) + 0.03), r: [m.wide * 0.5 * hs, 0.034 * hs] },
        { p: Q(stop + m.len * 0.8, lipY(tipF) + 0.035), r: [m.wide * m.taper * 0.42 * hs, 0.028 * hs] },
      ],
      bone: jaw,
      radial: 10,
      span: 3,
      up,
      paint: coat.flat('tongue'),
      uv: [1, 1],
    }),
  )

  // ----- Teeth: two fangs above, two below, and a few small ones that show when it roars.
  const K = F.teeth ?? {}
  const tooth = coat.flat('tooth')
  const fang = K.fang ?? 0
  const rowY = (f) => lipY(f) + 0.03
  /** Half the width of the muzzle at `f`, in head lengths. */
  const muzzleWide = (f) => {
    const k = Math.min(1, Math.max(0, (f - stop) / m.len))
    return m.wide * (k < 0.55 ? 1.14 - 0.14 * (k / 0.55) : 1 + (m.taper - 1) * ((k - 0.55) / 0.45))
  }
  for (const side of [1, -1]) {
    if (fang > 0.01) {
      // Upper fangs come down over the lower lip, so they show with the mouth shut.
      const f = stop + m.len * (K.at ?? 0.72)
      const z = muzzleWide(f) * (K.spread ?? 0.9) * side
      body.add('hard', spike({ base: Q(f, rowY(f) + 0.05, z), tip: Q(f + fang * 0.12, rowY(f) - fang, z * 1.03), radius: fang * 0.27 * hs, bend: D(0.02 * hs, 0, 0), bone: head, paint: tooth, radial: 8 }))
    }
    const small = K.row ?? 0
    for (let i = 0; i < small; i++) {
      const f = stop + m.len * (0.56 - i * 0.2)
      const z = muzzleWide(f) * 0.62 * jw * side
      const len = (K.small ?? 0.05) * (1 - i * 0.12)
      body.add('hard', spike({ base: Q(f, rowY(f) + 0.03, z), tip: Q(f, rowY(f) - len, z), radius: len * 0.42 * hs, bone: head, paint: tooth, radial: 6, span: 1 }))
    }
    const lower = K.lower ?? 0
    if (lower > 0.01) {
      // Lower fangs sit inside the upper lip; tusks stand outside it, on a jaw wider than the muzzle.
      const f = stop + m.len * (K.lowerAt ?? 0.56)
      const z = muzzleWide(f) * jw * (K.tusk ? 0.9 : 0.58) * side
      const y = lipY(f)
      body.add('hard', spike({ base: Q(f, y - 0.03, z), tip: Q(f + lower * 0.12, y + lower, z * (K.tusk ? 1.1 : 1)), radius: lower * (K.tusk ? 0.3 : 0.27) * hs, bend: D(K.tusk ? 0.03 * hs : 0, 0, 0), bone: jaw, paint: tooth, radial: 8 }))
    }
  }

  // ----- Nose.
  const N = F.nose ?? {}
  const capOut = Math.min(m.wide * m.taper, (m.up * m.taper * 0.92 + m.down * 0.94) / 2) * (m.blunt ?? 0.75)
  if (N.r) {
    body.add('hard', ball({ at: Q(tipF + capOut * (N.out ?? 0.7), -m.drop + m.up * m.taper * (N.up ?? 0.42)), r: [N.r * 0.8 * hs, N.r * 0.72 * hs, N.r * (N.wide ?? 1.25) * hs], bone: head, paint: coat.flat('nose'), around: 12, rings: 8, axes: [fwd, up, out] }))
  }
  if (N.nostril) {
    for (const side of [1, -1]) {
      body.add('hard', ball({ at: Q(tipF - 0.02, -m.drop + m.up * m.taper * 0.62, m.wide * m.taper * 0.5 * side), r: [N.nostril * 1.3 * hs, N.nostril * 0.7 * hs, N.nostril * hs], bone: head, paint: coat.flat('nose'), around: 8, rings: 6, axes: [fwd, up, out] }))
    }
  }

  // ----- Eyes: a ball set into the skull, an upper and a lower lid on bones of their own.
  const E = F.eye
  const eyes = []
  // The lower lid's rim is only a little darker than the lid: a full lash line there reads as tired eyes.
  const lowLash = T.lid.clone().lerp(T.lash, 0.4)
  for (const side of [1, -1]) {
    const sfx = side === 1 ? 'L' : 'R'
    const spot = on(E.f, E.ang, side)
    const yaw = (E.yaw ?? 35) * RAD
    const pitch = (E.pitch ?? 10) * RAD
    const n = norm3(D(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), side * Math.cos(yaw) * Math.cos(pitch)))
    // Corner to corner: along the head, tilted so the outer corner sits higher.
    let h = norm3(add3(fwd, n, -dot3(fwd, n)))
    h = [h[0] * side, h[1] * side, h[2] * side]
    let t = cross3(n, h)
    const tilt = (E.tilt ?? 0) * RAD
    h = norm3(add3([h[0] * Math.cos(tilt), h[1] * Math.cos(tilt), h[2] * Math.cos(tilt)], t, -side * Math.sin(tilt)))
    t = cross3(n, h)
    const R = E.r * hs
    const r = [R, R * (E.tall ?? 1.1), R * 0.92]
    const centre = add3(spot.p, n, -R * (E.sink ?? 0.7))
    body.add('eye', lens({ centre, n, h, t, r, bone: head, flip: side }))
    body.bone(`lid${sfx}`, 'head', centre, [h, t, n])
    body.bone(`low${sfx}`, 'head', centre, [h, t, n])
    body.add('hide', lid({ centre, n, h, t, r, from: E.open ?? 44, sweep: 128, bone: B(`lid${sfx}`), colour: T.lid, edge: T.lash }))
    body.add('hide', lid({ centre, n, h, t, r, from: E.low ?? -42, sweep: -112, bone: B(`low${sfx}`), colour: T.lid, edge: lowLash, along: 6 }))
    eyes.push({ centre, n, h, t, R, side })
  }

  // ----- Ears.
  const A = F.ear
  if (A && A.kind !== 'none') {
    for (const side of [1, -1]) {
      const sfx = side === 1 ? 'L' : 'R'
      const spot = on(A.f ?? -0.05, A.ang ?? 40, side)
      const lean = (A.out ?? 25) * RAD
      const sweep = (A.back ?? 15) * RAD
      const dir = norm3(D(-Math.sin(sweep), Math.cos(lean) * Math.cos(sweep), side * Math.sin(lean) * Math.cos(sweep)))
      const base = add3(spot.p, dir, -A.len * hs * 0.14)
      const tip = add3(base, dir, A.len * hs)
      body.bone(`ear${sfx}`, 'head', spot.p)
      // The open side of the ear faces forward and out.
      const face = norm3(D(Math.cos((A.turn ?? 30) * RAD), 0, side * Math.sin((A.turn ?? 30) * RAD)))
      const taper = A.kind === 'round' ? [0.74, 1, 1, 0.86, 0.5] : A.kind === 'leaf' ? [0.42, 0.9, 1, 0.72, 0.16] : [0.8, 1, 0.82, 0.52, 0.12]
      body.add(
        'hide',
        tuft({
          base,
          tip,
          bend: add3([0, 0, 0], D(-(A.curl ?? 0.06), 0, side * (A.flare ?? 0.02)), A.len * hs),
          width: A.wide * hs,
          thick: A.wide * hs * (A.thick ?? 0.3),
          bone: B(`ear${sfx}`),
          face,
          radial: 12,
          span: 3,
          taper,
          capEnd: 'round',
          paint: coat.part('ear', { base: 'top', side }),
          uv: [2, 2],
        }),
      )
    }
  }

  const mouth = Q(tipF - 0.04, lipY(tipF) + 0.02)
  body.socket('mouth', 'head', mouth)
  body.socket('head', 'head', Q(0.15, 0.25))
  return { Q, D, on, eyes, skull, tOf, stop, tipF, fwd, up, hs, lipY, crown: Q(0.02, 0.11 + 0.47 * Tl) }
}

/** What the eye material needs from a sheet. */
export function eyeRecipe(S) {
  const E = S.face.eye
  return {
    kind: 'eye',
    eye: {
      iris: E.iris,
      inner: E.inner,
      ring: E.ring,
      white: E.white,
      size: E.size ?? 0.58,
      pupil: E.pupil ?? 0.5,
      slit: Math.round((E.slit ?? 0) * 20) / 20,
      look: E.look ?? [0.08, 0],
      spark: E.spark ?? 1,
      light: 0.2,
      shine: E.shine ?? 0.6,
    },
  }
}

/**
 * The living face, layered over whatever the body is doing: blinks every few
 * seconds, eyes that narrow as Rage builds or a clip scowls, eyes shut when
 * dead, and ears that flick. `L` comes from the sheet: { shut, rise, every, blink, flick }.
 */
export function faceAlive(pose, t, st, L) {
  const dead = st.dead ? 1 : 0
  const rage = st.rage ?? 0
  const shut = channel(pose, 'face', 0)
  const scowl = Math.min(1, channel(pose, 'face', 1) + rage * 0.75 + (1 - (st.calm ?? 1)) * 0.25)
  // Two blink rhythms that drift against each other, so it never looks like clockwork.
  const a = (t % L.every) / L.blink
  const b = ((t * 0.83 + 1.7) % (L.every * 1.37)) / L.blink
  const blink = Math.max(a < 1 ? Math.sin(Math.PI * Math.pow(a, 0.7)) : 0, b < 1 ? Math.sin(Math.PI * Math.pow(b, 0.7)) : 0)
  const closed = Math.max(blink, shut, dead)
  const narrow = scowl * 0.4
  const upper = L.shut * (narrow + (1 - narrow) * closed)
  const lower = -L.rise * Math.max(closed, scowl * 0.7)
  const slant = scowl * (1 - closed) * 13
  addRot(pose, 'lidL', upper, 0, -slant)
  addRot(pose, 'lidR', upper, 0, slant)
  addRot(pose, 'lowL', lower, 0, 0)
  addRot(pose, 'lowR', lower, 0, 0)
  // Ears: a quick flick now and then, and laid back when hurt or furious.
  const back = Math.min(1, channel(pose, 'face', 2) + rage * 0.5 + dead)
  const fa = (t * 1.3) % (L.every * 1.9)
  const fb = (t * 1.3 + 2.2) % (L.every * 2.6)
  const flickL = fa < 0.35 ? Math.sin((fa / 0.35) * Math.PI * 2) : 0
  const flickR = fb < 0.35 ? Math.sin((fb / 0.35) * Math.PI * 2) : 0
  const wag = Math.sin(t * 2.1) * 2 * L.flick
  addRot(pose, 'earL', -flickL * 9 * L.flick - back * 10, 0, back * 30 + flickL * 5 + wag)
  addRot(pose, 'earR', flickR * 9 * L.flick + back * 10, 0, back * 30 + flickR * 5 - wag)
}

/** The numbers `faceAlive` needs, from a sheet. */
export function faceLife(S) {
  const E = S.face.eye
  const open = E.open ?? 44
  const low = E.low ?? -42
  const life = S.life ?? {}
  return {
    shut: open + 26,
    rise: Math.max(0, -26 - low),
    every: life.blinkEvery ?? 3.9,
    blink: life.blink ?? 0.16,
    flick: life.flick ?? 1,
  }
}

// ----- Feet ------------------------------------------------------------------------

/**
 * A big soft paw under an ankle: a rounded pad, toes, and short claws.
 * `ankle` = [x, y, z] in rest space; the paw sits on the ground below and ahead of it.
 */
export function paw(body, coat, bone, { ankle, size, toes = 3, claw = 1, side = 1, part = 'paw', long = 1, back = 0 }) {
  const s = size
  const [x, , z] = ankle
  const paint = coat.part(part, { base: 'side', side })
  body.add(
    'hide',
    loft({
      points: [
        { p: [x - 0.46 * s, 0.34 * s, z], r: [0.4 * s, 0.34 * s, 0.3 * s] },
        { p: [x + 0.14 * s * long, 0.31 * s, z], r: [0.52 * s, 0.33 * s, 0.3 * s] },
        { p: [x + 0.66 * s * long, 0.25 * s, z], r: [0.5 * s, 0.26 * s, 0.24 * s] },
      ],
      sq: 2.5,
      bone,
      radial: 14,
      span: 3,
      paint,
      uv: [2, 2],
    }),
  )
  const cp = clawPaint(coat)
  const tx = x + 0.92 * s * long
  for (let i = 0; i < toes; i++) {
    const k = i - (toes - 1) / 2
    const tz = z + k * (toes === 2 ? 0.44 : 0.36) * s
    const fx = tx - Math.abs(k) * 0.1 * s
    body.add('hide', ball({ at: [fx, 0.2 * s, tz], r: [0.3 * s, 0.2 * s, 0.2 * s], bone, paint, around: 10, rings: 6 }))
    if (claw > 0.05) {
      const len = 0.36 * s * claw
      body.add('hard', spike({ base: [fx + 0.16 * s, 0.2 * s, tz], tip: [fx + 0.16 * s + len, 0.05 * s, tz + k * 0.05 * s], radius: 0.085 * s * Math.min(1.5, 0.6 + claw * 0.4), bend: [0, len * 0.22, 0], bone, paint: cp, radial: 6, span: 1 }))
    }
  }
  if (back) {
    // A rear talon, for birds.
    const len = 0.5 * s * back
    body.add('hard', spike({ base: [x - 0.7 * s, 0.2 * s, z], tip: [x - 0.7 * s - len, 0.04 * s, z], radius: 0.09 * s, bend: [0, len * 0.2, 0], bone, paint: cp, radial: 6, span: 1 }))
  }
}

/** A neat cloven hoof under an ankle. */
export function hoof(body, coat, bone, { ankle, size }) {
  const s = size
  const [x, , z] = ankle
  const cp = clawPaint(coat)
  for (const k of [1, -1]) {
    body.add(
      'hard',
      loft({
        points: [
          { p: [x - 0.12 * s, 0.56 * s, z + k * 0.17 * s], r: [0.2 * s, 0.26 * s] },
          { p: [x + 0.16 * s, 0.26 * s, z + k * 0.2 * s], r: [0.22 * s, 0.25 * s] },
          { p: [x + 0.5 * s, 0.15 * s, z + k * 0.19 * s], r: [0.16 * s, 0.15 * s] },
        ],
        sq: 2.6,
        bone,
        radial: 10,
        span: 3,
        paint: cp,
        uv: [1, 1],
      }),
    )
  }
}

// ----- Fur, flame, feathers and petals ------------------------------------------------

/**
 * Tufts ringed round an axis: a mane, a ruff, a collar of petals, a halo of flame.
 * They stand on a ring of `radius` about `centre`, and lean back along `-axis` by `lean` degrees.
 * `from`/`to` are degrees round the axis, 0 at `up`. `paint(i, count)` may return a paint per tuft.
 */
export function ruff(body, { material = 'hide', centre, axis, up = [0, 1, 0], radius, squash = 1, count, from = -150, to = 150, len, width, thick, lean = 50, bone, paint, paintOf = null, taper = TAPER.lock, jitter = 0.22, seed = 1, radial = 7, span = 2, bow = 0.14, lift = 0 }) {
  const ax = norm3(axis)
  const u = norm3(add3(up, ax, -dot3(up, ax)))
  const s = cross3(ax, u)
  const tips = []
  for (let i = 0; i < count; i++) {
    const a = (from + ((to - from) * (i + 0.5)) / count) * RAD
    const out = norm3([u[0] * Math.cos(a) + s[0] * Math.sin(a) * squash, u[1] * Math.cos(a) + s[1] * Math.sin(a) * squash, u[2] * Math.cos(a) + s[2] * Math.sin(a) * squash])
    const rad = [u[0] * Math.cos(a) + s[0] * Math.sin(a) * squash, u[1] * Math.cos(a) + s[1] * Math.sin(a) * squash, u[2] * Math.cos(a) + s[2] * Math.sin(a) * squash]
    const base = add3(centre, rad, radius)
    const l = len * (1 + jitter * Math.sin(i * 2.4 + seed * 1.7)) * (1 + jitter * 0.6 * (dice(i, seed) - 0.5))
    const la = (lean + (dice(i, seed + 3) - 0.5) * 12) * RAD
    const dir = norm3([out[0] * Math.cos(la) - ax[0] * Math.sin(la), out[1] * Math.cos(la) - ax[1] * Math.sin(la) + lift, out[2] * Math.cos(la) - ax[2] * Math.sin(la)])
    const tip = add3(base, dir, l)
    body.add(
      material,
      tuft({
        base: add3(base, dir, -l * 0.12),
        tip,
        bend: [out[0] * l * bow, out[1] * l * bow, out[2] * l * bow],
        width,
        thick: thick ?? width * 0.42,
        bone,
        face: out,
        radial,
        span,
        taper,
        paint: paintOf ? paintOf(i, count) : paint,
      }),
    )
    tips.push(tip)
  }
  return tips
}

/**
 * Tufts standing in a row: a crest along a spine. pts: [{ p, bone, s?, up?, back? }].
 * Each grows from `p` along `up`, leaning towards `back` by `lean` degrees; its flat side faces `face`.
 */
export function ridge(body, pts, { material = 'hide', len, width, thick, lean = 30, paint, paintOf = null, taper = TAPER.flame, face = [0, 0, 1], radial = 7, span = 2, bow = 0.1, sink = 0.14 }) {
  pts.forEach((pt, i) => {
    const s = pt.s ?? 1
    if (s <= 0.02) return
    const upDir = norm3(pt.up ?? [0, 1, 0])
    const backDir = norm3(pt.back ?? [-1, 0, 0])
    const la = lean * RAD
    const dir = norm3([upDir[0] * Math.cos(la) + backDir[0] * Math.sin(la), upDir[1] * Math.cos(la) + backDir[1] * Math.sin(la), upDir[2] * Math.cos(la) + backDir[2] * Math.sin(la)])
    const l = len * s
    body.add(
      material,
      tuft({
        base: add3(pt.p, dir, -l * sink),
        tip: add3(pt.p, dir, l),
        bend: [backDir[0] * -l * bow, backDir[1] * -l * bow + l * bow * 0.3, backDir[2] * -l * bow],
        width: width * s,
        thick: (thick ?? width * 0.42) * s,
        bone: pt.bone,
        face: pt.face ?? face,
        radial,
        span,
        taper,
        paint: paintOf ? paintOf(i, pts.length) : paint,
      }),
    )
  })
}

/** Clusters of crystals: at each point a tall shard and a smaller one leaning off it. pts: [{ p, bone, s, up? }]. */
export function crystals(body, pts, { size, lean = [-0.3, 0, 0], paint, sides = 6, seed = 1, extra = 1 }) {
  pts.forEach((pt, i) => {
    const s = size * (pt.s ?? 1)
    if (s <= 0.015) return
    const upDir = norm3(pt.up ?? [0, 1, 0])
    const wob = dice(i, seed) - 0.5
    const side = cross3(upDir, [1, 0.01, 0.02])
    const tip = add3(add3(pt.p, upDir, s), lean, s)
    body.add('crystal', shard({ base: add3(pt.p, upDir, -s * 0.16), tip: add3(tip, side, wob * s * 0.25), radius: s * 0.2, bone: pt.bone, sides, twist: wob * 2, paint }))
    for (let k = 0; k < extra; k++) {
      const sign = k === 0 ? (wob > 0 ? 1 : -1) : -(wob > 0 ? 1 : -1)
      const off = add3(pt.p, side, sign * s * 0.22)
      body.add(
        'crystal',
        shard({
          base: add3(off, upDir, -s * 0.12),
          tip: add3(add3(add3(off, upDir, s * (0.58 - k * 0.12)), lean, s * 0.9), side, sign * s * 0.3),
          radius: s * (0.14 - k * 0.02),
          bone: pt.bone,
          sides: 5,
          twist: wob,
          paint,
        }),
      )
    }
  })
}

/** Crystal colour: deep at the root, bright and glowing at the tip. */
export function crystalPaint(coat, { root = 'crystalDeep', tip = 'crystal', glow = 1 } = {}) {
  const a = coat.c(coat.T[root] ? root : 'accent')
  const b = coat.c(coat.T[tip] ? tip : 'hot')
  const g = glow * (coat.S.glow ?? 1)
  return (t, v, p, ink) => {
    ink.copy(a).lerp(b, sm(0.1, 0.95, t))
    ink.glow = (0.25 + 0.75 * t) * g
  }
}

// ----- Legs ---------------------------------------------------------------------

const vA = new THREE.Vector3()
const vB = new THREE.Vector3()
const inv = new THREE.Matrix4()
const rel = new THREE.Matrix4()
const e = new THREE.Euler()

/**
 * Bends every leg so its ankle lands on its target, in the leg's forward-up plane.
 * leg: { upper, lower, foot, a: [x, y] rest upper→lower, b: [x, y] rest lower→foot, bend: +1 knee forward / -1 knee back, restFoot, slot }
 * Leg targets are read from the pose (`ik…` channels: an offset from where the foot rests);
 * `off` 0..1 lets the legs go limp (a body lying on its side).
 * Bones here keep identity rest rotation, so the solve works in plain X-Y angles.
 */
export function solveLegs(group, legs, pose, off) {
  if (!legs.length) return
  group.updateMatrixWorld(true)
  inv.copy(group.matrixWorld).invert()
  const p = pose.p
  for (const leg of legs) {
    const upper = leg.upper
    const parent = upper.parent
    // Where the top of the leg is now, in the beast's space, and how far the body above is pitched.
    rel.multiplyMatrices(inv, parent.matrixWorld)
    vA.copy(upper.position).applyMatrix4(rel)
    e.setFromRotationMatrix(rel, 'ZYX')
    const parentTilt = e.z
    const o = leg.slot * 3
    vB.set(leg.restFoot.x + p[o], leg.restFoot.y + p[o + 1], leg.restFoot.z + p[o + 2])
    const moved = p[o] !== 0 || p[o + 1] !== 0 || p[o + 2] !== 0
    const dx = vB.x - vA.x
    const dy = vB.y - vA.y
    const la = leg.la
    const lb = leg.lb
    const reach = Math.min(Math.hypot(dx, dy), (la + lb) * 0.999)
    const aim = Math.atan2(dy, dx)
    const inner = Math.acos(Math.min(1, Math.max(-1, (la * la + reach * reach - lb * lb) / (2 * la * Math.max(reach, 1e-4)))))
    const angleA = aim + inner * leg.bend
    const kneeX = vA.x + Math.cos(angleA) * la
    const kneeY = vA.y + Math.sin(angleA) * la
    const angleB = Math.atan2(vA.y + Math.sin(aim) * reach - kneeY, vA.x + Math.cos(aim) * reach - kneeX)
    const turnA = angleA - leg.restA - parentTilt
    const turnB = angleB - leg.restB - (angleA - leg.restA)
    const splay = moved ? Math.atan2(vB.z - vA.z, Math.max(0.2, Math.abs(dy))) : 0
    const keep = 1 - off
    upper.rotation.set(-splay * keep, 0, turnA * keep)
    leg.lower.rotation.set(0, 0, turnB * keep)
    // The foot stays level with the ground unless the pose tips it.
    leg.foot.rotation.set(0, 0, -(angleB - leg.restB) * keep)
  }
}

/** Fills in the fixed numbers of a leg once its bones exist. */
export function prepareLeg(leg, rig) {
  leg.upper = rig.boneList[rig.bones[leg.names[0]]]
  leg.lower = rig.boneList[rig.bones[leg.names[1]]]
  leg.foot = rig.boneList[rig.bones[leg.names[2]]]
  leg.la = Math.hypot(leg.a[0], leg.a[1])
  leg.lb = Math.hypot(leg.b[0], leg.b[1])
  leg.restA = Math.atan2(leg.a[1], leg.a[0])
  leg.restB = Math.atan2(leg.b[1], leg.b[0])
  return leg
}
