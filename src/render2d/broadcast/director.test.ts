import { describe, expect, it } from 'vitest'
import type { GameEvent, GameStream } from '@domain'
import type { BroadcastContext, BroadcastStoryline } from '@engine/story/broadcastStorylines'
import { directBroadcast, powerPlayWindows, BoothPicker, elapsedLabel } from './director'
import { linesFor } from './commentaryLibrary'
import type { CommentaryCue, MomentCue, OverlayCue, PresentationCue } from './types'

const P = { x: 0, y: 0 }
const ev = (e: Record<string, unknown>): GameEvent => e as unknown as GameEvent

function ctx(storylines: BroadcastStoryline[] = [], over: Partial<BroadcastContext> = {}): BroadcastContext {
  const mk = (id: string, name: string, side: 'home' | 'away', position = 'C', extra: Record<string, unknown> = {}) =>
    ({ id, name, side, position, seasonLine: '', seasonGoals: 10, seasonAssists: 12, ...extra })
  return {
    gameKey: '2026:12:HOM:AWY',
    year: 2026,
    playoff: false,
    arenaName: 'Harbour Centre',
    homeTeamId: 'HOM', awayTeamId: 'AWY',
    homeName: 'Harbour Kings', awayName: 'Valley Wolves', homeAbbr: 'HAR', awayAbbr: 'VAL',
    homeColors: { primary: 0x113366, secondary: 0xcc2233 }, awayColors: { primary: 0x225522, secondary: 0xffffff },
    home: { starters: ['h1', 'h2', 'hg'], goalieId: 'hg', record: '5-3-1' },
    away: { starters: ['a1', 'a2', 'ag'], goalieId: 'ag', record: '4-4-1' },
    players: {
      h1: mk('h1', 'Ben Kindel', 'home', 'C', { careerGoalsBefore: 0 }),
      h2: mk('h2', 'Old Vet', 'home', 'D', { careerGoalsBefore: 300 }),
      hg: mk('hg', 'Home Goalie', 'home', 'G', { seasonSaves: 200 }),
      a1: mk('a1', 'Kirill Kaprizov', 'away', 'LW', { careerGoalsBefore: 280 }),
      a2: mk('a2', 'Away Two', 'away', 'D'),
      ag: mk('ag', 'Away Goalie', 'away', 'G', { seasonSaves: 180 }),
    } as BroadcastContext['players'],
    storylines,
    ...over,
  }
}

/** A small but complete game: P1 goal, P2 PP goal + big save, P3 late tying
 *  goal, OT winner. */
function stream(): GameStream {
  return [
    ev({ type: 'faceoff', t: 0, period: 1, zone: 'neutral', winner: 'h1', pos: P }),
    ev({ type: 'shot', t: 100, period: 1, shooter: 'a1', from: P, target: P, danger: 0.4 }),
    ev({ type: 'save', t: 100.4, period: 1, goalie: 'hg', rebound: false, pos: P }),
    ev({ type: 'whistle', t: 400, period: 1, reason: 'goalieFreeze' }),
    ev({ type: 'shot', t: 600, period: 1, shooter: 'h1', from: P, target: P, danger: 0.5 }),
    ev({ type: 'goal', t: 600.5, period: 1, scorer: 'h1', assists: ['h2'], strength: 'ev', pos: P }),
    ev({ type: 'periodEnd', t: 1200, period: 1 }),
    ev({ type: 'penalty', t: 100, period: 2, player: 'h2', infraction: 'hooking', minutes: 2 }),
    ev({ type: 'goal', t: 150, period: 2, scorer: 'a1', assists: ['a2'], strength: 'pp', pos: P }),
    ev({ type: 'shot', t: 500, period: 2, shooter: 'a1', from: P, target: P, danger: 0.92 }),
    ev({ type: 'save', t: 500.3, period: 2, goalie: 'hg', rebound: false, pos: P }),
    ev({ type: 'goal', t: 700, period: 2, scorer: 'a1', assists: [], strength: 'ev', pos: P }),
    ev({ type: 'periodEnd', t: 1200, period: 2 }),
    ev({ type: 'goal', t: 1150, period: 3, scorer: 'h1', assists: ['h2'], strength: 'ev', pos: P }),
    ev({ type: 'periodEnd', t: 1200, period: 3 }),
    ev({ type: 'goal', t: 60, period: 4, scorer: 'h2', assists: ['h1'], strength: 'ev', pos: P }),
    ev({ type: 'gameEnd', t: 60, period: 4 }),
  ]
}

const commentary = (cues: PresentationCue[]): CommentaryCue[] => cues.filter((c): c is CommentaryCue => c.channel === 'commentary')
const moments = (cues: PresentationCue[]): MomentCue[] => cues.filter((c): c is MomentCue => c.channel === 'moment')
const overlays = (cues: PresentationCue[]): OverlayCue[] => cues.filter((c): c is OverlayCue => c.channel === 'overlay')

const debut: BroadcastStoryline = { id: 'debut:h1', kind: 'debut', side: 'home', playerId: 'h1', title: 'NHL DEBUT', detail: 'Ben Kindel plays his first NHL game', priority: 90 }
const milestone: BroadcastStoryline = {
  id: 'points:h2:1000', kind: 'milestoneWatch', side: 'home', playerId: 'h2', title: 'MILESTONE WATCH',
  detail: 'Old Vet is 2 points from 1,000', priority: 61, milestone: { stat: 'points', before: 998, target: 1000 },
}
const homecoming: BroadcastStoryline = {
  id: 'homecoming:a1', kind: 'homecoming', side: 'away', playerId: 'a1', title: 'HOMECOMING',
  detail: 'Kaprizov returns', priority: 80, formerTeamName: 'Harbour Kings',
}

describe('presentation director', () => {
  it('is deterministic — same inputs, identical plan', () => {
    const a = directBroadcast(stream(), ctx([debut, milestone]), { presentation: 'full' })
    const b = directBroadcast(stream(), ctx([debut, milestone]), { presentation: 'full' })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('fires NO ceremonies without earned storylines', () => {
    const plan = directBroadcast(stream(), ctx([]), { presentation: 'full' })
    expect(moments([...plan.pregame, ...plan.game])).toEqual([])
    expect(overlays(plan.pregame).filter((o) => o.data.kind === 'storyCard')).toEqual([])
    expect(overlays(plan.game).filter((o) => o.data.kind === 'milestone')).toEqual([])
  })

  it('a debut earns the rookie lap in the pregame, captioned', () => {
    const plan = directBroadcast(stream(), ctx([debut]), { presentation: 'full' })
    const laps = moments(plan.pregame).filter((m) => m.moment === 'rookieLap')
    expect(laps).toHaveLength(1)
    expect(laps[0]!.caption).toBe('Rookie lap — Ben Kindel, first NHL game')
    // And his first goal is called as his first.
    const firstGoal = commentary(plan.game).find((c) => c.moment === 'goal.first')
    expect(firstGoal?.name?.playerId).toBe('h1')
  })

  it('milestone ovation fires on the goal that crosses it — not before, only once', () => {
    const plan = directBroadcast(stream(), ctx([milestone]), { presentation: 'full' })
    const ms = overlays(plan.game).filter((o) => o.data.kind === 'milestone')
    // h2: 998 before; assist @P1 600.5 → 999; assist @P3 → 1000.
    expect(ms).toHaveLength(1)
    expect(ms[0]!.at).toBe(2400 + 1150)
    const ov = moments(plan.game).filter((m) => m.moment === 'standingOvation')
    expect(ov).toHaveLength(1)
  })

  it('homecoming: tribute video at the first whistle past the TV-timeout mark', () => {
    const plan = directBroadcast(stream(), ctx([homecoming]), { presentation: 'full' })
    const trib = moments(plan.game).filter((m) => m.moment === 'tributeVideo')
    expect(trib).toHaveLength(1)
    expect(trib[0]!.at).toBe(400) // the 400s whistle, first after 6:00
    // His goal against the old club is the revenge call.
    expect(commentary(plan.game).some((c) => c.moment === 'goal.revenge' && c.name?.playerId === 'a1')).toBe(true)
  })

  it('the goal call is cued AT the goal, zero delay, top priority', () => {
    const plan = directBroadcast(stream(), ctx([]), { presentation: 'full' })
    const goalAt = [600.5, 1200 + 150, 1200 + 700, 2400 + 1150, 3600 + 60]
    for (const at of goalAt) {
      const calls = commentary(plan.game).filter((c) => c.at === at && c.moment.startsWith('goal') && c.moment !== 'goal.color')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.delayMs ?? 0).toBe(0)
      expect(calls[0]!.priority).toBe(3)
      expect(calls[0]!.maxLatencyMs).toBeLessThanOrEqual(400)
    }
    const moments_ = commentary(plan.game).map((c) => c.moment)
    expect(moments_).toContain('goal.powerPlay')
    expect(moments_).toContain('goal.lateTie')
    expect(moments_).toContain('goal.overtime')
    // Post-goal beats are all DELAYED behind the call.
    for (const o of overlays(plan.game).filter((o) => o.data.kind === 'lowerThird')) {
      expect(o.delayMs ?? 0).toBeGreaterThan(3000)
    }
  })

  it('never repeats a booth line back-to-back, and exhausts a pool before reuse', () => {
    const picker = new BoothPicker('k')
    const pool = linesFor('goal')
    const seen: string[] = []
    for (let i = 0; i < pool.length; i++) seen.push(picker.pick('goal', `s${i}`)!.id)
    expect(new Set(seen).size).toBe(pool.length)
    let last = seen[seen.length - 1]
    for (let i = 0; i < 20; i++) {
      const id = picker.pick('goal', `r${i}`)!.id
      expect(id).not.toBe(last)
      last = id
    }
  })

  it('goal tags carry season totals and assist roles; lower third has the elapsed time', () => {
    const plan = directBroadcast(stream(), ctx([]), { presentation: 'full' })
    const tags = overlays(plan.game).filter((o) => o.data.kind === 'playerTag' && o.at === 600.5)
    const goal = tags.find((t) => t.data.kind === 'playerTag' && t.data.role === 'goal')!
    expect(goal.data.kind === 'playerTag' && goal.data.stat).toBe('11 GOALS')
    expect(tags.some((t) => t.data.kind === 'playerTag' && t.data.role === 'assist1' && t.data.playerId === 'h2')).toBe(true)
    const lt = overlays(plan.game).find((o) => o.data.kind === 'lowerThird' && o.at === 600.5)!
    expect(lt.data.kind === 'lowerThird' && lt.data.goal.elapsed).toBe('10:00')
  })

  it('presentation off → no pregame, no overlays; commentary still planned', () => {
    const plan = directBroadcast(stream(), ctx([debut]), { presentation: 'off' })
    expect(plan.pregame).toEqual([])
    expect(overlays(plan.game)).toEqual([])
    expect(commentary(plan.game).length).toBeGreaterThan(0)
  })

  it('compact trims the open (no lineups / goalie tape) but keeps the earned moments', () => {
    const full = directBroadcast(stream(), ctx([debut]), { presentation: 'full' })
    const compact = directBroadcast(stream(), ctx([debut]), { presentation: 'compact' })
    expect(compact.pregameMs).toBeLessThan(full.pregameMs)
    expect(overlays(compact.pregame).some((o) => o.data.kind === 'startingLineup')).toBe(false)
    expect(moments(compact.pregame).some((m) => m.moment === 'rookieLap')).toBe(true)
  })

  it('cue lists are sorted by time', () => {
    const plan = directBroadcast(stream(), ctx([debut, milestone, homecoming]), { presentation: 'full' })
    for (const list of [plan.pregame, plan.game]) {
      for (let i = 1; i < list.length; i++) expect(list[i]!.at).toBeGreaterThanOrEqual(list[i - 1]!.at)
    }
  })

  it('power-play windows open on a minor and close on the PP goal', () => {
    const isHome = (id: string): boolean => id.startsWith('h')
    const w = powerPlayWindows(stream(), isHome)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ side: 'away', offenderId: 'h2', fromAbsT: 1300, toAbsT: 1350 })
  })

  it('elapsed label is broadcast style', () => {
    expect(elapsedLabel(856)).toBe('14:16')
    expect(elapsedLabel(5)).toBe('0:05')
  })
})
