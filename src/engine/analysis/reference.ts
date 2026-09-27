/**
 * REFERENCE REPLAY — turn a real (or textbook) tracked sequence into our own
 * event-stream frame format, so it plays in the existing 2D/3D renderers and
 * can be set side by side with a sim sequence in the same situation for the
 * owner's eye test.
 *
 * Contract-safe: the output uses ONLY the existing FrameEvent / FaceoffEvent /
 * StoppageEvent shapes — nothing is added to src/domain/events.ts.
 *
 * Inputs:
 *   - TrackedSequence: a neutral per-frame tracking format (feet, origin centre
 *     ice). Any licensed or self-captured tracking source (e.g. the CV pipeline
 *     in docs/MATCH-DATA-SOURCES.md, run on footage we have rights to) is
 *     converted into this first. Third-party data never goes into git unless
 *     its licence allows redistribution — the repo is public.
 *   - templateSequence(): a keyframed "textbook" sequence built from the
 *     coaching-system templates in shapes.ts (our own coordinates), usable
 *     today while no licensed tracking exists.
 */
import type { FrameEvent, GameEvent, GameStream, PlayerId, SkaterSnapshot, XY } from '@domain'
import { GOAL_LINE_FT, HALF_LENGTH_FT, HALF_WIDTH_FT } from './rink'
import { SHAPE_TEMPLATES, type ShapeTemplate } from './shapes'

export interface TrackedPlayer {
  id: string
  team: 'home' | 'away'
  /** 'G' marks the goalie; F/D optional (used for labels only). */
  role?: 'F' | 'D' | 'G'
  x: number
  y: number
}

export interface TrackedFrame {
  /** Seconds from the start of the sequence. */
  t: number
  /** Puck position (ft, origin centre ice, +x = the end HOME attacks). */
  puck: XY
  carrier?: string | null
  players: TrackedPlayer[]
}

export interface TrackedSequence {
  id: string
  /** Where the data came from + its licence (kept with the data, never lost). */
  source: string
  license: string
  frames: TrackedFrame[]
}

const toUnit = (p: XY): XY => ({
  x: Math.max(-1, Math.min(1, p.x / HALF_LENGTH_FT)),
  y: Math.max(-1, Math.min(1, p.y / HALF_WIDTH_FT))
})

/** Convert a tracked sequence into a playable GameStream (period 1, clock from 0). */
export function trackingToStream(seq: TrackedSequence, period = 1): GameStream {
  const out: GameEvent[] = []
  if (seq.frames.length === 0) return out
  const first = seq.frames[0]
  const t0 = first.t
  // Mark play live at the start so consumers (timeline, analyzer) treat it as live.
  const opener = first.carrier ?? first.players.find((p) => p.role !== 'G')?.id ?? 'ref-none'
  out.push({ t: 0, period, type: 'faceoff', zone: 'neutral', winner: opener as PlayerId, pos: toUnit(first.puck) })
  for (const f of seq.frames) {
    const snap = (team: 'home' | 'away'): SkaterSnapshot[] =>
      f.players
        .filter((p) => p.team === team && p.role !== 'G')
        .map((p) => ({ player: p.id as PlayerId, pos: toUnit({ x: p.x, y: p.y }) }))
    const goalie = (team: 'home' | 'away'): SkaterSnapshot => {
      const g = f.players.find((p) => p.team === team && p.role === 'G')
      // Home defends -x in this frame convention; place a stand-in goalie in the crease.
      const x = team === 'home' ? -GOAL_LINE_FT + 3 : GOAL_LINE_FT - 3
      return g
        ? { player: g.id as PlayerId, pos: toUnit({ x: g.x, y: g.y }) }
        : { player: `ref-${team}-G` as PlayerId, pos: toUnit({ x, y: 0 }) }
    }
    const ev: FrameEvent = {
      t: f.t - t0,
      period,
      type: 'frame',
      home: snap('home'),
      away: snap('away'),
      homeGoalie: goalie('home'),
      awayGoalie: goalie('away'),
      puck: toUnit(f.puck),
      puckCarrier: (f.carrier ?? null) as PlayerId | null
    }
    out.push(ev)
  }
  const last = seq.frames[seq.frames.length - 1]
  out.push({ t: last.t - t0, period, type: 'whistle', reason: 'other', pos: toUnit(last.puck) })
  return out
}

const smooth = (f: number): number => f * f * (3 - 2 * f)

/**
 * A keyframed textbook sequence through a chain of templates (e.g. breakout →
 * regroup → rush entry → low cycle). HOME possesses and attacks +x; roles are
 * matched by index between consecutive templates, the puck carrier is the first
 * attack role of each template. `holdS` seconds on each picture, `moveS`
 * seconds of smooth transition between pictures.
 */
export function templateSequence(
  ids: readonly string[],
  opts: { fps?: number; holdS?: number; moveS?: number; templates?: readonly ShapeTemplate[] } = {}
): TrackedSequence {
  const fps = opts.fps ?? 10
  const holdS = opts.holdS ?? 1
  const moveS = opts.moveS ?? 2.5
  const lib = opts.templates ?? SHAPE_TEMPLATES
  const chain = ids.map((id) => {
    const t = lib.find((x) => x.id === id)
    if (!t) throw new Error(`templateSequence: unknown template ${id}`)
    return t
  })
  const frames: TrackedFrame[] = []
  const homeIds = [0, 1, 2, 3, 4].map((i) => `ref-h${i}`)
  const awayIds = [0, 1, 2, 3, 4].map((i) => `ref-a${i}`)
  const picture = (t: ShapeTemplate) => ({
    puck: t.puck,
    home: t.attack.map((r) => ({ x: r.x, y: r.y })),
    away: t.defend.map((r) => ({ x: r.x, y: r.y }))
  })
  let clock = 0
  const emit = (p: ReturnType<typeof picture>, carrier: string | null): void => {
    frames.push({
      t: +clock.toFixed(3),
      puck: { ...p.puck },
      carrier,
      players: [
        ...p.home.map((q, i) => ({ id: homeIds[i], team: 'home' as const, role: (i < 3 ? 'F' : 'D') as 'F' | 'D', x: q.x, y: q.y })),
        ...p.away.map((q, i) => ({ id: awayIds[i], team: 'away' as const, role: (i < 3 ? 'F' : 'D') as 'F' | 'D', x: q.x, y: q.y }))
      ]
    })
    clock += 1 / fps
  }
  for (let k = 0; k < chain.length; k++) {
    const a = picture(chain[k])
    for (let i = 0; i < Math.round(holdS * fps); i++) emit(a, homeIds[0])
    if (k === chain.length - 1) break
    const b = picture(chain[k + 1])
    const n = Math.round(moveS * fps)
    for (let i = 1; i <= n; i++) {
      const f = smooth(i / n)
      const lerp = (p: XY, q: XY): XY => ({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f })
      const len = Math.min(a.home.length, b.home.length)
      const alen = Math.min(a.away.length, b.away.length)
      emit(
        {
          puck: lerp(a.puck, b.puck),
          home: Array.from({ length: len }, (_, j) => lerp(a.home[j], b.home[j])),
          away: Array.from({ length: alen }, (_, j) => lerp(a.away[j], b.away[j]))
        },
        homeIds[0]
      )
    }
  }
  return {
    id: `template:${ids.join('>')}`,
    source: 'Textbook template chain from src/engine/analysis/shapes.ts (our own coordinates)',
    license: 'Our own work',
    frames
  }
}

/**
 * Find the first live frame in a stream where a template's situation occurs
 * (possessing team, strength, puck within the template radius) and return a
 * window of the stream around it, re-based to t = 0, as a standalone stream.
 * With `normalize` (default true) the clip's frames are rotated/swapped so the
 * possessing team is HOME attacking +x — the same picture as a textbook
 * reference — which makes a side-by-side eye test read at a glance.
 */
export function findSituationClip(
  stream: GameStream,
  template: ShapeTemplate,
  opts: { beforeS?: number; afterS?: number; skip?: number; normalize?: boolean } = {}
): { stream: GameStream; atT: number; period: number } | null {
  const before = opts.beforeS ?? 2
  const after = opts.afterS ?? 6
  let skip = opts.skip ?? 0
  const teamOf = new Map<string, 'home' | 'away'>()
  for (const ev of stream) {
    if (ev.type !== 'frame') continue
    for (const s of ev.home) teamOf.set(s.player, 'home')
    for (const s of ev.away) teamOf.set(s.player, 'away')
  }
  let live = false
  let lastHit = -Infinity
  for (let i = 0; i < stream.length; i++) {
    const ev = stream[i]
    if (ev.type === 'faceoff') live = true
    else if (ev.type === 'whistle' || ev.type === 'periodEnd' || ev.type === 'gameEnd') live = false
    if (ev.type !== 'frame' || !live || !ev.puckCarrier) continue
    const side = teamOf.get(ev.puckCarrier)
    if (!side) continue
    const att = side === 'home' ? ev.home : ev.away
    const def = side === 'home' ? ev.away : ev.home
    const strength = att.length === 5 && def.length === 5 ? '5v5' : att.length === 5 && def.length === 4 ? '5v4' : null
    if (strength !== template.strength) continue
    // Attack sign from the defending goalie's end.
    const defG = side === 'home' ? ev.awayGoalie : ev.homeGoalie
    const a = defG.pos.x >= 0 ? 1 : -1
    const px = ev.puck.x * HALF_LENGTH_FT * a
    const py = ev.puck.y * HALF_WIDTH_FT * a
    const flip = py < 0 ? -1 : 1
    if (Math.hypot(px - template.puck.x, py * flip - template.puck.y) > template.radiusFt) continue
    if (ev.t - lastHit < after) continue
    lastHit = ev.t
    if (skip-- > 0) continue
    const t0 = ev.t - before
    const t1 = ev.t + after
    const clip: GameEvent[] = []
    const norm = opts.normalize ?? true
    const rot = (p: XY): XY => (a === 1 ? p : { x: -p.x, y: -p.y })
    for (const e of stream) {
      if (e.period !== ev.period || e.t < t0 || e.t > t1) continue
      if (e.type === 'gameEnd' || e.type === 'periodEnd') continue
      if (norm && e.type === 'frame') {
        const mine = side === 'home'
        const r = (xs: readonly SkaterSnapshot[]): SkaterSnapshot[] => xs.map((q) => ({ player: q.player, pos: rot(q.pos) }))
        clip.push({
          ...e,
          t: e.t - t0,
          period: 1,
          home: r(mine ? e.home : e.away),
          away: r(mine ? e.away : e.home),
          homeGoalie: { player: (mine ? e.homeGoalie : e.awayGoalie).player, pos: rot((mine ? e.homeGoalie : e.awayGoalie).pos) },
          awayGoalie: { player: (mine ? e.awayGoalie : e.homeGoalie).player, pos: rot((mine ? e.awayGoalie : e.homeGoalie).pos) },
          puck: rot(e.puck)
        })
        continue
      }
      clip.push({ ...e, t: e.t - t0, period: 1 } as GameEvent)
    }
    // Ensure the clip starts live for downstream consumers.
    const firstFrame = clip.find((e) => e.type === 'frame') as FrameEvent | undefined
    if (firstFrame && !clip.some((e) => e.type === 'faceoff' && e.t <= firstFrame.t)) {
      clip.unshift({ t: 0, period: 1, type: 'faceoff', zone: 'neutral', winner: ev.puckCarrier, pos: firstFrame.puck })
    }
    // (Non-frame event positions stay in raw rink coordinates; only frames are normalized.)
    return { stream: clip, atT: ev.t, period: ev.period }
  }
  return null
}
