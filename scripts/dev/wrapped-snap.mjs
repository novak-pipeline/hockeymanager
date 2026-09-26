/**
 * Season Wrapped screenshot harness (docs/SEASON-WRAPPED.md).
 *
 * Drives the dev-only /wrapped-preview.html page with playwright-core and a
 * locally installed Chrome/Edge (no browser download), and writes one PNG per
 * card kind (first occurrence across the dump) plus the Yearbook grid.
 *
 *   1. dump years:  WRAPPED_RUN=1 WRAPPED_OUT=out/wrapped npx vitest run src/engine/story/wrapped.harness.test.ts --no-file-parallelism
 *   2. serve:       a Vite dev server over src/renderer (port 5178 by default)
 *   3. snap:        node scripts/dev/wrapped-snap.mjs <years.json> [outDir] [baseUrl]
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [jsonPath, outDir = 'docs/graphics/wrapped', base = 'http://localhost:5178'] = process.argv.slice(2)
if (!jsonPath) { console.error('usage: wrapped-snap.mjs <years.json> [outDir] [baseUrl]'); process.exit(1) }
const years = JSON.parse(readFileSync(jsonPath, 'utf8'))
mkdirSync(outDir, { recursive: true })
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)
const src = `/@fs/${resolve(jsonPath).replace(/\\/g, '/')}`

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })

// Yearbook grid.
await page.goto(`${base}/wrapped-preview.html#src=${encodeURI(src)}`)
await page.waitForSelector('.yb-tile')
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/00-yearbook.png` })

// One card of each kind, first occurrence (newest year first so hindsight shows).
const seen = new Set()
let n = 1
for (const y of [...years].sort((a, b) => b.year - a.year)) {
  y.cards.forEach((c, i) => {
    if (seen.has(c.kind)) return
    seen.add(c.kind)
    c._at = { year: y.year, i }
  })
}
const shots = []
for (const y of years) for (const c of y.cards) if (c._at) shots.push(c)
shots.sort((a, b) => a._at.i - b._at.i || a._at.year - b._at.year)
for (const c of shots) {
  await page.goto(`${base}/wrapped-preview.html?k=${c.kind}#src=${encodeURI(src)}&year=${c._at.year}&card=${c._at.i}`)
  await page.waitForSelector('.wr-card')
  await page.waitForTimeout(1300) // entrances + count-up settle
  const file = `${outDir}/${String(n++).padStart(2, '0')}-${c.kind}.png`
  await page.locator('.wr-deck').screenshot({ path: file })
  console.log('wrote', file, `(${c._at.year})`)
}
// The whole stage once, for context.
if (shots[0]) {
  await page.goto(`${base}/wrapped-preview.html?k=stage#src=${encodeURI(src)}&year=${shots[0]._at.year}&card=1`)
  await page.waitForTimeout(1300)
  await page.screenshot({ path: `${outDir}/99-full-stage.png` })
}
await browser.close()
