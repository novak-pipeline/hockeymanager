/**
 * The decision-event library — the design rules are TESTS, not hopes.
 * Every authored event must be a real dilemma (EXCELLENCE.md B5.5): no
 * obviously-correct option, every choice costs something, and at least one
 * plants a delayed consequence.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import { isEligible } from './contentEngine'
import { DECISION_ACTS, DECISION_CTX_KEYS, DECISION_EVENTS, decisionSlots, pickDecisionEvent, type DecisionAct, type DecisionOption } from './decisionEvents'
import { CLUB_SCENES, DRAFT_CALL_EVENTS } from './clubScenes'

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
  it('no event can condition on a key the runner never populates (dead-content guard)', () => {
    // A missing ctx key silently fails min/max and equality alike, so such an
    // event would never fire and nothing would error — authored content sitting
    // dark. This test is the reason that class of bug can't ship.
    const known = new Set<string>(DECISION_CTX_KEYS)
    for (const e of DECISION_EVENTS) {
      for (const key of Object.keys(e.conditions ?? {})) {
        const base = /^(min|max)[A-Z]/.test(key) ? key[3].toLowerCase() + key.slice(4) : key
        expect(known.has(base), `${e.id} conditions on unknown ctx key "${base}"`).toBe(true)
      }
    }
  })

  it('every scene is ABOUT its subject — it is delivered as a meeting with him', () => {
    // The runner attaches each dilemma to a specific player and headlines it
    // with him (sceneHeadline). A scene that never mentions him (an
    // owner phone call, a press-conference question) reads as a non-sequitur
    // staged as a private meeting.
    for (const e of DECISION_EVENTS) {
      const namesHim = e.scene.includes('{name}') || e.scene.includes('{last}')
      expect(namesHim, `${e.id} never references its subject player`).toBe(true)
    }
  })

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

  it('a dilemma saved mid-scene keeps its AUTHORED effects after load', async () => {
    // Without persistence the interactionId→event map is lost, and answering a
    // restored dilemma silently degrades to the generic tone model: the receipt
    // and the residue both vanish. This is that regression, pinned.
    const { generateLeague } = await import('@data/generate')
    const { Career } = await import('@engine/career/career')
    const data = generateLeague({ seed: 44 })
    const userId = data.league.teams[0]!
    const c = new Career(data, 44, userId) as unknown as Record<string, any>

    const vet = c.data.players.get(c.userTeam.roster[0])!
    vet.age = 34
    vet.stats = [{ season: 2024, gamesPlayed: 800, ev: { timeOnIce: 0 }, pp: { timeOnIce: 0 }, pk: { timeOnIce: 0 } }]
    c.practiceState = { ...c.practiceState, scratched: [vet.id as string] }
    c.lastDecisionDay = -999
    c.interactions = []
    c.maybeRaiseDecisionEvent(40)
    const raised = c.interactions.find((i: any) => i.status === 'open')
    expect(raised, 'a dilemma should have been raised').toBeDefined()

    // Save and reload BEFORE answering.
    const snap = (c as any).exportSnapshot('t', 'now')
    const restored = Career.fromSnapshot(structuredClone(snap)) as unknown as Record<string, any>
    expect(restored.decisionEventFor.get(raised.id)).toBe('ev.room.healthy-scratch-vet')
    expect(restored.lastDecisionDay).toBe(40)

    const rVet = restored.data.players.get(vet.id)!
    const before = rVet.morale
    const res = restored.respondToInteraction(raised.id, 'door')
    expect(res.ok).toBe(true)
    expect(res.message.length).toBeGreaterThan(40) // the AUTHORED receipt survived
    expect(rVet.morale).toBeLessThan(before)
    expect(restored.residueFlags.some((f: any) => f.playerId === (vet.id as string) && f.kind === 'wasScratched')).toBe(true)
  })

  it('selection is deterministic for a given seed', () => {
    const ctx = { age: 34, gamesPlayed: 900, scratched: true, isLeader: false, roomTension: 10 }
    const a = pickDecisionEvent({ ctx, rng: new Rng(7), used: [], year: 2025 })?.id
    const b = pickDecisionEvent({ ctx, rng: new Rng(7), used: [], year: 2025 })?.id
    expect(a).toBe(b)
  })
})

/* ── E2: a scene may never offer an action the engine refuses ── */

describe('decisionEvents — promised actions must be real', () => {
  it('any option that tells the GM to open extension talks carries a real discount', () => {
    for (const ev of DECISION_EVENTS) {
      for (const o of ev.options) {
        if (!/extension talks/i.test(o.outcome)) continue
        expect(
          o.effects.extensionDiscount,
          `${ev.id}/${o.id} points the GM at extension talks but grants nothing`,
        ).toBeDefined()
        expect(o.effects.extensionDiscount!).toBeGreaterThan(0.5)
        expect(o.effects.extensionDiscount!).toBeLessThan(1)
      }
    }
  })

  it('any event granting an extension discount is gated to the extension window', () => {
    // Extension talks are illegal before the halfway mark of the season. A
    // scene that sells one earlier would be selling something the engine
    // refuses — exactly the bug this whole feature closes.
    for (const ev of DECISION_EVENTS) {
      const grants = ev.options.some((o) => o.effects.extensionDiscount !== undefined)
      if (!grants) continue
      const gate = (ev.conditions as Record<string, unknown> | undefined)?.['minSeasonPct']
      expect(typeof gate, `${ev.id} grants an extension discount without a minSeasonPct gate`).toBe('number')
      expect(gate as number).toBeGreaterThanOrEqual(50)
    }
  })

  it('an extension-selling event also requires the man to be in his final year', () => {
    for (const ev of DECISION_EVENTS) {
      if (!ev.options.some((o) => o.effects.extensionDiscount !== undefined)) continue
      expect((ev.conditions as Record<string, unknown> | undefined)?.['contractYearsRemaining']).toBe(1)
    }
  })
})

/* ── E3 audit: an option that says a thing HAPPENS must carry the act ── */

describe('decisionEvents — acts are real (E3 audit)', () => {
  // The phrases that describe a concrete, engine-performable action, and the act
  // an option using them must declare. Label OR receipt — both are promises.
  const ACTION_PHRASES: Array<{ re: RegExp; acts: DecisionAct[] }> = [
    { re: /\bbring him up\b|\bcall(ed)? (him )?up\b/i, acts: ['callUp'] },
    { re: /\blet him go\b|\brelease (him|me)\b/i, acts: ['release'] },
    { re: /\byou dress tomorrow\b|\bhe dressed\b|\blet him play\b/i, acts: ['dress', 'playThrough'] },
    { re: /\btake the picks\b|\btrade someone\b|\bbanked the futures\b|\bspent a player\b/i, acts: ['sell'] },
    { re: /\boff the market\b|\bnot going anywhere\b/i, acts: ['untouchable'] },
    { re: /\blet the backup run\b/i, acts: ['benchStarter'] },
    { re: /\bhe's the starter\b|\byou're my starter\b/i, acts: ['makeStarter'] },
    { re: /\bgive the kid the minutes\b/i, acts: ['topPowerPlay'] },
  ]
  const pools = [...DECISION_EVENTS, ...CLUB_SCENES]

  it('every option describing a concrete action declares the act that performs it', () => {
    for (const e of pools) {
      for (const o of e.options) {
        const text = `${o.label} ${o.outcome}`
        for (const { re, acts } of ACTION_PHRASES) {
          if (!re.test(o.label) && !(re.test(text) && /\b(dressed|banked|spent)\b/i.test(text))) continue
          // "You're my starter" is a promise about the COACH's in-game pulls, not
          // a depth-chart change — the one phrase that is a stance, not an act.
          if (e.id === 'ev.goalie.pulled-again') continue
          expect(o.effects.act !== undefined && acts.includes(o.effects.act), `${e.id}/${o.id} says "${o.label}" but performs nothing`).toBe(true)
        }
      }
    }
  })

  it('every act is one the engine performs', () => {
    for (const e of pools) for (const o of e.options) {
      if (o.effects.act !== undefined) expect(DECISION_ACTS).toContain(o.effects.act)
    }
  })

  it('acts are only offered where they can be legal', () => {
    for (const e of DECISION_EVENTS) {
      const c = (e.conditions ?? {}) as Record<string, unknown>
      for (const o of e.options) {
        const act = o.effects.act
        if (act === 'callUp' || act === 'release') expect(c['inMinors'], `${e.id}/${o.id}`).toBe(true)
        if (act === 'dress') expect(c['scratched'], `${e.id}/${o.id}`).toBe(true)
        if (act === 'makeStarter' || act === 'benchStarter') expect(c['position'], `${e.id}/${o.id}`).toBe('G')
        if (act === 'playThrough') {
          // Only a minor knock can be overruled — never a two-month injury.
          expect(typeof c['maxInjuryGames'], `${e.id}/${o.id} plays through an ungated injury`).toBe('number')
          expect(c['maxInjuryGames'] as number).toBeLessThanOrEqual(8)
        }
      }
    }
  })

  it('percent conditions use the runner\'s whole-number scale (the 0.888 dark-event bug)', () => {
    for (const e of DECISION_EVENTS) {
      for (const [k, v] of Object.entries(e.conditions ?? {})) {
        if (/SavePct|SeasonPct/.test(k)) expect(v as number, `${e.id}.${k}`).toBeGreaterThan(1)
      }
    }
  })

  it('no scene promises a drafted junior NHL ice time he cannot legally get', () => {
    for (const e of DRAFT_CALL_EVENTS) for (const o of e.options) {
      expect(o.effects.promise, `${e.id}/${o.id}`).not.toBe('iceTime')
    }
  })
})
