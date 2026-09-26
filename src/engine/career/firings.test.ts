/**
 * E3 — a dismissal the game HONOURS, and the front-office carousel around it.
 *
 * Before: a fired GM kept running the club through the draft and July 1, and
 * the rollover then set a fresh mandate for the SAME club — the firing was
 * silently undone. And the "job market" listed phantom vacancies at clubs whose
 * GM never actually left. Now: Continue is held until he takes a chair, every
 * chair is a real vacancy (the AI GM was dismissed, with news and a chronicle
 * entry), and the club he leaves hires a new GM who trades like a new man.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { routeContinue } from './beatGates'

type Internals = {
  boardState: { firedAtYear: number | null; missStreak?: number; warnings: number; patience: number; mandate: string }
  gmStateInternal: { stints: Array<{ seasons: number }> } | null
  gmJobMarket: unknown[] | null
  gmPersonas: Array<[string, { name: string; generation?: number; dismissedYear?: number; aggression: number }]>
  gmRelationships: Map<string, number>
  chronicle: { events: Array<{ kind: string; year: number; teamIds: string[]; userInvolved: boolean; details?: { change?: string; window?: string } }> }
}

/** Play one vanilla season to the start of the offseason (before the review). */
function toSeasonEnd(seed: number): { career: Career; internals: Internals } {
  const data = generateLeague({ seed })
  const career = new Career(data, seed, data.league.teams[0]!)
  while (career.getDashboard().phase === 'regularSeason') career.step()
  while (career.getDashboard().phase === 'playoffs') career.step()
  return { career, internals: career as unknown as Internals }
}

/** Put the user's board where a second failed year ends it. */
function armFiring(career: Career, internals: Internals): void {
  career.getGMProfile() // materialise the GM record
  internals.gmStateInternal!.stints[internals.gmStateInternal!.stints.length - 1]!.seasons = 2
  internals.boardState.mandate = 'cupOrBust'
  internals.boardState.missStreak = 2
  internals.boardState.warnings = 3
  internals.boardState.patience = 0
}

describe('E3: being fired is honoured', () => {
  it('holds Continue until the GM takes a real vacancy, then moves him and hires his successor', () => {
    const { career, internals } = toSeasonEnd(71)
    const oldTeamId = career.userTeamId as string
    const year = career.year
    armFiring(career, internals)
    career.advanceOffseason() // the season review: dismissed
    expect(internals.boardState.firedAtYear).toBe(year)

    // The review lapses on the next press; after it, the calendar is held.
    career.step()
    const dash = career.getDashboard()
    expect(dash.gmFired).toBe(true)
    expect(dash.continueLabel).toBe('Take a new job to continue')
    const stage = career.getOffseason()?.stage
    expect(career.step()).toBe(false)
    expect(career.getOffseason()?.stage).toBe(stage)
    const route = routeContinue({ dashboard: career.getDashboard(), screen: 'dashboard', lastRoute: null })
    expect(route).toMatchObject({ kind: 'hardGate', screen: 'gmCareer' })

    // Every opening is a chair that is genuinely empty — with a chronicle entry.
    const market = career.getGMJobMarket()
    expect(market.available).toBe(true)
    expect(market.openings.some((o) => o.interest !== 'longshot')).toBe(true)
    for (const o of market.openings) {
      const persona = internals.gmPersonas.find(([tid]) => tid === o.teamId)?.[1]
      expect(persona?.dismissedYear).toBe(year)
      expect(
        internals.chronicle.events.some(
          (e) => e.kind === 'gmChange' && e.teamIds[0] === o.teamId && e.details?.change === 'dismissed' && e.year === year
        )
      ).toBe(true)
    }
    // The user's own dismissal is on the record too.
    expect(internals.chronicle.events.some((e) => e.kind === 'gmChange' && e.userInvolved && e.details?.change === 'dismissed')).toBe(true)

    const pick = market.openings.find((o) => o.interest !== 'longshot')!
    const oldPersonaGen = internals.gmPersonas.find(([tid]) => tid === oldTeamId)?.[1].generation ?? 0
    const res = career.acceptGMJob(pick.teamId)
    expect(res.ok).toBe(true)
    expect(career.userTeamId as string).toBe(pick.teamId)
    expect(career.getDashboard().gmFired).toBe(false)

    // The club he left has a NEW general manager, and no empty chair remains.
    const successor = internals.gmPersonas.find(([tid]) => tid === oldTeamId)?.[1]
    expect(successor?.generation ?? 0).toBeGreaterThan(oldPersonaGen)
    expect(internals.gmPersonas.filter(([tid, p]) => p.dismissedYear !== undefined && tid !== pick.teamId)).toHaveLength(0)

    // The calendar moves again — he now runs the NEW club's draft — and the old
    // stint is closed as a firing.
    expect(routeContinue({ dashboard: career.getDashboard(), screen: 'dashboard', lastRoute: null })).toMatchObject({ kind: 'hardGate', screen: 'draft' })
    career.autoDraft()
    expect(career.step()).toBe(true)
    const stints = career.getGMProfile().stints
    expect(stints[stints.length - 2]?.endReason).toBe('fired')
    expect(stints[stints.length - 1]?.toYear).toBeNull()
  }, 180_000)

  it('an old save carrying a fired GM with no usable market is never a dead end', () => {
    const { career, internals } = toSeasonEnd(72)
    career.advanceOffseason() // awards, normally
    internals.boardState.firedAtYear = career.year
    internals.gmJobMarket = []
    career.step() // the staged review lapses
    expect(career.step()).toBe(false) // held…
    const market = career.getGMJobMarket()
    expect(market.openings.some((o) => o.interest !== 'longshot')).toBe(true) // …with a way out
  }, 180_000)
})

describe('E3: the front-office carousel', () => {
  it('a new GM is a different operator with no history with the user', () => {
    const { career, internals } = toSeasonEnd(73)
    const year = career.year
    // Force a sustained failure on one AI club so the carousel has a case.
    const target = career.getStandings().overall.find((r) => r.teamId !== (career.userTeamId as string))!.teamId
    const before = career.gmPersonaFor(target as never)
    before.missStreak = 5
    internals.gmRelationships.set(target, 90)
    career.advanceOffseason() // the review night: AI owners judge their GMs too
    const log = career.carouselLog(year)
    expect(log.gmDismissals).toBeLessThanOrEqual(4) // ≤3 AI + possibly the user
    for (const e of log.entries) expect(e.headline).not.toMatch(/undefined|NaN/)
    const after = internals.gmPersonas.find(([tid]) => tid === target)?.[1]
    if (after && after.name !== before.name) {
      expect(after.generation).toBeGreaterThanOrEqual(1)
      expect(internals.gmRelationships.has(target)).toBe(false)
    }
    // Nobody is waiting on the user, so every chair was filled the same night.
    expect(internals.gmPersonas.filter(([, p]) => p.dismissedYear !== undefined)).toHaveLength(0)
  }, 180_000)
})
