/**
 * Builds the wider hockey world: turns parsed league/club membership into
 * `Competition[]` — the NHL's feeders (AHL/ECHL/CHL/USHL/NCAA) and the
 * international leagues (KHL/SHL/Liiga/…) that make the world scoutable and
 * developing. Pure and deterministic: the same input always yields the same
 * world (schedules come from the deterministic buildSchedule; strength from
 * the NHLe model). Both the EHM importer and the mod loader target this builder,
 * so the engine side is provable independently of the heavy import.
 */
import type { Competition, CompetitionTier, TeamId } from '@domain'
import { leagueTranslationFactor } from '@engine/league/leagueStrength'
import { buildSchedule, freshStanding } from './generate'

/** A league as parsed from the source DB, before world assembly. */
export interface RawCompetition {
  id: string
  name: string
  abbrev: string
  nation: string
  /** Division level within its nation: 1 = top tier, 2, 3 … */
  level: number
  /** EHM league reputation (~0–20). */
  reputation: number
  parentId?: string
  upperAgeLimit?: number
}

/** Feeder/major leagues simulated by default regardless of raw reputation. */
const SIMULATED_ABBREVS = new Set([
  'AHL', 'ECHL', 'OHL', 'WHL', 'QMJHL', 'LHJMQ', 'USHL', 'NTDP', 'USNTDP', 'NCAA',
  'KHL', 'SHL', 'LIIGA', 'NL', 'DEL', 'EXTRALIGA', 'MESTIS', 'VHL',
])

/**
 * Default fidelity tier for a competition. The NHL is the active league; the
 * recognised feeders/majors and strong top divisions are simulated; everything
 * else is navigable background. Callers can override via `tierOf`.
 */
export function defaultTier(c: RawCompetition): CompetitionTier {
  const ab = c.abbrev.trim().toUpperCase()
  if (ab === 'NHL') return 'active'
  if (SIMULATED_ABBREVS.has(ab)) return 'simulated'
  if (c.level === 1 && c.reputation >= 13) return 'simulated'
  return 'background'
}

/**
 * Choose how many round-robins to schedule so a simulated league plays roughly a
 * realistic number of games for its size, clamped to [1, 4].
 */
function roundRobinsFor(teamCount: number, targetGames = 60): number {
  if (teamCount < 2) return 0
  return Math.max(1, Math.min(4, Math.round(targetGames / (teamCount - 1))))
}

export interface BuildCompetitionsArgs {
  comps: RawCompetition[]
  /** teamId → competitionId membership (from clubs' league assignment). */
  membership: Array<{ teamId: TeamId; competitionId: string }>
  season: number
  /** Override the default tiering policy. */
  tierOf?: (c: RawCompetition) => CompetitionTier
  /** Target games/team for simulated-league schedules (default 60). */
  targetGames?: number
}

/**
 * Assemble the world's competitions. Each gets its NHLe strength, a fidelity
 * tier, its member teams, fresh standings, and — for simulated leagues with
 * enough teams — a round-robin schedule. Background leagues get no schedule
 * (navigable rosters + light/abstract results are layered on later). Empty
 * competitions (no members) are dropped.
 */
export function buildCompetitions(args: BuildCompetitionsArgs): Competition[] {
  const { comps, membership, season } = args
  const tierOf = args.tierOf ?? defaultTier
  const targetGames = args.targetGames ?? 60

  const teamsByComp = new Map<string, TeamId[]>()
  for (const { teamId, competitionId } of membership) {
    let list = teamsByComp.get(competitionId)
    if (!list) { list = []; teamsByComp.set(competitionId, list) }
    list.push(teamId)
  }

  const out: Competition[] = []
  for (const c of comps) {
    const teamIds = teamsByComp.get(c.id) ?? []
    if (teamIds.length === 0) continue
    const tier = tierOf(c)
    const strength = leagueTranslationFactor({
      level: c.level,
      reputation: c.reputation,
      abbrev: c.abbrev,
      name: c.name,
    })
    const schedule =
      tier === 'simulated' && teamIds.length >= 2
        ? buildSchedule(teamIds, roundRobinsFor(teamIds.length, targetGames), season)
        : []
    const comp: Competition = {
      id: c.id,
      name: c.name,
      abbrev: c.abbrev,
      nation: c.nation,
      level: c.level,
      reputation: c.reputation,
      strength,
      tier,
      teamIds,
      schedule,
      standings: teamIds.map(freshStanding),
    }
    if (c.parentId !== undefined) comp.parentId = c.parentId
    if (c.upperAgeLimit !== undefined) comp.upperAgeLimit = c.upperAgeLimit
    out.push(comp)
  }
  return out
}
