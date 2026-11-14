// The winged body plan: raptor-wyverns and flower drakes. Two taloned legs, a
// deep chest, a long neck and tail, and wings where the arms would be.

import * as THREE from 'three'
import { loft, rails, sheet, tuft, TAPER } from './shape.js'
import { Body, addPos, addRot, pair } from './rig.js'
import { Coat, buildHead, crystalPaint, crystals, faceAlive, faceLife, paw, ridge, spike, sm } from './parts.js'
import { add3, crown, crownAlive, flamePaint, flower, leafPaint, mix3, spinePoints, sweptHorns } from './features.js'

const TAIL = 5
const DEG = Math.PI / 180
// Bone names, made once, so the living motion builds no strings while it runs.
const TAILS = ['', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5']

export function buildWinged(S) {
  const body = new Body()
  const coat = new Coat(S)
  const G = S.girth
  const hs = S.head
  const k = S.size ?? 1
  const lt = S.limb ?? 1
  const B = (n) => body.b(n)
  const legLen = S.leg

  // ----- Bones ---------------------------------------------------------------------
  const hipY = legLen + G * 0.55
  const hips = [-0.3 * k, hipY, 0]
  const spine = [0.08 * k, hipY + 0.14 * k, 0]
  const chest = [0.46 * k, hipY + 0.26 * k, 0]
  const nl = S.neck
  const neck1 = [chest[0] + G * 0.55, chest[1] + G * 0.45, 0]
  const neck2 = [neck1[0] + 0.12 * nl, neck1[1] + 0.3 * nl, 0]
  const headAt = [neck2[0] + 0.16 * nl, neck2[1] + 0.2 * nl, 0]
  body.bone('hips', null, hips)
  body.bone('spine', 'hips', spine)
  body.bone('chest', 'spine', chest)
  body.bone('neck1', 'chest', neck1)
  body.bone('neck2', 'neck1', neck2)
  body.bone('head', 'neck2', headAt)
  const ha = (S.headAngle ?? -12) * DEG
  const head = buildHead(body, S, coat, { o: [headAt[0] + hs * 0.14, headAt[1] + hs * 0.06], a: ha })

  const tl = S.tail
  const tailPts = []
  for (let i = 0; i <= TAIL; i++) {
    const t = i / TAIL
    tailPts.push([hips[0] - G * 0.6 - tl * t * 0.95, hips[1] + G * 0.08 + tl * (Math.sin(t * Math.PI * 0.8) * (S.tailLift ?? 0.12) - t * t * (S.tailDroop ?? 0.3)), 0])
  }
  for (let i = 0; i < TAIL; i++) body.bone(`tail${i + 1}`, i === 0 ? 'hips' : `tail${i}`, tailPts[i])

  // ----- Body: rump to the back of the head --------------------------------------------
  const torsoSpec = {
    points: [
      { p: [hips[0] - G * 0.85, hips[1] + G * 0.02, 0], r: [G * 0.42, G * 0.44, G * 0.42], bone: B('hips') },
      { p: hips, r: [G * 0.8, G * 0.8, G * 0.82], bone: B('hips') },
      { p: spine, r: [G * 0.86, G * 0.86, G * 0.95], bone: B('spine') },
      { p: [chest[0], chest[1] - G * 0.02, 0], r: [G * 0.96, G * 0.95, G * 1.02], bone: B('chest') },
      { p: [(chest[0] + neck1[0]) / 2 + G * 0.1, (chest[1] + neck1[1]) / 2, 0], r: [G * 0.66, G * 0.68, G * 0.82], bone: B('chest') },
      { p: neck1, r: [G * 0.42 * (S.neckThick ?? 1), G * 0.42, G * 0.48], bone: B('neck1') },
      { p: neck2, r: [G * 0.36 * (S.neckThick ?? 1), G * 0.36, G * 0.4], bone: B('neck2') },
      { p: [headAt[0] - hs * 0.06, headAt[1] - hs * 0.04, 0], r: [hs * 0.36, hs * 0.34, hs * 0.36], bone: B('head') },
    ],
    span: 6,
  }
  const torso = rails(torsoSpec)
  body.add('hide', loft({ ...torsoSpec, rails: torso, radial: 32, paint: coat.part('body'), uv: [1.6, 4] }), { outer: true })
  const tailSpec = { points: tailPts.map((p, i) => ({ p, r: G * (0.34 - 0.26 * (i / TAIL)) * (S.tailThick ?? 1), bone: B(`tail${Math.min(TAIL, i + 1)}`) })), span: 5 }
  const tailRails = rails(tailSpec)
  body.add('hide', loft({ ...tailSpec, rails: tailRails, radial: 16, paint: coat.part('tail'), uv: [1.2, 2] }))

  // ----- Legs ----------------------------------------------------------------------------
  const legs = []
  const footS = G * 0.42 * (S.paw ?? 1)
  const ankleY = footS * 0.55
  for (const side of [1, -1]) {
    const x = side === 1 ? 'L' : 'R'
    const hz = G * 0.6 * side
    const hip = [hips[0] + 0.12 * k, hipY - G * 0.3]
    const knee = [hip[0] + legLen * 0.28, ankleY + (hip[1] - ankleY) * 0.52]
    const ankle = [hip[0] - legLen * 0.04, ankleY]
    body.bone(`thigh${x}`, 'hips', [hip[0], hip[1], hz])
    body.bone(`shin${x}`, `thigh${x}`, [knee[0], knee[1], hz * 1.06])
    body.bone(`foot${x}`, `shin${x}`, [ankle[0], ankle[1], hz * 1.08])
    legs.push({ key: `ikL${x}`, names: [`thigh${x}`, `shin${x}`, `foot${x}`], a: [knee[0] - hip[0], knee[1] - hip[1]], b: [ankle[0] - knee[0], ankle[1] - knee[1]], bend: 1, restFoot: new THREE.Vector3(ankle[0], ankle[1], hz * 1.08) })
    body.add(
      'hide',
      loft({
        points: [
          { p: [hip[0] - G * 0.05, hip[1] + G * 0.32, hz * 0.7], r: [G * 0.44, G * 0.52, G * 0.52], bone: B(`thigh${x}`) },
          { p: [(hip[0] + knee[0]) / 2, (hip[1] + knee[1]) / 2, hz], r: [G * 0.36 * lt, G * 0.4 * lt, G * 0.42 * lt], bone: B(`thigh${x}`) },
          { p: [knee[0], knee[1], hz * 1.06], r: [G * 0.2 * lt, G * 0.21 * lt, G * 0.22 * lt], bone: B(`shin${x}`) },
          { p: [(knee[0] + ankle[0]) / 2, (knee[1] + ankle[1]) / 2, hz * 1.07], r: [G * 0.15 * lt, G * 0.15 * lt, G * 0.16 * lt], bone: B(`shin${x}`) },
          { p: [ankle[0], ankle[1] + footS * 0.1, hz * 1.08], r: [G * 0.15 * lt, G * 0.15 * lt, G * 0.15 * lt], bone: B(`foot${x}`) },
        ],
        span: 4,
        radial: 16,
        up: [1, 0, 0],
        paint: coat.part('leg', { side }),
        uv: [1.4, 2],
      }),
      { outer: true },
    )
    paw(body, coat, B(`foot${x}`), { ankle: [ankle[0], ankleY, hz * 1.08], size: footS, toes: 3, claw: (S.talon ?? 1) * 1.3, side, long: 1.1, back: S.talon ?? 1 })
  }

  // ----- Wings: shoulder, elbow, wrist, then three fingers that carry the membrane -----------
  // At rest the wings stand raised over the back, the membrane falling back to the
  // flank: a clean silhouette from the side, and they spread outwards to fly.
  const span = S.wingspan
  for (const side of [1, -1]) {
    const x = side === 1 ? 'L' : 'R'
    const z0 = G * 0.55 * side
    const out = (s) => z0 + span * s * side
    const shoulder = [chest[0] + G * 0.05, chest[1] + G * 0.55, z0]
    const elbow = [shoulder[0] - span * 0.2, shoulder[1] + span * 0.28, out(0.1)]
    const wrist = [shoulder[0] + span * 0.02, shoulder[1] + span * 0.55, out(0.16)]
    const tips = [
      [wrist[0] - span * 0.14, wrist[1] + span * 0.34, out(0.2)],
      [wrist[0] - span * 0.62, wrist[1] + span * 0.12, out(0.24)],
      [wrist[0] - span * 0.98, wrist[1] - span * 0.3, out(0.22)],
    ]
    body.bone(`wingA${x}`, 'chest', shoulder)
    body.bone(`wingB${x}`, `wingA${x}`, elbow)
    body.bone(`wingC${x}`, `wingB${x}`, wrist)
    for (let f = 0; f < 3; f++) body.bone(`finger${f + 1}${x}`, `wingC${x}`, wrist)
    const bone = (n) => B(`${n}${x}`)
    const armPaint = coat.part('wingArm', { side })
    body.add(
      'hide',
      loft({
        points: [
          { p: [shoulder[0], shoulder[1] - G * 0.3, z0 * 0.6], r: G * 0.32, bone: bone('wingA') },
          { p: mix3(shoulder, elbow, 0.5), r: G * 0.22 * lt, bone: bone('wingA') },
          { p: elbow, r: G * 0.16 * lt, bone: bone('wingB') },
          { p: mix3(elbow, wrist, 0.5), r: G * 0.13 * lt, bone: bone('wingB') },
          { p: wrist, r: G * 0.12 * lt, bone: bone('wingC') },
        ],
        span: 4,
        radial: 12,
        up: [1, 0, 0],
        paint: armPaint,
      }),
    )
    tips.forEach((tip, f) => {
      body.add('hide', loft({ points: [{ p: wrist, r: G * 0.09 }, { p: mix3(wrist, tip, 0.5), r: G * 0.055 }, { p: tip, r: G * 0.02 }], bone: bone(`finger${f + 1}`), span: 4, radial: 8, up: [1, 0, 0], capEnd: 'round', paint: armPaint }))
    })
    // The thumb claw at the wrist, pointing forward.
    body.add('hard', spike({ base: wrist, tip: add3(wrist, [0.9, 0.35, 0.05 * side], span * 0.12), radius: G * 0.075, bend: [0, span * 0.02, 0], bone: bone('wingC'), radial: 6, paint: coat.flat('claw') }))
    // Membrane: rows run root to tip, columns leading edge to trailing edge.
    const flank = [hips[0] + 0.05 * k, hips[1] + G * 0.45, G * 0.58 * side]
    const back = [spine[0], spine[1] + G * 0.62, G * 0.56 * side]
    const rows = [
      [
        { p: shoulder, bone: bone('wingA') },
        { p: back, bone: B('spine') },
        { p: flank, bone: B('hips') },
      ],
      [
        { p: elbow, bone: bone('wingB') },
        { p: mix3(elbow, tips[2], 0.45), bone: bone('wingB') },
        { p: mix3(flank, tips[2], 0.45), bone: bone('finger3') },
      ],
      [
        { p: wrist, bone: bone('wingC') },
        { p: mix3(wrist, tips[2], 0.55), bone: bone('finger3') },
        { p: tips[2], bone: bone('finger3') },
      ],
      [
        { p: tips[0], bone: bone('finger1') },
        { p: tips[1], bone: bone('finger2') },
        { p: mix3(tips[1], tips[2], 0.55), bone: bone('finger3') },
      ],
    ]
    body.add('fin', sheet(rows, { paint: wingPaint(coat), detail: 8, sag: 0.04 }))
    // Feathers or petals along the trailing edge, pointing back and down.
    const E = S.wingEdge
    if (E && E.size > 0.01) {
      const edge = [tips[0], mix3(tips[0], tips[1], 0.5), tips[1], mix3(tips[1], tips[2], 0.5), tips[2], mix3(tips[2], flank, 0.35)]
      const bones = ['finger1', 'finger1', 'finger2', 'finger3', 'finger3', 'finger3']
      edge.forEach((p, i) => {
        const l = span * E.size * (1.1 - i * 0.1)
        const dir = [-0.8, -0.35 - i * 0.08, 0.12 * side]
        const kind = E.kind
        body.add(
          'hide',
          tuft({ base: p, tip: add3(p, dir, l), bend: [0, -l * 0.06, 0], width: l * (kind === 'petal' ? 0.36 : 0.22), thick: l * 0.06, bone: bone(bones[i]), face: [0, 0, side], taper: kind === 'petal' ? TAPER.petal : TAPER.feather, radial: 7, paint: kind === 'petal' ? leafPaint(coat, { a: 'petal', b: 'petalTip', glow: 0.55 }) : kind === 'storm' ? flamePaint(coat, { root: 'wing', tip: 'hot', glow: 0.7 }) : coat.part('feather', { base: 'wing' }) }),
        )
      })
    }
  }

  // ----- On the head, along the back, at the tail --------------------------------------------
  if (S.beak) {
    // A hooked tip on the upper jaw.
    const m = S.face.muzzle
    body.add('hard', spike({ base: head.Q(head.tipF - 0.06, -m.drop + m.up * 0.2), tip: head.Q(head.tipF + 0.14, -m.drop - m.down * 1.25), radius: hs * m.wide * m.taper * 0.85, bend: head.D(hs * 0.1, hs * 0.04, 0), bone: B('head'), radial: 10, span: 3, paint: coat.flat('beak'), squash: 0.9 }))
  }
  const Hc = S.headCrest
  if (Hc && Hc.size > 0.01) {
    // A crest of long feathers (or petals) sweeping back from the brow.
    const n = Hc.count ?? 5
    for (let i = 0; i < n; i++) {
      const kk = i / (n - 1) - 0.5
      const base = head.Q(0.05 - Math.abs(kk) * 0.18, 0.44, kk * 0.3)
      const l = hs * Hc.size * (1 - Math.abs(kk) * 0.5)
      body.add('hide', tuft({ base, tip: add3(base, head.D(-0.9, 0.55 - Math.abs(kk) * 0.2, kk * 0.6), l), bend: head.D(0, 0.1 * l, 0), width: l * (Hc.kind === 'petal' ? 0.36 : 0.22), thick: l * 0.07, bone: B('head'), face: head.D(0, 1, kk), taper: Hc.kind === 'petal' ? TAPER.petal : TAPER.feather, radial: 7, paint: Hc.kind === 'petal' ? leafPaint(coat, { a: 'petal', b: 'petalTip', glow: 0.6 }) : Hc.kind === 'storm' ? flamePaint(coat, { root: 'top', tip: 'accent', glow: 0.45 }) : coat.part('crest', { base: 'top' }) }))
    }
  }
  if (S.horns?.kind === 'swept' && S.horns.size > 0.01) sweptHorns(body, coat, head, { size: S.horns.size, bone: B('head'), ridges: S.horns.ridges ?? 0, glowTip: S.horns.glowTip ?? 0 })
  const C = S.crest
  if (C && C.size > 0.01) {
    const pts = [...spinePoints(torso, { from: C.from ?? 0.12, to: C.to ?? 0.9, count: C.count ?? 6, size: (t) => 0.5 + 0.5 * Math.sin(t * Math.PI), lift: -G * 0.03 }), ...spinePoints(tailRails, { from: 0.1, to: 0.7, count: C.tail ?? 0, size: (t) => 0.5 - t * 0.35 }).map((pt) => ({ ...pt, back: [-pt.back[0], -pt.back[1], -pt.back[2]] }))]
    if (C.kind === 'crystal') crystals(body, pts, { size: C.size, paint: crystalPaint(coat), seed: S.seed })
    else ridge(body, pts, { material: C.kind === 'storm' ? 'flame' : C.kind === 'leaf' ? 'hide' : 'hard', len: C.size, width: C.size * 0.34, thick: C.size * 0.1, lean: C.lean ?? 44, paint: C.kind === 'leaf' ? leafPaint(coat, { glow: 0.5, vein: 1 }) : C.kind === 'storm' ? flamePaint(coat, { root: 'top', tip: 'hot', glow: 0.8 }) : coat.part('crest', { base: 'horn' }), taper: C.kind === 'leaf' ? TAPER.leaf : TAPER.blade })
  }
  const tipAt = tailPts[TAIL]
  const tipBone = B(`tail${TAIL}`)
  if (S.tailTip === 'blade' || S.tailTip === 'storm') {
    // A fan of tail feathers.
    const s = G * 1.6 * (S.tailTipSize ?? 1)
    for (let i = 0; i < 5; i++) {
      const kk = i / 4 - 0.5
      body.add('hide', tuft({ base: tipAt, tip: add3(tipAt, [-0.95, 0.12 - Math.abs(kk) * 0.2, kk * 1.2], s * (1 - Math.abs(kk) * 0.4)), bend: [0, -s * 0.04, 0], width: s * 0.22, thick: s * 0.05, bone: tipBone, face: [0, 1, 0], taper: TAPER.feather, radial: 7, paint: S.tailTip === 'storm' ? flamePaint(coat, { root: 'wing', tip: 'hot', glow: 0.6 }) : coat.part('feather', { base: 'wing' }) }))
    }
  } else if (S.tailTip === 'leaf') {
    const s = G * 1.5 * (S.tailTipSize ?? 1)
    for (let i = 0; i < 3; i++) {
      const kk = i - 1
      body.add('hide', tuft({ base: tipAt, tip: add3(tipAt, [-0.9, 0.35 + Math.abs(kk) * 0.1, kk * 0.55], s * (1 - Math.abs(kk) * 0.3)), bend: [0, s * 0.06, 0], width: s * 0.36, thick: s * 0.06, bone: tipBone, face: [0, 1, 0], taper: TAPER.leaf, radial: 7, paint: leafPaint(coat, { glow: 0.6, vein: 1 }) }))
    }
    if (S.tailBloom) flower(body, coat, { at: add3(tipAt, [-0.1, 0.05, 0]), normal: [-1, 0.6, 0], size: G * 0.55 * S.tailBloom, bone: tipBone, petals: 6, paint: leafPaint(coat, { a: 'petal', b: 'petalTip', glow: 0.7 }), seed: 3 })
  }
  if (S.crown) crown(body, S, coat, head, { kind: S.crown, size: S.crownSize ?? 1, lift: S.crownLift ?? 0 })

  body.socket('chest', 'chest', [chest[0] + G * 0.5, chest[1] - G * 0.3, 0])
  body.socket('back', 'spine', [spine[0], spine[1] + G, 0])
  body.socket('belly', 'spine', [spine[0], spine[1] - G * 0.9, 0])
  body.socket('pawL', 'footL', [hips[0] + 0.12 * k + footS, footS * 0.3, G * 0.65])
  body.socket('pawR', 'footR', [hips[0] + 0.12 * k + footS, footS * 0.3, -G * 0.65])
  body.socket('tail', `tail${TAIL}`, tipAt)

  const mouth = head.Q(head.tipF, 0)
  return {
    body,
    legs,
    clips: CLIPS(k, hipY),
    alive: aliveWinged(S),
    meta: { height: headAt[1] + hs * 0.62, length: 2.4 * k + tl * 0.4, reach: mouth[0] + 0.3, chest: chest[1], shoulder: chest[1] + G },
  }
}

/** Wing membrane: the wing's colour, darker near the body, the accent at the trailing edge. */
function wingPaint(coat) {
  const T = coat.T
  const S = coat.S
  const root = T.wingRoot || T.top
  const mid = T.wing || T.side
  const edge = T.wingEdge || T.accent
  const g = S.glow ?? 1
  return (u, v, p, ink) => {
    // u runs body→flank across the columns, v shoulder→fingertips down the rows.
    ink.copy(root).lerp(mid, sm(0.05, 0.5, v)).lerp(edge, sm(0.75, 1, v) * 0.8)
    ink.glow = sm(0.85, 1, v) * 0.6 * g
    if (S.marks) {
      const c = { part: 'wing', u, v, p, d: null, lift: 0, h: null, k: 0, side: 0, ink, T, S }
      S.marks(c)
    }
  }
}

function aliveWinged(S) {
  const life = faceLife(S)
  const bounce = S.life.bounce
  const slow = 1 - S.life.heavy * 0.35
  const crownKind = S.crown || null
  return (pose, t, st) => {
    const calm = st.calm ?? 1
    const breath = Math.sin(t * (1.9 + (1 - calm) * 1.5) * slow)
    const hop = Math.pow(Math.abs(Math.sin(t * 2.6)), 1.5) * bounce * calm
    addPos(pose, 'hips', 0, breath * 0.012 - 0.01 + hop * 0.03, 0)
    addRot(pose, 'chest', 0, 0, breath * 1.1)
    addRot(pose, 'neck1', 0, Math.sin(t * 0.7 * slow) * 5 * calm, Math.sin(t * 1.0) * 3)
    addRot(pose, 'neck2', 0, Math.sin(t * 0.7 * slow + 0.6) * 5 * calm, -Math.sin(t * 1.0) * 3)
    const cock = Math.pow(Math.max(0, Math.sin(t * 0.55 + 0.6)), 4) * 18 * bounce * calm
    addRot(pose, 'head', Math.sin(t * 2.1) * 2 + cock, Math.sin(t * 0.55) * 7 * calm, Math.sin(t * 1.4) * 3)
    addRot(pose, 'jaw', 0, 0, -2 - breath * 1.2 - (1 - calm) * 8)
    for (let i = 1; i <= TAIL; i++) addRot(pose, TAILS[i], 0, Math.sin(t * 1.3 * slow - i * 0.7) * (4 + i * 2) * (1 + bounce * 0.5), Math.sin(t * 1.9 - i * 0.6) * 2.5 - 2)
    // Wings: raised over the back at rest, breathing a little; spread wide and beating in the air.
    const fly = st.fly ?? 0
    const beat = Math.sin(t * 9.5)
    const lag = Math.sin(t * 9.5 - 0.7)
    const lag2 = Math.sin(t * 9.5 - 1.3)
    const idle = Math.sin(t * 1.2 * slow) * (3 + bounce * 3) + (1 - calm) * 6
    const open = idle + fly * (52 + beat * 34)
    addRot(pose, 'wingAL', open, 0, -fly * 10)
    addRot(pose, 'wingAR', -open, 0, -fly * 10)
    addRot(pose, 'wingBL', fly * (lag * 22 - 8), 0, 0)
    addRot(pose, 'wingBR', -fly * (lag * 22 - 8), 0, 0)
    addRot(pose, 'wingCL', fly * lag2 * 14 + Math.sin(t * 1.2 + 1) * 2, 0, 0)
    addRot(pose, 'wingCR', -(fly * lag2 * 14 + Math.sin(t * 1.2 + 1) * 2), 0, 0)
    if (fly > 0) {
      // In the air the body rides the wing beat and the legs tuck up.
      addPos(pose, 'hips', 0, -beat * 0.08 * fly, 0)
      addPos(pose, 'ikLL', 0.25 * fly, 0.42 * fly, 0)
      addPos(pose, 'ikLR', 0.25 * fly, 0.42 * fly, 0)
    }
    faceAlive(pose, t, st, life)
    if (crownKind) crownAlive(pose, t, crownKind)
    const tremble = st.tremble ?? 0
    if (tremble > 0) {
      addPos(pose, 'hips', Math.sin(t * 47) * 0.007 * tremble, Math.sin(t * 53) * 0.006 * tremble, 0)
      addRot(pose, 'head', 0, 0, Math.sin(t * 41) * 1.5 * tremble)
    }
    const run = st.run ?? 0
    if (run > 0 && fly < 0.5) {
      const ph = t * 15
      addPos(pose, 'ikLL', Math.cos(ph) * 0.4 * run, Math.max(0, Math.sin(ph)) * 0.35 * run, 0)
      addPos(pose, 'ikLR', Math.cos(ph + Math.PI) * 0.4 * run, Math.max(0, Math.sin(ph + Math.PI)) * 0.35 * run, 0)
      addRot(pose, 'spine', 0, 0, -10 * run)
    }
  }
}

const ANGRY = [0, 1, 1]
const WINCE = [0.85, 0.5, 1]

function CLIPS(k, hipY) {
  // Wing turns, for the raised rest pose: x rolls the wing outwards (spread),
  // y swings it forwards, z tips it back over the tail.
  const wings = (a, b = [0, 0, 0], c = [0, 0, 0]) => ({ ...pair('wingA', a), ...pair('wingB', b), ...pair('wingC', c) })
  const feet = (v) => ({ ikLL: v, ikLR: v })
  const tailUp = (a) => ({ tail1: [0, 0, -a], tail2: [0, 0, -a], tail3: [0, 0, -a * 0.8] })
  const drop = hipY * 0.75
  const SPREAD = wings([58, 10, 0], [-12, 0, 0], [6, 0, 0])
  return {
    land: {
      dur: 0.7,
      keys: [
        { t: 0, r: { spine: [0, 0, 10], ...wings([44, 0, 0], [-10, 0, 0]) }, p: { hips: [0, -0.3 * k, 0], face: [0.4, 0, 0.5] } },
        { t: 0.4, r: { spine: [0, 0, -4], ...wings([10, 0, 0]) }, p: { hips: [0, 0.03, 0] }, ease: 'out' },
        { t: 1, r: {} },
      ],
    },
    roar: {
      dur: 1.6,
      keys: [
        { t: 0, r: {} },
        { t: 0.2, r: { spine: [0, 0, -8], neck1: [0, 0, -18], neck2: [0, 0, -14], head: [0, 0, 10], ...wings([10, 0, 8]) }, p: { hips: [-0.06, -0.1, 0], face: [0, 0.6, 0.6] } },
        { t: 0.36, r: { spine: [0, 0, 10], chest: [0, 0, 8], neck1: [0, 0, 12], neck2: [0, 0, 6], head: [0, 0, -4], jaw: [0, 0, -46], ...SPREAD, ...tailUp(12) }, p: { hips: [0.05, 0.05, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.6, r: { spine: [0, 0, 9], chest: [0, 0, 8], neck1: [0, 8, 10], neck2: [0, 8, 6], head: [5, 8, -4], jaw: [0, 0, -42], ...wings([54, 10, 0], [-12, 0, 0], [6, 0, 0]), ...tailUp(12) }, p: { hips: [0.05, 0.05, 0], face: ANGRY } },
        { t: 0.82, r: { spine: [0, 0, 8], chest: [0, 0, 7], neck1: [0, -8, 10], neck2: [0, -8, 6], head: [-5, -8, -4], jaw: [0, 0, -40], ...wings([50, 8, 0], [-10, 0, 0]) }, p: { hips: [0.04, 0.04, 0], face: ANGRY } },
        { t: 1, r: {} },
      ],
      events: [[0.33, 'roar']],
    },
    strike: {
      // A lunging bite with a snap of the wings.
      dur: 0.62,
      keys: [
        { t: 0, r: {} },
        { t: 0.32, r: { spine: [0, 0, -6], neck1: [0, 0, 22], neck2: [0, 0, 18], head: [0, 0, -30], jaw: [0, 0, -14], ...wings([12, -18, 10]) }, p: { hips: [-0.2, -0.08, 0], face: [0, 1, 1] } },
        { t: 0.47, r: { spine: [0, 0, -14], chest: [0, 0, -10], neck1: [0, 0, -34], neck2: [0, 0, -22], head: [0, 0, 26], jaw: [0, 0, -48], ...wings([42, 14, -6], [-8, 0, 0]) }, p: { hips: [0.42, -0.1, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.54, r: { spine: [0, 0, -14], chest: [0, 0, -10], neck1: [0, 0, -34], neck2: [0, 0, -22], head: [16, 0, 24], jaw: [0, 0, -2], ...wings([36, 10, -4], [-6, 0, 0]) }, p: { hips: [0.42, -0.1, 0], face: [0.3, 1, 1] }, ease: 'snap' },
        { t: 0.72, r: { spine: [0, 0, -8], neck1: [0, 0, -20], neck2: [0, 0, -12], head: [-14, 0, 14], ...wings([16, 4, 0]) }, p: { hips: [0.3, -0.06, 0], face: [0.3, 0.9, 0.8] } },
        { t: 1, r: {} },
      ],
      events: [[0.48, 'hit']],
    },
    claw: {
      // Rears back on its tail and rakes with both feet, wings wide for balance.
      dur: 0.7,
      keys: [
        { t: 0, r: {} },
        { t: 0.34, r: { spine: [0, 0, 24], chest: [0, 0, 16], neck1: [0, 0, -16], head: [0, 0, -10], jaw: [0, 0, -30], ...wings([44, 0, 0], [-8, 0, 0]), ...tailUp(-18) }, p: { hips: [-0.1, 0.25 * k, 0], ...feet([0.2, 0.5 * k, 0]), face: [0, 1, 1] } },
        { t: 0.5, r: { spine: [0, 0, 30], chest: [0, 0, 18], neck1: [0, 0, -22], head: [0, 0, -12], jaw: [0, 0, -40], ...wings([54, 10, 0], [-12, 0, 0]), ...tailUp(-20) }, p: { hips: [0.2, 0.3 * k, 0], ...feet([0.95 * k, 0.75 * k, 0]), face: ANGRY }, ease: 'snap' },
        { t: 0.66, r: { spine: [0, 0, 16], chest: [0, 0, 10], ...wings([24, 4, 0]) }, p: { hips: [0.15, 0.1 * k, 0], ...feet([0.6 * k, 0.2 * k, 0]), face: [0.2, 0.9, 0.8] } },
        { t: 1, r: {} },
      ],
      events: [[0.49, 'hit']],
    },
    heavy: {
      // Both wings raised high, then brought down and forward like hammers.
      dur: 1.05,
      keys: [
        { t: 0, r: {} },
        { t: 0.36, r: { spine: [0, 0, 16], chest: [0, 0, 14], neck1: [0, 0, -12], jaw: [0, 0, -30], ...wings([6, -30, 16], [10, 0, 0]), ...tailUp(-12) }, p: { hips: [-0.14, 0.06, 0], face: ANGRY } },
        { t: 0.53, r: { spine: [0, 0, 20], chest: [0, 0, 18], neck1: [0, 0, -14], jaw: [0, 0, -38], ...wings([4, -36, 20], [12, 0, 0]), ...tailUp(-14) }, p: { hips: [-0.18, 0.1, 0], face: ANGRY } },
        { t: 0.63, r: { spine: [0, 0, -22], chest: [0, 0, -18], neck1: [0, 0, 12], head: [0, 0, 10], jaw: [0, 0, -12], ...wings([62, 46, -14], [-20, 0, 0]) }, p: { hips: [0.32, -0.2 * k, 0], face: [0.5, 1, 1] }, ease: 'snap' },
        { t: 0.8, r: { spine: [0, 0, -16], chest: [0, 0, -12], neck1: [0, 0, 8], ...wings([48, 30, -8], [-14, 0, 0]) }, p: { hips: [0.26, -0.16 * k, 0], face: [0.2, 0.9, 0.8] } },
        { t: 1, r: {} },
      ],
      events: [[0.62, 'hit']],
    },
    guard: {
      dur: 0.3,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 1, r: { spine: [0, 0, -8], neck1: [0, 0, -30], neck2: [0, 0, -24], head: [0, 0, 44], ...wings([34, 62, -6], [-8, 30, 0], [0, 20, 0]) }, p: { hips: [-0.14, -0.18 * k, 0], face: [0.1, 1, 1] }, ease: 'out' },
      ],
    },
    guardHit: {
      dur: 0.36,
      hold: true,
      keys: [
        { t: 0, r: { spine: [0, 0, -8], neck1: [0, 0, -30], neck2: [0, 0, -24], head: [0, 0, 44], ...wings([34, 62, -6], [-8, 30, 0], [0, 20, 0]) }, p: { hips: [-0.14, -0.18 * k, 0], face: [0.1, 1, 1] } },
        { t: 0.3, r: { spine: [0, 0, -2], neck1: [0, 0, -34], neck2: [0, 0, -26], head: [0, 0, 48], ...wings([40, 54, -4], [-6, 36, 0], [0, 24, 0]) }, p: { hips: [-0.38, -0.2 * k, 0], ...feet([-0.18, 0, 0]), face: WINCE }, ease: 'snap' },
        { t: 1, r: { spine: [0, 0, -8], neck1: [0, 0, -30], neck2: [0, 0, -24], head: [0, 0, 44], ...wings([34, 62, -6], [-8, 30, 0], [0, 20, 0]) }, p: { hips: [-0.14, -0.18 * k, 0], face: [0.1, 1, 1] } },
      ],
    },
    hit: {
      dur: 0.48,
      keys: [
        { t: 0, r: {} },
        { t: 0.2, r: { spine: [0, 0, 8], chest: [6, 10, 6], neck1: [8, 20, 16], neck2: [8, 16, 12], head: [10, 20, -14], jaw: [0, 0, -30], ...wings([32, -8, 0], [-10, 0, 0]) }, p: { hips: [-0.2, 0.02, 0], face: WINCE }, ease: 'snap' },
        { t: 0.55, r: { spine: [0, 0, 3], neck1: [3, 7, 6], neck2: [3, 6, 4], jaw: [0, 0, -14], ...wings([12, -3, 0]) }, p: { hips: [-0.12, 0, 0], face: [0.3, 0.6, 0.8] } },
        { t: 1, r: {} },
      ],
    },
    hitHeavy: {
      dur: 0.9,
      keys: [
        { t: 0, r: {} },
        { t: 0.16, r: { spine: [8, 8, 16], chest: [12, 14, 10], neck1: [14, 26, 22], neck2: [12, 20, 14], head: [16, 26, -20], jaw: [0, 0, -40], ...wings([48, -20, 6], [-14, 0, 0]) }, p: { hips: [-0.5, 0.1, 0.06], ...feet([-0.25, 0.1, 0]), face: [1, 0.5, 1] }, ease: 'snap' },
        { t: 0.48, r: { spine: [0, 0, -10], chest: [0, 0, -8], neck1: [0, 8, -20], neck2: [0, 6, -10], head: [0, 0, 20], jaw: [0, 0, -24], ...wings([22, 6, 0]) }, p: { hips: [-0.42, -0.26 * k, 0.04], ...feet([-0.25, 0, 0]), face: [0.6, 0.6, 1] } },
        { t: 0.78, r: { spine: [0, 0, -4] }, p: { hips: [-0.2, -0.1, 0], ...feet([-0.12, 0, 0]), face: [0.2, 0.8, 0.8] } },
        { t: 1, r: {} },
      ],
    },
    stuffed: {
      dur: 0.5,
      keys: [
        { t: 0, r: { spine: [0, 0, 16], chest: [0, 0, 14], ...wings([6, -30, 16], [10, 0, 0]) }, p: { face: [0.5, 0.3, 1] } },
        { t: 0.3, r: { spine: [6, 8, 20], chest: [10, 12, 12], neck1: [10, 22, 18], head: [12, 20, -14], jaw: [0, 0, -34], ...wings([34, -8, 0], [-8, 0, 0]) }, p: { hips: [-0.34, 0, 0], ...feet([-0.18, 0, 0]), face: WINCE }, ease: 'snap' },
        { t: 1, r: {} },
      ],
    },
    charge: {
      dur: 0.75,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 1, r: { spine: [0, 0, 10], chest: [0, 0, 8], neck1: [0, 0, 14], neck2: [0, 0, 10], head: [0, 0, -30], jaw: [0, 0, -24], ...wings([56, 8, 0], [-14, 0, 0], [6, 0, 0]), ...tailUp(12) }, p: { hips: [-0.1, 0.06, 0], face: ANGRY }, ease: 'out' },
      ],
    },
    pounce: {
      // The Special: wings swept back in the dive, flung wide at the hit.
      dur: 0.9,
      keys: [
        { t: 0, r: { spine: [0, 0, -30], chest: [0, 0, -16], neck1: [0, 0, 10], neck2: [0, 0, 10], head: [0, 0, 22], jaw: [0, 0, -30], ...wings([20, -40, 24], [6, 0, 0]) }, p: { ...feet([0.4 * k, 0.6 * k, 0]), face: ANGRY } },
        { t: 0.3, r: { spine: [0, 0, -34], chest: [0, 0, -18], neck1: [0, 0, 12], neck2: [0, 0, 10], head: [0, 0, 26], jaw: [0, 0, -48], ...wings([18, -44, 26], [8, 0, 0]) }, p: { ...feet([0.9 * k, 0.7 * k, 0]), face: ANGRY } },
        { t: 0.42, r: { spine: [0, 0, 6], chest: [0, 0, 6], neck1: [0, 0, -20], neck2: [0, 0, -14], head: [0, 0, 20], jaw: [0, 0, -4], ...wings([60, 16, 0], [-16, 0, 0], [6, 0, 0]) }, p: { hips: [0.2, -0.12 * k, 0], ...feet([0.7 * k, 0.1, 0]), face: [0.4, 1, 1] }, ease: 'snap' },
        { t: 0.6, r: { spine: [0, 0, 4], chest: [0, 0, 4], neck1: [0, 0, -22], neck2: [0, 0, -14], head: [22, 0, 20], jaw: [0, 0, -4], ...wings([46, 10, 0], [-10, 0, 0]) }, p: { hips: [0.2, -0.12 * k, 0], ...feet([0.6 * k, 0, 0]), face: [0.4, 1, 1] } },
        { t: 0.78, r: { spine: [0, 0, 2], neck1: [0, 0, -20], neck2: [0, 0, -12], head: [-22, 0, 18], ...wings([24, 4, 0]) }, p: { hips: [0.14, -0.08 * k, 0], ...feet([0.4 * k, 0, 0]), face: [0.2, 1, 1] } },
        { t: 1, r: {} },
      ],
      events: [[0.41, 'hit']],
    },
    ko: {
      dur: 1.6,
      hold: true,
      keys: [
        { t: 0, r: {} },
        { t: 0.16, r: { spine: [0, 0, 10], neck1: [0, 14, 20], neck2: [0, 12, 14], head: [0, 16, -16], jaw: [0, 0, -44], ...wings([40, 0, 0], [-10, 0, 0]) }, p: { hips: [-0.2, 0.04, 0], face: [1, 0.4, 1] }, ease: 'snap' },
        { t: 0.46, r: { spine: [6, 0, -8], neck1: [0, 0, -26], neck2: [0, 0, -16], head: [0, 0, 6], jaw: [0, 0, -28], ...wings([18, 0, 10]) }, p: { hips: [-0.26, -drop * 0.45, 0], ikOff: [0.3, 0, 0], face: [1, 0, 1] } },
        { t: 0.74, r: { hips: [54, 0, 0], spine: [8, 6, -4], neck1: [0, 0, -36], neck2: [0, 0, -20], head: [16, 0, -10], jaw: [0, 0, -22], wingAL: [-20, -10, 36], wingAR: [-30, 10, 36], ...tailUp(-8) }, p: { hips: [-0.3, -drop * 0.8, 0.3 * k], ikOff: [1, 0, 0], face: [1, 0, 1] }, ease: 'in' },
        { t: 0.84, r: { hips: [72, 0, 0], spine: [10, 8, -4], neck1: [0, 0, -42], neck2: [0, 0, -22], head: [20, 0, -12], jaw: [0, 0, -26], wingAL: [-26, -12, 44], wingAR: [-40, 12, 44], ...tailUp(-8) }, p: { hips: [-0.3, -drop, 0.36 * k], ikOff: [1, 0, 0], face: [1, 0, 1] }, ease: 'out' },
        { t: 1, r: { hips: [70, 0, 0], spine: [10, 8, -4], neck1: [0, 0, -40], neck2: [0, 0, -22], head: [20, 0, -12], jaw: [0, 0, -16], wingAL: [-24, -12, 42], wingAR: [-38, 12, 42], ...tailUp(-8) }, p: { hips: [-0.3, -drop, 0.36 * k], ikOff: [1, 0, 0], face: [1, 0, 1] } },
      ],
      events: [[0.8, 'thud']],
    },
    victory: {
      dur: 2.2,
      keys: [
        { t: 0, r: {} },
        { t: 0.2, r: { spine: [0, 0, 14], chest: [0, 0, 12], neck1: [0, 0, 16], neck2: [0, 0, 8], head: [0, 0, -6], jaw: [0, 0, -50], ...wings([62, 12, 0], [-14, 0, 0], [6, 0, 0]), ...tailUp(14) }, p: { hips: [0, 0.1, 0], face: ANGRY }, ease: 'snap' },
        { t: 0.5, r: { spine: [0, 0, 13], chest: [0, 0, 12], neck1: [0, 8, 14], neck2: [0, 8, 8], head: [5, 10, -6], jaw: [0, 0, -46], ...wings([58, 12, 0], [-14, 0, 0], [6, 0, 0]), ...tailUp(14) }, p: { hips: [0, 0.1, 0], face: [0, 0.8, 0.8] } },
        { t: 0.75, r: { spine: [0, 0, 12], chest: [0, 0, 11], neck1: [0, -8, 14], neck2: [0, -8, 8], head: [-5, -10, -6], jaw: [0, 0, -12], ...wings([56, 10, 0], [-12, 0, 0]) }, p: { hips: [0, 0.1, 0], face: [0.55, 0, 0] } },
        { t: 1, r: {} },
      ],
      events: [[0.18, 'roar']],
    },
  }
}
