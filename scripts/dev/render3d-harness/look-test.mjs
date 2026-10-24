// Art-direction look test: the SAME moments in every art style, frame-exact.
// The render loop is stopped and stepped by hand at a fixed 60 Hz, so every
// style renders identical sim frames (side-by-side stills + video frames).
// Server must be running (R3D_PORT, default 5175):
//   npx vite --config scripts/dev/render3d-harness/vite.config.mjs --port 5175
//   node scripts/dev/render3d-harness/look-test.mjs <outDir> [--model=owner|blender] [--video] [--perf] [--only=goal]
// Headless Chrome on the real GPU (ANGLE D3D11) — no window ever opens.
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [outDir = '.cache/look-test', ...flags] = process.argv.slice(2)
const opt = (k, d) => { const f = flags.find((x) => x.startsWith(`--${k}=`)); return f ? f.slice(k.length + 3) : d }
const port = Number(process.env.R3D_PORT ?? 5175)
const model = opt('model', 'owner')
const seed = Number(opt('seed', 3))
const STYLES = (opt('styles', 'current,cleanBroadcast,cartoony')).split(',')
const only = opt('only', '')
const W = Number(opt('w', 1280))
const H = Number(opt('h', 720))

// moment → which event, how far before it to start playing, when to grab
const MOMENTS = [
  { name: 'cycle', pick: 'cycle', lead: 4, at: 0.6, closeup: [12, 40, 4.2, 3.2] },
  { name: 'goal', pick: 'goal', lead: 4, at: -0.2, closeup: [11, 30, 4.2, 3.2] },
  { name: 'hit', pick: 'hit', lead: 3, at: 0.25, closeup: [13, 60, 4.2, 3] },
  { name: 'faceoff', pick: 'faceoff', lead: 3, at: -0.25, closeup: [10, 20, 4.2, 3.2] },
].filter((m) => !only || only.split(',').includes(m.name))

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
})

async function open(style) {
  const page = await browser.newPage({ viewport: { width: W, height: H } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`http://localhost:${port}/?hud=0&engine=agent&seed=${seed}&model=${model}&style=${style}&w=${W}&h=${H}`)
  await page.waitForFunction(() => '__r3d' in window, null, { timeout: 90000 })
  await page.waitForTimeout(800)
  if (errors.length) console.log(style, 'errors', errors.slice(0, 4).join('\n'))
  // install the frame-stepper
  await page.evaluate(() => {
    const r = window.__r3d
    r.renderer.setAnimationLoop(null)
    const stream = window.__stream
    const absT = (e) => (e.playT !== undefined ? e.playT : (e.period - 1) * 1200 + e.t)
    const pick = (kind) => {
      if (kind === 'cycle') return stream.find((e) => e.type === 'battle' && e.kind === 'boards' && Math.abs(e.pos.x) > 0.65) ?? stream.find((e) => e.type === 'battle')
      if (kind === 'goal') return stream.find((e) => e.type === 'goal')
      if (kind === 'hit') return stream.find((e) => e.type === 'hit' && e.kind === 'boards' && (e.force ?? 0) > 0.4) ?? stream.find((e) => e.type === 'hit')
      if (kind === 'faceoff') return stream.filter((e) => e.type === 'faceoff' && e.zone !== 'neutral')[1] ?? stream.find((e) => e.type === 'faceoff')
      return null
    }
    let now = performance.now()
    window.__step = (n) => { for (let i = 0; i < n; i++) { now += 1000 / 60; r.animLoop(now) } }
    window.__prep = (kind, lead) => {
      const e = pick(kind)
      const t = absT(e)
      r.setDebugCamera(null)
      r.seekFraction(Math.max(0, t - lead) / window.__duration)
      r.play()
      const actor = e.by ?? e.scorer ?? e.winner ?? (e.players ? e.players[0] : null) ?? e.player ?? null
      window.__actor = actor
      return { t, actor, type: e.type, kind: e.kind ?? e.zone ?? '' }
    }
    // pin a close-up camera on the moment's main actor (updated every stepped frame)
    window.__closeup = (dist, az, h, lookY) => {
      const all = [...r.homePoses, ...r.awayPoses, r.homeGoaliePose, r.awayGoaliePose]
      const p = all.find((x) => x && x.playerId === window.__actor && x.rig.visible) ?? all.find((x) => x && x.rig.visible)
      const a = p.angle + (az * Math.PI) / 180
      r.setDebugCamera({ px: p.worldX.pos + Math.sin(a) * dist, py: h, pz: p.worldZ.pos + Math.cos(a) * dist, lx: p.worldX.pos, ly: lookY, lz: p.worldZ.pos, fov: 30 })
    }
  })
  return page
}

const report = { model, seed, moments: {}, perf: {} }
for (const style of STYLES) {
  const page = await open(style)
  for (const m of MOMENTS) {
    const info = await page.evaluate(({ k, lead }) => window.__prep(k, lead), { k: m.pick, lead: m.lead })
    report.moments[m.name] = info
    const frames = Math.round((m.lead + m.at) * 60)
    await page.evaluate((n) => window.__step(n), frames)
    await page.screenshot({ path: join(outDir, `${m.name}_${style}_${model}.png`) })
    // close-up of the actor on the very same frame
    await page.evaluate((c) => { window.__closeup(...c); window.__step(1) }, m.closeup)
    await page.screenshot({ path: join(outDir, `${m.name}_${style}_${model}_close.png`) })
    await page.evaluate(() => window.__r3d.setDebugCamera(null))
  }
  if (flags.includes('--video')) {
    // 8 s of the goal moment at 30 fps (every other 60 Hz step), broadcast camera
    const vdir = join(outDir, 'frames', `${style}_${model}`)
    await mkdir(vdir, { recursive: true })
    await page.evaluate(() => window.__prep('goal', 6))
    for (let i = 0; i < 240; i++) {
      await page.evaluate(() => window.__step(2))
      await page.screenshot({ path: join(vdir, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 90 })
    }
  }
  if (flags.includes('--perf')) {
    // real-time frame cost: restart the loop uncapped, play the cycle moment
    const perf = await page.evaluate(async () => {
      const r = window.__r3d
      window.__prep('cycle', 4)
      r.renderer.setAnimationLoop((t) => r.animLoop(t))
      await new Promise((res) => setTimeout(res, 1500))
      const p = await window.__perf(5000)
      return { ...p, info: r.debugInfo() }
    })
    report.perf[style] = perf
    console.log(style, JSON.stringify(perf))
  }
  await page.close()
}
await writeFile(join(outDir, `report_${model}.json`), JSON.stringify(report, null, 2))
await browser.close()
console.log('done', outDir)
