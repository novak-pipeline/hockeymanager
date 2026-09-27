/**
 * Which engine plays the user's games — an app preference (Settings → Match
 * engine), sent to the worker at startup and on change.
 *   classic — the calibrated director engine (default)
 *   agent   — the new agent engine (beta): players read the play, real contact
 */
export type MatchEngine = 'classic' | 'agent'

const LS_KEY = 'hockey.matchEngine'

export function getMatchEngine(): MatchEngine {
  try {
    return localStorage.getItem(LS_KEY) === 'agent' ? 'agent' : 'classic'
  } catch {
    return 'classic'
  }
}

export function setMatchEngine(engine: MatchEngine): void {
  try {
    localStorage.setItem(LS_KEY, engine)
  } catch {
    /* storage blocked: the choice lasts this session */
  }
}
