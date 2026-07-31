/**
 * LEVER RECEIPTS (#154) — "a real lever with no receipt is indistinguishable
 * from a broken one."
 *
 * The lever audit (docs/LEVER-AUDIT.md) measured what each GM decision is
 * actually worth. This module turns those measurements into a live read on the
 * CURRENT club: not "line assembly matters" in the abstract, but "your fourth
 * line is carrying your second-best winger and it is costing you about six
 * points."
 *
 * Every coefficient here is an endpoint measured by the harness — 40,000 mirror
 * games per lever, both benches identical except for the one setting. What this
 * module adds on top is a LINEAR INTERPOLATION between the measured best and
 * worst arrangements of the club's own players. That is an estimate, and it is
 * labelled as one everywhere it surfaces; what it is not is a guess.
 *
 * Pure and deterministic — no RNG, no mutation, safe to call per view build.
 */
import type { Player, PlayerId, Team } from '@domain'
import { deploymentValue, type DeploymentValue } from './deploymentValue'

/* ───────────────── measured spans (docs/LEVER-AUDIT.md, 40k games each) ───────────────── */

/** Best-vs-worst PP1 personnel, in standings points across 82 games. */
export const PP_UNIT_SPAN_POINTS = 6.5
/** Best-vs-worst PK1 personnel. */
export const PK_UNIT_SPAN_POINTS = 4.9
/** Starting the better goalie rather than the worse one. */
export const GOALIE_ORDER_SPAN_POINTS = 4.3
/**
 * Freshness: fatigue 18 (worn down) → 2 (fresh legs) measured +37.9 points, so
 * roughly 2.4 points per point of average roster fatigue. The single largest
 * effect in the audit, and the reason rest is a real decision.
 */
export const POINTS_PER_FATIGUE_POINT = 37.9 / 16
/** Morale 35 → 80 measured +11.3 points. */
export const POINTS_PER_MORALE_POINT = 11.3 / 45

export interface UnitReceipt {
  /** Mean quality of the men currently in the unit, 0–100. */
  current: number
  /** The best unit available from the dressed skaters. */
  best: number
  /** The weakest legal unit, for scale. */
  worst: number
  /** Estimated standings points per season the current unit gives away. */
  pointsLost: number
  /** True when the GM already has the best available men in the unit. */
  optimal: boolean
}

export interface ConditionReceipt {
  /** Mean fatigue across the dressed skaters (0 = fresh). */
  fatigue: number
  /** Mean morale across the dressed skaters. */
  morale: number
  /** Points per season the current fatigue load is costing versus fresh legs. */
  fatiguePointsLost: number
  /** Points per season versus a happy room (morale 80). */
  moralePointsLost: number
}

export interface LeverReceipts {
  deployment: DeploymentValue
  powerPlay: UnitReceipt
  penaltyKill: UnitReceipt
  goalie: UnitReceipt
  condition: ConditionReceipt
  /** Total estimated standings points currently left on the table. */
  totalPointsLost: number
}

const ppQuality = (p: Player): number => (p.composites.scoring + p.composites.playmaking) / 2
const pkQuality = (p: Player): number => (p.composites.defensiveZone + p.composites.takeaway) / 2

function mean(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** Interpolate a measured best-vs-worst span onto where this club actually sits. */
function interpolate(current: number, best: number, worst: number, spanPoints: number): number {
  const span = best - worst
  if (span <= 0) return 0
  const shortfall = Math.max(0, Math.min(1, (best - current) / span))
  return Math.round(shortfall * spanPoints * 10) / 10
}

/**
 * Grade a special-teams unit against the best and worst units the GM could
 * build from the same dressed skaters, respecting the unit's own F/D shape so
 * the comparison stays legal.
 */
function gradeUnit(
  unit: PlayerId[],
  dressed: Player[],
  quality: (p: Player) => number,
  spanPoints: number,
): UnitReceipt {
  const men = unit.map((id) => dressed.find((p) => (p.id as string) === (id as string))).filter((p): p is Player => !!p)
  if (men.length === 0) return { current: 0, best: 0, worst: 0, pointsLost: 0, optimal: true }
  const nF = men.filter((p) => p.position !== 'D').length
  const nD = men.length - nF
  const fwds = dressed.filter((p) => p.position !== 'D' && p.position !== 'G').sort((a, b) => quality(b) - quality(a))
  const defs = dressed.filter((p) => p.position === 'D').sort((a, b) => quality(b) - quality(a))
  const pick = (from: Player[], n: number, end: 'top' | 'bottom'): Player[] =>
    end === 'top' ? from.slice(0, n) : from.slice(Math.max(0, from.length - n))

  const current = mean(men.map(quality))
  const best = mean([...pick(fwds, nF, 'top'), ...pick(defs, nD, 'top')].map(quality))
  const worst = mean([...pick(fwds, nF, 'bottom'), ...pick(defs, nD, 'bottom')].map(quality))
  const pointsLost = interpolate(current, best, worst, spanPoints)
  return {
    current: Math.round(current * 10) / 10,
    best: Math.round(best * 10) / 10,
    worst: Math.round(worst * 10) / 10,
    pointsLost,
    // Within a rounding point of the best available is "optimal" — the GM should
    // not be nagged about a 0.3-rating difference he cannot act on.
    optimal: best - current < 0.5,
  }
}

/** Everything the GM's current board is worth, in standings points. */
export function leverReceipts(team: Team, resolve: (id: PlayerId) => Player | undefined): LeverReceipts {
  const get = (id: PlayerId): Player | undefined => {
    try {
      return resolve(id)
    } catch {
      return undefined
    }
  }
  const dressedIds = new Set<string>()
  for (const line of team.lines.forwards) for (const id of line) if (id) dressedIds.add(id as string)
  for (const pair of team.lines.defensePairs) for (const id of pair) if (id) dressedIds.add(id as string)
  const dressed = [...dressedIds].map((id) => get(id as PlayerId)).filter((p): p is Player => !!p)

  const deployment = deploymentValue(team, (id) => get(id) as Player)

  const powerPlay = gradeUnit(team.lines.powerPlayUnits[0] ?? [], dressed, ppQuality, PP_UNIT_SPAN_POINTS)
  const penaltyKill = gradeUnit(team.lines.penaltyKillUnits[0] ?? [], dressed, pkQuality, PK_UNIT_SPAN_POINTS)

  // Goalies: only two dress, so the "unit" is simply which of them is listed
  // first. Graded on the same scale so the panel reads consistently.
  const goalies = team.lines.goalies.map((id) => get(id)).filter((p): p is Player => !!p)
  const gQ = (p: Player): number => p.composites.goaltending
  const starter = goalies[0]
  const goalie: UnitReceipt =
    goalies.length < 2 || !starter
      ? { current: starter ? Math.round(gQ(starter) * 10) / 10 : 0, best: 0, worst: 0, pointsLost: 0, optimal: true }
      : {
          current: Math.round(gQ(starter) * 10) / 10,
          best: Math.round(Math.max(...goalies.map(gQ)) * 10) / 10,
          worst: Math.round(Math.min(...goalies.map(gQ)) * 10) / 10,
          pointsLost: interpolate(gQ(starter), Math.max(...goalies.map(gQ)), Math.min(...goalies.map(gQ)), GOALIE_ORDER_SPAN_POINTS),
          optimal: gQ(starter) >= Math.max(...goalies.map(gQ)) - 0.5,
        }

  const fatigue = mean(dressed.map((p) => p.fatigue))
  const morale = mean(dressed.map((p) => p.morale))
  const condition: ConditionReceipt = {
    fatigue: Math.round(fatigue * 10) / 10,
    morale: Math.round(morale),
    // Below the model's neutral reference (fatigue 4) there is nothing to gain.
    fatiguePointsLost: Math.round(Math.max(0, fatigue - 4) * POINTS_PER_FATIGUE_POINT * 10) / 10,
    moralePointsLost: Math.round(Math.max(0, 80 - morale) * POINTS_PER_MORALE_POINT * 10) / 10,
  }

  const totalPointsLost =
    Math.round(
      (deployment.pointsLost +
        powerPlay.pointsLost +
        penaltyKill.pointsLost +
        goalie.pointsLost +
        condition.fatiguePointsLost +
        condition.moralePointsLost) *
        10,
    ) / 10

  return { deployment, powerPlay, penaltyKill, goalie, condition, totalPointsLost }
}
