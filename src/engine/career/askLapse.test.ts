/**
 * Asks that used to sit on the desk for ever (story audit 2026-10 F4, F5):
 *  - an unanswered owner request now lapses after ten days, telegraphed on the
 *    card, with a small dated confidence nick, and frees the desk;
 *  - a scene summoned in the summer and never answered closes at the rollover
 *    instead of filling the open-conversation cap all next season.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeCareer(seed: number): { career: Career; c: any } {
  const data = generateLeague({ seed })
  const career = new Career(data, seed, data.league.teams[0]!)
  return { career, c: career as any }
}

function raiseOwnerAsk(c: any): number {
  for (let day = 1; day < 400; day++) {
    c.maybeGenerateOwnerRequest(day)
    if (c.ownerRequest) return day
  }
  throw new Error('the owner never asked')
}

describe('an ignored owner ask lapses', () => {
  it('says when he wants an answer, waits ten days, then stops asking at a small cost', () => {
    const { career, c } = makeCareer(801)
    const day = raiseOwnerAsk(c)
    const card = career.getInbox().items.find((n) => n.headline === c.ownerRequest.title)
    expect(card?.body).toMatch(/He wants an answer by [A-Z][a-z]{2} \d{1,2}\./)
    expect(career.getOwnerRequest()?.answerBy).toBeTruthy()
    const conf0 = c.boardState.confidence

    c.lapseIgnoredOwnerRequest(day + Career.OWNER_ASK_EXPIRY_DAYS - 1)
    expect(c.ownerRequest, 'still waiting on day 9').not.toBeNull()

    c.lapseIgnoredOwnerRequest(day + Career.OWNER_ASK_EXPIRY_DAYS)
    expect(c.ownerRequest).toBeNull()
    expect(career.getOwnerRequest()).toBeNull()
    const lost = conf0 - c.boardState.confidence
    expect(lost).toBeGreaterThanOrEqual(1)
    expect(lost).toBeLessThanOrEqual(3) // small: never worse than a few points
    const note = c.news.find((n: any) => n.headline === 'The owner stopped asking')
    expect(note?.body).toMatch(/He asked you on [A-Z][a-z]{2} \d{1,2}:/)
    // The desk is clear: the next ask can come.
    expect(raiseOwnerAsk(c)).toBeGreaterThan(0)
  })

  it('an accepted ask is a commitment and is NOT lapsed', () => {
    const { career, c } = makeCareer(802)
    const day = raiseOwnerAsk(c)
    career.respondToOwnerRequest(true)
    c.lapseIgnoredOwnerRequest(day + 40)
    expect(c.ownerRequest?.commitment).toBeTruthy()
  })

  it('an ask left over from last season lapses on the first day of the new one', () => {
    const { c } = makeCareer(803)
    raiseOwnerAsk(c)
    c.ownerRequest.year = c.year - 1
    c.lapseIgnoredOwnerRequest(1)
    expect(c.ownerRequest).toBeNull()
  })
})

describe('summer scenes do not silence the next season', () => {
  it('two unanswered summer scenes close, and a concern can be raised again', () => {
    const { career, c } = makeCareer(804)
    const [a, b] = c.userTeam.roster.slice(0, 2).map((id: unknown) => id as string)
    for (const [pid, day] of [[a, 201], [b, 225]] as const) {
      c.interactions.unshift({
        id: `i-summer-${pid}`, playerId: pid, teamId: c.userTeamId as string,
        year: c.year - 1, day, kind: 'unhappy', severity: 'serious', scene: true,
        message: 'A summer scene.', options: [{ id: 'x', label: 'X', tone: 'firm' }], status: 'open',
      })
    }
    expect(c.interactions.filter((i: any) => i.status === 'open')).toHaveLength(2)
    const morale0 = c.data.players.get(a).morale
    c.expireStaleInteractions(1)
    expect(c.interactions.filter((i: any) => i.status === 'open')).toHaveLength(0)
    // A scene was a moment: closing it costs nothing.
    expect(c.data.players.get(a).morale).toBe(morale0)
    expect(c.interactions.find((i: any) => i.id === `i-summer-${a}`).outcome).toMatch(/moment passed/)
    // The desk is free: a fresh season's concern is no longer blocked by the cap.
    const p = c.data.players.get(a)
    p.morale = 20
    p.personality.ambition = 16
    let raised = false
    for (let day = 20; day < 200 && !raised; day += 15) {
      c.maybeRaiseInteractions(day)
      raised = c.interactions.some((i: any) => i.status === 'open')
    }
    expect(raised).toBe(true)
    expect(career.getInbox().interactions?.length ?? 0).toBeGreaterThan(0)
  })

  it('an unanswered summer CONCERN still counts as ignored, with the usual small cost', () => {
    const { c } = makeCareer(805)
    const pid = c.userTeam.roster[3] as string
    c.interactions.unshift({
      id: 'i-summer-concern', playerId: pid, teamId: c.userTeamId as string,
      year: c.year - 1, day: 210, kind: 'future', severity: 'mild',
      message: 'Where do I stand?', options: [{ id: 'x', label: 'X', tone: 'firm' }], status: 'open',
    })
    c.closeLastSeasonsConversations()
    expect(c.interactions[0].status).toBe('resolved')
    expect(c.data.players.get(pid).moraleMemory?.[0]?.kind).toBe('ignored')
  })
})
