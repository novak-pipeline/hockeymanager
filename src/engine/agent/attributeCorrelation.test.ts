/**
 * Attribute-correlation gate (docs/MATCH-ENGINE-PLAN.md, audit gates): in the
 * agent engine a player's ratings must SHOW in what he does, because the
 * outcomes emerge from them. Over a batch of games, per player:
 *
 *   hitting composite   → hits per 60              r ≥ 0.3
 *   takeaway composite  → takeaways per 60         r ≥ 0.3
 *   puckControl         → giveaways per minute carried r ≤ −0.3 (fewer)
 *   passing             → pass completion %        r ≥ 0.3
 *
 * Giveaways are normalised by time WITH the puck (not ice time): a skilled
 * player has the puck far more, so raw giveaways/60 would mostly measure usage.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { FrameEvent, Player, PlayerId } from '@domain'
import { agentSimGame } from './agentSim'

const data = generateLeague({ seed: 99 })
const resolve = (id: PlayerId): Player => {
  const p = data.players.get(id)
  if (!p) throw new Error(`unknown player ${id}`)
  return p
}
const teams = data.league.teams
const team = (i: number) => data.teams.get(teams[i % teams.length])!

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxy / Math.sqrt(Math.max(sxx * syy, 1e-12))
}

interface Acc {
  toi: number
  hits: number
  takeaways: number
  giveaways: number
  touches: number
  carryS: number
  passes: number
  completed: number
}

describe('agent engine attribute correlations', () => {
  it('ratings show in the box score (hitting, takeaways, puck control, passing)', () => {
    const acc = new Map<PlayerId, Acc>()
    const get = (id: PlayerId): Acc => {
      let a = acc.get(id)
      if (!a) {
        a = { toi: 0, hits: 0, takeaways: 0, giveaways: 0, touches: 0, carryS: 0, passes: 0, completed: 0 }
        acc.set(id, a)
      }
      return a
    }
    const games = Number(process.env.CORR_GAMES ?? 32)
    for (let i = 0; i < games; i++) {
      const out = agentSimGame(team(i), team(i + 3), resolve, { seed: 9100 + i })
      let holder: PlayerId | null = null
      for (const e of out.stream) {
        switch (e.type) {
          case 'hit':
            get(e.by).hits++
            break
          case 'takeaway':
            get(e.by).takeaways++
            break
          case 'giveaway':
            get(e.player).giveaways++
            break
          case 'pass':
            get(e.from).passes++
            if (e.completed) get(e.from).completed++
            break
          case 'frame': {
            const f = e as FrameEvent
            if (f.puckCarrier && f.puckCarrier !== holder) get(f.puckCarrier).touches++
            if (f.puckCarrier) get(f.puckCarrier).carryS += 0.25
            holder = f.puckCarrier
            break
          }
        }
      }
      for (const [id, st] of out.playerStats) get(id).toi += st.toi
    }
    const skaters = [...acc.entries()].filter(([id, a]) => resolve(id).position !== 'G' && a.toi > 1800)
    const rOf = (x: (p: Player) => number, y: (a: Acc) => number, keep: (a: Acc) => boolean = () => true): number => {
      const rows = skaters.filter(([, a]) => keep(a))
      return pearson(
        rows.map(([id]) => x(resolve(id))),
        rows.map(([, a]) => y(a))
      )
    }
    const rHits = rOf((p) => p.composites.hitting, (a) => (a.hits / a.toi) * 3600)
    const rTake = rOf((p) => p.composites.takeaway, (a) => (a.takeaways / a.toi) * 3600)
    const rGive = rOf((p) => p.composites.puckControl, (a) => (a.giveaways / a.carryS) * 60, (a) => a.carryS >= 60)
    const rPass = rOf((p) => p.ratings.technical.passing, (a) => a.completed / a.passes, (a) => a.passes >= 30)
    const line =
      `attribute r over ${skaters.length} skaters: hitting→hits/60 ${rHits.toFixed(2)}, takeaway→takeaways/60 ${rTake.toFixed(2)}, ` +
      `puckControl→giveaways/min carried ${rGive.toFixed(2)}, passing→pass% ${rPass.toFixed(2)}`
    // eslint-disable-next-line no-console
    if (process.env.CORR_LOG) process.stderr.write(line + '\n')
    else console.log(line)
    expect(rHits).toBeGreaterThanOrEqual(0.3)
    expect(rTake).toBeGreaterThanOrEqual(0.3)
    expect(rGive).toBeLessThanOrEqual(-0.3)
    expect(rPass).toBeGreaterThanOrEqual(0.3)
  }, 300000)
})
