// One living beast on the stage: its body, its motion, its face, how tired it is.

import * as THREE from 'three'
import { Animator, addPos, addRot } from './rig.js'
import { makeMaterial, makeUniforms } from './skin.js'
import { eyeRecipe, prepareLeg, solveLegs } from './parts.js'
import { VISUALS, BUILDERS, ASPECT_COLOURS } from './species.js'
import { FORM_LEVELS, formOf, formSheet } from './forms.js'
import { mulberry32 } from '../noise.js'

export { FORM_LEVELS, formOf }


/** What each kind of skin is made of, before a line's sheet adjusts it. */
const BASE_MATERIALS = {
  hide: { kind: 'skin', grain: 'fur', grainScale: 0.32, rough: 0.74 },
  hard: { kind: 'hard', grain: 'smooth', grainScale: 0.12, rough: 0.36, rim: 0.45 },
  fin: { kind: 'fin', grain: 'smooth', grainScale: 0.15, rough: 0.5, rim: 0.7, glowPower: 2.2 },
  crystal: { kind: 'crystal', rough: 0.14, metal: 0.05, rim: 0.55, glowPower: 2.3 },
  // Flame is mostly its own light: the lamps barely touch it.
  flame: { kind: 'skin', colour: '#6e6e6e', rough: 0.8, rim: 0.15, glowPower: 1.9 },
}

export class Beast {
  /**
   * @param {number} species  species id (0..9)
   * @param {{ level?: number, form?: number, aura?: number, finisher?: number, token?: number }} [wear]
   *   `level` picks the form (see FORM_LEVELS); `form` (0..4) overrides it.
   */
  constructor(species, wear = {}) {
    const started = performance.now()
    const line = VISUALS[species] || VISUALS[0]
    this.species = species
    // Species 0-4 and 5-9 run through the five aspects in the same order.
    this.aspect = species % 5
    this.facing = 1
    this.tense = false
    this.wear = wear
    // The form a level wears: 0 cub, 1 prowler, 2 alpha, 3 dread, 4 mythic.
    this.level = Math.max(1, wear.level ?? 1)
    this.form = Math.min(4, Math.max(0, wear.form ?? formOf(this.level)))
    const spec = formSheet(line, this.form)
    this.spec = spec
    this.uniforms = makeUniforms()
    // The rim light: the aspect's colour, softened towards white so it reads as light, not as an outline.
    this.uniforms.uRim.value.set(spec.rim ?? ASPECT_COLOURS[this.aspect]).lerp(new THREE.Color(1, 0.95, 0.88), 0.3).multiplyScalar(spec.rimPower ?? 0.28)
    const built = BUILDERS[spec.rig](spec)
    this.meta = built.meta
    const materials = {}
    for (const key of Object.keys(built.body.parts)) {
      const recipe = key === 'eye' ? eyeRecipe(spec) : { ...BASE_MATERIALS[key], ...(spec.materials?.[key] || {}) }
      materials[key] = makeMaterial(recipe, this.uniforms)
    }
    this.materials = materials
    this.vertexCount = built.body.vertices
    const rig = built.body.build(materials)
    this.rig = rig
    this.anim = new Animator(rig, built.clips, built.alive, built.legs.map((leg) => leg.key))
    this.legs = built.legs.map((leg) => {
      const out = prepareLeg({ ...leg }, rig)
      out.slot = this.anim.slot(leg.key)
      return out
    })
    this.offSlot = this.anim.slot('ikOff')
    // Tiredness (0..1), set by the fight as health runs low: the head hangs, the mouth hangs
    // open, the eyes droop and the chest heaves. Layered over whatever the body plan does.
    this.tired = 0
    const alive = this.anim.alive
    this.anim.alive = (pose, t, st) => {
      const k = st.dead ? 0 : st.tired || 0
      const face = pose.index.face
      // Heavy eyelids: the face layer reads this channel and half closes the eyes.
      if (k > 0.01 && face !== undefined) pose.p[face * 3] = Math.max(pose.p[face * 3], 0.45 * k)
      if (alive) alive(pose, t, st)
      if (k > 0.01) tiredPose(pose, t, k)
    }

    // `group` is what the stage moves and turns; the rig sits inside it.
    this.group = new THREE.Group()
    this.group.add(rig.group)
    const scale = spec.scale
    rig.group.scale.setScalar(scale)
    this.scale = scale
    this.height = built.meta.height * scale
    this.reach = built.meta.reach * scale
    this.chest = built.meta.chest * scale

    this.flash = 0
    this.rage = 0
    this.glowBoost = 0
    this.status = {}
    this.tint = { colour: new THREE.Color(0, 0, 0), amount: 0, target: 0 }
    this.random = mulberry32((wear.token ?? species) * 7919 + 13)
    this.time = this.random() * 10
    // Each beast blinks and breathes on its own clock.
    this.anim.time = this.random() * 20
    this.dead = false

    // Outer skin, where flames, sparks and drops sit: the trunk, the neck, the head and the tops of the legs.
    const hide = rig.meshes.hide
    this.hide = hide
    const rest = hide.geometry.attributes.position
    this.outer = []
    const floor = built.meta.chest * 0.55
    for (const [a, b] of rig.outer) {
      for (let i = a; i < b; i += 3) if (rest.getY(i) > floor) this.outer.push(i)
    }
    if (!this.outer.length) for (let i = 0; i < rest.count; i += 3) this.outer.push(i)
    this.buildMs = performance.now() - started
  }

  /** +1 faces +X, -1 faces -X. */
  face(direction) {
    this.facing = direction
    this.group.rotation.y = direction > 0 ? 0 : Math.PI
  }

  play(name, options) {
    return this.anim.play(name, options)
  }

  /** The world position of a named point on the body (mouth, head, chest, back, belly, pawL, pawR, tail). */
  point(name, target = new THREE.Vector3()) {
    const socket = this.rig.sockets[name] || this.rig.sockets.chest
    return socket.bone.localToWorld(target.copy(socket.offset))
  }

  /** The world position of a skin vertex as it is posed right now. */
  vertex(index, target) {
    this.hide.getVertexPosition(index, target)
    return target.applyMatrix4(this.hide.matrixWorld)
  }

  hitFlash(strength = 1) {
    this.flash = Math.max(this.flash, strength)
  }

  /** A wash of colour over the body while an effect lasts (burn, soak, shock). Amount 0 clears it. */
  setTint(colour, amount) {
    if (colour) this.tint.colour.set(colour)
    this.tint.target = amount
  }

  update(dt) {
    this.time += dt
    const st = this.anim.state
    const rage = Math.min(1, this.rage / 100)
    st.tremble = this.rage >= 100 && !this.dead ? 1 : 0
    st.calm = this.dead ? 1 : this.tense ? 0.2 : 1 - rage * 0.6
    st.rage = this.dead ? 0 : rage
    st.dead = this.dead
    st.tired = this.tired
    this.anim.update(dt)

    // Feet: bend each leg to its target on the ground.
    const off = Math.min(1, Math.max(0, this.anim.final.p[this.offSlot * 3]))
    solveLegs(this.rig.group, this.legs, this.anim.final, off)

    this.flash = Math.max(0, this.flash - dt * 7)
    this.uniforms.uFlash.value = this.flash * this.flash * 1.6
    this.glowBoost = Math.max(0, this.glowBoost - dt * 0.8)
    const pulse = this.dead ? 0.2 : 0.86 + Math.sin(this.time * 2.3) * 0.1 + rage * 0.22 + (rage >= 1 ? 0.1 + Math.sin(this.time * 9) * 0.1 : 0) + this.glowBoost * 0.55
    this.uniforms.uPulse.value += (pulse - this.uniforms.uPulse.value) * Math.min(1, dt * 6)
    this.tint.amount += (this.tint.target - this.tint.amount) * Math.min(1, dt * 4)
    this.uniforms.uTint.value.copy(this.tint.colour)
    this.uniforms.uTintAmount.value = this.tint.amount
  }

  dispose() {
    this.group.traverse((node) => {
      if (node.geometry) node.geometry.dispose()
    })
    for (const material of Object.values(this.materials)) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
        const texture = material[key]
        if (texture && !texture.userData.shared) texture.dispose()
      }
      material.dispose()
    }
  }
}

/** A worn-out body, in degrees and metres over the living pose. `k` is how tired, 0..1. */
function tiredPose(pose, t, k) {
  const pant = Math.sin(t * 7.5)
  const sway = Math.sin(t * 1.4)
  // The head hangs, and bobs with each breath.
  addRot(pose, 'neck', 0, 0, -15 * k + pant * 1.8 * k)
  addRot(pose, 'neck1', 0, 0, -10 * k)
  addRot(pose, 'neck2', 0, 0, -10 * k + pant * 1.5 * k)
  addRot(pose, 'head', sway * 4 * k, 0, -17 * k + pant * 2.5 * k)
  // Mouth open, panting.
  addRot(pose, 'jaw', 0, 0, -(10 + 8 * (0.5 + 0.5 * pant)) * k)
  // The chest heaves; the body sags and sways.
  addRot(pose, 'chest', 0, 0, pant * 3.2 * k)
  addRot(pose, 'spine', 0, 0, -pant * 1.2 * k)
  addPos(pose, 'hips', sway * 0.016 * k, -0.06 * k + pant * 0.012 * k, 0)
  // A serpent's coil sinks.
  addRot(pose, 'f3', 0, 0, -10 * k)
}
