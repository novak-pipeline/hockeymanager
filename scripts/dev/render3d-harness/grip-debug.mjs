// Dev: dump the rig dims and where each hand sits on the shaft for a few skaters (grip tuning).
//   node scripts/dev/render3d-harness/grip-debug.mjs [query]
import { chromium } from 'playwright-core'
const query = process.argv[2] ?? 'engine=agent&model=owner&seed=5&t=0.12&play=1'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: ['--window-position=-4000,-4000'] })
const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
await page.goto(`http://localhost:${process.env.R3D_PORT ?? 5175}/?hud=0&${query}`)
await page.waitForFunction(() => '__r3d' in window, null, { timeout: 90000 })
await page.waitForTimeout(3000)
const out = await page.evaluate(() => {
  const r = window.__r3d
  const res = []
  for (const p of [...r.homePoses, ...r.awayPoses]) {
    if (!p.rig.visible || p.mode !== 'play') continue
    const rig = p.rig
    const B = rig.bones
    const inv = rig.root.matrixWorld.clone().invert()
    const loc = (o) => { const v = o.getWorldPosition(o.position.clone()).applyMatrix4(inv); return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)] }
    const heel = B.stick.getWorldPosition(B.stick.position.clone()).applyMatrix4(inv)
    const q = B.stick.getWorldQuaternion(B.stick.quaternion.clone()).premultiply(rig.root.getWorldQuaternion(B.stick.quaternion.clone()).invert())
    const dir = B.stick.up.clone().set(0, 1, 0).applyQuaternion(q)
    const along = (h) => { const v = B[h].localToWorld(rig.gripPalm[h.slice(-1)].clone()).applyMatrix4(inv); return +v.sub(heel).dot(dir).toFixed(2) }
    res.push({ id: p.playerId, state: rig.gripState, dims: rig.dims, shL: loc(B.upperarm_L), shR: loc(B.upperarm_R), hips: loc(B.hips), heel: [+heel.x.toFixed(2), +heel.y.toFixed(2), +heel.z.toFixed(2)], tR: along('hand_R'), tL: along('hand_L'), handR: loc(B.hand_R), handL: loc(B.hand_L) })
  }
  return res
})
console.log(JSON.stringify(out.slice(0, 6), null, 1))
await browser.close()
