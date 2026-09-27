/**
 * Highlight reel builder.
 *
 * Pure, node-testable. Walks a GameStream and produces HighlightSegment windows
 * around key events. Overlapping segments are merged. Sorted ascending by start.
 */
import type { GameStream } from '@domain'
import { absTime } from './timeline'

export interface HighlightSegment {
  startAbsT: number
  endAbsT: number
  kind: 'goal' | 'chance' | 'save' | 'penalty' | 'hit' | 'bigSave' | 'fight' | 'post' | 'bigHit'
  importance: 1 | 2 | 3
}

/** Watch levels that cut the game down to highlights. */
export type HighlightMode = 'key' | 'comprehensive' | 'extended'

/**
 * Build highlight segments from a game stream.
 *
 * Windows (all in seconds):
 *  - goal:           -10s before, +6s after  — importance 3
 *  - high-danger shot (danger >= 0.25):  -6s/+3s — importance 2
 *  - rebound save:   -6s/+3s — importance 2
 *  - penalty:        -4s/+3s — importance 2
 *  - hit:            -2s/+2s — importance 1
 */
export function buildHighlights(stream: GameStream): HighlightSegment[] {
  const raw: HighlightSegment[] = []
  // Track last shot time for rebound detection (within 3s)
  const lastShotAbsT: Map<string, number> = new Map()

  for (const ev of stream) {
    const at = absTime(ev.period, ev.t)

    switch (ev.type) {
      case 'goal':
        raw.push({ startAbsT: Math.max(0, at - 10), endAbsT: at + 6, kind: 'goal', importance: 3 })
        break

      case 'shot': {
        if (ev.danger >= 0.25) {
          raw.push({ startAbsT: Math.max(0, at - 6), endAbsT: at + 3, kind: 'chance', importance: 2 })
        }
        // Track for rebound detection — key by shooter side (we use player id)
        lastShotAbsT.set(ev.shooter, at)
        break
      }

      case 'save': {
        // Check if this is a rebound save: a shot happened within 3s before this save
        let isRebound = ev.rebound
        if (!isRebound) {
          for (const [, shotAt] of lastShotAbsT) {
            if (at - shotAt <= 3 && at - shotAt >= 0) {
              isRebound = true
              break
            }
          }
        }
        if (isRebound) {
          raw.push({ startAbsT: Math.max(0, at - 6), endAbsT: at + 3, kind: 'save', importance: 2 })
        }
        break
      }

      case 'penalty':
        raw.push({ startAbsT: Math.max(0, at - 4), endAbsT: at + 3, kind: 'penalty', importance: 2 })
        break

      case 'hit':
        raw.push({ startAbsT: Math.max(0, at - 2), endAbsT: at + 2, kind: 'hit', importance: 1 })
        break
    }
  }

  if (raw.length === 0) return []

  // Sort by start time
  raw.sort((a, b) => a.startAbsT - b.startAbsT)

  // Merge overlapping segments (keep highest importance + earliest kind in tie)
  const merged: HighlightSegment[] = []
  let current = { ...raw[0] }

  for (let i = 1; i < raw.length; i++) {
    const seg = raw[i]
    if (seg.startAbsT <= current.endAbsT) {
      // Overlapping — merge: extend end, take higher importance
      current.endAbsT = Math.max(current.endAbsT, seg.endAbsT)
      if (seg.importance > current.importance) {
        current.importance = seg.importance
        current.kind = seg.kind
      }
    } else {
      merged.push(current)
      current = { ...seg }
    }
  }
  merged.push(current)

  return merged
}

/**
 * Filter segments by playback mode.
 *
 *  'key'      — GOALS ONLY. The tightest reel: the viewer fast-forwards the
 *               clock between goals and only cuts into each goal's window
 *               (its ~10 s lead-up + celebration). Any chance/save/penalty
 *               that happened right before a goal is already folded into that
 *               goal's merged segment, so the build-up is preserved.
 *  'extended' — all segments (goals, chances, saves, penalties, hits).
 */
export function selectMode(
  segments: HighlightSegment[],
  mode: 'key' | 'extended'
): HighlightSegment[] {
  if (mode === 'extended') return segments
  // key: goals only
  return segments.filter((s) => s.kind === 'goal')
}

/** A save on a chance at least this dangerous is a "big save". */
export const BIG_SAVE_DANGER = 0.6
/** A hit at least this forceful (agent engine) is a "big hit". */
export const BIG_HIT_FORCE = 0.7

/**
 * The COMPREHENSIVE reel (UX audit F-10): the moments a broadcast would cut
 * to, and nothing else:
 *   goals (a power-play goal keeps its man-advantage build-up),
 *   big saves (a save on a chance of danger >= BIG_SAVE_DANGER),
 *   fights, shots off the iron, and big hits.
 * Ordinary chances, routine saves, every minor penalty and every bump (the
 * filler Extended keeps) are cut. Built from the raw events, not the merged
 * Extended segments, so a big save next to a routine chance still counts.
 *
 * A "big hit" is one the agent engine rates >= BIG_HIT_FORCE. The older engine
 * emits no force, so there a hit only counts when it pins the carrier on the
 * boards (near the side walls or the end boards).
 */
export function buildComprehensive(stream: GameStream): HighlightSegment[] {
  const raw: HighlightSegment[] = []
  let lastShot: { at: number; danger: number } | null = null
  let ppStart: number | null = null
  for (const ev of stream) {
    const at = absTime(ev.period, ev.t)
    switch (ev.type) {
      case 'shot':
        lastShot = { at, danger: ev.danger }
        break
      case 'penalty':
        if (ev.infraction === 'fighting') {
          raw.push({ startAbsT: Math.max(0, at - 5), endAbsT: at + 6, kind: 'fight', importance: 2 })
        } else {
          ppStart = at
        }
        break
      case 'goal': {
        // A power-play goal shows the man-advantage build-up (up to 25 s of it).
        const lead = ev.strength === 'pp' && ppStart !== null ? Math.min(25, Math.max(10, at - ppStart)) : 10
        raw.push({ startAbsT: Math.max(0, at - lead), endAbsT: at + 6, kind: 'goal', importance: 3 })
        if (ev.strength === 'pp') ppStart = null
        break
      }
      case 'save':
        if (lastShot && at - lastShot.at <= 3 && lastShot.danger >= BIG_SAVE_DANGER) {
          raw.push({ startAbsT: Math.max(0, at - 6), endAbsT: at + 3, kind: 'bigSave', importance: 2 })
        }
        break
      case 'missedShot':
        if (ev.result === 'post') raw.push({ startAbsT: Math.max(0, at - 6), endAbsT: at + 3, kind: 'post', importance: 2 })
        break
      case 'hit': {
        const big = ev.force !== undefined
          ? ev.force >= BIG_HIT_FORCE
          : Math.abs(ev.pos.y) >= 0.85 || Math.abs(ev.pos.x) >= 0.9
        if (big) raw.push({ startAbsT: Math.max(0, at - 3), endAbsT: at + 2.5, kind: 'bigHit', importance: 1 })
        break
      }
      case 'periodEnd':
      case 'gameEnd':
        ppStart = null
        break
    }
  }
  if (raw.length === 0) return []
  raw.sort((a, b) => a.startAbsT - b.startAbsT)
  const merged: HighlightSegment[] = []
  let cur = { ...raw[0]! }
  for (let i = 1; i < raw.length; i++) {
    const seg = raw[i]!
    if (seg.startAbsT <= cur.endAbsT) {
      cur.endAbsT = Math.max(cur.endAbsT, seg.endAbsT)
      if (seg.importance > cur.importance) { cur.importance = seg.importance; cur.kind = seg.kind }
    } else {
      merged.push(cur)
      cur = { ...seg }
    }
  }
  merged.push(cur)
  return merged
}

/** The highlight segments for a watch level. */
export function highlightsFor(stream: GameStream, mode: HighlightMode): HighlightSegment[] {
  if (mode === 'comprehensive') return buildComprehensive(stream)
  return selectMode(buildHighlights(stream), mode)
}
