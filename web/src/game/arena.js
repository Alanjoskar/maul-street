// The pit: a ring of old stone under a night sky, lit by torches and one hard
// lamp from above. Everything is built in code.

import * as THREE from 'three'
import { surface, canvasTexture } from './textures.js'
import { mulberry32 } from './noise.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export const PIT_RADIUS = 13

export class Arena {
  constructor(stage) {
    this.stage = stage
    const scene = stage.scene
    this.group = new THREE.Group()
    scene.add(this.group)
    scene.fog = new THREE.FogExp2(0x151b30, 0.024)
    scene.background = new THREE.Color(0x070812)
    this.torches = []
    this.time = 0
    this.mood = { moon: new THREE.Color(0x9fb4ff), red: 0 }

    this.buildSky()
    this.buildFloor()
    this.buildWall()
    this.buildStands()
    this.buildLights()
    this.buildEnvironment()
    stage.add(this)
  }

  buildSky() {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 }, uRed: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uTime;
        uniform float uRed;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 low = mix(vec3(0.16, 0.085, 0.10), vec3(0.24, 0.03, 0.03), uRed);
          vec3 high = mix(vec3(0.016, 0.026, 0.085), vec3(0.06, 0.0, 0.01), uRed);
          vec3 col = mix(low, high, smoothstep(-0.05, 0.55, h));
          // The moon, with a halo. It turns red for the Red Moon finisher.
          vec3 moonDir = normalize(vec3(-0.35, 0.52, -0.78));
          float m = dot(d, moonDir);
          vec3 moonCol = mix(vec3(0.85, 0.88, 1.0), vec3(1.0, 0.12, 0.08), uRed);
          col += moonCol * smoothstep(0.9965, 0.9978, m) * 2.2;
          col += moonCol * pow(max(m, 0.0), 60.0) * 0.22;
          col += moonCol * pow(max(m, 0.0), 8.0) * 0.05;
          // Stars, thinned by drifting cloud.
          vec2 sp = d.xz / (d.y + 0.35) * 40.0;
          float star = step(0.9975, hash(floor(sp))) * smoothstep(0.05, 0.5, h);
          float cloud = fbm(d.xz / (d.y + 0.4) * 2.2 + vec2(uTime * 0.01, 0.0));
          col += vec3(0.8, 0.85, 1.0) * star * (1.0 - cloud) * 0.9;
          col += mix(vec3(0.05, 0.05, 0.085), vec3(0.14, 0.02, 0.02), uRed) * smoothstep(0.42, 0.85, cloud) * smoothstep(0.0, 0.4, h);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(220, 32, 20), material)
    this.group.add(this.sky)
  }

  buildFloor() {
    const sand = surface('fineSand', { seed: 4, bump: 2.4 })
    const map = sand.map.clone()
    const normalMap = sand.normalMap.clone()
    const roughnessMap = sand.roughnessMap.clone()
    for (const texture of [map, normalMap, roughnessMap]) {
      texture.repeat.set(7, 7)
      texture.needsUpdate = true
    }
    // Trampled dark in the middle, paler towards the wall.
    const geometry = new THREE.CircleGeometry(PIT_RADIUS + 0.4, 96, 0, Math.PI * 2)
    geometry.rotateX(-Math.PI / 2)
    const colours = new Float32Array(geometry.attributes.position.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      const x = geometry.attributes.position.getX(i)
      const z = geometry.attributes.position.getZ(i)
      const r = Math.hypot(x, z) / PIT_RADIUS
      c.set('#7d6347').lerp(new THREE.Color('#b0936a'), Math.min(1, r * r))
      colours.set([c.r, c.g, c.b], i * 3)
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    const uv = geometry.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, geometry.attributes.position.getX(i) / (PIT_RADIUS * 2), geometry.attributes.position.getZ(i) / (PIT_RADIUS * 2))
    const material = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, roughness: 1, metalness: 0, vertexColors: true, normalScale: new THREE.Vector2(0.75, 0.75) })
    const floor = new THREE.Mesh(geometry, material)
    floor.receiveShadow = true
    this.group.add(floor)
    this.floor = floor

    // A carved stone ring marks the fighting line, with the mark of the Street at its heart.
    const stone = surface('rock', { seed: 8, bump: 3 })
    const ringMat = new THREE.MeshStandardMaterial({
      map: stone.map,
      normalMap: stone.normalMap,
      roughnessMap: stone.roughnessMap,
      color: 0x4a4038,
      roughness: 0.9,
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(7.6, 8.1, 96, 1), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.012
    ring.receiveShadow = true
    this.group.add(ring)
    const sigil = canvasTexture(512, (ctx, s) => {
      ctx.clearRect(0, 0, s, s)
      ctx.translate(s / 2, s / 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(0, 0, s * 0.36, 0, Math.PI * 2)
      ctx.stroke()
      // Five fangs for the five aspects, pointing in.
      for (let i = 0; i < 5; i++) {
        ctx.save()
        ctx.rotate((i / 5) * Math.PI * 2)
        ctx.beginPath()
        ctx.moveTo(-s * 0.05, -s * 0.36)
        ctx.lineTo(s * 0.05, -s * 0.36)
        ctx.lineTo(0, -s * 0.14)
        ctx.closePath()
        ctx.fillStyle = 'rgba(255,255,255,0.8)'
        ctx.fill()
        ctx.restore()
      }
      // The M of the Street.
      ctx.lineWidth = 10
      ctx.lineJoin = 'miter'
      ctx.beginPath()
      ctx.moveTo(-s * 0.09, s * 0.08)
      ctx.lineTo(-s * 0.09, -s * 0.08)
      ctx.lineTo(0, s * 0.02)
      ctx.lineTo(s * 0.09, -s * 0.08)
      ctx.lineTo(s * 0.09, s * 0.08)
      ctx.stroke()
    })
    const mark = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 48),
      new THREE.MeshBasicMaterial({ map: sigil, transparent: true, opacity: 0.13, color: 0x2a1a10, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true }),
    )
    mark.material.blending = THREE.NormalBlending
    mark.material.color.set(0x1a0f08)
    mark.material.opacity = 0.42
    mark.rotation.x = -Math.PI / 2
    mark.position.y = 0.014
    mark.renderOrder = 1
    this.group.add(mark)
  }

  buildWall() {
    const blocks = surface('ashlar', { seed: 6, bump: 3.4 })
    const wrap = (texture, x, y) => {
      const t = texture.clone()
      t.repeat.set(x, y)
      t.needsUpdate = true
      return t
    }
    const wallMat = new THREE.MeshStandardMaterial({
      map: wrap(blocks.map, 9, 1),
      normalMap: wrap(blocks.normalMap, 9, 1),
      roughnessMap: wrap(blocks.roughnessMap, 9, 1),
      color: 0x6a5a4c,
      roughness: 1,
      side: THREE.BackSide,
      normalScale: new THREE.Vector2(1.2, 1.2),
    })
    const wallHeight = 4.4
    const wallGeo = new THREE.CylinderGeometry(PIT_RADIUS, PIT_RADIUS, wallHeight, 144, 10, true)
    // Years of grime: dark at the foot where sand collects, sooty near the torches' lip, with damp streaks.
    const grime = new Float32Array(wallGeo.attributes.position.count * 3)
    const stain = mulberry32(31)
    const streaks = Array.from({ length: 40 }, () => ({ a: stain() * Math.PI * 2, w: 0.02 + stain() * 0.05, d: 0.25 + stain() * 0.5 }))
    for (let i = 0; i < wallGeo.attributes.position.count; i++) {
      const x = wallGeo.attributes.position.getX(i)
      const y = wallGeo.attributes.position.getY(i) / wallHeight + 0.5
      const z = wallGeo.attributes.position.getZ(i)
      const angle = Math.atan2(z, x)
      let shade = 0.5 + 0.5 * Math.min(1, y * 2.2)
      shade *= 1 - Math.max(0, y - 0.82) * 1.6
      for (const s of streaks) {
        // The shortest way round the wall between this point and the streak.
        const turn = Math.PI * 2
        const da = Math.abs(((((angle - s.a) % turn) + turn + Math.PI) % turn) - Math.PI)
        if (da < s.w) shade *= 1 - s.d * (1 - da / s.w) * (1 - y * 0.6)
      }
      const warm = 1 - y * 0.12
      grime.set([shade * warm, shade * 0.94, shade * 0.9], i * 3)
    }
    wallGeo.setAttribute('color', new THREE.BufferAttribute(grime, 3))
    wallMat.vertexColors = true
    const wall = new THREE.Mesh(wallGeo, wallMat)
    wall.position.y = wallHeight / 2
    wall.receiveShadow = true
    this.group.add(wall)

    // Banners of the Street hang between the buttresses and stir in the draught.
    const cloth = canvasTexture(256, (ctx, s) => {
      ctx.fillStyle = '#5a0a12'
      ctx.fillRect(0, 0, s, s)
      const g = ctx.createLinearGradient(0, 0, 0, s)
      g.addColorStop(0, 'rgba(0,0,0,0.45)')
      g.addColorStop(0.3, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(0,0,0,0.5)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
      ctx.strokeStyle = '#c99a3e'
      ctx.lineWidth = 6
      ctx.strokeRect(14, 14, s - 28, s - 28)
      ctx.lineWidth = 14
      ctx.lineJoin = 'miter'
      ctx.beginPath()
      ctx.moveTo(s * 0.26, s * 0.7)
      ctx.lineTo(s * 0.26, s * 0.3)
      ctx.lineTo(s * 0.5, s * 0.56)
      ctx.lineTo(s * 0.74, s * 0.3)
      ctx.lineTo(s * 0.74, s * 0.7)
      ctx.stroke()
    })
    const clothMat = new THREE.MeshStandardMaterial({ map: cloth, roughness: 0.95, side: THREE.DoubleSide })
    this.banners = []
    for (const deg of [54, 126, 234, 270, 306]) {
      const a = (deg / 180) * Math.PI
      const geo = new THREE.PlaneGeometry(1.7, 2.7, 6, 10)
      // The lower edge is cut to a point, like a pennant.
      const pos = geo.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / 0.85
        const v = pos.getY(i) / 1.35
        if (v < -0.5) pos.setY(i, pos.getY(i) + Math.abs(u) * 0.55 * (-(v + 0.5) * 2))
      }
      const banner = new THREE.Mesh(geo, clothMat)
      banner.position.set(Math.cos(a) * (PIT_RADIUS - 0.22), 2.55, Math.sin(a) * (PIT_RADIUS - 0.22))
      banner.rotation.y = -a - Math.PI / 2
      banner.castShadow = false
      this.group.add(banner)
      this.banners.push({ mesh: banner, rest: Float32Array.from(pos.array), phase: deg })
    }
    // The lip of the wall, and a dark band behind it.
    const stoneMat = new THREE.MeshStandardMaterial({ map: wrap(blocks.map, 14, 0.4), normalMap: wrap(blocks.normalMap, 14, 0.4), color: 0x4f443a, roughness: 1 })
    const lip = new THREE.Mesh(new THREE.TorusGeometry(PIT_RADIUS + 0.25, 0.42, 8, 96), stoneMat)
    lip.rotation.x = Math.PI / 2
    lip.position.y = wallHeight
    lip.scale.set(1, 1, 0.6)
    this.group.add(lip)

    // Buttresses with torches, and iron spikes along the lip.
    const iron = new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.55, metalness: 0.8 })
    const pillarGeo = new THREE.BoxGeometry(1.1, wallHeight + 0.8, 0.9)
    const pillarMat = new THREE.MeshStandardMaterial({ map: wrap(blocks.map, 1 / 6, 2), normalMap: wrap(blocks.normalMap, 1 / 6, 2), roughnessMap: wrap(blocks.roughnessMap, 1 / 6, 2), color: 0x77695a, roughness: 1 })
    const spikeGeo = new THREE.ConeGeometry(0.09, 0.75, 6)
    const torchCount = 10
    for (let i = 0; i < torchCount; i++) {
      // Every 36 degrees, skipping the two gates. None lands on the camera's side of the pit.
      if (i === 0 || i === 5) continue
      const a = (i / torchCount) * Math.PI * 2
      const x = Math.cos(a) * (PIT_RADIUS - 0.15)
      const z = Math.sin(a) * (PIT_RADIUS - 0.15)
      const pillar = new THREE.Mesh(pillarGeo, pillarMat)
      pillar.position.set(x, (wallHeight + 0.8) / 2, z)
      pillar.rotation.y = -a + Math.PI / 2
      pillar.castShadow = true
      this.group.add(pillar)
      // Torch: an iron bracket and bowl; the flame is added by the effects layer.
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.1, 0.24, 8), iron)
      const tx = Math.cos(a) * (PIT_RADIUS - 0.95)
      const tz = Math.sin(a) * (PIT_RADIUS - 0.95)
      bowl.position.set(tx, 3.05, tz)
      this.group.add(bowl)
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 5), iron)
      arm.position.set(Math.cos(a) * (PIT_RADIUS - 0.62), 2.95, Math.sin(a) * (PIT_RADIUS - 0.62))
      arm.rotation.z = Math.PI / 2
      arm.rotation.y = -a
      this.group.add(arm)
      this.torches.push({ position: new THREE.Vector3(tx, 3.3, tz), phase: i * 1.7 })
    }
    const spikes = new THREE.InstancedMesh(spikeGeo, iron, 96)
    const m = new THREE.Matrix4()
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2
      m.makeRotationZ(0)
      m.setPosition(Math.cos(a) * (PIT_RADIUS + 0.1), wallHeight + 0.62, Math.sin(a) * (PIT_RADIUS + 0.1))
      spikes.setMatrixAt(i, m)
    }
    this.group.add(spikes)

    // Two gates, where the beasts come in.
    this.gates = []
    const barGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6)
    for (const side of [-1, 1]) {
      const gate = new THREE.Group()
      const dark = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.5), new THREE.MeshBasicMaterial({ color: 0x020101 }))
      dark.position.set(side * (PIT_RADIUS - 0.04), 1.75, 0)
      dark.rotation.y = -side * (Math.PI / 2)
      gate.add(dark)
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.3, 6, 16, Math.PI), stoneMat)
      arch.position.set(side * (PIT_RADIUS - 0.1), 3.3, 0)
      arch.rotation.y = Math.PI / 2
      gate.add(arch)
      for (const k of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.6), pillarMat)
        post.position.set(side * (PIT_RADIUS - 0.2), 1.7, k * 1.95)
        gate.add(post)
      }
      const bars = new THREE.Group()
      for (let b = -4; b <= 4; b++) {
        const bar = new THREE.Mesh(barGeo, iron)
        bar.position.set(side * (PIT_RADIUS - 0.3), 1.7, b * 0.4)
        bars.add(bar)
      }
      for (const y of [0.9, 2.5]) {
        const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.5, 6), iron)
        cross.rotation.x = Math.PI / 2
        cross.position.set(side * (PIT_RADIUS - 0.3), y, 0)
        bars.add(cross)
      }
      gate.add(bars)
      this.group.add(gate)
      this.gates.push({ bars, open: 0, goal: 0 })
    }

    // Chains hanging from the lip, for a little slow movement at the edges.
    const linkGeo = new THREE.TorusGeometry(0.07, 0.02, 5, 8)
    const random = mulberry32(99)
    this.chains = []
    for (let i = 0; i < 14; i++) {
      const a = random() * Math.PI * 2
      const length = 5 + Math.floor(random() * 9)
      const chain = new THREE.Group()
      for (let k = 0; k < length; k++) {
        const link = new THREE.Mesh(linkGeo, iron)
        link.position.y = -k * 0.115
        link.rotation.y = (k % 2) * (Math.PI / 2)
        chain.add(link)
      }
      chain.position.set(Math.cos(a) * (PIT_RADIUS - 0.35), wallHeight - 0.15, Math.sin(a) * (PIT_RADIUS - 0.35))
      this.group.add(chain)
      this.chains.push({ chain, phase: random() * 6, a })
    }
  }

  buildStands() {
    // Three stepped tiers of dark stone above the wall, with a crowd of shapes
    // and a scatter of lantern points. Set dressing: it never claims a head count.
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a3534, roughness: 1 })
    for (let tier = 0; tier < 4; tier++) {
      const inner = PIT_RADIUS + 0.9 + tier * 2.3
      const outer = inner + 2.3
      const step = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 72, 1), stoneMat)
      step.rotation.x = -Math.PI / 2
      step.position.y = 4.6 + tier * 1.25
      this.group.add(step)
      const riser = new THREE.Mesh(new THREE.CylinderGeometry(outer, outer, 1.25, 72, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2729, roughness: 1, side: THREE.BackSide }))
      riser.position.y = 4.6 + tier * 1.25 + 0.625
      this.group.add(riser)
    }
    const random = mulberry32(7)
    const count = 520
    const torso = new THREE.CapsuleGeometry(0.25, 0.42, 3, 8)
    torso.scale(1.25, 1, 0.8)
    const head = new THREE.SphereGeometry(0.17, 8, 6)
    head.translate(0, 0.62, 0)
    const hood = new THREE.ConeGeometry(0.2, 0.3, 7)
    hood.translate(0, 0.84, -0.02)
    const figure = mergeGeometries([torso, head, hood])
    const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
    const cloths = [0x7a3028, 0x35406a, 0x6a5a3a, 0x4a3050, 0x7a5a30, 0x2c4a44, 0x5a5a66, 0x803a3a].map((hex) => new THREE.Color(hex))
    const tone = new THREE.Color()
    crowdMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.crowdTime = { value: 0 }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float phase = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 2.3;
           transformed.y += (sin(uTime * 2.2 + phase) * 0.5 + 0.5) * 0.09 + step(0.93, fract(phase * 0.37 + uTime * 0.11)) * 0.22;`,
        )
    }
    const crowd = new THREE.InstancedMesh(figure, crowdMat, count)
    const lanternPos = []
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      const tier = Math.floor(random() * 4)
      const a = random() * Math.PI * 2
      const r = PIT_RADIUS + 1.5 + tier * 2.3 + random() * 1.2
      p.set(Math.cos(a) * r, 4.6 + tier * 1.25 + 0.55, Math.sin(a) * r)
      const size = 0.85 + random() * 0.4
      s.set(size, size * (0.9 + random() * 0.35), size)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * 6)
      m.compose(p, q, s)
      crowd.setMatrixAt(i, m)
      crowd.setColorAt(i, tone.copy(cloths[Math.floor(random() * cloths.length)]).multiplyScalar(0.2 + random() * 0.28))
      if (random() < 0.2) lanternPos.push(p.x, p.y + 0.75, p.z)
    }
    crowd.instanceColor.needsUpdate = true
    this.group.add(crowd)
    this.buildFlags()
    const lanternGeo = new THREE.BufferGeometry()
    lanternGeo.setAttribute('position', new THREE.Float32BufferAttribute(lanternPos, 3))
    const lanterns = new THREE.Points(
      lanternGeo,
      new THREE.PointsMaterial({
        size: 0.7,
        color: 0xffb050,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: canvasTexture(64, (ctx, sz) => {
          const g = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2)
          g.addColorStop(0, 'rgba(255,255,255,1)')
          g.addColorStop(0.25, 'rgba(255,200,120,0.7)')
          g.addColorStop(1, 'rgba(255,120,30,0)')
          ctx.fillStyle = g
          ctx.fillRect(0, 0, sz, sz)
        }),
      }),
    )
    this.group.add(lanterns)
    this.lanterns = lanterns
  }

  buildFlags() {
    // Tall poles round the top of the stands fly the colours of the five aspects.
    const colours = [0xff5a1f, 0x58c23a, 0xc9a45c, 0x8a7dff, 0x2fb6d6]
    const pole = new THREE.MeshStandardMaterial({ color: 0x2b241e, roughness: 0.8 })
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 5.2, 6)
    this.flags = []
    const count = 20
    for (let i = 0; i < count; i++) {
      const a = ((i + 0.5) / count) * Math.PI * 2
      const r = PIT_RADIUS + 10.6
      const base = new THREE.Group()
      base.position.set(Math.cos(a) * r, 9.6, Math.sin(a) * r)
      base.rotation.y = -a + Math.PI / 2
      const stick = new THREE.Mesh(poleGeo, pole)
      stick.position.y = 2.6
      base.add(stick)
      const geo = new THREE.PlaneGeometry(1.9, 1.1, 8, 3)
      geo.translate(0.95, 0, 0)
      // A swallow-tail: the free end is notched.
      const pos = geo.attributes.position
      for (let k = 0; k < pos.count; k++) {
        const along = pos.getX(k) / 1.9
        if (along > 0.99) pos.setX(k, pos.getX(k) - (1 - Math.abs(pos.getY(k)) / 0.55) * 0.5)
      }
      const colour = new THREE.Color(colours[i % colours.length])
      const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.16, roughness: 0.85, side: THREE.DoubleSide }))
      flag.position.y = 4.55
      base.add(flag)
      this.group.add(base)
      this.flags.push({ mesh: flag, rest: Float32Array.from(pos.array), phase: i * 2.1 })
    }
  }

  buildLights() {
    const scene = this.stage.scene
    this.hemi = new THREE.HemisphereLight(0x5167a8, 0x2a170c, 0.62)
    scene.add(this.hemi)

    // The moon: cool, hard, and the only light that casts shadows.
    const moon = new THREE.DirectionalLight(0xa9bcff, 2.6)
    moon.position.set(-6, 14, -8)
    moon.target.position.set(0, 0.5, 0)
    moon.castShadow = true
    moon.shadow.mapSize.set(this.stage.shadowSize, this.stage.shadowSize)
    const cam = moon.shadow.camera
    cam.left = -11
    cam.right = 11
    cam.top = 9
    cam.bottom = -9
    cam.near = 2
    cam.far = 42
    moon.shadow.bias = -0.0004
    moon.shadow.normalBias = 0.035
    moon.shadow.radius = 3.5
    cam.updateProjectionMatrix()
    scene.add(moon, moon.target)
    this.moon = moon

    // Fire from behind: it rims every silhouette in orange.
    const rim = new THREE.DirectionalLight(0xff6a1f, 2.0)
    rim.position.set(9, 4, -9)
    scene.add(rim)
    this.rim = rim
    // The key: warm, from the camera's upper left, so every body has a lit side
    // and a shaded side and reads as round.
    const key = new THREE.DirectionalLight(0xffe4c4, 1.55)
    key.position.set(-8, 9, 11)
    scene.add(key)
    this.key = key
    // A cool fill low from the other side keeps the shaded side out of black.
    const fill = new THREE.DirectionalLight(0x7f96d8, 0.5)
    fill.position.set(9, 2.5, 9)
    scene.add(fill)
    this.fill = fill

    // A hard lamp straight down on the fighting line.
    const lamp = new THREE.SpotLight(0xffe2b8, 190, 30, 0.5, 0.6, 1.6)
    lamp.position.set(0, 17, 1.5)
    lamp.target.position.set(0, 0, 0)
    scene.add(lamp, lamp.target)
    this.lamp = lamp

    // A few of the torches are real lights. They flicker.
    this.torchLights = []
    for (const i of [5, 6, 1, 2]) {
      const torch = this.torches[i]
      const light = new THREE.PointLight(0xff7a2a, 55, 26, 1.8)
      light.position.copy(torch.position)
      scene.add(light)
      this.torchLights.push({ light, phase: torch.phase, base: 55 })
    }

    // The shaft of the lamp, drawn as a soft cone of light in the dust.
    const shaft = new THREE.Mesh(
      new THREE.ConeGeometry(7.5, 17, 40, 1, true),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        uniforms: { uColour: { value: new THREE.Color(0xffd9a8) }, uPower: { value: 0.055 } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV; varying float vH;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            vH = uv.y;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColour; uniform float uPower;
          varying vec3 vN; varying vec3 vV; varying float vH;
          void main() {
            float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
            float fade = smoothstep(0.0, 0.25, vH) * smoothstep(1.0, 0.55, vH);
            gl_FragColor = vec4(uColour * uPower * edge * fade, 1.0);
          }
        `,
      }),
    )
    shaft.position.y = 8.5
    this.group.add(shaft)
    this.shaft = shaft
  }

  buildEnvironment() {
    // Reflections: a tiny room of warm and cool panels stands in for the pit.
    const room = new THREE.Scene()
    room.background = new THREE.Color(0x06050a)
    const panel = (colour, power, x, y, z, w, h) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(power), side: THREE.DoubleSide }))
      mesh.position.set(x, y, z)
      mesh.lookAt(0, 0, 0)
      room.add(mesh)
    }
    panel(0xaec0ff, 5, -6, 9, 6, 7, 7)
    panel(0xff7a2a, 6, 5, 2, -9, 9, 3)
    panel(0xff9a4a, 3, -9, 2, -4, 6, 3)
    panel(0xffe2b8, 8, 0, 12, 0, 4, 4)
    panel(0x3a2a20, 1, 0, -6, 0, 30, 30)
    const pmrem = new THREE.PMREMGenerator(this.stage.renderer)
    this.stage.scene.environment = pmrem.fromScene(room, 0.03).texture
    this.stage.scene.environmentIntensity = 0.55
    pmrem.dispose()
  }

  /** Fewer real lights and a smaller shadow map on slower machines. */
  setQuality(name) {
    const lit = name === 'high' ? 4 : name === 'medium' ? 2 : 0
    this.torchLights.forEach((item, i) => {
      item.light.visible = i < lit
    })
    // The fill light makes up for the torches that are switched off.
    this.fill.intensity = lit === 4 ? 0.5 : lit === 2 ? 0.62 : 0.8
    const size = this.stage.shadowSize
    if (this.moon.shadow.mapSize.x !== size) {
      this.moon.shadow.mapSize.set(size, size)
      if (this.moon.shadow.map) {
        this.moon.shadow.map.dispose()
        this.moon.shadow.map = null
      }
    }
  }

  /** Raises or lowers a gate (0 = the -X gate, 1 = the +X gate). */
  setGate(index, open) {
    this.gates[index].goal = open ? 1 : 0
  }

  /** The Red Moon finisher turns the sky. `amount` 0..1. */
  setRedMoon(amount) {
    this.mood.redGoal = amount
  }

  update(dt, realDt) {
    this.time += realDt
    const t = this.time
    this.sky.material.uniforms.uTime.value = t
    const red = this.mood.redGoal ?? 0
    this.mood.red += (red - this.mood.red) * Math.min(1, realDt * 2.5)
    this.sky.material.uniforms.uRed.value = this.mood.red
    this.moon.color.copy(this.mood.moon).lerp(new THREE.Color(0xff3a2a), this.mood.red)
    if (this.crowdTime) this.crowdTime.value = t
    for (const { light, phase, base } of this.torchLights) {
      const flicker = 0.82 + Math.sin(t * 11 + phase) * 0.07 + Math.sin(t * 23.7 + phase * 2) * 0.05 + Math.sin(t * 3.1 + phase) * 0.06
      light.intensity = base * flicker
    }
    for (const gate of this.gates) {
      gate.open += (gate.goal - gate.open) * Math.min(1, realDt * 3)
      gate.bars.position.y = gate.open * 3.2
    }
    for (const { chain, phase } of this.chains) {
      chain.rotation.x = Math.sin(t * 0.9 + phase) * 0.05
      chain.rotation.z = Math.cos(t * 0.7 + phase) * 0.05
    }
    for (const { mesh, rest, phase } of this.flags || []) {
      const pos = mesh.geometry.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const along = rest[i * 3] / 1.9 // 0 at the pole, 1 at the tip
        pos.setZ(i, Math.sin(t * 3.1 + phase - along * 5.5) * 0.22 * along)
        pos.setY(i, rest[i * 3 + 1] + Math.sin(t * 2.3 + phase * 1.7 - along * 4.0) * 0.07 * along)
      }
      pos.needsUpdate = true
    }
    for (const { mesh, rest, phase } of this.banners) {
      const pos = mesh.geometry.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const y = rest[i * 3 + 1]
        const hang = (1.35 - y) / 2.7 // 0 at the pole, 1 at the hem
        pos.setZ(i, Math.sin(t * 1.6 + phase + y * 2.4 + rest[i * 3] * 1.5) * 0.09 * hang * hang)
      }
      pos.needsUpdate = true
    }
  }
}
