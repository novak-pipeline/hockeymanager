/**
 * Continue-cadence classification (EXCELLENCE B2.1, Gap #7).
 *
 * Every interruption to the Continue loop is a decision, a story, or silent.
 * Decisions are the beat gates — they route to their own screens and name
 * themselves on the button. Everything else arrives as mail, and the processing
 * overlay decides whether it is worth stopping for.
 *
 * "Any mail at all" was too low a bar. Measured over 60 advances of a real
 * season, the overlay held on 57 of them; 18 of those stops were ambient
 * league churn ALONE — other clubs' roster moves, nothing to do with your team.
 * Filtering those took the hold rate to 45/60, so one advance in five now flows
 * instead of one in twenty.
 */
import type { NewsItem } from '@domain/news'

/** Salience score at or above which even league-wide churn earns a stop. */
export const STOP_SALIENCE = 55

/**
 * Is this item worth interrupting the GM for?
 *
 * Anything outside the league-wide bucket touches the GM's own club — his
 * injuries, trades, contracts, results, scouting — and always earns the stop.
 * Within that bucket only the genuinely notable does: a bylined press piece, a
 * first-of-its-kind story, or one the salience engine rates highly.
 *
 * Salience is present on very few items, so it widens the net rather than
 * defining it; the category is what filters the churn.
 */
export function worthAStop(n: NewsItem): boolean {
  return n.category !== 'league' || !!n.press || !!n.rare || (n.salience ?? 0) >= STOP_SALIENCE
}

/**
 * Should the processing overlay HOLD after an advance, or close itself?
 * A finished user game always holds — its receipts are the point of the stop.
 */
export function shouldHoldOverlay(incoming: readonly NewsItem[], hasReceipt: boolean): boolean {
  return hasReceipt || incoming.some(worthAStop)
}
