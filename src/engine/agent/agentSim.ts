/**
 * THE AGENT ENGINE — a watched game where the hockey EMERGES.
 *
 * Built alongside the director engine (src/engine/full) behind a flag
 * (`watchedGame(..., { engine: 'agent' })`); both emit the same GameEvent
 * stream, so both renderers work unchanged. The game shell (lines, penalties
 * boxed, OT/shootout, outcome) is shared via runGame(); this file plays a
 * period:
 *
 *   every frame (0.25 s)   agents think (brain.ts): the carrier picks carry /
 *                          pass / shoot / dump from the situation and his
 *                          attributes; support skaters and defenders take
 *                          their role spots (templates.ts), press, cover,
 *                          block lanes, race loose pucks;
 *   every substep (0.05 s) physics (physics.ts): momentum skating, bodies in
 *                          contact, the puck carried on a blade or sliding,
 *                          bouncing off boards and nets; passes are caught or
 *                          picked off by whoever's stick the puck reaches;
 *   rules                  offside and icing are REAL (detected from positions
 *                          at the blue line / goal line), pucks over the glass
 *                          stop play, goalies freeze pucks, delayed penalties
 *                          run until the offending side touches the puck.
 *
 * Shot outcomes use the calibrated xG surface at the true release point, bent
 * by what is physically there (bodies in the lane block, traffic screens, a
 * goalie caught moving after a cross-ice pass is beaten more often).
 */
import type {
  GameEvent,
  PassEvent,
  PassKind,
  DekeKind,
  ShotOrigin,
  ShotType,
  Player,
  PlayerId,
  Team,
  XY
} from '@domain'
import type { Rng } from '@engine/shared/rng'
import type { GameOutcome } from '@engine/shared/outcome'
import { benchTilt, scoreEffectMult } from '@engine/shared/scoreEffects'
import { FIGHT_MAJOR_SECONDS } from '@engine/shared/fights'
import { fragilityWeight } from '@engine/shared/inGameInjury'
import { coachFitMultiplier } from '@engine/league/coachProfile'
import {
  goaliePullWindow,
  pickAssists,
  runGame,
  sliderMult,
  stat,
  takerIdxOf,
  weightedIndex,
  type DeployKind,
  type FullSimOptions,
  type PeriodOutcome,
  type PeriodSpec,
  type TeamSim
} from '@engine/full/fullSim'
import type { Ctx, RSkater } from '@engine/full/types'
import {
  bladePoint,
  constrainBody,
  makeBody,
  resolveBodies,
  speedOf,
  stepBody,
  stepPuck,
  type Body,
  type Contact,
  type MoveCmd,
  type Puck
} from './physics'
import { BLUE_X, DOT_EZ_X, DOT_NZ_X, DOT_Y, GOAL_X, HALF_X, HALF_Y, NET_HALF_W, boardsClamp, distToBoards } from './rink'
import { DEKE, REACH, blockChance, decideCarrier, dekeSkill, pressureOn, realPressure, thinkSide, xgAt, type ThinkOut } from './brain'
import { decideHit, resolveHit, type HitIntent } from './physical'
import { emptyAgentTelemetry, type AgentTelemetry } from './telemetry'
import { LEVEL, levelDefOffset, levelOffset, rDef, rLevel, type CarrierAction, type Side, type World } from './world'

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const r01 = rLevel

export const FRAME_DT = 0.25
const SUBSTEPS = 5
const DT = FRAME_DT / SUBSTEPS

// ---------------------------------------------------------------------------
// Calibration constants (measured against the engine, then frozen — retune
// here, with the calibration test's numbers, never per-feature).
// ---------------------------------------------------------------------------
export const AGENT_TUNING = {
  /** Reconciles the empirical xG with this engine's shot mix → goals/game. */
  finishK: 0.8,
  /** Base share of unblocked attempts that miss the net. */
  missBase: 0.3,
  /** Poke-check success scale (takeaways). */
  pokeK: 0.065,
  /** Stick-check success multiplier on a carrier who is standing still. */
  pokeStill: 2.2,
  /** Chance per ready think that a defender stabs at a MOVING carrier in reach. */
  pokeTry: 0.08,
  pokeTryStill: 0.6,
  /** Below this speed (ft/s) a carrier counts as standing still for stick checks. */
  pokeStillV: 4.5,
  /** Success scale per real attempt (attempts are rarer than thinks). */
  pokeAttemptK: 6.5,
  /** Unforced fumble rate under pressure (giveaways). */
  fumbleK: 7.5,
  /** Per-think stick-foul chance when beaten (penalties). */
  stickFoulK: 2.5,
  /** Misc stoppages per second of live play ("other": net off, high stick…). */
  miscStopPerSec: 0.0028
}

const PP_SHOT_BOOST = 1.12
/** Seconds from committing to a shot to the puck leaving the blade (a slapper from the point winds up longer). */
export const VAL_WINDUP = { near: FRAME_DT, far: FRAME_DT }
const SHIFT_TARGET = 22
const PENALTY_SECONDS = 120
/**
 * Bench doors (ft) on the bench-side boards. Benches don't move between
 * periods: the home bench is on the home team's first-period defending half,
 * so the second period is the LONG change for both teams.
 */
const BENCH_GATE = { x: 22, y: -41 }
const GOAL_CELEBRATION_S = 4
const FACEOFF_MIN_WAIT = 1.5
const FACEOFF_MAX_WAIT = 12
/** Seconds a defender needs between two real stick checks. */
const POKE_RELOAD_S = 1.4
/** A skater who fumbles a touch gets another try this much later. */
const RETRY_S = 0.3

interface Flight {
  kind: 'pass' | 'shot' | 'dump' | 'loose'
  side: Side | null
  from: Body | null
  passEv?: PassEvent | undefined
  to?: Body | undefined
  /** Release x in the shooting side's frame (icing needs it). */
  releaseAdv: number
  /** Nobody has touched it since release (icing). */
  untouched: boolean
  shot?: ShotPlan | undefined
  /** Skaters who already had their one try at this puck while it was near them. */
  /** Last clock time each skater tried to play this puck (one try per ~0.3 s). */
  tried: Map<Body, number>
}

interface ShotPlan {
  outcome: 'block' | 'miss' | 'save' | 'goal'
  shooter: Body
  side: Side
  blocker?: Body | undefined
  /** Where the outcome happens and after how many feet of travel. */
  at: XY
  travel: number
  travelled: number
  from: XY
  xg: number
  rebound: boolean
}

interface DelayedPenalty {
  offender: Body
  side: Side
  infraction: string
  drawnBy: Body | null
}

export function agentPeriod(ctx: Ctx, home: TeamSim, away: TeamSim, spec: PeriodSpec, tm: AgentTelemetry | null): PeriodOutcome {
  const { rng } = ctx
  const { period, lengthSeconds, suddenDeath, absBase, baseSkaters } = spec
  home.defendsPositive = period % 2 === 0
  away.defendsPositive = !home.defendsPositive
  // The rating level of tonight's two rosters (outcomes read ratings relative to it).
  {
    const dressed = [home, away].flatMap((t) => [...t.team.lines.forwards.flat(), ...t.team.lines.defensePairs.flat()].map((id) => t.resolve(id)))
    LEVEL.offset = levelOffset(dressed)
    LEVEL.def = levelDefOffset(dressed)
  }

  const bodies = new Map<PlayerId, Body>()
  const bodyFor = (r: RSkater): Body => {
    let b = bodies.get(r.player.id)
    if (!b) {
      b = makeBody(r.player, r.pos.x * HALF_X, r.pos.y * HALF_Y, 0)
      b.vx = r.vel.x
      b.vy = r.vel.y
      bodies.set(r.player.id, b)
    }
    return b
  }

  const gateOf = (s: Side): XY => ({ x: (s.sim === home ? -1 : 1) * BENCH_GATE.x, y: BENCH_GATE.y })
  const mkSide = (sim: TeamSim): Side => ({
    sim,
    a: sim.attackSign(),
    skaters: [],
    slots: [],
    goalie: null as unknown as Body,
    tactics: sim.team.tactics,
    roles: new Map(),
    presser: null,
    entryAt: -99,
    shorthanded: false,
    powerPlay: false,
    pulled: false,
    ot: baseSkaters === 3
  })
  const H = mkSide(home)
  const A = mkSide(away)
  const sides: [Side, Side] = [H, A]
  const oppOf = (s: Side): Side => (s === H ? A : H)

  const puck: Puck = { x: 0, y: 0, vx: 0, vy: 0, z: 0, vz: 0, carrier: null }
  const w: World = {
    t: 0,
    rng,
    puck,
    carrier: null,
    control: null,
    lastTouch: null,
    sides,
    passTo: null,
    flightSide: null,
    oneTimerFor: null,
    lastHad: new Map(),
    delayedOffside: null,
    possSince: 0,
    possStartAdv: 0,
    nearSince: -1,
    nearBy: null
  }
  let flight = null as Flight | null
  let now = 0
  let ended = false
  let deadAt: XY | null = null
  let pending: { dot: XY; zone: 'offensive' | 'defensive' | 'neutral'; since: number; zoneFor: Side | null } | null = null
  let celebration: { scorer: Body; side: Side; until: number } | null = null
  let delayed: DelayedPenalty | null = null
  const touches: { b: Body; side: Side; t: number }[] = []
  let poke: { by: Body; from: Body; side: Side; t: number } | null = null
  let fumble: { by: Body; side: Side; t: number } | null = null
  let lastSaveAt = -99
  let boardPinSince = -1
  const lastShift = new Map<Side, number>([[H, 0], [A, 0]])
  const cmds = new Map<Body, MoveCmd>()
  const smooth = new Map<Body, { x: number; y: number }>()
  const shaping = new Map<Body, { ox: number; oy: number; sf: number }>()
  let prevAdv = 0 // puck x in the controlling side's frame, last substep
  let lastCarrierAdvSide = null as Side | null
  const hitIntent = new Map<Body, HitIntent>()
  let codeDue: { answerer: Body; hitter: Body; side: Side } | null = null
  let battle: { start: number; x: number; y: number; kind: 'boards' | 'netFront' | 'loosePuck'; players: Set<Body>; last: number } | null = null
  let gotAt = 0
  let gotHow = 'faceoff'
  let flightKindAtGain = 'faceoff'
  let gotPos: XY = { x: 0, y: 0 }
  let turnSnap = ""
  let deke = null as { c: Body; on: Body; goalie: boolean; move: DekeKind; success: boolean; until: number; dir: number } | null
  let windup = null as { c: Body; at: number } | null
  let bite = null as { side: Side; dy: number; until: number } | null
  let prevPoss: { side: Side; since: number; adv: number } | null = null

  const pokeReady = new Map<Body, number>()
  const tries = (...bs: Body[]): Map<Body, number> => new Map(bs.map((b) => [b, now] as [Body, number]))
  const ev = (e: GameEvent): void => {
    ctx.stream.push(e)
  }
  const T = (): number => Math.round(now * 100) / 100

  // -------------------------------------------------------------------------
  // Deployment / strength / line changes
  // -------------------------------------------------------------------------
  const goalieAtBench = new Set<TeamSim>()
  const desiredFor = (team: TeamSim, opp: TeamSim): { kind: DeployKind; count: number } => {
    if (baseSkaters === 3) {
      const adv = clamp(opp.penalties.length - team.penalties.length, 0, 1)
      return { kind: 'ot', count: 3 + adv }
    }
    // The extra attacker jumps on only once the goalie is at the bench door.
    const extra = team.pulled && goalieAtBench.has(team) ? 1 : 0
    if (team.penalties.length > 0) return { kind: 'pk', count: clamp(5 - team.penalties.length + extra, 3, 6) }
    if (opp.penalties.length > 0) return { kind: 'pp', count: clamp(5 + extra, 3, 6) }
    return { kind: 'ev', count: clamp(5 + extra, 3, 6) }
  }

  const creditShift = (s: Side, upTo: number): void => {
    const dur = upTo - (lastShift.get(s) ?? 0)
    const kind = s.sim.deployKey.split(':')[0]
    for (const r of s.sim.unit.skaters) {
      const st = stat(ctx, r.player.id)
      st.toi += dur
      if (kind === 'pp') st.ppToi = (st.ppToi ?? 0) + dur
      else if (kind === 'pk') st.pkToi = (st.pkToi ?? 0) + dur
    }
    stat(ctx, s.sim.unit.goalie.player.id).toi += dur
    lastShift.set(s, upTo)
  }

  /** Re-read the side's on-ice bodies after a deploy. */
  /** Shift energy of skaters on the bench (recovers while sitting). */
  const benchEnergy = new Map<PlayerId, { e: number; at: number }>()
  const BENCH_RECOVER_PER_S = 0.012

  /**
   * Re-read the side's on-ice bodies after a deploy. A player who stays on
   * keeps his body (no jump); a new man takes the place of a departing
   * teammate of the same position (the renderers walk rigs through the bench
   * gate), keeping his momentum so the change is seamless.
   */
  const bindSide = (s: Side, departing: Body[] = []): void => {
    const unit = s.sim.unit
    const free = departing.filter((b) => !unit.skaters.some((r) => r.player.id === b.player.id))
    s.skaters = unit.skaters.map((r) => {
      const had = bodies.get(r.player.id)
      if (had) return had
      const isD = r.player.position === 'D'
      const src = free.find((b) => (b.player.position === 'D') === isD) ?? free[0]
      if (src) free.splice(free.indexOf(src), 1)
      // Nobody leaving to take the place of (the extra attacker, a man back
      // from the box): he comes over the boards at the bench door.
      const gate = { x: gateOf(s).x, y: BENCH_GATE.y + 1.5 }
      const b = makeBody(r.player, src ? src.x : gate.x, src ? src.y : gate.y, s.a)
      if (src) {
        b.vx = src.vx
        b.vy = src.vy
        b.hx = src.hx
        b.hy = src.hy
      }
      const rest = benchEnergy.get(r.player.id)
      if (rest) b.energy = clamp(rest.e + (now - rest.at) * BENCH_RECOVER_PER_S, 0, 1)
      bodies.set(r.player.id, b)
      return b
    })
    s.slots = [...unit.slots]
    s.goalie = bodyFor(unit.goalie)
  }

  // --- On-the-fly changes through the bench door. ------------------------
  // The tired men skate to the gate; each fresh man comes over the boards
  // there only when the man he replaces arrives (no too-many-men, no
  // teleports), so a change takes a few real seconds.
  interface Change {
    swaps: { out: Body; inId: PlayerId }[]
    swapped: number
    key: string
  }
  const changing = new Map<Side, Change>()
  const beginChange = (s: Side): void => {
    const opp = oppOf(s)
    const d = desiredFor(s.sim, opp.sim)
    const tilt = benchTilt(s.sim.goals - opp.sim.goals, (period - 1 + now / lengthSeconds) / 3)
    const ids = (s.sim as unknown as { deployIds(r: Rng, k: DeployKind, c: number, o?: TeamSim, t?: number): PlayerId[] }).deployIds(rng, d.kind, d.count, opp.sim, tilt)
    const cur = new Set(s.skaters.map((b) => b.player.id))
    const incoming = ids.filter((id) => !cur.has(id))
    const outgoing = s.skaters.filter((b) => !ids.includes(b.player.id))
    if (incoming.length === 0 || incoming.length !== outgoing.length) {
      // Same men (a double shift) — or a shape change: reset the shift clock.
      creditShift(s, now)
      if (incoming.length !== outgoing.length) deploySide(s, true, true)
      return
    }
    const swaps: Change['swaps'] = []
    const left = [...incoming]
    for (const b of outgoing) {
      const isD = b.player.position === 'D'
      let k = left.findIndex((id) => (s.sim.resolve(id).position === 'D') === isD)
      if (k < 0) k = 0
      swaps.push({ out: b, inId: left[k] })
      left.splice(k, 1)
    }
    changing.set(s, { swaps, swapped: 0, key: `${d.kind}:${d.count}` })
  }
  const stepChanges = (): void => {
    for (const [s, ch] of changing) {
      const gate = gateOf(s)
      for (let i = ch.swaps.length - 1; i >= 0; i--) {
        const sw = ch.swaps[i]
        const b = sw.out
        if (b === w.carrier) continue // he gets rid of it first
        const dg = Math.hypot(b.x - gate.x, b.y - gate.y)
        // They've turned it over and are coming: a man still far from the
        // door stays on and plays (a change is abandoned, not completed into
        // an odd-man rush against).
        const oppS = oppOf(s)
        if (dg > 30 && w.control === oppS && w.carrier && (w.carrier.x - b.x) * s.a > -10 && w.carrier.vx * s.a < -8) {
          ch.swaps.splice(i, 1)
          continue
        }
        if (dg > 8) {
          cmds.set(b, { tx: gate.x, ty: gate.y, speed: b.caps.top * 0.88, arrive: false, urgency: 0.9 })
          continue
        }
        creditShift(s, now)
        const idx = s.skaters.indexOf(b)
        if (idx < 0) {
          ch.swaps.splice(i, 1)
          continue
        }
        const p = s.sim.resolve(sw.inId)
        const nb = makeBody(p, gate.x, gate.y + 2, s.a)
        nb.vy = 8
        const rest = benchEnergy.get(p.id)
        if (rest) nb.energy = clamp(rest.e + (now - rest.at) * BENCH_RECOVER_PER_S, 0, 1)
        benchEnergy.set(b.player.id, { e: b.energy, at: now })
        bodies.delete(b.player.id)
        bodies.set(p.id, nb)
        s.skaters[idx] = nb
        s.sim.unit.skaters[idx] = { player: p, pos: { x: nb.x / HALF_X, y: nb.y / HALF_Y }, vel: { x: 0, y: 0 } }
        hitIntent.delete(b)
        if (w.passTo === b) w.passTo = null
        ch.swaps.splice(i, 1)
        ch.swapped++
      }
      if (ch.swaps.length === 0) {
        changing.delete(s)
        s.sim.deployKey = ch.key
        if (tm && ch.swapped > 0) tm.lineChanges++
        if (ch.swapped > 0) ev({ t: T(), period, type: 'lineChange', team: s.sim.team.id, onIce: s.skaters.map((q) => q.player.id), onTheFly: true })
      }
    }
  }

  const deploySide = (s: Side, announce: boolean, onTheFly = false): void => {
    changing.delete(s)
    const opp = oppOf(s)
    const d = desiredFor(s.sim, opp.sim)
    const tilt = benchTilt(s.sim.goals - opp.sim.goals, (period - 1 + now / lengthSeconds) / 3)
    const old = s.skaters.slice()
    const inherit = old.map((b) => ({ x: b.x / HALF_X, y: b.y / HALF_Y }))
    const [curKind, curCount] = s.sim.deployKey.split(':')
    const unit0 = s.sim.unit
    if (unit0 && d.kind === curKind && d.count === Number(curCount) + 1 && s.sim.pulled) {
      // The extra attacker joins the five already out there (nobody else changes).
      const boxed = new Set([...s.sim.penalties, ...s.sim.sidelined].map((p) => p.playerId))
      const onIce = unit0.skaters.map((r) => r.player.id)
      const extraId = (s.sim as unknown as { bestExtraAttacker(on: PlayerId[], boxed: Set<PlayerId>): PlayerId | null }).bestExtraAttacker(onIce, boxed)
      if (extraId) {
        const p = s.sim.resolve(extraId)
        unit0.skaters.push({ player: p, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } })
        unit0.slots = [...unit0.slots, 1]
        s.sim.deployKey = `${d.kind}:${d.count}`
      } else s.sim.deploy(rng, d.kind, d.count, inherit.length ? inherit : undefined, opp.sim, tilt)
    } else s.sim.deploy(rng, d.kind, d.count, inherit.length ? inherit : undefined, opp.sim, tilt)
    const staying = new Set(s.sim.unit.skaters.map((r) => r.player.id))
    for (const b of old) {
      if (staying.has(b.player.id)) continue
      bodies.delete(b.player.id)
      benchEnergy.set(b.player.id, { e: b.energy, at: now })
    }
    bindSide(s, old)
    if (w.carrier && !s.skaters.includes(w.carrier) && old.includes(w.carrier)) {
      w.carrier = null
      puck.carrier = null
    }
    const sameMen = old.length === s.skaters.length && old.every((b) => s.skaters.includes(b))
    if (announce && !sameMen) {
      if (tm) tm.lineChanges++
      ev({ t: T(), period, type: 'lineChange', team: s.sim.team.id, onIce: s.skaters.map((b) => b.player.id), onTheFly })
    }
    s.shorthanded = s.sim.shorthanded()
    s.powerPlay = !s.shorthanded && opp.sim.shorthanded()
  }

  const syncStrength = (): void => {
    for (const s of sides) {
      const d = desiredFor(s.sim, oppOf(s).sim)
      if (`${d.kind}:${d.count}` !== s.sim.deployKey) {
        creditShift(s, now)
        deploySide(s, true)
      }
    }
    for (const s of sides) {
      s.shorthanded = s.sim.shorthanded()
      s.powerPlay = !s.shorthanded && oppOf(s).sim.shorthanded()
      s.pulled = s.sim.pulled
    }
  }

  const updatePull = (s: Side): void => {
    const t = s.sim
    if (period !== 3) {
      t.pulled = false
      return
    }
    const deficit = oppOf(s).sim.goals - t.goals
    const win = goaliePullWindow(deficit, t.team.tactics.aggressiveness)
    const wanted = win > 0 && lengthSeconds - now <= win
    if (!wanted) {
      t.pulled = false
      return
    }
    // The goalie goes when it's safe: his team has the puck in the offensive
    // half, or play is stopped (then he's already at the bench for the draw).
    if (!t.pulled && ((w.control === s && puck.x * s.a > 0) || pending !== null)) t.pulled = true
  }

  // -------------------------------------------------------------------------
  // Stoppages and faceoffs
  // -------------------------------------------------------------------------
  const stopPlay = (dot: XY, zone: 'offensive' | 'defensive' | 'neutral', zoneFor: Side | null, reason?: 'offside' | 'icing' | 'goalieFreeze' | 'penalty' | 'other'): void => {
    endBattle(null)
    deke = null
    windup = null
    ev({ t: T(), period, type: 'whistle', pos: { x: puck.x / HALF_X, y: puck.y / HALF_Y }, ...(reason ? { reason } : {}) })
    if (tm && reason) tm.stoppages[reason]++
    deadAt = { x: puck.x, y: puck.y }
    pending = { dot, zone, since: now, zoneFor }
    w.carrier = null
    puck.carrier = null
    w.control = null
    flight = null
    w.passTo = null
    w.flightSide = null
    w.oneTimerFor = null
    puck.vx = puck.vy = puck.vz = puck.z = 0
    w.delayedOffside = null
    hitIntent.clear()
    // A delayed penalty is assessed at the whistle.
    if (delayed) assessDelayed()
    // THE CODE: somebody answers for the dirty hit at this whistle.
    const answered = settleTheCode()
    // Tired lines change at the whistle.
    for (const s of sides) {
      // The team that iced it stays out there (NHL rule 81.1).
      if (reason === 'icing' && s === zoneFor && !answered) continue
      const shift = now - (lastShift.get(s) ?? 0)
      if (shift > 20 || answered) {
        creditShift(s, now)
        deploySide(s, true)
      }
    }
  }

  const dotFt = (x: number, y: number): XY => ({ x, y })
  /** The end-zone dot on the puck's side in `s`'s DEFENSIVE zone. */
  const dzDot = (s: Side, y: number): XY => dotFt(-s.a * DOT_EZ_X, y >= 0 ? DOT_Y : -DOT_Y)
  const nearestDot = (p: XY): XY => {
    const dots: XY[] = [{ x: 0, y: 0 }]
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      dots.push({ x: sx * DOT_NZ_X, y: sy * DOT_Y })
      dots.push({ x: sx * DOT_EZ_X, y: sy * DOT_Y })
    }
    let best = dots[0]
    let bd = Infinity
    for (const d of dots) {
      const dd = Math.hypot(d.x - p.x, d.y - p.y)
      if (dd < bd) {
        bd = dd
        best = d
      }
    }
    return best
  }
  const zoneOf = (dot: XY, s: Side): 'offensive' | 'defensive' | 'neutral' =>
    Math.abs(dot.x) <= 25 ? 'neutral' : dot.x * s.a > 0 ? 'offensive' : 'defensive'

  /**
   * Legal faceoff alignment (NHL rule 76): the two centres at the dot, every
   * other skater OUTSIDE the circle — wingers on the hash marks, D back (at
   * the points in the offensive zone, covering the slot and the far side in
   * their own). Spots are in each team's attack frame and mirrored to the
   * dot's side; extra men (PP/6th attacker) stack behind.
   */
  const faceoffSpots = (s: Side, dot: XY): Map<Body, XY> => {
    const out = new Map<Body, XY>()
    const a = s.a
    const tk = s.skaters[takerIdxOf(s.sim.unit)]
    const dx = dot.x * a // dot in this team's attack frame
    const sy = dot.y >= 0 ? 1 : -1 // boards side of the dot
    const inOz = dx > 30
    const inDz = dx < -30
    const fwd = s.skaters.filter((b) => b !== tk && b.player.position !== 'D')
    const dmen = s.skaters.filter((b) => b !== tk && b.player.position === 'D')
    const put = (b: Body, x: number, y: number): void => {
      const h = boardsClamp(a * x, y, 2.5)
      out.set(b, { x: h.x, y: h.y })
    }
    if (tk) put(tk, dx - 1.3, dot.y)
    // Wingers: on the hash marks, boards side and slot side.
    const hashY = [dot.y + sy * 16.5, dot.y - sy * 16.5]
    fwd.forEach((b, i) => {
      if (i < 2) put(b, dx - 3, hashY[i])
      else put(b, dx - 16, dot.y - sy * 8)
    })
    // Defence.
    dmen.forEach((b, i) => {
      if (inOz) put(b, 32, i === 0 ? sy * 20 : -sy * 12)
      else if (inDz) put(b, i === 0 ? dx - 18 : -84, i === 0 ? dot.y - sy * 4 : -sy * 4)
      else put(b, dx - 28, i === 0 ? sy * 12 : -sy * 16)
    })
    return out
  }

  const faceoffTargets = (): void => {
    const p = pending!
    for (const s of sides) {
      const spots = faceoffSpots(s, p.dot)
      s.skaters.forEach((b) => {
        const spot = spots.get(b) ?? { x: b.x, y: b.y }
        const tx = spot.x
        const ty = spot.y
        const d = Math.hypot(tx - b.x, ty - b.y)
        cmds.set(b, {
          tx,
          ty,
          speed: clamp(8 + d * 0.4, 8, b.caps.top * 0.8),
          arrive: true,
          urgency: 0.45,
          faceX: p.dot.x,
          faceY: p.dot.y
        })
      })
    }
  }

  const conductFaceoff = (): boolean => {
    const p = pending!
    const waited = now - p.since
    const hC = H.skaters[takerIdxOf(H.sim.unit)]
    const aC = A.skaters[takerIdxOf(A.sim.unit)]
    // Everybody set before the drop (the linesman waits for them).
    let set = waited >= FACEOFF_MIN_WAIT && !!hC && !!aC
    if (set) {
      for (const s of sides) {
        const spots = faceoffSpots(s, p.dot)
        for (const b of s.skaters) {
          const q = spots.get(b)
          if (q && Math.hypot(q.x - b.x, q.y - b.y) > 3.5) set = false
        }
      }
    }
    if (!set && waited < FACEOFF_MAX_WAIT) return false
    if (!hC || !aC) return false
    const hw = hC.player.composites.faceoffWin
    const aw = aC.player.composites.faceoffWin
    const homeWins = rng.chance(hw / Math.max(1, hw + aw))
    const win = homeWins ? H : A
    const lose = homeWins ? A : H
    const winner = homeWins ? hC : aC
    deadAt = null
    pending = null
    puck.x = p.dot.x
    puck.y = p.dot.y
    puck.z = 0
    puck.vz = 0
    // The draw goes somewhere on purpose: back to a D (standard), to the
    // winger on the wall (wheel), straight at the net (quick-strike, offensive
    // zone), or it's a tie-up scrum. The zone play comes from the coach.
    const dx = p.dot.x * win.a
    const play = (dx > 30 ? win.tactics.offensiveFaceoff : dx < -30 ? win.tactics.defensiveFaceoff : undefined) ?? 'standard'
    const clean = rng.chance(0.72 + (Math.abs((homeWins ? hw : aw) - (homeWins ? aw : hw)) / 100) * 0.4)
    let target: Body | null = null
    let at: XY
    const spots = faceoffSpots(win, p.dot)
    const dList = win.skaters.filter((b) => b.player.position === 'D')
    const wList = win.skaters.filter((b) => b !== winner && b.player.position !== 'D')
    if (!clean || play === 'tie-up') {
      at = { x: p.dot.x + rng.float(-4, 4), y: p.dot.y + rng.float(-4, 4) }
    } else if (play === 'quick-strike' && dx > 30) {
      at = { x: win.a * (GOAL_X - 12), y: p.dot.y * 0.4 }
    } else if (play === 'wheel' && wList.length > 0) {
      target = wList[0]
      at = spots.get(target) ?? { x: target.x, y: target.y }
    } else {
      target = dList.sort((q, r) => Math.hypot(q.x - p.dot.x, q.y - p.dot.y) - Math.hypot(r.x - p.dot.x, r.y - p.dot.y))[0] ?? wList[0] ?? null
      at = target ? (spots.get(target) ?? { x: target.x, y: target.y }) : { x: p.dot.x - win.a * 10, y: p.dot.y }
    }
    const L = Math.max(Math.hypot(at.x - puck.x, at.y - puck.y), 1)
    const sp = clean ? clamp(Math.sqrt(2 * 4.5 * L) * 1.15 + 4, 10, 45) : rng.float(4, 9)
    puck.vx = ((at.x - puck.x) / L) * sp
    puck.vy = ((at.y - puck.y) / L) * sp
    w.carrier = null
    puck.carrier = null
    w.lastTouch = clean ? win : null
    w.passTo = target
    flight = { kind: 'loose', side: clean ? win : null, from: winner, releaseAdv: -99, untouched: false, tried: tries(hC, aC) }
    void lose
    touches.length = 0
    if (tm) tm.faceoffs++
    ev({
      t: T(),
      period,
      type: 'faceoff',
      zone: p.zone === 'neutral' ? 'neutral' : zoneOf(p.dot, win),
      winner: winner.player.id,
      pos: { x: p.dot.x / HALF_X, y: p.dot.y / HALF_Y },
      loser: (homeWins ? aC : hC).player.id
    })
    return true
  }

  // -------------------------------------------------------------------------
  // Possession changes
  // -------------------------------------------------------------------------
  const gainControl = (b: Body, s: Side): void => {
    deke = null
    windup = null
    const prevSide = w.control ?? w.lastTouch
    flightKindAtGain = flight ? (flight.kind === 'pass' && flight.side === s ? 'pass' : flight.kind === 'shot' ? 'shotDeflect' : flight.side === s ? 'ownLoose' : 'oppLoose') : 'none'
    const gainKind = `${flightKindAtGain}:${flight?.kind ?? "-"}${poke ? "+poke" : ""}${fumble ? "+fumble" : ""}`
    w.carrier = b
    puck.carrier = b
    w.control = s
    w.lastTouch = s
    puck.z = 0
    puck.vz = 0
    if (flight?.passEv && flight.passEv.completed === undefined as unknown as boolean) {
      // (unreachable: completed is always set at release)
    }
    if (flight?.kind === 'pass' && flight.passEv) {
      const done = flight.side === s
      flight.passEv.completed = done
      if (done && flight.to && b !== flight.to) flight.passEv.to = b.player.id
      // Scorers log an intercepted pass as a giveaway only some of the time
      // (the NHL's recorded giveaways are the egregious ones).
      if (!done) flight.passEv.interceptedBy = b.player.id
      if (!done && flight.from && rng.chance(0.15)) {
        // Picked off: the passer gave it away.
        ev({ t: T(), period, type: 'giveaway', player: flight.from.player.id, pos: { x: puck.x / HALF_X, y: puck.y / HALF_Y } })
        if (tm) tm.giveaways++
      }
      if (tm) {
        if (done) tm.passesCompleted++
        else tm.passesIntercepted++
      }
    }
    if (poke && poke.side === s && now - poke.t < 2.5) {
      ev({ t: T(), period, type: 'takeaway', by: poke.by.player.id, from: poke.from.player.id, pos: { x: puck.x / HALF_X, y: puck.y / HALF_Y } })
      if (tm) tm.takeaways++
    } else if (fumble && fumble.side !== s && now - fumble.t < 2.5) {
      ev({ t: T(), period, type: 'giveaway', player: fumble.by.player.id, pos: { x: puck.x / HALF_X, y: puck.y / HALF_Y } })
      if (tm) tm.giveaways++
    }
    poke = null
    fumble = null
    // One-timer: the receiver shoots on arrival.
    const oneT = w.oneTimerFor === b
    flight = null
    w.passTo = null
    w.flightSide = null
    w.oneTimerFor = null
    if (prevSide !== s) {
      if (tm) {
        const ls = oppOf(s)
        turnSnap = `${gainKind}@${(puck.x * s.a).toFixed(0)} | ` + ls.skaters.map((q) => `${q.player.position}:${ls.roles.get(q) ?? '?'}(${(q.x * ls.a).toFixed(0)},${(q.y * ls.a).toFixed(0)})`).join(' ')
        const tz = puck.x * s.a < -BLUE_X ? "DZ" : puck.x * s.a < BLUE_X ? "NZ" : "OZ"
        tm.dbg[`turn:${gainKind}:${tz}`] = (tm.dbg[`turn:${gainKind}:${tz}`] ?? 0) + 1
      }
      touches.length = 0
      // A possession the other side held for only an instant (a touch, a
      // bobble between frames) does not end ours: the rush we were on is
      // still the rush (the scorecard reads possession from the frames).
      const blip = prevPoss !== null && prevPoss.side === s && now - w.possSince < 0.3
      if (blip && prevPoss) {
        w.possSince = prevPoss.since
        w.possStartAdv = prevPoss.adv
      } else {
        if (prevSide) prevPoss = { side: prevSide, since: w.possSince, adv: w.possStartAdv }
        w.possSince = now
        w.possStartAdv = puck.x * s.a
      }
    }
    touches.push({ b, side: s, t: now })
    gotAt = now
    gotHow = flightKindAtGain
    gotPos = { x: puck.x, y: puck.y }
    if (touches.length > 6) touches.shift()
    // Delayed offside: an offside attacker's team plays the puck in the zone.
    if (w.delayedOffside === s && puck.x * s.a > BLUE_X) {
      if (anyOffside(s)) {
        callOffside(s)
        return
      }
      w.delayedOffside = null
    }
    // Delayed penalty: the offending side touched it — whistle.
    if (delayed && delayed.side === s) {
      stopPlay(dzDot(s, puck.y), 'defensive', s, 'penalty')
      return
    }
    prevAdv = puck.x * s.a
    lastCarrierAdvSide = s
    if (oneT && puck.x * s.a > BLUE_X) shoot(b, s, true)
  }

  const loosen = (vx: number, vy: number, side: Side | null): void => {
    w.carrier = null
    puck.carrier = null
    w.control = null
    puck.vx = vx
    puck.vy = vy
    flight = { kind: 'loose', side, from: null, releaseAdv: -99, untouched: false, tried: tries() }
  }

  // -------------------------------------------------------------------------
  // Passing, dumping, shooting
  // -------------------------------------------------------------------------
  const release = (c: Body, s: Side, at: XY, speed: number, liftIn: number, kind: 'pass' | 'dump', to?: Body, oneTimer = false): void => {
    let lift = liftIn
    const passing = r01(c.player.ratings.technical.passing)
    const pressure = pressureOn(c, oppOf(s).skaters)
    // Aim error grows steeply as passing falls: the good passer hits the tape
    // under pressure, the poor one puts it in skates (completion shows it).
    const sigma = (0.02 + Math.pow(1 - passing, 1.5) * 0.36) * (1 + pressure * 0.8) * (kind === 'dump' ? 1.5 : 1)
    const dx = at.x - puck.x
    const dy = at.y - puck.y
    const L = Math.max(Math.hypot(dx, dy), 0.1)
    const ang = Math.atan2(dy, dx) + rng.normal(0, sigma)
    const sp = speed * (1 + rng.normal(0, 0.05))
    puck.vx = Math.cos(ang) * sp
    puck.vy = Math.sin(ang) * sp
    if (lift > 0) {
      puck.z = 0.5
      puck.vz = lift
    }
    w.carrier = null
    puck.carrier = null
    w.control = null
    w.lastTouch = s
    w.flightSide = s
    w.passTo = to ?? null
    w.oneTimerFor = oneTimer && to ? to : null
    // A stick in the lane: good passers saucer it over (the puck flies, sticks can't reach it).
    if (kind === 'pass' && lift === 0 && passing > 0.45) {
      for (const o of oppOf(s).skaters) {
        const t0 = ((o.x - puck.x) * dx + (o.y - puck.y) * dy) / (L * L)
        if (t0 < 0.15 || t0 > 0.85) continue
        if (Math.hypot(o.x - (puck.x + dx * t0), o.y - (puck.y + dy * t0)) < 3) {
          lift = 6.5
          puck.z = 0.3
          puck.vz = lift
          break
        }
      }
    }
    const f: Flight = { kind, side: s, from: c, to, releaseAdv: puck.x * s.a, untouched: true, tried: tries(c) }
    if (kind === 'pass' && to) {
      const pe: PassEvent = {
        t: T(),
        period,
        type: 'pass',
        from: c.player.id,
        to: to.player.id,
        a: { x: puck.x / HALF_X, y: puck.y / HALF_Y },
        b: { x: clamp(at.x / HALF_X, -1, 1), y: clamp(at.y / HALF_Y, -1, 1) },
        completed: false,
        speedMph: Math.round(sp * 0.6818),
        kind: passKind(c, to, at, s, oneTimer, lift > 0)
      }
      ev(pe)
      f.passEv = pe
      if (tm) {
        tm.passes++
        if (puck.x * s.a > 0) {
          tm.ozPasses++
          const back = (at.x - puck.x) * s.a < -6 && -(at.x - puck.x) * s.a > Math.abs(at.y - puck.y) * 0.36
          if (back) tm.ozBackPasses++
        }
      }
    } else if (tm) tm.dumps++
    void L
    flight = f
  }

  /** What kind of pass this is, for the stream (renderers animate by kind). */
  const passKind = (c: Body, to: Body, at: XY, s: Side, oneTimer: boolean, lifted: boolean): PassKind => {
    if (oneTimer) return 'oneTimerFeed'
    const dx = (at.x - puck.x) * s.a
    const dy = at.y - puck.y
    const L = Math.hypot(dx, dy)
    if (c.player.position === 'D' && to.player.position === 'D' && Math.abs(dx) < 15 && Math.abs(dy) > 15) return 'dToD'
    if (lifted) return 'saucer'
    if (L > 70 && dx > 30) return 'stretch'
    if (dx < -3 && L < 20) return 'drop'
    return 'tape'
  }

  /** Where the goalie SHOULD be for a puck at (x,y) — the angle/depth ideal. */
  const goalieIdeal = (s: Side, x: number, y: number): XY => {
    const own = -s.a
    const gx = own * GOAL_X
    if (x * own > GOAL_X - 0.5) return { x: gx - own * 0.9, y: y >= 0 ? NET_HALF_W - 0.4 : -(NET_HALF_W - 0.4) }
    const dx = x - gx
    const dy = y
    const d = Math.max(Math.hypot(dx, dy), 0.1)
    // Top of the crease for shots from distance, deeper in tight.
    const depth = d < 12 ? 1.6 : clamp(2.2 + (d - 12) * 0.08, 2.2, 4.6)
    return { x: gx + (dx / d) * depth, y: (dy / d) * depth }
  }

  const shoot = (c: Body, s: Side, oneTimer: boolean, beatGoalie = false): void => {
    const opp = oppOf(s)
    const a = s.a
    const from = { x: puck.x, y: puck.y }
    const netX = a * GOAL_X
    const dist = Math.hypot(netX - from.x, from.y)
    const xg = xgAt(from.x, from.y, a)
    const tech = c.player.ratings.technical
    const pressure = pressureOn(c, opp.skaters)
    const slap = !oneTimer && dist > 45 && pressure < 0.3 && rng.chance(0.45 * r01(tech.slapShot) + 0.1)
    const acc = slap ? r01(tech.slapShot) : r01(tech.wristShot)
    const speed = (slap ? 118 : 96) + acc * 30 + (oneTimer ? 8 : 0)
    const shotType = (): ShotType => {
      if (oneTimer) return 'oneTimer'
      if (slap) return 'slap'
      const fx = (netX - c.x) / Math.max(dist, 1)
      const fy = -c.y / Math.max(dist, 1)
      if (c.hx * fx + c.hy * fy < 0.2) return 'backhand'
      return dist < 25 ? 'snap' : 'wrist'
    }
    const shotOrigin = (): ShotOrigin => {
      if (now - lastSaveAt < 2.5) return 'rebound'
      if (oneTimer) return 'oneTimer'
      if (now - s.entryAt < 6) return 'rush'
      if (c.player.position === 'D' && dist > 45) return 'point'
      if (now - gotAt < 0.6 && gotHow !== 'pass') return 'scramble'
      return 'cycle'
    }
    const oddManNow = (): { attackers: number; defenders: number } => {
      const adv0 = c.x * a
      let atk = 0
      let def = 0
      for (const b of s.skaters) if (b.x * a >= adv0 - 10) atk++
      for (const o of opp.skaters) if (o.x * a > adv0) def++
      return { attackers: atk, defenders: def }
    }
    // In tight with a man on him: the defender lifts his stick / ties him up
    // before he can release (no attempt — the puck is loose).
    if (dist < 16 && !oneTimer && !beatGoalie) {
      for (const o of opp.skaters) {
        if (Math.hypot(o.x - c.x, o.y - c.y) > 3.4) continue
        const sc = rDef(o.player.ratings.defensive.stickChecking)
        const pc = r01(c.player.composites.puckControl)
        if (rng.chance(clamp(0.3 + (sc - pc) * 0.4, 0.1, 0.6))) {
          if (tm) tm.stickLifts++
          loosen(c.vx * 0.5 + rng.float(-6, 6), c.vy * 0.5 + rng.float(-6, 6), null)
          flight!.tried.set(c, now)
          return
        }
        break
      }
    }
    if (tm) {
      tm.shotAttempts++
      let nearest = 99
      let house = 0
      for (const o of opp.skaters) {
        nearest = Math.min(nearest, Math.hypot(o.x - from.x, o.y - from.y))
        if (Math.hypot(o.x - netX, o.y) < 25) house++
      }
      tm.shotLog.push({ dist, nearest, house, poss: now - w.possSince, sinceEntry: now - s.entryAt, held: now - gotAt, carried: Math.hypot(from.x - gotPos.x, from.y - gotPos.y), src: now - lastSaveAt < 2.5 ? 'rebound' : gotHow })
    }

    // 1. Bodies in the lane.
    let blocker: Body | undefined
    const L = Math.max(dist, 1)
    const ux = (netX - from.x) / L
    const uy = -from.y / L
    for (const o of opp.skaters) {
      const s1 = (o.x - from.x) * ux + (o.y - from.y) * uy
      if (s1 < 3 || s1 > L - 5) continue
      const d = Math.abs(-(o.x - from.x) * uy + (o.y - from.y) * ux)
      const pB = blockChance(o, d, slap)
      if (pB > 0 && rng.chance(pB)) {
        blocker = o
        break
      }
    }
    // Traffic in front: screens (either team) near the goalie's sightline.
    let screen = 0
    for (const sk of [...s.skaters, ...opp.skaters]) {
      if (sk === c) continue
      const s1 = (sk.x - from.x) * ux + (sk.y - from.y) * uy
      if (s1 < L - 22 || s1 > L - 3) continue
      const d = Math.abs(-(sk.x - from.x) * uy + (sk.y - from.y) * ux)
      if (d < 2.5) screen++
    }
    // Tip: a stick in front of the net on the line.
    let tipper: Body | null = null
    for (const sk of s.skaters) {
      if (sk === c) continue
      const dn = Math.hypot(sk.x - netX * 0.93, sk.y)
      if (dn > 12) continue
      const s1 = (sk.x - from.x) * ux + (sk.y - from.y) * uy
      const d = Math.abs(-(sk.x - from.x) * uy + (sk.y - from.y) * ux)
      if (s1 > L - 16 && d < 3 && rng.chance(0.25 * r01(sk.player.ratings.technical.deflections) + 0.05)) tipper = sk
    }

    let outcome: ShotPlan['outcome']
    let at: XY
    let travel: number
    const g = opp.goalie
    if (blocker) {
      outcome = 'block'
      at = { x: blocker.x, y: blocker.y }
      travel = Math.hypot(at.x - from.x, at.y - from.y)
    } else {
      const pMiss = clamp(
        AGENT_TUNING.missBase * (1.35 - acc * 0.7) * (0.75 + dist / 110) * (1 + pressure * 0.35) * (tipper ? 1.25 : 1),
        0.08,
        0.65
      )
      // At an empty net the only question is accuracy over the distance.
      const miss = opp.pulled ? rng.chance(1 - clamp(1.05 - dist / 180, 0.3, 0.95)) : rng.chance(pMiss)
      if (tm) tm.unblocked++
      if (miss) {
        outcome = 'miss'
        const wide = (rng.chance(0.5) ? 1 : -1) * rng.float(NET_HALF_W + 1, NET_HALF_W + 9)
        at = { x: netX, y: wide }
        travel = Math.hypot(at.x - from.x, at.y - from.y)
        if (tm) tm.missed++
        const r = rng.next()
        ev({
          t: T(),
          period,
          type: 'missedShot',
          shooter: c.player.id,
          from: { x: from.x / HALF_X, y: from.y / HALF_Y },
          target: { x: a, y: clamp(wide / HALF_Y, -1, 1) },
          result: r < 0.08 ? 'post' : r < 0.38 ? 'high' : 'wide',
          shotType: shotType(),
          speedMph: Math.round(speed * 0.6818)
        })
      } else {
        // On target: the goalie's read decides it.
        const ideal = goalieIdeal(opp, from.x, from.y)
        const err = Math.hypot(g.x - ideal.x, g.y - ideal.y)
        const gMoving = speedOf(g)
        const gRatings = g.player.ratings.goalie
        const goalieSkill = g.player.composites.goaltending
        // Shooter vs goalie on one scale (relative, so a league whose ratings
        // all sit lower or higher still scores NHL goals).
        const lvl = LEVEL.offset + 66.5
        const finish = clamp(1 + (c.player.composites.scoring - lvl) / 50 - (goalieSkill - (lvl + 6.5)) / 110, 0.4, 1.8)
        const cf = s.sim.team.coachFit === undefined ? 1 : coachFitMultiplier(s.sim.team.coachFit)
        let eff = xg
        eff *= 1 + clamp(err, 0, 5) * 0.12 // caught out of position
        if (oneTimer && gMoving > 5) eff *= 1.35 // across the royal road, goalie moving
        eff *= 1 + Math.min(screen, 2) * 0.15 // can't see it
        if (tipper) eff *= 1.4
        if (beatGoalie) eff *= DEKE.beatG // he bit on the deke: the net is open
        if (now - lastSaveAt < 1.6) eff *= 1.3 // rebound, goalie scrambling
        if (slap) eff *= 1.05
        void gRatings
        const strength = s.powerPlay ? PP_SHOT_BOOST : 1
        const pGoal = opp.pulled
          ? 1
          : clamp(
              eff * AGENT_TUNING.finishK * finish * cf * opp.sim.goalieNight * (ctx.scoringMult ?? 1) * strength,
              0.004,
              0.9
            )
        const goal = rng.chance(pGoal)
        outcome = goal ? 'goal' : 'save'
        at = goal
          ? { x: a * (GOAL_X + 1.5), y: clamp(rng.normal(0, 1.4), -NET_HALF_W + 0.4, NET_HALF_W - 0.4) }
          : { x: g.x, y: g.y }
        travel = Math.hypot(at.x - from.x, at.y - from.y)
        // Shot on goal: the stream's 'shot' event (danger drives renderer drama).
        ev({
          t: T(),
          period,
          type: 'shot',
          shooter: c.player.id,
          from: { x: from.x / HALF_X, y: from.y / HALF_Y },
          target: { x: a, y: 0 },
          danger: clamp(eff / 0.25, 0, 1),
          shotType: shotType(),
          speedMph: Math.round(speed * 0.6818),
          origin: shotOrigin(),
          oddMan: oddManNow()
        })
        const st = stat(ctx, c.player.id)
        st.shots++
        if (!opp.pulled) {
          const gs = stat(ctx, g.player.id)
          gs.shotsAgainst++
          gs.xgAgainst = (gs.xgAgainst ?? 0) + xg
        }
        if (tm) {
          tm.shotsOnGoal++
          tm.shotDanger += clamp(eff / 0.25, 0, 1)
          if (oneTimer) tm.oneTimers++
          if (now - s.entryAt < 6) tm.rushShots++
        }
      }
      const st = stat(ctx, c.player.id)
      st.xg = (st.xg ?? 0) + xg
      // Expected assist: the last teammate to touch it set this chance up.
      const setup = [...touches].reverse().find((tc) => tc.side === s && tc.b !== c)
      if (setup) {
        const fs = stat(ctx, setup.b.player.id)
        fs.xA = (fs.xA ?? 0) + xg
      }
    }
    const ang = Math.atan2(at.y - from.y, at.x - from.x)
    puck.vx = Math.cos(ang) * speed
    puck.vy = Math.sin(ang) * speed
    puck.z = 0
    puck.vz = 0
    w.carrier = null
    puck.carrier = null
    w.control = null
    w.lastTouch = s
    w.flightSide = s
    w.passTo = null
    w.oneTimerFor = null
    flight = {
      kind: 'shot',
      side: s,
      from: c,
      releaseAdv: puck.x * a,
      untouched: true,
      tried: tries(c),
      shot: { outcome, shooter: c, side: s, blocker, at, travel, travelled: 0, from, xg, rebound: now - lastSaveAt < 1.6 }
    }
  }

  const resolveShot = (f: Flight): void => {
    const sp = f.shot!
    const s = sp.side
    const opp = oppOf(s)
    const a = s.a
    if (sp.outcome === 'block' && sp.blocker) {
      ev({ t: T(), period, type: 'blockedShot', shooter: sp.shooter.player.id, blocker: sp.blocker.player.id, pos: { x: puck.x / HALF_X, y: puck.y / HALF_Y } })
      if (tm) tm.blocked++
      loosen(-a * rng.float(8, 26), rng.float(-14, 14), s)
      return
    }
    if (sp.outcome === 'miss') {
      // Wide: the puck carries on, live, around the boards.
      flight = { kind: 'loose', side: s, from: sp.shooter, releaseAdv: sp.from.x * a, untouched: true, tried: tries() }
      return
    }
    const g = opp.goalie
    if (sp.outcome === 'goal') {
      s.sim.goals++
      const gs = opp.pulled ? null : stat(ctx, g.player.id)
      if (gs) gs.goalsAgainst++
      stat(ctx, sp.shooter.player.id).goals++
      // Assists: the last two teammates to touch it before the scorer.
      const assists: PlayerId[] = []
      for (let i = touches.length - 1; i >= 0 && assists.length < 2; i--) {
        const tc = touches[i]
        if (tc.side !== s) break
        if (tc.b === sp.shooter) continue
        if (!assists.includes(tc.b.player.id)) assists.push(tc.b.player.id)
      }
      const onIceIds = new Set(s.skaters.map((b) => b.player.id))
      const credited = assists.filter((id) => onIceIds.has(id) || true)
      if (credited.length === 0 && touches.length === 0) {
        // Off a faceoff scramble: fall back to the shared assist model.
        credited.push(...pickAssists(rng, s.sim.unit.skaters, sp.shooter.player.id))
      }
      for (const id of credited) stat(ctx, id).assists++
      const strength = opp.pulled ? 'en' : s.powerPlay ? 'pp' : s.shorthanded ? 'sh' : 'ev'
      if (strength !== 'pp') {
        for (const b of s.skaters) stat(ctx, b.player.id).plusMinus += 1
        for (const b of opp.skaters) stat(ctx, b.player.id).plusMinus -= 1
      }
      puck.x = a * (GOAL_X + 1.8)
      puck.y = clamp(puck.y, -2.5, 2.5)
      ev({ t: T(), period, type: 'goal', scorer: sp.shooter.player.id, assists: credited, strength, pos: { x: sp.from.x / HALF_X, y: sp.from.y / HALF_Y } })
      ev({ t: T(), period, type: 'whistle', reason: 'goal', pos: { x: puck.x / HALF_X, y: puck.y / HALF_Y } })
      if (tm) {
        tm.goals++
        tm.stoppages.goal++
      }
      if (strength === 'pp') opp.sim.clearEarliestPenalty()
      delayed = null
      if (suddenDeath) {
        ended = true
        return
      }
      deadAt = { x: puck.x, y: puck.y }
      w.carrier = null
      puck.carrier = null
      w.control = null
      flight = null
      puck.vx = puck.vy = 0
      celebration = { scorer: sp.shooter, side: s, until: now + GOAL_CELEBRATION_S }
      return
    }
    // Save.
    stat(ctx, g.player.id).saves++
    lastSaveAt = now
    const rc = r01(g.player.ratings.goalie?.reboundControl ?? g.player.composites.goaltending)
    let traffic = 0
    for (const b of s.skaters) if (Math.hypot(b.x - a * GOAL_X, b.y) < 13) traffic++
    const pFreeze = clamp(0.17 + rc * 0.16 - traffic * 0.03 + (sp.rebound ? 0.08 : 0), 0.06, 0.5)
    const freeze = rng.chance(pFreeze)
    ev({ t: T(), period, type: 'save', goalie: g.player.id, rebound: !freeze, pos: { x: g.x / HALF_X, y: g.y / HALF_Y } })
    if (tm) tm.saves++
    if (freeze) {
      puck.x = g.x
      puck.y = g.y
      stopPlay(dzDot(opp, sp.from.y), zoneOf(dzDot(opp, sp.from.y), s), opp, 'goalieFreeze')
      return
    }
    // Rebound: into the slot (a poor rebound) or steered to a corner.
    const poor = rng.chance(0.47 - rc * 0.28)
    const out = -a
    puck.x = g.x + out * 1.5
    puck.y = g.y
    if (poor) {
      loosen(out * rng.float(16, 34), rng.float(-14, 14), null)
    } else {
      const side = rng.chance(0.5) ? 1 : -1
      loosen(out * rng.float(2, 8), side * rng.float(18, 32), null)
    }
    if (flight) flight.tried = tries(g)
  }

  // -------------------------------------------------------------------------
  // Penalties
  // -------------------------------------------------------------------------
  const callPenalty = (offender: Body, s: Side, infraction: string, drawnBy: Body | null = null): void => {
    if (delayed) return
    // Delayed call: the offended side keeps the puck until the offenders touch it.
    if (w.control && w.control !== s) {
      delayed = { offender, side: s, infraction, drawnBy }
      if (tm) tm.delayedCalls++
      return
    }
    delayed = { offender, side: s, infraction, drawnBy }
    stopPlay(dzDot(s, puck.y), 'defensive', s, 'penalty')
  }
  const assessDelayed = (): void => {
    const d = delayed!
    delayed = null
    const absNow = absBase + now
    d.side.sim.penalties.push({ expiresAt: absNow + PENALTY_SECONDS, playerId: d.offender.player.id })
    stat(ctx, d.offender.player.id).penaltyMinutes += 2
    ev({ t: T(), period, type: 'penalty', player: d.offender.player.id, infraction: d.infraction, minutes: 2, ...(d.drawnBy ? { drawnBy: d.drawnBy.player.id } : {}) })
    if (tm) {
      tm.penalties++
      tm.infractions[d.infraction] = (tm.infractions[d.infraction] ?? 0) + 1
    }
    if (pending) {
      pending.dot = dzDot(d.side, pending.dot.y)
      pending.zone = 'defensive'
      pending.zoneFor = d.side
    }
  }

  // -------------------------------------------------------------------------
  // The frame loop
  // -------------------------------------------------------------------------
  // Opening deployment + faceoff.
  for (const s of sides) {
    const d = desiredFor(s.sim, oppOf(s).sim)
    s.sim.deploy(rng, d.kind, d.count, undefined, oppOf(s).sim, 0)
    bindSide(s)
  }
  for (const s of sides) {
    s.shorthanded = s.sim.shorthanded()
    s.powerPlay = !s.shorthanded && oppOf(s).sim.shorthanded()
    const spots = faceoffSpots(s, { x: 0, y: 0 })
    s.skaters.forEach((b) => {
      const sp = spots.get(b) ?? { x: -s.a * 20, y: 0 }
      b.x = sp.x
      b.y = sp.y
      b.hx = s.a
      b.hy = 0
    })
    s.goalie.x = -s.a * (GOAL_X - 1.5)
    s.goalie.y = 0
  }
  deadAt = { x: 0, y: 0 }
  pending = { dot: { x: 0, y: 0 }, zone: 'neutral', since: -FACEOFF_MIN_WAIT, zoneFor: null }

  let lastFrameT = -1

  // -------------------------------------------------------------------------
  // Dekes and shot release
  // -------------------------------------------------------------------------
  interface Deke {
    c: Body
    on: Body
    goalie: boolean
    move: DekeKind
    success: boolean
    until: number
    dir: number
  }
  const DEKE_PATH: Record<DekeKind, { fwd: number; lat: number }> = {
    wide: { fwd: 12, lat: 10 },
    toeDrag: { fwd: 4, lat: 7 },
    shoulderFake: { fwd: 8, lat: 5 },
    forehandBackhand: { fwd: 6, lat: 8 }
  }
  function startDeke(c: Body, s: Side, act: Extract<CarrierAction, { kind: 'deke' }>): void {
    const success = rng.chance(act.p)
    // Good hands make the move quicker.
    const dur = clamp(DEKE.minS + (DEKE.maxS - DEKE.minS) * (1 - dekeSkill(c)) * rng.float(0.8, 1.4), DEKE.minS, DEKE.maxS)
    ev({ t: T(), period, type: 'deke', by: c.player.id, on: act.on.player.id, kind: act.move, success, pos: { x: puck.x / HALF_X, y: puck.y / HALF_Y } })
    if (tm) {
      tm.dekes++
      if (success) tm.dekesWon++
      if (act.goalie) tm.dekesOnGoalie++
      if (act.goalie && success) tm.dekesOnGoalieWon++
    }
    deke = { c, on: act.on, goalie: act.goalie, move: act.move, success, until: now + dur, dir: act.dir }
    if (success && !act.goalie) {
      // He bit: off balance for the move (no stick on it), carried the wrong way.
      act.on.stun = Math.max(act.on.stun, dur * 0.8 + 0.2)
      act.on.vy -= act.dir * 6
    } else if (success) {
      // The goalie goes with the fake, out across his crease.
      bite = { side: oppOf(s), dy: -act.dir * 3.5, until: now + dur + 0.5 }
    }
    stepDeke(deke, s)
  }
  function stepDeke(d: Deke, s: Side): void {
    const c = d.c
    if (now >= d.until - 1e-6) {
      deke = null
      if (d.goalie) {
        if (d.success) shoot(c, s, false, true)
        else {
          // The goalie reads it: poke check / smother, the puck squirts free.
          const out = -s.a
          loosen(out * rng.float(4, 12) + c.vx * 0.2, (rng.chance(0.5) ? 1 : -1) * rng.float(6, 16), null)
          flight!.tried.set(c, now)
        }
      } else if (!d.success) {
        // The defender reads it and takes it off him.
        ev({ t: T(), period, type: 'pokeCheck', by: d.on.player.id, on: c.player.id, success: true, pos: { x: puck.x / HALF_X, y: puck.y / HALF_Y } })
        poke = { by: d.on, from: c, side: oppOf(s), t: now }
        const ang = Math.atan2(c.y - d.on.y, c.x - d.on.x) + rng.float(-0.8, 0.8)
        loosen(Math.cos(ang) * rng.float(6, 12), Math.sin(ang) * rng.float(6, 12), null)
        flight!.tried.set(c, now)
      }
      return
    }
    const pth = DEKE_PATH[d.move]
    cmds.set(c, {
      tx: c.x + s.a * pth.fwd,
      ty: clamp(c.y + d.dir * pth.lat, -HALF_Y + 3, HALF_Y - 3),
      speed: Math.max(speedOf(c), 12),
      arrive: false,
      urgency: 0.9
    })
  }
  while (now < lengthSeconds - 1e-9 && !ended) {
    const absNow = absBase + now
    home.prunePenalties(absNow)
    away.prunePenalties(absNow)
    updatePull(H)
    updatePull(A)
    if (!flight || flight.kind !== 'shot') syncStrength()
    w.t = now

    // Line changes on the fly: a tired/long shift goes when it's safe — the
    // puck is up the ice or the team has it.
    if (!pending && !celebration) {
      for (const s of sides) {
        const shift = now - (lastShift.get(s) ?? 0)
        const avgE = s.skaters.reduce((q, b) => q + b.energy, 0) / Math.max(1, s.skaters.length)
        const safe = (w.control === s && puck.x * s.a > -10) || puck.x * s.a > BLUE_X
        const due = shift > SHIFT_TARGET + 8 || (safe && (shift > SHIFT_TARGET || (shift > 30 && avgE < 0.55)))
        // Never start a change with the puck in your own zone.
        const ownZone = puck.x * s.a < -BLUE_X
        if (due && !ownZone && !changing.has(s) && flight?.kind !== 'shot') beginChange(s)
      }
    }

    // Tonight's scheduled fight / injury (hash-derived plans, shared with the director engine).
    if (!pending && !celebration) {
      const fp = ctx.fights
      if (fp && fp.next < fp.times.length && fp.times[fp.next] <= absNow && !H.shorthanded && !A.shorthanded) {
        fp.next++
        const pick = (s: Side): Player | null => {
          const ps = s.skaters.map((b) => b.player)
          if (ps.length === 0) return null
          return ps[weightedIndex(fp.rng, ps.map((p) => 1 + p.composites.penaltyProne + (p.fighting ?? 0) * 0.5))]
        }
        const hF = pick(H)
        const aF = pick(A)
        if (hF && aF) {
          for (const [s, p] of [[H, hF], [A, aF]] as const) {
            s.sim.sidelined.push({ expiresAt: absNow + FIGHT_MAJOR_SECONDS, playerId: p.id })
            stat(ctx, p.id).penaltyMinutes += 5
            ev({ t: T(), period, type: 'penalty', player: p.id, infraction: 'fighting', minutes: 5 })
          }
          if (tm) tm.fights++
          stopPlay(nearestDot({ x: puck.x, y: puck.y }), 'neutral', null, 'penalty')
          for (const s of sides) {
            creditShift(s, now)
            deploySide(s, true)
          }
        }
      }
      const ij = ctx.injury
      if (ij && !ij.done && ij.plan.atSecond <= absNow) {
        ij.done = true
        const s = ij.plan.homeSide ? H : A
        const sitting = new Set([...s.sim.penalties, ...s.sim.sidelined].map((b) => b.playerId as string))
        const ids = [...s.sim.team.lines.forwards.flat(), ...s.sim.team.lines.defensePairs.flat()].filter((id) => !sitting.has(id as string))
        if (ids.length > 0) {
          const ps = ids.map((id) => s.sim.resolve(id))
          const victim = ps[weightedIndex(ij.rng, ps.map((p) => fragilityWeight(p.ratings.physical.balance)))]
          s.sim.sidelined.push({ expiresAt: Number.MAX_SAFE_INTEGER, playerId: victim.id })
          stat(ctx, victim.id).leftGame = true
        }
      }
    }

    // ---- Emit the frame for the state at `now`. ----
    if (now > lastFrameT + 1e-6) {
      for (const s of sides) {
        s.sim.unit.skaters.forEach((r, i) => {
          const b = s.skaters[i]
          if (!b) return
          r.pos.x = clamp(b.x / HALF_X, -1, 1)
          r.pos.y = clamp(b.y / HALF_Y, -1, 1)
          r.vel.x = b.vx
          r.vel.y = b.vy
        })
        const g = s.sim.unit.goalie
        g.pos.x = clamp(s.goalie.x / HALF_X, -1, 1)
        g.pos.y = clamp(s.goalie.y / HALF_Y, -1, 1)
      }
      const pk = deadAt ?? puck
      ctx.stream.push({
        t: Math.round(now * 100) / 100,
        period,
        type: 'frame',
        home: H.skaters.map((b) => ({ player: b.player.id, pos: { x: clamp(b.x / HALF_X, -1, 1), y: clamp(b.y / HALF_Y, -1, 1) }, facing: Math.round(Math.atan2(b.hy, b.hx) * 100) / 100 })),
        away: A.skaters.map((b) => ({ player: b.player.id, pos: { x: clamp(b.x / HALF_X, -1, 1), y: clamp(b.y / HALF_Y, -1, 1) }, facing: Math.round(Math.atan2(b.hy, b.hx) * 100) / 100 })),
        homeGoalie: { player: H.goalie.player.id, pos: { x: H.goalie.x / HALF_X, y: H.goalie.y / HALF_Y } },
        awayGoalie: { player: A.goalie.player.id, pos: { x: A.goalie.x / HALF_X, y: A.goalie.y / HALF_Y } },
        puck: { x: clamp(pk.x / HALF_X, -1, 1), y: clamp(pk.y / HALF_Y, -1, 1) },
        puckCarrier: deadAt === null && !pending && w.carrier ? w.carrier.player.id : null,
        ...(deadAt === null && puck.z > 0.05 ? { puckZ: Math.round(puck.z * 10) / 10 } : {})
      })
      lastFrameT = now
      if (tm) tm.frames++
    }

    // ---- Think. ----
    cmds.clear()
    const out: ThinkOut = { cmds, pokes: [] }
    if (celebration) {
      const cel = celebration
      for (const s of sides) {
        s.skaters.forEach((b, i) => {
          if (s === cel.side) {
            const ang = (i / Math.max(1, s.skaters.length - 1)) * Math.PI - Math.PI / 2
            cmds.set(b, { tx: cel.scorer.x + Math.cos(ang) * 4, ty: cel.scorer.y + Math.sin(ang) * 3, speed: 18, arrive: true, urgency: 0.6 })
          } else {
            cmds.set(b, { tx: s.a * 22, ty: (i % 2 === 0 ? -1 : 1) * (10 + (i >> 1) * 8), speed: 10, arrive: true, urgency: 0.3 })
          }
        })
      }
      if (now >= cel.until) {
        celebration = null
        pending = { dot: { x: 0, y: 0 }, zone: 'neutral', since: now + 2.5, zoneFor: null }
        for (const s of sides) {
          creditShift(s, now)
          deploySide(s, true)
        }
      }
    } else if (pending) {
      faceoffTargets()
    } else {
      for (const s of sides) thinkSide(w, s, out)
      if (w.carrier && w.control) {
        const c = w.carrier
        const s = w.control
        if (deke && deke.c !== c) deke = null
        if (windup && windup.c !== c) windup = null
        if (deke) {
          stepDeke(deke, s)
        } else if (windup) {
          // The release: the puck leaves the blade at the shot event (the
          // renderer swings in the lead-up, with the puck still on his stick).
          if (now >= windup.at - 1e-6) {
            windup = null
            shoot(c, s, false)
          } else cmds.set(c, { tx: c.x + c.vx * 0.6, ty: c.y + c.vy * 0.6, speed: speedOf(c) * 0.9, arrive: false, urgency: 0.5 })
        } else {
        const act = decideCarrier(w, s, c)
        if (tm) tm.carrierThinks++
        if (act.kind === 'deke') {
          startDeke(c, s, act)
        } else if (act.kind === 'carry') {
          cmds.set(c, act.cmd)
          if (act.protect && tm) tm.protects++
        } else if (act.kind === 'pass') {
          release(c, s, act.at, act.speed, 0, 'pass', act.to, act.oneTimer)
        } else if (act.kind === 'dump') {
          release(c, s, act.at, act.speed, act.lift, 'dump')
        } else {
          // The puck must have been on his blade for the swing (the renderer
          // starts the shot clip that long before the release): a man who has
          // carried it a while releases now; one who just got it winds up first.
          const far = Math.hypot(s.a * GOAL_X - c.x, c.y) > 45
          const need = far ? VAL_WINDUP.far : VAL_WINDUP.near
          if (now - gotAt >= need - 1e-6) shoot(c, s, false)
          else {
            windup = { c, at: gotAt + need }
            cmds.set(c, { tx: c.x + c.vx * 0.6, ty: c.y + c.vy * 0.6, speed: speedOf(c) * 0.9, arrive: false, urgency: 0.5 })
          }
        }
        }
        if (w.carrier === c && !cmds.has(c)) cmds.set(c, { tx: c.x + c.vx, ty: c.y + c.vy, speed: speedOf(c), arrive: false, urgency: 0.4 })
      }
      // The physical game: who is lining somebody up.
      for (const s of sides) {
        for (const b of s.skaters) {
          const tgt = w.carrier === b ? null : decideHit(w, s, b, hitIntent, ctx.intensity ?? 0)
          if (tgt) {
            cmds.set(b, { tx: tgt.x + tgt.vx * 0.2, ty: tgt.y + tgt.vy * 0.2, speed: b.caps.top, arrive: false, urgency: 1, boardsOk: true })
          }
        }
      }
      // Stick checks: a defender with the puck in reach makes a real attempt
      // (poke, lift, sweep), then needs a moment to reload. A carrier who is
      // standing still in front of him is easy pickings — nobody stands off
      // a slow carrier in stick reach for long.
      for (const pk of out.pokes) {
        const c = w.carrier
        if (!c || !w.control) break
        if (pk.stun > 0) continue // beaten on the deke: no stick on it
        const dp = Math.hypot(pk.x - puck.x, pk.y - puck.y)
        if (dp > REACH) continue
        if (now < (pokeReady.get(pk) ?? 0)) continue
        // He picks his moment: a carrier standing still gets the stick at once;
        // one skating with it only now and then (a stab at a moving puck is how
        // you get beaten).
        const stillC = speedOf(c) < AGENT_TUNING.pokeStillV
        if (!rng.chance(stillC ? AGENT_TUNING.pokeTryStill : AGENT_TUNING.pokeTry)) continue
        pokeReady.set(pk, now + POKE_RELOAD_S * rng.float(0.8, 1.3))
        const sc = (rDef(pk.player.ratings.defensive.stickChecking) + r01(pk.player.composites.takeaway)) / 2
        const pc = r01(c.player.composites.puckControl)
        const protect = (c.hx * (pk.x - c.x) + c.hy * (pk.y - c.y)) < 0 ? 0.6 : 1 // body between
        const still = stillC ? AGENT_TUNING.pokeStill : 1
        const pSucc = clamp((0.004 + sc * sc * sc * 0.45 + (sc - pc) * 0.1) * protect * still * AGENT_TUNING.pokeK * AGENT_TUNING.pokeAttemptK, 0.001, 0.6)
        if (tm) tm.pokeAttempts++
        const won = rng.chance(pSucc)
        ev({ t: T(), period, type: 'pokeCheck', by: pk.player.id, on: c.player.id, success: won, pos: { x: puck.x / HALF_X, y: puck.y / HALF_Y } })
        if (won) {
          const s = w.control
          const ang = Math.atan2(puck.y - pk.y, puck.x - pk.x) + rng.float(-0.8, 0.8)
          const sp = rng.float(6, 14)
          poke = { by: pk, from: c, side: oppOf(s), t: now }
          loosen(Math.cos(ang) * sp, Math.sin(ang) * sp, null)
          flight!.tried.set(c, now)
          if (tm) tm.pokeSuccess++
          break
        }
      }
      // Stick fouls: beaten defenders reach — hook, trip, hold.
      if (w.carrier && w.control && !delayed) {
        const c = w.carrier
        const opp = oppOf(w.control)
        for (const d of opp.skaters) {
          const dd = Math.hypot(d.x - c.x, d.y - c.y)
          if (dd > 6) continue
          const beaten = (c.x - d.x) * w.control.a > 1 && speedOf(c) > speedOf(d) + 2
          if (!beaten) continue
          const prone = d.player.composites.penaltyProne / 50
          const disc = 1.4 - r01(d.player.ratings.mental.discipline) * 0.8
          const aggr = sliderMult(opp.tactics.aggressiveness, 0.6, 1.5) * (1 + (ctx.intensity ?? 0) * 0.3)
          if (rng.chance(0.03 * AGENT_TUNING.stickFoulK * prone * disc * aggr)) {
            const inf = rng.pick(['hooking', 'tripping', 'holding', 'slashing', 'hooking', 'tripping', 'high-sticking', 'holding the stick', 'interference', 'hooking', 'tripping', 'cross-checking'])
            callPenalty(d, opp, inf, c)
            break
          }
        }
      }
      // Fumbles under pressure (unforced).
      if (w.carrier && w.control && !pending) {
        const c = w.carrier
        const pr = pressureOn(c, oppOf(w.control).skaters)
        const pc = r01(c.player.composites.puckControl)
        if (pr > 0.35 && rng.chance(0.006 * AGENT_TUNING.fumbleK * pr * 6.8 * Math.pow(Math.max(0, 1.15 - pc), 4))) {
          fumble = { by: c, side: w.control, t: now }
          const ang = rng.float(0, Math.PI * 2)
          loosen(c.vx + Math.cos(ang) * 6, c.vy + Math.sin(ang) * 6, w.control)
          flight!.tried.set(c, now)
          if (tm) tm.fumbles++
        }
      }
      // Miscellaneous stoppages (net off its moorings, high stick, hand pass…).
      if (!pending && rng.chance(AGENT_TUNING.miscStopPerSec * FRAME_DT)) {
        stopPlay(nearestDot({ x: puck.x, y: puck.y }), 'neutral', null, 'other')
        const p = pending as unknown as { zone: 'offensive' | 'defensive' | 'neutral'; dot: XY } | null
        if (p) p.zone = Math.abs(p.dot.x) <= 25 ? 'neutral' : 'defensive'
      }
    }

    if (!pending && !celebration) stepChanges()

    // ---- Command shaping (once per frame). ----
    // Personal space: steer around teammates instead of bumping into them
    // (hard separation in physics made clustered men jitter). Tied up: a
    // defender goal-side and on the carrier slows him down.
    shaping.clear()
    for (const s of sides) {
      for (const b of s.skaters) {
        let ox = 0
        let oy = 0
        for (const o of s.skaters) {
          if (o === b) continue
          const dx = b.x - o.x
          const dy = b.y - o.y
          const d = Math.hypot(dx, dy)
          if (d < 7 && d > 0.01) {
            ox += (dx / d) * (7 - d) * 1.2
            oy += (dy / d) * (7 - d) * 1.2
          }
        }
        let sf = 1
        if (b === w.carrier && w.control) {
          const cs = w.control
          for (const o of oppOf(cs).skaters) {
            if ((o.x - b.x) * cs.a > 0 && Math.hypot(o.x - b.x, o.y - b.y) < 4.2) {
              const str = r01(b.player.ratings.physical.strength) - r01(o.player.ratings.physical.strength)
              sf = clamp(0.45 + str * 0.4, 0.25, 0.75)
              break
            }
          }
        }
        // No camping in the crease: a target inside it is moved to its edge.
        const raw = cmds.get(b)
        if (raw && b !== w.carrier) {
          for (const sg of [1, -1]) {
            const cx = sg * GOAL_X
            const ddx = raw.tx - cx
            if (ddx * sg > 0.5) continue // behind the goal line
            const dd = Math.hypot(ddx, raw.ty)
            if (dd < 7.2) {
              const f = (7.4 - dd) / Math.max(dd, 0.5)
              ox += (ddx === 0 && raw.ty === 0 ? -sg : ddx) * f
              oy += raw.ty * f
            }
          }
        }
        shaping.set(b, { ox, oy, sf })
      }
    }

    // ---- Physics substeps. ----
    for (let k = 0; k < SUBSTEPS && !ended; k++) {
      const all: Body[] = []
      for (const s of sides) {
        for (const b of s.skaters) {
          const raw = cmds.get(b) ?? { tx: b.x, ty: b.y, speed: 0, arrive: true, urgency: 0.3 }
          // A player drifting into shape reads the play continuously: his
          // target glides (≈0.45 s lag) instead of jumping every think — no
          // twitch. Racing/pressing/carrying men react at once.
          let tx = raw.tx
          let ty = raw.ty
          const sm = smooth.get(b)
          if (raw.urgency < 0.85 && b !== w.carrier && sm && !pending) {
            const f = DT / 0.45
            sm.x += (raw.tx - sm.x) * f
            sm.y += (raw.ty - sm.y) * f
            tx = sm.x
            ty = sm.y
          } else if (sm) {
            sm.x = raw.tx
            sm.y = raw.ty
          } else smooth.set(b, { x: raw.tx, y: raw.ty })
          const sh = shaping.get(b)
          const cmd: MoveCmd =
            sh && (sh.ox !== 0 || sh.oy !== 0 || sh.sf !== 1 || tx !== raw.tx)
              ? { ...raw, tx: tx + sh.ox, ty: ty + sh.oy, speed: raw.speed * sh.sf }
              : raw
          stepBody(b, cmd, DT)
          all.push(b)
          if (tm) tm.noteAccel(b.accMag, speedOf(b))
        }
      }
      for (const s of sides) {
        stepGoalie(s)
        all.push(s.goalie)
      }
      const contacts: Contact[] = []
      resolveBodies(all, contacts)
      for (const b of all) constrainBody(b)
      if (tm) tm.noteOverlap(all)
      // Contacts → hits (the physical game reads real collisions).
      for (const ct of contacts) {
        if (pending || celebration) break
        const r = resolveHit(w, ct, hitIntent, rng, ctx.intensity ?? 0)
        if (!r) continue
        ev({
          t: T(),
          period,
          type: 'hit',
          by: r.hitter.player.id,
          on: r.victim.player.id,
          pos: { x: r.victim.x / HALF_X, y: r.victim.y / HALF_Y },
          force: Math.round(clamp((r.force - 4) / 26, 0, 1) * 100) / 100,
          kind: r.kind,
          targetHadPuck: r.hadPuck
        })
        if (tm) tm.noteHit(r)
        if (r.loosePuck && w.carrier === r.victim) {
          const ang = Math.atan2(r.victim.vy, r.victim.vx) + rng.float(-1, 1)
          loosen(Math.cos(ang) * rng.float(4, 10) + r.victim.vx * 0.3, Math.sin(ang) * rng.float(4, 10) + r.victim.vy * 0.3, null)
          flight!.tried.set(r.victim, now)
        }
        if (r.penalty && !delayed) callPenalty(r.hitter, sideOf(r.hitter)!, r.penalty, r.victim)
        maybeTheCode(r)
      }
      now += DT
      w.t = now
      if (deadAt !== null) continue
      if (k === SUBSTEPS - 1) battleTick()
      if (w.delayedOffside) {
        const ds = w.delayedOffside
        if (puck.x * ds.a < BLUE_X || !anyOffside(ds)) w.delayedOffside = null
      }

      // Puck.
      if (w.carrier) {
        const c = w.carrier
        w.lastHad.set(c, now)
        {
          const cs = w.control!
          const inClose = Math.hypot(cs.a * GOAL_X - c.x, c.y) < 30
          if (!inClose) w.nearSince = -1
          else if (w.nearBy !== c || w.nearSince < 0) {
            w.nearBy = c
            w.nearSince = now
          }
        }
        const bp = bladePoint(c, now, speedOf(c) < 6 ? 1.3 : 0.8)
        puck.x = bp.x
        puck.y = bp.y
        puck.vx = c.vx
        puck.vy = c.vy
        // Offside: the puck carried over the blue line with a teammate ahead of it.
        const s = w.control!
        const adv = puck.x * s.a
        if (lastCarrierAdvSide === s && prevAdv < BLUE_X && adv >= BLUE_X) {
          if (checkOffside(s, true)) continue
          s.entryAt = now
          if (tm) {
            tm.entriesCarry++
            // Entry numbers (scorecard definition): attackers level/ahead vs defenders goal-side.
            const adv0 = puck.x * s.a
            let atk = 0
            let def = 0
            let caught = 0
            for (const b of s.skaters) if (b.x * s.a >= adv0 - 10) atk++
            for (const o of oppOf(s).skaters) {
              if (o.x * s.a > adv0) def++
              else if (o.x * s.a < adv0 - 20) caught++
            }
            const key = `${atk}v${def}${now - w.possSince <= 8 ? 'T' : ''} c${caught}`
            tm.entryNumbers[key] = (tm.entryNumbers[key] ?? 0) + 1
            if (def === 0 && tm.entryLog.length < 40) tm.entryLog.push(`P${period} ${now.toFixed(1)} ${key}`)
            if (atk > def && now - w.possSince <= 8) {
              const how = turnSnap.split('@')[0] + ':' + (Number(turnSnap.split('@')[1]?.split(' ')[0] ?? 0) < -BLUE_X ? 'DZ' : Number(turnSnap.split('@')[1]?.split(' ')[0] ?? 0) < BLUE_X ? 'NZ' : 'OZ')
              tm.dbg[`odd:${how}`] = (tm.dbg[`odd:${how}`] ?? 0) + 1
              const at = Number(turnSnap.split('@')[1]?.split(' ')[0] ?? 0)
              const zone = at < -BLUE_X ? 'DZ' : at < BLUE_X ? 'NZ' : 'OZ'
              tm.dbg[`oddZone:${zone}`] = (tm.dbg[`oddZone:${zone}`] ?? 0) + 1
              if (tm.dbgLog.length < 60) tm.dbgLog.push(`${key} poss ${(now - w.possSince).toFixed(1)}s | ${turnSnap}`)
            }
          }
        }
        prevAdv = adv
        lastCarrierAdvSide = s
      } else if (flight?.kind === 'shot' && flight.shot) {
        const sp = flight.shot
        const step = Math.hypot(puck.vx, puck.vy) * DT
        sp.travelled += step
        if (sp.travelled >= sp.travel) {
          puck.x = sp.at.x
          puck.y = sp.at.y
          resolveShot(flight)
        } else {
          puck.x += puck.vx * DT
          puck.y += puck.vy * DT
        }
      } else {
        const res = stepPuck(puck, DT)
        if (res === 'outOfPlay') {
          if (tm) tm.overGlass++
          // Shot over the glass from your own zone: delay of game.
          const fs0 = flight?.side
          if (fs0 && flight?.from && flight.releaseAdv < -BLUE_X && !delayed) {
            callPenalty(flight.from, fs0, 'delay of game')
            if (pending) continue
          }
          const dot = nearestDot({ x: puck.x, y: puck.y })
          stopPlay(dot, 'neutral', null, 'other')
          if (pending) pending.zone = Math.abs(dot.x) <= 25 ? 'neutral' : 'defensive'
          continue
        }
        const fs = flight?.side ?? null
        // Offside on a pass/dump over the line.
        if (fs && flight && flight.kind !== 'loose') {
          const adv = puck.x * fs.a
          if (lastCarrierAdvSide === fs && prevAdv < BLUE_X && adv >= BLUE_X) {
            if (checkOffside(fs, false)) continue
            fs.entryAt = now
            if (tm) {
              if (flight.kind === 'dump') tm.entriesDump++
              else tm.entriesPass++
            }
          }
          prevAdv = adv
        }
        // Icing: shot from our side of the red line, crosses their goal line untouched.
        if (flight && flight.untouched && fs && flight.releaseAdv < 0 && puck.x * fs.a > GOAL_X && Math.abs(puck.y) > NET_HALF_W + 0.5) {
          if (!fs.shorthanded) {
            if (tm) tm.icings++
            puck.x = fs.a * GOAL_X
            stopPlay(dzDot(fs, puck.y), 'defensive', fs, 'icing')
            continue
          }
          flight.untouched = false
        }
        // Pickups and interceptions.
        // A loose puck at the goalie's pads: he smothers it (whistle) unless
        // an attacker gets a stick on it first.
        if (coverByGoalie()) continue
        pickup()
        // Puck pinned on the boards in a scrum: whistle.
        if (!w.carrier && Math.hypot(puck.vx, puck.vy) < 3 && distToBoards(puck.x, puck.y) < 3.5) {
          let hN = 0
          let aN = 0
          for (const b of H.skaters) if (Math.hypot(b.x - puck.x, b.y - puck.y) < 5) hN++
          for (const b of A.skaters) if (Math.hypot(b.x - puck.x, b.y - puck.y) < 5) aN++
          if (hN > 0 && aN > 0) {
            if (boardPinSince < 0) boardPinSince = now
            else if (now - boardPinSince > 3) {
              boardPinSince = -1
              if (tm) tm.pinWhistles++
              const dot = nearestDot({ x: puck.x, y: puck.y })
              stopPlay(dot, 'neutral', null, 'other')
              if (pending) pending.zone = Math.abs(dot.x) <= 25 ? 'neutral' : 'defensive'
              continue
            }
          } else boardPinSince = -1
        } else boardPinSince = -1
      }
    }

    if (pending && !celebration) conductFaceoff()
    if (tm) {
      if (!pending && !celebration && deadAt === null) tm.liveSeconds += FRAME_DT
    }
  }

  // -------------------------------------------------------------------------
  // Helpers that close over the period state.
  // -------------------------------------------------------------------------
  function sideOf(b: Body): Side | null {
    if (H.skaters.includes(b)) return H
    if (A.skaters.includes(b)) return A
    return null
  }

  function anyOffside(s: Side): boolean {
    for (const b of s.skaters) if (b !== w.carrier && b.x * s.a > BLUE_X + 1) return true
    return false
  }

  function callOffside(s: Side): void {
    if (tm) tm.offsides++
    w.delayedOffside = null
    stopPlay(dotFt(s.a * DOT_NZ_X, puck.y >= 0 ? DOT_Y : -DOT_Y), 'neutral', null, 'offside')
  }

  /**
   * The puck crossed `s`'s offensive blue line. Carried over with a teammate
   * ahead of it: offside, whistle. Passed or shot in: DELAYED offside — play
   * on while the offending men tag up; whistle only if the attackers touch
   * the puck in the zone before they all get back out (NHL rule 83).
   */
  function checkOffside(s: Side, carried: boolean): boolean {
    if (!anyOffside(s)) return false
    if (carried) {
      callOffside(s)
      return true
    }
    w.delayedOffside = s
    if (tm) tm.delayedOffsides++
    return false
  }

  function coverByGoalie(): boolean {
    if (puck.z > 1 || Math.hypot(puck.vx, puck.vy) > 7) return false
    for (const s of sides) {
      if (s.sim.pulled) continue
      const g = s.goalie
      if (Math.hypot(g.x - puck.x, g.y - puck.y) > 2.8) continue
      if (!rng.chance(0.07)) continue
      // An attacker's stick right there keeps it alive.
      const opp = oppOf(s)
      let jam = false
      for (const b of opp.skaters) if (Math.hypot(b.x - puck.x, b.y - puck.y) < 2.2) jam = true
      if (jam && rng.chance(0.5)) return false
      const dot = dzDot(s, puck.y)
      stopPlay(dot, zoneOf(dot, opp), s, 'goalieFreeze')
      return true
    }
    return false
  }

  // --- The code: answering a dirty (or star-rattling) hit. ------------------
  function maybeTheCode(r: { hitter: Body; victim: Body; force: number; penalty: string | null }): void {
    if (codeDue) return
    const vs = sideOf(r.victim)
    if (!vs) return
    const dirty = r.penalty === 'boarding' || r.penalty === 'charging' || r.penalty === 'elbowing'
    const star = r.victim.player.composites.scoring >= 72 && r.force > 20
    if (!dirty && !star) return
    // The toughest man on the ice for the victim's side steps up.
    let ans: Body | null = null
    let best = -1
    for (const b of vs.skaters) {
      if (b === r.victim && !dirty) continue
      const tough = (b.player.fighting ?? b.player.composites.penaltyProne) + r01(b.player.ratings.mental.aggression) * 40 + (b.player.role === 'enforcer' ? 40 : 0)
      if (tough > best) {
        best = tough
        ans = b
      }
    }
    if (!ans) return
    const p = clamp((best / 160) * (dirty ? 0.3 : 0.1) * (1 + (ctx.intensity ?? 0) * 0.8), 0, 0.6)
    if (rng.chance(p)) codeDue = { answerer: ans, hitter: r.hitter, side: vs }
  }
  function settleTheCode(): boolean {
    const c = codeDue
    codeDue = null
    if (!c) return false
    const hs = sideOf(c.hitter)
    if (!hs || !c.side.skaters.includes(c.answerer)) return false
    const absNow = absBase + now
    // Gloves off, or just a shove after the whistle (roughing).
    const willing = (c.hitter.player.fighting ?? 50) + r01(c.hitter.player.ratings.mental.aggression) * 40
    if (rng.chance(clamp(willing / 120, 0.2, 0.85))) {
      for (const [s, b] of [[c.side, c.answerer], [hs, c.hitter]] as const) {
        s.sim.sidelined.push({ expiresAt: absNow + FIGHT_MAJOR_SECONDS, playerId: b.player.id })
        stat(ctx, b.player.id).penaltyMinutes += 5
        ev({ t: T(), period, type: 'penalty', player: b.player.id, infraction: 'fighting', minutes: 5 })
      }
      if (tm) tm.fights++
    } else {
      c.side.sim.penalties.push({ expiresAt: absNow + PENALTY_SECONDS, playerId: c.answerer.player.id })
      stat(ctx, c.answerer.player.id).penaltyMinutes += 2
      ev({ t: T(), period, type: 'penalty', player: c.answerer.player.id, infraction: 'roughing', minutes: 2, drawnBy: c.hitter.player.id })
      if (tm) tm.penalties++
    }
    if (tm) tm.codeAnswers++
    return true
  }

  // --- Battles: a contested puck both teams are fighting for. ---------------
  function battleTick(): void {
    if (pending || celebration) return
    const near = (s: Side): Body[] => s.skaters.filter((b) => Math.hypot(b.x - puck.x, b.y - puck.y) < 4.5)
    const nh = near(H)
    const na = near(A)
    const nearNet = Math.abs(Math.abs(puck.x) - GOAL_X) < 15 && Math.abs(puck.y) < 12
    const contested = nh.length > 0 && na.length > 0 && (w.carrier === null || distToBoards(puck.x, puck.y) < 8 || nearNet)
    if (contested) {
      if (!battle) {
        const kind = distToBoards(puck.x, puck.y) < 8 ? 'boards' : nearNet ? 'netFront' : 'loosePuck'
        battle = { start: now, x: puck.x, y: puck.y, kind, players: new Set(), last: now }
      }
      for (const b of [...nh, ...na]) battle.players.add(b)
      battle.last = now
    } else if (battle && now - battle.last > 0.5) {
      endBattle(w.carrier)
    }
  }
  function endBattle(winner: Body | null): void {
    if (!battle) return
    const b = battle
    battle = null
    const dur = b.last - b.start
    if (dur < 1) return
    ev({
      t: T(),
      period,
      type: 'battle',
      kind: b.kind,
      pos: { x: b.x / HALF_X, y: b.y / HALF_Y },
      players: [...b.players].map((p) => p.player.id),
      winner: winner && b.players.has(winner) ? winner.player.id : winner ? winner.player.id : null,
      durationS: Math.round(dur * 10) / 10
    })
    if (tm) tm.battles++
  }

  function pickup(): void {
    if (!flight) return
    const f = flight
    const pvx = puck.vx
    const pvy = puck.vy
    const psp = Math.hypot(pvx, pvy)
    if (puck.z > 3) return
    // Who is within reach of the puck right now?
    const cands: { b: Body; s: Side; d: number }[] = []
    for (const s of sides) {
      for (const b of s.skaters) {
        if (b.stun > 0) continue
        const d = Math.hypot(b.x - puck.x, b.y - puck.y)
        if (d > REACH) {
          if (d > REACH + 1.5) f.tried.delete(b)
          continue
        }
        if (now - (f.tried.get(b) ?? -99) < RETRY_S) continue
        // A saucer pass flies over the sticks in the lane.
        if (f.kind === 'pass' && f.side !== s && puck.z > 0.35) continue
        cands.push({ b, s, d })
      }
    }
    if (cands.length === 0) return
    cands.sort((p, q) => p.d - q.d)
    for (const cd of cands) {
      const { b, s, d } = cd
      f.tried.set(b, now)
      if (f.kind === 'loose' || f.kind === 'dump') f.untouched = false
      const rel = Math.hypot(pvx - b.vx, pvy - b.vy)
      const hands = (r01(b.player.ratings.technical.stickhandling) + r01(b.player.composites.puckControl)) / 2
      const reachF = d < 2.8 ? 1 : 1 - ((d - 2.8) / (REACH - 2.8)) * 0.55
      let p: number
      const mine = f.side === s
      const dStick = d < 2.6 ? 1 : 0.45
      // A defender draped on the receiver contests the reception.
      let cover = 0
      for (const o of (s === H ? A : H).skaters) if (Math.hypot(o.x - b.x, o.y - b.y) < 3.5) cover++
      // A good pass is easy to take (on the tape, the right weight); a poor
      // passer's puck arrives in the feet or bouncing.
      if (f.kind === 'pass' && b === f.to) p = clamp(0.94 - Math.max(0, rel - 55) / 140 + (hands - 0.5) * 0.12 + (r01(f.from?.player.ratings.technical.passing) - 0.55) * 0.3 - cover * 0.22, 0.3, 0.99)
      else if (f.kind === 'pass' && mine) p = clamp(0.8 - Math.max(0, rel - 45) / 120, 0.4, 0.95)
      else if (f.kind === 'pass') {
        const read = (r01(b.player.ratings.mental.anticipation) + rDef(b.player.ratings.defensive.stickChecking)) / 2
        p = clamp((0.08 + read * 0.3) * dStick - Math.max(0, rel - 40) / 200, 0.02, 0.5)
      } else {
        // Loose or dumped puck: speed makes it hard, hands make it easy; a
        // contested puck is a battle.
        p = clamp(0.62 + (hands - 0.5) * 0.4 - Math.max(0, rel - 18) / 60, 0.08, 0.95)
        const rivals = cands.filter((q) => q.s !== s).length
        if (rivals > 0) {
          const str = r01(b.player.ratings.physical.strength)
          p *= 0.55 + str * 0.35
        }
      }
      p *= reachF
      if (rng.chance(p)) {
        f.untouched = false
        gainControl(b, s)
        return
      }
      // Missed it clean (the puck went by the stick) — or got a piece of it
      // and it changes course; the closer the stick, the likelier a touch.
      // The intended receiver who bobbles it keeps it near him.
      const touch = b === f.to ? 0.7 : d < 2.6 ? 0.45 : 0.15
      if (!rng.chance(touch)) continue
      f.untouched = false
      puck.vx = pvx * 0.6 + rng.float(-6, 6)
      puck.vy = pvy * 0.6 + rng.float(-6, 6)
      if (f.kind === 'pass' && !mine && f.passEv) {
        // Tipped by a defender: the pass is broken up.
        f.kind = 'loose'
        f.passEv.completed = false
        w.passTo = null
        w.oneTimerFor = null
        if (tm) tm.passesDeflected++
      }
      return
    }
    void psp
  }

  function stepGoalie(s: Side): void {
    const g = s.goalie
    if (s.sim.pulled) {
      // Skates hard for his bench door (never through the play: along the boards).
      const tx = gateOf(s).x
      const ty = BENCH_GATE.y
      const d = Math.hypot(tx - g.x, ty - g.y)
      if (d < 5) goalieAtBench.add(s.sim)
      const sp = Math.min(d / DT, 22)
      if (d > 0.01) {
        g.vx = ((tx - g.x) / d) * sp
        g.vy = ((ty - g.y) / d) * sp
        g.x += g.vx * DT
        g.y += g.vy * DT
      }
      return
    }
    goalieAtBench.delete(s.sim)
    // The goalie tracks a lagged read of the puck — a cross-ice pass leaves
    // him moving (and slower readers further behind the play).
    const gr = g.player.ratings.goalie
    const read = r01(gr?.positioningG ?? g.player.composites.goaltending)
    const lag = 0.16 - read * 0.1
    const src = deadAt ?? puck
    const px = src.x - puck.vx * lag * (deadAt ? 0 : 1)
    const py = src.y - puck.vy * lag * (deadAt ? 0 : 1)
    const ideal0 = goalieIdeal(s, px, py)
    // He bit on a deke: he goes with the fake, out across his crease.
    const bit = bite !== null && bite.side === s && now < bite.until
    const ideal = bit && bite ? { x: ideal0.x, y: clamp(ideal0.y + bite.dy, -NET_HALF_W - 3, NET_HALF_W + 3) } : ideal0
    const dx = ideal.x - g.x
    const dy = ideal.y - g.y
    const d = Math.hypot(dx, dy)
    const maxV = 11 + r01(gr?.recovery ?? 50) * 7 // T-push / shuffle
    const want = Math.min(maxV, d * 6)
    const tvx = d > 0.01 ? (dx / d) * want : 0
    const tvy = d > 0.01 ? (dy / d) * want : 0
    const acc = 70
    let ax = (tvx - g.vx) / 0.08
    let ay = (tvy - g.vy) / 0.08
    const am = Math.hypot(ax, ay)
    if (am > acc) {
      ax *= acc / am
      ay *= acc / am
    }
    g.vx += ax * DT
    g.vy += ay * DT
    g.x += g.vx * DT
    g.y += g.vy * DT
    g.hx = s.a
    g.hy = 0
    const fx = px - g.x
    const fy = py - g.y
    const fl = Math.hypot(fx, fy)
    if (fl > 0.5) {
      g.hx = fx / fl
      g.hy = fy / fl
    }
  }

  // Close out the period.
  const endT = ended ? now : lengthSeconds
  for (const s of sides) creditShift(s, endT)
  ctx.stream.push({ t: Math.round(endT * 100) / 100, period, type: 'periodEnd' })
  void HALF_Y
  void realPressure
  void scoreEffectMult
  return { ended }
}

export interface AgentSimOptions extends FullSimOptions {
  /** Optional agent-engine telemetry sink (motion, passing, rules, physical). */
  agentTelemetry?: AgentTelemetry
}

/** Simulate a watched game with the agent engine. Same contract as fullSimGame. */
export function agentSimGame(
  home: Team,
  away: Team,
  resolve: (id: PlayerId) => Player,
  opts: AgentSimOptions
): GameOutcome {
  const tm = opts.agentTelemetry ?? null
  return runGame(home, away, resolve, opts, () => (c, h, a, spec) => agentPeriod(c, h, a, spec, tm))
}

export { emptyAgentTelemetry }
export type { AgentTelemetry }
export type { Rng }
