/**
 * Development-lever harness (task #154). STANDALONE — excluded from `npm test`.
 *
 * Runs every development lever against BOTH cohorts it could plausibly reach:
 * the U23 players on the NHL roster (all the team practice regimen touches) and
 * the wider prospect pool (which an individual development plan follows). The
 * headroom line matters as much as the deltas: a lever aimed at players with no
 * room left to grow cannot do anything however well it is wired.
 *
 *   LEVER_AUDIT=1 npx vitest run src/engine/audit/leverDev.harness.test.ts --no-file-parallelism --reporter=verbose
 */
import { writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, it } from 'vitest'
import {
  cohortHeadroom,
  DEV_LEVERS,
  developmentCohort,
  measureDevLever,
  runDevSeason,
  type CohortKind,
  type DevLeverResult,
} from './leverDevLab'

const ENABLED = process.env.LEVER_AUDIT === '1'
const sig = (x: number): string => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : '—')

describe('development lever harness (#154)', () => {
  it.runIf(ENABLED)('measures every development lever on both cohorts', () => {
    const out: Record<string, { headroom: number; baselineGain: number; rows: DevLeverResult[] }> = {}
    const tables: string[] = []

    for (const kind of ['nhl', 'prospects'] as CohortKind[]) {
      const cohort = developmentCohort(99, kind)
      const headroom = cohortHeadroom(cohort)
      const baseline = runDevSeason(cohort, { focus: 'balanced' })
      const rows = DEV_LEVERS.map((spec) => measureDevLever(spec, cohort))
      out[kind] = { headroom, baselineGain: baseline.ovrGain, rows }

      // eslint-disable-next-line no-console
      console.log(
        `\n=== cohort '${kind}': n=${cohort.size}  headroom=${headroom.toFixed(2)} ovr pts  ` +
          `baseline growth=${baseline.ovrGain.toFixed(2)} ovr/season`,
      )
      for (const r of rows) {
        // eslint-disable-next-line no-console
        console.log(`${r.id.padEnd(20)} ovr ${sig(r.ovrDelta)}   ${(r.targeted?.key ?? '').padEnd(14)} ${sig(r.targeted?.delta ?? NaN)}`)
      }

      const header =
        `**Cohort \`${kind}\`** — n=${cohort.size}, headroom ${headroom.toFixed(2)} ovr pts, ` +
        `baseline growth **${baseline.ovrGain.toFixed(2)} ovr/season**\n\n` +
        '| Lever | Contrast | Δ overall/season | Targeted composite | Δ targeted | Biggest side-effect |\n' +
        '| --- | --- | ---: | --- | ---: | --- |'
      tables.push(
        [
          header,
          ...rows.map((r) => {
            const side = Object.entries(r.compositeDelta)
              .filter(([k]) => k !== r.targeted?.key)
              .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0]
            return `| ${r.name} | ${r.contrast} | ${sig(r.ovrDelta)} | ${r.targeted?.key ?? '—'} | ${sig(r.targeted?.delta ?? NaN)} | ${side ? `${side[0]} ${sig(side[1])}` : '—'} |`
          }),
        ].join('\n'),
      )
    }

    const path = resolvePath(process.cwd(), process.env.LEVER_OUT ?? 'docs/lever-audit-dev.json')
    writeFileSync(path, JSON.stringify(out, null, 2), 'utf8')
    // eslint-disable-next-line no-console
    console.log(`\nwrote ${path}\n\n${tables.join('\n\n')}`)
  }, 30 * 60 * 1000)
})
