/**
 * The club-scene library holds itself to the same bar as the scanned dilemmas:
 * a real choice, every option costing something, and nothing an engine cannot
 * honour. These scenes are SUMMONED rather than scanned, which removes the
 * conditions but not the standard.
 */
import { describe, expect, it } from 'vitest'
import {
  ARRIVAL_EVENTS,
  CLUB_SCENES,
  DRAFT_CALL_EVENTS,
  FARM_TRIP_EVENTS,
} from './clubScenes'
import type { DecisionOption } from './decisionEvents'

/** Does this option cost the GM anything at all? */
function hasCost(o: DecisionOption): boolean {
  const e = o.effects
  return (
    (e.morale ?? 0) < 0 ||
    (e.roomMorale ?? 0) < 0 ||
    (e.roomRespect ?? 0) < 0 ||
    (e.leakChance ?? 0) > 0 ||
    e.residue !== undefined ||
    e.promise !== undefined
  )
}

describe('club scenes — library integrity', () => {
  it('every pool is non-empty and the aggregate contains all of them', () => {
    expect(DRAFT_CALL_EVENTS.length).toBeGreaterThan(0)
    expect(ARRIVAL_EVENTS.length).toBeGreaterThan(0)
    expect(FARM_TRIP_EVENTS.length).toBeGreaterThan(0)
    expect(CLUB_SCENES).toHaveLength(
      DRAFT_CALL_EVENTS.length + ARRIVAL_EVENTS.length + FARM_TRIP_EVENTS.length
    )
  })

  it('ids are unique', () => {
    const ids = CLUB_SCENES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every scene offers a real choice — at least three ways out', () => {
    for (const ev of CLUB_SCENES) {
      expect(ev.options.length, ev.id).toBeGreaterThanOrEqual(3)
    }
  })

  it('no option is free — every one of them costs something', () => {
    for (const ev of CLUB_SCENES) {
      for (const o of ev.options) {
        expect(hasCost(o), `${ev.id}/${o.id} is a free lunch`).toBe(true)
      }
    }
  })

  it('every scene plants at least one delayed consequence', () => {
    for (const ev of CLUB_SCENES) {
      const delayed = ev.options.some((o) => o.effects.promise !== undefined || o.effects.residue !== undefined)
      expect(delayed, `${ev.id} has no consequence that outlives the click`).toBe(true)
    }
  })

  it('every option carries a written receipt, not a shrug', () => {
    for (const ev of CLUB_SCENES) {
      for (const o of ev.options) {
        expect(o.outcome.trim().length, `${ev.id}/${o.id}`).toBeGreaterThan(60)
        expect(o.label.trim().length).toBeGreaterThan(4)
      }
    }
  })

  it('every scene names the man it is about', () => {
    for (const ev of CLUB_SCENES) {
      // Either the player's name/surname, or a club slot for the farm-trip scene.
      expect(/\{name\}|\{last\}|\{ahl\}/.test(ev.scene), ev.id).toBe(true)
    }
  })

  it('only uses slots the career layer actually fills', () => {
    const known = new Set(['name', 'last', 'age', 'gp', 'team', 'pick', 'ahl', 'round', 'via'])
    for (const ev of CLUB_SCENES) {
      const text = [ev.scene, ...ev.options.map((o) => `${o.label} ${o.outcome}`)].join(' ')
      for (const m of text.matchAll(/\{(\w+)\}/g)) {
        expect(known.has(m[1]!), `${ev.id} uses unknown slot {${m[1]}}`).toBe(true)
      }
    }
  })

  it('the ids the career layer summons by name all exist', () => {
    // These strings are duplicated in career.ts; a rename that misses one would
    // silently stop a whole beat from ever appearing.
    for (const id of [
      'ev.draft.first-pick-call',
      'ev.draft.slid-to-us-call',
      'ev.arrival.role-and-wants',
      'ev.farm.playoff-trip',
    ]) {
      expect(CLUB_SCENES.some((e) => e.id === id), id).toBe(true)
    }
  })

  it('summoned scenes carry no conditions — nothing scans them', () => {
    // A condition here would be dead weight at best and a silent no-op at worst,
    // since these are raised by name and never evaluated against a ctx.
    for (const ev of CLUB_SCENES) {
      expect(ev.conditions, `${ev.id} carries conditions nothing will ever read`).toBeUndefined()
    }
  })
})
