/**
 * INTERNATIONAL HOCKEY — the World Juniors and best-on-best.
 *
 * The existing International tab only PROJECTED a World Juniors ("if it were
 * held now"). This plays the tournaments for real, with real rosters from every
 * club in every league, through the same quick-sim the world leagues use:
 *
 *  - WORLD JUNIORS (U20, Dec 26 – Jan 5): 10 nations, two groups of five
 *    (serpentine-seeded), round robin, the top four of each group to the
 *    quarter-finals, then semis, bronze and gold. The IIHF's real format.
 *  - WINTER OLYMPICS (every four years, NHL participation, mid-February): 12
 *    nations, three groups of four; group ranking 1–12, the top four bye to the
 *    quarter-finals and 5–12 play a qualification round; then semis, bronze,
 *    gold. The 2026 Milan format.
 *  - NATIONS CUP (the mid-cycle best-on-best, modelled on the Feb-2025 four-
 *    nation event): the top four nations, a round robin, then a final.
 *
 * Output per tournament: medal table, final standings, per-player tournament
 * lines (for the all-star team, top scorer, best goalie, MVP and the honours
 * archive), and injuries suffered. Pure given inputs + seeds.
 */
import type { IntlEventKind, IntlEventRecord, IntlPlayerLine, Player, PlayerId, Team, TeamId, TeamTactics } from '@domain'
import { asTeamId } from '@domain'
import { ratedOverall } from '@engine/ratings/composites'
import { repairLines } from '@engine/league/lineup'
import { quickSimGame } from '@engine/quick/quickSim'
import { rollInjuries } from '@engine/league/condition'
import { selectNationalTeam } from '@engine/league/nationalTeam'
import { Rng, deriveSeed } from '@engine/shared/rng'

export const INTL_NAMES: Record<IntlEventKind, string> = {
  worldJuniors: 'World Juniors',
  olympics: 'Winter Olympics',
  nationsCup: 'Nations Cup',
}

/** Three-letter code for a nation's jersey/abbreviation. */
export function nationCode(n: string): string {
  const M: Record<string, string> = {
    'Canada': 'CAN', 'United States': 'USA', 'USA': 'USA', 'Sweden': 'SWE', 'Finland': 'FIN', 'Russia': 'RUS',
    'Czechia': 'CZE', 'Czech Republic': 'CZE', 'Slovakia': 'SVK', 'Switzerland': 'SUI', 'Germany': 'GER',
    'Latvia': 'LAT', 'Denmark': 'DEN', 'Norway': 'NOR', 'Austria': 'AUT', 'Belarus': 'BLR', 'Kazakhstan': 'KAZ',
    'France': 'FRA', 'Slovenia': 'SLO', 'Italy': 'ITA', 'Hungary': 'HUN', 'Poland': 'POL', 'Great Britain': 'GBR',
    'Ukraine': 'UKR',
  }
  return M[n] ?? n.slice(0, 3).toUpperCase()
}

/** Season years with each senior best-on-best event (Feb of year+1). Olympics
 *  in 2026, 2030, …; the Nations Cup at the mid-point (2028, 2032, …). */
export function seniorEventFor(seasonYear: number): IntlEventKind | null {
  const m = ((seasonYear % 4) + 4) % 4
  if (m === 1) return 'olympics'
  if (m === 3) return 'nationsCup'
  return null
}

/** Calendar anchor (match-day index from Oct 1) for each event. */
export const WJC_DAY = 87 // Dec 26
export const SENIOR_EVENT_DAY = 131 // ~Feb 8
/** Length of the NHL pause for each senior event, in days. */
export const SENIOR_BREAK_DAYS: Record<'olympics' | 'nationsCup', number> = { olympics: 17, nationsCup: 10 }

/* ───────────────────────── squads ───────────────────────── */

interface Squad {
  nation: string
  strength: number
  team: Team
}

function nationalTeam(nation: string, roster: Player[], players: Map<PlayerId, Player>, tactics: TeamTactics, tag: string): Team {
  const team: Team = {
    id: asTeamId(`nat-${tag}-${nationCode(nation)}`),
    name: nation,
    abbreviation: nationCode(nation),
    city: nation,
    colors: { primary: 0x444444, secondary: 0xffffff },
    conferenceId: 'intl',
    divisionId: 'intl',
    roster: roster.map((p) => p.id),
    lines: { forwards: [], defensePairs: [], goalies: [roster[0]!.id, roster[0]!.id], powerPlayUnits: [], penaltyKillUnits: [] },
    tactics: structuredClone(tactics),
    finances: { budget: 0, salaryCap: 0, capUsed: 0, revenue: 0 },
    staff: { headCoachId: null, assistantCoachIds: [], scoutIds: [] },
  }
  repairLines(team, players)
  return team
}

/**
 * Select every contending nation's squad. `pool` = eligible players (already
 * age-filtered for the U20s, healthy). Nations need a full squad (≥20 with 2
 * goalies) to enter. Returns the field, strongest first.
 */
export function selectSquads(args: {
  pool: Iterable<Player>
  players: Map<PlayerId, Player>
  fieldSize: number
  tactics: TeamTactics
  tag: string
}): Squad[] {
  const byNation = new Map<string, Player[]>()
  for (const p of args.pool) {
    let nat = (p.nationality ?? '').trim()
    if (!nat || nat === '[None]') continue
    if (nat === 'USA') nat = 'United States'
    if (nat === 'Czech Republic') nat = 'Czechia'
    const list = byNation.get(nat) ?? []
    list.push(p)
    byNation.set(nat, list)
  }
  const squads: Squad[] = []
  for (const [nation, list] of byNation) {
    const picks = selectNationalTeam(list, { forwards: 14, defensemen: 8, goalies: 3 })
    const gs = picks.filter((pk) => pk.slot === 'G').length
    if (picks.length < 20 || gs < 2) continue
    const skaters = picks.filter((pk) => pk.slot !== 'G').map((pk) => ratedOverall(pk.player)).sort((a, b) => b - a)
    const goalie = Math.max(...picks.filter((pk) => pk.slot === 'G').map((pk) => ratedOverall(pk.player)))
    const strength = skaters.slice(0, 18).reduce((s, v) => s + v, 0) / Math.min(18, skaters.length) * 0.8 + goalie * 0.2
    squads.push({ nation, strength, team: nationalTeam(nation, picks.map((pk) => pk.player), args.players, args.tactics, args.tag) })
  }
  squads.sort((a, b) => b.strength - a.strength || (a.nation < b.nation ? -1 : 1))
  return squads.slice(0, args.fieldSize)
}

/* ───────────────────────── games ───────────────────────── */

interface Ctx {
  players: Map<PlayerId, Player>
  seed: number
  gi: number
  lines: Map<string, IntlPlayerLine>
  injuryRng: Rng
  injured: Array<{ playerId: string; nation: string; games: number }>
  nationOf: Map<string, string>
}

interface GameRes { winner: Squad; loser: Squad; score: string; ot: boolean; gd: number }

function play(ctx: Ctx, home: Squad, away: Squad, knockout: boolean): GameRes {
  const res = quickSimGame(home.team, away.team, (id) => ctx.players.get(id)!, {
    seed: deriveSeed(ctx.seed, ctx.gi++),
    rules: knockout ? 'playoff' : 'regularSeason',
  })
  for (const [pid, s] of res.playerStats) {
    if (s.toi <= 0) continue
    const p = ctx.players.get(pid)
    if (!p) continue
    const key = pid as string
    let line = ctx.lines.get(key)
    if (!line) {
      line = { playerId: key, name: p.name, nation: ctx.nationOf.get(key) ?? '', position: p.position, gp: 0, g: 0, a: 0 }
      if (p.position === 'G') { line.sv = 0; line.sa = 0 }
      ctx.lines.set(key, line)
    }
    line.gp++
    line.g += s.goals
    line.a += s.assists
    if (p.position === 'G') { line.sv = (line.sv ?? 0) + s.saves; line.sa = (line.sa ?? 0) + s.shotsAgainst }
  }
  const inj = rollInjuries({
    participants: [...res.playerStats].filter(([, s]) => s.toi > 0).map(([pid, s]) => ({ player: ctx.players.get(pid)!, toi: s.toi })),
    rng: ctx.injuryRng,
  })
  for (const r of inj) ctx.injured.push({ playerId: r.playerId as string, nation: ctx.nationOf.get(r.playerId as string) ?? '', games: r.injury.gamesRemaining })
  const homeWon = res.homeGoals > res.awayGoals
  const ot = res.decidedBy !== 'regulation'
  const w = homeWon ? home : away
  const l = homeWon ? away : home
  const hi = Math.max(res.homeGoals, res.awayGoals)
  const lo = Math.min(res.homeGoals, res.awayGoals)
  return { winner: w, loser: l, score: `${hi}–${lo}${ot ? (res.decidedBy === 'shootout' ? ' (SO)' : ' (OT)') : ''}`, ot, gd: hi - lo }
}

interface GroupRow { squad: Squad; pts: number; gd: number; gf: number }

function roundRobin(ctx: Ctx, group: Squad[]): GroupRow[] {
  const rows = new Map(group.map((s) => [s.nation, { squad: s, pts: 0, gd: 0, gf: 0 }]))
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const r = play(ctx, group[i]!, group[j]!, false)
      // IIHF points: 3 regulation win, 2 OT/SO win, 1 OT/SO loss.
      const w = rows.get(r.winner.nation)!
      const l = rows.get(r.loser.nation)!
      w.pts += r.ot ? 2 : 3
      if (r.ot) l.pts += 1
      w.gd += r.gd; l.gd -= r.gd
      w.gf += Number(r.score.split('–')[0])
      l.gf += Number(r.score.split('–')[1]!.replace(/\D.*$/, ''))
    }
  }
  return [...rows.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || b.squad.strength - a.squad.strength)
}

/* ───────────────────────── tournaments ───────────────────────── */

export interface TournamentResult {
  record: IntlEventRecord
  injured: Array<{ playerId: string; nation: string; games: number }>
  /** Squad nation per selected player id. */
  selected: Map<string, string>
  /** Every player's tournament line. */
  lines: IntlPlayerLine[]
}

function finish(ctx: Ctx, kind: IntlEventKind, year: number, squads: Squad[], placing: Squad[], final: GameRes | null): TournamentResult {
  const lines = [...ctx.lines.values()]
  const pts = (l: IntlPlayerLine): number => l.g + l.a
  const skaters = lines.filter((l) => l.position !== 'G')
  const byPts = (a: IntlPlayerLine, b: IntlPlayerLine): number => pts(b) - pts(a) || b.g - a.g || a.gp - b.gp || (a.playerId < b.playerId ? -1 : 1)
  const leaders = [...skaters].sort(byPts).slice(0, 10)
  const svp = (l: IntlPlayerLine): number => (l.sa ?? 0) > 0 ? (l.sv ?? 0) / (l.sa ?? 1) : 0
  const goalies = lines.filter((l) => l.position === 'G' && l.gp >= 2).sort((a, b) => svp(b) - svp(a) || b.gp - a.gp)
  const medalNations = new Set(placing.slice(0, 3).map((s) => s.nation))
  const bestD = skaters.filter((l) => l.position === 'D').sort(byPts)
  const bestF = skaters.filter((l) => l.position !== 'D').sort(byPts)
  const allStars = [goalies[0], bestD[0], bestD[1], bestF[0], bestF[1], bestF[2]].filter((x): x is IntlPlayerLine => !!x)
  // MVP: the best scorer from a medal nation (a hot goalie on the champion can steal it).
  const champGoalie = goalies.find((g) => g.nation === placing[0]?.nation && svp(g) >= 0.935)
  const mvp = champGoalie ?? [...skaters].filter((l) => medalNations.has(l.nation)).sort(byPts)[0] ?? leaders[0] ?? null
  const rosters: Array<[string, string[]]> = squads.map((s) => [s.nation, s.team.roster.map((id) => id as string)])
  const record: IntlEventRecord = {
    kind, year, name: INTL_NAMES[kind],
    gold: placing[0]?.nation ?? null,
    silver: placing[1]?.nation ?? null,
    bronze: placing[2]?.nation ?? null,
    standings: placing.map((s) => s.nation),
    finalScore: final?.score ?? null,
    finalLine: final ? `${final.winner.nation} ${final.score} ${final.loser.nation}` : null,
    mvp,
    topScorer: leaders[0] ?? null,
    bestGoalie: goalies[0] ?? null,
    allStars,
    leaders,
    rosters,
    lines: lines.map((l) => ({ ...l })),
  }
  return { record, injured: ctx.injured, selected: ctx.nationOf, lines }
}

function makeCtx(players: Map<PlayerId, Player>, seed: number, squads: Squad[]): Ctx {
  const nationOf = new Map<string, string>()
  for (const s of squads) for (const id of s.team.roster) nationOf.set(id as string, s.nation)
  return { players, seed, gi: 0, lines: new Map(), injuryRng: new Rng(deriveSeed(seed, 0x1a)), injured: [], nationOf }
}

/** IIHF World Junior Championship. Needs ≥ 8 nations. */
export function runWorldJuniors(args: { squads: Squad[]; players: Map<PlayerId, Player>; year: number; seed: number }): TournamentResult | null {
  const squads = args.squads.slice(0, 10)
  if (squads.length < 8) return null
  const ctx = makeCtx(args.players, args.seed, squads)
  // Serpentine seeding into two groups.
  const A: Squad[] = []; const B: Squad[] = []
  squads.forEach((s, i) => ((i % 4 === 0 || i % 4 === 3) ? A : B).push(s))
  const ga = roundRobin(ctx, A)
  const gb = roundRobin(ctx, B)
  const qA = ga.slice(0, 4).map((r) => r.squad)
  const qB = gb.slice(0, 4).map((r) => r.squad)
  const qfPairs: Array<[Squad, Squad]> = [[qA[0]!, qB[3]!], [qB[1]!, qA[2]!], [qB[0]!, qA[3]!], [qA[1]!, qB[2]!]]
  const qfWinners = qfPairs.map(([h, a]) => play(ctx, h, a, true))
  const sf1 = play(ctx, qfWinners[0]!.winner, qfWinners[1]!.winner, true)
  const sf2 = play(ctx, qfWinners[2]!.winner, qfWinners[3]!.winner, true)
  const bronze = play(ctx, sf1.loser, sf2.loser, true)
  const gold = play(ctx, sf1.winner, sf2.winner, true)
  const qfLosers = qfWinners.map((g) => g.loser)
  const out = [...ga.slice(4), ...gb.slice(4)].map((r) => r.squad)
  const placing = [gold.winner, gold.loser, bronze.winner, bronze.loser, ...qfLosers.sort((a, b) => b.strength - a.strength), ...out]
  return finish(ctx, 'worldJuniors', args.year, squads, placing, gold)
}

/** Olympic men's tournament (12 nations; smaller fields degrade gracefully to 8). */
export function runOlympics(args: { squads: Squad[]; players: Map<PlayerId, Player>; year: number; seed: number }): TournamentResult | null {
  const squads = args.squads.slice(0, 12)
  if (squads.length < 8) return null
  const ctx = makeCtx(args.players, args.seed, squads)
  const nGroups = squads.length >= 12 ? 3 : 2
  const groups: Squad[][] = Array.from({ length: nGroups }, () => [])
  squads.forEach((s, i) => {
    const row = Math.floor(i / nGroups)
    const col = row % 2 === 0 ? i % nGroups : nGroups - 1 - (i % nGroups)
    groups[col]!.push(s)
  })
  const tables = groups.map((g) => roundRobin(ctx, g))
  // Rank all nations: group position first, then points, GD, GF.
  const ranked: GroupRow[] = []
  for (let pos = 0; pos < 4; pos++) {
    const tier = tables.map((t) => t[pos]).filter((r): r is GroupRow => !!r)
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
    ranked.push(...tier)
  }
  const seeds = ranked.map((r) => r.squad)
  const byes = seeds.slice(0, 4)
  const qual = seeds.slice(4)
  const qualWinners: Squad[] = []
  const qualLosers: Squad[] = []
  for (let i = 0; i < qual.length / 2; i++) {
    const g = play(ctx, qual[i]!, qual[qual.length - 1 - i]!, true)
    qualWinners.push(g.winner); qualLosers.push(g.loser)
  }
  const qf = [byes[0]!, byes[1]!, byes[2]!, byes[3]!]
  const opp = [...qualWinners].sort((a, b) => seeds.indexOf(b) - seeds.indexOf(a)) // weakest winner meets #1
  const qfGames = qf.map((s, i) => play(ctx, s, opp[i] ?? qual[i]!, true))
  const sf1 = play(ctx, qfGames[0]!.winner, qfGames[3]!.winner, true)
  const sf2 = play(ctx, qfGames[1]!.winner, qfGames[2]!.winner, true)
  const bronze = play(ctx, sf1.loser, sf2.loser, true)
  const gold = play(ctx, sf1.winner, sf2.winner, true)
  const placing = [gold.winner, gold.loser, bronze.winner, bronze.loser,
    ...qfGames.map((g) => g.loser).sort((a, b) => seeds.indexOf(a) - seeds.indexOf(b)),
    ...qualLosers.sort((a, b) => seeds.indexOf(a) - seeds.indexOf(b))]
  return finish(ctx, 'olympics', args.year, squads, placing, gold)
}

/** Four-nation best-on-best: round robin, top two meet in the final. */
export function runNationsCup(args: { squads: Squad[]; players: Map<PlayerId, Player>; year: number; seed: number }): TournamentResult | null {
  const squads = args.squads.slice(0, 4)
  if (squads.length < 4) return null
  const ctx = makeCtx(args.players, args.seed, squads)
  const table = roundRobin(ctx, squads)
  const final = play(ctx, table[0]!.squad, table[1]!.squad, true)
  const placing = [final.winner, final.loser, table[2]!.squad, table[3]!.squad]
  const res = finish(ctx, 'nationsCup', args.year, squads, placing, final)
  res.record.bronze = null // no bronze game — third place is not a medal here
  return res
}

export type { Squad }
export type NationalTeamId = TeamId
