/**
 * LEVER GUARD (task #154) — the tripwire under every lever the audit certified
 * as REAL.
 *
 * docs/LEVER-AUDIT.md is a photograph of one afternoon. This is the alarm that
 * goes off when a lever quietly stops mattering, which is how Esports Manager
 * 2026 ended up shipping "many tactical options but most of them do not make any
 * difference". Each case re-measures a certified lever with enough games to have
 * real statistical power and asserts it still moves results in the right
 * direction by roughly the right amount.
 *
 * Bounds are deliberately WIDE (they catch a lever going dead or exploding, not
 * a 10% calibration drift) and every case runs on the quick sim, which is the
 * engine that plays the GM's games unless he explicitly watches them.
 *
 * If one of these fails: the lever changed. Re-run the full harness
 * (LEVER_AUDIT=1 …/leverAudit.harness.test.ts) and update docs/LEVER-AUDIT.md
 * with the new numbers — do not just widen the bound.
 */
import { describe, expect, it } from 'vitest'
import { CONDITION_LEVERS, NULL_LEVER, QUICK_LEVERS } from './leverCatalog'
import { measureLever, type LeverSpec } from './leverLab'

const byId = (id: string): LeverSpec => {
  const s = [...QUICK_LEVERS, ...CONDITION_LEVERS].find((x) => x.id === id)
  if (!s) throw new Error(`unknown lever ${id}`)
  return s
}

/**
 * Certified REAL levers with the season-points band each must stay inside.
 * `games` is set per lever so its 95% interval is tight enough to prove the
 * effect is really there — a lever is never asserted at a precision the sample
 * cannot deliver.
 */
const CERTIFIED: Array<{ id: string; games: number; lo: number; hi: number }> = [
  // Measured +24.1 pts/82 over 40k games. The biggest lever in the game.
  { id: 'q-line-assembly', games: 3_000, lo: 14, hi: 36 },
  // Measured +12.1 over four rosters (10.1 / 10.6 / 13.2 / 14.6) — the pure
  // ordering decision with the dressed 18 held fixed.
  { id: 'q-line-order', games: 6_000, lo: 6, hi: 22 },
  // Measured +6.5.
  { id: 'q-pp-units', games: 10_000, lo: 3, hi: 11 },
  // Measured +4.9.
  { id: 'q-pk-units', games: 10_000, lo: 2, hi: 9 },
  // Measured +4.3.
  { id: 'q-goalie-start', games: 10_000, lo: 1.5, hi: 8 },
  // Measured +3.4 across the ppEdge span a coach hire can actually produce.
  { id: 'q-pp-edge', games: 14_000, lo: 1, hi: 7 },
  // Measured +3.4.
  { id: 'q-pk-edge', games: 14_000, lo: 1, hi: 7 },
  // Measured +2.5 across the full coachFit 0→100 span.
  { id: 'q-coach-fit', games: 14_000, lo: 0.8, hi: 6 },
  // Man-management channel. Measured +11.3 / +37.9 across realistic spans.
  { id: 'c-morale', games: 6_000, lo: 5, hi: 20 },
  { id: 'c-fatigue', games: 4_000, lo: 20, hi: 60 },
]

describe('lever guard — certified levers still move results (#154)', () => {
  it('the rig itself reads zero when no lever is moved', () => {
    const r = measureLever(NULL_LEVER, 12_000)
    // A biased rig would make every other number here meaningless.
    expect(Math.abs(r.z), `null control drifted: ${r.seasonPoints.toFixed(2)} pts (z=${r.z.toFixed(1)})`).toBeLessThan(3)
  })

  for (const c of CERTIFIED) {
    const spec = byId(c.id)
    it(`${spec.name} is worth ${c.lo}–${c.hi} pts over 82 games`, () => {
      const r = measureLever(spec, c.games)
      // The lever must be significantly positive, not merely positive by luck.
      expect(
        r.seasonPointsLo,
        `${c.id}: 95% interval ${r.seasonPointsLo.toFixed(1)} … ${r.seasonPointsHi.toFixed(1)} pts ` +
          `includes zero — this lever is no longer distinguishable from doing nothing.`,
      ).toBeGreaterThan(0)
      expect(
        r.seasonPoints,
        `${c.id} measured ${r.seasonPoints.toFixed(1)} pts/82 (z=${r.z.toFixed(1)}), outside [${c.lo}, ${c.hi}]. ` +
          `The lever's real effect changed — re-run the audit harness and update docs/LEVER-AUDIT.md.`,
      ).toBeGreaterThan(c.lo)
      expect(r.seasonPoints).toBeLessThan(c.hi)
    })
  }
}, 300_000)
