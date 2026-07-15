import { describe, it, expect } from 'vitest'
import { buildSponsors, sponsorTotal, sponsorKindLabel } from './sponsors'

describe('sponsors — buildSponsors', () => {
  it('builds three deals (title/jersey/arena), deterministically per club', () => {
    const a = buildSponsors({ teamKey: 'TOR', stature: 70, fanInterest: 60 })
    const b = buildSponsors({ teamKey: 'TOR', stature: 70, fanInterest: 60 })
    expect(a.map((d) => d.kind)).toEqual(['title', 'jersey', 'arena'])
    expect(a).toEqual(b) // deterministic
    expect(a.every((d) => d.value > 0 && d.yearsLeft >= 1 && d.yearsLeft <= 4)).toBe(true)
  })

  it('the title deal is the biggest', () => {
    const d = buildSponsors({ teamKey: 'X', stature: 60, fanInterest: 60 })
    const byKind = Object.fromEntries(d.map((x) => [x.kind, x.value]))
    expect(byKind.title).toBeGreaterThan(byKind.jersey!)
    expect(byKind.jersey).toBeGreaterThan(byKind.arena!)
  })

  it('stature and fan interest both lift the total', () => {
    const lo = sponsorTotal(buildSponsors({ teamKey: 'X', stature: 40, fanInterest: 30 }))
    const hi = sponsorTotal(buildSponsors({ teamKey: 'X', stature: 90, fanInterest: 90 }))
    expect(hi).toBeGreaterThan(lo)
    // Fan interest alone moves it.
    const fanLo = sponsorTotal(buildSponsors({ teamKey: 'X', stature: 60, fanInterest: 20 }))
    const fanHi = sponsorTotal(buildSponsors({ teamKey: 'X', stature: 60, fanInterest: 95 }))
    expect(fanHi).toBeGreaterThan(fanLo)
  })

  it('labels each deal kind', () => {
    expect(sponsorKindLabel('title')).toMatch(/title/i)
    expect(sponsorKindLabel('arena')).toMatch(/arena/i)
  })
})
