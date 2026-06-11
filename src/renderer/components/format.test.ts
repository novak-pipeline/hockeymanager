import { describe, expect, it } from 'vitest'
import { crestColor, fmtDate, fmtMoney, fmtToi } from './format'

describe('fmtDate', () => {
  it('formats ISO dates as day-month-year', () => {
    expect(fmtDate('2026-10-12')).toBe('12 Oct 2026')
    expect(fmtDate('2027-01-03')).toBe('3 Jan 2027')
  })

  it('passes malformed input through unchanged', () => {
    expect(fmtDate('soon')).toBe('soon')
    expect(fmtDate('2026-13-01')).toBe('2026-13-01')
  })
})

describe('fmtMoney', () => {
  it('formats millions compactly', () => {
    expect(fmtMoney(3_500_000)).toBe('$3.5M')
    expect(fmtMoney(2_000_000)).toBe('$2M')
    expect(fmtMoney(12_750_000)).toBe('$12.8M')
    expect(fmtMoney(104_000_000)).toBe('$104M')
  })

  it('formats thousands and small amounts', () => {
    expect(fmtMoney(850_000)).toBe('$850K')
    expect(fmtMoney(999)).toBe('$999')
    expect(fmtMoney(0)).toBe('$0')
  })

  it('handles negative amounts (cap overruns)', () => {
    expect(fmtMoney(-2_000_000)).toBe('-$2M')
  })
})

describe('fmtToi', () => {
  it('formats seconds as M:SS', () => {
    expect(fmtToi(754)).toBe('12:34')
    expect(fmtToi(60)).toBe('1:00')
    expect(fmtToi(5)).toBe('0:05')
  })
})

describe('crestColor', () => {
  it('is deterministic per team id and emits hsl()', () => {
    expect(crestColor('team-1')).toBe(crestColor('team-1'))
    expect(crestColor('team-1')).toMatch(/^hsl\(\d+ 45% 36%\)$/)
    expect(crestColor('team-1')).not.toBe(crestColor('team-2'))
  })
})
