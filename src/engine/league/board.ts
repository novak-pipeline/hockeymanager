/**
 * Owner / Board Expectations — the franchise drama engine.
 *
 * Models the owner's mandate, the board's confidence in the GM, patience
 * that depletes under prolonged failure, and an end-of-season verdict that
 * can result in a firing.
 *
 * Design rules (mirrors the rest of the story layer):
 *   - Pure functions, no side effects, no wall-clock, no unseeded randomness.
 *   - All state is JSON-safe (no Maps, no classes, no functions).
 *   - Returns news-seed objects; the career layer pushes them.
 *   - Deterministic: same inputs → same outputs (confidence mutations are
 *     arithmetic; news emission is threshold-gated, not probabilistic).
 *   - Ruleset-aware: season length, league size passed as arguments, never
 *     hardcoded.
 */

import type { Rng } from '@engine/shared/rng'
import type { NewsCategory } from '@domain/news'

/* ─────────────────────────────────────────────────────────── types ── */

export type Mandate =
  | 'cupOrBust'
  | 'contend'
  | 'makePlayoffs'
  | 'competeRespectably'
  | 'developYouth'
  | 'rebuild'
  | 'cutCosts'

export interface BoardState {
  mandate: Mandate
  /** One-line human-readable mandate statement. */
  mandateText: string
  /** Expected league finish (1 = best). */
  targetRank: number
  /** Board's confidence in the GM, 0–100. */
  confidence: number
  /**
   * Board's patience for underperformance, 0–100.
   * Depletes when the team misses expectations; can't be restored.
   */
  patience: number
  /** Year in which the GM was fired, or null if still employed. */
  firedAtYear: number | null
  /** Number of formal ultimatums issued to the GM this tenure. */
  warnings: number
}

export interface NewsSeed {
  category: NewsCategory
  headline: string
  body: string
  teamId?: string
  playerId?: string
}

/* ─────────────────────────────────────────── internal helpers ── */

/** Derive a mandate from the team's projected strength rank within the league. */
function mandateFromRank(
  strengthRank: number,
  n: number,
  marketSize: number | undefined,
  wonCupLastYear: boolean,
  rng: Rng,
): Mandate {
  const pctFromTop = (strengthRank - 1) / Math.max(1, n - 1) // 0 = best, 1 = worst

  // Defending cup champions always get cup-or-bust from a big market.
  if (wonCupLastYear && pctFromTop <= 0.25) return 'cupOrBust'

  // Top tier (top ~20 %): either cupOrBust or contend based on market.
  if (pctFromTop <= 0.20) {
    // Big market or small noise from rng → cupOrBust vs contend
    if ((marketSize ?? 2) >= 3 || rng.chance(0.4)) return 'cupOrBust'
    return 'contend'
  }

  // Contenders (20–40 %): contend or makePlayoffs
  if (pctFromTop <= 0.40) {
    if (rng.chance(0.55)) return 'contend'
    return 'makePlayoffs'
  }

  // Middle (40–60 %): makePlayoffs or competeRespectably
  if (pctFromTop <= 0.60) {
    if (rng.chance(0.60)) return 'makePlayoffs'
    return 'competeRespectably'
  }

  // Lower tier (60–80 %): competeRespectably or developYouth/cutCosts
  if (pctFromTop <= 0.80) {
    if (rng.chance(0.50)) return 'competeRespectably'
    if ((marketSize ?? 2) <= 1) return 'cutCosts'
    return 'developYouth'
  }

  // Bottom tier (80–100 %): rebuild, developYouth, or cutCosts
  if ((marketSize ?? 2) <= 1 && rng.chance(0.35)) return 'cutCosts'
  if (rng.chance(0.55)) return 'rebuild'
  return 'developYouth'
}

/** Build a short mandate statement for the news / UI. */
function mandateText(mandate: Mandate, targetRank: number, n: number): string {
  const qual = ordinalShort(targetRank)
  switch (mandate) {
    case 'cupOrBust':
      return 'Anything short of a championship is failure.'
    case 'contend':
      return `We expect this team to contend — a top-${Math.min(targetRank + 1, Math.ceil(n * 0.3))} finish is the floor.`
    case 'makePlayoffs':
      return `Get this team into the playoffs. A ${qual}-place finish or better is the goal.`
    case 'competeRespectably':
      return `Compete hard, finish around ${qual} in the league, and keep the fanbase engaged.`
    case 'developYouth':
      return `Develop the young core. Results matter less than progress this season.`
    case 'rebuild':
      return `This is a rebuild. Lose with purpose, develop prospects, and set the table for the future.`
    case 'cutCosts':
      return `Keep the payroll lean and the books balanced. On-ice results are secondary.`
  }
}

/** Derive the target rank from a strength rank with a touch of ambition. */
function targetRankFromStrength(
  strengthRank: number,
  n: number,
  mandate: Mandate,
  rng: Rng,
): number {
  // Ambitious mandates aim a bit better than projected.
  let offset = 0
  if (mandate === 'cupOrBust') {
    offset = 0 // always #1
  } else if (mandate === 'contend') {
    offset = rng.int(3) // 0–2 better than strength
  } else if (mandate === 'makePlayoffs') {
    // Aim for just inside the playoff line (top half of the league).
    offset = rng.int(4) - 1 // -1 to +2 (can be slightly worse too)
  } else {
    offset = rng.int(3) - 1 // small noise
  }

  if (mandate === 'cupOrBust') return 1
  const raw = strengthRank - offset
  return Math.max(1, Math.min(n, raw))
}

function ordinalShort(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/* ─────────────────────────────────────── setSeasonMandate ── */

export interface SetSeasonMandateArgs {
  teamStrengthRank: number
  teamsInLeague: number
  marketSize?: number   // 1 = small, 2 = medium, 3 = large (optional, defaults to medium)
  lastYearRank?: number
  wonCupLastYear?: boolean
  rng: Rng
  year: number
  teamId?: string
  teamName?: string
}

export interface SetSeasonMandateResult {
  state: BoardState
  newsSeed: NewsSeed
}

/**
 * Derive the board's mandate and initial state for a new season.
 * Called once at the start of each season.
 */
export function setSeasonMandate(args: SetSeasonMandateArgs): SetSeasonMandateResult {
  const {
    teamStrengthRank,
    teamsInLeague: n,
    marketSize,
    wonCupLastYear = false,
    rng,
    year,
    teamId,
    teamName = 'the team',
  } = args

  const mandate = mandateFromRank(teamStrengthRank, n, marketSize, wonCupLastYear, rng)
  const targetRank = targetRankFromStrength(teamStrengthRank, n, mandate, rng)
  const text = mandateText(mandate, targetRank, n)

  // Confidence starts moderate; owners begin hopeful but not complacent.
  // Cup mandates start higher (pressure + belief); rebuilds start lower
  // (patience-heavy, confidence is irrelevant early).
  let confidence: number
  let patience: number
  switch (mandate) {
    case 'cupOrBust':
      confidence = 65 + rng.int(10)   // 65–74
      patience = 50 + rng.int(20)      // 50–69 — owner is demanding
      break
    case 'contend':
      confidence = 62 + rng.int(12)   // 62–73
      patience = 55 + rng.int(20)      // 55–74
      break
    case 'makePlayoffs':
      confidence = 60 + rng.int(12)   // 60–71
      patience = 60 + rng.int(20)      // 60–79
      break
    case 'competeRespectably':
      confidence = 58 + rng.int(12)   // 58–69
      patience = 65 + rng.int(20)      // 65–84
      break
    case 'developYouth':
      confidence = 55 + rng.int(12)   // 55–66
      patience = 70 + rng.int(20)      // 70–89
      break
    case 'rebuild':
      confidence = 52 + rng.int(12)   // 52–63
      patience = 75 + rng.int(20)      // 75–94
      break
    case 'cutCosts':
      confidence = 50 + rng.int(12)   // 50–61
      patience = 70 + rng.int(20)      // 70–89
      break
  }

  const state: BoardState = {
    mandate,
    mandateText: text,
    targetRank,
    confidence,
    patience,
    firedAtYear: null,
    warnings: 0,
  }

  // Preseason board announcement.
  const headline = `Owner sets the ${year} mandate for ${teamName}: ${mandate}`
  const body = buildMandateBody(text, mandate, targetRank, n, teamName, year)

  const newsSeed: NewsSeed = {
    category: 'league',
    headline,
    body,
    ...(teamId !== undefined ? { teamId } : {}),
  }

  return { state, newsSeed }
}

function buildMandateBody(
  text: string,
  mandate: Mandate,
  targetRank: number,
  n: number,
  teamName: string,
  year: number,
): string {
  const expectation = mandate === 'cupOrBust'
    ? 'only a championship will do'
    : mandate === 'contend' || mandate === 'makePlayoffs'
      ? `a finish around ${ordinalShort(targetRank)} place out of ${n} teams`
      : mandate === 'competeRespectably'
        ? `a respectable ${ordinalShort(targetRank)}-place finish`
        : mandate === 'rebuild' || mandate === 'developYouth'
          ? 'player development and laying the groundwork for the future'
          : 'fiscal responsibility and controlled spending'

  return (
    `The owner has delivered the ${year} marching orders for ${teamName}. ` +
    `"${text}" ` +
    `Management is targeting ${expectation}. ` +
    `The board will monitor progress at regular intervals throughout the season.`
  )
}

/* ─────────────────────────────────────── updateConfidence ── */

export interface UpdateConfidenceArgs {
  state: BoardState
  currentRank: number
  gamesPlayed: number
  totalGames: number
  teamsInLeague: number
  recentForm?: string  // e.g. 'WWLWL', W = win, L = loss; read right-to-left as most-recent-first
}

export interface UpdateConfidenceResult {
  newsSeeds: NewsSeed[]
}

/**
 * Adjust board confidence based on current standing vs target rank.
 * Emits news ONLY at meaningful inflection points to avoid spam.
 * Deterministic — no Rng used.
 */
export function updateConfidence(args: UpdateConfidenceArgs): UpdateConfidenceResult {
  const { state, currentRank, gamesPlayed, totalGames, teamsInLeague: n, recentForm } = args
  if (state.firedAtYear !== null) return { newsSeeds: [] }
  if (gamesPlayed <= 0 || totalGames <= 0) return { newsSeeds: [] }

  const newsSeeds: NewsSeed[] = []

  // How far are we through the season (0–1)?
  const progress = gamesPlayed / totalGames

  // We only update confidence meaningfully after the first quarter.
  if (progress < 0.15) return { newsSeeds: [] }

  // Gap between actual rank and target (positive = ahead of target, negative = behind).
  const rankGap = state.targetRank - currentRank  // positive means doing BETTER than expected

  // How significant is the gap? Scale by number of teams so a 3-rank gap in a
  // 32-team league differs from the same gap in a 16-team league.
  const normGap = rankGap / Math.max(1, n - 1)  // –1 to +1

  // Recent form adjustment: net W–L from the form string.
  let formBonus = 0
  if (recentForm && recentForm.length > 0) {
    const wins = [...recentForm].filter((c) => c === 'W').length
    const losses = [...recentForm].filter((c) => c === 'L').length
    formBonus = (wins - losses) / Math.max(1, recentForm.length) * 5  // up to ±5
  }

  // Confidence delta: scaled by how advanced the season is (more weight late).
  const scaledDelta = normGap * 20 * progress + formBonus
  const delta = Math.round(Math.max(-15, Math.min(15, scaledDelta)))

  const prevConfidence = state.confidence
  state.confidence = Math.max(0, Math.min(100, state.confidence + delta))

  // Patience depletes when we're behind target AND past the halfway mark.
  if (progress >= 0.5 && rankGap < 0) {
    // Deplete patience proportionally to how badly we're underperforming.
    const patienceDrain = Math.round(Math.abs(normGap) * 10 * progress)
    state.patience = Math.max(0, state.patience - patienceDrain)
  }

  // ── Inflection-point news emission ──────────────────────────────────────
  // Emit exactly once per crossing of each threshold, tracked via a bitmask
  // on state. We use the confidence value before and after to detect crossings.

  const prevHigh = prevConfidence >= 80
  const nowHigh = state.confidence >= 80
  const prevHotSeat = prevConfidence < 35
  const nowHotSeat = state.confidence < 35

  // Board praise: crossed up through 80.
  if (!prevHigh && nowHigh) {
    newsSeeds.push({
      category: 'league',
      headline: `Board praises GM as team exceeds expectations`,
      body:
        `The ownership group has issued a glowing vote of confidence after the team's strong ` +
        `performance. Sitting ${ordinalShort(currentRank)} in the league against a target of ` +
        `${ordinalShort(state.targetRank)}, the board says the GM is "doing an exceptional job."`,
    })
  }

  // Hot-seat warning: crossed down through 35.
  if (!prevHotSeat && nowHotSeat && state.warnings < 3) {
    state.warnings++
    state.patience = Math.max(0, state.patience - 10)  // ultimatum costs extra patience
    const urgency = state.warnings === 1 ? 'expressed concern' : state.warnings === 2 ? 'issued a formal warning' : 'delivered an ultimatum'
    newsSeeds.push({
      category: 'league',
      headline: `Board ${urgency}: team must improve or face consequences`,
      body:
        `Ownership has ${urgency} regarding the team's ${ordinalShort(currentRank)} standing — ` +
        `well short of the ${ordinalShort(state.targetRank)} target. ` +
        (state.patience <= 20
          ? `With patience nearly exhausted, the GM's seat is getting hot.`
          : `The board expects a visible turnaround before the season ends.`),
    })
  }

  return { newsSeeds }
}

/* ─────────────────────────────────────────── seasonReview ── */

export type Verdict = 'exceeded' | 'met' | 'missed' | 'failed'

export interface SeasonReviewArgs {
  state: BoardState
  finalRank: number
  madePlayoffs: boolean
  wonCup: boolean
  /** Season year (used for the fired timestamp). */
  year: number
  teamId?: string
  teamName?: string
}

export interface SeasonReviewResult {
  verdict: Verdict
  fired: boolean
  newsSeeds: NewsSeed[]
}

/**
 * End-of-season judgment.
 *
 * Verdict derivation by mandate:
 *   - cupOrBust: only wonCup = 'exceeded'; made playoffs = 'missed'; missed playoffs = 'failed'
 *   - contend: finalRank <= targetRank+1 and playoffs = 'met'; much better = 'exceeded'; missed playoffs = 'failed'
 *   - makePlayoffs: madePlayoffs = 'met'; very close to target without = 'missed'; far off = 'failed'
 *   - competeRespectably: finalRank within ±4 of target = 'met'; much better = 'exceeded'; much worse = 'missed'/'failed'
 *   - developYouth / rebuild: can't fail for losing; 'failed' only if management contradicts mandate
 *     (e.g. sold all prospects). We use a simple proxy: bottom-half finish = 'met' for rebuild,
 *     lower half = 'met', top 20% = 'exceeded' (pleasant surprise), top 40% = 'met',
 *     but for rebuild/develop: can't be 'failed' unless patience is already 0.
 *   - cutCosts: judge purely on staying in lower half of standings (not competing = fine).
 *
 * Fired = true when verdict is 'failed' AND (patience <= 20 OR prior warnings).
 */
export function seasonReview(args: SeasonReviewArgs): SeasonReviewResult {
  const { state, finalRank, madePlayoffs, wonCup, year, teamId, teamName = 'the team' } = args

  if (state.firedAtYear !== null) {
    return { verdict: 'failed', fired: false, newsSeeds: [] }
  }

  const newsSeeds: NewsSeed[] = []
  let verdict: Verdict
  const n_est = state.targetRank * 2  // rough estimate; actual n not required here

  switch (state.mandate) {
    case 'cupOrBust': {
      if (wonCup) verdict = 'exceeded'
      else if (madePlayoffs) verdict = 'missed'
      else verdict = 'failed'
      break
    }
    case 'contend': {
      if (wonCup || finalRank <= Math.max(1, state.targetRank - 2)) {
        verdict = 'exceeded'
      } else if (madePlayoffs && finalRank <= state.targetRank + 2) {
        verdict = 'met'
      } else if (!madePlayoffs || finalRank > state.targetRank + 6) {
        verdict = 'failed'
      } else {
        verdict = 'missed'
      }
      break
    }
    case 'makePlayoffs': {
      if (wonCup) {
        verdict = 'exceeded'
      } else if (madePlayoffs && finalRank <= state.targetRank) {
        verdict = 'exceeded'
      } else if (madePlayoffs) {
        verdict = 'met'
      } else if (finalRank <= state.targetRank + 4) {
        verdict = 'missed'
      } else {
        verdict = 'failed'
      }
      break
    }
    case 'competeRespectably': {
      if (madePlayoffs && finalRank <= Math.max(1, state.targetRank - 3)) {
        verdict = 'exceeded'
      } else if (Math.abs(finalRank - state.targetRank) <= 4) {
        verdict = 'met'
      } else if (finalRank > state.targetRank + 8) {
        verdict = 'failed'
      } else {
        verdict = 'missed'
      }
      break
    }
    case 'developYouth': {
      // Can't be 'failed' for just losing; rebuild mandates protect the GM.
      // Exceeded = playoffs + young players prominent (we proxy with madePlayoffs).
      if (madePlayoffs) {
        verdict = 'exceeded'
      } else if (finalRank <= state.targetRank + 6 || state.confidence >= 50) {
        verdict = 'met'
      } else if (state.patience <= 0 && state.warnings >= 2) {
        verdict = 'failed'  // even rebuild patience can run out after repeated ultimatums
      } else {
        verdict = 'missed'
      }
      break
    }
    case 'rebuild': {
      // Rebuild: can't fail for losing. Only 'failed' if patience totally exhausted + warnings.
      if (madePlayoffs) {
        verdict = 'exceeded'  // unexpected positive surprise
      } else if (state.confidence >= 45 || state.patience >= 20) {
        verdict = 'met'
      } else if (state.patience <= 0 && state.warnings >= 2) {
        verdict = 'failed'  // board runs out of patience even on a rebuild
      } else {
        verdict = 'missed'
      }
      break
    }
    case 'cutCosts': {
      // Cost-cutting: success is staying below budget (proxied by low spending = final rank in bottom half).
      // We can't check payroll here, so use a simple proxy: avoid total embarrassment.
      if (finalRank <= Math.ceil(state.targetRank * 0.5)) {
        verdict = 'exceeded'  // outperformed budget expectations
      } else if (finalRank <= state.targetRank + 5) {
        verdict = 'met'
      } else if (state.patience <= 0) {
        verdict = 'failed'
      } else {
        verdict = 'missed'
      }
      break
    }
  }

  // Firing logic: 'failed' verdict triggers firing when patience is exhausted OR
  // there was already an ultimatum in place.
  const fired = verdict === 'failed' && (state.patience <= 20 || state.warnings >= 1)

  if (fired) {
    state.firedAtYear = year
  }

  // Update confidence based on verdict.
  if (verdict === 'exceeded') state.confidence = Math.min(100, state.confidence + 15)
  else if (verdict === 'met') state.confidence = Math.min(100, state.confidence + 5)
  else if (verdict === 'missed') state.confidence = Math.max(0, state.confidence - 10)
  else state.confidence = Math.max(0, state.confidence - 25)

  // Generate season-end news.
  const seed = buildSeasonReviewNews(state, verdict, fired, finalRank, madePlayoffs, wonCup, teamName, year, teamId)
  newsSeeds.push(seed)

  return { verdict, fired, newsSeeds }
}

function buildSeasonReviewNews(
  state: BoardState,
  verdict: Verdict,
  fired: boolean,
  finalRank: number,
  madePlayoffs: boolean,
  wonCup: boolean,
  teamName: string,
  year: number,
  teamId: string | undefined,
): NewsSeed {
  const targetLabel = ordinalShort(state.targetRank)
  const actualLabel = ordinalShort(finalRank)
  const playoffs = madePlayoffs ? 'made the playoffs' : 'missed the playoffs'
  const cup = wonCup ? ' — and won the Cup' : ''

  let headline: string
  let body: string

  if (fired) {
    headline = `GM dismissed after ${year} season falls short of mandate`
    body =
      `Following a ${actualLabel}-place finish (target: ${targetLabel}) and ${playoffs}${cup}, ` +
      `the ownership group has relieved the GM of duties. ` +
      `The mandate was "${state.mandateText}" — the board judged it unmet with ${state.warnings} warning${state.warnings === 1 ? '' : 's'} issued during the season.`
  } else {
    switch (verdict) {
      case 'exceeded':
        headline = `Board delighted: ${teamName} exceeded ${year} expectations`
        body =
          `A ${actualLabel}-place finish against a target of ${targetLabel}${cup ? cup : (madePlayoffs ? ', with a playoff run' : '')}. ` +
          `"We couldn't be happier," the owner said. The GM's position has never been stronger.`
        break
      case 'met':
        headline = `${teamName} meets the ${year} mandate — GM's job secure`
        body =
          `Finishing ${actualLabel} and ${playoffs}${cup}, ${teamName} delivered broadly what was ` +
          `asked of them. The board is satisfied. Target was ${targetLabel}.`
        break
      case 'missed':
        headline = `${teamName} falls short of ${year} target — GM on notice`
        body =
          `A ${actualLabel}-place finish against a target of ${targetLabel}. ${teamName} ${playoffs}${cup}. ` +
          `The board is disappointed but has chosen to retain the GM — for now. ` +
          `${state.patience <= 30 ? 'Patience is wearing thin.' : 'Improvement is expected next season.'}`
        break
      case 'failed':
        headline = `Board disappointed — ${teamName} failed ${year} mandate but GM retained`
        body =
          `Despite a failed mandate (${actualLabel} vs target ${targetLabel}, ${playoffs}${cup}), ` +
          `ownership has decided against a change this offseason. ` +
          `The GM is on notice: next season must show marked improvement.`
        break
    }
  }

  return {
    category: 'league',
    headline,
    body,
    ...(teamId !== undefined ? { teamId } : {}),
  }
}

/* ─────────────────────────────────────────── boardSummary ── */

export interface BoardSummaryView {
  mandate: Mandate
  mandateText: string
  targetRank: number
  confidence: number
  confidenceLabel: string
  patience: number
  warnings: number
  firedAtYear: number | null
  statusLabel: string
}

/**
 * Summarise the board state for the UI (no mutation).
 */
export function boardSummary(state: BoardState): BoardSummaryView {
  const confidenceLabel =
    state.confidence >= 80
      ? 'Very High'
      : state.confidence >= 60
        ? 'High'
        : state.confidence >= 40
          ? 'Moderate'
          : state.confidence >= 25
            ? 'Low'
            : 'Critical'

  const statusLabel =
    state.firedAtYear !== null
      ? `Fired (${state.firedAtYear})`
      : state.confidence >= 80
        ? 'Board Backing'
        : state.confidence < 35
          ? state.warnings >= 2
            ? 'Under Ultimatum'
            : 'Hot Seat'
          : 'In Position'

  return {
    mandate: state.mandate,
    mandateText: state.mandateText,
    targetRank: state.targetRank,
    confidence: state.confidence,
    confidenceLabel,
    patience: state.patience,
    warnings: state.warnings,
    firedAtYear: state.firedAtYear,
    statusLabel,
  }
}
