/**
 * Deployment roles (#73) — an EHM/FM-style read on how a skater should be USED,
 * distinct from his innate archetype (playing style) and his squad status (depth
 * importance). For each deployment bucket appropriate to his position we grade a
 * 0–5 star suitability from his composites, name his best fit, and write a
 * one-line usage note for the coach.
 *
 * Purely descriptive and deterministic — no Rng, no state, no sim coupling. The
 * numbers here mirror how the lineup engine already scores special-teams units
 * (PP = scoring + playmaking, PK = defensive zone), so the read the GM sees
 * lines up with how his players actually get deployed.
 */

import type { Player } from '@domain'
import { classifyArchetype, ARCHETYPE_META } from './archetypes'

export interface RoleSuitability {
  key: string
  label: string
  /** 0–5 in half-steps. */
  stars: number
}

export interface DeploymentProfile {
  /** The skater's best-fit deployment bucket label (e.g. "Power play"). */
  bestFit: string
  /** One-line usage guidance for the coach. */
  usageNote: string
  /** Star suitability for each deployment bucket for his position. */
  suitability: RoleSuitability[]
}

/** Map a 0–100 composite blend to 0–5 half-step stars (≈90 → 5, 50 → 2.5). */
function toStars(metric: number): number {
  const v = Math.round((metric / 20) * 2) / 2
  return v < 0 ? 0 : v > 5 ? 5 : v
}

type C = Player['composites']
/** A bucket with both its raw 0–100 metric (for tie-breaking) and star grade. */
interface RawBucket extends RoleSuitability {
  raw: number
}

const blend = (c: C, weights: Partial<Record<keyof C, number>>): number => {
  let sum = 0
  let wsum = 0
  for (const [k, w] of Object.entries(weights) as Array<[keyof C, number]>) {
    sum += (c[k] ?? 0) * w
    wsum += w
  }
  return wsum > 0 ? sum / wsum : 0
}

const bucket = (key: string, label: string, raw: number): RawBucket => ({ key, label, raw, stars: toStars(raw) })

/** Forward deployment buckets. */
function forwardSuitability(c: C): RawBucket[] {
  return [
    bucket('scoring', 'Scoring line', blend(c, { scoring: 0.55, playmaking: 0.35, skating: 0.1 })),
    bucket('checking', 'Checking line', blend(c, { defensiveZone: 0.45, takeaway: 0.25, hitting: 0.2, skating: 0.1 })),
    bucket('pp', 'Power play', blend(c, { scoring: 0.45, playmaking: 0.45, puckControl: 0.1 })),
    bucket('pk', 'Penalty kill', blend(c, { defensiveZone: 0.5, takeaway: 0.3, skating: 0.2 })),
  ]
}

/** Defenseman deployment buckets. */
function defenseSuitability(c: C): RawBucket[] {
  return [
    bucket('offense', 'Offensive role', blend(c, { scoring: 0.4, playmaking: 0.4, skating: 0.2 })),
    bucket('shutdown', 'Shutdown role', blend(c, { defensiveZone: 0.4, blocking: 0.25, takeaway: 0.2, hitting: 0.15 })),
    bucket('pp', 'Power play', blend(c, { playmaking: 0.5, scoring: 0.3, puckControl: 0.2 })),
    bucket('pk', 'Penalty kill', blend(c, { defensiveZone: 0.45, blocking: 0.3, takeaway: 0.25 })),
  ]
}

/** Compose a one-line usage note from the suitability spread + archetype. */
function usageNote(position: string, suit: RawBucket[], archetypeLabel: string): string {
  const by = (k: string): number => suit.find((s) => s.key === k)?.stars ?? 0
  const isF = position !== 'D'
  const offense = isF ? by('scoring') : by('offense')
  const defense = isF ? by('checking') : by('shutdown')
  const pp = by('pp')
  const pk = by('pk')

  // Two-way, trusted everywhere.
  if (offense >= 3.5 && defense >= 3.5) {
    return `A complete ${isF ? 'forward' : 'defenseman'} — trust him in every situation, at both ends and on both special teams.`
  }
  // Offensive weapon, defensive liability.
  if (offense >= 3.5 && defense < 2.5) {
    return pp >= 3.5
      ? 'A pure offensive weapon — load him onto the power play and shelter his zone starts.'
      : 'An offensive specialist — deploy him in the attacking zone and keep him off the penalty kill.'
  }
  // Defensive specialist.
  if (defense >= 3 && offense < 2.5) {
    return pk >= 3
      ? `A defensive specialist — lean on him to kill penalties and match up against top ${isF ? 'lines' : 'forwards'}.`
      : 'A checking role — give him the tough defensive minutes, not the offence.'
  }
  // Balanced middle — tie-break on the raw metric so, e.g., a grinder reads as a
  // checking role even when several buckets round to the same star count.
  const best = [...suit].sort((a, b) => b.raw - a.raw)[0]
  if (best && best.stars >= 3) {
    return `Best used in a ${best.label.toLowerCase()} role; a ${archetypeLabel.toLowerCase()} who fills a middle-of-the-lineup job.`
  }
  return `A depth ${isF ? 'forward' : 'defenseman'} — spot minutes without a defined special-teams role.`
}

/**
 * Build a skater's deployment profile. Returns undefined for goalies (their usage
 * is a starter/tandem question handled elsewhere, not a role-suitability grid).
 */
export function deploymentProfile(player: Player): DeploymentProfile | undefined {
  if (player.position === 'G') return undefined
  const c = player.composites
  const raw = player.position === 'D' ? defenseSuitability(c) : forwardSuitability(c)
  // bestFit + usage note tie-break on the raw metric; the displayed suitability
  // drops the internal raw value.
  const best = [...raw].sort((a, b) => b.raw - a.raw)[0]
  const archetypeLabel = ARCHETYPE_META[classifyArchetype(player).archetype].label
  return {
    bestFit: best?.label ?? '—',
    usageNote: usageNote(player.position, raw, archetypeLabel),
    suitability: raw.map(({ key, label, stars }) => ({ key, label, stars })),
  }
}
