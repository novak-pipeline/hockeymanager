/**
 * W3 S5 detectors: the puck carrier (W3-DESIGN item 4), read off the event
 * stream. The owner's notes this answers: "pass ping-pong", "breakaway skated
 * into the corner", "brainless toddler hockey".
 *
 * - **Ping-pong**: A passes to B, B passes straight back to A within a few
 *   seconds, and the give-and-go gained nothing - the puck is no nearer the net
 *   (by `PING.gainFt`) and the return reception is no better a shooting spot.
 *   Counted per completed return pass. A give-and-go where A skates to the net
 *   for the return is not ping-pong (the gain test).
 * - **Breakaways**: a carrier past the red line with no opposing skater
 *   goal-side of him (frames, 4 Hz), skating at the net. Outcome: a shot or a
 *   move on the goalie (attacked), a pass that leads to a shot (fed), the puck
 *   lost, or nothing (stalled). `corner`: before any shot he carried it below
 *   the dots out wide or behind the goal line.
 * - **Odd-man rushes**: a carried entry with more attackers in on the play
 *   than defenders goal-side; outcome = a shot attempt within `ODD.windowS`.
 * - **Score state**: shot attempts (on goal, missed, blocked) at 5-on-5 split
 *   by the shooting team's score state, for the NHL score effect (trailing
 *   teams out-shoot: ~54-56% of attempts, more late).
 */
import type { GameStream, PlayerRef } from '@domain'
import { playAbsT } from '@domain/streamTime'

export const PING = { returnS: 4, gainFt: 8, xgGain: 0.02 }
export const BREAKAWAY = { minAdv: 0, maxStartAdv: 60, maxStartY: 30, minVIn: 10, clearFt: 8, holdFrames: 2, windowS: 8, feedS: 3, cornerY: 22, cornerAdv: 69, goalLine: 88 }
export const ODD = { windowS: 5, trailFt: 20 }

const HX = 100
const HY = 42.5
/** Shooting-quality proxy for the gain test (distance and angle to the net, ft). */
function spotQ(x: number, y: number): number {
  const d = Math.hypot(89 - x, y)
  const ang = Math.atan2(Math.abs(y), Math.max(89 - x, 0.5))
  return Math.max(0, 0.35 - d * 0.006) * Math.max(0, 1 - ang / 1.4)
}

export interface CarrierPlayReport {
  passes: number
  pingPong: number
  /** Examples (what). */
  pingEx: string[]
  breakaways: number
  /** Episodes that stopped being breakaways (a defender got back goal-side) before an outcome. */
  caught: number
  /** Goals scored off the breakaway's own attack (the shot that ended it). */
  breakGoals: number
  attacked: number
  fed: number
  passedOff: number
  lost: number
  stalled: number
  corner: number
  breakEx: string[]
  oddMan: number
  oddAttempts: number
  /** 5v5 shot attempts by score state of the shooting team; late = third period. */
  attempts: { trailing: number; leading: number; tied: number; trailingLate: number; leadingLate: number }
  /** Shots on goal and goals by release distance (ft): < 10, 10-20, 20-35, 35+ (calibration aid). */
  byDist: { shots: number[]; goals: number[] }
}
export const DIST_EDGES = [10, 20, 35]

export function judgeCarrierPlay(stream: GameStream): CarrierPlayReport {
  const team = new Map<PlayerRef, 'home' | 'away'>()
  const goalieIds = new Set<PlayerRef>()
  // attack sign per period per side, from where the goalies stand
  const homeAttack = new Map<number, number>()
  for (const e of stream) {
    if (e.type !== 'frame') continue
    for (const s of e.home) team.set(s.player, 'home')
    for (const s of e.away) team.set(s.player, 'away')
    team.set(e.homeGoalie.player, 'home')
    team.set(e.awayGoalie.player, 'away')
    goalieIds.add(e.homeGoalie.player)
    goalieIds.add(e.awayGoalie.player)
    if (!homeAttack.has(e.period) && Math.abs(e.homeGoalie.pos.x) > 0.6) homeAttack.set(e.period, e.homeGoalie.pos.x > 0 ? -1 : 1)
  }
  const sign = (side: 'home' | 'away', period: number): number => (homeAttack.get(period) ?? 1) * (side === 'home' ? 1 : -1)

  const r: CarrierPlayReport = {
    passes: 0, pingPong: 0, pingEx: [],
    breakaways: 0, caught: 0, breakGoals: 0, attacked: 0, fed: 0, passedOff: 0, lost: 0, stalled: 0, corner: 0, breakEx: [],
    oddMan: 0, oddAttempts: 0,
    attempts: { trailing: 0, leading: 0, tied: 0, trailingLate: 0, leadingLate: 0 },
    byDist: { shots: [0, 0, 0, 0], goals: [0, 0, 0, 0] }
  }
  const bucket = (x: number, y: number, period: number, side: 'home' | 'away'): number => {
    const d = Math.hypot(89 - x * HX * sign(side, period), y * HY)
    let i = 0
    while (i < DIST_EDGES.length && d >= DIST_EDGES[i]!) i++
    return i
  }
  const lastShotB = new Map<PlayerRef, number>()
  for (const e of stream) {
    if (e.type === 'shot') {
      const side = team.get(e.shooter)
      if (!side) continue
      const b = bucket(e.from.x, e.from.y, e.period, side)
      r.byDist.shots[b]!++
      lastShotB.set(e.shooter, b)
    } else if (e.type === 'goal') {
      const b = lastShotB.get(e.scorer)
      if (b !== undefined) r.byDist.goals[b]!++
    }
  }

  // ---- ping-pong (pass events) ----
  let prev: { from: PlayerRef; to: PlayerRef; at: number; ax: number; ay: number; bx: number; by: number } | null = null
  for (const e of stream) {
    if (e.type === 'faceoff' || e.type === 'whistle' || e.type === 'goal') prev = null
    if (e.type === 'shot' || e.type === 'missedShot' || e.type === 'blockedShot') prev = null
    if (e.type !== 'pass') continue
    if (!e.completed) {
      prev = null
      continue
    }
    r.passes++
    const side = team.get(e.from)
    if (!side) continue
    const a = sign(side, e.period)
    const at = playAbsT(e)
    const ax = e.a.x * HX * a
    const ay = e.a.y * HY
    const bx = e.b.x * HX * a
    const by = e.b.y * HY
    if (prev && prev.to === e.from && prev.from === e.to && at - prev.at <= PING.returnS) {
      // the return: where A takes it back vs where A gave it
      const gain = bx - prev.ax
      const q = spotQ(bx, by) - spotQ(prev.ax, prev.ay)
      if (gain < PING.gainFt && q < PING.xgGain) {
        r.pingPong++
        if (r.pingEx.length < 6) r.pingEx.push(`P${e.period} ${e.t.toFixed(1)}: ${e.from}->${e.to} returned at (${bx.toFixed(0)},${by.toFixed(0)}) after giving it at (${prev.ax.toFixed(0)},${prev.ay.toFixed(0)})`)
      }
    }
    prev = { from: e.from, to: e.to, at, ax, ay, bx, by }
  }

  // ---- breakaways, odd-man rushes, score state (frames + events in order) ----
  let goalsH = 0
  let goalsA = 0
  let n5v5 = true
  interface Ep { carrier: PlayerRef; side: 'home' | 'away'; start: number; period: number; t: number; corner: boolean; passAt: number | null; done: boolean; caughtN: number }
  let ep: Ep | null = null
  let cand: { carrier: PlayerRef; n: number } | null = null
  let lastCarrier: PlayerRef | null = null
  let lastCarrierAdv = -999
  let lastFrameAt: number | null = null
  let odd: { side: 'home' | 'away'; until: number } | null = null
  let lastBreakShot: { who: PlayerRef; at: number } | null = null
  const close = (how: 'attacked' | 'fed' | 'passedOff' | 'lost' | 'stalled', why: string): void => {
    if (!ep || ep.done) return
    ep.done = true
    r.breakaways++
    r[how]++
    if (ep.corner) r.corner++
    if ((how === 'stalled' || how === 'passedOff' || ep.corner) && r.breakEx.length < 8) r.breakEx.push(`P${ep.period} ${ep.t.toFixed(1)} ${ep.carrier}: ${how}${ep.corner ? ' via the corner' : ''} (${why})`)
    ep = null
  }
  for (const e of stream) {
    const at = playAbsT(e)
    if (ep && at > ep.start + BREAKAWAY.windowS) close(ep.passAt !== null ? 'passedOff' : 'stalled', 'window ran out')
    if (odd && at > odd.until) odd = null
    if (e.type === 'goal') {
      if (team.get(e.scorer) === 'home') goalsH++
      else goalsA++
    }
    if (e.type === 'shot' || e.type === 'missedShot' || e.type === 'blockedShot' || e.type === 'goal') {
      const who = e.type === 'goal' ? e.scorer : e.shooter
      const side = team.get(who)
      if (e.type === 'goal' && lastBreakShot && lastBreakShot.who === who && at - lastBreakShot.at < 3) r.breakGoals++
      if (ep && side === ep.side && e.type !== 'goal') {
        lastBreakShot = { who, at }
        close(ep.passAt === null || who === ep.carrier ? 'attacked' : 'fed', e.type)
      }
      if (odd && side === odd.side && e.type !== 'goal') {
        r.oddAttempts++
        odd = null
      }
      if (e.type !== 'goal' && side && n5v5) {
        const lead = side === 'home' ? goalsH - goalsA : goalsA - goalsH
        const k = lead < 0 ? 'trailing' : lead > 0 ? 'leading' : 'tied'
        r.attempts[k]++
        if (e.period === 3 && lead < 0) r.attempts.trailingLate++
        if (e.period === 3 && lead > 0) r.attempts.leadingLate++
      }
      continue
    }
    if (e.type === 'deke' && ep && e.by === ep.carrier && e.on && goalieIds.has(e.on)) {
      close('attacked', 'deke on the goalie')
      continue
    }
    if (e.type === 'pass' && ep && e.from === ep.carrier) {
      if (ep.passAt === null) ep.passAt = at
      continue
    }
    if ((e.type === 'whistle' || e.type === 'faceoff') && ep) {
      close(ep.passAt !== null ? 'passedOff' : 'lost', e.type)
      continue
    }
    if (e.type !== 'frame') continue
    n5v5 = e.home.length === 5 && e.away.length === 5
    const c = e.puckCarrier
    if (ep && ep.passAt !== null && at > ep.passAt + BREAKAWAY.feedS) close('passedOff', 'pass, no shot')
    if (ep && c && team.get(c) !== ep.side) close('lost', 'turned over')
    if (!c || goalieIds.has(c)) {
      cand = null
      lastCarrier = null
      continue
    }
    const side = team.get(c)
    if (!side) continue
    const a = sign(side, e.period)
    const me = (side === 'home' ? e.home : e.away).find((s) => s.player === c)
    if (!me) continue
    const adv = me.pos.x * HX * a
    const y = me.pos.y * HY
    const opps = side === 'home' ? e.away : e.home
    // a defender got back goal-side of him (two frames running): no longer a breakaway - not his outcome to judge
    if (ep && c === ep.carrier && ep.passAt === null) {
      ep.caughtN = opps.some((s) => s.pos.x * HX * a > adv) ? ep.caughtN + 1 : 0
      if (ep.caughtN >= 2) {
        r.caught++
        ep = null
      }
    }
    if (ep && c === ep.carrier && ep.passAt === null && ((adv > BREAKAWAY.cornerAdv && Math.abs(y) > BREAKAWAY.cornerY) || adv > BREAKAWAY.goalLine)) ep.corner = true
    // odd-man rush: the carrier crosses their blue line this frame
    if (c === lastCarrier && lastCarrierAdv < 25 && adv >= 25 && !odd) {
      const mates = (side === 'home' ? e.home : e.away).filter((s) => s.pos.x * HX * a >= adv - ODD.trailFt).length
      const back = opps.filter((s) => s.pos.x * HX * a > adv).length
      if (mates > back && back <= 2) {
        r.oddMan++
        odd = { side, until: at + ODD.windowS }
      }
    }
    // skating at the net: ft/s toward their goal line since the last frame
    const vIn = c === lastCarrier && lastFrameAt !== null && at > lastFrameAt ? (adv - lastCarrierAdv) / (at - lastFrameAt) : 0
    lastCarrierAdv = adv
    lastCarrier = c
    lastFrameAt = at
    if (!ep) {
      // open ice: from the red line to the top of the circles, nobody goal-side, going at the net
      const alone = adv >= BREAKAWAY.minAdv && adv < BREAKAWAY.maxStartAdv && Math.abs(y) < BREAKAWAY.maxStartY && vIn > BREAKAWAY.minVIn && opps.every((s) => s.pos.x * HX * a < adv && Math.hypot((s.pos.x - me.pos.x) * HX, (s.pos.y - me.pos.y) * HY) >= BREAKAWAY.clearFt)
      if (alone) {
        cand = cand && cand.carrier === c ? { carrier: c, n: cand.n + 1 } : { carrier: c, n: 1 }
        if (cand.n >= BREAKAWAY.holdFrames && n5v5Like(e)) {
          ep = { carrier: c, side, start: at, period: e.period, t: e.t, corner: false, passAt: null, done: false, caughtN: 0 }
          cand = null
        }
      } else cand = null
    }
  }
  if (ep) close(ep.passAt !== null ? 'passedOff' : 'stalled', 'stream ended')
  return r
}

/** Skaters on both sides (an empty-net run is not a breakaway on the goalie). */
function n5v5Like(f: { home: unknown[]; away: unknown[] }): boolean {
  return f.home.length >= 3 && f.away.length >= 3
}

export function sumCarrierPlay(rs: CarrierPlayReport[]): CarrierPlayReport {
  const t: CarrierPlayReport = {
    passes: 0, pingPong: 0, pingEx: [], breakaways: 0, caught: 0, breakGoals: 0, attacked: 0, fed: 0, passedOff: 0, lost: 0, stalled: 0, corner: 0, breakEx: [], oddMan: 0, oddAttempts: 0,
    attempts: { trailing: 0, leading: 0, tied: 0, trailingLate: 0, leadingLate: 0 },
    byDist: { shots: [0, 0, 0, 0], goals: [0, 0, 0, 0] }
  }
  for (const r of rs) {
    for (let i = 0; i < 4; i++) {
      t.byDist.shots[i]! += r.byDist.shots[i]!
      t.byDist.goals[i]! += r.byDist.goals[i]!
    }
    for (const k of ['passes', 'pingPong', 'breakaways', 'caught', 'breakGoals', 'attacked', 'fed', 'passedOff', 'lost', 'stalled', 'corner', 'oddMan', 'oddAttempts'] as const) t[k] += r[k]
    for (const k of Object.keys(t.attempts) as (keyof CarrierPlayReport['attempts'])[]) t.attempts[k] += r.attempts[k]
    t.pingEx.push(...r.pingEx.slice(0, 2))
    t.breakEx.push(...r.breakEx.slice(0, 2))
  }
  return t
}

/** One line for the harness / test output. */
export function carrierPlayLine(t: CarrierPlayReport, liveMin: number): string {
  const p60 = (n: number): string => ((n / Math.max(liveMin, 1e-9)) * 60).toFixed(2)
  const sh = (a: number, b: number): string => (a + b > 0 ? (a / (a + b)).toFixed(3) : '-')
  return [
    `S5 ping-pong ${t.pingPong} in ${t.passes} completed passes (${((t.pingPong / Math.max(1, t.passes)) * 100).toFixed(2)}%, ${p60(t.pingPong)}/60)`,
    `breakaways ${t.breakaways} (${p60(t.breakaways)}/60, ${t.caught} caught first): attacked ${t.attacked} fed ${t.fed} passed-off ${t.passedOff} lost ${t.lost} stalled ${t.stalled} - net-attack share ${((t.attacked + t.fed) / Math.max(1, t.breakaways)).toFixed(3)} goals ${t.breakGoals} - corner ${t.corner} (${(t.corner / Math.max(1, t.breakaways)).toFixed(3)})`,
    `odd-man entries ${t.oddMan}: shot attempt within ${ODD.windowS}s ${(t.oddAttempts / Math.max(1, t.oddMan)).toFixed(3)}`,
    `shots/goals by distance <10/10-20/20-35/35+: ${t.byDist.shots.join('/')} / ${t.byDist.goals.join('/')} sh% ${t.byDist.shots.map((s, i) => ((t.byDist.goals[i]! / Math.max(1, s)) * 100).toFixed(1)).join('/')}`,
    `5v5 attempt share trailing v leading ${sh(t.attempts.trailing, t.attempts.leading)} (3rd period ${sh(t.attempts.trailingLate, t.attempts.leadingLate)})`
  ].join(' | ')
}
