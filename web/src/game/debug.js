// Benches for looking at beasts. Not part of the game.
//
//   /?view=beast&id=0&level=12            one beast (add &angle=0.6&dist=7.5&h=2 to place the camera, &spin to turn it)
//   /?view=line&id=0                      the five forms of one line, cub to mythic, side by side
//   /?view=line&id=0&levels=1,5,12        only some of them
//
// From the console: bench.play('roar'), bench.load(id, level), bench.view(angle, dist, height).

import * as THREE from 'three'
import { Stage } from './stage.js'
import { Arena } from './arena.js'
import { Beast } from './beast/beast.js'

const FORM_LEVELS = [1, 5, 12, 25, 50]

export function beastBench(canvas, params) {
  const stage = new Stage(canvas, { quality: params.get('quality') || 'high', film: params.has('film') })
  const arena = new Arena(stage)
  arena.setQuality(stage.quality)
  const line = params.get('view') === 'line'
  const beasts = []
  let angle = Number(params.get('angle') ?? (line ? 0.25 : 0.6))
  let dist = Number(params.get('dist') ?? (line ? 12.4 : 7.5))
  let height = Number(params.get('h') ?? (line ? 2.6 : 2.0))
  const spin = params.has('spin')
  const clear = () => {
    for (const beast of beasts) {
      stage.scene.remove(beast.group)
      beast.dispose()
    }
    beasts.length = 0
  }
  const load = (id, level = 12) => {
    clear()
    const beast = new Beast(id, { token: id, level })
    beast.face(1)
    stage.scene.add(beast.group)
    beasts.push(beast)
    window.beast = beast
  }
  const loadLine = (id, levels = FORM_LEVELS) => {
    clear()
    const made = levels.map((level) => new Beast(id, { token: id, level }))
    // Space them by their own size, smallest on the left.
    const widths = made.map((beast) => Math.max(1.6, beast.reach * 1.5))
    const total = widths.reduce((sum, w) => sum + w, 0)
    let x = -total / 2
    made.forEach((beast, i) => {
      beast.face(1)
      beast.group.rotation.y = -0.55
      beast.group.position.set(x + widths[i] / 2, 0, 0)
      x += widths[i]
      stage.scene.add(beast.group)
      beasts.push(beast)
    })
    window.beast = made[made.length - 1]
  }
  const id = Number(params.get('id') ?? 0)
  if (line) loadLine(id, params.get('levels') ? params.get('levels').split(',').map(Number) : FORM_LEVELS)
  else load(id, Number(params.get('level') ?? 12))
  stage.add((dt) => {
    for (const beast of beasts) beast.update(dt)
    if (spin) angle += dt * 0.4
    const tall = Math.max(...beasts.map((b) => b.chest))
    const look = new THREE.Vector3(0.3, tall * (line ? 0.7 : 0.95), 0)
    stage.rig.cut({ pos: new THREE.Vector3(Math.sin(angle) * dist + 0.3, height, Math.cos(angle) * dist), look, fov: line ? 44 : 36 })
  })
  stage.rig.drift = 0
  stage.start()
  window.bench = {
    stage,
    arena,
    beasts,
    load,
    loadLine,
    play: (name, options) => Promise.all(beasts.map((beast) => beast.play(name, options))),
    view: (a, d, h) => {
      angle = a
      dist = d ?? dist
      height = h ?? height
    },
  }
  return stage
}
