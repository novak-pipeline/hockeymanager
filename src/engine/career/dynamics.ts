/**
 * Team Dynamics view builder (FM-style "Dynamics" screen, hockey-flavoured).
 *
 * Derives a squad-dynamics picture from systems we already have:
 *   - lockerRoom (captain/alternates, influence 0–100, relationships, roomMorale)
 *   - personality archetype (the headline character word)
 *   - player morale (overall happiness)
 *   - nationality clustering (social groups)
 *
 * Pure + deterministic. No Rng, no Date. The career layer passes the live roster +
 * locker-room state + head coach.
 */

import type { Player } from '@domain'
import type { LockerRoomState } from '@engine/league/lockerRoom'
import { personalityArchetype } from '@engine/career/personalityType'

export type DynamicsTier = 'leader' | 'highlyInfluential' | 'influential' | 'other'
export type SocialGroupKind = 'core' | 'secondary' | 'other'

export interface DynamicsPlayerView {
  playerId: string
  name: string
  faceId?: string
  position: string
  /** Headline personality archetype, e.g. "Born Leader". */
  personality: string
  tier: DynamicsTier
  influence: number
  morale: number
  /** Plain-English overall happiness. */
  happiness: string
  socialGroup: SocialGroupKind
}

export interface DynamicsBar {
  /** 0–100. */
  value: number
  label: string
}

export interface TeamDynamicsView {
  teamId: string
  teamName: string
  headCoachName: string
  headCoachFaceId?: string
  cohesion: DynamicsBar
  atmosphere: DynamicsBar
  leadership: DynamicsBar
  /** Top influencers (≤4), most influential first. */
  topInfluencers: Array<{ playerId: string; name: string; faceId?: string; tierLabel: string }>
  hierarchy: {
    leaders: DynamicsPlayerView[]
    highlyInfluential: DynamicsPlayerView[]
    influential: DynamicsPlayerView[]
    others: DynamicsPlayerView[]
  }
  socialGroups: {
    /** e.g. "Mostly Canadian players" for the secondary group. */
    secondaryLabel: string | null
    core: DynamicsPlayerView[]
    secondary: DynamicsPlayerView[]
    other: DynamicsPlayerView[]
  }
  /** Full roster for the happiness grid, leaders first. */
  happinessRows: DynamicsPlayerView[]
}

const TIER_LABEL: Record<DynamicsTier, string> = {
  leader: 'Team Leader',
  highlyInfluential: 'Highly Influential',
  influential: 'Influential',
  other: 'Squad Player',
}

function bandLabel(v: number): string {
  if (v >= 80) return 'Very good'
  if (v >= 62) return 'Good'
  if (v >= 45) return 'Average'
  if (v >= 28) return 'Poor'
  return 'Very poor'
}

function happinessLabel(morale: number): string {
  if (morale >= 82) return 'Delighted'
  if (morale >= 66) return 'Happy'
  if (morale >= 50) return 'Content'
  if (morale >= 34) return 'Unsettled'
  return 'Unhappy'
}

function influenceOf(lr: LockerRoomState | null, id: string): number {
  if (!lr) return 40
  for (const [pid, v] of lr.influence) if (pid === id) return v
  return 40
}

export function buildTeamDynamics(args: {
  teamId: string
  teamName: string
  roster: Player[]
  lockerRoom: LockerRoomState | null
  headCoachName: string
  headCoachFaceId?: string
}): TeamDynamicsView {
  const { teamId, teamName, roster, lockerRoom: lr, headCoachName } = args

  const captainId = lr?.captainId ?? null
  const alternates = new Set(lr?.alternateIds ?? [])

  // ── nationality clustering for social groups ──
  const natCount = new Map<string, number>()
  for (const p of roster) {
    const nat = p.nationality ?? 'Unknown'
    natCount.set(nat, (natCount.get(nat) ?? 0) + 1)
  }
  // Secondary group = the 2nd-most-common nationality bloc with ≥3 players.
  const natsBySize = [...natCount.entries()]
    .filter(([nat]) => nat !== 'Unknown')
    .sort((a, b) => b[1] - a[1])
  const secondaryNat = natsBySize[1] && natsBySize[1][1] >= 3 ? natsBySize[1][0] : null

  function socialGroupOf(p: Player, influence: number): SocialGroupKind {
    if (secondaryNat && p.nationality === secondaryNat) return 'secondary'
    if (influence <= 25) return 'other' // fringe / not yet gelling
    return 'core'
  }

  function tierOf(p: Player, influence: number): DynamicsTier {
    const id = p.id as unknown as string
    if (id === captainId || alternates.has(id)) return 'leader'
    if (influence >= 72) return 'highlyInfluential'
    if (influence >= 52) return 'influential'
    return 'other'
  }

  const views: DynamicsPlayerView[] = roster.map((p) => {
    const id = p.id as unknown as string
    const influence = Math.round(influenceOf(lr, id))
    const v: DynamicsPlayerView = {
      playerId: id,
      name: p.name,
      position: p.position,
      personality: personalityArchetype(p).label,
      tier: tierOf(p, influence),
      influence,
      morale: Math.round(p.morale),
      happiness: happinessLabel(p.morale),
      socialGroup: socialGroupOf(p, influence),
      ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
    }
    return v
  })

  const byInfluence = [...views].sort((a, b) => b.influence - a.influence)
  const tierRank: Record<DynamicsTier, number> = { leader: 0, highlyInfluential: 1, influential: 2, other: 3 }
  const sortedForGrid = [...views].sort(
    (a, b) => tierRank[a.tier] - tierRank[b.tier] || b.influence - a.influence
  )

  // ── summary bars ──
  // Atmosphere = room morale. Cohesion = mean pairwise familiarity (fallback to morale).
  const fam = lr?.familiarity ?? []
  const cohesionRaw = fam.length > 0
    ? fam.reduce((s, [, v]) => s + v, 0) / fam.length
    : (lr?.roomMorale ?? 55) * 0.8
  const atmosphere = lr?.roomMorale ?? 55
  // Leadership = strength of the top of the hierarchy + a captain present.
  const topInf = byInfluence.slice(0, 3)
  const leadershipRaw =
    (topInf.reduce((s, p) => s + p.influence, 0) / Math.max(1, topInf.length)) * (captainId ? 1 : 0.8)

  const tierViews = (t: DynamicsTier): DynamicsPlayerView[] =>
    sortedForGrid.filter((v) => v.tier === t)
  const groupViews = (g: SocialGroupKind): DynamicsPlayerView[] =>
    sortedForGrid.filter((v) => v.socialGroup === g)

  return {
    teamId,
    teamName,
    headCoachName,
    ...(args.headCoachFaceId !== undefined ? { headCoachFaceId: args.headCoachFaceId } : {}),
    cohesion: { value: Math.round(cohesionRaw), label: bandLabel(cohesionRaw) },
    atmosphere: { value: Math.round(atmosphere), label: bandLabel(atmosphere) },
    leadership: { value: Math.round(leadershipRaw), label: bandLabel(leadershipRaw) },
    topInfluencers: byInfluence.slice(0, 4).map((v) => ({
      playerId: v.playerId,
      name: v.name,
      tierLabel: TIER_LABEL[v.tier],
      ...(v.faceId !== undefined ? { faceId: v.faceId } : {}),
    })),
    hierarchy: {
      leaders: tierViews('leader'),
      highlyInfluential: tierViews('highlyInfluential'),
      influential: tierViews('influential'),
      others: tierViews('other'),
    },
    socialGroups: {
      secondaryLabel: secondaryNat ? `Mostly ${secondaryNat} players` : null,
      core: groupViews('core'),
      secondary: groupViews('secondary'),
      other: groupViews('other'),
    },
    happinessRows: sortedForGrid,
  }
}
