/**
 * The Content Engine — Narrative Engine layer 1 (docs/NARRATIVE-ENGINE.md §4).
 *
 * The Hades model, adapted: hand-authored variant pools, state-keyed selection
 * (the MOST SPECIFIC eligible variant wins, never a uniform roll), a per-save
 * no-repeat ledger (nothing repeats verbatim within a season — EXCELLENCE.md
 * B4.5), and graceful callback slots that cite real history when a hit exists
 * and drop silently when it doesn't (never invent facts).
 *
 * Pure + deterministic. Writers add variants to data pools; they never touch
 * engine code. Consumers build a ContentCtx from sim state and call select().
 */
import type { Rng } from '@engine/shared/rng'

/* ────────────────────────────── model ────────────────────────────── */

/** Scalar state a variant's conditions are checked against. */
export type ContentCtx = Record<string, string | number | boolean>

/**
 * One authored line/scene. Conditions are a partial view of the ctx:
 *  - `minFoo: 4`  matches when ctx.foo >= 4   (numeric floor)
 *  - `maxFoo: 2`  matches when ctx.foo <= 2   (numeric ceiling)
 *  - anything else matches by strict equality (ctx.key === value)
 * ALL conditions must hold for eligibility; the count of conditions is the
 * variant's SPECIFICITY. A generic line (no conditions) only wins when
 * nothing more specific is eligible.
 */
export interface ContentVariant {
  /** Stable id — the no-repeat ledger keys on it. */
  id: string
  conditions?: ContentCtx
  /** Template text. Slots: `{slot}` from the fill map; `{callback:…}` blocks
   *  render only when callback data is provided (may use `{cb.*}` inside). */
  text: string
  /** Optional second template (e.g. headline vs body). Same slot rules. */
  text2?: string
}

/** One use of a variant, persisted in the save. JSON-safe. */
export interface ContentUse {
  variantId: string
  year: number
  day: number
}

/* ─────────────────────────── selection ─────────────────────────── */

function condMatches(key: string, want: string | number | boolean, ctx: ContentCtx): boolean {
  if (key.startsWith('min') && key.length > 3 && typeof want === 'number') {
    const base = key[3].toLowerCase() + key.slice(4)
    const have = ctx[base]
    return typeof have === 'number' && have >= want
  }
  if (key.startsWith('max') && key.length > 3 && typeof want === 'number') {
    const base = key[3].toLowerCase() + key.slice(4)
    const have = ctx[base]
    return typeof have === 'number' && have <= want
  }
  return ctx[key] === want
}

export function isEligible(v: ContentVariant, ctx: ContentCtx): boolean {
  if (!v.conditions) return true
  return Object.entries(v.conditions).every(([k, want]) => condMatches(k, want, ctx))
}

/**
 * Pick from a pool: most specific eligible variant not yet used this season;
 * seeded tie-break among equals. If every eligible variant has been used, the
 * least-recently-used one repeats rather than going silent (a season of heavy
 * play beats a missing beat — but fresh always outranks stale).
 */
export function selectVariant(args: {
  pool: ContentVariant[]
  ctx: ContentCtx
  rng: Rng
  /** The save's use history. Pass [] to disable no-repeat tracking. */
  ledger: ContentUse[]
  year: number
}): ContentVariant | null {
  const { pool, ctx, rng, ledger, year } = args
  const eligible = pool.filter((v) => isEligible(v, ctx))
  if (eligible.length === 0) return null
  const usedThisSeason = new Set(ledger.filter((u) => u.year === year).map((u) => u.variantId))
  const fresh = eligible.filter((v) => !usedThisSeason.has(v.id))
  if (fresh.length > 0) {
    const top = Math.max(...fresh.map((v) => Object.keys(v.conditions ?? {}).length))
    const best = fresh.filter((v) => Object.keys(v.conditions ?? {}).length === top)
    return best[rng.int(best.length)]
  }
  // Exhausted: repeat the one whose last use is oldest.
  const lastUse = new Map<string, number>()
  for (const u of ledger) {
    const key = u.variantId
    const stamp = u.year * 1000 + u.day
    if ((lastUse.get(key) ?? -1) < stamp) lastUse.set(key, stamp)
  }
  return [...eligible].sort((a, b) => (lastUse.get(a.id) ?? -1) - (lastUse.get(b.id) ?? -1))[0]
}

/** Record a use (mutates the ledger array; caller persists it). Bounded. */
export function markUsed(ledger: ContentUse[], variantId: string, year: number, day: number): void {
  ledger.push({ variantId, year, day })
  if (ledger.length > 500) ledger.splice(0, ledger.length - 350)
}

/* ─────────────────────────── rendering ─────────────────────────── */

/**
 * Fill a template. `{slot}` substitutes from `slots`; a `{callback:…}` block
 * renders its contents (with `{cb.*}` slots) only when `callback` is provided —
 * otherwise the whole block vanishes and surrounding spacing is tidied. This is
 * how a line cites the chronicle when there IS history and reads cleanly when
 * there isn't, without ever fabricating a fact.
 */
export function renderTemplate(
  text: string,
  slots: Record<string, string>,
  callback?: Record<string, string>
): string {
  let out = text.replace(/\{callback:([^{}]*(?:\{cb\.[^}]+\}[^{}]*)*)\}/g, (_m, inner: string) => {
    if (!callback) return ''
    return inner.replace(/\{cb\.([a-zA-Z0-9_]+)\}/g, (_m2, key: string) => callback[key] ?? '')
  })
  out = out.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, key: string) => slots[key] ?? `{${key}}`)
  return out.replace(/ {2,}/g, ' ').replace(/ ([,.;!?])/g, '$1').trim()
}
