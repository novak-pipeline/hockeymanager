/**
 * The beat-gate law (Gap #1 / bar B2.2). These are the cases that softlocked a
 * live playthrough: two gates live at once, and a gate whose screen has nothing
 * to render. Both used to leave Continue pressing forever with no escape.
 */
import { describe, expect, it } from 'vitest'
import { liveBeatGates, routeContinue, type GateFlags, type LastRoute } from './beatGates'

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

  it('one gate live: first press walks you in, the second spends it', () => {
    const d: GateFlags = { staffMeetingDue: true, continueLabel: 'Continue — staff meeting' }
    expect(press(d, 'dashboard', 3)).toEqual([
      'route:staffBriefing',
      'spend:staffMeeting:attending',
      'spend:staffMeeting:attending',
    ])
  })

  it('TWO gates live no longer ping-pong (the I1 softlock)', () => {
    // The scout meeting and the scout digest were both up on day 7 of season
    // one. Gate-by-gate routing sent the GM meeting → inbox → meeting → inbox
    // forever, because each test only asked "am I on MY screen?".
    const d: GateFlags = {
      scoutMeetingDue: true,
      scoutDigestPending: true,
      scoutDigestNewsId: 'n1',
      continueLabel: 'Continue — scout meeting',
    }
    const seq = press(d, 'dashboard', 6)
    expect(seq[0]).toBe('route:scoutMeeting')
    // Every press after the first one SPENDS — the sim ticks.
    expect(seq.slice(1).every((s) => s.startsWith('spend:'))).toBe(true)
    // And from the OTHER gate's screen it spends immediately rather than
    // bouncing back to the first one.
    expect(press(d, 'inbox', 1)).toEqual(['spend:scoutDigest:attending'])
  })

  it('camp + boardroom (the imported-league lock) resolves in two presses', () => {
    const d: GateFlags = { campPending: true, boardMeetingPending: true, continueLabel: 'Continue — training camp' }
    const seq = press(d, 'dashboard', 4)
    expect(seq).toEqual([
      'route:trainingCamp',
      'spend:trainingCamp:attending',
      'spend:trainingCamp:attending',
      'spend:trainingCamp:attending',
    ])
  })

  it('a gate whose screen bounces the GM back is spent, not re-routed forever', () => {
    // Dev camp armed with an empty invite list: the screen renders nothing and
    // sends the GM to the dashboard, so he is never "attending".
    const d: GateFlags = { devCampPending: true, continueLabel: 'Continue — development camp' }
    expect(press(d, 'dashboard', 4, 'devCamp')).toEqual([
      'route:devCamp',
      'spend:devCamp:bounced',
      'route:devCamp',
      'spend:devCamp:bounced',
    ])
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
