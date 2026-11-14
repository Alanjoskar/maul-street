// The upright brute: boulder apes and storm yetis. A barrel chest under a
// mountain of shoulder, long arms that end in huge fists, short thick legs,
// and a head set low and forward between the shoulders.

import * as THREE from 'three'
import { ball, loft, rails, tuft, TAPER } from './shape.js'
import { Body, addPos, addRot, pair } from './rig.js'
import { Coat, buildHead, crystalPaint, crystals, faceAlive, faceLife, ruff } from './parts.js'
import { add3, bolt, crown, crownAlive, emberPaint, flamePaint, mix3, platePaint, ramHorns, shell, spinePoints } from './features.js'

const DEG = Math.PI / 180

export function buildBiped(S) {
  const body = new Body()
  const coat = new Coat(S)
  const G = S.girth
  const W = S.shoulders
  const hs = S.head
  const lt = S.limb ?? 1
  const legLen = S.leg
  const hipY = legLen + G * 0.2
  const T = S.torso
  const lean = (S.hunch ?? 18) * DEG
  const up = [Math.sin(lean), Math.cos(lean), 0]
  const at = (k) => [up[0] * T * k, hipY + up[1] * T * k, 0]
  const B = (n) => body.b(n)

  // ----- Spine and head ------------------------------------------------------------
  body.bone('hips', null, [0, hipY, 0])
  body.bone('spine', 'hips', at(0.42))
  const chestAt = at(0.82)
  body.bone('chest', 'spine', chestAt)
  const neckAt = [chestAt[0] + G * 0.55, chestAt[1] + G * 0.42, 0]
  body.bone('neck', 'chest', neckAt)
  const headAt = [neckAt[0] + hs * 0.28, neckAt[1] + hs * 0.12, 0]
  body.bone('head', 'neck', headAt)
  const ha = (S.headAngle ?? -4) * DEG
  const head = buildHead(body, S, coat, { o: [headAt[0] + hs * 0.12, headAt[1] + hs * 0.06], a: ha })

  // ----- Torso: pelvis, belly, a barrel chest and the hump of the shoulders ---------
  const belly = [Math.cos(lean), -Math.sin(lean) * 0.6, 0]
  const torsoSpec = {
    points: [
      { p: [-G * 0.08, hipY - G * 0.5, 0], r: [G * 0.6, G * 0.55, G * 0.55], bone: B('hips') },
      { p: [0, hipY, 0], r: [G * 0.88, G * 0.78, G * 0.86], bone: B('hips') },
      { p: at(0.42), r: [G * 0.98 * (S.waist ?? 1), G * 0.82, G * 1.02], bone: B('spine') },
      { p: at(0.74), r: [W * 1.0, G * 1.0, G * 1.05], bone: B('chest') },
      { p: add3(at(0.98), [G * 0.05, 0, 0]), r: [W * 0.82, G * 0.92, G * 0.82], bone: B('chest') },
      { p: [headAt[0] - hs * 0.12, headAt[1] - hs * 0.08, 0], r: [hs * 0.42, hs * 0.4, hs * 0.42], bone: B('head') },
    ],
    span: 7,
    up: [-Math.cos(lean), Math.sin(lean), 0],
  }
  const torso = rails(torsoSpec)
  body.add('hide', loft({ ...torsoSpec, rails: torso, radial: 34, paint: coat.part('body', { belly }), uv: [1.4, 4] }), { outer: true })

  // ----- Arms ------------------------------------------------------------------------
  const armLen = S.arm
  const sh = [chestAt[0] + G * 0.05, chestAt[1] + G * 0.28]
  const el = [sh[0] + armLen * 0.1, sh[1] - armLen * 0.46]
  const wr = [el[0] + armLen * 0.28, el[1] - armLen * 0.4]
  const fistR = G * 0.5 * (S.fist ?? 1)
  for (const side of [1, -1]) {
    const x = side === 1 ? 'L' : 'R'
    const z = W * 0.92 * side
    body.bone(`shoulder${x}`, 'chest', [sh[0], sh[1], z])
    body.bone(`elbow${x}`, `shoulder${x}`, [el[0], el[1], z * 1.1])
    body.bone(`wrist${x}`, `elbow${x}`, [wr[0], wr[1], z * 1.06])
    const fa = S.forearm ?? 1.2
    body.add(
      'hide',
      loft({
        points: [
          { p: [sh[0] - G * 0.1, sh[1] + G * 0.2, z * 0.6], r: [G * 0.5, G * 0.5, G * 0.5], bone: B(`shoulder${x}`) },
          { p: [sh[0], sh[1] - G * 0.05, z * 0.98], r: [G * 0.5 * lt, G * 0.5 * lt, G * 0.52 * lt], bone: B(`shoulder${x}`) },
          { p: [(sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2, z * 1.06], r: [G * 0.36 * lt, G * 0.36 * lt, G * 0.38 * lt], bone: B(`shoulder${x}`) },
          { p: [el[0], el[1], z * 1.1], r: [G * 0.3 * lt, G * 0.31 * lt, G * 0.32 * lt], bone: B(`elbow${x}`) },
          { p: mix3([el[0], el[1], z * 1.1], [wr[0], wr[1], z * 1.06], 0.45), r: [G * 0.4 * fa * lt, G * 0.42 * fa * lt, G * 0.4 * fa * lt], bone: B(`elbow${x}`) },
          { p: [wr[0], wr[1], z * 1.06], r: [G * 0.3 * fa * lt, G * 0.3 * fa * lt, G * 0.3 * fa * lt], bone: B(`wrist${x}`) },
        ],
        span: 4,
        radial: 20,
        up: [1, 0, 0],
        paint: coat.part('arm', { side }),
        uv: [1.4, 2],
      }),
      { outer: true },
    )
    // A fist: a rounded block with four knuckles and a thumb.
    const fc = [wr[0] + fistR * 0.6, wr[1] - fistR * 0.75, z * 1.06]
    const fistPaint = coat.part('fist', { side, base: 'side' })
    body.add('hide', ball({ at: fc, r: [fistR * 0.95, fistR * 0.88, fistR * 0.84], bone: B(`wrist${x}`), paint: fistPaint, around: 16, rings: 10 }))
    for (let k = 0; k < 4; k++) {
      const kz = fc[2] + (k - 1.5) * fistR * 0.42
      body.add('hide', ball({ at: [fc[0] + fistR * 0.7, fc[1] - fistR * 0.28, kz], r: [fistR * 0.3, fistR * 0.32, fistR * 0.22], bone: B(`wrist${x}`), paint: fistPaint, around: 10, rings: 6 }))
    }
    body.add('hide', ball({ at: [fc[0] + fistR * 0.35, fc[1] + fistR * 0.25, fc[2] + side * fistR * 0.7], r: [fistR * 0.42, fistR * 0.26, fistR * 0.26], bone: B(`wrist${x}`), paint: fistPaint, around: 10, rings: 6 }))
    if (S.knuckles?.size > 0.01) {
      // Crystal or stone knuckle-guards.
      crystals(body, [0, 1, 2].map((k) => ({ p: [fc[0] + fistR * 0.55, fc[1] + fistR * 0.35, fc[2] + (k - 1) * fistR * 0.5], up: [0.75, 0.6, (k - 1) * 0.3], bone: B(`wrist${x}`), s: 1 - Math.abs(k - 1) * 0.25 })), { size: fistR * 0.7 * S.knuckles.size, paint: crystalPaint(coat), seed: k3(side), extra: 0 })
    }
  }

  // ----- Legs -----------------------------------------------------------------------
  const legs = []
  const footS = G * 0.5 * (S.paw ?? 1)
  const ankleY = footS * 0.6
  for (const side of [1, -1]) {
    const x = side === 1 ? 'L' : 'R'
    const hz = G * 0.6 * side
    const hip = [-G * 0.05, hipY - G * 0.2]
    const knee = [legLen * 0.16, ankleY + (hip[1] - ankleY) * 0.5]
    const ankle = [-legLen * 0.02, ankleY]
    body.bone(`thigh${x}`, 'hips', [hip[0], hip[1], hz])
    body.bone(`shin${x}`, `thigh${x}`, [knee[0], knee[1], hz * 1.06])
    body.bone(`foot${x}`, `shin${x}`, [ankle[0], ankle[1], hz * 1.08])
    legs.push({ key: `ikL${x}`, names: [`thigh${x}`, `shin${x}`, `foot${x}`], a: [knee[0] - hip[0], knee[1] - hip[1]], b: [ankle[0] - knee[0], ankle[1] - knee[1]], bend: 1, restFoot: new THREE.Vector3(ankle[0], ankle[1], hz * 1.08) })
    body.add(
      'hide',
      loft({
        points: [
          { p: [hip[0] - G * 0.05, hip[1] + G * 0.3, hz * 0.7], r: [G * 0.5, G * 0.55, G * 0.55], bone: B(`thigh${x}`) },
          { p: [(hip[0] + knee[0]) / 2, (hip[1] + knee[1]) / 2, hz], r: [G * 0.46 * lt, G * 0.48 * lt, G * 0.5 * lt], bone: B(`thigh${x}`) },
          { p: [knee[0], knee[1], hz * 1.06], r: [G * 0.34 * lt, G * 0.34 * lt, G * 0.36 * lt], bone: B(`shin${x}`) },
          { p: [(knee[0] + ankle[0]) / 2, (knee[1] + ankle[1]) / 2, hz * 1.07], r: [G * 0.32 * lt, G * 0.3 * lt, G * 0.36 * lt], bone: B(`shin${x}`) },
          { p: [ankle[0], ankle[1] + footS * 0.1, hz * 1.08], r: [G * 0.3 * lt, G * 0.3 * lt, G * 0.3 * lt], bone: B(`foot${x}`) },
        ],
        span: 4,
        radial: 18,
        up: [1, 0, 0],
        paint: coat.part('leg', { side }),
        uv: [1.4, 2],
      }),
      { outer: true },
    )
    // A broad flat foot with three round toes.
    const fz = hz * 1.08
    const footPaint = coat.part('paw', { side, base: 'side' })
    body.add('hide', loft({ points: [{ p: [ankle[0] - footS * 0.5, footS * 0.35, fz], r: [footS * 0.48, footS * 0.36, footS * 0.32] }, { p: [ankle[0] + footS * 0.3, footS * 0.32, fz], r: [footS * 0.62, footS * 0.34, footS * 0.3] }, { p: [ankle[0] + footS * 0.95, footS * 0.24, fz], r: [footS * 0.56, footS * 0.25, footS * 0.22] }], sq: 2.6, bone: B(`foot${x}`), radial: 16, span: 3, paint: footPaint }))
    for (let k = 0; k < 3; k++) {
      body.add('hide', ball({ at: [ankle[0] + footS * 1.2 - Math.abs(k - 1) * footS * 0.12, footS * 0.2, fz + (k - 1) * footS * 0.42], r: [footS * 0.3, footS * 0.2, footS * 0.2], bone: B(`foot${x}`), paint: footPaint, around: 10, rings: 6 }))
    }
  }

  // ----- What grows on it --------------------------------------------------------------
  // A ruff of fur, flame or storm across the shoulders and down the back.
  const M = S.mane
  if (M && M.size > 0.01) {
    const paint = M.kind === 'storm' ? emberPaint(coat, { root: 'top', mid: 'side' }) : M.kind === 'flame' ? flamePaint(coat) : coat.part('mane', { base: M.tone ?? 'top' })
    for (let row = 0; row < (M.rows ?? 2); row++) {
      ruff(body, {
        material: M.kind === 'flame' ? 'flame' : 'hide',
        centre: add3(at(0.95 - row * 0.12), [-G * (0.15 + row * 0.1), 0, 0]),
        axis: [-0.3, 1, 0],
        up: [-1, 0.25, 0],
        radius: W * (0.62 + row * 0.12),
        squash: 1.15,
        count: (M.count ?? 13) + row * 2,
        from: -70,
        to: 70,
        len: M.size * (1 - row * 0.12),
        width: M.size * (M.width ?? 0.4),
        thick: M.size * 0.16,
        lean: (M.lean ?? 74) + row * 5,
        bone: B('chest'),
        paint,
        taper: TAPER.lock,
        jitter: 0.25,
        seed: row + S.seed,
        bow: 0.2,
      })
    }
  }
  // Crystals or spines growing from the back.
  const C = S.crest
  if (C && C.size > 0.01) {
    // The rails run pelvis to head; the back is on the side away from the belly.
    const back = spinePoints(torso, { from: C.from ?? 0.3, to: C.to ?? 0.82, count: C.count ?? 5, size: (t, i) => 0.75 + 0.25 * Math.sin(i * 1.7), lift: -G * 0.05 })
    if (C.kind === 'crystal') {
      crystals(body, back, { size: C.size, paint: crystalPaint(coat), seed: S.seed, lean: [-0.35, 0.1, 0] })
      if (C.rows === 3) {
        for (const side of [1, -1]) {
          const flank = spinePoints(torso, { from: (C.from ?? 0.3) + 0.12, to: (C.to ?? 0.82) - 0.05, count: Math.max(2, (C.count ?? 5) - 2), v: side > 0 ? 0.12 : 0.88, size: () => 0.62, lift: -G * 0.05 })
          crystals(body, flank, { size: C.size, paint: crystalPaint(coat), seed: S.seed + side, lean: [-0.3, 0, 0.3 * side], extra: 0 })
        }
      }
    } else if (C.kind === 'bolts') {
      for (const pt of back) bolt(body, { base: pt.p, dir: add3(pt.up, pt.back, 0.7), side: [0, 0, 1], len: C.size * pt.s, width: C.size * 0.14, bone: pt.bone, paint: flamePaint(coat, { root: 'accent', tip: 'hot' }) })
    }
  }
  // Boulders or shells on the shoulders.
  const P = S.plates
  if (P && P.size > 0.01) {
    const rock = coat.part('rock', { base: 'plate' })
    for (const side of [1, -1]) {
      const x = side === 1 ? 'L' : 'R'
      if (P.kind === 'boulder') {
        const s = G * P.size
        const rocks = [
          [-0.1, 0.42, 0.98, 0.5],
          [0.22, 0.3, 1.08, 0.36],
          [-0.42, 0.28, 0.92, 0.34],
        ]
        for (const [dx, dy, dz, r] of rocks) body.add('hide', ball({ at: [sh[0] + dx * G, sh[1] + dy * G, W * dz * side], r: [s * r * 1.1, s * r * 0.86, s * r], bone: B(`shoulder${x}`), paint: rock, around: 14, rings: 9 }))
      } else shell(body, { at: [sh[0] - G * 0.1, sh[1] + G * 0.4, W * 0.98 * side], normal: [-0.15, 1, 0.65 * side], along: [1, 0.15, 0], len: G * 1.15 * P.size, wide: G * 0.66 * P.size, thick: G * 0.36 * P.size, bone: B(`shoulder${x}`), paint: platePaint(coat, { seam: P.seam ?? 0 }), curl: 0.42 })
      if (P.forearm) shell(body, { at: mix3([el[0], el[1], W * 1.02 * side], [wr[0], wr[1], W * 0.98 * side], 0.45), normal: [0.2, 0.15, side], along: [wr[0] - el[0], wr[1] - el[1], 0], len: armLen * 0.36 * P.size, wide: G * 0.36 * P.size, thick: G * 0.12, bone: B(`elbow${x}`), paint: platePaint(coat, { seam: P.seam ?? 0 }) })
    }
  }
  const FL = S.forelock
  if (FL && FL.size > 0.01) {
    const n = FL.count ?? 3
    for (let i = 0; i < n; i++) {
      const kk = n === 1 ? 0 : i / (n - 1) - 0.5
      const base = head.Q(0.02 - Math.abs(kk) * 0.12, 0.42 - Math.abs(kk) * 0.05, kk * 0.2)
      const len = hs * FL.size * (1 - Math.abs(kk) * 0.5)
      body.add('hide', tuft({ base, tip: add3(base, head.D(0.15, 1, kk * 0.9), len), bend: head.D(0.2 * len, 0, 0), width: len * 0.5, thick: len * 0.22, bone: B('head'), face: head.D(1, 0.2, kk), taper: TAPER.puff, radial: 8, paint: coat.part('mane', { base: 'side' }) }))
    }
  }
  if (S.horns?.kind === 'ram' && S.horns.size > 0.01) ramHorns(body, coat, head, { size: S.horns.size, bone: B('head'), turns: S.horns.turns ?? 0.85, glowTip: S.horns.glowTip ?? 0 })
  if (S.crown) crown(body, S, coat, head, { kind: S.crown, size: S.crownSize ?? 1, lift: S.crownLift ?? 0 })

  body.socket('chest', 'chest', [chestAt[0] + G * 0.9, chestAt[1] - G * 0.2, 0])
  body.socket('back', 'chest', [chestAt[0] - G * 0.9, chestAt[1], 0])
  body.socket('belly', 'spine', [at(0.42)[0] + G * 0.95, at(0.42)[1], 0])
  body.socket('pawL', 'wristL', [wr[0] + fistR * 0.6, wr[1] - fistR * 0.75, W * 0.98])
  body.socket('pawR', 'wristR', [wr[0] + fistR * 0.6, wr[1] - fistR * 0.75, -W * 0.98])
  body.socket('tail', 'hips', [-G * 0.8, hipY - G * 0.1, 0])

  const top = Math.max(headAt[1] + hs * 0.62, chestAt[1] + G)
  return {
    body,
    legs,
    clips: CLIPS(top),
    alive: aliveBiped(S),
    meta: { height: top, length: 2.0, reach: Math.max(head.Q(head.tipF, 0)[0], wr[0] + fistR * 1.2) + 0.3, chest: chestAt[1] - G * 0.2, shoulder: sh[1] + G * 0.4 },
  }
}

const k3 = (side) => (side > 0 ? 3 : 5)

function aliveBiped(S) {
  const life = faceLife(S)
  const bounce = S.life.bounce
  const slow = 1 - S.life.heavy * 0.35
  const crownKind = S.crown || null
  return (pose, t, st) => {
    const calm = st.calm ?? 1
    const breath = Math.sin(t * (1.4 + (1 - calm) * 1.4) * slow)
    const hop = Math.pow(Math.abs(Math.sin(t * 2.4)), 1.5) * bounce * calm
    addPos(pose, 'hips', 0, breath * 0.014 - 0.012 + hop * 0.035, 0)
    addRot(pose, 'spine', 0, 0, breath * 0.8 - 4)
    addRot(pose, 'chest', 0, Math.sin(t * 0.5 * slow) * 2, breath * 1.4 - 5)
    addRot(pose, 'neck', 0, Math.sin(t * 0.6 * slow) * 5 * calm, 3)
    const cock = Math.pow(Math.max(0, Math.sin(t * 0.55 + 0.6)), 4) * 16 * bounce * calm
    addRot(pose, 'head', Math.sin(t * 0.8) * 2 + cock, Math.sin(t * 0.45 + 1) * 6 * calm, 4 + Math.sin(t * 1.1) * 2)
    addRot(pose, 'jaw', 0, 0, -2 - breath * 1.6 - (1 - calm) * 7)
    // Arms hang heavy and swing a little out of step; a cub's bounce with it.
    addRot(pose, 'shoulderL', -8, 0, 8 + Math.sin(t * 1.4 * slow) * 2.5 + hop * 6)
    addRot(pose, 'shoulderR', 8, 0, 8 + Math.sin(t * 1.4 * slow + 1.4) * 2.5 + hop * 6)
    addRot(pose, 'elbowL', 0, 0, 22 + Math.sin(t * 1.4 + 0.5) * 3)
    addRot(pose, 'elbowR', 0, 0, 22 + Math.sin(t * 1.4 + 1.9) * 3)
    faceAlive(pose, t, st, life)
    if (crownKind) crownAlive(pose, t, crownKind)
    const tremble = st.tremble ?? 0
    if (tremble > 0) {
      addPos(pose, 'hips', Math.sin(t * 47) * 0.008 * tremble, Math.sin(t * 53) * 0.006 * tremble - 0.04 * tremble, 0)
      addRot(pose, 'chest', 0, 0, Math.sin(t * 41) * 1.0 * tremble)
      addRot(pose, 'shoulderL', -6 * tremble, 0, 0)
      addRot(pose, 'shoulderR', 6 * tremble, 0, 0)
    }
    const run = st.run ?? 0
    if (run > 0) {
      const ph = t * 13
      addPos(pose, 'ikLL', Math.cos(ph) * 0.45 * run, Math.max(0, Math.sin(ph)) * 0.4 * run, 0)
      addPos(pose, 'ikLR', Math.cos(ph + Math.PI) * 0.45 * run, Math.max(0, Math.sin(ph + Math.PI)) * 0.4 * run, 0)
      addPos(pose, 'hips', 0, Math.abs(Math.sin(ph)) * 0.08 * run - 0.08 * run, 0)
      addRot(pose, 'spine', 0, 0, -14 * run)
      addRot(pose, 'shoulderL', 0, 0, Math.sin(ph + Math.PI) * 30 * run)
      addRot(pose, 'shoulderR', 0, 0, Math.sin(ph) * 30 * run)
    }
  }
}

const ANGRY = [0, 1, 1]
const WINCE = [0.85, 0.5, 1]

function CLIPS(H) {
  const arms = (s, e, w = [0, 0, 0]) => ({ ...pair('shoulder', s), ...pair('elbow', e), ...pair('wrist', w) })
  const feet = (v) => ({ ikLL: v, ikLR: v })
  return {
    land: {
      dur: 0.6,
      keys: [
        { t: 0, r: { spine: [0, 0, -18], chest: [0, 0, -12], ...arms([0, 0, 30], [0, 0, 20]) }, p: { hips: [0, -0.18 * H, 0], face: [0.4, 0, 0.5] } },
        { t: 0.4, r: { spine: [0, 0, 4] }, p: { hips: [0, 0.02, 0] }, ease: 'out' },
        { t: 1, r: {} },
      ],
    },
    roar: {
      // Beats its chest, then bellows at the sky.
      dur: 1.9,
      keys: [
        { t: 0, r: {} },
        { t: 0.12, r: { chest: [0, 0, 6], shoulderL: [20, 0, 50], elbowL: [0, 0, 110], shoulderR: [-10, 0, 20], elbowR: [0, 0, 60], jaw: [0, 0, -14] }, p: { face: [0.2, 0.6, 0.6] } },
        { t: 0.2, r: { chest: [0, 0, 6], shoulderL: [10, 0, 20], elbowL: [0, 0, 60], shoulderR: [-20, 0, 50], elbowR: [0, 0, 110], jaw: [0, 0, -14] }, p: { face: [0.2, 0.6, 0.6] }, ease: 'snap' },
        { t: 0.28, r: { chest: [0, 0, 6], shoulderL: [20, 0, 50], elbowL: [0, 0, 110], shoulderR: [-10, 0, 20], elbowR: [0, 0, 60], jaw: [0, 0, -14] }, p: { face: [0.2, 0.6, 0.6] }, ease: 'snap' },
        { t: 0.36, r: { chest: [0, 0, 6], shoulderL: [10, 0, 20], elbowL: [0, 0, 60], shoulderR: [-20, 0, 50], elbowR: [0, 0, 110], jaw: [0, 0, -14] }, p: { face: [0.2, 0.6, 0.6] }, ease: 'snap' },
        { t: 0.52, r: { spine: [0, 0, 14], chest: [0, 0, 16], neck: [0, 0, 16], head: [0, 0, 22], jaw: [0, 0, -44], ...arms([-38, 0, -20], [0, 0, 30]) }, p: { hips: [-0.05, 0.03, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.85, r: { spine: [0, 0, 12], chest: [0, 6, 14], neck: [0, 6, 14], head: [0, 8, 20], jaw: [0, 0, -40], ...arms([-36, 0, -18], [0, 0, 28]) }, p: { hips: [-0.05, 0.03, 0], face: ANGRY } },
        { t: 1, r: {} },
      ],
      events: [
        [0.2, 'thump'],
        [0.28, 'thump'],
        [0.36, 'thump'],
        [0.5, 'roar'],
      ],
    },
    strike: {
      // A hooking right hand.
      dur: 0.72,
      keys: [
        { t: 0, r: {} },
        { t: 0.34, r: { spine: [0, 22, -4], chest: [0, 26, -4], neck: [0, -30, 0], shoulderR: [30, 0, -42], elbowR: [0, 0, 80], shoulderL: [-10, 0, 30], elbowL: [0, 0, 70] }, p: { hips: [-0.1, -0.06, 0], face: [0, 1, 1] } },
        { t: 0.5, r: { spine: [0, -24, -16], chest: [0, -34, -14], neck: [0, 34, 6], shoulderR: [-16, 0, 84], elbowR: [0, 0, 18], shoulderL: [-14, 0, -10], elbowL: [0, 0, 50] }, p: { hips: [0.32, -0.1, 0], ikLR: [0.5, 0, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.66, r: { spine: [0, -18, -12], chest: [0, -24, -10], neck: [0, 22, 4], shoulderR: [-10, 0, 60], elbowR: [0, 0, 30] }, p: { hips: [0.26, -0.08, 0], ikLR: [0.5, 0, 0], face: [0.2, 0.9, 0.8] } },
        { t: 1, r: {} },
      ],
      events: [[0.49, 'hit']],
    },
    claw: {
      // A backhand with the left.
      dur: 0.66,
      keys: [
        { t: 0, r: {} },
        { t: 0.34, r: { spine: [0, -20, -4], chest: [0, -26, -6], neck: [0, 26, 0], shoulderL: [-30, 0, 70], elbowL: [0, 0, 90] }, p: { hips: [-0.06, -0.05, 0], face: [0, 1, 1] } },
        { t: 0.5, r: { spine: [0, 22, -10], chest: [0, 30, -10], neck: [0, -28, 4], shoulderL: [-50, 0, 70], elbowL: [0, 0, 10] }, p: { hips: [0.26, -0.08, 0], ikLL: [0.42, 0, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.68, r: { spine: [0, 14, -6], chest: [0, 20, -6], shoulderL: [-36, 0, 50], elbowL: [0, 0, 24] }, p: { hips: [0.2, -0.06, 0], ikLL: [0.42, 0, 0], face: [0.2, 0.9, 0.8] } },
        { t: 1, r: {} },
      ],
      events: [[0.49, 'hit']],
    },
    heavy: {
      // Both fists, from over the head.
      dur: 1.15,
      keys: [
        { t: 0, r: {} },
        { t: 0.36, r: { spine: [0, 0, 16], chest: [0, 0, 18], neck: [0, 0, -14], jaw: [0, 0, -30], ...arms([-8, 0, 150], [0, 0, 40]) }, p: { hips: [-0.12, 0.04, 0], face: ANGRY } },
        { t: 0.52, r: { spine: [0, 0, 22], chest: [0, 0, 24], neck: [0, 0, -18], jaw: [0, 0, -36], ...arms([-6, 0, 168], [0, 0, 34]) }, p: { hips: [-0.16, 0.06, 0], face: ANGRY } },
        { t: 0.63, r: { spine: [0, 0, -34], chest: [0, 0, -30], neck: [0, 0, 26], jaw: [0, 0, -12], ...arms([6, 0, 62], [0, 0, 12]) }, p: { hips: [0.34, -0.12 * H * 0.5, 0], ...feet([0.2, 0, 0]), face: [0.5, 1, 1] }, ease: 'snap' },
        { t: 0.8, r: { spine: [0, 0, -26], chest: [0, 0, -22], neck: [0, 0, 20], ...arms([6, 0, 58], [0, 0, 14]) }, p: { hips: [0.3, -0.1 * H * 0.5, 0], ...feet([0.2, 0, 0]), face: [0.2, 0.9, 0.8] } },
        { t: 1, r: {} },
      ],
      events: [[0.62, 'hit']],
    },
    guard: {
      dur: 0.28,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 1, r: { spine: [0, 0, -12], chest: [0, 0, -12], neck: [0, 0, 16], ...arms([26, 0, 62], [0, 0, 108]) }, p: { hips: [-0.12, -0.14, 0], face: [0.1, 1, 1] }, ease: 'out' },
      ],
    },
    guardHit: {
      dur: 0.36,
      hold: true,
      keys: [
        { t: 0, r: { spine: [0, 0, -12], chest: [0, 0, -12], neck: [0, 0, 16], ...arms([26, 0, 62], [0, 0, 108]) }, p: { hips: [-0.12, -0.14, 0], face: [0.1, 1, 1] } },
        { t: 0.3, r: { spine: [0, 0, -4], chest: [0, 0, -6], neck: [0, 0, 12], ...arms([30, 0, 52], [0, 0, 116]) }, p: { hips: [-0.36, -0.16, 0], ...feet([-0.18, 0, 0]), face: WINCE }, ease: 'snap' },
        { t: 1, r: { spine: [0, 0, -12], chest: [0, 0, -12], neck: [0, 0, 16], ...arms([26, 0, 62], [0, 0, 108]) }, p: { hips: [-0.12, -0.14, 0], face: [0.1, 1, 1] } },
      ],
    },
    hit: {
      dur: 0.5,
      keys: [
        { t: 0, r: {} },
        { t: 0.2, r: { spine: [0, 10, 12], chest: [6, 14, 12], neck: [8, 20, 12], head: [10, 22, 8], jaw: [0, 0, -26], ...arms([-16, 0, -14], [0, 0, 30]) }, p: { hips: [-0.2, 0, 0], face: WINCE }, ease: 'snap' },
        { t: 0.55, r: { spine: [0, 4, 4], chest: [2, 6, 4], neck: [3, 8, 4], jaw: [0, 0, -12] }, p: { hips: [-0.12, -0.03, 0], face: [0.3, 0.6, 0.8] } },
        { t: 1, r: {} },
      ],
    },
    hitHeavy: {
      dur: 0.9,
      keys: [
        { t: 0, r: {} },
        { t: 0.16, r: { spine: [6, 14, 22], chest: [10, 20, 18], neck: [12, 26, 16], head: [14, 26, 10], jaw: [0, 0, -34], ...arms([-30, 0, -30], [0, 0, 40]) }, p: { hips: [-0.5, 0.02, 0.05], ...feet([-0.3, 0, 0]), face: [1, 0.5, 1] }, ease: 'snap' },
        { t: 0.48, r: { spine: [0, 6, -22], chest: [0, 8, -16], neck: [0, 10, 10], jaw: [0, 0, -22], ...arms([4, 0, 40], [0, 0, 30]) }, p: { hips: [-0.4, -0.3, 0], ...feet([-0.3, 0, 0]), face: [0.6, 0.6, 1] } },
        { t: 0.78, r: { spine: [0, 0, -10], chest: [0, 0, -8] }, p: { hips: [-0.2, -0.12, 0], ...feet([-0.15, 0, 0]), face: [0.2, 0.8, 0.8] } },
        { t: 1, r: {} },
      ],
    },
    stuffed: {
      dur: 0.52,
      keys: [
        { t: 0, r: { spine: [0, 0, 14], chest: [0, 0, 14], ...arms([-8, 0, 130], [0, 0, 40]) }, p: { face: [0.5, 0.3, 1] } },
        { t: 0.3, r: { spine: [4, 10, 22], chest: [8, 14, 18], neck: [8, 20, 10], jaw: [0, 0, -30], ...arms([-30, 0, 60], [0, 0, 60]) }, p: { hips: [-0.34, 0, 0], ...feet([-0.2, 0, 0]), face: WINCE }, ease: 'snap' },
        { t: 1, r: {} },
      ],
    },
    charge: {
      dur: 0.75,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 1, r: { spine: [0, 0, -16], chest: [0, 0, -14], neck: [0, 0, 22], jaw: [0, 0, -20], ...arms([-30, 0, -24], [0, 0, 70]) }, p: { hips: [-0.16, -0.18, 0], face: ANGRY }, ease: 'out' },
      ],
    },
    pounce: {
      // The Special: a leaping two-fisted ground slam.
      dur: 0.95,
      keys: [
        { t: 0, r: { spine: [0, 0, -16], chest: [0, 0, -14], ...arms([-30, 0, -24], [0, 0, 70]) }, p: { hips: [-0.16, -0.18, 0], face: ANGRY } },
        { t: 0.3, r: { spine: [0, 0, 20], chest: [0, 0, 22], neck: [0, 0, -16], jaw: [0, 0, -40], ...arms([-8, 0, 170], [0, 0, 30]) }, p: { hips: [0.2, 0.35, 0], ...feet([-0.1, 0.5, 0]), face: ANGRY }, ease: 'snap' },
        { t: 0.48, r: { spine: [0, 0, -40], chest: [0, 0, -34], neck: [0, 0, 30], jaw: [0, 0, -14], ...arms([6, 0, 58], [0, 0, 8]) }, p: { hips: [0.5, -0.1 * H, 0], ...feet([0.3, 0, 0]), face: [0.5, 1, 1] }, ease: 'snap' },
        { t: 0.75, r: { spine: [0, 0, -34], chest: [0, 0, -28], neck: [0, 0, 24], ...arms([6, 0, 56], [0, 0, 10]) }, p: { hips: [0.46, -0.09 * H, 0], ...feet([0.3, 0, 0]), face: [0.2, 1, 1] } },
        { t: 1, r: {} },
      ],
      events: [[0.47, 'hit']],
    },
    ko: {
      dur: 1.6,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 0.16, r: { spine: [0, 0, 14], chest: [0, 8, 14], neck: [0, 10, 14], jaw: [0, 0, -36], ...arms([-24, 0, -20], [0, 0, 30]) }, p: { hips: [-0.2, 0, 0], face: [1, 0.4, 1] }, ease: 'snap' },
        { t: 0.45, r: { spine: [0, 0, -18], chest: [0, 0, -16], neck: [0, 0, -10], jaw: [0, 0, -24], ...arms([0, 0, 20], [0, 0, 30]) }, p: { hips: [0.0, -0.16 * H, 0], ikOff: [0.3, 0, 0], face: [1, 0, 1] } },
        { t: 0.74, r: { hips: [0, 0, -70], spine: [0, 0, -10], chest: [0, 0, -6], neck: [0, 0, 16], head: [0, 20, 10], jaw: [0, 0, -14], ...arms([-30, 0, 110], [0, 0, 40]) }, p: { hips: [0.4, -0.25 * H, 0], ikOff: [1, 0, 0], face: [1, 0, 1] }, ease: 'in' },
        { t: 0.84, r: { hips: [0, 0, -88], spine: [0, 0, -6], chest: [0, 0, -2], neck: [0, 0, 14], head: [0, 30, 6], jaw: [0, 0, -18], ...arms([-40, 0, 130], [0, 0, 30]) }, p: { hips: [0.5, -0.29 * H, 0], ikOff: [1, 0, 0], face: [1, 0, 1] }, ease: 'out' },
        { t: 1, r: { hips: [0, 0, -88], spine: [0, 0, -6], chest: [0, 0, -2], neck: [0, 0, 14], head: [0, 30, 6], jaw: [0, 0, -10], ...arms([-40, 0, 130], [0, 0, 30]) }, p: { hips: [0.5, -0.29 * H, 0], ikOff: [1, 0, 0], face: [1, 0, 1] } },
      ],
      events: [[0.8, 'thud']],
    },
    victory: {
      dur: 2.3,
      keys: [
        { t: 0, r: {} },
        { t: 0.2, r: { spine: [0, 0, 16], chest: [0, 0, 18], neck: [0, 0, 14], head: [0, 0, 20], jaw: [0, 0, -44], ...arms([-50, 0, 130], [0, 0, 50]) }, p: { hips: [-0.05, 0.03, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.62, r: { spine: [0, 0, 14], chest: [0, 6, 16], neck: [0, 6, 12], head: [0, 8, 18], jaw: [0, 0, -40], ...arms([-48, 0, 126], [0, 0, 54]) }, p: { hips: [-0.05, 0.03, 0], face: [0, 0.8, 0.8] } },
        { t: 0.8, r: { spine: [0, 0, -14], chest: [0, 0, -12], ...arms([4, 0, 50], [0, 0, 16]) }, p: { hips: [0.14, -0.1, 0], face: [0.55, 0, 0] }, ease: 'snap' },
        { t: 1, r: {} },
      ],
      events: [
        [0.18, 'roar'],
        [0.79, 'stomp'],
      ],
    },
  }
}

