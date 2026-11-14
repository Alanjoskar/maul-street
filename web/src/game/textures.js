// Surface detail, grown from noise at start-up. Each surface is a tileable set
// of maps (colour variation, normals, roughness and sometimes a glow map) that
// the beast materials multiply with per-vertex colour.

import * as THREE from 'three'
import { clamp, fbm2, noise2, smooth, worley2 } from './noise.js'

const cache = new Map()

/**
 * Height functions: (u, v) in 0..1 → { h, glow?, tone? }.
 * `h` drives normals and crevice darkening. `glow` (0..1) lights the glow map.
 */
const SURFACES = {
  // Overlapping rounded scales.
  scales(u, v, seed) {
    const [f1, f2, id] = worley2(u * 14, v * 14 + Math.floor(u * 14) * 0.5, 14, seed, 0.55)
    const dome = 1 - smooth(0.0, 0.62, f1)
    const edge = smooth(0.0, 0.1, f2 - f1)
    const fine = fbm2(u * 48, v * 48, 3, 48, seed + 5)
    return { h: clamp(dome * 0.75 * edge + fine * 0.18 + id * 0.08), tone: 0.82 + id * 0.3 }
  },
  // Big armoured plates with deep seams.
  plates(u, v, seed) {
    const [f1, f2, id] = worley2(u * 6, v * 6, 6, seed, 0.8)
    const seam = smooth(0.02, 0.16, f2 - f1)
    const wear = fbm2(u * 24, v * 24, 4, 24, seed + 3)
    return { h: clamp(seam * (0.62 + id * 0.25) + wear * 0.22 - (1 - seam) * 0.1), tone: 0.78 + id * 0.3 + wear * 0.12 }
  },
  // Weathered stone with cracks.
  rock(u, v, seed) {
    const ridged = 1 - Math.abs(fbm2(u * 6, v * 6, 5, 6, seed) * 2 - 1)
    const [f1, f2] = worley2(u * 5, v * 5, 5, seed + 9, 1)
    const crack = smooth(0.0, 0.06, f2 - f1)
    const grit = fbm2(u * 60, v * 60, 2, 60, seed + 2)
    return { h: clamp(ridged * 0.65 * crack + grit * 0.2 + 0.08), tone: 0.74 + ridged * 0.3 + grit * 0.1 }
  },
  // Bark: long ridges that run along the body.
  bark(u, v, seed) {
    const warp = fbm2(u * 4, v * 4, 3, 4, seed + 1) * 0.6
    const ridge = 1 - Math.abs(fbm2(u * 3 + warp, v * 22, 4, 22, seed) * 2 - 1)
    const knots = smooth(0.25, 0.0, worley2(u * 5, v * 5, 5, seed + 4, 1)[0])
    return { h: clamp(Math.pow(ridge, 1.6) * 0.8 + knots * 0.3), tone: 0.7 + ridge * 0.35 }
  },
  // Thick, wrinkled hide.
  hide(u, v, seed) {
    const [f1, f2] = worley2(u * 22, v * 22, 22, seed, 1)
    const crease = smooth(0.0, 0.12, f2 - f1)
    const fold = fbm2(u * 7, v * 7, 4, 7, seed + 8)
    return { h: clamp(crease * 0.55 + fold * 0.4 + f1 * 0.12), tone: 0.8 + fold * 0.28 }
  },
  // Cooled slag split by glowing cracks.
  magma(u, v, seed) {
    const warp = fbm2(u * 5, v * 5, 3, 5, seed + 6) * 0.35
    const [f1, f2, id] = worley2(u * 7 + warp, v * 7 + warp, 7, seed, 1)
    const gap = f2 - f1
    const crust = smooth(0.03, 0.2, gap)
    const fine = fbm2(u * 40, v * 40, 3, 40, seed + 2)
    // Only some of the crust is still molten underneath: the rest has cooled dark.
    const heat = smooth(0.38, 0.62, fbm2(u * 3, v * 3, 3, 3, seed + 12))
    const glow = Math.pow(1 - smooth(0.0, 0.085, gap), 1.6) * (0.15 + 0.85 * heat)
    return { h: clamp(crust * (0.6 + id * 0.25) + fine * 0.2), glow, tone: 0.72 + id * 0.25 + fine * 0.15 }
  },
  // Faint veins of light under a dark skin (storm and tide beasts).
  veins(u, v, seed) {
    const warp = fbm2(u * 6, v * 6, 3, 6, seed + 3) * 0.5
    const [f1, f2] = worley2(u * 9 + warp, v * 9 - warp, 9, seed, 1)
    const line = Math.pow(1 - smooth(0.0, 0.07, f2 - f1), 2)
    const fine = fbm2(u * 36, v * 36, 4, 36, seed + 1)
    const scale = 1 - smooth(0.0, 0.5, worley2(u * 30, v * 30, 30, seed + 7, 0.7)[0])
    return { h: clamp(scale * 0.5 + fine * 0.3 + 0.1), glow: line * (0.4 + 0.6 * fine), tone: 0.82 + fine * 0.25 }
  },
  // Smooth belly: soft folds across the body.
  belly(u, v, seed) {
    const bands = 0.5 + 0.5 * Math.sin((u * 26 + fbm2(u * 3, v * 3, 2, 3, seed) * 1.2) * Math.PI * 2)
    const fine = fbm2(u * 30, v * 30, 3, 30, seed + 4)
    return { h: clamp(smooth(0.1, 0.9, bands) * 0.55 + fine * 0.3), tone: 0.86 + fine * 0.2 }
  },
  // Wing membrane: veins fanning out, thin skin between.
  membrane(u, v, seed) {
    const fan = Math.abs(Math.sin(u * Math.PI * 6 + fbm2(u * 4, v * 4, 2, 4, seed) * 1.4))
    const vein = Math.pow(1 - smooth(0.0, 0.2, fan), 2) * smooth(1.0, 0.2, v)
    const fine = fbm2(u * 28, v * 28, 4, 28, seed + 2)
    return { h: clamp(vein * 0.7 + fine * 0.25), glow: vein * 0.35 + smooth(0.75, 1.0, v) * 0.3, tone: 0.8 + fine * 0.25 - vein * 0.25 }
  },
  // Bone, horn and claw: fine grooves along the length.
  horn(u, v, seed) {
    const groove = 0.5 + 0.5 * Math.sin((v * 34 + fbm2(u * 5, v * 5, 3, 5, seed) * 2) * Math.PI * 2)
    const rings = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 18)
    const fine = fbm2(u * 44, v * 44, 3, 44, seed + 6)
    return { h: clamp(groove * 0.35 + rings * 0.25 + fine * 0.3), tone: 0.78 + fine * 0.3 }
  },
  // Sand and trampled dirt for the pit floor.
  sand(u, v, seed) {
    const dunes = fbm2(u * 5, v * 5, 5, 5, seed)
    const grit = fbm2(u * 80, v * 80, 2, 80, seed + 1)
    const [f1] = worley2(u * 26, v * 26, 26, seed + 3, 1)
    const pebble = smooth(0.22, 0.05, f1) * 0.5
    return { h: clamp(dunes * 0.55 + grit * 0.25 + pebble), tone: 0.72 + dunes * 0.4 + grit * 0.1 }
  },
  // Fine, even sand for the pit floor: grain and small wind ripples, no blotches.
  fineSand(u, v, seed) {
    const grit = fbm2(u * 96, v * 96, 2, 96, seed + 1)
    const ripple = fbm2(u * 14, v * 14, 3, 14, seed)
    const [f1] = worley2(u * 30, v * 30, 30, seed + 3, 1)
    const pebble = smooth(0.16, 0.04, f1) * 0.35
    return { h: clamp(0.3 + ripple * 0.3 + grit * 0.22 + pebble), tone: 0.93 + grit * 0.09 + ripple * 0.05 }
  },
  // Large dressed stone: flat faces, soft bevels at the joints, each block its own shade.
  ashlar(u, v, seed) {
    const rows = 4
    const cols = 6
    const row = Math.floor(v * rows)
    const x = u * cols + (row % 2) * 0.5
    const col = Math.floor(x)
    const fx = x - col
    const fy = v * rows - row
    const joint = smooth(0.0, 0.045, Math.min(fx, 1 - fx)) * smooth(0.0, 0.065, Math.min(fy, 1 - fy))
    const id = noise2((col % cols) * 7.3 + 0.5, row * 3.1 + 0.5, 64, seed + 5)
    const fine = fbm2(u * 36, v * 36, 3, 36, seed)
    const streak = fbm2(u * 24, v * 2, 3, 24, seed + 9)
    return { h: clamp(joint * (0.74 + id * 0.14) + fine * 0.07), tone: 0.74 + id * 0.24 + fine * 0.07 - streak * 0.1 }
  },
  // Cut stone blocks for the pit wall.
  blocks(u, v, seed) {
    const rows = 6
    const row = Math.floor(v * rows)
    const cols = 9
    const x = u * cols + (row % 2) * 0.5
    const col = Math.floor(x)
    const fx = x - col
    const fy = v * rows - row
    const mortar = smooth(0.0, 0.06, Math.min(fx, 1 - fx)) * smooth(0.0, 0.09, Math.min(fy, 1 - fy))
    const id = noise2(col * 7.3 + 0.5, row * 3.1 + 0.5, 64, seed + 5)
    const wear = fbm2(u * 30, v * 30, 4, 30, seed)
    const chip = smooth(0.3, 0.0, worley2(u * 16, v * 16, 16, seed + 2, 1)[0]) * 0.25
    return { h: clamp(mortar * (0.6 + id * 0.25) + wear * 0.2 - chip), tone: 0.6 + id * 0.35 + wear * 0.2 }
  },
}

/**
 * Builds (or returns from cache) one tileable surface.
 * → { map, normalMap, roughnessMap, emissiveMap | null }
 */
export function surface(kind, { size = 512, seed = 1, bump = 2.2, rough = [0.45, 0.95] } = {}) {
  const key = `${kind}:${size}:${seed}:${bump}:${rough}`
  if (cache.has(key)) return cache.get(key)
  const fn = SURFACES[kind] || SURFACES.hide
  const heights = new Float32Array(size * size)
  const glows = new Float32Array(size * size)
  const tones = new Float32Array(size * size)
  let anyGlow = false
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const out = fn(x / size, y / size, seed)
      const i = y * size + x
      heights[i] = out.h
      tones[i] = out.tone ?? 1
      if (out.glow) {
        glows[i] = out.glow
        anyGlow = true
      }
    }
  }
  const colour = new Uint8ClampedArray(size * size * 4)
  const normal = new Uint8ClampedArray(size * size * 4)
  const roughness = new Uint8ClampedArray(size * size * 4)
  const glow = anyGlow ? new Uint8ClampedArray(size * size * 4) : null
  const at = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const o = i * 4
      const h = heights[i]
      // Crevices are darker and rougher than the high ground.
      const shade = clamp(tones[i] * (0.5 + 0.5 * Math.pow(h, 0.7)), 0, 1.25)
      const c = clamp(shade) * 255
      colour[o] = colour[o + 1] = colour[o + 2] = c
      colour[o + 3] = 255
      const dx = (at(x + 1, y) - at(x - 1, y)) * bump
      const dy = (at(x, y + 1) - at(x, y - 1)) * bump
      const len = Math.hypot(dx, dy, 1)
      normal[o] = (-dx / len * 0.5 + 0.5) * 255
      normal[o + 1] = (-dy / len * 0.5 + 0.5) * 255
      normal[o + 2] = (1 / len * 0.5 + 0.5) * 255
      normal[o + 3] = 255
      const r = rough[0] + (rough[1] - rough[0]) * (1 - h * 0.85)
      roughness[o] = 255
      roughness[o + 1] = clamp(r) * 255
      roughness[o + 2] = 0
      roughness[o + 3] = 255
      if (glow) {
        const g = clamp(glows[i]) * 255
        glow[o] = glow[o + 1] = glow[o + 2] = g
        glow[o + 3] = 255
      }
    }
  }
  const make = (data, srgb) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = 8
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.needsUpdate = true
    return texture
  }
  const set = {
    map: make(colour, true),
    normalMap: make(normal, false),
    roughnessMap: make(roughness, false),
    emissiveMap: glow ? make(glow, true) : null,
  }
  cache.set(key, set)
  return set
}

/** A small canvas texture drawn by `draw(ctx, size)`. Used for particle sprites and decals. */
export function canvasTexture(size, draw, { srgb = true } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  draw(ctx, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.anisotropy = 4
  return texture
}
