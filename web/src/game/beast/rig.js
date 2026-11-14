// Skeletons, skin and motion.
//
// A `Body` collects bones and skin parts while a beast is being grown, then
// builds one skinned mesh per material. An `Animator` plays keyframed clips on
// the bones and layers living motion (breathing, blinking, tails, wings) on top.
// Nothing here allocates while a beast is being animated.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const DEG = Math.PI / 180

export class Body {
  constructor() {
    this.bones = []
    this.index = {}
    this.rest = []
    this.turn = []
    this.parts = {}
    this.outer = {}
    this.sockets = {}
  }

  /**
   * Adds a bone at a rest position (in the beast's own space, facing +X). Returns its index.
   * `basis` = [x, y, z] axes gives the bone its own directions to turn about (eyelids
   * swing about the line between the corners of the eye, whichever way the eye faces).
   */
  bone(name, parent, position, basis = null) {
    const bone = new THREE.Bone()
    bone.name = name
    const rest = new THREE.Vector3(position[0], position[1], position[2])
    const i = this.bones.length
    this.bones.push(bone)
    this.rest.push(rest)
    this.index[name] = i
    let turn = null
    if (basis) {
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...basis[0]), new THREE.Vector3(...basis[1]), new THREE.Vector3(...basis[2]))
      turn = new THREE.Quaternion().setFromRotationMatrix(m)
      bone.quaternion.copy(turn)
    }
    this.turn.push(turn)
    if (parent !== null && parent !== undefined) {
      const p = this.index[parent]
      this.bones[p].add(bone)
      bone.position.copy(rest).sub(this.rest[p])
    } else {
      bone.position.copy(rest)
    }
    return i
  }

  b(name) {
    return this.index[name]
  }

  has(name) {
    return this.index[name] !== undefined
  }

  pos(name) {
    return this.rest[this.index[name]].toArray()
  }

  /** Adds a piece of skin under a material key. `outer: true` marks skin that effects can sit on. */
  add(material, geometry, { outer = false } = {}) {
    ;(this.parts[material] ||= []).push(geometry)
    ;(this.outer[material] ||= []).push(outer)
    return this
  }

  /** Names a point on a bone for effects to attach to: `position` is in the beast's rest space. */
  socket(name, boneName, position) {
    const i = this.index[boneName]
    this.sockets[name] = { bone: this.bones[i], offset: new THREE.Vector3(position[0], position[1], position[2]).sub(this.rest[i]) }
  }

  /** How many vertices the finished body will have. */
  get vertices() {
    let total = 0
    for (const list of Object.values(this.parts)) for (const geometry of list) total += geometry.attributes.position.count
    return total
  }

  /** Builds the group: bones, skeleton and one skinned mesh per material. */
  build(materials) {
    const group = new THREE.Group()
    const root = this.bones[0]
    group.add(root)
    group.updateMatrixWorld(true)
    const skeleton = new THREE.Skeleton(this.bones)
    const meshes = {}
    const outer = []
    for (const [key, list] of Object.entries(this.parts)) {
      const material = materials[key]
      if (!material || !list.length) continue
      const indexed = list.every((g) => g.index)
      const prepared = indexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g))
      const geometry = prepared.length === 1 ? prepared[0] : mergeGeometries(prepared, false)
      if (!geometry) continue
      if (key === 'hide') {
        // Which vertices of the merged hide are outer skin.
        let offset = 0
        prepared.forEach((g, i) => {
          const count = g.attributes.position.count
          if (this.outer[key][i]) outer.push([offset, offset + count])
          offset += count
        })
      }
      const mesh = new THREE.SkinnedMesh(geometry, material)
      mesh.name = key
      mesh.castShadow = key !== 'eye'
      mesh.receiveShadow = key !== 'eye'
      mesh.frustumCulled = false
      group.add(mesh)
      mesh.bind(skeleton)
      meshes[key] = mesh
    }
    return { group, skeleton, meshes, bones: this.index, boneList: this.bones, turns: this.turn, sockets: this.sockets, outer }
  }
}

// ----- Clips -------------------------------------------------------------------

/**
 * A clip: { dur, loop?, hold?, keys: [{ t, r: { bone: [x, y, z] degrees }, p?: { bone: [x, y, z] metres }, ease? }], events?: [[t, name]] }
 * `t` runs 0..1 across the clip. Bones a key leaves out rest at zero.
 * Names that are not bones are channels the body plan reads for itself: leg
 * targets (`ikFL`…), `ikOff` and `face` ([eyes shut 0..1, scowl 0..1, ears back 0..1]).
 */
const EASE = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  snap: (t) => 1 - Math.pow(1 - t, 4),
  back: (t) => {
    const c = 1.9
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
  },
}

/** A pose: turns (degrees) and shifts (metres) for every bone and channel, by slot. */
class Pose {
  constructor(index, size) {
    this.index = index
    this.r = new Float32Array(size * 3)
    this.p = new Float32Array(size * 3)
  }

  clear() {
    this.r.fill(0)
    this.p.fill(0)
  }

  copy(other) {
    this.r.set(other.r)
    this.p.set(other.p)
  }
}

export class Animator {
  /**
   * @param rig  what Body.build returned
   * @param clips  { name: clip }
   * @param alive  (pose, time, state) => void — adds living motion in degrees/metres with addRot / addPos
   * @param channels  names of extra channels the alive layer or the beast reads
   */
  constructor(rig, clips, alive, channels = []) {
    this.rig = rig
    this.clips = clips
    this.alive = alive
    this.time = 0
    this.current = null
    this.state = { energy: 1, calm: 1 }
    // Slots: every bone, then every channel a clip or the body plan names.
    const index = {}
    rig.boneList.forEach((bone, i) => (index[bone.name] = i))
    let size = rig.boneList.length
    const claim = (name) => {
      if (index[name] === undefined) index[name] = size++
    }
    for (const name of ['ikOff', 'face', ...channels]) claim(name)
    for (const clip of Object.values(clips)) {
      for (const key of clip.keys) {
        // A clip may name a bone this body lacks (a frill, a wing): give it a slot nobody reads.
        for (const name in key.r || {}) claim(name)
        for (const name in key.p || {}) claim(name)
      }
    }
    this.index = index
    this.size = size
    this.from = new Pose(index, size)
    this.pose = new Pose(index, size)
    this.final = new Pose(index, size)
    this.fade = 0
    this.fadeLeft = 0
    this.compiled = {}
    for (const [name, clip] of Object.entries(clips)) {
      this.compiled[name] = clip.keys.map((key) => {
        const r = new Float32Array(size * 3)
        const p = new Float32Array(size * 3)
        for (const bone in key.r || {}) r.set(key.r[bone], index[bone] * 3)
        for (const bone in key.p || {}) p.set(key.p[bone], index[bone] * 3)
        return { t: key.t, ease: EASE[key.ease] || EASE.smooth, r, p }
      })
    }
    this.restPositions = rig.boneList.map((bone) => bone.position.clone())
    this.euler = new THREE.Euler()
    this.quat = new THREE.Quaternion()
  }

  /** The slot of a bone or channel, for reading `final.p` / `final.r` (three numbers from slot * 3). */
  slot(name) {
    return this.index[name]
  }

  /** Starts a clip. Resolves when it ends (or at once for a looping clip). `on(name)` hears the clip's events. */
  play(name, { fade = 0.12, speed = 1, on = null, hold = false } = {}) {
    const clip = this.clips[name]
    if (!clip) return Promise.resolve()
    if (this.current?.resolve) this.current.resolve()
    this.from.copy(this.pose)
    this.fade = this.fadeLeft = fade
    return new Promise((resolve) => {
      this.current = { name, clip, keys: this.compiled[name], t: 0, speed, on, fired: 0, hold: hold || clip.hold, resolve: clip.loop ? null : resolve }
      if (clip.loop) resolve()
    })
  }

  get playing() {
    return this.current?.name
  }

  /** Lets go of a held pose (a guard, a charge) and eases back to the idle stance. */
  release(fade = 0.28) {
    if (!this.current) return
    if (this.current.resolve) this.current.resolve()
    this.from.copy(this.pose)
    this.fade = this.fadeLeft = fade
    this.current = null
  }

  update(dt) {
    this.time += dt
    const target = this.final
    target.clear()
    const cur = this.current
    if (cur) {
      cur.t += (dt * cur.speed) / cur.clip.dur
      const events = cur.clip.events
      if (events) {
        while (cur.fired < events.length && cur.t >= events[cur.fired][0]) {
          const event = events[cur.fired][1]
          cur.fired++
          if (cur.on) cur.on(event)
        }
      }
      if (cur.t >= 1) {
        if (cur.clip.loop) {
          cur.t %= 1
          cur.fired = 0
        } else {
          cur.t = 1
          if (cur.resolve) {
            const done = cur.resolve
            cur.resolve = null
            done()
          }
          if (!cur.hold && this.current === cur) {
            // Drift back to the idle stance.
            this.from.copy(this.pose)
            this.fade = this.fadeLeft = 0.28
            this.current = null
          }
        }
      }
      if (this.current === cur) this.sample(cur.keys, cur.t, target)
    }
    // Cross-fade from wherever the last clip left the body.
    if (this.fadeLeft > 0) {
      this.fadeLeft = Math.max(0, this.fadeLeft - dt)
      const w = this.fade > 0 ? this.fadeLeft / this.fade : 0
      const k = w * w * (3 - 2 * w)
      const { r, p } = target
      const fr = this.from.r
      const fp = this.from.p
      for (let i = 0; i < r.length; i++) {
        r[i] += (fr[i] - r[i]) * k
        p[i] += (fp[i] - p[i]) * k
      }
    }
    this.pose.copy(target)
    if (this.alive) this.alive(target, this.time, this.state)
    // The finished pose, living motion included. Leg targets (ik…) are read from here.
    const { boneList, turns } = this.rig
    const { r, p } = target
    for (let i = 0; i < boneList.length; i++) {
      const bone = boneList[i]
      const o = i * 3
      if (turns[i]) {
        this.euler.set(r[o] * DEG, r[o + 1] * DEG, r[o + 2] * DEG)
        bone.quaternion.copy(turns[i]).multiply(this.quat.setFromEuler(this.euler))
      } else {
        bone.rotation.set(r[o] * DEG, r[o + 1] * DEG, r[o + 2] * DEG)
      }
      const rest = this.restPositions[i]
      bone.position.set(rest.x + p[o], rest.y + p[o + 1], rest.z + p[o + 2])
    }
  }

  sample(keys, t, out) {
    let a = keys[0]
    let b = keys[keys.length - 1]
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) {
        a = keys[i]
        b = keys[i + 1]
        break
      }
    }
    const spanT = b.t - a.t
    const raw = spanT > 0 ? (t - a.t) / spanT : 0
    const f = b.ease(Math.min(1, Math.max(0, raw)))
    const { r, p } = out
    for (let i = 0; i < r.length; i++) {
      r[i] = a.r[i] + (b.r[i] - a.r[i]) * f
      p[i] = a.p[i] + (b.p[i] - a.p[i]) * f
    }
  }
}

/** Adds degrees to a bone's rotation in a pose. Bones the body lacks are ignored. */
export function addRot(pose, name, x, y, z) {
  const i = pose.index[name]
  if (i === undefined) return
  const o = i * 3
  pose.r[o] += x
  pose.r[o + 1] += y
  pose.r[o + 2] += z
}

export function addPos(pose, name, x, y, z) {
  const i = pose.index[name]
  if (i === undefined) return
  const o = i * 3
  pose.p[o] += x
  pose.p[o + 1] += y
  pose.p[o + 2] += z
}

/** One number of a channel (0, 1 or 2) as the pose has it now. */
export function channel(pose, name, k = 0) {
  const i = pose.index[name]
  return i === undefined ? 0 : pose.p[i * 3 + k]
}

/** { boneL: v, boneR: mirrored v } for a pair of limbs. Mirroring flips the X and Y turns. */
export function pair(name, [x, y, z]) {
  return { [`${name}L`]: [x, y, z], [`${name}R`]: [-x, -y, z] }
}
