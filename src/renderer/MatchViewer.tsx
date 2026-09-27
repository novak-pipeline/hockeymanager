import { useContext, useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react'
import {
  MatchTimeline,
  type MatchView,
  generateCommentary,
  type CommentaryLine,
} from '@render2d'
import type { MatchRenderer, RinkColors, PlayerLabels } from '@render2d'
import { RinkRenderer } from '@render2d'
import { Rink3dRenderer, type CameraPreset } from '@render3d'
import type { WatchedGame } from '../worker/protocol'
import { MatchSfx } from './lib/sfx'
import { planFor, currentSpeed, nextActiveJump, SKIP_SPEED } from '../render2d/playbackDirector'
import type { SpeedSegment } from '../render2d/playbackDirector'
import { cancelSpeech } from './lib/speak'
import { EventCursor } from '../render2d/eventCursor'
import type { GoalEvent, StoppageReason } from '@domain'
import { Icons } from './components/icons'
import { Icon } from './components/primitives'
import { SimContext } from './hooks/useSim'
import type { BroadcastContext } from '@engine/story/broadcastStorylines'
import { directBroadcast, powerPlayWindows } from '../render2d/broadcast/director'
import type {
  BroadcastPlan, BroadcastProjector, BroadcastShotConsumer, CommentaryCue, OverlayCue, PresentationCue,
} from '../render2d/broadcast/types'
import { CommentaryScheduler } from '../render2d/broadcast/audioScheduler'
import {
  BoothAudio, isCommentaryEnabled, setCommentaryEnabled, readPresentation, writePresentation,
  type PresentationSetting,
} from './lib/commentaryAudio'
import { fallbackBroadcastContext, ppRemaining } from './lib/broadcastContext'
import { BroadcastOverlayLayer, Scorebug } from './components/broadcast/BroadcastOverlays'

// ── Constants ──────────────────────────────────────────────────────────────────

const MUTED = 'var(--muted)'
const PANEL = 'var(--bg1)'

const CAMERA_PRESETS: CameraPreset[] = ['broadcast', 'overhead', 'endzone', 'follow']
const LS_RENDERER = 'hockeyMatchRenderer'

// Plan-relative nudge multipliers (relative to current plan speed)
const NUDGE_MULTIPLIERS = [0.5, 1, 2] as const

type PlaybackMode = 'full' | 'extended' | 'key'
type Phase = 'hero' | 'pregame' | 'playing'

// ── Module-level singletons (survive re-renders, disposed on unmount) ──────────

const sfx = new MatchSfx()
const SFX_VOLUME = 0.7
const SFX_DUCKED = 0.3

/** A game-clock jump bigger than this (seek, fast-forward, replay) passes cues
 *  without firing them — the broadcast only calls what it actually showed. */
const CUE_JUMP_S = 4

/** Does this renderer take the director's camera/moment requests? (3D, later.) */
function shotConsumerOf(r: unknown): BroadcastShotConsumer | null {
  return r && typeof (r as BroadcastShotConsumer).requestShot === 'function' ? (r as BroadcastShotConsumer) : null
}
function projectorOf(r: unknown): BroadcastProjector | null {
  return r && typeof (r as BroadcastProjector).projectPlayer === 'function' ? (r as BroadcastProjector) : null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function readRendererPref(): '2d' | '3d' {
  try {
    const v = localStorage.getItem(LS_RENDERER)
    if (v === '2d' || v === '3d') return v
  } catch { /* ignore */ }
  return '3d'
}
function writeRendererPref(v: '2d' | '3d'): void {
  try { localStorage.setItem(LS_RENDERER, v) } catch { /* ignore */ }
}

/** Find the goal event closest to (but not after) a given absT. */
function findGoalEventAt(
  cursor: EventCursor,
  targetAbsT: number,
  tolerance = 2,
): GoalEvent | null {
  let best: GoalEvent | null = null
  let bestDiff = Infinity
  for (const { absT, ev } of cursor.all) {
    if (ev.type !== 'goal') continue
    const diff = Math.abs(absT - targetAbsT)
    if (diff <= tolerance && diff < bestDiff) {
      bestDiff = diff
      best = ev
    }
  }
  return best
}

/** The away team always wears white (slightly off-white for contrast on ice). */
const AWAY_WHITE = 0xf4f5f7
/** A reasonable dark fallback when a club has no usable dark colour. */
const DEFAULT_HOME_DARK = 0x1a2a4a

/** Relative luminance (0..1) of a 0xRRGGBB colour. */
function _luminance(rgb: number): number {
  const r = ((rgb >> 16) & 0xff) / 255
  const g = ((rgb >> 8) & 0xff) / 255
  const b = (rgb & 0xff) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Pick a dark/colour jersey for the home side: prefer the primary, but if it's
 * too light (would read as "white" next to the away team), use the secondary,
 * and if that's also light, a default navy.
 */
function darkJersey(primary: number, secondary: number): number {
  if (_luminance(primary) <= 0.72) return primary
  if (_luminance(secondary) <= 0.72) return secondary
  return DEFAULT_HOME_DARK
}

/** Absolute game seconds → "P2 12:34" countdown label (for the FF clock spin). */
function _absToClock(absT: number): string {
  const period = absT < 3600 ? Math.floor(absT / 1200) + 1 : 4
  const within = absT - (period - 1) * 1200
  const remain = Math.max(0, 1200 - within)
  const mm = Math.floor(remain / 60)
  const ss = Math.floor(remain % 60)
  const label = period >= 4 ? 'OT' : `P${period}`
  return `${label} ${mm}:${String(ss).padStart(2, '0')}`
}

// ── Component ──────────────────────────────────────────────────────────────────

export function MatchViewer(props: {
  game: WatchedGame
  onClose: () => void
  /** Pregame context supplied directly (dev harness). Normally fetched. */
  broadcast?: BroadcastContext
  /** Pick the game up at this absolute game second (the Sim view's hand-over);
   *  0 / absent = the normal "drop the puck" start. */
  startAtAbsT?: number
}): JSX.Element {
  const { game } = props

  // DOM refs
  const hostRef     = useRef<HTMLDivElement>(null)
  const tickerRef   = useRef<HTMLDivElement>(null)

  // Renderer refs
  const rendererRef   = useRef<MatchRenderer | null>(null)
  const renderer3dRef = useRef<Rink3dRenderer | null>(null)

  // Speed-plan ref (updated when mode changes)
  const planRef = useRef<SpeedSegment[]>([])
  // Nudge multiplier layered on top of plan speed
  const nudgeRef = useRef<number>(1)

  // Absolute game clock from last onUpdate
  const gameDurationRef    = useRef<number>(0)
  const lastAbsTRef        = useRef<number>(-1)
  const viewRef            = useRef<MatchView | null>(null)
  const commentaryLinesRef = useRef<CommentaryLine[]>([])
  const lastCommentaryAbsT = useRef<number>(-1)

  // Read head over the stream for the SFX cue map and stoppage chips. Replaces
  // two full-stream scans per rendered frame — see eventCursor.ts and
  // docs/perf/2d-match-cpu-profile.txt.
  //
  // Built LAZILY, not as `useRef(new EventCursor(...))`: this component commits
  // on every renderer tick, and a useRef argument is evaluated on every one of
  // those renders. Indexing a 20k-event stream sixty times a second cost more
  // than the scans it replaced (measured: 70 fps → 32 fps).
  const cursorRef = useRef<EventCursor | null>(null)
  if (cursorRef.current === null) cursorRef.current = new EventCursor(game.stream)

  // Goal banner / replay
  const goalBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replayActiveRef    = useRef<boolean>(false)
  const replaySkipRef      = useRef<boolean>(false)
  // The live score/clock at the cut to a replay: the scorebug and scoreboard
  // HOLD it while the replay rewinds the picture (TV never un-scores a goal).
  const heldViewRef        = useRef<MatchView | null>(null)

  // Where the NEXT renderer build picks the game up. A 2D↔3D switch or the Sim
  // view's "Watch on the ice" keeps the same moment of the same game — the view
  // is a camera choice, not a new match (F-12).
  const resumeRef = useRef<{ absT: number; playing: boolean; mode: PlaybackMode } | null>(
    props.startAtAbsT && props.startAtAbsT > 0 ? { absT: props.startAtAbsT, playing: true, mode: 'full' } : null,
  )

  // Stoppage overlay
  const stoppageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fast-forward interstitial (extended/key modes): spin the clock between
  // highlights instead of playing the filler.
  const ffActiveRef = useRef<boolean>(false)
  const ffRafRef    = useRef<number | null>(null)

  // Score tracking for goal detection
  const prevScoreRef = useRef<{ home: number; away: number }>({ home: 0, away: 0 })
  // Track last goal event fired (so banner + horn always match commentary)
  const lastGoalEventRef = useRef<GoalEvent | null>(null)

  // ── React state ──────────────────────────────────────────────────────────────
  const [phase, setPhase]               = useState<Phase>(() => (resumeRef.current ? 'playing' : 'hero'))
  const [view, setView]                 = useState<MatchView | null>(null)
  const [rendererMode, setRendererMode] = useState<'2d' | '3d'>(readRendererPref)
  const [camPreset, setCamPreset]       = useState<CameraPreset>('broadcast')
  const [err, setErr]                   = useState<string | null>(null)

  const [, setPlaybackMode] = useState<PlaybackMode>('full')
  const [nudge, setNudge]               = useState<number>(1)

  // Goal banner: { text, absT } so we can match the exact event
  const [goalBanner, setGoalBanner]     = useState<{ text: string; goalAbsT: number } | null>(null)
  // Whether the instant replay is active
  const [replayActive, setReplayActive] = useState<boolean>(false)

  // Stoppage chip reason
  const [stoppageChip, setStoppageChip] = useState<string | null>(null)

  // Fast-forward interstitial display: the spinning clock label, or null when
  // not fast-forwarding.
  const [ffClock, setFfClock] = useState<string | null>(null)

  // Commentary
  const [visibleLines, setVisibleLines] = useState<CommentaryLine[]>([])

  // Controls
  const [sfxEnabled, setSfxEnabled]             = useState<boolean>(true)

  // ── Broadcast package ────────────────────────────────────────────────────────
  const client = useContext(SimContext)
  const [presentation, setPresentation] = useState<PresentationSetting>(readPresentation)
  const [commentaryOn, setCommentaryOn] = useState<boolean>(isCommentaryEnabled)
  const [bctx, setBctx] = useState<BroadcastContext>(() => props.broadcast ?? fallbackBroadcastContext(game))
  const [liveOverlays, setLiveOverlays] = useState<OverlayCue[]>([])
  const [namesPending, setNamesPending] = useState<number>(0)
  const [hostSize, setHostSize] = useState<{ w: number; h: number }>({ w: 900, h: 383 })
  const plan: BroadcastPlan = useMemo(
    () => directBroadcast(game.stream, bctx, { presentation }),
    [game, bctx, presentation],
  )
  const planRefB = useRef<BroadcastPlan>(plan)
  planRefB.current = plan
  const firedCuesRef = useRef<Set<string>>(new Set())
  const cueTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const pregameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boothRef = useRef<BoothAudio | null>(null)
  const schedulerRef = useRef<CommentaryScheduler | null>(null)
  const commentaryOnRef = useRef(commentaryOn)
  commentaryOnRef.current = commentaryOn
  const ppWindows = useMemo(() => {
    const homeIds = new Set(game.homePlayerIds)
    return powerPlayWindows(game.stream, (id) => homeIds.has(id))
  }, [game])

  // Sync refs
  nudgeRef.current       = nudge
  replayActiveRef.current = replayActive

  // ── Broadcast: tonight's context from the worker (built before the sim ran) ──
  useEffect(() => {
    if (props.broadcast) { setBctx(props.broadcast); return }
    setBctx(fallbackBroadcastContext(game))
    if (!client) return
    let live = true
    client.getBroadcastContext().then((res) => {
      if (!live || res.type !== 'broadcastContext' || !res.context) return
      const c = res.context
      // Only trust it for THIS game (the worker keeps the last watched one).
      if (c.homeAbbr !== game.homeAbbr || c.awayAbbr !== game.awayAbbr) return
      setBctx(c)
    }).catch(() => undefined)
    return () => { live = false }
  }, [game, client, props.broadcast])

  // ── Broadcast: the booth (stems + name clips + scheduler) ───────────────────
  useEffect(() => {
    if (!commentaryOn) return
    const booth = new BoothAudio()
    booth.setDuckHandler((on) => sfx.setVolume(on ? SFX_DUCKED : SFX_VOLUME))
    const sched = new CommentaryScheduler(booth, booth, () => performance.now())
    boothRef.current = booth
    schedulerRef.current = sched
    void booth.loadStems()
    const id = window.setInterval(() => {
      sched.tick()
      setNamesPending(booth.tonightPending)
    }, 60)
    return () => {
      clearInterval(id)
      sched.cancel()
      booth.dispose()
      boothRef.current = null
      schedulerRef.current = null
      sfx.setVolume(SFX_VOLUME)
    }
  }, [commentaryOn, game])

  // Tonight's two rosters get their name clips first (background, before puck
  // drop); the rest of the league trickles in afterwards in idle time.
  useEffect(() => {
    const booth = boothRef.current
    if (!booth || !commentaryOn) return
    const starters = new Set([...bctx.home.starters, ...bctx.away.starters])
    booth.queueNames(Object.values(bctx.players).map((p) => ({
      id: p.id, name: p.name, starter: starters.has(p.id),
      ...(p.nationality !== undefined ? { nationality: p.nationality } : {}),
      ...(p.pronunciation !== undefined ? { pronunciation: p.pronunciation } : {}),
    })))
    if (!client) return
    const t = setTimeout(() => {
      client.searchPlayers({ leagueIds: ['nhl'], sort: 'points', limit: 500 }).then((res) => {
        if (res.type !== 'playerSearch' || boothRef.current !== booth) return
        booth.queueNames(res.playerSearch.rows.map((r) => ({
          id: r.playerId, name: r.name, starter: false,
          ...(r.nationality !== undefined ? { nationality: r.nationality } : {}),
        })), { league: true })
      }).catch(() => undefined)
    }, 20_000)
    return () => clearTimeout(t)
  }, [bctx, commentaryOn, client])

  // Host size, for clamping world-anchored tags inside the frame.
  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setHostSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setHostSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  /** Put an overlay on screen for its hold time. One graphic per kind at a time
   *  (a new lower third replaces the old); on-ice tags may stack. */
  const showOverlay = useCallback((cue: OverlayCue): void => {
    setLiveOverlays((prev) => [
      ...prev.filter((c) => c.id !== cue.id && (cue.data.kind === 'playerTag' || c.data.kind !== cue.data.kind)),
      cue,
    ])
    const t = setTimeout(() => setLiveOverlays((prev) => prev.filter((c) => c.id !== cue.id)), cue.holdMs)
    cueTimersRef.current.push(t)
  }, [])

  /** Route one director cue to its channel, after its delay. */
  const fireCue = useCallback((cue: PresentationCue): void => {
    const run = (): void => {
      switch (cue.channel) {
        case 'overlay': showOverlay(cue); break
        case 'commentary': if (commentaryOnRef.current) schedulerRef.current?.trigger(cue as CommentaryCue); break
        case 'shot': shotConsumerOf(rendererRef.current)?.requestShot(cue); break
        case 'moment': shotConsumerOf(rendererRef.current)?.playMoment?.(cue); break
      }
    }
    if (cue.delayMs && cue.delayMs > 0) cueTimersRef.current.push(setTimeout(run, cue.delayMs))
    else run()
  }, [showOverlay])

  /** Drop every pending/visible broadcast element (seek, skip, leave). */
  const clearBroadcast = useCallback((): void => {
    for (const t of cueTimersRef.current) clearTimeout(t)
    cueTimersRef.current = []
    if (pregameTimerRef.current) clearTimeout(pregameTimerRef.current)
    pregameTimerRef.current = null
    setLiveOverlays([])
    schedulerRef.current?.cancel()
  }, [])
  useEffect(() => clearBroadcast, [clearBroadcast])

  // ── Build/rebuild renderer when game or rendererMode changes ─────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let renderer: MatchRenderer | null = null

    const homeIds = new Set<string>(game.homePlayerIds)
    const timeline = new MatchTimeline(game.stream, (id) => homeIds.has(id))
    gameDurationRef.current = timeline.duration

    // Hockey convention: home wears its dark/colour jersey, the away team
    // always wears white. This avoids two similar-coloured teams being hard to
    // tell apart on the ice. If the home club's primary is itself very light,
    // fall back to its secondary (or a default navy) so home stays distinct
    // from the white away side.
    const colors: RinkColors = {
      home: darkJersey(game.homeColors.primary, game.homeColors.secondary),
      away: AWAY_WHITE,
    }

    prevScoreRef.current      = { home: 0, away: 0 }
    lastAbsTRef.current       = -1
    cursorRef.current         = new EventCursor(game.stream)
    lastCommentaryAbsT.current = -1
    lastGoalEventRef.current  = null
    setGoalBanner(null)
    setReplayActive(false)
    replayActiveRef.current = false
    replaySkipRef.current   = false

    // Build commentary lines
    const namesFn  = (id: string): string => game.playerNames[id] ?? id
    const isHomeFn = (id: string): boolean => homeIds.has(id)
    const lines = generateCommentary(game.stream, namesFn, isHomeFn, {
      home: game.homeAbbr,
      away: game.awayAbbr,
    })
    commentaryLinesRef.current = lines
    setVisibleLines([])

    // Build initial plan (will be rebuilt when mode is chosen)
    planRef.current = planFor(game.stream, 'full')

    const promise =
      rendererMode === '3d'
        ? Rink3dRenderer.create(host, colors)
        : RinkRenderer.create(host, colors)

    promise
      .then((r) => {
        if (disposed) { r.destroy(); return }
        renderer = r
        rendererRef.current = r

        if (r instanceof Rink3dRenderer) {
          renderer3dRef.current = r
          r.setEventStream(game.stream)
          r.setCamera(camPreset)
        } else {
          renderer3dRef.current = null
        }

        r.onUpdate((v) => {
          setView(v)
          viewRef.current = v
          _onUpdate(v)
        })
        // Build player labels: last name + jersey number (number not in WatchedGame yet, omit)
        const playerLabels: PlayerLabels = {}
        for (const [id, fullName] of Object.entries(game.playerNames)) {
          const parts = fullName.trim().split(/\s+/)
          playerLabels[id] = { lastName: parts[parts.length - 1] ?? fullName }
        }
        // Start paused at speed=2; will play when user picks a mode
        r.load(timeline, colors, playerLabels)
        r.setSpeed(2)

        // Resume where the previous view left off (renderer switch / Sim view).
        const resume = resumeRef.current
        resumeRef.current = null
        if (resume && timeline.duration > 0) {
          const dur = timeline.duration
          const at = Math.max(0, Math.min(resume.absT, dur))
          pendingModeRef.current = resume.mode
          planRef.current = planFor(game.stream, resume.mode)
          setPlaybackMode(resume.mode)
          r.seekFraction(at / dur)
          // Everything up to here has already happened: no goal banner for the
          // goals already on the board, no cues re-fired, the ticker backfilled.
          prevScoreRef.current = timeline.scoreAt(at)
          for (const c of planRefB.current.game) if (c.at <= at) firedCuesRef.current.add(c.id)
          lastCommentaryAbsT.current = at
          lastAbsTRef.current = at
          cursorRef.current?.seek(at)
          setVisibleLines(lines.filter((l) => l.absT <= at).slice(-50))
          r.setSpeed(currentSpeed(planRef.current, at) * nudgeRef.current)
          if (resume.playing) r.play()
          setPhase('playing')
        }

        requestAnimationFrame(() => {
          if (!disposed) r.resize()
          // Stay paused until user picks a mode in the hero overlay
        })
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
        console.error('Renderer failed:', e)
        setErr(msg)
      })

    const onResize = (): void => rendererRef.current?.resize()
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      renderer?.destroy()
      rendererRef.current    = null
      renderer3dRef.current  = null
      cancelSpeech()
      clearBroadcast()
      firedCuesRef.current = new Set()
      sfx.dispose()
      if (goalBannerTimerRef.current)  clearTimeout(goalBannerTimerRef.current)
      if (stoppageTimerRef.current)    clearTimeout(stoppageTimerRef.current)
      if (ffRafRef.current !== null)   cancelAnimationFrame(ffRafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, rendererMode])

  // ── Per-frame update (called from onUpdate) ──────────────────────────────────
  // Wrapped in useCallback so the stable reference is captured by the renderer
  // subscription. We read from refs rather than closed-over state to avoid
  // stale captures.
  const _onUpdate = useCallback((v: MatchView): void => {
    const dur = gameDurationRef.current
    if (dur <= 0 || !v.playing) return

    const currentAbsT = v.progress * dur

    // ── Commentary ticker ─────────────────────────────────────────────────────
    // Silent during an instant replay — we don't re-narrate the goal's lead-up
    // as it re-crosses the same events. (Resync happens in _endReplay.)
    if (!replayActiveRef.current) {
      const lines = commentaryLinesRef.current
      const lastCmt = lastCommentaryAbsT.current
      if (currentAbsT < lastCmt - 1) {
        // Seek backwards — backfill
        setVisibleLines(lines.filter((l) => l.absT <= currentAbsT).slice(-50))
        lastCommentaryAbsT.current = currentAbsT
      } else {
        const newLines = lines.filter((l) => l.absT > lastCmt && l.absT <= currentAbsT)
        if (newLines.length > 0) {
          // The ticker is TEXT only. The spoken voice is the broadcast booth
          // (pre-rendered clips on the director's cues, below) — never live TTS.
          setVisibleLines((prev) => [...prev, ...newLines].slice(-50))
        }
        lastCommentaryAbsT.current = currentAbsT
      }
    }

    // ── Broadcast cues crossed this frame ─────────────────────────────────────
    // Only on continuous playback: a seek / fast-forward / replay jump passes
    // cues without firing them, and a cue fires at most once.
    {
      const prevAbs = lastAbsTRef.current
      const continuous = prevAbs < 0 || (currentAbsT >= prevAbs && currentAbsT - prevAbs <= CUE_JUMP_S)
      if (continuous && !replayActiveRef.current && !ffActiveRef.current) {
        const lower = prevAbs < 0 ? -1 : prevAbs
        const fired = firedCuesRef.current
        for (const cue of planRefB.current.game) {
          if (cue.at > currentAbsT) break
          if (cue.at <= lower || fired.has(cue.id)) continue
          fired.add(cue.id)
          fireCue(cue)
        }
      }
    }

    // ── SFX cue map + stoppage chip ───────────────────────────────────────────
    // One walk of the events that actually crossed this frame — the cursor keeps
    // its place, so this is a couple of iterations rather than a 20k-event scan.
    let crossedWhistle: StoppageReason | undefined
    for (const { ev } of cursorRef.current?.advance(currentAbsT) ?? []) {
      switch (ev.type) {
        case 'pass':         sfx.pass();                          break
        case 'shot':         sfx.shot(ev.danger);                 break
        case 'save':         sfx.save();                          break
        case 'faceoff':      sfx.puckDrop();                      break
        case 'whistle':      sfx.whistle(); crossedWhistle = ev.reason ?? 'other'; break
        case 'periodEnd':    sfx.whistle();                       break
        case 'goal':         /* handled in score-change path */   break
      }

      // Crowd reaction
      if (ev.type === 'shot' && ev.danger >= 0.6) sfx.crowd(0.55)
      if (ev.type === 'goal') sfx.crowd(1.0)
    }

    // ── Goal detection (score change) ─────────────────────────────────────────
    const prev = prevScoreRef.current
    const homeScored = v.homeScore > prev.home
    const awayScored = v.awayScore > prev.away
    if (homeScored || awayScored) {
      // Find the exact goal event that fired — search backward from currentAbsT
      const goalEv = cursorRef.current ? findGoalEventAt(cursorRef.current, currentAbsT, 3) : null
      if (goalEv && goalEv !== lastGoalEventRef.current) {
        lastGoalEventRef.current = goalEv
        const scorerName = game.playerNames[goalEv.scorer] ?? goalEv.scorer
        const bannerText = `GOAL — ${scorerName}!`

        // SFX + crowd
        sfx.goalHorn()
        sfx.crowd(1.0)

        // The spoken goal call is the booth's (a priority-3 director cue at the
        // goal's absT, fired above) — it barges in so "GOAL" lands on the goal.

        // Banner stays up through the celebration + the replay. With the
        // broadcast package on, the on-ice tag + lower third ARE the goal
        // graphics, so the old centre banner only carries the replay controls.
        setGoalBanner({ text: bannerText, goalAbsT: currentAbsT })
        if (goalBannerTimerRef.current) clearTimeout(goalBannerTimerRef.current)

        // Watch the on-ice celebration FIRST, then cut to the instant replay.
        // We don't flag replayActive until the replay actually starts, so the
        // celebration plays at normal speed and the REPLAY watermark / skip
        // button only appear once we've cut to the replay.
        if (!replaySkipRef.current) {
          replaySkipRef.current = true
          const replayStart = Math.max(0, (currentAbsT - 8) / dur)
          const CELEBRATION_WALL_MS = 4500
          setTimeout(() => {
            if (!replaySkipRef.current) return // superseded / left
            heldViewRef.current = viewRef.current
            renderer3dRef.current?.setBoardHold(true)
            setReplayActive(true)
            replayActiveRef.current = true
            // The booth keeps talking over the replay (the analyst's line is
            // cued for it); only NEW cues are held while the replay re-crosses.
            const r = rendererRef.current
            if (!r) return
            r.seekFraction(replayStart)
            r.setSpeed(0.6)
            r.play()
            // End the replay after ~8s wall time.
            setTimeout(() => {
              if (replaySkipRef.current) _endReplay()
            }, 8000)
          }, CELEBRATION_WALL_MS)
        }
      }
      prevScoreRef.current = { home: v.homeScore, away: v.awayScore }
    }

    // ── Stoppage overlay ──────────────────────────────────────────────────────
    if (crossedWhistle && crossedWhistle !== 'goal') {
      let label: string
      switch (crossedWhistle) {
        case 'offside':      label = 'OFFSIDE';      break
        case 'icing':        label = 'ICING';        break
        case 'goalieFreeze': label = 'PUCK FROZEN';  break
        case 'penalty':      label = 'PENALTY';      break
        default:             label = 'STOPPED';
      }
      setStoppageChip(label)
      if (stoppageTimerRef.current) clearTimeout(stoppageTimerRef.current)
      stoppageTimerRef.current = setTimeout(() => setStoppageChip(null), 1800)
    }

    // ── Playback speed from plan / fast-forward between highlights ─────────────
    if (!replayActiveRef.current && !ffActiveRef.current) {
      // In extended/key modes, when we reach dead air between highlights we
      // DON'T play it — we fast-forward the clock and cut into the next one.
      const jump = nextActiveJump(planRef.current, currentAbsT)
      if (jump) {
        _startFastForward(jump.jumpToAbsT)
      } else {
        const planSpd = currentSpeed(planRef.current, currentAbsT)
        rendererRef.current?.setSpeed(planSpd * nudgeRef.current)
      }
    }

    lastAbsTRef.current = currentAbsT
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game])

  /**
   * Fast-forward the game clock from the current position to `toAbsT` without
   * rendering the filler play. Pauses the renderer, spins an on-screen clock
   * for ~0.9s, then cuts into the highlight at its plan speed.
   */
  function _startFastForward(toAbsT: number): void {
    const dur = gameDurationRef.current
    const v = viewRef.current
    if (!v || dur <= 0) return
    const fromAbsT = v.progress * dur
    if (toAbsT <= fromAbsT + 0.5) return // nothing meaningful to skip

    ffActiveRef.current = true
    rendererRef.current?.pause()
    schedulerRef.current?.cancel()

    const SPIN_MS = 900
    let startTs: number | null = null
    const step = (ts: number): void => {
      if (startTs === null) startTs = ts
      const t = Math.min(1, (ts - startTs) / SPIN_MS)
      // ease-out so the clock decelerates into the highlight
      const eased = 1 - (1 - t) * (1 - t)
      const cur = fromAbsT + (toAbsT - fromAbsT) * eased
      setFfClock(_absToClock(cur))
      if (t < 1) {
        ffRafRef.current = requestAnimationFrame(step)
        return
      }
      // Cut into the highlight
      ffRafRef.current = null
      const r = rendererRef.current
      if (r) {
        r.seekFraction(toAbsT / dur)
        const planSpd = currentSpeed(planRef.current, toAbsT)
        r.setSpeed(planSpd * nudgeRef.current)
        r.play()
      }
      lastCommentaryAbsT.current = toAbsT
      lastAbsTRef.current        = toAbsT
      cursorRef.current?.seek(toAbsT)
      setVisibleLines(commentaryLinesRef.current.filter((l) => l.absT <= toAbsT).slice(-50))
      ffActiveRef.current = false
      setFfClock(null)
    }
    ffRafRef.current = requestAnimationFrame(step)
  }

  function _endReplay(): void {
    replaySkipRef.current = false
    heldViewRef.current = null
    renderer3dRef.current?.setBoardHold(false)
    setReplayActive(false)
    replayActiveRef.current = false
    setGoalBanner(null)
    if (goalBannerTimerRef.current) clearTimeout(goalBannerTimerRef.current)
    // Resume normal plan speed and re-sync the commentary/SFX cursors to the
    // resume point so normal play doesn't replay a burst of crossed events.
    const dur = gameDurationRef.current
    const v = viewRef.current
    if (dur > 0 && v) {
      const at = v.progress * dur
      lastCommentaryAbsT.current = at
      cursorRef.current?.seek(at)
      lastAbsTRef.current        = at
      const planSpd = currentSpeed(planRef.current, at)
      rendererRef.current?.setSpeed(planSpd * nudgeRef.current)
    }
  }

  // ── Auto-scroll ticker ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = tickerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visibleLines])

  // ── Hero overlay: user picks a mode ──────────────────────────────────────────
  /** Picked a mode: run the broadcast open (skippable), then drop the puck. */
  function handleDropPuck(mode: PlaybackMode): void {
    // User gesture — unlock the AudioContexts
    sfx.resume()
    sfx.crowd(0.15)
    boothRef.current?.resume()
    pendingModeRef.current = mode

    const open = planRefB.current
    if (open.pregameMs <= 0 || open.pregame.length === 0) {
      startPlay(mode)
      return
    }
    setPhase('pregame')
    for (const cue of open.pregame) {
      cueTimersRef.current.push(setTimeout(() => fireCue(cue), cue.at))
    }
    pregameTimerRef.current = setTimeout(() => startPlay(mode), open.pregameMs)
  }

  const pendingModeRef = useRef<PlaybackMode>('full')

  /** Skip the open (click or Space): straight to puck drop. */
  function skipPregame(): void {
    clearBroadcast()
    startPlay(pendingModeRef.current)
  }

  function startPlay(mode: PlaybackMode): void {
    if (pregameTimerRef.current) clearTimeout(pregameTimerRef.current)
    pregameTimerRef.current = null
    setLiveOverlays([])
    // Build speed plan for chosen mode
    planRef.current = planFor(game.stream, mode)
    setPlaybackMode(mode)
    setPhase('playing')

    // Set initial speed and play. In extended/key, cut straight to the first
    // highlight so we open on the action, not on a 30× skip.
    const dur = gameDurationRef.current
    let startAbsT = 0
    if (mode !== 'full') {
      const segs = planRef.current.filter((s) => s.speed < SKIP_SPEED)
      if (segs.length > 0 && dur > 0) {
        startAbsT = segs[0].fromAbsT
        rendererRef.current?.seekFraction(startAbsT / dur)
        // Cues before the first highlight were never shown — don't fire them.
        for (const c of planRefB.current.game) if (c.at < startAbsT) firedCuesRef.current.add(c.id)
      }
    }
    const initSpd = dur > 0 ? currentSpeed(planRef.current, startAbsT) : 2
    rendererRef.current?.setSpeed(initSpd)
    rendererRef.current?.play()
  }

  // Space skips the open.
  useEffect(() => {
    if (phase !== 'pregame') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space') { e.preventDefault(); skipPregame() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Controls ──────────────────────────────────────────────────────────────────
  function handleToggleRenderer(): void {
    const next = rendererMode === '3d' ? '2d' : '3d'
    // Keep the game where it is: the new renderer picks up the same moment.
    const v = viewRef.current
    const dur = gameDurationRef.current
    if (phase === 'playing' && v && dur > 0) {
      // mid-replay: resume at the LIVE moment the replay cut away from
      const live = replayActiveRef.current ? (heldViewRef.current ?? v) : v
      resumeRef.current = {
        absT: live.progress * dur,
        playing: replayActiveRef.current || v.playing,
        mode: pendingModeRef.current,
      }
    } else if (phase === 'pregame') {
      resumeRef.current = { absT: 0, playing: true, mode: pendingModeRef.current }
    }
    if (replayActiveRef.current || replaySkipRef.current) {
      replaySkipRef.current = false
      heldViewRef.current = null
      replayActiveRef.current = false
      setReplayActive(false)
      setGoalBanner(null)
    }
    ffActiveRef.current = false
    setFfClock(null)
    writeRendererPref(next)
    setRendererMode(next)
    setView(null)
    setErr(null)
    setPhase(resumeRef.current ? 'playing' : 'hero')
    clearBroadcast()
  }

  function handleCamPreset(preset: CameraPreset): void {
    setCamPreset(preset)
    renderer3dRef.current?.setCamera(preset)
  }

  function handleCommentaryToggle(): void {
    const next = !commentaryOn
    setCommentaryEnabled(next)
    setCommentaryOn(next)
  }

  function handlePresentation(p: PresentationSetting): void {
    writePresentation(p)
    setPresentation(p)
  }

  function handleSfxToggle(): void {
    const next = !sfxEnabled
    setSfxEnabled(next)
    sfx.setEnabled(next)
  }

  function handleNudge(mult: number): void {
    setNudge(mult)
    nudgeRef.current = mult
    // Apply immediately
    const dur = gameDurationRef.current
    const v = viewRef.current
    if (dur > 0 && v) {
      const at = v.progress * dur
      const planSpd = currentSpeed(planRef.current, at)
      rendererRef.current?.setSpeed(planSpd * mult)
    }
  }

  function handlePause(): void {
    rendererRef.current?.toggle()
    schedulerRef.current?.cancel()
  }

  function handleSeek(fraction: number): void {
    rendererRef.current?.seekFraction(fraction)
    clearBroadcast()
    const dur = gameDurationRef.current
    if (dur > 0) {
      const at = fraction * dur
      // Seeking back re-arms the cues after the seek point.
      const fired = firedCuesRef.current
      for (const c of planRefB.current.game) if (c.at > at) fired.delete(c.id)
      const backfill = commentaryLinesRef.current.filter((l) => l.absT <= at)
      setVisibleLines(backfill.slice(-50))
      lastCommentaryAbsT.current = at
      lastAbsTRef.current        = at
      cursorRef.current?.seek(at)
      // Also apply correct plan speed at seek destination
      const planSpd = currentSpeed(planRef.current, at)
      rendererRef.current?.setSpeed(planSpd * nudgeRef.current)
    }
  }

  function handleSkipReplay(): void {
    _endReplay()
  }

  function handleWatchReplay(): void {
    const banner = goalBanner
    if (!banner || !gameDurationRef.current) return
    const replayStart = Math.max(0, (banner.goalAbsT - 8) / gameDurationRef.current)
    replaySkipRef.current = true
    heldViewRef.current = viewRef.current
    renderer3dRef.current?.setBoardHold(true)
    setReplayActive(true)
    replayActiveRef.current = true
    rendererRef.current?.seekFraction(replayStart)
    rendererRef.current?.setSpeed(0.6)
    rendererRef.current?.play()
    setTimeout(() => {
      if (replaySkipRef.current) _endReplay()
    }, 8000)
  }

  // Scorebug power-play strip, from the stream's own penalties.
  const absNow = view ? view.progress * gameDurationRef.current : 0
  const ppNow = ppWindows.find((w) => w.fromAbsT <= absNow && absNow < w.toAbsT) ?? null
  const showBroadcast = presentation !== 'off'

  const userSide = game.userIsHome ? 'home' : 'away'

  // What the score graphics show: the live view, except during a replay, when
  // they hold the score/clock from the moment we cut to it.
  const held = replayActive ? heldViewRef.current : null
  const shownView: MatchView | null = view && held
    ? { ...view, homeScore: held.homeScore, awayScore: held.awayScore, clock: held.clock, period: held.period }
    : view

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <section style={{ position: 'relative' }}>
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12, gap: 10, flexWrap: 'wrap',
      }}>
        <Scoreboard game={game} view={shownView} userSide={userSide} replay={replayActive} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 2D / 3D toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['3d', '2d'] as const).map((m) => (
              <button key={m} className="btn btn-ghost"
                onClick={() => { if (rendererMode !== m) handleToggleRenderer() }}
                style={rendererMode === m ? modeActiveStyle : {}}
                title={`Switch to ${m.toUpperCase()} view`}
              >{m.toUpperCase()}</button>
            ))}
          </div>

          {/* Broadcast booth commentary (pre-rendered; off by default) */}
          <button className="btn btn-ghost" onClick={handleCommentaryToggle}
            title={commentaryOn ? 'Mute the broadcast booth' : 'Turn on booth commentary (experimental)'}
            style={commentaryOn ? modeActiveStyle : { opacity: 0.5 }}>
            <Icon size={14}>{commentaryOn ? <Icons.Volume /> : <Icons.VolumeOff />}</Icon> Commentary
          </button>

          {/* SFX toggle */}
          <button className="btn btn-ghost" onClick={handleSfxToggle}
            title={sfxEnabled ? 'Mute SFX' : 'Enable SFX'}
            style={sfxEnabled ? modeActiveStyle : { opacity: 0.5 }}>
            <Icon size={14}>{sfxEnabled ? <Icons.Volume /> : <Icons.VolumeOff />}</Icon> SFX
          </button>

          <button onClick={props.onClose} className="btn">
            {view?.ended ? 'Back to hub' : 'Leave game'}
          </button>
        </div>
      </div>

      {/* ── Main layout: viewport + commentary ─────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>

        {/* ── Viewport ──────────────────────────────────────────────────── */}
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <div ref={hostRef} style={{
            width: '100%', aspectRatio: '2.35 / 1',
            background: '#0c1016', borderRadius: 10, overflow: 'hidden',
          }} />

          {/* Broadcast package: scorebug + TV graphics over either renderer */}
          {showBroadcast && phase !== 'hero' && (
            <div className="bc-layer">
              {phase === 'playing' && (
                <Scorebug ctx={bctx} view={shownView} pp={replayActive ? null : ppNow}
                  ppRemaining={ppNow ? ppRemaining(ppNow.toAbsT, absNow) : null} replay={replayActive} />
              )}
              {phase === 'pregame' && <div className="bc-live"><i /> LIVE</div>}
              <BroadcastOverlayLayer ctx={bctx} live={liveOverlays}
                projector={projectorOf(rendererRef.current)} bounds={hostSize} />
            </div>
          )}
          {phase === 'pregame' && (
            <button className="bc-skip" onClick={skipPregame} title="Skip the open (Space)">
              SKIP OPEN ›
            </button>
          )}

          {/* Hero overlay — pick a mode before play starts */}
          {phase === 'hero' && (
            <div style={heroOverlayStyle}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                  <Icon color="var(--violet-h)" style={{ fontSize: 36 }}><Icons.Replay /></Icon>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: 1 }}>
                  DROP THE PUCK
                </div>
                <div style={{ color: MUTED, fontSize: 13, marginTop: 6 }}>
                  {game.awayAbbr} @ {game.homeAbbr}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <ModeCard
                  title="Full Game"
                  subtitle="~10 min"
                  desc="2× with drama at 1×"
                  onClick={() => handleDropPuck('full')}
                />
                <ModeCard
                  title="Extended"
                  subtitle="~4 min"
                  desc="All highlights at 1.5×"
                  onClick={() => handleDropPuck('extended')}
                />
                <ModeCard
                  title="Key Moments"
                  subtitle="~60 sec"
                  desc="Fast-forward to every goal"
                  onClick={() => handleDropPuck('key')}
                />
              </div>
            </div>
          )}

          {/* GOAL banner */}
          {goalBanner && (
            <div style={showBroadcast ? replayChipStyle : goalBannerStyle}>
              {!showBroadcast && <div style={{ fontSize: 26, fontWeight: 800 }}>{goalBanner.text}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: showBroadcast ? 0 : 10, justifyContent: 'center' }}>
                {replayActive ? (
                  <button className="btn" style={{ fontSize: 12, padding: '4px 12px', background: 'rgba(0,0,0,0.5)' }}
                    onClick={handleSkipReplay}>
                    Skip replay ›
                  </button>
                ) : (
                  <button className="btn" style={{ fontSize: 12, padding: '4px 12px', background: 'rgba(0,0,0,0.5)' }}
                    onClick={handleWatchReplay}>
                    <Icon size={14}><Icons.Play /></Icon> Watch replay
                  </button>
                )}
              </div>
            </div>
          )}

          {/* REPLAY watermark (the scorebug carries the tag when the broadcast package is on) */}
          {replayActive && !(showBroadcast && phase === 'playing') && (
            <div style={{ ...replayBadgeStyle, ...(showBroadcast ? { top: 48 } : {}) }}>REPLAY</div>
          )}

          {/* Stoppage chip */}
          {stoppageChip && (
            <div style={stoppageChipStyle}>{stoppageChip}</div>
          )}

          {/* Fast-forward interstitial: the spinning clock between highlights */}
          {ffClock && (
            <div style={ffOverlayStyle}>
              <div style={{ fontSize: 12, letterSpacing: 2, color: MUTED, marginBottom: 6 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={14}><Icons.FastForward /></Icon> FAST-FORWARDING</span>
              </div>
              <div style={{ fontSize: 44, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                {ffClock}
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>to the next goal…</div>
            </div>
          )}
        </div>

        {/* ── Commentary ticker ──────────────────────────────────────────── */}
        <div style={tickerContainerStyle}>
          <div style={tickerHeaderStyle}>
            <span style={{ color: MUTED, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
              Commentary
            </span>
          </div>
          <div ref={tickerRef} style={tickerScrollStyle}>
            {visibleLines.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 12, padding: '8px 4px' }}>
                {phase === 'hero' ? 'Pick a mode to begin…' : 'Awaiting first event…'}
              </div>
            ) : (
              visibleLines
                .filter((l) => l.importance >= 2 || true) // show all; can filter here
                .map((line, i) => (
                  <div key={`${line.absT}-${i}`} style={{
                    padding: '5px 4px',
                    borderBottom: `1px solid rgba(42,34,64,0.4)`,
                    fontSize: 12, lineHeight: 1.4,
                    color: line.importance === 3 ? '#ffd700' : line.importance === 2 ? 'var(--text)' : MUTED,
                    fontWeight: line.importance === 3 ? 700 : 400,
                    background: line.importance === 3 ? 'rgba(255,215,0,0.06)' : 'transparent',
                  }}>
                    <span style={{ color: MUTED, fontSize: 10, marginRight: 4 }}>{line.clock}</span>
                    {line.text}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {err && (
        <pre style={{
          marginTop: 12, padding: 12, background: '#2a1416',
          color: '#ff9a9a', borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap',
        }}>
          Renderer error: {err}
        </pre>
      )}

      {/* ── Playback controls (only visible after mode is picked) ───────── */}
      {phase === 'playing' && (
        <div style={{ marginTop: 12 }}>
          {/* Row 1: pause + scrubber + nudge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" style={{ minWidth: 88 }} onClick={handlePause}>
              {view?.playing
                ? <><Icon size={14}><Icons.Pause /></Icon> Pause</>
                : view?.ended
                  ? <><Icon size={14}><Icons.Restart /></Icon> Replay</>
                  : <><Icon size={14}><Icons.Play /></Icon> Play</>}
            </button>

            <input type="range" min={0} max={1000}
              value={Math.round((view?.progress ?? 0) * 1000)}
              onChange={(e) => handleSeek(Number(e.target.value) / 1000)}
              style={{ flex: 1, minWidth: 120 }}
            />

            {/* Nudge buttons — relative to plan speed */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ color: MUTED, fontSize: 11 }}>Speed:</span>
              {NUDGE_MULTIPLIERS.map((m) => (
                <button key={m} className="btn"
                  style={nudge === m ? { ...speedActiveStyle, fontSize: 12, padding: '4px 8px' } : { fontSize: 12, padding: '4px 8px' }}
                  onClick={() => handleNudge(m)}
                  title={m === 1 ? 'Plan speed' : m < 1 ? 'Half speed' : 'Double speed'}
                >
                  {m}×
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: camera presets (3D only) */}
          {rendererMode === '3d' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>Camera:</span>
              {CAMERA_PRESETS.map((preset) => (
                <button key={preset} className="btn"
                  style={{ fontSize: 12, padding: '5px 10px', ...(camPreset === preset ? speedActiveStyle : {}) }}
                  onClick={() => handleCamPreset(preset)}>
                  {preset.charAt(0).toUpperCase() + preset.slice(1)}
                </button>
              ))}
            </div>
          )}

          {/* Row 3: broadcast presentation + booth status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ color: MUTED, fontSize: 12 }}>Presentation:</span>
            {(['full', 'compact', 'off'] as const).map((p) => (
              <button key={p} className="btn"
                style={{ fontSize: 12, padding: '4px 10px', ...(presentation === p ? speedActiveStyle : {}) }}
                onClick={() => handlePresentation(p)}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
            {commentaryOn && namesPending > 0 && (
              <span style={{ color: MUTED, fontSize: 11 }}>Booth: preparing {namesPending} name clips…</span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModeCard(props: {
  title: string
  subtitle: string
  desc: string
  onClick: () => void
}): JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <button
      className="btn"
      onClick={props.onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 150, padding: '16px 12px', textAlign: 'center',
        background: hover ? 'var(--bg3)' : 'var(--bg2)',
        border: `1px solid ${hover ? 'var(--violet)' : 'var(--line)'}`,
        borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s ease',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{props.title}</span>
      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--violet-h)' }}>{props.subtitle}</span>
      <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{props.desc}</span>
    </button>
  )
}

function Scoreboard(props: {
  game: WatchedGame
  view: MatchView | null
  userSide: 'home' | 'away'
  replay?: boolean
}): JSX.Element {
  const { game, view } = props
  const periodLabel = view ? (view.period > 3 ? 'OT' : `P${view.period}`) : 'P1'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      background: PANEL, borderRadius: 8, padding: '10px 18px',
    }}>
      <TeamScore abbr={game.awayAbbr} score={view?.awayScore ?? 0}
        color={game.awayColors.primary} mine={props.userSide === 'away'} />
      <div style={{ textAlign: 'center', minWidth: 72 }}>
        <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {view?.clock ?? '20:00'}
        </div>
        <div style={{ color: props.replay ? '#ffd700' : 'var(--muted)', fontSize: 11, fontWeight: props.replay ? 800 : 400, letterSpacing: props.replay ? 1 : 0 }}>
          {props.replay ? 'REPLAY' : periodLabel}
        </div>
      </div>
      <TeamScore abbr={game.homeAbbr} score={view?.homeScore ?? 0}
        color={game.homeColors.primary} mine={props.userSide === 'home'} />
    </div>
  )
}

function TeamScore(props: { abbr: string; score: number; color: number; mine: boolean }): JSX.Element {
  const hex = `#${props.color.toString(16).padStart(6, '0')}`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: hex, flexShrink: 0 }} />
      <span style={{ fontWeight: props.mine ? 800 : 600 }}>{props.abbr}</span>
      <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{props.score}</span>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const modeActiveStyle: CSSProperties = {
  background: 'var(--violet)',
  color: '#04122b',
  borderColor: 'var(--violet)',
}

const speedActiveStyle: CSSProperties = {
  background: 'var(--violet)',
  color: '#04122b',
  borderColor: 'var(--violet)',
}

const heroOverlayStyle: CSSProperties = {
  position: 'absolute', inset: 0,
  background: 'rgba(10,6,22,0.88)',
  backdropFilter: 'blur(4px)',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  borderRadius: 10, zIndex: 20,
  padding: 24,
}

const goalBannerStyle: CSSProperties = {
  position: 'absolute', bottom: 20, left: '50%',
  transform: 'translateX(-50%)',
  background: 'linear-gradient(135deg, rgba(211,59,59,0.95), rgba(180,30,30,0.98))',
  color: '#fff', textAlign: 'center',
  padding: '14px 28px', borderRadius: 12,
  pointerEvents: 'auto', zIndex: 15,
  boxShadow: '0 4px 32px rgba(0,0,0,0.7)',
  textShadow: '0 2px 6px rgba(0,0,0,0.5)',
  animation: 'fadeIn 0.18s ease',
  minWidth: 240,
}

/** With the broadcast package on, the goal graphics are the tag + lower third;
 *  the replay controls sit in a small chip out of the lower third's way. */
const replayChipStyle: CSSProperties = {
  position: 'absolute', top: 12, right: 14,
  pointerEvents: 'auto', zIndex: 18,
}

const replayBadgeStyle: CSSProperties = {
  position: 'absolute', top: 12, left: 14,
  background: 'rgba(255,215,0,0.18)',
  border: '1px solid rgba(255,215,0,0.5)',
  color: '#ffd700', fontWeight: 800,
  fontSize: 11, letterSpacing: 2,
  padding: '3px 10px', borderRadius: 6,
  pointerEvents: 'none', zIndex: 14,
}

const stoppageChipStyle: CSSProperties = {
  position: 'absolute', top: '38%', left: '50%',
  transform: 'translate(-50%, -50%)',
  background: 'rgba(0,0,0,0.75)',
  color: '#fbbf24', fontWeight: 800,
  fontSize: 20, letterSpacing: 3,
  padding: '10px 28px', borderRadius: 8,
  pointerEvents: 'none', zIndex: 13,
  border: '1px solid rgba(251,191,36,0.4)',
  animation: 'fadeIn 0.12s ease',
}

const ffOverlayStyle: CSSProperties = {
  position: 'absolute', inset: 0,
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  background: 'rgba(8,6,16,0.82)',
  pointerEvents: 'none', zIndex: 12,
  textAlign: 'center',
  animation: 'fadeIn 0.1s ease',
}

const tickerContainerStyle: CSSProperties = {
  width: 220, flexShrink: 0, background: PANEL,
  borderRadius: 10, border: '1px solid rgba(42,34,64,0.8)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  alignSelf: 'stretch', maxHeight: 280,
}

const tickerHeaderStyle: CSSProperties = {
  padding: '7px 10px',
  borderBottom: '1px solid rgba(42,34,64,0.8)',
  flexShrink: 0,
}

const tickerScrollStyle: CSSProperties = {
  flex: 1, overflowY: 'auto',
  padding: '4px 8px', scrollBehavior: 'smooth',
}
