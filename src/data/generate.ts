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
      day++
      for (const [a, b] of round) {
        // Alternate home/away each round-robin so the slate stays balanced.
        const [home, away] = rr % 2 === 0 ? [a, b] : [b, a]
        games.push({
          id: asGameId(`g${gameNum++}`),
          season,
          day,
          homeTeamId: home,
          awayTeamId: away,
          result: null
        })
      }
    }
  }
  return games
}

const emptyStanding = (teamId: TeamId): Standing => ({
  teamId,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  overtimeLosses: 0,
  points: 0,
  goalsFor: 0,
  goalsAgainst: 0
})

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

  const league: League = {
    id: asLeagueId('lg0'),
    name: leagueName,
    conferences,
    divisions,
    teams: teamIds,
    players: [...players.keys()],
    schedule,
    draftClasses: [],
    season: {
      year: startYear,
      standings: teamIds.map(emptyStanding),
      news: []
    }
  }

  return { league, teams, players }
}
