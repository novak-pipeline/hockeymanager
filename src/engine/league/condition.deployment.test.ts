/**
 * Deployment morale: a player expects to slot where his ability ranks on the
 * roster. Burying a star down the lineup (or healthy-scratching him) drains his
 * morale — fastest for the ambitious — while a depth player handed a big role
 * gets a lift. One tier of leeway is normal hockey and costs nothing, and
 * deliberate shelter (rest directive, easing back from injury) is exempt.
 */
import { describe, expect, it } from 'vitest'
import type { Lines, Personality, Player, PlayerId, Position, RawAttributes, Team, TeamColors } from '@domain'
import { asPlayerId, asTeamId } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import { applyDeploymentMorale, tickRecovery } from './condition'

let nextId = 1
const pid = (): PlayerId => asPlayerId(`p${nextId++}`)

function rawAttrs(val: number): RawAttributes {
  return {
    technical: { wristShot: val, slapShot: val, stickhandling: val, passing: val, deflections: val, faceoffs: val },
    physical: { speed: val, acceleration: val, strength: val, balance: val, stamina: val, agility: val, height: val },
    mental: {
      offensiveIQ: val, defensiveIQ: val, positioning: val, vision: val, aggression: val,
      composure: val, workRate: val, discipline: val, anticipation: val
    },
    defensive: { checking: val, shotBlocking: val, stickChecking: val, takeaway: val }
  }
}

// Personality on the real 1–20 scale (generation's range).
const personality = (ambition: number): Personality => ({
  ambition, professionalism: 10, loyalty: 10, temperament: 10, determination: 10
})

function makeSkater(position: Position, attr: number, ambition = 10, over: Partial<Player> = {}): Player {
  const id = pid()
  const ratings = rawAttrs(attr)
  return {
    id, name: `P${id}`, age: 25, position, handedness: 'L', role: 'twoWay',
    ratings, potential: ratings, composites: computeComposites(ratings, 'twoWay', position),
    personality: personality(ambition),
    contract: { salary: 1e6, yearsRemaining: 2, expiryYear: 2026, noTradeClause: false, twoWay: false },
    stats: [], fatigue: 0, morale: 60, injuryStatus: null, form: 0, ...over
  }
}

const teamColors: TeamColors = { primary: 0x003087, secondary: 0xffffff }

/** 12 forwards (attrs descending) + 6 D + a star forward placed wherever the
 *  test wants. Returns the roster map and a lines-builder. */
function setup(opts: { starAttr?: number; starAmbition?: number } = {}) {
  nextId = 1
  const star = makeSkater('C', opts.starAttr ?? 85, opts.starAmbition ?? 14)
  const forwards = [star, ...Array.from({ length: 11 }, (_, i) => makeSkater('W', 62 - i * 2))]
  const defense = Array.from({ length: 6 }, (_, i) => makeSkater('D', 60 - i * 2))
  const players = new Map<PlayerId, Player>()
  for (const p of [...forwards, ...defense]) players.set(p.id, p)

  const mkTeam = (fwdLines: PlayerId[][]): Team => ({
    id: asTeamId('TT'), name: 'Test', abbreviation: 'TT', city: 'Test', colors: teamColors,
    conferenceId: 'E', divisionId: 'A',
    roster: [...players.keys()],
    lines: {
      forwards: fwdLines as Lines['forwards'],
      defensePairs: [
        [defense[0].id, defense[1].id], [defense[2].id, defense[3].id], [defense[4].id, defense[5].id],
      ] as Lines['defensePairs'],
      goalies: [asPlayerId(''), asPlayerId('')] as Lines['goalies'],
      powerPlayUnits: [], penaltyKillUnits: [],
    },
    tactics: { forecheck: 'aggressive', breakout: 'controlled', powerPlay: 'overload', penaltyKill: 'passive', lineMatching: false } as Team['tactics'],
    finances: { budget: 1e7, salaryCap: 8e7, capUsed: 0, revenue: 0 },
    staff: { headCoachId: null, assistantCoachIds: [], scoutIds: [] },
  })

  const others = forwards.slice(1)
  return { star, forwards, others, players, mkTeam }
}

const resolveFrom = (players: Map<PlayerId, Player>) => (id: PlayerId): Player => players.get(id)!
const allPlayed = () => true

describe('applyDeploymentMorale', () => {
  it('drains a star buried on the fourth line; leaves correct slots alone', () => {
    const { star, others, players, mkTeam } = setup()
    // Talent order would put the star on L1; he's dressed on L4 instead.
    const team = mkTeam([
      [others[0].id, others[1].id, others[2].id],
      [others[3].id, others[4].id, others[5].id],
      [others[6].id, others[7].id, others[8].id],
      [star.id, others[9].id, others[10].id],
    ])
    const before = new Map([...players.values()].map((p) => [p.id as string, p.morale]))
    applyDeploymentMorale({ team, resolve: resolveFrom(players), played: allPlayed })
    expect(star.morale).toBeLessThan(before.get(star.id as string)!)
    // The second-best forward is on L1 where he belongs → untouched.
    expect(others[0].morale).toBe(before.get(others[0].id as string)!)
  })

  it('one tier of leeway costs nothing', () => {
    const { star, others, players, mkTeam } = setup()
    // Star (expected L1) dressed on L2 — normal coaching latitude.
    const team = mkTeam([
      [others[0].id, others[1].id, others[2].id],
      [star.id, others[3].id, others[4].id],
      [others[5].id, others[6].id, others[7].id],
      [others[8].id, others[9].id, others[10].id],
    ])
    applyDeploymentMorale({ team, resolve: resolveFrom(players), played: allPlayed })
    expect(star.morale).toBe(60)
  })

  it('a healthy scratch of a top-six talent stings; a scratched depth guy shrugs', () => {
    const { star, others, players, mkTeam } = setup()
    // Star left out of the lineup entirely; depth forward also out.
    const team = mkTeam([
      [others[0].id, others[1].id, others[2].id],
      [others[3].id, others[4].id, others[5].id],
      [others[6].id, others[7].id, others[8].id],
      [others[9].id, others[10].id, others[10].id],
    ])
    const played = (id: PlayerId): boolean => id !== star.id
    applyDeploymentMorale({ team, resolve: resolveFrom(players), played })
    expect(star.morale).toBeLessThan(60)
    // Depth guys rotate all season — no sting for them (others[10] not penalized
    // even when off the ice).
    expect(others[10].morale).toBe(60)
  })

  it('a depth forward promoted to the top line gets a lift', () => {
    const { star, others, players, mkTeam } = setup()
    // Weakest forward (expected L4) skates on L1.
    const team = mkTeam([
      [star.id, others[9].id, others[10].id],
      [others[0].id, others[1].id, others[2].id],
      [others[3].id, others[4].id, others[5].id],
      [others[6].id, others[7].id, others[8].id],
    ])
    applyDeploymentMorale({ team, resolve: resolveFrom(players), played: allPlayed })
    expect(others[10].morale).toBeGreaterThan(60)
  })

  it('ambitious players sour faster than content ones', () => {
    const runWith = (ambition: number): number => {
      const { star, others, players, mkTeam } = setup({ starAmbition: ambition })
      const team = mkTeam([
        [others[0].id, others[1].id, others[2].id],
        [others[3].id, others[4].id, others[5].id],
        [others[6].id, others[7].id, others[8].id],
        [star.id, others[9].id, others[10].id],
      ])
      applyDeploymentMorale({ team, resolve: resolveFrom(players), played: allPlayed })
      return 60 - star.morale
    }
    expect(runWith(19)).toBeGreaterThan(runWith(3))
  })

  it('deliberate shelter is exempt: resting or easing back from injury', () => {
    for (const shelter of [{ resting: true }, { rustGames: 4 }] as const) {
      const { star, others, players, mkTeam } = setup()
      Object.assign(star, shelter)
      const team = mkTeam([
        [others[0].id, others[1].id, others[2].id],
        [others[3].id, others[4].id, others[5].id],
        [others[6].id, others[7].id, others[8].id],
        [star.id, others[9].id, others[10].id],
      ])
      applyDeploymentMorale({ team, resolve: resolveFrom(players), played: allPlayed })
      expect(star.morale).toBe(60)
    }
  })

  it('a persistently buried star sinks into the unhappy band despite drift', () => {
    const { star, others, players, mkTeam } = setup({ starAmbition: 16 })
    const team = mkTeam([
      [others[0].id, others[1].id, others[2].id],
      [others[3].id, others[4].id, others[5].id],
      [others[6].id, others[7].id, others[8].id],
      [star.id, others[9].id, others[10].id],
    ])
    const rng = new Rng(5)
    for (let g = 0; g < 25; g++) {
      applyDeploymentMorale({ team, resolve: resolveFrom(players), played: allPlayed })
      // The daily tick pulls morale back toward 60 — the burial must out-pull it.
      tickRecovery({ players: players.values(), playedToday: () => true, rng })
    }
    // Low enough to trigger the "unhappy" concern (< 38) — role decisions now
    // feed the interaction system.
    expect(star.morale).toBeLessThan(38)
    // A correctly deployed teammate stays near baseline.
    expect(others[0].morale).toBeGreaterThan(50)
  })
})
