import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSET_FILTERS, activeAssetFilterCount, browseAssets, filterAssets, groupAssets, sortAssets, type AssetRow,
} from './tradeAssets'

const row = (id: string, over: Partial<AssetRow> = {}): AssetRow => ({
  playerId: id, name: `P ${id}`, position: 'C', age: 27, overall: 70, salary: 2e6, yearsRemaining: 3,
  noTradeClause: false, tradeValue: 10, ...over,
} as AssetRow)

const org: AssetRow[] = [
  row('c1', { overall: 82, tradeValue: 40, salary: 8e6 }),
  row('lw', { position: 'W' as AssetRow['position'], overall: 74, tradeValue: 20, yearsRemaining: 1 }),
  row('d1', { position: 'D', overall: 78, tradeValue: 30, noTradeClause: true }),
  row('g1', { position: 'G', overall: 76, tradeValue: 25 }),
  row('ahl1', { assetClass: 'ahl', clubAbbr: 'WBS', age: 22, overall: 58, tradeValue: 6, salary: 9e5 }),
  row('ahl2', { assetClass: 'ahl', clubAbbr: 'WBS', age: 28, overall: 60, tradeValue: 3, salary: 8e5 }),
  row('jr', { assetClass: 'junior', age: 18, overall: 45, salary: 0, yearsRemaining: 0, tradeValue: 8 }),
]

describe('trade asset browser', () => {
  it('groups the big club by position, then the AHL and the rights, the farm collapsed', () => {
    const g = groupAssets(org)
    expect(g.map((x) => [x.id, x.rows.length, x.collapsedByDefault])).toEqual([
      ['F', 2, false], ['D', 1, false], ['G', 1, false], ['ahl', 2, true], ['junior', 1, true],
    ])
  })

  it('sorts by value, rating, age, cap hit or years', () => {
    expect(sortAssets(org, 'value', true)[0]!.playerId).toBe('c1')
    expect(sortAssets(org, 'age', false)[0]!.playerId).toBe('jr')
    expect(sortAssets(org, 'cap', true)[0]!.playerId).toBe('c1')
    expect(sortAssets(org, 'years', false)[0]!.playerId).toBe('jr')
    expect(sortAssets(org, 'rating', true).map((r) => r.playerId).slice(0, 2)).toEqual(['c1', 'd1'])
  })

  it('filters: search, position, tradeable, rating, cap, prospects, expiring', () => {
    const ids = (f: Partial<typeof DEFAULT_ASSET_FILTERS>): string[] => filterAssets(org, { ...DEFAULT_ASSET_FILTERS, ...f }).map((r) => r.playerId)
    expect(ids({ search: 'p g' })).toEqual(['g1'])
    expect(ids({ pos: 'D' })).toEqual(['d1'])
    expect(ids({ pos: 'F' })).toEqual(['c1', 'lw', 'ahl1', 'ahl2', 'jr'])
    expect(ids({ tradeableOnly: true })).not.toContain('d1')
    // Stars, as the rows show them: 76+ is four stars.
    expect(ids({ minRating: '4' })).toEqual(['c1', 'd1', 'g1'])
    expect(ids({ maxCap: '1' })).toEqual(['ahl1', 'ahl2', 'jr'])
    expect(ids({ prospectsOnly: true })).toEqual(['ahl1', 'jr'])
    // Signed through next season at most; an unsigned junior is not "expiring".
    expect(ids({ expiring: true })).toEqual(['lw'])
  })

  it('a man already in the deal is never filtered out of view', () => {
    const groups = browseAssets(org, { ...DEFAULT_ASSET_FILTERS, pos: 'G' }, new Set(['c1']))
    expect(groups.flatMap((g) => g.rows.map((r) => r.playerId)).sort()).toEqual(['c1', 'g1'])
  })

  it('counts active filters (sort does not count)', () => {
    expect(activeAssetFilterCount(DEFAULT_ASSET_FILTERS)).toBe(0)
    expect(activeAssetFilterCount({ ...DEFAULT_ASSET_FILTERS, sort: 'age', pos: 'D', expiring: true })).toBe(2)
  })
})
