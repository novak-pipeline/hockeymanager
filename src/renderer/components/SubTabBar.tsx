import type { DashboardView } from '../../worker/protocol'
import { useNav, sectionOf, type ScreenId } from './NavContext'
import { useUserTeamId } from './UserTeamContext'
import { buildNav } from './navConfig'

/** Management sub-tabs that only make sense for your own club. */
const MANAGEMENT: ReadonlySet<string> = new Set([
  'report', 'personnel', 'practice', 'tactics', 'finances', 'teamMedical', 'teamDevelopment', 'teamPlanner',
])

/**
 * Page-level tab strip under the topbar for the active sidebar destination's
 * sub-views (FM puts these here, not in the sidebar). Hidden when the active
 * destination has one screen.
 */
export function SubTabBar(props: { dashboard: DashboardView | null }): JSX.Element | null {
  const nav = useNav()
  const userTeamId = useUserTeamId()
  const phase = props.dashboard?.phase ?? 'regularSeason'
  const item = buildNav(phase).find((i) => i.match.includes(nav.screen))
  if (!item || !item.subTabs || item.subTabs.length <= 1) return null

  const viewedTeamId = nav.params.teamId
  const isViewingOtherTeam =
    sectionOf(nav.screen) === 'team' && viewedTeamId !== undefined && viewedTeamId !== userTeamId

  function go(screenId: ScreenId): void {
    if (isViewingOtherTeam && sectionOf(screenId) === 'team') nav.navigate(screenId, { teamId: viewedTeamId })
    else nav.navigate(screenId)
  }

  return (
    <nav className="subtabbar">
      {item.subTabs.map((tab) => {
        const disabled = isViewingOtherTeam && MANAGEMENT.has(tab.id)
        return (
          <button
            key={tab.id}
            className={nav.screen === tab.id ? 'subtab active' : 'subtab'}
            onClick={() => go(tab.id)}
            disabled={disabled}
            title={disabled ? 'Only available for your own club' : undefined}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
