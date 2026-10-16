/**
 * Where a faceoff belongs (NHL rule 76), judged from the stoppage alone — the
 * owner's reel S2 notes on ozCycleShot and faceoffWinPlay: "they're not
 * dropping on the faceoff dot". Shared by the sim-stream gate (agentSim.test)
 * and VT7 on the drawn screen, so the sim and the picture are held to the
 * same dot.
 *
 *  - a period start or a goal: centre ice;
 *  - offside (carried, or a delayed-offside touch): the neutral-zone dot on
 *    the side of the zone the play was in (rule 83.4: outside that zone);
 *  - a delayed-offside shot on goal, icing, a penalty: the offending side's
 *    end, on the puck's side;
 *  - a goalie freeze: that goalie's end, the puck's side;
 *  - anything else (over the glass, pinned on the boards, a fight, a misc
 *    whistle): the dot in the ZONE the puck was in, on its side — an end-zone
 *    stoppage never comes out to a neutral-zone dot.
 *
 * Geometry is rink feet: x ±100 goal to goal, y ±42.5, blue lines at ±25.
 */
import type { GameStream, StoppageDetail } from '@domain'
import { playAbsT, streamPeriodBases } from '@domain'

export type DotKind = 'centre' | 'neutral' | 'end'
export interface DotSpec {
  kind: DotKind
  /** End (or half) of the rink: −1 / +1 (0 for centre). */
  xs: number
  /** Side: −1 / +1 (0 for centre). */
  ys: number
}

/** The dots as the 3D sheet draws them (iceCanvas: NHL geometry, end dots 20 ft off the goal line, 44 ft apart). */
export const DRAWN_DOTS = { endX: 69, neutralX: 20, y: 22 } as const

export function dotXY(d: DotSpec, g: { endX: number; neutralX: number; y: number } = DRAWN_DOTS): { x: number; y: number } {
  if (d.kind === 'centre') return { x: 0, y: 0 }
  return { x: d.xs * (d.kind === 'end' ? g.endX : g.neutralX), y: d.ys * g.y }
}

const sgn = (v: number): number => (v < 0 ? -1 : 1)

/**
 * The dot rule. `pos` is where play stopped (ft), `defends` the end the
 * team named on the stoppage defends (−1 / +1; needed for a penalty whose
 * whistle can come anywhere on the ice).
 */
export function expectedDot(detail: StoppageDetail | undefined, reason: string | undefined, pos: { x: number; y: number }, defends: number | null): DotSpec | null {
  const ys = sgn(pos.y)
  switch (detail ?? reason) {
    case 'goal':
      return { kind: 'centre', xs: 0, ys: 0 }
    case 'offsideCarried':
    case 'offsideTouch':
      return { kind: 'neutral', xs: sgn(pos.x), ys }
    case 'offsideShot':
    case 'icing':
      // the whistle is in the offending side's ATTACKING end: the draw comes back to the other one
      return { kind: 'end', xs: -sgn(pos.x), ys }
    case 'goalieFreeze':
      return { kind: 'end', xs: sgn(pos.x), ys }
    case 'penalty':
      return defends === null ? null : { kind: 'end', xs: defends, ys }
    case 'puckOutOfPlay':
    case 'boardPin':
    case 'misc':
    case 'fight':
      return Math.abs(pos.x) > 25 ? { kind: 'end', xs: sgn(pos.x), ys } : { kind: 'neutral', xs: sgn(pos.x), ys }
    default:
      return null // an old stream with no detail: not judged
  }
}

export interface FaceoffJudged {
  /** absolute playback s of the drop */
  t: number
  period: number
  expected: DotSpec
  /** where the stream dropped it (ft) */
  at: { x: number; y: number }
  what: string
}

/**
 * Every faceoff in a sim stream with the dot it should have been at (by the
 * stoppage before it, or centre ice to open a period / after a goal), in the
 * engine's own dot geometry (`g`). `wrong` lists drops more than 2 ft off.
 */
export function judgeFaceoffDots(stream: GameStream, g: { endX: number; neutralX: number; y: number } = DRAWN_DOTS): { judged: FaceoffJudged[]; wrong: FaceoffJudged[]; unjudged: number; expectations: (DotSpec | null)[] } {
  const expectations: (DotSpec | null)[] = []
  const bases = streamPeriodBases(stream)
  const judged: FaceoffJudged[] = []
  const wrong: FaceoffJudged[] = []
  let unjudged = 0
  let last: { detail?: StoppageDetail | undefined; reason?: string | undefined; x: number; y: number; team?: string | undefined } | null = null
  let lastPeriod = 0
  // the end each side's goalie stands in (frames) = the end it defends; a
  // team id is tied to a side through its line changes' players
  const sideEnd = { home: 1, away: -1 }
  const sideOf = new Map<string, 'home' | 'away'>()
  const teamSide = new Map<string, 'home' | 'away'>()
  for (const e of stream) {
    if (e.type === 'lineChange') {
      for (const id of e.onIce) {
        const sd = sideOf.get(id as string)
        if (sd) { teamSide.set(e.team as string, sd); break }
      }
    }
    if (e.type === 'frame') {
      sideEnd.home = sgn(e.homeGoalie.pos.x)
      sideEnd.away = sgn(e.awayGoalie.pos.x)
      for (const sk of e.home) sideOf.set(sk.player as string, 'home')
      for (const sk of e.away) sideOf.set(sk.player as string, 'away')
      continue
    }
    if (e.period !== lastPeriod) {
      lastPeriod = e.period
      last = { detail: 'goal', x: 0, y: 0 } // a period opens at centre ice
    }
    if (e.type === 'whistle') {
      last = { detail: e.detail, reason: e.reason, x: (e.pos?.x ?? 0) * 100, y: (e.pos?.y ?? 0) * 42.5, team: e.team as string | undefined }
    } else if (e.type === 'faceoff') {
      const at = { x: e.pos.x * 100, y: e.pos.y * 42.5 }
      let defends: number | null = null
      if (last?.team !== undefined) defends = teamEnd(last.team)
      const exp = last ? expectedDot(last.detail, last.reason, last, defends) : null
      expectations.push(exp)
      if (!exp) {
        unjudged++
      } else {
        const want = dotXY(exp, g)
        const off = Math.hypot(at.x - want.x, at.y - want.y)
        const j: FaceoffJudged = {
          t: playAbsT(e, bases),
          period: e.period,
          expected: exp,
          at,
          what: `P${e.period} ${fmt(e.t)} faceoff after ${last?.detail ?? last?.reason ?? '?'} at (${at.x.toFixed(0)}, ${at.y.toFixed(0)}): the ${exp.kind} dot ${exp.kind === 'centre' ? '' : `(${want.x}, ${want.y}) `}is ${off.toFixed(1)} ft away`,
        }
        judged.push(j)
        if (off > 2) wrong.push(j)
      }
      last = null
    }
  }
  return { judged, wrong, unjudged, expectations }

  function teamEnd(team: string): number | null {
    const sd = teamSide.get(team)
    return sd ? sideEnd[sd] : null
  }
}

const fmt = (t: number): string => {
  const r = Math.max(0, 1200 - t)
  return `${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`
}
