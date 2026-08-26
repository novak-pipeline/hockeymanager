/**
 * Acceptance harness for a refreshed real-roster mod (see
 * docs/MOD-DB-2026-UPDATE.md and scripts/dev/mod-refresh/).
 *
 * Not a unit test: it validates the local dev mod, loads a career from it, and
 * sims a full year-cycle to prove the file is actually playable — the check the
 * refresh pipeline has to pass before a rebuilt database.json is installed.
 * Takes minutes, and the mod it reads is dev-only and never committed, so it
 * skips unless MODCHECK is set (and unless the file is actually there). That
 * keeps `npm test` fast without needing a vitest.config exclusion, which would
 * also block running it by name.
 *
 * Run it on demand:
 *   MODCHECK=1 npx vitest run src/data/modRefresh.verify.test.ts --no-file-parallelism
 *   MODCHECK=1 MODDB=/path/to/database.json npx vitest run src/data/modRefresh.verify.test.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Career } from '@engine/career/career'
import { loadModDatabase, validateModDatabase } from './modSchema'

const DB = process.env.MODDB ?? 'K:/Hockey Game/mods/nhl-ehm/database.json'
const enabled = Boolean(process.env.MODCHECK) && existsSync(DB)

describe.skipIf(!enabled)('refreshed real-roster mod', () => {
  it('validates, loads and sims a full season', () => {
    const mod = validateModDatabase(JSON.parse(readFileSync(DB, 'utf8')) as unknown)
    console.log(`validated: ${mod.meta.name} / ${mod.meta.season}`)

    const data = loadModDatabase(mod, { seed: 4242, startYear: 2026 })
    const nhl = data.league.teams.map((id) => data.teams.get(id)!)
    console.log(`loaded: ${data.players.size} players, ${data.teams.size} teams, ${nhl.length} NHL clubs, ${data.league.competitions?.length ?? 0} competitions`)

    // Every NHL club must be able to ice a legal lineup.
    for (const t of nhl) {
      expect(t.roster.length, `${t.abbreviation} roster`).toBeGreaterThanOrEqual(18)
      const g = t.roster.filter((id) => data.players.get(id)?.position === 'G').length
      expect(g, `${t.abbreviation} goalies`).toBeGreaterThanOrEqual(2)
    }

    const userTid = data.league.teams[0]!
    const career = new Career(data, 4242, userTid)
    const startYear = career.year
    let prevPhase = career.seasonPhase
    let guard = 0
    let tablesChecked = 0
    let champions = 0
    const news: string[] = []
    const seen = new Set<string>()
    const grab = (): void => {
      for (const n of career.getInbox().items) {
        const k = `${n.day}|${n.headline}`
        if (!seen.has(k)) { seen.add(k); news.push(`${n.headline} ${n.body}`) }
      }
    }

    while (career.year < startYear + 1 && guard++ < 40000) {
      if (career.draftPending()) { career.autoDraft(); continue }
      career.step()
      const phase = career.seasonPhase
      if (phase === prevPhase) continue
      grab()
      if (prevPhase === 'regularSeason') {
        const rows = career.getStandings().overall
        for (const r of rows) {
          expect(r.gamesPlayed, `${r.abbreviation} GP`).toBe(82)
          expect(r.points, `${r.abbreviation} points math`).toBe(2 * r.wins + r.overtimeLosses)
        }
        const top = [...rows].sort((a, b) => b.points - a.points).slice(0, 6)
        console.log('top 6:', top.map((r) => `${r.abbreviation} ${r.points}`).join(', '))
        tablesChecked++
      }
      if (phase === 'offseason' && news.some((n) => /champion|stanley|wins the (cup|final|title)/i.test(n))) champions++
      prevPhase = phase
    }
    grab()

    const leaders = [...data.players.values()]
      .filter((p) => p.position !== 'G')
      .map((p) => ({ name: p.name, s: p.stats.find((x) => x.league !== 'ahl') }))
      .filter((x) => x.s !== undefined && x.s.gamesPlayed > 0)
      .map((x) => {
        const s = x.s!
        const g = s.ev.goals + s.pp.goals + s.pk.goals
        const a = s.ev.assists + s.pp.assists + s.pk.assists
        return { name: x.name, pts: g + a, g, a, gp: s.gamesPlayed }
      })
      .sort((a, b) => b.pts - a.pts)
    console.log('scoring leaders:', leaders.slice(0, 8).map((l) => `${l.name} ${l.pts} (${l.g}G ${l.a}A in ${l.gp})`).join(' | '))

    expect(tablesChecked).toBeGreaterThan(0)
    expect(champions).toBeGreaterThan(0)
    // A season's scoring race should look like the NHL's, not like noise.
    expect(leaders[0]!.pts).toBeGreaterThan(70)
    expect(leaders[0]!.pts).toBeLessThan(180)
  }, 900_000)
})
