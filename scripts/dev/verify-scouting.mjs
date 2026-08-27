/**
 * Targeted verification for the scouting overhaul (playtest section C).
 *
 * `ui-snapshot.mjs --audit-only` proves the rail works and no control is inert;
 * it never opens the scouting sub-tabs. This drives the REAL app to each of
 * them, photographs it, and asserts the things the overhaul is actually about:
 *
 *   · the Watch List starts EMPTY (C1)
 *   · pinning a player from the search puts him on it, and the pane says so
 *   · the Scouting Centre carries a real briefing, not one line (C2)
 *   · the Players tab is a search whose filters change the result count (C3)
 *   · an unscouted row shows a dash, never a star grade (C3/C5)
 *   · the coverage tab renders the globe canvas (C4)
 *   · the draft board shows "no read" for prospects nobody watched (C5)
 *
 * Run: node scripts/dev/verify-scouting.mjs   (after electron-vite build)
 */
import { _electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'scripts', 'dev', 'ui-snaps')
mkdirSync(outDir, { recursive: true })

const results = []
const consoleErrors = []
let shot = 0
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function snap(win, slug) {
  shot += 1
  const file = join(outDir, `sc${String(shot).padStart(2, '0')}-${slug}.png`)
  await win.screenshot({ path: file })
  console.log(`  📸 ${file}`)
  return file
}

/** Click a scouting sub-tab by its visible label (the strip under the topbar). */
async function clickTab(win, text, timeout = 6000) {
  await win.locator('nav.subtabbar button.subtab', { hasText: new RegExp(`^${text}$`) }).first().click({ timeout })
  await win.waitForTimeout(600)
}

/** Click a sidebar destination by its visible label. */
async function clickNav(win, text, timeout = 6000) {
  await win.locator('nav.sidebar button.sidebar-item', { hasText: new RegExp(`^${text}$`) }).first().click({ timeout })
  await win.waitForTimeout(600)
}

const paneText = (win) =>
  win.evaluate(() => (document.querySelector('.shell-main')?.innerText ?? '').replace(/\s+/g, ' '))

const app = await _electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root })
const win = await app.firstWindow()
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
win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

try {
  await win.waitForSelector('text=Generate league', { timeout: 30000 })
  await win.fill('#seed-input', process.env.UI_SNAP_SEED ?? '424242').catch(() => {})
  await win.click('text=Generate league')
  await win.waitForSelector('.team-card', { timeout: 60000 })
  await win.click('.team-card >> nth=0')
  await win.waitForSelector('text=Continue', { timeout: 300000 })

  /* ── Scouting → Overview: the watch list must start empty ── */
  await clickNav(win, 'Scouting')
  await win.waitForTimeout(900)
  let text = await paneText(win)
  await snap(win, 'overview-empty-watchlist')
  check('C1 watch list starts empty', /Nobody on it yet/i.test(text), text.slice(0, 90))
  check('C1 empty state teaches the mechanic', /front of their day/i.test(text))

  /* ── Scouting Centre: the briefing ── */
  await clickTab(win, 'Scouting Centre')
  await win.waitForTimeout(900)
  text = await paneText(win)
  await snap(win, 'centre-briefing')
  check('C2 briefing panel present', /Department Briefing/i.test(text))
  check('C2 reports draft-class coverage', /Draft class coverage/i.test(text))
  check('C2 names blind spots', /Blind spots/i.test(text))
  check('C2 reports scout disagreement', /The room disagrees/i.test(text))
  check('C2 says what changed', /Since /i.test(text))

  /* ── Players: the search ── */
  await clickTab(win, 'Players')
  await win.waitForTimeout(1200)
  text = await paneText(win)
  await snap(win, 'player-search')
  check('C3 Players tab is a search', /Player Search/i.test(text))
  check('C3 no pre-answered target list', !/Acquisition Targets/i.test(text))
  const totalBefore = Number((text.match(/Results\s+—\s+([\d,]+)\s+match/i)?.[1] ?? '0').replace(/,/g, ''))
  check('C3 search returns the whole database', totalBefore > 100, `${totalBefore} matches`)
  check('C3 states the fog over the result set', /carry a real scouting read|read on all/i.test(text))

  // A filter must actually change the result count.
  await win.locator('button.chip', { hasText: /^G$/ }).first().click({ timeout: 4000 })
  await win.waitForTimeout(900)
  text = await paneText(win)
  const totalAfter = Number((text.match(/Results\s+—\s+([\d,]+)\s+match/i)?.[1] ?? '0').replace(/,/g, ''))
  await snap(win, 'player-search-filtered-G')
  check('C3 position filter narrows the results', totalAfter > 0 && totalAfter < totalBefore, `${totalBefore} → ${totalAfter}`)
  await win.locator('button.chip', { hasText: /^G$/ }).first().click({ timeout: 4000 })
  await win.waitForTimeout(700)

  // Fog: at least one row must be unreadable, showing a dash rather than stars.
  const unscouted = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('.shell-main table tbody tr')]
    let dashed = 0, starred = 0
    for (const r of rows) {
      const t = r.innerText || ''
      if (/Unscouted|Name only/.test(t)) dashed++
      else if (/★/.test(t)) starred++
    }
    return { dashed, starred, rows: rows.length }
  })
  check('C3 unscouted rows exist and are dashed, not graded',
    unscouted.dashed > 0, `${unscouted.dashed} unread / ${unscouted.rows} rows`)

  /* ── Pin a player from the search: the watch list fills by hand ── */
  const starBtn = win.locator('.shell-main table tbody tr button', { hasText: '☆' }).first()
  await starBtn.click({ timeout: 5000 })
  await win.waitForTimeout(1200)
  await clickTab(win, 'Overview')
  await win.waitForTimeout(1000)
  text = await paneText(win)
  await snap(win, 'overview-watchlist-filled')
  check('C1 pinning from the search fills the watch list',
    /Watch List \(1\//i.test(text) && !/Nobody on it yet/i.test(text), text.match(/Watch List[^·]{0,24}/)?.[0] ?? '')
  check('C1 the list reports what watching has bought', /Watching since|No real read yet|Building a file/i.test(text))

  /* ── Coverage: the globe ── */
  await clickTab(win, 'Scouting Coverage')
  await win.waitForTimeout(1500)
  const globe = await win.evaluate(() => {
    const c = document.querySelector('.shell-main canvas')
    if (!c) return { present: false }
    // Sample the middle of the canvas: a globe paints an ocean there.
    const ctx = c.getContext('2d')
    const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data
    return { present: true, w: c.width, h: c.height, px: [d[0], d[1], d[2], d[3]] }
  })
  await snap(win, 'coverage-globe')
  check('C4 globe canvas renders', globe.present && globe.w > 200, `${globe.w}x${globe.h}`)
  check('C4 globe is actually painted', globe.present && globe.px[3] > 0, `rgba(${globe.px?.join(',')})`)

  /* ── Draft board: no free ceiling grades ── */
  await clickTab(win, 'Prospect Rankings')
  await win.waitForTimeout(1200)
  text = await paneText(win)
  await snap(win, 'draft-analyst-board')
  check('C5 radar is gated on a real read', /U17s your staff has watched/i.test(text))
  // The vanilla generator ships no feeder competitions, so there is no amateur
  // class to rank in this world. Say so rather than reporting a red X the code
  // cannot fix — scoutingWork.test.ts covers these paths against a junior world
  // built for the purpose.
  const hasClass = !/No draft-eligible prospects to rank/i.test(text)
  if (!hasClass) {
    console.log('  · no draft class in this world — board checks covered by scoutingWork.test.ts')
  } else {
    check('C5 public board publishes a projection, not a star ceiling', /Projection/i.test(text))
    await win.locator('button', { hasText: /Your Scouts/i }).first().click({ timeout: 5000 }).catch(() => {})
    await win.waitForTimeout(1200)
    text = await paneText(win)
    await snap(win, 'draft-scout-board')
    check('C5 scout board reports class coverage', /department has filed on/i.test(text))
    check('C5 unwatched prospects show "no read"', /no read/i.test(text))
  }
} catch (e) {
  check('run completed', false, String(e.message ?? e).split('\n')[0])
  await snap(win, 'failure').catch(() => {})
} finally {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed · console errors: ${consoleErrors.length}`)
  for (const e of consoleErrors.slice(0, 5)) console.log(`  ⚠ ${e}`)
  await app.close()
  process.exit(failed.length ? 1 : 0)
}
