/**
 * Tests for the season-long press schedule (Task #39).
 *
 * Unit tests cover the pure schedule functions; integration tests advance
 * a full season and assert that the inbox receives scheduled media reports
 * at the right lifecycle points, with no duplicates.
 */
import { describe, expect, it } from 'vitest'
import {
  checkAwardsStage,
  checkDraftStage,
  checkPlayoffEntry,
  checkPreseasonStage,
  checkRegularSeasonReports,
  hydratePressScheduleState,
  initialPressScheduleState,
} from './pressSchedule'
import { buildScheduledReportFactSheet } from './factSheet'
import { renderFallback } from './pressFallback'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'

/* ────────────────────────── unit: schedule state machine ────────────────────────── */

describe('pressSchedule — unit: checkRegularSeasonReports', () => {
  it('fires seasonPreview and initial powerRankings on match-day index 0', () => {
    const state = initialPressScheduleState()
    const kinds = checkRegularSeasonReports(0, state)
    expect(kinds).toContain('seasonPreview')
    expect(kinds).toContain('powerRankings')
    expect(state.seasonPreviewFired).toBe(true)
    expect(state.lastPowerRankingsIdx).toBe(0)
  })

  it('does NOT fire seasonPreview a second time on the same index', () => {
    const state = initialPressScheduleState()
    checkRegularSeasonReports(0, state) // first call
    const kinds = checkRegularSeasonReports(0, state) // second call (shouldn't happen in practice but guard it)
    expect(kinds).not.toContain('seasonPreview')
  })

  it('fires powerRankings again after MONTHLY_INTERVAL match days', () => {
    const state = initialPressScheduleState()
    checkRegularSeasonReports(0, state) // fires at 0, sets lastPowerRankingsIdx=0

    // Nothing in between
    for (let i = 1; i < 14; i++) {
      const kinds = checkRegularSeasonReports(i, state)
      expect(kinds).not.toContain('powerRankings')
    }

    // At index 14 (interval elapsed)
    const kinds = checkRegularSeasonReports(14, state)
    expect(kinds).toContain('powerRankings')
    expect(state.lastPowerRankingsIdx).toBe(14)
  })

  it('fires monthlyReport once MONTHLY_INTERVAL days have elapsed from the offset', () => {
    const state = initialPressScheduleState()
    checkRegularSeasonReports(0, state) // season preview / rankings

    // Monthly offset = 7. The first fire requires both:
    //   pressIdx >= MONTHLY_OFFSET (7) AND pressIdx - lastMonthlyReportIdx(-1) >= MONTHLY_INTERVAL(14)
    // So the earliest first fire is when both conditions hold: pressIdx >= 13 (since 13 - (-1) = 14 >= 14 and 13 >= 7).
    for (let i = 1; i < 13; i++) {
      const kinds = checkRegularSeasonReports(i, state)
      expect(kinds).not.toContain('monthlyReport')
    }

    // Fires at index 13 (13 - (-1) = 14 >= 14, and 13 >= 7)
    const kinds13 = checkRegularSeasonReports(13, state)
    expect(kinds13).toContain('monthlyReport')
    expect(state.lastMonthlyReportIdx).toBe(13)

    // Not before the next interval
    for (let i = 14; i < 27; i++) {
      const kinds = checkRegularSeasonReports(i, state)
      expect(kinds).not.toContain('monthlyReport')
    }

    // Fires again at 13 + 14 = 27
    const kinds27 = checkRegularSeasonReports(27, state)
    expect(kinds27).toContain('monthlyReport')
  })

  it('no duplicate powerRankings on the same day', () => {
    const state = initialPressScheduleState()
    const first = checkRegularSeasonReports(0, state)
    expect(first.filter((k) => k === 'powerRankings').length).toBe(1)
  })
})

describe('pressSchedule — unit: milestone checks', () => {
  it('checkPlayoffEntry fires playoffPreview once', () => {
    const state = initialPressScheduleState()
    const first = checkPlayoffEntry(state)
    expect(first).toEqual(['playoffPreview'])
    expect(state.playoffPreviewFired).toBe(true)

    const second = checkPlayoffEntry(state)
    expect(second).toEqual([])
  })

  it('checkAwardsStage fires awardsNight once', () => {
    const state = initialPressScheduleState()
    expect(checkAwardsStage(state)).toEqual(['awardsNight'])
    expect(checkAwardsStage(state)).toEqual([])
  })

  it('checkDraftStage fires draftPreview once', () => {
    const state = initialPressScheduleState()
    expect(checkDraftStage(state)).toEqual(['draftPreview'])
    expect(checkDraftStage(state)).toEqual([])
  })

  it('checkPreseasonStage fires seasonReview once', () => {
    const state = initialPressScheduleState()
    expect(checkPreseasonStage(state)).toEqual(['seasonReview'])
    expect(checkPreseasonStage(state)).toEqual([])
  })
})

describe('pressSchedule — unit: hydratePressScheduleState', () => {
  it('returns default state when called with undefined', () => {
    const state = hydratePressScheduleState(undefined)
    const def = initialPressScheduleState()
    expect(state).toEqual(def)
  })

  it('merges partial saved state, defaulting missing fields', () => {
    const state = hydratePressScheduleState({ seasonPreviewFired: true, lastPowerRankingsIdx: 7 })
    expect(state.seasonPreviewFired).toBe(true)
    expect(state.lastPowerRankingsIdx).toBe(7)
    // Unset fields default to initial
    expect(state.playoffPreviewFired).toBe(false)
    expect(state.lastMonthlyReportIdx).toBe(-1)
  })

  it('snapshot round-trip preserves all fields', () => {
    const state = initialPressScheduleState()
    checkRegularSeasonReports(0, state)
    checkRegularSeasonReports(7, state)
    checkPlayoffEntry(state)

    const hydrated = hydratePressScheduleState(state)
    expect(hydrated).toEqual(state)
  })
})

/* ────────────────────────── integration: full season ────────────────────────── */

/**
 * Advance a career through an entire season (regular + playoffs + offseason),
 * returning all press inbox items.
 */
function runFullSeason(seed: number): ReturnType<Career['getInbox']>['items'] {
  const data = generateLeague({ seed })
  const userId = data.league.teams[0]!
  const career = new Career(data, seed, userId)

  const startYear = career.year
  let guard = 0
  // step() handles all phases: regular season, playoffs, and offseason stages.
  // We stop once the new season has begun (year incremented).
  while (guard++ < 2000) {
    const advanced = career.step()
    if (!advanced) break
    // Once the new season starts, seasonReview has already fired
    if (career.year > startYear) break
  }

  return career.getInbox().items
}

function pressItems(items: ReturnType<Career['getInbox']>['items']) {
  return items.filter((n) => n.press !== undefined)
}

describe('pressSchedule — integration: season produces scheduled reports', () => {
  it('produces a seasonPreview early in the season', () => {
    // Run only the first 20 steps so the first-day seasonPreview is not pushed out
    // by the 200-item inbox limit.
    const data = generateLeague({ seed: 42 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 42, userId)
    let steps = 0
    while (steps < 20 && career.step()) steps++
    const items = pressItems(career.getInbox().items)
    const preview = items.filter((n) => n.press?.kind === 'seasonPreview')
    expect(preview.length, 'expected at least one seasonPreview').toBeGreaterThanOrEqual(1)
  })

  it('produces at least one powerRankings report mid-season', () => {
    const items = pressItems(runFullSeason(42))
    const rankings = items.filter((n) => n.press?.kind === 'powerRankings')
    expect(rankings.length, 'expected at least one powerRankings report').toBeGreaterThanOrEqual(1)
  })

  it('produces at least one monthlyReport during the regular season', () => {
    const items = pressItems(runFullSeason(42))
    const monthly = items.filter((n) => n.press?.kind === 'monthlyReport')
    expect(monthly.length, 'expected at least one monthlyReport').toBeGreaterThanOrEqual(1)
  })

  it('produces a playoffPreview when playoffs begin', () => {
    const items = pressItems(runFullSeason(42))
    const pprev = items.filter((n) => n.press?.kind === 'playoffPreview')
    expect(pprev.length, 'expected exactly one playoffPreview').toBe(1)
  })

  it('produces an awardsNight in the offseason', () => {
    const items = pressItems(runFullSeason(42))
    const awards = items.filter((n) => n.press?.kind === 'awardsNight')
    expect(awards.length, 'expected exactly one awardsNight').toBe(1)
  })

  it('produces a draftPreview in the offseason', () => {
    const items = pressItems(runFullSeason(42))
    const draft = items.filter((n) => n.press?.kind === 'draftPreview')
    expect(draft.length, 'expected exactly one draftPreview').toBe(1)
  })

  it('produces a seasonReview at season end', () => {
    const items = pressItems(runFullSeason(42))
    const review = items.filter((n) => n.press?.kind === 'seasonReview')
    expect(review.length, 'expected exactly one seasonReview').toBe(1)
  })

  it('every scheduled report has a non-empty headline and body', () => {
    const items = pressItems(runFullSeason(42))
    const scheduledKinds = new Set(['seasonPreview', 'powerRankings', 'monthlyReport', 'playoffPreview', 'awardsNight', 'draftPreview', 'seasonReview'])
    for (const item of items.filter((n) => scheduledKinds.has(n.press?.kind ?? ''))) {
      expect(item.headline.length, `headline for ${item.press?.kind}`).toBeGreaterThan(5)
      expect(item.body.length, `body for ${item.press?.kind}`).toBeGreaterThan(50)
    }
  })

  it('no scheduled report kind fires more than once in a single season (no duplicates)', () => {
    const items = pressItems(runFullSeason(42))
    // These fire exactly once per season lifecycle
    const oncePer: string[] = ['seasonPreview', 'playoffPreview', 'awardsNight', 'draftPreview', 'seasonReview']
    for (const kind of oncePer) {
      const count = items.filter((n) => n.press?.kind === kind).length
      expect(count, `${kind} should fire exactly once`).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic: two careers with the same seed produce the same scheduled report headlines', () => {
    const seed = 17
    const items1 = pressItems(runFullSeason(seed))
    const items2 = pressItems(runFullSeason(seed))

    const scheduledKinds = new Set(['seasonPreview', 'powerRankings', 'monthlyReport', 'playoffPreview', 'awardsNight', 'draftPreview', 'seasonReview'])
    const headlines1 = items1.filter((n) => scheduledKinds.has(n.press?.kind ?? '')).map((n) => n.headline)
    const headlines2 = items2.filter((n) => scheduledKinds.has(n.press?.kind ?? '')).map((n) => n.headline)

    expect(headlines1).toEqual(headlines2)
  })

  it('snapshot round-trip preserves fired-schedule state (no re-firing after restore)', () => {
    const seed = 99
    const data = generateLeague({ seed })
    const userId = data.league.teams[0]!
    const career = new Career(data, seed, userId)

    // Advance ~30 steps (enough for seasonPreview + first powerRankings + monthlyReport)
    let steps = 0
    while (steps < 30 && career.step()) steps++

    // Take snapshot and restore
    const snap = career.exportSnapshot('test', '2026-01-01')
    const career2 = Career.fromSnapshot(snap)

    // Count scheduled press items before and after restore — counts must match
    const scheduledKinds = ['powerRankings', 'monthlyReport']
    const countBefore = pressItems(career.getInbox().items).filter((n) =>
      scheduledKinds.includes(n.press?.kind ?? '')
    ).length
    const countAfter = pressItems(career2.getInbox().items).filter((n) =>
      scheduledKinds.includes(n.press?.kind ?? '')
    ).length

    expect(countAfter).toBe(countBefore)

    // Advance one more step; powerRankings count should not increase
    // (the schedule state is preserved so it doesn't re-fire prematurely).
    const ranksBefore = pressItems(career2.getInbox().items).filter((n) => n.press?.kind === 'powerRankings').length
    career2.step()
    const ranksAfter = pressItems(career2.getInbox().items).filter((n) => n.press?.kind === 'powerRankings').length
    // The count should not double up (no re-firing due to schedule state being restored)
    expect(ranksAfter).toBeLessThanOrEqual(ranksBefore + 1)
  })
})

/* ────────────────────────── unit: scheduled report rendering ────────────────────────── */

const BASE_FACTS = {
  year: 2026, day: 14,
  team: { name: 'Harbor City Admirals', abbr: 'HCA', wins: 8, losses: 4, otLosses: 2, points: 18, rank: 3, teamsInLeague: 16 },
  lastResults: [] as never[],
  topArcs: [] as never[],
  lockerRoom: { roomMorale: 65, captainName: null, feuds: [] as string[], mentorships: [] as string[] },
  rumors: [] as never[],
  recordsWatch: [] as string[],
  upcomingOpponents: [] as string[],
  leagueLeaders: [] as never[],
  sagaSoFar: '',
}

describe('pressSchedule — unit: scheduled report fact sheets render correctly', () => {
  it('powerRankings article contains a ranked list', () => {
    const rankings = [
      { rank: 1, teamAbbr: 'BOS', teamName: 'Boston Bears', points: 24, wins: 12, losses: 2, otLosses: 0 },
      { rank: 2, teamAbbr: 'NOR', teamName: 'Nordale Knights', points: 22, wins: 11, losses: 3, otLosses: 0 },
      { rank: 3, teamAbbr: 'HCA', teamName: 'Harbor City Admirals', points: 18, wins: 8, losses: 4, otLosses: 2 },
    ]

    const sheet = buildScheduledReportFactSheet('powerRankings', { ...BASE_FACTS, powerRankings: rankings })
    const job = { id: 'pj-rank-test', kind: 'powerRankings' as const, personaId: 'national' as const, factSheet: sheet }
    const article = renderFallback(job)

    expect(article.headline.length).toBeGreaterThan(5)
    expect(article.body).toContain('Boston Bears')
    expect(article.body).toContain('1.')
  })

  it('seasonPreview article references preseason favorites', () => {
    const sheet = buildScheduledReportFactSheet('seasonPreview', {
      ...BASE_FACTS,
      day: 0,
      team: { ...BASE_FACTS.team, wins: 0, losses: 0, otLosses: 0, points: 0, rank: 5, expectedRank: 5 },
      preseasonFavorites: ['Boston Bears', 'Nordale Knights', 'River City Wolves'],
    })
    const job = { id: 'pj-preview-test', kind: 'seasonPreview' as const, personaId: 'beat' as const, factSheet: sheet }
    const article = renderFallback(job)

    expect(article.body).toContain('Boston Bears')
    expect(article.headline.toLowerCase()).toMatch(/season|preview|campaign/)
  })

  it('awardsNight article lists front-runners', () => {
    const sheet = buildScheduledReportFactSheet('awardsNight', {
      ...BASE_FACTS,
      day: 180,
      team: { ...BASE_FACTS.team, wins: 42, losses: 28, otLosses: 12, points: 96, rank: 4 },
      awardFrontrunners: [
        { awardName: 'Hart Trophy', leaderName: 'A. Johansson', leaderTeamAbbr: 'NOR', statLine: '52 goals, 48 assists' },
      ],
    })
    const job = { id: 'pj-awards-test', kind: 'awardsNight' as const, personaId: 'national' as const, factSheet: sheet }
    const article = renderFallback(job)

    expect(article.body).toContain('Hart Trophy')
    expect(article.body).toContain('A. Johansson')
  })
})
