// Body-building. Almost every part of a beast is a "loft": a skin stretched
// over rings that follow a path, with its own thickness at each point. Torsos,
// necks, legs, tails, horns, teeth and claws are all lofts. Each control point
// may name a bone, and the skin then bends smoothly between those bones.

import * as THREE from 'three'
import { fbm3 } from './noise.js'

const smoothstep = (t) => t * t * (3 - 2 * t)

/**
 * @param {object} spec
 * @param {{p:number[], r:number|number[], bone?:number}[]} spec.points  path points; `r` is a radius or [across, upDown]
 * @param {number} [spec.radial]   vertices around
 * @param {number} [spec.span]     rings between two path points
 * @param {'round'|'point'|'flat'|'none'} [spec.capStart]
 * @param {'round'|'point'|'flat'|'none'} [spec.capEnd]
 * @param {number[]} [spec.up]     which way is "up" for the cross-section
 * @param {{amp:number, freq:number, seed?:number}} [spec.noise]  lumps and muscle
 * @param {(u:number, v:number, p:THREE.Vector3) => THREE.Color} [spec.colour]  u along (0..1), v around (0 top, 0.5 underside)
 * @param {number[]} [spec.uv]     [repeats per unit length, repeats around]
 * @param {(u:number, v:number) => number} [spec.shape]  multiplies the radius, for ridges and flares
 */
export function loft(spec) {
  const {
    points,
    radial = 16,
    span = 5,
    capStart = 'round',
    capEnd = 'round',
    up = [0, 1, 0],
    noise = null,
    colour = null,
    uv = [0.6, 2],
    shape = null,
  } = spec
  const n = points.length
  const curve = new THREE.CatmullRomCurve3(
    points.map((pt) => new THREE.Vector3(...pt.p)),
    false,
    'centripetal',
  )
  const radius = (i) => {
    const r = points[i].r
    return Array.isArray(r) ? r : [r, r]
  }
  const skinned = points.some((pt) => pt.bone !== undefined)

  // Rings along the path: { c: centre, rx, ry, boneA, boneB, w, u }.
  const rings = []
  for (let i = 0; i < n - 1; i++) {
    const steps = i === n - 2 ? span + 1 : span
    for (let s = 0; s < steps; s++) {
      const f = s / span
      const t = (i + f) / (n - 1)
      const e = smoothstep(f)
      const [ax, ay] = radius(i)
      const [bx, by] = radius(i + 1)
      rings.push({
        c: curve.getPoint(Math.min(t, 1)),
        rx: ax + (bx - ax) * e,
        ry: ay + (by - ay) * e,
        boneA: points[i].bone ?? 0,
        boneB: points[i + 1].bone ?? points[i].bone ?? 0,
        w: e,
        u: t,
      })
    }
  }

  // Tangents, then frames carried along the path without twisting.
  const tangents = rings.map((ring, i) => {
    const a = rings[Math.max(0, i - 1)].c
    const b = rings[Math.min(rings.length - 1, i + 1)].c
    return new THREE.Vector3().subVectors(b, a).normalize()
  })
  const upHint = new THREE.Vector3(...up)
  let normal = upHint.clone().addScaledVector(tangents[0], -upHint.dot(tangents[0]))
  if (normal.lengthSq() < 1e-4) normal = new THREE.Vector3(1, 0, 0).addScaledVector(tangents[0], -tangents[0].x)
  normal.normalize()
  const frames = []
  for (let i = 0; i < rings.length; i++) {
    if (i > 0) {
      normal = normal.clone().addScaledVector(tangents[i], -normal.dot(tangents[i]))
      if (normal.lengthSq() < 1e-6) normal = frames[i - 1].n.clone()
      normal.normalize()
    }
    frames.push({ n: normal.clone(), b: new THREE.Vector3().crossVectors(tangents[i], normal).normalize() })
  }

  // Caps: extra rings that close the ends.
  const capRings = (end, kind) => {
    if (kind === 'none') return []
    const index = end === 0 ? 0 : rings.length - 1
    const ring = rings[index]
    const dir = tangents[index].clone().multiplyScalar(end === 0 ? -1 : 1)
    const out = []
    if (kind === 'round') {
      const length = Math.min(ring.rx, ring.ry) * 0.9
      const steps = 4
      for (let k = 1; k <= steps; k++) {
        const a = (k / steps) * (Math.PI / 2)
        const shrink = k === steps ? 0.001 : Math.cos(a)
        out.push({
          ...ring,
          c: ring.c.clone().addScaledVector(dir, Math.sin(a) * length),
          rx: ring.rx * shrink,
          ry: ring.ry * shrink,
          cap: end,
          frame: frames[index],
          tangent: tangents[index],
        })
      }
    } else {
      // 'flat' and 'point' both close with a single collapsed ring.
      out.push({ ...ring, rx: 0.001, ry: 0.001, cap: end, frame: frames[index], tangent: tangents[index] })
    }
    return out
  }
  const head = capRings(0, capStart).reverse()
  const tail = capRings(1, capEnd)
  const all = [
    ...head,
    ...rings.map((ring, i) => ({ ...ring, frame: frames[i], tangent: tangents[i] })),
    ...tail,
  ]

  // Arc length, for even texture density.
  let travelled = 0
  const lengths = all.map((ring, i) => {
    if (i > 0) travelled += ring.c.distanceTo(all[i - 1].c)
    return travelled
  })

  const count = all.length * (radial + 1)
  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const colours = new Float32Array(count * 3)
  const skinIndex = skinned ? new Uint16Array(count * 4) : null
  const skinWeight = skinned ? new Float32Array(count * 4) : null
  const p = new THREE.Vector3()
  const white = new THREE.Color(1, 1, 1)
  for (let i = 0; i < all.length; i++) {
    const ring = all[i]
    for (let j = 0; j <= radial; j++) {
      const v = j / radial
      const angle = v * Math.PI * 2
      const scale = shape ? shape(ring.u, v) : 1
      const cx = Math.sin(angle) * ring.rx * scale
      const cy = Math.cos(angle) * ring.ry * scale
      p.copy(ring.c).addScaledVector(ring.frame.n, cy).addScaledVector(ring.frame.b, cx)
      if (noise && ring.rx > 0.01) {
        const lump = (fbm3(p.x * noise.freq, p.y * noise.freq, p.z * noise.freq, 3, noise.seed ?? 1) - 0.5) * 2 * noise.amp
        const out = Math.hypot(cx, cy) || 1
        p.addScaledVector(ring.frame.n, (cy / out) * lump).addScaledVector(ring.frame.b, (cx / out) * lump)
      }
      const o = i * (radial + 1) + j
      positions.set([p.x, p.y, p.z], o * 3)
      uvs.set([lengths[i] * uv[0], v * uv[1]], o * 2)
      const c = colour ? colour(ring.u, v, p) : white
      colours.set([c.r, c.g, c.b], o * 3)
      if (skinned) {
        skinIndex.set([ring.boneA, ring.boneB, 0, 0], o * 4)
        skinWeight.set([1 - ring.w, ring.w, 0, 0], o * 4)
      }
    }
  }

  const indices = []
  for (let i = 0; i < all.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j
      const b = a + radial + 1
      indices.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  if (skinned) {
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4))
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
  }
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  // Close the seam, and point the pole normals along the path.
  const normals = geometry.attributes.normal
  for (let i = 0; i < all.length; i++) {
    const a = i * (radial + 1)
    const b = a + radial
    const ring = all[i]
    if (ring.cap !== undefined && ring.rx <= 0.002) {
      const dir = ring.tangent.clone().multiplyScalar(ring.cap === 0 ? -1 : 1)
      for (let j = 0; j <= radial; j++) normals.setXYZ(a + j, dir.x, dir.y, dir.z)
      continue
    }
    const x = normals.getX(a) + normals.getX(b)
    const y = normals.getY(a) + normals.getY(b)
    const z = normals.getZ(a) + normals.getZ(b)
    const len = Math.hypot(x, y, z) || 1
    normals.setXYZ(a, x / len, y / len, z / len)
    normals.setXYZ(b, x / len, y / len, z / len)
  }
  return geometry
}

/** A tapering spike, horn or claw from `base` towards `tip`, curving by `bend` (a sideways offset at mid-length). */
export function spike({ base, tip, radius, bend = [0, 0, 0], bone, radial = 7, span = 3, colour = null, squash = 1, uv = [1.2, 1] }) {
  const a = new THREE.Vector3(...base)
  const b = new THREE.Vector3(...tip)
  const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(...bend))
  const q = a.clone().lerp(mid, 0.5).addScaledVector(new THREE.Vector3(...bend), 0.25)
  const points = [
    { p: a.toArray(), r: [radius, radius * squash], bone },
    { p: q.toArray(), r: [radius * 0.8, radius * 0.8 * squash], bone },
    { p: mid.toArray(), r: [radius * 0.55, radius * 0.55 * squash], bone },
    { p: mid.clone().lerp(b, 0.6).toArray(), r: [radius * 0.28, radius * 0.28 * squash], bone },
    { p: b.toArray(), r: 0.004, bone },
  ]
  return loft({ points, radial, span, capStart: 'flat', capEnd: 'none', colour, uv, up: [0.01, 1, 0.02] })
}

/**
 * A sheet stretched over a grid of points (rows x columns), each with its own bone.
 * Used for wing membranes, fins, frills and sails. Every panel of the grid is
 * divided further and allowed to sag a little, so the skin curves between its
 * ribs like stretched hide. Both faces are drawn by the material.
 */
export function sheet(rows, { colour = null, uv = [1, 1], detail = 5, sag = 0.07 } = {}) {
  const h = rows.length
  const w = rows[0].length
  const nu = (w - 1) * detail + 1
  const nv = (h - 1) * detail + 1
  const positions = []
  const uvs = []
  const colours = []
  const skinIndex = []
  const skinWeight = []
  const white = new THREE.Color(1, 1, 1)
  const p = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const corner = (i, j) => rows[Math.min(h - 1, i)][Math.min(w - 1, j)]
  for (let y = 0; y < nv; y++) {
    for (let x = 0; x < nu; x++) {
      const ci = Math.min(h - 2, Math.floor(y / detail))
      const cj = Math.min(w - 2, Math.floor(x / detail))
      const a = y / detail - ci
      const b = x / detail - cj
      const A = corner(ci, cj)
      const B = corner(ci, cj + 1)
      const C = corner(ci + 1, cj)
      const D = corner(ci + 1, cj + 1)
      const wA = (1 - a) * (1 - b)
      const wB = (1 - a) * b
      const wC = a * (1 - b)
      const wD = a * b
      p.set(
        A.p[0] * wA + B.p[0] * wB + C.p[0] * wC + D.p[0] * wD,
        A.p[1] * wA + B.p[1] * wB + C.p[1] * wC + D.p[1] * wD,
        A.p[2] * wA + B.p[2] * wB + C.p[2] * wC + D.p[2] * wD,
      )
      // Sag between the ribs, always to the same side of the panel.
      e1.set(B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2])
      e2.set(C.p[0] - A.p[0], C.p[1] - A.p[1], C.p[2] - A.p[2])
      normal.crossVectors(e1, e2)
      const size = Math.sqrt(normal.length())
      if (size > 1e-5) {
        normal.normalize()
        p.addScaledVector(normal, Math.sin(Math.PI * a) * Math.sin(Math.PI * b) * sag * size)
      }
      positions.push(p.x, p.y, p.z)
      const u = x / (nu - 1)
      const v = y / (nv - 1)
      uvs.push(u * uv[0], v * uv[1])
      const c = colour ? colour(v, 0.25, p) : white
      colours.push(c.r, c.g, c.b)
      // Up to four bones pull on each point, by how close its corner is.
      const pulls = new Map()
      for (const [pt, weight] of [[A, wA], [B, wB], [C, wC], [D, wD]]) {
        if (weight <= 0.0001) continue
        const bone = pt.bone ?? 0
        pulls.set(bone, (pulls.get(bone) || 0) + weight)
      }
      const list = [...pulls.entries()]
      while (list.length < 4) list.push([0, 0])
      skinIndex.push(list[0][0], list[1][0], list[2][0], list[3][0])
      skinWeight.push(list[0][1], list[1][1], list[2][1], list[3][1])
    }
  }
  const indices = []
  for (let y = 0; y < nv - 1; y++) {
    for (let x = 0; x < nu - 1; x++) {
      const a = y * nu + x
      const b = a + nu
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** A faceted chunk (crystal, rock shard) bound to one bone. Meant for a flat-shaded material. */
export function shard({ base, tip, radius, bone, sides = 5, colour = null, twist = 0 }) {
  const a = new THREE.Vector3(...base)
  const b = new THREE.Vector3(...tip)
  const axis = new THREE.Vector3().subVectors(b, a)
  const length = axis.length()
  axis.normalize()
  const side = new THREE.Vector3(0.3, 1, 0.2).cross(axis).normalize()
  const other = new THREE.Vector3().crossVectors(axis, side)
  const levels = [
    [0, 0.72],
    [0.55, 1],
    [0.82, 0.62],
    [1, 0.02],
  ]
  const positions = []
  const colours = []
  const skinIndex = []
  const skinWeight = []
  const white = new THREE.Color(1, 1, 1)
  const ring = (t, s, k) => {
    const angle = (k / sides) * Math.PI * 2 + twist * t
    return a
      .clone()
      .addScaledVector(axis, length * t)
      .addScaledVector(side, Math.cos(angle) * radius * s)
      .addScaledVector(other, Math.sin(angle) * radius * s)
  }
  const push = (v, t) => {
    positions.push(v.x, v.y, v.z)
    const c = colour ? colour(t, 0, v) : white
    colours.push(c.r, c.g, c.b)
    skinIndex.push(bone ?? 0, 0, 0, 0)
    skinWeight.push(1, 0, 0, 0)
  }
  // Unshared vertices, so every face keeps its own flat normal.
  for (let l = 0; l < levels.length - 1; l++) {
    const [t0, s0] = levels[l]
    const [t1, s1] = levels[l + 1]
    for (let k = 0; k < sides; k++) {
      const p00 = ring(t0, s0, k)
      const p01 = ring(t0, s0, k + 1)
      const p10 = ring(t1, s1, k)
      const p11 = ring(t1, s1, k + 1)
      push(p00, t0)
      push(p01, t0)
      push(p10, t1)
      push(p10, t1)
      push(p01, t0)
      push(p11, t1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
  geometry.computeVertexNormals()
  return geometry
}
