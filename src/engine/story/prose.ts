/**
 * Prose utilities — the small, shared craft layer under everything the game
 * says out loud.
 *
 * Two jobs:
 *
 *  1. **Mechanics** — punctuation, lists, hedging. Boring, and the reason a
 *     line reads "…after this call-up.." instead of "…after this call-up."
 *
 *  2. **Stable authored variation.** The Content Engine (contentEngine.ts) is
 *     the right tool for a beat that happens ONCE at a moment in time: it
 *     rolls a seeded pick and burns the variant in a no-repeat ledger. It is
 *     the wrong tool for text a VIEW rebuilds on every render — a scouting
 *     card must read the same each time the GM opens it, and a ledger write
 *     per render would both churn the save and make the prose flicker.
 *
 *     {@link pickStable} is the view-safe sibling: identical authored pools,
 *     identical most-specific-wins selection, but the tie-break is a stable
 *     hash of a caller-supplied key (a player id, a matchup, a draft year)
 *     instead of an Rng. Same subject → same sentence, forever. Different
 *     subjects → different sentences, which is the whole point: it is what
 *     stops one phrasing ("the board", "the board", "the board") from being
 *     the only phrasing the player ever sees.
 */
import { isEligible, renderTemplate, type ContentCtx, type ContentVariant } from './contentEngine'

/* ────────────────────────── mechanics ────────────────────────── */

/**
 * Exactly one terminator. Authored reason strings usually end in a full stop,
 * so interpolating one into `${reason}.` printed a double period; strings that
 * do NOT end in one need it added. Both cases, one call.
 */
export function oneSentence(s: string): string {
  const t = s.trim().replace(/[.!?]+$/, '')
  if (t.length === 0) return ''
  return /[!?]$/.test(s.trim()) ? `${t}${s.trim().slice(-1)}` : `${t}.`
}

/** "A", "A and B", "A, B and C" — no Oxford comma, matching the house voice. */
export function prosaicList(items: string[], conj = 'and'): string {
  const xs = items.filter((x) => x.trim().length > 0)
  if (xs.length === 0) return ''
  if (xs.length === 1) return xs[0]!
  return `${xs.slice(0, -1).join(', ')} ${conj} ${xs[xs.length - 1]}`
}

/**
 * The possessive of a name. English gives a name that already ends in *s* a
 * bare apostrophe — "the Stingrays' best player", not "the Stingrays's". Team
 * names ending in s are the norm in hockey, so a template that hard-codes
 * `{team}'s` gets it wrong most of the time. Use the `{teamPoss}` /
 * `{namePoss}` slots instead.
 */
export function possessive(name: string): string {
  const t = name.trim()
  if (t.length === 0) return ''
  return /[sS]$/.test(t) ? `${t}'` : `${t}'s`
}

/* ────────────────────────── stable selection ────────────────────────── */

/** FNV-1a-ish string hash. Stable across runs and machines. */
export function stableSeed(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Most-specific eligible variant, tie-broken by a stable hash of `key`.
 *
 * Selection matches contentEngine.selectVariant exactly — the count of a
 * variant's conditions is its specificity, and a generic line only wins when
 * nothing more specific is eligible — minus the Rng and the ledger. Returns
 * null when nothing is eligible (author an unconditional fallback if you never
 * want that).
 */
export function pickStable(pool: ContentVariant[], ctx: ContentCtx, key: string): ContentVariant | null {
  const eligible = pool.filter((v) => isEligible(v, ctx))
  if (eligible.length === 0) return null
  const top = Math.max(...eligible.map((v) => Object.keys(v.conditions ?? {}).length))
  const best = eligible.filter((v) => Object.keys(v.conditions ?? {}).length === top)
  return best[stableSeed(key) % best.length]!
}

/** {@link pickStable}, rendered. Returns '' when nothing is eligible. */
export function renderStable(
  pool: ContentVariant[],
  ctx: ContentCtx,
  key: string,
  slots: Record<string, string>
): string {
  const v = pickStable(pool, ctx, key)
  return v ? renderTemplate(v.text, slots) : ''
}
