/**
 * Tests for ModStaff import: validation, loading into TeamStaff,
 * missing-role synthesis, and Career.getTeamStaff preference.
 */
import { describe, expect, it } from 'vitest'
import {
  validateModDatabase,
  loadModDatabase,
  type ModDatabase,
  type ModTeam,
  type ModPlayer,
  type ModStaff,
} from './modSchema'
import { Career } from '@engine/career/career'

/* ─────────────────────────── Fixture helpers ─────────────────────────── */

function makeSkater(i: number, position: 'C' | 'W' | 'D' = 'W'): ModPlayer {
  return { externalId: `ext-p-${i}`, name: `Player ${i}`, age: 25, position, handedness: 'L', overall: 60 }
}
function makeGoalie(i: number): ModPlayer {
  return { externalId: `ext-g-${i}`, name: `Goalie ${i}`, age: 28, position: 'G', handedness: 'L', overall: 70 }
}
function makeRoster(base: number): ModPlayer[] {
  const out: ModPlayer[] = []
  for (let i = 0; i < 4; i++) out.push(makeSkater(base + i, 'C'))
  for (let i = 0; i < 9; i++) out.push(makeSkater(base + 10 + i, 'W'))
  for (let i = 0; i < 7; i++) out.push(makeSkater(base + 20 + i, 'D'))
  out.push(makeGoalie(base + 30))
  out.push(makeGoalie(base + 31))
  return out
}

function makeTeam(i: number, staff?: ModStaff[]): ModTeam {
  return {
    externalId: `ext-team-${i}`,
    city: `City${i}`,
    nickname: `Nickname${i}`,
    abbreviation: `T${String(i).padStart(2, '0')}`,
    primary: '#1A2B3C',
    secondary: '#4D5E6F',
    players: makeRoster(i * 100),
    ...(staff !== undefined ? { staff } : {}),
  }
}

function makeMod(teams: ModTeam[]): ModDatabase {
  const half = Math.floor(teams.length / 2)
  return {
    formatVersion: 1,
    meta: { name: 'Staff Test League' },
    conferences: [
      { name: 'East', divisions: [{ name: 'AtlanticDiv', teams: teams.slice(0, half) }] },
      { name: 'West', divisions: [{ name: 'PacificDiv', teams: teams.slice(half) }] },
    ],
  }
}

const FULL_STAFF: ModStaff[] = [
  { name: 'Real Coach', role: 'headCoach', rating: 75, judgment: 80, specialty: 'Offense', faceId: 'coach-face-1' },
  { name: 'Assist Coach One', role: 'assistantCoach', rating: 62, judgment: 55 },
  { name: 'Assist Coach Two', role: 'assistantCoach', rating: 60 },
  { name: 'Real AGM', role: 'assistantGM', rating: 70, judgment: 72, specialty: 'Analytics' },
  { name: 'Scout Alpha', role: 'scout', rating: 58, specialty: 'Europe' },
  { name: 'Scout Beta', role: 'scout', rating: 61, faceId: 'scout-face-2' },
  { name: 'Team Physio', role: 'physio', rating: 55 },
  { name: 'The Owner', role: 'owner', rating: 80, judgment: 65 },
]

/* ─────────────────────────── validateModDatabase: staff ──────────────── */

describe('validateModDatabase — ModStaff', () => {
  it('accepts a team with a valid staff array', () => {
    const mod = makeMod([makeTeam(0, FULL_STAFF), makeTeam(1), makeTeam(2), makeTeam(3)])
    expect(() => validateModDatabase(mod)).not.toThrow()
  })

  it('accepts teams without staff (backward compat)', () => {
    const mod = makeMod([makeTeam(0), makeTeam(1), makeTeam(2), makeTeam(3)])
    expect(() => validateModDatabase(mod)).not.toThrow()
  })

  it('rejects invalid staff role', () => {
    const bad: ModStaff[] = [{ name: 'Bad', role: 'wizard' as never, rating: 50 }]
    const mod = makeMod([makeTeam(0, bad), makeTeam(1), makeTeam(2), makeTeam(3)])
    expect(() => validateModDatabase(mod)).toThrow(/role must be one of/)
  })

  it('rejects rating out of 1–99', () => {
    const bad: ModStaff[] = [{ name: 'Too High', role: 'headCoach', rating: 150 }]
    const mod = makeMod([makeTeam(0, bad), makeTeam(1), makeTeam(2), makeTeam(3)])
    expect(() => validateModDatabase(mod)).toThrow(/rating must be 1–99/)
  })

  it('rejects judgment out of 0–100', () => {
    const bad: ModStaff[] = [{ name: 'Bad J', role: 'scout', rating: 50, judgment: 200 }]
    const mod = makeMod([makeTeam(0, bad), makeTeam(1), makeTeam(2), makeTeam(3)])
    expect(() => validateModDatabase(mod)).toThrow(/judgment must be 0–100/)
  })
})

/* ─────────────────────────── loadModDatabase: staffByTeam ───────────── */

describe('loadModDatabase — staffByTeam', () => {
  it('builds staffByTeam with real names + faceId when mod provides staff', () => {
    const mod = validateModDatabase(
      makeMod([makeTeam(0, FULL_STAFF), makeTeam(1), makeTeam(2), makeTeam(3)])
    )
    const data = loadModDatabase(mod, { seed: 42 })

    expect(data.staffByTeam).toBeDefined()
    expect(data.staffByTeam!.size).toBe(1)

    const teamId = data.league.teams[0]
    const ts = data.staffByTeam!.get(teamId)
    expect(ts).toBeDefined()

    // Real names preserved.
    expect(ts!.headCoach.name).toBe('Real Coach')
    expect(ts!.assistantGM.name).toBe('Real AGM')
    expect(ts!.owner.name).toBe('The Owner')
    expect(ts!.scouts.some((s) => s.name === 'Scout Alpha')).toBe(true)
    expect(ts!.scouts.some((s) => s.name === 'Scout Beta')).toBe(true)
    expect(ts!.physios.some((p) => p.name === 'Team Physio')).toBe(true)
  })

  it('carries faceId from ModStaff through to StaffMember', () => {
    const mod = validateModDatabase(
      makeMod([makeTeam(0, FULL_STAFF), makeTeam(1), makeTeam(2), makeTeam(3)])
    )
    const data = loadModDatabase(mod, { seed: 43 })
    const ts = data.staffByTeam!.get(data.league.teams[0])!
    expect(ts.headCoach.faceId).toBe('coach-face-1')
    expect(ts.scouts.find((s) => s.name === 'Scout Beta')?.faceId).toBe('scout-face-2')
  })

  it('synthesises missing roles so every slot is always filled', () => {
    // Only provide a head coach; everything else must be synthesised.
    const partialStaff: ModStaff[] = [
      { name: 'Solo Coach', role: 'headCoach', rating: 68, judgment: 60 },
    ]
    const mod = validateModDatabase(
      makeMod([makeTeam(0, partialStaff), makeTeam(1), makeTeam(2), makeTeam(3)])
    )
    const data = loadModDatabase(mod, { seed: 55 })
    const ts = data.staffByTeam!.get(data.league.teams[0])!

    expect(ts.headCoach.name).toBe('Solo Coach')
    expect(ts.assistantCoaches.length).toBeGreaterThanOrEqual(2)
    expect(ts.assistantGM).toBeDefined()
    expect(ts.scouts.length).toBeGreaterThanOrEqual(2)
    expect(ts.physios.length).toBeGreaterThanOrEqual(1)
    expect(ts.owner).toBeDefined()
  })

  it('does not create staffByTeam when no team in the mod has staff', () => {
    const mod = validateModDatabase(
      makeMod([makeTeam(0), makeTeam(1), makeTeam(2), makeTeam(3)])
    )
    const data = loadModDatabase(mod, { seed: 99 })
    // staffByTeam either absent or empty.
    expect(!data.staffByTeam || data.staffByTeam.size === 0).toBe(true)
  })

  it('picks the highest-rated head coach when multiple are provided', () => {
    const multiCoach: ModStaff[] = [
      { name: 'Low Coach', role: 'headCoach', rating: 50 },
      { name: 'Top Coach', role: 'headCoach', rating: 88 },
      { name: 'Mid Coach', role: 'headCoach', rating: 70 },
    ]
    const mod = validateModDatabase(
      makeMod([makeTeam(0, multiCoach), makeTeam(1), makeTeam(2), makeTeam(3)])
    )
    const data = loadModDatabase(mod, { seed: 7 })
    const ts = data.staffByTeam!.get(data.league.teams[0])!
    expect(ts.headCoach.name).toBe('Top Coach')
  })

  it('demeanor is set on imported staff', () => {
    const mod = validateModDatabase(
      makeMod([makeTeam(0, FULL_STAFF), makeTeam(1), makeTeam(2), makeTeam(3)])
    )
    const data = loadModDatabase(mod, { seed: 42 })
    const ts = data.staffByTeam!.get(data.league.teams[0])!
    const DEMEANORS = ['fiery', 'calm', 'analytical', 'motivator', 'pragmatic']
    expect(DEMEANORS).toContain(ts.headCoach.demeanor)
    expect(DEMEANORS).toContain(ts.assistantGM.demeanor)
  })
})

/* ─────────────────────────── Career: staffByTeam preference ──────────── */

describe('Career.getTeamStaff — prefers staffByTeam', () => {
  it('returns imported staff (real names) for a team that has staffByTeam data', () => {
    const staffForTeam0: ModStaff[] = [
      { name: 'Import Coach', role: 'headCoach', rating: 78, judgment: 82 },
      { name: 'Import AGM', role: 'assistantGM', rating: 65 },
      { name: 'Import Scout', role: 'scout', rating: 60 },
      { name: 'Import Scout 2', role: 'scout', rating: 57 },
      { name: 'Import Physio', role: 'physio', rating: 55 },
      { name: 'Import Owner', role: 'owner', rating: 70 },
    ]
    const mod = validateModDatabase(
      makeMod([makeTeam(0, staffForTeam0), makeTeam(1), makeTeam(2), makeTeam(3)])
    )
    const data = loadModDatabase(mod, { seed: 101 })
    const teamId = data.league.teams[0]
    const career = new Career(data, 101, teamId)

    const ts = career.getTeamStaff(teamId as string)
    expect(ts.headCoach.name).toBe('Import Coach')
    expect(ts.assistantGM.name).toBe('Import AGM')
    expect(ts.owner.name).toBe('Import Owner')
  })

  it('falls back to generated staff for a team with no mod staff', () => {
    const staffForTeam0: ModStaff[] = [
      { name: 'Only This Coach', role: 'headCoach', rating: 72 },
      { name: 'AGM Here', role: 'assistantGM', rating: 65 },
      { name: 'Scout Here', role: 'scout', rating: 58 },
      { name: 'Scout Here 2', role: 'scout', rating: 56 },
      { name: 'Physio Here', role: 'physio', rating: 52 },
      { name: 'Owner Here', role: 'owner', rating: 74 },
    ]
    const mod = validateModDatabase(
      makeMod([makeTeam(0, staffForTeam0), makeTeam(1), makeTeam(2), makeTeam(3)])
    )
    const data = loadModDatabase(mod, { seed: 202 })
    const team1Id = data.league.teams[1] // no staff provided
    const career = new Career(data, 202, data.league.teams[0])

    const ts = career.getTeamStaff(team1Id as string)
    // Should be generated (not one of the imported names)
    expect(ts.headCoach.name).not.toBe('Only This Coach')
    expect(ts.headCoach.name).toBeTruthy()
    // All mandatory slots still filled.
    expect(ts.assistantCoaches.length).toBeGreaterThanOrEqual(2)
    expect(ts.scouts.length).toBeGreaterThanOrEqual(2)
    expect(ts.physios.length).toBeGreaterThanOrEqual(1)
  })
})
