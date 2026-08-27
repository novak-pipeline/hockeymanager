/**
 * Whole-database player search — the scouting department's own query tool (C3).
 *
 * The Players tab used to be a pre-answered list: "Acquisition Targets", already
 * ranked by value, waiting on turn one. That is the game doing the GM's job. This
 * replaces it with a tool the GM DRIVES: filter the entire world by age, position,
 * league, nation, handedness, contract status, salary, production and read
 * quality, and sort by whatever you care about.
 *
 * The hard rule is that a search cannot see through fog. Every ability number a
 * row carries is your DEPARTMENT'S read of the player, and a player nobody has
 * watched returns `null` stars and an "Unscouted" label — not a plausible-looking
 * grade. Public facts (name, age, position, club, league, handedness, salary,
 * contract length, this season's scoresheet) are never fogged, because none of
 * them require a scout: they're on the back of the hockey card.
 *
 * Pure and deterministic — no RNG, no wall clock.
 */
import type { Player, PlayerId, Team, TeamId } from '@domain'
import type { ScoutingState } from '@domain/scouting'
import { knowledgeOf, accuracyOf, SCOUT_SEEN_THRESHOLD } from '@engine/league/scouting'
import { ratedOverall, overallToStars } from '@engine/ratings/composites'
import { scoutedCeilingK } from './buildViews'
import { playerValue } from '@engine/league/trades'
import type {
  PlayerSearchQuery, PlayerSearchRow, PlayerSearchView, PlayerSearchFacets,
} from './views'

/** Contract situations the search can filter on. */
export type ContractBucket = 'signed' | 'expiring' | 'freeAgent' | 'unsigned'

/** How much of a read the department has, in words. Drives what a row may show. */
export function readBandOf(knowledge: number): PlayerSearchRow['read'] {
  if (knowledge >= 95) return 'exact'
  if (knowledge >= 70) return 'strong'
  if (knowledge >= SCOUT_SEEN_THRESHOLD) return 'partial'
  if (knowledge >= 12) return 'glimpse'
  return 'unscouted'
}

const READ_LABEL: Record<PlayerSearchRow['read'], string> = {
  exact: 'Known',
  strong: 'Strong read',
  partial: 'Partial read',
  glimpse: 'Name only',
  unscouted: 'Unscouted',
}

/** Public label for a player's contract situation. */
function contractLabelOf(p: Player, rostered: boolean): { bucket: ContractBucket; label: string } {
  if (!rostered) {
    // Off every roster: either a free agent with no deal, or an unsigned amateur.
    return p.age <= 21
      ? { bucket: 'unsigned', label: 'Unsigned' }
      : { bucket: 'freeAgent', label: 'Free agent' }
  }
  const yrs = p.contract.yearsRemaining
  if (yrs <= 0) return { bucket: 'expiring', label: 'Expiring' }
  if (yrs === 1) return { bucket: 'expiring', label: '1 yr left' }
  return { bucket: 'signed', label: `${yrs} yrs left` }
}

/** Position group used by the position filter chips. */
function inPositionFilter(pos: string, wanted: readonly string[]): boolean {
  if (wanted.length === 0) return true
  const isG = pos === 'G'
  const isD = pos === 'D' || pos === 'LD' || pos === 'RD'
  for (const w of wanted) {
    if (w === pos) return true
    if (w === 'D' && isD) return true
    if (w === 'F' && !isG && !isD) return true
    if (w === 'W' && (pos === 'LW' || pos === 'RW')) return true
  }
  return false
}

/** This season's line for the production columns (public information). */
function seasonLine(p: Player): { gp: number; goals: number; assists: number; points: number } {
  const s = p.stats[p.stats.length - 1]
  if (!s) return { gp: 0, goals: 0, assists: 0, points: 0 }
  const goals = s.ev.goals + s.pp.goals + s.pk.goals
  const assists = s.ev.assists + s.pp.assists + s.pk.assists
  return { gp: s.gamesPlayed, goals, assists, points: goals + assists }
}

export interface PlayerSearchCtx {
  players: Map<PlayerId, Player>
  teams: Map<TeamId, Team>
  scouting: ScoutingState
  /** Competition membership: teamId → { id, abbrev, name, nation }. */
  leagueOfTeam: Map<string, { id: string; abbrev: string; name: string; nation: string }>
  /** Current-class draft-eligible prospect ids. */
  draftProspectIds: Set<string>
  /** The user org's player ids (never fogged, and excludable). */
  ownIds: Set<string>
  /** Live season stats the career keeps outside `p.stats` mid-season, if any. */
  liveLine?: (pid: string) => { gp: number; goals: number; assists: number; points: number } | undefined
}

/** Default page size — enough to scroll, small enough to keep the payload sane. */
export const SEARCH_PAGE = 60

/**
 * Run one search. Two passes: filter + sort over the whole world on cheap fields,
 * then build the expensive per-row extras (asset value) for the page slice only.
 */
export function searchPlayers(ctx: PlayerSearchCtx, q: PlayerSearchQuery): PlayerSearchView {
  const { players, teams, scouting } = ctx

  // teamId per player, from the rosters (a player on no roster is a free agent).
  const teamOf = new Map<string, Team>()
  for (const t of teams.values()) for (const id of t.roster) teamOf.set(id as string, t)

  const text = (q.text ?? '').trim().toLowerCase()
  const positions = q.positions ?? []
  const nations = new Set(q.nations ?? [])
  const leagues = new Set(q.leagueIds ?? [])
  const contracts = new Set(q.contracts ?? [])

  type Cand = {
    p: Player; pid: string; team: Team | undefined
    league: { id: string; abbrev: string; name: string; nation: string } | undefined
    k: number; acc: number
    cur: number | null; pot: number | null
    read: PlayerSearchRow['read']
    line: { gp: number; goals: number; assists: number; points: number }
    contract: { bucket: ContractBucket; label: string }
  }
  const cands: Cand[] = []
  let scoutedCount = 0

  const facetNations = new Set<string>()
  const facetLeagues = new Map<string, string>()

  for (const [pidRaw, p] of players) {
    const pid = pidRaw as string
    if (p.nationality) facetNations.add(p.nationality)
    const team = teamOf.get(pid)
    const league = team ? ctx.leagueOfTeam.get(team.id as string) : undefined
    if (league) facetLeagues.set(league.id, league.abbrev)

    const own = ctx.ownIds.has(pid)
    if (q.excludeOwn && own) continue
    if (text && !p.name.toLowerCase().includes(text)) continue
    if (!inPositionFilter(p.position as string, positions)) continue
    if (q.ageMin !== undefined && p.age < q.ageMin) continue
    if (q.ageMax !== undefined && p.age > q.ageMax) continue
    if (nations.size && !(p.nationality && nations.has(p.nationality))) continue
    if (leagues.size && !(league && leagues.has(league.id))) continue
    if (q.handedness && p.handedness !== q.handedness) continue
    if (q.draftEligibleOnly && !ctx.draftProspectIds.has(pid)) continue

    const contract = contractLabelOf(p, !!team)
    if (contracts.size && !contracts.has(contract.bucket)) continue
    if (q.maxSalary !== undefined && p.contract.salary > q.maxSalary) continue

    const k = own ? 100 : knowledgeOf(scouting, pid)
    const acc = own ? 1 : accuracyOf(scouting, pid)
    const read = own ? 'exact' : readBandOf(k)
    if (q.minKnowledge !== undefined && k < q.minKnowledge) continue
    if (q.scoutedOnly && k < SCOUT_SEEN_THRESHOLD) continue
    if (q.watchedOnly && !(scouting.watchList ?? []).some((w) => w.playerId === pid)) continue

    // Ability is the department's read — and there is no read below the floor.
    // This is the whole point of the tool respecting fog: an unscouted 17-year-old
    // in the MHL comes back as a name, an age and a scoresheet, not a star grade.
    const hasRead = read !== 'unscouted'
    const cur = hasRead ? overallToStars(ratedOverall(p)) : null
    const pot = hasRead ? overallToStars(scoutedCeilingK(p, k, acc)) : null
    if (q.minCurrentStars !== undefined && (cur === null || cur < q.minCurrentStars)) continue
    if (q.minPotentialStars !== undefined && (pot === null || pot < q.minPotentialStars)) continue

    if (k >= SCOUT_SEEN_THRESHOLD) scoutedCount++
    const line = ctx.liveLine?.(pid) ?? seasonLine(p)
    cands.push({ p, pid, team, league, k, acc, cur, pot, read, line, contract })
  }

  const dir = q.desc === false ? 1 : -1
  const byName = (a: Cand, b: Cand): number => a.p.name.localeCompare(b.p.name)
  cands.sort((a, b) => {
    switch (q.sort) {
      case 'name': return (q.desc ? -1 : 1) * byName(a, b)
      case 'age': return dir * (a.p.age - b.p.age) || byName(a, b)
      case 'current': return dir * ((a.cur ?? -1) - (b.cur ?? -1)) || byName(a, b)
      case 'potential': return dir * ((a.pot ?? -1) - (b.pot ?? -1)) || byName(a, b)
      case 'knowledge': return dir * (a.k - b.k) || byName(a, b)
      case 'salary': return dir * (a.p.contract.salary - b.p.contract.salary) || byName(a, b)
      case 'points': return dir * (a.line.points - b.line.points) || byName(a, b)
      default: return dir * ((a.pot ?? -1) - (b.pot ?? -1)) || dir * ((a.cur ?? -1) - (b.cur ?? -1)) || byName(a, b)
    }
  })

  const total = cands.length
  const offset = Math.max(0, q.offset ?? 0)
  const limit = Math.max(1, Math.min(200, q.limit ?? SEARCH_PAGE))
  const page = cands.slice(offset, offset + limit)

  const watchSet = new Set((scouting.watchList ?? []).map((w) => w.playerId))
  const rows: PlayerSearchRow[] = page.map((c) => ({
    playerId: c.pid,
    name: c.p.name,
    position: c.p.position as string,
    age: c.p.age,
    handedness: c.p.handedness as string,
    ...(c.p.nationality !== undefined ? { nationality: c.p.nationality } : {}),
    ...(c.p.faceId !== undefined ? { faceId: c.p.faceId } : {}),
    ...(c.team ? { teamId: c.team.id as string, teamAbbr: c.team.abbreviation, teamName: c.team.name } : { teamAbbr: 'FA', teamName: 'Free agent' }),
    ...(c.league ? { leagueAbbr: c.league.abbrev } : {}),
    knowledge: Math.round(c.k),
    read: c.read,
    readLabel: READ_LABEL[c.read],
    currentStars: c.cur,
    potentialStars: c.pot,
    salary: c.p.contract.salary,
    contractLabel: c.contract.label,
    contractBucket: c.contract.bucket,
    gp: c.line.gp,
    goals: c.line.goals,
    assists: c.line.assists,
    points: c.line.points,
    draftEligible: ctx.draftProspectIds.has(c.pid),
    watched: watchSet.has(c.pid),
    // A market value on an unread player would be a leak dressed as a number.
    value: c.k >= SCOUT_SEEN_THRESHOLD ? Math.round(playerValue(c.p)) : null,
  }))

  const facets: PlayerSearchFacets = {
    nations: [...facetNations].sort(),
    leagues: [...facetLeagues].map(([id, abbrev]) => ({ id, label: abbrev })).sort((a, b) => a.label.localeCompare(b.label)),
  }

  const unread = total - scoutedCount
  const fogNote = total === 0
    ? 'Nothing in the database matches those filters.'
    : unread === 0
      ? `Your department has a read on all ${total} of these players.`
      : `${scoutedCount} of ${total} carry a real scouting read; the other ${unread} are names on a sheet until you send someone.`

  return { rows, total, scoutedCount, facets, fogNote, offset, limit }
}
