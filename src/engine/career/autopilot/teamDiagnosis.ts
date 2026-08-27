/**
 * What is actually wrong with this hockey team?
 *
 * The autopilot's old need-finder looked only at roster DEPTH — "my ninth
 * forward is a 74, so I need forwards". That is a spreadsheet answer. A real GM
 * starts from results: we are conceding three a night, we cannot score on the
 * power play, the goaltending is league-worst. Depth tells you what you own;
 * performance tells you what is costing you games.
 *
 * This module reads the league table and turns it into a ranked, evidenced list
 * of needs. Every need carries the number that justifies it, so the GM's own
 * decision log can say WHY it went shopping — which is also what makes the
 * autopilot's reasoning auditable when it goes wrong.
 */

export type NeedGroup = 'F' | 'D' | 'G'

export interface TeamNeed {
  group: NeedGroup
  /** 0–100. How badly this needs fixing, relative to the rest of the league. */
  urgency: number
  /** The measurement behind it, for the decision log. */
  evidence: string
}

export interface Diagnosis {
  gamesPlayed: number
  goalsForPerGame: number
  goalsAgainstPerGame: number
  /** League rank, 1 = best. */
  offenceRank: number
  defenceRank: number
  teams: number
  needs: TeamNeed[]
  /** One line a GM would actually say about his own club. */
  summary: string
}

interface Row {
  teamId: string
  gamesPlayed: number
  goalsFor: number
  goalsAgainst: number
}

/**
 * Diagnose from the league table. `depth` supplies the roster read (the weakest
 * regular in each group, 0–99) so performance and personnel can be crossed:
 * conceding heavily with thin defence is a defence problem; conceding heavily
 * behind a good blue line points at the goaltender.
 */
export function diagnose(
  rows: readonly Row[],
  userTeamId: string,
  depth: Record<NeedGroup, number>,
): Diagnosis | null {
  const me = rows.find((r) => r.teamId === userTeamId)
  if (!me || me.gamesPlayed < 10) return null // too early to read anything into it

  const perGame = (r: Row): { gf: number; ga: number } => ({
    gf: r.goalsFor / Math.max(1, r.gamesPlayed),
    ga: r.goalsAgainst / Math.max(1, r.gamesPlayed),
  })
  const mine = perGame(me)
  const played = rows.filter((r) => r.gamesPlayed >= 10)
  const teams = Math.max(1, played.length)

  // Rank 1 = best (most goals for / fewest against).
  const offenceRank = 1 + played.filter((r) => perGame(r).gf > mine.gf).length
  const defenceRank = 1 + played.filter((r) => perGame(r).ga < mine.ga).length

  // Percentile of badness, 0 (best in league) → 100 (worst).
  const pct = (rank: number): number => Math.round(((rank - 1) / Math.max(1, teams - 1)) * 100)
  const offBad = pct(offenceRank)
  const defBad = pct(defenceRank)

  const needs: TeamNeed[] = []

  if (offBad >= 40) {
    needs.push({
      group: 'F',
      urgency: offBad,
      evidence: `${mine.gf.toFixed(2)} goals/game, ${offenceRank}th of ${teams}`,
    })
  }

  // A leaky defence is either the blue line or the net. Cross it with depth: if
  // the defence corps is respectable and we still concede, buy a goalie.
  if (defBad >= 40) {
    const blueLineThin = depth.D < 78
    const goalieThin = depth.G < 80
    if (goalieThin && !blueLineThin) {
      needs.push({
        group: 'G',
        urgency: defBad + 5,
        evidence: `${mine.ga.toFixed(2)} against/game (${defenceRank}th of ${teams}) behind a passable blue line — that is the net`,
      })
    } else {
      needs.push({
        group: 'D',
        urgency: defBad,
        evidence: `${mine.ga.toFixed(2)} against/game, ${defenceRank}th of ${teams}`,
      })
      if (goalieThin) {
        needs.push({ group: 'G', urgency: defBad - 10, evidence: `starter grades ${depth.G} — no better than the defence in front of him` })
      }
    }
  }

  // Nothing is bleeding: fall back to the thinnest position group, but at low
  // urgency. A club with no problem should not be making desperate trades.
  if (needs.length === 0) {
    const thinnest = (['F', 'D', 'G'] as NeedGroup[]).sort((a, b) => depth[a] - depth[b])[0]!
    needs.push({ group: thinnest, urgency: 25, evidence: `no glaring hole; thinnest group is ${thinnest} at ${depth[thinnest]}` })
  }

  needs.sort((a, b) => b.urgency - a.urgency)

  const summary =
    offBad >= 60 && defBad >= 60 ? `bad at both ends — ${offenceRank}th scoring, ${defenceRank}th defending`
      : offBad >= 60 ? `cannot score — ${mine.gf.toFixed(2)}/game, ${offenceRank}th of ${teams}`
        : defBad >= 60 ? `cannot defend — ${mine.ga.toFixed(2)} against/game, ${defenceRank}th of ${teams}`
          : `respectable at both ends (${offenceRank}th scoring, ${defenceRank}th defending)`

  return {
    gamesPlayed: me.gamesPlayed,
    goalsForPerGame: mine.gf,
    goalsAgainstPerGame: mine.ga,
    offenceRank,
    defenceRank,
    teams,
    needs,
    summary,
  }
}
