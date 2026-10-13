// Grip probe (VT17's measure on the harness): how the DRAWN skaters hold their
// sticks over a stretch of play, plus close-up stills of each grip state.
// Server must be running (see vite.config.mjs), e.g. on R3D_PORT=5181.
//
//   node scripts/dev/render3d-harness/grip-probe.mjs <outDir> [--seeds=3,5] [--model=owner] [--secs=40] [--stills] [--hand=R]
//
// Prints per-seed and total shares:
//   carrier lance  = carrier frames (puck on the blade, no swing clip) in the lance pose
//   carrier 1-hand = carrier frames with the bottom hand off the shaft
//   carrier blade  = carrier frames with the blade's low edge > 3 in off the ice
//   all lance      = every on-ice skater frame (no swing clip) in the lance pose
// and writes <outDir>/grip-<seed>.json (+ stills/<state>-<seed>.png with --stills).
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [outDir = 'grip-probe', ...flags] = process.argv.slice(2)
const flag = (k, d) => { const f = flags.find((a) => a.startsWith(`--${k}=`)); return f ? f.slice(k.length + 3) : flags.includes(`--${k}`) ? true : d }
const seeds = String(flag('seeds', '3,5')).split(',').map(Number)
const model = flag('model', 'owner')
const secs = Number(flag('secs', 40))
const stills = flag('stills', false) === true
const hand = flag('hand', null)
const port = process.env.R3D_PORT ?? 5175
mkdirSync(join(outDir, 'stills'), { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--window-size=1300,760', '--window-position=-4000,-4000', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
})
const total = { carrier: 0, carrierLance: 0, carrierOne: 0, carrierBlade: 0, all: 0, allLance: 0, allOne: 0, states: {} }
for (const seed of seeds) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${port}/?hud=0&engine=agent&model=${model}&seed=${seed}&t=0.12&play=1${hand ? `&hand=${hand}` : ''}`)
  await page.waitForFunction(() => '__r3d' in window, null, { timeout: 90000 })
  await page.waitForTimeout(1500)
  const res = await page.evaluate((ms) => new Promise((done) => {
    const r = window.__r3d
    const acc = { carrier: 0, carrierLance: 0, carrierOne: 0, carrierBlade: 0, all: 0, allLance: 0, allOne: 0, states: {}, ex: [], byState: {}, lanceEx: [] }
    const t0 = performance.now()
    const last = new Map()
    acc.switches = 0
    acc.rigSec = 0
    let prevT = performance.now()
    const step = () => {
      const now = performance.now()
      for (const p of [...r.homePoses, ...r.awayPoses]) {
        if (!p.rig.visible || p.mode !== 'play' || !p.gripTarget) continue
        acc.rigSec += (now - prevT) / 1000
        const was = last.get(p.playerId)
        if (was && was !== p.gripTarget) acc.switches++
        last.set(p.playerId, p.gripTarget)
      }
      prevT = now
      for (const g of r.gripProbe()) {
        if (g.swing) continue
        acc.all++
        const ss = (acc.byState[g.state] ??= { n: 0, lance: 0, one: 0 })
        ss.n++
        if (g.lance) ss.lance++
        if (g.oneHand) ss.one++
        acc.states[g.state] = (acc.states[g.state] ?? 0) + 1
        if (g.lance && acc.lanceEx.length < 12 && Math.random() < 0.02) acc.lanceEx.push({ id: g.id, clips: g.clips, state: g.state, carrying: g.carrying, speed: +g.speedFt.toFixed(1), s: g.sample })
        if (g.lance) acc.allLance++
        if (g.oneHand) acc.allOne++
        if (g.carrying) {
          acc.carrier++
          if (g.lance) acc.carrierLance++
          if (g.oneHand) acc.carrierOne++
          if (g.sample.bladeY > 0.25) acc.carrierBlade++
          if ((g.lance || g.sample.bladeY > 0.25) && acc.ex.length < 6) acc.ex.push({ id: g.id, clips: g.clips, state: g.state, s: g.sample })
        }
      }
      if (performance.now() - t0 < ms) requestAnimationFrame(step)
      else done(acc)
    }
    requestAnimationFrame(step)
  }), secs * 1000)
  for (const k of ['carrier', 'carrierLance', 'carrierOne', 'carrierBlade', 'all', 'allLance', 'allOne']) total[k] += res[k]
  for (const [k, v] of Object.entries(res.states)) total.states[k] = (total.states[k] ?? 0) + v
  console.log('  by state', JSON.stringify(res.byState), '| grip switches per rig-s', res.rigSec ? (res.switches / res.rigSec).toFixed(2) : 'n/a')
  writeFileSync(join(outDir, `grip-${seed}.json`), JSON.stringify(res, null, 2))
  const pc = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : 'n/a')
  console.log(`seed ${seed}: carrier ${res.carrier} fr Â· lance ${pc(res.carrierLance, res.carrier)} Â· 1-hand ${pc(res.carrierOne, res.carrier)} Â· blade off ice ${pc(res.carrierBlade, res.carrier)} | all ${res.all} fr Â· lance ${pc(res.allLance, res.all)} Â· 1-hand ${pc(res.allOne, res.all)}${errors.length ? ` | errors: ${errors.slice(0, 2).join(' / ')}` : ''}`)

  if (stills) {
    // one close-up per grip state seen (the first skater found in it), frozen
    const want = ['carry', 'oneHand', 'ready', 'receive', 'relaxed', 'faceoff']
    for (const st of want) {
      const found = await page.evaluate(({ st }) => new Promise((done) => {
        const r = window.__r3d
        const t0 = performance.now()
        const look = () => {
          const kind = (x) => (x.state !== 'n/a' ? x.state : x.carrying ? 'carry' : x.speedFt > 18 ? 'oneHand' : 'relaxed')
          const g = r.gripProbe().find((x) => kind(x) === st && !x.swing && (x.state === 'n/a' || ([...r.homePoses, ...r.awayPoses].find((q) => q.playerId === x.id)?.gripW?.[st] ?? 0) > 0.97))
          if (g) {
            const p = [...r.homePoses, ...r.awayPoses].find((q) => q.playerId === g.id)
            r.pause?.()
            for (const q of [...r.homePoses, ...r.awayPoses, r.homeGoaliePose, r.awayGoaliePose]) if (q && q !== p) q.rig.mesh.visible = false
            window.__still = p
            const a = p.angle + Number(window.__gripAz ?? 1.1)
            r.setDebugCamera({ px: p.worldX.pos + Math.sin(a) * 12, py: 4.2, pz: p.worldZ.pos + Math.cos(a) * 12, lx: p.worldX.pos + Math.sin(p.angle) * 1.2, ly: 2.4, lz: p.worldZ.pos + Math.cos(p.angle) * 1.2, fov: 32 })
            setTimeout(() => done(true), 400)
          } else if (performance.now() - t0 < 25000) requestAnimationFrame(look)
          else done(false)
        }
        r.play?.()
        look()
      }), { st })
      if (found) {
        await page.screenshot({ path: join(outDir, 'stills', `${st}-${seed}.png`) })
        // the other side (his left: the forehand side for a left shot)
        await page.evaluate(() => {
          const r = window.__r3d
          const p = window.__still
          const a = p.angle - 1.4
          r.setDebugCamera({ px: p.worldX.pos + Math.sin(a) * 12, py: 4.2, pz: p.worldZ.pos + Math.cos(a) * 12, lx: p.worldX.pos + Math.sin(p.angle) * 1.2, ly: 2.4, lz: p.worldZ.pos + Math.cos(p.angle) * 1.2, fov: 32 })
        })
        await page.waitForTimeout(300)
        await page.screenshot({ path: join(outDir, 'stills', `${st}-${seed}-b.png`) })
      }
      await page.evaluate(() => { const r = window.__r3d; for (const q of [...r.homePoses, ...r.awayPoses, r.homeGoaliePose, r.awayGoaliePose]) if (q) q.rig.mesh.visible = true; r.setDebugCamera?.(null); r.play?.() })
    }
  }
  await page.close()
}
const pc = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : 'n/a')
console.log(`TOTAL: carrier ${total.carrier} fr Â· lance ${pc(total.carrierLance, total.carrier)} Â· 1-hand ${pc(total.carrierOne, total.carrier)} Â· blade off ice ${pc(total.carrierBlade, total.carrier)} | all ${total.all} fr Â· lance ${pc(total.allLance, total.all)} Â· 1-hand ${pc(total.allOne, total.all)}`)
console.log('states', JSON.stringify(total.states))
writeFileSync(join(outDir, 'grip-total.json'), JSON.stringify(total, null, 2))
await browser.close()
