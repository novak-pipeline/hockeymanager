/**
 * Season Wrapped builder — which cards fire when, that nothing fires without
 * a genuine trigger (no filler), hindsight correctness, and that the champion
 * is ALWAYS the bracket's champion (never "your club", whoever won).
 */
import { describe, expect, it } from 'vitest'
import {
  buildWrapped, commitYear, emptyWrapped, normalizeWrapped, numberWord, tradeSideSummary, MAX_CONTENT_CARDS, MAX_HINDSIGHT_CARDS,
  type WLine, type WPlayer, type WrappedFacts, type WrappedTeamChip, type WSeries,
} from './wrapped'

const TEAMS: WrappedTeamChip[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((x, i) => ({
  id: `t${x}`, abbr: `${x}${x}${x}`, name: `City${x} ${x}birds`, short: `${x}birds`, primary: 0x100000 * (i + 1), secondary: 0xffffff,
}))

function pl(id: string, over: Partial<WPlayer> = {}): WPlayer {
  return { id, name: `Player ${id.toUpperCase()}`, pos: 'C', age: 26, ...over }
}

function line(id: string, teamId: string | null, over: Partial<WLine> = {}): WLine {
  return {
    player: pl(id, teamId ? { teamId } : {}), teamId, gp: 80, g: 20, a: 25, pts: 45, prevPts: 44, prevGp: 80,
    goalieWins: 0, svPct: 0, shotsAgainst: 0, shutouts: 0, rookie: false, ...over,
  }
}

/** A 3-round, 8-team bracket where tB beats tC in the Final and the user (tA) goes out in round 1. */
function baseFacts(over: Partial<WrappedFacts> = {}): WrappedFacts {
  const standings = TEAMS.map((t, i) => ({
    teamId: t.id, rank: i + 1, gp: 82, w: 50 - i * 3, l: 25 + i * 3, otl: 7, pts: 107 - i * 6, gf: 280 - i * 8, ga: 220 + i * 8,
  }))
  const series: WSeries[] = [
    { round: 1, roundName: 'Quarterfinals', winnerId: 'tH', loserId: 'tA', winnerWins: 4, loserWins: 2 },
    { round: 1, roundName: 'Quarterfinals', winnerId: 'tB', loserId: 'tG', winnerWins: 4, loserWins: 1 },
    { round: 1, roundName: 'Quarterfinals', winnerId: 'tC', loserId: 'tF', winnerWins: 4, loserWins: 3 },
    { round: 1, roundName: 'Quarterfinals', winnerId: 'tD', loserId: 'tE', winnerWins: 4, loserWins: 0 },
    { round: 2, roundName: 'Semifinals', winnerId: 'tB', loserId: 'tH', winnerWins: 4, loserWins: 1 },
    { round: 2, roundName: 'Semifinals', winnerId: 'tC', loserId: 'tD', winnerWins: 4, loserWins: 2 },
    { round: 3, roundName: 'Final', winnerId: 'tB', loserId: 'tC', winnerWins: 4, loserWins: 3 },
  ]
  return {
    year: 2027,
    userTeamId: 'tA',
    teams: TEAMS,
    standings,
    predictedRank: 2,
    series,
    championId: 'tB',
    playoffRounds: 3,
    bestOf: 7,
    qualifiers: TEAMS.map((t) => t.id),
    conferenceOf: {},
    awards: [],
    lines: [],
    userRoster: [],
    draft: [],
    lotteryWinnerId: null,
    trades: [],
    userSignings: [],
    retirements: [],
    records: [],
    milestones: [],
    championHistory: [],
    markHistory: [],
    coachChanges: [],
    told: [],
    hindsight: { draft: [], trades: [], scout: [], walked: [] },
    ...over,
  }
}

const kinds = (facts: WrappedFacts): string[] => buildWrapped(facts).cards.map((c) => c.kind)
const card = (facts: WrappedFacts, kind: string) => buildWrapped(facts).cards.find((c) => c.kind === kind)

describe('Season Wrapped — champion correctness', () => {
  it('names the bracket champion, never the user, when the user did not win', () => {
    const y = buildWrapped(baseFacts())
    expect(y.champion?.id).toBe('tB')
    const champ = y.cards.find((c) => c.kind === 'champion')!
    expect(champ.team?.id).toBe('tB')
    expect(champ.versus?.id).toBe('tC')
    expect(champ.hero?.value).toBe('4–3')
    // Nothing anywhere tells the user HIS club are champions.
    const all = y.cards.map((c) => `${c.headline} ${c.body}`).join(' ')
    expect(all).not.toMatch(/Abirds are the last team|You won the whole thing|^Champions\./)
    expect(y.tagline).toBe('Out in the first round')
    const outro = y.cards.find((c) => c.kind === 'outro')!
    expect(outro.list?.find((r) => r.label === 'Champion')?.value).toBe('CityB Bbirds')
  })

  it('a user Cup is the YOUR YEAR climax — and the league card does not repeat it', () => {
    const f = baseFacts({ championId: 'tA' })
    f.series = f.series.map((s) => (s.loserId === 'tA' ? { ...s, winnerId: 'tA', loserId: 'tH' } : s))
    f.series = f.series.map((s) => (s.round >= 2 && s.winnerId === 'tB' ? { ...s, winnerId: 'tA' } : s))
    f.series = f.series.map((s) => (s.round === 2 && s.loserId === 'tH' ? { ...s, loserId: 'tB' } : s))
    const y = buildWrapped(f)
    expect(y.tagline).toBe('Champions')
    expect(y.champion?.id).toBe('tA')
    expect(y.cards.some((c) => c.kind === 'champion')).toBe(false)
    const run = y.cards.find((c) => c.kind === 'yourRun')!
    expect(run.hero?.value).toBe('CHAMPIONS')
    // Three rounds of best-of-seven = twelve wins, not a hard-coded sixteen.
    expect(`${run.headline} ${run.body}`).not.toMatch(/Sixteen/)
  })

  it('no playoffs → no champion card, and the outro claims no champion', () => {
    const y = buildWrapped(baseFacts({ championId: null, series: [], qualifiers: [] }))
    expect(y.champion).toBeNull()
    expect(y.cards.some((c) => c.kind === 'champion')).toBe(false)
    expect(y.cards.find((c) => c.kind === 'outro')!.list!.some((r) => r.label === 'Champion')).toBe(false)
  })
})

describe('Season Wrapped — no filler', () => {
  it('a quiet year is cover + your run + champion + outro, nothing invented', () => {
    const f = baseFacts()
    f.standings[0] = { ...f.standings[0]!, gf: 250, ga: 240 } // an unremarkable differential
    expect(kinds(f)).toEqual(['cover', 'yourRun', 'champion', 'outro'])
  })

  it('an ordinary scorer does not get an MVP card; a real one does', () => {
    const quiet = baseFacts({ lines: [line('p1', 'tA', { pts: 30, g: 10, a: 20 })] })
    expect(kinds(quiet)).not.toContain('yourMvp')
    const star = baseFacts({ lines: [line('p1', 'tA', { pts: 88, g: 40, a: 48 })] })
    const mvp = card(star, 'yourMvp')!
    expect(mvp.hero?.value).toBe('88')
    expect(mvp.players?.[0]?.id).toBe('p1')
  })

  it('breakouts need a real jump', () => {
    const small = baseFacts({ lines: [line('big', 'tA', { pts: 90 }), line('p2', 'tA', { pts: 44, prevPts: 34 })] })
    expect(kinds(small)).not.toContain('yourBreakout')
    const leap = baseFacts({ lines: [line('big', 'tA', { pts: 90 }), line('p2', 'tA', { pts: 58, prevPts: 30 })] })
    expect(card(leap, 'yourBreakout')?.hero?.value).toBe('+28')
  })

  it('never exceeds the content cap, and hindsight never crowds the year', () => {
    const lines: WLine[] = []
    for (let i = 0; i < 30; i++) lines.push(line(`s${i}`, 'tA', { pts: 40 + i, g: 22, prevPts: 10 }))
    const draft = Array.from({ length: 5 }, (_, i) => ({
      draftYear: 2020 + i,
      userPick: { player: pl(`u${i}`), overall: 12, careerPts: 10, gp: 70, ovr: 60 },
      bestAfter: { player: pl(`l${i}`), overall: 20 + i, teamId: 'tC', careerPts: 220, gp: 300, ovr: 80 },
      outscoredAhead: 0, pickedAhead: 11,
    }))
    const y = buildWrapped(baseFacts({
      lines,
      awards: [{ award: 'Most Valuable Player', player: pl('s29'), teamId: 'tA', value: '69 PTS' }],
      draft: [{ player: pl('d1', { age: 18 }), teamId: 'tE', overall: 1, round: 1 }],
      hindsight: { draft, trades: [], scout: [], walked: [] },
    }))
    const content = y.cards.filter((c) => c.section !== 'cover' && c.section !== 'outro')
    expect(content.length).toBeLessThanOrEqual(MAX_CONTENT_CARDS)
    expect(content.filter((c) => c.section === 'hindsight').length).toBeLessThanOrEqual(MAX_HINDSIGHT_CARDS)
    expect(new Set(y.cards.map((c) => c.id)).size).toBe(y.cards.length)
  })

  it('is deterministic — the same facts always read the same', () => {
    const f = baseFacts({ lines: [line('p1', 'tA', { pts: 88 })] })
    expect(JSON.stringify(buildWrapped(f))).toBe(JSON.stringify(buildWrapped(f)))
  })
})

describe('Season Wrapped — the league and history', () => {
  it('first overall names the pick and the club that made it', () => {
    const f = baseFacts({ draft: [
      { player: pl('kid', { name: 'Kid Wonder', age: 18 }), teamId: 'tG', overall: 1, round: 1 },
      { player: pl('mine', { name: 'Our Guy' }), teamId: 'tA', overall: 9, round: 1 },
    ] })
    const c = card(f, 'firstOverall')!
    expect(c.headline + c.body).toMatch(/Kid Wonder/)
    expect(c.team?.id).toBe('tG')
    expect(c.list?.[0]?.value).toBe('Our Guy')
  })

  it('a regular-season doormat beating a juggernaut is an upset; a close seed is not', () => {
    const f = baseFacts()
    // tH (8th, 65 pts) over tB (2nd, 101 pts) — rewrite round 1.
    f.series = [{ round: 1, roundName: 'Quarterfinals', winnerId: 'tH', loserId: 'tB', winnerWins: 4, loserWins: 3 }, ...f.series.slice(2)]
    expect(card(f, 'upset')?.team?.id).toBe('tH')
    expect(kinds(baseFacts())).not.toContain('upset') // tD over tE is 6 points apart
  })

  it('first 60-goal season since … only when the wait was real', () => {
    const scorer = line('sniper', 'tC', { g: 61, pts: 101 })
    const long = baseFacts({ lines: [scorer], markHistory: [{ year: 2014, stat: 'goals', value: 63 }, { year: 2024, stat: 'goals', value: 48 }] })
    const c = card(long, 'historySince')!
    expect(c.headline).toMatch(/2014|thirteen years/i)
    const recent = baseFacts({ lines: [scorer], markHistory: [{ year: 2025, stat: 'goals', value: 62 }] })
    expect(kinds(recent)).not.toContain('historySince')
  })

  it('droughts, dynasties and firsts come from the champion history', () => {
    const drought = baseFacts({ championHistory: [{ year: 2001, teamId: 'tB', name: null }, { year: 2026, teamId: 'tC', name: null }] })
    expect(card(drought, 'droughtEnded')?.hero?.value).toBe('26')
    const repeat = baseFacts({ championHistory: [{ year: 2026, teamId: 'tB', name: null }] })
    expect(card(repeat, 'dynasty')?.headline).toBeTruthy()
    const hist = Array.from({ length: 20 }, (_, i) => ({ year: 2006 + i, teamId: i % 2 ? 'tC' : 'tD', name: null }))
    expect(kinds(baseFacts({ championHistory: hist }))).toContain('franchiseFirst')
    // A shallow book cannot claim a franchise first.
    expect(kinds(baseFacts({ championHistory: hist.slice(-5) }))).not.toContain('franchiseFirst')
  })

  it('a record card only when the book actually changed hands', () => {
    const f = baseFacts({ records: [{ stat: 'goals', value: 93, player: pl('g1', { name: 'Big Shot' }), teamId: 'tD', prevName: 'Old Guard', prevValue: 92, prevYear: 1993 }] })
    const c = card(f, 'recordBroken')!
    expect(c.hero?.value).toBe('93')
    expect(c.body).toMatch(/Old Guard/)
  })
})

describe('Season Wrapped — hindsight', () => {
  const draftH = (over: Partial<WrappedFacts['hindsight']['draft'][number]> = {}): WrappedFacts['hindsight']['draft'][number] => ({
    draftYear: 2024,
    userPick: { player: pl('mine', { name: 'Our Pick' }), overall: 12, careerPts: 40, gp: 150, ovr: 66 },
    bestAfter: { player: pl('later', { name: 'The Star' }), overall: 19, teamId: 'tD', careerPts: 210, gp: 230, ovr: 82 },
    outscoredAhead: 1, pickedAhead: 11,
    ...over,
  })

  it('you passed on him at #12 — and an award makes it the headline', () => {
    const plain = card(baseFacts({ hindsight: { draft: [draftH()], trades: [], scout: [], walked: [] } }), 'hindsightDraft')!
    expect(plain.body + plain.headline).toMatch(/The Star/)
    expect(plain.body + plain.headline).toMatch(/12/)
    const f = draftH()
    f.bestAfter!.award = 'Rookie of the Year'
    const award = card(baseFacts({ hindsight: { draft: [f], trades: [], scout: [], walked: [] } }), 'hindsightDraft')!
    expect(award.headline).toMatch(/Calder Trophy/)
  })

  it('no regret when your pick holds up', () => {
    const f = draftH({ userPick: { player: pl('mine'), overall: 12, careerPts: 190, gp: 230, ovr: 81 } })
    expect(kinds(baseFacts({ hindsight: { draft: [f], trades: [], scout: [], walked: [] } }))).not.toContain('hindsightDraft')
  })

  it('a story told once is not told again next summer', () => {
    const facts = baseFacts({ hindsight: { draft: [draftH()], trades: [], scout: [], walked: [] } })
    const first = buildWrapped(facts).cards.find((c) => c.kind === 'hindsightDraft')!
    expect(first.subject).toBeTruthy()
    const again = buildWrapped({ ...facts, year: 2028, told: [first.subject!] })
    expect(again.cards.some((c) => c.kind === 'hindsightDraft')).toBe(false)
  })

  it('trades are re-graded on what each side produced since — and a wash is no card', () => {
    const t = { id: 'ch-2025-000001', tradeYear: 2025, partnerId: 'tE', headline: 'AAA trade C Old Vet to EEE for C Young Gun',
      gotValue: 140, gaveValue: 35, gotNames: ['Young Gun'], gaveNames: ['Old Vet'],
      gotSummary: 'Young Gun', gaveSummary: 'Old Vet and a 2026 first-round pick', gotUnripe: false, gaveUnripe: false }
    const won = card(baseFacts({ hindsight: { draft: [], trades: [t], scout: [], walked: [] } }), 'hindsightTrade')!
    expect(won.headline + won.body).toMatch(/won|winner/)
    expect(won.stats?.[0]?.value).toBe('140')
    const lost = card(baseFacts({ hindsight: { draft: [], trades: [{ ...t, gotValue: 20, gaveValue: 120 }], scout: [], walked: [] } }), 'hindsightTrade')!
    expect(lost.headline + lost.body).toMatch(/got away|ages badly|still producing/)
    expect(kinds(baseFacts({ hindsight: { draft: [], trades: [{ ...t, gotValue: 60, gaveValue: 55 }], scout: [], walked: [] } }))).not.toContain('hindsightTrade')
  })

  it('a deal is not "won" against picks that are still teenagers — until the fourth summer', () => {
    const t = { id: 'ch-2025-000002', tradeYear: 2025, partnerId: 'tE', headline: 'x', gotValue: 120, gaveValue: 0,
      gotNames: ['Vet'], gaveNames: [], gotSummary: 'Vet', gaveSummary: 'a 2026 first-round pick (now Kid)', gotUnripe: false, gaveUnripe: true }
    expect(kinds(baseFacts({ hindsight: { draft: [], trades: [t], scout: [], walked: [] } }))).not.toContain('hindsightTrade')
    expect(kinds(baseFacts({ year: 2029, hindsight: { draft: [], trades: [t], scout: [], walked: [] } }))).toContain('hindsightTrade')
  })

  it('says trade sides aloud: names, picks grouped by round, used picks named', () => {
    expect(tradeSideSummary([{ pickLabel: '2026 R1 (PHV)' }, { pickLabel: '2027 R1 (PHV)' }, { pickLabel: '2027 R2 (PHV)' }]))
      .toBe('two first-round picks and a 2027 second-round pick')
    expect(tradeSideSummary([{ name: 'Nick Kane' }, { pickLabel: '2026 R1 (BOS)', became: 'Kid Star' }]))
      .toBe('Nick Kane and a 2026 first-round pick (now Kid Star)')
    expect(tradeSideSummary([])).toBe('future considerations')
    const bag = [1, 2, 3, 4, 5, 6].map((r) => ({ pickLabel: `2030 R${7 - r} (FLA)` }))
    expect(tradeSideSummary(bag)).toBe('a 2030 first-round pick and five more picks')
  })

  it("your scout called this bust — graded against where the player is now", () => {
    const call = { playerId: 'bust', playerName: 'Can’t Miss', pos: 'C', year: 2023, overallPick: 4, teamId: 'tE', userPick: false,
      scoutName: 'Walt Kemper', ceiling: 66, role: 'Bottom-six F' }
    const s = { call, nowOvr: 52, nowRole: 'AHL F', gp: 12, pts: 3, age: 22, player: pl('bust', { name: 'Can’t Miss' }) }
    const c = card(baseFacts({ hindsight: { draft: [], trades: [], scout: [s], walked: [] } }), 'hindsightScout')!
    expect(c.headline + c.body).toMatch(/Walt Kemper|scout/i)
    // Too soon to call → no card.
    const early = { ...s, call: { ...call, year: 2026 } }
    expect(kinds(baseFacts({ hindsight: { draft: [], trades: [], scout: [early], walked: [] } }))).not.toContain('hindsightScout')
  })

  it('the one who walked: a star elsewhere is regret, an expensive flop is relief, the middle is silence', () => {
    const w = { player: pl('w1', { name: 'Gone Guy' }), newTeamId: 'tF', pts: 71, gp: 80, goalieWins: 0, salary: 7.5e6 }
    expect(card(baseFacts({ hindsight: { draft: [], trades: [], scout: [], walked: [w] } }), 'hindsightWalked')?.team?.id).toBe('tF')
    const flop = { ...w, pts: 14 }
    expect(card(baseFacts({ hindsight: { draft: [], trades: [], scout: [], walked: [flop] } }), 'hindsightWalked')?.headline).toMatch(/right call|did not give/)
    const meh = { ...w, pts: 38, salary: 3e6 }
    expect(kinds(baseFacts({ hindsight: { draft: [], trades: [], scout: [], walked: [meh] } }))).not.toContain('hindsightWalked')
  })
})

describe('Season Wrapped — craft', () => {
  it('numbers read as words where prose wants them', () => {
    expect(numberWord(7)).toBe('seven')
    expect(numberWord(21)).toBe('twenty-one')
    expect(numberWord(40)).toBe('forty')
    expect(numberWord(140)).toBe('140')
  })
})

describe('Season Wrapped — persistence', () => {
  it('normalizes anything an old or damaged save hands it', () => {
    expect(normalizeWrapped(undefined)).toEqual(emptyWrapped())
    expect(normalizeWrapped({ years: 'nope', told: [1, 'x'] }).told).toEqual(['x'])
  })

  it('commitYear replaces a rebuilt year, keeps order and marks it pending', () => {
    const s = emptyWrapped()
    commitYear(s, buildWrapped(baseFacts({ year: 2028 })))
    commitYear(s, buildWrapped(baseFacts({ year: 2027 })))
    commitYear(s, buildWrapped(baseFacts({ year: 2028 })))
    expect(s.years.map((y) => y.year)).toEqual([2027, 2028])
    expect(s.pendingYear).toBe(2028)
  })
})
