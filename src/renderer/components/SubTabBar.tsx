import type { DashboardView } from '../../worker/protocol'
import { useNav, sectionOf, type ScreenId } from './NavContext'
import { useUserTeamId } from './UserTeamContext'
import { buildSections } from './navConfig'

/** Management sub-tabs that only make sense for your own club. */
const MANAGEMENT: ReadonlySet<string> = new Set([
  'report', 'personnel', 'practice', 'tactics', 'finances', 'teamMedical', 'teamDevelopment', 'teamPlanner',
])

/**
 * Horizontal tab strip for the active section's sub-screens — sits under the
 * topbar (FM puts the page-level tabs here, not in the rail). Hidden for
 * sections with a single screen (News).
 */
export function SubTabBar(props: { dashboard: DashboardView | null }): JSX.Element | null {
  const nav = useNav()
  const userTeamId = useUserTeamId()
  const phase = props.dashboard?.phase ?? 'regularSeason'
  const section = buildSections(phase).find((s) => s.id === sectionOf(nav.screen))
  if (!section || section.subTabs.length <= 1) return null

  const viewedTeamId = nav.params.teamId
  const isViewingOtherTeam =
    section.id === 'team' && viewedTeamId !== undefined && viewedTeamId !== userTeamId

  function go(screenId: ScreenId): void {
    if (isViewingOtherTeam && sectionOf(screenId) === 'team') nav.navigate(screenId, { teamId: viewedTeamId })
    else nav.navigate(screenId)
  }

  return (
    <nav className="subtabbar">
      {section.subTabs.map((tab) => {
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
