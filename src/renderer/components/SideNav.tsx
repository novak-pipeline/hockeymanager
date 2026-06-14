import type { DashboardView } from '../../worker/protocol'
import { useNav } from './NavContext'
import { buildNav } from './navConfig'
import { NavIcon } from './NavIcon'

/**
 * FM-style left sidebar: a flat, labelled list of every top-level destination.
 * Clicking opens that destination's primary screen; sub-views appear as page
 * tabs (see <SubTabBar>). The active item is the one whose `match` includes the
 * current screen.
 */
export function SideNav(props: { dashboard: DashboardView | null }): JSX.Element {
  const nav = useNav()
  const phase = props.dashboard?.phase ?? 'regularSeason'
  const unread = props.dashboard?.unreadNews ?? 0
  const items = buildNav(phase)

  return (
    <nav className="sidebar">
      <div className="sidebar-scroll">
        {items.map((item, i) => {
          const active = item.match.includes(nav.screen)
          const newSection = i > 0 && items[i - 1]!.section !== item.section
          return (
            <div key={item.id}>
              {newSection && <div className="sidebar-divider" />}
              <button
                className={active ? 'sidebar-item active' : 'sidebar-item'}
                onClick={() => nav.navigate(item.screen)}
                title={item.label}
              >
                <NavIcon name={item.icon} />
                <span className="sidebar-label">{item.label}</span>
                {item.badge === 'unread' && unread > 0 && (
                  <span className="sidebar-badge">{unread > 9 ? '9+' : unread}</span>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
