/**
 * World Juniors (U20) projection (#48). A nation-based tournament over the
 * world's best under-20 players — the marquee prospect showcase. This computes a
 * deterministic projected medal table and all-tournament team from the current
 * U20 pool, so the International tab can show "if the World Juniors were held now,
 * here's how it'd shake out." (A live, calendar-fired event with reputation
 * swings is the deeper follow-up.)
 *
 * Pure given its inputs + seed.
 */
import type { Player, PlayerId } from '@domain'
import { overallToStars, ratedOverall } from '@engine/ratings/composites'
import type { Rng } from '@engine/shared/rng'

export interface WJNationResult {
  nation: string
  /** Pool strength (avg current ability of the best ~22 U20s), 0–100. */
  rating: number
  /** Final placing, 1 = gold. */
  finish: number
}

export interface WJStandout {
  playerId: string
  name: string
  nation: string
  teamAbbr: string
  position: string
  stars: number
}

export interface WorldJuniorsResult {
  /** Field size actually contested (top nations by U20 strength). */
  contested: number
  gold: string | null
  silver: string | null
  bronze: string | null
  standings: WJNationResult[]
  /** All-tournament team — the best U20s on show. */
  allStars: WJStandout[]
}

/** Max U20 age (World Juniors is an under-20 tournament). */
const U20_MAX_AGE = 19
/** A nation needs at least this many U20s to ice a team. */
const MIN_POOL = 13
/** Tournament field size. */
const FIELD = 10
/** National-team roster used to rate a pool. */
const ROSTER = 22

export function runWorldJuniors(args: {
  players: Map<PlayerId, Player>
  rng: Rng
  teamAbbrOf?: (id: PlayerId) => string
}): WorldJuniorsResult {
  const { players, rng } = args

  const byNation = new Map<string, Player[]>()
  for (const p of players.values()) {
    if (p.age > U20_MAX_AGE) continue
    const nat = (p.nationality ?? '').trim()
    if (!nat || nat === '[None]') continue
    let list = byNation.get(nat)
    if (!list) { list = []; byNation.set(nat, list) }
    list.push(p)
  }

  // Rate each eligible nation by its best U20s.
  const rated: Array<{ nation: string; rating: number; pool: Player[] }> = []
  for (const [nation, pool] of byNation) {
    if (pool.length < MIN_POOL) continue
    const sorted = [...pool].sort((a, b) => ratedOverall(b) - ratedOverall(a))
    const best = sorted.slice(0, ROSTER)
    const rating = Math.round(best.reduce((s, p) => s + ratedOverall(p), 0) / best.length)
    rated.push({ nation, rating, pool: sorted })
  }
  rated.sort((a, b) => b.rating - a.rating)
  const field = rated.slice(0, FIELD)
  if (field.length === 0) {
    return { contested: 0, gold: null, silver: null, bronze: null, standings: [], allStars: [] }
  }

  // Tournament outcome = pool strength + variance (upsets happen, but the strong
  // pools usually medal). Deterministic via the seeded rng.
  const perf = field
    .map((f) => ({ ...f, score: f.rating + rng.normal(0, 6) }))
    .sort((a, b) => b.score - a.score)
  const standings: WJNationResult[] = perf.map((f, i) => ({ nation: f.nation, rating: f.rating, finish: i + 1 }))

  // All-tournament team: the best U20s across the medalling/field nations.
  const abbr = args.teamAbbrOf ?? ((): string => 'FA')
  const allStars: WJStandout[] = field
    .flatMap((f) => f.pool.slice(0, 5))
    .sort((a, b) => ratedOverall(b) - ratedOverall(a))
    .slice(0, 6)
    .map((p) => ({
      playerId: p.id as string,
      name: p.name,
      nation: (p.nationality ?? '').trim(),
      teamAbbr: abbr(p.id),
      position: p.position,
      stars: overallToStars(ratedOverall(p)),
    }))

  return {
    contested: field.length,
    gold: perf[0]?.nation ?? null,
    silver: perf[1]?.nation ?? null,
    bronze: perf[2]?.nation ?? null,
    standings,
    allStars,
  }
}
