/**
 * SEASON WRAPPED harness — plays N seasons with the autopilot GM and dumps
 * every year's Wrapped as text (+ JSON for the UI preview). Self-skips in the
 * normal suite; run on demand:
 *
 *   WRAPPED_RUN=1 WRAPPED_SEASONS=3 [WRAPPED_MOD=<path to mod database.json>] \
 *   WRAPPED_OUT=<dir> npx vitest run src/engine/story/wrapped.harness.test.ts --no-file-parallelism
 *
 * With no WRAPPED_MOD the fictional generated league is used (safe to commit
 * screenshots of). A real-roster mod DB is never copied into the repo.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateLeague } from '@data/generate'
import type { LeagueData } from '@data/generate'
import { loadModDatabase, validateModDatabase } from '@data'
import { Career } from '@engine/career/career'
import { runAutopilot } from '@engine/career/autopilot/autopilot'
import type { WrappedYear } from './wrapped'

const SEED = Number(process.env.WRAPPED_SEED ?? 2029)
const SEASONS = Number(process.env.WRAPPED_SEASONS ?? 3)
const OUT = process.env.WRAPPED_OUT ?? join(process.cwd(), 'out', 'wrapped')

function league(): { data: LeagueData; source: string } {
  const mod = process.env.WRAPPED_MOD
  if (mod && existsSync(mod)) {
    const db = validateModDatabase(JSON.parse(readFileSync(mod, 'utf8')))
    return { data: loadModDatabase(db, { seed: SEED }), source: 'mod' }
  }
  return { data: generateLeague({ seed: SEED }), source: 'fictional' }
}

export function wrappedAsText(y: WrappedYear): string {
  const L: string[] = [`══════ ${y.seasonLabel} · ${y.userTeam.name} · ${y.tagline} (${y.record}) ══════`]
  for (const c of y.cards) {
    L.push('')
    L.push(`[${c.kicker}] ${c.kind}${c.weight ? ` (w${Math.round(c.weight)})` : ''}`)
    L.push(`  ${c.headline}`)
    if (c.hero) L.push(`  ▌${c.hero.value}  ${c.hero.label}`)
    if (c.body) L.push(`  ${c.body}`)
    if (c.stats?.length) L.push(`  · ${c.stats.map((s) => `${s.value} ${s.label}`).join(' · ')}`)
    for (const r of c.list ?? []) L.push(`    - ${r.label}: ${r.value}${r.sub ? ` (${r.sub})` : ''}`)
  }
  return L.join('\n')
}

describe.skipIf(!process.env.WRAPPED_RUN)('Season Wrapped harness', () => {
  it(`plays ${SEASONS} seasons and dumps every Wrapped`, () => {
    const { data, source } = league()
    const teamIdx = Number(process.env.WRAPPED_TEAM ?? Math.min(3, data.league.teams.length - 1))
    const career = new Career(data, SEED, data.league.teams[teamIdx]!)
    runAutopilot(career, { seasons: SEASONS, source })
    mkdirSync(OUT, { recursive: true })
    const years = career.getWrappedYearbook().years.map((r) => career.getWrappedYear(r.year)!).reverse()
    const text = years.map(wrappedAsText).join('\n\n\n')
    writeFileSync(join(OUT, `wrapped-${source}.txt`), text)
    writeFileSync(join(OUT, `wrapped-${source}.json`), JSON.stringify(years, null, 2))
    writeFileSync(join(OUT, `wrapped-${source}-save.json`), JSON.stringify(career.exportSnapshot('wrapped-harness', new Date().toISOString())))
    console.log(text)
    expect(years.length).toBeGreaterThan(0)
  }, Number(process.env.WRAPPED_TIMEOUT_MS ?? 3_600_000))
})
