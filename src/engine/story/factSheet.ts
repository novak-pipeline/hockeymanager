/**
 * Press fact sheets — the STRICT, verifiable fact bundles handed to the AI
 * press corps (and to the deterministic fallback writer). Everything in a
 * PressFactSheet comes from passed-in career state; this module never invents
 * a number or a name, it only assembles, sorts, clamps and trims.
 *
 * Pure module: no wall-clock, no randomness, JSON-safe types only (the job is
 * embedded in CareerSnapshot and crosses the worker boundary).
 */

/* ────────────────────────── types ────────────────────────── */

export type PressSheetKind =
  | 'weekly'
  | 'deadline'
  | 'lottery'
  | 'combine'
  | 'draft'
  | 'seasonRecap'
  | 'champion'
  | 'presser'
  // Scheduled recurring media reports (Task #39)
  | 'powerRankings'
  | 'seasonPreview'
  | 'monthlyReport'
  | 'playoffPreview'
  | 'awardsNight'
  | 'draftPreview'
  | 'seasonReview'

export type PressPersonaId = 'beat' | 'national' | 'homer'

/** Display names shared by the fallback writer and the renderer byline. */
export const PRESS_PERSONA_NAMES: Record<PressPersonaId, { name: string; outlet: string }> = {
  beat: { name: 'Sam Carver', outlet: 'The Daily Gazette' },
  national: { name: 'Vic Mercer', outlet: 'National Hockey Wire' },
  homer: { name: 'Bobby “Buzz” Doyle', outlet: '990 The Fan' },
}

export type PressTone = 'measured' | 'fiery' | 'deflecting' | 'praise'

export interface PressTeamFacts {
  name: string
  abbr: string
  wins: number
  losses: number
  otLosses: number
  points: number
  rank: number
  teamsInLeague: number
  /** Pundits' preseason projection (1 = favourite); absent when unknown. */
  expectedRank?: number
}

export interface PressResultFact {
  day: number
  opponentAbbr: string
  home: boolean
  goalsFor: number
  goalsAgainst: number
  decidedBy: 'regulation' | 'overtime' | 'shootout'
}

export interface PressArcFact {
  kind: string
  summary: string
  tension: number
}

export interface PressLockerRoomFacts {
  roomMorale: number
  captainName: string | null
  /** "A vs B" feud lines. */
  feuds: string[]
  /** "A mentoring B" lines. */
  mentorships: string[]
}

export interface PressRumorFact {
  playerName: string
  teamAbbr: string
  heat: number
}

export interface PressLeaderFact {
  name: string
  teamAbbr: string
  stat: string
  value: number
}

/** Raw facts the career layer assembles before clamping. */
export interface PressFactArgs {
  year: number
  day: number
  team: PressTeamFacts
  lastResults: PressResultFact[]
  topArcs: PressArcFact[]
  lockerRoom: PressLockerRoomFacts
  rumors: PressRumorFact[]
  recordsWatch: string[]
  upcomingOpponents: string[]
  leagueLeaders: PressLeaderFact[]
  /** Rolling deterministic career summary maintained by the career layer. */
  sagaSoFar: string
}

/** The finished, clamped sheet given to the writer (LLM or fallback). */
export interface PressFactSheet extends PressFactArgs {
  kind: PressSheetKind
  /** Tentpole-specific factual lines (empty for weeklies). */
  special: string[]
}

/** A pending press writing assignment, stored on the career. */
export interface PressJob {
  id: string
  kind: PressSheetKind
  personaId: PressPersonaId
  factSheet: PressFactSheet
}

/** A pending press-conference question for the user, stored on the career. */
export interface PressConferenceState {
  id: string
  question: string
  context: string
  day: number
  year: number
}

/* ────────────────────────── saga maintenance ────────────────────────── */

export const SAGA_MAX_CHARS = 1200

/**
 * Append one factual line to the rolling saga, trimming the OLDEST lines
 * until the whole thing fits in `maxLen` characters. Lines are '\n'-joined.
 */
export function appendSagaLine(saga: string, line: string, maxLen = SAGA_MAX_CHARS): string {
  const clean = line.replace(/\n+/g, ' ').trim()
  if (clean.length === 0) return saga
  const lines = saga.length > 0 ? saga.split('\n') : []
  lines.push(clean)
  let joined = lines.join('\n')
  while (joined.length > maxLen && lines.length > 1) {
    lines.shift()
    joined = lines.join('\n')
  }
  // A single over-long line is hard-truncated rather than dropped.
  if (joined.length > maxLen) joined = joined.slice(joined.length - maxLen)
  return joined
}

/* ────────────────────────── sheet builders ────────────────────────── */

const MAX_RESULTS = 5
const MAX_ARCS = 3
const MAX_RUMORS = 3
const MAX_LEADERS = 3
const MAX_UPCOMING = 3
const MAX_RECORDS = 3
const MAX_SPECIAL = 8

function clamp(args: PressFactArgs): PressFactArgs {
  return {
    year: args.year,
    day: args.day,
    team: { ...args.team },
    lastResults: args.lastResults.slice(-MAX_RESULTS).map((r) => ({ ...r })),
    topArcs: [...args.topArcs]
      .sort((a, b) => b.tension - a.tension)
      .slice(0, MAX_ARCS)
      .map((a) => ({ ...a })),
    lockerRoom: {
      roomMorale: args.lockerRoom.roomMorale,
      captainName: args.lockerRoom.captainName,
      feuds: args.lockerRoom.feuds.slice(0, 3),
      mentorships: args.lockerRoom.mentorships.slice(0, 3),
    },
    rumors: [...args.rumors]
      .sort((a, b) => b.heat - a.heat)
      .slice(0, MAX_RUMORS)
      .map((r) => ({ ...r })),
    recordsWatch: args.recordsWatch.slice(0, MAX_RECORDS),
    upcomingOpponents: args.upcomingOpponents.slice(0, MAX_UPCOMING),
    leagueLeaders: args.leagueLeaders.slice(0, MAX_LEADERS).map((l) => ({ ...l })),
    sagaSoFar:
      args.sagaSoFar.length > SAGA_MAX_CHARS
        ? args.sagaSoFar.slice(args.sagaSoFar.length - SAGA_MAX_CHARS)
        : args.sagaSoFar,
  }
}

/** Weekly beat-coverage sheet: every value comes from `args`, clamped. */
export function buildWeeklyFactSheet(args: PressFactArgs): PressFactSheet {
  return { ...clamp(args), kind: 'weekly', special: [] }
}

/** Tentpole special (deadline, lottery, champion, …): weekly facts + special lines. */
export function buildTentpoleFactSheet(
  kind: Exclude<PressSheetKind, 'weekly' | 'presser'>,
  args: PressFactArgs,
  special: string[]
): PressFactSheet {
  return { ...clamp(args), kind, special: special.slice(0, MAX_SPECIAL) }
}

/** Presser sheet: same facts, marked as press-conference context. */
export function buildPresserFactSheet(args: PressFactArgs, special: string[]): PressFactSheet {
  return { ...clamp(args), kind: 'presser', special: special.slice(0, MAX_SPECIAL) }
}

/* ────────────────────────── scheduled report fact types ────────────────────────── */

/** One ranked team entry for power rankings. */
export interface PowerRankingEntry {
  rank: number
  teamAbbr: string
  teamName: string
  points: number
  wins: number
  losses: number
  otLosses: number
  /** Change from last ranking (positive = moved up, negative = down, 0/absent = same). */
  delta?: number
}

/** One playoff matchup entry. */
export interface PlayoffMatchup {
  highSeed: string
  lowSeed: string
  highSeedWins: number
  lowSeedWins: number
  round: number
}

/** One award front-runner entry. */
export interface AwardFrontrunner {
  awardName: string
  leaderName: string
  leaderTeamAbbr: string
  statLine: string
}

/** Extended fact args for scheduled media reports. */
export interface ScheduledReportArgs extends PressFactArgs {
  /** Power rankings for the league, sorted 1st to last. */
  powerRankings?: PowerRankingEntry[]
  /** Preseason favorites / expectations summary lines. */
  preseasonFavorites?: string[]
  /** Monthly storyline bullets (standings moves, top performers, notable events). */
  monthlyHighlights?: string[]
  /** Playoff matchups (for preview). */
  playoffMatchups?: PlayoffMatchup[]
  /** Award front-runners (for awards night). */
  awardFrontrunners?: AwardFrontrunner[]
  /** Season champion name (for season review). */
  seasonChampion?: string
  /** Top-10 draft prospects by name (for draft preview). */
  topProspects?: string[]
  /** Month label for monthly reports, e.g. "November". */
  monthLabel?: string
  /** Playoff round label, e.g. "Conference Finals". */
  playoffRound?: string
}

/** Extended fact sheet for scheduled reports. */
export interface ScheduledReportFactSheet extends PressFactSheet {
  powerRankings: PowerRankingEntry[]
  preseasonFavorites: string[]
  monthlyHighlights: string[]
  playoffMatchups: PlayoffMatchup[]
  awardFrontrunners: AwardFrontrunner[]
  seasonChampion: string
  topProspects: string[]
  monthLabel: string
  playoffRound: string
}

const MAX_RANKINGS = 10
const MAX_PROSPECTS = 10
const MAX_MATCHUPS = 8
const MAX_AWARDS = 5
const MAX_MONTHLY = 6

function clampScheduled(args: ScheduledReportArgs): ScheduledReportFactSheet {
  const base = clamp(args)
  return {
    ...base,
    kind: args.kind ?? ('powerRankings' as PressSheetKind),
    special: [],
    powerRankings: (args.powerRankings ?? []).slice(0, MAX_RANKINGS),
    preseasonFavorites: (args.preseasonFavorites ?? []).slice(0, 6),
    monthlyHighlights: (args.monthlyHighlights ?? []).slice(0, MAX_MONTHLY),
    playoffMatchups: (args.playoffMatchups ?? []).slice(0, MAX_MATCHUPS),
    awardFrontrunners: (args.awardFrontrunners ?? []).slice(0, MAX_AWARDS),
    seasonChampion: args.seasonChampion ?? '',
    topProspects: (args.topProspects ?? []).slice(0, MAX_PROSPECTS),
    monthLabel: args.monthLabel ?? '',
    playoffRound: args.playoffRound ?? '',
  }
}

/** Build a fact sheet for a scheduled recurring report. */
export function buildScheduledReportFactSheet(
  kind: Extract<PressSheetKind, 'powerRankings' | 'seasonPreview' | 'monthlyReport' | 'playoffPreview' | 'awardsNight' | 'draftPreview' | 'seasonReview'>,
  args: ScheduledReportArgs
): ScheduledReportFactSheet {
  const sheet = clampScheduled(args)
  sheet.kind = kind
  return sheet
}
