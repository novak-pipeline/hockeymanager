/**
 * Stateless view builders for the management screens. Each takes a ViewCtx —
 * the slice of Career state it needs — and assembles a frozen view-model from
 * views.ts. No mutation, no simulation, no randomness.
 */
import type {
  Conference,
  Division,
  Player,
  PlayerId,
  Position,
  ScheduledGame,
  Standing,
  Team,
  TeamId,
} from '@domain'
import { overall } from '@engine/ratings/composites'
import { computeRadar } from '@engine/ratings/radar'
import type { RadarView } from '@engine/ratings/radar'
import {
  buildPersonalityRead,
  buildExactPersonalityRead,
} from '@engine/career/personalityRead'
import type { PersonalityReadView } from '@engine/career/personalityRead'
import { buildScoutReport } from '@engine/career/scoutReport'
import type { GamePlayerStat } from '@engine/shared/outcome'
import { lineupIssues } from '@engine/league/lineup'
import { formString, seasonAvgRating } from '@engine/league/playerRating'
import {
  ARCHETYPE_META,
  classifyArchetype,
  lineSynergy,
  pairSynergy,
  styleMatch,
  teamStyleFit,
} from '@engine/league/archetypes'
import type {
  ArchetypeInfo,
  AttributeGroupView,
  CalendarEntry,
  CalendarView,
  ContractView,
  CompareRadarView,
  DataHubView,
  FinanceView,
  GoalieSeasonLine,
  LineSlotView,
  LineSynergyView,
  LinesView,
  PlayerAnalyticsRow,
  PlayerBadge,
  PlayerBioView,
  PlayerHonoursView,
  PlayerProfileView,
  ProfileContractView,
  AhlSquadView,
  AhlStandingsView,
  ScheduleView,
  ScoutingView,
  SkaterSeasonLine,
  SquadRowView,
  SquadView,
  StandingRowView,
  StandingsView,
  StatsView,
  TacticsView,
  TeamAnalyticsRow,
  LeaderRowView,
  TeamKnowledgeSummary,
} from './views'
import { dayToDateISO } from './views'
import type { ScoutingState } from '@domain/scouting'
import { knowledgeOf, maskAttribute, maskedOverall } from '@engine/league/scouting'
import {
  finalizeSpecialTeams,
  type SpecialTeamsEntries,
} from '@engine/league/leagueStats'

/** The Career state slice every builder reads. */
export interface ViewCtx {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  conferences: Conference[]
  divisions: Division[]
  schedule: ScheduledGame[]
  userTeamId: TeamId
  year: number
  day: number
  totals: Map<PlayerId, GamePlayerStat>
  gp: Map<PlayerId, number>
  goalieWins: Map<PlayerId, number>
  goalieLosses: Map<PlayerId, number>
  ppGoals: Map<PlayerId, number>
  ppAssists: Map<PlayerId, number>
  /** League-wide standings, best first (already tiebreak-sorted). */
  standingsSorted: Standing[]
}

/* ────────────────────────── fog helpers ────────────────────────── */

/**
 * Fog context passed through view builders when scouting is active.
 * Callers may omit it to get the "own roster / exact" behaviour everywhere.
 */
export interface FogCtx {
  scouting: ScoutingState
}

function isExact(fog: FogCtx | undefined, playerId: string): boolean {
  if (!fog) return true
  return knowledgeOf(fog.scouting, playerId) >= 95
}

/* ────────────────────────── atoms ────────────────────────── */

/** Derive an archetype badge info object for a player (fog-aware). */
function archetypeInfo(p: Player, fog?: FogCtx): ArchetypeInfo | undefined {
  const pid = p.id as string
  // Own-roster (no fog) always gets archetype
  if (!fog || isExact(fog, pid)) {
    const result = classifyArchetype(p)
    const meta = ARCHETYPE_META[result.archetype]
    return { key: result.archetype, label: meta.label, descriptors: result.descriptors }
  }
  // Fogged player: only show archetype when scout has meaningful knowledge (>=50)
  const k = knowledgeOf(fog.scouting, pid)
  if (k < 50) return undefined
  const result = classifyArchetype(p)
  const meta = ARCHETYPE_META[result.archetype]
  return { key: result.archetype, label: meta.label, descriptors: result.descriptors }
}

export function badge(p: Player, fog?: FogCtx): PlayerBadge {
  const pid = p.id as string
  const ovr = overall(p.composites, p.position)
  const archetype = archetypeInfo(p, fog)
  const faceIdProp = p.faceId !== undefined ? { faceId: p.faceId } : {}
  if (!fog || isExact(fog, pid)) {
    return {
      playerId: pid,
      name: p.name,
      position: p.position,
      age: p.age,
      overall: ovr,
      ...faceIdProp,
      ...(archetype !== undefined ? { archetype } : {}),
    }
  }
  const k = knowledgeOf(fog.scouting, pid)
  const { lo, hi } = maskedOverall(ovr, k, pid)
  const midOvr = Math.round((lo + hi) / 2)
  return {
    playerId: pid,
    name: p.name,
    position: p.position,
    age: p.age,
    overall: midOvr,
    ...faceIdProp,
    scouted: { knowledge: Math.round(k), overallLo: lo, overallHi: hi, exact: false },
    ...(archetype !== undefined ? { archetype } : {}),
  }
}

function contractView(p: Player): ContractView {
  return {
    salary: p.contract.salary,
    yearsRemaining: p.contract.yearsRemaining,
    expiryYear: p.contract.expiryYear,
    noTradeClause: p.contract.noTradeClause,
    twoWay: p.contract.twoWay,
  }
}

function skaterLine(ctx: ViewCtx, id: PlayerId): SkaterSeasonLine {
  const t = ctx.totals.get(id)
  const games = ctx.gp.get(id) ?? 0
  return {
    gamesPlayed: games,
    goals: t?.goals ?? 0,
    assists: t?.assists ?? 0,
    points: (t?.goals ?? 0) + (t?.assists ?? 0),
    plusMinus: 0,
    penaltyMinutes: t?.penaltyMinutes ?? 0,
    shots: t?.shots ?? 0,
    toiPerGame: games > 0 ? Math.round((t?.toi ?? 0) / games) : 0,
    ppGoals: ctx.ppGoals.get(id) ?? 0,
    ppAssists: ctx.ppAssists.get(id) ?? 0,
  }
}

function goalieLine(ctx: ViewCtx, id: PlayerId): GoalieSeasonLine {
  const t = ctx.totals.get(id)
  const games = ctx.gp.get(id) ?? 0
  const sa = t?.shotsAgainst ?? 0
  const saves = t?.saves ?? 0
  const ga = t?.goalsAgainst ?? 0
  const toi = t?.toi ?? 0
  return {
    gamesPlayed: games,
    wins: ctx.goalieWins.get(id) ?? 0,
    losses: ctx.goalieLosses.get(id) ?? 0,
    savePct: sa > 0 ? saves / sa : 0,
    goalsAgainstAverage: toi > 0 ? (ga * 3600) / toi : 0,
    shutouts: 0,
    saves,
    shotsAgainst: sa,
  }
}

/** Condition is the inverse of fatigue for display. */
const conditionOf = (p: Player): number => Math.round(100 - Math.max(0, Math.min(100, p.fatigue)))

/* ────────────────────────── standings ────────────────────────── */

/** Streak/last-five labels from a team's played schedule entries. */
function teamFormStrings(ctx: ViewCtx, teamId: TeamId): { streak: string; lastFive: string } {
  const results: Array<'W' | 'L' | 'O'> = []
  for (const g of ctx.schedule) {
    if (!g.result) continue
    const home = g.homeTeamId === teamId
    if (!home && g.awayTeamId !== teamId) continue
    const us = home ? g.result.homeGoals : g.result.awayGoals
    const them = home ? g.result.awayGoals : g.result.homeGoals
    results.push(us > them ? 'W' : g.result.decidedBy === 'regulation' ? 'L' : 'O')
  }
  if (results.length === 0) return { streak: '—', lastFive: '' }
  const last = results[results.length - 1]
  let n = 0
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++
  return { streak: `${last}${n}`, lastFive: results.slice(-5).join('') }
}

export function standingRowView(ctx: ViewCtx, s: Standing): StandingRowView {
  const team = ctx.teams.get(s.teamId)!
  const form = teamFormStrings(ctx, s.teamId)
  return {
    teamId: s.teamId as string,
    name: team.name,
    abbreviation: team.abbreviation,
    gamesPlayed: s.gamesPlayed,
    wins: s.wins,
    losses: s.losses,
    overtimeLosses: s.overtimeLosses,
    points: s.points,
    goalsFor: s.goalsFor,
    goalsAgainst: s.goalsAgainst,
    streak: form.streak,
    lastFive: form.lastFive,
  }
}

export function buildStandingsView(ctx: ViewCtx): StandingsView {
  const rows = new Map<string, StandingRowView>()
  const overallRows = ctx.standingsSorted.map((s) => {
    const r = standingRowView(ctx, s)
    rows.set(r.teamId, r)
    return r
  })
  const confName = new Map(ctx.conferences.map((c) => [c.id, c.name]))
  const conferences = ctx.conferences.map((c) => ({
    name: c.name,
    rows: overallRows.filter((r) => ctx.teams.get(r.teamId as TeamId)!.conferenceId === c.id),
  }))
  const divisions = ctx.divisions.map((d) => ({
    name: d.name,
    conferenceName:
      confName.get(ctx.conferences.find((c) => c.divisionIds.includes(d.id))?.id ?? '') ?? '',
    rows: overallRows.filter((r) => ctx.teams.get(r.teamId as TeamId)!.divisionId === d.id),
  }))
  return { overall: overallRows, conferences, divisions }
}

/* ────────────────────────── squad / profile ────────────────────────── */

/** "L1", "D2/PP1", "G1", "—". */
function lineLabel(team: Team, id: PlayerId): string {
  const parts: string[] = []
  team.lines.forwards.forEach((line, i) => {
    if (line.includes(id)) parts.push(`L${i + 1}`)
  })
  team.lines.defensePairs.forEach((pair, i) => {
    if (pair.includes(id)) parts.push(`D${i + 1}`)
  })
  team.lines.goalies.forEach((g, i) => {
    if (g === id) parts.push(`G${i + 1}`)
  })
  team.lines.powerPlayUnits.forEach((u, i) => {
    if (u.includes(id)) parts.push(`PP${i + 1}`)
  })
  team.lines.penaltyKillUnits.forEach((u, i) => {
    if (u.includes(id)) parts.push(`PK${i + 1}`)
  })
  return parts.length > 0 ? parts.join('/') : '—'
}

export function buildSquadView(
  ctx: ViewCtx,
  opts?: {
    /** [playerId, gameRatings[]] for form string + avgRating. */
    playerRatings?: Map<string, number[]>
    /** Set of scratched player ids. */
    scratched?: Set<string>
  }
): SquadView {
  const team = ctx.teams.get(ctx.userTeamId)!
  const order: Record<Position, number> = { C: 0, W: 1, D: 2, G: 3 }
  const scratchedSet = opts?.scratched ?? new Set<string>()
  const ratingsMap = opts?.playerRatings ?? new Map<string, number[]>()

  const rows: SquadRowView[] = team.roster
    .map((id) => {
      const p = ctx.players.get(id)!
      const pid = id as string
      const ratings = ratingsMap.get(pid) ?? []
      return {
        ...badge(p),
        role: p.role,
        handedness: p.handedness,
        condition: conditionOf(p),
        morale: Math.round(p.morale),
        form: Math.round(p.form),
        injury: p.injuryStatus,
        contract: contractView(p),
        lineLabel: lineLabel(team, id),
        skater: p.position === 'G' ? null : skaterLine(ctx, id),
        goalie: p.position === 'G' ? goalieLine(ctx, id) : null,
        scratched: scratchedSet.has(pid),
        gameRatingForm: formString(ratings),
        avgRating: seasonAvgRating(ratings),
      }
    })
    .sort(
      (a, b) => order[a.position] - order[b.position] || b.overall - a.overall
    )

  const dressedCount = rows.filter((r) => !r.scratched && r.injury === null).length
  return { teamName: team.name, rows, rosterCount: rows.length, dressedCount }
}


const TECH_LABELS: Array<[string, string]> = [
  ['wristShot', 'Wrist shot'],
  ['slapShot', 'Slap shot'],
  ['stickhandling', 'Stickhandling'],
  ['passing', 'Passing'],
  ['deflections', 'Deflections'],
  ['faceoffs', 'Faceoffs'],
]
const PHYS_LABELS: Array<[string, string]> = [
  ['speed', 'Speed'],
  ['acceleration', 'Acceleration'],
  ['strength', 'Strength'],
  ['balance', 'Balance'],
  ['stamina', 'Stamina'],
  ['agility', 'Agility'],
  ['height', 'Height'],
]
const MENTAL_LABELS: Array<[string, string]> = [
  ['offensiveIQ', 'Offensive IQ'],
  ['defensiveIQ', 'Defensive IQ'],
  ['positioning', 'Positioning'],
  ['vision', 'Vision'],
  ['aggression', 'Aggression'],
  ['composure', 'Composure'],
  ['workRate', 'Work rate'],
  ['discipline', 'Discipline'],
  ['anticipation', 'Anticipation'],
]
const DEF_LABELS: Array<[string, string]> = [
  ['checking', 'Checking'],
  ['shotBlocking', 'Shot blocking'],
  ['stickChecking', 'Stick checking'],
  ['takeaway', 'Takeaways'],
]
const GOALIE_LABELS: Array<[string, string]> = [
  ['reflexes', 'Reflexes'],
  ['positioningG', 'Positioning'],
  ['reboundControl', 'Rebound control'],
  ['glove', 'Glove'],
  ['blocker', 'Blocker'],
  ['recovery', 'Recovery'],
  ['puckHandlingG', 'Puck handling'],
]
const COMPOSITE_LABELS: Array<[string, string]> = [
  ['scoring', 'Scoring'],
  ['playmaking', 'Playmaking'],
  ['puckControl', 'Puck control'],
  ['faceoffWin', 'Faceoffs'],
  ['hitting', 'Hitting'],
  ['blocking', 'Blocking'],
  ['takeaway', 'Takeaways'],
  ['penaltyProne', 'Penalty prone'],
  ['goaltending', 'Goaltending'],
  ['skating', 'Skating'],
  ['defensiveZone', 'Defensive zone'],
]
const PERSONALITY_LABELS: Array<[string, string]> = [
  ['ambition', 'Ambition'],
  ['professionalism', 'Professionalism'],
  ['loyalty', 'Loyalty'],
  ['temperament', 'Temperament'],
  ['determination', 'Determination'],
]

function groupView(
  name: string,
  source: Record<string, number>,
  labels: Array<[string, string]>,
  fog?: FogCtx,
  playerId?: string
): AttributeGroupView {
  return {
    name,
    attributes: labels.map(([key, label]) => {
      const value = Math.round(source[key] ?? 0)
      if (!fog || !playerId || isExact(fog, playerId)) {
        return { label, value }
      }
      const k = knowledgeOf(fog.scouting, playerId)
      const { lo, hi } = maskAttribute(value, k, playerId, key)
      const mid = Math.round((lo + hi) / 2)
      return { label, value: mid, lo, hi, masked: true }
    }),
  }
}

/** 1–5 stars from remaining upside (and current quality for the ceiling). */
export function potentialStars(p: Player): number {
  const cur = overall(p.composites, p.position)
  const groups = [p.potential.technical, p.potential.physical, p.potential.mental, p.potential.defensive]
  const vals = groups.flatMap((g) => Object.values(g))
  const potAvg = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length)
  const score = Math.max(cur, potAvg)
  if (score >= 82) return 5
  if (score >= 72) return 4
  if (score >= 62) return 3
  if (score >= 52) return 2
  return 1
}

/** Build the bio block for a player. */
function buildBio(p: Player): PlayerBioView {
  const bio: PlayerBioView = {}
  if (p.nationality !== undefined) bio.nationality = p.nationality
  if (p.birthplace !== undefined) bio.birthplace = p.birthplace
  if (p.jerseyNumber !== undefined) bio.jerseyNumber = p.jerseyNumber
  if (p.heightCm !== undefined) bio.heightCm = p.heightCm
  if (p.weightKg !== undefined) bio.weightKg = p.weightKg
  return bio
}

/** Build the honours block for a player. */
function buildHonours(p: Player): PlayerHonoursView {
  return {
    intlApps: p.intlApps ?? 0,
    intlGoals: p.intlGoals ?? 0,
    intlAssists: p.intlAssists ?? 0,
    stanleyCups: p.stanleyCups ?? 0,
    homeReputation: p.homeReputation ?? 0,
    currentReputation: p.currentReputation ?? 0,
    worldReputation: p.worldReputation ?? 0,
    nhlDraftEligible: p.nhlDraftEligible ?? false,
    nhlDrafted: p.nhlDrafted ?? false,
    ...(p.juniorPreference !== undefined ? { juniorPreference: p.juniorPreference } : {}),
  }
}

/**
 * Build the extended profile contract block.
 * RFA: yearsRemaining === 0 and age < 27 (simplified EHM rule).
 * UFA: yearsRemaining === 0 and age >= 27.
 * Under contract: yearsRemaining > 0 → null status.
 */
function buildProfileContract(p: Player, hasTeam: boolean): ProfileContractView | null {
  if (!hasTeam) return null
  const c = p.contract
  let freeAgentStatus: 'RFA' | 'UFA' | null = null
  if (c.yearsRemaining <= 0) {
    freeAgentStatus = p.age < 27 ? 'RFA' : 'UFA'
  }
  const base: ProfileContractView = {
    salary: c.salary,
    yearsRemaining: c.yearsRemaining,
    expiryYear: c.expiryYear,
    noTradeClause: c.noTradeClause,
    twoWay: c.twoWay,
    capHit: c.salary,
    freeAgentStatus,
  }
  // Two-way contracts: buried cap hit is the minor-league minimum (approximation).
  // EHM uses actual minor-league salary; we approximate as half the NHL salary,
  // floored at 750_000 (NHL minimum-adjacent).
  if (c.twoWay) {
    base.buriedCapHit = Math.max(750_000, Math.round(c.salary * 0.5))
  }
  return base
}

export function buildPlayerProfile(ctx: ViewCtx, playerId: PlayerId, fog?: FogCtx): PlayerProfileView {
  const p = ctx.players.get(playerId)
  if (!p) throw new Error(`unknown player ${playerId}`)
  let teamId: string | null = null
  let teamName: string | null = null
  let teamAbbr = 'FA'
  let teamColors: { primary: number; secondary: number } | undefined
  for (const t of ctx.teams.values()) {
    if (t.roster.includes(playerId)) {
      teamId = t.id as string
      teamName = t.name
      teamAbbr = t.abbreviation
      teamColors = t.colors
      break
    }
  }

  const pidStr = playerId as string
  const groups: AttributeGroupView[] = [
    groupView('Technical', p.ratings.technical as unknown as Record<string, number>, TECH_LABELS, fog, pidStr),
    groupView('Physical', p.ratings.physical as unknown as Record<string, number>, PHYS_LABELS, fog, pidStr),
    groupView('Mental', p.ratings.mental as unknown as Record<string, number>, MENTAL_LABELS, fog, pidStr),
    groupView('Defensive', p.ratings.defensive as unknown as Record<string, number>, DEF_LABELS, fog, pidStr),
  ]
  if (p.ratings.goalie) {
    groups.push(
      groupView('Goaltending', p.ratings.goalie as unknown as Record<string, number>, GOALIE_LABELS, fog, pidStr)
    )
  }

  const currentSeason = {
    year: ctx.year,
    teamAbbr,
    skater: p.position === 'G' ? null : skaterLine(ctx, playerId),
    goalie: p.position === 'G' ? goalieLine(ctx, playerId) : null,
  }
  const history = [...p.stats]
    .sort((a, b) => b.season - a.season)
    .map((s) => ({
      year: s.season,
      teamAbbr: ctx.teams.get(s.teamId as TeamId)?.abbreviation ?? s.teamId,
      skater:
        p.position === 'G'
          ? null
          : {
              gamesPlayed: s.gamesPlayed,
              goals: s.ev.goals + s.pp.goals + s.pk.goals,
              assists: s.ev.assists + s.pp.assists + s.pk.assists,
              points:
                s.ev.goals + s.pp.goals + s.pk.goals + s.ev.assists + s.pp.assists + s.pk.assists,
              plusMinus: s.plusMinus,
              penaltyMinutes: s.penaltyMinutes,
              shots: s.ev.shots + s.pp.shots + s.pk.shots,
              toiPerGame:
                s.gamesPlayed > 0
                  ? Math.round((s.ev.timeOnIce + s.pp.timeOnIce + s.pk.timeOnIce) / s.gamesPlayed)
                  : 0,
              ppGoals: s.pp.goals,
              ppAssists: s.pp.assists,
            },
      goalie:
        p.position === 'G'
          ? {
              gamesPlayed: s.gamesPlayed,
              wins: 0,
              losses: 0,
              savePct: s.shotsAgainst > 0 ? s.saves / s.shotsAgainst : 0,
              goalsAgainstAverage:
                s.gamesPlayed > 0 ? s.goalsAgainst / Math.max(1, s.gamesPlayed) : 0,
              shutouts: s.shutouts,
              saves: s.saves,
              shotsAgainst: s.shotsAgainst,
            }
          : null,
    }))

  // Phase B: radar, personalityReads, bio, honours, profileContract, scoutReport
  const radar: RadarView = computeRadar(p.ratings, p.composites)
  const personalityReads: PersonalityReadView =
    fog === undefined
      ? buildExactPersonalityRead(p)
      : buildPersonalityRead(p, fog.scouting)
  const potStars = potentialStars(p)
  const scoutReport = buildScoutReport(p, fog?.scouting, potStars)

  return {
    ...badge(p, fog),
    teamId,
    teamName,
    ...(teamColors !== undefined ? { teamColors } : {}),
    handedness: p.handedness,
    role: p.role,
    condition: conditionOf(p),
    morale: Math.round(p.morale),
    form: Math.round(p.form),
    injury: p.injuryStatus,
    contract: teamId ? contractView(p) : null,
    potentialStars: potStars,
    personality: PERSONALITY_LABELS.map(([key, label]) => ({
      label,
      value: (p.personality as unknown as Record<string, number>)[key] ?? 0,
    })),
    attributeGroups: groups,
    composites: COMPOSITE_LABELS.map(([key, label]) => ({
      label,
      value: Math.round((p.composites as unknown as Record<string, number>)[key] ?? 0),
    })),
    seasons: [currentSeason, ...history],
    // Phase B additions
    radar,
    personalityReads,
    bio: buildBio(p),
    honours: buildHonours(p),
    profileContract: buildProfileContract(p, teamId !== null),
    scoutReport,
  }
}

/**
 * Build a side-by-side radar comparison for two players.
 * Fog is not applied here — the compare view is typically accessed
 * from the user's own roster or via a scouted profile already seen.
 * The caller (Career.compareRadar) passes the relevant fog per player.
 */
export function buildCompareRadar(
  ctx: ViewCtx,
  playerIdA: string,
  playerIdB: string
): CompareRadarView {
  const pA = ctx.players.get(playerIdA as PlayerId)
  const pB = ctx.players.get(playerIdB as PlayerId)
  if (!pA) throw new Error(`unknown player ${playerIdA}`)
  if (!pB) throw new Error(`unknown player ${playerIdB}`)

  const ovrA = overall(pA.composites, pA.position)
  const ovrB = overall(pB.composites, pB.position)

  return {
    playerA: {
      playerId: playerIdA,
      name: pA.name,
      position: pA.position,
      overall: ovrA,
      radar: computeRadar(pA.ratings, pA.composites),
      skater: pA.position !== 'G' ? skaterLine(ctx, playerIdA as PlayerId) : null,
      goalie: pA.position === 'G' ? goalieLine(ctx, playerIdA as PlayerId) : null,
    },
    playerB: {
      playerId: playerIdB,
      name: pB.name,
      position: pB.position,
      overall: ovrB,
      radar: computeRadar(pB.ratings, pB.composites),
      skater: pB.position !== 'G' ? skaterLine(ctx, playerIdB as PlayerId) : null,
      goalie: pB.position === 'G' ? goalieLine(ctx, playerIdB as PlayerId) : null,
    },
  }
}

/* ────────────────────────── tactics ────────────────────────── */

const FWD_SLOTS = ['LW', 'C', 'RW']
const DEF_SLOTS = ['LD', 'RD']

export function buildTacticsView(ctx: ViewCtx): TacticsView {
  const team = ctx.teams.get(ctx.userTeamId)!
  const slot = (label: string, id: PlayerId | undefined): LineSlotView => ({
    slot: label,
    player: id && ctx.players.has(id) ? badge(ctx.players.get(id)!) : null,
  })

  const used = new Set<string>()
  const mark = (id: PlayerId | undefined): void => {
    if (id) used.add(id as string)
  }
  team.lines.forwards.forEach((l) => l.forEach(mark))
  team.lines.defensePairs.forEach((l) => l.forEach(mark))
  team.lines.goalies.forEach(mark)

  const lines: LinesView = {
    forwards: team.lines.forwards.map((line) => line.map((id, i) => slot(FWD_SLOTS[i] ?? 'F', id))),
    defensePairs: team.lines.defensePairs.map((pair) =>
      pair.map((id, i) => slot(DEF_SLOTS[i] ?? 'D', id))
    ),
    goalies: team.lines.goalies.map((id) => slot('G', id)),
    powerPlayUnits: team.lines.powerPlayUnits.map((u) => u.map((id) => slot('PP', id))),
    penaltyKillUnits: team.lines.penaltyKillUnits.map((u) => u.map((id) => slot('PK', id))),
    scratches: team.roster
      .filter((id) => !used.has(id as string))
      .map((id) => ctx.players.get(id)!)
      .filter((p) => p.injuryStatus === null)
      .map((p) => badge(p)),
    issues: lineupIssues(team, ctx.players),
  }

  // ── synergy ──
  // Resolve Player objects for each EV slot; skip if slot has no player.
  const resolveSlotPlayer = (id: PlayerId | undefined): Player | undefined =>
    id && ctx.players.has(id) ? ctx.players.get(id)! : undefined

  const lineSynergies: LineSynergyView[] = team.lines.forwards.map((line) => {
    const players = line.map(resolveSlotPlayer).filter((p): p is Player => p !== undefined)
    const result = lineSynergy(players)
    return { score: result.score, multiplier: result.multiplier, notes: result.notes }
  })

  const pairSynergies: LineSynergyView[] = team.lines.defensePairs.map((pair) => {
    const players = pair.map(resolveSlotPlayer).filter((p): p is Player => p !== undefined)
    const result = pairSynergy(players)
    return { score: result.score, multiplier: result.multiplier, notes: result.notes }
  })

  // ── coach suggestion ──
  const roster = team.roster.map((id) => ctx.players.get(id)!).filter(Boolean)
  const styleResult = teamStyleFit({ roster })
  const coachSuggestion = {
    styleLabel: styleResult.styleLabel,
    rationale: styleResult.rationale,
    suggestedTactics: styleResult.suggestedTactics,
  }

  // ── style fit (current tactics vs roster) ──
  const fitResult = styleMatch(roster, team.tactics)
  const styleFit = { fit: fitResult.fit, advice: fitResult.advice }

  return { tactics: team.tactics, lines, lineSynergies, pairSynergies, coachSuggestion, styleFit }
}

/* ────────────────────────── schedule / stats / finances ────────────────────────── */

export function buildScheduleView(ctx: ViewCtx): ScheduleView {
  const games = ctx.schedule.filter(
    (g) => g.homeTeamId === ctx.userTeamId || g.awayTeamId === ctx.userTeamId
  )
  const next = games.find((g) => !g.result)
  return {
    entries: games.map((g) => {
      const home = g.homeTeamId === ctx.userTeamId
      const opp = ctx.teams.get(home ? g.awayTeamId : g.homeTeamId)!
      const won =
        g.result !== null &&
        (home ? g.result.homeGoals > g.result.awayGoals : g.result.awayGoals > g.result.homeGoals)
      return {
        gameId: g.id as string,
        day: g.day,
        date: dayToDateISO(ctx.year, g.day),
        opponentTeamId: opp.id as string,
        opponentName: opp.name,
        opponentAbbr: opp.abbreviation,
        home,
        result: g.result ? { ...g.result, won } : null,
        isNext: g === next,
      }
    }),
  }
}

export function buildStatsView(ctx: ViewCtx): StatsView {
  type Entry = { p: Player; t: GamePlayerStat; games: number }
  const entries: Entry[] = []
  for (const [id, t] of ctx.totals) {
    const p = ctx.players.get(id)
    if (!p) continue
    entries.push({ p, t, games: ctx.gp.get(id) ?? 0 })
  }
  const teamAbbrOf = (p: Player): string => {
    for (const team of ctx.teams.values()) if (team.roster.includes(p.id)) return team.abbreviation
    return 'FA'
  }
  const row = (e: Entry, value: number): LeaderRowView => ({
    ...badge(e.p),
    teamAbbr: teamAbbrOf(e.p),
    gamesPlayed: e.games,
    value,
  })
  const skaters = entries.filter((e) => e.p.position !== 'G')
  const minGoalieGames = 10
  const goalies = entries.filter(
    (e) => e.p.position === 'G' && e.games >= minGoalieGames && e.t.shotsAgainst > 0
  )
  const top = (
    pool: Entry[],
    value: (e: Entry) => number,
    asc = false,
    digits = 0
  ): LeaderRowView[] =>
    [...pool]
      .sort((x, y) => (asc ? value(x) - value(y) : value(y) - value(x)))
      .slice(0, 10)
      .map((e) => row(e, Number(value(e).toFixed(digits))))

  return {
    points: top(skaters, (e) => e.t.goals + e.t.assists),
    goals: top(skaters, (e) => e.t.goals),
    assists: top(skaters, (e) => e.t.assists),
    savePct: top(goalies, (e) => (e.t.shotsAgainst > 0 ? e.t.saves / e.t.shotsAgainst : 0), false, 3),
    goalsAgainstAvg: top(goalies, (e) => (e.t.toi > 0 ? (e.t.goalsAgainst * 3600) / e.t.toi : 99), true, 2),
    wins: top(
      entries.filter((e) => e.p.position === 'G'),
      (e) => ctx.goalieWins.get(e.p.id) ?? 0
    ),
  }
}

export function buildFinanceView(ctx: ViewCtx): FinanceView {
  const team = ctx.teams.get(ctx.userTeamId)!
  const payrollRow = (p: Player) => ({
    ...badge(p),
    salary: p.contract.salary,
    yearsRemaining: p.contract.yearsRemaining,
    expiryYear: p.contract.expiryYear,
    noTradeClause: p.contract.noTradeClause,
    twoWay: p.contract.twoWay,
  })
  const roster = team.roster.map((id) => ctx.players.get(id)!).filter(Boolean)
  const payroll = roster.map(payrollRow).sort((a, b) => b.salary - a.salary)
  const capUsed = roster.reduce((s, p) => s + p.contract.salary, 0)
  let leagueTotal = 0
  for (const t of ctx.teams.values()) {
    for (const id of t.roster) leagueTotal += ctx.players.get(id)?.contract.salary ?? 0
  }
  return {
    salaryCap: team.finances.salaryCap,
    capUsed,
    capSpace: team.finances.salaryCap - capUsed,
    budget: team.finances.budget,
    payroll,
    expiring: payroll.filter((r) => r.yearsRemaining <= 1),
    leagueAvgPayroll: Math.round(leagueTotal / Math.max(1, ctx.teams.size)),
  }
}

/* ────────────────────────── scouting view ────────────────────────── */

export interface ScoutingViewCtx extends ViewCtx {
  scouting: ScoutingState
  /** All draft class prospect ids across all years. */
  draftProspectIds: Set<string>
}

function assignmentLabel(
  target: { kind: string; teamId?: string; divisionId?: string },
  ctx: ViewCtx
): string {
  switch (target.kind) {
    case 'team': {
      const t = ctx.teams.get(target.teamId as TeamId)
      return t ? `Watching ${t.name}` : 'Watching team'
    }
    case 'division': {
      const d = ctx.divisions.find((div) => div.id === target.divisionId)
      return d ? `Watching ${d.name} division` : 'Watching division'
    }
    case 'draftClass':
      return 'Scouting draft class'
    case 'freeAgents':
      return 'Watching free agents'
    default:
      return 'Unassigned'
  }
}

export function buildScoutingView(ctx: ScoutingViewCtx): ScoutingView {
  const { scouting, teams, divisions, players, draftProspectIds } = ctx

  // Scout cards
  const scouts = scouting.assignments.map((s) => ({
    scoutId: s.scoutId,
    name: s.name,
    rating: s.rating,
    assignmentLabel: assignmentLabel(s.target as { kind: string; teamId?: string; divisionId?: string }, ctx),
    target: s.target,
  }))

  // Teams list for dropdown options
  const teamsOpts = [...teams.values()].map((t) => ({
    teamId: t.id as string,
    teamName: t.name,
    teamAbbr: t.abbreviation,
  }))

  // Divisions list
  const divisionsOpts = divisions.map((d) => ({
    divisionId: d.id,
    divisionName: d.name,
  }))

  // Per-team knowledge summary
  const teamKnowledge: TeamKnowledgeSummary[] = []
  for (const [tid, team] of teams) {
    if (!team.roster.length) continue
    const knowledges = team.roster.map((id) => knowledgeOf(scouting, id as string))
    const avg = Math.round(knowledges.reduce((s, k) => s + k, 0) / knowledges.length)
    teamKnowledge.push({
      teamId: tid as string,
      teamName: team.name,
      teamAbbr: team.abbreviation,
      avgKnowledge: avg,
    })
  }
  teamKnowledge.sort((a, b) => b.avgKnowledge - a.avgKnowledge)

  // Top gains — players with highest current knowledge not at 100 or 0
  const topGains: Array<PlayerBadge & { knowledge: number }> = []
  for (const [pid, k] of scouting.knowledge) {
    if (k <= 5 || k >= 100) continue
    const p = players.get(pid as PlayerId)
    if (!p) continue
    topGains.push({ ...badge(p), knowledge: Math.round(k) })
  }
  topGains.sort((a, b) => b.knowledge - a.knowledge)
  topGains.splice(20)

  return {
    scouts,
    teams: teamsOpts,
    divisions: divisionsOpts,
    hasDraftClass: draftProspectIds.size > 0,
    teamKnowledge,
    topGains,
  }
}

/* ────────────────────────── AHL farm system views ────────────────────────── */

/** Context for AHL view builders — extends the base with AHL-specific maps. */
export interface AhlViewCtx {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  ahlSchedule: ScheduledGame[]
  ahlStandingsSorted: Standing[]
  /** The user's AHL affiliate team id, if any. */
  userAhlTeamId: TeamId | null
}

/**
 * Build the AHL league-wide standings.
 * Reuses `standingRowView` shape (same fields) but reads from ahlSchedule.
 */
export function buildAhlStandingsView(ctx: AhlViewCtx): AhlStandingsView {
  const rows: StandingRowView[] = ctx.ahlStandingsSorted.map((s) => {
    const team = ctx.teams.get(s.teamId)
    if (!team) return null
    // Compute streak/lastFive from AHL schedule.
    const results: Array<'W' | 'L' | 'O'> = []
    for (const g of ctx.ahlSchedule) {
      if (!g.result) continue
      const home = g.homeTeamId === s.teamId
      if (!home && g.awayTeamId !== s.teamId) continue
      const us = home ? g.result.homeGoals : g.result.awayGoals
      const them = home ? g.result.awayGoals : g.result.homeGoals
      results.push(us > them ? 'W' : g.result.decidedBy === 'regulation' ? 'L' : 'O')
    }
    const streak = results.length === 0
      ? '—'
      : (() => {
          const last = results[results.length - 1]
          let n = 0
          for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++
          return `${last}${n}`
        })()
    const lastFive = results.slice(-5).join('')
    return {
      teamId: s.teamId as string,
      name: team.name,
      abbreviation: team.abbreviation,
      gamesPlayed: s.gamesPlayed,
      wins: s.wins,
      losses: s.losses,
      overtimeLosses: s.overtimeLosses,
      points: s.points,
      goalsFor: s.goalsFor,
      goalsAgainst: s.goalsAgainst,
      streak,
      lastFive,
    } satisfies StandingRowView
  }).filter((r): r is StandingRowView => r !== null)
  return { rows }
}

/**
 * Build the user's AHL affiliate squad view.
 * Uses simplified stats (AHL gp only — no totals/skaterLine available for AHL players).
 */
export function buildAhlSquadView(
  ctx: AhlViewCtx,
  ahlGp: Map<PlayerId, number>
): AhlSquadView {
  if (!ctx.userAhlTeamId) {
    return { teamName: 'No Affiliate', teamId: '', rows: [], rosterCount: 0, hasAffiliate: false }
  }
  const ahlTeam = ctx.teams.get(ctx.userAhlTeamId)
  if (!ahlTeam) {
    return { teamName: 'No Affiliate', teamId: ctx.userAhlTeamId as string, rows: [], rosterCount: 0, hasAffiliate: false }
  }
  const order: Record<Position, number> = { C: 0, W: 1, D: 2, G: 3 }
  const rows: SquadRowView[] = ahlTeam.roster
    .map((id) => {
      const p = ctx.players.get(id)
      if (!p) return null
      const gp = ahlGp.get(id) ?? 0
      const skaterLine: SkaterSeasonLine | null = p.position !== 'G'
        ? {
            gamesPlayed: gp,
            goals: 0,
            assists: 0,
            points: 0,
            plusMinus: 0,
            penaltyMinutes: 0,
            shots: 0,
            toiPerGame: 0,
            ppGoals: 0,
            ppAssists: 0,
          }
        : null
      const goalieLine = p.position === 'G'
        ? {
            gamesPlayed: gp,
            wins: 0,
            losses: 0,
            savePct: 0,
            goalsAgainstAverage: 0,
            shutouts: 0,
            saves: 0,
            shotsAgainst: 0,
          }
        : null
      const b = badge(p)
      return {
        ...b,
        tier: 'ahl' as const,
        role: p.role,
        handedness: p.handedness,
        condition: Math.round(100 - Math.max(0, Math.min(100, p.fatigue))),
        morale: Math.round(p.morale),
        form: Math.round(p.form),
        injury: p.injuryStatus,
        contract: {
          salary: p.contract.salary,
          yearsRemaining: p.contract.yearsRemaining,
          expiryYear: p.contract.expiryYear,
          noTradeClause: p.contract.noTradeClause,
          twoWay: p.contract.twoWay,
        },
        lineLabel: '—',
        skater: skaterLine,
        goalie: goalieLine,
        scratched: false,
        gameRatingForm: '',
        avgRating: 0,
      } satisfies SquadRowView
    })
    .filter((r): r is SquadRowView => r !== null)
    .sort((a, b) => order[a.position] - order[b.position] || b.overall - a.overall)

  return {
    teamName: ahlTeam.name,
    teamId: ctx.userAhlTeamId as string,
    rows,
    rosterCount: rows.length,
    hasAffiliate: true,
  }
}

/* ────────────────────────── calendar ────────────────────────── */

/**
 * Extra context the calendar builder needs beyond the base ViewCtx.
 * These fields are all available on the Career without extra cost.
 */
export interface CalendarCtx extends ViewCtx {
  /** Day of the trade deadline (floor(lastMatchDay * 0.75)). */
  deadlineDay: number
  /** First match day of the playoffs (null when still regular season or not started). */
  playoffsStartDay: number | null
}

/**
 * Build the CalendarView for the user's club.
 * - One 'game' entry per user fixture.
 * - Key-date entries for: season start, trade deadline, playoffs start (when known), season end.
 * - Sorted chronologically by dateISO.
 */
export function buildCalendarView(ctx: CalendarCtx): CalendarView {
  const entries: CalendarEntry[] = []

  // ── user fixtures ──
  const userGames = ctx.schedule.filter(
    (g) => g.homeTeamId === ctx.userTeamId || g.awayTeamId === ctx.userTeamId
  )
  const nextGame = userGames.find((g) => !g.result)

  for (const g of userGames) {
    const home = g.homeTeamId === ctx.userTeamId
    const opp = ctx.teams.get(home ? g.awayTeamId : g.homeTeamId)
    if (!opp) continue
    const won =
      g.result !== null &&
      (home ? g.result.homeGoals > g.result.awayGoals : g.result.awayGoals > g.result.homeGoals)
    const result = g.result
      ? {
          homeGoals: g.result.homeGoals,
          awayGoals: g.result.awayGoals,
          won,
          decidedBy: g.result.decidedBy,
        }
      : null
    entries.push({
      kind: 'game',
      dateISO: dayToDateISO(ctx.year, g.day),
      day: g.day,
      gameId: g.id as string,
      opponentAbbr: opp.abbreviation,
      opponentName: opp.name,
      home,
      result,
      isNext: g === nextGame,
    })
  }

  // ── key dates ──
  // Season start (day 1)
  const allDays = ctx.schedule.map((g) => g.day)
  if (allDays.length > 0) {
    const firstDay = Math.min(...allDays)
    entries.push({ kind: 'keydate', dateISO: dayToDateISO(ctx.year, firstDay), label: 'Season Begins' })
  }

  // Trade deadline
  if (ctx.deadlineDay > 0) {
    entries.push({ kind: 'keydate', dateISO: dayToDateISO(ctx.year, ctx.deadlineDay), label: 'Trade Deadline' })
  }

  // Playoffs start (if known — i.e. first day after all regular-season games)
  if (ctx.playoffsStartDay !== null) {
    entries.push({ kind: 'keydate', dateISO: dayToDateISO(ctx.year, ctx.playoffsStartDay), label: 'Playoffs Begin' })
  }

  // Season end (last match day of regular season)
  if (allDays.length > 0) {
    const lastDay = Math.max(...allDays)
    entries.push({ kind: 'keydate', dateISO: dayToDateISO(ctx.year, lastDay), label: 'Regular Season Ends' })
  }

  entries.sort((a, b) => a.dateISO.localeCompare(b.dateISO))

  return { year: ctx.year, entries }
}

/* ────────────────────────── data hub (xG analytics) ────────────────────────── */

/**
 * Helper: compute a league percentile (0–100) for a value within an array of
 * values. High `pctile` = good if `higherIsBetter`, else reversed.
 *
 * The percentile is defined as: fraction of OTHER teams that score WORSE than
 * this team, scaled to 0–100, then rounded. A team at the very top gets 100.
 */
function pctile(value: number, allValues: number[], higherIsBetter: boolean): number {
  const total = allValues.length
  if (total <= 1) return 50
  let countWorse = 0
  for (const v of allValues) {
    if (higherIsBetter ? v < value : v > value) countWorse++
  }
  return Math.round((countWorse / (total - 1)) * 100)
}

/**
 * Build the Data Hub analytics view.
 *
 * @param ctx          standard view context (standings, totals, teams, players)
 * @param specialTeams accumulated special-teams entries (from Career.specialTeams)
 * @param nhlTeamIds   set of NHL-tier team ids (exclude AHL teams)
 */
export function buildDataHubView(
  ctx: ViewCtx,
  specialTeams: SpecialTeamsEntries,
  nhlTeamIds: ReadonlySet<string>
): DataHubView {
  // ── Finalize special teams ──
  const stMap = new Map(finalizeSpecialTeams(specialTeams).map((r) => [r.teamId, r]))

  // ── Per-team totals aggregated from player stats ──
  // We sum goalsFor, goalsAgainst, shots, shotsAgainst, xGF, xGA from player-stat map.
  // gamesPlayed comes from standings (league-authoritative source).
  // TOI for rate calculations: each NHL team plays 60 min/game; we derive total
  // team-level TOI from gamesPlayed × 3600 × (team's on-ice skater count / 5).
  // But we don't have per-team TOI directly; use gamesPlayed × 3600 as
  // "skater-minutes" proxy. All teams use the same denominator so percentiles
  // are unaffected by the specific scaling constant chosen.

  // Aggregate from player stat totals into per-team buckets.
  const teamBuckets = new Map<
    string,
    { gf: number; ga: number; shots: number; shotsAgainst: number; xgf: number; xga: number; toiSec: number }
  >()

  const ensureBucket = (tid: string) => {
    if (!teamBuckets.has(tid)) {
      teamBuckets.set(tid, { gf: 0, ga: 0, shots: 0, shotsAgainst: 0, xgf: 0, xga: 0, toiSec: 0 })
    }
    return teamBuckets.get(tid)!
  }

  // Map player → their team (current roster membership only — once a player moves
  // their old stats stay in totals under the new team; it's an acceptable
  // approximation for mid-season analytics).
  const playerTeam = new Map<string, string>()
  for (const [tid, team] of ctx.teams) {
    if (!nhlTeamIds.has(tid as string)) continue
    for (const pid of team.roster) {
      playerTeam.set(pid as string, tid as string)
    }
  }

  for (const [pid, s] of ctx.totals) {
    const tid = playerTeam.get(pid as string)
    if (!tid) continue
    const bk = ensureBucket(tid)
    // Skaters contribute xGF and shots
    if (s.shots > 0 || (s.xg ?? 0) > 0) {
      bk.shots += s.shots
      bk.xgf += s.xg ?? 0
    }
    bk.gf += s.goals
    bk.toiSec += s.toi
    // Goalies contribute the other side
    if (s.shotsAgainst > 0 || (s.xgAgainst ?? 0) > 0) {
      bk.shotsAgainst += s.shotsAgainst
      bk.xga += s.xgAgainst ?? 0
      bk.ga += s.goalsAgainst
    }
  }

  // ── Build per-team rows ──
  const standingsMap = new Map(ctx.standingsSorted.map((s) => [s.teamId as string, s]))

  const teamRows: TeamAnalyticsRow[] = []
  for (const [tid, team] of ctx.teams) {
    if (!nhlTeamIds.has(tid as string)) continue
    const bk = teamBuckets.get(tid as string)
    const standing = standingsMap.get(tid as string)
    const gp = standing?.gamesPlayed ?? 0
    // Use total on-ice seconds as the denominator for per-60 rates.
    // We take the max of the goalie TOI bucket and skater bucket / 5 to avoid
    // double-counting but keep the number meaningful.
    const toiHours = bk ? bk.toiSec / 3600 : gp
    const per60 = (n: number): number =>
      toiHours > 0 ? Math.round((n / toiHours) * 100) / 100 : 0

    const st = stMap.get(tid as string)
    teamRows.push({
      teamId: tid as string,
      teamName: team.name,
      teamAbbr: team.abbreviation,
      gamesPlayed: gp,
      gfPer60: per60(bk?.gf ?? 0),
      gaPer60: per60(bk?.ga ?? 0),
      xgfPer60: per60(bk?.xgf ?? 0),
      xgaPer60: per60(bk?.xga ?? 0),
      shotsPer60: per60(bk?.shots ?? 0),
      shotsAgainstPer60: per60(bk?.shotsAgainst ?? 0),
      ppPct: st?.ppPct ?? 0,
      pkPct: st?.pkPct ?? 0,
      // percentiles filled in below
      gfPctile: 0,
      gaPctile: 0,
      xgfPctile: 0,
      xgaPctile: 0,
      shotsPctile: 0,
      shotsAgainstPctile: 0,
      ppPctile: 0,
      pkPctile: 0,
    })
  }

  // ── Compute percentiles ──
  const allGf = teamRows.map((r) => r.gfPer60)
  const allGa = teamRows.map((r) => r.gaPer60)
  const allXgf = teamRows.map((r) => r.xgfPer60)
  const allXga = teamRows.map((r) => r.xgaPer60)
  const allShots = teamRows.map((r) => r.shotsPer60)
  const allShotsA = teamRows.map((r) => r.shotsAgainstPer60)
  const allPp = teamRows.map((r) => r.ppPct)
  const allPk = teamRows.map((r) => r.pkPct)

  for (const row of teamRows) {
    row.gfPctile = pctile(row.gfPer60, allGf, true)
    row.gaPctile = pctile(row.gaPer60, allGa, false) // lower GA = better
    row.xgfPctile = pctile(row.xgfPer60, allXgf, true)
    row.xgaPctile = pctile(row.xgaPer60, allXga, false)
    row.shotsPctile = pctile(row.shotsPer60, allShots, true)
    row.shotsAgainstPctile = pctile(row.shotsAgainstPer60, allShotsA, false)
    row.ppPctile = pctile(row.ppPct, allPp, true)
    row.pkPctile = pctile(row.pkPct, allPk, true)
  }

  // Sort by xGF/60 descending
  const allTeams = [...teamRows].sort((a, b) => b.xgfPer60 - a.xgfPer60)
  const userTeamRow = allTeams.find((r) => r.teamId === (ctx.userTeamId as string))
    ?? allTeams[0] ?? {
      teamId: ctx.userTeamId as string,
      teamName: '',
      teamAbbr: '',
      gamesPlayed: 0,
      gfPer60: 0, gaPer60: 0, xgfPer60: 0, xgaPer60: 0, shotsPer60: 0, shotsAgainstPer60: 0, ppPct: 0, pkPct: 0,
      gfPctile: 50, gaPctile: 50, xgfPctile: 50, xgaPctile: 50, shotsPctile: 50, shotsAgainstPctile: 50, ppPctile: 50, pkPctile: 50,
    }

  // ── Per-player analytics (skaters, NHL-tier only, min 5 GP) ──
  const MIN_GP = 5
  const playerRows: PlayerAnalyticsRow[] = []

  const teamAbbrOf = (pid: string): string => {
    const tid = playerTeam.get(pid)
    return tid ? (ctx.teams.get(tid as TeamId)?.abbreviation ?? 'FA') : 'FA'
  }

  for (const [pid, s] of ctx.totals) {
    const p = ctx.players.get(pid)
    if (!p || p.position === 'G') continue
    const tid = playerTeam.get(pid as string)
    if (!tid) continue // not on an NHL-tier roster
    const gp = ctx.gp.get(pid) ?? 0
    if (gp < MIN_GP) continue

    const toiH = s.toi / 3600
    const per60 = (n: number): number => (toiH > 0 ? Math.round((n / toiH) * 100) / 100 : 0)

    const xg = s.xg ?? 0
    const xA = s.xA ?? 0
    const shootPct = s.shots > 0 ? s.goals / s.shots : 0
    const finishing = Math.round((s.goals - xg) * 100) / 100

    playerRows.push({
      playerId: pid as string,
      name: p.name,
      teamAbbr: teamAbbrOf(pid as string),
      position: p.position,
      gamesPlayed: gp,
      xgPer60: per60(xg),
      xAPer60: per60(xA),
      goalsPer60: per60(s.goals),
      shootingPct: Math.round(shootPct * 1000) / 1000,
      finishing,
    })
  }

  const xgLeaders = [...playerRows]
    .sort((a, b) => b.xgPer60 - a.xgPer60)
    .slice(0, 20)

  const finishingLeaders = [...playerRows]
    .sort((a, b) => b.finishing - a.finishing)
    .slice(0, 20)

  return {
    userTeam: userTeamRow,
    allTeams,
    xgLeaders,
    finishingLeaders,
  }
}
