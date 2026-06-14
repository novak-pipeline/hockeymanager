/**
 * FM-style "Overall Report" scout verdict: a recommendation banner plus Pros and
 * Cons drawn from the player's composites, personality, age, durability and
 * contract. Descriptive only; deterministic; no Rng.
 *
 * Pros/cons read the raw player so they reflect the true player. The career layer
 * decides whether to surface this (own player / sufficient scouting knowledge).
 */

import type { Player } from '@domain'
import { ratedOverall } from '@engine/ratings/composites'
import { classifyArchetype, ARCHETYPE_META } from '@engine/league/archetypes'

export interface ScoutVerdict {
  /** Headline recommendation, e.g. "Would be an excellent signing." */
  recommendation: string
  /** 0–5 (half steps) current ability. */
  currentStars: number
  /** 0–5 (half steps) potential. */
  potentialStars: number
  bestRole: string
  pros: string[]
  cons: string[]
}

const C_PROS: { key: string; min: number; text: string }[] = [
  { key: 'scoring',      min: 72, text: 'Elite finishing ability' },
  { key: 'playmaking',   min: 72, text: 'Creative, high-end playmaker' },
  { key: 'vision',       min: 72, text: 'Sees the ice exceptionally well' },
  { key: 'skating',      min: 72, text: 'Outstanding skater' },
  { key: 'puckControl',  min: 72, text: 'Excellent hands and puck control' },
  { key: 'hitting',      min: 70, text: 'Plays a heavy, physical game' },
  { key: 'defensiveZone', min: 70, text: 'Reliable in his own end' },
  { key: 'takeaway',     min: 70, text: 'Disrupts plays and steals pucks' },
  { key: 'blocking',     min: 70, text: 'Willing shot-blocker' },
  { key: 'faceoffWin',   min: 68, text: 'Strong on faceoffs' },
]

const C_CONS: { key: string; max: number; text: string }[] = [
  { key: 'skating',       max: 45, text: 'Limited foot speed' },
  { key: 'defensiveZone', max: 42, text: 'A liability defensively' },
  { key: 'hitting',       max: 38, text: 'Lacks physical presence' },
  { key: 'puckControl',   max: 42, text: 'Suspect hands under pressure' },
  { key: 'scoring',       max: 40, text: 'Limited offensive upside' },
]

function comp(p: Player, key: string): number {
  return (p.composites as unknown as Record<string, number>)[key] ?? 50
}

/**
 * Build the verdict. `currentStars` / `potentialStars` come from the caller.
 * `signed` — when true the player is already on a club, so the headline reads as
 * an assessment of his value to the roster rather than a transfer recommendation.
 */
export function buildScoutVerdict(
  p: Player,
  currentStars: number,
  potentialStars: number,
  signed = false,
): ScoutVerdict {
  const ovr = ratedOverall(p)
  const arch = classifyArchetype(p)
  const meta = ARCHETYPE_META[arch.archetype]

  // Recommendation: assessment phrasing for rostered players, signing phrasing
  // for free agents / acquisition targets.
  let recommendation: string
  if (signed) {
    const young = p.age <= 23 && potentialStars > currentStars
    if (currentStars >= 4.5) recommendation = 'A franchise cornerstone.'
    else if (currentStars >= 4) recommendation = 'A genuine top-line talent.'
    else if (currentStars >= 3) recommendation = young ? 'A rising contributor with more to come.' : 'A solid, dependable contributor.'
    else if (currentStars >= 2) recommendation = young ? 'A developing prospect worth patience.' : 'A useful depth player.'
    else recommendation = young ? 'A raw project for the system.' : 'A fringe roster player.'
  } else {
    const ceiling = Math.max(currentStars, potentialStars)
    if (ceiling >= 4.5) recommendation = 'Would be a marquee signing.'
    else if (ceiling >= 4) recommendation = 'Would be an excellent signing.'
    else if (ceiling >= 3) recommendation = 'Would be a solid addition.'
    else if (ceiling >= 2) recommendation = 'A useful depth option.'
    else recommendation = 'Not worth pursuing at this level.'
  }

  const pros: string[] = []
  const cons: string[] = []

  // Composite-driven (skip goalies' skater phrasing where irrelevant).
  if (p.position !== 'G') {
    for (const r of C_PROS) {
      if (comp(p, r.key) >= r.min) pros.push(r.text)
    }
    for (const r of C_CONS) {
      if (comp(p, r.key) <= r.max) cons.push(r.text)
    }
  } else if (ovr >= 70) {
    pros.push('A dependable presence in net')
  }

  // Personality / intangibles.
  if (p.personality.professionalism >= 15) pros.push('A consummate professional')
  if (p.personality.determination >= 15) pros.push('Relentless work ethic')
  if ((p.leadership ?? 0) >= 80) pros.push('A genuine leader')
  if ((p.pressure ?? 10) >= 15) pros.push('Performs in the big moments')
  if ((p.versatility ?? 0) >= 70) pros.push('Natural in multiple positions')
  if (p.age <= 22 && potentialStars >= 4) pros.push('High ceiling with room to grow')

  if (p.personality.temperament <= 6) cons.push('Volatile temperament — discipline risk')
  if (p.personality.loyalty <= 5) cons.push('Mercenary streak; loyalty is a question')
  if ((p.injuryProneness ?? 30) >= 60) cons.push('Notable injury history')
  if (p.age >= 33) cons.push('On the wrong side of 30')
  if (p.contract.yearsRemaining <= 1 && p.personality.ambition >= 14) {
    cons.push('Will command a big new deal')
  }

  return {
    recommendation,
    currentStars,
    potentialStars,
    bestRole: meta.label,
    pros: pros.slice(0, 6),
    cons: cons.slice(0, 5),
  }
}
