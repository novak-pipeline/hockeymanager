import { useState } from 'react'
import type { NewsCategory } from '@domain'
import type {
  BoardSummaryView,
  BoxScoreView,
  DashboardView,
  InboxView,
  LeagueComparisonView,
  LeagueComparisonCard,
  PlayoffOddsView,
  ScheduleEntryView,
  ScheduleView,
  StandingRowView,
  TentpoleView,
} from '../../worker/protocol'
import { useShellActions } from '../components/ActionsContext'
import { PlayerLink, TeamLink, useNav } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { fmtDate, fmtMoney } from '../components/format'
import { TeamCrest } from '../components/Crest'
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

/* ═══════════════════════════════════════════════════════════════
   Main screen
   ═══════════════════════════════════════════════════════════════ */

/** Club home screen: FM24-style 3-col card grid. */
/** Optional dashboard panels the user can hide (core panels stay always-on). */
const OPTIONAL_PANELS: Array<{ key: string; label: string }> = [
  { key: 'injuries', label: 'Injuries' },
  { key: 'storylines', label: 'Storylines' },
  { key: 'fixtures', label: 'Fixtures' },
  { key: 'topScorers', label: 'Top scorers' },
  { key: 'playoff', label: 'Playoff picture' },
  { key: 'stacksUp', label: 'How you stack up' },
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

  const { data: comparison } = useScreenData<LeagueComparisonView>(
    () => client.getLeagueComparison(),
    (r) => (r.type === 'leagueComparison' ? r.comparison : null)
  )

  const { data: playoffOdds } = useScreenData<PlayoffOddsView>(
    () => client.getPlayoffOdds(),
    (r) => (r.type === 'playoffOdds' ? r.odds : null)
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
    <section className="stack">
      {/* title row */}
      <ScreenHeader title={d.userTeam.name}>
        <CustomizeMenu hidden={hiddenPanels} onToggle={togglePanel} />
        <span className="muted small">
          {d.leagueName} · {d.year} · {d.phase === 'offseason' ? (d.offseasonStageLabel ?? 'Offseason') : `Day ${d.day}/${d.totalDays}`}
        </span>
      </ScreenHeader>

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

      {/* ── Status strip: the season at a glance, one dense row ── */}
      <StatusStrip d={d} onBoard={() => nav.navigate('board')} onMedical={() => nav.navigate('teamMedical')} />

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

        </div>

        {/* ═══ CENTER COLUMN ═══ */}
        <div className="stack">

          {/* Storylines ticker strip */}
          {shown('storylines') && d.topArcs && d.topArcs.length > 0 && (
            <StorylinesStrip arcs={d.topArcs} />
          )}

          {/* The Summer hub (offseason): the working panels for July-September */}
          {d.phase === 'offseason' && <SummerPanel stageLabel={d.offseasonStageLabel} onOpen={() => nav.navigate('offseason')} />}

          {/* News / last result hero */}
          {d.phase !== 'offseason' && (d.lastResult ? (
            <LastResultHero
              result={d.lastResult}
              boxScore={boxScore ?? null}
              onBoxScore={() => nav.navigate('matchcenter')}
            />
          ) : (
            <Panel title="Match result">
              <span className="muted small">No games played yet.</span>
            </Panel>
          ))}

          {/* Next game */}
          {d.phase !== 'offseason' && (
          <Panel title="Next game">
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

          {/* The next two weeks — compact strip, not a month of empty cells */}
          {d.phase !== 'offseason' && schedule && d.date && (
            <FortnightStrip
              entries={schedule.entries}
              todayDate={d.date}
              onOpenBoxScore={(gameId) => nav.navigate('matchcenter', { gameId })}
              onOpenCalendar={() => nav.navigate('calendar')}
            />
          )}

        </div>

        {/* ═══ RIGHT COLUMN ═══ */}
        <div className="stack">

          {/* Fixtures card */}
          {shown('fixtures') && (
          <Panel title="Fixtures">
            <FixturesCard entries={schedule?.entries ?? []} todayDate={d.date} />
          </Panel>
          )}

          {/* Division standings */}
          <Panel title={`${d.divisionName} Division`}>
            <MiniTable rows={d.divisionStandings} userTeamId={d.userTeam.teamId} />
          </Panel>

          {/* Top scorers */}
          {shown('topScorers') && (
          <Panel title="Top scorers">
            {d.topScorers.length === 0 ? (
              <span className="muted small">No points scored yet.</span>
            ) : (
              <div className="list">
                {d.topScorers.map((p) => (
                  <div key={p.playerId} className="row-between small">
                    <span className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', minWidth: 0 }}>
                      <PlayerFace faceId={p.faceId} name={p.name} size={26} />
                      <span className="muted" style={{ width: 22, flexShrink: 0 }}>{p.position}</span>
                      <PlayerLink playerId={p.playerId} name={p.name} />
                    </span>
                    <span className="mono" style={{ flexShrink: 0 }}>
                      {p.goals}G {p.assists}A ·{' '}
                      <strong style={{ color: 'var(--violet-h)' }}>{p.points} pts</strong>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          )}

          {/* Playoff picture */}
          {shown('playoff') && playoffOdds?.available && (
            <Panel title="Playoff picture">
              <PlayoffOddsCard view={playoffOdds} />
            </Panel>
          )}

          {/* How your club stacks up */}
          {shown('stacksUp') && comparison && comparison.cards.length > 0 && (
            <Panel title="How you stack up">
              <StacksUpCard view={comparison} />
            </Panel>
          )}

        </div>
      </div>
    </section>
  )
}

/* ── Playoff odds card ── */

function oddsColor(pct: number): string {
  if (pct >= 85) return 'var(--success)'
  if (pct >= 45) return 'var(--accent, #f5b301)'
  if (pct >= 15) return 'var(--amber, #f59e0b)'
  return 'var(--danger)'
}

function PlayoffOddsCard({ view }: { view: PlayoffOddsView }): JSX.Element {
  const user = view.rows.find((r) => r.isUser)
  // The user's conference, by projected points, with the top-4 playoff cut line.
  const conf = user ? view.rows.filter((r) => r.conference === user.conference) : []

  return (
    <div className="list">
      {user && (
        <div className="row-between" style={{ alignItems: 'baseline', marginBottom: 6 }}>
          <span>
            <span style={{ fontSize: 22, fontWeight: 800, color: oddsColor(user.playoffPct) }}>{user.playoffPct}%</span>
            <span className="muted small"> to make the playoffs</span>
          </span>
          <span className="muted small">proj. {user.projectedPoints} pts</span>
        </div>
      )}
      <div className="muted small" style={{ marginBottom: 4, opacity: 0.7 }}>
        {user?.conference} — top 4 make it ({view.simulations} sims)
      </div>
      {conf.map((r, i) => (
        <div key={r.teamId}>
          {i === 4 && <div style={{ borderTop: '1px dashed var(--danger)', opacity: 0.5, margin: '3px 0' }} />}
          <div
            className="row-between small"
            style={{ alignItems: 'center', gap: 8, fontWeight: r.isUser ? 700 : 400, color: r.isUser ? 'var(--violet-h)' : undefined }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {i + 1}. <TeamLink teamId={r.teamId} name={r.abbreviation} /> <span className="muted">{r.points}p · {r.gamesRemaining} left</span>
            </span>
            <span className="mono" style={{ color: oddsColor(r.playoffPct), fontWeight: 700, minWidth: 38, textAlign: 'right' }}>
              {r.playoffPct}%
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── League comparison card ── */

function rankColor(percentile: number): string {
  if (percentile >= 0.66) return 'var(--success)'
  if (percentile >= 0.33) return 'var(--amber, #f59e0b)'
  return 'var(--danger)'
}

function StacksUpCard({ view }: { view: LeagueComparisonView }): JSX.Element {
  return (
    <div className="list">
      <div className="muted small" style={{ marginBottom: 4, opacity: 0.75 }}>
        Your rank across the NHL — 1 is best.
      </div>
      {view.cards.map((c: LeagueComparisonCard) => {
        const color = rankColor(c.percentile)
        return (
          <div key={c.key} className="row-between small" style={{ alignItems: 'center', gap: 8 }} title={c.blurb}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.label}
              <span className="muted" style={{ marginLeft: 6 }}>{c.display}</span>
            </span>
            <span className="row" style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
              {!c.isUserLeader && (
                <span className="muted" style={{ fontSize: 10 }} title={`League leader: ${c.leaderAbbr} (${c.leaderDisplay})`}>
                  led by <TeamLink teamId={c.leaderTeamId} name={c.leaderAbbr} />
                </span>
              )}
              <span
                className="mono"
                style={{ color, fontWeight: 700, minWidth: 52, textAlign: 'right' }}
              >
                {c.isUserLeader ? '★ ' : ''}{c.rank}<span className="muted" style={{ fontWeight: 400 }}>/{c.outOf}</span>
              </span>
            </span>
          </div>
        )
      })}
    </div>
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

/** The next fortnight as one compact strip: opponents, H/A, results — every
 *  cell earns its pixels (the month grid lives on the Calendar screen). */
function FortnightStrip(props: {
  entries: ScheduleEntryView[]
  todayDate: string
  onOpenBoxScore: (gameId: string) => void
  onOpenCalendar: () => void
}): JSX.Element {
  const { entries, todayDate } = props

  // 14 day cells starting today.
  const start = new Date(todayDate + 'T00:00:00Z')
  const byDate = new Map<string, ScheduleEntryView>()
  for (const e of entries) byDate.set(e.date, e)
  const days: Array<{ iso: string; dayNum: number; dow: string; game: ScheduleEntryView | null }> = []
  for (let i = 0; i < 14; i++) {
    const dt = new Date(start)
    dt.setUTCDate(start.getUTCDate() + i)
    const iso = dt.toISOString().slice(0, 10)
    days.push({
      iso,
      dayNum: dt.getUTCDate(),
      dow: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dt.getUTCDay()]!,
      game: byDate.get(iso) ?? null,
    })
  }

  return (
    <Panel title="Next two weeks">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)', gap: 3 }}>
        {days.map((cell, i) => {
          const g = cell.game
          const played = g?.result != null
          const won = played ? g!.result!.won : false
          const ot = played && g!.result!.decidedBy !== 'regulation' && !won
          const userGoals = played ? (g!.home ? g!.result!.homeGoals : g!.result!.awayGoals) : 0
          const oppGoals = played ? (g!.home ? g!.result!.awayGoals : g!.result!.homeGoals) : 0
          const clickable = played
          return (
            <div
              key={cell.iso}
              onClick={clickable ? () => props.onOpenBoxScore(g!.gameId) : undefined}
              title={g ? `${g.home ? 'vs' : '@'} ${g.opponentName}${played ? ` — ${userGoals}–${oppGoals}` : ''}` : undefined}
              style={{
                borderRadius: 4,
                padding: '4px 2px',
                textAlign: 'center',
                minHeight: 52,
                border: i === 0 ? '1px solid var(--violet-h)' : '1px solid var(--line)',
                background: g
                  ? played
                    ? won ? 'rgba(46,160,67,0.12)' : ot ? 'rgba(214,160,86,0.12)' : 'rgba(224,85,85,0.10)'
                    : 'rgba(var(--accent-rgb),0.10)'
                  : 'var(--bg0)',
                cursor: clickable ? 'pointer' : 'default',
              }}
            >
              <div style={{ fontSize: 9, color: 'var(--muted)' }}>{cell.dow} {cell.dayNum}</div>
              {g ? (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>
                    {g.home ? '' : '@'}{g.opponentAbbr}
                  </div>
                  <div style={{ fontSize: 10, marginTop: 1, color: played ? (won ? 'var(--green, #2ea043)' : ot ? 'var(--amber, #d6a056)' : 'var(--red, #e05555)') : 'var(--muted)' }}>
                    {played ? `${won ? 'W' : ot ? 'OT' : 'L'} ${userGoals}–${oppGoals}` : g.home ? 'home' : 'away'}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--line)', marginTop: 8 }}>·</div>
              )}
            </div>
          )
        })}
      </div>
      <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 6 }} onClick={props.onOpenCalendar}>
        Full calendar →
      </button>
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
function SummerPanel({ stageLabel, onOpen }: { stageLabel?: string; onOpen: () => void }): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const { data: os } = useScreenData(
    () => client.getOffseason(),
    (r) => (r.type === 'offseason' ? r.offseason : null)
  )

  const stages: Array<{ key: string; label: string }> = [
    { key: 'resign', label: 'Re-sign' },
    { key: 'freeAgency', label: 'Jul 1 · Free agency' },
    { key: 'preseason', label: 'Sept · Training camp' },
  ]
  const currentKey = os?.stage ?? 'resign'

  return (
    <Panel title="The Summer">
      {/* stage timeline */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 'var(--sp-3)', alignItems: 'center' }}>
        {stages.map((st, i) => {
          const activeIdx = stages.findIndex((x) => x.key === currentKey)
          const state = i < activeIdx ? 'done' : i === activeIdx ? 'now' : 'next'
          return (
            <span key={st.key} className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span
                className="chip"
                style={{
                  fontSize: 11,
                  ...(state === 'now'
                    ? { background: 'rgba(var(--accent-rgb),0.2)', color: 'var(--violet-h)', fontWeight: 700, border: '1px solid var(--violet-h)' }
                    : state === 'done'
                      ? { opacity: 0.55, textDecoration: 'line-through' }
                      : { opacity: 0.75 }),
                }}
              >
                {st.label}
              </span>
              {i < stages.length - 1 && <span className="muted small">→</span>}
            </span>
          )
        })}
        <span className="chip chip-warn" style={{ fontSize: 11 }}>🏒 Opening night · Oct 1</span>
      </div>

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

      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <button className="btn btn-primary btn-sm" onClick={onOpen}>
          Open the offseason desk →
        </button>
        {stageLabel && <span className="muted small" style={{ alignSelf: 'center', marginLeft: 8 }}>{stageLabel}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => nav.navigate('calendar')}>
          Full calendar
        </button>
      </div>
    </Panel>
  )
}

/** The season at a glance: record, streak, cap, expectation, board mood, and
 *  squad health — one dense row instead of three half-empty panels. */
function StatusStrip(props: {
  d: DashboardView
  onBoard: () => void
  onMedical: () => void
}): JSX.Element {
  const { d } = props
  const s = d.userTeam.standing
  const capFree = d.salaryCap - d.capUsed
  const capPct = d.salaryCap > 0 ? (d.capUsed / d.salaryCap) * 100 : 0
  const capColor = capPct > 100 ? 'var(--red, #e05555)' : capPct > 92 ? 'var(--amber, #d6a056)' : 'var(--green, #2ea043)'
  const divider = <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />

  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 'var(--sp-4)',
        padding: '10px 16px',
      }}
    >
      {/* record + rank */}
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>
          {s.wins}–{s.losses}–{s.overtimeLosses}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginLeft: 8 }}>{s.points} pts</span>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          #{d.userTeam.rank} overall · #{d.userTeam.conferenceRank} conference · {s.goalsFor} GF / {s.goalsAgainst} GA
        </div>
      </div>
      {divider}
      {/* form (only once games exist — a day-zero streak is noise) */}
      {s.wins + s.losses + s.overtimeLosses > 0 && (
        <>
          <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
            <span className="chip chip-violet" style={{ fontSize: 11 }}>Streak {s.streak}</span>
            <LastFive value={s.lastFive} />
          </div>
          {divider}
        </>
      )}
      {/* cap */}
      <div title={`${fmtMoney(d.capUsed)} used of ${fmtMoney(d.salaryCap)}`}>
        <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Cap space</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: capColor }}>{fmtMoney(capFree)}</div>
        <div className="meter" style={{ width: 110, height: 4, marginTop: 3 }}>
          <div
            className={capPct > 100 ? 'meter-fill over' : capPct > 92 ? 'meter-fill warn' : 'meter-fill'}
            style={{ width: `${Math.min(100, Math.max(0, capPct))}%` }}
          />
        </div>
      </div>
      {divider}
      {/* the verdict chips */}
      <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        {d.predictedRank !== undefined && s.wins + s.losses + s.overtimeLosses > 0 && (
          <ExpectationChip predictedRank={d.predictedRank} currentRank={d.userTeam.rank} />
        )}
        {d.predictedRank !== undefined && s.wins + s.losses + s.overtimeLosses === 0 && (
          <span className="chip chip-violet">Media pick: {d.predictedRank}{getOrdinalSuffix(d.predictedRank)}</span>
        )}
        {d.board && <BoardConfidenceChip board={d.board} onNavigate={props.onBoard} />}
        <button
          type="button"
          className={`chip ${d.injuries.length === 0 ? 'chip-success' : 'chip-danger'}`}
          style={{ cursor: 'pointer', border: 'none' }}
          onClick={props.onMedical}
          title="Open the Medical Center"
        >
          {d.injuries.length === 0 ? '✚ Fully healthy' : `🩹 ${d.injuries.length} injured`}
        </button>
      </div>
    </div>
  )
}
