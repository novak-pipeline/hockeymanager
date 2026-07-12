/**
 * Season sanity harness — sims full seasons and flags anything ILLOGICAL.
 *
 * Not a unit test: a standalone bug-hunter that drives the real career engine
 * through a couple of full year-cycles (regular season → playoffs → offseason →
 * next season) and checks hard invariants a correct league must satisfy —
 * standings math, roster/cap legality, stat ranges, career-history accumulation,
 * playoff completion, cross-tier trades, silent retirements. It prints a report.
 *
 * Run it on its own:
 *   npx vitest run src/engine/career/seasonSanity.test.ts
 * (Excluded from the default suite in vitest.config.ts — it sims minutes.)
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { ratedOverall } from '@engine/ratings/composites'
import { Career } from './career'
import type { NewsItem } from './views'

describe('season sanity', () => {
  it('a full season produces a logical league (standings, cap, stats, playoffs, history)', () => {
    const SEED = 2031
    // The fictional default league (16 franchises are defined). A real 32-team
    // NHL league comes from a roster import; the invariants checked here hold at
    // any size, and game-count is validated against the actual schedule below.
    const data = generateLeague({ seed: SEED })
    const expectedGP = Math.round((data.league.schedule.length * 2) / data.league.teams.length)
    const nhlIds = new Set(data.league.teams.map((id) => id as string))
    const nhlNames = new Set(
      data.league.teams.map((id) => data.teams.get(id)?.name ?? '').filter(Boolean),
    )
    const userTid = data.league.teams[10] ?? data.league.teams[0]!
    const career = new Career(data, SEED, userTid)

    // Keep the USER org viable across seasons so advanceDay's lineup guard never
    // throws — this harness audits the WORLD's logic, not roster management, so the
    // user club shouldn't deplete below a legal lineup. (The rest of the league
    // ages, gets injured, and retires normally — that's what we're checking.)
    {
      const userNhl = data.teams.get(userTid)!
      const userAhl = userNhl.affiliateId ? data.teams.get(userNhl.affiliateId) : undefined
      for (const roster of [userNhl.roster, userAhl?.roster ?? []]) {
        for (const id of roster) {
          const p = data.players.get(id)
          if (!p) continue
          p.injuryProneness = 0
          p.age = Math.min(p.age, 24)
          p.contract = { ...p.contract, yearsRemaining: 12, expiryYear: career.year + 12 }
        }
      }
    }

    const issues: string[] = []
    const flag = (s: string): void => { if (issues.length < 200) issues.push(s) }
    const news: NewsItem[] = []
    const seenNews = new Set<string>()
    const grabNews = (): void => {
      for (const n of career.getInbox().items) {
        const key = `${n.day}|${n.headline}`
        if (!seenNews.has(key)) { seenNews.add(key); news.push(n) }
      }
    }

    const SEASONS = 2
    const startYear = career.year
    let prevPhase = career.seasonPhase
    let guard = 0
    let rsChecked = 0
    let championsSeen = 0

    while (career.year < startYear + SEASONS && guard++ < 40000) {
      if (career.draftPending()) { career.autoDraft(); continue }
      career.step()
      const phase = career.seasonPhase
      if (phase !== prevPhase) {
        grabNews()
        // Regular season just ended → check the final table.
        if (prevPhase === 'regularSeason') { checkStandings(career, nhlIds, expectedGP, flag); rsChecked++ }
        if (phase === 'offseason') {
          if (news.some((n) => /champion|stanley|wins the (cup|final|title)/i.test(`${n.headline} ${n.body}`))) {
            championsSeen++
          }
        }
        prevPhase = phase
      }
    }
    grabNews()

    // ── invariants over the FINAL state ──
    checkRostersAndCap(data, nhlIds, flag)
    checkPlayerStats(data, flag)
    checkCareerHistory(data, flag)
    checkNoCrossTierTrades(news, nhlNames, flag)
    checkRetirementsHaveNews(news, flag)

    // ── report ──
    const lines = [
      '\n=== SEASON SANITY ===',
      `simmed ${career.year - startYear} season(s); RS tables checked: ${rsChecked}; champions crowned: ${championsSeen}`,
      `news captured: ${news.length}`,
      issues.length === 0 ? 'NO ISSUES FLAGGED ✅' : `ISSUES (${issues.length}):`,
      ...issues.slice(0, 60).map((s) => `  • ${s}`),
    ]
    process.stdout.write(lines.join('\n') + '\n')

    expect(rsChecked).toBeGreaterThan(0) // we actually simmed a full regular season
    expect(championsSeen).toBeGreaterThan(0) // playoffs completed with a champion
  }, 600_000)
})

/* ────────────────────────── checks ────────────────────────── */

function checkStandings(career: Career, nhlIds: Set<string>, expectedGP: number, flag: (s: string) => void): void {
  const rows = career.getStandings().overall.filter((r) => nhlIds.has(r.teamId))
  if (rows.length === 0) { flag('standings: no NHL rows at end of regular season'); return }
  let totWins = 0, totNonWins = 0, totGf = 0, totGa = 0
  for (const r of rows) {
    if (r.points !== 2 * r.wins + r.overtimeLosses) {
      flag(`standings math: ${r.abbreviation} points ${r.points} ≠ 2*${r.wins}+${r.overtimeLosses}`)
    }
    if (r.wins + r.losses + r.overtimeLosses !== r.gamesPlayed) {
      flag(`standings: ${r.abbreviation} W+L+OTL ${r.wins + r.losses + r.overtimeLosses} ≠ GP ${r.gamesPlayed}`)
    }
    if (Math.abs(r.gamesPlayed - expectedGP) > 4) {
      flag(`standings: ${r.abbreviation} played ${r.gamesPlayed} games (schedule sets ~${expectedGP})`)
    }
    totWins += r.wins; totNonWins += r.losses + r.overtimeLosses; totGf += r.goalsFor; totGa += r.goalsAgainst
  }
  // Every game yields exactly one win and one non-win; goals for == goals against league-wide.
  if (totWins !== totNonWins) flag(`standings: league wins ${totWins} ≠ losses+OTL ${totNonWins}`)
  if (Math.abs(totGf - totGa) > rows.length) flag(`standings: league GF ${totGf} vs GA ${totGa} imbalance`)
}

function checkRostersAndCap(
  data: ReturnType<typeof generateLeague>,
  nhlIds: Set<string>,
  flag: (s: string) => void,
): void {
  const onRoster = new Map<string, string[]>()
  for (const id of nhlIds) {
    const team = data.teams.get(id as never)
    if (!team) continue
    const skaters = team.roster.map((pid) => data.players.get(pid)).filter(Boolean)
    if (team.roster.length < 18 || team.roster.length > 26) {
      flag(`roster: ${team.abbreviation} has ${team.roster.length} players (expected ~20-23)`)
    }
    const goalies = skaters.filter((p) => p!.position === 'G').length
    if (goalies < 2) flag(`roster: ${team.abbreviation} dressed ${goalies} goalies`)
    const cap = skaters.reduce((s, p) => s + (p!.contract.salary), 0)
    const ceil = team.finances.salaryCap
    if (cap > ceil * 1.05) flag(`cap: ${team.abbreviation} at $${(cap / 1e6).toFixed(1)}M vs $${(ceil / 1e6).toFixed(1)}M ceiling`)
    for (const pid of team.roster) {
      const key = pid as string
      onRoster.set(key, [...(onRoster.get(key) ?? []), team.abbreviation])
    }
  }
  for (const [pid, teams] of onRoster) {
    if (teams.length > 1) {
      const nm = data.players.get(pid as never)?.name ?? pid
      flag(`duplicate roster: ${nm} on ${teams.join(' + ')}`)
    }
  }
}

function checkPlayerStats(data: ReturnType<typeof generateLeague>, flag: (s: string) => void): void {
  let checked = 0
  for (const p of data.players.values()) {
    for (const s of p.stats) {
      const g = s.ev.goals + s.pp.goals + s.pk.goals
      const a = s.ev.assists + s.pp.assists + s.pk.assists
      if (s.gamesPlayed < 0 || s.gamesPlayed > 84) flag(`stats: ${p.name} ${s.season} GP ${s.gamesPlayed}`)
      if (g < 0 || a < 0) flag(`stats: ${p.name} ${s.season} negative G/A (${g}/${a})`)
      if (g > s.gamesPlayed + 5 && s.gamesPlayed > 0) flag(`stats: ${p.name} ${s.season} ${g}G in ${s.gamesPlayed}GP (implausible)`)
      if (p.position === 'G' && s.shotsAgainst > 0) {
        const sv = s.saves / s.shotsAgainst
        if (sv < 0 || sv > 1) flag(`stats: goalie ${p.name} ${s.season} save% ${sv.toFixed(3)}`)
      }
      checked++
    }
  }
  if (checked === 0) flag('stats: no player season lines recorded at all')
}

function checkCareerHistory(data: ReturnType<typeof generateLeague>, flag: (s: string) => void): void {
  // After 2 seasons, established NHLers should have MULTIPLE season lines (history
  // accumulates, not overwrites). Sample the highest-overall skaters.
  const vets = [...data.players.values()]
    .filter((p) => p.age >= 26 && p.position !== 'G' && ratedOverall(p) >= 80)
    .sort((a, b) => ratedOverall(b) - ratedOverall(a))
    .slice(0, 20)
  const withMulti = vets.filter((p) => p.stats.length >= 2).length
  if (vets.length >= 5 && withMulti === 0) {
    flag('career history: no established veteran has >1 season line (history not accumulating)')
  }
  // Duplicate season+team lines would indicate double-writing.
  for (const p of data.players.values()) {
    const keys = new Set<string>()
    for (const s of p.stats) {
      const k = `${s.season}|${s.teamId}`
      if (keys.has(k)) { flag(`history: ${p.name} has a duplicate ${s.season} line for the same team`); break }
      keys.add(k)
    }
  }
}

function checkNoCrossTierTrades(news: NewsItem[], nhlNames: Set<string>, flag: (s: string) => void): void {
  for (const n of news) {
    if (n.category !== 'trade') continue
    const text = `${n.headline} ${n.body}`
    if (/\bU20\b|\bU18\b|junior|AHL/i.test(text)) {
      flag(`cross-tier trade news: "${n.headline}"`)
    }
  }
}

function checkRetirementsHaveNews(news: NewsItem[], flag: (s: string) => void): void {
  const retireNews = news.filter((n) => /retire|retirement|hangs (them|it) up|calls it a career/i.test(`${n.headline} ${n.body}`))
  if (retireNews.length === 0) {
    flag('retirements: no retirement news in two seasons (players may be vanishing silently)')
  }
}
