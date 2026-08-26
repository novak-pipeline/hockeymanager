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
import { ratedOverall } from '@engine/ratings/composites'
import { deriveSeed, Rng } from '@engine/shared/rng'

/** Cheapest legal contract; asks never fall below this. */
const LEAGUE_MIN_SALARY = 750_000
/** Contracts below this are two-way deals (minor-league assignable). */
const TWO_WAY_THRESHOLD = 1_100_000
// No-trade protection is only earned on a real top-of-roster commitment.
const NTC_MIN_SALARY = 4_500_000
const NTC_MIN_YEARS = 3
/** Hard roster ceiling enforced by signPlayer. */
export const MAX_ROSTER_SIZE = 26
/** Salary floor — the minimum payroll a club is expected to ice (~74% of the
 *  $88M ceiling, mirroring the NHL's lower limit). AI clubs spend up to it in
 *  free agency; the UI flags a user club that sits below it. */
export const CAP_FLOOR = 65_000_000

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

const playerOverall = (p: Player): number => ratedOverall(p)

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

/**
 * Contract status by age + pro service (approximates NHL rules):
 *   ELC — entry-level: young (≤23) with a short pro record (≤3 seasons).
 *   RFA — restricted: under 27 and fewer than 7 pro seasons. His club holds his
 *         rights and can qualify him, so he can't simply walk to the open market.
 *   UFA — unrestricted: 27+, or 7+ pro seasons — free to sign anywhere.
 * Matches the age-27 RFA/UFA boundary the profile view already displays, so the
 * label a GM sees and the way the engine treats the player agree.
 */
/** A one-way veteran must clear waivers to go to the AHL; young/two-way players
 *  are exempt. (Simplified from the NHL's age+games formula.) */
export function requiresWaivers(player: Player): boolean {
  return player.contract.twoWay === false && player.age >= 25
}

export function contractStatus(player: Player): 'ELC' | 'RFA' | 'UFA' {
  if (player.age >= 27 || player.stats.length >= 7) return 'UFA'
  if (player.age <= 23 && player.stats.length <= 3) return 'ELC'
  return 'RFA'
}

/** A club walks away from (declines to qualify) a restricted FA below this overall
 *  when the position group is already at its minimum — i.e. a fringe RFA can still
 *  reach free agency, but quality young players are retained. */
const RFA_WALKAWAY_OVERALL = 45

/** Sum of rostered salaries; the live truth `finances.capUsed` caches. Each
 *  rostered player counts his cap hit MINUS any salary a former club retained on
 *  him; retained-salary this club owes on players it traded away is added on
 *  top (#157). */
export function capUsedFor(team: Team, players: Map<PlayerId, Player>): number {
  let sum = 0
  for (const id of team.roster) {
    const p = players.get(id)
    if (p) sum += p.contract.salary - (p.contract.retainedByOthers ?? 0)
  }
  for (const slot of team.finances.retained ?? []) sum += slot.amount
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

/* ─────────────────────────── the price of term ─────────────────────────── */

/** Age at which a player is free to sign anywhere (see contractStatus). */
const UFA_AGE = 27

/**
 * TERM IS A CONCESSION THE CLUB ASKS FOR, NOT A GIFT IT GIVES.
 *
 * A year of term past what the player asked for is a year the CLUB wants: cap
 * certainty, his prime locked up, and — if it runs past his UFA age — a year of
 * open-market freedom the club is buying off him. Real contracts price that:
 * the AAV goes UP with term, it does not stay flat. (The playtest found the
 * opposite — offering the ask AAV over MORE years was an automatic yes, which
 * is backwards and made every re-signing free.)
 *
 * Returns a multiplier on his asking AAV — the number he actually needs to see
 * for THAT term. 1.0 at exactly the term he asked for. Shorter deals are a
 * little cheaper per year (he keeps his optionality), but only a little.
 */
export function termPriceMultiplier(
  player: Player,
  askYears: number,
  years: number
): number {
  let mult = 1
  if (years > askYears) {
    for (let i = askYears; i < years; i++) {
      const ageThatSeason = player.age + i
      // Base cost of an extra guaranteed year the club wanted and he didn't.
      let step = 0.045
      // A year at or past UFA age is a year of free agency he is selling.
      if (ageThatSeason >= UFA_AGE) step += 0.03
      // Decline years are the ones clubs regret; his camp prices them highest.
      if (ageThatSeason >= 31) step += 0.015 * (ageThatSeason - 30)
      mult += step
    }
  } else if (years < askYears) {
    mult -= 0.03 * (askYears - years)
  }
  return Math.max(0.88, Math.min(2.2, mult))
}

/**
 * How much of the security he asked for a shorter deal actually delivers, 0–1.
 * Falling short of his term costs real points with players who want roots —
 * veterans and the loyal ones — so a bridge deal has to be bought with money.
 */
export function termSecurityScore(
  player: Player,
  askYears: number,
  years: number
): number {
  if (years >= askYears) return 1
  const appetite =
    (player.age >= 30 ? 0.9 : player.age >= 26 ? 0.7 : 0.5) +
    (player.personality.loyalty - 10.5) / 19 * 0.2
  const shortfall = (askYears - years) / Math.max(1, askYears)
  return Math.max(0, 1 - shortfall * appetite)
}

/**
 * The qualifying offer a club must tender to keep a restricted free agent's
 * rights (real CBA ladder, by prior salary: 110% under $1M, 105% to $2M, 100%
 * above). Let the deadline pass without tendering and he walks to the open
 * market for nothing — the club has walked away.
 */
export function qualifyingOffer(player: Player): number {
  const prior = player.contract.salary
  const pct = prior < 1_000_000 ? 1.1 : prior < 2_000_000 ? 1.05 : 1.0
  return Math.max(LEAGUE_MIN_SALARY, roundTo25k(prior * pct))
}

/**
 * Does the player take the offer? Offer value is measured against the ask —
 * money weighted 75%, security 25%. The money is measured against the price of
 * the TERM OFFERED (termPriceMultiplier), not the bare ask, so buying extra
 * years costs extra dollars instead of being free value. At exactly his asking
 * term the arithmetic is unchanged: full ask = 1.0. The acceptance threshold
 * sits near 95% of ask, nudged by personality (ambitious players hold out,
 * loyal players settle) plus a small rng wiggle, clamped so a full-ask offer
 * always lands and an 85%-value offer never does.
 */
export function offerAcceptable(
  player: Player,
  offer: { salary: number; years: number },
  ask: { salary: number; years: number },
  rng: Rng
): boolean {
  const required = Math.max(1, ask.salary * termPriceMultiplier(player, ask.years, offer.years))
  const money = Math.min(1.4, offer.salary / required)
  const value = 0.75 * money + 0.25 * termSecurityScore(player, ask.years, offer.years)

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

  // No-trade protection follows real practice: only a UFA-eligible player (age
  // ≥27 or 7+ pro seasons) on a substantial multi-year deal earns an NTC — and a
  // player who already holds one keeps it when he re-signs while still eligible.
  // Young players and cheap/short deals never carry one.
  const ntcEligible = player.age >= 27 || player.stats.length >= 7
  const ntcWorthy = ntcEligible && salary >= NTC_MIN_SALARY && years >= NTC_MIN_YEARS
  const keepsExisting = ntcEligible && player.contract.noTradeClause
  player.contract = {
    salary,
    yearsRemaining: years,
    expiryYear: year + years,
    noTradeClause: ntcWorthy || keepsExisting,
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
      const restricted = contractStatus(player) !== 'UFA'
      if (restricted) {
        // A restricted FA has no leverage — his club qualifies him and he can't
        // walk, so we skip the acceptance check. The club only declines a fringe
        // RFA when the position is already stocked (he then reaches the open pool).
        const group = groupOf(player)
        if (
          playerOverall(player) < RFA_WALKAWAY_OVERALL &&
          secureCount(team, players, group) >= ROSTER_MINIMUMS[group]
        ) {
          continue
        }
      } else {
        // Unrestricted: the club must both want him and win the negotiation.
        if (!isKeeper(team, player, players)) continue
        const ask = askTerms(player, year)
        if (!offerAcceptable(player, ask, ask, rng)) continue
      }
      const ask = askTerms(player, year)
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
 *
 * Posture (optional, LW3): a club's competitive window shapes who it chases. A
 * rebuilding team builds through youth — it won't hand a 30-something UFA
 * multi-year term, and it stays out of the top of the market; it'll still take a
 * cheap short-term stopgap. A contender leans in: high-impact UFAs get a scoring
 * nudge so the best names actually land with clubs trying to win now. Absent
 * `postureOf`, every club is treated as 'retool' and behaviour is unchanged.
 */
const REBUILD_MAX_UFA_AAV = 5_500_000 // rebuilders don't shop the top of the market
export function aiFreeAgencyDay(args: {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  freeAgentIds: PlayerId[]
  userTeamId: TeamId
  year: number
  rng: Rng
  faDay: number
  postureOf?: (teamId: TeamId) => 'contend' | 'retool' | 'rebuild'
}): { signings: Array<{ playerId: PlayerId; teamId: TeamId; salary: number; years: number }> } {
  const { teams, players, freeAgentIds, userTeamId, year, rng, faDay } = args
  const postureOf = args.postureOf ?? ((): 'retool' => 'retool')
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
    const ovr = playerOverall(player)

    let best: Team | null = null
    let bestScore = -Infinity
    for (const team of aiTeams) {
      if (team.roster.length >= MAX_ROSTER_SIZE) continue
      const deficit = ROSTER_TARGETS[group] - secureCount(team, players, group)
      if (deficit <= 0) continue
      const space = capSpace(team, players)
      if (space < salary) continue
      const posture = postureOf(team.id)
      if (posture === 'rebuild') {
        // A rebuilding club builds through youth: no multi-year money to an
        // aging vet, and no shopping at the top of the market. Cheap, short
        // stopgaps only.
        if (player.age >= 30 && ask.years >= 2) continue
        if (salary >= REBUILD_MAX_UFA_AAV) continue
      }
      // Contenders chase the difference-makers — a nudge so the best available
      // gravitates to a club actually pushing for now.
      const contendPull = posture === 'contend' && ovr >= 78 ? 5e8 : 0
      const score = deficit * 1e9 + contendPull + space + rng.float(0, 1e6)
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
