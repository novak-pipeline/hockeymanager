import { describe, expect, it } from 'vitest'
import { buildOfferPrompt, parseOffer, describeOffer, type OfferBounds } from './offerParse'

const BOUNDS: OfferBounds = {
  minSalary: 750_000,
  maxSalary: 20_000_000, // cap room ceiling
  minYears: 1,
  maxYears: 8,
}

describe('buildOfferPrompt', () => {
  it('asks for strict JSON in whole dollars and anchors on the ask', () => {
    const p = buildOfferPrompt({ freeform: 'five years, under 7', askSalary: 7_500_000, askYears: 6, playerName: 'Alex Nyberg' })
    expect(p.system).toContain('WHOLE DOLLARS')
    expect(p.system).toContain('"salary"')
    expect(p.user).toContain('Alex Nyberg')
    expect(p.user).toContain('$7.50M')
    expect(p.user).toContain('five years, under 7')
  })
})

describe('parseOffer', () => {
  it('parses a clean JSON offer in whole dollars', () => {
    const o = parseOffer('{"salary":7000000,"years":5,"signingBonusPct":10,"clause":"full","twoWay":false}', BOUNDS)
    expect(o).toEqual({ salary: 7_000_000, years: 5, signingBonusPct: 10, clause: 'full', twoWay: false })
  })

  it('rescues a salary the model wrote in millions (7 → $7M)', () => {
    expect(parseOffer('{"salary":7,"years":4}', BOUNDS)?.salary).toBe(7_000_000)
    expect(parseOffer('{"salary":7.5,"years":4}', BOUNDS)?.salary).toBe(7_500_000)
    expect(parseOffer('{"salary":0.95,"years":2}', BOUNDS)?.salary).toBe(950_000)
  })

  it('clamps salary to the cap ceiling and the league floor', () => {
    expect(parseOffer('{"salary":99000000,"years":6}', BOUNDS)?.salary).toBe(20_000_000)
    expect(parseOffer('{"salary":100000,"years":6}', BOUNDS)?.salary).toBe(750_000)
  })

  it('rounds salary to 25k increments', () => {
    expect(parseOffer('{"salary":7010000,"years":3}', BOUNDS)?.salary).toBe(7_000_000)
    expect(parseOffer('{"salary":7040000,"years":3}', BOUNDS)?.salary).toBe(7_050_000)
  })

  it('clamps years to 1–8 and rounds', () => {
    expect(parseOffer('{"salary":5000000,"years":12}', BOUNDS)?.years).toBe(8)
    expect(parseOffer('{"salary":5000000,"years":0}', BOUNDS)?.years).toBe(1)
    expect(parseOffer('{"salary":5000000,"years":3.6}', BOUNDS)?.years).toBe(4)
  })

  it('snaps signing bonus to the allowed steps and validates the clause', () => {
    expect(parseOffer('{"salary":5000000,"years":3,"signingBonusPct":13}', BOUNDS)?.signingBonusPct).toBe(10)
    expect(parseOffer('{"salary":5000000,"years":3,"signingBonusPct":26}', BOUNDS)?.signingBonusPct).toBe(30)
    expect(parseOffer('{"salary":5000000,"years":3,"clause":"bogus"}', BOUNDS)?.clause).toBe('none')
    expect(parseOffer('{"salary":5000000,"years":3,"clause":"modified"}', BOUNDS)?.clause).toBe('modified')
  })

  it('tolerates prose and code fences around the JSON', () => {
    const raw = 'Sure! Here is the offer:\n```json\n{"salary": 6250000, "years": 4}\n```\nHope that works.'
    expect(parseOffer(raw, BOUNDS)).toMatchObject({ salary: 6_250_000, years: 4 })
  })

  it('coerces string numbers ("$7M"-ish JSON strings)', () => {
    // Model occasionally emits strings; digits are extracted.
    expect(parseOffer('{"salary":"7000000","years":"5"}', BOUNDS)).toMatchObject({ salary: 7_000_000, years: 5 })
  })

  it('returns null when no JSON / no core field is present (keeps the manual builder)', () => {
    expect(parseOffer('I have no idea', BOUNDS)).toBeNull()
    expect(parseOffer('', BOUNDS)).toBeNull()
    // JSON with neither salary nor years is not a usable offer.
    expect(parseOffer('{"clause":"full"}', BOUNDS)).toBeNull()
  })

  it('defaults twoWay to false unless explicitly true', () => {
    expect(parseOffer('{"salary":800000,"years":1}', BOUNDS)?.twoWay).toBe(false)
    expect(parseOffer('{"salary":800000,"years":1,"twoWay":true}', BOUNDS)?.twoWay).toBe(true)
  })
})

describe('describeOffer', () => {
  it('renders a compact human echo', () => {
    expect(describeOffer({ salary: 7_000_000, years: 5, signingBonusPct: 10, clause: 'full', twoWay: false }))
      .toBe('$7.00M × 5yr · 10% SB · no-move')
    expect(describeOffer({ salary: 950_000, years: 1, signingBonusPct: 0, clause: 'none', twoWay: true }))
      .toBe('$0.95M × 1yr · two-way')
  })
})
