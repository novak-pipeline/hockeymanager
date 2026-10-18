// Capture the mocap A/B reel frames from the 3D harness in HEADLESS Chrome
// (software GL: no window ever opens on screen).
//
//   node scripts/mocap/capture.mjs <outDir> <tag> "<harness query>" [--clips=skate_stride,stickhandle,shot_wrist] [--n=16] [--az=90,20] [--port=5177]
//
// Each clip slot is FROZEN at n evenly spaced times (ActionLayer fadeless play,
// the harness's ?clip=…&freeze=1 path) on one skater, so the frames are exact
// clip poses however slowly software GL draws. With &mocap=1 in the query the
// slot plays its video-mocap stand-in. Writes <outDir>/<tag>-<clip>-az<A>-NN.png.
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [outDir, tag, query = '', ...flags] = process.argv.slice(2)
const opt = (k, d) => {
  const f = flags.find((x) => x.startsWith(`--${k}=`))
  return f ? f.slice(k.length + 3) : d
}
const clips = opt('clips', 'skate_stride,stickhandle,shot_wrist').split(',')
const n = Number(opt('n', 16))
const azs = opt('az', '90,20').split(',').map(Number)
const port = opt('port', '5177')
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  await page.goto(`http://localhost:${port}/?hud=0&nobloom=1&t=0.3&${query}`)
  await page.waitForFunction(() => '__r3d' in window, null, { timeout: 180000 })
  await page.waitForTimeout(3000)
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  for (const clip of clips) {
    const dur = await page.evaluate((name) => {
      const R = window.__r3d
      const i = R.homePoses.findIndex((p) => p.rig.visible && p.layer)
      window.__mocapIdx = i
      const c = R.homePoses[i].layer.clips.get(name)
      return c ? c.duration : null
    }, clip)
    if (dur === null) {
      console.log(tag, clip, 'MISSING')
      continue
    }
    for (const az of azs) {
      for (let k = 0; k < n; k++) {
        const at = (k / n) * dur
        await page.evaluate(
          ({ name, at, az }) => {
            const R = window.__r3d
            const p = R.homePoses[window.__mocapIdx]
            // solo: hide everyone else and pin a camera `az` degrees round from his front
            for (const o of [...R.homePoses, ...R.awayPoses, R.homeGoaliePose, R.awayGoaliePose]) if (o) o.rig.mesh.visible = o === p
            R.debugClip('home', window.__mocapIdx, name, at, true)
            const a = p.angle + (az * Math.PI) / 180
            R.setDebugCamera({ px: p.worldX.pos + Math.sin(a) * 19, py: 3.6, pz: p.worldZ.pos + Math.cos(a) * 19, lx: p.worldX.pos, ly: 2.7, lz: p.worldZ.pos, fov: 30 })
          },
          { name: clip, at, az }
        )
        await frames()
        await frames()
        const png = await page.screenshot({ clip: { x: 440, y: 70, width: 400, height: 560 } })
        writeFileSync(join(outDir, `${tag}-${clip}-az${az}-${String(k).padStart(2, '0')}.png`), png)
      }
    }
    console.log(tag, clip, 'dur', dur.toFixed(2), 'frames', n * azs.length)
  }
  console.log(tag, JSON.stringify(await page.evaluate(() => window.__r3d.debugInfo())))
} finally {
  await browser.close()
}
