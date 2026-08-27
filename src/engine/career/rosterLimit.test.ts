/**
 * Regression: no club opens a season over the 26-man roster limit.
 *
 * The playtester (docs/AUTOPILOT-2026-08-26.md) found its club starting 2029
 * with 29 men. `signPlayer` enforces MAX_ROSTER_SIZE by throw — but the culprit
 * signed nobody. An instrumented five-season re-run named exactly one overflow
 * site: `assignRosters`, called from `startNewSeason`, where two halves ratchet
 * against each other. Step 1 trimmed to 23 on a flat overall sort that did not
 * know what position anyone played, so it could cut a club's goalies; Step 2
 * then pulled bodies back up to restore the 12F/6D/2G minimums with no ceiling
 * of its own. Trim blind, refill unbounded, and 26 becomes 29.
 *
 * Three guards:
 *  - `trimToRosterLimit` — the pure cutdown rule the fix is built on (worst-first,
 *    never below the 14F/7D/2G shape, union preserved);
 *  - `assignRosters` itself — the ratchet, driven from both ends;
 *  - the backstops — an orphan restored to a full club lands on the farm, and the
 *    season-start sweep conforms every club however it got over.
 */
import { describe, expect, it } from 'vitest'
import type { Player, PlayerId, SeasonStats } from '@domain'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { trimToRosterLimit } from './farmReassign'

/** Minimal stub — trimToRosterLimit only reads id + position. */
function stub(id: string, position: 'C' | 'W' | 'D' | 'G'): Player {
  return { id: id as PlayerId, position } as unknown as Player
}

/** A zeroed NHL season line pinning a player to a club in year `season`. */
function stubSeason(teamId: string, season: number): SeasonStats {
  const situ = { goals: 0, assists: 0, shots: 0, timeOnIce: 0 }
  return {
    season,
    teamId,
    league: 'nhl',
    gamesPlayed: 70,
    ev: { ...situ },
    pp: { ...situ },
    pk: { ...situ },
    plusMinus: 0,
    penaltyMinutes: 0,
    saves: 0,
    shotsAgainst: 0,
    goalsAgainst: 0,
    shutouts: 0,
  }
}

describe('trimToRosterLimit', () => {
  const build = (f: number, d: number, g: number): Player[] => [
    ...Array.from({ length: f }, (_, i) => stub(`f${i}`, 'C')),
    ...Array.from({ length: d }, (_, i) => stub(`d${i}`, 'D')),
    ...Array.from({ length: g }, (_, i) => stub(`g${i}`, 'G')),
  ]
  // Distinct scores with no ties across groups: forwards rate lowest (10+i),
  // then defencemen (50+i), then goalies (90+i). Within a group the suffix
  // orders them, so `f0` is the worst man on the roster.
  const score = (p: Player): number => {
    const id = p.id as string
    const base = id.startsWith('f') ? 10 : id.startsWith('d') ? 50 : 90
    return base + Number(id.slice(1))
  }
  const resolveFrom = (all: Player[]) => {
    const map = new Map(all.map((p) => [p.id as string, p]))
    return (id: PlayerId): Player | undefined => map.get(id as string)
  }

  it('brings an over-size roster back to the limit, cutting worst-first', () => {
    const all = build(18, 9, 3) // 30 men
    const res = trimToRosterLimit({
      nhlRoster: all.map((p) => p.id),
      ahlRoster: [],
      resolve: resolveFrom(all),
      score,
      limit: 26,
    })
    expect(res.nhl.length).toBe(26)
    expect(res.demoted.length).toBe(4)
    // Forwards are 4 over the shape of 14, D is 2 over, G is 1 over — and the
    // four lowest scores anywhere above shape are f0..f3.
    expect(res.demoted.map((id) => id as string)).toEqual(['f0', 'f1', 'f2', 'f3'])
    expect(res.ahl.map((id) => id as string)).toEqual(['f0', 'f1', 'f2', 'f3'])
  })

  it('never strips a club below the 14F/7D/2G shape, however the scores fall', () => {
    // Every goalie and defenceman rates below every forward: a naive worst-first
    // trim would send the goalies down and leave the club unable to dress.
    const all = build(20, 7, 2)
    const inverted = (p: Player): number =>
      (p.id as string).startsWith('f') ? 100 + Number((p.id as string).slice(1)) : 1
    const res = trimToRosterLimit({
      nhlRoster: all.map((p) => p.id),
      ahlRoster: [],
      resolve: resolveFrom(all),
      score: inverted,
      limit: 26,
    })
    expect(res.nhl.length).toBe(26)
    const kept = res.nhl.map((id) => id as string)
    expect(kept.filter((id) => id.startsWith('g')).length).toBe(2)
    expect(kept.filter((id) => id.startsWith('d')).length).toBe(7)
    // Only forwards — the one group above its shape — were cut.
    expect(res.demoted.every((id) => (id as string).startsWith('f'))).toBe(true)
  })

  it('leaves a legal roster exactly as it is', () => {
    const all = build(14, 7, 2) // 23 — already legal
    const extra = stub('x0', 'C')
    const ids = all.map((p) => p.id)
    const res = trimToRosterLimit({
      nhlRoster: ids,
      ahlRoster: [extra.id],
      resolve: resolveFrom([...all, extra]),
      score,
      limit: 26,
    })
    expect(res.demoted).toEqual([])
    expect(res.nhl).toEqual(ids)
    expect(res.ahl.map((id) => id as string)).toEqual(['x0'])
  })

  it('preserves the union of both rosters', () => {
    const all = build(18, 9, 3)
    const extra = stub('x0', 'W')
    const res = trimToRosterLimit({
      nhlRoster: all.map((p) => p.id),
      ahlRoster: [extra.id],
      resolve: resolveFrom([...all, extra]),
      score,
      limit: 26,
    })
    const union = [...res.nhl, ...res.ahl].map((id) => id as string).sort()
    const before = [...all.map((p) => p.id as string), 'x0'].sort()
    expect(union).toEqual(before)
    expect(new Set(union).size).toBe(union.length) // nobody duplicated
  })
})

describe('season-start roster compliance', () => {
  /** Fill a club to exactly `n` bodies by recalling from its own affiliate. */
  function pad(team: { roster: PlayerId[] }, ahl: { roster: PlayerId[] }, n: number): void {
    while (team.roster.length < n && ahl.roster.length > 0) {
      team.roster.push(ahl.roster.shift()!)
    }
    expect(team.roster.length).toBe(n)
  }

  it('restores a dropped contract to the FARM when the big club is full', () => {
    const data = generateLeague({ seed: 5150 })
    const userTid = data.league.teams[0]!
    const career = new Career(data, 5150, userTid) as any
    const year: number = career.year

    const club = data.teams.get(userTid)!
    const ahl = data.teams.get(club.affiliateId!)!

    // A contracted player with history at this club, dropped off the roster —
    // the "Crosby vanished" shape reconcileOrphans exists to heal.
    const starId = club.roster[2] as PlayerId
    const star = data.players.get(starId)!
    star.contract = { ...star.contract, yearsRemaining: 3 }
    star.stats.push(stubSeason(club.id as string, year - 1))
    club.roster = club.roster.filter((id) => id !== starId)

    // ...onto a club that is already at the ceiling.
    pad(club, ahl, 26)

    career.reconcileOrphans()

    // He is visible again, and the big club is still legal.
    expect(ahl.roster.map((id) => id as string)).toContain(starId as string)
    expect(club.roster.map((id) => id as string)).not.toContain(starId as string)
    expect(club.roster.length).toBe(26)
    expect(star.retiredYear).toBeUndefined()
  })

  it('still restores him to the big club when there is room', () => {
    const data = generateLeague({ seed: 5151 })
    const userTid = data.league.teams[0]!
    const career = new Career(data, 5151, userTid) as any
    const year: number = career.year

    const club = data.teams.get(userTid)!
    const starId = club.roster[2] as PlayerId
    const star = data.players.get(starId)!
    star.contract = { ...star.contract, yearsRemaining: 3 }
    star.stats.push(stubSeason(club.id as string, year - 1))
    club.roster = club.roster.filter((id) => id !== starId)
    expect(club.roster.length).toBeLessThan(26)

    career.reconcileOrphans()
    expect(club.roster.map((id) => id as string)).toContain(starId as string)
  })

  /**
   * The ratchet itself, reproduced: a club whose lowest-rated men are its goalies
   * and defencemen. A position-blind trim to 23 cuts exactly those, and the
   * pull-up that restores the minimums has to invent the spots — which is how the
   * playtester's club opened a season with 29.
   */
  it('assignRosters cannot inflate a roster past the limit', () => {
    const data = generateLeague({ seed: 5153 })
    const userTid = data.league.teams[0]!
    const career = new Career(data, 5153, userTid) as any
    const nhl = data.teams.get(userTid)!
    const ahl = data.teams.get(nhl.affiliateId!)!

    pad(nhl, ahl, 28)
    // Make every goalie and defenceman the worst man on the roster, so a flat
    // overall sort sends them all down.
    for (const id of nhl.roster) {
      const p = data.players.get(id)!
      if (p.position === 'G' || p.position === 'D') {
        for (const k of Object.keys(p.composites) as Array<keyof typeof p.composites>) {
          p.composites[k] = 1
        }
      }
    }
    const before = [...nhl.roster, ...ahl.roster].map((id) => id as string).sort()

    career.assignRosters()

    expect(nhl.roster.length).toBeLessThanOrEqual(26)
    const kept = nhl.roster.map((id) => data.players.get(id)!)
    expect(kept.filter((p) => p.position === 'G').length).toBeGreaterThanOrEqual(2)
    expect(kept.filter((p) => p.position === 'D').length).toBeGreaterThanOrEqual(6)
    // Nobody was lost or duplicated in the shuffle.
    const after = [...nhl.roster, ...ahl.roster].map((id) => id as string).sort()
    expect(after).toEqual(before)
  })

  it('the sweep conforms every over-size club, the user included', () => {
    const data = generateLeague({ seed: 5152 })
    const userTid = data.league.teams[0]!
    const career = new Career(data, 5152, userTid) as any

    // Push two clubs past the limit by brute force — the sweep is a backstop, so
    // it must not care which route put them there. One of them is the user's.
    const overSize = [data.league.teams[0]!, data.league.teams[1]!]
    for (const tid of overSize) {
      const nhl = data.teams.get(tid)!
      pad(nhl, data.teams.get(nhl.affiliateId!)!, 29)
    }

    career.enforceSeasonStartRosterLimits()

    for (const tid of overSize) {
      const nhl = data.teams.get(tid)!
      expect(nhl.roster.length).toBeLessThanOrEqual(26)
      // Still able to dress a lineup: two goalies and six defencemen survive.
      const kept = nhl.roster.map((id) => data.players.get(id)!)
      expect(kept.filter((p) => p.position === 'G').length).toBeGreaterThanOrEqual(2)
      expect(kept.filter((p) => p.position === 'D').length).toBeGreaterThanOrEqual(6)
    }
  })
})
