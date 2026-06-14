/**
 * Squad Planner: an FM-style Experience Matrix (squad bucketed by position and
 * career stage) plus a Squad Report (per-position depth verdict, age profile and
 * contract outlook). Read-only, descriptive, deterministic; no Rng.
 *
 * "Experience" maps age + games into a career stage: Prospect / Developing /
 * Peak / Veteran — the same lens FM's squad-planner matrix uses.
 */

import type { Player } from '@domain'
import { overall } from '@engine/ratings/composites'

export type CareerStage = 'Prospect' | 'Developing' | 'Peak' | 'Veteran'

/** Position buckets used across the planner. */
export type PosGroup = 'G' | 'LD' | 'RD' | 'C' | 'LW' | 'RW'

const STAGE_ORDER: CareerStage[] = ['Prospect', 'Developing', 'Peak', 'Veteran']

export interface PlannerPlayer {
  playerId: string
  name: string
  age: number
  stage: CareerStage
  group: PosGroup
  currentStars: number
  contractYearsRemaining: number
  /** True if the deal expires at season's end. */
  expiring: boolean
  faceId?: number
}

export interface PositionDepth {
  group: PosGroup
  label: string
  count: number
  /** 'Strong' | 'Adequate' | 'Thin' | 'Critical'. */
  verdict: 'Strong' | 'Adequate' | 'Thin' | 'Critical'
  note: string
}

export interface SquadPlannerView {
  teamName: string
  /** Career-stage column order for the matrix header. */
  stages: CareerStage[]
  /** Row per position group; each maps stage -> players. */
  matrix: Array<{ group: PosGroup; label: string; cells: Record<CareerStage, PlannerPlayer[]> }>
  /** Age-band headcount profile. */
  ageProfile: Array<{ band: string; count: number }>
  /** Per-position depth assessment. */
  depth: PositionDepth[]
  /** Plain-English summary lines (expiring deals, age skew, thin spots). */
  summary: string[]
}

const GROUP_LABEL: Record<PosGroup, string> = {
  G: 'Goaltenders',
  LD: 'Left Defense',
  RD: 'Right Defense',
  C: 'Centers',
  LW: 'Left Wing',
  RW: 'Right Wing',
}

/** Minimum healthy depth per group before it reads "thin". */
const TARGET_DEPTH: Record<PosGroup, number> = { G: 2, LD: 3, RD: 3, C: 4, LW: 3, RW: 3 }

function stageOf(p: Player): CareerStage {
  if (p.age <= 22) return 'Prospect'
  if (p.age <= 26) return 'Developing'
  if (p.age <= 31) return 'Peak'
  return 'Veteran'
}

/** Map a player to a position group, using handedness to split D and wings. */
function groupOf(p: Player): PosGroup {
  const pos = p.position
  if (pos === 'G') return 'G'
  if (pos === 'D') return p.handedness === 'R' ? 'RD' : 'LD'
  if (pos === 'C') return 'C'
  if (pos === 'LW') return 'LW'
  if (pos === 'RW') return 'RW'
  // Generic wing fallback by handedness.
  return p.handedness === 'R' ? 'RW' : 'LW'
}

function stars(p: Player): number {
  return Math.max(0, Math.min(5, Math.round((overall(p.composites, p.position) / 20) * 2) / 2))
}

export interface BuildSquadPlannerArgs {
  teamName: string
  roster: Player[]
}

export function buildSquadPlanner(args: BuildSquadPlannerArgs): SquadPlannerView {
  const players: PlannerPlayer[] = args.roster.map((p) => {
    const yrs = p.contract.yearsRemaining
    return {
      playerId: p.id as unknown as string,
      name: p.name,
      age: p.age,
      stage: stageOf(p),
      group: groupOf(p),
      currentStars: stars(p),
      contractYearsRemaining: yrs,
      expiring: yrs <= 1,
      ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
    }
  })

  const groups: PosGroup[] = ['G', 'LD', 'RD', 'C', 'LW', 'RW']

  const matrix = groups.map((group) => {
    const cells = {} as Record<CareerStage, PlannerPlayer[]>
    for (const s of STAGE_ORDER) cells[s] = []
    for (const pl of players) if (pl.group === group) cells[pl.stage].push(pl)
    for (const s of STAGE_ORDER) cells[s].sort((a, b) => b.currentStars - a.currentStars)
    return { group, label: GROUP_LABEL[group], cells }
  })

  // Age profile.
  const bands: Array<{ band: string; test: (a: number) => boolean }> = [
    { band: '21 & under', test: (a) => a <= 21 },
    { band: '22–26', test: (a) => a >= 22 && a <= 26 },
    { band: '27–30', test: (a) => a >= 27 && a <= 30 },
    { band: '31+', test: (a) => a >= 31 },
  ]
  const ageProfile = bands.map((b) => ({ band: b.band, count: players.filter((p) => b.test(p.age)).length }))

  // Depth verdicts.
  const depth: PositionDepth[] = groups.map((group) => {
    const count = players.filter((p) => p.group === group).length
    const target = TARGET_DEPTH[group]
    let verdict: PositionDepth['verdict']
    let note: string
    if (count >= target + 1) { verdict = 'Strong'; note = 'Good depth and competition for spots.' }
    else if (count >= target) { verdict = 'Adequate'; note = 'Covered, but little margin for injury.' }
    else if (count >= target - 1) { verdict = 'Thin'; note = 'Short of ideal depth — an injury would bite.' }
    else { verdict = 'Critical'; note = 'Badly under-stocked; address in the market.' }
    return { group, label: GROUP_LABEL[group], count, verdict, note }
  })

  // Summary lines.
  const summary: string[] = []
  const expiring = players.filter((p) => p.expiring).length
  if (expiring > 0) summary.push(`${expiring} player${expiring === 1 ? '' : 's'} on expiring deals.`)
  const vets = players.filter((p) => p.stage === 'Veteran').length
  const prospects = players.filter((p) => p.stage === 'Prospect').length
  if (vets > prospects + 3) summary.push('Ageing roster — short on young talent in the pipeline.')
  else if (prospects > vets + 3) summary.push('Young roster — light on veteran experience.')
  else summary.push('Balanced age profile across the roster.')
  const thin = depth.filter((d) => d.verdict === 'Thin' || d.verdict === 'Critical').map((d) => d.label)
  if (thin.length > 0) summary.push(`Depth concerns: ${thin.join(', ')}.`)
  else summary.push('No glaring depth holes across the position groups.')

  return { teamName: args.teamName, stages: STAGE_ORDER, matrix, ageProfile, depth, summary }
}
