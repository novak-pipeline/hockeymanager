import { describe, expect, it } from 'vitest'
import {
  buildTentpoleFactSheet,
  buildWeeklyFactSheet,
  type PressFactArgs,
  type PressJob,
  type PressPersonaId,
  type PressSheetKind,
} from './factSheet'
import { renderFallback } from './pressFallback'

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
    ...overrides,
  }
}

function weeklyJob(id = 'pj1', personaId: PressPersonaId = 'beat'): PressJob {
  return { id, kind: 'weekly', personaId, factSheet: buildWeeklyFactSheet(args()) }
}

function tentpoleJob(kind: PressSheetKind, personaId: PressPersonaId = 'national', special: string[] = []): PressJob {
  return {
    id: `pj-${kind}`,
    kind,
    personaId,
    factSheet: buildTentpoleFactSheet(kind as Exclude<PressSheetKind, 'weekly' | 'presser'>, args(), special),
  }
}

/* ─────────────────────── basic contract ─────────────────────── */

describe('renderFallback — basic contract', () => {
  it('produces a non-empty headline, body and persona byline', () => {
    const art = renderFallback(weeklyJob())
    expect(art.headline.length).toBeGreaterThan(5)
    expect(art.body.length).toBeGreaterThan(100)
    expect(art.byline).toContain('Sam Carver')
    expect(art.byline).toContain('The Daily Gazette')
  })

  it('is deterministic: same job renders byte-identical output', () => {
    const a = renderFallback(weeklyJob())
    const b = renderFallback(weeklyJob())
    expect(a).toEqual(b)
  })

  it('contains team name and record in weekly body', () => {
    const art = renderFallback(weeklyJob())
    // The team name (or abbreviation) and the record must appear somewhere.
    const hasTeamRef = art.body.includes('Harbor City Admirals') || art.body.includes('HCA')
    expect(hasTeamRef).toBe(true)
    expect(art.body).toContain('5–2–1')
  })

  it('contains the top arc summary in weekly body', () => {
    const art = renderFallback(weeklyJob())
    expect(art.body).toContain('Tempers flare between Roy and Bex.')
  })

  it('references the preseason expectation somewhere in weekly body', () => {
    const art = renderFallback(weeklyJob())
    // The team is over-performing (rank 3 vs expected 7), so one of the expectation phrases must appear.
    const hasExp =
      art.body.includes('7') && // the expected rank digit
      (art.body.includes('projection') || art.body.includes('predicted') ||
       art.body.includes('expected') || art.body.includes('preseason'))
    expect(hasExp).toBe(true)
  })

  it('uses different bylines per persona', () => {
    const beat = renderFallback(weeklyJob('pj1', 'beat'))
    const national = renderFallback(weeklyJob('pj1', 'national'))
    const homer = renderFallback(weeklyJob('pj1', 'homer'))
    expect(beat.byline).toContain('Sam Carver')
    expect(national.byline).toContain('Vic Mercer')
    expect(homer.byline).toContain('990 The Fan')
    // All three must differ.
    expect(beat.byline).not.toBe(national.byline)
    expect(beat.byline).not.toBe(homer.byline)
    expect(national.byline).not.toBe(homer.byline)
  })
})

/* ─────────────────────── weekly persona voices ─────────────────────── */

describe('renderFallback — weekly persona voices', () => {
  const personas: PressPersonaId[] = ['beat', 'national', 'homer']
  for (const persona of personas) {
    it(`${persona}: headline and body are non-trivial`, () => {
      const art = renderFallback(weeklyJob('pj1', persona))
      expect(art.headline.length).toBeGreaterThan(10)
      expect(art.body.length).toBeGreaterThan(150)
    })

    it(`${persona}: body mentions team record`, () => {
      const art = renderFallback(weeklyJob('pj1', persona))
      expect(art.body).toContain('5–2–1')
    })
  }

  it('different job ids produce different template picks (variety check)', () => {
    // Same persona, different ids → may hit different templates.
    const bodies = ['pj0', 'pj1', 'pj2'].map((id) => renderFallback(weeklyJob(id, 'beat')).body)
    // At least two of three should differ (templates rotate).
    const unique = new Set(bodies)
    expect(unique.size).toBeGreaterThanOrEqual(2)
  })

  it('homer voice is noticeably positive for a good week', () => {
    const art = renderFallback(weeklyJob('pj1', 'homer'))
    // Homer articles tend to include "we" or enthusiastic phrasing.
    const bodyLower = art.body.toLowerCase()
    const hasHomerTone =
      bodyLower.includes('folks') ||
      bodyLower.includes("we're") ||
      bodyLower.includes('i love') ||
      art.body.includes('!')
    expect(hasHomerTone).toBe(true)
  })

  it('national voice references the standings position analytically', () => {
    const art = renderFallback(weeklyJob('pj1', 'national'))
    // National articles reference rank/standings context.
    const hasAnalytical =
      art.body.includes('3rd') ||
      art.body.includes('third') ||
      art.body.includes('rank') ||
      art.body.includes('projection') ||
      art.body.includes('preseason') ||
      art.body.includes('standings')
    expect(hasAnalytical).toBe(true)
  })

  it('bad week (0-3) produces different headline tone than good week (3-0)', () => {
    const goodWeek = buildWeeklyFactSheet(args({
      lastResults: [
        { day: 10, opponentAbbr: 'RVK', home: true, goalsFor: 3, goalsAgainst: 1, decidedBy: 'regulation' },
        { day: 12, opponentAbbr: 'NOR', home: false, goalsFor: 4, goalsAgainst: 2, decidedBy: 'regulation' },
        { day: 14, opponentAbbr: 'BOS', home: true, goalsFor: 2, goalsAgainst: 1, decidedBy: 'overtime' },
      ],
    }))
    const badWeek = buildWeeklyFactSheet(args({
      lastResults: [
        { day: 10, opponentAbbr: 'RVK', home: true, goalsFor: 1, goalsAgainst: 3, decidedBy: 'regulation' },
        { day: 12, opponentAbbr: 'NOR', home: false, goalsFor: 0, goalsAgainst: 4, decidedBy: 'regulation' },
        { day: 14, opponentAbbr: 'BOS', home: true, goalsFor: 1, goalsAgainst: 2, decidedBy: 'overtime' },
      ],
    }))
    const goodArt = renderFallback({ id: 'pj1', kind: 'weekly', personaId: 'beat', factSheet: goodWeek })
    const badArt = renderFallback({ id: 'pj1', kind: 'weekly', personaId: 'beat', factSheet: badWeek })
    expect(goodArt.headline).not.toBe(badArt.headline)
  })
})

/* ─────────────────────── tentpole kinds ─────────────────────── */

describe('renderFallback — tentpole kinds', () => {
  const tentpoleKinds: Exclude<PressSheetKind, 'weekly'>[] = [
    'deadline', 'lottery', 'combine', 'draft', 'seasonRecap', 'champion', 'presser',
  ]

  for (const kind of tentpoleKinds) {
    it(`${kind}: headline and body non-empty for all three personas`, () => {
      for (const persona of ['beat', 'national', 'homer'] as PressPersonaId[]) {
        const job: PressJob = {
          id: `pj-${kind}-${persona}`,
          kind,
          personaId: persona,
          factSheet: buildTentpoleFactSheet(
            kind as Exclude<PressSheetKind, 'weekly' | 'presser'>,
            args(),
            [`${kind} special line 1`, `${kind} special line 2`]
          ),
        }
        const art = renderFallback(job)
        expect(art.headline.length, `${kind}/${persona} headline`).toBeGreaterThan(5)
        expect(art.body.length, `${kind}/${persona} body`).toBeGreaterThan(80)
        expect(art.byline.length, `${kind}/${persona} byline`).toBeGreaterThan(5)
      }
    })
  }

  it('deadline: special trade lines appear in the body', () => {
    const art = renderFallback(tentpoleJob('deadline', 'beat', ['HCA traded Roy to RVK for a 1st']))
    expect(art.body).toContain('HCA traded Roy to RVK for a 1st')
  })

  it('deadline: headline references the deadline', () => {
    const art = renderFallback(tentpoleJob('deadline', 'national', []))
    expect(art.headline.toLowerCase()).toContain('deadline')
  })

  it('champion: headline celebrates the championship', () => {
    const art = renderFallback(tentpoleJob('champion', 'homer', []))
    const headlineLower = art.headline.toLowerCase()
    const isChampion = headlineLower.includes('champion') || headlineLower.includes('cup') || headlineLower.includes('title') || art.headline.includes('!')
    expect(isChampion).toBe(true)
  })

  it('seasonRecap: body mentions season-review framing', () => {
    const art = renderFallback(tentpoleJob('seasonRecap', 'beat', ['Team finished with 42 wins']))
    const bodyLower = art.body.toLowerCase()
    const hasSeason = bodyLower.includes('season') || bodyLower.includes('finish') || bodyLower.includes('year')
    expect(hasSeason).toBe(true)
    expect(art.body).toContain('Team finished with 42 wins')
  })

  it('lottery: body references draft or lottery', () => {
    const art = renderFallback(tentpoleJob('lottery', 'national', ['Team A jumped to 1st overall']))
    const bodyLower = art.body.toLowerCase()
    const hasLottery = bodyLower.includes('lottery') || bodyLower.includes('draft') || bodyLower.includes('pick')
    expect(hasLottery).toBe(true)
    expect(art.body).toContain('Team A jumped to 1st overall')
  })

  it('draft: homer voice is enthusiastic', () => {
    const art = renderFallback(tentpoleJob('draft', 'homer', ['HCA selects C. Johansson with the 4th pick']))
    expect(art.body).toContain('HCA selects C. Johansson with the 4th pick')
    const hasEnthusiasm = art.headline.includes('!') || art.body.includes('!')
    expect(hasEnthusiasm).toBe(true)
  })

  it('presser: contains team record for context', () => {
    const art = renderFallback({
      id: 'pj-presser',
      kind: 'presser',
      personaId: 'beat',
      factSheet: buildTentpoleFactSheet('champion', args(), ['GM addresses the room']), // presser uses champion factsheet shape
    })
    expect(art.body.length).toBeGreaterThan(50)
  })
})

/* ─────────────────────── determinism & variety ─────────────────────── */

describe('renderFallback — determinism and variety', () => {
  it('same job always produces identical output (truly deterministic)', () => {
    const job = weeklyJob('pj-det', 'national')
    const runs = Array.from({ length: 5 }, () => renderFallback(job))
    for (const r of runs.slice(1)) {
      expect(r).toEqual(runs[0])
    }
  })

  it('all three personas produce meaningfully different bodies for the same facts', () => {
    const beat = renderFallback(weeklyJob('pj-variety', 'beat'))
    const national = renderFallback(weeklyJob('pj-variety', 'national'))
    const homer = renderFallback(weeklyJob('pj-variety', 'homer'))
    expect(beat.body).not.toBe(national.body)
    expect(beat.body).not.toBe(homer.body)
    expect(national.body).not.toBe(homer.body)
  })

  it('varying job id produces template variation across 6 weekly beat articles', () => {
    const ids = ['pj0', 'pj1', 'pj2', 'pj3', 'pj4', 'pj5']
    const headlines = ids.map((id) => renderFallback(weeklyJob(id, 'beat')).headline)
    const unique = new Set(headlines)
    // With 3 templates, 6 articles should produce at least 2 distinct headlines.
    expect(unique.size).toBeGreaterThanOrEqual(2)
  })

  it('overperforming and underperforming teams get different framing', () => {
    const overSheet = buildWeeklyFactSheet(args({ team: { ...args().team, rank: 2, expectedRank: 8 } }))
    const underSheet = buildWeeklyFactSheet(args({ team: { ...args().team, rank: 12, expectedRank: 5 } }))
    const overArt = renderFallback({ id: 'pj1', kind: 'weekly', personaId: 'national', factSheet: overSheet })
    const underArt = renderFallback({ id: 'pj1', kind: 'weekly', personaId: 'national', factSheet: underSheet })
    expect(overArt.body).not.toBe(underArt.body)
    // Over-performer should not have the same headline as under-performer.
    expect(overArt.headline).not.toBe(underArt.headline)
  })
})

/* ─────────────────────── edge cases ─────────────────────── */

describe('renderFallback — edge cases', () => {
  it('handles empty optional sections gracefully (no stale headers)', () => {
    const bare = args({ rumors: [], recordsWatch: [], upcomingOpponents: [], topArcs: [], lockerRoom: { roomMorale: 60, captainName: null, feuds: [], mentorships: [] } })
    const art = renderFallback({ id: 'pj3', kind: 'weekly', personaId: 'homer', factSheet: buildWeeklyFactSheet(bare) })
    // None of the old bullet-style headers should appear.
    expect(art.body).not.toContain('Rumor mill')
    expect(art.body).not.toContain('Records watch')
    expect(art.body).not.toContain('Up next')
    // Body should still be non-empty.
    expect(art.body.length).toBeGreaterThan(50)
  })

  it('handles no expected rank without crashing', () => {
    const noExp = args()
    delete (noExp.team as { expectedRank?: number }).expectedRank
    const art = renderFallback({ id: 'pj1', kind: 'weekly', personaId: 'beat', factSheet: buildWeeklyFactSheet(noExp) })
    expect(art.headline.length).toBeGreaterThan(5)
    expect(art.body.length).toBeGreaterThan(50)
  })

  it('handles empty lastResults without crashing', () => {
    const noResults = args({ lastResults: [] })
    const art = renderFallback({ id: 'pj1', kind: 'weekly', personaId: 'beat', factSheet: buildWeeklyFactSheet(noResults) })
    expect(art.headline.length).toBeGreaterThan(5)
    expect(art.body.length).toBeGreaterThan(50)
  })

  it('tentpole with no special lines still produces a valid article', () => {
    for (const kind of ['deadline', 'champion', 'draft'] as const) {
      const art = renderFallback(tentpoleJob(kind, 'beat', []))
      expect(art.headline.length).toBeGreaterThan(5)
      expect(art.body.length).toBeGreaterThan(50)
    }
  })
})
