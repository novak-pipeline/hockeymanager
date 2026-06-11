/**
 * Trade system (build step #6): asset valuation, AI evaluation of user
 * proposals, trade execution, and AI-initiated offers.
 *
 * Values are abstract "trade points" — only ratios between assets matter,
 * never the absolute scale. The overall→value curve is exponential so stars
 * are disproportionately expensive (one 90 costs far more than two 75s),
 * which is how real GMs price elite talent.
 *
 * This is an engine-level module: it returns plain, JSON-serializable results
 * and the Career maps them onto the UI view models in career/views.ts. Every
 * stochastic decision flows through the injected seeded Rng — determinism is
 * a hard requirement (docs/ARCHITECTURE.md §7).
 */
import type { DraftPick, Player, PlayerId, Position, Team, TeamId } from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'
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
  const ovr = overall(player.composites, player.position)

  // U24 upside: price in a slice of the gap to potential, fading to nothing
  // by age 24 — buyers pay for projection, but never the full ceiling.
  let effective = ovr
  if (player.age < 24) {
    const potOvr = overall(
      computeComposites(player.potential, player.role, player.position),
      player.position
    )
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

/** Base value per round; round 1 is worth several round 2s. */
const ROUND_BASE = [90, 32, 15, 8, 5, 3, 2] as const

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
 */
export function pickValue(
  pick: DraftPick,
  args: { year: number; teamStrengthRank?: number }
): number {
  const base = ROUND_BASE[clamp(pick.round, 1, ROUND_BASE.length) - 1]
  const yearsOut = Math.max(0, pick.year - args.year)
  let value = base * Math.pow(FUTURE_YEAR_DISCOUNT, yearsOut)
  if (args.teamStrengthRank !== undefined) {
    const slot = clamp(0.72 + 0.034 * (args.teamStrengthRank - 1), 0.72, 1.8)
    value *= 1 + (slot - 1) / pick.round
  }
  return value
}

/* ────────────────────────── proposal evaluation ────────────────────────── */

/** One side of a trade, with assets resolved to full objects. */
export interface TradePackage {
  players: Player[]
  picks: DraftPick[]
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

type PositionGroup = 'F' | 'D' | 'G'

const groupOf = (pos: Position): PositionGroup => (pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F')

/** Healthy roster sizes a club wants per group; below these, arrivals at the group are worth extra. */
const GROUP_TARGET: Record<PositionGroup, number> = { F: 12, D: 6, G: 2 }

function groupCounts(
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

const sumSalary = (ps: Player[]): number => ps.reduce((s, p) => s + p.contract.salary, 0)

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

  const capAfter =
    partnerTeam.finances.capUsed + sumSalary(give.players) - sumSalary(receive.players)
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

  const gain =
    give.players.reduce((s, p) => s + playerValue(p) * needBonus(p.position), 0) +
    give.picks.reduce((s, p) => s + pickValue(p, { year }), 0)
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

function movePlayers(from: Team, to: Team, ids: PlayerId[]): void {
  for (const id of ids) {
    from.roster.splice(from.roster.indexOf(id), 1)
    to.roster.push(id)
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

  movePlayers(a, b, args.aGivesPlayerIds)
  movePlayers(b, a, args.bGivesPlayerIds)
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
    sums[g].total += overall(p.composites, p.position)
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
      total += overall(p.composites, p.position)
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
