/**
 * Negotiation threads — the MEMORY a trade conversation needs.
 *
 * Before this, every trade call was turn one: the partner GM had no idea he had
 * already asked you for something, whether he had moved, or how long this had
 * been going on. A thread remembers the round, both sides' last positions, the
 * direction and size of the gap, whether HE conceded, and how much patience is
 * left — which is what lets the dialogue in {@link '@engine/story/tradeTalk'}
 * reference history instead of re-introducing the player every time.
 *
 * Pure + JSON-safe: the engine owns every number (evaluateProposal), this owns
 * only the bookkeeping. Threads are persisted on the snapshot so a negotiation
 * in progress survives a reload with its teeth intact.
 */
import type { GapBand, Movement } from '@engine/story/tradeTalk'

/** One live (or recently closed) trade conversation. JSON-safe. */
export interface TradeThread {
  /** Stable key: partner + the assets the USER is chasing. */
  key: string
  partnerTeamId: string
  /** 1-based; incremented every time the user puts a package in front of him. */
  round: number
  /** The shortfall he named last round, in trade-value units. */
  lastGap: number
  /** Value of the package the user last sent. */
  lastGiveValue: number
  /** Value of what the user is chasing — the yardstick for the gap band. */
  targetValue: number
  /** Times HE has lowered his ask between rounds. */
  concessions: number
  /** Rounds where the user came back without adding anything real. */
  stalls: number
  /** Rounds of countering he will tolerate before the final offer. */
  patienceRounds: number
  /** Day he walked away, or null while talks are live. */
  walkedOnDay: number | null
  /** Day the cool-off expires — dial before this and he says so. */
  reopenDay: number
  openedDay: number
  lastDay: number
  year: number
}

/** Threads are keyed on WHO you are talking to and WHAT you are chasing. */
export function threadKey(
  partnerTeamId: string,
  receivePlayerIds: readonly string[],
  receivePickIds: readonly string[],
): string {
  const chase = [...receivePlayerIds, ...receivePickIds].slice().sort().join('+')
  return `${partnerTeamId}|${chase || 'none'}`
}

/**
 * How many rounds of countering this GM will sit through before he tables a
 * final offer. Patient GMs grind; sharks get bored. Kept deliberately narrow
 * (3–6) so a walk-away is reachable in one real negotiation, not a career.
 */
export function patienceRoundsFor(p: { aggression: number; patience: number }): number {
  const base = 3 + Math.round(p.patience * 3) // 3–6
  return p.aggression >= 0.75 ? Math.max(3, base - 1) : base
}

export function openThread(args: {
  key: string
  partnerTeamId: string
  day: number
  year: number
  targetValue: number
  persona: { aggression: number; patience: number }
}): TradeThread {
  return {
    key: args.key,
    partnerTeamId: args.partnerTeamId,
    round: 0,
    lastGap: -1,
    lastGiveValue: -1,
    targetValue: args.targetValue,
    concessions: 0,
    stalls: 0,
    patienceRounds: patienceRoundsFor(args.persona),
    walkedOnDay: null,
    reopenDay: 0,
    openedDay: args.day,
    lastDay: args.day,
    year: args.year,
  }
}

/**
 * Did his ask move since last round? A concession has to be a real one —
 * shaving 2% off is holding firm with extra words, and the dialogue must not
 * call it generosity.
 */
export function classifyMovement(prevGap: number, gap: number): Movement {
  if (prevGap < 0) return 'opening'
  const delta = gap - prevGap
  const scale = Math.max(1, Math.abs(prevGap))
  if (delta <= -0.08 * scale) return 'conceded'
  if (delta >= 0.08 * scale) return 'hardened'
  return 'held'
}

/** How far apart, measured against what is actually being chased. */
export function gapBand(gap: number, targetValue: number): GapBand {
  const scale = Math.max(1, targetValue)
  const frac = gap / scale
  if (frac <= 0.12) return 'slim'
  if (frac <= 0.35) return 'real'
  return 'wide'
}

/**
 * Fold a fresh round into the thread. Returns a NEW thread (never mutates) plus
 * the two axes the dialogue selects on. Stalling — coming back with a package
 * no better than the last one — costs patience on top of the round itself, so
 * a GM who is being wasted walks sooner than one being negotiated with.
 */
export function advanceThread(
  thread: TradeThread,
  round: { gap: number; giveValue: number; day: number; year: number },
): { thread: TradeThread; moved: Movement; gap: GapBand } {
  const moved = classifyMovement(thread.lastGap, round.gap)
  const stalled =
    thread.lastGiveValue >= 0 && round.giveValue <= thread.lastGiveValue * 1.02
  const next: TradeThread = {
    ...thread,
    round: thread.round + 1,
    lastGap: round.gap,
    lastGiveValue: round.giveValue,
    concessions: thread.concessions + (moved === 'conceded' ? 1 : 0),
    stalls: thread.stalls + (stalled ? 1 : 0),
    lastDay: round.day,
    year: round.year,
  }
  return { thread: next, moved, gap: gapBand(round.gap, thread.targetValue) }
}

/**
 * Where the arc stands after this round. Rounds spent AND rounds wasted both
 * count against him, so the GM who has been sent the same deal three times
 * reaches his final offer before the one who has been genuinely haggled with.
 */
export function threadStage(thread: TradeThread): 'counter' | 'final' | 'walk' {
  // Nobody hangs up on you in round two. Wasted rounds accelerate the ending;
  // they can't skip to it — the GM has to have genuinely been at this a while.
  if (thread.round < 3) return 'counter'
  const spent = thread.round + thread.stalls
  if (spent > thread.patienceRounds) return 'walk'
  if (spent === thread.patienceRounds) return 'final'
  return 'counter'
}

/** Days he stays gone. Short at the deadline (the market forgets fast), a real
 *  fortnight otherwise — long enough that walking away means something. */
export function coolOffDays(deadlineSoon: boolean): number {
  return deadlineSoon ? 4 : 14
}

/** Close a thread out: he is gone until `reopenDay`. */
export function walkThread(thread: TradeThread, day: number, deadlineSoon: boolean): TradeThread {
  return { ...thread, walkedOnDay: day, reopenDay: day + coolOffDays(deadlineSoon), lastDay: day }
}

/** Is he still refusing to pick up? */
export function inCoolOff(thread: TradeThread, day: number): boolean {
  return thread.walkedOnDay !== null && day < thread.reopenDay
}

/** Drop threads that are stale or from a previous season — bounded state. */
export function pruneThreads(
  threads: readonly TradeThread[],
  args: { day: number; year: number; max?: number },
): TradeThread[] {
  const live = threads.filter(
    (t) => t.year === args.year && (args.day - t.lastDay <= 60 || inCoolOff(t, args.day)),
  )
  const max = args.max ?? 40
  return live.length <= max ? live : live.slice(live.length - max)
}
