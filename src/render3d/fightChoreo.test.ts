import { describe, expect, it } from 'vitest'
import type { FightBeat, GameStream } from '@domain'
import { CLIPS } from './animCatalog'
import { FightStager, extractFights, fightAt, fightProps, fightShots, linesmenSpots, loopAt, type StagedFight } from './fightChoreo'

const beats: FightBeat[] = [
  { kind: 'drop', at: 0 },
  { kind: 'square', at: 2 },
  { kind: 'grab', at: 3.5, by: 'home' },
  { kind: 'punch', at: 4, by: 'home', hand: 'R', landed: true, heavy: true },
  { kind: 'punch', at: 4.8, by: 'away', hand: 'L', landed: false },
  { kind: 'clinch', at: 5.5 },
  { kind: 'punch', at: 7.5, by: 'home', hand: 'R', landed: true },
  { kind: 'down', at: 7.75, by: 'away', how: 'punch' },
  { kind: 'linesmen', at: 8.45 },
  { kind: 'separate', at: 9.25 },
  { kind: 'escort', at: 11.45 },
]
const fight: StagedFight = {
  absT: 100, home: 'h', away: 'a', x: 20, z: 0, beats, separateAt: 9.25, boxAt: 11.45, durationS: 16.45, down: 'away',
  dropAt: { home: { x: 10, z: 0 }, away: { x: 30, z: 0 } }, clearAt: 125,
}

describe('fight choreography', () => {
  it('reads each man\'s spot at the drop from the first frame of the bout (the gear lands there)', () => {
    const ev = { type: 'fight', t: 100, period: 1, home: 'h', away: 'a', pos: { x: 0.2, y: 0 }, beats, separateAt: 9.25, boxAt: 11.45, durationS: 16.45, ending: 'knockdown', winner: 'h', down: 'a', thrown: { home: 2, away: 1 }, landed: { home: 2, away: 0 }, injured: null, cause: 'boilover' }
    const fr = { type: 'frame', t: 100, period: 1, home: [{ player: 'h', pos: { x: 0.1, y: 0.2 } }], away: [{ player: 'a', pos: { x: 0.3, y: -0.2 } }], homeGoalie: { player: 'g1', pos: { x: -0.9, y: 0 } }, awayGoalie: { player: 'g2', pos: { x: 0.9, y: 0 } }, puck: { x: 0, y: 0 }, puckCarrier: null }
    const fo = { type: 'faceoff', t: 100, playT: 130, period: 1, zone: 'neutral', winner: 'h', pos: { x: 0.2, y: 0 } }
    const [f] = extractFights([ev, fr, fo] as unknown as GameStream)
    expect(f!.dropAt.home.x).not.toBeCloseTo(f!.dropAt.away.x, 1)
    expect(f!.clearAt).toBe(130)
  })

  it('every clip it plays is in the catalogue', () => {
    for (const s of fightShots(fight)) expect(CLIPS[s.clip], s.clip).toBeDefined()
    for (const l of ['fight_stance', 'fight_grab', 'fight_clinch', 'official_separate']) expect(CLIPS[l]).toBeDefined()
  })

  it('a punch lands on its beat: the clip starts its contact time early; the man hit reacts on the beat', () => {
    const shots = fightShots(fight)
    const p = shots.find((s) => s.clip === 'fight_punch_R' && s.side === 'home')!
    expect(p.tau + CLIPS.fight_punch_R!.contact!).toBeCloseTo(4, 5)
    const r = shots.filter((s) => s.clip === 'fight_hit_react')
    expect(r.map((s) => [s.side, s.tau])).toEqual([['away', 4], ['away', 7.5]])
    // the missed left draws no reaction; the heavy one hits harder
    expect(r[0]!.weight).toBeGreaterThan(r[1]!.weight!)
    expect(shots.find((s) => s.clip === 'hit_fall')).toEqual({ tau: 7.75, side: 'away', clip: 'hit_fall' })
  })

  it('loops follow the beats; the man down holds none; nothing after the linesmen part them', () => {
    expect(loopAt(fight, 1, 'home')).toBeNull()
    expect(loopAt(fight, 2.5, 'home')).toBe('fight_stance')
    expect(loopAt(fight, 4.2, 'away')).toBe('fight_grab')
    expect(loopAt(fight, 6, 'home')).toBe('fight_clinch')
    expect(loopAt(fight, 8, 'away')).toBeNull()
    expect(loopAt(fight, 8, 'home')).toBe('fight_stance')
    expect(loopAt(fight, 9.3, 'home')).toBeNull()
  })

  it('the linesmen hover, step in, part them, and walk one man each', () => {
    const h = { x: 18.7, z: 0 }
    const a = { x: 21.3, z: 0 }
    const d = (s: { x: number; z: number }) => Math.hypot(s.x - 20, s.z)
    expect(d(linesmenSpots(fight, 3, h, a)![0])).toBeGreaterThan(10)
    const hover = d(linesmenSpots(fight, 6, h, a)![0])
    expect(hover).toBeGreaterThan(6)
    expect(hover).toBeLessThan(8)
    // on the far side from the camera (+z: the main camera looks from -z)
    expect(linesmenSpots(fight, 6, h, a)![0].z).toBeGreaterThan(0)
    expect(linesmenSpots(fight, 9, h, a)![0].separating).toBe(true)
    const esc = linesmenSpots(fight, 10, h, a)!
    expect(Math.hypot(esc[0].x - h.x, esc[0].z - h.z)).toBeLessThan(2)
    expect(Math.hypot(esc[1].x - a.x, esc[1].z - a.z)).toBeLessThan(2)
    expect(linesmenSpots(fight, 30, h, a)).toBeNull()
  })

  it('gear lies on the ice from the drop to the faceoff', () => {
    const props = fightProps(fight)
    expect(props.filter((p) => p.kind === 'glove')).toHaveLength(4)
    expect(props.filter((p) => p.kind === 'stick')).toHaveLength(2)
    for (const p of props) expect(p.until).toBe(125)
    expect(fightAt([fight], 99)).toBeNull()
    expect(fightAt([fight], 105)).toBe(fight)
  })

  it('the stager plays the one-shots as the clock passes them and keeps the loop between', () => {
    const log: string[] = []
    const mk = (id: string) => {
      const playing: string[] = []
      return {
        layer: {
          play: (n: string) => { log.push(`${id}:${n}`); playing.push(n); return true },
          stop: (n?: string) => { const i = playing.indexOf(n ?? ''); if (i >= 0) playing.splice(i, 1) },
          get playing() { return playing },
        },
      }
    }
    const actors = { h: mk('h'), a: mk('a') }
    const st = new FightStager((id) => actors[id as 'h' | 'a'] ?? null, () => 0.5)
    st.setFights([fight])
    let t = 99.5
    while (t < 108) { st.tick(t, t + 0.1); t += 0.1 }
    expect(log).toContain('h:fight_drop')
    expect(log).toContain('h:fight_stance')
    expect(log).toContain('h:fight_grab')
    expect(log).toContain('h:fight_punch_R')
    expect(log).toContain('a:fight_hit_react')
    expect(log).toContain('a:fight_clinch')
    expect(log).toContain('a:hit_fall')
    expect(log.indexOf('h:fight_punch_R')).toBeLessThan(log.indexOf('a:fight_hit_react'))
  })
})
