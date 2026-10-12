/**
 * Morale memory in the career (story audit 2026-10 F1): the GM's big
 * decisions about a man are remembered, dated and visible on his profile —
 * and normal play (the coach's own lineup) writes nothing.
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

function openConcern(c: any, pid: string, day: number, kind = 'iceTime'): string {
  const id = `pi-test-${c.interactionCounter++}`
  c.interactions.unshift({
    id, playerId: pid, teamId: c.userTeamId as string, year: c.year, day,
    kind, severity: 'mild',
    message: `I want more ice time.`,
    options: [
      { id: 'promise', label: 'Promise a bigger role', tone: 'promise' },
      { id: 'supportive', label: 'Encourage him', tone: 'supportive' },
      { id: 'firm', label: 'Earn it', tone: 'firm' },
      { id: 'dismissive', label: 'Dismiss', tone: 'dismissive' },
    ],
    status: 'open',
  })
  return id
}

describe('morale memory in the career', () => {
  it('an ignored concern is remembered and shows on his profile in words', () => {
    const { career, c } = makeCareer(701)
    const pid = c.userTeam.roster[0] as string
    openConcern(c, pid, 5)
    c.expireStaleInteractions(5 + Career.CONCERN_EXPIRY_DAYS)
    const p = c.data.players.get(pid)
    expect(p.moraleMemory?.[0]?.kind).toBe('ignored')
    const view = career.getPlayer(pid)
    expect(view.moodFactors?.[0]?.note).toMatch(/^Asked to talk on \w{3} \d{1,2}\. Nobody called back$/)
    expect(view.mindset?.lines[0]).toMatch(/Nobody called back\. He noticed\./)
  })

  it('a trade request met with "you are going nowhere" is remembered for months', () => {
    const { career, c } = makeCareer(702)
    const pid = c.userTeam.roster[1] as string
    const id = openConcern(c, pid, 5, 'tradeRequest')
    expect(career.respondToInteraction(id, 'firm').ok).toBe(true)
    const p = c.data.players.get(pid)
    expect(p.moraleMemory?.[0]?.kind).toBe('tradeRequestIgnored')
  })

  it('a supportive hearing softens an earlier "nobody called back"', () => {
    const { career, c } = makeCareer(703)
    const pid = c.userTeam.roster[2] as string
    openConcern(c, pid, 5)
    c.expireStaleInteractions(5 + Career.CONCERN_EXPIRY_DAYS)
    const p = c.data.players.get(pid)
    const before = p.moraleMemory[0].weight
    const id = openConcern(c, pid, 40)
    career.respondToInteraction(id, 'supportive')
    expect(Math.abs(p.moraleMemory?.[0]?.weight ?? 0)).toBeLessThan(Math.abs(before) * 0.6)
  })

  it("normal play is never penalised: a season of the coach's own lineups writes no benching memory", () => {
    const { career, c } = makeCareer(704)
    while (career.advanceDay()) { /* the whole regular season, coach's lineups */ }
    expect(career.view().userTeam.standing.gamesPlayed).toBeGreaterThan(50)
    const withMemory = [...c.userTeam.roster]
      .map((id: unknown) => c.data.players.get(id))
      .filter((p: any) => p?.moraleMemory?.some((m: any) => m.kind === 'scratched' || m.kind === 'buried'))
    expect(withMemory.map((p: any) => `${p.name}: ${p.moraleMemory.map((m: any) => m.note).join('; ')}`)).toEqual([])
  })

  it('the GM scratching his best forward is remembered, dated, and fades once he plays again', () => {
    const { career, c } = makeCareer(705)
    // The first forward on the coach's opening-night top line.
    const starId = c.userTeam.lines.forwards[0][0] as string
    const star = c.data.players.get(starId)
    career.toggleScratchPlayer(starId)
    career.advance(6)
    const mem = star.moraleMemory?.find((m: any) => m.kind === 'scratched')
    expect(mem, 'a GM scratch of a top-six talent is remembered').toBeTruthy()
    expect(mem.note).toMatch(/^Healthy-scratched (on|\w+ times since|twice since) \w{3} \d{1,2}$/)
    const sore = Math.abs(mem.weight)
    // Back in the lineup: the scratch fades fast once he is dressing again.
    career.toggleScratchPlayer(starId)
    career.advance(10)
    const after = star.moraleMemory?.find((m: any) => m.kind === 'scratched')
    expect(Math.abs(after?.weight ?? 0)).toBeLessThan(sore * 0.5)
  })
})
