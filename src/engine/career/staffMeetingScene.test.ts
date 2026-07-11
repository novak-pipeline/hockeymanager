import { describe, expect, it } from 'vitest'
import {
  buildStaffMeetingScene,
  delegatedChoices,
  type StaffCast,
  type StaffFinding,
} from './staffMeetingScene'

const CAST: StaffCast = {
  headCoach: { id: 'hc', name: 'Mike Sorel', title: 'Head Coach' },
  asstCoach: { id: 'ac', name: 'Dave Reid', title: 'Assistant Coach' },
  physio: { id: 'py', name: 'Dr. Lang', title: 'Head Physio' },
  asstGM: { id: 'agm', name: 'Tom Vance', title: 'Assistant GM' },
}

const REC = { w: 10, l: 6, otl: 2 }

function scene(findings: StaffFinding[]) {
  return buildStaffMeetingScene({ findings, cast: CAST, day: 100, year: 2025, record: REC })
}

describe('buildStaffMeetingScene', () => {
  it('produces a proposal per finding, attributed to the right staff voice', () => {
    const s = scene([
      { kind: 'coldTopSix', playerId: 'p1', name: 'Nyberg', lineIdx: 0, form: 20 },
      { kind: 'injuryRisk', playerId: 'p2', name: 'Larsson', risk: 72, ltirEligible: false },
      { kind: 'prospectReady', playerId: 'p3', name: 'Halonen', overall: 74, weakestName: 'Dobbs' },
    ])
    expect(s.proposals).toHaveLength(3)
    const byPlayer = Object.fromEntries(s.proposals.map((p) => [p.title, p]))
    expect(byPlayer['Nyberg has gone cold'].speakerId).toBe('ac') // assistant coach
    expect(byPlayer['Larsson is an injury risk'].speakerId).toBe('py') // physio
    expect(byPlayer['Halonen is ready'].speakerId).toBe('agm') // assistant GM
  })

  it('cold-scorer proposal offers a real line move to the 3rd line as its aggressive option', () => {
    const s = scene([{ kind: 'coldTopSix', playerId: 'p1', name: 'Nyberg', lineIdx: 0, form: 15 }])
    const opt = s.proposals[0]!.options.find((o) => o.id === 'drop')!
    expect(opt.action).toEqual({ type: 'moveLine', playerId: 'p1', toLine: 2 })
    expect(s.proposals[0]!.defaultOptionId).toBe('keep') // AGM leaves it
  })

  it('injury-risk proposal defaults to REST (the AGM protects the asset) and offers LTIR only when eligible', () => {
    const noLtir = scene([{ kind: 'injuryRisk', playerId: 'p2', name: 'Larsson', risk: 80, ltirEligible: false }])
    expect(noLtir.proposals[0]!.defaultOptionId).toBe('rest')
    expect(noLtir.proposals[0]!.options.some((o) => o.id === 'ltir')).toBe(false)

    const ltir = scene([{ kind: 'injuryRisk', playerId: 'p2', name: 'Larsson', risk: 80, ltirEligible: true }])
    const ltirOpt = ltir.proposals[0]!.options.find((o) => o.id === 'ltir')!
    expect(ltirOpt.action).toEqual({ type: 'ltir', playerId: 'p2' })
  })

  it('orders by severity (injury risk over a cold scorer over a tactic misfit) and caps at 5', () => {
    const many: StaffFinding[] = [
      { kind: 'tacticMisfit', coachFit: 40, direction: 'fitRoster' },
      { kind: 'coldTopSix', playerId: 'a', name: 'A', lineIdx: 1, form: 25 },
      { kind: 'injuryRisk', playerId: 'b', name: 'B', risk: 90, ltirEligible: false },
      { kind: 'fatigued', playerId: 'c', name: 'C', condition: 30 },
      { kind: 'prospectReady', playerId: 'd', name: 'D', overall: 70 },
      { kind: 'coldTopSix', playerId: 'e', name: 'E', lineIdx: 0, form: 10 },
      { kind: 'coldTopSix', playerId: 'f', name: 'F', lineIdx: 0, form: 12 },
    ]
    const s = scene(many)
    expect(s.proposals).toHaveLength(5) // capped
    expect(s.proposals[0]!.title).toBe('B is an injury risk') // highest severity first
  })

  it('empty findings → no proposals (career layer then skips convening)', () => {
    expect(scene([]).proposals).toHaveLength(0)
  })

  it('every option carries an executable action and a receipt detail', () => {
    const s = scene([
      { kind: 'fatigued', playerId: 'p', name: 'Q', condition: 28 },
      { kind: 'tacticMisfit', coachFit: 45, direction: 'defensive' },
    ])
    for (const p of s.proposals) {
      for (const o of p.options) {
        expect(o.action).toBeTruthy()
        expect(o.detail.length).toBeGreaterThan(0)
      }
      // the default option must exist in the option set
      expect(p.options.some((o) => o.id === p.defaultOptionId)).toBe(true)
    }
  })
})

describe('delegatedChoices', () => {
  it('maps each proposal to its safe default (the AGM-handles-it path)', () => {
    const s = scene([
      { kind: 'coldTopSix', playerId: 'p1', name: 'Nyberg', lineIdx: 0, form: 20 },
      { kind: 'injuryRisk', playerId: 'p2', name: 'Larsson', risk: 75, ltirEligible: false },
    ])
    const d = delegatedChoices(s)
    expect(Object.keys(d)).toHaveLength(2)
    for (const p of s.proposals) expect(d[p.id]).toBe(p.defaultOptionId)
  })
})
