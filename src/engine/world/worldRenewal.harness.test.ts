/**
 * WORLD RENEWAL HARNESS — measures the living world over N seasons on the real
 * imported league (mods/nhl-ehm/database.json, never committed). Reports:
 *   - per-season draft-class stats (nation mix, quality spread, name variety,
 *     share of generated vs imported prospects)
 *   - regular-season daily-advance cost (ms/day)
 *   - gzip save size per season
 *   - junior league health (roster sizes, age mix)
 *
 * Excluded from the normal suite (self-skips). Run on demand:
 *   WR_RUN=1 WR_SEASONS=10 npx vitest run src/engine/world/worldRenewal.harness.test.ts --reporter=verbose --silent=false
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { validateModDatabase, loadModDatabase } from '@data'
import { Career } from '@engine/career/career'
import type { Player } from '@domain'
import { ratedPotential } from '@engine/ratings/composites'

const SEASONS = Number(process.env.WR_SEASONS ?? 3)
const SEED = Number(process.env.WR_SEED ?? 2029)
const MOD_DB = join(process.cwd(), 'mods', 'nhl-ehm', 'database.json')

interface SeasonReport {
  year: number
  msPerDay: number
  daysTimed: number
  offseasonMs: number
  saveGzKB: number
  players: number
  draft?: {
    size: number
    nations: Record<string, number>
    generated: number
    distinctSurnames: number
    top32Nations: Record<string, number>
    potP10: number; potP50: number; potP90: number; top1: number; top10: number; top32: number
  }
  juniors: Record<string, { teams: number; avgRoster: number; ages: Record<number, number> }>
}

function q(a: number[], f: number): number {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.floor(f * (s.length - 1))]! : 0
}

describe.skipIf(!process.env.WR_RUN || !existsSync(MOD_DB))('world renewal harness', () => {
  it(`plays ${SEASONS} seasons and measures the world`, () => {
    const db = validateModDatabase(JSON.parse(readFileSync(MOD_DB, 'utf8')))
    const data = loadModDatabase(db, { seed: SEED })
    const career = new Career(data, SEED, data.league.teams[3]!)
    const reports: SeasonReport[] = []
    const target = career.year + SEASONS
    let cur: SeasonReport | null = null
    let dayMs = 0; let days = 0; let offMs = 0
    const seenDraftYears = new Set<number>()
    let guard = 0
    const startReport = (): SeasonReport => ({ year: career.year, msPerDay: 0, daysTimed: 0, offseasonMs: 0, saveGzKB: 0, players: 0, juniors: {} })
    cur = startReport()
    while (career.year < target && guard++ < 200_000) {
      const dash = career.getDashboard()
      if (career.draftPending()) { career.autoDraft(); continue }
      if (dash.captainsPending) {
        const sq = career.getSquad()
        const c = [...sq.rows].filter((p) => p.position !== 'G').sort((a, b) => b.overall - a.overall)[0]
        if (c) career.setCaptain(c.playerId)
        continue
      }
      if (dash.staffMeetingDue) career.delegateStaffMeeting()
      if (dash.scoutMeetingDue) career.delegateScoutMeeting()
      const phase = career.seasonPhase
      const y0 = career.year
      const t0 = performance.now()
      const ok = career.step()
      const dt = performance.now() - t0
      if (phase === 'regularSeason') { dayMs += dt; days++ } else offMs += dt
      // draft class snapshot once the offseason draft class exists
      const dc = career.data.league.draftClasses[career.data.league.draftClasses.length - 1]
      if (dc && !seenDraftYears.has(dc.year) && career.seasonPhase === 'offseason') {
        seenDraftYears.add(dc.year)
        const ps = dc.prospects.map((pr) => career.data.players.get(pr.playerId)).filter((p): p is Player => !!p)
        const nations: Record<string, number> = {}
        const top32: Record<string, number> = {}
        ps.slice(0, 224).forEach((p, i) => {
          const n = p.nationality ?? '?'
          nations[n] = (nations[n] ?? 0) + 1
          if (i < 32) top32[n] = (top32[n] ?? 0) + 1
        })
        const pots = ps.slice(0, 224).map((p) => ratedPotential(p))
        const sorted = [...pots].sort((a, b) => b - a)
        cur!.draft = {
          size: ps.length,
          nations,
          generated: ps.slice(0, 224).filter((p) => !p.externalId || p.externalId.startsWith('gen-')).length,
          distinctSurnames: new Set(ps.slice(0, 224).map((p) => p.name.split(' ').slice(1).join(' '))).size,
          top32Nations: top32,
          potP10: q(pots, 0.1), potP50: q(pots, 0.5), potP90: q(pots, 0.9),
          top1: sorted[0] ?? 0, top10: sorted[9] ?? 0, top32: sorted[31] ?? 0,
        }
      }
      if (career.year !== y0) {
        // season rolled over: finish the report for y0
        cur!.msPerDay = days ? Math.round((dayMs / days) * 10) / 10 : 0
        cur!.daysTimed = days
        cur!.offseasonMs = Math.round(offMs)
        const snap = career.exportSnapshot('wr', '2026-01-01')
        const json = JSON.stringify(snap)
        cur!.saveGzKB = Math.round(gzipSync(json).length / 1024)
        cur!.players = career.data.players.size
        for (const c of career.data.league.competitions ?? []) {
          if (c.upperAgeLimit === undefined && c.abbrev !== 'NCAA') continue
          const ages: Record<number, number> = {}
          let n = 0
          for (const tid of c.teamIds) for (const pid of career.data.teams.get(tid)?.roster ?? []) {
            const p = career.data.players.get(pid); if (!p) continue
            ages[p.age] = (ages[p.age] ?? 0) + 1; n++
          }
          cur!.juniors[c.abbrev] = { teams: c.teamIds.length, avgRoster: Math.round((n / Math.max(1, c.teamIds.length)) * 10) / 10, ages }
        }
        reports.push(cur!)
        console.log(JSON.stringify(cur))
        dayMs = 0; days = 0; offMs = 0
        cur = startReport()
      }
      if (!ok && career.seasonPhase === y0 as unknown) break
    }
    const outDir = join(process.cwd(), 'docs', 'autopilot')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, `world-renewal-${process.env.WR_TAG ?? 'latest'}.json`), JSON.stringify(reports, null, 2))
    expect(reports.length).toBeGreaterThan(0)
  }, 7_200_000)
})
