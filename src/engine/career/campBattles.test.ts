import { describe, expect, it } from 'vitest'
import { detectBattles, evidenceFor, rankBattle, citeCamp, battleRead, battleLabel, type CampCandidate } from './campBattles'
import type { CampBattle, CampGameLine } from './views'
import { generateLeague } from '@data/generate'
import { Career } from './career'

function cand(id: string, group: 'F' | 'D' | 'G', ability: number, over: Partial<CampCandidate> = {}): CampCandidate {
  return {
    playerId: id, name: id, position: group === 'F' ? 'C' : group, age: 25, group,
    ability, keep: ability, coachEye: 0, current: 'nhl', waiverRequired: false, ...over,
  }
}

/** A full org: 14F/7D/2G on the NHL side with a descending ladder, plus
 *  challengers from the farm at chosen abilities. */
function org(opts: { fOut?: number[]; dOut?: number[]; gOut?: number[] } = {}): CampCandidate[] {
  const out: CampCandidate[] = []
  for (let i = 0; i < 14; i++) out.push(cand(`f${i}`, 'F', 80 - i))
  for (let i = 0; i < 7; i++) out.push(cand(`d${i}`, 'D', 78 - i * 2))
  out.push(cand('g0', 'G', 82), cand('g1', 'G', 70))
  ;(opts.fOut ?? []).forEach((a, i) => out.push(cand(`fa${i}`, 'F', a, { current: 'ahl' })))
  ;(opts.dOut ?? []).forEach((a, i) => out.push(cand(`da${i}`, 'D', a, { current: 'ahl' })))
  ;(opts.gOut ?? []).forEach((a, i) => out.push(cand(`ga${i}`, 'G', a, { current: 'ahl' })))
  return out
}

const line = (over: Partial<CampGameLine>): CampGameLine => ({ game: 'in the Blue-Red game', kind: 'scrimmage', g: 0, a: 0, pm: 0, sog: 0, toiSec: 900, ...over })

describe('camp battles — detection', () => {
  it('names the contested forward spots: challengers within the band of the last men in', () => {
    // f12 = 68, f13 = 67 are the last two in; a farm forward at 67 contests.
    const { battles, opening } = detectBattles(org({ fOut: [67, 55] }))
    const f = battles.find((b) => b.group === 'F')!
    expect(f).toBeDefined()
    expect(f.contenders.map((c) => c.playerId)).toContain('fa0')
    expect(f.contenders.map((c) => c.playerId)).not.toContain('fa1') // 12 points back: no contest
    expect(f.slots).toBe(f.contenders.filter((c) => c.current === 'nhl').length)
    expect(f.label).toMatch(/forwards for the last/)
    expect(opening.F).toHaveLength(14)
  })

  it('a backup-goalie battle when the third goalie is close to the second', () => {
    const { battles } = detectBattles(org({ gOut: [69] }))
    const g = battles.find((b) => b.group === 'G')!
    expect(g.label).toBe('Backup goalie')
    expect(g.slots).toBe(1)
    expect(g.contenders.map((c) => c.playerId).sort()).toEqual(['g1', 'ga0'])
  })

  it('the 7th D label, and the waiver trap reaches further out', () => {
    const cands = org({ dOut: [62] }) // d6 = 66: 4 back, outside the 3-point band
    const d6 = cands.find((c) => c.playerId === 'd6')!
    d6.waiverRequired = true
    const { battles } = detectBattles(cands)
    const d = battles.find((b) => b.group === 'D')!
    expect(d.waiverTrap).toBe(true)
    expect(d.label).toMatch(/^The 7th D/)
    // Without the waiver trap, a 4-point gap is only a long shot (still named,
    // since nothing is closer) — but not a trap.
    const plain = detectBattles(org({ dOut: [62] })).battles.find((b) => b.group === 'D')!
    expect(plain.waiverTrap).toBeUndefined()
  })

  it('no challenger within reach → no battle at that position', () => {
    const { battles } = detectBattles(org({ fOut: [50], dOut: [40], gOut: [50] }))
    expect(battles).toHaveLength(0)
  })

  it('labels', () => {
    expect(battleLabel('F', 3, 2, 13, 14)).toBe('3 forwards for the last 2 spots')
    expect(battleLabel('G', 2, 1, 2, 2)).toBe('Backup goalie')
    expect(battleLabel('D', 2, 1, 7, 7)).toBe('The 7th D: 2 men, one spot')
  })
})

describe('camp battles — scoring from real evidence', () => {
  it('a big camp overturns a small prior gap (an upset), a quiet one does not', () => {
    const { battles } = detectBattles(org({ gOut: [69] }))
    const g = battles.find((b) => b.group === 'G')!
    const ranked0 = rankBattle(g)
    expect(ranked0.contenders.find((c) => c.winning)!.playerId).toBe('g1')
    // The challenger stops 58 of 60; the incumbent lets in 7 on 50.
    const played: CampBattle = {
      ...g,
      contenders: g.contenders.map((c) => ({
        ...c,
        lines: c.playerId === 'ga0'
          ? [line({ sa: 30, ga: 1 }), line({ kind: 'preseason', game: 'against BOS', sa: 30, ga: 1 })]
          : [line({ sa: 25, ga: 4 }), line({ kind: 'preseason', game: 'at MTL', sa: 25, ga: 3 })],
      })),
    }
    const ranked = rankBattle(played)
    expect(ranked.contenders.find((c) => c.winning)!.playerId).toBe('ga0')
    expect(ranked.contenders.find((c) => c.playerId === 'ga0')!.evidence).toBeGreaterThan(0)
    expect(ranked.contenders.find((c) => c.playerId === 'g1')!.evidence).toBeLessThan(0)
  })

  it('evidence is bounded and grows with games played', () => {
    const one = evidenceFor([line({ g: 3, a: 1, pm: 3, sog: 6 })], 'F')
    const four = evidenceFor(Array.from({ length: 4 }, () => line({ g: 3, a: 1, pm: 3, sog: 6 })), 'F')
    expect(four).toBeGreaterThan(one)
    expect(four).toBeLessThanOrEqual(6)
    expect(evidenceFor(Array.from({ length: 4 }, () => line({ pm: -4 })), 'F')).toBeGreaterThanOrEqual(-6)
  })

  it('citations quote what happened', () => {
    expect(citeCamp([line({ g: 2, a: 0, sog: 4 }), line({ kind: 'preseason', game: 'against BOS' })], 'F')).toContain('scored twice in the Blue-Red game')
    expect(citeCamp([
      line({}), line({}),
      line({ kind: 'preseason', game: 'against BOS', pm: -2 }), line({ kind: 'preseason', game: 'at MTL', pm: -1 }),
    ], 'F')).toContain('−3 in two preseason games')
    expect(citeCamp([line({ sa: 31, ga: 2 })], 'G')).toContain('stopped 29 of 31')
  })

  it('the coach read names the upset', () => {
    const { battles } = detectBattles(org({ fOut: [67] }))
    const f = battles.find((b) => b.group === 'F')!
    const played = rankBattle({
      ...f,
      contenders: f.contenders.map((c) => ({ ...c, lines: c.playerId === 'fa0' ? [line({ g: 2, a: 1, pm: 2, sog: 5 }), line({ g: 1, a: 1, pm: 1 })] : [line({ pm: -2 }), line({ pm: -1 })] })),
    })
    expect(played.contenders.find((c) => c.playerId === 'fa0')!.winning).toBe(true)
    expect(battleRead(played, 'Coach')).toMatch(/taking it from the outside/)
  })
})

describe('camp battles — the career camp', () => {
  function stagedCamp(): Career {
    for (const seed of [515, 616, 7, 42, 313]) {
      const data = generateLeague({ seed })
      const c = new Career(data, seed, data.league.teams[0])
      c.startAtOffseason()
      for (let i = 0; i < 40; i++) {
        if (c.getDashboard().phase !== 'offseason') break
        c.advanceOffseason()
      }
      const camp = c.getTrainingCamp()
      if (camp && (camp.battles ?? []).length > 0) return c
    }
    throw new Error('no seed staged a battle')
  }

  it('camp games are played by the sim, and the coach plan is RE-evaluated from them', () => {
    const c = stagedCamp()
    const open = c.getTrainingCamp()!
    expect(open.campDay).toBe(1)
    expect(open.battles!.length).toBeGreaterThan(0)
    expect(open.battles!.every((b) => b.contenders.every((x) => x.lines.length === 0))).toBe(true)
    const planAtOpen = new Map(open.decisions.map((d) => [d.playerId, d.coachPlan]))

    c.advanceTrainingCampDay() // the Blue-Red scrimmages
    const mid = c.getTrainingCamp()!
    expect(mid.campDay).toBe(3)
    expect(mid.games!.filter((g) => g.kind === 'scrimmage')).toHaveLength(2)
    // Real box scores: goals across the camp equal the scorelines' goals.
    const goals = mid.scrimmage!.skaters.reduce((s, x) => s + x.g, 0)
    const scored = mid.scrimmage!.results.reduce((s, r) => s + [...r.matchAll(/(\d+)/g)].reduce((t, m) => t + Number(m[1]), 0), 0)
    expect(goals).toBe(scored)
    expect(mid.battles!.some((b) => b.contenders.some((x) => x.lines.length > 0))).toBe(true)

    c.advanceTrainingCampDay() // preseason → cut day
    const cut = c.getTrainingCamp()!
    expect(cut.campDay).toBe(8)
    expect(cut.games!.filter((g) => g.kind === 'preseason').length).toBeGreaterThanOrEqual(1)
    // Every battle contender's cut-day call follows the RANKING, not the open.
    for (const b of cut.battles!) {
      expect(b.contenders.filter((x) => x.winning)).toHaveLength(b.slots)
      for (const x of b.contenders) {
        const d = cut.decisions.find((dd) => dd.playerId === x.playerId)!
        expect(d.coachPlan).toBe(x.winning ? 'nhl' : 'ahl')
        if (x.lines.length > 0) expect(d.line).toMatch(/^(Winning|Losing) /)
      }
    }
    expect(cut.reports!.length).toBe(cut.decisions.length)
    expect(planAtOpen.size).toBeGreaterThan(0)

    // Break camp with the coach's calls: 23-man shape holds.
    const res = c.submitTrainingCamp([])
    expect(res.ok).toBe(true)
    expect((c as unknown as { userTeam: { roster: string[] } }).userTeam.roster.length).toBeLessThanOrEqual(23)
    expect(c.getTrainingCamp()).toBeNull()
  }, 120_000)

  it('the GM can overrule a battle, and give a contender the look', () => {
    const c = stagedCamp()
    const open = c.getTrainingCamp()!
    const b = open.battles![0]!
    const chaser = b.contenders.find((x) => !x.winning)!
    expect(c.setCampLook([chaser.playerId]).ok).toBe(true)
    expect(c.getTrainingCamp()!.look).toEqual([chaser.playerId])
    expect(c.setCampLook(['nobody']).ok).toBe(true) // non-contenders are ignored
    expect(c.getTrainingCamp()!.look).toEqual([])
    c.setCampLook([chaser.playerId])
    c.advanceTrainingCampDay()
    c.advanceTrainingCampDay()
    const cut = c.getTrainingCamp()!
    const bb = cut.battles!.find((x) => x.id === b.id)!
    const loser = bb.contenders.find((x) => !x.winning)!
    const winner = bb.contenders.find((x) => x.winning)!
    // Swap the verdict: the loser up, the winner down.
    const res = c.submitTrainingCamp([
      { playerId: loser.playerId, place: 'nhl' },
      { playerId: winner.playerId, place: 'ahl' },
    ])
    expect(res.ok).toBe(true)
    const onNhl = new Set((c as unknown as { userTeam: { roster: string[] } }).userTeam.roster.map((id) => id as string))
    if (!loser.tryout || res.notes.some((n) => n.includes(loser.name) && n.includes('contract'))) {
      expect(onNhl.has(loser.playerId) || res.notes.some((n) => n.includes(loser.name))).toBe(true)
    }
  }, 120_000)
})
