/**
 * Shared trade-test fixtures: minimal Player/Team/DraftPick builders used by
 * trades.test.ts and tradeRealism.test.ts.
 */
import {
  asPlayerId,
  asTeamId,
  type DraftPick,
  type Player,
  type PlayerRole,
  type Position,
  type RawAttributes,
  type Team
} from '@domain'
import { computeComposites } from '@engine/ratings/composites'


export function rawAttrs(v: number, position: Position): RawAttributes {
  const raw: RawAttributes = {
    technical: { wristShot: v, slapShot: v, stickhandling: v, passing: v, deflections: v, faceoffs: v },
    physical: { speed: v, acceleration: v, strength: v, balance: v, stamina: v, agility: v, height: 50 },
    mental: {
      offensiveIQ: v,
      defensiveIQ: v,
      positioning: v,
      vision: v,
      aggression: 50,
      composure: v,
      workRate: v,
      discipline: 55,
      anticipation: v
    },
    defensive: { checking: v, shotBlocking: v, stickChecking: v, takeaway: v }
  }
  if (position === 'G') {
    raw.goalie = {
      reflexes: v,
      positioningG: v,
      reboundControl: v,
      glove: v,
      blocker: v,
      recovery: v,
      puckHandlingG: v
    }
  }
  return raw
}

export interface PlayerOpts {
  age?: number
  position?: Position
  salary?: number
  years?: number
  ntc?: boolean
  potential?: number
  morale?: number
  injuryGames?: number
}

export function makePlayer(id: string, v: number, opts: PlayerOpts = {}): Player {
  const position = opts.position ?? 'C'
  const role: PlayerRole = position === 'G' ? 'starter' : 'twoWay'
  const ratings = rawAttrs(v, position)
  const years = opts.years ?? 3
  return {
    id: asPlayerId(id),
    name: `Player ${id}`,
    age: opts.age ?? 25,
    position,
    handedness: 'L',
    role,
    ratings,
    potential: rawAttrs(opts.potential ?? v, position),
    composites: computeComposites(ratings, role, position),
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10 },
    contract: {
      salary: opts.salary ?? 3_000_000,
      yearsRemaining: years,
      expiryYear: 2026 + years,
      noTradeClause: opts.ntc ?? false,
      twoWay: false
    },
    stats: [],
    fatigue: 0,
    morale: opts.morale ?? 70,
    injuryStatus:
      opts.injuryGames !== undefined
        ? { kind: 'lowerBody', gamesRemaining: opts.injuryGames, description: 'test injury' }
        : null,
    form: 0
  }
}

export function makeTeam(id: string, roster: Player[], opts: { capUsed?: number } = {}): Team {
  return {
    id: asTeamId(id),
    name: `Team ${id.toUpperCase()}`,
    abbreviation: id.toUpperCase().slice(0, 3),
    city: 'Test City',
    colors: { primary: 0x112233, secondary: 0xddeeff },
    conferenceId: 'c1',
    divisionId: 'd1',
    roster: roster.map((p) => p.id),
    lines: {
      forwards: [],
      defensePairs: [],
      goalies: [asPlayerId(`${id}-gx`), asPlayerId(`${id}-gy`)],
      powerPlayUnits: [],
      penaltyKillUnits: []
    },
    tactics: {
      forecheck: '1-2-2',
      dZoneCoverage: 'zone',
      tempo: { pace: 0.5, passRisk: 0.5, shotEagerness: 0.5, defensivePinch: 0.5 },
      specialTeams: { powerPlay: 'umbrella', penaltyKill: 'box' },
      lineMatching: false
    },
    finances: {
      budget: 90e6,
      salaryCap: 88e6,
      capUsed: opts.capUsed ?? roster.reduce((s, p) => s + p.contract.salary, 0),
      revenue: 0
    },
    staff: { headCoachId: null, assistantCoachIds: [], scoutIds: [] }
  }
}

export const makePick = (year: number, round: number, original: string, owner = original): DraftPick => ({
  year,
  round,
  originalTeamId: asTeamId(original),
  ownerTeamId: asTeamId(owner)
})

