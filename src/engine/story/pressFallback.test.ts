import { describe, expect, it } from 'vitest'
import {
  buildTentpoleFactSheet,
  buildWeeklyFactSheet,
  type PressFactArgs,
  type PressJob,
} from './factSheet'
import { renderFallback } from './pressFallback'

function args(): PressFactArgs {
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
    topArcs: [{ kind: 'feud', summary: 'Tempers flare between Roy and Bex.', tension: 80 }],
    lockerRoom: {
      roomMorale: 62,
      captainName: 'Anders Kallio',
      feuds: ['Roy vs Bex'],
      mentorships: [],
    },
    rumors: [{ playerName: 'M. Falk', teamAbbr: 'RVK', heat: 70 }],
    recordsWatch: ['Kallio on pace for 58 goals'],
    upcomingOpponents: ['vs RVK (day 16)'],
    leagueLeaders: [{ name: 'A. Kallio', teamAbbr: 'HCA', stat: 'points', value: 21 }],
    sagaSoFar: 'Y2026 D1: season opens.',
  }
}

function weeklyJob(): PressJob {
  return { id: 'pj1', kind: 'weekly', personaId: 'beat', factSheet: buildWeeklyFactSheet(args()) }
}

describe('renderFallback', () => {
  it('produces a non-empty headline, body and persona byline', () => {
    const art = renderFallback(weeklyJob())
    expect(art.headline.length).toBeGreaterThan(5)
    expect(art.body.length).toBeGreaterThan(100)
    expect(art.byline).toContain('Sam Carver')
    expect(art.byline).toContain('The Daily Gazette')
  })

  it('only states facts that exist in the sheet', () => {
    const art = renderFallback(weeklyJob())
    expect(art.body).toContain('Harbor City Admirals')
    expect(art.body).toContain('5–2–1')
    expect(art.body).toContain('Day 12: W 4–1 vs RVK')
    expect(art.body).toContain('Day 14: L 2–3 (OT) @ NOR')
    expect(art.body).toContain('Tempers flare between Roy and Bex.')
    expect(art.body).toContain('A. Kallio')
    expect(art.body).toContain('M. Falk')
    expect(art.body).toContain('preseason projection of 7')
  })

  it('is deterministic: same job renders byte-identical output', () => {
    const a = renderFallback(weeklyJob())
    const b = renderFallback(weeklyJob())
    expect(a).toEqual(b)
  })

  it('uses different bylines per persona', () => {
    const job = weeklyJob()
    const national = renderFallback({ ...job, personaId: 'national' })
    const homer = renderFallback({ ...job, personaId: 'homer' })
    expect(national.byline).toContain('Vic Mercer')
    expect(homer.byline).toContain('990 The Fan')
    expect(national.byline).not.toBe(homer.byline)
  })

  it('surfaces tentpole special lines under a big-story block', () => {
    const job: PressJob = {
      id: 'pj2',
      kind: 'deadline',
      personaId: 'national',
      factSheet: buildTentpoleFactSheet('deadline', args(), ['HCA traded Roy to RVK for a 1st']),
    }
    const art = renderFallback(job)
    expect(art.headline.toLowerCase()).toContain('deadline')
    expect(art.body).toContain('HCA traded Roy to RVK for a 1st')
  })

  it('handles empty optional sections without leaving stray headers', () => {
    const bare = args()
    bare.rumors = []
    bare.recordsWatch = []
    bare.upcomingOpponents = []
    const art = renderFallback({
      id: 'pj3',
      kind: 'weekly',
      personaId: 'homer',
      factSheet: buildWeeklyFactSheet(bare),
    })
    expect(art.body).not.toContain('Rumor mill')
    expect(art.body).not.toContain('Records watch')
    expect(art.body).not.toContain('Up next')
  })
})
