/**
 * The beat-gate law (Gap #1 / bar B2.2). These are the cases that softlocked a
 * live playthrough: two gates live at once, and a gate whose screen has nothing
 * to render. Both used to leave Continue pressing forever with no escape.
 */
import { describe, expect, it } from 'vitest'
import { liveBeatGates, routeContinue, sceneToOpen, type GateFlags, type LastRoute } from './beatGates'

/** Press Continue `n` times from `screen`, following the law like the shell
 *  does, and report every distinct thing it decided to do. */
function press(d: GateFlags, screen: string, n: number, bounceFrom?: string): string[] {
  let cur = screen
  let lastRoute: LastRoute | null = null
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const dec = routeContinue({ dashboard: d, screen: cur, lastRoute })
    out.push(dec.kind === 'spend' ? `spend:${dec.gate.key}:${dec.reason}` : dec.kind === 'route' ? `route:${dec.gate.screen}` : dec.kind)
    if (dec.kind === 'route') {
      lastRoute = { screen: dec.gate.screen, label: d.continueLabel ?? '' }
      cur = dec.gate.screen
      // A screen with nothing to render bounces the GM straight back.
      if (cur === bounceFrom) cur = 'dashboard'
    } else {
      lastRoute = null
      if (dec.kind === 'hardGate') cur = dec.screen
    }
  }
  return out
}

describe('beat gates — Continue never dead-ends', () => {
  it('no gate live: Continue just advances the calendar', () => {
    expect(press({ continueLabel: 'Continue to Oct 12' }, 'dashboard', 3)).toEqual(['advance', 'advance', 'advance'])
  })

  // PHASE 0: Continue always advances. It never walks the GM into a room —
  // a moment opens itself (sceneToOpen) — so it can never ping-pong either.
  it('a live gate does not hijack Continue from the dashboard: it advances (the engine delegates)', () => {
    const d: GateFlags = { staffMeetingDue: true, continueLabel: 'Continue to Nov 12' }
    expect(press(d, 'dashboard', 3)).toEqual(['advance', 'advance', 'advance'])
  })

  it('standing in the room, Continue spends the beat (advances in place)', () => {
    const d: GateFlags = { staffMeetingDue: true }
    expect(press(d, 'staffBriefing', 2)).toEqual(['spend:staffMeeting:attending', 'spend:staffMeeting:attending'])
  })

  it('TWO gates live never ping-pong (the I1 softlock): every press moves time', () => {
    const d: GateFlags = { scoutMeetingDue: true, scoutDigestPending: true, scoutDigestNewsId: 'n1' }
    expect(press(d, 'dashboard', 4).every((x) => x === 'advance')).toBe(true)
    expect(press(d, 'inbox', 1)).toEqual(['spend:scoutDigest:attending'])
    expect(press(d, 'scoutMeeting', 1)).toEqual(['spend:scoutMeeting:attending'])
  })

  it('a moment that ARRIVES opens itself; one already live (walked away from) does not reopen', () => {
    const before: GateFlags = {}
    expect(sceneToOpen({ deadlinePending: true }, before)).toEqual({ key: 'deadline', screen: 'deadlineDay' })
    expect(sceneToOpen({ deadlinePending: true }, { deadlinePending: true })).toBeNull()
    // Two arrive at once: the higher-priority room opens.
    expect(sceneToOpen({ campPending: true, boardMeetingPending: true }, before)?.key).toBe('trainingCamp')
    // Cut day spent → the boardroom arrives → it opens.
    expect(sceneToOpen({ boardMeetingPending: true }, { campPending: true, boardMeetingPending: false })?.key).toBe('boardMeeting')
    // The scout digest is mail, never a scene.
    expect(sceneToOpen({ scoutDigestPending: true, scoutDigestNewsId: 'n9' }, before)).toBeNull()
    expect(sceneToOpen(null, before)).toBeNull()
  })

  it('hard gates route to their own screen and say so when you are already there', () => {
    const draft: GateFlags = { draftPending: true, continueLabel: 'Go to the entry draft' }
    const dec = routeContinue({ dashboard: draft, screen: 'draft', lastRoute: null })
    expect(dec).toEqual({ kind: 'hardGate', screen: 'draft', alreadyThere: true })
    // A hard gate outranks every soft one — you cannot sim past the draft.
    const both: GateFlags = { draftPending: true, staffMeetingDue: true }
    expect(routeContinue({ dashboard: both, screen: 'staffBriefing', lastRoute: null }).kind).toBe('hardGate')
  })

  it('names the gates in the order continueLabel names them', () => {
    const all: GateFlags = {
      campPending: true, devCampPending: true, boardMeetingPending: true, reviewPending: true,
      deadlinePending: true, tradeOffersPending: 2, staffMeetingDue: true, scoutMeetingDue: true,
      scoutDigestPending: true,
    }
    expect(liveBeatGates(all).map((g) => g.key)).toEqual([
      'trainingCamp', 'devCamp', 'boardMeeting', 'seasonReview',
      'deadline', 'tradeOffers', 'staffMeeting', 'scoutMeeting', 'scoutDigest',
    ])
    expect(liveBeatGates(null)).toEqual([])
  })

  it('carries the digest deep-link so Continue opens the item, not just the inbox', () => {
    const d: GateFlags = { scoutDigestPending: true, scoutDigestNewsId: 'news-9' }
    expect(liveBeatGates(d)[0]).toEqual({ key: 'scoutDigest', screen: 'inbox', params: { newsId: 'news-9' } })
  })
})

describe('beat gates — dismissed (E3)', () => {
  it('the review where he is told comes first; then only the job market, even on draft day', () => {
    const told: GateFlags = { gmFired: true, reviewPending: true, draftPending: true, continueLabel: 'Continue — end-of-season review' }
    expect(press(told, 'dashboard', 2)).toEqual(['route:seasonReview', 'spend:seasonReview:attending'])
    const held: GateFlags = { gmFired: true, draftPending: true, continueLabel: 'Take a new job to continue' }
    expect(routeContinue({ dashboard: held, screen: 'draft', lastRoute: null })).toMatchObject({ kind: 'hardGate', screen: 'gmCareer', alreadyThere: false })
    expect(routeContinue({ dashboard: held, screen: 'gmCareer', lastRoute: null })).toMatchObject({ kind: 'hardGate', screen: 'gmCareer', alreadyThere: true })
  })
})
