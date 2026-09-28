/**
 * Track 4 — each scout's OWN draft board and his track record.
 *  - A scout ranks only the prospects he has personally watched (fog-of-war).
 *  - His lean is a real shift, so two scouts on the same kids can disagree.
 *  - Draft-morning calls go on file and are judged two seasons later against
 *    who became an NHL regular, next to the public board's top 20.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { generateLeague } from '@data/generate'
import { validateModDatabase, loadModDatabase } from '@data'
import { Career } from './career'

/** The draft class lives in the imported world (the vanilla league has none). */
const REAL_DB = 'K:/Hockey Game/mods/nhl-ehm/database.json'

type Inner = {
  year: number
  scouting: { scoutHistory?: Array<[string, string[]]> }
  draftRankCache: unknown
  draftCallsLog: Array<{ year: number; publicTop: string[]; scouts: Array<[string, string[]]> }>
  data: { league: { teams: string[] }; teams: Map<string, { roster: string[] }> }
  scoutTrackRecord(id: string): { classesJudged: number; hits: number; publicHits: number; pending: number; line: string }
}

function career(): { c: Career; inner: Inner } {
  const data = generateLeague({ seed: 11 })
  const c = new Career(data, 11, data.league.teams[0]!)
  return { c, inner: c as unknown as Inner }
}

function realCareer(): { c: Career; inner: Inner } {
  const data = loadModDatabase(validateModDatabase(JSON.parse(readFileSync(REAL_DB, 'utf8'))), { seed: 2029 })
  const c = new Career(data, 2029, data.league.teams[3]!)
  return { c, inner: c as unknown as Inner }
}

describe("each scout's own board", () => {
  it.skipIf(!existsSync(REAL_DB))('ranks only the prospects that scout has watched', () => {
    const { c, inner } = realCareer()
    const first = c.getDraftRankings()
    const pool = first.rankings.slice(0, 30).map((r) => r.playerId)
    expect(pool.length).toBeGreaterThanOrEqual(10)
    expect(first.scoutBoards.length).toBeGreaterThanOrEqual(2)
    const [a, b] = first.scoutBoards
    inner.scouting.scoutHistory = [
      [a!.scoutId, pool.slice(0, 8)],
      [b!.scoutId, pool.slice(4, 14)],
    ]
    inner.draftRankCache = null
    const ranks = c.getDraftRankings()
    const boardA = ranks.scoutBoards.find((x) => x.scoutId === a!.scoutId)!
    const boardB = ranks.scoutBoards.find((x) => x.scoutId === b!.scoutId)!
    expect(new Set(boardA.rows.map((r) => r.playerId))).toEqual(new Set(pool.slice(0, 8)))
    expect(new Set(boardB.rows.map((r) => r.playerId))).toEqual(new Set(pool.slice(4, 14)))
    expect(boardA.seenCount).toBe(8)
    expect(boardA.rows.every((r) => r.seen)).toBe(true)
  })

  it.skipIf(!existsSync(REAL_DB))('a scout who has seen nobody has an empty board, not the consensus', () => {
    const { c, inner } = realCareer()
    inner.scouting.scoutHistory = []
    inner.draftRankCache = null
    for (const b of c.getDraftRankings().scoutBoards) expect(b.rows).toHaveLength(0)
  })
})

describe('the scout track record', () => {
  it('waits two seasons, then compares his top 20 with the public board', () => {
    const { inner } = career()
    const nhl = inner.data.teams.get(inner.data.league.teams[1]!)!.roster
    inner.draftCallsLog = [
      { year: inner.year - 2, publicTop: ['nobody-1', nhl[0]!], scouts: [['s1', [nhl[1]!, nhl[2]!, 'nobody-2']]] },
      { year: inner.year, publicTop: [], scouts: [['s1', [nhl[3]!]]] },
    ]
    const tr = inner.scoutTrackRecord('s1')
    expect(tr).toMatchObject({ classesJudged: 1, hits: 2, publicHits: 1, pending: 1 })
    expect(tr.line).toMatch(/^Sharp/)
    expect(inner.scoutTrackRecord('someone-else').line).toMatch(/No draft boards on file/)
  })
})
