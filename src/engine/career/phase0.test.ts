/**
 * PHASE 0 (depth audit 2026-09) — "trust and quiet" regressions.
 *
 * Each block pins one bug from docs/PHASE-0.md with the values the game
 * actually generates (a real generated league, real sims where it matters).
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

function openConcern(c: any, pid: string, day: number, severity: 'mild' | 'serious' = 'mild'): string {
  const id = `pi-test-${c.interactionCounter++}`
  c.interactions.unshift({
    id, playerId: pid, teamId: c.userTeamId as string, year: c.year, day,
    kind: 'iceTime', severity,
    message: `I feel like I'm ready for more out there.`,
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

describe('an ignored concern is an answer (PHASE 0)', () => {
  it('lapses after the expiry window: residue, a morale cost, an agent note — and the slot frees', () => {
    const { career, c } = makeCareer(601)
    const [a, b] = c.userTeam.roster.slice(0, 2).map((id: unknown) => id as string)
    const ia = openConcern(c, a, 10)
    openConcern(c, b, 10, 'serious')
    const pa = c.data.players.get(a)
    const m0 = pa.morale
    // Two open cards used to block every new concern AND every decision scene.
    expect(c.interactions.filter((i: any) => i.status === 'open').length).toBe(2)

    c.expireStaleInteractions(10 + Career.CONCERN_EXPIRY_DAYS - 1)
    expect(c.interactions.find((i: any) => i.id === ia).status).toBe('open') // not yet

    c.expireStaleInteractions(10 + Career.CONCERN_EXPIRY_DAYS)
    const lapsed = c.interactions.find((i: any) => i.id === ia)
    expect(lapsed.status).toBe('resolved')
    expect(lapsed.chosenOptionId).toBe('ignored')
    expect(pa.morale).toBeLessThan(m0)
    expect(c.residueFlags.some((f: any) => f.playerId === a && f.kind === 'wasDismissed' && f.known)).toBe(true)
    expect(career.getInbox().items.some((n) => n.headline.includes('Nobody called him back'))).toBe(true)
    expect(c.interactions.filter((i: any) => i.status === 'open').length).toBe(0)
  })

  it('the agent brings the ignored conversation to the negotiating table', async () => {
    const { grudgeContext } = await import('./livingLedger')
    const { c } = makeCareer(602)
    const pid = c.userTeam.roster[0] as string
    openConcern(c, pid, 5)
    c.expireStaleInteractions(5 + Career.CONCERN_EXPIRY_DAYS)
    const g = grudgeContext(c.residueFlags, pid, c.year)
    expect(g.askMult).toBeGreaterThan(1)
    expect(g.lines.join(' ')).toMatch(/left that office with nothing/)
  })
})

describe('squad status is a scarce promise, not a morale pump (PHASE 0)', () => {
  it('caps Key at 2 and Core at 6 across the organisation, with a sentence when refused', () => {
    const { career, c } = makeCareer(611)
    for (const { p } of c.orgPlayersWithTier()) delete p.squadStatus
    const ids = c.userTeam.roster.map((id: unknown) => id as string)
    expect(career.setSquadStatus(ids[0], 'keyPlayer').ok).toBe(true)
    expect(career.setSquadStatus(ids[1], 'keyPlayer').ok).toBe(true)
    const third = career.setSquadStatus(ids[2], 'keyPlayer')
    expect(third.ok).toBe(false)
    expect(third.message).toMatch(/only promise 2/)
    // Re-affirming an existing holder is not a new promise.
    expect(career.setSquadStatus(ids[0], 'keyPlayer').ok).toBe(true)
    for (let i = 2; i < 8; i++) expect(career.setSquadStatus(ids[i], 'coreStarter').ok).toBe(true)
    expect(career.setSquadStatus(ids[8], 'coreStarter').ok).toBe(false)
  })

  it('auto-assign respects the caps', () => {
    const { career, c } = makeCareer(612)
    career.autoAssignSquadRoles(true)
    const org = c.orgPlayersWithTier().map((x: any) => x.p.squadStatus)
    expect(org.filter((s: string) => s === 'keyPlayer').length).toBeLessThanOrEqual(2)
    expect(org.filter((s: string) => s === 'coreStarter').length).toBeLessThanOrEqual(6)
  })

  it('labelling everyone "key" (an old save) no longer lifts the whole room; surplus costs morale', () => {
    const { c } = makeCareer(613)
    const ids = c.userTeam.roster.slice(0, 12)
    for (const id of ids) {
      const p = c.data.players.get(id)
      p.squadStatus = 'keyPlayer'
      p.morale = 50
    }
    c.tickSquadPromises()
    const lifted = ids.filter((id: unknown) => c.data.players.get(id).morale > 50).length
    expect(lifted).toBeLessThanOrEqual(2 + 6)
    const s = c.data.players.get(c.userTeam.roster[13])
    s.squadStatus = 'surplus'
    s.morale = 50
    c.tickSquadPromises()
    expect(s.morale).toBeLessThan(50)
  })
})

describe('medical: the risk shown is the risk the sim rolls (PHASE 0)', () => {
  it('fatigue genuinely raises the modelled per-game injury chance — modestly', async () => {
    const { injuryChance } = await import('@engine/league/condition')
    const { c } = makeCareer(621)
    const p = c.data.players.get(c.userTeam.roster.find((id: unknown) => c.data.players.get(id).position !== 'G'))
    p.fatigue = 0
    const fresh = injuryChance(p, 17 * 60)
    p.fatigue = 100
    const worn = injuryChance(p, 17 * 60)
    expect(worn).toBeGreaterThan(fresh)
    expect(worn / fresh).toBeLessThanOrEqual(1.6 + 1e-9) // modest, not a cliff
    // And the Medical Center quotes that same model: tired → higher shown risk.
    p.fatigue = 0
    const lo = c.getMedical().rows.find((r: any) => r.playerId === (p.id as string)).risk
    p.fatigue = 100
    const hi = c.getMedical().rows.find((r: any) => r.playerId === (p.id as string)).risk
    expect(hi).toBeGreaterThan(lo)
  })

  it('the head physio matters: a better one shortens layoffs and trims the risk', async () => {
    const { injuryChance, recoveryMult } = await import('@engine/league/condition')
    const { c } = makeCareer(622)
    const p = c.data.players.get(c.userTeam.roster[0])
    expect(injuryChance(p, 1000, 1)).toBeLessThan(injuryChance(p, 1000, 0))
    expect(recoveryMult(1)).toBeLessThan(recoveryMult(0.5))
    expect(recoveryMult(0)).toBeGreaterThan(recoveryMult(0.5))
    // The club's quality is read off its real head physio.
    const q = c.medicalQuality(c.userTeamId)
    expect(q).toBeGreaterThanOrEqual(0)
    expect(q).toBeLessThanOrEqual(1)
  })
})

describe('calendar pack (PHASE 0)', () => {
  it('the takeover summer is the summer BEFORE the season it leads into', () => {
    const { career, c } = makeCareer(631)
    career.startAtOffseason()
    const summerYear = Number(career.getDashboard().date.slice(0, 4))
    expect(summerYear).toBe(c.year + 1)
    // …and the three dev-camp beats sit on three different days.
    const dates = new Set<string>()
    for (let i = 0; i < 3 && career.getDashboard().devCampPending; i++) {
      dates.add(career.getDashboard().date)
      career.step()
    }
    expect(dates.size).toBeGreaterThanOrEqual(2)
    for (const d of dates) expect(d.startsWith(`${summerYear}-06-2`)).toBe(true)
  })

  it('"camp is over" mail waits for cut day; camp OPENS with an opening note', () => {
    const { c } = makeCareer(632)
    c.trainingCamp = { decisions: [{ playerId: c.userTeam.roster[0], name: 'x', position: 'C', age: 25, current: 'nhl', coachPlan: 'nhl', waiverRequired: false, line: '' }], resolved: false, campDay: 1 }
    const inbox = (): string[] => c.news.map((n: any) => n.headline)
    for (let day = 2; day <= 7; day++) {
      c.advanceTrainingCampDay()
      expect(inbox()).not.toContain('Cut day — camp verdicts are in')
    }
    c.advanceTrainingCampDay()
    expect(inbox()).toContain('Cut day — camp verdicts are in')
  })

  it('knocked out: ONE press sims to the Cup, with a bracket digest (was 4+ empty presses)', () => {
    const { career, c } = makeCareer(633)
    c.trainingCamp = null
    c.boardMeetingYear = null
    career.advance(400)
    for (let i = 0; i < 400 && career.getDashboard().phase === 'regularSeason'; i++) career.step()
    expect(career.getDashboard().phase).toBe('playoffs')
    // Play until the user is out (or has won it all).
    let guard = 0
    while (career.getDashboard().phase === 'playoffs' && !c.userOutOfPlayoffs() && guard++ < 200) career.step()
    if (career.getDashboard().phase !== 'playoffs') return // champions — nothing to fast-forward
    expect(career.getDashboard().continueLabel).toBe('Continue — sim to the end of the playoffs')
    career.step()
    expect(career.getDashboard().phase).toBe('offseason')
    expect(career.getInbox().items.some((n) => n.headline === 'The rest of the playoffs')).toBe(true)
  }, 240_000)

  it('the Apr→Jun gap is staged: lottery, combine and awards night land on their own dated presses', () => {
    const { career, c } = makeCareer(634)
    c.trainingCamp = null
    c.boardMeetingYear = null
    for (let i = 0; i < 900 && career.getDashboard().phase !== 'offseason'; i++) career.step()
    expect(career.getOffseason()?.stage).toBe('awards')
    const sizes: number[] = []
    const labels: string[] = []
    const dates: string[] = []
    const seen = new Set<string>(c.news.map((n: any) => n.id))
    for (let i = 0; i < 4; i++) {
      labels.push(career.getDashboard().continueLabel)
      career.step()
      dates.push(career.getDashboard().date)
      const fresh = c.news.filter((n: any) => !seen.has(n.id))
      for (const n of fresh) seen.add(n.id)
      sizes.push(fresh.length)
    }
    expect(labels).toEqual(['Continue to the draft lottery', 'Continue to the combine', 'Continue to awards night', 'Continue to the entry draft'])
    expect(dates.slice(0, 3).map((d) => d.slice(5))).toEqual(['05-05', '06-02', '06-18'])
    expect(career.getOffseason()?.stage).toBe('draft')
    expect(career.getDashboard().continueLabel).toBe('Go to the entry draft')
    // No single press is the old 60-item dump.
    const total = sizes.reduce((a, b) => a + b, 0)
    console.log("[summer beats] inbox items per press:", sizes)
    expect(Math.max(...sizes)).toBeLessThan(total)
    expect(sizes.filter((n) => n > 0).length).toBeGreaterThanOrEqual(3)
  }, 240_000)
})

describe('interruption diet — engine side (PHASE 0)', () => {
  it('a routine lowball for a depth piece goes to the AGM (digest), not the GM desk', () => {
    const { c } = makeCareer(641)
    c.currentDay = 10
    const mine = c.userTeam.roster.map((id: unknown) => id as string)
    const depth = mine.find((id: string) => !c.data.players.get(id).squadStatus && !c.data.players.get(id).tradeStatus)
    const partner = c.data.league.teams.find((t: unknown) => t !== c.userTeamId)
    const offer = { offerId: 'x', partnerTeamId: partner, userReceivesPlayerIds: [], userReceivesPicks: [], userGivesPlayerIds: [depth], userGivesPicks: [], message: '', expiresOnDay: 99 }
    expect(c.offerWorthTheGm(offer)).toBe(false)
    // …but the same call is the GM's when it is about a man he promised a role,
    c.data.players.get(depth).squadStatus = 'coreStarter'
    expect(c.offerWorthTheGm(offer)).toBe(true)
    delete c.data.players.get(depth).squadStatus
    // …or when it is deadline week.
    c.currentDay = c.deadlineDay - 3
    expect(c.offerWorthTheGm(offer)).toBe(true)
  })

  it('staff meetings are event-triggered and capped; delegating runs them without convening', () => {
    const { career, c } = makeCareer(642)
    c.trainingCamp = null
    c.boardMeetingYear = null
    let convened = 0
    for (let i = 0; i < 400 && career.getDashboard().phase === 'regularSeason'; i++) {
      const had = c.staffMeetingScene !== null
      career.step()
      if (!had && c.staffMeetingScene !== null) convened++
    }
    // The old timer convened every 14 days (~13 a season).
    expect(convened).toBeLessThanOrEqual(9)
    const { c: d } = makeCareer(642)
    d.trainingCamp = null
    d.boardMeetingYear = null
    d.setStaffMeetingMode('delegate')
    const dc = d as any
    for (let i = 0; i < 200; i++) {
      d.step()
      expect(dc.staffMeetingScene).toBeNull()
    }
  }, 240_000)
})

describe('line synergy is one rule for the whole league (PHASE 0)', () => {
  it('an AI club\'s line gets the same synergy scaling the user\'s does', async () => {
    const { lineSynergy } = await import('@engine/league/archetypes')
    const { chemistryModifier } = await import('@engine/league/lockerRoom')
    const { c } = makeCareer(651)
    const resolveWith = c.storyResolve()
    const { effectiveResolve } = await import('@engine/league/condition')
    const conditioned = effectiveResolve(c.resolve.bind(c))
    // Find an AI forward line whose synergy is not neutral.
    let checked = 0
    for (const tid of c.data.league.teams) {
      if (tid === c.userTeamId) continue
      const team = c.data.teams.get(tid)
      const lr = c.lockerRooms.get(tid)
      if (!lr) continue
      for (const line of team.lines.forwards) {
        const ids = line.map((x: unknown) => x as string)
        const players = ids.map((id: string) => c.data.players.get(id)).filter(Boolean)
        const syn = lineSynergy(players).multiplier
        if (syn === 1) continue
        const combined = Math.min(1.03, Math.max(0.97, chemistryModifier(lr, ids) * syn))
        const chemOnly = Math.min(1.03, Math.max(0.97, chemistryModifier(lr, ids)))
        if (Math.abs(combined - chemOnly) < 0.004) continue // clamp ate it
        const pid = ids[0]
        const raw = conditioned(pid).composites as unknown as Record<string, number>
        const got = resolveWith(pid).composites as Record<string, number>
        // Every composite is exactly the chem × synergy scaling — and at least
        // one differs from what chemistry alone would give.
        let differs = false
        for (const k of Object.keys(raw)) {
          expect(got[k]).toBe(Math.max(1, Math.min(99, Math.round(raw[k]! * combined))))
          if (got[k] !== Math.max(1, Math.min(99, Math.round(raw[k]! * chemOnly)))) differs = true
        }
        if (differs) checked++
        if (checked >= 3) return
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('injury mail: a stop only for a real absence of a key man (PHASE 0)', () => {
  it('top-line man out 5 games carries stop salience; the same man day-to-day, or a depth man, does not', () => {
    const { c } = makeCareer(661)
    const fwd = c.userTeam.roster
      .map((id: unknown) => c.data.players.get(id))
      .filter((p: any) => p.position !== 'G' && p.position !== 'D')
    const star = fwd.find((p: any) => c.isKeyPlayer(p))
    const depth = fwd.find((p: any) => !c.isKeyPlayer(p))
    const last = (): any => c.news[0]
    const inj = (n: number): any => ({ kind: 'lowerBody', gamesRemaining: n, description: 'lower-body injury' })
    c.pushInjuryNews(star, inj(5), false, 'Boston')
    expect(last().salience).toBe(60)
    c.pushInjuryNews(star, inj(1), false, 'Boston')
    expect(last().salience).toBeUndefined()
    if (depth) {
      c.pushInjuryNews(depth, inj(8), false, 'Boston')
      expect(last().salience).toBeUndefined()
    }
  })
})

describe('the weekly trade desk digest (PHASE 0)', () => {
  it('routine calls the AGM passed on arrive as ONE weekly mail naming the week\'s story', () => {
    const { c } = makeCareer(671)
    c.currentDay = 20
    c.tradeDeskLog.push({ day: 12, club: 'Boston', target: 'A. Depth' }, { day: 14, club: 'Dallas', target: 'A. Depth' }, { day: 15, club: 'Tampa Bay', target: 'B. Spare' })
    c.flushTradeDesk(16) // not a week yet
    expect(c.news.some((n: any) => n.headline.startsWith('Trade desk'))).toBe(false)
    c.flushTradeDesk(19)
    const mail = c.news.filter((n: any) => n.headline.startsWith('Trade desk'))
    expect(mail).toHaveLength(1)
    expect(mail[0].headline).toBe('Trade desk: 2 clubs called about A. Depth')
    expect(mail[0].body).toMatch(/Boston asked about A\. Depth/)
    expect(c.tradeDeskLog).toHaveLength(0)
  })
})
