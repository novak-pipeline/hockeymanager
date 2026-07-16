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

/* ────────────────────────── seeded pre-history ────────────────────────── */

export interface SeedTeamRef {
  id: string
  abbreviation: string
  name: string
}

export interface SeedHistoryArgs {
  teams: SeedTeamRef[]
  /** The season the career begins on; history fills the years before it. */
  currentYear: number
  /** How many past seasons to fabricate (default 15). */
  yearsBack?: number
  /** Deterministic RNG source: returns a float in [0,1). */
  rand: () => number
  /** Deterministic full-name maker (built by the caller from its name pools). */
  makeName: () => string
}

/** Deterministic integer in [lo, hi]. */
function randInt(rand: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1))
}
function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))]!
}

/**
 * Give a brand-new career a plausible PAST so the record book and banner
 * rafters aren't empty on day one — franchises with championship pedigree,
 * retired legends in the Hall of Fame, and all-time single-season / career
 * leaderboards. Pure + deterministic (seeded RNG). Fictional-but-grounded: it
 * invents names and numbers in realistic NHL bands; it never claims to be the
 * real league's actual history.
 */
export function seedRecordsHistory(args: SeedHistoryArgs): RecordsState {
  const { teams, currentYear, rand, makeName } = args
  const yearsBack = args.yearsBack ?? 15
  const state = emptyRecords()
  if (teams.length === 0) return state

  // A few franchises carry dynasty pedigree — they win more often, like the
  // real league's cap-era heavyweights.
  const dynastyCount = Math.max(1, Math.round(teams.length * 0.18))
  const dynasties = [...teams].sort(() => rand() - 0.5).slice(0, dynastyCount)
  const championPool = [...dynasties, ...dynasties, ...teams] // dynasties weighted ~3x

  const seasonLeaderNames: Array<{ name: string; team: SeedTeamRef; year: number; pts: number; g: number }> = []

  for (let y = currentYear - yearsBack; y < currentYear; y++) {
    const champ = pick(rand, championPool)
    const pres = rand() < 0.45 ? champ : pick(rand, teams) // often the same club
    const scorerTeam = pick(rand, teams)
    const goalTeam = pick(rand, teams)
    const winTeam = pick(rand, teams)
    const pts = randInt(rand, 95, 135)
    const g = randInt(rand, 40, 66)
    const scorer = makeName()
    seasonLeaderNames.push({ name: scorer, team: scorerTeam, year: y, pts, g })
    state.seasons.push({
      year: y,
      championTeamId: champ.id,
      championName: champ.name,
      presidentsTeamName: pres.name,
      userTeamRank: 0, // no user before the career began
      leaders: {
        points: { value: pts, playerId: `hist-${y}-p`, playerName: scorer, teamAbbr: scorerTeam.abbreviation, year: y },
        goals: { value: g, playerId: `hist-${y}-g`, playerName: makeName(), teamAbbr: goalTeam.abbreviation, year: y },
        wins: { value: randInt(rand, 38, 54), playerId: `hist-${y}-w`, playerName: makeName(), teamAbbr: winTeam.abbreviation, year: y },
      },
    })
    // A Hart-style MVP each year.
    state.awards.push({
      year: y, award: 'Most Valuable Player', playerId: `hist-${y}-mvp`,
      playerName: scorer, teamAbbr: scorerTeam.abbreviation, value: `${pts} PTS`,
    })
  }

  // Retired legends spread across the eras — the best make the Hall of Fame.
  const legendCount = Math.max(8, Math.round(teams.length * 1.1))
  for (let i = 0; i < legendCount; i++) {
    const name = makeName()
    const retiredYear = randInt(rand, currentYear - yearsBack - 6, currentYear - 1)
    const games = randInt(rand, 620, 1500)
    const ppg = 0.55 + rand() * 0.75 // 0.55–1.30 pts/game
    const careerPoints = Math.round(games * ppg)
    const careerGoals = Math.round(careerPoints * (0.34 + rand() * 0.12))
    state.retiredLegends.push({
      playerId: `legend-${i}`,
      name,
      retiredYear,
      careerPoints,
      careerGoals,
      careerGames: games,
      hallOfFame: careerPoints >= HOF_POINTS_THRESHOLD, // the true greats
    })
  }

  // Build all-time leaderboards from the seeded material.
  const abbrOf = (): string => pick(rand, teams).abbreviation
  const careerEntries = state.retiredLegends.map((l) => ({
    playerId: l.playerId, playerName: l.name, teamAbbr: abbrOf(), year: l.retiredYear,
  }))
  const top = <T extends { value: number }>(xs: T[], n = 8): T[] =>
    [...xs].sort((a, b) => b.value - a.value).slice(0, n)
  state.career.points = top(state.retiredLegends.map((l, i) => ({ ...careerEntries[i]!, value: l.careerPoints })))
  state.career.goals = top(state.retiredLegends.map((l, i) => ({ ...careerEntries[i]!, value: l.careerGoals })))
  state.career.assists = top(state.retiredLegends.map((l, i) => ({ ...careerEntries[i]!, value: l.careerPoints - l.careerGoals })))
  state.career.gamesPlayed = top(state.retiredLegends.map((l, i) => ({ ...careerEntries[i]!, value: l.careerGames })))
  state.singleSeason.points = top(seasonLeaderNames.map((s) => ({ value: s.pts, playerId: `ss-${s.year}-p`, playerName: s.name, teamAbbr: s.team.abbreviation, year: s.year })))
  state.singleSeason.goals = top(seasonLeaderNames.map((s) => ({ value: s.g, playerId: `ss-${s.year}-g`, playerName: s.name, teamAbbr: s.team.abbreviation, year: s.year })))
  state.singleSeason.assists = top(seasonLeaderNames.map((s) => ({ value: Math.round(s.pts - s.g), playerId: `ss-${s.year}-a`, playerName: s.name, teamAbbr: s.team.abbreviation, year: s.year })))
  state.singleSeason.wins = top(state.seasons.map((sn) => ({ ...(sn.leaders.wins ?? { value: 0, playerId: '', playerName: '', teamAbbr: '', year: sn.year }) })))
  return state
}

/* ────────────────────────── real imported history ────────────────────────── */

/** One franchise record row from the source DB (EHM club_records export). */
export interface ImportedClubRecord {
  club: string
  type: string
  year: number
  value: number
  player: string
}

/** One competition-season row (EHM club_competition_history export): who won
 *  the trophy (`champion`) and who topped the regular season (`regularChampion`). */
export interface ImportedCompetitionSeason {
  competition: string
  year: number
  champion: string
  runnerUp: string
  third: string
  regularChampion: string
}

/** Real club/league history imported from a mod DB. Optional + additive; when
 *  present it seeds the record book with actual marks instead of fabricated ones. */
export interface ImportedHistory {
  clubRecords: ImportedClubRecord[]
  competitionHistory: ImportedCompetitionSeason[]
}

/** Which record book a raw EHM record `type` string feeds. */
const SINGLE_SEASON_RECORD_TYPES: Record<string, keyof RecordsState['singleSeason']> = {
  'Most goals in a season': 'goals',
  'Most assists in a season': 'assists',
  'Most points in a season': 'points',
  'Most wins in a season': 'wins',
  'Most shutouts in a season': 'shutouts',
}
const CAREER_RECORD_TYPES: Record<string, keyof RecordsState['career']> = {
  'Most career goals': 'goals',
  'Most career assists': 'assists',
  'Most career points': 'points',
  'Most career games': 'gamesPlayed',
}

/** Deterministic placeholder id for a historical name not in the live DB. The
 *  history screens render these as plain text (a profile lookup throws). */
function histId(name: string, salt: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `hist-${salt}-${slug || 'unknown'}`
}

/**
 * Seed the record book from a mod's REAL club/league history instead of a
 * fabricated past. Only the current league's own clubs contribute (so an
 * imported NHL cites NHL franchise records, not junior/minor/European marks),
 * and the champions come from whichever competition's winners overlap the
 * current clubs the most — the DB names the league differently ("National
 * Hockey League") than our meta ("NHL (EHM import)"), so we match by overlap,
 * not by name. Pure + deterministic: no RNG, no wall-clock.
 */
export function seedRecordsFromHistory(args: {
  history: ImportedHistory
  teams: SeedTeamRef[]
  currentYear: number
}): RecordsState {
  const { history, teams, currentYear } = args
  const state = emptyRecords()
  if (teams.length === 0) return state

  const clubNames = new Set(teams.map((t) => t.name))
  const abbrOf = new Map(teams.map((t) => [t.name, t.abbreviation] as const))
  const idOf = new Map(teams.map((t) => [t.name, t.id] as const))

  /* ── single-season + career leaderboards from this league's franchise records ── */
  const ssBoards: Record<string, RecordEntry[]> = {}
  const carBoards: Record<string, RecordEntry[]> = {}
  for (const r of history.clubRecords) {
    if (!clubNames.has(r.club)) continue // only our own league's clubs
    if (!Number.isFinite(r.value) || r.value <= 0 || !r.player) continue
    const ssKey = SINGLE_SEASON_RECORD_TYPES[r.type]
    const carKey = CAREER_RECORD_TYPES[r.type]
    const entry: RecordEntry = {
      value: r.value,
      playerId: histId(r.player, `${ssKey ?? carKey ?? 'x'}${r.year}`),
      playerName: r.player,
      teamAbbr: abbrOf.get(r.club) ?? '',
      year: r.year,
    }
    if (ssKey) (ssBoards[ssKey] ??= []).push(entry)
    else if (carKey) (carBoards[carKey] ??= []).push(entry)
  }
  const top = (xs: RecordEntry[]): RecordEntry[] =>
    [...xs].sort((a, b) => b.value - a.value).slice(0, TOP_N)
  for (const key of Object.keys(ssBoards)) {
    ;(state.singleSeason as Record<string, RecordEntry[]>)[key] = top(ssBoards[key]!)
  }
  for (const key of Object.keys(carBoards)) {
    ;(state.career as Record<string, RecordEntry[]>)[key] = top(carBoards[key]!)
  }

  /* ── champions + Presidents' from the best-overlapping competition ── */
  const byComp = new Map<string, ImportedCompetitionSeason[]>()
  for (const row of history.competitionHistory) {
    if (!byComp.has(row.competition)) byComp.set(row.competition, [])
    byComp.get(row.competition)!.push(row)
  }
  let bestComp: ImportedCompetitionSeason[] | null = null
  let bestOverlap = 0
  for (const rows of byComp.values()) {
    const champs = new Set(rows.map((r) => r.champion).filter(Boolean))
    let overlap = 0
    for (const c of champs) if (clubNames.has(c)) overlap++
    if (overlap > bestOverlap) { bestOverlap = overlap; bestComp = rows }
  }
  if (bestComp && bestOverlap > 0) {
    for (const row of bestComp) {
      if (row.year >= currentYear || !row.champion) continue
      state.seasons.push({
        year: row.year,
        championTeamId: (idOf.get(row.champion) as string | undefined) ?? null,
        championName: row.champion,
        presidentsTeamName: row.regularChampion || null,
        userTeamRank: 0, // no user before the career began
        leaders: { points: null, goals: null, wins: null }, // per-year leaders aren't in the export
      })
    }
    state.seasons.sort((a, b) => a.year - b.year)
  }

  /* ── retired legends from the real career-points board (populates the HoF) ── */
  const careerGoalsByName = new Map(state.career.goals.map((e) => [e.playerName, e.value] as const))
  const careerGamesByName = new Map(state.career.gamesPlayed.map((e) => [e.playerName, e.value] as const))
  for (const e of state.career.points) {
    if (e.value < LEGEND_POINTS_THRESHOLD) continue
    state.retiredLegends.push({
      playerId: histId(e.playerName, 'legend'),
      name: e.playerName,
      retiredYear: e.year,
      careerPoints: e.value,
      careerGoals: careerGoalsByName.get(e.playerName) ?? Math.round(e.value * 0.4),
      careerGames: careerGamesByName.get(e.playerName) ?? 0,
      hallOfFame: e.value >= HOF_POINTS_THRESHOLD,
    })
  }

  return state
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
  /** Goalie shutouts this season; 0 for skaters (optional — old callers omit). */
  shutouts?: number
}

/* ────────────────────────── internal helpers ────────────────────────── */

const TOP_N = 10
const SAVE_PCT_MIN_SHOTS = 600
/** Bar to be remembered as a retired legend (appears on the Legends screen). */
const LEGEND_POINTS_THRESHOLD = 400
/** Higher bar to actually be enshrined in the Hall of Fame. Only the elite of
 *  the notable retirees get a plaque; record-holders qualify regardless. */
const HOF_POINTS_THRESHOLD = 900
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

  type StatKey = 'goals' | 'assists' | 'points' | 'wins' | 'savePct' | 'shutouts'

  for (const line of seasonLines) {
    const isGoalie = line.position === 'G'

    const safeStats: Array<{ key: StatKey; value: number }> = isGoalie
      ? [
          { key: 'wins', value: line.goalieWins },
          { key: 'shutouts', value: line.shutouts ?? 0 },
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

      // Default for the optional shutouts board (absent on pre-shutouts saves).
      const board = state.singleSeason[key] ?? []
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

  type StatKey = 'goals' | 'assists' | 'points' | 'wins' | 'savePct' | 'shutouts'

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
      key: 'shutouts',
      extract: (l) => l.shutouts ?? 0,
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

  // Record-watch is RARE by design. Two rules keep it from flooding a league full
  // of scorers (the "5 million on-pace messages" bug): (1) only a genuine run at
  // the ALL-TIME #1 mark, clearly ahead of it (>3%), not merely top-3; (2) at most
  // ONE alert emitted per call — the most emphatic run — so other chasers surface
  // on later ticks instead of all at once. Per (player,stat,year) dedup still holds.
  type Cand = { seed: NewsSeed; emitKey: string; margin: number }
  const cands: Cand[] = []
  for (const { key, extract, filter } of statExtractors) {
    const board = state.singleSeason[key] ?? []
    if (board.length < 1) continue
    const record = board[0]! // the all-time single-season mark to break

    for (const line of seasonLines) {
      if (!filter(line)) continue
      const current = extract(line)
      if (current === null) continue

      // savePct is a RATE, not a counting stat — its season-end projection is just
      // the current rate, NOT games-extrapolated (pace() would absurdly scale .900
      // to >1.0 and hand it a bogus record chase).
      const projected = key === 'savePct' ? current : pace(current)
      if (projected <= record.value * 1.03) continue // clearly on pace to BREAK it

      const emitKey = `${line.playerId}:${key}:${year}`
      if (state.emittedPaceKeys.includes(emitKey)) continue

      const fv = key === 'savePct' ? projected.toFixed(3).replace(/^0/, '') : Math.round(projected).toString()
      const label = recordLabel(key)
      cands.push({
        emitKey,
        margin: record.value > 0 ? projected / record.value : projected,
        seed: {
          category: 'milestone',
          headline: `${line.name} on pace to break the all-time ${label} record`,
          body:
            `${line.name} (${line.teamAbbr}) is tracking toward ${fv} ${label}s this season, ` +
            `which would break the single-season record of ${fmtValue(key, record.value)} ` +
            `set by ${record.playerName} in ${record.year}.`,
          playerId: line.playerId,
        },
      })
    }
  }

  cands.sort((a, b) => b.margin - a.margin)
  const best = cands[0]
  if (best) {
    state.emittedPaceKeys.push(best.emitKey)
    newsSeeds.push(best.seed)
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

    // Build the retrospective (also used to decide eligibility — a record-holder
    // is enshrined even below the raw points bar).
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

    // Only the ELITE get a plaque — a notable career alone (400+ pts) makes the
    // Legends screen, but the Hall needs a truly great résumé or a record.
    const hofWorthy = legend.careerPoints >= HOF_POINTS_THRESHOLD || recordsHeld.length > 0
    if (!hofWorthy) continue

    legend.hallOfFame = true

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
