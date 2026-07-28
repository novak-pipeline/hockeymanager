/**
 * Beat-gate law (EXCELLENCE B2.2, Gap #1): every state that hijacks Continue has
 * to say so on the button first.
 *
 * The pre-opening beats (camp, cut day, boardroom) already named themselves, but
 * the in-season gates did not — the shell routed the GM into a staff meeting, a
 * scout meeting, the digest or deadline day while the button still read
 * "Continue to Nov 12". A beat arriving unannounced breaks the same trust as one
 * with no way out, so each gate is pinned to its label here. A new gate added to
 * the routing without a label will fail this.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'

/** Reach into the private gate state — these are engine internals with no public
 *  setter, and the point of the test is exactly that they drive the label. */
type Gates = {
  staffMeetingScene: unknown
  scoutMeetingScene: unknown
  scoutDigestPending: boolean
  deadlineHold: boolean
  reviewFacts: unknown
  trainingCamp: unknown
}

function seasonCareer(): { career: Career; gates: Gates } {
  const data = generateLeague({ seed: 2029 })
  const career = new Career(data, 2029, data.league.teams[3]!)
  const gates = career as unknown as Gates
  // Clear the preseason beats so the baseline is an ordinary match day.
  gates.trainingCamp = null
  career.advanceDay()
  return { career, gates }
}

describe('continueLabel — every gate names itself', () => {
  it('reads as an ordinary match day when nothing is pending', () => {
    const { career } = seasonCareer()
    expect(career.getDashboard().continueLabel).toMatch(/^Continue to /)
  })

  const cases: Array<[keyof Gates, unknown, string]> = [
    ['deadlineHold', true, 'Continue — trade deadline'],
    ['staffMeetingScene', { proposals: [] }, 'Continue — staff meeting'],
    ['scoutMeetingScene', { proposals: [] }, 'Continue — scout meeting'],
    ['scoutDigestPending', true, 'Continue — scouting report'],
    ['reviewFacts', { year: 2029 }, 'Continue — end-of-season review'],
  ]

  for (const [gate, value, label] of cases) {
    it(`names the beat when ${gate} is set`, () => {
      const { career, gates } = seasonCareer()
      expect(career.getDashboard().continueLabel).not.toBe(label)
      ;(gates as Record<string, unknown>)[gate] = value
      expect(career.getDashboard().continueLabel).toBe(label)
    })
  }

  it('honours the shell routing order when several gates are up at once', () => {
    // App.tsx routes the deadline ahead of the meetings, and the meetings ahead
    // of the digest; the label has to agree or it names a beat the GM won't get.
    const { career, gates } = seasonCareer()
    gates.scoutDigestPending = true
    gates.scoutMeetingScene = { proposals: [] }
    gates.staffMeetingScene = { proposals: [] }
    gates.deadlineHold = true
    expect(career.getDashboard().continueLabel).toBe('Continue — trade deadline')
    gates.deadlineHold = false
    expect(career.getDashboard().continueLabel).toBe('Continue — staff meeting')
    gates.staffMeetingScene = null
    expect(career.getDashboard().continueLabel).toBe('Continue — scout meeting')
    gates.scoutMeetingScene = null
    expect(career.getDashboard().continueLabel).toBe('Continue — scouting report')
  })
})
