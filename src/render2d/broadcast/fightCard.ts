/**
 * The FIGHT lower-third's result line (broadcast overlay). Scorebug voice:
 * terse, the fact and nothing else, read off the engine's `fight` event
 * (src/engine/agent/fight.ts): who went down and how, the landed punches, or
 * a draw. Variety by stable hash of the fight, never Math.random.
 */
import type { FightEvent } from '@domain'

export interface FightCardFacts {
  /** Surnames, as the card prints them. */
  winner: string | null
  loser: string | null
  ending: FightEvent['ending']
  /** Landed punches, the winner's first (home first in a draw). */
  landedW: number
  landedL: number
  /** The hand that put him down (a knockdown only). */
  hand: 'R' | 'L' | null
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/**
 * Result lines per ending. Every line is true for every fight that can pick it:
 * knockdown lines need a winner and the deciding hand, takedown lines a winner,
 * the decision lines a winner who landed more, the draw lines no winner.
 */
const POOL: Record<'knockdown' | 'takedown' | 'decision' | 'edge' | 'draw', Array<(f: FightCardFacts) => string>> = {
  knockdown: [
    (f) => `${f.winner} drops ${f.loser} with a ${f.hand === 'L' ? 'left' : 'right'}`,
    (f) => `${f.loser} goes down. ${f.winner} lands ${f.landedW}`,
    (f) => `${f.winner} by knockdown, ${f.landedW} to ${f.landedL} on landed punches`,
    (f) => `A ${f.hand === 'L' ? 'left' : 'right'} from ${f.winner} puts ${f.loser} on the ice`,
  ],
  takedown: [
    (f) => `${f.winner} wrestles ${f.loser} to the ice`,
    (f) => `${f.loser} goes down in the clinch`,
    (f) => `${f.winner} gets him down. Landed ${f.landedW} to ${f.landedL}`,
    (f) => `Takedown, ${f.winner}`,
  ],
  decision: [
    (f) => `${f.winner} lands ${f.landedW} to ${f.landedL}`,
    (f) => `${f.winner} has the better of it, ${f.landedW} to ${f.landedL} landed`,
    (f) => `Both men spent. Edge ${f.winner}, ${plural(f.landedW, 'punch', 'punches')} landed`,
  ],
  // he had the better of it on the heavier punches, not the count
  edge: [
    (f) => `${f.winner} has the better of it`,
    (f) => `Edge ${f.winner}, the heavier punches`,
    (f) => `${f.winner} lands the harder shots`,
  ],
  draw: [
    (f) => `Even. ${f.landedW} landed apiece`,
    (f) => `Both men spent. ${f.landedW} to ${f.landedL} on landed punches`,
    () => `Nobody wins that one`,
  ],
}

function bucket(f: FightCardFacts): keyof typeof POOL {
  if (!f.winner) return 'draw'
  if (f.ending === 'knockdown' && f.hand) return 'knockdown'
  if (f.ending === 'takedown' || f.ending === 'knockdown') return 'takedown'
  return f.landedW > f.landedL ? 'decision' : 'edge'
}

/** The card's result line (`seed` = a stable hash of the fight). */
export function fightResultLine(f: FightCardFacts, seed: number): string {
  const b = bucket(f)
  let pool = POOL[b]
  // "Even. N landed apiece" only when they really are level.
  if (b === 'draw' && f.landedW !== f.landedL) pool = pool.slice(1)
  return pool[Math.abs(seed) % pool.length]!(f)
}

/** Facts for the card from the engine's event (`surname` maps an id to the printed name). */
export function fightCardFacts(ev: FightEvent, surname: (id: string) => string): FightCardFacts {
  const w = ev.winner as string | null
  const homeWon = w === (ev.home as string)
  const l = w ? (homeWon ? (ev.away as string) : (ev.home as string)) : null
  // the deciding punch: the last landed one before the man went down
  let hand: 'R' | 'L' | null = null
  if (ev.ending === 'knockdown') {
    const down = ev.beats.find((b) => b.kind === 'down')
    for (const b of ev.beats) if (b.kind === 'punch' && b.landed && (!down || b.at <= down.at) && b.by !== down?.by) hand = b.hand ?? null
  }
  return {
    winner: w ? surname(w) : null,
    loser: l ? surname(l) : null,
    ending: ev.ending,
    landedW: w ? (homeWon ? ev.landed.home : ev.landed.away) : ev.landed.home,
    landedL: w ? (homeWon ? ev.landed.away : ev.landed.home) : ev.landed.away,
    hand,
  }
}
