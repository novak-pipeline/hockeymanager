/**
 * Squad Planner: an FM-style Experience Matrix (squad bucketed by position and
 * career stage) plus a Squad Report (per-position depth verdict, age profile and
 * contract outlook). Read-only, descriptive, deterministic; no Rng.
 *
 * "Experience" maps age + games into a career stage: Prospect / Developing /
 * Peak / Veteran — the same lens FM's squad-planner matrix uses.
 */

import type { Player } from '@domain'
import { ratedOverall, overallToStars } from '@engine/ratings/composites'
import { buildProgressRows } from './progressView'

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
  /** League rank for this position group (1 = strongest), when league context is supplied. */
  rank?: number
  /** Number of teams ranked against (league size). */
  outOf?: number
  /** Inputs behind the verdict, so it shows its work (playtest #16). */
  /** NHL-calibre bodies in the group (everyday-NHL-player bar or better). */
  nhlCalibre?: number
  /** League median NHL-calibre count at this group, when league context is supplied. */
  leagueMedian?: number
  /** The group's best player (the anchor the depth sits behind). */
  topName?: string
  /** Plain-English derivation, e.g. "2 NHL-calibre centers led by Dahl — league median is 4." */
  detail?: string
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
  /** Whole-roster season progress (ability/ceiling change per player). */
  progress: import('./progressView').ProgressRowView[]
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
export function posGroupOf(p: Player): PosGroup {
  return groupOf(p)
}

function groupOf(p: Player): PosGroup {
  const pos = p.position
  if (pos === 'G') return 'G'
  if (pos === 'D') return p.handedness === 'R' ? 'RD' : 'LD'
  if (pos === 'C') return 'C'
  // Position is C|W|D|G — there is no LW/RW to match, so every winger is split
  // by handedness here. (Dead `pos === 'LW'`/`'RW'` branches removed.)
  return p.handedness === 'R' ? 'RW' : 'LW'
}

function stars(p: Player): number {
  return overallToStars(ratedOverall(p))
}

/** 1 -> "1st", 2 -> "2nd", 23 -> "23rd". */
function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

export interface BuildSquadPlannerArgs {
  teamName: string
  roster: Player[]
  /**
   * Every league team's roster (including this one), used to judge each position
   * group's strength RELATIVE to the rest of the league rather than by absolute
   * headcount. When omitted, depth falls back to fixed headcount targets.
   */
  leagueRosters?: Player[][]
}

/**
 * Position-group strength for one roster: the sum of the top `TARGET_DEPTH`
 * players' ratings in that group (missing bodies count as zero), so the metric
 * rewards both quality and depth the way a GM weighs a position.
 */
function groupStrength(roster: Player[], group: PosGroup): number {
  const target = TARGET_DEPTH[group]
  const rated = roster
    .filter((p) => groupOf(p) === group)
    .map((p) => ratedOverall(p))
    .sort((a, b) => b - a)
  let s = 0
  for (let i = 0; i < target; i++) s += rated[i] ?? 0
  return s
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

  // Depth verdicts — relative to the rest of the league when league context is
  // supplied (a position is "Strong" because you're better stocked than rival
  // clubs, not because you cleared an arbitrary headcount), else by headcount.
  const league = args.leagueRosters && args.leagueRosters.length > 1 ? args.leagueRosters : null

  // "NHL-calibre" = a dependable everyday player (the Core band, ovr ≥ 60) —
  // the same bar the profile's projection tiers use. Counting bodies above it is
  // how the verdict SHOWS ITS WORK: "2 NHL-calibre centers behind Dahl; the
  // league median is 4" is a reason, "Thin" alone is not. (Playtest #16.)
  const NHL_CALIBRE = 60
  const calibreCount = (roster: Player[], group: PosGroup): number =>
    roster.filter((p) => groupOf(p) === group && ratedOverall(p) >= NHL_CALIBRE).length
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
  }

  const depth: PositionDepth[] = groups.map((group) => {
    const count = players.filter((p) => p.group === group).length
    const nhlCalibre = calibreCount(args.roster, group)
    const top = args.roster
      .filter((p) => groupOf(p) === group)
      .sort((a, b) => ratedOverall(b) - ratedOverall(a))[0]
    const topName = top?.name
    const groupWord = GROUP_LABEL[group].toLowerCase()

    if (league) {
      const mine = groupStrength(args.roster, group)
      const all = league.map((r) => groupStrength(r, group))
      // Rank: 1 = strongest. Ties share the better (lower) rank.
      const rank = 1 + all.filter((s) => s > mine).length
      const outOf = all.length
      // Fraction of the league you outrank (1 = top, 0 = bottom).
      const pct = outOf > 1 ? (outOf - rank) / (outOf - 1) : 1
      const leagueMedian = median(league.map((r) => calibreCount(r, group)))
      let verdict: PositionDepth['verdict']
      let note: string
      if (pct >= 0.66) { verdict = 'Strong'; note = `Among the league's best here (${ordinal(rank)} of ${outOf}).` }
      else if (pct >= 0.4) { verdict = 'Adequate'; note = `Around league average (${ordinal(rank)} of ${outOf}).` }
      else if (pct >= 0.15) { verdict = 'Thin'; note = `Below the league standard (${ordinal(rank)} of ${outOf}).` }
      else { verdict = 'Critical'; note = `One of the weakest in the league (${ordinal(rank)} of ${outOf}).` }
      const detail =
        nhlCalibre === 0
          ? `No NHL-calibre ${groupWord} on the roster — the league median is ${leagueMedian}.`
          : nhlCalibre === 1 && topName !== undefined
            ? `Only ${topName} rates as NHL-calibre here — the league median is ${leagueMedian}.`
            : topName !== undefined
              ? `${nhlCalibre} NHL-calibre ${groupWord} led by ${topName} — the league median is ${leagueMedian}.`
              : `${nhlCalibre} NHL-calibre ${groupWord} — the league median is ${leagueMedian}.`
      return {
        group, label: GROUP_LABEL[group], count, verdict, note, rank, outOf,
        nhlCalibre, leagueMedian, detail, ...(topName !== undefined ? { topName } : {}),
      }
    }

    const target = TARGET_DEPTH[group]
    let verdict: PositionDepth['verdict']
    let note: string
    if (count >= target + 1) { verdict = 'Strong'; note = 'Good depth and competition for spots.' }
    else if (count >= target) { verdict = 'Adequate'; note = 'Covered, but little margin for injury.' }
    else if (count >= target - 1) { verdict = 'Thin'; note = 'Short of ideal depth — an injury would bite.' }
    else { verdict = 'Critical'; note = 'Badly under-stocked; address in the market.' }
    const detail =
      nhlCalibre === 0
        ? `No NHL-calibre ${groupWord} on the roster (${count} of a target ${target} bodies).`
        : `${nhlCalibre} NHL-calibre ${groupWord}${topName !== undefined ? ` led by ${topName}` : ''} (${count} of a target ${target} bodies).`
    return {
      group, label: GROUP_LABEL[group], count, verdict, note,
      nhlCalibre, detail, ...(topName !== undefined ? { topName } : {}),
    }
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

  const progress = buildProgressRows(args.roster)

  return { teamName: args.teamName, stages: STAGE_ORDER, matrix, ageProfile, depth, summary, progress }
}
