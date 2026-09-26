/**
 * OTHER LEAGUES THAT REMEMBER.
 *
 * The world's leagues used to play a regular season and then simply stop: no
 * playoffs, no champion, no awards, and at rollover the standings were zeroed
 * with nothing kept. This module gives every simulated league a postseason in
 * its real (simplified) format, a champion, a regular-season award slate, and a
 * compact, permanent history record — so "Frölunda three-peat" can exist.
 *
 * Formats (simplified from the real leagues, 2024–25):
 *  - KHL Gagarin Cup: 16 teams, four best-of-7 rounds.
 *  - SHL Le Mat Trophy / Liiga Kanada-malja / NL / DEL / Czech Extraliga:
 *    top 6 + a 7–10 play-in in reality; here the top 8, best-of-7 throughout.
 *  - CHL (OHL Robertson Cup, WHL Chynoweth Cup, QMJHL President's Cup): 16
 *    teams, best-of-7; the three champions + the best other CHL club (the host)
 *    then play the MEMORIAL CUP (round robin → semi-final → final).
 *  - USHL Clark Cup: 8 teams, bo3 then bo5. NAHL Robertson Cup: bo5.
 *  - NCAA: a 16-team single-elimination national tournament (Frozen Four).
 *  - MHL Kharlamov Cup: 16 teams, bo5 early rounds then bo7.
 *  - European U20 loops: 8 teams, best-of-5. ECHL Kelly Cup: 16, bo7.
 *  - Anything else: top 8, best-of-5/5/7.
 *
 * Pure: the caller supplies a `playGame` that runs the real quick-sim.
 */
import type { Competition, Player, PlayerId, Standing, WorldPlayerRef, WorldSeasonRecord } from '@domain'
import { canonicalLeagueKey } from '@engine/league/leagueStrength'
import type { GamePlayerStat } from '@engine/shared/outcome'

/* ───────────────────────── formats ───────────────────────── */

export interface LeagueFormat {
  trophy: string
  /** Playoff field (clamped to a power of two ≤ team count). */
  field: number
  /** Best-of per round, first round first. 1 = single game. */
  bestOf: number[]
}

const FORMATS: Record<string, LeagueFormat> = {
  KHL: { trophy: 'Gagarin Cup', field: 16, bestOf: [7, 7, 7, 7] },
  SHL: { trophy: 'Le Mat Trophy', field: 8, bestOf: [7, 7, 7] },
  LIIGA: { trophy: 'Kanada-malja', field: 8, bestOf: [7, 7, 7] },
  NL: { trophy: 'National League title', field: 8, bestOf: [7, 7, 7] },
  DEL: { trophy: 'German championship', field: 8, bestOf: [7, 7, 7] },
  EXTRALIGA: { trophy: 'Extraliga title', field: 8, bestOf: [7, 7, 7] },
  VHL: { trophy: 'Petrov Cup', field: 16, bestOf: [5, 7, 7, 7] },
  MESTIS: { trophy: 'Mestis title', field: 8, bestOf: [5, 5, 5] },
  ECHL: { trophy: 'Kelly Cup', field: 16, bestOf: [7, 7, 7, 7] },
  OHL: { trophy: 'J. Ross Robertson Cup', field: 16, bestOf: [7, 7, 7, 7] },
  WHL: { trophy: 'Ed Chynoweth Cup', field: 16, bestOf: [7, 7, 7, 7] },
  QMJHL: { trophy: 'President\'s Cup', field: 16, bestOf: [7, 7, 7, 7] },
  USHL: { trophy: 'Clark Cup', field: 8, bestOf: [3, 5, 5] },
  NAHL: { trophy: 'Robertson Cup', field: 8, bestOf: [5, 5, 5] },
  BCHL: { trophy: 'Fred Page Cup', field: 4, bestOf: [7, 7] },
  NCAA: { trophy: 'NCAA national championship', field: 16, bestOf: [1, 1, 1, 1] },
  MHL: { trophy: 'Kharlamov Cup', field: 16, bestOf: [5, 5, 7, 7] },
  J20: { trophy: 'J20 Nationell title', field: 8, bestOf: [5, 5, 5] },
  U20SM: { trophy: 'U20 SM-sarja title', field: 8, bestOf: [5, 5, 5] },
  CZEJR: { trophy: 'Czech junior title', field: 8, bestOf: [5, 5, 5] },
  SVKJR: { trophy: 'Slovak junior title', field: 8, bestOf: [5, 5, 5] },
  DNL: { trophy: 'DNL title', field: 8, bestOf: [5, 5, 5] },
}

/** Resolution order through the NHL playoffs: small loops first, the majors
 *  late, the Memorial Cup last (late May, like the real calendar). */
export const RESOLVE_ORDER = [
  'NTDP', 'DNL', 'SVKJR', 'CZEJR', 'U20SM', 'J20', 'NAHL', 'BCHL', 'MESTIS', 'NCAA', 'USHL', 'MHL',
  'DEL', 'NL', 'EXTRALIGA', 'LIIGA', 'SHL', 'VHL', 'ECHL', 'QMJHL', 'WHL', 'OHL', 'KHL',
]

export const CHL_KEYS = ['OHL', 'WHL', 'QMJHL'] as const
export const MEMORIAL_CUP_ID = 'memorial-cup'

export function leagueFormat(comp: Pick<Competition, 'abbrev' | 'name'>): LeagueFormat {
  const key = canonicalLeagueKey(comp.abbrev, comp.name)
  return FORMATS[key] ?? { trophy: `${comp.abbrev} title`, field: 8, bestOf: [5, 5, 7] }
}

/* ───────────────────────── the bracket ───────────────────────── */

export interface WorldSeries {
  round: number
  high: string
  low: string
  highWins: number
  lowWins: number
  winner: string
}

export interface BracketResult {
  champion: string
  runnerUp: string
  finalScore: string
  series: WorldSeries[]
}

/**
 * Run a seeded single-bracket playoff. `seeds` best-first. Best-of per round;
 * the higher seed hosts games 1, 2, 5, 7 (2-2-1-1-1). Returns null for a field
 * smaller than two.
 */
export function runBracket(args: {
  seeds: string[]
  format: LeagueFormat
  playGame: (home: string, away: string, gameIndex: number) => string
}): BracketResult | null {
  let size = 1
  while (size * 2 <= Math.min(args.format.field, args.seeds.length)) size *= 2
  if (size < 2) return null
  let alive = args.seeds.slice(0, size)
  const series: WorldSeries[] = []
  let gameIndex = 0
  let round = 0
  // Rounds needed for this field; take the LAST bestOf entries (the final is
  // always the last entry) so a smaller field keeps the longer late rounds.
  const rounds = Math.log2(size)
  const plan = args.format.bestOf.slice(Math.max(0, args.format.bestOf.length - rounds))
  while (plan.length < rounds) plan.unshift(plan[0] ?? 5)
  let final: WorldSeries | null = null
  while (alive.length > 1) {
    const bestOf = plan[round] ?? 5
    const need = Math.ceil(bestOf / 2)
    const next: string[] = []
    for (let i = 0; i < alive.length / 2; i++) {
      const high = alive[i]!
      const low = alive[alive.length - 1 - i]!
      let hw = 0
      let lw = 0
      while (hw < need && lw < need) {
        const g = hw + lw
        const homeIsHigh = g === 0 || g === 1 || g === 4 || g === 6
        const winner = args.playGame(homeIsHigh ? high : low, homeIsHigh ? low : high, gameIndex++)
        if (winner === high) hw++
        else lw++
      }
      const s: WorldSeries = { round, high, low, highWins: hw, lowWins: lw, winner: hw > lw ? high : low }
      series.push(s)
      next.push(s.winner)
      if (alive.length === 2) final = s
    }
    alive = next
    round++
  }
  const champion = alive[0]!
  const f = final!
  const champWins = f.winner === f.high ? f.highWins : f.lowWins
  const loseWins = f.winner === f.high ? f.lowWins : f.highWins
  return {
    champion,
    runnerUp: f.winner === f.high ? f.low : f.high,
    finalScore: `${champWins}–${loseWins}`,
    series,
  }
}

/* ───────────────────────── Memorial Cup ───────────────────────── */

/**
 * Four-team Memorial Cup: a single round robin, then #2 v #3 in the semi-final
 * and the winner meets #1 in a one-game final. `teams` = [OHL champ, WHL champ,
 * QMJHL champ, host]. Returns champion + runner-up + final score.
 */
export function runMemorialCup(args: {
  teams: string[]
  playGame: (home: string, away: string, gameIndex: number) => { winner: string; score: string }
  /** Tiebreak order (host first, then league order) for equal RR records. */
}): { champion: string; runnerUp: string; finalScore: string } | null {
  const t = args.teams
  if (t.length < 4) return null
  const wins = new Map(t.map((id) => [id, 0]))
  let gi = 0
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) {
      const home = (i + j) % 2 === 0 ? t[i]! : t[j]!
      const away = home === t[i] ? t[j]! : t[i]!
      const r = args.playGame(home, away, gi++)
      wins.set(r.winner, (wins.get(r.winner) ?? 0) + 1)
    }
  }
  const order = [...t].sort((a, b) => (wins.get(b)! - wins.get(a)!) || t.indexOf(b) - t.indexOf(a))
  const semi = args.playGame(order[1]!, order[2]!, gi++)
  const fin = args.playGame(order[0]!, semi.winner, gi++)
  const runnerUp = fin.winner === order[0] ? semi.winner : order[0]!
  return { champion: fin.winner, runnerUp, finalScore: fin.score }
}

/* ───────────────────────── awards ───────────────────────── */

export interface AwardInputs {
  comp: Competition
  playerIds: PlayerId[]
  players: Map<PlayerId, Player>
  totals: Map<PlayerId, GamePlayerStat>
  gp: Map<PlayerId, number>
  teamAbbrOf: (id: PlayerId) => string
  /** Team standings points by player (their club's), for the MVP tiebreak. */
  teamPointsOf: (id: PlayerId) => number
}

export function leagueAwards(a: AwardInputs): Pick<WorldSeasonRecord, 'mvp' | 'topScorer' | 'topGoalie' | 'rookie'> {
  const out: Pick<WorldSeasonRecord, 'mvp' | 'topScorer' | 'topGoalie' | 'rookie'> = {}
  let maxGp = 0
  for (const id of a.playerIds) maxGp = Math.max(maxGp, a.gp.get(id) ?? 0)
  if (maxGp === 0) return out
  const minSkaterGp = Math.max(5, Math.round(maxGp * 0.4))
  const minGoalieGp = Math.max(5, Math.round(maxGp * 0.33))
  const ref = (id: PlayerId, value: string): WorldPlayerRef => ({
    playerId: id as string, name: a.players.get(id)?.name ?? '?', teamAbbr: a.teamAbbrOf(id), value,
  })
  const skaters: Array<{ id: PlayerId; pts: number; g: number; gp: number; rookie: boolean }> = []
  const goalies: Array<{ id: PlayerId; sv: number; gp: number }> = []
  let saves = 0, shots = 0
  for (const id of a.playerIds) {
    const p = a.players.get(id)
    const t = a.totals.get(id)
    const gp = a.gp.get(id) ?? 0
    if (!p || !t || gp === 0) continue
    if (p.position === 'G') {
      saves += t.saves; shots += t.shotsAgainst
      if (gp >= minGoalieGp && t.shotsAgainst > 0) goalies.push({ id, sv: t.saves / t.shotsAgainst, gp })
    } else if (gp >= minSkaterGp) {
      const rookie = !(p.careerHistory ?? []).some((h) => h.league === a.comp.name && h.gamesPlayed > 0)
      skaters.push({ id, pts: t.goals + t.assists, g: t.goals, gp, rookie })
    }
  }
  const byPts = (x: { pts: number; g: number; id: PlayerId }, y: { pts: number; g: number; id: PlayerId }): number =>
    y.pts - x.pts || y.g - x.g || (x.id < y.id ? -1 : 1)
  skaters.sort(byPts)
  const top = skaters[0]
  if (top) out.topScorer = ref(top.id, `${top.pts} PTS`)
  goalies.sort((x, y) => y.sv - x.sv || y.gp - x.gp || (x.id < y.id ? -1 : 1))
  const g = goalies[0]
  if (g) out.topGoalie = ref(g.id, g.sv.toFixed(3).replace(/^0/, ''))
  const rook = skaters.filter((s) => s.rookie).sort(byPts)[0]
  if (rook) out.rookie = ref(rook.id, `${rook.pts} PTS`)
  // MVP: the scoring race weighted by how much his club won, with an elite
  // goalie able to steal it (save % well above the league on a heavy load).
  const lgSv = shots > 0 ? saves / shots : 0.9
  let best: { id: PlayerId; score: number; value: string } | null = null
  for (const s of skaters.slice(0, 12)) {
    const score = (s.pts / s.gp) * 60 + a.teamPointsOf(s.id) * 0.08
    if (!best || score > best.score) best = { id: s.id, score, value: `${s.pts} PTS` }
  }
  for (const gg of goalies.slice(0, 3)) {
    const score = (gg.sv - lgSv) * 2400 * Math.min(1, gg.gp / (maxGp * 0.7)) + a.teamPointsOf(gg.id) * 0.08 + 40
    if (!best || score > best.score) best = { id: gg.id, score, value: gg.sv.toFixed(3).replace(/^0/, '') }
  }
  if (best) out.mvp = ref(best.id, best.value)
  return out
}

/** Standings best-first (points, then goal difference, then id). */
export function orderStandings(rows: Standing[]): Standing[] {
  return [...rows].sort((a, b) =>
    b.points - a.points ||
    (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) ||
    ((a.teamId as string) < (b.teamId as string) ? -1 : 1))
}
