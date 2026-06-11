/**
 * Mod database format, validator, and loader.
 *
 * Community mods ship real-roster data as a self-contained JSON file that this
 * module loads into a sim-ready LeagueData. The game itself never ships real
 * player/team data (legal requirement — see docs/DATA-SOURCES.md and MODDING.md).
 *
 * Format version: 1
 *
 * JSON file layout:
 *   { formatVersion: 1, meta: {...}, conferences: [...] }
 *
 * See MODDING.md for the full documented schema with a worked example.
 */

import {
  asGameId,
  asLeagueId,
  asPlayerId,
  asTeamId,
  type Conference,
  type Contract,
  type Division,
  type GoalieAttributes,
  type League,
  type Lines,
  type Personality,
  type Player,
  type PlayerId,
  type RawAttributes,
  type ScheduledGame,
  type Standing,
  type Team,
  type TeamId
} from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import type { PlayerRole } from '@domain'
import { buildSchedule } from './generate'
import type { LeagueData } from './generate'

/* ─────────────────────────── Public schema types ─────────────────────────── */

/**
 * Flat attribute map accepted in ModPlayer.attributes.
 * All keys are optional overrides; omitted keys are synthesised from `overall`.
 */
export interface ModPlayerAttributes {
  // Technical
  wristShot?: number
  slapShot?: number
  stickhandling?: number
  passing?: number
  deflections?: number
  faceoffs?: number
  // Physical
  speed?: number
  acceleration?: number
  strength?: number
  balance?: number
  stamina?: number
  agility?: number
  height?: number
  // Mental
  offensiveIQ?: number
  defensiveIQ?: number
  positioning?: number
  vision?: number
  aggression?: number
  composure?: number
  workRate?: number
  discipline?: number
  anticipation?: number
  // Defensive
  checking?: number
  shotBlocking?: number
  stickChecking?: number
  takeaway?: number
  // Goalie
  reflexes?: number
  positioningG?: number
  reboundControl?: number
  glove?: number
  blocker?: number
  recovery?: number
  puckHandlingG?: number
}

export interface ModContract {
  /** Annual salary in dollars (e.g. 5_000_000). */
  salary: number
  years: number
}

export interface ModPlayer {
  /**
   * Mod-stable external key used to cross-reference between databases, e.g.
   * "nhl-8478402". Must be unique within the mod.
   */
  externalId: string
  name: string
  /** Age at season start. Must be 16–45. */
  age: number
  position: 'C' | 'W' | 'D' | 'G'
  handedness: 'L' | 'R'
  /** Optional facepack image key resolved to faces/<faceId>.png. */
  faceId?: string
  /**
   * Single 1–99 shorthand overall. When provided without `attributes`, the
   * loader synthesises a coherent RawAttributes spread centred on this value.
   * When `attributes` is also present, individual overrides are applied on top.
   */
  overall?: number
  /**
   * Optional flat per-attribute overrides (1–99 each). Keys that are omitted
   * are synthesised from `overall` (or 50 if `overall` is also absent).
   */
  attributes?: ModPlayerAttributes
  /**
   * Potential ceiling as a 1–99 overall. Omitted = synthesised from age
   * and overall (younger players get more headroom).
   */
  potential?: number
  contract?: ModContract
}

export interface ModTeam {
  /**
   * Mod-stable external key, e.g. "nhl-team-10". Must be unique within the
   * mod.
   */
  externalId: string
  city: string
  nickname: string
  abbreviation: string
  /** Primary jersey color as '#RRGGBB'. */
  primary: string
  /** Secondary jersey color as '#RRGGBB'. */
  secondary: string
  /** Optional logo image key resolved to logos/<logoId>.png. */
  logoId?: string
  /** Must include >= 17 skaters (C/W/D combined) and >= 2 goalies. */
  players: ModPlayer[]
}

export interface ModDivision {
  name: string
  teams: ModTeam[]
}

export interface ModConference {
  name: string
  divisions: ModDivision[]
}

export interface ModMeta {
  name: string
  author?: string
  /** Season label for display, e.g. "2024-25". */
  season?: string
}

/**
 * Top-level mod database. Serialise as JSON with formatVersion: 1.
 *
 * Structural requirements:
 *  - Total team count must be even and >= 4.
 *  - Each team must have >= 17 skaters (C + W + D) and >= 2 goalies.
 *  - Colors must be valid '#RRGGBB' hex strings.
 *  - All per-attribute overrides must be in 1–99.
 *  - age must be 16–45.
 */
export interface ModDatabase {
  formatVersion: 1
  meta: ModMeta
  conferences: ModConference[]
}

/* ─────────────────────────── Validation ─────────────────────────── */

/** Parse a '#RRGGBB' string to a 0xRRGGBB integer, or return null. */
function parseColor(s: string): number | null {
  if (typeof s !== 'string') return null
  const m = /^#([0-9a-fA-F]{6})$/.exec(s.trim())
  if (!m) return null
  return parseInt(m[1], 16)
}

function fail(msg: string): never {
  throw new Error(`ModDatabase validation error: ${msg}`)
}

function assertString(v: unknown, path: string): asserts v is string {
  if (typeof v !== 'string' || v.trim() === '') fail(`${path} must be a non-empty string`)
}

function assertNumber(v: unknown, path: string): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path} must be a finite number`)
}

function assertArray(v: unknown, path: string): asserts v is unknown[] {
  if (!Array.isArray(v)) fail(`${path} must be an array`)
}

function assertObject(v: unknown, path: string): asserts v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    fail(`${path} must be an object`)
}

const VALID_POSITIONS = new Set(['C', 'W', 'D', 'G'])
const VALID_HANDEDNESS = new Set(['L', 'R'])
const ATTR_KEYS = new Set<string>([
  'wristShot', 'slapShot', 'stickhandling', 'passing', 'deflections', 'faceoffs',
  'speed', 'acceleration', 'strength', 'balance', 'stamina', 'agility', 'height',
  'offensiveIQ', 'defensiveIQ', 'positioning', 'vision', 'aggression', 'composure',
  'workRate', 'discipline', 'anticipation',
  'checking', 'shotBlocking', 'stickChecking', 'takeaway',
  'reflexes', 'positioningG', 'reboundControl', 'glove', 'blocker', 'recovery', 'puckHandlingG'
])

function validatePlayer(raw: unknown, path: string): ModPlayer {
  assertObject(raw, path)
  const r = raw as Record<string, unknown>

  assertString(r['externalId'], `${path}.externalId`)
  assertString(r['name'], `${path}.name`)
  assertNumber(r['age'], `${path}.age`)
  if ((r['age'] as number) < 16 || (r['age'] as number) > 45)
    fail(`${path}.age must be 16–45, got ${r['age']}`)

  if (!VALID_POSITIONS.has(r['position'] as string))
    fail(`${path}.position must be C | W | D | G, got ${JSON.stringify(r['position'])}`)
  if (!VALID_HANDEDNESS.has(r['handedness'] as string))
    fail(`${path}.handedness must be L | R, got ${JSON.stringify(r['handedness'])}`)

  if (r['faceId'] !== undefined) assertString(r['faceId'], `${path}.faceId`)

  if (r['overall'] !== undefined) {
    assertNumber(r['overall'], `${path}.overall`)
    const ovr = r['overall'] as number
    if (ovr < 1 || ovr > 99) fail(`${path}.overall must be 1–99, got ${ovr}`)
  }

  if (r['potential'] !== undefined) {
    assertNumber(r['potential'], `${path}.potential`)
    const pot = r['potential'] as number
    if (pot < 1 || pot > 99) fail(`${path}.potential must be 1–99, got ${pot}`)
  }

  if (r['attributes'] !== undefined) {
    assertObject(r['attributes'], `${path}.attributes`)
    for (const [k, v] of Object.entries(r['attributes'] as Record<string, unknown>)) {
      if (!ATTR_KEYS.has(k)) fail(`${path}.attributes: unknown key "${k}"`)
      assertNumber(v, `${path}.attributes.${k}`)
      const n = v as number
      if (n < 1 || n > 99) fail(`${path}.attributes.${k} must be 1–99, got ${n}`)
    }
  }

  if (r['contract'] !== undefined) {
    assertObject(r['contract'], `${path}.contract`)
    const c = r['contract'] as Record<string, unknown>
    assertNumber(c['salary'], `${path}.contract.salary`)
    assertNumber(c['years'], `${path}.contract.years`)
    if ((c['years'] as number) < 1 || (c['years'] as number) > 8)
      fail(`${path}.contract.years must be 1–8, got ${c['years']}`)
  }

  return r as unknown as ModPlayer
}

function validateTeam(raw: unknown, path: string): ModTeam {
  assertObject(raw, path)
  const r = raw as Record<string, unknown>

  assertString(r['externalId'], `${path}.externalId`)
  assertString(r['city'], `${path}.city`)
  assertString(r['nickname'], `${path}.nickname`)
  assertString(r['abbreviation'], `${path}.abbreviation`)
  if ((r['abbreviation'] as string).length !== 3)
    fail(`${path}.abbreviation must be exactly 3 characters, got "${r['abbreviation']}"`)

  assertString(r['primary'], `${path}.primary`)
  if (parseColor(r['primary'] as string) === null)
    fail(`${path}.primary must be a '#RRGGBB' hex color, got "${r['primary']}"`)

  assertString(r['secondary'], `${path}.secondary`)
  if (parseColor(r['secondary'] as string) === null)
    fail(`${path}.secondary must be a '#RRGGBB' hex color, got "${r['secondary']}"`)

  if (r['logoId'] !== undefined) assertString(r['logoId'], `${path}.logoId`)

  assertArray(r['players'], `${path}.players`)
  const players: ModPlayer[] = (r['players'] as unknown[]).map((p, i) =>
    validatePlayer(p, `${path}.players[${i}]`)
  )

  // Roster minimums: >= 17 skaters + >= 2 goalies.
  const skaters = players.filter((p) => p.position !== 'G')
  const goalies = players.filter((p) => p.position === 'G')
  if (skaters.length < 17)
    fail(`${path} must have at least 17 skaters (C/W/D), found ${skaters.length}`)
  if (goalies.length < 2)
    fail(`${path} must have at least 2 goalies, found ${goalies.length}`)

  // Check for duplicate externalIds within team.
  const seen = new Set<string>()
  for (const p of players) {
    if (seen.has(p.externalId))
      fail(`${path}: duplicate player externalId "${p.externalId}"`)
    seen.add(p.externalId)
  }

  return { ...r, players } as ModTeam
}

/**
 * Validate an unknown value as a ModDatabase.
 *
 * Throws a descriptive Error on any structural or semantic violation.
 * Returns a typed ModDatabase on success.
 */
export function validateModDatabase(x: unknown): ModDatabase {
  assertObject(x, 'ModDatabase')
  const r = x as Record<string, unknown>

  if (r['formatVersion'] !== 1)
    fail(`formatVersion must be 1, got ${JSON.stringify(r['formatVersion'])}`)

  assertObject(r['meta'], 'ModDatabase.meta')
  const meta = r['meta'] as Record<string, unknown>
  assertString(meta['name'], 'ModDatabase.meta.name')
  if (meta['author'] !== undefined) assertString(meta['author'], 'ModDatabase.meta.author')
  if (meta['season'] !== undefined) assertString(meta['season'], 'ModDatabase.meta.season')

  assertArray(r['conferences'], 'ModDatabase.conferences')
  const rawConfs = r['conferences'] as unknown[]
  if (rawConfs.length === 0) fail('conferences must not be empty')

  const conferences: ModConference[] = rawConfs.map((conf, ci) => {
    const cPath = `conferences[${ci}]`
    assertObject(conf, cPath)
    const c = conf as Record<string, unknown>
    assertString(c['name'], `${cPath}.name`)
    assertArray(c['divisions'], `${cPath}.divisions`)
    const rawDivs = c['divisions'] as unknown[]
    if (rawDivs.length === 0) fail(`${cPath}.divisions must not be empty`)
    const divisions: ModDivision[] = rawDivs.map((div, di) => {
      const dPath = `${cPath}.divisions[${di}]`
      assertObject(div, dPath)
      const d = div as Record<string, unknown>
      assertString(d['name'], `${dPath}.name`)
      assertArray(d['teams'], `${dPath}.teams`)
      const teams: ModTeam[] = (d['teams'] as unknown[]).map((t, ti) =>
        validateTeam(t, `${dPath}.teams[${ti}]`)
      )
      return { name: d['name'] as string, teams }
    })
    return { name: c['name'] as string, divisions }
  })

  // Count total teams.
  let totalTeams = 0
  for (const conf of conferences) {
    for (const div of conf.divisions) {
      totalTeams += div.teams.length
    }
  }
  if (totalTeams < 4) fail(`total team count must be >= 4, found ${totalTeams}`)
  if (totalTeams % 2 !== 0) fail(`total team count must be even, found ${totalTeams}`)

  // Check for duplicate team externalIds across the whole mod.
  const teamIds = new Set<string>()
  for (const conf of conferences) {
    for (const div of conf.divisions) {
      for (const team of div.teams) {
        if (teamIds.has(team.externalId))
          fail(`duplicate team externalId "${team.externalId}"`)
        teamIds.add(team.externalId)
      }
    }
  }

  return {
    formatVersion: 1,
    meta: {
      name: meta['name'] as string,
      ...(meta['author'] !== undefined ? { author: meta['author'] as string } : {}),
      ...(meta['season'] !== undefined ? { season: meta['season'] as string } : {})
    },
    conferences
  }
}

/* ─────────────────────────── Loader ─────────────────────────── */

export interface LoadModOptions {
  seed: number
  /**
   * Calendar year the season starts. Defaults to 2025.
   * Carries forward into contract expiry years and schedule generation.
   */
  startYear?: number
  /**
   * Number of full round-robins for the schedule. Each round-robin plays each
   * team pair once; default 4 (= 60 games per team in a 16-team league).
   */
  roundRobins?: number
}

const FORWARD_ROLES: PlayerRole[] = ['sniper', 'playmaker', 'twoWay', 'powerForward', 'enforcer']
const FORWARD_ROLE_WEIGHTS = [3, 3, 3, 2, 1]
const DEFENSE_ROLES: PlayerRole[] = ['offensiveD', 'shutdownD', 'stayAtHomeD']

function pickWeightedRole(rng: Rng, roles: PlayerRole[], weights: number[]): PlayerRole {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.float(0, total)
  for (let i = 0; i < roles.length; i++) {
    r -= weights[i]
    if (r <= 0) return roles[i]
  }
  return roles[roles.length - 1]
}

const clampAttr = (v: number): number => Math.round(v < 1 ? 1 : v > 99 ? 99 : v)

/**
 * Synthesise a RawAttributes object centred on `caliber`, with optional
 * per-attribute overrides applied on top. Mirrors the spirit of generate.ts's
 * makeRawAttributes but is self-contained here so generate.ts is never touched.
 */
function synthesiseAttributes(
  rng: Rng,
  caliber: number,
  position: 'C' | 'W' | 'D' | 'G',
  overrides: ModPlayerAttributes = {}
): RawAttributes {
  const a = (base: number, spread = 7): number =>
    clampAttr(rng.normal(base, spread))

  const pick = (key: keyof ModPlayerAttributes, base: number, spread = 7): number =>
    overrides[key] !== undefined ? (overrides[key] as number) : a(base, spread)

  const raw: RawAttributes = {
    technical: {
      wristShot: pick('wristShot', caliber),
      slapShot: pick('slapShot', caliber),
      stickhandling: pick('stickhandling', caliber),
      passing: pick('passing', caliber),
      deflections: pick('deflections', caliber),
      faceoffs: pick('faceoffs', position === 'C' ? caliber + 5 : caliber - 10)
    },
    physical: {
      speed: pick('speed', caliber),
      acceleration: pick('acceleration', caliber),
      strength: pick('strength', caliber),
      balance: pick('balance', caliber),
      stamina: pick('stamina', caliber),
      agility: pick('agility', caliber),
      height: pick('height', 50, 15)
    },
    mental: {
      offensiveIQ: pick('offensiveIQ', caliber),
      defensiveIQ: pick('defensiveIQ', caliber),
      positioning: pick('positioning', caliber),
      vision: pick('vision', caliber),
      aggression: pick('aggression', 50, 18),
      composure: pick('composure', caliber),
      workRate: pick('workRate', caliber),
      discipline: pick('discipline', 55, 18),
      anticipation: pick('anticipation', caliber)
    },
    defensive: {
      checking: pick('checking', caliber),
      shotBlocking: pick('shotBlocking', caliber),
      stickChecking: pick('stickChecking', caliber),
      takeaway: pick('takeaway', caliber)
    }
  }

  if (position === 'G') {
    const g: GoalieAttributes = {
      reflexes: pick('reflexes', caliber),
      positioningG: pick('positioningG', caliber),
      reboundControl: pick('reboundControl', caliber),
      glove: pick('glove', caliber),
      blocker: pick('blocker', caliber),
      recovery: pick('recovery', caliber),
      puckHandlingG: pick('puckHandlingG', caliber - 8)
    }
    raw.goalie = g
  }

  return raw
}

function synthesisePotential(
  rng: Rng,
  current: RawAttributes,
  age: number
): RawAttributes {
  const upsideRoom = Math.max(0, 26 - age)
  const bump = (v: number): number => clampAttr(v + rng.float(0, upsideRoom * 0.9))
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

function makeDefaultPersonality(rng: Rng): Personality {
  return {
    ambition: rng.range(1, 20),
    professionalism: rng.range(1, 20),
    loyalty: rng.range(1, 20),
    temperament: rng.range(1, 20),
    determination: rng.range(1, 20)
  }
}

/** Build forward lines, D pairs, goalie depth, and special-teams units. */
function buildLinesFromRoster(players: Player[]): Lines {
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
    const rw =
      wingers[line * 2 + 1] ?? wingers[wingers.length - 2] ?? wingers[wingers.length - 1]
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

const DEFAULT_TACTICS = {
  forecheck: '1-2-2' as const,
  dZoneCoverage: 'zone' as const,
  tempo: { pace: 0.5, passRisk: 0.5, shotEagerness: 0.5, defensivePinch: 0.4 },
  specialTeams: { powerPlay: 'umbrella' as const, penaltyKill: 'box' as const },
  lineMatching: false
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

/**
 * Load a validated ModDatabase into a fully sim-ready LeagueData.
 *
 * Player construction:
 *  - `overall` drives the caliber spread when synthesising attributes.
 *  - `attributes` per-key overrides are applied on top of the synthesised base.
 *  - `potential` overrides the synthesised ceiling; absent = age-derived headroom.
 *  - `contract` overrides salary/years; absent = generated from overall.
 *  - externalId and faceId are carried through to Player.
 *
 * The schedule is built via buildSchedule (exported from generate.ts) so it
 * uses the same circle-method round-robin the rest of the engine uses.
 *
 * All randomness flows through the seeded Rng — same seed always gives the
 * same LeagueData.
 */
export function loadModDatabase(mod: ModDatabase, opts: LoadModOptions): LeagueData {
  const { seed, startYear = 2025, roundRobins = 4 } = opts
  const rng = new Rng(seed)

  const players = new Map<PlayerId, Player>()
  const teams = new Map<TeamId, Team>()
  const conferences: Conference[] = []
  const divisions: Division[] = []
  const allTeamIds: TeamId[] = []

  let playerNum = 0
  let teamNum = 0
  let divNum = 0

  for (let ci = 0; ci < mod.conferences.length; ci++) {
    const modConf = mod.conferences[ci]
    const confDivIds: string[] = []

    for (let di = 0; di < modConf.divisions.length; di++) {
      const modDiv = modConf.divisions[di]
      const divId = `div${divNum++}`
      const divTeamIds: TeamId[] = []

      for (const modTeam of modDiv.teams) {
        const teamId = asTeamId(`t${teamNum++}`)
        divTeamIds.push(teamId)
        allTeamIds.push(teamId)

        const primaryColor = parseColor(modTeam.primary)!
        const secondaryColor = parseColor(modTeam.secondary)!

        const roster: Player[] = []

        for (const modPlayer of modTeam.players) {
          const playerId = asPlayerId(`p${playerNum++}`)
          const caliber = clampAttr(modPlayer.overall ?? 55)
          const raw = synthesiseAttributes(rng, caliber, modPlayer.position, modPlayer.attributes ?? {})

          const role: PlayerRole =
            modPlayer.position === 'G'
              ? 'starter'
              : modPlayer.position === 'D'
                ? rng.pick(DEFENSE_ROLES)
                : pickWeightedRole(rng, FORWARD_ROLES, FORWARD_ROLE_WEIGHTS)

          const composites = computeComposites(raw, role, modPlayer.position)
          const ovr = overall(composites, modPlayer.position)

          // Potential: mod-specified or synthesised from age.
          let potentialRaw: RawAttributes
          if (modPlayer.potential !== undefined) {
            // Build a synthetic attribute set centred on the mod's potential ceiling.
            potentialRaw = synthesiseAttributes(rng, modPlayer.potential, modPlayer.position, {})
          } else {
            potentialRaw = synthesisePotential(rng, raw, modPlayer.age)
          }

          // Contract: mod-specified or generated from overall.
          let contract: Contract
          if (modPlayer.contract) {
            contract = {
              salary: modPlayer.contract.salary,
              yearsRemaining: modPlayer.contract.years,
              expiryYear: startYear + modPlayer.contract.years,
              noTradeClause: ovr > 80 && rng.chance(0.4),
              twoWay: ovr < 55 && rng.chance(0.5)
            }
          } else {
            const base = 0.7 + Math.pow(Math.max(0, ovr - 45) / 45, 2.2) * 11
            const salary = Math.round(base * 1e6)
            const years = rng.range(1, 6)
            contract = {
              salary,
              yearsRemaining: years,
              expiryYear: startYear + years,
              noTradeClause: ovr > 80 && rng.chance(0.4),
              twoWay: ovr < 55 && rng.chance(0.5)
            }
          }

          const player: Player = {
            id: playerId,
            name: modPlayer.name,
            age: modPlayer.age,
            position: modPlayer.position,
            handedness: modPlayer.handedness,
            role,
            ratings: raw,
            potential: potentialRaw,
            composites,
            personality: makeDefaultPersonality(rng),
            contract,
            stats: [],
            fatigue: 0,
            morale: rng.range(50, 80),
            injuryStatus: null,
            form: 0,
            externalId: modPlayer.externalId,
            ...(modPlayer.faceId !== undefined ? { faceId: modPlayer.faceId } : {})
          }

          // Demote second+ goalie's role label.
          const goaliesBefore = roster.filter((p) => p.position === 'G').length
          if (modPlayer.position === 'G' && goaliesBefore > 0) {
            player.role = 'backup'
          }

          roster.push(player)
          players.set(playerId, player)
        }

        const lines = buildLinesFromRoster(roster)

        const team: Team = {
          id: teamId,
          name: `${modTeam.city} ${modTeam.nickname}`,
          abbreviation: modTeam.abbreviation,
          city: modTeam.city,
          colors: { primary: primaryColor, secondary: secondaryColor },
          conferenceId: `conf${ci}`,
          divisionId: divId,
          roster: roster.map((p) => p.id),
          lines,
          tactics: structuredClone(DEFAULT_TACTICS),
          finances: {
            budget: 90e6,
            salaryCap: 88e6,
            capUsed: roster.reduce((s, p) => s + p.contract.salary, 0),
            revenue: 0
          },
          staff: { headCoachId: null, assistantCoachIds: [], scoutIds: [] },
          externalId: modTeam.externalId,
          ...(modTeam.logoId !== undefined ? { logoId: modTeam.logoId } : {})
        }

        teams.set(teamId, team)
      }

      divisions.push({ id: divId, name: modDiv.name, teamIds: divTeamIds })
      confDivIds.push(divId)
    }

    conferences.push({ id: `conf${ci}`, name: modConf.name, divisionIds: confDivIds })
  }

  const schedule: ScheduledGame[] = buildSchedule(allTeamIds, roundRobins, startYear)

  const league: League = {
    id: asLeagueId('lg0'),
    name: mod.meta.name,
    conferences,
    divisions,
    teams: allTeamIds,
    players: [...players.keys()],
    schedule,
    draftClasses: [],
    season: {
      year: startYear,
      standings: allTeamIds.map(emptyStanding),
      news: []
    }
  }

  return { league, teams, players }
}
