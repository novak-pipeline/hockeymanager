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
import { agedPotential, ratedOverall, computeComposites } from '@engine/ratings/composites'
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
        // Give them real prospect headroom: drop current ability well below their
        // (unchanged) potential, so development actually has somewhere to go.
        for (const grp of [p.ratings.technical, p.ratings.physical, p.ratings.mental, p.ratings.goalie]) {
          if (!grp) continue
          const g = grp as unknown as Record<string, number>
          for (const k of Object.keys(g)) {
            if (k === 'height') continue
            g[k] = Math.max(8, Math.round(g[k] * 0.62))
          }
        }
        p.composites = computeComposites(p.ratings, p.role, p.position)
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
      playerId: r.playerId,
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

    // ── OUTCOMES: end-to-end draft-rank ↔ realised ability, + base rates by
    // board tier. Real-world targets (public draft-research base rates):
    //   • draft-pick ↔ career-value correlation ≈ 0.40–0.50 (Spearman). Ours is
    //     measured rank↔final; we want |r| in roughly that band.
    //   • NHLer rate falls steeply by tier; busts among 1st-rounders are common.
    const outcome = new Map<string, number>() // playerId → final overall
    for (const p of cohort) outcome.set(p.id as unknown as string, ratedOverall(p))
    const finalByRank = rows.map((r) => outcome.get(r.playerId ?? '') ?? 0)
    const rankOutcomeCorr = pearson(rows.map((r) => r.rank), finalByRank)

    const NHLER = 58 // ~ a regular NHLer (depth/3rd-line) on the 0–100 scale
    const STAR = 76 //  ~ a top-six forward / top-pair defenceman
    const tierRate = (lo: number, hi: number, thresh: number): number => {
      const slice = rows.slice(lo, hi)
      if (slice.length === 0) return 0
      const hit = slice.filter((r) => (outcome.get(r.playerId) ?? 0) >= thresh).length
      return hit / slice.length
    }
    const top10NHLer = tierRate(0, 10, NHLER)
    const midNHLer = tierRate(10, 32, NHLER)
    const lateNHLer = tierRate(32, rows.length, NHLER)
    const top10Star = tierRate(0, 10, STAR)
    const top10Bust = 1 - top10NHLer // first-tier picks who never became NHLers

    // ── Report (process.stdout so it shows even on a passing run) ─────────────
    const pct = (x: number): string => `${Math.round(x * 100)}%`
    const lines = [
      '\n=== DRAFT CALIBRATION ===',
      `cohort=${cohort.length}  board=${rows.length}  seasonsSimmed=${career.year - startYear}`,
      `SIGNAL  : top-third true PA ${topTrue.toFixed(1)} vs bottom-third ${botTrue.toFixed(1)}  (rank↔truePA r=${rankTrueCorr.toFixed(2)})`,
      `VARIANCE: ${reaches} reaches, ${sleepers} sleepers of ${rows.length}`,
      `PAYOUT  : truePA↔final r=${payoutCorr.toFixed(2)}  (avg gain ${mean(gains).toFixed(1)})`,
      `OUTCOME : rank↔final r=${rankOutcomeCorr.toFixed(2)}  (real target ≈ −0.45)`,
      `NHLer%  : top10 ${pct(top10NHLer)} · 11–32 ${pct(midNHLer)} · 33+ ${pct(lateNHLer)}`,
      `top10   : star ${pct(top10Star)} · bust ${pct(top10Bust)}`,
    ]
    process.stdout.write(lines.join('\n') + '\n')

    // ── Calibration assertions vs real-world structure ──
    expect(topTrue).toBeGreaterThan(botTrue)              // board has signal
    expect(rankTrueCorr).toBeLessThan(0)                 // better rank ⇒ higher true PA
    // End-to-end predictability in the real ~0.45 band (not deterministic, not noise).
    expect(Math.abs(rankOutcomeCorr)).toBeGreaterThan(0.30)
    expect(Math.abs(rankOutcomeCorr)).toBeLessThan(0.65)
    // Development is probabilistic, not destiny.
    expect(payoutCorr).toBeGreaterThan(0.45)
    expect(payoutCorr).toBeLessThan(0.92)
    expect(mean(gains)).toBeGreaterThan(4)               // prospects actually develop
    // Outcome base rates fall by tier, and top picks still bust sometimes.
    expect(top10NHLer).toBeGreaterThanOrEqual(midNHLer)
    expect(midNHLer).toBeGreaterThanOrEqual(lateNHLer)
    expect(top10Bust).toBeGreaterThan(0)
  }, 120_000)
})
