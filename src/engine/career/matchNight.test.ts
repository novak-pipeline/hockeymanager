/**
 * Match night (P6, B6.1–B6.3) — asserts the PLAYER-FACING claims, not just
 * that the objects exist:
 *   • a game day yields keys whose text cites the real numbers they came from;
 *   • the postgame turning point is a goal that actually happened in the stream,
 *     and the period breakdown sums to the final score;
 *   • the coach's word rotates — no verbatim repeat across a season;
 *   • a notable night writes ONE persistent chronicle moment.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { buildMatchKeys, detectPersistentMoment, findTurningPoint, threeStars } from './matchNight'

/* ────────────────────── pure units ────────────────────── */

describe('buildMatchKeys', () => {
  const side = (over: Partial<Parameters<typeof buildMatchKeys>[0]['user']> = {}) => ({
    abbr: 'AAA',
    gamesPlayed: 40,
    goalsFor: 120,
    goalsAgainst: 110,
    ppPct: 0.2,
    ppOpportunities: 120,
    pkPct: 0.8,
    timesShorthanded: 120,
    streak: 0,
    ...over,
  })

  it('cites the ACTUAL special-teams percentages in the key text', () => {
    const keys = buildMatchKeys({
      user: side({ abbr: 'USR', pkPct: 0.763, timesShorthanded: 130 }),
      opp: side({ abbr: 'OPP', ppPct: 0.284, ppOpportunities: 140 }),
      oppHotScorer: null,
      userGoalie: null,
      oppGoalie: null,
      home: true,
    })
    const st = keys.find((k) => k.title.includes('power play vs your kill'))
    expect(st).toBeDefined()
    // The numbers on screen must be the numbers we were handed.
    expect(st!.detail).toContain('28.4%')
    expect(st!.detail).toContain('76.3%')
    expect(st!.detail).toContain('OPP')
  })

  it('names the hot scorer with his real goal/assist totals', () => {
    const keys = buildMatchKeys({
      user: side(),
      opp: side({ abbr: 'OPP' }),
      oppHotScorer: { name: 'Nikita Volkov', goals: 27, assists: 34, form: 4 },
      userGoalie: null,
      oppGoalie: null,
      home: false,
    })
    const hot = keys.find((k) => k.title.includes('Volkov'))
    expect(hot).toBeDefined()
    expect(hot!.detail).toContain('27 goals')
    expect(hot!.detail).toContain('34 assists')
  })

  it('reports goalie form with the real save percentage and rating', () => {
    const keys = buildMatchKeys({
      user: side(),
      opp: side({ abbr: 'OPP' }),
      oppHotScorer: null,
      userGoalie: { name: 'Ilya Barkov', svPct: 0.928, shotsFaced: 900, last5Avg: 7.6 },
      oppGoalie: null,
      home: true,
    })
    const g = keys.find((k) => k.detail.includes('Barkov'))
    expect(g).toBeDefined()
    expect(g!.detail).toContain('.928')
    expect(g!.detail).toContain('7.6')
  })

  it('never returns more than three keys, and never zero', () => {
    const loaded = buildMatchKeys({
      user: side({ abbr: 'USR', streak: -5 }),
      opp: side({ abbr: 'OPP', streak: 6, ppPct: 0.3 }),
      oppHotScorer: { name: 'A Star', goals: 30, assists: 30, form: 5 },
      userGoalie: { name: 'G One', svPct: 0.9, shotsFaced: 800, last5Avg: 4.8 },
      oppGoalie: { name: 'G Two', svPct: 0.93, shotsFaced: 800, last5Avg: 7.9 },
      home: true,
    })
    expect(loaded.length).toBe(3)

    // Opening night: no sample anywhere — still says something honest.
    const empty = buildMatchKeys({
      user: side({ gamesPlayed: 0, goalsFor: 0, goalsAgainst: 0, ppPct: 0, ppOpportunities: 0, pkPct: 0, timesShorthanded: 0 }),
      opp: side({ gamesPlayed: 0, goalsFor: 0, goalsAgainst: 0, ppPct: 0, ppOpportunities: 0, pkPct: 0, timesShorthanded: 0 }),
      oppHotScorer: null,
      userGoalie: null,
      oppGoalie: null,
      home: true,
    })
    expect(empty.length).toBeGreaterThan(0)
    expect(empty[0]!.detail.length).toBeGreaterThan(10)
  })
})

describe('findTurningPoint', () => {
  it('picks the late go-ahead goal over an early one', () => {
    const tp = findTurningPoint(
      [
        { period: 1, t: 120, scorerName: 'Early Guy', byUser: true },
        { period: 2, t: 300, scorerName: 'Their Guy', byUser: false },
        { period: 3, t: 862, scorerName: 'Clutch Guy', byUser: true },
      ],
      true,
      'regulation'
    )
    expect(tp).not.toBeNull()
    expect(tp!.scorerName).toBe('Clutch Guy')
    expect(tp!.period).toBe(3)
    expect(tp!.clock).toBe('14:22')
    expect(tp!.text).toContain('Clutch Guy')
  })

  it('calls out an overtime winner as the moment', () => {
    const tp = findTurningPoint(
      [
        { period: 1, t: 60, scorerName: 'A', byUser: true },
        { period: 3, t: 1100, scorerName: 'B', byUser: false },
        { period: 4, t: 45, scorerName: 'OT Hero', byUser: true },
      ],
      true,
      'overtime'
    )
    expect(tp!.scorerName).toBe('OT Hero')
    expect(tp!.text).toContain('overtime')
  })

  it('finds the equalizer that flipped a game the user came back to win', () => {
    const tp = findTurningPoint(
      [
        { period: 1, t: 200, scorerName: 'Them1', byUser: false },
        { period: 2, t: 400, scorerName: 'Them2', byUser: false },
        { period: 3, t: 200, scorerName: 'Us1', byUser: true },
        { period: 3, t: 900, scorerName: 'Us2', byUser: true },
        { period: 3, t: 1150, scorerName: 'Us3', byUser: true },
      ],
      true,
      'regulation'
    )
    // Us3 broke the 2–2 tie late AND was the game-winner.
    expect(tp!.scorerName).toBe('Us3')
    expect(tp!.text).toMatch(/tie|decided/)
  })

  it('returns null only for a goalless stream', () => {
    expect(findTurningPoint([], false, 'regulation')).toBeNull()
  })
})

describe('threeStars', () => {
  it('ranks by game rating and formats real stat lines', () => {
    const stars = threeStars([
      { playerId: 'p1', name: 'Top Guy', teamAbbr: 'AAA', isGoalie: false, goals: 2, assists: 1, shots: 5, saves: 0, shotsAgainst: 0, rating: 9.1 },
      { playerId: 'p2', name: 'Netminder', teamAbbr: 'BBB', isGoalie: true, goals: 0, assists: 0, shots: 0, saves: 31, shotsAgainst: 33, rating: 8.4 },
      { playerId: 'p3', name: 'Third Guy', teamAbbr: 'AAA', isGoalie: false, goals: 0, assists: 2, shots: 3, saves: 0, shotsAgainst: 0, rating: 7.2 },
      { playerId: 'p4', name: 'Nobody', teamAbbr: 'BBB', isGoalie: false, goals: 0, assists: 0, shots: 1, saves: 0, shotsAgainst: 0, rating: 5.1 },
    ])
    expect(stars.map((s) => s.playerId)).toEqual(['p1', 'p2', 'p3'])
    expect(stars[0]!.statLine).toBe('2 G, 1 A')
    expect(stars[1]!.statLine).toContain('31 sv on 33')
    expect(stars[1]!.statLine).toContain('.939')
    expect(stars[2]!.statLine).toBe('2 A')
  })

  it('breaks a saturated-rating tie on points, then GOALS (the scale caps at 9.5)', () => {
    const at = (over: Partial<Parameters<typeof threeStars>[0][number]>) => ({
      playerId: 'x', name: 'X', teamAbbr: 'AAA', isGoalie: false,
      goals: 0, assists: 0, shots: 0, saves: 0, shotsAgainst: 0, rating: 9.5, ...over,
    })
    const stars = threeStars([
      at({ playerId: 'oneG', name: 'One Goal', goals: 1, assists: 2 }),   // 3 pts
      at({ playerId: 'twoG', name: 'Two Goals', goals: 2, assists: 1 }),  // 3 pts, more goals
      at({ playerId: 'twoP', name: 'Two Points', goals: 1, assists: 1 }), // 2 pts
      at({ playerId: 'zero', name: 'No Points' }),
    ])
    // All four tie at the 9.5 ceiling, so points then goals must decide.
    expect(stars.map((s) => s.playerId)).toEqual(['twoG', 'oneG', 'twoP'])
    expect(stars[0]!.statLine).toBe('2 G, 1 A')
  })
})

describe('detectPersistentMoment', () => {
  const base = { won: true, oppAbbr: 'OPP', rivalry: false, firstGoalScorers: [], goalie: null, fight: null }

  it('prioritises a first NHL goal', () => {
    const m = detectPersistentMoment({
      ...base,
      firstGoalScorers: [{ playerId: 'rk1', name: 'Rookie Kid', age: 19 }],
      goalie: { playerId: 'g1', name: 'Wall', saves: 39, shotsAgainst: 40 },
    })
    expect(m!.kind).toBe('firstGoal')
    expect(m!.playerIds).toEqual(['rk1'])
    expect(m!.headline).toContain('first NHL goal')
  })

  it('records a goalie steal at >= .950 on 30+ shots in a WIN', () => {
    const m = detectPersistentMoment({ ...base, goalie: { playerId: 'g1', name: 'Wall', saves: 39, shotsAgainst: 41 } })
    expect(m!.kind).toBe('goalieSteal')
    expect(m!.headline).toContain('39 of 41')

    // Just under the bar, or in a loss → not a persistent moment.
    expect(detectPersistentMoment({ ...base, goalie: { playerId: 'g1', name: 'Wall', saves: 28, shotsAgainst: 29 } })).toBeNull()
    expect(detectPersistentMoment({ ...base, won: false, goalie: { playerId: 'g1', name: 'Wall', saves: 39, shotsAgainst: 41 } })).toBeNull()
  })

  it('records a scrap only when there was rivalry heat', () => {
    const fight = { ourId: 'f1', ourName: 'Our Tough Guy', theirName: 'Their Tough Guy' }
    expect(detectPersistentMoment({ ...base, rivalry: true, fight })!.kind).toBe('rivalScrap')
    expect(detectPersistentMoment({ ...base, rivalry: false, fight })).toBeNull()
  })

  it('returns null on an ordinary night', () => {
    expect(detectPersistentMoment({ ...base, goalie: { playerId: 'g1', name: 'Meh', saves: 22, shotsAgainst: 25 } })).toBeNull()
  })
})

/* ────────────────────── live career integration ────────────────────── */

/** Advance until the next day to sim is a user game day (preview non-null). */
function driveToUserGameDay(career: Career): boolean {
  for (let guard = 0; guard < 60; guard++) {
    if (career.getMatchDayPreview() !== null) return true
    if (!career.advanceDay()) return false
  }
  return career.getMatchDayPreview() !== null
}

describe('Career — match night end to end', () => {
  it('offers a match-day frame on a user game day, with real records and both lineups', () => {
    const data = generateLeague({ seed: 909 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 909, userId)
    // Sim into the season so the keys have a real sample to cite.
    for (let i = 0; i < 25; i++) if (!career.advanceDay()) break
    expect(driveToUserGameDay(career)).toBe(true)

    const pv = career.getMatchDayPreview()!
    expect(pv.day).toBeGreaterThan(0)
    expect(pv.opponentTeamId).not.toBe(userId as string)
    expect(pv.opponentName.length).toBeGreaterThan(0)
    expect(pv.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Records are real W-L-OTL strings for both clubs.
    expect(pv.user.record).toMatch(/^\d+-\d+-\d+$/)
    expect(pv.opponent.record).toMatch(/^\d+-\d+-\d+$/)
    // Keys: 1–3, every one with a title and a detail.
    expect(pv.keys.length).toBeGreaterThan(0)
    expect(pv.keys.length).toBeLessThanOrEqual(3)
    for (const k of pv.keys) {
      expect(k.title.length).toBeGreaterThan(0)
      expect(k.detail.length).toBeGreaterThan(10)
    }
    // At least one key cites a hard number (percentage, save pct, or a count).
    expect(pv.keys.some((k) => /\d/.test(k.detail))).toBe(true)
    // Projected lines, both benches: four forward lines and three pairs dressed.
    expect(pv.user.forwardLines.length).toBeGreaterThanOrEqual(4)
    expect(pv.user.defensePairs.length).toBeGreaterThanOrEqual(3)
    expect(pv.opponent.forwardLines.length).toBeGreaterThanOrEqual(4)
    expect(pv.user.forwardLines[0]!.length).toBe(3)
    expect(pv.user.starter).not.toBeNull()

    // Deterministic per (seed, day).
    const twin = new Career(generateLeague({ seed: 909 }), 909, userId)
    for (let i = 0; i < 25; i++) if (!twin.advanceDay()) break
    driveToUserGameDay(twin)
    expect(twin.getMatchDayPreview()).toEqual(pv)
  })

  it('has NO match-day frame on a day the user does not play', () => {
    const data = generateLeague({ seed: 313 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 313, userId)
    let sawIdleDay = false
    for (let i = 0; i < 40; i++) {
      if (career.getMatchDayPreview() === null && career.getDay() > 0) { sawIdleDay = true; break }
      if (!career.advanceDay()) break
    }
    // Over a 40-day window a club always gets at least one off day.
    expect(sawIdleDay).toBe(true)
  })

  it('presents postgame receipts whose numbers match the game that was played', () => {
    const data = generateLeague({ seed: 5150 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 5150, userId)
    expect(driveToUserGameDay(career)).toBe(true)
    const preview = career.getMatchDayPreview()!
    expect(career.advanceDay()).toBe(true)

    const r = career.getPostgameReceipt()
    expect(r).not.toBeNull()
    if (!r) return
    expect(r.day).toBe(preview.day)
    expect(r.gameId.length).toBeGreaterThan(0)
    // The period breakdown must sum to the final score (OT/SO decider included).
    const homeSum = r.homeByPeriod.reduce((a, b) => a + b, 0)
    const awaySum = r.awayByPeriod.reduce((a, b) => a + b, 0)
    expect(homeSum).toBe(r.homeGoals)
    expect(awaySum).toBe(r.awayGoals)
    expect(r.homeByPeriod.length).toBeGreaterThanOrEqual(3)
    // The won flag agrees with the score from the user's side.
    const usG = r.userHome ? r.homeGoals : r.awayGoals
    const themG = r.userHome ? r.awayGoals : r.homeGoals
    expect(r.won).toBe(usG > themG)
    // Three stars: real ratings, ordered.
    expect(r.stars.length).toBeGreaterThan(0)
    for (let i = 1; i < r.stars.length; i++) {
      expect(r.stars[i - 1]!.rating).toBeGreaterThanOrEqual(r.stars[i]!.rating)
    }
    for (const s of r.stars) {
      expect(s.rating).toBeGreaterThan(0)
      expect(s.statLine.length).toBeGreaterThan(0)
    }
    // Grades cover the user's dressed roster, best first.
    expect(r.grades.length).toBeGreaterThan(10)
    for (let i = 1; i < r.grades.length; i++) {
      expect(r.grades[i - 1]!.rating).toBeGreaterThanOrEqual(r.grades[i]!.rating)
    }
    // The coach speaks after EVERY game.
    expect(r.quote).not.toBeNull()
    expect(r.quote!.text.length).toBeGreaterThan(20)
    expect(r.quote!.speaker.length).toBeGreaterThan(0)
  })

  it('names a turning point that is a goal from the game actually played', () => {
    const data = generateLeague({ seed: 777 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 777, userId)

    let checked = 0
    for (let guard = 0; guard < 60 && checked < 5; guard++) {
      if (career.getMatchDayPreview() === null) {
        if (!career.advanceDay()) break
        continue
      }
      if (!career.advanceDay()) break
      const r = career.getPostgameReceipt()
      const bs = career.getLastBoxScore()
      if (!r || !bs) continue
      if (r.homeGoals + r.awayGoals === 0) continue // 0–0 into a shootout: no goal to cite
      expect(r.turningPoint).not.toBeNull()
      const tp = r.turningPoint!
      // The cited goal must be a goal that really happened: same scorer, same
      // period, present in the box score's goal log. The receipt cannot invent
      // a moment. (Clocks are NOT compared — the goal log prints ABSOLUTE game
      // time while the receipt prints time within the period; see below.)
      const match = bs.goals.find((g) => g.scorer === tp.scorerName && g.period === tp.period)
      expect(match, `turning point ${tp.scorerName} P${tp.period} not in the goal log`).toBeDefined()
      // A regulation clock must be a real period time — never past 20:00.
      if (tp.period <= 3) {
        const [mm, ss] = tp.clock.split(':').map(Number)
        expect(mm! * 60 + ss!).toBeLessThanOrEqual(20 * 60)
      }
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('period breakdown always sums to the final score — INCLUDING a shootout', () => {
    // Shootouts are the trap: the decider counts in the score but is not a goal
    // in the stream, so a naive breakdown showed 1+4+0=5 beside a total of 6.
    let seenShootout = false
    let seenOvertime = false
    let checkedGames = 0
    for (const seed of [5150, 777, 909, 2468, 1234, 4242]) {
      const data = generateLeague({ seed })
      const userId = data.league.teams[0]!
      const career = new Career(data, seed, userId)
      for (let guard = 0; guard < 120; guard++) {
        if (career.getMatchDayPreview() === null) {
          if (!career.advanceDay()) break
          continue
        }
        if (!career.advanceDay()) break
        const r = career.getPostgameReceipt()
        if (!r) continue
        checkedGames++
        expect(
          r.homeByPeriod.reduce((a, b) => a + b, 0),
          `home breakdown ${r.homeByPeriod.join('+')} vs ${r.homeGoals} (${r.decidedBy})`
        ).toBe(r.homeGoals)
        expect(
          r.awayByPeriod.reduce((a, b) => a + b, 0),
          `away breakdown ${r.awayByPeriod.join('+')} vs ${r.awayGoals} (${r.decidedBy})`
        ).toBe(r.awayGoals)
        if (r.decidedBy === 'shootout') {
          seenShootout = true
          // The appended SO column holds exactly the one decider, for the winner.
          const soHome = r.homeByPeriod[r.homeByPeriod.length - 1]!
          const soAway = r.awayByPeriod[r.awayByPeriod.length - 1]!
          expect(soHome + soAway).toBe(1)
          expect(r.homeGoals > r.awayGoals ? soHome : soAway).toBe(1)
        }
        if (r.decidedBy === 'overtime') seenOvertime = true
        if (seenShootout && seenOvertime && checkedGames > 40) break
      }
      if (seenShootout && seenOvertime) break
    }
    expect(checkedGames).toBeGreaterThan(10)
    // A season of hockey must produce both, or this test proved nothing.
    expect(seenShootout, 'no shootout sampled — the SO column went unverified').toBe(true)
    expect(seenOvertime, 'no overtime sampled').toBe(true)
  })

  it('rotates the coach postgame word — no verbatim repeat across a season', () => {
    const data = generateLeague({ seed: 2468 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 2468, userId)

    const seen: string[] = []
    for (let guard = 0; guard < 200; guard++) {
      if (career.getMatchDayPreview() === null) {
        if (!career.advanceDay()) break
        continue
      }
      if (!career.advanceDay()) break
      const q = career.getPostgameReceipt()?.quote
      if (q) seen.push(q.text)
      if (seen.length >= 18) break
    }
    expect(seen.length).toBeGreaterThanOrEqual(15)
    // Every line the coach gave us this season is distinct (content-engine
    // no-repeat ledger — B4.5). A repeated podium line is the bug.
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('writes at most one persistent chronicle moment per game, and cites it on the receipt', () => {
    const data = generateLeague({ seed: 1234 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 1234, userId)

    let moments = 0
    let receiptsWithStoryline = 0
    for (let guard = 0; guard < 120; guard++) {
      if (career.getMatchDayPreview() === null) {
        if (!career.advanceDay()) break
        continue
      }
      const before = career.getChronicleMomentCount()
      if (!career.advanceDay()) break
      const after = career.getChronicleMomentCount()
      // Never more than one persistent moment written per game.
      expect(after - before).toBeLessThanOrEqual(1)
      if (after > before) {
        moments++
        // ...and when one was written, the receipt tells the GM about it.
        expect(career.getPostgameReceipt()?.storyline).toBeTruthy()
        receiptsWithStoryline++
      }
    }
    // A full season of hockey produces at least one storyline worth keeping.
    expect(moments).toBeGreaterThan(0)
    expect(receiptsWithStoryline).toBe(moments)
  })
})
