// Which authored clips actually fire during play (and how often)?
//   node scripts/dev/render3d-harness/clip-probe.mjs "t=0.3&model=blender&loco=hybrid&speed=2" [--secs=30]
import { chromium } from 'playwright-core'
const [query = '', ...flags] = process.argv.slice(2)
const f = flags.find((x) => x.startsWith('--secs='))
const secs = f ? Number(f.slice(7)) : 30
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: ['--window-position=-4000,-4000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()) })
await page.goto(`http://localhost:${process.env.R3D_PORT ?? 5175}/?hud=0&play=1&${query}`)
await page.waitForFunction(() => '__r3d' in window, null, { timeout: 90000 })
const r = await page.evaluate(async (secs) => {
  const R = window.__r3d
  const seen = {}
  const prev = new Map()
  const t0 = performance.now()
  await new Promise((done) => {
    const step = () => {
      const poses = [...R.homePoses, ...R.awayPoses, R.homeGoaliePose, R.awayGoaliePose]
      poses.forEach((p, i) => {
        const now = new Set(p.layer?.playing ?? [])
        const was = prev.get(i) ?? new Set()
        for (const n of now) if (!was.has(n)) seen[n] = (seen[n] ?? 0) + 1
        prev.set(i, now)
      })
      if (performance.now() - t0 < secs * 1000) requestAnimationFrame(step)
      else done()
    }
    requestAnimationFrame(step)
  })
  return seen
}, secs)
console.log(JSON.stringify(r))
if (errs.length) console.log('console:', errs.slice(0, 5).join('\n'))
await browser.close()
