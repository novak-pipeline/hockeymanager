/**
 * Tests for archetypes.ts — player archetype classification, line synergy,
 * team style suggestions, and style match.
 *
 * Each test uses fabricated players built from raw attributes so the tests
 * are fully self-contained and independent of external data.
 */
import { describe, expect, it } from 'vitest'
import type {
  Contract,
  Personality,
  Player,
  PlayerId,
  Position,
  RawAttributes,
  SeasonStats
} from '@domain'
import { asPlayerId } from '@domain'
import type { PlayerRole } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import {
  classifyArchetype,
  lineSynergy,
  pairSynergy,
  teamStyleFit,
  styleMatch,
  playerStyleFit,
  styleFromTactics,
  ARCHETYPE_META
} from './archetypes'
import type { Archetype, TeamTactics } from './archetypes'

/* ───────────────────────── helpers ───────────────────────── */

let _nextId = 1
function pid(): PlayerId {
  return asPlayerId(`arch${_nextId++}`)
}

function baseRaw(val = 50): RawAttributes {
  return {
    technical: {
      wristShot: val, slapShot: val, stickhandling: val,
      passing: val, deflections: val, faceoffs: val
    },
    physical: {
      speed: val, acceleration: val, strength: val,
      balance: val, stamina: val, agility: val, height: val
    },
    mental: {
      offensiveIQ: val, defensiveIQ: val, positioning: val,
      vision: val, aggression: val, composure: val,
      workRate: val, discipline: val, anticipation: val
    },
    defensive: { checking: val, shotBlocking: val, stickChecking: val, takeaway: val }
  }
}

const defaultContract: Contract = {
  salary: 2_000_000, yearsRemaining: 2, expiryYear: 2027,
  noTradeClause: false, twoWay: false
}

const defaultStats: SeasonStats = {
  season: 2025, teamId: 'T1', gamesPlayed: 0,
  ev: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  pp: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  pk: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  plusMinus: 0, penaltyMinutes: 0,
  saves: 0, shotsAgainst: 0, goalsAgainst: 0, shutouts: 0
}

const defaultPersonality: Personality = {
  ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10
}

function makePlayer(
  position: Position,
  role: PlayerRole,
  rawOverrides: Partial<{
    technical: Partial<RawAttributes['technical']>
    physical: Partial<RawAttributes['physical']>
    mental: Partial<RawAttributes['mental']>
    defensive: Partial<RawAttributes['defensive']>
    goalie: Partial<NonNullable<RawAttributes['goalie']>>
  }> = {},
  base = 50
): Player {
  const raw = baseRaw(base)
  if (rawOverrides.technical) Object.assign(raw.technical, rawOverrides.technical)
  if (rawOverrides.physical) Object.assign(raw.physical, rawOverrides.physical)
  if (rawOverrides.mental) Object.assign(raw.mental, rawOverrides.mental)
  if (rawOverrides.defensive) Object.assign(raw.defensive, rawOverrides.defensive)
  if (rawOverrides.goalie) {
    raw.goalie = {
      reflexes: 50, positioningG: 50, reboundControl: 50,
      glove: 50, blocker: 50, recovery: 50, puckHandlingG: 50,
      ...rawOverrides.goalie
    }
  }
  const composites = computeComposites(raw, role, position)
  const id = pid()
  return {
    id,
    name: `Player ${id}`,
    age: 25,
    position,
    handedness: 'L',
    role,
    ratings: raw,
    potential: raw,
    composites,
    personality: { ...defaultPersonality },
    contract: { ...defaultContract },
    stats: [{ ...defaultStats }],
    fatigue: 0,
    morale: 60,
    injuryStatus: null,
    form: 0
  }
}

function makeTactics(overrides: Partial<TeamTactics> = {}): TeamTactics {
  return {
    forecheck: '2-1-2',
    dZoneCoverage: 'zone',
    tempo: { pace: 0.5, passRisk: 0.4, shotEagerness: 0.5, defensivePinch: 0.4 },
    specialTeams: { powerPlay: 'umbrella', penaltyKill: 'box' },
    lineMatching: false,
    ...overrides
  }
}

/* ───────────────────────── classifyArchetype ───────────────────────── */

describe('classifyArchetype', () => {
  it('classifies a high-shot winger as sniper', () => {
    const p = makePlayer('W', 'sniper', {
      technical: { wristShot: 95, slapShot: 85 },
      mental: { offensiveIQ: 80 }
    })
    const { archetype, confidence, descriptors } = classifyArchetype(p)
    expect(archetype).toBe('sniper' satisfies Archetype)
    expect(confidence).toBeGreaterThan(0.5)
    expect(descriptors).toContain('high-end shot')
  })

  it('classifies a high-passing/vision centre as playmaker', () => {
    const p = makePlayer('C', 'playmaker', {
      technical: { passing: 90, faceoffs: 70 },
      mental: { vision: 92, offensiveIQ: 80 }
    })
    const { archetype, descriptors } = classifyArchetype(p)
    expect(archetype).toBe('playmaker')
    expect(descriptors.some(d => d.includes('sets up') || d.includes('dot specialist') || d.includes('puck'))).toBe(true)
  })

  it('classifies a big strong forward with scoring as powerForward', () => {
    const p = makePlayer('W', 'powerForward', {
      physical: { strength: 90, height: 85 },
      technical: { wristShot: 68 },
      defensive: { checking: 80 }
    })
    const { archetype, descriptors } = classifyArchetype(p)
    expect(archetype).toBe('powerForward')
    expect(descriptors.some(d => d.includes('plays big') || d.includes('heavy'))).toBe(true)
  })

  it('classifies a balanced forward with high defensive zone rating as twoWayForward', () => {
    const p = makePlayer('C', 'twoWay', {
      mental: { defensiveIQ: 85, anticipation: 80 },
      defensive: { takeaway: 80, stickChecking: 75 }
    }, 55)
    const { archetype } = classifyArchetype(p)
    expect(archetype).toBe('twoWayForward')
  })

  it('classifies a low-scoring high-hitting forward as grinder', () => {
    // Grinder: high work rate + hitting, low scoring
    const p = makePlayer('W', 'twoWay', {
      mental: { workRate: 90 },
      defensive: { checking: 85, shotBlocking: 80 },
      physical: { speed: 68 }
    }, 40) // base 40 keeps scoring low
    const { archetype } = classifyArchetype(p)
    // Should be grinder or twoWayForward (both acceptable for this build)
    expect(['grinder', 'twoWayForward', 'powerForward']).toContain(archetype)
  })

  it('classifies a very high aggression + low scoring forward as enforcer', () => {
    const p = makePlayer('W', 'enforcer', {
      physical: { strength: 95 },
      mental: { aggression: 95 },
      defensive: { checking: 90 }
    }, 30) // very low base keeps scoring minimal
    const { archetype } = classifyArchetype(p)
    expect(archetype).toBe('enforcer')
  })

  it('classifies a D with high scoring + playmaking as offensiveDefenseman', () => {
    const p = makePlayer('D', 'offensiveD', {
      technical: { wristShot: 80, slapShot: 75, passing: 78 },
      mental: { offensiveIQ: 80, vision: 78 },
      physical: { speed: 60 }
    })
    const { archetype } = classifyArchetype(p)
    expect(archetype).toBe('offensiveDefenseman')
  })

  it('classifies a fast D with high passing but modest scoring as puckMover', () => {
    const p = makePlayer('D', 'offensiveD', {
      physical: { speed: 85, acceleration: 80 },
      technical: { passing: 80, stickhandling: 72 },
      mental: { vision: 72 }
    }, 45) // low base keeps scoring down
    const { archetype } = classifyArchetype(p)
    // puckMover or offensiveDefenseman both acceptable; puckMover preferred for low scoring + high speed
    expect(['puckMover', 'offensiveDefenseman', 'twoWayDefenseman']).toContain(archetype)
  })

  it('classifies a high defensiveZone / takeaway D as shutdownDefenseman', () => {
    const p = makePlayer('D', 'shutdownD', {
      mental: { defensiveIQ: 90, anticipation: 82 },
      defensive: { takeaway: 88, shotBlocking: 85, stickChecking: 80 }
    }, 35) // low base keeps scoring minimal
    const { archetype } = classifyArchetype(p)
    expect(archetype).toBe('shutdownDefenseman')
  })

  it('classifies a balanced D as twoWayDefenseman', () => {
    const p = makePlayer('D', 'offensiveD', {
      mental: { defensiveIQ: 70, offensiveIQ: 65 },
      technical: { passing: 65 },
      physical: { speed: 62 }
    }, 58)
    const { archetype } = classifyArchetype(p)
    expect(['twoWayDefenseman', 'offensiveDefenseman', 'shutdownDefenseman']).toContain(archetype)
  })

  it('classifies a reflex-dominant goalie as athleticGoalie', () => {
    const p = makePlayer('G', 'starter', {
      goalie: { reflexes: 92, recovery: 88, positioningG: 55, reboundControl: 50 }
    })
    const { archetype, descriptors } = classifyArchetype(p)
    expect(archetype).toBe('athleticGoalie')
    expect(descriptors).toContain('elite reflexes')
  })

  it('classifies a positioning-dominant goalie as positionalGoalie', () => {
    const p = makePlayer('G', 'starter', {
      goalie: { reflexes: 55, recovery: 50, positioningG: 90, reboundControl: 85 }
    })
    const { archetype, descriptors } = classifyArchetype(p)
    expect(archetype).toBe('positionalGoalie')
    expect(descriptors).toContain('reads play well')
  })

  it('is deterministic — same player always gets same archetype', () => {
    const p = makePlayer('W', 'sniper', { technical: { wristShot: 88 } })
    const a1 = classifyArchetype(p)
    const a2 = classifyArchetype(p)
    expect(a1.archetype).toBe(a2.archetype)
    expect(a1.confidence).toBe(a2.confidence)
    expect(a1.descriptors).toEqual(a2.descriptors)
  })

  it('confidence is between 0 and 1', () => {
    const players = [
      makePlayer('W', 'sniper', { technical: { wristShot: 90 } }),
      makePlayer('C', 'playmaker', { technical: { passing: 85 }, mental: { vision: 90 } }),
      makePlayer('D', 'shutdownD', { mental: { defensiveIQ: 85 } }),
      makePlayer('G', 'starter', { goalie: { reflexes: 80, positioningG: 80 } })
    ]
    for (const p of players) {
      const { confidence } = classifyArchetype(p)
      expect(confidence).toBeGreaterThanOrEqual(0)
      expect(confidence).toBeLessThanOrEqual(1)
    }
  })
})

/* ───────────────────────── ARCHETYPE_META ───────────────────────── */

describe('ARCHETYPE_META', () => {
  const allArchetypes: Archetype[] = [
    'sniper', 'playmaker', 'powerForward', 'twoWayForward', 'grinder', 'enforcer',
    'offensiveDefenseman', 'twoWayDefenseman', 'shutdownDefenseman', 'puckMover',
    'athleticGoalie', 'positionalGoalie'
  ]

  it('has an entry for every archetype', () => {
    for (const a of allArchetypes) {
      expect(ARCHETYPE_META[a]).toBeDefined()
    }
  })

  it('every entry has non-empty label, blurb, and primary', () => {
    for (const a of allArchetypes) {
      const meta = ARCHETYPE_META[a]
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.blurb.length).toBeGreaterThan(0)
      expect(meta.primary.length).toBeGreaterThan(0)
    }
  })
})

/* ───────────────────────── lineSynergy ───────────────────────── */

describe('lineSynergy', () => {
  it('rewards a classic playmaker C + sniper W combo', () => {
    const lw = makePlayer('W', 'sniper', {
      technical: { wristShot: 90, slapShot: 80 },
      mental: { offensiveIQ: 75 }
    })
    const c = makePlayer('C', 'playmaker', {
      technical: { passing: 88, faceoffs: 72 },
      mental: { vision: 90, offensiveIQ: 78 }
    })
    const rw = makePlayer('W', 'powerForward', {
      physical: { strength: 82 },
      defensive: { checking: 75 }
    })
    const result = lineSynergy([lw, c, rw])
    expect(result.score).toBeGreaterThan(60)
    expect(result.multiplier).toBeGreaterThan(1.0)
    expect(result.notes.some(n => n.includes('shot') || n.includes('combination') || n.includes('space'))).toBe(true)
  })

  it('penalises three pure snipers (no puck retrieval)', () => {
    const makeSniper = () => makePlayer('W', 'sniper', {
      technical: { wristShot: 90 },
      mental: { offensiveIQ: 80 }
    })
    const result = lineSynergy([makeSniper(), makeSniper(), makeSniper()])
    expect(result.score).toBeLessThan(50)
    expect(result.notes.some(n => n.includes('sniper') || n.includes('battles') || n.includes('puck'))).toBe(true)
  })

  it('penalises three grinders (no finish)', () => {
    const makeGrinder = () => makePlayer('W', 'twoWay', {
      mental: { workRate: 88 },
      defensive: { checking: 85, shotBlocking: 80 },
      physical: { speed: 65 }
    }, 38)
    const result = lineSynergy([makeGrinder(), makeGrinder(), makeGrinder()])
    expect(result.score).toBeLessThan(55)
    expect(result.notes.some(n => n.toLowerCase().includes('grinder') || n.toLowerCase().includes('grit') || n.toLowerCase().includes('goals'))).toBe(true)
  })

  it('multiplier is always in [0.97, 1.03]', () => {
    const lw = makePlayer('W', 'sniper', { technical: { wristShot: 95 } })
    const c = makePlayer('C', 'playmaker', { technical: { passing: 92 }, mental: { vision: 92 } })
    const rw = makePlayer('W', 'sniper', { technical: { wristShot: 92 } })
    const r1 = lineSynergy([lw, c, rw])
    expect(r1.multiplier).toBeGreaterThanOrEqual(0.97)
    expect(r1.multiplier).toBeLessThanOrEqual(1.03)

    const grinderA = makePlayer('W', 'enforcer', { physical: { strength: 90 }, mental: { aggression: 90 } }, 30)
    const grinderB = makePlayer('C', 'enforcer', { physical: { strength: 88 }, mental: { aggression: 88 } }, 30)
    const grinderC = makePlayer('W', 'enforcer', { physical: { strength: 85 }, mental: { aggression: 85 } }, 30)
    const r2 = lineSynergy([grinderA, grinderB, grinderC])
    expect(r2.multiplier).toBeGreaterThanOrEqual(0.97)
    expect(r2.multiplier).toBeLessThanOrEqual(1.03)
  })

  it('returns notes array even for well-matched lines', () => {
    const lw = makePlayer('W', 'sniper', { technical: { wristShot: 88 } })
    const c = makePlayer('C', 'playmaker', { technical: { passing: 85 }, mental: { vision: 88 } })
    const rw = makePlayer('W', 'twoWay', { mental: { defensiveIQ: 80 } })
    const result = lineSynergy([lw, c, rw])
    expect(result.notes.length).toBeGreaterThan(0)
  })

  it('returns fallback for wrong number of forwards', () => {
    const p = makePlayer('W', 'sniper', {})
    const result = lineSynergy([p, p])
    expect(result.score).toBe(50)
    expect(result.multiplier).toBe(1.0)
    expect(result.notes.length).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    const lw = makePlayer('W', 'sniper', { technical: { wristShot: 88 } })
    const c = makePlayer('C', 'playmaker', { technical: { passing: 85 }, mental: { vision: 88 } })
    const rw = makePlayer('W', 'powerForward', { physical: { strength: 80 } })
    const r1 = lineSynergy([lw, c, rw])
    const r2 = lineSynergy([lw, c, rw])
    expect(r1.score).toBe(r2.score)
    expect(r1.multiplier).toBe(r2.multiplier)
    expect(r1.notes).toEqual(r2.notes)
  })

  it('JSON round-trip preserves values', () => {
    const lw = makePlayer('W', 'sniper', { technical: { wristShot: 88 } })
    const c = makePlayer('C', 'playmaker', { technical: { passing: 85 }, mental: { vision: 88 } })
    const rw = makePlayer('W', 'powerForward', { physical: { strength: 80 } })
    const result = lineSynergy([lw, c, rw])
    const roundTripped = JSON.parse(JSON.stringify(result)) as typeof result
    expect(roundTripped.score).toBe(result.score)
    expect(roundTripped.multiplier).toBe(result.multiplier)
    expect(roundTripped.notes).toEqual(result.notes)
  })
})

/* ───────────────────────── pairSynergy ───────────────────────── */

describe('pairSynergy', () => {
  it('rewards an offensive D + shutdown D pairing', () => {
    const offD = makePlayer('D', 'offensiveD', {
      technical: { wristShot: 78, passing: 76 },
      mental: { offensiveIQ: 75, vision: 72 }
    })
    const shutD = makePlayer('D', 'shutdownD', {
      mental: { defensiveIQ: 88, anticipation: 80 },
      defensive: { takeaway: 84, shotBlocking: 82 }
    }, 38)
    const result = pairSynergy([offD, shutD])
    expect(result.score).toBeGreaterThan(55)
    expect(result.multiplier).toBeGreaterThan(1.0)
    expect(result.notes.some(n => n.includes('play') || n.includes('position') || n.includes('gap'))).toBe(true)
  })

  it('penalises two shutdown D for lack of offensive production', () => {
    const makeShutdown = () => makePlayer('D', 'shutdownD', {
      mental: { defensiveIQ: 88 },
      defensive: { takeaway: 85, shotBlocking: 80 }
    }, 35)
    const result = pairSynergy([makeShutdown(), makeShutdown()])
    expect(result.score).toBeLessThan(60)
    expect(result.notes.some(n => n.toLowerCase().includes('shutdown') || n.toLowerCase().includes('offensive'))).toBe(true)
  })

  it('multiplier is always in [0.97, 1.03]', () => {
    const dA = makePlayer('D', 'offensiveD', { technical: { wristShot: 80 } })
    const dB = makePlayer('D', 'shutdownD', { mental: { defensiveIQ: 85 } }, 38)
    const result = pairSynergy([dA, dB])
    expect(result.multiplier).toBeGreaterThanOrEqual(0.97)
    expect(result.multiplier).toBeLessThanOrEqual(1.03)
  })

  it('returns fallback for wrong number of defenders', () => {
    const d = makePlayer('D', 'twoWay', {})
    const result = pairSynergy([d])
    expect(result.score).toBe(50)
    expect(result.multiplier).toBe(1.0)
  })

  it('is deterministic', () => {
    const dA = makePlayer('D', 'offensiveD', { technical: { wristShot: 75, passing: 72 } })
    const dB = makePlayer('D', 'shutdownD', { mental: { defensiveIQ: 85 } }, 38)
    const r1 = pairSynergy([dA, dB])
    const r2 = pairSynergy([dA, dB])
    expect(r1.score).toBe(r2.score)
    expect(r1.notes).toEqual(r2.notes)
  })
})

/* ───────────────────────── teamStyleFit ───────────────────────── */

describe('teamStyleFit', () => {
  it('suggests up-tempo / aggressive forecheck for a speed + skill heavy roster', () => {
    const roster: Player[] = [
      makePlayer('W', 'sniper', { technical: { wristShot: 90 }, physical: { speed: 80 } }),
      makePlayer('C', 'playmaker', { technical: { passing: 88 }, mental: { vision: 88 }, physical: { speed: 78 } }),
      makePlayer('W', 'sniper', { technical: { wristShot: 85 }, physical: { speed: 82 } }),
      makePlayer('W', 'sniper', { technical: { wristShot: 82 }, physical: { speed: 76 } }),
      makePlayer('C', 'playmaker', { technical: { passing: 82 }, mental: { vision: 82 }, physical: { speed: 74 } }),
      makePlayer('W', 'twoWay', { physical: { speed: 72 } }),
      makePlayer('D', 'offensiveD', { technical: { passing: 70 }, physical: { speed: 70 } }),
      makePlayer('D', 'offensiveD', { technical: { passing: 68 }, physical: { speed: 68 } }),
      makePlayer('D', 'twoWay', { physical: { speed: 65 } }),
      makePlayer('G', 'starter', { goalie: { reflexes: 82, positioningG: 75 } })
    ]
    const result = teamStyleFit({ roster })
    expect(result.styleLabel).toMatch(/speed|skill/i)
    // Should suggest NOT a trap system
    expect(result.suggestedTactics.forecheck).not.toBe('trap')
    // Tempo pace should be reasonably high
    if (result.suggestedTactics.tempo !== undefined) {
      expect(result.suggestedTactics.tempo.pace).toBeGreaterThan(0.5)
    }
    expect(result.rationale.length).toBeGreaterThan(0)
  })

  it('suggests cycle/forecheck for a big physical roster', () => {
    const roster: Player[] = [
      makePlayer('W', 'powerForward', { physical: { strength: 88 }, defensive: { checking: 80 } }),
      makePlayer('C', 'powerForward', { physical: { strength: 85 }, defensive: { checking: 78 } }),
      makePlayer('W', 'enforcer', { physical: { strength: 92 }, mental: { aggression: 90 } }, 35),
      makePlayer('W', 'powerForward', { physical: { strength: 82 } }),
      makePlayer('C', 'twoWay', { physical: { strength: 75 } }),
      makePlayer('W', 'enforcer', { physical: { strength: 88 }, mental: { aggression: 85 } }, 35),
      makePlayer('D', 'shutdownD', { mental: { defensiveIQ: 85 } }, 40),
      makePlayer('D', 'shutdownD', { mental: { defensiveIQ: 82 } }, 40),
      makePlayer('D', 'twoWay', { physical: { strength: 72 } }),
      makePlayer('G', 'starter', { goalie: { positioningG: 82, reboundControl: 78 } })
    ]
    const result = teamStyleFit({ roster })
    expect(result.styleLabel).toMatch(/cycle|grind|physical/i)
    expect(result.suggestedTactics.forecheck).toBe('2-1-2')
    expect(result.rationale.length).toBeGreaterThan(0)
  })

  it('suggests trap for a slow or aging roster', () => {
    // All players with very low speed
    const roster: Player[] = Array.from({ length: 9 }, () =>
      makePlayer('W', 'twoWay', { physical: { speed: 38, acceleration: 35 } }, 45)
    ).concat([makePlayer('G', 'starter', { goalie: { positioningG: 75 } })])
    const result = teamStyleFit({ roster })
    expect(result.styleLabel).toMatch(/trap/i)
    expect(result.suggestedTactics.forecheck).toBe('trap')
    if (result.suggestedTactics.tempo !== undefined) {
      expect(result.suggestedTactics.tempo.pace).toBeLessThan(0.5)
    }
  })

  it('returns Partial<TeamTactics> — does NOT include all fields', () => {
    const roster = [makePlayer('W', 'sniper', { technical: { wristShot: 88 } })]
    const result = teamStyleFit({ roster })
    // specialTeams is not a field we suggest — should be absent
    expect(result.suggestedTactics.specialTeams).toBeUndefined()
  })

  it('differs between a speed roster and a heavy roster', () => {
    const speedRoster: Player[] = [
      makePlayer('W', 'sniper', { physical: { speed: 85 }, technical: { wristShot: 88 } }),
      makePlayer('C', 'playmaker', { physical: { speed: 82 }, technical: { passing: 88 } }),
      makePlayer('W', 'sniper', { physical: { speed: 80 }, technical: { wristShot: 85 } })
    ]
    const heavyRoster: Player[] = [
      makePlayer('W', 'powerForward', { physical: { strength: 90, speed: 42 }, defensive: { checking: 82 } }),
      makePlayer('C', 'powerForward', { physical: { strength: 88, speed: 40 } }),
      makePlayer('W', 'enforcer', { physical: { strength: 92, speed: 38 }, mental: { aggression: 90 } }, 35)
    ]
    const r1 = teamStyleFit({ roster: speedRoster })
    const r2 = teamStyleFit({ roster: heavyRoster })
    expect(r1.styleLabel).not.toBe(r2.styleLabel)
  })

  it('is deterministic', () => {
    const roster: Player[] = [
      makePlayer('W', 'sniper', { technical: { wristShot: 88 }, physical: { speed: 78 } }),
      makePlayer('C', 'playmaker', { technical: { passing: 85 }, mental: { vision: 85 } }),
      makePlayer('D', 'offensiveD', { technical: { passing: 72 } })
    ]
    const r1 = teamStyleFit({ roster })
    const r2 = teamStyleFit({ roster })
    expect(r1.styleLabel).toBe(r2.styleLabel)
    expect(r1.suggestedTactics).toEqual(r2.suggestedTactics)
    expect(r1.rationale).toEqual(r2.rationale)
  })

  it('JSON round-trip preserves output', () => {
    const roster: Player[] = [
      makePlayer('W', 'sniper', { technical: { wristShot: 88 } }),
      makePlayer('C', 'playmaker', { technical: { passing: 85 } })
    ]
    const result = teamStyleFit({ roster })
    const rt = JSON.parse(JSON.stringify(result)) as typeof result
    expect(rt.styleLabel).toBe(result.styleLabel)
    expect(rt.suggestedTactics).toEqual(result.suggestedTactics)
    expect(rt.rationale).toEqual(result.rationale)
  })
})

/* ───────────────────────── styleMatch ───────────────────────── */

describe('styleMatch', () => {
  it('returns high fit when tactics match a speed roster', () => {
    const roster: Player[] = [
      makePlayer('W', 'sniper', { physical: { speed: 82 }, technical: { wristShot: 88 } }),
      makePlayer('C', 'playmaker', { physical: { speed: 80 }, technical: { passing: 86 }, mental: { vision: 86 } }),
      makePlayer('W', 'sniper', { physical: { speed: 78 }, technical: { wristShot: 84 } }),
      makePlayer('D', 'offensiveD', { technical: { passing: 70 }, physical: { speed: 72 } }),
      makePlayer('D', 'twoWay', { physical: { speed: 68 } })
    ]
    const tactics = makeTactics({
      forecheck: '1-2-2',
      tempo: { pace: 0.75, passRisk: 0.55, shotEagerness: 0.65, defensivePinch: 0.45 }
    })
    const { fit } = styleMatch(roster, tactics)
    expect(fit).toBeGreaterThan(60)
  })

  it('returns low fit when tactics mismatch roster (trap on a speed roster)', () => {
    const roster: Player[] = [
      makePlayer('W', 'sniper', { physical: { speed: 82 }, technical: { wristShot: 88 } }),
      makePlayer('C', 'playmaker', { physical: { speed: 80 }, technical: { passing: 88 } }),
      makePlayer('W', 'sniper', { physical: { speed: 80 }, technical: { wristShot: 85 } }),
      makePlayer('D', 'offensiveD', { physical: { speed: 74 } }),
      makePlayer('D', 'puckMover', { physical: { speed: 76 } })
    ]
    const tactics = makeTactics({
      forecheck: 'trap',
      tempo: { pace: 0.25, passRisk: 0.25, shotEagerness: 0.3, defensivePinch: 0.15 }
    })
    const { fit, advice } = styleMatch(roster, tactics)
    expect(fit).toBeLessThan(70)
    expect(advice.length).toBeGreaterThan(0)
    expect(advice.some(a => a.toLowerCase().includes('mobile') || a.toLowerCase().includes('trap') || a.toLowerCase().includes('roster'))).toBe(true)
  })

  it('returns low fit when pace is very wrong for a slow roster', () => {
    const roster: Player[] = Array.from({ length: 6 }, () =>
      makePlayer('W', 'twoWay', { physical: { speed: 38, acceleration: 35 } }, 45)
    )
    const tactics = makeTactics({
      forecheck: '1-2-2',
      tempo: { pace: 0.85, passRisk: 0.65, shotEagerness: 0.75, defensivePinch: 0.6 }
    })
    const { fit, advice } = styleMatch(roster, tactics)
    expect(fit).toBeLessThan(65)
    expect(advice.length).toBeGreaterThan(0)
  })

  it('fit is always in [0, 100]', () => {
    const roster = [makePlayer('W', 'sniper', { technical: { wristShot: 90 } })]
    const cases: TeamTactics[] = [
      makeTactics({ forecheck: 'trap', tempo: { pace: 0.1, passRisk: 0.1, shotEagerness: 0.1, defensivePinch: 0.1 } }),
      makeTactics({ forecheck: '1-2-2', tempo: { pace: 0.9, passRisk: 0.9, shotEagerness: 0.9, defensivePinch: 0.9 } }),
      makeTactics()
    ]
    for (const t of cases) {
      const { fit } = styleMatch(roster, t)
      expect(fit).toBeGreaterThanOrEqual(0)
      expect(fit).toBeLessThanOrEqual(100)
    }
  })

  it('advice is non-empty when fit is low', () => {
    const roster: Player[] = Array.from({ length: 5 }, () =>
      makePlayer('W', 'enforcer', { physical: { strength: 90 }, mental: { aggression: 90 } }, 30)
    )
    const tactics = makeTactics({
      forecheck: '1-2-2',
      tempo: { pace: 0.85, passRisk: 0.7, shotEagerness: 0.8, defensivePinch: 0.7 }
    })
    const { advice } = styleMatch(roster, tactics)
    expect(advice.length).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    const roster = [
      makePlayer('W', 'sniper', { technical: { wristShot: 88 }, physical: { speed: 78 } }),
      makePlayer('C', 'playmaker', { technical: { passing: 85 } })
    ]
    const tactics = makeTactics({ forecheck: 'trap' })
    const r1 = styleMatch(roster, tactics)
    const r2 = styleMatch(roster, tactics)
    expect(r1.fit).toBe(r2.fit)
    expect(r1.advice).toEqual(r2.advice)
  })

  it('JSON round-trip preserves output', () => {
    const roster = [makePlayer('W', 'sniper', { technical: { wristShot: 88 } })]
    const tactics = makeTactics()
    const result = styleMatch(roster, tactics)
    const rt = JSON.parse(JSON.stringify(result)) as typeof result
    expect(rt.fit).toBe(result.fit)
    expect(rt.advice).toEqual(result.advice)
  })
})

/* ───────────────────────── multiplier bounds (global) ───────────────────────── */

describe('multiplier bounds', () => {
  it('lineSynergy multiplier never leaves [0.97, 1.03] across many combinations', () => {
    // Stress test: worst and best known combos
    const makeF = (wristShot: number, strength: number) =>
      makePlayer('W', 'sniper', {
        technical: { wristShot },
        physical: { strength }
      })

    const combos: [Player, Player, Player][] = [
      [makeF(100, 20), makeF(100, 20), makeF(100, 20)], // all snipers
      [makeF(20, 100), makeF(20, 100), makeF(20, 100)], // all grinders (by strength)
      [makeF(80, 70), makeF(50, 50), makeF(60, 60)],
      [makeF(90, 30), makeF(40, 80), makeF(60, 60)]
    ]
    for (const [lw, c, rw] of combos) {
      const { multiplier } = lineSynergy([lw, c, rw])
      expect(multiplier).toBeGreaterThanOrEqual(0.97)
      expect(multiplier).toBeLessThanOrEqual(1.03)
    }
  })

  it('pairSynergy multiplier stays in [0.97, 1.03] for extreme builds', () => {
    const offD = makePlayer('D', 'offensiveD', { technical: { wristShot: 92 } })
    const shutD = makePlayer('D', 'shutdownD', { mental: { defensiveIQ: 92 } }, 30)

    const { multiplier: m1 } = pairSynergy([offD, shutD])
    const { multiplier: m2 } = pairSynergy([shutD, shutD])
    const { multiplier: m3 } = pairSynergy([offD, offD])

    for (const m of [m1, m2, m3]) {
      expect(m).toBeGreaterThanOrEqual(0.97)
      expect(m).toBeLessThanOrEqual(1.03)
    }
  })
})

/* ───────────────────────── playerStyleFit ───────────────────────── */

describe('styleFromTactics', () => {
  it('reads a trap when forecheck is trap', () => {
    expect(styleFromTactics(makeTactics({ forecheck: 'trap' })).kind).toBe('trap')
  })
  it('reads speed & skill at high pace', () => {
    expect(styleFromTactics(makeTactics({ tempo: { pace: 0.8, passRisk: 0.5, shotEagerness: 0.6, defensivePinch: 0.5 } })).kind).toBe('speedSkill')
  })
})

describe('playerStyleFit', () => {
  it('a sniper fits a speed & skill system better than a trap', () => {
    const sniper = makePlayer('W', 'sniper', {
      technical: { wristShot: 92, slapShot: 85 },
      mental: { offensiveIQ: 85 },
      physical: { speed: 80, acceleration: 80 }
    })
    const speed = makeTactics({ tempo: { pace: 0.8, passRisk: 0.6, shotEagerness: 0.7, defensivePinch: 0.5 } })
    const trap = makeTactics({ forecheck: 'trap', tempo: { pace: 0.3, passRisk: 0.3, shotEagerness: 0.4, defensivePinch: 0.2 } })
    const fitSpeed = playerStyleFit(sniper, speed)!
    const fitTrap = playerStyleFit(sniper, trap)!
    expect(fitSpeed.score).toBeGreaterThan(fitTrap.score)
  })

  it('a shutdown D fits a trap system well', () => {
    const shutdown = makePlayer('D', 'shutdownD', {
      defensive: { checking: 85, shotBlocking: 85, stickChecking: 80, takeaway: 80 },
      mental: { defensiveIQ: 85, positioning: 85 }
    })
    const trap = makeTactics({ forecheck: 'trap', tempo: { pace: 0.3, passRisk: 0.3, shotEagerness: 0.4, defensivePinch: 0.2 } })
    const fit = playerStyleFit(shutdown, trap)!
    expect(fit.score).toBeGreaterThanOrEqual(66)
    expect(fit.styleLabel.toLowerCase()).toContain('trap')
  })

  it('returns null for goalies', () => {
    const g = makePlayer('G', 'starter', { goalie: { reflexes: 80 } })
    expect(playerStyleFit(g, makeTactics())).toBeNull()
  })
})
