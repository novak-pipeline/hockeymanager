import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { MatchTimeline, type MatchView } from '@render2d'
import type { MatchRenderer, RinkColors } from '@render2d'
import { RinkRenderer } from '@render2d'
import { Rink3dRenderer, type CameraPreset } from '@render3d'
import type { WatchedGame } from '../worker/protocol'

const MUTED = '#8b95a6'
const PANEL = '#11151f'
const ACCENT = '#4c9aff'

const SPEEDS = [1, 4, 8, 30]
const CAMERA_PRESETS: CameraPreset[] = ['broadcast', 'overhead', 'endzone', 'follow']

const LS_KEY = 'hockeyMatchRenderer'

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

  // Track the previous score to detect goals during playback
  const prevScoreRef = useRef<{ home: number; away: number }>({ home: 0, away: 0 })

  // Watch for score changes to show goal banner
  useEffect(() => {
    if (!view) return
    const prev = prevScoreRef.current
    if (view.homeScore > prev.home) {
      // Home scored
      const scorerName = findRecentGoalScorer(game, true)
      showBanner(scorerName ? `GOAL — ${scorerName}!` : 'GOAL!')
    } else if (view.awayScore > prev.away) {
      // Away scored
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

    const colors: RinkColors = {
      home: game.homeColors.primary,
      away: game.awayColors.primary,
    }

    prevScoreRef.current = { home: 0, away: 0 }
    setGoalBanner(null)

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

        r.onUpdate(setView)
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
      if (goalBannerTimerRef.current) clearTimeout(goalBannerTimerRef.current)
    }
    // Re-build when game or mode changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, rendererMode])

  useEffect(() => {
    rendererRef.current?.setSpeed(speed)
  }, [speed])

  function handleToggleMode(): void {
    const next = rendererMode === '3d' ? '2d' : '3d'
    writeRendererPref(next)
    setRendererMode(next)
    setView(null)
    setErr(null)
  }

  function handleCamPreset(preset: CameraPreset): void {
    setCamPreset(preset)
    renderer3dRef.current?.setCamera(preset)
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

          <button onClick={props.onClose} className="btn">
            {view?.ended ? 'Back to hub' : 'Leave game'}
          </button>
        </div>
      </div>

      {/* ── viewport ────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative' }}>
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
          onClick={() => rendererRef.current?.toggle()}
        >
          {view?.playing ? 'Pause' : view?.ended ? 'Replay' : 'Play'}
        </button>

        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round((view?.progress ?? 0) * 1000)}
          onChange={(e) => rendererRef.current?.seekFraction(Number(e.target.value) / 1000)}
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
  // Look for the last goal event in the stream for that side.
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


