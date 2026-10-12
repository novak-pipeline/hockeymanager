/**
 * Inbox hygiene (loop audit 3 F16, story audit 2026-10 §2): the inbox reached
 * 309 unread by June because every item stayed unread forever and every other
 * club's roster move was its own letter. FM files its news away; so does this.
 *
 *  - Priority: what deserves the GM's eye. High = a decision or its answer on
 *    HIS club (contracts, milestones, awards, the draft, the playoffs) or any
 *    big story (salience, first-of-its-kind). Low = colour (results, columns,
 *    the scouting stream, social posts). Normal = everything else.
 *  - Shelf life: unread mail files itself as read once it is older than its
 *    shelf (low 3 days, normal 10, high 30). Nothing is deleted; it stops
 *    counting against the pile. Date-based and deterministic, so it is the
 *    same answer whenever it is asked.
 *  - Digest: other clubs' routine news on one day (a retirement, a
 *    development note on someone else's player), tagged `digest` where it is
 *    written, arrives as ONE "Around the league" item, not five letters.
 *  - Prominence: high-priority unread mail is listed first.
 *
 * Pure; reads NewsItems, never writes prose beyond the digest's headline list.
 */
import type { NewsItem } from '@domain/news'
import { dayToDateISO } from './views'
import { shortDate } from '@engine/league/moraleMemory'

export type InboxPriority = 'high' | 'normal' | 'low'

/** Days unread mail of each priority stays unread before it files itself. */
export const INBOX_SHELF_DAYS: Record<InboxPriority, number> = { low: 3, normal: 10, high: 30 }

/** The salience at which any story is big enough to be high priority (the
 *  overlay's own stop bar, renderer/lib/cadence.ts STOP_SALIENCE). */
const BIG_STORY = 55

/** The calendar date an item belongs to. */
export function newsDate(n: Pick<NewsItem, 'dateISO' | 'year' | 'day'>): string {
  return n.dateISO ?? dayToDateISO(n.year, n.day)
}

/** Whole days from ISO date `a` to ISO date `b` (b later → positive). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)))
  const tb = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)))
  return Math.round((tb - ta) / 86_400_000)
}

const DECISION_CATEGORIES = new Set(['contract', 'milestone', 'award', 'draft', 'playoffs'])

export function inboxPriority(n: NewsItem, involvesUser: boolean): InboxPriority {
  if (n.rare === true || (n.salience ?? 0) >= BIG_STORY) return 'high'
  if (n.authorId !== undefined || n.channel === 'feed') return 'low'
  if (n.reach === 'ownClub' || n.reach === 'ambient') return 'low'
  if (n.press !== undefined) return 'low'
  if (n.category === 'result' || n.category === 'scouting') return 'low'
  if (involvesUser && DECISION_CATEGORIES.has(n.category)) return 'high'
  // The draft, awards night and the bracket are everybody's business.
  if (n.category === 'draft' || n.category === 'award' || n.category === 'playoffs') return 'high'
  return 'normal'
}

/** Unread mail older than its shelf files itself as read. Returns how many. */
export function fileStaleMail(
  items: readonly NewsItem[],
  todayISO: string,
  involvesUser: (n: NewsItem) => boolean,
): number {
  let filed = 0
  for (const n of items) {
    if (n.read) continue
    const age = daysBetween(newsDate(n), todayISO)
    if (age > INBOX_SHELF_DAYS[inboxPriority(n, involvesUser(n))]) {
      n.read = true
      filed++
    }
  }
  return filed
}

/** Is this other-club routine item folded into the day's digest? */
export function isDigestible(n: NewsItem, involvesUser: boolean): boolean {
  // Only churn tagged as such at the site it was written (never inferred).
  if (n.digest !== true || involvesUser) return false
  if (n.channel === 'feed' || n.press !== undefined || n.prospects !== undefined) return false
  if (n.category === 'result' || n.category === 'scouting') return false
  return inboxPriority(n, false) === 'normal'
}

export const DIGEST_PREFIX = 'dg-'

/**
 * Fold each day's other-club routine items into one "Around the league" item.
 * A day with a single such item keeps it as it is. The digest is read once
 * every item in it is read; marking it read marks them all (see
 * {@link digestMembers}). Order of `items` is preserved, the digest sitting
 * where its newest member sat.
 */
export function foldDigests(items: readonly NewsItem[], involvesUser: (n: NewsItem) => boolean): NewsItem[] {
  const groups = new Map<string, NewsItem[]>()
  for (const n of items) {
    if (!isDigestible(n, involvesUser(n))) continue
    const d = newsDate(n)
    const g = groups.get(d)
    if (g) g.push(n)
    else groups.set(d, [n])
  }
  const out: NewsItem[] = []
  const emitted = new Set<string>()
  for (const n of items) {
    if (!isDigestible(n, involvesUser(n))) { out.push(n); continue }
    const d = newsDate(n)
    const g = groups.get(d)!
    if (g.length < 2) { out.push(n); continue }
    if (emitted.has(d)) continue
    emitted.add(d)
    out.push(digestItem(d, g))
  }
  return out
}

function digestItem(date: string, members: NewsItem[]): NewsItem {
  const first = members[0]!
  const n = members.length
  return {
    id: `${DIGEST_PREFIX}${date}`,
    day: first.day,
    year: first.year,
    dateISO: date,
    category: 'league',
    headline: `Around the league, ${shortDate(date)}: ${n} ${n === 1 ? 'item' : 'items'} from other clubs`,
    body: members.map((m) => m.headline).join('\n'),
    read: members.every((m) => m.read),
  }
}

/** The member ids a digest id stands for. */
export function digestMembers(
  digestId: string,
  items: readonly NewsItem[],
  involvesUser: (n: NewsItem) => boolean,
): string[] {
  const date = digestId.slice(DIGEST_PREFIX.length)
  return items.filter((n) => newsDate(n) === date && isDigestible(n, involvesUser(n))).map((n) => n.id)
}
