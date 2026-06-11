import { create } from 'zustand'

/**
 * Cross-screen UI bus (zustand).
 *
 * - `version` is the refresh bus: any action that changes world state
 *   (continue/advance/watch-close/mutations) bumps it, and every mounted
 *   `useScreenData` hook refetches. Bump via `bumpRefresh()`.
 * - `toasts` back the global toast stack; push via `toast(message, kind)`.
 *   Both helpers are plain functions so non-component code can call them.
 */

export type ToastKind = 'info' | 'error' | 'success'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

export interface UiStore {
  /** Monotonic refresh counter; screens refetch when it changes. */
  version: number
  bump: () => void
  toasts: ToastItem[]
  pushToast: (message: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
}

const TOAST_LIFETIME_MS = 4_000

let toastId = 0

export const useUiStore = create<UiStore>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
  toasts: [],
  pushToast: (message, kind = 'info') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, TOAST_LIFETIME_MS)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Bump the refresh bus from anywhere (event handlers, async flows). */
export function bumpRefresh(): void {
  useUiStore.getState().bump()
}

/** Show a toast from anywhere; auto-dismisses after a few seconds. */
export function toast(message: string, kind: ToastKind = 'info'): void {
  useUiStore.getState().pushToast(message, kind)
}
