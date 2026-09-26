// Screenshot + perf probe for the render3d harness (server must be running on 5175).
//   node scripts/dev/render3d-harness/shot.mjs out.png "t=0.3&cam=broadcast" [--perf] [--wait=2500]
// Uses the system Chrome via playwright-core, HEADED so the real GPU is used
// (headless falls back to SwiftShader and perf numbers would be meaningless).
import { chromium } from 'playwright-core'

const [out, query = '', ...flags] = process.argv.slice(2)
const perf = flags.includes('--perf')
const waitFlag = flags.find((f) => f.startsWith('--wait='))
const wait = waitFlag ? Number(waitFlag.slice(7)) : 2500
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--window-size=1320,820', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(`http://localhost:5175/?hud=0&${query}`)
try {
  await page.waitForFunction(() => '__r3d' in window, null, { timeout: 60000 })
} catch (e) {
  console.log('harness never became ready', errors.join('\n'))
  await browser.close()
  process.exit(1)
}
await page.waitForTimeout(wait)
if (out) await page.screenshot({ path: out })
if (perf) {
  const r = await page.evaluate(() => window.__perf(4000))
  console.log('perf', JSON.stringify(r))
  const info = await page.evaluate(() => window.__r3d.debugInfo?.())
  if (info) console.log('info', JSON.stringify(info))
}
if (errors.length) console.log('errors', errors.slice(0, 5).join('\n'))
await browser.close()
