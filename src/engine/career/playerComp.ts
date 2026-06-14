/**
 * "Shades of …" player comparison v2.
 *
 * Scouts/analysts comp a prospect against an established player they
 * stylistically resemble, then qualify the difference ("…but with a bigger
 * frame and faster feet"). This module finds the closest established comparable
 * IN THE LOADED DATABASE by attribute profile — so with a real-roster mod it
 * yields real names ("Shades of Moritz Seider"), and with the fictional default
 * DB it yields fictional ones. Falls back to nothing when no suitable
 * comparable exists (caller can then use the archetype-pool comp).
 *
 * Pure: deterministic given (prospect, pool). No RNG.
 */
import type { Player } from '@domain'
import { classifyArchetype, type Archetype } from '@engine/league/archetypes'
import { agedPotential, ratedOverall } from '@engine/ratings/composites'

/**
 * A comp is a PROJECTION tool — "this kid could become like X". Once a player
 * has reached his prime (established at his level, no real headroom left), there
 * is nothing to project, so the comparison goes away. Pre-prime = young, or
 * still carrying meaningful potential headroom.
 */
export function isPrePrime(p: Player): boolean {
  if (p.age <= 23) return true
  return agedPotential(p) - ratedOverall(p) >= 5 && p.age <= 27
}

/** Position bucket for like-for-like comparison. */
type PosGroup = 'F' | 'D' | 'G'
function posGroup(position: string): PosGroup {
  if (position === 'G') return 'G'
  if (position === 'D' || position === 'LD' || position === 'RD') return 'D'
  return 'F'
}

/** Composite axes used for profile distance, by position group. */
const PROFILE_AXES: Record<PosGroup, string[]> = {
  F: ['scoring', 'playmaking', 'puckControl', 'skating', 'hitting', 'defensiveZone', 'takeaway'],
  D: ['defensiveZone', 'takeaway', 'blocking', 'playmaking', 'skating', 'hitting', 'scoring'],
  G: ['goaltending', 'skating'],
}

function comp(p: Player): Record<string, number> {
  return p.composites as unknown as Record<string, number>
}

/** Euclidean distance over the position-appropriate composite axes. */
function profileDistance(a: Player, b: Player, group: PosGroup): number {
  const ca = comp(a)
  const cb = comp(b)
  let sum = 0
  for (const k of PROFILE_AXES[group]) {
    const d = (ca[k] ?? 50) - (cb[k] ?? 50)
    sum += d * d
  }
  return Math.sqrt(sum)
}

/**
 * A differentiator axis: how the prospect can deviate from his comparable, with
 * the phrase used in each direction. `value` reads the metric off a player.
 */
interface DiffAxis {
  /** Larger prospect value than comp → `higher`; smaller → `lower`. */
  higher: string
  lower: string
  /** Minimum absolute gap to mention. */
  threshold: number
  value: (p: Player) => number
}

const DIFF_AXES: DiffAxis[] = [
  {
    higher: 'a bigger frame', lower: 'a more compact frame', threshold: 4,
    value: (p) => (p.heightCm ?? 183) + (p.weightKg ?? 88) * 0.5,
  },
  {
    higher: 'faster feet', lower: 'heavier legs', threshold: 8,
    value: (p) => comp(p)['skating'] ?? 50,
  },
  {
    higher: 'a heavier shot', lower: 'less of a shooting threat', threshold: 9,
    value: (p) => comp(p)['scoring'] ?? 50,
  },
  {
    higher: 'softer hands', lower: 'rawer hands', threshold: 9,
    value: (p) => comp(p)['puckControl'] ?? 50,
  },
  {
    higher: 'more vision', lower: 'a simpler playmaking game', threshold: 9,
    value: (p) => comp(p)['playmaking'] ?? 50,
  },
  {
    higher: 'a meaner physical edge', lower: 'a softer physical game', threshold: 10,
    value: (p) => comp(p)['hitting'] ?? 50,
  },
  {
    higher: 'a more reliable defensive game', lower: 'more defensive work to do', threshold: 10,
    value: (p) => comp(p)['defensiveZone'] ?? 50,
  },
]

export interface PlayerComp {
  /** 1–2 comparables, best first. */
  names: string[]
  /** "but with a bigger frame and faster feet" — empty string if none stood out. */
  differentiator: string
  /** Archetype the prospect classifies as (drives the "shades of" framing). */
  archetype: Archetype
  /** Ready-made sentence for display. */
  summary: string
}

export interface BuildPlayerCompArgs {
  prospect: Player
  /** All players in the world (the comp pool is filtered from this). */
  pool: Player[]
  /** Scouting knowledge 0–100; comps are gated at ≥ 50 like the archetype comp. */
  knowledge: number
}

/**
 * Build the "shades of" comp for a prospect. Returns null when knowledge is too
 * low or no suitable established comparable exists in the pool.
 */
export function buildPlayerComp({ prospect, pool, knowledge }: BuildPlayerCompArgs): PlayerComp | null {
  if (knowledge < 50) return null
  // Comps are a projection device — drop them once a player has hit his prime.
  if (!isPrePrime(prospect)) return null

  const group = posGroup(prospect.position)
  const arch = classifyArchetype(prospect)

  // Candidate pool: established players (not the prospect), same position group,
  // proven (age 24–34 and a real NHL-calibre ability) so the comp is a known
  // commodity, not another prospect.
  const candidates = pool.filter((c) => {
    if (c.id === prospect.id) return false
    if (posGroup(c.position) !== group) return false
    if (c.age < 24 || c.age > 34) return false
    return ratedOverall(c) >= 70
  })
  if (candidates.length === 0) return null

  // Score by attribute distance; reward a matching archetype so the comp shares
  // a playing style, not just a stat line.
  const scored = candidates
    .map((c) => {
      const sameArch = classifyArchetype(c).archetype === arch.archetype
      const dist = profileDistance(prospect, c, group) - (sameArch ? 18 : 0)
      return { player: c, dist }
    })
    .sort((a, b) => a.dist - b.dist)

  const primary = scored[0]
  if (!primary) return null
  // A second comp only if it's nearly as close (keeps "shades of A, B" tight).
  const secondary = scored[1] && scored[1].dist - primary.dist < 14 ? scored[1] : undefined
  const names = secondary ? [primary.player.name, secondary.player.name] : [primary.player.name]

  // Differentiator vs the PRIMARY comp: the 1–2 widest, above-threshold gaps.
  const diffs = DIFF_AXES
    .map((ax) => {
      const delta = ax.value(prospect) - ax.value(primary.player)
      const phrase = delta >= 0 ? ax.higher : ax.lower
      return { mag: Math.abs(delta), pass: Math.abs(delta) >= ax.threshold, phrase }
    })
    .filter((d) => d.pass)
    .sort((a, b) => b.mag - a.mag)
    .slice(0, 2)
    .map((d) => d.phrase)

  const differentiator = diffs.length === 0 ? '' : `but with ${joinPhrases(diffs)}`
  const shadesOf = names.length > 1 ? `${names[0]} and ${names[1]}` : names[0]!
  const summary = differentiator
    ? `Shades of ${shadesOf} — ${differentiator}.`
    : `Shades of ${shadesOf}.`

  return { names, differentiator, archetype: arch.archetype, summary }
}

function joinPhrases(phrases: string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? ''
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`
}
