// Opens the game in a real (GPU) Chromium, optionally plays a practice fight by
// itself, and saves screenshots at the times asked for.
//
//   node scripts/shot.mjs <url> <outDir> <seconds,seconds,...> [--auto] [--size=1280x720]
//
// With --auto the script clicks a move or a pick whenever one is offered
// (the Special whenever it is ready).

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [url, outDir, timesArg, ...flags] = process.argv.slice(2)
const times = (timesArg || '5').split(',').map(Number)
const auto = flags.includes('--auto')
const sizeFlag = flags.find((f) => f.startsWith('--size='))
const [width, height] = (sizeFlag ? sizeFlag.slice(7) : '1280x720').split('x').map(Number)
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})
const started = Date.now()
await page.goto(url, { waitUntil: 'load' })
if (auto) {
  await page.evaluate(() => {
    setInterval(() => {
      const ready = document.querySelector('.move.special.ready:not(:disabled)')
      const list = [...document.querySelectorAll('.move:not(:disabled), .pick:not(:disabled)')]
      if (!list.length) return
      ;(ready || list[Math.floor(Math.random() * Math.min(3, list.length))]).click()
    }, 400)
  })
}
for (const [i, at] of times.entries()) {
  const wait = at * 1000 - (Date.now() - started)
  if (wait > 0) await page.waitForTimeout(wait)
  const name = `${String(i).padStart(2, '0')}-${String(at).replace('.', '_')}s.jpg`
  await page.screenshot({ path: join(outDir, name), type: 'jpeg', quality: 80 })
  const info = await page.evaluate(() => {
    const stage = window.maul?.game?.stage || window.bench?.stage
    return { frames: stage?.frames ?? null, quality: stage?.quality ?? null, hint: document.querySelector('.hud-hint')?.textContent ?? '', banner: document.querySelector('.banner-main')?.textContent ?? '' }
  })
  console.log(name, JSON.stringify(info))
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].slice(0, 12).join('\n'))
await browser.close()
