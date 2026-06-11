/**
 * Structured news/inbox items — replaces the free-text string feed. Rendered by
 * the FM-style inbox; JSON-safe for saves.
 */

export type NewsCategory =
  | 'result'
  | 'injury'
  | 'trade'
  | 'contract'
  | 'draft'
  | 'award'
  | 'league'
  | 'milestone'
  | 'playoffs'

export interface NewsItem {
  /** Unique within a career, e.g. "n42". */
  id: string
  /** Match-day number the item was generated on (0 = preseason/offseason). */
  day: number
  /** Season year the item belongs to. */
  year: number
  category: NewsCategory
  headline: string
  body: string
  /** Optional subject links for click-through. */
  teamId?: string
  playerId?: string
  read: boolean
}
