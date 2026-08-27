/**
 * The trade block as a shopping list (playtest 2026-08-26 §D3).
 *
 * The block used to carry a name, a club, a position and a heat number, which
 * is why it read as "one long list" — there was nothing on a row to shop on.
 * These tests pin the facts a GM browses by: what he costs, how long he's
 * signed for, whether he's a rental, what it would take to prise him loose,
 * and whether he plays a position this club is actually short at. If any of
 * them silently stops being populated, the filters on the block quietly become
 * decoration, which is the exact failure the UI audit cannot see.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'

/** Sim far enough in that selling clubs have put names out. */
function careerWithBlock(seed: number): Career {
  const data = generateLeague({ seed })
  const userId = data.league.teams[0]!
  const career = new Career(data, seed, userId)
  let guard = 0
  while (career.getTentpoles().rumors.length === 0 && guard++ < 200) career.advanceDay()
  return career
}

describe('trade block rows', () => {
  const career = careerWithBlock(77)
  const rumors = career.getTentpoles().rumors

  it('has names on the block by mid-season', () => {
    expect(rumors.length).toBeGreaterThan(0)
  })

  it('carries cost and term on every row', () => {
    for (const r of rumors) {
      expect(r.salary, `${r.playerName} has no cap hit`).toBeGreaterThan(0)
      expect(r.yearsRemaining, `${r.playerName} has no term`).toBeGreaterThanOrEqual(0)
    }
  })

  it('flags a rental exactly when the deal is up this summer', () => {
    for (const r of rumors) {
      expect(r.expiring).toBe((r.yearsRemaining ?? 0) <= 1)
    }
  })

  it('prices every name on the shared trade currency', () => {
    for (const r of rumors) {
      expect(r.tradeValue, `${r.playerName} has no trade value`).toBeGreaterThan(0)
    }
  })

  it('says whether each man fills a hole in the user’s own club', () => {
    // Not "some are true" — the flag has to be a real boolean on every row, or
    // the "Fits a need" filter silently hides everyone.
    for (const r of rumors) expect(typeof r.fitsNeed).toBe('boolean')
  })

  it('names the club in full, so the card does not read as an abbreviation soup', () => {
    for (const r of rumors) {
      expect(r.teamAbbr).toBeTruthy()
      expect(r.teamName, `${r.playerName} has no club name`).toBeTruthy()
    }
  })

  it('gives every row an ability read the star meter can render', () => {
    for (const r of rumors) {
      expect(r.overall).toBeGreaterThan(0)
      expect(r.position).toBeTruthy()
      expect(r.age).toBeGreaterThan(0)
    }
  })

  it('keeps heat in range so the band grouping cannot strand a row', () => {
    // Every row must land in exactly one of the three bands the UI groups by
    // (>=70, >=40, >=0) — a negative or >100 heat would fall out of all of them.
    for (const r of rumors) {
      expect(r.heat).toBeGreaterThanOrEqual(0)
      expect(r.heat).toBeLessThanOrEqual(100)
    }
  })
})
