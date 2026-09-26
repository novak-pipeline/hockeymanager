/**
 * LOOP-MEASURE HARNESS (PHASE 0 interruption diet; depth audit 2026-09 §0).
 *
 * Walks ONE career year from the summer takeover, pressing Continue exactly the
 * way the shell does (the pure `routeContinue` law in beatGates.ts plus the
 * shell's scene auto-open, `sceneToOpen`), delegating every beat — the B2.3
 * "delegate everything" playthrough — and tallies every interruption:
 *
 *   - Continue presses by kind (advance / route / spend / hardGate / autoOpen)
 *   - Processing-overlay HOLDS (`shouldHoldOverlay`, the same rule App.tsx uses)
 *   - blocking beat gates by key (trade offers, staff/scout meetings, board…)
 *   - clicks per user game over the regular season:
 *       advance = 1 (+1 if the overlay holds) · route = 1 · spend = 1 ·
 *       hard gate = 2 (route + its one-click fix) · auto-opened scene = 0
 *       (the scene replaces the overlay; the Continue inside it is its spend).
 *
 * Self-skipping (it sims a full year): run on demand with LOOP_RUN=1.
 *
 *   LOOP_RUN=1 M_DB="K:/Hockey Game/mods/nhl-ehm/database.json" M_SEED=2029 M_TEAM=pitts \
 *     npx vitest run src/renderer/lib/loopMeasure.harness.test.ts
 *
 * Env: M_SEED (default 313) · M_DB (imported database.json; vanilla league when
 * absent) · M_TEAM (team-name substring) · M_OUT (TSV path for the per-press log).
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { generateLeague } from '@data/generate'
import { loadModDatabase, validateModDatabase } from '@data'
import { Career } from '@engine/career/career'
import * as gates from '@engine/career/beatGates'
import type { LastRoute } from '@engine/career/beatGates'
import { shouldHoldOverlay, worthAStop } from './cadence'

type Row = {
  i: number
  phase: string
  date: string
  day: number
  label: string
  kind: string
  gate: string
  news: number
  stops: number
  hold: boolean
  receipt: boolean
  userGame: boolean
  inter: string
  owner: string
  headlines: string[]
  stopCats: string[]
}

describe.skipIf(!process.env.LOOP_RUN)('loop measure — one delegated year', () => {
  it('walks a year of Continue and tallies interruptions', () => {
    const seed = Number(process.env.M_SEED ?? 313)
    const db = process.env.M_DB ?? ''
    const data = db && existsSync(db)
      ? loadModDatabase(validateModDatabase(JSON.parse(readFileSync(db, 'utf8'))), { seed })
      : generateLeague({ seed })
    const want = process.env.M_TEAM
    const tid = want
      ? data.league.teams.find((t) => (data.teams.get(t)?.name ?? '').toLowerCase().includes(want.toLowerCase())) ?? data.league.teams[0]!
      : data.league.teams[0]!
    const c = new Career(data, seed, tid)
    c.startAtOffseason()
    // The shell's scene auto-open (PHASE 0), when this build has one.
    const sceneToOpen = (gates as Record<string, unknown>)['sceneToOpen'] as
      | ((d: unknown, prev: unknown) => { key: string; screen: string } | null)
      | undefined
    let screen = 'dashboard'
    let lastRoute: LastRoute | null = null
    const rows: Row[] = []
    const seenNews = new Set<string>(c.getInbox().items.map((n) => n.id))
    const seenInter = new Set<string>()
    let seenOwner = ''
    let sawPlayoffs = false
    let stop = false
    const t0 = Date.now()
    for (let i = 0; i < 1500 && !stop; i++) {
      if (screen === 'devCamp' && c.getDevCamp() === null) screen = 'dashboard'
      if (screen === 'trainingCamp' && c.getTrainingCamp() === null) screen = 'dashboard'
      if (screen === 'boardMeeting' && c.getBoardMeeting() === null) screen = 'dashboard'
      const d = c.getDashboard()
      const dec = gates.routeContinue({ dashboard: d, screen, lastRoute })
      let kind = dec.kind as string
      let gate = ''
      let advanced = false
      if (dec.kind === 'hardGate') {
        gate = dec.screen
        lastRoute = null
        screen = dec.screen
        if (dec.screen === 'draft') c.autoDraft()
        else if (dec.screen === 'squad') c.signEmergencyCover()
        else c.nameCaptainByCoach()
      } else if (dec.kind === 'route') {
        gate = dec.gate.key
        lastRoute = { screen: dec.gate.screen, label: d.continueLabel }
        screen = dec.gate.screen
      } else {
        if (dec.kind === 'spend') gate = dec.gate.key
        lastRoute = null
        c.step()
        advanced = true
        screen = 'dashboard'
      }
      const d2 = c.getDashboard()
      // What arrived.
      const inbox = c.getInbox()
      const fresh = inbox.items.filter((n) => !seenNews.has(n.id))
      for (const n of fresh) seenNews.add(n.id)
      const stopping = fresh.filter((n) => worthAStop(n))
      const receipt = !!d2.lastResult && d2.lastResult.day !== d.lastResult?.day && d2.phase !== 'offseason'
      // A scene that opened itself on this advance replaces the overlay.
      let opened = ''
      if (advanced && sceneToOpen) {
        const s = sceneToOpen(d2, d)
        if (s) { opened = s.key; screen = s.screen }
      }
      const hold = dec.kind === 'advance' && !opened && shouldHoldOverlay(fresh, receipt)
      const newInter = (inbox.interactions ?? []).filter((x) => !seenInter.has(x.id))
      for (const x of newInter) seenInter.add(x.id)
      const own = c.getOwnerRequest()
      const ownKey = own ? `${own.kind}:${own.body.slice(0, 40)}` : ''
      const newOwner = own && ownKey !== seenOwner ? own.kind : ''
      if (own) seenOwner = ownKey
      rows.push({
        i, phase: d.phase, date: d.date, day: d.day ?? 0, label: d.continueLabel, kind, gate,
        news: fresh.length, stops: stopping.length, hold, receipt, userGame: receipt,
        inter: newInter.map((x) => `${x.severity}/${x.kind}${x.scene ? '/scene' : ''}`).join(';'),
        owner: newOwner,
        headlines: stopping.slice(0, 4).map((n) => n.headline),
        stopCats: stopping.map((n) => n.category + (n.reach ? `:${n.reach}` : '') + (n.press ? ':press' : '')),
      })
      if (opened) {
        rows.push({
          i, phase: d2.phase, date: d2.date, day: d2.day ?? 0, label: d2.continueLabel, kind: 'autoOpen', gate: opened,
          news: 0, stops: 0, hold: false, receipt: false, userGame: false, inter: '', owner: '', headlines: [], stopCats: [],
        })
      }
      if (d2.phase === 'playoffs') sawPlayoffs = true
      if (sawPlayoffs && d2.phase === 'regularSeason' && (d2.day ?? 0) > 0) stop = true
      if (sawPlayoffs && d2.phase === 'offseason' && (d2.offseasonStageLabel ?? '').startsWith('Training')) stop = true
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    const season = rows.filter((r) => r.phase === 'regularSeason' && r.day > 0)
    const games = season.filter((r) => r.userGame).length
    const adv = season.filter((r) => r.kind === 'advance')
    const holds = adv.filter((r) => r.hold).length
    const routes = season.filter((r) => r.kind === 'route').length
    const spends = season.filter((r) => r.kind === 'spend').length
    const hard = season.filter((r) => r.kind === 'hardGate').length
    const autoOpens = season.filter((r) => r.kind === 'autoOpen').length
    const clicks = adv.length + holds + routes + spends + hard * 2
    const gateCount = new Map<string, number>()
    for (const r of season) {
      if (r.kind === 'route' || r.kind === 'autoOpen' || r.kind === 'hardGate') {
        gateCount.set(r.gate, (gateCount.get(r.gate) ?? 0) + 1)
      }
    }
    const blocking = [...gateCount.values()].reduce((a, b) => a + b, 0)
    const whyHold = new Map<string, number>()
    for (const r of adv) {
      if (!r.hold) continue
      const key = r.receipt ? 'receipt' : [...new Set(r.stopCats)].sort().join('+')
      whyHold.set(key, (whyHold.get(key) ?? 0) + 1)
    }
    const offseason = rows.filter((r) => r.phase !== 'regularSeason' || r.day === 0)
    const emptyPlayoff = rows.filter((r) => r.phase === 'playoffs' && r.news === 0 && r.kind === 'advance').length
    const maxDump = Math.max(0, ...rows.map((r) => r.news))
    const summary = {
      presses: rows.length,
      seasonPresses: season.length,
      userGames: games,
      advances: adv.length,
      holds,
      holdPct: adv.length ? Math.round((100 * holds) / adv.length) : 0,
      blockingGates: blocking,
      gatesByKey: Object.fromEntries([...gateCount.entries()].sort((a, b) => b[1] - a[1])),
      routes, spends, hardGates: hard, autoOpens,
      clicks,
      clicksPerGame: games ? +(clicks / games).toFixed(2) : 0,
      offseasonPresses: offseason.length,
      emptyPlayoffPresses: emptyPlayoff,
      biggestDump: maxDump,
      interactions: rows.filter((r) => r.inter).map((r) => `${r.date} ${r.inter}`),
      holdReasons: Object.fromEntries([...whyHold.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)),
      ms: Date.now() - t0,
    }
    const out = process.env.M_OUT ?? 'loop-measure.tsv'
    writeFileSync(
      out,
      'i\tphase\tdate\tday\tlabel\tkind\tgate\tnews\tstops\thold\treceipt\tinteractions\towner\theadlines\n' +
        rows.map((r) => [
          r.i, r.phase, r.date, r.day, JSON.stringify(r.label), r.kind, r.gate, r.news, r.stops,
          r.hold ? 1 : 0, r.receipt ? 1 : 0, r.inter, r.owner, JSON.stringify(r.headlines),
        ].join('\t')).join('\n'),
    )
    writeFileSync(out.replace(/\.tsv$/, '') + '.summary.json', JSON.stringify(summary, null, 2))
    console.log('[loop-measure]', JSON.stringify(summary, null, 2))
    expect(rows.length).toBeGreaterThan(0)
  }, 3_600_000)
})
