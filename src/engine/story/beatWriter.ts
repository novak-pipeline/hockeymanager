/**
 * writeBeat — the one call an inbox beat makes to turn a pool into words.
 *
 * Inbox beats are MOMENTS: written once, persisted, read later. So they go
 * through the Content Engine proper — most-specific eligible variant, the
 * save's shared no-repeat ledger, least-recently-used when a pool runs dry —
 * rather than `pickStable`, which is for text a view rebuilds on every render.
 *
 * The Rng is seeded from a caller key (a game id, a player id + day), so the
 * same save replays the same words, and nothing here draws on the sim's own
 * streams: prose never perturbs an outcome.
 */
import { Rng } from '@engine/shared/rng'
import { markUsed, renderTemplate, selectVariant, type ContentCtx, type ContentUse, type ContentVariant } from './contentEngine'
import { stableSeed } from './prose'

export interface BeatText {
  headline: string
  body: string
  /** The variant that was used — for tests and the audit, never shown. */
  variantId: string
}

export function writeBeat(args: {
  pool: ContentVariant[]
  ctx: ContentCtx
  slots: Record<string, string>
  /** Stable per moment: `${kind}|${gameId}`, `${kind}|${playerId}|${year}|${day}`. */
  key: string
  ledger: ContentUse[]
  year: number
  day: number
}): BeatText | null {
  const v = selectVariant({ pool: args.pool, ctx: args.ctx, rng: new Rng(stableSeed(args.key)), ledger: args.ledger, year: args.year })
  if (!v) return null
  markUsed(args.ledger, v.id, args.year, args.day)
  return {
    headline: renderTemplate(v.text, args.slots),
    body: v.text2 !== undefined ? renderTemplate(v.text2, args.slots) : '',
    variantId: v.id,
  }
}
