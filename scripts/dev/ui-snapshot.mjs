/**
 * UI snapshot harness — launch the REAL Electron app with Playwright, drive a
 * fresh career, and screenshot every major screen so Claude (or a human) can
 * eyeball the whole UI in one pass. The Robowild render-snapshot technique,
 * applied to the shell.
 *
 * Usage:
 *   npm run build            # electron-vite build -> out/
 *   node scripts/dev/ui-snapshot.mjs [outDir]
 *
 * Output: <outDir|scripts/dev/ui-snaps>/NN-<screen>.png + console-errors.txt.
 * Uses playwright-core's Electron driver (no browser downloads, no network).
 */
import { _electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = process.argv[2] ?? join(root, 'scripts', 'dev', 'ui-snaps')
mkdirSync(outDir, { recursive: true })

/** Sidebar destinations to photograph once the shell is up (label → slug). */
const SIDEBAR_STOPS = [
  ['Home', 'dashboard'],
  ['Inbox', 'inbox'],
  ['Roster', 'squad'],
  ['Dynamics', 'dynamics'],
  ['Tactics', 'tactics'],
  ['Data Hub', 'datahub'],
  ['Medical Center', 'medical'],
  ['Schedule', 'calendar'],
  ['Competitions', 'league'],
  ['Scouting', 'scouting'],
  ['Transfers', 'transfers'],
  ['Finances', 'finances'],
]

const consoleErrors = []
let shot = 0

async function snap(win, slug) {
  shot += 1
  // Clicking topbar controls can leave scroll containers shifted at narrow
  // widths (the shell overflows below ~1400px — known UI debt); reset every
  // scrollable element so every shot is anchored top-left.
  await win.evaluate(() => {
    window.scrollTo(0, 0)
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollLeft) el.scrollLeft = 0
    }
  })
  const file = join(outDir, `${String(shot).padStart(2, '0')}-${slug}.png`)
  await win.screenshot({ path: file })
  console.log(`  📸 ${file}`)
}

const app = await _electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  cwd: root,
})
const win = await app.firstWindow()
// Photograph at a realistic desktop size — the app's default window is
// narrower than the shell's comfortable width.
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => { w.setSize(1760, 990); w.center() })
} catch { /* best effort */ }
win.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})

try {
  // ── setup → team pick → shell ──
  await win.waitForSelector('text=Generate league', { timeout: 30000 })
  await snap(win, 'setup')
  await win.click('text=Generate league')
  await win.waitForSelector('.team-card', { timeout: 60000 })
  await snap(win, 'team-picker')
  await win.click('.team-card >> nth=0')
  // Picking a club simulates the entire year-zero season in the worker —
  // give it minutes. The shell appears at the start of the offseason.
  await win.waitForSelector('text=Continue', { timeout: 300000 })
  await snap(win, 'shell-first-load')

  // ── the dev-camp week: first Continue routes onto the rink ──
  try {
    await win.click('button:has-text("Continue")', { timeout: 5000 })
    await win.waitForSelector('text=Development Camp', { timeout: 8000 })
    await snap(win, 'devcamp-arrival')
    await win.click('button:has-text("Run the scrimmage")', { timeout: 5000 })
    await win.waitForTimeout(700)
    await snap(win, 'devcamp-scrimmage')
    await win.click('button:has-text("Hear the final reads")', { timeout: 5000 })
    await win.waitForTimeout(700)
    await snap(win, 'devcamp-wrap')
  } catch {
    console.log('  ⚠ dev camp flow not reachable — skipped')
  }

  // ── advance a few days so screens have real content ──
  for (let i = 0; i < 8; i++) {
    try {
      await win.click('button:has-text("Continue")', { timeout: 5000 })
      await win.waitForTimeout(600)
    } catch {
      break // a modal/meeting screen holds the button — fine, photograph as-is
    }
  }

  // ── walk the sidebar ──
  for (const [label, slug] of SIDEBAR_STOPS) {
    try {
      await win.click(`text="${label}"`, { timeout: 4000 })
      await win.waitForTimeout(500)
      await snap(win, slug)
    } catch {
      console.log(`  ⚠ could not open "${label}" — skipped`)
    }
  }

  // The Feed subtab, if visible.
  try {
    await win.click('text="Inbox"', { timeout: 4000 })
    await win.waitForTimeout(300)
    await win.click('text="The Feed"', { timeout: 4000 })
    await win.waitForTimeout(500)
    await snap(win, 'feed')
  } catch {
    console.log('  ⚠ feed subtab not reachable — skipped')
  }
} finally {
  writeFileSync(join(outDir, 'console-errors.txt'), consoleErrors.join('\n') || '(none)')
  console.log(`\n${shot} screenshots → ${outDir}`)
  console.log(`console errors: ${consoleErrors.length} (see console-errors.txt)`)
  await app.close()
}
