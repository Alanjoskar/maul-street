// Runs a snippet inside the game page and prints what it returns.
//   node scripts/probe.mjs <url> "<javascript expression or async body>"
import { chromium } from 'playwright'

const [url, code] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text())
})
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction(() => (window.bench && window.bench.stage.frames > 5) || (window.maul && window.maul.game && window.maul.game.stage.frames > 5), null, { timeout: 120000 })
const result = await page.evaluate(`(async () => { ${code} })()`)
console.log(JSON.stringify(result, null, 1))
if (errors.length) console.log('PAGE MESSAGES:\n' + [...new Set(errors)].slice(0, 10).join('\n'))
await browser.close()
