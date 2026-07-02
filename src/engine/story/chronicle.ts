/**
 * The World Chronicle — the game's permanent memory (Living World epic, LW1).
 *
 * An append-only record of significant events with actors and structured
 * details, persisted for the whole career so news/UI can cite specific facts
 * ("X, who you traded a 2nd for at last year's deadline…"). Also tracks
 * all-time head-to-head records per team pair and player provenance
 * (drafted-by, every acquisition).
 *
 * Pure observer: the chronicle only RECORDS what other systems do — it has
 * zero sim impact. JSON-safe (entry arrays, no Maps). See docs/LIVING-WORLD.md.
 */

/* ────────────────────────── types ────────────────────────── */

export type ChronicleEventKind =
  | 'trade'
  | 'signing'
  | 'draftPick'
  | 'release'
  | 'waiverClaim'
  | 'callup'
  | 'coachHired'
  | 'coachFired'
  | 'gmChange'
  | 'majorInjury'
  | 'recordBroken'
  | 'award'
  | 'playoffSeries'
  | 'championship'
  | 'milestone'
  | 'promise'
  | 'retirement'
  | 'debut'

/** One side of a trade / a draft asset — enough to reconstruct the deal later. */
export interface ChronicleAsset {
  kind: 'player' | 'pick'
  playerId?: string
  /** Stable pick reference, e.g. "2028-R2-NYR". */
  pickRef?: string
  /** Human label at the time ("F Reilly Smith", "2028 2nd (NYR)"). */
  label: string
}

export interface ChronicleEvent {
  /** Stable id: `ch-${year}-${counter}`. */
  id: string
  year: number
  /** Match-day within the year; 0 for offseason events. */
  day: number
  kind: ChronicleEventKind
  teamIds: string[]
  playerIds: string[]
  staffIds?: string[]
  /** One factual human line ("PIT trade F Smith to NYR for a 2028 2nd"). */
  headline: string
  /** Structured details for causal queries. All optional. */
  details?: {
    /** trade: what each side gave up. assetsOut = teamIds[0]'s outgoing. */
    assetsOut?: ChronicleAsset[]
    assetsIn?: ChronicleAsset[]
    /** draftPick */
    round?: number
    overallPick?: number
    /** Chronicle id of the trade that moved this pick (causal chain). */
    viaTradeEventId?: string
    /** playoffSeries: e.g. "PIT def. NYR 4-2". */
    result?: string
    /** signing */
    salary?: number
    years?: number
    /** promise: what was promised + due horizon. */
    promiseKind?: string
    dueYear?: number
    /** promise criterion value (rank / GP threshold / …). */
    value?: number
    /** promise: how many players must satisfy the criterion. */
    count?: number
    /** promise: verdict once evaluated ('met' | 'missed'). */
    resolved?: string
  }
  /** True when the user's club was involved (fast filter for "your history"). */
  userInvolved: boolean
}

/** All-time record between two clubs, keyed by sorted team-id pair. */
export interface HeadToHead {
  /** Wins for the lexicographically-smaller team id of the pair. */
  aWins: number
  bWins: number
  /** Of which came in OT/SO. */
  aOtWins: number
  bOtWins: number
  /** Total goals each side has scored in the matchup. */
  aGoals: number
  bGoals: number
  /** Playoff series won by each side. */
  aSeries: number
  bSeries: number
  lastMeetingYear: number
}

export interface PlayerAcquisition {
  year: number
  via: 'draft' | 'trade' | 'signing' | 'waiver' | 'expansion'
  teamId: string
  fromTeamId?: string
  /** Chronicle event backing this acquisition. */
  eventId?: string
}

export interface PlayerProvenance {
  draftedBy?: string
  draftYear?: number
  round?: number
  overallPick?: number
  /** Every change of organisation, oldest first. */
  acquisitions: PlayerAcquisition[]
}

export interface ChronicleState {
  events: ChronicleEvent[]
  counter: number
  /** [pairKey, record] — pairKey = sorted `${a}|${b}`. */
  headToHead: Array<[string, HeadToHead]>
  /** [playerId, provenance]. */
  provenance: Array<[string, PlayerProvenance]>
}

/* ────────────────────────── construction ────────────────────────── */

export function emptyChronicle(): ChronicleState {
  return { events: [], counter: 0, headToHead: [], provenance: [] }
}

/** Kinds kept forever; everything else is pruned after PRUNE_AFTER_YEARS. */
const DURABLE_KINDS: ReadonlySet<ChronicleEventKind> = new Set([
  'trade', 'draftPick', 'championship', 'playoffSeries', 'award',
  'recordBroken', 'retirement', 'gmChange', 'coachHired', 'coachFired',
  'promise', 'milestone',
])
const PRUNE_AFTER_YEARS = 5
/** Amortise pruning: sweep once per this many appended events. */
const PRUNE_EVERY = 500

export interface RecordEventArgs {
  year: number
  day: number
  kind: ChronicleEventKind
  teamIds: string[]
  playerIds?: string[]
  staffIds?: string[]
  headline: string
  details?: ChronicleEvent['details']
  userInvolved: boolean
}

/** Append an event (mutates state) and return it. */
export function recordEvent(state: ChronicleState, args: RecordEventArgs): ChronicleEvent {
  state.counter += 1
  const ev: ChronicleEvent = {
    id: `ch-${args.year}-${String(state.counter).padStart(6, '0')}`,
    year: args.year,
    day: args.day,
    kind: args.kind,
    teamIds: [...args.teamIds],
    playerIds: [...(args.playerIds ?? [])],
    ...(args.staffIds ? { staffIds: [...args.staffIds] } : {}),
    headline: args.headline,
    ...(args.details ? { details: { ...args.details } } : {}),
    userInvolved: args.userInvolved,
  }
  state.events.push(ev)
  if (state.counter % PRUNE_EVERY === 0) pruneChronicle(state, args.year)
  return ev
}

/** Drop old ephemeral events (durable kinds + user history are kept forever). */
export function pruneChronicle(state: ChronicleState, currentYear: number): void {
  state.events = state.events.filter(
    (e) => DURABLE_KINDS.has(e.kind) || e.userInvolved || currentYear - e.year < PRUNE_AFTER_YEARS
  )
}

/* ────────────────────────── head-to-head ────────────────────────── */

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function h2hEntry(state: ChronicleState, a: string, b: string): HeadToHead {
  const key = pairKey(a, b)
  let entry = state.headToHead.find(([k]) => k === key)?.[1]
  if (!entry) {
    entry = { aWins: 0, bWins: 0, aOtWins: 0, bOtWins: 0, aGoals: 0, bGoals: 0, aSeries: 0, bSeries: 0, lastMeetingYear: 0 }
    state.headToHead.push([key, entry])
  }
  return entry
}

/** Record one regular-season/playoff GAME into the all-time matchup record. */
export function recordMeeting(state: ChronicleState, args: {
  homeTeamId: string
  awayTeamId: string
  homeGoals: number
  awayGoals: number
  overtime: boolean
  year: number
}): void {
  const { homeTeamId, awayTeamId } = args
  const entry = h2hEntry(state, homeTeamId, awayTeamId)
  const homeIsA = homeTeamId < awayTeamId
  const homeWon = args.homeGoals > args.awayGoals
  const winnerIsA = homeIsA === homeWon
  if (winnerIsA) {
    entry.aWins += 1
    if (args.overtime) entry.aOtWins += 1
  } else {
    entry.bWins += 1
    if (args.overtime) entry.bOtWins += 1
  }
  entry.aGoals += homeIsA ? args.homeGoals : args.awayGoals
  entry.bGoals += homeIsA ? args.awayGoals : args.homeGoals
  entry.lastMeetingYear = args.year
}

/** Record a decided playoff SERIES into the matchup record. */
export function recordSeries(state: ChronicleState, args: {
  winnerTeamId: string
  loserTeamId: string
  year: number
}): void {
  const entry = h2hEntry(state, args.winnerTeamId, args.loserTeamId)
  if (args.winnerTeamId < args.loserTeamId) entry.aSeries += 1
  else entry.bSeries += 1
  entry.lastMeetingYear = args.year
}

/** All-time record from `teamId`'s perspective vs `otherId` (null = never met). */
export function headToHead(state: ChronicleState, teamId: string, otherId: string): {
  wins: number; losses: number; otWins: number; goalsFor: number; goalsAgainst: number
  seriesWins: number; seriesLosses: number; lastMeetingYear: number
} | null {
  const key = pairKey(teamId, otherId)
  const entry = state.headToHead.find(([k]) => k === key)?.[1]
  if (!entry) return null
  const isA = teamId < otherId
  return {
    wins: isA ? entry.aWins : entry.bWins,
    losses: isA ? entry.bWins : entry.aWins,
    otWins: isA ? entry.aOtWins : entry.bOtWins,
    goalsFor: isA ? entry.aGoals : entry.bGoals,
    goalsAgainst: isA ? entry.bGoals : entry.aGoals,
    seriesWins: isA ? entry.aSeries : entry.bSeries,
    seriesLosses: isA ? entry.bSeries : entry.aSeries,
    lastMeetingYear: entry.lastMeetingYear,
  }
}

/* ────────────────────────── provenance ────────────────────────── */

function provenanceEntry(state: ChronicleState, playerId: string): PlayerProvenance {
  let entry = state.provenance.find(([id]) => id === playerId)?.[1]
  if (!entry) {
    entry = { acquisitions: [] }
    state.provenance.push([playerId, entry])
  }
  return entry
}

/** Record where a player was drafted (call once, at selection). */
export function recordDraftProvenance(state: ChronicleState, args: {
  playerId: string
  teamId: string
  year: number
  round: number
  overallPick: number
  eventId?: string
}): void {
  const entry = provenanceEntry(state, args.playerId)
  entry.draftedBy = args.teamId
  entry.draftYear = args.year
  entry.round = args.round
  entry.overallPick = args.overallPick
  entry.acquisitions.push({
    year: args.year, via: 'draft', teamId: args.teamId,
    ...(args.eventId ? { eventId: args.eventId } : {}),
  })
}

/** Record a change of organisation (trade/signing/waiver). */
export function recordAcquisition(state: ChronicleState, args: {
  playerId: string
  teamId: string
  year: number
  via: PlayerAcquisition['via']
  fromTeamId?: string
  eventId?: string
}): void {
  provenanceEntry(state, args.playerId).acquisitions.push({
    year: args.year, via: args.via, teamId: args.teamId,
    ...(args.fromTeamId ? { fromTeamId: args.fromTeamId } : {}),
    ...(args.eventId ? { eventId: args.eventId } : {}),
  })
}

export function provenanceOf(state: ChronicleState, playerId: string): PlayerProvenance | null {
  return state.provenance.find(([id]) => id === playerId)?.[1] ?? null
}

/** Teams a player previously belonged to (excluding his current club). */
export function formerTeams(state: ChronicleState, playerId: string, currentTeamId: string): string[] {
  const prov = provenanceOf(state, playerId)
  if (!prov) return []
  const seen = new Set<string>()
  for (const a of prov.acquisitions) if (a.teamId !== currentTeamId) seen.add(a.teamId)
  return [...seen]
}

/* ────────────────────────── queries ────────────────────────── */

/** Most-recent-first events involving a player. */
export function eventsForPlayer(state: ChronicleState, playerId: string, limit = 20): ChronicleEvent[] {
  const out: ChronicleEvent[] = []
  for (let i = state.events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = state.events[i]!
    if (e.playerIds.includes(playerId)) out.push(e)
  }
  return out
}

/** Most-recent-first events involving a team. */
export function eventsForTeam(state: ChronicleState, teamId: string, limit = 20): ChronicleEvent[] {
  const out: ChronicleEvent[] = []
  for (let i = state.events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = state.events[i]!
    if (e.teamIds.includes(teamId)) out.push(e)
  }
  return out
}

/** All trades between two specific clubs, most recent first. */
export function tradesBetween(state: ChronicleState, teamA: string, teamB: string): ChronicleEvent[] {
  const out: ChronicleEvent[] = []
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i]!
    if (e.kind === 'trade' && e.teamIds.includes(teamA) && e.teamIds.includes(teamB)) out.push(e)
  }
  return out
}

/** What a traded pick turned into: the draftPick event whose viaTradeEventId chains to the trade. */
export function pickBecame(state: ChronicleState, tradeEventId: string): ChronicleEvent[] {
  return state.events.filter((e) => e.kind === 'draftPick' && e.details?.viaTradeEventId === tradeEventId)
}

/** The user's full history, most recent first (bounded). */
export function userHistory(state: ChronicleState, limit = 100): ChronicleEvent[] {
  const out: ChronicleEvent[] = []
  for (let i = state.events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = state.events[i]!
    if (e.userInvolved) out.push(e)
  }
  return out
}

/** Events from exactly N years ago (for anniversary callbacks). */
export function anniversaries(state: ChronicleState, currentYear: number, currentDay: number, opts?: {
  yearsAgo?: number[]
  dayTolerance?: number
}): ChronicleEvent[] {
  const yearsAgo = opts?.yearsAgo ?? [1, 3, 5, 10]
  const tol = opts?.dayTolerance ?? 2
  return state.events.filter((e) =>
    DURABLE_KINDS.has(e.kind) &&
    yearsAgo.includes(currentYear - e.year) &&
    Math.abs(e.day - currentDay) <= tol
  )
}
