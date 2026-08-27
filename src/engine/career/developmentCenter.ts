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
import { buildProgressRows } from './progressView'
import { projectionTier, TIER_LABELS, type ProjectionTier } from './scoutReport'

export interface DevelopmentRow {
  playerId: string
  name: string
  position: string
  age: number
  /** Where the player currently plays: 'NHL' (user club), 'AHL' (affiliate), or
   *  'Junior' (rights held but playing outside the pro ranks). */
  location: 'NHL' | 'AHL' | 'Junior'
  /** Club he currently skates for, when it's not the NHL/AHL pair (junior etc.). */
  clubAbbrev?: string
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

/** One recommended roster move from the "ask the coach to set the roster" advice. */
export interface RosterAdviceMove {
  playerId: string
  name: string
  position: string
  /** Current/AHL ability for context. */
  currentStars: number
  /** 'callup' = bring up from the AHL; 'senddown' = send to the AHL. */
  kind: 'callup' | 'senddown'
  reason: string
  faceId?: number
}

export interface DevelopmentCenterView {
  teamName: string
  /** Count of tracked prospects. */
  count: number
  /** How many are top-tier (Star/Prospect/Key). */
  highCeiling: number
  rows: DevelopmentRow[]
  /** U23 organisation players' season progress (ability/ceiling change). */
  progress: import('./progressView').ProgressRowView[]
  /** Coach's recommended NHL roster moves (call-ups / send-downs) by ability.
   *  Empty arrays when the roster is already optimal. */
  rosterAdvice: { callUps: RosterAdviceMove[]; sendDowns: RosterAdviceMove[] }
  /** Players whose rights the club holds but who currently play OUTSIDE the
   *  NHL/AHL (junior, college, Europe). Surfaces prospects you control but who
   *  aren't on a farm roster yet. */
  systemElsewhere: DevelopmentRow[]
}

function devNote(p: Player, location: 'NHL' | 'AHL' | 'Junior', upside: number, tier: ProjectionTier): string {
  if (p.injuryStatus) return 'Sidelined — development on hold until healthy.'
  if (location === 'Junior') {
    if (upside >= 2.5) return 'High-end prospect developing in junior — rights held.'
    if (upside >= 1.5) return 'A prospect in your system, rounding out his game in junior.'
    return 'In your system; a longer-term development project.'
  }
  if (location === 'AHL') {
    // Note frames UPSIDE (headroom), not current production — a low-current prospect
    // with a high ceiling isn't "dominating", he's a developmental bet. (Claiming he
    // dominates contradicts a ½-star current rating right next to it.)
    if (upside >= 2.5) return 'High-end upside — a priority prospect to develop.'
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
  /** Coach's recommended NHL roster moves (computed by the career layer from the
   *  combined NHL+AHL ability sort). Defaults to empty. */
  rosterAdvice?: { callUps: RosterAdviceMove[]; sendDowns: RosterAdviceMove[] }
  /** Players whose rights the club holds but who play outside the NHL/AHL, with
   *  the club they currently skate for. */
  systemElsewhere?: Array<{ player: Player; clubAbbrev: string }>
}

export function buildDevelopmentCenter(args: BuildDevelopmentArgs): DevelopmentCenterView {
  const maxAge = args.maxAge ?? 23
  const rows: DevelopmentRow[] = []

  const consider = (p: Player, location: 'NHL' | 'AHL' | 'Junior', clubAbbrev?: string): void => {
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
      ...(clubAbbrev !== undefined ? { clubAbbrev } : {}),
      ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
    })
  }

  for (const p of args.roster) consider(p, 'NHL')
  for (const p of args.affiliate) consider(p, 'AHL')

  // Rights-held prospects playing outside the NHL/AHL (junior, college, Europe).
  const systemElsewhere: DevelopmentRow[] = []
  for (const { player: p, clubAbbrev } of args.systemElsewhere ?? []) {
    const [cur, pot] = args.stars(p)
    const ovr = ratedOverall(p)
    const tier = projectionTier(ovr, pot, p.age)
    const upside = Math.max(0, pot - cur)
    systemElsewhere.push({
      playerId: p.id as unknown as string,
      name: p.name,
      position: p.position,
      age: p.age,
      location: 'Junior',
      clubAbbrev,
      currentStars: cur,
      potentialStars: pot,
      tier,
      tierLabel: TIER_LABELS[tier],
      projection: ceilingRoleShort(agedPotential(p), p.position),
      upside,
      note: devNote(p, 'Junior', upside, tier),
      ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
    })
  }
  systemElsewhere.sort((a, b) => b.potentialStars - a.potentialStars || b.upside - a.upside || a.age - b.age)

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

  // U23 progress roll-up (true ratings — these are the user's own org players).
  const u23 = [...args.roster, ...args.affiliate].filter((p) => p.age <= maxAge)
  const progress = buildProgressRows(u23)

  return {
    teamName: args.teamName,
    count: rows.length,
    highCeiling,
    rows,
    progress,
    rosterAdvice: args.rosterAdvice ?? { callUps: [], sendDowns: [] },
    systemElsewhere,
  }
}
