/**
 * Shared types, constants, and small math helpers for the full-fidelity engine.
 *
 * The rink is the normalized unit square (x ∈ [-1,1] goal-to-goal, y ∈ [-1,1]
 * boards-to-boards) but all SPEEDS and DISTANCES are reasoned about in real
 * feet (200ft × 85ft), so skating, passing, and shooting move at NHL speeds and
 * the per-tick displacement invariant is meaningful.
 */
import type { GameEvent, Player, PlayerId, XY } from '@domain'
import type { Rng } from '@engine/shared/rng'
import type { GamePlayerStat } from '@engine/shared/outcome'

/** Seconds of game time per emitted frame (4 fps — smooth at 1×–8× playback). */
export const FRAME_DT = 0.25

/** Normalized-to-feet scale per axis (NHL sheet is 200ft × 85ft, origin center). */
export const X_FT = 100
export const Y_FT = 42.5

export const LEAGUE_AVG = 50

/** Offensive blue line as puck advancement (puck.x × attackSign). */
export const O_BLUE = 0.25

export interface Vel {
  x: number
  y: number
}

/** A skater on the ice: resolved player, normalized position, velocity (ft/s). */
export interface RSkater {
  player: Player
  pos: XY
  vel: Vel
}

/**
 * The on-ice unit. `slots` maps each skater index to its formation role
 * [0 LW, 1 C, 2 RW, 3 LD, 4 RD] so a 3-, 4- or 6-man unit still holds a
 * sensible shape (PK box, OT triangle, 6th skater crashing the slot).
 */
export interface Unit {
  skaters: RSkater[]
  slots: number[]
  goalie: RSkater
}

/**
 * Possession phases — the state machine a possession walks through, which
 * drives both team shapes and what the carrier tries to do with the puck:
 * dig it out and break out → carry/regroup through neutral ice → enter the
 * zone (carry / pass / dump) → cycle and generate a shot. `rush` overrides the
 * geometric phase after a live turnover (counterattack with defenders beat).
 */
export type Phase = 'breakout' | 'neutral' | 'entry' | 'rush' | 'cycle'

/** Why a shot was generated — recorded for tests/telemetry, never emitted. */
export type ShotKind = 'point' | 'cycle' | 'onetimer' | 'rush' | 'wrap' | 'rebound'

/** Optional test/diagnostic sink — populated when passed in FullSimOptions. */
export interface FullSimTelemetry {
  shots: { kind: ShotKind; danger: number; oddMan: boolean }[]
  icings: number
  entries: { carry: number; dump: number; pass: number }
}

export function emptyTelemetry(): FullSimTelemetry {
  return { shots: [], icings: 0, entries: { carry: 0, dump: 0, pass: 0 } }
}

export interface Ctx {
  rng: Rng
  stream: GameEvent[]
  stats: Map<PlayerId, GamePlayerStat>
  telemetry: FullSimTelemetry | null
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f
}

/** Real-feet distance between two normalized rink points. */
export function distFt(a: XY, b: XY): number {
  return Math.hypot((a.x - b.x) * X_FT, (a.y - b.y) * Y_FT)
}

/** Index of the skater nearest (in feet) to a normalized point, -1 if empty. */
export function nearestIdx(skaters: readonly RSkater[], p: XY): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < skaters.length; i++) {
    const d = distFt(skaters[i].pos, p)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}
