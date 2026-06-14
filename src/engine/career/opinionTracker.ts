/**
 * Opinion tracker — a per-player time series of how the read on him evolves over
 * the season: rated overall, current/potential stars, and scouting knowledge.
 *
 * Own-organisation players are always tracked (their ability moves via
 * development, aging, form). League players are tracked once we actually know
 * them (knowledge ≥ a floor), so the timeline reflects scouting uncovering the
 * truth as well as the player himself changing.
 *
 * Pure and deterministic; snapshots are only appended when something changes, so
 * the series stays compact.
 */

import type { Player, PlayerId } from '@domain'
import type { ScoutingState } from '@domain/scouting'
import { knowledgeOf } from '@engine/league/scouting'
import { ratedOverall, ratedPotential } from '@engine/ratings/composites'

export interface OpinionSnapshot {
  day: number
  year: number
  /** Rated overall (0–100), DB-anchored. */
  overall: number
  /** Current ability in stars (0–5, half steps). */
  currentStars: number
  /** Ceiling in stars (1–5). */
  potentialStars: number
  /** Scouting knowledge 0–100 (100 for own-org players). */
  knowledge: number
}

/** Below this knowledge a league player isn't tracked (we don't know him yet). */
const TRACK_FLOOR = 40
const DEFAULT_MAX = 40

export function currentStarsOf(p: Player): number {
  return Math.max(0, Math.min(5, Math.round((ratedOverall(p) / 20) * 2) / 2))
}

export function potentialStarsOf(p: Player): number {
  const score = Math.max(ratedOverall(p), ratedPotential(p))
  return score >= 82 ? 5 : score >= 72 ? 4 : score >= 62 ? 3 : score >= 52 ? 2 : 1
}

export interface RecordOpinionsArgs {
  history: Map<string, OpinionSnapshot[]>
  players: Map<PlayerId, Player>
  scouting: ScoutingState
  /** NHL roster + AHL affiliate ids — always tracked. */
  ownOrgIds: Set<string>
  day: number
  year: number
  maxPerPlayer?: number
}

/**
 * Append a snapshot for each tracked player when his read has moved since the
 * last one (rating/stars changed, knowledge shifted ≥8, or a new season began).
 */
export function recordOpinions(args: RecordOpinionsArgs): void {
  const max = args.maxPerPlayer ?? DEFAULT_MAX
  for (const [pid, p] of args.players) {
    const id = pid as string
    const own = args.ownOrgIds.has(id)
    const k = own ? 100 : knowledgeOf(args.scouting, id)
    if (!own && k < TRACK_FLOOR) continue

    const snap: OpinionSnapshot = {
      day: args.day,
      year: args.year,
      overall: ratedOverall(p),
      currentStars: currentStarsOf(p),
      potentialStars: potentialStarsOf(p),
      knowledge: Math.round(k),
    }

    const arr = args.history.get(id) ?? []
    const last = arr[arr.length - 1]
    const changed =
      !last ||
      last.overall !== snap.overall ||
      last.currentStars !== snap.currentStars ||
      last.potentialStars !== snap.potentialStars ||
      Math.abs(last.knowledge - snap.knowledge) >= 8 ||
      last.year !== snap.year
    if (!changed) continue

    arr.push(snap)
    if (arr.length > max) arr.splice(0, arr.length - max)
    args.history.set(id, arr)
  }
}

/** Plain-English note describing the move between two snapshots. */
export function opinionDelta(prev: OpinionSnapshot, cur: OpinionSnapshot): string | null {
  const dOvr = cur.overall - prev.overall
  const dPot = cur.potentialStars - prev.potentialStars
  const dK = cur.knowledge - prev.knowledge
  if (dPot > 0) return 'Raised his ceiling'
  if (dPot < 0) return 'Lowered his ceiling'
  if (dOvr >= 3) return 'Trending up'
  if (dOvr <= -3) return 'Trending down'
  if (dK >= 12) return 'Getting a clearer read'
  return null
}
