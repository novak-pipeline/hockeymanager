/**
 * Season bio write-up — the narrative paragraph at the top of a scouting report
 * that recaps what a player actually DID this season (production, how it stacks
 * up against expectations and the rest of his league, junior tournaments). Reads
 * present-tense in-season and past-tense at the final / offseason report, the way
 * real draft-guide write-ups read after the year is in the books.
 *
 * Pure: deterministic from the supplied stat line. No RNG, no Player access.
 */

export interface SeasonBioArgs {
  firstName: string
  position: string
  age: number
  teamName: string
  /** League display name or abbreviation, e.g. "J20 Nationell" / "SHL". */
  league: string
  gamesPlayed: number
  goals: number
  assists: number
  /** Expected points for his ability/role over a full season, if known. */
  expectedPoints?: number
  /** 1-based rank in points among his league's skaters (1 = leads the league). */
  leagueScoringRank?: number
  /** Senior international appearances (proxy for "represented his country"). */
  intlApps?: number
  nation?: string
  /** True once the season is in the books (final ranking / offseason). */
  final: boolean
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!)
}

/**
 * Builds the bio paragraph. Returns null when there's nothing to say yet
 * (no games played).
 */
export function buildSeasonBio(a: SeasonBioArgs): string | null {
  if (a.gamesPlayed <= 0) return null
  const isG = a.position === 'G'
  const points = a.goals + a.assists
  const past = a.final
  const sentences: string[] = []

  if (isG) {
    // Goalies: we don't thread W/L/SV% here — keep it about workload + role.
    const verb = past ? 'appeared in' : 'has appeared in'
    sentences.push(`${a.firstName} ${verb} ${a.gamesPlayed} game${a.gamesPlayed === 1 ? '' : 's'} for ${a.teamName} in the ${a.league}${past ? ' this season' : ''}.`)
  } else {
    const verb = past ? 'put up' : 'has put up'
    let line = `${a.firstName} ${verb} ${points} point${points === 1 ? '' : 's'} (${a.goals}G, ${a.assists}A) in ${a.gamesPlayed} game${a.gamesPlayed === 1 ? '' : 's'} for ${a.teamName} in the ${a.league}`
    // League standing, when he's near the top.
    if (a.leagueScoringRank !== undefined && a.leagueScoringRank <= 10) {
      line += a.leagueScoringRank === 1
        ? `, leading the league in scoring`
        : `, the ${ordinal(a.leagueScoringRank)}-most points in the league`
    }
    line += '.'
    sentences.push(line)

    // Production vs expectation — only meaningful with enough of a sample.
    if (a.expectedPoints !== undefined && a.gamesPlayed >= 10) {
      const ratio = points / Math.max(1, a.expectedPoints)
      if (ratio >= 1.25) sentences.push(past ? 'It was production well beyond what was expected of him.' : "He's outproducing expectations.")
      else if (ratio <= 0.7) sentences.push(past ? 'The output fell short of what was expected of him.' : "He's running below his expected production.")
    }
  }

  // Junior-eligible international flag.
  if ((a.intlApps ?? 0) > 0 && a.age <= 20 && a.nation) {
    sentences.push(past
      ? `He also represented ${a.nation} on the international stage.`
      : `He has also featured for ${a.nation} internationally.`)
  }

  return sentences.join(' ')
}
