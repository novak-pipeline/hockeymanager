/**
 * Goalie load management: a fresh starter carries the net as before, but a
 * fatigued No. 1 hands more starts to the backup (the back-half-of-a-back-to-back
 * effect). Drives chooseStartingGoalie directly across many seeds at fixed
 * fatigue levels and confirms the backup's share climbs with the starter's
 * fatigue — while a rested starter's split is unchanged.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { Rng } from '@engine/shared/rng'
import { chooseStartingGoalie } from './quickSim'

function setup(seed: number) {
  const { teams, players } = generateLeague({ seed })
  const team = teams.get([...teams.keys()][0])!
  const [starterId, backupId] = team.lines.goalies
  // Resolver that overrides the starter's fatigue; everyone else passes through.
  const resolverWithStarterFatigue = (fatigue: number) => (id: PlayerId): Player => {
    const p = players.get(id)!
    return id === starterId ? { ...p, fatigue } : p
  }
  return { team, starterId, backupId, resolverWithStarterFatigue }
}

function backupShareOver(
  team: ReturnType<typeof setup>['team'],
  resolve: (id: PlayerId) => Player,
  backupId: PlayerId,
  n = 400
): number {
  let backup = 0
  for (let i = 0; i < n; i++) {
    const pick = chooseStartingGoalie(team, resolve, 50, new Rng(9000 + i), 'regularSeason')
    if ((pick as string) === (backupId as string)) backup++
  }
  return backup / n
}

describe('chooseStartingGoalie — load management', () => {
  // Fatigue lives in a compressed 0–20 band in real play (rest recovers it fast),
  // so these use realistic worked-starter levels, not a 0–100 scale.
  it('a fatigued starter yields more starts to the backup', () => {
    const { team, backupId, resolverWithStarterFatigue } = setup(7)
    const fresh = backupShareOver(team, resolverWithStarterFatigue(0), backupId)
    const worn = backupShareOver(team, resolverWithStarterFatigue(12), backupId) // dense week
    const gassed = backupShareOver(team, resolverWithStarterFatigue(19), backupId) // maxed out
    expect(worn).toBeGreaterThan(fresh + 0.1) // clearly more rest when worked
    expect(gassed).toBeGreaterThan(worn) // and more still when spent
    expect(gassed).toBeGreaterThan(0.55) // a truly gassed No. 1 usually sits
  })

  it('leaves a rested starter’s workload unchanged (fatigue ≤ 6 is a no-op)', () => {
    const { team, backupId, resolverWithStarterFatigue } = setup(11)
    const at0 = backupShareOver(team, resolverWithStarterFatigue(0), backupId)
    const at6 = backupShareOver(team, resolverWithStarterFatigue(6), backupId)
    expect(at6).toBeCloseTo(at0, 5) // identical up to the fatigue-6 threshold
    expect(at0).toBeLessThan(0.45) // starter still the workhorse when fresh
  })

  it('never benches the starter outright — the backup share is capped', () => {
    const { team, backupId, resolverWithStarterFatigue } = setup(3)
    const gassed = backupShareOver(team, resolverWithStarterFatigue(20), backupId)
    expect(gassed).toBeLessThanOrEqual(0.85)
  })
})
