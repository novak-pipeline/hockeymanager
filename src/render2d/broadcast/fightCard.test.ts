import { describe, expect, it } from 'vitest'
import type { FightEvent } from '@domain'
import { fightCardFacts, fightResultLine, type FightCardFacts } from './fightCard'

const BANNED = /delve|testament|tapestry|showcase|pivotal|crucial|underscor|highlight|game-changer|elevat|not just|undefined|NaN|\{|\}/i

const base: FightCardFacts = { winner: 'Reaves', loser: 'Lucic', ending: 'tired', landedW: 5, landedL: 3, hand: null }

describe('FIGHT card result line', () => {
  it('every variant of every bucket fills its slots and is true to the facts', () => {
    const cases: FightCardFacts[] = [
      { ...base, ending: 'knockdown', hand: 'R' },
      { ...base, ending: 'knockdown', hand: 'L' },
      { ...base, ending: 'takedown' },
      { ...base },
      { ...base, landedW: 2, landedL: 4 },
      { ...base, winner: null, loser: null, landedW: 3, landedL: 3 },
      { ...base, winner: null, loser: null, landedW: 4, landedL: 2 },
    ]
    for (const f of cases) {
      const seen = new Set<string>()
      for (let s = 0; s < 12; s++) seen.add(fightResultLine(f, s))
      expect(seen.size).toBeGreaterThanOrEqual(2)
      for (const line of seen) {
        expect(line).not.toMatch(BANNED)
        if (!f.winner) expect(line).not.toMatch(/Reaves|Lucic/)
        // a man who landed fewer is never credited with out-landing him
        if (f.winner && f.landedW <= f.landedL) expect(line).not.toMatch(/lands \d+ to/)
        // "apiece" only when level
        if (/apiece/.test(line)) expect(f.landedW).toBe(f.landedL)
        if (f.ending === 'knockdown' && /left|right/.test(line)) expect(line).toContain(f.hand === 'L' ? 'left' : 'right')
        if (f.ending !== 'tired') expect(line).not.toMatch(/spent/)
      }
    }
  })

  it('facts come off the engine event: winner first, the deciding hand', () => {
    const ev = {
      type: 'fight', t: 0, period: 1, home: 'h', away: 'a', pos: { x: 0, y: 0 }, separateAt: 10, boxAt: 12, durationS: 17,
      ending: 'knockdown', winner: 'a', down: 'h', thrown: { home: 4, away: 6 }, landed: { home: 1, away: 4 }, injured: null, cause: 'code',
      beats: [
        { kind: 'punch', at: 3, by: 'away', hand: 'R', landed: true },
        { kind: 'punch', at: 4, by: 'home', hand: 'R', landed: true },
        { kind: 'punch', at: 5, by: 'away', hand: 'L', landed: true },
        { kind: 'down', at: 5.25, by: 'home', how: 'punch' },
      ],
    } as unknown as FightEvent
    const f = fightCardFacts(ev, (id) => (id === 'h' ? 'Home' : 'Away'))
    expect(f).toMatchObject({ winner: 'Away', loser: 'Home', landedW: 4, landedL: 1, hand: 'L', ending: 'knockdown' })
  })
})
