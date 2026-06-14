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

/** A meaningful shift in the read on a player, surfaced as inbox news. */
export interface OpinionShift {
  playerId: string
  ownOrg: boolean
  /** 'up' | 'down' for tone/headline selection. */
  direction: 'up' | 'down'
  note: string
}

/** Notable inbox-worthy move (ceiling change or a strong overall swing). */
function notableShift(prev: OpinionSnapshot, cur: OpinionSnapshot): OpinionShift['note'] | null {
  if (cur.potentialStars > prev.potentialStars) return 'raised-ceiling'
  if (cur.potentialStars < prev.potentialStars) return 'lowered-ceiling'
  if (cur.overall - prev.overall >= 4) return 'rising'
  if (cur.overall - prev.overall <= -4) return 'falling'
  return null
}

/**
 * Append a snapshot for each tracked player when his read has moved since the
 * last one (rating/stars changed, knowledge shifted ≥8, or a new season began),
 * and return the meaningful shifts (ceiling/strong swing) for inbox surfacing.
 */
export function recordOpinions(args: RecordOpinionsArgs): OpinionShift[] {
  const max = args.maxPerPlayer ?? DEFAULT_MAX
  const shifts: OpinionShift[] = []
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

    // Note a meaningful shift (only when comparing within the same season).
    if (last && last.year === snap.year) {
      const note = notableShift(last, snap)
      if (note) {
        shifts.push({
          playerId: id,
          ownOrg: own,
          direction: note === 'raised-ceiling' || note === 'rising' ? 'up' : 'down',
          note,
        })
      }
    }

    arr.push(snap)
    if (arr.length > max) arr.splice(0, arr.length - max)
    args.history.set(id, arr)
  }
  return shifts
}

/** Inbox headline + body for a meaningful opinion shift. */
export function shiftHeadline(name: string, shift: OpinionShift): { headline: string; body: string } {
  switch (shift.note) {
    case 'raised-ceiling':
      return { headline: `Scouts raise their ceiling on ${name}`, body: `The staff now project a higher long-term ceiling for ${name} after his recent development and play.` }
    case 'lowered-ceiling':
      return { headline: `Doubts grow over ${name}'s ceiling`, body: `The staff have tempered their long-term projection for ${name}.` }
    case 'rising':
      return { headline: `${name} is trending up`, body: `${name}'s stock is rising — the staff like what they have seen of late.` }
    default:
      return { headline: `${name} is trending down`, body: `Concerns about ${name}'s recent level have the staff lowering their read.` }
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
