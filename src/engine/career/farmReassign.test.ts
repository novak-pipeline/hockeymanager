import { describe, expect, it } from 'vitest'
import type { Player, PlayerId } from '@domain'
import { farmSplit } from './farmReassign'

/** Minimal Player stub — only the fields farmSplit reads (id, position) plus an
 *  `ovr` we score on. */
function mk(id: string, position: Player['position'], ovr: number): Player {
  return { id: id as unknown as PlayerId, position, ovr } as unknown as Player
}

const score = (p: Player): number => (p as unknown as { ovr: number }).ovr

describe('farmSplit', () => {
  it('puts the best players on the NHL roster and the rest in the AHL', () => {
    // 16 forwards: top 14 should make the NHL, bottom 2 to AHL.
    const fwds = Array.from({ length: 16 }, (_, i) => mk(`f${i}`, 'C', 80 - i))
    const ds = Array.from({ length: 8 }, (_, i) => mk(`d${i}`, 'D', 70 - i))
    const gs = Array.from({ length: 3 }, (_, i) => mk(`g${i}`, 'G', 75 - i))
    const all = [...fwds, ...ds, ...gs]
    const resolve = (id: PlayerId): Player | undefined => all.find((p) => p.id === id)

    // Start with an arbitrary (sub-optimal) split.
    const res = farmSplit({
      nhlRoster: all.slice(0, 23).map((p) => p.id),
      ahlRoster: all.slice(23).map((p) => p.id),
      resolve,
      score,
    })

    expect(res.nhl).toHaveLength(23) // 14F + 7D + 2G
    // The lowest-rated forward must NOT be on the NHL roster.
    expect(res.nhl).not.toContain('f15' as unknown as PlayerId)
    expect(res.ahl).toContain('f15' as unknown as PlayerId)
    // Every player is placed exactly once (union preserved).
    expect(new Set([...res.nhl, ...res.ahl]).size).toBe(all.length)
  })

  it('promotes an AHL standout over a weaker NHL incumbent', () => {
    const stud = mk('stud', 'C', 90) // on AHL but clearly NHL-caliber
    const scrub = mk('scrub', 'C', 40) // on NHL but weakest
    const fillF = Array.from({ length: 13 }, (_, i) => mk(`f${i}`, 'C', 60 - i))
    const ds = Array.from({ length: 7 }, (_, i) => mk(`d${i}`, 'D', 60 - i))
    const gs = Array.from({ length: 2 }, (_, i) => mk(`g${i}`, 'G', 60 - i))
    const all = [scrub, ...fillF, ...ds, ...gs, stud]
    const resolve = (id: PlayerId): Player | undefined => all.find((p) => p.id === id)

    const res = farmSplit({
      nhlRoster: [scrub, ...fillF, ...ds, ...gs].map((p) => p.id),
      ahlRoster: [stud.id],
      resolve,
      score,
    })

    expect(res.promoted).toContain('stud' as unknown as PlayerId)
    expect(res.demoted).toContain('scrub' as unknown as PlayerId)
    expect(res.nhl).toContain('stud' as unknown as PlayerId)
    expect(res.ahl).toContain('scrub' as unknown as PlayerId)
  })

  it('is deterministic', () => {
    const all = Array.from({ length: 30 }, (_, i) => mk(`p${i}`, i % 5 === 0 ? 'D' : 'C', 70 - i))
    all.push(mk('g0', 'G', 72), mk('g1', 'G', 70), mk('g2', 'G', 60))
    const resolve = (id: PlayerId): Player | undefined => all.find((p) => p.id === id)
    const a = farmSplit({ nhlRoster: all.map((p) => p.id), ahlRoster: [], resolve, score })
    const b = farmSplit({ nhlRoster: all.map((p) => p.id), ahlRoster: [], resolve, score })
    expect(a).toEqual(b)
  })
})
