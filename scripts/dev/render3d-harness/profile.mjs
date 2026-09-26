// CPU profile of the render loop: top self-time functions over 4 s of play.
//   node scripts/dev/render3d-harness/profile.mjs "t=0.42&play=1"
import { chromium } from 'playwright-core'

const query = process.argv[2] ?? 't=0.42&play=1'
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--window-size=1320,820', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(`http://localhost:5175/?hud=0&${query}`)
await page.waitForFunction(() => '__r3d' in window, null, { timeout: 60000 })
await page.waitForTimeout(1500)
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('Profiler.start')
await page.waitForTimeout(4000)
const { profile } = await cdp.send('Profiler.stop')
const self = new Map()
const total = profile.samples.length
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const counts = new Map()
for (const s of profile.samples) counts.set(s, (counts.get(s) ?? 0) + 1)
for (const [id, c] of counts) {
  const n = byId.get(id)
  const cf = n.callFrame
  const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`
  self.set(key, (self.get(key) ?? 0) + c)
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
for (const [k, v] of top) console.log(((100 * v) / total).toFixed(1).padStart(5) + '%', k)
await browser.close()
