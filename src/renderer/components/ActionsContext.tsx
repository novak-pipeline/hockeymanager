import { createContext, useContext } from 'react'

/**
 * Calendar/match actions the shell exposes to screens (the top bar and the
 * dashboard share the same handlers). All are fire-and-forget; the shell
 * serializes them behind `busy`, toasts errors, and bumps the refresh bus on
 * success so every mounted screen refetches.
 */
export interface ShellActions {
  /** True while any calendar/save action is in flight; disable buttons. */
  busy: boolean
  /** Smart continue to the next meaningful stop. */
  continueGame: () => void
  advanceDays: (days: number) => void
  toNextGame: () => void
  /**
   * Play the user's next fixture with the full engine and open it.
   *
   * `mode` picks the surface, both reading the same GameEvent stream:
   *   'rink' — the 2D/3D match viewer (skaters on the ice).
   *   'sim'  — the live gamecast: play-by-play and a box score filling in.
   * Omitted, it reopens whichever the GM used last.
   */
  watchNext: (mode?: WatchMode) => void
}

/** Which match-night surface to open a watched game on. */
export type WatchMode = 'rink' | 'sim'

export const ActionsContext = createContext<ShellActions | null>(null)

export function useShellActions(): ShellActions {
  const actions = useContext(ActionsContext)
  if (!actions) throw new Error('useShellActions must be used inside <ActionsContext.Provider>')
  return actions
}
