// Film strip for judging MOTION (a still can't show a gait): N frames of one
// query, `every` ms apart, cropped around the canvas centre and tiled in a row.
//   node scripts/dev/render3d-harness/strip.mjs out.png "t=0.3&play=1&closeup=home:2,14,90,4&model=blender" [--n=8] [--every=90]
import { chromium } from 'playwright-core'
import { writeFileSync } from 'node:fs'

const [out, query = '', ...flags] = process.argv.slice(2)
const opt = (k, d) => { const f = flags.find((x) => x.startsWith(`--${k}=`)); return f ? f.slice(k.length + 3) : d }
const n = Number(opt('n', 8)), every = Number(opt('every', 90)), wait = Number(opt('wait', 2500))
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false,
  args: ['--window-size=1300,780', '--window-position=-4000,-4000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(`http://localhost:${process.env.R3D_PORT ?? 5175}/?hud=0&${query}`)
await page.waitForFunction(() => '__r3d' in window, null, { timeout: 90000 })
await page.waitForTimeout(wait)
const shots = []
for (let i = 0; i < n; i++) {
  shots.push((await page.screenshot({ clip: { x: 440, y: 120, width: 400, height: 520 } })).toString('base64'))
  await page.waitForTimeout(every)
}
await browser.close()
writeFileSync(out + '.json', JSON.stringify(shots))
console.log('frames', shots.length)
