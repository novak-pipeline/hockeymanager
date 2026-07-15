import { useState } from 'react'
import type { NewsCategory } from '@domain'
import type {
  BoardSummaryView,
  CalendarEntry,
  CalendarView,
  BoxScoreView,
  DashboardView,
  InboxView,
  StandingRowView,
  TentpoleView,
} from '../../worker/protocol'
import { useShellActions } from '../components/ActionsContext'
import { PlayerLink, TeamLink, useNav } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { fmtDate, fmtMoney } from '../components/format'
import { dayToDateISO } from '../../engine/career/views'
import { TeamCrest } from '../components/Crest'
import { OverallStars } from '../components/Stars'
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

/* ═══════════════════════════════════════════════════════════════
   Main screen
   ═══════════════════════════════════════════════════════════════ */

/** Club home screen: FM24-style 3-col card grid. */
/** Optional dashboard panels the user can hide (core panels stay always-on). */
const OPTIONAL_PANELS: Array<{ key: string; label: string }> = [
  { key: 'injuries', label: 'Injuries' },
  { key: 'storylines', label: 'Storylines' },
  { key: 'topScorers', label: 'Top scorers' },
]
const HIDDEN_PANELS_KEY = 'hg.dash.hiddenPanels'

function loadHiddenPanels(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_PANELS_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}
function saveHiddenPanels(s: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_PANELS_KEY, JSON.stringify([...s]))
  } catch {
    /* ignore */
  }
}

/** A small "⚙ Customize" popover listing the optional panels with show/hide checkboxes. */
function CustomizeMenu(props: { hidden: Set<string>; onToggle: (key: string) => void }): JSX.Element {
  return (
    <details className="dash-customize" style={{ position: 'relative' }}>
      <summary className="btn btn-ghost btn-sm" style={{ listStyle: 'none', cursor: 'pointer' }}>⚙ Customize</summary>
      <div
        style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 30,
          background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
          padding: '8px 10px', minWidth: 180, boxShadow: 'var(--violet-glow)',
        }}
      >
        <div className="muted small" style={{ marginBottom: 6 }}>Show panels</div>
        {OPTIONAL_PANELS.map((p) => (
          <label key={p.key} className="row" style={{ gap: 8, padding: '3px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={!props.hidden.has(p.key)} onChange={() => props.onToggle(p.key)} />
            <span className="small">{p.label}</span>
          </label>
        ))}
      </div>
    </details>
  )
}

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

  const { data: squad } = useScreenData(
    () => client.getSquad(),
    (r) => (r.type === 'squad' ? r.squad : null)
  )

  const { data: calendar } = useScreenData(
    () => client.getCalendar(),
    (r) => (r.type === 'calendar' ? r.calendar : null)
  )

  const { data: boxScore } = useScreenData<BoxScoreView | null>(
    () => client.getLastBoxScore(),
    (r) => (r.type === 'boxScore' ? r.boxScore : null)
  )

  const { data: tentpoles } = useScreenData<TentpoleView>(
    () => client.getTentpoles(),
    (r) => (r.type === 'tentpoles' ? r.tentpoles : null)
  )

  const [hiddenPanels, setHiddenPanels] = useState<Set<string>>(() => loadHiddenPanels())
  const togglePanel = (key: string): void => {
    setHiddenPanels((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveHiddenPanels(next)
      return next
    })
  }

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
  const shown = (key: string): boolean => !hiddenPanels.has(key)

  return (
    <section className="dash-viewport">
      {/* hero identity band */}
      <DashHero d={d} customize={<CustomizeMenu hidden={hiddenPanels} onToggle={togglePanel} />} />

      {d.championTeamName !== null && (
        <div className="dash-banner">
          🏆 {d.championTeamName} are the {d.year} champions
        </div>
      )}

      {d.gmFired && (
        <button
          className="dash-banner"
          style={{ cursor: 'pointer', border: 'none', textAlign: 'left', width: '100%', background: 'var(--danger, #5a1d1d)' }}
          onClick={() => nav.navigate('gmCareer')}
        >
          🧳 You've been let go. Review the GM job market to catch on with a new club.
        </button>
      )}

      {d.deadlinePending && (
        <button
          className="dash-banner"
          style={{ cursor: 'pointer', border: 'none', textAlign: 'left', width: '100%', background: 'var(--danger, #5a1d1d)' }}
          onClick={() => nav.navigate('trades')}
        >
          ⏰ DEADLINE DAY — the trade window closes when you continue. Last chance to work the phones.
        </button>
      )}

      {d.campPending && (
        <button
          className="dash-banner"
          style={{ cursor: 'pointer', border: 'none', textAlign: 'left', width: '100%', background: 'var(--danger, #5a1d1d)' }}
          onClick={() => nav.navigate('trainingCamp')}
        >
          {'\u2702\ufe0f'} CUT DAY {'\u2014'} camp verdicts are in. Pick your 23 before the opener, or the coach picks for you.
        </button>
      )}

      {d.devCampPending && (
        <button
          className="dash-banner"
          style={{ cursor: 'pointer', border: 'none', textAlign: 'left', width: '100%' }}
          onClick={() => nav.navigate('devCamp')}
        >
          {'\ud83c\udfd2'} Development camp is on the ice this week {'\u2014'} the org kids, your staff first live reads.
        </button>
      )}

      {d.boardMeetingPending && (
        <button
          className="dash-banner"
          style={{ cursor: 'pointer', border: 'none', textAlign: 'left', width: '100%' }}
          onClick={() => nav.navigate('boardMeeting')}
        >
          🏛 The preseason board meeting is waiting upstairs — the owner wants the season's plan before the opener.
        </button>
      )}

      {d.ownerRequestPending && (
        <button
          className="dash-banner"
          style={{ cursor: 'pointer', border: 'none', textAlign: 'left', width: '100%' }}
          onClick={() => nav.navigate('board')}
        >
          📞 The owner wants a word — respond on the Club Vision page.
        </button>
      )}

      {(d.waiverClaimsAvailable ?? 0) > 0 && (
        <button
          className="dash-banner"
          style={{ cursor: 'pointer', border: 'none', textAlign: 'left', width: '100%' }}
          onClick={() => nav.navigate('waivers')}
        >
          📋 {d.waiverClaimsAvailable} player{d.waiverClaimsAvailable === 1 ? '' : 's'} on the waiver wire — click to review claims
        </button>
      )}


      {/* ── 3-col card grid ── */}
      <div className="dash-grid">

        {/* ═══ LEFT COLUMN ═══ */}
        <div className="dash-col">

          {/* Injuries — only earns a panel when someone is actually hurt
              (health status lives in the status strip otherwise) */}
          {shown('injuries') && d.injuries.length > 0 && (
          <Panel title="Injuries">
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
          </Panel>
          )}

          {/* Messages pane — the column's grower: fills to the bottom, scrolls */}
          <MessagesPane
            inbox={inbox ?? null}
            unread={d.unreadNews}
            onOpen={() => nav.navigate('inbox')}
            onOpenItem={(id) => nav.navigate('inbox', { newsId: id })}
          />

        </div>

        {/* ═══ CENTER COLUMN ═══ */}
        <div className="dash-col">

          {/* News hero — the day's story with the live storyline chips inside */}
          <NewsHero
            inbox={inbox ?? null}
            arcs={shown('storylines') ? (d.topArcs ?? []) : []}
            onOpen={() => nav.navigate('inbox')}
          />

          {/* Last result — right under the headline, always above the fold */}
          {d.phase !== 'offseason' && d.lastResult && (
            <LastResultHero
              result={d.lastResult}
              boxScore={boxScore ?? null}
              onBoxScore={() => nav.navigate('matchcenter')}
            />
          )}

          {/* The Week Ahead — the agenda, in every phase */}
          <WeekAhead
            d={d}
            calendar={calendar ?? null}
            onOpenCalendar={() => nav.navigate('calendar')}
            onOpenOffseason={() => nav.navigate('offseason')}
            onWatch={actions.watchNext}
            busy={actions.busy}
          />

          {/* Offseason: the working desk (market / expiring) — the center grower */}
          {d.phase === 'offseason' && <SummerDesk onOpen={() => nav.navigate('offseason')} />}

          {/* Next game — the center grower in season */}
          {d.phase !== 'offseason' && (
          <Panel title="Next game" className="dash-fill">
            {d.nextGame ? (
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                <div className="scoreline" style={{ fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="muted" style={{ fontSize: 14 }}>{d.nextGame.home ? 'vs' : '@'}</span>
                  <TeamCrest
                    className="crest"
                    teamId={d.nextGame.opponentTeamId}
                    abbr={d.nextGame.opponentAbbr.slice(0, 2)}
                    style={{ width: 24, height: 24, fontSize: 10, flexShrink: 0 }}
                  />
                  <TeamLink teamId={d.nextGame.opponentTeamId} name={d.nextGame.opponentName} />
                  {d.nextGame.rivalryLabel && (
                    <span
                      className="chip chip-danger"
                      style={{ marginLeft: 6, fontSize: 12, verticalAlign: 'middle' }}
                    >
                      {d.nextGame.rivalryLabel}
                    </span>
                  )}
                </div>
                <div className="muted small">
                  {fmtDate(d.nextGame.date)} · #{d.nextGame.opponentRank} in league ·{' '}
                  {d.nextGame.home ? 'Home' : 'Away'}
                </div>
                <div className="muted small">
                  Opponent: {d.nextGame.opponentRecord}
                  {d.nextGame.opponentSystem && d.nextGame.opponentSystem !== '—' && (
                    <> · plays <span style={{ color: 'var(--accent)' }}>{d.nextGame.opponentSystem}</span></>
                  )}
                </div>
                {d.nextGame.allTime && (
                  <div className="muted small" title="All-time series record from your club's history">
                    📜 {d.nextGame.allTime}
                  </div>
                )}
                {d.nextGame.storyline && (
                  <div className="small" style={{ color: 'var(--accent, #d6a056)' }} title="Tonight's storyline, from your club's history">
                    {d.nextGame.storyline}
                  </div>
                )}
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
          )}


        </div>

        {/* ═══ RIGHT COLUMN ═══ */}
        <div className="dash-col">

          {/* Top scorers — points once the season runs; your projected core in summer */}
          {shown('topScorers') && (
            <Panel title={d.topScorers.length > 0 ? 'Top scorers' : 'The core — season ahead'}>
              <div className="list">
                {d.topScorers.length > 0
                  ? d.topScorers.map((p) => (
                      <div key={p.playerId} className="row-between small">
                        <span className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', minWidth: 0 }}>
                          <PlayerFace faceId={p.faceId} name={p.name} size={24} />
                          <span className="muted" style={{ width: 22, flexShrink: 0 }}>{p.position}</span>
                          <PlayerLink playerId={p.playerId} name={p.name} />
                        </span>
                        <span className="mono" style={{ flexShrink: 0 }}>
                          {p.goals}G {p.assists}A ·{' '}
                          <strong style={{ color: 'var(--violet-h)' }}>{p.points} pts</strong>
                        </span>
                      </div>
                    ))
                  : (squad?.rows ?? [])
                      .filter((r) => r.position !== 'G')
                      .sort((a, b) => b.overall - a.overall)
                      .slice(0, 5)
                      .map((p) => (
                        <div key={p.playerId} className="row-between small">
                          <span className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', minWidth: 0 }}>
                            <PlayerFace faceId={p.faceId} name={p.name} size={24} />
                            <span className="muted" style={{ width: 22, flexShrink: 0 }}>{p.position}</span>
                            <PlayerLink playerId={p.playerId} name={p.name} />
                          </span>
                          <span className="mono" style={{ flexShrink: 0 }}>
                            <OverallStars value={p.overall} />
                          </span>
                        </div>
                      ))}
                {d.topScorers.length === 0 && (squad?.rows ?? []).length === 0 && (
                  <span className="muted small">Roster loading…</span>
                )}
              </div>
            </Panel>
          )}

          {/* Division standings mean nothing in July — the table only appears
              once there are results to rank; it grows to fill the column.
              Summer gets the market instead. */}
          {d.phase !== 'offseason' && (
            <Panel title={`${d.divisionName} Division`} className="dash-fill">
              <div className="dash-scroll">
                <MiniTable rows={d.divisionStandings} userTeamId={d.userTeam.teamId} />
              </div>
            </Panel>
          )}

          {/* Offseason: around the league — real signings/trades as they land */}
          {d.phase === 'offseason' && <MarketPulse stageLabel={d.offseasonStageLabel} />}

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
                    <TeamCrest
                      className="crest"
                      teamId={row.teamId}
                      abbr={row.abbreviation.slice(0, 2)}
                      style={{ width: 18, height: 18, fontSize: 8, flexShrink: 0 }}
                    />
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
    <span className={chipClass}>
      {arrow} Picked {predictedRank}{getOrdinalSuffix(predictedRank)} — currently {currentRank}{getOrdinalSuffix(currentRank)}
    </span>
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

/** Small board-confidence chip for the dashboard season panel. */
function BoardConfidenceChip(props: {
  board: BoardSummaryView
  onNavigate: () => void
}): JSX.Element {
  const { board } = props
  const chipClass =
    board.confidence >= 60
      ? 'chip chip-success'
      : board.confidence >= 35
        ? 'chip chip-warn'
        : 'chip chip-danger'
  return (
    <button
      type="button"
      className={chipClass}
      style={{ cursor: 'pointer', border: 'none' }}
      onClick={props.onNavigate}
      title="View owner / board expectations"
    >
      Board: {board.confidenceLabel} · {board.statusLabel}
    </button>
  )
}

/** The Summer hub — the offseason dashboard centerpiece. Shows where you are
 *  in the summer (July 1 anchors free agency), what needs your signature, and
 *  who is on the market, instead of dead in-season match panels. */
function SummerDesk({ onOpen }: { onOpen: () => void }): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const { data: os } = useScreenData(
    () => client.getOffseason(),
    (r) => (r.type === 'offseason' ? r.offseason : null)
  )

  return (
    <Panel title="The Offseason Desk" className="dash-fill">

      <div className="dash-scroll">
      {/* stage content */}
      {os?.stage === 'resign' && (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {os.expiring.filter((r) => r.status === 'pending').length === 0 ? (
            <span className="muted small">No expiring contracts need your signature. The desk is clear for July 1.</span>
          ) : (
            <>
              <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: 10 }}>
                Expiring contracts — your call first
              </div>
              <div className="list">
                {os.expiring.filter((r) => r.status === 'pending').slice(0, 6).map((r) => (
                  <div key={r.playerId} className="row-between small">
                    <span className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                      <PlayerFace faceId={r.faceId} name={r.name} size={24} />
                      <span className="muted" style={{ width: 20 }}>{r.position}</span>
                      <PlayerLink playerId={r.playerId} name={r.name} />
                      <span className="muted">{r.age}</span>
                    </span>
                    <span className="mono muted">asks {fmtMoney(r.askSalary)} × {r.askYears}y</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {(os.arbitration?.length ?? 0) > 0 && (
            <span className="chip chip-danger" style={{ fontSize: 11 }}>
              ⚖ {os.arbitration!.length} arbitration case{os.arbitration!.length === 1 ? '' : 's'} pending
            </span>
          )}
        </div>
      )}
      {os?.stage === 'freeAgency' && (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: 10 }}>
            Best available on the open market
          </div>
          {os.freeAgents.length === 0 ? (
            <span className="muted small">
              The market is picked clean — every name worth a contract is signed. The next class arrives after the season.
            </span>
          ) : (
            <div className="list">
              {[...os.freeAgents].sort((a, b) => b.overall - a.overall).slice(0, 6).map((f) => (
                <div key={f.playerId} className="row-between small">
                  <span className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                    <PlayerFace faceId={f.faceId} name={f.name} size={24} />
                    <span className="muted" style={{ width: 20 }}>{f.position}</span>
                    <PlayerLink playerId={f.playerId} name={f.name} />
                    <span className="muted">{f.age}</span>
                  </span>
                  <span className="mono muted">asks {fmtMoney(f.askSalary)} × {f.askYears}y · decides {f.decidesInDays}d</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {os?.stage === 'preseason' && (
        <span className="muted small">Camp is underway — the roster battles resolve before the opener.</span>
      )}
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-2)', flexShrink: 0 }}>
        <button className="btn btn-primary btn-sm" onClick={onOpen}>
          Work the desk →
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => nav.navigate('transfers' as never)}>
          Trade office
        </button>
      </div>
    </Panel>
  )
}

/** FM-portal messages pane: day-grouped, sender lines, unread dots, filters.
 *  A digest with the texture of a real mailbox — click-through to the inbox. */
function MessagesPane({ inbox, unread, onOpen, onOpenItem }: {
  inbox: InboxView | null
  unread: number
  onOpen: () => void
  onOpenItem: (id: string) => void
}): JSX.Element {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const items = [...(inbox?.items ?? [])]
    .filter((i) => filter === 'all' || !i.read)
    .sort((a, b) => (b.day - a.day) || b.id.localeCompare(a.id))
    .slice(0, 40)

  // Group by display date (offseason mail carries dateISO; season mail has day).
  const dateLabel = (i: (typeof items)[number]): string =>
    fmtDate(i.dateISO ?? dayToDateISO(i.year, Math.max(1, i.day)))
  const groups: Array<{ label: string; rows: typeof items }> = []
  for (const it of items) {
    const label = dateLabel(it)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.rows.push(it)
    else groups.push({ label, rows: [it] })
  }

  const SENDER: Record<string, string> = {
    result: 'Match Report', injury: 'Medical Staff', trade: 'Front Office',
    contract: 'Front Office', draft: 'Scouting Dept', award: 'League Office',
    league: 'League Office', milestone: 'Club News', playoffs: 'League Office',
    scouting: 'Scouting Dept',
  }

  return (
    <Panel title="Messages" className="dash-fill">
      <div className="row" style={{ gap: 6, marginBottom: 4, flexShrink: 0 }}>
        {(['all', 'unread'] as const).map((f) => (
          <button
            key={f}
            className={`chip${filter === f ? ' chip-accent' : ''}`}
            style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : `Unread (${unread})`}
          </button>
        ))}
      </div>
      <div className="dash-scroll">
      {groups.length === 0 && <span className="muted small">Nothing here — a quiet desk.</span>}
      {groups.map((g) => (
        <div key={g.label}>
          <div
            style={{
              fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--muted)',
              background: 'var(--bg0)', borderRadius: 4, padding: '3px 8px', margin: '6px 0 2px',
            }}
          >
            {g.label}
          </div>
          {g.rows.map((item) => (
            <div
              key={item.id}
              onClick={() => onOpenItem(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px',
                borderBottom: '1px solid var(--line)', cursor: 'pointer', minWidth: 0,
              }}
            >
              <span style={{ fontSize: 13, flexShrink: 0, color: CAT_COLOR[item.category] }}>
                {CAT_ICON[item.category] ?? '🏒'}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="muted" style={{ fontSize: 10 }}>
                  {item.speaker ?? item.press?.byline?.split('—')[0]?.trim() ?? SENDER[item.category] ?? 'Club'}
                </div>
                <div
                  style={{
                    fontSize: 12.5, fontWeight: item.read ? 400 : 700,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    color: item.read ? 'var(--muted)' : 'var(--text)',
                  }}
                >
                  {item.headline}
                </div>
              </span>
              {!item.read && (
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--violet-h)', flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>
      ))}
      </div>
      <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 6, flexShrink: 0 }} onClick={onOpen}>
        Open inbox →
      </button>
    </Panel>
  )
}

/* ── kind metadata for the market pulse rows ── */
const TX_META: Record<string, { icon: string; color: string }> = {
  signing: { icon: '🖊', color: 'var(--amber)' },
  trade: { icon: '🔄', color: 'var(--violet-h)' },
  waiver: { icon: '📋', color: 'var(--muted)' },
  buyout: { icon: '✂️', color: 'var(--red)' },
  callup: { icon: '⬆', color: 'var(--cyan)' },
  senddown: { icon: '⬇', color: 'var(--muted)' },
}

/** Around the league — the July story is the market. Real transactions from
 *  the ledger, newest first, so the right column earns its space in summer. */
function MarketPulse({ stageLabel }: { stageLabel?: string }): JSX.Element | null {
  const client = useClient()
  const nav = useNav()
  const { data: tx } = useScreenData(
    () => client.getTransactions(14),
    (r) => (r.type === 'transactions' ? r.transactions : null)
  )
  const items = tx?.items ?? []

  // Phase-aware empty state (dashboard law: no dead "nothing here" cards) — before
  // July 1 the market is loading; once it opens, deals land here as they happen.
  const preFrenzy = !stageLabel || /re-sign|awards|draft/i.test(stageLabel)
  const emptyMsg = preFrenzy
    ? 'Quiet before the storm — the wire lights up when free agency opens July 1. Every league signing and trade will land here.'
    : 'No moves across the league yet today — deals will appear here the moment they happen.'

  return (
    <Panel title="Around the league" className="dash-fill">
      <div className="dash-scroll">
        {items.length === 0 && (
          <span className="muted small">{emptyMsg}</span>
        )}
        {items.map((t) => {
          const meta = TX_META[t.kind] ?? { icon: '🏒', color: 'var(--muted)' }
          return (
            <div
              key={t.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '7px 2px', borderBottom: '1px solid var(--line)',
              }}
            >
              <span style={{ fontSize: 12, flexShrink: 0, color: meta.color, marginTop: 1 }}>{meta.icon}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.45, minWidth: 0 }}>{t.summary}</span>
            </div>
          )
        })}
      </div>
      <button
        className="btn btn-ghost btn-sm"
        style={{ width: '100%', marginTop: 6, flexShrink: 0 }}
        onClick={() => nav.navigate('leagueTransactions')}
      >
        All transactions →
      </button>
    </Panel>
  )
}

/** The news hero: the most recent stories as a big rotating card — category
 *  chip, headline at display size, a two-line excerpt, byline, page dots —
 *  with the league's live storyline chips folded into the same card. */
function NewsHero({ inbox, arcs, onOpen }: {
  inbox: InboxView | null
  arcs: Array<{ kind: string; headline: string }>
  onOpen: () => void
}): JSX.Element | null {
  const [page, setPage] = useState(0)
  const stories = [...(inbox?.items ?? [])]
    .filter((i) => i.body.length > 60)
    .sort((a, b) => (b.day - a.day) || b.id.localeCompare(a.id))
    .slice(0, 5)
  if (stories.length === 0) return null
  const story = stories[Math.min(page, stories.length - 1)]!

  return (
    <div
      className="panel"
      onClick={onOpen}
      style={{
        padding: '12px 18px', cursor: 'pointer', position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(115deg, var(--bg1) 55%, rgba(var(--accent-rgb, 108,92,231), 0.14) 100%)',
        flexShrink: 0,
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}>
        <span className="chip chip-accent" style={{ fontSize: 10 }}>
          {CAT_ICON[story.category]} {story.category.toUpperCase()}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          {story.press?.byline ?? story.speaker ?? 'Club News'}
        </span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, letterSpacing: -0.3, marginBottom: 4 }}>
        {story.headline}
      </div>
      <div
        className="muted"
        style={{
          fontSize: 12.5, lineHeight: 1.45, maxWidth: '94%',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}
      >
        {story.body}
      </div>
      {/* storylines — the league's running threads, folded into the card */}
      {arcs.length > 0 && (
        <div className="row" style={{ gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
          {arcs.slice(0, 3).map((arc, i) => (
            <span key={i} className="chip chip-violet" style={{ fontSize: 10 }}>
              {arc.headline}
            </span>
          ))}
        </div>
      )}
      {/* pagination dots */}
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        {stories.map((_, i) => (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); setPage(i) }}
            aria-label={`story ${i + 1}`}
            style={{
              width: i === page ? 26 : 8, height: 8, borderRadius: 4, border: 'none', cursor: 'pointer',
              background: i === page ? 'rgb(var(--accent-rgb, 108,92,231))' : 'var(--line)',
              transition: 'width 120ms ease',
              padding: 0,
            }}
          />
        ))}
        <span style={{ flex: 1 }} />
        <span className="muted small">See all news →</span>
      </div>
    </div>
  )
}

/** The hero identity band: who you are, where you stand, what matters —
 *  painted in the club's colours instead of a generic header row. */
function DashHero({ d, customize }: { d: DashboardView; customize: React.ReactNode }): JSX.Element {
  const nav = useNav()
  const s = d.userTeam.standing
  const played = s.wins + s.losses + s.overtimeLosses > 0
  const capFree = d.salaryCap - d.capUsed
  const capPct = d.salaryCap > 0 ? (d.capUsed / d.salaryCap) * 100 : 0
  const capColor = capPct > 100 ? 'var(--red, #e05555)' : capPct > 92 ? 'var(--amber, #d6a056)' : 'var(--green, #2ea043)'
  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-4)',
        flexWrap: 'wrap',
        padding: '9px 16px',
        flexShrink: 0,
        background:
          'linear-gradient(100deg, rgba(var(--accent-rgb, 108,92,231), 0.22) 0%, rgba(var(--accent-rgb, 108,92,231), 0.07) 38%, var(--bg1) 72%)',
        borderLeft: '3px solid rgb(var(--accent-rgb, 108,92,231))',
      }}
    >
      <TeamCrest className="crest" teamId={d.userTeam.teamId} abbr={d.userTeam.name.slice(0, 2)} style={{ width: 44, height: 44, fontSize: 15 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, letterSpacing: -0.3 }}>{d.userTeam.name}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {d.leagueName} · {d.year} ·{' '}
          {d.phase === 'offseason' ? (d.offseasonStageLabel ?? 'Offseason') : `Day ${d.day}/${d.totalDays}`}
        </div>
      </div>

      <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />

      {/* record block */}
      <div>
        <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.1 }}>
          {s.wins}–{s.losses}–{s.overtimeLosses}
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginLeft: 7 }}>{s.points} pts</span>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {played ? `#${d.userTeam.rank} overall · #${d.userTeam.conferenceRank} conf` : 'season ahead'}
        </div>
      </div>

      {played && (
        <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
          <span className="chip chip-violet" style={{ fontSize: 11 }}>Streak {s.streak}</span>
          <LastFive value={s.lastFive} />
        </div>
      )}

      <span style={{ flex: 1 }} />

      {/* the verdict chips */}
      <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <div title={`${fmtMoney(d.capUsed)} used of ${fmtMoney(d.salaryCap)}`} style={{ textAlign: 'right' }}>
          <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Cap space</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: capColor, lineHeight: 1.1 }}>{fmtMoney(capFree)}</div>
        </div>
        {d.predictedRank !== undefined && played && (
          <ExpectationChip predictedRank={d.predictedRank} currentRank={d.userTeam.rank} />
        )}
        {d.predictedRank !== undefined && !played && (
          <span className="chip chip-violet">Media pick: {d.predictedRank}{getOrdinalSuffix(d.predictedRank)}</span>
        )}
        {d.board && <BoardConfidenceChip board={d.board} onNavigate={() => nav.navigate('board')} />}
        <span className={`chip ${d.injuries.length === 0 ? 'chip-success' : 'chip-danger'}`} style={{ fontSize: 11 }}>
          {d.injuries.length === 0 ? '✚ Healthy' : `🩹 ${d.injuries.length} injured`}
        </span>
        {customize}
      </div>
    </div>
  )
}

/** The Week Ahead — the dashboard centerpiece. A vertical agenda derived from
 *  the calendar: today highlighted, then everything coming — games, summer
 *  beats, decisions. Continue visibly walks down this list. */
function WeekAhead({ d, calendar, onOpenCalendar, onOpenOffseason, onWatch, busy }: {
  d: DashboardView
  calendar: CalendarView | null
  onOpenCalendar: () => void
  onOpenOffseason: () => void
  onWatch: () => void
  busy: boolean
}): JSX.Element {
  const nav = useNav()
  const offseason = d.phase === 'offseason'
  const todayISO = calendar?.todayISO ?? d.date ?? ''

  // Upcoming rows from the calendar: games + key dates after today.
  const horizonEnd = ((): string => {
    if (offseason) return '9999'
    const t = new Date(todayISO + 'T00:00:00Z')
    t.setUTCDate(t.getUTCDate() + 8)
    return t.toISOString().slice(0, 10)
  })()
  const all = (calendar?.entries ?? []).filter((e) => e.dateISO > todayISO && e.dateISO < horizonEnd)
  const gameDates = new Set(all.filter((e) => e.kind === 'game').map((e) => e.dateISO))
  const upcoming = all
    .filter((e) => !(e.kind === 'keydate' && e.label === 'Season Begins' && gameDates.has(e.dateISO)))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
    .slice(0, 5)

  const dateCell = (iso: string): JSX.Element => {
    const dt = new Date(iso + 'T00:00:00Z')
    const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][dt.getUTCMonth()]
    return (
      <div style={{ width: 38, textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: 8.5, letterSpacing: 1.1, color: 'var(--muted)' }}>{mon}</div>
        <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1 }}>{dt.getUTCDate()}</div>
      </div>
    )
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
    padding: '4px 8px', borderTop: '1px solid var(--line)',
  }

  return (
    <Panel title="The Week Ahead">
      {/* today — the highlighted head of the agenda */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '7px 10px',
          borderRadius: 8, marginBottom: 2,
          background: 'rgba(var(--accent-rgb, 108,92,231), 0.13)',
          border: '1px solid rgba(var(--accent-rgb, 108,92,231), 0.45)',
        }}
      >
        {todayISO && dateCell(todayISO)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--violet-h)' }}>Today</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {offseason
              ? (d.offseasonStageLabel ?? 'The offseason')
              : d.nextGame && d.nextGame.date === todayISO
                ? <>vs <TeamLink teamId={d.nextGame.opponentTeamId} name={d.nextGame.opponentName} /></>
                : 'Training day — no fixture'}
          </div>
        </div>
        {offseason ? (
          <button className="btn btn-primary btn-sm" onClick={onOpenOffseason}>Open the desk →</button>
        ) : d.nextGame && d.nextGame.date === todayISO ? (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={onWatch}>Watch</button>
        ) : null}
      </div>

      {/* the coming days */}
      {upcoming.map((e, i) => (
        <div key={i} style={rowStyle}>
          {dateCell(e.dateISO)}
          {e.kind === 'game' ? (
            <>
              <TeamCrest className="crest" teamId={e.opponentAbbr} abbr={e.opponentAbbr.slice(0, 2)} style={{ width: 22, height: 22, fontSize: 9, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                <span className="muted">{e.home ? 'vs' : '@'}</span>{' '}
                <span style={{ fontWeight: 600 }}>{e.opponentName}</span>
              </div>
              {e.result ? (
                <span className={`chip ${e.result.won ? 'chip-success' : 'chip-danger'}`} style={{ fontSize: 10 }}>
                  {e.result.won ? 'W' : 'L'} {e.result.homeGoals}–{e.result.awayGoals}
                </span>
              ) : e.isNext ? (
                <span className="chip chip-warn" style={{ fontSize: 10 }}>next</span>
              ) : null}
            </>
          ) : (
            <>
              <span style={{ fontSize: 14, flexShrink: 0 }}>📌</span>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{e.label}</div>
            </>
          )}
        </div>
      ))}
      {upcoming.length === 0 && (
        <div className="muted small" style={{ padding: '8px 10px' }}>A quiet stretch — the calendar has the full picture.</div>
      )}

      <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 6 }} onClick={onOpenCalendar}>
        Full calendar →
      </button>
    </Panel>
  )
}

