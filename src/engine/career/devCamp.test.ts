import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateLeague } from '@data/generate'
import { validateModDatabase, loadModDatabase } from '@data'
import { Career } from './career'
import { choicesFor, citeWeek, drillScore, gradeOf, readinessOf, runDrills, showingOf } from './devCamp'
import type { CampGameLine } from './views'
import type { Player } from '@domain'

const R = (v: number) => ({ skating: v, scoring: v, playmaking: v, puckControl: v, hitting: v, takeaway: v, defensiveZone: v, goaltending: v })

describe('dev camp — the pure half', () => {
  it('testing ranks on real ability, per drill and group', () => {
    const res = runDrills([
      { playerId: 'fast', group: 'F', ratings: { ...R(50), skating: 80 } },
      { playerId: 'mid', group: 'F', ratings: R(55) },
      { playerId: 'g1', group: 'G', ratings: R(70) },
    ])
    expect(res.get('fast')!.find((d) => d.drill === 'Skating test')).toEqual({ drill: 'Skating test', rank: 1, of: 2 })
    expect(res.get('mid')!.find((d) => d.drill === 'Shot')!.rank).toBe(1)
    expect(res.get('g1')!.every((d) => d.of === 1)).toBe(true) // goalies test among goalies
    expect(drillScore([{ drill: 'x', rank: 1, of: 10 }])).toBe(2)
    expect(drillScore([{ drill: 'x', rank: 10, of: 10 }])).toBe(-2)
  })

  it('the showing blends testing with what the scrimmages showed, and the evidence says so', () => {
    const top = [{ drill: 'Skating test', rank: 1, of: 24 }]
    const line = (o: Partial<CampGameLine>): CampGameLine => ({ game: 'in the first scrimmage', kind: 'scrimmage', g: 0, a: 0, pm: 0, sog: 0, toiSec: 900, ...o })
    const big = showingOf(top, [line({ g: 2, a: 1, pm: 2, sog: 5 })], 'F')
    const quiet = showingOf(top, [line({ pm: -2 })], 'F')
    expect(big).toBeGreaterThan(quiet)
    expect(gradeOf(big)).toBe('A')
    expect(citeWeek(top, [line({ g: 2, sog: 5 })], 'F')).toBe('1st of 24 in the skating test; he scored twice in the first scrimmage')
  })

  it('readiness and the calls: the CHL rule, the staff recommendation, tryouts, signed men', () => {
    expect(readinessOf({ ovr: 70, age: 19, nhlBar: 70, ahlBar: 60 })).toBe('nhl')
    expect(readinessOf({ ovr: 59, age: 19, nhlBar: 70, ahlBar: 60 })).toBe('ahl')
    expect(readinessOf({ ovr: 50, age: 18, nhlBar: 70, ahlBar: 60 })).toBe('junior')
    // A CHL 18-year-old ready for pro hockey cannot go to the AHL: sign and return.
    const chl = choicesFor({ status: 'amateur', readiness: 'ahl', grade: 'B', age: 18, chlJunior: true })
    expect(chl.options).not.toContain('signAhl')
    expect(chl.recommended).toBe('signReturn')
    expect(chl.blocked).toMatch(/CHL player under 20/)
    // A European 20-year-old ready for the AHL: bring him over.
    expect(choicesFor({ status: 'amateur', readiness: 'ahl', grade: 'B', age: 20, chlJunior: false }).recommended).toBe('signAhl')
    // A raw kid goes back unsigned.
    expect(choicesFor({ status: 'amateur', readiness: 'junior', grade: 'B', age: 18, chlJunior: false }).recommended).toBe('returnUnsigned')
    expect(choicesFor({ status: 'tryout', readiness: 'ahl', grade: 'A', age: 21, chlJunior: false })).toMatchObject({ options: ['signElc', 'release'], recommended: 'signElc' })
    expect(choicesFor({ status: 'signed', readiness: 'ahl', grade: 'A', age: 21, chlJunior: false }).options).toHaveLength(0)
  })
})

function summerCamp(seed = 515): Career {
  const data = generateLeague({ seed })
  const c = new Career(data, seed, data.league.teams[0])
  c.startAtOffseason()
  return c
}

describe('dev camp — the career camp', () => {
  it('three beats: testing on arrival, real scrimmages on day 2, reads and calls on day 3', () => {
    const c = summerCamp()
    const d1 = c.getDevCamp()!
    expect(d1.day).toBe(1)
    expect(d1.invitees.length).toBeGreaterThan(4)
    expect(d1.invitees.every((p) => (p.drills ?? []).length >= 2)).toBe(true)
    expect(d1.invitees.every((p) => p.scrim === undefined)).toBe(true)
    c.advanceOffseason()
    const d2 = c.getDevCamp()!
    expect(d2.day).toBe(2)
    expect((d2.results ?? []).length).toBeGreaterThan(0)
    // Real box scores: the goals scored add up to the scorelines.
    const goals = d2.invitees.reduce((s, p) => s + (p.position === 'G' ? 0 : p.scrim?.g ?? 0), 0)
    const scored = (d2.results ?? []).reduce((s, r) => s + [...r.matchAll(/(\d+)/g)].reduce((t, m) => t + Number(m[1]), 0), 0)
    expect(goals).toBeLessThanOrEqual(scored) // lent farm goalies/skaters are not listed
    expect(d2.invitees.filter((p) => p.position !== 'G').every((p) => (p.scrim?.gp ?? 0) >= 1)).toBe(true)
    c.advanceOffseason()
    const d3 = c.getDevCamp()!
    expect(d3.day).toBe(3)
    for (const p of d3.invitees) {
      expect(p.staffRead!.length).toBeGreaterThan(20)
      expect(['nhl', 'ahl', 'junior']).toContain(p.readiness)
    }
    expect(d3.invitees.filter((p) => p.focus).length).toBeLessThanOrEqual(3)
  }, 60_000)

  it('the calls and programmes land when Continue closes camp; delegating takes the staff\'s', () => {
    const c = summerCamp(616)
    c.advanceOffseason(); c.advanceOffseason()
    const d3 = c.getDevCamp()!
    // The GM picks his own three programmes.
    // The GM clears the staff's programmes and sets his own three.
    for (const p of d3.invitees.filter((x) => x.focus)) expect(c.setDevCampFocus(p.playerId, null).ok).toBe(true)
    const picks = d3.invitees.filter((p) => p.position !== 'G').slice(0, 4)
    for (const p of picks.slice(0, 3)) expect(c.setDevCampFocus(p.playerId, 'skating').ok).toBe(true)
    expect(c.getDevCamp()!.invitees.filter((p) => p.focus).map((p) => p.playerId).sort()).toEqual(picks.slice(0, 3).map((p) => p.playerId).sort())
    expect(c.setDevCampFocus(picks[3]!.playerId, 'offense').ok).toBe(false) // a fourth is refused
    const morale0 = new Map(d3.invitees.map((p) => [p.playerId, (c as unknown as { data: { players: Map<string, Player> } }).data.players.get(p.playerId)!.morale]))
    c.advanceOffseason() // Continue closes camp
    expect(c.getDashboard().devCampPending).toBe(false)
    const practice = (c as unknown as { practiceState: { perPlayerFocus: Array<[string, string]> } }).practiceState.perPlayerFocus
    for (const p of picks.slice(0, 3)) expect(practice).toContainEqual([p.playerId, 'skating'])
    // The week moves morale (an A camp lifts, a C camp stings).
    const players = (c as unknown as { data: { players: Map<string, Player> } }).data.players
    const a = d3.invitees.find((p) => p.grade === 'A')
    if (a) expect(players.get(a.playerId)!.morale).toBeGreaterThan(morale0.get(a.playerId)!)
    const report = c.getInbox().items.find((n) => n.headline.startsWith('Development camp report'))!
    expect(report.body).toMatch(/summer programme/)
  }, 60_000)

  it('a small camp still scrimmages: the farm lends bodies so both sides dress', () => {
    const c = summerCamp(515)
    // Cut the camp down to a handful of skaters.
    const inv = c.getDevCampInvites().invited
    for (const p of inv.slice(6)) c.toggleDevCampInvite(p.playerId)
    expect(c.getDevCampInvites().invited.length).toBe(Math.min(6, inv.length))
    c.advanceOffseason()
    const d2 = c.getDevCamp()!
    expect((d2.results ?? []).length).toBeGreaterThan(0)
    for (const p of d2.invitees) expect(p.scrim?.gp ?? 0).toBeGreaterThanOrEqual(p.position === 'G' ? 0 : 1)
    expect(d2.invitees.length).toBe(Math.min(6, inv.length)) // lent men are not campers
  }, 60_000)

  it("the GM's first programme bumps the staff's weakest pick", () => {
    const c = summerCamp(42)
    c.advanceOffseason(); c.advanceOffseason()
    const d3 = c.getDevCamp()!
    const staff = d3.invitees.filter((p) => p.focus).map((p) => p.playerId)
    const outsider = d3.invitees.find((p) => !p.focus && p.position !== 'G')!
    expect(c.setDevCampFocus(outsider.playerId, 'offense').ok).toBe(true)
    const now = c.getDevCamp()!.invitees.filter((p) => p.focus).map((p) => p.playerId)
    expect(now).toContain(outsider.playerId)
    expect(now.length).toBe(Math.min(3, staff.length + 1))
  }, 60_000)

  it('a tryout the GM signs gets an entry-level deal and reports to the farm', () => {
    const c = summerCamp(515)
    const inv = c.getDevCampInvites()
    const tryout = inv.available.find((p) => !p.org)
    if (!tryout) return // no unsigned young free agent in this world
    expect(c.toggleDevCampInvite(tryout.playerId).ok).toBe(true)
    c.advanceOffseason(); c.advanceOffseason()
    const me = c.getDevCamp()!.invitees.find((p) => p.playerId === tryout.playerId)!
    expect(me.status).toBe('tryout')
    expect(me.options).toEqual(['signElc', 'release'])
    expect(c.setDevCampChoice(tryout.playerId, 'signElc').ok).toBe(true)
    expect(c.setDevCampChoice(tryout.playerId, 'signAhl').ok).toBe(false) // not a call for a tryout
    c.advanceOffseason()
    const ci = c as unknown as { userTeam: { affiliateId: string }; data: { teams: Map<string, { roster: string[] }>; players: Map<string, Player> } }
    expect(ci.data.teams.get(ci.userTeam.affiliateId)!.roster).toContain(tryout.playerId)
    expect(ci.data.players.get(tryout.playerId)!.contract.yearsRemaining).toBe(3)
  }, 60_000)
})

// The amateur calls need a loaded world (junior and European leagues): run on
// the imported DB when it is present (DEVCAMP_MOD_DB, or mods/ in this checkout).
const MOD_DB = process.env.DEVCAMP_MOD_DB ?? join(process.cwd(), 'mods', 'nhl-ehm', 'database.json')
describe.skipIf(!existsSync(MOD_DB))('dev camp — amateurs whose rights you hold (imported world)', () => {
  it('signing and assigning to the AHL is a real move; the CHL rule holds', () => {
    const db = validateModDatabase(JSON.parse(readFileSync(MOD_DB, 'utf8')))
    const data = loadModDatabase(db, { seed: 2029 })
    const c = new Career(data, 2029, data.league.teams[3]!)
    c.startAtOffseason()
    c.advanceOffseason(); c.advanceOffseason()
    const camp = c.getDevCamp()!
    const amateurs = camp.invitees.filter((p) => p.status === 'amateur')
    expect(amateurs.length).toBeGreaterThan(0)
    for (const a of amateurs) {
      expect(a.club).toBeDefined()
      if (/\((OHL|WHL|QMJHL)\)$/.test(a.club!) && a.age < 20) expect(a.options).not.toContain('signAhl')
    }
    const target = amateurs.find((p) => (p.options ?? []).includes('signAhl'))
    if (!target) return
    expect(c.setDevCampChoice(target.playerId, 'signAhl').ok).toBe(true)
    c.advanceOffseason()
    const ci = c as unknown as { userTeam: { affiliateId: string }; data: { teams: Map<string, { roster: string[]; tier?: string }> } }
    expect(ci.data.teams.get(ci.userTeam.affiliateId)!.roster).toContain(target.playerId)
    const stillAmateur = [...ci.data.teams.values()].some((t) => t.tier === 'world' && t.roster.includes(target.playerId))
    expect(stillAmateur).toBe(false)
  }, 180_000)
})
