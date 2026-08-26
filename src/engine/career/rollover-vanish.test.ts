/**
 * Regression: no player vanishes silently at a season rollover.
 *
 * The bug: an under-contract player (e.g. Sidney Crosby) could drop off his
 * club's roster with no trade, no signing, no retirement — landing in the
 * players map on no roster, in no free-agent pool, unretired. He appeared on no
 * screen and no transaction ever explained the exit. Career.reconcileOrphans()
 * closes the invariant: every NHL-ecosystem player is always in exactly one
 * VISIBLE state — rostered, a listed free agent, or an announced retiree.
 *
 * Two guards:
 *  - a fast, deterministic white-box test on a generated league that forces the
 *    two orphan shapes (dropped contract / lingering old veteran) and asserts
 *    each is resolved visibly;
 *  - a real-save test (skipped in CI when the autosave is absent) that loads the
 *    user's league, sims a full rollover, and asserts no rostered player
 *    disappears silently and no NHL player is left invisible.
 */
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

/** Saves are gzip-on-disk (despite the .json name) since 2026-07-15; older saves
 *  are plain JSON. Detect the gzip magic (0x1f 0x8b) and decompress if present. */
function readSaveJson(path: string): string {
  const buf = readFileSync(path)
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
    ? gunzipSync(buf).toString('utf8')
    : buf.toString('utf8')
}
import type { PlayerId, SeasonStats } from '@domain'
import { generateLeague } from '@data/generate'
import { ratedOverall } from '@engine/ratings/composites'
import { expectedPointsFor } from '@engine/league/offseason'
import { Career } from './career'

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

/** Every player currently on any club's roster. */
function rosteredIds(career: any): Set<string> {
  const s = new Set<string>()
  for (const t of career.data.teams.values()) for (const id of t.roster) s.add(id as string)
  return s
}

/** Count NHL-ecosystem players who are invisible: on no roster, in no FA pool,
 *  not a prospect, and not marked retired. This must always be zero. */
function invisibleNhlPlayers(career: any): { count: number; names: string[] } {
  const rostered = rosteredIds(career)
  const fa = new Set<string>((career.faPool ?? []).map((x: any) => x as string))
  const prospects = new Set<string>()
  for (const c of career.data.league.draftClasses ?? []) for (const pr of c.prospects) prospects.add(pr.playerId as string)
  const leaguePool = new Set<string>((career.data.league.players ?? []).map((x: any) => x as string))
  const names: string[] = []
  for (const [id, p] of career.data.players.entries()) {
    if (rostered.has(id as string) || fa.has(id as string) || prospects.has(id as string)) continue
    if (p.retiredYear !== undefined) continue
    const nhl = leaguePool.has(id as string) || (p.contract?.yearsRemaining ?? 0) > 0 ||
      (p.stats ?? []).some((s: any) => (s.league ?? 'nhl') === 'nhl' || s.league === 'ahl')
    if (!nhl) continue
    if (names.length < 15) names.push(`${p.name} (age ${p.age})`)
    else names.push('…')
  }
  return { count: names.filter((n) => n !== '…').length + names.filter((n) => n === '…').length, names }
}

describe('rollover — no silent vanish', () => {
  it('restores a dropped contract and retires a lingering veteran, visibly', () => {
    const data = generateLeague({ seed: 4242 })
    const userTid = data.league.teams[0]!
    const career = new Career(data, 4242, userTid) as any
    const year: number = career.year

    // A non-user club with a full roster.
    const club = [...data.teams.values()].find(
      (t) => data.league.teams.includes(t.id) && t.id !== userTid && t.roster.length > 6,
    )!

    // Orphan #1: an under-contract star with real history at this club, dropped
    // off the roster (the "Crosby vanished" shape).
    const starId = club.roster[3] as PlayerId
    const star = data.players.get(starId)!
    star.contract = { ...star.contract, yearsRemaining: 3 }
    star.stats.push(stubSeason(club.id as string, year - 1))
    club.roster = club.roster.filter((id) => id !== starId)

    // Orphan #2: an expired, plainly-finished veteran lingering in the map.
    // 44 and unsigned — the one profile where retirement is near-certain rather
    // than a roll (see the retirement hazard curve in offseason.ts).
    const vetId = club.roster[3] as PlayerId
    const vet = data.players.get(vetId)!
    vet.age = 44
    vet.contract = { ...vet.contract, yearsRemaining: 0 }
    club.roster = club.roster.filter((id) => id !== vetId)

    const ledgerBefore = career.transactionLedger.items.length
    career.reconcileOrphans()

    // Star restored to his club — visible on the roster again.
    expect(club.roster.map((id: PlayerId) => id as string)).toContain(starId as string)
    expect(star.retiredYear).toBeUndefined()

    // Veteran retired: first-class marker + a ledger entry + a news item.
    expect(vet.retiredYear).toBe(year)
    const retireTx = career.transactionLedger.items.slice(ledgerBefore).filter((t: any) => t.kind === 'retire')
    expect(retireTx.some((t: any) => t.summary.includes(vet.name))).toBe(true)
    const inbox = career.getInbox().items as Array<{ headline: string; body: string }>
    const mentioned = inbox.some((n) => `${n.headline} ${n.body}`.includes(vet.name))
    expect(mentioned).toBe(true)

    // Invariant: nobody in the NHL ecosystem is invisible.
    expect(invisibleNhlPlayers(career).count).toBe(0)
  })

  /**
   * Regression (playtest F1): the orphan sweep used to retire every unsigned
   * 37+ veteran on a flat `age >= 37`, so the league's old names hung them up
   * on schedule in every save. Being 38 and between contracts is a reason to
   * look for work, not a verdict — most of them belong on the free-agent list.
   */
  it('does not auto-retire every unsigned 38-year-old — most are listed as free agents', () => {
    const data = generateLeague({ seed: 909 })
    const career = new Career(data, 909, data.league.teams[0]!) as any
    const year: number = career.year

    // Drop 40 useful 38-year-olds off their rosters with expired deals: a full
    // season behind them, producing to their rating, still playing real minutes.
    const orphans: PlayerId[] = []
    for (const t of data.teams.values()) {
      if (!data.league.teams.includes(t.id) || orphans.length >= 40) continue
      for (const pid of [...t.roster].slice(0, 3)) {
        if (orphans.length >= 40) break
        const p = data.players.get(pid)!
        p.age = 38
        p.contract = { ...p.contract, yearsRemaining: 0 }
        const season = stubSeason(t.id as string, year - 1)
        const expected = expectedPointsFor(ratedOverall(p), p.position, p.role)
        season.ev.assists = Math.round(expected * season.gamesPlayed)
        season.ev.timeOnIce = 1000 * season.gamesPlayed
        season.shotsAgainst = 1800
        season.saves = 1647 // .915 — a league-average starter
        p.stats.push(season)
        t.roster = t.roster.filter((id) => id !== pid)
        orphans.push(pid)
      }
    }
    expect(orphans.length).toBe(40)

    career.reconcileOrphans()

    const retired = orphans.filter((id) => data.players.get(id)!.retiredYear !== undefined)
    // The old rule retired all 40, every seed. Retirement at 38 is now a chance:
    // some walk away, most go on the market — and nobody is left invisible.
    expect(retired.length).toBeGreaterThan(0)
    expect(retired.length).toBeLessThan(20)
    const listed = new Set<string>((career.faPool ?? []).map((x: PlayerId) => x as string))
    for (const id of orphans) {
      const p = data.players.get(id)!
      if (p.retiredYear === undefined) expect(listed.has(id as string)).toBe(true)
    }
    expect(invisibleNhlPlayers(career).count).toBe(0)
  })

  it('is idempotent on a healthy generated league (no orphans to resolve)', () => {
    const data = generateLeague({ seed: 77 })
    const career = new Career(data, 77, data.league.teams[0]!) as any
    const ledgerBefore = career.transactionLedger.items.length
    career.reconcileOrphans()
    expect(career.transactionLedger.items.length).toBe(ledgerBefore) // no retirements invented
    expect(invisibleNhlPlayers(career).count).toBe(0)
  })

  const SAVE = 'C:/Users/sawic/AppData/Roaming/hockey-manager/saves/autosave.json'
  it.skipIf(!existsSync(SAVE))('real save: a rollover drops no rostered player silently', () => {
    const career = Career.fromSnapshot(JSON.parse(readSaveJson(SAVE))) as any
    const startYear: number = career.year

    // Loading already heals the save (fromSnapshot → reconcileOrphans). No NHL
    // player should be invisible even before we advance.
    expect(invisibleNhlPlayers(career).count).toBe(0)

    const before = rosteredIds(career)

    // Sim the whole offseason into next season.
    let guard = 0
    while (career.year === startYear && guard++ < 40000) {
      if (career.draftPending()) { career.autoDraft(); continue }
      career.step()
    }
    expect(career.year).toBe(startYear + 1)

    const after = rosteredIds(career)
    const fa = new Set<string>((career.faPool ?? []).map((x: any) => x as string))
    const txText = (career.transactionLedger?.items ?? []).map((t: any) => t.summary).join(' | ')
    const newsText = (career.getInbox().items as Array<{ headline: string; body: string }>)
      .map((n) => `${n.headline} ${n.body}`).join(' | ')

    // Every player rostered before the rollover ends up somewhere visible:
    // still rostered, a free agent, marked retired, or named in a transaction/news.
    const silent: string[] = []
    for (const id of before) {
      if (after.has(id) || fa.has(id)) continue
      const p = career.data.players.get(id)
      if (!p || p.retiredYear !== undefined) continue
      const nm = p.name as string
      if (newsText.includes(nm) || txText.includes(nm)) continue
      silent.push(`${nm} (age ${p.age}, yr ${p.contract?.yearsRemaining})`)
    }
    expect(silent, `silently vanished: ${silent.slice(0, 20).join('; ')}`).toEqual([])

    // And no NHL player is left invisible after the rollover either.
    expect(invisibleNhlPlayers(career).count).toBe(0)
  }, 600_000)
})
