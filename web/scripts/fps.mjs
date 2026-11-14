// Measures frames per second of a practice fight for a list of settings.
//   node scripts/fps.mjs [baseUrl] [size] [query,query,...]
// Each query is appended to the fight link, e.g. "quality=medium&bloom=0".
import { chromium } from 'playwright'

const base = process.argv[2] || 'http://127.0.0.1:5173'
const [width, height] = (process.argv[3] || '1920x1080').split('x').map(Number)
const variants = (process.argv[4] || 'quality=low,quality=medium,quality=high').split(',')
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'] })
for (const variant of variants) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.goto(`${base}/?fight=practice&squad=0,2,3&den=1&${variant}`, { waitUntil: 'load' })
  await page.waitForSelector('.pick', { timeout: 90000 })
  await page.evaluate(() => document.querySelector('.pick').click())
  await page.waitForSelector('.move', { timeout: 90000 })
  const result = await page.evaluate(async () => {
    const stage = window.maul.game.stage
    const f0 = stage.frames
    const t0 = performance.now()
    await new Promise((resolve) => setTimeout(resolve, 5000))
    return { fps: ((stage.frames - f0) / (performance.now() - t0)) * 1000 }
  })
  console.log(`${variant.padEnd(44)} ${width}x${height}  ${result.fps.toFixed(1)} fps`)
  await page.close()
}
await browser.close()
