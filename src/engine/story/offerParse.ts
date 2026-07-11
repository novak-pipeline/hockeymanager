/**
 * Freeform contract terms → a structured `ContractOffer`.
 *
 * The GM types his terms in plain English ("five years, AAV under 7, full
 * no-move") and the local model fills the offer form. The DEPTH-1 negotiation
 * engine (`src/engine/league/negotiation.ts`) then evaluates that offer exactly
 * as if the GM had used the sliders; the model NEVER decides accept/counter and
 * never sets a value the engine trusts without the GM confirming it.
 *
 * The boundary is enforced here, not by the model:
 *   • The model is asked for strict JSON with a fixed set of fields. We extract
 *     the first JSON object, coerce each field, and **clamp every number to the
 *     engine-legal range** (salary floor/cap ceiling, 1–8 years, bonus ∈
 *     {0,10,20,30}, clause ∈ {none,modified,full}). The engine range-checks
 *     nothing, so this clamp is the guard.
 *   • The parsed offer is loaded into the SAME builder the GM sees, so tabling it
 *     is an explicit confirm — the model proposes numbers, the GM commits them.
 *   • Pure and dependency-free (only a type-import): testable in isolation, no
 *     I/O. The renderer injects the inference call between build and parse.
 *
 * Salary convention (see docs/DATA + negotiation.ts): salaries are WHOLE DOLLARS
 * (7_000_000, not 7). The model is told to emit dollars; `normalizeSalary`
 * rescues the common "typed millions" mistake, and the visible confirm form
 * catches anything else.
 */

import type { ContractOffer, ClauseLevel } from '@engine/league/negotiation'

export interface OfferBounds {
  /** League minimum (e.g. 750_000). */
  minSalary: number
  /** Cap ceiling for this offer (cap space + any salary being replaced). */
  maxSalary: number
  minYears: number
  maxYears: number
}

export interface OfferPrompt {
  system: string
  user: string
  maxTokens: number
}

const CLAUSES: ClauseLevel[] = ['none', 'modified', 'full']
const BONUS_STEPS = [0, 10, 20, 30]

/** Build the JSON-extraction prompt, anchored on the agent's current ask. */
export function buildOfferPrompt(args: {
  freeform: string
  askSalary: number
  askYears: number
  playerName: string
}): OfferPrompt {
  const askM = (args.askSalary / 1e6).toFixed(2)
  const system = [
    "You convert a hockey general manager's contract terms into a JSON offer.",
    'Output ONLY a JSON object — no prose, no code fences. Fields:',
    '  "salary": number   — average annual salary in WHOLE DOLLARS (7000000 means $7M)',
    '  "years": integer   — contract length, 1 to 8',
    '  "signingBonusPct": integer — one of 0, 10, 20, 30',
    '  "clause": string   — "none", "modified" (partial no-trade), or "full" (no-move/NMC)',
    '  "twoWay": boolean',
    `Interpret "under 7" / "7M" / "seven million" as salary 7000000. Interpret "five years" as years 5.`,
    `For any field the GM does not mention, use: salary ${args.askSalary}, years ${args.askYears}, signingBonusPct 0, clause "none", twoWay false.`,
  ].join('\n')
  const user = [
    `The agent is currently asking about $${askM}M per year for ${args.playerName}.`,
    `The GM's terms: "${clip(args.freeform, 400)}"`,
    'JSON:',
  ].join('\n')
  return { system, user, maxTokens: 80 }
}

/**
 * Parse raw model text into a clamped, engine-legal `ContractOffer`. Returns
 * `null` when no usable JSON is found (the UI then keeps the manual builder).
 */
export function parseOffer(raw: string, bounds: OfferBounds): ContractOffer | null {
  const obj = extractJson(raw)
  if (!obj) return null

  const salaryRaw = num(obj.salary)
  const yearsRaw = num(obj.years)
  // Require at least one of the two core fields to have parsed — otherwise this
  // wasn't a real offer and we shouldn't overwrite the builder with defaults.
  if (salaryRaw === null && yearsRaw === null) return null

  const salary = clamp(
    roundTo25k(normalizeSalary(salaryRaw ?? bounds.minSalary)),
    bounds.minSalary,
    Math.max(bounds.minSalary, bounds.maxSalary),
  )
  const years = clamp(Math.round(yearsRaw ?? bounds.minYears), bounds.minYears, bounds.maxYears)
  const signingBonusPct = snap(num(obj.signingBonusPct) ?? 0, BONUS_STEPS)
  const clause: ClauseLevel = CLAUSES.includes(obj.clause as ClauseLevel)
    ? (obj.clause as ClauseLevel)
    : 'none'
  const twoWay = obj.twoWay === true

  return { salary, years, signingBonusPct, clause, twoWay }
}

/** A one-line human echo of what was parsed, for the confirm step. */
export function describeOffer(offer: ContractOffer): string {
  const m = (offer.salary / 1e6).toFixed(2)
  const parts = [`$${m}M × ${offer.years}yr`]
  if (offer.signingBonusPct > 0) parts.push(`${offer.signingBonusPct}% SB`)
  if (offer.clause === 'full') parts.push('no-move')
  else if (offer.clause === 'modified') parts.push('mod. NTC')
  if (offer.twoWay) parts.push('two-way')
  return parts.join(' · ')
}

/* ─────────────────────────── helpers ─────────────────────────── */

/** Model emits dollars, but "7"/"7.5" (millions) is the common slip — rescue it. */
function normalizeSalary(n: number): number {
  if (n > 0 && n < 1000) return n * 1e6
  return n
}

/** Pull the first {...} object out of the model text and JSON.parse it. */
function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.]/g, ''))
    if (Number.isFinite(n)) return n
  }
  return null
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

function roundTo25k(x: number): number {
  return Math.round(x / 25_000) * 25_000
}

function snap(x: number, steps: number[]): number {
  return steps.reduce((best, s) => (Math.abs(s - x) < Math.abs(best - x) ? s : best), steps[0]!)
}

function clip(s: string, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
