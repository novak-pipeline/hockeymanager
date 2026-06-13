/**
 * Calendar tentpoles — the dramatic fixed-date events that give a season its
 * spine: trade-deadline day, draft lottery, scouting combine, and the post-
 * season national tournament (World Championship equivalent).
 *
 * Design constraints:
 *  - All state is JSON-safe: no Maps, no class instances, no functions.
 *  - All randomness flows through the injected seeded Rng; no Math.random.
 *  - Functions return news-seed objects; the caller (Career) pushes them.
 *  - RULESET-AWARE: deadline/draft/tournament existence is passed as arguments,
 *    not hardcoded, so a transfer-window mode reuses this module unchanged.
 *  - Additive field in CareerSnapshot (optional, never breaks old saves).
 */

import type { DraftPick, Player, PlayerId, Team, TeamId } from '@domain'
import { overall } from '@engine/ratings/composites'
import type { Rng } from '@engine/shared/rng'
import { executeTrade, playerValue } from './trades'

/* ────────────────────────────────────────────────────────────────── helpers */

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

/* ═══════════════════════════════════════════════════ state interfaces */

/** A player whose name is being mentioned as a potential trade target. */
export interface TradeRumor {
  playerId: string
  teamId: string
  /** 0–100; rises approaching the deadline. */
  heat: number
  sinceDay: number
}

export interface CombineRow {
  playerId: string
  /** 1–10 sprint score derived from speed/acceleration + noise. */
  sprint: number
  /** 1–10 agility score derived from agility/balance + noise. */
  agility: number
  /** 1–10 strength score. */
  strength: number
  interview: 'impressive' | 'solid' | 'concerning'
  /** True when combine pushed this player up scouts' boards. */
  riser: boolean
  /** True when combine pushed this player down scouts' boards. */
  faller: boolean
}

export interface CombineResults {
  rows: CombineRow[]
}

export type TournamentEffect = 'inspired' | 'fatigued' | 'injured'

export interface TournamentReturnEffect {
  playerId: string
  effect: TournamentEffect
}

export interface TournamentState {
  year: number
  /** Two fictional nation names. */
  teamA: string
  teamB: string
  /** 'teamA' | 'teamB' | 'draw' (unlikely but possible). */
  medalResult: 'teamA' | 'teamB' | 'draw'
  /** Player IDs selected to represent their nations. */
  selectedPlayerIds: string[]
  /** Player IDs who were borderline and missed selection. */
  snubbedPlayerIds: string[]
  returnEffects: TournamentReturnEffect[]
}

/**
 * The full tentpoles save-state. Optional field in CareerSnapshot so older
 * saves load cleanly (Career falls back to createInitialTentpolesState).
 */
export interface TentpolesState {
  rumors: TradeRumor[]
  lotteryDone: boolean
  combine: CombineResults | null
  tournament: TournamentState | null
  /**
   * Keys of one-shot news events already emitted this season (e.g.
   * "deadline-recap-2026", "lottery-2026"). Prevents duplicate headlines.
   */
  emittedKeys: string[]
}

/* ───────────────────────────────── news seed shape (returned to caller) */

export interface NewsSeed {
  category: 'trade' | 'draft' | 'league' | 'injury' | 'award' | 'milestone'
  headline: string
  body: string
  playerId?: string
  teamId?: string
}

/** Arc seed returned alongside news so the story layer can pick it up. */
export interface ArcSeed {
  kind: 'tradeRumor'
  playerIds: string[]
  teamIds: string[]
  summary: string
}

/* ═══════════════════════════════════════════════════ initial state */

export function createInitialTentpolesState(): TentpolesState {
  return {
    rumors: [],
    lotteryDone: false,
    combine: null,
    tournament: null,
    emittedKeys: []
  }
}

/* ═══════════════════════════════════════════════════ trade rumor engine */

/**
 * Team strength rank (1 = weakest) computed from mean roster overall.
 * Sellers are bottom-half clubs; contenders are top-quarter clubs.
 */
function teamStrengths(
  teams: Map<TeamId, Team>,
  players: Map<PlayerId, Player>
): Map<string, number> {
  const means: Array<[string, number]> = []
  for (const t of teams.values()) {
    let total = 0, n = 0
    for (const id of t.roster) {
      const p = players.get(id)
      if (p) { total += overall(p.composites, p.position); n++ }
    }
    means.push([t.id as string, n === 0 ? 0 : total / n])
  }
  // Sort ascending so index 0 = weakest
  means.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
  return new Map(means.map(([id], i) => [id, i + 1]))
}

const RUMOR_SPAWN_CHANCE = 0.12  // per seller player per tick

export interface TickRumorsArgs {
  state: TentpolesState
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  userTeamId: string
  deadlineDay: number
  day: number
  year: number
  rng: Rng
}

export interface TickRumorsResult {
  newsSeeds: NewsSeed[]
  arcSeeds: ArcSeed[]
}

/**
 * Advance trade rumors one match day.
 *
 * New rumors spawn for:
 *  - Stars (overall >= 75) on bottom-third teams (sellers)
 *  - Players with expiring contracts (yearsRemaining === 1) who are aged ≥ 28
 *  - Unhappy players (morale < 35)
 *
 * Heat rises by (daysToDeadline < 20 ? 8 : 3) per tick, clamped to 100.
 * A player with heat > 60 takes a small morale hit (-2), representing
 * distraction from trade talk.
 *
 * Rumors expire when the deadline passes (day > deadlineDay).
 */
export function tickRumors(args: TickRumorsArgs): TickRumorsResult {
  const { state, teams, players, userTeamId, deadlineDay, day, year, rng } = args
  const newsSeeds: NewsSeed[] = []
  const arcSeeds: ArcSeed[] = []

  // Past the deadline: purge all rumors
  if (day > deadlineDay) {
    state.rumors = []
    return { newsSeeds, arcSeeds }
  }

  const strengths = teamStrengths(teams, players)
  const totalTeams = teams.size
  const sellerThreshold = Math.ceil(totalTeams / 3)   // bottom third are sellers
  const daysToDeadline = Math.max(0, deadlineDay - day)
  const heatRise = daysToDeadline < 20 ? 8 : 3

  // Existing rumor ids
  const rumorSet = new Set(state.rumors.map((r) => r.playerId))

  // Cap how many NEW rumor stories hit the inbox per tick, and only surface
  // genuinely notable ones, so the feed isn't flooded with dozens of identical
  // "expiring deal" items about depth players. Rumor STATE still tracks them all.
  const MAX_RUMOR_NEWS_PER_TICK = 3
  let rumorNewsEmitted = 0

  // ── spawn new rumors ────────────────────────────────────────────────────
  for (const team of teams.values()) {
    const teamId = team.id as string
    if (teamId === userTeamId) continue
    const rank = strengths.get(teamId) ?? totalTeams
    const isSeller = rank <= sellerThreshold

    for (const pid of team.roster) {
      const p = players.get(pid)
      if (!p || rumorSet.has(pid as string)) continue

      const ovr = overall(p.composites, p.position)
      const isStar = ovr >= 75
      const isExpiring = p.contract.yearsRemaining === 1 && p.age >= 28
      const isUnhappy = p.morale < 35
      const eligible = (isSeller && isStar) || isExpiring || isUnhappy

      if (!eligible) continue
      if (!rng.chance(RUMOR_SPAWN_CHANCE)) continue

      const rumor: TradeRumor = {
        playerId: pid as string,
        teamId,
        heat: rng.range(15, 35),
        sinceDay: day
      }
      state.rumors.push(rumor)
      rumorSet.add(pid as string)

      const headline = isUnhappy
        ? `${p.name} unhappy at ${team.name}, asking for a trade`
        : isExpiring
          ? `Expiring deal adds intrigue: ${p.name} may not be back at ${team.name}`
          : `${team.name} open to offers for ${p.name}`
      const body = `Sources indicate ${team.name} would listen to offers for ${p.name}${isSeller ? ', a team likely to sell before the deadline' : ''}. Interest is described as early-stage.`

      // Only the notable rumors reach the inbox, and only a few per day.
      const newsworthy = isUnhappy || ovr >= 78
      if (newsworthy && rumorNewsEmitted < MAX_RUMOR_NEWS_PER_TICK) {
        rumorNewsEmitted++
        newsSeeds.push({
          category: 'trade',
          headline,
          body,
          playerId: pid as string,
          teamId
        })
      }

      arcSeeds.push({
        kind: 'tradeRumor',
        playerIds: [pid as string],
        teamIds: [teamId],
        summary: `${p.name} linked to move from ${team.name}`
      })
    }
  }

  // ── advance heat + morale effects ──────────────────────────────────────
  const stale: string[] = []
  for (const rumor of state.rumors) {
    rumor.heat = clamp(rumor.heat + heatRise, 0, 100)

    const p = players.get(rumor.playerId as PlayerId)
    if (p && rumor.heat > 60) {
      p.morale = clamp(p.morale - 2, 0, 100)
    }

    // Escalate to deadline rumor news once heat crosses 70
    const hotKey = `rumor-hot-${rumor.playerId}-${year}`
    if (rumor.heat >= 70 && !state.emittedKeys.includes(hotKey)) {
      state.emittedKeys.push(hotKey)
      const team = teams.get(rumor.teamId as TeamId)
      if (p && team) {
        newsSeeds.push({
          category: 'trade',
          headline: `Trade talk heats up: ${p.name} close to leaving ${team.name}?`,
          body: `With the deadline approaching, chatter around ${p.name} is intensifying. Multiple teams are believed to be in contact with ${team.name}.`,
          playerId: rumor.playerId,
          teamId: rumor.teamId
        })
      }
    }

    // Remove stale rumors for players who are no longer on the team
    const team = teams.get(rumor.teamId as TeamId)
    if (!team || !team.roster.includes(rumor.playerId as PlayerId)) {
      stale.push(rumor.playerId)
    }
  }
  state.rumors = state.rumors.filter((r) => !stale.includes(r.playerId))

  return { newsSeeds, arcSeeds }
}

/* ═══════════════════════════════════════════════════ deadline day */

export interface ExecutedTradeSummary {
  teamA: string
  teamB: string
  /** Names of what team A gave away. */
  aGave: string[]
  /** Names of what team B gave away. */
  bGave: string[]
}

export interface DeadlineDayArgs {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  picks: DraftPick[]
  userTeamId: string
  year: number
  rng: Rng
}

export interface DeadlineDayResult {
  trades: ExecutedTradeSummary[]
  newsSeeds: NewsSeed[]
}

/** Grade a team's trade result given value delta. */
function tradeGrade(valueDelta: number, baseValue: number): string {
  if (baseValue <= 0) return 'C'
  const pct = valueDelta / baseValue
  if (pct >= 0.12) return 'A'
  if (pct >= 0.04) return 'B'
  if (pct >= -0.04) return 'C'
  if (pct >= -0.12) return 'D'
  return 'F'
}

/**
 * Simulate a flurry of AI-to-AI deadline trades.
 *
 * Strategy:
 *  - 2–5 trades execute.
 *  - Each trade matches a seller (bottom-third by strength) to a contender
 *    (top-quarter by strength).
 *  - Sellers move their most-rumored (or highest-value expiring) star to a
 *    contender in exchange for picks and prospects.
 *  - Value parity is enforced within ±15% of the departing player's value.
 *  - No-trade-clause players are excluded.
 *  - The user's team participates only as a bystander (this is AI-to-AI).
 */
export function runDeadlineDay(args: DeadlineDayArgs): DeadlineDayResult {
  const { teams, players, picks, userTeamId, year, rng } = args
  const newsSeeds: NewsSeed[] = []
  const trades: ExecutedTradeSummary[] = []

  const strengths = teamStrengths(teams, players)
  const totalTeams = teams.size
  const sellerThreshold = Math.ceil(totalTeams / 3)
  const contenderThreshold = Math.floor(totalTeams * 0.75) // top-quarter

  const sellerIds = [...teams.keys()]
    .map((id) => id as string)
    .filter((id) => id !== userTeamId && (strengths.get(id) ?? 0) <= sellerThreshold)
  const contenderIds = [...teams.keys()]
    .map((id) => id as string)
    .filter((id) => id !== userTeamId && (strengths.get(id) ?? 0) > contenderThreshold)

  if (sellerIds.length === 0 || contenderIds.length === 0) {
    newsSeeds.push({
      category: 'trade',
      headline: 'Quiet deadline day across the league',
      body: 'Despite the hype, the trade deadline passed without major moves.'
    })
    return { trades, newsSeeds }
  }

  const tradeCount = rng.range(2, 5)
  const usedSellers = new Set<string>()
  const usedContenders = new Set<string>()
  const usedPlayerIds = new Set<string>()

  for (let attempt = 0; attempt < tradeCount * 3 && trades.length < tradeCount; attempt++) {
    const availSellers = sellerIds.filter((id) => !usedSellers.has(id))
    const availContenders = contenderIds.filter((id) => !usedContenders.has(id))
    if (availSellers.length === 0 || availContenders.length === 0) break

    const sellerId = rng.pick(availSellers)
    const contenderId = rng.pick(availContenders)
    const seller = teams.get(sellerId as TeamId)
    const contender = teams.get(contenderId as TeamId)
    if (!seller || !contender) continue

    // Find the seller's best tradeable player (no NTC, not injured, not used)
    const tradeable = seller.roster
      .map((id) => players.get(id))
      .filter((p): p is Player =>
        p !== undefined &&
        !p.contract.noTradeClause &&
        p.injuryStatus === null &&
        !usedPlayerIds.has(p.id as string)
      )
      .map((p) => ({ p, v: playerValue(p) }))
      .sort((a, b) => b.v - a.v || (a.p.id < b.p.id ? -1 : 1))

    if (tradeable.length === 0) continue
    const target = tradeable[0]!
    const targetValue = target.v

    // Build return package from contender: picks + younger players within ±15%
    const aim = targetValue
    const lo = aim * 0.85
    const hi = aim * 1.15

    // Candidate players from contender (no NTC, no injury, not the returning player)
    const contenderPlayers = contender.roster
      .map((id) => players.get(id))
      .filter((p): p is Player =>
        p !== undefined &&
        !p.contract.noTradeClause &&
        p.injuryStatus === null &&
        !usedPlayerIds.has(p.id as string) &&
        p.age <= 26  // contenders prefer to give prospects, not stars
      )
      .map((p) => ({ p, v: playerValue(p) }))
      .sort((a, b) => b.v - a.v || (a.p.id < b.p.id ? -1 : 1))

    // Candidate picks from contender
    const contenderPicks = picks
      .filter((pk) => pk.ownerTeamId === (contenderId as TeamId))
      .map((pk) => {
        const rank = strengths.get(pk.originalTeamId as string) ?? totalTeams
        // Simple pick value estimate: R1 ≈ 90, R2 ≈ 32, R3+ lower
        const base = pk.round === 1 ? 90 : pk.round === 2 ? 32 : 15
        const slotBonus = 1 + (rank <= sellerThreshold ? 0.2 : 0)
        return { pk, v: base * slotBonus }
      })
      .sort((a, b) => b.v - a.v)

    // Greedy fill
    const chosenPlayers: Player[] = []
    const chosenPicks: DraftPick[] = []
    let total = 0

    for (const cp of contenderPicks) {
      if (total >= lo) break
      if (total + cp.v <= hi * 1.05) {
        chosenPicks.push(cp.pk)
        total += cp.v
      }
    }

    if (total < lo) {
      for (const cp of contenderPlayers) {
        if (total >= lo) break
        if (total + cp.v <= hi * 1.1) {
          chosenPlayers.push(cp.p)
          total += cp.v
        }
      }
    }

    if (total < lo || total > hi * 1.2) continue

    // Check cap fit for contender receiving high-salary star
    const inSalary = target.p.contract.salary
    const outSalary = chosenPlayers.reduce((s, p) => s + p.contract.salary, 0)
    const contenderCapAfter = contender.finances.capUsed + inSalary - outSalary
    if (contenderCapAfter > contender.finances.salaryCap) continue

    // Execute
    try {
      executeTrade({
        teams,
        players,
        teamA: sellerId as TeamId,
        teamB: contenderId as TeamId,
        aGivesPlayerIds: [target.p.id],
        aGivesPicks: [],
        bGivesPlayerIds: chosenPlayers.map((p) => p.id),
        bGivesPicks: chosenPicks,
        allPicks: picks
      })
    } catch {
      // Validation failed (e.g. race condition); skip this trade
      continue
    }

    // Mark used
    usedSellers.add(sellerId)
    usedContenders.add(contenderId)
    usedPlayerIds.add(target.p.id as string)
    for (const p of chosenPlayers) usedPlayerIds.add(p.id as string)

    const summary: ExecutedTradeSummary = {
      teamA: seller.name,
      teamB: contender.name,
      aGave: [target.p.name],
      bGave: [
        ...chosenPlayers.map((p) => p.name),
        ...chosenPicks.map((pk) => `${pk.year} R${pk.round} pick`)
      ]
    }
    trades.push(summary)

    // Grade teams
    const sellerGrade = tradeGrade(total - targetValue, targetValue)
    const contenderGrade = tradeGrade(targetValue - total, total)

    const detailLines = summary.bGave.length === 0
      ? `${contender.name} get ${target.p.name} for nothing.`
      : `${seller.name} receive ${summary.bGave.join(', ')} in return.`

    newsSeeds.push({
      category: 'trade',
      headline: `TRADE: ${target.p.name} dealt from ${seller.name} to ${contender.name}`,
      body: `${contender.name} bolster their roster ahead of the playoffs. ${detailLines} Trade grades: ${seller.name} ${sellerGrade}, ${contender.name} ${contenderGrade}.`,
      playerId: target.p.id as string,
      teamId: contenderId
    })
  }

  // Day-recap with grades
  if (trades.length > 0) {
    const teamMentions = [...new Set(trades.flatMap((t) => [t.teamA, t.teamB]))]
    newsSeeds.push({
      category: 'trade',
      headline: `Deadline day recap: ${trades.length} trade${trades.length > 1 ? 's' : ''} reshuffled the league`,
      body: `Teams involved: ${teamMentions.join(', ')}. Full analysis in today's inbox.`
    })
  } else {
    newsSeeds.push({
      category: 'trade',
      headline: 'Quiet deadline day across the league',
      body: 'Despite pre-deadline speculation, no major trades were completed.'
    })
  }

  return { trades, newsSeeds }
}

/* ═══════════════════════════════════════════════════ draft lottery */

export interface RunLotteryArgs {
  /** Team IDs sorted worst to best (index 0 = worst record). */
  nonPlayoffTeamIds: TeamId[]
  rng: Rng
  year: number
}

export interface RunLotteryResult {
  /** Full draft order (first-pick team at index 0). */
  order: TeamId[]
  /** Drama: a team jumped up from their expected slot. */
  movedUp: { teamId: TeamId; from: number; to: number } | null
  newsSeeds: NewsSeed[]
}

/**
 * Weighted draft lottery.
 *
 * Odds (worst = most balls):
 *   1st  → 25%
 *   2nd  → 19.5%
 *   3rd  → 15.6%
 *   4th  → 11.5%
 *   5th  → 8.5%
 *   6th  → 6.2%
 *   7th  → 4.5%
 *   8th  → 3.2%
 *   9th+ → remaining probability distributed equally
 *
 * Only the bottom-8 teams are eligible to win the first overall pick. The rest
 * follow in inverse-standings order. Drama news fires when a team jumps more
 * than 3 spots.
 */
export function runLottery(args: RunLotteryArgs): RunLotteryResult {
  const { nonPlayoffTeamIds, rng, year } = args
  const newsSeeds: NewsSeed[] = []

  if (nonPlayoffTeamIds.length === 0) {
    return { order: [], movedUp: null, newsSeeds }
  }

  // Lottery odds for the top-8 eligible teams (worst first).
  const TOP_ODDS = [25.0, 19.5, 15.6, 11.5, 8.5, 6.2, 4.5, 3.2]
  const lotteryPool = nonPlayoffTeamIds.slice(0, 8)
  const restTeams = nonPlayoffTeamIds.slice(8) // already in order

  // Build weighted table
  const weights: number[] = []
  let totalWeight = 0
  for (let i = 0; i < lotteryPool.length; i++) {
    const w = TOP_ODDS[i] ?? (100 - TOP_ODDS.slice(0, i).reduce((a, b) => a + b, 0)) / Math.max(1, lotteryPool.length - 8)
    weights.push(w)
    totalWeight += w
  }

  // Draw the first-pick winner
  let roll = rng.float(0, totalWeight)
  let winner = lotteryPool[0]!
  let winnerIndex = 0
  for (let i = 0; i < lotteryPool.length; i++) {
    roll -= weights[i]!
    if (roll <= 0) {
      winner = lotteryPool[i]!
      winnerIndex = i
      break
    }
  }

  // Build final order: winner first, then remaining lottery teams in original
  // order, then the rest (already sorted worst-to-best regular season)
  const remaining = [
    ...lotteryPool.filter((id) => id !== winner),
    ...restTeams
  ]
  const order: TeamId[] = [winner, ...remaining]

  // Drama: did the winner jump significantly?
  let movedUp: RunLotteryResult['movedUp'] = null
  if (winnerIndex >= 3) {
    movedUp = { teamId: winner, from: winnerIndex + 1, to: 1 }
    newsSeeds.push({
      category: 'draft',
      headline: `Lottery drama! ${winner} jump to first overall after ${winnerIndex + 1}th-worst record`,
      body: `Against the odds, ${winner} landed the top pick in the ${year} draft lottery, leaping from ${ordinal(winnerIndex + 1)} position in the draw. The highest-rated prospect will head there instead of the expected destination.`,
      teamId: winner as string
    })
  } else {
    newsSeeds.push({
      category: 'draft',
      headline: `${year} draft lottery: ${winner} earn the first overall pick`,
      body: `${winner} won the lottery and will pick first in the ${year} draft. The full order is now set.`,
      teamId: winner as string
    })
  }

  return { order, movedUp, newsSeeds }
}

/* ═══════════════════════════════════════════════════ scouting combine */

export interface CombineProspect {
  playerId: string
  name: string
  position: string
  rank: number
}

export interface RunCombineArgs {
  prospects: CombineProspect[]
  players: Map<PlayerId, Player>
  rng: Rng
  year: number
}

export interface RunCombineResult {
  combine: CombineResults
  newsSeeds: NewsSeed[]
  /** [playerId, +10..+20] boosts passed back to the scouting system. */
  knowledgeBoosts: Array<[string, number]>
}

/**
 * Sim the pre-draft scouting combine.
 *
 * Tests are derived from true attributes + gaussian noise, normalized to 1–10.
 * 2–3 players become risers (combine outperformed expectations) or fallers.
 */
export function runCombine(args: RunCombineArgs): RunCombineResult {
  const { prospects, players, rng, year } = args
  const newsSeeds: NewsSeed[] = []
  const knowledgeBoosts: Array<[string, number]> = []

  if (prospects.length === 0) {
    return { combine: { rows: [] }, newsSeeds, knowledgeBoosts }
  }

  // Derive a 1–10 physical test score from two player attributes + noise
  const testScore = (v1: number, v2: number): number => {
    const base = (v1 + v2) / 2  // 0–100
    const noise = rng.normal(0, 6)
    return clamp(Math.round((base + noise) / 10), 1, 10)
  }

  // Interview result thresholds: personality professionalism + composure
  const interviewResult = (p: Player): CombineRow['interview'] => {
    const score = (p.personality.professionalism + p.ratings.mental.composure) / 2
    const roll = rng.normal(score, 10)
    if (roll >= 72) return 'impressive'
    if (roll >= 42) return 'solid'
    return 'concerning'
  }

  // Build rows
  const rows: CombineRow[] = []
  for (const prospect of prospects) {
    const p = players.get(prospect.playerId as PlayerId)
    if (!p) {
      rows.push({
        playerId: prospect.playerId,
        sprint: rng.range(4, 7),
        agility: rng.range(4, 7),
        strength: rng.range(4, 7),
        interview: 'solid',
        riser: false,
        faller: false
      })
      continue
    }
    rows.push({
      playerId: prospect.playerId,
      sprint: testScore(p.ratings.physical.speed, p.ratings.physical.acceleration),
      agility: testScore(p.ratings.physical.agility, p.ratings.physical.balance),
      strength: testScore(p.ratings.physical.strength, p.ratings.physical.stamina),
      interview: interviewResult(p),
      riser: false,
      faller: false
    })
  }

  // Sort rows by composite score descending to identify risers/fallers vs. rank
  const scoredRows = rows.map((row) => ({
    row,
    prospect: prospects.find((pr) => pr.playerId === row.playerId)!,
    combineScore: row.sprint + row.agility + row.strength
  }))
  // Order by combine score
  const byScore = [...scoredRows].sort((a, b) => b.combineScore - a.combineScore)

  // Assign riser/faller labels: players who moved significantly vs. their rank
  let risersLeft = rng.range(2, 3)
  let fallersLeft = rng.range(2, 3)
  const riserPlayerIds: string[] = []
  const fallerPlayerIds: string[] = []

  for (const { row, prospect, combineScore } of byScore) {
    if (!prospect) continue
    // Combine rank vs. pre-combine scouting rank
    const combineRank = byScore.findIndex((s) => s.row.playerId === row.playerId) + 1
    const delta = prospect.rank - combineRank  // positive = riser (better than expected)

    if (delta >= 3 && risersLeft > 0 && !row.riser) {
      row.riser = true
      risersLeft--
      riserPlayerIds.push(prospect.playerId)
    } else if (delta <= -3 && fallersLeft > 0 && !row.faller) {
      row.faller = true
      fallersLeft--
      fallerPlayerIds.push(prospect.playerId)
    }
    void combineScore // unused beyond sort
  }

  // Knowledge boosts for all combine attendees
  for (const row of rows) {
    const boost = rng.range(10, 20)
    knowledgeBoosts.push([row.playerId, boost])
  }

  // News seeds
  newsSeeds.push({
    category: 'draft',
    headline: `${year} Scouting Combine underway — ${prospects.length} prospects tested`,
    body: `Scouts gathered to put the top ${year} draft prospects through their paces. Sprint, agility, strength, and interview sessions complete.`
  })

  for (const pid of riserPlayerIds) {
    const pr = prospects.find((p) => p.playerId === pid)
    const row = rows.find((r) => r.playerId === pid)
    if (pr && row) {
      newsSeeds.push({
        category: 'draft',
        headline: `Combine riser: ${pr.name} impresses scouts with elite testing`,
        body: `${pr.name} (ranked #${pr.rank}) posted a sprint of ${row.sprint}/10 and agility of ${row.agility}/10, drawing interest from multiple teams ahead of the draft.`,
        playerId: pid
      })
    }
  }

  for (const pid of fallerPlayerIds) {
    const pr = prospects.find((p) => p.playerId === pid)
    const row = rows.find((r) => r.playerId === pid)
    if (pr && row) {
      const concern = row.interview === 'concerning' ? ' An interview that left questions unanswered only adds to the uncertainty.' : ''
      newsSeeds.push({
        category: 'draft',
        headline: `Combine concern: ${pr.name} raises questions ahead of draft`,
        body: `${pr.name} (ranked #${pr.rank}) had a disappointing combine, with scouts noting subpar physical testing.${concern}`,
        playerId: pid
      })
    }
  }

  return { combine: { rows }, newsSeeds, knowledgeBoosts }
}

/* ═══════════════════════════════════════════════════ national tournament */

/** Two fictional national teams for the Worlds tournament. */
const FICTIONAL_NATIONS: Array<[string, string]> = [
  ['Valoria', 'Normark'],
  ['Stenhavn', 'Krakozia'],
  ['Ironfjord', 'Solmark'],
  ['Westheim', 'Ostmark'],
  ['Brynholt', 'Skalsvik']
]

export interface TournamentEligiblePlayer {
  player: Player
  teamId: TeamId
}

export interface RunTournamentArgs {
  eligible: TournamentEligiblePlayer[]
  userTeamId: string
  rng: Rng
  year: number
}

export interface RunTournamentResult {
  tournament: TournamentState
  newsSeeds: NewsSeed[]
}

/**
 * Simulate the post-season World Championship for non-playoff (or eliminated) players.
 *
 * - Selects ~25 players for each of two fictional national squads based on overall rating.
 * - Borderline user players are flagged as snubs if they just missed the cut.
 * - Simulates a brief tournament result from aggregate squad strength.
 * - Applies return effects: inspired / fatigued / injured to participants.
 */
export function runTournament(args: RunTournamentArgs): RunTournamentResult {
  const { eligible, userTeamId, rng, year } = args
  const newsSeeds: NewsSeed[] = []

  const nationsIndex = rng.int(FICTIONAL_NATIONS.length)
  const [teamAName, teamBName] = FICTIONAL_NATIONS[nationsIndex]!

  const SQUAD_SIZE = 23

  // Sort eligible by overall descending to form a selection pool
  const sorted = [...eligible].sort((a, b) => {
    const ovA = overall(a.player.composites, a.player.position)
    const ovB = overall(b.player.composites, b.player.position)
    return ovB - ovA || (a.player.id < b.player.id ? -1 : 1)
  })

  const maxSelectable = SQUAD_SIZE * 2
  const selectionPool = sorted.slice(0, maxSelectable)
  const snubPool = sorted.slice(maxSelectable, maxSelectable + 6) // borderline snubs

  // Assign alternately to each squad (best player to A, second to B, etc.)
  const squadA: Player[] = []
  const squadB: Player[] = []
  for (let i = 0; i < selectionPool.length; i++) {
    const ep = selectionPool[i]!
    if (i % 2 === 0) squadA.push(ep.player)
    else squadB.push(ep.player)
  }

  const selectedPlayerIds = selectionPool.map((ep) => ep.player.id as string)
  const snubbedPlayerIds = snubPool.map((ep) => ep.player.id as string)

  // User players in the tournament
  const userSelectees = selectionPool.filter((ep) => ep.teamId === (userTeamId as TeamId))
  const userSnubs = snubPool.filter((ep) => ep.teamId === (userTeamId as TeamId))

  // News: user player selections
  for (const ep of userSelectees) {
    newsSeeds.push({
      category: 'award',
      headline: `${ep.player.name} selected for ${year} World Championship`,
      body: `${ep.player.name} will represent their nation at the World Championship. The selection is recognition of a strong season.`,
      playerId: ep.player.id as string,
      teamId: userTeamId
    })
  }

  // News: user player snubs (if any)
  for (const ep of userSnubs) {
    const ovr = overall(ep.player.composites, ep.player.position)
    newsSeeds.push({
      category: 'league',
      headline: `${ep.player.name} misses World Championship selection — a snub?`,
      body: `Despite a ${ovr >= 75 ? 'strong' : 'respectable'} season, ${ep.player.name} was not named to their national squad. Coaches cited depth at the position.`,
      playerId: ep.player.id as string,
      teamId: userTeamId
    })
  }

  // Sim the medal result: aggregate strength determines probability
  const strengthA = squadA.reduce(
    (s, p) => s + overall(p.composites, p.position),
    0
  ) / Math.max(1, squadA.length)
  const strengthB = squadB.reduce(
    (s, p) => s + overall(p.composites, p.position),
    0
  ) / Math.max(1, squadB.length)

  const total = strengthA + strengthB
  const pA = total > 0 ? strengthA / total : 0.5
  const roll = rng.next()
  let medalResult: TournamentState['medalResult']
  let winner: string
  if (Math.abs(pA - 0.5) < 0.01 && rng.chance(0.04)) {
    medalResult = 'draw'
    winner = 'Neither team'
  } else if (roll < pA) {
    medalResult = 'teamA'
    winner = teamAName
  } else {
    medalResult = 'teamB'
    winner = teamBName
  }

  // News: final
  const loser = winner === teamAName ? teamBName : winner === teamBName ? teamAName : 'both nations'
  newsSeeds.push({
    category: 'league',
    headline: medalResult === 'draw'
      ? `${teamAName} and ${teamBName} share gold in dramatic final`
      : `${winner} claim gold at the ${year} World Championship`,
    body: medalResult === 'draw'
      ? `An extraordinary final between ${teamAName} and ${teamBName} ended level after extra time. Both nations share the honor.`
      : `${winner} defeated ${loser} to be crowned champions. Several players from the league had strong tournament showings.`
  })

  // Return effects for participants
  const returnEffects: TournamentReturnEffect[] = []
  for (const ep of selectionPool) {
    const p = ep.player

    // Gold-medal squad members get an inspiration bonus with higher probability
    const inWinningSquad = (medalResult === 'teamA' && squadA.includes(p)) ||
                            (medalResult === 'teamB' && squadB.includes(p))
    const inspireChance = inWinningSquad ? 0.55 : 0.25
    const fatigueChance = 0.35
    const injureChance = 0.06  // worlds is physical — 6% per participant

    const roll2 = rng.next()
    let effect: TournamentEffect
    if (roll2 < injureChance) {
      effect = 'injured'
    } else if (roll2 < injureChance + fatigueChance) {
      effect = 'fatigued'
    } else if (roll2 < injureChance + fatigueChance + inspireChance) {
      effect = 'inspired'
    } else {
      // No effect: skip adding to returnEffects
      continue
    }

    returnEffects.push({ playerId: p.id as string, effect })

    // Apply effects to the player objects directly
    if (effect === 'inspired') {
      p.morale = clamp(p.morale + rng.range(5, 12), 0, 100)
      p.form = clamp(p.form + rng.range(2, 4), -10, 10)
    } else if (effect === 'fatigued') {
      p.fatigue = clamp(p.fatigue + rng.range(10, 20), 0, 100)
    } else {
      // injured
      const games = rng.range(2, 5)
      p.injuryStatus = {
        kind: 'lowerBody',
        gamesRemaining: games,
        description: 'tweaked groin (Worlds)'
      }
      newsSeeds.push({
        category: 'injury',
        headline: `${p.name} returns from Worlds with a tweaked groin`,
        body: `${p.name} picked up a lower-body injury at the World Championship. The team expects him to miss approximately ${games} games.`,
        playerId: p.id as string
      })
    }
  }

  const tournament: TournamentState = {
    year,
    teamA: teamAName,
    teamB: teamBName,
    medalResult,
    selectedPlayerIds,
    snubbedPlayerIds,
    returnEffects
  }

  return { tournament, newsSeeds }
}

/* ═══════════════════════════════════════════════════ small utilities */

function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}
