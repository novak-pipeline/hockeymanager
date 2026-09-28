/**
 * Watched-game engines are robust to ANY tactic combination.
 *
 * The owner's save recorded watched games of 7-15 and 10-21 on 159 shots:
 * AI coach profiles move the offence/risk sliders together (shot eagerness,
 * shooting, pace, pass risk, pinch...), and small per-slider effects stacked
 * into a blow-up. Both watched engines (the classic director engine and the
 * agent engine) now bound the COMBINED tactic effect (fullSim.budgetTactics)
 * and read ratings on the game's own level, so:
 *
 *   - every slider at 1.0 with the most open systems (2-1-2, man, 1-3-1,
 *     aggressive PK, line matching), and every slider at 0.0 with the most
 *     closed ones (trap, zone): shots <= 42 and goals <= 4.5 per team-game
 *     (the NHL's extremes);
 *   - neutral tactics: inside the calibration tolerance (shots within 20%,
 *     goals within 25% of the NHL targets).
 *
 * Runs on the IMPORTED real-roster league (what the owner plays), found by
 * walking up from the cwd to mods/nhl-ehm/database.json; skipped when the mod
 * isn't installed (a fresh clone).
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import type { Player, PlayerId, Team } from '@domain'
import { loadModDatabase, validateModDatabase } from '@data'
import { CALIBRATION_TARGETS } from '@calibrate'
import { fullSimGame } from './fullSim'
import { agentSimGame } from '@engine/agent/agentSim'

function findModDb(): string | null {
  let dir = resolvePath(process.cwd())
  for (let i = 0; i < 6; i++) {
    const p = join(dir, 'mods', 'nhl-ehm', 'database.json')
    if (existsSync(p)) return p
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

const SLIDERS = ['aggressiveness', 'backchecking', 'gapControl', 'puckPressure', 'hitting', 'passing', 'shooting', 'dumping', 'mentality'] as const

function withTactics(t: Team, v: 0 | 1 | null): Team {
  if (v === null) return t
  const tac = JSON.parse(JSON.stringify(t.tactics)) as Record<string, unknown> & { tempo: Record<string, number> }
  for (const k of Object.keys(tac.tempo)) tac.tempo[k] = v
  for (const k of SLIDERS) tac[k] = v
  Object.assign(
    tac,
    v === 1
      ? { forecheck: '2-1-2', dZoneCoverage: 'man', specialTeams: { powerPlay: '1-3-1', penaltyKill: 'aggressive' }, lineMatching: true }
      : { forecheck: 'trap', dZoneCoverage: 'zone', specialTeams: { powerPlay: 'umbrella', penaltyKill: 'box' }, lineMatching: false }
  )
  return { ...t, tactics: tac as unknown as Team['tactics'] }
}

const dbPath = findModDb()

describe.skipIf(!dbPath)('watched engines under extreme tactics (imported league)', () => {
  const data = dbPath ? loadModDatabase(validateModDatabase(JSON.parse(readFileSync(dbPath, 'utf8'))), { seed: 2029 }) : null
  const R = CALIBRATION_TARGETS.perTeamPerGame

  const measure = (engine: 'agent' | 'full', v: 0 | 1 | null, games: number): { shots: number; goals: number } => {
    const d = data!
    const resolve = (id: PlayerId): Player => d.players.get(id)!
    const teams = d.league.teams
    let shots = 0
    let goals = 0
    for (let i = 0; i < games; i++) {
      const home = withTactics(d.teams.get(teams[(i * 7) % teams.length])!, v)
      const away = withTactics(d.teams.get(teams[(i * 7 + 3 + (i % 5)) % teams.length])!, v)
      const out = (engine === 'agent' ? agentSimGame : fullSimGame)(home, away, resolve, { seed: 7300 + i })
      shots += out.stream.filter((e) => e.type === 'shot').length
      goals += out.homeGoals + out.awayGoals
    }
    return { shots: shots / (games * 2), goals: goals / (games * 2) }
  }

  for (const engine of ['full', 'agent'] as const) {
    const games = engine === 'agent' ? 16 : 40
    it(`${engine}: every slider at 1.0 or 0.0 stays inside NHL extremes; neutral stays calibrated`, () => {
      for (const v of [1, 0] as const) {
        const m = measure(engine, v, games)
        const at = `${engine} sliders=${v}: ${m.shots.toFixed(1)} shots, ${m.goals.toFixed(2)} goals per team-game`
        expect(m.shots, at).toBeLessThanOrEqual(42)
        expect(m.goals, at).toBeLessThanOrEqual(4.5)
        expect(m.shots, at).toBeGreaterThan(18)
      }
      const n = measure(engine, null, games + 4)
      const at = `${engine} neutral: ${n.shots.toFixed(1)} shots, ${n.goals.toFixed(2)} goals per team-game`
      expect(n.shots, at).toBeGreaterThan(R.shotsOnGoal * 0.8)
      expect(n.shots, at).toBeLessThan(R.shotsOnGoal * 1.2)
      expect(n.goals, at).toBeGreaterThan(R.goals * 0.75)
      expect(n.goals, at).toBeLessThan(R.goals * 1.25)
    }, 600_000)
  }
})
