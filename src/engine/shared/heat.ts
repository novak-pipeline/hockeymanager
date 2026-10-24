/**
 * RIVALRY HEAT — how hot a game is running, per team pairing and per player
 * pair, built up by what the two sides actually do to each other.
 *
 * One model, three readers:
 *  - the story layer folds a finished stream through {@link HeatTracker}
 *    (story/rivalryHeat.ts) for the crowd, the "bad blood" lower-thirds and the
 *    incidents the career carries into the next meeting (league/heatLedger.ts);
 *  - the fight-frequency hook (shared/fights.ts) takes the heat CARRIED in from
 *    earlier meetings as an additive input;
 *  - a watched-game engine may feed its own events to a tracker as it emits
 *    them and read {@link HeatTracker.team} / {@link HeatTracker.pair} /
 *    {@link HeatTracker.scrumOdds} live. The agent engine does not yet: the
 *    shell hands it the carried heat as `Ctx.heat` (full/types.ts) and it is
 *    the engine owner's call how its hit / code / scrum odds read it.
 *
 * What raises heat (opponents only; teammates never heat each other):
 *  - a hit (a big one, or one that puts a man down, a lot more),
 *  - a fight (the pair is at full heat from then on),
 *  - a cheap shot: a penalty taken on one of the other club's top scorers,
 *  - anything after the whistle (a penalty called while the puck is dead),
 *  - a goal scored with a man he already has heat with on the ice,
 *  - two men with heat on the ice together at a whistle (the chirping),
 *  - whatever the clubs and the men carried in (rivalry, past meetings).
 *
 * Pure and deterministic. Team heat fades slowly through quiet stretches
 * (never below what was carried in); pair heat does not fade within a game.
 */
import type { GameEvent } from '@domain'

export type HeatSide = 'home' | 'away'

export type HeatKind =
  | 'hit'
  | 'bigHit'
  | 'fight'
  | 'cheapShot'
  | 'afterWhistle'
  | 'goalInFace'
  | 'chirp'

export interface HeatIncident {
  /** Absolute playback second. */
  absT: number
  period: number
  /** Period clock (s elapsed). */
  t: number
  kind: HeatKind
  /** The aggressor (the hitter, the man penalised, the scorer) and his side. */
  by: string
  side: HeatSide
  /** The man it was done to (the hit man, the star, the defender beaten). */
  on: string
  /** Team heat added (before saturation). */
  delta: number
  /** Pair heat added (before saturation). */
  pairDelta: number
  /** Penalty infraction (cheapShot / afterWhistle). */
  infraction?: string
  /** A hit that put him down. */
  down?: boolean
  /** A fight: who had the better of it (null = a draw). */
  winner?: string | null
}

export interface CarriedHeat {
  /** Heat the two clubs bring in, 0..1 (rivalry + recent meetings). */
  team: number
  /** Player pairs with history, heat 0..1. */
  pairs: ReadonlyArray<{ a: string; b: string; heat: number }>
}

export interface HeatTrackerOptions {
  sideOf: (playerId: string) => HeatSide | null
  /** Each club's top scorers: a penalty taken on one is a cheap shot. */
  stars?: ReadonlySet<string>
  carried?: CarriedHeat
}

/** Team-heat increments (before saturation). */
export const HEAT_DELTA = {
  hit: 0.012,
  bigHit: 0.07,
  fight: 0.3,
  cheapShot: 0.08,
  afterWhistle: 0.07,
  goalInFace: 0.05,
  chirp: 0.015,
} as const
/** Pair-heat increments. */
export const PAIR_DELTA = {
  hit: 0.06,
  bigHit: 0.35,
  fight: 1,
  cheapShot: 0.3,
  afterWhistle: 0.25,
  goalInFace: 0.15,
  chirp: 0.04,
} as const

/** A hit at least this forceful is a big one (matches highlights.BIG_HIT_FORCE). */
export const HEAT_BIG_HIT_FORCE = 0.7
/** Team heat halves over this many game seconds of nothing (toward the carried floor). */
export const TEAM_HEAT_HALF_LIFE_S = 420
/** A pair this hot is "a pair" (story lines, chirps, goals in his face). */
export const PAIR_HOT = 0.3
/** Carried heat counts this much at puck drop. */
export const CARRIED_TEAM_WEIGHT = 0.6
export const CARRIED_PAIR_WEIGHT = 0.7

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Infractions that are hockey plays, not shots at a man (never a cheap shot). */
const NOT_A_SHOT = /^(delay|too many|interference on the goalie|goalie|unsportsmanlike|bench)/i

export class HeatTracker {
  private readonly sideOf: (pid: string) => HeatSide | null
  private readonly stars: ReadonlySet<string>
  private readonly floor: number
  private heat: number
  private lastAbs = 0
  private readonly pairs = new Map<string, number>()
  private readonly onIce: Record<HeatSide, Set<string>> = { home: new Set(), away: new Set() }
  private readonly lineSeen: Record<HeatSide, boolean> = { home: false, away: false }
  private framePeriod = 0
  private dead = false
  /** Chirps counted once per pair per period. */
  private readonly chirped = new Set<string>()
  /** Quick-sim fights arrive as two 'fighting' majors at the same second. */
  private pendingFighting: { pid: string; side: HeatSide; absT: number } | null = null
  private readonly sawFightEvent = { v: false }

  constructor(opts: HeatTrackerOptions) {
    this.sideOf = opts.sideOf
    this.stars = opts.stars ?? new Set()
    const c = opts.carried
    this.floor = clamp01((c?.team ?? 0) * CARRIED_TEAM_WEIGHT)
    this.heat = this.floor
    for (const p of c?.pairs ?? []) {
      if (p.a === p.b) continue
      this.pairs.set(pairKey(p.a, p.b), clamp01(p.heat * CARRIED_PAIR_WEIGHT))
    }
  }

  /** Team heat at `absT` (0 = an ordinary night, 1 = the building is boiling). */
  team(absT: number = this.lastAbs): number {
    const dt = Math.max(0, absT - this.lastAbs)
    return this.floor + (this.heat - this.floor) * Math.pow(0.5, dt / TEAM_HEAT_HALF_LIFE_S)
  }

  /** Heat between two men, 0..1 (0 for teammates and strangers). */
  pair(a: string, b: string): number {
    return this.pairs.get(pairKey(a, b)) ?? 0
  }

  /** Every pair with any heat, hottest first. */
  hotPairs(min = 0): Array<{ a: string; b: string; heat: number }> {
    const out: Array<{ a: string; b: string; heat: number }> = []
    for (const [k, h] of this.pairs) {
      if (h <= min) continue
      const [a, b] = k.split('|') as [string, string]
      out.push({ a, b, heat: h })
    }
    return out.sort((x, y) => y.heat - x.heat || (x.a < y.a ? -1 : 1))
  }

  /** The men on the ice for a side right now (as the stream has shown them). */
  onIceOf(side: HeatSide): ReadonlySet<string> {
    return this.onIce[side]
  }

  /**
   * For an engine: how much likelier than a normal night a shove / scrum after
   * the whistle is, from the team heat and the hottest pair on the ice.
   * 1 = an ordinary game; at most 3.
   */
  scrumOdds(absT: number = this.lastAbs): number {
    let best = 0
    for (const a of this.onIce.home) for (const b of this.onIce.away) best = Math.max(best, this.pair(a, b))
    return 1 + 1.2 * this.team(absT) + 0.8 * best
  }

  /**
   * Feed one event (in stream order) at its absolute playback second. Returns
   * the heat incidents it raised (usually none).
   */
  observe(ev: GameEvent, absT: number): HeatIncident[] {
    const out: HeatIncident[] = []
    const raise = (kind: HeatKind, by: string, on: string, side: HeatSide, extra: Partial<HeatIncident> = {}, teamBoost = 0): void => {
      const delta = HEAT_DELTA[kind] + teamBoost
      const pairDelta = PAIR_DELTA[kind]
      const cur = this.team(absT)
      this.heat = clamp01(cur + delta * (1 - cur))
      this.lastAbs = absT
      const k = pairKey(by, on)
      const p = this.pairs.get(k) ?? 0
      this.pairs.set(k, clamp01(kind === 'fight' ? 1 : p + pairDelta * (1 - p)))
      out.push({ absT, period: ev.period, t: ev.t, kind, by, side, on, delta, pairDelta, ...extra })
    }
    const opponents = (a: string, b: string): HeatSide | null => {
      const sa = this.sideOf(a)
      const sb = this.sideOf(b)
      return sa && sb && sa !== sb ? sa : null
    }

    switch (ev.type) {
      case 'frame': {
        const newPeriod = ev.period !== this.framePeriod
        this.framePeriod = ev.period
        for (const side of ['home', 'away'] as const) {
          if (this.lineSeen[side] && !newPeriod) continue
          const ids = (side === 'home' ? ev.home : ev.away).map((s) => s.player as string)
          if (ids.length > 0) this.onIce[side] = new Set(ids)
        }
        break
      }
      case 'lineChange': {
        const ids = ev.onIce.map((x) => x as string)
        const side = ids.map((id) => this.sideOf(id)).find((s): s is HeatSide => s !== null)
        if (!side) break
        this.lineSeen[side] = true
        this.onIce[side] = new Set(ids)
        break
      }
      case 'faceoff':
        this.dead = false
        break
      case 'periodEnd':
        this.chirped.clear()
        this.dead = true
        break
      case 'whistle': {
        this.dead = true
        // Two men with history on the ice together when play stops.
        for (const a of this.onIce.home) {
          for (const b of this.onIce.away) {
            if (this.pair(a, b) < PAIR_HOT) continue
            const ck = `${ev.period}:${pairKey(a, b)}`
            if (this.chirped.has(ck)) continue
            this.chirped.add(ck)
            raise('chirp', a, b, 'home')
          }
        }
        break
      }
      case 'goal': {
        this.dead = true
        const scorer = ev.scorer as string
        const side = this.sideOf(scorer)
        if (!side) break
        const other: HeatSide = side === 'home' ? 'away' : 'home'
        let best: { id: string; h: number } | null = null
        for (const d of this.onIce[other]) {
          const h = this.pair(scorer, d)
          if (h >= PAIR_HOT && (!best || h > best.h)) best = { id: d, h }
        }
        if (best) raise('goalInFace', scorer, best.id, side)
        break
      }
      case 'hit': {
        const by = ev.by as string
        const on = ev.on as string
        const side = opponents(by, on)
        if (!side) break
        const big = (ev.force ?? 0) >= HEAT_BIG_HIT_FORCE || ev.knockdown === true
        // A hit on one of their stars lands harder in the building.
        const starBoost = this.stars.has(on) ? 0.03 : 0
        raise(big ? 'bigHit' : 'hit', by, on, side, ev.knockdown ? { down: true } : {}, starBoost)
        break
      }
      case 'fight': {
        this.sawFightEvent.v = true
        const h = ev.home as string
        const a = ev.away as string
        raise('fight', h, a, 'home', { winner: (ev.winner as string | null) ?? null })
        break
      }
      case 'penalty': {
        const pid = ev.player as string
        const side = this.sideOf(pid)
        if (!side) break
        if (ev.infraction === 'fighting') {
          // The agent engine sends a fight event first; the majors that follow are its paperwork.
          if (this.sawFightEvent.v) break
          const pf = this.pendingFighting
          if (pf && pf.side !== side && Math.abs(pf.absT - absT) < 2) {
            this.pendingFighting = null
            const home = side === 'home' ? pid : pf.pid
            const away = side === 'home' ? pf.pid : pid
            raise('fight', home, away, 'home', { winner: null })
          } else {
            this.pendingFighting = { pid, side, absT }
          }
          break
        }
        const drawn = ev.drawnBy as string | undefined
        if (!drawn || !opponents(pid, drawn) || NOT_A_SHOT.test(ev.infraction)) break
        if (this.dead) raise('afterWhistle', pid, drawn, side, { infraction: ev.infraction })
        else if (this.stars.has(drawn)) raise('cheapShot', pid, drawn, side, { infraction: ev.infraction })
        break
      }
    }
    return out
  }
}

/**
 * The fight-frequency input from heat carried into a game: only real history
 * counts (a little residue from long ago is ignored), so ordinary nights keep
 * the base rate exactly.
 */
export const CARRIED_FIGHT_FLOOR = 0.2
export function fightHeatInput(carriedTeam: number): number {
  const h = clamp01(carriedTeam)
  return h <= CARRIED_FIGHT_FLOOR ? 0 : (h - CARRIED_FIGHT_FLOOR) / (1 - CARRIED_FIGHT_FLOOR)
}
