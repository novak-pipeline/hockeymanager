/**
 * Fights as a timed sequence (fight.ts) and their place in the agent engine:
 * the plan is deterministic and sane, the outcome follows the attributes, the
 * bout holds the stoppage (clock stopped, no faceoff) with both men on the ice,
 * the majors come when they are led off, and the stream stays deterministic.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { FightEvent, FrameEvent, GameEvent, Player, PlayerId } from '@domain'
import { playAbsT } from '@domain'
import { Rng } from '@engine/shared/rng'
import { rollFightPlan } from '@engine/shared/fights'
import { agentSimGame } from './agentSim'
import { fightMoraleDeltas, fighterOf, planFight, type Fighter } from './fight'

const data = generateLeague({ seed: 99 })
const resolve = (id: PlayerId): Player => data.players.get(id)!
const teams = data.league.teams
const team = (i: number) => data.teams.get(teams[i % teams.length])!
const skaters = [...data.players.values()].filter((p) => p.position !== 'G')

const avg: Fighter = { punch: 50, reach: 50, chin: 50, wrestle: 50, gas: 50, aggression: 50 }

/** Fight-ending mix over many fights between league skaters (also the tuning readout). */
function fightMix(n = 2000): { knockdown: number; takedown: number; tired: number; draws: number; injured: number; meanS: number; minS: number; maxS: number; punches: number } {
  const rng = new Rng(5)
  const c = { knockdown: 0, takedown: 0, tired: 0, draws: 0, injured: 0, s: 0, min: 1e9, max: 0, punches: 0 }
  for (let i = 0; i < n; i++) {
    const a = skaters[rng.int(skaters.length)]!
    const b = skaters[rng.int(skaters.length)]!
    const p = planFight(fighterOf(a, rng.float(0.5, 1)), fighterOf(b, rng.float(0.5, 1)), rng, rng.float(0.6, 3))
    c[p.ending]++
    if (p.winner === null) c.draws++
    if (p.injured) c.injured++
    c.s += p.separateAt
    c.min = Math.min(c.min, p.separateAt)
    c.max = Math.max(c.max, p.separateAt)
    c.punches += p.thrown.home + p.thrown.away
  }
  return { knockdown: c.knockdown / n, takedown: c.takedown / n, tired: c.tired / n, draws: c.draws / n, injured: c.injured / n, meanS: c.s / n, minS: c.min, maxS: c.max, punches: c.punches / n }
}

describe('fight plan', () => {
  it('is deterministic and well formed', () => {
    const a = planFight(avg, { ...avg, punch: 70 }, new Rng(3), 1.2)
    const b = planFight(avg, { ...avg, punch: 70 }, new Rng(3), 1.2)
    expect(a).toEqual(b)
    const kinds = a.beats.map((x) => x.kind)
    expect(kinds[0]).toBe('drop')
    expect(kinds).toContain('square')
    expect(kinds).toContain('grab')
    expect(kinds).toContain('punch')
    expect(kinds.slice(-3)).toEqual(['linesmen', 'separate', 'escort'])
    for (let i = 1; i < a.beats.length; i++) expect(a.beats[i]!.at).toBeGreaterThanOrEqual(a.beats[i - 1]!.at)
    expect(a.boxAt).toBeGreaterThan(a.separateAt)
    expect(a.durationS).toBeGreaterThan(a.boxAt)
    const punches = a.beats.filter((x) => x.kind === 'punch')
    expect(punches.length).toBe(a.thrown.home + a.thrown.away)
    expect(punches.filter((x) => x.landed).length).toBe(a.landed.home + a.landed.away)
    // a man down is the loser; a down beat names him
    if (a.down) {
      expect(a.winner).toBe(a.down === 'home' ? 'away' : 'home')
      expect(a.beats.find((x) => x.kind === 'down')?.by).toBe(a.down)
    }
  })

  it('a real mix of endings, NHL-length bouts, rare injuries', () => {
    const m = fightMix()
    // Most fights end with somebody on the ice or both men spent and hanging on;
    // a clean knockdown is the exception.
    expect(m.knockdown).toBeGreaterThan(0.06)
    expect(m.knockdown).toBeLessThan(0.3)
    expect(m.takedown).toBeGreaterThan(0.15)
    expect(m.tired).toBeGreaterThan(0.25)
    expect(m.draws).toBeGreaterThan(0.08)
    expect(m.meanS).toBeGreaterThan(12)
    expect(m.meanS).toBeLessThan(40)
    expect(m.maxS).toBeLessThan(50)
    expect(m.injured).toBeLessThan(0.06)
  })

  it('the better fighter wins more often', () => {
    const tough: Fighter = { punch: 85, reach: 75, chin: 80, wrestle: 80, gas: 75, aggression: 80 }
    let w = 0
    let l = 0
    for (let s = 0; s < 400; s++) {
      const p = planFight(tough, avg, new Rng(s), 1.5)
      if (p.winner === 'home') w++
      else if (p.winner === 'away') l++
    }
    expect(w).toBeGreaterThan(l * 2.5)
  })
})

describe('fights in the agent engine', () => {
  const seed = [1, 3, 4, 6, 7, 10].find((s) => rollFightPlan(s, 1).length > 0)!
  const game = () => agentSimGame(team(0), team(1), resolve, { seed, intensity: 1 })

  it('the bout holds the stoppage: both men on the ice at the spot, clock stopped, majors when they are led off', () => {
    // several games and pairings (boil-overs and the code; a fighter may have been mid-change or just penalised)
    const seeds = Array.from({ length: 40 }, (_, k) => k + 1).filter((s) => rollFightPlan(s, 1).length > 0).slice(0, 6)
    let judged = 0
    for (const [k, sd] of seeds.entries()) {
    const g = agentSimGame(team(k), team(k + 3), resolve, { seed: sd, intensity: 1 })
    const fights = g.stream.filter((e): e is FightEvent => e.type === 'fight')
    for (const f of fights) {
      judged++
      // both men are in every frame from the drop until they are led off
      for (const fr of g.stream) {
        if (fr.type !== 'frame' || playAbsT(fr) < playAbsT(f) + 0.01 || playAbsT(fr) > playAbsT(f) + f.boxAt - 0.3) continue
        expect(fr.home.some((x) => x.player === f.home) && fr.away.some((x) => x.player === f.away), `seed ${sd}: a fighter left the ice at ${(playAbsT(fr) - playAbsT(f)).toFixed(2)} s`).toBe(true)
      }
      const at = playAbsT(f)
      const i = g.stream.indexOf(f)
      // a whistle right before it
      const prev = g.stream.slice(Math.max(0, i - 3), i).find((e) => e.type === 'whistle')
      expect(prev).toBeDefined()
      // the two majors, at the box time, on the same (stopped) period clock
      const pens = g.stream.slice(i).filter((e): e is Extract<GameEvent, { type: 'penalty' }> => e.type === 'penalty' && e.infraction === 'fighting' && (e.player === f.home || e.player === f.away))
      expect(pens.length).toBeGreaterThanOrEqual(2)
      expect(Math.abs(playAbsT(pens[0]!) - (at + f.boxAt))).toBeLessThan(0.4)
      expect(pens[0]!.t).toBe(f.t)
      // no faceoff inside the bout
      const fo = g.stream.slice(i).find((e) => e.type === 'faceoff')!
      expect(playAbsT(fo)).toBeGreaterThan(at + f.boxAt)
      // both fighters on the ice through it, together once they have hold
      const grab = f.beats.find((b) => b.kind === 'grab')!.at
      const frames = g.stream.filter((e): e is FrameEvent => e.type === 'frame' && playAbsT(e) > at + grab + 1 && playAbsT(e) < at + f.separateAt)
      expect(frames.length).toBeGreaterThan(4)
      for (const fr of frames) {
        expect(fr.t).toBe(f.t)
        const h = fr.home.find((s) => s.player === f.home)
        const a = fr.away.find((s) => s.player === f.away)
        expect(h && a).toBeTruthy()
        expect(h!.act).toBe('fight')
        const gapFt = Math.hypot((h!.pos.x - a!.pos.x) * 100, (h!.pos.y - a!.pos.y) * 42.5)
        expect(gapFt).toBeLessThan(6)
        // everybody else gives them room
        for (const s of [...fr.home, ...fr.away]) {
          if (s.player === f.home || s.player === f.away) continue
          const d = Math.hypot((s.pos.x - f.pos.x) * 100, (s.pos.y - f.pos.y) * 42.5)
          expect(d).toBeGreaterThan(8)
        }
      }
    }
    }
    expect(judged).toBeGreaterThan(3)
  }, 120000)

  it('is deterministic (same seed, same stream)', () => {
    const a = JSON.stringify(game().stream)
    const b = JSON.stringify(game().stream)
    expect(a).toBe(b)
  }, 60000)

  it('morale: the winner walks taller, a draw stood up for his team', () => {
    const f = { type: 'fight', home: 'h', away: 'a', winner: 'h' } as unknown as GameEvent
    const d = fightMoraleDeltas([f])
    expect(d.get('h' as PlayerId)).toBeGreaterThan(0)
    expect(d.get('a' as PlayerId)).toBeLessThan(0)
    const draw = fightMoraleDeltas([{ ...(f as object), winner: null } as unknown as GameEvent])
    expect(draw.get('a' as PlayerId)).toBeGreaterThan(0)
  })
})
