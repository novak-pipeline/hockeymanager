import { describe, expect, it } from 'vitest'
import { approach, assignRigs, capStep, type RigSlot } from './lineChange'

const pool = (n: number): RigSlot[] => Array.from({ length: n }, () => ({ id: null, mode: 'idle' as const }))

describe('assignRigs — rigs follow players, not slots', () => {
  it('binds the first line to idle rigs', () => {
    const s = pool(8)
    const a = assignRigs(s, ['a', 'b', 'c', 'd', 'e'])
    expect(a.entered).toHaveLength(5)
    expect(s.filter((x) => x.mode === 'arriving').map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('keeps each player on his own rig when the slot order changes', () => {
    const s = pool(8)
    assignRigs(s, ['a', 'b', 'c', 'd', 'e'])
    const rigOf = (id: string) => s.findIndex((x) => x.id === id)
    const before = ['a', 'b', 'c', 'd', 'e'].map(rigOf)
    const a = assignRigs(s, ['e', 'd', 'c', 'b', 'a'])
    expect(['a', 'b', 'c', 'd', 'e'].map(rigOf)).toEqual(before)
    expect(a.entered).toEqual([])
    expect(a.left).toEqual([])
    // each rig follows its player's new index
    expect(a.follow[rigOf('a')]).toBe(4)
  })

  it('a line change sends the old players off and brings new rigs on — no rig is reused mid-ice', () => {
    const s = pool(8)
    assignRigs(s, ['a', 'b', 'c', 'd', 'e'])
    const rigA = s.findIndex((x) => x.id === 'a')
    const a = assignRigs(s, ['f', 'g', 'h', 'd', 'e'])
    expect(a.left.map((r) => s[r]!.id).sort()).toEqual(['a', 'b', 'c'])
    expect(a.entered.map((r) => s[r]!.id).sort()).toEqual(['f', 'g', 'h'])
    expect(s[rigA]!.mode).toBe('departing')
    expect(s[rigA]!.id).toBe('a')
  })

  it('when the pool is full a newcomer takes the oldest departing rig', () => {
    const s = pool(6)
    assignRigs(s, ['a', 'b', 'c', 'd', 'e'])
    assignRigs(s, ['f', 'b', 'c', 'd', 'e']) // a departs; f takes the one idle rig
    const rigA = s.findIndex((x) => x.id === 'a')
    const order = s.map((_, i) => (i === rigA ? 0 : 99))
    const a = assignRigs(s, ['f', 'g', 'c', 'd', 'e'], order) // b departs; g needs a rig
    expect(s[rigA]!.id).toBe('g')
    expect(a.entered).toContain(rigA)
  })

  it('a departing player who comes straight back resumes play on his rig', () => {
    const s = pool(8)
    assignRigs(s, ['a', 'b', 'c', 'd', 'e'])
    const rigA = s.findIndex((x) => x.id === 'a')
    assignRigs(s, ['f', 'b', 'c', 'd', 'e'])
    const a = assignRigs(s, ['a', 'b', 'c', 'd', 'e'])
    expect(s[rigA]!.mode).toBe('play')
    expect(a.entered).not.toContain(rigA)
  })
})

describe('movement helpers', () => {
  it('approach never exceeds the speed limit and reports arrival', () => {
    const r = approach(0, 0, 100, 0, 0.1, 30)
    expect(r.x).toBeCloseTo(3)
    expect(r.arrived).toBe(false)
    expect(approach(99, 0, 100, 0, 0.1, 30).arrived).toBe(true)
  })

  it('capStep turns a teleport into a skate but leaves normal motion alone', () => {
    expect(capStep(0, 0, 1, 0, 0.1, 40).capped).toBe(false)
    const t = capStep(0, 0, 80, 0, 0.1, 40)
    expect(t.capped).toBe(true)
    expect(t.x).toBeCloseTo(4)
  })
})
