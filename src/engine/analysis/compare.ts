/**
 * compare(distributions, targets) → Scorecard: every metric with our value, the
 * target, its pass band, pass/fail, and the trend against the previous run.
 */
import type { GameMetrics } from './analyze'
import { tvd } from './hist'
import { METRICS, UNOBSERVABLE, type MetricGroup } from './metrics'

/**
 * How much to trust a target:
 *   measured   — derived from real NHL data (aggregates only).
 *   derived    — arithmetic on measured aggregates.
 *   published  — a public figure noted by hand from a cited source.
 *   estimate   — expert/physics estimate; wide band; replace when data allows.
 *   design     — an owner/design requirement rather than an NHL fact.
 */
export type Confidence = 'measured' | 'derived' | 'published' | 'estimate' | 'design'

export interface MetricTarget {
  /** Point target (null for band-only). */
  value: number | null
  band: [number, number]
  source: string
  confidence: Confidence
  note?: string
}

export interface MatchTargets {
  meta: { generated: string; note: string }
  sources: Record<string, { title: string; url?: string; license: string; dateRange?: string; use: string }>
  metrics: Record<string, MetricTarget>
  /** NHL unblocked-attempt counts on the distance×angle grid (row = distance bin). */
  shotGrid?: { distanceEdges: number[]; angleEdges: number[]; attempts: number[][] }
}

export type Verdict = 'pass' | 'fail' | 'info' | 'n/a'

export interface ScorecardRow {
  id: string
  group: MetricGroup
  label: string
  unit: string
  digits: number
  headline: boolean
  ours: number | null
  target: MetricTarget | null
  verdict: Verdict
  /** Change vs the previous run's value (ours − prev), null if unknown. */
  delta: number | null
  /** Did the change move toward the band (+1), away (−1), or neither (0)? */
  trend: -1 | 0 | 1 | null
}

export interface Scorecard {
  generated: string
  games: number
  minutes: number
  rows: ScorecardRow[]
  unobservable: typeof UNOBSERVABLE
  summary: { pass: number; fail: number; info: number; na: number }
}

function binCentres(edges: readonly number[]): number[] {
  const c: number[] = []
  for (let i = 0; i < edges.length - 1; i++) c.push((edges[i] + Math.min(edges[i + 1], edges[i] + 60)) / 2)
  return c
}

/** Mean distance from a distance×angle grid via bin centres. */
function gridMeanDist(cells: readonly number[], cols: number, dEdges: readonly number[]): number {
  const cen = binCentres(dEdges)
  let s = 0
  let n = 0
  for (let r = 0; r < dEdges.length - 1; r++)
    for (let c = 0; c < cols; c++) {
      const v = cells[r * cols + c] ?? 0
      s += v * cen[r]
      n += v
    }
  return n > 0 ? s / n : NaN
}

function bandDistance(v: number, band: [number, number]): number {
  return v < band[0] ? band[0] - v : v > band[1] ? v - band[1] : 0
}

export function compare(
  dist: GameMetrics,
  targets: MatchTargets,
  previous?: { rows: { id: string; ours: number | null }[] } | null
): Scorecard {
  const prevById = new Map<string, number | null>((previous?.rows ?? []).map((r) => [r.id, r.ours]))
  const rows: ScorecardRow[] = []
  for (const def of METRICS) {
    let v = def.compute(dist)
    if (def.id === 'shots.locationTvd' || def.id === 'shots.meanDist') {
      const grid = dist.grids['shot.distAngle']
      const ref = targets.shotGrid
      if (def.id === 'shots.locationTvd') {
        v = ref && grid ? tvd(grid.cells, ref.attempts.flat()) : NaN
      } else if (grid) {
        v = gridMeanDist(grid.cells, grid.cols, dist.shotBins.distanceEdges)
      }
    }
    const ours = Number.isFinite(v) ? v : null
    const target = targets.metrics[def.id] ?? null
    let verdict: Verdict
    if (ours === null) verdict = 'n/a'
    else if (!target) verdict = 'info'
    else verdict = ours >= target.band[0] && ours <= target.band[1] ? 'pass' : 'fail'
    const prev = prevById.get(def.id)
    const delta = ours !== null && prev !== undefined && prev !== null ? ours - prev : null
    let trend: ScorecardRow['trend'] = null
    if (delta !== null && target && prev !== null && prev !== undefined && ours !== null) {
      const before = bandDistance(prev, target.band)
      const after = bandDistance(ours, target.band)
      trend = after < before - 1e-9 ? 1 : after > before + 1e-9 ? -1 : 0
    }
    rows.push({
      id: def.id,
      group: def.group,
      label: def.label,
      unit: def.unit,
      digits: def.digits,
      headline: def.headline ?? false,
      ours,
      target,
      verdict,
      delta,
      trend
    })
  }
  // NHL reference mean shot distance (same bin-centre estimator) goes in as the target value.
  const md = rows.find((r) => r.id === 'shots.meanDist')
  if (md && targets.shotGrid && !md.target) {
    const ref = targets.shotGrid
    const nhl = gridMeanDist(ref.attempts.flat(), ref.angleEdges.length - 1, ref.distanceEdges)
    md.target = { value: nhl, band: [nhl * 0.88, nhl * 1.12], source: 'nhlApiLegacy', confidence: 'derived', note: 'NHL unblocked attempts (incl. misses); ours are SOG only' }
    if (md.ours !== null) md.verdict = md.ours >= md.target.band[0] && md.ours <= md.target.band[1] ? 'pass' : 'fail'
  }
  const summary = { pass: 0, fail: 0, info: 0, na: 0 }
  for (const r of rows) {
    if (r.verdict === 'pass') summary.pass++
    else if (r.verdict === 'fail') summary.fail++
    else if (r.verdict === 'info') summary.info++
    else summary.na++
  }
  return { generated: new Date().toISOString(), games: dist.games, minutes: dist.minutes, rows, unobservable: UNOBSERVABLE, summary }
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

function fmt(v: number | null, digits: number): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

const GROUP_TITLES: Record<MetricGroup, string> = {
  kinematics: 'Skating kinematics',
  shape: 'Team shape',
  possession: 'Possession & passing',
  entries: 'Zone entries',
  shots: 'Shots',
  physical: 'Physical play',
  flow: 'Flow & rhythm',
  goalie: 'Goaltending',
  motion: 'Motion quality (analyzer side)',
  shapeSim: 'Shape similarity vs coaching-system templates'
}

function rowLine(r: ScorecardRow): string {
  const t = r.target
  const nhl = t ? (t.value !== null ? fmt(t.value, r.digits) : '—') : '—'
  const band = t ? `${fmt(t.band[0], r.digits)} – ${fmt(t.band[1], r.digits)}` : '—'
  const verdict = r.verdict === 'pass' ? 'PASS' : r.verdict === 'fail' ? '**FAIL**' : r.verdict === 'info' ? 'info' : 'n/a'
  const trend =
    r.delta === null ? '—' : `${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(r.digits)}${r.trend === 1 ? ' ↑' : r.trend === -1 ? ' ↓' : ''}`
  const conf = t ? t.confidence : ''
  return `| ${r.label} | ${fmt(r.ours, r.digits)} ${r.unit} | ${nhl} | ${band} | ${verdict} | ${trend} | ${conf} |`
}

export function scorecardMarkdown(sc: Scorecard, header: string, sources: MatchTargets['sources']): string {
  const L: string[] = []
  L.push(header.trim(), '')
  L.push(
    `**${sc.summary.pass} pass · ${sc.summary.fail} fail · ${sc.summary.info} info · ${sc.summary.na} n/a** over ${sc.games} games (${sc.minutes.toFixed(0)} game-minutes). Generated ${sc.generated}.`,
    ''
  )
  L.push('Trend column: change vs the previous committed run (↑ moved toward the band, ↓ moved away). Confidence: measured > derived > published > estimate > design — see docs/MATCH-DATA-SOURCES.md.', '')
  const head = '| Metric | Ours | NHL / target | Band | Verdict | Trend | Confidence |\n|---|---|---|---|---|---|---|'
  L.push('## Headlines', '', head)
  for (const r of sc.rows.filter((x) => x.headline)) L.push(rowLine(r))
  L.push('')
  const groups = [...new Set(sc.rows.map((r) => r.group))]
  for (const g of groups) {
    L.push(`## ${GROUP_TITLES[g]}`, '', head)
    for (const r of sc.rows.filter((x) => x.group === g)) L.push(rowLine(r))
    L.push('')
  }
  L.push('## Not observable yet (needs additive event fields)', '', '| Metric | What the engine would need to emit |', '|---|---|')
  for (const u of sc.unobservable) L.push(`| ${u.label} | ${u.needs} |`)
  L.push('', '## Target sources', '')
  for (const [id, s] of Object.entries(sources)) {
    L.push(`- **${id}** — ${s.title}${s.url ? ` (${s.url})` : ''}. License: ${s.license}.${s.dateRange ? ` Range: ${s.dateRange}.` : ''} Use: ${s.use}`)
  }
  L.push('')
  return L.join('\n')
}
