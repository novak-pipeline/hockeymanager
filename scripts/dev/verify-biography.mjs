/**
 * Verify the career biography (A1) in the REAL app.
 *
 * Launches the built Electron app with Playwright, starts a career, opens a
 * player profile's History tab and the Staff (Personnel) tab, and screenshots
 * both — plus dumps the prose to stdout so the writing can be READ rather than
 * squinted at in a screenshot. Reading it is the point: this feature's bug class
 * is a sentence that is repetitive or untrue, and neither shows up as a diff.
 *
 * KNOWN LIMIT: the offseason gauntlet (development camp, draft, free agency,
 * training camp) is a chain of beat gates that this script does not answer, so a
 * run stops in the offseason of year zero. That is enough to prove PLACEMENT and
 * RENDERING, and it is enough for staff (whose sketches do not depend on the
 * calendar), but a vanilla league at day zero has no career history, so the
 * player biography it shows is the deliberately-thin honest one. For rich player
 * prose, read biography.test.ts or drive a Career instance directly.
 *
 * Usage:  npm run build && node scripts/dev/verify-biography.mjs [outDir]
 *         BIO_ADVANCES=n  how many Continue presses to attempt (default 45)
 */
import { _electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = process.argv[2] ?? join(root, 'scripts', 'dev', 'ui-snaps')
mkdirSync(outDir, { recursive: true })

const app = await _electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root })
const win = await app.firstWindow()
const errors = []
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => {
    const { screen } = require('electron')
    const primary = screen.getPrimaryDisplay()
    const other = screen.getAllDisplays().find((d) => d.id !== primary.id)
    w.setSize(1760, 990)
    const t = other
      ? { x: other.bounds.x + 40, y: other.bounds.y + 40 }
      : { x: primary.bounds.x + primary.bounds.width + 60, y: primary.bounds.y + 40 }
    w.setPosition(Math.round(t.x), Math.round(t.y))
  })
} catch { /* best effort */ }

/** Close whatever modal/overlay is sitting on top, if any. */
async function dismiss() {
  for (let i = 0; i < 6; i++) {
    try { await win.keyboard.press('Escape') } catch { /* ignore */ }
    await win.waitForTimeout(120)
  }
}

try {
  await win.waitForSelector('text=Generate league', { timeout: 30000 })
  try { await win.fill('#seed-input', process.env.UI_SNAP_SEED ?? '424242', { timeout: 4000 }) } catch { /* ignore */ }
  await win.click('text=Generate league')
  await win.waitForSelector('.team-card', { timeout: 60000 })
  await win.click('.team-card >> nth=0')
  await win.waitForSelector('text=Continue', { timeout: 300000 })
  await dismiss()

  // Push into the regular season so a man has games behind him — the biography
  // at day zero of a fictional league is honestly near-empty, which proves the
  // discipline but not the writing.
  // The Continue button RENAMES itself to whatever beat gate is pending
  // (continueLabel), so match it by class, never by the word "Continue".
  const CONTINUE = 'button.btn-primary.btn-lg'
  const advances = Number(process.env.BIO_ADVANCES ?? 45)
  for (let i = 0; i < advances; i++) {
    // Beat gates route you to a screen and block until answered; take the
    // delegate escape wherever one is offered. Never press Escape here — it
    // cancels the gate screen and the same gate simply blocks again.
    for (const escape of [
      'text="Let the coach name him"',
      'text=/Let the AGM/',
      'text=/Let the Head of Scouting/',
      'text=/Let the coach/',
      'text=/^Delegate/',
    ]) {
      await win.click(escape, { timeout: 300 }).catch(() => {})
    }
    try {
      await win.click(CONTINUE, { timeout: 8000 })
      await win.waitForTimeout(500)
    } catch { break }
    if (i % 15 === 0) {
      const date = await win.$eval('.topbar-date, header', (e) => e.textContent?.slice(0, 60) ?? '').catch(() => '')
      console.log(`  advance ${i}: ${date.replace(/\s+/g, ' ').trim()}`)
    }
  }
  await win.waitForTimeout(1500)

  // ── a player's History tab ──
  await win.click('text="Roster"', { timeout: 8000 })
  await win.waitForTimeout(500)
  await win.click('.player-link >> nth=0', { timeout: 8000 })
  await win.waitForTimeout(800)
  await win.click('.tab:has-text("History")', { timeout: 8000 })
  await win.waitForTimeout(600)
  await win.screenshot({ path: join(outDir, 'bio-player-history.png') })

  const bio = await win.evaluate(() => {
    const panels = [...document.querySelectorAll('.panel, section, div')]
    const head = panels.find((p) => /^\s*Career\s*$/.test(
      p.querySelector('.panel-title, h2, h3')?.textContent?.trim() ?? ''
    ))
    if (!head) return null
    return [...head.querySelectorAll('p')].map((p) => p.textContent?.trim() ?? '')
  })
  console.log('\n=== PLAYER BIOGRAPHY (History tab) ===')
  console.log(bio ? bio.join('\n\n') : '!! no Career panel found on the History tab')

  // ── a staff member's sketch on the Personnel (Staff) tab ──
  await win.click('text="Staff"', { timeout: 8000 }).catch(() => {})
  await win.waitForTimeout(800)
  // Expand each staff row until one reveals prose.
  const rows = await win.$$('button:has(img), button:has(.muted.small)')
  for (const r of rows.slice(0, 8)) {
    try { await r.click({ timeout: 2000 }); await win.waitForTimeout(200) } catch { /* ignore */ }
  }
  await win.waitForTimeout(500)
  await win.screenshot({ path: join(outDir, 'bio-staff-personnel.png') })
  const staffText = await win.evaluate(() => {
    const h = [...document.querySelectorAll('h2, h3, .screen-title')]
      .map((e) => e.textContent?.trim()).filter(Boolean).join(' | ')
    return h + '\n----\n' + document.body.innerText.slice(0, 3500)
  })
  console.log('\n=== PERSONNEL TAB TEXT ===')
  console.log(staffText)
} catch (e) {
  console.error('verify failed:', e.message)
  try { await win.screenshot({ path: join(outDir, 'bio-failure.png') }) } catch { /* ignore */ }
} finally {
  if (errors.length) {
    console.log('\n=== CONSOLE ERRORS ===')
    for (const e of errors.slice(0, 20)) console.log('  ' + e)
  }
  await app.close()
}
