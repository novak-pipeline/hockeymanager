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
  | 'scouting'

export interface NewsItem {
  /** Unique within a career, e.g. "n42". */
  id: string
  /** Match-day number the item was generated on (0 = preseason/offseason). */
  day: number
  /** Season year the item belongs to. */
  year: number
  /** Real calendar date when day/year can't derive it (offseason mail).
   *  Optional/additive for save compat. */
  dateISO?: string
  category: NewsCategory
  headline: string
  body: string
  /** Optional subject links for click-through. */
  teamId?: string
  playerId?: string
  read: boolean
  /**
   * Present on press-corps articles: the inbox renders these as bylined
   * articles instead of plain notices. Additive/optional for save compat.
   */
  press?: {
    /** "Writer Name — Outlet" display byline. */
    byline: string
    /** Press sheet kind, e.g. 'weekly' | 'deadline' | 'presser'. */
    kind: string
  }
  /**
   * Present on coach-quote items. The inbox renders these as a styled quote
   * card showing the coach's face and attribution line.
   * Additive/optional for save compat — older saves won't have these fields.
   */
  speaker?: string
  /** Facepack image key resolved to faces/<faceId>.png (mirrors StaffMember.faceId). */
  speakerFaceId?: string
  /**
   * Present on social-feed posts (docs/THE-FEED.md): which stream the post
   * belongs to ('feed' = public social, 'wire' = GM terminal), the account
   * that wrote it, the salience engine's 0-100 score, and frozen engagement
   * numbers. All additive/optional for save compat.
   */
  channel?: 'feed' | 'wire'
  authorId?: string
  salience?: number
  engagement?: { likes: number; reposts: number }
}
