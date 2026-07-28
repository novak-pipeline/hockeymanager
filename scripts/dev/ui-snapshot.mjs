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
  ['Roster Planner', 'roster-planner'],
  ['Dynamics', 'dynamics'],
  ['Tactics', 'tactics'],
  ['Training', 'training'],
  ['Data Hub', 'datahub'],
  ['Medical Center', 'medical'],
  ['Dev. Center', 'dev-center'],
  ['Schedule', 'calendar'],
  ['Competitions', 'league'],
  ['Scouting', 'scouting'],
  ['Transfers', 'transfers'],
  ['Finances', 'finances'],
]

const consoleErrors = []
let shot = 0

/** Advance the game by one step, tolerating whichever gate is up (a plain
 *  Continue, a staff/board meeting that must be delegated, a deadline hold, …).
 *  Returns true if something was clicked. */
async function advanceOnce(win) {
  // Gate-screen resolvers FIRST — the dashboard "Continue" only *routes into* a
  // gate (camp, board meeting), so if we're already on a gate screen we must click
  // its own button. Then the generic advance. Exact labels from the renderer.
  for (const sel of [
    'button:has-text("set the roster")',      // cut day: coach sets the 23
    'button:has-text("Break camp")',
    'button:has-text("To opening night")',
    'button:has-text("opening night")',
    'button:has-text("Send the AGM")',        // preseason board meeting: delegate
    'button:has-text("Run the scrimmage")',   // dev-camp beats
    'button:has-text("Hear the final reads")',
    'button:has-text("Send the staff")',
    'button:has-text("Delegate")',
    'button:has-text("Continue")',            // dashboard advance / route into a gate
    'button:has-text("Sim day")',             // topbar fallback
    'button:has-text("Proceed")',
    'button:has-text("Skip")',
    'button:has-text("Dismiss")',
  ]) {
    try { await win.click(sel, { timeout: 1200 }); return true } catch { /* try next */ }
  }
  return false
}

/** Read the user club's games-played from the topbar record ("12-8-3 · …"). */
async function gamesPlayed(win) {
  return win
    .evaluate(() => {
      const m = document.body.innerText.match(/\b(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\b/)
      return m ? Number(m[1]) + Number(m[2]) + Number(m[3]) : 0
    })
    .catch(() => 0)
}

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
// Photograph at a realistic desktop size, and keep the window OFF the user's
// main monitor: put it on a secondary display if one exists, else nudge it
// just past the primary's edge (off-screen). Playwright captures via the
// DevTools protocol, so an off-screen window still screenshots correctly.
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { screen } = require('electron')
    const primary = screen.getPrimaryDisplay()
    const other = screen.getAllDisplays().find((d) => d.id !== primary.id)
    w.setSize(1760, 990)
    const target = other
      ? { x: other.bounds.x + 40, y: other.bounds.y + 40 } // a real secondary monitor
      : { x: primary.bounds.x + primary.bounds.width + 60, y: primary.bounds.y + 40 } // just off the primary's right edge
    w.setPosition(Math.round(target.x), Math.round(target.y))
  })
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
    // #182 invite editor — open it on arrival day and photograph the two lists.
    try {
      await win.click('button:has-text("Manage invites")', { timeout: 4000 })
      await win.waitForTimeout(500)
      await snap(win, 'devcamp-invites')
      await win.click('button:has-text("Done with invites")', { timeout: 4000 })
      await win.waitForTimeout(300)
    } catch { /* editor not reachable — fine */ }
    await win.click('button:has-text("Run the scrimmage")', { timeout: 5000 })
    await win.waitForTimeout(700)
    await snap(win, 'devcamp-scrimmage')
    await win.click('button:has-text("Hear the final reads")', { timeout: 5000 })
    await win.waitForTimeout(700)
    await snap(win, 'devcamp-wrap')
  } catch {
    console.log('  ⚠ dev camp flow not reachable — skipped')
  }

  // ── the summer calendar (playtest #3): photograph Schedule right after the
  //    dev-camp beat so the Development Camp key-date can be checked against
  //    when the camp actually ran. ──
  try {
    await win.click('text="Schedule"', { timeout: 4000 })
    await win.waitForTimeout(600)
    await snap(win, 'offseason-calendar')
    await win.click('text="Home"', { timeout: 4000 })
    await win.waitForTimeout(400)
  } catch {
    console.log('  ⚠ offseason calendar not reachable — skipped')
  }

  // ── advance into early free agency (the frenzy window, days 1–3) ──
  for (let i = 0; i < 3; i++) {
    try {
      await win.click('button:has-text("Continue")', { timeout: 5000 })
      await win.waitForTimeout(600)
    } catch {
      break // a modal/meeting screen holds the button — fine, photograph as-is
    }
  }

  // ── the negotiation room: open talks while the market is still stocked ──
  try {
    // The offseason desk = the League screen's Offseason tab.
    await win.click('text="Competitions"', { timeout: 4000 })
    await win.waitForTimeout(500)
    // "Offseason" also appears as the topbar phase chip — click the TAB (last match).
    await win.click(':nth-match(:text("Offseason"), 2)', { timeout: 4000 })
    await win.waitForTimeout(500)
    await snap(win, 'offseason-desk')
    // The market is its own sidebar tab now — the desk links to it.
    await win.click('text="Free Agents"', { timeout: 4000 })
    await win.waitForTimeout(600)
    await snap(win, 'fa-market')
    // #164: table a standing offer at his ask, then photograph the standing-offers
    // board (leading/contested/trailing read) at the top of the screen.
    try {
      await win.click('button:has-text("Table offer (his ask)")', { timeout: 4000 })
      await win.waitForTimeout(700)
      await snap(win, 'fa-standing-offers')
    } catch { /* no tableable row (market thin) — skip */ }
    await win.click('button:has-text("Open talks")', { timeout: 5000 })
    await win.waitForSelector('text=Contract talks', { timeout: 8000 })
    await snap(win, 'negotiation-open')
    // Table a real offer: use whatever the builder pre-seeded and submit.
    await win.click('button:has-text("Table the offer")', { timeout: 5000 })
    await win.waitForTimeout(900)
    await snap(win, 'negotiation-round')
  } catch (e) {
    console.log(`  ⚠ negotiation room not reachable — skipped (${e.message?.split('\n')[0]})`)
  }

  // ── advance a few more days so the rest of the screens have content ──
  for (let i = 0; i < 5; i++) {
    try {
      await win.click('button:has-text("Continue")', { timeout: 5000 })
      await win.waitForTimeout(600)
    } catch {
      break
    }
  }

  // ── drive to training camp (Sept) and photograph its beat-by-beat week ──
  try {
    let reached = false
    for (let i = 0; i < 80 && !reached; i++) {
      await win.click('button:has-text("Continue")', { timeout: 6000 })
      await win.waitForTimeout(400)
      // Camp gate routes onto the camp screen; detect its header.
      reached = await win.locator('text=Camp is on the ice').count().then((n) => n > 0).catch(() => false)
      // A dev-camp beat may intercept — its Continue keeps the loop moving.
    }
    if (reached) {
      // Day 1 (camp opens): overview + the empty/early tabs.
      await snap(win, 'camp-day1-overview')
      for (const [tab, slug] of [['Camp Schedule', 'camp-schedule'], ['Scrimmage Stats', 'camp-scrimmage-empty'], ['Coach Reports', 'camp-reports-early']]) {
        try {
          await win.click(`button:has-text("${tab}")`, { timeout: 4000 })
          await win.waitForTimeout(300)
          await snap(win, slug)
        } catch { /* tab missing — skip */ }
      }
      // Walk the week day by day via the in-screen advance button.
      for (let d = 0; d < 8; d++) {
        const atCut = await win.locator('button:has-text("set the roster")').count().then((n) => n > 0).catch(() => false)
        if (atCut) break
        try {
          await win.click('button:has-text("Advance to Day")', { timeout: 4000 })
          await win.waitForTimeout(400)
        } catch { break }
      }
      // Mid/late-week: the box score + reports have filled in.
      try { await win.click('button:has-text("Scrimmage Stats")', { timeout: 4000 }); await win.waitForTimeout(300); await snap(win, 'camp-scrimmage-filled') } catch {}
      try { await win.click('button:has-text("Coach Reports")', { timeout: 4000 }); await win.waitForTimeout(300); await snap(win, 'camp-reports-filed') } catch {}
      // Cut day: the roster calls are live.
      try {
        await win.click('button:has-text("Cut Day")', { timeout: 3000 })
        await win.waitForTimeout(300)
        await snap(win, 'camp-cutday')
        await win.click('button:has-text("Break camp")', { timeout: 4000 })
        await win.waitForTimeout(500)
        await win.click('button:has-text("opening night")', { timeout: 4000 })
        await win.waitForTimeout(400)
      } catch { /* leave as-is */ }
      // Playtest #5: the NEXT Continue after camp breaks should be the preseason
      // board meeting on its OWN day (Sep 23) — photograph the boardroom.
      try {
        await win.click('button:has-text("Continue")', { timeout: 4000 })
        await win.waitForSelector('button:has-text("Send the AGM")', { timeout: 6000 })
        await snap(win, 'board-meeting')
      } catch {
        console.log('  ⚠ board meeting after camp not reached — check beat order')
      }
    } else {
      console.log('  ⚠ training camp not reached in 80 presses — skipped')
    }
  } catch (e) {
    console.log(`  ⚠ training camp not reachable — skipped (${e.message?.split('\n')[0]})`)
  }

  // ── sim ~40 regular-season match days so the management screens carry a rich
  //    MID-SEASON state (real standings, stats, injuries, story arcs). This is
  //    where UI/logic bugs actually surface — the day-1 opening-night state is
  //    mostly empty. ──
  try {
    let last = -1
    let stalls = 0
    let started = false // preseason legitimately has gp=0 for days — only treat a
                        // no-progress streak as a wedge AFTER the season has begun.
    for (let i = 0; i < 200; i++) {
      const gp = await gamesPlayed(win)
      if (gp >= 40) break
      if (gp > 0) started = true
      if (started) { if (gp === last) stalls += 1; else stalls = 0 }
      last = gp
      if (started && stalls >= 8) break // wedged mid-season — stop trying
      if (!(await advanceOnce(win))) { await win.waitForTimeout(400); if (!(await advanceOnce(win))) break }
      await win.waitForTimeout(280)
    }
    await snap(win, 'midseason-dashboard')
    console.log(`  ▶ mid-season reached at ~${await gamesPlayed(win)} GP`)
  } catch (e) {
    console.log(`  ⚠ mid-season advance incomplete — ${e.message?.split('\n')[0]}`)
  }

  // ── walk the sidebar ──
  // The FM-style processing overlay is modal and sits over the sidebar; dismiss
  // any open one first (it only appears now on eventful days) so the nav clicks
  // aren't swallowed by the backdrop.
  const dismissOverlay = async () => {
    for (let i = 0; i < 4; i++) {
      const close = win.locator('button:has-text("Close")')
      if (await close.count().catch(() => 0)) {
        await close.first().click({ timeout: 1500 }).catch(() => {})
        await win.waitForTimeout(200)
      } else break
    }
  }
  await dismissOverlay()
  for (const [label, slug] of SIDEBAR_STOPS) {
    try {
      await dismissOverlay()
      await win.click(`text="${label}"`, { timeout: 4000 })
      await win.waitForTimeout(500)
      await snap(win, slug)
      // On the trade centre, also photograph the Build-a-Trade tab (partner
      // dropdown + asset lists) and the Trade Block tab.
      if (slug === 'transfers') {
        try {
          await win.click('button:has-text("Build a Trade")', { timeout: 3000 })
          await win.waitForTimeout(400)
          await snap(win, 'trades-build')
          await win.click('button:has-text("Trade Block")', { timeout: 3000 })
          await win.waitForTimeout(400)
          await snap(win, 'trades-block')
        } catch { /* tabs not present (deadline passed) — skip */ }
      }
      // On the Roster Planner, also photograph the Roles tab (bulk squad-status
      // board — auto-assigns on first open).
      if (slug === 'roster-planner') {
        try {
          await win.click('button:has-text("Roles")', { timeout: 3000 })
          await win.waitForTimeout(700)
          await snap(win, 'roster-planner-roles')
        } catch { /* tab not present — skip */ }
      }
    } catch {
      console.log(`  ⚠ could not open "${label}" — skipped`)
    }
  }

  // A player profile — opens the first roster player (captures the Deployment
  // panel, #73). Roster is a sidebar stop already photographed above.
  try {
    await win.click('text="Roster"', { timeout: 4000 })
    await win.waitForTimeout(300)
    await win.click('.player-link >> nth=0', { timeout: 4000 })
    await win.waitForTimeout(600)
    await snap(win, 'player-profile')
    // Scroll every scrollable container down so the Deployment panel (#73),
    // which sits lower in the left column, comes into frame.
    await win.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = 900
      }
    })
    await win.waitForTimeout(250)
    await win.screenshot({ path: join(outDir, 'player-profile-deployment.png') })
  } catch {
    console.log('  ⚠ player profile not reachable — skipped')
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

  // The World → International tab (#48/P5 — World Juniors panel when a
  // nationality-bearing DB is loaded; empty-state on the fictional default).
  try {
    await win.click('text="World"', { timeout: 4000 })
    await win.waitForTimeout(300)
    await win.click('button:has-text("International")', { timeout: 4000 })
    await win.waitForTimeout(500)
    await snap(win, 'world-international')
  } catch {
    console.log('  ⚠ world international not reachable — skipped')
  }

  // Settings — captures the local-AI-Feed-writer panel (#149, opt-in state).
  try {
    await win.click('button[aria-label="Settings"]', { timeout: 4000 })
    await win.waitForTimeout(400)
    await win.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = 1400 })
    await win.waitForTimeout(200)
    await win.screenshot({ path: join(outDir, 'settings-feed-writer.png') })
    await snap(win, 'settings')
  } catch {
    console.log('  ⚠ settings not reachable — skipped')
  }

  // The Media Circuit subtab under GM Career (#90 — pundit relationships).
  try {
    await win.click('text="GM Career"', { timeout: 4000 })
    await win.waitForTimeout(300)
    await win.click('button:has-text("Media")', { timeout: 4000 })
    await win.waitForTimeout(500)
    await snap(win, 'media-circuit')
  } catch {
    console.log('  ⚠ media circuit not reachable — skipped')
  }

} finally {
  writeFileSync(join(outDir, 'console-errors.txt'), consoleErrors.join('\n') || '(none)')
  console.log(`\n${shot} screenshots → ${outDir}`)
  console.log(`console errors: ${consoleErrors.length} (see console-errors.txt)`)
  await app.close()
}
