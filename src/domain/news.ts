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
  /**
   * True when this story's novelty pattern fired for the FIRST time in the
   * save (storyPriors.noveltyCounts) — a first-ever kind of story is rare by
   * definition and gets the breaking treatment even below the salience bar.
   * Additive/optional for save compat.
   */
  rare?: boolean
  /**
   * Present on the weekly scout-digest briefing (playtest #10): the flagged
   * prospects still awaiting the GM's call, as structured refs the inbox
   * renders as real triage cards (track / another look / pass) instead of
   * prose. Additive/optional for save compat.
   */
  prospects?: DigestProspectRef[]
  /**
   * A8 — how far this beat is allowed to travel.
   *
   *  - `'ambient'`: it SPECULATES rather than reports (a rumour spawning, a
   *    milestone being approached, chatter intensifying). Feed and ticker
   *    colour. It never earns inbox space, whoever it is about — the milestone
   *    itself will arrive, and so will the trade.
   *  - `'ownClub'`: real league colour (a heater, a slump) that is mail only
   *    when it is one of YOUR men. Every other club's form is the Feed's job.
   *  - absent: ordinary front-office mail.
   *
   * Tagged at the site the beat is WRITTEN rather than sniffed out of the
   * prose downstream. The inbox used to be curated by matching headlines
   * against /point streak|on fire|closing in on/ — which works exactly until
   * a writer adds a second way of saying it, and then a whole class of league
   * chatter silently reappears on the GM's desk. Additive/optional for save
   * compat (older saves simply have nothing tagged).
   */
  reach?: 'ambient' | 'ownClub'
}

/** A prospect card embedded in the weekly scout digest (playtest #10). */
export interface DigestProspectRef {
  playerId: string
  name: string
  age: number
  position: string
  teamAbbr: string
  grade: 'A+' | 'A' | 'B' | 'C'
  reason: string
  scoutName: string
  faceId?: string
}

/**
 * The salience at which a story is BREAKING.
 *
 * A7 (playtest 2026-08-26): the tag "is applied too loosely to mean anything".
 * Measured over four simmed seasons it landed on 21 inbox items — and nine of
 * those were social posts from an analytics bot, tagged purely because the
 * story PATTERN was firing for the first time in the save. Early in a save
 * every pattern is firing for the first time, so `rare` was a novelty flag
 * doing duty as an importance flag.
 *
 * The bar is now set where the game's hand-authored tentpoles actually sit:
 * an all-time record broken (95), a playoff berth clinched (90), deadline day
 * (88), elimination (85), a blockbuster trade column (85). Those are the five
 * or six things a season, and that is what the word should mean.
 */
export const BREAKING_SALIENCE = 85

/**
 * Big enough that a story living on the Feed must still cross the GM's desk.
 * Deliberately a LOWER bar than BREAKING: reaching the inbox is about
 * relevance, wearing the tag is about magnitude. (This is the rule the old
 * isBreakingNews served, kept intact so inbox admission is unchanged.)
 */
export const FEED_TO_INBOX_SALIENCE = 80

/** Should a Feed story be promoted into the inbox on size alone? */
export function feedStoryReachesInbox(item: Pick<NewsItem, 'salience' | 'rare'>): boolean {
  return item.rare === true || (item.salience ?? 0) >= FEED_TO_INBOX_SALIENCE
}

/**
 * Does this story wear the BREAKING tag?
 *
 * Two rules, both of them about meaning what it says:
 *  - A social post is never breaking news. A tweet is a REACTION to news; the
 *    report is the story. "@puckmodel · BREAKING" was the tell.
 *  - Novelty is not magnitude. `rare` no longer qualifies on its own.
 */
export function isBreakingNews(item: Pick<NewsItem, 'salience' | 'rare' | 'channel'>): boolean {
  if (item.channel === 'feed') return false
  return (item.salience ?? 0) >= BREAKING_SALIENCE
}
