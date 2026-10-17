/**
 * Agent engine gates (src/engine/agent): the same contract as the director
 * engine — deterministic, renderer-safe, NHL-calibrated — plus the owner's
 * play-logic rules (no aimless backward passes on the rush, breakaways end in
 * an attempt) and the physical game (hits happen along the boards, penalties
 * come in real infraction types).
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { ForecheckSystem, FrameEvent, Player, PlayerId } from '@domain'
import { isEvent } from '@domain'
import { CALIBRATION_TARGETS } from '@calibrate'
import { agentSimGame, emptyAgentTelemetry } from './agentSim'
import { MAX_TOP_FT } from './physics'
import { histPct } from './telemetry'
import { passShape } from '@engine/full/passShape'
import { analyzeGame } from '@engine/analysis'
import { framesFromStream, judgeTeamPlay, SIM_GATES } from '@engine/analysis/teamPlay'
import { judgeOffsideStream } from '@engine/analysis/offside'
import { judgeActionFloor, judgeContacts } from '@engine/analysis/actions'
import { ACTION_FLOOR } from './constraints'
import { goalPath, shotGeometry } from './agentSim'
import { DOT_EZ_X, DOT_NZ_X, DOT_Y } from './rink'
import { DRAWN_DOTS, judgeFaceoffDots } from '@engine/analysis/faceoffRule'
import { judgeGoalGeometry } from '@engine/analysis/goalGeometry'
import { streamPeriodBases } from '@domain'
import { judgeSystems, legibility, systemFramesFromStream, type SeqCase } from '@engine/analysis/systemPlay'
import { tacticsForSystem, type CoachSystemId } from '@engine/league/coachProfile'

/** W3 S4 VT15 gate (design band, measured on the S4 engine: see W3-LOG S4). */
const VT15_GATE = { forecheckFamily: 0.5, collapseLead: 0.12, pressureLead: 0.3 }

/** W3 S1 design band for the stream gates (per 60 live minutes / per player-minute). */
const TEAM_PLAY_BAND = { aimlessPer60: 30, coveragePer60: 5, flipsPerPlayerMin: 26 }

const data = generateLeague({ seed: 99 })
const resolve = (id: PlayerId): Player => {
  const p = data.players.get(id)
  if (!p) throw new Error(`unknown player ${id}`)
  return p
}
const teams = data.league.teams
const team = (i: number) => data.teams.get(teams[i % teams.length])!

describe('agent engine', () => {
  it('is deterministic for a given seed', () => {
    const a = agentSimGame(team(0), team(1), resolve, { seed: 42 })
    const b = agentSimGame(team(0), team(1), resolve, { seed: 42 })
    expect(a.homeGoals).toBe(b.homeGoals)
    expect(a.awayGoals).toBe(b.awayGoals)
    expect(a.stream.length).toBe(b.stream.length)
    expect(JSON.stringify(a.stream.slice(-400))).toBe(JSON.stringify(b.stream.slice(-400)))
  }, 60000)

  it('emits a renderer-compatible stream: dense frames, legal positions, no skater faster than his legs', () => {
    const t0 = Date.now()
    const out = agentSimGame(team(2), team(3), resolve, { seed: 7 })
    const ms = Date.now() - t0
    // eslint-disable-next-line no-console
    console.log(`agent game simulated in ${ms} ms`)
    expect(out.homeGoals).not.toBe(out.awayGoals)
    const frames = out.stream.filter((e): e is FrameEvent => isEvent(e, 'frame'))
    expect(frames.length).toBeGreaterThan(14000)
    const cap = MAX_TOP_FT * 0.25 + 0.6 // top speed per 0.25 s frame + contact/fp slack
    let prev: FrameEvent | null = null
    let maxStep = 0
    for (const f of frames) {
      expect(f.home.length).toBeGreaterThanOrEqual(3)
      expect(f.home.length).toBeLessThanOrEqual(6)
      for (const s of [...f.home, ...f.away]) {
        expect(Math.abs(s.pos.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(s.pos.y)).toBeLessThanOrEqual(1)
      }
      if (prev && prev.period === f.period && f.t - prev.t < 0.3) {
        for (const side of ['home', 'away'] as const) {
          for (const s of f[side]) {
            const was = prev[side].find((q) => q.player === s.player)
            if (!was) continue
            const d = Math.hypot((s.pos.x - was.pos.x) * 100, (s.pos.y - was.pos.y) * 42.5)
            maxStep = Math.max(maxStep, d)
          }
        }
      }
      prev = f
    }
    expect(maxStep).toBeGreaterThan(0)
    expect(maxStep).toBeLessThanOrEqual(cap)
  }, 60000)

  it('keeps the stream consistent for the renderers: the carried puck on the blade, a downed man in the picture', () => {
    // While puckCarrier is X the puck is on X's blade (a reception names the
    // new carrier only once the puck has arrived), and a man knocked down or
    // pinned is never swapped off the ice mid-fall by a whistle's line change.
    let carried = 0
    let off = 0
    let downs = 0
    let vanish = 0
    for (let i = 0; i < 4; i++) {
      const out = agentSimGame(team(i), team(i + 5), resolve, { seed: 300 + i })
      const m = analyzeGame(out.stream)
      carried += m.counts['motion.carriedFrames'] ?? 0
      off += m.counts['motion.puckOffBlade'] ?? 0
      downs += m.counts['hit.downs'] ?? 0
      vanish += m.counts['motion.downVanish'] ?? 0
    }
    expect(carried).toBeGreaterThan(10000)
    expect(off / carried).toBeLessThanOrEqual(0.01)
    expect(downs).toBeGreaterThan(20)
    expect(vanish).toBe(0)
  }, 120000)

  it('plays with intent (W3 S1): nobody idles in the house, one man per attacker, jobs persist', () => {
    // The team-play detectors on the sim stream (src/engine/analysis/teamPlay.ts),
    // per 60 live minutes. Limits are the design band (docs/gameplan-2026-09-28/W3-DESIGN.md
    // item 2): the engine before S1 measured ~36 aimless, ~6 coverage cases and ~29 job
    // changes per player-minute on the imported league.
    let liveMin = 0
    let aimless = 0
    let coverage = 0
    let flips = 0
    let jobMin = 0
    let jobsSeen = 0
    let newMen = 0
    let newMenWithJob = 0
    for (let i = 0; i < 4; i++) {
      const out = agentSimGame(team(i), team(i + 3), resolve, { seed: 900 + i })
      const onIce = new Set<string>()
      for (const e of out.stream) {
        if (e.type !== 'frame') continue
        const here = [...e.home, ...e.away]
        for (const s of here) {
          if (s.role !== undefined && s.job !== undefined) jobsSeen++
          // A man fresh off the bench in live play has a role and a job on his first frame.
          if (!onIce.has(s.player as string) && onIce.size > 0 && e.puckCarrier !== null) {
            newMen++
            if (s.role !== undefined && s.job !== undefined) newMenWithJob++
          }
        }
        onIce.clear()
        for (const s of here) onIce.add(s.player as string)
      }
      const r = judgeTeamPlay(framesFromStream(out.stream), { gates: SIM_GATES })
      liveMin += r.liveMin
      aimless += r.aimless.length
      coverage += r.doubles.length + r.farSide.length + r.ignored.length
      flips += r.jobFlips
      jobMin += r.jobPlayerMin
    }
    const p60 = (n: number): number => (n / liveMin) * 60
    // eslint-disable-next-line no-console
    console.log(`team play /60 live min: aimless ${p60(aimless).toFixed(1)} coverage ${p60(coverage).toFixed(1)}; job flips ${(flips / jobMin).toFixed(1)}/player-min`)
    expect(jobsSeen).toBeGreaterThan(10000)
    expect(newMen).toBeGreaterThan(50)
    expect(newMenWithJob / newMen).toBeGreaterThan(0.95)
    expect(p60(aimless)).toBeLessThan(TEAM_PLAY_BAND.aimlessPer60)
    expect(p60(coverage)).toBeLessThan(TEAM_PLAY_BAND.coveragePer60)
    expect(flips / jobMin).toBeLessThan(TEAM_PLAY_BAND.flipsPerPlayerMin)
  }, 120000)

  it('blows every offside (owner, reel S1: "he was offside"): carried, passed, shot, chipped or bounced in', () => {
    // The offside judge (src/engine/analysis/offside.ts, also VT18 on the drawn
    // screen) on the sim stream. Before the fix the engine judged only carries
    // and passes / dumps: a shot, a chip, a poke or a block that took the puck
    // over the line was never looked at, the puck was "in" at the line's centre
    // (so a puck riding the line re-entered every substep), and on a delayed
    // offside the man touching the puck was not counted. Imported league: 6.6
    // missed calls a game; generated league below: see W3-LOG S2.
    let entries = 0
    let offsideEntries = 0
    let whistles = 0
    const missed: string[] = []
    for (let i = 0; i < 6; i++) {
      const out = agentSimGame(team(i), team(i + 5), resolve, { seed: 940 + i })
      const r = judgeOffsideStream(out.stream)
      entries += r.entries
      offsideEntries += r.offsideEntries
      whistles += r.whistles
      for (const m of r.missed) missed.push(`g${i} ${m.what}`)
    }
    // eslint-disable-next-line no-console
    console.log(`offside: ${entries} entries, ${offsideEntries} with a man over the line, ${whistles} whistles, ${missed.length} missed`)
    expect(entries).toBeGreaterThan(500)
    expect(offsideEntries).toBeGreaterThan(20)
    expect(whistles).toBeGreaterThan(5)
    expect(missed).toEqual([])
  }, 120000)

  it('holds every action to its floor and every contact to a pair in range (W3 S2, VT12)', () => {
    // constraints.ts: no shot, pass, check, tie-up, stick or goalie action
    // completes faster than its row, and a hit or a tie-up only happens with
    // both bodies in reach. Judged on the stream by @engine/analysis/actions.
    const short: string[] = []
    const apart: string[] = []
    const against: string[] = []
    const byAct: Record<string, number> = {}
    let shots = 0
    let passes = 0
    let hits = 0
    let tieUps = 0
    let hitsWithReceiver = 0
    let streamHits = 0
    let passesTimed = 0
    for (let i = 0; i < 4; i++) {
      const out = agentSimGame(team(i), team(i + 6), resolve, { seed: 970 + i })
      const fl = judgeActionFloor(out.stream)
      const ct = judgeContacts(out.stream)
      shots += fl.shots
      passes += fl.passes
      hits += ct.hits
      tieUps += ct.tieUps
      for (const [k, v] of Object.entries(fl.byAct)) byAct[k] = (byAct[k] ?? 0) + v
      for (const c of fl.short) short.push(`g${i} ${c.what}`)
      for (const c of ct.apart) apart.push(`g${i} ${c.what}`)
      for (const c of ct.against) against.push(`g${i} ${c.what}`)
      for (const e of out.stream) {
        if (e.type === 'hit') streamHits++
        if (e.type === 'hit' && e.receiverS !== undefined && e.receiverS > 0) hitsWithReceiver++
        if (e.type === 'pass' && e.releaseS !== undefined && e.releaseS >= ACTION_FLOOR.pass.release.drop - 0.06) passesTimed++
      }
    }
    // eslint-disable-next-line no-console
    console.log(`action floor: ${shots} shots, ${passes} passes, acts ${JSON.stringify(byAct)}; contact pairs: ${hits} hits, ${tieUps} tie-ups`)
    expect(shots).toBeGreaterThan(100)
    expect(passes).toBeGreaterThan(1000)
    expect(passesTimed).toBe(passes)
    for (const a of ['windup', 'release', 'receive', 'tieUp', 'hit', 'stagger', 'save', 'set', 'deke', 'lifted']) expect(byAct[a] ?? 0).toBeGreaterThan(0)
    expect(hits).toBeGreaterThan(100)
    expect(hitsWithReceiver).toBe(streamHits)
    expect(tieUps).toBeGreaterThan(50)
    expect(short).toEqual([])
    expect(apart).toEqual([])
    // W3 S4 (VT11 on the stream): the man hit does not carry on into the
    // check. Before S4 (a 'hit' scored when he skated into the back of the
    // hitter, and a stagger as short as 0.15 s): 3.7% of hits (generated
    // league, 8 games) / 3.8% (imported, 12); after 2.4% / 1.7% (what is
    // left: head-on glancing collisions that slide past each other).
    expect(against.length / hits, against.slice(0, 5).join('\n')).toBeLessThan(0.03)
  }, 120000)

  it('drops every faceoff on the dot its stoppage calls for (W3 S3, owner reel S2: "not dropping on the faceoff dot")', () => {
    // NHL rule 76 by the whistle's detail (faceoffRule.ts), in the painted
    // geometry the 3D sheet uses. Before S3 the engine's end dots were 9 ft up
    // the slot from the painted ones (60 vs 69 ft) and "nearest dot" sent a
    // stoppage inside the zone out to the neutral zone.
    const wrong: string[] = []
    let judged = 0
    const kinds: Record<string, number> = {}
    for (let i = 0; i < 4; i++) {
      const out = agentSimGame(team(i), team(i + 2), resolve, { seed: 1100 + i })
      const r = judgeFaceoffDots(out.stream, { endX: DOT_EZ_X, neutralX: DOT_NZ_X, y: DOT_Y })
      judged += r.judged.length
      for (const j of r.judged) kinds[j.expected.kind] = (kinds[j.expected.kind] ?? 0) + 1
      for (const w of r.wrong) wrong.push(`g${i} ${w.what}`)
      for (const e of out.stream) if (e.type === 'whistle') expect(e.detail).toBeDefined()
    }
    expect({ endX: DOT_EZ_X, neutralX: DOT_NZ_X, y: DOT_Y }).toEqual(DRAWN_DOTS)
    expect(judged).toBeGreaterThan(150)
    expect(kinds['end'] ?? 0).toBeGreaterThan(50)
    expect(kinds['neutral'] ?? 0).toBeGreaterThan(10)
    expect(wrong).toEqual([])
  }, 120000)

  it('scores only through the mouth: no goal from behind the goal line or at no angle (W3 S3, owner reel S2 breakaway)', () => {
    const bad: string[] = []
    let goals = 0
    for (let i = 0; i < 8; i++) {
      const out = agentSimGame(team(i), team(i + 4), resolve, { seed: 1200 + i })
      const r = judgeGoalGeometry(out.stream)
      goals += r.goals
      for (const b of r.bad) bad.push(`g${i} ${b.what}`)
    }
    expect(goals).toBeGreaterThan(20)
    expect(bad).toEqual([])
    // the geometry rule itself: behind the line no shot; the goal line extended no angle; the slot on net
    expect(shotGeometry({ x: 92, y: 2 }, 1).behind).toBe(true)
    expect(shotGeometry({ x: 88, y: 12 }, 1).onNet).toBe(false)
    expect(shotGeometry({ x: 70, y: 5 }, 1).onNet).toBe(true)
    // a goal's path enters between the posts, from the front, and stays inside the net
    for (const [x, y, ye] of [[80, 20, 2.6], [86, -10, -2.6], [60, 0, 0], [88, 6, 2.5]] as const) {
      const p = goalPath({ x, y }, 1, ye)
      expect(p.x).toBeGreaterThan(89)
      expect(Math.abs(p.y)).toBeLessThan(3)
    }
  })

  it('stops the period clock at the whistle and plays 20 minutes of live time a period (W3 S3)', () => {
    const out = agentSimGame(team(1), team(2), resolve, { seed: 77 })
    const frames = out.stream.filter((e): e is FrameEvent => isEvent(e, 'frame'))
    let dead = 0
    let prev: FrameEvent | null = null
    for (const f of frames) {
      expect(f.playT).toBeDefined()
      if (prev && prev.period === f.period) {
        // playback time always runs; the clock never runs faster than it
        expect(f.playT!).toBeGreaterThan(prev.playT!)
        expect(f.t - prev.t).toBeLessThanOrEqual(f.playT! - prev.playT! + 1e-6)
        if (f.t === prev.t) dead++
      }
      prev = f
    }
    // a good share of the frames are dead time (line-ups, changes, celebrations)
    expect(dead / frames.length).toBeGreaterThan(0.05)
    // every regulation period ends at 20:00 of CLOCK, and lasts longer than that on screen
    const ends = out.stream.filter((e) => e.type === 'periodEnd' && e.period <= 3)
    expect(ends.map((e) => e.t)).toEqual([1200, 1200, 1200])
    const bases = streamPeriodBases(out.stream)
    expect(bases.get(2)!).toBeGreaterThan(1250)
    // every stoppage's whistle and its faceoff share one clock reading
    let whistleT: number | null = null
    for (const e of out.stream) {
      if (e.type === 'whistle' && e.reason !== 'goal') whistleT = e.t
      else if (e.type === 'faceoff' && whistleT !== null) {
        expect(e.t).toBeCloseTo(whistleT, 5)
        whistleT = null
      } else if (e.type === 'periodEnd') whistleT = null
    }
  }, 60000)

  it('makes tactic changes only at stop points, and replays them exactly (W3 S3)', () => {
    const hash = (s: unknown[]): string => {
      // FNV-1a over the JSON: cheap and order-sensitive
      const str = JSON.stringify(s)
      let h = 0x811c9dc5
      for (let k = 0; k < str.length; k++) h = Math.imul(h ^ str.charCodeAt(k), 0x01000193) >>> 0
      return h.toString(16)
    }
    const h0 = team(3)
    const a0 = team(4)
    const straight = agentSimGame(h0, a0, resolve, { seed: 31 })
    // an empty list, and no-op records at many stop points: the very same game
    const noop = agentSimGame(h0, a0, resolve, { seed: 31, changes: [] })
    const noops = agentSimGame(h0, a0, resolve, {
      seed: 31,
      changes: [0, 5, 17, 40].map((index) => ({ team: 'home' as const, at: { kind: 'stop' as const, index }, what: 'tactics' as const, tactics: { forecheck: h0.tactics.forecheck } })),
    })
    expect(hash(noop.stream)).toBe(hash(straight.stream))
    expect(hash(noops.stream)).toBe(hash(straight.stream))
    // a real change at the 10th stoppage: identical up to that whistle, then it takes effect there
    const forecheck: ForecheckSystem = h0.tactics.forecheck === '1-2-2' ? '2-1-2' : '1-2-2'
    const changes = [{ team: 'home' as const, at: { kind: 'stop' as const, index: 10 }, what: 'tactics' as const, tactics: { forecheck, hitting: 0.9 } }]
    const changed = agentSimGame(h0, a0, resolve, { seed: 31, changes })
    const tc = changed.stream.findIndex((e) => e.type === 'tacticChange')
    expect(tc).toBeGreaterThan(0)
    const tcEv = changed.stream[tc]!
    expect(tcEv.type === 'tacticChange' && tcEv.at.kind === 'stop' && tcEv.at.index === 10).toBe(true)
    // it comes right after the 10th (0-based) whistle, while play is stopped
    let whistles = 0
    for (let k = 0; k < tc; k++) if (changed.stream[k]!.type === 'whistle') whistles++
    expect(whistles).toBe(11)
    expect(changed.stream[tc - 1]!.type).toBe('whistle')
    expect(hash(changed.stream.slice(0, tc))).toBe(hash(straight.stream.slice(0, tc)))
    // the replay of input + change list: the same stream, event for event
    const replay = agentSimGame(h0, a0, resolve, { seed: 31, changes })
    expect(hash(replay.stream)).toBe(hash(changed.stream))
    // a period-start change: emitted at the intermission, before the period's first faceoff
    const p2 = agentSimGame(h0, a0, resolve, { seed: 31, changes: [{ team: 'away', at: { kind: 'period', period: 2 }, what: 'tactics', tactics: { hitting: 0.95 } }] })
    const k2 = p2.stream.findIndex((e) => e.type === 'tacticChange')
    expect(p2.stream[k2]!.period).toBe(2)
    expect(p2.stream[k2]!.t).toBe(0)
  }, 120000)

  it('takes a strength change in live play through the bench door, never in place mid-ice (W3 S3, VT8)', () => {
    // A man leaves the frames only near his bench door (or in dead time, when
    // the renderer walks him off), and a new man first appears there.
    const gates = [{ x: -22, y: 41 }, { x: 22, y: 41 }]
    const nearGate = (p: { x: number; y: number }): boolean => gates.some((g) => Math.hypot(p.x * 100 - g.x, p.y * 42.5 - g.y) < 10)
    const bad: string[] = []
    let liveSwaps = 0
    let deadSwaps = 0
    let deadMid = 0
    for (let i = 0; i < 4; i++) {
      const out = agentSimGame(team(i), team(i + 1), resolve, { seed: 1300 + i })
      let prev: FrameEvent | null = null
      let stopped = false
      for (const f of out.stream) {
        if (f.type === 'whistle' || f.type === 'goal' || f.type === 'periodEnd') stopped = true
        if (f.type !== 'frame') continue
        const live = prev && prev.period === f.period && f.t > prev.t && !stopped
        stopped = false
        if (!live && prev && prev.period === f.period) {
          // dead time: a change at the whistle also goes through the door
          // (whistleChange); only a strength change (a penalty, the extra
          // attacker) still redeploys - the count on the ice moves
          if (f.home.length === prev.home.length && f.away.length === prev.away.length) {
            for (const side of ['home', 'away'] as const) {
              const now = new Set(f[side].map((s) => s.player))
              for (const s of prev[side]) if (!now.has(s.player)) { deadSwaps++; if (!nearGate(s.pos)) deadMid++ }
            }
          }
        }
        if (live && prev) {
          // both frames live (the clock moved): changes on the fly only
          for (const side of ['home', 'away'] as const) {
            const now = new Map(f[side].map((s) => [s.player, s.pos]))
            const was = new Map(prev[side].map((s) => [s.player, s.pos]))
            for (const [id, pos] of was) if (!now.has(id)) { liveSwaps++; if (!nearGate(pos)) bad.push(`g${i} P${f.period} ${f.t} ${id} left mid-ice at (${(pos.x * 100).toFixed(0)}, ${(pos.y * 42.5).toFixed(0)})`) }
            for (const [id, pos] of now) if (!was.has(id) && !nearGate(pos)) bad.push(`g${i} P${f.period} ${f.t} ${id} appeared mid-ice at (${(pos.x * 100).toFixed(0)}, ${(pos.y * 42.5).toFixed(0)})`)
          }
        }
        prev = f
      }
    }
    // eslint-disable-next-line no-console
    console.log(`changes: ${liveSwaps} men off on the fly; in dead time ${deadSwaps}, ${deadMid} of them away from the door`)
    expect(liveSwaps).toBeGreaterThan(100)
    expect(bad).toEqual([])
    expect(deadSwaps).toBeGreaterThan(100)
    expect(deadMid / deadSwaps).toBeLessThan(0.1)
  }, 120000)

  it('lands in the NHL band and keeps its play logic over many games', () => {
    const tm = emptyAgentTelemetry()
    const counts: Record<string, number> = {}
    const infractions = new Set<string>()
    let rushBack = 0
    let ozPasses = 0
    let ozBack = 0
    // 96 games: the generated league scores ~2.5 goals per team-game against
    // a lower bound of 2.30, and a 16-game sample swung +-0.4 with any
    // reshuffle of the dice (the engine before W3 S1 read 3.00 on the old
    // 16 seeds and 2.49 over 192 games). The bound is unchanged; the sample
    // is big enough to measure the engine rather than the seeds.
    const games = 96
    for (let i = 0; i < games; i++) {
      const out = agentSimGame(team(i), team(i + 1), resolve, { seed: 5000 + i, agentTelemetry: tm })
      for (const e of out.stream) {
        counts[e.type] = (counts[e.type] ?? 0) + 1
        if (e.type === 'penalty') infractions.add(e.infraction)
      }
      const ps = passShape(out.stream)
      ozPasses += ps.ozPasses
      ozBack += ps.ozBackward
    }
    void rushBack
    const per = (t: string): number => (counts[t] ?? 0) / (games * 2)
    const R = CALIBRATION_TARGETS.perTeamPerGame
    const g2 = games * 2
    // eslint-disable-next-line no-console
    console.log(
      `agent rates/team/game: goal=${per('goal').toFixed(2)} shot=${per('shot').toFixed(1)} blocked=${per('blockedShot').toFixed(1)} ` +
        `hit=${per('hit').toFixed(1)} penalty=${per('penalty').toFixed(2)} takeaway=${per('takeaway').toFixed(1)} giveaway=${per('giveaway').toFixed(1)} ` +
        `faceoff=${per('faceoff').toFixed(1)} pass=${per('pass').toFixed(0)} hitsOnBoards=${(tm.hitsBoards / Math.max(1, tm.hits)).toFixed(2)} ` +
        `accel p50=${histPct(tm.accelHist, 0.5)} speed p50=${histPct(tm.speedHist, 0.5)} ozBack=${(ozBack / Math.max(1, ozPasses)).toFixed(3)} ` +
        `infractions=${[...infractions].join('|')} misses=${(tm.missed / g2).toFixed(1)}`
    )
    const band = (got: number, target: number, tol: number): void => {
      expect(got).toBeGreaterThan(target * (1 - tol))
      expect(got).toBeLessThan(target * (1 + tol))
    }
    band(per('goal'), R.goals, 0.25)
    band(per('shot'), R.shotsOnGoal, 0.2)
    band(per('hit'), R.hits, 0.3)
    band(per('penalty'), R.penalties, 0.35)
    band(per('faceoff'), R.faceoffs, 0.3)
    expect(per('blockedShot')).toBeGreaterThan(R.blockedShots * 0.5)
    // Shots miss the net now and then (the director engine never does).
    expect(tm.missed / g2).toBeGreaterThan(6)
    // Real infraction names, several kinds.
    expect(infractions.size).toBeGreaterThanOrEqual(6)
    // Smooth movement: calm cruising, not max-accel steering.
    expect(histPct(tm.accelHist, 0.5)).toBeLessThan(10)
    // Offensive-zone back passes stay in the NHL band (low-to-high in a
    // settled cycle is hockey; on the rush it isn't — see the scorecard).
    expect(ozBack / Math.max(1, ozPasses)).toBeLessThan(0.4)
  }, 900000)

  it('VT15: the coach system is legible on the ice (W3 S4)', () => {
    // Contrasting coaches (the heavy forecheck against the shell, the trap
    // against the structured 1-2-2): what the classifier reads off the
    // positions has to be the system each team declared, and the systems have
    // to look different from each other. Before S4 every team played the same
    // shapes and nothing was declared.
    const pairs: Array<[CoachSystemId, CoachSystemId]> = [['aggressiveForecheck', 'defensiveShell'], ['lowEventTrap', 'structuredTwoWay']]
    const fc = new Map<CoachSystemId, SeqCase<string>[]>()
    const dz = new Map<CoachSystemId, SeqCase<string>[]>()
    let labelled = 0
    for (const [k, [A, B]] of pairs.entries()) {
      for (let i = 0; i < 3; i++) {
        const [hs, as] = i % 2 === 0 ? [A, B] : [B, A]
        const h0 = team(k * 3 + i)
        const a0 = team(k * 3 + i + 8)
        const out = agentSimGame({ ...h0, coachSystem: hs, tactics: tacticsForSystem(hs, h0.tactics) }, { ...a0, coachSystem: as, tactics: tacticsForSystem(as, a0.tactics) }, resolve, { seed: 6100 + k * 10 + i })
        const { frames, passes } = systemFramesFromStream(out.stream)
        labelled += frames.filter((f) => f.homeSystem && f.awaySystem).length
        const r = judgeSystems(frames, passes)
        for (const [side, sys] of [['home', hs], ['away', as]] as const) {
          fc.set(sys, [...(fc.get(sys) ?? []), ...r[side].forecheck])
          dz.set(sys, [...(dz.get(sys) ?? []), ...r[side].dzone])
        }
      }
    }
    const lines: string[] = []
    const share = (m: Map<CoachSystemId, SeqCase<string>[]>, s: CoachSystemId, cls: string): number => {
      const cs = (m.get(s) ?? []).filter((c) => c.declared)
      return cs.length ? cs.filter((c) => c.classified === cls).length / cs.length : 0
    }
    for (const s of ['aggressiveForecheck', 'defensiveShell', 'lowEventTrap', 'structuredTwoWay'] as CoachSystemId[]) {
      const l = legibility(fc.get(s) ?? [])
      const d = legibility(dz.get(s) ?? [])
      lines.push(`${s}: forecheck ${l.matched}/${l.judged} (exact ${l.exact}) ${JSON.stringify(l.table)}; D zone ${d.matched}/${d.judged} ${JSON.stringify(d.table)}`)
    }
    // eslint-disable-next-line no-console
    console.log(`VT15 system legibility:\n  ${lines.join('\n  ')}`)
    expect(labelled).toBeGreaterThan(1000)
    // forecheck: pressure (2-1-2 / 1-2-2) vs sitting back (1-3-1 / 1-4), read off the bodies
    for (const s of ['aggressiveForecheck', 'defensiveShell', 'lowEventTrap', 'structuredTwoWay'] as CoachSystemId[]) {
      const l = legibility(fc.get(s) ?? [])
      expect(l.judged, s).toBeGreaterThan(20)
      expect(l.share, `${s} ${lines.join(' | ')}`).toBeGreaterThan(VT15_GATE.forecheckFamily)
    }
    // the shell sits back further than the trap's F1 (1-4 vs 1-3-1); the heavy forecheck presses where the shell sits back
    expect(share(fc, 'defensiveShell', '1-4')).toBeGreaterThan(share(fc, 'lowEventTrap', '1-4'))
    const pressure = (s: CoachSystemId): number => share(fc, s, '2-1-2') + share(fc, s, '1-2-2')
    expect(pressure('aggressiveForecheck') - pressure('defensiveShell')).toBeGreaterThan(VT15_GATE.pressureLead)
    // D zone: the shell's collapse reads as a collapse far more often than a box team's coverage
    expect(share(dz, 'defensiveShell', 'collapse') - share(dz, 'structuredTwoWay', 'collapse')).toBeGreaterThan(VT15_GATE.collapseLead)
  }, 600000)
})
