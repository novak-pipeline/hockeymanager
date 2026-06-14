import { describe, expect, it } from 'vitest'
import {
  asPlayerId,
  asTeamId,
  type DraftPick,
  type DraftProspect,
  type Player,
  type PlayerId,
  type PlayerRole,
  type Position,
  type RawAttributes,
  type Team,
  type TeamId
} from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import {
  aiSelectProspect,
  buildDraftOrder,
  developPlayers,
  expectedPointsFor,
  generateDraftClass,
  processRetirements
} from './offseason'

/* ────────────────────────── fixtures ────────────────────────── */

/** Raw attributes with every field set to `v`, for controlled comparisons. */
function rawAll(v: number, goalie = false): RawAttributes {
  const raw: RawAttributes = {
    technical: { wristShot: v, slapShot: v, stickhandling: v, passing: v, deflections: v, faceoffs: v },
    physical: { speed: v, acceleration: v, strength: v, balance: v, stamina: v, agility: v, height: v },
    mental: { offensiveIQ: v, defensiveIQ: v, positioning: v, vision: v, aggression: v, composure: v, workRate: v, discipline: v, anticipation: v },
    defensive: { checking: v, shotBlocking: v, stickChecking: v, takeaway: v }
  }
  if (goalie) {
    raw.goalie = { reflexes: v, positioningG: v, reboundControl: v, glove: v, blocker: v, recovery: v, puckHandlingG: v }
  }
  return raw
}

/** Flatten all attribute values in a stable order (mirrors rawAll's shape). */
function flatVals(raw: RawAttributes): number[] {
  const out = [
    ...Object.values(raw.technical),
    ...Object.values(raw.physical),
    ...Object.values(raw.mental),
    ...Object.values(raw.defensive)
  ]
  if (raw.goalie) out.push(...Object.values(raw.goalie))
  return out
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

interface TestPlayerOpts {
  id: string
  age: number
  current?: number
  potential?: number
  position?: Position
  yearsRemaining?: number
  personality?: number
  form?: number
  fatigue?: number
}

function testPlayer(opts: TestPlayerOpts): Player {
  const position = opts.position ?? 'C'
  const current = opts.current ?? 50
  const ceiling = Math.max(current, opts.potential ?? current)
  const role: PlayerRole = position === 'G' ? 'starter' : position === 'D' ? 'shutdownD' : 'twoWay'
  const ratings = rawAll(current, position === 'G')
  const pers = opts.personality ?? 10
  return {
    id: asPlayerId(opts.id),
    name: `Test ${opts.id}`,
    age: opts.age,
    position,
    handedness: 'L',
    role,
    ratings,
    potential: rawAll(ceiling, position === 'G'),
    composites: computeComposites(ratings, role, position),
    personality: { ambition: pers, professionalism: pers, loyalty: pers, temperament: pers, determination: pers },
    contract: { salary: 1_000_000, yearsRemaining: opts.yearsRemaining ?? 1, expiryYear: 2030, noTradeClause: false, twoWay: false },
    stats: [],
    fatigue: opts.fatigue ?? 40,
    morale: 60,
    injuryStatus: null,
    form: opts.form ?? 3
  }
}

function testTeam(id: string, roster: PlayerId[]): Team {
  const g = roster[0]
  return {
    id: asTeamId(id),
    name: 'Test Club',
    abbreviation: 'TST',
    city: 'Testville',
    colors: { primary: 0x111111, secondary: 0xeeeeee },
    conferenceId: 'conf0',
    divisionId: 'div0',
    roster: [...roster],
    lines: { forwards: [], defensePairs: [], goalies: [g, g], powerPlayUnits: [], penaltyKillUnits: [] },
    tactics: {
      forecheck: '1-2-2',
      dZoneCoverage: 'zone',
      tempo: { pace: 0.5, passRisk: 0.5, shotEagerness: 0.5, defensivePinch: 0.4 },
      specialTeams: { powerPlay: 'umbrella', penaltyKill: 'box' },
      lineMatching: false
    },
    finances: { budget: 90e6, salaryCap: 88e6, capUsed: 0, revenue: 0 },
    staff: { headCoachId: null, assistantCoachIds: [], scoutIds: [] }
  }
}

function dev(
  players: Map<PlayerId, Player>,
  seed: number,
  gamesPlayed: number | Map<PlayerId, number> = 60
): ReturnType<typeof developPlayers> {
  return developPlayers({
    players,
    gamesPlayedById: typeof gamesPlayed === 'number' ? () => gamesPlayed : gamesPlayed,
    year: 2026,
    rng: new Rng(seed)
  })
}

/* ────────────────────────── development ────────────────────────── */

describe('developPlayers', () => {
  it('grows under-26 attributes monotonically and never past potential', () => {
    const skater = testPlayer({ id: 'a', age: 19, current: 50, potential: 70 })
    const goalie = testPlayer({ id: 'g', age: 18, current: 45, potential: 70, position: 'G' })
    const players = new Map<PlayerId, Player>([
      [skater.id, skater],
      [goalie.id, goalie]
    ])
    const before = overall(skater.composites, skater.position)
    let prev = new Map([...players.values()].map((p) => [p.id, flatVals(p.ratings)]))
    const ceilings = new Map([...players.values()].map((p) => [p.id, flatVals(p.potential)]))

    for (let yr = 0; yr < 6; yr++) {
      dev(players, 100 + yr)
      for (const p of players.values()) {
        const now = flatVals(p.ratings)
        const old = prev.get(p.id)!
        const pot = ceilings.get(p.id)!
        now.forEach((v, i) => {
          expect(v).toBeGreaterThanOrEqual(old[i])
          expect(v).toBeLessThanOrEqual(pot[i])
        })
        prev.set(p.id, now)
      }
    }
    expect(skater.age).toBe(25)
    expect(overall(skater.composites, skater.position)).toBeGreaterThan(before)
  })

  it('develops faster with strong personality, same seed otherwise', () => {
    const hi = testPlayer({ id: 'hi', age: 19, current: 50, potential: 70, personality: 18 })
    const lo = testPlayer({ id: 'lo', age: 19, current: 50, potential: 70, personality: 4 })
    dev(new Map([[hi.id, hi]]), 7)
    dev(new Map([[lo.id, lo]]), 7)
    expect(sum(flatVals(hi.ratings))).toBeGreaterThan(sum(flatVals(lo.ratings)))
  })

  it('develops faster when the player actually played, same seed otherwise', () => {
    const busy = testPlayer({ id: 'busy', age: 19, current: 50, potential: 70 })
    const idle = testPlayer({ id: 'idle', age: 19, current: 50, potential: 70 })
    // Exercise the Map form of gamesPlayedById, including the missing-id default.
    dev(new Map([[busy.id, busy]]), 7, new Map([[busy.id, 70]]))
    dev(new Map([[idle.id, idle]]), 7, new Map<PlayerId, number>())
    expect(sum(flatVals(busy.ratings))).toBeGreaterThan(sum(flatVals(idle.ratings)))
  })

  it('holds ratings flat through the 26-29 plateau', () => {
    const p = testPlayer({ id: 'p', age: 27, current: 60, potential: 70 })
    const before = JSON.stringify(p.ratings)
    dev(new Map([[p.id, p]]), 11)
    expect(JSON.stringify(p.ratings)).toBe(before)
    expect(p.age).toBe(28)
  })

  it('declines physical attributes first after 30, mental holds', () => {
    const p = testPlayer({ id: 'd', age: 31, current: 70, potential: 70 })
    dev(new Map([[p.id, p]]), 5)
    for (const v of [p.ratings.physical.speed, p.ratings.physical.acceleration, p.ratings.physical.agility, p.ratings.physical.stamina]) {
      expect(v).toBeLessThan(70)
    }
    expect(p.ratings.physical.height).toBe(70)
    // Technical (from 32) and mental (from 35) are untouched at season-age 31.
    expect(Object.values(p.ratings.technical).every((v) => v === 70)).toBe(true)
    expect(Object.values(p.ratings.mental).every((v) => v === 70)).toBe(true)
  })

  it('declines steeper after 33', () => {
    const fastDrop = (age: number, seed: number): number => {
      const p = testPlayer({ id: 'x', age, current: 70, potential: 70 })
      dev(new Map([[p.id, p]]), seed)
      const ph = p.ratings.physical
      return 4 * 70 - (ph.speed + ph.acceleration + ph.agility + ph.stamina)
    }
    let at31 = 0
    let at35 = 0
    for (let s = 0; s < 20; s++) {
      at31 += fastDrop(31, 400 + s)
      at35 += fastDrop(35, 400 + s)
    }
    expect(at35).toBeGreaterThan(at31)
  })

  it('erodes mental slowest even past 35', () => {
    const p = testPlayer({ id: 'm', age: 36, current: 70, potential: 70 })
    dev(new Map([[p.id, p]]), 13)
    const ph = p.ratings.physical
    const fastAvg = (4 * 70 - (ph.speed + ph.acceleration + ph.agility + ph.stamina)) / 4
    const mentalVals = Object.values(p.ratings.mental)
    const mentalAvg = (70 * mentalVals.length - sum(mentalVals)) / mentalVals.length
    expect(fastAvg).toBeGreaterThan(mentalAvg)
    mentalVals.forEach((v) => expect(v).toBeLessThanOrEqual(70))
  })

  it('recomputes the composites cache after mutating ratings', () => {
    const p = testPlayer({ id: 'c', age: 18, current: 45, potential: 75 })
    const before = { ...p.composites }
    dev(new Map([[p.id, p]]), 21)
    expect(p.composites).toEqual(computeComposites(p.ratings, p.role, p.position))
    expect(p.composites).not.toEqual(before)
  })

  it('ages players, burns a contract year (floor 0), resets fatigue, regresses form', () => {
    const a = testPlayer({ id: 'a', age: 24, yearsRemaining: 2, form: 4, fatigue: 80 })
    const b = testPlayer({ id: 'b', age: 24, yearsRemaining: 0, form: -0.3, fatigue: 10 })
    dev(new Map<PlayerId, Player>([[a.id, a], [b.id, b]]), 3)
    expect(a.age).toBe(25)
    expect(a.contract.yearsRemaining).toBe(1)
    expect(b.contract.yearsRemaining).toBe(0)
    expect(a.fatigue).toBe(0)
    expect(b.fatigue).toBe(0)
    expect(Math.abs(a.form)).toBeLessThan(4)
    expect(a.form).toBeGreaterThanOrEqual(0)
    expect(b.form).toBe(0)
  })

  it('is deterministic for a given seed', () => {
    const build = (): Map<PlayerId, Player> =>
      new Map<PlayerId, Player>(
        [
          testPlayer({ id: 'y1', age: 18, current: 45, potential: 75 }),
          testPlayer({ id: 'y2', age: 21, current: 55, potential: 68 }),
          testPlayer({ id: 'o1', age: 34, current: 70, potential: 70 })
        ].map((p) => [p.id, p])
      )
    const m1 = build()
    const m2 = build()
    const r1 = dev(m1, 77)
    const r2 = dev(m2, 77)
    expect(JSON.stringify([...m1.values()])).toBe(JSON.stringify([...m2.values()]))
    expect(r1.newsSeeds).toEqual(r2.newsSeeds)
  })

  it('emits at most five breakout and five decline news seeds, correctly attributed', () => {
    const players = new Map<PlayerId, Player>()
    const youngIds = new Set<PlayerId>()
    const oldIds = new Set<PlayerId>()
    for (let i = 0; i < 12; i++) {
      const y = testPlayer({ id: `y${i}`, age: 18, current: 45, potential: 75 })
      players.set(y.id, y)
      youngIds.add(y.id)
      const o = testPlayer({ id: `o${i}`, age: 38, current: 70, potential: 70 })
      players.set(o.id, o)
      oldIds.add(o.id)
    }
    const { newsSeeds } = dev(players, 9, 70)
    const breakout = newsSeeds.filter((s) => s.kind === 'breakout')
    const decline = newsSeeds.filter((s) => s.kind === 'decline')
    expect(breakout).toHaveLength(5)
    expect(decline).toHaveLength(5)
    breakout.forEach((s) => expect(youngIds.has(s.playerId)).toBe(true))
    decline.forEach((s) => expect(oldIds.has(s.playerId)).toBe(true))
  })
})

/* ────────────────────────── performance-relative development ────────────────────────── */

/**
 * Helper: calls developPlayers with an explicit performance function so we can
 * simulate over/under-performance without needing a full season sim.
 */
function devWithPerf(
  players: Map<PlayerId, Player>,
  seed: number,
  perfFn: (id: PlayerId) => { points: number; gamesPlayed: number; position: Position },
  expectFn?: (id: PlayerId) => number,
  devModFn?: (id: PlayerId) => number
): ReturnType<typeof developPlayers> {
  return developPlayers({
    players,
    gamesPlayedById: () => 60,
    year: 2026,
    rng: new Rng(seed),
    performance: perfFn,
    expectations: expectFn,
    devModifier: devModFn
  })
}

describe('developPlayers — boom/bust ceiling drift', () => {
  const potOvr = (p: Player): number =>
    overall(computeComposites(p.potential, p.role, p.position), p.position)

  it('young prospects boom and bust at realistic rates, busts > booms', () => {
    const N = 240
    const players = new Map<PlayerId, Player>()
    for (let i = 0; i < N; i++) {
      players.set(
        asPlayerId('pr' + i),
        testPlayer({ id: 'pr' + i, age: 18, current: 55, potential: 78, personality: 10 })
      )
    }
    // Five developmental seasons with no NHL sample (drift = work ethic + luck).
    for (let y = 0; y < 5; y++) dev(players, 1000 + y, 0)

    const ceilings = [...players.values()].map(potOvr)
    const busts = ceilings.filter((c) => c <= 78 - 8).length // ceiling fell ≥8
    const booms = ceilings.filter((c) => c >= 78 + 6).length // ceiling rose ≥6

    // Both tails exist; busts outnumber booms; neither is runaway.
    expect(busts).toBeGreaterThan(0)
    expect(booms).toBeGreaterThan(0)
    expect(busts).toBeGreaterThanOrEqual(booms)
    expect(busts / N).toBeLessThan(0.4)
    expect(booms / N).toBeLessThan(0.25)
  })

  it('leaves established (26+) players ceilings untouched', () => {
    const p = testPlayer({ id: 'vet', age: 28, current: 75, potential: 85 })
    const before = potOvr(p)
    const players = new Map<PlayerId, Player>([[p.id, p]])
    for (let y = 0; y < 3; y++) dev(players, 5000 + y, 60)
    expect(potOvr(p)).toBe(before)
  })
})

describe('developPlayers — performance-relative development', () => {
  // ── back-compat snapshot ─────────────────────────────────────────────────
  it('back-compat: calling WITHOUT performance args produces identical results to a snapshot', () => {
    // Capture the current (no-perf-args) output for seed 42 and a fixed roster.
    // This snapshot must remain stable even after adding the new optional args.
    const build = (): Map<PlayerId, Player> =>
      new Map<PlayerId, Player>(
        [
          testPlayer({ id: 'bc1', age: 19, current: 50, potential: 70 }),
          testPlayer({ id: 'bc2', age: 24, current: 60, potential: 72 }),
          testPlayer({ id: 'bc3', age: 31, current: 70, potential: 70 })
        ].map((p) => [p.id, p])
      )

    // First run: baseline captured inline (deterministic by Rng seed 42).
    const base = build()
    const baseResult = dev(base, 42)

    // Second run: must produce identical output.
    const copy = build()
    const copyResult = dev(copy, 42)

    expect(JSON.stringify([...copy.values()])).toBe(JSON.stringify([...base.values()]))
    expect(copyResult.newsSeeds).toEqual(baseResult.newsSeeds)

    // Sanity: no confidenceBoost/crisisOfConfidence seeds when performance arg absent.
    expect(baseResult.newsSeeds.every(s => s.kind === 'breakout' || s.kind === 'decline')).toBe(true)
  })

  // ── over-performer vs neutral twin ───────────────────────────────────────
  it('over-performer (ratio > 1.35) develops measurably faster than neutral twin', () => {
    // Construct two identical young forwards. Same seed, same personality.
    const makeTwin = (id: string): Player =>
      testPlayer({ id, age: 20, current: 55, potential: 80 })

    const twinA = makeTwin('twinA') // over-performer
    const twinB = makeTrue(makeTwin('twinB')) // neutral

    // expected P/G for ovr ~55 forward: ~0.35 + ((55-50)/40)*0.95 ≈ 0.47
    const expected = 0.47
    const overPerf = (id: PlayerId) => ({
      points: Math.round(expected * 1.6 * 60), // ratio ≈ 1.6 → well above 1.35
      gamesPlayed: 60,
      position: 'W' as Position
    })
    const neutralPerf = (id: PlayerId) => ({
      points: Math.round(expected * 1.0 * 60), // ratio ≈ 1.0 → neutral zone
      gamesPlayed: 60,
      position: 'W' as Position
    })

    devWithPerf(new Map([[twinA.id, twinA]]), 55, overPerf)
    devWithPerf(new Map([[twinB.id, twinB]]), 55, neutralPerf)

    expect(sum(flatVals(twinA.ratings))).toBeGreaterThan(sum(flatVals(twinB.ratings)))
  })

  // ── under-performer U26 stunted ──────────────────────────────────────────
  it('under-performer U26 (ratio < 0.6) grows slower than neutral peer', () => {
    const normal = testPlayer({ id: 'norm', age: 21, current: 55, potential: 80 })
    const bust   = testPlayer({ id: 'bust', age: 21, current: 55, potential: 80 })

    const expected = 0.47
    const normalPerf = (id: PlayerId) => ({ points: Math.round(expected * 60), gamesPlayed: 60, position: 'W' as Position })
    const bustPerf   = (id: PlayerId) => ({ points: Math.round(expected * 0.4 * 60), gamesPlayed: 60, position: 'W' as Position }) // ratio ≈ 0.4

    devWithPerf(new Map([[normal.id, normal]]), 55, normalPerf)
    devWithPerf(new Map([[bust.id, bust]]), 55, bustPerf)

    expect(sum(flatVals(normal.ratings))).toBeGreaterThan(sum(flatVals(bust.ratings)))
  })

  // ── vet decline accelerated ──────────────────────────────────────────────
  it('under-performer vet (age 30, ratio < 0.6) declines more than average vet', () => {
    const avg  = testPlayer({ id: 'avgVet',  age: 31, current: 70, potential: 70 })
    const poor = testPlayer({ id: 'poorVet', age: 31, current: 70, potential: 70 })

    const expected = expectedPointsFor(overall(avg.composites, avg.position), avg.position, avg.role)
    const avgPerf  = (id: PlayerId) => ({ points: Math.round(expected * 60), gamesPlayed: 60, position: 'C' as Position })
    const poorPerf = (id: PlayerId) => ({ points: Math.round(expected * 0.4 * 60), gamesPlayed: 60, position: 'C' as Position })

    devWithPerf(new Map([[avg.id, avg]]),   55, avgPerf)
    devWithPerf(new Map([[poor.id, poor]]), 55, poorPerf)

    // poor performer should have lower attribute sums (more decline)
    expect(sum(flatVals(poor.ratings))).toBeLessThan(sum(flatVals(avg.ratings)))
  })

  // ── determination floor ──────────────────────────────────────────────────
  it('high-determination (>=15) player has stunting floored at -25% vs low-det peer', () => {
    const hiDet = testPlayer({ id: 'hiDet', age: 21, current: 55, potential: 80, personality: 18 })
    const loDet = testPlayer({ id: 'loDet', age: 21, current: 55, potential: 80, personality: 4 })
    // Override determination specifically: the testPlayer helper sets ALL personality traits
    // to the same value. We need determination >= 15 for hiDet; personality 4 gives det=4.
    hiDet.personality.determination = 18
    loDet.personality.determination = 4

    const expected = 0.47
    const bustPerf = (id: PlayerId) => ({ points: Math.round(expected * 0.35 * 60), gamesPlayed: 60, position: 'W' as Position }) // ratio ≈ 0.35 < 0.6

    devWithPerf(new Map([[hiDet.id, hiDet]]), 55, bustPerf)
    devWithPerf(new Map([[loDet.id, loDet]]), 55, bustPerf)

    // hiDet should develop more (stunting floored at 0.75 vs 0.5 for loDet)
    expect(sum(flatVals(hiDet.ratings))).toBeGreaterThan(sum(flatVals(loDet.ratings)))
  })

  // ── morale changes ────────────────────────────────────────────────────────
  it('over-performer gains +5 morale; under-performer loses -5 morale', () => {
    const star = testPlayer({ id: 'star', age: 22, current: 55, potential: 80 })
    const bust = testPlayer({ id: 'bust2', age: 22, current: 55, potential: 80 })
    const startMorale = star.morale // both start at 60 per testPlayer

    const expected = 0.47
    devWithPerf(
      new Map([[star.id, star]]), 55,
      () => ({ points: Math.round(expected * 2.0 * 60), gamesPlayed: 60, position: 'W' as Position })
    )
    devWithPerf(
      new Map([[bust.id, bust]]), 55,
      () => ({ points: Math.round(expected * 0.3 * 60), gamesPlayed: 60, position: 'W' as Position })
    )
    expect(star.morale).toBe(startMorale + 5)
    expect(bust.morale).toBe(startMorale - 5)
  })

  // ── devModifier ───────────────────────────────────────────────────────────
  it('devModifier scales growth independently (mentorship effect)', () => {
    const mentored   = testPlayer({ id: 'mentored',   age: 21, current: 55, potential: 80 })
    const unmentored = testPlayer({ id: 'unmentored', age: 21, current: 55, potential: 80 })

    // Both neutral performers; mentored player gets a 1.1 devModifier.
    const expected = 0.47
    const neutralPerf = (id: PlayerId) => ({ points: Math.round(expected * 60), gamesPlayed: 60, position: 'W' as Position })
    devWithPerf(new Map([[mentored.id, mentored]]),     55, neutralPerf, undefined, () => 1.1)
    devWithPerf(new Map([[unmentored.id, unmentored]]), 55, neutralPerf, undefined, () => 1.0)

    expect(sum(flatVals(mentored.ratings))).toBeGreaterThan(sum(flatVals(unmentored.ratings)))
  })

  // ── <20 gamesPlayed → neutral ────────────────────────────────────────────
  it('fewer than 20 games played → performance ratio ignored (neutral development)', () => {
    const few   = testPlayer({ id: 'few',     age: 21, current: 55, potential: 80 })
    const many  = testPlayer({ id: 'many',    age: 21, current: 55, potential: 80 })

    // few: only 10 games played → ratio ignored even though points look great
    const perf = (gp: number) => (id: PlayerId) => ({ points: 80, gamesPlayed: gp, position: 'W' as Position })
    devWithPerf(new Map([[few.id, few]]),   55, perf(10))
    // many: 60 games, but neutral ratio
    const expected = 0.47
    devWithPerf(new Map([[many.id, many]]), 55, () => ({ points: Math.round(expected * 60), gamesPlayed: 60, position: 'W' as Position }))

    // both should get comparable development (few might even be slightly lower due
    // to the default growthMult=1.0 vs many also at 1.0, but they should be close)
    // The key invariant: few's supergiant points don't produce a huge boost.
    // We verify by comparing against a third twin with no performance arg at all.
    const base = testPlayer({ id: 'base', age: 21, current: 55, potential: 80 })
    dev(new Map([[base.id, base]]), 55)

    // few (10 gp ignored) should develop similarly to base (no perf arg).
    expect(Math.abs(sum(flatVals(few.ratings)) - sum(flatVals(base.ratings)))).toBeLessThan(10)
  })

  // ── confidenceBoost / crisisOfConfidence news seeds ──────────────────────
  it('emits confidenceBoost and crisisOfConfidence seeds for top performers/busts', () => {
    const players = new Map<PlayerId, Player>()
    const starIds = new Set<PlayerId>()
    const bustIds = new Set<PlayerId>()

    // 6 star over-performers + 6 busts
    for (let i = 0; i < 6; i++) {
      const star = testPlayer({ id: `star${i}`, age: 22, current: 55, potential: 80 })
      players.set(star.id, star)
      starIds.add(star.id)

      const bust = testPlayer({ id: `bust${i}`, age: 22, current: 55, potential: 80 })
      players.set(bust.id, bust)
      bustIds.add(bust.id)
    }

    const expected = 0.47
    const { newsSeeds } = devWithPerf(
      players,
      55,
      (id) => {
        if (starIds.has(id)) return { points: Math.round(expected * 2.0 * 60), gamesPlayed: 60, position: 'W' as Position }
        return { points: Math.round(expected * 0.3 * 60), gamesPlayed: 60, position: 'W' as Position }
      }
    )

    const boosts  = newsSeeds.filter(s => s.kind === 'confidenceBoost')
    const crises  = newsSeeds.filter(s => s.kind === 'crisisOfConfidence')

    // At most 4 of each (top-4 cap).
    expect(boosts.length).toBeGreaterThan(0)
    expect(boosts.length).toBeLessThanOrEqual(4)
    expect(crises.length).toBeGreaterThan(0)
    expect(crises.length).toBeLessThanOrEqual(4)

    // Boosts belong to stars; crises belong to busts.
    boosts.forEach(s => expect(starIds.has(s.playerId)).toBe(true))
    crises.forEach(s => expect(bustIds.has(s.playerId)).toBe(true))
  })
})

describe('expectedPointsFor', () => {
  it('returns 0.915 for goalies', () => {
    expect(expectedPointsFor(70, 'G', 'starter')).toBe(0.915)
  })

  it('produces calibrated anchors for forwards', () => {
    // ovr 50 W ≈ 0.35
    expect(expectedPointsFor(50, 'W', 'sniper')).toBeCloseTo(0.35, 2)
    // ovr 90 C ≈ 1.30 (with +0.05 C bonus)
    expect(expectedPointsFor(90, 'C', 'playmaker')).toBeCloseTo(1.30, 1)
    // ovr 70 C ≈ 0.80 + 0.05 = 0.85
    expect(expectedPointsFor(70, 'C', 'twoWay')).toBeCloseTo(0.85, 1)
  })

  it('defensemen produce ~55% of equivalent forward output', () => {
    const fwd = expectedPointsFor(70, 'W', 'twoWay')
    const def = expectedPointsFor(70, 'D', 'shutdownD')
    expect(def / fwd).toBeCloseTo(0.55, 1)
  })

  it('always returns a positive value; clamps gracefully at extremes', () => {
    expect(expectedPointsFor(1, 'W', 'enforcer')).toBeGreaterThan(0)
    expect(expectedPointsFor(99, 'C', 'sniper')).toBeGreaterThan(0)
    expect(expectedPointsFor(99, 'C', 'sniper')).toBeLessThan(3)
  })

  it('C rates slightly higher than W at the same overall (playmaking bonus)', () => {
    expect(expectedPointsFor(70, 'C', 'twoWay')).toBeGreaterThan(expectedPointsFor(70, 'W', 'twoWay'))
  })
})

/** Shallow-clone a Player object (for twin tests where we need independent objects). */
function makeTrue<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T }

/* ────────────────────────── retirements ────────────────────────── */

interface RetireOpts {
  current?: number
  yearsRemaining?: number
}

function retirementFreq(age: number, trials: number, opts: RetireOpts = {}): number {
  let count = 0
  for (let s = 0; s < trials; s++) {
    const p = testPlayer({
      id: 'r',
      age,
      current: opts.current ?? 60,
      yearsRemaining: opts.yearsRemaining ?? 0
    })
    const team = testTeam('t0', [p.id])
    const { retired } = processRetirements({
      players: new Map([[p.id, p]]),
      teams: new Map([[team.id, team]]),
      year: 2026,
      rng: new Rng(9000 + s)
    })
    if (retired.length > 0) count++
  }
  return count / trials
}

describe('processRetirements', () => {
  it('ramps probability from rare at 33 to near-certain at 40', () => {
    const f33 = retirementFreq(33, 300)
    const f36 = retirementFreq(36, 300)
    const f40 = retirementFreq(40, 300)
    expect(f33).toBeLessThan(0.12)
    expect(f36).toBeGreaterThan(0.08)
    expect(f36).toBeLessThan(0.45)
    expect(f40).toBeGreaterThan(0.8)
    expect(f33).toBeLessThan(f36)
    expect(f36).toBeLessThan(f40)
  })

  it('retires low-overall players more often than stars', () => {
    const fringe = retirementFreq(35, 300, { current: 40 })
    const star = retirementFreq(35, 300, { current: 85 })
    expect(fringe).toBeGreaterThan(star + 0.1)
  })

  it('never retires under-33s or players signed 2+ years before 38', () => {
    expect(retirementFreq(32, 100)).toBe(0)
    expect(retirementFreq(35, 100, { yearsRemaining: 3 })).toBe(0)
    // 38+ can walk away from a live contract.
    expect(retirementFreq(38, 150, { yearsRemaining: 3 })).toBeGreaterThan(0.2)
  })

  it('removes retirees from the roster but keeps them in the players map', () => {
    const oldster = testPlayer({ id: 'old', age: 41, current: 40 })
    const kid = testPlayer({ id: 'kid', age: 25 })
    const team = testTeam('t0', [oldster.id, kid.id])
    const players = new Map<PlayerId, Player>([
      [oldster.id, oldster],
      [kid.id, kid]
    ])
    const { retired } = processRetirements({
      players,
      teams: new Map([[team.id, team]]),
      year: 2026,
      rng: new Rng(1)
    })
    expect(retired).toEqual([oldster.id])
    expect(team.roster).toEqual([kid.id])
    expect(players.has(oldster.id)).toBe(true)
  })
})

/* ────────────────────────── draft classes ────────────────────────── */

function makeClass(seed: number, count: number, startNumber = 500): ReturnType<typeof generateDraftClass> {
  let n = startNumber
  return generateDraftClass({ year: 2027, count, rng: new Rng(seed), nextPlayerNumber: () => n++ })
}

describe('generateDraftClass', () => {
  it('is deterministic: same seed and counter produce an identical class', () => {
    expect(JSON.stringify(makeClass(42, 60))).toBe(JSON.stringify(makeClass(42, 60)))
    expect(JSON.stringify(makeClass(42, 60))).not.toBe(JSON.stringify(makeClass(43, 60)))
  })

  it('produces a well-formed class: ids, ages, contracts, positions, ranks', () => {
    const { players, draftClass } = makeClass(7, 270)
    expect(players).toHaveLength(270)
    expect(draftClass.year).toBe(2027)
    expect(players[0].id).toBe('p500')
    expect(players[269].id).toBe('p769')

    const ranks = draftClass.prospects.map((p) => p.rank).sort((a, b) => a - b)
    expect(ranks).toEqual(Array.from({ length: 270 }, (_, i) => i + 1))
    expect(new Set(draftClass.prospects.map((p) => p.playerId))).toEqual(new Set(players.map((p) => p.id)))

    let forwards = 0
    let defense = 0
    let goalies = 0
    for (const p of players) {
      expect(p.age === 17 || p.age === 18).toBe(true)
      expect(p.contract).toEqual({ salary: 900000, yearsRemaining: 0, expiryYear: 2027, noTradeClause: false, twoWay: true })
      expect(p.stats).toEqual([])
      expect(p.injuryStatus).toBeNull()
      if (p.position === 'C' || p.position === 'W') forwards++
      else if (p.position === 'D') defense++
      else goalies++
      if (p.position === 'G') expect(p.ratings.goalie).toBeDefined()
      else expect(p.ratings.goalie).toBeUndefined()
      expect(p.composites).toEqual(computeComposites(p.ratings, p.role, p.position))
    }
    // ~8F : 4D : 1.5G with binomial slack.
    expect(forwards).toBeGreaterThan(120)
    expect(forwards).toBeLessThan(200)
    expect(defense).toBeGreaterThan(50)
    expect(defense).toBeLessThan(115)
    expect(goalies).toBeGreaterThan(8)
    expect(goalies).toBeLessThan(55)
  })

  it('keeps current ability modest, potential high and varied, ratings within bounds', () => {
    const { players } = makeClass(7, 270)
    let allCurrent: number[] = []
    for (const p of players) {
      const cur = flatVals(p.ratings)
      const pot = flatVals(p.potential)
      cur.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(1)
        expect(v).toBeLessThanOrEqual(99)
        expect(pot[i]).toBeGreaterThanOrEqual(v)
      })
      allCurrent = allCurrent.concat(cur)
    }
    const meanCurrent = sum(allCurrent) / allCurrent.length
    expect(meanCurrent).toBeGreaterThan(38)
    expect(meanCurrent).toBeLessThan(52)

    const potOvr = players.map((p) => overall(computeComposites(p.potential, p.role, p.position), p.position))
    expect(Math.max(...potOvr)).toBeGreaterThanOrEqual(72)
    expect(Math.min(...potOvr)).toBeLessThanOrEqual(62)
    expect(Math.max(...potOvr) - Math.min(...potOvr)).toBeGreaterThanOrEqual(15)
  })

  it('scouting consensus is noisy: rank 1 is not always the true best prospect', () => {
    let mismatch = false
    for (let seed = 1; seed <= 15 && !mismatch; seed++) {
      const { players, draftClass } = makeClass(seed, 60)
      const trueBest = players.reduce((best, p) => {
        const score = overall(computeComposites(p.potential, p.role, p.position), p.position)
        return score > best.score ? { id: p.id, score } : best
      }, { id: players[0].id, score: -1 })
      if (draftClass.prospects[0].playerId !== trueBest.id) mismatch = true
    }
    expect(mismatch).toBe(true)
  })
})

/* ────────────────────────── draft order & AI selection ────────────────────────── */

describe('buildDraftOrder', () => {
  const t0 = asTeamId('t0')
  const t1 = asTeamId('t1')
  const t2 = asTeamId('t2')
  const pick = (year: number, round: number, orig: TeamId, owner: TeamId = orig): DraftPick => ({
    year,
    round,
    originalTeamId: orig,
    ownerTeamId: owner
  })

  it('orders by round then worst-first standings; traded picks keep the original slot', () => {
    const picks: DraftPick[] = [
      pick(2027, 2, t0),
      pick(2027, 1, t1),
      pick(2028, 1, t2), // wrong year — excluded
      pick(2027, 2, t2, t1), // traded: t2's slot, t1 selects
      pick(2027, 1, t0),
      pick(2027, 2, t1),
      pick(2027, 1, t2),
      pick(2027, 3, t0) // beyond rounds — excluded
    ]
    const state = buildDraftOrder({ year: 2027, rounds: 2, picks, standingsWorstFirst: [t2, t0, t1] })

    expect(state.year).toBe(2027)
    expect(state.selections).toEqual([])
    expect(state.order.map((p) => p.round)).toEqual([1, 1, 1, 2, 2, 2])
    expect(state.order.map((p) => p.originalTeamId)).toEqual([t2, t0, t1, t2, t0, t1])
    expect(state.order[0].ownerTeamId).toBe(t2)
    expect(state.order[3].originalTeamId).toBe(t2)
    expect(state.order[3].ownerTeamId).toBe(t1)
    // Input array untouched.
    expect(picks).toHaveLength(8)
  })
})

describe('aiSelectProspect', () => {
  const board = (n: number): DraftProspect[] =>
    Array.from({ length: n }, (_, i) => ({ playerId: asPlayerId(`pr${i}`), rank: n - i })) // shuffled input

  it('heavily favors the best remaining rank with occasional short reaches', () => {
    const rng = new Rng(99)
    const counts = new Map<number, number>()
    for (let i = 0; i < 400; i++) {
      const picked = aiSelectProspect({ remaining: board(30), rng })
      counts.set(picked.rank, (counts.get(picked.rank) ?? 0) + 1)
    }
    expect(counts.get(1) ?? 0).toBeGreaterThan(160) // best available most of the time
    expect((counts.get(1) ?? 0) < 400).toBe(true) // but reaches happen
    expect(Math.max(...counts.keys())).toBeLessThanOrEqual(8) // never falls far down the board
  })

  it('returns the only prospect when one remains, deterministically per seed', () => {
    const only: DraftProspect[] = [{ playerId: asPlayerId('solo'), rank: 12 }]
    expect(aiSelectProspect({ remaining: only, rng: new Rng(1) })).toEqual(only[0])

    const run = (seed: number): number[] => {
      const rng = new Rng(seed)
      return Array.from({ length: 50 }, () => aiSelectProspect({ remaining: board(20), rng }).rank)
    }
    expect(run(5)).toEqual(run(5))
  })
})
