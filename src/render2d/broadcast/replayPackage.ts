/**
 * THE REPLAY PACKAGE — what the broadcast shows again, from where, and when.
 * Pure and node-testable; MatchViewer plays the clips (seek, slow speed, the
 * 3D replay camera's angle) and hands back to the live moment.
 *
 *  1. GOAL: the main replay (W2/W3 S7 timing: goal −5 s → +1.2 s at 0.6×,
 *     end-zone high then behind the net), then up to two extra angles on the
 *     finish: BEHIND THE NET, and the SHOOTER'S SIDE when the shot came off a
 *     wing. Every clip ends after the puck crosses the line (W2: a replay
 *     always shows the goal).
 *  2. STOPPAGE replays: a big save or a big hit, once, single angle and short,
 *     at the whistle that follows it (never in live play: the viewer holds the
 *     live moment and returns to it).
 *  3. The INTERMISSION reel: a period's top moments (goals first, then big
 *     saves, hits, fights, big chances), from the comprehensive highlight
 *     importance plus a boost the caller may give a moment (the story layer,
 *     rivalry heat).
 *
 * WATCH RULE: nothing here is placed in live play. A goal replay starts once
 * the goal sequence is over; a stoppage replay starts STOPPAGE_REPLAY_DELAY_S
 * after the whistle; the reel runs while the game is at intermission.
 */
import type { GameEvent, GameStream } from '@domain'
import { playAbsT, streamPeriodBases } from '@domain'
import { BIG_HIT_FORCE, BIG_SAVE_DANGER } from '../highlights'

export type ReplayAngleId = 'auto' | 'endZoneHigh' | 'behindNet' | 'shooterSide' | 'tight'
export type ReplayKind = 'goal' | 'bigSave' | 'bigHit' | 'fight' | 'chance'

export interface ReplayClip {
  /** The window replayed (absolute playback s). */
  from: number
  to: number
  /** Playback speed (a replay is presentation, never above 1×). */
  speed: number
  angle: ReplayAngleId
  /** The moment it is about (the goal, the save, the hit, the drop of the gloves). */
  at: number
  /** The net in play, world x sign (+1 = +x end). */
  net: 1 | -1
  /** The shooter's side of the ice, world z sign. */
  side: 1 | -1
  /** A man the camera keeps in frame instead of the puck (a hit: the man hit). */
  subject?: string
  kind: ReplayKind
  /** Scorebug-style label for the clip ("BEHIND THE NET"). */
  angleLabel: string
  /** Who it is about, for the caption (scorer / goalie+shooter / hitter+hit / fighters). */
  who: string[]
  /** "GOAL", "PPG", "SAVE", "HIT", "FIGHT", "OFF THE POST", "BREAKAWAY". */
  tag: string
  period: number
  /** Period clock (s elapsed) of the moment. */
  t: number
}

export const GOAL_REPLAY = { lead: 5, tail: 1.2, speed: 0.6 } as const
/** Extra angles show the finish only. */
export const EXTRA_ANGLE = { lead: 2.6, tail: 0.9, speed: 0.5 } as const
/** A shot from this far off the middle (normalised y) is "off a wing". */
export const WING_Y = 0.15
/** Stoppage replays start this long after the whistle (the call is seen first). */
export const STOPPAGE_REPLAY_DELAY_S = 1.6
/** The whistle must come within this long of the moment. */
export const STOPPAGE_REPLAY_WINDOW_S = 20
/** At most this many stoppage replays a game (the best ones). */
export const STOPPAGE_REPLAYS_MAX = 6

const ANGLE_LABEL: Record<ReplayAngleId, string> = {
  auto: 'REPLAY',
  endZoneHigh: 'END ZONE',
  behindNet: 'BEHIND THE NET',
  shooterSide: "SHOOTER'S SIDE",
  tight: 'CLOSE UP',
}

type Timed = { at: number; ev: GameEvent }

function timeline(stream: GameStream): Timed[] {
  const bases = streamPeriodBases(stream)
  const out: Timed[] = []
  for (const ev of stream) if (ev.type !== 'frame') out.push({ at: playAbsT(ev, bases), ev })
  return out.sort((a, b) => a.at - b.at)
}

const sgn = (v: number): 1 | -1 => (v < 0 ? -1 : 1)

/** The shot a goal or save came off: the last shot within 3 s before it. */
type ShotEv = Extract<GameEvent, { type: 'shot' }>
function shotBefore(tl: Timed[], i: number, shooter?: string): ShotEv | null {
  return shotAtBefore(tl, i, shooter)?.ev ?? null
}
function shotAtBefore(tl: Timed[], i: number, shooter?: string): { ev: ShotEv; at: number } | null {
  const at = tl[i]!.at
  for (let j = i - 1; j >= 0 && at - tl[j]!.at <= 3; j--) {
    const e = tl[j]!.ev
    if (e.type === 'shot' && (!shooter || e.shooter === shooter)) return { ev: e, at: tl[j]!.at }
  }
  return null
}

/**
 * The goal replay package for the goal at `goalAbsT` (the live clock's read of
 * it; the nearest goal event within 3 s is used). `extraAngles` false = the
 * main replay only.
 */
export function goalReplayPackage(stream: GameStream, goalAbsT: number, opts: { extraAngles: boolean }): ReplayClip[] {
  const tl = timeline(stream)
  let gi = -1
  let best = Infinity
  tl.forEach((x, i) => {
    if (x.ev.type !== 'goal') return
    const d = Math.abs(x.at - goalAbsT)
    if (d <= 3 && d < best) { best = d; gi = i }
  })
  const main = (at: number, net: 1 | -1, side: 1 | -1, who: string[], tag: string, period: number, t: number): ReplayClip => ({
    from: Math.max(0, at - GOAL_REPLAY.lead), to: at + GOAL_REPLAY.tail, speed: GOAL_REPLAY.speed, angle: 'auto',
    at, net, side, kind: 'goal', angleLabel: ANGLE_LABEL.auto, who, tag, period, t,
  })
  if (gi < 0) return [main(goalAbsT, 1, 1, [], 'GOAL', 1, 0)]
  const g = tl[gi]!
  const gev = g.ev as Extract<GameEvent, { type: 'goal' }>
  const shot = shotBefore(tl, gi, gev.scorer as string)
  const net = sgn(shot ? shot.target.x : gev.pos.x)
  const side = sgn(shot ? shot.from.y : gev.pos.y)
  const tag = gev.strength === 'pp' ? 'PPG' : gev.strength === 'sh' ? 'SHG' : gev.strength === 'en' ? 'EMPTY NET' : 'GOAL'
  const who = [gev.scorer as string, ...gev.assists.map((a) => a as string)]
  const out: ReplayClip[] = [main(g.at, net, side, who, tag, gev.period, gev.t)]
  // An empty-net goal has nothing behind the net worth a second look.
  if (!opts.extraAngles || gev.strength === 'en') return out
  const extra = (angle: ReplayAngleId): ReplayClip => ({
    from: Math.max(0, g.at - EXTRA_ANGLE.lead), to: g.at + EXTRA_ANGLE.tail, speed: EXTRA_ANGLE.speed, angle,
    at: g.at, net, side, kind: 'goal', angleLabel: ANGLE_LABEL[angle], who, tag, period: gev.period, t: gev.t,
  })
  out.push(extra('behindNet'))
  if (shot && Math.abs(shot.from.y) >= WING_Y) out.push(extra('shooterSide'))
  return out
}

export interface StoppageReplay {
  /** Live clock at which it cuts in (inside the dead window after the whistle). */
  startAt: number
  /** The whistle it belongs to. */
  whistleAt: number
  clip: ReplayClip
  score: number
}

/**
 * Big saves and big hits worth a second look at the next whistle: at most one
 * per stoppage (the better one), never when a goal or a fight came first
 * (those have their own show), the best STOPPAGE_REPLAYS_MAX a game.
 */
export function stoppageReplays(stream: GameStream): StoppageReplay[] {
  const tl = timeline(stream)
  const cands: Array<{ at: number; clip: ReplayClip; score: number }> = []
  for (let i = 0; i < tl.length; i++) {
    const { at, ev } = tl[i]!
    if (ev.type === 'save') {
      const sa = shotAtBefore(tl, i)
      if (!sa || sa.ev.danger < BIG_SAVE_DANGER) continue
      const shot = sa.ev
      const shotAt = sa.at
      cands.push({
        at,
        score: 1 + shot.danger,
        clip: {
          from: Math.max(0, shotAt - 2.5), to: at + 1, speed: 0.6, angle: 'behindNet', at, net: sgn(shot.target.x), side: sgn(shot.from.y),
          kind: 'bigSave', angleLabel: ANGLE_LABEL.behindNet, who: [ev.goalie as string, shot.shooter as string], tag: 'SAVE', period: ev.period, t: ev.t,
        },
      })
    } else if (ev.type === 'hit') {
      const force = ev.force ?? 0
      if (!(force >= BIG_HIT_FORCE && (ev.knockdown || force >= 0.85))) continue
      cands.push({
        at,
        score: 0.8 + force + (ev.knockdown ? 0.3 : 0),
        clip: {
          from: Math.max(0, at - 2), to: at + 1.6, speed: 0.6, angle: 'tight', at, net: sgn(ev.pos.x), side: sgn(ev.pos.y), subject: ev.on as string,
          kind: 'bigHit', angleLabel: ANGLE_LABEL.tight, who: [ev.by as string, ev.on as string], tag: 'HIT', period: ev.period, t: ev.t,
        },
      })
    }
  }
  // Seat each at the next whistle, if one comes soon and nothing bigger got there first.
  const byWhistle = new Map<number, StoppageReplay>()
  for (const c of cands) {
    let wAt: number | null = null
    let spoiled = false
    for (const x of tl) {
      if (x.at < c.at) continue
      if (x.at - c.at > STOPPAGE_REPLAY_WINDOW_S) break
      if (x.ev.type === 'goal' || x.ev.type === 'periodEnd' || x.ev.type === 'gameEnd') { spoiled = true; break }
      if (x.ev.type === 'whistle') { if (x.ev.reason === 'goal') spoiled = true; else wAt = x.at; break }
    }
    if (spoiled || wAt === null) continue
    // a fight at this stoppage is the show
    const fo = tl.find((x) => x.at > wAt! && x.ev.type === 'faceoff')
    if (tl.some((x) => x.at >= wAt! && (!fo || x.at <= fo.at) && x.ev.type === 'fight')) continue
    const prev = byWhistle.get(wAt)
    if (!prev || c.score > prev.score) byWhistle.set(wAt, { startAt: wAt + STOPPAGE_REPLAY_DELAY_S, whistleAt: wAt, clip: c.clip, score: c.score })
  }
  return [...byWhistle.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, STOPPAGE_REPLAYS_MAX)
    .sort((a, b) => a.startAt - b.startAt)
}

/* ─────────────────────────── the intermission reel ─────────────────────────── */

export interface ReelMoment {
  clip: ReplayClip
  /** Ranking within its kind (importance, danger, force; plus the caller's boost). */
  score: number
}

/** A big chance (the viewer's game flow): breakaways, odd-man rushes, posts, grade-A looks. */
export interface ReelChance {
  absT: number
  period: number
  t: number
  playerId: string
  label: string
  danger: number
}

export const REEL_MAX_CLIPS = 6
/** A reel this long (wall s, clip time / speed) is enough; goals always make it. */
export const REEL_MAX_WALL_S = 48
const KIND_ORDER: Record<ReplayKind, number> = { goal: 0, bigSave: 1, bigHit: 2, fight: 3, chance: 4 }

/**
 * The period's top moments, in broadcast order: every goal first (in the
 * order they went in), then the best of the rest — big saves, big hits,
 * fights, big chances — while the reel stays short. `boost(playerIds)` lets
 * the story layer lift a moment about a man with a story tonight.
 */
export function periodReel(
  stream: GameStream,
  period: number,
  opts: { chances?: ReadonlyArray<ReelChance>; boost?: (playerIds: readonly string[], kind: ReplayKind) => number; maxClips?: number; maxWallS?: number } = {},
): ReplayClip[] {
  const tl = timeline(stream)
  const boost = opts.boost ?? (() => 0)
  const goals: ReplayClip[] = []
  const rest: ReelMoment[] = []
  const savesAt: number[] = []
  for (let i = 0; i < tl.length; i++) {
    const { at, ev } = tl[i]!
    if (ev.period !== period) continue
    switch (ev.type) {
      case 'goal': {
        const shot = shotBefore(tl, i, ev.scorer as string)
        const who = [ev.scorer as string, ...ev.assists.map((a) => a as string)]
        goals.push({
          from: Math.max(0, at - 6), to: at + 1.5, speed: 0.8, angle: 'auto', at, net: sgn(shot ? shot.target.x : ev.pos.x), side: sgn(shot ? shot.from.y : ev.pos.y),
          kind: 'goal', angleLabel: ANGLE_LABEL.auto, who, tag: ev.strength === 'pp' ? 'PPG' : ev.strength === 'sh' ? 'SHG' : ev.strength === 'en' ? 'EMPTY NET' : 'GOAL', period, t: ev.t,
        })
        break
      }
      case 'save': {
        const shot = shotBefore(tl, i)
        if (!shot || shot.danger < BIG_SAVE_DANGER) break
        savesAt.push(at)
        const who = [ev.goalie as string, shot.shooter as string]
        rest.push({
          score: 2 + shot.danger + boost(who, 'bigSave'),
          clip: { from: Math.max(0, at - 3.5), to: at + 1, speed: 0.8, angle: 'behindNet', at, net: sgn(shot.target.x), side: sgn(shot.from.y), kind: 'bigSave', angleLabel: ANGLE_LABEL.behindNet, who, tag: 'SAVE', period, t: ev.t },
        })
        break
      }
      case 'hit': {
        const force = ev.force ?? 0
        if (force < BIG_HIT_FORCE) break
        const who = [ev.by as string, ev.on as string]
        rest.push({
          score: 1 + force + (ev.knockdown ? 0.4 : 0) + boost(who, 'bigHit'),
          clip: { from: Math.max(0, at - 2.5), to: at + 1.5, speed: 0.7, angle: 'tight', at, net: sgn(ev.pos.x), side: sgn(ev.pos.y), subject: ev.on as string, kind: 'bigHit', angleLabel: ANGLE_LABEL.tight, who, tag: 'HIT', period, t: ev.t },
        })
        break
      }
      case 'fight': {
        const who = [ev.home as string, ev.away as string]
        rest.push({
          score: 2.2 + boost(who, 'fight'),
          clip: { from: at, to: at + Math.min(9, Math.max(4, ev.separateAt)), speed: 1, angle: 'tight', at, net: sgn(ev.pos.x), side: sgn(ev.pos.y), subject: ev.home as string, kind: 'fight', angleLabel: ANGLE_LABEL.tight, who, tag: 'FIGHT', period, t: ev.t },
        })
        break
      }
    }
  }
  for (const c of opts.chances ?? []) {
    if (c.period !== period) continue
    // a big save is already this chance from the other end
    if (savesAt.some((s) => Math.abs(s - c.absT) < 3)) continue
    const i = tl.findIndex((x) => x.at >= c.absT - 0.01)
    const shot = i >= 0 ? (tl[i]!.ev.type === 'shot' || tl[i]!.ev.type === 'missedShot' ? (tl[i]!.ev as Extract<GameEvent, { type: 'shot' | 'missedShot' }>) : null) : null
    const who = [c.playerId]
    rest.push({
      score: 1 + c.danger + boost(who, 'chance'),
      clip: { from: Math.max(0, c.absT - 4), to: c.absT + 1, speed: 0.8, angle: 'endZoneHigh', at: c.absT, net: sgn(shot ? shot.target.x : 1), side: sgn(shot ? shot.from.y : 1), kind: 'chance', angleLabel: ANGLE_LABEL.endZoneHigh, who, tag: c.label.toUpperCase(), period, t: c.t },
    })
  }
  const maxClips = opts.maxClips ?? REEL_MAX_CLIPS
  const maxWall = opts.maxWallS ?? REEL_MAX_WALL_S
  const wall = (c: ReplayClip): number => (c.to - c.from) / c.speed
  const picked: ReplayClip[] = [...goals]
  let used = goals.reduce((s, c) => s + wall(c), 0)
  // the best of the rest, never two clips over the same few seconds; a mix
  // first (two of a kind at most), then whatever is left fills the reel
  const ranked = [...rest].sort((a, b) => b.score - a.score)
  const perKind = new Map<ReplayKind, number>()
  for (const pass of [2, Infinity]) {
    for (const m of ranked) {
      if (picked.length >= maxClips) break
      if (picked.includes(m.clip) || (perKind.get(m.clip.kind) ?? 0) >= pass) continue
      if (used + wall(m.clip) > maxWall && picked.length > 0) continue
      if (picked.some((p) => m.clip.from < p.to + 1 && p.from < m.clip.to + 1)) continue
      picked.push(m.clip)
      perKind.set(m.clip.kind, (perKind.get(m.clip.kind) ?? 0) + 1)
      used += wall(m.clip)
    }
  }
  return picked.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.at - b.at)
}
