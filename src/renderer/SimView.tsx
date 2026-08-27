/**
 * SIM VIEW — match night as a live gamecast (playtest C1, rebuilt for F4).
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
 *
 * ── F4: "things jumping around too much" ──────────────────────────────────
 * A live surface has one job beyond being correct: hold still. Everything here
 * is laid out so arriving data CHANGES TEXT, never geometry:
 *
 *   · the scoreboard is a fixed three-column grid with a fixed-width centre,
 *     and every readout is tabular-nums inside a reserved box;
 *   · the line score prints all its period cells from the opening faceoff and
 *     fills them in — it never grows a column mid-game;
 *   · the box score is built ONCE from a full fold of the stream, so every
 *     dressed skater has a row before the puck drops. No row is inserted, and
 *     the order (first shift out of the gate — i.e. line order) never re-sorts,
 *     which is what used to make players leap up the table when they scored;
 *   · the table is `table-layout: fixed` with a colgroup, so a two-digit TOI
 *     cannot widen a column and shove the whole row sideways;
 *   · the play-by-play gutters are reserved whether or not a line has a team,
 *     and the result banner is a strip that is ALWAYS present and only swaps
 *     its content — it no longer appears at the horn and shunts the panels up.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WatchedGame } from '../worker/protocol'
import { EventCursor } from '../render2d/eventCursor'
import { LiveBoxScoreBuilder, type LiveBoxScore, type LiveTeamBox } from '../render2d/liveBoxScore'
import { buildPlayByPlay, periodLabel, type PlayByPlayEntry } from '../render2d/playByPlay'
import { Icon } from './components/primitives'
import { Icons } from './components/icons'

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

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/**
 * The roster skeleton — every player who takes a shift, in the order he first
 * appears (which is line order), classified skater/goalie.
 *
 * This is the anti-thrash keystone: the box score renders THIS list from the
 * opening faceoff with zeroes in it, and the live fold only supplies numbers.
 * Nothing is ever inserted into the table and nothing ever re-sorts, so a
 * fourth-liner's first goal changes one cell instead of moving twenty rows.
 * One extra fold of the stream at mount buys that, and the same fold is what
 * "jump to the horn" does anyway.
 */
function rosterSkeleton(game: WatchedGame): { home: LiveTeamBox; away: LiveTeamBox } {
  const builder = new LiveBoxScoreBuilder({
    stream: game.stream,
    homePlayerIds: game.homePlayerIds,
    names: (id) => game.playerNames[id as string] ?? (id as string),
    abbrs: { home: game.homeAbbr, away: game.awayAbbr },
  })
  const cursor = new EventCursor(game.stream)
  for (const { ev, absT } of cursor.advance(Number.MAX_SAFE_INTEGER)) builder.apply(ev, absT)
  return builder.snapshot()
}

/** Ids in the order the stream first sends them over the boards — which is
 *  line order, and the order the box score lists them in for the whole game. */
function appearanceOrder(game: WatchedGame): Map<string, number> {
  const order = new Map<string, number>()
  let n = 0
  const see = (id: string): void => {
    if (!order.has(id)) order.set(id, n++)
  }
  for (const ev of game.stream) {
    if (ev.type === 'lineChange') {
      for (const id of ev.onIce) see(id as string)
    } else if (ev.type === 'frame') {
      see(ev.homeGoalie.player as string)
      see(ev.awayGoalie.player as string)
    }
  }
  return order
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

  /** Who dressed, and in what order the table lists them. Both fixed for the
   *  whole game — see rosterSkeleton's note. */
  const skeleton = useMemo(() => rosterSkeleton(game), [game])
  const order = useMemo(() => appearanceOrder(game), [game])

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
  const periodsPlayed = Math.max(3, box?.home.byPeriod.length ?? 0, box?.away.byPeriod.length ?? 0)

  return (
    <section className="sim">
      {/* ── scoreboard: a fixed three-column bar, nothing here resizes ───── */}
      <header className="sim-board">
        <TeamScore
          abbr={game.awayAbbr}
          name={game.awayName}
          score={awayScore}
          shots={box?.away.shots ?? 0}
          color={game.awayColors.primary}
          mine={userSide === 'away'}
          align="left"
        />
        <div className="sim-clock">
          <div className="sim-clock-time">{done ? 'FINAL' : clock}</div>
          <div className="sim-clock-period">{done ? 'FULL TIME' : periodLabel(period)}</div>
        </div>
        <TeamScore
          abbr={game.homeAbbr}
          name={game.homeName}
          score={homeScore}
          shots={box?.home.shots ?? 0}
          color={game.homeColors.primary}
          mine={userSide === 'home'}
          align="right"
        />
      </header>

      {/* ── controls ───────────────────────────────────────────────────── */}
      <div className="sim-controls">
        <button
          className="btn btn-primary sim-playbtn"
          onClick={() => setPlaying((p) => !p)}
          disabled={done}
          aria-label={playing ? 'Pause the game' : 'Resume the game'}
        >
          {done ? 'Ended' : playing ? 'Pause' : 'Play'}
        </button>

        <div className="sim-group">
          <span className="sim-group-label">Speed</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`btn sim-chip${speed === s ? ' on' : ''}`}
              onClick={() => setSpeed(s)}
              title={`${s}× — ${s === 1 ? 'watch every play land' : 'faster'}`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="sim-group">
          <span className="sim-group-label">Feed</span>
          {(['all', 'key'] as const).map((d) => (
            <button
              key={d}
              className={`btn sim-chip wide${density === d ? ' on' : ''}`}
              onClick={() => changeDensity(d)}
              title={d === 'all' ? 'Every play' : 'Goals, penalties and chances only'}
            >
              {d === 'all' ? 'Every play' : 'Key plays'}
            </button>
          ))}
        </div>

        <button className="btn sim-jump" onClick={jumpToEnd} disabled={done} aria-label="Jump to the final horn">
          Jump to the horn
        </button>

        <div className="sim-controls-right">
          {props.onWatchOnIce && (
            <button className="btn btn-ghost" onClick={props.onWatchOnIce} title="Watch this same game on the ice">
              Watch on the ice
            </button>
          )}
          <button className="btn sim-leave" onClick={props.onClose}>
            {done ? 'Back to the hub' : 'Leave game'}
          </button>
        </div>
      </div>

      {/* ── the game itself ─────────────────────────────────────────────── */}
      <div className="sim-main">
        <section className="sim-panel sim-pbp">
          <div className="sim-panel-head">
            <span>Play-by-play</span>
            <span className="sim-panel-meta">{shown.length} / {feed.length}</span>
          </div>
          <div className="sim-pbp-scroll">
            {shown.length === 0 ? (
              <div className="sim-pbp-empty">Warm-ups are over. Puck drop…</div>
            ) : (
              // Newest at the top: the line that just landed is always in view,
              // with no scroll chasing.
              newestFirst(shown).map((e, i) => <FeedLine key={`${e.absT}-${shown.length - i}`} entry={e} fresh={i === 0} />)
            )}
          </div>
        </section>

        <section className="sim-right">
          <LineScore
            game={game}
            box={box}
            periods={periodsPlayed}
            reached={done ? periodsPlayed : period}
            awayScore={awayScore}
            homeScore={homeScore}
          />
          <TeamCompare box={box} game={game} />
          <div className="sim-panel sim-boxpanel">
            <div className="sim-panel-head">
              <span>Box score</span>
              <span className="sim-sides">
                {(['away', 'home'] as const).map((s) => (
                  <button
                    key={s}
                    className={`btn sim-chip${boxSide === s ? ' on' : ''}`}
                    onClick={() => setBoxSide(s)}
                  >
                    {s === 'home' ? game.homeAbbr : game.awayAbbr}
                  </button>
                ))}
              </span>
            </div>
            <div className="sim-box-scroll">
              <BoxTable
                live={boxSide === 'home' ? box?.home : box?.away}
                skeleton={boxSide === 'home' ? skeleton.home : skeleton.away}
                order={order}
              />
            </div>
          </div>
        </section>
      </div>

      {/* ── status strip: ALWAYS present, only its content changes ──────── */}
      <footer className={`sim-status${done ? (userWon ? ' won' : ' lost') : ''}`}>
        <Icon size={16}><Icons.Result /></Icon>
        {done ? (
          <>
            <span className="sim-status-lead">{userWon ? 'Two points.' : 'That one got away.'}</span>
            <span className="sim-status-detail">
              {game.awayAbbr} {awayScore} — {game.homeAbbr} {homeScore} · shots {box?.away.shots ?? 0}–{box?.home.shots ?? 0}
            </span>
          </>
        ) : (
          <>
            <span className="sim-status-lead">
              {shown.length === 0 ? 'Puck drop' : `${periodLabel(period)} · ${clock}`}
            </span>
            <span className="sim-status-detail">
              {playing ? 'Playing' : 'Paused'} · space to {playing ? 'pause' : 'resume'}, enter for the horn
            </span>
          </>
        )}
      </footer>
    </section>
  )
}

// ── sub-components ───────────────────────────────────────────────────────────

function FeedLine({ entry, fresh }: { entry: PlayByPlayEntry; fresh: boolean }): JSX.Element {
  const isGoal = entry.kind === 'goal'
  const isPenalty = entry.kind === 'penalty'
  const isMarker = entry.kind === 'periodEnd' || entry.kind === 'gameEnd'
  const cls = [
    'sim-play',
    isGoal ? 'goal' : '',
    isPenalty ? 'pen' : '',
    isMarker ? 'marker' : '',
    entry.weight === 'ambient' ? 'ambient' : '',
    fresh ? 'anim-in' : '',
  ].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      {/* Both gutters are reserved on EVERY line — a neutral play with no team
          used to pull the text 34px left and the whole column shimmered. */}
      <span className="sim-play-clock">{periodLabel(entry.period)} {entry.clock}</span>
      <span className="sim-play-team">{entry.teamAbbr || ''}</span>
      <span className="sim-play-text">{entry.text}</span>
    </div>
  )
}

/** The period-by-period line score. Every cell exists from the opening
 *  faceoff; only its digits change. */
function LineScore(props: {
  game: WatchedGame
  box: LiveBoxScore | null
  periods: number
  /** How many periods the game has actually reached — periods played but
   *  scoreless are a real 0, not an unknown. The builder only extends
   *  byPeriod when a goal goes in, so without this a shut-out period reads
   *  as "not played yet". */
  reached: number
  awayScore: number
  homeScore: number
}): JSX.Element {
  const cols = Array.from({ length: props.periods }, (_, i) => i)
  const cell = (side: 'home' | 'away', i: number): string => {
    const arr = props.box?.[side].byPeriod ?? []
    if (i < arr.length) return String(arr[i])
    return i < props.reached ? '0' : '–'
  }
  return (
    <div className="sim-panel sim-linescore">
      <table>
        <colgroup>
          <col style={{ width: 54 }} />
          {cols.map((i) => <col key={i} style={{ width: 40 }} />)}
          <col style={{ width: 44 }} />
          {/* A trailing spacer absorbs the panel's width, so the line score
              reads as a compact block instead of stretching six cells across
              a wide column. */}
          <col />
        </colgroup>
        <thead>
          <tr>
            <th className="lead" />
            {cols.map((i) => <th key={i}>{i < 3 ? i + 1 : periodLabel(i + 1)}</th>)}
            <th className="total">T</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(['away', 'home'] as const).map((side) => (
            <tr key={side}>
              <td className="lead">{side === 'home' ? props.game.homeAbbr : props.game.awayAbbr}</td>
              {cols.map((i) => <td key={i}>{cell(side, i)}</td>)}
              <td className="total">{side === 'home' ? props.homeScore : props.awayScore}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const COMPARE_ROWS: Array<{ label: string; of: (t: LiveTeamBox) => number }> = [
  { label: 'Shots', of: (t) => t.shots },
  { label: 'Hits', of: (t) => t.hits },
  { label: 'Blocks', of: (t) => t.blocks },
  { label: 'Faceoffs won', of: (t) => t.faceoffWins },
  { label: 'PIM', of: (t) => t.penaltyMinutes },
  { label: 'PP goals', of: (t) => t.powerPlayGoals },
]

/** Broadcast team-stat comparison. Fixed rows, fixed bar geometry — the bars
 *  move, the layout does not. */
function TeamCompare(props: { box: LiveBoxScore | null; game: WatchedGame }): JSX.Element {
  const away = props.box?.away
  const home = props.box?.home
  return (
    <div className="sim-panel sim-compare">
      <div className="sim-panel-head">
        <span>Team stats</span>
        <span className="sim-panel-meta">{props.game.awayAbbr} · {props.game.homeAbbr}</span>
      </div>
      <div className="sim-compare-rows">
        {COMPARE_ROWS.map((r) => {
          const a = away ? r.of(away) : 0
          const h = home ? r.of(home) : 0
          const total = a + h
          // Nothing has happened yet: an even split of two team colours reads
          // as "dead heat", which is a claim. An empty rail claims nothing.
          const pct = (a / (total || 1)) * 100
          return (
            <div className="sim-compare-row" key={r.label}>
              <span className={`sim-compare-n away${total === 0 ? ' zero' : ''}`}>{a}</span>
              <span className="sim-compare-mid">
                <span className="sim-compare-label">{r.label}</span>
                <span className="sim-compare-bar">
                  {total > 0 && (
                    <>
                      <span
                        className="sim-compare-fill"
                        style={{ width: `${pct}%`, background: hex(props.game.awayColors.primary) }}
                      />
                      <span
                        className="sim-compare-fill right"
                        style={{ width: `${100 - pct}%`, background: hex(props.game.homeColors.primary) }}
                      />
                    </>
                  )}
                </span>
              </span>
              <span className={`sim-compare-n home${total === 0 ? ' zero' : ''}`}>{h}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The box score. `skeleton` supplies WHO is in the table (fixed for the whole
 * game); `live` supplies the numbers. A player with no line yet renders zeroes
 * rather than being absent, so the table never grows a row mid-shift.
 */
function BoxTable(props: {
  live: LiveTeamBox | undefined
  skeleton: LiveTeamBox
  order: Map<string, number>
}): JSX.Element {
  const { skeleton, order } = props
  const bySkater = new Map((props.live?.skaters ?? []).map((s) => [s.playerId, s]))
  const byGoalie = new Map((props.live?.goalies ?? []).map((g) => [g.playerId, g]))
  const rank = (id: string): number => order.get(id) ?? 9999
  const skaters = [...skeleton.skaters].sort((a, b) => rank(a.playerId) - rank(b.playerId))
  const goalies = [...skeleton.goalies].sort((a, b) => rank(a.playerId) - rank(b.playerId))

  return (
    <>
      <table className="sim-table skaters">
        <colgroup>
          <col style={{ width: 'auto' }} />
          {['G', 'A', 'P', '+/−', 'S', 'H', 'B', 'PIM'].map((k) => <col key={k} style={{ width: 34 }} />)}
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="lead">Skater</th>
            <th>G</th><th>A</th><th>P</th><th>+/−</th><th>S</th><th>H</th><th>B</th><th>PIM</th>
            <th>TOI</th>
          </tr>
        </thead>
        <tbody>
          {skaters.map((row) => {
            const s = bySkater.get(row.playerId)
            const pm = s?.plusMinus ?? 0
            return (
              <tr key={row.playerId}>
                <td className="lead">{row.name}</td>
                <td className={s && s.goals > 0 ? 'hit' : ''}>{s?.goals ?? 0}</td>
                <td>{s?.assists ?? 0}</td>
                <td className={s && s.points > 0 ? 'pt' : ''}>{s?.points ?? 0}</td>
                <td className={pm > 0 ? 'good' : pm < 0 ? 'bad' : 'zero'}>{pm > 0 ? `+${pm}` : pm}</td>
                <td>{s?.shots ?? 0}</td>
                <td>{s?.hits ?? 0}</td>
                <td>{s?.blocks ?? 0}</td>
                <td>{s?.penaltyMinutes ?? 0}</td>
                <td className="zero">{mmss(s?.toi ?? 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <table className="sim-table goalies">
        <colgroup>
          <col style={{ width: 'auto' }} />
          {['SA', 'SV', 'GA'].map((k) => <col key={k} style={{ width: 34 }} />)}
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="lead">Goaltender</th>
            <th>SA</th><th>SV</th><th>GA</th><th>SV%</th>
          </tr>
        </thead>
        <tbody>
          {goalies.map((row) => {
            const g = byGoalie.get(row.playerId)
            return (
              <tr key={row.playerId}>
                <td className="lead">{row.name}</td>
                <td>{g?.shotsAgainst ?? 0}</td>
                <td>{g?.saves ?? 0}</td>
                <td>{g?.goalsAgainst ?? 0}</td>
                <td>{g && g.shotsAgainst > 0 ? g.savePct.toFixed(3).replace(/^0/, '') : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
  align: 'left' | 'right'
}): JSX.Element {
  return (
    <div className={`sim-team ${props.align}${props.mine ? ' mine' : ''}`}>
      <span className="sim-team-bar" style={{ background: hex(props.color) }} />
      <div className="sim-team-id">
        <div className="sim-team-abbr">{props.abbr}</div>
        <div className="sim-team-name">{props.name}</div>
        <div className="sim-team-shots">{props.shots} shots</div>
      </div>
      <span className="sim-team-score">{props.score}</span>
    </div>
  )
}
