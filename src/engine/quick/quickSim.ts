/**
 * Quick-sim engine (docs/ARCHITECTURE.md §6, build step #2).
 *
 * Simulates a game in shift-sized slices: each shift, one forward line + one D
 * pair per team are on the ice. From the on-ice units' aggregate composites we
 * roll expected shots, resolve them against the goalie, and accumulate stats.
 *
 * It emits a SPARSE GameStream (faceoffs, shots, saves, goals, penalties,
 * period/game markers) — the SAME GameEvent contract the full engine uses, just
 * without carry/pass positional detail. That keeps background-league box scores
 * real while staying ~100–1000× faster than the watched-game engine.
 *
 * All numeric coefficients here are first-pass and will be replaced by the
 * calibration harness (build step #5).
 */
import type {
  CompositeRatings,
  GameEvent,
  GoalStrength,
  Player,
  PlayerId,
  Team,
  XY
} from '@domain'
import { Rng } from '@engine/shared/rng'
import type { GameRules } from '@engine/shared/rules'
import { emptyStat, type GameOutcome, type GamePlayerStat } from '@engine/shared/outcome'
import { coachFitMultiplier } from '@engine/league/coachProfile'

export type { GamePlayerStat } from '@engine/shared/outcome'

const PERIOD_SECONDS = 1200
const REGULATION_PERIODS = 3
const SHIFT_SECONDS = 40
const OT_SECONDS = 300

// League-average targets the coefficients aim at (calibration will refine).
const SHOTS_PER_TEAM_PER_GAME = 30
const SHIFTS_PER_GAME = (PERIOD_SECONDS * REGULATION_PERIODS) / SHIFT_SECONDS
const BASE_SHOTS_PER_SHIFT = SHOTS_PER_TEAM_PER_GAME / SHIFTS_PER_GAME
const BASE_SHOT_CONVERSION = 0.095 // ~ league shooting %
const PENALTY_CHANCE_PER_SHIFT = 0.045
const PENALTY_SECONDS = 120
const PP_SHOT_MULT = 1.6
const PK_SHOT_MULT = 0.7

/**
 * League-average xG per unblocked shot on goal — derived from the calibration
 * target (goals ÷ shots on goal ≈ 0.095 at league average). The quick-sim has
 * no rink-position data so it approximates as:
 *   xG ≈ LEAGUE_AVG_XG_PER_SHOT × (0.7 + danger × 0.6)
 * where danger is the quality draw already used for the goal-chance roll.
 * This makes high-danger shots (danger≈1) carry ~2× the xG of weak ones
 * (danger≈0), which matches the empirical distribution from the full engine.
 * The formula is deterministic (no Rng draw) so it adds no non-determinism.
 */
const LEAGUE_AVG_XG_PER_SHOT = 0.095

const LEAGUE_AVG = 50

/** Quick-sim returns the shared box-score contract. */
export type QuickSimResult = GameOutcome

/** Forward-line usage weights (top lines play more). */
const FWD_LINE_WEIGHTS = [0.3, 0.27, 0.24, 0.19]
const DEF_PAIR_WEIGHTS = [0.38, 0.34, 0.28]

interface OnIce {
  skaters: Player[]
  goalie: Player
}

function weightedIndex(rng: Rng, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.float(0, total)
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

function avg(players: Player[], pick: (c: CompositeRatings) => number): number {
  if (players.length === 0) return LEAGUE_AVG
  let s = 0
  for (const p of players) s += pick(p.composites)
  return s / players.length
}

/** Poisson sample (Knuth) — small lambdas only, which is all we use. */
function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng.next()
  } while (p > L)
  return k - 1
}

class TeamSim {
  readonly team: Team
  readonly resolve: (id: PlayerId) => Player
  goals = 0
  penaltyBoxUntil: number[] = [] // game-clock expiry times of active minors

  constructor(team: Team, resolve: (id: PlayerId) => Player) {
    this.team = team
    this.resolve = resolve
  }

  pickOnIce(rng: Rng): OnIce {
    const lines = this.team.lines
    const fwd = lines.forwards[weightedIndex(rng, FWD_LINE_WEIGHTS)]
    const pair = lines.defensePairs[weightedIndex(rng, DEF_PAIR_WEIGHTS)]
    const skaters = [...fwd, ...pair].map(this.resolve)
    const goalie = this.resolve(lines.goalies[0])
    return { skaters, goalie }
  }

  /** Active penalties at game-clock t (expired ones pruned). */
  shorthanded(t: number): boolean {
    this.penaltyBoxUntil = this.penaltyBoxUntil.filter((until) => until > t)
    return this.penaltyBoxUntil.length > 0
  }

  /** Clear the soonest-expiring minor (a PP goal ends one penalty). */
  clearEarliestPenalty(): void {
    if (this.penaltyBoxUntil.length === 0) return
    let idx = 0
    for (let i = 1; i < this.penaltyBoxUntil.length; i++) {
      if (this.penaltyBoxUntil[i] < this.penaltyBoxUntil[idx]) idx = i
    }
    this.penaltyBoxUntil.splice(idx, 1)
  }
}

function shotPosition(rng: Rng, attackingPositive: boolean, danger: number): XY {
  // Higher danger → closer to the net (toward |x| = 0.95) and nearer the slot.
  const depth = 0.6 + danger * 0.35
  const x = (attackingPositive ? 1 : -1) * depth
  const y = rng.float(-0.45, 0.45) * (1 - danger * 0.6)
  return { x, y }
}

interface Ctx {
  rng: Rng
  stream: GameEvent[]
  stats: Map<PlayerId, GamePlayerStat>
  /** Baseline rating this game's scoring is judged against. Defaults to the global
   *  LEAGUE_AVG (NHL). A weaker league passes its OWN lower average so its best
   *  players read as stars RELATIVE to their competition and produce realistic
   *  point totals — otherwise a junior loop of sub-50 skaters scores almost
   *  nothing and its leader tops out around 0.4 PPG. */
  leagueAvg: number
}

function stat(ctx: Ctx, id: PlayerId): GamePlayerStat {
  let s = ctx.stats.get(id)
  if (!s) {
    s = emptyStat(id)
    ctx.stats.set(id, s)
  }
  return s
}

// Forwards take the large majority of goals/points; without a position bias the
// elite offensive D (high scoring/playmaking composites + more ice on the top
// pair) out-scored forwards and dominated the points race. These factors pull
// the per-position share back toward reality (~3/4 of goals to forwards) without
// changing the total goals/assists per game. Scoring instinct still separates
// players within a position.
const D_GOAL_BIAS = 0.5
const D_ASSIST_BIAS = 0.6

/** Weighted pick of a shooter from the on-ice forwards/D by scoring instinct. */
function pickShooter(rng: Rng, skaters: Player[]): Player {
  const weights = skaters.map((p) => {
    const base = 1 + p.composites.scoring + p.composites.playmaking * 0.4
    return p.position === 'D' ? base * D_GOAL_BIAS : base
  })
  return skaters[weightedIndex(rng, weights)]
}

function pickAssists(rng: Rng, skaters: Player[], scorer: Player): Player[] {
  const mates = skaters.filter((p) => p.id !== scorer.id)
  if (mates.length === 0) return []
  const assists: Player[] = []
  const weights = mates.map((p) => {
    const base = 1 + p.composites.playmaking
    return p.position === 'D' ? base * D_ASSIST_BIAS : base
  })
  const primaryIdx = weightedIndex(rng, weights)
  if (rng.chance(0.85)) {
    assists.push(mates[primaryIdx])
    if (rng.chance(0.6) && mates.length > 1) {
      let secIdx = weightedIndex(rng, weights)
      if (secIdx === primaryIdx) secIdx = (secIdx + 1) % mates.length
      assists.push(mates[secIdx])
    }
  }
  return assists
}

/** Resolve one shift for the attacking team against the defending team. */
function simShift(
  ctx: Ctx,
  attacking: TeamSim,
  defending: TeamSim,
  atk: OnIce,
  def: OnIce,
  period: number,
  t: number,
  attackingPositive: boolean
): void {
  const { rng } = ctx

  // Strength state from active penalties.
  const atkSH = attacking.shorthanded(t)
  const defSH = defending.shorthanded(t)
  let strengthMult = 1
  let goalStrength: GoalStrength = 'ev'
  if (defSH && !atkSH) {
    strengthMult = PP_SHOT_MULT
    goalStrength = 'pp'
  } else if (atkSH && !defSH) {
    strengthMult = PK_SHOT_MULT
    goalStrength = 'sh'
  }

  const offense = avg(atk.skaters, (c) => c.scoring * 0.6 + c.playmaking * 0.4)
  const defense = avg(def.skaters, (c) => c.defensiveZone * 0.6 + c.takeaway * 0.4)

  const lgAvg = ctx.leagueAvg
  const rate =
    BASE_SHOTS_PER_SHIFT * (offense / lgAvg) * (lgAvg / Math.max(20 * lgAvg / LEAGUE_AVG, defense)) * strengthMult
  const shots = poisson(rng, rate)

  for (let s = 0; s < shots; s++) {
    const shooter = pickShooter(rng, atk.skaters)
    const tShot = t + rng.float(0, SHIFT_SECONDS)
    const danger = Math.max(
      0,
      Math.min(1, rng.normal(0.45 + (offense - defense) / 200, 0.2))
    )
    const from = shotPosition(rng, attackingPositive, danger)
    ctx.stream.push({
      t: tShot,
      period,
      type: 'shot',
      shooter: shooter.id,
      from,
      target: { x: attackingPositive ? 1 : -1, y: 0 },
      danger
    })
    const shooterStat = stat(ctx, shooter.id)
    shooterStat.shots++

    // Approximate xG: league-average per-shot scaled by danger quality.
    // No Rng draw — purely deterministic from the danger already sampled above.
    const shotXgApprox = LEAGUE_AVG_XG_PER_SHOT * (0.7 + danger * 0.6)
    shooterStat.xg = (shooterStat.xg ?? 0) + shotXgApprox

    const goalie = def.goalie
    const goalieStat = stat(ctx, goalie.id)
    goalieStat.shotsAgainst++
    goalieStat.xgAgainst = (goalieStat.xgAgainst ?? 0) + shotXgApprox

    const finish = shooter.composites.scoring / lgAvg
    const goaliePull = (goalie.composites.goaltending - lgAvg) / 220
    // Small coach roster-fit edge on finishing (neutral 1.0 when unset).
    const cf = attacking.team.coachFit === undefined ? 1 : coachFitMultiplier(attacking.team.coachFit)
    const pGoal = Math.max(
      0.01,
      Math.min(0.6, BASE_SHOT_CONVERSION * (0.4 + danger * 1.3) * finish * (1 - goaliePull) * cf)
    )

    if (rng.chance(pGoal)) {
      attacking.goals++
      goalieStat.goalsAgainst++
      const assists = pickAssists(rng, atk.skaters, shooter)
      stat(ctx, shooter.id).goals++
      for (const a of assists) stat(ctx, a.id).assists++
      // Plus/minus: on-ice skaters get ±1 on EV/SH goals (NHL rule excludes PP).
      if (goalStrength !== 'pp') {
        for (const sk of atk.skaters) stat(ctx, sk.id).plusMinus += 1
        for (const sk of def.skaters) stat(ctx, sk.id).plusMinus -= 1
      }
      // Credit the primary assister xA = shooter's xG for this shot.
      if (assists.length > 0) {
        const primaryA = stat(ctx, assists[0].id)
        primaryA.xA = (primaryA.xA ?? 0) + shotXgApprox
      }
      ctx.stream.push({
        t: tShot,
        period,
        type: 'goal',
        scorer: shooter.id,
        assists: assists.map((a) => a.id),
        strength: goalStrength,
        pos: from
      })
      // A power-play goal ends the penalty being killed.
      if (goalStrength === 'pp') defending.clearEarliestPenalty()
    } else {
      goalieStat.saves++
      ctx.stream.push({
        t: tShot,
        period,
        type: 'save',
        goalie: goalie.id,
        rebound: rng.chance(0.25),
        pos: from
      })
    }
  }

  // Penalties: drawn against the attacking unit by their collective recklessness.
  const proneness = avg(atk.skaters, (c) => c.penaltyProne) / LEAGUE_AVG
  if (rng.chance(PENALTY_CHANCE_PER_SHIFT * proneness)) {
    const offender = atk.skaters[weightedIndex(rng, atk.skaters.map((p) => 1 + p.composites.penaltyProne))]
    attacking.penaltyBoxUntil.push(t + PENALTY_SECONDS)
    stat(ctx, offender.id).penaltyMinutes += 2
    ctx.stream.push({
      t,
      period,
      type: 'penalty',
      player: offender.id,
      infraction: 'minor',
      minutes: 2
    })
  }
}

function creditToi(ctx: Ctx, onIce: OnIce, seconds: number): void {
  for (const p of onIce.skaters) stat(ctx, p.id).toi += seconds
  stat(ctx, onIce.goalie.id).toi += seconds
}

function faceoff(ctx: Ctx, hOn: OnIce, aOn: OnIce, period: number): void {
  const hC = hOn.skaters.reduce((best, p) =>
    p.composites.faceoffWin > best.composites.faceoffWin ? p : best
  )
  const aC = aOn.skaters.reduce((best, p) =>
    p.composites.faceoffWin > best.composites.faceoffWin ? p : best
  )
  const total = hC.composites.faceoffWin + aC.composites.faceoffWin || 1
  const winner = ctx.rng.chance(hC.composites.faceoffWin / total) ? hC : aC
  ctx.stream.push({
    t: 0,
    period,
    type: 'faceoff',
    zone: 'neutral',
    winner: winner.id,
    pos: { x: 0, y: 0 }
  })
}

function simPeriod(
  ctx: Ctx,
  home: TeamSim,
  away: TeamSim,
  period: number,
  lengthSeconds: number,
  suddenDeath: boolean
): boolean {
  const hOn = home.pickOnIce(ctx.rng)
  const aOn = away.pickOnIce(ctx.rng)
  faceoff(ctx, hOn, aOn, period)

  // Teams skate the same direction conventions; home attacks +x on odd periods.
  const homeAttacksPositive = period % 2 === 1

  for (let t = 0; t < lengthSeconds; t += SHIFT_SECONDS) {
    const homeUnit = home.pickOnIce(ctx.rng)
    const awayUnit = away.pickOnIce(ctx.rng)
    creditToi(ctx, homeUnit, SHIFT_SECONDS)
    creditToi(ctx, awayUnit, SHIFT_SECONDS)

    const beforeH = home.goals
    const beforeA = away.goals
    simShift(ctx, home, away, homeUnit, awayUnit, period, t, homeAttacksPositive)
    // Sudden death ends on the FIRST goal — check between the two teams' shifts
    // so a single step can never let both score and leave the game tied.
    if (suddenDeath && home.goals > beforeH) return true
    simShift(ctx, away, home, awayUnit, homeUnit, period, t, !homeAttacksPositive)
    if (suddenDeath && away.goals > beforeA) return true
  }
  ctx.stream.push({ t: lengthSeconds, period, type: 'periodEnd' })
  return false
}

function shootout(ctx: Ctx, home: TeamSim, away: TeamSim): void {
  // Best-of-3 then sudden death; a coin-flavored skill roll per attempt.
  const rng = ctx.rng
  const shooterSkill = (t: TeamSim): number => {
    const shooters = t.team.lines.forwards.flat().map(t.resolve)
    return avg(shooters, (c) => c.scoring) / ctx.leagueAvg
  }
  const goalieSkill = (t: TeamSim): number => {
    const g = t.resolve(t.team.lines.goalies[0])
    return g.composites.goaltending / ctx.leagueAvg
  }
  let h = 0
  let a = 0
  const attempt = (atk: TeamSim, def: TeamSim): boolean =>
    rng.chance(Math.max(0.1, Math.min(0.6, 0.33 * shooterSkill(atk) * (2 - goalieSkill(def)))))

  for (let round = 0; round < 3; round++) {
    if (attempt(home, away)) h++
    if (attempt(away, home)) a++
  }
  while (h === a) {
    const hg = attempt(home, away)
    const ag = attempt(away, home)
    if (hg) h++
    if (ag) a++
  }
  // The shootout winner is credited one goal (NHL convention).
  if (h > a) home.goals++
  else away.goals++
}

export interface QuickSimOptions {
  /** Seed for this single game; derive per-game from the season seed. */
  seed: number
  /**
   * Rule variant (default 'regularSeason'). 'playoff' replaces the 3v3 OT +
   * shootout with repeated 20-minute 5v5 sudden-death periods until a goal.
   */
  rules?: GameRules
  /**
   * Average skater rating of THIS game's league, used as the baseline scoring is
   * judged against. Defaults to the global NHL average (50) — pass a weaker
   * league's own average so its stars produce realistic totals relative to their
   * competition (juniors/Europe). NHL and AHL keep the default.
   */
  leagueAvg?: number
}

/**
 * Simulate occasional late empty-net goals in one-goal games: a team trailing
 * by 1 in the final 2 minutes will pull its goalie, exposing the net and
 * occasionally conceding an EN goal (or scoring to tie).
 */
function simEmptyNetPhase(
  ctx: Ctx,
  home: TeamSim,
  away: TeamSim,
  period: number,
  periodStart: number
): void {
  const { rng } = ctx
  const deficit = home.goals - away.goals
  if (deficit === 0 || Math.abs(deficit) > 1) return
  const trailing = deficit < 0 ? home : away
  const leading = deficit < 0 ? away : home

  // Trailing team pulls goalie; chance the leading team buries an EN goal.
  const trailingOn = trailing.pickOnIce(rng)
  const leadingOn = leading.pickOnIce(rng)
  const tEN = periodStart + PERIOD_SECONDS - rng.float(10, 100)

  // Higher chance of EN goal than a tie (empty nets go in ~85% of the time).
  if (rng.chance(0.35)) {
    // Leading team scores EN.
    const scorer = pickShooter(rng, leadingOn.skaters)
    const assists = pickAssists(rng, leadingOn.skaters, scorer)
    leading.goals++
    stat(ctx, scorer.id).goals++
    for (const a of assists) stat(ctx, a.id).assists++
    for (const sk of leadingOn.skaters) stat(ctx, sk.id).plusMinus += 1
    for (const sk of trailingOn.skaters) stat(ctx, sk.id).plusMinus -= 1
    stat(ctx, leadingOn.goalie.id).shotsAgainst++ // trailing goalie is pulled; no goalie stat
    ctx.stream.push({
      t: tEN,
      period,
      type: 'goal',
      scorer: scorer.id,
      assists: assists.map((a) => a.id),
      strength: 'en',
      pos: { x: 0.9 * (deficit < 0 ? -1 : 1), y: 0 }
    })
  } else if (rng.chance(0.18)) {
    // Trailing team ties it (rare but happens).
    const scorer = pickShooter(rng, trailingOn.skaters)
    const assists = pickAssists(rng, trailingOn.skaters, scorer)
    trailing.goals++
    stat(ctx, scorer.id).goals++
    for (const a of assists) stat(ctx, a.id).assists++
    for (const sk of trailingOn.skaters) stat(ctx, sk.id).plusMinus += 1
    for (const sk of leadingOn.skaters) stat(ctx, sk.id).plusMinus -= 1
    stat(ctx, leadingOn.goalie.id).shotsAgainst++
    stat(ctx, leadingOn.goalie.id).goalsAgainst++
    ctx.stream.push({
      t: tEN,
      period,
      type: 'goal',
      scorer: scorer.id,
      assists: assists.map((a) => a.id),
      strength: 'ev',
      pos: { x: 0.9 * (deficit < 0 ? 1 : -1), y: 0 }
    })
  }
}

export function quickSimGame(
  home: Team,
  away: Team,
  resolve: (id: PlayerId) => Player,
  opts: QuickSimOptions
): QuickSimResult {
  const rules = opts.rules ?? 'regularSeason'
  const rng = new Rng(opts.seed)
  const ctx: Ctx = { rng, stream: [], stats: new Map(), leagueAvg: opts.leagueAvg ?? LEAGUE_AVG }
  const homeSim = new TeamSim(home, resolve)
  const awaySim = new TeamSim(away, resolve)

  for (let period = 1; period <= REGULATION_PERIODS; period++) {
    simPeriod(ctx, homeSim, awaySim, period, PERIOD_SECONDS, false)
    // Occasional late empty-net goals in regulation one-goal games.
    simEmptyNetPhase(ctx, homeSim, awaySim, period, (period - 1) * PERIOD_SECONDS)
  }

  let decidedBy: QuickSimResult['decidedBy'] = 'regulation'

  if (homeSim.goals === awaySim.goals) {
    if (rules === 'playoff') {
      // Repeated 20-minute 5v5 sudden-death periods until somebody scores.
      decidedBy = 'overtime'
      let period = REGULATION_PERIODS + 1
      for (;;) {
        const otEnded = simPeriod(ctx, homeSim, awaySim, period, PERIOD_SECONDS, true)
        if (otEnded) break
        // If somehow no goal (period ran to full length in sudden-death) — try
        // another; in practice the random process almost always ends it, but
        // the loop prevents an infinite game when RNG is adversarial in tests.
        period++
      }
    } else {
      // Regular season: 5-minute 3-on-3, then shootout.
      const otEnded = simPeriod(ctx, homeSim, awaySim, REGULATION_PERIODS + 1, OT_SECONDS, true)
      if (otEnded) {
        decidedBy = 'overtime'
      } else {
        ctx.stream.push({ t: OT_SECONDS, period: REGULATION_PERIODS + 1, type: 'periodEnd' })
        shootout(ctx, homeSim, awaySim)
        decidedBy = 'shootout'
      }
    }
  }

  const finalPeriod =
    decidedBy === 'overtime'
      ? // Find the last periodEnd to get the actual OT period number.
        Math.max(
          REGULATION_PERIODS,
          ...ctx.stream.filter((e) => e.type === 'periodEnd').map((e) => e.period)
        )
      : REGULATION_PERIODS + (decidedBy === 'shootout' ? 1 : 0)

  ctx.stream.push({ t: 0, period: finalPeriod, type: 'gameEnd' })

  return {
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeGoals: homeSim.goals,
    awayGoals: awaySim.goals,
    decidedBy,
    stream: ctx.stream,
    playerStats: ctx.stats
  }
}
