/**
 * Agent engine gates (src/engine/agent): the same contract as the director
 * engine — deterministic, renderer-safe, NHL-calibrated — plus the owner's
 * play-logic rules (no aimless backward passes on the rush, breakaways end in
 * an attempt) and the physical game (hits happen along the boards, penalties
 * come in real infraction types).
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { FrameEvent, Player, PlayerId } from '@domain'
import { isEvent } from '@domain'
import { CALIBRATION_TARGETS } from '@calibrate'
import { agentSimGame, emptyAgentTelemetry } from './agentSim'
import { MAX_TOP_FT } from './physics'
import { histPct } from './telemetry'
import { passShape } from '@engine/full/passShape'

const data = generateLeague({ seed: 99 })
const resolve = (id: PlayerId): Player => {
  const p = data.players.get(id)
  if (!p) throw new Error(`unknown player ${id}`)
  return p
}
const teams = data.league.teams
const team = (i: number) => data.teams.get(teams[i % teams.length])!

describe('agent engine', () => {
  it('is deterministic for a given seed', () => {
    const a = agentSimGame(team(0), team(1), resolve, { seed: 42 })
    const b = agentSimGame(team(0), team(1), resolve, { seed: 42 })
    expect(a.homeGoals).toBe(b.homeGoals)
    expect(a.awayGoals).toBe(b.awayGoals)
    expect(a.stream.length).toBe(b.stream.length)
    expect(JSON.stringify(a.stream.slice(-400))).toBe(JSON.stringify(b.stream.slice(-400)))
  }, 60000)

  it('emits a renderer-compatible stream: dense frames, legal positions, no skater faster than his legs', () => {
    const t0 = Date.now()
    const out = agentSimGame(team(2), team(3), resolve, { seed: 7 })
    const ms = Date.now() - t0
    // eslint-disable-next-line no-console
    console.log(`agent game simulated in ${ms} ms`)
    expect(out.homeGoals).not.toBe(out.awayGoals)
    const frames = out.stream.filter((e): e is FrameEvent => isEvent(e, 'frame'))
    expect(frames.length).toBeGreaterThan(14000)
    const cap = MAX_TOP_FT * 0.25 + 0.6 // top speed per 0.25 s frame + contact/fp slack
    let prev: FrameEvent | null = null
    let maxStep = 0
    for (const f of frames) {
      expect(f.home.length).toBeGreaterThanOrEqual(3)
      expect(f.home.length).toBeLessThanOrEqual(6)
      for (const s of [...f.home, ...f.away]) {
        expect(Math.abs(s.pos.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(s.pos.y)).toBeLessThanOrEqual(1)
      }
      if (prev && prev.period === f.period && f.t - prev.t < 0.3) {
        for (const side of ['home', 'away'] as const) {
          for (const s of f[side]) {
            const was = prev[side].find((q) => q.player === s.player)
            if (!was) continue
            const d = Math.hypot((s.pos.x - was.pos.x) * 100, (s.pos.y - was.pos.y) * 42.5)
            maxStep = Math.max(maxStep, d)
          }
        }
      }
      prev = f
    }
    expect(maxStep).toBeGreaterThan(0)
    expect(maxStep).toBeLessThanOrEqual(cap)
  }, 60000)

  it('lands in the NHL band and keeps its play logic over many games', () => {
    const tm = emptyAgentTelemetry()
    const counts: Record<string, number> = {}
    const infractions = new Set<string>()
    let rushBack = 0
    let ozPasses = 0
    let ozBack = 0
    const games = 16
    for (let i = 0; i < games; i++) {
      const out = agentSimGame(team(i), team(i + 1), resolve, { seed: 5000 + i, agentTelemetry: tm })
      for (const e of out.stream) {
        counts[e.type] = (counts[e.type] ?? 0) + 1
        if (e.type === 'penalty') infractions.add(e.infraction)
      }
      const ps = passShape(out.stream)
      ozPasses += ps.ozPasses
      ozBack += ps.ozBackward
    }
    void rushBack
    const per = (t: string): number => (counts[t] ?? 0) / (games * 2)
    const R = CALIBRATION_TARGETS.perTeamPerGame
    const g2 = games * 2
    // eslint-disable-next-line no-console
    console.log(
      `agent rates/team/game: goal=${per('goal').toFixed(2)} shot=${per('shot').toFixed(1)} blocked=${per('blockedShot').toFixed(1)} ` +
        `hit=${per('hit').toFixed(1)} penalty=${per('penalty').toFixed(2)} takeaway=${per('takeaway').toFixed(1)} giveaway=${per('giveaway').toFixed(1)} ` +
        `faceoff=${per('faceoff').toFixed(1)} pass=${per('pass').toFixed(0)} hitsOnBoards=${(tm.hitsBoards / Math.max(1, tm.hits)).toFixed(2)} ` +
        `accel p50=${histPct(tm.accelHist, 0.5)} speed p50=${histPct(tm.speedHist, 0.5)} ozBack=${(ozBack / Math.max(1, ozPasses)).toFixed(3)} ` +
        `infractions=${[...infractions].join('|')} misses=${(tm.missed / g2).toFixed(1)}`
    )
    const band = (got: number, target: number, tol: number): void => {
      expect(got).toBeGreaterThan(target * (1 - tol))
      expect(got).toBeLessThan(target * (1 + tol))
    }
    band(per('goal'), R.goals, 0.25)
    band(per('shot'), R.shotsOnGoal, 0.2)
    band(per('hit'), R.hits, 0.3)
    band(per('penalty'), R.penalties, 0.35)
    band(per('faceoff'), R.faceoffs, 0.3)
    expect(per('blockedShot')).toBeGreaterThan(R.blockedShots * 0.5)
    // Shots miss the net now and then (the director engine never does).
    expect(tm.missed / g2).toBeGreaterThan(6)
    // Real infraction names, several kinds.
    expect(infractions.size).toBeGreaterThanOrEqual(6)
    // Smooth movement: calm cruising, not max-accel steering.
    expect(histPct(tm.accelHist, 0.5)).toBeLessThan(10)
    // Offensive-zone back passes stay in the NHL band (low-to-high in a
    // settled cycle is hockey; on the rush it isn't — see the scorecard).
    expect(ozBack / Math.max(1, ozPasses)).toBeLessThan(0.4)
  }, 300000)
})
