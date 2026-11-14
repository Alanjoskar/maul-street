// Photographs every line's five forms on the beast bench and tiles them into
// contact sheets: one per line (its line-up over a portrait of each form), one
// of all ten cubs, one of all ten mythics, and one of all fifty forms.
//
//   node scripts/gallery.mjs <baseUrl> <outDir> [quality] [ids]
//
// Works with the bench in debug.js (?view=beast); uses bench.load, bench.loadLine and bench.view.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:5173'
const outDir = process.argv[3] || 'gallery'
const quality = process.argv[4] || 'high'
const ids = (process.argv[5] || '0,1,2,3,4,5,6,7,8,9').split(',').map(Number)
const LEVELS = [1, 5, 12, 25, 50]
const FORMS = ['Cub', 'Prowler', 'Alpha', 'Dread', 'Mythic']
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] })
const errors = []
const shoot = async (width, height, jobs) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/?view=beast&id=${ids[0]}&level=1&quality=${quality}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.bench && window.bench.stage.frames > 20, null, { timeout: 120000 })
  const out = []
  for (const job of jobs) {
    await page.evaluate(job.setup, job.arg)
    await page.waitForTimeout(job.wait ?? 900)
    out.push((await page.screenshot({ type: 'jpeg', quality: 88 })).toString('base64'))
  }
  const names = await page.evaluate(() => window.maul?.tables?.species?.map((s) => ({ name: s.name, forms: s.forms })) ?? [])
  await page.close()
  return { shots: out, names }
}

// A portrait of each form, framed on its own size, three-quarters from the front.
const portraitJobs = []
for (const id of ids) {
  for (let form = 0; form < 5; form++) {
    portraitJobs.push({
      arg: { id, level: LEVELS[form] },
      setup: ({ id, level }) => {
        window.bench.load(id, level)
        const b = window.beast
        const tall = Math.max(1, b.height)
        window.bench.view(0.62, 2.2 + tall * 2.15, tall * 0.62)
      },
    })
  }
}
const portraits = await shoot(560, 420, portraitJobs)
const lineups = await shoot(1680, 620, ids.map((id) => ({ arg: id, setup: (id) => window.bench.loadLine(id), wait: 1200 })))
const names = portraits.names
const label = (id, form) => names[id]?.forms?.[form] ?? `${id}.${form}`

const sheet = async (file, width, height, html) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.setContent(`<body style="margin:0;background:#0b0907;color:#efe6d6;font:600 18px system-ui,sans-serif">${html}</body>`)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(outDir, file), type: 'jpeg', quality: 86 })
  await page.close()
  console.log('saved', join(outDir, file))
}
const tile = (b64, w, h, caption) => `<div style="position:relative;width:${w}px;height:${h}px;display:inline-block;vertical-align:top"><img src="data:image/jpeg;base64,${b64}" width="${w}" height="${h}" style="display:block"><div style="position:absolute;left:10px;bottom:8px;text-shadow:0 1px 3px #000">${caption}</div></div>`
const P = (i, form) => portraits.shots[i * 5 + form]

// One sheet per line: the line-up, then the five portraits.
for (const [i, id] of ids.entries()) {
  const title = `<div style="padding:10px 14px;font-size:22px">${names[id]?.name ?? `Line ${id}`} &nbsp;<span style="opacity:.6;font-weight:400">${FORMS.map((f, k) => `${label(id, k)}`).join(' &rarr; ')}</span></div>`
  const row = [0, 1, 2, 3, 4].map((form) => tile(P(i, form), 336, 252, `${label(id, form)} <span style="opacity:.6">${FORMS[form]} &middot; L${LEVELS[form]}+</span>`)).join('')
  await sheet(`sheet-line-${id}.jpg`, 1680, 48 + 620 + 252, `${title}<img src="data:image/jpeg;base64,${lineups.shots[i]}" width="1680" height="620" style="display:block">${row}`)
}
// All the cubs, all the mythics.
for (const [form, file] of [
  [0, 'sheet-cubs.jpg'],
  [4, 'sheet-mythics.jpg'],
]) {
  const cells = ids.map((id, i) => tile(P(i, form), 336, 252, label(id, form))).join('')
  await sheet(file, 1680, 48 + 252 * Math.ceil(ids.length / 5), `<div style="padding:10px 14px;font-size:22px">${FORMS[form]}s of every line</div>${cells}`)
}
// All fifty: a row per line.
const rows = ids.map((id, i) => [0, 1, 2, 3, 4].map((form) => tile(P(i, form), 280, 210, label(id, form))).join('')).join('')
await sheet('sheet-all.jpg', 1400, 210 * ids.length, rows)
writeFileSync(join(outDir, 'names.json'), JSON.stringify(names, null, 1))
if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].slice(0, 10).join('\n'))
await browser.close()
