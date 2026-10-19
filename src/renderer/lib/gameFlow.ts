/**
 * GAME FLOW — the live momentum bar, the shot map and the big-chance alerts
 * for a watched game, read straight off the event stream.
 *
 * Momentum is our own measure, not a copy of anyone's: every event a side
 * makes happen adds pressure (a shot by its danger, a post, a hit, a takeaway,
 * a carry or a pass that lands in the offensive zone, a penalty drawn), and
 * that pressure fades with a 75-second half-life. The bar is the share of the
 * live pressure each side owns. Events in the attacking zone count more than
 * the same event in the neutral zone.
 *
 * Pure: built once per game, then sampled at any playback second.
 */
import type { GameEvent, GameStream } from '@domain'
import { playAbsT, streamPeriodBases } from '@domain'
import { attackSigns, type LiveSide } from '@engine/story/liveStory'

/** Sample spacing of the momentum curve, playback seconds. */
export const MOMENTUM_STEP_S = 2
/** Pressure halves every this many playback seconds. */
export const MOMENTUM_HALF_LIFE_S = 75
/** Damps the bar while little has happened (the first shift isn't a "surge"). */
const MOMENTUM_FLOOR = 2.5
/** A shot this dangerous is a high-danger chance (matchStats' HIGH_DANGER_XG / XG_PER_DANGER). */
export const BIG_CHANCE_DANGER = 0.78

export interface FlowShot {
  absT: number
  period: number
  side: LiveSide
  /** Map coordinates: home always attacks +x, away −x. */
  x: number
  y: number
  result: 'goal' | 'save' | 'miss' | 'block'
  danger: number
  playerId: string
}

export interface BigChance {
  absT: number
  /** Period clock (s elapsed) — what the banner prints. */
  t: number
  period: number
  side: LiveSide
  playerId: string
  /** What made it big, as the alert says it: "Breakaway", "2-on-1", "Off the post". */
  label: string
  danger: number
}

export interface GameFlow {
  /** Momentum per MOMENTUM_STEP_S, −1 (all away) … +1 (all home). */
  momentum: Float32Array
  shots: FlowShot[]
  chances: BigChance[]
  duration: number
}

type Timed = { absT: number; ev: GameEvent }

export function buildGameFlow(stream: GameStream, isHome: (playerId: string) => boolean): GameFlow {
  const bases = streamPeriodBases(stream)
  const sideOf = (pid: string): LiveSide => (isHome(pid) ? 'home' : 'away')
  const signs = attackSigns(stream, (pid) => sideOf(pid))
  const timed: Timed[] = []
  let duration = 0
  for (const ev of stream) {
    const absT = playAbsT(ev, bases)
    duration = Math.max(duration, absT)
    if (ev.type !== 'frame') timed.push({ absT, ev })
  }
  timed.sort((a, b) => a.absT - b.absT)

  /** x relative to this side's attack (+1 = the net it shoots at). */
  const rel = (side: LiveSide, period: number, x: number): number => x * (signs.get(period)?.[side] ?? (side === 'home' ? 1 : -1))
  const toMap = (side: LiveSide, period: number, x: number, y: number): { x: number; y: number } => {
    const r = rel(side, period, x)
    return side === 'home' ? { x: r, y } : { x: -r, y: -y }
  }
  const zoneMult = (side: LiveSide, period: number, x: number): number => (rel(side, period, x) > 0.25 ? 1.5 : rel(side, period, x) < -0.25 ? 0.6 : 1)

  // Pressure contributions.
  const pulses: Array<{ absT: number; side: LiveSide; w: number }> = []
  const push = (absT: number, side: LiveSide, w: number): void => { if (w > 0) pulses.push({ absT, side, w }) }
  const shots: FlowShot[] = []
  const chances: BigChance[] = []
  const other = (s: LiveSide): LiveSide => (s === 'home' ? 'away' : 'home')

  for (let i = 0; i < timed.length; i++) {
    const { absT, ev } = timed[i]!
    switch (ev.type) {
      case 'shot': {
        const side = sideOf(ev.shooter as string)
        // Did it go in? A goal by the same man right after.
        let scored = false
        for (let j = i + 1; j < timed.length && timed[j]!.absT - absT <= 2.5; j++) {
          const n = timed[j]!.ev
          if (n.type === 'goal' && n.scorer === ev.shooter) { scored = true; break }
          if (n.type === 'save' || n.type === 'shot') break
        }
        const m = toMap(side, ev.period, ev.from.x, ev.from.y)
        shots.push({ absT, period: ev.period, side, x: m.x, y: m.y, result: scored ? 'goal' : 'save', danger: ev.danger, playerId: ev.shooter as string })
        push(absT, side, 1 + 3 * Math.max(0, Math.min(1, ev.danger)))
        if (!scored) {
          const odd = ev.oddMan && ev.oddMan.attackers > ev.oddMan.defenders ? ev.oddMan : null
          let label: string | null = null
          if (odd && odd.defenders === 0 && odd.attackers === 1 && ev.danger >= 0.4) label = 'Breakaway'
          else if (odd && ev.danger >= 0.45) label = `${odd.attackers}-on-${odd.defenders}`
          else if (ev.origin === 'rebound' && ev.danger >= 0.6) label = 'Rebound chance'
          else if (ev.danger >= BIG_CHANCE_DANGER) label = 'Grade-A chance'
          if (label) chances.push({ absT, t: ev.t, period: ev.period, side, playerId: ev.shooter as string, label, danger: ev.danger })
        }
        break
      }
      case 'goal': {
        const side = sideOf(ev.scorer as string)
        push(absT, side, 3)
        // A goal with no shot event in front of it still goes on the map.
        const prev = shots[shots.length - 1]
        if (!prev || prev.playerId !== ev.scorer || absT - prev.absT > 2.5) {
          const m = toMap(side, ev.period, ev.pos.x, ev.pos.y)
          shots.push({ absT, period: ev.period, side, x: m.x, y: m.y, result: 'goal', danger: 1, playerId: ev.scorer as string })
        }
        break
      }
      case 'missedShot': {
        const side = sideOf(ev.shooter as string)
        const m = toMap(side, ev.period, ev.from.x, ev.from.y)
        shots.push({ absT, period: ev.period, side, x: m.x, y: m.y, result: 'miss', danger: 0, playerId: ev.shooter as string })
        push(absT, side, ev.result === 'post' ? 1.4 : 0.6)
        if (ev.result === 'post') chances.push({ absT, t: ev.t, period: ev.period, side, playerId: ev.shooter as string, label: 'Off the post', danger: 0.8 })
        break
      }
      case 'blockedShot': {
        const side = sideOf(ev.shooter as string)
        const m = toMap(side, ev.period, ev.pos.x, ev.pos.y)
        shots.push({ absT, period: ev.period, side, x: m.x, y: m.y, result: 'block', danger: 0, playerId: ev.shooter as string })
        push(absT, side, 0.4)
        break
      }
      case 'hit': {
        const side = sideOf(ev.by as string)
        push(absT, side, (0.3 + ((ev.force ?? 0) > 0.7 ? 0.25 : 0)) * zoneMult(side, ev.period, ev.pos.x))
        break
      }
      case 'takeaway': {
        const side = sideOf(ev.by as string)
        push(absT, side, 0.5 * zoneMult(side, ev.period, ev.pos.x))
        break
      }
      case 'giveaway': {
        const side = other(sideOf(ev.player as string))
        push(absT, side, 0.4)
        break
      }
      case 'penalty':
        push(absT, other(sideOf(ev.player as string)), 0.8)
        break
      case 'carry': {
        const side = sideOf(ev.player as string)
        if (rel(side, ev.period, ev.to.x) > 0.25) push(absT, side, 0.12)
        break
      }
      case 'pass': {
        if (!ev.completed) break
        const side = sideOf(ev.from as string)
        if (rel(side, ev.period, ev.b.x) > 0.25) push(absT, side, 0.12)
        break
      }
      case 'faceoff': {
        if (ev.zone === 'offensive') push(absT, sideOf(ev.winner as string), 0.3)
        break
      }
      case 'fight': {
        // Winning a fight lifts the bench (when the linesmen part them); a draw lifts nobody.
        if (ev.winner) push(absT + ev.separateAt, sideOf(ev.winner as string), ev.down ? 1.8 : 1.2)
        break
      }
    }
  }

  // Dedupe chances: one alert per side per five seconds (the biggest).
  chances.sort((a, b) => a.absT - b.absT)
  const merged: BigChance[] = []
  for (const c of chances) {
    const last = merged[merged.length - 1]
    if (last && last.side === c.side && c.absT - last.absT < 5) {
      if (c.danger > last.danger) merged[merged.length - 1] = c
      continue
    }
    merged.push(c)
  }

  // Sample the decaying pressure.
  pulses.sort((a, b) => a.absT - b.absT)
  const n = Math.max(1, Math.ceil(duration / MOMENTUM_STEP_S) + 1)
  const momentum = new Float32Array(n)
  const decay = Math.pow(0.5, MOMENTUM_STEP_S / MOMENTUM_HALF_LIFE_S)
  let h = 0
  let a = 0
  let k = 0
  for (let i = 0; i < n; i++) {
    const t = i * MOMENTUM_STEP_S
    h *= decay
    a *= decay
    while (k < pulses.length && pulses[k]!.absT <= t) {
      const p = pulses[k++]!
      if (p.side === 'home') h += p.w
      else a += p.w
    }
    momentum[i] = (h - a) / (h + a + MOMENTUM_FLOOR)
  }
  return { momentum, shots, chances: merged, duration }
}

/** Momentum at a playback second: −1 (away) … +1 (home). */
export function momentumAt(flow: GameFlow, absT: number): number {
  if (flow.momentum.length === 0) return 0
  const i = Math.max(0, Math.min(flow.momentum.length - 1, Math.floor(absT / MOMENTUM_STEP_S)))
  return flow.momentum[i]!
}

/** The shots taken by `absT`. */
export function shotsUpTo(flow: GameFlow, absT: number): FlowShot[] {
  let hi = flow.shots.length
  let lo = 0
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (flow.shots[mid]!.absT <= absT) lo = mid + 1
    else hi = mid
  }
  return flow.shots.slice(0, lo)
}

/** Big chances strictly after `from`, up to and including `to`. */
export function chancesBetween(flow: GameFlow, from: number, to: number): BigChance[] {
  return flow.chances.filter((c) => c.absT > from && c.absT <= to)
}
