// Photographs beasts on the bench: many shots from one page, so a whole round
// of look-and-fix pictures takes seconds.
//
//   node scripts/beast-shots.mjs <baseUrl> <outDir> <jobs.json | '[{...}, ...]'> [--size=1280x720] [--quality=high]
//
// A job is one picture:
//   { name, id, level, line?, view?: [angle, dist, height], face?: true | [angle, dist],
//     play?: 'roar', at?: seconds into the clip, js?: 'code run in the page first',
//     wait?: seconds to settle (default 0.9), size?: 'WxH', quality? }
// `line: true` shows the five forms of the line; `face` moves the camera to the head.
// Jobs that share a size and quality share a page.

import { chromium } from 'playwright'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [base, outDir, jobsArg, ...flags] = process.argv.slice(2)
const flag = (name, fallback) => (flags.find((f) => f.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback
const defaultSize = flag('size', '1280x720')
const defaultQuality = flag('quality', 'high')
const jobs = JSON.parse(existsSync(jobsArg) ? readFileSync(jobsArg, 'utf8') : jobsArg)
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] })
const groups = new Map()
for (const job of jobs) {
  const key = `${job.size || defaultSize}|${job.quality || defaultQuality}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(job)
}
const errors = []
for (const [key, list] of groups) {
  const [size, quality] = key.split('|')
  const [width, height] = size.split('x').map(Number)
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  const first = list[0]
  await page.goto(`${base}/?view=${first.line ? 'line' : 'beast'}&id=${first.id ?? 0}&level=${first.level ?? 12}&quality=${quality}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.bench && window.bench.stage.frames > 20, null, { timeout: 120000 })
  for (const job of list) {
    const started = Date.now()
    await page.evaluate(async (j) => {
      const bench = window.bench
      if (j.line) bench.loadLine(j.id ?? 0, j.levels)
      else bench.load(j.id ?? 0, j.level ?? 12, j.form)
      if (j.view) bench.view(...j.view)
      else if (!j.line && !j.set) bench.auto?.()
      if (j.face) bench.face?.(...(Array.isArray(j.face) ? j.face : []))
      if (j.js) await new Function('bench', 'beast', `return (async () => { ${j.js} })()`)(bench, window.beast)
    }, job)
    await page.waitForTimeout((job.wait ?? 0.9) * 1000)
    if (job.play) {
      await page.evaluate((j) => {
        window.bench.play(j.play)
      }, job)
      await page.waitForTimeout((job.at ?? 0.5) * 1000)
    }
    const file = join(outDir, `${job.name}.jpg`)
    await page.screenshot({ path: file, type: 'jpeg', quality: job.jpeg ?? 88 })
    const info = await page.evaluate(() => {
      const b = window.beast
      const renderer = window.bench.stage.renderer.info
      return b ? { form: b.form, verts: b.vertexCount ?? null, calls: renderer.render.calls, buildMs: b.buildMs ?? null } : null
    })
    console.log(`${job.name}.jpg  ${Date.now() - started} ms  ${JSON.stringify(info)}`)
  }
  await page.close()
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].slice(0, 12).join('\n'))
await browser.close()
