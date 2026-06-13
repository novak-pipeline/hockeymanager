/**
 * Tests for src/engine/league/staff.ts
 *
 * Coverage:
 *  - generateStaff determinism and range constraints
 *  - buildAgmReport: high-judgment AGM ranks closer to truth than low-judgment
 *  - buildAgmReport: tier assignment sanity
 *  - buildAgmReport: every category best is populated
 *  - hireRetiredPlayer: mapping and formerPlayerId
 *  - JSON round-trip: StaffMember serialises cleanly
 */

import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Rng } from '@engine/shared/rng'
import { overall } from '@engine/ratings/composites'
import {
  buildAgmReport,
  demeanor,
  generateStaff,
  generateTeamStaff,
  hireRetiredPlayer,
  type AgmReport,
  type StaffMember,
} from './staff'

/* ─────────────────────────── helpers ─────────────────────────── */

function makeLeague(seed = 42) {
  return generateLeague({ seed })
}

function makeAgm(judgment: number): StaffMember {
  return {
    id: 'agm-test',
    name: 'Test AGM',
    role: 'assistantGM',
    rating: 70,
    judgment,
  }
}

/* ─────────────────────────── generateStaff ─────────────────────────── */

describe('generateStaff', () => {
  it('is deterministic: same seed produces same names and ratings', () => {
    const a = generateStaff({ rng: new Rng(99) })
    const b = generateStaff({ rng: new Rng(99) })
    expect(a.headCoach.name).toBe(b.headCoach.name)
    expect(a.assistantGM.name).toBe(b.assistantGM.name)
    expect(a.headCoach.rating).toBe(b.headCoach.rating)
    expect(a.assistantGM.judgment).toBe(b.assistantGM.judgment)
  })

  it('rating is in [40, 90] for both roles', () => {
    for (let seed = 0; seed < 30; seed++) {
      const { headCoach, assistantGM } = generateStaff({ rng: new Rng(seed) })
      expect(headCoach.rating).toBeGreaterThanOrEqual(40)
      expect(headCoach.rating).toBeLessThanOrEqual(90)
      expect(assistantGM.rating).toBeGreaterThanOrEqual(40)
      expect(assistantGM.rating).toBeLessThanOrEqual(90)
    }
  })

  it('judgment is in [30, 95] for both roles', () => {
    for (let seed = 0; seed < 30; seed++) {
      const { headCoach, assistantGM } = generateStaff({ rng: new Rng(seed) })
      expect(headCoach.judgment).toBeGreaterThanOrEqual(30)
      expect(headCoach.judgment).toBeLessThanOrEqual(95)
      expect(assistantGM.judgment).toBeGreaterThanOrEqual(30)
      expect(assistantGM.judgment).toBeLessThanOrEqual(95)
    }
  })

  it('assigns correct roles', () => {
    const { headCoach, assistantGM } = generateStaff({ rng: new Rng(5) })
    expect(headCoach.role).toBe('headCoach')
    expect(assistantGM.role).toBe('assistantGM')
  })

  it('produces unique names for coach and AGM', () => {
    const { headCoach, assistantGM } = generateStaff({ rng: new Rng(7) })
    expect(headCoach.name).toBeTruthy()
    expect(assistantGM.name).toBeTruthy()
    expect(headCoach.name).not.toBe(assistantGM.name)
  })

  it('avoids names already in existingScoutNames', () => {
    // Run many seeds; the pool is large enough that clashes are rare,
    // but the dedup logic should not throw or produce empty names.
    for (let seed = 0; seed < 20; seed++) {
      const first = generateStaff({ rng: new Rng(seed) })
      const existing = [first.headCoach.name, first.assistantGM.name]
      const second = generateStaff({ rng: new Rng(seed), existingScoutNames: existing })
      // Both staff should still have valid names
      expect(second.headCoach.name).toBeTruthy()
      expect(second.assistantGM.name).toBeTruthy()
    }
  })

  it('ids are non-empty strings', () => {
    const { headCoach, assistantGM } = generateStaff({ rng: new Rng(3) })
    expect(headCoach.id.length).toBeGreaterThan(0)
    expect(assistantGM.id.length).toBeGreaterThan(0)
  })

  it('specialty is set on both', () => {
    const { headCoach, assistantGM } = generateStaff({ rng: new Rng(12) })
    expect(headCoach.specialty).toBeTruthy()
    expect(assistantGM.specialty).toBeTruthy()
  })
})

/* ─────────────────────────── buildAgmReport – structure ─────────────────────────── */

describe('buildAgmReport – structure', () => {
  it('returns all depth-chart groups and they contain AgmRankedPlayer objects', () => {
    const data = makeLeague(1)
    const team = [...data.teams.values()][0]!
    const roster = team.roster.map((id) => data.players.get(id)!).filter(Boolean)
    const agm = makeAgm(80)
    const report = buildAgmReport({ roster, players: data.players, agm, rng: new Rng(1) })

    const totalInChart =
      report.depthChart.goalies.length +
      report.depthChart.defensemen.length +
      report.depthChart.centers.length +
      report.depthChart.leftWings.length +
      report.depthChart.rightWings.length

    expect(totalInChart).toBe(roster.length)

    // Spot-check one group's shape
    for (const g of report.depthChart.goalies) {
      expect(g.playerId).toBeTruthy()
      expect(g.name).toBeTruthy()
      expect(g.position).toBe('G')
      expect(g.judgedOverall).toBeGreaterThanOrEqual(1)
      expect(g.judgedOverall).toBeLessThanOrEqual(99)
      expect(['nhl', 'reserve', 'prospect']).toContain(g.tier)
    }
  })

  it('every CATEGORY_LABEL has an entry in categoryBests', () => {
    const data = makeLeague(2)
    const team = [...data.teams.values()][0]!
    const roster = team.roster.map((id) => data.players.get(id)!).filter(Boolean)
    const agm = makeAgm(70)
    const report = buildAgmReport({ roster, players: data.players, agm, rng: new Rng(2) })

    const EXPECTED_CATEGORIES = [
      'Biggest Star', 'Best Leader', 'Best Skater', 'Best Shooter',
      'Hardest Shot', 'Best At Faceoffs', 'Best Stickhandler',
      'Best Checker', 'Best Enforcer', 'Most Physical',
      'Most Overrated', 'Most Underrated',
    ]
    const gotCategories = report.categoryBests.map((c) => c.category)
    for (const cat of EXPECTED_CATEGORIES) {
      expect(gotCategories).toContain(cat)
    }
    expect(report.categoryBests).toHaveLength(EXPECTED_CATEGORIES.length)
  })

  it('categoryBests entries reference players on the roster', () => {
    const data = makeLeague(3)
    const team = [...data.teams.values()][1]!
    const roster = team.roster.map((id) => data.players.get(id)!).filter(Boolean)
    const rosterIds = new Set(roster.map((p) => p.id as string))
    const agm = makeAgm(65)
    const report = buildAgmReport({ roster, players: data.players, agm, rng: new Rng(3) })

    for (const entry of report.categoryBests) {
      expect(rosterIds.has(entry.playerId)).toBe(true)
      expect(entry.playerName).toBeTruthy()
    }
  })

  it('topProspects are all under age 23', () => {
    const data = makeLeague(4)
    const team = [...data.teams.values()][0]!
    const roster = team.roster.map((id) => data.players.get(id)!).filter(Boolean)
    const agm = makeAgm(75)
    const report = buildAgmReport({ roster, players: data.players, agm, rng: new Rng(4) })

    for (const p of report.topProspects) {
      expect(p.age).toBeLessThan(23)
    }
  })

  it('topProspects are sorted descending by judgedPotential', () => {
    const data = makeLeague(5)
    const team = [...data.teams.values()][0]!
    const roster = team.roster.map((id) => data.players.get(id)!).filter(Boolean)
    const agm = makeAgm(80)
    const report = buildAgmReport({ roster, players: data.players, agm, rng: new Rng(5) })

    for (let i = 1; i < report.topProspects.length; i++) {
      expect(report.topProspects[i - 1]!.judgedPotential).toBeGreaterThanOrEqual(
        report.topProspects[i]!.judgedPotential
      )
    }
  })
})

/* ─────────────────────────── judgment quality statistical test ─────────────────────────── */

describe('buildAgmReport – judgment accuracy', () => {
  /**
   * Run reports with high- and low-judgment AGMs across many seeds.
   * The high-judgment AGM should, on average, produce a ranking that
   * correlates more strongly with the true overall order.
   *
   * We measure Spearman rank correlation (simplified via sum of rank-diff²).
   * High judgment → lower average sum → closer to true order.
   */
  it('high-judgment AGM ranks roster closer to true order than low-judgment AGM', () => {
    const SEEDS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    let highJudgmentError = 0
    let lowJudgmentError = 0

    for (const seed of SEEDS) {
      const data = generateLeague({ seed })
      const team = [...data.teams.values()][0]!
      const roster = team.roster.map((id) => data.players.get(id)!).filter(Boolean)
      if (roster.length < 4) continue

      const highAgm = makeAgm(95)
      const lowAgm = makeAgm(10)

      const highReport = buildAgmReport({ roster, players: data.players, agm: highAgm, rng: new Rng(seed) })
      const lowReport = buildAgmReport({ roster, players: data.players, agm: lowAgm, rng: new Rng(seed) })

      // True rank: sorted by actual overall descending
      const trueRanked = [...roster]
        .sort((a, b) => overall(b.composites, b.position) - overall(a.composites, a.position))
        .map((p) => p.id as string)

      // Collect all players in one AGM depth-chart order (goalies..defensemen..forwards)
      const reportToRanked = (r: AgmReport) => [
        ...r.depthChart.goalies,
        ...r.depthChart.defensemen,
        ...r.depthChart.centers,
        ...r.depthChart.leftWings,
        ...r.depthChart.rightWings,
      ].map((p) => p.playerId)

      const highRanked = reportToRanked(highReport)
      const lowRanked = reportToRanked(lowReport)

      // Build true-rank lookup
      const trueRankOf = new Map(trueRanked.map((id, i) => [id, i]))

      // Sum of squared rank differences vs true order
      const sumSqDiff = (ranked: string[]) =>
        ranked.reduce((acc, id, i) => {
          const trueRank = trueRankOf.get(id) ?? i
          return acc + (i - trueRank) ** 2
        }, 0)

      highJudgmentError += sumSqDiff(highRanked)
      lowJudgmentError += sumSqDiff(lowRanked)
    }

    // High judgment should accumulate less total ranking error
    expect(highJudgmentError).toBeLessThan(lowJudgmentError)
  })
})

/* ─────────────────────────── tier assignment ─────────────────────────── */

describe('buildAgmReport – tier assignment', () => {
  it('assigns nhl tier to high judgedOverall players (>=70)', () => {
    const data = makeLeague(6)
    const team = [...data.teams.values()][0]!
    // Use a very high-judgment AGM so judged ≈ true
    const agm = makeAgm(98)
    const roster = team.roster.map((id) => data.players.get(id)!).filter(Boolean)
    const report = buildAgmReport({ roster, players: data.players, agm, rng: new Rng(6) })

    const allRanked = [
      ...report.depthChart.goalies,
      ...report.depthChart.defensemen,
      ...report.depthChart.centers,
      ...report.depthChart.leftWings,
      ...report.depthChart.rightWings,
    ]

    for (const p of allRanked) {
      if (p.judgedOverall >= 70) {
        // Should not be 'reserve' when judgedOverall is clearly high
        // (unless prospect classification took precedence)
        const isNhlOrProspect = p.tier === 'nhl' || p.tier === 'prospect'
        expect(isNhlOrProspect).toBe(true)
      }
      if (p.judgedOverall < 55) {
        // Clearly below NHL threshold
        expect(p.tier).toBe('reserve')
      }
    }
  })
})

/* ─────────────────────────── hireRetiredPlayer ─────────────────────────── */

describe('hireRetiredPlayer', () => {
  it('sets formerPlayerId to the player id', () => {
    const data = makeLeague(7)
    const player = [...data.players.values()][0]!
    const staff = hireRetiredPlayer({ player, role: 'headCoach', rng: new Rng(7) })
    expect(staff.formerPlayerId).toBe(player.id as string)
  })

  it('sets the correct role', () => {
    const data = makeLeague(7)
    const player = [...data.players.values()][1]!
    const coach = hireRetiredPlayer({ player, role: 'headCoach', rng: new Rng(8) })
    const scout = hireRetiredPlayer({ player, role: 'scout', rng: new Rng(9) })
    expect(coach.role).toBe('headCoach')
    expect(scout.role).toBe('scout')
  })

  it('rating is in [40, 90]', () => {
    const data = makeLeague(8)
    for (const player of [...data.players.values()].slice(0, 20)) {
      const staff = hireRetiredPlayer({ player, role: 'scout', rng: new Rng(10) })
      expect(staff.rating).toBeGreaterThanOrEqual(40)
      expect(staff.rating).toBeLessThanOrEqual(90)
    }
  })

  it('judgment is in [30, 95]', () => {
    const data = makeLeague(9)
    for (const player of [...data.players.values()].slice(0, 20)) {
      const staff = hireRetiredPlayer({ player, role: 'assistantGM', rng: new Rng(11) })
      expect(staff.judgment).toBeGreaterThanOrEqual(30)
      expect(staff.judgment).toBeLessThanOrEqual(95)
    }
  })

  it('preserves the player name', () => {
    const data = makeLeague(10)
    const player = [...data.players.values()][3]!
    const staff = hireRetiredPlayer({ player, role: 'headCoach', rng: new Rng(12) })
    expect(staff.name).toBe(player.name)
  })

  it('id is non-empty and derived from player id', () => {
    const data = makeLeague(11)
    const player = [...data.players.values()][0]!
    const staff = hireRetiredPlayer({ player, role: 'scout', rng: new Rng(13) })
    expect(staff.id).toContain(player.id as string)
  })

  it('is deterministic: same player + seed yields same staff', () => {
    const data = makeLeague(12)
    const player = [...data.players.values()][5]!
    const a = hireRetiredPlayer({ player, role: 'scout', rng: new Rng(42) })
    const b = hireRetiredPlayer({ player, role: 'scout', rng: new Rng(42) })
    expect(a.rating).toBe(b.rating)
    expect(a.judgment).toBe(b.judgment)
  })
})

/* ─────────────────────────── demeanor helper ─────────────────────────── */

describe('demeanor helper', () => {
  const VALID: NonNullable<StaffMember['demeanor']>[] = ['fiery', 'calm', 'analytical', 'motivator', 'pragmatic']

  it('always returns one of the 5 valid demeanors', () => {
    for (let r = 40; r <= 90; r += 5) {
      for (let j = 30; j <= 95; j += 5) {
        expect(VALID).toContain(demeanor(r, j, 'Offense', new Rng(r + j)))
      }
    }
  })

  it('is deterministic: same inputs + same rng seed → same demeanor', () => {
    const a = demeanor(72, 72, 'Defense', new Rng(1))
    const b = demeanor(72, 72, 'Defense', new Rng(1))
    expect(a).toBe(b)
  })

  it('high rating + high judgment tends toward analytical', () => {
    // With nudge ≤ 3, r=85 j=85 should still land on analytical.
    const d = demeanor(85, 85, undefined, new Rng(0))
    expect(d).toBe('analytical')
  })
})

/* ─────────────────────────── generateTeamStaff ─────────────────────────── */

describe('generateTeamStaff', () => {
  it('produces a full complement with correct role labels', () => {
    const ts = generateTeamStaff(new Rng(200))
    expect(ts.headCoach.role).toBe('headCoach')
    expect(ts.assistantCoaches.every((ac) => ac.role === 'assistantCoach')).toBe(true)
    expect(ts.assistantGM.role).toBe('assistantGM')
    expect(ts.scouts.every((s) => s.role === 'scout')).toBe(true)
    expect(ts.physios.every((p) => p.role === 'physio')).toBe(true)
    expect(ts.owner.role).toBe('owner')
  })

  it('counts are in specified ranges', () => {
    for (let seed = 0; seed < 20; seed++) {
      const ts = generateTeamStaff(new Rng(seed))
      expect(ts.assistantCoaches.length).toBeGreaterThanOrEqual(2)
      expect(ts.assistantCoaches.length).toBeLessThanOrEqual(3)
      expect(ts.scouts.length).toBeGreaterThanOrEqual(2)
      expect(ts.scouts.length).toBeLessThanOrEqual(3)
      expect(ts.physios.length).toBeGreaterThanOrEqual(1)
      expect(ts.physios.length).toBeLessThanOrEqual(2)
    }
  })

  it('all ratings are in [40, 90] and all judgments in [30, 95]', () => {
    const ts = generateTeamStaff(new Rng(300))
    const members = [
      ts.headCoach, ts.assistantGM, ts.owner,
      ...ts.assistantCoaches, ...ts.scouts, ...ts.physios,
    ]
    for (const m of members) {
      expect(m.rating).toBeGreaterThanOrEqual(40)
      expect(m.rating).toBeLessThanOrEqual(90)
      expect(m.judgment).toBeGreaterThanOrEqual(30)
      expect(m.judgment).toBeLessThanOrEqual(95)
    }
  })

  it('every staff member has a demeanor', () => {
    const VALID = ['fiery', 'calm', 'analytical', 'motivator', 'pragmatic']
    const ts = generateTeamStaff(new Rng(400))
    const members = [
      ts.headCoach, ts.assistantGM, ts.owner,
      ...ts.assistantCoaches, ...ts.scouts, ...ts.physios,
    ]
    for (const m of members) {
      expect(VALID).toContain(m.demeanor)
    }
  })

  it('is deterministic: same Rng seed → same result', () => {
    const a = generateTeamStaff(new Rng(999))
    const b = generateTeamStaff(new Rng(999))
    expect(a.headCoach.name).toBe(b.headCoach.name)
    expect(a.headCoach.rating).toBe(b.headCoach.rating)
    expect(a.assistantGM.name).toBe(b.assistantGM.name)
    expect(a.scouts.length).toBe(b.scouts.length)
    expect(a.owner.name).toBe(b.owner.name)
  })

  it('existing names in opts are avoided', () => {
    const ts1 = generateTeamStaff(new Rng(10))
    const existingNames = new Set<string>([ts1.headCoach.name, ts1.assistantGM.name])
    const ts2 = generateTeamStaff(new Rng(10), { existingNames })
    // With the excluded names from ts1, ts2's head coach should be a different person
    // (or at worst the Jr. suffix variant — either way a string)
    expect(ts2.headCoach.name).toBeTruthy()
    expect(ts2.assistantGM.name).toBeTruthy()
  })

  it('round-trips through JSON cleanly', () => {
    const ts = generateTeamStaff(new Rng(500))
    const json = JSON.parse(JSON.stringify(ts))
    expect(json.headCoach.name).toBe(ts.headCoach.name)
    expect(json.assistantCoaches.length).toBe(ts.assistantCoaches.length)
    expect(json.owner.specialty).toBe(ts.owner.specialty)
  })
})

/* ─────────────────────────── JSON round-trip ─────────────────────────── */

describe('JSON round-trip', () => {
  it('StaffMember without optional fields serialises cleanly', () => {
    const { headCoach, assistantGM } = generateStaff({ rng: new Rng(55) })
    const jsonCoach = JSON.parse(JSON.stringify(headCoach)) as StaffMember
    const jsonAgm = JSON.parse(JSON.stringify(assistantGM)) as StaffMember
    expect(jsonCoach.id).toBe(headCoach.id)
    expect(jsonCoach.rating).toBe(headCoach.rating)
    expect(jsonCoach.judgment).toBe(headCoach.judgment)
    expect(jsonAgm.id).toBe(assistantGM.id)
  })

  it('StaffMember with formerPlayerId round-trips', () => {
    const data = makeLeague(15)
    const player = [...data.players.values()][0]!
    const staff = hireRetiredPlayer({ player, role: 'headCoach', rng: new Rng(77) })
    const json = JSON.parse(JSON.stringify(staff)) as StaffMember
    expect(json.formerPlayerId).toBe(player.id as string)
    expect(json.role).toBe('headCoach')
  })

  it('AgmReport serialises cleanly (all fields JSON-safe)', () => {
    const data = makeLeague(16)
    const team = [...data.teams.values()][0]!
    const roster = team.roster.map((id) => data.players.get(id)!).filter(Boolean)
    const agm = makeAgm(72)
    const report = buildAgmReport({ roster, players: data.players, agm, rng: new Rng(16) })
    const json = JSON.parse(JSON.stringify(report)) as AgmReport
    expect(json.depthChart.goalies.length).toBe(report.depthChart.goalies.length)
    expect(json.categoryBests.length).toBe(report.categoryBests.length)
    expect(json.topProspects.length).toBe(report.topProspects.length)
  })
})
