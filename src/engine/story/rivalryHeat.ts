/**
 * Rivalry heat over one finished game (the shared model is shared/heat.ts).
 *
 * Folds the event stream through a {@link HeatTracker} once and keeps what the
 * readers need: every incident (story lines, the career ledger), the team heat
 * sampled on the playback clock (crowd intensity) and the pairs it ends on.
 * Pure and deterministic.
 */
import type { GameStream } from '@domain'
import { playAbsT, streamPeriodBases } from '@domain'
import { HeatTracker, type CarriedHeat, type HeatIncident, type HeatSide } from '@engine/shared/heat'

/** Sample spacing of the team-heat curve, playback seconds. */
export const HEAT_STEP_S = 2

export interface GameHeat {
  incidents: HeatIncident[]
  /** Team heat per HEAT_STEP_S, 0..1. */
  samples: Float32Array
  /** Pairs with heat at the final horn, hottest first. */
  pairs: Array<{ a: string; b: string; heat: number }>
  /** Hottest the night got. */
  peak: number
  /** Penalty minutes and fights in the game (for the ledger's "last meeting"). */
  pim: number
  fights: number
}

export interface GameHeatInputs {
  sideOf: (playerId: string) => HeatSide | null
  stars?: ReadonlySet<string>
  carried?: CarriedHeat
}

export function computeGameHeat(stream: GameStream, inputs: GameHeatInputs): GameHeat {
  const bases = streamPeriodBases(stream)
  const tr = new HeatTracker({
    sideOf: inputs.sideOf,
    ...(inputs.stars ? { stars: inputs.stars } : {}),
    ...(inputs.carried ? { carried: inputs.carried } : {}),
  })
  const incidents: HeatIncident[] = []
  let duration = 0
  let pim = 0
  let fights = 0
  let fightingMajors = 0
  // stream order is the order things happened; the tracker needs it that way
  for (const ev of stream) {
    const at = playAbsT(ev, bases)
    duration = Math.max(duration, at)
    if (ev.type === 'penalty') {
      pim += ev.minutes
      if (ev.infraction === 'fighting') fightingMajors++
    }
    if (ev.type === 'fight') fights++
    incidents.push(...tr.observe(ev, at))
  }
  if (fights === 0) fights = Math.floor(fightingMajors / 2)

  // Re-run the team curve from the incidents (the tracker's decay is analytic).
  const n = Math.max(1, Math.ceil(duration / HEAT_STEP_S) + 1)
  const samples = new Float32Array(n)
  const replay = new HeatTracker({
    sideOf: inputs.sideOf,
    ...(inputs.stars ? { stars: inputs.stars } : {}),
    ...(inputs.carried ? { carried: inputs.carried } : {}),
  })
  let k = 0
  let peak = replay.team(0)
  for (const ev of stream) {
    const at = playAbsT(ev, bases)
    while (k < n && k * HEAT_STEP_S < at) {
      samples[k] = replay.team(k * HEAT_STEP_S)
      k++
    }
    replay.observe(ev, at)
    peak = Math.max(peak, replay.team(at))
  }
  while (k < n) {
    samples[k] = replay.team(k * HEAT_STEP_S)
    k++
  }
  incidents.sort((a, b) => a.absT - b.absT)
  return { incidents, samples, pairs: tr.hotPairs(0.05), peak, pim, fights }
}

/** Team heat at a playback second. */
export function gameHeatAt(g: GameHeat, absT: number): number {
  if (g.samples.length === 0) return 0
  const i = Math.max(0, Math.min(g.samples.length - 1, Math.floor(absT / HEAT_STEP_S)))
  return g.samples[i]!
}

/**
 * Each club's top two scorers this season (a penalty on one is a cheap shot).
 * Rank 1 = the club's points leader. Needs ten games and ten points so an
 * early-season hot week doesn't make a star.
 */
export function topScorers(players: ReadonlyArray<{ id: string; side: HeatSide; position: string; seasonGames: number; seasonGoals: number; seasonAssists: number }>): Map<string, 1 | 2> {
  const out = new Map<string, 1 | 2>()
  for (const side of ['home', 'away'] as const) {
    const ranked = players
      .filter((p) => p.side === side && p.position !== 'G' && p.seasonGames >= 10 && p.seasonGoals + p.seasonAssists >= 10)
      .sort((a, b) => (b.seasonGoals + b.seasonAssists) - (a.seasonGoals + a.seasonAssists) || b.seasonGoals - a.seasonGoals || (a.id < b.id ? -1 : 1))
    // a tie for the lead has no single leader: nobody is "the" points leader then
    const [first, second, third] = ranked
    const pts = (p: typeof first): number => (p ? p.seasonGoals + p.seasonAssists : -1)
    if (first && pts(first) !== pts(second)) out.set(first.id, 1)
    if (second && pts(second) !== pts(third) && pts(first) !== pts(second)) out.set(second.id, 2)
  }
  return out
}
