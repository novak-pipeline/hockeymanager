/**
 * Fights in 3D: the agent engine's `fight` event (src/engine/agent/fight.ts)
 * carries the whole sequence as beats, and the frames already put both men
 * at the spot (circling, then locked together, the others backed off to a
 * ring). This module turns the beats into clips on the two fighters, places
 * the two linesmen and the dropped gloves and sticks (the close-up is a W3 S7
 * director cut the renderer asks for: camera/cuts.ts requestCut).
 * It reads only the stream; nothing here decides an outcome.
 *
 * Clips (scripts/blender/clips.py, upper body over the skating legs):
 *   fight_drop → fight_stance (circling) → fight_grab (locked on) with
 *   fight_punch_R / fight_punch_L timed so the fist lands on the punch beat and
 *   fight_hit_react on the man hit; fight_clinch between flurries and when both
 *   are spent; hit_fall (→ getup) on the man who goes down; the linesmen play
 *   official_separate.
 */
import type { FightBeat, GameStream } from '@domain'
import { playAbsT } from '@domain'
import { normXtoWorld, normYtoWorld } from './math'
import { CLIPS } from './animCatalog'

export type FightSide = 'home' | 'away'

export interface StagedFight {
  /** Playback time the gloves dropped. */
  absT: number
  home: string
  away: string
  /** The meeting spot (world ft). */
  x: number
  z: number
  beats: FightBeat[]
  separateAt: number
  boxAt: number
  durationS: number
  down: FightSide | null
  /** Where each man stood when he dropped his gloves (world ft): the gloves and stick land there. */
  dropAt: { home: { x: number; z: number }; away: { x: number; z: number } }
  /** Playback time of the faceoff that ends the stoppage (the gear is picked up by then). */
  clearAt: number
}

/** After the escort beat the walk to the box runs this long (the linesmen go with them). */
export const ESCORT_WALK_S = 5

export function extractFights(stream: GameStream): StagedFight[] {
  const out: StagedFight[] = []
  for (let i = 0; i < stream.length; i++) {
    const e = stream[i]!
    if (e.type !== 'fight') continue
    const absT = playAbsT(e)
    const home = e.home as string
    const away = e.away as string
    let dropAt: StagedFight['dropAt'] = { home: { x: normXtoWorld(e.pos.x), z: normYtoWorld(e.pos.y) }, away: { x: normXtoWorld(e.pos.x), z: normYtoWorld(e.pos.y) } }
    let clearAt = absT + e.durationS + 4
    let found = false
    for (let j = i + 1; j < stream.length; j++) {
      const f = stream[j]!
      if (f.type === 'frame' && !found && playAbsT(f) >= absT - 1e-6) {
        const h = f.home.find((s) => s.player === home)
        const a = f.away.find((s) => s.player === away)
        if (h && a) {
          found = true
          dropAt = { home: { x: normXtoWorld(h.pos.x), z: normYtoWorld(h.pos.y) }, away: { x: normXtoWorld(a.pos.x), z: normYtoWorld(a.pos.y) } }
        }
      }
      if (f.type === 'faceoff') {
        clearAt = playAbsT(f)
        break
      }
    }
    out.push({
      absT, home, away, x: normXtoWorld(e.pos.x), z: normYtoWorld(e.pos.y), beats: e.beats,
      separateAt: e.separateAt, boxAt: e.boxAt, durationS: e.durationS,
      down: e.down === null ? null : e.down === e.home ? 'home' : 'away', dropAt, clearAt,
    })
  }
  return out
}

/** The fight on at playback time `t` (from the drop to the end of the walk to the box). */
export function fightAt(fights: readonly StagedFight[], t: number): StagedFight | null {
  for (const f of fights) if (t >= f.absT - 0.05 && t <= f.absT + f.boxAt + ESCORT_WALK_S) return f
  return null
}

export type FightLoop = 'fight_stance' | 'fight_grab' | 'fight_clinch'
export const FIGHT_LOOPS: readonly FightLoop[] = ['fight_stance', 'fight_grab', 'fight_clinch']

/** The loop a fighter holds `tau` s after the drop between one-shots (null: none, or he is down). */
export function loopAt(f: StagedFight, tau: number, side: FightSide): FightLoop | null {
  if (tau < 0 || tau >= f.separateAt) return null
  const down = f.beats.find((b) => b.kind === 'down')
  if (down && tau >= down.at && down.by === side) return null
  let loop: FightLoop | null = null
  for (const b of f.beats) {
    if (b.at > tau) break
    if (b.kind === 'square') loop = 'fight_stance'
    else if (b.kind === 'grab' || b.kind === 'punch') loop = 'fight_grab'
    else if (b.kind === 'clinch' || b.kind === 'tired') loop = 'fight_clinch'
    else if (b.kind === 'down') loop = 'fight_stance' // the man still up stands over him
  }
  return loop
}

export interface FightShot {
  /** Seconds after the drop the clip starts. */
  tau: number
  side: FightSide
  clip: string
  weight?: number
}

/**
 * The one-shot clips, timed: a punch starts its contact time before the beat
 * so the fist lands ON it; the man hit snaps back at the beat (a landed punch
 * only, harder on a heavy one); the man who goes down falls at his beat.
 */
export function fightShots(f: StagedFight, contactOf: (clip: string) => number = (c) => CLIPS[c]?.contact ?? 0): FightShot[] {
  const out: FightShot[] = [
    { tau: 0, side: 'home', clip: 'fight_drop' },
    { tau: 0, side: 'away', clip: 'fight_drop' },
  ]
  const other = (s: FightSide): FightSide => (s === 'home' ? 'away' : 'home')
  for (const b of f.beats) {
    if (b.kind === 'punch' && b.by) {
      const clip = b.hand === 'L' ? 'fight_punch_L' : 'fight_punch_R'
      out.push({ tau: Math.max(0, b.at - contactOf(clip)), side: b.by, clip })
      if (b.landed) out.push({ tau: b.at, side: other(b.by), clip: 'fight_hit_react', weight: b.heavy ? 1 : 0.65 })
    } else if (b.kind === 'down' && b.by) {
      out.push({ tau: b.at, side: b.by, clip: 'hit_fall' })
    }
  }
  return out.sort((a, b) => a.tau - b.tau)
}

/** A world point and facing (radians, atan2(dx, dz) like every pose) for each linesman. */
export interface OfficialSpot {
  x: number
  z: number
  face: number
  /** Arms out between the two men (official_separate). */
  separating: boolean
}

/**
 * The fighters' axis (home minus away, unit) and its perpendicular on the main
 * camera's side of the ice (-z): the linesmen hover on the far side of it.
 */
export function fightAxes(h: { x: number; z: number }, a: { x: number; z: number }): { ax: number; az: number; cx: number; cz: number } {
  let ax = h.x - a.x
  let az = h.z - a.z
  const al = Math.hypot(ax, az) || 1
  ax /= al
  az /= al
  let cx = -az
  let cz = ax
  if (cz > 0 || (cz === 0 && cx > 0)) {
    cx = -cx
    cz = -cz
  }
  return { ax, az, cx, cz }
}

/**
 * Where the two linesmen stand during the fight. They hover a few feet off
 * the pair, on the far side from the camera, while it goes; step in at the
 * `linesmen` beat; wedge between the two men at `separate`; and walk one man
 * each toward the box. `h` / `a` are the fighters' drawn positions this frame.
 */
export function linesmenSpots(f: StagedFight, tau: number, h: { x: number; z: number }, a: { x: number; z: number }): [OfficialSpot, OfficialSpot] | null {
  if (tau < 0 || tau > f.boxAt + ESCORT_WALK_S) return null
  const mx = (h.x + a.x) / 2
  const mz = (h.z + a.z) / 2
  // (the axis they squared up on: steady, so nobody swings round mid-fight)
  const { ax, az, cx, cz } = fightAxes(f.dropAt.home, f.dropAt.away)
  const grab = f.beats.find((b) => b.kind === 'grab')?.at ?? 2
  const inAt = f.beats.find((b) => b.kind === 'linesmen')?.at ?? f.separateAt - 0.8
  const face = (x: number, z: number, tx: number, tz: number): number => Math.atan2(tx - x, tz - z)
  // s = +1 toward the home man's end of the pair, -1 the away man's; d = how far off
  const spot = (s: number, d: number, sep: boolean): OfficialSpot => {
    const x = mx + (ax * s - cx) * d * 0.7
    const z = mz + (az * s - cz) * d * 0.7
    return { x, z, face: face(x, z, mx, mz), separating: sep }
  }
  if (tau < grab) return [spot(1, 14, false), spot(-1, 14, false)]
  if (tau < inAt) return [spot(1, 7, false), spot(-1, 7, false)]
  if (tau < f.separateAt) {
    const k = Math.min(1, (tau - inAt) / Math.max(0.1, f.separateAt - inAt))
    return [spot(1, 7 - 4.5 * k, true), spot(-1, 7 - 4.5 * k, true)]
  }
  // each linesman on his man, between him and the other (escorting him off)
  const on = (m: { x: number; z: number }, toward: number): OfficialSpot => {
    const x = m.x - ax * toward * 1.6
    const z = m.z - az * toward * 1.6
    return { x, z, face: face(x, z, m.x, m.z), separating: tau < f.boxAt }
  }
  return [on(h, 1), on(a, -1)]
}

/** Gear on the ice: two gloves and the stick for each man, from the drop until the faceoff. */
export interface FightProp {
  kind: 'glove' | 'stick'
  side: FightSide
  x: number
  z: number
  /** Yaw (radians). */
  yaw: number
  from: number
  until: number
}

export function fightProps(f: StagedFight): FightProp[] {
  const out: FightProp[] = []
  for (const side of ['home', 'away'] as const) {
    const p = f.dropAt[side]
    const seed = (side === 'home' ? 1 : -1) * (1 + (Math.abs(Math.round(f.absT * 10)) % 7) / 10)
    const from = f.absT + 0.35
    out.push({ kind: 'glove', side, x: p.x + 0.9 * seed, z: p.z + 0.6, yaw: 0.4 * seed, from, until: f.clearAt })
    out.push({ kind: 'glove', side, x: p.x - 0.7, z: p.z - 0.9 * seed, yaw: -0.9 * seed, from: from + 0.15, until: f.clearAt })
    out.push({ kind: 'stick', side, x: p.x + 1.4 * seed, z: p.z - 1.2, yaw: 1.1 * seed, from: f.absT + 0.1, until: f.clearAt })
  }
  return out
}

/** The minimal actor the stager drives (choreo.ts ChoreoActor fits). */
export interface FightActor {
  layer: {
    play(name: string, opts?: { at?: number; weight?: number }): boolean
    stop(name?: string): void
    readonly playing: string[]
  } | null
}

/**
 * Plays the fight clips as the game clock passes their times (like the
 * Choreographer) and keeps each fighter in the right loop between one-shots.
 */
export class FightStager {
  private fights: StagedFight[] = []
  private shots: Array<{ f: StagedFight; s: FightShot; at: number }> = []
  private busy = new Map<string, number>()

  constructor(
    private readonly find: (id: string) => FightActor | null,
    private readonly durationOf: (clip: string) => number,
  ) {}

  setFights(fights: StagedFight[]): void {
    this.fights = fights
    this.shots = fights.flatMap((f) => fightShots(f).map((s) => ({ f, s, at: f.absT + s.tau })))
    this.shots.sort((a, b) => a.at - b.at)
    this.busy.clear()
  }

  reset(): void {
    this.busy.clear()
  }

  get list(): readonly StagedFight[] {
    return this.fights
  }

  /** Advance from `prev` to `now` (playback s). */
  tick(prev: number, now: number): void {
    for (const x of this.shots) {
      if (x.at <= prev) continue
      if (x.at > now) break
      const id = x.s.side === 'home' ? x.f.home : x.f.away
      const a = this.find(id)
      if (!a?.layer) continue
      a.layer.play(x.s.clip, { at: Math.max(0, now - x.at), ...(x.s.weight !== undefined ? { weight: x.s.weight } : {}) })
      const meta = CLIPS[x.s.clip]
      this.busy.set(id, x.at + this.durationOf(x.s.clip) + (meta?.hold ?? 0) - (meta?.fadeOut ?? 0.2))
    }
    const f = fightAt(this.fights, now)
    if (!f) return
    const tau = now - f.absT
    for (const side of ['home', 'away'] as const) {
      const id = side === 'home' ? f.home : f.away
      const a = this.find(id)
      if (!a?.layer) continue
      const want = loopAt(f, tau, side)
      const playing = a.layer.playing
      if (want === null) {
        for (const l of FIGHT_LOOPS) if (playing.includes(l)) a.layer.stop(l)
        continue
      }
      if (now < (this.busy.get(id) ?? -1)) continue
      if (!playing.includes(want)) a.layer.play(want)
    }
  }
}
