/**
 * THE PRESENTATION DIRECTOR — reads the game and tonight's storylines, calls
 * the broadcast.
 *
 * Input: the watched game's event stream + a {@link BroadcastContext} (pregame
 * storylines, lineups, season lines). Output: a {@link BroadcastPlan} — a pregame
 * open (wall-clock) and an in-game cue timeline (game-clock) of overlays, camera
 * shot requests, ceremonial moments and booth commentary.
 *
 * Rules it keeps:
 *  - PURE + DETERMINISTIC. Same stream + context ⇒ byte-identical plan. All
 *    variety comes from stableSeed(gameKey + slot), never Math.random.
 *  - EARNED ONLY. Moments fire from storylines (engine-decided, evidence-gated)
 *    or from what actually happened on the ice (a milestone crossed on a real
 *    goal). No storyline, no ceremony.
 *  - NO REPEATS. A booth line is not reused in a game until its moment's pool is
 *    exhausted, and never twice in a row; a ceremony fires once per storyline.
 *  - AT THE MOMENT. The goal call is cued AT the goal's absT with zero delay and
 *    the highest priority; everything else in a goal sequence is delayed behind it.
 */
import type { GameStream, GoalEvent } from '@domain'
import type { BroadcastContext, BroadcastStoryline } from '@engine/story/broadcastStorylines'
import { absTime } from '../timeline'
import { BOOTH_LINES, linesFor, nameSlotPosition, type BoothLine, type BoothMoment } from './commentaryLibrary'
import type {
  BroadcastPlan,
  CommentaryCue,
  CueClock,
  GoalDetail,
  MomentCue,
  NameForm,
  OverlayCue,
  OverlayData,
  PeriodDetail,
  PresentationCue,
  ShotCue,
  ShotKind,
} from './types'

export type PresentationLevel = 'full' | 'compact' | 'off'

export interface DirectorOptions {
  presentation: PresentationLevel
}

/* ─────────────────────────── seeded helpers ─────────────────────────── */

/** FNV-1a — same hash the prose layer's pickStable uses (stable across runs). */
export function stableSeed(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Per-game no-repeat picker over the booth library. A line isn't reused until
 * every line of its moment has been heard; the very last line spoken is never
 * picked again immediately (even across an exhausted-pool reset).
 */
export class BoothPicker {
  private readonly used = new Map<BoothMoment, Set<string>>()
  private lastId: string | null = null
  constructor(private readonly gameKey: string) {}

  pick(moment: BoothMoment, slot: string): BoothLine | null {
    const pool = linesFor(moment)
    if (pool.length === 0) return null
    let used = this.used.get(moment)
    if (!used) { used = new Set(); this.used.set(moment, used) }
    let fresh = pool.filter((l) => !used!.has(l.id) && l.id !== this.lastId)
    if (fresh.length === 0) {
      used.clear()
      fresh = pool.filter((l) => l.id !== this.lastId)
      if (fresh.length === 0) fresh = pool
    }
    const line = fresh[stableSeed(`${this.gameKey}|${moment}|${slot}`) % fresh.length]!
    used.add(line.id)
    this.lastId = line.id
    return line
  }
}

/* ─────────────────────────── small formatters ─────────────────────────── */

/** "14:16" — ELAPSED in the period, the broadcast convention for goal times. */
export function elapsedLabel(t: number): string {
  const s = Math.max(0, Math.floor(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function surnameOf(full: string): string {
  const parts = full.trim().split(/\s+/)
  return parts[parts.length - 1] ?? full
}

/* ─────────────────────────── power plays ─────────────────────────── */

export interface PowerPlayWindow {
  /** The side ON the power play. */
  side: 'home' | 'away'
  offenderId: string
  infraction: string
  fromAbsT: number
  toAbsT: number
}

/**
 * Power-play windows from the stream: a minor opens a 2:00 window for the other
 * side, closed early by a power-play goal; a major runs its full length.
 * Fighting majors are offsetting and open no window. Used by the scorebug's PP
 * strip — it is derived from events, never guessed.
 */
export function powerPlayWindows(stream: GameStream, isHome: (id: string) => boolean): PowerPlayWindow[] {
  const out: PowerPlayWindow[] = []
  for (const ev of stream) {
    if (ev.type === 'penalty') {
      if (ev.infraction === 'fighting') continue
      const at = absTime(ev.period, ev.t)
      out.push({
        side: isHome(ev.player) ? 'away' : 'home',
        offenderId: ev.player,
        infraction: ev.infraction,
        fromAbsT: at,
        toAbsT: at + ev.minutes * 60,
      })
    } else if (ev.type === 'goal' && ev.strength === 'pp') {
      const at = absTime(ev.period, ev.t)
      const side = isHome(ev.scorer) ? 'home' : 'away'
      const open = out.find((w) => w.side === side && w.fromAbsT <= at && w.toAbsT > at && w.toAbsT - w.fromAbsT <= 120)
      if (open) open.toAbsT = at
    } else if (ev.type === 'periodEnd' || ev.type === 'gameEnd') {
      // Penalties carry over periods in hockey; nothing to do.
    }
  }
  return out
}

/* ─────────────────────────── the director ─────────────────────────── */

/** Pregame segment lengths (wall ms). */
const PRE = {
  arena: 4800,
  banner: 7000,
  rookieLap: 6000,
  story: 4200,
  lineup: 5200,
  goalieTape: 4800,
  anthem: 2600,
} as const

const COMPACT = {
  arena: 3200,
  banner: 5000,
  rookieLap: 4500,
  story: 3200,
} as const

/** Moment kinds a pregame story card should NOT repeat (they get a ceremony). */
const PREGAME_MOMENT_KINDS = new Set(['bannerNight', 'debut'])

export function directBroadcast(
  stream: GameStream,
  ctx: BroadcastContext,
  opts: DirectorOptions,
): BroadcastPlan {
  const gameKey = ctx.gameKey
  const picker = new BoothPicker(gameKey)
  const pregame: PresentationCue[] = []
  const game: PresentationCue[] = []
  let seq = 0
  const nextId = (p: string): string => `${p}#${seq++}`
  const isHome = (id: string): boolean => ctx.players[id]?.side === 'home'
  const sideOf = (id: string): 'home' | 'away' => (isHome(id) ? 'home' : 'away')
  const nameOf = (id: string): string => ctx.players[id]?.name ?? id
  const storyFor = (pid: string, kinds: BroadcastStoryline['kind'][]): BroadcastStoryline | undefined =>
    ctx.storylines.find((s) => s.playerId === pid && kinds.includes(s.kind))

  // ── builders ───────────────────────────────────────────────────────────────
  const say = (
    list: PresentationCue[], clock: CueClock, at: number, moment: BoothMoment, slot: string,
    opts2: { playerId?: string; priority: 1 | 2 | 3; delayMs?: number; maxLatencyMs?: number; form?: NameForm },
  ): CommentaryCue | null => {
    const line = picker.pick(moment, slot)
    if (!line) return null
    const pos = nameSlotPosition(line.text)
    let text = line.bare ?? line.text
    let name: CommentaryCue['name']
    if (pos && opts2.playerId) {
      const form: NameForm = opts2.form ?? line.nameForm ?? 'surname'
      const display = form === 'full' ? nameOf(opts2.playerId) : surnameOf(nameOf(opts2.playerId))
      text = line.text.replace('{name}', display)
      name = { playerId: opts2.playerId, form, style: line.nameStyle ?? 'neutral', position: pos }
    }
    const cue: CommentaryCue = {
      channel: 'commentary',
      id: nextId(`cmt:${line.id}`),
      clock,
      at,
      ...(opts2.delayMs ? { delayMs: opts2.delayMs } : {}),
      speaker: line.speaker,
      lineId: line.id,
      moment,
      text,
      ...(name ? { name } : {}),
      priority: opts2.priority,
      maxLatencyMs: opts2.maxLatencyMs ?? (opts2.priority === 3 ? 400 : opts2.priority === 2 ? 1500 : 2500),
    }
    list.push(cue)
    return cue
  }
  const overlay = (
    list: PresentationCue[], clock: CueClock, at: number, holdMs: number, priority: 1 | 2 | 3,
    data: OverlayData, delayMs = 0,
  ): void => {
    const cue: OverlayCue = {
      channel: 'overlay', id: nextId(`ovl:${data.kind}`), clock, at, holdMs, priority, data,
      ...(delayMs ? { delayMs } : {}),
    }
    list.push(cue)
  }
  const shot = (
    list: PresentationCue[], clock: CueClock, at: number, holdMs: number, kind: ShotKind,
    extra: Partial<Pick<ShotCue, 'side' | 'playerId' | 'replay' | 'delayMs'>> = {},
  ): void => {
    list.push({ channel: 'shot', id: nextId(`shot:${kind}`), clock, at, holdMs, shot: kind, ...extra })
  }
  const moment = (
    list: PresentationCue[], clock: CueClock, at: number, holdMs: number,
    m: MomentCue['moment'], s: BroadcastStoryline, caption: string, delayMs = 0,
  ): void => {
    const cue: MomentCue = {
      channel: 'moment', id: nextId(`mom:${m}`), clock, at, holdMs, moment: m, side: s.side,
      caption, storylineId: s.id,
      ...(s.playerId ? { playerId: s.playerId } : {}),
      ...(delayMs ? { delayMs } : {}),
    }
    list.push(cue)
    overlay(list, clock, at, holdMs, 2, {
      kind: 'momentCaption', moment: m, caption, ...(s.playerId ? { playerId: s.playerId } : {}),
    }, delayMs)
  }

  // ── PREGAME OPEN ───────────────────────────────────────────────────────────
  let pregameMs = 0
  if (opts.presentation !== 'off') {
    const full = opts.presentation === 'full'
    const L = full ? PRE : { ...PRE, ...COMPACT }
    let t = 0
    shot(pregame, 'pregame', t, L.arena, 'establishing')
    overlay(pregame, 'pregame', t, L.arena, 3, { kind: 'arenaTitle' })
    say(pregame, 'pregame', 400, 'open.welcome', 'welcome', { priority: 2, maxLatencyMs: 2500 })
    t += L.arena

    const banner = ctx.storylines.find((s) => s.kind === 'bannerNight')
    if (banner) {
      shot(pregame, 'pregame', t, L.banner, 'jumbotron', { side: 'home' })
      moment(pregame, 'pregame', t, L.banner, 'bannerRaising', banner, `Banner raising — ${ctx.homeName}, champions`)
      say(pregame, 'pregame', t + 300, 'moment.banner', 'banner', { priority: 2, maxLatencyMs: 2500 })
      t += L.banner
    }

    // Rookie laps (at most two; the rest still get a card).
    const debuts = ctx.storylines.filter((s) => s.kind === 'debut' && s.playerId).slice(0, 2)
    for (const d of debuts) {
      const pid = d.playerId!
      shot(pregame, 'pregame', t, L.rookieLap, 'crowd', { side: d.side, playerId: pid })
      moment(pregame, 'pregame', t, L.rookieLap, 'rookieLap', d, `Rookie lap — ${nameOf(pid)}, first NHL game`)
      say(pregame, 'pregame', t + 300, 'moment.rookieLap', `lap:${pid}`, { playerId: pid, priority: 2, maxLatencyMs: 2500 })
      t += L.rookieLap
    }

    // Story cards — earned storylines that don't already have a ceremony.
    const cards = ctx.storylines
      .filter((s) => !PREGAME_MOMENT_KINDS.has(s.kind) || (s.kind === 'debut' && !debuts.includes(s)))
      .slice(0, full ? 3 : 2)
    let spokeStory = false
    for (const s of cards) {
      overlay(pregame, 'pregame', t, L.story, 2, {
        kind: 'storyCard', storylineId: s.id, title: s.title, detail: s.detail, side: s.side,
        ...(s.playerId ? { playerId: s.playerId } : {}),
      })
      if (!spokeStory && s.playerId) {
        const m: BoothMoment | null =
          s.kind === 'homecoming' ? 'open.homecoming'
          : s.kind === 'milestoneWatch' || s.kind === 'milestoneGame' ? 'open.milestone'
          : s.kind === 'debut' ? 'open.debut'
          : null
        if (m) {
          say(pregame, 'pregame', t + 300, m, `story:${s.id}`, { playerId: s.playerId, priority: 2, maxLatencyMs: 2500 })
          spokeStory = true
        }
      }
      t += L.story
    }

    if (full) {
      for (const side of ['away', 'home'] as const) {
        shot(pregame, 'pregame', t, PRE.lineup, 'lineups', { side })
        overlay(pregame, 'pregame', t, PRE.lineup, 2, { kind: 'startingLineup', side })
        t += PRE.lineup
      }
      if (ctx.home.goalieId && ctx.away.goalieId) {
        overlay(pregame, 'pregame', t, PRE.goalieTape, 2, { kind: 'goalieTape' })
        t += PRE.goalieTape
      }
      shot(pregame, 'pregame', t, PRE.anthem, 'anthem')
      t += PRE.anthem
    }
    shot(pregame, 'pregame', t, 1500, 'faceoffClose')
    pregameMs = t
  }

  // ── IN-GAME ────────────────────────────────────────────────────────────────
  const presentationOn = opts.presentation !== 'off'
  const compact = opts.presentation === 'compact'
  say(game, 'game', 0, 'puckDrop', 'drop', { priority: 1 })
  if (presentationOn) shot(game, 'game', 0, 2500, 'broadcast')

  const tonightGoals = new Map<string, number>()
  const tonightAssists = new Map<string, number>()
  const tonightSaves = new Map<string, number>()
  const score = { home: 0, away: 0 }
  const periodAcc = new Map<number, PeriodDetail>()
  const periodOf = (p: number): PeriodDetail => {
    let d = periodAcc.get(p)
    if (!d) {
      d = { period: p, home: { goals: 0, shots: 0 }, away: { goals: 0, shots: 0 }, goals: [], final: false }
      periodAcc.set(p, d)
    }
    return d
  }
  const milestonesDone = new Set<string>()
  let lastShot: { danger: number; shooter: string } | null = null
  let lastSaveCallAbsT = -999
  let robberies = 0
  const bigHitsByPeriod = new Map<number, number>()
  const firstWhistleDone = new Set<string>()
  const pendingFirstStoppage: Array<{ s: BroadcastStoryline; afterAbsT: number }> = []
  for (const s of ctx.storylines) {
    if (s.kind === 'homecoming') pendingFirstStoppage.push({ s, afterAbsT: 360 })
    if (s.kind === 'milestoneGame') pendingFirstStoppage.push({ s, afterAbsT: 120 })
  }

  for (const ev of stream) {
    const at = absTime(ev.period, ev.t)
    switch (ev.type) {
      case 'shot': {
        lastShot = { danger: ev.danger, shooter: ev.shooter }
        const side = sideOf(ev.shooter)
        periodOf(ev.period)[side].shots++
        break
      }
      case 'save': {
        tonightSaves.set(ev.goalie, (tonightSaves.get(ev.goalie) ?? 0) + 1)
        const danger = lastShot?.danger ?? 0
        lastShot = null
        const robbery = danger >= 0.85 && robberies < 3
        const big = danger >= 0.72
        if (!big || at - lastSaveCallAbsT < 90) break
        lastSaveCallAbsT = at
        say(game, 'game', at, robbery ? 'save.robbery' : 'save.big', `save:${at}`, {
          playerId: ev.goalie, priority: robbery ? 3 : 2,
        })
        if (robbery) {
          robberies++
          if (presentationOn) {
            overlay(game, 'game', at, 3800, 2, {
              kind: 'playerTag', playerId: ev.goalie, role: 'save', label: 'BIG SAVE',
              stat: `${tonightSaves.get(ev.goalie)} SAVES`,
            }, 300)
            shot(game, 'game', at, 4000, 'saveReplay', { delayMs: 2500, replay: { fromAbsT: Math.max(0, at - 5), toAbsT: at + 0.5 } })
          }
          say(game, 'game', at, 'save.color', `savec:${at}`, { priority: 1, delayMs: 3500 })
        }
        break
      }
      case 'goal': {
        lastShot = null
        game.push(...goalSequence(ev, at))
        break
      }
      case 'penalty': {
        const fight = ev.infraction === 'fighting'
        if (fight) {
          // Both fighters get a major at the same instant — call it once.
          const dup = game.some((c) => c.channel === 'commentary' && c.moment === 'fight' && Math.abs(c.at - at) < 1)
          if (!dup) {
            say(game, 'game', at, 'fight', `fight:${at}`, { priority: 3 })
            if (presentationOn) shot(game, 'game', at, 3000, 'penaltyBox', { delayMs: 4000, playerId: ev.player })
          }
        } else {
          say(game, 'game', at, 'penalty', `pen:${at}`, { playerId: ev.player, priority: 2 })
          if (presentationOn && !compact) shot(game, 'game', at, 2500, 'penaltyBox', { delayMs: 1500, playerId: ev.player })
        }
        break
      }
      case 'hit': {
        const n = bigHitsByPeriod.get(ev.period) ?? 0
        if (n >= 1) break
        if (stableSeed(`${gameKey}|hit|${at}`) % 6 !== 0) break
        bigHitsByPeriod.set(ev.period, n + 1)
        say(game, 'game', at, 'hit.big', `hit:${at}`, { priority: 1 })
        break
      }
      case 'whistle': {
        // First TV timeout: tribute video / games-milestone recognition.
        for (const pend of pendingFirstStoppage) {
          const key = pend.s.id
          if (firstWhistleDone.has(key) || ev.period !== 1 || at < pend.afterAbsT) continue
          firstWhistleDone.add(key)
          const pid = pend.s.playerId!
          if (pend.s.kind === 'homecoming') {
            if (presentationOn) {
              shot(game, 'game', at, 8000, 'jumbotron', { side: pend.s.side, playerId: pid })
              moment(game, 'game', at, 8000, 'tributeVideo', pend.s, `Tribute video — ${nameOf(pid)} returns to ${pend.s.formerTeamName ?? 'his old building'}`)
              shot(game, 'game', at, 5000, 'crowd', { delayMs: 8000 })
              moment(game, 'game', at, 5000, 'standingOvation', pend.s, `Standing ovation for ${nameOf(pid)}`, 8000)
            }
            say(game, 'game', at, 'moment.tribute', `trib:${pid}`, { playerId: pid, priority: 2, maxLatencyMs: 2500 })
            say(game, 'game', at, 'moment.ovation', `ov:${pid}`, { priority: 1, delayMs: 8500, maxLatencyMs: 3000 })
          } else {
            const target = pend.s.milestone?.target ?? 0
            if (presentationOn) {
              shot(game, 'game', at, 5000, 'crowd', { playerId: pid })
              moment(game, 'game', at, 5500, 'standingOvation', pend.s, `${target.toLocaleString('en-US')}th NHL game — ${nameOf(pid)}`)
            }
            say(game, 'game', at, 'moment.ovation', `ovg:${pid}`, { priority: 1, maxLatencyMs: 3000 })
          }
        }
        break
      }
      case 'periodEnd':
      case 'gameEnd': {
        const final = ev.type === 'gameEnd'
        const d = periodOf(ev.period)
        if (final) d.final = true
        const close = final && Math.abs(score.home - score.away) === 1
        say(game, 'game', at, final ? (close ? 'gameEnd.close' : 'gameEnd') : 'periodEnd', `end:${ev.period}:${ev.type}`, {
          priority: final ? 3 : 1, maxLatencyMs: 1500,
        })
        if (presentationOn) {
          overlay(game, 'game', at, final ? 9000 : 6500, 2, {
            kind: 'periodSummary',
            summary: final ? summariseGame(periodAcc) : { ...d, goals: [...d.goals] },
          }, 900)
        }
        break
      }
      default:
        break
    }
  }

  function goalSequence(ev: GoalEvent, at: number): PresentationCue[] {
    const out: PresentationCue[] = []
    const side = sideOf(ev.scorer)
    const before = { ...score }
    score[side]++
    const pd = periodOf(ev.period)
    pd[side].goals++
    pd.goals.push({ playerId: ev.scorer, side, elapsed: elapsedLabel(ev.t), strength: ev.strength })
    const n = (tonightGoals.get(ev.scorer) ?? 0) + 1
    tonightGoals.set(ev.scorer, n)
    for (const a of ev.assists) tonightAssists.set(a, (tonightAssists.get(a) ?? 0) + 1)

    const p = ctx.players[ev.scorer]
    // ── the call: exactly one pbp line, AT the goal ──
    const lateTie = ev.period === 3 && ev.t >= 15 * 60 && score.home === score.away
    const tied = score.home === score.away
    const goAhead = !tied && (before.home === before.away)
    const firstGoal = p?.careerGoalsBefore === 0 && n === 1
    const crossed = milestoneCrossings(ev)
    const scorerMilestone = crossed.find((c) => c.playerId === ev.scorer)
    const revenge = storyFor(ev.scorer, ['homecoming', 'revenge'])
    const call: BoothMoment =
      firstGoal ? 'goal.first'
      : scorerMilestone ? 'goal.milestone'
      : n === 3 ? 'goal.hatTrick'
      : ev.period >= 4 ? 'goal.overtime'
      : lateTie ? 'goal.lateTie'
      : revenge ? 'goal.revenge'
      : ev.strength === 'sh' ? 'goal.shortHanded'
      : ev.strength === 'en' ? 'goal.emptyNet'
      : ev.strength === 'pp' ? 'goal.powerPlay'
      : tied ? 'goal.tie'
      : goAhead ? 'goal.goAhead'
      : 'goal'
    say(out, 'game', at, call, `goal:${at}`, { playerId: ev.scorer, priority: 3, maxLatencyMs: 350 })

    if (presentationOn) {
      // On-ice tags while the celebration plays.
      const seasonG = (p?.seasonGoals ?? 0) + n
      overlay(out, 'game', at, 4200, 3, {
        kind: 'playerTag', playerId: ev.scorer, role: 'goal',
        label: n === 3 ? 'HAT TRICK' : 'GOAL', stat: `${seasonG} ${seasonG === 1 ? 'GOAL' : 'GOALS'}`,
      }, 250)
      ev.assists.slice(0, 2).forEach((a, i) => {
        overlay(out, 'game', at, 3800, 2, {
          kind: 'playerTag', playerId: a, role: i === 0 ? 'assist1' : 'assist2',
          label: i === 0 ? '1ST ASSIST' : '2ND ASSIST',
        }, 450)
      })
      shot(out, 'game', at, 2500, 'benchReaction', { side, delayMs: 1800 })
      if (lateTie || ev.period >= 4) shot(out, 'game', at, 2000, 'coachCloseup', { side: side === 'home' ? 'away' : 'home', delayMs: 3000 })
      shot(out, 'game', at, 8000, 'goalReplay', { delayMs: 4500, replay: { fromAbsT: Math.max(0, at - 8), toAbsT: at + 0.5 } })
      // The lower third lands once the tags have cleared.
      const detail: GoalDetail = {
        scorerId: ev.scorer, assistIds: ev.assists.slice(0, 2), strength: ev.strength,
        elapsed: elapsedLabel(ev.t), period: ev.period, goalsTonight: n, side,
      }
      overlay(out, 'game', at, compact ? 5000 : 6500, 3, { kind: 'lowerThird', goal: detail }, 4600)
    }
    // Colour analyst over the replay (skipped for an empty-netter).
    if (ev.strength !== 'en') say(out, 'game', at, 'goal.color', `gc:${at}`, { priority: 1, delayMs: 5200, maxLatencyMs: 2500 })

    // Milestones crossed on this goal (scorer and/or assisters).
    for (const c of crossed) {
      if (presentationOn) {
        overlay(out, 'game', at, 6000, 3, { kind: 'milestone', playerId: c.playerId, title: c.title, detail: c.detail }, c.playerId === ev.scorer ? 2600 : 3400)
        const s = ctx.storylines.find((x) => x.id === c.storylineId)!
        moment(out, 'game', at, 5000, 'standingOvation', s, `Standing ovation — ${nameOf(c.playerId)}`, 2600)
        shot(out, 'game', at, 3000, 'crowd', { delayMs: 2600, playerId: c.playerId })
      }
      if (c.playerId !== ev.scorer) {
        say(out, 'game', at, 'moment.ovation', `mo:${c.playerId}`, { priority: 2, delayMs: 3000, maxLatencyMs: 3000 })
      }
    }
    return out
  }

  function milestoneCrossings(ev: GoalEvent): Array<{ playerId: string; title: string; detail: string; storylineId: string }> {
    const out: Array<{ playerId: string; title: string; detail: string; storylineId: string }> = []
    for (const s of ctx.storylines) {
      if (s.kind !== 'milestoneWatch' || !s.milestone || !s.playerId || milestonesDone.has(s.id)) continue
      const pid = s.playerId
      const involved = ev.scorer === pid || (ev.assists as readonly string[]).includes(pid)
      if (!involved) continue
      const g = tonightGoals.get(pid) ?? 0
      const a = tonightAssists.get(pid) ?? 0
      const now = s.milestone.stat === 'goals' ? s.milestone.before + g : s.milestone.before + g + a
      if (s.milestone.stat === 'goals' && ev.scorer !== pid) continue
      if (now >= s.milestone.target && !out.some((o) => o.playerId === pid)) {
        milestonesDone.add(s.id)
        const noun = s.milestone.stat === 'goals' ? 'CAREER GOALS' : 'CAREER POINTS'
        out.push({
          playerId: pid,
          storylineId: s.id,
          title: `${s.milestone.target.toLocaleString('en-US')} ${noun}`,
          detail: `${nameOf(pid)} reaches ${s.milestone.target.toLocaleString('en-US')}`,
        })
      }
    }
    return out
  }

  const byAt = (a: PresentationCue, b: PresentationCue): number => a.at - b.at
  pregame.sort(byAt)
  game.sort(byAt)
  return { pregame, pregameMs, game }
}

function summariseGame(acc: Map<number, PeriodDetail>): PeriodDetail {
  const total: PeriodDetail = { period: 0, home: { goals: 0, shots: 0 }, away: { goals: 0, shots: 0 }, goals: [], final: true }
  for (const d of [...acc.values()].sort((a, b) => a.period - b.period)) {
    total.period = d.period
    total.home.goals += d.home.goals
    total.home.shots += d.home.shots
    total.away.goals += d.away.goals
    total.away.shots += d.away.shots
    total.goals.push(...d.goals)
  }
  return total
}

/** Every line id the director can emit — the audio manifest must cover these. */
export function directorLineIds(): string[] {
  return BOOTH_LINES.map((l) => l.id)
}
