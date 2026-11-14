// Beast materials. Every material on a beast shares one set of uniforms, so the
// whole body flashes together when it is hit and takes the same colour wash.
//
// The look is clean and stylised: colour comes from the vertices (two or three
// tones and soft markings), each vertex also says how strongly it glows in its
// own colour, a very gentle grain map breaks up the highlights, and a coloured
// rim light picks the silhouette out of the dark pit.

import * as THREE from 'three'
import { hash3 } from '../noise.js'

export function makeUniforms() {
  return {
    uFlash: { value: 0 },
    uFlashTint: { value: new THREE.Color(1, 0.85, 0.7) },
    uPulse: { value: 1 },
    // 0..1: a wash of colour over the whole body (burn, soak, shock).
    uTint: { value: new THREE.Color(0, 0, 0) },
    uTintAmount: { value: 0 },
    // The rim light: the aspect's colour along the edges of the silhouette.
    uRim: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uRimPower: { value: 3.4 },
  }
}

const VERTEX_HEAD = /* glsl */ `
attribute float glow;
varying float vMaulGlow;
`

const VERTEX_BODY = /* glsl */ `
vMaulGlow = glow;
`

const FRAGMENT_HEAD = /* glsl */ `
varying float vMaulGlow;
uniform float uFlash;
uniform vec3 uFlashTint;
uniform float uPulse;
uniform vec3 uTint;
uniform float uTintAmount;
uniform vec3 uRim;
uniform float uRimPower;
uniform float uRimGain;
uniform vec2 uEye;
`

const FRAGMENT_COLOUR = /* glsl */ `
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTint * 2.0 + uTint * 0.25, uTintAmount);
`

const FRAGMENT_GLOW = /* glsl */ `
#if defined(MAUL_VGLOW) && defined(USE_COLOR)
  // Each vertex shines in its own colour, as strongly as it was painted to.
  totalEmissiveRadiance *= vColor.rgb * vMaulGlow;
#endif
#ifdef MAUL_EYE
  {
    // An eye is never black in the dark, and its iris carries a little light of its own.
    float maulSat = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
    totalEmissiveRadiance = diffuseColor.rgb * (uEye.x + uEye.y * maulSat);
  }
#endif
totalEmissiveRadiance *= uPulse;
{
  float maulFacing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float maulEdge = pow(1.0 - maulFacing, uRimPower);
  totalEmissiveRadiance += uRim * (maulEdge * uRimGain);
}
totalEmissiveRadiance += uFlashTint * uFlash;
totalEmissiveRadiance += uTint * uTintAmount * 0.35;
`

/** Gives a standard material the shared flash, tint, glow and rim behaviour. */
export function patch(material, uniforms, { rim = 1, eye = null } = {}) {
  const own = { uRimGain: { value: rim }, uEye: { value: new THREE.Vector2(eye ? eye[0] : 0, eye ? eye[1] : 0) } }
  material.userData.maul = own
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, own)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOUR}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_GLOW}`)
  }
  material.customProgramCacheKey = () => 'maul-beast-3'
  return material
}

/**
 * One material from a recipe:
 * { kind: 'skin' | 'hard' | 'fin' | 'crystal' | 'eye', grain, grainScale, rough, metal, glowPower, rim, eye }
 */
export function makeMaterial(recipe, uniforms) {
  if (recipe.kind === 'eye') {
    const material = new THREE.MeshStandardMaterial({ map: eyeTexture(recipe.eye), roughness: 0.08, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1 })
    material.defines = { MAUL_EYE: '' }
    return patch(material, uniforms, { rim: recipe.rim ?? 0.12, eye: [recipe.eye.light ?? 0.2, recipe.eye.shine ?? 0.7] })
  }
  const grain = recipe.grain ? grainTexture(recipe.grain) : null
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(recipe.colour ?? '#ffffff'),
    vertexColors: true,
    roughness: recipe.rough ?? 0.7,
    metalness: recipe.metal ?? 0,
    flatShading: recipe.kind === 'crystal',
    side: recipe.kind === 'fin' ? THREE.DoubleSide : THREE.FrontSide,
    emissive: 0xffffff,
    emissiveIntensity: recipe.glowPower ?? 2,
    normalMap: grain,
  })
  if (grain) material.normalScale = new THREE.Vector2(recipe.grainScale ?? 0.4, recipe.grainScale ?? 0.4)
  if (recipe.kind === 'fin') material.shadowSide = THREE.DoubleSide
  material.defines = { MAUL_VGLOW: '' }
  return patch(material, uniforms, { rim: recipe.rim ?? 1 })
}

// ----- Grain: very gentle surface detail ------------------------------------------

const grains = new Map()
const lerp = (a, b, t) => a + (b - a) * t
const fade = (t) => t * t * (3 - 2 * t)
const wrap = (v, p) => ((v % p) + p) % p

/** Value noise that repeats every `px` cells across and `py` cells up. */
function tile(x, y, px, py, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = fade(x - x0)
  const fy = fade(y - y0)
  const xa = wrap(x0, px)
  const xb = wrap(x0 + 1, px)
  const ya = wrap(y0, py)
  const yb = wrap(y0 + 1, py)
  return lerp(lerp(hash3(xa, ya, 0, seed), hash3(xb, ya, 0, seed), fx), lerp(hash3(xa, yb, 0, seed), hash3(xb, yb, 0, seed), fx), fy)
}

/** Height (0..1) of each kind of grain at (u, v) in 0..1. u runs along the body, v around it. */
const GRAIN = {
  // Short fur: fine strands lying along the body.
  fur(u, v) {
    const strand = tile(u * 10, v * 56, 10, 56, 3) * 0.6 + tile(u * 22, v * 120, 22, 120, 5) * 0.4
    return strand * 0.85 + tile(u * 4, v * 6, 4, 6, 9) * 0.15
  },
  // Small rounded scales in staggered rows.
  scales(u, v) {
    const rows = 30
    const cols = 26
    const y = v * rows
    const row = Math.floor(y)
    const x = u * cols + (row % 2) * 0.5
    const fx = x - Math.floor(x) - 0.5
    const fy = y - row - 0.5
    const dome = 1 - Math.min(1, Math.hypot(fx, fy * 1.1) * 1.75)
    return fade(Math.max(0, dome)) * 0.8 + tile(u * 30, v * 30, 30, 30, 7) * 0.1
  },
  // Worn stone: broad soft dimples and a little grit.
  stone(u, v) {
    return tile(u * 5, v * 5, 5, 5, 4) * 0.5 + tile(u * 12, v * 12, 12, 12, 6) * 0.3 + tile(u * 40, v * 40, 40, 40, 8) * 0.2
  },
  // Bare skin and horn: almost nothing.
  smooth(u, v) {
    return tile(u * 18, v * 18, 18, 18, 2) * 0.6 + tile(u * 44, v * 44, 44, 44, 5) * 0.4
  },
}

/** A small tileable normal map for one kind of grain. Built once and shared by every beast. */
export function grainTexture(kind, size = 256) {
  if (grains.has(kind)) return grains.get(kind)
  const fn = GRAIN[kind] || GRAIN.smooth
  const heights = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) heights[y * size + x] = fn(x / size, y / size)
  const at = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)]
  const data = new Uint8Array(size * size * 4)
  const bump = kind === 'scales' ? 1.6 : 3.2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * bump
      const dy = (at(x, y + 1) - at(x, y - 1)) * bump
      const len = Math.hypot(dx, dy, 1)
      const o = (y * size + x) * 4
      data[o] = ((-dx / len) * 0.5 + 0.5) * 255
      data[o + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255
      data[o + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  texture.userData.shared = true
  grains.set(kind, texture)
  return texture
}

// ----- Eyes ---------------------------------------------------------------------------

const eyes = new Map()
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The picture of an eye: a white sclera shaded like a ball, a coloured iris
 * with a dark ring and a pool of light at the bottom, a pupil (round, or a slit
 * as `slit` goes to 1) and two highlights. +u is towards the nose.
 * spec: { iris, inner, ring, white, size, pupil, slit, look: [x, y], spark }
 */
export function eyeImage(spec, size = 256) {
  const iris = new THREE.Color(spec.iris ?? '#ffb020')
  const inner = new THREE.Color(spec.inner ?? spec.iris ?? '#ffe070')
  const ring = new THREE.Color(spec.ring ?? '#1a1210')
  const white = new THREE.Color(spec.white ?? '#fbf7f0')
  const pupil = new THREE.Color('#0b0a10')
  const shine = new THREE.Color(1, 1, 1)
  const ri = spec.size ?? 0.58
  const rp = (spec.pupil ?? 0.48) * ri
  const slit = spec.slit ?? 0
  const [lx, ly] = spec.look ?? [0.08, 0]
  const spark = spec.spark ?? 1
  const data = new Uint8Array(size * size * 4)
  const aa = 2.5 / size
  const c = new THREE.Color()
  const out = new THREE.Color()
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * 2 - 1
      const y = ((py + 0.5) / size) * 2 - 1
      const r = Math.hypot(x, y)
      // The white: darker towards the edge and under the upper lid.
      c.copy(white).multiplyScalar((1 - 0.3 * smoothstep(0.55, 1.1, r)) * (1 - 0.34 * smoothstep(0.15, 1.0, y)))
      const dx = x - lx
      const dy = y - ly
      const di = Math.hypot(dx, dy) / ri
      const inIris = 1 - smoothstep(1 - aa / ri, 1 + aa / ri, di)
      if (inIris > 0) {
        const angle = Math.atan2(dy, dx)
        const fibre = 0.9 + 0.1 * Math.sin(angle * 22 + Math.sin(angle * 5) * 2)
        out.copy(inner).lerp(iris, smoothstep(0.3, 0.85, di)).multiplyScalar(fibre)
        // Light pools in the lower half of the iris.
        const pool = smoothstep(0.1, -0.85, dy / ri) * (1 - smoothstep(0.55, 0.95, di))
        out.lerp(white, pool * 0.3)
        out.multiplyScalar(1 - 0.3 * smoothstep(-0.2, 0.9, dy / ri))
        out.lerp(ring, smoothstep(0.8, 0.97, di) * 0.9)
        // The pupil.
        const ex = dx / (rp * (1 - 0.66 * slit))
        const ey = dy / (rp * (1 + 0.3 * slit))
        const dp = Math.hypot(ex, ey)
        out.lerp(pupil, 1 - smoothstep(1 - (aa * 1.5) / rp, 1 + (aa * 1.5) / rp, dp))
        c.lerp(out, inIris)
      }
      // Highlights: a large one up and towards the nose, a small one opposite.
      const hx = (dx - ri * 0.34) / (ri * 0.3 * spark)
      const hy = (dy - ri * 0.36) / (ri * 0.22 * spark)
      const big = 1 - smoothstep(0.75, 1.0, Math.hypot(hx * 0.88 + hy * 0.3, hy * 0.95 - hx * 0.25))
      const small = 1 - smoothstep(0.7, 1.0, Math.hypot(dx + ri * 0.36, dy + ri * 0.4) / (ri * 0.13 * spark))
      c.lerp(shine, Math.max(big, small * 0.85))
      const o = (py * size + px) * 4
      // Colours are worked in linear light; the texture is stored in sRGB.
      data[o] = Math.round(Math.pow(Math.min(1, c.r), 1 / 2.2) * 255)
      data[o + 1] = Math.round(Math.pow(Math.min(1, c.g), 1 / 2.2) * 255)
      data[o + 2] = Math.round(Math.pow(Math.min(1, c.b), 1 / 2.2) * 255)
      data[o + 3] = 255
    }
  }
  return data
}

/** The eye picture as a texture, shared by every beast with the same eye. */
export function eyeTexture(spec, size = 256) {
  const key = JSON.stringify(spec)
  if (eyes.has(key)) return eyes.get(key)
  const texture = new THREE.DataTexture(eyeImage(spec, size), size, size, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  texture.userData.shared = true
  eyes.set(key, texture)
  return texture
}
