/**
 * The living phone's inputs, end to end.
 *
 * The phone can only be honest if the engine hands it the right material: an
 * authored office scene must be MARKED as a scene (so the renderer lifts the
 * dialogue out instead of voicing the stage directions), a rival GM's offer must
 * arrive with his name and a first-person pitch, and both must survive a save.
 * These assert the engine half of that contract; lib/phoneCalls.test.ts asserts
 * what the phone does with it.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { DECISION_EVENTS } from '@engine/story/decisionEvents'
import { generateOwnerRequest } from '@engine/league/ownerMeddling'
import { Rng } from '@engine/shared/rng'

function makeCareer(seed = 77): { career: Career; c: any } {
  const data = generateLeague({ seed })
  const userId = data.league.teams[0]!
  const career = new Career(data, seed, userId)
  return { career, c: career as any }
}

/** Force one authored dilemma onto the desk, the way the day pump does. */
function stageDecisionEvent(c: any, eventId: string): string {
  const ev = DECISION_EVENTS.find((e) => e.id === eventId)!
  const pid = c.userTeam.roster[0] as string
  const id = `i${c.interactionCounter++}`
  c.interactions.unshift({
    id,
    playerId: pid,
    teamId: c.userTeamId as string,
    year: c.year,
    day: 20,
    kind: 'unhappy',
    severity: 'serious',
    message: ev.scene,
    scene: true,
    ...(ev.speaker ? { speaker: ev.speaker } : {}),
    options: ev.options.map((o: { id: string; label: string }) => ({ id: o.id, label: o.label, tone: 'firm' })),
    status: 'open',
  })
  return id
}

describe('living phone — engine inputs', () => {
  it('the real dilemma path marks its concern as an office SCENE, not the player’s own words', () => {
    const { c } = makeCareer(311)
    // Drive the actual generator rather than hand-rolling the shape: walk days
    // with a thoroughly unsettled room until a dilemma lands.
    c.phase = 'regularSeason'
    for (const pid of c.userTeam.roster) {
      const p = c.data.players.get(pid)
      if (p) { p.morale = 15; p.form = -3 }
    }
    let raised: any = null
    for (let day = 10; day <= 200 && !raised; day += 1) {
      c.lastDecisionDay = -99
      c.interactions.length = 0
      c.maybeRaiseDecisionEvent(day)
      raised = c.interactions.find((i: any) => i.status === 'open' && i.scene)
    }
    expect(raised, 'no authored dilemma fired in 190 days').not.toBeNull()
    expect(raised.scene).toBe(true)
    expect(raised.severity).toBe('serious')
  })

  it('the scene flag and its speaker reach the inbox view', () => {
    const { career, c } = makeCareer(312)
    stageDecisionEvent(c, 'ev.media.trade-block-question')
    const view = career.getInbox().interactions!.find((i) => i.scene)
    expect(view).toBeDefined()
    expect(view!.scene).toBe(true)
    expect(view!.speaker).toBe('press')
  })

  it('a plain concern is NOT flagged as a scene — it is spoken whole', () => {
    const { career, c } = makeCareer(313)
    const pid = c.userTeam.roster[0] as string
    c.interactions.unshift({
      id: 'plain', playerId: pid, teamId: c.userTeamId as string, year: c.year, day: 5,
      kind: 'tradeRequest', severity: 'serious',
      message: `I need to be straight with you — I want out.`,
      options: [], status: 'open',
    })
    const view = career.getInbox().interactions!.find((i) => i.id === 'plain')!
    expect(view.scene).toBeUndefined()
    expect(view.speaker).toBeUndefined()
  })

  it('scene + speaker survive save/load, so a reloaded call still rings as the right man', () => {
    const { career, c } = makeCareer(314)
    const id = stageDecisionEvent(c, 'ev.owner.streak-ultimatum')
    const restored = Career.fromSnapshot(structuredClone(career.exportSnapshot('t', 'now')))
    const view = restored.getInbox().interactions!.find((i) => i.id === id)!
    expect(view.scene).toBe(true)
    expect(view.speaker).toBe('owner')
  })

  it('the owner’s directive carries a spoken line the card prose never could', () => {
    const { career, c } = makeCareer(315)
    c.ownerRequest = generateOwnerRequest({
      mandate: 'cutCosts', year: c.year, day: 30, rng: new Rng(4), chance: 1,
    })
    const view = career.getOwnerRequest()!
    expect(view.spoken).toBeDefined()
    expect(view.spoken).not.toBe(view.body)
    expect(view.spoken).not.toMatch(/\bThe owner\b/)
  })

  it('an incoming offer names the rival GM and pitches it in his own voice', () => {
    const { career, c } = makeCareer(316)
    const partnerId = c.data.league.teams[1]
    const mine = c.userTeam.roster[0]
    const theirs = c.data.teams.get(partnerId).roster[0]
    c.tradeOffers.push({
      offerId: 'o1',
      partnerTeamId: partnerId,
      userReceivesPlayerIds: [theirs],
      userReceivesPicks: [],
      userGivesPlayerIds: [mine],
      userGivesPicks: [],
      message: 'They are after him. On the table: stuff.',
      expiresOnDay: c.currentDay + 3,
    })
    const offer = career.getTrades().incoming.find((o) => o.offerId === 'o1')!
    expect(offer.gmName).toBeTruthy()
    const wanted = c.data.players.get(mine).name
    expect(offer.spoken).toContain(`We want ${wanted}`)
    // The card prose lists assets; the spoken pitch is a man talking.
    expect(offer.spoken).not.toContain('On the table')
    expect(offer.spoken).toMatch(/\bwe\b/i)
  })
})
