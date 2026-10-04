/**
 * playbackDirector.ts — Pure, node-testable speed-plan generator for the
 * condensed broadcast watch experience.
 *
 * planFor(stream, mode) → SpeedSegment[]
 *   Produces an ordered list of time windows, each with a playback speed, that
 *   cover the full game. Every second of game time belongs to exactly one
 *   segment (contiguous, no gaps, no overlaps).
 *
 * Modes (W2 one-clock rule, docs/gameplan-2026-09-28): LIVE HOCKEY PLAYS AT 1×
 * in every mode, and the speed never changes during play — only the user's
 * nudge does. Time is saved by CUTTING dead time and filler, never by
 * fast-forwarding hockey (FM plays its highlights in real time; at 2× the
 * owner saw "glitchy playback", instant shots and a puck zipping around).
 *   'full'     — every second of live play at 1×; a stoppage plays its first
 *                seconds (the whistle, the call; after a goal the whole
 *                celebration) then CUTS to just before the next drop, so the
 *                lineup and the drop are seen at 1×.
 *   'extended' / 'comprehensive' / 'key' — 1× through their highlight
 *                segments, SKIP_SPEED (a cut) elsewhere.
 *
 * Helpers:
 *   currentSpeed(plan, absT)          — speed at a given absolute game clock.
 *   nextActiveJump(plan, absT)        — when we're in a skip segment, the next
 *                                       jump target; null if already in active
 *                                       play or past the end.
 */

import type { GameStream } from '@domain'
import { highlightsFor, type HighlightMode } from './highlights'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Live hockey, every mode. */
const LIVE_SPEED = 1

/** A stoppage plays this long at 1× after the whistle before the cut (the call, the reaction). */
const STOPPAGE_SHOWN_S = 3

/**
 * After a GOAL the stoppage plays through the whole on-ice goal sequence
 * (celebration → bench → crowd; rink3dRenderer GOAL_SEQ ends at 8 s) and the
 * instant replay starts from the end of it, on this same game clock.
 */
export const GOAL_STOPPAGE_SHOWN_S = 8.5

/** The cut lands this long before the drop: the set and the drop play at 1×. */
const PRE_DROP_S = 4

/** A stoppage shorter than this plays through (a cut would save nothing). */
const MIN_CUT_S = 3

/** Speed through skipped sections (a cut, never rendered as motion). */
export const SKIP_SPEED = 30

/** Highlight modes play their segments at 1× too. */
const HIGHLIGHT_ACTIVE_SPEED = 1

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpeedSegment {
  /** Absolute game-clock start (seconds from opening faceoff). */
  fromAbsT: number
  /** Absolute game-clock end (exclusive). */
  toAbsT: number
  /**
   * Playback speed multiplier (1 = real time).
   * SKIP_SPEED segments should be jumped over in the UI; all others play through.
   */
  speed: number
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Build a speed plan for the given game stream and playback mode.
 * The resulting array covers [0, gameDuration] exactly with no gaps.
 */
export function planFor(
  stream: GameStream,
  mode: WatchMode,
): SpeedSegment[] {
  if (stream.length === 0) return []

  const duration = _streamDuration(stream)
  if (duration <= 0) return []

  if (mode === 'full') return _planFull(stream, duration)
  return _planHighlight(stream, duration, mode)
}

/** Every watch level the viewer offers. */
export type WatchMode = 'full' | HighlightMode

/**
 * Roughly how long a plan takes to watch, in wall seconds: game time / speed
 * through everything that plays, plus a fixed cost per skip (the viewer spins
 * the clock rather than playing the filler). Replays and the pregame open are
 * extra and not counted here.
 */
export function estimateWallSeconds(plan: SpeedSegment[], perSkipSeconds = 1.5): number {
  let s = 0
  for (const seg of plan) {
    if (seg.speed >= SKIP_SPEED) s += perSkipSeconds
    else s += (seg.toAbsT - seg.fromAbsT) / seg.speed
  }
  return s
}

/**
 * Return the playback speed that applies at the given absolute game clock.
 * Returns 1 if `absT` is outside the plan range.
 */
export function currentSpeed(plan: SpeedSegment[], absT: number): number {
  for (const seg of plan) {
    if (absT >= seg.fromAbsT && absT < seg.toAbsT) return seg.speed
  }
  // Past the end or empty plan
  return 1
}

/**
 * When currently in a skip segment, return the next non-skip segment's start
 * time so the renderer can seekFraction there. Returns null if we're already
 * in an active segment or past the end of the plan.
 */
export function nextActiveJump(
  plan: SpeedSegment[],
  absT: number,
): { jumpToAbsT: number } | null {
  let inSkip = false
  for (let i = 0; i < plan.length; i++) {
    const seg = plan[i]
    if (absT >= seg.fromAbsT && absT < seg.toAbsT) {
      if (seg.speed < SKIP_SPEED) return null // already in active play
      inSkip = true
    }
    if (inSkip && seg.speed < SKIP_SPEED) {
      return { jumpToAbsT: seg.fromAbsT }
    }
  }
  return null
}

// ── Full-mode plan ─────────────────────────────────────────────────────────────

/**
 * 'full': 1× everywhere, except the middle of each whistle → faceoff stoppage,
 * which is a cut (SKIP_SPEED). The viewer jumps it instantly, like a TV
 * broadcast cutting from the bench reaction to the faceoff dot.
 */
function _planFull(stream: GameStream, duration: number): SpeedSegment[] {
  const bases = _computePeriodBases(stream)
  const at = (period: number, t: number): number => (bases.get(period) ?? (period - 1) * 1200) + t
  const segs: SpeedSegment[] = []
  let cursor = 0
  let whistle: { at: number; goal: boolean } | null = null
  let lastGoalAt = -Infinity
  for (const ev of stream) {
    if (ev.type === 'goal') lastGoalAt = at(ev.period, ev.t)
    if (ev.type === 'whistle') {
      const w = at(ev.period, ev.t)
      whistle = { at: w, goal: ev.reason === 'goal' || w - lastGoalAt < 1.5 }
    } else if (ev.type === 'faceoff' && whistle !== null) {
      const drop = at(ev.period, ev.t)
      const from = whistle.at + (whistle.goal ? GOAL_STOPPAGE_SHOWN_S : STOPPAGE_SHOWN_S)
      const to = drop - PRE_DROP_S
      if (to - from >= MIN_CUT_S && from > cursor) {
        segs.push({ fromAbsT: cursor, toAbsT: from, speed: LIVE_SPEED })
        segs.push({ fromAbsT: from, toAbsT: to, speed: SKIP_SPEED })
        cursor = to
      }
      whistle = null
    } else if (ev.type === 'periodEnd' || ev.type === 'gameEnd') {
      whistle = null
    }
  }
  if (cursor < duration) segs.push({ fromAbsT: cursor, toAbsT: duration, speed: LIVE_SPEED })
  return segs
}

// ── Highlight-mode plan ────────────────────────────────────────────────────────

function _planHighlight(
  stream: GameStream,
  duration: number,
  mode: HighlightMode,
): SpeedSegment[] {
  const selected = highlightsFor(stream, mode)

  if (selected.length === 0) {
    // No highlights — one big skip
    return [{ fromAbsT: 0, toAbsT: duration, speed: SKIP_SPEED }]
  }

  const activeSpeed = HIGHLIGHT_ACTIVE_SPEED
  const result: SpeedSegment[] = []
  let cursor = 0

  for (const seg of selected) {
    // Skip gap before this segment
    if (seg.startAbsT > cursor + 0.01) {
      result.push({ fromAbsT: cursor, toAbsT: seg.startAbsT, speed: SKIP_SPEED })
    }
    // Active segment
    result.push({
      fromAbsT: Math.max(cursor, seg.startAbsT),
      toAbsT: seg.endAbsT,
      speed: activeSpeed,
    })
    cursor = seg.endAbsT
  }

  // Tail gap
  if (cursor < duration - 0.01) {
    result.push({ fromAbsT: cursor, toAbsT: duration, speed: SKIP_SPEED })
  }

  return result
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _streamDuration(stream: GameStream): number {
  // Find the latest absTime in the stream
  let max = 0
  const periods = _computePeriodBases(stream)
  for (const ev of stream) {
    const base = periods.get(ev.period) ?? (ev.period - 1) * 1200
    const at = base + ev.t
    if (at > max) max = at
  }
  return max
}

function _computePeriodBases(stream: GameStream): Map<number, number> {
  // Two-pass: first find max t per period, then accumulate bases
  const maxT = new Map<number, number>()
  for (const ev of stream) {
    if (ev.type === 'frame') {
      const prev = maxT.get(ev.period) ?? 0
      if (ev.t > prev) maxT.set(ev.period, ev.t)
    }
  }
  // Also handle streams with no frame events (test streams)
  for (const ev of stream) {
    if (ev.type !== 'frame') {
      const prev = maxT.get(ev.period) ?? 0
      if (ev.t > prev) maxT.set(ev.period, ev.t)
    }
  }

  const sortedPeriods = [...maxT.keys()].sort((a, b) => a - b)
  const bases = new Map<number, number>()
  let base = 0
  for (const p of sortedPeriods) {
    bases.set(p, base)
    const len = p <= 3 ? 1200 : (maxT.get(p) ?? 1200)
    base += len
  }
  // Ensure period 1 is always present
  if (!bases.has(1)) bases.set(1, 0)
  return bases
}


