/**
 * AUTOPILOT HARNESS — entry point that builds a league (the real imported
 * 32-team DB when present, else the vanilla fictional league), plays N full
 * seasons chasing the Cup via {@link runAutopilot}, and writes the trace +
 * a live NDJSON stream + a quick markdown summary to `docs/autopilot/`.
 *
 * Excluded from the normal suite (it sims minutes) — run it explicitly:
 *   PATH="/c/Program Files/nodejs:$PATH" \
 *     npx vitest run src/engine/career/autopilot/run.harness.test.ts --no-file-parallelism
 *
 * Config via env:  AP_SEASONS (default 3)  ·  AP_SEED (default 2029)  ·  AP_TEAM (index, default auto)
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { generateLeague } from '@data/generate'
import type { LeagueData } from '@data/generate'
import { validateModDatabase, loadModDatabase } from '@data'
import { Career } from '../career'
import { runAutopilot } from './autopilot'

const SEED = Number(process.env.AP_SEED ?? 2029)
const SEASONS = Number(process.env.AP_SEASONS ?? 3)
const OUT_DIR = join(process.cwd(), 'docs', 'autopilot')
const MOD_DB = join(process.cwd(), 'mods', 'nhl-ehm', 'database.json')

function loadLeague(): { data: LeagueData; source: string } {
  if (existsSync(MOD_DB)) {
    try {
      const db = validateModDatabase(JSON.parse(readFileSync(MOD_DB, 'utf8')))
      return { data: loadModDatabase(db, { seed: SEED }), source: `imported: ${db.meta?.name ?? 'nhl-ehm'} (32-team)` }
    } catch (e) {
      // fall through to vanilla if the import can't be read
      console.warn(`[autopilot] mod DB present but failed to load (${(e as Error).message}); using vanilla`)
    }
  }
  return { data: generateLeague({ seed: SEED }), source: 'vanilla generated league' }
}

// Self-skips under the normal suite (it sims minutes). Run on demand with AP_RUN=1:
//   AP_RUN=1 AP_SEASONS=3 npx vitest run src/engine/career/autopilot/run.harness.test.ts --no-file-parallelism
describe.skipIf(!process.env.AP_RUN)('autopilot — Cup campaign', () => {
  it(`plays ${SEASONS} season(s) and reports`, () => {
    const { data, source } = loadLeague()
    // Pick a mid-pack contender to make the Cup chase interesting + deterministic.
    const teamIdx = process.env.AP_TEAM != null ? Number(process.env.AP_TEAM) : Math.min(3, data.league.teams.length - 1)
    const userTid = data.league.teams[teamIdx]!
    const career = new Career(data, SEED, userTid)

    mkdirSync(OUT_DIR, { recursive: true })
    const liveFile = join(OUT_DIR, 'trace-live.ndjson')
    writeFileSync(liveFile, '') // reset the live stream

    const trace = runAutopilot(career, {
      seasons: SEASONS,
      source,
      onEvent: (ev) => appendFileSync(liveFile, JSON.stringify(ev) + '\n'),
    })

    writeFileSync(join(OUT_DIR, 'trace-latest.json'), JSON.stringify(trace, null, 2))
    writeFileSync(join(OUT_DIR, 'summary-latest.md'), renderSummary(trace))

    // Print the headline to stdout so the run is legible in the terminal.
    console.log(`\n=== AUTOPILOT: ${trace.meta.userTeamName} · ${trace.meta.leagueName} (${source}) ===`)
    console.log(`seasons played: ${trace.meta.seasonsPlayed}/${SEASONS} · Cups: ${trace.summary.cups} · best finish: ${trace.summary.bestFinish}`)
    console.log(`decisions: ${trace.decisions.length} · trades: ${trace.summary.totalTrades} · signings: ${trace.summary.totalSignings} · drafted: ${trace.summary.totalDrafted}`)
    console.log(`ISSUES → critical: ${trace.summary.critical} · major: ${trace.summary.major} · minor: ${trace.summary.minor}${trace.summary.endedEarly ? ` · ENDED EARLY: ${trace.summary.endReason}` : ''}`)
    for (const s of trace.seasons) {
      console.log(`  ${s.year}: ${s.record ?? '—'} · ${s.playoffResult} · ${s.trades} trades · issues C${s.critical}/M${s.major}`)
    }
    console.log(`\nwrote docs/autopilot/trace-latest.json + summary-latest.md\n`)

    // The harness is a bug-hunter, not a pass/fail gate — it just must have played.
    expect(trace.meta.seasonsPlayed).toBeGreaterThan(0)
    expect(trace.decisions.length).toBeGreaterThan(0)
  }, 1_800_000)
})

function renderSummary(t: ReturnType<typeof runAutopilot>): string {
  const L: string[] = []
  L.push(`# Autopilot — ${t.meta.userTeamName}`)
  L.push('')
  L.push(`League: ${t.meta.leagueName} · ${t.meta.teams} teams · ${t.meta.source} · seed ${t.meta.seed}`)
  L.push(`Seasons: ${t.meta.seasonsPlayed}/${t.meta.seasonsRequested} · **Cups: ${t.summary.cups}** · best finish: **${t.summary.bestFinish}**`)
  L.push(`Decisions: ${t.decisions.length} · trades ${t.summary.totalTrades} · signings ${t.summary.totalSignings} · drafted ${t.summary.totalDrafted}`)
  L.push(`Issues: **${t.summary.critical} critical**, ${t.summary.major} major, ${t.summary.minor} minor${t.summary.endedEarly ? ` — ⚠ ended early: ${t.summary.endReason}` : ''}`)
  L.push('')
  L.push('## Season by season')
  for (const s of t.seasons) {
    L.push(`- **${s.year}** — ${s.record ?? '—'} (${s.points ?? '?'} pts, #${s.rank ?? '?'}) → ${s.playoffResult}${s.wonCup ? ' 🏆' : ''} · ${s.trades} trades, ${s.signings} signings, ${s.drafted} picks · issues C${s.critical}/M${s.major}/m${s.minor}`)
  }
  L.push('')
  if (t.issues.length) {
    L.push('## Issues (top 40 by severity)')
    const order = { critical: 0, major: 1, minor: 2 } as const
    const sorted = [...t.issues].sort((a, b) => order[a.severity] - order[b.severity])
    for (const i of sorted.slice(0, 40)) L.push(`- \`${i.severity}\` [${i.category}] season ${i.season} d${i.day}: ${i.message}${i.context ? ` — _${i.context}_` : ''}`)
    L.push('')
  }
  return L.join('\n')
}
