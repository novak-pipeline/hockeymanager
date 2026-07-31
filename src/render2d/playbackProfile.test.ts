/**
 * PLAYBACK PROFILER — not a unit test. A measurement harness for the watched-game
 * playback path (playtest finding C2: "2× speed in the 2D view is laggy").
 *
 * It replays a REAL full-sim stream through the REAL playback modules at 60 fps
 * and times each layer separately, so the cost can be attributed instead of
 * guessed at:
 *
 *   R  renderer/timeline  — MatchTimeline.sampleAt + scoreAt + clockAt, i.e.
 *                           everything RinkRenderer.tick() does other than the
 *                           Pixi draw itself.
 *   D  playback director  — currentSpeed + nextActiveJump (per-tick plan lookup).
 *   E  event processing   — MatchViewer._onUpdate's per-tick work: the SFX cue
 *                           scan, the crossed-whistle scan, and the commentary
 *                           slice.
 *
 * Pixi's own draw is NOT timed here (no WebGL in node) — but it does not need to
 * be: RinkRenderer.tick() calls renderAt() exactly once per rAF and draws the
 * same 12 discs + 14 labels no matter the speed, so the draw cost is identical at
 * 1× and 2×. Anything that makes 2× worse than 1× must live in R, D or E, or in
 * the React commits counted below.
 *
 * Excluded from `npm test` (see vitest.config.ts). Run on demand:
 *   npx vitest run --config vitest.profile.config.ts
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { GameStream, Player, PlayerId } from '@domain'
import { fullSimGame } from '@engine/full/fullSim'
import { EventCursor } from './eventCursor'
import { MatchTimeline } from './timeline'
import { generateCommentary, type CommentaryLine } from './commentary'
import { currentSpeed, nextActiveJump, planFor } from './playbackDirector'

/** Vitest swallows console output in a non-TTY run — mirror it to a file too. */
const OUT_FILE = 'docs/perf/2d-playback-profile.txt'
function out(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s)
  appendFileSync(OUT_FILE, `${s}\n`)
}

const FPS = 60
const FRAME_MS = 1000 / FPS
/** 60 fps budget in ms — a tick costing more than this cannot hold frame rate. */
const BUDGET_MS = FRAME_MS

function buildGame(): {
  stream: GameStream
  homeIds: Set<string>
  names: (id: string) => string
} {
  const data = generateLeague({ seed: 7 })
  const resolve = (id: PlayerId): Player => {
    const p = data.players.get(id)
    if (!p) throw new Error(`unknown player ${id}`)
    return p
  }
  const [aId, bId] = data.league.teams
  const home = data.teams.get(aId)!
  const away = data.teams.get(bId)!
  const out = fullSimGame(home, away, resolve, { seed: 123 })
  const homeIds = new Set<string>(home.roster.map((id) => id as string))
  const names = (id: string): string => {
    const p = data.players.get(id as PlayerId)
    return p ? p.name : id
  }
  return { stream: out.stream, homeIds, names }
}

/* ── The per-tick event processing exactly as MatchViewer ships it at HEAD ──── */

/** MatchViewer.findCrossedWhistle — full-stream scan, once per tick. */
function shippedFindCrossedWhistle(stream: GameStream, fromAbsT: number, toAbsT: number): boolean {
  for (const ev of stream) {
    if (ev.type !== 'whistle') continue
    const at = (ev.period - 1) * 1200 + ev.t
    if (at > fromAbsT && at <= toAbsT) return true
  }
  return false
}

/** MatchViewer's SFX cue map — full-stream scan, once per tick. */
function shippedSfxScan(stream: GameStream, lastSfx: number, currentAbsT: number): number {
  let cues = 0
  for (const ev of stream) {
    const at = (ev.period - 1) * 1200 + ev.t
    if (at <= lastSfx || at > currentAbsT) continue
    switch (ev.type) {
      case 'pass':
      case 'shot':
      case 'save':
      case 'faceoff':
      case 'whistle':
      case 'periodEnd':
        cues++
        break
      default:
        break
    }
    if (ev.type === 'shot' && ev.danger >= 0.6) cues++
    if (ev.type === 'goal') cues++
  }
  return cues
}

interface PhaseTotals {
  ticks: number
  rMs: number
  dMs: number
  eMs: number
  sfxCues: number
  /** React commits from setVisibleLines (setView fires once per tick, always). */
  lineCommits: number
  worstTickMs: number
}

function replay(
  stream: GameStream,
  timeline: MatchTimeline,
  lines: CommentaryLine[],
  plan: ReturnType<typeof planFor>,
  speed: number,
  /** 'scan' = the two full-stream walks MatchViewer shipped with; 'cursor' = the fix. */
  events: 'scan' | 'cursor' = 'scan'
): PhaseTotals {
  const dur = timeline.duration
  const dt = (FRAME_MS / 1000) * speed
  let clock = 0
  let lastAbsT = -1
  let lastSfx = -1
  let lastCommentary = -1

  const tot: PhaseTotals = { ticks: 0, rMs: 0, dMs: 0, eMs: 0, sfxCues: 0, lineCommits: 0, worstTickMs: 0 }
  const cursor = new EventCursor(stream)

  while (clock < dur) {
    clock = Math.min(dur, clock + dt)
    tot.ticks++

    // R — timeline sample + score + clock (RinkRenderer.tick minus the Pixi draw)
    const r0 = performance.now()
    timeline.sampleAt(clock)
    timeline.scoreAt(clock)
    timeline.clockAt(clock)
    const r1 = performance.now()
    tot.rMs += r1 - r0

    // D — plan lookup
    nextActiveJump(plan, clock)
    currentSpeed(plan, clock)
    const d1 = performance.now()
    tot.dMs += d1 - r1

    // E — MatchViewer._onUpdate per-tick work
    const newLines = lines.filter((l) => l.absT > lastCommentary && l.absT <= clock)
    if (newLines.length > 0) tot.lineCommits++
    lastCommentary = clock
    if (events === 'scan') {
      tot.sfxCues += shippedSfxScan(stream, lastSfx, clock)
      shippedFindCrossedWhistle(stream, lastAbsT, clock)
    } else {
      // One walk of what actually crossed — SFX cue AND whistle chip in the same
      // pass, which is what MatchViewer now does.
      for (const { ev } of cursor.advance(clock)) {
        switch (ev.type) {
          case 'pass': case 'shot': case 'save': case 'faceoff': case 'whistle': case 'periodEnd':
            tot.sfxCues++
            break
          default: break
        }
        if (ev.type === 'shot' && ev.danger >= 0.6) tot.sfxCues++
        if (ev.type === 'goal') tot.sfxCues++
      }
    }
    lastSfx = clock
    lastAbsT = clock
    const e1 = performance.now()
    tot.eMs += e1 - d1

    const tick = e1 - r0
    if (tick > tot.worstTickMs) tot.worstTickMs = tick
  }
  return tot
}

function report(label: string, t: PhaseTotals, speed: number): void {
  const per = (ms: number): string => (ms / t.ticks).toFixed(3).padStart(7)
  const wallSec = t.ticks / FPS
  const total = (t.rMs + t.dMs + t.eMs) / t.ticks
  /* eslint-disable no-console */
  out(
    `\n── ${label} (speed ${speed}×) ──` +
      `\n   ticks ${t.ticks}  ≈ ${wallSec.toFixed(1)} s of wall-clock playback` +
      `\n   R renderer/timeline  ${per(t.rMs)} ms/tick   (${((t.rMs / t.ticks / BUDGET_MS) * 100).toFixed(1)}% of the 16.7 ms budget)` +
      `\n   D playback director  ${per(t.dMs)} ms/tick   (${((t.dMs / t.ticks / BUDGET_MS) * 100).toFixed(1)}%)` +
      `\n   E event processing   ${per(t.eMs)} ms/tick   (${((t.eMs / t.ticks / BUDGET_MS) * 100).toFixed(1)}%)` +
      `\n   TOTAL                ${total.toFixed(3).padStart(7)} ms/tick   (${((total / BUDGET_MS) * 100).toFixed(1)}%)` +
      `\n   worst single tick    ${t.worstTickMs.toFixed(2)} ms` +
      `\n   SFX cues fired       ${t.sfxCues}  (${(t.sfxCues / wallSec).toFixed(1)} / wall-second)` +
      `\n   React commits        ${t.ticks} from setView + ${t.lineCommits} from setVisibleLines` +
      `\n                        = ${((t.ticks + t.lineCommits) / wallSec).toFixed(1)} / wall-second`
  )
  /* eslint-enable no-console */
}

/** Seconds of sim time between consecutive positional frames (engine FRAME_DT). */
const SIM_FRAME_DT = 0.25

/**
 * At an effective playback rate, how many rendered frames cover one engine
 * frame, and how far the puck travels per rendered frame. Linear interpolation
 * is smooth WITHIN an engine frame and kinks at every boundary, so the boundary
 * rate (per wall-second) is the judder rate the eye actually sees.
 */
function motionLine(timeline: MatchTimeline, effSpeed: number): string {
  const step = (1 / FPS) * effSpeed
  let clock = 300 // sample a minute of settled play, not the opening faceoff
  let prev = timeline.sampleAt(clock)
  let maxJump = 0
  let sumJump = 0
  let n = 0
  const end = Math.min(timeline.duration, 900)
  while (clock < end) {
    clock += step
    const s = timeline.sampleAt(clock)
    if (prev && s) {
      // Normalised rink coords are [-1,1] on a 200 ft sheet → 100 ft per unit.
      const d = Math.hypot(s.puck.x - prev.puck.x, s.puck.y - prev.puck.y) * 100
      sumJump += d
      if (d > maxJump) maxJump = d
      n++
    }
    prev = s
  }
  const perEngineFrame = SIM_FRAME_DT / step
  const kinksPerSec = effSpeed / SIM_FRAME_DT
  return (
    `   ${String(effSpeed).padStart(2)}× effective: ${perEngineFrame.toFixed(2).padStart(5)} rendered frames per engine frame · ` +
    `${kinksPerSec.toFixed(0).padStart(3)} direction changes/sec · ` +
    `puck moves ${(sumJump / Math.max(1, n)).toFixed(2)} ft/frame (max ${maxJump.toFixed(1)} ft)`
  )
}

describe('2D playback profile', () => {
  it('attributes the per-tick cost at 1× vs 2× vs 4×', () => {
    writeFileSync(OUT_FILE, `2D playback profile — ${process.env.PROFILE_LABEL ?? 'run'}\n`)
    const { stream, homeIds, names } = buildGame()
    const timeline = new MatchTimeline(stream, (id) => homeIds.has(id as string))
    const lines = generateCommentary(stream, names, (id) => homeIds.has(id), { home: 'HME', away: 'AWY' })
    const plan = planFor(stream, 'full')

    const counts = new Map<string, number>()
    for (const ev of stream) counts.set(ev.type, (counts.get(ev.type) ?? 0) + 1)
    /* eslint-disable no-console */
    console.log(
      `\n── stream ──\n   ${stream.length} events over ${timeline.duration.toFixed(0)} s\n   ` +
        [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ') +
        `\n   commentary lines: ${lines.length}   speed-plan segments: ${plan.length}`
    )
    /* eslint-enable no-console */

    for (const speed of [1, 2, 4]) {
      report('BEFORE — full-stream scans per frame', replay(stream, timeline, lines, plan, speed, 'scan'), speed)
      report('AFTER  — EventCursor', replay(stream, timeline, lines, plan, speed, 'cursor'), speed)
    }

    // ── motion resolution ─────────────────────────────────────────────────────
    // The CPU profile (docs/perf/2d-match-cpu-profile.txt) shows the frame
    // pipeline is NOT the constraint. What does change with speed is how much of
    // the 4 Hz positional stream each rendered frame has to cover: the effective
    // rates a 'full' plan actually reaches are 2× (open play), 5× (whistle →
    // faceoff dead time), and double each of those with the 2× nudge.
    out('\n── motion resolution (how much sim-time each rendered frame covers) ──')
    for (const eff of [1, 2, 4, 5, 10]) {
      out(motionLine(timeline, eff))
    }

    expect(stream.length).toBeGreaterThan(1000)
  }, 600_000)
})
