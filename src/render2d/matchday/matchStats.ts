/**
 * Match-day statistics, folded from the event stream (Track P: intermission,
 * postgame, live stats panel).
 *
 * The viewer already holds the whole watched game's stream, so every number on
 * the match-day screens is read straight off it — no worker round-trip, no
 * protocol change. `buildMatchIndex` does the one expensive pass (drops the
 * positional frames, keeps the goalie-of-record changes they carry), and
 * `computeMatchStats(index, upTo)` folds the few thousand remaining events up
 * to any clock the viewer has reached. That fold is cheap enough to run every
 * game-second for the live panel.
 *
 * Counting rules match the live box score (liveBoxScore.ts) and the postgame
 * box: a goal is the outcome of a `shot` event (SOG is counted on the shot, not
 * again on the goal); plus/minus skips power-play goals; an empty-net goal is
 * charged to no goalie.
 *
 * Pure and DOM-free.
 */
import type { GameEvent, GameStream, GoalStrength, PlayerRef } from '@domain'
import { periodBases } from '../timeline'

export type Side = 'home' | 'away'

/**
 * Expected goals per unit of shot `danger`.
 *
 * The engines set danger = clamp(surfaceXg / 0.25, 0, 1) (fullSim.ts
 * tryShoot), so the raw surface would say 0.25 per unit. But that surface is
 * the chance BEFORE the goalie: measured on the watched-game path (40 games,
 * generated league, seed 11) the stream scores 0.61 goals per 0.25-scaled xG.
 * The match-day layer wants "what an average goalie concedes on these
 * chances" — the yardstick for goalie ratings and the xG shown to the GM — so
 * it uses the measured scale. Checked on both engines with it applied (24
 * games each, seed 99): Classic scores 1.07 goals per xG, the agent engine
 * 1.14 — close enough for one constant. Re-measure if finishing changes.
 */
export const XG_PER_DANGER = 0.25 * 0.61

/** A shot at or above this expected-goal value is a high-danger chance. */
export const HIGH_DANGER_XG = 0.12

/** What the match-day layer needs from a watched game (WatchedGame fits it). */
export interface MatchDayGame {
  stream: GameStream
  homePlayerIds: string[]
  playerNames: Record<string, string>
  homeAbbr: string
  awayAbbr: string
  userIsHome: boolean
}

export interface TimedEvent {
  absT: number
  ev: GameEvent
}

export interface MatchIndex {
  homeAbbr: string
  awayAbbr: string
  userSide: Side
  homeIds: ReadonlySet<string>
  names: Readonly<Record<string, string>>
  /** Positions by player id ('C', 'LW', 'RW', 'D', 'G', or 'F' when unknown). */
  positions: Readonly<Record<string, string>>
  /** Every non-frame event, ascending by absolute game clock. */
  events: TimedEvent[]
  /** Goalie of record per side, as the positional frames show it (first entry = starters). */
  goalieChanges: Array<{ absT: number; side: Side; goalie: string }>
  /** Absolute clock at which each period starts. */
  periodStarts: ReadonlyMap<number, number>
  /**
   * The breaks in the game: the end of every period that another period
   * follows (1st, 2nd, end of regulation before OT, playoff OT → OT).
   */
  intermissions: Array<{ period: number; absT: number }>
  /** Last period played. */
  lastPeriod: number
  /** Absolute clock of the final horn. */
  duration: number
}

/* ─────────────────────────── index ─────────────────────────── */

/**
 * One pass over the stream: timed non-frame events, goalie changes, period
 * layout. `positions` is optional (the broadcast context carries them); without
 * it a player who takes faceoffs reads as a centre and everyone else as 'F'.
 */
export function buildMatchIndex(game: MatchDayGame, positions: Record<string, string> = {}): MatchIndex {
  const bases = periodBases(game.stream)
  const homeIds = new Set(game.homePlayerIds)
  const events: TimedEvent[] = []
  const goalieChanges: MatchIndex['goalieChanges'] = []
  const cur: Record<Side, string | null> = { home: null, away: null }
  let duration = 0
  let lastPeriod = 1
  for (const ev of game.stream) {
    const absT = (bases.get(ev.period) ?? (ev.period - 1) * 1200) + ev.t
    if (absT > duration) duration = absT
    if (ev.period > lastPeriod) lastPeriod = ev.period
    if (ev.type === 'frame') {
      const hg = ev.homeGoalie.player as string
      const ag = ev.awayGoalie.player as string
      if (hg && hg !== cur.home) { cur.home = hg; goalieChanges.push({ absT, side: 'home', goalie: hg }) }
      if (ag && ag !== cur.away) { cur.away = ag; goalieChanges.push({ absT, side: 'away', goalie: ag }) }
      continue
    }
    events.push({ absT, ev })
  }
  events.sort((a, b) => a.absT - b.absT)

  const pos: Record<string, string> = {}
  for (const [id, p] of Object.entries(positions)) pos[id] = p
  for (const g of goalieChanges) pos[g.goalie] = 'G'
  for (const { ev } of events) {
    if (ev.type === 'save') pos[ev.goalie as string] = 'G'
    if (ev.type === 'faceoff' && pos[ev.winner as string] === undefined) pos[ev.winner as string] = 'C'
  }

  const intermissions: MatchIndex['intermissions'] = []
  const periods = [...bases.keys()].sort((a, b) => a - b)
  for (const p of periods) {
    const next = bases.get(p + 1)
    if (next !== undefined) intermissions.push({ period: p, absT: next })
  }

  return {
    homeAbbr: game.homeAbbr,
    awayAbbr: game.awayAbbr,
    userSide: game.userIsHome ? 'home' : 'away',
    homeIds,
    names: game.playerNames,
    positions: pos,
    events,
    goalieChanges,
    periodStarts: bases,
    intermissions,
    lastPeriod,
    duration,
  }
}

/* ─────────────────────────── stats shapes ─────────────────────────── */

export interface TeamStats {
  goals: number
  /** Shots on goal. */
  shots: number
  /** Unblocked attempts that missed the net (agent engine only). */
  missed: number
  /** This team's attempts that the other team blocked. */
  blockedAgainst: number
  /** Expected goals from shots on goal. */
  xg: number
  hits: number
  /** Shots this team blocked. */
  blocks: number
  faceoffWins: number
  /** Faceoffs taken (both teams take every one). */
  faceoffs: number
  takeaways: number
  giveaways: number
  penaltyMinutes: number
  /** Minor/major penalties the OTHER team took (fights excluded): our power plays. */
  powerPlays: number
  powerPlayGoals: number
  shortHandedGoals: number
}

export type ShotResult = 'goal' | 'save' | 'miss' | 'post' | 'block'

export interface ShotPoint {
  absT: number
  period: number
  side: Side
  shooter: string
  /** Rink-normalised (x, y ∈ −1..1), as the engine emits them. */
  x: number
  y: number
  /** Which net was attacked: +1 = the +x end, −1 = the −x end. */
  attackSign: 1 | -1
  xg: number
  result: ShotResult
  emptyNet: boolean
  /** Goalie who faced it (on-goal shots only). */
  goalie: string | null
}

export interface GoalSummary {
  absT: number
  period: number
  /** Elapsed time in the period, "M:SS". */
  clock: string
  side: Side
  scorerId: string
  scorerName: string
  assistIds: string[]
  assistNames: string[]
  strength: GoalStrength
  /** Score after this goal. */
  home: number
  away: number
  /** The shootout decider (a scoreboard goal, not a player's). */
  shootout?: boolean
}

export interface PenaltySummary {
  absT: number
  period: number
  clock: string
  side: Side
  playerId: string
  playerName: string
  infraction: string
  minutes: number
}

export interface PlayerLine {
  id: string
  name: string
  side: Side
  position: string
  isGoalie: boolean
  goals: number
  assists: number
  primaryAssists: number
  shots: number
  missed: number
  /** This player's attempts blocked by the other team. */
  attemptsBlocked: number
  xg: number
  hits: number
  hitsTaken: number
  blocks: number
  takeaways: number
  giveaways: number
  penaltyMinutes: number
  penaltiesTaken: number
  penaltiesDrawn: number
  plusMinus: number
  faceoffWins: number
  /** Only known when the engine names the loser of the draw. */
  faceoffLosses: number
  /** Seconds on the ice (skaters: lineChange spans; goalies: time as goalie of record). */
  toi: number
  // Goalies
  shotsAgainst: number
  saves: number
  goalsAgainst: number
  /** Expected goals against on the shots he faced (empty-net excluded). */
  xga: number
  highDangerSaves: number
}

export interface MatchStats {
  /** Clock the stats were folded to. */
  upTo: number
  /** Period at that clock. */
  period: number
  home: TeamStats
  away: TeamStats
  /** Per-period team stats, index 0 = 1st period. */
  byPeriod: { home: TeamStats[]; away: TeamStats[] }
  players: PlayerLine[]
  shots: ShotPoint[]
  goals: GoalSummary[]
  penalties: PenaltySummary[]
  /** Game seconds elapsed at `upTo` (= upTo, clamped to the game). */
  elapsed: number
  ended: boolean
  /** Who won the shootout, when the game went to one (its goal is in `goals`, flagged). */
  shootoutWinner: Side | null
}

function blankTeam(): TeamStats {
  return {
    goals: 0, shots: 0, missed: 0, blockedAgainst: 0, xg: 0, hits: 0, blocks: 0,
    faceoffWins: 0, faceoffs: 0, takeaways: 0, giveaways: 0, penaltyMinutes: 0,
    powerPlays: 0, powerPlayGoals: 0, shortHandedGoals: 0,
  }
}

function blankLine(id: string, name: string, side: Side, position: string): PlayerLine {
  return {
    id, name, side, position, isGoalie: position === 'G',
    goals: 0, assists: 0, primaryAssists: 0, shots: 0, missed: 0, attemptsBlocked: 0, xg: 0,
    hits: 0, hitsTaken: 0, blocks: 0, takeaways: 0, giveaways: 0,
    penaltyMinutes: 0, penaltiesTaken: 0, penaltiesDrawn: 0, plusMinus: 0,
    faceoffWins: 0, faceoffLosses: 0, toi: 0,
    shotsAgainst: 0, saves: 0, goalsAgainst: 0, xga: 0, highDangerSaves: 0,
  }
}

/** Elapsed-in-period clock, "M:SS". */
export function periodClock(tInPeriod: number): string {
  const s = Math.max(0, Math.floor(tInPeriod))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function periodName(period: number): string {
  if (period === 1) return '1st'
  if (period === 2) return '2nd'
  if (period === 3) return '3rd'
  return period === 4 ? 'OT' : `${period - 3}OT`
}

const sign = (v: number): 1 | -1 => (v < 0 ? -1 : 1)

/* ─────────────────────────── the fold ─────────────────────────── */

/**
 * Everything that has happened by `upTo` (absolute game seconds; default: the
 * whole game). Deterministic; O(events).
 */
export function computeMatchStats(index: MatchIndex, upTo: number = Infinity): MatchStats {
  const limit = Math.min(upTo, index.duration)
  const sideOf = (id: PlayerRef | string): Side => (index.homeIds.has(id as string) ? 'home' : 'away')
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home')
  const teams: Record<Side, TeamStats> = { home: blankTeam(), away: blankTeam() }
  const byPeriod: Record<Side, TeamStats[]> = { home: [], away: [] }
  const lines = new Map<string, PlayerLine>()
  const shots: ShotPoint[] = []
  const goals: GoalSummary[] = []
  const penalties: PenaltySummary[] = []

  const line = (id: PlayerRef | string): PlayerLine => {
    const key = id as string
    let l = lines.get(key)
    if (!l) {
      l = blankLine(key, index.names[key] ?? key, sideOf(key), index.positions[key] ?? 'F')
      lines.set(key, l)
    }
    return l
  }
  const per = (side: Side, period: number): TeamStats => {
    const list = byPeriod[side]
    while (list.length < period) list.push(blankTeam())
    return list[period - 1]!
  }
  const both = (side: Side, period: number, f: (t: TeamStats) => void): void => {
    f(teams[side])
    f(per(side, period))
  }
  const inPeriod = (absT: number, period: number): number => absT - (index.periodStarts.get(period) ?? (period - 1) * 1200)

  // Goalie of record, kept current from the frames' goalie changes and saves.
  const goalie: Record<Side, string | null> = { home: null, away: null }
  const goalieSince: Record<Side, number> = { home: 0, away: 0 }
  let gci = 0
  const creditGoalieToi = (side: Side, at: number): void => {
    const g = goalie[side]
    if (g) line(g).toi += Math.max(0, at - goalieSince[side])
    goalieSince[side] = at
  }
  const syncGoalies = (at: number): void => {
    while (gci < index.goalieChanges.length && index.goalieChanges[gci]!.absT <= at) {
      const c = index.goalieChanges[gci++]!
      creditGoalieToi(c.side, c.absT)
      goalie[c.side] = c.goalie
      line(c.goalie).isGoalie = true
    }
  }

  // On-ice skaters per side (lineChange), for plus/minus and TOI.
  const onIce: Record<Side, string[]> = { home: [], away: [] }
  const shiftStart: Record<Side, number> = { home: 0, away: 0 }
  const closeShift = (side: Side, at: number): void => {
    const skated = Math.max(0, at - shiftStart[side])
    for (const id of onIce[side]) line(id).toi += skated
    shiftStart[side] = at
  }

  let score = { home: 0, away: 0 }
  let shootoutWinner: Side | null = null
  let period = 1
  let ended = false

  for (const { absT, ev } of index.events) {
    if (absT > limit) break
    period = ev.period
    syncGoalies(absT)
    switch (ev.type) {
      case 'shot': {
        const side = sideOf(ev.shooter)
        const xg = Math.max(0, Math.min(1, ev.danger)) * XG_PER_DANGER
        const l = line(ev.shooter)
        l.shots++
        l.xg += xg
        both(side, ev.period, (t) => { t.shots++; t.xg += xg })
        shots.push({
          absT, period: ev.period, side, shooter: ev.shooter as string,
          x: ev.from.x, y: ev.from.y, attackSign: sign(ev.target.x || ev.from.x),
          xg, result: 'save', emptyNet: false, goalie: goalie[other(side)],
        })
        break
      }
      case 'missedShot': {
        const side = sideOf(ev.shooter)
        line(ev.shooter).missed++
        both(side, ev.period, (t) => { t.missed++ })
        shots.push({
          absT, period: ev.period, side, shooter: ev.shooter as string,
          x: ev.from.x, y: ev.from.y, attackSign: sign(ev.target.x || ev.from.x),
          xg: 0, result: ev.result === 'post' ? 'post' : 'miss', emptyNet: false, goalie: null,
        })
        break
      }
      case 'blockedShot': {
        const side = sideOf(ev.shooter)
        line(ev.shooter).attemptsBlocked++
        line(ev.blocker).blocks++
        both(side, ev.period, (t) => { t.blockedAgainst++ })
        both(other(side), ev.period, (t) => { t.blocks++ })
        shots.push({
          absT, period: ev.period, side, shooter: ev.shooter as string,
          x: ev.pos.x, y: ev.pos.y, attackSign: sign(ev.pos.x),
          xg: 0, result: 'block', emptyNet: false, goalie: null,
        })
        break
      }
      case 'save': {
        const g = line(ev.goalie)
        g.isGoalie = true
        const side = sideOf(ev.goalie)
        if (goalie[side] !== (ev.goalie as string)) {
          creditGoalieToi(side, absT)
          goalie[side] = ev.goalie as string
        }
        // The shot this save answered: the latest unresolved shot at this net.
        for (let i = shots.length - 1; i >= 0 && absT - shots[i]!.absT <= 4; i--) {
          const s = shots[i]!
          if (s.side !== side && s.result === 'save') { s.goalie = ev.goalie as string; break }
        }
        break
      }
      case 'goal': {
        const side = sideOf(ev.scorer)
        score = side === 'home' ? { home: score.home + 1, away: score.away } : { home: score.home, away: score.away + 1 }
        if (isShootoutDecider(ev)) {
          // The engine records a shootout win as a nominal goal at the end of
          // OT (fullSim.ts shootout): it counts on the scoreboard, but it is
          // not a player goal, not a shot, and nobody's goal against.
          teams[side].goals++
          shootoutWinner = side
          goals.push({
            absT, period: ev.period, clock: periodClock(inPeriod(absT, ev.period)), side,
            scorerId: ev.scorer as string, scorerName: index.names[ev.scorer as string] ?? (ev.scorer as string),
            assistIds: [], assistNames: [], strength: ev.strength, home: score.home, away: score.away, shootout: true,
          })
          break
        }
        both(side, ev.period, (t) => {
          t.goals++
          if (ev.strength === 'pp') t.powerPlayGoals++
          if (ev.strength === 'sh') t.shortHandedGoals++
        })
        const s = line(ev.scorer)
        s.goals++
        ev.assists.forEach((a, i) => {
          const al = line(a)
          al.assists++
          if (i === 0) al.primaryAssists++
        })
        // Resolve the shot this goal came from (same shooter, within a few seconds).
        let shot: ShotPoint | undefined
        for (let i = shots.length - 1; i >= 0 && absT - shots[i]!.absT <= 4; i--) {
          const c = shots[i]!
          if (c.shooter === (ev.scorer as string) && c.result === 'save') { shot = c; break }
        }
        if (!shot) {
          // Defensive: a goal with no shot event still belongs on the map.
          shot = {
            absT, period: ev.period, side, shooter: ev.scorer as string,
            x: ev.pos.x, y: ev.pos.y, attackSign: sign(ev.pos.x),
            xg: 0, result: 'save', emptyNet: false, goalie: goalie[other(side)],
          }
          shots.push(shot)
          s.shots++
          both(side, ev.period, (t) => { t.shots++ })
        }
        shot.result = 'goal'
        shot.emptyNet = ev.strength === 'en'
        if (shot.emptyNet) shot.goalie = null
        if (ev.strength !== 'pp') {
          for (const id of onIce[side]) line(id).plusMinus++
          for (const id of onIce[other(side)]) line(id).plusMinus--
        }
        goals.push({
          absT, period: ev.period, clock: periodClock(inPeriod(absT, ev.period)), side,
          scorerId: ev.scorer as string, scorerName: index.names[ev.scorer as string] ?? (ev.scorer as string),
          assistIds: ev.assists.map((a) => a as string),
          assistNames: ev.assists.map((a) => index.names[a as string] ?? (a as string)),
          strength: ev.strength, home: score.home, away: score.away,
        })
        break
      }
      case 'hit': {
        line(ev.by).hits++
        line(ev.on).hitsTaken++
        both(sideOf(ev.by), ev.period, (t) => { t.hits++ })
        break
      }
      case 'takeaway': {
        line(ev.by).takeaways++
        both(sideOf(ev.by), ev.period, (t) => { t.takeaways++ })
        break
      }
      case 'giveaway': {
        line(ev.player).giveaways++
        both(sideOf(ev.player), ev.period, (t) => { t.giveaways++ })
        break
      }
      case 'faceoff': {
        const w = sideOf(ev.winner)
        line(ev.winner).faceoffWins++
        if (ev.loser) line(ev.loser).faceoffLosses++
        both(w, ev.period, (t) => { t.faceoffWins++; t.faceoffs++ })
        both(other(w), ev.period, (t) => { t.faceoffs++ })
        break
      }
      case 'penalty': {
        const side = sideOf(ev.player)
        const l = line(ev.player)
        l.penaltyMinutes += ev.minutes
        l.penaltiesTaken++
        if (ev.drawnBy) line(ev.drawnBy).penaltiesDrawn++
        both(side, ev.period, (t) => { t.penaltyMinutes += ev.minutes })
        if (ev.infraction !== 'fighting') both(other(side), ev.period, (t) => { t.powerPlays++ })
        penalties.push({
          absT, period: ev.period, clock: periodClock(inPeriod(absT, ev.period)), side,
          playerId: ev.player as string, playerName: index.names[ev.player as string] ?? (ev.player as string),
          infraction: ev.infraction, minutes: ev.minutes,
        })
        break
      }
      case 'lineChange': {
        const first = ev.onIce[0]
        if (first === undefined) break
        const side = sideOf(first)
        closeShift(side, absT)
        onIce[side] = ev.onIce.map((id) => id as string)
        for (const id of onIce[side]) line(id)
        break
      }
      case 'periodEnd':
      case 'gameEnd':
        closeShift('home', absT)
        closeShift('away', absT)
        if (ev.type === 'gameEnd') ended = true
        break
      default:
        break
    }
  }

  // Close the open shifts and goalie spells at the fold's clock.
  const at = Math.min(limit, index.duration)
  syncGoalies(at)
  if (!ended) {
    closeShift('home', at)
    closeShift('away', at)
  }
  creditGoalieToi('home', at)
  creditGoalieToi('away', at)
  if (at >= index.duration) ended = true

  // Goalie lines from the resolved shots.
  for (const s of shots) {
    if (!s.goalie || s.emptyNet || (s.result !== 'save' && s.result !== 'goal')) continue
    const g = line(s.goalie)
    g.isGoalie = true
    g.shotsAgainst++
    g.xga += s.xg
    if (s.result === 'goal') g.goalsAgainst++
    else {
      g.saves++
      if (s.xg >= HIGH_DANGER_XG) g.highDangerSaves++
    }
  }
  // Make sure both periods-so-far exist for both sides (a scoreless, shotless
  // stretch still prints a row of zeroes).
  per('home', period)
  per('away', period)

  return {
    upTo: at,
    period,
    home: teams.home,
    away: teams.away,
    byPeriod: { home: byPeriod.home, away: byPeriod.away },
    players: [...lines.values()],
    shots,
    goals,
    penalties,
    elapsed: at,
    ended,
    shootoutWinner,
  }
}

/**
 * The shootout decider as the engine emits it (fullSim.ts `shootout`): a goal
 * in overtime, unassisted, placed exactly at centre ice. A real goal carries
 * the position it was scored from, never the exact origin. (The nominal
 * scorer is the winner's best forward, who may well have just had a shot in
 * OT, so "no shot behind it" is not a usable test.)
 */
function isShootoutDecider(ev: Extract<GameEvent, { type: 'goal' }>): boolean {
  return ev.period >= 4 && ev.assists.length === 0 && ev.pos.x === 0 && ev.pos.y === 0
}

/** Current score and whose it is, from the user's chair. */
export function userScore(stats: MatchStats, userSide: Side): { us: number; them: number } {
  return userSide === 'home'
    ? { us: stats.home.goals, them: stats.away.goals }
    : { us: stats.away.goals, them: stats.home.goals }
}
