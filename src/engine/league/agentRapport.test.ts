import { describe, expect, it } from 'vitest'
import {
  seedAgentRapport,
  normalizeAgentRapport,
  relationOf,
  standingOf,
  rapportTilt,
  outcomeDelta,
  applyDealOutcome,
  agentRapportNote,
} from './agentRapport'

describe('agentRapport — neutral when absent', () => {
  it('a fresh state has no relationships and zero tilt for anyone', () => {
    const s = seedAgentRapport()
    expect(s.agents).toEqual([])
    expect(rapportTilt(s, 'Marty Belanger')).toBe(0)
    expect(relationOf(s, 'Marty Belanger').rapport).toBe(0)
  })
})

describe('standingOf bands', () => {
  it('maps rapport to standings', () => {
    expect(standingOf(60)).toBe('Trusted')
    expect(standingOf(25)).toBe('Cordial')
    expect(standingOf(0)).toBe('Neutral')
    expect(standingOf(-25)).toBe('Wary')
    expect(standingOf(-60)).toBe('Burned')
  })
})

describe('outcomeDelta', () => {
  it('rewards a fair deal more than a lowball win, punishes walks/pauses', () => {
    expect(outcomeDelta({ kind: 'signed', askSalary: 7_000_000, finalSalary: 7_000_000 })).toBe(12)
    expect(outcomeDelta({ kind: 'signed', askSalary: 7_000_000, finalSalary: 6_400_000 })).toBe(8) // ~0.91
    expect(outcomeDelta({ kind: 'signed', askSalary: 7_000_000, finalSalary: 5_000_000 })).toBe(4) // lowball
    expect(outcomeDelta({ kind: 'paused' })).toBe(-7)
    expect(outcomeDelta({ kind: 'walked' })).toBe(-14)
  })
})

describe('applyDealOutcome', () => {
  it('creates a relationship on first deal and accumulates', () => {
    const s = seedAgentRapport()
    const r1 = applyDealOutcome(s, 'Don Meehan', { kind: 'signed', askSalary: 8_000_000, finalSalary: 8_000_000 }, 2025)
    expect(r1.rapportBefore).toBe(0)
    expect(r1.rapportAfter).toBe(12)
    expect(r1.crossedBoundary).toBe(false) // 12 still Neutral (<18)
    expect(relationOf(s, 'Don Meehan').deals).toBe(1)

    const r2 = applyDealOutcome(s, 'Don Meehan', { kind: 'signed', askSalary: 6_000_000, finalSalary: 6_000_000 }, 2026)
    expect(r2.rapportAfter).toBe(24)
    expect(r2.standingAfter).toBe('Cordial')
    expect(r2.crossedBoundary).toBe(true) // Neutral → Cordial
    expect(relationOf(s, 'Don Meehan').deals).toBe(2)
    expect(relationOf(s, 'Don Meehan').lastYear).toBe(2026)
  })

  it('a walkout sours the relationship and counts a walk', () => {
    const s = seedAgentRapport()
    applyDealOutcome(s, 'Pat Brisson', { kind: 'walked' }, 2025)
    const rel = relationOf(s, 'Pat Brisson')
    expect(rel.rapport).toBe(-14)
    expect(rel.walks).toBe(1)
    expect(standingOf(rel.rapport)).toBe('Neutral') // one walkout isn't a feud yet (-18 threshold)
    applyDealOutcome(s, 'Pat Brisson', { kind: 'walked' }, 2026) // a second sours it
    expect(standingOf(relationOf(s, 'Pat Brisson').rapport)).toBe('Wary')
  })

  it('rapport clamps to ±100', () => {
    const s = seedAgentRapport()
    for (let i = 0; i < 20; i++) applyDealOutcome(s, 'A', { kind: 'signed', askSalary: 5_000_000, finalSalary: 5_000_000 }, 2025 + i)
    expect(relationOf(s, 'A').rapport).toBe(100)
    for (let i = 0; i < 30; i++) applyDealOutcome(s, 'B', { kind: 'walked' }, 2025 + i)
    expect(relationOf(s, 'B').rapport).toBe(-100)
  })
})

describe('rapportTilt', () => {
  it('is 0 at neutral, positive when trusted, negative when burned, clamped ±1', () => {
    const s = seedAgentRapport()
    expect(rapportTilt(s, 'X')).toBe(0)
    applyDealOutcome(s, 'X', { kind: 'signed', askSalary: 5_000_000, finalSalary: 5_000_000 }, 2025) // +12
    expect(rapportTilt(s, 'X')).toBeCloseTo(12 / 80, 5)
    s.agents.find((r) => r.agentKey === 'X')!.rapport = 100
    expect(rapportTilt(s, 'X')).toBe(1)
    s.agents.find((r) => r.agentKey === 'X')!.rapport = -100
    expect(rapportTilt(s, 'X')).toBe(-1)
  })
})

describe('normalizeAgentRapport (save/load)', () => {
  it('handles an undefined/old-save state as empty', () => {
    expect(normalizeAgentRapport(undefined).agents).toEqual([])
    expect(normalizeAgentRapport(null).agents).toEqual([])
  })

  it('clamps stray values, drops keyless entries, dedupes', () => {
    const dirty = {
      agents: [
        { agentKey: 'Marty Belanger', rapport: 999, deals: 3.7, walks: -1 },
        { agentKey: '', rapport: 5, deals: 0, walks: 0 },
        { agentKey: 'Marty Belanger', rapport: -5, deals: 1, walks: 0 },
      ],
    }
    const out = normalizeAgentRapport(dirty as never)
    expect(out.agents).toHaveLength(1)
    const rel = out.agents[0]!
    expect(rel.rapport).toBe(-5) // last write wins after dedupe
    expect(rel.deals).toBe(1)
    expect(rel.walks).toBe(0)
  })

  it('round-trips a clean state', () => {
    const s = seedAgentRapport()
    applyDealOutcome(s, 'Judd Moldaver', { kind: 'signed', askSalary: 4_000_000, finalSalary: 3_900_000 }, 2027)
    const out = normalizeAgentRapport(JSON.parse(JSON.stringify(s)))
    expect(out).toEqual(s)
  })
})

describe('agentRapportNote', () => {
  it('reads no-history and a trusted history distinctly', () => {
    expect(agentRapportNote({ agentKey: 'X', rapport: 0, deals: 0, walks: 0 })).toMatch(/no history/i)
    expect(agentRapportNote({ agentKey: 'X', rapport: 50, deals: 4, walks: 0 })).toMatch(/friendlier open|quicker/i)
  })
})
