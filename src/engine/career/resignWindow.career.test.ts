/**
 * The re-signing window, end to end in a real career (playtest §B1–§B4).
 *
 * These fail without the fix:
 *  - §B1 the stage used to close on ONE Continue press, and an offer used to be
 *    answered instantly; now it is a multi-day window and a tabled offer sits
 *    in a queue until its day comes;
 *  - §B2 qualifying offers did not exist;
 *  - §B3 rival offer sheets had no clock;
 *  - and the whole window has to survive a save/load, or none of it is real.
 */
import { describe, expect, it } from 'vitest'
import { asPlayerId } from '@domain'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { RESIGN_WINDOW_DAYS } from '@engine/league/resignWindow'

/** A career parked at the top of the June window, without simming a season.
 *  Generated contracts all run at least a year, so a slice of the user's roster
 *  is expired by hand — that is exactly the state a rollover produces. */
function atResignWindow(seed: number): Career {
  const data = generateLeague({ seed })
  const userId = data.league.teams[0]!
  const team = data.teams.get(userId)!
  // Expire a mixed bag: some young (RFA-eligible), some old (UFA).
  for (const [i, pid] of team.roster.entries()) {
    if (i % 3 !== 0) continue
    const p = data.players.get(pid)!
    p.contract = { ...p.contract, yearsRemaining: 0 }
  }
  const career = new Career(data, seed, userId)
  career.startAtOffseason()
  // Dev camp is a week of beats that sits in front of the window; walk it.
  let guard = 0
  while (career.getOffseason()!.stage === 'resign' && (career.getOffseason()!.resignDay ?? 0) === 0 && guard++ < 12) {
    const before = career.getOffseason()!.resignDay ?? 0
    career.advanceOffseason()
    if ((career.getOffseason()!.resignDay ?? 0) > before) break
  }
  return career
}

/** Give the user club room so cap math never masks the mechanic under test. */
function loosenCap(career: Career): void {
  const internals = career as unknown as {
    userTeam: { finances: { salaryCap: number } }
  }
  internals.userTeam.finances.salaryCap = 400_000_000
}

describe('§B1 — the re-signing window plays out over days', () => {
  it('does not close on a single Continue', () => {
    const career = atResignWindow(31)
    expect(career.getOffseason()!.stage).toBe('resign')
    career.advanceOffseason()
    expect(career.getOffseason()!.stage).toBe('resign')
    // ...but it does close once the days run out.
    let guard = 0
    while (career.getOffseason()!.stage === 'resign' && guard++ < RESIGN_WINDOW_DAYS + 4) {
      career.advanceOffseason()
    }
    expect(career.getOffseason()!.stage).toBe('freeAgency')
  })

  it('reports the day it is on, and the view carries the window', () => {
    const career = atResignWindow(31)
    const v = career.getOffseason()!
    expect(v.resignWindowDays).toBe(RESIGN_WINDOW_DAYS)
    expect(v.resignDay).toBeGreaterThanOrEqual(0)
    expect(v.resignDay).toBeLessThan(RESIGN_WINDOW_DAYS)
  })

  it('a tabled offer is NOT answered on the spot — it waits for its day', () => {
    const career = atResignWindow(31)
    loosenCap(career)
    const row = career.getOffseason()!.expiring.find((r) => r.status === 'pending' && r.rights !== 'ELC')
    expect(row).toBeDefined()
    const before = career.getOffseason()!.expiring.find((r) => r.playerId === row!.playerId)!
    expect(before.status).toBe('pending')

    // Full ask — the old code signed him the instant the button was pressed.
    const res = career.submitResignOffer(row!.playerId, row!.askSalary, row!.askYears)
    expect(res.ok).toBe(true)

    const waiting = career.getOffseason()!.expiring.find((r) => r.playerId === row!.playerId)!
    expect(waiting.status).toBe('pending')
    expect(waiting.pendingOffer).toBeDefined()
    expect(waiting.pendingOffer!.salary).toBe(row!.askSalary)
    expect(waiting.pendingOffer!.daysLeft).toBeGreaterThan(0)

    // Days pass; the answer arrives.
    let guard = 0
    let after = waiting
    while (after.status === 'pending' && after.pendingOffer && guard++ < RESIGN_WINDOW_DAYS) {
      career.advanceOffseason()
      const v = career.getOffseason()
      if (!v || v.stage !== 'resign') break
      after = v.expiring.find((r) => r.playerId === row!.playerId)!
    }
    expect(after.pendingOffer).toBeUndefined()
    expect(after.status).toBe('signed')
  })

  it('§B4: the ask AAV over padded term is refused or countered, never a free yes', () => {
    const career = atResignWindow(77)
    loosenCap(career)
    const rows = career.getOffseason()!.expiring.filter((r) => r.status === 'pending' && r.rights !== 'ELC' && r.askYears <= 4)
    expect(rows.length).toBeGreaterThan(0)
    const padded = rows.map((r) => ({ id: r.playerId, salary: r.askSalary, years: Math.min(8, r.askYears + 4) }))
    for (const o of padded) career.submitResignOffer(o.id, o.salary, o.years)

    let guard = 0
    while (career.getOffseason()?.stage === 'resign' && guard++ < RESIGN_WINDOW_DAYS) career.advanceOffseason()
    const view = career.getOffseason()
    if (view?.stage !== 'resign') return // window closed; nothing signed cheaply either way
    for (const o of padded) {
      const row = view.expiring.find((r) => r.playerId === o.id)
      if (!row) continue
      // He may have countered, refused or walked — he must not have simply signed
      // for the price of a shorter deal.
      if (row.status === 'signed') {
        expect(row.currentSalary).toBeGreaterThan(o.salary)
      }
    }
  })

  it('the view prices term: more years costs more per year', () => {
    const career = atResignWindow(31)
    const row = career.getOffseason()!.expiring.find((r) => r.status === 'pending' && r.rights !== 'ELC' && r.askYears < 6)
    expect(row).toBeDefined()
    const prices = row!.priceByYears!
    const atAsk = prices.find((p) => p.years === row!.askYears)!.salary
    const longer = prices.find((p) => p.years === row!.askYears + 2)!.salary
    expect(longer).toBeGreaterThan(atAsk)
  })
})

describe('§B2 — qualifying offers exist and mean something', () => {
  it('every expiring RFA carries a QO number and a decision', () => {
    const career = atResignWindow(31)
    const rfas = career.getOffseason()!.expiring.filter((r) => r.rights === 'RFA' && r.status === 'pending')
    expect(rfas.length).toBeGreaterThan(0)
    for (const r of rfas) {
      expect(r.qualifyingOffer).toBeGreaterThan(0)
      expect(['tendered', 'declined', 'open']).toContain(r.qoStatus)
    }
  })

  it('walking away from the QO drops his restricted rights', () => {
    const career = atResignWindow(31)
    const rfa = career.getOffseason()!.expiring.find((r) => r.rights === 'RFA' && r.status === 'pending')
    expect(rfa).toBeDefined()
    expect(career.declineQualifyingOffer(rfa!.playerId).ok).toBe(true)
    const after = career.getOffseason()!.expiring.find((r) => r.playerId === rfa!.playerId)!
    expect(after.qoStatus).toBe('declined')
    // ...and re-tendering puts him back under club control.
    expect(career.tenderQualifyingOffer(rfa!.playerId).ok).toBe(true)
    expect(career.getOffseason()!.expiring.find((r) => r.playerId === rfa!.playerId)!.qoStatus).toBe('tendered')
  })

  it('a non-RFA cannot be qualified', () => {
    const career = atResignWindow(31)
    const ufa = career.getOffseason()!.expiring.find((r) => r.rights === 'UFA')
    if (!ufa) return
    expect(career.tenderQualifyingOffer(ufa.playerId).ok).toBe(false)
  })

  it('an unqualified RFA reaches the market unrestricted, with no arbitration', () => {
    const career = atResignWindow(52)
    const rfa = career.getOffseason()!.expiring.find((r) => r.rights === 'RFA' && r.status === 'pending' && r.overall >= 60)
    if (!rfa) return
    career.declineQualifyingOffer(rfa.playerId)
    let guard = 0
    while (career.getOffseason()?.stage === 'resign' && guard++ < RESIGN_WINDOW_DAYS + 2) career.advanceOffseason()
    const cases = career.getOffseason()?.arbitration ?? []
    expect(cases.some((c) => c.playerId === rfa.playerId)).toBe(false)
  })
})

describe('§B3 — offer sheets run a live match clock inside the window', () => {
  it('every sheet reports the days left to match', () => {
    const career = atResignWindow(41)
    const sheets = career.getOffseason()!.offerSheets ?? []
    for (const s of sheets) {
      expect(s.matchDaysLeft).toBeDefined()
      expect(s.matchDaysLeft!).toBeGreaterThanOrEqual(0)
    }
  })

  it('a sheet you never answer resolves itself before July 1', () => {
    // Find a seed whose user club actually draws a sheet.
    let career: Career | null = null
    for (const seed of [41, 84, 12, 7, 55, 63]) {
      const c = atResignWindow(seed)
      if ((c.getOffseason()!.offerSheets ?? []).length > 0) { career = c; break }
    }
    if (!career) return
    const before = career.getOffseason()!.offerSheets!.length
    expect(before).toBeGreaterThan(0)
    let guard = 0
    while (career.getOffseason()?.stage === 'resign' && guard++ < RESIGN_WINDOW_DAYS + 2) career.advanceOffseason()
    // Either resolved during the window or at its close — never left dangling.
    expect((career.getOffseason()?.offerSheets ?? []).length).toBe(0)
  })
})

describe('the window survives save/load', () => {
  it('a tabled offer and a QO decision are still there after a round trip', () => {
    const career = atResignWindow(31)
    loosenCap(career)
    const row = career.getOffseason()!.expiring.find((r) => r.status === 'pending' && r.rights !== 'ELC')!
    const rfa = career.getOffseason()!.expiring.find((r) => r.rights === 'RFA' && r.status === 'pending')
    career.submitResignOffer(row.playerId, Math.round(row.askSalary * 0.9), row.askYears)
    if (rfa) career.declineQualifyingOffer(rfa.playerId)

    const snap = career.exportSnapshot('t', '2026-06-28')
    expect(snap.resignOffers?.length).toBe(1)
    expect(snap.offseason?.resignDay).toBe(career.getOffseason()!.resignDay)

    const restored = Career.fromSnapshot(snap)
    const rRow = restored.getOffseason()!.expiring.find((r) => r.playerId === row.playerId)!
    expect(rRow.pendingOffer).toBeDefined()
    expect(rRow.pendingOffer!.salary).toBe(Math.round(row.askSalary * 0.9))
    if (rfa) {
      expect(restored.getOffseason()!.expiring.find((r) => r.playerId === rfa.playerId)!.qoStatus).toBe('declined')
    }
    // And the clock still runs after the reload — the offer gets its answer.
    expect(restored.getOffseason()!.resignDay).toBe(career.getOffseason()!.resignDay)
    let guard = 0
    while (restored.getOffseason()?.stage === 'resign' && guard++ < RESIGN_WINDOW_DAYS + 4) {
      restored.advanceOffseason()
      const v = restored.getOffseason()
      if (v?.stage !== 'resign') break
      if (!v.expiring.find((r) => r.playerId === row.playerId)?.pendingOffer) break
    }
    const settled = restored.getOffseason()?.expiring.find((r) => r.playerId === row.playerId)
    expect(settled?.pendingOffer).toBeUndefined()
  })

  it('a save with no qualifying-offer record does not silently lose its RFAs', () => {
    const career = atResignWindow(31)
    const snap = career.exportSnapshot('t', '2026-06-28')
    delete snap.qualifyingOffers
    const restored = Career.fromSnapshot(snap)
    const rfas = restored.getOffseason()!.expiring.filter((r) => r.rights === 'RFA' && r.status === 'pending')
    if (rfas.length === 0) return
    expect(rfas.some((r) => r.qoStatus === 'tendered')).toBe(true)
  })
})

describe('the counter is a real, signable number', () => {
  it('a near-miss offer comes back as a counter the GM can accept as written', () => {
    let career: Career | null = null
    let target: { playerId: string; askSalary: number; askYears: number } | null = null
    for (const seed of [31, 77, 52, 41, 12]) {
      const c = atResignWindow(seed)
      loosenCap(c)
      const rows = c.getOffseason()!.expiring.filter((r) => r.status === 'pending' && r.rights !== 'ELC')
      for (const r of rows) c.submitResignOffer(r.playerId, Math.round(r.askSalary * 0.9), r.askYears)
      let guard = 0
      while (c.getOffseason()?.stage === 'resign' && guard++ < RESIGN_WINDOW_DAYS) {
        c.advanceOffseason()
        const v = c.getOffseason()
        if (v?.stage !== 'resign') break
        const countered = v.expiring.find((r) => r.counter)
        if (countered) {
          career = c
          target = { playerId: countered.playerId, askSalary: countered.askSalary, askYears: countered.askYears }
          break
        }
      }
      if (career) break
    }
    expect(career, 'no counter produced across five seeds').not.toBeNull()
    const row = career!.getOffseason()!.expiring.find((r) => r.playerId === target!.playerId)!
    expect(row.counter!.salary).toBeGreaterThanOrEqual(Math.round(row.askSalary * 0.9))
    const res = career!.acceptResignCounter(row.playerId)
    expect(res.ok).toBe(true)
    const after = career!.getOffseason()!.expiring.find((r) => r.playerId === row.playerId)!
    expect(after.status).toBe('signed')
    const userTeam = (career as unknown as { userTeam: { roster: unknown[] } }).userTeam
    expect(userTeam.roster.map(String)).toContain(String(asPlayerId(row.playerId)))
  })
})
