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
import type { GamePlayerStat } from '@engine/shared/outcome'
import { lineupIssues } from '@engine/league/lineup'
import type {
  AttributeGroupView,
  ContractView,
  FinanceView,
  GoalieSeasonLine,
  LineSlotView,
  LinesView,
  PlayerBadge,
  PlayerProfileView,
  ScheduleView,
  SkaterSeasonLine,
  SquadRowView,
  SquadView,
  StandingRowView,
  StandingsView,
  StatsView,
  TacticsView,
  LeaderRowView,
} from './views'
import { dayToDateISO } from './views'

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

/* ────────────────────────── atoms ────────────────────────── */

export function badge(p: Player): PlayerBadge {
  return {
    playerId: p.id as string,
    name: p.name,
    position: p.position,
    age: p.age,
    overall: overall(p.composites, p.position),
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

export function buildSquadView(ctx: ViewCtx): SquadView {
  const team = ctx.teams.get(ctx.userTeamId)!
  const order: Record<Position, number> = { C: 0, W: 1, D: 2, G: 3 }
  const rows: SquadRowView[] = team.roster
    .map((id) => {
      const p = ctx.players.get(id)!
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
      }
    })
    .sort(
      (a, b) => order[a.position] - order[b.position] || b.overall - a.overall
    )
  return { teamName: team.name, rows }
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

function groupView(name: string, source: Record<string, number>, labels: Array<[string, string]>): AttributeGroupView {
  return {
    name,
    attributes: labels.map(([key, label]) => ({ label, value: Math.round(source[key] ?? 0) })),
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

export function buildPlayerProfile(ctx: ViewCtx, playerId: PlayerId): PlayerProfileView {
  const p = ctx.players.get(playerId)
  if (!p) throw new Error(`unknown player ${playerId}`)
  let teamId: string | null = null
  let teamName: string | null = null
  let teamAbbr = 'FA'
  for (const t of ctx.teams.values()) {
    if (t.roster.includes(playerId)) {
      teamId = t.id as string
      teamName = t.name
      teamAbbr = t.abbreviation
      break
    }
  }

  const groups: AttributeGroupView[] = [
    groupView('Technical', p.ratings.technical as unknown as Record<string, number>, TECH_LABELS),
    groupView('Physical', p.ratings.physical as unknown as Record<string, number>, PHYS_LABELS),
    groupView('Mental', p.ratings.mental as unknown as Record<string, number>, MENTAL_LABELS),
    groupView('Defensive', p.ratings.defensive as unknown as Record<string, number>, DEF_LABELS),
  ]
  if (p.ratings.goalie) {
    groups.push(
      groupView('Goaltending', p.ratings.goalie as unknown as Record<string, number>, GOALIE_LABELS)
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

  return {
    ...badge(p),
    teamId,
    teamName,
    handedness: p.handedness,
    role: p.role,
    condition: conditionOf(p),
    morale: Math.round(p.morale),
    form: Math.round(p.form),
    injury: p.injuryStatus,
    contract: teamId ? contractView(p) : null,
    potentialStars: potentialStars(p),
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
      .map(badge),
    issues: lineupIssues(team, ctx.players),
  }
  return { tactics: team.tactics, lines }
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
