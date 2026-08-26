/**
 * LEVER AUDIT HARNESS (task #154) — STANDALONE, excluded from `npm test`.
 *
 * Sims tens of thousands of mirror games to measure every GM lever's real
 * effect on results, then writes the measured table into docs/LEVER-AUDIT.md.
 * Takes tens of minutes (the full engine is ~73 ms/game), which is why it does
 * not run in the normal suite. The durable regression protection lives in
 * leverGuard.test.ts, which is in the suite.
 *
 * Run:
 *   LEVER_AUDIT=1 npx vitest run src/engine/audit/leverAudit.harness.test.ts --no-file-parallelism --reporter=verbose
 *
 * Env knobs:
 *   LEVER_QUICK_N   games per quick-sim arm   (default 20000, ~5 s each)
 *   LEVER_FULL_N    games per full-sim arm    (default 2000,  ~2.5 min each)
 *   LEVER_ONLY      comma-separated lever ids to run (default: all)
 */
import { writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONDITION_LEVERS, FULL_LEVERS, NULL_LEVER, NULL_LEVER_FULL, QUICK_LEVERS } from './leverCatalog'
import { measureLever, type LeverResult } from './leverLab'

const ENABLED = process.env.LEVER_AUDIT === '1'
const QUICK_N = Number(process.env.LEVER_QUICK_N ?? 20_000)
const FULL_N = Number(process.env.LEVER_FULL_N ?? 2_000)
const ONLY = process.env.LEVER_ONLY?.split(',').map((s) => s.trim()).filter(Boolean)

function row(r: LeverResult): string {
  const n = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : '—')
  const signed = (x: number, d = 1): string => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—')
  return [
    r.spec.name,
    r.spec.contrast,
    r.games,
    signed(r.seasonPoints),
    `${signed(r.seasonPointsLo)} … ${signed(r.seasonPointsHi)}`,
    n(r.z, 1),
    signed(r.detectionFloor),
    signed(r.shotsPerGameDelta),
    signed(r.xgPerGameDelta, 2),
    r.verdict,
  ].join(' | ')
}

describe('lever audit harness (#154)', () => {
  it.runIf(ENABLED)('measures every game-outcome lever and writes the table', () => {
    const wanted = (id: string): boolean => !ONLY || ONLY.includes(id)
    const results: LeverResult[] = []

    const run = (specs: typeof QUICK_LEVERS, games: number): void => {
      for (const spec of specs) {
        if (!wanted(spec.id)) continue
        const t0 = Date.now()
        const r = measureLever(spec, games)
        results.push(r)
        // eslint-disable-next-line no-console
        console.log(
          `[${((Date.now() - t0) / 1000).toFixed(0)}s] ${spec.id.padEnd(20)} ` +
            `${(r.seasonPoints >= 0 ? '+' : '') + r.seasonPoints.toFixed(1)} pts/82 ` +
            `(z=${r.z.toFixed(1)}, floor ±${r.detectionFloor.toFixed(1)}) → ${r.verdict}`,
        )
      }
    }

    run([NULL_LEVER, ...QUICK_LEVERS, ...CONDITION_LEVERS], QUICK_N)
    run([NULL_LEVER_FULL, ...FULL_LEVERS], FULL_N)

    const header =
      '| Lever | Contrast | Games | Δ pts / 82 | 95% CI | z | Detection floor | Δ shots/g | Δ xG/g | Verdict |\n' +
      '| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |'
    const table = [header, ...results.map((r) => `| ${row(r)} |`)].join('\n')
    // JSON so parallel shards can be merged; the markdown is for eyeballing.
    const out = resolvePath(process.cwd(), process.env.LEVER_OUT ?? 'docs/lever-audit-measured.json')
    writeFileSync(
      out,
      JSON.stringify(
        results.map((r) => ({ ...r, spec: { id: r.spec.id, name: r.spec.name, surface: r.spec.surface, engine: r.spec.engine, contrast: r.spec.contrast } })),
        null,
        2,
      ),
      'utf8',
    )
    // eslint-disable-next-line no-console
    console.log(`\nwrote ${out}\n\n${table}`)

    // The rig must read zero when nothing is moved.
    for (const r of results) {
      if (!r.spec.id.startsWith('null-control')) continue
      expect(Math.abs(r.z), `${r.spec.id} bias`).toBeLessThan(2.5)
    }
  }, 6 * 60 * 60 * 1000)
})
