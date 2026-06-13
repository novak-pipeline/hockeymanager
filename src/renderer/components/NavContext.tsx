import { createContext, useContext } from 'react'

/**
 * Screen routing — a plain state machine, no router lib. App owns the nav
 * state and provides this context; screens call `navigate`. Player names
 * anywhere in the UI must be clickable via <PlayerLink> so every roster,
 * leaderboard and news item can jump to the player profile.
 *
 * v2: EHM four-section IA — sections (frontOffice / news / team / league) each
 * own a set of sub-tabs. `navigate(screenId)` still works from anywhere.
 * Player profile is always reachable as an overlay route.
 */

export type ScreenId =
  // Front Office section
  | 'dashboard'
  | 'board'
  // News section
  | 'inbox'
  // Team section
  | 'squad'
  | 'teamStats'
  | 'report'
  | 'personnel'
  | 'practice'
  | 'tactics'
  | 'finances'
  | 'teamInfo'
  | 'teamHistory'
  // League section
  | 'leagueOverview'
  | 'standings'
  | 'leagueSchedule'
  | 'stats'
  | 'leagueTeamStats'
  | 'leagueTransactions'
  | 'leagueScoreboard'
  | 'leagueHistory'
  | 'scouting'
  // Contextual (phase-gated)
  | 'draft'
  | 'offseason'
  | 'playoffs'
  // Shared / overlay
  | 'player'
  | 'matchcenter'
  | 'trades'
  | 'lockerRoom'
  | 'calendar'
  | 'settings'
  // Legacy aliases kept for backward compat (redirect to new equivalents)
  | 'schedule'
  | 'history'

/** Which top-level section a screen belongs to (drives TopNav highlight). */
export type SectionId = 'frontOffice' | 'news' | 'team' | 'league'

export function sectionOf(screen: ScreenId): SectionId {
  switch (screen) {
    case 'inbox':
      return 'news'
    case 'squad':
    case 'teamStats':
    case 'report':
    case 'personnel':
    case 'practice':
    case 'tactics':
    case 'finances':
    case 'teamInfo':
    case 'teamHistory':
      return 'team'
    case 'leagueOverview':
    case 'standings':
    case 'leagueSchedule':
    case 'stats':
    case 'leagueTeamStats':
    case 'leagueTransactions':
    case 'leagueScoreboard':
    case 'leagueHistory':
    case 'scouting':
    case 'draft':
    case 'offseason':
    case 'playoffs':
      return 'league'
    case 'board':
      return 'frontOffice'
    default:
      return 'frontOffice'
  }
}

export interface NavParams {
  playerId?: string
}

export interface NavApi {
  screen: ScreenId
  params: NavParams
  navigate: (screen: ScreenId, params?: NavParams) => void
}

export const NavContext = createContext<NavApi | null>(null)

export function useNav(): NavApi {
  const nav = useContext(NavContext)
  if (!nav) throw new Error('useNav must be used inside <NavContext.Provider>')
  return nav
}

/** Clickable player name → player profile screen. */
export function PlayerLink(props: {
  playerId: string
  name: string
  className?: string
}): JSX.Element {
  const nav = useNav()
  return (
    <button
      type="button"
      className={props.className ? `player-link ${props.className}` : 'player-link'}
      onClick={() => nav.navigate('player', { playerId: props.playerId })}
    >
      {props.name}
    </button>
  )
}
