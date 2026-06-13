/**
 * Provides the user's own teamId (set once at career start, never changes
 * within a session) to any screen that needs to distinguish "my club" from
 * "another club" — e.g. to decide which tabs are read-only.
 */
import { createContext, useContext } from 'react'

export const UserTeamContext = createContext<string>('')

export function useUserTeamId(): string {
  return useContext(UserTeamContext)
}
