import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId, Team } from '@domain'
import { fullSimGame } from '@engine/full/fullSim'
import { buildBoxScore } from '@engine/career/boxScore'
import { EventCursor } from './eventCursor'
import { LiveBoxScoreBuilder } from './liveBoxScore'
import { buildPlayByPlay } from './playByPlay'

function game(seed = 123) {
  const data = generateLeague({ seed: 7 })
  const resolve = (id: PlayerId): Player => {
    const p = data.players.get(id)
    if (!p) throw new Error(`unknown player ${id}`)
    return p
  }
  const [aId, bId] = data.league.teams
  const home = data.teams.get(aId) as Team
  const away = data.teams.get(bId) as Team
  const out = fullSimGame(home, away, resolve, { seed })
  return { out, home, away, resolve }
}

function fold(seed = 123) {
  const { out, home, away, resolve } = game(seed)
  const builder = new LiveBoxScoreBuilder({
    stream: out.stream,
    homePlayerIds: home.roster.map((id) => id as string),
    names: (id) => resolve(id as PlayerId).name,
    abbrs: { home: home.abbreviation, away: away.abbreviation },
  })
  const cursor = new EventCursor(out.stream)
  for (const { ev, absT } of cursor.all) builder.apply(ev, absT)
  return { builder, out, home, away, resolve, cursor }
}

describe('LiveBoxScoreBuilder', () => {
  it('lands on the same final score and shot counts as the postgame box score', () => {
    const { builder, out, home, away, resolve } = fold()
    const official = buildBoxScore(out, home, away, (id) => resolve(id as PlayerId))
    const live = builder.snapshot()

    expect(live.home.goals).toBe(official.homeGoals)
    expect(live.away.goals).toBe(official.awayGoals)
    expect(live.home.shots).toBe(official.homeShots)
    expect(live.away.shots).toBe(official.awayShots)
    expect(live.home.byPeriod.slice(0, 3)).toEqual(official.homeByPeriod.slice(0, 3))
    expect(live.away.byPeriod.slice(0, 3)).toEqual(official.awayByPeriod.slice(0, 3))
  })

  it('agrees with the engine on every skater goal, assist and penalty total', () => {
    const { builder, out } = fold()
    const live = builder.snapshot()
    for (const row of [...live.home.skaters, ...live.away.skaters]) {
      const stat = out.playerStats.get(row.playerId as PlayerId)
      expect(stat, `no engine stat for ${row.name}`).toBeDefined()
      expect(row.goals).toBe(stat!.goals)
      expect(row.assists).toBe(stat!.assists)
      expect(row.penaltyMinutes).toBe(stat!.penaltyMinutes)
      expect(row.plusMinus).toBe(stat!.plusMinus)
    }
  })

  it('agrees with the engine on goalie saves and goals against', () => {
    const { builder, out } = fold()
    const live = builder.snapshot()
    const goalies = [...live.home.goalies, ...live.away.goalies]
    expect(goalies.length).toBeGreaterThan(0)
    for (const g of goalies) {
      const stat = out.playerStats.get(g.playerId as PlayerId)!
      expect(g.saves).toBe(stat.saves)
      expect(g.goalsAgainst).toBe(stat.goalsAgainst)
      expect(g.shotsAgainst).toBe(stat.shotsAgainst)
    }
  })

  it('fills in as the game runs — the table at the first goal is not the final one', () => {
    const { out, home, away, resolve } = game()
    const cursor = new EventCursor(out.stream)
    const builder = new LiveBoxScoreBuilder({
      stream: out.stream,
      homePlayerIds: home.roster.map((id) => id as string),
      names: (id) => resolve(id as PlayerId).name,
      abbrs: { home: home.abbreviation, away: away.abbreviation },
    })
    const firstGoal = cursor.all.find((e) => e.ev.type === 'goal')!
    for (const { ev, absT } of cursor.advance(firstGoal.absT)) builder.apply(ev, absT)
    const atFirstGoal = builder.snapshot()
    expect(atFirstGoal.home.goals + atFirstGoal.away.goals).toBe(1)

    for (const { ev, absT } of cursor.advance(Number.MAX_SAFE_INTEGER)) builder.apply(ev, absT)
    const final = builder.snapshot()
    expect(final.home.goals + final.away.goals).toBe(out.homeGoals + out.awayGoals)
    expect(final.home.shots).toBeGreaterThan(atFirstGoal.home.shots)
  })

  it('credits time on ice from the lineChange spans', () => {
    const { builder } = fold()
    const live = builder.snapshot()
    const skaters = [...live.home.skaters, ...live.away.skaters]
    const withIce = skaters.filter((s) => s.toi > 0)
    expect(withIce.length).toBeGreaterThan(20)
    // Nobody plays the whole game, and the leader plays a top-line workload.
    const top = Math.max(...skaters.map((s) => s.toi))
    expect(top).toBeGreaterThan(600)
    expect(top).toBeLessThan(3600)
  })

  it('reset rewinds it to an empty sheet', () => {
    const { builder } = fold()
    builder.reset()
    const live = builder.snapshot()
    expect(live.home.goals).toBe(0)
    expect(live.home.skaters.length).toBe(0)
  })
})

describe('buildPlayByPlay', () => {
  it('prints one key line per goal, penalty and period marker, in clock order', () => {
    const { out, home, away, resolve } = game()
    const homeIds = new Set<string>(home.roster.map((id) => id as string))
    const feed = buildPlayByPlay(
      out.stream,
      (id) => resolve(id as PlayerId).name,
      (id) => homeIds.has(id as string),
      { home: home.abbreviation, away: away.abbreviation }
    )
    const goalLines = feed.filter((e) => e.kind === 'goal')
    expect(goalLines.length).toBe(out.homeGoals + out.awayGoals)
    for (const l of goalLines) expect(l.weight).toBe('key')

    for (let i = 1; i < feed.length; i++) {
      expect(feed[i].absT).toBeGreaterThanOrEqual(feed[i - 1].absT)
    }

    // The running score on the last line is the final score.
    const last = feed[feed.length - 1]
    expect(last.homeScore).toBe(out.homeGoals)
    expect(last.awayScore).toBe(out.awayGoals)
    expect(last.text).toContain('FINAL')
  })

  it('names the scorer and his helpers on a goal line', () => {
    const { out, home, away, resolve } = game()
    const homeIds = new Set<string>(home.roster.map((id) => id as string))
    const feed = buildPlayByPlay(
      out.stream,
      (id) => resolve(id as PlayerId).name,
      (id) => homeIds.has(id as string),
      { home: home.abbreviation, away: away.abbreviation }
    )
    const goalEv = out.stream.find((e) => e.type === 'goal')
    if (goalEv?.type !== 'goal') throw new Error('no goal in this game')
    const line = feed.find((e) => e.kind === 'goal')!
    expect(line.text).toContain(resolve(goalEv.scorer).name)
    for (const a of goalEv.assists) {
      const surname = resolve(a).name.split(' ').pop()!
      expect(line.text).toContain(surname)
    }
  })
})
