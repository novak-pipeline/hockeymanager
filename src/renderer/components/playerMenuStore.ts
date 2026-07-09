import { create } from 'zustand'

/**
 * #187: global player action-menu state. `PlayerLink` (and anywhere a player
 * name is shown) opens this on right-click; a single root-mounted
 * `PlayerActionMenu` reads it and renders the EHM-style context menu at the
 * cursor. One store keeps every name in the app menu-enabled without threading
 * handlers through dozens of components.
 */
export interface PlayerMenuState {
  open: boolean
  playerId: string
  name: string
  /** Anchor position (viewport px). */
  x: number
  y: number
  openMenu: (playerId: string, name: string, x: number, y: number) => void
  close: () => void
}

export const usePlayerMenu = create<PlayerMenuState>((set) => ({
  open: false,
  playerId: '',
  name: '',
  x: 0,
  y: 0,
  openMenu: (playerId, name, x, y) => set({ open: true, playerId, name, x, y }),
  close: () => set({ open: false }),
}))

/** Open the player action menu from a right-click event. */
export function openPlayerMenu(e: { preventDefault: () => void; clientX: number; clientY: number }, playerId: string, name: string): void {
  e.preventDefault()
  usePlayerMenu.getState().openMenu(playerId, name, e.clientX, e.clientY)
}
