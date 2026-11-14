// A beast takes its next form.
//
// The old body gathers light until it is white, the pit flashes, and the new
// body stands where it stood, shakes itself out to full size and roars. Used
// after a fight that carried a beast past a form level, and in the stable when
// a level is bought.

import * as THREE from 'three'
import { Beast } from './beast/beast.js'
import { ASPECT_FX } from './effects.js'
import { SPRITE } from './fx.js'

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

/** Runs `fn(k)` with k from 0 to 1 over `seconds` of real time. */
function over(stage, seconds, fn) {
  return new Promise((resolve) => {
    let t = 0
    const tick = (dt, realDt) => {
      t += realDt
      const k = Math.min(1, t / seconds)
      fn(k)
      if (k >= 1) {
        stage.remove(tick)
        resolve()
      }
    }
    stage.add(tick)
  })
}

/** A big line of text across the screen, above whatever else is showing. */
export function announce(main, sub = '', { colour = '#ffe9a8', glow = 'rgba(255,190,80,.85)', seconds = 2.6 } = {}) {
  const box = document.createElement('div')
  box.className = 'maul-hud on'
  box.style.cssText = 'position:fixed;inset:0;z-index:30;pointer-events:none;'
  box.innerHTML = `<div class="hud-banner on" style="--c:${colour};--glow:${glow};--t:${seconds}s"><div class="banner-main"></div><div class="banner-sub"></div></div>`
  box.querySelector('.banner-main').textContent = main
  box.querySelector('.banner-sub').textContent = sub
  document.body.append(box)
  setTimeout(() => box.remove(), seconds * 1000 + 100)
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

/**
 * Plays the change on a beast that is already standing in the scene.
 * `game` is the object from game.js; `beast` the old form; `level` the new level.
 * `update` is called with the beast in the scene each frame (pass null if something
 * else already updates it). Resolves with the new Beast, in the same place.
 */
export async function evolve(game, beast, level, { names = null, camera = true } = {}) {
  const { stage, effects, fx, audio, core } = game
  const look = ASPECT_FX[beast.aspect] ?? ASPECT_FX[0]
  const from = names?.[0] ?? core.formName(beast.species, beast.level)
  const to = names?.[1] ?? core.formName(beast.species, level)
  const place = beast.group.position.clone()
  const facing = beast.facing
  const turn = beast.group.rotation.y
  const centre = beast.point('chest')
  const rig = stage.rig

  if (camera) {
    rig.move({ pos: V(place.x + 1.2, 1.2 + beast.height * 0.5, place.z + 4.2 + beast.height * 1.3), look: V(place.x, beast.height * 0.5, place.z), fov: 34 }, 2.2)
  }
  stage.setGrade({ bars: 1 })
  audio?.sfx?.('special_charge')
  const gather = effects.charge(beast)
  beast.play('charge')
  // The body whitens as the light pours in.
  await over(stage, 1.5, (k) => {
    beast.hitFlash(k * 1.25)
    beast.glowBoost = Math.max(beast.glowBoost, k * 1.5)
    beast.group.scale.setScalar(1 + Math.sin(k * 26) * 0.02 * k + k * 0.06)
  })
  gather.stop()

  // The flash, and the swap behind it.
  stage.kick({ flash: 0.55, flashColour: look.core, blur: 0.9, chroma: 0.04 })
  stage.rig.shake(0.6)
  effects.flashLight(centre, look.mid, 500, 0.6)
  fx.ring(V(place.x, 0, place.z), { colour: look.mid, to: 8, life: 0.8, width: 0.5, power: 3 })
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2
    const up = Math.random() * 1.4
    const speed = 3 + Math.random() * 9
    fx.spawn({ p: centre, v: [Math.cos(a) * speed, up * speed * 0.6, Math.sin(a) * speed], life: 0.5 + Math.random() * 0.7, size: 0.07, colour: '#ffffff', colour2: look.mid, sprite: SPRITE.streak, add: true, gravity: 4, drag: 1.2, stretch: 2.4, boost: 3 })
  }
  audio?.sfx?.('upgrade')
  audio?.sfx?.('ko_boom', { volume: 0.6 })
  const oldScale = beast.scale
  stage.scene.remove(beast.group)
  // The new body is built from its level alone: a form the old body was forced into must not carry over.
  const { form: _oldForm, ...wear } = beast.wear || {}
  const grown = new Beast(beast.species, { ...wear, level })
  grown.aspect = beast.aspect
  grown.title = to
  grown.face(facing)
  grown.group.rotation.y = turn
  grown.group.position.copy(place)
  stage.scene.add(grown.group)
  const life = effects.life(grown)
  // Until it is handed back, the new body is kept alive here.
  const breathe = (dt) => grown.update(dt)
  stage.add(breathe)
  const start = Math.min(1, oldScale / grown.scale)
  const settle = over(stage, 0.7, (k) => {
    // Out of the old size into the new one, with a little overshoot.
    const e = 1 - Math.pow(1 - k, 3)
    grown.group.scale.setScalar(start + (1 - start) * e + Math.sin(k * Math.PI) * 0.08)
    grown.hitFlash((1 - k) * 1.2)
  })
  const said = announce(to.toUpperCase(), `${from} has grown`, { colour: look.core, glow: look.mid })
  await settle
  grown.group.scale.setScalar(1)
  const voice = { quadruped: 'roar_quad', biped: 'roar_biped', serpent: 'roar_serpent', winged: 'roar_winged' }[grown.spec.rig]
  audio?.sfx?.(voice)
  effects.roar(grown)
  await grown.play('roar')
  await said
  stage.setGrade({ bars: 0 })
  stage.remove(breathe)
  grown.life = life
  return grown
}
