import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react'
import {
  MatchTimeline,
  type MatchView,
  generateCommentary,
  type CommentaryLine,
  buildHighlights,
  type HighlightSegment,
} from '@render2d'
import type { MatchRenderer, RinkColors } from '@render2d'
import { RinkRenderer } from '@render2d'
import { Rink3dRenderer, type CameraPreset } from '@render3d'
import type { WatchedGame } from '../worker/protocol'
import { Announcer } from './lib/announcer'
import { MatchSfx } from './lib/sfx'
import { planFor, currentSpeed, nextActiveJump, SKIP_SPEED } from '../render2d/playbackDirector'
import type { SpeedSegment } from '../render2d/playbackDirector'
import { loadKokoro, kokoroState } from './lib/kokoroVoice'
import type { GoalEvent, StoppageEvent } from '@domain'

// ── Constants ──────────────────────────────────────────────────────────────────

const MUTED = 'var(--muted)'
const PANEL = 'var(--bg1)'
const ACCENT = 'var(--violet)'
const ACCENT_H = 'var(--violet-h)'

const CAMERA_PRESETS: CameraPreset[] = ['broadcast', 'overhead', 'endzone', 'follow']
const LS_RENDERER = 'hockeyMatchRenderer'
const LS_KOKORO   = 'hockeyKokoroEnabled'

// Plan-relative nudge multipliers (relative to current plan speed)
const NUDGE_MULTIPLIERS = [0.5, 1, 2] as const

type PlaybackMode = 'full' | 'extended' | 'key'
type Phase = 'hero' | 'playing'

// ── Module-level singletons (survive re-renders, disposed on unmount) ──────────

const announcer = new Announcer()
const sfx = new MatchSfx()

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

function readKokoroPref(): boolean {
  try { return localStorage.getItem(LS_KOKORO) === 'true' } catch { return false }
}
function writeKokoroPref(v: boolean): void {
  try { localStorage.setItem(LS_KOKORO, String(v)) } catch { /* ignore */ }
}

/** Find the goal event closest to (but not after) a given absT. */
function findGoalEventAt(
  stream: WatchedGame['stream'],
  targetAbsT: number,
  tolerance = 2,
): GoalEvent | null {
  let best: GoalEvent | null = null
  let bestDiff = Infinity
  for (const ev of stream) {
    if (ev.type !== 'goal') continue
    const at = (ev.period - 1) * 1200 + ev.t
    const diff = Math.abs(at - targetAbsT)
    if (diff <= tolerance && diff < bestDiff) {
      bestDiff = diff
      best = ev
    }
  }
  return best
}

/** Find the whistle event that just crossed, given last and current absT. */
function findCrossedWhistle(
  stream: WatchedGame['stream'],
  fromAbsT: number,
  toAbsT: number,
): StoppageEvent | null {
  for (const ev of stream) {
    if (ev.type !== 'whistle') continue
    const at = (ev.period - 1) * 1200 + ev.t
    if (at > fromAbsT && at <= toAbsT) return ev as StoppageEvent
  }
  return null
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

export function MatchViewer(props: { game: WatchedGame; onClose: () => void }): JSX.Element {
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

  // SFX event tracking (keyed on last evaluated clock to avoid re-firing)
  const lastSfxAbsTRef = useRef<number>(-1)

  // Goal banner / replay
  const goalBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replayActiveRef    = useRef<boolean>(false)
  const replaySkipRef      = useRef<boolean>(false)

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
  const [phase, setPhase]               = useState<Phase>('hero')
  const [view, setView]                 = useState<MatchView | null>(null)
  const [rendererMode, setRendererMode] = useState<'2d' | '3d'>(readRendererPref)
  const [camPreset, setCamPreset]       = useState<CameraPreset>('broadcast')
  const [err, setErr]                   = useState<string | null>(null)

  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('full')
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
  const [announcerEnabled, setAnnouncerEnabled] = useState(announcer.isEnabled)
  const [sfxEnabled, setSfxEnabled]             = useState<boolean>(true)

  // Enhanced voice
  const [kokoroWanted, setKokoroWanted]         = useState<boolean>(readKokoroPref)
  const [kokoroProgress, setKokoroProgress]     = useState<number | null>(null) // 0..100 while downloading
  const [kokoroStatus, setKokoroStatus]         = useState<ReturnType<typeof kokoroState>>(kokoroState())

  // Sync refs
  nudgeRef.current       = nudge
  replayActiveRef.current = replayActive

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
    lastSfxAbsTRef.current    = -1
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
        // Start paused at speed=2; will play when user picks a mode
        r.load(timeline, colors)
        r.setSpeed(2)

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
      announcer.cancel()
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
          setVisibleLines((prev) => [...prev, ...newLines].slice(-50))
          if (v.playing) {
            const planSpd = currentSpeed(planRef.current, currentAbsT)
            const minImp: number = planSpd >= 8 ? 99 : planSpd >= 4 ? 2 : 1
            for (const line of newLines) {
              // Goal calls (importance 3) are spoken immediately, with barge-in,
              // by the goal-detection block below — skip them here so the spoken
              // "GOAL!" lands exactly on the goal, not behind queued chatter.
              if (line.importance >= minImp && line.importance < 3) {
                announcer.speak(line.speech, line.importance)
              }
            }
          }
        }
        lastCommentaryAbsT.current = currentAbsT
      }
    }

    // ── SFX cue map ───────────────────────────────────────────────────────────
    const lastSfx = lastSfxAbsTRef.current
    if (currentAbsT > lastSfx) {
      for (const ev of game.stream) {
        const at = (ev.period - 1) * 1200 + ev.t
        if (at <= lastSfx || at > currentAbsT) continue

        switch (ev.type) {
          case 'pass':         sfx.pass();                          break
          case 'shot':         sfx.shot(ev.danger);                 break
          case 'save':         sfx.save();                          break
          case 'faceoff':      sfx.puckDrop();                      break
          case 'whistle':
          case 'periodEnd':    sfx.whistle();                       break
          case 'goal':         /* handled in score-change path */   break
        }

        // Crowd reaction
        if (ev.type === 'shot' && ev.danger >= 0.6) sfx.crowd(0.55)
        if (ev.type === 'goal') sfx.crowd(1.0)
      }
      lastSfxAbsTRef.current = currentAbsT
    }

    // ── Goal detection (score change) ─────────────────────────────────────────
    const prev = prevScoreRef.current
    const homeScored = v.homeScore > prev.home
    const awayScored = v.awayScore > prev.away
    if (homeScored || awayScored) {
      // Find the exact goal event that fired — search backward from currentAbsT
      const goalEv = findGoalEventAt(game.stream, currentAbsT, 3)
      if (goalEv && goalEv !== lastGoalEventRef.current) {
        lastGoalEventRef.current = goalEv
        const scorerName = game.playerNames[goalEv.scorer] ?? goalEv.scorer
        const bannerText = `GOAL — ${scorerName}!`

        // SFX + crowd
        sfx.goalHorn()
        sfx.crowd(1.0)

        // Spoken goal call — barge in so "GOAL!" lands exactly on the goal,
        // ahead of any queued play-by-play. Prefer the generated goal line's
        // phrasing (TTS-friendly) if present, else a concise call.
        const goalLine = commentaryLinesRef.current.find(
          (l) => l.importance === 3 && Math.abs(l.absT - currentAbsT) <= 4,
        )
        announcer.cancel()
        announcer.speak(goalLine?.speech ?? `Goal! Scored by ${scorerName}.`, 3)

        // Banner stays up through the celebration + the replay.
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
            setReplayActive(true)
            replayActiveRef.current = true
            announcer.cancel() // go silent for the replay
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
    const whistle = findCrossedWhistle(game.stream, lastAbsTRef.current, currentAbsT)
    if (whistle && whistle.reason && whistle.reason !== 'goal') {
      let label: string
      switch (whistle.reason) {
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
    announcer.cancel()

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
      lastSfxAbsTRef.current     = toAbsT
      setVisibleLines(commentaryLinesRef.current.filter((l) => l.absT <= toAbsT).slice(-50))
      ffActiveRef.current = false
      setFfClock(null)
    }
    ffRafRef.current = requestAnimationFrame(step)
  }

  function _endReplay(): void {
    replaySkipRef.current = false
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
      lastSfxAbsTRef.current     = at
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
  function handleDropPuck(mode: PlaybackMode): void {
    // User gesture — unlock AudioContext
    sfx.resume()
    sfx.crowd(0.15)

    // Build speed plan for chosen mode
    planRef.current = planFor(game.stream, mode)
    setPlaybackMode(mode)
    setPhase('playing')

    // Announcer greeting
    const greets: Record<PlaybackMode, string> = {
      full:     'Welcome to the game. The puck is about to drop.',
      extended: 'Here are the extended highlights.',
      key:      'Key moments, coming up.',
    }
    announcer.speak(greets[mode], 2)

    // Set initial speed and play. In extended/key, cut straight to the first
    // highlight so we open on the action, not on a 30× skip.
    const dur = gameDurationRef.current
    let startAbsT = 0
    if (mode !== 'full') {
      const segs = planRef.current.filter((s) => s.speed < SKIP_SPEED)
      if (segs.length > 0 && dur > 0) {
        startAbsT = segs[0].fromAbsT
        rendererRef.current?.seekFraction(startAbsT / dur)
      }
    }
    const initSpd = dur > 0 ? currentSpeed(planRef.current, startAbsT) : 2
    rendererRef.current?.setSpeed(initSpd)
    rendererRef.current?.play()
  }

  // ── Controls ──────────────────────────────────────────────────────────────────
  function handleToggleRenderer(): void {
    const next = rendererMode === '3d' ? '2d' : '3d'
    writeRendererPref(next)
    setRendererMode(next)
    setView(null)
    setErr(null)
    setPhase('hero')
    announcer.cancel()
  }

  function handleCamPreset(preset: CameraPreset): void {
    setCamPreset(preset)
    renderer3dRef.current?.setCamera(preset)
  }

  function handleAnnouncerToggle(): void {
    announcer.toggle()
    setAnnouncerEnabled(announcer.isEnabled)
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
    announcer.cancel()
  }

  function handleSeek(fraction: number): void {
    rendererRef.current?.seekFraction(fraction)
    announcer.cancel()
    const dur = gameDurationRef.current
    if (dur > 0) {
      const at = fraction * dur
      const backfill = commentaryLinesRef.current.filter((l) => l.absT <= at)
      setVisibleLines(backfill.slice(-50))
      lastCommentaryAbsT.current = at
      lastAbsTRef.current        = at
      lastSfxAbsTRef.current     = at
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
    setReplayActive(true)
    replayActiveRef.current = true
    announcer.cancel() // silent during the replay
    rendererRef.current?.seekFraction(replayStart)
    rendererRef.current?.setSpeed(0.6)
    rendererRef.current?.play()
    setTimeout(() => {
      if (replaySkipRef.current) _endReplay()
    }, 8000)
  }

  // ── Enhanced-voice (Kokoro) opt-in ────────────────────────────────────────────
  function handleKokoroToggle(): void {
    const next = !kokoroWanted
    setKokoroWanted(next)
    writeKokoroPref(next)

    if (next) {
      setKokoroStatus('downloading')
      setKokoroProgress(0)
      loadKokoro((info) => {
        // transformers.js ProgressInfo: { status, progress? }
        const raw = info as Record<string, unknown>
        if (typeof raw['progress'] === 'number') {
          setKokoroProgress(Math.round(raw['progress'] as number))
        }
      })
        .then((engine) => {
          announcer.useEngine('kokoro', engine)
          setKokoroStatus('ready')
          setKokoroProgress(null)
        })
        .catch(() => {
          setKokoroStatus('failed')
          setKokoroProgress(null)
        })
    } else {
      // Switch back to system
      announcer.useEngine('system')
      setKokoroStatus('unloaded')
      setKokoroProgress(null)
    }
  }

  // On mount: if kokoro was previously enabled, try to restore it
  useEffect(() => {
    if (readKokoroPref() && kokoroState() === 'ready') {
      // Already loaded in a previous session (cache hit)
      loadKokoro().then((engine) => {
        announcer.useEngine('kokoro', engine)
        setKokoroStatus('ready')
      }).catch(() => { /* ignore */ })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const userSide = game.userIsHome ? 'home' : 'away'

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <section style={{ position: 'relative' }}>
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12, gap: 10, flexWrap: 'wrap',
      }}>
        <Scoreboard game={game} view={view} userSide={userSide} />

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

          {/* Announcer toggle */}
          {announcer.available && (
            <button className="btn btn-ghost" onClick={handleAnnouncerToggle}
              title={announcerEnabled ? 'Mute commentary' : 'Enable commentary'}
              style={announcerEnabled ? modeActiveStyle : { opacity: 0.5 }}>
              {announcerEnabled ? '🔊 Cmt' : '🔇 Cmt'}
            </button>
          )}

          {/* SFX toggle */}
          <button className="btn btn-ghost" onClick={handleSfxToggle}
            title={sfxEnabled ? 'Mute SFX' : 'Enable SFX'}
            style={sfxEnabled ? modeActiveStyle : { opacity: 0.5 }}>
            {sfxEnabled ? '🔊 SFX' : '🔇 SFX'}
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

          {/* Hero overlay — pick a mode before play starts */}
          {phase === 'hero' && (
            <div style={heroOverlayStyle}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🏒</div>
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
            <div style={goalBannerStyle}>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{goalBanner.text}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'center' }}>
                {replayActive ? (
                  <button className="btn" style={{ fontSize: 12, padding: '4px 12px', background: 'rgba(0,0,0,0.5)' }}
                    onClick={handleSkipReplay}>
                    Skip replay ›
                  </button>
                ) : (
                  <button className="btn" style={{ fontSize: 12, padding: '4px 12px', background: 'rgba(0,0,0,0.5)' }}
                    onClick={handleWatchReplay}>
                    ▶ Watch replay
                  </button>
                )}
              </div>
            </div>
          )}

          {/* REPLAY watermark */}
          {replayActive && (
            <div style={replayBadgeStyle}>REPLAY</div>
          )}

          {/* Stoppage chip */}
          {stoppageChip && (
            <div style={stoppageChipStyle}>{stoppageChip}</div>
          )}

          {/* Fast-forward interstitial: the spinning clock between highlights */}
          {ffClock && (
            <div style={ffOverlayStyle}>
              <div style={{ fontSize: 12, letterSpacing: 2, color: MUTED, marginBottom: 6 }}>
                ⏩ FAST-FORWARDING
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
              {view?.playing ? '⏸ Pause' : view?.ended ? '↺ Replay' : '▶ Play'}
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

          {/* Row 3: enhanced voice opt-in */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost"
              style={{ fontSize: 12, padding: '4px 12px', ...(kokoroWanted ? modeActiveStyle : { opacity: 0.7 }) }}
              onClick={handleKokoroToggle}
              title="Neural TTS voice — downloads ~90 MB on first use; cached after that"
            >
              🎙 Enhanced voice {kokoroWanted ? '(on)' : '(~90 MB once)'}
            </button>
            {kokoroWanted && kokoroStatus === 'downloading' && kokoroProgress !== null && (
              <span style={{ color: MUTED, fontSize: 11 }}>Downloading… {kokoroProgress}%</span>
            )}
            {kokoroWanted && kokoroStatus === 'ready' && (
              <span style={{ color: 'var(--green)', fontSize: 11 }}>✓ Neural voice active</span>
            )}
            {kokoroWanted && kokoroStatus === 'failed' && (
              <span style={{ color: 'var(--red)', fontSize: 11 }}>Download failed</span>
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
        <div style={{ color: 'var(--muted)', fontSize: 11 }}>{periodLabel}</div>
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
