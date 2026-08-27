/**
 * Tests for src/engine/career/clubBeats.ts (Playtest 2026-08-26 §E1).
 *
 * Two things matter and they pull against each other: the farm must actually
 * REACH the GM's desk, and it must not spam him. The user's words were "DONT
 * SPAM IT... keep it balanced and not annoying", so the restraint is tested at
 * least as hard as the coverage.
 */
import { describe, expect, it } from 'vitest'
import {
  CLUB_BEAT_COOLDOWN_DAYS,
  MAX_CLUB_BEATS_PER_SEASON,
  detectClubBeats,
  farmBriefing,
  pickClubBeat,
  type ProspectFact,
} from './clubBeats'

function fact(o: Partial<ProspectFact> & { playerId: string }): ProspectFact {
  return {
    name: `Player ${o.playerId}`,
    position: 'C',
    age: 19,
    where: 'junior',
    leagueLabel: 'OHL',
    gamesPlayed: 40,
    goals: 10,
    points: 25,
    potential: 75,
    overall: 58,
    ...o,
  }
}

/** A junior kid running away with his league. */
const tearing = fact({ playerId: 'a', gamesPlayed: 40, points: 70, goals: 30, draftOverall: 12, draftYear: 2027 })
/** A first-rounder who has stopped producing. */
const stalled = fact({ playerId: 'b', gamesPlayed: 40, points: 10, goals: 3, draftOverall: 9, draftYear: 2027 })
/** An ordinary prospect having an ordinary season. */
const ordinary = fact({ playerId: 'c', gamesPlayed: 40, points: 30, goals: 12 })

describe('detectClubBeats — thresholds', () => {
  it('says nothing about an ordinary season', () => {
    expect(detectClubBeats({ prospects: [ordinary], told: new Set() })).toHaveLength(0)
  })

  it('says nothing at all before there is a sample worth reading', () => {
    const early = { ...tearing, gamesPlayed: 10, points: 20 }
    expect(detectClubBeats({ prospects: [early], told: new Set() })).toHaveLength(0)
  })

  it('finds the kid who is running away with his league', () => {
    const beats = detectClubBeats({ prospects: [tearing], told: new Set() })
    expect(beats.map((b) => b.kind)).toContain('tear')
    const tear = beats.find((b) => b.kind === 'tear')!
    expect(tear.headline).toContain('OHL')
    expect(tear.body).toContain('70 points')
    expect(tear.body).toContain('12th pick')
  })

  it('holds junior scoring to a higher bar than pro scoring', () => {
    // A point a game is a story in the AHL and nothing much in junior.
    const juniorPpg1 = fact({ playerId: 'j', where: 'junior', leagueLabel: 'OHL', gamesPlayed: 40, points: 40 })
    const proPpg1 = fact({ playerId: 'p', where: 'ahl', leagueLabel: 'AHL', gamesPlayed: 40, points: 40 })
    expect(detectClubBeats({ prospects: [juniorPpg1], told: new Set() }).some((b) => b.kind === 'tear')).toBe(false)
    expect(detectClubBeats({ prospects: [proPpg1], told: new Set() }).some((b) => b.kind === 'tear')).toBe(true)
  })

  it('names a real pick who has stalled, and does not name an unheralded one', () => {
    const beats = detectClubBeats({ prospects: [stalled], told: new Set() })
    expect(beats.some((b) => b.kind === 'stalled')).toBe(true)
    const nobody = fact({ playerId: 'z', gamesPlayed: 40, points: 8, potential: 60, draftOverall: 180 })
    expect(detectClubBeats({ prospects: [nobody], told: new Set() }).some((b) => b.kind === 'stalled')).toBe(false)
  })

  it('marks a young goalie who is stopping everything, and only a goalie', () => {
    const g = fact({ playerId: 'g', position: 'G', where: 'ahl', leagueLabel: 'AHL', gamesPlayed: 30, savePct: 0.931 })
    expect(detectClubBeats({ prospects: [g], told: new Set() }).some((b) => b.kind === 'goalieForm')).toBe(true)
    const skaterWithSvPct = { ...tearing, savePct: 0.940 }
    expect(
      detectClubBeats({ prospects: [skaterWithSvPct], told: new Set() }).some((b) => b.kind === 'goalieForm')
    ).toBe(false)
  })

  it('flags a farm player who has outgrown the level', () => {
    const ready = fact({
      playerId: 'r', where: 'ahl', leagueLabel: 'AHL', age: 21,
      gamesPlayed: 40, points: 36, overall: 73,
    })
    expect(detectClubBeats({ prospects: [ready], told: new Set() }).some((b) => b.kind === 'kickingTheDoor')).toBe(true)
  })
})

describe('detectClubBeats — never twice', () => {
  it('respects the told-ledger', () => {
    const told = new Set(['a:tear'])
    const beats = detectClubBeats({ prospects: [tearing], told })
    expect(beats.some((b) => b.kind === 'tear')).toBe(false)
  })

  it('keys the ledger by player AND kind, so two men can each get their story', () => {
    const beats = detectClubBeats({ prospects: [tearing, stalled], told: new Set() })
    const keys = beats.map((b) => b.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('a:tear')
    expect(keys).toContain('b:stalled')
  })
})

describe('pickClubBeat — the anti-spam contract', () => {
  const all = [tearing, stalled]

  it('stays silent inside the cooldown', () => {
    expect(
      pickClubBeat({
        prospects: all, told: new Set(),
        daysSinceLast: CLUB_BEAT_COOLDOWN_DAYS - 1, toldThisSeason: 0,
      })
    ).toBeNull()
  })

  it('speaks once the cooldown has elapsed', () => {
    const beat = pickClubBeat({
      prospects: all, told: new Set(), daysSinceLast: CLUB_BEAT_COOLDOWN_DAYS, toldThisSeason: 0,
    })
    expect(beat).not.toBeNull()
  })

  it('stops for the season once the ceiling is reached', () => {
    expect(
      pickClubBeat({
        prospects: all, told: new Set(),
        daysSinceLast: 999, toldThisSeason: MAX_CLUB_BEATS_PER_SEASON,
      })
    ).toBeNull()
  })

  it('returns exactly one beat, the most notable one, with no Rng at all', () => {
    const a = pickClubBeat({ prospects: all, told: new Set(), daysSinceLast: 999, toldThisSeason: 0 })
    const b = pickClubBeat({ prospects: [...all].reverse(), told: new Set(), daysSinceLast: 999, toldThisSeason: 0 })
    expect(a).not.toBeNull()
    expect(a!.key).toBe(b!.key) // ordering of the input cannot change the story
  })

  it('a whole season of a stacked system still cannot exceed the ceiling', () => {
    const roster = Array.from({ length: 20 }, (_, i) =>
      fact({ playerId: `p${i}`, gamesPlayed: 40, points: 75, goals: 35, draftOverall: 5, draftYear: 2027 })
    )
    const told = new Set<string>()
    let count = 0
    for (let day = 0; day < 200; day++) {
      const beat = pickClubBeat({
        prospects: roster, told,
        daysSinceLast: CLUB_BEAT_COOLDOWN_DAYS, toldThisSeason: count,
      })
      if (beat) { told.add(beat.key); count++ }
    }
    expect(count).toBe(MAX_CLUB_BEATS_PER_SEASON)
  })
})

describe('farmBriefing', () => {
  it('says nothing when the system has barely played', () => {
    expect(farmBriefing([fact({ playerId: 'a', gamesPlayed: 2 })])).toBeNull()
  })

  it('reads out the risers, the goalie and the man behind schedule', () => {
    const brief = farmBriefing([
      tearing,
      stalled,
      ordinary,
      fact({ playerId: 'g', position: 'G', where: 'ahl', leagueLabel: 'AHL', gamesPlayed: 30, savePct: 0.918 }),
    ])
    expect(brief).not.toBeNull()
    expect(brief!.headline).toMatch(/on the farm/)
    const text = brief!.facts.join(' | ')
    expect(text).toContain('Player a') // the riser
    expect(text).toContain('.918')     // the goalie, with a real number
    expect(brief!.facts.length).toBeLessThanOrEqual(4)
  })

  it('counts where the system actually is', () => {
    const brief = farmBriefing([
      fact({ playerId: '1', where: 'ahl', leagueLabel: 'AHL' }),
      fact({ playerId: '2', where: 'ahl', leagueLabel: 'AHL' }),
      fact({ playerId: '3', where: 'junior' }),
    ])
    expect(brief!.headline).toContain('2 on the farm')
    expect(brief!.headline).toContain('1 still in junior')
  })
})
