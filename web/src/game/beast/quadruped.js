// The four-legged body plan: lion-hounds, stags, panthers, sea-wolves.
// A look sheet `S` (a line's sheet grown to one form, see forms.js) sets every
// proportion and feature.

import * as THREE from 'three'
import { loft, rails, tuft, TAPER } from './shape.js'
import { Body, addPos, addRot } from './rig.js'
import { Coat, buildHead, crystalPaint, crystals, dice, faceAlive, faceLife, hoof, paw, ridge, ruff } from './parts.js'
import { add3, antlers, crown, crownAlive, emberPaint, fan, finPaint, flamePaint, flower, leafPaint, mix3, platePaint, shell, spinePoints, sweptHorns } from './features.js'

const DEG = Math.PI / 180
const TAIL = 5
// Bone names, made once, so the living motion builds no strings while it runs.
const TAILS = ['', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5']

export function buildQuadruped(S) {
  const body = new Body()
  const coat = new Coat(S)
  const G = S.girth
  const L = S.length
  const legLen = S.leg
  const H = legLen + G * 0.92
  const hipX = -L / 2
  const shX = L / 2
  const hs = S.head
  const zF = G * 0.6 * (S.stance ?? 1)
  const zH = G * 0.58 * (S.stance ?? 1)
  const lt = S.limb ?? 1
  const B = (n) => body.b(n)

  // ----- Spine, neck and head ---------------------------------------------------
  body.bone('hips', null, [hipX, H, 0])
  body.bone('spine', 'hips', [0, H, 0])
  body.bone('chest', 'spine', [shX, H, 0])
  const na = (S.neckAngle ?? 40) * DEG
  const nd = [Math.cos(na), Math.sin(na), 0]
  const neckBase = [shX + G * 0.36, H + G * 0.3, 0]
  const E = add3(neckBase, nd, S.neck)
  body.bone('neck', 'chest', neckBase)
  body.bone('head', 'neck', E)
  const ha = (S.headAngle ?? -8) * DEG
  const head = buildHead(body, S, coat, { o: [E[0] + Math.cos(ha) * hs * 0.14, E[1] + Math.sin(ha) * hs * 0.14 + hs * 0.05], a: ha })

  // ----- Torso and neck: one skin from the rump to the back of the skull -----------
  const waist = S.waist ?? 0.86
  const nt = S.neckThick ?? 1
  const deep = S.chestDeep ?? 1.1
  const torsoSpec = {
    points: [
      { p: [hipX - G * 0.95, H - G * 0.02, 0], r: [G * 0.38, G * 0.42, G * 0.38], bone: B('hips') },
      { p: [hipX - G * 0.25, H + G * 0.04, 0], r: [G * 0.9, G * 0.9, G * 0.93], bone: B('hips') },
      { p: [hipX * 0.2, H - G * 0.03, 0], r: [G * 0.84 * waist, G * 0.84, G * 0.86 * waist], bone: B('spine') },
      { p: [shX - G * 0.2, H + G * 0.02, 0], r: [G * 0.98, G * 0.96, G * deep], bone: B('chest') },
      { p: [shX + G * 0.3, H + G * 0.15, 0], r: [G * 0.84, G * 0.88, G * deep * 0.93], bone: B('chest') },
      { p: add3(neckBase, nd, S.neck * 0.45), r: [G * 0.58 * nt, G * 0.6 * nt, G * 0.7 * nt], bone: B('neck') },
      { p: add3(E, nd, -hs * 0.04), r: [hs * 0.38, hs * 0.36, hs * 0.4], bone: B('head') },
    ],
    span: 7,
  }
  const torso = rails(torsoSpec)
  body.add('hide', loft({ ...torsoSpec, rails: torso, radial: 34, paint: coat.part('body'), uv: [1.6, 4] }), { outer: true })

  // ----- Tail ----------------------------------------------------------------------
  const tl = S.tail
  const tLift = S.tailLift ?? 0.35
  const tDroop = S.tailDroop ?? 0.25
  const tailPts = []
  for (let i = 0; i <= TAIL; i++) {
    const t = i / TAIL
    tailPts.push([hipX - G * 0.72 - tl * t * 0.92, H + G * 0.18 + tl * (Math.sin(t * Math.PI * 0.75) * tLift * 0.6 - t * t * tDroop), 0])
  }
  for (let i = 0; i < TAIL; i++) body.bone(`tail${i + 1}`, i === 0 ? 'hips' : `tail${i}`, tailPts[i])
  const tr = S.tailThick ?? 1
  const tailSpec = { points: tailPts.map((p, i) => ({ p, r: G * tr * (0.3 - 0.2 * (i / TAIL) - (S.tailTip === 'fluke' ? 0 : 0.02 * (i / TAIL))), bone: B(`tail${Math.min(TAIL, i + 1)}`) })), span: 5 }
  const tailRails = rails(tailSpec)
  body.add('hide', loft({ ...tailSpec, rails: tailRails, radial: 18, paint: coat.part('tail'), uv: [1.2, 2] }))

  // ----- Legs ----------------------------------------------------------------------
  const pawS = G * 0.46 * (S.paw ?? 1)
  const ankleY = pawS * 0.58
  const legs = []
  const makeLeg = (key, parent, top, mid, low, bend, foot) => {
    for (const side of [1, -1]) {
      const sfx = side === 1 ? 'L' : 'R'
      const z = top[2] * side
      const names = [`${key}Top${sfx}`, `${key}Mid${sfx}`, `${key}Low${sfx}`]
      body.bone(names[0], parent, [top[0], top[1], z])
      body.bone(names[1], names[0], [mid[0], mid[1], z])
      body.bone(names[2], names[1], [low[0], low[1], z])
      legs.push({ key: `ik${key}${sfx}`, names, a: [mid[0] - top[0], mid[1] - top[1]], b: [low[0] - mid[0], low[1] - mid[1]], bend, restFoot: new THREE.Vector3(low[0], low[1], z) })
      const [T0, T1, T2] = names.map(B)
      const t3 = [top[0], top[1], z]
      const m3 = [mid[0], mid[1], z]
      const l3 = [low[0], low[1], z]
      const pts =
        key === 'F'
          ? [
              { p: [top[0] + G * 0.05, top[1] + G * 0.55, z * 0.55], r: [G * 0.3, G * 0.38, G * 0.42], bone: T0 },
              { p: [top[0], top[1] - G * 0.02, z * 0.94], r: [G * 0.35 * lt, G * 0.36 * lt, G * 0.42 * lt], bone: T0 },
              { p: mix3(t3, m3, 0.62), r: [G * 0.27 * lt, G * 0.27 * lt, G * 0.31 * lt], bone: T0 },
              { p: m3, r: [G * 0.23 * lt, G * 0.22 * lt, G * 0.25 * lt], bone: T1 },
              { p: mix3(m3, l3, 0.55), r: [G * 0.205 * lt, G * 0.2 * lt, G * 0.215 * lt], bone: T1 },
              { p: [low[0], low[1] + pawS * 0.12, z], r: [G * 0.215 * lt, G * 0.21 * lt, G * 0.215 * lt], bone: T2 },
            ]
          : [
              { p: [top[0] - G * 0.12, top[1] + G * 0.5, z * 0.5], r: [G * 0.42, G * 0.5, G * 0.5], bone: T0 },
              { p: [top[0] + G * 0.02, top[1] - G * 0.12, z * 0.92], r: [G * 0.44 * lt, G * 0.5 * lt, G * 0.52 * lt], bone: T0 },
              { p: mix3(t3, m3, 0.62), r: [G * 0.3 * lt, G * 0.31 * lt, G * 0.35 * lt], bone: T0 },
              { p: m3, r: [G * 0.225 * lt, G * 0.22 * lt, G * 0.25 * lt], bone: T1 },
              { p: mix3(m3, l3, 0.5), r: [G * 0.18 * lt, G * 0.17 * lt, G * 0.21 * lt], bone: T1 },
              { p: l3, r: [G * 0.175 * lt, G * 0.17 * lt, G * 0.2 * lt], bone: T2 },
              { p: [foot[0], ankleY + pawS * 0.12, z], r: [G * 0.205 * lt, G * 0.2 * lt, G * 0.205 * lt], bone: T2 },
            ]
      body.add('hide', loft({ points: pts, span: 4, radial: 18, up: [1, 0, 0], paint: coat.part('leg', { side }), uv: [1.4, 2] }), { outer: true })
      const ankle = [key === 'F' ? low[0] : foot[0], ankleY, z]
      if (S.hooves) hoof(body, coat, T2, { ankle, size: pawS * 0.9 })
      else paw(body, coat, T2, { ankle, size: pawS, toes: S.toes ?? 3, claw: S.claw ?? 1, side })
      // Thorns, spurs or crystal knuckles on later forms.
      if (S.legSpikes?.size > 0.01) {
        const at = key === 'F' ? mix3(m3, l3, 0.15) : mix3(t3, m3, 0.85)
        const out = [key === 'F' ? -0.7 : -0.6, 0.15, side * 0.7]
        crystals(body, [{ p: at, up: out, bone: key === 'F' ? T1 : T0, s: 1 }], { size: G * 0.36 * S.legSpikes.size, paint: crystalPaint(coat), seed: side + 3, extra: 0 })
      }
    }
  }
  const topF = H - G * 0.3
  makeLeg('F', 'chest', [shX + 0.02, topF, zF], [shX - (topF - ankleY) * 0.12, ankleY + (topF - ankleY) * 0.52], [shX + G * 0.05, ankleY], -1)
  const topH = H - G * 0.25
  const hockY = ankleY + legLen * 0.26
  makeLeg('H', 'hips', [hipX + G * 0.08, topH, zH], [hipX + legLen * 0.2, hockY + (topH - hockY) * 0.5], [hipX - legLen * 0.14, hockY], 1, [hipX - legLen * 0.05, ankleY])

  // ----- What grows on it --------------------------------------------------------------
  const crestPaint = (kind) => (kind === 'flame' ? flamePaint(coat) : kind === 'ember' ? emberPaint(coat) : kind === 'leaf' ? leafPaint(coat, { vein: 1 }) : coat.part('crest'))
  const crestTaper = (kind) => (kind === 'flame' ? TAPER.flame : kind === 'leaf' ? TAPER.leaf : kind === 'ember' ? TAPER.puff : TAPER.lock)
  const crestMaterial = (kind) => (kind === 'flame' ? 'flame' : kind === 'spine' ? 'hard' : 'hide')

  // A mane: rows of tufts round the neck.
  const M = S.mane
  if (M && M.size > 0.01) {
    const rows = M.rows ?? 2
    const fire = M.kind === 'flame'
    const ember = M.kind === 'ember'
    for (let row = 0; row < rows; row++) {
      const centre = add3(neckBase, nd, S.neck * ((ember ? 0.95 : 0.78) - row * 0.36) + G * 0.02)
      ruff(body, {
        material: crestMaterial(M.kind),
        centre,
        axis: nd,
        up: [-nd[1], nd[0], 0],
        radius: G * (0.46 + row * 0.14) * nt,
        squash: 1.05,
        count: (M.count ?? 13) + row * 2,
        // Fire rises: flames stand round the top and sides of the neck, not under the throat.
        from: M.from ?? (fire ? -128 : ember ? -152 : -165),
        to: M.to ?? (fire ? 128 : ember ? 152 : 165),
        len: M.size * (1 + row * 0.2),
        width: M.size * (M.width ?? 0.34),
        thick: M.size * (M.thick ?? (fire ? 0.2 : 0.12)),
        lean: (M.lean ?? (fire ? 52 : ember ? 34 : 60)) + row * 8,
        lift: fire ? 0.55 : ember ? 0.3 : 0,
        bone: B(row === 0 ? 'neck' : 'chest'),
        paint: crestPaint(M.kind),
        taper: crestTaper(M.kind),
        jitter: 0.24,
        seed: row * 3 + S.seed,
        radial: 7,
        bow: fire || ember ? 0.22 : 0.16,
      })
    }
  }
  // A forelock between the ears: a cub's first flame, leaf or curl.
  const FL = S.forelock
  if (FL && FL.size > 0.01) {
    const n = FL.count ?? 3
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0 : i / (n - 1) - 0.5
      const base = head.Q(-0.02 - Math.abs(k) * 0.12, 0.44 - Math.abs(k) * 0.05, k * 0.18)
      const len = hs * FL.size * (1 - Math.abs(k) * 0.55)
      body.add(crestMaterial(FL.kind), tuft({ base, tip: add3(base, head.D(-0.35, 1, k * 0.8), len), bend: head.D(0.12 * len, 0, 0), width: len * 0.36, thick: len * 0.13, bone: B('head'), face: head.D(1, 0.2, k), taper: crestTaper(FL.kind), radial: 8, paint: crestPaint(FL.kind) }))
    }
  }

  // A crest down the spine (and on to the tail).
  const C = S.crest
  if (C && C.size > 0.01) {
    const pts = spinePoints(torso, { from: C.from ?? 0.2, to: C.to ?? 0.78, count: C.count ?? 7, size: (t) => 0.55 + 0.45 * Math.sin(Math.min(1, (t - (C.from ?? 0.2)) / ((C.to ?? 0.78) - (C.from ?? 0.2))) * Math.PI), lift: -G * 0.04 })
    if (C.tail) pts.push(...spinePoints(tailRails, { from: 0.1, to: 0.8, count: C.tail, size: (t) => 0.55 - t * 0.35, lift: -G * 0.02 }).map((pt) => ({ ...pt, back: [-pt.back[0], -pt.back[1], -pt.back[2]] })))
    if (C.kind === 'crystal') crystals(body, pts, { size: C.size, paint: crystalPaint(coat), seed: S.seed, lean: [-0.25, 0, 0] })
    else ridge(body, pts, { material: crestMaterial(C.kind), len: C.size, width: C.size * (C.width ?? 0.32), thick: C.size * 0.1, lean: C.lean ?? 42, paint: crestPaint(C.kind), taper: crestTaper(C.kind) })
  }

  // Crystals along the flanks (a second row on the Dread and the Mythic).
  if (S.flankCrystals && S.flankCrystals > 0.01) {
    for (const side of [1, -1]) {
      const pts = spinePoints(torso, { from: 0.22, to: 0.62, count: 4, v: side > 0 ? 0.13 : 0.87, size: (t, i) => 0.7 + 0.3 * dice(i, 4), lift: -G * 0.03 })
      crystals(body, pts, { size: S.flankCrystals, paint: crystalPaint(coat), seed: S.seed + side, lean: [-0.3, 0.1, 0.25 * side], extra: 1 })
    }
  }

  // Armour shells over the shoulders and haunches.
  const P = S.plates
  if (P && P.size > 0.01) {
    const paint = platePaint(coat, { seam: P.seam ?? 0 })
    for (const side of [1, -1]) {
      for (const [t, k] of [
        [0.6, 1],
        [0.17, 0.9],
        [0.4, 0.62],
      ]) {
        const hit = torso.at(t, side > 0 ? 0.12 : 0.88)
        const ring = hit.ring
        shell(body, { at: add3(hit.p.toArray(), hit.d.toArray(), G * 0.02), normal: hit.d.toArray(), along: [ring.tan.x, ring.tan.y + 0.25, ring.tan.z], len: G * 0.95 * k * P.size, wide: G * 0.5 * k * P.size, thick: G * 0.11 * P.size, bone: ring.w < 0.5 ? ring.boneA : ring.boneB, paint })
      }
    }
  }

  // Horns and antlers.
  const A = S.horns
  if (A && A.size > 0.01) {
    if (A.kind === 'antler') {
      const tips = antlers(body, coat, head, { size: A.size, tines: A.tines ?? 3, bone: B('head'), spread: A.spread ?? 1 })
      if (A.leaves) {
        tips.forEach((tip, i) => {
          for (let k = 0; k < A.leaves; k++) {
            const a = (k / A.leaves) * Math.PI * 2 + i
            body.add('hide', tuft({ base: tip, tip: add3(tip, [Math.cos(a) * 0.6, 0.55, Math.sin(a) * 0.6], hs * (0.2 + 0.16 * A.size)), width: hs * (0.08 + 0.06 * A.size), thick: hs * 0.025, bone: B('head'), face: [Math.cos(a), 0.3, Math.sin(a)], taper: TAPER.leaf, radial: 6, span: 2, paint: leafPaint(coat, { glow: 0.5, vein: 1 }) }))
          }
        })
      }
      if (A.bloom) tips.forEach((tip, i) => i % 2 === 0 && flower(body, coat, { at: tip, normal: [0.2, 1, 0], size: hs * 0.16 * A.bloom, bone: B('head'), petals: 5, paint: leafPaint(coat, { a: 'petal', b: 'petalTip', glow: 0.9 }), seed: i }))
    } else if (A.kind === 'swept') {
      sweptHorns(body, coat, head, { size: A.size, bone: B('head'), ridges: A.ridges ?? 0, glowTip: A.glowTip ?? 0, at: A.at, up: A.up, out: A.out })
    }
  }

  // Fins: along the back, on the cheeks, and the fluke of the tail.
  if (S.backFin && S.backFin > 0.01) {
    const pts = spinePoints(torso, { from: 0.28, to: 0.8, count: 5 })
    const heights = [0.45, 0.9, 1.1, 0.85, 0.45]
    const ribs = pts.map((pt, i) => {
      const h = G * S.backFin * heights[i]
      const root = add3(pt.p, pt.up, -G * 0.08)
      return [root, add3(add3(root, pt.up, h * 0.58), pt.back, h * 0.22), add3(add3(root, pt.up, h), pt.back, h * 0.6)]
    })
    fan(body, coat, { ribs, bones: pts.map((pt) => pt.bone), paint: finPaint(coat), ribRadius: G * 0.022, sag: 0.03 })
  }
  if (S.cheekFins && S.cheekFins > 0.01) {
    const s = S.cheekFins
    for (const side of [1, -1]) {
      const ribs = [0.22, 0.05, -0.12].map((u, i) => {
        const root = head.Q(-0.12, u, 0.4 * side)
        return [root, head.Q(-0.12 - 0.22 * s, u + (0.08 - i * 0.08) * s, (0.52 + 0.12 * s) * side), head.Q(-0.12 - 0.52 * s, u + (0.2 - i * 0.18) * s, (0.6 + 0.2 * s) * side)]
      })
      fan(body, coat, { ribs, bones: B('head'), paint: finPaint(coat, { streaks: 3 }), ribRadius: hs * 0.016 })
    }
  }

  // The end of the tail.
  const tipAt = tailPts[TAIL]
  const tipBone = B(`tail${TAIL}`)
  const tailDir = [-1, -0.1, 0]
  if (S.tailTip === 'flame') {
    // A torch: a few tongues of flame rising from the tip, the middle one tallest.
    const s = G * (S.tailTipSize ?? 1)
    const tongues = [
      [0, 1, 0.3, 0],
      [0.42, 0.72, 0.24, 0.5],
      [-0.42, 0.7, 0.24, -0.4],
      [0.15, 0.55, 0.2, -0.9],
      [-0.2, 0.5, 0.18, 0.9],
    ]
    for (const [lean, len, wide, turn] of tongues) {
      const dir = [-0.55 + lean * 0.3, 0.85, turn * 0.35]
      body.add('flame', tuft({ base: add3(tipAt, tailDir, -G * 0.08), tip: add3(tipAt, dir, s * 0.95 * len), bend: [-s * 0.06, 0, -turn * s * 0.04], width: s * wide, thick: s * wide * 0.5, bone: tipBone, face: [Math.sin(turn), 0, Math.cos(turn)], taper: TAPER.flame, radial: 8, paint: flamePaint(coat) }))
    }
  } else if (S.tailTip === 'tuft') {
    ruff(body, { material: 'hide', centre: tipAt, axis: [1, 0.1, 0], radius: G * 0.08 * tr, count: 7, from: -180, to: 180, len: G * 0.42 * (S.tailTipSize ?? 1), width: G * 0.2, thick: G * 0.08, lean: 140, bone: tipBone, paint: coat.part('tailTip', { base: 'tip' }), seed: 2, bow: 0.12 })
  } else if (S.tailTip === 'blade') {
    crystals(body, [{ p: add3(tipAt, tailDir, -G * 0.05), up: [-1, 0.45, 0], bone: tipBone, s: 1 }], { size: G * 0.9 * (S.tailTipSize ?? 1), paint: crystalPaint(coat), seed: 7, lean: [-0.2, 0.3, 0], extra: 2 })
  } else if (S.tailTip === 'fluke') {
    const s = S.tailTipSize ?? 1
    for (const dir of [1, -1]) {
      const ribs = [0, 0.5, 1].map((k) => [add3(tipAt, [G * 0.25 - k * G * 0.3, 0, 0]), add3(tipAt, [-G * (0.2 + 0.45 * k) * s, G * 0.06 * s, G * (0.5 - 0.1 * k) * s * dir]), add3(tipAt, [-G * (0.45 + 0.75 * k) * s, G * 0.12 * s, G * (0.95 - 0.35 * k) * s * dir])])
      fan(body, coat, { ribs, bones: tipBone, paint: finPaint(coat, { streaks: 3 }), ribRadius: G * 0.018 })
    }
  }

  if (S.crown) crown(body, S, coat, head, { kind: S.crown, size: S.crownSize ?? 1, lift: S.crownLift ?? 0 })

  // ----- Where effects attach ----------------------------------------------------------
  body.socket('chest', 'chest', [shX + G * 0.3, H - G * 0.25, 0])
  body.socket('back', 'spine', [0, H + G * 0.85, 0])
  body.socket('belly', 'spine', [0, H - G * 0.8, 0])
  body.socket('pawL', 'FLowL', [shX + G * 0.05 + pawS * 0.9, pawS * 0.3, zF])
  body.socket('pawR', 'FLowR', [shX + G * 0.05 + pawS * 0.9, pawS * 0.3, -zF])
  body.socket('tail', `tail${TAIL}`, tipAt)

  const mouth = head.Q(head.tipF, 0)
  return {
    body,
    legs,
    clips: CLIPS(H, G),
    alive: aliveQuadruped(S),
    meta: { height: Math.max(E[1] + hs * 0.62, H + G), length: L + tl * 0.5 + S.neck, reach: mouth[0] + 0.25, chest: H, shoulder: H + G },
  }
}

// ----- Motion ----------------------------------------------------------------------------

function aliveQuadruped(S) {
  const life = faceLife(S)
  const bounce = S.life.bounce
  const slow = 1 - S.life.heavy * 0.35
  const crownKind = S.crown || null
  return (pose, t, st) => {
    const calm = st.calm ?? 1
    const breath = Math.sin(t * (1.7 + (1 - calm) * 1.5) * slow)
    const hop = Math.pow(Math.abs(Math.sin(t * 2.6)), 1.5) * bounce * calm
    addPos(pose, 'hips', 0, breath * 0.012 * (2 - calm) - 0.01 + hop * 0.03, 0)
    addRot(pose, 'chest', 0, 0, breath * 0.9 + hop * 2)
    addRot(pose, 'spine', 0, 0, -breath * 0.5)
    // Looking about. Cubs cock their heads now and then.
    const look = Math.sin(t * 0.5 * slow) * 0.6 + Math.sin(t * 0.23 + 2) * 0.4
    addRot(pose, 'neck', 0, look * 5 * calm, Math.sin(t * 0.9 * slow) * 2 - hop * 3)
    const cock = Math.pow(Math.max(0, Math.sin(t * 0.55 + 0.6)), 4) * 18 * bounce * calm
    addRot(pose, 'head', Math.sin(t * 0.7 + 1) * 3 * calm + cock, look * 6 * calm, Math.sin(t * 1.1 * slow) * 2 + hop * 2)
    addRot(pose, 'jaw', 0, 0, -1.5 - breath * 1.2 - (1 - calm) * 6)
    const wag = 1.5 + bounce * 3.5
    for (let i = 1; i <= TAIL; i++) {
      addRot(pose, TAILS[i], 0, Math.sin(t * wag * slow - i * 0.7) * (5 + i * 2.2) * (st.energy ?? 1) * (1 + bounce * 0.6), Math.sin(t * 0.9 - i * 0.5) * 3 - 3)
    }
    faceAlive(pose, t, st, life)
    if (crownKind) crownAlive(pose, t, crownKind)
    // A full Rage bar: the body trembles and hunkers.
    const tremble = st.tremble ?? 0
    if (tremble > 0) {
      addPos(pose, 'hips', Math.sin(t * 47) * 0.008 * tremble, Math.sin(t * 53) * 0.006 * tremble - 0.03 * tremble, 0)
      addRot(pose, 'head', 0, 0, Math.sin(t * 41) * 1.2 * tremble)
    }
    // Moving fast: a two-beat gallop under the body.
    const run = st.run ?? 0
    if (run > 0) {
      const ph = t * 16
      const s0 = Math.sin(ph)
      const c0 = Math.cos(ph)
      const s1 = Math.sin(ph + 0.9)
      const c1 = Math.cos(ph + 0.9)
      addPos(pose, 'ikFL', c0 * 0.3 * run, Math.max(0, s0) * 0.32 * run, 0)
      addPos(pose, 'ikFR', c1 * 0.3 * run, Math.max(0, s1) * 0.32 * run, 0)
      addPos(pose, 'ikHL', -c0 * 0.3 * run, Math.max(0, -s0) * 0.32 * run, 0)
      addPos(pose, 'ikHR', -c1 * 0.3 * run, Math.max(0, -s1) * 0.32 * run, 0)
      addPos(pose, 'hips', 0, Math.sin(ph * 2) * 0.04 * run, 0)
      addRot(pose, 'spine', 0, 0, Math.sin(ph) * 5 * run)
    }
  }
}

// `face` is [eyes shut, scowl, ears back], each 0..1.
const ANGRY = [0, 1, 1]
const WINCE = [0.85, 0.5, 1]

function CLIPS(H, G) {
  const both = (name, v) => ({ [`${name}L`]: v, [`${name}R`]: v })
  const tailUp = (a) => ({ tail1: [0, 0, -a], tail2: [0, 0, -a], tail3: [0, 0, -a * 0.8], tail4: [0, 0, -a * 0.6] })
  return {
    land: {
      dur: 0.55,
      keys: [
        { t: 0, r: { spine: [0, 0, -8], neck: [0, 0, -16], head: [0, 0, 12] }, p: { hips: [0, -0.3 * H, 0], face: [0.4, 0, 0.5] } },
        { t: 0.35, r: { spine: [0, 0, 3], neck: [0, 0, 6] }, p: { hips: [0, 0.03, 0] }, ease: 'out' },
        { t: 1, r: {} },
      ],
    },
    roar: {
      dur: 1.6,
      keys: [
        { t: 0, r: {} },
        { t: 0.2, r: { spine: [0, 0, -6], chest: [0, 0, -8], neck: [0, 0, -20], head: [0, 0, -8], jaw: [0, 0, -4] }, p: { hips: [-0.08, -0.12, 0], face: [0, 0.6, 0.6] } },
        { t: 0.36, r: { spine: [0, 0, 7], chest: [0, 0, 10], neck: [0, 0, 24], head: [0, 0, 20], jaw: [0, 0, -42], ...tailUp(14) }, p: { hips: [0.06, 0.03, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.6, r: { spine: [0, 0, 6], chest: [0, 0, 9], neck: [0, 8, 22], head: [5, 8, 18], jaw: [0, 0, -38], ...tailUp(14) }, p: { hips: [0.06, 0.03, 0], face: ANGRY } },
        { t: 0.82, r: { spine: [0, 0, 5], chest: [0, 0, 8], neck: [0, -8, 20], head: [-5, -8, 16], jaw: [0, 0, -34], ...tailUp(10) }, p: { hips: [0.05, 0.02, 0], face: ANGRY } },
        { t: 1, r: {} },
      ],
      events: [[0.33, 'roar']],
    },
    strike: {
      dur: 0.66,
      keys: [
        { t: 0, r: {} },
        { t: 0.3, r: { spine: [0, 0, -9], chest: [0, 0, -6], neck: [0, 0, -24], head: [0, 0, 16], jaw: [0, 0, -8] }, p: { hips: [-0.24, -0.16, 0], face: [0, 1, 1] } },
        { t: 0.46, r: { spine: [0, 0, 5], chest: [0, 0, 4], neck: [0, 0, -14], head: [0, 0, -4], jaw: [0, 0, -46] }, p: { hips: [0.5, 0.0, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.54, r: { spine: [0, 0, 4], chest: [6, 0, 2], neck: [10, 0, -16], head: [22, 0, -8], jaw: [0, 0, -2] }, p: { hips: [0.52, -0.02, 0], face: [0.3, 1, 1] }, ease: 'snap' },
        { t: 0.7, r: { spine: [0, 0, 3], chest: [-6, 0, 2], neck: [-10, 0, -12], head: [-20, 0, -6], jaw: [0, 0, -2] }, p: { hips: [0.42, -0.02, 0], face: [0.3, 1, 1] } },
        { t: 1, r: {} },
      ],
      events: [[0.47, 'hit']],
    },
    claw: {
      dur: 0.62,
      keys: [
        { t: 0, r: {} },
        { t: 0.32, r: { spine: [0, 6, 4], chest: [-10, 14, 8], neck: [0, -8, -6], head: [0, -6, 4], jaw: [0, 0, -16] }, p: { hips: [-0.12, -0.05, 0], ikFR: [0.05, H * 0.6, -0.1], face: [0, 1, 0.8] } },
        { t: 0.48, r: { spine: [0, -6, -3], chest: [12, -18, -8], neck: [0, 8, -4], head: [0, 6, -4], jaw: [0, 0, -30] }, p: { hips: [0.3, -0.1, 0], ikFR: [H * 0.6, H * 0.28, 0.25], face: ANGRY }, ease: 'snap' },
        { t: 0.62, r: { spine: [0, -4, -2], chest: [8, -12, -6], jaw: [0, 0, -12] }, p: { hips: [0.24, -0.1, 0], ikFR: [H * 0.42, 0, 0.2], face: [0, 0.8, 0.8] } },
        { t: 1, r: {} },
      ],
      events: [[0.46, 'hit']],
    },
    heavy: {
      dur: 1.05,
      keys: [
        { t: 0, r: {} },
        { t: 0.34, r: { spine: [0, 0, 26], chest: [0, 0, 22], neck: [0, 0, -18], head: [0, 0, -8], jaw: [0, 0, -24], ...tailUp(-10) }, p: { hips: [-0.12, 0.02, 0], ...both('ikF', [-0.1, H * 0.85, 0]), face: ANGRY } },
        { t: 0.52, r: { spine: [0, 0, 32], chest: [0, 0, 27], neck: [0, 0, -22], head: [0, 0, -6], jaw: [0, 0, -36], ...tailUp(-12) }, p: { hips: [-0.16, 0.05, 0], ...both('ikF', [0.05, H * 1.02, 0]), face: ANGRY } },
        { t: 0.63, r: { spine: [0, 0, -7], chest: [0, 0, -10], neck: [0, 0, 6], head: [0, 0, -10], jaw: [0, 0, -10] }, p: { hips: [0.28, -0.14, 0], ...both('ikF', [H * 0.36, 0, 0]), face: [0.5, 1, 1] }, ease: 'snap' },
        { t: 0.78, r: { spine: [0, 0, -3], chest: [0, 0, -5], neck: [0, 0, 2] }, p: { hips: [0.2, -0.08, 0], ...both('ikF', [H * 0.3, 0, 0]), face: [0, 0.8, 0.6] } },
        { t: 1, r: {} },
      ],
      events: [[0.62, 'hit']],
    },
    guard: {
      dur: 0.26,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 1, r: { spine: [0, 0, -5], chest: [0, 0, -9], neck: [0, 0, -30], head: [0, 0, 24], jaw: [0, 0, -9], ...tailUp(8) }, p: { hips: [-0.16, -0.2, 0], ...both('ikF', [0.14, 0, 0]), face: [0.1, 1, 1] }, ease: 'out' },
      ],
    },
    guardHit: {
      dur: 0.34,
      hold: true,
      keys: [
        { t: 0, r: { spine: [0, 0, -5], chest: [0, 0, -9], neck: [0, 0, -30], head: [0, 0, 24], jaw: [0, 0, -9] }, p: { hips: [-0.16, -0.2, 0], ...both('ikF', [0.14, 0, 0]), face: [0.1, 1, 1] } },
        { t: 0.3, r: { spine: [0, 0, -2], chest: [4, 0, -4], neck: [6, 0, -36], head: [8, 0, 30], jaw: [0, 0, -4] }, p: { hips: [-0.36, -0.24, 0], ...both('ikF', [0.1, 0, 0]), face: WINCE }, ease: 'snap' },
        { t: 1, r: { spine: [0, 0, -5], chest: [0, 0, -9], neck: [0, 0, -30], head: [0, 0, 24], jaw: [0, 0, -9] }, p: { hips: [-0.16, -0.2, 0], ...both('ikF', [0.14, 0, 0]), face: [0.1, 1, 1] } },
      ],
    },
    hit: {
      dur: 0.46,
      keys: [
        { t: 0, r: {} },
        { t: 0.22, r: { spine: [0, 0, 6], chest: [8, 10, 5], neck: [10, 22, 14], head: [14, 26, 10], jaw: [0, 0, -24] }, p: { hips: [-0.22, 0.02, 0], face: WINCE }, ease: 'snap' },
        { t: 0.55, r: { spine: [0, 0, 2], chest: [3, 4, 2], neck: [4, 8, 5], head: [5, 9, 3], jaw: [0, 0, -12] }, p: { hips: [-0.14, -0.03, 0], face: [0.3, 0.6, 0.8] } },
        { t: 1, r: {} },
      ],
    },
    hitHeavy: {
      dur: 0.85,
      keys: [
        { t: 0, r: {} },
        { t: 0.16, r: { spine: [10, 8, 10], chest: [14, 14, 8], neck: [20, 30, 20], head: [20, 30, 10], jaw: [0, 0, -32] }, p: { hips: [-0.5, 0.06, 0.08], face: [1, 0.5, 1] }, ease: 'snap' },
        { t: 0.45, r: { spine: [4, 4, -8], chest: [6, 6, -8], neck: [8, 12, -26], head: [8, 12, 4], jaw: [0, 0, -20] }, p: { hips: [-0.42, -0.3, 0.05], face: [0.6, 0.6, 1] } },
        { t: 0.75, r: { spine: [0, 0, -4], neck: [0, 0, -14], head: [0, 0, 6], jaw: [0, 0, -10] }, p: { hips: [-0.2, -0.14, 0], face: [0.2, 0.8, 0.8] } },
        { t: 1, r: {} },
      ],
    },
    stuffed: {
      dur: 0.5,
      keys: [
        { t: 0, r: { spine: [0, 0, 18], chest: [0, 0, 14], jaw: [0, 0, -20] }, p: { hips: [-0.1, 0, 0], ...both('ikF', [-0.1, H * 0.5, 0]), face: [0.5, 0.3, 1] } },
        { t: 0.3, r: { spine: [6, 8, 22], chest: [10, 12, 12], neck: [10, 24, 16], head: [12, 20, 10], jaw: [0, 0, -30] }, p: { hips: [-0.34, 0, 0], ...both('ikF', [-0.2, H * 0.4, 0]), face: WINCE }, ease: 'snap' },
        { t: 1, r: {} },
      ],
    },
    charge: {
      dur: 0.7,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 1, r: { spine: [0, 0, -10], chest: [0, 0, -12], neck: [0, 0, -30], head: [0, 0, 26], jaw: [0, 0, -16], ...tailUp(16) }, p: { hips: [-0.3, -0.28, 0], ...both('ikF', [0.18, 0, 0]), face: ANGRY }, ease: 'out' },
      ],
    },
    pounce: {
      dur: 0.8,
      keys: [
        { t: 0, r: { spine: [0, 0, -10], chest: [0, 0, -12], neck: [0, 0, -30], head: [0, 0, 26], jaw: [0, 0, -16] }, p: { hips: [-0.3, -0.28, 0], face: ANGRY } },
        { t: 0.28, r: { spine: [0, 0, 16], chest: [0, 0, 12], neck: [0, 0, 6], head: [0, 0, -16], jaw: [0, 0, -46], ...tailUp(-8) }, p: { hips: [0.35, 0.3, 0], ...both('ikF', [0.5, H * 0.7, 0]), ...both('ikH', [-0.35, H * 0.25, 0]), face: ANGRY }, ease: 'snap' },
        { t: 0.46, r: { spine: [0, 0, -4], chest: [0, 0, -8], neck: [0, 0, -8], head: [0, 0, -22], jaw: [0, 0, -4] }, p: { hips: [0.62, -0.1, 0], ...both('ikF', [0.75, 0.05, 0]), face: [0.4, 1, 1] }, ease: 'snap' },
        { t: 0.6, r: { spine: [0, 0, -3], chest: [8, 0, -6], neck: [14, 0, -10], head: [28, 0, -18], jaw: [0, 0, -3] }, p: { hips: [0.6, -0.1, 0], ...both('ikF', [0.72, 0.05, 0]), face: [0.4, 1, 1] } },
        { t: 0.76, r: { spine: [0, 0, -3], chest: [-8, 0, -6], neck: [-14, 0, -10], head: [-28, 0, -18], jaw: [0, 0, -3] }, p: { hips: [0.56, -0.1, 0], ...both('ikF', [0.7, 0.05, 0]), face: [0.2, 1, 1] } },
        { t: 1, r: {} },
      ],
      events: [[0.45, 'hit']],
    },
    ko: {
      dur: 1.5,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 0.18, r: { spine: [0, 0, 6], neck: [0, 10, 16], head: [0, 14, 12], jaw: [0, 0, -34] }, p: { hips: [-0.2, 0.02, 0], face: [1, 0.4, 1] }, ease: 'snap' },
        { t: 0.45, r: { spine: [6, 0, -6], neck: [0, 0, -30], head: [0, 0, -12], jaw: [0, 0, -22] }, p: { hips: [-0.3, -0.42 * H, 0], ikOff: [0.3, 0, 0], face: [1, 0, 1] } },
        { t: 0.72, r: { hips: [62, 0, 0], spine: [8, 6, -4], neck: [0, 0, -34], head: [10, 0, -20], jaw: [0, 0, -18] }, p: { hips: [-0.34, -0.6 * H, G * 0.5], ikOff: [1, 0, 0], face: [1, 0, 1] }, ease: 'in' },
        { t: 0.82, r: { hips: [82, 0, 0], spine: [10, 8, -4], neck: [0, 0, -40], head: [14, 0, -24], jaw: [0, 0, -22], ...tailUp(-6) }, p: { hips: [-0.34, -(H - G * 0.75), G * 0.6], ikOff: [1, 0, 0], face: [1, 0, 1] }, ease: 'out' },
        { t: 1, r: { hips: [80, 0, 0], spine: [10, 8, -4], neck: [0, 0, -38], head: [14, 0, -24], jaw: [0, 0, -14], ...tailUp(-6) }, p: { hips: [-0.34, -(H - G * 0.75), G * 0.6], ikOff: [1, 0, 0], face: [1, 0, 1] } },
      ],
      events: [[0.78, 'thud']],
    },
    victory: {
      dur: 2.2,
      keys: [
        { t: 0, r: {} },
        { t: 0.2, r: { spine: [0, 0, 20], chest: [0, 0, 18], neck: [0, 0, 10], head: [0, 0, 14], jaw: [0, 0, -44], ...tailUp(16) }, p: { hips: [-0.1, 0.02, 0], ...both('ikF', [0, H * 0.7, 0]), face: ANGRY }, ease: 'snap' },
        { t: 0.6, r: { spine: [0, 0, 22], chest: [0, 0, 20], neck: [0, 6, 12], head: [4, 8, 16], jaw: [0, 0, -40], ...tailUp(16) }, p: { hips: [-0.1, 0.02, 0], ...both('ikF', [0, H * 0.75, 0]), face: [0, 0.8, 0.8] } },
        { t: 0.78, r: { spine: [0, 0, -4], chest: [0, 0, -6], jaw: [0, 0, -10] }, p: { hips: [0.1, -0.1, 0], ...both('ikF', [0.2, 0, 0]), face: [0.55, 0, 0] }, ease: 'snap' },
        { t: 1, r: {} },
      ],
      events: [
        [0.18, 'roar'],
        [0.77, 'stomp'],
      ],
    },
  }
}
