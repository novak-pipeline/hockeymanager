/**
 * playerMindset.test.ts
 *
 * Tests for the deterministic player mindset generator.
 * Verifies signal → thought mapping, fog behaviour, and determinism.
 */

import { describe, it, expect } from 'vitest'
import { buildMindset, type MindsetCtx } from './playerMindset'
import type { Player } from '@domain'
import type { LockerRoomState } from '@engine/league/lockerRoom'

/* ─── minimal player factory ─── */

function mockRatings(base: number) {
  return {
    technical: {
      wristShot: base, slapShot: base, stickhandling: base,
      passing: base, deflections: base, faceoffs: base,
    },
    physical: {
      speed: base, acceleration: base, strength: base,
      balance: base, stamina: base, agility: base, height: base,
    },
    mental: {
      offensiveIQ: base, defensiveIQ: base, positioning: base,
      vision: base, aggression: base, composure: base,
      workRate: base, discipline: base, anticipation: base,
    },
    defensive: {
      checking: base, shotBlocking: base, stickChecking: base, takeaway: base,
    },
  }
}

function mockComposites(base: number) {
  return {
    scoring: base, playmaking: base, puckControl: base, faceoffWin: base,
    hitting: base, blocking: base, takeaway: base, penaltyProne: 30,
    goaltending: 0, skating: base, defensiveZone: base,
    offensiveIQ: base, defensiveIQ: base, vision: base, passing: base,
  }
}

function makePlayer(overrides: Partial<{
  id: string
  age: number
  position: 'C' | 'W' | 'D' | 'G'
  role: string
  morale: number
  form: number
  fatigue: number
  ambition: number
  loyalty: number
  temperament: number
  professionalism: number
  determination: number
  contractYears: number
  contractSalary: number
  contractExpiry: number
  noTradeClause: boolean
}>): Player {
  const pid = overrides.id ?? 'player-test-1'
  return {
    id: pid as unknown as Player['id'],
    name: 'Test Player',
    age: overrides.age ?? 26,
    position: overrides.position ?? 'C',
    handedness: 'R',
    role: overrides.role ?? 'Top-six forward',
    ratings: mockRatings(70),
    potential: mockRatings(75),
    composites: mockComposites(70) as unknown as Player['composites'],
    personality: {
      ambition: overrides.ambition ?? 10,
      professionalism: overrides.professionalism ?? 10,
      loyalty: overrides.loyalty ?? 10,
      temperament: overrides.temperament ?? 10,
      determination: overrides.determination ?? 10,
    },
    contract: {
      salary: overrides.contractSalary ?? 3_000_000,
      yearsRemaining: overrides.contractYears ?? 2,
      expiryYear: overrides.contractExpiry ?? 2028,
      noTradeClause: overrides.noTradeClause ?? false,
      twoWay: false,
    },
    stats: [],
    fatigue: overrides.fatigue ?? 20,
    morale: overrides.morale ?? 70,
    injuryStatus: null,
    form: overrides.form ?? 0,
  } as unknown as Player
}

function makeCtx(overrides?: Partial<MindsetCtx>): MindsetCtx {
  return {
    year: 2026,
    lockerRoom: null,
    getPlayerName: () => null,
    isOwn: true,
    ...overrides,
  }
}

function emptyLockerRoom(): LockerRoomState {
  return {
    captainId: null,
    alternateIds: [],
    influence: [],
    relationships: [],
    familiarity: [],
    roomMorale: 60,
  }
}


/* ─── morale signal ─── */

describe('morale signal', () => {
  it('high morale produces a positive tone', () => {
    const p = makePlayer({ morale: 85 })
    const result = buildMindset(p, makeCtx())
    expect(result.tone).toBe('positive')
    expect(result.lines.length).toBeGreaterThan(0)
  })

  it('low morale produces a negative tone', () => {
    const p = makePlayer({ morale: 20 })
    const result = buildMindset(p, makeCtx())
    expect(result.tone).toBe('negative')
    expect(result.lines.some((l) => /unhappy|discontent|morale|low/i.test(l))).toBe(true)
  })
})

/* ─── form signal ─── */

describe('form signal', () => {
  it('hot streak (form ≥ 4) produces positive line', () => {
    const p = makePlayer({ form: 5, morale: 60 })
    const result = buildMindset(p, makeCtx())
    expect(result.lines.some((l) => /hot|streak|confiden|energi/i.test(l))).toBe(true)
  })

  it('cold streak (form ≤ -4) produces negative mention', () => {
    const p = makePlayer({ form: -5, morale: 60 })
    const result = buildMindset(p, makeCtx())
    expect(result.lines.some((l) => /cold|confiden|dip|frustrat/i.test(l))).toBe(true)
  })
})

/* ─── role vs ambition ─── */

describe('role vs ambition', () => {
  it('high ambition + depth/bottom role → frustrated', () => {
    const p = makePlayer({ ambition: 17, role: 'Fourth-line checker', morale: 60, form: 0 })
    const result = buildMindset(p, makeCtx())
    // Prose: "Frustrated by his limited role", "bigger opportunity", "hunger for more ice time"
    const joined = result.lines.join(' ')
    expect(result.lines.some((l) => /frustrated|bigger|limited|hunger|ambitious|capable/i.test(l)),
      `role lines: ${joined}`
    ).toBe(true)
    expect(result.tone).toBe('negative')
  })

  it('high ambition + top-six role → positive mention', () => {
    const p = makePlayer({ ambition: 17, role: 'Top-six forward', morale: 60, form: 0 })
    const result = buildMindset(p, makeCtx())
    expect(result.lines.some((l) => /thriving|featured|top|craves/i.test(l))).toBe(true)
  })
})

/* ─── contract signal ─── */

describe('contract signal', () => {
  it('expiring UFA contract → concerned line', () => {
    const p = makePlayer({ contractYears: 0, age: 30, morale: 60, form: 0 })
    const result = buildMindset(p, makeCtx())
    // Prose includes "summer", "July", "unrestricted", "concerned", or "career"
    expect(result.lines.some((l) => /summer|july|unrestricted|concerned|career|circling/i.test(l))).toBe(true)
  })

  it('long contract + high loyalty → secure/committed line', () => {
    const p = makePlayer({
      contractYears: 5,
      contractExpiry: 2031,
      loyalty: 17,
      morale: 70,
      form: 0,
    })
    const result = buildMindset(p, makeCtx())
    // Prose: "Locked in on a long-term deal..." or "Security of a long contract..."
    expect(result.lines.some((l) => /locked|long.term|security|long contract|committed|focused/i.test(l))).toBe(true)
  })
})

/* ─── fatigue signal ─── */

describe('fatigue signal', () => {
  it('high fatigue → worn down line', () => {
    const p = makePlayer({ fatigue: 80, morale: 60, form: 0 })
    const result = buildMindset(p, makeCtx())
    expect(result.lines.some((l) => /fatigue|worn|rest|heavy/i.test(l))).toBe(true)
  })
})

/* ─── locker room relationships ─── */

describe('locker room relationships', () => {
  it('feud relationship → negative tone and mention of tension', () => {
    const lr = emptyLockerRoom()
    lr.relationships.push({
      a: 'player-a',
      b: 'player-b',
      kind: 'feud',
      strength: 60,
      sinceYear: 2025,
    })
    const p = makePlayer({ id: 'player-a', morale: 65, form: 0, fatigue: 20 })
    const result = buildMindset(p, makeCtx({
      lockerRoom: lr,
      getPlayerName: (id) => id === 'player-b' ? 'John Smith' : null,
    }))
    expect(result.lines.some((l) => /friction|feud|tension|John Smith/i.test(l))).toBe(true)
  })

  it('mentorship (mentor side) → positive line naming protege', () => {
    const lr = emptyLockerRoom()
    lr.relationships.push({
      a: 'veteran-1',
      b: 'rookie-1',
      kind: 'mentorship',
      strength: 50,
      sinceYear: 2025,
    })
    const vet = makePlayer({ id: 'veteran-1', morale: 70, form: 0 })
    const result = buildMindset(vet, makeCtx({
      lockerRoom: lr,
      getPlayerName: (id) => id === 'rookie-1' ? 'Young Guy' : null,
    }))
    expect(result.lines.some((l) => /Young Guy|mentor|wing/i.test(l))).toBe(true)
    expect(result.tone).toBe('positive')
  })

  it('friendship → positive line with partner name', () => {
    const lr = emptyLockerRoom()
    lr.relationships.push({
      a: 'player-x',
      b: 'player-y',
      kind: 'friendship',
      strength: 70,
      sinceYear: 2025,
    })
    const p = makePlayer({ id: 'player-x', morale: 70, form: 0 })
    const result = buildMindset(p, makeCtx({
      lockerRoom: lr,
      getPlayerName: (id) => id === 'player-y' ? 'Mike Jones' : null,
    }))
    expect(result.lines.some((l) => /Mike Jones|friend|bond/i.test(l))).toBe(true)
  })

  it('high room morale (no relationship) → positive ambient line', () => {
    const lr = emptyLockerRoom()
    lr.roomMorale = 85
    const p = makePlayer({ morale: 65, form: 0 })
    const result = buildMindset(p, makeCtx({ lockerRoom: lr }))
    expect(result.lines.some((l) => /team|spirit|atmosphere|buoyant|room/i.test(l))).toBe(true)
  })
})

/* ─── fog behaviour ─── */

describe('fog / clarity', () => {
  it('clarity is clear for isOwn = true regardless of knowledge', () => {
    const p = makePlayer({ morale: 85 })
    const result = buildMindset(p, makeCtx({ isOwn: true }))
    expect(result.clarity).toBe('clear')
    expect(result.lines.length).toBeGreaterThanOrEqual(1)
  })

  it('low scouting knowledge → vague clarity and at most 1 line', () => {
    const p = makePlayer({ morale: 85, ambition: 18, role: 'Fourth-line checker' })
    const scouting = {
      assignments: [],
      knowledge: new Map([['player-test-1', 15]]),
    }
    const result = buildMindset(p, makeCtx({
      isOwn: false,
      scouting: scouting as unknown as import('@domain/scouting').ScoutingState,
    }))
    expect(result.clarity).toBe('vague')
    expect(result.lines.length).toBeLessThanOrEqual(1)
  })

  it('partial scouting knowledge (40–69) → partial clarity', () => {
    const p = makePlayer({ morale: 85 })
    const scouting = {
      assignments: [],
      knowledge: new Map([['player-test-1', 55]]),
    }
    const result = buildMindset(p, makeCtx({
      isOwn: false,
      scouting: scouting as unknown as import('@domain/scouting').ScoutingState,
    }))
    expect(result.clarity).toBe('partial')
  })

  it('high scouting knowledge (≥70) → clear clarity', () => {
    const p = makePlayer({ morale: 85 })
    const scouting = {
      assignments: [],
      knowledge: new Map([['player-test-1', 80]]),
    }
    const result = buildMindset(p, makeCtx({
      isOwn: false,
      scouting: scouting as unknown as import('@domain/scouting').ScoutingState,
    }))
    expect(result.clarity).toBe('clear')
  })
})

/* ─── determinism ─── */

describe('determinism', () => {
  it('same player produces identical output across multiple calls', () => {
    const p = makePlayer({
      id: 'det-player-1',
      morale: 40,
      form: -5,
      ambition: 16,
      role: 'Fourth-line checker',
      contractYears: 0,
      age: 31,
    })
    const ctx = makeCtx()
    const r1 = buildMindset(p, ctx)
    const r2 = buildMindset(p, ctx)
    const r3 = buildMindset(p, ctx)
    expect(r1.tone).toBe(r2.tone)
    expect(r1.lines).toEqual(r2.lines)
    expect(r2.lines).toEqual(r3.lines)
  })

  it('different players produce potentially different outputs', () => {
    const p1 = makePlayer({ id: 'det-a', morale: 80, form: 4 })
    const p2 = makePlayer({ id: 'det-b', morale: 80, form: 4 })
    const ctx = makeCtx()
    const r1 = buildMindset(p1, ctx)
    const r2 = buildMindset(p2, ctx)
    // At least tone should be same (both happy) but lines may differ by hash
    expect(r1.tone).toBe('positive')
    expect(r2.tone).toBe('positive')
  })
})
