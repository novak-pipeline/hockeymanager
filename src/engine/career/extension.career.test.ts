/**
 * End-to-end guard for the in-season extension (Playtest 2026-08-26 §E2).
 *
 * The finding was an inbox scene that offered "sign the extension NOW, a year
 * early" when the game had no way to do it. These tests run the whole path in
 * the real career: the window opens, the deal is signed, the RUNNING contract
 * is untouched, the commitment survives a save, and next September the money
 * actually appears on his contract.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { validateSnapshot } from './serialize'
import type { ContractOffer } from '@engine/league/negotiation'

/** Advance the regular season until the club has played `games`. */
function simTo(career: Career, games: number): void {
  let guard = 0
  while (
    career.getDashboard().phase === 'regularSeason' &&
    career.view().userTeam.standing.gamesPlayed < games &&
    guard++ < 400
  ) {
    career.step()
  }
}

/** The cheapest expiring man on the user's NHL roster — the one an extension
 *  is guaranteed to fit under next season's cap. */
function expiringCandidate(career: Career): string | null {
  const rows = career
    .getSquad()
    .rows.filter((p) => p.contract.yearsRemaining === 1)
    .sort((a, b) => a.contract.salary - b.contract.salary)
  return rows[0]?.playerId ?? null
}

/** Keep raising the offer until his camp signs (or we run out of rounds). */
function signExtension(career: Career, pid: string): { signed: boolean; salary: number; years: number } {
  let view = career.startNegotiation(pid)
  for (let i = 0; i < 8; i++) {
    const offer: ContractOffer = {
      salary: Math.round((view.askSalary * (1.02 + i * 0.06)) / 25_000) * 25_000,
      years: Math.min(4, view.askYears),
      signingBonusPct: 0,
      clause: 'none',
      twoWay: false,
    }
    const r = career.submitNegotiationOffer(pid, offer)
    if (r.signed) return { signed: true, salary: offer.salary, years: offer.years }
    if (r.view.status !== 'open') break
    view = r.view
  }
  return { signed: false, salary: 0, years: 0 }
}

describe('in-season extensions (E2)', () => {
  it('refuses talks before the window and opens them after it', () => {
    const data = generateLeague({ seed: 4242 })
    const career = new Career(data, 4242, data.league.teams[0]!)
    simTo(career, 4)
    const pid = expiringCandidate(career)
    expect(pid).not.toBeNull()

    const early = career.extensionEligibilityFor(pid!)
    expect(early.eligible).toBe(false)
    expect(early.block).toBe('windowClosed')
    expect(early.reason).toMatch(/calendar year/i)
    // ...and the negotiation door is genuinely shut, not merely labelled shut.
    expect(() => career.startNegotiation(pid!)).toThrow()

    simTo(career, 34)
    const open = career.extensionEligibilityFor(pid!)
    expect(open.eligible).toBe(true)
    expect(career.startNegotiation(pid!).kind).toBe('extension')
  })

  it('never opens extension talks with a man who has years left on his deal', () => {
    const data = generateLeague({ seed: 909 })
    const career = new Career(data, 909, data.league.teams[0]!)
    simTo(career, 34)
    const longTerm = career.getSquad().rows.find((p) => p.contract.yearsRemaining >= 3)
    expect(longTerm).toBeDefined()
    const r = career.extensionEligibilityFor(longTerm!.playerId)
    expect(r.eligible).toBe(false)
    expect(r.block).toBe('notFinalYear')
  })

  it('signs a deal that does NOT touch the running contract', () => {
    const data = generateLeague({ seed: 4243 })
    const career = new Career(data, 4243, data.league.teams[0]!)
    simTo(career, 34)
    const pid = expiringCandidate(career)!
    const before = career.getPlayer(pid).profileContract!
    const res = signExtension(career, pid)
    expect(res.signed).toBe(true)

    const after = career.getPlayer(pid).profileContract!
    // This season he is paid exactly what he was paid this morning.
    expect(after.salary).toBe(before.salary)
    expect(after.yearsRemaining).toBe(1)
    // ...and the new deal is on the books for next year.
    expect(after.extension).toEqual({ salary: res.salary, years: res.years, startYear: career.view().year + 1 })
    expect(career.getPendingExtensions()).toHaveLength(1)
    // A second extension is refused while the first is banked.
    expect(career.extensionEligibilityFor(pid).block).toBe('alreadyExtended')
  })

  it('puts the receipt in the inbox with the money, the term and the start year', () => {
    const data = generateLeague({ seed: 4244 })
    const career = new Career(data, 4244, data.league.teams[0]!)
    simTo(career, 34)
    const pid = expiringCandidate(career)!
    const name = career.getPlayer(pid).name
    expect(signExtension(career, pid).signed).toBe(true)
    const item = career.getInbox().items.find((n) => n.headline === `${name} signs an extension`)
    expect(item).toBeDefined()
    expect(item!.body).toContain(String(career.view().year + 1))
  })

  it('survives save/load with its teeth', () => {
    const data = generateLeague({ seed: 4245 })
    const career = new Career(data, 4245, data.league.teams[0]!)
    simTo(career, 34)
    const pid = expiringCandidate(career)!
    const res = signExtension(career, pid)
    expect(res.signed).toBe(true)

    const snap = career.exportSnapshot('ext', '2026-08-26T00:00:00.000Z')
    expect(snap.pendingExtensions).toHaveLength(1)
    const restored = Career.fromSnapshot(validateSnapshot(JSON.parse(JSON.stringify(snap))))
    expect(restored.getPendingExtensions()).toEqual(career.getPendingExtensions())
    expect(restored.extensionEligibilityFor(pid).block).toBe('alreadyExtended')
  })

  it('an old save with no extension fields loads clean', () => {
    const data = generateLeague({ seed: 4246 })
    const career = new Career(data, 4246, data.league.teams[0]!)
    const snap = career.exportSnapshot('old', '2026-08-26T00:00:00.000Z')
    delete (snap as { pendingExtensions?: unknown }).pendingExtensions
    delete (snap as { extensionDiscounts?: unknown }).extensionDiscounts
    const restored = Career.fromSnapshot(validateSnapshot(JSON.parse(JSON.stringify(snap))))
    expect(restored.getPendingExtensions()).toEqual([])
  })

  it('the money actually appears on his contract the following season', () => {
    const data = generateLeague({ seed: 4247 })
    const career = new Career(data, 4247, data.league.teams[0]!)
    simTo(career, 34)
    const pid = expiringCandidate(career)!
    const res = signExtension(career, pid)
    expect(res.signed).toBe(true)

    // Play out the year, then take the summer's first step (awards → draft),
    // which is where every contract ticks down and extensions are written on.
    let guard = 0
    while (career.getDashboard().phase === 'regularSeason' && guard++ < 400) career.step()
    guard = 0
    while (career.getDashboard().phase === 'playoffs' && guard++ < 200) career.step()
    expect(career.getDashboard().phase).toBe('offseason')
    career.advanceOffseason()

    const now = career.getPlayer(pid).profileContract!
    expect(now.salary).toBe(res.salary)
    expect(now.yearsRemaining).toBe(res.years)
    expect(now.freeAgentStatus).toBeNull() // never appears on the re-sign list
    expect(career.getPendingExtensions()).toHaveLength(0)
  })
})
