/**
 * A fight, as a timed sequence (agent engine).
 *
 * Until now a fight in the watched game was two five-minute majors and a
 * whistle: both men vanished to the box and nothing was drawn. A real fight is
 * a little play of its own at the stoppage, and it has a shape:
 *
 *   gloves drop → they skate together and square up (circling) → grab jerseys
 *   → flurries of punches, with clinches between them → one goes down (a
 *   punch or a wrestled takedown) or both run out of gas → the linesmen step
 *   in and pull them apart → off to the box.
 *
 * Everything here is decided up front, from the two players' attributes and a
 * deterministic rng the caller hands in (the fight hash family, never the
 * game's main stream), so the whole sequence is DATA: the sim holds the
 * stoppage for `durationS` of playback time (the period clock is stopped), the
 * stream carries the plan in one `fight` event, and the renderers play it.
 *
 * Who wins: a fighter's punch is his `fighting` rating (mods) or, absent, a
 * blend of strength, aggression and penalty-proneness; reach and weight come
 * from the `height` and `strength` ratings (the bio heightCm/weightKg are
 * display-only by contract); his chin is balance + strength; his gas tank is
 * stamina and the energy he brought into the fight. Enforcers get a bump on
 * all of it, as they should.
 */
import type { FightBeat, FightBeatKind, FightEnding, GameStream, Player, PlayerId } from '@domain'
import type { Rng } from '@engine/shared/rng'

export type FightSide = 'home' | 'away'
export type { FightBeat, FightBeatKind, FightEnding }

export interface FightPlan {
  beats: FightBeat[]
  /** Seconds from the drop until both men are in the box (the stoppage holds this long). */
  durationS: number
  /** Seconds from the drop until the linesmen have separated them … */
  separateAt: number
  /** … and until they are led off (the sim assesses the majors and changes lines here). */
  boxAt: number
  ending: FightEnding
  /** Who won it on the night (null = a draw: nobody had the better of it). */
  winner: FightSide | null
  /** Who went to the ice, if anybody. */
  down: FightSide | null
  thrown: Record<FightSide, number>
  landed: Record<FightSide, number>
  /** A fighter who comes out of it hurt (he does not return tonight). */
  injured: FightSide | null
}

/** The fighter as the plan needs him (0–100 scales). */
export interface Fighter {
  punch: number
  reach: number
  chin: number
  wrestle: number
  gas: number
  aggression: number
}

const cl = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

/** Map a Player (and the energy he brings, 0..1) to the fight model. */
export function fighterOf(p: Player, energy = 1): Fighter {
  const ph = p.ratings.physical
  const mn = p.ratings.mental
  const enforcer = p.role === 'enforcer' ? 12 : 0
  const fighting = p.fighting ?? cl(ph.strength * 0.4 + mn.aggression * 0.35 + p.composites.penaltyProne * 0.25, 1, 99)
  return {
    punch: cl(fighting * 0.7 + ph.strength * 0.3 + enforcer, 1, 99),
    reach: cl(ph.height, 1, 99),
    chin: cl(ph.balance * 0.5 + ph.strength * 0.3 + fighting * 0.2 + enforcer * 0.5, 1, 99),
    wrestle: cl(ph.strength * 0.55 + ph.balance * 0.3 + fighting * 0.15, 1, 99),
    gas: cl(ph.stamina * (0.55 + 0.45 * cl(energy, 0, 1)) + enforcer * 0.5, 1, 99),
    aggression: cl(mn.aggression * 0.6 + fighting * 0.4, 1, 99),
  }
}

/** Seconds the two men take to come together (fight pace, ~12 ft/s, and a moment to stop and square up). */
export function approachSeconds(distFt: number): number {
  return cl(0.8 + distFt / 12, 1, 4.5)
}

/** Fight-ending damage (1 = he goes down). */
const DOWN_AT = 1
/** No fight goes on past this many seconds of punching: the linesmen have seen enough. */
const MAX_BOUT_S = 38
/** Linesmen hover from the grab; they step in this long after a man goes down … */
const STEP_IN_DOWN_S = 0.7
/** … or once both are spent and hanging on. */
const STEP_IN_TIRED_S = 1.8
/** Pulling them apart, then the walk to the box. */
const SEPARATE_S = 2.2
const ESCORT_S = 5

/**
 * Plan a fight between the home and away fighter. `approachS` is how long they
 * take to come together (approachSeconds of the gap between them); `rng` must
 * be a stream the game's outcome does not otherwise depend on.
 */
export function planFight(home: Fighter, away: Fighter, rng: Rng, approachS = 1.5): FightPlan {
  const F: Record<FightSide, Fighter> = { home, away }
  const beats: FightBeat[] = []
  const dmg: Record<FightSide, number> = { home: 0, away: 0 }
  const gas: Record<FightSide, number> = { home: 1, away: 1 }
  const thrown: Record<FightSide, number> = { home: 0, away: 0 }
  const landed: Record<FightSide, number> = { home: 0, away: 0 }
  const other = (s: FightSide): FightSide => (s === 'home' ? 'away' : 'home')
  const r = (v: number): number => Math.round(v * 100) / 100
  let t = 0
  beats.push({ kind: 'drop', at: 0 })
  t = approachS
  beats.push({ kind: 'square', at: r(t) })
  // Circling: a feeling-out spell, longer when both are cagey.
  t += rng.float(1.2, 2.6) * (1.25 - ((home.aggression + away.aggression) / 200) * 0.5)
  // The more aggressive man grabs first.
  const grabber: FightSide = rng.chance(cl(0.5 + (home.aggression - away.aggression) / 120, 0.2, 0.8)) ? 'home' : 'away'
  beats.push({ kind: 'grab', at: r(t), by: grabber })
  const startPunching = t + 0.4
  t = startPunching
  let ending: FightEnding | null = null
  let down: FightSide | null = null
  let helmetOff = 0
  let clinches = 0
  while (ending === null) {
    // A flurry: the man with more in the tank (and the will) throws more.
    const want = (s: FightSide): number => (F[s].aggression / 100 + 0.4) * (0.25 + gas[s])
    const n = 2 + rng.int(4)
    for (let i = 0; i < n && ending === null; i++) {
      const by: FightSide = rng.chance(want('home') / (want('home') + want('away'))) ? 'home' : 'away'
      const op = other(by)
      const a = F[by]
      const d = F[op]
      thrown[by]++
      // Landing: punch skill and reach against his man's; tired arms miss.
      const pLand = cl(0.42 + (a.punch - d.punch) / 260 + (a.reach - d.reach) / 400 + (gas[by] - gas[op]) * 0.15, 0.18, 0.72)
      const hit = rng.chance(pLand)
      const heavy = hit && rng.chance(cl(0.08 + (a.punch - 50) / 300 + (by === grabber ? 0.04 : 0), 0.03, 0.25))
      const hand: 'R' | 'L' = rng.chance(0.78) ? 'R' : 'L'
      beats.push({ kind: 'punch', at: r(t), by, hand, landed: hit, ...(heavy ? { heavy: true } : {}) })
      gas[by] = Math.max(0, gas[by] - (0.07 + (hand === 'R' ? 0.01 : 0)) * (1.5 - a.gas / 100))
      if (hit) {
        landed[by]++
        const blow = (heavy ? 0.3 : 0.085) * (0.7 + a.punch / 170) * rng.float(0.7, 1.25)
        dmg[op] += blow * (1.45 - d.chin / 110)
        gas[op] = Math.max(0, gas[op] - 0.025)
        // A helmet comes loose in the exchange now and then (at most both).
        if (helmetOff < 2 && rng.chance(heavy ? 0.3 : 0.06)) {
          helmetOff++
          beats.push({ kind: 'helmet', at: r(t + 0.15), by: op })
        }
        if (dmg[op] >= DOWN_AT) {
          ending = 'knockdown'
          down = op
          beats.push({ kind: 'down', at: r(t + 0.25), by: op, how: 'punch' })
          t += 0.25
          break
        }
      }
      t += rng.float(0.45, 0.85)
    }
    if (ending !== null) break
    // Between flurries: they tie each other up; a stronger man can wrestle
    // a tired one down.
    const clinchAt = t
    clinches++
    beats.push({ kind: 'clinch', at: r(clinchAt) })
    for (const s of ['home', 'away'] as const) {
      if (clinches < 2) break // nobody is wrestled down off the first tie-up
      const o = other(s)
      const edge = (F[s].wrestle - F[o].wrestle) / 100 + (gas[s] - gas[o]) * 0.5 + dmg[o] * 0.3
      if (edge > 0.04 && rng.chance(cl(0.015 + edge * 0.18, 0, 0.1))) {
        ending = 'takedown'
        down = o
        t = clinchAt + rng.float(0.8, 1.6)
        beats.push({ kind: 'down', at: r(t), by: o, how: 'takedown' })
        break
      }
    }
    if (ending !== null) break
    t = clinchAt + rng.float(1.0, 2.4)
    for (const s of ['home', 'away'] as const) gas[s] = Math.min(1, gas[s] + 0.05)
    const spent = gas.home < 0.45 && gas.away < 0.45
    if (spent || t - startPunching > MAX_BOUT_S) {
      ending = 'tired'
      beats.push({ kind: 'tired', at: r(t) })
    }
  }
  const linesmenAt = t + (ending === 'tired' ? STEP_IN_TIRED_S : STEP_IN_DOWN_S)
  beats.push({ kind: 'linesmen', at: r(linesmenAt) })
  const separateAt = linesmenAt + 0.8
  beats.push({ kind: 'separate', at: r(separateAt) })
  beats.push({ kind: 'escort', at: r(separateAt + SEPARATE_S) })
  const boxAt = separateAt + SEPARATE_S
  const durationS = boxAt + ESCORT_S
  // Who had the better of it: a man down lost; otherwise the damage dealt.
  let winner: FightSide | null
  if (down) winner = other(down)
  else {
    const diff = dmg.away - dmg.home // > 0: home did more
    winner = Math.abs(diff) < 0.18 ? null : diff > 0 ? 'home' : 'away'
  }
  // Injury: a man punched to the ice is the one at real risk (a concussion,
  // a broken hand); otherwise it is rare.
  let injured: FightSide | null = null
  if (down && ending === 'knockdown' && rng.chance(cl(0.04 + dmg[down] * 0.04, 0, 0.12))) injured = down
  else if (rng.chance(0.012)) injured = rng.chance(0.5) ? 'home' : 'away'
  beats.sort((a, b) => a.at - b.at)
  return { beats, durationS: r(durationS), separateAt: r(separateAt), boxAt: r(boxAt), ending, winner, down, thrown, landed, injured }
}

/* ───────────────────────────── consequences ───────────────────────────── */

/** Morale after the night (applied by the career layer once per game). */
const WIN_MORALE = 3
const LOSS_MORALE = -2
const DRAW_MORALE = 1

/**
 * Morale deltas from tonight's fights (the `fight` events in the stream): the
 * winner walks taller, the man who lost stews a little (an enforcer shrugs it
 * off: it is his job), and a draw means he stood up for his team.
 */
export function fightMoraleDeltas(stream: GameStream, resolve?: (id: PlayerId) => Player | undefined): Map<PlayerId, number> {
  const out = new Map<PlayerId, number>()
  const add = (id: PlayerId, d: number): void => {
    out.set(id, (out.get(id) ?? 0) + d)
  }
  for (const e of stream) {
    if (e.type !== 'fight') continue
    for (const side of ['home', 'away'] as const) {
      const id = side === 'home' ? e.home : e.away
      if (e.winner === null) add(id, DRAW_MORALE)
      else if (e.winner === id) add(id, WIN_MORALE)
      else add(id, resolve?.(id)?.role === 'enforcer' ? Math.round(LOSS_MORALE / 2) : LOSS_MORALE)
    }
  }
  return out
}

/* ───────────────────────────── on the ice ───────────────────────────── */

/** A body as the bout needs it (rink feet; the agent engine's Body fits). */
export interface BoutBody {
  x: number
  y: number
}
/** The move a body is given each think during the bout (physics.ts MoveCmd fits). */
export interface BoutCmd {
  tx: number
  ty: number
  speed: number
  arrive: boolean
  urgency: number
  faceX: number
  faceY: number
}

/** Fighters' gap (ft, centre to centre) while circling and once they have hold. */
const CIRCLE_GAP = 6.5
const LOCKED_GAP = 2.6
/** How fast the pair turns round the spot (rad/s): circling, then wrestling. */
const CIRCLE_TURN = 0.55
const LOCKED_TURN = 0.02
/** Everyone else backs off to a ring this far out and drifts round it. */
const RING_MIN = 20
const RING_MAX = 36
const RING_DRIFT = 0.25 // rad/s of target lead

/** The last beat (of `kinds`, if given) started by `tau` seconds after the drop. */
export function beatAt(plan: { beats: readonly FightBeat[] }, tau: number, kinds?: readonly FightBeatKind[]): FightBeat | null {
  let out: FightBeat | null = null
  for (const b of plan.beats) {
    if (b.at > tau) break
    if (!kinds || kinds.includes(b.kind)) out = b
  }
  return out
}

/**
 * Where the two fighters go at `tau` seconds after the drop: they skate to the
 * spot, circle each other fists up, lock on once one has a grab and turn
 * slowly as they wrestle, the man who went down stays down, and after
 * `separateAt` the linesmen pull them apart. `baseAng` is the home man's
 * bearing from the away man when the gloves dropped (the axis turns from it).
 */
export function fighterCmds(plan: FightPlan, tau: number, baseAng: number, spot: BoutBody, home: BoutBody, away: BoutBody): { home: BoutCmd; away: BoutCmd } {
  const sq = plan.beats.find((b) => b.kind === 'square')?.at ?? 1
  const grab = plan.beats.find((b) => b.kind === 'grab')?.at ?? sq + 2
  const downB = plan.beats.find((b) => b.kind === 'down')
  const circled = CIRCLE_TURN * Math.max(0, Math.min(tau, grab) - sq)
  const locked = Math.max(0, Math.min(tau, plan.separateAt) - grab)
  const ang = baseAng + circled + LOCKED_TURN * locked + 0.25 * Math.sin(locked * 0.7)
  let gap = LOCKED_GAP
  if (tau < sq) gap = CIRCLE_GAP
  else if (tau < grab) gap = CIRCLE_GAP - ((tau - sq) / Math.max(0.1, grab - sq)) * (CIRCLE_GAP - LOCKED_GAP - 1)
  else if (tau >= plan.separateAt) gap = LOCKED_GAP + Math.min(9, (tau - plan.separateAt) * 4)
  const ux = Math.cos(ang) * gap * 0.5
  const uy = Math.sin(ang) * gap * 0.5
  const downNow = downB && tau >= downB.at && tau < plan.separateAt ? downB.by : null
  const mk = (b: BoutBody, x: number, y: number, fx: number, fy: number, still: boolean): BoutCmd => {
    // closing on the spot at fight pace; on it, small steps
    const d = Math.hypot(x - b.x, y - b.y)
    return { tx: x, ty: y, speed: still ? 0.5 : Math.min(15, 3 + d * 1.2), arrive: true, urgency: 0.9, faceX: fx, faceY: fy }
  }
  return {
    home: mk(home, spot.x + ux, spot.y + uy, away.x, away.y, downNow === 'home'),
    away: mk(away, spot.x - ux, spot.y - uy, home.x, home.y, downNow === 'away'),
  }
}

/**
 * Everyone else backs off to a ring round the fight and drifts slowly round
 * it, watching (the sweaters circle; nobody joins in, that is a game
 * misconduct). `dir` (+1/-1) is the way this man drifts.
 */
export function ringCmd(spot: BoutBody, b: BoutBody, dir: number, halfX: number, halfY: number): BoutCmd {
  const d = Math.hypot(b.x - spot.x, b.y - spot.y)
  const ang = Math.atan2(b.y - spot.y, b.x - spot.x) + RING_DRIFT * dir
  const r = Math.max(RING_MIN, Math.min(RING_MAX, d))
  const tx = Math.max(-halfX + 6, Math.min(halfX - 6, spot.x + Math.cos(ang) * r))
  const ty = Math.max(-halfY + 4, Math.min(halfY - 4, spot.y + Math.sin(ang) * r))
  return { tx, ty, speed: d < RING_MIN ? 9 : 5, arrive: true, urgency: 0.6, faceX: spot.x, faceY: spot.y }
}

/** The meeting spot: between the two, kept off the boards and out of the creases. */
export function fightSpot(a: BoutBody, b: BoutBody, halfX: number, halfY: number): BoutBody {
  return {
    x: Math.max(-halfX + 24, Math.min(halfX - 24, (a.x + b.x) / 2)),
    y: Math.max(-halfY + 10, Math.min(halfY - 10, (a.y + b.y) / 2)),
  }
}
