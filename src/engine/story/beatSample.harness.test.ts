/**
 * BEAT SAMPLE HARNESS — plays the real imported league as Pittsburgh and dumps
 * the daily beat's coverage as plain text, so the prose can be READ, not just
 * counted (docs/MEDIA-BEAT.md §Verify).
 *
 * Self-skips in the normal suite. Run on demand:
 *   BEAT_RUN=1 AP_MOD_DB="K:/Hockey Game/mods/nhl-ehm/database.json" \
 *     npx vitest run src/engine/story/beatSample.harness.test.ts --no-file-parallelism
 * Env: BEAT_STEPS (default 40 steps), BEAT_TEAM (abbreviation, default PIT),
 *      BEAT_OUT (output file, default ./beat-sample.txt), BEAT_SEASON=1 (play
 *      a whole season + summer and report per-kind counts and act pieces).
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateModDatabase, loadModDatabase } from '@data'
import { generateLeague } from '@data/generate'
import { Career } from '../career/career'
import type { BeatArticle } from './beatDesk'
import { templateOf } from '../career/autopilot/flavorAudit'

const MOD_DB = process.env.AP_MOD_DB ?? join(process.cwd(), 'mods', 'nhl-ehm', 'database.json')
const SEED = Number(process.env.AP_SEED ?? 2029)

function render(a: BeatArticle, outlet: string, writer: string): string {
  const out: string[] = []
  out.push(`────────────────────────────────────────────────────────────`)
  out.push(`[${a.kind.toUpperCase()}] ${a.dateISO}${a.inbox ? '  (also in the inbox)' : ''}`)
  out.push(a.headline)
  out.push(`  ${a.dek}`)
  out.push(`  By ${writer}, ${outlet}`)
  for (const p of a.body) out.push(`  ${p}`)
  for (const g of a.grades ?? []) out.push(`    ${g.grade.padEnd(2)}  ${g.name} (${g.pos}) — ${g.note}`)
  for (const q of a.qa ?? []) {
    out.push(`  Q ${q.handle}: ${q.question}`)
    out.push(`  A: ${q.answer}`)
  }
  for (const s of a.sections ?? []) {
    out.push(`  ${s.title.toUpperCase()}`)
    for (const l of s.lines) out.push(`    · ${l}`)
  }
  return out.join('\n')
}

describe.skipIf(!process.env.BEAT_RUN)('beat sample — the daily beat on the real league', () => {
  it('dumps a week of coverage', () => {
    const data = existsSync(MOD_DB)
      ? loadModDatabase(validateModDatabase(JSON.parse(readFileSync(MOD_DB, 'utf8'))), { seed: SEED })
      : generateLeague({ seed: SEED })
    const abbr = process.env.BEAT_TEAM ?? 'PIT'
    const tid = data.league.teams.find((t) => data.teams.get(t)?.abbreviation === abbr) ?? data.league.teams[0]!
    const career = new Career(data, SEED, tid)
    const steps = Number(process.env.BEAT_STEPS ?? 40)
    const pressers: string[] = []
    const season = process.env.BEAT_SEASON === '1'
    const startYear = career.year
    for (let i = 0; season ? career.year === startYear || career.seasonPhase !== 'regularSeason' : i < steps; i++) {
      if (i > 2000) break
      const pc = career.getPressConference()
      if (pc) {
        const opt = pc.options?.[(i % Math.max(1, pc.options.length))]
        pressers.push(`PRESSER (${pc.askedBy?.name ?? pc.personaId}, ${pc.askedBy?.outlet ?? ''}) — ${pc.context}\n  Q: ${pc.question}\n` +
          (pc.options ?? []).map((o) => `   [${o.id}] ${o.label}  — ${o.hint}`).join('\n') + `\n  → answered: ${opt?.id ?? 'tone'}`)
        career.answerPressConference('', opt?.tone ?? 'measured', opt?.id)
      }
      try {
        if (!career.step()) {
          // Draft day and other holds: let the staff handle it.
          const c = career as unknown as { advanceDraft?: () => void; autoDraftForUser?: () => void }
          if (career.seasonPhase === 'offseason') c.advanceDraft?.()
          if (!career.step()) break
        }
      } catch (e) {
        pressers.push(`(step error: ${(e as Error).message})`)
        break
      }
    }
    const beat = career.getBeat()
    const lines: string[] = []
    lines.push(`${beat.outlet} — ${beat.tagline}`)
    lines.push(`Writer: ${beat.writer.name} (@${beat.writer.handle}) · ${beat.market.label} · standing: ${beat.standing ?? '—'}`)
    lines.push(`Articles: ${beat.articles.length}`)
    const byKind = new Map<string, number>()
    for (const a of beat.articles) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1)
    lines.push(`By kind: ${[...byKind.entries()].map(([k, n]) => `${k} ${n}`).join(' · ')}`)
    const shapes = new Map<string, number>()
    for (const a of beat.articles) shapes.set(templateOf(a.headline), (shapes.get(templateOf(a.headline)) ?? 0) + 1)
    const top = [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    lines.push(`Top headline shapes: ${top.map(([t, n]) => `${n}× "${t}"`).join(' | ')}`)
    const verbatim = new Map<string, number>()
    for (const a of beat.articles) verbatim.set(a.headline, (verbatim.get(a.headline) ?? 0) + 1)
    lines.push(`Verbatim repeats: ${[...verbatim.values()].filter((n) => n > 1).length}`)
    for (const [h, n] of [...verbatim.entries()].filter(([, n]) => n > 1).slice(0, 20)) lines.push(`   ${n}x ${h}`)
    lines.push('')
    lines.push(...pressers)
    lines.push('')
    const show = season ? beat.articles.filter((a) => a.kind === 'feature' || a.kind === 'hotSeat' || a.kind === 'claim' || a.kind === 'mailbag').slice(0, 30) : beat.articles
    for (const a of [...show].reverse()) lines.push(render(a, beat.outlet, beat.writer.name))
    const other = career.getBeat(data.league.teams.find((t) => t !== tid)!)
    lines.push('')
    lines.push(`=== Lighter coverage: ${other.outlet} (${other.teamName}) ===`)
    for (const a of other.articles) lines.push(render(a, other.outlet, other.writer.name))
    const feed = career.getFeed()
    const teasers = feed.posts.filter((p) => p.authorId === beat.authorId).slice(0, 10)
    lines.push('')
    lines.push(`=== Feed link posts (${teasers.length} shown) ===`)
    for (const p of teasers) lines.push(`${p.headline}: ${p.body}${p.articleId ? '  [read →]' : ''}`)
    const insider = feed.posts.filter((p) => p.authorId === 'insider' && p.category === 'injury').slice(0, 5)
    for (const p of insider) lines.push(`${p.headline}: ${p.body}`)
    const radar = feed.posts.filter((p) => p.authorId === 'analyst' && /hot seat|pressure|phone is not ringing/i.test(p.body)).slice(0, 3)
    for (const p of radar) lines.push(`${p.headline}: ${p.body}`)
    const inbox = career.getInbox().items.filter((i) => i.press?.kind?.startsWith('beat'))
    lines.push('')
    lines.push(`=== Beat items in the inbox: ${inbox.length} ===`)
    for (const i of inbox) lines.push(`${i.headline}`)
    const mc = career.getMediaCircuit()
    lines.push('')
    lines.push(`=== Media circuit ===`)
    for (const r of mc.rows) lines.push(`${r.name} (${r.outlet}): ${r.standing} ${r.rapport} — ${r.read}`)
    writeFileSync(process.env.BEAT_OUT ?? join(process.cwd(), 'beat-sample.txt'), lines.join('\n'))
    expect(beat.articles.length).toBeGreaterThan(0)
  }, 3_600_000)
})
