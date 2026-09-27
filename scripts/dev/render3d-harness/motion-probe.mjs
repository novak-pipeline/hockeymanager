// Per-rig motion quality probe for the render3d harness (server must be running).
//   node scripts/dev/render3d-harness/motion-probe.mjs "t=0.3" [--secs=15] [--port=5175] [--json]
// Hooks the renderer's own per-frame function (so every sample uses the exact
// dt it rendered with) and reports, over every visible rig:
//   ROOT   · maxSpeed: max on-screen speed (ft/s) — a snap shows up as a spike
//          · yawTwitchPerRigSec: sign flips of turn rate while turning > 60°/s
//   POSE   · per core bone (hips, spine, chest, neck, head, hand_L/R, stick):
//            local angular speed per rendered frame → p99 (rad/s) and
//            popsPerRigSec = body-core (hips…head) samples > 12 rad/s per rig-second
//            (hands / stick reported apart: shots swing them fast), with the
//            worst offenders and what was playing (clips, mode, speed)
//          · handOffStick: frames a hand that should grip the stick is > 0.3 ft
//            off the shaft (skaters, stick-hands clips only)
//   FRAMES · frame-time p95 / max (ms) and frames > 50 ms
// Gate (docs/graphics/RENDER3D-UPGRADE.md): maxSpeed ≤ 40, framesOver40 = 0,
// yawTwitchPerRigSec ≤ 0.1, popsPerRigSec ≤ 0.05.
import { chromium } from 'playwright-core'
const [query = '', ...flags] = process.argv.slice(2)
const opt = (k, d) => { const f = flags.find((x) => x.startsWith(`--${k}=`)); return f ? f.slice(k.length + 3) : d }
const secs = Number(opt('secs', 15)), port = Number(opt('port', process.env.R3D_PORT ?? 5175))
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false,
  args: ['--window-size=1300,780', '--window-position=-4000,-4000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(`http://localhost:${port}/?hud=0&play=1&${query}`)
await page.waitForFunction(() => '__r3d' in window, null, { timeout: 90000 })
await page.waitForTimeout(1000)
const r = await page.evaluate(async (secs) => {
  const R = window.__r3d
  const skaters = () => [...(R.homePoses ?? []), ...(R.awayPoses ?? [])]
  const goalies = () => [R.homeGoaliePose, R.awayGoaliePose].filter(Boolean)
  const CORE = ['hips', 'spine', 'chest', 'neck', 'head', 'hand_L', 'hand_R', 'stick']
  const POP = 12
  // body core gates the pops; hands / stick move fast legitimately (shots) — reported apart
  const BODY = new Set(['hips', 'spine', 'chest', 'neck', 'head'])
  const ctx = {}
  const hctx = {}
  let limbPops = 0
  const last = new Map(), lastW = new Map(), lastQ = new Map()
  let maxSpeed = 0, flips = 0, rigSec = 0, over40 = 0, samples = 0
  let boneSamples = 0, boneRigSec = 0, pops = 0, handChecks = 0, handOff = 0
  const speeds = []
  const spikes = [], worst = []
  const frameMs = []
  const longFrames = []
  const t0 = performance.now()
  const orig = R.renderAt.bind(R)
  const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)))
  const wpos = (bone) => { bone.updateWorldMatrix(true, false); const e = bone.matrixWorld.elements; return { x: e[12], y: e[13], z: e[14] } }
  R.renderAt = (absT, dt = 0, simDt = dt) => {
    orig(absT, dt, simDt)
    if (!(dt > 0)) { last.clear(); lastW.clear(); lastQ.clear(); return }
    frameMs.push(dt * 1000)
    if (dt > 0.05 && longFrames.length < 8) longFrames.push({ atSec: +((performance.now() - t0) / 1000).toFixed(2), ms: Math.round(dt * 1000), clock: +absT.toFixed(2) })
    const all = [...skaters().map((p) => [p, false]), ...goalies().map((p) => [p, true])]
    all.forEach(([p, goalie], i) => {
      if (!p.rig?.visible) { last.delete(i); lastW.delete(i); lastQ.delete(i); return }
      const cur = { x: p.worldX.pos, z: p.worldZ.pos, a: p.angle, mode: p.mode, id: p.playerId }
      const prev = last.get(i)
      const B = p.rig.bones
      const q = {}
      for (const n of CORE) q[n] = B[n].quaternion.clone()
      const pq = lastQ.get(i)
      if (prev && (prev.id === cur.id)) {
        if (!goalie) {
          const sp = Math.hypot(cur.x - prev.x, cur.z - prev.z) / dt
          if (sp > maxSpeed) maxSpeed = sp
          if (sp > 40.5) { over40++; if (spikes.length < 6) spikes.push({ sp: Math.round(sp), dt, prevMode: prev.mode, mode: cur.mode }) }
          let da = cur.a - prev.a; da = Math.atan2(Math.sin(da), Math.cos(da))
          const w = da / dt
          const pw = lastW.get(i)
          if (pw !== undefined && Math.abs(w) > 1.05 && Math.abs(pw) > 1.05 && Math.sign(w) !== Math.sign(pw)) flips++
          lastW.set(i, w); rigSec += dt; samples++
        }
        if (pq) {
          boneRigSec += dt
          for (const n of CORE) {
            const v = angle(pq[n], q[n]) / dt
            boneSamples++
            speeds.push(v)
            if (v > POP) {
              if (BODY.has(n)) pops++
              else limbPops++
              const key = `${goalie ? 'G' : 'S'} ${n} [${[...(p.layer?.playing ?? [])].join('+') || '-'}] ${p.mode ?? ''}`
              ctx[key] = (ctx[key] ?? 0) + 1
              if (worst.length < 400) worst.push({ bone: n, v: +v.toFixed(1), goalie, mode: p.mode, clips: [...(p.layer?.playing ?? [])], speed: +(p.speedSm ?? 0).toFixed(2), butterfly: +(p.butterfly ?? 0).toFixed(2), t: +absT.toFixed(2) })
            }
          }
        }
        // top / bottom hand on the shaft?
        if (!goalie && p.layer && (p.layer.armsWeight?.() ?? 0) < 0.05) {
          B.stick.updateWorldMatrix(true, false)
          const e = B.stick.matrixWorld.elements
          const heel = { x: e[12], y: e[13], z: e[14] }
          const len = Math.hypot(e[4], e[5], e[6]) || 1
          const dir = { x: e[4] / len, y: e[5] / len, z: e[6] / len }
          for (const h of ['hand_R', 'hand_L']) {
            const hp = wpos(B[h])
            const d = { x: hp.x - heel.x, y: hp.y - heel.y, z: hp.z - heel.z }
            const t = d.x * dir.x + d.y * dir.y + d.z * dir.z
            const off = Math.hypot(d.x - dir.x * t, d.y - dir.y * t, d.z - dir.z * t)
            handChecks++
            if (off > 0.3) { handOff++; const k = `${h} [${[...(p.layer?.playing ?? [])].join('+') || '-'}] ${p.mode ?? ''}`; hctx[k] = (hctx[k] ?? 0) + 1 }
          }
        }
      }
      last.set(i, cur)
      lastQ.set(i, q)
    })
  }
  await new Promise((d) => setTimeout(d, secs * 1000))
  R.renderAt = orig
  const pct = (a, k) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(k * s.length))] }
  const top = Object.entries(ctx).sort((a, b) => b[1] - a[1]).slice(0, 10)
  return {
    maxSpeed: +maxSpeed.toFixed(1), framesOver40: over40, samples, yawTwitchPerRigSec: +(flips / Math.max(1e-9, rigSec)).toFixed(3), spikes,
    boneSamples, bonePopSamples: pops, popsPerRigSec: +(pops / Math.max(1e-9, boneRigSec)).toFixed(3), handStickPopsPerRigSec: +(limbPops / Math.max(1e-9, boneRigSec)).toFixed(3), boneP99: +pct(speeds, 0.99).toFixed(2),
    handOffStick: handOff, handChecks, handOffContexts: Object.entries(hctx).sort((a, b) => b[1] - a[1]).slice(0, 8),
    frameP95ms: +pct(frameMs, 0.95).toFixed(1), frameMaxMs: +Math.max(0, ...frameMs).toFixed(1), framesOver50ms: frameMs.filter((x) => x > 50).length, longFrames, frames: frameMs.length,
    popContexts: top, worstPops: [...worst].sort((a, b) => b.v - a.v).slice(0, 5),
  }
}, secs)
console.log(JSON.stringify(r))
await browser.close()
