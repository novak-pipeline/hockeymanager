/**
 * League generation (build step #2). Produces a fully-populated, fictional
 * league: conferences, divisions, teams, complete rosters of generated players,
 * deployed lines, default tactics, and a balanced schedule.
 *
 * Everything is driven by a seeded Rng so the same seed always yields the same
 * league — required for reproducible sims and calibration.
 */
import {
  asPlayerId,
  asTeamId,
  asLeagueId,
  asGameId,
  type Conference,
  type Contract,
  type Division,
  type GoalieAttributes,
  type League,
  type Lines,
  type Personality,
  type Player,
  type PlayerId,
  type Position,
  type RawAttributes,
  type ScheduledGame,
  type Standing,
  type Team,
  type TeamId,
  type TeamTactics
} from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import type { PlayerRole } from '@domain'
import { CONFERENCE_NAMES, DIVISION_NAMES, FIRST_NAMES, FRANCHISES, LAST_NAMES } from './names'

/** In-memory league database: the League plus its resolved entities. */
export interface LeagueData {
  league: League
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  /**
   * Pre-built staff complements from a mod import. Populated only when a
   * ModDatabase provides real staff data; absent for generated leagues.
   * Career.generateAllTeamStaff prefers these over generated staff.
   */
  staffByTeam?: Map<TeamId, import('@engine/league/staff').TeamStaff>
}

export interface GenerateOptions {
  seed: number
  /** Number of teams; must be even and ≥ 4. Default 16. */
  teamCount?: number
  /** Forwards / defensemen / goalies per roster. Default 14 / 7 / 2. */
  forwardsPerTeam?: number
  defensePerTeam?: number
  goaliesPerTeam?: number
  /** Full round-robins to play; each is (teamCount-1) games per team. Default 4. */
  roundRobins?: number
  /** Calendar year the season starts. Default 2025. */
  startYear?: number
  leagueName?: string
}

const FORWARD_ROLES: PlayerRole[] = ['sniper', 'playmaker', 'twoWay', 'powerForward', 'enforcer']
const FORWARD_ROLE_WEIGHTS = [3, 3, 3, 2, 1]
const DEFENSE_ROLES: PlayerRole[] = ['offensiveD', 'shutdownD', 'stayAtHomeD']

function weightedRole(rng: Rng, roles: PlayerRole[], weights: number[]): PlayerRole {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.float(0, total)
  for (let i = 0; i < roles.length; i++) {
    r -= weights[i]
    if (r <= 0) return roles[i]
  }
  return roles[roles.length - 1]
}

const clampRating = (v: number): number => Math.round(v < 1 ? 1 : v > 99 ? 99 : v)

/** One attribute drawn around a player's caliber. */
const attr = (rng: Rng, caliber: number, spread = 7): number =>
  clampRating(rng.normal(caliber, spread))

function makeRawAttributes(rng: Rng, caliber: number, position: Position): RawAttributes {
  const raw: RawAttributes = {
    technical: {
      wristShot: attr(rng, caliber),
      slapShot: attr(rng, caliber),
      stickhandling: attr(rng, caliber),
      passing: attr(rng, caliber),
      deflections: attr(rng, caliber),
      faceoffs: attr(rng, position === 'C' ? caliber + 5 : caliber - 10)
    },
    physical: {
      speed: attr(rng, caliber),
      acceleration: attr(rng, caliber),
      strength: attr(rng, caliber),
      balance: attr(rng, caliber),
      stamina: attr(rng, caliber),
      agility: attr(rng, caliber),
      height: clampRating(rng.normal(50, 15))
    },
    mental: {
      offensiveIQ: attr(rng, caliber),
      defensiveIQ: attr(rng, caliber),
      positioning: attr(rng, caliber),
      vision: attr(rng, caliber),
      aggression: clampRating(rng.normal(50, 18)),
      composure: attr(rng, caliber),
      workRate: attr(rng, caliber),
      discipline: clampRating(rng.normal(55, 18)),
      anticipation: attr(rng, caliber)
    },
    defensive: {
      checking: attr(rng, caliber),
      shotBlocking: attr(rng, caliber),
      stickChecking: attr(rng, caliber),
      takeaway: attr(rng, caliber)
    }
  }
  if (position === 'G') {
    const g: GoalieAttributes = {
      reflexes: attr(rng, caliber),
      positioningG: attr(rng, caliber),
      reboundControl: attr(rng, caliber),
      glove: attr(rng, caliber),
      blocker: attr(rng, caliber),
      recovery: attr(rng, caliber),
      puckHandlingG: attr(rng, caliber - 8)
    }
    raw.goalie = g
  }
  return raw
}

/** Ceiling = current plus age-scaled upside on every attribute. */
function makePotential(rng: Rng, current: RawAttributes, age: number): RawAttributes {
  const upsideRoom = Math.max(0, 26 - age) // youth → more headroom
  const bump = (v: number): number => clampRating(v + rng.float(0, upsideRoom * 0.9))
  const bumpGroup = <T extends object>(g: T): T =>
    Object.fromEntries(Object.entries(g).map(([k, v]) => [k, bump(v as number)])) as T
  const pot: RawAttributes = {
    technical: bumpGroup(current.technical),
    physical: bumpGroup(current.physical),
    mental: bumpGroup(current.mental),
    defensive: bumpGroup(current.defensive)
  }
  if (current.goalie) pot.goalie = bumpGroup(current.goalie)
  return pot
}

function makePersonality(rng: Rng): Personality {
  const t = (): number => rng.range(1, 20)
  return {
    ambition: t(),
    professionalism: t(),
    loyalty: t(),
    temperament: t(),
    determination: t()
  }
}

function makeContract(rng: Rng, ovr: number, startYear: number): Contract {
  // Rough cap-era salary curve: replacement ~0.8M, stars ~12M.
  const base = 0.7 + Math.pow(Math.max(0, ovr - 45) / 45, 2.2) * 11
  const salary = Math.round(base * 1e6)
  const years = rng.range(1, 6)
  return {
    salary,
    yearsRemaining: years,
    expiryYear: startYear + years,
    noTradeClause: ovr > 80 && rng.chance(0.4),
    twoWay: ovr < 55 && rng.chance(0.5)
  }
}

function makeName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`
}

function makePlayer(
  rng: Rng,
  id: PlayerId,
  position: Position,
  teamCaliber: number,
  startYear: number
): Player {
  const caliber = clampRating(rng.normal(teamCaliber, 8))
  const age = Math.round(Math.min(40, Math.max(18, rng.normal(26, 4))))
  const raw = makeRawAttributes(rng, caliber, position)
  const role: PlayerRole =
    position === 'G'
      ? 'starter'
      : position === 'D'
        ? rng.pick(DEFENSE_ROLES)
        : weightedRole(rng, FORWARD_ROLES, FORWARD_ROLE_WEIGHTS)
  const composites = computeComposites(raw, role, position)
  const ovr = overall(composites, position)
  return {
    id,
    name: makeName(rng),
    age,
    position,
    handedness: rng.chance(0.65) ? 'L' : 'R',
    role,
    ratings: raw,
    potential: makePotential(rng, raw, age),
    composites,
    personality: makePersonality(rng),
    contract: makeContract(rng, ovr, startYear),
    stats: [],
    fatigue: 0,
    morale: rng.range(50, 80),
    injuryStatus: null,
    form: 0
  }
}

const DEFAULT_TACTICS: TeamTactics = {
  forecheck: '1-2-2',
  dZoneCoverage: 'zone',
  tempo: { pace: 0.5, passRisk: 0.5, shotEagerness: 0.5, defensivePinch: 0.4 },
  specialTeams: { powerPlay: 'umbrella', penaltyKill: 'box' },
  lineMatching: false
}

/** Build forward lines, D pairs, goalie depth, and special-teams units. */
function buildLines(players: Player[]): Lines {
  const byOverall = (a: Player, b: Player): number =>
    overall(b.composites, b.position) - overall(a.composites, a.position)

  const centers = players.filter((p) => p.position === 'C').sort(byOverall)
  const wingers = players.filter((p) => p.position === 'W').sort(byOverall)
  const defense = players.filter((p) => p.position === 'D').sort(byOverall)
  const goalies = players.filter((p) => p.position === 'G').sort(byOverall)

  const forwards: [PlayerId, PlayerId, PlayerId][] = []
  for (let line = 0; line < 4; line++) {
    const c = centers[line] ?? centers[centers.length - 1]
    const lw = wingers[line * 2] ?? wingers[wingers.length - 1]
    const rw = wingers[line * 2 + 1] ?? wingers[wingers.length - 2] ?? wingers[wingers.length - 1]
    forwards.push([lw.id, c.id, rw.id])
  }

  const defensePairs: [PlayerId, PlayerId][] = []
  for (let pair = 0; pair < 3; pair++) {
    const ld = defense[pair * 2] ?? defense[defense.length - 1]
    const rd = defense[pair * 2 + 1] ?? defense[defense.length - 1]
    defensePairs.push([ld.id, rd.id])
  }

  const goalieIds: [PlayerId, PlayerId] = [
    goalies[0].id,
    goalies[1]?.id ?? goalies[0].id
  ]

  // PP1: top line + top pair. PK1: a checking line + top defensive pair.
  const powerPlayUnits: PlayerId[][] = [
    [...forwards[0], ...defensePairs[0]],
    [...forwards[1], ...defensePairs[1]]
  ]
  const penaltyKillUnits: PlayerId[][] = [
    [forwards[2][1], forwards[2][0], ...defensePairs[0]],
    [forwards[3][1], forwards[3][2], ...defensePairs[1]]
  ]

  return { forwards, defensePairs, goalies: goalieIds, powerPlayUnits, penaltyKillUnits }
}

/** Circle-method round robin: returns rounds, each a list of [home, away]. */
function roundRobin(ids: TeamId[]): [TeamId, TeamId][][] {
  const arr = [...ids]
  const n = arr.length
  const rounds: [TeamId, TeamId][][] = []
  for (let r = 0; r < n - 1; r++) {
    const round: [TeamId, TeamId][] = []
    for (let i = 0; i < n / 2; i++) {
      round.push([arr[i], arr[n - 1 - i]])
    }
    rounds.push(round)
    // Rotate everything except the first element.
    arr.splice(1, 0, arr.pop() as TeamId)
  }
  return rounds
}

/** Balanced circle-method schedule; exported so season rollover can rebuild it. */
export function buildSchedule(teamIds: TeamId[], roundRobins: number, season: number): ScheduledGame[] {
  const games: ScheduledGame[] = []
  let day = 0
  let gameNum = 0
  for (let rr = 0; rr < roundRobins; rr++) {
    const rounds = roundRobin(teamIds)
    for (const round of rounds) {
      // Stagger each round across TWO match days so not every club plays on the
      // same night — realistic off-days + a longer (≈8-month) season span. The
      // game-id ORDER is unchanged (ids still map to the same matchups), so game
      // seeds/results/totals are byte-identical — only the calendar spread changes.
      const half = Math.ceil(round.length / 2)
      round.forEach(([a, b], i) => {
        const [home, away] = rr % 2 === 0 ? [a, b] : [b, a]
        games.push({
          id: asGameId(`g${gameNum++}`),
          season,
          day: day + (i < half ? 1 : 2),
          homeTeamId: home,
          awayTeamId: away,
          result: null
        })
      })
      day += 2
    }
  }
  return games
}

/** One team's conference/division membership, for weighted scheduling. */
export interface ScheduleTeam {
  id: TeamId
  conferenceId: string
  divisionId: string
}

export interface WeightedScheduleOptions {
  /** Meetings vs a division rival (default 4). */
  divMeetings?: number
  /** Meetings vs a same-conference, other-division team (default 3). */
  confMeetings?: number
  /** Meetings vs an other-conference team (default 2). */
  interMeetings?: number
  /** Calendar days to spread the season across (default 184 ≈ Oct–Apr). */
  seasonDays?: number
}

/**
 * Realistic NHL-style weighted schedule: teams play division rivals most often,
 * same-conference clubs next, and the other conference least — ≈82 games with the
 * default 4/3/2 weighting (e.g. a 2×2×8 league → 28+24+32 = 84 per team). Each
 * pairing's meetings are spread evenly across the calendar; home/away is balanced
 * per pair (odd counts alternate the extra home game so team totals stay even).
 *
 * Deterministic — no Rng. Falls back gracefully for any conference/division shape.
 */
export function buildWeightedSchedule(
  teams: ScheduleTeam[],
  season: number,
  opts: WeightedScheduleOptions = {},
): ScheduledGame[] {
  const divM = opts.divMeetings ?? 4
  const confM = opts.confMeetings ?? 3
  const interM = opts.interMeetings ?? 2
  const seasonDays = opts.seasonDays ?? 184

  // 1. Build pairings with meeting count + home/away split. For odd counts the
  //    "extra home" alternates per bucket so each team's home total stays even.
  interface PlannedGame { home: TeamId; away: TeamId; targetDay: number }
  const planned: PlannedGame[] = []
  // Track each team's running home−away balance so the odd "extra home" in
  // odd-meeting pairs goes to whoever is currently more away-heavy.
  const net = new Map<string, number>() // + = home-heavy
  const bump = (id: string, d: number): void => net.set(id, (net.get(id) ?? 0) + d)
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i]!, b = teams[j]!
      const meetings =
        a.divisionId === b.divisionId ? divM
        : a.conferenceId === b.conferenceId ? confM
        : interM
      if (meetings <= 0) continue
      // Base split: floor(m/2) home each (net-neutral). The odd one goes to the
      // currently more away-heavy team so league-wide home/away stays even.
      let aHome = Math.floor(meetings / 2)
      if (meetings % 2 === 1) {
        const aNet = net.get(a.id as string) ?? 0
        const bNet = net.get(b.id as string) ?? 0
        if (aNet <= bNet) { aHome++; bump(a.id as string, 1); bump(b.id as string, -1) }
        else { bump(b.id as string, 1); bump(a.id as string, -1) }
      }
      for (let k = 0; k < meetings; k++) {
        const aHosts = k < aHome
        const home = aHosts ? a.id : b.id
        const away = aHosts ? b.id : a.id
        const targetDay = Math.max(1, Math.round(((k + 0.5) / meetings) * seasonDays))
        planned.push({ home, away, targetDay })
      }
    }
  }

  // 2. Assign each game to a day near its target where neither team already
  //    plays and the day isn't over capacity — searching outward from target.
  const total = planned.length
  const perDayCap = Math.max(4, Math.ceil(total / seasonDays) + 2)
  const busy = new Map<number, Set<string>>()
  const countOnDay = new Map<number, number>()
  const free = (d: number, h: TeamId, w: TeamId): boolean => {
    const s = busy.get(d)
    if (s && (s.has(h as string) || s.has(w as string))) return false
    return (countOnDay.get(d) ?? 0) < perDayCap
  }
  planned.sort((x, y) => x.targetDay - y.targetDay)
  const placed: Array<{ home: TeamId; away: TeamId; day: number }> = []
  for (const g of planned) {
    let day = g.targetDay
    for (let step = 0; step < seasonDays * 2 + 50; step++) {
      const d = step === 0 ? g.targetDay : g.targetDay + (step % 2 === 1 ? (step + 1) / 2 : -(step / 2))
      if (d >= 1 && free(d, g.home, g.away)) { day = d; break }
    }
    let s = busy.get(day); if (!s) { s = new Set(); busy.set(day, s) }
    s.add(g.home as string); s.add(g.away as string)
    countOnDay.set(day, (countOnDay.get(day) ?? 0) + 1)
    placed.push({ home: g.home, away: g.away, day })
  }

  // 3. Emit in (day, then stable) order with sequential ids.
  placed.sort((x, y) => x.day - y.day || (x.home as string).localeCompare(y.home as string))
  return placed.map((g, i) => ({
    id: asGameId(`g${i}`),
    season,
    day: g.day,
    homeTeamId: g.home,
    awayTeamId: g.away,
    result: null,
  }))
}

export const freshStanding = (teamId: TeamId): Standing => ({
  teamId,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  overtimeLosses: 0,
  points: 0,
  goalsFor: 0,
  goalsAgainst: 0
})

/** Alias kept internal for callers that already used emptyStanding. */
const emptyStanding = freshStanding

export function generateLeague(opts: GenerateOptions): LeagueData {
  const {
    seed,
    teamCount = 16,
    forwardsPerTeam = 14,
    defensePerTeam = 7,
    goaliesPerTeam = 2,
    roundRobins = 4,
    startYear = 2025,
    leagueName = 'Continental Hockey League'
  } = opts

  if (teamCount % 2 !== 0 || teamCount < 4) {
    throw new Error(`teamCount must be even and ≥ 4, got ${teamCount}`)
  }
  if (teamCount > FRANCHISES.length) {
    throw new Error(`only ${FRANCHISES.length} franchises defined; need ${teamCount}`)
  }

  const rng = new Rng(seed)

  const players = new Map<PlayerId, Player>()
  const teams = new Map<TeamId, Team>()
  let playerNum = 0

  // Conferences / divisions: 2 conferences, 2 divisions each (4 total) when the
  // team count divides cleanly; otherwise fall back to a single bucket.
  const divisionCount = teamCount % 4 === 0 ? 4 : 2
  const teamsPerDivision = teamCount / divisionCount
  const divisions: Division[] = []
  const conferences: Conference[] = []
  const conferenceCount = divisionCount >= 2 ? 2 : 1
  const divisionsPerConference = divisionCount / conferenceCount

  for (let d = 0; d < divisionCount; d++) {
    divisions.push({ id: `div${d}`, name: DIVISION_NAMES[d] ?? `Division ${d + 1}`, teamIds: [] })
  }
  for (let c = 0; c < conferenceCount; c++) {
    const divIds = divisions
      .slice(c * divisionsPerConference, (c + 1) * divisionsPerConference)
      .map((dv) => dv.id)
    conferences.push({ id: `conf${c}`, name: CONFERENCE_NAMES[c] ?? `Conference ${c + 1}`, divisionIds: divIds })
  }

  const teamIds: TeamId[] = []
  for (let t = 0; t < teamCount; t++) {
    const teamId = asTeamId(`t${t}`)
    teamIds.push(teamId)
    const franchise = FRANCHISES[t]
    const divisionIndex = Math.floor(t / teamsPerDivision)
    const division = divisions[divisionIndex]
    division.teamIds.push(teamId)
    const conference = conferences.find((cf) => cf.divisionIds.includes(division.id))!

    // Each team gets a caliber baseline so the league has contenders & cellar
    // dwellers rather than 16 identical rosters.
    const teamCaliber = clampRating(rng.normal(55, 5))

    const roster: Player[] = []
    // Forwards: ~⅓ centers, rest wingers.
    const centerCount = Math.max(4, Math.round(forwardsPerTeam / 3))
    for (let i = 0; i < forwardsPerTeam; i++) {
      const pos: Position = i < centerCount ? 'C' : 'W'
      const p = makePlayer(rng, asPlayerId(`p${playerNum++}`), pos, teamCaliber, startYear)
      roster.push(p)
      players.set(p.id, p)
    }
    for (let i = 0; i < defensePerTeam; i++) {
      const p = makePlayer(rng, asPlayerId(`p${playerNum++}`), 'D', teamCaliber, startYear)
      roster.push(p)
      players.set(p.id, p)
    }
    for (let i = 0; i < goaliesPerTeam; i++) {
      const p = makePlayer(rng, asPlayerId(`p${playerNum++}`), 'G', teamCaliber, startYear)
      // Demote the second goalie's role label.
      if (i > 0) p.role = 'backup'
      roster.push(p)
      players.set(p.id, p)
    }

    const lines = buildLines(roster)
    const team: Team = {
      id: teamId,
      name: `${franchise.city} ${franchise.nickname}`,
      abbreviation: franchise.abbreviation,
      city: franchise.city,
      colors: { primary: franchise.primary, secondary: franchise.secondary },
      conferenceId: conference.id,
      divisionId: division.id,
      roster: roster.map((p) => p.id),
      lines,
      tactics: structuredClone(DEFAULT_TACTICS),
      finances: { budget: 90e6, salaryCap: 88e6, capUsed: 0, revenue: 0 },
      staff: { headCoachId: null, assistantCoachIds: [], scoutIds: [] }
    }
    // Tally cap used from the generated contracts.
    team.finances.capUsed = roster.reduce((s, p) => s + p.contract.salary, 0)
    teams.set(teamId, team)
  }

  const schedule = buildSchedule(teamIds, roundRobins, startYear)

  // Capture NHL player ids BEFORE AHL generation so league.players stays NHL-only.
  const nhlPlayerIds = [...players.keys()]

  // ─── AHL Affiliate Generation ─────────────────────────────────────────────
  // CRITICAL: All NHL content above is generated FIRST with `rng` to preserve
  // existing RNG draws. AHL content uses a SEPARATE Rng seeded from
  // `seed ^ 0xAHL_SEED` so adding affiliates never perturbs the NHL stream.
  // AHL teams/players use ids starting beyond the NHL namespace to avoid
  // collisions: teamIds like `ahl-t0`, playerIds like `ahl-p0`.

  const ahlRng = new Rng((seed ^ 0xa410) >>> 0)

  // Minor-league city/nickname pairs — one per NHL team slot, in generation order.
  // Pattern: fictional minor-league city near the parent's region.
  const AHL_FRANCHISES: readonly { city: string; nickname: string; abbreviation: string }[] = [
    { city: 'Riverside Valley', nickname: 'Rapids', abbreviation: 'RVA' },
    { city: 'Granite Hills', nickname: 'Miners', abbreviation: 'GRH' },
    { city: 'Cedarwood', nickname: 'Loggers', abbreviation: 'CDW' },
    { city: 'Port Haven', nickname: 'Clippers', abbreviation: 'PHC' },
    { city: 'Summit Lake', nickname: 'Eagles', abbreviation: 'SML' },
    { city: 'Ironside', nickname: 'Steel', abbreviation: 'IRS' },
    { city: 'Aurora Falls', nickname: 'Lights', abbreviation: 'AUF' },
    { city: 'Maple Valley', nickname: 'Wolves', abbreviation: 'MPV' },
    { city: 'Bayshore', nickname: 'Gulls', abbreviation: 'BYS' },
    { city: 'Frostburg', nickname: 'Bears', abbreviation: 'FBG' },
    { city: 'Capitol Pines', nickname: 'Guards', abbreviation: 'CPG' },
    { city: 'Thunder Ridge', nickname: 'Bolts', abbreviation: 'TRB' },
    { city: 'Silver Creek', nickname: 'Foxes', abbreviation: 'SLC' },
    { city: 'Harborview', nickname: 'Seals', abbreviation: 'HBV' },
    { city: 'Birch Falls', nickname: 'Moose', abbreviation: 'BIF' },
    { city: 'Crystal Cove', nickname: 'Rays', abbreviation: 'CYC' },
  ]

  // AHL rosters: fewer players than NHL, lower CA, include young high-potential
  // prospects to make call-up decisions meaningful.
  const AHL_FORWARDS = 12
  const AHL_DEFENSE = 6
  const AHL_GOALIES = 2
  const AHL_TOTAL = AHL_FORWARDS + AHL_DEFENSE + AHL_GOALIES

  const ahlTeamIds: TeamId[] = []
  let ahlPlayerNum = 0
  let ahlTeamNum = 0

  for (let t = 0; t < teamCount; t++) {
    const nhlTeamId = teamIds[t]
    const nhlTeam = teams.get(nhlTeamId)!
    const ahlFranchise = AHL_FRANCHISES[t % AHL_FRANCHISES.length]

    // AHL team caliber is meaningfully lower than NHL to distinguish tiers.
    const ahlTeamCaliber = clampRating(ahlRng.normal(42, 6))

    const ahlTeamId = asTeamId(`ahl-t${ahlTeamNum++}`)
    ahlTeamIds.push(ahlTeamId)

    // Link NHL team to its affiliate (mutate the already-stored NHL team).
    nhlTeam.affiliateId = ahlTeamId

    const ahlRoster: Player[] = []

    // Build AHL roster: mix of depth players (lower caliber) and young prospects
    // (low current rating but high potential — these are the interesting call-up candidates).
    const prospectSlots = Math.round(AHL_TOTAL * 0.35) // ~35% are genuine prospects
    for (let i = 0; i < AHL_FORWARDS; i++) {
      const pos: Position = i < Math.max(3, Math.round(AHL_FORWARDS / 3)) ? 'C' : 'W'
      const isProspect = i < Math.round(prospectSlots * (AHL_FORWARDS / AHL_TOTAL))
      const p = makeAhlPlayer(ahlRng, asPlayerId(`ahl-p${ahlPlayerNum++}`), pos, ahlTeamCaliber, startYear, isProspect)
      ahlRoster.push(p)
      players.set(p.id, p)
    }
    for (let i = 0; i < AHL_DEFENSE; i++) {
      const isProspect = i < Math.round(prospectSlots * (AHL_DEFENSE / AHL_TOTAL))
      const p = makeAhlPlayer(ahlRng, asPlayerId(`ahl-p${ahlPlayerNum++}`), 'D', ahlTeamCaliber, startYear, isProspect)
      ahlRoster.push(p)
      players.set(p.id, p)
    }
    for (let i = 0; i < AHL_GOALIES; i++) {
      const p = makeAhlPlayer(ahlRng, asPlayerId(`ahl-p${ahlPlayerNum++}`), 'G', ahlTeamCaliber, startYear, false)
      if (i > 0) p.role = 'backup'
      ahlRoster.push(p)
      players.set(p.id, p)
    }

    const ahlLines = buildLines(ahlRoster)

    // AHL-level finances: minor-league budget, no NHL cap relevance.
    const ahlCapUsed = ahlRoster.reduce((s, p) => s + p.contract.salary, 0)

    // Colors: slightly shift the parent's palette so they look related but distinct.
    const ahlPrimary = nhlTeam.colors.secondary
    const ahlSecondary = nhlTeam.colors.primary

    const ahlTeam: Team = {
      id: ahlTeamId,
      name: `${ahlFranchise.city} ${ahlFranchise.nickname}`,
      abbreviation: ahlFranchise.abbreviation,
      city: ahlFranchise.city,
      colors: { primary: ahlPrimary, secondary: ahlSecondary },
      // AHL teams get a single shared AHL division/conference that does NOT
      // collide with NHL conference/division ids (which are conf0/conf1, div0-div3).
      conferenceId: 'ahl-conf',
      divisionId: 'ahl-div',
      roster: ahlRoster.map((p) => p.id),
      lines: ahlLines,
      tactics: structuredClone(DEFAULT_TACTICS),
      finances: { budget: 12e6, salaryCap: 88e6, capUsed: ahlCapUsed, revenue: 0 },
      staff: { headCoachId: null, assistantCoachIds: [], scoutIds: [] },
      tier: 'ahl',
      parentTeamId: nhlTeamId,
    }

    teams.set(ahlTeamId, ahlTeam)
  }

  // AHL schedule: single round-robin (fewer games than NHL — minor-league pace).
  const ahlSchedule = buildSchedule(ahlTeamIds, 2, startYear)
  // AHL standings: one fresh row per affiliate.
  const ahlStandings = ahlTeamIds.map(freshStanding)
  // ─── End AHL Generation ───────────────────────────────────────────────────

  const league: League = {
    id: asLeagueId('lg0'),
    name: leagueName,
    conferences,
    divisions,
    teams: teamIds,
    // NHL players only — AHL players are on AHL team rosters, not in this list.
    players: nhlPlayerIds,
    schedule,
    draftClasses: [],
    season: {
      year: startYear,
      standings: teamIds.map(emptyStanding),
      news: []
    },
    ahlTeams: ahlTeamIds,
    ahlSchedule,
    ahlStandings,
  }

  return { league, teams, players }
}

/**
 * Generate an AHL-tier player. Prospects have lower current ability but
 * significantly higher potential — making call-up decisions meaningful.
 */
function makeAhlPlayer(
  rng: Rng,
  id: PlayerId,
  position: Position,
  teamCaliber: number,
  startYear: number,
  isProspect: boolean
): Player {
  // Prospects: young (18–23), lower current caliber, high potential ceiling.
  // Depth players: typical AHL veteran range.
  const age = isProspect
    ? Math.round(Math.min(23, Math.max(18, rng.normal(20, 1.5))))
    : Math.round(Math.min(35, Math.max(21, rng.normal(26, 4))))

  const currentCaliber = isProspect
    ? clampRating(rng.normal(teamCaliber - 8, 5)) // raw, unpolished
    : clampRating(rng.normal(teamCaliber, 6))

  const raw = makeRawAttributes(rng, currentCaliber, position)
  const role: PlayerRole =
    position === 'G'
      ? 'starter'
      : position === 'D'
        ? rng.pick(DEFENSE_ROLES)
        : weightedRole(rng, FORWARD_ROLES, FORWARD_ROLE_WEIGHTS)
  const composites = computeComposites(raw, role, position)
  const ovr = overall(composites, position)

  // Prospects: potential can reach NHL-quality caliber (55–80+).
  // Depth veterans: potential is close to current.
  const potential = isProspect
    ? makePotentialAhl(rng, raw, age, rng.float(55, 82))
    : makePotential(rng, raw, age)

  return {
    id,
    name: makeName(rng),
    age,
    position,
    handedness: rng.chance(0.65) ? 'L' : 'R',
    role,
    ratings: raw,
    potential,
    composites,
    personality: makePersonality(rng),
    contract: makeAhlContract(rng, ovr, startYear),
    stats: [],
    fatigue: 0,
    morale: rng.range(50, 80),
    injuryStatus: null,
    form: 0,
  }
}

/**
 * Potential for a prospect: ceiling is driven by a target overall rather than
 * purely age-based headroom, so young AHL prospects can develop into NHL players.
 */
function makePotentialAhl(rng: Rng, current: RawAttributes, age: number, targetOverall: number): RawAttributes {
  // Compute how much bump is needed to reach targetOverall.
  const ageRoom = Math.max(0, 26 - age)
  const bump = (v: number): number => clampRating(v + rng.float(ageRoom * 0.3, Math.max(ageRoom * 0.3, targetOverall - 40)))
  const bumpGroup = <T extends object>(g: T): T =>
    Object.fromEntries(Object.entries(g).map(([k, v]) => [k, bump(v as number)])) as T
  const pot: RawAttributes = {
    technical: bumpGroup(current.technical),
    physical: bumpGroup(current.physical),
    mental: bumpGroup(current.mental),
    defensive: bumpGroup(current.defensive),
  }
  if (current.goalie) pot.goalie = bumpGroup(current.goalie)
  return pot
}

/**
 * AHL contracts: two-way deals, much lower salary (minor-league scale).
 */
function makeAhlContract(rng: Rng, ovr: number, startYear: number): Contract {
  // AHL-level salary: $70k–$750k range.
  const base = 0.07 + Math.pow(Math.max(0, ovr - 40) / 50, 2) * 0.68
  const salary = Math.round(base * 1e6)
  const years = rng.range(1, 3)
  return {
    salary,
    yearsRemaining: years,
    expiryYear: startYear + years,
    noTradeClause: false,
    twoWay: true,
  }
}
