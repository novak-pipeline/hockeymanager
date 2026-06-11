/**
 * Calibration regression guard. The full engine's event rates are driven by
 * `@calibrate` targets derived from real NHL play-by-play; this test sims a
 * batch of games and asserts each event type lands near its NHL target, so a
 * future change to the engine that drifts the numbers off the data fails here.
 *
 * The second block guards the DIRECTOR's sequence rhythm: offsides, icings,
 * total whistle cadence, zone-time shares, and the rush-shot share must track
 * the SequenceTargets the director samples from (real NHL data when present,
 * the NHL-shaped fallbacks otherwise).
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { isEvent } from '@domain'
import { emptyTelemetry, fullSimGame, sequenceTargets } from './fullSim'
import { CALIBRATION_TARGETS } from '@calibrate'

function resolverFor(data: ReturnType<typeof generateLeague>) {
  return (id: PlayerId): Player => {
    const p = data.players.get(id)
    if (!p) throw new Error(`unknown player ${id}`)
    return p
  }
}

describe('full-sim calibration', () => {
  it('event rates track the NHL-derived targets', () => {
    const data = generateLeague({ seed: 99 })
    const resolve = resolverFor(data)
    const teams = data.league.teams
    const counts: Record<string, number> = {}
    const games = 40
    for (let i = 0; i < games; i++) {
      const home = data.teams.get(teams[i % teams.length])!
      const away = data.teams.get(teams[(i + 1) % teams.length])!
      const out = fullSimGame(home, away, resolve, { seed: 5000 + i })
      for (const e of out.stream) counts[e.type] = (counts[e.type] ?? 0) + 1
    }
    const per = (t: string): number => (counts[t] ?? 0) / (games * 2)
    const R = CALIBRATION_TARGETS.perTeamPerGame

    // Measured per-team-per-game rates, printed so retuning has data to work
    // from (vitest shows this only on failure-ish verbose runs; cheap to keep).
    // eslint-disable-next-line no-console
    console.log(
      'full-sim rates/team/game:',
      ['goal', 'shot', 'blockedShot', 'hit', 'takeaway', 'giveaway', 'penalty', 'faceoff', 'pass']
        .map((t) => `${t}=${per(t).toFixed(2)}`)
        .join(' ')
    )

    // Each derived rate should land within 20% of the real-NHL target.
    const near = (got: number, target: number): void => {
      expect(got).toBeGreaterThan(target * 0.8)
      expect(got).toBeLessThan(target * 1.2)
    }
    near(per('goal'), R.goals)
    near(per('shot'), R.shotsOnGoal)
    near(per('blockedShot'), R.blockedShots)
    near(per('hit'), R.hits)
    near(per('takeaway'), R.takeaways)
    near(per('giveaway'), R.giveaways)
    near(per('penalty'), R.penalties)
  }, 240000)
})

describe('sequence rhythm (director vs SequenceTargets)', () => {
  it('whistles, zone time, and rush share track the NHL sequence data', () => {
    const data = generateLeague({ seed: 41 })
    const resolve = resolverFor(data)
    const teams = data.league.teams
    const seq = sequenceTargets()
    const telemetry = emptyTelemetry()
    const games = 8

    // Zone time is measured the way the NHL aggregate was built: from the
    // recorded EVENTS (NHL play-by-play has no breakout-carry rows). Each
    // positional event is classified by rink third from its acting team's
    // attack perspective, and the time to the next event is attributed to
    // that zone — "share of event-activity time".
    let ozTime = 0
    let nzTime = 0
    let dzTime = 0
    for (let i = 0; i < games; i++) {
      const home = data.teams.get(teams[i % teams.length])!
      const away = data.teams.get(teams[(i + 1) % teams.length])!
      const homeRoster = new Set(home.roster)
      const out = fullSimGame(home, away, resolve, { seed: 9100 + i, telemetry })
      let prev: { absT: number; adv: number } | null = null
      for (const ev of out.stream) {
        if (ev.period > 3) continue
        let actor: PlayerId | null = null
        let pos: { x: number; y: number } | null = null
        if (isEvent(ev, 'shot')) {
          actor = ev.shooter
          pos = ev.from
        } else if (isEvent(ev, 'blockedShot')) {
          actor = ev.shooter
          pos = ev.pos
        } else if (isEvent(ev, 'goal')) {
          actor = ev.scorer
          pos = ev.pos
        } else if (isEvent(ev, 'hit')) {
          actor = ev.by
          pos = ev.pos
        } else if (isEvent(ev, 'takeaway')) {
          actor = ev.by
          pos = ev.pos
        } else if (isEvent(ev, 'giveaway')) {
          actor = ev.player
          pos = ev.pos
        } else if (isEvent(ev, 'faceoff')) {
          actor = ev.winner
          pos = ev.pos
        }
        if (actor === null || pos === null) continue
        // Home attacks +x in odd periods (engine convention).
        const homeAttack = ev.period % 2 === 1 ? 1 : -1
        const a = homeRoster.has(actor) ? homeAttack : -homeAttack
        const absT = (ev.period - 1) * 1200 + ev.t
        const adv = pos.x * a
        if (prev) {
          const dt = Math.min(Math.max(absT - prev.absT, 0), 40)
          if (prev.adv > 0.25) ozTime += dt
          else if (prev.adv < -0.25) dzTime += dt
          else nzTime += dt
        }
        prev = { absT, adv }
      }
    }
    const frames = Math.max(1, ozTime + nzTime + dzTime)
    const ozFrames = ozTime
    const nzFrames = nzTime
    const dzFrames = dzTime

    const s = telemetry.stoppages
    const perGame = {
      offside: s.offside / games,
      icing: s.icing / games,
      freeze: s.goalieFreeze / games,
      penalty: s.penalty / games,
      goal: s.goal / games,
      other: s.other / games
    }
    const totalPerGame =
      perGame.offside + perGame.icing + perGame.freeze + perGame.penalty + perGame.goal + perGame.other

    const rushShots = telemetry.shots.filter((sh) => sh.kind === 'rush').length
    const rushShare = rushShots / Math.max(1, telemetry.shots.length)

    const zones = {
      offensive: ozFrames / frames,
      neutral: nzFrames / frames,
      defensive: dzFrames / frames
    }

    // eslint-disable-next-line no-console
    console.log(
      'rhythm/game:',
      Object.entries(perGame)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(' '),
      `total=${totalPerGame.toFixed(1)}`,
      `rushShare=${rushShare.toFixed(3)}`,
      `zones o=${zones.offensive.toFixed(3)} n=${zones.neutral.toFixed(3)} d=${zones.defensive.toFixed(3)}`,
      'beats:',
      JSON.stringify(telemetry.beats)
    )

    // Offsides happen, at a believable per-game rate.
    expect(perGame.offside).toBeGreaterThanOrEqual(1)
    expect(perGame.offside).toBeLessThanOrEqual(8)
    // Icings too.
    expect(perGame.icing).toBeGreaterThanOrEqual(2)
    expect(perGame.icing).toBeLessThanOrEqual(12)
    // Whistle cadence: total stoppages within ±40% of the target mean cadence.
    const targetStops = 3600 / seq.meanSecondsBetweenStoppages
    expect(totalPerGame).toBeGreaterThan(targetStops * 0.6)
    expect(totalPerGame).toBeLessThan(targetStops * 1.4)
    // Zone-time shares by rink third, attacking-team perspective.
    expect(Math.abs(zones.offensive - seq.zoneTimeShare.offensive)).toBeLessThanOrEqual(0.12)
    expect(Math.abs(zones.neutral - seq.zoneTimeShare.neutral)).toBeLessThanOrEqual(0.12)
    expect(Math.abs(zones.defensive - seq.zoneTimeShare.defensive)).toBeLessThanOrEqual(0.12)
    // Rush-shot share (shots within 6s of an entry) tracks the data.
    expect(Math.abs(rushShare - seq.rushShotShare)).toBeLessThanOrEqual(0.15)
    // Every directed beat family actually occurs.
    for (const k of [
      'breakout',
      'regroup',
      'entryCarry',
      'entryDump',
      'entryFailedOffside',
      'cyclePossession',
      'pointShot',
      'seamOneTimer',
      'rushShot',
      'turnoverCounter',
      'faceoff',
      'lineChange'
    ] as const) {
      expect(telemetry.beats[k]).toBeGreaterThan(0)
    }
  }, 240000)
})
