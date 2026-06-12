/**
 * Rivalries — emergent rival pairings that make certain games intense.
 *
 * Design constraints:
 *  - JSON-safe state (no Maps / classes / functions) — embeds in CareerSnapshot
 *    as an optional additive field with a fallback to seedRivalries on load.
 *  - All randomness via seeded Rng — no Math.random, no wall-clock.
 *  - Pure functions; returns NewsSeed objects; never pushes news itself.
 *  - Bounded: at most MAX_RIVALRIES total; no all-vs-all explosion.
 *  - Intensity: 0–100 integer; flash news rate-limited via lastFlashYear.
 */

import type { Rng } from '@engine/shared/rng'
import type { NewsCategory } from '@domain/news'

/* ────────────────────────── public types ────────────────────────── */

export type RivalryReason =
  | 'division'
  | 'playoff history'
  | 'chippy games'
  | 'close races'

export interface Rivalry {
  teamA: string
  teamB: string
  /** 0–100. */
  intensity: number
  reasons: RivalryReason[]
  meetings: number
  /** Season year of the last "flash" news event for this pairing. */
  lastFlashYear?: number
}

export interface RivalriesState {
  rivalries: Rivalry[]
}

export interface NewsSeed {
  category: NewsCategory
  headline: string
  body: string
  teamId?: string
  playerId?: string
}

/* ────────────────────────── constants ────────────────────────── */

/** Max total rivalries tracked. Keeps state bounded. */
const MAX_RIVALRIES = 40

/** Number of chippy/close meetings that can create a brand-new rivalry. */
const NEW_RIVALRY_MEETINGS_THRESHOLD = 3

/** Intensity threshold below which a rivalry is considered dormant (and eligible for eviction). */
const DORMANT_THRESHOLD = 10

/** Flash news thresholds. A pairing flashes once per crossing (up only). */
const FLASH_THRESHOLD_1 = 60
const FLASH_THRESHOLD_2 = 80

/** Yearly decay: intensity drops by this much each offseason. */
const DECAY_PER_YEAR = 8

/** Minimum intensity that decay will reduce to (rivalries never fully die via decay alone). */
const DECAY_FLOOR = 5

/** Starting intensity for same-division pairs at preseason seeding. */
const DIVISION_SEED_INTENSITY = 30

/** Starting intensity for cross-division marquee picks. */
const CROSS_DIVISION_SEED_INTENSITY = 20

/* ────────────────────────── helpers ────────────────────────── */

/** Canonical key for a pairing — always sorted so (A,B) === (B,A). */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** Find an existing rivalry between two teams, if any. */
export function rivalryBetween(state: RivalriesState, teamA: string, teamB: string): Rivalry | null {
  const key = pairKey(teamA, teamB)
  return state.rivalries.find((r) => pairKey(r.teamA, r.teamB) === key) ?? null
}

/** Clamp a number to [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Ensure the reasons array contains a reason without duplicating. */
function addReason(reasons: RivalryReason[], reason: RivalryReason): RivalryReason[] {
  if (reasons.includes(reason)) return reasons
  return [...reasons, reason]
}

/** Upsert a rivalry into the state. Evicts dormant/lowest-intensity entry when at cap. */
function upsert(state: RivalriesState, r: Rivalry): void {
  const key = pairKey(r.teamA, r.teamB)
  const idx = state.rivalries.findIndex((x) => pairKey(x.teamA, x.teamB) === key)
  if (idx >= 0) {
    state.rivalries[idx] = r
    return
  }
  // Need to add a new entry.
  if (state.rivalries.length >= MAX_RIVALRIES) {
    // Evict the dormant or lowest-intensity rivalry (prefer dormant ones first).
    const dormant = state.rivalries
      .map((x, i) => ({ i, intensity: x.intensity }))
      .filter((x) => x.intensity <= DORMANT_THRESHOLD)
    if (dormant.length > 0) {
      const evict = dormant.reduce((a, b) => (a.intensity < b.intensity ? a : b))
      state.rivalries.splice(evict.i, 1)
    } else {
      // Evict the lowest-intensity rivalry overall.
      let minIdx = 0
      for (let i = 1; i < state.rivalries.length; i++) {
        if (state.rivalries[i]!.intensity < state.rivalries[minIdx]!.intensity) minIdx = i
      }
      state.rivalries.splice(minIdx, 1)
    }
  }
  state.rivalries.push(r)
}

/* ────────────────────────── seedRivalries ────────────────────────── */

export interface SeedRivalriesArgs {
  teams: Array<{ teamId: string; divisionId: string; conferenceId: string }>
  rng: Rng
}

/**
 * Build the preseason rivalry baseline.
 *
 * - All same-division pairs get a starting intensity of DIVISION_SEED_INTENSITY.
 * - A small number of marquee cross-division pairings are seeded at a lower
 *   intensity. The exact pairs are picked with the seeded Rng so they are
 *   deterministic but vary per career seed.
 */
export function seedRivalries(args: SeedRivalriesArgs): RivalriesState {
  const { teams, rng } = args
  const state: RivalriesState = { rivalries: [] }

  // Build division buckets.
  const byDiv = new Map<string, string[]>()
  for (const t of teams) {
    const bucket = byDiv.get(t.divisionId) ?? []
    bucket.push(t.teamId)
    byDiv.set(t.divisionId, bucket)
  }

  // Seed all same-division pairs.
  for (const members of byDiv.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const r: Rivalry = {
          teamA: members[i]!,
          teamB: members[j]!,
          intensity: DIVISION_SEED_INTENSITY,
          reasons: ['division'],
          meetings: 0,
        }
        upsert(state, r)
      }
    }
  }

  // Pick a handful of cross-division marquee rivalries.
  // Strategy: pick random team pairs that are NOT in the same division; limit
  // to ~1 per team on average (bounded by total teams / 2, cap at 8).
  const teamIds = teams.map((t) => t.teamId)
  const divOf = new Map(teams.map((t) => [t.teamId, t.divisionId]))
  const marqueeCount = Math.min(8, Math.max(2, Math.floor(teamIds.length / 4)))

  // Build pool of cross-division pairs shuffled.
  const crossPairs: Array<[string, string]> = []
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      if (divOf.get(teamIds[i]!) !== divOf.get(teamIds[j]!)) {
        crossPairs.push([teamIds[i]!, teamIds[j]!])
      }
    }
  }
  rng.shuffle(crossPairs)
  for (let k = 0; k < Math.min(marqueeCount, crossPairs.length); k++) {
    const [a, b] = crossPairs[k]!
    const existing = rivalryBetween(state, a, b)
    if (existing) {
      existing.intensity = Math.max(existing.intensity, CROSS_DIVISION_SEED_INTENSITY)
    } else {
      upsert(state, {
        teamA: a,
        teamB: b,
        intensity: CROSS_DIVISION_SEED_INTENSITY,
        reasons: [],
        meetings: 0,
      })
    }
  }

  return state
}

/* ────────────────────────── registerGame ────────────────────────── */

export interface RegisterGameArgs {
  state: RivalriesState
  teamA: string
  teamB: string
  goalsA: number
  goalsB: number
  penaltyMinutesA: number
  penaltyMinutesB: number
  wasPlayoff?: boolean
  year: number
  rng: Rng
}

export interface RegisterGameResult {
  newsSeeds: NewsSeed[]
  /** True when the rivalry crossed a flash threshold and a news item was emitted. */
  flashed: boolean
}

/**
 * Record the outcome of a game between two teams.
 *
 * Intensity nudges up for:
 *  - One-goal games (+4)
 *  - High combined PIM (>= 20 mins = chippy game, +5)
 *  - Playoff meetings (+10)
 *  - Repeated meetings when already intense (+2 per meeting beyond 2)
 *
 * A brand-new rivalry forms when two non-rivals rack up
 * NEW_RIVALRY_MEETINGS_THRESHOLD chippy/close meetings tracked in a temporary
 * counter (we use a sentinel rivalry with intensity=0 as the accumulator).
 *
 * Flash news is emitted when crossing 60 or 80, rate-limited to once per year.
 */
export function registerGame(args: RegisterGameArgs): RegisterGameResult {
  const { state, teamA, teamB, goalsA, goalsB, penaltyMinutesA, penaltyMinutesB, wasPlayoff, year, rng: _rng } = args
  const newsSeeds: NewsSeed[] = []
  let flashed = false

  const isCloseGame = Math.abs(goalsA - goalsB) <= 1
  const combinedPim = penaltyMinutesA + penaltyMinutesB
  const isChippy = combinedPim >= 20
  const isPlayoff = wasPlayoff === true

  let r = rivalryBetween(state, teamA, teamB)

  // If no existing rivalry but the game meets criteria, start an accumulation entry.
  if (!r && (isCloseGame || isChippy || isPlayoff)) {
    r = {
      teamA,
      teamB,
      intensity: 0,
      reasons: [],
      meetings: 0,
    }
    upsert(state, r)
    // Re-fetch the canonical reference from state.
    r = rivalryBetween(state, teamA, teamB)!
  }

  // If still no rivalry (game was unremarkable and teams are strangers), do nothing.
  if (!r) return { newsSeeds, flashed }

  const prevIntensity = r.intensity
  const prevMeetings = r.meetings

  // Increment meetings counter.
  r.meetings += 1

  // Accumulate intensity bumps.
  let delta = 0

  if (isCloseGame) {
    delta += 4
    r.reasons = addReason(r.reasons, 'close races')
  }

  if (isChippy) {
    delta += 5
    r.reasons = addReason(r.reasons, 'chippy games')
  }

  if (isPlayoff) {
    delta += 10
    r.reasons = addReason(r.reasons, 'playoff history')
  }

  // Bonus for repeated intense meetings (meetings > 2 when already hot).
  if (r.meetings > 2 && r.intensity >= 40) {
    delta += 2
  }

  r.intensity = clamp(r.intensity + delta, 0, 100)

  // Check new-rivalry formation: a pairing that just crossed the meetings threshold
  // via chippy/close games. We identify "organic" (not preseason-seeded) pairings by
  // their starting intensity being below the division seed floor (30). Seeded division
  // pairs start at 30; organic accumulators start at 0.
  const isNewRivalry =
    prevMeetings + 1 === NEW_RIVALRY_MEETINGS_THRESHOLD &&
    prevIntensity < DIVISION_SEED_INTENSITY &&
    r.intensity > 0

  if (isNewRivalry) {
    const abbrA = teamA
    const abbrB = teamB
    const whyParts: string[] = []
    if (r.reasons.includes('chippy games')) whyParts.push('physical play')
    if (r.reasons.includes('close races')) whyParts.push('close finishes')
    const why = whyParts.length > 0 ? ` — fuelled by ${whyParts.join(' and ')}` : ''
    newsSeeds.push({
      category: 'league',
      headline: `A rivalry is born: ${abbrA} vs ${abbrB}`,
      body: `After ${r.meetings} heated meetings${why}, ${abbrA} and ${abbrB} have developed a genuine rivalry.`,
      teamId: teamA,
    })
  }

  // Flash news when crossing intensity thresholds, rate-limited to once per year.
  const thresholds = [FLASH_THRESHOLD_2, FLASH_THRESHOLD_1] as const
  for (const threshold of thresholds) {
    if (prevIntensity < threshold && r.intensity >= threshold) {
      if ((r.lastFlashYear ?? -1) < year) {
        r.lastFlashYear = year
        flashed = true
        const label = threshold >= FLASH_THRESHOLD_2 ? 'bitter' : 'heated'
        const winnerTeam = goalsA > goalsB ? teamA : goalsA < goalsB ? teamB : null
        const winnerLine = winnerTeam
          ? ` ${winnerTeam} took this one, adding fuel to the fire.`
          : ' The game ended level, settling nothing.'
        newsSeeds.push({
          category: 'league',
          headline: `${teamA} vs ${teamB}: a ${label} rivalry ignites`,
          body:
            `The ${teamA}–${teamB} rivalry has reached intensity ${r.intensity}/100, ` +
            `driven by ${r.reasons.join(', ')}.${winnerLine}`,
          teamId: teamA,
        })
        break // Only one flash event per game.
      }
    }
  }

  return { newsSeeds, flashed }
}

/* ────────────────────────── gameIntensity ────────────────────────── */

export interface GameIntensityResult {
  /** 0–1 drama scalar (0 = neutral game, 1 = maximum rivalry tension). */
  factor: number
  /** Human label for the UI, e.g. 'Rivalry Night' or null for ordinary games. */
  label: string | null
}

/**
 * Pre-game drama factor for a matchup.
 *
 * The career layer uses this to:
 *  - Scale pre-game press language.
 *  - Boost crowd noise / atmosphere.
 *  - Apply a small morale swing to the winner/loser of high-intensity games.
 */
export function gameIntensity(state: RivalriesState, teamA: string, teamB: string): GameIntensityResult {
  const r = rivalryBetween(state, teamA, teamB)
  if (!r || r.intensity < FLASH_THRESHOLD_1) {
    return { factor: 0, label: null }
  }
  const factor = (r.intensity - FLASH_THRESHOLD_1) / (100 - FLASH_THRESHOLD_1)
  const label = r.intensity >= FLASH_THRESHOLD_2 ? 'Grudge Match' : 'Rivalry Night'
  return { factor: clamp(factor, 0, 1), label }
}

/* ────────────────────────── decayIntensity ────────────────────────── */

/**
 * Gentle yearly intensity decay — call once per offseason.
 *
 * Dormant rivalries (intensity <= DORMANT_THRESHOLD after decay) are NOT
 * removed; they persist in the record as historical context and can be
 * re-ignited by playoff meetings or another chippy run.
 */
export function decayIntensity(state: RivalriesState, _year: number): void {
  for (const r of state.rivalries) {
    r.intensity = Math.max(DECAY_FLOOR, r.intensity - DECAY_PER_YEAR)
  }
}
