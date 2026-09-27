/**
 * STEP 0 of the match-engine plan — "the always passing backwards thing".
 *
 * A puck carrier with a lane, on a breakaway, or leading an odd-man rush
 * ATTACKS (skates to a shooting area / shoots) or moves the puck forward or
 * across; a backward pass in the offensive half is a bail-out under real
 * pressure only, and back passes are otherwise a neutral-zone regroup tool.
 *
 * Measured over many seeded games through both the engine's own telemetry
 * (rush / breakaway context) and the engine-agnostic stream analyzer.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { emptyTelemetry, fullSimGame } from './fullSim'
import { passShape } from './passShape'

function resolverFor(data: ReturnType<typeof generateLeague>) {
  return (id: PlayerId): Player => {
    const p = data.players.get(id)
    if (!p) throw new Error(`unknown player ${id}`)
    return p
  }
}

describe('pass direction (step 0: no aimless backward passing)', () => {
  it('attacking carriers go forward; breakaways end in a shot or a forward pass', () => {
    const data = generateLeague({ seed: 31 })
    const resolve = resolverFor(data)
    const teams = data.league.teams
    const tm = emptyTelemetry()
    let ozPasses = 0
    let ozBack = 0
    let passes = 0
    const games = 24
    for (let i = 0; i < games; i++) {
      const home = data.teams.get(teams[i % teams.length])!
      const away = data.teams.get(teams[(i + 3) % teams.length])!
      const out = fullSimGame(home, away, resolve, { seed: 9100 + i, telemetry: tm })
      const ps = passShape(out.stream)
      ozPasses += ps.ozPasses
      ozBack += ps.ozBackward
      passes += ps.passes
    }
    const P = tm.passes
    const B = tm.breakaways
    const ended = B.shot + B.forwardPass + B.backPass + B.lost
    // eslint-disable-next-line no-console
    console.log(
      `pass direction over ${games} games: passes/team/game=${(passes / (games * 2)).toFixed(1)}` +
        ` ozBackShare(stream)=${(ozBack / Math.max(1, ozPasses)).toFixed(3)}` +
        ` ozBackShare(tm)=${(P.ozBack / Math.max(1, P.ozTotal)).toFixed(3)}` +
        ` ozBackUnpressured=${P.ozBack - P.ozBackPressured}/${P.ozTotal}` +
        ` allBackShare=${(P.back / Math.max(1, P.total)).toFixed(3)}` +
        ` rushBack=${P.rushBack}/${P.rushTotal}` +
        ` breakaways=${B.started} shot=${B.shot} fwdPass=${B.forwardPass} backPass=${B.backPass} lost=${B.lost}`
    )
    expect(B.started).toBeGreaterThan(10)
    // Breakaways end in an attempt (or a legal forward/across pass) ≥ 95%.
    expect((B.shot + B.forwardPass) / Math.max(1, ended)).toBeGreaterThanOrEqual(0.95)
    expect(B.backPass).toBe(0)
    // Rush / entry / counter: never a back pass.
    expect(P.rushBack).toBe(0)
    // Offensive half: backward passes are rare, and only under pressure.
    expect(ozBack / Math.max(1, ozPasses)).toBeLessThan(0.1)
    expect(P.ozBack - P.ozBackPressured).toBe(0)
  }, 300000)
})
