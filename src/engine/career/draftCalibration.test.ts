/**
 * Draft calibration simulation — a runnable harness that measures how well the
 * prospect-ranking model works against the hidden truth, and whether development
 * pays that truth out (reaches & sleepers).
 *
 * Run it on its own to read the report:
 *   npx vitest run src/engine/career/draftCalibration.test.ts
 *
 * It checks three things the truth-vs-perception model should produce:
 *   1. SIGNAL — the analyst board's top prospects really do have higher hidden
 *      true potential than the bottom (the board isn't noise).
 *   2. VARIANCE — it's not a perfect mirror of truth: some highly-ranked players
 *      are reaches and some low-ranked are sleepers (perception ≠ truth).
 *   3. PAYOUT — over the following seasons, players develop toward their HIDDEN
 *      true potential (so the board's hits and misses actually resolve on ice).
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { buildCompetitions, type RawCompetition } from '@data/leagueWorld'
import { agedPotential, ratedOverall } from '@engine/ratings/composites'
import { Career } from './career'

/** Pearson correlation of two equal-length series (0 if undefined). */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  const d = Math.sqrt(sxx * syy)
  return d === 0 ? 0 : sxy / d
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0)

describe('draft calibration simulation', () => {
  it('board has signal + variance, and development pays out the hidden truth', () => {
    const SEED = 77
    const data = generateLeague({ seed: SEED })
    // Stand up a junior competition over a slice of teams.
    const teamIds = data.league.teams.slice(0, 8)
    const comps: RawCompetition[] = [
      { id: 'whl', name: 'Western Hockey League', abbrev: 'WHL', nation: 'Canada', level: 1, reputation: 14 },
    ]
    data.league.competitions = buildCompetitions({
      comps,
      membership: teamIds.map((teamId) => ({ teamId, competitionId: 'whl' })),
      season: 2025,
    })
    // Force a draft-eligible cohort (17–18, undrafted) on those teams.
    const cohort = []
    let i = 0
    for (const tid of teamIds) {
      const t = data.teams.get(tid)!
      for (const pid of t.roster) {
        const p = data.players.get(pid)!
        p.age = 17 + (i++ % 2)
        p.nhlDrafted = false
        cohort.push(p)
      }
    }

    const career = new Career(data, SEED, data.league.teams[10] ?? data.league.teams[0]!)

    // Hidden truth + starting ability, snapshotted before anyone develops.
    const truePA = new Map<string, number>()
    const startOvr = new Map<string, number>()
    for (const p of cohort) {
      truePA.set(p.id as unknown as string, agedPotential(p))
      startOvr.set(p.id as unknown as string, ratedOverall(p))
    }

    // The published board (perception).
    const board = career.getDraftRankings().rankings
    expect(board.length).toBeGreaterThan(20)
    const rows = board.map((r) => ({
      rank: r.rank,
      name: r.name,
      truePA: truePA.get(r.playerId) ?? 0,
    })).filter((r) => r.truePA > 0)

    // 1) SIGNAL: top third's true PA clearly above the bottom third's.
    const third = Math.max(3, Math.floor(rows.length / 3))
    const topTrue = mean(rows.slice(0, third).map((r) => r.truePA))
    const botTrue = mean(rows.slice(-third).map((r) => r.truePA))
    // Rank↔truePA correlation (rank 1 = best, so expect negative).
    const rankTrueCorr = pearson(rows.map((r) => r.rank), rows.map((r) => r.truePA))

    // 2) VARIANCE: reaches (top-third rank, bottom-half true) & sleepers (vice-versa).
    const sortedByTrue = [...rows].sort((a, b) => b.truePA - a.truePA)
    const trueRank = new Map(sortedByTrue.map((r, idx) => [r.name, idx + 1]))
    let reaches = 0, sleepers = 0
    for (const r of rows) {
      const tr = trueRank.get(r.name)!
      if (r.rank <= third && tr > rows.length / 2) reaches++
      if (r.rank > rows.length - third && tr <= rows.length / 2) sleepers++
    }

    // 3) PAYOUT: sim a few seasons (development is mostly an offseason pass) and
    // check that the hidden true PA drives where players END UP — i.e. high-true
    // prospects develop into higher-ability players. (Correlating true PA with
    // raw GAIN is misleading: gain ∝ headroom = PA−CA, so a high-PA player who's
    // already close to his ceiling gains little.)
    const startYear = career.year
    let guard = 0
    while (career.year < startYear + 3 && guard++ < 12000) career.step()
    const trueArr: number[] = []
    const finalArr: number[] = []
    const gains: number[] = []
    for (const p of cohort) {
      const id = p.id as unknown as string
      trueArr.push(truePA.get(id) ?? 0)
      finalArr.push(ratedOverall(p))
      gains.push(ratedOverall(p) - (startOvr.get(id) ?? 0))
    }
    const payoutCorr = pearson(trueArr, finalArr) // true PA ↔ where they ended up

    // ── Report ──────────────────────────────────────────────────────────────
    /* eslint-disable no-console */
    console.log('\n=== DRAFT CALIBRATION ===')
    console.log(`cohort=${cohort.length}  board=${rows.length}  seasonsSimmed=${career.year - startYear + 1}`)
    console.log(`SIGNAL : top-third true PA ${topTrue.toFixed(1)} vs bottom-third ${botTrue.toFixed(1)}  (rank↔truePA r=${rankTrueCorr.toFixed(2)})`)
    console.log(`VARIANCE: ${reaches} reaches, ${sleepers} sleepers of ${rows.length}`)
    console.log(`PAYOUT : truePA↔final-ability r=${payoutCorr.toFixed(2)}  (avg gain ${mean(gains).toFixed(1)} over ${career.year - startYear} seasons)`)
    console.log('top 8 board:')
    for (const r of rows.slice(0, 8)) console.log(`  #${r.rank} ${r.name.padEnd(22)} truePA ${r.truePA}`)
    /* eslint-enable no-console */

    // ── Sanity assertions (loose — this is a calibration probe, not a unit) ──
    expect(topTrue).toBeGreaterThan(botTrue)          // the board has real signal
    expect(rankTrueCorr).toBeLessThan(0)              // better rank ⇒ higher true PA
    expect(reaches + sleepers).toBeGreaterThan(0)     // perception ≠ truth (variance)
    expect(payoutCorr).toBeGreaterThan(0.3)           // development pays out the truth
  }, 120_000)
})
