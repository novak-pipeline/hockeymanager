/**
 * Match-day layer: the stream fold, the ratings maths, the assistant's read,
 * and the intermission / postgame builders.
 */
import { describe, expect, it } from 'vitest'
import type { FrameEvent, GameEvent, GameStream, GoalStrength, PlayerRef } from '@domain'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'
import {
  buildMatchIndex, computeMatchStats, XG_PER_DANGER, type MatchDayGame, type PlayerLine,
} from './matchStats'
import { BASE_RATING, goalieDrivers, ratePlayer, rateMatch, skaterDrivers } from './ratings'
import { assistantLiveLine, assistantRead } from './assistant'
import { buildIntermission, buildPostgame } from './reports'
import { INTERMISSION_DECISION_SLOTS } from './decisions'
import { buildComprehensive, highlightsFor } from '../highlights'
import { estimateWallSeconds, planFor } from '../playbackDirector'

/* ─────────────────────────── a tiny scripted game ─────────────────────────── */

const H = ['h1', 'h2', 'h3', 'h4', 'h5'] // home skaters
const A = ['a1', 'a2', 'a3', 'a4', 'a5'] // away skaters
const HG = 'hg'
const AG = 'ag'
const id = (s: string): PlayerRef => s as PlayerRef

function frame(period: number, t: number): FrameEvent {
  const snap = (p: string) => ({ player: id(p), pos: { x: 0, y: 0 } })
  return {
    type: 'frame', period, t,
    home: H.map(snap), away: A.map(snap), homeGoalie: snap(HG), awayGoalie: snap(AG),
    puck: { x: 0, y: 0 }, puckCarrier: null,
  }
}
const lc = (period: number, t: number, on: string[]): GameEvent => ({ type: 'lineChange', period, t, team: 'x' as never, onIce: on.map(id) })
/** Home attacks +x in odd periods. */
const dir = (period: number, home: boolean): number => ((period % 2 === 1) === home ? 1 : -1)
const shot = (period: number, t: number, shooter: string, danger: number, home: boolean): GameEvent => ({
  type: 'shot', period, t, shooter: id(shooter), from: { x: 0.7 * dir(period, home), y: 0.1 }, target: { x: dir(period, home), y: 0 }, danger,
})
const save = (period: number, t: number, goalie: string): GameEvent => ({ type: 'save', period, t, goalie: id(goalie), rebound: false, pos: { x: 0, y: 0 } })
const goal = (period: number, t: number, scorer: string, assists: string[], strength: GoalStrength = 'ev'): GameEvent => ({
  type: 'goal', period, t, scorer: id(scorer), assists: assists.map(id), strength, pos: { x: 0.85, y: 0 },
})

function scripted(): MatchDayGame {
  const s: GameStream = [
    frame(1, 0),
    lc(1, 0, H), lc(1, 0, A),
    { type: 'faceoff', period: 1, t: 0, zone: 'neutral' as never, winner: id('h1'), pos: { x: 0, y: 0 } },
    shot(1, 30, 'h1', 0.4, true), save(1, 30.5, AG),
    shot(1, 60, 'h1', 0.8, true), goal(1, 60.4, 'h1', ['h2', 'h3']),
    { type: 'hit', period: 1, t: 90, by: id('a4'), on: id('h2'), pos: { x: 0, y: 0.9 } },
    { type: 'giveaway', period: 1, t: 100, player: id('h4'), pos: { x: 0, y: 0 } },
    { type: 'penalty', period: 1, t: 200, player: id('a2'), infraction: 'tripping', minutes: 2 },
    shot(1, 230, 'h2', 0.6, true), goal(1, 230.3, 'h2', ['h1'], 'pp'),
    { type: 'penalty', period: 1, t: 400, player: id('a5'), infraction: 'fighting', minutes: 5 },
    { type: 'penalty', period: 1, t: 400, player: id('h5'), infraction: 'fighting', minutes: 5 },
    { type: 'periodEnd', period: 1, t: 1200 },
    frame(2, 0),
    shot(2, 50, 'a1', 0.3, false), save(2, 50.4, HG),
    { type: 'blockedShot', period: 2, t: 80, shooter: id('a2'), blocker: id('h3'), pos: { x: 0.6, y: 0 } },
    shot(2, 300, 'a1', 0.5, false), goal(2, 300.2, 'a1', []),
    { type: 'periodEnd', period: 2, t: 1200 },
    frame(3, 0),
    shot(3, 100, 'h1', 0.5, true), save(3, 100.4, AG),
    { type: 'missedShot', period: 3, t: 150, shooter: id('a3'), from: { x: 0.7, y: 0 }, target: { x: 1, y: 0.05 }, result: 'post' },
    shot(3, 900, 'a3', 0.4, false), goal(3, 900.3, 'a3', ['a1']),
    { type: 'periodEnd', period: 3, t: 1200 },
    frame(4, 0),
    shot(4, 40, 'a1', 0.9, false), goal(4, 40.3, 'a1', ['a2']),
    { type: 'gameEnd', period: 4, t: 41 },
  ]
  const names: Record<string, string> = {}
  for (const p of [...H, ...A, HG, AG]) names[p] = `Player ${p.toUpperCase()}`
  return { stream: s, homePlayerIds: [...H, HG], playerNames: names, homeAbbr: 'HOM', awayAbbr: 'AWY', userIsHome: true }
}

describe('matchStats fold', () => {
  const idx = buildMatchIndex(scripted(), { h3: 'D', h4: 'D' })
  const st = computeMatchStats(idx)
  const line = (p: string): PlayerLine => st.players.find((l) => l.id === p)!

  it('lays out the breaks: after the 1st, 2nd and before OT', () => {
    expect(idx.intermissions.map((b) => b.period)).toEqual([1, 2, 3])
    expect(idx.intermissions[0]!.absT).toBe(1200)
    expect(idx.lastPeriod).toBe(4)
  })

  it('counts SOG on the shot, never again on the goal', () => {
    expect(st.home.shots).toBe(4)
    expect(st.away.shots).toBe(4)
    expect(st.home.goals).toBe(2)
    expect(st.away.goals).toBe(3)
  })

  it('splits by period', () => {
    expect(st.byPeriod.home.map((t) => t.shots)).toEqual([3, 0, 1, 0])
    expect(st.byPeriod.away.map((t) => t.goals)).toEqual([0, 1, 1, 1])
  })

  it('power plays: a minor gives one, a fight gives none', () => {
    expect(st.home.powerPlays).toBe(1)
    expect(st.away.powerPlays).toBe(0)
    expect(st.home.powerPlayGoals).toBe(1)
  })

  it('plus/minus skips the power-play goal', () => {
    // h1 was on for the EV goal (+1), the PP goal (0), three away goals (-3)
    expect(line('h1').plusMinus).toBe(-2)
    expect(line('a1').plusMinus).toBe(2)
  })

  it('resolves each shot to its outcome and charges the right goalie with xGA', () => {
    const goals = st.shots.filter((s) => s.result === 'goal')
    expect(goals).toHaveLength(5)
    expect(st.shots.find((s) => s.result === 'post')).toBeDefined()
    expect(st.shots.find((s) => s.result === 'block')).toBeDefined()
    const ag = line(AG)
    expect(ag.shotsAgainst).toBe(4)
    expect(ag.goalsAgainst).toBe(2)
    expect(ag.xga).toBeCloseTo((0.4 + 0.8 + 0.6 + 0.5) * XG_PER_DANGER, 6)
  })

  it('folds to any clock', () => {
    const early = computeMatchStats(idx, 100)
    expect(early.home.goals).toBe(1)
    expect(early.goals).toHaveLength(1)
    expect(early.goals[0]!.clock).toBe('1:00')
    expect(early.ended).toBe(false)
    expect(st.ended).toBe(true)
  })

  it('credits TOI from the shifts and the goalie of record', () => {
    expect(line('h1').toi).toBeGreaterThan(3600)
    expect(line(HG).toi).toBeCloseTo(idx.duration, 3)
  })
})

/* ─────────────────────────── ratings ─────────────────────────── */

function blank(over: Partial<PlayerLine>): PlayerLine {
  return {
    id: 'x', name: 'X', side: 'home', position: 'C', isGoalie: false,
    goals: 0, assists: 0, primaryAssists: 0, shots: 0, missed: 0, attemptsBlocked: 0, xg: 0,
    hits: 0, hitsTaken: 0, blocks: 0, takeaways: 0, giveaways: 0, penaltyMinutes: 0, penaltiesTaken: 0,
    penaltiesDrawn: 0, plusMinus: 0, faceoffWins: 0, faceoffLosses: 0, toi: 0,
    shotsAgainst: 0, saves: 0, goalsAgainst: 0, xga: 0, highDangerSaves: 0,
    ...over,
  }
}

describe('ratings maths', () => {
  const full = 3600

  it('an anonymous night at his usual minutes is 6.0', () => {
    const r = ratePlayer(blank({ toi: full * 0.26 }), full, true)
    expect(r.rating).toBe(BASE_RATING)
    expect(r.drivers).toHaveLength(0)
  })

  it('the rating IS the sum of its drivers (below the soft ceiling)', () => {
    const l = blank({ goals: 1, shots: 3, xg: 0.3, giveaways: 2, toi: full * 0.26 })
    const ds = skaterDrivers(l, full)
    const sum = ds.reduce((a, d) => a + d.delta, 0)
    expect(ratePlayer(l, full, true).rating).toBeCloseTo(BASE_RATING + sum, 1)
  })

  it('a two-goal, one-assist night is a big rating, led by the goals', () => {
    const r = ratePlayer(blank({ goals: 2, assists: 1, primaryAssists: 1, shots: 5, xg: 0.7, plusMinus: 2, toi: full * 0.3 }), full, true)
    expect(r.rating).toBeGreaterThanOrEqual(8)
    expect(r.drivers[0]!.label).toBe('2 goals')
    expect(r.drivers.length).toBeLessThanOrEqual(3)
  })

  it('turnovers, penalties and a minus pull a rating down, and say so', () => {
    const r = ratePlayer(blank({ giveaways: 4, penaltiesTaken: 2, penaltyMinutes: 4, plusMinus: -2, toi: full * 0.26 }), full, true)
    expect(r.rating).toBeLessThan(5)
    const labels = r.drivers.map((d) => d.label)
    expect(labels).toContain('4 giveaways')
    expect(r.drivers.every((d) => d.delta < 0)).toBe(true)
  })

  it('stays inside 1–10 with a soft ceiling', () => {
    const huge = ratePlayer(blank({ goals: 5, assists: 3, primaryAssists: 3, shots: 12, xg: 3, plusMinus: 5, toi: full * 0.4 }), full, true)
    expect(huge.rating).toBeLessThanOrEqual(10)
    expect(huge.rating).toBeGreaterThan(9)
    const awful = ratePlayer(blank({ giveaways: 12, penaltiesTaken: 5, penaltyMinutes: 10, plusMinus: -6, toi: full * 0.26 }), full, true)
    expect(awful.rating).toBeGreaterThanOrEqual(1)
  })

  it('goalie: save% against the save% his chances predicted', () => {
    const stole = blank({ isGoalie: true, position: 'G', shotsAgainst: 40, saves: 40, xga: 3.5, highDangerSaves: 6, toi: full })
    const leaky = blank({ isGoalie: true, position: 'G', shotsAgainst: 20, saves: 15, goalsAgainst: 5, xga: 1.4, toi: full })
    const par = blank({ isGoalie: true, position: 'G', shotsAgainst: 28, saves: 25, goalsAgainst: 3, xga: 3.0, toi: full })
    const rs = ratePlayer(stole, full, true)
    const rl = ratePlayer(leaky, full, true)
    const rp = ratePlayer(par, full, true)
    expect(rs.rating).toBeGreaterThan(8.5)
    expect(rs.drivers.map((d) => d.label)).toContain('shutout')
    expect(rl.rating).toBeLessThan(4)
    expect(rl.drivers[0]!.label).toMatch(/sv% vs .* expected/)
    expect(Math.abs(rp.rating - BASE_RATING)).toBeLessThan(0.4)
  })

  it('a goalie with no shots yet is not moved', () => {
    expect(goalieDrivers(blank({ isGoalie: true, position: 'G' }), false)).toEqual([])
  })

  it('rates only the players who took part, best first', () => {
    const st = computeMatchStats(buildMatchIndex(scripted()))
    const rs = rateMatch(st)
    expect(rs.length).toBeGreaterThan(0)
    for (let i = 1; i < rs.length; i++) expect(rs[i - 1]!.rating).toBeGreaterThanOrEqual(rs[i]!.rating)
    for (const r of rs) {
      expect(r.rating).toBeGreaterThanOrEqual(1)
      expect(r.rating).toBeLessThanOrEqual(10)
    }
  })
})

/* ─────────────────────────── intermission / postgame ─────────────────────────── */

describe('intermission report', () => {
  const idx = buildMatchIndex(scripted())

  it('reports the period just played, the game so far, and nothing after the horn', () => {
    const r = buildIntermission(idx, 1, 'seed')
    expect(r.title).toBe('End of the 1st')
    expect(r.next).toBe('2nd period')
    expect(r.home).toBe(2)
    expect(r.away).toBe(0)
    expect(r.periodStats.home.shots).toBe(3)
    expect(r.goals).toHaveLength(2)
    expect(r.penalties).toHaveLength(3)
    expect(r.stars.length).toBeGreaterThan(0)
    expect(r.stars.length).toBeLessThanOrEqual(3)
  })

  it('the break before overtime says so', () => {
    const r = buildIntermission(idx, 3, 'seed')
    expect(r.title).toBe('End of regulation')
    expect(r.next).toBe('Overtime')
    expect(r.periodStats.home.shots).toBe(1)
    expect(r.gameStats.home.shots).toBe(4)
  })

  it('carries an assistant read and is deterministic', () => {
    const a = buildIntermission(idx, 2, 'seed')
    const b = buildIntermission(idx, 2, 'seed')
    expect(a.assistant.working.length).toBeGreaterThan(10)
    expect(a.assistant.notWorking.length).toBeGreaterThan(10)
    expect(a.assistant.suggestion.length).toBeGreaterThan(10)
    expect(a.assistant).toEqual(b.assistant)
  })

  it('offers no decisions until segmented simulation exists', () => {
    const r = buildIntermission(idx, 1, 'seed')
    expect(r.decisions).toBe(INTERMISSION_DECISION_SLOTS)
    expect(r.decisions.map((d) => d.kind).sort()).toEqual(['goalie', 'lines', 'roomMessage', 'tactics'])
    expect(r.decisions.every((d) => !d.available)).toBe(true)
  })
})

describe('postgame report', () => {
  const r = buildPostgame(buildMatchIndex(scripted()))

  it('final, decided in overtime, won by the away side', () => {
    expect(r.home).toBe(2)
    expect(r.away).toBe(3)
    expect(r.decidedBy).toBe('overtime')
    expect(r.won).toBe(false)
    expect(r.goalsByPeriod.away).toEqual([0, 1, 1, 1])
  })

  it('names a turning point from the goals actually scored', () => {
    expect(r.turningPoint).not.toBeNull()
    expect(r.goals.map((g) => g.scorerName)).toContain(r.turningPoint!.scorerName)
    expect(r.turningPoint!.text).toMatch(/overtime/)
  })

  it('box score by team, with goalies and ratings', () => {
    expect(r.box.home.goalies.map((g) => g.playerId)).toEqual([HG])
    expect(r.box.away.goalies[0]!.shotsAgainst).toBe(4)
    const h1 = r.box.home.skaters.find((s) => s.playerId === 'h1')!
    expect(h1.goals).toBe(1)
    expect(h1.assists).toBe(1)
    expect(h1.faceoffs).toBe('1')
    expect(r.ratings.length).toBe(r.box.home.skaters.length + r.box.away.skaters.length + r.box.home.goalies.length + r.box.away.goalies.length)
  })

  it('three stars carry their reasons', () => {
    expect(r.stars).toHaveLength(3)
    for (const s of r.stars) expect(['home', 'away']).toContain(s.side)
  })
})

describe('a shootout', () => {
  // Regulation 1-1, a scoreless OT, then the engine's nominal shootout goal:
  // period 4, t = 300, centre ice, unassisted, no shot behind it.
  const base = scripted()
  const stream: GameStream = [
    frame(1, 0), lc(1, 0, H), lc(1, 0, A),
    shot(1, 60, 'h1', 0.8, true), goal(1, 60.4, 'h1', []),
    { type: 'periodEnd', period: 1, t: 1200 }, frame(2, 0),
    shot(2, 60, 'a1', 0.8, false), goal(2, 60.4, 'a1', []),
    { type: 'periodEnd', period: 2, t: 1200 }, frame(3, 0),
    { type: 'periodEnd', period: 3, t: 1200 }, frame(4, 0),
    shot(4, 100, 'a2', 0.3, false), save(4, 100.4, HG),
    { type: 'goal', period: 4, t: 300, scorer: id('a3'), assists: [], strength: 'ev', pos: { x: 0, y: 0 } },
    { type: 'gameEnd', period: 4, t: 300 },
  ]
  const idx = buildMatchIndex({ ...base, stream })
  const st = computeMatchStats(idx)
  const pg = buildPostgame(idx)

  it('counts on the scoreboard, not as a player goal, a shot or a goal against', () => {
    expect(st.shootoutWinner).toBe('away')
    expect(st.away.goals).toBe(2)
    expect(st.away.shots).toBe(2)
    expect(st.players.find((l) => l.id === 'a3')?.goals ?? 0).toBe(0)
    expect(st.players.find((l) => l.id === HG)!.goalsAgainst).toBe(1)
    expect(st.goals[st.goals.length - 1]!.shootout).toBe(true)
  })

  it('the postgame calls it a shootout, with its own column', () => {
    expect(pg.decidedBy).toBe('shootout')
    expect(pg.won).toBe(false)
    expect(pg.shootout).toEqual({ home: 0, away: 1 })
    expect(pg.goalsByPeriod.away.reduce((a, b) => a + b, 0)).toBe(1)
    expect(pg.turningPoint?.scorerName).not.toBe('Player A3')
  })
})

/* ─────────────────────────── the assistant ─────────────────────────── */

describe('assistant read', () => {
  const idx = buildMatchIndex(scripted())
  const st = computeMatchStats(idx)
  const team = (over: Partial<typeof st.home>) => ({ ...st.home, ...over })

  it('leads with the strongest real story and quotes its numbers', () => {
    const read = assistantRead({
      game: st, us: team({ shots: 18, xg: 1 }), them: team({ shots: 6, xg: 1, faceoffs: 0 }),
      userSide: 'home', ratings: [], scope: 'period', period: 2, seed: 's',
    })
    expect(read.working).toMatch(/18/)
    expect(read.working).toMatch(/6/)
  })

  it('names what is going wrong and suggests a fix for it', () => {
    const read = assistantRead({
      game: st, us: team({ shots: 5, xg: 1, giveaways: 0, takeaways: 0, faceoffs: 0, powerPlays: 0 }),
      them: team({ shots: 17, xg: 1, powerPlays: 0, faceoffs: 0 }),
      userSide: 'home', ratings: [], scope: 'period', period: 1, seed: 's',
    })
    expect(read.notWorking).toMatch(/17/)
    expect(read.suggestion.length).toBeGreaterThan(20)
  })

  it('a dead-air line for the game so far', () => {
    const line = assistantLiveLine({ game: st, us: st.home, them: st.away, userSide: 'home', ratings: rateMatch(st), scope: 'game', period: 3, seed: 's' })
    expect(line.length).toBeGreaterThan(10)
  })
})

/* ─────────────────────────── comprehensive highlights ─────────────────────────── */

describe('comprehensive highlight level', () => {
  const g = scripted()

  it('keeps goals, big saves, fights, posts and big hits — and nothing ordinary', () => {
    const segs = buildComprehensive(g.stream)
    const kinds = new Set(segs.map((s) => s.kind))
    expect(kinds.has('goal')).toBe(true)
    expect(kinds.has('fight')).toBe(true)
    expect(kinds.has('post')).toBe(true)
    // the 0.4 save at 30s and the 0.3 save in the 2nd are routine: no segment there
    expect(segs.some((s) => s.startAbsT <= 1250 && s.endAbsT >= 1250)).toBe(false)
  })

  it('a power-play goal keeps its man-advantage build-up', () => {
    const segs = buildComprehensive(g.stream)
    const pp = segs.find((s) => s.startAbsT <= 230 && s.endAbsT >= 230)!
    // an even-strength goal gets a 10 s lead-in (220.3); this one runs from the penalty
    expect(pp.startAbsT).toBeLessThan(210)
  })

  it('a big save is a highlight; a hit pinned on the boards is a big hit', () => {
    const s: GameStream = [
      shot(1, 100, 'h1', 0.8, true), save(1, 100.5, AG),
      { type: 'hit', period: 1, t: 500, by: id('a1'), on: id('h1'), pos: { x: 0.2, y: 0.95 } },
      { type: 'hit', period: 1, t: 700, by: id('a1'), on: id('h1'), pos: { x: 0.2, y: 0.1 } },
      { type: 'hit', period: 1, t: 900, by: id('a1'), on: id('h1'), pos: { x: 0.2, y: 0.1 }, force: 0.9 },
    ]
    const kinds = buildComprehensive(s).map((x) => x.kind)
    expect(kinds).toEqual(['bigSave', 'bigHit', 'bigHit'])
  })

  it('plans and sits between Key and Extended on real games', () => {
    const data = generateLeague({ seed: 5 })
    const career = new Career(data, 5, data.league.teams[0]!)
    let w = career.watchNext()
    for (let i = 0; i < 20 && !w; i++) w = career.watchNext()
    const stream = w!.stream
    expect(highlightsFor(stream, 'comprehensive').length).toBeGreaterThan(0)
    const key = estimateWallSeconds(planFor(stream, 'key'))
    const comp = estimateWallSeconds(planFor(stream, 'comprehensive'))
    const ext = estimateWallSeconds(planFor(stream, 'extended'))
    expect(key).toBeLessThanOrEqual(comp)
    expect(comp).toBeLessThan(ext)
  })
})

/* ─────────────────────────── on a real engine game ─────────────────────────── */

describe('on a real watched game', () => {
  const data = generateLeague({ seed: 3 })
  const career = new Career(data, 3, data.league.teams[1]!)
  let w = career.watchNext()
  for (let i = 0; i < 20 && !w; i++) w = career.watchNext()
  const game = w!

  it('the postgame box agrees with the stream', () => {
    const idx = buildMatchIndex(game)
    const pg = buildPostgame(idx)
    const shots = game.stream.filter((e) => e.type === 'shot')
    const homeIds = new Set(game.homePlayerIds)
    const homeShots = shots.filter((e) => e.type === 'shot' && homeIds.has(e.shooter as string)).length
    expect(pg.totals.home.shots).toBe(homeShots)
    expect(pg.totals.home.shots + pg.totals.away.shots).toBe(shots.length)
    const goals = game.stream.filter((e) => e.type === 'goal').length
    expect(pg.home + pg.away).toBe(goals)
    expect(pg.box.home.goalies.length).toBeGreaterThan(0)
    expect(pg.box.away.goalies.length).toBeGreaterThan(0)
    expect(pg.ratings.every((r) => r.rating >= 1 && r.rating <= 10)).toBe(true)
    expect(idx.intermissions.slice(0, 2).map((b) => b.absT)).toEqual([1200, 2400])
  })

  it('every intermission builds, and its score matches the fold at the horn', () => {
    const idx = buildMatchIndex(game)
    for (const b of idx.intermissions) {
      const r = buildIntermission(idx, b.period, 'k')
      const at = computeMatchStats(idx, b.absT - 1e-6)
      expect(r.home).toBe(at.home.goals)
      expect(r.away).toBe(at.away.goals)
    }
  })
})
