/**
 * MILESTONE AUDIT HARNESS — sims N full seasons and COUNTS every milestone /
 * record headline the game fires, bucketed by detector. The question it exists
 * to answer: "is this beat rare enough to mean something?" A record that shows
 * up every season is not a record.
 *
 * Excluded from the normal suite (it sims minutes) — run it explicitly:
 *   MA_RUN=1 MA_SEASONS=5 PATH="/c/Program Files/nodejs:$PATH" \
 *     npx vitest run src/engine/story/milestoneAudit.harness.test.ts --no-file-parallelism
 *
 * Config via env:  MA_SEASONS (default 5) · MA_SEED (default 2029) · MA_TEAM (index)
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateLeague } from '@data/generate'
import type { LeagueData } from '@data/generate'
import { validateModDatabase, loadModDatabase } from '@data'
import { Career } from '../career/career'
import { runAutopilot } from '../career/autopilot/autopilot'

const SEED = Number(process.env.MA_SEED ?? 2029)
const SEASONS = Number(process.env.MA_SEASONS ?? 5)
const MOD_DB = join(process.cwd(), 'mods', 'nhl-ehm', 'database.json')

function loadLeague(): { data: LeagueData; source: string } {
  if (existsSync(MOD_DB)) {
    try {
      const db = validateModDatabase(JSON.parse(readFileSync(MOD_DB, 'utf8')))
      return { data: loadModDatabase(db, { seed: SEED }), source: `imported: ${db.meta?.name ?? 'nhl-ehm'}` }
    } catch {
      /* fall through to vanilla */
    }
  }
  return { data: generateLeague({ seed: SEED }), source: 'vanilla generated league' }
}

/** Which detector a headline came from. Null = not a milestone beat. */
function bucketOf(headline: string): string | null {
  if (/first NHL goal/i.test(headline)) return 'firstNhlGoal'
  if (/breaks the all-time league record for single-season/i.test(headline)) return 'seasonRecord:allTime'
  if (/breaks the top-3 league mark for single-season/i.test(headline)) return 'seasonRecord:top3'
  if (/breaks the all-time single-season/i.test(headline)) return 'recordBreak:inSeason'
  if (/on pace|chasing/i.test(headline) && /record/i.test(headline)) return 'recordWatch:pace'
  if (/reaches [\d,]+ career/i.test(headline)) return 'careerMilestone'
  if (/plays his [\d,]+th NHL game/i.test(headline)) return 'careerMilestone'
  return null
}

describe.skipIf(!process.env.MA_RUN)('milestone audit', () => {
  it(`counts milestone fires across ${SEASONS} season(s)`, () => {
    const { data, source } = loadLeague()
    const teamIdx = process.env.MA_TEAM != null ? Number(process.env.MA_TEAM) : Math.min(3, data.league.teams.length - 1)
    const career = new Career(data, SEED, data.league.teams[teamIdx]!)

    // Intercept every news beat at the source — the inbox itself is capped, so
    // counting the surviving list would undercount a multi-season run.
    const fires: Array<{ bucket: string; year: number; headline: string }> = []
    const self = career as unknown as {
      pushNews: (...a: unknown[]) => unknown
      year: number
    }
    const orig = self.pushNews.bind(career)
    self.pushNews = (...a: unknown[]) => {
      const headline = String(a[1] ?? '')
      const b = bucketOf(headline)
      if (b) fires.push({ bucket: b, year: self.year, headline })
      return orig(...a)
    }

    const trace = runAutopilot(career, { seasons: SEASONS, source })
    const played = trace.meta.seasonsPlayed

    const byBucket = new Map<string, number>()
    for (const f of fires) byBucket.set(f.bucket, (byBucket.get(f.bucket) ?? 0) + 1)

    const L: string[] = []
    L.push(`# Milestone audit — ${source} · seed ${SEED} · ${played} season(s)`, '')
    L.push('| detector | fires | per season |', '|---|---:|---:|')
    for (const [b, n] of [...byBucket].sort((x, y) => y[1] - x[1])) {
      L.push(`| ${b} | ${n} | ${(n / Math.max(1, played)).toFixed(1)} |`)
    }
    if (byBucket.size === 0) L.push('| (none fired) | 0 | 0 |')
    L.push('', '## Per season', '')
    for (const y of [...new Set(fires.map((f) => f.year))].sort()) {
      const per = new Map<string, number>()
      for (const f of fires.filter((x) => x.year === y)) per.set(f.bucket, (per.get(f.bucket) ?? 0) + 1)
      L.push(`- **${y}** — ${[...per].map(([b, n]) => `${b}=${n}`).join(' · ')}`)
    }
    L.push('', '## Sample headlines', '')
    for (const b of byBucket.keys()) {
      for (const s of fires.filter((f) => f.bucket === b).slice(0, 4)) L.push(`- \`${b}\` ${s.year}: ${s.headline}`)
    }
    const report = L.join('\n') + '\n'
    mkdirSync(join(process.cwd(), 'docs', 'autopilot'), { recursive: true })
    writeFileSync(join(process.cwd(), 'docs', 'autopilot', `milestone-audit-${process.env.MA_TAG ?? 'latest'}.md`), report)
    console.log('\n' + report)

    expect(played).toBeGreaterThan(0)
  }, 3_600_000)
})
