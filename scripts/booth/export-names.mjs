#!/usr/bin/env node
/**
 * export-names.mjs — list every name the booth may need to say, as the exact
 * text the voice engine will be given, for the offline name-bank renderer
 * (scripts/booth/render_names.py).
 *
 *   node scripts/booth/export-names.mjs --mod "K:/Hockey Game/mods/nhl-ehm" > jobs.json
 *   node scripts/booth/export-names.mjs --fictional > jobs.json
 *
 * The spoken text comes from src/render2d/broadcast/pronunciation.ts — the
 * same function the game calls at runtime — so a bank entry's key is exactly
 * what the game looks up. A mod's `pronunciations.json` (PronunciationFile
 * format) is applied when present.
 *
 * Output: { source, entries: [{ text, form, tier, count, example }] }, sorted
 * by tier then frequency. Tiers (lower renders first):
 *   0  NHL-roster surnames        1  NHL-roster full names
 *   2  every other surname
 * Fictional: tier 0 = the vanilla league's names.ts surnames, tier 2 = every
 * surname the youth-intake / draft-class generators (nationNames.ts) can mint.
 * The `example` field is a real display name — the output is mod data and must
 * stay out of git (write it under the mod folder or .cache/).
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const pron = await import(pathToFileURL(join(ROOT, 'src/render2d/broadcast/pronunciation.ts')).href)
const argv = process.argv.slice(2)
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }

/** key -> { text, form, tier, count, example } */
const entries = new Map()
function add(p, tier, file, withFull = true) {
  const s = pron.spokenName(p, file)
  const put = (text, form, t) => {
    const k = `${form}|${text}`
    const cur = entries.get(k)
    if (cur) { cur.count++; cur.tier = Math.min(cur.tier, t) } else entries.set(k, { text, form, tier: t, count: 1, example: p.name })
  }
  put(s.surname, 'surname', tier === 0 ? 0 : 2)
  if (tier === 0 && withFull) put(s.full, 'full', 1)
}

let source
if (argv.includes('--fictional')) {
  source = 'fictional'
  const names = await import(pathToFileURL(join(ROOT, 'src/data/names.ts')).href)
  const nn = await import(pathToFileURL(join(ROOT, 'src/data/nationNames.ts')).href)
  // names.ts (the vanilla league's surnames) first: tier 0.
  for (const last of names.LAST_NAMES) add({ id: last, name: `X ${last}` }, 0, null, false)
  // Generated surnames: every authored pool entry, plus the generators'
  // reachable outputs (sampled until they stop producing new names).
  let seed = 12345
  const r = { next() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 } }
  for (const [key, pool] of Object.entries(nn.NATION_POOLS)) {
    const seen = new Set(pool.last)
    if (pool.surname) {
      let stale = 0
      while (stale < 20000) { const s = pool.surname(r); if (seen.has(s)) stale++; else { seen.add(s); stale = 0 } }
    }
    for (const last of seen) {
      if (nn.FAMOUS_HOCKEY_SURNAMES.has(last)) continue
      add({ id: last, name: `X ${last}`, nationality: pool.nation }, 2, null)
    }
    void key
  }
} else {
  const modDir = arg('--mod')
  if (!modDir) { console.error('usage: export-names.mjs --mod <modDir> | --fictional'); process.exit(2) }
  source = `mod:${modDir.replace(/\\/g, '/').split('/').pop()}`
  const db = JSON.parse(readFileSync(join(modDir, 'database.json'), 'utf8'))
  const pf = join(modDir, 'pronunciations.json')
  const file = existsSync(pf) ? JSON.parse(readFileSync(pf, 'utf8')) : null
  const seen = new Set()
  const visitPlayers = (players, tier) => {
    for (const p of players ?? []) {
      if (!p || typeof p.name !== 'string') continue
      const id = p.externalId ?? p.name
      if (seen.has(`${tier}|${id}`)) continue
      seen.add(`${tier}|${id}`)
      add({ id, name: p.name, nationality: p.nationality, pronunciation: p.pronunciation, externalId: p.externalId }, tier, file)
    }
  }
  // NHL conference rosters first (tier 0), then affiliates + every other league.
  for (const c of db.conferences ?? []) for (const d of c.divisions ?? []) for (const t of d.teams ?? []) visitPlayers(t.players, 0)
  const walk = (o) => {
    if (Array.isArray(o)) { for (const v of o) walk(v); return }
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o.players)) visitPlayers(o.players, 2)
    for (const [k, v] of Object.entries(o)) if (k !== 'players' && k !== 'history') walk(v)
  }
  walk(db)
}

const out = [...entries.values()].sort((a, b) => a.tier - b.tier || b.count - a.count || a.text.localeCompare(b.text))
process.stdout.write(JSON.stringify({ source, generated: new Date().toISOString(), entries: out }))
console.error(`[names] ${source}: ${out.length} entries (` +
  [0, 1, 2].map((t) => `tier ${t}: ${out.filter((e) => e.tier === t).length}`).join(', ') + ')')
