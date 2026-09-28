/**
 * Agent-engine telemetry: motion quality, possession, rules, physical play.
 * Additive across games; populated only when passed in AgentSimOptions.
 */
import type { Body } from './physics'
import type { HitResult } from './physical'

export interface AgentTelemetry {
  frames: number
  liveSeconds: number
  /** Histogram of skater acceleration magnitude (ft/s², 1-wide bins 0..40). */
  accelHist: number[]
  /** Histogram of skater speed (ft/s, 1-wide bins 0..40). */
  speedHist: number[]
  /** Body pairs overlapping more than 0.5 ft after resolution (should be ~0). */
  overlaps: number
  carrierThinks: number
  protects: number
  passes: number
  passesCompleted: number
  passesIntercepted: number
  passesDeflected: number
  ozPasses: number
  ozBackPasses: number
  dumps: number
  shotAttempts: number
  unblocked: number
  missed: number
  blocked: number
  shotsOnGoal: number
  shotDanger: number
  oneTimers: number
  rushShots: number
  saves: number
  goals: number
  entriesCarry: number
  entriesDump: number
  entriesPass: number
  offsides: number
  delayedOffsides: number
  icings: number
  overGlass: number
  pinWhistles: number
  faceoffs: number
  lineChanges: number
  stoppages: { offside: number; icing: number; goalieFreeze: number; penalty: number; goal: number; other: number }
  pokeAttempts: number
  pokeSuccess: number
  takeaways: number
  giveaways: number
  fumbles: number
  stickLifts: number
  hits: number
  hitsBoards: number
  hitsPlanned: number
  hitsLoosePuck: number
  hitForceSum: number
  hitsByRole: Record<string, number>
  penalties: number
  delayedCalls: number
  infractions: Record<string, number>
  fights: number
  battles: number
  /** Carry entries by numbers: '<attackers>v<goal-side defenders>[T=transition] c<defenders caught up ice>'. */
  entryNumbers: Record<string, number>
  entryLog: string[]
  /** 1-on-1 moves: attempted, won, and how many were on the goalie. */
  dekes: number
  dekesWon: number
  dekesOnGoalie: number
  dekesOnGoalieWon: number
  /** Free-form debug counters (probes only). */
  dbg: Record<string, number>
  dbgLog: string[]
  /** Dirty/star hits answered at the next whistle (fight or roughing). */
  codeAnswers: number
  /** Per-attempt diagnostics: distance, nearest defender, defenders in the house, seconds since the side won the puck. */
  shotLog: { dist: number; nearest: number; house: number; poss: number; sinceEntry: number; held: number; carried: number; src: string }[]
  noteAccel(acc: number, speed: number): void
  noteOverlap(bodies: readonly Body[]): void
  noteHit(r: HitResult): void
}

export function emptyAgentTelemetry(): AgentTelemetry {
  const t: AgentTelemetry = {
    frames: 0,
    liveSeconds: 0,
    accelHist: new Array(41).fill(0),
    speedHist: new Array(41).fill(0),
    overlaps: 0,
    carrierThinks: 0,
    protects: 0,
    passes: 0,
    passesCompleted: 0,
    passesIntercepted: 0,
    passesDeflected: 0,
    ozPasses: 0,
    ozBackPasses: 0,
    dumps: 0,
    shotAttempts: 0,
    unblocked: 0,
    missed: 0,
    blocked: 0,
    shotsOnGoal: 0,
    shotDanger: 0,
    oneTimers: 0,
    rushShots: 0,
    saves: 0,
    goals: 0,
    entriesCarry: 0,
    entriesDump: 0,
    entriesPass: 0,
    offsides: 0,
    delayedOffsides: 0,
    icings: 0,
    overGlass: 0,
    pinWhistles: 0,
    faceoffs: 0,
    lineChanges: 0,
    stoppages: { offside: 0, icing: 0, goalieFreeze: 0, penalty: 0, goal: 0, other: 0 },
    pokeAttempts: 0,
    pokeSuccess: 0,
    takeaways: 0,
    giveaways: 0,
    fumbles: 0,
    stickLifts: 0,
    hits: 0,
    hitsBoards: 0,
    hitsPlanned: 0,
    hitsLoosePuck: 0,
    hitForceSum: 0,
    hitsByRole: {},
    penalties: 0,
    delayedCalls: 0,
    infractions: {},
    fights: 0,
    battles: 0,
    entryNumbers: {},
    entryLog: [],
    dekes: 0,
    dekesWon: 0,
    dekesOnGoalie: 0,
    dekesOnGoalieWon: 0,
    dbg: {},
    dbgLog: [],
    codeAnswers: 0,
    shotLog: [],
    noteAccel(acc, speed) {
      this.accelHist[Math.min(40, Math.floor(acc))]++
      this.speedHist[Math.min(40, Math.floor(speed))]++
    },
    noteOverlap(bodies) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i]
          const b = bodies[j]
          if (Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius - 0.5) this.overlaps++
        }
      }
    },
    noteHit(r) {
      this.hits++
      if (r.boards) this.hitsBoards++
      if (r.planned) this.hitsPlanned++
      if (r.loosePuck) this.hitsLoosePuck++
      this.hitForceSum += r.force
      const role = r.hitter.player.role ?? 'none'
      this.hitsByRole[role] = (this.hitsByRole[role] ?? 0) + 1
    }
  }
  return t
}

/** Percentile of a 1-wide histogram. */
export function histPct(h: readonly number[], q: number): number {
  const tot = h.reduce((a, b) => a + b, 0)
  let acc = 0
  for (let i = 0; i < h.length; i++) {
    acc += h[i]
    if (acc >= tot * q) return i + 0.5
  }
  return h.length
}
