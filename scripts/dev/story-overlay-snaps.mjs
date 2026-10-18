/**
 * story-overlay-snaps.mjs — stills of the watched game's live story layer
 * (story lower-thirds, bench cam, flow strip, big-chance pull-in, the room)
 * from the REAL built app on a COPY of the owner's newest save.
 *
 *   npx electron-vite build
 *   node scripts/dev/story-overlay-snaps.mjs [--out=<dir>] [--save=<file>] [--r=2d|3d]
 *
 * Safety (same rules as viewer-truth.mjs):
 *  - HOCKEY_USER_DATA=<out>/userdata with a COPY of the save; --user-data-dir is
 *    never used (the app pins userData and would ignore it);
 *  - the real saves folder is SHA1-fingerprinted before and verified after;
 *  - the window is parked off every display and never focused
 *    (HOCKEY_OFFSCREEN=1), audio muted; the app is always closed at the end.
 */
import { _electron } from 'playwright-core'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d
const APPDATA = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
const REAL_SAVES = join(APPDATA, 'hockey-manager', 'saves')
const OUT = arg('out', join(root, '.cache', 'story-overlays'))
const R = arg('r', '3d')
const newest = () => readdirSync(REAL_SAVES).map((f) => join(REAL_SAVES, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
const SAVE = arg('save', newest())

const sha1 = (f) => createHash('sha1').update(readFileSync(f)).digest('hex')
const fingerprint = () => Object.fromEntries(readdirSync(REAL_SAVES).map((f) => [f, sha1(join(REAL_SAVES, f))]))

if (!existsSync(join(root, 'out', 'main', 'index.js'))) { console.error('✖ no build (npx electron-vite build)'); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const before = fingerprint()
console.log(`▶ real saves fingerprinted (${Object.keys(before).length} files)`)
const userData = join(OUT, 'userdata')
rmSync(userData, { recursive: true, force: true })
mkdirSync(join(userData, 'saves'), { recursive: true })
copyFileSync(SAVE, join(userData, 'saves', 'slot-1.json'))

// The GM's club and the league's other clubs, from the save itself.
let raw = readFileSync(SAVE)
try { raw = gunzipSync(raw) } catch { /* plain JSON */ }
const snap = JSON.parse(raw.toString('utf8'))
const userId = snap.userTeamId
const teamIds = (snap.leagueData?.league?.teams ?? []).filter((t) => t !== userId)
console.log(`▶ save copy (${SAVE}) · user ${userId} · ${teamIds.length} opponents · ${snap.year} day ${snap.currentDay}`)

const app = await _electron.launch({
  args: [join(root, 'out', 'main', 'index.js'), '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  cwd: root,
  env: { ...process.env, HOCKEY_USER_DATA: userData, HOCKEY_VIEWER_PROBE: '1', HOCKEY_OFFSCREEN: '1' },
})
const shots = []
let failed = false
try {
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) { w.webContents.setAudioMuted(true); w.setSize(1600, 940) }
  })
  await win.waitForSelector('.title-menu', { timeout: 60000 })
  await win.evaluate((r) => {
    localStorage.setItem('hockeyMatchRenderer', r)
    localStorage.setItem('hockeyMatchReplays', 'off')
    localStorage.setItem('hockey.broadcast.presentation', 'full')
    localStorage.setItem('hockeyWatchMode', 'rink')
    localStorage.setItem('hockeyMatchPanel', 'closed')
  }, R)
  await win.click('.title-item:has-text("Load career")')
  await win.waitForSelector('.savemgr', { timeout: 10000 })
  await win.click('.savemgr-actions button:has-text("Load")')
  await win.waitForFunction(() => !!window.__reel, null, { timeout: 180000 })
  await win.waitForSelector('text=Continue', { timeout: 180000 })
  console.log('▶ save loaded')

  const open = async (homeId, awayId, seed) => {
    await win.evaluate((a) => window.__reel.watch(a.h, a.a, a.s, 'agent'), { h: homeId, a: awayId, s: seed })
    await win.waitForFunction(() => window.__viewerProbe?.state().ready && window.__viewerProbe.state().phase === 'hero' && !!window.__story, null, { timeout: 180000 })
    await win.waitForTimeout(800)
    return win.evaluate(() => window.__story.plan())
  }
  const still = async (name) => {
    const file = join(OUT, `${String(shots.length + 1).padStart(2, '0')}-${name}.png`)
    await win.screenshot({ path: file })
    shots.push(file)
    console.log('  saved', file)
  }
  const playTo = async (absT, maxMs = 30000) => {
    const t0 = Date.now()
    for (;;) {
      const st = await win.evaluate(() => window.__viewerProbe.state())
      if (st.phase === 'intermission') return 'intermission'
      if (st.clock >= absT || st.phase === 'postgame') return 'ok'
      if (Date.now() - t0 > maxMs) return 'timeout'
      await win.waitForTimeout(150)
    }
  }

  // Pick the night with the most story: try a few opponents, home and away.
  let best = null
  for (let i = 0; i < Math.min(6, teamIds.length); i++) {
    const opp = teamIds[(i * 5) % teamIds.length]
    const home = i % 2 === 0 ? userId : opp
    const away = i % 2 === 0 ? opp : userId
    const plan = await open(home, away, 4100 + i)
    const score = plan.beats.length + Object.values(plan.room).flat().length + new Set(plan.beats.map((b) => b.kind)).size * 2
    console.log(`  ${home} v ${away}: ${plan.beats.length} beats (${[...new Set(plan.beats.map((b) => b.kind))].join(', ')}), room ${Object.keys(plan.room).join(',')}`)
    if (!best || score > best.score) best = { home, away, seed: 4100 + i, plan, score }
  }
  const plan = await open(best.home, best.away, best.seed)
  writeFileSync(join(OUT, 'plan.json'), JSON.stringify(plan, null, 2))
  await win.evaluate(() => window.__viewerProbe.dropPuck('full'))
  await win.waitForFunction(() => ['pregame', 'playing'].includes(window.__viewerProbe.state().phase), null, { timeout: 15000 })
  await win.evaluate(() => { if (window.__viewerProbe.state().phase === 'pregame') window.__viewerProbe.skipPregame() })
  await win.waitForFunction(() => window.__viewerProbe.state().phase === 'playing', null, { timeout: 15000 })

  // The room: play into the first intermission.
  const firstRoom = Object.keys(plan.room).map(Number).sort()[0]
  if (firstRoom) {
    const st = await win.evaluate(() => window.__viewerProbe.state())
    const events = await win.evaluate(() => window.__viewerProbe.events())
    const end = events.filter((e) => e.type === 'periodEnd')[firstRoom - 1]
    if (end && st.clock < end.absT) {
      // An earlier break on the way (a period with nothing said in the room)
      // stops the cut first: continue it and cut again.
      for (let tries = 0; tries < 3; tries++) {
        await win.evaluate((t) => window.__viewerProbe.jumpTo(t), end.absT - 3)
        await playTo(end.absT + 30, 40000)
        if (await win.locator('.md-room').count()) break
        if (await win.evaluate(() => window.__viewerProbe.state().phase === 'intermission')) await win.evaluate(() => window.__viewerProbe.continueIntermission())
      }
    }
    const ok = await win.waitForSelector('.md-room', { timeout: 8000 }).then(() => true).catch(() => false)
    if (ok) await still('room-intermission')
    if (await win.evaluate(() => window.__viewerProbe.state().phase === 'intermission')) await win.evaluate(() => window.__viewerProbe.continueIntermission())
  }

  // One still per beat (lower-thirds and bench cam), flow strip in every frame.
  const seen = new Set()
  for (const b of plan.beats) {
    const key = `${b.channel}:${b.kind}`
    if (seen.has(key) && seen.size < 6) continue
    if (shots.length >= 9) break
    seen.add(key)
    // A forward cut across a period end stops at that intermission first:
    // continue past it and cut again.
    let r = 'intermission'
    for (let tries = 0; tries < 3 && r === 'intermission'; tries++) {
      await win.evaluate((t) => window.__viewerProbe.jumpTo(t), Math.max(0, b.at - 1.2))
      r = await playTo(b.at + 1.4)
      if (r === 'intermission') await win.evaluate(() => window.__viewerProbe.continueIntermission())
    }
    const sel = b.channel === 'bench' ? '.st-bench' : '.bc-card'
    const ok = await win.waitForSelector(sel, { timeout: 4000 }).then(() => true).catch(() => false)
    if (ok) await still(`${b.channel}-${b.kind}`)
    else console.log(`  ✖ ${b.id} not on screen`)
  }

  // Key Moments with big chances pulled in: wait for the banner.
  await open(best.home, best.away, best.seed)
  await win.evaluate(() => window.__viewerProbe.dropPuck('key'))
  await win.waitForFunction(() => ['pregame', 'playing'].includes(window.__viewerProbe.state().phase), null, { timeout: 15000 })
  await win.evaluate(() => { if (window.__viewerProbe.state().phase === 'pregame') window.__viewerProbe.skipPregame() })
  const t0 = Date.now()
  let banner = false
  while (Date.now() - t0 < 90000) {
    if (await win.locator('.st-chance').count()) { banner = true; break }
    if (await win.evaluate(() => window.__viewerProbe.state().phase === 'intermission')) await win.evaluate(() => window.__viewerProbe.continueIntermission())
    await win.waitForTimeout(200)
  }
  if (banner) { await win.waitForTimeout(1200); await still('key-moments-big-chance') }
  else console.log('  ✖ no big chance banner within 90 s')
} catch (e) {
  failed = true
  console.error('✖', e)
} finally {
  await app.close().catch(() => undefined)
  const after = fingerprint()
  const changed = Object.keys({ ...before, ...after }).filter((f) => before[f] !== after[f])
  if (changed.length) { console.error(`✖ REAL SAVES CHANGED: ${changed.join(', ')}`); failed = true }
  else console.log(`✔ real saves untouched (${Object.keys(after).length} files, SHA1 match)`)
  writeFileSync(join(OUT, 'stills.json'), JSON.stringify({ save: SAVE, shots, savesUntouched: changed.length === 0 }, null, 2))
}
process.exit(failed ? 1 : 0)
