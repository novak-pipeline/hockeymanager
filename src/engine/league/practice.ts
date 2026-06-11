/**
 * Practice and scratches model — EHM-style "target weaknesses, painless" design.
 *
 * The module is fully pure: no mutations of shared state, no wall-clock, no
 * unseeded RNG. Callers supply their seeded Rng for the fatigue tick; everything
 * else is deterministic without randomness.
 *
 * Integration with developPlayers (offseason.ts):
 *   practiceDevModifier(focus, player) → { attributeBias, fatigueMod }
 *   The caller passes attributeBias into the dev loop as a per-attribute growth
 *   multiplier and feeds fatigueMod into the fatigue bookkeeping. No full dev
 *   rewrite — just a nudge on top of the existing system.
 *
 * All state objects are JSON-safe (plain arrays-of-tuples rather than Maps,
 * mirrors how ScoutingState is handled). The shape is additive: adding new
 * PracticeFocus variants or per-player fields is non-breaking.
 *
 * Scratches (dress/scratch mechanic):
 *   The scratched player list lives on TeamPracticeState.scratched. Lineup
 *   validation consumes it via isScratchedFor() — this module does not wire
 *   into lineup.ts directly; the caller threads the set through.
 */

import type { Player, PlayerId, Position } from '@domain'
import type { Rng } from '@engine/shared/rng'

/* ────────────────────────── focus type ────────────────────────── */

/**
 * What the team concentrates on in practice.
 *
 *  balanced     — even effort across all skills; moderate growth, moderate fatigue
 *  offense      — shooting, passing, offensive IQ; skaters only (goalies ignore)
 *  defense      — checking, shot blocking, defensive IQ
 *  skating      — speed/acceleration/agility/balance focus
 *  physical     — strength, stamina, checking; more fatigue
 *  goaltending  — reflex/positioning/rebound work; skaters see no bias
 *  recovery     — light skate; less growth but fatigue drops instead of rising
 */
export type PracticeFocus =
  | 'balanced'
  | 'offense'
  | 'defense'
  | 'skating'
  | 'physical'
  | 'goaltending'
  | 'recovery'

/* ────────────────────────── state ────────────────────────── */

/**
 * Persistent practice state for one team. JSON-safe: arrays-of-tuples, not Maps.
 *
 * perPlayerFocus: per-player overrides. If a player has an entry here it wins
 *   over teamFocus. Use for individual targeted development (e.g. coach wants
 *   a D-man to work on his shot independently).
 *
 * scratched: player ids excluded from the next game's lineup ("healthy
 *   scratches"). The UI reads this; lineup.ts consumes it via isScratchedFor().
 */
export interface TeamPracticeState {
  teamFocus: PracticeFocus
  perPlayerFocus: Array<[string, PracticeFocus]> // [playerId, focus]
  scratched: string[] // healthy scratches for the next game
}

/** Construct a fresh state (e.g. start of career or first time screen is opened). */
export function createInitialPracticeState(): TeamPracticeState {
  return {
    teamFocus: 'balanced',
    perPlayerFocus: [],
    scratched: []
  }
}

/* ────────────────────────── focus → attribute-bias map ────────────────────── */

/**
 * Raw-attribute names that each focus targets with a growth bias.
 *
 * The bias values (+0.10 .. +0.20) are additive multipliers on the fractional
 * gap-closure rate used in applyGrowth (offseason.ts). A bias of +0.15 means
 * "that attribute closes 15 pp more of its gap per dev pass than it otherwise
 * would." Untargeted attributes receive 0 bias (neutral — not penalised).
 *
 * recovery has no positive bias: it trades growth for fatigue reduction.
 * goaltending targets goalie-only attributes; skaters effectively get no bias.
 */
const FOCUS_BIAS: Record<PracticeFocus, Record<string, number>> = {
  balanced: {
    // Tiny nudge everywhere — keeps the radar even
    wristShot: 0.05,
    slapShot: 0.05,
    passing: 0.05,
    stickhandling: 0.05,
    speed: 0.05,
    acceleration: 0.05,
    agility: 0.05,
    defensiveIQ: 0.05,
    checking: 0.05,
    shotBlocking: 0.05
  },
  offense: {
    wristShot: 0.18,
    slapShot: 0.15,
    deflections: 0.12,
    passing: 0.15,
    stickhandling: 0.12,
    offensiveIQ: 0.15,
    vision: 0.10,
    faceoffs: 0.08
  },
  defense: {
    checking: 0.18,
    shotBlocking: 0.15,
    stickChecking: 0.15,
    takeaway: 0.15,
    defensiveIQ: 0.18,
    positioning: 0.15,
    anticipation: 0.10
  },
  skating: {
    speed: 0.20,
    acceleration: 0.18,
    agility: 0.18,
    balance: 0.15,
    stamina: 0.12
  },
  physical: {
    strength: 0.20,
    stamina: 0.18,
    balance: 0.12,
    checking: 0.15,
    workRate: 0.10
  },
  goaltending: {
    // Goalie raw-attribute names only — skaters have none of these
    reflexes: 0.20,
    positioningG: 0.18,
    reboundControl: 0.15,
    glove: 0.15,
    blocker: 0.15,
    recovery: 0.12,
    puckHandlingG: 0.08
  },
  recovery: {}
}

/**
 * Fatigue deltas (per tick / per practice session) by focus.
 *
 * Positive = fatigue rises (harder session), negative = fatigue falls (recovery day).
 * The values here are inputs to tickPractice which further randomises them slightly.
 */
const FOCUS_FATIGUE_DELTA: Record<PracticeFocus, number> = {
  balanced: 2,
  offense: 3,
  defense: 3,
  skating: 4,
  physical: 5,
  goaltending: 2, // goalies run their own separate session; skaters easy
  recovery: -6 // the whole point of recovery days
}

/* ────────────────────────── public API ────────────────────────── */

/**
 * Per-player development modifier from their active practice focus.
 *
 * Returns:
 *   attributeBias  — Partial map of raw-attribute name → additional fractional
 *                    growth rate (added to whatever offseason.ts already applies).
 *                    Caller: for each attribute key k, multiply the gap-closure
 *                    rate by (1 + attributeBias[k] ?? 0).
 *   fatigueMod     — signed rating-points change per practice session
 *                    (negative for recovery). Caller feeds into condition system.
 *
 * Goalies under a non-goaltending focus receive attributeBias = {} (no skater
 * biases help them) but do get the fatigueMod (light skate is still light skate).
 * Skaters under 'goaltending' focus similarly get attributeBias = {}.
 */
export function practiceDevModifier(
  focus: PracticeFocus,
  player: Player
): { attributeBias: Partial<Record<string, number>>; fatigueMod: number } {
  const fatigueMod = FOCUS_FATIGUE_DELTA[focus]

  if (focus === 'recovery') {
    return { attributeBias: {}, fatigueMod }
  }

  // Goaltending sessions don't help skaters; skater sessions don't help goalies.
  if (focus === 'goaltending' && player.position !== 'G') {
    return { attributeBias: {}, fatigueMod: FOCUS_FATIGUE_DELTA.balanced }
  }
  if (focus !== 'goaltending' && player.position === 'G') {
    return { attributeBias: {}, fatigueMod: FOCUS_FATIGUE_DELTA.balanced }
  }

  return { attributeBias: { ...FOCUS_BIAS[focus] }, fatigueMod }
}

/* ────────────────────────── per-player override ────────────────── */

/**
 * Resolve the effective focus for one player: per-player override if set,
 * otherwise the team-wide focus.
 */
export function effectiveFocus(state: TeamPracticeState, playerId: string): PracticeFocus {
  for (const [id, focus] of state.perPlayerFocus) {
    if (id === playerId) return focus
  }
  return state.teamFocus
}

/* ────────────────────────── auto-suggest ────────────────────────── */

/**
 * Which composite dimension the focus primarily targets — used by suggestFocus
 * to map roster weaknesses back to recommended focuses.
 */
type CompositeDimension =
  | 'scoring'
  | 'playmaking'
  | 'defensiveZone'
  | 'skating'
  | 'hitting'
  | 'goaltending'

const FOCUS_PRIMARY_COMPOSITE: Record<PracticeFocus, CompositeDimension | null> = {
  balanced: null,
  offense: 'scoring',
  defense: 'defensiveZone',
  skating: 'skating',
  physical: 'hitting',
  goaltending: 'goaltending',
  recovery: null
}

/**
 * Scan the roster and suggest the focus that addresses the most significant
 * composite weakness, e.g. "your blue line rates below 55 defensiveZone on
 * average → suggest defense."
 *
 * Only skaters are used to judge offensive/defensive/skating/physical weakness;
 * goalies are used for goaltending weakness.
 *
 * Returns a rationale string suitable for displaying in the UI (1–2 sentences).
 */
export function suggestFocus(
  roster: Player[]
): { teamFocus: PracticeFocus; rationale: string } {
  if (roster.length === 0) {
    return { teamFocus: 'balanced', rationale: 'No players on roster — defaulting to balanced.' }
  }

  const skaters = roster.filter((p) => p.position !== 'G')
  const goalies = roster.filter((p) => p.position === 'G')

  // Compute average composite for each dimension we care about.
  const avg = (players: Player[], key: keyof Player['composites']): number => {
    if (players.length === 0) return 99
    const sum = players.reduce((acc, p) => acc + p.composites[key], 0)
    return sum / players.length
  }

  // Defensemen-specific averages for the defensive dimensions.
  const defenders = skaters.filter((p) => p.position === 'D')
  const forwards = skaters.filter((p) => p.position !== 'D')

  const scores: Array<{ focus: PracticeFocus; weakness: number; label: string }> = []

  if (skaters.length > 0) {
    scores.push({
      focus: 'offense',
      weakness: 100 - avg(forwards.length > 0 ? forwards : skaters, 'scoring'),
      label: `forward scoring (avg ${Math.round(avg(forwards.length > 0 ? forwards : skaters, 'scoring'))})`
    })
    scores.push({
      focus: 'defense',
      weakness: 100 - avg(defenders.length > 0 ? defenders : skaters, 'defensiveZone'),
      label: `defensive zone coverage (avg ${Math.round(avg(defenders.length > 0 ? defenders : skaters, 'defensiveZone'))})`
    })
    scores.push({
      focus: 'skating',
      weakness: 100 - avg(skaters, 'skating'),
      label: `skating (avg ${Math.round(avg(skaters, 'skating'))})`
    })
    scores.push({
      focus: 'physical',
      weakness: 100 - avg(skaters, 'hitting'),
      label: `physical play (avg ${Math.round(avg(skaters, 'hitting'))})`
    })
  }

  if (goalies.length > 0) {
    scores.push({
      focus: 'goaltending',
      weakness: 100 - avg(goalies, 'goaltending'),
      label: `goaltending (avg ${Math.round(avg(goalies, 'goaltending'))})`
    })
  }

  if (scores.length === 0) {
    return { teamFocus: 'balanced', rationale: 'Roster only has goalies — defaulting to balanced.' }
  }

  scores.sort((a, b) => b.weakness - a.weakness)
  const best = scores[0]

  // If the biggest weakness is below a meaningful threshold, suggest targeting it.
  // Otherwise recommend balanced (no glaring hole).
  const WEAK_THRESHOLD = 45 // below ~55 average on that dimension = weak

  if (best.weakness > WEAK_THRESHOLD) {
    const focusLabel = best.focus.charAt(0).toUpperCase() + best.focus.slice(1)
    return {
      teamFocus: best.focus,
      rationale: `Your team is weakest in ${best.label}. ${focusLabel} practice will target those attributes during development.`
    }
  }

  return {
    teamFocus: 'balanced',
    rationale: `No glaring weaknesses found — balanced practice keeps the roster well-rounded.`
  }
}

/* ────────────────────────── daily/weekly tick ────────────────────── */

export interface PracticeTick {
  playerId: string
  /** Positive = fatigue rose; negative = fatigue dropped (recovery). */
  fatigueDelta: number
}

/**
 * Advance one practice session (daily or weekly — callers choose cadence).
 *
 * For each active (non-injured, non-scratched) player:
 *   1. Resolve their effective focus.
 *   2. Apply fatigue delta with a small rng jitter (±1 pp).
 *   3. Clamp fatigue to [0, 100].
 *
 * Returns per-player fatigue deltas — does NOT mutate players. The caller
 * applies the deltas (or threads them into the condition system).
 *
 * Scratched players still participate in practice (healthy scratches skate);
 * injured players are excluded entirely.
 */
export function tickPractice(args: {
  players: Player[]
  state: TeamPracticeState
  rng: Rng
}): PracticeTick[] {
  const { players, state, rng } = args
  const out: PracticeTick[] = []

  for (const player of players) {
    if (player.injuryStatus !== null) continue // injured players do not practice

    const focus = effectiveFocus(state, player.id)
    const { fatigueMod } = practiceDevModifier(focus, player)

    // Small session-to-session jitter (±1 pp) keeps the numbers from feeling rigid.
    const jitter = rng.float(-1, 1)
    const raw = fatigueMod + jitter
    const before = player.fatigue
    const after = Math.max(0, Math.min(100, before + raw))
    const delta = after - before

    out.push({ playerId: player.id, fatigueDelta: delta })
  }

  return out
}

/* ────────────────────────── scratch helpers ────────────────────── */

/** True if this player is listed as a healthy scratch for the next game. */
export function isScratchedFor(state: TeamPracticeState, playerId: string): boolean {
  return state.scratched.includes(playerId)
}

/**
 * Toggle a player's scratch status. Returns a new state (immutable update).
 * Maximum 4 healthy scratches (EHM convention: dress 18 skaters + 2 goalies).
 * If adding would exceed the cap the state is returned unchanged.
 */
export function toggleScratch(
  state: TeamPracticeState,
  playerId: string,
  maxScratches = 4
): TeamPracticeState {
  const already = state.scratched.includes(playerId)
  if (already) {
    return { ...state, scratched: state.scratched.filter((id) => id !== playerId) }
  }
  if (state.scratched.length >= maxScratches) return state
  return { ...state, scratched: [...state.scratched, playerId] }
}

/**
 * Set (or clear) a per-player focus override. Returns a new state.
 * Pass focus = null to remove the override (player reverts to team focus).
 */
export function setPlayerFocus(
  state: TeamPracticeState,
  playerId: string,
  focus: PracticeFocus | null
): TeamPracticeState {
  const filtered = state.perPlayerFocus.filter(([id]) => id !== playerId)
  if (focus === null) {
    return { ...state, perPlayerFocus: filtered }
  }
  return { ...state, perPlayerFocus: [...filtered, [playerId, focus]] }
}
