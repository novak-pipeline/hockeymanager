/**
 * The decision-event library — the design rules are TESTS, not hopes.
 * Every authored event must be a real dilemma (EXCELLENCE.md B5.5): no
 * obviously-correct option, every choice costs something, and at least one
 * plants a delayed consequence.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import { isEligible } from './contentEngine'
import { DECISION_EVENTS, decisionSlots, pickDecisionEvent, type DecisionOption } from './decisionEvents'

/** Does this option cost the GM anything at all? */
function hasCost(o: DecisionOption): boolean {
  const e = o.effects
  return (
    (e.morale ?? 0) < 0 ||
    (e.roomMorale ?? 0) < 0 ||
    (e.roomRespect ?? 0) < 0 ||
    (e.leakChance ?? 0) > 0 ||
    e.residue !== undefined ||
    e.promise !== undefined // a promise is a debt: it can be broken
  )
}

describe('decisionEvents — library integrity', () => {
  it('every event has a unique id and at least two options', () => {
    const ids = DECISION_EVENTS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of DECISION_EVENTS) {
      expect(e.options.length, e.id).toBeGreaterThanOrEqual(2)
      expect(new Set(e.options.map((o) => o.id)).size, e.id).toBe(e.options.length)
    }
  })

  it('NO option is free — every choice costs something real', () => {
    for (const e of DECISION_EVENTS) {
      for (const o of e.options) {
        expect(hasCost(o), `${e.id}/${o.id} is a free lunch`).toBe(true)
      }
    }
  })

  it('every event plants at least one delayed consequence (promise or residue)', () => {
    for (const e of DECISION_EVENTS) {
      const delayed = e.options.some((o) => o.effects.promise !== undefined || o.effects.residue !== undefined)
      expect(delayed, `${e.id} has no delayed consequence`).toBe(true)
    }
  })

  it('scenes and outcomes are written, specific, and slot-clean after filling', () => {
    const player = { name: 'Sidney Crosby', age: 38, personality: {} } as never as import('@domain').Player
    const slots = decisionSlots(player, 1287, 'Pittsburgh')
    for (const e of DECISION_EVENTS) {
      expect(e.scene.length, e.id).toBeGreaterThan(80) // a scene, not a toast
      const filled = e.scene.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, k: string) => slots[k] ?? `{${k}}`)
      expect(filled, e.id).not.toMatch(/\{[a-zA-Z]+\}/) // every slot is fillable
      for (const o of e.options) {
        expect(o.label.length, `${e.id}/${o.id}`).toBeGreaterThan(8)
        expect(o.outcome.length, `${e.id}/${o.id}`).toBeGreaterThan(40) // a receipt
      }
    }
  })

  it('slots include the games-played figure, formatted', () => {
    const player = { name: 'Sidney Crosby', age: 38 } as never as import('@domain').Player
    expect(decisionSlots(player, 1287, 'Pittsburgh').gp).toBe('1,287')
    expect(decisionSlots(player, 1287, 'Pittsburgh').last).toBe('Crosby')
  })
})

describe('decisionEvents — trigger selection', () => {
  it('the scratched-veteran event fires only for a scratched, long-serving vet', () => {
    const vet = { age: 34, gamesPlayed: 900, scratched: true }
    const kid = { age: 22, gamesPlayed: 40, scratched: true }
    const ev = DECISION_EVENTS.find((e) => e.id === 'ev.room.healthy-scratch-vet')!
    expect(isEligible({ id: ev.id, conditions: ev.conditions!, text: '' }, vet)).toBe(true)
    expect(isEligible({ id: ev.id, conditions: ev.conditions!, text: '' }, kid)).toBe(false)
  })

  it('picks the most specific eligible dilemma', () => {
    const ctx = { age: 34, gamesPlayed: 900, scratched: true, isLeader: false, roomTension: 10 }
    const first = pickDecisionEvent({ ctx, rng: new Rng(1), used: [], year: 2025 })
    expect(first?.id).toBe('ev.room.healthy-scratch-vet')
  })

  it('a dilemma already asked this season goes SILENT rather than repeating', () => {
    // Unlike flavour text (which recycles a least-recently-used line so the
    // world never goes quiet), asking the same crossroads twice reads as amnesia.
    const ctx = { age: 34, gamesPlayed: 900, scratched: true, isLeader: false, roomTension: 10 }
    const again = pickDecisionEvent({
      ctx, rng: new Rng(1),
      used: [{ variantId: 'ev.room.healthy-scratch-vet', year: 2025 }], year: 2025,
    })
    expect(again).toBeNull()
    // …and a new season makes it askable again.
    const nextYear = pickDecisionEvent({
      ctx, rng: new Rng(1),
      used: [{ variantId: 'ev.room.healthy-scratch-vet', year: 2025 }], year: 2026,
    })
    expect(nextYear?.id).toBe('ev.room.healthy-scratch-vet')
  })

  it('nothing fires when no trigger matches — silence beats a nonsense scene', () => {
    const quiet = { age: 26, gamesPlayed: 300, scratched: false, isLeader: false, roomTension: 5, losingStreak: 0 }
    expect(pickDecisionEvent({ ctx: quiet, rng: new Rng(1), used: [], year: 2025 })).toBeNull()
  })

  it('career integration: a dilemma raises as an answerable interaction and its effects land', async () => {
    const { generateLeague } = await import('@data/generate')
    const { Career } = await import('@engine/career/career')
    const data = generateLeague({ seed: 31 })
    const userId = data.league.teams[0]!
    const c = new Career(data, 31, userId) as unknown as Record<string, any>

    // Force the worked example: a long-serving vet, scratched, off cooldown.
    const vet = c.data.players.get(c.userTeam.roster[0])!
    vet.age = 34
    vet.stats = [{ season: 2024, gamesPlayed: 800, ev: { timeOnIce: 0 }, pp: { timeOnIce: 0 }, pk: { timeOnIce: 0 } }]
    c.practiceState = { ...c.practiceState, scratched: [vet.id as string] }
    c.lastDecisionDay = -999
    c.interactions = []
    c.maybeRaiseDecisionEvent(40)

    const open = c.interactions.filter((i: any) => i.status === 'open')
    expect(open.length, 'a dilemma should have been raised').toBe(1)
    expect(open[0].message).toContain(vet.name)
    expect(open[0].options.length).toBeGreaterThanOrEqual(2)

    // Answering the "door's behind you" option must actually cost him morale
    // AND leave permanent residue the world remembers.
    const before = vet.morale
    const res = c.respondToInteraction(open[0].id, 'door')
    expect(res.ok).toBe(true)
    expect(res.message.length).toBeGreaterThan(40) // the receipt
    expect(vet.morale).toBeLessThan(before)
    expect(c.residueFlags.some((f: any) => f.playerId === (vet.id as string) && f.kind === 'wasScratched')).toBe(true)
    expect(c.interactions[0].status).toBe('resolved')
  })

  it('selection is deterministic for a given seed', () => {
    const ctx = { age: 34, gamesPlayed: 900, scratched: true, isLeader: false, roomTension: 10 }
    const a = pickDecisionEvent({ ctx, rng: new Rng(7), used: [], year: 2025 })?.id
    const b = pickDecisionEvent({ ctx, rng: new Rng(7), used: [], year: 2025 })?.id
    expect(a).toBe(b)
  })
})
