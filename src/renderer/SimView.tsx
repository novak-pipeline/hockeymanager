/**
 * SIM VIEW — match night as a live gamecast (playtest C1).
 *
 * The GM liked the postgame receipt but reading a result is not the same as
 * watching one arrive. This plays the game out in text: the play-by-play prints
 * line by line and the box score fills in underneath it, on a clock the GM
 * controls (pause, 1×–8×, jump to the horn).
 *
 * It is the THIRD consumer of the keystone GameEvent stream, next to the 2D and
 * 3D renderers — same stream, no engine change, no new contract. Everything on
 * screen comes out of two pure modules that fold that stream:
 * playByPlay.ts (the feed) and liveBoxScore.ts (the table).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { WatchedGame } from '../worker/protocol'
import { EventCursor } from '../render2d/eventCursor'
import { LiveBoxScoreBuilder, type LiveBoxScore, type LiveTeamBox } from '../render2d/liveBoxScore'
import { buildPlayByPlay, periodLabel, type PlayByPlayEntry } from '../render2d/playByPlay'
import { Icon } from './components/primitives'
import { Icons } from './components/icons'

const MUTED = 'var(--muted)'
const LS_DENSITY = 'hockeySimViewDensity'

/** Wall-clock dwell (ms) on a line at 1×, by how much it matters. */
const DWELL: Record<PlayByPlayEntry['weight'], number> = {
  key: 1100,
  normal: 420,
  ambient: 190,
}

const SPEEDS = [1, 2, 4, 8] as const

function readDensity(): 'all' | 'key' {
  try { return localStorage.getItem(LS_DENSITY) === 'key' ? 'key' : 'all' } catch { return 'all' }
}

/**
 * Newest line at the top, but plays that share a clock stay in the order they
 * happened. A flat reverse printed "Save Berg" above the shot Berg had just
 * saved, because both land on the same second.
 */
function newestFirst(entries: PlayByPlayEntry[]): PlayByPlayEntry[] {
  const out: PlayByPlayEntry[] = []
  let end = entries.length
  while (end > 0) {
    let start = end - 1
    while (start > 0 && entries[start - 1].absT === entries[end - 1].absT) start--
    for (let i = start; i < end; i++) out.push(entries[i])
    end = start
  }
  return out
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function SimView(props: {
  game: WatchedGame
  onClose: () => void
  /** Hand the same game over to the on-ice viewer without re-simming it. */
  onWatchOnIce?: () => void
}): JSX.Element {
  const { game } = props

  const homeIds = useMemo(() => new Set(game.homePlayerIds), [game])
  const nameOf = useCallback((id: string): string => game.playerNames[id] ?? id, [game])

  /** The whole feed, every play. The density toggle filters this view of it. */
  const fullFeed = useMemo(
    () => buildPlayByPlay(game.stream, (id) => nameOf(id as string), (id) => homeIds.has(id as string), {
      home: game.homeAbbr,
      away: game.awayAbbr,
    }),
    [game, homeIds, nameOf]
  )

  const [density, setDensity] = useState<'all' | 'key'>(readDensity)
  const feed = useMemo(
    () => (density === 'all' ? fullFeed : fullFeed.filter((e) => e.weight !== 'ambient')),
    [fullFeed, density]
  )

  const [idx, setIdx] = useState(0)          // lines revealed so far
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<number>(2)
  const [boxSide, setBoxSide] = useState<'home' | 'away'>(game.userIsHome ? 'home' : 'away')
  const [box, setBox] = useState<LiveBoxScore | null>(null)

  // The fold state: one cursor over the stream and one accumulator, advanced —
  // never rebuilt — as the clock moves. Rebuilt only when the game changes.
  const foldRef = useRef<{ cursor: EventCursor; builder: LiveBoxScoreBuilder } | null>(null)
  if (foldRef.current === null) {
    foldRef.current = {
      cursor: new EventCursor(game.stream),
      builder: new LiveBoxScoreBuilder({
        stream: game.stream,
        homePlayerIds: game.homePlayerIds,
        names: (id) => nameOf(id as string),
        abbrs: { home: game.homeAbbr, away: game.awayAbbr },
      }),
    }
  }

  /** Fold the stream forward to `absT` and publish the table. */
  const foldTo = useCallback((absT: number): void => {
    const fold = foldRef.current
    if (!fold) return
    for (const { ev, absT: at } of fold.cursor.advance(absT)) fold.builder.apply(ev, at)
    setBox(fold.builder.snapshot())
  }, [])

  // Reset everything when a different game is handed in.
  useEffect(() => {
    foldRef.current = {
      cursor: new EventCursor(game.stream),
      builder: new LiveBoxScoreBuilder({
        stream: game.stream,
        homePlayerIds: game.homePlayerIds,
        names: (id) => game.playerNames[id as string] ?? (id as string),
        abbrs: { home: game.homeAbbr, away: game.awayAbbr },
      }),
    }
    setIdx(0)
    setPlaying(true)
    setBox(foldRef.current.builder.snapshot())
  }, [game])

  const done = idx >= feed.length

  // ── the clock: reveal one line, wait, reveal the next ──────────────────────
  useEffect(() => {
    if (!playing || done) return
    const entry = feed[idx]
    const wait = Math.max(40, DWELL[entry.weight] / speed)
    const timer = setTimeout(() => {
      foldTo(entry.absT)
      setIdx((i) => i + 1)
    }, wait)
    return () => clearTimeout(timer)
  }, [playing, done, feed, idx, speed, foldTo])

  const jumpToEnd = useCallback((): void => {
    setPlaying(false)
    foldTo(Number.MAX_SAFE_INTEGER)
    setIdx(feed.length)
  }, [feed.length, foldTo])

  // Space toggles play/pause, Enter jumps to the horn — the same muscle memory
  // the processing overlay uses.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const t = e.target as HTMLElement | null
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        if (!done) setPlaying((p) => !p)
      } else if (e.key === 'Enter' && !done) {
        e.preventDefault()
        jumpToEnd()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [done, jumpToEnd])

  const changeDensity = (d: 'all' | 'key'): void => {
    // Keep the GM at the same moment of the game when the filter changes.
    const atAbsT = idx > 0 ? feed[idx - 1].absT : 0
    setDensity(d)
    try { localStorage.setItem(LS_DENSITY, d) } catch { /* ignore */ }
    const next = d === 'all' ? fullFeed : fullFeed.filter((e) => e.weight !== 'ambient')
    let n = 0
    while (n < next.length && next[n].absT <= atAbsT) n++
    setIdx(n)
  }

  const shown = feed.slice(0, idx)
  const latest = shown.length > 0 ? shown[shown.length - 1] : null
  const homeScore = latest?.homeScore ?? 0
  const awayScore = latest?.awayScore ?? 0
  const period = latest?.period ?? 1
  const clock = latest?.clock ?? '20:00'
  const userSide: 'home' | 'away' = game.userIsHome ? 'home' : 'away'
  const userWon = homeScore !== awayScore && (userSide === 'home') === (homeScore > awayScore)

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0 }}>
      {/* ── scoreboard ─────────────────────────────────────────────────── */}
      <div style={scoreboardStyle}>
        <TeamScore
          abbr={game.awayAbbr}
          name={game.awayName}
          score={awayScore}
          shots={box?.away.shots ?? 0}
          color={game.awayColors.primary}
          mine={userSide === 'away'}
        />
        <div style={{ textAlign: 'center', minWidth: 110 }}>
          <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>
            {done ? 'FINAL' : clock}
          </div>
          <div style={{ color: MUTED, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>
            {/* away–home, matching the left-to-right order of the board above. */}
            {done ? `${awayScore}–${homeScore}` : periodLabel(period)}
          </div>
        </div>
        <TeamScore
          abbr={game.homeAbbr}
          name={game.homeName}
          score={homeScore}
          shots={box?.home.shots ?? 0}
          color={game.homeColors.primary}
          mine={userSide === 'home'}
        />
      </div>

      {/* ── controls ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          style={{ minWidth: 104 }}
          onClick={() => setPlaying((p) => !p)}
          disabled={done}
          aria-label={playing ? 'Pause the game' : 'Resume the game'}
        >
          {playing ? 'Pause' : 'Play'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>Speed</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              className="btn"
              style={{ fontSize: 12, padding: '4px 9px', ...(speed === s ? activeStyle : {}) }}
              onClick={() => setSpeed(s)}
              title={`${s}× — ${s === 1 ? 'watch every play land' : 'faster'}`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>Feed</span>
          {(['all', 'key'] as const).map((d) => (
            <button
              key={d}
              className="btn"
              style={{ fontSize: 12, padding: '4px 9px', ...(density === d ? activeStyle : {}) }}
              onClick={() => changeDensity(d)}
              title={d === 'all' ? 'Every play' : 'Goals, penalties and chances only'}
            >
              {d === 'all' ? 'Every play' : 'Key plays'}
            </button>
          ))}
        </div>

        <button className="btn" style={{ fontSize: 12 }} onClick={jumpToEnd} disabled={done} aria-label="Jump to the final horn">
          Jump to the horn
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {props.onWatchOnIce && (
            <button className="btn btn-ghost" onClick={props.onWatchOnIce} title="Watch this same game on the ice">
              Watch on the ice
            </button>
          )}
          <button className="btn" onClick={props.onClose}>
            {done ? 'Back to the hub' : 'Leave game'}
          </button>
        </div>
      </div>

      {/* ── the game itself: feed on the left, box score on the right ──── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', minHeight: 0, flex: 1 }}>
        <div style={{ ...panelStyle, flex: '0 0 42%', minWidth: 320 }}>
          <div style={panelHeaderStyle}>
            <span>Play-by-play</span>
            <span style={{ color: MUTED, fontWeight: 500 }}>{shown.length} / {feed.length}</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {shown.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 12.5, padding: 14 }}>Warm-ups are over. Puck drop…</div>
            ) : (
              // Newest at the top: the line that just landed is always in view,
              // with no scroll chasing.
              newestFirst(shown).map((e, i) => <FeedLine key={`${e.absT}-${shown.length - i}`} entry={e} fresh={i === 0} />)
            )}
          </div>
        </div>

        <div style={{ ...panelStyle, flex: 1, minWidth: 0 }}>
          <div style={panelHeaderStyle}>
            <span>Box score</span>
            <span style={{ display: 'flex', gap: 4 }}>
              {(['away', 'home'] as const).map((s) => (
                <button
                  key={s}
                  className="btn"
                  style={{ fontSize: 11, padding: '2px 8px', ...(boxSide === s ? activeStyle : {}) }}
                  onClick={() => setBoxSide(s)}
                >
                  {s === 'home' ? game.homeAbbr : game.awayAbbr}
                </button>
              ))}
            </span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '2px 10px 10px' }}>
            {box ? <BoxTable team={boxSide === 'home' ? box.home : box.away} /> : null}
          </div>
        </div>
      </div>

      {done && (
        <div style={{
          padding: '10px 14px', borderRadius: 10,
          background: userWon ? 'rgba(74,222,128,0.10)' : 'rgba(248,113,113,0.10)',
          border: `1px solid ${userWon ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)'}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Icon size={16}><Icons.Result /></Icon>
          <span style={{ fontWeight: 700 }}>
            {userWon ? 'Two points.' : 'That one got away.'}
          </span>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {game.awayAbbr} {awayScore} — {game.homeAbbr} {homeScore} · shots {box?.away.shots ?? 0}–{box?.home.shots ?? 0}
          </span>
        </div>
      )}
    </section>
  )
}

// ── sub-components ───────────────────────────────────────────────────────────

function FeedLine({ entry, fresh }: { entry: PlayByPlayEntry; fresh: boolean }): JSX.Element {
  const isGoal = entry.kind === 'goal'
  const isPenalty = entry.kind === 'penalty'
  const isMarker = entry.kind === 'periodEnd' || entry.kind === 'gameEnd'
  const color = isGoal ? '#ffd700' : isPenalty ? 'var(--amber, #fbbf24)' : isMarker ? 'var(--violet-h, #b9a7ff)' : 'inherit'
  return (
    <div
      className={fresh ? 'anim-in' : undefined}
      style={{
        display: 'flex', gap: 8, alignItems: 'baseline',
        padding: '6px 12px',
        borderBottom: '1px solid var(--border, rgba(255,255,255,0.05))',
        fontSize: 12.5, lineHeight: 1.45,
        background: isGoal ? 'rgba(255,215,0,0.07)' : isMarker ? 'rgba(124,92,231,0.07)' : 'transparent',
        fontWeight: isGoal || isMarker ? 700 : entry.weight === 'ambient' ? 400 : 600,
        color: entry.weight === 'ambient' && !isGoal ? MUTED : 'inherit',
      }}
    >
      <span style={{ color: MUTED, fontSize: 10.5, fontVariantNumeric: 'tabular-nums', flex: '0 0 62px' }}>
        {periodLabel(entry.period)} {entry.clock}
      </span>
      {entry.teamAbbr && (
        <span style={{ fontSize: 10.5, fontWeight: 800, flex: '0 0 34px', color: MUTED }}>{entry.teamAbbr}</span>
      )}
      <span style={{ minWidth: 0, color }}>{entry.text}</span>
    </div>
  )
}

function BoxTable({ team }: { team: LiveTeamBox }): JSX.Element {
  const th: CSSProperties = { textAlign: 'right', padding: '4px 5px', fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4 }
  const td: CSSProperties = { textAlign: 'right', padding: '3px 5px', fontVariantNumeric: 'tabular-nums' }
  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr className="muted">
            <th style={{ ...th, textAlign: 'left' }}>Skater</th>
            <th style={th}>G</th>
            <th style={th}>A</th>
            <th style={th}>P</th>
            <th style={th}>+/−</th>
            <th style={th}>S</th>
            <th style={th}>H</th>
            <th style={th}>B</th>
            <th style={th}>PIM</th>
            <th style={th}>TOI</th>
          </tr>
        </thead>
        <tbody>
          {team.skaters.length === 0 ? (
            <tr><td colSpan={10} className="muted" style={{ padding: '10px 4px', fontSize: 12 }}>No shifts logged yet.</td></tr>
          ) : team.skaters.map((s) => (
            <tr key={s.playerId} style={{ borderTop: '1px solid var(--border, rgba(255,255,255,0.05))' }}>
              <td style={{ padding: '3px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>
                {s.name}
              </td>
              <td style={{ ...td, fontWeight: s.goals > 0 ? 800 : 400 }}>{s.goals}</td>
              <td style={td}>{s.assists}</td>
              <td style={{ ...td, fontWeight: s.points > 0 ? 700 : 400 }}>{s.points}</td>
              <td style={{ ...td, color: s.plusMinus > 0 ? 'var(--green, #4ade80)' : s.plusMinus < 0 ? 'var(--red, #f87171)' : MUTED }}>
                {s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}
              </td>
              <td style={td}>{s.shots}</td>
              <td style={td}>{s.hits}</td>
              <td style={td}>{s.blocks}</td>
              <td style={td}>{s.penaltyMinutes}</td>
              <td style={{ ...td, color: MUTED }}>{mmss(s.toi)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 12 }}>
        <thead>
          <tr className="muted">
            <th style={{ ...th, textAlign: 'left' }}>Goaltender</th>
            <th style={th}>SA</th>
            <th style={th}>SV</th>
            <th style={th}>GA</th>
            <th style={th}>SV%</th>
          </tr>
        </thead>
        <tbody>
          {team.goalies.length === 0 ? (
            <tr><td colSpan={5} className="muted" style={{ padding: '10px 4px', fontSize: 12 }}>Nothing on net yet.</td></tr>
          ) : team.goalies.map((g) => (
            <tr key={g.playerId} style={{ borderTop: '1px solid var(--border, rgba(255,255,255,0.05))' }}>
              <td style={{ padding: '3px 5px' }}>{g.name}</td>
              <td style={td}>{g.shotsAgainst}</td>
              <td style={td}>{g.saves}</td>
              <td style={td}>{g.goalsAgainst}</td>
              <td style={td}>{g.shotsAgainst > 0 ? g.savePct.toFixed(3).replace(/^0/, '') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="muted" style={{ fontSize: 11.5, marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>Shots {team.shots}</span>
        <span>Hits {team.hits}</span>
        <span>Blocks {team.blocks}</span>
        <span>PIM {team.penaltyMinutes}</span>
        <span>Faceoffs won {team.faceoffWins}</span>
        {team.powerPlayGoals > 0 && <span>PPG {team.powerPlayGoals}</span>}
        {team.byPeriod.length > 0 && <span>By period {team.byPeriod.join('–')}</span>}
      </div>
    </>
  )
}

function TeamScore(props: {
  abbr: string
  name: string
  score: number
  shots: number
  color: number
  mine: boolean
}): JSX.Element {
  const hex = `#${props.color.toString(16).padStart(6, '0')}`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1, justifyContent: props.mine ? 'flex-start' : 'flex-start' }}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: hex, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: props.mine ? 800 : 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {props.abbr} <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{props.name}</span>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>{props.shots} shots</div>
      </div>
      <span style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>{props.score}</span>
    </div>
  )
}

// ── styles ───────────────────────────────────────────────────────────────────

const activeStyle: CSSProperties = {
  background: 'var(--violet)',
  color: '#04122b',
  borderColor: 'var(--violet)',
}

const scoreboardStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 22,
  background: 'var(--bg1)', borderRadius: 10, padding: '12px 20px',
  border: '1px solid var(--border, rgba(255,255,255,0.07))',
}

const panelStyle: CSSProperties = {
  background: 'var(--bg1)', borderRadius: 10,
  border: '1px solid var(--border, rgba(255,255,255,0.07))',
  display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
}

const panelHeaderStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border, rgba(255,255,255,0.07))',
  fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1,
  color: 'var(--violet-h, #b9a7ff)',
  flexShrink: 0,
}
