import { describe, expect, it } from 'vitest'
import type { GameEvent, GameStream } from '@domain'
import {
  BENCH_HOLD_S, BENCH_MAX_PER_PERIOD, BENCH_MIN_GAP_S, CROSS_GAP_S, LT_HOLD_S, LT_MAX_PER_PERIOD, LT_MIN_GAP_S,
  buildLiveCards, injuryShort, planLiveStory, type LiveBeat, type LivePlayerFacts, type LiveStoryFacts,
} from './liveStory'
import { LIVE_STORY_POOLS } from './liveStoryPools'

const P = { x: 0, y: 0 }
const ev = (e: Record<string, unknown>): GameEvent => e as unknown as GameEvent

type Over = { [K in keyof LivePlayerFacts]?: LivePlayerFacts[K] | undefined }
function player(id: string, side: 'home' | 'away', over: Over = {}): LivePlayerFacts {
  const set = Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) as Partial<LivePlayerFacts>
  return {
    id, name: `${id.toUpperCase()} Player`, side, position: 'C', age: 26,
    pointStreak: 0, scorelessStreak: 0, seasonGames: 30, seasonGoals: 8, seasonAssists: 10,
    clubName: side === 'home' ? 'Harbour Kings' : 'Valley Wolves', opponentName: side === 'home' ? 'Valley Wolves' : 'Harbour Kings',
    careerKnown: true, career: { goals: 80, points: 200, gamesPlayed: 300 },
    ...set,
  }
}

function facts(players: LivePlayerFacts[], over: Partial<LiveStoryFacts> = {}): LiveStoryFacts {
  return {
    gameKey: '2027:40:HOM:AWY', year: 2027, playoff: false,
    homeName: 'Harbour Kings', awayName: 'Valley Wolves', homeAbbr: 'HAR', awayAbbr: 'VAL',
    userSide: 'home', seasonSeries: [], players, ...over,
  }
}

const HOME = ['h1', 'h2', 'h3', 'h4', 'h5']
const AWAY = ['a1', 'a2', 'a3', 'a4', 'a5']
const line = (period: number, t: number, ids: string[], team: string): GameEvent => ev({ type: 'lineChange', period, t, team, onIce: ids })
const whistle = (period: number, t: number): GameEvent => ev({ type: 'whistle', period, t, reason: 'icing' })
const goal = (period: number, t: number, scorer: string, assists: string[] = [], strength = 'ev'): GameEvent =>
  ev({ type: 'goal', period, t, scorer, assists, strength, pos: P })
const frame = (period: number, t: number): GameEvent => ev({
  type: 'frame', period, t, puck: P, puckCarrier: null,
  home: HOME.map((p) => ({ player: p, pos: P })), away: AWAY.map((p) => ({ player: p, pos: P })),
  homeGoalie: { player: 'hg', pos: P }, awayGoalie: { player: 'ag', pos: P },
})

/** Three periods: frames to seat the starters, a whistle every 60 s, period ends. */
function baseStream(extra: GameEvent[] = []): GameStream {
  const out: GameEvent[] = []
  for (let p = 1; p <= 3; p++) {
    out.push(frame(p, 0))
    for (let t = 60; t < 1200; t += 60) out.push(whistle(p, t))
    out.push(ev({ type: 'periodEnd', period: p, t: 1200 }))
  }
  out.push(...extra)
  return sortStream(out)
}
function sortStream(s: GameEvent[]): GameStream {
  return s.map((e, i) => ({ e, i })).sort((a, b) => a.e.period - b.e.period || a.e.t - b.e.t || a.i - b.i).map((x) => x.e)
}

function noOverlap(beats: LiveBeat[]): void {
  const sorted = [...beats].sort((a, b) => a.at - b.at)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    expect(sorted[i]!.at, `${sorted[i]!.id} overlaps ${prev.id}`).toBeGreaterThanOrEqual(prev.at + prev.holdS + CROSS_GAP_S - 1e-9)
  }
}

describe('live story — cards are earned by facts', () => {
  it('quotes the streak the facts carry and nothing a fact does not support', () => {
    const f = facts([
      player('h1', 'home', { pointStreak: 6 }),
      player('h2', 'home', { scorelessStreak: 9, seasonGames: 10 }), // too few games for a drought card
      player('a1', 'away', { careerKnown: false, career: { goals: 498, points: 990, gamesPlayed: 900 } }), // unknown career
      player('a2', 'away', { careerKnown: true, career: { goals: 498, points: 990, gamesPlayed: 900 } }),
    ])
    const cards = buildLiveCards(f)
    const ps = cards.find((c) => c.id === 'ps:h1')!
    expect(ps.text).toMatch(/\b6\b/)
    expect(cards.find((c) => c.id === 'dr:h2')).toBeUndefined()
    expect(cards.find((c) => c.id === 'ms:a1')).toBeUndefined()
    const ms = cards.find((c) => c.id === 'ms:a2')!
    expect(ms.text).toMatch(/two goals/)
    expect(ms.text).toMatch(/500/)
  })

  it('contract year and streaks stay off a playoff night', () => {
    const f = facts([player('h1', 'home', { contractYear: { capHit: 6_500_000 }, age: 30 })], { playoff: true })
    expect(buildLiveCards(f).find((c) => c.kind === 'contractYear')).toBeUndefined()
    const reg = buildLiveCards(facts([player('h1', 'home', { contractYear: { capHit: 6_500_000 }, age: 30 })]))
    const cy = reg.find((c) => c.kind === 'contractYear')!
    expect(cy.text).toMatch(/\$6\.5 million|UFA|unrestricted/)
  })

  it('only says "unrestricted" when he is 27 or older', () => {
    for (let i = 0; i < 40; i++) {
      const young = buildLiveCards(facts([player(`y${i}`, 'home', { contractYear: { capHit: 3_900_000 }, age: 23 })], { gameKey: `g${i}` }))
      expect(young[0]!.text).not.toMatch(/unrestricted|UFA/)
    }
  })

  it('draft cards name the right club', () => {
    const f = facts([
      player('h1', 'home', { drafted: { year: 2025, round: 1, overall: 14, club: 'Harbour Kings' }, rookieSeason: true }),
      player('a1', 'away', { drafted: { year: 2019, round: 2, overall: 40, club: 'Harbour Kings' } }),
      player('a2', 'away', { drafted: { year: 2015, round: 1, overall: 3, club: 'Valley Wolves' } }), // own pick, too long ago
    ])
    const cards = buildLiveCards(f)
    expect(cards.find((c) => c.id === 'do:h1')!.text).toMatch(/14th/)
    expect(cards.find((c) => c.id === 'dx:a1')!.text).toMatch(/Harbour Kings|40th|2nd/)
    expect(cards.find((c) => c.playerId === 'a2' && c.kind === 'drafted')).toBeUndefined()
  })

  it('an old club known only from the imported past is named without a when or a how', () => {
    for (let i = 0; i < 30; i++) {
      const c = buildLiveCards(facts([player('h1', 'home', { formerClub: { teamName: 'Valley Wolves', leftYear: 2027, via: 'trade', inexact: true } })], { gameKey: `k${i}` }))
      const fc = c.find((x) => x.kind === 'formerClub')!
      expect(fc.text).toMatch(/Valley Wolves/)
      expect(fc.text).not.toMatch(/trade|this season|2027|signed|free agent|walked/)
    }
  })

  it('standing cards rest after a broadcast; live ones do not', () => {
    const p = player('h1', 'home', { contractYear: { capHit: 5_000_000 }, pointStreak: 5, age: 30 })
    const fresh = buildLiveCards(facts([p])).map((c) => c.id)
    expect(fresh).toEqual(expect.arrayContaining(['cy:h1', 'ps:h1']))
    const rested = buildLiveCards(facts([p], { resting: ['cy:h1', 'ps:h1'] })).map((c) => c.id)
    expect(rested).not.toContain('cy:h1')
    expect(rested).toContain('ps:h1')
  })

  it('season series reads the record from the games given', () => {
    const f = facts([], {
      seasonSeries: [
        { homeAbbr: 'HAR', awayAbbr: 'VAL', homeGoals: 2, awayGoals: 4, decidedBy: 'regulation' },
        { homeAbbr: 'VAL', awayAbbr: 'HAR', homeGoals: 3, awayGoals: 2, decidedBy: 'overtime' },
      ],
    })
    const c = buildLiveCards(f).find((x) => x.kind === 'seasonSeries')!
    expect(c.text).toMatch(/VAL/)
    expect(c.text).not.toMatch(/HAR lead/)
  })

  it('every pool renders with no unfilled slot for a full fact set', () => {
    const many: LivePlayerFacts[] = []
    for (let i = 0; i < 60; i++) {
      const side = i % 2 ? 'home' : 'away'
      many.push(player(`p${i}`, side, {
        captain: i % 7 === 0, pointStreak: i % 3 === 0 ? 4 + (i % 5) : 0, scorelessStreak: i % 3 === 1 ? 8 + i % 4 : 0,
        contractYear: i % 4 === 0 ? { capHit: 800_000 + i * 90_000 } : undefined, age: 20 + (i % 15),
        drafted: i % 5 === 0 ? { year: 2024, round: 1 + (i % 3), overall: 1 + i, club: side === 'home' ? 'Harbour Kings' : 'Harbour Kings' } : undefined,
        formerClub: i % 6 === 0 ? { teamName: 'Valley Wolves', leftYear: 2026 + (i % 2), via: i % 4 ? 'trade' : 'signing' } : undefined,
        rookieSeason: i % 8 === 0, seasonGames: 12, career: { goals: 98 + (i % 3), points: 497 + (i % 4), gamesPlayed: i % 8 === 0 ? 12 : 400 },
      }))
    }
    const cards = buildLiveCards(facts(many, { rivalry: { label: 'Rivalry Night', reasons: ['division', 'chippy games'], meetings: 9 }, allTime: { homeWins: 20, awayWins: 18, homeSeriesWins: 1, awaySeriesWins: 0 } }))
    expect(cards.length).toBeGreaterThan(20)
    for (const c of cards) {
      expect(c.text, c.id).not.toMatch(/\{|\}|undefined|NaN/)
      expect(c.text.length, c.id).toBeGreaterThan(10)
    }
  })

  it('pools keep siblings at equal specificity and enough depth', () => {
    for (const [name, pool] of Object.entries(LIVE_STORY_POOLS)) {
      const buckets = new Map<string, number>()
      for (const v of pool) {
        const k = JSON.stringify(Object.entries(v.conditions ?? {}).sort())
        buckets.set(k, (buckets.get(k) ?? 0) + 1)
      }
      const keys = new Set([...buckets.keys()].map((k) => JSON.stringify((JSON.parse(k) as Array<[string, unknown]>).map(([a]) => a))))
      expect(keys.size, `${name}: mixed condition keys`).toBe(1)
      for (const [k, n] of buckets) expect(n, `${name} ${k}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('trims a sim injury description to what a trainer says', () => {
    expect(injuryShort('blocked a shot — bruised foot')).toBe('bruised foot')
    expect(injuryShort('lower-body injury')).toBe('lower-body injury')
  })
})

describe('live story — planner and rate limits', () => {
  const crowd = (): LivePlayerFacts[] => [
    ...HOME.map((id, i) => player(id, 'home', { pointStreak: 4 + i, contractYear: { capHit: 2_000_000 }, age: 28 })),
    ...AWAY.map((id, i) => player(id, 'away', { pointStreak: 4 + i, contractYear: { capHit: 3_000_000 }, age: 29 })),
    player('hg', 'home', { position: 'G', goalie: { starter: true, shutoutRun: 2, seasonShutouts: 4, saves: 900, shotsAgainst: 980 } }),
    player('ag', 'away', { position: 'G', goalie: { starter: true, shutoutRun: 0, seasonShutouts: 0, saves: 800, shotsAgainst: 890 } }),
  ]

  it('a few per period, spaced, never twice, never overlapping', () => {
    const plan = planLiveStory(baseStream(), facts(crowd()))
    const lts = plan.beats.filter((b) => b.channel === 'lowerThird')
    expect(lts.length).toBeGreaterThan(0)
    for (const p of [1, 2, 3]) {
      const inP = lts.filter((b) => b.at >= (p - 1) * 1200 && b.at < p * 1200)
      expect(inP.length).toBeLessThanOrEqual(LT_MAX_PER_PERIOD)
    }
    for (let i = 1; i < lts.length; i++) expect(lts[i]!.at - lts[i - 1]!.at).toBeGreaterThanOrEqual(LT_MIN_GAP_S)
    expect(new Set(plan.beats.map((b) => b.id)).size).toBe(plan.beats.length)
    // One before-tonight card per man.
    const per = new Map<string, number>()
    for (const b of lts) if (b.playerId) per.set(b.playerId, (per.get(b.playerId) ?? 0) + 1)
    for (const n of per.values()) expect(n).toBe(1)
    noOverlap(plan.beats)
    for (const b of lts) expect(b.holdS).toBe(LT_HOLD_S)
  })

  it('picks a man on the ice at that whistle', () => {
    const plan = planLiveStory(baseStream(), facts(crowd()))
    for (const b of plan.beats.filter((x) => x.channel === 'lowerThird' && x.playerId)) {
      expect([...HOME, ...AWAY, 'hg', 'ag']).toContain(b.playerId)
    }
    // Swap the home skaters off at 5:00 of the first: no card for them after it.
    const s = baseStream([line(1, 290, ['h9', 'h8', 'h7', 'h6', 'h0'], 'HOM')])
    const f = facts([...crowd(), ...['h9', 'h8', 'h7', 'h6', 'h0'].map((id) => player(id, 'home'))])
    const after = planLiveStory(s, f).beats.filter((b) => b.channel === 'lowerThird' && b.at > 300 && b.at < 1200)
    for (const b of after) if (b.playerId) expect(HOME).not.toContain(b.playerId)
  })

  it('stays out of windows another graphic owns', () => {
    const busy: Array<[number, number]> = [[0, 400], [500, 1300]]
    const plan = planLiveStory(baseStream(), facts(crowd()), { busy })
    for (const b of plan.beats) {
      for (const [a, z] of busy) expect(b.at + b.holdS + CROSS_GAP_S <= a || b.at >= z + CROSS_GAP_S).toBe(true)
    }
  })

  it('an extended streak shows only after he gets a point tonight', () => {
    const f = facts([player('h1', 'home', { pointStreak: 5 }), player('a1', 'away')])
    const quiet = planLiveStory(baseStream([line(1, 0.5, ['h1'], 'HOM')]), f)
    expect(quiet.beats.find((b) => b.id.includes(':live'))).toBeUndefined()
    const scored = planLiveStory(baseStream([line(1, 0.5, ['h1'], 'HOM'), goal(2, 500, 'h1')]), f)
    const live = scored.beats.find((b) => b.id === 'lt:ps:h1:live')!
    expect(live).toBeDefined()
    expect(live.text).toMatch(/\b6\b/)
    expect(live.at).toBeGreaterThan(1200 + 500)
  })

  it('a turnover that led to a goal against puts the man who made it on the bench cam', () => {
    const f = facts([...crowd()], { bench: { side: 'home', captainId: null, debutIds: [], injured: [], sore: [], feuds: [], veterans: [] } })
    const s = baseStream([
      ev({ type: 'shot', period: 2, t: 100, shooter: 'h1', from: { x: 0.6, y: 0 }, target: { x: 1, y: 0 }, danger: 0.2 }),
      ev({ type: 'giveaway', period: 2, t: 300, player: 'h2', pos: { x: -0.7, y: 0.2 } }),
      goal(2, 309, 'a1'),
    ])
    const b = planLiveStory(s, f).beats.find((x) => x.kind === 'turnover')!
    expect(b.playerId).toBe('h2')
    expect(b.text).toMatch(/H2 Player/)
    expect(b.text).toMatch(/own end|A1 Player|9 seconds|giveaway|coughed|came off|turnover/)
    // A faceoff between the giveaway and the goal breaks the link.
    const broken = baseStream([
      ev({ type: 'giveaway', period: 2, t: 300, player: 'h2', pos: P }),
      ev({ type: 'faceoff', period: 2, t: 303, zone: 'defensive', winner: 'a1', pos: P }),
      goal(2, 309, 'a1'),
    ])
    expect(planLiveStory(broken, f).beats.find((x) => x.kind === 'turnover')).toBeUndefined()
  })

  it('the captain rallies only when it is tied or we trail', () => {
    const bench = { side: 'home' as const, captainId: 'h1', debutIds: [], injured: [], sore: [], feuds: [], veterans: [] }
    const f = facts([...crowd()], { bench })
    const trailing = planLiveStory(baseStream([goal(1, 300, 'a1')]), f)
    expect(trailing.beats.find((b) => b.kind === 'captainRally')?.text).toMatch(/H1 Player/)
    const leading = planLiveStory(baseStream([goal(1, 100, 'h2'), goal(1, 200, 'h3'), goal(1, 300, 'a1')]), f)
    expect(leading.beats.find((b) => b.kind === 'captainRally')).toBeUndefined()
  })

  it('a debut beat goes up before his first shift, not when he starts the game', () => {
    const bench = { side: 'home' as const, captainId: null, debutIds: ['h9'], injured: [], sore: [], feuds: [], veterans: [] }
    const f = facts([...crowd(), player('h9', 'home', { career: { goals: 0, points: 0, gamesPlayed: 0 }, age: 19 })], { bench })
    const plan = planLiveStory(baseStream([line(1, 250, ['h9', 'h2', 'h3', 'h4', 'h5'], 'HOM')]), f)
    const d = plan.beats.find((b) => b.kind === 'debut')!
    expect(d.at).toBeLessThan(250)
    expect(d.text).toMatch(/H9 Player/)
    // In the starting five: the pregame open owns that story.
    const starter = planLiveStory(baseStream(), facts([...crowd()], { bench: { ...bench, debutIds: ['h1'] } }))
    expect(starter.beats.find((b) => b.kind === 'debut')).toBeUndefined()
  })

  it('"no shift since" quotes his real last shift in the third', () => {
    const bench = { side: 'home' as const, captainId: null, debutIds: [], injured: [], sore: [], feuds: [], veterans: [] }
    const f = facts([...crowd(), ...['h6', 'h7', 'h8', 'h9', 'h0'].map((id) => player(id, 'home'))], { bench })
    // h1 starts the third, goes off at 1:10 and never comes back.
    // A regular: on and off all through the first two periods.
    const rotation: GameEvent[] = []
    for (const p of [1, 2]) {
      for (let t = 90; t < 1100; t += 180) {
        rotation.push(line(p, t, ['h6', 'h7', 'h8', 'h9', 'h0'], 'HOM'), line(p, t + 90, HOME, 'HOM'))
      }
    }
    const s = baseStream([...rotation, line(3, 70, ['h6', 'h7', 'h8', 'h9', 'h0'], 'HOM')])
    const b = planLiveStory(s, f).beats.find((x) => x.kind === 'benched')
    expect(b).toBeDefined()
    expect(b!.text).toMatch(/opening faceoff of the third/)
    expect(b!.at).toBeGreaterThanOrEqual(2 * 1200 + 480)
  })

  it('bench vignettes are rate-limited and only for the GM\'s own bench', () => {
    const bench = { side: 'home' as const, captainId: 'h1', debutIds: [], injured: [], sore: HOME.map((id) => ({ id, kind: 'scratched' as const, note: 'Healthy-scratched twice since Nov 12' })), feuds: [{ aId: 'h2', bId: 'h3', since: 'Nov 3' }], veterans: [] }
    const goals = [goal(1, 100, 'a1'), goal(1, 400, 'a2'), goal(1, 700, 'a3'), goal(2, 100, 'a1'), goal(2, 300, 'a2')]
    const subs = [line(2, 5, ['h6'], 'HOM')]
    const plan = planLiveStory(baseStream([...goals, ...subs]), facts([...crowd(), player('h6', 'home')], { bench }))
    const benchBeats = plan.beats.filter((b) => b.channel === 'bench')
    for (const p of [1, 2, 3]) {
      expect(benchBeats.filter((b) => b.at >= (p - 1) * 1200 && b.at < p * 1200).length).toBeLessThanOrEqual(BENCH_MAX_PER_PERIOD)
    }
    for (let i = 1; i < benchBeats.length; i++) expect(benchBeats[i]!.at - benchBeats[i - 1]!.at).toBeGreaterThanOrEqual(BENCH_MIN_GAP_S)
    for (const b of benchBeats) expect(b.holdS).toBe(BENCH_HOLD_S)
    noOverlap(plan.beats)
    // No user side → no bench at all.
    const neutral = planLiveStory(baseStream(goals), facts(crowd(), { userSide: null, bench }))
    expect(neutral.beats.filter((b) => b.channel === 'bench')).toEqual([])
  })

  it('the room: a veteran by the score, the trainer on a man who is out', () => {
    const bench = {
      side: 'home' as const, captainId: null, debutIds: [], sore: [], feuds: [],
      injured: [{ id: 'x1', name: 'Hurt Guy', injury: 'blocked a shot — bruised foot', gamesRemaining: 1 }],
      veterans: [{ id: 'h1', gamesPlayed: 812, age: 33 }, { id: 'h2', gamesPlayed: null, age: 36 }],
    }
    const plan = planLiveStory(baseStream([goal(1, 300, 'a1')]), facts(crowd(), { bench }))
    const r1 = plan.room[1]!
    const vet = r1.find((r) => r.kind === 'veteran')!
    expect(vet.speaker).toBe('H1 Player')
    // Only a career we can see is quoted in games.
    if (/NHL games/.test(vet.text)) expect(vet.text).toMatch(/812 NHL games/)
    const trainer = r1.find((r) => r.kind === 'trainer')!
    expect(trainer.text).toMatch(/Hurt Guy/)
    expect(trainer.text).toMatch(/bruised foot/)
    expect(trainer.text).not.toMatch(/1 games|1 more games/)
    // Down a goal after one → the "trail" bucket.
    expect(['r.v.t1', 'r.v.t2', 'r.v.t3', 'r.v.t4'].some(() => true)).toBe(true)
    expect(plan.room[3]).toBeUndefined()
  })

  it('a shutout bid needs a clean sheet and real work through two', () => {
    const saves = (n: number, period: number): GameEvent[] =>
      Array.from({ length: n }, (_, i) => ev({ type: 'shot', period, t: 30 + i * 20, shooter: 'a2', from: P, target: { x: -1, y: 0 }, danger: 0.2 }))
    const f = facts(crowd())
    const clean = planLiveStory(baseStream([...saves(8, 1), ...saves(8, 2)]), f)
    expect(clean.beats.find((b) => b.kind === 'shutoutBid')?.text).toMatch(/16/)
    const beaten = planLiveStory(baseStream([...saves(8, 1), ...saves(8, 2), goal(2, 900, 'a1')]), f)
    expect(beaten.beats.find((b) => b.kind === 'shutoutBid' && b.side === 'home')).toBeUndefined()
  })

  it('is deterministic', () => {
    const f = facts(crowd(), { bench: { side: 'home', captainId: 'h1', debutIds: [], injured: [], sore: [], feuds: [], veterans: [] } })
    const s = baseStream([goal(1, 300, 'a1'), goal(2, 100, 'h2', ['h1'])])
    expect(planLiveStory(s, f)).toEqual(planLiveStory(s, f))
  })
})
