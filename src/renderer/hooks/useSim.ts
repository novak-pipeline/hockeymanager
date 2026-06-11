import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { SimClient } from '../../worker/client'
import type { WorkerResponse } from '../../worker/protocol'
import { useUiStore } from '../components/store'

/**
 * Sim access for screens. App owns the single SimClient and provides it here;
 * screens combine `useClient()` with `useScreenData()` for fetching.
 */

export const SimContext = createContext<SimClient | null>(null)

export function useClient(): SimClient {
  const client = useContext(SimContext)
  if (!client) throw new Error('useClient must be used inside <SimContext.Provider>')
  return client
}

export interface ScreenData<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Screen data fetcher. Runs `fetch` on mount, again whenever the global
 * refresh bus bumps (see components/store.ts), and on `refetch()`.
 *
 * - `{ type: 'error' }` responses become the `error` state (amber notice in
 *   screens) — they never throw.
 * - `pick` extracts the screen's view from a successful response; returning
 *   null yields an empty (not error) state, e.g. playoffs before they start.
 * - Previous data is kept while a refresh is in flight to avoid flicker;
 *   stale responses from superseded requests are dropped.
 *
 * The latest `fetch`/`pick` closures are kept in refs, so inline arrows are
 * fine — but a fetch whose inputs change (e.g. a playerId) must be remounted
 * to refire; App keys PlayerProfileScreen by playerId for exactly this.
 */
export function useScreenData<T>(
  fetch: () => Promise<WorkerResponse>,
  pick: (r: WorkerResponse) => T | null
): ScreenData<T> {
  const version = useUiStore((s) => s.version)
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  })

  const fetchRef = useRef(fetch)
  fetchRef.current = fetch
  const pickRef = useRef(pick)
  pickRef.current = pick
  const seqRef = useRef(0)

  useEffect(() => {
    const seq = ++seqRef.current
    setState((s) => ({ ...s, loading: true }))
    fetchRef
      .current()
      .then((res) => {
        if (seq !== seqRef.current) return
        if (res.type === 'error') setState((s) => ({ ...s, loading: false, error: res.message }))
        else setState({ data: pickRef.current(res), loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        const message = err instanceof Error ? err.message : String(err)
        setState((s) => ({ ...s, loading: false, error: message }))
      })
    return () => {
      // Unmount (or re-run) supersedes this request.
      if (seq === seqRef.current) seqRef.current++
    }
  }, [version, tick])

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  return { data: state.data, loading: state.loading, error: state.error, refetch }
}
