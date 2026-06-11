import type { NewsCategory } from '@domain'
import type {
  BoxScoreView,
  DashboardView,
  InboxView,
  ScheduleEntryView,
  ScheduleView,
  StandingRowView,
  TentpoleView,
} from '../../worker/protocol'
import { useShellActions } from '../components/ActionsContext'
import { PlayerLink, useNav } from '../components/NavContext'
import { crestColor, fmtDate, fmtMoney } from '../components/format'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/* ── category metadata ── */
const CAT_ICON: Record<NewsCategory, string> = {
  result: '⚡', injury: '🩹', trade: '🔄', contract: '📋',
  draft: '🎯', award: '🏅', league: '🏒', milestone: '⭐', playoffs: '🏆',
}
const CAT_COLOR: Record<NewsCategory, string> = {
  result: 'var(--violet-h)', injury: 'var(--red)', trade: 'var(--amber)',
  contract: 'var(--amber)', draft: 'var(--cyan)', award: 'var(--amber)',
  league: 'var(--muted)', milestone: 'var(--amber)', playoffs: 'var(--amber)',
}

/* ── helpers ── */
function resultClass(won: boolean, decidedBy: string): string {
  if (won) return 'w'
  if (decidedBy === 'overtime' || decidedBy === 'shootout') return 'o'
  return 'l'
}

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/** Build a month calendar array (6 weeks x 7 days) for a given ISO month '2026-10'. */
function buildCalendar(monthKey: string): Array<{ date: string | null; day: number }> {
  const [yearStr, monStr] = monthKey.split('-')
  const year = Number(yearStr)
  const mon = Number(monStr)
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const cells: Array<{ date: string | null; day: number }> = []
  // leading blanks
  for (let i = 0; i < firstDow; i++) cells.push({ date: null, day: -1 })
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: `${yearStr}-${monStr.padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      day: d,
    })
  }
  return cells
}

/** '2026-10-12' → '2026-10' */
function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

/* ═══════════════════════════════════════════════════════════════
   Main screen
   ═══════════════════════════════════════════════════════════════ */

/** Club home screen: FM24-style 3-col card grid. */
export function DashboardScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const actions = useShellActions()

  const { data, loading, error } = useScreenData<DashboardView>(
    () => client.getDashboard(),
    (r) => (r.type === 'dashboard' ? r.dashboard : null)
  )

  const { data: inbox } = useScreenData<InboxView>(
    () => client.getInbox(),
    (r) => (r.type === 'inbox' ? r.inbox : null)
  )

  const { data: schedule } = useScreenData<ScheduleView>(
    () => client.getSchedule(),
    (r) => (r.type === 'schedule' ? r.schedule : null)
  )

  const { data: boxScore } = useScreenData<BoxScoreView | null>(
    () => client.getLastBoxScore(),
    (r) => (r.type === 'boxScore' ? r.boxScore : null)
  )

  const { data: tentpoles } = useScreenData<TentpoleView>(
    () => client.getTentpoles(),
    (r) => (r.type === 'tentpoles' ? r.tentpoles : null)
  )

  if (error) {
    return (
      <section>
        <ScreenHeader title="Dashboard" />
        <Notice kind="warn">{error}</Notice>
      </section>
    )
  }
  if (!data) {
    return (
      <section>
        <ScreenHeader title="Dashboard" />
        <Notice kind="info">{loading ? 'Loading…' : 'No dashboard data yet.'}</Notice>
      </section>
    )
  }

  const d = data
  const s = d.userTeam.standing

  return (
    <section className="stack">
      {/* title row */}
      <ScreenHeader title={d.userTeam.name}>
        <span className="muted small">
          {d.leagueName} · {d.year} · Day {d.day}/{d.totalDays}
        </span>
      </ScreenHeader>

      {d.championTeamName !== null && (
        <div className="dash-banner">
          🏆 {d.championTeamName} are the {d.year} champions
        </div>
      )}

      {/* ── 3-col card grid ── */}
      <div className="dash-grid">

        {/* ═══ LEFT COLUMN ═══ */}
        <div className="stack">

          {/* Messages card */}
          <Panel
            title={`Inbox${d.unreadNews > 0 ? ` · ${d.unreadNews} unread` : ''}`}
            className="stack"
          >
            {!inbox || inbox.items.length === 0 ? (
              <span className="muted small">No messages.</span>
            ) : (
              <div>
                {[...inbox.items]
                  .sort((a, b) => {
                    if (a.read !== b.read) return a.read ? 1 : -1
                    return b.day - a.day
                  })
                  .slice(0, 8)
                  .map((item) => (
                    <div
                      key={item.id}
                      className={`inbox-preview-row${item.read ? '' : ' unread'}`}
                      onClick={() => nav.navigate('inbox')}
                    >
                      <span
                        className="inbox-preview-icon"
                        style={{ color: CAT_COLOR[item.category] }}
                      >
                        {CAT_ICON[item.category]}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div className="inbox-preview-headline">{item.headline}</div>
                      </span>
                      <span className="inbox-preview-day">Day {item.day}</span>
                    </div>
                  ))}
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', marginTop: 6 }}
                  onClick={() => nav.navigate('inbox')}
                >
                  View all messages
                </button>
              </div>
            )}
          </Panel>

          {/* Salary cap */}
          <Panel title="Salary cap">
            <CapMeter capUsed={d.capUsed} salaryCap={d.salaryCap} />
          </Panel>

          {/* Injuries */}
          <Panel title="Injuries">
            {d.injuries.length === 0 ? (
              <span className="muted small">Fully healthy.</span>
            ) : (
              <div className="list">
                {d.injuries.map((p) => (
                  <div key={p.playerId} className="row-between small">
                    <span className="row">
                      <span className="muted">{p.position}</span>
                      <PlayerLink playerId={p.playerId} name={p.name} />
                    </span>
                    <span className="chip chip-danger">
                      {p.injury.description} · {p.injury.gamesRemaining}g
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

        </div>

        {/* ═══ CENTER COLUMN ═══ */}
        <div className="stack">

          {/* Season hero stats */}
          <Panel title="Season">
            <div className="row" style={{ gap: 'var(--sp-5)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div className="stat">
                <div className="stat-value">
                  {s.wins}–{s.losses}–{s.overtimeLosses}
                </div>
                <div className="stat-label">{s.points} pts · #{d.userTeam.rank} overall</div>
              </div>
              <div className="stat">
                <div className="stat-value">#{d.userTeam.conferenceRank}</div>
                <div className="stat-label">Conference</div>
              </div>
              <div>
                <div className="chip chip-violet" style={{ marginBottom: 6 }}>
                  Streak {s.streak}
                </div>
                <LastFive value={s.lastFive} />
              </div>
            </div>
            <div className="muted small" style={{ marginTop: 'var(--sp-3)' }}>
              {s.goalsFor} GF · {s.goalsAgainst} GA
            </div>
            {/* Media expectation chip */}
            {d.predictedRank !== undefined && (
              <ExpectationChip predictedRank={d.predictedRank} currentRank={d.userTeam.rank} />
            )}
          </Panel>

          {/* Storylines ticker strip */}
          {d.topArcs && d.topArcs.length > 0 && (
            <StorylinesStrip arcs={d.topArcs} />
          )}

          {/* News / last result hero */}
          {d.lastResult ? (
            <LastResultHero
              result={d.lastResult}
              boxScore={boxScore ?? null}
              onBoxScore={() => nav.navigate('matchcenter')}
            />
          ) : (
            <Panel title="Match result">
              <span className="muted small">No games played yet.</span>
            </Panel>
          )}

          {/* Next game */}
          <Panel title="Next game">
            {d.nextGame ? (
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                <div className="scoreline" style={{ fontSize: 18 }}>
                  {d.nextGame.home ? 'vs' : '@'} {d.nextGame.opponentName}
                </div>
                <div className="muted small">
                  {fmtDate(d.nextGame.date)} · #{d.nextGame.opponentRank} in league ·{' '}
                  {d.nextGame.home ? 'Home' : 'Away'}
                </div>
                <div className="row">
                  <button
                    className="btn btn-primary"
                    onClick={actions.watchNext}
                    disabled={actions.busy}
                  >
                    Watch
                  </button>
                </div>
              </div>
            ) : (
              <span className="muted small">No fixture scheduled.</span>
            )}
          </Panel>

          {/* Calendar */}
          {schedule && d.date && (
            <CalendarCard
              entries={schedule.entries}
              todayDate={d.date}
              nextGameDate={d.nextGame?.date ?? null}
            />
          )}

        </div>

        {/* ═══ RIGHT COLUMN ═══ */}
        <div className="stack">

          {/* Fixtures card */}
          <Panel title="Fixtures">
            <FixturesCard entries={schedule?.entries ?? []} todayDate={d.date} />
          </Panel>

          {/* Division standings */}
          <Panel title={`${d.divisionName} Division`}>
            <MiniTable rows={d.divisionStandings} userTeamId={d.userTeam.teamId} />
          </Panel>

          {/* Top scorers */}
          <Panel title="Top scorers">
            {d.topScorers.length === 0 ? (
              <span className="muted small">No points scored yet.</span>
            ) : (
              <div className="list">
                {d.topScorers.map((p) => (
                  <div key={p.playerId} className="row-between small">
                    <span className="row">
                      <span className="muted">{p.position}</span>
                      <PlayerLink playerId={p.playerId} name={p.name} />
                    </span>
                    <span className="mono">
                      {p.goals}G {p.assists}A ·{' '}
                      <strong style={{ color: 'var(--violet-h)' }}>{p.points} pts</strong>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────
   Sub-components
   ───────────────────────────────────────────── */

function LastFive(props: { value: string }): JSX.Element {
  const letters = props.value.split('').filter((c) => c === 'W' || c === 'L' || c === 'O')
  if (letters.length === 0) return <span className="muted small">—</span>
  return (
    <span className="last-five">
      {letters.map((c, i) => (
        <span key={i} className={c.toLowerCase()}>
          {c}
        </span>
      ))}
    </span>
  )
}

/** FM24-style news hero card showing the last result with a Player-of-the-Match block. */
function LastResultHero(props: {
  result: NonNullable<DashboardView['lastResult']>
  boxScore: BoxScoreView | null
  onBoxScore: () => void
}): JSX.Element {
  const { result, boxScore } = props
  if (!result) return <></>

  const scoreLine = `${result.awayAbbr} ${result.awayGoals} – ${result.homeGoals} ${result.homeAbbr}`
  const ot = result.decidedBy !== 'regulation'

  // Derive Player of the Match from box score if available
  let potm: { name: string; stat: string; pos: string } | null = null
  if (boxScore) {
    const allSkaters = [...boxScore.homeSkaters, ...boxScore.awaySkaters]
    const top = allSkaters
      .map((sk) => ({ ...sk, pts: sk.goals + sk.assists }))
      .sort((a, b) => b.pts - a.pts || b.goals - a.goals || b.shots - a.shots)[0]
    if (top && (top.goals + top.assists) > 0) {
      potm = {
        name: top.name,
        stat: `${top.goals}G ${top.assists}A`,
        pos: top.position,
      }
    } else {
      // Fall back to top goalie by saves
      const allGoalies = [...boxScore.homeGoalies, ...boxScore.awayGoalies]
      const topG = [...allGoalies].sort((a, b) => b.saves - a.saves)[0]
      if (topG) {
        potm = {
          name: topG.name,
          stat: `${topG.saves} saves`,
          pos: 'G',
        }
      }
    }
  }

  return (
    <div className="news-hero">
      <div className="news-hero-sub">Last result · {fmtDate(result.date)}</div>
      <div className="news-hero-headline">
        {scoreLine}
        {ot && (
          <span
            className="chip chip-warn"
            style={{ marginLeft: 8, fontSize: 12, verticalAlign: 'middle' }}
          >
            {result.decidedBy === 'overtime' ? 'OT' : 'SO'}
          </span>
        )}
      </div>
      {potm && (
        <div className="potm-block">
          <span style={{ fontSize: 20 }}>⭐</span>
          <div>
            <div className="potm-label">Player of the match</div>
            <div className="potm-name">{potm.name}</div>
            <div className="potm-stat">
              {potm.pos} · {potm.stat}
            </div>
          </div>
        </div>
      )}
      <button className="btn btn-ghost btn-sm" onClick={props.onBoxScore}>
        Box score →
      </button>
    </div>
  )
}

/** Last 3 results + next 3 upcoming, styled with W/L/OTL chips. */
function FixturesCard(props: {
  entries: ScheduleEntryView[]
  todayDate: string
}): JSX.Element {
  const { entries } = props
  if (entries.length === 0) {
    return <span className="muted small">No fixtures.</span>
  }

  const played = entries.filter((e) => e.result !== null)
  const upcoming = entries.filter((e) => e.result === null)
  const lastPlayed = played.slice(-3)
  const nextThree = upcoming.slice(0, 3)

  return (
    <div>
      {lastPlayed.length > 0 && (
        <>
          <div className="muted small" style={{ marginBottom: 4 }}>Results</div>
          {lastPlayed.map((e) => {
            const r = e.result!
            const cls = resultClass(r.won, r.decidedBy)
            // homeGoals/awayGoals from GameResult
            const userGoals = e.home ? r.homeGoals : r.awayGoals
            const oppGoals  = e.home ? r.awayGoals : r.homeGoals
            return (
              <div key={e.gameId} className="fixture-row">
                <span className={`fixture-result ${cls}`}>
                  {cls === 'w' ? 'W' : cls === 'o' ? 'OT' : 'L'}
                </span>
                <span style={{ flex: 1, fontSize: 13 }}>
                  {e.home ? 'vs' : '@'} {e.opponentAbbr}
                </span>
                <span className="mono small" style={{ color: cls === 'w' ? 'var(--green)' : cls === 'o' ? 'var(--amber)' : 'var(--red)' }}>
                  {userGoals}–{oppGoals}
                </span>
              </div>
            )
          })}
        </>
      )}
      {nextThree.length > 0 && (
        <>
          <div className="muted small" style={{ marginTop: 8, marginBottom: 4 }}>Upcoming</div>
          {nextThree.map((e) => (
            <div key={e.gameId} className="fixture-row">
              <span className="fixture-result upcoming">
                {e.home ? 'H' : 'A'}
              </span>
              <span style={{ flex: 1, fontSize: 13 }}>
                {e.home ? 'vs' : '@'} {e.opponentName}
              </span>
              <span className="muted small">{fmtDate(e.date)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/** Month calendar grid with game-day markers. */
function CalendarCard(props: {
  entries: ScheduleEntryView[]
  todayDate: string
  nextGameDate: string | null
}): JSX.Element {
  const { entries, todayDate, nextGameDate } = props
  const monthKey = monthOf(todayDate)
  const cells = buildCalendar(monthKey)

  const gameSet = new Map<string, { home: boolean; played: boolean }>()
  for (const e of entries) {
    if (monthOf(e.date) === monthKey) {
      gameSet.set(e.date, { home: e.home, played: e.result !== null })
    }
  }

  return (
    <Panel title={new Date(todayDate + 'T00:00:00').toLocaleDateString('en', { month: 'long', year: 'numeric' })}>
      <div className="cal-grid">
        {DOW.map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {cells.map((cell, idx) => {
          if (!cell.date) {
            return <div key={`blank-${idx}`} className="cal-day" />
          }
          const game = gameSet.get(cell.date)
          const isToday = cell.date === todayDate
          const isNext = cell.date === nextGameDate
          let cls = 'cal-day'
          if (isNext) cls += ' next-game'
          else if (isToday) cls += ' today'
          else if (game) cls += ' has-game'

          return (
            <div key={cell.date} className={cls}>
              {cell.day}
              {game && (
                <div
                  className="cal-day-dot"
                  style={{
                    background: game.played
                      ? 'var(--muted)'
                      : game.home
                      ? 'var(--violet)'
                      : 'var(--cyan)',
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/** Compact division standings table with rank chips + user row highlight. */
function MiniTable(props: { rows: StandingRowView[]; userTeamId: string }): JSX.Element {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th className="num">GP</th>
            <th className="num">W</th>
            <th className="num">L</th>
            <th className="num">OTL</th>
            <th className="num">PTS</th>
            <th>L5</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => {
            const isUser = row.teamId === props.userTeamId
            const rankCls =
              i < 3 ? 'rank-chip top3' : i < 8 ? 'rank-chip top8' : 'rank-chip'
            return (
              <tr
                key={row.teamId}
                className={isUser ? 'is-user' : undefined}
              >
                <td>
                  <span className={rankCls}>{i + 1}</span>
                </td>
                <td>
                  <span className="row" style={{ gap: 5 }}>
                    <span
                      className="crest"
                      style={{
                        background: crestColor(row.teamId),
                        width: 18,
                        height: 18,
                        fontSize: 8,
                        border: 'none',
                        flexShrink: 0,
                      }}
                    >
                      {row.abbreviation.slice(0, 2)}
                    </span>
                    {row.abbreviation}
                  </span>
                </td>
                <td className="num">{row.gamesPlayed}</td>
                <td className="num">{row.wins}</td>
                <td className="num">{row.losses}</td>
                <td className="num">{row.overtimeLosses}</td>
                <td className="num">
                  <strong style={{ color: isUser ? 'var(--violet-h)' : undefined }}>
                    {row.points}
                  </strong>
                </td>
                <td>
                  <MiniLastFive value={row.lastFive} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MiniLastFive(props: { value: string }): JSX.Element {
  const letters = props.value.split('').filter((c) => c === 'W' || c === 'L' || c === 'O')
  if (letters.length === 0) return <span className="muted">—</span>
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {letters.map((c, i) => {
        const bg =
          c === 'W'
            ? 'var(--green)'
            : c === 'L'
            ? 'var(--red)'
            : 'var(--amber)'
        return (
          <span
            key={i}
            title={c === 'W' ? 'Win' : c === 'L' ? 'Loss' : 'OT Loss'}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: bg,
              display: 'inline-block',
              opacity: 0.85,
            }}
          />
        )
      })}
    </span>
  )
}

/** Media expectation chip: "Picked 11th — currently 4th" green/red by delta. */
function ExpectationChip(props: { predictedRank: number; currentRank: number }): JSX.Element {
  const { predictedRank, currentRank } = props
  const delta = predictedRank - currentRank // positive = outperforming
  const chipClass =
    delta > 0 ? 'chip chip-success' : delta < 0 ? 'chip chip-danger' : 'chip chip-violet'
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '●'
  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      <span className={chipClass}>
        {arrow} Picked {predictedRank}{getOrdinalSuffix(predictedRank)} — currently {currentRank}{getOrdinalSuffix(currentRank)}
      </span>
    </div>
  )
}

function getOrdinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

/** Thin storylines ticker strip listing topArcs headlines as chips. */
function StorylinesStrip(props: { arcs: Array<{ kind: string; headline: string }> }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--sp-2)',
        padding: '8px 12px',
        background: 'var(--bg1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          color: 'var(--muted)',
          alignSelf: 'center',
          whiteSpace: 'nowrap',
          marginRight: 4,
        }}
      >
        Storylines
      </span>
      {props.arcs.map((arc, i) => (
        <span key={i} className="chip chip-violet" style={{ fontSize: 11 }}>
          {arc.headline}
        </span>
      ))}
    </div>
  )
}

function CapMeter(props: { capUsed: number; salaryCap: number }): JSX.Element {
  const pct = props.salaryCap > 0 ? (props.capUsed / props.salaryCap) * 100 : 0
  const fillClass = pct > 100 ? 'meter-fill over' : pct > 92 ? 'meter-fill warn' : 'meter-fill'
  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <div className="row-between small">
        <span>
          <strong>{fmtMoney(props.capUsed)}</strong>{' '}
          <span className="muted">used</span>
        </span>
        <span className="muted">cap {fmtMoney(props.salaryCap)}</span>
      </div>
      <div className="meter">
        <div className={fillClass} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <div className="muted small">
        {fmtMoney(props.salaryCap - props.capUsed)} remaining
      </div>
    </div>
  )
}
