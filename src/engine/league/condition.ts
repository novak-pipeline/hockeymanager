/**
 * Player condition systems: injuries, fatigue, morale, and form.
 *
 * These run on the league/career layer between games. The sim engines never
 * mutate condition — they consume it through `effectiveResolve`, the single
 * injection seam that scales a player's cached composites by how tired, happy,
 * and hot they currently are. Lineup legality (keeping injured players off the
 * ice) is handled separately by engine/league/lineup.ts; `effectiveResolve`
 * deliberately does NOT filter injured players.
 *
 * Determinism: every stochastic decision flows through the caller's seeded Rng.
 * Callers must iterate players in a stable order so a given seed always replays
 * the same league history.
 *
 * Note: injury risk and fatigue recovery read raw physical/mental attributes
 * (balance, aggression, stamina). That is deliberate — durability has no
 * composite, and this module is the management layer, not the sim loop.
 *
 * All numeric coefficients are first-pass estimates for the calibration
 * harness (build step #5) to refine.
 */
import type { CompositeRatings, Injury, InjuryKind, Player, PlayerId, Team } from '@domain'
import type { Rng } from '@engine/shared/rng'

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/* ────────────────────────── injuries ────────────────────────── */

/** ~1.5% per skater per game at league-average durability and usage. */
const SKATER_INJURY_CHANCE = 0.015
/** Goalies absorb far less contact; lower base, full-game TOI reference. */
const GOALIE_INJURY_CHANCE = 0.005
const SKATER_TOI_REF_SECONDS = 17 * 60
const GOALIE_TOI_REF_SECONDS = 60 * 60

const KIND_WEIGHTS: Array<{ kind: InjuryKind; weight: number }> = [
  { kind: 'lowerBody', weight: 40 },
  { kind: 'upperBody', weight: 35 },
  { kind: 'illness', weight: 15 },
  { kind: 'concussion', weight: 10 }
]

const INJURY_DESCRIPTIONS: Record<InjuryKind, readonly string[]> = {
  lowerBody: [
    'strained MCL',
    'sprained ankle',
    'groin strain',
    'hip pointer',
    'charley horse',
    'lower-body injury'
  ],
  upperBody: [
    'shoulder sprain',
    'wrist sprain',
    'bruised ribs',
    'sore back',
    'upper-body injury'
  ],
  illness: ['flu', 'illness'],
  concussion: ['concussion', 'concussion protocol']
}

function rollKind(rng: Rng): InjuryKind {
  let r = rng.float(0, 100)
  for (const { kind, weight } of KIND_WEIGHTS) {
    r -= weight
    if (r <= 0) return kind
  }
  return 'lowerBody'
}

/**
 * Games out, from a discretized exponential: 1–3 games common, 8–20 rare.
 * Concussions draw from a longer-tailed scale (multi-week absences happen).
 */
function rollGamesOut(rng: Rng, kind: InjuryKind): number {
  const scale = kind === 'concussion' ? 4.5 : 2.2
  const cap = kind === 'concussion' ? 40 : 25
  const games = 1 + Math.floor(-Math.log(1 - rng.next()) * scale)
  return Math.min(cap, games)
}

/**
 * Per-game injury probability. Base rate scaled up by low balance, high
 * aggression, and heavy minutes (toi in seconds, as in GamePlayerStat).
 */
function injuryChance(player: Player, toi: number): number {
  const goalie = player.position === 'G'
  const base = goalie ? GOALIE_INJURY_CHANCE : SKATER_INJURY_CHANCE
  const ref = goalie ? GOALIE_TOI_REF_SECONDS : SKATER_TOI_REF_SECONDS
  const balanceFactor = 1 + (50 - player.ratings.physical.balance) / 125
  const aggressionFactor = 1 + (player.ratings.mental.aggression - 50) / 150
  const toiFactor = clamp(0.5 + 0.5 * (toi / ref), 0.25, 2)
  return clamp(base * balanceFactor * aggressionFactor * toiFactor, 0, 0.25)
}

export interface InjuryRoll {
  playerId: PlayerId
  injury: Injury
}

/**
 * Roll post-game injuries for everyone who played. Sets `injuryStatus` on the
 * affected players (already-injured players are skipped) and returns the new
 * injuries so the caller can repair lineups and write news items.
 */
export function rollInjuries(args: {
  participants: Array<{ player: Player; toi: number }>
  rng: Rng
}): InjuryRoll[] {
  const { participants, rng } = args
  const out: InjuryRoll[] = []
  for (const { player, toi } of participants) {
    if (player.injuryStatus !== null) continue
    if (!rng.chance(injuryChance(player, toi))) continue
    const kind = rollKind(rng)
    const injury: Injury = {
      kind,
      gamesRemaining: rollGamesOut(rng, kind),
      description: rng.pick(INJURY_DESCRIPTIONS[kind])
    }
    player.injuryStatus = injury
    out.push({ playerId: player.id, injury })
  }
  return out
}

/* ────────────────────────── daily tick ────────────────────────── */

const FATIGUE_PER_GAME = 8
const FATIGUE_NOISE = 2
const REST_RECOVERY = 12
const MORALE_BASELINE = 60
const MORALE_DRIFT = 0.05
const FORM_DECAY = 0.9

/**
 * Advance every player's condition by one match day.
 *
 *  - Injured players who did NOT play tick one game closer to health (a player
 *    hurt during today's game hasn't missed a game yet); at 0 the injury
 *    clears and the id lands in `healed`.
 *  - Fatigue: +8±2 for players who played (scaled down by stamina), −12
 *    recovery for everyone who rested; clamped 0–100.
 *  - Morale drifts toward the 60 baseline.
 *  - Form takes a seeded ±1 random-walk step and decays toward 0, clamped
 *    to [-5, 5].
 */
export function tickRecovery(args: {
  players: Iterable<Player>
  playedToday: Set<PlayerId> | ((id: PlayerId) => boolean)
  rng: Rng
}): { healed: PlayerId[] } {
  const { players, playedToday, rng } = args
  const played =
    typeof playedToday === 'function' ? playedToday : (id: PlayerId): boolean => playedToday.has(id)
  const healed: PlayerId[] = []

  for (const p of players) {
    const playedNow = played(p.id)

    if (p.injuryStatus !== null && !playedNow) {
      p.injuryStatus.gamesRemaining -= 1
      if (p.injuryStatus.gamesRemaining <= 0) {
        p.injuryStatus = null
        healed.push(p.id)
      }
    }

    if (playedNow) {
      const staminaScale = 1.3 - 0.006 * p.ratings.physical.stamina
      p.fatigue = clamp(
        p.fatigue + (FATIGUE_PER_GAME + rng.float(-FATIGUE_NOISE, FATIGUE_NOISE)) * staminaScale,
        0,
        100
      )
    } else {
      p.fatigue = clamp(p.fatigue - REST_RECOVERY, 0, 100)
    }

    p.morale = clamp(p.morale + (MORALE_BASELINE - p.morale) * MORALE_DRIFT, 0, 100)
    p.form = clamp((p.form + rng.float(-1, 1)) * FORM_DECAY, -5, 5)
  }

  return { healed }
}

/* ────────────────────────── result morale ────────────────────────── */

const RESULT_MORALE_DELTA = 2

/** Small whole-roster morale bump for a win, dip for a loss; clamped 0–100. */
export function applyResultMorale(args: {
  team: Team
  players: Map<PlayerId, Player>
  won: boolean
}): void {
  const delta = args.won ? RESULT_MORALE_DELTA : -RESULT_MORALE_DELTA
  for (const id of args.team.roster) {
    const p = args.players.get(id)
    if (!p) continue
    p.morale = clamp(p.morale + delta, 0, 100)
  }
}

/* ────────────────────────── sim injection seam ────────────────────────── */

const FATIGUE_PENALTY = 0.12 // fatigue 100 → ×0.88
const MORALE_FLOOR = 0.96 // morale 0 → ×0.96
const MORALE_SPAN = 0.07 // morale 100 → ×1.03
const FORM_SPAN = 0.01 // form ±5 → ×0.95..×1.05

/**
 * Wrap a player resolver so the sim reads condition-adjusted composites.
 *
 * Returns a resolver producing a SHALLOW copy of each player with every
 * composite scaled by stacked fatigue/morale/form multipliers, rounded, and
 * clamped to 1–99. The underlying Player is never mutated. Copies are cached
 * per resolver instance — the same id always returns the same object, so one
 * game sees one consistent snapshot; build a fresh resolver per game.
 *
 * Injured players are NOT filtered here: lineup repair keeps them off the
 * lines, and the sim only resolves ids that appear in lines.
 */
export function effectiveResolve(base: (id: PlayerId) => Player): (id: PlayerId) => Player {
  const cache = new Map<PlayerId, Player>()
  return (id: PlayerId): Player => {
    const hit = cache.get(id)
    if (hit) return hit

    const p = base(id)
    const fatigue = clamp(p.fatigue, 0, 100)
    const morale = clamp(p.morale, 0, 100)
    const form = clamp(p.form, -5, 5)
    const mult =
      (1 - FATIGUE_PENALTY * (fatigue / 100)) *
      (MORALE_FLOOR + MORALE_SPAN * (morale / 100)) *
      (1 + FORM_SPAN * form)

    const composites = {} as CompositeRatings
    for (const key in p.composites) {
      const k = key as keyof CompositeRatings
      composites[k] = clamp(Math.round(p.composites[k] * mult), 1, 99)
    }

    const copy: Player = { ...p, composites }
    cache.set(id, copy)
    return copy
  }
}
