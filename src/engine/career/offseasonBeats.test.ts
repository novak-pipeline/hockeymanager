import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import type { Player } from '@domain'
import { contractStatus } from '@engine/league/contracts'

type Internals = {
  arbitrationCases: Array<{ playerId: string; salary: number; years: number; clubFiling?: number; playerFiling?: number; hearingDay?: number; heard?: boolean }>
  faPool: string[]
  offseason: { stage: string; faDay: number; resignDay?: number }
  data: { players: Map<string, Player> }
  userTeam: { roster: string[] }
  resignStatus: Map<string, string>
  qualifyingOffers: Map<string, string>
}

function summer(seed = 515): { c: Career; i: Internals } {
  const data = generateLeague({ seed })
  const c = new Career(data, seed, data.league.teams[0])
  c.startAtOffseason()
  return { c, i: c as unknown as Internals }
}

describe('Offseason 3.0 — dated beats', () => {
  it('June 30 is the QO deadline: one mail naming each undecided RFA, and the button says so', () => {
    // Make one of your young men an expiring RFA, left undecided.
    const { c, i } = summer()
    const id = i.userTeam.roster.find((x) => { const p = i.data.players.get(x)!; return p.age >= 24 && p.age <= 26 && p.stats.length < 7 && p.position !== 'G' })!
    const p = i.data.players.get(id)!
    p.contract.yearsRemaining = 0
    i.resignStatus.set(id, 'pending')
    expect(contractStatus(p)).toBe('RFA')
    i.qualifyingOffers.delete(id) // leave him undecided
    for (let k = 0; k < 6 && (i.offseason.resignDay ?? 0) < 3; k++) c.advanceOffseason()
    expect(i.offseason.resignDay).toBe(3)
    const mail = c.getInbox().items.find((n) => n.headline.startsWith('QO deadline tonight'))
    expect(mail).toBeDefined()
    expect(mail!.body).toContain(i.data.players.get(id)!.name)
    expect(c.getDashboard().continueLabel).toMatch(/^Continue — the QO deadline passes \(\d+ undecided\)$/)
  })

  function julyWithCase(): { c: Career; i: Internals; pid: string } {
    const { c, i } = summer()
    for (let k = 0; k < 20 && i.offseason.stage !== 'freeAgency'; k++) c.advanceOffseason()
    const pid = i.faPool.find((id) => { const p = i.data.players.get(id); return !!p && p.position !== 'G' })!
    i.faPool = i.faPool.filter((x) => x !== pid)
    i.arbitrationCases.push({ playerId: pid, salary: 2_600_000, years: 1, clubFiling: 2_000_000, playerFiling: 3_000_000, hearingDay: 6, heard: false })
    return { c, i, pid }
  }

  it('before the hearing the award is sealed: the filings show, and you can settle at the door', () => {
    const { c, i, pid } = julyWithCase()
    const view = c.getOffseason()!.arbitration!.find((a) => a.playerId === pid)!
    expect(view.heard).toBe(false)
    expect(view.settleAt).toBe(2_500_000)
    expect(view.salary).toBe(2_500_000) // never the sealed award
    const res = c.settleArbitration(pid, 2)
    expect(res.ok).toBe(true)
    const p = i.data.players.get(pid)!
    expect(i.userTeam.roster).toContain(pid)
    expect(p.contract.salary).toBe(2_500_000)
    expect(p.contract.yearsRemaining).toBe(2)
    expect(c.getInbox().items.some((n) => n.headline === `${p.name} settles before his hearing`)).toBe(true)
  })

  it('the hearing is a dated beat: the award is read out and the case stings; then accept or walk', () => {
    const { c, i, pid } = julyWithCase()
    const p = i.data.players.get(pid)!
    const morale0 = p.morale
    for (let k = 0; k < 10 && i.offseason.faDay < 6; k++) {
      if (i.offseason.faDay === 5) expect(c.getDashboard().continueLabel).toBe('Continue — arbitration hearing, July 6')
      c.advanceOffseason()
    }
    const view = c.getOffseason()!.arbitration!.find((a) => a.playerId === pid)!
    expect(view.heard).toBe(true)
    expect(view.salary).toBe(2_600_000)
    expect(p.morale).toBe(Math.max(0, morale0 - 4))
    expect(c.getInbox().items.some((n) => n.headline === `Arbitration: ${p.name} is awarded $2.60M` && /a win for his camp/.test(n.body))).toBe(true)
    expect(c.settleArbitration(pid, 1).ok).toBe(false) // too late to settle
    expect(c.acceptArbitration(pid).ok).toBe(true)
    expect(p.contract.salary).toBe(2_600_000)
  })
})
