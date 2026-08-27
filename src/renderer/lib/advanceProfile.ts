/**
 * advanceProfile.ts — where a day-advance actually spends its time.
 *
 * "The postgame screen is slow to load" is a symptom with at least four
 * candidate causes: the match-day preview probe, the inbox snapshot taken to
 * diff against, the sim itself, and the four view fetches that follow it. Each
 * is a worker round trip and none of them is visible from the outside, so this
 * turns the advance into a labelled timeline instead of a guess.
 *
 * Off by default — an advance is a hot path and must not pay for a console line
 * nobody asked for. Turn it on for a session with:
 *   localStorage.setItem('hockey.perf.advance', 'true')
 *
 * Output is one grouped line per advance, e.g.
 *   [advance] 2140ms (postgame) — matchDayPreview 31 · inboxBefore 44 ·
 *             continueGame 1904 · views 161
 */

const LS_KEY = 'hockey.perf.advance'

export interface AdvanceProfiler {
  /** Record the time since the previous mark under `label`. */
  mark(label: string): void
  /** Close the timeline and log it. `postgame` tags advances that played a user game. */
  done(postgame: boolean): void
}

const NOOP: AdvanceProfiler = { mark: () => {}, done: () => {} }

function enabled(): boolean {
  try { return localStorage.getItem(LS_KEY) === 'true' } catch { return false }
}

export function advanceProfiler(): AdvanceProfiler {
  if (!enabled()) return NOOP
  const t0 = performance.now()
  let last = t0
  const parts: string[] = []
  return {
    mark(label: string): void {
      const now = performance.now()
      parts.push(`${label} ${Math.round(now - last)}`)
      last = now
    },
    done(postgame: boolean): void {
      const total = Math.round(performance.now() - t0)
      console.info(`[advance] ${total}ms (${postgame ? 'postgame' : 'no game'}) — ${parts.join(' · ')}`)
    },
  }
}
