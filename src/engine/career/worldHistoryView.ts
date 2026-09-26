/**
 * World history view (World Renewal). A NEW view type, deliberately kept out of
 * the frozen views.ts: served by the additive `getWorldHistory` worker request.
 * Champions + awards per league, the Memorial Cup, and every international
 * tournament (medals, final, MVP, all-stars, leaders, your players on show).
 */
import type { Competition, IntlEventRecord, IntlPlayerLine, WorldHistory, WorldRecordEntry, WorldSeasonRecord } from '@domain'

export interface WorldLeagueHistoryView {
  competitionId: string
  abbrev: string
  name: string
  nation: string
  trophy: string
  /** Newest first. */
  seasons: WorldSeasonRecord[]
  /** Clubs by titles won in this save, most first. */
  titles: Array<{ name: string; titles: number; lastYear: number }>
  records: { points?: WorldRecordEntry; goals?: WorldRecordEntry }
}

export interface IntlEventView extends Omit<IntlEventRecord, 'rosters' | 'lines'> {
  /** Your org's players at the tournament with their lines. */
  yours: IntlPlayerLine[]
  /** Nations in the field. */
  field: string[]
}

export interface WorldHistoryView {
  year: number
  /** Leagues with at least one season on file, strongest-first order not
   *  implied (the World tab sorts by its own strength ranking). */
  leagues: WorldLeagueHistoryView[]
  memorialCup: WorldSeasonRecord[]
  /** The most recent season's champions across the world (for the headline strip). */
  latestChampions: WorldSeasonRecord[]
  /** Newest first. */
  international: IntlEventView[]
}

export function buildWorldHistoryView(args: {
  history: WorldHistory
  competitions: Competition[]
  year: number
  yourPlayerIds: Set<string>
}): WorldHistoryView {
  const { history } = args
  const leagues: WorldLeagueHistoryView[] = []
  for (const c of args.competitions) {
    const seasons = history.seasons.filter((s) => s.competitionId === c.id).sort((a, b) => b.year - a.year)
    if (seasons.length === 0) continue
    const tally = new Map<string, { titles: number; lastYear: number }>()
    for (const s of seasons) {
      if (!s.championName) continue
      const t = tally.get(s.championName) ?? { titles: 0, lastYear: s.year }
      t.titles++
      t.lastYear = Math.max(t.lastYear, s.year)
      tally.set(s.championName, t)
    }
    leagues.push({
      competitionId: c.id,
      abbrev: c.abbrev,
      name: c.name,
      nation: c.nation,
      trophy: seasons[0]!.trophy,
      seasons,
      titles: [...tally.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.titles - a.titles || b.lastYear - a.lastYear),
      records: history.records.find(([id]) => id === c.id)?.[1] ?? {},
    })
  }
  const memorialCup = history.seasons.filter((s) => s.competitionId === 'memorial-cup').sort((a, b) => b.year - a.year)
  const lastYear = history.seasons.reduce((m, s) => Math.max(m, s.year), -Infinity)
  const latestChampions = history.seasons.filter((s) => s.year === lastYear)
  const international = [...history.international]
    .sort((a, b) => b.year - a.year || a.kind.localeCompare(b.kind))
    .map((e): IntlEventView => {
      const { rosters, lines, ...rest } = e
      const yours = (lines ?? [...e.leaders, ...e.allStars])
        .filter((l, i, arr) => args.yourPlayerIds.has(l.playerId) && arr.findIndex((x) => x.playerId === l.playerId) === i)
        .sort((a, b) => (b.g + b.a) - (a.g + a.a))
      return { ...rest, yours, field: rosters.map(([n]) => n) }
    })
  return { year: args.year, leagues, memorialCup, latestChampions, international }
}
