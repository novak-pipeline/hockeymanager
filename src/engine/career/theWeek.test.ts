/**
 * THE WEEK — the week-to-week rhythm. Pins the pure pieces (the staff's load
 * call, the race arithmetic, the coach's read) and the career wiring: the plan
 * reaches the dashboard, the load is a real lever (fatigue and development),
 * the holiday freeze actually stops trades, and the race scenes are raised.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { TeamId } from '@domain'
import { Career } from './career'
import { dayToDateISO } from './views'
import {
  WEEK_LOADS,
  buildStaffRead,
  countBackToBacks,
  pickStoryline,
  raceNumbers,
  staffWeekLoad,
} from './theWeek'

describe('the staff load call', () => {
  it('rests a crowded or tired week and works a quiet, fresh one', () => {
    expect(staffWeekLoad({ games: 4, backToBacks: 0, avgFatigue: 5 }).load).toBe('light')
    expect(staffWeekLoad({ games: 3, backToBacks: 1, avgFatigue: 30 }).load).toBe('light')
    expect(staffWeekLoad({ games: 2, backToBacks: 0, avgFatigue: 45 }).load).toBe('light')
    expect(staffWeekLoad({ games: 2, backToBacks: 0, avgFatigue: 10 }).load).toBe('push')
    expect(staffWeekLoad({ games: 3, backToBacks: 0, avgFatigue: 15 }).load).toBe('standard')
  })

  it('never pushes a tired room', () => {
    for (let games = 0; games <= 5; games++) {
      for (const f of [25, 40, 60]) {
        expect(staffWeekLoad({ games, backToBacks: 0, avgFatigue: f }).load).not.toBe('push')
      }
    }
  })

  it('every load is a trade-off: push costs legs, light costs growth', () => {
    expect(WEEK_LOADS.push.fatiguePerDay).toBeGreaterThan(0)
    expect(WEEK_LOADS.push.devMult).toBeGreaterThan(1)
    expect(WEEK_LOADS.light.fatiguePerDay).toBeLessThan(0)
    expect(WEEK_LOADS.light.devMult).toBeLessThan(1)
    expect(WEEK_LOADS.standard).toMatchObject({ fatiguePerDay: 0, devMult: 1 })
  })

  it('counts back-to-backs', () => {
    expect(countBackToBacks([1, 2, 4, 5, 6])).toBe(3)
    expect(countBackToBacks([1, 3, 5])).toBe(0)
  })
})

describe('the race numbers', () => {
  it('magic number: points to put the first team out out of reach', () => {
    // 90 pts, rival 84 with 4 left (max 92): need 3 more of our points/their drops.
    expect(raceNumbers({ inSpot: true, userPts: 90, userGamesLeft: 5, rivalPts: 84, rivalGamesLeft: 4 })).toEqual({ magic: 3 })
    expect(raceNumbers({ inSpot: true, userPts: 100, userGamesLeft: 2, rivalPts: 80, rivalGamesLeft: 3 }).magic).toBe(0)
  })

  it('tragic number: points until we cannot catch the last team in', () => {
    // 80 pts with 5 left (max 90) vs 86: 5 of our drops / their gains ends it.
    expect(raceNumbers({ inSpot: false, userPts: 80, userGamesLeft: 5, rivalPts: 86, rivalGamesLeft: 5 })).toEqual({ tragic: 5 })
  })
})

describe('the coach read and the storyline', () => {
  it('reads the week plainly, grounded in the facts', () => {
    const r = buildStaffRead({
      coachName: 'Coach', lastWeek: ['W', 'W', 'L'], standout: { name: 'Ace', pts: 5, gp: 3 },
      tiredest: { name: 'Tired', fatigue: 55 }, injuredCount: 1, load: 'light', gamesAhead: 4,
      race: { inSpot: true, gap: 2 },
    })
    expect(r.lines.length).toBeGreaterThanOrEqual(2)
    expect(r.lines.length).toBeLessThanOrEqual(4)
    expect(r.lines.join(' ')).toContain('2-1-0')
    expect(r.lines.join(' ')).toContain('Ace')
  })

  it('the storyline is the highest-priority candidate', () => {
    expect(pickStoryline([
      { priority: 10, title: 'a', text: '' },
      { priority: 80, title: 'b', text: '' },
      { priority: 30, title: 'c', text: '' },
    ])?.title).toBe('b')
    expect(pickStoryline([])).toBeNull()
  })
})

/* ───────────────────────── career wiring ───────────────────────── */

type Inner = {
  currentDay: number
  year: number
  userTeamId: TeamId
  phase: string
  deadlineDay: number
  weekDevLog: number[]
  inTradeFreeze(day: number): boolean
  tradingOpen(): boolean
  applyWeekLoad(day: number): void
  userGameDays(): Set<number>
  data: { teams: Map<TeamId, { roster: string[]; captainId?: string }>; players: Map<string, { fatigue: number; injuryStatus: unknown }> }
  checkPlayoffBerth(): void
  standings: Map<TeamId, { points: number }>
}

function toOpeningDay(): Career {
  const data = generateLeague({ seed: 5 })
  const c = new Career(data, 5, data.league.teams[0]!)
  for (let i = 0; i < 200 && c.getDashboard().phase === 'regularSeason' && c.getDashboard().day === 0; i++) {
    if (c.getDashboard().captainsPending) c.nameCaptainByCoach()
    c.step()
  }
  return c
}

describe('The Week in the career', () => {
  it('the dashboard carries the week plan through the season', () => {
    const c = toOpeningDay()
    for (let i = 0; i < 20; i++) c.step()
    const w = c.getDashboard().week
    expect(w).toBeDefined()
    expect(w!.loadOptions.map((o) => o.load)).toEqual(['push', 'standard', 'light'])
    expect(w!.games.length + w!.trainingDays).toBe(7)
    expect(w!.loadSource).toBe('staff')
    expect(w!.staffRead?.lines.length ?? 0).toBeGreaterThan(0)
  })

  it('the GM can override one week, and hand it back', () => {
    const c = toOpeningDay()
    c.step()
    const staff = c.getDashboard().week!.staffLoad
    const other = staff === 'push' ? 'light' : 'push'
    expect(c.setWeekLoad(other).ok).toBe(true)
    expect(c.getDashboard().week!).toMatchObject({ load: other, loadSource: 'gm' })
    expect(c.setWeekLoad(null).ok).toBe(true)
    expect(c.getDashboard().week!).toMatchObject({ load: staff, loadSource: 'staff' })
  })

  it('the load is real: push tires the room and speeds development, light does the opposite', () => {
    const run = (load: 'push' | 'light'): { fatigue: number; dev: number } => {
      const c = toOpeningDay()
      const inner = c as unknown as Inner
      const off = [...Array(60).keys()].map((d) => d + 1).find((d) => d > inner.currentDay && !inner.userGameDays().has(d))!
      inner.currentDay = off - 1
      c.setWeekLoad(load)
      const roster = inner.data.teams.get(inner.userTeamId)!.roster
      for (const id of roster) inner.data.players.get(id)!.fatigue = 20
      inner.weekDevLog = []
      inner.applyWeekLoad(off)
      const fit = roster.map((id) => inner.data.players.get(id)!).filter((p) => p.injuryStatus === null)
      return { fatigue: fit.reduce((n, p) => n + p.fatigue, 0) / fit.length, dev: inner.weekDevLog[0]! }
    }
    const push = run('push')
    const light = run('light')
    expect(push.fatigue).toBeGreaterThan(20)
    expect(light.fatigue).toBeLessThan(20)
    expect(push.dev).toBeGreaterThan(1)
    expect(light.dev).toBeLessThan(1)
  })

  it('the holiday freeze is real: no trades Dec 19-27', () => {
    const c = toOpeningDay()
    const inner = c as unknown as Inner
    const dec20 = [...Array(200).keys()].find((d) => d > 0 && dayToDateISO(inner.year, d) === `${inner.year}-12-20`)
    expect(dec20).toBeDefined()
    expect(inner.inTradeFreeze(dec20!)).toBe(true)
    inner.currentDay = dec20! - 1
    expect(inner.tradingOpen()).toBe(false)
    inner.currentDay = dec20! + 10
    expect(inner.inTradeFreeze(dec20! + 11)).toBe(false)
  })

  it('the clinch raises the captain scene once', () => {
    const c = toOpeningDay()
    const inner = c as unknown as Inner
    inner.currentDay = 100000
    for (const t of [...inner.standings.keys()]) inner.standings.get(t)!.points = 40
    inner.standings.get(inner.userTeamId)!.points = 200
    inner.checkPlayoffBerth()
    inner.checkPlayoffBerth()
    const scenes = c.getInbox().interactions?.filter((i) => i.scene && /dressing room is loud/.test(i.message)) ?? []
    expect(scenes).toHaveLength(1)
  })
})
