/**
 * Scouting domain types — JSON-safe, no Maps.
 *
 * ScoutingState is the serialized form that goes into CareerSnapshot. All
 * knowledge values are kept as an entry array so structured-clone and
 * JSON.stringify both work without any helpers.
 */

/** 0–100 knowledge of a player: 100 = exact ratings visible, 0 = total mystery. */
export type KnowledgeValue = number

/**
 * What a scout is watching. A SCOPE — which players cross his desk.
 * JSON-safe: a simple tagged object, no discriminated-union tricks.
 *
 * The modern scopes are `nation` (every league a country hosts), `competition`
 * (one league — incl. the synthetic 'nhl' / 'ahl' ids for the pro tiers) and
 * `nextOpponent` (advance-scout the user's next game). `team` / `division` /
 * `draftClass` / `freeAgents` are kept for specific assignments and back-compat
 * with older saves.
 */
export type ScoutTarget =
  | { kind: 'team';        teamId: string }
  | { kind: 'division';    divisionId: string }
  | { kind: 'competition'; competitionId: string }
  | { kind: 'nation';      nation: string }
  | { kind: 'player';      playerId: string }
  | { kind: 'nextOpponent' }
  | { kind: 'draftClass' }
  | { kind: 'freeAgents' }
  /** The club's own players + rights-held prospects, for up-to-date internal reads. */
  | { kind: 'ownProspects' }

/**
 * Who, WITHIN the scope, the scout prioritises. Youth = draft-age prospects
 * (the bulk of scouting); senior = pros, to keep NHL/AHL knowledge current;
 * all = everyone. Absent on older saves → treated as 'all'.
 */
export type ScoutFocus = 'youth' | 'senior' | 'all'

export interface ScoutAssignment {
  scoutId: string
  name: string
  /** 50–90 scout quality; higher quality → faster knowledge gain. */
  rating: number
  /** 0–100 judgment of the qualitative read. Optional on older saves. */
  judgment?: number
  /** Nation the scout knows best — a small knowledge bonus there. */
  specialtyNation?: string
  /** Annual salary cost of employing him. Optional on older saves. */
  salary?: number
  target: ScoutTarget
  /** Age-band filter; defaults to 'all' when absent. */
  focus?: ScoutFocus
  /** Position brief: only watch forwards / D / goalies. 'any' or absent = all. */
  positionFilter?: 'any' | 'F' | 'D' | 'G'
  /** Only SURFACE (recommend) prospects projecting at least this many stars
   *  (0–5). 0 / absent = flag anyone worthwhile. */
  minPotentialStars?: number
}

/**
 * A player a scout has surfaced as worth pursuing — a high-upside youth prospect
 * or an undervalued target. Accumulates over the career as scouts get to know
 * players (the Scouting Centre starts empty and fills up).
 */
export interface ScoutRecommendation {
  playerId: string
  /** Id of the scout who surfaced him (absent on older saves / no single owner). */
  scoutId?: string
  /** The scout who surfaced him (or 'Your scouts' when no single owner). */
  scoutName: string
  /** ISO date he was flagged. */
  foundDate: string
  /** Why the scout likes him. */
  reason: string
  grade: 'A+' | 'A' | 'B' | 'C'
}

/**
 * Full scouting state for one career. Serialized as entry arrays so it round-
 * trips cleanly through JSON.stringify / structured clone.
 *
 * knowledge: [playerId, 0..100][] — absent means 0.
 */
export interface ScoutingState {
  knowledge: Array<[string, KnowledgeValue]>
  assignments: ScoutAssignment[]
  /** Players scouts have surfaced as targets (the Scouting Centre). Fills over
   *  the career; absent on older saves. */
  recommendations?: ScoutRecommendation[]
  /** Player ids already evaluated for recommendation (so each is surfaced once,
   *  and start-of-career known players never auto-populate). Absent on old saves. */
  seen?: string[]
  /** [playerId, 0..100] — the best JUDGMENT of any scout who has watched him.
   *  Drives read accuracy (band tightness/bias), distinct from knowledge volume.
   *  Absent on old saves. */
  judgment?: Array<[string, number]>
  /** [scoutId, playerId[]] — every player each scout has personally watched.
   *  Drives "only scouts who saw him file an opinion" + each scout's own scouted
   *  list (not the team-wide knowledge aggregate). Absent on old saves. */
  scoutHistory?: Array<[string, string[]]>
  /** FM-style triage of the Scouting Centre: prospects the GM chose to TRACK.
   *  They stay pinned on the shortlist rather than lost in the queue. Absent on
   *  old saves. */
  shortlist?: string[]
  /** Prospects the GM PASSED on — hidden from the recommendation queue so a
   *  triaged player doesn't keep re-surfacing. Absent on old saves. */
  dismissed?: string[]
  /** The GM's own WATCH LIST — players HE put a pin in. Starts empty and only
   *  ever grows by an explicit act (a list the game hands you tells you nothing).
   *  It is not a bookmark: watched players take priority in every scout's day
   *  (capped, so the brief still progresses) and are shielded from knowledge
   *  decay while they sit on it. Absent on old saves. */
  watchList?: WatchListEntry[]
  /** Month-start coverage snapshots — the department's own paper trail, so the
   *  Scouting Centre can say what actually CHANGED since last month rather than
   *  only what is true today. Capped to the last 14 months. Absent on old saves. */
  coverageLog?: CoverageSnapshot[]
}

/** One pinned player on the GM's watch list. */
export interface WatchListEntry {
  playerId: string
  /** ISO date the GM pinned him — "watching since". */
  addedDate: string
  /** Knowledge at the moment he was pinned, so the panel can show what watching
   *  him has actually bought you. */
  knowledgeAtAdd: number
  /** Optional GM note ("PP QB if he adds a step"). */
  note?: string
}

/** A month-start snapshot of where the department's eyes were. */
export interface CoverageSnapshot {
  /** ISO date of the snapshot (always a month boundary). */
  date: string
  /** Department-wide average knowledge, 0–100. */
  world: number
  /** [competitionId, avgKnowledge] for every league with players. */
  leagues: Array<[string, number]>
  /** How many prospects the department had filed a real read on. */
  filed: number
}
