/**
 * Renderer-side helpers for the broadcast package's pregame context.
 *
 * The real context comes from the worker (`getBroadcastContext`, built by the
 * career BEFORE the sim ran). When it can't be had — an old worker, a dev
 * harness, a failed request — the match still gets a clean broadcast from the
 * data MatchViewer already holds: names, sides, colours. No storylines are ever
 * invented here: a fallback context carries none.
 */
import type { BroadcastContext, BroadcastPlayer } from '@engine/story/broadcastStorylines'
import type { WatchedGame } from '../../worker/protocol'

export function fallbackBroadcastContext(game: WatchedGame): BroadcastContext {
  const homeIds = new Set(game.homePlayerIds)
  const players: Record<string, BroadcastPlayer> = {}
  for (const [id, name] of Object.entries(game.playerNames)) {
    players[id] = {
      id, name, side: homeIds.has(id) ? 'home' : 'away', position: '',
      seasonLine: '', seasonGoals: 0, seasonAssists: 0,
    }
  }
  // Starting goalies are whoever appears as a goalie in the first frame.
  let hg: string | null = null
  let ag: string | null = null
  for (const ev of game.stream) {
    if (ev.type === 'frame') { hg = ev.homeGoalie.player; ag = ev.awayGoalie.player; break }
  }
  for (const g of [hg, ag]) if (g && players[g]) players[g].position = 'G'
  return {
    gameKey: `watch:${game.homeAbbr}:${game.awayAbbr}:${game.stream.length}`,
    year: 0,
    playoff: false,
    arenaName: null,
    homeTeamId: game.homeAbbr,
    awayTeamId: game.awayAbbr,
    homeName: game.homeName,
    awayName: game.awayName,
    homeAbbr: game.homeAbbr,
    awayAbbr: game.awayAbbr,
    homeColors: game.homeColors,
    awayColors: game.awayColors,
    home: { starters: hg ? [hg] : [], goalieId: hg, record: '' },
    away: { starters: ag ? [ag] : [], goalieId: ag, record: '' },
    players,
    storylines: [],
  }
}

/** Minutes:seconds left in a power play window at `absT`. */
export function ppRemaining(toAbsT: number, absT: number): string {
  const s = Math.max(0, Math.ceil(toAbsT - absT))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
