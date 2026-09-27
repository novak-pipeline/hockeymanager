import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { GameStream, Player, PlayerId } from '@domain'
import { fullSimGame } from '@engine/full/fullSim'
import { MatchTimeline, absTime } from './timeline'

function buildTimeline(seed: number) {
  const data = generateLeague({ seed })
  const resolve = (id: PlayerId): Player => data.players.get(id)!
  const home = data.teams.get(data.league.teams[0])!
  const away = data.teams.get(data.league.teams[1])!
  const out = fullSimGame(home, away, resolve, { seed: seed * 7 })
  const homeIds = new Set<PlayerId>(home.roster)
  const tl = new MatchTimeline(out.stream, (id) => homeIds.has(id))
  return { tl, out }
}

describe('MatchTimeline', () => {
  // Regression: the Catmull-Rom cubic term once omitted −p0, so each segment ended at
  // (p0+2·p2)/2 instead of p2 — skaters sawed backwards inside every 0.25 s frame and
  // snapped forward at the next one (the 4 Hz jiggle in both renderers).
  it('interpolated skater paths are continuous across every frame boundary and move forward', () => {
    const { tl } = buildTimeline(3)
    const frames = (tl as unknown as { frames: Array<{ absT: number }> }).frames
    let worstJumpFt = 0
    let backtracks = 0
    let checked = 0
    for (let i = 10; i < frames.length - 10 && checked < 2000; i += 7) {
      const t = frames[i]!.absT
      const before = tl.sampleAt(t - 0.001)
      const after = tl.sampleAt(t + 0.001)
      const mid = tl.sampleAt(t + 0.125)
      const next = tl.sampleAt(frames[i + 1]!.absT - 0.001)
      if (!before || !after || !mid || !next) continue
      after.homeIds?.forEach((id, k) => {
        const j = before.homeIds?.indexOf(id) ?? -1
        if (j < 0 || next.homeIds?.[k] !== id || mid.homeIds?.[k] !== id) return
        const dx = (after.home[k]!.x - before.home[j]!.x) * 100
        const dy = (after.home[k]!.y - before.home[j]!.y) * 42.5
        worstJumpFt = Math.max(worstJumpFt, Math.hypot(dx, dy))
        // mid-segment must lie between the ends along the direction of travel
        const sx = (next.home[k]!.x - after.home[k]!.x) * 100
        const sy = (next.home[k]!.y - after.home[k]!.y) * 42.5
        const seg = Math.hypot(sx, sy)
        if (seg > 1.5) {
          const along = ((mid.home[k]!.x - after.home[k]!.x) * 100 * sx + (mid.home[k]!.y - after.home[k]!.y) * 42.5 * sy) / seg
          if (along < -0.25) backtracks++
        }
        checked++
      })
    }
    expect(checked).toBeGreaterThan(200)
    // ~0.002 s either side of a knot at ≤ 35 ft/s is well under 0.2 ft
    expect(worstJumpFt).toBeLessThan(0.5)
    expect(backtracks / checked).toBeLessThan(0.01)
  })

  it('final score matches the engine outcome', () => {
    const { tl, out } = buildTimeline(3)
    expect(tl.homeFinal).toBe(out.homeGoals)
    expect(tl.awayFinal).toBe(out.awayGoals)
  })

  it('samples interpolated positions within the rink at any time', () => {
    const { tl } = buildTimeline(3)
    for (const f of [0, 0.13, 0.5, 0.77, 1]) {
      const snap = tl.sampleAt(f * tl.duration)
      expect(snap).not.toBeNull()
      // Skater counts vary: 3v3 OT, 4v5/5v4 PP/PK, 5v5 EV, 6-skater goalie pull.
      expect(snap!.home.length).toBeGreaterThanOrEqual(3)
      expect(snap!.home.length).toBeLessThanOrEqual(6)
      expect(snap!.away.length).toBeGreaterThanOrEqual(3)
      expect(snap!.away.length).toBeLessThanOrEqual(6)
      for (const p of [...snap!.home, ...snap!.away, snap!.puck, snap!.homeGoalie]) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1.001)
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1.001)
      }
    }
  })

  it('score is monotonic and ends at the final score', () => {
    const { tl } = buildTimeline(3)
    let prev = 0
    for (let i = 0; i <= 20; i++) {
      const s = tl.scoreAt((i / 20) * tl.duration)
      expect(s.home + s.away).toBeGreaterThanOrEqual(prev)
      prev = s.home + s.away
    }
    const end = tl.scoreAt(tl.duration)
    expect(end.home).toBe(tl.homeFinal)
    expect(end.away).toBe(tl.awayFinal)
  })

  it('counts the period clock down from 20:00', () => {
    const { tl } = buildTimeline(3)
    expect(tl.clockAt(0)).toEqual({ period: 1, text: '20:00' })
    expect(tl.clockAt(absTime(1, 600)).text).toBe('10:00')
    expect(tl.clockAt(absTime(2, 0)).period).toBe(2)
  })
})

// ── Puck stoppage snap tests ───────────────────────────────────────────────────
//
// Verifies that sampleAt() snaps the puck position at whistle/faceoff boundaries
// instead of lerping it across the ice (which caused a visible mid-ice slide).

/**
 * Build a minimal synthetic MatchTimeline with:
 *   - Two frame events, one before and one after a stoppage.
 *   - A whistle or faceoff event between the two frames.
 *   - Puck in far-apart positions (simulating a goal-to-faceoff reset).
 */
function buildStoppageTimeline(stoppageType: 'whistle' | 'faceoff'): MatchTimeline {
  // Frame A at t=100 (puck near left goal)
  const frameA = {
    type: 'frame' as const,
    period: 1,
    t: 100,
    home: [{ player: 'p1', pos: { x: -0.5, y: 0 } }],
    away: [{ player: 'p2', pos: { x: 0.5, y: 0 } }],
    homeGoalie: { player: 'g1', pos: { x: -0.9, y: 0 } },
    awayGoalie: { player: 'g2', pos: { x: 0.9, y: 0 } },
    puck: { x: -0.85, y: 0.1 },   // near left goal
    puckCarrier: null,
  }

  // Frame B at t=110 (puck at center-ice faceoff dot after reset)
  const frameB = {
    type: 'frame' as const,
    period: 1,
    t: 110,
    home: [{ player: 'p1', pos: { x: -0.3, y: 0 } }],
    away: [{ player: 'p2', pos: { x: 0.3, y: 0 } }],
    homeGoalie: { player: 'g1', pos: { x: -0.9, y: 0 } },
    awayGoalie: { player: 'g2', pos: { x: 0.9, y: 0 } },
    puck: { x: 0.0, y: 0.0 },     // center-ice faceoff dot
    puckCarrier: null,
  }

  // Stoppage at t=105 (between the two frames)
  const stoppage = stoppageType === 'whistle'
    ? { type: 'whistle' as const, period: 1, t: 105, pos: { x: -0.85, y: 0.1 } }
    : { type: 'faceoff' as const, period: 1, t: 105, zone: 'neutral' as const, winner: 'p1', pos: { x: 0, y: 0 } }

  const stream: GameStream = [frameA, stoppage, frameB]
  return new MatchTimeline(stream, (id) => id === 'p1' || id === 'g1')
}

describe('puck stoppage snap (sampleAt)', () => {
  for (const stoppageType of ['whistle', 'faceoff'] as const) {
    describe(`with ${stoppageType}`, () => {
      it('puck snaps — no mid-ice value between the two frame positions', () => {
        const tl = buildStoppageTimeline(stoppageType)
        // Frame A: t=100 (absT=100), frame B: t=110 (absT=110), stoppage at t=105 (absT=105).
        // Sample at t=107 — between the frames but after the stoppage → should give frameB puck.
        const snap = tl.sampleAt(107)
        expect(snap).not.toBeNull()
        const puck = snap!.puck
        // Must be exactly frame B's puck position (snapped), not anywhere in between.
        expect(puck.x).toBeCloseTo(0.0, 5)
        expect(puck.y).toBeCloseTo(0.0, 5)
      })

      it('puck uses frameA position before the stoppage', () => {
        const tl = buildStoppageTimeline(stoppageType)
        // Sample at t=102 — between frames A and B but BEFORE the stoppage at t=105.
        const snap = tl.sampleAt(102)
        expect(snap).not.toBeNull()
        const puck = snap!.puck
        // Must use frame A's puck (before the whistle blew).
        expect(puck.x).toBeCloseTo(-0.85, 5)
        expect(puck.y).toBeCloseTo(0.1, 5)
      })

      it('no mid-ice puck position exists between the frames', () => {
        const tl = buildStoppageTimeline(stoppageType)
        // Sample many points between t=100 and t=110.
        // The puck should never be at a lerped mid-ice value (e.g. x ≈ -0.4).
        for (let t = 100.5; t < 110; t += 0.5) {
          const snap = tl.sampleAt(t)
          expect(snap).not.toBeNull()
          const px = snap!.puck.x
          // The puck must be either near frameA (-0.85) or frameB (0.0) — never in between
          const isAtA = Math.abs(px - (-0.85)) < 0.01
          const isAtB = Math.abs(px - 0.0) < 0.01
          expect(isAtA || isAtB).toBe(true)
        }
      })
    })
  }

  it('normal lerp still applies when no stoppage is between frames', () => {
    // Two frames with no stoppage — puck should lerp normally.
    const frameA = {
      type: 'frame' as const, period: 1, t: 0,
      home: [{ player: 'p1', pos: { x: 0, y: 0 } }],
      away: [{ player: 'p2', pos: { x: 0, y: 0 } }],
      homeGoalie: { player: 'g1', pos: { x: -0.9, y: 0 } },
      awayGoalie: { player: 'g2', pos: { x: 0.9, y: 0 } },
      puck: { x: -0.5, y: 0 },
      puckCarrier: null,
    }
    const frameB = {
      type: 'frame' as const, period: 1, t: 10,
      home: [{ player: 'p1', pos: { x: 0, y: 0 } }],
      away: [{ player: 'p2', pos: { x: 0, y: 0 } }],
      homeGoalie: { player: 'g1', pos: { x: -0.9, y: 0 } },
      awayGoalie: { player: 'g2', pos: { x: 0.9, y: 0 } },
      puck: { x: 0.5, y: 0 },
      puckCarrier: null,
    }
    const stream: GameStream = [frameA, frameB]
    const tl = new MatchTimeline(stream, () => false)

    // At t=5 (halfway) the puck should be at x≈0 (lerped midpoint)
    const snap = tl.sampleAt(5)
    expect(snap).not.toBeNull()
    expect(snap!.puck.x).toBeCloseTo(0, 3)
  })
})
