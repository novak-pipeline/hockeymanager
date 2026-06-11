import { createContext, useContext } from 'react'

/**
 * Screen routing — a plain state machine, no router lib. App owns the nav
 * state and provides this context; screens call `navigate`. Player names
 * anywhere in the UI must be clickable via <PlayerLink> so every roster,
 * leaderboard and news item can jump to the player profile.
 */

export type ScreenId =
  | 'inbox'
  | 'dashboard'
  | 'squad'
  | 'player'
  | 'tactics'
  | 'schedule'
  | 'standings'
  | 'stats'
  | 'trades'
  | 'finances'
  | 'scouting'
  | 'draft'
  | 'offseason'
  | 'playoffs'
  | 'matchcenter'

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
