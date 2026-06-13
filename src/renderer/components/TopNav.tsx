import type { DashboardView } from '../../worker/protocol'
import { useShellActions } from './ActionsContext'
import { crestColor, fmtDate } from './format'
import { useNav, sectionOf, type ScreenId, type SectionId } from './NavContext'

const PHASE_CHIP: Record<DashboardView['phase'], string> = {
  regularSeason: 'chip chip-violet',
  playoffs:      'chip chip-warn',
  offseason:     'chip',
}

const PHASE_LABEL: Record<DashboardView['phase'], string> = {
  regularSeason: 'Regular season',
  playoffs:      'Playoffs',
  offseason:     'Offseason',
}

/* ── section definitions ── */

interface SubTab {
  id: ScreenId
  label: string
  badge?: number
}

interface Section {
  id: SectionId
  label: string
  defaultScreen: ScreenId
  subTabs: SubTab[]
  contextualSubTabs?: SubTab[]
}

function buildSections(phase: DashboardView['phase'], unread: number): Section[] {
  const contextual: SubTab[] = []
  if (phase === 'playoffs') {
    contextual.push({ id: 'playoffs', label: 'Playoffs' })
  }
  if (phase === 'offseason') {
    contextual.push({ id: 'draft', label: 'Draft' })
    contextual.push({ id: 'offseason', label: 'Offseason' })
  }

  return [
    {
      id: 'frontOffice',
      label: 'Front Office',
      defaultScreen: 'dashboard',
      subTabs: [
        { id: 'dashboard', label: 'Overview' },
        { id: 'board',     label: 'Owner / Board' },
      ],
    },
    {
      id: 'news',
      label: 'News',
      defaultScreen: 'inbox',
      subTabs: [{ id: 'inbox', label: 'Inbox', ...(unread > 0 ? { badge: unread } : {}) }],
    },
    {
      id: 'team',
      label: 'Team',
      defaultScreen: 'squad',
      subTabs: [
        { id: 'squad',       label: 'Roster' },
        { id: 'teamStats',   label: 'Statistics' },
        { id: 'report',      label: 'Report' },
        { id: 'personnel',   label: 'Personnel' },
        { id: 'practice',    label: 'Practice' },
        { id: 'tactics',     label: 'Tactics' },
        { id: 'finances',    label: 'Finances' },
        { id: 'teamInfo',    label: 'Team Info' },
        { id: 'teamHistory', label: 'History' },
      ],
    },
    {
      id: 'league',
      label: 'League',
      defaultScreen: 'leagueOverview',
      subTabs: [
        { id: 'leagueOverview',     label: 'Overview' },
        { id: 'standings',          label: 'Standings' },
        { id: 'stats',              label: 'Player Stats' },
        { id: 'leagueTeamStats',    label: 'Team Stats' },
        { id: 'leagueTransactions', label: 'Transactions' },
        { id: 'leagueScoreboard',   label: 'Scoreboard' },
        { id: 'leagueHistory',      label: 'History' },
        { id: 'scouting',           label: 'Scouting' },
        ...contextual,
      ],
    },
  ]
}

/**
 * EHM-style top navigation:
 *  Row 1: club identity | date + phase + next game | sim controls + hero action
 *  Row 2: four section tabs (Front Office / News / Team / League)
 *  Row 3: sub-tabs for the active section
 */
export function TopNav(props: {
  teamId: string
  clubName: string
  clubAbbr: string
  dashboard: DashboardView | null
  busy: boolean
  engineVersion: string
  onSave: () => void
  onLoad: () => void
}): JSX.Element {
  const nav = useNav()
  const actions = useShellActions()
  const d = props.dashboard
  const standing = d?.userTeam.standing ?? null
  const phase = d?.phase ?? 'regularSeason'
  const unread = d?.unreadNews ?? 0
  const next = d?.nextGame ?? null

  const sections = buildSections(phase, unread)
  const activeSection = sectionOf(nav.screen)

  const currentSection = sections.find((s) => s.id === activeSection) ?? sections[0]!

  return (
    <header className="topnav">
      {/* ── Row 1 ── */}
      <div className="topnav-row1">
        {/* Club identity */}
        <div className="topnav-club">
          <div
            className="topnav-crest"
            style={{ background: crestColor(props.teamId) }}
          >
            {props.clubAbbr}
          </div>
          <div>
            <div className="topnav-club-name">
              {d?.userTeam.name ?? props.clubName}
            </div>
            <div className="topnav-club-record">
              {standing
                ? `${standing.wins}–${standing.losses}–${standing.overtimeLosses} · ${standing.points} pts`
                : '—'}
            </div>
          </div>
        </div>

        {/* Date + phase + next game (center) */}
        <div className="topnav-date">
          <span className="topnav-date-main">{d ? fmtDate(d.date) : '—'}</span>
          <div className="topnav-date-sub">
            {d && <span>{d.year} season</span>}
            {d && <span className={PHASE_CHIP[d.phase]}>{PHASE_LABEL[d.phase]}</span>}
          </div>
          {next && (
            <div className="topnav-next">
              <span>Next:</span>
              <strong>{next.home ? 'vs' : '@'} {next.opponentName}</strong>
              <span className="chip" style={{ fontSize: 10 }}>#{next.opponentRank}</span>
              <span>{fmtDate(next.date)}</span>
            </div>
          )}
        </div>

        {/* Actions right cluster */}
        <div className="topnav-actions">
          <button
            className="topnav-util-btn"
            onClick={props.onSave}
            disabled={props.busy}
            title="Save career"
          >
            Save
          </button>
          <button
            className="topnav-util-btn"
            onClick={props.onLoad}
            disabled={props.busy}
            title="Load career"
          >
            Load
          </button>

          <div className="sim-secondary">
            <button
              className="btn"
              onClick={() => actions.advanceDays(1)}
              disabled={actions.busy}
              title="Simulate 1 day"
            >
              Sim day
            </button>
            <button
              className="btn"
              onClick={() => actions.advanceDays(7)}
              disabled={actions.busy}
              title="Simulate 7 days"
            >
              +7d
            </button>
            <button
              className="btn"
              onClick={actions.toNextGame}
              disabled={actions.busy}
              title="Advance to next fixture"
            >
              To game
            </button>
            {next && (
              <button
                className="btn"
                onClick={actions.watchNext}
                disabled={actions.busy}
                title="Watch next game in full viewer"
              >
                Watch
              </button>
            )}
          </div>

          <button
            className="topnav-util-btn"
            onClick={() => nav.navigate('settings')}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>

          <button
            className="btn btn-hero btn-lg"
            onClick={actions.continueGame}
            disabled={actions.busy}
          >
            {actions.busy ? '…' : (d?.continueLabel ?? 'Continue')}
          </button>
        </div>
      </div>

      {/* ── Row 2: section tabs ── */}
      <nav className="topnav-row2">
        {sections.map((section) => (
          <button
            key={section.id}
            className={activeSection === section.id ? 'topnav-section active' : 'topnav-section'}
            onClick={() => nav.navigate(section.defaultScreen)}
          >
            {section.label}
            {section.id === 'news' && unread > 0 && (
              <span className="badge">{unread}</span>
            )}
          </button>
        ))}

        {/* Contextual items not in main sections */}
        <div className="topnav-sep" />
        <button
          className={nav.screen === 'matchcenter' ? 'topnav-section active' : 'topnav-section'}
          onClick={() => nav.navigate('matchcenter')}
        >
          Match
        </button>
        <button
          className={nav.screen === 'calendar' ? 'topnav-section active' : 'topnav-section'}
          onClick={() => nav.navigate('calendar')}
        >
          Calendar
        </button>
        <button
          className={nav.screen === 'trades' ? 'topnav-section active' : 'topnav-section'}
          onClick={() => nav.navigate('trades')}
        >
          Trades
        </button>

        <span
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            fontSize: 10,
            color: 'var(--muted)',
            opacity: 0.5,
            paddingRight: 4,
          }}
        >
          v{props.engineVersion}
        </span>
      </nav>

      {/* ── Row 3: sub-tabs for active section ── */}
      {currentSection.subTabs.length > 1 && (
        <nav className="topnav-row3">
          {currentSection.subTabs.map((tab) => (
            <button
              key={tab.id}
              className={nav.screen === tab.id ? 'topnav-item active' : 'topnav-item'}
              onClick={() => nav.navigate(tab.id)}
            >
              {tab.label}
              {tab.badge !== undefined && (
                <span className="badge">{tab.badge}</span>
              )}
            </button>
          ))}
        </nav>
      )}
    </header>
  )
}
