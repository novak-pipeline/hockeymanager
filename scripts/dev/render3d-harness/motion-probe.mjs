// Per-rig motion quality probe for the render3d harness (server must be running).
//   node scripts/dev/render3d-harness/motion-probe.mjs "t=0.3" [--secs=15] [--port=5175]
// Samples every visible skater rig each animation frame and reports:
//   · max on-screen speed (ft/s) — a snap shows up as a huge spike
//   · yaw twitch: sign flips of turn rate while turning > 60°/s, per rig-second
import { chromium } from 'playwright-core'
const [query = '', ...flags] = process.argv.slice(2)
const opt = (k, d) => { const f = flags.find((x) => x.startsWith(`--${k}=`)); return f ? f.slice(k.length + 3) : d }
const secs = Number(opt('secs', 15)), port = Number(opt('port', 5175))
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false,
  args: ['--window-size=1300,780', '--window-position=-4000,-4000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(`http://localhost:${port}/?hud=0&play=1&${query}`)
await page.waitForFunction(() => '__r3d' in window, null, { timeout: 90000 })
await page.waitForTimeout(1000)
const r = await page.evaluate(async (secs) => {
  // Hook the renderer's own per-frame function so every sample uses the exact dt
  // it rendered with (sampling from a separate rAF aliases badly off-screen).
  const R = window.__r3d
  const poses = () => [...(R.homePoses ?? []), ...(R.awayPoses ?? [])]
  const last = new Map(), lastW = new Map()
  let maxSpeed = 0, flips = 0, rigSec = 0, over40 = 0, samples = 0
  const spikes = []
  const orig = R.renderAt.bind(R)
  R.renderAt = (absT, dt = 0, simDt = dt) => {
    orig(absT, dt, simDt)
    if (!(dt > 0)) { last.clear(); lastW.clear(); return }
    poses().forEach((p, i) => {
      if (!p.rig?.visible) { last.delete(i); lastW.delete(i); return }
      const cur = { x: p.worldX.pos, z: p.worldZ.pos, a: p.angle, mode: p.mode, id: p.playerId }
      const prev = last.get(i)
      if (prev) {
        const sp = Math.hypot(cur.x - prev.x, cur.z - prev.z) / dt
        if (sp > maxSpeed) maxSpeed = sp
        if (sp > 40.5) { over40++; if (spikes.length < 6) spikes.push({ sp: Math.round(sp), dt, prevMode: prev.mode, mode: cur.mode, sameId: prev.id === cur.id }) }
        let da = cur.a - prev.a; da = Math.atan2(Math.sin(da), Math.cos(da))
        const w = da / dt
        const pw = lastW.get(i)
        if (pw !== undefined && Math.abs(w) > 1.05 && Math.abs(pw) > 1.05 && Math.sign(w) !== Math.sign(pw)) flips++
        lastW.set(i, w); rigSec += dt; samples++
      }
      last.set(i, cur)
    })
  }
  await new Promise((d) => setTimeout(d, secs * 1000))
  return { maxSpeed: +maxSpeed.toFixed(1), framesOver40: over40, samples, yawTwitchPerRigSec: +(flips / Math.max(1e-9, rigSec)).toFixed(3), spikes }
}, secs)
console.log(JSON.stringify(r))
await browser.close()
