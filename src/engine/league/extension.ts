/**
 * IN-SEASON CONTRACT EXTENSIONS — the promise the game used to break.
 *
 * Playtest 2026-08-26 §E2: an inbox scene offered "sign the extension NOW, a
 * year early, below what he'll be worth" — and the game had no way to do it.
 * The event promised an action the engine refused, which is worse than no event
 * at all. This module is the rule layer that makes the offer real.
 *
 * It follows the actual CBA shape:
 *   - Only a player in the FINAL year of his contract may be extended.
 *   - Only from roughly the calendar new year onward (the real rule is Jan 1),
 *     expressed here as a fraction of the schedule so it stays ruleset-aware.
 *   - The extension does not touch the running contract. It takes effect the
 *     following season, and until then it is a commitment against NEXT year's
 *     cap, not this one.
 *   - A club may extend its own player up to eight years.
 *
 * The DISCOUNT is the part that made the scene interesting, so it is modelled
 * literally: an agent's early-extension overture stamps a time-limited
 * multiplier on that player's ask. Let the season end and it lapses — "that
 * discount has an expiry date, and it's June."
 *
 * Pure + deterministic + JSON-safe. The career layer owns persistence, the
 * negotiation session, and the moment the deal actually starts paying.
 */

import type { Player } from '@domain'

/* ────────────────────────── constants ────────────────────────── */

/** A club may extend its own player up to this many years. */
export const MAX_EXTENSION_YEARS = 8

/**
 * Fraction of the schedule that must be played before extension talks open.
 * The NHL's real gate is January 1 of the contract's final season; half a
 * schedule is the ruleset-agnostic way to say the same thing.
 */
export const EXTENSION_WINDOW_FRACTION = 0.5

/* ────────────────────────── types ────────────────────────── */

/**
 * A signed deal that has not started yet. Held by the career layer until the
 * season rolls over, then written onto the player's contract.
 */
export interface PendingExtension {
  playerId: string
  salary: number
  years: number
  /** Season in which the pen hit paper. */
  signedYear: number
  /** First season the money is actually paid. Always signedYear + 1. */
  startYear: number
  clause: 'none' | 'modified' | 'full'
  signingBonusPct: number
  noTradeClause: boolean
}

/**
 * A time-limited concession from a player's camp, planted by an authored scene.
 * `mult` multiplies his asking price while it lasts.
 */
export interface ExtensionDiscount {
  playerId: string
  /** Season the overture was made; it lapses when that season ends. */
  year: number
  /** <1. 0.88 = "twelve percent under what he'll be worth." */
  mult: number
  /** Human sentence for the UI: why this number is where it is. */
  note: string
}

export type ExtensionBlock =
  | 'notYourPlayer'
  | 'notFinalYear'
  | 'windowClosed'
  | 'alreadyExtended'
  | 'wrongPhase'

export interface ExtensionEligibility {
  eligible: boolean
  block?: ExtensionBlock
  /** Player-facing sentence explaining the state. Always populated. */
  reason: string
}

/* ────────────────────────── eligibility ────────────────────────── */

export function extensionBlockReason(block: ExtensionBlock): string {
  switch (block) {
    case 'notYourPlayer':
      return 'You can only extend a player under contract to your own club.'
    case 'notFinalYear':
      return 'Extension talks open only in the final year of a contract.'
    case 'windowClosed':
      return 'Extension talks open at the turn of the calendar year — not before.'
    case 'alreadyExtended':
      return 'He has already signed an extension. It starts next season.'
    case 'wrongPhase':
      return 'Extensions are negotiated during the season, not in the summer.'
  }
}

/**
 * May the club open extension talks with this man today?
 *
 * `seasonFraction` is games played / games scheduled for the club, so the gate
 * moves with the ruleset instead of hardcoding a date.
 */
export function extensionEligibility(args: {
  player: Player
  /** True when he sits on the user's NHL roster (or its affiliate). */
  onOwnRoster: boolean
  /** 0–1 through the regular season. */
  seasonFraction: number
  /** False outside the regular season. */
  inRegularSeason: boolean
  /** True when a pending extension already exists for him. */
  alreadyExtended: boolean
}): ExtensionEligibility {
  const block = ((): ExtensionBlock | null => {
    if (!args.onOwnRoster) return 'notYourPlayer'
    if (args.alreadyExtended) return 'alreadyExtended'
    if (!args.inRegularSeason) return 'wrongPhase'
    if (args.player.contract.yearsRemaining !== 1) return 'notFinalYear'
    if (args.seasonFraction < EXTENSION_WINDOW_FRACTION) return 'windowClosed'
    return null
  })()

  if (block === null) {
    return {
      eligible: true,
      reason: 'He is in the last year of his deal and the window is open — you can talk term now.',
    }
  }
  return { eligible: false, block, reason: extensionBlockReason(block) }
}

/* ────────────────────────── the discount ────────────────────────── */

/**
 * The live multiplier on a player's ask, given the discounts on the books.
 * A discount only counts in the season it was offered — the whole point of the
 * scene is that waiting costs you the concession.
 */
export function discountMultiplier(
  discounts: readonly ExtensionDiscount[],
  playerId: string,
  year: number,
): number {
  const live = discounts.filter((d) => d.playerId === playerId && d.year === year)
  if (live.length === 0) return 1
  // If more than one is somehow on the books, the club gets the best of them.
  return Math.min(...live.map((d) => d.mult))
}

/** Prune discounts that no longer apply — called when the season turns. */
export function pruneDiscounts(
  discounts: readonly ExtensionDiscount[],
  currentYear: number,
): ExtensionDiscount[] {
  return discounts.filter((d) => d.year >= currentYear)
}

/* ────────────────────────── next-season cap ────────────────────────── */

/**
 * Payroll already committed to NEXT season: every contract with more than one
 * year left keeps paying, and every signed extension starts. An extension is
 * checked against THIS number, not against today's cap sheet — which is the
 * honest question, since the money is next year's problem.
 */
export function committedNextSeason(args: {
  /** Contracts on the club's books today. */
  roster: readonly Player[]
  pending: readonly PendingExtension[]
  /** Dead money already scheduled against next season. */
  deadCapNextSeason?: number
}): number {
  const pendingIds = new Set(args.pending.map((p) => p.playerId))
  let total = 0
  for (const p of args.roster) {
    // A pending extension replaces whatever he is earning now.
    if (pendingIds.has(p.id as string)) continue
    if (p.contract.yearsRemaining > 1) total += p.contract.salary
  }
  for (const e of args.pending) total += e.salary
  return total + (args.deadCapNextSeason ?? 0)
}

/** Does one more extension at `salary` still fit under next season's ceiling? */
export function fitsNextSeason(args: {
  roster: readonly Player[]
  pending: readonly PendingExtension[]
  salary: number
  cap: number
  deadCapNextSeason?: number
}): { fits: boolean; committed: number; room: number } {
  const committed = committedNextSeason({
    roster: args.roster,
    pending: args.pending,
    ...(args.deadCapNextSeason !== undefined ? { deadCapNextSeason: args.deadCapNextSeason } : {}),
  })
  const room = args.cap - committed
  return { fits: args.salary <= room, committed, room }
}

/** One-line receipt for the UI and the news item. */
export function describeExtension(e: PendingExtension, playerName: string): string {
  const m = `$${(e.salary / 1e6).toFixed(2)}M`
  const structure: string[] = []
  if (e.signingBonusPct > 0) structure.push(`${e.signingBonusPct}% signing bonus`)
  if (e.clause === 'full') structure.push('no-move clause')
  else if (e.clause === 'modified') structure.push('modified no-trade clause')
  return (
    `${playerName} is extended: ${m} × ${e.years} year${e.years === 1 ? '' : 's'}, ` +
    `beginning in ${e.startYear}.` +
    (structure.length > 0 ? ` Structure: ${structure.join(', ')}.` : '')
  )
}
