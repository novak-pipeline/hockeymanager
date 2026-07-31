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
  tradeOffers: unknown[]
  news: Array<{ headline: string }>
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

/* ───────────────────── playtest A6 — the standing trade offer ─────────────────
 * A rival GM holding for an answer on one of your players is a decision, and a
 * decision the GM can sim straight past is not a decision at all. These fail
 * without the gate: the label read "Continue to Nov 12" and the day simmed.
 */

/** Table a real inbound offer for one of the user's players, the way the AI
 *  offer generator does — the engine reads `tradeOffers` for the gate. */
function tableOffer(
  career: Career,
  gates: Gates,
  data: ReturnType<typeof generateLeague>,
  partnerIndex: number,
  offerId: string
): string {
  const userTeamId = career.getDashboard().userTeam.teamId
  const mine = data.teams.get(userTeamId as never)!.roster
  const partnerTeamId = data.league.teams.filter((t) => (t as string) !== userTeamId)[partnerIndex]!
  gates.tradeOffers.push({
    offerId,
    partnerTeamId,
    userReceivesPlayerIds: [],
    userReceivesPicks: [],
    userGivesPlayerIds: [mine[partnerIndex]!],
    userGivesPicks: [],
    message: 'We like your guy. Make a call.',
    expiresOnDay: 999,
  })
  return data.teams.get(partnerTeamId)!.abbreviation
}

describe('a standing trade offer is a beat gate (playtest A6, bar B2.2)', () => {
  it('names the club on the Continue button', () => {
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    const gates = career as unknown as Gates
    gates.trainingCamp = null
    career.advanceDay()

    expect(career.getDashboard().tradeOffersPending).toBe(0)
    const abbr = tableOffer(career, gates, data, 0, 'a6-1')
    expect(career.getDashboard().tradeOffersPending).toBe(1)
    expect(career.getDashboard().continueLabel).toBe(`Continue — trade offer from ${abbr}`)
  })

  it('counts them when several clubs are holding', () => {
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    const gates = career as unknown as Gates
    gates.trainingCamp = null
    career.advanceDay()

    tableOffer(career, gates, data, 0, 'a6-1')
    tableOffer(career, gates, data, 1, 'a6-2')
    expect(career.getDashboard().continueLabel).toBe('Continue — 2 trade offers')
  })

  it('sits under the deadline and over the meetings in the routing order', () => {
    // Same law as the other gates: the label must name the beat the shell will
    // actually land on. App.tsx routes deadline → trade desk → staff meeting.
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    const gates = career as unknown as Gates
    gates.trainingCamp = null
    career.advanceDay()

    const abbr = tableOffer(career, gates, data, 0, 'a6-1')
    gates.staffMeetingScene = { proposals: [] }
    gates.deadlineHold = true
    expect(career.getDashboard().continueLabel).toBe('Continue — trade deadline')
    gates.deadlineHold = false
    expect(career.getDashboard().continueLabel).toBe(`Continue — trade offer from ${abbr}`)
    career.declineAllTradeOffers()
    expect(career.getDashboard().continueLabel).toBe('Continue — staff meeting')
  })

  it('has a one-click escape: the AGM passes on the lot', () => {
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    const gates = career as unknown as Gates
    gates.trainingCamp = null
    career.advanceDay()

    tableOffer(career, gates, data, 0, 'a6-1')
    tableOffer(career, gates, data, 1, 'a6-2')
    const res = career.declineAllTradeOffers()
    expect(res.declined).toBe(2)
    expect(career.getDashboard().tradeOffersPending).toBe(0)
    expect(career.getDashboard().continueLabel).toMatch(/^Continue to /)
    // The GM is told what was turned down in his name — a delegated decision is
    // still a decision, and it has to leave a trace.
    expect(gates.news.some((n) => /passes on 2 offers/.test(n.headline))).toBe(true)
  })

  it('cannot softlock: a day simmed past the gate delegates to the AGM', () => {
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    const gates = career as unknown as Gates
    gates.trainingCamp = null
    career.advanceDay()

    tableOffer(career, gates, data, 0, 'a6-1')
    expect(career.getDashboard().tradeOffersPending).toBe(1)
    career.advanceDay()
    // Whatever fresh offers the day generated, the one we tabled is answered.
    expect(gates.tradeOffers.some((o) => (o as { offerId: string }).offerId === 'a6-1')).toBe(false)
  })
})

/* ───────────────────── playtest A7 — the trade deadline ───────────────────────
 * The engine armed a one-press hold, but a BATCH sim spent it silently: "+7
 * days" or "to next game" armed the hold on one iteration and consumed it on
 * the next, so the season's biggest decision point slid by unattended.
 */
describe('the trade deadline is a hard gate (playtest A7)', () => {
  function freshCareer(seed: number): Career {
    const data = generateLeague({ seed })
    const career = new Career(data, seed, data.league.teams[3]!)
    ;(career as unknown as Gates).trainingCamp = null
    return career
  }

  it('a multi-day sim stops AT the deadline instead of steamrolling it', () => {
    const career = freshCareer(2029)
    career.advance(400) // enough to run the whole regular season and then some
    expect(career.getDashboard().deadlinePending).toBe(true)
    expect(career.getDashboard().continueLabel).toBe('Continue — trade deadline')
    expect(career.getDashboard().phase).toBe('regularSeason')
  })

  it('the batch resumes normally once the GM has had his day', () => {
    const career = freshCareer(2029)
    career.advance(400)
    expect(career.getDashboard().deadlinePending).toBe(true)
    const dayAtHold = career.getDashboard().day
    career.advance(5) // the hold is spent by the first step, then it runs on
    expect(career.getDashboard().deadlinePending).toBe(false)
    expect(career.getDashboard().day).toBeGreaterThan(dayAtHold)
    expect(career.getTentpoles().deadlinePassed).toBe(true)
  })

  it('"to next game" does not carry the GM through the deadline either', () => {
    // Count the advances it takes for the hold to arm, then stop one short and
    // reach for the "to next game" button — the path that used to sail past.
    const probe = freshCareer(2029)
    let steps = 0
    for (; steps < 400; steps++) {
      probe.advance(1)
      if (probe.getDashboard().deadlinePending) break
    }
    expect(probe.getDashboard().deadlinePending).toBe(true)

    const career = freshCareer(2029)
    career.advance(steps) // one short of the arming step
    expect(career.getDashboard().deadlinePending).toBe(false)
    career.advanceToNextGame()
    expect(career.getDashboard().deadlinePending).toBe(true)
  })
})

describe('the captaincy gate has a one-click escape (B2.2)', () => {
  it('the coach names an eligible skater and the gate clears', () => {
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    const team = data.teams.get(data.league.teams[3]!)!
    delete team.captainId

    // `captainsPending()` is scoped to the preseason stage, so assert on the
    // completeness predicate it wraps — that is the condition the gate holds on.
    const gate = career as unknown as { captainsSetupComplete(): boolean }
    expect(gate.captainsSetupComplete()).toBe(false)
    const res = career.nameCaptainByCoach()
    expect(res.ok).toBe(true)
    expect(res.name).toBeTruthy()
    // He must be a real, eligible skater on the roster — not a goalie, not a ghost.
    const picked = data.players.get(team.captainId!)!
    expect(picked.position).not.toBe('G')
    expect(team.roster).toContain(team.captainId)
    // And the blocking beat is actually gone, which is the whole point.
    expect(gate.captainsSetupComplete()).toBe(true)
  })

  it('picks the leader the room follows, not just anyone', () => {
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    const team = data.teams.get(data.league.teams[3]!)!
    delete team.captainId
    career.nameCaptainByCoach()
    const chosen = data.players.get(team.captainId!)!
    const skaters = team.roster.map((id) => data.players.get(id)!).filter((p) => p.position !== 'G')
    const best = Math.max(...skaters.map((p) => p.leadership ?? 0))
    // Not a strict argmax assertion — eligibility filters some out — but the
    // coach must not hand the C to a bottom-of-the-room player.
    expect(chosen.leadership ?? 0).toBeGreaterThanOrEqual(best * 0.6)
  })
})
