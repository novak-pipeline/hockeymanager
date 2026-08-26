/**
 * Trade system (build step #6): asset valuation, AI evaluation of user
 * proposals, trade execution, and AI-initiated offers.
 *
 * ONE CURRENCY. Players and picks are priced on the SAME scale so they are
 * directly comparable — {@link assetValue} is the single entry point the AI and
 * every trade/scouting UI consume. The scale is the Perri pick curve (below):
 * the #1 pick = 100, a middling 1st (~#16) ≈ 28. Players are pinned to that:
 * a replacement-level regular (ovr 70) ≈ 9, a fringe top-six (ovr 75) ≈ 20, a
 * 25-goal scorer with term (ovr ~79) ≈ a 1st, a genuine star (ovr 88+) ≈ two-
 * plus 1sts. This is a deliberate recalibration: a mid UFA-bound centre now
 * fetches a 2nd/3rd, NOT the two first-rounders the old (3–4× hot) player scale
 * implied. Only ratios between assets matter, never the absolute magnitude.
 *
 * Pick values follow the Perri curve (Matt Perri, PuckPedia) anchored at
 * #1=100, #2=72.69, with steep early decay and a long flat tail through ~224.
 * The curve is a two-piece exponential fit to the published table.
 *
 * Retained salary: a team can retain up to 50% of a traded player's cap hit,
 * up to 3 retained contracts per team roster-wide, and a contract may be
 * retained at most twice (enabling a third-team broker). AI teams near the cap
 * value retention relief, cap-rich teams will broker for picks.
 *
 * Team philosophy: each team has a Philosophy (Balanced / Win Now / Favor Young
 * / Rebuild Prospects / Rebuild Draft) that biases AI willingness and what they
 * ask for. Needs (positional gaps) are computed from the live roster.
 *
 * This is an engine-level module: it returns plain, JSON-serializable results
 * and the Career maps them onto the UI view models in career/views.ts. Every
 * stochastic decision flows through the injected seeded Rng — determinism is
 * a hard requirement (docs/ARCHITECTURE.md §7).
 */
import type { DraftPick, Handedness, Player, PlayerId, Position, Team, TeamId } from '@domain'
import { ratedOverall, ratedPotential } from '@engine/ratings/composites'
import type { Rng } from '@engine/shared/rng'

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Base ability→value curve, pinned to the Perri pick scale so players and picks
 * share one currency. Anchors: overall 75 → 20 points (a fringe top-six / 2nd-
 * pair regular, roughly a low 1st-round pick) and overall 90 → 180 (a franchise
 * superstar, worth more than the #1 pick). Exponential in between — each overall
 * point multiplies value by ~1.158, so stars are disproportionately expensive
 * (one 90 costs far more than two 75s), which is how real GMs price elite talent.
 *
 * Sample: ovr70 ≈ 9.5, 72 ≈ 12.9, 75 = 20, 77 ≈ 26.8, 80 ≈ 42, 83 ≈ 65, 85 ≈ 87.
 */
const BASE_OVERALL = 75
const BASE_OVERALL_VALUE = 20
/** Per-overall-point growth so overall 90 lands at 180 (= 9× the ovr-75 anchor). */
const BASE_K = Math.pow(180 / BASE_OVERALL_VALUE, 1 / 15) // ≈ 1.1584
const valueFromOverall = (ovr: number): number =>
  BASE_OVERALL_VALUE * Math.pow(BASE_K, ovr - BASE_OVERALL)

/**
 * Positional premium at equal overall: centres carry a shade more trade value
 * than wingers (harder to find, drive a line), top-pair defencemen likewise;
 * goalies a shade less (deep, volatile, streaky position GMs pay down for).
 */
const POSITION_MULT: Record<Position, number> = { C: 1.06, W: 1.0, D: 1.05, G: 0.9 }

/**
 * Age multiplier anchors (age, multiplier), linear between, clamped outside.
 * Peak trade value sits in the 23–27 prime; veterans decay steeply because the
 * buyer pays for future seasons, not past ones.
 */
const AGE_CURVE: ReadonlyArray<readonly [number, number]> = [
  [17, 0.78],
  [20, 0.9],
  [23, 1],
  [27, 1],
  [29, 0.92],
  [31, 0.8],
  [33, 0.65],
  [35, 0.5],
  [38, 0.35]
]

function ageMultiplier(age: number): number {
  const first = AGE_CURVE[0]
  const last = AGE_CURVE[AGE_CURVE.length - 1]
  if (age <= first[0]) return first[1]
  if (age >= last[0]) return last[1]
  for (let i = 1; i < AGE_CURVE.length; i++) {
    const [a1, m1] = AGE_CURVE[i]
    if (age <= a1) {
      const [a0, m0] = AGE_CURVE[i - 1]
      return m0 + ((age - a0) / (a1 - a0)) * (m1 - m0)
    }
  }
  return last[1]
}

/**
 * What a player of this overall "should" earn — mirrors the league generator's
 * salary curve (data/generate.ts makeContract) so contract drag is centered on
 * the league's actual pay scale.
 */
const fairSalaryFor = (ovr: number): number =>
  (0.7 + Math.pow(Math.max(0, ovr - 45) / 45, 2.2) * 11) * 1e6

/**
 * Core player value computation for a GIVEN overall, in trade points.
 * `playerValue` passes the player's true `ratedOverall`; the trade-builder's fog
 * path passes a scouted estimate so an unscouted opponent's displayed value
 * doesn't leak his exact rating. Every factor other than overall (age, contract,
 * injury, morale) is public, so only the overall is substituted.
 *
 * The calibrated factors:
 *  - Base: exponential in overall on the shared Perri scale (stars are
 *    disproportionately valuable), times a small positional premium.
 *  - Age curve peaking at 23–27.
 *  - U24 upside: unrealized potential is partially priced in, more so the
 *    younger the player.
 *  - Contract drag: paid above the fair curve reduces value, a cheap deal adds
 *    value; longer remaining terms amplify either way.
 *  - Rental discount: an expiring deal is a few months of control, not an asset
 *    you keep, so it is worth far less than the same player with term — the lever
 *    that makes a mid UFA-bound player a 2nd/3rd rather than a 1st.
 *  - Small discounts for current injury and poor morale.
 */
function computePlayerValue(player: Player, ovr: number): number {
  // U24 upside: price in a slice of the gap to potential, fading to nothing
  // by age 24 — buyers pay for projection, but never the full ceiling.
  let effective = ovr
  if (player.age < 24) {
    const potOvr = ratedPotential(player)
    const upside = Math.max(0, potOvr - ovr)
    const youth = clamp((24 - player.age) / 6, 0, 1)
    effective = ovr + upside * 0.55 * youth
  }

  let value = valueFromOverall(effective) * POSITION_MULT[player.position] * ageMultiplier(player.age)

  const fair = fairSalaryFor(ovr)
  const surplusRatio = (fair - player.contract.salary) / Math.max(fair, 1e6)
  const horizon = clamp(player.contract.yearsRemaining, 1, 4)
  value *= clamp(1 + surplusRatio * 0.12 * horizon, 0.55, 1.3)

  // Rental discount: an expiring contract (one year or less of control) is worth
  // markedly less as a trade asset — you rent the player, you don't acquire him.
  // Real deadline precedent: a good rental fetches a 2nd/3rd (plus maybe a mid
  // pick), not the return a controllable player of the same overall commands.
  if (player.contract.yearsRemaining <= 1) value *= 0.65

  if (player.injuryStatus) {
    value *= clamp(0.95 - player.injuryStatus.gamesRemaining * 0.004, 0.8, 0.95)
  }
  if (player.morale < 50) {
    value *= 1 - ((50 - player.morale) / 50) * 0.06
  }
  return value
}

/**
 * Trade value of a player, in trade points.
 *
 *  - Base: exponential in overall (stars are disproportionately valuable).
 *  - Age curve peaking at 23–27.
 *  - U24 upside: unrealized potential is partially priced in, more so the
 *    younger the player.
 *  - Contract drag: paid above the fair curve reduces value, a cheap deal adds
 *    value; longer remaining terms amplify either way.
 *  - Small discounts for current injury and poor morale.
 */
export function playerValue(player: Player): number {
  return computePlayerValue(player, ratedOverall(player))
}

/* ────────────────────────── value drivers (UI) ────────────────────────── */

/** A single human-readable factor behind an asset's trade value, for the trade
 *  builder's hover breakdown. `tone` colours it: raises / lowers / context. */
export interface ValueDriver {
  label: string
  tone: 'up' | 'down' | 'flat'
}

/**
 * Endowment multiplier the AI applies to its OWN players when weighing a return
 * (see `evaluateProposal`). Exported so the trade builder can explain, with the
 * exact same constant the acceptance math uses, why a paper-even deal still
 * needs a sweetener to get a yes.
 */
export const OWN_PLAYER_ENDOWMENT = 1.08

/**
 * `playerValue` plus the human-readable drivers behind it, for the trade
 * builder. `.value` is byte-identical to `playerValue(player)` when
 * `overrideOverall` is omitted (locked by a test) — so displayed numbers match
 * what the AI weighs. Pass a scouted-overall estimate to fog an opponent whose
 * exact rating your staff don't know.
 */
export function describePlayerValue(
  player: Player,
  overrideOverall?: number,
): { value: number; drivers: ValueDriver[] } {
  const ovr = overrideOverall ?? ratedOverall(player)
  const value = computePlayerValue(player, ovr)
  const drivers: ValueDriver[] = []

  const tier =
    ovr >= 86 ? 'elite' : ovr >= 78 ? 'top-line' : ovr >= 70 ? 'middle-six' : ovr >= 60 ? 'depth' : 'fringe'
  drivers.push({ label: `${ovr} OVR — ${tier}`, tone: ovr >= 78 ? 'up' : ovr < 60 ? 'down' : 'flat' })

  if (player.age <= 22) drivers.push({ label: `Age ${player.age} — young`, tone: 'up' })
  else if (player.age <= 27) drivers.push({ label: `Age ${player.age} — prime`, tone: 'up' })
  else if (player.age <= 30) drivers.push({ label: `Age ${player.age}`, tone: 'flat' })
  else drivers.push({ label: `Age ${player.age} — declining`, tone: 'down' })

  if (player.age < 24) {
    const potOvr = ratedPotential(player)
    if (potOvr - ovr >= 4) drivers.push({ label: `Upside to ~${potOvr}`, tone: 'up' })
  }

  const fair = fairSalaryFor(ovr)
  const yrs = player.contract.yearsRemaining
  const termTag = yrs > 1 ? ` · ${yrs}yr` : ''
  if (player.contract.salary <= fair * 0.85) drivers.push({ label: `Team-friendly deal${termTag}`, tone: 'up' })
  else if (player.contract.salary >= fair * 1.2) drivers.push({ label: `Rich contract${termTag}`, tone: 'down' })

  if (player.injuryStatus) drivers.push({ label: 'Injured', tone: 'down' })
  if (player.morale < 50) drivers.push({ label: 'Unhappy', tone: 'down' })

  return { value, drivers }
}

/* ────────────────────────── Perri pick-value curve ────────────────────────── */

/**
 * Perri-style pick value on a 0–100 scale, calibrated to historical
 * pick-for-pick trade precedent (market value, not prospect probability).
 *
 * Anchors: #1=100.00, #2=72.69 (gap=27.31 points). Formula: power law
 *   value(n) = 100 / n^k   where k = log(100/72.69) / log(2) ≈ 0.4602
 *
 * This exactly reproduces the #1/#2 anchor, is strictly monotone decreasing,
 * and produces a long tail to #224 ≈ 8.3, matching Perri's published table
 * shape (steep early decay, gradual flattening across all 7 rounds).
 *
 * Sample values:
 *   #1=100, #2=72.7, #5=47.7, #10=34.7, #16=27.9,
 *   #32=20.3, #64=14.7, #128=10.7, #224=8.3
 */
const PERRI_K = Math.log(100 / 72.69) / Math.log(2) // ≈ 0.4602

export function perriPickValue(overallPickNumber: number): number {
  const n = Math.max(1, Math.min(224, overallPickNumber))
  return 100 / Math.pow(n, PERRI_K)
}

/**
 * Convert a round + team-strength-rank into an expected overall pick number
 * within a 32-team league. Rank 1 = strongest team (picks last in round),
 * rank 32 = weakest (picks first). We model each round as 32 slots.
 */
function expectedOverallPick(round: number, teamStrengthRank: number | undefined): number {
  const teamsPerRound = 32
  // Weakest team (rank 32) picks ~slot 1 in the round; strongest (rank 1) picks ~slot 32.
  const slotInRound = teamStrengthRank !== undefined
    ? clamp(teamsPerRound + 1 - teamStrengthRank, 1, teamsPerRound)
    : teamsPerRound / 2  // no info → middle of round
  return (round - 1) * teamsPerRound + slotInRound
}

/** Per extra year out, a pick loses this much of its value (uncertainty). */
const FUTURE_YEAR_DISCOUNT = 0.82

/**
 * Trade value of a draft pick.
 *
 *  - `year` is the current draft year; picks further out are discounted.
 *  - `teamStrengthRank` is the ORIGINAL team's league strength rank
 *    (1 = strongest). A weak original team finishes low and picks early, so
 *    its pick is worth more; the slot effect matters most in round 1 and is
 *    attenuated in later rounds.
 *
 * The base slot value uses the Perri curve (perriPickValue) so pick-for-pick
 * valuations match historical NHL trade precedent.
 */
export function pickValue(
  pick: DraftPick,
  args: { year: number; teamStrengthRank?: number }
): number {
  const overallPick = expectedOverallPick(pick.round, args.teamStrengthRank)
  const base = perriPickValue(overallPick)
  const yearsOut = Math.max(0, pick.year - args.year)
  return base * Math.pow(FUTURE_YEAR_DISCOUNT, yearsOut)
}

/* ────────────────────────── unified asset value ────────────────────────── */

/** A single tradeable asset — a player or a draft pick. */
export type TradeAsset =
  | { kind: 'player'; player: Player }
  | { kind: 'pick'; pick: DraftPick }

/** Context a pick needs to be valued (the current draft year for discounting
 *  future picks, and the ORIGINAL team's league strength rank, 1 = strongest,
 *  so a weak club's pick — which lands earlier — is worth more). Players ignore
 *  it. */
export interface AssetValueContext {
  year: number
  teamStrengthRank?: number
}

/**
 * THE unified trade-asset valuation — the single currency the AI evaluator, the
 * AI offer generators, the deadline sim and the trade/scouting UIs all consume.
 * Players and picks come back on the same Perri-anchored scale (see {@link
 * playerValue} / {@link pickValue}), so `assetValue(a) >= assetValue(b)` is a
 * meaningful comparison across the two kinds. Pure and deterministic.
 */
export function assetValue(asset: TradeAsset, ctx: AssetValueContext): number {
  return asset.kind === 'player'
    ? playerValue(asset.player)
    : pickValue(asset.pick, { year: ctx.year, teamStrengthRank: ctx.teamStrengthRank })
}

/**
 * Minimum asset value (on the shared scale) worth putting in a trade — below
 * this a player/pick is roster filler no club shops or packages. ≈ a depth NHLer
 * (overall ~68) or a late pick. Used as the floor for AI target selection and
 * tradeable-prospect eligibility so the same bar applies everywhere.
 */
export const MIN_SHOP_VALUE = 8

/**
 * A trade value, translated out of decimals and into the language a GM speaks.
 *
 * The raw currency (`22.9`, `60.7`) is an internal quantity: it reads like a
 * spreadsheet and implies a precision the model does not have. Every surface
 * shows this instead — a tier word and a 0–1 meter fill — with the number
 * available on hover for anyone who wants it.
 *
 * `fill` is logarithmic because the underlying scale is: the gap between a
 * depth piece (9) and a solid roster player (20) matters as much to a GM as the
 * gap between a star (60) and a franchise player (140).
 */
export interface AssetValueTier {
  /** 0 (fringe) … 6 (franchise) — for segmented meters and colour ramps. */
  tier: number
  /** What a GM would call this asset. */
  label: string
  /** 0–1 meter fill, log-scaled across the tradeable range. */
  fill: number
}

const TIER_BANDS: ReadonlyArray<readonly [number, string]> = [
  [110, 'Franchise'],
  [58, 'Star'],
  [36, 'Top-line'],
  [22, 'Core piece'],
  [13, 'Roster player'],
  [7, 'Depth'],
]

export function assetValueTier(value: number): AssetValueTier {
  let tier = 0
  let label = 'Fringe'
  for (let i = 0; i < TIER_BANDS.length; i++) {
    const [floor, name] = TIER_BANDS[i]!
    if (value >= floor) {
      tier = TIER_BANDS.length - i
      label = name
      break
    }
  }
  // Log fill across ~3 (a late pick) to ~150 (a genuine franchise player).
  const fill = clamp(Math.log(Math.max(value, 1) / 3) / Math.log(150 / 3), 0, 1)
  return { tier, label, fill }
}

const roundOrdinal = (round: number): string =>
  round === 1 ? '1st' : round === 2 ? '2nd' : round === 3 ? '3rd' : `${round}th`

/**
 * `pickValue` plus the human-readable drivers behind it, for the trade builder.
 * `.value` is byte-identical to `pickValue(pick, args)` (locked by a test).
 */
export function describePickValue(
  pick: DraftPick,
  args: { year: number; teamStrengthRank?: number },
): { value: number; drivers: ValueDriver[] } {
  const value = pickValue(pick, args)
  const drivers: ValueDriver[] = []
  drivers.push({
    label: `${roundOrdinal(pick.round)}-round pick`,
    tone: pick.round <= 1 ? 'up' : pick.round >= 5 ? 'down' : 'flat',
  })
  const slot = Math.round(expectedOverallPick(pick.round, args.teamStrengthRank))
  drivers.push({ label: `~#${slot} projected`, tone: 'flat' })
  const yearsOut = Math.max(0, pick.year - args.year)
  if (yearsOut >= 1) drivers.push({ label: `${yearsOut}yr out — discounted`, tone: 'down' })
  return { value, drivers }
}

/**
 * Plain-English asking price for a player on the deadline block, expressed in
 * draft-pick currency on the same Perri scale the AI actually trades on. A
 * rental (expiring deal) commands a discount to a signed player of equal value
 * — a buyer is paying for a playoff run, not for term — so the demand is framed
 * a notch lower.
 *
 * NOTE: a sibling chip is introducing a shared `assetValue()` that unifies
 * player + pick valuation on one currency. When it lands, feed its value in
 * here instead of `playerValue`; the tier thresholds are already calibrated to
 * the Perri pick scale (a 1st ≈ 28 points) so they carry over unchanged.
 */
export function askingPriceText(value: number, rental: boolean): string {
  const v = rental ? value * 0.85 : value
  if (v >= 60) return 'a 1st-round pick and a top prospect'
  if (v >= 42) return 'a 1st-round pick and a mid-round pick'
  if (v >= 30) return 'a 1st-round pick'
  if (v >= 20) return 'a 2nd-round pick'
  if (v >= 12) return 'a mid-round pick'
  return 'a late pick or a depth piece'
}

/* ────────────────────────── team philosophy & needs ────────────────────────── */

/**
 * Team philosophy shapes what assets an AI club values and how aggressively
 * it trades. Generated deterministically from the team id seed.
 *
 *  - WinNow: prioritises experienced players, accepts salary, gives picks away
 *  - FavorYoung: pays premium for U24 talent, reluctant to deal youth picks
 *  - RebuildProspects: wants high-overall prospects, will trade veterans
 *  - RebuildDraft: hoards picks, deep discounts on veterans
 *  - Balanced: moderate biases in all directions
 */
export type TeamPhilosophy = 'WinNow' | 'FavorYoung' | 'RebuildProspects' | 'RebuildDraft' | 'Balanced'

export interface TeamProfile {
  philosophy: TeamPhilosophy
  /**
   * Position groups where the team is below its target roster depth.
   * AI clubs pay a premium for arrivals that fill a listed need.
   */
  needs: PositionGroup[]
  /**
   * Cap space remaining (salaryCap - capUsed). Positive = room; negative = over.
   */
  capSpace: number
}

/** Deterministic philosophy assignment from a team id string. */
export function teamPhilosophy(teamId: TeamId): TeamPhilosophy {
  // Sum char codes for a simple hash. Stable across runs.
  let h = 0
  for (let i = 0; i < (teamId as string).length; i++) {
    h = (h * 31 + (teamId as string).charCodeAt(i)) >>> 0
  }
  const PHILOSOPHIES: TeamPhilosophy[] = ['WinNow', 'FavorYoung', 'RebuildProspects', 'RebuildDraft', 'Balanced']
  return PHILOSOPHIES[h % PHILOSOPHIES.length]!
}

/**
 * Build a TeamProfile for the given club: philosophy + live positional needs +
 * cap space. Used by the AI evaluator and surfaced in the trade UI.
 */
export function buildTeamProfile(
  team: Team,
  players: Map<PlayerId, Player>,
  /** Persona-derived philosophy override (Living World LW3). Absent → the
   *  original hash-based assignment (back-compat). */
  philosophy?: TeamPhilosophy
): TeamProfile {
  const counts = groupCounts(team, players, [])
  const needs: PositionGroup[] = []
  for (const g of ['F', 'D', 'G'] as const) {
    if (counts[g] < GROUP_TARGET[g]) needs.push(g)
  }
  return {
    philosophy: philosophy ?? teamPhilosophy(team.id),
    needs,
    // Recompute from the live roster — finances.capUsed goes stale across a
    // season (retirements, ELCs, call-ups) and a stale-high value makes a club
    // look capped-out and wrongly refuse deals that actually fit. Matches the
    // evaluator (evaluateTradeProposal) and executeTrade.
    capSpace: team.finances.salaryCap - rosterCapUsed(team, players),
  }
}

/**
 * Philosophy bias multiplier applied to the partner's perceived gain when
 * evaluating a proposed asset. Values > 1 mean the club values this more;
 * < 1 means it's worth less to them.
 */
function philosophyGainBias(
  philosophy: TeamPhilosophy,
  asset: { kind: 'player'; player: Player } | { kind: 'pick'; pick: DraftPick }
): number {
  if (asset.kind === 'pick') {
    // WinNow: picks worth less (future doesn't matter as much)
    // RebuildDraft: picks worth more
    if (philosophy === 'WinNow') return 0.85
    if (philosophy === 'RebuildDraft') return 1.25
    if (philosophy === 'RebuildProspects') return 1.0
    if (philosophy === 'FavorYoung') return 0.9
    return 1.0 // Balanced
  }
  // player asset
  const p = asset.player
  const ovr = ratedOverall(p)
  const isYoung = p.age < 24
  const isVet = p.age >= 30
  if (philosophy === 'WinNow') {
    // Veterans with high overall are extra valuable; young prospects less so
    return isVet && ovr >= 75 ? 1.12 : isYoung && ovr < 75 ? 0.88 : 1.0
  }
  if (philosophy === 'FavorYoung') {
    return isYoung ? 1.18 : isVet ? 0.85 : 1.0
  }
  if (philosophy === 'RebuildProspects') {
    return isYoung ? 1.15 : isVet ? 0.80 : 1.0
  }
  if (philosophy === 'RebuildDraft') {
    // draft teams give less for players (except cheap picks)
    return ovr >= 80 ? 0.90 : 0.80
  }
  return 1.0 // Balanced
}

/* ═══════════════════════ per-club valuation (the lens) ═══════════════════════
 *
 * THERE IS NO ONE TRUE VALUE. `assetValue` above is the MARKET baseline — the
 * average of thirty-two opinions, useful for sorting a board and for the UI's
 * "on paper" read. It is not what any actual front office would pay.
 *
 * A club prices an asset through its own lens: its competitive posture, its GM's
 * philosophy, the shape of its roster (a club with five left-shot defencemen
 * pays up for a righty), its cap sheet, and where the season sits. A rebuilder
 * and a contender look at the same 33-year-old and see two different players.
 *
 * `clubAssetValue` is that lens, and it is applied SYMMETRICALLY inside
 * `evaluateProposal` — to what a club would receive AND to what it would give
 * up. That symmetry is what makes the market feel like people rather than a
 * spreadsheet: a rebuilder sells its veteran cheap because it genuinely does not
 * value him, and refuses its 22-year-old at any veteran price because it
 * genuinely does.
 */

/** Competitive stance of a club, as the trade market sees it. */
export type ClubPostureKind = 'contend' | 'retool' | 'rebuild'

/**
 * Live roster shape a club prices positional scarcity from. Counts are of
 * NHL-calibre bodies at each group, and — on defence, where handedness actually
 * constrains a coach's pairs — split by shot side.
 */
export interface ClubDepth {
  group: Record<PositionGroup, number>
  /** Defencemen by shot side. A club thin at RD pays a premium for RD. */
  defenceBySide: Record<Handedness, number>
}

/**
 * Fallback posture when a caller hasn't supplied live club context — read off
 * the GM's philosophy so the lens is never absent. Callers inside the Career
 * always pass the real posture; tests and older call sites get this.
 */
export function defaultPostureFor(philosophy: TeamPhilosophy): ClubPostureKind {
  if (philosophy === 'WinNow') return 'contend'
  if (philosophy === 'RebuildDraft' || philosophy === 'RebuildProspects') return 'rebuild'
  return 'retool'
}

/**
 * A player a club considers a cornerstone — young enough that his best seasons
 * are ahead of him and valuable enough that moving him is a fireable offence.
 * Judged on the CLUB's book, not the market's.
 */
export const CORNERSTONE_MAX_AGE = 25
export const CORNERSTONE_VALUE = 52

/**
 * Above this club-value, the asset leaving is a real hockey player and the
 * "best asset in the deal" rule applies — quantity stops being able to buy it.
 * Deliberately low: the rule used to trigger only at star level (45), which let
 * a pile of depth pieces buy a genuine top-six forward.
 */
export const HEADLINE_MIN_VALUE = 26

/** Everything a club needs to price an asset as ITSELF rather than as "the market". */
export interface ClubLens {
  philosophy: TeamPhilosophy
  posture: ClubPostureKind
  depth: ClubDepth
  /** Cap space ($) remaining. Negative = over. Drives how term/money is priced. */
  capSpace: number
  /** 0 = October … 1 = the final hours before the deadline. */
  deadlineProximity: number
}

/**
 * Build the depth half of a lens from a live roster. `leaving` are players the
 * club would be trading away — depth is judged AFTER the deal, which is how a
 * GM actually thinks ("if I move him, what am I left with?").
 */
export function clubDepthOf(
  team: Team,
  players: Map<PlayerId, Player>,
  leaving: Player[] = [],
): ClubDepth {
  const gone = new Set(leaving.map((p) => p.id as string))
  const group: Record<PositionGroup, number> = { F: 0, D: 0, G: 0 }
  const defenceBySide: Record<Handedness, number> = { L: 0, R: 0 }
  for (const id of team.roster) {
    if (gone.has(id as string)) continue
    const p = players.get(id)
    if (!p) continue
    group[groupOf(p.position)]++
    if (p.position === 'D') defenceBySide[p.handedness]++
  }
  return { group, defenceBySide }
}

/** Healthy shot-side split on an NHL blue line — three a side. */
const DEFENCE_SIDE_TARGET = 3

/**
 * Posture age curves. Anchors are (age, multiplier) applied ON TOP of the
 * market age curve, so this is the club's *disagreement* with the market, not a
 * replacement for it. A rebuilder writes down anyone over thirty; a contender
 * writes down teenagers who cannot help this spring.
 */
const POSTURE_AGE_CURVE: Record<ClubPostureKind, ReadonlyArray<readonly [number, number]>> = {
  rebuild: [[19, 1.22], [23, 1.12], [26, 0.98], [29, 0.82], [31, 0.70], [34, 0.55]],
  retool: [[19, 1.10], [23, 1.05], [27, 1.0], [30, 0.92], [33, 0.82]],
  contend: [[19, 0.84], [22, 0.93], [25, 1.02], [28, 1.10], [31, 1.06], [34, 0.94]],
}

function lerpCurve(curve: ReadonlyArray<readonly [number, number]>, x: number): number {
  const first = curve[0]!
  const last = curve[curve.length - 1]!
  if (x <= first[0]) return first[1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]!
    if (x <= x1) {
      const [x0, y0] = curve[i - 1]!
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return last[1]
}

/** How much of a young player's UNREALIZED ceiling a club is willing to pay for. */
const UPSIDE_APPETITE: Record<ClubPostureKind, number> = { rebuild: 0.55, retool: 0.36, contend: 0.22 }

/**
 * The premium a club puts on a young player's unrealized ceiling, in trade
 * points, ON TOP of what the market already prices in.
 *
 * The market model (`computePlayerValue`) credits 55% of the gap to potential,
 * fading out by 24. That is a market average and it is precisely why the AI used
 * to sell blue-chip 22-year-olds for good-not-great veterans: nobody in the room
 * was pricing the ceiling. A club with a rebuild lens prices most of the rest of
 * it; a contender barely prices any.
 */
export function upsidePremium(player: Player, lens: ClubLens): number {
  if (player.age >= 26) return 0
  const ovr = ratedOverall(player)
  const gap = ratedPotential(player) - ovr
  if (gap < 2) return 0
  const ceiling = valueFromOverall(ovr + gap) - valueFromOverall(ovr)
  // How much of the gap the market already paid for (mirrors computePlayerValue).
  const alreadyPriced = player.age < 24 ? 0.55 * clamp((24 - player.age) / 6, 0, 1) : 0
  // How near the ceiling is — an 18-year-old has a decade to get there, a
  // 25-year-old is nearly who he will be.
  const proximity = clamp((26 - player.age) / 10, 0, 1)
  return ceiling * Math.max(0, 1 - alreadyPriced) * proximity * UPSIDE_APPETITE[lens.posture]
}

/**
 * Positional fit: what this club, with THIS roster, would pay extra (or less)
 * for a body at that spot. Goalies swing hardest — a club with one is a club in
 * trouble — and defence is priced by shot side, because two right-shot pairs is
 * not a blue line.
 */
export function positionalFitMultiplier(player: Player, lens: ClubLens): number {
  const g = groupOf(player.position)
  let m = 1
  const have = lens.depth.group[g]
  const want = GROUP_TARGET[g]
  if (have < want) m *= 1 + Math.min(0.20, (want - have) * (g === 'G' ? 0.10 : 0.035))
  else if (have >= want + 4) m *= 0.93 // a surplus club does not bid on a sixteenth forward
  if (player.position === 'D') {
    const side = lens.depth.defenceBySide[player.handedness]
    if (side <= 1) m *= 1.14
    else if (side < DEFENCE_SIDE_TARGET) m *= 1.06
    else if (side >= DEFENCE_SIDE_TARGET + 2) m *= 0.92
  }
  return m
}

/**
 * How a club's cap sheet and stance colour a CONTRACT. This is the lever the
 * playtest asked for by name: "a cap-strapped club discounts term."
 *
 *  - Money you cannot fit is worth less than money you can. A club whose whole
 *    remaining space would go on one contract prices that contract down.
 *  - Term amplifies whatever the contract already is: years on a bargain are an
 *    asset, years on an overpay are a mortgage.
 *  - A rebuilder does not want long money on an old player at any discount —
 *    those years land squarely in the seasons he is trying to be good again.
 */
export function contractLensMultiplier(player: Player, lens: ClubLens): number {
  const yrs = player.contract.yearsRemaining
  const fair = fairSalaryFor(ratedOverall(player))
  const richness = player.contract.salary / Math.max(fair, 1e6) // >1 = paid above the curve
  let m = 1

  const bite = player.contract.salary / Math.max(lens.capSpace, 1e6)
  if (lens.capSpace <= 0) m *= 0.80
  else if (bite >= 1) m *= 0.86
  else if (bite >= 0.6) m *= 0.93

  if (yrs >= 3) m *= clamp(1 + (1 - richness) * 0.10, 0.82, 1.14)
  if (lens.posture === 'rebuild' && yrs >= 3 && player.age >= 30) m *= 0.85
  if (lens.posture === 'contend' && yrs >= 4 && player.age >= 31) m *= 0.90

  // Rentals. An expiring veteran is deadline gold to a contender and close to
  // worthless to a rebuilder — and because the lens is symmetric, that is also
  // WHY the rebuilder sells him for a 2nd in February and the contender won't.
  if (yrs <= 1 && player.age >= 27) {
    if (lens.posture === 'contend') m *= 1 + 0.08 * lens.deadlineProximity
    else if (lens.posture === 'rebuild') m *= 0.55
    else m *= 0.8
  }

  return m
}

/**
 * What THIS club would pay for THIS player, in the shared trade currency.
 * Never equals `playerValue` except by coincidence — that is the point.
 */
export function clubPlayerValue(player: Player, lens: ClubLens): number {
  const base = playerValue(player)
  const m =
    lerpCurve(POSTURE_AGE_CURVE[lens.posture], player.age) *
    positionalFitMultiplier(player, lens) *
    contractLensMultiplier(player, lens) *
    philosophyGainBias(lens.philosophy, { kind: 'player', player })
  return base * m + upsidePremium(player, lens)
}

/**
 * What THIS club would pay for THIS pick. A rebuilder's currency is futures and
 * it bids them up as the deadline nears; a contender is spending next June to
 * win this April and discounts accordingly.
 */
export function clubPickValue(
  pick: DraftPick,
  lens: ClubLens,
  ctx: AssetValueContext,
): number {
  const base = pickValue(pick, ctx)
  const postureMult =
    lens.posture === 'rebuild' ? 1.10 + 0.12 * lens.deadlineProximity
    : lens.posture === 'contend' ? 0.90 - 0.06 * lens.deadlineProximity
    : 1.0
  return base * postureMult * philosophyGainBias(lens.philosophy, { kind: 'pick', pick })
}

/**
 * THE per-club asset valuation — the same signature as {@link assetValue} but
 * seen through one club's eyes. Use this anywhere a specific front office is
 * deciding; use `assetValue` only where you genuinely mean "the market".
 */
export function clubAssetValue(asset: TradeAsset, lens: ClubLens, ctx: AssetValueContext): number {
  return asset.kind === 'player'
    ? clubPlayerValue(asset.player, lens)
    : clubPickValue(asset.pick, lens, ctx)
}

/**
 * `clubAssetValue` plus the human-readable reasons THIS club lands where it
 * does — the lines that let the trade UI say "Detroit see him differently"
 * rather than printing a second decimal.
 */
export function describeClubValue(
  asset: TradeAsset,
  lens: ClubLens,
  ctx: AssetValueContext,
): { value: number; drivers: ValueDriver[] } {
  const value = clubAssetValue(asset, lens, ctx)
  const market = assetValue(asset, ctx)
  const drivers: ValueDriver[] = []
  const POSTURE_WORD: Record<ClubPostureKind, string> = {
    contend: 'Contending', retool: 'Retooling', rebuild: 'Rebuilding',
  }
  drivers.push({ label: `${POSTURE_WORD[lens.posture]} club`, tone: 'flat' })

  if (asset.kind === 'player') {
    const p = asset.player
    const ageM = lerpCurve(POSTURE_AGE_CURVE[lens.posture], p.age)
    if (ageM >= 1.06) drivers.push({ label: `Age ${p.age} fits their window`, tone: 'up' })
    else if (ageM <= 0.94) drivers.push({ label: `Age ${p.age} is off their timeline`, tone: 'down' })

    const up = upsidePremium(p, lens)
    if (up >= market * 0.12) drivers.push({ label: 'They pay for the ceiling', tone: 'up' })

    const fit = positionalFitMultiplier(p, lens)
    if (fit >= 1.05) {
      drivers.push({
        label: p.position === 'D'
          ? `Thin at ${p.handedness}-shot defence`
          : `Thin at ${p.position === 'G' ? 'goal' : p.position === 'C' ? 'centre' : 'the position'}`,
        tone: 'up',
      })
    } else if (fit <= 0.95) drivers.push({ label: 'Already deep there', tone: 'down' })

    const con = contractLensMultiplier(p, lens)
    if (con <= 0.92) {
      drivers.push({
        label: lens.capSpace < p.contract.salary ? 'They cannot fit the money' : 'The term scares them',
        tone: 'down',
      })
    } else if (con >= 1.06) drivers.push({ label: 'They like the contract', tone: 'up' })
  } else {
    if (lens.posture === 'rebuild') drivers.push({ label: 'Futures are their currency', tone: 'up' })
    else if (lens.posture === 'contend') drivers.push({ label: 'Picks are spending money to them', tone: 'down' })
  }

  const delta = market > 0 ? (value - market) / market : 0
  if (Math.abs(delta) >= 0.08) {
    drivers.push({
      label: `${delta > 0 ? 'Above' : 'Below'} market by ~${Math.round(Math.abs(delta) * 100)}%`,
      tone: delta > 0 ? 'up' : 'down',
    })
  }
  return { value, drivers }
}

/* ────────────────────────── retained salary ────────────────────────── */

/**
 * Retained-salary model (NHL rules):
 *  - A team can retain up to 50% of a player's cap hit per player.
 *  - A team may have at most 3 retained-salary contracts on its books at once.
 *  - A single contract can be retained at most twice (third-team broker model).
 *
 * `RetainedSalarySlot` records the retention commitment that stays with the
 * trading-away team after the deal. It is stored on the Career alongside
 * the main roster so it draws cap space.
 */
export interface RetainedSalarySlot {
  /** The player whose salary is being partially retained. */
  playerId: PlayerId
  /** Annual cap hit retained by the original team ($). */
  retainedAmount: number
  /** Contract year at which retention expires (mirrors player contract). */
  expiryYear: number
  /**
   * How many times this contract has been retained (1 or 2).
   * At 2 the slot is "fully brokered" and cannot be retained again.
   */
  retentionCount: number
}

/** Max percentage of cap hit a team may retain on one player. */
export const MAX_RETAIN_PCT = 0.50
/** Max retained-salary slots a team may carry simultaneously. */
export const MAX_RETAIN_SLOTS = 3
/** Max times a single contract may be retained (enables third-team broker). */
export const MAX_RETAIN_TIMES = 2

/**
 * Validate whether a team can add a new retained-salary commitment.
 *
 * Returns null if allowed, or a string describing the violation.
 */
export function canRetain(
  player: Player,
  retainPct: number,
  currentSlots: RetainedSalarySlot[],
  existingRetentionCount: number
): string | null {
  if (retainPct <= 0 || retainPct > MAX_RETAIN_PCT) {
    return `Retention must be between 1% and ${MAX_RETAIN_PCT * 100}% of cap hit`
  }
  const activeSlots = currentSlots.filter(
    (s) => s.playerId !== player.id
  ).length
  if (activeSlots >= MAX_RETAIN_SLOTS) {
    return `Team already has ${MAX_RETAIN_SLOTS} retained salary contracts`
  }
  if (existingRetentionCount >= MAX_RETAIN_TIMES) {
    return `This contract has already been retained ${MAX_RETAIN_TIMES} times`
  }
  return null
}

/**
 * The effective cap hit a team pays after retention.
 *
 * `retainedAmount` is the dollar amount the original team keeps paying.
 * Returns `{ receiverHit, retainerHit }` — what each side counts against cap.
 */
export function retentionCapSplit(
  player: Player,
  retainedAmount: number
): { receiverHit: number; retainerHit: number } {
  return {
    receiverHit: player.contract.salary - retainedAmount,
    retainerHit: retainedAmount,
  }
}

/**
 * AI-derived dollar value of $1M of cap relief per year, expressed in trade
 * points. Based on the Perri model: empirical pick cost of retained-salary
 * deals suggests ~1 round-3 equivalent pick per ~$1M/yr of cap relief.
 * We map that to trade points via the Perri curve.
 *
 * teamsPerRound=32 → round-3 slot ~97 → perriPickValue(97) ≈ 4.4 points/yr/$M
 */
export const CAP_RELIEF_POINTS_PER_MILLION = perriPickValue(97)

/**
 * AI value of a player deal WITH retained salary considered. A cap-strapped
 * buyer gains less from an expensive player; a relief provider (third-team)
 * earns pick value in return.
 *
 * `capSpaceAfter` is how much room the receiving team would have after absorbing
 * the full cap hit (before any retention). Negative = over cap.
 */
export function retentionValueBonus(
  retainedAmount: number,
  receivingTeamCapSpaceAfter: number
): number {
  if (retainedAmount <= 0) return 0
  const millionsRelieved = retainedAmount / 1e6
  // The more cap-strapped the receiver, the more they value the relief.
  const urgencyFactor = receivingTeamCapSpaceAfter < 5e6 ? 1.4 : 1.0
  return millionsRelieved * CAP_RELIEF_POINTS_PER_MILLION * urgencyFactor
}

/* ────────────────────────── proposal evaluation ────────────────────────── */

/** One side of a trade, with assets resolved to full objects. */
export interface TradePackage {
  players: Player[]
  picks: DraftPick[]
  /** Optional retained salary amounts, keyed by player id (string). */
  retainedAmounts?: Map<string, number>
}

export interface ProposalEvaluation {
  verdict: 'accept' | 'reject' | 'counter'
  /** AI GM's reasoning, shown to the user verbatim. */
  message: string
  /**
   * Additional value (trade points) the partner wants ADDED to the user's
   * side before they would accept. 0 when the verdict is 'accept'; the Career
   * uses it to assemble a concrete counter-offer.
   */
  counterAskValue: number
}

export type PositionGroup = 'F' | 'D' | 'G'

export const groupOf = (pos: Position): PositionGroup => (pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F')

/** Healthy roster sizes a club wants per group; below these, arrivals at the group are worth extra. */
export const GROUP_TARGET: Record<PositionGroup, number> = { F: 12, D: 6, G: 2 }

export function groupCounts(
  team: Team,
  players: Map<PlayerId, Player>,
  leaving: Player[]
): Record<PositionGroup, number> {
  const leavingIds = new Set(leaving.map((p) => p.id))
  const counts: Record<PositionGroup, number> = { F: 0, D: 0, G: 0 }
  for (const id of team.roster) {
    if (leavingIds.has(id)) continue
    const p = players.get(id)
    if (p) counts[groupOf(p.position)]++
  }
  return counts
}

const sumSalary = (ps: Player[], retainedAmounts?: Map<string, number>): number =>
  ps.reduce((s, p) => {
    const retained = retainedAmounts?.get(p.id as string) ?? 0
    return s + (p.contract.salary - retained)
  }, 0)

/** Earliest draft year named in the proposal — the discounting baseline. */
const baselineYear = (picks: DraftPick[]): number =>
  picks.length === 0 ? 0 : picks.reduce((min, p) => Math.min(min, p.year), Infinity)

const round1 = (v: number): number => Math.round(v * 10) / 10

/**
 * Evaluate a user proposal FROM THE PARTNER'S PERSPECTIVE. `give` is what the
 * user gives up (the partner receives), `receive` is what the user gets back
 * (the partner loses). The partner accepts when it gains ~3% in value (with a
 * seeded ±4% mood wiggle), counters when the offer is within 15% of that bar,
 * and rejects otherwise. No-trade clauses and the partner's salary cap are
 * hard gates checked before any value math.
 *
 * Philosophy biases (WinNow / FavorYoung / RebuildDraft / RebuildProspects)
 * are applied to the gain side so each club values assets differently.
 * Retained salary reduces the effective cap hit counted against the partner's
 * cap and adds bonus value reflecting cap relief.
 */
export function evaluateProposal(args: {
  give: TradePackage
  receive: TradePackage
  partnerTeam: Team
  partnerPlayers: Map<PlayerId, Player>
  rng: Rng
  /** The proposing GM's standing with this club (0–100, 50 = neutral). A friendly
   *  GM gets a slightly easier ask; a frosty one a harder one. Omitted/50 → no
   *  change (keeps existing trade behaviour byte-identical). */
  relationship?: number
  /** Persona-derived philosophy override (Living World LW3). Absent → the
   *  original hash-based teamPhilosophy (back-compat). */
  philosophy?: TeamPhilosophy
  /** Real-GM context (LW3 realism overhaul): the partner's competitive stance
   *  and deadline proximity (0 = October, 1 = the final hours). Shapes what
   *  THIS club would actually pay for — rentals, futures, urgency. */
  context?: { posture: 'contend' | 'retool' | 'rebuild'; deadlineProximity: number }
  /** #186: player ids whose no-trade clause has been waived for THIS deal (agent
   *  sign-off / an acceptable-destination list). Absent → no waivers (identical
   *  to the original behaviour). */
  waivedNtcIds?: ReadonlySet<string>
}): ProposalEvaluation {
  const { give, receive, partnerTeam, partnerPlayers, rng } = args

  // Draw the mood wiggle up front so rng consumption is identical on every
  // path — repeat evaluations with the same seed must match exactly.
  const moodThreshold = 1.03 + rng.float(-0.04, 0.04)
  // Relationship nudge applied AFTER the draw so RNG order is unchanged.
  const relAdj = ((50 - (args.relationship ?? 50)) / 50) * 0.1 // ±0.10 at the extremes
  let threshold = moodThreshold + relAdj

  const waived = args.waivedNtcIds
  const ntc = [...give.players, ...receive.players].find(
    (p) => p.contract.noTradeClause && !(waived?.has(p.id as string) ?? false)
  )
  if (ntc) {
    return {
      verdict: 'reject',
      message: `${ntc.name} has a no-trade clause — that deal is a non-starter.`,
      counterAskValue: 0
    }
  }

  // Cap check: retained salary on incoming players reduces the partner's cap hit.
  // Compute the partner's cap hit from their ACTUAL roster, not the stored
  // finances.capUsed — that field goes stale across a season (retirements,
  // departures, ELCs, call-ups) and a stale-high value wrongly rejects deals
  // that actually shed salary. Matches how applyTrade recomputes cap.
  const incomingSalary = sumSalary(give.players, give.retainedAmounts)
  const outgoingSalary = sumSalary(receive.players)
  const partnerCapUsed = rosterCapUsed(partnerTeam, partnerPlayers)
  const capAfter = partnerCapUsed + incomingSalary - outgoingSalary
  if (capAfter > partnerTeam.finances.salaryCap) {
    return {
      verdict: 'reject',
      message: `${partnerTeam.name} can't fit those contracts — the deal would put them over the salary cap.`,
      counterAskValue: 0
    }
  }

  /* ── real-GM rule: never leave yourself short ──
   * A club will not deal itself below a playable roster at any position, no
   * matter the value coming back at other spots. Nobody trades their only
   * goalie for three wingers. */
  {
    const post: Record<PositionGroup, number> = { F: 0, D: 0, G: 0 }
    const outIds = new Set(receive.players.map((pl) => pl.id as string))
    for (const id of partnerTeam.roster) {
      if (outIds.has(id as string)) continue
      const pl = partnerPlayers.get(id)
      if (pl) post[groupOf(pl.position)]++
    }
    for (const pl of give.players) post[groupOf(pl.position)]++
    // One short up front is recallable from the farm; gutted is gutted.
    const MIN: Record<PositionGroup, number> = { F: 8, D: 4, G: 2 }
    for (const g of ['F', 'D', 'G'] as const) {
      const netOut =
        receive.players.filter((pl) => groupOf(pl.position) === g).length -
        give.players.filter((pl) => groupOf(pl.position) === g).length
      if (netOut > 0 && post[g] < MIN[g]) {
        const short = g === 'G' ? 'in the crease' : g === 'D' ? 'on the blue line' : 'up front'
        return {
          verdict: 'reject',
          message: `${partnerTeam.name} won't do it — the deal would leave them short ${short}, and no return at other positions fixes that.`,
          counterAskValue: 0
        }
      }
    }
  }

  const year = baselineYear([...give.picks, ...receive.picks])

  const philosophy = args.philosophy ?? teamPhilosophy(partnerTeam.id)
  const ctx = args.context

  /* ── THE LENS ──
   * The partner prices every asset in this deal as ITSELF: its posture, its GM,
   * the shape of its roster after the deal, its cap sheet, the date. The SAME
   * lens is used on both sides, which is the whole point — a rebuilder both
   * sells its 31-year-old cheap and refuses its 22-year-old, because those are
   * the same belief seen from two directions. */
  const lens: ClubLens = {
    philosophy,
    posture: ctx?.posture ?? defaultPostureFor(philosophy),
    // Depth judged AFTER the players it is sending out have left the room.
    depth: clubDepthOf(partnerTeam, partnerPlayers, receive.players),
    capSpace: partnerTeam.finances.salaryCap - partnerCapUsed,
    deadlineProximity: ctx?.deadlineProximity ?? 0,
  }
  const lensCtx: AssetValueContext = { year }
  const lensPlayer = (p: Player): number => clubPlayerValue(p, lens)
  const lensPick = (p: DraftPick): number => clubPickValue(p, lens, lensCtx)

  // Gain = what the partner receives (the user's "give" side).
  const gain =
    give.players.reduce((s, p) => {
      const base = lensPlayer(p)
      // Cap relief bonus: if the player's salary is retained by the other side,
      // the partner benefits from reduced cap hit.
      const retained = give.retainedAmounts?.get(p.id as string) ?? 0
      // Fresh roster cap (partnerCapUsed), not the stale finances.capUsed — same
      // reason the hard cap check above was switched off the stored field.
      const partnerCapAfterPlayer = partnerCapUsed + (p.contract.salary - retained) - outgoingSalary
      const relief = retentionValueBonus(retained, partnerTeam.finances.salaryCap - partnerCapAfterPlayer)
      return s + base + relief
    }, 0) +
    give.picks.reduce((s, p) => s + lensPick(p), 0)

  // Loss = what the partner gives up (the user's "receive" side), priced through
  // the SAME lens. Before this, a club valued its own players at flat market —
  // which is why a rebuilder would hand over a blue-chip 22-year-old for a good
  // 28-year-old, and why every club in the league quoted the same price.
  // Real-GM rule on top: the endowment effect — every GM values his own players
  // a shade above his own book (picks are commodity; players are HIS guys).
  const ENDOWMENT = OWN_PLAYER_ENDOWMENT
  const loss =
    receive.players.reduce((s, p) => s + lensPlayer(p) * ENDOWMENT, 0) +
    receive.picks.reduce((s, p) => s + lensPick(p), 0)

  /* ── real-GM rule: the young core is basically untouchable ──
   * Prying a cornerstone out of any front office takes a massive overpay — real
   * GMs get fired for moving those players, and they know it. "Cornerstone" is
   * now a LENS judgement: a rebuilder's untouchable is not a contender's. */
  const cornerstones = receive.players.filter(
    (p) => p.age <= CORNERSTONE_MAX_AGE && lensPlayer(p) >= CORNERSTONE_VALUE,
  )
  if (cornerstones.some((p) => p.age <= 23)) threshold += 0.35
  else if (cornerstones.length > 0) threshold += 0.22

  /* ── real-GM rule: the best player in the deal wins the deal ──
   * Nobody trades a top-six player for four third-liners. If the partner is
   * giving up a clear best asset, the return must be headlined by something
   * comparable — quantity is not quality. Priced through the lens, and the bar
   * rises to near-parity when the asset leaving is a cornerstone: a club moving
   * its future wants a player back, not a pile. */
  // Only PLAYERS headline a deal. Picks are commodity — a 1st for two 2nds is a
  // value trade nobody calls an insult — so the rule keys off the best player
  // leaving, and the best single asset (of either kind) coming back.
  const bestOut = Math.max(0, ...receive.players.map(lensPlayer))
  const bestIn = Math.max(
    0,
    ...give.players.map(lensPlayer),
    ...give.picks.map(lensPick)
  )
  const headlineBar = cornerstones.length > 0 ? 0.85 : 0.62
  if (bestOut >= HEADLINE_MIN_VALUE && bestIn < bestOut * headlineBar) {
    const cornerstone = cornerstones[0]
    return {
      verdict: 'reject',
      message: cornerstone
        ? `${partnerTeam.name} aren't moving ${cornerstone.name} for that. He's the kind of player you build around — if he goes anywhere, a comparable player comes back, not a package.`
        : `${partnerTeam.name} pass. ${receive.players.length + receive.picks.length > 1 ? 'Quantity is not quality — ' : ''}they need the best asset in the deal coming back their way, not depth pieces.`,
      counterAskValue: round1(bestOut * (headlineBar + 0.1) - bestIn)
    }
  }

  /* ── real-GM rule: blockbusters die on the margin ──
   * Star-level deals carry career risk for the GM who makes them; the bar is
   * higher and the phone calls are longer. */
  if (bestOut >= 70) threshold += 0.05

  /* ── real-GM rule: you don't take on money you can't spend ──
   * A club whose entire remaining cap space would go into one arriving contract
   * needs to be paid to do it, not merely convinced the hockey is even. */
  if (lens.capSpace > 0 && incomingSalary - outgoingSalary > lens.capSpace * 0.75) {
    threshold += 0.08
  }

  /* ── deadline urgency: a contender buying help near the deadline is the one
   * moment a real GM knowingly pays a little over ── */
  if (ctx && ctx.posture === 'contend' && give.players.length > 0) {
    threshold -= 0.04 * ctx.deadlineProximity
  }

  if (loss <= 0) {
    return gain > 0
      ? { verdict: 'accept', message: `${partnerTeam.name} accept — they give up nothing they'll miss.`, counterAskValue: 0 }
      : { verdict: 'reject', message: 'There is nothing of substance in this proposal.', counterAskValue: 0 }
  }

  const ratio = gain / loss
  if (ratio >= threshold) {
    return { verdict: 'accept', message: `Deal. ${partnerTeam.name} accept the trade.`, counterAskValue: 0 }
  }

  const shortfall = round1(loss * threshold - gain)
  const gapPct = Math.max(1, Math.round(((threshold - ratio) / threshold) * 100))
  if (ratio >= threshold - 0.15) {
    return {
      verdict: 'counter',
      message: `Close, but ${partnerTeam.name} want a little more — sweeten your side by roughly ${gapPct}% and there's a deal here.`,
      counterAskValue: shortfall
    }
  }
  return {
    verdict: 'reject',
    message: `Not close. Your offer falls about ${gapPct}% short of what ${partnerTeam.name} would need back.`,
    counterAskValue: shortfall
  }
}

/* ────────────────────────── execution ────────────────────────── */

function assertOnRoster(team: Team, ids: PlayerId[]): void {
  for (const id of ids) {
    if (!team.roster.includes(id)) {
      throw new Error(`Trade invalid: player ${id} is not on ${team.name}'s roster`)
    }
  }
}

/** Picks are matched structurally (year/round/original/owner), not by reference. */
function findOwnedPicks(allPicks: DraftPick[], wanted: DraftPick[], owner: TeamId): DraftPick[] {
  return wanted.map((m) => {
    const entry = allPicks.find(
      (p) =>
        p.year === m.year &&
        p.round === m.round &&
        p.originalTeamId === m.originalTeamId &&
        p.ownerTeamId === owner
    )
    if (!entry) {
      throw new Error(
        `Trade invalid: team ${owner} does not own the ${m.year} round-${m.round} pick (orig ${m.originalTeamId})`
      )
    }
    return entry
  })
}

function movePlayers(from: Team, to: Team, ids: PlayerId[], players: Map<PlayerId, Player>): void {
  for (const id of ids) {
    from.roster.splice(from.roster.indexOf(id), 1)
    to.roster.push(id)
    // Rights follow the player to the acquiring club. Only update an existing
    // holder so we don't fabricate rights for players who never had any tracked.
    const p = players.get(id)
    if (p && p.rightsTeamId !== undefined) p.rightsTeamId = to.id
  }
}

/** Roster ids missing from the player map contribute nothing to the cap. Each
 *  rostered player counts his hit minus any salary a former club retained on him;
 *  salary this club retained on players it traded away is added on top (#157). */
export const rosterCapUsed = (team: Team, players: Map<PlayerId, Player>): number => {
  let sum = 0
  for (const id of team.roster) {
    const p = players.get(id)
    if (p) sum += p.contract.salary - (p.contract.retainedByOthers ?? 0)
  }
  for (const slot of team.finances.retained ?? []) sum += slot.amount
  return sum
}

/**
 * Apply an agreed trade: move players between roster arrays, flip pick
 * ownership on the matching `allPicks` entries, and recompute both clubs'
 * finances.capUsed. Atomic: every asset is validated before anything mutates,
 * and it throws when a stated player or pick is not actually held by the
 * giving team. Lines are deliberately NOT touched; the Career repairs
 * deployment after roster changes.
 */
export function executeTrade(args: {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  teamA: TeamId
  teamB: TeamId
  aGivesPlayerIds: PlayerId[]
  aGivesPicks: DraftPick[]
  bGivesPlayerIds: PlayerId[]
  bGivesPicks: DraftPick[]
  allPicks: DraftPick[]
}): void {
  const a = args.teams.get(args.teamA)
  const b = args.teams.get(args.teamB)
  if (!a || !b) throw new Error('Trade invalid: unknown team id')

  assertOnRoster(a, args.aGivesPlayerIds)
  assertOnRoster(b, args.bGivesPlayerIds)
  const aPicks = findOwnedPicks(args.allPicks, args.aGivesPicks, args.teamA)
  const bPicks = findOwnedPicks(args.allPicks, args.bGivesPicks, args.teamB)

  movePlayers(a, b, args.aGivesPlayerIds, args.players)
  movePlayers(b, a, args.bGivesPlayerIds, args.players)
  for (const p of aPicks) p.ownerTeamId = args.teamB
  for (const p of bPicks) p.ownerTeamId = args.teamA

  a.finances.capUsed = rosterCapUsed(a, args.players)
  b.finances.capUsed = rosterCapUsed(b, args.players)
}

/* ────────────────────────── AI-initiated offers ────────────────────────── */

/**
 * An AI club's standing offer to the user, stored on the Career until it is
 * accepted, declined, or expires. JSON-safe (picks are plain copies).
 */
export interface StoredTradeOffer {
  offerId: string
  partnerTeamId: TeamId
  userReceivesPlayerIds: PlayerId[]
  userReceivesPicks: DraftPick[]
  userGivesPlayerIds: PlayerId[]
  userGivesPicks: DraftPick[]
  message: string
  expiresOnDay: number
}

type Asset =
  | { kind: 'player'; player: Player; value: number }
  | { kind: 'pick'; pick: DraftPick; value: number }

const assetKey = (a: Asset): string =>
  a.kind === 'player'
    ? `p:${a.player.id}`
    : `k:${a.pick.year}-${a.pick.round}-${a.pick.originalTeamId}`

const ordinal = (n: number): string =>
  n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`

const assetLabel = (a: Asset): string =>
  a.kind === 'player' ? a.player.name : `their ${a.pick.year} ${ordinal(a.pick.round)}-round pick`

const NEED_LABEL: Record<PositionGroup, string> = {
  F: 'forward group',
  D: 'blue line',
  G: 'crease'
}

/** Position group where a club's average overall is lowest — its trade need. */
function weakestGroup(team: Team, players: Map<PlayerId, Player>): PositionGroup {
  const sums: Record<PositionGroup, { total: number; n: number }> = {
    F: { total: 0, n: 0 },
    D: { total: 0, n: 0 },
    G: { total: 0, n: 0 }
  }
  for (const id of team.roster) {
    const p = players.get(id)
    if (!p) continue
    const g = groupOf(p.position)
    sums[g].total += ratedOverall(p)
    sums[g].n++
  }
  let worst: PositionGroup = 'F'
  let worstAvg = Infinity
  for (const g of ['F', 'D', 'G'] as const) {
    const { total, n } = sums[g]
    const avg = n === 0 ? 0 : total / n
    if (avg < worstAvg) {
      worstAvg = avg
      worst = g
    }
  }
  return worst
}

/** League strength ranks by mean roster overall; 1 = strongest. */
function strengthRanks(
  teams: Map<TeamId, Team>,
  players: Map<PlayerId, Player>
): Map<TeamId, number> {
  const means: Array<[TeamId, number]> = []
  for (const t of teams.values()) {
    let total = 0
    let n = 0
    for (const id of t.roster) {
      const p = players.get(id)
      if (!p) continue
      total += ratedOverall(p)
      n++
    }
    means.push([t.id, n === 0 ? 0 : total / n])
  }
  means.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
  return new Map(means.map(([id], i) => [id, i + 1]))
}

/**
 * Occasionally (~1 match day in 8) one AI club targets a user player at the
 * position group it is weakest at and assembles a value-rational package of
 * its own players and/or picks (within ~±20% of the target's playerValue,
 * with a slight overpay tendency to tempt the user). Returns zero or one
 * offer; offers expire about a week after `day`. Pure function of its inputs
 * plus the seeded Rng — same seed, same offer.
 */
export function generateAiOffers(args: {
  day: number
  userTeamId: TeamId
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  picks: DraftPick[]
  rng: Rng
  nextOfferId: () => string
  /** Trade deadline day — offers ramp up as it approaches (Living World LW3).
   *  Absent → the original flat 1/8 rate (back-compat). */
  deadlineDay?: number
  /** Club stance lookup: contenders shop hardest, rebuilders rarely buy. */
  postureOf?: (teamId: TeamId) => 'contend' | 'retool' | 'rebuild'
  /** GM aggression lookup, 0–1 — aggressive GMs overpay more. */
  aggressionOf?: (teamId: TeamId) => number
  /** The user's buyout dead cap, which counts against his ceiling like any other
   *  money. Absent → 0. */
  userDeadCap?: number
}): StoredTradeOffer[] {
  const { day, userTeamId, teams, players, picks, rng, nextOfferId } = args

  // Deadline urgency: quiet in October, frantic in deadline week — up to ~3.5×
  // the base offer rate in the final days (Living World LW3).
  const daysLeft = args.deadlineDay !== undefined ? args.deadlineDay - day : undefined
  let chance = 1 / 8
  if (daysLeft !== undefined && daysLeft >= 0 && daysLeft <= 20) {
    chance = (1 / 8) * (1 + 2.5 * (1 - daysLeft / 20))
  }
  if (!rng.chance(chance)) return []

  const user = teams.get(userTeamId)
  if (!user) return []
  const aiTeams = [...teams.values()].filter((t) => t.id !== userTeamId)
  if (aiTeams.length === 0) return []

  // Posture-weighted partner selection: contenders come calling most often.
  let partner: Team
  if (args.postureOf) {
    const weighted = aiTeams.map((t) => {
      const posture = args.postureOf!(t.id)
      return { t, w: posture === 'contend' ? 3 : posture === 'rebuild' ? 0.6 : 1 }
    })
    const total = weighted.reduce((s, e) => s + e.w, 0)
    let roll = rng.float(0, total)
    partner = weighted[weighted.length - 1]!.t
    for (const e of weighted) {
      roll -= e.w
      if (roll <= 0) { partner = e.t; break }
    }
  } else {
    partner = rng.pick(aiTeams)
  }
  const need = weakestGroup(partner, players)

  // The offering club's own lens — it must price BOTH the player it wants and
  // the assets it would part with as itself. Without this the AI would happily
  // table its own blue-chip 22-year-old for a market-priced veteran, which is
  // exactly the deal `evaluateProposal` now refuses when the user proposes it.
  const offerLens: ClubLens = {
    philosophy: teamPhilosophy(partner.id),
    posture: args.postureOf?.(partner.id) ?? defaultPostureFor(teamPhilosophy(partner.id)),
    depth: clubDepthOf(partner, players),
    capSpace: partner.finances.salaryCap - rosterCapUsed(partner, players),
    deadlineProximity:
      daysLeft !== undefined && daysLeft >= 0 && daysLeft <= 45 ? 1 - daysLeft / 45 : 0,
  }

  // Target one of the user's best few players at the need group. NTC players
  // would veto the move and injured players don't get shopped for.
  const shoppable = user.roster
    .map((id) => players.get(id))
    .filter(
      (p): p is Player =>
        p !== undefined &&
        groupOf(p.position) === need &&
        !p.contract.noTradeClause &&
        p.injuryStatus === null
    )
    .map((player) => ({ player, value: clubPlayerValue(player, offerLens) }))
    .sort((x, y) => y.value - x.value || (x.player.id < y.player.id ? -1 : 1))

  // The shop floor is absolute, and on a weak league nobody clears it. Measured
  // on the vanilla generated league: MIN_SHOP_VALUE (8, ≈ a depth NHLer) sits
  // ABOVE the 90th percentile of player value — median 1.0, p90 7.1 — and a
  // typical roster peaks around 2.7, so target selection returned empty every
  // time and the AI never called about anyone. Real GMs still trade in a weak
  // league; they just trade its best players.
  //
  // So the bar is the league's own: the fixed floor normally, or this roster's
  // top man when nobody reaches it. `MIN_TRADEABLE` keeps genuine replacement
  // level out of it, so a roster of nobodies still draws no calls.
  const MIN_TRADEABLE = 0.5
  const best = shoppable[0]?.value ?? 0
  const floor = best >= MIN_SHOP_VALUE ? MIN_SHOP_VALUE : Math.max(MIN_TRADEABLE, best)
  const targets = shoppable.filter((t) => t.value >= floor).slice(0, 3)
  if (targets.length === 0) return []
  const target = rng.pick(targets)

  // Fair-ish aim with a slight overpay tendency — AI clubs chase their need.
  // Aggressive GMs stretch further, and deadline week adds desperation.
  const aggression = args.aggressionOf?.(partner.id)
  const urgencyBump = daysLeft !== undefined && daysLeft >= 0 && daysLeft <= 7 ? 0.06 : 0
  const aimHi = aggression === undefined ? 1.15 : 1.03 + 0.18 * aggression + urgencyBump
  const aim = target.value * rng.float(1.0, aimHi)

  const ranks = strengthRanks(teams, players)
  const currentYear =
    picks.length === 0 ? 0 : picks.reduce((min, p) => Math.min(min, p.year), Infinity)

  // Candidate assets: the partner's players (keeping its need group and both
  // goalies at home) plus the picks it currently owns.
  const candidates: Asset[] = []
  for (const id of partner.roster) {
    const p = players.get(id)
    if (!p || p.contract.noTradeClause || p.injuryStatus !== null) continue
    if (p.position === 'G' || groupOf(p.position) === need) continue
    const v = clubPlayerValue(p, offerLens)
    // A club does not offer up its own cornerstone unprompted.
    if (p.age <= CORNERSTONE_MAX_AGE && v >= CORNERSTONE_VALUE) continue
    candidates.push({ kind: 'player', player: p, value: v })
  }
  for (const pick of picks) {
    if (pick.ownerTeamId !== partner.id) continue
    const rank = ranks.get(pick.originalTeamId)
    const ctx = rank === undefined
      ? { year: currentYear }
      : { year: currentYear, teamStrengthRank: rank }
    candidates.push({ kind: 'pick', pick, value: clubPickValue(pick, offerLens, ctx) })
  }
  candidates.sort((x, y) => y.value - x.value || (assetKey(x) < assetKey(y) ? -1 : 1))

  // Greedy fill: largest assets that still fit under aim×1.2, max three.
  const chosen: Asset[] = []
  let total = 0
  for (const c of candidates) {
    if (chosen.length >= 3 || total >= aim) break
    if (total + c.value > aim * 1.2) continue
    chosen.push(c)
    total += c.value
  }
  if (chosen.length === 0 || total < target.value * 0.85) return []

  // The partner must be able to absorb the incoming salary.
  const salaryOut = chosen.reduce(
    (s, c) => s + (c.kind === 'player' ? c.player.contract.salary : 0),
    0
  )
  const partnerCapAfter =
    partner.finances.capUsed + target.player.contract.salary - salaryOut
  if (partnerCapAfter > partner.finances.salaryCap) return []

  // ...and so must the user. Only the partner's cap was ever checked, so clubs
  // rang up offering more money than the GM had room for; the offer sat on his
  // desk looking live and threw the moment he hit Accept. A deal he cannot
  // legally complete is not an offer — don't make it. (Cap room can still shrink
  // between now and the click, which is what `blockedReason` covers.)
  const userCapAfter =
    rosterCapUsed(user, players) + (args.userDeadCap ?? 0) + salaryOut - target.player.contract.salary
  if (userCapAfter > user.finances.salaryCap) return []

  const offer: StoredTradeOffer = {
    offerId: nextOfferId(),
    partnerTeamId: partner.id,
    userReceivesPlayerIds: chosen
      .filter((c): c is Extract<Asset, { kind: 'player' }> => c.kind === 'player')
      .map((c) => c.player.id),
    userReceivesPicks: chosen
      .filter((c): c is Extract<Asset, { kind: 'pick' }> => c.kind === 'pick')
      .map((c) => ({ ...c.pick })),
    userGivesPlayerIds: [target.player.id],
    userGivesPicks: [],
    message: `${partner.name} are after ${target.player.name} to shore up their ${NEED_LABEL[need]}. On the table: ${chosen.map(assetLabel).join(', ')}.`,
    expiresOnDay: day + rng.range(6, 8)
  }
  return [offer]
}

/**
 * DEPTH 3: the user actively SHOPS a specific player. Every AI club that is
 * thin at his position group tables its best concrete package (same value +
 * overpay logic as the unsolicited offers), and the strongest few are returned,
 * sorted by generosity. Pure function of its inputs + the seeded Rng.
 */
export function solicitOffersForPlayer(args: {
  target: Player
  userTeamId: TeamId
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  picks: DraftPick[]
  rng: Rng
  nextOfferId: () => string
  expiresOnDay: number
  /** GM aggression lookup, 0–1 — aggressive GMs stretch their package further. */
  aggressionOf?: (teamId: TeamId) => number
  /** Club stance lookup — each bidder prices him through its own lens. */
  postureOf?: (teamId: TeamId) => ClubPostureKind
  /** 0 = October … 1 = the deadline hours. */
  deadlineProximity?: number
  /** Cap on how many offers come back (default 4). */
  maxOffers?: number
  /** The user's buyout dead cap, counted against his ceiling. Absent → 0. */
  userDeadCap?: number
}): StoredTradeOffer[] {
  const { target, userTeamId, teams, players, picks, rng, nextOfferId, expiresOnDay } = args
  const user = teams.get(userTeamId)
  const tgtGroup = groupOf(target.position)
  const ranks = strengthRanks(teams, players)
  const currentYear =
    picks.length === 0 ? 0 : picks.reduce((min, p) => Math.min(min, p.year), Infinity)

  const built: Array<{ offer: StoredTradeOffer; total: number }> = []
  for (const partner of teams.values()) {
    if (partner.id === userTeamId) continue
    // Interested only if this club is below its target depth at his group.
    if (groupCounts(partner, players, [])[tgtGroup] >= GROUP_TARGET[tgtGroup]) continue

    const aggression = args.aggressionOf?.(partner.id)
    const aimHi = aggression === undefined ? 1.15 : 1.03 + 0.18 * aggression

    // This club's own book. Two clubs shopping the same player table different
    // packages because they do not agree on what he is worth.
    const bidLens: ClubLens = {
      philosophy: teamPhilosophy(partner.id),
      posture: args.postureOf?.(partner.id) ?? defaultPostureFor(teamPhilosophy(partner.id)),
      depth: clubDepthOf(partner, players),
      capSpace: partner.finances.salaryCap - rosterCapUsed(partner, players),
      deadlineProximity: args.deadlineProximity ?? 0,
    }
    const myValueOfTarget = clubPlayerValue(target, bidLens)
    const aim = myValueOfTarget * rng.float(1.0, aimHi)

    // Candidate assets: the partner's players (keeping his need group + both
    // goalies at home) plus the picks he owns.
    const candidates: Asset[] = []
    for (const id of partner.roster) {
      const p = players.get(id)
      if (!p || p.contract.noTradeClause || p.injuryStatus !== null) continue
      if (p.position === 'G' || groupOf(p.position) === tgtGroup) continue
      const v = clubPlayerValue(p, bidLens)
      if (p.age <= CORNERSTONE_MAX_AGE && v >= CORNERSTONE_VALUE) continue
      candidates.push({ kind: 'player', player: p, value: v })
    }
    for (const pick of picks) {
      if (pick.ownerTeamId !== partner.id) continue
      const rank = ranks.get(pick.originalTeamId)
      const ctx = rank === undefined
        ? { year: currentYear }
        : { year: currentYear, teamStrengthRank: rank }
      candidates.push({ kind: 'pick', pick, value: clubPickValue(pick, bidLens, ctx) })
    }
    candidates.sort((x, y) => y.value - x.value || (assetKey(x) < assetKey(y) ? -1 : 1))

    const chosen: Asset[] = []
    let total = 0
    for (const c of candidates) {
      if (chosen.length >= 3 || total >= aim) break
      if (total + c.value > aim * 1.2) continue
      chosen.push(c)
      total += c.value
    }
    if (chosen.length === 0 || total < myValueOfTarget * 0.85) continue

    const salaryOut = chosen.reduce((s, c) => s + (c.kind === 'player' ? c.player.contract.salary : 0), 0)
    if (partner.finances.capUsed + target.contract.salary - salaryOut > partner.finances.salaryCap) continue
    // Both cap sheets have to work — an offer the user could not legally accept
    // is noise on his desk (see generateAiOffers).
    if (user) {
      const userCapAfter =
        rosterCapUsed(user, players) + (args.userDeadCap ?? 0) + salaryOut - target.contract.salary
      if (userCapAfter > user.finances.salaryCap) continue
    }

    built.push({
      total,
      offer: {
        offerId: nextOfferId(),
        partnerTeamId: partner.id,
        userReceivesPlayerIds: chosen
          .filter((c): c is Extract<Asset, { kind: 'player' }> => c.kind === 'player')
          .map((c) => c.player.id),
        userReceivesPicks: chosen
          .filter((c): c is Extract<Asset, { kind: 'pick' }> => c.kind === 'pick')
          .map((c) => ({ ...c.pick })),
        userGivesPlayerIds: [target.id],
        userGivesPicks: [],
        message: `${partner.name} have interest in ${target.name}. On the table: ${chosen.map(assetLabel).join(', ')}.`,
        expiresOnDay,
      },
    })
  }
  built.sort((a, b) => b.total - a.total || (a.offer.partnerTeamId < b.offer.partnerTeamId ? -1 : 1))
  return built.slice(0, args.maxOffers ?? 4).map((b) => b.offer)
}

/* ────────────────────────── AI ↔ AI trades (Living World LW3) ────────────────────────── */

/** A league trade between two AI clubs: the seller moves a veteran for draft
 *  capital. The career layer executes it, chronicles it and reports the news. */
export interface AiAiTradeResult {
  sellerTeamId: TeamId
  buyerTeamId: TeamId
  /** Players the SELLER gives up (NHL roster). */
  playerIds: PlayerId[]
  /** Picks the BUYER gives up. */
  picks: DraftPick[]
  /** Prospects the BUYER gives up as part of the return — an AHL affiliate
   *  player or a rights-held junior. They move into the SELLER's system (his AHL,
   *  or rights). Empty for a pure picks-for-rental deal. */
  prospectIds: PlayerId[]
  /** Salary the SELLER retains to make the deal fit under the buyer's cap (#157).
   *  Absent/0 = no retention. The seller keeps paying this until the deal expires. */
  retainedAmount?: number
  summary: string
}

/**
 * Occasionally two AI clubs make a deal with each other — the league lives
 * without the user. A rebuild-posture seller moves a veteran on an expiring
 * or short deal to a contend-posture buyer for draft capital. Frequency is
 * quiet early (~1 in 12 match days) and ramps toward the deadline (~1 in 4).
 * Pure function of its inputs + the seeded Rng.
 */
export function generateAiAiTrade(args: {
  day: number
  deadlineDay?: number
  userTeamId: TeamId
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  picks: DraftPick[]
  rng: Rng
  postureOf: (teamId: TeamId) => 'contend' | 'retool' | 'rebuild'
}): AiAiTradeResult | null {
  const { day, userTeamId, teams, players, picks, rng, postureOf } = args

  const daysLeft = args.deadlineDay !== undefined ? args.deadlineDay - day : undefined
  let chance = 1 / 9
  if (daysLeft !== undefined && daysLeft >= 0 && daysLeft <= 20) {
    chance = (1 / 9) * (1 + 2.5 * (1 - daysLeft / 20))
  }
  if (!rng.chance(chance)) return null

  // NHL clubs only — the AHL/junior/world tiers never trade with the NHL here.
  const ai = [...teams.values()].filter(
    (t) => t.id !== userTeamId && t.tier !== 'ahl' && t.tier !== 'world',
  )

  // Sellers: clubs NOT in a win-now push (rebuild or retool) with a healthy,
  // movable veteran and roster depth to spare. The vet is on a short deal — an
  // expiring rental or a 1–2-year piece a retooling club is happy to move.
  const sellers = ai
    .filter((t) => (postureOf(t.id) === 'rebuild' || postureOf(t.id) === 'retool') && t.roster.length >= 20)
    .map((t) => {
      const vets = t.roster
        .map((id) => players.get(id))
        .filter(
          (p): p is Player =>
            p !== undefined &&
            p.age >= 26 &&
            p.contract.yearsRemaining <= 2 &&
            !p.contract.noTradeClause &&
            p.injuryStatus === null &&
            p.position !== 'G' &&
            playerValue(p) >= MIN_SHOP_VALUE
        )
        .sort((a, b) => playerValue(b) - playerValue(a) || (a.id < b.id ? -1 : 1))
      return { team: t, vet: vets[0] }
    })
    .filter((s): s is { team: Team; vet: Player } => s.vet !== undefined)
    .sort((a, b) => (a.team.id < b.team.id ? -1 : 1))
  if (sellers.length === 0) return null
  const seller = rng.pick(sellers)
  const vetValue = playerValue(seller.vet)

  // Buyers: clubs adding for a push (contenders, or retoolers rounding out a
  // roster) that can absorb the salary, have roster room, and own draft capital
  // worth roughly the vet.
  const ranks = strengthRanks(teams, players)
  const currentYear = picks.length === 0 ? 0 : picks.reduce((min, p) => Math.min(min, p.year), Infinity)
  const vetSalary = seller.vet.contract.salary
  // The seller can retain salary to make a cap-tight buyer fit — but only if he
  // has a free retention slot (NHL rule: max 3 retained contracts per club).
  const sellerHasRetentionSlot = (seller.team.finances.retained?.length ?? 0) < MAX_RETAIN_SLOTS
  const buyers = ai
    .filter(
      (t) =>
        t.id !== seller.team.id &&
        (postureOf(t.id) === 'contend' || postureOf(t.id) === 'retool') &&
        t.roster.length < 23,
    )
    .map((t) => {
      const room = t.finances.salaryCap - rosterCapUsed(t, players)
      if (vetSalary <= room) return { team: t, retained: 0 }
      // Doesn't fit outright — see if retaining (up to 50%) makes it work.
      if (!sellerHasRetentionSlot) return null
      const needed = vetSalary - room
      if (needed > vetSalary * MAX_RETAIN_PCT) return null // can't retain enough to fit
      return { team: t, retained: Math.ceil(needed) }
    })
    .filter((x): x is { team: Team; retained: number } => x !== null)
    .sort((a, b) => (a.team.id < b.team.id ? -1 : 1))
  for (const { team: buyer, retained } of rng.shuffle(buyers)) {
    const owned = picks
      .filter((p) => p.ownerTeamId === buyer.id)
      .map((pick) => {
        const rank = ranks.get(pick.originalTeamId)
        const value = rank === undefined
          ? pickValue(pick, { year: currentYear })
          : pickValue(pick, { year: currentYear, teamStrengthRank: rank })
        return { pick, value }
      })
      .sort((x, y) => y.value - x.value)

    // Real returns aren't only picks — a rental often fetches "a pick and a
    // prospect". Decide up front (≈ half the time, when the buyer has a tradeable
    // prospect worth at most 3/4 of the return) whether a prospect anchors the
    // deal, and take it FIRST so the picks top up the remaining room rather than a
    // single 1st filling the whole band and squeezing the prospect out.
    const prospects = buyerProspects(buyer, teams, players).sort((a, b) => playerValue(b) - playerValue(a))
    const wantProspect = prospects.length > 0 && rng.chance(0.5)
    let prospect: Player | null = null
    if (wantProspect) {
      for (const pr of rng.shuffle(prospects)) {
        if (playerValue(pr) <= vetValue * 0.75) { prospect = pr; break }
      }
    }

    // Greedy 1–2 picks toward fair value. `vetValue` already carries the rental
    // discount (an expiring deal is priced as a rental, not an asset), so the
    // whole return is roughly 50–105% of that discounted value — the seller has
    // limited leverage but still gets close to fair for a short-term piece (e.g.
    // a good rental ≈ a 2nd/3rd, matching real deadline precedent).
    const stop = vetValue * 0.75
    const ceil = vetValue * 1.05
    const chosen: DraftPick[] = []
    let total = prospect ? playerValue(prospect) : 0
    for (const c of owned) {
      if (chosen.length >= 2 || total >= stop) break
      if (total + c.value > ceil) continue
      chosen.push(c.pick)
      total += c.value
    }
    const returnTotal = total
    // A prospect can carry the deal on its own, so the floor relaxes when one's in it.
    const floor = prospect ? vetValue * 0.4 : vetValue * 0.5
    if ((chosen.length === 0 && !prospect) || returnTotal < floor || returnTotal > ceil) continue
    const parts = [
      ...chosen.map((p) => `a ${p.year} ${ordinal(p.round)}-round pick`),
      ...(prospect ? [`${prospect.position} ${prospect.name}`] : []),
    ]
    const retentionNote = retained > 0
      ? ` ${seller.team.abbreviation} retain $${(retained / 1e6).toFixed(2)}M.`
      : ''
    return {
      sellerTeamId: seller.team.id,
      buyerTeamId: buyer.id,
      playerIds: [seller.vet.id],
      picks: chosen,
      prospectIds: prospect ? [prospect.id] : [],
      ...(retained > 0 ? { retainedAmount: retained } : {}),
      summary: `${seller.team.abbreviation} send ${seller.vet.position} ${seller.vet.name} to ${buyer.abbreviation} for ${parts.join(' and ')}.${retentionNote}`,
    }
  }
  return null
}

/**
 * A club's tradeable prospects — young players in its AHL affiliate plus the
 * juniors whose rights it holds. Healthy, no NTC, with real trade value. These
 * are what a buyer packages alongside picks in a "pick and a prospect" return.
 */
function buyerProspects(
  buyer: Team,
  teams: Map<TeamId, Team>,
  players: Map<PlayerId, Player>,
): Player[] {
  const out: Player[] = []
  const seen = new Set<string>()
  const consider = (p: Player | undefined): void => {
    if (!p || seen.has(p.id as string)) return
    if (p.age > 24 || p.position === 'G') return
    if (p.injuryStatus !== null || p.contract.noTradeClause) return
    if (playerValue(p) < MIN_SHOP_VALUE) return
    seen.add(p.id as string)
    out.push(p)
  }
  const affiliate = buyer.affiliateId ? teams.get(buyer.affiliateId) : undefined
  for (const id of affiliate?.roster ?? []) consider(players.get(id))
  // Rights-held juniors: drafted, held by the buyer, not on his NHL/AHL roster.
  const onRoster = new Set<string>([...buyer.roster, ...(affiliate?.roster ?? [])].map((id) => id as string))
  for (const p of players.values()) {
    if ((p.rightsTeamId as string | undefined) === (buyer.id as string) && !onRoster.has(p.id as string)) {
      consider(p)
    }
  }
  return out
}
