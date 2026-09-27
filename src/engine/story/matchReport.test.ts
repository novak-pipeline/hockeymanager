import { describe, expect, it } from 'vitest'
import { buildMatchReport, decisiveScorer, detectRareBeat, type MatchReportGoal, type MatchReportInput } from './matchReport'

function goal(o: Partial<MatchReportGoal> = {}): MatchReportGoal {
  return {
    period: 1,
    t: 600,
    byUser: true,
    scorerName: 'Sam Roy',
    scorerPosition: 'C',
    strength: 'ev',
    assistPositions: ['W'],
    assistNames: ['Jack Bex'],
    ...o,
  }
}

function input(o: Partial<MatchReportInput> = {}): MatchReportInput {
  const goals = o.goals ?? [goal(), goal({ byUser: false, t: 900 }), goal({ period: 3, t: 400 })]
  const userGoals = o.userGoals ?? goals.filter((g) => g.byUser).length
  const oppGoals = o.oppGoals ?? goals.filter((g) => !g.byUser).length
  return {
    gameId: 'g1',
    userAbbr: 'HCA',
    oppAbbr: 'RVK',
    won: userGoals > oppGoals,
    playoff: false,
    decidedBy: 'regulation',
    userShots: 30,
    oppShots: 28,
    ...o,
    goals,
    userGoals,
    oppGoals,
  }
}

describe('buildMatchReport — the write-up', () => {
  it('always says something, and never leaves a slot unfilled', () => {
    for (const gameId of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      for (const won of [true, false]) {
        const r = buildMatchReport(input({ gameId, won, userGoals: won ? 3 : 1, oppGoals: won ? 1 : 3 }))
        expect(r.length).toBeGreaterThan(20)
        expect(r).not.toMatch(/\{[a-zA-Z]/)
      }
    }
  })

  it('is stable for one game and varies across games', () => {
    const a = buildMatchReport(input({ gameId: 'x' }))
    expect(buildMatchReport(input({ gameId: 'x' }))).toBe(a)
    const many = new Set(
      ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'].map((gameId) => buildMatchReport(input({ gameId })))
    )
    expect(many.size).toBeGreaterThanOrEqual(2)
  })

  it('names the shape of the game, not just the score', () => {
    // A three-goal hole climbed out of has to READ like one.
    const comeback = buildMatchReport(
      input({
        gameId: 'cb',
        goals: [
          goal({ byUser: false, t: 100 }),
          goal({ byUser: false, t: 300 }),
          goal({ byUser: false, t: 500 }),
          goal({ period: 2, t: 100 }),
          goal({ period: 2, t: 700 }),
          goal({ period: 3, t: 200 }),
          goal({ period: 3, t: 1100 }),
        ],
      })
    )
    expect(comeback.toLowerCase()).toMatch(/back|climb|hole|down/)
  })

  it('credits the man who actually decided it', () => {
    const r = buildMatchReport(
      input({
        gameId: 'dec',
        goals: [
          goal({ byUser: false, t: 100 }),
          goal({ period: 2, t: 100 }),
          goal({ period: 3, t: 1000, scorerName: 'Anders Kallio' }),
        ],
      })
    )
    expect(r).toContain('Anders Kallio')
  })
})

describe('detectRareBeat — a wacky sentence is always a receipt', () => {
  it('finds nothing on an ordinary night', () => {
    expect(detectRareBeat(input({ gameId: 'plain' }))).toBeNull()
  })

  it('catches a shorthanded goal', () => {
    const r = detectRareBeat(input({ gameId: 'sh', goals: [goal({ strength: 'sh' }), goal({ byUser: false })] }))
    expect(r?.kind).toBe('shorthanded')
  })

  it('catches a goaltender assist, and ranks it above everything else', () => {
    const r = detectRareBeat(
      input({
        gameId: 'ga',
        goals: [
          goal({ strength: 'sh' }),
          goal({ assistPositions: ['G'], assistNames: ['Mika Ovechkin'] }),
        ],
      })
    )
    expect(r?.kind).toBe('goalieAssist')
    expect(r?.name).toBe('Mika Ovechkin')
  })

  it('catches four goals from one man', () => {
    const four = [1, 2, 3, 4].map((i) => goal({ t: i * 200, scorerName: 'Sam Roy' }))
    const r = detectRareBeat(input({ gameId: '4g', goals: four }))
    expect(r?.kind).toBe('fourGoals')
  })

  it('catches a defenceman ending it in overtime', () => {
    const r = detectRareBeat(
      input({
        gameId: 'ot',
        decidedBy: 'overtime',
        goals: [goal({ byUser: false }), goal({ period: 4, t: 90, scorerPosition: 'D', scorerName: 'Ivar Bex' })],
      })
    )
    expect(r?.kind).toBe('defencemanOtWinner')
    expect(r?.name).toBe('Ivar Bex')
  })

  it('catches a goal inside the first minute', () => {
    const r = detectRareBeat(input({ gameId: 'op', goals: [goal({ t: 22 }), goal({ byUser: false, t: 900 })] }))
    expect(r?.kind).toBe('openingMinute')
  })

  it('catches three goals inside two minutes', () => {
    const r = detectRareBeat(
      input({
        gameId: 'fl',
        goals: [
          goal({ t: 400, scorerName: 'A One' }),
          goal({ t: 460, scorerName: 'B Two' }),
          goal({ t: 505, scorerName: 'C Three' }),
          goal({ byUser: false, period: 3 }),
        ],
      })
    )
    expect(r?.kind).toBe('flurry')
  })

  it('renders the rare beat into the write-up when one fires', () => {
    const r = buildMatchReport(
      input({ gameId: 'sh2', goals: [goal({ strength: 'sh', scorerName: 'Pekka Roy' }), goal({ byUser: false })] })
    )
    expect(r.toLowerCase()).toMatch(/shorthanded|a man down/)
    expect(r).toContain('Pekka Roy')
  })

  it('does NOT invent one on an ordinary night', () => {
    const r = buildMatchReport(input({ gameId: 'plain2' }))
    expect(r.toLowerCase()).not.toMatch(/shorthanded|scrapbook|four\. four|empty-netter/)
  })
})

describe('F-30: the report agrees with the box score', () => {
  it("names the NHL game-winner (one more than the loser's final), not the last go-ahead goal", () => {
    const goals = [
      goal({ t: 100, scorerName: 'Evgeni Malkin' }), // 1-0
      goal({ byUser: false, t: 200 }), //              1-1
      goal({ t: 300, scorerName: 'Sidney Crosby' }), // 2-1  the last go-ahead goal
      goal({ t: 400, scorerName: 'Bryan Rust' }), //    3-1  the GWG: the loser finishes with 2
      goal({ byUser: false, period: 3, t: 100 }), //    3-2
    ]
    expect(decisiveScorer(input({ goals }))?.scorerName).toBe('Bryan Rust')
    for (const gameId of ['a', 'b', 'c', 'd']) {
      const r = buildMatchReport(input({ gameId, goals }))
      expect(r).not.toContain('Sidney Crosby')
    }
  })

  it('never calls a game that was tied after the first goal "wire-to-wire"', () => {
    const WIRE = /wire-to-wire|Not once behind|held the lead the whole way/i
    const tied = [goal({ t: 100 }), goal({ byUser: false, t: 200 }), goal({ period: 2, t: 100 }), goal({ period: 3, t: 100 })]
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    for (const gameId of ids) expect(buildMatchReport(input({ gameId, goals: tied }))).not.toMatch(WIRE)
    // a true front-runner still can be
    const wire = [goal({ t: 100 }), goal({ t: 200 }), goal({ byUser: false, period: 3, t: 100 })]
    expect(ids.some((gameId) => WIRE.test(buildMatchReport(input({ gameId, goals: wire }))))).toBe(true)
  })
})
