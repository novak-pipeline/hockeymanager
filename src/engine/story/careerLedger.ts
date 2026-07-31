/**
 * CAREER LEDGER — what the game is actually entitled to claim about a man's
 * career before this save began.
 *
 * The sim only ever watched the seasons it simmed. An imported 39-year-old
 * arrives with an EMPTY {@link Player.stats} ledger despite five hundred real
 * goals — the gap is in OUR records, not in his career. Every "first NHL
 * goal" / "reaches N career points" beat that reads `stats` alone therefore
 * mistakes a franchise legend for a rookie.
 *
 * The imported database does carry the truth: {@link Player.careerHistory} is
 * the real season-by-season record. This module folds it in — filtered to the
 * league we actually play, because a Swedish U18 goal is not an NHL goal — and
 * decides when a debut beat may honestly fire.
 */
import type { Player } from '@domain/player'

/** Career counts from the imported history, for one league only. */
export interface ImportedCareer {
  seasons: number
  gamesPlayed: number
  goals: number
  assists: number
  points: number
  shutouts: number
}

export const EMPTY_IMPORTED_CAREER: ImportedCareer = {
  seasons: 0, gamesPlayed: 0, goals: 0, assists: 0, points: 0, shutouts: 0,
}

/** Minimum clubs a history league must share with ours to BE our league. */
const MIN_CLUB_OVERLAP = 3

/**
 * Which league label inside the imported career histories is the league this
 * save plays? A mod names it differently in the two places — "National Hockey
 * League" in a player's history, "NHL (EHM import)" in the meta — so we match
 * the way the record book already does: by CLUB overlap, not by name.
 *
 * Returns null when no history league covers our clubs (a fictional league, or
 * a mod that ships no histories): callers must then treat prior careers as
 * UNKNOWN rather than as zero.
 */
export function detectHistoryLeagueLabel(
  players: Iterable<Player>,
  clubNames: Iterable<string>,
): string | null {
  const ours = new Set(clubNames)
  if (ours.size === 0) return null
  const clubsByLabel = new Map<string, Set<string>>()
  for (const p of players) {
    for (const h of p.careerHistory ?? []) {
      if (!ours.has(h.club)) continue
      let set = clubsByLabel.get(h.league)
      if (!set) { set = new Set(); clubsByLabel.set(h.league, set) }
      set.add(h.club)
    }
  }
  let best: string | null = null
  let bestN = 0
  for (const [label, clubs] of clubsByLabel) {
    if (clubs.size > bestN) { best = label; bestN = clubs.size }
  }
  return bestN >= MIN_CLUB_OVERLAP ? best : null
}

/**
 * Fold a player's imported history for one league label. `label` null (we could
 * not identify our league in the histories) yields zeroes — pair it with
 * {@link hasImportedHistory} so "zero" is never mistaken for "none".
 */
export function importedCareerIn(p: Player, label: string | null): ImportedCareer {
  if (label === null) return EMPTY_IMPORTED_CAREER
  const rows = p.careerHistory
  if (!rows || rows.length === 0) return EMPTY_IMPORTED_CAREER
  let seasons = 0, gamesPlayed = 0, goals = 0, assists = 0, shutouts = 0
  for (const h of rows) {
    if (h.league !== label) continue
    seasons++
    gamesPlayed += h.gamesPlayed
    goals += h.goals
    assists += h.assists
    shutouts += h.shutouts
  }
  return { seasons, gamesPlayed, goals, assists, points: goals + assists, shutouts }
}

/** Does the source database carry any career record at all for this man? */
export function hasImportedHistory(p: Player): boolean {
  return (p.careerHistory?.length ?? 0) > 0
}

/**
 * Oldest a man can be and still plausibly be making his league debut when we
 * hold NO record of his career. Matches the Calder-eligibility age already used
 * for rookie detection: past it, an empty ledger means we lost the file, not
 * that he never played.
 */
export const DEBUT_PLAUSIBLE_MAX_AGE = 24

/**
 * May the game claim tonight's goal was his FIRST in this league?
 *
 * The evidence, in order:
 *  - we watched him score before → no.
 *  - the imported history has him scoring in this league → no (the Malkin case:
 *    a legend whose in-sim ledger is empty only because the save is young).
 *  - the imported history covers him and shows no goal here → yes, honestly:
 *    the grinder who finally scored, or the prospect who just arrived.
 *  - no record either way → only when he is young enough that no unrecorded
 *    career can be hiding behind him. Otherwise the game keeps quiet, because
 *    the alternative is telling a 39-year-old he is a rookie.
 */
export function canClaimFirstGoal(args: {
  age: number
  /** Goals we already know he had before tonight (sim ledger, at minimum). */
  knownGoalsBefore: number
  /** His imported record for our league — null when no usable record exists. */
  imported: ImportedCareer | null
}): boolean {
  if (args.knownGoalsBefore > 0) return false
  if (args.imported) return args.imported.goals === 0
  return args.age <= DEBUT_PLAUSIBLE_MAX_AGE
}

/**
 * Is this a genuine first NHL season (Calder eligibility)? Same evidence rule:
 * an imported veteran's empty in-sim ledger is not a rookie season.
 */
export function isTrueRookieSeason(args: {
  age: number
  /** Seasons the sim has already archived for him at this level. */
  simSeasons: number
  imported: ImportedCareer | null
}): boolean {
  if (args.simSeasons > 0) return false
  if (args.age > DEBUT_PLAUSIBLE_MAX_AGE) return false
  return !args.imported || args.imported.gamesPlayed === 0
}
