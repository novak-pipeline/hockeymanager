/**
 * Score effects: a trailing team pushes for more shot volume, a leading team
 * protects its lead, and the split widens as the clock runs down. The unit tests
 * pin the multiplier's shape; the integration test drives real full-sim games
 * between two IDENTICAL teams (so any tilt is pure score effects, not a strength
 * gap) and confirms the trailing team really does out-shoot — while total goals
 * stay inside the NHL band.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId, Team } from '@domain'
import { asPlayerId, asTeamId, isEvent } from '@domain'
import { scoreEffectMult } from './scoreEffects'
import { fullSimGame } from '@engine/full/fullSim'

describe('scoreEffectMult', () => {
  it('is neutral when the game is tied', () => {
    expect(scoreEffectMult(0, 0.5)).toBe(1)
    expect(scoreEffectMult(0, 1)).toBe(1)
  })

  it('a trailing team pushes (>1), a leading team protects (<1)', () => {
    expect(scoreEffectMult(-1, 1)).toBeGreaterThan(1)
    expect(scoreEffectMult(-2, 1)).toBeGreaterThan(scoreEffectMult(-1, 1))
    expect(scoreEffectMult(1, 1)).toBeLessThan(1)
    expect(scoreEffectMult(2, 1)).toBeLessThan(scoreEffectMult(1, 1))
  })

  it('strengthens as regulation runs down', () => {
    const early = scoreEffectMult(-1, 0) // puck drop
    const late = scoreEffectMult(-1, 1) // final horn
    expect(late).toBeGreaterThan(early)
    expect(early).toBeGreaterThan(1) // still a small effect even early
  })

  it('saturates past a two-goal margin', () => {
    expect(scoreEffectMult(-3, 1)).toBe(scoreEffectMult(-2, 1))
    expect(scoreEffectMult(4, 1)).toBe(scoreEffectMult(2, 1))
  })

  it('boosts the chaser more than it clamps the leader (volume-conserving)', () => {
    const push = scoreEffectMult(-1, 1) - 1
    const clamp = 1 - scoreEffectMult(1, 1)
    expect(push).toBeGreaterThan(clamp)
  })
})

describe('score effects in real games (equal-strength mirror)', () => {
  it('the trailing team out-shoots while goals stay in the NHL band', () => {
    const data = generateLeague({ seed: 99 })
    const src = data.teams.get(data.league.teams[0])!
    const clones = new Map<PlayerId, Player>()
    const remap = (ids: PlayerId[]): PlayerId[] => ids.map((i) => asPlayerId(`${i}_B`))
    for (const id of src.roster) {
      const p = data.players.get(id)!
      const nid = asPlayerId(`${id}_B`)
      clones.set(nid, { ...p, id: nid })
    }
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
    const resolve = (id: PlayerId): Player => {
      const p = data.players.get(id) ?? clones.get(id)
      if (!p) throw new Error(`unknown ${id}`)
      return p
    }

    let goals = 0
    let trailingShots = 0
    let leadingShots = 0
    const games = 60
    for (let i = 0; i < games; i++) {
      const out = fullSimGame(src, teamB, resolve, { seed: 6000 + i })
      let hg = 0
      let ag = 0
      for (const ev of out.stream) {
        if (isEvent(ev, 'shot')) {
          const lead = (src.roster.includes(ev.shooter) ? hg - ag : ag - hg)
          if (lead < 0) trailingShots++
          else if (lead > 0) leadingShots++
        }
        if (isEvent(ev, 'goal')) {
          goals++
          if (src.roster.includes(ev.scorer)) hg++
          else ag++
        }
      }
    }
    const share = trailingShots / (trailingShots + leadingShots)
    // Pure score effects (equal teams) → the chaser out-shoots the leader.
    expect(share).toBeGreaterThan(0.5)
    // ...and total scoring stays realistic (NHL ~3.0–3.2, generous band).
    const goalsPerTeam = goals / (games * 2)
    expect(goalsPerTeam).toBeGreaterThan(2.6)
    expect(goalsPerTeam).toBeLessThan(3.7)
  })
})
