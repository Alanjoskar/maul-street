// Builds every form of every line without a browser and reports size, draw
// calls (one per material) and timing, and catches bad numbers.
// Run from web/: node scripts/build-beasts.mjs [id] [form]
import { VISUALS, BUILDERS } from '../src/game/beast/species.js'
import { formSheet, FORM_NAMES } from '../src/game/beast/forms.js'

const [onlyId, onlyForm] = process.argv.slice(2)
let worst = { vertices: 0 }
let slowest = { ms: 0 }
let failed = 0
// Warm up, so the first line is not charged for the JIT.
BUILDERS[VISUALS[0].rig](formSheet(VISUALS[0], 2))
for (const [id, line] of Object.entries(VISUALS)) {
  if (onlyId !== undefined && onlyId !== id) continue
  for (let form = 0; form < 5; form++) {
    if (onlyForm !== undefined && Number(onlyForm) !== form) continue
    const started = performance.now()
    try {
      const S = formSheet(line, form)
      const built = BUILDERS[S.rig](S)
      const ms = performance.now() - started
      let vertices = 0
      let bad = 0
      const per = []
      for (const [key, list] of Object.entries(built.body.parts)) {
        let n = 0
        for (const geometry of list) {
          for (const name of ['position', 'normal', 'color', 'glow']) {
            const a = geometry.attributes[name]
            if (!a) {
              bad++
              continue
            }
            for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) bad++
          }
          n += geometry.attributes.position.count
        }
        vertices += n
        per.push(`${key} ${n}`)
      }
      const meta = built.meta
      const metaBad = Object.values(meta).some((x) => !Number.isFinite(x))
      if (vertices > worst.vertices) worst = { vertices, id, form }
      if (ms > slowest.ms) slowest = { ms, id, form }
      const name = `${line.name}/${FORM_NAMES[form]}`
      console.log(`${id}.${form} ${name.padEnd(20)} ${S.rig.padEnd(10)} bones ${String(built.body.bones.length).padStart(3)}  vertices ${String(vertices).padStart(6)}  calls ${Object.keys(built.body.parts).length}  ${ms.toFixed(0).padStart(4)} ms  h ${meta.height.toFixed(2)} reach ${meta.reach.toFixed(2)}  [${per.join(', ')}]${bad ? `  BAD NUMBERS: ${bad}` : ''}${metaBad ? '  BAD META' : ''}`)
      if (bad || metaBad) failed++
    } catch (error) {
      failed++
      console.log(`${id}.${form} ${line.name} FAILED: ${error.stack}`)
    }
  }
}
console.log(`heaviest: ${worst.id}.${worst.form} with ${worst.vertices} vertices; slowest: ${slowest.id}.${slowest.form} in ${slowest.ms?.toFixed(0)} ms${failed ? `; ${failed} FAILED` : ''}`)
