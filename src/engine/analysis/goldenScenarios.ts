/**
 * Golden-scenario finder (W0/W1 viewer-truth reel, docs/gameplan-2026-09-28).
 *
 * Locates, in one simulated game's stream, the first clean instance of each of
 * the ten moments the owner judges a watched game by. A scenario is pinned as
 * (save, home, away, seed, engine, absT) so every build replays the SAME ten
 * moments; this module only reads the stream (engine-agnostic: both engines
 * emit the same GameEvent contract, the agent engine just adds richer fields,
 * which are preferred when present).
 *
 * Pure: no sim, no DOM. The worker runs it over freshly simmed games (dev only).
 */
import type { GameEvent, GameStream } from '@domain/events'

export type ScenarioKind =
  | 'breakaway'
  | 'twoOnOne'
  | 'ozCycleShot'
  | 'ppSetPlay'
  | 'goalReplay'
  | 'lineChangeOnFly'
  | 'faceoffWinPlay'
  | 'bigHit'
  | 'saveRebound'
  | 'emptyNetLate'

export const SCENARIO_KINDS: readonly ScenarioKind[] = [
  'breakaway', 'twoOnOne', 'ozCycleShot', 'ppSetPlay', 'goalReplay',
  'lineChangeOnFly', 'faceoffWinPlay', 'bigHit', 'saveRebound', 'emptyNetLate',
]

/** Human label + how much game time to show around the moment (lead before, tail after).
 *  Full mode plays live hockey at 2×, so 16 game-s of lead is ~8 s on screen. */
export const SCENARIO_META: Record<ScenarioKind, { label: string; lead: number; tail: number }> = {
  breakaway:       { label: 'Breakaway',                      lead: 16,  tail: 5 },
  twoOnOne:        { label: '2-on-1 rush',                    lead: 14,  tail: 5 },
  ozCycleShot:     { label: 'Offensive-zone cycle into a shot', lead: 20, tail: 5 },
  ppSetPlay:       { label: 'Power-play set play',            lead: 22, tail: 5 },
  // the goal clip must cover the celebration and the instant replay (wall-timed)
  goalReplay:      { label: 'Goal + celebration + replay',    lead: 12,  tail: 8 },
  lineChangeOnFly: { label: 'Line change on the fly',         lead: 10,  tail: 12 },
  faceoffWinPlay:  { label: 'Faceoff win into play',          lead: 4,  tail: 16 },
  bigHit:          { label: 'Big hit',                        lead: 12,  tail: 8 },
  saveRebound:     { label: 'Goalie save + rebound',          lead: 10,  tail: 8 },
  emptyNetLate:    { label: 'Empty net / late game',          lead: 10,  tail: 20 },
}

export interface ScenarioHit {
  kind: ScenarioKind
  /** Absolute game second of the moment itself (the shot, the hit, the goal…). */
  absT: number
  period: number
  /** Which side the moment belongs to (attacking / hitting / changing team). */
  side: 'home' | 'away'
  /** Short description for the reel ("2-on-1, #id shoots, saved"). */
  note: string
  /** Higher = cleaner instance (used to pick between candidates). */
  quality: number
}

const REG = 1200

/** Absolute clock base of each period (regulation 1200 s; OT length from the stream). */
export function periodBaseMap(stream: GameStream): Map<number, number> {
  const maxT = new Map<number, number>()
  for (const ev of stream) maxT.set(ev.period, Math.max(maxT.get(ev.period) ?? 0, ev.t))
  const out = new Map<number, number>()
  let base = 0
  for (const p of [...maxT.keys()].sort((a, b) => a - b)) {
    out.set(p, base)
    base += p <= 3 ? REG : (maxT.get(p) ?? REG)
  }
  if (!out.has(1)) out.set(1, 0)
  return out
}

interface Timed { ev: GameEvent; abs: number }

/**
 * Every scenario instance in one game (all candidates, best first per kind).
 * `isHome` classifies a player id; `prefer` (optional) is the side whose
 * moments rank first (the user's club — the team the owner watches).
 */
export function findScenarios(
  stream: GameStream,
  isHome: (id: string) => boolean,
  prefer?: 'home' | 'away',
  homeTeamId?: string,
): ScenarioHit[] {
  const bases = periodBaseMap(stream)
  const evs: Timed[] = []
  for (const ev of stream) {
    if (ev.type === 'frame') continue
    evs.push({ ev, abs: (bases.get(ev.period) ?? (ev.period - 1) * REG) + ev.t })
  }
  evs.sort((a, b) => a.abs - b.abs)
  const sideOf = (id: string): 'home' | 'away' => (isHome(id) ? 'home' : 'away')
  const out: ScenarioHit[] = []
  const push = (h: ScenarioHit): void => {
    out.push({ ...h, quality: h.quality + (prefer && h.side === prefer ? 0.5 : 0) })
  }
  const stopBetween = (from: number, to: number): boolean =>
    evs.some((x) => x.abs > from && x.abs < to && (x.ev.type === 'whistle' || x.ev.type === 'periodEnd' || x.ev.type === 'faceoff' || x.ev.type === 'goal'))
  const passesBy = (side: 'home' | 'away', from: number, to: number, ozSign?: number): number =>
    evs.filter((x) => x.abs >= from && x.abs <= to && x.ev.type === 'pass' && x.ev.completed && sideOf(x.ev.from) === side &&
      (ozSign === undefined || (x.ev.a.x * ozSign > 0.25 && x.ev.b.x * ozSign > 0.25))).length

  // Power-play windows: a penalty puts the OTHER side on the power play.
  const pp: Array<{ side: 'home' | 'away'; from: number; to: number }> = []
  for (const x of evs) {
    if (x.ev.type !== 'penalty') continue
    const to = x.abs + Math.max(2, x.ev.minutes) * 60
    pp.push({ side: sideOf(x.ev.player) === 'home' ? 'away' : 'home', from: x.abs, to })
  }
  const onPP = (side: 'home' | 'away', t: number): boolean => pp.some((w) => w.side === side && t > w.from && t < w.to)

  // Outcome of a shot (the next save / goal within 2 s).
  const outcome = (i: number): string => {
    const t = evs[i]!.abs
    for (let j = i + 1; j < evs.length && evs[j]!.abs <= t + 2; j++) {
      const ty = evs[j]!.ev.type
      if (ty === 'goal') return 'goal'
      if (ty === 'save') return 'saved'
    }
    return 'no save/goal'
  }

  evs.forEach((x, i) => {
    const ev = x.ev
    const t = x.abs
    if (ev.type === 'shot') {
      const side = sideOf(ev.shooter)
      const sign = Math.sign(ev.target.x) || 1
      const res = outcome(i)
      const scored = res === 'goal' ? 1 : 0
      if (ev.oddMan?.attackers === 1 && ev.oddMan.defenders === 0) {
        push({ kind: 'breakaway', absT: t, period: ev.period, side, note: `breakaway, ${res}`, quality: 1 + scored * 0.3 })
      }
      if (ev.oddMan?.attackers === 2 && ev.oddMan.defenders === 1) {
        push({ kind: 'twoOnOne', absT: t, period: ev.period, side, note: `2-on-1, ${res}`, quality: 1 + scored * 0.3 })
      }
      // Cycle: sustained OZ possession — ≥3 completed OZ passes in 12 s, no whistle.
      const ozPasses = passesBy(side, t - 12, t, sign)
      if (!stopBetween(t - 12, t) && (ev.origin === 'cycle' || ozPasses >= 3)) {
        push({ kind: 'ozCycleShot', absT: t, period: ev.period, side, note: `OZ cycle (${ozPasses} passes${ev.origin ? `, origin ${ev.origin}` : ''}), ${res}`, quality: 0.6 + Math.min(ozPasses, 6) * 0.1 + (ev.origin === 'cycle' ? 0.3 : 0) })
      }
      // PP set play: on the power play, ≥3 completed OZ passes in 15 s, no whistle.
      if (onPP(side, t)) {
        const ppPasses = passesBy(side, t - 15, t, sign)
        if (ppPasses >= 3 && !stopBetween(t - 15, t)) {
          push({ kind: 'ppSetPlay', absT: t, period: ev.period, side, note: `PP set play (${ppPasses} OZ passes), ${res}`, quality: 0.8 + Math.min(ppPasses, 6) * 0.1 + scored * 0.3 })
        }
      }
    } else if (ev.type === 'goal') {
      const side = sideOf(ev.scorer)
      if (ev.strength === 'en') {
        push({ kind: 'emptyNetLate', absT: t, period: ev.period, side, note: 'empty-net goal', quality: 1.2 })
      } else {
        push({ kind: 'goalReplay', absT: t, period: ev.period, side, note: `${ev.strength} goal`, quality: ev.strength === 'ev' ? 1 : 0.8 })
      }
    } else if (ev.type === 'lineChange') {
      const side = homeTeamId !== undefined ? ((ev.team as string) === homeTeamId ? 'home' : 'away') : isHome((ev.onIce[0] as string | undefined) ?? '') ? 'home' : 'away'
      // classic engine: no onTheFly flag — a change away from any whistle/faceoff is on the fly
      const fly = ev.onTheFly ?? !stopBetween(t - 3, t + 1)
      if (fly && ev.period <= 3) {
        push({ kind: 'lineChangeOnFly', absT: t, period: ev.period, side, note: `on-the-fly change${ev.onTheFly === undefined ? ' (inferred)' : ''}`, quality: 1 })
      }
    } else if (ev.type === 'faceoff') {
      const side = sideOf(ev.winner)
      // the draw goes back and a play follows: a completed pass by the winners
      // within 4 s and a shot within 12 s, uninterrupted
      const pass = evs.find((y) => y.abs > t && y.abs <= t + 4 && y.ev.type === 'pass' && y.ev.completed && sideOf(y.ev.from) === side)
      const shot = evs.find((y) => y.abs > t && y.abs <= t + 12 && y.ev.type === 'shot' && sideOf(y.ev.shooter) === side)
      if (pass && shot && !stopBetween(t, shot.abs)) {
        push({ kind: 'faceoffWinPlay', absT: t, period: ev.period, side, note: `${ev.zone} faceoff win → shot in ${(shot.abs - t).toFixed(1)} s`, quality: 1 + (ev.zone === 'offensive' ? 0.2 : 0) })
      }
    } else if (ev.type === 'hit') {
      const side = sideOf(ev.by)
      const q = (ev.force ?? 0.5) + (ev.knockdown ? 1 : 0) + (ev.kind === 'openIce' ? 0.3 : 0) + (ev.targetHadPuck ? 0.2 : 0)
      push({ kind: 'bigHit', absT: t, period: ev.period, side, note: `${ev.kind ?? 'hit'}${ev.force !== undefined ? ` force ${ev.force.toFixed(2)}` : ''}${ev.knockdown ? ', knockdown' : ''}`, quality: q })
    } else if (ev.type === 'save' && ev.rebound) {
      const side = sideOf(ev.goalie)
      const shooting: 'home' | 'away' = side === 'home' ? 'away' : 'home'
      const again = evs.find((y) => y.abs > t && y.abs <= t + 4 && (y.ev.type === 'shot' || y.ev.type === 'missedShot') && sideOf(y.ev.shooter) === shooting)
      if (again) push({ kind: 'saveRebound', absT: t, period: ev.period, side: shooting, note: `save, rebound, second attempt ${(again.abs - t).toFixed(1)} s later`, quality: 1.2 })
    }
  })

  // Late game with the goalie pulled (no empty-net goal needed): a team with
  // six skaters on the ice in the last 3 minutes of regulation.
  if (!out.some((h) => h.kind === 'emptyNetLate')) {
    for (const ev of stream) {
      if (ev.type !== 'frame' || ev.period !== 3 || ev.t < REG - 180) continue
      const side = ev.home.length >= 6 ? 'home' : ev.away.length >= 6 ? 'away' : null
      if (!side) continue
      push({ kind: 'emptyNetLate', absT: (bases.get(3) ?? 2 * REG) + ev.t, period: 3, side, note: 'goalie pulled, extra attacker', quality: 1 })
      break
    }
  }

  // best first per kind; ties → earliest
  return out.sort((a, b) => (a.kind === b.kind ? b.quality - a.quality || a.absT - b.absT : SCENARIO_KINDS.indexOf(a.kind) - SCENARIO_KINDS.indexOf(b.kind)))
}

/** The single best instance of each kind in one game. */
export function bestPerKind(hits: readonly ScenarioHit[]): Map<ScenarioKind, ScenarioHit> {
  const m = new Map<ScenarioKind, ScenarioHit>()
  for (const h of hits) {
    const cur = m.get(h.kind)
    if (!cur || h.quality > cur.quality || (h.quality === cur.quality && h.absT < cur.absT)) m.set(h.kind, h)
  }
  return m
}

/** A scenario pinned for the reel: replaying (pair, seed, engine) on the same save reproduces it. */
export interface PinnedScenario extends ScenarioHit {
  label: string
  engine: 'classic' | 'agent'
  homeId: string
  awayId: string
  homeAbbr: string
  awayAbbr: string
  seed: number
  /** Stream fingerprint (event count · final score) — the replay must match it. */
  fingerprint: string
  /** Clip window, absolute game seconds. */
  clipFrom: number
  clipTo: number
}

/** Event count + final score: cheap proof that a re-simmed game is the pinned one. */
export function streamFingerprint(stream: GameStream, isHome: (id: string) => boolean): string {
  let h = 0
  let a = 0
  for (const ev of stream) if (ev.type === 'goal') { if (isHome(ev.scorer)) h++; else a++ }
  return `${stream.length}·${h}-${a}`
}
