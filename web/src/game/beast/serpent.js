// The serpent: a long body coiled on the sand with its front third reared up.
// No legs. Everything it does, it does with its spine. Sea serpents spread a
// frill of fins; lava wyrms burn along the back and at the tail.

import { loft, rails, tuft, TAPER } from './shape.js'
import { Body, addRot } from './rig.js'
import { Coat, buildHead, bump, faceAlive, faceLife, ridge, sm } from './parts.js'
import { add3, crown, crownAlive, fan, finPaint, flamePaint, platePaint, shell, spinePoints, sweptHorns } from './features.js'

const REAR = 8
const FRONT = 5
const DEG = Math.PI / 180
// Bone names, made once, so the living motion builds no strings while it runs.
const FRONTS = ['', 'f1', 'f2', 'f3', 'f4', 'f5']
const REARS = ['', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']

export function buildSerpent(S) {
  const body = new Body()
  const coat = new Coat(S)
  const R = S.girth
  const hs = S.head
  const B = (n) => body.b(n)

  // ----- The spine: a rising S in front, a lazy S on the ground behind ----------------
  body.bone('base', null, [0, R * 0.95, 0])
  const rise = S.rise ?? 1
  const frontPts = [
    [0.42, R * 1.15, 0],
    [0.72, 0.75 * rise + R * 0.4, 0],
    [0.7, 1.35 * rise, 0],
    [0.48, 1.88 * rise, 0],
    [0.5, 2.3 * rise, 0],
  ]
  frontPts.forEach((p, i) => body.bone(`f${i + 1}`, i === 0 ? 'base' : `f${i}`, p))
  const headAt = [frontPts[4][0] + hs * 0.3, frontPts[4][1] + hs * 0.28, 0]
  body.bone('head', `f${FRONT}`, headAt)
  const ha = (S.headAngle ?? -10) * DEG
  const head = buildHead(body, S, coat, { o: [headAt[0] + hs * 0.18, headAt[1] + hs * 0.04], a: ha })

  const seg = S.length / REAR
  const rearPts = []
  for (let i = 1; i <= REAR; i++) {
    const a = i * 0.82
    rearPts.push([-0.25 - seg * i * 0.82, Math.max(0.05, R * (0.95 - i * 0.1)), Math.sin(a) * (S.coil ?? 0.9) * (0.5 + i * 0.07)])
  }
  rearPts.forEach((p, i) => body.bone(`r${i + 1}`, i === 0 ? 'base' : `r${i}`, p))

  // ----- Skin: one loft from the tail tip to the back of the head ------------------------
  const hood = S.hood ?? 0
  const path = []
  for (let i = REAR - 1; i >= 0; i--) {
    const k = (i + 1) / REAR
    path.push({ p: rearPts[i], r: R * (1 - k * 0.88) + 0.025, bone: B(`r${i + 1}`) })
  }
  path.push({ p: [0, R * 0.95, 0], r: [R * 1.02, R * 0.96, R * 0.96], bone: B('base') })
  const frontR = [1.02, 0.98, 0.9, 0.8, 0.72]
  frontPts.forEach((p, i) => {
    // A hood: the neck flattens and spreads below the head.
    const spread = i >= 2 ? 1 + hood * [0, 0, 0.45, 1.1, 0.7][i] : 1
    const thin = i >= 2 ? 1 - hood * [0, 0, 0.1, 0.28, 0.16][i] : 1
    path.push({ p, r: [R * frontR[i] * spread, R * frontR[i] * thin, R * frontR[i] * thin], bone: B(`f${i + 1}`) })
  })
  path.push({ p: [headAt[0] - hs * 0.05, headAt[1] - hs * 0.02, 0], r: [hs * 0.4, hs * 0.38, hs * 0.38], bone: B('head') })
  const keel = S.ridge ?? 0.04
  const bodySpec = { points: path, span: 5, up: [0, 1, 0], shape: (u, v) => 1 + keel * (bump(v, 0, 0.07) + bump(v, 1, 0.07)) - 0.07 * bump(v, 0.5, 0.2) }
  const spine = rails(bodySpec)
  body.add('hide', loft({ ...bodySpec, rails: spine, radial: 26, capStart: 'round', capLength: [2.2, 0.9], paint: coat.part('body', { by: 'v' }), uv: [1.6, 3] }), { outer: true })

  // ----- Along the back ---------------------------------------------------------------------
  // The rails run tail to head; the back is v = 0 all the way up.
  const C = S.crest
  if (C && C.size > 0.01) {
    const pts = spinePoints(spine, { from: C.from ?? 0.12, to: C.to ?? 0.86, count: C.count ?? 12, size: (t) => 0.45 + 0.55 * sm(0.1, 0.6, t), lift: -R * 0.06 })
    if (C.kind === 'fin') {
      // A sail of fin down the back, on ribs.
      const ribs = pts.map((pt) => {
        const h = C.size * pt.s
        const root = add3(pt.p, pt.up, -R * 0.06)
        return [root, add3(add3(root, pt.up, h * 0.55), pt.back, h * 0.15), add3(add3(root, pt.up, h), pt.back, h * 0.45)]
      })
      fan(body, coat, { ribs, bones: pts.map((pt) => pt.bone), paint: finPaint(coat, { streaks: 0 }), ribRadius: R * 0.03, sag: 0.02, detail: 3 })
    } else {
      ridge(body, pts, { material: C.kind === 'flame' ? 'flame' : 'hard', len: C.size, width: C.size * (C.width ?? 0.36), thick: C.size * 0.12, lean: C.lean ?? 40, paint: C.kind === 'flame' ? flamePaint(coat) : coat.part('crest', { base: 'horn' }), taper: C.kind === 'flame' ? TAPER.flame : TAPER.blade })
    }
  }
  // Armour plates down the reared neck (later forms).
  const P = S.plates
  if (P && P.size > 0.01) {
    const pts = spinePoints(spine, { from: P.from ?? 0.6, to: P.to ?? 0.9, count: P.count ?? 4, size: (t) => 0.55 + 0.45 * sm(0.05, 0.5, t) })
    for (const pt of pts) shell(body, { at: add3(pt.p, pt.up, R * 0.03), normal: pt.up, along: [-pt.back[0], -pt.back[1], -pt.back[2]], len: R * 0.95 * P.size * pt.s, wide: R * 0.78 * P.size * pt.s, thick: R * 0.16 * P.size * pt.s, bone: pt.bone, paint: platePaint(coat, { seam: P.seam ?? 0 }), curl: 0.35 })
  }

  // ----- Frill and horns on the head ------------------------------------------------------
  const Fr = S.frill
  if (Fr && Fr > 0.01) {
    for (const side of [1, -1]) {
      const x = side === 1 ? 'L' : 'R'
      const root = head.Q(-0.28, 0.0, 0.38 * side)
      body.bone(`frill${x}`, 'head', root)
      const fb = B(`frill${x}`)
      const ribs = []
      const n = 5
      for (let k = 0; k < n; k++) {
        const a = (-62 + (k / (n - 1)) * 124) * DEG
        const len = hs * (0.5 + 0.32 * Math.cos(a * 0.9)) * Fr
        const base = head.Q(-0.25 - Math.abs(Math.sin(a)) * 0.04, Math.sin(a) * 0.3, 0.38 * side)
        const dir = head.D(-0.55, Math.sin(a) * 0.75, side * 0.8)
        const l = Math.hypot(dir[0], dir[1], dir[2])
        ribs.push([base, add3(base, dir, (len * 0.5) / l), add3(add3(base, dir, len / l), head.D(-0.15, Math.sin(a) * 0.2, 0), len * 0.3)])
      }
      fan(body, coat, { ribs, bones: fb, paint: finPaint(coat, { streaks: n - 1 }), ribRadius: hs * 0.022, sag: 0.04 })
    }
  }
  if (S.barbels && S.barbels > 0.01) {
    for (const side of [1, -1]) {
      const base = head.Q(head.tipF - 0.08, -0.12, 0.2 * side)
      body.add('hide', tuft({ base, tip: add3(base, head.D(-0.25, -0.8, side * 0.45), hs * 0.55 * S.barbels), bend: head.D(0.1 * hs, 0, side * 0.05 * hs), width: hs * 0.035, thick: hs * 0.03, bone: B('jaw'), face: [0, 0, side], taper: [1, 0.9, 0.7, 0.45, 0.15], radial: 6, paint: coat.part('barbel', { base: 'finEdge' }) }))
    }
  }
  if (S.horns?.kind === 'swept' && S.horns.size > 0.01) sweptHorns(body, coat, head, { size: S.horns.size, bone: B('head'), ridges: S.horns.ridges ?? 0, glowTip: S.horns.glowTip ?? 0 })

  // ----- The tail's end ----------------------------------------------------------------------
  const tipAt = rearPts[REAR - 1]
  const tipBone = B(`r${REAR}`)
  const tail = rearPts[REAR - 2]
  const along = [tipAt[0] - tail[0], tipAt[1] - tail[1], tipAt[2] - tail[2]]
  const len = Math.hypot(...along)
  const back = [along[0] / len, along[1] / len, along[2] / len]
  if (S.tailTip === 'fin') {
    const s = R * 2.2 * (S.tailTipSize ?? 1)
    const side = [-back[2], 0, back[0]]
    for (const dir of [1, -1]) {
      const ribs = [0, 0.5, 1].map((k) => [add3(tipAt, back, -s * (0.35 - k * 0.3)), add3(add3(add3(tipAt, back, s * (0.1 + 0.3 * k)), side, dir * s * 0.32), [0, s * 0.2, 0]), add3(add3(add3(tipAt, back, s * (0.35 + 0.55 * k)), side, dir * s * (0.6 - 0.25 * k)), [0, s * 0.45, 0])])
      fan(body, coat, { ribs, bones: tipBone, paint: finPaint(coat, { streaks: 3 }), ribRadius: R * 0.03 })
    }
  } else if (S.tailTip === 'flame') {
    const s = R * 2.4 * (S.tailTipSize ?? 1)
    const tongues = [
      [0, 1, 0.3, 0],
      [0.4, 0.72, 0.24, 0.6],
      [-0.4, 0.7, 0.24, -0.5],
      [0.2, 0.52, 0.2, -1],
    ]
    for (const [lean, l, wide, turn] of tongues) {
      const dir = [back[0] * 0.5 + lean * 0.3, 0.85, back[2] * 0.5 + turn * 0.3]
      body.add('flame', tuft({ base: add3(tipAt, back, -R * 0.1), tip: add3(tipAt, dir, s * l), bend: [0, 0, 0], width: s * wide, thick: s * wide * 0.5, bone: tipBone, face: [Math.sin(turn), 0, Math.cos(turn)], taper: TAPER.flame, radial: 8, paint: flamePaint(coat) }))
    }
  }
  if (S.crown) crown(body, S, coat, head, { kind: S.crown, size: S.crownSize ?? 1, lift: S.crownLift ?? 0 })

  body.socket('chest', 'f3', [frontPts[2][0] + R * 0.5, frontPts[2][1], 0])
  body.socket('back', 'f3', [frontPts[2][0] - R, frontPts[2][1], 0])
  body.socket('belly', 'f2', [frontPts[1][0] + R, frontPts[1][1], 0])
  const mouth = head.Q(head.tipF, -0.12)
  body.socket('pawL', 'head', [mouth[0], mouth[1], 0.1])
  body.socket('pawR', 'head', [mouth[0], mouth[1], -0.1])
  body.socket('tail', `r${REAR}`, tipAt)

  return {
    body,
    legs: [],
    clips: CLIPS(),
    alive: aliveSerpent(S),
    meta: { height: headAt[1] + hs * 0.62, length: 2.4, reach: mouth[0] + 0.3, chest: frontPts[2][1], shoulder: frontPts[3][1] },
  }
}

function aliveSerpent(S) {
  const life = faceLife(S)
  const hasFrill = !!S.frill
  const bounce = S.life.bounce
  const slow = 1 - S.life.heavy * 0.35
  const crownKind = S.crown || null
  return (pose, t, st) => {
    const calm = st.calm ?? 1
    const energy = (1 + (1 - calm) * 0.8) * slow
    const sway = 1 + bounce * 0.8
    for (let i = 1; i <= FRONT; i++) {
      addRot(pose, FRONTS[i], 0, Math.sin(t * 1.15 * energy - i * 0.65) * (4 + i * 0.9) * sway, Math.sin(t * 0.8 * slow - i * 0.5) * 2.2 + Math.sin(t * 2.4) * bounce * 2)
    }
    const cock = Math.pow(Math.max(0, Math.sin(t * 0.55 + 0.6)), 4) * 16 * bounce * calm
    addRot(pose, 'head', Math.sin(t * 0.9) * 3 + cock, -Math.sin(t * 1.15 * energy - FRONT * 0.65) * 7, Math.sin(t * 1.3) * 2)
    addRot(pose, 'jaw', 0, 0, -2 - (1 - calm) * 8 - Math.max(0, Math.sin(t * 0.7)) * 2)
    for (let i = 1; i <= REAR; i++) {
      addRot(pose, REARS[i], 0, Math.sin(t * 0.85 * slow + i * 0.75) * (3 + i * 0.7), 0)
    }
    if (hasFrill) {
      const flare = (st.flare ?? 0) * 30 + Math.sin(t * 1.6) * 4 + (1 - calm) * 14
      addRot(pose, 'frillL', 0, -flare, 0)
      addRot(pose, 'frillR', 0, flare, 0)
    }
    faceAlive(pose, t, st, life)
    if (crownKind) crownAlive(pose, t, crownKind)
    const tremble = st.tremble ?? 0
    if (tremble > 0) {
      addRot(pose, 'f3', 0, Math.sin(t * 43) * 1.6 * tremble, 0)
      addRot(pose, 'head', 0, 0, Math.sin(t * 39) * 1.6 * tremble)
    }
    const run = st.run ?? 0
    if (run > 0) {
      for (let i = 1; i <= REAR; i++) addRot(pose, REARS[i], 0, Math.sin(t * 9 + i * 0.9) * 14 * run, 0)
      for (let i = 1; i <= FRONT; i++) addRot(pose, FRONTS[i], 0, Math.sin(t * 9 - i * 0.7) * 5 * run, -5 * run)
    }
  }
}

const ANGRY = [0, 1, 1]
const WINCE = [0.85, 0.5, 1]

function CLIPS() {
  // Reared-up bones lean forward with a negative turn about Z, and back with a positive one.
  const f = (a, b, c, d, e) => ({ f1: [0, 0, a], f2: [0, 0, b], f3: [0, 0, c], f4: [0, 0, d], f5: [0, 0, e] })
  const hood = (a) => ({ frillL: [0, -a, 0], frillR: [0, a, 0] })
  return {
    land: {
      dur: 0.6,
      keys: [
        { t: 0, r: { ...f(-14, -16, -8, 6, 14), head: [0, 0, 10] }, p: { face: [0.4, 0, 0.5] } },
        { t: 0.45, r: { ...f(4, 5, 3, 0, 0) }, ease: 'out' },
        { t: 1, r: {} },
      ],
    },
    roar: {
      dur: 1.7,
      keys: [
        { t: 0, r: {} },
        { t: 0.2, r: { ...f(6, 10, 10, 4, -8), head: [0, 0, -8], jaw: [0, 0, -6] }, p: { face: [0, 0.6, 0.6] } },
        { t: 0.36, r: { ...f(-6, -8, -6, 6, 10), head: [0, 0, 6], jaw: [0, 0, -50], ...hood(38) }, p: { face: ANGRY }, ease: 'snap' },
        { t: 0.6, r: { ...f(-5, -7, -5, 6, 10), head: [6, 10, 6], jaw: [0, 0, -46], ...hood(40) }, p: { face: ANGRY } },
        { t: 0.82, r: { ...f(-5, -7, -5, 6, 10), head: [-6, -10, 6], jaw: [0, 0, -44], ...hood(36) }, p: { face: ANGRY } },
        { t: 1, r: {} },
      ],
      events: [[0.34, 'roar']],
    },
    strike: {
      dur: 0.62,
      keys: [
        { t: 0, r: {} },
        { t: 0.34, r: { ...f(8, 12, 12, 6, -12), head: [0, 0, -10], jaw: [0, 0, -30], ...hood(26) }, p: { base: [-0.15, 0, 0], face: [0, 1, 1] } },
        { t: 0.48, r: { ...f(-24, -26, -18, -6, 16), head: [0, 0, 22], jaw: [0, 0, -48] }, p: { base: [0.3, 0, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.55, r: { ...f(-24, -26, -18, -6, 16), head: [14, 0, 20], jaw: [0, 0, -2] }, p: { base: [0.3, 0, 0], face: [0.3, 1, 1] }, ease: 'snap' },
        { t: 0.72, r: { ...f(-16, -18, -12, -4, 10), head: [-12, 0, 14], jaw: [0, 0, -4] }, p: { base: [0.2, 0, 0], face: [0.3, 0.9, 0.8] } },
        { t: 1, r: {} },
      ],
      events: [[0.49, 'hit']],
    },
    claw: {
      // A whip of the head from the side.
      dur: 0.6,
      keys: [
        { t: 0, r: {} },
        { t: 0.34, r: { f1: [0, 20, 4], f2: [0, 24, 6], f3: [0, 20, 6], f4: [0, 10, 0], head: [0, -30, -6], jaw: [0, 0, -30] }, p: { face: [0, 1, 1] } },
        { t: 0.5, r: { f1: [0, -18, -20], f2: [0, -22, -20], f3: [0, -18, -14], f4: [0, -8, 0], f5: [0, 0, 12], head: [0, 26, 16], jaw: [0, 0, -44] }, p: { base: [0.25, 0, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.6, r: { f1: [0, -14, -18], f2: [0, -18, -18], f3: [0, -14, -12], f5: [0, 0, 10], head: [0, 18, 14], jaw: [0, 0, -2] }, p: { base: [0.22, 0, 0], face: [0.2, 0.9, 0.8] } },
        { t: 1, r: {} },
      ],
      events: [[0.49, 'hit']],
    },
    heavy: {
      // Rears to its full height, then brings the whole forebody down like a felled tree.
      dur: 1.1,
      keys: [
        { t: 0, r: {} },
        { t: 0.36, r: { ...f(10, 14, 12, 6, -10), head: [0, 0, -16], jaw: [0, 0, -36], ...hood(40) }, p: { base: [-0.2, 0.1, 0], face: ANGRY } },
        { t: 0.54, r: { ...f(12, 16, 14, 8, -10), head: [0, 0, -18], jaw: [0, 0, -44], ...hood(44) }, p: { base: [-0.24, 0.14, 0], face: ANGRY } },
        { t: 0.64, r: { ...f(-44, -34, -14, 4, 20), head: [0, 0, 34], jaw: [0, 0, -10] }, p: { base: [0.35, -0.05, 0], face: [0.5, 1, 1] }, ease: 'snap' },
        { t: 0.8, r: { ...f(-38, -30, -12, 4, 18), head: [0, 0, 30], jaw: [0, 0, -8] }, p: { base: [0.3, -0.04, 0], face: [0.2, 0.9, 0.8] } },
        { t: 1, r: {} },
      ],
      events: [[0.63, 'hit']],
    },
    guard: {
      dur: 0.3,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 1, r: { ...f(14, 22, -30, -46, -16), head: [0, 0, 62], jaw: [0, 0, -12], ...hood(46) }, p: { base: [-0.2, 0, 0], face: [0.1, 1, 1] }, ease: 'out' },
      ],
    },
    guardHit: {
      dur: 0.36,
      hold: true,
      keys: [
        { t: 0, r: { ...f(14, 22, -30, -46, -16), head: [0, 0, 62], jaw: [0, 0, -12], ...hood(46) }, p: { base: [-0.2, 0, 0], face: [0.1, 1, 1] } },
        { t: 0.3, r: { ...f(20, 28, -30, -50, -18), head: [8, 0, 66], jaw: [0, 0, -6], ...hood(50) }, p: { base: [-0.42, 0, 0], face: WINCE }, ease: 'snap' },
        { t: 1, r: { ...f(14, 22, -30, -46, -16), head: [0, 0, 62], jaw: [0, 0, -12], ...hood(46) }, p: { base: [-0.2, 0, 0], face: [0.1, 1, 1] } },
      ],
    },
    hit: {
      dur: 0.5,
      keys: [
        { t: 0, r: {} },
        { t: 0.2, r: { f1: [0, 6, 6], f2: [0, 12, 14], f3: [6, 18, 16], f4: [8, 14, 10], head: [10, 24, -10], jaw: [0, 0, -30] }, p: { base: [-0.16, 0, 0], face: WINCE }, ease: 'snap' },
        { t: 0.55, r: { f2: [0, 5, 5], f3: [2, 7, 6], f4: [3, 5, 4], jaw: [0, 0, -14] }, p: { base: [-0.1, 0, 0], face: [0.3, 0.6, 0.8] } },
        { t: 1, r: {} },
      ],
    },
    hitHeavy: {
      dur: 0.9,
      keys: [
        { t: 0, r: {} },
        { t: 0.16, r: { f1: [0, 10, 14], f2: [6, 16, 22], f3: [12, 24, 22], f4: [12, 18, 12], head: [16, 30, -16], jaw: [0, 0, -40] }, p: { base: [-0.5, 0, 0.06], face: [1, 0.5, 1] }, ease: 'snap' },
        { t: 0.48, r: { ...f(-10, -16, -14, 0, 10), head: [0, 10, 10], jaw: [0, 0, -24] }, p: { base: [-0.42, 0, 0.04], face: [0.6, 0.6, 1] } },
        { t: 0.78, r: { ...f(-4, -6, -5, 0, 4) }, p: { base: [-0.2, 0, 0], face: [0.2, 0.8, 0.8] } },
        { t: 1, r: {} },
      ],
    },
    stuffed: {
      dur: 0.5,
      keys: [
        { t: 0, r: { ...f(10, 14, 12, 6, -10), jaw: [0, 0, -36] }, p: { face: [0.5, 0.3, 1] } },
        { t: 0.3, r: { f1: [0, 8, 16], f2: [4, 14, 20], f3: [8, 18, 16], head: [10, 24, -12], jaw: [0, 0, -34] }, p: { base: [-0.3, 0, 0], face: WINCE }, ease: 'snap' },
        { t: 1, r: {} },
      ],
    },
    charge: {
      dur: 0.75,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 1, r: { ...f(8, 12, 10, 4, -8), head: [0, 0, -14], jaw: [0, 0, -26], ...hood(48) }, p: { base: [-0.2, 0.08, 0], face: ANGRY }, ease: 'out' },
      ],
    },
    pounce: {
      dur: 0.9,
      keys: [
        { t: 0, r: { ...f(8, 12, 10, 4, -8), head: [0, 0, -14], jaw: [0, 0, -26], ...hood(48) }, p: { base: [-0.2, 0.08, 0], face: ANGRY } },
        { t: 0.3, r: { ...f(-26, -28, -20, -8, 14), head: [0, 0, 26], jaw: [0, 0, -54] }, p: { base: [0.4, 0, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.44, r: { ...f(-28, -30, -20, -8, 16), head: [0, 0, 24], jaw: [0, 0, -2] }, p: { base: [0.45, 0, 0], face: [0.4, 1, 1] }, ease: 'snap' },
        { t: 0.58, r: { ...f(-28, -30, -20, -8, 16), head: [24, 14, 22], jaw: [0, 0, -2] }, p: { base: [0.45, 0, 0], face: [0.4, 1, 1] } },
        { t: 0.74, r: { ...f(-26, -28, -18, -8, 14), head: [-24, -14, 22], jaw: [0, 0, -2] }, p: { base: [0.42, 0, 0], face: [0.2, 1, 1] } },
        { t: 1, r: {} },
      ],
      events: [[0.43, 'hit']],
    },
    ko: {
      dur: 1.6,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 0.16, r: { f2: [0, 10, 12], f3: [0, 16, 14], f4: [0, 12, 8], head: [0, 20, -10], jaw: [0, 0, -44] }, p: { face: [1, 0.4, 1] }, ease: 'snap' },
        { t: 0.5, r: { ...f(-8, -6, 4, 10, 6), f3: [14, 8, 4], head: [10, 10, 0], jaw: [0, 0, -30] }, p: { face: [1, 0, 1] } },
        { t: 0.76, r: { f1: [10, 0, -52], f2: [16, 0, -30], f3: [10, 6, -8], f4: [0, 4, 8], f5: [0, 0, 4], head: [44, 10, 4], jaw: [0, 0, -22], ...hood(-10) }, p: { face: [1, 0, 1] }, ease: 'in' },
        { t: 0.86, r: { f1: [12, 0, -62], f2: [18, 0, -30], f3: [10, 6, -2], f4: [0, 4, 10], f5: [0, 0, 6], head: [62, 12, 4], jaw: [0, 0, -26], ...hood(-14) }, p: { face: [1, 0, 1] }, ease: 'out' },
        { t: 1, r: { f1: [12, 0, -62], f2: [18, 0, -30], f3: [10, 6, -2], f4: [0, 4, 10], f5: [0, 0, 6], head: [62, 12, 4], jaw: [0, 0, -16], ...hood(-14) }, p: { face: [1, 0, 1] } },
      ],
      events: [[0.82, 'thud']],
    },
    victory: {
      dur: 2.2,
      keys: [
        { t: 0, r: {} },
        { t: 0.2, r: { ...f(8, 10, 8, 4, -10), head: [0, 0, -10], jaw: [0, 0, -52], ...hood(48) }, p: { base: [0, 0.12, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.5, r: { ...f(8, 10, 8, 4, -10), head: [8, 14, -8], jaw: [0, 0, -48], ...hood(48) }, p: { base: [0, 0.12, 0], face: [0, 0.8, 0.8] } },
        { t: 0.76, r: { ...f(8, 10, 8, 4, -10), head: [-8, -14, -8], jaw: [0, 0, -10], ...hood(46) }, p: { base: [0, 0.12, 0], face: [0.55, 0, 0] } },
        { t: 1, r: {} },
      ],
      events: [[0.18, 'roar']],
    },
  }
}
