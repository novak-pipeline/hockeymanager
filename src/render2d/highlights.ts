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
  kind: 'goal' | 'chance' | 'save' | 'penalty' | 'hit'
  importance: 1 | 2 | 3
}

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
 *  'key'      — goals, big (rebound) saves, and penalties only. Standalone
 *               scoring chances are intentionally EXCLUDED: a normal game tags
 *               dozens of importance-2 chances whose wide windows merge into
 *               near-total coverage, which made "key moments" play almost the
 *               whole game. (A chance that happens next to a goal is already
 *               folded into that goal's merged segment, so the lead-up is kept.)
 *  'extended' — all segments (goals, chances, saves, penalties, hits).
 */
export function selectMode(
  segments: HighlightSegment[],
  mode: 'key' | 'extended'
): HighlightSegment[] {
  if (mode === 'extended') return segments
  // key: goals + big saves + penalties (drop standalone chances and hits)
  return segments.filter(
    (s) => s.kind === 'goal' || s.kind === 'save' || s.kind === 'penalty'
  )
}
