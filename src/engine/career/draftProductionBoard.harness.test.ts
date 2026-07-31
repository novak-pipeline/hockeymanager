/**
 * Draft-board PRODUCTION harness (E1 of the 2026-07-31 playtest).
 *
 * The playtest found a 141-point 18-year-old (64gp, 96-45-141 in the MHL) ranked
 * #60 on the consensus board. This harness dumps the top 60 of a generated class
 * WITH each prospect's stat line and NHL-equivalent rate, so the ordering can be
 * eyeballed for sanity: an elite NHLe producer must sit at the top of the board,
 * a no-show must slide, and the board must still be tools-aware rather than a
 * pure points leaderboard.
 *
 * A reporting harness, not an assertion (the gates live in
 * `draftBoardProduction.test.ts` and `draftRankings.test.ts`). Self-skips under
 * the normal suite so it doesn't dump 60 lines into every run:
 *   DRAFT_BOARD_DUMP=1 npx vitest run src/engine/career/draftProductionBoard.harness.test.ts
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { buildCompetitions, type RawCompetition } from '@data/leagueWorld'
import { agedPotential, computeComposites, ratedOverall } from '@engine/ratings/composites'
import { nhleFactorByAbbrev } from '@engine/league/leagueStrength'
import { Career } from './career'

/** Deterministic [0,1) from a string. */
function unit(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0) / 0x100000000
}

describe.skipIf(!process.env.DRAFT_BOARD_DUMP)('draft board production harness', () => {
  it('dumps the top 60 of a generated class with production', () => {
    const SEED = 2029
    const data = generateLeague({ seed: SEED })
    // Three feeder leagues of very different strength, so the dump shows whether
    // league-strength translation is doing its job (MHL 0.20 vs NCAA 0.40).
    const leagues = [
      { id: 'mhl', abbrev: 'MHL', name: 'Molodyozhnaya Hockey League', reputation: 11 },
      { id: 'ohl', abbrev: 'OHL', name: 'Ontario Hockey League', reputation: 13 },
      { id: 'ncaa', abbrev: 'NCAA', name: 'NCAA Division I', reputation: 14 },
    ]
    const pool = data.league.teams.slice(0, 12)
    const comps: RawCompetition[] = leagues.map((l) => ({
      id: l.id, name: l.name, abbrev: l.abbrev, nation: 'World', level: 1, reputation: l.reputation,
    }))
    data.league.competitions = buildCompetitions({
      comps,
      membership: pool.map((teamId, i) => ({ teamId, competitionId: leagues[i % 3]!.id })),
      season: 2025,
    })
    const leagueOfTeam = new Map<string, string>()
    pool.forEach((tid, i) => leagueOfTeam.set(tid as string, leagues[i % 3]!.abbrev))

    // Force a draft-eligible cohort with real headroom, and give every one of them
    // a LAST-SEASON stat line — the same `careerHistory` the pre-draft board reads
    // before a new campaign has accrued games. Production spans no-show → historic.
    let i = 0
    const cohort: Array<{ id: string; name: string; gp: number; g: number; a: number; lg: string }> = []
    for (const tid of pool) {
      const t = data.teams.get(tid)!
      const lg = leagueOfTeam.get(tid as string)!
      for (const pid of t.roster) {
        const p = data.players.get(pid)!
        p.age = 17 + (i % 2)
        p.nhlDrafted = false
        for (const grp of [p.ratings.technical, p.ratings.physical, p.ratings.mental, p.ratings.goalie]) {
          if (!grp) continue
          const g = grp as unknown as Record<string, number>
          for (const k of Object.keys(g)) {
            if (k === 'height') continue
            g[k] = Math.max(8, Math.round(g[k] * 0.62))
          }
        }
        p.composites = computeComposites(p.ratings, p.role, p.position)
        // Feeder-league scoring on real-world shape, independent of ratings so
        // production is a signal the board either uses or ignores. Right-skewed
        // (most kids are ordinary, a handful dominate) with a top end near 1.6–1.8
        // ppg, which is where real MHL/OHL/NCAA leaders actually live; defencemen
        // at ~55% of a forward's rate, matching the positional par (0.13 vs 0.22
        // NHLe); and a gentle tilt so weaker leagues run slightly hotter raw rates.
        const u = unit(`${p.id as string}:ppg`)
        const posMult = p.position === 'D' ? 0.55 : 1
        const lgMult = Math.pow(0.28 / nhleFactorByAbbrev(lg), 0.35)
        const ppg = p.position === 'G' ? 0 : (0.12 + u * u * u * 1.55) * posMult * lgMult
        const gp = 60 + Math.round(unit(`${p.id as string}:gp`) * 8)
        const pts = Math.round(ppg * gp)
        const goals = Math.round(pts * (0.35 + unit(`${p.id as string}:g`) * 0.25))
        const assists = pts - goals
        p.careerHistory = [{
          year: 2025, club: t.name, league: lg, gamesPlayed: gp,
          goals, assists, penaltyMinutes: 0, plusMinus: 0, minutes: 0,
          goalsAgainst: 0, shutouts: 0, wins: 0, losses: 0, otLosses: 0, saves: 0,
        }]
        cohort.push({ id: p.id as string, name: p.name, gp, g: goals, a: assists, lg })
        i++
      }
    }
    // One planted MONSTER: the playtest's Viktor Fyodorov line, 96-45-141 in 64
    // MHL games, on a prospect with unremarkable tools. He must not rank #60.
    const mhlTeam = pool.find((tid) => leagueOfTeam.get(tid as string) === 'MHL')!
    const monsterId = [...data.teams.get(mhlTeam)!.roster].find((pid) => {
      const p = data.players.get(pid)!
      return p.position !== 'G'
    })!
    const monster = data.players.get(monsterId)!
    monster.name = 'Viktor Fyodorov'
    monster.age = 18
    monster.careerHistory = [{
      year: 2025, club: data.teams.get(mhlTeam)!.name, league: 'MHL', gamesPlayed: 64,
      goals: 96, assists: 45, penaltyMinutes: 0, plusMinus: 0, minutes: 0,
      goalsAgainst: 0, shutouts: 0, wins: 0, losses: 0, otLosses: 0, saves: 0,
    }]
    const mRow = cohort.find((c) => c.id === (monsterId as string))!
    mRow.name = 'Viktor Fyodorov'; mRow.gp = 64; mRow.g = 96; mRow.a = 45; mRow.lg = 'MHL'

    const career = new Career(data, SEED, data.league.teams[20] ?? data.league.teams[0]!)
    const view = career.getDraftRankings()
    const byId = new Map(cohort.map((c) => [c.id, c]))

    const lines: string[] = [
      '',
      '=== DRAFT BOARD — TOP 60 (production vs rank) ===',
      `phase=${view.phase}  class=${view.draftYear}  cohort=${cohort.length}`,
      'rank  pos age lg    line              ppg   NHLe   ovr  pot  name',
    ]
    for (const r of view.rankings.slice(0, 60)) {
      const c = byId.get(r.playerId)
      const p = data.players.get(r.playerId as never)!
      const ppg = c && c.gp > 0 ? (c.g + c.a) / c.gp : 0
      const nhle = ppg * nhleFactorByAbbrev(c?.lg ?? '')
      const line = c ? `${String(c.gp).padStart(2)}gp ${c.g}-${c.a}-${c.g + c.a}` : '—'
      lines.push(
        `${String(r.rank).padStart(4)}  ${r.position.padEnd(3)} ${r.age}  ${(c?.lg ?? '?').padEnd(5)} ` +
        `${line.padEnd(17)} ${ppg.toFixed(2)}  ${nhle.toFixed(3)}  ` +
        `${String(ratedOverall(p)).padStart(3)}  ${String(agedPotential(p)).padStart(3)}  ${r.name}`,
      )
    }
    const monsterRank = view.rankings.find((r) => r.playerId === (monsterId as string))?.rank
    const full = view.fullRankById[monsterId as string]
    const mNhle = (141 / 64) * nhleFactorByAbbrev('MHL')
    lines.push(`\nPLANTED MONSTER  Viktor Fyodorov (18, MHL, 64gp 96-45-141, ppg 2.20, NHLe ${mNhle.toFixed(3)})`)
    lines.push(`  tools: ovr ${ratedOverall(monster)} / pot ${agedPotential(monster)} (deliberately unremarkable)`)
    lines.push(`  board rank = ${monsterRank ?? `off top-64 (full #${full})`}`)
    // Correlation of NHLe rate with board position over the published board.
    const ranked = view.rankings
      .map((r) => ({ rank: r.rank, nhle: (() => { const c = byId.get(r.playerId); return c && c.gp ? ((c.g + c.a) / c.gp) * nhleFactorByAbbrev(c.lg) : 0 })() }))
      .filter((x) => x.nhle > 0)
    const n = ranked.length
    const mx = ranked.reduce((s, v) => s + v.rank, 0) / n
    const my = ranked.reduce((s, v) => s + v.nhle, 0) / n
    let sxy = 0, sxx = 0, syy = 0
    for (const v of ranked) { const dx = v.rank - mx, dy = v.nhle - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
    const corr = sxy / Math.sqrt(sxx * syy)
    lines.push(`  rank↔NHLe r = ${corr.toFixed(2)} (negative = better rank ⇒ more production)`)
    process.stdout.write(lines.join('\n') + '\n')

    expect(view.rankings.length).toBeGreaterThan(30)
  }, 120_000)
})
