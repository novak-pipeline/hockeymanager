/**
 * JUNIOR PATHWAYS — where a kid goes when junior is over.
 *
 * Nothing used to enforce a junior age limit, so the OHL, J20 and MHL aged into
 * 24-year-old "juniors" and emptied out (baseline harness: OHL rosters fell
 * from 19 to 6 a club in four seasons). This summer pass models the real
 * routes out of junior:
 *
 *  - AGE-OUT. CHL/USHL/NAHL/BCHL/European U20 loops keep 20-year-olds and lose
 *    them at 21; the NTDP is an U17/U18 program; NCAA players are out by 24.
 *  - THE COLLEGE ROUTE. North Americans aged 18–21 commit to NCAA programs to
 *    refill them. Since the NCAA's Nov-2024 rule change (effective 2025–26),
 *    CHL players keep their college eligibility, so major-junior kids now take
 *    this route too — just less often than USHL/NAHL/BCHL kids, who were always
 *    on it.
 *  - COLLEGE / JUNIOR FREE AGENTS. The best undrafted age-outs sign with an
 *    NHL organisation's AHL affiliate (the "college free agent" market).
 *  - EUROPEANS STAY HOME. Everyone else steps into the strongest men's league
 *    at home he is good enough for (SHL → HockeyAllsvenskan, KHL → VHL, …);
 *    North Americans drop to the ECHL/the minors. A player good enough for no
 *    league simply leaves the pro game.
 *
 * Drafted players keep their NHL rights wherever they land. The rights-holder
 * graduation (career.graduateProspects) still decides when they turn pro.
 *
 * Pure given inputs + Rng. Mutates rosters/contracts.
 */
import type { Competition, Player, PlayerId, Team, TeamId } from '@domain'
import { ratedOverall, ratedPotential } from '@engine/ratings/composites'
import { canonicalLeagueKey } from '@engine/league/leagueStrength'
import type { Rng } from '@engine/shared/rng'
import { youthProfileOf } from './youthIntake'

/** Most players a senior world club carries. */
const SENIOR_ROSTER_MAX = 27
/** NCAA program roster target (recruiting fills toward it). */
const NCAA_TARGET = 26
/** Undrafted age-outs at least this good get an NHL org's farm contract. */
const FREE_AGENT_BAR = 52

export type PathwayMove =
  | { kind: 'college'; playerId: PlayerId; toTeamId: TeamId; fromLeague: string }
  | { kind: 'proFarm'; playerId: PlayerId; toTeamId: TeamId; fromLeague: string }
  | { kind: 'senior'; playerId: PlayerId; toTeamId: TeamId; fromLeague: string; toLeague: string }
  | { kind: 'leftGame'; playerId: PlayerId; fromLeague: string }

const NA = new Set(['Canada', 'United States', 'USA'])

function teamAvg(team: Team, players: Map<PlayerId, Player>): number {
  const ovrs: number[] = []
  for (const pid of team.roster) {
    const p = players.get(pid)
    if (p) ovrs.push(ratedOverall(p))
  }
  if (ovrs.length === 0) return 40
  ovrs.sort((a, b) => b - a)
  const top = ovrs.slice(0, 18)
  return top.reduce((s, v) => s + v, 0) / top.length
}

export function runJuniorPathways(args: {
  competitions: Competition[]
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  year: number
  rng: Rng
  /** NHL clubs whose affiliates may sign free agents (the user's is excluded). */
  aiOrgIds: TeamId[]
}): { moves: PathwayMove[] } {
  const { competitions, teams, players, year, rng } = args
  const moves: PathwayMove[] = []

  // ── 1. collect everyone leaving a youth league this summer ──
  interface Leaver { p: Player; fromLeague: string; wasCollege: boolean; wasChl: boolean }
  const leavers: Leaver[] = []
  for (const comp of competitions) {
    if (comp.tier !== 'simulated') continue
    const prof = youthProfileOf(comp)
    if (!prof) continue
    const key = canonicalLeagueKey(comp.abbrev, comp.name)
    for (const tid of comp.teamIds) {
      const team = teams.get(tid)
      if (!team) continue
      const keep: PlayerId[] = []
      for (const pid of team.roster) {
        const p = players.get(pid)
        if (p && p.age > prof.ageLimit && p.retiredYear === undefined) {
          leavers.push({ p, fromLeague: key, wasCollege: prof.kind === 'college', wasChl: key === 'OHL' || key === 'WHL' || key === 'QMJHL' })
        } else keep.push(pid)
      }
      if (keep.length !== team.roster.length) team.roster = keep
    }
  }

  // ── 2. NCAA recruiting: commits from the North American junior loops ──
  const ncaaTeams = competitions
    .filter((c) => c.tier === 'simulated' && youthProfileOf(c)?.kind === 'college')
    .flatMap((c) => c.teamIds.map((t) => teams.get(t)).filter((t): t is Team => !!t))
  const recruited = new Set<string>()
  if (ncaaTeams.length > 0) {
    let need = 0
    for (const t of ncaaTeams) need += Math.max(0, NCAA_TARGET - t.roster.length)
    // The recruiting pool: NA juniors aged 18–21 (still in junior or aging out),
    // weighted to the Tier-1/II loops; CHL kids commit less often (new since 2025).
    const pool: Array<{ p: Player; from: string; w: number; leaver?: Leaver }> = []
    const juniorTeamOf = new Map<string, Team>()
    for (const lv of leavers) {
      if (lv.wasCollege || !NA.has(lv.p.nationality ?? '')) continue
      if (lv.p.age > 21) continue
      pool.push({ p: lv.p, from: lv.fromLeague, w: lv.wasChl ? 0.35 : 1, leaver: lv })
    }
    for (const comp of competitions) {
      const key = canonicalLeagueKey(comp.abbrev, comp.name)
      if (!['USHL', 'NAHL', 'BCHL', 'NTDP', 'OHL', 'WHL', 'QMJHL'].includes(key)) continue
      const chl = key === 'OHL' || key === 'WHL' || key === 'QMJHL'
      for (const tid of comp.teamIds) for (const pid of teams.get(tid)?.roster ?? []) {
        const p = players.get(pid)
        if (!p || p.age < 19 || p.age > 21 || !NA.has(p.nationality ?? '')) continue
        // Only a slice of the eligible juniors commit each summer.
        const w = chl ? 0.12 : p.juniorPreference === 'College' ? 0.55 : 0.3
        pool.push({ p, from: key, w })
        juniorTeamOf.set(pid as string, teams.get(tid)!)
      }
    }
    // Best prospects commit first (a weighted lottery on talent), deterministic.
    const scored = pool
      .map((e) => ({ ...e, s: rng.chance(e.w) ? ratedPotential(e.p) + rng.normal(0, 3) : -1 }))
      .filter((e) => e.s >= 0)
      .sort((a, b) => b.s - a.s || (a.p.id < b.p.id ? -1 : 1))
      .slice(0, need)
    // Spread commits round-robin over programs with room (strongest recruits first
    // to the strongest programs).
    const programs = [...ncaaTeams].sort((a, b) => teamAvg(b, players) - teamAvg(a, players))
    let i = 0
    for (const e of scored) {
      let placed = false
      for (let k = 0; k < programs.length && !placed; k++) {
        const t = programs[(i + k) % programs.length]!
        if (t.roster.length >= NCAA_TARGET) continue
        // Leave his junior club (if he hadn't already aged out).
        if (!e.leaver) {
          const jt = juniorTeamOf.get(e.p.id as string)
          if (jt) {
            const idx = jt.roster.indexOf(e.p.id)
            if (idx >= 0) jt.roster.splice(idx, 1)
          }
        }
        t.roster.push(e.p.id)
        e.p.contract = { salary: 0, yearsRemaining: 4, expiryYear: year + 4, noTradeClause: false, twoWay: false }
        recruited.add(e.p.id as string)
        moves.push({ kind: 'college', playerId: e.p.id, toTeamId: t.id, fromLeague: e.from })
        placed = true
        i = (i + k + 1) % programs.length
      }
    }
  }

  // ── 3. the rest of the leavers: a pro deal, a men's league, or the exit ──
  const affiliates = args.aiOrgIds
    .map((id) => teams.get(id))
    .map((t) => (t?.affiliateId ? teams.get(t.affiliateId) : undefined))
    .filter((t): t is Team => !!t)
  const seniorByNation = new Map<string, Array<{ comp: Competition; team: Team; avg: number }>>()
  for (const comp of competitions) {
    if (comp.tier !== 'simulated' || youthProfileOf(comp)) continue
    const key = canonicalLeagueKey(comp.abbrev, comp.name)
    if (key === 'NHL' || key === 'AHL') continue
    for (const tid of comp.teamIds) {
      const team = teams.get(tid)
      if (!team) continue
      const nat = comp.nation.toLowerCase()
      const list = seniorByNation.get(nat) ?? []
      list.push({ comp, team, avg: teamAvg(team, players) })
      seniorByNation.set(nat, list)
    }
  }
  const homeOf = (p: Player): string => {
    const n = (p.nationality ?? '').toLowerCase()
    if (n === 'usa') return 'united states'
    return n
  }
  const rest = leavers.filter((lv) => !recruited.has(lv.p.id as string))
    .sort((a, b) => ratedOverall(b.p) - ratedOverall(a.p) || (a.p.id < b.p.id ? -1 : 1))
  for (const lv of rest) {
    const p = lv.p
    const ovr = ratedOverall(p)
    // Rights-held players are the org's business (graduation handles them) —
    // but an aged-out one with nowhere to be still needs a club, so he follows
    // the same route below; his rights travel with him.
    if (!p.rightsTeamId && ovr >= FREE_AGENT_BAR && p.age <= 24 && affiliates.length > 0) {
      const dest = [...affiliates].sort((a, b) => a.roster.length - b.roster.length || (a.id < b.id ? -1 : 1))[0]!
      if (dest.roster.length < 30) {
        dest.roster.push(p.id)
        p.contract = { salary: 850_000, yearsRemaining: 2, expiryYear: year + 2, noTradeClause: false, twoWay: true }
        moves.push({ kind: 'proFarm', playerId: p.id, toTeamId: dest.id, fromLeague: lv.fromLeague })
        continue
      }
    }
    // Home men's leagues first (NA kids: the US/Canadian minors), else anywhere.
    const home = homeOf(p)
    const naHome = home === 'canada' || home === 'united states'
    const options = [
      ...(seniorByNation.get(home) ?? []),
      ...(naHome ? [...(seniorByNation.get(home === 'canada' ? 'united states' : 'canada') ?? [])] : []),
    ]
    // Strongest club he is good enough for (within 4 of its top-18 average), with room.
    const fit = options
      .filter((o) => o.team.roster.length < SENIOR_ROSTER_MAX && ovr >= o.avg - 4)
      .sort((a, b) => b.avg - a.avg || (a.team.id < b.team.id ? -1 : 1))[0]
    if (fit) {
      fit.team.roster.push(p.id)
      const years = rng.range(1, 3)
      p.contract = {
        salary: Math.round((0.15 + Math.pow(Math.max(0, ovr - 38) / 40, 2) * 1.2) * fit.comp.strength * 1e6),
        yearsRemaining: years, expiryYear: year + years, noTradeClause: false, twoWay: false,
      }
      moves.push({ kind: 'senior', playerId: p.id, toTeamId: fit.team.id, fromLeague: lv.fromLeague, toLeague: canonicalLeagueKey(fit.comp.abbrev, fit.comp.name) })
      continue
    }
    // Good enough for no league: he leaves the pro game (a real, quiet ending).
    p.retiredYear = year
    p.contract = { ...p.contract, yearsRemaining: 0 }
    moves.push({ kind: 'leftGame', playerId: p.id, fromLeague: lv.fromLeague })
  }
  // Keep lineups legal wherever rosters changed.
  return { moves }
}
