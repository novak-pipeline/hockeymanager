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
 * PHASE 0 re-tier (depth audit 2026-09: the overlay held on 83% of advances,
 * mostly for "Scout report: X", slump quotes and routine desk mail). A stop is
 * now earned only by:
 *  - a first-of-its-kind (`rare`) or genuinely big (salience) story — key-man
 *    injuries, deadline day, clinches, records carry salience at the write site;
 *  - mail that is a DECISION or its answer (contracts: offers answered, an
 *    agent on the phone, a man at your door);
 *  - a milestone reached, an award, the draft, the playoffs.
 * Everything else — scouting reports (the weekly digest carries them), the
 * press columns, league churn, depth injuries, your own players' slump and
 * streak chatter, routine trade-desk mail — streams into the inbox without
 * holding the overlay.
 */
export function worthAStop(n: NewsItem): boolean {
  if (n.rare) return true
  // The social feed is a browse surface: a post that reached the inbox is
  // there to read, not to stop for (a first-of-its-kind one is `rare`).
  if (n.authorId !== undefined) return false
  if ((n.salience ?? 0) >= STOP_SALIENCE) return true
  if (n.reach === 'ownClub' || n.reach === 'ambient') return false
  switch (n.category) {
    case 'contract':
    case 'milestone':
    case 'award':
    case 'draft':
    case 'playoffs':
      return true
    default:
      return false
  }
}

/** The slice of a postgame receipt the stop rule reads. */
export interface ReceiptStopFacts {
  playoff: boolean
  homeGoals: number
  awayGoals: number
  /** The chronicle wrote a persistent storyline tonight (B6.3). */
  storyline?: string | null
}

/**
 * PHASE 0: does THIS result earn its own stop, or does it ride along on the
 * next match-day frame ("Last game: …")?
 *
 * The audit measured the overlay holding on 83% of advances, and after the
 * mail re-tier the single biggest holder left was the routine receipt — one
 * stop per game on top of the match-day frame that already stops every game
 * day. A result stops on its own when it IS a story: a playoff game, a night
 * the chronicle wrote down, a blowout either way (4+ goals), or a shutout
 * either way. Every other result is shown — first thing — on the next
 * match-day frame, where the GM is stopping anyway. `lastOfSeason` (no next
 * frame to carry it) always stops.
 */
export function receiptWorthAStop(r: ReceiptStopFacts, lastOfSeason = false): boolean {
  if (lastOfSeason || r.playoff) return true
  if (r.storyline) return true
  if (Math.abs(r.homeGoals - r.awayGoals) >= 4) return true
  return r.homeGoals === 0 || r.awayGoals === 0
}

/**
 * Should the processing overlay HOLD after an advance, or close itself?
 * `hasReceipt` = a user game finished on this advance AND its result earns a
 * stop ({@link receiptWorthAStop}); a routine result rides on the next
 * match-day frame instead.
 */
export function shouldHoldOverlay(incoming: readonly NewsItem[], hasReceipt: boolean): boolean {
  return hasReceipt || incoming.some(worthAStop)
}
