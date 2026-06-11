import type { DashboardView } from '../../worker/protocol'
import { useNav, type ScreenId } from './NavContext'
import { crestColor } from './format'

interface NavEntry {
  id: ScreenId
  label: string
  badge?: number
}

/**
 * Left navigation rail. Contextual entries (Playoffs, Draft, Offseason) appear
 * with the career phase; the club header falls back to picker info until the
 * dashboard view loads. Crest is a deterministic placeholder color until real
 * team colors are exposed to the UI.
 */
export function Sidebar(props: {
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
  const d = props.dashboard
  const standing = d?.userTeam.standing ?? null
  const phase = d?.phase ?? 'regularSeason'
  const unread = d?.unreadNews ?? 0

  const items: NavEntry[] = [
    { id: 'inbox', label: 'Inbox', ...(unread > 0 ? { badge: unread } : {}) },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'squad', label: 'Squad' },
    { id: 'tactics', label: 'Tactics' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'standings', label: 'Standings' },
    { id: 'stats', label: 'Stats' },
    { id: 'trades', label: 'Trades' },
    { id: 'finances', label: 'Finances' },
  ]
  const contextual: NavEntry[] = [
    ...(phase === 'playoffs' ? [{ id: 'playoffs', label: 'Playoffs' } as NavEntry] : []),
    ...(phase === 'offseason'
      ? [{ id: 'draft', label: 'Draft' } as NavEntry, { id: 'offseason', label: 'Offseason' } as NavEntry]
      : []),
    { id: 'matchcenter', label: 'Match Center' },
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar-club">
        <div className="crest" style={{ background: crestColor(props.teamId) }}>
          {props.clubAbbr}
        </div>
        <div>
          <div className="sidebar-club-name">{d?.userTeam.name ?? props.clubName}</div>
          <div className="sidebar-club-record">
            {standing
              ? `${standing.wins}-${standing.losses}-${standing.overtimeLosses} · ${standing.points} pts`
              : '—'}
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {items.map((item) => (
          <NavButton key={item.id} item={item} active={nav.screen === item.id} />
        ))}
        <div className="nav-section">Season</div>
        {contextual.map((item) => (
          <NavButton key={item.id} item={item} active={nav.screen === item.id} />
        ))}
      </nav>

      <div className="sidebar-foot">
        <button className="btn btn-ghost" onClick={props.onSave} disabled={props.busy}>
          Save
        </button>
        <button className="btn btn-ghost" onClick={props.onLoad} disabled={props.busy}>
          Load
        </button>
        <div className="sidebar-foot-meta">engine v{props.engineVersion}</div>
      </div>
    </aside>
  )
}

function NavButton(props: { item: NavEntry; active: boolean }): JSX.Element {
  const nav = useNav()
  return (
    <button
      className={props.active ? 'nav-item active' : 'nav-item'}
      onClick={() => nav.navigate(props.item.id)}
    >
      {props.item.label}
      {props.item.badge !== undefined && <span className="badge">{props.item.badge}</span>}
    </button>
  )
}
