import { describe, expect, it } from 'vitest'
import type { ProbeFrame, ProbeGeometry, ProbeRig } from './viewerProbe'
import { runViewerTruth, vt13Aimless, vt14Coverage, vt15Systems, vt17Grip, vt18Offside, vt1Bodies, vt5Replay, vt6Clocks, vt7Faceoffs, vt8Changes, vt19GoalGeometry, type VTInput } from './viewerTruth'

const GEO: ProbeGeometry = { rinkHalfL: 100, rinkHalfW: 42.5, benchGates: { home: { x: -26, z: 41 }, away: { x: 26, z: 41 } } }

function rig(team: 'home' | 'away', id: string | null, x: number, z: number, extra: Partial<ProbeRig> = {}): ProbeRig {
  return { team, goalie: false, id, mode: id ? 'play' : 'idle', visible: true, x, z, sx: 500, sy: 300, onScreen: true, simX: id ? x : null, simZ: id ? z : null, boneW: 0, ...extra }
}

function frame(i: number, rigs: ProbeRig[], extra: Partial<ProbeFrame> = {}): ProbeFrame {
  return {
    wall: i / 60, dt: 1 / 60, clock: 100 + i / 30, speed: 2, playing: true, dead: false, w: 1600, h: 900,
    cam: { x: 0, y: 40, z: -75, fov: 30, preset: 'broadcast' },
    puck: { x: 0, y: 0, z: 0, sx: 800, sy: 450, onScreen: true, simX: 0, simZ: 0 },
    carrier: null, windup: null, goalSeq: null, goalSeqT: null, rigs,
    viewer: { phase: 'playing', mode: 'full', replay: false, replayPending: false, ff: false, nudge: 1, shownScore: '0-0' },
    ...extra,
  }
}

const five = (team: 'home' | 'away'): ProbeRig[] => [0, 1, 2, 3, 4].map((k) => rig(team, `${team[0]}${k}`, k * 10 - 20, k * 5 - 10))
const input = (frames: ProbeFrame[], extra: Partial<VTInput> = {}): VTInput => ({ frames, geometry: GEO, events: [], cues: [], timers: [], goals: [], ...extra })

describe('viewer-truth detectors', () => {
  it('VT1 counts idle bench rigs standing just past the boards as bodies on the ice', () => {
    const bench = [0, 1, 2, 3].map((k) => rig('home', null, -38 + k * 3, 42.5 + 4.9))
    const red = vt1Bodies(input([0, 1, 2].map((i) => frame(i, [...five('home'), ...bench, ...five('away')]))))
    expect(red.status).toBe('red')
    expect(red.evidence[0]).toContain('idle bench rigs')
    // the same bench, hidden: green
    const hidden = bench.map((r) => ({ ...r, visible: false }))
    expect(vt1Bodies(input([0, 1].map((i) => frame(i, [...five('home'), ...hidden, ...five('away')])))).status).toBe('green')
  })

  it('VT5 flags a replay that stops short of the goal', () => {
    const goalAbsT = 500
    // replay seeks goal − 8 and plays 0.6× for 8 s wall → ends at goal − 3.2
    const frames = Array.from({ length: 480 }, (_, i) => frame(i, five('home'), {
      wall: 10 + i / 60, clock: goalAbsT - 8 + (i / 60) * 0.6, speed: 0.6,
      viewer: { phase: 'playing', mode: 'full', replay: true, replayPending: false, ff: false, nudge: 1, shownScore: '1-0' },
    }))
    const r = vt5Replay(input(frames, { goals: [{ wall: 5, goalAbsT }] }))
    expect(r.status).toBe('red')
    expect(r.evidence[0]).toContain('ENDS BEFORE')
    const ok = frames.map((f, i) => ({ ...f, clock: goalAbsT - 4 + i / 60 }))
    expect(vt5Replay(input(ok, { goals: [{ wall: 5, goalAbsT }] })).status).toBe('green')
  })

  it('VT6 is red while wall-clock timers govern a goal moment', () => {
    const r = vt6Clocks(input([frame(0, [])], { goals: [{ wall: 0, goalAbsT: 10 }], timers: [{ wall: 0, clock: 10, name: 'celebration → replay cut', ms: 4500 }] }))
    expect(r.status).toBe('red')
  })

  it('VT8 flags a skater who vanishes mid-ice and passes one who leaves at his door', () => {
    const before = [rig('home', 'h9', 0, 0), rig('home', 'h8', -26, 38)]
    const after = [rig('home', null, -30, 47.4), rig('home', null, -27, 47.4)]
    const r = vt8Changes(input([frame(0, before), frame(1, after)]))
    expect(r.status).toBe('red')
    expect(r.value).toMatch(/^1 violations/)
  })

  // W3 team play: home defends the net at x = -89 (its goalie stands there).
  const goalies = [rig('home', 'hg', -86, 0, { goalie: true }), rig('away', 'ag', 86, 0, { goalie: true })]
  const fiveAt = (team: 'home' | 'away', pts: Array<[number, number]>): ProbeRig[] => pts.map(([x, z], k) => rig(team, `${team[0]}${k}`, x, z))
  const awayAtk: Array<[number, number]> = [[-80, 30], [-75, 2], [-40, -20], [-35, 20], [-60, -30]]

  it('VT13 flags a defender standing in the slot with nobody to cover, not one boxing out', () => {
    // a0 carries in the corner; h1 stands alone in the high slot for 3 s
    const homeIdle: Array<[number, number]> = [[-78, 26], [-62, 8], [-55, -30], [-30, 30], [-82, -14]]
    const frames = Array.from({ length: 100 }, (_, i) => frame(i, [...goalies, ...fiveAt('home', homeIdle), ...fiveAt('away', awayAtk)], { carrier: 'a0', puck: { x: -80, y: 0, z: 30, sx: 0, sy: 0, onScreen: true, simX: -80, simZ: 30 } }))
    expect(vt13Aimless(input(frames)).status).toBe('red')
    // an attacker beside him and a D boxing out the man at the net: everyone engaged, green
    const away2: Array<[number, number]> = [[-80, 30], [-75, 2], [-40, -20], [-35, 20], [-60, 6]]
    const homeBox: Array<[number, number]> = [[-78, 26], [-62, 8], [-55, -30], [-30, 30], [-78, 4]]
    const ok = frames.map((f) => ({ ...f, rigs: [...goalies, ...fiveAt('home', homeBox), ...fiveAt('away', away2)] }))
    expect(vt13Aimless(input(ok)).status).toBe('green')
  })

  it('VT14 flags two men on the carrier while a man in the slot is open', () => {
    const homeDbl: Array<[number, number]> = [[-78, 26], [-82, 32], [-50, -25], [-30, 30], [-30, -25]]
    const frames = Array.from({ length: 100 }, (_, i) => frame(i, [...goalies, ...fiveAt('home', homeDbl), ...fiveAt('away', awayAtk)], { carrier: 'a0', puck: { x: -80, y: 0, z: 30, sx: 0, sy: 0, onScreen: true, simX: -80, simZ: 30 } }))
    const r = vt14Coverage(input(frames))
    expect(r.status).toBe('red')
    expect(r.value).toMatch(/^doubles 1/)
    // one man on the puck, one on the slot man: green
    const homeOk: Array<[number, number]> = [[-78, 26], [-78, 2], [-50, -25], [-30, 30], [-30, -25]]
    const ok = frames.map((f) => ({ ...f, rigs: [...goalies, ...fiveAt('home', homeOk), ...fiveAt('away', awayAtk)] }))
    expect(vt14Coverage(input(ok)).status).toBe('green')
  })

  it('VT17 flags the one-handed lance and a carried puck on a lifted blade; a swing is not judged', () => {
    const g = (o: Partial<NonNullable<ProbeRig['grip']>>): NonNullable<ProbeRig['grip']> => ({ lance: false, oneHand: false, bladeY: 0.02, carrying: false, swing: false, state: 'relaxed', ...o })
    const withGrip = (carrier: NonNullable<ProbeRig['grip']>) => [rig('home', 'h0', 0, 0, { grip: carrier }), ...[1, 2, 3, 4].map((k) => rig('home', `h${k}`, k * 10, 0, { grip: g({}) }))]
    const lance = vt17Grip(input([0, 1, 2].map((i) => frame(i, withGrip(g({ carrying: true, lance: true, oneHand: true, state: 'n/a' }))))))
    expect(lance.status).toBe('red')
    expect(lance.evidence[0]).toContain('lance')
    const lifted = vt17Grip(input([0, 1, 2].map((i) => frame(i, withGrip(g({ carrying: true, bladeY: 0.6, state: 'carry' }))))))
    expect(lifted.status).toBe('red')
    const swing = vt17Grip(input([0, 1, 2].map((i) => frame(i, withGrip(g({ carrying: true, lance: true, bladeY: 1.2, swing: true }))))))
    expect(swing.status).toBe('green')
    const ok = vt17Grip(input([0, 1, 2].map((i) => frame(i, withGrip(g({ carrying: true, state: 'carry' }))))))
    expect(ok.status).toBe('green')
    // older probes (no grip data): nothing to judge
    expect(vt17Grip(input([frame(0, five('home'))])).status).toBe('n/a')
  })

  it('VT15 (W3 S4) reads the drawn forecheck against the declared system', () => {
    const goalies = [rig('home', 'hg', -85, 0, { goalie: true }), rig('away', 'ag', 85, 0, { goalie: true })]
    const away = [rig('away', 'a0', 86, 6), rig('away', 'a1', 80, -20), rig('away', 'a2', 60, 30), rig('away', 'a3', 45, -10), rig('away', 'a4', 40, 15)]
    const home = (xs: number[]) => xs.map((x, k) => rig('home', `h${k}`, x, k * 8 - 16))
    // two forecheck sequences, split by a spell of the home team on the puck (one is anecdote, not a verdict)
    const seq = (xs: number[]) => Array.from({ length: 250 }, (_, i) => frame(i, [...goalies, ...home(xs), ...away], i >= 120 && i < 130 ? { carrier: 'h1', puck: { x: 20, y: 0, z: 6, sx: 0, sy: 0, onScreen: true, simX: 20, simZ: 6 } } : { carrier: 'a0', puck: { x: 86, y: 0, z: 6, sx: 0, sy: 0, onScreen: true, simX: 86, simZ: 6 } }))
    const declared = [{ type: 'system', absT: 99, actor: 'home', detail: 'forecheck:1-3-1' }]
    // the trap: F1 steering from their circles, three across the red line, one D back
    const trap = vt15Systems(input(seq([55, 10, 8, 6, -20]), { events: declared }))
    expect(trap.status, trap.value).toBe('green')
    // declared a trap, drawn two men in deep: the system is not what the screen shows
    const deep = vt15Systems(input(seq([82, 75, 50, 30, 28]), { events: declared }))
    expect(deep.status, deep.value).toBe('red')
    // no declared system (the classic engine): nothing to judge
    expect(vt15Systems(input(seq([55, 10, 8, 6, -20]))).status).toBe('n/a')
  })

  it('VT8 (W3 S4) flags a name plate on a man behind the boards', () => {
    // reel S3 offsideCall: Hagens and Knies at the bench, their plates over the dasher
    const atBench = (lab: boolean) => [...five('home').map((r) => ({ ...r, label: lab })), rig('home', 'h9', -22, 45.5, { mode: 'arriving', label: lab })]
    const red = vt8Changes(input([0, 1, 2].map((i) => frame(i, atBench(true)))))
    expect(red.status).toBe('red')
    expect(red.evidence[0]).toContain('behind the boards')
    expect(vt8Changes(input([0, 1, 2].map((i) => frame(i, [...five('home').map((r) => ({ ...r, label: true })), rig('home', 'h9', -22, 45.5, { mode: 'arriving', label: false })])))).status).toBe('green')
  })

  it('VT17 (W3 S4) flags a carried puck drawn off the sim puck, and a blade off the drawn puck', () => {
    const g = (o: Partial<NonNullable<ProbeRig['grip']>>): NonNullable<ProbeRig['grip']> => ({ lance: false, oneHand: false, bladeY: 0.02, carrying: false, swing: false, state: 'carry', ...o })
    const rigs = (gap: number) => [rig('home', 'h0', 0, 0, { grip: g({ carrying: true, puckGap: gap }) }), ...[1, 2, 3, 4].map((k) => rig('home', `h${k}`, k * 10, 0, { grip: g({ state: 'relaxed' }) }))]
    const puckAt = (off: number) => ({ x: 2.3 + off, y: 0, z: 0, sx: 800, sy: 450, onScreen: true, simX: 2.3, simZ: 0 })
    // reel S3: the puck rode the drawn blade ~5.5 ft out, ~3 ft off the sim's
    const s3 = vt17Grip(input([0, 1, 2, 3].map((i) => frame(i, rigs(0.2), { carrier: 'h0', puck: puckAt(3.1) }))))
    expect(s3.status).toBe('red')
    expect(s3.evidence[0]).toContain("from the sim's")
    // the puck where the sim has it, but the blade 2 ft away from it
    expect(vt17Grip(input([0, 1, 2, 3].map((i) => frame(i, rigs(2), { carrier: 'h0', puck: puckAt(0) })))).status).toBe('red')
    // S4: the puck on the sim's spot, the blade on it
    expect(vt17Grip(input([0, 1, 2, 3].map((i) => frame(i, rigs(0.3), { carrier: 'h0', puck: puckAt(0.1) })))).status).toBe('green')
  })

  it('VT18 flags a drawn carry over the blue line with a team-mate already in the zone and no whistle', () => {
    // home attacks +x (its goalie is at -86); h0 carries from x 20 to 32 while h1 waits at x 45
    const frames = Array.from({ length: 30 }, (_, i) => {
      const x = 20 + i * 0.4
      return frame(i, [...goalies, rig('home', 'h0', x - 1, 0), rig('home', 'h1', 45, 10), rig('away', 'a0', 60, 0)], { carrier: 'h0', puck: { x, y: 0, z: 0, sx: 0, sy: 0, onScreen: true, simX: x, simZ: 0 } })
    })
    const red = vt18Offside(input(frames))
    expect(red.status).toBe('red')
    expect(red.evidence[0]).toContain('h1')
    // the linesman blows it: green
    const blown = vt18Offside(input(frames, { events: [{ type: 'whistle', absT: frames[20]!.clock, reason: 'offside' }] }))
    expect(blown.status).toBe('green')
    // h1 back onside behind the puck: green, nothing to call
    const onside = frames.map((f) => ({ ...f, rigs: f.rigs.map((r) => (r.id === 'h1' ? { ...r, x: 10 } : r)) }))
    expect(vt18Offside(input(onside)).status).toBe('green')
  })

  it('VT7 holds the drawn drop to the painted dot the stoppage calls for (owner, reel S2: "not dropping on the faceoff dot")', () => {
    // An icing in the away end (whistle at x = +89): the draw belongs at the
    // home team's end-zone dot (-69, 22). The S2 engine dropped it at its own
    // dot (-60, 23.4), 9 ft up the slot: red. On the painted dot: green.
    const dropAt = (x: number, z: number): ProbeFrame[] => Array.from({ length: 20 }, (_, i) => frame(i, [
      rig('home', 'c1', x - 1.3, z), rig('away', 'c2', x + 1.3, z), rig('home', 'w1', x - 3, z + 16.5), rig('away', 'w2', x + 3, z - 16.5),
    ], { speed: 1, clock: 100 + i / 30, puck: { x, y: 0, z, sx: 0, sy: 0, onScreen: true, simX: x, simZ: z } }))
    const geo = { ...GEO, faceoffDots: { endX: 69, neutralX: 20, y: 22 } }
    const fo = (frames: ProbeFrame[]) => ({ type: 'faceoff', absT: frames[frames.length - 1]!.clock, actor: 'c1', target: 'c2', dot: { kind: 'end' as const, xs: -1, ys: 1 } })
    const s2 = dropAt(-60, 23.4)
    const red = vt7Faceoffs({ ...input(s2, { events: [fo(s2)] }), geometry: geo })
    expect(red.status).toBe('red')
    expect(red.evidence[0]).toContain('end (-69, 22)')
    const fixed = dropAt(-69, 22)
    expect(vt7Faceoffs({ ...input(fixed, { events: [fo(fixed)] }), geometry: geo }).status).toBe('green')
    // the right spot in the wrong zone (an end-zone stoppage dropped at the neutral dot): red
    const nz = dropAt(-20, 22)
    expect(vt7Faceoffs({ ...input(nz, { events: [fo(nz)] }), geometry: geo }).status).toBe('red')
    // no stoppage detail (an old stream): still judged against the nearest PAINTED dot
    const { dot, ...noDot } = fo(s2)
    void dot
    expect(vt7Faceoffs({ ...input(s2, { events: [noDot] }), geometry: geo }).status).toBe('red')
  })

  it('VT19 flags a goal whose drawn puck comes into the net from behind the goal line (owner, reel S2 breakaway)', () => {
    // the puck goes from behind the net (x 95, z 6) into it
    const path = (pts: Array<[number, number]>): ProbeFrame[] => pts.map(([x, z], i) => frame(i, five('home'), { speed: 1, clock: 200 + i / 30, puck: { x, y: 0, z, sx: 0, sy: 0, onScreen: true, simX: x, simZ: z } }))
    const ev = (frames: ProbeFrame[]) => [
      { type: 'shot', absT: frames[0]!.clock, actor: 'h0', netX: 89 },
      { type: 'goal', absT: frames[frames.length - 1]!.clock, actor: 'h0', scorer: 'h0' },
    ]
    const behind = path([[95, 6], [93, 4], [91, 2], [90, 1]])
    expect(vt19GoalGeometry(input(behind, { events: ev(behind) })).status).toBe('red')
    const sharp = path([[86, 14], [88, 9], [89.5, 6], [90, 4]]) // crosses the line 6+ ft wide of centre
    expect(vt19GoalGeometry(input(sharp, { events: ev(sharp) })).status).toBe('red')
    const front = path([[70, 6], [78, 4], [86, 2], [90.5, 1]])
    expect(vt19GoalGeometry(input(front, { events: ev(front) })).status).toBe('green')
  })

  it('runs every detector and reports n/a with nothing to judge', () => {
    const res = runViewerTruth(input([]))
    expect(res.map((r) => r.id)).toEqual(['VT1', 'VT2', 'VT3', 'VT4', 'VT5', 'VT6', 'VT7', 'VT8', 'VT9', 'VT10', 'VT11', 'VT12', 'VT13', 'VT14', 'VT15', 'VT16', 'VT17', 'VT18', 'VT19'])
    expect(res.every((r) => r.status === 'n/a')).toBe(true)
  })
})
