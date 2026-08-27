import { describe, expect, it } from 'vitest'
import { compareSortValues, initialDirFor, sortColumns, sortRows } from './sortable'

interface Row { name: string; pts: number; savePct?: number }

const ROWS: Row[] = [
  { name: 'Östlund', pts: 41, savePct: 0.912 },
  { name: 'Byrne', pts: 41 },
  { name: 'Achterberg', pts: 77, savePct: 0.901 },
  { name: 'Delaney', pts: 12, savePct: 0.930 },
]

const COLS = sortColumns<Row>()([
  { key: 'name', label: 'Player', value: (r) => r.name },
  { key: 'pts', label: 'P', value: (r) => r.pts, align: 'right' },
  { key: 'savePct', label: 'SV%', value: (r) => r.savePct, align: 'right' },
  { key: 'actions', label: '' },
])

describe('compareSortValues', () => {
  it('orders numbers by direction', () => {
    expect(compareSortValues(1, 2, 'asc')).toBeLessThan(0)
    expect(compareSortValues(1, 2, 'desc')).toBeGreaterThan(0)
  })

  it('orders text with locale rules, not code points', () => {
    // A naive `<` puts every accented name after Z.
    expect(compareSortValues('Östlund', 'Zetterberg', 'asc')).toBeLessThan(0)
  })

  it('sinks absent values in BOTH directions', () => {
    for (const dir of ['asc', 'desc'] as const) {
      expect(compareSortValues(undefined, 5, dir)).toBeGreaterThan(0)
      expect(compareSortValues(5, null, dir)).toBeLessThan(0)
    }
    expect(compareSortValues(undefined, null, 'asc')).toBe(0)
  })

  it('treats NaN as absent rather than as a number', () => {
    expect(compareSortValues(Number.NaN, 0, 'desc')).toBeGreaterThan(0)
  })
})

describe('sortRows', () => {
  it('sorts descending by a numeric column', () => {
    expect(sortRows(ROWS, COLS, 'pts', 'desc').map((r) => r.name))
      .toEqual(['Achterberg', 'Östlund', 'Byrne', 'Delaney'])
  })

  it('is stable — ties keep source order', () => {
    // Östlund and Byrne are both on 41 and must not swap.
    expect(sortRows(ROWS, COLS, 'pts', 'asc').map((r) => r.name))
      .toEqual(['Delaney', 'Östlund', 'Byrne', 'Achterberg'])
  })

  it('keeps a goalie with no save percentage at the bottom of an ascending sort', () => {
    expect(sortRows(ROWS, COLS, 'savePct', 'asc').map((r) => r.name).at(-1)).toBe('Byrne')
    expect(sortRows(ROWS, COLS, 'savePct', 'desc').map((r) => r.name).at(-1)).toBe('Byrne')
  })

  it('leaves rows alone for a column with nothing to compare', () => {
    expect(sortRows(ROWS, COLS, 'actions', 'desc')).toEqual(ROWS)
    expect(sortRows(ROWS, COLS, null, 'desc')).toEqual(ROWS)
  })

  it('does not mutate the input', () => {
    const before = ROWS.map((r) => r.name)
    sortRows(ROWS, COLS, 'pts', 'asc')
    expect(ROWS.map((r) => r.name)).toEqual(before)
  })
})

describe('initialDirFor', () => {
  it('opens text columns A→Z and numeric columns best-first', () => {
    expect(initialDirFor(COLS.find((c) => c.key === 'name'), ROWS)).toBe('asc')
    expect(initialDirFor(COLS.find((c) => c.key === 'pts'), ROWS)).toBe('desc')
  })

  it('honours an explicit override', () => {
    expect(initialDirFor({ key: 'gaa', label: 'GAA', value: () => 2.4, initialDir: 'asc' }, ROWS)).toBe('asc')
  })

  it('skips leading blanks when reading a column type', () => {
    const rows: Row[] = [{ name: 'A', pts: 0 }, ...ROWS]
    expect(initialDirFor(COLS.find((c) => c.key === 'savePct'), rows)).toBe('desc')
  })
})
