/**
 * International tournaments, told over their real window (loop audit F18).
 *
 * The World Juniors used to resolve on its first day: "Canada win gold" on
 * Dec 26 while the calendar painted the tournament through Jan 5. The
 * tournament is still simulated in one go (the result is fixed the day it
 * opens, which keeps it deterministic and save-safe), but the WORLD only
 * learns it round by round: the opening, the knockout field, the semi-final
 * four, the final pairing, and the gold on the last day. Medals, awards,
 * stats and scouting land with the final, not before it.
 *
 * Every beat is derived from the finished record's placing order, which IS
 * the bracket: places 1–4 are the semi-finalists (1–2 the finalists, 3–4 the
 * bronze game), 5–8 the quarter-final losers, the rest went out in the group.
 * Pure; JSON-safe output.
 */
import type { IntlEventKind, IntlEventRecord, IntlPlayerLine } from '@domain'

export interface IntlBeat {
  /** Match day (from Oct 1) the beat is published on. */
  day: number
  headline: string
  body: string
}

/** Days from the opening to the final, per event. */
export const INTL_LENGTH_DAYS: Record<IntlEventKind, number> = {
  worldJuniors: 10, // Dec 26 → Jan 5
  olympics: 16,
  nationsCup: 9,
}

function list(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** "Your players: X (Canada), Y (Sweden)" for the men of yours whose nation is in `nations`. */
function yoursIn(nations: readonly string[], yours: readonly IntlPlayerLine[]): string {
  const alive = yours.filter((l) => nations.includes(l.nation))
  return alive.map((l) => `${l.name} (${l.nation})`).join(', ')
}

/**
 * The beats between the opening and the final (the final itself is the
 * existing result story, published by the career when it applies the event).
 */
export function intlStageBeats(args: {
  kind: IntlEventKind
  record: IntlEventRecord
  eventLabel: string
  startDay: number
  /** Lines of the GM's own players at the tournament (any nation). */
  yours: readonly IntlPlayerLine[]
}): IntlBeat[] {
  const { kind, record: r, eventLabel, startDay, yours } = args
  const s = r.standings
  const len = INTL_LENGTH_DAYS[kind]
  const beats: IntlBeat[] = []
  const nations = s.length

  const yourLine = yours.length > 0
    ? ` Your players there: ${yours.map((l) => `${l.name} (${l.nation})`).join(', ')}.`
    : ''
  beats.push({
    day: startDay,
    headline: `The ${eventLabel} ${kind === 'nationsCup' ? 'opens' : 'open'}`,
    body: `${nations} nations, ${len + 1} days, one gold medal.${yourLine}`,
  })

  if (kind === 'nationsCup') {
    // Round robin, then the top two meet in the final.
    if (s.length >= 2) {
      beats.push({
        day: startDay + len - 1,
        headline: `${s[0]} and ${s[1]} meet for the Nations Cup`,
        body: `The round robin is done. ${s[0]} and ${s[1]} play the final tomorrow; ` +
          `${list(s.slice(2))} ${s.length - 2 === 1 ? 'is' : 'are'} out.`,
      })
    }
    return beats
  }

  const qf = s.slice(0, 8)
  const groupOut = s.slice(8)
  if (qf.length === 8) {
    const alive = yoursIn(qf, yours)
    const gone = yoursIn(groupOut, yours)
    beats.push({
      day: startDay + Math.round(len * 0.5),
      headline: `${eventLabel}: the quarter-finals are set`,
      body: `Eight nations go on: ${list(qf)}.` +
        (groupOut.length > 0 ? ` ${list(groupOut)} ${groupOut.length === 1 ? 'is' : 'are'} out after the group stage.` : '') +
        (alive ? ` Still playing for you: ${alive}.` : '') +
        (gone ? ` Heading home: ${gone}.` : ''),
    })
  }
  const sf = s.slice(0, 4)
  const qfOut = s.slice(4, 8)
  if (sf.length === 4) {
    const alive = yoursIn(sf, yours)
    const gone = yoursIn(qfOut, yours)
    beats.push({
      day: startDay + Math.round(len * 0.7),
      headline: `${eventLabel}: ${list(sf)} reach the semi-finals`,
      body: `The quarter-finals sent ${list(qfOut)} home.` +
        (alive ? ` Still playing for you: ${alive}.` : '') +
        (gone ? ` Out in the quarters: ${gone}.` : ''),
    })
    beats.push({
      day: startDay + len - 1,
      headline: `${s[0]} and ${s[1]} play for ${kind === 'olympics' ? 'Olympic gold' : 'gold'}`,
      body: `${s[0]} and ${s[1]} won their semi-finals and meet in the final tomorrow. ` +
        `${s[2]} and ${s[3]} play for bronze.` +
        (yoursIn([s[0]!, s[1]!], yours) ? ` In the final for you: ${yoursIn([s[0]!, s[1]!], yours)}.` : ''),
    })
  }
  return beats
}
