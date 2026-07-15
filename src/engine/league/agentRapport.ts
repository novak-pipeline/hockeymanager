/**
 * The GM's standing with contract AGENTS — a persistent relationship that gives
 * negotiations memory and consequence.
 *
 * Agents are hash-derived from `player.id` (see `agentFor` in negotiation.ts) and
 * drawn from a small name pool, so the same agent recurs across a career: he
 * represents many players and remembers how you have dealt with his camp. This
 * module tracks a −100…+100 rapport per agent (keyed by name) that:
 *   • warms when you get deals DONE (a fair deal warms more than a lowball win);
 *   • sours when his camp walks or you pause talks;
 * and exposes a neutral-when-absent `rapportTilt` the negotiation engine multiplies
 * into three knobs — opening price, opening patience, concession speed. A good
 * agent relationship earns you a slightly friendlier open and a quicker handshake;
 * a burned one costs you both. Absent/neutral ⇒ tilt 0 ⇒ the engine is unchanged
 * (so the calibrated negotiation tests, which carry no rapport, stay byte-identical).
 *
 * Mirrors the pundit-rapport model (`src/engine/story/pundits.ts`): a JSON-safe
 * array, seed/normalize for save-load, a pure delta, and a mutate-in-place apply.
 */

export type AgentStanding = 'Trusted' | 'Cordial' | 'Neutral' | 'Wary' | 'Burned'

export interface AgentRelationship {
  /** The agent's name (from agentFor) — the recurring identity. */
  agentKey: string
  /** −100 (burned) … 0 (neutral) … +100 (trusted). */
  rapport: number
  /** Contracts signed with this agent's clients. */
  deals: number
  /** Times his camp walked or paused on you. */
  walks: number
  /** Career year of the most recent dealing. */
  lastYear?: number
}

export interface AgentRapportState {
  agents: AgentRelationship[]
}

const RAPPORT_MIN = -100
const RAPPORT_MAX = 100
const TRUSTED_AT = 45
const CORDIAL_AT = 18
const WARY_AT = -18
const BURNED_AT = -45

/** How far rapport moves the engine: rapport/SCALE, clamped to ±1 (0 at neutral). */
const TILT_SCALE = 80

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Fresh, empty rapport for a new career (relationships accrue as you deal). */
export function seedAgentRapport(): AgentRapportState {
  return { agents: [] }
}

/** Backfill/clean a loaded state: dedupe by key, clamp stray values. Old saves
 *  (no field) pass `undefined` and get a clean empty state. */
export function normalizeAgentRapport(state: AgentRapportState | undefined | null): AgentRapportState {
  const out = seedAgentRapport()
  if (state && Array.isArray(state.agents)) {
    for (const rel of state.agents) {
      if (!rel || typeof rel.agentKey !== 'string' || !rel.agentKey) continue
      let slot = out.agents.find((r) => r.agentKey === rel.agentKey)
      if (!slot) {
        slot = { agentKey: rel.agentKey, rapport: 0, deals: 0, walks: 0 }
        out.agents.push(slot)
      }
      slot.rapport = clamp(Math.round(rel.rapport ?? 0), RAPPORT_MIN, RAPPORT_MAX)
      slot.deals = Math.max(0, Math.round(rel.deals ?? 0))
      slot.walks = Math.max(0, Math.round(rel.walks ?? 0))
      if (typeof rel.lastYear === 'number') slot.lastYear = rel.lastYear
    }
  }
  return out
}

/** The relationship for an agent — a neutral, ephemeral one if none exists yet. */
export function relationOf(state: AgentRapportState, agentKey: string): AgentRelationship {
  return state.agents.find((r) => r.agentKey === agentKey) ?? { agentKey, rapport: 0, deals: 0, walks: 0 }
}

export function standingOf(rapport: number): AgentStanding {
  if (rapport >= TRUSTED_AT) return 'Trusted'
  if (rapport >= CORDIAL_AT) return 'Cordial'
  if (rapport <= BURNED_AT) return 'Burned'
  if (rapport <= WARY_AT) return 'Wary'
  return 'Neutral'
}

/**
 * The engine multiplier: −1…+1, exactly 0 at neutral or when the agent is absent.
 * The negotiation engine folds this into opening price / patience / concessions.
 */
export function rapportTilt(state: AgentRapportState, agentKey: string): number {
  return clamp(relationOf(state, agentKey).rapport / TILT_SCALE, -1, 1)
}

/** A one-line read for the UI. */
export function agentRapportNote(rel: AgentRelationship): string {
  const s = standingOf(rel.rapport)
  const n = rel.deals + rel.walks
  if (n === 0) return "You have no history with this agent."
  const history = `${rel.deals} deal${rel.deals === 1 ? '' : 's'}${rel.walks > 0 ? `, ${rel.walks} walkout${rel.walks === 1 ? '' : 's'}` : ''}`
  switch (s) {
    case 'Trusted':
      return `He trusts your word — expect a friendlier open and a quicker handshake. (${history})`
    case 'Cordial':
      return `You have a working relationship. (${history})`
    case 'Wary':
      return `He is wary of your table — he'll open harder and lose patience faster. (${history})`
    case 'Burned':
      return `You've burned this camp before. Expect no favours. (${history})`
    default:
      return `A businesslike history. (${history})`
  }
}

/* ────────────────────────── outcome model ────────────────────────── */

export type DealOutcome =
  | { kind: 'signed'; askSalary: number; finalSalary: number }
  | { kind: 'walked' }
  | { kind: 'paused' }

/** Rapport shift from how a negotiation ended. Getting a deal DONE builds trust;
 *  a fair deal more than a lowball (his client left money on the table). */
export function outcomeDelta(o: DealOutcome): number {
  if (o.kind === 'walked') return -14
  if (o.kind === 'paused') return -7
  const ratio = o.askSalary > 0 ? o.finalSalary / o.askSalary : 1
  if (ratio >= 0.97) return 12
  if (ratio >= 0.9) return 8
  return 4
}

export interface AgentOutcomeResult {
  agentKey: string
  delta: number
  rapportBefore: number
  rapportAfter: number
  standingBefore: AgentStanding
  standingAfter: AgentStanding
  crossedBoundary: boolean
}

/** Apply a negotiation outcome to the agent, mutating state in place. */
export function applyDealOutcome(
  state: AgentRapportState,
  agentKey: string,
  o: DealOutcome,
  year: number
): AgentOutcomeResult {
  let slot = state.agents.find((r) => r.agentKey === agentKey)
  if (!slot) {
    slot = { agentKey, rapport: 0, deals: 0, walks: 0 }
    state.agents.push(slot)
  }
  const before = slot.rapport
  const delta = outcomeDelta(o)
  slot.rapport = clamp(before + delta, RAPPORT_MIN, RAPPORT_MAX)
  if (o.kind === 'signed') slot.deals += 1
  else slot.walks += 1
  slot.lastYear = year
  const standingBefore = standingOf(before)
  const standingAfter = standingOf(slot.rapport)
  return {
    agentKey,
    delta,
    rapportBefore: before,
    rapportAfter: slot.rapport,
    standingBefore,
    standingAfter,
    crossedBoundary: standingBefore !== standingAfter,
  }
}
