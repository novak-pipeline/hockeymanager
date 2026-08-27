/**
 * PROSE AUDIT HARNESS — sims N seasons and collects EVERY string the game
 * writes to the player (inbox headlines, bodies, feed posts), then measures
 * **repetition**: the most-reused sentences and the most-reused phrases once
 * names and numbers are masked out.
 *
 * It exists so "the writing reads better now" can be replaced with a number.
 * Run it before a prose change and after; the tables are directly comparable.
 *
 * Excluded from the normal suite (it sims minutes) — run it explicitly:
 *   PA_RUN=1 PA_SEASONS=4 PATH="/c/Program Files/nodejs:$PATH" \
 *     npx vitest run src/engine/story/proseAudit.harness.test.ts --no-file-parallelism
 *
 * Config via env: PA_SEASONS (default 4) · PA_SEED (default 2029) · PA_TAG (report name)
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateLeague } from '@data/generate'
import type { LeagueData } from '@data/generate'
import { validateModDatabase, loadModDatabase } from '@data'
import { isBreakingNews } from '@domain'
import { Career } from '../career/career'
import { runAutopilot } from '../career/autopilot/autopilot'

const SEED = Number(process.env.PA_SEED ?? 2029)
const SEASONS = Number(process.env.PA_SEASONS ?? 4)
const MOD_DB = join(process.cwd(), 'mods', 'nhl-ehm', 'database.json')

function loadLeague(): { data: LeagueData; source: string } {
  if (existsSync(MOD_DB)) {
    try {
      const db = validateModDatabase(JSON.parse(readFileSync(MOD_DB, 'utf8')))
      return { data: loadModDatabase(db, { seed: SEED }), source: `imported: ${db.meta?.name ?? 'nhl-ehm'}` }
    } catch {
      /* fall through to vanilla */
    }
  }
  return { data: generateLeague({ seed: SEED }), source: 'vanilla generated league' }
}

/** Mask the parts that SHOULD differ every time, leaving the authored skeleton. */
function skeleton(s: string): string {
  return s
    .replace(/\d[\d,.:%$]*/g, '#')
    // Proper nouns (and any Capitalised run) collapse to one token so
    // "Sidney Crosby is heating up" and "Jake Guentzel is heating up" match.
    .replace(/\b[A-Z][a-zA-Z'’-]*(?:\s+[A-Z][a-zA-Z'’-]*)*/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
}

function sentences(s: string): string[] {
  return s
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 12)
}

function ngrams(words: string[], n: number): string[] {
  const out: string[] = []
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' '))
  return out
}

describe.skipIf(!process.env.PA_RUN)('prose audit', () => {
  it(`measures repetition across ${SEASONS} season(s)`, () => {
    const { data, source } = loadLeague()
    const teamIdx = Math.min(3, data.league.teams.length - 1)
    const career = new Career(data, SEED, data.league.teams[teamIdx]!)
    career.startAtOffseason()

    type Beat = {
      cat: string; head: string; body: string; year: number; day: number; phase: string
      channel?: string; salience?: number; rare?: boolean
    }
    const beats: Beat[] = []
    const self = career as unknown as {
      pushNews: (...a: unknown[]) => unknown
      curatedInboxNews: () => Array<{ id: string; headline: string; body: string; category: string; salience?: number; rare?: boolean; channel?: string; reach?: string }>
      year: number
      currentDay: number
      phase: string
      standings: Map<unknown, { gamesPlayed: number }>
    }
    const orig = self.pushNews.bind(career)
    self.pushNews = (...a: unknown[]) => {
      const refs = (a[3] ?? {}) as { channel?: string; salience?: number; rare?: boolean }
      beats.push({
        cat: String(a[0] ?? ''),
        head: String(a[1] ?? ''),
        body: String(a[2] ?? ''),
        year: self.year,
        day: self.currentDay,
        phase: self.phase,
        ...(refs.channel !== undefined ? { channel: refs.channel } : {}),
        ...(refs.salience !== undefined ? { salience: refs.salience } : {}),
        ...(refs.rare !== undefined ? { rare: refs.rare } : {}),
      })
      return orig(...a)
    }

    // What actually reaches the GM's desk: the same curated list the Inbox
    // screen draws. Sampled as the run goes (the raw list is capped and
    // evicts), unioned by id.
    const inbox = new Map<string, { headline: string; body: string; category: string; salience?: number; rare?: boolean; channel?: string; reach?: string }>()
    const sampleInbox = (): void => {
      for (const n of self.curatedInboxNews()) {
        if (!inbox.has(n.id)) inbox.set(n.id, n)
      }
    }

    // Anything written BEFORE a single game is played can only be asserting
    // facts the save does not have. Capture that window separately (A2).
    const preGame = new Set<number>()
    let gamesSeen = 0
    const markPreGame = () => {
      gamesSeen = [...self.standings.values()].reduce((n, s) => n + s.gamesPlayed, 0)
      if (gamesSeen === 0) for (let i = 0; i < beats.length; i++) preGame.add(i)
    }
    markPreGame()

    const trace = runAutopilot(career, {
      seasons: SEASONS,
      source,
      onEvent: () => {
        if (gamesSeen === 0) markPreGame()
        sampleInbox()
      },
    })
    const played = Math.max(1, trace.meta.seasonsPlayed)

    /* -- repetition tables -- */
    const sentCount = new Map<string, { n: number; sample: string }>()
    const gramCount = new Map<string, number>()
    let totalSentences = 0
    for (const b of beats) {
      for (const raw of sentences(`${b.head}. ${b.body}`)) {
        totalSentences++
        const k = skeleton(raw)
        const prev = sentCount.get(k)
        if (prev) prev.n++
        else sentCount.set(k, { n: 1, sample: raw })
        const words = k.split(' ').filter(Boolean)
        for (const g of ngrams(words, 5)) gramCount.set(g, (gramCount.get(g) ?? 0) + 1)
      }
    }
    const distinct = sentCount.size
    const topSent = [...sentCount].sort((a, b) => b[1].n - a[1].n).slice(0, 30)
    const topGram = [...gramCount].sort((a, b) => b[1] - a[1]).slice(0, 30)

    // Frequency of the phrases the playtest called out by name.
    const WATCH = ['the board', 'BREAKING', 'intrigue', 'closing in on', 'the room', 'road map']
    const watchCounts = WATCH.map((w) => {
      const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      let n = 0
      for (const b of beats) n += (`${b.head} ${b.body}`.match(re) ?? []).length
      return [w, n] as const
    })

    sampleInbox()
    const byCat = new Map<string, number>()
    for (const b of beats) byCat.set(b.cat, (byCat.get(b.cat) ?? 0) + 1)

    // A7/A8: how loud is the inbox, and how often does BREAKING mean anything?
    const inboxItems = [...inbox.values()]
    // Measured with the SHIPPED predicate, not a copy of it — the point of the
    // number is to track what the player actually sees.
    const breaking = inboxItems.filter((n) => isBreakingNews(n as Parameters<typeof isBreakingNews>[0]))
    const inboxSent = new Map<string, number>()
    for (const n of inboxItems) {
      for (const raw of sentences(`${n.headline}. ${n.body}`)) {
        const k = skeleton(raw)
        inboxSent.set(k, (inboxSent.get(k) ?? 0) + 1)
      }
    }
    const topInbox = [...inboxSent].sort((a, b) => b[1] - a[1]).slice(0, 20)
    const inboxByCat = new Map<string, number>()
    for (const n of inboxItems) inboxByCat.set(n.category, (inboxByCat.get(n.category) ?? 0) + 1)

    const L: string[] = []
    L.push(`# Prose audit — ${source} · seed ${SEED} · ${played} season(s)`, '')
    L.push(`- beats written: **${beats.length}** (${(beats.length / played).toFixed(0)}/season)`)
    L.push(`- sentences: **${totalSentences}**, distinct skeletons: **${distinct}**`)
    L.push(
      `- **repetition index** (sentences per distinct skeleton): **${(totalSentences / Math.max(1, distinct)).toFixed(2)}**`
    )
    L.push(`- beats written before a single game was played: **${preGame.size}**`, '')

    L.push('## The inbox itself (what reaches the GM)', '')
    L.push(`- items delivered: **${inboxItems.length}** (${(inboxItems.length / played).toFixed(0)}/season, ~${(inboxItems.length / played / 200).toFixed(1)}/day)`)
    L.push(`- tagged BREAKING: **${breaking.length}** (${((100 * breaking.length) / Math.max(1, inboxItems.length)).toFixed(1)}% of the inbox, ${(breaking.length / played).toFixed(0)}/season)`)
    L.push(`- BREAKING that are social posts: **${breaking.filter((n) => n.channel === 'feed').length}**`)
    L.push(`- inbox items tagged ambient (should be 0 — they never reach the desk): **${inboxItems.filter((n) => n.reach === 'ambient').length}**`, '')
    L.push('| inbox category | n |', '|---|---:|')
    for (const [c, n] of [...inboxByCat].sort((a, b) => b[1] - a[1])) L.push(`| ${c} | ${n} |`)
    L.push('', '### Most repeated sentences IN THE INBOX', '', '| n | sentence |', '|---:|---|')
    for (const [k, n] of topInbox) L.push(`| ${n} | ${k.replace(/\|/g, '\|').slice(0, 150)} |`)
    L.push('', '### A sample of what carries the BREAKING tag', '')
    for (const n of breaking.slice(0, 25)) L.push(`- (${n.salience ?? '—'}${n.rare ? ', rare' : ''}) **${n.headline}**`)

    L.push('', '## Beats by category', '', '| category | n |', '|---|---:|')
    for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) L.push(`| ${c} | ${n} |`)

    L.push('', '## Watchwords', '', '| phrase | uses |', '|---|---:|')
    for (const [w, n] of watchCounts) L.push(`| \`${w}\` | ${n} |`)

    L.push('', '## Top repeated sentences (names/numbers masked)', '', '| n | sentence |', '|---:|---|')
    for (const [, v] of topSent) L.push(`| ${v.n} | ${v.sample.replace(/\|/g, '\\|').slice(0, 160)} |`)

    L.push('', '## Top repeated 5-grams', '', '| n | phrase |', '|---:|---|')
    for (const [g, n] of topGram) L.push(`| ${n} | ${g.replace(/\|/g, '\\|')} |`)

    if (preGame.size > 0) {
      L.push('', '## Written before any game was played (suspect by construction)', '')
      for (const i of [...preGame].slice(0, 60)) {
        const b = beats[i]!
        L.push(`- \`${b.cat}\` **${b.head}** — ${b.body.replace(/\n/g, ' ').slice(0, 220)}`)
      }
    }

    const report = L.join('\n') + '\n'
    mkdirSync(join(process.cwd(), 'docs', 'autopilot'), { recursive: true })
    writeFileSync(join(process.cwd(), 'docs', 'autopilot', `prose-audit-${process.env.PA_TAG ?? 'latest'}.md`), report)
    console.log('\n' + L.slice(0, 90).join('\n'))

    expect(beats.length).toBeGreaterThan(0)
  }, 3_600_000)
})
