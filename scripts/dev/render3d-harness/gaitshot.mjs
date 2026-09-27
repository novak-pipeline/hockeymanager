// Screenshot the gait lab:  node scripts/dev/render3d-harness/gaitshot.mjs out.png "speed=0.9&rows=proc,code,clip"
import { chromium } from 'playwright-core'
const [out, query = ''] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: ['--window-size=1640,1100', '--window-position=-4000,-4000'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.goto(`http://localhost:${process.env.R3D_PORT ?? 5175}/gait.html?${query}`)
await page.waitForFunction(() => '__r3d' in window, null, { timeout: 90000 })
await page.waitForTimeout(500)
await page.locator('canvas').screenshot({ path: out })
if (errs.length) console.log(errs.join('\n'))
await browser.close()
