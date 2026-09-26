// Camera-smoothness probe (the "jiggle on start / on replay" regression).
// Traces the live camera per frame and reports the worst frame-to-frame
// acceleration and how often the pan direction reverses (a shake signature).
//   node scripts/dev/render3d-harness/jiggle.mjs
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--window-size=1320,820', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
})

function analyse(trace) {
  // Time-normalised (per second²) so runs at different frame rates compare.
  let maxAccPos = 0
  let maxAt = 0
  let maxAccDir = 0
  let reversals = 0
  let posRev = 0
  let prevVx = 0
  let prevPx = 0
  for (let i = 2; i < trace.length; i++) {
    const [t0, x0, y0, z0, a0, b0, c0] = trace[i - 2]
    const [t1, x1, y1, z1, a1, b1, c1] = trace[i - 1]
    const [t2, x2, y2, z2, a2, b2, c2] = trace[i]
    // non-uniform finite differences: frames are not evenly spaced
    const d1 = Math.max(1e-4, (t1 - t0) / 1000)
    const d2 = Math.max(1e-4, (t2 - t1) / 1000)
    const hm = (d1 + d2) / 2
    const acc3 = (p0, p1, p2) => ((p2 - p1) / d2 - (p1 - p0) / d1) / hm
    const acc = Math.hypot(acc3(x0, x1, x2), acc3(y0, y1, y2), acc3(z0, z1, z2))
    const accD = Math.hypot(acc3(a0, a1, a2), acc3(b0, b1, b2), acc3(c0, c1, c2)) * (180 / Math.PI)
    if (acc > maxAccPos) { maxAccPos = acc; maxAt = t1 }
    maxAccDir = Math.max(maxAccDir, accD)
    const vx = a2 - a1
    if (Math.abs(vx) > 2e-4 && Math.abs(prevVx) > 2e-4 && Math.sign(vx) !== Math.sign(prevVx)) reversals++
    if (Math.abs(vx) > 2e-4) prevVx = vx
    const px = x2 - x1
    if (Math.abs(px) > 1e-3 && Math.abs(prevPx) > 1e-3 && Math.sign(px) !== Math.sign(prevPx)) posRev++
    if (Math.abs(px) > 1e-3) prevPx = px
  }
  return {
    frames: trace.length,
    maxPosAcc_ftps2: Math.round(maxAccPos),
    atMs: Math.round(maxAt),
    maxDirAcc_degps2: Math.round(maxAccDir),
    lookReversals: reversals,
    truckReversals: posRev,
  }
}

async function run(label, query, before) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`http://localhost:5175/?hud=0&${query}`)
  await page.waitForFunction(() => '__r3d' in window, null, { timeout: 60000 })
  if (before) await page.evaluate(before)
  const trace = await page.evaluate(() => window.__camTrace(4000))
  const a = analyse(trace)
  console.log(label.padEnd(28), JSON.stringify(a))
  if (process.env.DUMP) {
    const i = trace.findIndex((r) => Math.round(r[0]) >= a.atMs)
    for (const r of trace.slice(Math.max(0, i - 4), i + 4)) console.log('   ', r.map((v) => +v.toFixed(3)).join('  '))
  }
  await page.close()
}

const extra = process.argv[2] ?? ''
await run('start of game (play)', `play=1&speed=2&${extra}`)
await run('goal celebration', `goal=0&lead=1&${extra}`)
await run('seek mid-play (replay jump)', `play=1&speed=2&t=0.2&${extra}`, () => setTimeout(() => window.__r3d.seekFraction(0.6), 1500))
await browser.close()
