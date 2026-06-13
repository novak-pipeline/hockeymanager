/**
 * Full-fidelity match engine (docs/ARCHITECTURE.md §5, build step #3) —
 * DIRECTOR / CHOREOGRAPHER architecture.
 *
 * Where the quick-sim aggregates a game into 40-second shifts, this engine
 * steps play forward every FRAME_DT seconds and emits a positional `frame` on
 * each step — the dense GameStream a renderer animates. Discrete events (shot,
 * save, goal, hit, penalty, faceoff) are layered on top at the tick they occur.
 *
 * Play is no longer emergent soup. It is DIRECTED:
 *
 *   - THE DIRECTOR (director.ts) is a seeded semi-Markov sampler over BEATS —
 *     breakout, regroup, entryCarry, entryDump, entryFailedOffside,
 *     cyclePossession, pointShot, seamOneTimer, rushShot, wraparound,
 *     reboundScramble, turnoverCounter, dzClear, icingWhistle, offsideWhistle,
 *     goalieFreeze, penaltyWhistle, lineChange, faceoff. Transition weights and
 *     hazard rates derive from CALIBRATION_TARGETS.sequences (real NHL
 *     play-by-play rhythm: stoppages per game, zone-time shares, entry and
 *     rush-shot rates, whistle cadence), with NHL-shaped fallbacks until that
 *     optional field lands. Team strength, tactics, and the strength state
 *     modulate the weights — better teams sample more offensive-zone beats, a
 *     trap team suppresses opponent carries, a PP shoots more eagerly.
 *
 *   - THE CHOREOGRAPHER (playbook.ts) renders each beat as an authored play —
 *     BREAKOUT_WHEEL / BREAKOUT_RIM, NZ_REGROUP, ENTRY_CARRY_WIDE (trailers
 *     hard-clamped ONSIDE), ENTRY_DUMP_CHASE, OZ_CYCLE, POINT_SHOT_SCREEN,
 *     SEAM_ONE_TIMER, RUSH_2v1/3v2, WRAPAROUND_JAM, REBOUND_CRASH — while the
 *     defending side simultaneously runs its counter-template from
 *     formations.ts (1-2-2 / 2-1-2 / trap forechecks, box+1 or man D-zone
 *     coverage, rush gap control, PK box/diamond vs PP umbrella/1-3-1/overload,
 *     faceoff lineups at the correct nine dots).
 *
 *   - OFFSIDES are real: at the data-driven rate an entry dies offside — a
 *     winger visibly beats the puck across the line, the whistle goes, and the
 *     faceoff comes back to the neutral-zone dot nearest the blue line.
 *
 * Shot OUTCOMES keep the calibrated machinery: every attempt's danger comes
 * from the real NHL xG surface at the true origin (lookupXg), blocks split off
 * via ON_GOAL_SHARE, finishing is reconciled by FINISH_K against the goalie's
 * composite, and rebounds become live pucks both teams crash.
 *
 * Skating uses per-player top speed (~24–34 ft/s from composites.skating) with
 * finite acceleration, so no skater ever moves more than topSpeed × dt in one
 * tick. The puck flies at real speeds (passes ~60–90 ft/s, shots ~90–130 ft/s)
 * and dump-ins/clears/rebounds become LOOSE pucks that both teams race to.
 *
 * Stoppages — goals, goalie freezes, icings, offsides, penalties, and "other"
 * (puck out of play) — all stop play at NHL cadence; both teams then SKATE to
 * the proper one of the nine dots and a real faceoff is conducted.
 *
 * Strength states are REAL, not just rate multipliers:
 *   - A penalized team ices 4 skaters (3 if two minors overlap; never fewer)
 *     drawn from its penaltyKillUnits; the opponent deploys a powerPlayUnit.
 *   - Penalty expiry is tracked on the ABSOLUTE game clock so a minor taken
 *     late in a period is still being killed after the intermission.
 *   - Regular-season overtime is 3-on-3 (5 minutes, sudden death) followed by a
 *     shootout; `rules: 'playoff'` instead plays repeated 20-minute 5v5
 *     sudden-death periods until somebody scores — never a shootout.
 *   - A team down 1–2 in the last stretch of regulation pulls its goalie for a
 *     6th skater (the goalie snapshot parks at the bench); goals into the empty
 *     net carry strength 'en'.
 */
import type {
  GoalStrength,
  Player,
  PlayerId,
  SkaterSnapshot,
  Team,
  XY,
  Zone
} from '@domain'
import { Rng } from '@engine/shared/rng'
import type { GameRules } from '@engine/shared/rules'
import { emptyStat, type GameOutcome, type GamePlayerStat } from '@engine/shared/outcome'
import { CALIBRATION_TARGETS, lookupXg } from '@calibrate'
import {
  FRAME_DT,
  LEAGUE_AVG,
  O_BLUE,
  X_FT,
  Y_FT,
  clamp,
  distFt,
  nearestIdx,
  type BeatKind,
  type Ctx,
  type FullSimTelemetry,
  type RSkater,
  type ShotKind,
  type StoppageCounts,
  type Unit
} from './types'
import { steer, type MoveOrder } from './movement'
import { defenderOrders, faceoffOrders, faceoffSpot } from './formations'
import { attackPlayOrders, phaseForPlay, type PlayId } from './playbook'
import { Director } from './director'

const PERIOD_SECONDS = 1200
const REGULATION_PERIODS = 3
const OT_SECONDS = 300
const SHIFT_SECONDS = 40

const PENALTY_SECONDS = 120
// PP/PK shot-rate multipliers. With a REAL man advantage on the ice (5v4 units)
// part of the historical 1.6×/0.7× imbalance now emerges from the extra/missing
// skater itself, so the explicit multipliers are retuned smaller.
const PP_SHOT_MULT = 1.45
const PK_SHOT_MULT = 0.75
// A 6th attacker (goalie pulled) tilts the ice without a penalty.
const EXTRA_ATTACKER_SHOT_MULT = 1.25

// Goalie pull: trailing by 1–2 inside the final stretch of regulation.
const PULL_WINDOW_SECONDS = 90
const PULL_MAX_DEFICIT = 2
const BENCH_X = 0.97
const BENCH_Y = -0.85
/** P(goal) for an unblocked shot at an empty net. */
const EN_GOAL_P = 0.85

// --- Data-driven calibration (src/calibrate/targets.json, from real NHL PBP) ---
//
// Event rates and shot danger come from real play-by-play, not feel. Per-tick
// probabilities are the per-game NHL targets spread over the number of
// "decision" ticks a game produces (a tick where the puck is settled on a
// carrier — not in flight, not loose, not waiting for a faceoff).
// DECISION_TICKS_PER_GAME was measured from the engine itself (see the
// calibration snapshot in calibration.test.ts).
const RATES = CALIBRATION_TARGETS.perTeamPerGame
const XG = CALIBRATION_TARGETS.xgSurface
const FENWICK_FALLBACK = CALIBRATION_TARGETS.shooting.fenwickShootingPct

const DECISION_TICKS_PER_GAME = 8700

/** What fraction of shot attempts reach the net (the rest are blocked). */
const ON_GOAL_SHARE = RATES.shotsOnGoal / (RATES.shotsOnGoal + RATES.blockedShots)

// Correction applied to the empirical xG so that GOALS/game match the target:
// the director's shot mix is structure-weighted (screens, seams, rushes), so it
// is higher-quality than a flat league average; this scalar reconciles the two.
// Measured against the engine, then frozen.
const FINISH_K = 0.6

// Non-shot events: per-game target → per-decision-tick probability. Hits and
// takeaways are gated on the pressuring defender actually being near the puck
// (a check from across the rink would look absurd), so their constants carry a
// measured boost for the fraction of ticks that pass the proximity gate.
const HIT_P = ((2 * RATES.hits) / DECISION_TICKS_PER_GAME) * 1.78
const TAKEAWAY_P = ((2 * RATES.takeaways) / DECISION_TICKS_PER_GAME) * 2.25
const GIVEAWAY_P = (2 * RATES.giveaways) / DECISION_TICKS_PER_GAME
const PENALTY_P = RATES.penalties / DECISION_TICKS_PER_GAME

// Passing tempo: base per-tick chance, raised by defensive pressure and pace.
const PASS_BASE = 0.06
// Force the carrier to move the puck if he holds it longer than this (ticks).
const MAX_HOLD_TICKS = 20

// Puck speeds in real ft/s.
const SHOT_SPEED_MIN = 90
const SHOT_SPEED_RANGE = 40
const DUMP_SPEED = 95
const CLEAR_SPEED = 102
/** Per-tick decay of a loose puck's velocity (ice friction). */
const LOOSE_FRICTION = 0.93
/** A skater this close (ft) to a loose puck can pick it up. */
const RECOVER_FT = 5.5

// Dead-time tuning: a faceoff is conducted once both centers reach the dot.
const FACEOFF_MIN_WAIT = 6
const FACEOFF_MAX_WAIT = 48
const FACEOFF_READY_FT = 8
/**
 * Goal celebration: ticks where the scoring team skates to the scorer.
 * 16 ticks = 4.0 s at 0.25 s/tick.
 */
const GOAL_CELEBRATION_TICKS = 16
/**
 * Faceoff-staging ticks added on top of celebration (skaters travel to dots).
 * The existing FACEOFF_MIN_WAIT / FACEOFF_READY_FT gate finishes the job;
 * this gives them an extended dead window to travel from the celebration cluster.
 */
const GOAL_EXTRA_STAGING_TICKS = 14

/** The nine faceoff dots, matching the dots the renderer draws. */
const CENTER_DOT: XY = { x: 0, y: 0 }
const EZ_X = 0.6
const NZ_DOT_X = 0.2
const DOT_Y = 0.55

const ALL_DOTS: XY[] = [
  CENTER_DOT,
  { x: -NZ_DOT_X, y: -DOT_Y },
  { x: -NZ_DOT_X, y: DOT_Y },
  { x: NZ_DOT_X, y: -DOT_Y },
  { x: NZ_DOT_X, y: DOT_Y },
  { x: -EZ_X, y: -DOT_Y },
  { x: -EZ_X, y: DOT_Y },
  { x: EZ_X, y: -DOT_Y },
  { x: EZ_X, y: DOT_Y }
]

/** Empirical xG for a shot from normalized rink position toward the attacked net. */
function shotXg(puck: XY, attackSign: number): number {
  const dxFt = Math.abs(attackSign * 89 - puck.x * 100) // along-ice ft to that net
  const yFt = Math.abs(puck.y * 42.5)
  const dist = Math.hypot(dxFt, yFt)
  const angle = (Math.atan2(yFt, Math.max(dxFt, 0.0001)) * 180) / Math.PI
  return lookupXg(XG, dist, angle, FENWICK_FALLBACK)
}

const FWD_LINE_WEIGHTS = [0.3, 0.27, 0.24, 0.19]
const DEF_PAIR_WEIGHTS = [0.38, 0.34, 0.28]
const SPECIAL_UNIT_WEIGHTS = [0.62, 0.38]

/** Formation slots by on-ice skater count. 5v5 keeps [LW, C, RW, LD, RD]. */
const SLOTS_BY_COUNT: Record<number, number[]> = {
  3: [1, 3, 4],
  4: [0, 2, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 1]
}

function stat(ctx: Ctx, id: PlayerId): GamePlayerStat {
  let s = ctx.stats.get(id)
  if (!s) {
    s = emptyStat(id)
    ctx.stats.set(id, s)
  }
  return s
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

/** An active minor. Expiry is on the ABSOLUTE game clock, not period-local —
 * a penalty taken at 19:10 of the 2nd is still being killed at 0:30 of the 3rd. */
interface BoxedPenalty {
  expiresAt: number
  playerId: PlayerId
}

type DeployKind = 'ev' | 'pp' | 'pk' | 'ot'

class TeamSim {
  readonly team: Team
  readonly resolve: (id: PlayerId) => Player
  /** Mean lineup quality (≈ league avg 50) — the director's strength input. */
  readonly strength: number
  /** Whether this side defends the +x or -x net this period (set per period). */
  defendsPositive = false
  goals = 0
  unit!: Unit
  penalties: BoxedPenalty[] = []
  /** Net empty for an extra attacker (trailing late in regulation). */
  pulled = false
  /** "<kind>:<count>" of the current deployment, so strength changes redeploy. */
  deployKey = ''

  constructor(team: Team, resolve: (id: PlayerId) => Player) {
    this.team = team
    this.resolve = resolve
    const ids = [...team.lines.forwards.flat(), ...team.lines.defensePairs.flat()]
    let s = 0
    let n = 0
    for (const id of ids) {
      const p = resolve(id)
      s +=
        (p.composites.scoring +
          p.composites.playmaking +
          p.composites.skating +
          p.composites.defensiveZone) /
        4
      n++
    }
    this.strength = n > 0 ? s / n : LEAGUE_AVG
  }

  /** Net this side defends (+1 / -1). */
  ownSign(): number {
    return this.defendsPositive ? 1 : -1
  }

  /** Net this side attacks (+1 / -1). */
  attackSign(): number {
    return this.defendsPositive ? -1 : 1
  }

  /**
   * Put a unit on the ice for the given strength state. When `inherit` is given
   * the incoming skaters take the outgoing skaters' slot positions, so the
   * change is seamless on screen; otherwise they fan out in their own end.
   */
  deploy(rng: Rng, kind: DeployKind, count: number, inherit?: XY[]): void {
    const ids = this.deployIds(rng, kind, count)
    const slots = SLOTS_BY_COUNT[ids.length] ?? SLOTS_BY_COUNT[5]
    const sign = this.ownSign()
    const skaters: RSkater[] = ids.map((id, i) => ({
      player: this.resolve(id),
      pos: inherit?.[i]
        ? { x: inherit[i].x, y: inherit[i].y }
        : { x: sign * 0.35, y: FORMATION_Y[slots[i]] },
      vel: { x: 0, y: 0 }
    }))
    const goalie: RSkater = this.unit?.goalie ?? {
      player: this.resolve(this.team.lines.goalies[0]),
      pos: { x: sign * 0.93, y: 0 },
      vel: { x: 0, y: 0 }
    }
    this.unit = { skaters, slots, goalie }
    this.deployKey = `${kind}:${count}`
  }

  /** Choose the player ids for a unit, skipping anyone sitting in the box. */
  private deployIds(rng: Rng, kind: DeployKind, count: number): PlayerId[] {
    const lines = this.team.lines
    const boxed = new Set(this.penalties.map((p) => p.playerId))
    let base: PlayerId[]
    if (kind === 'pp' || kind === 'pk') {
      const units = kind === 'pp' ? lines.powerPlayUnits : lines.penaltyKillUnits
      base =
        units.length > 0
          ? units[weightedIndex(rng, units.map((_, i) => SPECIAL_UNIT_WEIGHTS[i] ?? 0.2))]
          : []
    } else if (kind === 'ot') {
      base = this.bestSkaters(count, boxed)
    } else {
      const fwd = lines.forwards[weightedIndex(rng, FWD_LINE_WEIGHTS)]
      const pair = lines.defensePairs[weightedIndex(rng, DEF_PAIR_WEIGHTS)]
      base = [...fwd, ...pair]
    }
    const out: PlayerId[] = []
    for (const id of base) if (!boxed.has(id) && !out.includes(id)) out.push(id)
    // A 3-man kill keeps one forward + both defensemen of the [F,F,D,D] unit.
    if (kind === 'pk' && count === 3 && out.length === 4) out.splice(1, 1)
    // The 6th skater (goalie pulled) is the best finisher off the bench.
    if (count === 6 && out.length === 5) {
      const extra = this.bestExtraAttacker(out, boxed)
      if (extra) out.push(extra)
    }
    // Fill any shortfall (boxed unit members) from the even-strength lines.
    for (const id of [...lines.forwards.flat(), ...lines.defensePairs.flat()]) {
      if (out.length >= count) break
      if (!boxed.has(id) && !out.includes(id)) out.push(id)
    }
    return out.slice(0, count)
  }

  /** Top-n available skaters by overall, forwards listed first (3v3 OT). */
  private bestSkaters(n: number, boxed: Set<PlayerId>): PlayerId[] {
    const lines = this.team.lines
    const seen = new Set<PlayerId>()
    const candidates: Player[] = []
    for (const id of [...lines.forwards.flat(), ...lines.defensePairs.flat()]) {
      if (boxed.has(id) || seen.has(id)) continue
      seen.add(id)
      candidates.push(this.resolve(id))
    }
    const overall = (p: Player): number =>
      p.composites.scoring + p.composites.playmaking + p.composites.skating + p.composites.defensiveZone
    candidates.sort((a, b) => overall(b) - overall(a) || (a.id < b.id ? -1 : 1))
    const picked = candidates.slice(0, n)
    picked.sort((a, b) => (a.position === 'D' ? 1 : 0) - (b.position === 'D' ? 1 : 0))
    return picked.map((p) => p.id)
  }

  private bestExtraAttacker(onIce: PlayerId[], boxed: Set<PlayerId>): PlayerId | null {
    let best: Player | null = null
    for (const id of this.team.lines.forwards.flat()) {
      if (boxed.has(id) || onIce.includes(id)) continue
      const p = this.resolve(id)
      if (!best || p.composites.scoring > best.composites.scoring) best = p
    }
    return best ? best.id : null
  }

  shorthanded(): boolean {
    return this.penalties.length > 0
  }

  /** Drop minors that have been fully served as of absolute game-clock `absT`. */
  prunePenalties(absT: number): void {
    if (this.penalties.length === 0) return
    this.penalties = this.penalties.filter((p) => p.expiresAt > absT)
  }

  clearEarliestPenalty(): void {
    if (this.penalties.length === 0) return
    let idx = 0
    for (let i = 1; i < this.penalties.length; i++) {
      if (this.penalties[i].expiresAt < this.penalties[idx].expiresAt) idx = i
    }
    this.penalties.splice(idx, 1)
  }
}

/** Resting y-offsets for slots [LW, C, RW, LD, RD] when fanning out. */
const FORMATION_Y = [-0.42, 0, 0.42, -0.28, 0.28]

function avg(skaters: RSkater[], pick: (p: Player) => number): number {
  if (skaters.length === 0) return LEAGUE_AVG
  let s = 0
  for (const r of skaters) s += pick(r.player)
  return s / skaters.length
}

function snapshot(unit: Unit): SkaterSnapshot[] {
  return unit.skaters.map((r) => ({ player: r.player.id, pos: { x: r.pos.x, y: r.pos.y } }))
}

function pushFrame(
  ctx: Ctx,
  t: number,
  period: number,
  home: TeamSim,
  away: TeamSim,
  puck: XY,
  carrier: PlayerId | null
): void {
  ctx.stream.push({
    t,
    period,
    type: 'frame',
    home: snapshot(home.unit),
    away: snapshot(away.unit),
    homeGoalie: { player: home.unit.goalie.player.id, pos: { ...home.unit.goalie.pos } },
    awayGoalie: { player: away.unit.goalie.player.id, pos: { ...away.unit.goalie.pos } },
    puck: { x: puck.x, y: puck.y },
    puckCarrier: carrier
  })
}

function pickAssists(rng: Rng, skaters: RSkater[], scorerId: PlayerId): PlayerId[] {
  const mates = skaters.filter((r) => r.player.id !== scorerId)
  if (mates.length === 0) return []
  const weights = mates.map((r) => 1 + r.player.composites.playmaking)
  const assists: PlayerId[] = []
  if (rng.chance(0.85)) {
    const primary = weightedIndex(rng, weights)
    assists.push(mates[primary].player.id)
    if (rng.chance(0.6) && mates.length > 1) {
      let sec = weightedIndex(rng, weights)
      if (sec === primary) sec = (sec + 1) % mates.length
      assists.push(mates[sec].player.id)
    }
  }
  return assists
}

/**
 * Index of the skater who takes the draw. Real hockey: the centre takes it —
 * always, even when a defenceman on the unit has a better faceoff rating (which
 * happens with synthesized/imported ratings). Prefer an actual centreman (the
 * best faceoff man among them if a line dresses two), then whoever sits in the
 * centre slot, and only as a last resort the best faceoff man on the ice
 * (special-teams / OT units may not have a natural centre out there).
 */
function takerIdxOf(unit: Unit): number {
  let best = -1
  for (let i = 0; i < unit.skaters.length; i++) {
    if (unit.skaters[i].player.position !== 'C') continue
    if (
      best < 0 ||
      unit.skaters[i].player.composites.faceoffWin > unit.skaters[best].player.composites.faceoffWin
    )
      best = i
  }
  if (best >= 0) return best
  const centreSlot = unit.slots.indexOf(1)
  if (centreSlot >= 0) return centreSlot
  best = 0
  for (let i = 1; i < unit.skaters.length; i++) {
    if (unit.skaters[i].player.composites.faceoffWin > unit.skaters[best].player.composites.faceoffWin)
      best = i
  }
  return best
}

function countNear(skaters: RSkater[], p: XY, ft: number): number {
  let n = 0
  for (const r of skaters) if (distFt(r.pos, p) < ft) n++
  return n
}

interface PeriodOutcome {
  /** True if a sudden-death period ended on a goal. */
  ended: boolean
}

interface PeriodSpec {
  period: number
  lengthSeconds: number
  /** Sudden death: the first goal ends the period (and the game). */
  suddenDeath: boolean
  /** Absolute game-clock seconds elapsed before this period started. */
  absBase: number
  /** Even-strength skater count: 5, or 3 for regular-season overtime. */
  baseSkaters: 3 | 5
}

/** A stoppage waiting on a faceoff: both teams skate to the dot, then drop it. */
interface PendingFaceoff {
  dot: XY
  zone: Zone
  /** Ticks waited (can start negative for goal-celebration dead time). */
  wait: number
}

/** A beat in progress: the director's pick plus the choreography it runs. */
interface ActiveBeat {
  kind: BeatKind
  play: PlayId
  team: TeamSim
  /** Ticks elapsed within this beat. */
  ticks: number
  /** Ticks before the director re-samples (or the beat self-resolves). */
  dwell: number
  /** Strong side (sign of puck.y) frozen at beat start. */
  side: number
  /** Counterattack with the defenders genuinely beat. */
  oddMan: boolean
  /** Carrier clean past EVERY defender — drives the net, never passes. */
  breakaway: boolean
  /** One-shot flag (set-play pass thrown, rush entry credited, …). */
  passMade: boolean
  /** Featured skater index (offside winger, seam receiver, dump chaser). */
  targetIdx: number
}

function simPeriod(
  ctx: Ctx,
  home: TeamSim,
  away: TeamSim,
  spec: PeriodSpec,
  director: Director
): PeriodOutcome {
  const { rng } = ctx
  const { period, lengthSeconds, suddenDeath, absBase, baseSkaters } = spec
  home.defendsPositive = period % 2 === 0 // home attacks +x on odd periods
  away.defendsPositive = !home.defendsPositive

  const clk = { t: 0 }
  const puck: XY = { x: 0, y: 0 }
  /** Loose-puck velocity in ft/s (only meaningful when the puck is loose). */
  const looseV = { x: 0, y: 0 }
  let possession: TeamSim = home
  let carrier: PlayerId | null = null
  let beat: ActiveBeat | null = null
  let pending: PendingFaceoff | null = null
  /** Ticks remaining of a live-rebound window (quick put-back chances). */
  let reboundTicks = 0
  /** Game-clock second of each side's last completed zone entry (rush window). */
  const entryAt = new Map<TeamSim, number>()
  let lastShift = 0
  let endedSuddenDeath = false
  let heldBy: PlayerId | null = null
  let heldTicks = 0

  // A puck in flight (pass/shot/dump): advances by (vx,vy) per tick until it lands.
  let flight: { vx: number; vy: number; ticks: number; onLand: () => void } | null = null

  /**
   * When non-null the puck is DEAD at this position — it does not move and
   * every frame emits it here.  The dead position is cleared only when the
   * faceoff event fires and the puck is placed at the dot.  This guarantees:
   *   - No frame ever shows the puck sliding from net to dot between a
   *     whistle and the faceoff (renderers may interpolate frames but they
   *     MUST NOT interpolate across the whistle/faceoff boundary — that snap
   *     is explicitly documented as legal in the stream contract).
   *   - The displacement invariant for the puck only needs to be enforced
   *     between frames that do NOT have a whistle/faceoff between them.
   */
  let deadPuckPos: XY | null = null

  /**
   * Goal-celebration phase: runs for GOAL_CELEBRATION_TICKS before the engine
   * switches into the normal faceoff-staging (pending) state.
   *
   *   - Scoring team's skaters converge toward the scorer's position.
   *   - Conceding team's skaters peel away toward their own bench/blue-line.
   *   - Puck stays pinned at the net (deadPuckPos).
   */
  let celebration: {
    scoringTeam: TeamSim
    defTeam: TeamSim
    scorerPos: XY
    ticks: number
  } | null = null

  const otherOf = (team: TeamSim): TeamSim => (team === home ? away : home)
  const carrierSkater = (): RSkater | undefined =>
    possession.unit.skaters.find((r) => r.player.id === carrier)

  const noteBeat = (k: BeatKind): void => {
    if (ctx.telemetry) ctx.telemetry.beats[k]++
  }
  const noteStop = (k: keyof StoppageCounts): void => {
    if (ctx.telemetry) ctx.telemetry.stoppages[k]++
  }

  /** What strength state a team should be deployed at right now. */
  const desiredFor = (team: TeamSim, opp: TeamSim): { kind: DeployKind; count: number } => {
    if (baseSkaters === 3) {
      // 3-on-3 OT: a penalty gives the OTHER side a 4th skater; nobody drops below 3.
      const adv = clamp(opp.penalties.length - team.penalties.length, 0, 1)
      return { kind: 'ot', count: 3 + adv }
    }
    const extra = team.pulled ? 1 : 0
    if (team.penalties.length > 0) {
      return { kind: 'pk', count: clamp(5 - team.penalties.length + extra, 3, 6) }
    }
    if (opp.penalties.length > 0) return { kind: 'pp', count: clamp(5 + extra, 3, 6) }
    return { kind: 'ev', count: clamp(5 + extra, 3, 6) }
  }

  /** Credit time-on-ice for the shift just completed. */
  const creditShift = (upTo: number): void => {
    const dur = upTo - lastShift
    for (const r of home.unit.skaters) stat(ctx, r.player.id).toi += dur
    stat(ctx, home.unit.goalie.player.id).toi += dur
    for (const r of away.unit.skaters) stat(ctx, r.player.id).toi += dur
    stat(ctx, away.unit.goalie.player.id).toi += dur
    lastShift = upTo
  }

  /** Deploy `team` at its desired strength, optionally announcing a lineChange. */
  const deployTeam = (team: TeamSim, opp: TeamSim, inherit?: XY[], announce = true): void => {
    const d = desiredFor(team, opp)
    team.deploy(rng, d.kind, d.count, inherit)
    if (announce) {
      noteBeat('lineChange')
      ctx.stream.push({
        t: clk.t,
        period,
        type: 'lineChange',
        team: team.team.id,
        onIce: team.unit.skaters.map((r) => r.player.id)
      })
    }
  }

  /** Redeploy any side whose strength state changed (penalty start/expiry, pull). */
  const syncStrength = (): void => {
    for (const [team, opp] of [
      [home, away],
      [away, home]
    ] as const) {
      const d = desiredFor(team, opp)
      if (`${d.kind}:${d.count}` !== team.deployKey) {
        creditShift(clk.t)
        deployTeam(team, opp, team.unit.skaters.map((r) => r.pos))
      }
    }
  }

  /** Pull (or re-insert) the goalie: down 1–2 in the last stretch of regulation. */
  const updatePull = (team: TeamSim, opp: TeamSim): void => {
    if (period !== REGULATION_PERIODS) {
      team.pulled = false
      return
    }
    const deficit = opp.goals - team.goals
    team.pulled =
      lengthSeconds - clk.t <= PULL_WINDOW_SECONDS && deficit >= 1 && deficit <= PULL_MAX_DEFICIT
  }

  /** Park every skater exactly on his faceoff spot (period start only). */
  const lineUp = (team: TeamSim, dot: XY): void => {
    const tk = takerIdxOf(team.unit)
    team.unit.skaters.forEach((r, i) => {
      const s = faceoffSpot(team.unit, i, team.attackSign(), dot, tk)
      r.pos.x = s.x
      r.pos.y = s.y
      r.vel.x = 0
      r.vel.y = 0
    })
    const g = team.unit.goalie
    g.pos.x = team.ownSign() * 0.93
    g.pos.y = 0
  }

  /** The puck comes off the carrier's stick and is live on the ice. */
  const dropLoose = (vxFt: number, vyFt: number): void => {
    carrier = null
    looseV.x = vxFt
    looseV.y = vyFt
  }

  /** Launch the puck on a straight flight at a real speed; resolve on landing. */
  const launchFlight = (to: XY, speedFt: number, onLand: () => void): void => {
    const ticks = Math.max(1, Math.round(distFt(puck, to) / (speedFt * FRAME_DT)))
    flight = {
      vx: (to.x - puck.x) / ticks,
      vy: (to.y - puck.y) / ticks,
      ticks,
      onLand
    }
    carrier = null
  }

  /**
   * Stop play and queue a faceoff at `dot`.
   *
   * `extraDead` gives the faceoff staging extra dead ticks before it begins
   * counting toward the FACEOFF_MIN_WAIT gate.  The puck is frozen at its
   * current position (deadPuckPos) for the whole staging window — it only
   * jumps to the dot when the faceoff event fires (a legal snap boundary).
   */
  const stopPlay = (dot: XY, zone: Zone, extraDead = 0): void => {
    pending = { dot, zone, wait: -extraDead }
    // Freeze the puck where it is right now; it will snap to dot at faceoff.
    if (deadPuckPos === null) {
      deadPuckPos = { x: puck.x, y: puck.y }
    }
    carrier = null
    flight = null
    looseV.x = 0
    looseV.y = 0
    beat = null
    reboundTicks = 0
  }

  /** Roster-strength edge of `team` over its opponent, ≈ −0.5..0.5. */
  const edgeOf = (team: TeamSim): number =>
    clamp((team.strength - otherOf(team).strength) / 30, -0.5, 0.5)

  /** The base play to run when no beat is active (positional default). */
  const defaultPlay = (advLike: number): PlayId =>
    advLike < -0.18 ? 'BREAKOUT_WHEEL' : advLike < O_BLUE ? 'NZ_REGROUP' : 'OZ_CYCLE'

  /** Create a beat (and count it in telemetry). */
  const mkBeat = (kind: BeatKind, play: PlayId, team: TeamSim, dwell: number): ActiveBeat => {
    noteBeat(kind)
    return {
      kind,
      play,
      team,
      ticks: 0,
      dwell,
      side: puck.y >= 0 ? 1 : -1,
      oddMan: false,
      breakaway: false,
      passMade: false,
      targetIdx: -1
    }
  }

  /** The nine dots: which one a neutral whistle comes back to. */
  const nearestDot = (p: XY): XY => {
    let best = ALL_DOTS[0]
    let bd = Infinity
    for (const d of ALL_DOTS) {
      const dd = distFt(d, p)
      if (dd < bd) {
        bd = dd
        best = d
      }
    }
    return best
  }

  const dotZone = (dot: XY, team: TeamSim): Zone => {
    if (Math.abs(dot.x) <= 0.25) return 'neutral'
    return dot.x * team.attackSign() > 0 ? 'offensive' : 'defensive'
  }

  /** Strength a goal right now would be recorded at. */
  const goalStrengthNow = (atk: TeamSim, def: TeamSim): GoalStrength => {
    if (def.pulled) return 'en'
    const atkSH = atk.shorthanded()
    const defSH = def.shorthanded()
    if (defSH && !atkSH) return 'pp'
    if (atkSH && !defSH) return 'sh'
    return 'ev'
  }

  // ---------------------------------------------------------------------------
  // Shooting — every shot comes from a directed beat (point/seam/rush/...) and
  // its danger comes from the real xG surface at the true origin.
  // ---------------------------------------------------------------------------
  const tryShoot = (shooterSk: RSkater, kind: ShotKind, oneTimer: boolean, oddMan: boolean): void => {
    const atk = possession
    const def = otherOf(atk)
    const a = atk.attackSign()
    const from: XY = { x: puck.x, y: puck.y }

    // Some attempts are blocked before they ever reach the net.
    if (rng.chance(1 - ON_GOAL_SHARE)) {
      const bIdx = nearestIdx(def.unit.skaters, puck)
      const blocker = def.unit.skaters[bIdx]
      ctx.stream.push({
        t: clk.t,
        period,
        type: 'blockedShot',
        shooter: shooterSk.player.id,
        blocker: blocker.player.id,
        pos: { x: from.x, y: from.y }
      })
      // The puck caroms off the shin pads back up ice — live and contested.
      dropLoose(-a * rng.float(10, 30), rng.float(-16, 16))
      return
    }

    const xg = shotXg(from, a)
    const screened =
      kind === 'point' && countNear(atk.unit.skaters, { x: a * 0.89, y: 0 }, 12) > 0
    let eff = xg
    if (oneTimer) eff *= 1.35 // across the royal road, goalie moving
    if (oddMan && (kind === 'rush' || kind === 'onetimer')) eff *= 1.45 // odd-man rushes
    if (screened) eff *= 1.15 // point shot through a net-front screen
    if (kind === 'rebound') eff *= 1.3 // goalie down, net open
    const danger = clamp(eff / 0.25, 0, 1)

    ctx.stream.push({
      t: clk.t,
      period,
      type: 'shot',
      shooter: shooterSk.player.id,
      from,
      target: { x: a, y: 0 },
      danger
    })
    // Telemetry tags rush shots by the data definition: within 6s of the entry.
    const sinceEntry = clk.t - (entryAt.get(atk) ?? -999)
    const recordKind: ShotKind =
      kind === 'rebound' ? 'rebound' : sinceEntry >= 0 && sinceEntry <= 6 ? 'rush' : kind
    ctx.telemetry?.shots.push({ kind: recordKind, danger, oddMan })
    stat(ctx, shooterSk.player.id).shots++

    const goalie = def.unit.goalie
    const netEmpty = def.pulled
    // No goalie stats accrue against an empty net (NHL convention).
    const gStat = netEmpty ? null : stat(ctx, goalie.player.id)
    if (gStat) gStat.shotsAgainst++

    const finish = shooterSk.player.composites.scoring / LEAGUE_AVG
    const goalieEdge = (goalie.player.composites.goaltending - LEAGUE_AVG) / 220
    const pGoal = netEmpty
      ? EN_GOAL_P
      : clamp(eff * FINISH_K * finish * (1 - goalieEdge), 0.004, 0.9)
    const isGoal = rng.chance(pGoal)
    const assists = isGoal ? pickAssists(rng, atk.unit.skaters, shooterSk.player.id) : []
    const gs = goalStrengthNow(atk, def)

    const net: XY = { x: a * 0.89, y: rng.float(-0.045, 0.045) }
    const speed = SHOT_SPEED_MIN + (clamp(shooterSk.player.composites.scoring, 0, 100) / 100) * SHOT_SPEED_RANGE
    launchFlight(net, speed, () => {
      if (isGoal) {
        atk.goals++
        if (gStat) gStat.goalsAgainst++
        stat(ctx, shooterSk.player.id).goals++
        for (const as of assists) stat(ctx, as).assists++
        // Puck stays IN/AT the net for the whole celebration — pin it here.
        puck.x = a * 0.91
        puck.y = 0
        ctx.stream.push({
          t: clk.t,
          period,
          type: 'goal',
          scorer: shooterSk.player.id,
          assists,
          strength: gs,
          pos: { x: from.x, y: from.y }
        })
        // Whistle(reason:'goal') marks the start of the dead-puck window.
        // The renderer uses this boundary: the puck is dead here — do NOT
        // interpolate its position across this event until the 'faceoff' fires.
        ctx.stream.push({ t: clk.t, period, type: 'whistle', reason: 'goal', pos: { x: puck.x, y: puck.y } })
        noteStop('goal')
        if (gs === 'pp') def.clearEarliestPenalty()
        if (suddenDeath) {
          endedSuddenDeath = true
          return
        }
        // Pin the dead puck at the net; the celebration phase will advance
        // skaters before the engine transitions to faceoff staging.
        deadPuckPos = { x: puck.x, y: puck.y }
        carrier = null
        flight = null
        looseV.x = 0
        looseV.y = 0
        beat = null
        reboundTicks = 0
        celebration = {
          scoringTeam: atk,
          defTeam: def,
          scorerPos: { x: shooterSk.pos.x, y: shooterSk.pos.y },
          ticks: 0
        }
        return
      }
      if (netEmpty) {
        // Wide of the empty cage — live puck behind the net.
        dropLoose(-a * 10, rng.float(-14, 14))
        return
      }
      gStat!.saves++
      // Net-front pressure makes the goalie eat the puck rather than play it —
      // at the data-driven freeze rate (goalieFreeze stoppages per game).
      const netFront = clamp(countNear(atk.unit.skaters, { x: a * 0.89, y: 0 }, 13) / 2, 0, 1)
      const freeze = rng.chance(director.pFreeze(netFront, kind === 'rebound'))
      ctx.stream.push({
        t: clk.t,
        period,
        type: 'save',
        goalie: goalie.player.id,
        rebound: !freeze,
        pos: { x: goalie.pos.x, y: goalie.pos.y }
      })
      if (freeze) {
        ctx.stream.push({ t: clk.t, period, type: 'whistle', pos: { ...goalie.pos } })
        noteBeat('goalieFreeze')
        noteStop('goalieFreeze')
        stopPlay({ x: a * EZ_X, y: from.y >= 0 ? DOT_Y : -DOT_Y }, 'offensive')
        return
      }
      if (rng.chance(0.5)) {
        // Kicked into the slot — a juicy rebound both teams crash for.
        puck.x = a * 0.8
        puck.y = rng.float(-0.18, 0.18)
        dropLoose(-a * rng.float(18, 30), rng.float(-10, 10))
        reboundTicks = 12
      } else {
        // Steered into the corner.
        const side = rng.chance(0.5) ? 1 : -1
        puck.x = a * 0.88
        puck.y = side * 0.45
        dropLoose(-a * 4, side * 26)
      }
    })
  }

  /** Counterattack check after a live turnover — the new side may have a rush. */
  const startCounter = (): void => {
    heldTicks = 0
    beat = null
    const a = possession.attackSign()
    const adv = puck.x * a
    if (adv < -0.1) return // stolen in our half: settle it, that's a breakout
    const def = otherOf(possession)
    let back = 0
    for (const r of def.unit.skaters) if (r.pos.x * a > adv + 0.02) back++
    let up = 0
    for (const r of possession.unit.skaters) if (r.pos.x * a > adv - 0.08) up++
    const oddMan = up > back && back <= 2
    const pace = possession.team.tactics.tempo.pace
    if ((oddMan && rng.chance(0.75)) || rng.chance(0.06 + pace * 0.08)) {
      const nb = mkBeat('turnoverCounter', 'RUSH_ODDMAN', possession, 34)
      nb.oddMan = oddMan
      beat = nb
    }
  }

  // ---------------------------------------------------------------------------
  // Passing.
  // ---------------------------------------------------------------------------

  /** The phase the possession team is choreographing right now. */
  const currentPhase = (team: TeamSim) =>
    phaseForPlay(beat && beat.team === team ? beat.play : defaultPlay(puck.x * team.attackSign()))

  /**
   * A DIRECTED pass — the choreographer's set-play feed (low-to-high to the
   * point, the royal-road seam, the trailer dish, the 2-on-1 pass across).
   * Same physics and interception risk as organic passing.
   */
  const passTo = (cs: RSkater, toSk: RSkater, oneTimer: boolean, oddMan: boolean): void => {
    const atk = possession
    const def = otherOf(atk)
    const a = atk.attackSign()
    // Breakaway tripwire (same definition as the loop's): a clean-in-alone
    // carrier must never be routed here. Counted so tests can assert zero.
    if (
      ctx.telemetry &&
      puck.x * a > 0.1 &&
      def.unit.skaters.every((r) => r.pos.x * a < cs.pos.x * a - 0.08)
    ) {
      const pIdx = nearestIdx(def.unit.skaters, puck)
      const pd = pIdx >= 0 ? distFt(def.unit.skaters[pIdx].pos, puck) : 99
      if (pd > 14) ctx.telemetry.breakawayPasses++
    }
    const d0 = distFt(cs.pos, toSk.pos)
    const speed = clamp(62 + d0 * 0.3, 60, 92)
    const tEst = d0 / speed
    const b: XY = {
      x: clamp(toSk.pos.x + (toSk.vel.x * tEst) / X_FT, -0.95, 0.95),
      y: clamp(toSk.pos.y + (toSk.vel.y * tEst) / Y_FT, -0.92, 0.92)
    }
    const completed = rng.chance(clamp(0.93 - d0 / 400 - (oneTimer ? 0.06 : 0), 0.55, 0.95))
    ctx.stream.push({
      t: clk.t,
      period,
      type: 'pass',
      from: cs.player.id,
      to: toSk.player.id,
      a: { x: puck.x, y: puck.y },
      b,
      completed
    })
    const interceptorIdx = nearestIdx(def.unit.skaters, b)
    launchFlight(b, speed, () => {
      if (completed) {
        carrier = toSk.player.id
        heldBy = carrier
        heldTicks = 0
        if (oneTimer) {
          puck.x = toSk.pos.x
          puck.y = toSk.pos.y
          tryShoot(toSk, 'onetimer', true, oddMan)
        }
      } else {
        const ic = def.unit.skaters[interceptorIdx]
        possession = def
        carrier = ic.player.id
        heldBy = carrier
        puck.x = ic.pos.x
        puck.y = ic.pos.y
        startCounter()
      }
    })
  }

  /**
   * Organic puck movement inside flowing beats (breakout outlets, regroup
   * D-to-D, cycle station-to-station) — phase-aware target weights.
   */
  const doPass = (cs: RSkater, pressure: number): boolean => {
    const atk = possession
    const def = otherOf(atk)
    const a = atk.attackSign()
    const tempo = atk.team.tactics.tempo
    const phase = currentPhase(atk)
    const csIdx = atk.unit.skaters.indexOf(cs)
    const csSlot = atk.unit.slots[csIdx] ?? 1
    const puckAdv = puck.x * a

    // Tripwire: the beat machine must never route a breakaway here (same
    // definition as the loop's: clearly past everyone, nobody in contact).
    // Counted so tests can assert it stays zero.
    if (
      ctx.telemetry &&
      puckAdv > 0.1 &&
      pressure < 0.22 &&
      def.unit.skaters.every((r) => r.pos.x * a < cs.pos.x * a - 0.08)
    ) {
      ctx.telemetry.breakawayPasses++
    }

    const mates: { r: RSkater; slot: number }[] = []
    atk.unit.skaters.forEach((r, i) => {
      if (r !== cs) mates.push({ r, slot: atk.unit.slots[i] })
    })
    if (mates.length === 0) return false

    const seam: boolean[] = new Array(mates.length).fill(false)
    const weights = mates.map((m, i) => {
      const r = m.r
      const rAdv = r.pos.x * a
      // Never feed a teammate camped beyond the blue line ahead of the puck —
      // that pass would be offside.
      if (rAdv > O_BLUE && puckAdv < O_BLUE - 0.02) return 0.0001
      const d = distFt(cs.pos, r.pos)
      const prox = clamp(1.45 - d / 60, 0.25, 1.45)
      const ahead = (r.pos.x - cs.pos.x) * a
      // Backward passes are a regroup tool, not a rush option: while attacking
      // with speed, a trailing teammate is nearly never the right play.
      const backPenalty = phase === 'rush' || phase === 'entry' ? 0.08 : 0.35
      let w = (ahead >= -0.03 ? 1 : backPenalty) + r.player.composites.playmaking * 0.004
      if (phase === 'breakout') {
        // Outlet chains: D→winger on the wall, D→C in the middle, D-to-D.
        if (m.slot <= 2 && Math.abs(r.pos.y) > 0.45) w += 1.7
        if (m.slot === 1) w += 1.2
        if (m.slot >= 3 && csSlot >= 3) w += 1.5
      } else if (phase === 'neutral' || phase === 'rush' || phase === 'entry') {
        // Fill lanes with speed; cross-ice and stretch feeds when risk allows.
        w += Math.max(0, ahead) * 6
        if (Math.abs(r.pos.y - cs.pos.y) > 0.5) w += tempo.passRisk * 1.2
      } else {
        // Cycle: wall→corner→point→seam. Low-to-high to the D, and a seam feed
        // across the royal road to a body in the slot for a one-timer.
        if (m.slot >= 3 && rAdv < 0.48) w += 1.1
        const royal =
          rAdv > 0.55 &&
          Math.abs(r.pos.y) < 0.32 &&
          Math.sign(r.pos.y || 1) !== Math.sign(puck.y || 1) &&
          Math.abs(puck.y) > 0.18
        if (royal) {
          seam[i] = true
          w += 1.2 + tempo.passRisk * 1.6
        }
      }
      return w * prox
    })

    const pick = weightedIndex(rng, weights)
    const toSk = mates[pick].r
    const oneTimer = seam[pick] && rng.chance(0.7)
    const d0 = distFt(cs.pos, toSk.pos)
    const speed = clamp(60 + tempo.passRisk * 18 + d0 * 0.25, 60, 90)
    // Lead the receiver: aim where he will be when the puck arrives.
    const tEst = d0 / speed
    const b: XY = {
      x: clamp(toSk.pos.x + (toSk.vel.x * tEst) / X_FT, -0.95, 0.95),
      y: clamp(toSk.pos.y + (toSk.vel.y * tEst) / Y_FT, -0.92, 0.92)
    }
    const completed = rng.chance(
      clamp(0.95 - pressure * 0.18 - d0 / 420 - (oneTimer ? 0.05 : 0), 0.55, 0.96)
    )
    ctx.stream.push({
      t: clk.t,
      period,
      type: 'pass',
      from: cs.player.id,
      to: toSk.player.id,
      a: { x: puck.x, y: puck.y },
      b,
      completed
    })
    const interceptorIdx = nearestIdx(def.unit.skaters, b)
    launchFlight(b, speed, () => {
      if (completed) {
        carrier = toSk.player.id
        heldBy = carrier
        heldTicks = 0
        if (oneTimer && toSk.pos.x * a > 0.4) {
          puck.x = toSk.pos.x
          puck.y = toSk.pos.y
          tryShoot(toSk, 'onetimer', true, false)
        }
      } else {
        const ic = def.unit.skaters[interceptorIdx]
        possession = def
        carrier = ic.player.id
        heldBy = carrier
        puck.x = ic.pos.x
        puck.y = ic.pos.y
        startCounter()
      }
    })
    return true
  }

  /** Rim/chip the puck out of the defensive zone under forecheck pressure. */
  const clearPuck = (atk: TeamSim, a: number, shorthanded: boolean): void => {
    if (shorthanded) {
      // A PK clear goes the length of the ice — legal while shorthanded.
      const to: XY = { x: a * 0.8, y: rng.float(-0.5, 0.5) }
      launchFlight(to, CLEAR_SPEED, () => dropLoose(a * 20, rng.float(-8, 8)))
      return
    }
    // Chip off the glass to the neutral-zone boards — a contested 50/50 puck.
    const side = puck.y >= 0 ? 1 : -1
    const to: XY = { x: a * 0.08, y: side * 0.85 }
    launchFlight(to, 80, () => dropLoose(a * 14, side * 6))
  }

  /** Hurried clear the length of the ice: ICING. Whistle at the goal line. */
  const iceThePuck = (atk: TeamSim): void => {
    const a = atk.attackSign()
    const offSign = atk.ownSign()
    const to: XY = { x: a * 0.93, y: rng.float(-0.55, 0.55) }
    launchFlight(to, CLEAR_SPEED, () => {
      ctx.stream.push({ t: clk.t, period, type: 'whistle', pos: { x: puck.x, y: puck.y } })
      if (ctx.telemetry) ctx.telemetry.icings++
      noteBeat('icingWhistle')
      noteStop('icing')
      stopPlay({ x: offSign * EZ_X, y: puck.y >= 0 ? DOT_Y : -DOT_Y }, 'defensive')
    })
  }

  /** Index of the attacking point man (least-advanced D), or -1. */
  const pointManIdx = (atk: TeamSim, a: number): number => {
    let best = -1
    let bestAdv = Infinity
    atk.unit.skaters.forEach((r, i) => {
      if (atk.unit.slots[i] < 3) return
      const v = r.pos.x * a
      if (v < bestAdv) {
        bestAdv = v
        best = i
      }
    })
    return best
  }

  /** Weak-side forward to sneak across the royal road, or -1. */
  const seamReceiverIdx = (atk: TeamSim, cs: RSkater, a: number): number => {
    let best = -1
    let bestScore = -Infinity
    atk.unit.skaters.forEach((r, i) => {
      if (r === cs || atk.unit.slots[i] >= 3) return
      if (Math.sign(r.pos.y || 1) === Math.sign(puck.y || 1)) return
      const score = r.pos.x * a - Math.abs(r.pos.y)
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    })
    return best
  }

  /** A trailing teammate to dish to right after a carry-in, or null. */
  const trailerOf = (atk: TeamSim, cs: RSkater, a: number): RSkater | null => {
    let best: RSkater | null = null
    let bd = Infinity
    for (const r of atk.unit.skaters) {
      if (r === cs) continue
      const behind = (cs.pos.x - r.pos.x) * a
      if (behind < 0.02 || behind > 0.45) continue
      const d = distFt(r.pos, cs.pos)
      if (d < bd) {
        bd = d
        best = r
      }
    }
    return best
  }

  /** The lane-filling teammate on a 2-on-1 to pass across to, or null. */
  const rushLaneMate = (atk: TeamSim, cs: RSkater, a: number): RSkater | null => {
    let best: RSkater | null = null
    let bestAdv = -Infinity
    for (const r of atk.unit.skaters) {
      if (r === cs) continue
      if (Math.abs(r.pos.y - cs.pos.y) < 0.25) continue // need a real second lane
      const v = r.pos.x * a
      if (v < cs.pos.x * a - 0.15) continue // must be up with the play
      if (v > bestAdv) {
        bestAdv = v
        best = r
      }
    }
    return best
  }

  /** Loose puck: nearest bodies fight for it; better puckhandlers win more. */
  const tryRecover = (): boolean => {
    const cands: { team: TeamSim; r: RSkater }[] = []
    for (const team of [home, away]) {
      for (const r of team.unit.skaters) {
        if (distFt(r.pos, puck) < RECOVER_FT) cands.push({ team, r })
      }
    }
    if (cands.length === 0) return false
    const w = cands.map((c) => 1 + c.r.player.composites.puckControl / 30)
    const winner = cands[weightedIndex(rng, w)]
    const wasAttacker = winner.team === possession
    possession = winner.team
    carrier = winner.r.player.id
    heldBy = carrier
    heldTicks = 0
    looseV.x = 0
    looseV.y = 0
    if (!wasAttacker) {
      startCounter()
    } else if (reboundTicks > 0 && puck.x * possession.attackSign() > 0.5) {
      // Won the rebound in front — bang away at it.
      beat = mkBeat('reboundScramble', 'REBOUND_CRASH', possession, 8)
    }
    return true
  }

  /** Goalies stay tight to the crease, tracking the puck; pulled = at bench. */
  const tendNet = (team: TeamSim): void => {
    const g = team.unit.goalie
    const netSign = team.ownSign()
    if (team.pulled) {
      g.pos.x = netSign * BENCH_X
      g.pos.y = BENCH_Y
      return
    }
    const depth = clamp((puck.x * netSign + 1) / 2, 0, 1) // 0 = puck far, 1 = at net
    const out = (depth - 0.55) / 0.45
    g.pos.x = netSign * (0.885 - 0.065 * clamp(out, 0, 1))
    g.pos.y = clamp(puck.y * 0.16, -0.06, 0.06)
  }

  /** Move every skater one tick: playbook routes + counter-shapes + faceoffs. */
  const stepSkaters = (tNow: number): void => {
    const atk = possession
    const def = otherOf(atk)
    const a = atk.attackSign()
    let atkOrders: MoveOrder[]
    let defOrders: MoveOrder[]
    if (celebration) {
      // Celebration phase: scoring team converges on the scorer; conceding team
      // peels away.  Both sets of orders are continuous speed-capped steering
      // — no teleportation, same steer() call as normal play.
      const cel = celebration
      const scoringIsHome = cel.scoringTeam === home

      // Scoring-team skaters: all move toward the scorer's position (cluster).
      // Each skater gets a slightly offset target so they don't all stack on
      // the same pixel — spread them around the scorer in a tight arc.
      const scoringUnit = cel.scoringTeam.unit
      const defUnit = cel.defTeam.unit
      const scoringOrders: MoveOrder[] = scoringUnit.skaters.map((_, i) => {
        // Stagger targets in a small arc around the scorer so they cluster
        // naturally rather than all piling onto the exact same point.
        const angle = (i / Math.max(1, scoringUnit.skaters.length - 1)) * Math.PI - Math.PI / 2
        const spreadX = Math.cos(angle) * 0.04
        const spreadY = Math.sin(angle) * 0.06
        return {
          tx: clamp(cel.scorerPos.x + spreadX, -0.95, 0.95),
          ty: clamp(cel.scorerPos.y + spreadY, -0.92, 0.92),
          urgency: 0.9
        }
      })
      // Conceding-team skaters: peel toward their own blue line / bench.
      const defSign = cel.defTeam.attackSign() // direction they attack
      const defOrders_: MoveOrder[] = defUnit.skaters.map((_, i) => {
        // Spread them along the y axis at their blue-line x — dejected shuffle.
        const ty = (i % 2 === 0 ? -1 : 1) * (0.28 + (i >> 1) * 0.18)
        return {
          tx: defSign * 0.24,   // their own neutral-zone side of center
          ty: clamp(ty, -0.9, 0.9),
          urgency: 0.6
        }
      })

      const hOrders = scoringIsHome ? scoringOrders : defOrders_
      const aOrders = scoringIsHome ? defOrders_ : scoringOrders
      home.unit.skaters.forEach((r, i) => steer(rng, r, hOrders[i], FRAME_DT))
      away.unit.skaters.forEach((r, i) => steer(rng, r, aOrders[i], FRAME_DT))
      tendNet(home)
      tendNet(away)
      return
    }
    if (pending) {
      atkOrders = faceoffOrders(atk.unit, a, pending.dot, takerIdxOf(atk.unit))
      defOrders = faceoffOrders(def.unit, def.attackSign(), pending.dot, takerIdxOf(def.unit))
    } else {
      const cIdx = carrier === null ? -1 : atk.unit.skaters.findIndex((r) => r.player.id === carrier)
      const atkSH = atk.shorthanded()
      const defSH = def.shorthanded()
      const ppSetup = defSH && !atkSH && puck.x * a > 0.35 && cIdx >= 0
      const active = beat && beat.team === atk ? beat : null
      const play: PlayId = active ? active.play : defaultPlay(puck.x * a)
      atkOrders = attackPlayOrders({
        unit: atk.unit,
        a,
        puck,
        carrierIdx: cIdx,
        tactics: atk.team.tactics,
        ppSetup,
        t: tNow,
        play,
        beatTicks: active ? active.ticks : 0,
        side: active ? active.side : puck.y >= 0 ? 1 : -1,
        targetIdx: active ? active.targetIdx : -1,
        hold: active !== null && active.kind === 'regroup' && active.ticks < active.dwell
      })
      defOrders = defenderOrders({
        unit: def.unit,
        a,
        phase: phaseForPlay(play),
        puck,
        attackers: atk.unit.skaters,
        carrierIdx: cIdx,
        tactics: def.team.tactics,
        pk: defSH && !atkSH,
        rushOddMan: active !== null && active.oddMan,
        t: tNow
      })
      if (cIdx < 0 && !flight) {
        // Loose puck: the nearest man on each side breaks off to win it.
        const ai = nearestIdx(atk.unit.skaters, puck)
        if (ai >= 0) atkOrders[ai] = { tx: puck.x, ty: puck.y, urgency: 1 }
        const di = nearestIdx(def.unit.skaters, puck)
        if (di >= 0) defOrders[di] = { tx: puck.x, ty: puck.y, urgency: 1 }
      }
    }
    const hOrders = possession === home ? atkOrders : defOrders
    const aOrders = possession === home ? defOrders : atkOrders
    home.unit.skaters.forEach((r, i) => steer(rng, r, hOrders[i], FRAME_DT))
    away.unit.skaters.forEach((r, i) => steer(rng, r, aOrders[i], FRAME_DT))
    tendNet(home)
    tendNet(away)
  }

  /** Conduct the queued faceoff once both centers have reached the dot. */
  const conductFaceoff = (): void => {
    const p = pending!
    p.wait++
    const hIdx = takerIdxOf(home.unit)
    const aIdx = takerIdxOf(away.unit)
    const hC = home.unit.skaters[hIdx]
    const aC = away.unit.skaters[aIdx]
    const ready =
      p.wait >= FACEOFF_MIN_WAIT &&
      distFt(hC.pos, p.dot) < FACEOFF_READY_FT &&
      distFt(aC.pos, p.dot) < FACEOFF_READY_FT
    if (!ready && p.wait < FACEOFF_MAX_WAIT) return
    const total = hC.player.composites.faceoffWin + aC.player.composites.faceoffWin || 1
    const homeWins = rng.chance(hC.player.composites.faceoffWin / total)
    possession = homeWins ? home : away
    carrier = (homeWins ? hC : aC).player.id
    heldBy = carrier
    heldTicks = 0
    // The puck snaps to the dot here — the faceoff event marks the legal
    // boundary across which the renderer may snap without interpolating.
    puck.x = p.dot.x
    puck.y = p.dot.y
    deadPuckPos = null
    beat = null
    reboundTicks = 0
    noteBeat('faceoff')
    ctx.stream.push({
      t: clk.t,
      period,
      type: 'faceoff',
      zone: p.zone,
      winner: carrier,
      pos: { x: p.dot.x, y: p.dot.y }
    })
    pending = null
  }

  /** Blue-line decision: the director picks carry / dump / offside-failure. */
  const chooseEntryBeat = (cs: RSkater): ActiveBeat => {
    const atk = possession
    const def = otherOf(atk)
    const a = atk.attackSign()
    let gap = 80
    for (const r of def.unit.skaters) {
      if ((r.pos.x - cs.pos.x) * a > -0.02) gap = Math.min(gap, distFt(r.pos, cs.pos))
    }
    const tempo = atk.team.tactics.tempo
    // Flair raises how OFTEN a carrier ATTEMPTS the skilled carry/entry instead
    // of the safe dump — success still rides on puckControl/skating. Absent on
    // fictional/generated players (=> 0), so calibration is unaffected.
    const flairBoost = cs.player.flair !== undefined ? (cs.player.flair - 50) / 200 : 0
    const skill = (cs.player.composites.puckControl + cs.player.composites.skating) / (2 * LEAGUE_AVG) + flairBoost
    const pick = director.sampleEntry({
      gapFt: gap,
      skill,
      pace: tempo.pace,
      passRisk: tempo.passRisk,
      oppTrap: def.team.tactics.forecheck === 'trap',
      shorthanded: atk.shorthanded() && !def.shorthanded(),
      edge: edgeOf(atk)
    })
    if (pick === 'offside') {
      // Designated winger to fly the zone — the most-advanced non-carrier F.
      let wing = -1
      let bestA = -2
      atk.unit.skaters.forEach((r, i) => {
        if (r.player.id === carrier || atk.unit.slots[i] >= 3) return
        const v = r.pos.x * a
        if (v > bestA) {
          bestA = v
          wing = i
        }
      })
      if (wing >= 0) {
        const nb = mkBeat('entryFailedOffside', 'OFFSIDE_FAIL', atk, 36)
        nb.targetIdx = wing
        return nb
      }
      // No forward available to bust the line (rare 3v3 shapes): carry instead.
    }
    if (pick === 'dump') {
      if (ctx.telemetry) ctx.telemetry.entries.dump++
      const side = puck.y >= 0 ? 1 : -1
      // Designated F1 chases the cross-corner rim.
      let f1 = -1
      let bd = Infinity
      atk.unit.skaters.forEach((r, i) => {
        if (r.player.id === carrier || atk.unit.slots[i] >= 3) return
        const d = distFt(r.pos, puck)
        if (d < bd) {
          bd = d
          f1 = i
        }
      })
      const nb = mkBeat('entryDump', 'ENTRY_DUMP_CHASE', atk, 36)
      nb.targetIdx = f1
      launchFlight({ x: a * 0.9, y: -side * 0.68 }, DUMP_SPEED, () => dropLoose(a * 5, side * 16))
      return nb
    }
    return mkBeat('entryCarry', 'ENTRY_CARRY_WIDE', atk, 44)
  }

  /** What beat fits the current puck position (fresh possession, no context). */
  const pickBeat = (pressure: number): ActiveBeat => {
    const atk = possession
    const a = atk.attackSign()
    const adv = puck.x * a
    if (adv < -0.18) {
      return mkBeat('breakout', pressure > 0.5 ? 'BREAKOUT_RIM' : 'BREAKOUT_WHEEL', atk, 60)
    }
    if (adv < 0.1) {
      return mkBeat('regroup', 'NZ_REGROUP', atk, director.regroupDwell(atk.team.tactics.tempo.pace))
    }
    if (adv <= O_BLUE + 0.03) {
      const cs = carrierSkater()
      if (cs) return chooseEntryBeat(cs)
    }
    return mkBeat('cyclePossession', 'OZ_CYCLE', atk, director.cycleDwell())
  }

  // Opening deployment + faceoff (penalties may carry in from the prior period).
  deployTeam(home, away, undefined, false)
  deployTeam(away, home, undefined, false)
  lineUp(home, CENTER_DOT)
  lineUp(away, CENTER_DOT)
  stopPlay(CENTER_DOT, 'neutral')
  pending!.wait = FACEOFF_MIN_WAIT - 1

  while (clk.t < lengthSeconds && !endedSuddenDeath) {
    const t = clk.t
    const absNow = absBase + t
    home.prunePenalties(absNow)
    away.prunePenalties(absNow)
    updatePull(home, away)
    updatePull(away, home)
    // Strength redeploys wait for a puck in flight to land (same rule as line
    // changes) so in-flight resolutions never reference players off the ice.
    if (!flight) syncStrength()

    // Line changes on the fly — incoming unit inherits slot positions (seamless).
    if (t - lastShift >= SHIFT_SECONDS && !flight) {
      creditShift(t)
      deployTeam(home, away, home.unit.skaters.map((r) => r.pos))
      deployTeam(away, home, away.unit.skaters.map((r) => r.pos))
    }
    // If the carrier just went to the bench (or the box), the puck is live.
    if (carrier !== null && !possession.unit.skaters.some((r) => r.player.id === carrier)) {
      dropLoose(0, 0)
    }

    stepSkaters(absNow)

    // Advance the puck.
    let settledThisTick = false
    if (deadPuckPos !== null) {
      // Puck is DEAD (celebration or faceoff staging): freeze it at the dead
      // position.  It will only move when deadPuckPos is cleared at faceoff.
      puck.x = deadPuckPos.x
      puck.y = deadPuckPos.y
    } else if (flight) {
      puck.x = clamp(puck.x + flight.vx, -1, 1)
      puck.y = clamp(puck.y + flight.vy, -1, 1)
      if (--flight.ticks <= 0) {
        const land = flight.onLand
        flight = null
        settledThisTick = true
        land()
      }
    } else if (carrier !== null) {
      const cs = carrierSkater()
      if (cs) {
        // The puck rides a couple of feet ahead of the carrier's stick.
        const sp = Math.hypot(cs.vel.x, cs.vel.y)
        const hx = sp > 2 ? cs.vel.x / sp : possession.attackSign()
        const hy = sp > 2 ? cs.vel.y / sp : 0
        puck.x = clamp(cs.pos.x + (hx * 2.2) / X_FT, -0.98, 0.98)
        puck.y = clamp(cs.pos.y + (hy * 2.2) / Y_FT, -0.97, 0.97)
      }
    } else {
      // Loose puck: slides with friction, bounces off the boards, and the
      // nearest bodies race to it.
      puck.x += (looseV.x * FRAME_DT) / X_FT
      puck.y += (looseV.y * FRAME_DT) / Y_FT
      if (puck.x < -0.97) {
        puck.x = -0.97
        looseV.x = -looseV.x * 0.55
      } else if (puck.x > 0.97) {
        puck.x = 0.97
        looseV.x = -looseV.x * 0.55
      }
      if (puck.y < -0.94) {
        puck.y = -0.94
        looseV.y = -looseV.y * 0.55
      } else if (puck.y > 0.94) {
        puck.y = 0.94
        looseV.y = -looseV.y * 0.55
      }
      looseV.x *= LOOSE_FRICTION
      looseV.y *= LOOSE_FRICTION
      if (tryRecover()) settledThisTick = true
    }

    // During dead-puck windows (celebration or staging) the carrier field in the
    // frame is null — the puck carrier is not displayed (puck is at the net or
    // being skated to the dot).
    pushFrame(ctx, t, period, home, away, puck, deadPuckPos === null && !pending && !flight ? carrier : null)
    clk.t += FRAME_DT
    if (endedSuddenDeath) break
    if (reboundTicks > 0) reboundTicks--

    // Advance the celebration phase.
    if (celebration !== null) {
      celebration.ticks++
      if (celebration.ticks >= GOAL_CELEBRATION_TICKS) {
        // Celebration over: transition into the normal faceoff-staging (pending).
        celebration = null
        stopPlay(CENTER_DOT, 'neutral', GOAL_EXTRA_STAGING_TICKS)
      }
      continue
    }

    if (pending) {
      conductFaceoff()
      continue
    }
    // Only make decisions when the puck is settled on a carrier — and not on
    // the tick it just landed, so the next roll sees fresh possession.
    if (flight || settledThisTick || carrier === null) continue

    // ---- Decision tick: the DIRECTOR reads the ice. -------------------------
    const atk = possession
    const def = otherOf(atk)
    const a = atk.attackSign()
    const cs = carrierSkater()
    if (!cs) {
      dropLoose(0, 0)
      continue
    }

    if (carrier !== heldBy) {
      heldBy = carrier
      heldTicks = 0
    }
    heldTicks++

    const adv = puck.x * a
    const presserIdx = nearestIdx(def.unit.skaters, puck)
    const presser = def.unit.skaters[presserIdx]
    const presserDist = presser ? distFt(presser.pos, puck) : 99
    const pressure = clamp(1 - presserDist / 18, 0, 1)

    const atkSH = atk.shorthanded()
    const defSH = def.shorthanded()
    let strengthMult = 1
    if (defSH && !atkSH) strengthMult = PP_SHOT_MULT
    else if (atkSH && !defSH) strengthMult = PK_SHOT_MULT
    if (atk.pulled) strengthMult *= EXTRA_ATTACKER_SHOT_MULT
    const edge = edgeOf(atk)

    // Breakaway: the carrier is clean past EVERY defender heading up ice —
    // whatever the sampled beat says. He drives the net and shoots; there is
    // no defensible reason to pass, least of all backwards to a defenseman.
    const csAdv = cs.pos.x * a
    const breakaway =
      adv > 0.1 &&
      presserDist > 14 &&
      def.unit.skaters.every((r) => r.pos.x * a < csAdv - 0.08)
    if (breakaway) {
      if (ctx.telemetry) ctx.telemetry.breakawayTicks++
      if (
        !beat ||
        beat.team !== atk ||
        (beat.kind !== 'rushShot' && beat.kind !== 'turnoverCounter')
      ) {
        beat = mkBeat('rushShot', 'RUSH_ODDMAN', atk, 80)
      }
      beat.breakaway = true
    }

    // 1. Penalties — rolled for both teams each tick, weighted by proneness.
    //    A minor stops play: faceoff in the offender's end, units redeploy.
    {
      let stopped = false
      for (const team of [home, away]) {
        const proneness = avg(team.unit.skaters, (p) => p.composites.penaltyProne) / LEAGUE_AVG
        if (rng.chance(PENALTY_P * proneness)) {
          const offender =
            team.unit.skaters[
              weightedIndex(rng, team.unit.skaters.map((r) => 1 + r.player.composites.penaltyProne))
            ]
          team.penalties.push({ expiresAt: absNow + PENALTY_SECONDS, playerId: offender.player.id })
          stat(ctx, offender.player.id).penaltyMinutes += 2
          ctx.stream.push({
            t: clk.t,
            period,
            type: 'penalty',
            player: offender.player.id,
            infraction: 'minor',
            minutes: 2
          })
          ctx.stream.push({ t: clk.t, period, type: 'whistle', pos: { x: puck.x, y: puck.y } })
          noteBeat('penaltyWhistle')
          noteStop('penalty')
          stopPlay(
            { x: team.ownSign() * EZ_X, y: puck.y >= 0 ? DOT_Y : -DOT_Y },
            'defensive'
          )
          stopped = true
          break
        }
      }
      if (stopped) continue
    }

    // 2. Physical play: the pressuring defender finishes a check.
    if (presserDist < 10 && rng.chance(HIT_P)) {
      ctx.stream.push({
        t: clk.t,
        period,
        type: 'hit',
        by: presser.player.id,
        on: cs.player.id,
        pos: { x: cs.pos.x, y: cs.pos.y }
      })
      if (rng.chance(0.3)) {
        // Knocked off the puck — it squirts free along the wall.
        dropLoose(rng.float(-12, 12), rng.float(-12, 12))
        continue
      }
    }

    // 3. Turnovers. A takeaway is forced — the pressuring defender strips the
    //    puck; a giveaway is unforced. Either can ignite a counter-rush.
    if (presserDist < 9 && rng.chance(TAKEAWAY_P)) {
      const loserId = cs.player.id
      possession = def
      carrier = presser.player.id
      heldBy = carrier
      puck.x = presser.pos.x
      puck.y = presser.pos.y
      ctx.stream.push({
        t: clk.t,
        period,
        type: 'takeaway',
        by: presser.player.id,
        from: loserId,
        pos: { x: puck.x, y: puck.y }
      })
      startCounter()
      continue
    }
    if (rng.chance(GIVEAWAY_P)) {
      const recIdx = nearestIdx(def.unit.skaters, puck)
      const recoverer = def.unit.skaters[recIdx]
      ctx.stream.push({
        t: clk.t,
        period,
        type: 'giveaway',
        player: cs.player.id,
        pos: { x: puck.x, y: puck.y }
      })
      possession = def
      carrier = recoverer.player.id
      heldBy = carrier
      puck.x = recoverer.pos.x
      puck.y = recoverer.pos.y
      startCounter()
      continue
    }

    // 4. "Other" stoppages — puck off the netting, dislodged net, etc. — at the
    //    data-driven rate; faceoff at the nearest of the nine dots.
    if (rng.chance(director.pOtherPerTick)) {
      ctx.stream.push({ t: clk.t, period, type: 'whistle', pos: { x: puck.x, y: puck.y } })
      noteStop('other')
      const dot = nearestDot(puck)
      stopPlay(dot, dotZone(dot, atk))
      continue
    }

    // 5. The BEAT MACHINE — the director's sampled play advances one tick.
    if (!beat || beat.team !== atk) beat = pickBeat(pressure)
    const b = beat
    b.ticks++

    switch (b.kind) {
      case 'breakout': {
        if (atkSH && pressure > 0.25 && rng.chance(0.3)) {
          // PK: eat no risk, fire it the length of the ice (legal shorthanded).
          noteBeat('dzClear')
          clearPuck(atk, a, true)
          beat = null
          break
        }
        if (!atkSH && adv < -0.25 && rng.chance(director.pIcingPerTick)) {
          iceThePuck(atk)
          beat = null
          break
        }
        if (pressure > 0.4 && rng.chance(0.04 + pressure * 0.09)) {
          // Forecheck heat: chip it off the glass and out.
          noteBeat('dzClear')
          clearPuck(atk, a, atkSH)
          beat = null
          break
        }
        if (adv > -0.15) {
          beat = mkBeat('regroup', 'NZ_REGROUP', atk, director.regroupDwell(atk.team.tactics.tempo.pace))
        } else if (b.ticks > b.dwell) {
          b.ticks = 0 // stuck deep — keep working the breakout
        }
        break
      }
      case 'regroup': {
        if (adv < -0.25) {
          beat = pickBeat(pressure)
        } else if ((adv > 0.1 && b.ticks >= b.dwell) || adv > 0.2) {
          beat = chooseEntryBeat(cs)
        }
        break
      }
      case 'entryCarry': {
        if (adv > O_BLUE + 0.03) {
          // Across the line with possession — the entry is made.
          if (ctx.telemetry) ctx.telemetry.entries.carry++
          entryAt.set(atk, clk.t)
          if (!b.breakaway && rng.chance(0.16)) {
            const trailer = trailerOf(atk, cs, a)
            if (trailer) {
              if (ctx.telemetry) ctx.telemetry.entries.pass++
              passTo(cs, trailer, false, false)
              beat = mkBeat('cyclePossession', 'OZ_CYCLE', atk, director.cycleDwell())
              break
            }
          }
          if (rng.chance(director.pRushAfterEntry * (0.8 + atk.team.tactics.tempo.pace * 0.4))) {
            const nb = mkBeat('rushShot', 'RUSH_ODDMAN', atk, 20)
            nb.breakaway = b.breakaway
            beat = nb
          } else {
            beat = mkBeat('cyclePossession', 'OZ_CYCLE', atk, director.cycleDwell())
          }
        } else if (b.ticks > b.dwell || adv < 0) {
          beat = null
        }
        break
      }
      case 'entryDump': {
        if (adv > O_BLUE + 0.03) {
          entryAt.set(atk, clk.t)
          beat = mkBeat('cyclePossession', 'OZ_CYCLE', atk, director.cycleDwell())
        } else if (b.ticks > b.dwell) {
          beat = null
        }
        break
      }
      case 'entryFailedOffside': {
        const wing = b.targetIdx >= 0 ? atk.unit.skaters[b.targetIdx] : undefined
        const wingOver = !!wing && wing.pos.x * a > O_BLUE + 0.02
        if (wingOver && b.ticks >= 8 && adv > O_BLUE - 0.08) {
          // The puck hits the line with a teammate already deep: WHISTLE.
          // Faceoff at the neutral-zone dot nearest the blue line.
          ctx.stream.push({
            t: clk.t,
            period,
            type: 'whistle',
            pos: { x: a * O_BLUE, y: puck.y }
          })
          noteBeat('offsideWhistle')
          noteStop('offside')
          stopPlay({ x: a * NZ_DOT_X, y: b.side * DOT_Y }, 'neutral')
        } else if (b.ticks > b.dwell) {
          beat = null // the failure never materialized; re-read the ice
        }
        break
      }
      case 'cyclePossession': {
        if (adv < 0.12) {
          beat = null
          break
        }
        const central = clamp(1 - Math.abs(puck.y) / 0.5, 0, 1)
        const eager = 0.7 + atk.team.tactics.tempo.shotEagerness * 0.6
        // Organic shot off the cycle when a lane opens — but the cycle WORKS
        // the puck first (no instant fling right after the entry; rush beats
        // own the quick-strike shots, which keeps rushShotShare on the data).
        const settledInZone = clk.t - (entryAt.get(atk) ?? -999) > 6
        // Flair makes a carrier more willing to fire a tougher, lower-percentage
        // shot off the cycle. Shot DANGER still comes from position (shotXg).
        // Absent on fictional players (=> 1.0×), so calibration is unaffected.
        const flairShot = cs.player.flair !== undefined ? 1 + ((cs.player.flair - 50) / 100) * 0.5 : 1
        if (settledInZone && adv > 0.5 && rng.chance(director.cycleShotPerTick * (0.5 + central) * eager * strengthMult * flairShot)) {
          tryShoot(cs, 'cycle', false, false)
          beat = null
          break
        }
        if (b.ticks >= b.dwell) {
          const pick = director.sampleOzBeat({
            hasPointMan: pointManIdx(atk, a) >= 0,
            eagerness: eager,
            strengthMult,
            edge
          })
          if (pick === 'pointShot') {
            beat = mkBeat('pointShot', 'POINT_SHOT_SCREEN', atk, 26)
          } else if (pick === 'seamOneTimer') {
            const recv = seamReceiverIdx(atk, cs, a)
            if (recv >= 0) {
              const nb = mkBeat('seamOneTimer', 'SEAM_ONE_TIMER', atk, 18)
              nb.targetIdx = recv
              beat = nb
            } else {
              beat = mkBeat('cyclePossession', 'OZ_CYCLE', atk, director.cycleDwell())
            }
          } else if (pick === 'wraparound') {
            beat = mkBeat('wraparound', 'WRAPAROUND_JAM', atk, 30)
          } else {
            beat = mkBeat('cyclePossession', 'OZ_CYCLE', atk, director.cycleDwell())
          }
        }
        break
      }
      case 'pointShot': {
        const csIdx = atk.unit.skaters.indexOf(cs)
        const atPoint = atk.unit.slots[csIdx] >= 3 || adv < 0.5
        if (!b.passMade && !atPoint) {
          const pm = pointManIdx(atk, a)
          if (pm < 0 || atk.unit.skaters[pm] === cs) {
            tryShoot(cs, 'cycle', false, false)
            beat = null
            break
          }
          b.passMade = true
          passTo(cs, atk.unit.skaters[pm], false, false) // low-to-high
          break
        }
        if (atPoint && b.ticks >= 3 && rng.chance(0.45)) {
          tryShoot(cs, 'point', false, false)
          beat = null
        } else if (b.ticks > b.dwell) {
          beat = null
        }
        break
      }
      case 'seamOneTimer': {
        const recv = b.targetIdx >= 0 ? atk.unit.skaters[b.targetIdx] : undefined
        if (!recv || recv.player.id === carrier) {
          beat = null
          break
        }
        const inSlot =
          recv.pos.x * a > 0.45 &&
          Math.abs(recv.pos.y) < 0.42 &&
          Math.sign(recv.pos.y || 1) !== Math.sign(puck.y || 1)
        if ((inSlot && b.ticks >= 4) || b.ticks >= b.dwell) {
          passTo(cs, recv, true, false) // the royal-road feed; shot on arrival
          beat = null
        }
        break
      }
      case 'rushShot':
      case 'turnoverCounter': {
        if (adv > O_BLUE + 0.03 && !b.passMade) {
          b.passMade = true // the carry IS the entry
          if (ctx.telemetry) ctx.telemetry.entries.carry++
          entryAt.set(atk, clk.t)
        }
        if (b.breakaway) {
          // In alone: drive the net and release in tight. NEVER a pass.
          if ((adv > 0.78 && rng.chance(0.5)) || (adv > 0.55 && rng.chance(0.08))) {
            tryShoot(cs, 'rush', false, false)
            beat = null
          }
          break
        }
        if (b.oddMan && adv > 0.5 && adv < 0.78 && rng.chance(0.12)) {
          const mate = rushLaneMate(atk, cs, a)
          if (mate) {
            passTo(cs, mate, true, true) // 2-on-1: pass across for the one-timer
            beat = null
            break
          }
        }
        if (adv > 0.55 && rng.chance(0.1 + (b.oddMan ? 0.12 : 0) + clamp(adv - 0.55, 0, 0.25) * 0.5)) {
          tryShoot(cs, 'rush', false, b.oddMan)
          beat = null
          break
        }
        if (b.ticks > b.dwell) {
          beat = adv > O_BLUE ? mkBeat('cyclePossession', 'OZ_CYCLE', atk, director.cycleDwell()) : null
        }
        break
      }
      case 'wraparound': {
        if (adv > 0.84 && Math.abs(puck.y) < 0.28 && b.ticks >= 6) {
          tryShoot(cs, 'wrap', false, false)
          beat = null
        } else if (b.ticks > b.dwell) {
          beat = mkBeat('cyclePossession', 'OZ_CYCLE', atk, director.cycleDwell())
        }
        break
      }
      case 'reboundScramble': {
        if (adv > 0.5 && rng.chance(0.55)) {
          tryShoot(cs, 'rebound', false, false)
          beat = null
        } else if (b.ticks > b.dwell) {
          beat = mkBeat('cyclePossession', 'OZ_CYCLE', atk, director.cycleDwell())
        }
        break
      }
      default: {
        beat = pickBeat(pressure)
        break
      }
    }

    // 6. Organic puck movement inside flowing beats (never on a breakaway, and
    //    never mid set-play — the choreographer owns those touches).
    if (beat && beat.team === atk && !flight && carrier !== null) {
      const k = beat.kind
      const flowing = k === 'breakout' || k === 'regroup' || k === 'cyclePossession'
      if (flowing && !beat.breakaway) {
        const tempoPace = atk.team.tactics.tempo.pace
        const forced = heldTicks >= MAX_HOLD_TICKS
        if (forced || rng.chance((PASS_BASE + pressure * 0.12) * (0.8 + tempoPace * 0.4))) {
          doPass(cs, pressure)
        }
      }
    }
  }

  const endT = endedSuddenDeath ? clk.t : lengthSeconds
  creditShift(endT)
  ctx.stream.push({ t: endT, period, type: 'periodEnd' })
  return { ended: endedSuddenDeath }
}

function shootout(ctx: Ctx, home: TeamSim, away: TeamSim, period: number): void {
  const rng = ctx.rng
  const shooterSkill = (t: TeamSim): number => {
    const shooters = t.team.lines.forwards.flat().map((id) => t.resolve(id))
    let s = 0
    for (const p of shooters) s += p.composites.scoring
    return s / shooters.length / LEAGUE_AVG
  }
  const goalieSkill = (t: TeamSim): number =>
    t.resolve(t.team.lines.goalies[0]).composites.goaltending / LEAGUE_AVG
  const attempt = (atk: TeamSim, def: TeamSim): boolean =>
    rng.chance(clamp(0.33 * shooterSkill(atk) * (2 - goalieSkill(def)), 0.1, 0.6))

  let h = 0
  let a = 0
  for (let round = 0; round < 3; round++) {
    if (attempt(home, away)) h++
    if (attempt(away, home)) a++
  }
  while (h === a) {
    if (attempt(home, away)) h++
    if (attempt(away, home)) a++
  }
  const winner = h > a ? home : away
  winner.goals++
  // A shootout adds one to the team's final score but is NOT a player goal (NHL
  // rules). Emit a nominal goal event so the scoreboard/timeline show the win,
  // attributed to the winner's top forward without touching player stats.
  const nominal = winner.team.lines.forwards
    .flat()
    .map((id) => winner.resolve(id))
    .reduce((b, p) => (p.composites.scoring > b.composites.scoring ? p : b))
  ctx.stream.push({
    t: OT_SECONDS,
    period,
    type: 'goal',
    scorer: nominal.id,
    assists: [],
    strength: 'ev',
    pos: { x: 0, y: 0 }
  })
}

export interface FullSimOptions {
  seed: number
  /**
   * Rule variant (default 'regularSeason'). 'playoff' replaces the 3v3 OT +
   * shootout with repeated 20-minute 5v5 sudden-death periods until a goal.
   */
  rules?: GameRules
  /** Optional diagnostic sink (shot kinds/danger, beats, stoppages) for tests. */
  telemetry?: FullSimTelemetry
}

export function fullSimGame(
  home: Team,
  away: Team,
  resolve: (id: PlayerId) => Player,
  opts: FullSimOptions
): GameOutcome {
  const rules = opts.rules ?? 'regularSeason'
  const rng = new Rng(opts.seed)
  const ctx: Ctx = { rng, stream: [], stats: new Map(), telemetry: opts.telemetry ?? null }
  const director = new Director(rng)
  const homeSim = new TeamSim(home, resolve)
  const awaySim = new TeamSim(away, resolve)

  let absBase = 0
  for (let period = 1; period <= REGULATION_PERIODS; period++) {
    simPeriod(
      ctx,
      homeSim,
      awaySim,
      {
        period,
        lengthSeconds: PERIOD_SECONDS,
        suddenDeath: false,
        absBase,
        baseSkaters: 5
      },
      director
    )
    absBase += PERIOD_SECONDS
  }

  let decidedBy: GameOutcome['decidedBy'] = 'regulation'
  let finalPeriod = REGULATION_PERIODS
  if (homeSim.goals === awaySim.goals) {
    if (rules === 'playoff') {
      // Full 20-minute 5v5 sudden-death periods until somebody scores.
      decidedBy = 'overtime'
      let period = REGULATION_PERIODS + 1
      for (;;) {
        const ot = simPeriod(
          ctx,
          homeSim,
          awaySim,
          {
            period,
            lengthSeconds: PERIOD_SECONDS,
            suddenDeath: true,
            absBase,
            baseSkaters: 5
          },
          director
        )
        absBase += PERIOD_SECONDS
        finalPeriod = period
        if (ot.ended) break
        period++
      }
    } else {
      // Regular season: 5 minutes of 3-on-3, then the shootout.
      finalPeriod = REGULATION_PERIODS + 1
      const ot = simPeriod(
        ctx,
        homeSim,
        awaySim,
        {
          period: finalPeriod,
          lengthSeconds: OT_SECONDS,
          suddenDeath: true,
          absBase,
          baseSkaters: 3
        },
        director
      )
      if (ot.ended) {
        decidedBy = 'overtime'
      } else {
        shootout(ctx, homeSim, awaySim, finalPeriod)
        decidedBy = 'shootout'
      }
    }
  }

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

// Re-export the pieces tests and tooling reach for, so `@engine/full/fullSim`
// stays the single import point for the full engine.
export { FRAME_DT } from './types'
export type { BeatKind, FullSimTelemetry, ShotKind, StoppageCounts } from './types'
export { BEAT_KINDS, emptyTelemetry } from './types'
export { MAX_SPEED_FT, MIN_SPEED_FT, topSpeedFt } from './movement'
export { Director, FALLBACK_SEQUENCES, sequenceTargets } from './director'
export type { SequenceTargets } from './director'
export type { PlayId } from './playbook'
