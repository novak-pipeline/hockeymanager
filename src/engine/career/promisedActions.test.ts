/**
 * E3 audit — "an event promises an action the game won't honour".
 *
 * Every scene option that says a thing HAPPENS now makes it happen through the
 * same API the screens use, or its receipt says plainly why it could not. Every
 * promise a scene plants is actually judged. The owner's asks are checked. The
 * staff meeting's "sit him a game" sits him for one game. These are the
 * end-to-end halves of the content-integrity guards in decisionEvents.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { asPlayerId } from '@domain'
import { DECISION_EVENTS } from '@engine/story/decisionEvents'
import { generateOwnerRequest } from '@engine/league/ownerMeddling'
import { Rng } from '@engine/shared/rng'
import { Career } from './career'

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeCareer(seed: number): { career: Career; c: any } {
  const data = generateLeague({ seed })
  const career = new Career(data, seed, data.league.teams[0]!)
  return { career, c: career as any }
}

/** Put one authored dilemma on the desk for a chosen player. */
function stage(c: any, eventId: string, playerId: string): string {
  const ev = DECISION_EVENTS.find((e) => e.id === eventId)!
  const id = `i${c.interactionCounter++}`
  c.interactions.unshift({
    id, playerId, teamId: c.userTeamId as string, year: c.year, day: c.currentDay,
    kind: 'unhappy', severity: 'serious', message: ev.scene, scene: true,
    options: ev.options.map((o) => ({ id: o.id, label: o.label, tone: 'firm' })),
    status: 'open',
  })
  c.decisionEventFor.set(id, ev.id)
  return id
}

function authored(eventId: string, optionId: string): string {
  return DECISION_EVENTS.find((e) => e.id === eventId)!.options.find((o) => o.id === optionId)!.outcome
}

function affiliateRoster(c: any): string[] {
  const ahl = c.data.teams.get(c.userTeam.affiliateId)
  return (ahl?.roster ?? []).map((id: unknown) => id as string)
}

describe('decision acts happen, or say why not', () => {
  it('"Bring him up" recalls him — or the receipt names the reason', () => {
    const { career, c } = makeCareer(501)
    const pid = affiliateRoster(c).find((id) => c.data.players.get(id)?.position !== 'G')!
    const iid = stage(c, 'ev.minors.buried-veteran', pid)
    const r = career.respondToInteraction(iid, 'recall')
    expect(r.ok).toBe(true)
    const onNhl = c.userTeam.roster.some((id: unknown) => (id as string) === pid)
    if (onNhl) {
      expect(r.message).toContain(authored('ev.minors.buried-veteran', 'recall'))
    } else {
      expect(r.message).not.toBe(authored('ev.minors.buried-veteran', 'recall'))
      expect(r.message).toMatch(/could not/)
      // A refused recall plants no ice-time promise he could never keep.
      expect(c.playerPromises.some((p: any) => p.playerId === pid)).toBe(false)
    }
  })

  it('"Let him go, with thanks" actually releases him', () => {
    const { career, c } = makeCareer(502)
    const pid = affiliateRoster(c)[0]!
    const iid = stage(c, 'ev.minors.buried-veteran', pid)
    career.respondToInteraction(iid, 'release')
    expect(affiliateRoster(c)).not.toContain(pid)
    expect(c.faPool.map((id: unknown) => id as string)).toContain(pid)
    expect(c.data.players.get(pid).contract.yearsRemaining).toBe(0)
  })

  it('"Sit him. Let the backup run with it." hands the net to the backup', () => {
    const { career, c } = makeCareer(503)
    const starter = c.userTeam.lines.goalies[0] as string
    const iid = stage(c, 'ev.crease.goalie-controversy', starter)
    career.respondToInteraction(iid, 'bench-him')
    expect(c.userTeam.lines.goalies[0] as string).not.toBe(starter)
    expect(c.userTeam.lines.goalies[1] as string).toBe(starter)
  })

  it('"He\'s the starter" makes him the starter', () => {
    const { career, c } = makeCareer(504)
    const backup = c.userTeam.lines.goalies[1] as string
    const iid = stage(c, 'ev.crease.goalie-controversy', backup)
    career.respondToInteraction(iid, 'ride-him')
    expect(c.userTeam.lines.goalies[0] as string).toBe(backup)
  })

  it('"He\'s not going anywhere" takes him off the market', () => {
    const { career, c } = makeCareer(505)
    const pid = c.userTeam.roster[2] as string
    const iid = stage(c, 'ev.media.trade-block-question', pid)
    career.respondToInteraction(iid, 'deny')
    expect(c.data.players.get(pid).tradeStatus).toBe('untouchable')
  })

  it('"Let him play" clears a minor knock — he dresses, hurt', () => {
    const { career, c } = makeCareer(506)
    const pid = c.userTeam.roster.find((id: unknown) => c.data.players.get(id).position !== 'G') as string
    const p = c.data.players.get(pid)
    p.injuryStatus = { kind: 'lowerBody', gamesRemaining: 3, description: 'bruised foot', totalGames: 3 }
    const fatigue = p.fatigue
    const iid = stage(c, 'ev.medical.play-through-it', pid)
    career.respondToInteraction(iid, 'play')
    expect(p.injuryStatus).toBeNull()
    expect(p.fatigue).toBeGreaterThan(fatigue)
  })

  it('"Take the picks" moves him — or says nobody bit', () => {
    const { career, c } = makeCareer(507)
    c.currentDay = 20 // in-season, before the deadline
    const pid = c.userTeam.roster.find((id: unknown) => c.data.players.get(id).position !== 'G') as string
    const iid = stage(c, 'ev.deadline.rental-vs-room', pid)
    const r = career.respondToInteraction(iid, 'sell')
    const still = c.userTeam.roster.some((id: unknown) => (id as string) === pid)
    if (still) expect(r.message).not.toContain('You banked the futures')
    else expect(r.message).toMatch(/traded to/)
  })

  it('a refused act is never silent: the receipt is replaced and the inbox says so', () => {
    const { career, c } = makeCareer(508)
    const pid = c.userTeam.roster.find((id: unknown) => c.data.players.get(id).position !== 'G') as string
    c.data.players.get(pid).injuryStatus = { kind: 'upperBody', gamesRemaining: 30, description: 'broken wrist', totalGames: 30 }
    const iid = stage(c, 'ev.injury.play-through-it', pid)
    const r = career.respondToInteraction(iid, 'let-him')
    expect(r.message).not.toBe(authored('ev.injury.play-through-it', 'let-him'))
    expect(c.data.players.get(pid).injuryStatus).not.toBeNull()
    expect(career.getInbox().items.some((n) => n.headline.startsWith("It didn't happen"))).toBe(true)
  })
})

describe('promises made in a scene are judged', () => {
  it('an in-season ice-time promise gets a due day and baselines', () => {
    const { career, c } = makeCareer(511)
    c.currentDay = 30
    const pid = c.userTeam.roster.find((id: unknown) => c.data.players.get(id).position !== 'G') as string
    const iid = stage(c, 'ev.media.criticized-in-press', pid)
    career.respondToInteraction(iid, 'defend')
    const pr = c.playerPromises.find((p: any) => p.playerId === pid)
    expect(pr.dueDay).toBe(65)
    expect(pr.baselineToi).toBeDefined()
  })

  it('a promise made in the summer is about next season, and the rollover does not wave it through', () => {
    const { c } = makeCareer(512)
    c.phase = 'offseason'
    const p = c.data.players.get(c.userTeam.roster[0])
    const terms = c.promiseTerms('iceTime', p)
    expect(terms.year).toBe(c.year + 1)
    expect(terms.dueDay).toBe(35)
  })
})

describe("the owner's asks are checked", () => {
  it('saying yes is a commitment; failing it costs more than the yes earned', () => {
    const { career, c } = makeCareer(521)
    c.currentDay = 20
    let req = null
    for (let s = 0; s < 200 && !req; s++) {
      const r = generateOwnerRequest({ mandate: 'makePlayoffs', year: c.year, day: 20, rng: new Rng(s), chance: 1 })
      if (r && r.kind === 'trimPayroll') req = r
    }
    if (!req) req = generateOwnerRequest({ mandate: 'cutCosts', year: c.year, day: 20, rng: new Rng(3), chance: 1 })!
    c.ownerRequest = { ...req, kind: 'trimPayroll' }
    const conf0 = c.boardState.confidence
    career.respondToOwnerRequest(true)
    expect(career.getOwnerRequest()).toBeNull()
    expect(career.getDashboard().ownerRequestPending).toBeFalsy()
    expect(c.ownerRequest.commitment.dueDay).toBeGreaterThan(20)
    const afterYes = c.boardState.confidence
    expect(afterYes).toBeGreaterThanOrEqual(conf0)
    // Nothing was trimmed. The date comes.
    c.judgeOwnerCommitmentIfDue(c.ownerRequest.commitment.dueDay)
    expect(c.ownerRequest).toBeNull()
    expect(c.boardState.confidence).toBeLessThan(conf0)
    expect(career.getInbox().items.some((n) => n.headline === 'The owner remembers what you told him')).toBe(true)
  })

  it('the owner never asks to keep a fan favourite who does not exist', () => {
    const { c } = makeCareer(522)
    for (const id of c.userTeam.roster) c.data.players.get(id).contract.yearsRemaining = 4
    expect(c.fanFavouriteVeteran()).toBeUndefined()
    for (let d = 1; d < 400; d++) {
      c.ownerRequest = null
      c.maybeGenerateOwnerRequest(d)
      if (c.ownerRequest) expect(c.ownerRequest.kind).not.toBe('extendFanFavourite')
    }
  })
})

describe('the staff meeting does what it proposed', () => {
  it('"Sit him a game" sits him for ONE game, and never un-scratches a man already sitting', () => {
    const { c } = makeCareer(531)
    const pid = c.userTeam.roster.find((id: unknown) => c.data.players.get(id).position !== 'G') as string
    expect(c.applyStaffAction({ type: 'scratch', playerId: pid })).toMatch(/sits the next game/)
    expect(c.isScratchedFor(pid)).toBe(true)
    expect(c.applyStaffAction({ type: 'scratch', playerId: pid })).toMatch(/already/)
    expect(c.isScratchedFor(pid)).toBe(true) // the old toggle put him back in
    // A game is played; the scratch is served and lifted.
    let guard = 0
    const gp0 = c.userGamesPlayed()
    while (c.userGamesPlayed() === gp0 && guard++ < 20) c.step()
    c.enforceUserScratches()
    expect(c.isScratchedFor(pid)).toBe(false)
  })

  it('a refused recall says why instead of saying nothing', () => {
    const { c } = makeCareer(532)
    const notOnFarm = c.userTeam.roster[0] as string
    expect(c.applyStaffAction({ type: 'callUp', playerId: notOnFarm })).toMatch(/could not be recalled/)
  })
})

describe('"address the room" is done, not promised', () => {
  it('choosing it settles the feud he came about', () => {
    const { career, c } = makeCareer(541)
    const [a, b] = c.userTeam.roster.slice(0, 2).map((id: unknown) => id as string)
    const arcs = c.arcsState.arcs
    arcs.push({ id: 'arc-test', kind: 'feud', actors: { playerIds: [a, b], teamIds: [c.userTeamId] }, tension: 60, startedDay: 1, startedYear: c.year, beats: [], status: 'building' })
    c.interactions.unshift({
      id: 'feud-1', playerId: a, teamId: c.userTeamId, year: c.year, day: 1, kind: 'feud', severity: 'minor',
      message: 'x', options: [{ id: 'supportive', label: 'Step in and address the room', tone: 'supportive' }], status: 'open',
    })
    career.respondToInteraction('feud-1', 'supportive')
    expect(arcs.find((x: any) => x.id === 'arc-test').status).toBe('resolved')
    expect(asPlayerId(a)).toBeTruthy()
  })
})
