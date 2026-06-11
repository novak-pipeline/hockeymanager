/**
 * playerRating.ts — EHM-style per-game rating, form string, and team leader
 * helpers.
 *
 * Pure functions only; no side-effects, no imports from the engine or career
 * layers. The integrator (career.ts) calls these and stores the results.
 *
 * "AvR" rating scale: 0–10.  Typical game ~6.0.  Dominant game 9+.
 */

import type { Position } from '@domain'

/* ─────────────────────────── Extended stat line ─────────────────────────── */

/**
 * Counting-stat extension for hits, blocks, takeaways, and giveaways.
 * The integrator accumulates these from the GameEvent stream; this file
 * provides the type + merge helper only.
 *
 * JSON-safe (all primitives), snapshot-additive (new fields → add with
 * defaults in deserialization).
 */
export interface ExtendedStatLine {
  goals: number
  assists: number
  shots: number
  penaltyMinutes: number
  /** Time on ice, seconds. */
  toi: number
  plusMinus: number
  // Defensive events
  hits: number
  blockedShots: number
  takeaways: number
  giveaways: number
  // Goalie-only; 0 for skaters
  saves: number
  shotsAgainst: number
  goalsAgainst: number
}

export function emptyExtended(): ExtendedStatLine {
  return {
    goals: 0,
    assists: 0,
    shots: 0,
    penaltyMinutes: 0,
    toi: 0,
    plusMinus: 0,
    hits: 0,
    blockedShots: 0,
    takeaways: 0,
    giveaways: 0,
    saves: 0,
    shotsAgainst: 0,
    goalsAgainst: 0,
  }
}

/**
 * Accumulate one game's ExtendedStatLine into a season total in-place.
 * Returns `total` for convenience.
 */
export function mergeExtended(
  total: ExtendedStatLine,
  game: ExtendedStatLine
): ExtendedStatLine {
  total.goals += game.goals
  total.assists += game.assists
  total.shots += game.shots
  total.penaltyMinutes += game.penaltyMinutes
  total.toi += game.toi
  total.plusMinus += game.plusMinus
  total.hits += game.hits
  total.blockedShots += game.blockedShots
  total.takeaways += game.takeaways
  total.giveaways += game.giveaways
  total.saves += game.saves
  total.shotsAgainst += game.shotsAgainst
  total.goalsAgainst += game.goalsAgainst
  return total
}

/* ─────────────────────────── Skater game rating ─────────────────────────── */

export interface SkaterGameRatingArgs {
  goals: number
  assists: number
  shots: number
  hits: number
  blockedShots: number
  takeaways: number
  giveaways: number
  plusMinus?: number
  penaltyMinutes: number
  /** Time on ice, seconds. */
  toi: number
  position: Position
}

/**
 * Compute a 0–10 per-game rating for a skater (EHM "AvR" style).
 *
 * Calibration targets:
 *   - ~6.0  typical game (12–14 min TOI, 1 shot, 1 hit, 1 block for a D)
 *   - ~8.0  strong game (goal + assist, solid possession)
 *   - ~9+   dominant game (hat-trick or 4-point night)
 *   - ~4.0  rough game (giveaways, penalty minutes, no shots)
 *
 * Weighting:
 *   - All positions: production (G+A+shots) matters most.
 *   - D: extra weight on blockedShots + takeaways (their primary job).
 *   - All positions: giveaways and penalty minutes reduce the rating.
 *   - TOI normalises relative to a 20-min baseline (1200 s) so a healthy
 *     scratch isn't punished for 0 TOI (the integrator should only rate
 *     players who dressed).
 */
export function gameRating(args: SkaterGameRatingArgs): number {
  const {
    goals,
    assists,
    shots,
    hits,
    blockedShots,
    takeaways,
    giveaways,
    plusMinus = 0,
    penaltyMinutes,
    toi,
    position,
  } = args

  const isDefenseman = position === 'D'

  // ── Production (positive) ──────────────────────────────────────────────
  const production =
    goals * 2.8 +
    assists * 1.8 +
    shots * 0.18

  // ── Defensive events (positive) ───────────────────────────────────────
  // D get a larger bonus from blocks + takeaways; forwards are rewarded less
  // (they generate them less often and it is less central to their role).
  const blockWeight = isDefenseman ? 0.45 : 0.28
  const takeawayWeight = isDefenseman ? 0.40 : 0.28
  const defenseBonus =
    hits * 0.22 +
    blockedShots * blockWeight +
    takeaways * takeawayWeight

  // ── Negative events ───────────────────────────────────────────────────
  const negatives =
    giveaways * 0.35 +
    Math.max(0, penaltyMinutes) * 0.18

  // ── Plus/minus (small contribution — can be fluky) ────────────────────
  const pmBonus = plusMinus * 0.12

  // ── TOI adjustment: scale so 1200s = 1.0; range ~0.5–1.3 ─────────────
  const toiFactor = Math.min(1.4, Math.max(0.4, toi / 1200))

  // ── Raw score, anchored so that a typical baseline game ≈ 6.0 ─────────
  // Baseline: 0 goals, 0 assists, 1 shot, 1 hit, 1 block (D) / 0 block (F),
  //           1 takeaway, 1 giveaway, 0 PIM, 0 +/-, 900s TOI.
  // After toiFactor (900/1200=0.75) and anchor=6:
  //   D: (0+0.18 + 0.45+0.40 - 0.35 - 0 + 0)*0.75 + 6 ≈ 6.51 → clipped to 6.5
  //   F: (0+0.18 + 0.22+0.28 - 0.35 - 0 + 0)*0.75 + 6 ≈ 6.24 → clipped to 6.2
  // Goal: typical floats around 5.8–6.3; adjust anchor as data matures.
  const anchor = 5.6
  const raw = (production + defenseBonus - negatives + pmBonus) * toiFactor + anchor

  // ── Clamp and round to 2 dp ───────────────────────────────────────────
  return Math.round(Math.min(10, Math.max(0, raw)) * 100) / 100
}

/* ─────────────────────────── Goalie game rating ─────────────────────────── */

export interface GoalieGameRatingArgs {
  saves: number
  shotsAgainst: number
  goalsAgainst: number
  win: boolean
  shutout: boolean
}

/**
 * 0–10 per-game rating for a goalie.
 *
 * Calibration targets:
 *   - ~6.0  average game (~.910 SV%, loss)
 *   - ~7.5  solid win (.920+ SV%)
 *   - ~9.5  shutout win
 *   - ~4.0  rough outing (< .850 SV%, loss)
 */
export function goalieGameRating(args: GoalieGameRatingArgs): number {
  const { saves, shotsAgainst, goalsAgainst, win, shutout } = args

  if (shotsAgainst === 0) {
    // Edge case: goalie faced no shots (very early pull, etc.)
    return win ? 6.5 : 5.5
  }

  const svPct = saves / shotsAgainst

  // ── Save percentage base (centred on .910) ────────────────────────────
  // .910 → 0;  .950 → +4;  .870 → -4
  const svBase = (svPct - 0.91) * 100

  // ── Goals-against penalty (in addition to the SV% signal) ─────────────
  // Each GA subtracts a little; at 0 GA the shutout bonus covers it.
  const gaPenalty = goalsAgainst * 0.3

  // ── Result modifiers ──────────────────────────────────────────────────
  const winBonus = win ? 0.6 : 0
  const shutoutBonus = shutout ? 1.4 : 0

  // ── Workload factor: facing more shots is harder ───────────────────────
  // 25 shots → neutral; 35 → +0.3; 15 → -0.25
  const workloadBonus = (shotsAgainst - 25) * 0.03

  // ── Raw, anchored around 6.0 ──────────────────────────────────────────
  const anchor = 6.0
  const raw = anchor + svBase - gaPenalty + winBonus + shutoutBonus + workloadBonus

  return Math.round(Math.min(10, Math.max(0, raw)) * 100) / 100
}

/* ─────────────────────────── Form string ────────────────────────────────── */

/**
 * EHM-style form string from the last up-to-5 per-game ratings.
 * Each value is rounded to the nearest integer, clamped to 1–10,
 * then joined with '-'.  Most-recent game is last (matches EHM display).
 *
 * E.g. [8.4, 9.1, 7.6, 8.8, 6.2] → "8-9-8-9-6"
 * Fewer than 5 ratings: only those games appear.
 * Empty: returns "—".
 */
export function formString(lastRatings: number[]): string {
  if (lastRatings.length === 0) return '—'

  const recent = lastRatings.slice(-5)
  return recent
    .map(r => Math.min(10, Math.max(1, Math.round(r))))
    .join('-')
}

/* ─────────────────────────── Season average rating ─────────────────────── */

/**
 * Mean of all per-game ratings for the season.
 * Returns 0 if the array is empty.
 */
export function seasonAvgRating(ratings: number[]): number {
  if (ratings.length === 0) return 0
  const sum = ratings.reduce((a, b) => a + b, 0)
  return Math.round((sum / ratings.length) * 100) / 100
}

/* ─────────────────────────── Team leaders view ──────────────────────────── */

export interface TeamLeadersEntry {
  playerId: string
  name: string
  position: Position
  line: ExtendedStatLine
  gamesPlayed: number
  avgRating: number
  /** Goalie-only; undefined for skaters. */
  savePct?: number
  /** Goalie-only; undefined for skaters. */
  gaa?: number
}

/** Single-leader chip (one per stat category, EHM right-rail style). */
export interface LeaderChip {
  playerId: string
  name: string
  value: number
}

/**
 * Per-category team leader board.
 *
 * Each field holds the single leader (highest value) for that category.
 * The integrator can build top-N league leader boards by sorting the same
 * per-player `TeamLeadersEntry` inputs before calling this function.
 *
 * GAA is excluded from skater entries (undefined/0); savePct is excluded
 * from skater entries.  A leader is only surfaced when at least one entry
 * has a non-zero value for that category.  Ties go to the first entry
 * (stable: sort inputs before calling if tie-breaking by GP is desired).
 */
export interface TeamLeadersView {
  goals: LeaderChip | null
  assists: LeaderChip | null
  points: LeaderChip | null
  plusMinus: LeaderChip | null
  pim: LeaderChip | null
  sog: LeaderChip | null
  hits: LeaderChip | null
  shotBlocks: LeaderChip | null
  takeaways: LeaderChip | null
  /** Best (lowest) GAA among qualified goalies. */
  gaa: LeaderChip | null
  /** Best (highest) SV% among qualified goalies. */
  savePct: LeaderChip | null
  /** Highest average rating across all positions. */
  avgRating: LeaderChip | null
}

/**
 * Derive the per-category single leader from a set of player stat entries.
 *
 * Design: one pass, no sort — O(n) across categories.
 *
 * Note on GAA: lower = better. The chip's `value` field stores the raw GAA
 * (callers should format it); the leader is the entry with the lowest GAA
 * among entries that have `gaa !== undefined && gamesPlayed >= 1`.
 *
 * `minGpGoalie`: minimum games played for a goalie to qualify for GAA/SV%
 * boards (default 1 — callers may raise to 10 or 20 for league boards).
 */
export function teamLeaders(args: {
  entries: TeamLeadersEntry[]
  minGpGoalie?: number
}): TeamLeadersView {
  const { entries, minGpGoalie = 1 } = args

  type Candidate = { entry: TeamLeadersEntry; value: number }

  // Pick the best candidate given a value extractor (higher = better).
  function best(
    extract: (e: TeamLeadersEntry) => number | undefined
  ): LeaderChip | null {
    let leader: Candidate | null = null
    for (const entry of entries) {
      const v = extract(entry)
      if (v === undefined || !isFinite(v)) continue
      if (leader === null || v > leader.value) {
        leader = { entry, value: v }
      }
    }
    if (leader === null || leader.value === 0) return null
    return { playerId: leader.entry.playerId, name: leader.entry.name, value: leader.value }
  }

  // Pick the best goalie for a low-is-better stat (GAA).
  function bestGoalieLow(
    extract: (e: TeamLeadersEntry) => number | undefined
  ): LeaderChip | null {
    let leader: Candidate | null = null
    for (const entry of entries) {
      if (entry.gaa === undefined) continue // not a goalie entry
      if (entry.gamesPlayed < minGpGoalie) continue
      const v = extract(entry)
      if (v === undefined || !isFinite(v)) continue
      if (leader === null || v < leader.value) {
        leader = { entry, value: v }
      }
    }
    if (leader === null) return null
    return { playerId: leader.entry.playerId, name: leader.entry.name, value: leader.value }
  }

  const points: LeaderChip | null = best(e => e.line.goals + e.line.assists)
  const goals: LeaderChip | null = best(e => e.line.goals)
  const assists: LeaderChip | null = best(e => e.line.assists)
  const plusMinus: LeaderChip | null = best(e => e.line.plusMinus)
  const pim: LeaderChip | null = best(e => e.line.penaltyMinutes)
  const sog: LeaderChip | null = best(e => e.line.shots)
  const hits: LeaderChip | null = best(e => e.line.hits)
  const shotBlocks: LeaderChip | null = best(e => e.line.blockedShots)
  const takeaways: LeaderChip | null = best(e => e.line.takeaways)
  const avgRating: LeaderChip | null = best(e => e.avgRating)

  const savePct: LeaderChip | null = best(e => {
    if (e.savePct === undefined || e.gamesPlayed < minGpGoalie) return undefined
    return e.savePct
  })

  const gaa: LeaderChip | null = bestGoalieLow(e => e.gaa)

  return {
    goals,
    assists,
    points,
    plusMinus,
    pim,
    sog,
    hits,
    shotBlocks,
    takeaways,
    gaa,
    savePct,
    avgRating,
  }
}
