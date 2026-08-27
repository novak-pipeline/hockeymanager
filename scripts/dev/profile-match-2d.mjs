/**
 * 2D MATCH-VIEWER CPU PROFILER (playtest finding C2: "2× speed in the 2D view is
 * laggy").
 *
 * Launches the REAL Electron app with Playwright, walks a fresh career to the
 * first match day, opens the 2D watched game, and takes a V8 CPU profile (via
 * the DevTools protocol) of a window of playback at 1× and again at 2×, plus an
 * in-page rAF frame-time histogram for each. The output attributes main-thread
 * self time to real functions, so the cost can be pinned on ONE of:
 *
 *   • per-tick event processing (MatchViewer._onUpdate, timeline sampling)
 *   • renderer draw calls (Pixi render/Graphics/Text)
 *   • React re-renders (performWorkOnRoot / commit / reconcile)
 *
 * Usage:
 *   npm run build
 *   node scripts/dev/profile-match-2d.mjs [outFile]
 */
import { _electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outFile = process.argv[2] ?? join(root, 'docs', 'perf', '2d-match-cpu-profile.txt')
mkdirSync(dirname(outFile), { recursive: true })

const report = []
function say(s) {
  console.log(s)
  report.push(s)
}

/** Same advance ladder as the UI snapshot harness (see ui-snapshot.mjs). */
const ADVANCE_SELECTORS = [
  'button[aria-label="Continue to the next day"]',
  'button:has-text("Break camp")',
  'button:has-text("To opening night")',
  'button:has-text("opening night")',
  'button:has-text("set the roster")',
  'button:has-text("Send the AGM")',
  'button:has-text("Run the scrimmage")',
  'button:has-text("Hear the final reads")',
  'button:has-text("Send the staff")',
  'button:has-text("Delegate")',
  'button:has-text("Advance to Day")',
  'button:has-text("Continue")',
  'button:has-text("Sim day")',
  'button:has-text("Proceed")',
  'button:has-text("Skip")',
  'button:has-text("Dismiss")',
]

async function advanceOnce(win) {
  for (const sel of ADVANCE_SELECTORS) {
    const loc = win.locator(sel)
    const count = Math.min(await loc.count().catch(() => 0), 3)
    for (let k = count - 1; k >= 0; k--) {
      const el = loc.nth(k)
      try {
        if (!(await el.isEnabled().catch(() => false))) continue
        await el.click({ timeout: 1200 })
        return true
      } catch { /* covered/detached */ }
    }
  }
  return false
}

/**
 * Which layer a sampled frame belongs to. Attribution is by CHUNK FILE first
 * (PROFILE_BUILD=1 splits react-dom and pixi.js into their own bundles, which
 * survives react-dom shipping pre-minified), falling back to function name for
 * the app chunk — which PROFILE_BUILD leaves unminified.
 */
function layerOf(functionName, file) {
  if (/^react-/.test(file)) return 'React (render / reconcile / commit)'
  if (/^pixi-/.test(file)) return 'Pixi draw'
  if (/^(program|\(program\)|\(idle\)|\(garbage collector\)|\(root\))$/.test(functionName)) {
    return functionName.includes('garbage') ? 'GC' : 'Idle / VM'
  }
  if (/sfx|announcer|speak|Audio|whiteNoise|kokoro|crowd|goalHorn/i.test(functionName)) return 'Audio (SFX / announcer)'
  if (/sampleAt|scoreAt|clockAt|renderAt|blend|lerp|frameIndexAt|firstStoppageBetween|emit/i.test(functionName)) {
    return 'Timeline sampling (renderer per-tick)'
  }
  if (/_onUpdate|findCrossed|findGoal|currentSpeed|nextActiveJump|MatchViewer|onUpdate/i.test(functionName)) {
    return 'MatchViewer per-tick event processing'
  }
  if (/^tick$/.test(functionName)) return 'Timeline sampling (renderer per-tick)'
  return 'Other (native / app / DOM)'
}

/** Aggregate a CDP CPU profile into self-time per function and per layer. */
function aggregate(profile) {
  const byId = new Map()
  for (const n of profile.nodes) byId.set(n.id, n)
  const self = new Map()
  const layers = new Map()
  const deltas = profile.timeDeltas ?? []
  let totalUs = 0
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = deltas[i] ?? 0
    const n = byId.get(profile.samples[i])
    if (!n) continue
    const cf = n.callFrame
    const file = (cf.url || '').split('/').pop() || '(native)'
    const fn = cf.functionName || '(anonymous)'
    const key = `${fn} @ ${file}`
    self.set(key, (self.get(key) ?? 0) + dt)
    const layer = layerOf(fn, file)
    layers.set(layer, (layers.get(layer) ?? 0) + dt)
    totalUs += dt
  }
  return { self, layers, totalUs }
}

/** Install an in-page rAF frame-time recorder. */
async function startFrameRecorder(win) {
  await win.evaluate(() => {
    window.__frameTimes = []
    window.__recording = true
    let last = performance.now()
    const step = (ts) => {
      window.__frameTimes.push(ts - last)
      last = ts
      if (window.__recording) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

async function stopFrameRecorder(win) {
  return win.evaluate(() => {
    window.__recording = false
    const t = window.__frameTimes.slice(1)
    t.sort((a, b) => a - b)
    const at = (p) => t[Math.min(t.length - 1, Math.floor(t.length * p))] ?? 0
    const over = t.filter((x) => x > 20).length
    return {
      frames: t.length,
      medianMs: at(0.5),
      p95Ms: at(0.95),
      worstMs: t[t.length - 1] ?? 0,
      fps: t.length ? 1000 / (t.reduce((a, b) => a + b, 0) / t.length) : 0,
      framesOver20ms: over,
    }
  })
}

async function profileWindow(win, cdp, label, seconds) {
  await startFrameRecorder(win)
  await cdp.send('Profiler.start')
  await win.waitForTimeout(seconds * 1000)
  const { profile } = await cdp.send('Profiler.stop')
  const frames = await stopFrameRecorder(win)
  const { self, layers, totalUs } = aggregate(profile)

  say(`\n══ ${label} ══`)
  say(
    `  frames ${frames.frames}  ·  ${frames.fps.toFixed(1)} fps  ·  median ${frames.medianMs.toFixed(2)} ms  ·  ` +
      `p95 ${frames.p95Ms.toFixed(2)} ms  ·  worst ${frames.worstMs.toFixed(1)} ms  ·  ` +
      `${frames.framesOver20ms} frames over 20 ms`
  )
  say(`  sampled CPU: ${(totalUs / 1000).toFixed(0)} ms over ${seconds} s wall`)
  say('  ── by layer ──')
  for (const [name, us] of [...layers.entries()].sort((a, b) => b[1] - a[1])) {
    if (us <= 0) continue
    say(`     ${(us / 1000).toFixed(1).padStart(8)} ms  ${((us / totalUs) * 100).toFixed(1).padStart(5)}%  ${name}`)
  }
  say('  ── top 20 functions by self time ──')
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  for (const [key, us] of top) {
    say(`     ${(us / 1000).toFixed(1).padStart(8)} ms  ${((us / totalUs) * 100).toFixed(1).padStart(5)}%  ${key}`)
  }
  return frames
}

const app = await _electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root })
const win = await app.firstWindow()
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => {
    const { screen } = require('electron')
    const primary = screen.getPrimaryDisplay()
    const other = screen.getAllDisplays().find((d) => d.id !== primary.id)
    w.setSize(1760, 990)
    const target = other
      ? { x: other.bounds.x + 40, y: other.bounds.y + 40 }
      : { x: primary.bounds.x + primary.bounds.width + 60, y: primary.bounds.y + 40 }
    w.setPosition(Math.round(target.x), Math.round(target.y))
  })
} catch { /* best effort */ }

try {
  // F6 front door: title → new career → club pick.
  await win.waitForSelector('.title-menu', { timeout: 30000 })
  await win.click('.title-item:has-text("New career")')
  await win.waitForSelector('.setup-inner', { timeout: 15000 })
  try {
    await win.click('.setup-seed-toggle', { timeout: 4000 })
    await win.fill('.setup-seed-row input', process.env.PROFILE_SEED ?? '424242', { timeout: 4000 })
  } catch { /* seed not pinned — run is not reproducible */ }
  await win.click('text=Build the world')
  await win.waitForSelector('.club-card', { timeout: 60000 })
  await win.click('.club-card >> nth=0')
  await win.click('.brief-cta')
  await win.waitForSelector('text=Continue', { timeout: 600000 })
  say('  ▶ shell up — walking to the first match day')

  // Walk until the pregame match-day frame offers "Watch live".
  const watchSel = 'button[aria-label="Watch the game live"]'
  let found = false
  for (let i = 0; i < 400 && !found; i++) {
    if (await win.locator(watchSel).count().catch(() => 0)) { found = true; break }
    if (!(await advanceOnce(win))) await win.waitForTimeout(400)
    await win.waitForTimeout(120)
  }
  if (!found) throw new Error('never reached a match day with a Watch-live button')
  say('  ▶ match day reached — opening the watched game')
  await win.click(watchSel)

  // Force the 2D renderer (3D is the stored default), then drop the puck.
  await win.waitForSelector('button:has-text("2D")', { timeout: 30000 })
  await win.click('button:has-text("2D")')
  await win.waitForTimeout(1500)
  await win.waitForSelector('text=DROP THE PUCK', { timeout: 30000 })
  await win.click('button:has-text("Full Game")')
  await win.waitForTimeout(3000)
  say('  ▶ playing — profiling')

  const cdp = await win.context().newCDPSession(win)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })

  const oneX = await profileWindow(win, cdp, 'PLAN SPEED, nudge 1× (the "Speed: 1×" button)', 12)

  // Nudge to 2×: the speed row's third button.
  await win.click('button[title="Double speed"]')
  await win.waitForTimeout(1500)
  const twoX = await profileWindow(win, cdp, 'PLAN SPEED, nudge 2× (the "Speed: 2×" button)', 12)

  say('\n══ VERDICT ══')
  say(`  fps 1× ${oneX.fps.toFixed(1)}  →  2× ${twoX.fps.toFixed(1)}`)
  say(`  p95 frame 1× ${oneX.p95Ms.toFixed(2)} ms  →  2× ${twoX.p95Ms.toFixed(2)} ms`)
  say(`  frames over 20 ms: 1× ${oneX.framesOver20ms}  →  2× ${twoX.framesOver20ms}`)
} catch (e) {
  say(`\n  ✖ ${e?.message ?? e}`)
} finally {
  writeFileSync(outFile, `${report.join('\n')}\n`)
  console.log(`\n  → ${outFile}`)
  await app.close().catch(() => {})
}
