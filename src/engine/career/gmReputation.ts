/**
 * GM REPUTATION — the anti-cheese system (owner, 2026-09-26: "the player can't
 * cheese by spamming offers or doing other things that would normally cost you
 * relationships").
 *
 * The laws (feedback: fun over realism):
 *  - Only exploit PATTERNS cost anything. A few reads, a counter or two, hard
 *    bargaining: all free. What costs is working one front office like a slot
 *    machine: gauge after gauge, offer after offer, in the same week.
 *  - Telegraphed. The first time you cross the line, somebody SAYS it (the GM
 *    on the phone, your AGM in the inbox) and it costs nothing. Only the next
 *    call costs.
 *  - Forgiving. The call log is a rolling week; the league-wide standing drifts
 *    back to neutral every week. Only a pattern across several clubs travels
 *    beyond the club you annoyed.
 *  - Never a lockout. Past the line, a GM still takes the call; he just stops
 *    telling you what he really thinks (a stock answer, not his verdict) and
 *    warms to you more slowly. Floors, not walls.
 *  - Upside. A GM whose word is good (deals done, promises kept) earns a better
 *    hearing everywhere: a small tilt in his favour at every table.
 *
 * Pure: the career layer records contacts and applies the costs.
 */

export type ContactKind = 'gauge' | 'offer'

export interface GmReputationState {
  /** League-wide standing, 0–100 (50 = unknown quantity). */
  standing: number
  /** Rolling log of the GM's calls to rival front offices (last 30 days). */
  contacts: Array<{ teamId: string; kind: ContactKind; year: number; day: number }>
  /** Warnings already given: `${teamId}|${kind}|${year}|${week}`. */
  warned: string[]
  /** Recent costs, for the GM Career screen and the "word gets around" check. */
  strikes: Array<{ teamId: string; kind: ContactKind; year: number; day: number }>
  /** The standing's story, newest last (bounded). */
  notes: Array<{ year: number; day: number; delta: number; text: string }>
  /** Last day the weekly drift toward neutral ran. */
  driftMark: { year: number; day: number } | null
}

export function createGmReputation(): GmReputationState {
  return { standing: 50, contacts: [], warned: [], strikes: [], notes: [], driftMark: null }
}

/** Free calls per club per rolling week, by kind. The last free one is where
 *  the warning is given; the one after that is the first that costs. */
export const FREE_PER_WEEK: Record<ContactKind, number> = { gauge: 4, offer: 5 }
/** Relationship cost with that club per call past the line. */
export const STRIKE_RELATIONSHIP: Record<ContactKind, number> = { gauge: -1, offer: -2 }
/** Distinct clubs struck within a month before word gets around the league. */
export const WORD_GETS_AROUND_CLUBS = 3

const WEEK = 7
const dayKey = (year: number, day: number): number => year * 1000 + day

export type ContactVerdict =
  /** Free, and nothing to say. */
  | { kind: 'ok' }
  /** Free, but the line has been reached: say so, once a week per club. */
  | { kind: 'warn' }
  /** Past the line: costs relationship with the club (and, as a pattern across
   *  clubs, standing), and a gauge gets a stock answer instead of his verdict. */
  | { kind: 'strike'; relationship: number; standing: number; wordGetsAround: boolean }

/**
 * Record a call to a rival front office and say what it costs. `today` is the
 * current (year, day); the log keeps a rolling 30 days.
 */
export function recordContact(
  s: GmReputationState,
  args: { teamId: string; kind: ContactKind; year: number; day: number },
): ContactVerdict {
  const now = dayKey(args.year, args.day)
  s.contacts = s.contacts.filter((c) => now - dayKey(c.year, c.day) < 30)
  const recent = s.contacts.filter(
    (c) => c.teamId === args.teamId && c.kind === args.kind && now - dayKey(c.year, c.day) < WEEK,
  ).length
  s.contacts.push({ teamId: args.teamId, kind: args.kind, year: args.year, day: args.day })
  const n = recent + 1
  const free = FREE_PER_WEEK[args.kind]
  if (n < free) return { kind: 'ok' }
  if (n === free) {
    const key = `${args.teamId}|${args.kind}|${args.year}|${Math.floor(args.day / WEEK)}`
    if (s.warned.includes(key)) return { kind: 'ok' }
    s.warned.push(key)
    if (s.warned.length > 60) s.warned = s.warned.slice(-60)
    return { kind: 'warn' }
  }
  // Past the line.
  s.strikes = s.strikes.filter((x) => now - dayKey(x.year, x.day) < 30)
  s.strikes.push({ teamId: args.teamId, kind: args.kind, year: args.year, day: args.day })
  const clubs = new Set(s.strikes.map((x) => x.teamId))
  const already = s.notes.some((x) => x.text.startsWith('Word gets around') && now - dayKey(x.year, x.day) < 30)
  const wordGetsAround = clubs.size >= WORD_GETS_AROUND_CLUBS && !already
  const standing = wordGetsAround ? -4 : 0
  if (standing !== 0) {
    adjustStanding(s, standing, args.year, args.day,
      `Word gets around: ${clubs.size} front offices say you work the phones like a slot machine.`)
  }
  return { kind: 'strike', relationship: STRIKE_RELATIONSHIP[args.kind], standing, wordGetsAround }
}

/** Calls to one club in the rolling week, by kind (a pure read: the telegraph). */
export function callsThisWeek(
  s: GmReputationState,
  args: { teamId: string; year: number; day: number },
): Record<ContactKind, number> {
  const now = dayKey(args.year, args.day)
  const out: Record<ContactKind, number> = { gauge: 0, offer: 0 }
  for (const c of s.contacts) {
    if (c.teamId === args.teamId && now - dayKey(c.year, c.day) < WEEK) out[c.kind]++
  }
  return out
}

/** Move the standing, clamped to [10, 90] — a floor, never a wall. */
export function adjustStanding(s: GmReputationState, delta: number, year: number, day: number, text: string): void {
  const before = s.standing
  s.standing = Math.max(10, Math.min(90, s.standing + delta))
  const moved = s.standing - before
  if (moved === 0) return
  s.notes.push({ year, day, delta: Math.round(moved * 10) / 10, text })
  if (s.notes.length > 30) s.notes = s.notes.slice(-30)
}

/**
 * The weekly drift toward neutral: a bad name heals at a point a week, a good
 * one fades at half that (it has to be kept up). Runs off the calendar, so a
 * skipped stretch catches up.
 */
export function driftStanding(s: GmReputationState, year: number, day: number): void {
  const mark = s.driftMark
  if (!mark || mark.year !== year) { s.driftMark = { year, day }; return }
  const weeks = Math.floor((day - mark.day) / WEEK)
  if (weeks <= 0) return
  s.driftMark = { year, day: mark.day + weeks * WEEK }
  for (let i = 0; i < weeks; i++) {
    if (s.standing < 50) s.standing = Math.min(50, s.standing + 1)
    else if (s.standing > 50) s.standing = Math.max(50, s.standing - 0.5)
  }
}

/** The standing's tilt on a rival's read of you (relationship points, ±8). */
export function standingTilt(standing: number): number {
  return Math.max(-8, Math.min(8, (standing - 50) * 0.2))
}

export function standingLabel(standing: number): string {
  return standing >= 70 ? 'Respected'
    : standing >= 58 ? 'Straight dealer'
    : standing >= 43 ? 'Unknown quantity'
    : standing >= 30 ? 'Wears on people'
    : 'Tire-kicker'
}
