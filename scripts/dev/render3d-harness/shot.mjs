// Screenshot + perf probe for the render3d harness (server must be running on 5175).
//   node scripts/dev/render3d-harness/shot.mjs out.png "t=0.3&cam=broadcast" [--perf] [--wait=2500]
// Uses the system Chrome via playwright-core, HEADED so the real GPU is used
// (headless falls back to SwiftShader and perf numbers would be meaningless).
import { chromium } from 'playwright-core'

const [out, query = '', ...flags] = process.argv.slice(2)
const perf = flags.includes('--perf')
const waitFlag = flags.find((f) => f.startsWith('--wait='))
const wait = waitFlag ? Number(waitFlag.slice(7)) : 2500
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: [
    '--window-size=1960,1180',
    '--window-position=-4000,-4000', // off-screen: never pops over the desktop (real GPU still used)
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    // --perf: uncap the frame rate so avgMs is the real cost, not the vsync interval
    ...(perf ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
  ],
})
const big = flags.includes('--1080')
const page = await browser.newPage({ viewport: big ? { width: 1920, height: 1080 } : { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(`http://localhost:5175/?hud=0&${query}`)
try {
  await page.waitForFunction(() => '__r3d' in window, null, { timeout: 60000 })
} catch (e) {
  console.log('harness never became ready', errors.join('\n'))
  await browser.close()
  process.exit(1)
}
await page.waitForTimeout(wait)
if (out) await page.screenshot({ path: out })
if (perf) {
  // --cpu4: emulate a ~4x slower CPU (laptop-class main thread)
  if (flags.includes('--cpu4')) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  }
  const r = await page.evaluate(() => window.__perf(4000))
  console.log('perf', JSON.stringify(r))
  const info = await page.evaluate(() => window.__r3d.debugInfo?.())
  if (info) console.log('info', JSON.stringify(info))
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  console.log('gpu', gpu)
}
if (errors.length) console.log('errors', errors.slice(0, 5).join('\n'))
await browser.close()
