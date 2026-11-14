// The stage: one renderer, one scene, one camera, and the film-style finishing
// pass (bloom, lens colour split, radial blur, grain, vignette, colour grade).
// It also owns time: slow motion is a single number every system multiplies by.

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js'

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uChroma: { value: 0 },
    uBlur: { value: 0 },
    uCentre: { value: new THREE.Vector2(0.5, 0.5) },
    uVignette: { value: 0.72 },
    uGrain: { value: 0.014 },
    uDesat: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTintAmount: { value: 0 },
    uFlash: { value: 0 },
    uFlashColour: { value: new THREE.Color(1, 1, 1) },
    uBars: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uChroma, uBlur, uVignette, uGrain, uDesat, uTintAmount, uFlash, uBars;
    uniform vec2 uCentre;
    uniform vec3 uTint, uFlashColour;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - uCentre;
      vec3 col;
      if (uBlur > 0.001) {
        vec3 sum = vec3(0.0);
        for (int i = 0; i < 10; i++) {
          float s = 1.0 - uBlur * 0.14 * float(i) / 10.0;
          sum += texture2D(tDiffuse, uCentre + d * s).rgb;
        }
        col = sum / 10.0;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      if (uChroma > 0.0001) {
        float edge = dot(d, d) * 4.0;
        col.r = mix(col.r, texture2D(tDiffuse, vUv + d * uChroma * edge).r, 0.9);
        col.b = mix(col.b, texture2D(tDiffuse, vUv - d * uChroma * edge).b, 0.9);
      }
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(luma), uDesat);
      col = mix(col, col * uTint, uTintAmount);
      col += uFlashColour * uFlash;
      float falloff = smoothstep(1.05, 0.28, length(d * vec2(1.0, 0.85)) * 1.25);
      col *= mix(1.0, falloff, uVignette);
      col += (hash(vUv * (1.0 + fract(uTime) * 61.0)) - 0.5) * uGrain * (0.4 + luma);
      // Cinema bars slide in for the big moments.
      float bar = step(vUv.y, uBars * 0.115) + step(1.0 - uBars * 0.115, vUv.y);
      col *= 1.0 - clamp(bar, 0.0, 1.0);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
}

// What each quality level costs. `ratio` caps the pixel ratio.
// Measured on integrated Radeon graphics at 1080p: multisampling a float
// target halves the frame rate, so the middle level smooths edges with a
// cheap screen pass instead and keeps the bloom.
const QUALITY = {
  low: { ratio: 0.8, shadow: 1024, samples: 0, fxaa: false, bloom: false, ao: false },
  medium: { ratio: 1, shadow: 2048, samples: 0, fxaa: true, bloom: true, ao: false },
  high: { ratio: 1.5, shadow: 4096, samples: 4, fxaa: false, bloom: true, ao: true },
}
const ORDER = ['low', 'medium', 'high']

export class Stage {
  /**
   * @param canvas
   * @param {{ quality?: 'low'|'medium'|'high', film?: boolean, governed?: boolean }} options
   *   `film` locks everything at full quality for frame-by-frame capture.
   *   `governed` lets the stage step the quality down by itself if frames come too slowly.
   */
  constructor(canvas, { quality = 'medium', film = false, governed = false } = {}) {
    this.canvas = canvas
    this.film = film
    this.governed = governed && !film
    this.quality = QUALITY[quality] ? quality : 'medium'
    this.onQuality = null
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400)
    this.rig = new CameraRig(this.camera)
    this.finish = new ShaderPass(FinishShader)
    this.fx = this.finish.uniforms

    // Time. `scale` slows the game world; `real` never slows.
    this.scale = 1
    this.scaleGoal = 1
    this.time = 0
    this.real = 0
    this.systems = []
    this.kicks = { chroma: 0, blur: 0, flash: 0 }
    this.grade = { desat: 0, tintAmount: 0, bars: 0 }
    this.gradeGoal = { desat: 0, tintAmount: 0, bars: 0 }
    this.running = false
    this.frames = 0
    this.load = { time: 0, frames: 0, warm: 0 }

    this.resize = this.resize.bind(this)
    window.addEventListener('resize', this.resize)
    this.build()
  }

  get shadowSize() {
    return QUALITY[this.quality].shadow
  }

  /** Sets up the render passes for the current quality. */
  build() {
    const q = { ...QUALITY[this.quality] }
    // For tuning: ?msaa=0&bloom=0&ratio=0.8&ao=1&half=1 override single settings.
    const tune = new URLSearchParams(window.location.search)
    if (tune.has('msaa')) q.samples = Number(tune.get('msaa'))
    if (tune.has('bloom')) q.bloom = tune.get('bloom') !== '0'
    if (tune.has('ratio')) q.ratio = Number(tune.get('ratio'))
    if (tune.has('ao')) q.ao = tune.get('ao') !== '0'
    if (tune.has('half')) q.halfFloat = tune.get('half') !== '0'
    // Filming draws at exactly the page's size, or larger with ?ss=2 so the
    // browser scales it down into a cleaner picture than any edge filter gives.
    const oversample = Math.min(2, Math.max(1, Number(tune.get('ss')) || 1))
    this.renderer.setPixelRatio(this.film ? oversample : Math.min(window.devicePixelRatio || 1, q.ratio))
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    const size = new THREE.Vector2()
    this.renderer.getDrawingBufferSize(size)
    if (this.composer) {
      this.composer.renderTarget1.dispose()
      this.composer.renderTarget2.dispose()
      this.bloom?.dispose?.()
      this.ao?.dispose?.()
    }
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: q.halfFloat === false ? THREE.UnsignedByteType : THREE.HalfFloatType, samples: q.samples })
    this.composer = new EffectComposer(this.renderer, target)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.ao = null
    if (q.ao) {
      // Soft contact shadows where bodies meet the ground and each other.
      this.ao = new GTAOPass(this.scene, this.camera, size.x, size.y)
      this.ao.blendIntensity = 0.95
      this.ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.1, scale: 1.25, samples: 10, screenSpaceRadius: false })
      // Only solid things shade their surroundings. Sparks, smoke, light shafts
      // and the sky are see-through, and would otherwise be drawn into the
      // shading buffers as solid cards with dark halos around them.
      const pass = this.ao
      pass._overrideVisibility = () => {
        this.scene.traverse((object) => {
          if (!object.visible) return
          const material = object.material
          const ghost = material && !Array.isArray(material) && (material.transparent || material.depthWrite === false)
          if (object.isPoints || object.isLine || object.isLine2 || ghost) {
            object.visible = false
            pass._visibilityCache.push(object)
          }
        })
      }
      this.composer.addPass(this.ao)
    }
    this.bloom = null
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.68, 0.9)
      this.composer.addPass(this.bloom)
    }
    this.composer.addPass(this.finish)
    this.composer.addPass(new OutputPass())
    if (q.fxaa) this.composer.addPass(new FXAAPass())
    this.resize()
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.quality) return
    this.quality = name
    this.build()
    if (this.onQuality) this.onQuality(name)
  }

  /** Registers something with an `update(dt, realDt)` method (or a plain function). */
  add(system) {
    this.systems.push(system)
    return system
  }

  remove(system) {
    const i = this.systems.indexOf(system)
    if (i >= 0) this.systems.splice(i, 1)
  }

  /** Slow motion: 1 is normal speed. `ease` is how quickly it gets there, in real seconds. */
  setTimeScale(scale, ease = 0.12) {
    this.scaleGoal = scale
    this.scaleEase = Math.max(0.001, ease)
  }

  /** Freezes the action for a few hundredths of a second: the weight of a hit. */
  hitStop(seconds = 0.07) {
    this.stopLeft = Math.max(this.stopLeft || 0, seconds)
  }

  /** One-frame-ish lens kicks that decay on their own. */
  kick({ chroma = 0, blur = 0, flash = 0, flashColour = null, centre = null } = {}) {
    this.kicks.chroma = Math.max(this.kicks.chroma, chroma)
    this.kicks.blur = Math.max(this.kicks.blur, blur)
    this.kicks.flash = Math.max(this.kicks.flash, flash)
    if (flashColour) this.fx.uFlashColour.value.set(flashColour)
    if (centre) this.fx.uCentre.value.copy(centre)
    else if (blur > 0) this.fx.uCentre.value.set(0.5, 0.5)
  }

  /** The lasting look: desaturation, a colour wash, cinema bars. Eases in. */
  setGrade({ desat, tint, tintAmount, bars } = {}) {
    if (desat !== undefined) this.gradeGoal.desat = desat
    if (tint !== undefined) this.fx.uTint.value.set(tint)
    if (tintAmount !== undefined) this.gradeGoal.tintAmount = tintAmount
    if (bars !== undefined) this.gradeGoal.bars = bars
  }

  /** Where a world point lands on screen, as 0..1 from the bottom-left. */
  project(world, target = new THREE.Vector2()) {
    const p = world.clone().project(this.camera)
    return target.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5)
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.camera.userData.viewW = w
    this.camera.userData.viewH = h
    this.width = w
    this.height = h
  }

  start() {
    if (this.running) return
    this.running = true
    let last = performance.now()
    const tick = (now) => {
      if (!this.running) return
      requestAnimationFrame(tick)
      const raw = (now - last) / 1000
      last = now
      // A film recorder that has taken over advances the stage itself.
      if (this.manual) return
      this.govern(raw)
      this.frame(Math.min(0.05, Math.max(0, raw)))
    }
    requestAnimationFrame(tick)
  }

  stop() {
    this.running = false
  }

  /**
   * For filming one frame at a time: after `takeOver()` the stage ignores the
   * browser's own frames, and each `step()` advances and draws exactly once.
   */
  takeOver(on = true) {
    this.manual = on
  }

  step(seconds = 1 / 30, draw = true) {
    this.frame(seconds, draw)
  }

  /** Steps the quality down if the last couple of seconds ran below about 30 frames a second. */
  govern(raw) {
    if (!this.governed || document.hidden || raw > 0.5) return
    const load = this.load
    load.warm += raw
    if (load.warm < 4) return
    load.time += raw
    load.frames++
    if (load.frames < 90) return
    const average = load.time / load.frames
    load.time = 0
    load.frames = 0
    if (average > 0.034) {
      const i = ORDER.indexOf(this.quality)
      if (i > 0) {
        load.warm = 0
        this.setQuality(ORDER[i - 1])
      }
    }
  }

  frame(realDt, draw = true) {
    this.real += realDt
    // Ease the time scale towards its goal in real time.
    const k = Math.min(1, realDt / (this.scaleEase || 0.12))
    this.scale += (this.scaleGoal - this.scale) * k
    let dt = realDt * this.scale
    if (this.stopLeft > 0) {
      this.stopLeft -= realDt
      dt *= 0.04
    }
    this.time += dt
    for (const system of this.systems.slice()) {
      if (typeof system === 'function') system(dt, realDt)
      else system.update(dt, realDt)
    }
    this.rig.update(realDt, dt)

    const fx = this.fx
    fx.uTime.value = this.real
    this.kicks.chroma *= Math.exp(-realDt * 9)
    this.kicks.blur *= Math.exp(-realDt * 6)
    this.kicks.flash *= Math.exp(-realDt * 11)
    fx.uChroma.value = 0.0009 + this.kicks.chroma
    fx.uBlur.value = this.kicks.blur
    fx.uFlash.value = this.kicks.flash
    const g = Math.min(1, realDt * 5)
    for (const key of ['desat', 'tintAmount', 'bars']) this.grade[key] += (this.gradeGoal[key] - this.grade[key]) * g
    fx.uDesat.value = this.grade.desat
    fx.uTintAmount.value = this.grade.tintAmount
    fx.uBars.value = this.grade.bars

    if (draw) this.composer.render(realDt)
    this.frames++
  }
}

/**
 * The camera: it eases towards a goal (position, look-at, field of view) and
 * can be cut there instantly. Shake rides on top and fades by itself.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera
    this.pos = new THREE.Vector3(0, 3, 14)
    this.look = new THREE.Vector3(0, 1.4, 0)
    this.fov = 38
    this.goal = { pos: this.pos.clone(), look: this.look.clone(), fov: 38 }
    this.speed = 3
    this.trauma = 0
    this.drift = 1
    this.t = 0
    this.offset = new THREE.Vector2(0, 0)
    this.offsetGoal = new THREE.Vector2(0, 0)
  }

  /** Jump straight to a shot. */
  cut({ pos, look, fov }) {
    if (pos) this.pos.copy(pos), this.goal.pos.copy(pos)
    if (look) this.look.copy(look), this.goal.look.copy(look)
    if (fov) (this.fov = fov), (this.goal.fov = fov)
  }

  /** Glide to a shot. Higher `speed` arrives sooner. */
  move({ pos, look, fov }, speed = 3) {
    if (pos) this.goal.pos.copy(pos)
    if (look) this.goal.look.copy(look)
    if (fov) this.goal.fov = fov
    this.speed = speed
  }

  shake(amount) {
    this.trauma = Math.min(1.4, this.trauma + amount)
  }

  /** Shifts the picture so the subject sits off-centre (x, y in -1..1 of the half screen). */
  setOffset(x, y) {
    this.offsetGoal.set(x, y)
  }

  update(realDt) {
    this.t += realDt
    const k = 1 - Math.exp(-realDt * this.speed)
    this.pos.lerp(this.goal.pos, k)
    this.look.lerp(this.goal.look, k)
    this.fov += (this.goal.fov - this.fov) * k
    this.offset.lerp(this.offsetGoal, 1 - Math.exp(-realDt * 4))
    this.trauma = Math.max(0, this.trauma - realDt * 1.9)
    const s = this.trauma * this.trauma
    const t = this.t
    const camera = this.camera
    camera.position.copy(this.pos)
    // A slow handheld drift keeps a still shot alive.
    camera.position.x += Math.sin(t * 0.37) * 0.05 * this.drift + (Math.sin(t * 47.1) + Math.sin(t * 31.7)) * 0.11 * s
    camera.position.y += Math.sin(t * 0.29 + 1) * 0.04 * this.drift + (Math.sin(t * 53.3) + Math.sin(t * 27.9)) * 0.11 * s
    camera.position.z += (Math.sin(t * 41.9) + Math.sin(t * 35.3)) * 0.06 * s
    camera.lookAt(this.look)
    camera.rotation.z += Math.sin(t * 39.7) * 0.02 * s
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov
      camera.updateProjectionMatrix()
    }
    const w = camera.userData.viewW
    const h = camera.userData.viewH
    if (w && h) {
      if (Math.abs(this.offset.x) > 0.001 || Math.abs(this.offset.y) > 0.001) {
        camera.setViewOffset(w, h, -this.offset.x * w * 0.5, this.offset.y * h * 0.5, w, h)
      } else if (camera.view) {
        camera.clearViewOffset()
      }
    }
  }
}
