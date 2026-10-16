/**
 * The match-change channel (W3 S3, W3-DESIGN item 8): every change a bench
 * makes to a watched game — a tactics switch, new lines — is a record that
 * names the STOP POINT it applies at, never a moment of live play. A watched
 * game is its match input (rosters, tactics, seed, engine) plus this list:
 * replaying both gives the same stream, event for event.
 *
 * Stop points: `{ kind: 'stop', index }` is the index-th stoppage of the game
 * (every whistle, a goal included, counted from 0 in stream order);
 * `{ kind: 'period', period }` is the intermission before that period starts.
 * W6 builds the live UI (shouts, intermission choices) on top of this; W3
 * only builds the channel.
 */
import type { Lines, TeamRef, TeamTactics } from '@domain'

export type StopPoint = { kind: 'stop'; index: number } | { kind: 'period'; period: number }

export type MatchChange =
  | { team: 'home' | 'away'; at: StopPoint; what: 'tactics'; tactics: Partial<TeamTactics> }
  | { team: 'home' | 'away'; at: StopPoint; what: 'lines'; lines: Lines }

/** The changes due at this stop point, in list order (stable: the replay applies them identically). */
export function changesAt(changes: readonly MatchChange[] | undefined, at: StopPoint): MatchChange[] {
  if (!changes || changes.length === 0) return []
  return changes.filter((c) => (c.at.kind === 'stop' && at.kind === 'stop' ? c.at.index === at.index : c.at.kind === 'period' && at.kind === 'period' ? c.at.period === at.period : false))
}

/** The fields a tactics change actually changes (an empty list: a no-op record). */
export function changedFields(before: TeamTactics, patch: Partial<TeamTactics>): string[] {
  return Object.keys(patch).filter((k) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify((patch as Record<string, unknown>)[k]))
}

export type { TeamRef }
