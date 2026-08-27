/**
 * Targeted proof for playtest G1: the Roster "View:" switcher reaches the
 * Contract and Statistics column sets.
 *
 * Deliberately narrow. The general audit (ui-audit.mjs) asserts "operating this
 * control changed the screen", which is the right generic check but would also
 * pass if the dropdown merely opened. This one names the payoff: pick Contract
 * and the salary/expiry columns must appear; pick Statistics and the scoring
 * columns must. That is the thing the bug denied the GM.
 *
 *   npm run build && node scripts/dev/verify-roster-view.mjs
 */
import { _electron } from 'playwright-core'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const app = await _electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root })
const win = await app.firstWindow()
const failures = []

/** Column header labels currently rendered in the roster table. */
async function headers() {
  return win.$$eval('.shell-main table.table thead th', (els) =>
    els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()),
  )
}

/** Open the "View:" dropdown and choose `label`. */
async function pickView(label) {
  await win.locator('.dropdown > button.select').first().click({ timeout: 5000 })
  await win.waitForTimeout(200)
  await win.locator(`.dropdown div[role="listbox"] button:has-text("${label}")`).first().click({ timeout: 5000 })
  await win.waitForTimeout(400)
}

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
  await win.waitForSelector('text=Continue', { timeout: 300000 })

  await win.click('text="Roster"', { timeout: 5000 })
  await win.waitForSelector('.shell-main table.table thead th', { timeout: 10000 })

  const general = await headers()
  if (!general.some((h) => h.startsWith('OVR'))) failures.push(`default view has no OVR column: ${general.join(' | ')}`)

  await pickView('Contract')
  const contract = await headers()
  for (const want of ['Salary', 'Years', 'Expires', 'Clauses']) {
    if (!contract.some((h) => h.startsWith(want))) failures.push(`Contract view missing "${want}": ${contract.join(' | ')}`)
  }

  await pickView('Statistics')
  const stats = await headers()
  if (!stats.some((h) => h.startsWith('GP'))) failures.push(`Statistics view missing "GP": ${stats.join(' | ')}`)

  await pickView('General')
  const back = await headers()
  if (!back.some((h) => h.startsWith('OVR'))) failures.push(`could not switch back to General: ${back.join(' | ')}`)
} catch (e) {
  failures.push(`threw: ${String(e.message ?? e).split('\n')[0]}`)
} finally {
  await app.close()
  if (failures.length) {
    console.log('✗ G1 NOT fixed:')
    for (const f of failures) console.log('   ' + f)
    process.exitCode = 1
  } else {
    console.log('✓ G1 fixed — Contract and Statistics column sets are both reachable, and General comes back')
  }
}
