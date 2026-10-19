/**
 * W3 S6: the puck path predictor and the per-surface puck response
 * (docs/gameplan-2026-09-28/W3-DESIGN.md items 5-6).
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player } from '@domain'
import { makeBody, puckBounce, puckOffBodies, stepPuck, type Puck } from './physics'
import { pathAt, predictPuck } from './puckPath'
import { PUCK_SURFACE, surfaceE } from './constraints'
import { CORNER_R, GOAL_X, HALF_X, HALF_Y } from './rink'

const puck = (x: number, y: number, vx: number, vy: number, z = 0, vz = 0): Puck => ({ x, y, z, vx, vy, vz, carrier: null })

/** Step a puck the way the sim does (stepPuck every 0.05 s) and keep the samples. */
function realPath(p: Puck, seconds: number): Puck[] {
  const q = { ...p }
  const out: Puck[] = [{ ...q }]
  for (let i = 0; i < Math.round(seconds / 0.05); i++) {
    if (stepPuck(q, 0.05) === 'outOfPlay') break
    out.push({ ...q })
  }
  return out
}

describe('puck path predictor (W3 S6)', () => {
  const cases: [string, Puck][] = [
    ['rim round the corner', puck(60, -38, 70, 8)],
    ['hard dump into the end boards', puck(10, 5, 85, 6)],
    ['bank pass off the side boards', puck(-20, 0, 35, 45)],
    ['chip off the glass', puck(70, 30, 30, 20, 2, 8)],
    ['wide shot round the end boards', puck(60, 10, 110, -4)],
  ]
  for (const [name, p] of cases) {
    it(`agrees with the sim's own puck step: ${name}`, () => {
      const real = realPath(p, 2.4)
      const pred = predictPuck(p, 2.4, 0.05)
      for (let i = 0; i < real.length; i++) {
        const q = pathAt(pred, i * 0.05)
        expect(Math.hypot(q.x - real[i]!.x, q.y - real[i]!.y)).toBeLessThan(1e-6)
      }
    })
  }
  it('reads the rim round the corner, not a straight slide into the boards', () => {
    const p = puck(60, -38, 70, 8)
    const pred = predictPuck(p, 1.6)
    const end = pathAt(pred, 1.6)
    // round the corner and on behind the net (a straight slide would sit in the corner at x ≈ 100)
    expect(end.x).toBeGreaterThan(GOAL_X - 2)
    expect(end.y).toBeGreaterThan(-HALF_Y + CORNER_R)
  })
})

describe('per-surface puck response (W3 S6)', () => {
  it('keeps a rim at pace round a corner, kills a hard dump into the end boards', () => {
    // a rim along the side boards into the corner: ~quarter turn
    const rim = realPath(puck(55, -42, 70, 0), 1.5)
    let after = rim[rim.length - 1]!
    for (const q of rim) if (q.x > HALF_X - CORNER_R && q.y > -HALF_Y + CORNER_R) {
      after = q
      break
    }
    const vAfter = Math.hypot(after.vx, after.vy)
    // friction alone over ~45 ft costs ~3 ft/s; the corner keeps most of the rest
    expect(vAfter).toBeGreaterThan(70 * 0.6)
    // straight into the end boards at 100 ft/s: it comes back out at under a quarter of that
    const dump = realPath(puck(80, 0, 100, 0), 0.5)
    const back = dump.find((q) => q.vx < 0)!
    expect(-back.vx).toBeLessThan(25)
    expect(-back.vx).toBeGreaterThan(8)
  })
  it('makes the glass deader than the boards, the post livelier, bodies and pads deadest', () => {
    const out = (surface: keyof typeof PUCK_SURFACE, v: number): number => {
      const p = puck(0, 0, v, 0)
      puckBounce(p, 1, 0, surface)
      return Math.hypot(p.vx, p.vy)
    }
    for (const v of [20, 60, 100]) {
      expect(out('glass', v)).toBeLessThan(out('boards', v))
      expect(out('post', v)).toBeGreaterThan(out('boards', v))
      expect(out('body', v)).toBeLessThanOrEqual(PUCK_SURFACE.body.cap)
      expect(out('pad', v)).toBeLessThan(v * 0.3)
    }
    // a soft knock bounces more than a hard one (a frozen puck is viscoelastic)
    expect(surfaceE(PUCK_SURFACE.boards, 10)).toBeGreaterThan(surfaceE(PUCK_SURFACE.boards, 90))
  })
  it('never gives the puck speed off a surface', () => {
    for (const s of Object.keys(PUCK_SURFACE) as (keyof typeof PUCK_SURFACE)[]) {
      for (let k = 0; k < 24; k++) {
        const ang = (k / 24) * Math.PI
        const p = puck(0, 0, Math.cos(ang - Math.PI / 2) * 80, Math.sin(ang - Math.PI / 2) * 80)
        const v0 = Math.hypot(p.vx, p.vy)
        puckBounce(p, 0, -1, s)
        expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(v0 + 1e-9)
      }
    }
  })
  it('stops a puck at a skater it meets: no sliding through his skates between two substeps', () => {
    const data = generateLeague({ seed: 99 })
    const pl = [...data.players.values()].find((x) => x.position !== 'G') as Player
    const b = makeBody(pl, 10, 0, 1)
    // a 90 ft/s pass that would pass straight through him inside one substep (4.5 ft)
    const p = puck(7.6, 0.2, 90, 0)
    const x0 = p.x
    const y0 = p.y
    p.x += p.vx * 0.05
    p.y += p.vy * 0.05
    const hit = puckOffBodies(p, x0, y0, 0.05, [{ b, goalie: false }])
    expect(hit).not.toBeNull()
    expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(PUCK_SURFACE.body.cap + 1e-9)
    expect(p.x).toBeLessThan(b.x)
  })
})
