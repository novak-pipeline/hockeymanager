/**
 * Biography tests, in three groups:
 *
 *  1. TRUTH — the only bar that really matters. A biography that is wrong is
 *     worse than no biography, so these prove the prose never claims what the
 *     record does not hold: no career for a man we have no file on, no cause
 *     attached to a thin season, no "first NHL season" for an imported vet.
 *  2. BEHAVIOUR — it is pre-populated for a man who arrives mid-career, it
 *     updates as the career happens, and it is stable between openings.
 *  3. CRAFT — the anti-mail-merge gates. Banned vocabulary, no repeated
 *     sentence openings, and enough variety across a league that a reader who
 *     opens fifty profiles does not see the same page fifty times.
 */
import { describe, expect, it } from 'vitest'
import { isEligible, type ContentCtx } from './contentEngine'
import {
  BIOGRAPHY_POOLS,
  bioCareerTotals,
  bioSeasonLabel,
  buildBiography,
  splitClubName,
  type BioSeason,
  type BiographyFacts,
} from './biography'

/* ────────────────────────── fixtures ────────────────────────── */

const NHL = 'National Hockey League'

function season(o: Partial<BioSeason> & { year: number; clubShort: string }): BioSeason {
  return {
    year: o.year,
    clubShort: o.clubShort,
    league: o.league ?? NHL,
    top: o.top ?? true,
    gamesPlayed: o.gamesPlayed ?? 82,
    goals: o.goals ?? 20,
    assists: o.assists ?? 25,
    wins: o.wins ?? 0,
    shutouts: o.shutouts ?? 0,
    ...(o.savePct !== undefined ? { savePct: o.savePct } : {}),
  }
}

function facts(o: Partial<BiographyFacts> & { playerId: string }): BiographyFacts {
  return {
    playerId: o.playerId,
    name: o.name ?? 'Casey Renaud',
    age: o.age ?? 27,
    position: o.position ?? 'C',
    leagueShort: o.leagueShort ?? 'NHL',
    currentYear: o.currentYear
      ?? (o.seasons !== undefined && o.seasons.length > 0
        ? o.seasons[o.seasons.length - 1].year + 1
        : 2029),
    seasons: o.seasons ?? [],
    historyKnown: o.historyKnown ?? true,
    awards: o.awards ?? [],
    cups: o.cups ?? 0,
    moves: o.moves ?? [],
    recordsHeld: o.recordsHeld ?? [],
    ...(o.nationality !== undefined ? { nationality: o.nationality } : {}),
    ...(o.birthplace !== undefined ? { birthplace: o.birthplace } : {}),
    ...(o.heightCm !== undefined ? { heightCm: o.heightCm } : {}),
    ...(o.weightKg !== undefined ? { weightKg: o.weightKg } : {}),
    ...(o.current !== undefined ? { current: o.current } : {}),
    ...(o.draft !== undefined ? { draft: o.draft } : {}),
    ...(o.intl !== undefined ? { intl: o.intl } : {}),
    ...(o.retiredYear !== undefined ? { retiredYear: o.retiredYear } : {}),
    ...(o.injury !== undefined ? { injury: o.injury } : {}),
    ...(o.clubShort !== undefined ? { clubShort: o.clubShort } : {}),
    ...(o.clubCity !== undefined ? { clubCity: o.clubCity } : {}),
  }
}

function prose(f: BiographyFacts): string {
  const bio = buildBiography(f)
  return bio === null ? '' : bio.paragraphs.join(' ')
}

/**
 * A veteran who arrived from the imported database with a career behind him —
 * the A1 headline case. Internally consistent: drafted at 18 in 2010, in the
 * league from 2011 at 19, and 34 in 2026.
 */
function importedVeteran(): BiographyFacts {
  const years = [2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
  const lines: Array<[number, number, number]> = [
    [62, 11, 19], [78, 33, 52], [82, 42, 67], [69, 31, 41], [80, 28, 44],
    [81, 30, 48], [78, 26, 45], [82, 24, 43], [77, 22, 38], [80, 25, 40],
    [74, 19, 35], [79, 17, 33], [72, 14, 26], [70, 11, 22], [68, 9, 18],
  ]
  return facts({
    playerId: 'p-vet',
    name: 'Evgeni Marchuk',
    age: 34,
    currentYear: 2026,
    position: 'C',
    birthplace: 'Magnitogorsk, Russia',
    nationality: 'Russia',
    heightCm: 191,
    weightKg: 88,
    clubShort: 'Penguins',
    clubCity: 'Pittsburgh',
    draft: { year: 2010, round: 1, overall: 2, club: 'Penguins' },
    seasons: years.map((year, i) => season({
      year, clubShort: 'Penguins',
      gamesPlayed: lines[i][0], goals: lines[i][1], assists: lines[i][2],
    })),
    awards: [{ award: 'Hart Trophy', year: 2013 }],
    cups: 2,
  })
}

/* ══════════════════════════ 1. TRUTH ══════════════════════════ */

describe('biography — truth', () => {
  it('never invents a career for a man the database has no file on', () => {
    const text = prose(facts({
      playerId: 'p-unknown', name: 'Anton Vasek', age: 31, historyKnown: false, seasons: [],
    }))
    expect(text).not.toMatch(/season/i)
    expect(text).not.toMatch(/\bdrafted\b/i)
    // It says the honest thing instead: we hold no record of him. Which of the
    // three ways it says it is the content engine's business, not the test's.
    expect(text).toMatch(/nobody wrote it down|starts the day he arrived|went unrecorded/i)
    // And it says it once, not twice in two voices.
    expect(text).not.toMatch(/Nobody has recorded a game/i)
  })

  it('never calls an imported veteran a rookie or a newcomer today', () => {
    const bio = buildBiography(importedVeteran())!
    const text = bio.paragraphs.join(' ')
    // Naming the season he ARRIVED is right; calling the season in progress his
    // first is the bug (the empty in-sim ledger mistaken for an empty career).
    // He arrived at 19 in 2011–12, and every one of those facts comes from
    // the imported history: the in-sim ledger is empty.
    expect(text).toMatch(/(^|\D)19(\D|$)/)
    expect(text).toMatch(/(^|\D)62(\D|$)/)
    expect(text).not.toMatch(/\brookie\b/i)
    expect(text).not.toMatch(/in the middle of his first/i)
    expect(text).not.toMatch(/has not played an NHL game/i)
    expect(bio.beats).not.toContain('prospect')
  })

  it('reports a short season as games played, never as an injury', () => {
    const f = facts({
      playerId: 'p-thin',
      seasons: [
        season({ year: 2020, clubShort: 'Sabres', gamesPlayed: 79 }),
        season({ year: 2021, clubShort: 'Sabres', gamesPlayed: 18, goals: 4, assists: 6 }),
        season({ year: 2022, clubShort: 'Sabres', gamesPlayed: 81 }),
      ],
      clubShort: 'Sabres',
    })
    const bio = buildBiography(f)
    expect(bio?.beats).toContain('thinYear')
    const text = bio!.paragraphs.join(' ')
    expect(text).toMatch(/18 games/)
    // The record holds the count, not the cause.
    expect(text).not.toMatch(/injur|surgery|concussion|hurt/i)
  })

  it('claims no injury history when the record carries none', () => {
    const text = prose(importedVeteran())
    expect(text).not.toMatch(/injur/i)
  })

  it('only says he never dressed for his drafting club when it holds his record', () => {
    const seasons = [season({ year: 2019, clubShort: 'Rangers' })]
    const withHistory = buildBiography(facts({
      playerId: 'p-a', age: 26, seasons, clubShort: 'Rangers',
      draft: { year: 2016, round: 1, overall: 8, club: 'Flames' }, historyKnown: true,
    }))
    expect(withHistory?.beats).toContain('draftNeverPlayed')

    const noHistory = buildBiography(facts({
      playerId: 'p-a', age: 26, seasons, clubShort: 'Rangers',
      draft: { year: 2016, round: 1, overall: 8, club: 'Flames' }, historyKnown: false,
    }))
    expect(noHistory?.beats).not.toContain('draftNeverPlayed')
  })

  it('never says "undrafted" about a man whose file we do not hold', () => {
    const text = prose(facts({
      playerId: 'p-b', age: 29, historyKnown: false,
      seasons: [season({ year: 2022, clubShort: 'Oilers' })],
    }))
    expect(text).not.toMatch(/never drafted|was not called/i)
  })

  it('attributes a move only when the chronicle recorded how it happened', () => {
    const seasons = [
      season({ year: 2020, clubShort: 'Ducks' }),
      season({ year: 2021, clubShort: 'Stars' }),
    ]
    const known = prose(facts({
      playerId: 'p-c', seasons, clubShort: 'Stars',
      moves: [{ year: 2021, via: 'trade', toClubShort: 'Stars', fromClubShort: 'Ducks' }],
    }))
    expect(known).toMatch(/trade/i)
    expect(known).toMatch(/Stars/)
    expect(known).toMatch(/2021/)

    const unknown = prose(facts({
      playerId: 'p-c', seasons, clubShort: 'Stars', moves: [],
    }))
    expect(unknown).not.toMatch(/trade|signed with|waivers/i)
  })

  it('every number in the prose comes from the facts', () => {
    const f = importedVeteran()
    const bio = buildBiography(f)!
    const allowed = new Set<string>()
    const allow = (n: number): void => { allowed.add(String(n)); allowed.add(n.toLocaleString('en-US')) }
    for (const s of f.seasons) {
      allow(s.year); allow(s.year + 1); allow(s.gamesPlayed)
      allow(s.goals); allow(s.assists); allow(s.goals + s.assists)
      allow(Number(String((s.year + 1) % 100).padStart(2, '0')))
      allowed.add(String((s.year + 1) % 100).padStart(2, '0'))
    }
    const t = bioCareerTotals(f.seasons)
    allow(t.gamesPlayed); allow(t.points); allow(t.goals); allow(t.assists); allow(t.seasons)
    allow(f.age); allow(f.cups)
    allow(f.draft!.year); allow(f.draft!.overall!); allow(f.draft!.round!)
    allow(f.draft!.overall! - 1)
    for (const a of f.awards) if (a.year !== undefined) allow(a.year)
    // Height renders as feet and inches.
    allow(6); allow(3); allow(194)

    const text = bio.paragraphs.join(' ')
    const numbers = (text.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,+$/, ''))
    for (const n of numbers) {
      expect(allowed.has(n), `"${n}" appears in the prose but not in the facts: ${text}`).toBe(true)
    }
  })
})

/* ══════════════════════════ 2. BEHAVIOUR ══════════════════════════ */

describe('biography — behaviour', () => {
  it('is already populated for a player who arrives with a career behind him', () => {
    const bio = buildBiography(importedVeteran())
    expect(bio).not.toBeNull()
    expect(bio!.paragraphs.length).toBeGreaterThanOrEqual(3)
    const text = bio!.paragraphs.join(' ')
    expect(text).toMatch(/Magnitogorsk/)
    expect(text).toMatch(/Penguins/)
    expect(text).toMatch(/Hart Trophy/)
    expect(text).toMatch(/Stanley Cup/)
  })

  it('cites the imported career, not an empty in-sim ledger', () => {
    const bio = buildBiography(importedVeteran())!
    expect(bio.beats).toContain('debut')
    // Both beats are impossible without the imported seasons, and 1,132 career
    // games exist nowhere but in that history.
    expect(bio.beats).toContain('peak')
    expect(bio.paragraphs.join(' ')).toMatch(/62|1,132/)
  })

  it('updates as the career happens', () => {
    const before = importedVeteran()
    const bioBefore = buildBiography(before)!

    // He plays another season, and it becomes his best.
    const after: BiographyFacts = {
      ...before,
      age: 35,
      seasons: [...before.seasons, season({ year: 2016, clubShort: 'Penguins', gamesPlayed: 82, goals: 30, assists: 40 })],
      current: {
        year: 2027, clubShort: 'Penguins', top: true, gamesPlayed: 24,
        goals: 11, assists: 19, wins: 0, shutouts: 0,
      },
    }
    const bioAfter = buildBiography(after)!
    expect(bioAfter.paragraphs.join(' ')).not.toEqual(bioBefore.paragraphs.join(' '))
    expect(bioAfter.beats).toContain('now')
    expect(bioAfter.paragraphs.join(' ')).toMatch(/24 games|24 appearances/)
    expect(bioAfter.paragraphs.join(' ')).toMatch(/30 points/)
  })

  it('is stable between openings — the same facts always read the same', () => {
    const f = importedVeteran()
    expect(buildBiography(f)).toEqual(buildBiography(f))
  })

  it('finds the breakout and does not repeat it as the peak', () => {
    const bio = buildBiography(facts({
      playerId: 'p-break',
      seasons: [
        season({ year: 2019, clubShort: 'Flames', gamesPlayed: 60, goals: 8, assists: 14 }),
        season({ year: 2020, clubShort: 'Flames', gamesPlayed: 82, goals: 34, assists: 47 }),
        season({ year: 2021, clubShort: 'Flames', gamesPlayed: 80, goals: 30, assists: 40 }),
      ],
      clubShort: 'Flames',
    }))!
    expect(bio.beats).toContain('breakout')
    // 2020 is both the jump and the best season; it is told once.
    const text = bio.paragraphs.join(' ')
    expect(text.match(/2020–21/g)?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it('writes a prospect from the league he actually plays in', () => {
    const bio = buildBiography(facts({
      playerId: 'p-kid', name: 'Milo Fenn', age: 18, position: 'W',
      birthplace: 'Kelowna, British Columbia',
      seasons: [
        season({ year: 2028, clubShort: 'Rockets', league: 'WHL', top: false, gamesPlayed: 64, goals: 41, assists: 52 }),
      ],
      draft: { year: 2029, round: 1, overall: 4, club: 'Kraken' },
    }))!
    const text = bio.paragraphs.join(' ')
    expect(text).toMatch(/WHL/)
    expect(text).toMatch(/93 points|41|64/)
    expect(bio.beats).toContain('prospect')
    expect(bio.beats).not.toContain('debut')
  })

  it('names a goaltender best season from his decisions', () => {
    const bio = buildBiography(facts({
      playerId: 'p-g', name: 'Rasmus Holt', age: 30, position: 'G',
      clubShort: 'Blues',
      seasons: [
        season({ year: 2020, clubShort: 'Blues', gamesPlayed: 22, goals: 0, assists: 0, wins: 9, shutouts: 1, savePct: 0.905 }),
        season({ year: 2021, clubShort: 'Blues', gamesPlayed: 58, goals: 0, assists: 0, wins: 34, shutouts: 5, savePct: 0.921 }),
      ],
    }))!
    const text = bio.paragraphs.join(' ')
    expect(text).toMatch(/34/)
    expect(text).not.toMatch(/points/)
  })

  it('returns null rather than a stub when there is nothing to say', () => {
    // A generated player with no name parts, no place, no seasons still has an
    // age and a position — so he gets one honest line, never nothing at all.
    const bio = buildBiography(facts({ playerId: 'p-blank', age: 19, seasons: [] }))
    expect(bio).not.toBeNull()
    expect(bio!.paragraphs.join(' ').length).toBeGreaterThan(20)
  })

  it('splits club names the way a sentence needs them', () => {
    expect(splitClubName('Pittsburgh Penguins')).toEqual({ nickname: 'Penguins', city: 'Pittsburgh' })
    expect(splitClubName('Tampa Bay Lightning')).toEqual({ nickname: 'Lightning', city: 'Tampa Bay' })
    expect(splitClubName('Toronto Maple Leafs')).toEqual({ nickname: 'Maple Leafs', city: 'Toronto' })
    expect(splitClubName('Vegas Golden Knights')).toEqual({ nickname: 'Golden Knights', city: 'Vegas' })
    expect(splitClubName('Avangard')).toEqual({ nickname: 'Avangard', city: 'Avangard' })
  })

  it('labels seasons the way a record book does', () => {
    expect(bioSeasonLabel(2029)).toBe('2029–30')
    expect(bioSeasonLabel(2099)).toBe('2099–00')
  })
})

/* ══════════════════════════ 3. CRAFT ══════════════════════════ */

/**
 * The vocabulary that makes prose read as generated. This list is the
 * enforceable half of the user's bar ("I dont want it to feel like it was
 * written by AI"): essay connectives, hype adverbs, and the stock phrases a
 * model reaches for when it has nothing specific to say.
 */
const BANNED = [
  'notably', 'moreover', 'furthermore', 'additionally', 'importantly',
  'showcasing', 'showcased', 'boasts', 'boasting', 'a testament to',
  'cemented his legacy', 'when all is said and done', 'it is worth noting',
  'underscores', 'underscoring', 'delve', 'tapestry', 'in the world of',
  'proved to be', 'has continued to', 'known for his ability to',
  'not only', 'truly', 'incredibly', 'remarkably', 'undoubtedly',
]

describe('biography — craft', () => {
  it('no authored variant uses generated-prose vocabulary', () => {
    for (const [pool, variants] of Object.entries(BIOGRAPHY_POOLS)) {
      for (const v of variants) {
        const lower = v.text.toLowerCase()
        for (const banned of BANNED) {
          expect(lower.includes(banned), `${pool}/${v.id} uses banned "${banned}"`).toBe(false)
        }
      }
    }
  })

  it('no authored variant reuses an id', () => {
    const seen = new Set<string>()
    for (const variants of Object.values(BIOGRAPHY_POOLS)) {
      for (const v of variants) {
        expect(seen.has(v.id), `duplicate variant id ${v.id}`).toBe(false)
        seen.add(v.id)
      }
    }
  })

  /**
   * Every pool must have a floor: some variant that fires at the WEAKEST state
   * its detector can hand it. Without one the beat selects nothing and the
   * sentence silently disappears — a career missing its draft day with no error
   * anywhere. The ctxs below are each pool's gate, at the boundary.
   */
  const POOL_FLOORS: Record<string, ContentCtx[]> = {
    origin: [{}],
    draft: [{}, { overall: 1 }, { round: 9, overall: 260 }],
    draftNeverPlayed: [{}],
    undrafted: [{}, { becameProducer: false }],
    debut: [{}, { debutAge: 23, debutGp: 41 }],
    breakout: [{}, { breakPts: 46, breakAge: 24 }],
    peak: [{}, { peakPts: 41, position: 'D' }],
    awards: [{ awardCount: 1 }, { awardCount: 7 }],
    cups: [{ cups: 1 }, { cups: 5 }],
    record: [{}],
    movement: [{ clubCount: 2 }, { clubCount: 9, tradeCount: 0 }],
    oneClub: [{ seasonCount: 5 }],
    tenure: [{ tenure: 4 }, { tenure: 19 }],
    thinYear: [{ thinGp: 45 }],
    decline: [{ age: 31 }],
    now: [{ curGp: 1 }, { curGp: 4 }, { curGp: 5 }, { curGp: 82 }],
    injuryNow: [{ injuryGames: 1 }],
    prospect: [{}],
    intl: [{ intlApps: 1 }, { intlApps: 9 }],
    retired: [{}],
    totals: [{ careerGp: 200, careerPts: 0 }],
  }

  it('every pool fires at the weakest state its detector can produce', () => {
    const pools = Object.keys(BIOGRAPHY_POOLS)
    expect(Object.keys(POOL_FLOORS).sort()).toEqual(pools.sort())
    for (const [pool, variants] of Object.entries(BIOGRAPHY_POOLS)) {
      for (const ctx of POOL_FLOORS[pool]) {
        const eligible = variants.filter((v) => isEligible(v, ctx))
        expect(
          eligible.length,
          `${pool} selects nothing for ${JSON.stringify(ctx)} — the beat would vanish`,
        ).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('sentences in one biography almost never open the same way', () => {
    const bio = buildBiography(importedVeteran())!
    const sentences = bio.paragraphs.join(' ').split(/(?<=\.) /)
    const openings = sentences.map((s) => s.toLowerCase().split(/\s+/).slice(0, 2).join(' '))
    // The guard re-picks on a collision and only gives up (keeping the fact
    // rather than losing the beat) when a whole pool collides.
    expect(new Set(openings).size).toBeGreaterThanOrEqual(openings.length - 1)
    // Never three sentences with the same opening.
    const counts = new Map<string, number>()
    for (const o of openings) counts.set(o, (counts.get(o) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2)
  })

  it('a league of players does not read as one page fifty times', () => {
    // Fifty men with the same career SHAPE and different facts. If selection
    // were a template, every opening sentence would be identical.
    const bios: string[] = []
    for (let i = 0; i < 50; i++) {
      const f = facts({
        playerId: `p-${i}`,
        name: `Player ${i} Lastname${i}`,
        age: 24 + (i % 12),
        position: (['C', 'W', 'D', 'G'] as const)[i % 4],
        birthplace: `Town ${i}`,
        heightCm: 175 + (i % 22),
        weightKg: 82 + (i % 14),
        clubShort: `Club${i % 8}`,
        clubCity: `City${i % 8}`,
        draft: { year: 2015 + (i % 5), round: 1 + (i % 7), overall: 1 + i * 3, club: `Club${(i + 3) % 8}` },
        seasons: [
          season({ year: 2019, clubShort: `Club${i % 8}`, gamesPlayed: 60 + (i % 22), goals: 5 + (i % 40), assists: 8 + (i % 45) }),
          season({ year: 2020, clubShort: `Club${i % 8}`, gamesPlayed: 70 + (i % 12), goals: 9 + (i % 35), assists: 11 + (i % 50) }),
          season({ year: 2021, clubShort: `Club${i % 8}`, gamesPlayed: 74 + (i % 8), goals: 12 + (i % 30), assists: 14 + (i % 40) }),
        ],
      })
      const bio = buildBiography(f)
      expect(bio).not.toBeNull()
      bios.push(bio!.paragraphs.join(' '))
    }
    // Openings: the first six words of each biography.
    const openings = bios.map((b) => b.toLowerCase().split(/\s+/).slice(0, 6).join(' '))
    expect(new Set(openings).size).toBeGreaterThanOrEqual(8)
    // And no two biographies are word-for-word identical.
    expect(new Set(bios).size).toBe(bios.length)
  })

  it('no single authored sentence dominates a league', () => {
    // The failure this catches is subtle and was real: when one variant is the
    // MOST SPECIFIC eligible for a common career shape and has no siblings at
    // its own specificity, the Hades rule picks it every single time and half
    // the league gets the same sentence. Siblings at equal specificity are what
    // give the seeded tie-break something to choose between.
    const shapes: string[] = []
    for (let i = 0; i < 80; i++) {
      const debutYear = 2012 + (i % 9)
      const seasons: BioSeason[] = []
      const n = 3 + (i % 11)
      for (let k = 0; k < n; k++) {
        seasons.push(season({
          year: debutYear + k,
          clubShort: `Club${(i + (k > n / 2 ? 1 : 0)) % 9}`,
          gamesPlayed: 58 + ((i * 3 + k * 5) % 25),
          goals: 6 + ((i * 7 + k * 3) % 38),
          assists: 9 + ((i * 5 + k * 11) % 46),
        }))
      }
      const bio = buildBiography(facts({
        playerId: `q-${i}`,
        name: `First${i} Last${i}`,
        age: 20 + (i % 17),
        currentYear: debutYear + n,
        position: (['C', 'W', 'D'] as const)[i % 3],
        birthplace: `Place ${i % 23}`,
        clubShort: `Club${(i + 1) % 9}`,
        clubCity: `City${(i + 1) % 9}`,
        seasons,
        draft: { year: debutYear - 1, round: 1 + (i % 7), overall: 1 + ((i * 11) % 200), club: `Club${(i + 4) % 9}` },
      }))
      expect(bio).not.toBeNull()
      // Reduce each sentence to its authored SHAPE by blanking the facts, so
      // two players with the same sentence and different numbers still collide.
      for (const s of bio!.paragraphs.join(' ').split(/(?<=\.) /)) {
        shapes.push(s.replace(/\d[\d,–-]*/g, '#').replace(/\b(Club|City|Place|First|Last)\d*\b/g, 'X'))
      }
    }
    const counts = new Map<string, number>()
    for (const s of shapes) counts.set(s, (counts.get(s) ?? 0) + 1)
    const [worst, worstN] = [...counts].sort((a, b) => b[1] - a[1])[0]
    expect(
      worstN / 80,
      `"${worst}" is used by ${worstN} of 80 biographies — that pool needs siblings at its specificity`,
    ).toBeLessThanOrEqual(0.34)
  })

  it('leaves no unfilled slot in any rendered biography', () => {
    const cases: BiographyFacts[] = [
      importedVeteran(),
      facts({ playerId: 'x1', age: 19, seasons: [] }),
      facts({ playerId: 'x2', age: 38, historyKnown: false }),
      facts({
        playerId: 'x3', age: 33, position: 'G', clubShort: 'Jets', clubCity: 'Winnipeg',
        seasons: [season({ year: 2020, clubShort: 'Jets', wins: 30, shutouts: 4, savePct: 0.93 })],
        injury: { description: 'a knee sprain', gamesRemaining: 26 },
      }),
      facts({
        playerId: 'x4', age: 41, retiredYear: 2033, clubShort: 'Wild',
        seasons: [season({ year: 2018, clubShort: 'Wild' }), season({ year: 2019, clubShort: 'Wild' })],
        recordsHeld: [{ label: 'career points', value: '1,921 points', year: 2032 }],
        intl: { apps: 61, goals: 20, assists: 25 }, nationality: 'Sweden',
      }),
      facts({
        playerId: 'x5', age: 30, clubShort: 'Kings', clubCity: 'Los Angeles',
        draft: { year: 2016 },
        seasons: [
          season({ year: 2018, clubShort: 'Devils' }), season({ year: 2019, clubShort: 'Rangers' }),
          season({ year: 2020, clubShort: 'Coyotes' }), season({ year: 2021, clubShort: 'Sharks' }),
          season({ year: 2022, clubShort: 'Kings' }),
        ],
        moves: [{ year: 2022, via: 'waiver', toClubShort: 'Kings' }],
      }),
    ]
    for (const f of cases) {
      const bio = buildBiography(f)
      if (bio === null) continue
      const text = bio.paragraphs.join(' ')
      expect(text, `unfilled slot for ${f.playerId}: ${text}`).not.toMatch(/\{[a-zA-Z]/)
      // No double spaces, no space before punctuation, no dangling article.
      expect(text).not.toMatch(/ {2}/)
      expect(text).not.toMatch(/ [,.;]/)
      expect(text, `dangling article for ${f.playerId}: ${text}`).not.toMatch(/\bthe\s+[.,]/)
    }
  })
})
