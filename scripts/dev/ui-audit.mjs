/**
 * UI interaction audit — the half of the harness that CLICKS.
 *
 * Why this exists (read the commit for d422fb2 first): for weeks the app shipped
 * with EVERY sidebar destination rendering the dashboard — an AnimatePresence
 * exit deadlock — and separately with the Roster "View:" dropdown inert. Both
 * survived a clean typecheck and 2264 green tests, because nothing in the
 * automated stack ever pressed a control. The screenshot walk didn't catch the
 * nav bug either: it drove the game with Continue, and a screenshot of the
 * dashboard taken while standing on "Tactics" looks exactly like a screenshot of
 * the dashboard.
 *
 * So the assertions here are deliberately the ones a screenshot cannot make:
 *
 *   1. NAV — after clicking a destination, the MAIN PANE's content must actually
 *      have changed, and must not be the dashboard's. Asserting on the nav item's
 *      highlight is worthless: during the deadlock the highlight moved correctly.
 *      That is precisely how the bug hid.
 *   2. HIT-TEST — every visible control must be the topmost element at its own
 *      centre point. This is the generic "does this control do anything when you
 *      click it" test: it catches occluding overlays, zero-size boxes and
 *      pointer-events:none, none of which are visible in a screenshot or a test.
 *   3. EXERCISE — view-switching controls (tabs, sub-tabs, sortable headers,
 *      selects) are actually operated and the pane is fingerprinted before and
 *      after. A control that changes nothing at all is reported as inert.
 *
 * Only NON-DESTRUCTIVE controls are exercised. Pressing "Continue", "Accept" or
 * "Sign" would advance or mutate the career and make the run unreproducible, so
 * the exercise set is restricted to controls whose whole job is to change the
 * view (see EXERCISE_SELECTORS + DESTRUCTIVE).
 */

/**
 * Controls whose entire job is to change what you're looking at. Safe to press.
 *
 * `.dropdown > button.select` is our own in-DOM dropdown (components/Dropdown.tsx).
 * It MUST be in this list: native `<select>`s are being migrated onto it because
 * their popups do not survive re-renders, and if the audit only knew how to
 * operate `<select>` then every migration would quietly delete its own coverage.
 */
const EXERCISE_SELECTORS = [
  '.tabs > button.tab',
  'nav.subtabbar > button.subtab',
  'th.sortable',
  'select',
  '.dropdown > button.select',
]

/** Never press anything whose label matches — these advance or mutate the career. */
const DESTRUCTIVE =
  /continue|sim |advance|play the game|accept|reject|decline|confirm|sign|offer|trade|release|buy ?out|waive|send down|call ?up|save|load|delete|remove|fire|hire|draft|retire|break camp|proceed|submit|table|start|generate|apply|commit/i

/**
 * Fingerprint the MAIN PANE — the screen's own content, with the shell chrome
 * (sidebar, topbar, sub-tabs) deliberately excluded so that a nav click which
 * only re-highlights the rail reads as "nothing happened".
 *
 * `children` catches the other face of the same deadlock: when mode="wait" was
 * swapped for mode="sync" the screens piled up three deep and none unmounted, so
 * a pane holding more than one screen wrapper is itself a bug.
 */
export async function paneFingerprint(win) {
  return win
    .evaluate(() => {
      const main = document.querySelector('.shell-main')
      if (!main) return { head: '', len: 0, hash: 0, children: 0, missing: true }
      const text = (main.innerText || '').replace(/\s+/g, ' ').trim()
      // Control STATE is not in innerText — a <select>'s innerText is every
      // option's label whether or not it is the chosen one, so a fingerprint made
      // of text alone reports every working dropdown as "inert". Fold the live
      // values in explicitly. (This cost a round of false positives on the Dev
      // Centre's focus dropdowns before it was noticed.)
      let state = ''
      for (const el of main.querySelectorAll('select, input')) {
        state += `|${el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value}`
      }
      // Also fold in which tab-ish things are active, so a pure highlight change
      // (sub-tab, sortable header direction) counts as "something happened".
      for (const el of main.querySelectorAll('.active, [aria-selected="true"]')) state += `|+${el.className}`
      const full = text + state
      let hash = 0
      for (let i = 0; i < full.length; i++) hash = (Math.imul(31, hash) + full.charCodeAt(i)) | 0
      return {
        // The head is for READING the report; the hash is what the assertions
        // compare, so a change 5000 characters down the page still registers.
        head: text.slice(0, 300),
        len: text.length,
        hash,
        children: main.children.length,
        missing: false,
      }
    })
    .catch(() => ({ head: '', len: 0, hash: 0, children: 0, missing: true }))
}

/**
 * Click every destination in the REAL rendered sidebar and prove the pane
 * changed. Reads the rail from the DOM rather than a hardcoded list, so a
 * destination added to navConfig.ts is audited the day it lands.
 *
 * Returns { findings, visited }. A finding is an object the caller reports and
 * counts; `severity: 'dead'` means the destination is unreachable.
 */
export async function auditNav(win, { settle = 450 } = {}) {
  const findings = []
  const visited = []

  const labels = await win
    .$$eval('nav.sidebar button.sidebar-item', (els) =>
      els.map((el) => el.querySelector('.sidebar-label')?.textContent?.trim() ?? el.title ?? ''),
    )
    .catch(() => [])

  if (labels.length === 0) {
    return { findings: [{ severity: 'dead', where: 'sidebar', what: 'no sidebar items found — the rail did not render' }], visited }
  }

  // The dashboard is the reference: the deadlock's signature is every other
  // destination rendering THIS.
  let dashboardHash = 0
  const byHash = new Map()

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]
    const before = await paneFingerprint(win)
    try {
      await win.locator('nav.sidebar button.sidebar-item').nth(i).click({ timeout: 3000 })
    } catch (e) {
      findings.push({ severity: 'dead', where: label, what: `sidebar item not clickable: ${String(e.message ?? e).split('\n')[0]}` })
      continue
    }
    await win.waitForTimeout(settle)
    const after = await paneFingerprint(win)
    visited.push({ label, head: after.head })

    if (i === 0) dashboardHash = after.hash

    if (after.missing || after.len === 0) {
      findings.push({ severity: 'dead', where: label, what: 'main pane is empty after navigating here' })
      continue
    }
    if (after.children > 1) {
      findings.push({
        severity: 'dead',
        where: label,
        what: `main pane holds ${after.children} screen wrappers — the old screen never unmounted`,
      })
    }
    // The nav bug, stated exactly: we asked for something else and got the
    // dashboard. Skipped for the dashboard itself and for anything that legitimately
    // never changed the pane because it was already the active destination.
    if (i > 0 && after.hash === dashboardHash) {
      findings.push({ severity: 'dead', where: label, what: 'renders the DASHBOARD, not its own screen' })
      continue
    }
    if (i > 0 && after.hash === before.hash && before.len > 0) {
      findings.push({ severity: 'suspect', where: label, what: 'main pane content did not change when this destination was opened' })
    }
    const twin = byHash.get(after.hash)
    if (twin && twin !== label) {
      findings.push({ severity: 'suspect', where: label, what: `renders byte-identical content to "${twin}"` })
    } else byHash.set(after.hash, label)
  }

  return { findings, visited }
}

/**
 * Hit-test every visible control on the screen currently shown.
 *
 * A control can be perfectly wired, perfectly typed and perfectly tested and
 * still be impossible to click, because something invisible sits on top of it or
 * because flexbox collapsed it to nothing. `elementFromPoint` at the control's
 * own centre is the cheapest honest answer to "would a real click land here?" —
 * and it is the check that would have caught the Roster "View:" dropdown.
 */
export async function auditHitTargets(win, where) {
  return win
    .evaluate((screenLabel) => {
      const out = []
      const main = document.querySelector('.shell-main')
      if (!main) return out
      const controls = main.querySelectorAll('button, select, input, [role="tab"], th.sortable, a[href]')
      for (const el of controls) {
        if (el.disabled) continue
        // Controls the user cannot currently see are not dead controls. A closed
        // <details> still lays its absolutely-positioned contents out in
        // Chromium, so the dashboard's "Customize" panel checkboxes reported as
        // "covered by the banner" until this skip existed — a pure false positive
        // that buried the real occlusions.
        const collapsed = el.closest('details:not([open])')
        if (collapsed) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
        const r = el.getBoundingClientRect()
        // pointer-events:none on an INTERACTIVE element is not decoration — it is
        // a control that cannot be pressed. Reported, not skipped.
        if (cs.pointerEvents === 'none' && r.width > 2 && r.height > 2) {
          out.push({
            where: screenLabel,
            control: (el.getAttribute('aria-label') || el.textContent || el.value || el.tagName).trim().slice(0, 48),
            what: 'has pointer-events:none — it cannot receive a click at all',
          })
          continue
        }
        // Off-screen / scrolled out of the viewport is not a bug — only judge
        // controls a user can currently see.
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue
        const label = (el.getAttribute('aria-label') || el.textContent || el.value || el.tagName).trim().slice(0, 48)
        if (r.width < 2 || r.height < 2) {
          out.push({ where: screenLabel, control: label, what: `collapsed to ${Math.round(r.width)}×${Math.round(r.height)}px — unclickable` })
          continue
        }
        const cx = Math.round(r.left + r.width / 2)
        const cy = Math.round(r.top + r.height / 2)
        const top = document.elementFromPoint(cx, cy)
        if (!top) continue
        if (top === el || el.contains(top) || top.contains(el)) continue
        // Toasts are transient by design — they fade in a couple of seconds and
        // are not a control being permanently unreachable. Reporting them buries
        // the real occlusions in noise.
        if (top.closest('.toast, .toast-host')) continue
        const blockerCls = (top.className && String(top.className).slice(0, 40)) || top.tagName
        const own = (el.className && String(el.className).slice(0, 30)) || el.tagName
        out.push({
          where: screenLabel,
          control: `${label} <${el.tagName.toLowerCase()} class="${own}">`,
          what: `covered at its centre (${cx},${cy}) by <${top.tagName.toLowerCase()} class="${blockerCls}"> — clicks land on that instead`,
        })
      }
      return out
    }, where)
    .catch(() => [])
}

/** How many visible, enabled controls this screen currently offers. */
export async function countHitTargets(win) {
  return win
    .evaluate(() => {
      const main = document.querySelector('.shell-main')
      if (!main) return 0
      let n = 0
      for (const el of main.querySelectorAll('button, select, input, [role="tab"], th.sortable, a[href]')) {
        if (el.disabled || el.closest('details:not([open])')) continue
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        if (r.bottom < 0 || r.top > window.innerHeight) continue
        n++
      }
      return n
    })
    .catch(() => 0)
}

/**
 * Operate the view-switching controls on the current screen and assert each one
 * does something. Destructive labels are skipped by design (see DESTRUCTIVE):
 * this audit must be able to run on a live career without changing it.
 */
export async function auditControls(win, where, { settle = 260, max = 14, counters } = {}) {
  const findings = [...(await auditHitTargets(win, where))]
  // Coverage, not just findings. "0 findings" and "0 controls examined" produce
  // an identical report otherwise, and a silently-vacuous audit is worse than no
  // audit — it is the same false reassurance that let the nav bug ship under a
  // green suite.
  if (counters) counters.hitTested += await countHitTargets(win)

  for (const sel of EXERCISE_SELECTORS) {
    const loc = win.locator(`.shell-main ${sel}`)
    const n = Math.min(await loc.count().catch(() => 0), max)
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i)
      let label = ''
      try {
        if (!(await el.isVisible())) continue
        if (!(await el.isEnabled())) continue
        // Re-pressing the tab you are already on is a legitimate no-op, so
        // exercising it would report every screen's default tab as inert.
        const cls = (await el.getAttribute('class')) ?? ''
        if (/\bactive\b/.test(cls)) continue
        label = ((await el.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
      } catch {
        continue
      }
      if (DESTRUCTIVE.test(label)) continue

      const before = await paneFingerprint(win)
      try {
        if (sel === 'select') {
          // Selects need a value CHANGE to prove anything — re-picking the
          // current option is a no-op and would read as a false "inert".
          const opts = await el.locator('option').allTextContents()
          if (opts.length < 2) continue
          const cur = await el.inputValue()
          const values = await el.locator('option').evaluateAll((os) => os.map((o) => o.value))
          const next = values.find((v) => v !== cur)
          if (next === undefined) continue
          await el.selectOption(next, { timeout: 2500 })
          label = `select → "${next}"`
        } else if (sel === '.dropdown > button.select') {
          // Open it, then pick an option that is NOT the current one. Two real
          // clicks, so this exercises the whole thing a native <select> could not
          // be exercised through: the popup opening AND the choice landing.
          await el.click({ timeout: 2500 })
          await win.waitForTimeout(120)
          const opts = el.locator('xpath=../div[@role="listbox"]/button')
          const total = await opts.count().catch(() => 0)
          if (total === 0) {
            findings.push({ where, control: label || 'dropdown', what: 'opening it produced no option list' })
            continue
          }
          let picked = -1
          for (let k = 0; k < total; k++) {
            if ((await opts.nth(k).getAttribute('aria-selected')) !== 'true') { picked = k; break }
          }
          if (picked < 0) { await el.click({ timeout: 1500 }).catch(() => {}); continue }
          label = `dropdown → "${((await opts.nth(picked).textContent()) ?? '').trim().slice(0, 24)}"`
          await opts.nth(picked).click({ timeout: 2500 })
        } else {
          await el.click({ timeout: 2500 })
        }
      } catch (e) {
        findings.push({ where, control: label || sel, what: `could not be operated: ${String(e.message ?? e).split('\n')[0].slice(0, 90)}` })
        continue
      }
      if (counters) counters.exercised += 1
      await win.waitForTimeout(settle)
      const after = await paneFingerprint(win)
      if (after.hash === before.hash) {
        findings.push({ where, control: label || sel, what: 'inert — operating it changed nothing on the screen' })
      }
    }
  }
  return findings
}

/** Render the collected findings as a readable report body. */
export function formatFindings(findings) {
  if (findings.length === 0) return '(no interaction findings)\n'
  const lines = []
  const dead = findings.filter((f) => f.severity === 'dead')
  const rest = findings.filter((f) => f.severity !== 'dead')
  if (dead.length) {
    lines.push(`## DEAD (${dead.length}) — unreachable or unclickable`)
    for (const f of dead) lines.push(`  ✗ [${f.where}] ${f.control ? f.control + ': ' : ''}${f.what}`)
    lines.push('')
  }
  lines.push(`## OTHER (${rest.length})`)
  for (const f of rest) lines.push(`  · [${f.where}] ${f.control ? f.control + ': ' : ''}${f.what}`)
  return lines.join('\n') + '\n'
}
