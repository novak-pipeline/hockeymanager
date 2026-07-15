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
import type { GamePlayerStat } from '@engine/shared/outcome'
import type { Rng } from '@engine/shared/rng'

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/* ────────────────────────── injuries ────────────────────────── */

/** ~2.4% per skater per game at league-average durability and usage — tuned so
 *  a team loses roughly 150–220 man-games a season (the real NHL band is
 *  ~250–350, but our injuries never overlap a healthy scratch the way real ones
 *  do, so a slightly lower event rate lands the right on-ice impact). */
const SKATER_INJURY_CHANCE = 0.024
/** Goalies absorb far less contact; lower base, full-game TOI reference. */
const GOALIE_INJURY_CHANCE = 0.008
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
    'blocked a shot — bruised foot',
    'knee-on-knee collision — sprained MCL',
    'caught a rut — sprained ankle',
    'groin strain on a stretch save',
    'hip pointer after a hit',
    'tweaked a knee on an awkward fall',
    'charley horse from a slash',
    'lower-body injury'
  ],
  upperBody: [
    'separated shoulder on a hit',
    'broken finger blocking a shot',
    'wrist injury after a slash',
    'hand injury in a fight',
    'bruised ribs from a hit',
    'tweaked his back',
    'upper-body injury'
  ],
  illness: ['flu', 'a virus', 'food poisoning', 'illness'],
  concussion: [
    'concussion after a blindside hit',
    'concussion protocol following a fight',
    'concussion from a hit to the head',
    'concussion'
  ]
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
  const scale = kind === 'concussion' ? 6 : 3.8
  const cap = kind === 'concussion' ? 45 : 30
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
  // Age: older bodies break down more (a 36-year-old ≈ 1.2× a prime skater),
  // and the youngest are a touch more resilient. Neutral through the prime years.
  const ageFactor = player.age >= 30 ? 1 + (player.age - 30) * 0.035 : player.age <= 22 ? 0.9 : 1
  // Per-player durability from the source DB (1–99, 50 = league average). A
  // glass player (high proneness) gets hurt more; an iron man less. Absent on
  // fictional players → 1.0× (unchanged).
  const proneFactor = player.injuryProneness !== undefined ? clamp(player.injuryProneness / 50, 0.2, 2.5) : 1
  return clamp(base * balanceFactor * aggressionFactor * toiFactor * ageFactor * proneFactor, 0, 0.25)
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
    const gamesOut = rollGamesOut(rng, kind)
    const injury: Injury = {
      kind,
      gamesRemaining: gamesOut,
      description: rng.pick(INJURY_DESCRIPTIONS[kind]),
      totalGames: gamesOut // remembered so the return can carry match rust
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

/* Match rust: only absences of this many games leave a player needing to round
 * back into game shape; the ramp length scales with how long he was out. */
const RUST_THRESHOLD = 5
const RUST_SCALE = 0.4
const RUST_MIN = 2
const RUST_MAX = 6

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
 *  - Match rust: a player returning from a long absence (≥5 games) picks up a
 *    rust counter scaled to the layoff; each game he plays burns one off. The
 *    `returns` array carries the freshly-healed players and their rust so the
 *    career layer can flavour the comeback ("still finding his legs").
 */
export function tickRecovery(args: {
  players: Iterable<Player>
  playedToday: Set<PlayerId> | ((id: PlayerId) => boolean)
  rng: Rng
}): { healed: PlayerId[]; returns: Array<{ id: PlayerId; rustGames: number }> } {
  const { players, playedToday, rng } = args
  const played =
    typeof playedToday === 'function' ? playedToday : (id: PlayerId): boolean => playedToday.has(id)
  const healed: PlayerId[] = []
  const returns: Array<{ id: PlayerId; rustGames: number }> = []

  for (const p of players) {
    const playedNow = played(p.id)

    if (p.injuryStatus !== null && !playedNow) {
      p.injuryStatus.gamesRemaining -= 1
      if (p.injuryStatus.gamesRemaining <= 0) {
        const wasOut = p.injuryStatus.totalGames ?? 0
        p.injuryStatus = null
        // #157: a player coming off a long-term injury automatically comes off
        // LTIR — his cap hit counts again (the club must be compliant on return).
        if (p.ltir) p.ltir = false
        healed.push(p.id)
        // A meaningful layoff leaves ring rust to shake off over the next few
        // games; a day-to-day tweak (<5 games) does not.
        if (wasOut >= RUST_THRESHOLD) {
          const rust = clamp(Math.round(wasOut * RUST_SCALE), RUST_MIN, RUST_MAX)
          p.rustGames = rust
          returns.push({ id: p.id, rustGames: rust })
        }
      }
    }

    if (playedNow) {
      const staminaScale = 1.3 - 0.006 * p.ratings.physical.stamina
      p.fatigue = clamp(
        p.fatigue + (FATIGUE_PER_GAME + rng.float(-FATIGUE_NOISE, FATIGUE_NOISE)) * staminaScale,
        0,
        100
      )
      // Playing a game (while healthy) is what actually burns off match rust.
      if (p.injuryStatus === null && p.rustGames) {
        p.rustGames = Math.max(0, p.rustGames - 1)
        if (p.rustGames === 0) delete p.rustGames
      }
    } else {
      // Natural fitness (1–99, 50 = average) speeds rest recovery. Absent → 1.0×.
      const fitFactor = p.naturalFitness !== undefined ? 0.7 + 0.6 * (p.naturalFitness / 100) : 1
      p.fatigue = clamp(p.fatigue - REST_RECOVERY * fitFactor, 0, 100)
    }

    p.morale = clamp(p.morale + (MORALE_BASELINE - p.morale) * MORALE_DRIFT, 0, 100)
    p.form = clamp((p.form + rng.float(-1, 1)) * FORM_DECAY, -5, 5)
  }

  return { healed, returns }
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

/* ────────────────────────── earned form (hot/cold) ────────────────────────── */

/**
 * Performance-driven form nudge from one game's box score.
 *
 * `form` (−5..+5) is read all over the app — the lineup AI benches "slumping"
 * players, scouts bias their reports, coaches flag cold top-sixers, projections
 * say "in strong form" — but its only other input is a gentle random walk
 * (`tickRecovery`). That means a hat trick and an invisible night moved form the
 * same way. This grounds streaks in the ice: a good night pushes form up, a
 * quiet one nudges it down, measured against what a player of this caliber is
 * *expected* to produce (a star's pointless night dings more than a grinder's).
 * The random walk + 0.9 daily decay stay on top as noise/regression, so streaks
 * build over several games and fade without production.
 *
 * Deterministic — a pure function of the box score, so it consumes no Rng and
 * seeded league replays are byte-for-byte unchanged. Returns a delta to add to
 * `player.form`; the caller clamps the running total to [-5, 5].
 */
export function formDeltaFromGame(player: Player, stat: GamePlayerStat): number {
  if (player.position === 'G') {
    const faced = stat.shotsAgainst
    if (faced <= 0) return 0
    const savePct = stat.saves / faced
    // Expected save%, tilted by the goalie's own quality: an elite netminder is
    // held to a higher bar than a backup (~.870 poor … ~.930 elite).
    const baseline = 0.9 + (player.composites.goaltending - 60) * 0.001
    const confidence = Math.min(1, faced / 25) // low-volume nights swing less
    let d = (savePct - baseline) * 12 * confidence
    if (stat.goalsAgainst === 0 && faced >= 15) d += 0.4 // shutout glow
    if (stat.goalsAgainst >= 5) d -= 0.3 // got shelled
    return clamp(d, -0.7, 1.2)
  }

  // Skater: a lightweight game-score from the counters fans actually notice.
  const gs =
    0.9 * stat.goals +
    0.6 * stat.assists +
    0.05 * stat.shots +
    0.12 * stat.plusMinus +
    0.05 * stat.blockedShots +
    0.06 * stat.takeaways -
    0.06 * stat.giveaways
  // Expected output scales with offensive caliber → stars are held to standard,
  // depth guys are graded on a curve. Scoring is steeply non-linear in rating
  // (a 55 is a bottom-six chip-in; an 85 drives a line), so the baseline uses a
  // power curve, not the raw rating: ~0.11 at 32, ~0.30 at 55, ~0.70 at 85.
  const offense = (player.composites.scoring + player.composites.playmaking) / 2
  const baseline = Math.pow(offense / 100, 1.9) * 0.95
  // Full-minute players' nights carry full weight; cameo minutes weigh less.
  const toiWeight = clamp(stat.toi / 1000, 0.4, 1)
  return clamp((gs - baseline) * 0.7 * toiWeight, -0.6, 1.2)
}

/* ────────────────────────── sim injection seam ────────────────────────── */

// Fatigue lives in a ~0-25 in-season band (mean ~4), so the old `fatigue/100`
// scaling made it a near-dead lever (≤3% even for a maxed-out player). Instead we
// center on the league-average fatigue: the typical player is neutral (so season
// scoring — and calibration — is unchanged) while the SPREAD does real work. A
// fresh player is a touch sharper; a gassed one (a heavy stretch, the back half
// of a back-to-back) is meaningfully duller. Stamina, which slows fatigue accrual
// in tickRecovery, now shows up on the ice.
const FATIGUE_REF = 4 // league-average in-season fatigue → neutral
const FATIGUE_PER_POINT = 0.006 // per fatigue point away from the reference
const FATIGUE_MIN = 0.87 // a fully gassed player floors here
const FATIGUE_MAX = 1.03 // a fully rested one tops out here
const MORALE_FLOOR = 0.96 // morale 0 → ×0.96
const MORALE_SPAN = 0.07 // morale 100 → ×1.03
const FORM_SPAN = 0.01 // form ±5 → ×0.95..×1.05
const RUST_PENALTY = 0.06 // full rust (RUST_MAX games) → ×0.94, easing to ×1.0
const CONTRACT_BOOST = 0.03 // a max-ambition pending UFA in his walk year → ×1.03
const CONTRACT_COAST = 0.02 // a low-professionalism player fresh off a big deal → ×0.98

/**
 * The "contract year" effect: a season-long motivation multiplier read from a
 * player's deal and personality. A player in the final year of his contract
 * (yearsRemaining === 1) presses for the payday — scaled by ambition, and
 * strongest for a pending UFA (age ≥ 27) with everything on the line. A player
 * just locked up long-term (yearsRemaining ≥ 4) can coast a touch if his
 * professionalism is low; a true pro never does. Everyone else is neutral.
 *
 * Personality attributes are on the 1–20 scale. Deterministic and small (±3%),
 * it stacks with fatigue/morale/form/rust in effectiveResolve, so a walk-year
 * sniper's extra goals raise his next contract while a coaster's dip is real.
 */
export function contractMotivation(p: Player): number {
  const yrs = p.contract.yearsRemaining
  if (yrs === 1) {
    // Ambition (1–20) drives the push; a pending UFA has the most on the line.
    const ambPush = clamp((p.personality.ambition - 10) / 10, 0, 1)
    const stakes = p.age >= 27 ? 1 : 0.6 // RFAs care, but less than pending UFAs
    return 1 + CONTRACT_BOOST * clamp(ambPush * stakes, 0, 1)
  }
  if (yrs >= 4) {
    const coast = clamp((10 - p.personality.professionalism) / 10, 0, 1)
    return 1 - CONTRACT_COAST * coast
  }
  return 1
}

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
    // Match rust: a just-returned player is a step slow until he's played a few
    // games (rustGames burns down in tickRecovery). Composes with the rest.
    const rust = clamp(p.rustGames ?? 0, 0, RUST_MAX)
    const fatigueMult = clamp(1 - FATIGUE_PER_POINT * (fatigue - FATIGUE_REF), FATIGUE_MIN, FATIGUE_MAX)
    const mult =
      fatigueMult *
      (MORALE_FLOOR + MORALE_SPAN * (morale / 100)) *
      (1 + FORM_SPAN * form) *
      (1 - RUST_PENALTY * (rust / RUST_MAX)) *
      contractMotivation(p)

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
