import { describe, expect, it } from 'vitest'
import {
  appendSagaLine,
  buildPresserFactSheet,
  buildTentpoleFactSheet,
  buildWeeklyFactSheet,
  SAGA_MAX_CHARS,
  type PressFactArgs,
} from './factSheet'

function args(overrides: Partial<PressFactArgs> = {}): PressFactArgs {
  return {
    year: 2026,
    day: 14,
    team: {
      name: 'Harbor City Admirals',
      abbr: 'HCA',
      wins: 5,
      losses: 2,
      otLosses: 1,
      points: 11,
      rank: 3,
      teamsInLeague: 16,
      expectedRank: 7,
    },
    lastResults: [
      { day: 12, opponentAbbr: 'RVK', home: true, goalsFor: 4, goalsAgainst: 1, decidedBy: 'regulation' },
      { day: 14, opponentAbbr: 'NOR', home: false, goalsFor: 2, goalsAgainst: 3, decidedBy: 'overtime' },
    ],
    topArcs: [
      { kind: 'hotStreak', summary: 'Kallio has points in six straight.', tension: 40 },
      { kind: 'feud', summary: 'Tempers flare between Roy and Bex.', tension: 80 },
    ],
    lockerRoom: {
      roomMorale: 62,
      captainName: 'Anders Kallio',
      feuds: ['Roy vs Bex'],
      mentorships: ['Kallio mentoring Smith'],
    },
    rumors: [
      { playerName: 'D. Roy', teamAbbr: 'HCA', heat: 55 },
      { playerName: 'M. Falk', teamAbbr: 'RVK', heat: 70 },
    ],
    recordsWatch: ['Kallio on pace for 58 goals (record: 61, Maki, 2018)'],
    upcomingOpponents: ['vs RVK (day 16)', '@ NOR (day 18)'],
    leagueLeaders: [{ name: 'A. Kallio', teamAbbr: 'HCA', stat: 'points', value: 21 }],
    sagaSoFar: 'Y2026 D1: season opens.\nY2026 D12: W 4-1 vs RVK.',
    ...overrides,
  }
}

describe('appendSagaLine', () => {
  it('appends one line and keeps existing content', () => {
    const s = appendSagaLine('first line', 'second line')
    expect(s).toBe('first line\nsecond line')
  })

  it('starts cleanly from an empty saga and strips newlines from the line', () => {
    expect(appendSagaLine('', 'a\nb  ')).toBe('a b')
    expect(appendSagaLine('x', '   ')).toBe('x')
  })

  it('drops oldest lines once over the cap', () => {
    let saga = ''
    for (let i = 0; i < 200; i++) saga = appendSagaLine(saga, `event number ${i} happened today`)
    expect(saga.length).toBeLessThanOrEqual(SAGA_MAX_CHARS)
    expect(saga.includes('event number 199')).toBe(true)
    expect(saga.includes('event number 0 ')).toBe(false)
  })

  it('hard-truncates a single over-long line', () => {
    const s = appendSagaLine('', 'x'.repeat(5000), 100)
    expect(s.length).toBe(100)
  })
})

describe('buildWeeklyFactSheet', () => {
  it('marks the sheet weekly with no special lines and copies team facts verbatim', () => {
    const sheet = buildWeeklyFactSheet(args())
    expect(sheet.kind).toBe('weekly')
    expect(sheet.special).toEqual([])
    expect(sheet.team).toEqual(args().team)
    expect(sheet.year).toBe(2026)
    expect(sheet.day).toBe(14)
    expect(sheet.sagaSoFar).toBe(args().sagaSoFar)
  })

  it('never invents data: every list element appears in the inputs', () => {
    const input = args()
    const sheet = buildWeeklyFactSheet(input)
    for (const r of sheet.lastResults) expect(input.lastResults).toContainEqual(r)
    for (const a of sheet.topArcs) expect(input.topArcs).toContainEqual(a)
    for (const r of sheet.rumors) expect(input.rumors).toContainEqual(r)
    for (const l of sheet.leagueLeaders) expect(input.leagueLeaders).toContainEqual(l)
    for (const s of sheet.recordsWatch) expect(input.recordsWatch).toContain(s)
    for (const o of sheet.upcomingOpponents) expect(input.upcomingOpponents).toContain(o)
  })

  it('sorts arcs by tension and clamps every list', () => {
    const many = args({
      topArcs: Array.from({ length: 8 }, (_, i) => ({
        kind: 'hotStreak',
        summary: `arc ${i}`,
        tension: i * 10,
      })),
      lastResults: Array.from({ length: 9 }, (_, i) => ({
        day: i + 1,
        opponentAbbr: 'OPP',
        home: true,
        goalsFor: 1,
        goalsAgainst: 0,
        decidedBy: 'regulation' as const,
      })),
      rumors: Array.from({ length: 6 }, (_, i) => ({
        playerName: `p${i}`,
        teamAbbr: 'T',
        heat: i,
      })),
    })
    const sheet = buildWeeklyFactSheet(many)
    expect(sheet.topArcs).toHaveLength(3)
    expect(sheet.topArcs[0].tension).toBe(70)
    expect(sheet.lastResults).toHaveLength(5)
    // Most recent results survive the clamp.
    expect(sheet.lastResults[4].day).toBe(9)
    expect(sheet.rumors).toHaveLength(3)
    expect(sheet.rumors[0].heat).toBe(5)
  })

  it('trims an oversized saga to the cap, keeping the newest end', () => {
    const sheet = buildWeeklyFactSheet(args({ sagaSoFar: 'a'.repeat(2000) + 'END' }))
    expect(sheet.sagaSoFar.length).toBe(SAGA_MAX_CHARS)
    expect(sheet.sagaSoFar.endsWith('END')).toBe(true)
  })

  it('omits expectedRank when the input omits it (exact optional)', () => {
    const input = args()
    delete (input.team as { expectedRank?: number }).expectedRank
    const sheet = buildWeeklyFactSheet(input)
    expect('expectedRank' in sheet.team).toBe(false)
  })
})

describe('buildTentpoleFactSheet / buildPresserFactSheet', () => {
  it('stamps the tentpole kind and carries special lines through', () => {
    const sheet = buildTentpoleFactSheet('deadline', args(), ['HCA traded Roy to RVK for a 1st'])
    expect(sheet.kind).toBe('deadline')
    expect(sheet.special).toEqual(['HCA traded Roy to RVK for a 1st'])
  })

  it('clamps special lines to eight', () => {
    const special = Array.from({ length: 12 }, (_, i) => `line ${i}`)
    const sheet = buildTentpoleFactSheet('champion', args(), special)
    expect(sheet.special).toHaveLength(8)
    expect(sheet.special[0]).toBe('line 0')
  })

  it('builds presser sheets with kind presser', () => {
    const sheet = buildPresserFactSheet(args(), ['Lost 1-6 at home'])
    expect(sheet.kind).toBe('presser')
    expect(sheet.special).toEqual(['Lost 1-6 at home'])
  })
})
