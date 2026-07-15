/**
 * Pundit relationships — the GM's standing with each named member of the press
 * corps. The three personas (beat / national / homer) already ask questions and
 * write the wire reports; this layer gives every answer a *lasting consequence*
 * so relationships build or sour over a career.
 *
 * Design constraints (mirrors rivalries.ts):
 *  - JSON-safe state (plain objects, no Maps / classes) — embeds in the career
 *    snapshot as an optional additive field with a fallback to seedPundits().
 *  - Pure, deterministic functions. No Rng, no wall-clock.
 *  - Never pushes news itself; the career layer decides what to surface.
 *  - Forward-compatible: normalizePundits backfills any persona a stored state
 *    is missing, so adding a persona later never breaks an old save.
 */

import type { PressPersonaId, PressTone } from './factSheet'
import { PRESS_PERSONA_NAMES } from './factSheet'

/* ────────────────────────── public types ────────────────────────── */

/** All personas that hold a relationship with the GM (order = display order). */
export const PUNDIT_PERSONAS: readonly PressPersonaId[] = ['beat', 'national', 'homer']

export type PunditStanding = 'Ally' | 'Friendly' | 'Neutral' | 'Critic' | 'Feud'

export interface PunditRelationship {
  personaId: PressPersonaId
  /** -100 (feud) … 0 (neutral) … +100 (ally). */
  rapport: number
  /** How many press exchanges this pundit has had with the GM. */
  interactions: number
  /** The tone of the most recent exchange, for the UI read. */
  lastTone?: PressTone
  /** Career day of the most recent exchange. */
  lastDay?: number
}

export interface PunditState {
  pundits: PunditRelationship[]
}

/* ────────────────────────── constants ────────────────────────── */

/** Standing thresholds on the -100..100 rapport axis. */
const ALLY_AT = 55
const FRIENDLY_AT = 20
const CRITIC_AT = -20
const FEUD_AT = -55

const RAPPORT_MIN = -100
const RAPPORT_MAX = 100

/* ────────────────────────── helpers ────────────────────────── */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Fresh, all-neutral relationships for a new career. */
export function seedPundits(): PunditState {
  return {
    pundits: PUNDIT_PERSONAS.map((personaId) => ({ personaId, rapport: 0, interactions: 0 })),
  }
}

/**
 * Backfill a loaded state so it always contains one entry per known persona and
 * clamps stray values. Old saves (or a state that predates a persona) load
 * cleanly and gain neutral relationships for anything missing.
 */
export function normalizePundits(state: PunditState | undefined | null): PunditState {
  const out = seedPundits()
  if (state && Array.isArray(state.pundits)) {
    for (const rel of state.pundits) {
      const slot = out.pundits.find((r) => r.personaId === rel.personaId)
      if (!slot) continue
      slot.rapport = clamp(Math.round(rel.rapport ?? 0), RAPPORT_MIN, RAPPORT_MAX)
      slot.interactions = Math.max(0, Math.round(rel.interactions ?? 0))
      if (rel.lastTone) slot.lastTone = rel.lastTone
      if (typeof rel.lastDay === 'number') slot.lastDay = rel.lastDay
    }
  }
  return out
}

export function relationOf(state: PunditState, personaId: PressPersonaId): PunditRelationship {
  return state.pundits.find((r) => r.personaId === personaId) ?? { personaId, rapport: 0, interactions: 0 }
}

/* ────────────────────────── rapport model ────────────────────────── */

/**
 * How much a given answer tone shifts a pundit's rapport. Each persona reads
 * the room differently:
 *  - the beat reporter values daily candour (dodging stings, composure steadies);
 *  - the national columnist respects measured analysis and sees through bluster
 *    and spin alike;
 *  - the homer radio host feeds on passion and optimism and hates a dodge.
 */
export function rapportDelta(personaId: PressPersonaId, tone: PressTone): number {
  const base: Record<PressTone, number> = { praise: 6, measured: 3, fiery: -3, deflecting: -6 }
  let d = base[tone]
  switch (personaId) {
    case 'homer':
      if (tone === 'praise') d += 3 // loves optimism
      if (tone === 'fiery') d += 5 // loves passion (net +2)
      if (tone === 'deflecting') d -= 3 // hates a dodge
      break
    case 'national':
      if (tone === 'measured') d += 2 // respects composure
      if (tone === 'fiery') d -= 2 // sees through bluster
      if (tone === 'praise') d -= 3 // discounts spin
      break
    case 'beat':
    default:
      if (tone === 'measured') d += 1 // steady, day-to-day trust
      if (tone === 'deflecting') d -= 1 // notices every dodge
      break
  }
  return d
}

export interface PunditAnswerResult {
  personaId: PressPersonaId
  delta: number
  rapportBefore: number
  rapportAfter: number
  standingBefore: PunditStanding
  standingAfter: PunditStanding
  /** True when the exchange moved the relationship across a standing boundary. */
  crossedBoundary: boolean
}

/**
 * Apply a press answer to the asking pundit, mutating the state in place, and
 * report what changed (so the caller can surface a news beat on a big shift).
 */
export function applyPunditAnswer(
  state: PunditState,
  personaId: PressPersonaId,
  tone: PressTone,
  day: number,
): PunditAnswerResult {
  const rel = state.pundits.find((r) => r.personaId === personaId)
  if (!rel) {
    // Shouldn't happen after normalizePundits, but stay safe.
    const fresh: PunditRelationship = { personaId, rapport: 0, interactions: 0 }
    state.pundits.push(fresh)
    return applyPunditAnswer(state, personaId, tone, day)
  }
  const delta = rapportDelta(personaId, tone)
  const before = rel.rapport
  const after = clamp(before + delta, RAPPORT_MIN, RAPPORT_MAX)
  rel.rapport = after
  rel.interactions += 1
  rel.lastTone = tone
  rel.lastDay = day
  const standingBefore = punditStanding(before)
  const standingAfter = punditStanding(after)
  return {
    personaId,
    delta,
    rapportBefore: before,
    rapportAfter: after,
    standingBefore,
    standingAfter,
    crossedBoundary: standingBefore !== standingAfter,
  }
}

/* ────────────────────────── standing + reads ────────────────────────── */

export function punditStanding(rapport: number): PunditStanding {
  if (rapport >= ALLY_AT) return 'Ally'
  if (rapport >= FRIENDLY_AT) return 'Friendly'
  if (rapport > CRITIC_AT) return 'Neutral'
  if (rapport > FEUD_AT) return 'Critic'
  return 'Feud'
}

/** A one-line human read on where the relationship stands. */
export function punditRead(rel: PunditRelationship): string {
  const name = PRESS_PERSONA_NAMES[rel.personaId].name
  switch (punditStanding(rel.rapport)) {
    case 'Ally':
      return `${name} is firmly in your corner — his columns give you the benefit of the doubt.`
    case 'Friendly':
      return `${name} has warmed to you; the coverage leans fair.`
    case 'Neutral':
      return rel.interactions === 0
        ? `You haven't given ${name} much to go on yet.`
        : `${name} plays it straight down the middle with you.`
    case 'Critic':
      return `${name} has soured on you — expect a sceptical read.`
    case 'Feud':
      return `${name} is openly hostile; every misstep becomes a headline.`
  }
}

/** Short verb for the last exchange, for the UI. */
export function toneVerb(tone: PressTone | undefined): string {
  switch (tone) {
    case 'praise':
      return 'talked the room up'
    case 'measured':
      return 'kept it measured'
    case 'fiery':
      return 'came out swinging'
    case 'deflecting':
      return 'gave nothing away'
    default:
      return 'not spoken yet'
  }
}

/**
 * A small coverage lean for generated press, -1 (hostile) … +1 (friendly),
 * from a persona's current rapport. Callers can use it to nudge headline tone;
 * it is 0 at neutral so absent/neutral relationships change nothing.
 */
export function coverageTilt(state: PunditState, personaId: PressPersonaId): number {
  const rel = relationOf(state, personaId)
  return clamp(rel.rapport / 100, -1, 1)
}

/** The GM's strongest ally and chief critic (or null when nobody qualifies). */
export function mediaStandingSummary(state: PunditState): { ally: PressPersonaId | null; critic: PressPersonaId | null } {
  let ally: PunditRelationship | null = null
  let critic: PunditRelationship | null = null
  for (const rel of state.pundits) {
    if (rel.rapport >= FRIENDLY_AT && (!ally || rel.rapport > ally.rapport)) ally = rel
    if (rel.rapport <= CRITIC_AT && (!critic || rel.rapport < critic.rapport)) critic = rel
  }
  return { ally: ally?.personaId ?? null, critic: critic?.personaId ?? null }
}
