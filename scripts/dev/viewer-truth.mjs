/**
 * Viewer-truth runner + reel recorder (docs/gameplan-2026-09-28 W1).
 *
 * Drives the BUILT Electron app (out/, `npx electron-vite build`) on a COPY of
 * the owner's save, at the owner's watch settings, and judges what the match
 * screen DRAWS (window.__viewerProbe) with the VT1–VT10 detectors. Optionally
 * records each golden scenario as a clip and builds an owner-scored reel page.
 *
 *   node scripts/dev/viewer-truth.mjs [--engines=agent,classic] [--record] [--out=<dir>]
 *        [--save=<path to a save file>] [--seeds=12] [--pins=<scenarios.json>]
 *
 * SAFETY (an agent once overwrote the owner's autosave with --user-data-dir):
 *  - the app runs with HOCKEY_USER_DATA=<out>/userdata (unpackaged builds only
 *    honour it), loading a COPY of the save; --user-data-dir is never used;
 *  - the real saves folder is SHA1-fingerprinted before launch and verified
 *    unchanged afterwards (the run fails loudly if anything moved);
 *  - the window is parked off every display and never takes focus
 *    (HOCKEY_OFFSCREEN=1), and its audio is muted — the owner may be gaming.
 *
 * Output (<out>, default scratch/viewer-truth): report.json + report.txt
 * (red/green per detector, per clip), scenarios-<engine>.json (the pins),
 * and with --record: clips/*.webm + reel.html.
 */
import { _electron } from 'playwright-core'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReelHtml } from './viewer-truth-reel.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const flag = (k, d) => {
  const f = process.argv.find((a) => a.startsWith(`--${k}=`))
  return f ? f.slice(k.length + 3) : process.argv.includes(`--${k}`) ? true : d
}
const ENGINES = String(flag('engines', 'agent')).split(',').filter(Boolean)
const RECORD = flag('record', false) === true
const OUT = String(flag('out', join(root, '.cache', 'viewer-truth')))
const SEEDS = Number(flag('seeds', 12))
const PINS = flag('pins', null)
const ONLY = flag('only', null) // comma list of scenario kinds
const APPDATA = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
const REAL_SAVES = join(APPDATA, 'hockey-manager', 'saves')
const SAVE = String(flag('save', join(REAL_SAVES, 'slot-1.json')))

/** The owner's own watch prefs (read from his profile's Local Storage, 2026-10-03):
 *  3D, replays on, commentary on, compact presentation, Full mode, broadcast camera. */
const OWNER_PREFS = {
  hockeyMatchRenderer: '3d',
  hockeyMatchReplays: 'on',
  'hockey.broadcast.commentary': 'true',
  'hockey.broadcast.presentation': 'compact',
  hockeyWatchMode: 'rink',
}

/* ── per-kind reel checklist (ROOT-CAUSES §2.2) ───────────────────────────── */
export const CHECKLIST = {
  breakaway: ['Readable start to finish?', 'Puck always visible?', 'Did the shooter set up, or did the shot just happen?', 'Goalie reaction plausible?'],
  twoOnOne: ['Lanes filled?', 'Pass goes across or forward, not back?', 'Defender plays the pass?'],
  ozCycleShot: ['Puck moves with purpose along the wall?', 'Support players move, not stand?', 'The shot has a visible set-up?'],
  ppSetPlay: ['Formation recognisable (umbrella / 1-3-1)?', 'Puck moves with purpose?', 'PK box visible?'],
  goalReplay: ['Celebration, bench, crowd?', 'Replay shows the puck going in?', 'Back to the faceoff cleanly?', 'Score never wrong?'],
  lineChangeOnFly: ['Right number of men?', 'Change through the bench door?', 'No ghosts / morphing through the boards?'],
  faceoffWinPlay: ['Everyone set before the drop?', 'Draw goes back?', 'A play follows?'],
  bigHit: ['Wind-up / approach visible?', 'Contact reads?', 'Reaction and puck consequence?'],
  saveRebound: ['Save reads?', 'Rebound visible?', 'Second chance plausible?'],
  emptyNetLate: ['Goalie to the bench?', 'Extra attacker from the gate?', 'A long-range attempt?'],
}

const sha1 = (file) => createHash('sha1').update(readFileSync(file)).digest('hex')
function fingerprintSaves() {
  if (!existsSync(REAL_SAVES)) return {}
  const out = {}
  for (const f of readdirSync(REAL_SAVES)) out[f] = sha1(join(REAL_SAVES, f))
  return out
}

// ── preflight: launch ONLY this checkout's own build, with its node_modules ──
// (a scratch copy of out/ without node_modules crashed on 'electron-updater'
// and popped an error dialog on the owner's screen — never launch blind, never retry)
{
  const { createRequire } = await import('node:module')
  const req = createRequire(join(root, 'out', 'main', 'index.js'))
  const missing = ['electron', 'electron-updater'].filter((m) => { try { req.resolve(m); return false } catch { return true } })
  if (!existsSync(join(root, 'out', 'main', 'index.js')) || missing.length) {
    console.error(`✖ preflight: ${!existsSync(join(root, 'out', 'main', 'index.js')) ? 'no build (run npx electron-vite build)' : `cannot resolve ${missing.join(', ')} beside out/ (node_modules junction?)`}`)
    process.exit(2)
  }
}

mkdirSync(OUT, { recursive: true })
const before = fingerprintSaves()
console.log(`▶ real saves fingerprinted (${Object.keys(before).length} files)`)
const userData = join(OUT, 'userdata')
rmSync(userData, { recursive: true, force: true })
mkdirSync(join(userData, 'saves'), { recursive: true })
copyFileSync(SAVE, join(userData, 'saves', 'slot-1.json'))
console.log(`▶ save copy: ${SAVE} → ${join(userData, 'saves', 'slot-1.json')}`)

const app = await _electron.launch({
  args: [join(root, 'out', 'main', 'index.js'), '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  cwd: root,
  env: { ...process.env, HOCKEY_USER_DATA: userData, HOCKEY_VIEWER_PROBE: '1', HOCKEY_OFFSCREEN: '1' },
})
const report = { startedAt: new Date().toISOString(), save: SAVE, prefs: OWNER_PREFS, engines: {}, safety: {} }
let failed = false
try {
  const win = await app.firstWindow()
  // muted: the owner may be using the machine; captured clips are picture-only
  await app.evaluate(({ BrowserWindow, session }) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.setAudioMuted(true)
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => callback({ video: request.frame }))
  })
  const errors = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await win.waitForSelector('.title-menu', { timeout: 60000 })
  await win.evaluate((prefs) => { for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v) }, OWNER_PREFS)
  await win.click('.title-item:has-text("Load career")')
  await win.waitForSelector('.savemgr', { timeout: 10000 })
  await win.click('.savemgr-actions button:has-text("Load")')
  await win.waitForFunction(() => !!window.__reel, null, { timeout: 180000 })
  await win.waitForSelector('text=Continue', { timeout: 180000 })
  console.log('▶ save loaded, shell up')

  let mediaStream = false
  for (const engine of ENGINES) {
    let pins
    const pinFile = PINS ? String(PINS).replace('{engine}', engine) : join(OUT, `scenarios-${engine}.json`)
    if (PINS && existsSync(pinFile)) {
      pins = JSON.parse(readFileSync(pinFile, 'utf8'))
      console.log(`▶ [${engine}] ${pins.scenarios.length} pinned scenarios from ${pinFile}`)
    } else {
      const t0 = Date.now()
      pins = await win.evaluate(({ e, n }) => window.__reel.find(e, Array.from({ length: n }, (_, i) => 1000 + i)), { e: engine, n: SEEDS })
      if (pins.error) throw new Error(`find(${engine}): ${pins.error}`)
      writeFileSync(join(OUT, `scenarios-${engine}.json`), JSON.stringify(pins, null, 2))
      console.log(`▶ [${engine}] searched ${pins.games} games in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${pins.scenarios.length} scenarios${pins.missing.length ? `, missing ${pins.missing.join(', ')}` : ''}`)
    }
    const clips = []
    for (const sc of pins.scenarios) {
      if (ONLY && !String(ONLY).split(',').includes(sc.kind)) continue
      const label = `${engine}-${sc.kind}`
      const opened = await win.evaluate((s) => window.__reel.watch(s.homeId, s.awayId, s.seed, s.engine), sc)
      const evCount = Number(String(opened).split('·')[1]?.trim().split(' ')[0])
      const fpOk = String(sc.fingerprint).startsWith(`${evCount}·`)
      // wait for THIS game's viewer with its renderer built (the previous clip's
      // viewer may still be unmounting), then drop the puck, skip the open, cut in
      await win.waitForFunction((h) => {
        const p = window.__viewerProbe
        if (!p) return false
        const st = p.state()
        return st.ready && st.phase === 'hero' && st.away === h
      }, sc.awayAbbr, { timeout: 120000 })
      await win.evaluate(() => { window.__viewerProbe.dropPuck('full') })
      await win.waitForFunction(() => ['pregame', 'playing'].includes(window.__viewerProbe.state().phase), null, { timeout: 15000 })
      await win.evaluate(() => { if (window.__viewerProbe.state().phase === 'pregame') window.__viewerProbe.skipPregame() })
      await win.waitForFunction(() => window.__viewerProbe.state().phase === 'playing', null, { timeout: 15000 })
      for (let k = 0; k < 3; k++) {
        await win.evaluate((t) => { window.__viewerProbe.jumpTo(t) }, sc.clipFrom)
        await win.waitForTimeout(250)
        const st0 = await win.evaluate(() => window.__viewerProbe.state())
        if (st0.phase === 'intermission') await win.evaluate(() => window.__viewerProbe.continueIntermission())
        else if (st0.playing && Math.abs(st0.clock - sc.clipFrom) < 5) break
      }
      // the camera springs settle for a beat before the clip counts
      await win.waitForTimeout(400)
      await win.evaluate(() => window.__viewerProbe.reset())
      if (RECORD && !mediaStream) {
        // getDisplayMedia needs a user gesture: one real click, stream kept for the session
        await win.mouse.click(5, 5)
        mediaStream = await win.evaluate(async () => {
          try {
            window.__capture = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
            return true
          } catch (e) { return String(e) }
        })
        if (mediaStream !== true) { console.log(`  ⚠ capture unavailable: ${mediaStream}`); mediaStream = 'off' }
      }
      const recording = RECORD && mediaStream === true
      if (recording) {
        await win.evaluate(() => {
          window.__chunks = []
          const rec = new MediaRecorder(window.__capture, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 6_000_000 })
          rec.ondataavailable = (e) => { if (e.data.size) window.__chunks.push(e.data) }
          rec.start(1000)
          window.__rec = rec
        })
      }
      // play until the clip window is through (a goal also waits out the celebration + replay)
      // one still per clip at ~2 s in: evidence for the eye (bench rigs, framing)
      const shotAt = Date.now() + 2000
      let stillTaken = false
      const t0 = Date.now()
      const isGoal = sc.kind === 'goalReplay' || sc.kind === 'emptyNetLate'
      const maxWall = 90_000
      let st
      let replaySeen = false
      for (;;) {
        await win.waitForTimeout(250)
        st = await win.evaluate(() => window.__viewerProbe.state())
        if (st.replay) replaySeen = true
        if (!stillTaken && Date.now() >= shotAt) {
          stillTaken = true
          mkdirSync(join(OUT, 'stills'), { recursive: true })
          await win.screenshot({ path: join(OUT, 'stills', `${label}.png`) }).catch(() => {})
        }
        // a period break inside the clip window: on with the clip (the owner would press Continue)
        if (st.phase === 'intermission' && st.clock < sc.clipTo) { await win.evaluate(() => window.__viewerProbe.continueIntermission()); continue }
        if (st.phase === 'intermission' || st.phase === 'postgame') break
        const pastClip = st.clock >= sc.clipTo && !st.replay && !st.replayPending
        if (pastClip && (!isGoal || replaySeen || st.goalsSeen === 0 || Date.now() - t0 > 25_000)) break
        if (Date.now() - t0 > maxWall) break
      }
      const wallS = (Date.now() - t0) / 1000
      if (process.env.VT_DEBUG) console.log('   end state', JSON.stringify(st))
      let clipFile = null
      if (recording) {
        const b64 = await win.evaluate(async () => {
          const rec = window.__rec
          await new Promise((r) => { rec.onstop = r; rec.stop() })
          const blob = new Blob(window.__chunks, { type: 'video/webm' })
          const buf = new Uint8Array(await blob.arrayBuffer())
          let s = ''
          for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
          return btoa(s)
        })
        mkdirSync(join(OUT, 'clips'), { recursive: true })
        clipFile = `clips/${label}.webm`
        writeFileSync(join(OUT, clipFile), Buffer.from(b64, 'base64'))
      }
      const vt = await win.evaluate(() => window.__viewerProbe.report())
      const fps = await win.evaluate(() => {
        const st = window.__viewerProbe.state()
        return st.frames
      })
      clips.push({ ...sc, label, clipFile, wallS, frames: fps, fingerprintOk: fpOk, opened, vt })
      const reds = vt.filter((r) => r.status === 'red').map((r) => r.id)
      console.log(`  ● ${label.padEnd(26)} ${sc.homeAbbr} v ${sc.awayAbbr} seed ${sc.seed} @${sc.absT.toFixed(1)}  ${wallS.toFixed(1)} s wall, ${fps} frames${fpOk ? '' : ' (FINGERPRINT MISMATCH)'}  red: ${reds.join(' ') || '–'}`)
      await win.evaluate(() => window.__reel.close())
      await win.waitForTimeout(500)
    }
    report.engines[engine] = { pins, clips }
  }
  report.consoleErrors = errors.slice(0, 40)
} catch (e) {
  failed = true
  report.error = String(e && e.stack ? e.stack : e)
  console.error('✖', report.error)
} finally {
  await app.close().catch(() => {})
}

// ── owner-save safety check ─────────────────────────────────────────────────
const after = fingerprintSaves()
const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k])
// Attribution: a changed real save is OURS only if its new bytes match something
// this run's isolated app wrote. Otherwise someone else (the owner, playing his
// own game while this runs) saved it — reported, not fatal.
const ours = new Set(existsSync(join(userData, 'saves')) ? readdirSync(join(userData, 'saves')).map((f) => sha1(join(userData, 'saves', f))) : [])
const byUs = changed.filter((k) => after[k] && ours.has(after[k]))
report.safety = { realSaves: REAL_SAVES, before, after, changed, changedByThisRun: byUs, unchanged: changed.length === 0 }
if (byUs.length) {
  failed = true
  console.error(`✖ OWNER SAVES OVERWRITTEN BY THIS RUN: ${byUs.join(', ')} — restore from the backup!`)
} else if (changed.length) {
  console.log(`⚠ owner saves changed during the run but NOT by it (the owner is playing?): ${changed.join(', ')} — no isolated file matches`)
} else console.log(`✔ owner saves unchanged (${Object.keys(after).length} files SHA1-verified)`)

// ── summary: worst status per detector per engine ───────────────────────────
const lines = []
for (const [engine, { clips }] of Object.entries(report.engines)) {
  lines.push(`\n=== VIEWER TRUTH · ${engine} engine · ${clips.length} clips · owner settings (3D, broadcast, Full) ===`)
  const ids = clips[0]?.vt.map((r) => r.id) ?? []
  for (const id of ids) {
    const rows = clips.map((c) => ({ c, r: c.vt.find((x) => x.id === id) }))
    const red = rows.filter((x) => x.r.status === 'red')
    const green = rows.filter((x) => x.r.status === 'green')
    const status = red.length ? 'RED  ' : green.length ? 'GREEN' : 'n/a  '
    lines.push(`${status} ${id.padEnd(4)} ${rows[0].r.name} — ${red.length} red / ${green.length} green / ${rows.length - red.length - green.length} n/a`)
    lines.push(`      rule: ${rows[0].r.rule}`)
    for (const { c, r } of (red.length ? red : green).slice(0, 4)) {
      lines.push(`      [${c.kind}] ${r.value}`)
      for (const e of r.evidence.slice(0, 2)) lines.push(`         · ${e}`)
    }
  }
}
const txt = lines.join('\n')
console.log(txt)
writeFileSync(join(OUT, 'report.txt'), txt + '\n')
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
if (RECORD) {
  writeFileSync(join(OUT, 'reel.html'), buildReelHtml(report, CHECKLIST))
  console.log(`▶ reel: ${join(OUT, 'reel.html')}`)
}
process.exit(failed ? 1 : 0)
