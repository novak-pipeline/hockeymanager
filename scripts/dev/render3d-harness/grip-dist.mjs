// Dev: distribution of the grip measures (gripTruth.ts) over a few seconds of play — for setting VT17's thresholds.
//   node scripts/dev/render3d-harness/grip-dist.mjs [query] [secs]
import { chromium } from 'playwright-core'
const query = process.argv[2] ?? 'engine=agent&model=owner&seed=5&t=0.12&play=1'
const secs = Number(process.argv[3] ?? 8)
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: ['--window-position=-4000,-4000'] })
const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
await page.goto(`http://localhost:${process.env.R3D_PORT ?? 5175}/?hud=0&${query}`)
await page.waitForFunction(() => '__r3d' in window, null, { timeout: 90000 })
await page.waitForTimeout(1500)
const out = await page.evaluate((ms) => new Promise((done) => {
  const r = window.__r3d
  const cols = { one: { topFwd: [], topY: [], bladeAhead: [], bottomOff: [] }, two: { topFwd: [], topY: [], bladeAhead: [], bottomOff: [] }, carrier: { topFwd: [], topY: [], bladeAhead: [], bottomOff: [] } }
  const t0 = performance.now()
  const step = () => {
    for (const g of r.gripProbe()) {
      if (g.swing) continue
      const c = g.carrying ? cols.carrier : g.oneHand ? cols.one : cols.two
      for (const k of Object.keys(c)) c[k].push(g.sample[k])
    }
    if (performance.now() - t0 < ms) requestAnimationFrame(step)
    else {
      const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +s[Math.floor(p * (s.length - 1))].toFixed(2) : null }
      const res = {}
      for (const [n, c] of Object.entries(cols)) {
        res[n] = { n: c.topFwd.length }
        for (const [k, xs] of Object.entries(c)) res[n][k] = [pct(xs, 0.1), pct(xs, 0.5), pct(xs, 0.9)]
      }
      done(res)
    }
  }
  requestAnimationFrame(step)
}), secs * 1000)
console.log(JSON.stringify(out, null, 1))
await browser.close()
