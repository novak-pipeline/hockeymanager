/**
 * The daily beat's pure layer (docs/MEDIA-BEAT.md): the authored pools obey
 * the house rules, the builders never leave a slot unfilled or claim what the
 * facts do not carry, the injury disclosure layer lies the way clubs lie, and
 * the cast and market model are stable.
 */
import { describe, expect, it } from 'vitest'
import type { ContentVariant } from './contentEngine'
import * as P from './beatPools'
import {
  beatScore,
  buildDaily,
  buildFeature,
  buildGameday,
  buildGrades,
  buildHotSeat,
  buildInjury,
  buildMailbag,
  buildMoves,
  buildNotebook,
  buildProspects,
  buildClaimPiece,
  letterGrade,
  type DeskCtx,
  type GradeLine,
  type LinesFacts,
  type MailItem,
} from './beatDesk'
import { beatOutletFor, marketProfile } from './mediaCast'
import { BAND_RANGE, discloseInjury, nextDisclosureBeat, officialLine } from './injuryDisclosure'
import { presserPrompt, type PresserTopic } from './pressQuestions'
import type { ContentUse } from './contentEngine'

const POOLS: Record<string, ContentVariant[]> = Object.fromEntries(
  Object.entries(P).filter(([, v]) => Array.isArray(v)) as Array<[string, ContentVariant[]]>,
)

const BANNED = [
  'notably', 'moreover', 'furthermore', 'additionally', 'importantly', 'showcasing', 'boasts',
  'a testament to', 'delve', 'tapestry', 'in the world of', 'truly', 'incredibly', 'remarkably',
  'undoubtedly', 'it is worth noting', 'underscores',
]

describe('beat pools — house rules', () => {
  it('every conditioned bucket is at least three deep (the dominance trap)', () => {
    for (const [name, pool] of Object.entries(POOLS)) {
      const buckets = new Map<string, number>()
      for (const v of pool) {
        if (!v.conditions || Object.keys(v.conditions).length === 0) continue
        const k = JSON.stringify(Object.entries(v.conditions).sort())
        buckets.set(k, (buckets.get(k) ?? 0) + 1)
      }
      for (const [k, n] of buckets) expect(n, `${name} bucket ${k}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('the frequent headline pools run 8+ deep at their base', () => {
    const base = (pool: ContentVariant[], cond?: Record<string, unknown>): number =>
      pool.filter((v) => JSON.stringify(v.conditions ?? {}) === JSON.stringify(cond ?? {})).length
    expect(base(P.NB_HEAD, { change: false })).toBeGreaterThanOrEqual(8)
    expect(base(P.GD_HEAD)).toBeGreaterThanOrEqual(8)
    expect(base(P.GR_HEAD, { won: true })).toBeGreaterThanOrEqual(8)
    expect(base(P.GR_HEAD, { won: false })).toBeGreaterThanOrEqual(8)
    expect(base(P.MV_HEAD)).toBeGreaterThanOrEqual(8)
    expect(base(P.MB_HEAD)).toBeGreaterThanOrEqual(8)
    expect(base(P.DY_HEAD)).toBeGreaterThanOrEqual(8)
    expect(base(P.PR_HEAD)).toBeGreaterThanOrEqual(8)
  })

  it('ids are unique across every beat pool', () => {
    const seen = new Set<string>()
    for (const pool of Object.values(POOLS)) {
      for (const v of pool) {
        expect(seen.has(v.id), v.id).toBe(false)
        seen.add(v.id)
      }
    }
  })

  it('no AI-tell vocabulary and no emoji', () => {
    for (const [name, pool] of Object.entries(POOLS)) {
      for (const v of pool) {
        const t = `${v.text} ${v.text2 ?? ''}`.toLowerCase()
        for (const b of BANNED) expect(t.includes(b), `${name}/${v.id} uses "${b}"`).toBe(false)
        expect(/\p{Extended_Pictographic}/u.test(t), `${name}/${v.id} has an emoji`).toBe(false)
      }
    }
  })
})

/* ─────────────────────────── builders ─────────────────────────── */

function desk(kind: string, tilt: 'ally' | 'neutral' | 'critic' = 'neutral', ledger: ContentUse[] | null = []): DeskCtx {
  const team = { id: 't-pit', name: 'Pittsburgh Penguins', city: 'Pittsburgh', abbreviation: 'PIT' }
  return {
    outlet: beatOutletFor(team),
    teamId: team.id,
    teamName: team.name,
    nick: 'Penguins',
    city: 'Pittsburgh',
    market: marketProfile(team),
    act: 'early',
    tilt,
    year: 2029,
    day: 12,
    dateISO: '2029-10-24',
    ledger,
    key: `beat|${kind}|t-pit|2029|12`,
  }
}

const LINES: LinesFacts = {
  forwards: [['Jake Guentzel', 'Sidney Crosby', 'Bryan Rust'], ['Rickard Rakell', 'Evgeni Malkin', 'Tommy Novak'], ['A B', 'C D', 'E F'], ['G H', 'I J', 'K L']],
  defence: [['Erik Karlsson', 'Kris Letang'], ['M N', 'O P'], ['Q R', 'S T']],
  goalies: ['Tristan Jarry', 'Alex Nedeljkovic'],
  pp: [['Sidney Crosby', 'Evgeni Malkin', 'Bryan Rust', 'Erik Karlsson', 'Jake Guentzel']],
  pk: [['Q R', 'S T', 'A B', 'C D']],
}

function noSlots(text: string): void {
  expect(text, text).not.toMatch(/\{[a-zA-Z]/)
}

function allText(a: { headline: string; dek: string; body: string[]; sections?: Array<{ lines: string[] }>; qa?: Array<{ question: string; answer: string }>; grades?: Array<{ note: string }> }): string {
  return [a.headline, a.dek, ...a.body, ...(a.sections ?? []).flatMap((s) => s.lines), ...(a.qa ?? []).flatMap((q) => [q.question, q.answer]), ...(a.grades ?? []).map((g) => g.note)].join('\n')
}

function line(over: Partial<GradeLine>): GradeLine {
  return { playerId: 'p', name: 'Some Player', pos: 'W', goals: 0, assists: 0, shots: 1, hits: 0, blocks: 0, pm: 0, toi: 900, saves: 0, sa: 0, ga: 0, rating: 7, ...over }
}

describe('builders', () => {
  it('a notebook names the change, the absent man in the club\'s words, and fills every slot', () => {
    const a = buildNotebook(desk('nb'), {
      lines: LINES,
      changes: [{ name: 'Tommy Novak', from: 'third line', to: 'second line', up: true }],
      absent: [{ name: 'Kris Letang', official: 'an upper-body injury, week-to-week' }],
      scratches: ['Extra Man'],
      chopping: [{ name: 'Other Man', why: 'healthy scratch; 3 of 12 games played' }],
      coachName: 'Dan Muse',
    })!
    const t = allText(a)
    noSlots(t)
    expect(t).toContain('Tommy Novak')
    expect(t).toContain('an upper-body injury, week-to-week')
    expect(a.sections?.some((s) => s.title === 'Power play')).toBe(true)
  })

  it('grades follow the box score: a minus-three night is never an A, two goals never below B', () => {
    const lines: GradeLine[] = [
      line({ playerId: 'a', name: 'Two Goals', goals: 2, shots: 5, pm: 1, rating: 7 }),
      line({ playerId: 'b', name: 'Minus Three', pm: -3, rating: 8.5 }),
      line({ playerId: 'c', name: 'Quiet One' }),
      line({ playerId: 'd', name: 'Quiet Two' }),
      line({ playerId: 'e', name: 'Quiet Three' }),
      line({ playerId: 'g', name: 'The Goalie', pos: 'G', saves: 30, sa: 32, ga: 2, toi: 3600 }),
    ]
    const a = buildGrades(desk('gr'), { opp: { name: 'Boston Bruins', nick: 'Bruins' }, gf: 4, ga: 2, decidedBy: 'regulation', playoff: false, lines, next: 'the Bruins on Saturday' })!
    noSlots(allText(a))
    const g = new Map(a.grades!.map((x) => [x.playerId, x.grade]))
    expect(g.get('a')!.startsWith('A') || g.get('a')!.startsWith('B')).toBe(true)
    expect(g.get('b')!.startsWith('A')).toBe(false)
    expect(a.headline).toContain('Two Goals')
  })

  it('the letter scale is monotonic and a result leans on everyone', () => {
    const q = line({})
    expect(beatScore(q, true)).toBeGreaterThan(beatScore(q, false))
    const order = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']
    let last = -1
    for (let s = 9.5; s >= 4; s -= 0.1) {
      const i = order.indexOf(letterGrade(s))
      expect(i).toBeGreaterThanOrEqual(last)
      last = i
    }
  })

  it('rapport frames a loss: an ally and a critic write different ledes from the same facts', () => {
    const facts = {
      opp: { name: 'Boston Bruins', nick: 'Bruins' }, gf: 1, ga: 5, decidedBy: 'regulation' as const, playoff: false,
      lines: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => line({ playerId: id, name: `Man ${id.toUpperCase()}` })),
      next: 'the Rangers on Monday',
    }
    const ally = buildGrades(desk('gr', 'ally'), facts)!
    const critic = buildGrades(desk('gr', 'critic'), facts)!
    expect(ally.body[0]).not.toBe(critic.body[0])
    expect(critic.body.join(' ').toLowerCase()).toMatch(/front office|roster|built|put together/)
    expect(ally.tilt).toBe('ally')
  })

  it('gameday, moves, injury, prospects, daily, features, hot seat and claims render without holes', () => {
    const c = desk('x')
    const pieces = [
      buildGameday(c, { opp: { name: 'Boston Bruins', nick: 'Bruins', city: 'Boston', record: '5-2-1', streak: 4 }, home: false, usRecord: '4-3-1', usStreak: -1, lines: LINES, starter: { name: 'Tristan Jarry', line: '.915, 4-2' }, backup: 'Alex Nedeljkovic', watch: [{ kind: 'slump', name: 'Evgeni Malkin', n: 7 }, { kind: 'oppStar', name: 'David Pastrnak', n: 11 }], playoff: false }),
      buildMoves(c, { items: [{ kind: 'callup', summary: 'Penguins recall Joel Blomqvist from WBS.' }], camp: false }),
      buildInjury(c, { beat: 'worse', playerId: 'p', name: 'Kris Letang', official: 'an upper-body injury, day-to-day', band: 'day-to-day', truth: 'a separated shoulder', missed: 6, key: true }),
      buildProspects(c, [
        { playerId: 'x', name: 'Owen Pickering', age: 21, pos: 'D', where: 'ahl', league: 'AHL', gp: 12, g: 3, pts: 10 },
        { playerId: 'y', name: 'Tanner Howe', age: 19, pos: 'W', where: 'junior', league: 'WHL', club: 'Regina Pats (WHL)', gp: 14, g: 11, pts: 22 },
      ]),
      buildDaily(c, { top: 'the Rangers-Bruins trade', yesterday: { text: 'a 4-2 win over Boston', won: true }, division: ['Rangers beat Devils 3-2.'], wire: [{ source: 'Vic Mercer', text: 'Hearing the Rangers are close on a deal', why: 'division', team: 'New York Rangers', gap: '2 points ahead' }] }),
      buildFeature(c, { feature: 'thanksgiving', ctx: { inSpot: false }, slots: { rank: '10th in the conference', gap: '3 points', pts: '22', gp: '21', record: '10-9-2' }, paragraphs: ['A fact.'], dek: 'dek' }),
      buildFeature(c, { feature: 'deadline', ctx: { stance: 'buy' }, slots: { rank: '4th', need: 'a top-four defenceman', space: '$3.5 million', record: '30-20-5' }, paragraphs: [], dek: 'dek' }),
      buildHotSeat(c, 'radar', { coach: 'Dan Muse', record: '8-14-3', rank: '29th in the league', expected: 'top-12', gm: 'the GM' }),
      buildClaimPiece(c, 'coachBacked', false, { gm: 'the GM', when: 'November 2029', quote: 'Dan Muse has my full support.', name: 'Dan Muse', coach: 'Dan Muse', outcome: 'He was fired.' }),
    ]
    for (const a of pieces) {
      expect(a).not.toBeNull()
      noSlots(allText(a!))
    }
  })

  it('a mailbag answers with the numbers it was given, and needs three real questions', () => {
    const items: MailItem[] = [
      { topic: 'cap', verdict: 'tight', label: 'the cap', slots: { space: '$1.2 million', used: '99%', ufas: '', nick: 'Penguins' }, weight: 3 },
      { topic: 'goalie', verdict: 'switch', label: 'the goaltending', slots: { starter: 'Tristan Jarry', backup: 'Alex Nedeljkovic', ssv: '.889', bsv: '.921', sgp: '15', bgp: '6' }, weight: 4 },
      { topic: 'playoffs', verdict: 'bubble', label: 'the playoff race', slots: { rank: '9th', gap: '2', left: '30', nick: 'Penguins' }, weight: 5 },
    ]
    const a = buildMailbag(desk('mb'), items, (k) => `@Fan${k.length}`)!
    noSlots(allText(a))
    expect(a.qa).toHaveLength(3)
    expect(allText(a)).toContain('.921')
    expect(buildMailbag(desk('mb'), items.slice(0, 2), () => '@x')).toBeNull()
  })

  it('persisted pieces rotate through the ledger: a season of notebooks does not repeat a headline early', () => {
    const ledger: ContentUse[] = []
    const heads = new Set<string>()
    for (let d = 1; d <= 8; d++) {
      const c = { ...desk('nb', 'neutral', ledger), day: d, key: `beat|nb|t-pit|2029|${d}` }
      const a = buildNotebook(c, { lines: LINES, changes: [], absent: [], scratches: [], chopping: [], coachName: 'Dan Muse' })!
      heads.add(a.headline)
    }
    expect(heads.size).toBe(8)
  })
})

/* ─────────────────────────── injury disclosure ─────────────────────────── */

describe('injury disclosure', () => {
  const base = { playerName: 'Kris Letang', teamId: 't', year: 2029, day: 10, kind: 'upperBody', truth: 'a separated shoulder', description: 'separated shoulder on a hit', playoff: false }

  it('the official line is vague and shades light, heavy or true — never invents a diagnosis', () => {
    const stances = new Map<string, number>()
    for (let i = 0; i < 300; i++) {
      const d = discloseInjury({ ...base, playerId: `p${i}`, totalGames: 9 })
      stances.set(d.stance, (stances.get(d.stance) ?? 0) + 1)
      expect(officialLine(d)).toMatch(/^an? (upper|lower)-body injury, (day|week|month)-to-(day|week|month)$|indefinitely$/)
      if (d.stance === 'straight') expect(d.band).toBe('week-to-week')
      if (d.stance === 'optimistic') expect(d.band).toBe('day-to-day')
    }
    expect(stances.get('optimistic')! > 30).toBe(true)
    expect(stances.get('straight')! > 30).toBe(true)
  })

  it('a concussion is announced as upper-body, as the league does', () => {
    const d = discloseInjury({ ...base, playerId: 'c', kind: 'concussion', truth: 'a concussion', description: 'concussion', totalGames: 12 })
    expect(d.region).toBe('upper-body')
  })

  it('worse than thought fires only past the announced band; ahead only against a cautious band', () => {
    const d = discloseInjury({ ...base, playerId: 'w', totalGames: 9 })
    d.stance = 'optimistic'
    d.band = 'day-to-day'
    d.gamesMissed = BAND_RANGE['day-to-day'][1] + 1
    expect(nextDisclosureBeat(d, 5, 4)).toBe('worse')
    d.worse = true
    d.revealed = true
    expect(nextDisclosureBeat(d, 6, 3)).toBeNull()
    const e = discloseInjury({ ...base, playerId: 'a', totalGames: 3 })
    e.stance = 'cautious'
    e.band = 'week-to-week'
    e.returned = true
    e.gamesMissed = 3
    e.revealed = true
    expect(nextDisclosureBeat(e, 4, 0)).toBe('ahead')
  })

  it('a vague engine note has no diagnosis to reveal', () => {
    const d = discloseInjury({ ...base, playerId: 'v', truth: 'a lower-body injury', description: 'lower-body injury', kind: 'lowerBody', totalGames: 10 })
    expect(d.specific).toBe(false)
    expect(nextDisclosureBeat(d, 5, 5)).not.toBe('reveal')
  })
})

/* ─────────────────────────── cast, market, pressers ─────────────────────────── */

describe('cast and market', () => {
  it('each club has a stable, named outlet; the national cast names are never reused', () => {
    const t = { id: 'x1', name: 'Pittsburgh Penguins', city: 'Pittsburgh', abbreviation: 'PIT' }
    expect(beatOutletFor(t)).toEqual(beatOutletFor(t))
    for (let i = 0; i < 64; i++) {
      const o = beatOutletFor({ ...t, id: `team-${i}` })
      expect(o.writer.last).not.toMatch(/Carver|Mercer|Doyle/)
      expect(o.outlet.length).toBeGreaterThan(5)
    }
  })

  it('market heat: Toronto loud, Pittsburgh established, Florida quiet', () => {
    const m = (city: string, name: string) => marketProfile({ id: city, city, name, abbreviation: 'X' })
    expect(m('Toronto', 'Toronto Maple Leafs')).toMatchObject({ tier: 3, canadian: true })
    expect(m('Pittsburgh', 'Pittsburgh Penguins').tier).toBe(2)
    expect(m('Sunrise', 'Florida Panthers').tier).toBe(1)
    expect(m('Toronto', 'Toronto Maple Leafs').boardEdge).toBeGreaterThan(m('Sunrise', 'Florida Panthers').boardEdge)
  })
})

describe('pressers are choices', () => {
  it('every topic offers answers with different tones, a hint each, and a real question', () => {
    const topics: PresserTopic[] = ['playerPlans', 'hotSeat', 'seasonClaim', 'blowout', 'skid']
    for (const t of topics) {
      const p = presserPrompt(t, { name: 'Evgeni Malkin', first: 'Evgeni', coach: 'Dan Muse', record: '8-12-3', rank: '28th', score: '6-1', opp: 'Boston', n: '5' }, `k|${t}`, { goalieName: 'Tristan Jarry' })
      expect(p.question.length, t).toBeGreaterThan(8)
      expect(p.question).not.toMatch(/\{[a-zA-Z]/)
      expect(p.options.length).toBeGreaterThanOrEqual(3)
      expect(new Set(p.options.map((o) => o.tone)).size).toBeGreaterThanOrEqual(2)
      for (const o of p.options) expect(o.hint.length).toBeGreaterThan(10)
    }
  })
})
