/**
 * Development Center: the org's young / high-upside players gathered across the
 * NHL roster and the AHL affiliate, each with a fog-aware current/potential read,
 * a projection tier and a plain-English development note.
 *
 * Descriptive only; deterministic; no Rng. Mirrors how the AGM report folds the
 * affiliate pool in (see career.getReport). The career layer decides fog by
 * passing already-judged stars; here we work from the true player for the note.
 */

import type { Player } from '@domain'
import { agedPotential, ratedOverall } from '@engine/ratings/composites'
import { ceilingRoleShort } from '@engine/league/draftRankings'
import { projectionTier, TIER_LABELS, type ProjectionTier } from './scoutReport'

export interface DevelopmentRow {
  playerId: string
  name: string
  position: string
  age: number
  /** Where the player currently plays: 'NHL' (user club) or 'AHL' (affiliate). */
  location: 'NHL' | 'AHL'
  currentStars: number
  potentialStars: number
  tier: ProjectionTier
  tierLabel: string
  /** Projected ceiling role, e.g. "First-line F", "Top-pair D" — a real role,
   *  never a vague "Prospect". */
  projection: string
  /** Remaining upside, 0–5 (potentialStars − currentStars, floored at 0). */
  upside: number
  /** Short development note (next step / outlook). */
  note: string
  faceId?: number
}

export interface DevelopmentCenterView {
  teamName: string
  /** Count of tracked prospects. */
  count: number
  /** How many are top-tier (Star/Prospect/Key). */
  highCeiling: number
  rows: DevelopmentRow[]
}

function devNote(p: Player, location: 'NHL' | 'AHL', upside: number, tier: ProjectionTier): string {
  if (p.injuryStatus) return 'Sidelined — development on hold until healthy.'
  if (location === 'AHL') {
    if (upside >= 2.5) return 'Dominating the AHL — push for an NHL look soon.'
    if (upside >= 1.5) return 'Developing well in the AHL; needs more seasoning.'
    return 'Earning his minutes in the AHL; depth projection.'
  }
  // NHL
  if (p.age <= 21 && upside >= 2) return 'Ahead of schedule in the NHL — protect his ice time.'
  if (upside >= 2) return 'Big upside remaining; trending up with NHL minutes.'
  if (upside >= 1) return 'Still rounding into form; room to grow.'
  if (tier === 'Star' || tier === 'Key') return 'Nearing his ceiling — a cornerstone piece.'
  return 'Largely a finished product at this stage.'
}

export interface BuildDevelopmentArgs {
  teamName: string
  /** NHL roster players. */
  roster: Player[]
  /** AHL affiliate players (may be empty). */
  affiliate: Player[]
  /** Caller-supplied star reader (fog-aware). Returns [current, potential]. */
  stars: (p: Player) => [number, number]
  /** Max age to treat as a development-tracked prospect (inclusive; default 23). */
  maxAge?: number
}

export function buildDevelopmentCenter(args: BuildDevelopmentArgs): DevelopmentCenterView {
  const maxAge = args.maxAge ?? 23
  const rows: DevelopmentRow[] = []

  const consider = (p: Player, location: 'NHL' | 'AHL'): void => {
    // Prospect status is age-gated: 23 and under. Past that you're an
    // established pro, not a development project — regardless of upside.
    if (p.age > maxAge) return
    const [cur, pot] = args.stars(p)
    const upside = Math.max(0, pot - cur)
    const ovr = ratedOverall(p)
    const tier = projectionTier(ovr, pot, p.age)
    rows.push({
      playerId: p.id as unknown as string,
      name: p.name,
      position: p.position,
      age: p.age,
      location,
      currentStars: cur,
      potentialStars: pot,
      tier,
      tierLabel: TIER_LABELS[tier],
      projection: ceilingRoleShort(agedPotential(p), p.position),
      upside,
      note: devNote(p, location, upside, tier),
      ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
    })
  }

  for (const p of args.roster) consider(p, 'NHL')
  for (const p of args.affiliate) consider(p, 'AHL')

  // Highest ceiling first, then most remaining upside, then youngest.
  rows.sort(
    (a, b) =>
      b.potentialStars - a.potentialStars ||
      b.upside - a.upside ||
      a.age - b.age,
  )

  const highCeiling = rows.filter(
    (r) => r.tier === 'Star' || r.tier === 'Prospect' || r.tier === 'Key',
  ).length

  return { teamName: args.teamName, count: rows.length, highCeiling, rows }
}
