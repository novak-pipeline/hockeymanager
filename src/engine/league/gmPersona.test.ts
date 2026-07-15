import { describe, expect, it } from 'vitest'
import {
  buildGmPersona,
  deriveClubPosture,
  personaPhilosophy,
  styleLabel,
  type GmPersona,
} from './gmPersona'

describe('buildGmPersona', () => {
  it('is deterministic per (seed, teamId) and varies across teams', () => {
    const a1 = buildGmPersona({ seed: 42, teamId: 't0', year: 2026 })
    const a2 = buildGmPersona({ seed: 42, teamId: 't0', year: 2026 })
    const b = buildGmPersona({ seed: 42, teamId: 't1', year: 2026 })
    expect(a1).toEqual(a2)
    expect(a1.name).not.toBe(b.name) // different clubs, different people (w.h.p.)
    expect(a1.id).toBe('gm-t0')
  })

  it('produces axes in [0.08, 0.92] and a non-empty style label', () => {
    for (let i = 0; i < 20; i++) {
      const p = buildGmPersona({ seed: 7, teamId: `team-${i}`, year: 2026 })
      for (const axis of [p.aggression, p.patience, p.riskTolerance, p.pickHoarding, p.loyalty, p.capDiscipline, p.analyticsLean]) {
        expect(axis).toBeGreaterThanOrEqual(0.08)
        expect(axis).toBeLessThanOrEqual(0.92)
      }
      expect(p.styleLabel.length).toBeGreaterThan(0)
    }
  })

  it('avoids taken names', () => {
    const clean = buildGmPersona({ seed: 42, teamId: 't9', year: 2026 })
    const dodged = buildGmPersona({ seed: 42, teamId: 't9', year: 2026, takenNames: new Set([clean.name]) })
    expect(dodged.name).not.toBe(clean.name)
  })

  it('round-trips through JSON', () => {
    const p = buildGmPersona({ seed: 1, teamId: 't3', year: 2026 })
    expect(JSON.parse(JSON.stringify(p))).toEqual(p)
  })
})

describe('styleLabel', () => {
  const base: GmPersona = {
    id: 'gm-x', teamId: 'x', name: 'Test GM', sinceYear: 2026, styleLabel: '',
    aggression: 0.5, patience: 0.5, riskTolerance: 0.5, pickHoarding: 0.5,
    loyalty: 0.5, capDiscipline: 0.5, analyticsLean: 0.5,
  }
  it('names the most extreme trait', () => {
    expect(styleLabel({ ...base, aggression: 0.95 })).toContain('aggressive dealer')
    expect(styleLabel({ ...base, pickHoarding: 0.05 })).toContain('picks-for-players trader')
  })
  it('adds a second trait only when it is also strong', () => {
    const one = styleLabel({ ...base, aggression: 0.9 })
    expect(one.includes(',')).toBe(false)
    const two = styleLabel({ ...base, aggression: 0.9, analyticsLean: 0.88 })
    expect(two).toContain('aggressive dealer')
    expect(two).toContain('analytics believer')
  })
})

describe('deriveClubPosture', () => {
  it('top-third strength contends', () => {
    expect(deriveClubPosture({ coreAge: 27, strengthRank: 3, teamCount: 32 }).posture).toBe('contend')
    expect(deriveClubPosture({ coreAge: 31, strengthRank: 8, teamCount: 32 }).reason).toContain('window is now')
  })
  it('bottom-third strength rebuilds', () => {
    expect(deriveClubPosture({ coreAge: 24, strengthRank: 30, teamCount: 32 }).posture).toBe('rebuild')
    expect(deriveClubPosture({ coreAge: 31, strengthRank: 29, teamCount: 32 }).reason).toContain('tear down')
  })
  it('mid-pack retools', () => {
    expect(deriveClubPosture({ coreAge: 27, strengthRank: 16, teamCount: 32 }).posture).toBe('retool')
    expect(deriveClubPosture({ coreAge: 32, strengthRank: 16, teamCount: 32 }).reason).toContain('aging core')
  })
})

describe('personaPhilosophy (LW3 mapping, designed now)', () => {
  const p = (over: Partial<GmPersona>): GmPersona => ({
    id: 'gm-x', teamId: 'x', name: 'X', sinceYear: 2026, styleLabel: '',
    aggression: 0.5, patience: 0.5, riskTolerance: 0.5, pickHoarding: 0.5,
    loyalty: 0.5, capDiscipline: 0.5, analyticsLean: 0.5, ...over,
  })
  it('maps posture + traits onto the trade-AI philosophy enum', () => {
    expect(personaPhilosophy(p({ aggression: 0.8 }), 'contend')).toBe('WinNow')
    expect(personaPhilosophy(p({ aggression: 0.1 }), 'contend')).toBe('Balanced')
    expect(personaPhilosophy(p({ pickHoarding: 0.8 }), 'rebuild')).toBe('RebuildDraft')
    expect(personaPhilosophy(p({ pickHoarding: 0.2 }), 'rebuild')).toBe('RebuildProspects')
    expect(personaPhilosophy(p({ analyticsLean: 0.8 }), 'retool')).toBe('FavorYoung')
    expect(personaPhilosophy(p({}), 'retool')).toBe('Balanced')
  })
})
