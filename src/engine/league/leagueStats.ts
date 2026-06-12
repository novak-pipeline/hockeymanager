/**
 * League-wide stats helpers: team special-teams percentages, a transactions
 * ledger, and a daily scoreboard — the data that powers the EHM League hub.
 *
 * Design rules:
 *  - Pure functions; no side-effects, no wall-clock, no unseeded RNG.
 *  - All state objects are JSON-safe (no Maps, no class instances).
 *  - Snapshot-additive: new fields are optional so older saves load cleanly.
 */

import type { ScheduledGame } from '@domain'
import type { GameOutcome } from '@engine/shared/outcome'

/* ────────────────────────── special teams ────────────────────────── */

/**
 * Mutable accumulator kept per team during a season. Stored as a JSON-safe
 * entry array in the snapshot (Array<[teamId, SpecialTeamsAccum]>).
 */
export interface SpecialTeamsAccum {
  ppGoals: number
  ppOpp: number
  pkKills: number
  shTimes: number
}

/** Finalized display-ready record computed from an accumulator. */
export interface TeamSpecialTeams {
  teamId: string
  ppGoals: number
  ppOpportunities: number
  /** PP goals / PP opportunities (0 when no opportunities). */
  ppPct: number
  pkKills: number
  timesShorthanded: number
  /** PK kills / times shorthanded (0 when never shorthanded). */
  pkPct: number
}

/**
 * Accumulate special-teams events from one GameOutcome into the existing
 * per-team accumulators. Returns an updated copy of the entries array.
 *
 * Model:
 *  - A `penalty` event gives the OTHER team one PP opportunity and the
 *    penalised team one shorthanded situation.
 *  - A `goal` event with strength `'pp'` credits the scoring team with one
 *    PP goal. The penalised team does NOT get a PK kill for that situation
 *    (a kill = no PP goal allowed).
 *  - A PK kill is shTimes minus the PP goals allowed while shorthanded.
 *    We track it lazily: pkKills is recomputed in finalizeSpecialTeams so we
 *    only need ppGoals-against in the accumulator.
 *
 * To keep the per-game update simple we use a two-pass approach:
 *  1. Count penalties per team → add to ppOpp for opponent, shTimes for self.
 *  2. Count pp goals per team  → add to ppGoals for scorer; add to an implicit
 *     "ppGoalsAgainst" for the defending team (we store it inline as
 *     shTimes - pkKills when reading; on write we increment a ppGoalsAgainst
 *     counter hidden inside the accumulator).
 *
 * For finalisation: pkPct = pkKills / shTimes  where
 *   pkKills = shTimes - ppGoalsAgainst
 *
 * NOTE: the accumulator stores ppGoalsAgainst implicitly (shTimes - pkKills at
 * query time is not quite right because we have partial sums). We store an
 * extra field `ppGoalsAgainst` here to make kills computable exactly.
 */
export interface SpecialTeamsAccumFull extends SpecialTeamsAccum {
  /** PP goals scored against this team while they were shorthanded. */
  ppGoalsAgainst: number
}

/** JSON-safe entry array type. */
export type SpecialTeamsEntries = Array<[string, SpecialTeamsAccumFull]>

function emptyAccum(): SpecialTeamsAccumFull {
  return { ppGoals: 0, ppOpp: 0, pkKills: 0, shTimes: 0, ppGoalsAgainst: 0 }
}

/**
 * Return updated entries incorporating the results of one game.
 *
 * `existing` is the current serialized Map (Array<[teamId, accum]>).
 * The function is non-destructive — it creates a new Map internally and
 * returns fresh entries.
 */
export function accumulateSpecialTeams(args: {
  existing: SpecialTeamsEntries
  outcome: GameOutcome
  homeTeamId: string
  awayTeamId: string
}): SpecialTeamsEntries {
  const { existing, outcome, homeTeamId, awayTeamId } = args

  // Rebuild into a working Map.
  const map = new Map<string, SpecialTeamsAccumFull>(
    existing.map(([id, a]) => [id, { ...a }])
  )

  const get = (id: string): SpecialTeamsAccumFull => {
    if (!map.has(id)) map.set(id, emptyAccum())
    return map.get(id)!
  }

  // Determine which team a PlayerRef belongs to.
  // The stream carries team tags on each event via the PlayerRef.team field.
  // For penalty events we identify the penalised team from the player's team
  // reference; for goal events the scorer's team reference tells us who scored.
  for (const ev of outcome.stream) {
    if (ev.type === 'penalty') {
      // The player who took the penalty is shorthanded; the other team gets a PP.
      const penalisedTeamId = ev.player.team === 'home' ? homeTeamId : awayTeamId
      const beneficiaryTeamId = penalisedTeamId === homeTeamId ? awayTeamId : homeTeamId
      get(penalisedTeamId).shTimes += 1
      get(beneficiaryTeamId).ppOpp += 1
    } else if (ev.type === 'goal' && ev.strength === 'pp') {
      const scoringTeamId = ev.scorer.team === 'home' ? homeTeamId : awayTeamId
      const penalisedTeamId = scoringTeamId === homeTeamId ? awayTeamId : homeTeamId
      get(scoringTeamId).ppGoals += 1
      // Track that the penalised (shorthanded) team conceded a PP goal.
      get(penalisedTeamId).ppGoalsAgainst += 1
    }
  }

  // Recompute pkKills for teams touched by this game.
  for (const id of [homeTeamId, awayTeamId]) {
    const a = get(id)
    a.pkKills = Math.max(0, a.shTimes - a.ppGoalsAgainst)
  }

  return Array.from(map.entries())
}

/**
 * Convert accumulated entries into finalized TeamSpecialTeams records,
 * sorted by PP% descending.
 */
export function finalizeSpecialTeams(
  entries: SpecialTeamsEntries
): TeamSpecialTeams[] {
  return entries
    .map(([teamId, a]) => {
      const ppPct = a.ppOpp > 0 ? a.ppGoals / a.ppOpp : 0
      const pkPct = a.shTimes > 0 ? a.pkKills / a.shTimes : 0
      return {
        teamId,
        ppGoals: a.ppGoals,
        ppOpportunities: a.ppOpp,
        ppPct,
        pkKills: a.pkKills,
        timesShorthanded: a.shTimes,
        pkPct,
      }
    })
    .sort((a, b) => b.ppPct - a.ppPct)
}

/* ────────────────────────── transactions ledger ────────────────────────── */

export type TransactionKind =
  | 'trade'
  | 'signing'
  | 'release'
  | 'draft'
  | 'callup'
  | 'waiver'

export interface Transaction {
  id: string
  day: number
  year: number
  kind: TransactionKind
  teamIds: string[]
  summary: string
}

export interface TransactionLedger {
  items: Transaction[]
  /** Monotonically increasing counter used to generate unique IDs. */
  counter: number
}

/** Maximum number of transactions retained (oldest pruned first). */
const MAX_LEDGER_SIZE = 300

export function emptyLedger(): TransactionLedger {
  return { items: [], counter: 0 }
}

/**
 * Add a transaction to the ledger. Returns the new ledger (non-destructive)
 * and the newly created Transaction.
 */
export function recordTransaction(
  ledger: TransactionLedger,
  tx: { day: number; year: number; kind: TransactionKind; teamIds: string[]; summary: string }
): { ledger: TransactionLedger; transaction: Transaction } {
  const newCounter = ledger.counter + 1
  const transaction: Transaction = {
    id: `tx-${tx.year}-${String(newCounter).padStart(6, '0')}`,
    day: tx.day,
    year: tx.year,
    kind: tx.kind,
    teamIds: [...tx.teamIds],
    summary: tx.summary,
  }
  const items = [...ledger.items, transaction]
  // Cap to most recent MAX_LEDGER_SIZE entries.
  const trimmed = items.length > MAX_LEDGER_SIZE ? items.slice(items.length - MAX_LEDGER_SIZE) : items
  return {
    ledger: { items: trimmed, counter: newCounter },
    transaction,
  }
}

/* ────────────────────────── daily scoreboard ────────────────────────── */

export interface ScoreboardEntry {
  gameId: string
  homeAbbr: string
  awayAbbr: string
  homeGoals: number
  awayGoals: number
  /** True when result is non-null (game has been played). */
  final: boolean
}

/**
 * Build a scoreboard showing every league game scheduled on `day`.
 *
 * Games with a null result are shown as 0–0 with final=false (i.e. not yet
 * played or currently in progress). Callers filter as needed.
 */
export function buildScoreboard(args: {
  schedule: ScheduledGame[]
  day: number
  teamName: (id: string) => string
  teamAbbr: (id: string) => string
}): ScoreboardEntry[] {
  const { schedule, day, teamAbbr } = args
  return schedule
    .filter((g) => g.day === day)
    .map((g) => ({
      gameId: g.id,
      homeAbbr: teamAbbr(g.homeTeamId),
      awayAbbr: teamAbbr(g.awayTeamId),
      homeGoals: g.result?.homeGoals ?? 0,
      awayGoals: g.result?.awayGoals ?? 0,
      final: g.result !== null,
    }))
}
