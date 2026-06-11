/**
 * League History & Records — the long memory that makes season 12 different
 * from season 2.
 *
 * All state is JSON-safe (no Maps, no class instances, no functions). The
 * RecordsState is stored as an optional additive field in CareerSnapshot
 * (same pattern as ScoutingState).
 *
 * This module is PURE: no wall-clock, no unseeded RNG. Every function takes
 * explicit args and returns results — callers (career.ts) push news seeds.
 *
 * Ruleset-aware: draft/trade-deadline existence must never be hardcoded here.
 * Season structure facts (number of games, qualification thresholds) are
 * passed as arguments.
 */

/* ────────────────────────── types ────────────────────────── */

export interface RecordEntry {
  value: number
  playerId: string
  playerName: string
  teamAbbr: string
  year: number
}

export interface SeasonArchive {
  year: number
  /** Team id of playoff champion, null when playoffs not run. */
  championTeamId: string | null
  /** Display name of champion, null when no champion. */
  championName: string | null
  /** Best regular-season club (Presidents' Trophy equivalent). */
  presidentsTeamName: string | null
  /** User team's final regular-season rank (1 = best). */
  userTeamRank: number
  leaders: {
    points: RecordEntry | null
    goals: RecordEntry | null
    wins: RecordEntry | null
  }
}

export interface AwardRecord {
  year: number
  award: string
  playerId: string
  playerName: string
  teamAbbr: string
  /** Human-readable value, e.g. "52 G" or ".931". */
  value: string
}

export interface LegendRecord {
  playerId: string
  name: string
  retiredYear: number
  careerPoints: number
  careerGoals: number
  careerGames: number
  hallOfFame: boolean
}

export interface RecordsState {
  singleSeason: {
    goals: RecordEntry[]
    assists: RecordEntry[]
    points: RecordEntry[]
    wins: RecordEntry[]
    savePct: RecordEntry[]
    shutouts?: RecordEntry[]
  }
  career: {
    goals: RecordEntry[]
    assists: RecordEntry[]
    points: RecordEntry[]
    gamesPlayed: RecordEntry[]
  }
  seasons: SeasonArchive[]
  awards: AwardRecord[]
  retiredLegends: LegendRecord[]
  /**
   * Keys of "pace watch" notifications already emitted, so we fire each
   * player × record × year alert at most once.
   * Format: "<playerId>:<stat>:<year>"
   */
  emittedPaceKeys: string[]
}

/** Return a fresh, empty RecordsState suitable for a new career. */
export function emptyRecords(): RecordsState {
  return {
    singleSeason: {
      goals: [],
      assists: [],
      points: [],
      wins: [],
      savePct: [],
      shutouts: [],
    },
    career: {
      goals: [],
      assists: [],
      points: [],
      gamesPlayed: [],
    },
    seasons: [],
    awards: [],
    retiredLegends: [],
    emittedPaceKeys: [],
  }
}

/* ────────────────────────── news seed ────────────────────────── */

/** Minimal shape returned to the career layer; career.ts stamps the real id/day/year. */
export interface NewsSeed {
  category: 'award' | 'league' | 'milestone'
  headline: string
  body: string
  playerId?: string
  teamId?: string
}

/* ────────────────────────── season line (one player's season totals) ────────────────────────── */

export interface SeasonLine {
  playerId: string
  name: string
  teamAbbr: string
  /** 'C' | 'W' | 'D' | 'G' */
  position: string
  goals: number
  assists: number
  points: number
  gamesPlayed: number
  /** Goalie wins; 0 for skaters. */
  goalieWins: number
  /** Goalie save percentage; 0 for skaters. */
  savePct: number
  /** Total shots faced; used for savePct qualification. */
  shotsAgainst: number
}

/* ────────────────────────── internal helpers ────────────────────────── */

const TOP_N = 10
const SAVE_PCT_MIN_SHOTS = 600
const LEGEND_POINTS_THRESHOLD = 400
const HOF_WAIT_SEASONS = 3

function insertSorted(
  board: RecordEntry[],
  entry: RecordEntry,
  ascending = false,
): RecordEntry[] {
  const updated = [...board, entry]
  updated.sort((a, b) => (ascending ? a.value - b.value : b.value - a.value))
  return updated.slice(0, TOP_N)
}

/**
 * Insert into board and return both the updated board AND whether the entry
 * cracked the top-3 positions (triggers a record-breaking news item).
 */
function insertAndCheckTopThree(
  board: RecordEntry[],
  entry: RecordEntry,
  ascending = false,
): { updated: RecordEntry[]; brokeTopThree: boolean; displaced: RecordEntry | null } {
  const updated = insertSorted(board, entry, ascending)
  const newRank = updated.findIndex(
    (e) => e.playerId === entry.playerId && e.year === entry.year && e.value === entry.value,
  )
  // Did this entry land in positions 0-2 (top 3)?
  const brokeTopThree = newRank !== -1 && newRank < 3
  // Who was previously at that rank (if the list grew from ≥3 entries)?
  const displaced = brokeTopThree && board.length >= 3 ? board[newRank] ?? null : null
  return { updated, brokeTopThree, displaced }
}

function recordLabel(stat: string): string {
  switch (stat) {
    case 'goals': return 'goal'
    case 'assists': return 'assist'
    case 'points': return 'point'
    case 'wins': return 'win'
    case 'savePct': return 'save-percentage'
    case 'shutouts': return 'shutout'
    default: return stat
  }
}

/**
 * Format a stat value for display in a news headline.
 * savePct is stored as a 0-1 float; others are integers.
 */
function fmtValue(stat: string, value: number): string {
  if (stat === 'savePct') return value.toFixed(3).replace(/^0/, '')
  return String(value)
}

function recordBreakHeadline(
  entry: RecordEntry,
  stat: string,
  isAllTime: boolean,
): string {
  const label = recordLabel(stat)
  const fv = fmtValue(stat, entry.value)
  const kind = isAllTime ? 'all-time league record' : 'top-3 league mark'
  return `${entry.playerName} breaks the ${kind} for single-season ${label}s with ${fv}`
}

function recordBreakBody(
  entry: RecordEntry,
  stat: string,
  displaced: RecordEntry | null,
): string {
  const fv = fmtValue(stat, entry.value)
  const label = recordLabel(stat)
  let body = `${entry.playerName} (${entry.teamAbbr}) recorded ${fv} ${label}s in the ${entry.year} season.`
  if (displaced) {
    const dv = fmtValue(stat, displaced.value)
    body += ` The previous record was held by ${displaced.playerName} (${displaced.teamAbbr}, ${displaced.year}) with ${dv}.`
  }
  return body
}

/* Accumulate career totals across all archived seasons for a given player. */
function buildCareerEntry(
  playerId: string,
  name: string,
  teamAbbr: string,
  year: number,
  careerGoals: number,
  careerAssists: number,
  careerPoints: number,
  careerGames: number,
): {
  goals: RecordEntry
  assists: RecordEntry
  points: RecordEntry
  gamesPlayed: RecordEntry
} {
  return {
    goals: { value: careerGoals, playerId, playerName: name, teamAbbr, year },
    assists: { value: careerAssists, playerId, playerName: name, teamAbbr, year },
    points: { value: careerPoints, playerId, playerName: name, teamAbbr, year },
    gamesPlayed: { value: careerGames, playerId, playerName: name, teamAbbr, year },
  }
}

/** Rebuild career boards from scratch by re-folding all season archives. */
function rebuildCareerBoardsFromLines(
  existingCareer: RecordsState['career'],
  newPlayerId: string,
  newName: string,
  newTeamAbbr: string,
  newYear: number,
  deltaGoals: number,
  deltaAssists: number,
  deltaGames: number,
): RecordsState['career'] {
  // Find this player's existing entry on any board (take from points board as canonical)
  const existing = existingCareer.points.find((e) => e.playerId === newPlayerId)
  const prevGoals = existingCareer.goals.find((e) => e.playerId === newPlayerId)?.value ?? 0
  const prevAssists = existingCareer.assists.find((e) => e.playerId === newPlayerId)?.value ?? 0
  const prevGames = existingCareer.gamesPlayed.find((e) => e.playerId === newPlayerId)?.value ?? 0

  // Accumulate
  const totalGoals = prevGoals + deltaGoals
  const totalAssists = prevAssists + deltaAssists
  const totalPoints = totalGoals + totalAssists
  const totalGames = prevGames + deltaGames

  // Use existing year if player was already on a board, else new year
  const entryYear = existing ? existing.year : newYear

  const entries = buildCareerEntry(
    newPlayerId,
    newName,
    newTeamAbbr,
    entryYear,
    totalGoals,
    totalAssists,
    totalPoints,
    totalGames,
  )

  // Remove old entries for this player, insert updated
  const removePlayer = (board: RecordEntry[]) =>
    board.filter((e) => e.playerId !== newPlayerId)

  const career: RecordsState['career'] = {
    goals: insertSorted(removePlayer(existingCareer.goals), entries.goals),
    assists: insertSorted(removePlayer(existingCareer.assists), entries.assists),
    points: insertSorted(removePlayer(existingCareer.points), entries.points),
    gamesPlayed: insertSorted(removePlayer(existingCareer.gamesPlayed), entries.gamesPlayed),
  }

  return career
}

/* ────────────────────────── archiveSeason ────────────────────────── */

export interface ArchiveSeasonArgs {
  state: RecordsState
  year: number
  champion: { teamId: string; name: string } | null
  presidentsName: string | null
  userRank: number
  seasonLines: SeasonLine[]
  awards: Array<{ award: string; playerId: string; name: string; teamAbbr: string; value: string }>
}

export interface ArchiveSeasonResult {
  newsSeeds: NewsSeed[]
}

/**
 * Fold a completed season into the records state.
 *
 * - Updates single-season top-10 boards (goals, assists, points, wins, savePct, shutouts).
 * - Emits news when a top-3 single-season record falls.
 * - Accumulates career boards.
 * - Appends a SeasonArchive and the season's AwardRecords.
 */
export function archiveSeason(args: ArchiveSeasonArgs): ArchiveSeasonResult {
  const { state, year, champion, presidentsName, userRank, seasonLines, awards } = args
  const newsSeeds: NewsSeed[] = []

  /* ── single-season boards ── */

  type StatKey = 'goals' | 'assists' | 'points' | 'wins' | 'savePct'

  for (const line of seasonLines) {
    const isGoalie = line.position === 'G'

    const safeStats: Array<{ key: StatKey; value: number }> = isGoalie
      ? [
          { key: 'wins', value: line.goalieWins },
          ...(line.shotsAgainst >= SAVE_PCT_MIN_SHOTS
            ? [{ key: 'savePct' as StatKey, value: line.savePct }]
            : []),
        ]
      : [
          { key: 'goals', value: line.goals },
          { key: 'assists', value: line.assists },
          { key: 'points', value: line.points },
        ]

    const entry: RecordEntry = {
      value: 0, // filled per stat
      playerId: line.playerId,
      playerName: line.name,
      teamAbbr: line.teamAbbr,
      year,
    }

    for (const { key, value } of safeStats) {
      if (value <= 0 && key !== 'savePct') continue

      const board = state.singleSeason[key]
      const e: RecordEntry = { ...entry, value }
      const isAllTime = board.length === 0 || value > board[0]!.value

      const { updated, brokeTopThree, displaced } = insertAndCheckTopThree(board, e)
      state.singleSeason[key] = updated

      if (brokeTopThree) {
        newsSeeds.push({
          category: 'milestone',
          headline: recordBreakHeadline(e, key, isAllTime),
          body: recordBreakBody(e, key, displaced),
          playerId: line.playerId,
        })
      }
    }

    /* ── career boards ── */
    if (!isGoalie) {
      state.career = rebuildCareerBoardsFromLines(
        state.career,
        line.playerId,
        line.name,
        line.teamAbbr,
        year,
        line.goals,
        line.assists,
        line.gamesPlayed,
      )
    }
  }

  /* ── season leaders snapshot (for archive header) ── */
  const pointsLeader = seasonLines
    .filter((l) => l.position !== 'G')
    .sort((a, b) => b.points - a.points)[0]

  const goalsLeader = seasonLines
    .filter((l) => l.position !== 'G')
    .sort((a, b) => b.goals - a.goals)[0]

  const winsLeader = seasonLines
    .filter((l) => l.position === 'G')
    .sort((a, b) => b.goalieWins - a.goalieWins)[0]

  const toEntry = (l: SeasonLine | undefined, value: number): RecordEntry | null =>
    l
      ? { value, playerId: l.playerId, playerName: l.name, teamAbbr: l.teamAbbr, year }
      : null

  const archive: SeasonArchive = {
    year,
    championTeamId: champion?.teamId ?? null,
    championName: champion?.name ?? null,
    presidentsTeamName: presidentsName,
    userTeamRank: userRank,
    leaders: {
      points: toEntry(pointsLeader, pointsLeader?.points ?? 0),
      goals: toEntry(goalsLeader, goalsLeader?.goals ?? 0),
      wins: toEntry(winsLeader, winsLeader?.goalieWins ?? 0),
    },
  }
  state.seasons.push(archive)

  /* ── awards ── */
  for (const a of awards) {
    state.awards.push({
      year,
      award: a.award,
      playerId: a.playerId,
      playerName: a.name,
      teamAbbr: a.teamAbbr,
      value: a.value,
    })
  }

  return { newsSeeds }
}

/* ────────────────────────── recordWatch ────────────────────────── */

export interface RecordWatchArgs {
  state: RecordsState
  /** Current (partial) season stats for all players. */
  seasonLines: SeasonLine[]
  year: number
  /** Number of games the team has played so far (used for pace calculation). */
  teamGamesPlayed: number
  /** Total regular-season games in a full season (ruleset-aware). */
  totalSeasonGames: number
}

export interface RecordWatchResult {
  newsSeeds: NewsSeed[]
}

/**
 * Mid-season pace detection: once a team has played ≥ 30 games, check whether
 * any player is on pace to beat a top-3 all-time single-season record. Emits
 * the news seed at most once per player × stat × year combination.
 */
export function recordWatch(args: RecordWatchArgs): RecordWatchResult {
  const { state, seasonLines, year, teamGamesPlayed, totalSeasonGames } = args
  const newsSeeds: NewsSeed[] = []

  if (teamGamesPlayed < 30) return { newsSeeds }
  if (totalSeasonGames <= 0) return { newsSeeds }

  const pace = (current: number) => (current / teamGamesPlayed) * totalSeasonGames

  type StatKey = 'goals' | 'assists' | 'points' | 'wins' | 'savePct'

  const statExtractors: Array<{
    key: StatKey
    extract: (l: SeasonLine) => number | null
    filter: (l: SeasonLine) => boolean
  }> = [
    {
      key: 'goals',
      extract: (l) => l.goals,
      filter: (l) => l.position !== 'G',
    },
    {
      key: 'assists',
      extract: (l) => l.assists,
      filter: (l) => l.position !== 'G',
    },
    {
      key: 'points',
      extract: (l) => l.points,
      filter: (l) => l.position !== 'G',
    },
    {
      key: 'wins',
      extract: (l) => l.goalieWins,
      filter: (l) => l.position === 'G',
    },
    {
      key: 'savePct',
      extract: (l) =>
        l.shotsAgainst >= (SAVE_PCT_MIN_SHOTS * teamGamesPlayed) / totalSeasonGames
          ? l.savePct
          : null,
      filter: (l) => l.position === 'G',
    },
  ]

  for (const { key, extract, filter } of statExtractors) {
    const board = state.singleSeason[key]
    if (board.length < 3) continue
    const top3Record = board[2]! // third-best is the threshold to beat

    for (const line of seasonLines) {
      if (!filter(line)) continue

      const current = extract(line)
      if (current === null) continue

      const projected = pace(current)
      if (projected <= top3Record.value) continue

      // Would beat top-3 — check if we've already emitted this alert
      const emitKey = `${line.playerId}:${key}:${year}`
      if (state.emittedPaceKeys.includes(emitKey)) continue

      state.emittedPaceKeys.push(emitKey)

      const fv = key === 'savePct' ? projected.toFixed(3).replace(/^0/, '') : Math.round(projected).toString()
      const label = recordLabel(key)
      newsSeeds.push({
        category: 'milestone',
        headline: `${line.name} on pace to crack the all-time top-3 ${label} record`,
        body:
          `${line.name} (${line.teamAbbr}) is currently tracking toward ${fv} ${label}s this season, ` +
          `which would surpass the 3rd-best single-season mark of ${fmtValue(key, top3Record.value)} ` +
          `set by ${top3Record.playerName} in ${top3Record.year}.`,
        playerId: line.playerId,
      })
    }
  }

  return { newsSeeds }
}

/* ────────────────────────── registerRetirements ────────────────────────── */

export interface RetirementEntry {
  playerId: string
  name: string
  careerGoals: number
  careerAssists: number
  careerPoints: number
  careerGames: number
}

export interface RegisterRetirementsArgs {
  state: RecordsState
  retirees: RetirementEntry[]
  year: number
}

export interface RegisterRetirementsResult {
  newsSeeds: NewsSeed[]
}

/**
 * Called at end of offseason with the list of retiring players.
 * Adds to retiredLegends when the player meets the threshold (careerPoints
 * > LEGEND_POINTS_THRESHOLD or is on the career top-10 boards). Emits a
 * retirement news seed for every legend.
 */
export function registerRetirements(args: RegisterRetirementsArgs): RegisterRetirementsResult {
  const { state, retirees, year } = args
  const newsSeeds: NewsSeed[] = []

  for (const r of retirees) {
    // Qualify as a legend: either exceeds career-points threshold OR appears
    // on any of the top-10 career boards.
    const onBoard =
      state.career.points.some((e) => e.playerId === r.playerId) ||
      state.career.goals.some((e) => e.playerId === r.playerId) ||
      state.career.assists.some((e) => e.playerId === r.playerId) ||
      state.career.gamesPlayed.some((e) => e.playerId === r.playerId)

    const isLegend = r.careerPoints > LEGEND_POINTS_THRESHOLD || onBoard
    if (!isLegend) continue

    // Avoid duplicate entries (player might retire twice via data oddity)
    if (state.retiredLegends.some((l) => l.playerId === r.playerId)) continue

    const legend: LegendRecord = {
      playerId: r.playerId,
      name: r.name,
      retiredYear: year,
      careerPoints: r.careerPoints,
      careerGoals: r.careerGoals,
      careerGames: r.careerGames,
      hallOfFame: false,
    }
    state.retiredLegends.push(legend)

    const awardsForPlayer = state.awards.filter((a) => a.playerId === r.playerId)
    const awardSummary =
      awardsForPlayer.length > 0
        ? ` Career honours: ${awardsForPlayer.map((a) => a.award).join(', ')}.`
        : ''

    newsSeeds.push({
      category: 'league',
      headline: `${r.name} retires after a legendary career`,
      body:
        `${r.name} has hung up the skates after ${r.careerGames} games, ${r.careerGoals} goals, ` +
        `${r.careerAssists} assists and ${r.careerPoints} points.${awardSummary}`,
      playerId: r.playerId,
    })
  }

  return { newsSeeds }
}

/* ────────────────────────── inductHallOfFame ────────────────────────── */

/**
 * Called once per season (offseason). Inducts players who retired exactly
 * HOF_WAIT_SEASONS ago (3 seasons) and are still not inducted. Returns news
 * seeds with career retrospective bodies.
 */
export function inductHallOfFame(state: RecordsState, year: number): NewsSeed[] {
  const newsSeeds: NewsSeed[] = []
  const inductionClass = year - HOF_WAIT_SEASONS

  for (const legend of state.retiredLegends) {
    if (legend.hallOfFame) continue
    if (legend.retiredYear !== inductionClass) continue

    legend.hallOfFame = true

    // Build retrospective body
    const awardsForPlayer = state.awards.filter((a) => a.playerId === legend.playerId)
    const recordsHeld: string[] = []

    if (state.career.points[0]?.playerId === legend.playerId)
      recordsHeld.push('all-time career points leader')
    if (state.career.goals[0]?.playerId === legend.playerId)
      recordsHeld.push('all-time career goals leader')
    if (state.singleSeason.points[0]?.playerId === legend.playerId)
      recordsHeld.push(`single-season points record (${state.singleSeason.points[0].value})`)
    if (state.singleSeason.goals[0]?.playerId === legend.playerId)
      recordsHeld.push(`single-season goals record (${state.singleSeason.goals[0].value})`)

    const awardPart =
      awardsForPlayer.length > 0
        ? ` Awards include: ${awardsForPlayer.map((a) => `${a.award} (${a.year})`).join(', ')}.`
        : ''

    const recordPart =
      recordsHeld.length > 0 ? ` ${legend.name} holds: ${recordsHeld.join('; ')}.` : ''

    newsSeeds.push({
      category: 'award',
      headline: `${legend.name} inducted into the Hall of Fame`,
      body:
        `${legend.name} is inducted into the Hall of Fame, ${HOF_WAIT_SEASONS} seasons after ` +
        `retiring in ${legend.retiredYear}. Career: ${legend.careerGames} GP, ` +
        `${legend.careerGoals} G, ${legend.careerPoints} PTS.${awardPart}${recordPart}`,
      playerId: legend.playerId,
    })
  }

  return newsSeeds
}
