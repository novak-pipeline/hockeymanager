/**
 * Trade system (build step #6): asset valuation, AI evaluation of user
 * proposals, trade execution, and AI-initiated offers.
 *
 * Values are abstract "trade points" — only ratios between assets matter,
 * never the absolute scale. The overall→value curve is exponential so stars
 * are disproportionately expensive (one 90 costs far more than two 75s),
 * which is how real GMs price elite talent.
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
import type { DraftPick, Player, PlayerId, Position, Team, TeamId } from '@domain'
import { ratedOverall, ratedPotential } from '@engine/ratings/composites'
import type { Rng } from '@engine/shared/rng'

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Exponential overall→value curve; ~10 points at replacement level. */
const valueFromOverall = (ovr: number): number => 10 * Math.pow(1.09, ovr - 50)

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
  const ovr = ratedOverall(player)

  // U24 upside: price in a slice of the gap to potential, fading to nothing
  // by age 24 — buyers pay for projection, but never the full ceiling.
  let effective = ovr
  if (player.age < 24) {
    const potOvr = ratedPotential(player)
    const upside = Math.max(0, potOvr - ovr)
    const youth = clamp((24 - player.age) / 6, 0, 1)
    effective = ovr + upside * 0.55 * youth
  }

  let value = valueFromOverall(effective) * ageMultiplier(player.age)

  const fair = fairSalaryFor(ovr)
  const surplusRatio = (fair - player.contract.salary) / Math.max(fair, 1e6)
  const horizon = clamp(player.contract.yearsRemaining, 1, 4)
  value *= clamp(1 + surplusRatio * 0.12 * horizon, 0.55, 1.3)

  if (player.injuryStatus) {
    value *= clamp(0.95 - player.injuryStatus.gamesRemaining * 0.004, 0.8, 0.95)
  }
  if (player.morale < 50) {
    value *= 1 - ((50 - player.morale) / 50) * 0.06
  }
  return value
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
  players: Map<PlayerId, Player>
): TeamProfile {
  const counts = groupCounts(team, players, [])
  const needs: PositionGroup[] = []
  for (const g of ['F', 'D', 'G'] as const) {
    if (counts[g] < GROUP_TARGET[g]) needs.push(g)
  }
  return {
    philosophy: teamPhilosophy(team.id),
    needs,
    capSpace: team.finances.salaryCap - team.finances.capUsed,
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
}): ProposalEvaluation {
  const { give, receive, partnerTeam, partnerPlayers, rng } = args

  // Draw the mood wiggle up front so rng consumption is identical on every
  // path — repeat evaluations with the same seed must match exactly.
  const threshold = 1.03 + rng.float(-0.04, 0.04)

  const ntc = [...give.players, ...receive.players].find((p) => p.contract.noTradeClause)
  if (ntc) {
    return {
      verdict: 'reject',
      message: `${ntc.name} has a no-trade clause — that deal is a non-starter.`,
      counterAskValue: 0
    }
  }

  // Cap check: retained salary on incoming players reduces the partner's cap hit.
  const incomingSalary = sumSalary(give.players, give.retainedAmounts)
  const outgoingSalary = sumSalary(receive.players)
  const capAfter = partnerTeam.finances.capUsed + incomingSalary - outgoingSalary
  if (capAfter > partnerTeam.finances.salaryCap) {
    return {
      verdict: 'reject',
      message: `${partnerTeam.name} can't fit those contracts — the deal would put them over the salary cap.`,
      counterAskValue: 0
    }
  }

  const year = baselineYear([...give.picks, ...receive.picks])

  // Arrivals at a position the partner is thin at are worth a premium.
  const counts = groupCounts(partnerTeam, partnerPlayers, receive.players)
  const needBonus = (pos: Position): number => {
    const g = groupOf(pos)
    if (counts[g] >= GROUP_TARGET[g]) return 1
    return g === 'G' ? 1.1 : 1.07
  }

  const philosophy = teamPhilosophy(partnerTeam.id)

  // Gain = what the partner receives (the user's "give" side).
  const gain =
    give.players.reduce((s, p) => {
      const base = playerValue(p) * needBonus(p.position)
      const bias = philosophyGainBias(philosophy, { kind: 'player', player: p })
      // Cap relief bonus: if the player's salary is retained by the other side,
      // the partner benefits from reduced cap hit.
      const retained = give.retainedAmounts?.get(p.id as string) ?? 0
      const partnerCapAfterPlayer = partnerTeam.finances.capUsed + (p.contract.salary - retained) - outgoingSalary
      const relief = retentionValueBonus(retained, partnerTeam.finances.salaryCap - partnerCapAfterPlayer)
      return s + base * bias + relief
    }, 0) +
    give.picks.reduce((s, p) => {
      const pv = pickValue(p, { year })
      const bias = philosophyGainBias(philosophy, { kind: 'pick', pick: p })
      return s + pv * bias
    }, 0)

  // Loss = what the partner gives up (the user's "receive" side).
  const loss =
    receive.players.reduce((s, p) => s + playerValue(p), 0) +
    receive.picks.reduce((s, p) => s + pickValue(p, { year }), 0)

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

/** Roster ids missing from the player map contribute nothing to the cap. */
const rosterCapUsed = (team: Team, players: Map<PlayerId, Player>): number =>
  team.roster.reduce((s, id) => s + (players.get(id)?.contract.salary ?? 0), 0)

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
}): StoredTradeOffer[] {
  const { day, userTeamId, teams, players, picks, rng, nextOfferId } = args

  if (!rng.chance(1 / 8)) return []

  const user = teams.get(userTeamId)
  if (!user) return []
  const aiTeams = [...teams.values()].filter((t) => t.id !== userTeamId)
  if (aiTeams.length === 0) return []

  const partner = rng.pick(aiTeams)
  const need = weakestGroup(partner, players)

  // Target one of the user's best few players at the need group. NTC players
  // would veto the move and injured players don't get shopped for.
  const targets = user.roster
    .map((id) => players.get(id))
    .filter(
      (p): p is Player =>
        p !== undefined &&
        groupOf(p.position) === need &&
        !p.contract.noTradeClause &&
        p.injuryStatus === null
    )
    .map((player) => ({ player, value: playerValue(player) }))
    .filter((t) => t.value >= 15)
    .sort((x, y) => y.value - x.value || (x.player.id < y.player.id ? -1 : 1))
    .slice(0, 3)
  if (targets.length === 0) return []
  const target = rng.pick(targets)

  // Fair-ish aim with a slight overpay tendency — AI clubs chase their need.
  const aim = target.value * rng.float(1.0, 1.15)

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
    candidates.push({ kind: 'player', player: p, value: playerValue(p) })
  }
  for (const pick of picks) {
    if (pick.ownerTeamId !== partner.id) continue
    const rank = ranks.get(pick.originalTeamId)
    const value =
      rank === undefined
        ? pickValue(pick, { year: currentYear })
        : pickValue(pick, { year: currentYear, teamStrengthRank: rank })
    candidates.push({ kind: 'pick', pick, value })
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
