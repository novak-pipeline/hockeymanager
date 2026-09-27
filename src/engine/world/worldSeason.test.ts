import { describe, expect, it } from 'vitest'
import { leagueFormat, runBracket, runMemorialCup } from './worldSeason'

describe('world league formats', () => {
  it('names real trophies and falls back generically', () => {
    expect(leagueFormat({ abbrev: 'KHL', name: 'Kontinental Hockey League' }).trophy).toBe('Gagarin Cup')
    expect(leagueFormat({ abbrev: 'LHJMQ', name: 'x' }).trophy).toBe('President\'s Cup')
    expect(leagueFormat({ abbrev: 'SHL', name: 'Swedish Hockey League' }).field).toBe(8)
    expect(leagueFormat({ abbrev: 'ZZZ', name: 'Some League' }).trophy).toBe('ZZZ title')
  })
})

describe('runBracket', () => {
  const seeds = Array.from({ length: 16 }, (_, i) => `t${i + 1}`)
  it('plays a 16-team best-of-7 bracket to one champion', () => {
    // Better seed (lower number) always wins → t1 champion, t2 runner-up, 4–0 final.
    const r = runBracket({
      seeds,
      format: { trophy: 'X', field: 16, bestOf: [7, 7, 7, 7] },
      playGame: (h, a) => (Number(h.slice(1)) < Number(a.slice(1)) ? h : a),
    })!
    expect(r.champion).toBe('t1')
    expect(r.runnerUp).toBe('t2')
    expect(r.finalScore).toBe('4–0')
    expect(r.series).toHaveLength(15)
  })
  it('clamps the field to a power of two and single-game rounds work', () => {
    const r = runBracket({
      seeds: seeds.slice(0, 11),
      format: { trophy: 'NCAA', field: 16, bestOf: [1, 1, 1, 1] },
      playGame: (_h, a) => a, // road team always wins
    })!
    expect(r.series).toHaveLength(7) // 8-team field
    expect(r.finalScore).toBe('1–0')
  })
  it('returns null without a field', () => {
    expect(runBracket({ seeds: ['a'], format: { trophy: 'x', field: 8, bestOf: [5] }, playGame: (h) => h })).toBeNull()
  })
})

describe('Memorial Cup', () => {
  it('round robin → semi → final', () => {
    const r = runMemorialCup({
      teams: ['ohl', 'whl', 'qm', 'host'],
      playGame: (h, a) => ({ winner: h < a ? h : a, score: '3–2' }),
    })!
    expect(['host', 'ohl', 'qm', 'whl']).toContain(r.champion)
    expect(r.champion).not.toBe(r.runnerUp)
  })
})
