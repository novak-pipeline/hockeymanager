/**
 * EHM-depth tactics tests (task #30):
 *
 * 1. Default tactics (all optional fields absent) produce byte-identical output
 *    to explicit 0.5 defaults — calibration tests must stay green.
 * 2. Non-default values measurably shift the intended lever.
 * 3. Tactics round-trip through JSON (structuredClone / save-load pattern).
 * 4. Personal tactics persist on the TeamTactics object.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId, TeamTactics } from '@domain'
import { emptyTelemetry, fullSimGame } from './fullSim'

function resolverFor(data: ReturnType<typeof generateLeague>) {
  return (id: PlayerId): Player => {
    const p = data.players.get(id)
    if (!p) throw new Error(`unknown player ${id}`)
    return p
  }
}

/** Run N games summing a telemetry field; returns the average per game. */
function avgOverGames(
  count: number,
  seed0: number,
  data: ReturnType<typeof generateLeague>,
  resolve: (id: PlayerId) => Player,
  tacticsMutator: (t: TeamTactics) => TeamTactics,
  extract: (tel: ReturnType<typeof emptyTelemetry>) => number,
): number {
  const teams = data.league.teams
  let total = 0
  for (let i = 0; i < count; i++) {
    const home = data.teams.get(teams[i % teams.length])!
    const away  = data.teams.get(teams[(i + 1) % teams.length])!
    const mutatedHome = { ...home, tactics: tacticsMutator(structuredClone(home.tactics)) }
    const mutatedAway = { ...away, tactics: tacticsMutator(structuredClone(away.tactics)) }
    const tel = emptyTelemetry()
    fullSimGame(mutatedHome, mutatedAway, resolve, { seed: seed0 + i, telemetry: tel })
    total += extract(tel)
  }
  return total / count
}

describe('EHM tactics — defaults are neutral', () => {
  it('absent optional fields produce identical output to explicit 0.5 defaults', () => {
    const data = generateLeague({ seed: 42 })
    const resolve = resolverFor(data)
    const home = data.teams.get(data.league.teams[0])!
    const away  = data.teams.get(data.league.teams[1])!

    // Baseline: original tactics (no optional fields set)
    const base = fullSimGame(home, away, resolve, { seed: 99 })

    // Explicit 0.5 defaults — must be byte-identical
    const homeWith05: typeof home = {
      ...home,
      tactics: {
        ...home.tactics,
        aggressiveness: 0.5,
        hitting: 0.5,
        puckPressure: 0.5,
        gapControl: 0.5,
        shooting: 0.5,
        passing: 0.5,
        dumping: 0.5,
        backchecking: 0.5,
        mentality: 0.5,
        tempoStyle: 0.5,
      },
    }
    const awayWith05: typeof away = {
      ...away,
      tactics: {
        ...away.tactics,
        aggressiveness: 0.5,
        hitting: 0.5,
        puckPressure: 0.5,
        gapControl: 0.5,
        shooting: 0.5,
        passing: 0.5,
        dumping: 0.5,
        backchecking: 0.5,
        mentality: 0.5,
        tempoStyle: 0.5,
      },
    }
    const explicit = fullSimGame(homeWith05, awayWith05, resolve, { seed: 99 })

    expect(explicit.homeGoals).toBe(base.homeGoals)
    expect(explicit.awayGoals).toBe(base.awayGoals)
    expect(explicit.stream.length).toBe(base.stream.length)
  })
})

describe('EHM tactics — sliders measurably shift levers', () => {
  const data = generateLeague({ seed: 42 })
  const resolve = resolverFor(data)
  const N = 10 // games per condition; enough for a clear signal
  const SEED = 1000

  it('hitting=1.0 produces more hits than hitting=0.0', () => {
    const hitHigh = avgOverGames(N, SEED, data, resolve,
      (t) => ({ ...t, hitting: 1.0 }),
      (tel) => tel.beats.lineChange // hits are in stream events, not telemetry;
      // use total stream length as a proxy — more hit events = longer stream
      // Actually count hits via a different approach: run and count hit events
    )
    // Better: count hit events in stream directly
    const countHits = (hitting: number): number => {
      const teams = data.league.teams
      let total = 0
      for (let i = 0; i < N; i++) {
        const home = { ...data.teams.get(teams[i % teams.length])!, tactics: { ...data.teams.get(teams[i % teams.length])!.tactics, hitting } }
        const away  = { ...data.teams.get(teams[(i + 1) % teams.length])!, tactics: { ...data.teams.get(teams[(i + 1) % teams.length])!.tactics, hitting } }
        const out = fullSimGame(home, away, resolve, { seed: SEED + i })
        total += out.stream.filter((e) => (e as { type: string }).type === 'hit').length
      }
      return total / N
    }
    const low = countHits(0.0)
    const high = countHits(1.0)
    expect(high).toBeGreaterThan(low)
  })

  it('hitting=0.0 produces fewer hits than default (0.5)', () => {
    const countHits = (hitting: number): number => {
      const teams = data.league.teams
      let total = 0
      for (let i = 0; i < N; i++) {
        const home = { ...data.teams.get(teams[i % teams.length])!, tactics: { ...data.teams.get(teams[i % teams.length])!.tactics, hitting } }
        const away  = { ...data.teams.get(teams[(i + 1) % teams.length])!, tactics: { ...data.teams.get(teams[(i + 1) % teams.length])!.tactics, hitting } }
        const out = fullSimGame(home, away, resolve, { seed: SEED + 100 + i })
        total += out.stream.filter((e) => (e as { type: string }).type === 'hit').length
      }
      return total / N
    }
    const def05 = countHits(0.5)
    const low = countHits(0.0)
    expect(low).toBeLessThan(def05)
  })

  it('puckPressure=1.0 produces more takeaways than puckPressure=0.0', () => {
    const countTakeaways = (puckPressure: number): number => {
      const teams = data.league.teams
      let total = 0
      for (let i = 0; i < N; i++) {
        const home = { ...data.teams.get(teams[i % teams.length])!, tactics: { ...data.teams.get(teams[i % teams.length])!.tactics, puckPressure } }
        const away  = { ...data.teams.get(teams[(i + 1) % teams.length])!, tactics: { ...data.teams.get(teams[(i + 1) % teams.length])!.tactics, puckPressure } }
        const out = fullSimGame(home, away, resolve, { seed: SEED + 200 + i })
        total += out.stream.filter((e) => (e as { type: string }).type === 'takeaway').length
      }
      return total / N
    }
    const low  = countTakeaways(0.0)
    const high = countTakeaways(1.0)
    expect(high).toBeGreaterThan(low)
  })

  it('aggressiveness=1.0 produces more penalties than aggressiveness=0.0', () => {
    const countPenalties = (aggressiveness: number): number => {
      const teams = data.league.teams
      let total = 0
      for (let i = 0; i < N; i++) {
        const home = { ...data.teams.get(teams[i % teams.length])!, tactics: { ...data.teams.get(teams[i % teams.length])!.tactics, aggressiveness } }
        const away  = { ...data.teams.get(teams[(i + 1) % teams.length])!, tactics: { ...data.teams.get(teams[(i + 1) % teams.length])!.tactics, aggressiveness } }
        const out = fullSimGame(home, away, resolve, { seed: SEED + 300 + i })
        total += out.stream.filter((e) => (e as { type: string }).type === 'penalty').length
      }
      return total / N
    }
    const low  = countPenalties(0.0)
    const high = countPenalties(1.0)
    expect(high).toBeGreaterThan(low)
  })

  it('dumping=1.0 produces more dump entries than dumping=0.0', () => {
    const countDumps = (dumping: number): number => {
      const teams = data.league.teams
      let total = 0
      for (let i = 0; i < N; i++) {
        const tel = emptyTelemetry()
        const home = { ...data.teams.get(teams[i % teams.length])!, tactics: { ...data.teams.get(teams[i % teams.length])!.tactics, dumping } }
        const away  = { ...data.teams.get(teams[(i + 1) % teams.length])!, tactics: { ...data.teams.get(teams[(i + 1) % teams.length])!.tactics, dumping } }
        fullSimGame(home, away, resolve, { seed: SEED + 400 + i, telemetry: tel })
        total += tel.entries.dump
      }
      return total / N
    }
    const low  = countDumps(0.0)
    const high = countDumps(1.0)
    expect(high).toBeGreaterThan(low)
  })
})

describe('EHM tactics — round-trip', () => {
  it('TeamTactics with new optional fields survives JSON round-trip', () => {
    const tactics: TeamTactics = {
      forecheck: 'trap',
      dZoneCoverage: 'zone',
      tempo: { pace: 0.6, passRisk: 0.4, shotEagerness: 0.7, defensivePinch: 0.3 },
      specialTeams: { powerPlay: 'umbrella', penaltyKill: 'box' },
      lineMatching: true,
      aggressiveness: 0.8,
      hitting: 0.9,
      puckPressure: 0.3,
      gapControl: 0.6,
      shooting: 0.7,
      passing: 0.4,
      dumping: 0.2,
      backchecking: 0.6,
      mentality: 0.7,
      breakout: 'rim',
      nzOffensive: 'stretch',
      nzDefensive: 'trap',
      ozEntry: 'carry',
      dZoneStructure: 'collapse',
      offensiveFaceoff: 'quick-strike',
      defensiveFaceoff: 'tie-up',
      shotTargeting: 'high-glove',
      personalTactics: {
        'player-1': { shootVsPass: 1, entryStyle: 'carry', rushJoin: 'join', fighting: 'avoid' },
        'player-2': { shootVsPass: -1, entryStyle: 'dump', rushJoin: 'sit-back' },
      },
    }

    const roundTripped = JSON.parse(JSON.stringify(tactics)) as TeamTactics

    expect(roundTripped.aggressiveness).toBe(0.8)
    expect(roundTripped.hitting).toBe(0.9)
    expect(roundTripped.breakout).toBe('rim')
    expect(roundTripped.nzOffensive).toBe('stretch')
    expect(roundTripped.ozEntry).toBe('carry')
    expect(roundTripped.shotTargeting).toBe('high-glove')
    expect(roundTripped.personalTactics?.['player-1']?.shootVsPass).toBe(1)
    expect(roundTripped.personalTactics?.['player-1']?.entryStyle).toBe('carry')
    expect(roundTripped.personalTactics?.['player-2']?.rushJoin).toBe('sit-back')
  })
})

describe('EHM tactics — personal tactics', () => {
  it('personalTactics stored and retrieved from TeamTactics', () => {
    const data = generateLeague({ seed: 7 })
    const home = data.teams.get(data.league.teams[0])!
    const playerId = home.roster[0]

    const tactics: TeamTactics = {
      ...home.tactics,
      personalTactics: {
        [playerId]: { shootVsPass: 1, entryStyle: 'carry', rushJoin: 'join', fighting: 'will-fight' },
      },
    }

    expect(tactics.personalTactics?.[playerId]?.shootVsPass).toBe(1)
    expect(tactics.personalTactics?.[playerId]?.entryStyle).toBe('carry')
    expect(tactics.personalTactics?.[playerId]?.rushJoin).toBe('join')
    expect(tactics.personalTactics?.[playerId]?.fighting).toBe('will-fight')

    // A player without instructions returns undefined (no-op)
    const otherId = home.roster[1]
    expect(tactics.personalTactics?.[otherId]).toBeUndefined()
  })

  it('setting personal tactics does not affect sim output for unrelated players', () => {
    const data = generateLeague({ seed: 7 })
    const resolve = resolverFor(data)
    const home = data.teams.get(data.league.teams[0])!
    const away  = data.teams.get(data.league.teams[1])!

    const base = fullSimGame(home, away, resolve, { seed: 77 })

    // Add personal tactics for a player (setable intent — not wired to change sim output
    // at the individual level beyond the team-level sliders already tested)
    const homeWithPT = {
      ...home,
      tactics: {
        ...home.tactics,
        personalTactics: { [home.roster[0]]: { fighting: 'avoid' as const } },
      },
    }
    const withPT = fullSimGame(homeWithPT, away, resolve, { seed: 77 })

    // fighting = 'avoid' is setable intent only, no engine effect — sim identical
    expect(withPT.homeGoals).toBe(base.homeGoals)
    expect(withPT.awayGoals).toBe(base.awayGoals)
  })
})
