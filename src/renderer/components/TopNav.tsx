import type { DashboardView } from '../../worker/protocol'
import { useShellActions } from './ActionsContext'
import { crestColor, fmtDate } from './format'
import { useNav, type ScreenId } from './NavContext'

interface NavEntry {
  id: ScreenId
  label: string
  badge?: number
}

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

/**
 * FM24-style top navigation bar — replaces the left sidebar.
 * Row 1: club crest + name/record | date + phase + next game | util actions + CONTINUE
 * Row 2: primary nav tabs (horizontal) + contextual tabs
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

  const mainItems: NavEntry[] = [
    { id: 'inbox',     label: 'Inbox',    ...(unread > 0 ? { badge: unread } : {}) },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'squad',     label: 'Squad' },
    { id: 'tactics',   label: 'Tactics' },
    { id: 'schedule',  label: 'Schedule' },
    { id: 'standings', label: 'Standings' },
    { id: 'stats',     label: 'Stats' },
    { id: 'trades',    label: 'Trades' },
    { id: 'finances',  label: 'Finances' },
    { id: 'scouting',  label: 'Scouting' },
    { id: 'history',   label: 'History' },
  ]

  const contextualItems: NavEntry[] = [
    ...(phase === 'playoffs'
      ? [{ id: 'playoffs', label: 'Playoffs' } as NavEntry]
      : []),
    ...(phase === 'offseason'
      ? [
          { id: 'draft',     label: 'Draft' } as NavEntry,
          { id: 'offseason', label: 'Offseason' } as NavEntry,
        ]
      : []),
    { id: 'matchcenter', label: 'Match Center' },
  ]

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
          {/* Save / Load */}
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

          {/* Secondary sim controls */}
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

          {/* Settings gear */}
          <button
            className="topnav-util-btn"
            onClick={() => nav.navigate('settings')}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>

          {/* Hero CONTINUE button */}
          <button
            className="btn btn-hero btn-lg"
            onClick={actions.continueGame}
            disabled={actions.busy}
          >
            {actions.busy ? '…' : (d?.continueLabel ?? 'Continue')}
          </button>
        </div>
      </div>

      {/* ── Row 2: nav tabs ── */}
      <nav className="topnav-row2">
        {mainItems.map((item) => (
          <NavTab key={item.id} item={item} active={nav.screen === item.id} />
        ))}
        {contextualItems.length > 0 && <div className="topnav-sep" />}
        {contextualItems.map((item) => (
          <NavTab key={item.id} item={item} active={nav.screen === item.id} />
        ))}

        {/* Engine version whisper at far right */}
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
    </header>
  )
}

function NavTab(props: { item: NavEntry; active: boolean }): JSX.Element {
  const nav = useNav()
  return (
    <button
      className={props.active ? 'topnav-item active' : 'topnav-item'}
      onClick={() => nav.navigate(props.item.id)}
    >
      {props.item.label}
      {props.item.badge !== undefined && (
        <span className="badge">{props.item.badge}</span>
      )}
    </button>
  )
}
