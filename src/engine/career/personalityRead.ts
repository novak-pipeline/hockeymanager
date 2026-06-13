/**
 * Fogged personality / personality-adjacent trait reads.
 *
 * The GM never sees raw personality values — only a scouted ESTIMATE.
 * Descriptors map value bands to words; at LOW/MEDIUM knowledge the
 * descriptor may be off by one band (stable skew seeded off playerId+trait).
 * At HIGH knowledge (≥80) it is always exact.
 *
 * flair is a PUBLIC gameplay attribute and is NOT fogged here.
 *
 * Personality traits (1–20 scale, matching EHM's Personality model):
 *   ambition, professionalism, loyalty, temperament, determination
 * Personality-adjacent hidden traits (1–20 scale):
 *   adaptability, pressure, sportsmanship
 */

import { knowledgeOf } from '@engine/league/scouting'
import type { ScoutingState } from '@domain/scouting'
import type { Player } from '@domain'

/* ────────────────────────── descriptor bands ────────────────────────── */

/** A band maps [min, max] to a label string. */
interface Band {
  min: number
  max: number
  label: string
}

const AMBITION_BANDS: Band[] = [
  { min: 1, max: 6, label: 'Unambitious' },
  { min: 7, max: 13, label: 'Balanced' },
  { min: 14, max: 17, label: 'Ambitious' },
  { min: 18, max: 20, label: 'Highly Ambitious' },
]

const PROFESSIONALISM_BANDS: Band[] = [
  { min: 1, max: 5, label: 'Unprofessional' },
  { min: 6, max: 11, label: 'Average' },
  { min: 12, max: 16, label: 'Professional' },
  { min: 17, max: 20, label: 'Model Pro' },
]

const LOYALTY_BANDS: Band[] = [
  { min: 1, max: 5, label: 'Mercenary' },
  { min: 6, max: 12, label: 'Flexible' },
  { min: 13, max: 17, label: 'Loyal' },
  { min: 18, max: 20, label: 'Club Servant' },
]

const TEMPERAMENT_BANDS: Band[] = [
  { min: 1, max: 5, label: 'Volatile' },
  { min: 6, max: 11, label: 'Emotional' },
  { min: 12, max: 16, label: 'Composed' },
  { min: 17, max: 20, label: 'Unflappable' },
]

const DETERMINATION_BANDS: Band[] = [
  { min: 1, max: 5, label: 'Low Drive' },
  { min: 6, max: 11, label: 'Moderate' },
  { min: 12, max: 16, label: 'Determined' },
  { min: 17, max: 20, label: 'Iron Will' },
]

const ADAPTABILITY_BANDS: Band[] = [
  { min: 1, max: 5, label: 'Rigid' },
  { min: 6, max: 12, label: 'Adaptable' },
  { min: 13, max: 17, label: 'Flexible' },
  { min: 18, max: 20, label: 'Chameleon' },
]

const PRESSURE_BANDS: Band[] = [
  { min: 1, max: 5, label: 'Wilts Under Pressure' },
  { min: 6, max: 11, label: 'Average' },
  { min: 12, max: 16, label: 'Clutch' },
  { min: 17, max: 20, label: 'Ice-Cold' },
]

const SPORTSMANSHIP_BANDS: Band[] = [
  { min: 1, max: 5, label: 'Chippy' },
  { min: 6, max: 12, label: 'Competitive' },
  { min: 13, max: 17, label: 'Respectful' },
  { min: 18, max: 20, label: 'Exemplary' },
]

/* ────────────────────────── trait table ────────────────────────── */

interface TraitDef {
  key: string
  label: string
  bands: Band[]
  /** True = this trait lives in player.personality; false = top-level player optional field (1-20 scale) */
  inPersonality: boolean
}

const PERSONALITY_TRAITS: TraitDef[] = [
  { key: 'ambition', label: 'Ambition', bands: AMBITION_BANDS, inPersonality: true },
  { key: 'professionalism', label: 'Professionalism', bands: PROFESSIONALISM_BANDS, inPersonality: true },
  { key: 'loyalty', label: 'Loyalty', bands: LOYALTY_BANDS, inPersonality: true },
  { key: 'temperament', label: 'Temperament', bands: TEMPERAMENT_BANDS, inPersonality: true },
  { key: 'determination', label: 'Determination', bands: DETERMINATION_BANDS, inPersonality: true },
]

const HIDDEN_TRAITS: TraitDef[] = [
  { key: 'adaptability', label: 'Adaptability', bands: ADAPTABILITY_BANDS, inPersonality: false },
  { key: 'pressure', label: 'Pressure', bands: PRESSURE_BANDS, inPersonality: false },
  { key: 'sportsmanship', label: 'Sportsmanship', bands: SPORTSMANSHIP_BANDS, inPersonality: false },
]

/* ────────────────────────── deterministic hash ────────────────────────── */

/**
 * Stable hash of a string — FNV-1a inspired, same approach as scouting.ts.
 * Returns a value in [0, 1).
 */
function stableHash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  // Map to [0, 1)
  return (h % 10000) / 10000
}

/* ────────────────────────── band helpers ────────────────────────── */

function bandIndexFor(value: number, bands: Band[]): number {
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]!
    if (value >= b.min && value <= b.max) return i
  }
  // Clamp to last band if out of range
  return bands.length - 1
}

function labelForBandIndex(idx: number, bands: Band[]): string {
  const clamped = Math.max(0, Math.min(bands.length - 1, idx))
  return bands[clamped]!.label
}

/* ────────────────────────── public API ────────────────────────── */

export type PersonalityConfidence = 'low' | 'medium' | 'high'

export interface PersonalityTraitRead {
  /** Trait key, e.g. 'ambition'. */
  key: string
  /** Human label, e.g. 'Ambition'. */
  label: string
  /** Descriptor word derived from the (possibly skewed) band, e.g. 'Ambitious'. */
  descriptor: string
  /** Whether the GM has enough knowledge to show this trait at all. */
  known: boolean
  /** Scout confidence level at the current knowledge tier. */
  confidence: PersonalityConfidence
}

/** All personality + hidden-trait reads for one player. */
export type PersonalityReadView = PersonalityTraitRead[]

/**
 * Build personality read-views for a player given the current scouting knowledge.
 *
 * Knowledge tiers:
 *   < 20  → not known (known=false, descriptor = '?')
 *   20–49 → low confidence, may be off by up to ±1 band
 *   50–79 → medium confidence, may be off by ±1 band only at medium-low end
 *   ≥ 80  → high confidence, exact band
 *
 * The skew direction is deterministic: derived from hash(playerId + traitKey),
 * so the same scout always perceives the same skewed value for a given player.
 * Only the BAND shown is skewed — the raw value is never modified.
 */
export function buildPersonalityRead(
  player: Player,
  scouting: ScoutingState
): PersonalityReadView {
  const pid = player.id as string
  const knowledge = knowledgeOf(scouting, pid)
  const result: PersonalityReadView = []

  const allTraits = [...PERSONALITY_TRAITS, ...HIDDEN_TRAITS]

  for (const trait of allTraits) {
    // Resolve raw value (1–20)
    let rawValue: number
    if (trait.inPersonality) {
      rawValue = (player.personality as unknown as Record<string, number>)[trait.key] ?? 10
    } else {
      rawValue = (player as unknown as Record<string, number | undefined>)[trait.key] ?? 10
    }

    // Clamp to 1-20
    rawValue = Math.max(1, Math.min(20, rawValue))

    // Below 20 knowledge: trait not known at all
    if (knowledge < 20) {
      result.push({ key: trait.key, label: trait.label, descriptor: '?', known: false, confidence: 'low' })
      continue
    }

    // Determine confidence tier
    let confidence: PersonalityConfidence
    if (knowledge >= 80) {
      confidence = 'high'
    } else if (knowledge >= 50) {
      confidence = 'medium'
    } else {
      confidence = 'low'
    }

    // Determine the displayed band index
    const trueBandIdx = bandIndexFor(rawValue, trait.bands)
    let displayBandIdx = trueBandIdx

    if (knowledge < 80) {
      // Skew: derive a stable ±1 shift from hash(playerId + traitKey)
      const hash = stableHash01(pid + ':' + trait.key)
      // hash in [0,1) → shift in {-1, 0, +1}
      // Low confidence (20-49): skew is applied more often (2/3 chance of being off)
      // Medium confidence (50-79): skew is applied less often (1/3 chance of being off)
      let skewShift = 0
      if (knowledge < 50) {
        // Low: shift if hash < 0.33 (down) or hash > 0.67 (up)
        if (hash < 0.33) skewShift = -1
        else if (hash > 0.67) skewShift = 1
      } else {
        // Medium: shift only if hash < 0.17 (down) or hash > 0.83 (up)
        if (hash < 0.17) skewShift = -1
        else if (hash > 0.83) skewShift = 1
      }
      displayBandIdx = Math.max(0, Math.min(trait.bands.length - 1, trueBandIdx + skewShift))
    }

    result.push({
      key: trait.key,
      label: trait.label,
      descriptor: labelForBandIndex(displayBandIdx, trait.bands),
      known: true,
      confidence,
    })
  }

  return result
}

/**
 * Build personality reads for own-roster players (no fog — exact reads, high confidence).
 * Used when the player is on the user's team.
 */
export function buildExactPersonalityRead(player: Player): PersonalityReadView {
  const allTraits = [...PERSONALITY_TRAITS, ...HIDDEN_TRAITS]
  return allTraits.map((trait) => {
    let rawValue: number
    if (trait.inPersonality) {
      rawValue = (player.personality as unknown as Record<string, number>)[trait.key] ?? 10
    } else {
      rawValue = (player as unknown as Record<string, number | undefined>)[trait.key] ?? 10
    }
    rawValue = Math.max(1, Math.min(20, rawValue))
    const bandIdx = bandIndexFor(rawValue, trait.bands)
    return {
      key: trait.key,
      label: trait.label,
      descriptor: labelForBandIndex(bandIdx, trait.bands),
      known: true,
      confidence: 'high' as PersonalityConfidence,
    }
  })
}
