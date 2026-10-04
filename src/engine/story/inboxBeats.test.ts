import { describe, expect, it } from 'vitest'
import type { ContentUse, ContentVariant } from './contentEngine'
import { writeBeat } from './beatWriter'
import {
  ANNIVERSARY_POOL,
  CEILING_POOL,
  DELEGATED_MEETING_POOL,
  FIGHT_LINE_POOL,
  GAME_STORY_POOL,
  GAMES_MILESTONE_POOL,
  INJURY_POOL,
  PLAYER_NIGHT_POOL,
  RETURN_POOL,
  SCOUT_DIGEST_POOL,
  SCOUT_NOTE_POOL,
  SCOUT_REPORT_POOL,
  TRADE_SLOT_POOL,
  OFFER_TABLED_POOL,
  INCOMING_OFFER_POOL,
  AGM_PASS_POOL,
  UFA_SIGNING_POOL,
  injuryBand,
  injuryNoun,
  moneyWords,
  roleInWords,
} from './inboxBeats'
import { isBareScoreline } from '@engine/career/autopilot/flavorAudit'

/** The slots each pool documents. A variant using anything else renders a
 *  literal "{slot}" in the GM's inbox. */
const POOLS: Array<[string, ContentVariant[], string[]]> = [
  ['GAME_STORY', GAME_STORY_POOL, ['us', 'opp', 'score', 'deficit', 'lead', 'goalie', 'saves', 'shotsAgainst', 'goalsAgainst', 'oppShots']],
  ['PLAYER_NIGHT', PLAYER_NIGHT_POOL, ['name', 'namePoss', 'opp', 'score', 'goals', 'assists', 'pts', 'saves', 'shotsAgainst']],
  ['INJURY', INJURY_POOL, ['name', 'games', 'weeks', 'injury', 'area', 'opp']],
  ['RETURN', RETURN_POOL, ['name', 'rust']],
  ['DELEGATED_MEETING', DELEGATED_MEETING_POOL, ['first', 'n', 'total', 'delegate']],
  ['SCOUT_DIGEST', SCOUT_DIGEST_POOL, ['a', 'b', 'rest', 'total']],
  ['SCOUT_REPORT', SCOUT_REPORT_POOL, ['name', 'pos', 'age', 'role', 'club']],
  ['CEILING', CEILING_POOL, ['name', 'namePoss', 'role', 'age']],
  ['ANNIVERSARY', ANNIVERSARY_POOL, ['what', 'years']],
  ['GAMES_MILESTONE', GAMES_MILESTONE_POOL, ['name', 'n', 'nth', 'pos', 'team']],
  ['SCOUT_NOTE', SCOUT_NOTE_POOL, ['role', 'age', 'club']],
  ['FIGHT_LINE', FIGHT_LINE_POOL, ['ours', 'theirs', 'opp']],
  ['UFA_SIGNING', UFA_SIGNING_POOL, ['team', 'name', 'pos', 'age', 'years', 'term', 'aav', 'total']],
  ['TRADE_SLOT', TRADE_SLOT_POOL, ['name', 'caliber']],
  ['OFFER_TABLED', OFFER_TABLED_POOL, ['name', 'namePoss', 'years', 'term', 'aav', 'total', 'agent']],
  ['INCOMING_OFFER', INCOMING_OFFER_POOL, ['club', 'target', 'theirs']],
  ['AGM_PASS', AGM_PASS_POOL, ['agm', 'club', 'clubPoss', 'n', 'clubs']],
]

describe('inbox beat pools — integrity', () => {
  it('every variant uses only its documented slots, and ids are unique', () => {
    const ids = new Set<string>()
    for (const [name, pool, slots] of POOLS) {
      for (const v of pool) {
        expect(ids.has(v.id), `${name}: duplicate id ${v.id}`).toBe(false)
        ids.add(v.id)
        for (const t of [v.text, v.text2 ?? '']) {
          for (const m of t.matchAll(/\{([a-zA-Z]+)\}/g)) {
            expect(slots, `${name}/${v.id} uses {${m[1]}}`).toContain(m[1])
          }
        }
      }
    }
  })

  it('the dominance trap: every conditioned bucket is at least three deep', () => {
    // Under most-specific-wins a lone conditioned line wins EVERY time its
    // conditions hold — the "one headline 437 times" bug. Group by the exact
    // condition set and require siblings.
    for (const [name, pool] of POOLS) {
      const buckets = new Map<string, number>()
      for (const v of pool) {
        const key = JSON.stringify(Object.entries(v.conditions ?? {}).sort())
        buckets.set(key, (buckets.get(key) ?? 0) + 1)
      }
      for (const [key, n] of buckets) expect(n, `${name} bucket ${key}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('the most frequent triggers have 8+ variants at their base', () => {
    const base = (pool: ContentVariant[], cond: Record<string, unknown>): number =>
      pool.filter((v) => JSON.stringify(v.conditions ?? {}) === JSON.stringify(cond)).length
    for (const kind of ['comeback', 'blownLead', 'goalieRobbery', 'goalieShelled']) {
      expect(base(GAME_STORY_POOL, { kind }), kind).toBeGreaterThanOrEqual(8)
    }
    expect(base(PLAYER_NIGHT_POOL, { kind: 'hatTrick', won: true })).toBeGreaterThanOrEqual(8)
    expect(base(PLAYER_NIGHT_POOL, { kind: 'bigNight' })).toBeGreaterThanOrEqual(8)
    expect(base(PLAYER_NIGHT_POOL, { kind: 'shutout' })).toBeGreaterThanOrEqual(8)
    expect(base(SCOUT_REPORT_POOL, {})).toBeGreaterThanOrEqual(8)
    expect(base(UFA_SIGNING_POOL, {})).toBeGreaterThanOrEqual(8)
  })

  it('a one-shot headline never appears as a bare sentence with no subject', () => {
    // A variant with no slot at all in its headline renders identically for
    // every player and every game — the "same line 15 times" failure.
    for (const [name, pool] of POOLS) {
      if (name === 'SCOUT_NOTE' || name === 'FIGHT_LINE' || name === 'TRADE_SLOT') continue
      for (const v of pool) expect(/\{[a-zA-Z]+\}/.test(v.text), `${name}/${v.id}: "${v.text}"`).toBe(true)
    }
  })
})

describe('writeBeat', () => {
  it('rotates through a bucket before repeating, then falls back to the least recently used', () => {
    const ledger: ContentUse[] = []
    const seen: string[] = []
    for (let day = 1; day <= 9; day++) {
      const b = writeBeat({
        pool: GAME_STORY_POOL,
        ctx: { kind: 'blownLead', ot: false, playoff: false, lead: 2 },
        slots: { us: 'Us', opp: 'Them', score: '4-3', lead: '2', deficit: '0', goalie: 'G', saves: '20', shotsAgainst: '24', goalsAgainst: '4', oppShots: '24' },
        key: `k|${day}`,
        ledger,
        year: 2030,
        day,
      })!
      seen.push(b.variantId)
    }
    // Nine collapses, nine base variants: every one used once.
    expect(new Set(seen).size).toBe(9)
    // The tenth repeats the one used longest ago, never a random one.
    const tenth = writeBeat({
      pool: GAME_STORY_POOL,
      ctx: { kind: 'blownLead', ot: false, playoff: false, lead: 2 },
      slots: {},
      key: 'k|10',
      ledger,
      year: 2030,
      day: 10,
    })!
    expect(tenth.variantId).toBe(seen[0])
  })

  it('exhausting a pool inside ONE day still rotates (eighteen offers on the first morning of July)', () => {
    const ledger: ContentUse[] = []
    const ids: string[] = []
    for (let i = 0; i < 18; i++) {
      ids.push(writeBeat({
        pool: OFFER_TABLED_POOL, ctx: {}, slots: {}, key: `ot|p${i}`, ledger, year: 2026, day: 208,
      })!.variantId)
    }
    // Eight variants, eighteen offers: nobody gets a third turn before
    // everyone has had a second.
    const counts = new Map<string, number>()
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3)
    expect(counts.size).toBe(OFFER_TABLED_POOL.length)
  })

  it('money reads as words, not a spreadsheet cell', () => {
    expect(moneyWords(8_970_000)).toBe('$9 million')
    expect(moneyWords(3_850_000)).toBe('$3.9 million')
    expect(moneyWords(850_000)).toBe('$850,000')
  })

  it('the most specific story wins: an overtime collapse reads as one', () => {
    const b = writeBeat({
      pool: GAME_STORY_POOL,
      ctx: { kind: 'blownLead', ot: true, playoff: false, lead: 2 },
      slots: { us: 'Us', opp: 'Them', score: '4-3', lead: '2' },
      key: 'ot',
      ledger: [],
      year: 2030,
      day: 1,
    })!
    expect(b.variantId).toMatch(/^gs\.bl\.ot\./)
  })
})

describe('injury words', () => {
  it('turns engine notes into nouns that sit in a sentence', () => {
    expect(injuryNoun('flu')).toBe('the flu')
    expect(injuryNoun('tweaked his back')).toBe('a back injury')
    expect(injuryNoun('blocked a shot — bruised foot')).toBe('a bruised foot from a blocked shot')
    expect(injuryNoun('upper-body injury')).toBe('an upper-body injury')
    expect(injuryNoun('ankle sprain')).toBe('an ankle sprain')
  })

  it('bands follow the calendar', () => {
    expect(injuryBand(1)).toBe('dtd')
    expect(injuryBand(5)).toBe('short')
    expect(injuryBand(12)).toBe('weeks')
    expect(injuryBand(30)).toBe('long')
  })

  it('projection chips become words', () => {
    expect(roleInWords('Top-six F')).toBe('a top-six forward')
    expect(roleInWords('#1 D')).toBe('a No. 1 defenceman')
    expect(roleInWords('1B / Tandem')).toBe('a 1B goalie')
  })
})

describe('flavour audit — what counts as a story', () => {
  it('a bare scoreline is a record, not a story; a written result mail is', () => {
    expect(isBareScoreline({ headline: 'Day 12: Win 3-2 vs BOS', body: 'Boston Bruins 2 @ Florida Panthers 3.' })).toBe(true)
    expect(isBareScoreline({ headline: 'Day 12: OT loss 2-3 (OT) @ BOS', body: 'Florida Panthers 2 @ Boston Bruins 3 (OT).' })).toBe(true)
    expect(isBareScoreline({
      headline: 'Day 12: Win 3-2 vs BOS',
      body: 'Boston Bruins 2 @ Florida Panthers 3. Two points, honestly earned.',
    })).toBe(false)
    expect(isBareScoreline({ headline: 'Down 2, back to win it: 3-2 over Boston Bruins', body: 'Boston Bruins 2 @ Florida Panthers 3.' })).toBe(false)
  })
})
