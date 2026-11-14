// Seeded randomness and tileable noise. Every beast and texture is built from
// these, so the same species always grows the same body.

export function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash3(x, y, z, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const mix = (a, b, t) => a + (b - a) * t
const wrap = (v, p) => ((v % p) + p) % p

/** Value noise in 2D that repeats every `period` cells. Returns 0..1. */
export function noise2(x, y, period = 256, seed = 0) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = fade(x - x0)
  const fy = fade(y - y0)
  const xa = wrap(x0, period)
  const xb = wrap(x0 + 1, period)
  const ya = wrap(y0, period)
  const yb = wrap(y0 + 1, period)
  return mix(
    mix(hash3(xa, ya, 0, seed), hash3(xb, ya, 0, seed), fx),
    mix(hash3(xa, yb, 0, seed), hash3(xb, yb, 0, seed), fx),
    fy,
  )
}

/** Value noise in 3D. Returns 0..1. */
export function noise3(x, y, z, seed = 0) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const fx = fade(x - x0)
  const fy = fade(y - y0)
  const fz = fade(z - z0)
  const h = (i, j, k) => hash3(x0 + i, y0 + j, z0 + k, seed)
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), fx), mix(h(0, 1, 0), h(1, 1, 0), fx), fy),
    mix(mix(h(0, 0, 1), h(1, 0, 1), fx), mix(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz,
  )
}

/** Layered 2D noise, tileable. `period` is the tile size of the first layer. */
export function fbm2(x, y, octaves = 5, period = 8, seed = 0) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let p = period
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x, y, p, seed + i * 17)
    norm += amp
    amp *= 0.5
    x *= 2
    y *= 2
    p *= 2
  }
  return sum / norm
}

export function fbm3(x, y, z, octaves = 4, seed = 0) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x, y, z, seed + i * 31)
    norm += amp
    amp *= 0.5
    x *= 2.03
    y *= 2.03
    z *= 2.03
  }
  return sum / norm
}

/**
 * Cell noise, tileable. Returns [f1, f2, id]: the distance to the nearest
 * feature point, to the second nearest, and a random 0..1 id for the nearest cell.
 */
export function worley2(x, y, period = 8, seed = 0, jitter = 1) {
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  let f1 = 9
  let f2 = 9
  let id = 0
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i
      const gy = cy + j
      const wx = wrap(gx, period)
      const wy = wrap(gy, period)
      const px = gx + 0.5 + (hash3(wx, wy, 1, seed) - 0.5) * jitter
      const py = gy + 0.5 + (hash3(wx, wy, 2, seed) - 0.5) * jitter
      const d = Math.hypot(px - x, py - y)
      if (d < f1) {
        f2 = f1
        f1 = d
        id = hash3(wx, wy, 3, seed)
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  return [f1, f2, id]
}

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const lerp = mix
