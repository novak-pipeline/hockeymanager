/**
 * Global free-agent market (#5). After the NHL free-agency window closes, the
 * players NHL clubs passed on don't just vanish — the wider world signs them.
 * An aging vet with no NHL offer lands in the KHL or SHL; a fringe player drops
 * to the AHL/Europe; a Swede tends to go home. This sweep is what makes the
 * world's economy breathe and produces the "where did he end up?" stories.
 *
 * Pure given its inputs + seed: it mutates team rosters and player contracts and
 * returns the signings (notable ones flagged for news) plus the still-unsigned.
 */
import type { Competition, Player, PlayerId, Team, TeamId } from '@domain'
import { ratedOverall } from '@engine/ratings/composites'
import type { Rng } from '@engine/shared/rng'

export interface WorldSigning {
  playerId: PlayerId
  teamId: TeamId
  competitionId: string
  competitionName: string
  salary: number
  years: number
  /** A recognisable name (aging ex-NHLer / quality player) worth a news item. */
  notable: boolean
}

/** Modest world-league contract scaled by ability and league strength. */
function worldContract(ovr: number, strength: number, rng: Rng): { salary: number; years: number } {
  const base = 0.2 + Math.pow(Math.max(0, ovr - 40) / 50, 2) * 3.5 // €/$M, well below NHL
  const salary = Math.round(base * strength * 1e6 * rng.float(0.85, 1.15))
  const years = rng.range(1, 2)
  return { salary: Math.max(150_000, salary), years }
}

export function worldFreeAgencySweep(args: {
  competitions: Competition[]
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  faPool: PlayerId[]
  year: number
  rng: Rng
  /** Roster size a world team carries up to (default 27 — world/junior clubs run
   *  deeper benches than an NHL 23, leaving room to absorb free agents). */
  rosterTarget?: number
  /** Skip free agents below this current ability (the unsignable dregs). */
  minOverall?: number
}): { signings: WorldSigning[]; remaining: PlayerId[] } {
  const { teams, players, rng, year } = args
  const rosterTarget = args.rosterTarget ?? 27
  const minOverall = args.minOverall ?? 45

  // Simulated-tier teams, strongest league first, with room to sign.
  interface Slot { teamId: TeamId; comp: Competition; nation: string }
  const slots: Slot[] = []
  const sortedComps = [...args.competitions]
    .filter((c) => c.tier === 'simulated')
    .sort((a, b) => b.strength - a.strength)
  for (const comp of sortedComps) {
    for (const tid of comp.teamIds) {
      slots.push({ teamId: tid, comp, nation: comp.nation.toLowerCase() })
    }
  }
  if (slots.length === 0) return { signings: [], remaining: [...args.faPool] }

  const roomOf = (tid: TeamId): number => {
    const t = teams.get(tid)
    return t ? rosterTarget - t.roster.length : 0
  }

  // Free agents worth signing, best first.
  const candidates = args.faPool
    .map((id) => players.get(id))
    .filter((p): p is Player => !!p && ratedOverall(p) >= minOverall)
    .sort((a, b) => ratedOverall(b) - ratedOverall(a))

  const signings: WorldSigning[] = []
  const signed = new Set<string>()

  for (const p of candidates) {
    const ovr = ratedOverall(p)
    const nat = (p.nationality ?? '').toLowerCase()
    // Prefer a league in the player's nation with room; else the strongest
    // league with room. Stronger players are tried against stronger leagues
    // first (slots are pre-sorted by strength).
    const withRoom = slots.filter((s) => roomOf(s.teamId) > 0)
    if (withRoom.length === 0) break
    const homeFirst = nat
      ? [...withRoom.filter((s) => s.nation === nat), ...withRoom.filter((s) => s.nation !== nat)]
      : withRoom
    const slot = homeFirst[0]!
    const team = teams.get(slot.teamId)
    if (!team) continue

    const { salary, years } = worldContract(ovr, slot.comp.strength, rng)
    team.roster.push(p.id)
    p.contract = {
      salary,
      yearsRemaining: years,
      expiryYear: year + years,
      noTradeClause: false,
      twoWay: false,
    }
    signed.add(p.id as string)
    signings.push({
      playerId: p.id,
      teamId: slot.teamId,
      competitionId: slot.comp.id,
      competitionName: slot.comp.name,
      salary,
      years,
      // Aging ex-NHLers and quality players make the headlines.
      notable: (p.age >= 30 && ovr >= 55) || ovr >= 66,
    })
  }

  const remaining = args.faPool.filter((id) => !signed.has(id as string))
  return { signings, remaining }
}
