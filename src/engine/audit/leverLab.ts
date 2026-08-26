/**
 * LEVER LAB — the measurement rig behind docs/LEVER-AUDIT.md (task #154).
 *
 * WHY THIS EXISTS
 * ---------------
 * Esports Manager 2026 went Mixed on Steam on one repeated complaint: "there are
 * many tactical options but most of them do not make any difference." A
 * management game is a promise that the GM's decisions ARE the game. The only
 * way to keep that promise honestly is to MEASURE every visible lever rather
 * than assert that it works. "Seems to work" is exactly the failure mode.
 *
 * THE METHOD
 * ----------
 * 1. Build a MIRROR MATCHUP: two byte-identical clones of one generated roster.
 *    With identical talent on both benches, any measured difference in outcome
 *    is caused by the lever and nothing else.
 * 2. Set the lever to its MAXIMUM on team A and its MINIMUM on team B, then sim
 *    N games alternating home ice (so home advantage cancels exactly). A's
 *    per-game goal differential is then an unbiased estimate of the lever's FULL
 *    SPAN — worst setting to best setting. Under the null (a dead lever) it is 0.
 * 3. Convert the differential into the unit a GM actually cares about:
 *
 *      seasonPoints = goalDiffPerGame x 82 / 6 x 2
 *
 *    (the standard ~6 goals of differential per win, 2 standings points per win).
 *    "This lever is worth 7 points in the standings" is a sentence a GM
 *    understands; "0.026 xGF/60" is not.
 * 4. Classify against a stated, fixed bar — see `classify` below. Significance
 *    uses the measured standard error, so a lever is never called REAL because
 *    of a lucky sample, and never called DEAD when the sample was too small to
 *    have seen it (that case reports as INCONCLUSIVE instead).
 *
 * Pure and deterministic: seeded RNG only, no wall-clock, no shared state. The
 * lab never mutates the generated league — every arm deep-clones its teams.
 */
import { generateLeague } from '@data/generate'
import { asPlayerId, asTeamId, type Player, type PlayerId, type Team } from '@domain'
import type { GameOutcome } from '@engine/shared/outcome'
import { quickSimGame } from '@engine/quick/quickSim'
import { fullSimGame } from '@engine/full/fullSim'
import { effectiveResolve } from '@engine/league/condition'
import { ratedOverall } from '@engine/ratings/composites'

/* ────────────────────────── mirror matchup ────────────────────────── */

export interface Rink {
  /** The team whose lever we push to MAX. */
  a: Team
  /** Byte-identical clone of A; its lever stays at MIN (the control). */
  b: Team
  resolve: (id: PlayerId) => Player
  /** Every player object in the rink, keyed by id (A's and B's clones). */
  players: Map<PlayerId, Player>
  aRoster: Set<string>
  bRoster: Set<string>
}

function cloneLines(lines: Team['lines'], map: (id: PlayerId) => PlayerId): Team['lines'] {
  return {
    forwards: lines.forwards.map((l) => l.map(map)) as Team['lines']['forwards'],
    defensePairs: lines.defensePairs.map((l) => l.map(map)) as Team['lines']['defensePairs'],
    goalies: lines.goalies.map(map) as Team['lines']['goalies'],
    powerPlayUnits: lines.powerPlayUnits.map((u) => u.map(map)),
    penaltyKillUnits: lines.penaltyKillUnits.map((u) => u.map(map)),
  }
}

/**
 * Two identical clubs on the same sheet of ice. `teamIndex` picks which
 * generated roster to clone — vary it to confirm a finding is not an artefact
 * of one particular roster.
 */
/** Generated leagues are expensive and immutable here (every rink deep-clones
 *  what it takes), so one per seed is enough for a whole harness run. */
const leagueCache = new Map<number, ReturnType<typeof generateLeague>>()

export function mirrorRink(seed = 99, teamIndex = 0): Rink {
  let data = leagueCache.get(seed)
  if (!data) {
    data = generateLeague({ seed })
    leagueCache.set(seed, data)
  }
  const src = data.teams.get(data.league.teams[teamIndex]!)!
  const players = new Map<PlayerId, Player>()
  const aRoster = new Set<string>()
  const bRoster = new Set<string>()

  const suffix = (s: 'A' | 'B') => (id: PlayerId): PlayerId => asPlayerId(`${id}_${s}`)
  const mkSide = (s: 'A' | 'B', teamId: string, abbr: string): Team => {
    const map = suffix(s)
    for (const id of src.roster) {
      const p = data.players.get(id)!
      const cid = map(id)
      players.set(cid, { ...structuredClone(p), id: cid })
      ;(s === 'A' ? aRoster : bRoster).add(cid as string)
    }
    return {
      ...structuredClone(src),
      id: asTeamId(teamId),
      abbreviation: abbr,
      roster: src.roster.map(map),
      lines: cloneLines(src.lines, map),
    }
  }

  const a = mkSide('A', 'LEVER_A', 'AAA')
  const b = mkSide('B', 'LEVER_B', 'BBB')
  const resolve = (id: PlayerId): Player => {
    const p = players.get(id)
    if (!p) throw new Error(`leverLab: unknown player ${id}`)
    return p
  }
  return { a, b, resolve, players, aRoster, bRoster }
}

/* ────────────────────────── series runner ────────────────────────── */

export type Engine = 'quick' | 'full'

export interface SeriesTotals {
  games: number
  /** Team A's per-game goal differential samples (A goals − B goals). */
  gd: number[]
  aGoals: number
  bGoals: number
  aWins: number
  aShots: number
  bShots: number
  aXg: number
  bXg: number
  aHits: number
  bHits: number
  aPim: number
  bPim: number
  /** A's power-play chances and goals (B's minors / A's 'pp' goals). */
  aPpOpps: number
  aPpGoals: number
  bPpOpps: number
  bPpGoals: number
}

function emptyTotals(): SeriesTotals {
  return {
    games: 0, gd: [], aGoals: 0, bGoals: 0, aWins: 0,
    aShots: 0, bShots: 0, aXg: 0, bXg: 0, aHits: 0, bHits: 0, aPim: 0, bPim: 0,
    aPpOpps: 0, aPpGoals: 0, bPpOpps: 0, bPpGoals: 0,
  }
}

function accumulate(t: SeriesTotals, rink: Rink, out: GameOutcome, aIsHome: boolean): void {
  const aG = aIsHome ? out.homeGoals : out.awayGoals
  const bG = aIsHome ? out.awayGoals : out.homeGoals
  t.games++
  t.gd.push(aG - bG)
  t.aGoals += aG
  t.bGoals += bG
  if (aG > bG) t.aWins++

  for (const [pid, s] of out.playerStats) {
    const mine = rink.aRoster.has(pid as string)
    if (!mine && !rink.bRoster.has(pid as string)) continue
    if (mine) {
      t.aShots += s.shots
      t.aXg += s.xg ?? 0
      t.aHits += s.hits
      t.aPim += s.penaltyMinutes
    } else {
      t.bShots += s.shots
      t.bXg += s.xg ?? 0
      t.bHits += s.hits
      t.bPim += s.penaltyMinutes
    }
  }

  // Special teams from the event stream: a minor to B is a chance for A.
  for (const ev of out.stream) {
    if (ev.type === 'penalty') {
      if (ev.minutes < 4) {
        if (rink.aRoster.has(ev.player as string)) t.bPpOpps++
        else if (rink.bRoster.has(ev.player as string)) t.aPpOpps++
      }
    } else if (ev.type === 'goal' && ev.strength === 'pp') {
      if (rink.aRoster.has(ev.scorer as string)) t.aPpGoals++
      else if (rink.bRoster.has(ev.scorer as string)) t.bPpGoals++
    }
  }
}

/**
 * Sim `games` mirror games, alternating home ice so the home-ice edge cancels
 * exactly (A is home on even indices, away on odd). Seeds are a fixed function
 * of the index so any two runs of the same arm are byte-identical.
 */
export function runSeries(
  rink: Rink,
  engine: Engine,
  games: number,
  seedBase = 500_000,
  /** Wrap the resolver the way career.ts does, so fatigue/morale/form/rust are
   *  read off the players. Only needed for condition levers — a pure tactical
   *  lever measures cleaner without that extra channel. */
  condition = false,
): SeriesTotals {
  const sim = engine === 'quick' ? quickSimGame : fullSimGame
  const t = emptyTotals()
  for (let i = 0; i < games; i++) {
    const aIsHome = i % 2 === 0
    const home = aIsHome ? rink.a : rink.b
    const away = aIsHome ? rink.b : rink.a
    // career.ts builds a fresh condition-adjusted resolver per game (the cache
    // must not leak across games), so the lab does the same.
    const resolve = condition ? effectiveResolve(rink.resolve) : rink.resolve
    const out = sim(home, away, resolve, { seed: seedBase + i })
    accumulate(t, rink, out, aIsHome)
  }
  return t
}

/* ────────────────────────── statistics ────────────────────────── */

/** Goals of differential per win (the classic NHL rule of thumb). */
const GOALS_PER_WIN = 6
/** Standings points per win. */
const POINTS_PER_WIN = 2
export const GAMES_PER_SEASON = 82
/** Δ goal-differential per game → Δ standings points across a full season. */
export const gdToSeasonPoints = (gdPerGame: number): number =>
  (gdPerGame * GAMES_PER_SEASON * POINTS_PER_WIN) / GOALS_PER_WIN

export interface LeverStat {
  games: number
  /** Mean per-game goal differential, A (max setting) over B (min setting). */
  gdPerGame: number
  /** Standard error of that mean. */
  se: number
  /** gdPerGame / se — how many standard errors from "no effect at all". */
  z: number
  /** The lever's full span expressed as standings points over 82 games. */
  seasonPoints: number
  /** 95% confidence interval on seasonPoints. */
  seasonPointsLo: number
  seasonPointsHi: number
  /** Smallest seasonPoints this sample size could have detected at z = 3. */
  detectionFloor: number
  aWinPct: number
  shotsPerGameDelta: number
  xgPerGameDelta: number
  hitsPerGameDelta: number
  pimPerGameDelta: number
  /** A's PP conversion minus B's, in percentage points (NaN if no chances). */
  ppPctDelta: number
}

export function summarize(t: SeriesTotals): LeverStat {
  const n = Math.max(1, t.games)
  const mean = t.gd.reduce((s, x) => s + x, 0) / n
  const variance = n > 1 ? t.gd.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0
  const se = Math.sqrt(variance / n)
  const z = se > 0 ? mean / se : 0
  const aPp = t.aPpOpps > 0 ? (t.aPpGoals / t.aPpOpps) * 100 : NaN
  const bPp = t.bPpOpps > 0 ? (t.bPpGoals / t.bPpOpps) * 100 : NaN
  return {
    games: t.games,
    gdPerGame: mean,
    se,
    z,
    seasonPoints: gdToSeasonPoints(mean),
    seasonPointsLo: gdToSeasonPoints(mean - 1.96 * se),
    seasonPointsHi: gdToSeasonPoints(mean + 1.96 * se),
    detectionFloor: gdToSeasonPoints(3 * se),
    aWinPct: t.aWins / n,
    shotsPerGameDelta: (t.aShots - t.bShots) / n,
    xgPerGameDelta: (t.aXg - t.bXg) / n,
    hitsPerGameDelta: (t.aHits - t.bHits) / n,
    pimPerGameDelta: (t.aPim - t.bPim) / n,
    ppPctDelta: aPp - bPp,
  }
}

/**
 * The classification bar. Fixed up front and applied identically to every lever
 * so no result can be talked into a nicer category after the fact.
 *
 *  REAL          — significant (|z| ≥ 3) AND worth ≥ 2 standings points across
 *                  the full span of the lever. Two points decides playoff races;
 *                  below that a GM cannot act on it.
 *  TOO WEAK      — significant, but worth < 2 points. It is wired and real, just
 *                  lost in the noise of a season.
 *  DEAD          — indistinguishable from zero (|z| < 2) at a sample large
 *                  enough to have detected a 2-point effect.
 *  INCONCLUSIVE  — not significant, but the sample could not have detected a
 *                  2-point effect either. Never report this as "works".
 */
export type Verdict = 'REAL' | 'TOO WEAK' | 'DEAD' | 'INCONCLUSIVE'

export const MEANINGFUL_POINTS = 2

export function classify(s: LeverStat): Verdict {
  const magnitude = Math.abs(s.seasonPoints)
  if (Math.abs(s.z) >= 3) return magnitude >= MEANINGFUL_POINTS ? 'REAL' : 'TOO WEAK'
  if (Math.abs(s.z) >= 2 && magnitude >= MEANINGFUL_POINTS) return 'TOO WEAK'
  return s.detectionFloor <= MEANINGFUL_POINTS ? 'DEAD' : 'INCONCLUSIVE'
}

/* ────────────────────────── lever definitions ────────────────────────── */

export interface LeverSpec {
  id: string
  /** Human name as the GM would see it. */
  name: string
  /** Where the GM sets it, or "—" if he cannot. */
  surface: string
  engine: Engine
  /** Apply the MAX / best / "on" setting to the team we are measuring. */
  max: (t: Team, rink: Rink) => void
  /** Apply the MIN / worst / "off" setting to the control team. */
  min: (t: Team, rink: Rink) => void
  /** Short note printed with the row (e.g. what the two settings are). */
  contrast: string
  /** Read the players through career.ts's condition-adjusted resolver (fatigue,
   *  morale, form, rust, contract motivation). Needed only by condition levers. */
  condition?: boolean
}

export interface LeverResult extends LeverStat {
  spec: LeverSpec
  verdict: Verdict
}

/** Run one lever end to end: clone a fresh rink, set both arms, sim, classify. */
export function measureLever(spec: LeverSpec, games: number, seed = 99, teamIndex = 0): LeverResult {
  const rink = mirrorRink(seed, teamIndex)
  spec.max(rink.a, rink)
  spec.min(rink.b, rink)
  const stat = summarize(runSeries(rink, spec.engine, games, 500_000 + hash(spec.id), spec.condition === true))
  return { ...stat, spec, verdict: classify(stat) }
}

/** Stable small integer from a lever id, so each lever uses its own seed block. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 100_000
}

/* ────────────────────────── roster helpers for lever arms ────────────────────────── */

/** Skater ids on a team, best first by the composite the caller cares about. */
export function skatersByRating(
  team: Team,
  resolve: (id: PlayerId) => Player,
  score: (p: Player) => number,
  position?: 'F' | 'D',
): PlayerId[] {
  return team.roster
    .map((id) => resolve(id))
    .filter((p) => p.position !== 'G')
    .filter((p) => (position === 'D' ? p.position === 'D' : position === 'F' ? p.position !== 'D' : true))
    .sort((x, y) => score(y) - score(x))
    .map((p) => p.id)
}

const offense = (p: Player): number => p.composites.scoring + p.composites.playmaking
const defence = (p: Player): number => p.composites.defensiveZone + p.composites.takeaway

/** Rebuild the 4 forward lines / 3 pairs from an ordered talent list. */
export function stackLines(team: Team, resolve: (id: PlayerId) => Player, order: 'best-first' | 'worst-first'): void {
  const dir = order === 'best-first' ? 1 : -1
  const fwds = skatersByRating(team, resolve, (p) => dir * offense(p), 'F')
  const defs = skatersByRating(team, resolve, (p) => dir * (offense(p) + defence(p)), 'D')
  const forwards: PlayerId[][] = []
  for (let i = 0; i < 4; i++) forwards.push(fwds.slice(i * 3, i * 3 + 3))
  const pairs: PlayerId[][] = []
  for (let i = 0; i < 3; i++) pairs.push(defs.slice(i * 2, i * 2 + 2))
  if (forwards.every((l) => l.length === 3) && pairs.every((l) => l.length === 2)) {
    team.lines.forwards = forwards as Team['lines']['forwards']
    team.lines.defensePairs = pairs as Team['lines']['defensePairs']
  }
}

/**
 * Reorder the board while dressing the SAME 18 skaters on both benches.
 *
 * This isolates the pure ORDERING decision from the dress/scratch one:
 * `stackLines` also changes who plays at all (best 12F vs worst 12F), which is a
 * different — and larger — lever. Both are real; the GM meets them on the same
 * screen, so the audit prices them separately.
 */
export function orderDressed(team: Team, resolve: (id: PlayerId) => Player, order: 'best-first' | 'worst-first'): void {
  const f = skatersByRating(team, resolve, (p) => ratedOverall(p), 'F').slice(0, 12)
  const d = skatersByRating(team, resolve, (p) => ratedOverall(p), 'D').slice(0, 6)
  if (f.length < 12 || d.length < 6) return
  const fo = order === 'best-first' ? f : [...f].reverse()
  const dd = order === 'best-first' ? d : [...d].reverse()
  team.lines.forwards = [0, 1, 2, 3].map((i) => fo.slice(i * 3, i * 3 + 3)) as Team['lines']['forwards']
  team.lines.defensePairs = [0, 1, 2].map((i) => dd.slice(i * 2, i * 2 + 2)) as Team['lines']['defensePairs']
}

/** Fill PP (or PK) units with the best — or the worst — men for the job. */
export function stackSpecialTeams(
  team: Team,
  resolve: (id: PlayerId) => Player,
  unit: 'pp' | 'pk',
  quality: 'best' | 'worst',
): void {
  const metric = unit === 'pp' ? offense : defence
  const dir = quality === 'best' ? 1 : -1
  const fwds = skatersByRating(team, resolve, (p) => dir * metric(p), 'F')
  const defs = skatersByRating(team, resolve, (p) => dir * metric(p), 'D')
  // NHL shape: PP1 = 3F+2D (or 4F+1D), PK1 = 2F+2D. Keep it 3F/2D and 2F/2D.
  const units: PlayerId[][] =
    unit === 'pp'
      ? [[...fwds.slice(0, 3), ...defs.slice(0, 2)], [...fwds.slice(3, 6), ...defs.slice(2, 4)]]
      : [[...fwds.slice(0, 2), ...defs.slice(0, 2)], [...fwds.slice(2, 4), ...defs.slice(2, 4)]]
  const key = unit === 'pp' ? 'powerPlayUnits' : 'penaltyKillUnits'
  if (units.every((u) => u.length >= 4)) team.lines[key] = units
}

/** Put the better (or worse) of the two goalies in net. */
export function orderGoalies(team: Team, resolve: (id: PlayerId) => Player, which: 'best' | 'worst'): void {
  const gs = team.roster
    .map((id) => resolve(id))
    .filter((p) => p.position === 'G')
    .sort((x, y) => y.composites.goaltending - x.composites.goaltending)
  if (gs.length < 2) return
  const ordered = which === 'best' ? gs : [...gs].reverse()
  team.lines.goalies = [ordered[0]!.id, ordered[1]!.id] as Team['lines']['goalies']
}
