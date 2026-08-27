/**
 * Pre-match opposition scouting report — what an advance scout (assigned to the
 * Next Opponent) files before a game: form, special-teams threat, and the key
 * players to watch. Pure + deterministic; no Rng. Delivered to the inbox.
 */

export interface OppositionReportArgs {
  opponentName: string
  opponentAbbr: string
  scoutName: string
  record: { wins: number; losses: number; otl: number; goalsFor: number; goalsAgainst: number; gamesPlayed: number }
  /** Top scorers to watch, best first. */
  keyPlayers: Array<{ name: string; points: number; goals: number; assists: number }>
  /** Power-play conversion, 0–1. */
  ppPct: number
  /** Penalty-kill success, 0–1. */
  pkPct: number
}

// League baselines for framing (NHL-typical).
const LEAGUE_PP = 0.20
const LEAGUE_PK = 0.80

export function buildOppositionReport(a: OppositionReportArgs): { headline: string; body: string } {
  const { record: r } = a
  const gpd = r.gamesPlayed > 0 ? (r.goalsFor - r.goalsAgainst) / r.gamesPlayed : 0
  const profile =
    gpd >= 0.7 ? 'a high-powered side that wins the special-teams and possession battle'
    : gpd >= 0.2 ? 'a balanced, well-coached group'
    : gpd <= -0.7 ? 'a team you should be able to outscore if you take care of the puck'
    : 'an evenly-matched opponent'

  const ppNote = a.ppPct >= LEAGUE_PP + 0.04
    ? `Their power play is lethal at ${(a.ppPct * 100).toFixed(0)}% — stay out of the box.`
    : a.ppPct <= LEAGUE_PP - 0.04
      ? `Their power play is toothless (${(a.ppPct * 100).toFixed(0)}%) — don't fear the odd penalty.`
      : `Their power play is league-average (${(a.ppPct * 100).toFixed(0)}%).`
  const pkNote = a.pkPct >= LEAGUE_PK + 0.04
    ? `Their penalty kill is stingy (${(a.pkPct * 100).toFixed(0)}%) — move it quickly on the man advantage.`
    : a.pkPct <= LEAGUE_PK - 0.04
      ? `Their penalty kill leaks (${(a.pkPct * 100).toFixed(0)}%) — draw penalties and our PP can punish them.`
      : `Their penalty kill is league-average (${(a.pkPct * 100).toFixed(0)}%).`

  const watch = a.keyPlayers.length > 0
    ? 'Players to watch: ' + a.keyPlayers.map((p) => `${p.name} (${p.points} pts)`).join(', ') + '.'
    : 'No standout producers have separated themselves yet.'

  const body =
    `${a.scoutName} has filed his report ahead of the ${a.opponentName} game. ` +
    `${a.opponentAbbr} are ${r.wins}-${r.losses}-${r.otl} — ${profile}. ` +
    `${watch} ${ppNote} ${pkNote}`

  return { headline: `Opposition report: ${a.opponentName}`, body }
}
