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
import { askModifierFor, indexed, maxContract, talentShift, wageIndex } from './economy'

/** Cheapest legal contract in BASE-YEAR dollars; asks never fall below the
 *  indexed value ({@link leagueMinSalary}). */
const LEAGUE_MIN_SALARY = 750_000
/** Today's league minimum — the base minimum moved with the cap. */
export const leagueMinSalary = (): number => indexed(LEAGUE_MIN_SALARY)
/** Today's entry-level AAV (base $900k) — moved with the cap. */
export const entryLevelSalary = (): number => indexed(900_000)
/** Contracts below this are two-way deals (minor-league assignable). */
const TWO_WAY_THRESHOLD = 1_100_000
// No-trade protection is only earned on a real top-of-roster commitment.
const NTC_MIN_SALARY = 4_500_000
const NTC_MIN_YEARS = 3
/** Hard roster ceiling enforced by signPlayer. */
export const MAX_ROSTER_SIZE = 26
/**
 * Year-over-year growth of the ceiling. The NHL's long-run rate is ~4–5%; the
 * current 9%/yr jump ($95.5M → $104.0M → $113.5M) is a one-off escrow catch-up,
 * not a rate to compound forever. Applied at every season rollover.
 *
 * Sanity check from the real 2026-27 base of $104.0M: 108.7 / 113.6 / 118.7 /
 * 124.0 / 129.6 five years out. Compounding off the old hardcoded $88.0M base
 * instead, the league would not have reached today's real ceiling until 2030.
 */
export const CAP_GROWTH = 1.045

/** Next season's ceiling, rounded to the nearest $100k. */
export const grownCap = (salaryCap: number): number =>
  Math.round((salaryCap * CAP_GROWTH) / 100_000) * 100_000

/**
 * The NHL's lower limit tracks its upper limit — 2025-26 was $95.5M/$70.6M and
 * 2026-27 is $104.0M/$77.1M, both ~73.9%. So the floor is a RATIO of a club's
 * own ceiling, never a constant: a mod that declares a $104M cap must get a
 * $77M floor, not the $65M one the fictional league happens to use.
 */
export const CAP_FLOOR_RATIO = 0.739

/** The floor for a given ceiling, rounded to the nearest $100k.
 *  `capFloorFor(88e6) === 65_000_000` — the vanilla league does not move. */
export const capFloorFor = (salaryCap: number): number =>
  Math.round((salaryCap * CAP_FLOOR_RATIO) / 100_000) * 100_000

/** Salary floor for the fictional league's $88M ceiling. Prefer
 *  {@link capFloorFor} anywhere a club's own ceiling is in hand. */
export const CAP_FLOOR = capFloorFor(88e6)

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
  // Priced by his standing in today's league (economy.ts talent anchor).
  const ovr = playerOverall(player) + talentShift()
  const rng = new Rng(deriveSeed(hashId(player.id), year))

  // Same shape as the generation curve, in millions.
  let m = 0.7 + Math.pow(Math.max(0, ovr - 45) / 45, 2.2) * 11
  if (player.age >= 24 && player.age <= 28) m *= 1.1 // prime years premium
  if (player.age >= 33) m *= Math.max(0.6, 1 - 0.07 * (player.age - 32)) // veteran discount
  if (ovr >= 90) m *= 1.15 // star tax
  m *= rng.float(0.96, 1.04)
  // The economy: base-year dollars moved with the cap, and the season he just
  // had (a contract-year breakout, a ring, a slump) — see economy.ts.
  m *= wageIndex() * askModifierFor(player)

  const salary = Math.max(leagueMinSalary(), Math.min(maxContract(), roundTo25k(m * 1e6)))
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
  return Math.max(leagueMinSalary(), roundTo25k(prior * pct))
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
  const ntcWorthy = ntcEligible && salary >= indexed(NTC_MIN_SALARY) && years >= NTC_MIN_YEARS
  const keepsExisting = ntcEligible && player.contract.noTradeClause
  player.contract = {
    salary,
    yearsRemaining: years,
    expiryYear: year + years,
    noTradeClause: ntcWorthy || keepsExisting,
    twoWay: salary < indexed(TWO_WAY_THRESHOLD)
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
 * Does THIS GM want his expiring UFA back? A position group below its minimum
 * always does. Otherwise the player must still be a regular (at or above the
 * club's weakest regular at his spot) — a loyal GM gives his own a few points
 * of benefit of the doubt, a rebuilding one lets a 30-something walk unless he
 * is loyal to a fault, and a young player with a future is kept.
 */
function personaWantsBack(
  team: Team,
  player: Player,
  players: Map<PlayerId, Player>,
  gm: { loyalty: number; capDiscipline: number },
  posture: 'contend' | 'retool' | 'rebuild',
): boolean {
  const group = groupOf(player)
  if (secureCount(team, players, group) < ROSTER_MINIMUMS[group]) return true
  const ovr = playerOverall(player)
  if (player.age <= 23 && ovr >= 48) return true
  if (posture === 'rebuild' && player.age >= 30 && gm.loyalty < 0.7) return false
  const n = group === 'G' ? 2 : group === 'D' ? 6 : 12
  const others = team.roster
    .map((id) => players.get(id))
    .filter((p): p is Player => !!p && p.id !== player.id && groupOf(p) === group && p.contract.yearsRemaining > 0)
    .map(playerOverall)
    .sort((a, b) => b - a)
  const bar = others[n - 1] ?? 0
  return ovr >= bar - 4 * gm.loyalty - (posture === 'contend' ? 1 : 0)
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
  /** LW-econ: the GM's character decides who is worth keeping (loyalty keeps
   *  his own, capDiscipline keeps a cushion, a rebuild lets veterans walk).
   *  Absent -> the original "keep anyone >= 55" rule. */
  personaOf?: (teamId: TeamId) => { loyalty: number; capDiscipline: number }
  postureOf?: (teamId: TeamId) => 'contend' | 'retool' | 'rebuild'
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
        const wanted = args.personaOf
          ? personaWantsBack(team, player, players, args.personaOf(team.id), args.postureOf?.(team.id) ?? 'retool')
          : isKeeper(team, player, players)
        if (!wanted) continue
        const ask = askTerms(player, year)
        if (!offerAcceptable(player, ask, ask, rng)) continue
      }
      const ask = askTerms(player, year)
      const prospective = capUsedFor(team, players) - player.contract.salary + ask.salary
      if (prospective > team.finances.salaryCap) continue
      // A disciplined GM keeps a cushion — but never at the cost of his best.
      if (args.personaOf) {
        const gm = args.personaOf(team.id)
        const cushion = team.finances.salaryCap * 0.03 * gm.capDiscipline
        const topThree = team.roster
          .map((id) => players.get(id))
          .filter((p): p is Player => !!p)
          .sort(byOverallDesc)
          .slice(0, 3)
          .some((p) => p.id === player.id)
        if (!topThree && prospective > team.finances.salaryCap - cushion) continue
      }
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
  /** The living market (LW-econ). When supplied, clubs BID on talent by upgrade x
   *  posture x their GM, and each player CHOOSES between competing offers
   *  (money, term, a contender, a role). Absent -> the original deficit rule. */
  market?: FaMarketContext
  /** The user's standing offers, entered into the same market (market only). */
  userBids?: Map<string, FaUserBid>
  /** Each man's decision day (market only); default {@link faDecisionDay}. */
  decisionDayOf?: (p: Player) => number
}): { signings: FaSigning[]; userOutcomes?: FaUserOutcome[] } {
  if (args.market) return marketFreeAgencyDay({ ...args, market: args.market })
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
    const salary = Math.max(leagueMinSalary(), roundTo25k(ask.salary * discount))
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
        if (salary >= indexed(REBUILD_MAX_UFA_AAV)) continue
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

/* ─────────────────────── the living FA market (LW-econ) ─────────────────────── */

/** What a club's front office brings to the July market. */
export interface FaMarketContext {
  /** GM axes the market reads (a GmPersona satisfies this). */
  personaOf: (teamId: TeamId) => { aggression: number; capDiscipline: number; name: string }
  postureOf: (teamId: TeamId) => 'contend' | 'retool' | 'rebuild'
  /** 1 = strongest roster (a contender is a selling point to a veteran). */
  strengthRankOf: (teamId: TeamId) => number
  /** The club's cap floor — a club below it bids hard to get there. */
  floorOf: (team: Team) => number
}

export interface FaSigning {
  playerId: PlayerId
  teamId: TeamId
  salary: number
  years: number
  /** How many clubs bid (market only). */
  suitors?: number
  /** The factor that won him (market only). */
  reason?: string
}

/** The weakest regular at a group, among players under contract beyond now. */
function marketReplacementLevel(team: Team, players: Map<PlayerId, Player>, group: PositionGroup): number {
  const n = group === 'G' ? 2 : group === 'D' ? 6 : 12
  const ovrs = team.roster
    .map((id) => players.get(id))
    .filter((p): p is Player => !!p && groupOf(p) === group && p.contract.yearsRemaining > 0)
    .map(playerOverall)
    .sort((a, b) => b - a)
  return ovrs[n - 1] ?? 0
}

/** What a club brings to the July market, read once and refreshed when it
 *  signs someone — the inputs every one of its bids is built from. */
export interface ClubMarketState {
  team: Team
  gm: { aggression: number; capDiscipline: number; name: string }
  posture: 'contend' | 'retool' | 'rebuild'
  room: number
  underFloor: boolean
  deficit: Record<PositionGroup, number>
  replacement: Record<PositionGroup, number>
}

export function clubMarketState(team: Team, players: Map<PlayerId, Player>, market: FaMarketContext): ClubMarketState {
  const used = capUsedFor(team, players)
  const groups: PositionGroup[] = ['F', 'D', 'G']
  return {
    team,
    gm: market.personaOf(team.id),
    posture: market.postureOf(team.id),
    room: team.finances.salaryCap - used,
    underFloor: used < market.floorOf(team),
    deficit: Object.fromEntries(groups.map((g) => [g, ROSTER_TARGETS[g] - secureCount(team, players, g)])) as Record<PositionGroup, number>,
    replacement: Object.fromEntries(groups.map((g) => [g, marketReplacementLevel(team, players, g)])) as Record<PositionGroup, number>,
  }
}

/** Every AI club's market state, in the market's own (stable) order. */
export function marketClubs(teams: Map<TeamId, Team>, players: Map<PlayerId, Player>, userTeamId: TeamId, market: FaMarketContext): ClubMarketState[] {
  return [...teams.values()]
    .filter((t) => t.id !== userTeamId && t.tier !== 'ahl' && t.tier !== 'world')
    .sort(byId)
    .map((t) => clubMarketState(t, players, market))
}

/**
 * The day a free agent makes his decision. July 1 is the FRENZY: the big
 * contracts (an ask of 2.5% of the ceiling or more) are all decided on day 1,
 * the way the real market moves at noon ET. The middle class follows over the
 * next two days, and the depth market trickles through the rest of the week.
 * Keyed to the ask (economy-scaled), not the day's pool rank, so the day is
 * stable as the pool thins.
 */
export function faDecisionDay(player: Player, year: number, salaryCap: number): number {
  const share = askTerms(player, year).salary / Math.max(1, salaryCap)
  if (share >= 0.025) return 1
  if (share >= 0.015) return 2
  if (share >= 0.011) return 3
  return 4 + (hashId(player.id as string) % 4)
}

/** How many of the class decide on July 1 itself — the frenzy — and how
 *  many a day after that. */
export const FRENZY_SHARE = 0.25
export const FRENZY_MIN = 12
export const FRENZY_MAX = 40
const AFTER_FRENZY_PER_DAY = 6

/**
 * Decision day from a man's place in the class as it stood at the open (see
 * OffseasonState.faClassOrder): the top quarter of the class (12–40 men) on
 * day 1, then six a day. A man who joined the market later decides on the day
 * he is asked (`today`).
 */
export function faClassDecisionDay(rank: number, classSize: number, today: number): number {
  if (rank < 0) return Math.max(1, today)
  const frenzy = Math.max(FRENZY_MIN, Math.min(FRENZY_MAX, Math.round(classSize * FRENZY_SHARE)))
  if (rank < frenzy) return 1
  return 2 + Math.floor((rank - frenzy) / AFTER_FRENZY_PER_DAY)
}

/** How much a club wants a free agent: what he adds over its weakest
 *  regular at his position, weighed by its window, plus an empty roster slot
 *  or a payroll under the floor. The same rule for every club, the GM's too
 *  (it is also the pitch: the club that wants him most sells hardest). */
export function clubWant(c: ClubMarketState, player: Player): number {
  const group = groupOf(player)
  const upgrade = playerOverall(player) - c.replacement[group]
  const deficit = c.deficit[group]
  const postureW = c.posture === 'contend' ? 1.35 : c.posture === 'retool' ? 1 : player.age <= 25 ? 0.9 : 0.45
  return Math.max(0, upgrade) * postureW + (deficit > 0 ? 2 + deficit : 0) + (c.underFloor ? 4 : 0)
}

/** One club's offer to one free agent, as the market builds it. */
export interface FaMarketBid {
  teamId: TeamId
  salary: number
  years: number
  /** His overall over the club's weakest regular at his position. */
  upgrade: number
  /** How much the club wants him (its bid's priority on the day). */
  want: number
  /** The user's own standing offer, entered into the same choice. */
  user?: boolean
}

/**
 * The bids a free agent draws TODAY, each club's own: wanting him is about
 * what he adds (his overall over the club's weakest regular), weighed by the
 * club's window, an empty roster slot or a payroll under the floor; the GM
 * shapes the money (aggression pays over for a real upgrade, a disciplined GM
 * keeps a cushion). Pure — the July market, the needs board and the agent's
 * "who has called" all read this one function. `rng` only adds the daily
 * jitter to how keen each club is; the offers themselves don't depend on it.
 */
export function marketBidsFor(args: {
  player: Player
  clubs: ClubMarketState[]
  year: number
  faDay: number
  decisionDay: number
  rng?: Rng
}): FaMarketBid[] {
  const { player, clubs, year, faDay, decisionDay, rng } = args
  const ask = askTerms(player, year)
  const discount = Math.max(0.7, 1 - 0.05 * Math.max(0, faDay - decisionDay))
  const base = Math.max(leagueMinSalary(), roundTo25k(ask.salary * discount))
  const group = groupOf(player)
  const ovr = playerOverall(player)
  const bids: FaMarketBid[] = []
  for (const c of clubs) {
    if (c.team.roster.length >= MAX_ROSTER_SIZE) continue
    const { gm, posture, room, underFloor } = c
    const upgrade = ovr - c.replacement[group]
    if (posture === 'rebuild' && player.age >= 30 && ask.years >= 2 && !underFloor) continue
    if (posture === 'rebuild' && base >= indexed(REBUILD_MAX_UFA_AAV) && player.age > 25) continue
    let want = clubWant(c, player)
    if (want <= 0.5) continue
    const over = 0.1 * gm.aggression * Math.min(1, Math.max(0, upgrade) / 6) + (underFloor ? 0.05 : 0)
    const salary = roundTo25k(base * (1 + over))
    const cushion = underFloor ? 0 : c.team.finances.salaryCap * 0.02 * gm.capDiscipline
    if (salary > room - cushion) continue
    const years = posture === 'rebuild' && player.age >= 30 ? 1 : ask.years
    if (rng) want += rng.float(0, 0.5)
    bids.push({ teamId: c.team.id, salary, years, upgrade, want })
  }
  return bids
}

/** Why a player picks an offer, in his words. */
export type FaReason = 'the money' | 'the term' | 'a chance to win' | 'the role'

export interface FaChoice {
  bid: FaMarketBid
  utility: number
  reason: FaReason
}

/**
 * The PLAYER's choice among offers, weighted by his personality and age:
 * money (ambitious players), term (veterans), a contender (ring-chasers), a
 * role (young players want ice). Returns every offer scored, best first, each
 * with the factor that counts most for it — the reason he'd give.
 */
export function rankOffers(args: {
  player: Player
  bids: FaMarketBid[]
  year: number
  strengthRankOf: (teamId: TeamId) => number
  nTeams: number
  rng?: Rng
}): FaChoice[] {
  const { player, bids, year, strengthRankOf, nTeams, rng } = args
  const ask = askTerms(player, year)
  const pers = player.personality
  const wMoney = 0.45 + ((pers.ambition - 10.5) / 19) * 0.4
  const wTerm = 0.2 + (player.age >= 30 ? 0.2 : 0) - ((pers.determination - 10.5) / 19) * 0.1
  const wWin = 0.15 + (player.age >= 30 ? 0.2 : 0) + ((pers.ambition - 10.5) / 19) * 0.1
  const wRole = player.age <= 27 ? 0.2 : 0.08
  const REASONS: FaReason[] = ['the money', 'the term', 'a chance to win', 'the role']
  const scored = bids.map((b) => {
    const money = b.salary / Math.max(1, ask.salary)
    const term = termSecurityScore(player, ask.years, b.years)
    const win = 1 - (strengthRankOf(b.teamId) - 1) / Math.max(1, nTeams - 1)
    const role = b.upgrade >= 4 ? 1 : b.upgrade >= 0 ? 0.6 : 0.25
    const parts = [wMoney * money, wTerm * term, wWin * win, wRole * role]
    // Clubs that want him most also sell hardest — a SMALL pitch term. Capped:
    // on July 1 a club with half its roster unsigned "wants" everyone ~100,
    // and an uncapped pitch outweighed every offer's money, term and role.
    const u = parts[0]! + parts[1]! + parts[2]! + parts[3]! + 0.01 * Math.min(12, b.want) + (rng ? rng.float(0, 0.03) : 0.015)
    return { b, parts, u }
  })
  // The reason he'd give is what sets an offer APART from the field — the
  // part where it beats the other offers most — not the part every offer
  // shares (money is always the biggest term, so it would win every time).
  const avg = [0, 1, 2, 3].map((i) => scored.reduce((s, x) => s + x.parts[i]!, 0) / Math.max(1, scored.length))
  const out: FaChoice[] = scored.map((x) => {
    const edge = scored.length > 1 ? x.parts.map((v, i) => v - avg[i]!) : x.parts
    let bi = 0
    for (let i = 1; i < 4; i++) if (edge[i]! > edge[bi]!) bi = i
    return { bid: x.b, utility: x.u, reason: REASONS[bi]! }
  })
  // Stable: the first offer at the top score wins ties (the market's order).
  return out
    .map((c, i) => ({ c, i }))
    .sort((x, y) => y.c.utility - x.c.utility || x.i - y.i)
    .map((x) => x.c)
}

/** The user's standing offer, entered into the July market. */
export interface FaUserBid {
  salary: number
  years: number
}

/** What became of a user's standing offer on the day the player decided. */
export interface FaUserOutcome {
  playerId: PlayerId
  won: boolean
  salary: number
  years: number
  /** Why he chose the winner (you, or the club that beat you). */
  reason: FaReason | 'holdout'
  /** The club that won him when it wasn't you. */
  winnerTeamId?: TeamId
  winnerSalary?: number
  winnerYears?: number
  suitors: number
}

/**
 * July, alive. Each deciding free agent draws BIDS from every AI club that
 * wants him ({@link marketBidsFor}), and the user's standing offer goes into
 * the same pile. Then the PLAYER chooses ({@link rankOffers}), so the best
 * offer on paper doesn't always win. A user offer below his floor is a
 * holdout. The user's wins are returned for the career to sign (cap and
 * roster checks are the career's); every AI win is signed here.
 */
function marketFreeAgencyDay(args: {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  freeAgentIds: PlayerId[]
  userTeamId: TeamId
  year: number
  rng: Rng
  faDay: number
  market: FaMarketContext
  userBids?: Map<string, FaUserBid>
  decisionDayOf?: (p: Player) => number
}): { signings: FaSigning[]; userOutcomes: FaUserOutcome[] } {
  const { teams, players, freeAgentIds, userTeamId, year, rng, faDay, market } = args
  const signings: FaSigning[] = []
  const userOutcomes: FaUserOutcome[] = []
  const rostered = new Set<PlayerId>()
  for (const team of teams.values()) for (const id of team.roster) rostered.add(id)
  const pool = freeAgentIds
    .map((id) => players.get(id))
    .filter((p): p is Player => p !== undefined && !rostered.has(p.id))
    .sort(byOverallDesc)
  const clubs = marketClubs(teams, players, userTeamId, market)
  const nTeams = Math.max(2, clubs.length + 1)
  const userTeam = teams.get(userTeamId)
  const userState = userTeam ? clubMarketState(userTeam, players, market) : undefined

  for (const player of pool) {
    const decisionDay = args.decisionDayOf ? args.decisionDayOf(player) : faDecisionDay(player, year, userTeam?.finances.salaryCap ?? 88e6)
    if (decisionDay > faDay) continue
    const bids = marketBidsFor({ player, clubs, year, faDay, decisionDay, rng })
    const ub = args.userBids?.get(player.id as string)
    if (ub && userState) {
      const ask = askTerms(player, year)
      const discount = Math.max(0.7, 1 - 0.05 * Math.max(0, faDay - decisionDay))
      const floor = 0.9 * Math.max(leagueMinSalary(), roundTo25k(ask.salary * discount))
      if (ub.salary < floor) {
        userOutcomes.push({ playerId: player.id, won: false, salary: ub.salary, years: ub.years, reason: 'holdout', suitors: bids.length })
      } else {
        bids.push({ teamId: userTeamId, salary: ub.salary, years: ub.years, upgrade: playerOverall(player) - userState.replacement[groupOf(player)], want: clubWant(userState, player), user: true })
      }
    }
    if (bids.length === 0) continue
    const ranked = rankOffers({ player, bids, year, strengthRankOf: market.strengthRankOf, nTeams, rng })
    const best = ranked[0]!
    const suitors = bids.filter((b) => !b.user).length
    if (best.bid.user) {
      userOutcomes.push({ playerId: player.id, won: true, salary: best.bid.salary, years: best.bid.years, reason: best.reason, suitors })
      continue
    }
    const winner = clubs.find((c) => c.team.id === best.bid.teamId)!
    try {
      signPlayer({ team: winner.team, player, salary: best.bid.salary, years: best.bid.years, year, players })
    } catch {
      continue
    }
    // The winner's books and depth changed: refresh its market state.
    Object.assign(winner, clubMarketState(winner.team, players, market))
    if (ub && bids.some((b) => b.user)) {
      userOutcomes.push({
        playerId: player.id, won: false, salary: ub.salary, years: ub.years, reason: best.reason,
        winnerTeamId: best.bid.teamId, winnerSalary: best.bid.salary, winnerYears: best.bid.years, suitors,
      })
    }
    signings.push({ playerId: player.id, teamId: best.bid.teamId, salary: best.bid.salary, years: best.bid.years, suitors, reason: best.reason })
  }
  return { signings, userOutcomes }
}

/**
 * THE FLOOR BINDS. After the summer market, any AI club still under the cap
 * floor signs the best free agents it can fit (a roster spot and the money),
 * paying a one-year floor premium if that is what it takes. Real clubs below
 * the lower limit must get there before the season; this is them doing it.
 */
export function aiFloorTopUp(args: {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  freeAgentIds: PlayerId[]
  userTeamId: TeamId
  year: number
  floorOf: (team: Team) => number
}): { signings: FaSigning[] } {
  const { teams, players, userTeamId, year } = args
  const signings: FaSigning[] = []
  const taken = new Set<string>()
  const rostered = new Set<string>()
  for (const t of teams.values()) for (const id of t.roster) rostered.add(id as string)
  const pool = args.freeAgentIds
    .map((id) => players.get(id))
    .filter((p): p is Player => !!p && !rostered.has(p.id as string))
    .sort(byOverallDesc)
  const aiTeams = [...teams.values()].filter((t) => t.id !== userTeamId && t.tier !== 'ahl' && t.tier !== 'world').sort(byId)
  for (const team of aiTeams) {
    for (let guard = 0; guard < 6; guard++) {
      const used = capUsedFor(team, players)
      const short = args.floorOf(team) - used
      if (short <= 0 || team.roster.length >= 25) break
      const room = team.finances.salaryCap - used
      const cand = pool.find((p) => !taken.has(p.id as string) && askTerms(p, year).salary <= room)
      if (!cand) break
      taken.add(cand.id as string)
      const ask = askTerms(cand, year)
      // A club far under the floor spreads the shortfall over the few seats it
      // has left — one-year overpays, the way real floor clubs comply.
      const seats = Math.max(1, Math.min(6 - guard, 25 - team.roster.length))
      const salary = Math.min(room, Math.max(ask.salary, roundTo25k(Math.min(short, Math.max(short / seats, ask.salary * 1.5), ask.salary * 3))))
      try {
        signPlayer({ team, player: cand, salary, years: 1, year, players })
      } catch {
        continue
      }
      signings.push({ playerId: cand.id, teamId: team.id, salary, years: 1 })
    }
  }
  return { signings }
}
