/**
 * The wider world's permanent memory (World Renewal): every simulated league's
 * season result (champion, runner-up, award slate), league single-season
 * records, and the international tournaments (World Juniors, Olympics, Nations
 * Cup). Lives on `League.worldHistory` so it rides the existing leagueData
 * serialization — no CareerSnapshot change. Compact by design: names are
 * denormalised so a record never needs the player map to render.
 */

export interface WorldPlayerRef {
  playerId: string
  name: string
  teamAbbr: string
  /** Display value ("112 PTS", ".931"). */
  value: string
}

export interface WorldSeasonRecord {
  year: number
  competitionId: string
  abbrev: string
  trophy: string
  championTeamId: string | null
  championName: string | null
  runnerUpName: string | null
  /** Final series score from the champion's side, e.g. "4–2". */
  finalScore: string | null
  regularSeasonWinner: string | null
  mvp?: WorldPlayerRef
  topScorer?: WorldPlayerRef
  topGoalie?: WorldPlayerRef
  rookie?: WorldPlayerRef
  playoffMvp?: WorldPlayerRef
}

export interface WorldRecordEntry {
  value: number
  playerId: string
  name: string
  teamAbbr: string
  year: number
}

export type IntlEventKind = 'worldJuniors' | 'olympics' | 'nationsCup'

export interface IntlPlayerLine {
  playerId: string
  name: string
  nation: string
  position: string
  gp: number
  g: number
  a: number
  /** Goalies. */
  sv?: number
  sa?: number
}

export interface IntlEventRecord {
  kind: IntlEventKind
  /** Season year (the tournament falls inside this season). */
  year: number
  name: string
  gold: string | null
  silver: string | null
  bronze: string | null
  /** Final placing order, 1 first. */
  standings: string[]
  finalScore: string | null
  /** e.g. "Canada 4–3 (OT) Sweden". */
  finalLine: string | null
  mvp: IntlPlayerLine | null
  topScorer: IntlPlayerLine | null
  bestGoalie: IntlPlayerLine | null
  /** All-tournament team: G, D, D, F, F, F. */
  allStars: IntlPlayerLine[]
  /** Top-10 scorers. */
  leaders: IntlPlayerLine[]
  /** nation → player ids on its roster. */
  rosters: Array<[string, string[]]>
  /** Every player's tournament line (profiles + "your players" read these). */
  lines?: IntlPlayerLine[]
}

export interface WorldHistory {
  seasons: WorldSeasonRecord[]
  /** [competitionId, { points, goals }] single-season league records. */
  records: Array<[string, { points?: WorldRecordEntry; goals?: WorldRecordEntry }]>
  international: IntlEventRecord[]
  /** Set once the first youth intake has run (the first runs in bootstrap mode). */
  intakeStarted?: boolean
}

export function emptyWorldHistory(): WorldHistory {
  return { seasons: [], records: [], international: [] }
}
