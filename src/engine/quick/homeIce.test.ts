/**
 * Home-ice advantage in the quick sim. Background games used to be a coin flip —
 * the home team banked no extra points — while the full (watched) sim already
 * carried a ~55% home edge emergently. That left the league standings with no
 * home-ice advantage at all. This drives equal-strength mirror matchups (so any
 * tilt is pure home ice, not a strength gap) and confirms the home team now wins
 * at a realistic NHL clip, with total scoring unchanged (the edge is symmetric).
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId, Team } from '@domain'
import { asPlayerId, asTeamId } from '@domain'
import { quickSimGame } from './quickSim'

function mirror(seed: number) {
  const data = generateLeague({ seed })
  const src = data.teams.get(data.league.teams[0])!
  const clones = new Map<PlayerId, Player>()
  const remap = (ids: PlayerId[]): PlayerId[] => ids.map((i) => asPlayerId(`${i}_B`))
  for (const id of src.roster) clones.set(asPlayerId(`${id}_B`), { ...data.players.get(id)!, id: asPlayerId(`${id}_B`) })
  const teamB: Team = {
    ...src,
    id: asTeamId('MIRROR'),
    abbreviation: 'MIR',
    roster: remap(src.roster),
    lines: {
      forwards: src.lines.forwards.map(remap) as Team['lines']['forwards'],
      defensePairs: src.lines.defensePairs.map(remap) as Team['lines']['defensePairs'],
      goalies: remap(src.lines.goalies) as Team['lines']['goalies'],
      powerPlayUnits: src.lines.powerPlayUnits.map(remap),
      penaltyKillUnits: src.lines.penaltyKillUnits.map(remap),
    },
  }
  const resolve = (id: PlayerId): Player => data.players.get(id) ?? clones.get(id)!
  return { src, teamB, resolve }
}

describe('quick-sim home-ice advantage', () => {
  it('the home team wins at a realistic NHL clip between equal teams', () => {
    const { src, teamB, resolve } = mirror(99)
    let home = 0
    let decided = 0
    let goals = 0
    const N = 400
    for (let i = 0; i < N; i++) {
      const q = quickSimGame(src, teamB, resolve, { seed: 8000 + i })
      goals += q.homeGoals + q.awayGoals
      if (q.homeGoals !== q.awayGoals) {
        decided++
        if (q.homeGoals > q.awayGoals) home++
      }
    }
    const homeRate = home / decided
    // Real NHL home win rate sits ~52-56% across eras; assert a clear, realistic
    // edge (not the old ~50% coin flip, not a runaway).
    expect(homeRate).toBeGreaterThan(0.52)
    expect(homeRate).toBeLessThan(0.58)
    // Symmetric edge → total scoring stays in the NHL band.
    const goalsPerTeam = goals / (N * 2)
    expect(goalsPerTeam).toBeGreaterThan(2.6)
    expect(goalsPerTeam).toBeLessThan(3.8)
  })
})
