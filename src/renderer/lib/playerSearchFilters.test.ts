import { describe, expect, it } from 'vitest'
import type { OffseasonNeedView } from '../../engine/career/views'
import {
  DEFAULT_FILTERS, filterChips, filtersToQuery, loadSavedSearches, needToFilters, presetForNeed,
  storeSavedSearch, deleteSavedSearch, moreFilterCount, ATTRIBUTE_GROUPS, attrLabel, attrAbbr, type KeyValueStore,
} from './playerSearchFilters'

const need = (over: Partial<OffseasonNeedView> = {}): OffseasonNeedView => ({
  id: 'D-2', kind: 'slot', label: 'a 2nd-pair LHD', why: 'x', severity: 2, group: 'D', candidates: [],
  criteria: { group: 'D', hand: 'L', minStars: 4 },
  ...over,
})

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }
}

describe('need → search criteria', () => {
  it('a 2nd-pair LHD: D, shoots L, a 4-star floor (the tier, not the hidden number), cap hit within the room', () => {
    const f = needToFilters(need(), 'all', 6_250_000)!
    expect(f.positions).toEqual(['D'])
    expect(f.hand).toBe('L')
    expect(f.minCur).toBe('4')
    expect(f.maxSalary).toBe('6.2') // rounded down: never lets in a man over the room
    expect(f.excludeOwn).toBe(true)
    const q = filtersToQuery(f)
    expect(q.positions).toEqual(['D'])
    expect(q.handedness).toBe('L')
    expect(q.minCurrentStars).toBe(4)
    expect(q.maxSalary).toBe(6_200_000)
  })

  it('availability follows the desk', () => {
    expect(needToFilters(need(), 'fa', 5e6)!.contracts).toEqual(['freeAgent'])
    expect(needToFilters(need(), 'trade', 5e6)!.contracts).toEqual(['signed', 'expiring'])
    expect(needToFilters(need(), 'all', 5e6)!.contracts).toEqual(['freeAgent', 'signed', 'expiring'])
  })

  it('age suits the role, a centre need searches centres, a forward need any forward', () => {
    const top = needToFilters(need({ id: 'F-top', group: 'F', label: 'a top-six centre', criteria: { group: 'F', position: 'C', minStars: 4.5 } }), 'all', 5e6)!
    expect(top.positions).toEqual(['C'])
    expect([top.ageMin, top.ageMax]).toEqual(['21', '33'])
    const bot = needToFilters(need({ id: 'F-bot', group: 'F', label: 'a fourth-line forward', criteria: { group: 'F', minStars: 3 } }), 'all', 5e6)!
    expect(bot.positions).toEqual(['F'])
    expect(bot.hand).toBe('')
    expect([bot.ageMin, bot.ageMax]).toEqual(['20', '36'])
  })

  it('no room: no cap bound; a cap need has no search', () => {
    expect(needToFilters(need(), 'all', -1e6)!.maxSalary).toBe('')
    expect(needToFilters(need({ id: 'cap', kind: 'cap', criteria: undefined as never }), 'all', 0)).toBeNull()
  })

  it('the preset carries the need for the banner, and its chips are removable one by one', () => {
    const p = presetForNeed(need(), 'trade', 4e6, 42)!
    expect(p.origin).toEqual({ needId: 'D-2', label: 'a 2nd-pair LHD', context: 'trade' })
    expect(p.nonce).toBe(42)
    const chips = filterChips(p.filters)
    const labels = chips.map((c) => c.label)
    expect(labels).toEqual(expect.arrayContaining(['D', 'Shoots L', 'Current 4★+', 'Cap hit ≤ $4.0M', 'Under contract', 'Expiring', 'Age 20–34']))
    const noHand = chips.find((c) => c.id === 'hand')!.clear(p.filters)
    expect(noHand.hand).toBe('')
    expect(noHand.minCur).toBe('4')
    const noSigned = chips.find((c) => c.id === 'c-signed')!.clear(p.filters)
    expect(noSigned.contracts).toEqual(['expiring'])
  })
})

describe('search filters → query', () => {
  it('defaults send only the sort and the own-org exclusion', () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toEqual({ sort: 'potential', desc: true, excludeOwn: true })
  })

  it('the More filters map one to one', () => {
    const q = filtersToQuery({
      ...DEFAULT_FILTERS, gpMin: '20', ptsMax: '40', yearsLeftMax: '1', tradeAvailable: true, health: 'healthy',
      waiverExempt: true, expiry: 'UFA', heightMin: '185', weightMax: '100', archetypes: ['sniper'],
      attrs: [{ key: 'speed', op: 'gte', value: '15' }, { key: 'checking', op: 'gte', value: '14' }, { key: 'agility', op: 'lte', value: '' }],
    })
    expect(q).toMatchObject({
      gpMin: 20, pointsMax: 40, yearsLeftMax: 1, tradeAvailable: true, health: 'healthy', waiverExemptOnly: true,
      expiryStatus: 'UFA', heightMin: 185, weightMax: 100, archetypes: ['sniper'],
    })
    // A half-built rule (no value yet) is not sent.
    expect(q.attributes).toEqual([{ key: 'speed', op: 'gte', value: 15 }, { key: 'checking', op: 'gte', value: 14 }])
  })

  it('"Fills a need" turns the needs into an any-of', () => {
    const f = { ...DEFAULT_FILTERS, fillsNeed: true }
    expect(filtersToQuery(f).anyOf).toBeUndefined() // needs not loaded yet
    const q = filtersToQuery(f, [{ group: 'D', hand: 'L', minStars: 4 }, { group: 'G', minStars: 3.5 }])
    expect(q.anyOf).toEqual([
      { positions: ['D'], handedness: 'L', minCurrentStars: 4 },
      { positions: ['G'], minCurrentStars: 3.5 },
    ])
  })

  it('counts what is set under More filters', () => {
    expect(moreFilterCount(DEFAULT_FILTERS)).toBe(0)
    expect(moreFilterCount({ ...DEFAULT_FILTERS, gpMin: '5', gpMax: '9', waiverExempt: true })).toBe(2)
  })
})

describe('attribute names', () => {
  it("are the profile's own, grouped as the profile groups them", () => {
    expect(ATTRIBUTE_GROUPS.map((g) => g.group)).toEqual(['Technical', 'Physical', 'Mental', 'Defensive', 'Goaltending'])
    expect(attrLabel('checking')).toBe('Checking')
    expect(attrLabel('positioning')).toBe('Positioning')
    expect(attrLabel('positioningG')).toBe('Positioning (G)')
    expect(attrAbbr('wristShot')).toBe('WS')
    expect(attrAbbr('checking')).toBe('Checking')
    expect(attrAbbr('anticipation')).toBe('Antic.')
    expect(attrAbbr('positioningG')).toBe('Posit. G')
    const chip = filterChips({ ...DEFAULT_FILTERS, attrs: [{ key: 'checking', op: 'gte', value: '14' }] })
    expect(chip.map((c) => c.label)).toContain('Checking ≥ 14')
  })
})

describe('saved searches', () => {
  it('persist per career, replace by name, delete, and fill new fields on old entries', () => {
    const s = memStore()
    let list = storeSavedSearch(s, 'k1', [], { name: 'Big RHD', filters: { ...DEFAULT_FILTERS, positions: ['D'], hand: 'R' } })
    list = storeSavedSearch(s, 'k1', list, { name: 'Big RHD', filters: { ...DEFAULT_FILTERS, positions: ['D'], hand: 'R', heightMin: '190' } })
    expect(list).toHaveLength(1)
    expect(loadSavedSearches(s, 'k1')[0]!.filters.heightMin).toBe('190')
    expect(loadSavedSearches(s, 'k2')).toEqual([])
    // An entry saved before a filter existed still loads, with the default.
    s.setItem('hockey.savedSearches.k3', JSON.stringify([{ name: 'old', filters: { text: 'x' } }]))
    const old = loadSavedSearches(s, 'k3')[0]!
    expect(old.filters.text).toBe('x')
    expect(old.filters.attrs).toEqual([])
    expect(deleteSavedSearch(s, 'k1', list, 'Big RHD')).toEqual([])
    expect(loadSavedSearches(s, 'k1')).toEqual([])
    // Junk in storage never throws.
    s.setItem('hockey.savedSearches.bad', '{nope')
    expect(loadSavedSearches(s, 'bad')).toEqual([])
  })
})
