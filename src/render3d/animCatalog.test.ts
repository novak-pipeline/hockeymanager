/**
 * Animation selection + blending helpers (pure): which authored clip an event
 * plays, how clips mask onto the skeleton, and how weights evolve.
 */
import { describe, it, expect } from 'vitest'
import {
  CLIPS,
  SKATER_CLIPS,
  GOALIE_CLIPS,
  maskWeight,
  envelope,
  shotClipFor,
  SHOT_VARIANTS,
  saveClipFor,
  distToBoards,
  hitPlan,
  celebrationFor,
  locomotionWeights,
  wantsHockeyStop,
  hash01,
  BOARDS_PIN_FT,
} from './animCatalog'
import { planCues, extractActionCues, type ActionCue } from './choreo'
import { asPlayerId, type GameStream } from '@domain'

describe('clip catalogue', () => {
  it('covers the full brief: locomotion, puck skills, hitting, goalie, celebrations, broadcast moments', () => {
    for (const n of [
      'skate_stride', 'skate_glide', 'skate_crossover_L', 'skate_crossover_R', 'skate_back', 'hockey_stop', 'stickhandle',
      'shot_wrist', 'shot_slap', 'shot_onetimer', 'pass', 'faceoff_crouch', 'faceoff_draw',
      'check', 'check_boards', 'hit_stagger', 'hit_stumble', 'hit_fall', 'getup', 'pinned_boards',
      'celly_fistpump', 'celly_armsup', 'celly_hug', 'rookie_lap', 'salute', 'bench_standup',
    ]) expect(SKATER_CLIPS).toContain(n)
    for (const n of ['g_stance', 'g_butterfly', 'g_glove_save', 'g_blocker_save', 'g_pad_save', 'g_scramble', 'g_dejected']) {
      expect(GOALIE_CLIPS).toContain(n)
    }
  })

  it('every one-shot with a contact frame puts it inside the clip, and chained clips exist', () => {
    for (const [name, m] of Object.entries(CLIPS)) {
      if (m.contact !== undefined) expect(m.contact, name).toBeGreaterThanOrEqual(0)
      if (m.next) expect(CLIPS[m.next], name).toBeDefined()
      expect(m.fadeIn).toBeGreaterThanOrEqual(0)
      expect(m.fadeOut).toBeGreaterThan(0)
    }
  })
})

describe('layer masks', () => {
  it('upper-body clips never touch the legs; lower never touch the arms; nothing touches root', () => {
    expect(maskWeight('upper', 'thigh_L')).toBe(0)
    expect(maskWeight('upper', 'hips')).toBe(0)
    expect(maskWeight('upper', 'stick')).toBe(1)
    expect(maskWeight('upper', 'forearm_R')).toBe(1)
    expect(maskWeight('lower', 'forearm_R')).toBe(0)
    expect(maskWeight('lower', 'shin_R')).toBe(1)
    expect(maskWeight('full', 'shin_R')).toBe(1)
    for (const m of ['upper', 'lower', 'full'] as const) expect(maskWeight(m, 'root')).toBe(0)
  })
})

describe('envelope', () => {
  it('fades in, holds at 1, fades out, and is continuous', () => {
    expect(envelope(0, 1, 0.2, 0.2)).toBe(0)
    expect(envelope(0.5, 1, 0.2, 0.2)).toBe(1)
    expect(envelope(1, 1, 0.2, 0.2)).toBe(0)
    let prev = 0
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const w = envelope(t, 1, 0.2, 0.2)
      expect(Math.abs(w - prev)).toBeLessThan(0.1)
      prev = w
    }
  })
  it('hold extends the end pose', () => {
    expect(envelope(1.3, 1, 0.1, 0.1, 0.5)).toBe(1)
    expect(envelope(1.51, 1, 0.1, 0.1, 0.5)).toBe(0)
  })
})

describe('shot selection', () => {
  it('a shot right after a pass to the shooter is a one-timer', () => {
    expect(shotClipFor(20, 0.4)).toBe('shot_onetimer')
    expect(shotClipFor(60, 0.4)).toBe('shot_onetimer')
  })
  it('point shots are slapshots, close shots wristers', () => {
    expect(shotClipFor(55, null)).toBe('shot_slap')
    expect(shotClipFor(18, null)).toBe('shot_wrist')
    expect(shotClipFor(18, 3)).toBe('shot_wrist') // the pass was long ago
  })
  it('every engine shot type has its own clips, variants picked stably per player + shot', () => {
    for (const [type, clips] of Object.entries(SHOT_VARIANTS)) {
      const seen = new Set<string>()
      for (let i = 0; i < 40; i++) {
        const c = shotClipFor(30, null, 0.8, type, `p${i}@${i * 3.1}`)
        expect(clips).toContain(c)
        expect(shotClipFor(30, null, 0.8, type, `p${i}@${i * 3.1}`)).toBe(c)
        seen.add(c)
      }
      expect(seen.size).toBe(clips.length) // every variant actually shows up
      for (const c of clips) expect(SKATER_CLIPS).toContain(c)
    }
    expect(shotClipFor(12, null, 0.8, 'deflection')).toBe('shot_tip')
  })
})

describe('save selection', () => {
  it('glove side high → glove save, blocker side high → blocker save, low wide → pad save', () => {
    // find ids that hash high / low so the test is independent of the hash constants
    let hi = '', lo = ''
    for (let i = 0; i < 200 && (!hi || !lo); i++) {
      const id = 'g' + i
      if (!hi && hash01(id) > 0.9) hi = id
      if (!lo && hash01(id) < 0.1) lo = id
    }
    expect(saveClipFor(1.5, 30, hi, false)).toBe('g_glove_save')
    expect(saveClipFor(-1.5, 30, hi, false)).toBe('g_blocker_save')
    expect(saveClipFor(1.5, 10, lo, false)).toBe('g_pad_save')
    expect(saveClipFor(0.2, 10, lo, false)).toBe('g_butterfly')
  })
  it('some wide rebounds become scrambles (not every one)', () => {
    const ids = Array.from({ length: 60 }, (_, i) => 'r' + i)
    const n = ids.filter((id) => saveClipFor(3, 10, id, true) === 'g_scramble').length
    expect(n).toBeGreaterThan(10)
    expect(n).toBeLessThan(50)
    expect(ids.some((id) => saveClipFor(1, 10, id, true) === 'g_scramble')).toBe(false)
  })
})

describe('boards + hits', () => {
  it('distance to the rounded boards', () => {
    expect(distToBoards(0, 0)).toBeCloseTo(42.5)
    expect(distToBoards(0, 40)).toBeCloseTo(2.5)
    expect(distToBoards(98, 0)).toBeCloseTo(2)
    // corner: the rounded corner is further in than the square one
    expect(distToBoards(95, 38)).toBeLessThan(0)
    expect(distToBoards(80, 30)).toBeGreaterThan(0)
  })
  it('a hit near the boards pins; in open ice hardness grows with relative speed', () => {
    const pin = hitPlan(20, BOARDS_PIN_FT - 1)
    expect(pin.pinned).toBe(true)
    expect(pin.hitter).toBe('check_boards')
    expect(pin.target).toBe('pinned_boards')
    expect(hitPlan(5, 30).target).toBe('hit_stagger')
    expect(hitPlan(16, 30).target).toBe('hit_stumble')
    expect(hitPlan(28, 30).target).toBe('hit_fall')
    expect(hitPlan(28, 30).hitter).toBe('check')
    expect(hitPlan(40, 30).hardness).toBe(1)
    expect(hitPlan(0, 30).hardness).toBe(0)
  })
  it('the engine\'s force + kind win over the closing-speed guess (agent engine)', () => {
    // a slow closing speed but a thunderous hit → knocked down
    expect(hitPlan(2, 30, 0.9, 'openIce').target).toBe('hit_fall')
    // near the boards but an open-ice hit → not pinned
    expect(hitPlan(20, BOARDS_PIN_FT - 1, 0.5, 'openIce').pinned).toBe(false)
    // a boards pin even a few feet off the wall
    expect(hitPlan(20, 30, 0.5, 'boards').target).toBe('pinned_boards')
    // a battle is a shove, never a knockdown
    const b = hitPlan(30, 30, 1, 'battle')
    expect(b.target).toBe('hit_stagger')
    expect(b.hardness).toBeLessThanOrEqual(0.4)
  })
})

describe('celebrations', () => {
  it('a player keeps the same celebration (stable, not random)', () => {
    expect(celebrationFor('p42')).toBe(celebrationFor('p42'))
    const kinds = new Set(Array.from({ length: 40 }, (_, i) => celebrationFor('p' + i)))
    expect(kinds.size).toBe(2)
  })
})

describe('locomotion weights', () => {
  const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0)
  it('always sum to 1', () => {
    for (const speed of [0, 0.1, 0.3, 0.6, 1]) {
      for (const turnRate of [-3, -1, 0, 1.2, 3]) {
        for (const backward of [0, 0.5, 1]) {
          expect(sum(locomotionWeights({ speed, turnRate, backward, decel: 0 }))).toBeCloseTo(1, 5)
        }
      }
    }
  })
  it('standing still glides, fast skating strides, hard turns cross over the right way, backing up skates backward', () => {
    expect(locomotionWeights({ speed: 0, turnRate: 0, backward: 0, decel: 0 }).skate_glide).toBeCloseTo(1)
    expect(locomotionWeights({ speed: 0.9, turnRate: 0, backward: 0, decel: 0 }).skate_stride).toBeCloseTo(1)
    expect(locomotionWeights({ speed: 0.7, turnRate: 2.5, backward: 0, decel: 0 }).skate_crossover_L).toBeGreaterThan(0.9)
    expect(locomotionWeights({ speed: 0.7, turnRate: -2.5, backward: 0, decel: 0 }).skate_crossover_R).toBeGreaterThan(0.9)
    expect(locomotionWeights({ speed: 0.5, turnRate: 0, backward: 1, decel: 0 }).skate_back).toBeCloseTo(1)
  })
  it('is continuous (no pops) as speed and turn rate sweep', () => {
    let prev = locomotionWeights({ speed: 0, turnRate: 0, backward: 0, decel: 0 })
    for (let i = 1; i <= 200; i++) {
      const w = locomotionWeights({ speed: i / 200, turnRate: (i / 200) * 3, backward: 0, decel: 0 })
      for (const k of Object.keys(w) as Array<keyof typeof w>) expect(Math.abs(w[k] - prev[k])).toBeLessThan(0.08)
      prev = w
    }
  })
  it('hockey stop only on a hard stop from speed', () => {
    expect(wantsHockeyStop(22, 40)).toBe(true)
    expect(wantsHockeyStop(20, 5)).toBe(false)
    expect(wantsHockeyStop(4, 60)).toBe(false)
  })
})

describe('cue planning (choreographer)', () => {
  const P = asPlayerId
  const stream: GameStream = [
    { type: 'faceoff', period: 1, t: 1, zone: 'neutral', winner: P('c1'), pos: { x: 0, y: 0 } },
    { type: 'pass', period: 1, t: 10, from: P('d1'), to: P('f1'), a: { x: 0.3, y: 0.2 }, b: { x: 0.7, y: 0.1 }, completed: true },
    { type: 'shot', period: 1, t: 10.4, shooter: P('f1'), from: { x: 0.7, y: 0.1 }, target: { x: 0.89, y: 0.02 }, danger: 0.5 },
    { type: 'save', period: 1, t: 10.5, goalie: P('g2'), rebound: false, pos: { x: 0.88, y: 0.02 } },
    { type: 'shot', period: 1, t: 30, shooter: P('d2'), from: { x: 0.3, y: 0.3 }, target: { x: 0.89, y: 0 }, danger: 0.2 },
    { type: 'hit', period: 1, t: 50, by: P('d1'), on: P('f9'), pos: { x: 0.5, y: 0.98 } },
    { type: 'hit', period: 1, t: 60, by: P('d1'), on: P('f9'), pos: { x: 0.0, y: 0.0 } },
    { type: 'pass', period: 1, t: 70, from: P('d1'), to: P('f1'), a: { x: 0, y: 0 }, b: { x: 0.2, y: 0 }, completed: false },
  ]
  const cues: ActionCue[] = extractActionCues(stream)

  it('extracts passes (completed only), faceoffs, and links saves to their shot', () => {
    expect(cues.filter((c) => c.kind === 'pass')).toHaveLength(1)
    expect(cues.find((c) => c.kind === 'faceoff')?.actorId).toBe('c1')
    const save = cues.find((c) => c.kind === 'save')!
    expect(save.shotTarget).toEqual({ x: 0.89, y: 0.02 })
    expect(cues.find((c) => c.kind === 'hit')?.targetId).toBe('f9')
  })

  it('plans the right clip and starts it contact-seconds early', () => {
    const plans = planCues(cues)
    const shots = plans.filter((p) => p.cue.kind === 'shot')
    expect(shots[0]!.clip).toBe('shot_onetimer') // 0.4 s after the pass to him
    expect(shots[1]!.clip).toMatch(/^shot_slap/) // from the point (either slap variant)
    expect(shots[0]!.lead).toBeCloseTo(CLIPS.shot_onetimer!.contact!)
    const hits = plans.filter((p) => p.cue.kind === 'hit')
    expect(hits[0]!.clip).toBe('check_boards') // y 0.98 → against the boards
    expect(hits[1]!.clip).toBe('check')
    expect(hits[1]!.lead).toBeCloseTo(CLIPS.check!.contact!)
    const fo = plans.find((p) => p.cue.kind === 'faceoff')!
    expect(fo.lead).toBeGreaterThan(0.5)
  })

  it('pokes on the agent pokeCheck and on takeaways (one poke when both describe it)', () => {
    const pokes = extractActionCues([
      // agent engine: the poke, then the takeaway it produced
      { type: 'pokeCheck', period: 1, t: 20, by: 'd1', on: 'f5', success: true, pos: { x: 0.2, y: 0.1 } } as unknown as GameStream[number],
      { type: 'takeaway', period: 1, t: 20.1, by: P('d1'), from: P('f5'), pos: { x: 0.2, y: 0.1 } },
      // a missed poke (no takeaway)
      { type: 'pokeCheck', period: 1, t: 25, by: 'd2', on: 'f6', success: false, pos: { x: 0.1, y: 0 } } as unknown as GameStream[number],
      // classic engine: a takeaway alone
      { type: 'takeaway', period: 1, t: 40, by: P('d3'), from: P('f7'), pos: { x: -0.3, y: 0.2 } },
    ]).filter((c) => c.kind === 'poke')
    expect(pokes.map((c) => c.actorId)).toEqual(['d1', 'd2', 'd3'])
    expect(pokes[1]!.success).toBe(false)
    const plan = planCues(pokes)
    expect(plan.every((p) => p.clip === 'poke')).toBe(true)
    expect(plan[0]!.lead).toBeCloseTo(CLIPS.poke!.contact!)
  })
})
