// The shapes a beast is made of.
//
// Almost every part is a "loft": a smooth skin stretched over rings that follow
// a path, each ring with its own width, height above and depth below the path,
// and squareness. Torsos, heads, limbs, tails, horns and tufts are lofts. Fins
// and wings are "sheets", crystals are "shards", eyes are "lenses" with "lids".
//
// Every shape carries the same vertex data, so shapes that share a material can
// be merged into one mesh: position, normal, uv, color, glow (how strongly the
// vertex shines in its own colour), skinIndex and skinWeight.

import * as THREE from 'three'

const TAU = Math.PI * 2
const smoothstep = (t) => t * t * (3 - 2 * t)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** What a paint function writes to: a colour and a glow amount. */
export class Ink extends THREE.Color {
  constructor() {
    super(1, 1, 1)
    this.glow = 0
  }
}
const INK = new Ink()
const DIR = new THREE.Vector3()
const POS = new THREE.Vector3()

const radii = (r) => (Array.isArray(r) ? (r.length === 3 ? r : [r[0], r[1], r[1]]) : [r, r, r])

/** Slopes for a smooth curve through `values` that never overshoots between two of them. */
function slopes(values, flatStart, flatEnd) {
  const n = values.length
  const m = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    const before = i > 0 ? values[i] - values[i - 1] : null
    const after = i < n - 1 ? values[i + 1] - values[i] : null
    if (before === null) m[i] = flatStart ? 0 : after
    else if (after === null) m[i] = flatEnd ? 0 : before
    else if (before * after <= 0) m[i] = 0
    else {
      m[i] = (before + after) / 2
      const limit = 3 * Math.min(Math.abs(before), Math.abs(after))
      if (Math.abs(m[i]) > limit) m[i] = Math.sign(m[i]) * limit
    }
  }
  return m
}

function hermite(a, b, ma, mb, f) {
  const f2 = f * f
  const f3 = f2 * f
  return (2 * f3 - 3 * f2 + 1) * a + (f3 - 2 * f2 + f) * ma + (-2 * f3 + 3 * f2) * b + (f3 - f2) * mb
}

/**
 * The rings of a loft, before any skin is stretched over them.
 * @param {object} spec
 * @param {{p:number[], r:number|number[], sq?:number, bone?:number}[]} spec.points
 *   path points. `r` is a radius, [across, upDown] or [across, up, down]; `sq` squares the section (2 = ellipse, 4 = boxy).
 * @param {number} [spec.span]   rings between two path points
 * @param {number[]} [spec.up]   which way is "up" for the cross-section
 * @returns {{ rings: object[], at: (t:number, v:number, target?:THREE.Vector3) => {p:THREE.Vector3, d:THREE.Vector3} }}
 */
export function rails(spec) {
  const { points, span = 5, up = [0, 1, 0], capStart = 'round', capEnd = 'round', shape = null } = spec
  const n = points.length
  const curve = new THREE.CatmullRomCurve3(
    points.map((pt) => new THREE.Vector3(pt.p[0], pt.p[1], pt.p[2])),
    false,
    'centripetal',
  )
  const R = points.map((pt) => radii(pt.r))
  const flatA = capStart === 'round'
  const flatB = capEnd === 'round'
  const mx = slopes(R.map((r) => r[0]), flatA, flatB)
  const mu = slopes(R.map((r) => r[1]), flatA, flatB)
  const md = slopes(R.map((r) => r[2]), flatA, flatB)
  const sq = points.map((pt) => pt.sq ?? spec.sq ?? 2)
  const rings = []
  for (let i = 0; i < n - 1; i++) {
    const steps = i === n - 2 ? span + 1 : span
    for (let s = 0; s < steps; s++) {
      const f = s / span
      const t = (i + f) / (n - 1)
      rings.push({
        c: curve.getPoint(Math.min(t, 1)),
        rx: Math.max(0.0005, hermite(R[i][0], R[i + 1][0], mx[i], mx[i + 1], f)),
        ru: Math.max(0.0005, hermite(R[i][1], R[i + 1][1], mu[i], mu[i + 1], f)),
        rd: Math.max(0.0005, hermite(R[i][2], R[i + 1][2], md[i], md[i + 1], f)),
        sq: sq[i] + (sq[i + 1] - sq[i]) * f,
        boneA: points[i].bone ?? spec.bone ?? 0,
        boneB: points[i + 1].bone ?? points[i].bone ?? spec.bone ?? 0,
        w: smoothstep(f),
        u: t,
      })
    }
  }
  // Tangents, then frames carried along the path without twisting.
  const count = rings.length
  for (let i = 0; i < count; i++) {
    const a = rings[Math.max(0, i - 1)].c
    const b = rings[Math.min(count - 1, i + 1)].c
    rings[i].tan = new THREE.Vector3().subVectors(b, a).normalize()
  }
  const hint = new THREE.Vector3(up[0], up[1], up[2])
  let normal = hint.clone().addScaledVector(rings[0].tan, -hint.dot(rings[0].tan))
  if (normal.lengthSq() < 1e-4) normal = new THREE.Vector3(1, 0, 0).addScaledVector(rings[0].tan, -rings[0].tan.x)
  normal.normalize()
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      const next = normal.clone().addScaledVector(rings[i].tan, -normal.dot(rings[i].tan))
      normal = next.lengthSq() < 1e-6 ? rings[i - 1].n.clone() : next.normalize()
    }
    rings[i].n = normal.clone()
    rings[i].b = new THREE.Vector3().crossVectors(rings[i].tan, normal).normalize()
  }
  const at = (t, v, target = new THREE.Vector3()) => {
    let best = 0
    for (let i = 1; i < count; i++) if (Math.abs(rings[i].u - t) < Math.abs(rings[best].u - t)) best = i
    const ring = rings[best]
    const d = new THREE.Vector3()
    section(ring, v, shape ? shape(ring.u, v) : 1, target, d)
    return { p: target, d, ring }
  }
  return { rings, at, spec }
}

/** One point on a ring: `v` runs round the section (0 on top, 0.25 on the +binormal side, 0.5 underneath). */
function section(ring, v, scale, target, dir) {
  const angle = v * TAU
  let s = Math.sin(angle)
  let c = Math.cos(angle)
  if (ring.sq !== 2) {
    const e = 2 / ring.sq
    s = Math.sign(s) * Math.pow(Math.abs(s), e)
    c = Math.sign(c) * Math.pow(Math.abs(c), e)
  }
  const x = s * ring.rx * scale
  const y = c * (c >= 0 ? ring.ru : ring.rd) * scale
  target.copy(ring.c).addScaledVector(ring.n, y).addScaledVector(ring.b, x)
  if (dir) {
    dir.set(0, 0, 0).addScaledVector(ring.n, y).addScaledVector(ring.b, x)
    if (dir.lengthSq() > 1e-12) dir.normalize()
    else dir.copy(ring.n)
  }
  return target
}

/**
 * A skin over the rings of `rails(spec)`.
 * @param {object} spec  as for `rails`, plus:
 * @param {number} [spec.radial]  vertices around
 * @param {'round'|'point'|'flat'|'none'} [spec.capStart]
 * @param {'round'|'point'|'flat'|'none'} [spec.capEnd]
 * @param {number[]} [spec.capLength]  how far each round cap bulges, as a multiple of the end radius
 * @param {(u:number, v:number, p:THREE.Vector3, ink:Ink, d:THREE.Vector3) => void} [spec.paint]
 *   colours one vertex: u along (0..1), v around, p its position, d the way its skin faces
 * @param {(u:number, v:number) => number} [spec.shape]  multiplies the radius, for cheeks, pads and ridges
 * @param {number[]} [spec.uv]    [repeats per unit length, repeats around]
 */
export function loft(spec) {
  const { radial = 16, capStart = 'round', capEnd = 'round', capLength = [0.9, 0.9], paint = null, uv = [1, 2], shape = null } = spec
  const { rings } = spec.rails || rails(spec)
  const cap = (end, kind) => {
    if (kind === 'none') return []
    const ring = rings[end === 0 ? 0 : rings.length - 1]
    const sign = end === 0 ? -1 : 1
    const out = []
    if (kind === 'round') {
      const length = Math.min(ring.rx, (ring.ru + ring.rd) / 2) * capLength[end]
      const steps = 5
      for (let k = 1; k <= steps; k++) {
        const a = (k / steps) * (Math.PI / 2)
        const shrink = k === steps ? 0.0015 : Math.cos(a)
        out.push({ ...ring, c: ring.c.clone().addScaledVector(ring.tan, sign * Math.sin(a) * length), rx: ring.rx * shrink, ru: ring.ru * shrink, rd: ring.rd * shrink, pole: k === steps ? sign : 0 })
      }
    } else {
      out.push({ ...ring, rx: 0.0015, ru: 0.0015, rd: 0.0015, pole: sign })
    }
    return out
  }
  const all = [...cap(0, capStart).reverse(), ...rings, ...cap(1, capEnd)]
  let travelled = 0
  const lengths = all.map((ring, i) => {
    if (i > 0) travelled += ring.c.distanceTo(all[i - 1].c)
    return travelled
  })
  const count = all.length * (radial + 1)
  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const colours = new Float32Array(count * 3)
  const glows = new Float32Array(count)
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  for (let i = 0; i < all.length; i++) {
    const ring = all[i]
    for (let j = 0; j <= radial; j++) {
      const v = j / radial
      section(ring, v, shape ? shape(ring.u, v) : 1, POS, DIR)
      const o = i * (radial + 1) + j
      positions[o * 3] = POS.x
      positions[o * 3 + 1] = POS.y
      positions[o * 3 + 2] = POS.z
      uvs[o * 2] = lengths[i] * uv[0]
      uvs[o * 2 + 1] = v * uv[1]
      INK.setRGB(1, 1, 1)
      INK.glow = 0
      if (paint) paint(ring.u, v, POS, INK, DIR)
      colours[o * 3] = INK.r
      colours[o * 3 + 1] = INK.g
      colours[o * 3 + 2] = INK.b
      glows[o] = INK.glow
      skinIndex[o * 4] = ring.boneA
      skinIndex[o * 4 + 1] = ring.boneB
      skinWeight[o * 4] = 1 - ring.w
      skinWeight[o * 4 + 1] = ring.w
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
  const geometry = finish(positions, uvs, colours, glows, skinIndex, skinWeight, indices)
  // Close the seam, and point the pole normals along the path.
  const normals = geometry.attributes.normal
  for (let i = 0; i < all.length; i++) {
    const a = i * (radial + 1)
    const b = a + radial
    const ring = all[i]
    if (ring.pole) {
      for (let j = 0; j <= radial; j++) normals.setXYZ(a + j, ring.tan.x * ring.pole, ring.tan.y * ring.pole, ring.tan.z * ring.pole)
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

function finish(positions, uvs, colours, glows, skinIndex, skinWeight, indices) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions instanceof Float32Array ? positions : new Float32Array(positions), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs instanceof Float32Array ? uvs : new Float32Array(uvs), 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colours instanceof Float32Array ? colours : new Float32Array(colours), 3))
  geometry.setAttribute('glow', new THREE.BufferAttribute(glows instanceof Float32Array ? glows : new Float32Array(glows), 1))
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex instanceof Uint16Array ? skinIndex : new Uint16Array(skinIndex), 4))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight instanceof Float32Array ? skinWeight : new Float32Array(skinWeight), 4))
  if (indices) geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A soft, flattened lock: fur, a flame tongue, a feather, a petal or a leaf.
 * It runs from `base` to `tip`, bowing by `bend` at mid-length, `width` across
 * and `thick` through, and its flat side faces `face`.
 * `taper` gives the width at five places along it (root to tip).
 */
export function tuft({ base, tip, bend = [0, 0, 0], width, thick = width * 0.4, bone, tipBone, face = [0, 1, 0], radial = 7, span = 2, paint = null, taper = TUFT, capEnd = 'point', capStart = 'flat', uv = [1, 1] }) {
  const points = []
  for (let k = 0; k < 5; k++) {
    const t = k / 4
    const a = (1 - t) * (1 - t)
    const b = 2 * (1 - t) * t
    const c = t * t
    const mx = (base[0] + tip[0]) / 2 + bend[0] * 2
    const my = (base[1] + tip[1]) / 2 + bend[1] * 2
    const mz = (base[2] + tip[2]) / 2 + bend[2] * 2
    points.push({
      p: [a * base[0] + b * mx + c * tip[0], a * base[1] + b * my + c * tip[1], a * base[2] + b * mz + c * tip[2]],
      r: [Math.max(0.002, width * taper[k]), Math.max(0.002, thick * taper[k])],
      bone: tipBone !== undefined && k >= 3 ? tipBone : bone,
    })
  }
  return loft({ points, radial, span, up: face, capStart, capEnd, paint, uv })
}
const TUFT = [0.72, 1, 0.86, 0.5, 0.1]
/** Tuft outlines: a flame, a petal, a leaf, a feather. */
export const TAPER = {
  lock: TUFT,
  puff: [0.74, 1, 0.98, 0.8, 0.42],
  flame: [0.6, 1, 0.8, 0.42, 0.06],
  petal: [0.42, 0.9, 1, 0.78, 0.2],
  leaf: [0.3, 0.85, 1, 0.66, 0.08],
  feather: [0.5, 0.8, 1, 0.86, 0.3],
  blade: [0.7, 1, 0.95, 0.7, 0.08],
}

/** A rounded lump: a nose, a toe, a knuckle, a pearl. `r` is one radius or [x, y, z]; `axes` turns it. */
export function ball({ at, r, bone = 0, paint = null, around = 12, rings = 8, axes = null, uv = [1, 1] }) {
  const [rx, ry, rz] = Array.isArray(r) ? r : [r, r, r]
  const ax = axes ? axes[0] : [1, 0, 0]
  const ay = axes ? axes[1] : [0, 1, 0]
  const az = axes ? axes[2] : [0, 0, 1]
  const count = (rings + 1) * (around + 1)
  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const colours = new Float32Array(count * 3)
  const glows = new Float32Array(count)
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  let o = 0
  for (let i = 0; i <= rings; i++) {
    const lat = (i / rings) * Math.PI
    const y = Math.cos(lat)
    const ring = Math.sin(lat)
    for (let j = 0; j <= around; j++) {
      const lon = (j / around) * TAU
      const x = Math.cos(lon) * ring
      const z = Math.sin(lon) * ring
      DIR.set(ax[0] * x + ay[0] * y + az[0] * z, ax[1] * x + ay[1] * y + az[1] * z, ax[2] * x + ay[2] * y + az[2] * z)
      POS.set(at[0] + ax[0] * x * rx + ay[0] * y * ry + az[0] * z * rz, at[1] + ax[1] * x * rx + ay[1] * y * ry + az[1] * z * rz, at[2] + ax[2] * x * rx + ay[2] * y * ry + az[2] * z * rz)
      positions[o * 3] = POS.x
      positions[o * 3 + 1] = POS.y
      positions[o * 3 + 2] = POS.z
      uvs[o * 2] = (j / around) * uv[0]
      uvs[o * 2 + 1] = (i / rings) * uv[1]
      INK.setRGB(1, 1, 1)
      INK.glow = 0
      if (paint) paint(i / rings, j / around, POS, INK, DIR)
      colours[o * 3] = INK.r
      colours[o * 3 + 1] = INK.g
      colours[o * 3 + 2] = INK.b
      glows[o] = INK.glow
      skinIndex[o * 4] = bone
      skinWeight[o * 4] = 1
      o++
    }
  }
  const indices = []
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j
      const b = a + around + 1
      if (i > 0) indices.push(a, a + 1, b)
      if (i < rings - 1) indices.push(b, a + 1, b + 1)
    }
  }
  const geometry = finish(positions, uvs, colours, glows, skinIndex, skinWeight, indices)
  // A ball's normals are known exactly.
  const normals = geometry.attributes.normal
  o = 0
  for (let i = 0; i <= rings; i++) {
    const lat = (i / rings) * Math.PI
    for (let j = 0; j <= around; j++) {
      const lon = (j / around) * TAU
      const x = (Math.cos(lon) * Math.sin(lat)) / rx
      const y = Math.cos(lat) / ry
      const z = (Math.sin(lon) * Math.sin(lat)) / rz
      DIR.set(ax[0] * x + ay[0] * y + az[0] * z, ax[1] * x + ay[1] * y + az[1] * z, ax[2] * x + ay[2] * y + az[2] * z).normalize()
      normals.setXYZ(o++, DIR.x, DIR.y, DIR.z)
    }
  }
  return geometry
}

/**
 * The front of an eyeball. The eye looks along `n`; `h` runs from corner to
 * corner and `t` up the face, with h x t = n. `r` = [along h, along t, along n].
 * The picture of the eye is laid flat across it: the middle of the texture is
 * the middle of the eye. `flip` -1 mirrors the picture (for the other eye).
 */
export function lens({ centre, n, h, t, r, reach = 1.1, cover = 0.78, bone = 0, around = 20, rings = 6, flip = 1 }) {
  const count = (rings + 1) * (around + 1)
  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const colours = new Float32Array(count * 3).fill(1)
  const glows = new Float32Array(count)
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  let o = 0
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * reach
    const out = Math.cos(phi)
    const ring = Math.sin(phi)
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * TAU
      const x = Math.cos(a) * ring
      const y = Math.sin(a) * ring
      positions[o * 3] = centre[0] + h[0] * x * r[0] + t[0] * y * r[1] + n[0] * out * r[2]
      positions[o * 3 + 1] = centre[1] + h[1] * x * r[0] + t[1] * y * r[1] + n[1] * out * r[2]
      positions[o * 3 + 2] = centre[2] + h[2] * x * r[0] + t[2] * y * r[1] + n[2] * out * r[2]
      uvs[o * 2] = 0.5 + (0.5 * x * flip) / cover
      uvs[o * 2 + 1] = 0.5 + (0.5 * y) / cover
      skinIndex[o * 4] = bone
      skinWeight[o * 4] = 1
      o++
    }
  }
  const indices = []
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j
      const b = a + around + 1
      if (i > 0) indices.push(a, b, a + 1)
      indices.push(b, b + 1, a + 1)
    }
  }
  return finish(positions, uvs, colours, glows, skinIndex, skinWeight, indices)
}

/**
 * An eyelid: a shell just outside the eyeball that swings about the eye's
 * corner-to-corner axis `h`. `from` is the angle of its free edge (degrees up
 * from the line of sight; negative for a lower lid) and `sweep` how far the
 * shell reaches back into the head from there (negative sweeps downwards).
 * The edge is rolled in and painted with `edge` as a lash line.
 */
export function lid({ centre, n, h, t, r, from, sweep, wide = 82, grow = 1.08, bone = 0, colour, edge, across = 12, along = 9 }) {
  const rows = along + 3
  const count = rows * (across + 1)
  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const colours = new Float32Array(count * 3)
  const glows = new Float32Array(count)
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  const rad = Math.PI / 180
  const dir = Math.sign(sweep)
  let o = 0
  for (let i = 0; i < rows; i++) {
    // The first two rows roll the edge in towards the eyeball.
    const k = i < 2 ? 0 : (i - 2) / along
    const alpha = (from + sweep * k - (i === 0 ? dir * 5 : i === 1 ? dir * 2 : 0)) * rad
    const size = i === 0 ? 1.0 : i === 1 ? grow * 0.985 : grow
    const lash = i <= 1 ? 1 : i === 2 ? 0.4 : 0
    for (let j = 0; j <= across; j++) {
      const beta = (j / across - 0.5) * 2 * wide * rad
      const x = Math.sin(beta) * size
      const y = Math.cos(beta) * Math.sin(alpha) * size
      const z = Math.cos(beta) * Math.cos(alpha) * size
      positions[o * 3] = centre[0] + h[0] * x * r[0] + t[0] * y * r[1] + n[0] * z * r[2]
      positions[o * 3 + 1] = centre[1] + h[1] * x * r[0] + t[1] * y * r[1] + n[1] * z * r[2]
      positions[o * 3 + 2] = centre[2] + h[2] * x * r[0] + t[2] * y * r[1] + n[2] * z * r[2]
      uvs[o * 2] = j / across
      uvs[o * 2 + 1] = k
      colours[o * 3] = colour.r + (edge.r - colour.r) * lash
      colours[o * 3 + 1] = colour.g + (edge.g - colour.g) * lash
      colours[o * 3 + 2] = colour.b + (edge.b - colour.b) * lash
      skinIndex[o * 4] = bone
      skinWeight[o * 4] = 1
      o++
    }
  }
  const indices = []
  const outward = dir > 0
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j
      const b = a + across + 1
      if (outward) indices.push(a, a + 1, b, b, a + 1, b + 1)
      else indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  return finish(positions, uvs, colours, glows, skinIndex, skinWeight, indices)
}

/**
 * A membrane stretched over a grid of points (rows x columns), each with its
 * own bone: wings, fins, frills and sails. The skin curves smoothly through
 * the points, so its outline has no corners, and sags a little between them.
 * `paint(u, v, p, ink)`: u across the columns, v across the rows, both 0..1.
 */
export function sheet(rows, { paint = null, uv = [1, 1], detail = 5, sag = 0.04 } = {}) {
  const h = rows.length
  const w = rows[0].length
  const nu = (w - 1) * detail + 1
  const nv = (h - 1) * detail + 1
  const count = nu * nv
  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const colours = new Float32Array(count * 3)
  const glows = new Float32Array(count)
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  const corner = (i, j) => rows[clamp(i, 0, h - 1)][clamp(j, 0, w - 1)]
  // Catmull-Rom weights for the four points around a place `f` of the way between the middle two.
  const weights = (f) => {
    const f2 = f * f
    const f3 = f2 * f
    return [(-f3 + 2 * f2 - f) / 2, (3 * f3 - 5 * f2 + 2) / 2, (-3 * f3 + 4 * f2 + f) / 2, (f3 - f2) / 2]
  }
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const pulls = new Map()
  let o = 0
  for (let y = 0; y < nv; y++) {
    const ci = Math.min(h - 2, Math.floor(y / detail))
    const a = y / detail - ci
    const wa = weights(a)
    for (let x = 0; x < nu; x++) {
      const cj = Math.min(w - 2, Math.floor(x / detail))
      const b = x / detail - cj
      const wb = weights(b)
      POS.set(0, 0, 0)
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const pt = corner(ci - 1 + i, cj - 1 + j).p
          const k = wa[i] * wb[j]
          POS.x += pt[0] * k
          POS.y += pt[1] * k
          POS.z += pt[2] * k
        }
      }
      const A = corner(ci, cj)
      const B = corner(ci, cj + 1)
      const C = corner(ci + 1, cj)
      const D = corner(ci + 1, cj + 1)
      if (sag) {
        e1.set(B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2])
        e2.set(C.p[0] - A.p[0], C.p[1] - A.p[1], C.p[2] - A.p[2])
        normal.crossVectors(e1, e2)
        const size = Math.sqrt(normal.length())
        if (size > 1e-5) POS.addScaledVector(normal.normalize(), Math.sin(Math.PI * a) * Math.sin(Math.PI * b) * sag * size)
      }
      positions[o * 3] = POS.x
      positions[o * 3 + 1] = POS.y
      positions[o * 3 + 2] = POS.z
      const u = x / (nu - 1)
      const v = y / (nv - 1)
      uvs[o * 2] = u * uv[0]
      uvs[o * 2 + 1] = v * uv[1]
      INK.setRGB(1, 1, 1)
      INK.glow = 0
      if (paint) paint(u, v, POS, INK, DIR.set(0, 1, 0))
      colours[o * 3] = INK.r
      colours[o * 3 + 1] = INK.g
      colours[o * 3 + 2] = INK.b
      glows[o] = INK.glow
      // Up to four bones pull on each point, by how close its corner is.
      pulls.clear()
      const add = (pt, weight) => {
        if (weight <= 0.0001) return
        const bone = pt.bone ?? 0
        pulls.set(bone, (pulls.get(bone) || 0) + weight)
      }
      add(A, (1 - a) * (1 - b))
      add(B, (1 - a) * b)
      add(C, a * (1 - b))
      add(D, a * b)
      let k = 0
      for (const [bone, weight] of pulls) {
        skinIndex[o * 4 + k] = bone
        skinWeight[o * 4 + k] = weight
        k++
      }
      o++
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
  return finish(positions, uvs, colours, glows, skinIndex, skinWeight, indices)
}

/**
 * A faceted crystal bound to one bone, from `base` to `tip`. Meant for a
 * flat-shaded material. `paint(t, 0, p, ink)`: t runs root to tip.
 */
export function shard({ base, tip, radius, bone = 0, sides = 6, paint = null, twist = 0, waist = 0.62, crown = 0.78 }) {
  const a = new THREE.Vector3(base[0], base[1], base[2])
  const b = new THREE.Vector3(tip[0], tip[1], tip[2])
  const axis = new THREE.Vector3().subVectors(b, a)
  const length = axis.length()
  axis.normalize()
  const side = new THREE.Vector3(0.3, 1, 0.2).cross(axis)
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0).cross(axis)
  side.normalize()
  const other = new THREE.Vector3().crossVectors(axis, side)
  const levels = [
    [0, waist],
    [crown * 0.72, 1],
    [crown, 0.7],
    [1, 0.02],
  ]
  const positions = []
  const colours = []
  const glows = []
  const skinIndex = []
  const skinWeight = []
  const ring = (t, s, k) => {
    const angle = (k / sides) * TAU + twist * t
    return a
      .clone()
      .addScaledVector(axis, length * t)
      .addScaledVector(side, Math.cos(angle) * radius * s)
      .addScaledVector(other, Math.sin(angle) * radius * s)
  }
  const push = (v, t) => {
    positions.push(v.x, v.y, v.z)
    INK.setRGB(1, 1, 1)
    INK.glow = 0
    if (paint) paint(t, 0, v, INK, DIR.copy(axis))
    colours.push(INK.r, INK.g, INK.b)
    glows.push(INK.glow)
    skinIndex.push(bone, 0, 0, 0)
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
  return finish(positions, new Float32Array((positions.length / 3) * 2), colours, glows, skinIndex, skinWeight, null)
}
