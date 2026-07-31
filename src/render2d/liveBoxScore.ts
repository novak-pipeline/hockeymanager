/**
 * A box score that fills in as the game runs.
 *
 * The postgame BoxScoreView (engine/career/boxScore.ts) is assembled from a
 * finished GameOutcome — it needs `playerStats`, which only exists once the game
 * is over. The GM watching a game unfold needs the same table at any instant, so
 * this builds it the other way round: fold the keystone stream forward, event by
 * event, and read the totals off at whatever clock the viewer has reached.
 *
 * Everything here is derived from events the engine already emits — goals and
 * assists, shots, blocks, hits, penalties, saves, faceoffs, and the `lineChange`
 * on-ice sets that give plus/minus and time on ice. No hockey is computed; no
 * engine change is involved.
 *
 * Pure and DOM-free.
 */
import type { GameEvent, GameStream, PlayerRef } from '@domain'

export interface LiveSkaterLine {
  playerId: string
  name: string
  goals: number
  assists: number
  points: number
  shots: number
  hits: number
  blocks: number
  penaltyMinutes: number
  plusMinus: number
  faceoffWins: number
  /** Seconds on the ice, from the lineChange spans. */
  toi: number
}

export interface LiveGoalieLine {
  playerId: string
  name: string
  shotsAgainst: number
  saves: number
  goalsAgainst: number
  /** 0..1; 0 until the first shot arrives. */
  savePct: number
}

export interface LiveTeamBox {
  abbr: string
  goals: number
  shots: number
  hits: number
  blocks: number
  penaltyMinutes: number
  faceoffWins: number
  /** Goals scored on the man advantage (strength 'pp'). */
  powerPlayGoals: number
  /** Goals in each period played so far (index 0 = 1st). */
  byPeriod: number[]
  skaters: LiveSkaterLine[]
  goalies: LiveGoalieLine[]
}

export interface LiveBoxScore {
  home: LiveTeamBox
  away: LiveTeamBox
}

interface Acc {
  name: string
  goals: number
  assists: number
  shots: number
  hits: number
  blocks: number
  penaltyMinutes: number
  plus: number
  minus: number
  faceoffWins: number
  toi: number
  isGoalie: boolean
  shotsAgainst: number
  saves: number
  goalsAgainst: number
}

function blank(name: string): Acc {
  return {
    name,
    goals: 0, assists: 0, shots: 0, hits: 0, blocks: 0, penaltyMinutes: 0,
    plus: 0, minus: 0, faceoffWins: 0, toi: 0,
    isGoalie: false, shotsAgainst: 0, saves: 0, goalsAgainst: 0,
  }
}

/**
 * Folds a stream forward into a running box score.
 *
 * Feed it events in stream order (an EventCursor does exactly that) and call
 * `snapshot()` whenever the table needs redrawing. `reset()` rewinds it for a
 * scrub or a jump.
 */
export class LiveBoxScoreBuilder {
  private readonly acc = new Map<string, Acc>()
  private readonly homeIds: Set<string>
  private readonly abbrs: { home: string; away: string }
  private readonly names: (id: PlayerRef) => string

  private homeGoals = 0
  private awayGoals = 0
  private homePpGoals = 0
  private awayPpGoals = 0
  private homeByPeriod: number[] = []
  private awayByPeriod: number[] = []

  /** Skaters currently on the ice for each side, and when they came over. */
  private onIce: { home: string[]; away: string[] } = { home: [], away: [] }
  private shiftStart: { home: number; away: number } = { home: 0, away: 0 }

  /** Goalie of record per side — seeded from the opening frame, kept current by saves. */
  private goalie: { home: string | null; away: string | null } = { home: null, away: null }

  constructor(opts: {
    stream: GameStream
    homePlayerIds: string[]
    names: (id: PlayerRef) => string
    abbrs: { home: string; away: string }
  }) {
    this.homeIds = new Set(opts.homePlayerIds)
    this.names = opts.names
    this.abbrs = opts.abbrs
    // Seed the goalies of record from the first positional frame, so a goal
    // scored before the first save is still charged to somebody.
    for (const ev of opts.stream) {
      if (ev.type === 'frame') {
        this.goalie.home = ev.homeGoalie.player as string
        this.goalie.away = ev.awayGoalie.player as string
        break
      }
    }
  }

  /** Rewind to the opening faceoff. */
  reset(): void {
    this.acc.clear()
    this.homeGoals = 0
    this.awayGoals = 0
    this.homePpGoals = 0
    this.awayPpGoals = 0
    this.homeByPeriod = []
    this.awayByPeriod = []
    this.onIce = { home: [], away: [] }
    this.shiftStart = { home: 0, away: 0 }
  }

  private of(id: PlayerRef): Acc {
    const key = id as string
    let a = this.acc.get(key)
    if (!a) {
      a = blank(this.names(id))
      this.acc.set(key, a)
    }
    return a
  }

  private sideOf(id: PlayerRef): 'home' | 'away' {
    return this.homeIds.has(id as string) ? 'home' : 'away'
  }

  private bump(list: number[], period: number, by: number): void {
    while (list.length < period) list.push(0)
    list[period - 1] += by
  }

  /**
   * Apply one event at absolute clock `absT`. Events must arrive in order.
   * `frame` events are ignored — feed them or don't, it makes no difference.
   */
  apply(ev: GameEvent, absT: number): void {
    switch (ev.type) {
      case 'goal': {
        const side = this.sideOf(ev.scorer)
        if (side === 'home') { this.homeGoals++; this.bump(this.homeByPeriod, ev.period, 1) }
        else { this.awayGoals++; this.bump(this.awayByPeriod, ev.period, 1) }
        if (ev.strength === 'pp') { if (side === 'home') this.homePpGoals++; else this.awayPpGoals++ }
        // SOG is NOT bumped here: the engine emits a `shot` event for every
        // attempt on net and the goal is the outcome of one of them, so the
        // shooter's shot is already on the board (same rule the postgame box
        // score counts by).
        this.of(ev.scorer).goals++
        for (const a of ev.assists) this.of(a).assists++

        // Plus/minus: everything except a power-play goal. That is the NHL rule
        // (an empty-net goal counts; a man-advantage goal does not) and it is
        // what the engine credits, so the live table and the postgame one agree.
        if (ev.strength !== 'pp') {
          const scoring = side === 'home' ? this.onIce.home : this.onIce.away
          const conceding = side === 'home' ? this.onIce.away : this.onIce.home
          for (const id of scoring) this.of(id as PlayerRef).plus++
          for (const id of conceding) this.of(id as PlayerRef).minus++
        }

        // Charge the goalie who was beaten — unless the net was empty (NHL
        // convention: nothing accrues against an empty cage). A goal produces no
        // `save` event, so this is where his shots-against for it comes from.
        if (ev.strength !== 'en') {
          const gid = side === 'home' ? this.goalie.away : this.goalie.home
          if (gid) {
            const g = this.of(gid as PlayerRef)
            g.isGoalie = true
            g.goalsAgainst++
            g.shotsAgainst++
          }
        }
        break
      }
      case 'shot':
        this.of(ev.shooter).shots++
        break
      case 'save': {
        const g = this.of(ev.goalie)
        g.isGoalie = true
        g.saves++
        g.shotsAgainst++
        this.goalie[this.sideOf(ev.goalie)] = ev.goalie as string
        break
      }
      case 'blockedShot':
        this.of(ev.blocker).blocks++
        break
      case 'hit':
        this.of(ev.by).hits++
        break
      case 'penalty':
        this.of(ev.player).penaltyMinutes += ev.minutes
        break
      case 'faceoff': {
        this.of(ev.winner).faceoffWins++
        break
      }
      case 'lineChange': {
        // Which bench changed is read off the players who came over the boards —
        // no team id needed, so this works from the stream alone.
        const first = ev.onIce[0]
        if (first === undefined) break
        const side = this.sideOf(first)
        // Credit the unit coming off for the shift it just skated.
        const skated = Math.max(0, absT - this.shiftStart[side])
        for (const id of this.onIce[side]) this.of(id as PlayerRef).toi += skated
        this.onIce[side] = ev.onIce.map((id) => id as string)
        this.shiftStart[side] = absT
        break
      }
      case 'periodEnd':
      case 'gameEnd': {
        for (const side of ['home', 'away'] as const) {
          const skated = Math.max(0, absT - this.shiftStart[side])
          for (const id of this.onIce[side]) this.of(id as PlayerRef).toi += skated
          this.shiftStart[side] = absT
        }
        break
      }
      default:
        break
    }
  }

  /** The table as it stands, sorted the way a box score prints. */
  snapshot(): LiveBoxScore {
    const build = (side: 'home' | 'away'): LiveTeamBox => {
      const skaters: LiveSkaterLine[] = []
      const goalies: LiveGoalieLine[] = []
      let shots = 0
      let hits = 0
      let blocks = 0
      let pim = 0
      let fow = 0
      for (const [id, a] of this.acc) {
        if (this.sideOf(id as PlayerRef) !== side) continue
        if (a.isGoalie) {
          goalies.push({
            playerId: id,
            name: a.name,
            shotsAgainst: a.shotsAgainst,
            saves: a.saves,
            goalsAgainst: a.goalsAgainst,
            savePct: a.shotsAgainst > 0 ? a.saves / a.shotsAgainst : 0,
          })
          continue
        }
        shots += a.shots
        hits += a.hits
        blocks += a.blocks
        pim += a.penaltyMinutes
        fow += a.faceoffWins
        skaters.push({
          playerId: id,
          name: a.name,
          goals: a.goals,
          assists: a.assists,
          points: a.goals + a.assists,
          shots: a.shots,
          hits: a.hits,
          blocks: a.blocks,
          penaltyMinutes: a.penaltyMinutes,
          plusMinus: a.plus - a.minus,
          faceoffWins: a.faceoffWins,
          toi: a.toi,
        })
      }
      skaters.sort((x, y) => y.points - x.points || y.toi - x.toi || x.name.localeCompare(y.name))
      goalies.sort((x, y) => y.shotsAgainst - x.shotsAgainst)
      return {
        abbr: side === 'home' ? this.abbrs.home : this.abbrs.away,
        goals: side === 'home' ? this.homeGoals : this.awayGoals,
        shots,
        hits,
        blocks,
        penaltyMinutes: pim,
        faceoffWins: fow,
        powerPlayGoals: side === 'home' ? this.homePpGoals : this.awayPpGoals,
        byPeriod: side === 'home' ? [...this.homeByPeriod] : [...this.awayByPeriod],
        skaters,
        goalies,
      }
    }
    const home = build('home')
    const away = build('away')
    return { home, away }
  }
}
