import type { DashboardView } from '../../worker/protocol'
import { useNav, sectionOf } from './NavContext'
import { buildSections, STANDALONE } from './navConfig'
import { NavIcon } from './NavIcon'

/**
 * FM-style icon rail. Each top-level section + standalone destination is a single
 * icon button (label on hover) that jumps to its default screen. Sub-screens are
 * NOT here — they appear as tabs on the page (see <SubTabBar>).
 */
export function SideNav(props: { dashboard: DashboardView | null }): JSX.Element {
  const nav = useNav()
  const phase = props.dashboard?.phase ?? 'regularSeason'
  const unread = props.dashboard?.unreadNews ?? 0
  const sections = buildSections(phase)
  const activeSection = sectionOf(nav.screen)

  return (
    <nav className="rail">
      <div className="rail-scroll">
        {sections.map((s) => (
          <button
            key={s.id}
            className={activeSection === s.id ? 'rail-btn active' : 'rail-btn'}
            onClick={() => nav.navigate(s.defaultScreen)}
            title={s.label}
            aria-label={s.label}
          >
            <NavIcon name={s.icon} />
            {s.id === 'news' && unread > 0 && <span className="rail-badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
        ))}

        <div className="rail-divider" />

        {STANDALONE.map((item) => (
          <button
            key={item.id}
            className={nav.screen === item.id ? 'rail-btn active' : 'rail-btn'}
            onClick={() => nav.navigate(item.id)}
            title={item.label}
            aria-label={item.label}
          >
            <NavIcon name={item.icon} />
          </button>
        ))}
      </div>
    </nav>
  )
}
