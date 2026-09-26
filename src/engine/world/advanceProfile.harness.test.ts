/**
 * Where does a regular-season day go? Wraps every Career method and reports
 * inclusive time for methods called directly under step() (depth 2), over N
 * days of the first season on the imported league. Self-skipping:
 *   PROF_RUN=1 npx vitest run src/engine/world/advanceProfile.harness.test.ts --silent=false
 */
import { it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateModDatabase, loadModDatabase } from '@data'
import { Career } from '@engine/career/career'

const MOD_DB = join(process.cwd(), 'mods', 'nhl-ehm', 'database.json')

it.skipIf(!process.env.PROF_RUN || !existsSync(MOD_DB))('profile advance', () => {
  const data = loadModDatabase(validateModDatabase(JSON.parse(readFileSync(MOD_DB, 'utf8'))), { seed: 2029 })
  const career = new Career(data, 2029, data.league.teams[3]!)
  const proto = Career.prototype as unknown as Record<string, unknown>
  const acc = new Map<string, number>()
  let depth = 0
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name)
    if (!d || typeof d.value !== 'function' || name === 'constructor') continue
    const fn = d.value as (...a: unknown[]) => unknown
    proto[name] = function (this: unknown, ...a: unknown[]) {
      depth++
      const t0 = performance.now()
      try { return fn.apply(this, a) } finally {
        const dt = performance.now() - t0
        if (depth === 3 || depth === 4) acc.set(depth + ":" + name, (acc.get(depth + ":" + name) ?? 0) + dt)
        depth--
      }
    }
  }
  const days = Number(process.env.PROF_DAYS ?? 60)
  let n = 0; let total = 0
  while (n < days) {
    const dash = career.getDashboard()
    if (dash.captainsPending) { const c = career.getSquad().rows.filter((p) => p.position !== 'G')[0]; if (c) career.setCaptain(c.playerId); continue }
    if (dash.staffMeetingDue) career.delegateStaffMeeting()
    if (dash.scoutMeetingDue) career.delegateScoutMeeting()
    if (career.seasonPhase !== 'regularSeason') break
    acc.clear()
    const t0 = performance.now(); career.step(); total += performance.now() - t0; n++
    if (n === 1) { (globalThis as any).__acc = new Map() }
    for (const [k, v] of acc) (globalThis as any).__acc.set(k, ((globalThis as any).__acc.get(k) ?? 0) + v)
  }
  const rows = [...(globalThis as any).__acc.entries() as Iterable<[string, number]>].sort((a, b) => b[1] - a[1]).slice(0, 25)
  console.log(`days ${n}  ms/day ${(total / n).toFixed(1)}  world players ${career.data.players.size}`)
  for (const [k, v] of rows) console.log(`${k.padEnd(40)} ${(v / n).toFixed(2)} ms/day`)
}, 1_800_000)
