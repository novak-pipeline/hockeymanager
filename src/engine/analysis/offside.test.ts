/**
 * The offside judge (VT18 and the sim-stream gate) on hand-built frames: home
 * defends x = -89 and attacks toward +x; its blue line is at x = +25.
 */
import { describe, expect, it } from 'vitest'
import { judgeOffside } from './offside'
import type { TPFrame, TPSkater } from './teamPlay'

const sk = (id: string, x: number, y = 0): TPSkater => ({ id, x, y })
const frame = (t: number, puckX: number, carrier: string | null, home: TPSkater[], away: TPSkater[] = [sk('a1', 60, 10)]): TPFrame => ({
  t, live: true, home, away, homeNetX: -89, puck: { x: puckX, y: 0 }, carrier,
})

describe('offside judge', () => {
  it('flags a carried entry with a man already over the line and no whistle', () => {
    const fs = [
      frame(10, 22, 'h1', [sk('h1', 21), sk('h2', 40)]),
      frame(10.25, 28, 'h1', [sk('h1', 27), sk('h2', 41)]),
    ]
    const r = judgeOffside(fs, [])
    expect(r.missed.map((m) => m.kind)).toEqual(['carried'])
    expect(r.missed[0]!.offenders).toEqual(['h2'])
    // the same entry with the linesman's whistle: called, nothing missed
    expect(judgeOffside(fs, [{ t: 10.3, reason: 'offside' }]).missed).toEqual([])
  })

  it('lets an onside entry go: the team-mate behind the puck, or the carrier himself ahead of it', () => {
    const fs = [
      frame(10, 22, 'h1', [sk('h1', 21), sk('h2', 18)]),
      frame(10.25, 28, 'h1', [sk('h1', 27), sk('h2', 24)]),
    ]
    const r = judgeOffside(fs, [])
    expect(r.entries).toBe(1)
    expect(r.offsideEntries).toBe(0)
    expect(r.missed).toEqual([])
  })

  it('a pass or shot in with a man offside is DELAYED: tagging up clears it, a touch first is a missed call', () => {
    const passIn = [
      frame(20, 20, 'h1', [sk('h1', 19), sk('h2', 35)]),
      frame(20.25, 30, null, [sk('h1', 21), sk('h2', 34)]), // over the line, nobody has it
    ]
    // h2 touches it in the zone without ever getting out: offside, unwhistled
    const touched = judgeOffside([...passIn, frame(20.5, 36, 'h2', [sk('h1', 22), sk('h2', 34)])], [])
    expect(touched.missed.map((m) => m.kind)).toEqual(['delayedTouch'])
    // h2 skates out (both men clear of the zone at once), then plays it: legal
    const tagged = judgeOffside([
      ...passIn,
      frame(20.5, 34, null, [sk('h1', 20), sk('h2', 25.5)]),
      frame(20.75, 38, 'h2', [sk('h1', 24), sk('h2', 30)]),
    ], [])
    expect(tagged.missed).toEqual([])
  })

  it('a defender who takes it between two frames and brings it back over his line puts nobody offside (W3 S8, reel S7 VT18)', () => {
    // the attackers (home) had it in their zone; it slid out over the line
    // (home's men still deep in it), and away's a1 picked it up and pulled it
    // back in in the same quarter second: red before (judged a delayed offside
    // by home, then h2's later touch a missed call)
    const fs = [
      frame(39.75, 33, 'h1', [sk('h1', 34), sk('h2', 60)], [sk('a1', 29)]),
      frame(40, 30, null, [sk('h1', 45), sk('h2', 60)], [sk('a1', 28)]),
      frame(40.25, 23, null, [sk('h1', 44), sk('h2', 58)], [sk('a1', 26)]),
      frame(40.5, 27, 'a1', [sk('h1', 43), sk('h2', 57)], [sk('a1', 26)]),
      frame(40.75, 31, null, [sk('h1', 42), sk('h2', 56)], [sk('a1', 29)]),
      frame(41, 33, 'h2', [sk('h1', 41), sk('h2', 34)], [sk('a1', 31)]),
    ]
    expect(judgeOffside(fs, []).missed).toEqual([])
  })

  it('nobody is offside when the defenders put the puck into their own zone', () => {
    const fs = [
      frame(30, 20, 'a1', [sk('h1', 40)], [sk('a1', 19)]),
      frame(30.25, 30, 'a1', [sk('h1', 40)], [sk('a1', 29)]),
      frame(30.5, 34, 'h1', [sk('h1', 36)], [sk('a1', 31)]),
    ]
    expect(judgeOffside(fs, []).missed).toEqual([])
  })

  it('a puck a defender pokes into his own zone puts nobody offside', () => {
    const fs = [
      frame(50, 20, 'h1', [sk('h1', 19), sk('h2', 35)], [sk('a1', 21)]),
      frame(50.25, 29, null, [sk('h1', 21), sk('h2', 34)], [sk('a1', 22)]),
      frame(50.5, 33, 'h2', [sk('h1', 22), sk('h2', 33)], [sk('a1', 23)]),
    ]
    // the frames alone read it as h1's puck, passed in to h2 who never tagged up
    expect(judgeOffside(fs, []).missed.map((m) => m.kind)).toEqual(['delayedTouch'])
    // a1 poked it off h1's stick and over the line
    expect(judgeOffside(fs, [], [{ t: 50.1, id: 'a1' }]).missed).toEqual([])
  })

  it('a man who reaches back from inside the zone for the puck is offside when he carries it in', () => {
    const fs = [
      frame(60, 23, null, [sk('h1', 30)]),
      frame(60.25, 24, 'h1', [sk('h1', 29)]),
      frame(60.5, 27, 'h1', [sk('h1', 30)]),
    ]
    expect(judgeOffside(fs, []).missed.map((m) => m.kind)).toEqual(['carried'])
    // the carrier who crosses WITH the puck (behind it) is onside
    const withIt = [
      frame(60, 23, 'h1', [sk('h1', 22)]),
      frame(60.25, 24, 'h1', [sk('h1', 23)]),
      frame(60.5, 27, 'h1', [sk('h1', 26)]),
    ]
    expect(judgeOffside(withIt, []).missed).toEqual([])
  })

  it('a puck riding the line is not a fresh entry: it must completely leave the zone first', () => {
    // in the zone, back onto the line (25.2: not out), in again — no new entry
    const fs = [
      frame(40, 30, 'h1', [sk('h1', 30), sk('h2', 40)]),
      frame(40.25, 25.2, 'h1', [sk('h1', 25.5), sk('h2', 40)]),
      frame(40.5, 29, 'h1', [sk('h1', 28), sk('h2', 41)]),
    ]
    const r = judgeOffside(fs, [])
    expect(r.entries).toBe(0)
    expect(r.missed).toEqual([])
  })
})
