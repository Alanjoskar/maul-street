// The effects engine: particles, scorch marks on the sand, lightning, shock rings.
// Recipes that use it (a bite, a Special, a kill) live in effects.js.

import * as THREE from 'three'
import { canvasTexture } from './textures.js'
import { mulberry32 } from './noise.js'

// ----- Sprite sheet -----------------------------------------------------------------
// One 4x4 sheet drawn at start-up. Cells:
export const SPRITE = { glow: 0, dot: 1, smoke: 2, drop: 3, streak: 4, ring: 5, flare: 6, shard: 7, leaf: 8, flame: 9, blob: 10, mist: 11, arc: 12, star: 13, mote: 14, chip: 15 }

function drawSheet(ctx, size) {
  const cell = size / 4
  const random = mulberry32(5)
  const at = (i, draw) => {
    ctx.save()
    ctx.translate((i % 4) * cell + cell / 2, Math.floor(i / 4) * cell + cell / 2)
    draw(cell / 2)
    ctx.restore()
  }
  const radial = (r, stops) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    for (const [t, c] of stops) g.addColorStop(t, c)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.clearRect(0, 0, size, size)
  at(SPRITE.glow, (r) => radial(r * 0.95, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]))
  at(SPRITE.dot, (r) => radial(r * 0.6, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,0.95)'], [1, 'rgba(255,255,255,0)']]))
  at(SPRITE.smoke, (r) => {
    for (let i = 0; i < 26; i++) {
      ctx.save()
      const a = random() * Math.PI * 2
      const d = random() * r * 0.45
      ctx.translate(Math.cos(a) * d, Math.sin(a) * d)
      radial(r * (0.25 + random() * 0.28), [[0, 'rgba(255,255,255,0.22)'], [1, 'rgba(255,255,255,0)']])
      ctx.restore()
    }
  })
  at(SPRITE.drop, (r) => {
    // A bead with a highlight: reads as wet.
    radial(r * 0.62, [[0, 'rgba(255,255,255,1)'], [0.7, 'rgba(235,235,235,1)'], [0.92, 'rgba(200,200,200,0.9)'], [1, 'rgba(255,255,255,0)']])
    ctx.save()
    ctx.translate(-r * 0.2, -r * 0.22)
    radial(r * 0.2, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']])
    ctx.restore()
  })
  at(SPRITE.streak, (r) => {
    const g = ctx.createLinearGradient(0, -r, 0, r)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 0.14, r * 0.95, 0, 0, Math.PI * 2)
    ctx.fill()
  })
  at(SPRITE.ring, (r) => {
    ctx.strokeStyle = 'rgba(255,255,255,1)'
    ctx.lineWidth = r * 0.1
    ctx.shadowColor = 'white'
    ctx.shadowBlur = r * 0.12
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2)
    ctx.stroke()
  })
  at(SPRITE.flare, (r) => {
    radial(r * 0.5, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']])
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 4)
      ctx.beginPath()
      ctx.ellipse(0, 0, r * 0.95, r * 0.035, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  })
  at(SPRITE.shard, (r) => {
    ctx.fillStyle = 'rgba(255,255,255,1)'
    ctx.beginPath()
    ctx.moveTo(-r * 0.5, r * 0.3)
    ctx.lineTo(-r * 0.1, -r * 0.7)
    ctx.lineTo(r * 0.55, -r * 0.2)
    ctx.lineTo(r * 0.3, r * 0.6)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(150,150,150,1)'
    ctx.beginPath()
    ctx.moveTo(-r * 0.1, -r * 0.7)
    ctx.lineTo(r * 0.55, -r * 0.2)
    ctx.lineTo(r * 0.05, r * 0.05)
    ctx.closePath()
    ctx.fill()
  })
  at(SPRITE.leaf, (r) => {
    ctx.fillStyle = 'rgba(255,255,255,1)'
    ctx.beginPath()
    ctx.moveTo(0, -r * 0.8)
    ctx.quadraticCurveTo(r * 0.6, 0, 0, r * 0.8)
    ctx.quadraticCurveTo(-r * 0.6, 0, 0, -r * 0.8)
    ctx.fill()
    ctx.strokeStyle = 'rgba(120,120,120,1)'
    ctx.lineWidth = r * 0.05
    ctx.beginPath()
    ctx.moveTo(0, -r * 0.75)
    ctx.lineTo(0, r * 0.75)
    ctx.stroke()
  })
  at(SPRITE.flame, (r) => {
    const g = ctx.createRadialGradient(0, r * 0.3, 0, 0, 0, r)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.6)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, -r * 0.95)
    ctx.bezierCurveTo(r * 0.75, -r * 0.1, r * 0.6, r * 0.75, 0, r * 0.85)
    ctx.bezierCurveTo(-r * 0.6, r * 0.75, -r * 0.75, -r * 0.1, 0, -r * 0.95)
    ctx.fill()
  })
  at(SPRITE.blob, (r) => {
    ctx.fillStyle = 'rgba(255,255,255,1)'
    ctx.beginPath()
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2
      const d = r * (0.42 + random() * 0.3)
      const x = Math.cos(a) * d
      const y = Math.sin(a) * d
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  })
  at(SPRITE.mist, (r) => {
    for (let i = 0; i < 40; i++) {
      ctx.save()
      const a = random() * Math.PI * 2
      const d = random() * r * 0.6
      ctx.translate(Math.cos(a) * d, Math.sin(a) * d)
      radial(r * (0.1 + random() * 0.16), [[0, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']])
      ctx.restore()
    }
  })
  at(SPRITE.arc, (r) => {
    ctx.strokeStyle = 'rgba(255,255,255,1)'
    ctx.lineWidth = r * 0.07
    ctx.shadowColor = 'white'
    ctx.shadowBlur = r * 0.2
    ctx.beginPath()
    let x = -r * 0.85
    let y = 0
    ctx.moveTo(x, y)
    while (x < r * 0.85) {
      x += r * 0.2
      y = (random() - 0.5) * r * 0.7
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  })
  at(SPRITE.star, (r) => {
    // A five-pointed cartoon star, for a beast that is seeing them.
    ctx.fillStyle = 'rgba(255,255,255,1)'
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const rad = i % 2 === 0 ? r * 0.84 : r * 0.38
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad)
    }
    ctx.closePath()
    ctx.fill()
  })
  at(SPRITE.mote, (r) => radial(r * 0.3, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]))
  at(SPRITE.chip, (r) => {
    ctx.fillStyle = 'rgba(255,255,255,1)'
    ctx.beginPath()
    ctx.moveTo(-r * 0.4, -r * 0.2)
    ctx.lineTo(r * 0.3, -r * 0.45)
    ctx.lineTo(r * 0.45, r * 0.25)
    ctx.lineTo(-r * 0.2, r * 0.4)
    ctx.closePath()
    ctx.fill()
  })
}

let sheet = null
const getSheet = () => (sheet ||= canvasTexture(1024, drawSheet))

// ----- Particles ------------------------------------------------------------------------

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iVel;
  attribute vec4 iColour;
  attribute vec4 iShape;   // size, stretch, rotation, sprite
  varying vec2 vUv;
  varying vec4 vColour;
  void main() {
    vColour = iColour;
    float sprite = iShape.w;
    vec2 cell = vec2(mod(sprite, 4.0), floor(sprite / 4.0));
    vUv = (uv + vec2(cell.x, 3.0 - cell.y)) * 0.25;
    vec4 centre = modelViewMatrix * vec4(iPos, 1.0);
    vec2 corner = position.xy * iShape.x;
    float c = cos(iShape.z), s = sin(iShape.z);
    corner = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
    if (iShape.y > 0.0) {
      // Stretch along the way it is moving, as seen by the camera.
      vec3 v = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
      float speed = length(v.xy);
      vec2 dir = speed > 0.0001 ? v.xy / speed : vec2(0.0, 1.0);
      vec2 side = vec2(-dir.y, dir.x);
      float lengthen = 1.0 + iShape.y * min(speed, 14.0) * 0.16;
      corner = side * position.x * iShape.x + dir * position.y * iShape.x * lengthen;
    }
    centre.xy += corner;
    gl_Position = projectionMatrix * centre;
  }
`
const FRAG = /* glsl */ `
  uniform sampler2D uSheet;
  varying vec2 vUv;
  varying vec4 vColour;
  void main() {
    vec4 tex = texture2D(uSheet, vUv);
    float alpha = tex.a * vColour.a;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColour.rgb * tex.rgb, alpha);
  }
`

class Pool {
  constructor(scene, max, additive) {
    this.max = max
    this.count = 0
    this.items = new Array(max)
    for (let i = 0; i < max; i++) this.items[i] = null
    const quad = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = quad.index
    geometry.setAttribute('position', quad.attributes.position)
    geometry.setAttribute('uv', quad.attributes.uv)
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.aColour = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.aShape = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('iPos', this.aPos)
    geometry.setAttribute('iVel', this.aVel)
    geometry.setAttribute('iColour', this.aColour)
    geometry.setAttribute('iShape', this.aShape)
    geometry.instanceCount = 0
    const material = new THREE.ShaderMaterial({
      uniforms: { uSheet: { value: getSheet() } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = additive ? 12 : 10
    scene.add(this.mesh)
  }

  spawn(p) {
    if (this.count >= this.max) {
      // Full: the oldest gives way.
      this.items[0] = this.items[this.count - 1]
      this.count--
    }
    this.items[this.count++] = p
  }

  update(dt, onGround) {
    const { items } = this
    const pos = this.aPos.array
    const vel = this.aVel.array
    const colour = this.aColour.array
    const shape = this.aShape.array
    let n = 0
    for (let i = 0; i < this.count; i++) {
      const p = items[i]
      p.age += dt
      if (p.age >= p.life) continue
      const k = p.age / p.life
      if (p.drag) {
        const d = Math.exp(-p.drag * dt)
        p.vx *= d
        p.vy *= d
        p.vz *= d
      }
      p.vy -= p.gravity * dt
      if (p.swirl) {
        p.vx += Math.sin(p.age * 5 + p.seed) * p.swirl * dt
        p.vz += Math.cos(p.age * 4 + p.seed) * p.swirl * dt
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.ground && p.y <= 0.02) {
        if (onGround) onGround(p)
        if (p.bounce && Math.abs(p.vy) > 1.2) {
          p.y = 0.03
          p.vy = -p.vy * p.bounce
          p.vx *= 0.6
          p.vz *= 0.6
        } else {
          continue
        }
      }
      p.rot += p.spin * dt
      const size = p.size + (p.size2 - p.size) * (p.grow ? 1 - (1 - k) * (1 - k) : k)
      // Fade in fast, hold, fade out.
      let alpha = p.alpha
      if (k < p.fadeIn) alpha *= k / p.fadeIn
      if (k > p.fadeOut) alpha *= 1 - (k - p.fadeOut) / (1 - p.fadeOut)
      const c = k * p.shift
      items[n] = p
      pos[n * 3] = p.x
      pos[n * 3 + 1] = p.y
      pos[n * 3 + 2] = p.z
      vel[n * 3] = p.vx
      vel[n * 3 + 1] = p.vy
      vel[n * 3 + 2] = p.vz
      colour[n * 4] = p.r + (p.r2 - p.r) * c
      colour[n * 4 + 1] = p.g + (p.g2 - p.g) * c
      colour[n * 4 + 2] = p.b + (p.b2 - p.b) * c
      colour[n * 4 + 3] = alpha
      shape[n * 4] = size
      shape[n * 4 + 1] = p.stretch
      shape[n * 4 + 2] = p.rot
      shape[n * 4 + 3] = p.sprite
      n++
    }
    this.count = n
    this.mesh.geometry.instanceCount = n
    this.aPos.needsUpdate = true
    this.aVel.needsUpdate = true
    this.aColour.needsUpdate = true
    this.aShape.needsUpdate = true
  }
}

const cA = new THREE.Color()
const cB = new THREE.Color()

export class Fx {
  constructor(stage) {
    this.stage = stage
    this.scene = stage.scene
    this.random = mulberry32(1234)
    this.glow = new Pool(this.scene, 5000, true)
    this.solid = new Pool(this.scene, 3500, false)
    this.timed = []
    this.emitters = new Set()
    this.bolts = []
    this.detail = 1
    stage.add(this)
  }

  rand(a = 1, b) {
    return b === undefined ? this.random() * a : a + this.random() * (b - a)
  }

  /**
   * One particle.
   * o: { p:[x,y,z] | Vector3, v:[x,y,z], life, size, size2, colour, colour2, alpha, sprite, add (additive),
   *      gravity, drag, spin, stretch, grow, fadeIn, fadeOut, ground (dies on the sand), bounce, swirl }
   */
  spawn(o) {
    const p = o.p
    const v = o.v || [0, 0, 0]
    cA.set(o.colour ?? '#ffffff')
    cB.set(o.colour2 ?? o.colour ?? '#ffffff')
    const boost = o.boost ?? 1
    const particle = {
      x: p.x ?? p[0],
      y: p.y ?? p[1],
      z: p.z ?? p[2],
      vx: v[0],
      vy: v[1],
      vz: v[2],
      age: 0,
      life: o.life ?? 1,
      size: o.size ?? 0.2,
      size2: o.size2 ?? o.size ?? 0.2,
      r: cA.r * boost,
      g: cA.g * boost,
      b: cA.b * boost,
      r2: cB.r * boost,
      g2: cB.g * boost,
      b2: cB.b * boost,
      shift: o.colour2 ? 1 : 0,
      alpha: o.alpha ?? 1,
      sprite: o.sprite ?? SPRITE.glow,
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 0,
      rot: o.rot ?? this.random() * 6.28,
      spin: o.spin ?? 0,
      stretch: o.stretch ?? 0,
      grow: !!o.grow,
      fadeIn: o.fadeIn ?? 0.08,
      fadeOut: o.fadeOut ?? 0.6,
      ground: !!o.ground,
      bounce: o.bounce ?? 0,
      swirl: o.swirl ?? 0,
      seed: this.random() * 100,
    }
    ;(o.add ? this.glow : this.solid).spawn(particle)
    return particle
  }

  /** Runs `fn(t01, dt)` every frame for `seconds`, then `done`. */
  over(seconds, fn, done) {
    this.timed.push({ t: 0, seconds, fn, done })
  }

  /** A function called every frame until it returns false or is removed with the handle it returns. */
  emitter(fn) {
    const handle = { fn, alive: true, stop: () => (handle.alive = false) }
    this.emitters.add(handle)
    return handle
  }

  /** A jagged bolt of light between two points that flickers for `life` seconds. */
  bolt(from, to, { colour = '#cfd8ff', width = 0.07, life = 0.22, forks = 2, jag = 0.5 } = {}) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(6), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    material.toneMapped = false
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
    mesh.frustumCulled = false
    mesh.renderOrder = 14
    this.scene.add(mesh)
    const bolt = { mesh, from: from.clone(), to: to.clone(), width, life, age: 0, forks, jag, next: 0 }
    this.bolts.push(bolt)
    this.rebuildBolt(bolt)
    return bolt
  }

  rebuildBolt(bolt) {
    const geometries = []
    const path = (a, b, width, jag) => {
      let points = [a.clone(), b.clone()]
      let offset = a.distanceTo(b) * 0.14 * jag
      for (let pass = 0; pass < 4; pass++) {
        const next = []
        for (let i = 0; i < points.length - 1; i++) {
          const mid = points[i].clone().lerp(points[i + 1], 0.5)
          mid.x += (this.random() - 0.5) * offset * 2
          mid.y += (this.random() - 0.5) * offset * 2
          mid.z += (this.random() - 0.5) * offset * 2
          next.push(points[i], mid)
        }
        next.push(points[points.length - 1])
        points = next
        offset *= 0.55
      }
      geometries.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 2, width, 4, false))
      return points
    }
    const main = path(bolt.from, bolt.to, bolt.width, bolt.jag)
    for (let f = 0; f < bolt.forks; f++) {
      const start = main[Math.floor(this.rand(0.2, 0.75) * main.length)]
      const end = start.clone().add(new THREE.Vector3(this.rand(-1, 1), this.rand(-1.2, 0.2), this.rand(-1, 1)).multiplyScalar(bolt.from.distanceTo(bolt.to) * 0.28))
      path(start, end, bolt.width * 0.5, bolt.jag)
    }
    bolt.mesh.geometry.dispose()
    bolt.mesh.geometry = mergeTubes(geometries)
  }

  /** A ring that races outward across the sand. */
  ring(centre, { colour = '#ffffff', from = 0.3, to = 5, life = 0.5, width = 0.25, power = 2, y = 0.05 } = {}) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      side: THREE.DoubleSide,
      uniforms: { uColour: { value: new THREE.Color(colour).multiplyScalar(power) }, uAlpha: { value: 1 }, uInner: { value: 0.8 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform vec3 uColour; uniform float uAlpha; uniform float uInner; varying vec2 vUv;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float band = smoothstep(uInner, mix(uInner, 1.0, 0.6), d) * smoothstep(1.0, 0.94, d);
          gl_FragColor = vec4(uColour * band * uAlpha, band * uAlpha);
        }`,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(centre.x, y, centre.z)
    mesh.renderOrder = 9
    this.scene.add(mesh)
    this.over(
      life,
      (t) => {
        const e = 1 - (1 - t) * (1 - t)
        const r = from + (to - from) * e
        mesh.scale.setScalar(r)
        material.uniforms.uInner.value = Math.max(0, 1 - width / Math.max(r, 0.01))
        material.uniforms.uAlpha.value = 1 - t
      },
      () => {
        this.scene.remove(mesh)
        mesh.geometry.dispose()
        material.dispose()
      },
    )
  }

  update(dt) {
    for (const handle of this.emitters) {
      if (!handle.alive || handle.fn(dt) === false) this.emitters.delete(handle)
    }
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const job = this.timed[i]
      job.t += dt
      const t = Math.min(1, job.t / job.seconds)
      job.fn(t, dt)
      if (t >= 1) {
        this.timed.splice(i, 1)
        if (job.done) job.done()
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]
      bolt.age += dt
      bolt.next -= dt
      if (bolt.age >= bolt.life) {
        this.scene.remove(bolt.mesh)
        bolt.mesh.geometry.dispose()
        bolt.mesh.material.dispose()
        this.bolts.splice(i, 1)
        continue
      }
      if (bolt.next <= 0) {
        bolt.next = 0.045
        this.rebuildBolt(bolt)
      }
      bolt.mesh.material.opacity = (1 - bolt.age / bolt.life) * (0.6 + this.random() * 0.4)
    }
    this.glow.update(dt, null)
    this.solid.update(dt, null)
  }

  /** Wipes anything still in the air (between fights). */
  clear() {
    this.glow.count = 0
    this.solid.count = 0
    for (const bolt of this.bolts) {
      this.scene.remove(bolt.mesh)
      bolt.mesh.geometry.dispose()
    }
    this.bolts.length = 0
    this.timed.length = 0
    for (const handle of this.emitters) if (!handle.keep) handle.alive = false
  }
}

function mergeTubes(list) {
  if (list.length === 1) return list[0]
  let vertices = 0
  let indices = 0
  for (const g of list) {
    vertices += g.attributes.position.count
    indices += g.index.count
  }
  const position = new Float32Array(vertices * 3)
  const index = new Uint32Array(indices)
  let vo = 0
  let io = 0
  for (const g of list) {
    position.set(g.attributes.position.array, vo * 3)
    for (let i = 0; i < g.index.count; i++) index[io + i] = g.index.array[i] + vo
    vo += g.attributes.position.count
    io += g.index.count
    g.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3))
  merged.setIndex(new THREE.BufferAttribute(index, 1))
  return merged
}
