/**
 * Trade-talk dialogue: pool hygiene, arc register, and the REPETITION
 * MEASUREMENT that the user's bug report is really about — "it uses the same
 * base dialogue". A negotiation must never say the same thing twice, and two
 * different negotiations in a season must not read like transcripts of each
 * other.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import { isEligible, type ContentUse } from './contentEngine'
import {
  TRADE_TALK_POOLS,
  pickTradeVariant,
  speakTradeLine,
  talkPersona,
  talkRapport,
  type TalkBeat,
  type TalkCtx,
  type TalkSlots,
} from './tradeTalk'

const SLOTS: TalkSlots = {
  target: 'Petrov',
  ask: 'Ruiz and your 2027 second',
  package: 'Braden Ruiz and a first',
  need: 'blue line',
  team: 'Nashville',
  short: '27%',
}

const BEATS: TalkBeat[] = [
  'pitch', 'counter', 'final', 'walk', 'cooloff', 'gauge', 'lapse', 'shortfall',
]

function ctx(over: Partial<TalkCtx> = {}): TalkCtx {
  return {
    beat: 'counter',
    round: 1,
    persona: 'straight',
    moved: 'opening',
    gap: 'real',
    concessions: 0,
    stalls: 0,
    rapport: 'neutral',
    deadline: false,
    chasingCore: false,
    lean: 'none',
    ...over,
  }
}

describe('trade-talk pools', () => {
  it('every variant id is unique across every beat', () => {
    const ids = BEATS.flatMap((b) => TRADE_TALK_POOLS[b].map((v) => v.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every beat carries a real pool, not a single template', () => {
    for (const b of BEATS) {
      expect(TRADE_TALK_POOLS[b].length, `${b} pool`).toBeGreaterThanOrEqual(6)
    }
    // The two beats the user actually hits over and over get the full bar.
    expect(TRADE_TALK_POOLS.counter.length).toBeGreaterThanOrEqual(20)
    expect(TRADE_TALK_POOLS.pitch.length).toBeGreaterThanOrEqual(8)
  })

  it('every slot a template references is one the caller always fills', () => {
    const known = new Set(Object.keys(SLOTS))
    for (const b of BEATS) {
      for (const v of TRADE_TALK_POOLS[b]) {
        for (const m of v.text.matchAll(/\{([a-zA-Z0-9_.]+)\}/g)) {
          expect(known.has(m[1]!), `${v.id} references {${m[1]}}`).toBe(true)
        }
      }
    }
  })

  it('every line is SPOKEN — first person, no speaker prefix, no narration', () => {
    for (const b of BEATS) {
      for (const v of TRADE_TALK_POOLS[b]) {
        // A "Marcus Webb:" speaker prefix would be read aloud as "colon" by
        // the phone — that was the shape of the old counter-offer line.
        expect(v.text, v.id).not.toMatch(/^[A-Z][\w.'-]*(\s[A-Z][\w.'-]*)*:\s/)
        // Third-person club narration is card prose, not something a man says.
        // ("Nashville are after Petrov. On the table: …" was the old bug.)
        expect(v.text, v.id).not.toMatch(/\{team\}/)
        expect(v.text, v.id).not.toMatch(/^(The|Their) (club|team|front office|GM)\b/)
        expect(v.text, v.id).not.toMatch(/\bOn the table:/)
        // He has to be talking, so a first- or second-person marker must appear.
        expect(v.text, v.id).toMatch(/\b(I|we|us|our|me|my|you|your|yours)\b/i)
      }
    }
  })
})

describe('selection follows the arc, not just the persona', () => {
  it('a concession and a hold can never draw from each other', () => {
    const conceded = pickTradeVariant({ ctx: ctx({ moved: 'conceded', round: 2 }), rng: new Rng(1), year: 2030 })
    const held = pickTradeVariant({ ctx: ctx({ moved: 'held', round: 2 }), rng: new Rng(1), year: 2030 })
    expect(conceded!.conditions!.moved).toBe('conceded')
    expect(held!.conditions!.moved).toBe('held')
    expect(conceded!.id).not.toBe(held!.id)
  })

  it('a man who has come up twice says so', () => {
    const v = pickTradeVariant({
      ctx: ctx({ moved: 'conceded', round: 3, concessions: 2 }),
      rng: new Rng(4),
      year: 2030,
    })
    expect(v!.id).toBe('tt.co.conc.twice')
    expect(v!.text).toMatch(/twice/)
  })

  it('a third call that has gone nowhere sounds like a third call', () => {
    const v = pickTradeVariant({
      ctx: ctx({ moved: 'held', round: 3 }),
      rng: new Rng(9),
      year: 2030,
    })
    expect(Object.keys(v!.conditions ?? {})).toContain('minRound')
    expect(v!.text).toMatch(/Three calls/)
  })

  it('round one never references history it does not have', () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const persona of ['shark', 'stone', 'straight'] as const) {
        for (const gap of ['slim', 'real', 'wide'] as const) {
          const v = pickTradeVariant({
            ctx: ctx({ moved: 'opening', round: 1, persona, gap }),
            rng: new Rng(seed),
            year: 2030,
          })
          expect(v!.conditions!.moved).toBe('opening')
          expect(v!.text, v!.id).not.toMatch(/again|last time|since we|come down|twice/i)
        }
      }
    }
  })

  it('the most specific eligible line wins over the generic one', () => {
    const v = pickTradeVariant({
      ctx: ctx({ moved: 'opening', gap: 'wide', persona: 'shark' }),
      rng: new Rng(3),
      year: 2030,
    })
    expect(v!.id).toBe('tt.co.r1.wide.shark')
  })

  it('is deterministic — same state, same seed, same words', () => {
    const say = (): string =>
      speakTradeLine({ ctx: ctx({ moved: 'held', round: 2 }), slots: SLOTS, rng: new Rng(77), year: 2030, day: 40 })
    expect(say()).toBe(say())
  })

  it('fills its slots — no raw {placeholders} ever reach the ear', () => {
    for (const b of BEATS) {
      for (let seed = 0; seed < 25; seed++) {
        const line = speakTradeLine({
          ctx: ctx({ beat: b, lean: b === 'gauge' ? 'tepid' : 'none' }),
          slots: SLOTS,
          rng: new Rng(seed),
          year: 2030,
          day: 10,
        })
        expect(line, `${b}/${seed}`).not.toMatch(/\{|\}/)
        expect(line.length).toBeGreaterThan(20)
      }
    }
  })
})

describe('persona + rapport bands', () => {
  it('maps the existing GmPersona axes without inventing sim values', () => {
    expect(talkPersona({ aggression: 0.8, patience: 0.9 })).toBe('shark')
    expect(talkPersona({ aggression: 0.2, patience: 0.8 })).toBe('stone')
    expect(talkPersona({ aggression: 0.3, patience: 0.3 })).toBe('straight')
    expect(talkRapport(80)).toBe('warm')
    expect(talkRapport(50)).toBe('neutral')
    expect(talkRapport(20)).toBe('frosty')
  })
})

/* ─────────────────────── the measurement ───────────────────────
 * The user found this bug by NOTICING A REPEAT. So the gate is a count, not
 * a feeling: simulate many full negotiations and count verbatim repeats.
 */
describe('repetition measurement', () => {
  interface Said {
    line: string
    variantId: string
    /** Unused-this-season variants that were eligible when he said it. */
    freshBefore: number
  }

  /** One negotiation: pitch → counters → (final) → walk, sharing one save ledger. */
  function runThread(args: {
    seed: number
    ledger: ContentUse[]
    year: number
    rounds: number
  }): Said[] {
    const rng = new Rng(args.seed)
    const persona = (['shark', 'stone', 'straight'] as const)[args.seed % 3]!
    const rapport = (['warm', 'neutral', 'frosty'] as const)[(args.seed >> 2) % 3]!
    const deadline = args.seed % 5 === 0
    const said: Said[] = []
    let day = 10
    let concessions = 0
    let stalls = 0

    const say = (over: Partial<TalkCtx>): void => {
      day += 3
      const c = ctx({ persona, rapport, deadline, concessions, stalls, ...over })
      const usedThisYear = new Set(
        args.ledger.filter((u) => u.year === args.year).map((u) => u.variantId),
      )
      const freshBefore = TRADE_TALK_POOLS[c.beat].filter(
        (v) => isEligible(v, c) && !usedThisYear.has(v.id),
      ).length
      const line = speakTradeLine({
        ctx: c, slots: SLOTS, rng, year: args.year, day, ledger: args.ledger,
      })
      said.push({ line, variantId: args.ledger[args.ledger.length - 1]!.variantId, freshBefore })
    }

    say({ beat: 'pitch', round: 1 })
    for (let r = 1; r <= args.rounds; r++) {
      const moved = r === 1 ? 'opening' : (['conceded', 'held', 'held', 'hardened'] as const)[(args.seed + r) % 4]!
      if (moved === 'conceded') concessions++
      if (moved === 'held') stalls++
      const last = r === args.rounds
      say({
        beat: last ? 'final' : 'counter',
        round: r,
        moved,
        gap: (['slim', 'real', 'wide'] as const)[(args.seed + r) % 3]!,
      })
    }
    say({ beat: 'walk', round: args.rounds + 1 })
    return said
  }

  it('never repeats a line inside one negotiation', () => {
    for (let seed = 0; seed < 200; seed++) {
      const lines = runThread({ seed, ledger: [], year: 2030, rounds: 4 }).map((s) => s.line)
      expect(new Set(lines).size, `thread ${seed} repeated a line`).toBe(lines.length)
    }
  })

  /** One save, one season, one shared ledger — the real conditions. */
  function season(threads: number): { all: Said[]; perThread: Said[][] } {
    const ledger: ContentUse[] = []
    const perThread: Said[][] = []
    for (let seed = 0; seed < threads; seed++) {
      perThread.push(runThread({ seed, ledger, year: 2030, rounds: 4 }))
    }
    return { all: perThread.flat(), perThread }
  }

  const rate = (said: Said[]): number => 1 - new Set(said.map((s) => s.line)).size / said.length

  it('measures cross-thread repetition across a season of trade calls', () => {
    for (const n of [4, 8, 12, 40]) {
      const { all } = season(n)
      // eslint-disable-next-line no-console
      console.log(
        `[trade-talk] ${n} negotiations → ${all.length} spoken lines, ` +
          `${new Set(all.map((s) => s.line)).size} distinct ` +
          `(${(rate(all) * 100).toFixed(1)}% repeat)`,
      )
    }
    // A realistic season for one club is a handful of live pursuits. At that
    // volume the GM is never caught repeating himself at all. (Measured
    // 2026-08-27: 4 → 0.0%, 8 → 0.0%, 12 → 4.2%, 40 → 63.7%.)
    expect(rate(season(4).all)).toBe(0)
    expect(rate(season(8).all)).toBe(0)
    expect(rate(season(12).all)).toBeLessThan(0.1)
    // Past that the finite pools saturate — but every repeat there is forced,
    // as the next test proves. The old behaviour was ONE line, i.e. 100%
    // repeat from the second call onwards.
    expect(rate(season(40).all)).toBeLessThan(0.7)
  })

  it('only ever repeats once nothing fresh is left to say', () => {
    // The real guarantee behind the numbers: a duplicate is possible only when
    // every eligible authored alternative has already been spent this season.
    const { all } = season(40)
    const seen = new Set<string>()
    let forced = 0
    for (const s of all) {
      if (seen.has(s.line)) {
        expect(s.freshBefore, `repeated "${s.line.slice(0, 40)}…" with fresh left`).toBe(0)
        forced++
      }
      seen.add(s.line)
    }
    // And it did genuinely exhaust pools at that volume — otherwise the check
    // above passes vacuously and proves nothing.
    expect(forced).toBeGreaterThan(0)
  })

  it('a fresh season reopens the pools rather than going silent', () => {
    const ledger: ContentUse[] = []
    for (let seed = 0; seed < 30; seed++) runThread({ seed, ledger, year: 2030, rounds: 4 })
    const next = runThread({ seed: 1, ledger, year: 2031, rounds: 4 })
    expect(new Set(next.map((s) => s.line)).size).toBe(next.length)
    expect(next.every((s) => s.line.length > 20)).toBe(true)
  })
})
