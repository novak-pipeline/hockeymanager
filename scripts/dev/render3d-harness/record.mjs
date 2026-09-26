// Record a video clip of the render3d harness straight from the WebGL canvas
// (MediaRecorder on canvas.captureStream — no ffmpeg needed). Server must be running.
//   node scripts/dev/render3d-harness/record.mjs out.webm "goal=0&lead=6&cam=broadcast" [--secs=12] [--port=5175] [--fps=60]
// Headed system Chrome so the real GPU renders; the window is parked off-screen
// with occlusion/background throttling disabled so it doesn't cover the desktop.
import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'

const [out, query = '', ...flags] = process.argv.slice(2)
const opt = (k, d) => { const f = flags.find((x) => x.startsWith(`--${k}=`)); return f ? f.slice(k.length + 3) : d }
const secs = Number(opt('secs', 12))
const port = Number(opt('port', 5175))
const fps = Number(opt('fps', 60))
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: [
    '--window-size=1300,780', '--window-position=-4000,-4000',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(`http://localhost:${port}/?hud=0&${query}`)
await page.waitForFunction(() => '__r3d' in window, null, { timeout: 60000 })
await page.waitForTimeout(1500) // shaders warm, first frames settled
const b64 = await page.evaluate(async ({ secs, fps }) => {
  const canvas = document.querySelector('canvas')
  const stream = canvas.captureStream(fps)
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm'
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  const chunks = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise((r) => (rec.onstop = r))
  rec.start(250)
  window.__r3d.play?.()
  await new Promise((r) => setTimeout(r, secs * 1000))
  rec.stop()
  await done
  const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
  let s = ''; const u = new Uint8Array(buf)
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}, { secs, fps })
await writeFile(out, Buffer.from(b64, 'base64'))
await browser.close()
console.log('wrote', out)
