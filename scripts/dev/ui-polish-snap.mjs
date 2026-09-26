/**
 * ui-polish-snap — a SHORT Playwright walk for visual-polish work.
 *
 * `npm run ui:snap` is the full season walk (tens of minutes). For icon/type
 * polish we only need the most-seen surfaces with real data behind them:
 * new career → first club → shell → Home / Inbox / Roster / a player profile /
 * Tactics / Scouting / Transfers, plus a few advanced days so the inbox has mail.
 *
 *   node scripts/dev/ui-polish-snap.mjs <outDir> [prefix]
 *
 * Env: ELECTRON_EXE — path to an electron.exe when this checkout's electron
 * package was installed with --ignore-scripts (no downloaded binary).
 * Uses a throwaway --user-data-dir so it never touches the real saves folder.
 */
import { _electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = process.argv[2] ?? join(root, 'scripts', 'dev', 'ui-snaps')
const prefix = process.argv[3] ?? ''
mkdirSync(outDir, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'ui-polish-'))

const app = await _electron.launch({
  executablePath: process.env.ELECTRON_EXE || undefined,
  args: [join(root, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`],
  cwd: root,
})
const win = await app.firstWindow()
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => {
    w.setSize(1760, 990)
    w.setPosition(-3000, 40)
  })
} catch { /* best effort */ }

async function snap(slug) {
  await win.evaluate(() => document.querySelectorAll('*').forEach((el) => { if (el.scrollTop) el.scrollTop = 0 }))
  await win.waitForTimeout(500)
  const file = join(outDir, `${prefix}${slug}.png`)
  await win.screenshot({ path: file })
  console.log('  shot', file)
}
async function dismiss() {
  for (let i = 0; i < 4; i++) {
    const close = win.locator('button:has-text("Close")')
    if (await close.count().catch(() => 0)) {
      await close.first().click({ timeout: 1500 }).catch(() => {})
      await win.waitForTimeout(200)
    } else break
  }
}
async function side(label) {
  await dismiss()
  await win.locator(`nav.sidebar button.sidebar-item:has(.sidebar-label:text-is("${label}"))`).first().click({ timeout: 4000 })
  await win.waitForTimeout(900)
}

try {
  await win.waitForSelector('.title-menu', { timeout: 30000 })
  await snap('title')
  await win.click('.title-item:has-text("New career")')
  await win.waitForSelector('.setup-inner', { timeout: 15000 })
  try {
    await win.click('.setup-seed-toggle', { timeout: 4000 })
    await win.fill('.setup-seed-row input', process.env.UI_SNAP_SEED ?? '424242', { timeout: 4000 })
  } catch { /* unpinned */ }
  await win.click('text=Build the world')
  await win.waitForSelector('.club-card', { timeout: 60000 })
  await snap('team-picker')
  await win.click('.club-card >> nth=0')
  await win.click('.brief-cta')
  await win.waitForSelector('text=Continue', { timeout: 300000 })
  await dismiss()
  for (const [label, slug] of [
    ['Home', 'dashboard'], ['Inbox', 'inbox'], ['Roster', 'squad'], ['Tactics', 'tactics'],
    ['Scouting', 'scouting'], ['Transfers', 'transfers'], ['Competitions', 'league'],
  ]) {
    try { await side(label); await snap(slug) } catch (e) { console.log('  skip', label, String(e).split('\n')[0]) }
  }
  // A player profile — first roster row.
  try {
    await side('Roster')
    await win.locator('table tbody tr .player-link').nth(3).click({ timeout: 3000 })
    await win.waitForTimeout(1200)
    await snap('player-profile')
  } catch (e) { console.log('  skip profile', String(e).split('\n')[0]) }
  // Inbox: open the first message so the reading pane is populated.
  try {
    await side('Inbox')
    await win.locator('main button[type="button"]:has-text("League Office")').first().click({ timeout: 3000 })
    await win.waitForTimeout(700)
    await snap('inbox-open')
  } catch (e) { console.log('  skip inbox-open', String(e).split('\n')[0]) }
} catch (e) {
  console.log('FAILED', e)
  await snap('failure').catch(() => {})
} finally {
  await app.close().catch(() => {})
}
