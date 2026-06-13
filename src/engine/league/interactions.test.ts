/**
 * interactions.test.ts — player→GM concern generation + response effects.
 */
import { describe, it, expect } from 'vitest'
import type { Player } from '@domain'
import { Rng } from '@engine/shared/rng'
import {
  applyInteractionResponse,
  maybeRaiseInteraction,
  type PlayerInteraction,
} from './interactions'

function makePlayer(overrides: Partial<{
  id: string
  name: string
  morale: number
  form: number
  ambition: number
  professionalism: number
  temperament: number
  contractYears: number
}>): Player {
  return {
    id: (overrides.id ?? 'p1') as unknown as Player['id'],
    name: overrides.name ?? 'Sidney Crosby',
    age: 27,
    position: 'C',
    handedness: 'L',
    role: 'sniper',
    personality: {
      ambition: overrides.ambition ?? 10,
      professionalism: overrides.professionalism ?? 10,
      loyalty: 10,
      temperament: overrides.temperament ?? 10,
      determination: 10,
    },
    contract: {
      salary: 3_000_000,
      yearsRemaining: overrides.contractYears ?? 3,
      expiryYear: 2030,
      noTradeClause: false,
      twoWay: false,
    },
    stats: [],
    fatigue: 20,
    morale: overrides.morale ?? 70,
    injuryStatus: null,
    form: overrides.form ?? 0,
  } as unknown as Player
}

function raiseFor(p: Player, seedTries = 200): PlayerInteraction | null {
  for (let s = 0; s < seedTries; s++) {
    const ix = maybeRaiseInteraction({
      player: p,
      lockerRoom: null,
      feudName: null,
      year: 2026,
      day: 10,
      rng: new Rng(s),
      nextId: 'pi0',
    })
    if (ix) return ix
  }
  return null
}

describe('maybeRaiseInteraction — generation', () => {
  it('a happy, content player never raises a concern', () => {
    const p = makePlayer({ morale: 80, ambition: 18, form: 5 })
    expect(raiseFor(p)).toBeNull()
  })

  it('a deeply unhappy, ambitious player can demand a trade', () => {
    const p = makePlayer({ morale: 15, ambition: 16 })
    const ix = raiseFor(p)
    expect(ix?.kind).toBe('tradeRequest')
    expect(ix?.severity).toBe('serious')
  })

  it('an expiring deal raises a future/contract concern', () => {
    const p = makePlayer({ morale: 50, ambition: 14, contractYears: 1 })
    const ix = raiseFor(p)
    expect(ix?.kind).toBe('future')
  })

  it('is deterministic for a given seed', () => {
    const p = makePlayer({ morale: 15, ambition: 16 })
    const args = {
      player: p, lockerRoom: null, feudName: null,
      year: 2026, day: 10, rng: new Rng(42), nextId: 'pi7',
    }
    const a = maybeRaiseInteraction({ ...args, rng: new Rng(42) })
    const b = maybeRaiseInteraction({ ...args, rng: new Rng(42) })
    expect(a).toEqual(b)
  })
})

describe('applyInteractionResponse — effects', () => {
  const tradeIx: PlayerInteraction = {
    id: 'pi0', playerId: 'p1', teamId: 't1', year: 2026, day: 10,
    kind: 'tradeRequest', severity: 'serious',
    message: '', status: 'open',
    options: [
      { id: 'supportive', label: '', tone: 'supportive' },
      { id: 'dismissive', label: '', tone: 'dismissive' },
    ],
  }

  it('a supportive response lifts morale', () => {
    const r = applyInteractionResponse({
      interaction: tradeIx,
      option: { id: 'supportive', label: '', tone: 'supportive' },
      player: makePlayer({}),
    })
    expect(r.moraleDelta).toBeGreaterThan(0)
    expect(r.escalateToTrade).toBe(false)
  })

  it('dismissing a serious trade request escalates to a formal demand', () => {
    const r = applyInteractionResponse({
      interaction: tradeIx,
      option: { id: 'dismissive', label: '', tone: 'dismissive' },
      player: makePlayer({ professionalism: 8 }),
    })
    expect(r.moraleDelta).toBeLessThan(0)
    expect(r.escalateToTrade).toBe(true)
    expect(r.news).toBeDefined()
  })

  it('professionals take a firm message better than flaky players', () => {
    const firm = { id: 'firm', label: '', tone: 'firm' as const }
    const pro = applyInteractionResponse({
      interaction: { ...tradeIx, kind: 'iceTime', severity: 'mild' },
      option: firm, player: makePlayer({ professionalism: 18 }),
    })
    const flaky = applyInteractionResponse({
      interaction: { ...tradeIx, kind: 'iceTime', severity: 'mild' },
      option: firm, player: makePlayer({ professionalism: 4 }),
    })
    expect(pro.moraleDelta).toBeGreaterThan(flaky.moraleDelta)
  })
})
