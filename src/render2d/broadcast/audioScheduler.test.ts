import { describe, expect, it } from 'vitest'
import { CommentaryScheduler, type AudioSink, type ClipLookup, type ClipRef } from './audioScheduler'
import type { CommentaryCue } from './types'

function rig(opts: { names?: boolean; missing?: string[] } = {}) {
  let now = 0
  const played: Array<{ at: number; ids: string[] }> = []
  let stops = 0
  const ducks: boolean[] = []
  const sink: AudioSink = {
    play: (parts) => { played.push({ at: now, ids: parts.map((p) => p.id) }) },
    stop: () => { stops++ },
    duck: (on) => { ducks.push(on) },
  }
  const lookup: ClipLookup = {
    clip: (id): ClipRef | null => (opts.missing?.includes(id) ? null : { id, durationMs: 1500 }),
    name: (pid, form, style): ClipRef | null => (opts.names ? { id: `name.${pid}.${form}.${style}`, durationMs: 600 } : null),
  }
  const s = new CommentaryScheduler(sink, lookup, () => now)
  return {
    s, played, ducks,
    stops: () => stops,
    advance: (ms: number) => { now += ms; s.tick() },
  }
}

const cue = (over: Partial<CommentaryCue> = {}): CommentaryCue => ({
  channel: 'commentary', id: 'c', clock: 'game', at: 0, speaker: 'pbp',
  lineId: 'goal.1', moment: 'goal', text: 'x', priority: 2, maxLatencyMs: 1500, ...over,
})

describe('commentary scheduler', () => {
  it('starts a line in the same call it is triggered (zero latency)', () => {
    const r = rig({ names: true })
    r.s.trigger(cue({ name: { playerId: 'p', form: 'surname', style: 'excited', position: 'lead' } }))
    expect(r.played).toEqual([{ at: 0, ids: ['name.p.surname.excited', 'stem.goal.1'] }])
  })

  it('stitches tail names after the stem', () => {
    const r = rig({ names: true })
    r.s.trigger(cue({ lineId: 'save.big.1', name: { playerId: 'g', form: 'surname', style: 'excited', position: 'tail' } }))
    expect(r.played[0]!.ids).toEqual(['stem.save.big.1', 'name.g.surname.excited'])
  })

  it('plays the BARE clip when the name is not rendered yet — never waits', () => {
    const r = rig({ names: false })
    r.s.trigger(cue({ name: { playerId: 'p', form: 'surname', style: 'excited', position: 'lead' } }))
    expect(r.played).toEqual([{ at: 0, ids: ['bare.goal.1'] }])
    expect(r.s.stats.bareFallback).toBe(1)
  })

  it('missing audio is silence (no fallback voice)', () => {
    const r = rig({ missing: ['stem.goal.1'] })
    r.s.trigger(cue())
    expect(r.played).toEqual([])
    expect(r.s.stats.droppedMissing).toBe(1)
  })

  it('a goal call barges in over chatter, landing on the moment', () => {
    const r = rig()
    r.s.trigger(cue({ lineId: 'hit.big.1', priority: 1 }))
    r.advance(300)
    r.s.trigger(cue({ lineId: 'goal.2', priority: 3, maxLatencyMs: 350 }))
    expect(r.stops()).toBe(1)
    expect(r.played[1]).toEqual({ at: 300, ids: ['stem.goal.2'] })
  })

  it('queues a lower-priority line and drops it once stale', () => {
    const r = rig()
    r.s.trigger(cue({ lineId: 'goal.1', priority: 3 }))
    r.s.trigger(cue({ lineId: 'goal.color.1', priority: 1, maxLatencyMs: 500 }))
    r.advance(1500 + 140) // first line done → queued one is 1640ms old > 500
    expect(r.played.map((p) => p.ids[0])).toEqual(['stem.goal.1'])
    expect(r.s.stats.droppedStale).toBe(1)
  })

  it('a queued line within its latency budget plays right after', () => {
    const r = rig()
    r.s.trigger(cue({ lineId: 'goal.1', priority: 3 }))
    r.s.trigger(cue({ lineId: 'goal.color.1', priority: 1, maxLatencyMs: 2500 }))
    r.advance(1640)
    expect(r.played.map((p) => [p.at, p.ids[0]])).toEqual([[0, 'stem.goal.1'], [1640, 'stem.goal.color.1']])
  })

  it('ducks the bed while talking and releases it after', () => {
    const r = rig()
    r.s.trigger(cue())
    r.advance(2000)
    expect(r.ducks).toEqual([true, false])
  })

  it('disabled scheduler is silent; cancel() stops and clears', () => {
    const r = rig()
    r.s.setEnabled(false)
    r.s.trigger(cue())
    expect(r.played).toEqual([])
    r.s.setEnabled(true)
    r.s.trigger(cue())
    r.s.trigger(cue({ lineId: 'goal.color.1', priority: 1 }))
    r.s.cancel()
    r.advance(5000)
    expect(r.played).toHaveLength(1)
  })
})
