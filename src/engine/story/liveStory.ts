/**
 * LIVE STORY — the career's story on screen while a game is watched.
 *
 * Three outputs, all from facts the career already holds plus what the event
 * stream shows happening tonight:
 *
 *  1. Story lower-thirds: TV graphics at natural moments (a whistle, the
 *     settle after a goal) about a man ON THE ICE right then — his point
 *     streak, his contract year, the club that drafted or traded him, the
 *     milestone he is chasing, the goalie's shutout run, the season series.
 *  2. Bench-cam vignettes (the user's bench only): the captain after a goal
 *     against, the man whose turnover led to it, the rookie before his first
 *     shift, the player sore about his minutes, the feud on the same shift.
 *  3. The room at intermission: a veteran's word and the trainer's update.
 *
 * The career gathers {@link LiveStoryFacts} BEFORE the sim runs (so every
 * count is "before tonight"); {@link planLiveStory} reads the finished stream
 * and places the beats. Pure and deterministic: the same game always plans the
 * same beats, and nothing here touches Career.
 *
 * Evidence rules: every line is rendered from a fact in the inputs; a line
 * about tonight (an extended streak, an ended drought, a shutout through two)
 * fires only after the stream shows the event that makes it true. Rate limits
 * keep it a broadcast, not a ticker: a few per period, never the same card or
 * vignette twice, never two graphics on screen at once.
 */
import type { GameEvent, GameStream } from '@domain'
import { playAbsT, streamPeriodBases } from '@domain'
import { renderTemplate, type ContentCtx, type ContentVariant } from './contentEngine'
import { pickStable, possessive, stableSeed } from './prose'
import { BROADCAST_GOAL_MILES, BROADCAST_POINT_MILES } from './broadcastStorylines'
import {
  BENCH_BENCHED, BENCH_BOX, BENCH_CAPTAIN_RALLY, BENCH_DEBUT, BENCH_FEUD_GOAL, BENCH_FEUD_SHIFT, BENCH_SORE,
  BENCH_TURNOVER, LT_CONTRACT_YEAR, LT_DRAFTED_OPP, LT_DRAFTED_OWN, LT_DROUGHT, LT_DROUGHT_LIVE, LT_FORMER_CLUB,
  LT_MILESTONE, LT_MILESTONE_LIVE, LT_POINT_STREAK, LT_POINT_STREAK_LIVE, LT_RIVALRY, LT_ROOKIE, LT_SEASON_SERIES,
  LT_SHUTOUTS, LT_SHUTOUT_BID, LT_SHUTOUT_RUN, ROOM_TRAINER, ROOM_VETERAN,
  LT_BAD_BLOOD, LT_HEAT_ANSWER, LT_HEAT_FACE, LT_HEAT_REPEAT, LT_HEAT_STAR, LT_HEAT_TEAM,
} from './liveStoryPools'
import { computeGameHeat, gameHeatAt, topScorers, type GameHeat } from './rivalryHeat'
import { pairKey, type CarriedHeat, type HeatIncident } from '@engine/shared/heat'

export type LiveSide = 'home' | 'away'

/* ─────────────────────────── facts (career → here) ─────────────────────────── */

/** One dressed player, as the story layer needs him. Counts are BEFORE tonight. */
export interface LivePlayerFacts {
  id: string
  name: string
  side: LiveSide
  position: string
  age: number
  captain?: boolean
  /** Consecutive games with a point / without one (skaters; 0 when unknown). */
  pointStreak: number
  scorelessStreak: number
  seasonGames: number
  seasonGoals: number
  seasonAssists: number
  /** Final season of his contract (regular season only). */
  contractYear?: { capHit: number }
  /** Draft pedigree, from the record on the player. */
  drafted?: { year: number; round: number; overall: number; club: string }
  /** Club he plays for tonight (name) — to tell "drafted here" from "drafted by them". */
  clubName: string
  /** Tonight's opponent (name). */
  opponentName: string
  /** First NHL season (Calder rule). */
  rookieSeason?: boolean
  /** He left tonight's opponent (trade or signing) within the last two seasons. */
  formerClub?: { teamName: string; leftYear: number; via: 'trade' | 'signing'; inexact?: true }
  /** We trust his NHL career record (careerLedger evidence rule). */
  careerKnown: boolean
  /** NHL career totals before tonight (only meaningful when careerKnown). */
  career: { goals: number; points: number; gamesPlayed: number }
  /** Goalies only. */
  goalie?: {
    starter: boolean
    /** Consecutive shutouts in his most recent appearances. */
    shutoutRun: number
    seasonShutouts: number
    saves: number
    shotsAgainst: number
  }
}

/** A completed meeting between tonight's two clubs this season. */
export interface SeriesGame {
  homeAbbr: string
  awayAbbr: string
  homeGoals: number
  awayGoals: number
  decidedBy: 'regulation' | 'overtime' | 'shootout'
}

/** The user's bench: what the role-play beats may draw on. */
export interface BenchFacts {
  side: LiveSide
  captainId: string | null
  /** Dressed players making their NHL debut tonight (evidence-gated). */
  debutIds: string[]
  /** Men out injured (not dressed): the trainer's update. */
  injured: Array<{ id: string; name: string; injury: string; gamesRemaining: number }>
  /** Dressed players with a sore morale memory about their minutes. */
  sore: Array<{ id: string; kind: 'scratched' | 'buried'; note: string }>
  /** Live feuds between two dressed teammates ({since} = "Nov 12"). */
  feuds: Array<{ aId: string; bId: string; since: string }>
  /** Dressed skaters who could speak up in the room: NHL games when his
   *  career is known (null otherwise), and his age. */
  veterans: Array<{ id: string; gamesPlayed: number | null; age: number }>
}

export interface LiveStoryFacts {
  /** Stable per game: seeds every pick. */
  gameKey: string
  year: number
  playoff: boolean
  homeName: string
  awayName: string
  homeAbbr: string
  awayAbbr: string
  /** The GM's side, null when he isn't playing (dev exhibitions of two others). */
  userSide: LiveSide | null
  /** This season's completed meetings, oldest first (regular season). */
  seasonSeries: SeriesGame[]
  /** A registered rivalry between the two clubs. */
  rivalry?: { label: string; reasons: string[]; meetings: number }
  /** All-time head to head, HOME club first. Only when there is one. */
  allTime?: { homeWins: number; awayWins: number; homeSeriesWins: number; awaySeriesWins: number }
  players: LivePlayerFacts[]
  bench?: BenchFacts
  /** Standing cards shown on recent watched games: they sit this one out. */
  resting?: string[]
  /** Rivalry heat carried in from earlier meetings (league/heatLedger.ts). Additive. */
  heat?: LiveHeatFacts
}

/** Two men with history from an earlier meeting, one dressed on each side tonight. */
export interface LiveHeatPair {
  /** Who did it (the hitter, the man penalised; a fight: the home fighter that night). */
  byId: string
  /** Who it was done to. */
  onId: string
  kind: 'fight' | 'bigHit' | 'cheapShot' | 'afterWhistle' | 'feud'
  /** Carried heat, 0..1. */
  heat: number
  /** "Nov 12". */
  date: string
  /** '' (this season) or ' last season' / ' in 2025' — appended to the date. */
  seasonTail: string
  /** Meetings both have dressed for since (tonight not counted). */
  meetingsSince: number
  /** cheapShot / afterWhistle: the call, as the sim named it. */
  infraction?: string
  /** bigHit: it put him down. */
  down?: boolean
  /** feud: the club they shared. */
  club?: string
}

export interface LiveHeatFacts {
  /** The club pairing's carried heat, 0..1. */
  team: number
  pairs: LiveHeatPair[]
}

/* ─────────────────────────── outputs ─────────────────────────── */

export type LowerThirdKind =
  | 'pointStreak' | 'drought' | 'contractYear' | 'drafted' | 'formerClub' | 'rookie'
  | 'milestone' | 'shutoutRun' | 'shutouts' | 'shutoutBid' | 'seasonSeries' | 'rivalry'
  /** Rivalry heat: history from an earlier meeting / tonight's run-ins. */
  | 'badBlood' | 'heat'

export type BenchKind =
  | 'captainRally' | 'turnover' | 'penaltyBox' | 'debut' | 'benched' | 'sore' | 'feudShift' | 'feudGoal'

export interface LiveBeat {
  id: string
  channel: 'lowerThird' | 'bench'
  kind: LowerThirdKind | BenchKind
  /** Absolute playback second it goes up. */
  at: number
  /** Seconds on screen at 1×. */
  holdS: number
  side: LiveSide
  playerId?: string
  /** Lower-third kicker ("POINT STREAK") or the bench tag ("BENCH"). */
  title: string
  text: string
}

export interface RoomBeat {
  kind: 'veteran' | 'trainer'
  /** Who is talking: a player's name, or "Trainer". */
  speaker: string
  playerId?: string
  text: string
}

export interface LiveStoryPlan {
  beats: LiveBeat[]
  /** Intermission beats, keyed by the period that just ended. */
  room: Record<number, RoomBeat[]>
}

/* ─────────────────────────── limits ─────────────────────────── */

/** Lower-thirds per regulation period / per overtime period. */
export const LT_MAX_PER_PERIOD = 3
export const LT_MAX_PER_OT = 1
/** Game seconds between two lower-thirds. */
export const LT_MIN_GAP_S = 150
export const LT_HOLD_S = 7
/** Bench vignettes per regulation period / per overtime period. */
export const BENCH_MAX_PER_PERIOD = 2
export const BENCH_MAX_PER_OT = 1
export const BENCH_MIN_GAP_S = 90
export const BENCH_HOLD_S = 7.5
/** Nothing else goes up within this many seconds of another graphic going down. */
export const CROSS_GAP_S = 2
/** A turnover counts when the goal against follows within this many seconds. */
export const TURNOVER_WINDOW_S = 15
/** "No shift since" needs this much third-period clock without one. */
export const BENCHED_MIN_S = 600
/** Seconds after a goal before its story beat (celebration + goal graphics). */
export const GOAL_SETTLE_S = 16
/** A "no shift since" beat needs a regular: this many shifts before the third. */
export const BENCHED_MIN_SHIFTS = 5
/** Contract-year cards: a big number coming off, or a UFA producing. */
export const CONTRACT_STORY_CAP = 2_500_000
/** An engine that doesn't name the infraction says this. */
const GENERIC_INFRACTION = /^(minor|major|penalty|misconduct)$/i

/* ─────────────────────────── helpers ─────────────────────────── */

function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** "$6.5 million" / "$925K". */
export function capText(dollars: number): string {
  const m = dollars / 1_000_000
  if (m >= 1) return `$${(Math.round(m * 10) / 10).toString()} million`
  return `$${Math.round(dollars / 1000)}K`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
function needWords(n: number, unit: 'point' | 'goal'): string {
  return `${NUMBER_WORDS[n] ?? n} ${n === 1 ? unit : `${unit}s`}`
}

function nextMile(value: number, ladder: readonly number[]): number | null {
  for (const m of ladder) if (m > value) return m
  return null
}

const fmt = (n: number): string => n.toLocaleString('en-US')

/** "M:SS" elapsed in the period. */
export function clockText(tInPeriod: number): string {
  const s = Math.max(0, Math.floor(tInPeriod))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function periodWord(period: number): string {
  if (period === 1) return 'first'
  if (period === 2) return 'second'
  if (period === 3) return 'third'
  return 'overtime'
}

/** The part of a sim injury description a trainer says out loud:
 *  "blocked a shot — bruised foot" → "bruised foot". */
export function injuryShort(desc: string): string {
  return (desc.includes('—') ? desc.split('—').pop()! : desc).trim()
}

function capFirst(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s
}

function render(pool: ContentVariant[], ctx: ContentCtx, key: string, slots: Record<string, string>): string {
  const v = pickStable(pool, ctx, key)
  return v ? renderTemplate(v.text, slots) : ''
}

/** Which net each side attacks, per period, read off where its shots went. */
export function attackSigns(stream: GameStream, sideOf: (pid: string) => LiveSide | null): Map<number, Record<LiveSide, 1 | -1>> {
  const tally = new Map<number, { home: number; away: number }>()
  for (const ev of stream) {
    if (ev.type !== 'shot' && ev.type !== 'missedShot') continue
    const side = sideOf(ev.shooter as string)
    if (!side) continue
    const t = tally.get(ev.period) ?? { home: 0, away: 0 }
    t[side] += ev.target.x >= 0 ? 1 : -1
    tally.set(ev.period, t)
  }
  const out = new Map<number, Record<LiveSide, 1 | -1>>()
  for (const [p, t] of tally) {
    // One side's read is enough; the other attacks the far net.
    const lead = Math.abs(t.home) >= Math.abs(t.away) ? 'home' : 'away'
    const sign: 1 | -1 = (lead === 'home' ? t.home : t.away) >= 0 ? 1 : -1
    out.set(p, lead === 'home' ? { home: sign, away: (-sign) as 1 | -1 } : { away: sign, home: (-sign) as 1 | -1 })
  }
  return out
}

/** "in his own end" / "in the neutral zone" / "in the offensive zone" ('' if unknown). */
function zonePhrase(x: number, attackSign: 1 | -1 | undefined): string {
  if (attackSign === undefined) return ''
  const rel = x * attackSign
  if (rel < -0.25) return 'in his own end'
  if (rel > 0.25) return 'in the offensive zone'
  return 'in the neutral zone'
}

/* ─────────────────────────── cards (before tonight) ─────────────────────────── */

interface Card {
  id: string
  kind: LowerThirdKind
  side: LiveSide
  playerId?: string
  title: string
  text: string
  priority: number
  /** Team-level card: eligible at any whistle early in the game. */
  team?: boolean
}

/** A drought is a story when the man usually scores: 8+ games without a
 *  point from a skater producing at least 0.4 points a game this season. */
function coldScorer(p: LivePlayerFacts): boolean {
  return p.scorelessStreak >= 8 && p.seasonGames >= 15 && (p.seasonGoals + p.seasonAssists) / p.seasonGames >= 0.4
}

function surname(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] ?? name
}

/** Season-series line, from HOME's point of view of each listed game. */
function seriesCard(f: LiveStoryFacts, key: string): Card | null {
  if (f.playoff || f.seasonSeries.length === 0) return null
  let home = 0
  let away = 0
  for (const g of f.seasonSeries) {
    const homeWon = g.homeGoals > g.awayGoals
    const winner = homeWon ? g.homeAbbr : g.awayAbbr
    if (winner === f.homeAbbr) home++
    else if (winner === f.awayAbbr) away++
  }
  const last = f.seasonSeries[f.seasonSeries.length - 1]!
  const tail = last.decidedBy === 'overtime' ? ' (OT)' : last.decidedBy === 'shootout' ? ' (SO)' : ''
  const lastLine = last.homeGoals >= last.awayGoals
    ? `${last.homeAbbr} ${last.homeGoals}, ${last.awayAbbr} ${last.awayGoals}${tail}`
    : `${last.awayAbbr} ${last.awayGoals}, ${last.homeAbbr} ${last.homeGoals}${tail}`
  const tied = home === away
  const leaderHome = home > away
  const text = render(LT_SEASON_SERIES, { tied }, `${key}:series`, {
    leader: leaderHome ? f.homeAbbr : f.awayAbbr,
    trailer: leaderHome ? f.awayAbbr : f.homeAbbr,
    w: String(Math.max(home, away)),
    l: String(Math.min(home, away)),
    last: lastLine,
    Meeting: MEETING_WORDS[f.seasonSeries.length + 1] ?? ordinal(f.seasonSeries.length + 1),
    record: f.seasonSeries.length === 1 ? 'took the first one' : Math.max(home, away) === f.seasonSeries.length && f.seasonSeries.length === 2 ? 'have won both' : `have won ${Math.max(home, away)} of ${f.seasonSeries.length}`,
    played: String(f.seasonSeries.length),
  })
  return { id: 'series', kind: 'seasonSeries', side: 'home', title: 'SEASON SERIES', text, priority: 30, team: true }
}

const MEETING_WORDS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth']

const REASON_WORDS: Record<string, string> = {
  division: 'division rivals',
  'playoff history': 'playoff history',
  'chippy games': 'a run of chippy games',
  'close races': 'close races in the standings',
}

function rivalryCard(f: LiveStoryFacts, key: string): Card | null {
  const r = f.rivalry
  if (!r) return null
  const words = r.reasons.map((x) => REASON_WORDS[x]).filter((x): x is string => !!x)
  if (words.length === 0) return null
  const joined = words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
  const reasons = joined[0]!.toUpperCase() + joined.slice(1)
  const at = f.allTime
  const total = at ? at.homeWins + at.awayWins : 0
  const history = !!at && total >= 3
  let allTime = ''
  let allTimeLead = ''
  if (at && history) {
    allTime = `${f.homeAbbr} ${at.homeWins}, ${f.awayAbbr} ${at.awayWins}`
    allTimeLead = at.homeWins === at.awayWins
      ? `dead even at ${at.homeWins} wins each`
      : at.homeWins > at.awayWins
        ? `${f.homeAbbr} lead ${at.homeWins}–${at.awayWins}`
        : `${f.awayAbbr} lead ${at.awayWins}–${at.homeWins}`
  }
  const text = render(LT_RIVALRY, { history }, `${key}:rivalry`, {
    reasons, reasonsLower: joined, allTime, allTimeLead, homeAbbr: f.homeAbbr, awayAbbr: f.awayAbbr,
    meetingsLine: r.meetings > 0 ? `${plural(r.meetings, 'meeting')} on the record.` : '',
  })
  return { id: 'rivalry', kind: 'rivalry', side: 'home', title: r.label.toUpperCase(), text, priority: 34, team: true }
}

/** Every card the facts earn, before tonight. Deterministic. */
export function buildLiveCards(f: LiveStoryFacts): Card[] {
  const key = f.gameKey
  const out: Card[] = []
  const s = seriesCard(f, key)
  if (s) out.push(s)
  const r = rivalryCard(f, key)
  if (r) out.push(r)

  for (const p of f.players) {
    const k = `${key}:${p.id}`
    const points = p.seasonGoals + p.seasonAssists
    const base = { name: p.name, last: surname(p.name), possName: possessive(p.name), points: String(points), goals: String(p.seasonGoals), assists: String(p.seasonAssists), age: String(p.age) }
    const isG = p.position === 'G'

    if (isG && p.goalie?.starter) {
      const g = p.goalie
      const svp = g.shotsAgainst > 0 ? `.${Math.round((g.saves / g.shotsAgainst) * 1000).toString().padStart(3, '0')}` : ''
      if (g.shutoutRun >= 1) {
        out.push({
          id: `so:${p.id}`, kind: 'shutoutRun', side: p.side, playerId: p.id, title: g.shutoutRun === 1 ? 'SHUTOUT' : 'SHUTOUT STREAK',
          text: render(LT_SHUTOUT_RUN, { single: g.shutoutRun === 1 }, k, { ...base, n: String(g.shutoutRun), so: String(g.seasonShutouts) }),
          priority: 60 + Math.min(20, g.shutoutRun * 6),
        })
      } else if (g.seasonShutouts >= 3 && svp) {
        out.push({
          id: `sh:${p.id}`, kind: 'shutouts', side: p.side, playerId: p.id, title: 'IN GOAL',
          text: render(LT_SHUTOUTS, {}, k, { ...base, so: String(g.seasonShutouts), svp }), priority: 36,
        })
      }
      continue
    }
    if (isG) continue

    // Streaks (skaters).
    if (p.pointStreak >= 4) {
      out.push({
        id: `ps:${p.id}`, kind: 'pointStreak', side: p.side, playerId: p.id, title: 'POINT STREAK',
        text: render(LT_POINT_STREAK, {}, k, { ...base, n: String(p.pointStreak) }),
        priority: 50 + Math.min(20, p.pointStreak * 2),
      })
    } else if (coldScorer(p)) {
      out.push({
        id: `dr:${p.id}`, kind: 'drought', side: p.side, playerId: p.id, title: 'DROUGHT',
        text: render(LT_DROUGHT, {}, k, { ...base, n: String(p.scorelessStreak) }), priority: 40,
      })
    }

    // Milestone chase (regular season, known careers only).
    if (!f.playoff && p.careerKnown) {
      const pm = nextMile(p.career.points, BROADCAST_POINT_MILES)
      const gm = nextMile(p.career.goals, BROADCAST_GOAL_MILES)
      const pNeed = pm !== null ? pm - p.career.points : Infinity
      const gNeed = gm !== null ? gm - p.career.goals : Infinity
      const pick = gNeed <= 2 ? { stat: 'goals' as const, need: gNeed, target: gm!, have: p.career.goals }
        : pNeed <= 3 ? { stat: 'points' as const, need: pNeed, target: pm!, have: p.career.points } : null
      if (pick) {
        out.push({
          id: `ms:${p.id}`, kind: 'milestone', side: p.side, playerId: p.id, title: 'MILESTONE WATCH',
          text: render(LT_MILESTONE, { captain: p.captain === true }, k, {
            ...base, stat: pick.stat, target: fmt(pick.target), have: fmt(pick.have),
            need: needWords(pick.need, pick.stat === 'goals' ? 'goal' : 'point'),
          }),
          priority: 75 - pick.need * 3,
        })
      }
    }

    // Old club across the ice.
    if (p.formerClub && f.year - p.formerClub.leftYear <= 1) {
      const fc = p.formerClub
      out.push({
        id: `fc:${p.id}`, kind: 'formerClub', side: p.side, playerId: p.id, title: fc.inexact ? 'OLD CLUB' : fc.via === 'trade' ? 'FACING HIS OLD CLUB' : 'OLD CLUB',
        text: render(LT_FORMER_CLUB, { via: fc.inexact ? 'past' : fc.via }, k, { ...base, club: fc.teamName, when: fc.leftYear === f.year ? 'this season' : `in ${fc.leftYear}` }),
        priority: 64,
      })
    }

    // Draft pedigree: drafted by tonight's opponent (any time), or by his own
    // club within the last four drafts.
    const d = p.drafted
    if (d) {
      const slots = { ...base, club: d.club, year: String(d.year), pick: ordinal(d.overall), round: ordinal(d.round) }
      if (d.club === p.opponentName && !p.formerClub) {
        out.push({ id: `dx:${p.id}`, kind: 'drafted', side: p.side, playerId: p.id, title: `${d.year} DRAFT`, text: render(LT_DRAFTED_OPP, {}, k, slots), priority: 46 })
      } else if (d.club === p.clubName && f.year - d.year <= 3 && (p.rookieSeason || (p.careerKnown && p.career.gamesPlayed < 82))) {
        out.push({ id: `do:${p.id}`, kind: 'drafted', side: p.side, playerId: p.id, title: `${d.year} DRAFT`, text: render(LT_DRAFTED_OWN, {}, k, slots), priority: 40 })
      }
    }

    // Rookie line: only when every NHL game he has is this season's, and only
    // when he's producing (a rookie with one point is not a graphic).
    if (p.rookieSeason && p.careerKnown && p.seasonGames >= 5 && p.career.gamesPlayed === p.seasonGames &&
        (points >= 8 || p.seasonGoals >= 4)) {
      out.push({
        id: `rk:${p.id}`, kind: 'rookie', side: p.side, playerId: p.id, title: 'ROOKIE',
        text: render(LT_ROOKIE, {}, k, { ...base, games: String(p.seasonGames), statLine: `${p.seasonGoals}G ${p.seasonAssists}A` }),
        priority: 38 + Math.min(12, points),
      })
    }

    // Contract year (regular season, skaters): a big number coming off the
    // books, or a pending UFA who is producing.
    const ufa = p.age >= 27
    if (!f.playoff && p.contractYear &&
        (p.contractYear.capHit >= CONTRACT_STORY_CAP || (ufa && p.seasonGames >= 10 && points >= p.seasonGames * 0.6))) {
      out.push({
        id: `cy:${p.id}`, kind: 'contractYear', side: p.side, playerId: p.id, title: 'CONTRACT YEAR',
        text: render(LT_CONTRACT_YEAR, { ufa }, k, { ...base, cap: capText(p.contractYear.capHit), pointsTail: p.seasonGames >= 10 ? ` ${plural(points, 'point')} so far.` : '' }),
        priority: 36,
      })
    }
  }
  // Standing cards that were on screen in the last few watched games sit out.
  const resting = new Set(f.resting ?? [])
  return out.filter((c) => !(STANDING.has(c.kind) && resting.has(c.id)))
}

/** Cards whose fact holds for weeks: they rest between broadcasts. */
const STANDING = new Set<LowerThirdKind>(['contractYear', 'drafted', 'formerClub', 'rookie', 'shutouts'])

/* ─────────────────────────── rivalry heat ─────────────────────────── */

/** Team heat this high (with penalties or a fight to show for it) puts up HEATING UP. */
export const HEAT_TEAM_CARD = 0.42
/** A card about a run-in in live play waits at most this long for the whistle. */
export const HEAT_WAIT_S = 60

const NTH_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
const nthWord = (n: number): string => NTH_WORDS[n] ?? ordinal(n)

/** Rivalry seeds the night: a grudge match starts warmer than a rivalry night. */
export function carriedHeatOf(f: LiveStoryFacts): CarriedHeat {
  const riv = f.rivalry ? (/grudge/i.test(f.rivalry.label) ? 0.55 : 0.35) : 0
  return {
    team: Math.max(riv, f.heat?.team ?? 0),
    pairs: (f.heat?.pairs ?? []).map((p) => ({ a: p.byId, b: p.onId, heat: p.heat })),
  }
}

/** Tonight's heat, from the stream and what the clubs and the men carried in. */
export function liveHeatOf(stream: GameStream, f: LiveStoryFacts): GameHeat {
  const byId = new Map(f.players.map((p) => [p.id, p]))
  return computeGameHeat(stream, {
    sideOf: (pid) => byId.get(pid)?.side ?? null,
    stars: new Set(topScorers(f.players).keys()),
    carried: carriedHeatOf(f),
  })
}

/** The BAD BLOOD card for a pair with history ('' when a slot can't be filled truthfully). */
function badBloodText(p: LiveHeatPair, nameOf: (id: string) => string, key: string): string {
  if ((p.kind === 'cheapShot' || p.kind === 'afterWhistle') && (!p.infraction || GENERIC_INFRACTION.test(p.infraction))) return ''
  if (p.kind === 'feud' && !p.club) return ''
  const n = p.meetingsSince + 1
  return render(LT_BAD_BLOOD, { kind: p.kind, first: p.meetingsSince === 0 }, `${key}:bb:${pairKey(p.byId, p.onId)}`, {
    a: surname(nameOf(p.byId)), b: surname(nameOf(p.onId)), date: p.date, seasonTail: p.seasonTail,
    nth: nthWord(n), Nth: capFirst(nthWord(n)), hitVerb: p.down ? 'flattened' : 'hammered',
    infraction: (p.infraction ?? '').toLowerCase(), club: p.club ?? '',
  })
}

/* ─────────────────────────── the plan ─────────────────────────── */

interface LtMoment {
  at: number
  period: number
  /** Ranked options; the scheduler takes the first one still unused. */
  options: Array<{ cardId: string; playerId?: string; kind: LowerThirdKind; side: LiveSide; title: string; text: string; score: number }>
}

interface BenchCandidate {
  at: number
  period: number
  kind: BenchKind
  playerId?: string
  /** Dedupe key: one per game. */
  key: string
  priority: number
  text: string
}

export interface PlanOptions {
  /** Windows [from, to] (absolute s) where another graphic already owns the screen. */
  busy?: Array<[number, number]>
}

/**
 * Place tonight's beats on the playback timeline. Deterministic.
 */
export function planLiveStory(stream: GameStream, f: LiveStoryFacts, opts: PlanOptions = {}): LiveStoryPlan {
  const bases = streamPeriodBases(stream)
  const abs = (ev: GameEvent): number => playAbsT(ev, bases)
  const byId = new Map(f.players.map((p) => [p.id, p]))
  const sideOf = (pid: string): LiveSide | null => byId.get(pid)?.side ?? null
  const signs = attackSigns(stream, sideOf)
  const cards = buildLiveCards(f)
  const cardsByPlayer = new Map<string, Card[]>()
  for (const c of cards) if (c.playerId) cardsByPlayer.set(c.playerId, [...(cardsByPlayer.get(c.playerId) ?? []), c])
  const teamCards = cards.filter((c) => c.team)
  const goalieCards = cards.filter((c) => c.kind === 'shutoutRun' || c.kind === 'shutouts')
  const key = f.gameKey
  const bench = f.userSide !== null ? f.bench : undefined
  const us = f.userSide
  const them: LiveSide | null = us === 'home' ? 'away' : us === 'away' ? 'home' : null

  const onIce: Record<LiveSide, Set<string>> = { home: new Set(), away: new Set() }
  const lineSeen: Record<LiveSide, boolean> = { home: false, away: false }
  const shiftStart = new Map<string, { period: number; t: number }>()
  const shiftsBeforeThird = new Map<string, number>()
  const everOn = new Set<string>()
  const tonightPts = new Map<string, number>()
  const score: Record<LiveSide, number> = { home: 0, away: 0 }
  const goalsAgainstBy: Record<LiveSide, number> = { home: 0, away: 0 }
  const curGoalie: Record<LiveSide, string | null> = { home: null, away: null }
  /** Shots on goal each side has faced (box-score saves = these minus goals). */
  const shotsFaced: Record<LiveSide, number> = { home: 0, away: 0 }
  const lastPeriod = stream.reduce((m, e) => Math.max(m, e.period), 1)
  let lastFaceoffAbs = -Infinity
  let framePeriod = 0
  let vetSpoke = false
  let lastTurnover: { pid: string; absT: number; period: number; how: 'giveaway' | 'pass'; x: number; interceptor?: string } | null = null
  const box = new Map<string, { until: number; period: number; infraction: string; minutes: number }>()
  const lt: LtMoment[] = []
  const benchC: BenchCandidate[] = []
  const room: Record<number, RoomBeat[]> = {}
  const savesThroughTwo: Record<LiveSide, number> = { home: 0, away: 0 }
  const debutPending = new Set(bench?.debutIds ?? [])
  const feudShiftSeen = new Set<string>()

  const nameOf = (pid: string): string => byId.get(pid)?.name ?? pid
  const heat = liveHeatOf(stream, f)
  const carriedPairs = (f.heat?.pairs ?? []).filter((p) => byId.has(p.byId) && byId.has(p.onId) && sideOf(p.byId) !== sideOf(p.onId))
  const carriedByKey = new Map(carriedPairs.map((p) => [pairKey(p.byId, p.onId), p]))
  const scoreLine = (): string => us ? `${score[us]}–${score[them!]}` : ''
  const userPlayer = (pid: string): boolean => !!us && sideOf(pid) === us

  /** Options for a lower-third at a whistle: the men on the ice right now. */
  const whistleMoment = (at: number, period: number, t: number, extra: LtMoment['options'] = []): void => {
    const options: LtMoment['options'] = [...extra]
    // Two men with history from an earlier meeting, both on the ice.
    for (const p of carriedPairs) {
      const sa = sideOf(p.byId)
      const sb = sideOf(p.onId)
      if (!sa || !sb || !onIce[sa].has(p.byId) || !onIce[sb].has(p.onId)) continue
      const text = badBloodText(p, nameOf, key)
      if (text) options.push({ cardId: `bb:${pairKey(p.byId, p.onId)}`, playerId: p.onId, kind: 'badBlood', side: sb, title: 'BAD BLOOD', text, score: 150 + Math.round(p.heat * 40) })
    }
    for (const side of ['home', 'away'] as const) {
      for (const pid of onIce[side]) {
        for (const c of cardsByPlayer.get(pid) ?? []) {
          if (c.kind === 'shutoutRun' || c.kind === 'shutouts') continue
          options.push({ cardId: c.id, playerId: pid, kind: c.kind, side: c.side, title: c.title, text: c.text, score: c.priority + 50 })
        }
      }
    }
    // Goalies are always on the ice: their cards are for the first period.
    if (period === 1) {
      for (const c of goalieCards) {
        if (c.playerId && curGoalie[c.side] === c.playerId) options.push({ cardId: c.id, playerId: c.playerId, kind: c.kind, side: c.side, title: c.title, text: c.text, score: c.priority + 30 })
      }
    }
    // Team cards: the first half of the game, strongest in the opening minutes.
    if (period === 1 || (period === 2 && t < 600)) {
      for (const c of teamCards) options.push({ cardId: c.id, kind: c.kind, side: c.side, title: c.title, text: c.text, score: c.priority + (period === 1 && t < 480 ? 110 : 0) })
    }
    // Shutout bid: the first half of the third, nothing past the starter yet.
    // The saves quoted are the ones he had at the end of the second.
    if (period === 3 && t < 600) {
      for (const side of ['home', 'away'] as const) {
        const gid = curGoalie[side]
        const g = gid ? byId.get(gid) : undefined
        if (!g || !g.goalie?.starter || goalsAgainstBy[side] > 0) continue
        // No goals against: every shot he faced was a save (the box score's count).
        const sv = savesThroughTwo[side]
        if (sv < 10) continue
        options.push({
          cardId: `sb:${gid}`, playerId: gid!, kind: 'shutoutBid', side, title: 'SHUTOUT WATCH',
          text: render(LT_SHUTOUT_BID, {}, `${key}:${gid}:sb`, { name: g.name, saves: String(sv) }), score: 160,
        })
      }
    }
    if (options.length > 0) lt.push({ at, period, options: options.sort((a, b) => b.score - a.score) })
  }

  /** A man got a point tonight: his live card (extended streak, ended drought, closer to the mark). */
  const liveOption = (pid: string, isScorer: boolean): LtMoment['options'][number] | null => {
    const p = byId.get(pid)
    if (!p || p.position === 'G') return null
    const pts = tonightPts.get(pid) ?? 0
    const k = `${key}:${pid}:live`
    const slots = { name: p.name }
    const bonus = isScorer ? 20 : 0
    if (pts === 1 && p.pointStreak >= 4) {
      return { cardId: `ps:${pid}:live`, playerId: pid, kind: 'pointStreak', side: p.side, title: 'POINT STREAK', text: render(LT_POINT_STREAK_LIVE, {}, k, { ...slots, n: String(p.pointStreak + 1) }), score: 190 + bonus }
    }
    if (pts === 1 && coldScorer(p)) {
      return { cardId: `dr:${pid}:live`, playerId: pid, kind: 'drought', side: p.side, title: 'DROUGHT OVER', text: render(LT_DROUGHT_LIVE, {}, k, { ...slots, n: String(p.scorelessStreak) }), score: 185 + bonus }
    }
    if (!f.playoff && p.careerKnown) {
      const goalsTonight = goalsTonightOf.get(pid) ?? 0
      const goals = p.career.goals + goalsTonight
      const points = p.career.points + pts
      const gm = nextMile(p.career.goals, BROADCAST_GOAL_MILES)
      const pm = nextMile(p.career.points, BROADCAST_POINT_MILES)
      const g = gm !== null && gm - p.career.goals <= 2 && goals < gm && goalsTonight > 0 ? { stat: 'goals', target: gm, have: goals, need: gm - goals } : null
      const q = !g && pm !== null && pm - p.career.points <= 3 && points < pm ? { stat: 'points', target: pm, have: points, need: pm - points } : null
      const m = g ?? q
      if (m) {
        return {
          cardId: `ms:${pid}:live:${m.have}`, playerId: pid, kind: 'milestone', side: p.side, title: 'MILESTONE WATCH',
          text: render(LT_MILESTONE_LIVE, {}, `${k}:${m.have}`, { ...slots, stat: m.stat, target: fmt(m.target), have: fmt(m.have), need: needWords(m.need, m.stat === 'goals' ? 'goal' : 'point') }),
          score: 180 + bonus,
        }
      }
    }
    return null
  }
  const goalsTonightOf = new Map<string, number>()

  /* ── rivalry heat: tonight's run-ins, placed at the stoppage after them ── */
  const whistles: Array<{ at: number; period: number }> = []
  const faceoffs: number[] = []
  for (const ev of stream) {
    if (ev.type === 'whistle' && ev.reason !== 'goal') whistles.push({ at: abs(ev), period: ev.period })
    else if (ev.type === 'faceoff') faceoffs.push(abs(ev))
  }
  /** The whistle that ends live play after a run-in (null if it is too far off). */
  const liveAt = (t: number): { at: number; period: number } | null => {
    const w = whistles.find((x) => x.at >= t - 0.5)
    return w && w.at - t <= HEAT_WAIT_S ? { at: w.at + 1, period: w.period } : null
  }
  /** At a stoppage (a penalty call, a fight): after the call's own graphic, or with the next set. */
  const stoppageAt = (t: number): number => {
    const fo = faceoffs.find((x) => x > t)
    return fo !== undefined && fo - t < 240 ? Math.max(t + 9, fo - 3.5) : t + 9
  }
  const clockOf = (inc: HeatIncident): { clock: string; period: string } => ({ clock: clockText(inc.t), period: periodWord(inc.period) })
  const tonightByPair = new Map<string, HeatIncident[]>()
  const hitCount = new Map<string, number>()
  const faceOptions = new Map<string, LtMoment['options'][number]>()
  const ranks = topScorers(f.players)
  const pointsOf = (pid: string): number => { const p = byId.get(pid); return p ? p.seasonGoals + p.seasonAssists : 0 }
  for (const inc of heat.incidents) {
    if (inc.kind === 'chirp') continue
    const k = pairKey(inc.by, inc.on)
    const prior = tonightByPair.get(k) ?? []
    const carried = carriedByKey.get(k)
    const a = surname(nameOf(inc.by))
    const b = surname(nameOf(inc.on))
    const ik = `${key}:heat:${inc.period}:${Math.round(inc.t)}:${k}`
    const opts: LtMoment['options'] = []
    const boil = (): void => {
      if (!carried) return
      const text = badBloodText(carried, nameOf, key)
      if (text) opts.push({ cardId: `bb:${k}`, playerId: carried.onId, kind: 'badBlood', side: sideOf(carried.onId) ?? 'home', title: 'BAD BLOOD', text, score: 205 })
    }
    if (inc.kind === 'goalInFace') {
      const first = prior.find((x) => x.kind !== 'hit')
      const text = first
        ? render(LT_HEAT_FACE, { when: 'tonight' }, ik, { s: a, o: b, ...clockOf(first), date: '', seasonTail: '' })
        : carried
          ? render(LT_HEAT_FACE, { when: 'before' }, ik, { s: a, o: b, clock: '', period: '', date: carried.date, seasonTail: carried.seasonTail })
          : ''
      if (text) faceOptions.set(`${inc.period}:${inc.t}:${inc.by}`, { cardId: `hf:${k}`, playerId: inc.by, kind: 'heat', side: inc.side, title: 'BAD BLOOD', text, score: 188 })
      continue
    }
    tonightByPair.set(k, [...prior, inc])
    let at: number | null = null
    let period = inc.period
    if (inc.kind === 'hit' || inc.kind === 'bigHit') {
      const hk = `${inc.by}>${inc.on}`
      const n = (hitCount.get(hk) ?? 0) + 1
      hitCount.set(hk, n)
      const firstHit = prior.find((x) => (x.kind === 'hit' || x.kind === 'bigHit') && x.by === inc.by)
      if (firstHit && (n >= 3 || (n >= 2 && inc.kind === 'bigHit' && inc.down === true))) {
        opts.push({
          cardId: `hr:${hk}:${n}`, playerId: inc.on, kind: 'heat', side: inc.side, title: 'BAD BLOOD',
          text: render(LT_HEAT_REPEAT, { kind: 'hit' }, ik, { a, b, n: NUMBER_WORDS[n] ?? String(n), nth: nthWord(n), Nth: capFirst(nthWord(n)), infraction: '', ...clockOf(firstHit) }),
          score: 170,
        })
      }
      if (inc.kind === 'bigHit') boil()
      const w = liveAt(inc.absT)
      if (w) { at = w.at; period = w.period }
    } else if (inc.kind === 'cheapShot' || inc.kind === 'afterWhistle') {
      const inf = inc.infraction ?? ''
      if (inf && !GENERIC_INFRACTION.test(inf)) {
        const infraction = inf.toLowerCase()
        // a real run-in first: a big hit, a call, a fight (a routine check is not one)
        const runIn = prior.find((x) => x.kind !== 'hit')
        if (runIn) {
          opts.push({
            cardId: `hp:${k}:${Math.round(inc.absT)}`, playerId: inc.on, kind: 'heat', side: inc.side, title: 'BAD BLOOD',
            text: render(LT_HEAT_REPEAT, { kind: 'penalty' }, ik, { a, b, infraction, n: '', nth: '', Nth: '', ...clockOf(runIn) }),
            score: 175,
          })
        } else if (inc.kind === 'cheapShot' && ranks.has(inc.on)) {
          const victim = byId.get(inc.on)
          const abbr = victim?.side === 'home' ? f.homeAbbr : f.awayAbbr
          opts.push({
            cardId: `hs:${inc.on}`, playerId: inc.on, kind: 'heat', side: inc.side, title: 'TOP SCORER',
            text: render(LT_HEAT_STAR, { rank: ranks.get(inc.on)! }, ik, { a, b, infraction, InfractionCap: capFirst(infraction), abbr, pts: String(pointsOf(inc.on)) }),
            score: 165,
          })
        }
      }
      boil()
      at = stoppageAt(inc.absT)
    } else if (inc.kind === 'fight') {
      const cause = prior.find((x) => x.kind !== 'fight')
      const inf = cause?.infraction ?? ''
      if (cause && (cause.kind === 'hit' || cause.kind === 'bigHit' || (inf && !GENERIC_INFRACTION.test(inf)))) {
        const hitCause = cause.kind === 'hit' || cause.kind === 'bigHit'
        opts.push({
          cardId: `ha:${k}`, playerId: cause.on, kind: 'heat', side: sideOf(cause.on) ?? inc.side, title: 'BAD BLOOD',
          text: render(LT_HEAT_ANSWER, { cause: hitCause ? 'hit' : 'penalty' }, ik, {
            x: surname(nameOf(cause.on)), y: surname(nameOf(cause.by)), infraction: inf.toLowerCase(), ...clockOf(cause),
          }),
          score: 210,
        })
      } else boil()
      at = stoppageAt(inc.absT)
    }
    if (at !== null && opts.length > 0) lt.push({ at, period, options: opts.sort((x, y) => y.score - x.score) })
  }
  let hitsSoFar = 0
  let pimSoFar = 0
  let fightsSoFar = 0
  let teamTries = 0
  const fightEvents = stream.some((e) => e.type === 'fight')

  for (const ev of stream) {
    switch (ev.type) {
      case 'frame': {
        curGoalie.home = ev.homeGoalie.player as string
        curGoalie.away = ev.awayGoalie.player as string
        // The first frame of a period seats its opening shifts; after that the
        // frames only fill in for a side whose changes the stream doesn't log.
        const newPeriod = ev.period !== framePeriod
        framePeriod = ev.period
        for (const side of ['home', 'away'] as const) {
          if (lineSeen[side] && !newPeriod) continue
          const set = new Set((side === 'home' ? ev.home : ev.away).map((s) => s.player as string))
          if (set.size > 0) {
            for (const pid of set) if (newPeriod || !onIce[side].has(pid)) startShift(pid, ev.period, ev.t, abs(ev))
            onIce[side] = set
          }
        }
        break
      }
      case 'lineChange': {
        const ids = ev.onIce.map((x) => x as string)
        const side = ids.map(sideOf).find((s): s is LiveSide => s !== null)
        if (!side) break
        lineSeen[side] = true
        const at = abs(ev)
        for (const pid of ids) if (!onIce[side].has(pid)) startShift(pid, ev.period, ev.t, at)
        onIce[side] = new Set(ids)
        // Feuding teammates on the same shift.
        if (bench && side === bench.side) {
          for (const fd of bench.feuds) {
            const fk = `${fd.aId}|${fd.bId}`
            if (feudShiftSeen.has(fk) || !onIce[side].has(fd.aId) || !onIce[side].has(fd.bId)) continue
            feudShiftSeen.add(fk)
            benchC.push({
              at: at + 4, period: ev.period, kind: 'feudShift', key: `feudShift:${fk}`, priority: 40,
              text: render(BENCH_FEUD_SHIFT, {}, `${key}:${fk}:fs`, { a: nameOf(fd.aId), b: nameOf(fd.bId), since: fd.since }),
            })
          }
        }
        break
      }
      case 'faceoff':
        lastFaceoffAbs = abs(ev)
        break
      case 'hit':
        hitsSoFar++
        break
      case 'fight':
        fightsSoFar++
        break
      case 'shot': {
        const side = sideOf(ev.shooter as string)
        if (side) shotsFaced[side === 'home' ? 'away' : 'home']++
        break
      }
      case 'giveaway':
        if (userPlayer(ev.player as string)) lastTurnover = { pid: ev.player as string, absT: abs(ev), period: ev.period, how: 'giveaway', x: ev.pos.x }
        break
      case 'pass':
        if (!ev.completed && ev.interceptedBy && userPlayer(ev.from as string)) {
          lastTurnover = { pid: ev.from as string, absT: abs(ev), period: ev.period, how: 'pass', x: ev.a.x, interceptor: ev.interceptedBy as string }
        }
        break
      case 'penalty': {
        pimSoFar += ev.minutes
        if (!fightEvents && ev.infraction === 'fighting') fightsSoFar += 0.5
        const pid = ev.player as string
        if (userPlayer(pid) && ev.minutes === 2) box.set(pid, { until: ev.t + 120, period: ev.period, infraction: ev.infraction, minutes: ev.minutes })
        break
      }
      case 'goal': {
        const at = abs(ev)
        const scorer = ev.scorer as string
        const side = sideOf(scorer)
        if (!side) break
        const against: LiveSide = side === 'home' ? 'away' : 'home'
        score[side]++
        goalsAgainstBy[against]++
        goalsTonightOf.set(scorer, (goalsTonightOf.get(scorer) ?? 0) + 1)
        const credited = [scorer, ...ev.assists.map((a) => a as string)]
        for (const pid of credited) tonightPts.set(pid, (tonightPts.get(pid) ?? 0) + 1)

        // Lower-third after the goal: a credited man's live card.
        const options: LtMoment['options'] = []
        credited.forEach((pid, i) => { const o = liveOption(pid, i === 0); if (o) options.push(o) })
        const face = faceOptions.get(`${ev.period}:${ev.t}:${scorer}`)
        if (face) options.push(face)
        if (options.length > 0) lt.push({ at: at + GOAL_SETTLE_S, period: ev.period, options: options.sort((a, b) => b.score - a.score) })

        // Bench beats (user's bench only).
        if (bench && us && them) {
          const gameOver = ev.period >= 4
          if (side === them && !gameOver) {
            // The turnover that started it.
            const to = lastTurnover
            if (to && to.period === ev.period && at - to.absT <= TURNOVER_WINDOW_S && at >= to.absT && lastFaceoffAbs < to.absT) {
              benchC.push({
                at: at + GOAL_SETTLE_S + 8, period: ev.period, kind: 'turnover', playerId: to.pid, key: `turnover:${to.pid}`, priority: 80,
                text: render(BENCH_TURNOVER, { how: to.how }, `${key}:${to.pid}:to`, {
                  name: nameOf(to.pid), where: zonePhrase(to.x, signs.get(ev.period)?.[us]), scorer: nameOf(scorer),
                  secs: String(Math.max(1, Math.round(at - to.absT))), interceptor: to.interceptor ? nameOf(to.interceptor) : 'they',
                }),
              })
            }
            // Power-play goal while one of ours sat for a minor.
            if (ev.strength === 'pp') {
              for (const [pid, b] of box) {
                if (b.period !== ev.period || ev.t > b.until) continue
                benchC.push({
                  at: at + 10, period: ev.period, kind: 'penaltyBox', playerId: pid, key: `box:${pid}`, priority: 75,
                  text: render(BENCH_BOX, { named: !GENERIC_INFRACTION.test(b.infraction) }, `${key}:${pid}:box`, { name: nameOf(pid), infraction: b.infraction.toLowerCase(), scorer: nameOf(scorer), possScorer: possessive(nameOf(scorer)) }),
                })
                box.delete(pid)
                break
              }
            }
            // The captain picks the bench up when it's tied or we trail.
            const cap = bench.captainId
            const diff = score[us] - score[them]
            if (cap && byId.has(cap) && diff <= 0) {
              const left = Math.max(0, 1200 - ev.t)
              const late = ev.period >= 4 || (ev.period === 3 && left <= 300)
              benchC.push({
                at: at + GOAL_SETTLE_S + 4, period: ev.period, kind: 'captainRally', playerId: cap, key: 'captainRally', priority: 70,
                text: render(BENCH_CAPTAIN_RALLY, { state: diff < 0 ? 'trail' : 'tied', late }, `${key}:rally:${score.home}-${score.away}`, {
                  captain: nameOf(cap), score: scoreLine(), left: ev.period >= 4 ? 'overtime' : clockText(left), period: periodWord(ev.period),
                }),
              })
            }
          }
          if (side === us) {
            for (const fd of bench.feuds) {
              if (!credited.includes(fd.aId) || !credited.includes(fd.bId)) continue
              benchC.push({
                at: at + GOAL_SETTLE_S + 6, period: ev.period, kind: 'feudGoal', key: `feudGoal:${fd.aId}|${fd.bId}`, priority: 65,
                text: render(BENCH_FEUD_GOAL, {}, `${key}:${fd.aId}:${fd.bId}:fg`, { a: nameOf(fd.aId), b: nameOf(fd.bId), since: fd.since }),
              })
            }
          }
        }
        lastTurnover = null
        break
      }
      case 'whistle': {
        if (ev.reason === 'goal') break
        const at = abs(ev) + 1
        const heatExtra: LtMoment['options'] = []
        const fights = Math.floor(fightsSoFar)
        if (teamTries < 4 && gameHeatAt(heat, abs(ev)) >= HEAT_TEAM_CARD && (pimSoFar >= 10 || fights >= 1) && hitsSoFar >= 6) {
          teamTries++
          heatExtra.push({
            cardId: 'heat:team', kind: 'heat', side: 'home', title: 'HEATING UP', score: 155,
            text: render(LT_HEAT_TEAM, {}, `${key}:heatTeam`, {
              pim: String(pimSoFar), hits: String(hitsSoFar), clock: clockText(ev.t), period: periodWord(ev.period),
              homeAbbr: f.homeAbbr, awayAbbr: f.awayAbbr,
              fightsTail: fights === 0 ? '' : fights === 1 ? ', plus a fight' : `, plus ${NUMBER_WORDS[fights] ?? fights} fights`,
            }),
          })
        }
        whistleMoment(at, ev.period, ev.t, heatExtra)
        if (bench && us) {
          // Sore about his minutes: a second-period whistle with him on the bench.
          if (ev.period === 2) {
            for (const s of bench.sore) {
              if (!byId.has(s.id) || onIce[us].has(s.id) || !everOn.has(s.id)) continue
              benchC.push({
                at, period: 2, kind: 'sore', playerId: s.id, key: `sore:${s.id}`, priority: 35,
                text: render(BENCH_SORE, { kind: s.kind }, `${key}:${s.id}:sore`, { name: nameOf(s.id), note: s.note.replace(/[.]$/, '') }),
              })
            }
          }
          // No shift for eight-plus minutes of the third.
          if (ev.period === 3) {
            for (const pid of everOn) {
              const p = byId.get(pid)
              if (!p || p.side !== us || p.position === 'G' || onIce[us].has(pid)) continue
              const st = shiftStart.get(pid)
              if (!st || st.period !== 3 || ev.t - st.t < BENCHED_MIN_S) continue
              if ((shiftsBeforeThird.get(pid) ?? 0) < BENCHED_MIN_SHIFTS) continue
              if ([...box.entries()].some(([b, v]) => b === pid && v.period === 3 && ev.t <= v.until)) continue
              benchC.push({
                at, period: 3, kind: 'benched', playerId: pid, key: `benched:${pid}`, priority: 50,
                text: render(BENCH_BENCHED, {}, `${key}:${pid}:bn`, { name: nameOf(pid), when: st.t < 5 ? 'the opening faceoff of the third' : `${clockText(st.t)} of the third` }),
              })
            }
          }
        }
        break
      }
      case 'periodEnd': {
        if (ev.period === 2) { savesThroughTwo.home = shotsFaced.home; savesThroughTwo.away = shotsFaced.away }
        if (ev.period >= 3 || ev.period >= lastPeriod) break
        const beats: RoomBeat[] = []
        if (bench && us && them) {
          const diff = score[us] - score[them]
          const state = diff > 0 ? 'lead' : diff < 0 ? 'trail' : 'tied'
          // One word from a veteran a night: after the second, or after the
          // first when we're behind. The speaker rotates among the three
          // longest careers we can see; else it's the oldest skater dressed.
          const dressedVets = bench.veterans.filter((v) => byId.has(v.id))
          const knownVets = dressedVets.filter((v) => v.gamesPlayed !== null && v.gamesPlayed >= 300)
            .sort((a, b) => (b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0)).slice(0, 3)
          const known = knownVets.length > 0 ? knownVets[stableSeed(key) % knownVets.length] : undefined
          const oldest = [...dressedVets].sort((a, b) => b.age - a.age)[0]
          const speaks = !vetSpoke && (ev.period === 2 || state === 'trail')
          const vet = !speaks ? undefined : known ?? (oldest && oldest.age >= 30 ? oldest : undefined)
          if (vet) {
            vetSpoke = true
            const intro = vet === known
              ? `${nameOf(vet.id)}, ${fmt(vet.gamesPlayed!)} NHL games in,`
              : `${nameOf(vet.id)}, at ${vet.age} the oldest skater in the lineup,`
            beats.push({
              kind: 'veteran', speaker: nameOf(vet.id), playerId: vet.id,
              text: render(ROOM_VETERAN, { state }, `${key}:${vet.id}:room:${ev.period}`, {
                name: nameOf(vet.id), intro, next: periodWord(ev.period + 1), deficitWord: NUMBER_WORDS[Math.abs(diff)] ?? String(Math.abs(diff)),
              }),
            })
          }
          const hurt = bench.injured[ev.period - 1]
          if (hurt) {
            beats.push({
              kind: 'trainer', speaker: 'Trainer', playerId: hurt.id,
              text: render(ROOM_TRAINER, {}, `${key}:${hurt.id}:trainer`, {
                name: hurt.name, injury: injuryShort(hurt.injury), injuryCap: capFirst(injuryShort(hurt.injury)),
                gamesMore: hurt.gamesRemaining === 1 ? 'one more game' : `${hurt.gamesRemaining} more games`, gamesAway: plural(hurt.gamesRemaining, 'game'),
              }),
            })
          }
        }
        if (beats.length > 0) room[ev.period] = beats
        break
      }
    }
  }

  function startShift(pid: string, period: number, t: number, at: number): void {
    shiftStart.set(pid, { period, t })
    if (period < 3) shiftsBeforeThird.set(pid, (shiftsBeforeThird.get(pid) ?? 0) + 1)
    everOn.add(pid)
    if (debutPending.has(pid)) {
      debutPending.delete(pid)
      const p = byId.get(pid)
      // Not when he starts the game: the pregame open already made his debut the story.
      if (p && at > 15) {
        benchC.push({
          at: at - 5, period, kind: 'debut', playerId: pid, key: `debut:${pid}`, priority: 90,
          text: render(BENCH_DEBUT, {}, `${key}:${pid}:debut`, { name: p.name, age: String(p.age) }),
        })
      }
    }
  }

  return { beats: schedule(lt, benchC, opts.busy ?? [], bench?.side ?? 'home'), room }
}

/* ─────────────────────────── the scheduler (rate limits) ─────────────────────────── */

/** Bench beats this urgent are seated first: they belong to one moment (a
 *  rookie's first shift, the turnover behind a goal) and can't wait for the
 *  next whistle. Everything else then fills in, in time order, around them. */
const URGENT_BENCH = 75

/** Lower-thirds of one kind a night (default 1): variety over volume. Streaks
 *  and milestone chases can run twice — the second is usually the live sequel. */
export const LT_KIND_CAP: Partial<Record<LowerThirdKind, number>> = { pointStreak: 2, milestone: 2, shutoutBid: 2, badBlood: 2, heat: 2 }

function schedule(lt: LtMoment[], bench: BenchCandidate[], busy: Array<[number, number]>, benchSide: LiveSide): LiveBeat[] {
  type Item = { at: number; period: number; lt?: LtMoment; bench?: BenchCandidate }
  const byTime = (a: Item, b: Item): number => a.at - b.at || (b.bench?.priority ?? 0) - (a.bench?.priority ?? 0)
  const urgent: Item[] = bench.filter((b) => b.priority >= URGENT_BENCH).map((b) => ({ at: b.at, period: b.period, bench: b })).sort(byTime)
  const rest: Item[] = [
    ...lt.map((m) => ({ at: m.at, period: m.period, lt: m })),
    ...bench.filter((b) => b.priority < URGENT_BENCH).map((b) => ({ at: b.at, period: b.period, bench: b })),
  ].sort(byTime)

  const out: LiveBeat[] = []
  const usedCards = new Set<string>()
  const kindCount = new Map<LowerThirdKind | BenchKind, number>()
  const ltPerPlayer = new Map<string, number>()
  const usedBench = new Set<string>()
  const count = new Map<string, number>()
  const isBusy = (from: number, to: number): boolean => busy.some(([a, b]) => from < b + CROSS_GAP_S && to + CROSS_GAP_S > a)
  /** Free of every seated beat (with the cross gap), and spaced from its own channel. */
  const fits = (at: number, hold: number, channel: LiveBeat['channel'], gap: number): boolean =>
    !isBusy(at, at + hold) &&
    out.every((o) =>
      (at >= o.at + o.holdS + CROSS_GAP_S || at + hold + CROSS_GAP_S <= o.at) &&
      (o.channel !== channel || Math.abs(at - o.at) >= gap))
  const take = (channel: LiveBeat['channel'], period: number, cap: number): boolean => {
    const k = `${channel}:${period}`
    if ((count.get(k) ?? 0) >= cap) return false
    count.set(k, (count.get(k) ?? 0) + 1)
    return true
  }

  for (const it of [...urgent, ...rest]) {
    const ot = it.period >= 4
    if (it.lt) {
      if (!fits(it.at, LT_HOLD_S, 'lowerThird', LT_MIN_GAP_S)) continue
      const opt = it.lt.options.find((o) => {
        if (usedCards.has(o.cardId) || !o.text) return false
        if ((kindCount.get(o.kind) ?? 0) >= (LT_KIND_CAP[o.kind] ?? 1)) return false
        if (!o.playerId) return true
        // One "before tonight" card per man; a live one may follow it.
        const live = o.cardId.includes(':live') || o.kind === 'shutoutBid'
        return (ltPerPlayer.get(o.playerId) ?? 0) < (live ? 2 : 1)
      })
      if (!opt || !take('lowerThird', it.period, ot ? LT_MAX_PER_OT : LT_MAX_PER_PERIOD)) continue
      usedCards.add(opt.cardId)
      kindCount.set(opt.kind, (kindCount.get(opt.kind) ?? 0) + 1)
      // The before-tonight card of the same kind is spent once its live sequel shows.
      usedCards.add(opt.cardId.split(':live')[0]!)
      if (opt.playerId) ltPerPlayer.set(opt.playerId, (ltPerPlayer.get(opt.playerId) ?? 0) + 1)
      out.push({
        id: `lt:${opt.cardId}`, channel: 'lowerThird', kind: opt.kind, at: it.at, holdS: LT_HOLD_S, side: opt.side,
        ...(opt.playerId ? { playerId: opt.playerId } : {}), title: opt.title, text: opt.text,
      })
    } else if (it.bench) {
      const b = it.bench
      if (!b.text || usedBench.has(b.key)) continue
      // A kind repeats at most once a game, except a turnover (a different man).
      if (b.kind !== 'turnover' && out.some((x) => x.kind === b.kind)) continue
      if (!fits(it.at, BENCH_HOLD_S, 'bench', BENCH_MIN_GAP_S)) continue
      if (!take('bench', it.period, ot ? BENCH_MAX_PER_OT : BENCH_MAX_PER_PERIOD)) continue
      usedBench.add(b.key)
      out.push({
        id: `bench:${b.key}`, channel: 'bench', kind: b.kind, at: it.at, holdS: BENCH_HOLD_S, side: benchSide,
        ...(b.playerId ? { playerId: b.playerId } : {}), title: 'BENCH', text: b.text,
      })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

