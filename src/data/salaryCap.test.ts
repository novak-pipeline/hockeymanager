/**
 * THE CEILING COMES FROM THE DATA.
 *
 * The mod loader used to hardcode an $88.0M salary cap. The real-roster
 * database carries real 2026-27 contracts, which are priced against the real
 * $104.0M cap — so every imported club opened roughly $16M over a wall that
 * did not exist, and a GM who is permanently over the ceiling cannot sign or
 * trade for anybody. Eighteen of the playtester's eighteen "major" findings
 * were that one line repeating.
 *
 * These tests pin the fix from both ends: the loader must honour a ceiling the
 * mod declares, and the real database on disk must declare one its own
 * contracts can live under.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { validateModDatabase, loadModDatabase, type ModDatabase, type ModPlayer, type ModTeam } from './modSchema'
import { DEFAULT_SALARY_CAP, budgetForCap } from './generate'
import { CAP_FLOOR, capFloorFor, grownCap } from '@engine/league/contracts'
import { generateLeague } from './generate'

/* ─────────────────────────── Fixture ─────────────────────────── */

function makeRoster(teamIndex: number, salary: number): ModPlayer[] {
  const base = teamIndex * 100
  const contract = { salary, years: 3 }
  const skater = (i: number, position: 'C' | 'W' | 'D'): ModPlayer => ({
    externalId: `ext-player-${i}`, name: `Player ${i}`, age: 25, position, handedness: 'L', overall: 60, contract,
  })
  const players: ModPlayer[] = []
  for (let i = 0; i < 4; i++) players.push(skater(base + i, 'C'))
  for (let i = 0; i < 9; i++) players.push(skater(base + 10 + i, 'W'))
  for (let i = 0; i < 7; i++) players.push(skater(base + 20 + i, 'D'))
  for (const g of [30, 31]) {
    players.push({
      externalId: `ext-goalie-${base + g}`, name: `Goalie ${base + g}`,
      age: 28, position: 'G', handedness: 'L', overall: 70, contract,
    })
  }
  return players
}

function makeTeam(i: number, salary: number): ModTeam {
  return {
    externalId: `ext-team-${i}`, city: `City${i}`, nickname: `Nickname${i}`,
    abbreviation: `T${String(i).padStart(2, '0')}`,
    primary: '#1A2B3C', secondary: '#4D5E6F', players: makeRoster(i, salary),
  }
}

/** 4-team mod whose 23 contracts per club total `payroll`. */
function makeMod(payroll: number, rules?: { salaryCap?: number }): ModDatabase {
  const salary = Math.floor(payroll / 23)
  const db: ModDatabase = {
    formatVersion: 1,
    meta: { name: 'Cap Fixture', author: 'Test', season: '2026-27' },
    conferences: [
      { name: 'Eastern', divisions: [{ name: 'Atlantic', teams: [makeTeam(0, salary), makeTeam(1, salary)] }] },
      { name: 'Western', divisions: [{ name: 'Pacific', teams: [makeTeam(2, salary), makeTeam(3, salary)] }] },
    ],
  }
  if (rules) db.rules = rules
  return db
}

/* ─────────────────────────── The field ─────────────────────────── */

describe('ModDatabase.rules.salaryCap', () => {
  it('survives validation round-trip', () => {
    const v = validateModDatabase(makeMod(100e6, { salaryCap: 104e6 }))
    expect(v.rules?.salaryCap).toBe(104e6)
  })

  it('is optional — a mod without it validates and loads exactly as before', () => {
    const v = validateModDatabase(makeMod(80e6))
    expect(v.rules).toBeUndefined()
    const data = loadModDatabase(v, { seed: 7 })
    for (const id of data.league.teams) {
      expect(data.teams.get(id)!.finances.salaryCap).toBe(DEFAULT_SALARY_CAP)
    }
  })

  it('rejects a ceiling that is not a positive number', () => {
    for (const bad of ['104000000', 0, -1, Number.NaN]) {
      expect(() => validateModDatabase(makeMod(80e6, { salaryCap: bad as number })))
        .toThrow(/salaryCap/)
    }
  })
})

/* ─────────────────── Day one: nobody starts over the wall ─────────────────── */

describe('an imported club is not over its own ceiling on day one', () => {
  it('honours the declared ceiling instead of the hardcoded $88M', () => {
    // Contracts priced against a $104M league — the exact shape of the real DB.
    const data = loadModDatabase(validateModDatabase(makeMod(100e6, { salaryCap: 104e6 })), { seed: 11 })
    for (const id of data.league.teams) {
      const t = data.teams.get(id)!
      expect(t.finances.salaryCap).toBe(104e6)
      expect(t.finances.capUsed).toBeLessThanOrEqual(t.finances.salaryCap)
      // The owner's budget has to clear the ceiling, or the Finances screen
      // reports every club insolvent from the opening whistle.
      expect(t.finances.budget).toBeGreaterThan(t.finances.salaryCap)
    }
  })

  it('would have caught the bug: the same rosters under the old default are all over', () => {
    const data = loadModDatabase(validateModDatabase(makeMod(100e6)), { seed: 11 })
    const over = data.league.teams.filter((id) => {
      const t = data.teams.get(id)!
      return t.finances.capUsed > t.finances.salaryCap
    })
    expect(over.length).toBe(data.league.teams.length)
  })
})

/* ─────────────────── The vanilla league must not move ─────────────────── */

describe('the fictional league is untouched', () => {
  it('still generates against $88.0M, with every club inside it', () => {
    const data = generateLeague({ seed: 4242 })
    for (const id of data.league.teams) {
      const t = data.teams.get(id)!
      expect(t.finances.salaryCap).toBe(88e6)
      expect(t.finances.budget).toBe(90e6)
      expect(t.finances.capUsed).toBeLessThanOrEqual(t.finances.salaryCap)
    }
  })
})

/* ─────────────────── The real database on disk ─────────────────── */

const REAL_DB = 'K:/Hockey Game/mods/nhl-ehm/database.json'

describe('real imported DB — cap baseline', () => {
  it.skipIf(!existsSync(REAL_DB))('declares a ceiling its own contracts can live under', () => {
    const mod = validateModDatabase(JSON.parse(readFileSync(REAL_DB, 'utf8')))
    const cap = mod.rules?.salaryCap
    expect(cap, 'the refreshed DB must ship its own salary ceiling').toBeDefined()

    const data = loadModDatabase(mod, { seed: 1 })
    const payrolls = data.league.teams.map((id) => data.teams.get(id)!.finances.capUsed).sort((a, b) => a - b)
    const median = payrolls[Math.floor(payrolls.length / 2)]!
    const worst = payrolls[payrolls.length - 1]!

    // The median club must sit UNDER the ceiling. Under the old $88M hardcode
    // the median was $97.0M — 10% over — which is what made every club frozen.
    expect(median).toBeLessThan(cap!)

    // The most expensive club may exceed it slightly: real rosters carry
    // LTIR relief we do not model. A few percent is a cap-pressed contender;
    // 22% over (which is where $88M put Florida) is a broken baseline.
    expect(worst / cap!).toBeLessThan(1.05)
  })
})

/* ─────────────────── The floor rides the ceiling ─────────────────── */

describe('salary floor', () => {
  it('is unchanged for the fictional league', () => {
    expect(capFloorFor(88e6)).toBe(65_000_000)
    expect(CAP_FLOOR).toBe(65_000_000)
  })

  it("tracks a mod's declared ceiling instead of staying at $65M", () => {
    // Real NHL lower limits: $70.6M under a $95.5M cap, $77.1M under $104.0M.
    expect(capFloorFor(95.5e6) / 1e6).toBeCloseTo(70.6, 0)
    expect(capFloorFor(104e6) / 1e6).toBeCloseTo(77.1, 0)
  })
})

/* ─────────────────── The curve five years out ─────────────────── */

describe('cap growth from a corrected base', () => {
  it('lands somewhere sane five seasons on', () => {
    let cap = 104e6
    const curve: number[] = []
    for (let i = 0; i < 5; i++) { cap = grownCap(cap); curve.push(cap) }

    // Year one must clear the real 2027-28 ceiling's neighbourhood without
    // leaping past it, and year five must not have compounded into fantasy.
    expect(curve[0]).toBeGreaterThan(104e6)
    expect(curve[0]).toBeLessThan(112e6)
    expect(curve[4]).toBeGreaterThan(125e6)
    expect(curve[4]).toBeLessThan(135e6)

    // And the budget follows the ceiling, so no club is reported insolvent
    // purely because the wall moved.
    expect(budgetForCap(curve[4]!)).toBeGreaterThan(curve[4]!)
  })

  it("the old base needed years just to reach today's real ceiling", () => {
    let cap = DEFAULT_SALARY_CAP
    for (let i = 0; i < 3; i++) cap = grownCap(cap)
    expect(cap).toBeLessThan(104e6)
  })
})
