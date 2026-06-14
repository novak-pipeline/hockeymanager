import { describe, expect, it } from 'vitest'
import type { Player } from '@domain'
import { generateLeague } from '@data'
import { buildProgressRows, progressRow } from './progressView'

function players(seed: number): Player[] {
  return [...generateLeague({ seed }).players.values()]
}

describe('progressView', () => {
  it('reads season deltas + trend direction', () => {
    const p = { ...players(1)[0]!, seasonDevAccrued: 3, seasonCeilDrift: -2, devTrend: 3, ceilingTrend: -2 } as Player
    const row = progressRow(p)
    expect(row.overallDelta).toBe(3)
    expect(row.potentialDelta).toBe(-2)
    expect(row.overallTrend).toBe('up')
    expect(row.potentialTrend).toBe('down')
  })

  it('orders biggest risers first', () => {
    const pool = players(2).slice(0, 12).map((p, i) => ({ ...p, seasonDevAccrued: (i % 5) - 2, devTrend: (i % 5) - 2 } as Player))
    const rows = buildProgressRows(pool)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.overallDelta).toBeGreaterThanOrEqual(rows[i]!.overallDelta)
    }
  })

  it('treats missing dev data as steady', () => {
    const row = progressRow(players(3)[0]!)
    expect(row.overallTrend).toBe('steady')
    expect(row.overallDelta).toBe(0)
  })
})
