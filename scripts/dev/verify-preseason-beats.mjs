/**
 * Focused app verification for playtest #5: cut day and the preseason board
 * meeting must resolve on DIFFERENT days, in order.
 *
 * Drives the real Electron build through a fresh career to the pre-opening
 * stretch, then walks the gates one press at a time, recording the topbar date
 * and which beat is on screen after each press.
 *
 *   node scripts/dev/verify-preseason-beats.mjs [outDir]
 */
import { _electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = process.argv[2] ?? join(root, 'scripts', 'dev', 'preseason-beats')
mkdirSync(outDir, { recursive: true })

const log = []
const say = (s) => { console.log(s); log.push(s) }

/** Topbar date + phase chip + the Continue label — the beat's own report. */
async function readState(win) {
  return win.evaluate(() => {
    const t = document.body.innerText
    const date = t.match(/\b(\d{1,2}\s+\w{3}\s+\d{4})\b/)?.[1] ?? '?'
    const btns = [...document.querySelectorAll('button')].map((b) => b.innerText.trim())
    // The topbar advance button changes label with the beat ("Continue — cut
    // day", "Name your captain to start the season", "Go to the entry draft").
    const cont = btns.find((b) => /^(Continue|Name your captain|Go to the entry draft)/.test(b)) ?? '(none)'
    const screen =
      t.includes('Camp is on the ice') ? 'TRAINING CAMP'
      : t.includes('Send the AGM') ? 'BOARD MEETING'
      : t.includes('Camp breaks') ? 'CAMP BREAKS'
      : t.includes('Name a captain before the season opens') ? 'LEADERSHIP'
      : 'dashboard/other'
    const cutBanner = t.includes('CUT DAY —')
    const captainGate = /captain/i.test(cont)
    return { date, cont, screen, cutBanner, captainGate }
  }).catch(() => ({ date: '?', cont: '?', screen: '?', cutBanner: false }))
}

/** Press whichever Continue is live (overlay's is exactly "Continue"). The
 *  button is DISABLED while the worker sims, so wait it out rather than
 *  treating a busy moment as "no button". */
async function press(win) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const sel of ['button:text-is("Continue"):not([disabled])', 'button:has-text("Continue"):not([disabled])']) {
      try { await win.click(sel, { timeout: 8000 }); return true } catch { /* next */ }
    }
    await win.waitForTimeout(1500)
  }
  return false
}

const app = await _electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root })
const win = await app.firstWindow()
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => {
    const { screen } = require('electron')
    const p = screen.getPrimaryDisplay()
    const other = screen.getAllDisplays().find((d) => d.id !== p.id)
    w.setSize(1760, 990)
    const t = other ? { x: other.bounds.x + 40, y: other.bounds.y + 40 } : { x: p.bounds.x + p.bounds.width + 60, y: p.bounds.y + 40 }
    w.setPosition(Math.round(t.x), Math.round(t.y))
  })
} catch { /* best effort */ }

try {
  // F6 front door: title → new career → club pick.
  await win.waitForSelector('.title-menu', { timeout: 30000 })
  await win.click('.title-item:has-text("New career")')
  await win.waitForSelector('.setup-inner', { timeout: 15000 })
  try {
    await win.click('.setup-seed-toggle', { timeout: 4000 })
    await win.fill('.setup-seed-row input', process.env.UI_SNAP_SEED ?? '424242', { timeout: 4000 })
  } catch { /* seed not pinned — run is not reproducible */ }
  await win.click('text=Build the world')
  await win.waitForSelector('.club-card', { timeout: 60000 })
  await win.click('.club-card >> nth=0')
  await win.click('.brief-cta')
  // Picking a club sims the whole year-zero season in the worker — the shell
  // appears first and the Continue button only enables when that finishes.
  await win.waitForSelector('button:has-text("Continue"):not([disabled])', { timeout: 300000 })
  say('career started')

  // Walk forward until the pre-opening stretch (regular season, day 0) is on
  // screen, resolving each gate as it comes.
  let shot = 0
  const snap = async (slug) => {
    shot += 1
    const f = join(outDir, `${String(shot).padStart(2, '0')}-${slug}.png`)
    await win.screenshot({ path: f })
    say(`  📸 ${f}`)
  }

  let sawCamp = false
  let cutDate = null
  let boardDate = null
  for (let i = 0; i < 160; i++) {
    const st = await readState(win)

    if (st.screen === 'TRAINING CAMP') {
      if (!sawCamp) { sawCamp = true; say(`camp reached — ${st.date} · "${st.cont}"`); await snap('camp-day1') }
      // Cut day: the camp screen offers the roster call.
      const atCut = await win.locator('button:has-text("set the roster")').count().catch(() => 0)
      if (atCut) {
        cutDate = st.date
        say(`CUT DAY on ${st.date} · button "${st.cont}"`)
        await snap('cut-day')
        await win.click('button:has-text("set the roster")', { timeout: 4000 }).catch(() => {})
        await win.waitForTimeout(600)
        await snap('camp-breaks')
        await win.click('button:has-text("opening night")', { timeout: 4000 }).catch(() => {})
        await win.waitForTimeout(600)
        const after = await readState(win)
        say(`after cuts resolve → ${after.date} · "${after.cont}" · ${after.screen}`)
        await snap('after-cuts')
        continue
      }
      // Mid-camp: walk the week on the camp screen itself.
      const adv = await win.locator('button:has-text("Advance to Day")').count().catch(() => 0)
      if (adv) { await win.click('button:has-text("Advance to Day")', { timeout: 4000 }).catch(() => {}); await win.waitForTimeout(400); continue }
    }

    // Captain gate: the season can't open until the C is named. Route in and
    // pin it on the first eligible skater.
    if (st.captainGate || st.screen === 'LEADERSHIP') {
      if (st.screen !== 'LEADERSHIP') {
        await win.click('button:has-text("Name your captain")', { timeout: 4000 }).catch(() => {})
        await win.waitForTimeout(800)
      }
      const c = win.locator('button:text-is("C"):not([disabled])').first()
      if (await c.count().catch(() => 0)) {
        await c.click({ timeout: 4000 }).catch(() => {})
        await win.waitForTimeout(900)
        say(`captain named at ${st.date}`)
        await win.click('text="Home"', { timeout: 4000 }).catch(() => {})
        await win.waitForTimeout(500)
        continue
      }
      say(`captain gate but no eligible C at ${st.date}`)
      await snap('captain-gate')
      break
    }

    if (st.screen === 'BOARD MEETING') {
      boardDate = st.date
      say(`BOARD MEETING on ${st.date} · button "${st.cont}"`)
      await snap('board-meeting')
      break
    }

    if (!(await press(win))) {
      say(`no Continue to press at ${st.date} (${st.screen}) — button read "${st.cont}"`)
      await snap('stuck')
      break
    }
    await win.waitForTimeout(350)
  }

  // The September calendar: cut day and the board meeting as key dates.
  try {
    await win.click('text="Schedule"', { timeout: 4000 })
    await win.waitForTimeout(700)
    await snap('preseason-calendar')
  } catch { say('  ⚠ calendar not reachable') }

  say('')
  say(`RESULT  cut day: ${cutDate ?? 'not seen'} | board meeting: ${boardDate ?? 'not seen'}`)
  say(cutDate && boardDate
    ? (cutDate === boardDate ? '❌ SAME DAY — playtest #5 not fixed' : '✅ DISTINCT DAYS — playtest #5 fixed')
    : '⚠ inconclusive — see the log above')
} finally {
  writeFileSync(join(outDir, 'log.txt'), log.join('\n'))
  await app.close()
}
