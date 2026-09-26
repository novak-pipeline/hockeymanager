/**
 * THE BEAT-GATE LAW (Gap #1 / EXCELLENCE bar B2.2) — PHASE 0 revision.
 *
 * PHASE 0 (depth audit 2026-09, the interruption diet): **Continue always
 * advances time.** It no longer walks the GM into a beat and it no longer
 * carries destination labels ("Continue — staff meeting"). Instead a real
 * moment OPENS ITSELF as a scene on the advance that brings it
 * ({@link sceneToOpen}); standing in that room, the next Continue spends it and
 * moves on. Walk away from it and Continue still advances — the engine
 * delegates the beat, exactly as it always did for a beat simmed past. Only the
 * HARD gates (draft, captain, an illegal lineup, a dismissed GM) stop the
 * clock, because the engine genuinely cannot move without an action.
 *
 * The text below is the original law; its softlock guarantees still hold (an
 * advance can never ping-pong, because it never routes).
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
export type HardScreen = 'draft' | 'leadership' | 'squad' | 'gmCareer'

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
  /** E3: the GM was dismissed. Nothing moves until he takes a new chair; the
   *  escape is the GM Career screen's job market (always one takeable job). */
  gmFired?: boolean
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
  // Dismissed (E3): outranks everything — a fired GM does not run this club's
  // draft. The season review, where he is told, comes first; after it the job
  // market is the only way forward and the engine will not advance.
  if (d?.gmFired) {
    if (d.reviewPending) {
      const review: BeatGate = { key: 'seasonReview', screen: 'seasonReview' }
      return screen === 'seasonReview'
        ? { kind: 'spend', gate: review, reason: 'attending' }
        : lastRoute && lastRoute.screen === 'seasonReview' && lastRoute.label === (d.continueLabel ?? '')
          ? { kind: 'spend', gate: review, reason: 'bounced' }
          : { kind: 'route', gate: review }
    }
    return {
      kind: 'hardGate',
      screen: 'gmCareer',
      alreadyThere: screen === 'gmCareer',
      message: 'You were dismissed. Take one of the open GM jobs to continue.',
    }
  }
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

  // Attending. Standing in ANY live beat's room, Continue spends it (advances
  // in place — no overlay; the room IS the stop).
  const attending = gates.find((g) => g.screen === screen)
  if (attending) return { kind: 'spend', gate: attending, reason: 'attending' }

  // PHASE 0: not in the room → Continue simply advances. The engine delegates
  // whatever the GM walked away from; nothing routes, so nothing can bounce.
  void lastRoute
  return { kind: 'advance' }
}

/**
 * PHASE 0 — the scenes that open THEMSELVES when their moment arrives.
 *
 * After an advance, compare the gate state before and after: a gate that just
 * became live is a moment that arrived on this press, and the shell opens its
 * room (no signpost, no extra click). A gate that was already live before the
 * press is one the GM already walked away from — it is not reopened.
 *
 * Which gates count as moments is decided ENGINE-side: the engine only arms a
 * trade-offer gate for an offer worth the GM, a staff meeting when a finding
 * crosses a threshold (and the GM has not delegated), a scout meeting inside
 * the scouting windows. The weekly scout digest is inbox mail, never a scene.
 */
export function sceneToOpen(
  after: GateFlags | null | undefined,
  before: GateFlags | null | undefined
): BeatGate | null {
  const was = new Set(liveBeatGates(before).map((g) => g.key))
  for (const g of liveBeatGates(after)) {
    if (g.key === 'scoutDigest') continue
    if (!was.has(g.key)) return g
  }
  return null
}
