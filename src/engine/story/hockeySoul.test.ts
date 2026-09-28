/**
 * Hockey soul — the pure rules behind the code, line nicknames, the Conn
 * Smythe and the EBUG, plus the career wiring of the code and named lines.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'
import { connSmythe, lineNickname, pickHitter, playerSafetyFine, ebugVignette, handshakeLine, type PlayoffLine } from './hockeySoul'

describe('the code', () => {
  it('only a physical, aggressive hitter owes a debt', () => {
    expect(pickHitter([{ id: 'a', name: 'A', hits: 1, aggression: 90 }, { id: 'b', name: 'B', hits: 4, aggression: 40 }])).toBeNull()
    expect(pickHitter([
      { id: 'a', name: 'A', hits: 3, aggression: 70 },
      { id: 'b', name: 'B', hits: 5, aggression: 66 },
    ])?.id).toBe('b')
  })
  it('Player Safety fines only the repeat type', () => {
    expect(playerSafetyFine(80)).toBeNull()
    expect(playerSafetyFine(86)).toBe(2500)
    expect(playerSafetyFine(95)).toBe(5000)
  })
})

describe('line nicknames', () => {
  it('names the kids, the countrymen, the veterans, or the initials', () => {
    expect(lineNickname([
      { id: '1', name: 'A One', age: 20 }, { id: '2', name: 'B Two', age: 21 }, { id: '3', name: 'C Three', age: 22 },
    ])).toBe('the Kid Line')
    expect(lineNickname([
      { id: '1', name: 'A One', age: 27, nationality: 'SWE' }, { id: '2', name: 'B Two', age: 25, nationality: 'SWE' }, { id: '3', name: 'C Three', age: 30, nationality: 'SWE' },
    ])).toBe('the Swedish Line')
    expect(lineNickname([
      { id: '1', name: 'Al Mack', age: 27 }, { id: '2', name: 'Bo Kent', age: 25 }, { id: '3', name: 'Cy Tate', age: 30 },
    ])).toBe('the MKT Line')
  })
})

describe('the Conn Smythe', () => {
  const line = (o: Partial<PlayoffLine>): PlayoffLine => ({ id: 'x', name: 'X', teamId: 'T', position: 'C', gp: 20, goals: 0, assists: 0, saves: 0, shotsAgainst: 0, ...o })
  it('goes to the champion unless someone elsewhere was undeniable', () => {
    const lines = [
      line({ id: 'c1', teamId: 'CHAMP', goals: 8, assists: 14 }),
      line({ id: 'o1', teamId: 'OTHER', goals: 9, assists: 15 }),
    ]
    expect(connSmythe(lines, 'CHAMP')?.winner.id).toBe('c1')
    const giguere = [line({ id: 'c1', teamId: 'CHAMP', goals: 3, assists: 5 }), line({ id: 'o1', teamId: 'OTHER', goals: 16, assists: 20 })]
    expect(connSmythe(giguere, 'CHAMP')?.winner.id).toBe('o1')
  })
  it('a goalie who stole the spring can win it', () => {
    const lines = [
      line({ id: 'g', teamId: 'CHAMP', position: 'G', gp: 24, saves: 700, shotsAgainst: 740 }),
      line({ id: 's', teamId: 'CHAMP', goals: 7, assists: 10 }),
    ]
    expect(connSmythe(lines, 'CHAMP')?.winner.id).toBe('g')
  })
})

describe('traditions', () => {
  it('the handshake line and the EBUG read as prose', () => {
    expect(handshakeLine({ won: false, ourCaptain: 'Cap', theirCaptain: 'Them', oppName: 'Rivals', games: '4–3' })).toContain('handshake line')
    const e = ebugVignette({ club: 'Club', city: 'Town', seed: 42 })
    expect(e.text).toContain(e.name)
  })
})

/* ───────────────────────── career wiring ───────────────────────── */

type Inner = {
  currentDay: number
  year: number
  userTeamId: string
  codeDebts: Array<{ oppId: string; raised: boolean; interactionId?: string; answered?: boolean }>
  codeHeat: { oppId: string } | null
  noteCodeDebt(victim: unknown, res: unknown): void
  raiseCodeScene(day: number): void
  gameHeat(g: { homeTeamId: string; awayTeamId: string }): number
  nextUserGame(day: number): { day: number; oppId: string } | null
  data: { teams: Map<string, { roster: string[]; lines: { forwards: string[][] } }>; players: Map<string, { position: string; ratings: { mental: { aggression: number } }; morale: number }> }
  trackNamedLines(res: unknown): void
  checkNamedLineBreakups(): void
  namedLines: Array<{ name: string; active: boolean }>
}

function toOpeningDay(): { c: Career; inner: Inner } {
  const data = generateLeague({ seed: 5 })
  const c = new Career(data, 5, data.league.teams[0]!)
  for (let i = 0; i < 200 && c.getDashboard().phase === 'regularSeason' && c.getDashboard().day === 0; i++) {
    if (c.getDashboard().captainsPending) c.nameCaptainByCoach()
    c.step()
  }
  return { c, inner: c as unknown as Inner }
}

describe('the code in the career', () => {
  it('a dirty hit opens a debt, the rematch eve raises the scene, answering heats the rematch', () => {
    const { c, inner } = toOpeningDay()
    const next = inner.nextUserGame(inner.currentDay)!
    const oppId = next.oppId as string
    const opp = inner.data.teams.get(oppId)!
    const hitterId = opp.roster.find((id) => inner.data.players.get(id)!.position !== 'G')!
    inner.data.players.get(hitterId)!.ratings.mental.aggression = 88
    const victimId = inner.data.teams.get(inner.userTeamId)!.roster.find((id) => inner.data.players.get(id)!.position !== 'G')!
    const stat = (id: string, hits: number) => [id, { toi: 900, hits, goals: 0, assists: 0, penaltyMinutes: 0, saves: 0, shotsAgainst: 0 }]
    const res = { homeTeamId: inner.userTeamId, awayTeamId: oppId, playerStats: new Map([stat(hitterId, 4)] as never), stream: [] }
    const victim = inner.data.players.get(victimId) as unknown as { injuryStatus: unknown }
    victim.injuryStatus = { kind: 'upperBody', gamesRemaining: 6, description: 'upper body', totalGames: 6 }
    inner.noteCodeDebt(victim, res)
    expect(inner.codeDebts).toHaveLength(1)
    expect(c.getInbox().items.some((n) => /Player Safety fines/.test(n.headline))).toBe(true)
    // The eve of the rematch.
    inner.raiseCodeScene(next.day - 1)
    const scene = c.getInbox().interactions?.find((i) => /treatment room from that hit/.test(i.message))
    expect(scene).toBeDefined()
    expect(inner.gameHeat({ homeTeamId: inner.userTeamId, awayTeamId: oppId })).toBeLessThan(1)
    c.respondToInteraction(scene!.id, 'answer-it')
    expect(inner.gameHeat({ homeTeamId: inner.userTeamId, awayTeamId: oppId })).toBe(1)
  })
})

describe('named lines in the career', () => {
  it('a productive trio earns a name; breaking it up (all healthy) costs a little morale', () => {
    const { c, inner } = toOpeningDay()
    const team = inner.data.teams.get(inner.userTeamId)!
    const trio = team.lines.forwards[0]!
    const stats = new Map(trio.map((id) => [id, { toi: 900, goals: 1, assists: 1, hits: 0, penaltyMinutes: 0, saves: 0, shotsAgainst: 0 }]) as never)
    for (let i = 0; i < 15; i++) inner.trackNamedLines({ playerStats: stats })
    expect(inner.namedLines).toHaveLength(1)
    expect(c.getInbox().items.some((n) => /They're calling it/.test(n.headline))).toBe(true)
    const before = trio.map((id) => inner.data.players.get(id)!.morale)
    // Split it: swap the first line's winger with the second line's.
    const second = team.lines.forwards[1]!
    const t = trio[2]!; trio[2] = second[2]!; second[2] = t
    inner.checkNamedLineBreakups()
    expect(inner.namedLines[0]!.active).toBe(false)
    const after = [trio[0]!, trio[1]!, t].map((id) => inner.data.players.get(id)!.morale)
    expect(after.reduce((a, b) => a + b, 0)).toBeLessThan(before.reduce((a, b) => a + b, 0))
  })
})
