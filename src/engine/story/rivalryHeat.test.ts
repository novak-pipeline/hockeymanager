import { describe, expect, it } from 'vitest'
import type { GameEvent, GameStream } from '@domain'
import { HeatTracker, PAIR_HOT, fightHeatInput, pairKey } from '@engine/shared/heat'
import { rollFightPlan } from '@engine/shared/fights'
import { computeGameHeat, gameHeatAt, topScorers } from './rivalryHeat'
import { createHeatLedger, ingestGameHeat, pairsAcross, teamHeatBetween } from '@engine/league/heatLedger'
import { planLiveStory, type LivePlayerFacts, type LiveStoryFacts } from './liveStory'
import { LT_BAD_BLOOD, LT_HEAT_ANSWER, LT_HEAT_FACE, LT_HEAT_REPEAT, LT_HEAT_STAR, LT_HEAT_TEAM } from './liveStoryPools'

const P = { x: 0, y: 0 }
const ev = (e: Record<string, unknown>): GameEvent => e as unknown as GameEvent
const HOME = ['h1', 'h2', 'h3', 'h4', 'h5']
const AWAY = ['a1', 'a2', 'a3', 'a4', 'a5']
const sideOf = (id: string): 'home' | 'away' | null => (id.startsWith('h') ? 'home' : id.startsWith('a') ? 'away' : null)
const frame = (period: number, t: number): GameEvent => ev({
  type: 'frame', period, t, puck: P, puckCarrier: null,
  home: HOME.map((p) => ({ player: p, pos: P })), away: AWAY.map((p) => ({ player: p, pos: P })),
  homeGoalie: { player: 'hg', pos: P }, awayGoalie: { player: 'ag', pos: P },
})
const whistle = (period: number, t: number): GameEvent => ev({ type: 'whistle', period, t, reason: 'icing' })
const faceoff = (period: number, t: number): GameEvent => ev({ type: 'faceoff', period, t, pos: P, winner: 'h1', loser: 'a1', zone: 'neutral' })
const hit = (period: number, t: number, by: string, on: string, force = 0.4, knockdown = false): GameEvent =>
  ev({ type: 'hit', period, t, by, on, pos: P, force, ...(knockdown ? { knockdown } : {}) })
const pen = (period: number, t: number, player: string, drawnBy: string, infraction = 'slashing', minutes = 2): GameEvent =>
  ev({ type: 'penalty', period, t, player, drawnBy, infraction, minutes })
const goal = (period: number, t: number, scorer: string): GameEvent => ev({ type: 'goal', period, t, scorer, assists: [], strength: 'ev', pos: P })
const fight = (period: number, t: number, home: string, away: string): GameEvent => ev({
  type: 'fight', period, t, home, away, pos: P, beats: [], separateAt: 20, boxAt: 30, durationS: 30, ending: 'tired',
  winner: home, down: null, thrown: { home: 5, away: 4 }, landed: { home: 3, away: 2 }, injured: null, cause: 'code',
})

function game(extra: GameEvent[]): GameStream {
  const out: GameEvent[] = []
  for (let p = 1; p <= 3; p++) {
    out.push(frame(p, 0))
    for (let t = 60; t < 1200; t += 60) { out.push(whistle(p, t)); out.push(faceoff(p, t + 25)) }
    out.push(ev({ type: 'periodEnd', period: p, t: 1200 }))
  }
  out.push(...extra)
  return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.period - b.e.period || a.e.t - b.e.t || a.i - b.i).map((x) => x.e)
}

function player(id: string, over: Partial<LivePlayerFacts> = {}): LivePlayerFacts {
  const side = sideOf(id)!
  return {
    id, name: `Pat ${id.toUpperCase()}`, side, position: 'C', age: 27, pointStreak: 0, scorelessStreak: 0,
    seasonGames: 30, seasonGoals: 5, seasonAssists: 5, clubName: side === 'home' ? 'Harbour Kings' : 'Valley Wolves',
    opponentName: side === 'home' ? 'Valley Wolves' : 'Harbour Kings', careerKnown: true, career: { goals: 50, points: 120, gamesPlayed: 300 },
    ...over,
  }
}
function facts(over: Partial<LiveStoryFacts> = {}): LiveStoryFacts {
  return {
    gameKey: '2027:40:HAR:VAL', year: 2027, playoff: false, homeName: 'Harbour Kings', awayName: 'Valley Wolves',
    homeAbbr: 'HAR', awayAbbr: 'VAL', userSide: 'home', seasonSeries: [],
    players: [...HOME, ...AWAY].map((id) => player(id)), ...over,
  }
}

describe('rivalry heat — the in-game model', () => {
  it('opponents heat each other; teammates never do', () => {
    const tr = new HeatTracker({ sideOf })
    tr.observe(hit(1, 10, 'h1', 'h2', 0.9, true), 10)
    expect(tr.pair('h1', 'h2')).toBe(0)
    expect(tr.team(10)).toBe(0)
    const incs = tr.observe(hit(1, 20, 'h1', 'a1', 0.9, true), 20)
    expect(incs[0]?.kind).toBe('bigHit')
    expect(tr.pair('h1', 'a1')).toBeGreaterThan(PAIR_HOT)
    expect(tr.team(20)).toBeGreaterThan(0)
  })

  it('a fight puts the pair at full heat; heat fades but not below what was carried', () => {
    const tr = new HeatTracker({ sideOf, carried: { team: 0.5, pairs: [] } })
    const start = tr.team(0)
    tr.observe(fight(1, 100, 'h2', 'a2'), 100)
    expect(tr.pair('h2', 'a2')).toBe(1)
    const peak = tr.team(100)
    expect(peak).toBeGreaterThan(start)
    expect(tr.team(3000)).toBeLessThan(peak)
    expect(tr.team(30000)).toBeCloseTo(start, 3)
  })

  it('a penalty on a top scorer is a cheap shot; after the whistle is its own kind', () => {
    const tr = new HeatTracker({ sideOf, stars: new Set(['a1']) })
    expect(tr.observe(pen(1, 50, 'h3', 'a1'), 50)[0]?.kind).toBe('cheapShot')
    tr.observe(whistle(1, 60), 60)
    expect(tr.observe(pen(1, 61, 'h4', 'a4', 'roughing'), 61)[0]?.kind).toBe('afterWhistle')
    // an ordinary hooking call on a depth man: no heat
    tr.observe(faceoff(1, 80), 80)
    expect(tr.observe(pen(1, 90, 'h5', 'a5', 'hooking'), 90)).toEqual([])
  })

  it('quick-sim fights (two fighting majors) count once', () => {
    const g = computeGameHeat(game([pen(2, 300, 'h1', '', 'fighting', 5), pen(2, 300, 'a1', '', 'fighting', 5)]), { sideOf })
    expect(g.incidents.filter((i) => i.kind === 'fight')).toHaveLength(1)
    expect(g.fights).toBe(1)
    expect(g.pim).toBe(10)
  })

  it('a goal with a man he has heat with on the ice, and chirps at the whistle', () => {
    const g = computeGameHeat(game([hit(1, 30, 'a1', 'h1', 0.9, true), goal(1, 200, 'h1')]), { sideOf })
    const kinds = g.incidents.map((i) => i.kind)
    expect(kinds).toContain('goalInFace')
    expect(kinds).toContain('chirp')
    expect(gameHeatAt(g, 40)).toBeGreaterThan(gameHeatAt(g, 10))
  })

  it('top scorers: needs ten games and ten points, and a clear leader', () => {
    const ranks = topScorers([
      { id: 'h1', side: 'home', position: 'C', seasonGames: 30, seasonGoals: 15, seasonAssists: 20 },
      { id: 'h2', side: 'home', position: 'LW', seasonGames: 30, seasonGoals: 10, seasonAssists: 12 },
      { id: 'h3', side: 'home', position: 'D', seasonGames: 30, seasonGoals: 2, seasonAssists: 10 },
      { id: 'a1', side: 'away', position: 'C', seasonGames: 5, seasonGoals: 8, seasonAssists: 8 },
    ])
    expect(ranks.get('h1')).toBe(1)
    expect(ranks.get('h2')).toBe(2)
    expect(ranks.has('a1')).toBe(false)
  })
})

describe('rivalry heat — across games', () => {
  it('a fight carries into the next meeting and counts meetings since; time cools it', () => {
    const L = createHeatLedger()
    const g = computeGameHeat(game([hit(1, 100, 'h1', 'a1', 0.9, true), fight(2, 400, 'h1', 'a1')]), { sideOf })
    ingestGameHeat(L, { year: 2027, day: 30, date: '2027-10-30', homeTeamId: 'HAR', awayTeamId: 'VAL', homeIds: HOME, awayIds: AWAY, incidents: g.incidents, pim: g.pim, fights: g.fights })
    const t1 = teamHeatBetween(L, 'VAL', 'HAR', 2027, 31).heat
    expect(t1).toBeGreaterThan(0.3)
    const pairs = pairsAcross(L, new Set(HOME), new Set(AWAY), 2027, 31)
    expect(pairs[0]?.last.kind).toBe('fight')
    expect(pairs[0]?.meetingsSince).toBe(0)
    // a quiet meeting: one more meeting since, the clubs cool a little
    const quiet = computeGameHeat(game([]), { sideOf })
    ingestGameHeat(L, { year: 2027, day: 50, date: '2027-11-19', homeTeamId: 'VAL', awayTeamId: 'HAR', homeIds: AWAY, awayIds: HOME, incidents: quiet.incidents, pim: 0, fights: 0 })
    expect(pairsAcross(L, new Set(HOME), new Set(AWAY), 2027, 51)[0]?.meetingsSince).toBe(1)
    expect(teamHeatBetween(L, 'HAR', 'VAL', 2027, 51).heat).toBeLessThan(t1)
    expect(teamHeatBetween(L, 'HAR', 'VAL', 2028, 51).heat).toBeLessThan(0.05)
  })

  it('the fight-frequency input: zero without real history, the old plan exactly at zero heat', () => {
    expect(fightHeatInput(0.1)).toBe(0)
    expect(fightHeatInput(0.6)).toBeGreaterThan(0)
    for (let s = 1; s < 200; s++) expect(rollFightPlan(s, 0.3, 0)).toEqual(rollFightPlan(s, 0.3))
  })

  it('heat pushes fights later and keeps a season rate realistic', () => {
    let base = 0
    let hot = 0
    let lateBase = 0
    let lateHot = 0
    const N = 20000
    for (let s = 1; s <= N; s++) {
      const b = rollFightPlan(s, 0)
      const h = rollFightPlan(s, 0, 1)
      base += b.length
      hot += h.length
      lateBase += b.filter((t) => t >= 2400).length
      lateHot += h.filter((t) => t >= 2400).length
    }
    expect(base / N).toBeGreaterThan(0.12)
    expect(base / N).toBeLessThan(0.18)
    // a full-heat grudge game: more fights, but not a brawl every night
    expect(hot / N).toBeLessThan(0.3)
    expect(lateHot / hot).toBeGreaterThan(lateBase / base + 0.1)
    // a season where one game in eight carries real history stays near the base rate
    const seasonRate = (7 * base + hot * 0.5) / (8 * N)
    expect(seasonRate).toBeLessThan(0.18)
  })
})

describe('rivalry heat — the live story', () => {
  const all = (s: { beats: Array<{ kind: string; text: string; title: string }> }): Array<{ kind: string; text: string; title: string }> => s.beats.filter((b) => b.kind === 'badBlood' || b.kind === 'heat')

  it('BAD BLOOD: a carried pair on the ice together gets the history card, with the meeting count', () => {
    const f = facts({ heat: { team: 0.5, pairs: [{ byId: 'h2', onId: 'a3', kind: 'bigHit', heat: 0.6, date: 'Nov 12', seasonTail: '', meetingsSince: 2, down: true }] } })
    const plan = planLiveStory(game([]), f)
    const bb = all(plan).find((b) => b.kind === 'badBlood')
    expect(bb, JSON.stringify(plan.beats.map((b) => b.kind))).toBeDefined()
    expect(bb!.text).toMatch(/H2/i)
    expect(bb!.text).toMatch(/A3/i)
    expect(bb!.text).toMatch(/Nov 12/)
    expect(bb!.text.toLowerCase()).toMatch(/third|flattened/)
    expect(bb!.title).toBe('BAD BLOOD')
  })

  it('a fight answering an earlier hit says so, with the time of the hit', () => {
    const plan = planLiveStory(game([hit(1, 250, 'a2', 'h2', 0.9, true), fight(2, 330, 'h2', 'a2')]), facts())
    const ans = all(plan).find((b) => /answers|goes back|hit/i.test(b.text) && /4:10/.test(b.text))
    expect(ans, JSON.stringify(all(plan))).toBeDefined()
  })

  it('a penalty on a top scorer names his rank truthfully', () => {
    const players = [...HOME, ...AWAY].map((id) => player(id, id === 'a1' ? { seasonGoals: 20, seasonAssists: 22 } : {}))
    const plan = planLiveStory(game([pen(1, 400, 'h4', 'a1', 'cross-checking')]), facts({ players }))
    const card = all(plan).find((b) => b.title === 'TOP SCORER')
    expect(card, JSON.stringify(all(plan))).toBeDefined()
    expect(card!.text).toMatch(/42 points|leads VAL/)
    expect(card!.text).toMatch(/cross-checking/i)
  })

  it('pools render with every slot filled', () => {
    const slots: Record<string, string> = {
      a: 'Brandt', b: 'Okafor', date: 'Nov 12', seasonTail: '', nth: 'second', Nth: 'Second', hitVerb: 'flattened', infraction: 'slashing',
      club: 'Harbour Kings', n: 'three', clock: '4:12', period: 'first', x: 'Okafor', y: 'Brandt', abbr: 'VAL', pts: '42',
      InfractionCap: 'Slashing', pim: '24', hits: '31', fightsTail: ', plus a fight', homeAbbr: 'HAR', awayAbbr: 'VAL', s: 'Brandt', o: 'Okafor',
    }
    for (const pool of [LT_BAD_BLOOD, LT_HEAT_REPEAT, LT_HEAT_ANSWER, LT_HEAT_STAR, LT_HEAT_TEAM, LT_HEAT_FACE]) {
      for (const v of pool) {
        const text = v.text.replace(/\{(\w+)\}/g, (_m, k: string) => slots[k] ?? `{${k}}`)
        expect(text, v.id).not.toMatch(/[{}]|undefined/)
        expect(text, v.id).not.toMatch(/\b(delve|testament|tapestry|showcase|pivotal|crucial|underscore)/i)
      }
    }
  })

  it('pairKey is order-free', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'))
  })
})
