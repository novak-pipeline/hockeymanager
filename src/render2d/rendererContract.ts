import type { MatchTimeline } from './timeline'

/**
 * The renderer contract both match views implement. The 2D PixiJS renderer and
 * the 3D three.js renderer are interchangeable behind this interface — they
 * read the SAME MatchTimeline (positions in normalized [-1,1] rink space) and
 * never compute hockey outcomes.
 *
 * Each implementation provides its own async factory
 * (`RinkRenderer.create(parent, colors)` / `Rink3dRenderer.create(parent, colors)`)
 * since construction needs DOM/WebGL setup; everything after that is this
 * interface.
 *
 * Frame-data caveats renderers must honor:
 *   - Skater arrays in frames are 3–6 entries (penalties, 3v3 OT, pulled
 *     goalie). Index-paired across frames; when the PlayerId at an index
 *     changes, SNAP to the new position instead of interpolating.
 *   - A pulled goalie is represented at the bench position; an extra attacker
 *     appears in the skater array.
 */
export interface RinkColors {
  home: number
  away: number
}

/**
 * Per-player label data passed to renderers so they can draw name/number
 * overlays without coupling to the domain Player type.
 */
export interface PlayerLabel {
  lastName: string
  /** Jersey number — omitted when unavailable (e.g. quick-sim, tests). */
  number?: number
}

/** Map from PlayerId → label data. Passed as an optional parameter to load(). */
export type PlayerLabels = Record<string, PlayerLabel>

/** Per-frame UI state pushed to the host (scoreboard, scrubber). */
export interface MatchView {
  period: number
  /** "MM:SS" counting down within the period. */
  clock: string
  homeScore: number
  awayScore: number
  playing: boolean
  /** 0..1 through the whole game. */
  progress: number
  ended: boolean
}

export interface MatchRenderer {
  /** Swap in a new game (resets playback to 0:00). */
  load(timeline: MatchTimeline, colors?: RinkColors, labels?: PlayerLabels): void
  /** Subscribe to per-frame scoreboard state. */
  onUpdate(cb: (v: MatchView) => void): void
  play(): void
  pause(): void
  toggle(): void
  /** Playback speed multiplier (1 = real time). */
  setSpeed(x: number): void
  /** Seek to a fraction 0..1 of the game. */
  seekFraction(f: number): void
  /** Re-fit to the host element's current size. */
  resize(): void
  /** Tear down GPU resources and DOM nodes. Instance is unusable afterwards. */
  destroy(): void
}
