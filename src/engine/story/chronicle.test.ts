import { describe, expect, it } from 'vitest'
import {
  anniversaries,
  emptyChronicle,
  eventsForPlayer,
  eventsForTeam,
  formerTeams,
  headToHead,
  pickBecame,
  provenanceOf,
  pruneChronicle,
  recordAcquisition,
  recordDraftProvenance,
  recordEvent,
  recordMeeting,
  recordSeries,
  tradesBetween,
  userHistory,
  type ChronicleState,
} from './chronicle'

describe('chronicle events', () => {
  it('appends events with stable ids and preserves order', () => {
    const c = emptyChronicle()
    const e1 = recordEvent(c, {
      year: 2026, day: 10, kind: 'trade', teamIds: ['pit', 'nyr'],
      playerIds: ['p1'], headline: 'PIT trade F Smith to NYR', userInvolved: true,
    })
    const e2 = recordEvent(c, {
      year: 2026, day: 12, kind: 'signing', teamIds: ['bos'],
      playerIds: ['p2'], headline: 'BOS sign D Jones', userInvolved: false,
    })
    expect(e1.id).toBe('ch-2026-000001')
    expect(e2.id).toBe('ch-2026-000002')
    expect(c.events).toHaveLength(2)
    expect(c.events[0]!.headline).toContain('Smith')
  })

  it('round-trips through JSON', () => {
    const c = emptyChronicle()
    recordEvent(c, {
      year: 2026, day: 1, kind: 'trade', teamIds: ['a', 'b'], playerIds: ['p'],
      headline: 'x', userInvolved: true,
      details: { assetsOut: [{ kind: 'player', playerId: 'p', label: 'F P' }] },
    })
    recordMeeting(c, { homeTeamId: 'a', awayTeamId: 'b', homeGoals: 3, awayGoals: 2, overtime: false, year: 2026 })
    recordDraftProvenance(c, { playerId: 'p', teamId: 'a', year: 2024, round: 1, overallPick: 5 })
    const back = JSON.parse(JSON.stringify(c)) as ChronicleState
    expect(back).toEqual(c)
    // Queries still work on the revived state.
    expect(headToHead(back, 'a', 'b')?.wins).toBe(1)
    expect(provenanceOf(back, 'p')?.round).toBe(1)
  })

  it('queries by player, team and user', () => {
    const c = emptyChronicle()
    recordEvent(c, { year: 2026, day: 1, kind: 'trade', teamIds: ['a', 'b'], playerIds: ['p1'], headline: '1', userInvolved: true })
    recordEvent(c, { year: 2026, day: 2, kind: 'signing', teamIds: ['b'], playerIds: ['p2'], headline: '2', userInvolved: false })
    recordEvent(c, { year: 2026, day: 3, kind: 'award', teamIds: ['a'], playerIds: ['p1'], headline: '3', userInvolved: true })
    expect(eventsForPlayer(c, 'p1').map((e) => e.headline)).toEqual(['3', '1']) // recent first
    expect(eventsForTeam(c, 'b').map((e) => e.headline)).toEqual(['2', '1'])
    expect(userHistory(c).map((e) => e.headline)).toEqual(['3', '1'])
  })

  it('pruning drops old ephemeral events, keeps durable + user history forever', () => {
    const c = emptyChronicle()
    recordEvent(c, { year: 2020, day: 1, kind: 'callup', teamIds: ['a'], headline: 'old callup', userInvolved: false })
    recordEvent(c, { year: 2020, day: 1, kind: 'callup', teamIds: ['a'], headline: 'user callup', userInvolved: true })
    recordEvent(c, { year: 2020, day: 1, kind: 'trade', teamIds: ['a', 'b'], headline: 'old trade', userInvolved: false })
    recordEvent(c, { year: 2029, day: 1, kind: 'callup', teamIds: ['a'], headline: 'fresh callup', userInvolved: false })
    pruneChronicle(c, 2030)
    const heads = c.events.map((e) => e.headline)
    expect(heads).not.toContain('old callup')      // ephemeral + old + not user
    expect(heads).toContain('user callup')          // user history kept
    expect(heads).toContain('old trade')            // durable kind kept
    expect(heads).toContain('fresh callup')         // recent ephemeral kept
  })
})

describe('head-to-head', () => {
  it('accumulates wins/goals symmetrically regardless of home/away', () => {
    const c = emptyChronicle()
    // a beats b at home 4-1; b beats a at b's rink 3-2 in OT; a beats b again 2-0.
    recordMeeting(c, { homeTeamId: 'a', awayTeamId: 'b', homeGoals: 4, awayGoals: 1, overtime: false, year: 2026 })
    recordMeeting(c, { homeTeamId: 'b', awayTeamId: 'a', homeGoals: 3, awayGoals: 2, overtime: true, year: 2026 })
    recordMeeting(c, { homeTeamId: 'b', awayTeamId: 'a', homeGoals: 0, awayGoals: 2, overtime: false, year: 2027 })
    const fromA = headToHead(c, 'a', 'b')!
    expect(fromA.wins).toBe(2)
    expect(fromA.losses).toBe(1)
    expect(fromA.goalsFor).toBe(8)
    expect(fromA.goalsAgainst).toBe(4)
    expect(fromA.lastMeetingYear).toBe(2027)
    const fromB = headToHead(c, 'b', 'a')!
    expect(fromB.wins).toBe(1)
    expect(fromB.otWins).toBe(1)
    expect(fromB.goalsFor).toBe(4)
    expect(fromB.goalsAgainst).toBe(8)
  })

  it('returns null for teams that never met', () => {
    expect(headToHead(emptyChronicle(), 'a', 'b')).toBeNull()
  })

  it('tracks playoff series per side', () => {
    const c = emptyChronicle()
    recordSeries(c, { winnerTeamId: 'b', loserTeamId: 'a', year: 2026 })
    recordSeries(c, { winnerTeamId: 'a', loserTeamId: 'b', year: 2027 })
    recordSeries(c, { winnerTeamId: 'b', loserTeamId: 'a', year: 2028 })
    const fromA = headToHead(c, 'a', 'b')!
    expect(fromA.seriesWins).toBe(1)
    expect(fromA.seriesLosses).toBe(2)
  })
})

describe('provenance', () => {
  it('records draft origin + acquisitions and answers formerTeams', () => {
    const c = emptyChronicle()
    recordDraftProvenance(c, { playerId: 'p', teamId: 'pit', year: 2024, round: 2, overallPick: 40 })
    recordAcquisition(c, { playerId: 'p', teamId: 'nyr', year: 2026, via: 'trade', fromTeamId: 'pit' })
    recordAcquisition(c, { playerId: 'p', teamId: 'bos', year: 2028, via: 'signing' })
    const prov = provenanceOf(c, 'p')!
    expect(prov.draftedBy).toBe('pit')
    expect(prov.overallPick).toBe(40)
    expect(prov.acquisitions.map((a) => a.via)).toEqual(['draft', 'trade', 'signing'])
    expect(formerTeams(c, 'p', 'bos').sort()).toEqual(['nyr', 'pit'])
  })
})

describe('causal chains + callbacks', () => {
  it('links a traded pick to what it became', () => {
    const c = emptyChronicle()
    const trade = recordEvent(c, {
      year: 2026, day: 60, kind: 'trade', teamIds: ['pit', 'nyr'],
      playerIds: ['vet'], headline: 'NYR acquire vet for a 2027 2nd',
      details: { assetsOut: [{ kind: 'pick', pickRef: '2027-R2-NYR', label: '2027 2nd (NYR)' }] },
      userInvolved: true,
    })
    recordEvent(c, {
      year: 2027, day: 0, kind: 'draftPick', teamIds: ['pit'], playerIds: ['prospect'],
      headline: 'PIT select D Prospect (R2, #38)',
      details: { round: 2, overallPick: 38, viaTradeEventId: trade.id },
      userInvolved: true,
    })
    const became = pickBecame(c, trade.id)
    expect(became).toHaveLength(1)
    expect(became[0]!.playerIds).toContain('prospect')
    expect(tradesBetween(c, 'nyr', 'pit')[0]!.id).toBe(trade.id)
  })

  it('surfaces anniversaries of durable events near the same calendar day', () => {
    const c = emptyChronicle()
    recordEvent(c, { year: 2023, day: 41, kind: 'championship', teamIds: ['pit'], headline: 'PIT win the Cup', userInvolved: true })
    recordEvent(c, { year: 2023, day: 41, kind: 'callup', teamIds: ['pit'], headline: 'minor move', userInvolved: false })
    const hits = anniversaries(c, 2026, 40)
    expect(hits.map((e) => e.headline)).toEqual(['PIT win the Cup']) // 3 years ago, durable only
    expect(anniversaries(c, 2026, 70)).toHaveLength(0) // wrong day
  })
})
