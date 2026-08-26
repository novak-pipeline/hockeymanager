/**
 * THE BEAT-GATE LAW (Gap #1 / EXCELLENCE bar B2.2).
 *
 * A "beat gate" is a moment the game holds the calendar on: cut day, the
 * boardroom, development camp, the deadline, a standing trade offer, the staff
 * and scout meetings, the scout digest. Each one names itself on the Continue
 * button and owns a screen with a one-click resolve or delegate.
 *
 * The law this module enforces: **Continue must always either walk the GM into
 * a beat he has not attended yet, or spend one. It may never do neither.**
 *
 * The shell used to decide this gate-by-gate — "if gate X is live and I'm not
 * on X's screen, go to X's screen" — and that is a softlock generator the
 * moment TWO gates are live at once: standing on the scout meeting, the next
 * test in the chain sees the scout digest and sends you to the inbox; from the
 * inbox the first test sends you back to the meeting. Continue ping-pongs
 * forever and the sim never ticks. (Reproduced on a vanilla league on day 7 of
 * season one, and on the imported 32-team league at training camp — the user's
 * "after development camp I can't progress unless I do the suggested roster
 * moves" softlock, where actioning the staff meeting's proposals by hand was
 * the only way to break the cycle.)
 *
 * Two rules make it terminate:
 *   1. Standing in the room of ANY live gate, Continue SPENDS. Every soft gate
 *      auto-delegates engine-side on an advance, so spending is always legal.
 *   2. If the last press already routed to this same gate and the GM is still
 *      not there, the screen bounced him (its data was empty) — spend instead
 *      of routing into the same wall again.
 *
 * Pure and React-free so the whole law is testable against a real Career.
 */

/** The screen a beat gate is attended on. */
export type BeatScreen =
  | 'trainingCamp'
  | 'devCamp'
  | 'boardMeeting'
  | 'seasonReview'
  | 'deadlineDay'
  | 'trades'
  | 'staffBriefing'
  | 'scoutMeeting'
  | 'inbox'

/** The HARD gates: the engine cannot advance past them at all, so their escape
 *  lives on the screen itself (auto-draft; "let the coach name him"; "let the
 *  AGM sign emergency cover"). */
export type HardScreen = 'draft' | 'leadership' | 'squad'

export interface BeatGate {
  /** Stable id, for tests and telemetry. */
  key: string
  screen: BeatScreen
  /** Deep-link params for the screen (the digest opens on its own item). */
  params?: Record<string, string>
}

/** The dashboard fields the law reads. */
export interface GateFlags {
  draftPending?: boolean
  captainsPending?: boolean
  campPending?: boolean
  devCampPending?: boolean
  boardMeetingPending?: boolean
  reviewPending?: boolean
  deadlinePending?: boolean
  tradeOffersPending?: number
  staffMeetingDue?: boolean
  scoutMeetingDue?: boolean
  scoutDigestPending?: boolean
  scoutDigestNewsId?: string
  /** Bar B2.2: the club plays next and cannot dress a legal lineup. The engine
   *  refuses the advance outright, so this outranks every beat. */
  lineupShortfall?: string
  /** Used only as the identity of "this gate state" for the bounce check. */
  continueLabel?: string
}

/** A route we already issued: which screen, for which Continue label. */
export interface LastRoute {
  screen: string
  label: string
}

export type ContinueDecision =
  /** A hard gate: route to its screen (or, if already there, say so). The
   *  engine cannot spend these — the screen carries the escape. */
  | { kind: 'hardGate'; screen: HardScreen; alreadyThere: boolean; message?: string }
  /** Walk the GM into the beat. */
  | { kind: 'route'; gate: BeatGate }
  /** Spend the beat: advance in place (the engine delegates it). */
  | { kind: 'spend'; gate: BeatGate; reason: 'attending' | 'bounced' }
  /** No gate is live — advance the calendar normally. */
  | { kind: 'advance' }

/**
 * Every live soft gate, in the order `continueLabel` names them. Order matters:
 * the first is the one Continue walks you into.
 */
export function liveBeatGates(d: GateFlags | null | undefined): BeatGate[] {
  if (!d) return []
  const gates: BeatGate[] = []
  if (d.campPending) gates.push({ key: 'trainingCamp', screen: 'trainingCamp' })
  if (d.devCampPending) gates.push({ key: 'devCamp', screen: 'devCamp' })
  if (d.boardMeetingPending) gates.push({ key: 'boardMeeting', screen: 'boardMeeting' })
  if (d.reviewPending) gates.push({ key: 'seasonReview', screen: 'seasonReview' })
  if (d.deadlinePending) gates.push({ key: 'deadline', screen: 'deadlineDay' })
  if ((d.tradeOffersPending ?? 0) > 0) gates.push({ key: 'tradeOffers', screen: 'trades' })
  if (d.staffMeetingDue) gates.push({ key: 'staffMeeting', screen: 'staffBriefing' })
  if (d.scoutMeetingDue) gates.push({ key: 'scoutMeeting', screen: 'scoutMeeting' })
  if (d.scoutDigestPending) {
    gates.push({
      key: 'scoutDigest',
      screen: 'inbox',
      ...(d.scoutDigestNewsId ? { params: { newsId: d.scoutDigestNewsId } } : {}),
    })
  }
  return gates
}

/**
 * What one press of Continue should do, given the dashboard, where the GM is
 * standing, and the route the previous press issued.
 */
export function routeContinue(args: {
  dashboard: GateFlags | null | undefined
  screen: string
  lastRoute: LastRoute | null
}): ContinueDecision {
  const { dashboard: d, screen, lastRoute } = args
  // Draft day parks the offseason on an unfinished draft; the preseason won't
  // open without a captain. Neither can be simmed past — route and let the
  // screen's own action (auto-pick / "let the coach name him") clear it.
  if (d?.draftPending) return { kind: 'hardGate', screen: 'draft', alreadyThere: screen === 'draft' }
  if (d?.captainsPending) return { kind: 'hardGate', screen: 'leadership', alreadyThere: screen === 'leadership' }
  // An illegal lineup outranks every beat: the engine will not play the game at
  // all, so no soft gate below can be reached, let alone spent.
  if (d?.lineupShortfall) {
    return { kind: 'hardGate', screen: 'squad', alreadyThere: screen === 'squad', message: d.lineupShortfall }
  }

  const gates = liveBeatGates(d)
  if (gates.length === 0) return { kind: 'advance' }

  // Rule 1 — attending. Standing in ANY live beat's room, Continue spends.
  // (Any, not just the top one: with two gates live, insisting on the top one
  // is precisely the ping-pong this law exists to kill.)
  const attending = gates.find((g) => g.screen === screen)
  if (attending) return { kind: 'spend', gate: attending, reason: 'attending' }

  const top = gates[0]!
  // Rule 2 — bounced. We already sent the GM here for this same gate state and
  // he is not there, so the screen refused him (empty camp, no scene). Spend
  // rather than route into the same wall forever.
  if (lastRoute && lastRoute.screen === top.screen && lastRoute.label === (d?.continueLabel ?? '')) {
    return { kind: 'spend', gate: top, reason: 'bounced' }
  }
  return { kind: 'route', gate: top }
}
