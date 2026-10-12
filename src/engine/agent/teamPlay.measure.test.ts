/**
 * W3 measurement harness (dev only, skipped unless TP_MEASURE=1): sims seeded
 * agent-engine games on the imported real-roster league (mods/nhl-ehm, else
 * the generated league) and prints the team-play detectors (VT13 aimless,
 * VT14 coverage, VT16 crease camping, job flips) next to the calibration
 * numbers a slice must not move the wrong way (goals, shots, PP).
 *
 *   TP_MEASURE=1 TP_GAMES=30 npx vitest run src/engine/agent/teamPlay.measure.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { it } from 'vitest'
import type { Player, PlayerId } from '@domain'
import { generateLeague } from '@data/generate'
import { loadModDatabase, validateModDatabase } from '@data'
import { framesFromStream, judgeTeamPlay, per60, SIM_GATES } from '@engine/analysis/teamPlay'
import { agentSimGame } from './agentSim'

function findModDb(): string | null {
  if (process.env.TP_VANILLA) return null
  let dir = resolve(process.cwd())
  for (let i = 0; i < 6; i++) {
    const p = join(dir, 'mods', 'nhl-ehm', 'database.json')
    if (existsSync(p)) return p
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

it.skipIf(!process.env.TP_MEASURE)('team-play + calibration measurement', () => {
  const games = Number(process.env.TP_GAMES ?? 30)
  const dbPath = findModDb()
  const data = dbPath ? loadModDatabase(validateModDatabase(JSON.parse(readFileSync(dbPath, 'utf8'))), { seed: 2029 }) : generateLeague({ seed: 99 })
  const res = (id: PlayerId): Player => data.players.get(id)!
  const teams = data.league.teams
  let goals = 0
  let shots = 0
  let ppGoals = 0
  let shGoals = 0
  let pens = 0
  let hits = 0
  let liveMin = 0
  let aimless = 0
  let aimOwn = 0
  let doubles = 0
  let farSide = 0
  let ignored = 0
  let camping = 0
  let flips = 0
  let jobMin = 0
  const ex: string[] = []
  for (let i = 0; i < games; i++) {
    const home = data.teams.get(teams[(i * 7) % teams.length])!
    const away = data.teams.get(teams[(i * 7 + 3 + (i % 5)) % teams.length])!
    const out = agentSimGame(home, away, res, { seed: 7000 + i })
    for (const e of out.stream) {
      if (e.type === 'goal') {
        goals++
        if (e.strength === 'pp') ppGoals++
        if (e.strength === 'sh') shGoals++
      } else if (e.type === 'shot') shots++
      else if (e.type === 'penalty') pens++
      else if (e.type === 'hit') hits++
    }
    const r = judgeTeamPlay(framesFromStream(out.stream), { gates: SIM_GATES })
    liveMin += r.liveMin
    aimless += r.aimless.length
    aimOwn += r.aimlessOwn
    doubles += r.doubles.length
    farSide += r.farSide.length
    ignored += r.ignored.length
    camping += r.camping.length
    flips += r.jobFlips
    jobMin += r.jobPlayerMin
    if (i < 2) for (const c of [...r.aimless.slice(0, 2), ...r.doubles.slice(0, 2), ...r.farSide.slice(0, 2), ...r.ignored.slice(0, 2), ...r.camping.slice(0, 1)]) ex.push(`g${i} ${c.what}`)
  }
  const tg = games * 2
  const lines = [
    `league: ${dbPath ? 'imported' : 'generated'} - ${games} games (seeds 7000-${7000 + games - 1})`,
    `calibration/team-game: goals ${(goals / tg).toFixed(2)} shots ${(shots / tg).toFixed(1)} ppGoals ${(ppGoals / tg).toFixed(2)} shGoals ${(shGoals / tg).toFixed(2)} penalties ${(pens / tg).toFixed(2)} hits ${(hits / tg).toFixed(1)} PP% ${(pens ? (ppGoals / pens) * 100 : 0).toFixed(1)}`,
    `team play per 60 live min: VT13 aimless ${per60(aimless, liveMin).toFixed(2)} (own net ${per60(aimOwn, liveMin).toFixed(2)}) - VT14 doubles ${per60(doubles, liveMin).toFixed(2)} farSide ${per60(farSide, liveMin).toFixed(2)} ignored ${per60(ignored, liveMin).toFixed(2)} - VT16 camping ${per60(camping, liveMin).toFixed(2)} - job flips ${(flips / Math.max(jobMin, 1e-9)).toFixed(2)}/player-min (live ${liveMin.toFixed(0)} min)`,
    ...ex
  ]
  mkdirSync('.cache', { recursive: true })
  writeFileSync(join('.cache', `tp-measure${process.env.TP_TAG ? '-' + process.env.TP_TAG : ''}.txt`), lines.join('\n') + '\n')
}, 3_600_000)

