#!/usr/bin/env node
/**
 * broadcast-snaps.mjs — screenshot the broadcast package on the dev harness.
 *
 *   npx vite --config scripts/dev/vite.renderer-dev.config.mjs   (port 5179)
 *   node scripts/dev/broadcast-snaps.mjs [--r=3d] [--chrome=<path>]
 *
 * Drives /dev/broadcast-harness.html?story=demo in a throwaway headless Chrome
 * profile (never the app's user data) and writes PNGs to docs/graphics/broadcast/.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'docs', 'graphics', 'broadcast')
mkdirSync(OUT, { recursive: true })
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const r = arg('r', '2d')
const chrome = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const suffix = r === '3d' ? '-3d' : '-2d'

const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 820 }, deviceScaleFactor: 1 })
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()) })
await page.goto(`http://localhost:5179/dev/broadcast-harness.html?story=demo&r=${r}`, { waitUntil: 'load', timeout: 180_000 })
await page.waitForSelector('text=Full Game', { timeout: 180_000 })
await page.waitForTimeout(1500)

const viewport = async () => {
  const box = await page.locator('.bc-layer').first().boundingBox().catch(() => null)
  return box ? { clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 } } : {}
}
const snap = async (name, sel, settle = 700) => {
  try {
    await page.waitForSelector(sel, { timeout: 40_000 })
    await page.waitForTimeout(settle)
    await page.screenshot({ path: join(OUT, `${name}${suffix}.png`), ...(await viewport()) })
    console.log('saved', `${name}${suffix}.png`)
  } catch (e) { console.log('MISSED', name, e.message.split('\n')[0]) }
}

await page.click('text=Full Game')
if (r === '2d') {
  await snap('pregame-arena-title', '.bc-title')
  await snap('pregame-rookie-lap-caption', '.bc-caption')
  await snap('pregame-story-card', '.bc-card')
  await snap('pregame-starting-lineup', '.bc-lineup')
  await snap('pregame-goalie-tape', '.bc-tape')
}
// Skip the rest of the open, then jump to just before the first goal.
await page.click('.bc-skip').catch(() => undefined)
await page.waitForTimeout(800)
const goals = await page.evaluate(() => window.__bc.goals)
const target = Math.max(0, Math.floor(goals[0] * 1000) - 3)
await page.evaluate((v) => {
  const el = document.querySelector('input[type=range]')
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, String(v))
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}, target)
if (r === '2d') await snap('scorebug', '.bc-scorebug', 300)
await snap('goal-onice-tag', '.bc-tag:not(.small)', 1200)
await snap('goal-lower-third', '.bc-lt', 900)
await snap('milestone-card', '.bc-milestone', 900)
await browser.close()
