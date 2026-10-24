/**
 * HEAT SAMPLE HARNESS — watches the user's games through a stretch of a real
 * career and dumps every rivalry-heat card the live story put on screen, with
 * what the clubs and the men carried in, so the lines can be READ against the
 * game state that produced them.
 *
 * Self-skips in the normal suite. Run on demand:
 *   HEAT_RUN=1 npx vitest run src/engine/story/heatSample.harness.test.ts --no-file-parallelism
 * Env: HEAT_GAMES (watched games, default 40), HEAT_OUT (default ./heat-sample.txt),
 *      AP_MOD_DB (the imported league; generated league when absent), AP_SEED.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateModDatabase, loadModDatabase } from '@data'
import { generateLeague } from '@data/generate'
import { Career } from '../career/career'
import { liveHeatOf, planLiveStory } from './liveStory'

const MOD_DB = process.env.AP_MOD_DB ?? join(process.cwd(), 'mods', 'nhl-ehm', 'database.json')
const SEED = Number(process.env.AP_SEED ?? 2031)

describe.skipIf(!process.env.HEAT_RUN)('heat sample — rivalry heat on real game state', () => {
  it('dumps the heat cards of a stretch of watched games', () => {
    const data = existsSync(MOD_DB)
      ? loadModDatabase(validateModDatabase(JSON.parse(readFileSync(MOD_DB, 'utf8'))), { seed: SEED })
      : generateLeague({ seed: SEED })
    const tid = data.league.teams[0]!
    const career = new Career(data, SEED, tid)
    const games = Number(process.env.HEAT_GAMES ?? 40)
    const out: string[] = []
    let watchedN = 0
    let cards = 0
    let fights = 0
    for (let guard = 0; watchedN < games && guard < 4000; guard++) {
      if (career.draftPending()) career.autoDraft()
      if (career.captainsPending()) career.nameCaptainByCoach()
      const w = career.seasonPhase === 'regularSeason' ? career.watchNext() : null
      if (!w) {
        if (!career.step()) break
        continue
      }
      watchedN++
      const f = career.getBroadcastContext()?.liveStory
      if (!f) continue
      const heat = liveHeatOf(w.stream, f)
      fights += heat.fights
      const plan = planLiveStory(w.stream, f)
      const beats = plan.beats.filter((b) => b.kind === 'badBlood' || b.kind === 'heat')
      const carried = f.heat
      out.push(`── ${f.gameKey}  ${f.awayAbbr} @ ${f.homeAbbr}  carried team heat ${(carried?.team ?? 0).toFixed(2)}, ${carried?.pairs.length ?? 0} pairs; tonight peak ${heat.peak.toFixed(2)}, ${heat.incidents.length} incidents, ${heat.pim} PIM, ${heat.fights} fights`)
      for (const p of carried?.pairs ?? []) {
        const n = (id: string): string => f.players.find((x) => x.id === id)?.name ?? id
        out.push(`   carried: ${p.kind} ${n(p.byId)} → ${n(p.onId)} on ${p.date}${p.seasonTail}, ${p.meetingsSince} meetings since, heat ${p.heat.toFixed(2)}${p.infraction ? `, ${p.infraction}` : ''}${p.down ? ', down' : ''}`)
      }
      for (const b of beats) {
        cards++
        out.push(`   [${b.title}] P${b.at < 1200 ? 1 : b.at < 2400 ? 2 : 3} ${b.text}`)
      }
    }
    out.unshift(`${watchedN} watched games, ${cards} heat cards, ${fights} fights in them\n`)
    writeFileSync(process.env.HEAT_OUT ?? 'heat-sample.txt', out.join('\n'))
    expect(watchedN).toBeGreaterThan(0)
  }, 3_600_000)
})
