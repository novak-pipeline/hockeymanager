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
    let oddsProbed = false

    while (career.year < startYear + SEASONS && guard++ < 40000) {
      if (career.draftPending()) { career.autoDraft(); continue }
      career.step()
      const phase = career.seasonPhase
      // Mid-season probe: playoff odds must be sane, not degenerate (the "stuck
      // at 1% for a mid-pack team" bug). Probe once, well into the first season.
      if (!oddsProbed && phase === 'regularSeason' && guard > 150) {
        oddsProbed = true
        checkPlayoffOdds(career, flag)
      }
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
    checkInboxText(news, flag)

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
  // Duplicate season+team+league lines would indicate double-writing. (A player
  // can legitimately have BOTH an NHL and an AHL line in the same season if he was
  // called up and sent down — those are distinct by league.)
  for (const p of data.players.values()) {
    const keys = new Set<string>()
    for (const s of p.stats) {
      const k = `${s.season}|${s.teamId}|${s.league ?? 'nhl'}`
      if (keys.has(k)) { flag(`history: ${p.name} has a duplicate ${s.season} line for the same team`); break }
      keys.add(k)
    }
  }
}

function checkNoCrossTierTrades(news: NewsItem[], nhlNames: Set<string>, flag: (s: string) => void): void {
  for (const n of news) {
    if (n.category !== 'trade') continue
    // Only COMPLETED trades matter here — a "Trade offer from …" is a proposal,
    // and its flavor text can legitimately mention a junior prospect the club
    // holds rights to without any cross-tier player actually changing hands.
    if (!/^Trade:/i.test(n.headline)) continue
    const text = `${n.headline} ${n.body}`
    if (/\bU20\b|\bU18\b|\bAHL\b/i.test(text)) {
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

/** No inbox item should leak a raw template hole ("undefined", "NaN", "[object
 *  Object]") or an empty headline — those are the "illogical inbox message"
 *  class the player reported. */
function checkInboxText(news: NewsItem[], flag: (s: string) => void): void {
  const bad = /\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b|\$NaN|\bNaN%/
  let flagged = 0
  for (const n of news) {
    if (flagged >= 5) break
    if (!n.headline || !n.headline.trim()) { flag('inbox: an item has an empty headline'); flagged++; continue }
    const text = `${n.headline} ${n.body ?? ''}`
    if (bad.test(text)) { flag(`inbox: template hole in "${n.headline}"`); flagged++ }
  }
}

/** In-season playoff odds must be a real distribution: available, one row per
 *  team, every pct in [0,100], and per-conference qualification totals ≈
 *  qualifiers×100% (not every team stuck near a degenerate value). */
function checkPlayoffOdds(career: Career, flag: (s: string) => void): void {
  const odds = career.getPlayoffOdds()
  if (!odds.available) { flag('playoff odds: unavailable mid-season'); return }
  if (odds.rows.length === 0) { flag('playoff odds: no rows'); return }
  for (const r of odds.rows) {
    if (r.playoffPct < 0 || r.playoffPct > 100) flag(`playoff odds: ${r.abbreviation} pct ${r.playoffPct} out of range`)
  }
  // Sum of make-playoffs probability across a conference should be ≈ qualifiers.
  const byConf = new Map<string, number>()
  for (const r of odds.rows) byConf.set(r.conference, (byConf.get(r.conference) ?? 0) + r.playoffPct)
  const qual = odds.qualifiers ?? 0
  if (qual > 0) {
    for (const [conf, sumPct] of byConf) {
      const expected = qual * 100
      if (Math.abs(sumPct - expected) > 250) {
        flag(`playoff odds: conference "${conf || '—'}" totals ${sumPct}% (expected ~${expected}% for ${qual} spots)`)
      }
    }
  }
  // Degenerate check: not every team should read the same flat pct.
  const distinct = new Set(odds.rows.map((r) => r.playoffPct))
  if (odds.rows.length > 4 && distinct.size <= 1) {
    flag(`playoff odds: every team shows the same ${[...distinct][0]}% (degenerate)`)
  }
}
