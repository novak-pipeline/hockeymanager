/**
 * Salary cap, contract negotiation, and free agency.
 *
 * Money is plain dollars (3_500_000); formatting is a UI concern. The ask-price
 * model mirrors the league-generation salary curve in src/data/generate.ts
 * (base = 0.7 + ((ovr-45)/45)^2.2 * 11 in millions) so market asks and
 * generated contracts live on the same scale, with premiums layered on top
 * (prime-age 24–28, 90+ star tax) and a discount for 33+ veterans.
 *
 * Offseason bookkeeping contract (must hold for the resign/FA stages to work):
 * - The career layer decrements every contract's `yearsRemaining` once at
 *   season rollover, BEFORE the offseason stages run. None of the functions
 *   here decrement.
 * - During the 'resign' stage, expiring players (`yearsRemaining <= 0`) are
 *   still rostered and still count against the cap at their old salary;
 *   `aiResignDay` re-signs AI keepers in place.
 * - At the resign → freeAgency transition the career layer calls
 *   `processExpiries`, which removes the remaining `yearsRemaining <= 0`
 *   players from rosters; its return value seeds the FA pool.
 * - `aiFreeAgencyDay` is then called once per FA day. Free agents decide on
 *   day `1 + floor(rank / 3)` where rank is their position in the pool sorted
 *   by overall (best = 0) — better players sign earlier. The career layer can
 *   mirror that formula for FreeAgentRowView.decidesInDays.
 *
 * Determinism: every stochastic decision flows through the caller's seeded
 * Rng; `askTerms` derives its own Rng from (playerId, year) so the same player
 * asks the same terms all offseason without threading an Rng through the UI.
 */
import type { DraftPick, Player, PlayerId, Team, TeamId } from '@domain'
import { overall } from '@engine/ratings/composites'
import { deriveSeed, Rng } from '@engine/shared/rng'

/** Cheapest legal contract; asks never fall below this. */
const LEAGUE_MIN_SALARY = 750_000
/** Contracts below this are two-way deals (minor-league assignable). */
const TWO_WAY_THRESHOLD = 1_100_000
/** Hard roster ceiling enforced by signPlayer. */
const MAX_ROSTER_SIZE = 26

type PositionGroup = 'F' | 'D' | 'G'

/** Healthy roster shape AI clubs aim for in free agency. */
const ROSTER_TARGETS: Record<PositionGroup, number> = { F: 14, D: 7, G: 2 }
/** Below these an AI club re-signs an expiring player regardless of quality. */
const ROSTER_MINIMUMS: Record<PositionGroup, number> = { F: 12, D: 6, G: 2 }
/** AI clubs re-sign expiring players at or above this overall. */
const KEEPER_OVERALL = 55
/** How many free agents come off the board per FA day (rank / this = day). */
const FA_DECISIONS_PER_DAY = 3

const groupOf = (p: Player): PositionGroup =>
  p.position === 'G' ? 'G' : p.position === 'D' ? 'D' : 'F'

const playerOverall = (p: Player): number => overall(p.composites, p.position)

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Best first; id tiebreak keeps ordering stable across runs. */
const byOverallDesc = (a: Player, b: Player): number =>
  playerOverall(b) - playerOverall(a) || byId(a, b)

/** FNV-1a so a string id can seed a deterministic per-player Rng. */
function hashId(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const roundTo25k = (salary: number): number => Math.round(salary / 25_000) * 25_000

/** Sum of rostered salaries; the live truth `finances.capUsed` caches. */
export function capUsedFor(team: Team, players: Map<PlayerId, Player>): number {
  let sum = 0
  for (const id of team.roster) {
    const p = players.get(id)
    if (p) sum += p.contract.salary
  }
  return sum
}

/** Remaining cap room, computed from the live roster (not the cached value). */
export function capSpace(team: Team, players: Map<PlayerId, Player>): number {
  return team.finances.salaryCap - capUsedFor(team, players)
}

/** Contract length demand: young stars want term, old veterans take short deals. */
function askYears(age: number, ovr: number, rng: Rng): number {
  let base: number
  if (age <= 24) base = ovr >= 80 ? 7 : ovr >= 68 ? 5 : 3
  else if (age <= 28) base = ovr >= 85 ? 7 : ovr >= 72 ? 5 : 3
  else if (age <= 32) base = ovr >= 80 ? 4 : 2
  else base = ovr >= 85 ? 2 : 1
  const years = base + rng.range(-1, 1)
  return Math.min(7, Math.max(1, years))
}

/**
 * Market asking terms. Deterministic per (player, year): the same player asks
 * the same terms every time they're queried in a given offseason.
 */
export function askTerms(player: Player, year: number): { salary: number; years: number } {
  const ovr = playerOverall(player)
  const rng = new Rng(deriveSeed(hashId(player.id), year))

  // Same shape as the generation curve, in millions.
  let m = 0.7 + Math.pow(Math.max(0, ovr - 45) / 45, 2.2) * 11
  if (player.age >= 24 && player.age <= 28) m *= 1.1 // prime years premium
  if (player.age >= 33) m *= Math.max(0.6, 1 - 0.07 * (player.age - 32)) // veteran discount
  if (ovr >= 90) m *= 1.15 // star tax
  m *= rng.float(0.96, 1.04)

  const salary = Math.max(LEAGUE_MIN_SALARY, roundTo25k(m * 1e6))
  const years = askYears(player.age, ovr, rng)
  return { salary, years }
}

/**
 * Does the player take the offer? Offer value is measured against the ask —
 * salary weighted 75%, term 25%, each ratio capped so overpaying one dimension
 * can't fully buy out a lowball on the other. The acceptance threshold sits
 * near 95% of ask, nudged by personality (ambitious players hold out, loyal
 * players settle) plus a small rng wiggle, clamped so a full-ask offer always
 * lands and an 85%-value offer never does.
 */
export function offerAcceptable(
  player: Player,
  offer: { salary: number; years: number },
  ask: { salary: number; years: number },
  rng: Rng
): boolean {
  const ratio = (offered: number, asked: number): number =>
    asked <= 0 ? 1 : Math.min(1.4, offered / asked)
  const value = 0.75 * ratio(offer.salary, ask.salary) + 0.25 * ratio(offer.years, ask.years)

  let threshold =
    0.95 +
    (player.personality.ambition - 10.5) * 0.003 -
    (player.personality.loyalty - 10.5) * 0.003 +
    rng.float(-0.02, 0.02)
  threshold = Math.min(0.995, Math.max(0.88, threshold))

  return value >= threshold
}

/**
 * Commit a signing: sets the contract, adds the player to the roster if absent
 * (re-signing an own expiring player replaces their old cap hit), and updates
 * `finances.capUsed`. Throws when the deal would bust the cap or push the
 * roster past 26. Does not touch lines — the career layer repairs deployment.
 */
export function signPlayer(args: {
  team: Team
  player: Player
  salary: number
  years: number
  year: number
  players: Map<PlayerId, Player>
}): void {
  const { team, player, salary, years, year, players } = args
  const onRoster = team.roster.includes(player.id)

  if (!onRoster && team.roster.length >= MAX_ROSTER_SIZE) {
    throw new Error(
      `cannot sign ${player.name}: ${team.name} roster is full (${MAX_ROSTER_SIZE})`
    )
  }
  const prospective =
    capUsedFor(team, players) - (onRoster ? player.contract.salary : 0) + salary
  if (prospective > team.finances.salaryCap) {
    throw new Error(
      `cannot sign ${player.name} at ${salary}: ${team.name} would be ${
        prospective - team.finances.salaryCap
      } over the cap`
    )
  }

  player.contract = {
    salary,
    yearsRemaining: years,
    expiryYear: year + years,
    noTradeClause: false,
    twoWay: salary < TWO_WAY_THRESHOLD
  }
  if (!onRoster) team.roster.push(player.id)
  team.finances.capUsed = prospective
}

/**
 * Remove a player from the roster and drop their cap hit. Lines are left
 * untouched — the career layer repairs deployment after roster moves.
 */
export function releasePlayer(args: {
  team: Team
  playerId: PlayerId
  players: Map<PlayerId, Player>
}): void {
  const { team, playerId, players } = args
  const idx = team.roster.indexOf(playerId)
  if (idx === -1) return
  team.roster.splice(idx, 1)
  team.finances.capUsed = capUsedFor(team, players)
}

/**
 * Expire contracts: every rostered player whose `yearsRemaining` has reached 0
 * becomes an unrestricted free agent — removed from the roster, cap recomputed.
 * Does NOT decrement `yearsRemaining`; the career layer does that once at
 * season rollover (see module doc). Run after the resign stage so re-signed
 * keepers (fresh `yearsRemaining >= 1`) are skipped.
 */
export function processExpiries(args: {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  year: number
}): { expired: Array<{ playerId: PlayerId; teamId: TeamId }> } {
  const { teams, players } = args
  const expired: Array<{ playerId: PlayerId; teamId: TeamId }> = []
  for (const team of teams.values()) {
    const keep: PlayerId[] = []
    for (const id of team.roster) {
      const p = players.get(id)
      if (p && p.contract.yearsRemaining <= 0) {
        expired.push({ playerId: id, teamId: team.id })
      } else {
        keep.push(id)
      }
    }
    if (keep.length !== team.roster.length) {
      team.roster = keep
      team.finances.capUsed = capUsedFor(team, players)
    }
  }
  return { expired }
}

/** Rostered players in the group whose contracts extend beyond this season. */
function secureCount(team: Team, players: Map<PlayerId, Player>, group: PositionGroup): number {
  let n = 0
  for (const id of team.roster) {
    const p = players.get(id)
    if (p && groupOf(p) === group && p.contract.yearsRemaining > 0) n++
  }
  return n
}

/** AI keeps quality, youth, and anyone whose exit would gut a position group. */
function isKeeper(team: Team, player: Player, players: Map<PlayerId, Player>): boolean {
  const group = groupOf(player)
  if (secureCount(team, players, group) < ROSTER_MINIMUMS[group]) return true
  const ovr = playerOverall(player)
  return ovr >= KEEPER_OVERALL || (player.age <= 23 && ovr >= 48)
}

/**
 * Resign stage: each AI club offers its expiring keepers their full ask, best
 * players first, while the new deal fits under the cap (the expiring player's
 * old salary comes off as the new one goes on). Players the club can't afford
 * or doesn't rate are left to expire into the FA pool. The user's club is
 * never touched.
 */
export function aiResignDay(args: {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  userTeamId: TeamId
  year: number
  rng: Rng
}): { signings: Array<{ playerId: PlayerId; teamId: TeamId; salary: number; years: number }> } {
  const { teams, players, userTeamId, year, rng } = args
  const signings: Array<{ playerId: PlayerId; teamId: TeamId; salary: number; years: number }> = []

  // Exclude AHL affiliates — re-signs are NHL-only operations.
  const aiTeams = [...teams.values()]
    .filter((t) => t.id !== userTeamId && t.tier !== 'ahl')
    .sort(byId)
  for (const team of aiTeams) {
    const expiring = team.roster
      .map((id) => players.get(id))
      .filter((p): p is Player => p !== undefined && p.contract.yearsRemaining <= 0)
      .sort(byOverallDesc)

    for (const player of expiring) {
      if (!isKeeper(team, player, players)) continue
      const ask = askTerms(player, year)
      if (!offerAcceptable(player, ask, ask, rng)) continue
      const prospective = capUsedFor(team, players) - player.contract.salary + ask.salary
      if (prospective > team.finances.salaryCap) continue
      signPlayer({ team, player, salary: ask.salary, years: ask.years, year, players })
      signings.push({ playerId: player.id, teamId: team.id, salary: ask.salary, years: ask.years })
    }
  }
  return { signings }
}

/**
 * One free-agency day. The pool is ranked by overall; a player decides once
 * `faDay` reaches `1 + floor(rank / 3)`, so the best names come off the board
 * first. A deciding player signs with the AI club (never the user's) that has
 * the largest positional shortfall vs the 14F/7D/2G targets — cap space breaks
 * ties, with a small rng jitter for variety — provided the club can fit the
 * salary and has a roster spot. Lingering free agents discount their ask 5%
 * per day they've gone unsigned (floor 70%). Unsigned players stay in the pool
 * and re-test on later days; the caller removes signed ids from its pool.
 */
export function aiFreeAgencyDay(args: {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  freeAgentIds: PlayerId[]
  userTeamId: TeamId
  year: number
  rng: Rng
  faDay: number
}): { signings: Array<{ playerId: PlayerId; teamId: TeamId; salary: number; years: number }> } {
  const { teams, players, freeAgentIds, userTeamId, year, rng, faDay } = args
  const signings: Array<{ playerId: PlayerId; teamId: TeamId; salary: number; years: number }> = []

  const rostered = new Set<PlayerId>()
  for (const team of teams.values()) {
    for (const id of team.roster) rostered.add(id)
  }

  const pool = freeAgentIds
    .map((id) => players.get(id))
    .filter((p): p is Player => p !== undefined && !rostered.has(p.id))
    .sort(byOverallDesc)

  // Exclude AHL affiliates — they are not part of the NHL free-agency pool.
  const aiTeams = [...teams.values()]
    .filter((t) => t.id !== userTeamId && t.tier !== 'ahl')
    .sort(byId)

  for (let rank = 0; rank < pool.length; rank++) {
    const player = pool[rank]
    const decisionDay = 1 + Math.floor(rank / FA_DECISIONS_PER_DAY)
    if (decisionDay > faDay) continue

    const ask = askTerms(player, year)
    const discount = Math.max(0.7, 1 - 0.05 * (faDay - decisionDay))
    const salary = Math.max(LEAGUE_MIN_SALARY, roundTo25k(ask.salary * discount))
    const group = groupOf(player)

    let best: Team | null = null
    let bestScore = -Infinity
    for (const team of aiTeams) {
      if (team.roster.length >= MAX_ROSTER_SIZE) continue
      const deficit = ROSTER_TARGETS[group] - secureCount(team, players, group)
      if (deficit <= 0) continue
      const space = capSpace(team, players)
      if (space < salary) continue
      const score = deficit * 1e9 + space + rng.float(0, 1e6)
      if (score > bestScore) {
        bestScore = score
        best = team
      }
    }
    if (!best) continue

    signPlayer({ team: best, player, salary, years: ask.years, year, players })
    signings.push({ playerId: player.id, teamId: best.id, salary, years: ask.years })
  }
  return { signings }
}

/**
 * Seed pick ownership at career start: every club owns its own picks for the
 * next `yearsAhead` drafts (default 3) across `rounds` rounds (default 2).
 * Ordered year → round → team for stable display.
 */
export function initialPicks(args: {
  teamIds: TeamId[]
  firstDraftYear: number
  yearsAhead?: number
  rounds?: number
}): DraftPick[] {
  const { teamIds, firstDraftYear, yearsAhead = 3, rounds = 2 } = args
  const picks: DraftPick[] = []
  for (let y = 0; y < yearsAhead; y++) {
    for (let round = 1; round <= rounds; round++) {
      for (const teamId of teamIds) {
        picks.push({
          year: firstDraftYear + y,
          round,
          originalTeamId: teamId,
          ownerTeamId: teamId
        })
      }
    }
  }
  return picks
}
