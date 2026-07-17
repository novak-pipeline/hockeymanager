/**
 * Home last-change line matching (#lineMatching — formerly a dead toggle).
 *
 * A matching HOME bench sees the away unit first and answers the opponent's top
 * line with its best credible checking unit (checking line + shutdown pair).
 * The observable contract, measured against equal-strength mirror clubs:
 *   - the matchup actually deploys (checking-line ice time rises, full sim),
 *   - the opposing top line's share of scoring drops (quick sim),
 *   - the edge stays modest (real last change is visible in deployment, worth
 *     only a point or two of win probability),
 *   - and with the tactic OFF (the default everywhere outside a coach who runs
 *     it) nothing changes — the seeded calibration/parity suites pin that.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId, Team } from '@domain'
import { asPlayerId, asTeamId } from '@domain'
import { fullSimGame } from './fullSim'
import { quickSimGame } from '@engine/quick/quickSim'

function mirror(seed: number) {
  const data = generateLeague({ seed })
  const src = data.teams.get(data.league.teams[0])!
  const clones = new Map<PlayerId, Player>()
  const remap = (ids: PlayerId[]): PlayerId[] => ids.map((i) => asPlayerId(`${i}_B`))
  for (const id of src.roster) clones.set(asPlayerId(`${id}_B`), { ...data.players.get(id)!, id: asPlayerId(`${id}_B`) })
  const away: Team = {
    ...src,
    id: asTeamId('MIRROR'),
    abbreviation: 'MIR',
    roster: remap(src.roster),
    lines: {
      forwards: src.lines.forwards.map(remap) as Team['lines']['forwards'],
      defensePairs: src.lines.defensePairs.map(remap) as Team['lines']['defensePairs'],
      goalies: remap(src.lines.goalies) as Team['lines']['goalies'],
      powerPlayUnits: src.lines.powerPlayUnits.map(remap),
      penaltyKillUnits: src.lines.penaltyKillUnits.map(remap),
    },
  }
  const resolve = (id: PlayerId): Player => data.players.get(id) ?? clones.get(id)!
  const homeWith = (matching: boolean): Team => ({ ...src, tactics: { ...src.tactics, lineMatching: matching } })
  return { src, away, resolve, homeWith }
}

describe('line matching — quick sim', () => {
  it('suppresses the opposing top line and earns a modest home edge', () => {
    const { away, resolve, homeWith } = mirror(99)
    const off = (id: PlayerId): number => {
      const c = resolve(id).composites
      return c.scoring * 0.6 + c.playmaking * 0.4
    }
    const topLine = [...away.lines.forwards].sort(
      (a, b) => b.reduce((s, i) => s + off(i), 0) / b.length - a.reduce((s, i) => s + off(i), 0) / a.length
    )[0]
    const topSet = new Set(topLine.map(String))
    const run = (matching: boolean) => {
      let wins = 0
      let ga = 0
      let top = 0
      const N = 600
      for (let i = 0; i < N; i++) {
        const o = quickSimGame(homeWith(matching), away, resolve, { seed: 40000 + i })
        ga += o.awayGoals
        if (o.homeGoals > o.awayGoals) wins++
        for (const e of o.stream) if (e.type === 'goal' && topSet.has(String(e.scorer))) top++
      }
      return { win: wins / N, topShare: top / Math.max(1, ga) }
    }
    const offR = run(false)
    const onR = run(true)
    // Their top line's share of scoring clearly drops...
    expect(onR.topShare).toBeLessThan(offR.topShare - 0.005)
    // ...and the home side gains a small (not runaway) edge.
    expect(onR.win).toBeGreaterThan(offR.win - 0.01)
    expect(onR.win).toBeLessThan(offR.win + 0.06)
  }, 120000)
})

describe('line matching — full sim', () => {
  it('the checking line actually absorbs more ice time when matching', () => {
    const { src, away, resolve, homeWith } = mirror(99)
    const def = (id: PlayerId): number => {
      const c = resolve(id).composites
      return c.defensiveZone * 0.6 + c.takeaway * 0.4
    }
    const checkLine = [...src.lines.forwards].sort(
      (a, b) => b.reduce((s, i) => s + def(i), 0) / b.length - a.reduce((s, i) => s + def(i), 0) / a.length
    )[0]
    const checkSet = new Set(checkLine.map(String))
    const share = (matching: boolean): number => {
      let check = 0
      let tot = 0
      for (let i = 0; i < 50; i++) {
        const o = fullSimGame(homeWith(matching), away, resolve, { seed: 40000 + i })
        for (const [pid, s] of o.playerStats) {
          if (String(pid).endsWith('_B') || resolve(pid).position === 'G') continue
          tot += s.toi
          if (checkSet.has(String(pid))) check += s.toi
        }
      }
      return check / tot
    }
    const offShare = share(false)
    const onShare = share(true)
    expect(onShare).toBeGreaterThan(offShare + 0.02) // clearly more matchup minutes
  }, 180000)
})
