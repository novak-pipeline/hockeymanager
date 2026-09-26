/**
 * WORLD HEALTH — the league-wide half of the autopilot (docs/LIVING-WORLD-
 * ECONOMY-AND-AI.md). The autopilot plays ONE club; this records what the
 * OTHER 31 did while it played: every club's points, the champion and the
 * Presidents' Trophy, parity (points SD / Gini, distinct champions per decade,
 * 100-point streaks), every club's payroll against its ceiling and floor, the
 * trade/FA/offer-sheet volume from the career's telemetry, and each club's
 * posture. It judges the league against real-NHL bands so "the world pushes
 * back" is a number, not a feeling.
 *
 * Pure observation — reads public Career state and the non-persisted
 * telemetry; never mutates anything.
 */
import type { Career } from '../career'
import { capFloorFor, capUsedFor } from '@engine/league/contracts'
import type { SeasonTelemetry } from '@engine/league/worldTelemetry'

export interface WorldTeamSeason {
  teamId: string
  abbr: string
  points: number
  isUser: boolean
  posture?: string
  /** Payroll sampled mid-season (after camp), as a share of the ceiling. */
  capPct?: number
  belowFloor?: boolean
}

export interface WorldSeasonRecord {
  year: number
  teams: WorldTeamSeason[]
  champion: string | null
  presidents: string
  pointsSD: number
  pointsGini: number
  maxPts: number
  minPts: number
  payroll?: { medianAiPct: number; minAiPct: number; maxAiPct: number; belowFloor: number; overCap: number; cap: number }
  postures: Record<string, number>
  /** Mean overall of the league's top-200 NHL players (talent drift). */
  talent?: number
  telemetry?: SeasonTelemetry
}

export interface WorldHealthSummary {
  seasons: number
  meanPointsSD: number
  meanGini: number
  distinctChampions: number
  /** Fewest distinct champions in any rolling 10-season window (≥10 seasons only). */
  minDistinctPerDecade: number | null
  mostCups: { team: string; cups: number } | null
  longest100: { team: string; seasons: number } | null
  maxPoints: number
  /** Median of the per-season median AI payroll (% of cap). */
  medianAiPayrollPct: number | null
  /** Seasons whose median AI payroll sat inside 85–98% of the cap. */
  payrollSeasonsInBand: number
  payrollSeasonsMeasured: number
  meanBelowFloor: number
  tradesPerSeason: { aiAi: number; withUser: number; inSeason: number; deadlineDay: number; offseason: number }
  shapes: Record<string, number>
  faSignings: { ai: number; aiStars: number }
  offerSheets: { aiAi: number; aiAiWalked: number; atUser: number }
  userCups: number
}

/* ─────────────────────────── recording ─────────────────────────── */

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sd = (xs: number[]): number => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}
/** Gini coefficient of a non-negative distribution (0 = perfect parity). */
export function gini(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  const total = s.reduce((a, b) => a + b, 0)
  if (n === 0 || total === 0) return 0
  let cum = 0
  for (let i = 0; i < n; i++) cum += (i + 1) * s[i]!
  return (2 * cum) / (n * total) - (n + 1) / n
}

/** Sample every NHL club's payroll vs its ceiling/floor. Call once mid-season. */
export function samplePayroll(career: Career): Map<string, { capPct: number; belowFloor: boolean; overCap: boolean; cap: number }> {
  const out = new Map<string, { capPct: number; belowFloor: boolean; overCap: boolean; cap: number }>()
  for (const tid of career.data.league.teams) {
    const t = career.data.teams.get(tid)
    if (!t) continue
    const used = capUsedFor(t, career.data.players)
    const cap = t.finances.salaryCap
    out.set(tid as string, { capPct: used / cap, belowFloor: used < capFloorFor(cap), overCap: used > cap, cap })
  }
  return out
}

/** Record the finished regular season league-wide. Call when the offseason
 *  begins (standings + champion are still live). */
export function recordWorldSeason(
  career: Career,
  year: number,
  payroll: Map<string, { capPct: number; belowFloor: boolean; overCap: boolean; cap: number }> | undefined,
): WorldSeasonRecord {
  const st = career.getStandings()
  const po = career.getPlayoffs()
  const userId = career.userTeamId as unknown as string
  const postures: Record<string, number> = {}
  const teams: WorldTeamSeason[] = st.overall.map((r) => {
    let posture: string | undefined
    try { posture = career.clubPostureFor(r.teamId as never).posture } catch { posture = undefined }
    if (posture) postures[posture] = (postures[posture] ?? 0) + 1
    const pay = payroll?.get(r.teamId)
    return {
      teamId: r.teamId,
      abbr: r.abbreviation,
      points: r.points,
      isUser: r.teamId === userId,
      ...(posture ? { posture } : {}),
      ...(pay ? { capPct: pay.capPct, belowFloor: pay.belowFloor } : {}),
    }
  })
  const pts = teams.map((t) => t.points)
  const champName = po?.championTeamName ?? null
  const champAbbr = champName
    ? (st.overall.find((r) => r.name === champName)?.abbreviation ?? champName)
    : null
  const aiPay = [...(payroll?.entries() ?? [])].filter(([tid]) => tid !== userId).map(([, v]) => v)
  return {
    year,
    teams,
    champion: champAbbr,
    presidents: st.overall[0]?.abbreviation ?? '?',
    pointsSD: sd(pts),
    pointsGini: gini(pts),
    maxPts: Math.max(...pts),
    minPts: Math.min(...pts),
    ...(aiPay.length
      ? {
          payroll: {
            medianAiPct: median(aiPay.map((v) => v.capPct)),
            minAiPct: Math.min(...aiPay.map((v) => v.capPct)),
            maxAiPct: Math.max(...aiPay.map((v) => v.capPct)),
            belowFloor: aiPay.filter((v) => v.belowFloor).length,
            overCap: aiPay.filter((v) => v.overCap).length,
            cap: aiPay[0]!.cap,
          },
        }
      : {}),
    postures,
    talent: Math.round(career.leagueTopTalent() * 10) / 10,
  }
}

/** Attach the telemetry for each season (its offseason finishes AFTER the
 *  season record is taken, so this is merged at the end of the run). */
export function attachTelemetry(records: WorldSeasonRecord[], career: Career): void {
  const byYear = new Map(career.telemetry.all().map((t) => [t.year, t]))
  for (const r of records) {
    const t = byYear.get(r.year)
    if (t) r.telemetry = t
  }
}

/* ─────────────────────────── summary ─────────────────────────── */

export function summarizeWorld(records: WorldSeasonRecord[]): WorldHealthSummary {
  const champs = records.map((r) => r.champion).filter((c): c is string => !!c)
  const cupCount = new Map<string, number>()
  for (const c of champs) cupCount.set(c, (cupCount.get(c) ?? 0) + 1)
  const most = [...cupCount.entries()].sort((a, b) => b[1] - a[1])[0]
  let minDistinct: number | null = null
  if (records.length >= 10) {
    for (let i = 0; i + 10 <= records.length; i++) {
      const w = new Set(records.slice(i, i + 10).map((r) => r.champion).filter(Boolean))
      minDistinct = minDistinct === null ? w.size : Math.min(minDistinct, w.size)
    }
  }
  // Longest run of consecutive ≥100-point seasons by any one club.
  let longest: { team: string; seasons: number } | null = null
  const runs = new Map<string, number>()
  for (const r of records) {
    const hit = new Set(r.teams.filter((t) => t.points >= 100).map((t) => t.abbr))
    for (const t of r.teams) {
      const n = hit.has(t.abbr) ? (runs.get(t.abbr) ?? 0) + 1 : 0
      runs.set(t.abbr, n)
      if (n > 0 && (!longest || n > longest.seasons)) longest = { team: t.abbr, seasons: n }
    }
  }
  const pays = records.map((r) => r.payroll).filter((p): p is NonNullable<WorldSeasonRecord['payroll']> => !!p)
  const tele = records.map((r) => r.telemetry).filter((t): t is SeasonTelemetry => !!t)
  const shapes: Record<string, number> = {}
  for (const t of tele) for (const [k, v] of Object.entries(t.trades.byShape)) shapes[k] = (shapes[k] ?? 0) + (v ?? 0)
  const per = (f: (t: SeasonTelemetry) => number): number => Math.round((tele.length ? mean(tele.map(f)) : 0) * 10) / 10
  const userCups = records.filter((r) => r.teams.some((t) => t.isUser && t.abbr === r.champion)).length
  return {
    seasons: records.length,
    meanPointsSD: Math.round(mean(records.map((r) => r.pointsSD)) * 10) / 10,
    meanGini: Math.round(mean(records.map((r) => r.pointsGini)) * 1000) / 1000,
    distinctChampions: cupCount.size,
    minDistinctPerDecade: minDistinct,
    mostCups: most ? { team: most[0], cups: most[1] } : null,
    longest100: longest,
    maxPoints: Math.max(0, ...records.map((r) => r.maxPts)),
    medianAiPayrollPct: pays.length ? Math.round(median(pays.map((p) => p.medianAiPct)) * 1000) / 10 : null,
    payrollSeasonsInBand: pays.filter((p) => p.medianAiPct >= 0.85 && p.medianAiPct <= 0.98).length,
    payrollSeasonsMeasured: pays.length,
    meanBelowFloor: Math.round(mean(pays.map((p) => p.belowFloor)) * 10) / 10,
    tradesPerSeason: {
      aiAi: per((t) => t.trades.aiAi),
      withUser: per((t) => t.trades.withUser),
      inSeason: per((t) => t.trades.inSeason),
      deadlineDay: per((t) => t.trades.deadlineDay),
      offseason: per((t) => t.trades.offseason),
    },
    shapes,
    faSignings: { ai: per((t) => t.faSignings.ai), aiStars: per((t) => t.faSignings.aiStars) },
    offerSheets: { aiAi: per((t) => t.offerSheets.aiAi), aiAiWalked: per((t) => t.offerSheets.aiAiWalked), atUser: per((t) => t.offerSheets.atUser) },
    userCups,
  }
}

/** Real-NHL reference bands the summary is judged against (sources in the doc). */
export const NHL_BANDS = {
  pointsSD: [12, 16] as const,
  minDistinctPerDecade: 6,
  longest100Max: 7,
  aiPayrollPct: [85, 98] as const,
  tradesPerSeason: [70, 130] as const,
  deadlineDay: [15, 35] as const,
}

export function renderWorldSummary(records: WorldSeasonRecord[], s: WorldHealthSummary): string {
  const L: string[] = []
  const band = (ok: boolean): string => (ok ? 'in band' : '**OUT**')
  L.push('## World health (league-wide)')
  L.push('')
  L.push('| metric | measured | NHL band | |')
  L.push('|---|---|---|---|')
  L.push(`| points SD (mean) | ${s.meanPointsSD} | ${NHL_BANDS.pointsSD.join('–')} | ${band(s.meanPointsSD >= NHL_BANDS.pointsSD[0] && s.meanPointsSD <= NHL_BANDS.pointsSD[1])} |`)
  L.push(`| points Gini (mean) | ${s.meanGini} | ~0.07–0.10 | |`)
  L.push(`| distinct champions | ${s.distinctChampions} in ${s.seasons} | — | |`)
  L.push(`| min distinct champions / 10 seasons | ${s.minDistinctPerDecade ?? 'n/a'} | ≥${NHL_BANDS.minDistinctPerDecade} | ${s.minDistinctPerDecade === null ? '' : band(s.minDistinctPerDecade >= NHL_BANDS.minDistinctPerDecade)} |`)
  L.push(`| most Cups | ${s.mostCups ? `${s.mostCups.team} ×${s.mostCups.cups}` : '—'} | — | |`)
  L.push(`| longest ≥100-pt streak | ${s.longest100 ? `${s.longest100.team} ${s.longest100.seasons}` : '—'} | ≤${NHL_BANDS.longest100Max} | ${band(!s.longest100 || s.longest100.seasons <= NHL_BANDS.longest100Max)} |`)
  L.push(`| max points | ${s.maxPoints} | ≤~135 | |`)
  L.push(`| median AI payroll % cap | ${s.medianAiPayrollPct ?? 'n/a'}% (${s.payrollSeasonsInBand}/${s.payrollSeasonsMeasured} seasons in band) | ${NHL_BANDS.aiPayrollPct.join('–')}% | ${band(s.payrollSeasonsInBand === s.payrollSeasonsMeasured)} |`)
  L.push(`| AI clubs below the floor (mean/season) | ${s.meanBelowFloor} | 0 | ${band(s.meanBelowFloor === 0)} |`)
  const totalTrades = s.tradesPerSeason.aiAi + s.tradesPerSeason.withUser
  L.push(`| trades / season | ${totalTrades} (AI-AI ${s.tradesPerSeason.aiAi}, user ${s.tradesPerSeason.withUser}) | ${NHL_BANDS.tradesPerSeason.join('–')} | ${band(totalTrades >= NHL_BANDS.tradesPerSeason[0] && totalTrades <= NHL_BANDS.tradesPerSeason[1])} |`)
  L.push(`| … in-season / deadline day / offseason | ${s.tradesPerSeason.inSeason} / ${s.tradesPerSeason.deadlineDay} / ${s.tradesPerSeason.offseason} | deadline ${NHL_BANDS.deadlineDay.join('–')} | |`)
  L.push(`| AI trade shapes (total) | ${Object.entries(s.shapes).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} | varied | |`)
  L.push(`| AI FA signings / season | ${s.faSignings.ai} (stars ≥78: ${s.faSignings.aiStars}) | — | |`)
  L.push(`| offer sheets / season | AI-AI ${s.offerSheets.aiAi} (walked ${s.offerSheets.aiAiWalked}), at user ${s.offerSheets.atUser} | ~0–1 | |`)
  L.push(`| user Cups | ${s.userCups} | — | |`)
  L.push('')
  L.push('| season | champion | Pres. | SD | max/min pts | AI payroll med (min–max) | <floor | trades AI/user | postures c/r/r | top-200 talent |')
  L.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const r of records) {
    const p = r.payroll
    const t = r.telemetry
    L.push(`| ${r.year} | ${r.champion ?? '—'} | ${r.presidents} | ${r.pointsSD.toFixed(1)} | ${r.maxPts}/${r.minPts} | ${p ? `${(p.medianAiPct * 100).toFixed(0)}% (${(p.minAiPct * 100).toFixed(0)}–${(p.maxAiPct * 100).toFixed(0)})` : '—'} | ${p?.belowFloor ?? '—'} | ${t ? `${t.trades.aiAi}/${t.trades.withUser}` : '—'} | ${r.postures.contend ?? 0}/${r.postures.retool ?? 0}/${r.postures.rebuild ?? 0} | ${r.talent ?? '—'} |`)
  }
  L.push('')
  return L.join('\n')
}
