/**
 * DEV ONLY: replays agent games and prints every offside the judge says was
 * missed, with the frames from the entry to the touch (W3 S2, reel S1
 * ozCycleShot "he was offside").
 *
 *   OFFSIDE_REPRO=<save copy>  OR_GAMES=12  npx vitest run src/engine/agent/offside.repro.test.ts
 *     exhibitions on a COPY of a save (user club vs the others, seeds 1000+)
 *   OFFSIDE_REPRO=gen  OR_GAMES=6     the agentSim.test gate's generated-league games
 *   OFFSIDE_REPRO=mod  OR_GAMES=120  [OR_ONLY=<game index>]
 *     the measurement harness's imported-league games (teamPlay.measure.test.ts pairing, seeds 7000+)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { it } from 'vitest'
import type { GameStream, Player, PlayerId } from '@domain'
import { loadModDatabase, validateModDatabase } from '@data'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'
import { framesFromStream, type TPSkater } from '@engine/analysis/teamPlay'
import { judgeOffside, touchesFromStream, whistlesFromStream } from '@engine/analysis/offside'
import { agentSimGame } from './agentSim'

function modDb(): string {
  let dir = resolve(process.cwd())
  for (let i = 0; i < 6; i++) {
    const p = join(dir, 'mods', 'nhl-ehm', 'database.json')
    if (existsSync(p)) return p
    dir = dirname(dir)
  }
  throw new Error('no mods/nhl-ehm/database.json above the cwd')
}

it.skipIf(!process.env.OFFSIDE_REPRO)('offside repro', () => {
  const n = Number(process.env.OR_GAMES ?? 3)
  const only = process.env.OR_ONLY ? Number(process.env.OR_ONLY) : null
  const games: Array<() => GameStream> = []
  if (process.env.OFFSIDE_REPRO === 'gen') {
    // agentSim.test's offside gate: generated league, team k v k+5, seed 940+k
    const data = generateLeague({ seed: 99 })
    const res = (id: PlayerId): Player => data.players.get(id)!
    const teams = data.league.teams
    for (let k = 0; k < n; k++) games.push(() => agentSimGame(data.teams.get(teams[k % teams.length])!, data.teams.get(teams[(k + 5) % teams.length])!, res, { seed: 940 + k }).stream)
  } else if (process.env.OFFSIDE_REPRO === 'mod') {
    const data = loadModDatabase(validateModDatabase(JSON.parse(readFileSync(modDb(), 'utf8'))), { seed: 2029 })
    const res = (id: PlayerId): Player => data.players.get(id)!
    const teams = data.league.teams
    for (let k = 0; k < n; k++) {
      games.push(() => agentSimGame(data.teams.get(teams[(k * 7) % teams.length])!, data.teams.get(teams[(k * 7 + 3 + (k % 5)) % teams.length])!, res, { seed: 7000 + k }).stream)
    }
  } else {
    const buf = readFileSync(process.env.OFFSIDE_REPRO!)
    const json = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8')
    const career = Career.fromSnapshot(JSON.parse(json)) as any
    const { user, others } = career.devClubIds()
    for (let i = 0; i < n; i++) games.push(() => career.devExhibition(user, others[i % others.length], 1000 + i, 'agent').stream)
  }
  const out: string[] = []
  let missed = 0
  games.forEach((play, i) => {
    if (only !== null && only !== i) return
    const stream = play()
    const frames = framesFromStream(stream)
    const r = judgeOffside(frames, whistlesFromStream(stream), touchesFromStream(stream))
    missed += r.missed.length
    out.push(`== game ${i} entries ${r.entries} offside ${r.offsideEntries} whistles ${r.whistles} missed ${r.missed.length}`)
    for (const m of r.missed.slice(0, Number(process.env.OR_PER ?? 2))) {
      out.push(`-- ${m.what}`)
      for (const f of frames) {
        if (f.t < m.entryT - 1.5 || f.t > m.t + 1) continue
        const fmt = (s: TPSkater): string => `${s.id.slice(-4)}${s.id === f.carrier ? '*' : ''}(${s.x.toFixed(1)},${s.y.toFixed(0)})${s.job ? ':' + s.job : ''}`
        out.push(`${f.t.toFixed(2)}${f.live ? '' : ' DEAD'} net${f.homeNetX} puck(${f.puck.x.toFixed(1)},${f.puck.y.toFixed(0)}) H[${f.home.map(fmt).join(' ')}] A[${f.away.map(fmt).join(' ')}]`)
      }
      for (const e of stream) {
        if (e.type === 'frame') continue
        const abs = (e.period - 1) * 1200 + e.t
        if (abs >= m.entryT - 1.5 && abs <= m.t + 1) out.push(`   EV ${abs.toFixed(2)} ${JSON.stringify(e).slice(0, 200)}`)
      }
    }
  })
  out.unshift(`total missed ${missed} in ${only !== null ? 1 : n} games`)
  mkdirSync('.cache', { recursive: true })
  writeFileSync(process.env.OR_OUT ?? '.cache/offside-repro.txt', out.join('\n'))
}, 1_800_000)
