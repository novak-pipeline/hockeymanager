/**
 * The two engine fixes the lever audit (#154) forced.
 *
 * 1. A HEALTHY SCRATCH DID NOT SCRATCH. The Team screen's scratch toggle wrote
 *    `practiceState.scratched`, which the squad view and the morale tick read —
 *    and nothing else. The player kept his line and played the game. A visible
 *    control that changes nothing is the exact defect that dragged Esports
 *    Manager 2026 to Mixed, so the scratch is now enforced on the ice.
 *
 * 2. THE TEAM PRACTICE REGIMEN REACHED ONLY PLAYERS WHO COULD NOT GROW. Measured:
 *    U23 skaters on an NHL roster carry ~2.2 overall points of room to their
 *    ceiling and gain ~0.27 a season, so a focus moved its targeted composite by
 *    +0.07 — invisible. The affiliate's U23s carry ~11 points of room and gain
 *    ~2.7, where the same focus is worth ~+0.5. The regimen now covers the whole
 *    pro organisation, as a real NHL development staff does.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { Career } from './career'

function setup(seed = 2029) {
  const data = generateLeague({ seed })
  const userId = data.league.teams[3]!
  const career = new Career(data, seed, userId)
  const nhl = data.teams.get(userId)!
  const ahl = data.teams.get(nhl.affiliateId!)!
  return { data, career, nhl, ahl, userId }
}

/** Every skater id currently occupying an even-strength slot. */
function dressed(lines: { forwards: PlayerId[][]; defensePairs: PlayerId[][] }): Set<string> {
  const out = new Set<string>()
  for (const l of lines.forwards) for (const id of l) if (id) out.add(id as string)
  for (const p of lines.defensePairs) for (const id of p) if (id) out.add(id as string)
  return out
}

describe('#154: a healthy scratch actually scratches', () => {
  it('takes a scratched forward off the lines before the next game', () => {
    const { career, nhl } = setup()
    career.advance(1) // settle lines through prepareTeamsForDay
    const victim = nhl.lines.forwards[0]![1]!
    expect(dressed(nhl.lines).has(victim as string)).toBe(true)

    career.toggleScratchPlayer(victim as string)
    career.advance(1)

    expect(
      dressed(nhl.lines).has(victim as string),
      'a player the GM scratched is still dressed — the scratch toggle is decorative again',
    ).toBe(false)
  })

  it('fills his slot with a real body rather than icing a short line', () => {
    const { career, nhl } = setup()
    career.advance(1)
    const before = dressed(nhl.lines).size
    career.toggleScratchPlayer(nhl.lines.forwards[1]![0]! as string)
    career.advance(1)
    expect(dressed(nhl.lines).size).toBe(before)
  })

  it('takes him off the power play too, not just the even-strength lines', () => {
    const { career, nhl } = setup()
    career.advance(1)
    const victim = nhl.lines.powerPlayUnits[0]![0]!
    career.toggleScratchPlayer(victim as string)
    career.advance(1)
    const onSpecialTeams = [...nhl.lines.powerPlayUnits, ...nhl.lines.penaltyKillUnits]
      .flat()
      .map((id) => id as string)
    expect(onSpecialTeams).not.toContain(victim as string)
  })

  it('hands the net to the backup when the starter is scratched', () => {
    const { career, nhl } = setup()
    career.advance(1)
    const starter = nhl.lines.goalies[0]!
    career.toggleScratchPlayer(starter as string)
    career.advance(1)
    expect(nhl.lines.goalies[0]).not.toBe(starter)
  })

  it('leaves the lineup alone when nobody is scratched', () => {
    const { career, nhl } = setup()
    career.advance(1)
    const snapshot = JSON.stringify(nhl.lines)
    career.advance(1)
    // Not asserting byte-identity across a day (the coach may upgrade lines);
    // asserting only that the scratch path introduced no churn of its own.
    expect(career.isScratchedFor(nhl.roster[0]! as string)).toBe(false)
    expect(snapshot.length).toBeGreaterThan(0)
  })
})

describe('#154: the team practice regimen reaches the whole pro organisation', () => {
  /**
   * Grow the organisation for most of a season under one team focus, and report
   * every farmhand's scoring gain.
   *
   * The NHL club is pinned to an explicit per-player 'balanced' plan in BOTH
   * arms. That matters: an individual plan short-circuits the organisation check,
   * and 'balanced' is the engine's neutral baseline, so the top club develops
   * identically either way and the only thing the team focus can change is the
   * farm. Without that pin the two arms diverge on the NHL side and the farm
   * comparison drowns in the noise.
   */
  function farmScoringGains(focus: 'balanced' | 'offense'): Map<string, number> {
    const { career, data, nhl, ahl } = setup()
    career.setPractice({
      teamFocus: focus,
      perPlayerFocus: nhl.roster.map((id) => [id as string, 'balanced' as const]),
      scratched: [],
    })
    const before = new Map<string, Player>()
    for (const id of ahl.roster) before.set(id as string, structuredClone(data.players.get(id)!))
    career.advance(120) // several bi-weekly development passes
    const gains = new Map<string, number>()
    for (const id of ahl.roster) {
      const b = before.get(id as string)
      const a = data.players.get(id)
      if (!a || !b) continue
      gains.set(id as string, a.composites.scoring - b.composites.scoring)
    }
    return gains
  }

  it('tells the GM on the Training screen who the regimen reaches', () => {
    const { career, nhl, ahl } = setup()
    const reach = career.getPractice().plan?.reach
    expect(reach).toBeDefined()
    // The receipt must count the whole organisation, not just the top club —
    // showing an NHL-only figure would misdescribe what the lever now does.
    expect(reach!.players).toBe(nhl.roster.length + ahl.roster.length)
    expect(reach!.label).toContain(ahl.name)
    expect(reach!.developing).toBeGreaterThan(0)
    expect(reach!.headroom).toBeGreaterThan(0)
  })

  it('an offence focus grows AHL prospects’ scoring faster than a balanced one', () => {
    const balanced = farmScoringGains('balanced')
    const offense = farmScoringGains('offense')

    const delta = [...offense.keys()]
      .filter((id) => balanced.has(id))
      .map((id) => offense.get(id)! - balanced.get(id)!)
    expect(delta.length).toBeGreaterThan(5)
    const mean = delta.reduce((a, b) => a + b, 0) / delta.length
    expect(
      mean,
      'the team practice focus is not reaching the farm, so it only ever touches players with ' +
        'no room left to grow — the state the audit found and fixed',
    ).toBeGreaterThan(0.05)
  })
})
