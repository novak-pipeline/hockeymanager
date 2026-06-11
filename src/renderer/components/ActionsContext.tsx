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
  /** Play the user's next fixture in the match viewer (full engine). */
  watchNext: () => void
}

export const ActionsContext = createContext<ShellActions | null>(null)

export function useShellActions(): ShellActions {
  const actions = useContext(ActionsContext)
  if (!actions) throw new Error('useShellActions must be used inside <ActionsContext.Provider>')
  return actions
}
