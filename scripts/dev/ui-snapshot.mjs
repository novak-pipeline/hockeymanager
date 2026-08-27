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
import { auditNav, auditControls, formatFindings } from './ui-audit.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const outDir = argv[0] ?? join(root, 'scripts', 'dev', 'ui-snaps')
mkdirSync(outDir, { recursive: true })

/**
 * `--audit-only` (npm run ui:audit) skips the long season walk and runs only the
 * interaction audit (nav + controls) right after the shell loads. That is the
 * fast gate — minutes instead of an hour — and it is the one that catches dead
 * controls, so it should be cheap enough to run on every UI change. A plain flag
 * rather than an env var because npm scripts run through cmd.exe on Windows,
 * where `VAR=1 node …` is not a thing.
 */
const AUDIT_ONLY = process.argv.includes('--audit-only') || process.env.UI_SNAP_AUDIT_ONLY === '1'
/** Every interaction finding from every audit pass, written to ui-audit.txt. */
const auditFindings = []
/** Coverage, reported alongside the findings: a run that examined nothing and a
 *  run that found nothing look identical without this. */
const auditCounters = { navVisited: 0, hitTested: 0, exercised: 0 }

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

/**
 * Buttons that move the game on, most-specific first. ORDER MATTERS twice over:
 *
 *  1. The processing overlay is MODAL — while it's open its backdrop swallows
 *     every click aimed at the topbar Continue, so Playwright times out on the
 *     actionability check. (That is what used to wedge this harness in free
 *     agency at ~day 4 and stop it ever seeing a regular-season screen.) The
 *     overlay's own buttons therefore come first, targeted by aria-label so they
 *     are distinguishable from the topbar's identically-named Continue.
 *  2. Buttons that RESOLVE a gate must precede ones that merely navigate.
 *     "It's cut day — set the roster" only does setTab('cuts')
 *     (TrainingCampScreen.tsx:160), so trying it first made the walk click it
 *     forever and never leave camp. "Break camp with this roster" is the real
 *     resolver, and it only exists once that tab is open: resolve, then reveal.
 */
const ADVANCE_SELECTORS = [
  'button[aria-label="Play the game"]',            // P6 pregame match-day frame
  'button[aria-label="Continue to the next day"]', // processing overlay
  'button:has-text("Break camp")',                 // cut day: commit the 23 (RESOLVES)
  'button:has-text("To opening night")',
  'button:has-text("opening night")',
  'button:has-text("set the roster")',             // cut day: opens the cuts tab (nav only)
  'button:has-text("Send the AGM")',               // preseason board meeting: delegate
  'button:has-text("Run the scrimmage")',           // dev-camp beats
  'button:has-text("Hear the final reads")',
  'button:has-text("Send the staff")',
  'button:has-text("Delegate")',
  'button:has-text("Advance to Day")',             // camp week, in-screen day walk
  'button:has-text("Continue")',                   // dashboard advance / route into a gate
  'button:has-text("Sim day")',                    // topbar fallback
  'button:has-text("Proceed")',
  'button:has-text("Skip")',
  'button:has-text("Dismiss")',
]

/** Advance the game by one step, tolerating whichever gate is up (a plain
 *  Continue, a staff/board meeting that must be delegated, a deadline hold, …).
 *  Returns true if something was clicked.
 *
 *  PROBE, don't guess: `count()` resolves instantly, whereas a `click()` on a
 *  missing selector burns its whole timeout. Walking ~17 selectors by click cost
 *  ~14s on an ordinary dashboard day, which made a 200-day walk take hours and
 *  look like a hang. Find the present button first, then click only that one. */
async function advanceOnce(win) {
  for (const sel of ADVANCE_SELECTORS) {
    // Try EVERY match, last first. When the processing overlay holds an eventful
    // day the topbar "Continue — …" is match #0 but sits UNDER the modal
    // backdrop, so clicking it times out; the overlay's own button is a later
    // match. (That was the free-agency stall.) The selector ORDER above is the
    // other half: a gate's resolver must be tried before anything that merely
    // navigates, or the walk clicks the same tab forever.
    const loc = win.locator(sel)
    const count = Math.min(await loc.count().catch(() => 0), 3)
    for (let k = count - 1; k >= 0; k--) {
      const el = loc.nth(k)
      try {
        if (!(await el.isEnabled().catch(() => false))) continue
        await el.click({ timeout: 1200 })
        return true
      } catch { /* covered/detached — try the next match */ }
    }
  }
  return false
}

/** Close a held processing overlay WITHOUT advancing the day. `advanceOnce`
 *  presses its Continue, which rolls the clock forward; when the walk wants to
 *  photograph the screen underneath instead, it needs the Close button. */
async function dismissOverlay(win) {
  for (let i = 0; i < 4; i++) {
    const close = win.locator('button:has-text("Close")')
    if (await close.count().catch(() => 0)) {
      await close.first().click({ timeout: 1500 }).catch(() => {})
      await win.waitForTimeout(200)
    } else break
  }
}

/** Read the user club's games-played from the topbar record ("12–8–3 · …").
 *  NOTE: the topbar renders EN DASHES (U+2013), not hyphens — a hyphen-only
 *  regex silently returned 0 forever, which killed both the `gp >= 40` exit and
 *  the stall detection in the mid-season loop below (it reported "mid-season
 *  reached at ~0 GP" every run). Match either separator. */
async function gamesPlayed(win) {
  return win
    .evaluate(() => {
      const m = document.body.innerText.match(/\b(\d+)\s*[-–—]\s*(\d+)\s*[-–—]\s*(\d+)\b/)
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
  // ── title → new career → club pick → shell (F6 front door) ──
  await win.waitForSelector('.title-menu', { timeout: 30000 })
  await snap(win, 'title')
  // The save manager is a new surface with a real disk behind it (F6) — the
  // browser dev preview can only ever show its "no bridge" state, so this is
  // the only place it gets photographed with actual saves in it.
  try {
    await win.click('.title-item:has-text("Load career")', { timeout: 3000 })
    await win.waitForSelector('.savemgr', { timeout: 4000 })
    await snap(win, 'load-manager')
    await win.click('.savemgr .modal-close', { timeout: 3000 })
    await win.waitForTimeout(200)
  } catch {
    console.log('  ⚠ load manager not reachable (no saves on disk?) — skipped')
  }
  await win.click('.title-item:has-text("New career")')
  await win.waitForSelector('.setup-inner', { timeout: 15000 })
  // PIN THE WORLD SEED. The setup screen randomises it by default, so every run
  // produced a different league and the walk's outcome (does it wedge? does the
  // user club even play on the day we stop?) was a coin flip — which makes a
  // screenshot diff useless and a failure impossible to reproduce. Override with
  // UI_SNAP_SEED=<n> to photograph a different world.
  const seed = process.env.UI_SNAP_SEED ?? '424242'
  try {
    // The seed field lives behind a disclosure now — it is a knob, not a step.
    await win.click('.setup-seed-toggle', { timeout: 4000 })
    await win.fill('.setup-seed-row input', seed, { timeout: 4000 })
    console.log(`  ▶ world seed pinned to ${seed}`)
  } catch {
    console.log('  ⚠ could not pin the seed — this run is not reproducible')
  }
  await snap(win, 'setup')
  await win.click('text=Build the world')
  await win.waitForSelector('.club-card', { timeout: 60000 })
  await snap(win, 'team-picker')
  await win.click('.club-card >> nth=0')
  await win.click('.brief-cta')
  // Picking a club simulates the entire year-zero season in the worker —
  // give it minutes. The shell appears at the start of the offseason.
  await win.waitForSelector('text=Continue', { timeout: 300000 })
  await snap(win, 'shell-first-load')

  // …and the same manager in manage mode, where it can also write and delete.
  try {
    await win.click('.topnav-actions button:has-text("Saves")', { timeout: 4000 })
    await win.waitForSelector('.savemgr', { timeout: 4000 })
    await snap(win, 'save-manager')
    await win.click('.savemgr .modal-close', { timeout: 3000 })
    await win.waitForTimeout(200)
  } catch {
    console.log('  ⚠ save manager not reachable — skipped')
  }

  // ── INTERACTION AUDIT (runs before anything else touches the career) ──
  // The screenshot walk below proves screens LOOK right; this proves they can be
  // REACHED and their controls DO something. Both of the 2026-07-31 playtest's
  // worst bugs — every destination rendering the dashboard, and an inert Roster
  // dropdown — were invisible to a clean typecheck, 2264 green tests AND a full
  // screenshot run, because nothing ever clicked. This is that missing click.
  try {
    await dismissOverlay(win)
    const { findings, visited } = await auditNav(win)
    auditFindings.push(...findings)
    auditCounters.navVisited += visited.length
    console.log(`  ▶ nav audit: ${visited.length} destinations, ${findings.length} finding(s)`)
    for (const f of findings) console.log(`    ${f.severity === 'dead' ? '✗' : '·'} [${f.where}] ${f.what}`)
    // Then exercise the controls on each destination, one pass round the rail.
    const labels = await win
      .$$eval('nav.sidebar button.sidebar-item .sidebar-label', (els) => els.map((e) => e.textContent?.trim() ?? ''))
      .catch(() => [])
    for (let i = 0; i < labels.length; i++) {
      try {
        await dismissOverlay(win)
        await win.locator('nav.sidebar button.sidebar-item').nth(i).click({ timeout: 3000 })
        await win.waitForTimeout(400)
        const f = await auditControls(win, labels[i], { counters: auditCounters })
        auditFindings.push(...f)
        for (const x of f) console.log(`    · [${x.where}] ${x.control}: ${x.what}`)
      } catch { /* destination already reported dead by auditNav */ }
    }
    console.log(
      `  ▶ control audit: ${auditCounters.hitTested} controls hit-tested, ` +
      `${auditCounters.exercised} operated, ${auditFindings.length} finding(s)`,
    )
  } catch (e) {
    console.log(`  ⚠ interaction audit failed — ${String(e.message ?? e).split('\n')[0]}`)
  }
  if (AUDIT_ONLY) {
    console.log('  ▶ UI_SNAP_AUDIT_ONLY=1 — skipping the season walk')
    throw new Error('__audit_only_done__') // caught by the finally block below
  }

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
    if (!(await advanceOnce(win))) break // a modal/meeting holds it — photograph as-is
    await win.waitForTimeout(600)
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
    if (!(await advanceOnce(win))) break
    await win.waitForTimeout(600)
  }

  // ── drive to training camp (Sept) and photograph its beat-by-beat week ──
  try {
    let reached = false
    for (let i = 0; i < 120 && !reached; i++) {
      if (!(await advanceOnce(win))) { await win.waitForTimeout(400); if (!(await advanceOnce(win))) break }
      await win.waitForTimeout(400)
      // Camp gate routes onto the camp screen; detect its header.
      reached = await win.locator('text=Camp is on the ice').count().then((n) => n > 0).catch(() => false)
      // A dev-camp beat may intercept — its Continue keeps the loop moving.
    }
    if (reached) {
      // Day 1 (camp opens): overview + the empty/early tabs.
      await snap(win, 'camp-day1-overview')
      // Playtest #5: the September calendar should show camp week with Cut Day
      // and the board meeting on SEPARATE days.
      try {
        await win.click('text="Schedule"', { timeout: 4000 })
        await win.waitForTimeout(600)
        await snap(win, 'preseason-calendar')
        await win.click('text="Home"', { timeout: 4000 })
        await win.waitForTimeout(400)
        await advanceOnce(win) // back onto the camp screen
        await win.waitForTimeout(500)
      } catch { /* calendar detour failed — camp flow continues */ }
      for (const [tab, slug] of [['Camp Schedule', 'camp-schedule'], ['Scrimmage Stats', 'camp-scrimmage-empty'], ['Coach Reports', 'camp-reports-early']]) {
        try {
          await win.click(`button:has-text("${tab}")`, { timeout: 4000 })
          await win.waitForTimeout(300)
          await snap(win, slug)
        } catch { /* tab missing — skip */ }
      }
      // Walk the week day by day via the in-screen advance button. Bail on a
      // dead page rather than grinding out eight timeouts.
      for (let d = 0; d < 8; d++) {
        if (win.isClosed()) break
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
      // Cut day: the roster calls are live. NB "Cut Day" is an AMBIGUOUS
      // substring — it matches both the tab ("Cut Day (11)") and the header CTA
      // ("It's cut day — set the roster", :has-text is case-insensitive), which
      // tripped Playwright's strict mode and skipped this whole block. Anchor on
      // the tab's own shape instead.
      try {
        // Case-SENSITIVE regex on the "(n)" counter: the header CTA reads
        // "It's cut day — …" (lowercase, no counter) so it can't collide.
        await win.locator('button:text-matches("Cut Day \\\\(\\\\d+\\\\)")').first().click({ timeout: 3000 })
        await win.waitForTimeout(300)
        await snap(win, 'camp-cutday')
        await win.click('button:has-text("Break camp")', { timeout: 4000 })
        await win.waitForTimeout(500)
        await win.click('button:has-text("opening night")', { timeout: 4000 })
        await win.waitForTimeout(400)
      } catch (e) {
        console.log('  ⚠ cut-day block skipped: ' + String(e.message ?? e).slice(0, 120))
      }
      // Playtest #5: the NEXT Continue after camp breaks should be the preseason
      // board meeting on its OWN day (Sep 23) — photograph the boardroom.
      try {
        await advanceOnce(win)
        await win.waitForSelector('button:has-text("Send the AGM")', { timeout: 6000 })
        await snap(win, 'board-meeting')
      } catch {
        console.log('  ⚠ board meeting after camp not reached — check beat order')
      }
    } else {
      console.log('  ⚠ training camp not reached in 120 presses — skipped')
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
    // The scouting department needs WEEKS of coverage before finds cross the
    // discovery threshold, so the Centre isn't photographed on an empty board.
    // "+7d" advances a week per click — far fewer clicks than day-by-day.
    for (let w = 0; w < 8; w++) {
      await dismissOverlay(win)
      try { await win.click('button:has-text("+7d")', { timeout: 3000 }) } catch { break }
      await win.waitForTimeout(1200)
    }
    await dismissOverlay(win)
    await snap(win, 'midseason-dashboard')
    console.log(`  ▶ mid-season reached at ~${await gamesPlayed(win)} GP`)
  } catch (e) {
    console.log(`  ⚠ mid-season advance incomplete — ${e.message?.split('\n')[0]}`)
  }

  // ── P6 match night: photograph the pregame match-day frame and, one press
  //    later, the postgame receipts. Both live in the processing overlay, so
  //    press Continue until the frame's own button ("play the game") appears. ──
  try {
    let atPregame = false
    for (let i = 0; i < 12 && !atPregame; i++) {
      atPregame = await win
        .locator('button:has-text("play the game")')
        .count()
        .then((n) => n > 0)
        .catch(() => false)
      if (atPregame) break
      if (!(await advanceOnce(win))) break
      await win.waitForTimeout(350)
    }
    if (atPregame) {
      await snap(win, 'matchday-pregame')
      await win.click('button:has-text("play the game")', { timeout: 5000 })
      await win.waitForTimeout(1200)
      await snap(win, 'matchday-postgame')
    } else {
      console.log('  ⚠ match-day frame not reached — skipped')
    }
  } catch (e) {
    console.log(`  ⚠ match night frames not reachable — skipped (${e.message?.split('\n')[0]})`)
  }

  // ── walk the sidebar ──
  // The FM-style processing overlay is modal and sits over the sidebar; dismiss
  // any open one first (it only appears now on eventful days) so the nav clicks
  // aren't swallowed by the backdrop.
  await dismissOverlay(win)
  for (const [label, slug] of SIDEBAR_STOPS) {
    try {
      await dismissOverlay(win)
      await win.click(`text="${label}"`, { timeout: 4000 })
      await win.waitForTimeout(500)
      await snap(win, slug)
      // Second control pass, now with a MID-SEASON state behind it. The offseason
      // pass above walks mostly-empty screens; a control that only appears once
      // there are standings, stats and injuries to switch between is audited here.
      auditFindings.push(...(await auditControls(win, `${label} (mid-season)`, { counters: auditCounters })))
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
      // On Scouting, also photograph the Centre (triage cards now carry the
      // scout's pros/cons + squad-fit notes, and the stack has an end state — #17).
      if (slug === 'scouting') {
        try {
          await win.locator('text="Scouting Centre"').first().click({ timeout: 3000 })
          await win.waitForTimeout(600)
          await snap(win, 'scouting-centre')
        } catch { /* subnav not present — skip */ }
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

} catch (e) {
  // The audit-only short-circuit unwinds through here; anything else is real.
  if (String(e?.message) !== '__audit_only_done__') throw e
} finally {
  writeFileSync(join(outDir, 'console-errors.txt'), consoleErrors.join('\n') || '(none)')
  writeFileSync(join(outDir, 'ui-audit.txt'), formatFindings(auditFindings, auditCounters))
  console.log(`\n${shot} screenshots → ${outDir}`)
  console.log(`console errors: ${consoleErrors.length} (see console-errors.txt)`)
  const dead = auditFindings.filter((f) => f.severity === 'dead').length
  console.log(
    `interaction findings: ${auditFindings.length} (${dead} DEAD) — see ui-audit.txt
` +
    `coverage: ${auditCounters.navVisited} destinations, ${auditCounters.hitTested} controls hit-tested, ` +
    `${auditCounters.exercised} operated`,
  )
  // Zero coverage means the audit proved nothing, which must not read as a pass.
  if (auditCounters.exercised === 0 || auditCounters.navVisited === 0) {
    console.log('⚠ the interaction audit examined nothing — treat this run as INCONCLUSIVE, not clean')
    process.exitCode = 1
  }
  await app.close()
  // A dead destination is a ship-blocker, so make it fail the run rather than
  // sit in a log nobody opens. This is the gate the nav bug walked through.
  if (dead > 0) process.exitCode = 1
}
