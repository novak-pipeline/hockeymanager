import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { MatchTimeline, type MatchView, generateCommentary, type CommentaryLine, buildHighlights, selectMode, type HighlightSegment } from '@render2d'
import type { MatchRenderer, RinkColors } from '@render2d'
import { RinkRenderer } from '@render2d'
import { Rink3dRenderer, type CameraPreset } from '@render3d'
import type { WatchedGame } from '../worker/protocol'
import { Announcer } from './lib/announcer'

const MUTED = '#8b95a6'
const PANEL = '#11151f'
const ACCENT = '#4c9aff'

const SPEEDS = [1, 4, 8, 30]
const CAMERA_PRESETS: CameraPreset[] = ['broadcast', 'overhead', 'endzone', 'follow']

const LS_KEY = 'hockeyMatchRenderer'

type PlaybackMode = 'full' | 'extended' | 'key'

function readRendererPref(): '2d' | '3d' {
  try {
    const v = localStorage.getItem(LS_KEY)
    if (v === '2d' || v === '3d') return v
  } catch {
    // localStorage unavailable
  }
  return '3d'
}

function writeRendererPref(v: '2d' | '3d'): void {
  try {
    localStorage.setItem(LS_KEY, v)
  } catch {
    // ignore
  }
}

// Singleton announcer (renderer-scoped, survives HMR hot swap gracefully)
const announcer = new Announcer()

export function MatchViewer(props: { game: WatchedGame; onClose: () => void }): JSX.Element {
  const { game } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<MatchRenderer | null>(null)
  const renderer3dRef = useRef<Rink3dRenderer | null>(null)
  const [view, setView] = useState<MatchView | null>(null)
  const [speed, setSpeed] = useState(8)
  const [err, setErr] = useState<string | null>(null)
  const [rendererMode, setRendererMode] = useState<'2d' | '3d'>(readRendererPref)
  const [camPreset, setCamPreset] = useState<CameraPreset>('broadcast')
  const [goalBanner, setGoalBanner] = useState<string | null>(null)
  const goalBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Commentary
  const [commentaryLines, setCommentaryLines] = useState<CommentaryLine[]>([])
  const [visibleLines, setVisibleLines] = useState<CommentaryLine[]>([])
  const tickerRef = useRef<HTMLDivElement>(null)
  const lastCommentaryAbsTRef = useRef<number>(-1)

  // Announcer state
  const [announcerEnabled, setAnnouncerEnabled] = useState(announcer.isEnabled)

  // Playback mode
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('full')
  const [highlights, setHighlights] = useState<HighlightSegment[]>([])
  const [skipping, setSkipping] = useState(false)
  const skipFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track the previous score to detect goals during playback
  const prevScoreRef = useRef<{ home: number; away: number }>({ home: 0, away: 0 })

  // Track absolute time for commentary ticker (derived from progress + game duration)
  const gameDurationRef = useRef<number>(0)
  const viewRef = useRef<MatchView | null>(null)
  viewRef.current = view

  // Watch for score changes to show goal banner
  useEffect(() => {
    if (!view) return
    const prev = prevScoreRef.current
    if (view.homeScore > prev.home) {
      const scorerName = findRecentGoalScorer(game, true)
      showBanner(scorerName ? `GOAL — ${scorerName}!` : 'GOAL!')
    } else if (view.awayScore > prev.away) {
      const scorerName = findRecentGoalScorer(game, false)
      showBanner(scorerName ? `GOAL — ${scorerName}!` : 'GOAL!')
    }
    prevScoreRef.current = { home: view.homeScore, away: view.awayScore }
  }, [view?.homeScore, view?.awayScore])

  function showBanner(text: string): void {
    setGoalBanner(text)
    if (goalBannerTimerRef.current) clearTimeout(goalBannerTimerRef.current)
    goalBannerTimerRef.current = setTimeout(() => setGoalBanner(null), 3000)
  }

  // Build/rebuild renderer when game or mode changes
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let renderer: MatchRenderer | null = null

    const homeIds = new Set<string>(game.homePlayerIds)
    const timeline = new MatchTimeline(game.stream, (id) => homeIds.has(id))
    gameDurationRef.current = timeline.duration

    const colors: RinkColors = {
      home: game.homeColors.primary,
      away: game.awayColors.primary,
    }

    prevScoreRef.current = { home: 0, away: 0 }
    setGoalBanner(null)

    // Build commentary lines
    const namesFn = (id: string): string => game.playerNames[id] ?? id
    const isHomeFn = (id: string): boolean => homeIds.has(id)
    const lines = generateCommentary(game.stream, namesFn, isHomeFn, {
      home: game.homeAbbr,
      away: game.awayAbbr,
    })
    setCommentaryLines(lines)
    setVisibleLines([])
    lastCommentaryAbsTRef.current = -1

    // Build highlight segments
    const segs = buildHighlights(game.stream)
    setHighlights(segs)

    const promise =
      rendererMode === '3d'
        ? Rink3dRenderer.create(host, colors)
        : RinkRenderer.create(host, colors)

    promise
      .then((r) => {
        if (disposed) {
          r.destroy()
          return
        }
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
          updateCommentaryTicker(v, lines)
          handleHighlightSkip(v)
        })
        r.setSpeed(speed)
        r.load(timeline, colors)

        requestAnimationFrame(() => {
          if (!disposed) {
            r.resize()
            r.play()
          }
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
      rendererRef.current = null
      renderer3dRef.current = null
      announcer.cancel()
      if (goalBannerTimerRef.current) clearTimeout(goalBannerTimerRef.current)
      if (skipFlashTimerRef.current) clearTimeout(skipFlashTimerRef.current)
    }
    // Re-build when game or mode changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, rendererMode])

  useEffect(() => {
    rendererRef.current?.setSpeed(speed)
  }, [speed])

  // Commentary ticker updater (called from onUpdate callback)
  function updateCommentaryTicker(v: MatchView, lines: CommentaryLine[]): void {
    const dur = gameDurationRef.current
    if (dur <= 0) return
    const currentAbsT = v.progress * dur

    // On seek: if we went backwards, reset and backfill
    const lastAbsT = lastCommentaryAbsTRef.current
    if (currentAbsT < lastAbsT - 1) {
      // Seek backwards — backfill all lines up to current point
      const backfill = lines.filter((l) => l.absT <= currentAbsT)
      setVisibleLines(backfill)
      lastCommentaryAbsTRef.current = currentAbsT
      return
    }

    // Forward: add lines that have been crossed since last update
    const newLines = lines.filter((l) => l.absT > lastAbsT && l.absT <= currentAbsT)
    if (newLines.length > 0) {
      setVisibleLines((prev) => {
        const combined = [...prev, ...newLines]
        // Keep last 50 lines in the ticker
        return combined.slice(-50)
      })

      // Speak via announcer (importance gating by speed)
      if (v.playing) {
        for (const line of newLines) {
          const minImp = speed > 8 ? 99 : speed > 2 ? 2 : 1
          if (line.importance >= minImp) {
            announcer.speak(line.speech, line.importance)
          }
        }
      }
    }

    lastCommentaryAbsTRef.current = currentAbsT
  }

  // Highlight skip handler (called from onUpdate callback)
  function handleHighlightSkip(v: MatchView): void {
    if (playbackMode === 'full') return
    const dur = gameDurationRef.current
    if (dur <= 0) return

    const mode = playbackMode === 'key' ? 'key' : 'extended'
    const segs = selectMode(highlights, mode)
    if (segs.length === 0) return

    const currentAbsT = v.progress * dur

    // Find which segment we are in (if any)
    const segIdx = segs.findIndex(
      (s) => currentAbsT >= s.startAbsT && currentAbsT <= s.endAbsT
    )

    if (segIdx >= 0) {
      // We're in a segment — check if it just ended
      const seg = segs[segIdx]
      if (currentAbsT >= seg.endAbsT - 0.1) {
        // Find next segment
        const next = segs[segIdx + 1]
        if (next) {
          // Jump to next segment
          rendererRef.current?.seekFraction(next.startAbsT / dur)
          showSkipFlash()
        }
      }
    } else {
      // Not in any segment — skip forward to the next one
      const next = segs.find((s) => s.startAbsT > currentAbsT)
      if (next) {
        rendererRef.current?.seekFraction(next.startAbsT / dur)
        showSkipFlash()
      }
    }
  }

  function showSkipFlash(): void {
    setSkipping(true)
    if (skipFlashTimerRef.current) clearTimeout(skipFlashTimerRef.current)
    skipFlashTimerRef.current = setTimeout(() => setSkipping(false), 800)
  }

  // Auto-scroll ticker to bottom when new lines arrive
  useEffect(() => {
    const el = tickerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visibleLines])

  function handleToggleMode(): void {
    const next = rendererMode === '3d' ? '2d' : '3d'
    writeRendererPref(next)
    setRendererMode(next)
    setView(null)
    setErr(null)
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

  function handlePlaybackMode(mode: PlaybackMode): void {
    setPlaybackMode(mode)
    // When switching to highlight mode, seek to the first segment immediately
    if (mode !== 'full') {
      const filterMode = mode === 'key' ? 'key' : 'extended'
      const segs = selectMode(highlights, filterMode)
      if (segs.length > 0 && gameDurationRef.current > 0) {
        rendererRef.current?.seekFraction(segs[0].startAbsT / gameDurationRef.current)
      }
    }
  }

  function handleSeek(fraction: number): void {
    rendererRef.current?.seekFraction(fraction)
    announcer.cancel()
    // Backfill commentary on seek
    const dur = gameDurationRef.current
    if (dur > 0) {
      const currentAbsT = fraction * dur
      const backfill = commentaryLines.filter((l) => l.absT <= currentAbsT)
      setVisibleLines(backfill.slice(-50))
      lastCommentaryAbsTRef.current = currentAbsT
    }
  }

  function handlePause(): void {
    rendererRef.current?.toggle()
    announcer.cancel()
  }

  const userSide = game.userIsHome ? 'home' : 'away'

  return (
    <section>
      {/* ── top bar: scoreboard + controls ─────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <Scoreboard game={game} view={view} userSide={userSide} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 2D / 3D toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['3d', '2d'] as const).map((mode) => (
              <button
                key={mode}
                className="btn btn-ghost"
                onClick={() => {
                  if (rendererMode !== mode) handleToggleMode()
                }}
                style={rendererMode === mode ? { ...modeActiveStyle } : {}}
                title={`Switch to ${mode.toUpperCase()} view`}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Announcer toggle */}
          {announcer.available && (
            <button
              className="btn btn-ghost"
              onClick={handleAnnouncerToggle}
              title={announcerEnabled ? 'Mute commentary' : 'Enable spoken commentary'}
              style={announcerEnabled ? { ...modeActiveStyle } : { opacity: 0.5 }}
            >
              {announcerEnabled ? '🔊' : '🔇'}
            </button>
          )}

          <button onClick={props.onClose} className="btn">
            {view?.ended ? 'Back to hub' : 'Leave game'}
          </button>
        </div>
      </div>

      {/* ── playback mode selector ───────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: MUTED, fontSize: 12 }}>Mode:</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {([ 'full', 'extended', 'key' ] as const).map((mode) => (
            <button
              key={mode}
              className="btn btn-ghost"
              onClick={() => handlePlaybackMode(mode)}
              style={playbackMode === mode ? { ...modeActiveStyle, fontSize: 12, padding: '4px 10px' } : { fontSize: 12, padding: '4px 10px' }}
              title={
                mode === 'full' ? 'Watch the full game' :
                mode === 'extended' ? 'All highlights (goals, saves, hits, penalties)' :
                'Key moments only (goals, penalties, top chances)'
              }
            >
              {mode === 'full' ? 'Full' : mode === 'extended' ? 'Extended' : 'Key moments'}
            </button>
          ))}
        </div>
        {skipping && (
          <span style={{ color: MUTED, fontSize: 11, fontStyle: 'italic', animation: 'fadeIn 0.1s ease' }}>
            skipping...
          </span>
        )}
      </div>

      {/* ── main layout: viewport + commentary ──────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* ── viewport ──────────────────────────────────────────────────── */}
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <div
            ref={hostRef}
            style={{
              width: '100%',
              aspectRatio: '2.35 / 1',
              background: '#0c1016',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          />

          {/* Goal banner overlay */}
          {goalBanner && (
            <div style={goalBannerStyle}>
              {goalBanner}
            </div>
          )}
        </div>

        {/* ── commentary ticker ─────────────────────────────────────────── */}
        <div style={tickerContainerStyle}>
          <div style={tickerHeaderStyle}>
            <span style={{ color: MUTED, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
              Commentary
            </span>
          </div>
          <div ref={tickerRef} style={tickerScrollStyle}>
            {visibleLines.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 12, padding: '8px 4px' }}>
                Awaiting first event...
              </div>
            ) : (
              visibleLines.map((line, i) => (
                <div
                  key={`${line.absT}-${i}`}
                  style={{
                    padding: '5px 4px',
                    borderBottom: `1px solid rgba(42,34,64,0.4)`,
                    fontSize: 12,
                    lineHeight: 1.4,
                    color: line.importance === 3 ? '#ffd700' : line.importance === 2 ? '#e8e4f4' : MUTED,
                    fontWeight: line.importance === 3 ? 700 : 400,
                    background: line.importance === 3 ? 'rgba(255,215,0,0.06)' : 'transparent',
                  }}
                >
                  <span style={{ color: MUTED, fontSize: 10, marginRight: 4 }}>
                    {line.clock}
                  </span>
                  {line.text}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {err && (
        <pre
          style={{
            marginTop: 12,
            padding: 12,
            background: '#2a1416',
            color: '#ff9a9a',
            borderRadius: 8,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          Renderer error: {err}
        </pre>
      )}

      {/* ── playback controls ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          style={{ minWidth: 96 }}
          onClick={handlePause}
        >
          {view?.playing ? 'Pause' : view?.ended ? 'Replay' : 'Play'}
        </button>

        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round((view?.progress ?? 0) * 1000)}
          onChange={(e) => handleSeek(Number(e.target.value) / 1000)}
          style={{ flex: 1, minWidth: 120 }}
        />

        <div style={{ display: 'flex', gap: 6 }}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              className="btn"
              onClick={() => setSpeed(s)}
              style={speed === s ? { ...speedActiveStyle } : {}}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* ── camera presets (3D only) ────────────────────────────────────── */}
      {rendererMode === '3d' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <span style={{ color: MUTED, fontSize: 12 }}>Camera:</span>
          {CAMERA_PRESETS.map((preset) => (
            <button
              key={preset}
              className="btn"
              style={{
                fontSize: 12,
                padding: '5px 10px',
                ...(camPreset === preset ? speedActiveStyle : {}),
              }}
              onClick={() => handleCamPreset(preset)}
            >
              {preset.charAt(0).toUpperCase() + preset.slice(1)}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Find the name of the most recent goal scorer on the given side. */
function findRecentGoalScorer(game: WatchedGame, isHome: boolean): string | null {
  const homeIds = new Set<string>(game.homePlayerIds)
  let lastScorerId: string | null = null
  for (const ev of game.stream) {
    if (ev.type === 'goal') {
      const scorerIsHome = homeIds.has(ev.scorer)
      if (scorerIsHome === isHome) {
        lastScorerId = ev.scorer
      }
    }
  }
  if (!lastScorerId) return null
  return game.playerNames[lastScorerId] ?? null
}

// ── Sub-components ────────────────────────────────────────────────────────

function Scoreboard(props: {
  game: WatchedGame
  view: MatchView | null
  userSide: 'home' | 'away'
}): JSX.Element {
  const { game, view } = props
  const periodLabel = view ? (view.period > 3 ? 'OT' : `P${view.period}`) : 'P1'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: PANEL,
        borderRadius: 8,
        padding: '10px 18px',
      }}
    >
      <TeamScore
        abbr={game.awayAbbr}
        score={view?.awayScore ?? 0}
        color={game.awayColors.primary}
        mine={props.userSide === 'away'}
      />
      <div style={{ textAlign: 'center', minWidth: 72 }}>
        <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {view?.clock ?? '20:00'}
        </div>
        <div style={{ color: MUTED, fontSize: 11 }}>{periodLabel}</div>
      </div>
      <TeamScore
        abbr={game.homeAbbr}
        score={view?.homeScore ?? 0}
        color={game.homeColors.primary}
        mine={props.userSide === 'home'}
      />
    </div>
  )
}

function TeamScore(props: {
  abbr: string
  score: number
  color: number
  mine: boolean
}): JSX.Element {
  const hex = `#${props.color.toString(16).padStart(6, '0')}`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: hex, flexShrink: 0 }} />
      <span style={{ fontWeight: props.mine ? 800 : 600 }}>{props.abbr}</span>
      <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {props.score}
      </span>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

const modeActiveStyle: CSSProperties = {
  background: ACCENT,
  color: '#04122b',
  borderColor: ACCENT,
}

const speedActiveStyle: CSSProperties = {
  background: ACCENT,
  color: '#04122b',
  borderColor: ACCENT,
}

const goalBannerStyle: CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  background: 'rgba(211, 59, 59, 0.92)',
  color: '#fff',
  fontWeight: 800,
  fontSize: 28,
  letterSpacing: 1,
  padding: '14px 32px',
  borderRadius: 10,
  pointerEvents: 'none',
  zIndex: 10,
  boxShadow: '0 4px 32px rgba(0,0,0,0.6)',
  textShadow: '0 2px 6px rgba(0,0,0,0.5)',
  animation: 'fadeIn 0.18s ease',
}

const tickerContainerStyle: CSSProperties = {
  width: 220,
  flexShrink: 0,
  background: PANEL,
  borderRadius: 10,
  border: '1px solid rgba(42,34,64,0.8)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  // Match rink aspect ratio height approximately
  alignSelf: 'stretch',
  maxHeight: 280,
}

const tickerHeaderStyle: CSSProperties = {
  padding: '7px 10px',
  borderBottom: '1px solid rgba(42,34,64,0.8)',
  flexShrink: 0,
}

const tickerScrollStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 8px',
  scrollBehavior: 'smooth',
}
