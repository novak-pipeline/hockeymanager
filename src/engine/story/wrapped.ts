/**
 * SEASON WRAPPED — the once-a-year "Spotify Wrapped" card sequence
 * (docs/SEASON-WRAPPED.md).
 *
 * Pure + deterministic. The Career gathers plain-data {@link WrappedFacts} at the
 * wrap point (the moment the entry draft closes the league year) and this
 * module turns them into a {@link WrappedYear}: 8–14 strong content cards
 * across four sections — YOUR YEAR, THE LEAGUE'S YEAR, HISTORY, HINDSIGHT —
 * bookended by a cover and an outro. A card only exists when its trigger fires;
 * there is no filler card, and a thin year produces a short sequence.
 *
 * The built cards are persisted verbatim (text + the chips they draw with) in
 * {@link WrappedState}, so a yearbook page from 2031 still renders in 2045
 * after every source it was built from has rolled over or been pruned.
 *
 * Copy comes from authored pools in wrappedCopy.ts via pickStable, keyed on
 * year + card + subject — no Rng, no ledger writes, same text on every reopen.
 */
import { renderTemplate, type ContentCtx, type ContentVariant } from './contentEngine'
import { pickStable, prosaicList } from './prose'
import {
  AWARDS_POOL, BREAKOUT_POOL, CHAMPION_POOL, COACHING_POOL, DROUGHT_POOL, DYNASTY_POOL,
  FIRST_CUP_POOL, FIRST_OVERALL_POOL, HS_DRAFT_POOL, HS_SCOUT_POOL, HS_TRADE_POOL, HS_WALKED_POOL,
  LEAGUE_BREAKOUT_POOL, LEAGUE_TRADE_POOL, MILESTONE_POOL, MVP_POOL, OUTRO_POOL, RECORD_POOL,
  RETIREMENT_POOL, RUN_POOL, SIGNING_POOL, SINCE_POOL, STAT_POOL, UPSET_POOL, WORST_CALL_POOL,
  YOUR_TRADE_POOL,
} from './wrappedCopy'

/* ────────────────────────── persisted card model ────────────────────────── */

export type WrappedSection = 'cover' | 'you' | 'league' | 'history' | 'hindsight' | 'outro'

export type WrappedCardKind =
  | 'cover'
  | 'yourRun' | 'yourMvp' | 'yourBreakout' | 'yourStat' | 'yourTrade' | 'yourSigning' | 'yourWorstCall'
  | 'champion' | 'upset' | 'awards' | 'recordBroken' | 'milestones' | 'firstOverall'
  | 'leagueBreakout' | 'leagueTrade' | 'coachingCarousel' | 'retirements'
  | 'dynasty' | 'droughtEnded' | 'franchiseFirst' | 'historySince'
  | 'hindsightDraft' | 'hindsightTrade' | 'hindsightScout' | 'hindsightWalked'
  | 'outro'

/** A club as a card draws it — colours included, so old years render forever. */
export interface WrappedTeamChip {
  id: string
  abbr: string
  name: string
  /** Short display name ("Stingrays"); falls back to the full name. */
  short: string
  primary: number
  secondary: number
}

export interface WrappedPlayerChip {
  id: string
  name: string
  pos: string
  faceId?: string
  /** Team whose colour the face avatar is painted in. */
  teamId?: string
}

export interface WrappedStat {
  value: string
  label: string
}

export interface WrappedListRow {
  label: string
  value: string
  sub?: string
  playerId?: string
  teamId?: string
}

export interface WrappedCard {
  /** Stable: `${year}-${kind}`. */
  id: string
  kind: WrappedCardKind
  section: WrappedSection
  /** Small caps label over the headline. */
  kicker: string
  headline: string
  body: string
  /** The one big number. */
  hero?: WrappedStat
  /** Up to three supporting stats. */
  stats?: WrappedStat[]
  /** Club whose colours paint the card. */
  team?: WrappedTeamChip
  /** A second club (Final opponent, trade partner) for a versus layout. */
  versus?: WrappedTeamChip
  /** Faces, most important first (≤ 3). */
  players?: WrappedPlayerChip[]
  list?: WrappedListRow[]
  /** Salience 0–100 — what survives when a year has more than MAX cards. */
  weight: number
  /** HINDSIGHT only: the story's identity, so the same verdict is told once
   *  across a whole save (a pick you regret does not headline every summer). */
  subject?: string
}

export interface WrappedYear {
  year: number
  /** "2026–27". */
  seasonLabel: string
  userTeam: WrappedTeamChip
  champion: WrappedTeamChip | null
  /** One line for the yearbook tile ("Champions", "Out in round two"…). */
  tagline: string
  /** User's record, "47–25–10". */
  record: string
  cards: WrappedCard[]
}

/** A scouting call written down at the draft, graded years later (HINDSIGHT). */
export interface WrappedScoutCall {
  playerId: string
  playerName: string
  pos: string
  /** Chronicle season year the draft closed (the class is year + 1). */
  year: number
  overallPick: number
  teamId: string
  /** True when YOUR club drafted him. */
  userPick: boolean
  scoutName: string
  /** 0–100 ceiling your scouts had on him that day. */
  ceiling: number
  /** Role label for that ceiling ("Top-six F"). */
  role: string
}

export interface WrappedState {
  version: 1
  /** Every built year, oldest first. */
  years: WrappedYear[]
  /** A year built but not yet watched — the renderer plays it as an event. */
  pendingYear: number | null
  /** Chronicle counter at the last build: the next year covers events after it. */
  cursor: number
  /** Your roster at the last wrap ("players you let walk"). */
  lastRoster: string[]
  lastRosterYear: number | null
  /** Scouting calls awaiting a verdict (bounded). */
  scoutCalls: WrappedScoutCall[]
  /** Hindsight subjects already told (bounded). */
  told: string[]
}

/** Yearbook tile row (additive view type, served by getWrappedYearbook). */
export interface WrappedYearbookRow {
  year: number
  seasonLabel: string
  tagline: string
  record: string
  userTeam: WrappedTeamChip
  champion: WrappedTeamChip | null
  cardCount: number
  /** The first few content headlines — the tile's teaser. */
  headlines: string[]
}

export interface WrappedYearbookView {
  pendingYear: number | null
  years: WrappedYearbookRow[]
}

export function emptyWrapped(): WrappedState {
  return { version: 1, years: [], pendingYear: null, cursor: 0, lastRoster: [], lastRosterYear: null, scoutCalls: [], told: [] }
}

/** Defensive load: any older/partial save shape becomes a valid state. */
export function normalizeWrapped(raw: unknown): WrappedState {
  const base = emptyWrapped()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<WrappedState>
  return {
    version: 1,
    years: Array.isArray(r.years) ? structuredClone(r.years) : [],
    pendingYear: typeof r.pendingYear === 'number' ? r.pendingYear : null,
    cursor: typeof r.cursor === 'number' ? r.cursor : 0,
    lastRoster: Array.isArray(r.lastRoster) ? [...r.lastRoster] : [],
    lastRosterYear: typeof r.lastRosterYear === 'number' ? r.lastRosterYear : null,
    scoutCalls: Array.isArray(r.scoutCalls) ? r.scoutCalls.map((c) => ({ ...c })) : [],
    told: Array.isArray(r.told) ? r.told.filter((x): x is string => typeof x === 'string') : [],
  }
}

/** Keep the history book finite: a 60-season save keeps every year, capped. */
export const MAX_YEARS = 60
/** Content cards per year (cover/outro not counted). */
export const MAX_CONTENT_CARDS = 14
export const MAX_HINDSIGHT_CARDS = 3
export const MAX_SCOUT_CALLS = 120

/* ────────────────────────── facts (input) ────────────────────────── */

export interface WPlayer {
  id: string
  name: string
  pos: string
  age: number
  faceId?: string
  teamId?: string
}

/** One player's settled season (regular season). */
export interface WLine {
  player: WPlayer
  teamId: string | null
  gp: number
  g: number
  a: number
  pts: number
  /** Last season's NHL points/games, when the book has them. */
  prevPts: number | null
  prevGp: number | null
  goalieWins: number
  svPct: number
  shotsAgainst: number
  shutouts: number
  rookie: boolean
}

export interface WStanding {
  teamId: string
  rank: number
  gp: number
  w: number
  l: number
  otl: number
  pts: number
  gf: number
  ga: number
}

export interface WSeries {
  round: number
  roundName: string
  winnerId: string
  loserId: string
  winnerWins: number
  loserWins: number
}

export interface WAward {
  award: string
  player: WPlayer
  teamId: string | null
  value: string
}

export interface WDraftPick {
  player: WPlayer
  teamId: string
  overall: number
  round: number
}

export interface WTradeAsset {
  /** A player moved in the deal, with what he did this season. */
  player?: WPlayer
  pts?: number
  gp?: number
  goalieWins?: number
  ovr?: number
  /** A pick moved in the deal. */
  pickLabel?: string
  pickRound?: number
  /** The pick was used in this year's draft on… */
  became?: WPlayer
}

export interface WTrade {
  id: string
  /** Side 0 is the user's club when the user was involved. */
  teams: [string, string]
  /** received[i] = what teams[i] got. */
  received: [WTradeAsset[], WTradeAsset[]]
  userInvolved: boolean
}

export interface WSigning {
  player: WPlayer
  teamId: string
  salary: number
  years: number
  pts: number
  gp: number
  goalieWins: number
  ovr: number
}

export interface WRetirement {
  player: WPlayer
  seasons: number
  gp: number
  g: number
  pts: number
  shutouts: number
  lastTeamId: string | null
}

export interface WRecord {
  stat: 'goals' | 'assists' | 'points' | 'wins' | 'shutouts' | 'savePct'
  value: number
  player: WPlayer
  teamId: string | null
  prevName: string
  prevValue: number
  prevYear: number
}

export interface WMilestone {
  player: WPlayer
  teamId: string | null
  kind: 'g' | 'p' | 'gp' | 'so'
  n: number
  major: boolean
}

export interface WHindsightDraft {
  draftYear: number
  userPick: { player: WPlayer; overall: number; careerPts: number; gp: number; ovr: number; award?: string }
  /** The best player taken AFTER your pick in the same draft. */
  bestAfter?: { player: WPlayer; overall: number; teamId: string; careerPts: number; gp: number; ovr: number; award?: string }
  /** How many players taken BEFORE yours he has outscored (the steal case). */
  outscoredAhead: number
  pickedAhead: number
}

export interface WHindsightTrade {
  id: string
  tradeYear: number
  partnerId: string
  headline: string
  /** Each side said aloud ("Nick Kane and a 2027 first-round pick"). */
  gotSummary: string
  gaveSummary: string
  /** A side still holds unripe futures (an unused pick, or a pick now a
   *  teenager): too early to call it lost for that side. */
  gotUnripe: boolean
  gaveUnripe: boolean
  gotValue: number
  gaveValue: number
  gotNames: string[]
  gaveNames: string[]
  gotLead?: WPlayer
  gaveLead?: WPlayer
}

export interface WHindsightScout {
  call: WrappedScoutCall
  nowOvr: number
  nowRole: string
  gp: number
  pts: number
  age: number
  player: WPlayer
}

export interface WHindsightWalked {
  player: WPlayer
  newTeamId: string
  pts: number
  gp: number
  goalieWins: number
  salary: number
  award?: string
}

export interface WCoachChange {
  kind: 'coachFired' | 'coachHired' | 'gmChange'
  teamId: string
  headline: string
}

export interface WrappedFacts {
  year: number
  userTeamId: string
  teams: WrappedTeamChip[]
  /** Final regular-season order, rank 1 first. */
  standings: WStanding[]
  /** Your club's September projection (1 = favourite), when known. */
  predictedRank: number | null
  /** Every finished playoff series. Empty when no playoffs were played. */
  series: WSeries[]
  /** Straight from the playoff result — never inferred. */
  championId: string | null
  /** Round count of the bracket (4 in a 32-team league). */
  playoffRounds: number
  bestOf: number
  /** Teams that made the playoffs. */
  qualifiers: string[]
  /** Conference of each club (for "missed by N points"). */
  conferenceOf: Record<string, string>
  awards: WAward[]
  lines: WLine[]
  /** Your roster at the wrap point. */
  userRoster: string[]
  draft: WDraftPick[]
  /** The #1 pick moved up via the lottery. */
  lotteryWinnerId: string | null
  trades: WTrade[]
  userSignings: WSigning[]
  retirements: WRetirement[]
  records: WRecord[]
  milestones: WMilestone[]
  /** Prior seasons' champions (not this one). */
  championHistory: Array<{ year: number; teamId: string | null; name: string | null }>
  /** Prior seasons' best single-season marks per stat. */
  markHistory: Array<{ year: number; stat: 'goals' | 'points' | 'assists'; value: number }>
  coachChanges: WCoachChange[]
  /** Hindsight subjects told in earlier years (never re-told). */
  told: string[]
  hindsight: {
    draft: WHindsightDraft[]
    trades: WHindsightTrade[]
    scout: WHindsightScout[]
    walked: WHindsightWalked[]
  }
}

/* ────────────────────────── small craft helpers ────────────────────────── */

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** 0–99 in words ("twenty-one"); larger numbers stay digits. */
export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n)
  if (n <= 20) return SMALL[n]!
  const t = TENS[Math.floor(n / 10)]!
  return n % 10 === 0 ? t : `${t}-${SMALL[n % 10]}`
}

function cap(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s
}

export function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** "nine years", "a decade", "a quarter-century" — a gap, said aloud. */
export function yearsWords(n: number): string {
  if (n === 1) return 'a year'
  if (n === 10) return 'a decade'
  if (n === 25) return 'a quarter-century'
  if (n === 50) return 'half a century'
  return `${numberWord(n)} years`
}

function salaryWords(salary: number): string {
  const m = salary / 1e6
  if (m >= 1) return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)} million a year`
  return `$${Math.round(salary / 1000)}K a year`
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] ?? name
}

function shareWords(share: number): string {
  if (share >= 0.45) return 'nearly half of'
  if (share >= 0.38) return 'two of every five of'
  if (share >= 0.3) return 'a third of'
  if (share >= 0.24) return 'a quarter of'
  return 'a big slice of'
}

/** "Conference Semifinals" → "Conf. Semis" (list rows are narrow). */
function shortRound(name: string): string {
  return name.replace(/Conference/g, 'Conf.').replace(/Semifinals?/g, 'Semis').replace(/Quarterfinals?/g, 'Quarters').replace(/Finals/g, 'Final')
}

function record(s: WStanding | undefined): string {
  return s ? `${s.w}–${s.l}–${s.otl}` : '—'
}

function chip(p: WPlayer): WrappedPlayerChip {
  return {
    id: p.id, name: p.name, pos: p.pos,
    ...(p.faceId ? { faceId: p.faceId } : {}),
    ...(p.teamId ? { teamId: p.teamId } : {}),
  }
}

function pickCopy(pool: ContentVariant[], ctx: ContentCtx, key: string, slots: Record<string, string>): { headline: string; body: string } {
  const v = pickStable(pool, ctx, key)
  if (!v) return { headline: '', body: '' }
  return {
    headline: renderTemplate(v.text, slots),
    body: renderTemplate(v.text2 ?? '', slots),
  }
}

const AWARD_LABEL: Record<string, string> = {
  'Most Valuable Player': 'Hart Trophy',
  'Art Ross Trophy': 'Art Ross',
  'Top Goal Scorer': 'Rocket Richard',
  'Best Defenseman': 'Norris Trophy',
  'Rookie of the Year': 'Calder Trophy',
  'Best Goaltender': 'Vezina Trophy',
  'Best Playmaker': 'Playmaker award',
}
const AWARD_ORDER = ['Most Valuable Player', 'Art Ross Trophy', 'Top Goal Scorer', 'Best Defenseman', 'Rookie of the Year', 'Best Goaltender']

export function awardLabel(award: string): string {
  return AWARD_LABEL[award] ?? award
}

const STAT_NOUN: Record<WRecord['stat'], string> = {
  goals: 'goals', assists: 'assists', points: 'points', wins: 'wins', shutouts: 'shutouts', savePct: 'save percentage',
}

function fmtRecordValue(stat: WRecord['stat'], v: number, vs?: number): string {
  if (stat !== 'savePct') return String(v)
  // Two marks that round to the same .916 are shown to the fourth place.
  const digits = vs !== undefined && v.toFixed(3) === vs.toFixed(3) ? 4 : 3
  return v.toFixed(digits).replace(/^0/, '')
}

/** Production value used to compare two sides of a deal (skater points; goalie wins count 1.5). */
export function assetProduction(a: { pts?: number; goalieWins?: number; pos?: string }): number {
  if (a.pos === 'G') return Math.round((a.goalieWins ?? 0) * 1.5)
  return a.pts ?? 0
}

/* ────────────────────────── the builder ────────────────────────── */

const KIND_ORDER: WrappedCardKind[] = [
  'cover',
  'yourRun', 'yourMvp', 'yourBreakout', 'yourStat', 'yourTrade', 'yourSigning', 'yourWorstCall',
  'champion', 'upset', 'awards', 'recordBroken', 'milestones', 'firstOverall',
  'leagueBreakout', 'leagueTrade', 'coachingCarousel', 'retirements',
  'dynasty', 'droughtEnded', 'franchiseFirst', 'historySince',
  'hindsightDraft', 'hindsightTrade', 'hindsightScout', 'hindsightWalked',
  'outro',
]

const KICKER: Record<WrappedSection, string> = {
  cover: 'SEASON WRAPPED',
  you: 'YOUR YEAR',
  league: "THE LEAGUE'S YEAR",
  history: 'HISTORY',
  hindsight: 'HINDSIGHT',
  outro: 'THAT WAS THE YEAR',
}

type RunResult = 'champ' | 'final' | 'semi' | 'second' | 'first' | 'missed'

export function seasonLabel(year: number): string {
  return `${year}–${String((year + 1) % 100).padStart(2, '0')}`
}

export function buildWrapped(f: WrappedFacts): WrappedYear {
  const Y = f.year
  const teamById = new Map(f.teams.map((t) => [t.id, t]))
  const team = (id: string | null | undefined): WrappedTeamChip | undefined => (id ? teamById.get(id) : undefined)
  const short = (id: string | null | undefined): string => team(id)?.short ?? team(id)?.name ?? 'club'
  const standing = new Map(f.standings.map((s) => [s.teamId, s]))
  const nTeams = f.standings.length
  const user = team(f.userTeamId) ?? {
    id: f.userTeamId, abbr: '???', name: 'Your club', short: 'Your club', primary: 0x334155, secondary: 0xffffff,
  }
  const userSt = standing.get(f.userTeamId)
  const userSet = new Set(f.userRoster)
  const userLines = f.lines.filter((l) => l.teamId === f.userTeamId || (l.teamId === null && userSet.has(l.player.id)))
  const awardsByPlayer = new Map<string, WAward[]>()
  for (const a of f.awards) awardsByPlayer.set(a.player.id, [...(awardsByPlayer.get(a.player.id) ?? []), a])
  const key = (kind: string, subject = ''): string => `${Y}:${kind}:${subject}`
  const cards: WrappedCard[] = []
  const push = (c: Omit<WrappedCard, 'id' | 'kicker'> & { kicker?: string }): void => {
    if (!c.headline) return
    cards.push({ ...c, id: `${Y}-${c.kind}`, kicker: c.kicker ?? KICKER[c.section] })
  }

  /* ── the user's playoff run (shared by cover/run/outro) ── */
  const userSeries = f.series
    .filter((s) => s.winnerId === f.userTeamId || s.loserId === f.userTeamId)
    .sort((a, b) => a.round - b.round)
  const madePlayoffs = f.qualifiers.includes(f.userTeamId)
  const wonCup = f.championId !== null && f.championId === f.userTeamId
  const lostIn = userSeries.find((s) => s.loserId === f.userTeamId)
  const rounds = Math.max(1, f.playoffRounds)
  const result: RunResult = wonCup ? 'champ'
    : !madePlayoffs ? 'missed'
    : lostIn ? (lostIn.round >= rounds ? 'final' : lostIn.round === rounds - 1 ? 'semi' : lostIn.round === 1 ? 'first' : 'second')
    : 'first'
  const userRank = userSt?.rank ?? 0
  const pred = f.predictedRank
  const vsPick = pred === null || userRank === 0 ? 'par'
    : userRank <= pred - 4 ? 'over' : userRank >= pred + 4 ? 'under' : 'par'
  const TAGLINE: Record<RunResult, string> = {
    champ: 'Champions',
    final: 'Lost in the Final',
    semi: 'Out in the conference final',
    second: 'Out in the second round',
    first: 'Out in the first round',
    missed: 'Missed the playoffs',
  }
  const winsNeeded = Math.ceil(f.bestOf / 2)
  const springWins = winsNeeded * rounds

  /* ═════════════ COVER ═════════════ */
  push({
    kind: 'cover', section: 'cover', kicker: `SEASON WRAPPED · ${seasonLabel(Y)}`,
    headline: `${user.name}`,
    body: `${TAGLINE[result]}.${userRank ? ` ${cap(ordinal(userRank))} of ${nTeams} in the standings.` : ''}`,
    hero: { value: seasonLabel(Y), label: 'your season, wrapped' },
    stats: userSt ? [
      { value: record(userSt), label: 'W–L–OTL' },
      { value: String(userSt.pts), label: 'points' },
      { value: `${userSt.gf - userSt.ga >= 0 ? '+' : '−'}${Math.abs(userSt.gf - userSt.ga)}`, label: 'goal diff' },
    ] : [],
    team: user,
    weight: 100,
  })

  /* ═════════════ YOUR YEAR ═════════════ */

  // yourRun — always, when a season was played.
  if (userSt && userSt.gp > 0) {
    const seriesLine = userSeries.length === 0 ? '' : prosaicList(userSeries.map((s) => {
      const won = s.winnerId === f.userTeamId
      const opp = won ? s.loserId : s.winnerId
      return `${won ? 'past' : 'stopped by'} the ${short(opp)} in ${numberWord(s.winnerWins + s.loserWins)}`
    })) + '.'
    let missedLine = '.'
    if (!madePlayoffs) {
      const conf = f.conferenceOf[f.userTeamId]
      const cutoff = f.standings
        .filter((s) => f.qualifiers.includes(s.teamId) && (!conf || f.conferenceOf[s.teamId] === conf))
        .reduce((m, s) => Math.min(m, s.pts), Infinity)
      const gap = Number.isFinite(cutoff) ? cutoff - userSt.pts : 0
      missedLine = gap > 0 && gap <= 3 ? `, ${gap === 1 ? 'one point' : `${numberWord(gap)} points`} out of a playoff spot.`
        : gap > 3 && gap <= 12 ? `, ${numberWord(gap)} points from the cut line.`
        : gap > 12 ? ', nowhere near the cut line.'
        : '.'
    }
    const finalOpp = lostIn ? (lostIn.winnerId) : wonCup ? userSeries[userSeries.length - 1]?.loserId : undefined
    const forecastOut = pred !== null && f.qualifiers.length > 0 && pred > f.qualifiers.length
    const copy = pickCopy(RUN_POOL, { result, vsPick, forecastOut }, key('run', f.userTeamId), {
      teamShort: user.short,
      oppShort: short(finalOpp),
      predicted: pred ? ordinal(pred) : 'nowhere',
      rank: ordinal(userRank),
      seriesLine: seriesLine ? cap(seriesLine) : '',
      missedLine,
      springWinsCap: cap(numberWord(springWins)),
    })
    push({
      kind: 'yourRun', section: 'you',
      ...copy,
      hero: wonCup ? { value: 'CHAMPIONS', label: seasonLabel(Y) } : madePlayoffs && lostIn
        ? {
            value: lostIn.round >= rounds ? 'FINAL' : lostIn.round === rounds - 1 && rounds > 2 ? 'FINAL 4' : `ROUND ${lostIn.round}`,
            label: `out ${lostIn.loserWins}–${lostIn.winnerWins} to the ${short(lostIn.winnerId)}`,
          }
        : { value: ordinal(userRank), label: `of ${nTeams}` },
      stats: [
        ...(pred ? [{ value: ordinal(pred), label: 'preseason pick' }] : []),
        { value: ordinal(userRank), label: 'final standing' },
        { value: String(userSt.pts), label: 'points' },
      ],
      list: userSeries.map((s) => {
        const won = s.winnerId === f.userTeamId
        const opp = won ? s.loserId : s.winnerId
        return {
          label: shortRound(s.roundName),
          value: won ? `W ${s.winnerWins}–${s.loserWins}` : `L ${s.loserWins}–${s.winnerWins}`,
          sub: `vs ${team(opp)?.abbr ?? '???'}`,
          teamId: opp,
        }
      }),
      team: user,
      ...(finalOpp && team(finalOpp) ? { versus: team(finalOpp)! } : {}),
      weight: wonCup ? 99 : 90,
    })
  }

  // yourMvp
  {
    const skaters = userLines.filter((l) => l.player.pos !== 'G' && l.gp >= 20)
    const topSk = [...skaters].sort((a, b) => b.pts - a.pts)[0]
    const goalies = userLines.filter((l) => l.player.pos === 'G' && l.gp >= 25)
    const topG = [...goalies].sort((a, b) => b.goalieWins - a.goalieWins)[0]
    const gAward = topG ? (awardsByPlayer.get(topG.player.id) ?? []).find((a) => a.award === 'Best Goaltender' || a.award === 'Most Valuable Player') : undefined
    const skAward = topSk ? (awardsByPlayer.get(topSk.player.id) ?? [])[0] : undefined
    const useGoalie = !!topG && (!!gAward || (!topSk || (topSk.pts < 45 && topG.svPct >= 0.918 && topG.goalieWins >= 28)))
    if (useGoalie && topG) {
      push({
        kind: 'yourMvp', section: 'you',
        ...pickCopy(MVP_POOL, { role: 'goalie', award: !!gAward }, key('mvp', topG.player.id), {
          player: topG.player.name, teamShort: user.short, awardName: gAward ? awardLabel(gAward.award) : '',
        }),
        hero: { value: topG.svPct.toFixed(3).replace(/^0/, ''), label: 'save %' },
        stats: [{ value: String(topG.goalieWins), label: 'wins' }, { value: String(topG.gp), label: 'games' }, { value: String(topG.shutouts), label: 'shutouts' }],
        players: [chip(topG.player)], team: user,
        weight: gAward ? 80 : 70,
      })
    } else if (topSk && topSk.pts >= 35) {
      const share = userSt && userSt.gf > 0 ? topSk.pts / userSt.gf : 0
      push({
        kind: 'yourMvp', section: 'you',
        ...pickCopy(MVP_POOL, {
          role: 'skater', award: !!skAward, share: share >= 0.45 ? 'huge' : share >= 0.3 ? 'big' : 'normal',
        }, key('mvp', topSk.player.id), {
          player: topSk.player.name, teamShort: user.short, shareWords: shareWords(share),
          awardName: skAward ? awardLabel(skAward.award) : '',
        }),
        hero: { value: String(topSk.pts), label: 'points' },
        stats: [{ value: String(topSk.g), label: 'goals' }, { value: String(topSk.a), label: 'assists' }, { value: String(topSk.gp), label: 'games' }],
        players: [chip(topSk.player)], team: user,
        weight: skAward ? 80 : 70,
      })
    }
  }

  // yourBreakout
  {
    const mvpId = cards.find((c) => c.kind === 'yourMvp')?.players?.[0]?.id
    type Cand = { l: WLine; kind: 'jump' | 'rookie'; score: number }
    const cands: Cand[] = []
    for (const l of userLines) {
      if (l.player.pos === 'G' || l.player.id === mvpId || l.gp < 30) continue
      if (l.prevPts !== null && (l.prevGp ?? 0) >= 20) {
        const jump = l.pts - l.prevPts
        if (jump >= 15 && l.pts >= 35) cands.push({ l, kind: 'jump', score: jump })
      } else if (l.rookie && l.pts >= 28 && l.player.age <= 23) {
        cands.push({ l, kind: 'rookie', score: l.pts })
      }
    }
    const best = cands.sort((a, b) => b.score - a.score)[0]
    if (best) {
      const l = best.l
      push({
        kind: 'yourBreakout', section: 'you',
        ...pickCopy(BREAKOUT_POOL, { kind: best.kind }, key('breakout', l.player.id), {
          player: l.player.name, age: String(l.player.age), posPlural: l.player.pos === 'D' ? 'defencemen' : 'forwards',
        }),
        hero: best.kind === 'jump'
          ? { value: `+${l.pts - (l.prevPts ?? 0)}`, label: 'points on last season' }
          : { value: String(l.pts), label: 'rookie points' },
        stats: [
          ...(best.kind === 'jump' ? [{ value: `${l.prevPts} → ${l.pts}`, label: 'points' }] : [{ value: String(l.g), label: 'goals' }]),
          { value: String(l.player.age), label: 'age' },
        ],
        players: [chip(l.player)], team: user,
        weight: 55 + Math.min(20, best.score / 2),
      })
    }
  }

  // yourStat — the one number that tells the story.
  if (userSt && userSt.gp > 0) {
    const sk = userLines.filter((l) => l.player.pos !== 'G')
    const twenty = sk.filter((l) => l.g >= 20)
    const topScorer = [...sk].sort((a, b) => b.g - a.g)[0]
    const gd = userSt.gf - userSt.ga
    const gdRank = [...f.standings].sort((a, b) => (b.gf - b.ga) - (a.gf - a.ga)).findIndex((s) => s.teamId === f.userTeamId) + 1
    const shutoutG = userLines.filter((l) => l.player.pos === 'G').sort((a, b) => b.shutouts - a.shutouts)[0]
    const rookiePts = sk.filter((l) => l.rookie).reduce((s, l) => s + l.pts, 0)
    const totalPts = sk.reduce((s, l) => s + l.pts, 0)
    type Stat = { stat: string; hero: WrappedStat; slots: Record<string, string>; subject: string; w: number }
    const options: Stat[] = []
    if (shutoutG && shutoutG.shutouts >= 7) options.push({ stat: 'shutouts', subject: shutoutG.player.id, w: 50, hero: { value: String(shutoutG.shutouts), label: 'shutouts' }, slots: { player: shutoutG.player.name, countWords: cap(numberWord(shutoutG.shutouts)) } })
    if (twenty.length >= 5 && gd >= 0) options.push({ stat: 'depth', subject: 'depth', w: 48, hero: { value: String(twenty.length), label: '20-goal scorers' }, slots: { count: cap(numberWord(twenty.length)) } })
    if (twenty.length === 1 && topScorer && topScorer.g >= 32) options.push({ stat: 'oneman', subject: topScorer.player.id, w: 46, hero: { value: String(topScorer.g), label: `goals by ${lastName(topScorer.player.name)}` }, slots: { player: topScorer.player.name } })
    if (gd >= 45 && gdRank <= 3) options.push({ stat: 'differential', subject: 'gd', w: 44, hero: { value: `+${gd}`, label: 'goal differential' }, slots: {} })
    if (userSt.otl >= 13) options.push({ stat: 'overtime', subject: 'ot', w: 42, hero: { value: String(userSt.otl), label: 'overtime losses' }, slots: {} })
    if (totalPts > 0 && rookiePts / totalPts >= 0.2 && rookiePts >= 70) options.push({ stat: 'rookies', subject: 'rookies', w: 42, hero: { value: `${Math.round((100 * rookiePts) / totalPts)}%`, label: 'of points from rookies' }, slots: {} })
    if (gd <= -45) options.push({ stat: 'leaky', subject: 'leak', w: 50, hero: { value: String(gd), label: 'goal differential' }, slots: {} })
    const pick = options.sort((a, b) => b.w - a.w)[0]
    if (pick) {
      push({
        kind: 'yourStat', section: 'you',
        ...pickCopy(STAT_POOL, { stat: pick.stat }, key('stat', pick.subject), pick.slots),
        hero: pick.hero, team: user, weight: pick.w,
      })
    }
  }

  // yourTrade — the biggest deal you made in the league year, and how it looks now.
  const tradeMagnitude = (t: WTrade): number => {
    let m = 0
    for (const side of t.received) for (const a of side) {
      if (a.player) m += Math.max(0, (a.ovr ?? 60) - 60) + (a.pts ?? 0) * 0.3
      if (a.pickRound) m += a.pickRound === 1 ? 12 : a.pickRound === 2 ? 5 : 2
    }
    return m
  }
  const assetName = (a: WTradeAsset): string =>
    a.player ? a.player.name : `${pickShort(a.pickLabel ?? '')}${a.became ? ` → ${a.became.name}` : ''}`
  const sideSummary = (assets: WTradeAsset[]): string => tradeSideSummary(assets.map((a) => ({
    ...(a.player ? { name: a.player.name } : {}),
    ...(a.pickLabel ? { pickLabel: a.pickLabel } : {}),
    ...(a.became ? { became: a.became.name } : {}),
  })))
  const sideValue = (assets: WTradeAsset[]): number =>
    assets.reduce((s, a) => s + (a.player ? assetProduction({ pts: a.pts ?? 0, goalieWins: a.goalieWins ?? 0, pos: a.player.pos }) : 0), 0)
  const leadOf = (assets: WTradeAsset[]): WTradeAsset | undefined =>
    [...assets].filter((a) => a.player).sort((a, b) => (b.ovr ?? 0) - (a.ovr ?? 0))[0]
  let yourTradeLostLeadId: string | null = null
  {
    const mine = f.trades.filter((t) => t.userInvolved && t.teams[0] === f.userTeamId)
    const big = [...mine].sort((a, b) => tradeMagnitude(b) - tradeMagnitude(a))[0]
    if (big && tradeMagnitude(big) >= 14) {
      const got = big.received[0]
      const gave = big.received[1]
      const gotV = sideValue(got)
      const gaveV = sideValue(gave)
      const gotP = got.some((a) => a.player)
      const gaveP = gave.some((a) => a.player)
      const hasPlayers = gotP && gaveP
      const verdict = hasPlayers ? (gotV >= gaveV + 15 ? 'won' : gaveV >= gotV + 15 ? 'lost' : 'even')
        : gotP ? (gotV >= 40 ? 'buyHit' : 'buy')
        : gaveP ? 'sell'
        : 'early'
      const partner = big.teams[1]
      const gotLead = leadOf(got)
      const gaveLead = leadOf(gave)
      if (verdict === 'lost' && gaveLead?.player) yourTradeLostLeadId = gaveLead.player.id
      push({
        kind: 'yourTrade', section: 'you',
        ...pickCopy(YOUR_TRADE_POOL, { verdict }, key('trade', big.id), {
          summary: `You sent ${sideSummary(gave)} to the ${short(partner)} for ${sideSummary(got)}.`,
          gotName: gotLead?.player?.name ?? 'the return',
          gaveName: gaveLead?.player?.name ?? 'what you gave up',
        }),
        ...(hasPlayers ? { stats: [{ value: String(gotV), label: 'your side, pts' }, { value: String(gaveV), label: 'their side, pts' }] } : {}),
        list: [
          ...got.slice(0, 3).map((a) => ({ label: 'IN', value: assetName(a), ...(a.player ? { sub: a.player.pos === 'G' ? `${a.goalieWins ?? 0} W` : `${a.pts ?? 0} pts`, playerId: a.player.id } : {}) })),
          ...gave.slice(0, 3).map((a) => ({ label: 'OUT', value: assetName(a), ...(a.player ? { sub: a.player.pos === 'G' ? `${a.goalieWins ?? 0} W` : `${a.pts ?? 0} pts`, playerId: a.player.id } : {}) })),
        ],
        players: [gotLead?.player, gaveLead?.player].filter((p): p is WPlayer => !!p).map(chip),
        team: user,
        ...(team(partner) ? { versus: team(partner)! } : {}),
        weight: 50 + Math.min(25, tradeMagnitude(big) / 2),
      })
    }
  }

  // yourSigning / yourWorstCall (signing flop, or a traded-away player who starred)
  {
    const ok = f.userSignings.filter((s) => s.gp >= 30)
    const prod = (s: WSigning): number => assetProduction({ pts: s.pts, goalieWins: s.goalieWins, pos: s.player.pos })
    const perM = (s: WSigning): number => prod(s) / Math.max(0.75, s.salary / 1e6)
    const star = [...ok].filter((s) => s.salary >= 6e6 && prod(s) >= 55).sort((a, b) => prod(b) - prod(a))[0]
    const bargain = [...ok].filter((s) => s.salary < 4e6 && prod(s) >= 35).sort((a, b) => perM(b) - perM(a))[0]
    const best = star ?? bargain
    if (best) {
      push({
        kind: 'yourSigning', section: 'you',
        ...pickCopy(SIGNING_POOL, { kind: best === star ? 'star' : 'bargain' }, key('signing', best.player.id), {
          player: best.player.name, salaryWords: salaryWords(best.salary),
        }),
        hero: best.player.pos === 'G' ? { value: String(best.goalieWins), label: 'wins' } : { value: String(best.pts), label: 'points' },
        stats: [{ value: `$${(best.salary / 1e6).toFixed(1)}M`, label: 'cap hit' }, { value: `${best.years}y`, label: 'term' }],
        players: [chip(best.player)], team: user,
        weight: 52,
      })
    }
    // Worst call: an expensive flop, or a player you traded away who starred.
    const flop = f.userSignings
      .filter((s) => s.salary >= 4.5e6 && s.player.pos !== 'G' && s.pts < 18 && s.gp >= 20)
      .sort((a, b) => b.salary - a.salary)[0]
    const tradedAway = f.trades
      .filter((t) => t.userInvolved && t.teams[0] === f.userTeamId)
      .flatMap((t) => t.received[1].filter((a) => a.player).map((a) => ({ a, partner: t.teams[1] })))
      .filter(({ a }) => (a.player!.pos === 'G' ? (a.goalieWins ?? 0) >= 30 : (a.pts ?? 0) >= 60) || awardsByPlayer.has(a.player!.id))
      .sort((x, y) => (y.a.pts ?? 0) - (x.a.pts ?? 0))[0]
    if (tradedAway && tradedAway.a.player!.id !== yourTradeLostLeadId) {
      const p = tradedAway.a.player!
      push({
        kind: 'yourWorstCall', section: 'you',
        ...pickCopy(WORST_CALL_POOL, { kind: 'trade' }, key('worst', p.id), { player: p.name, oppShort: short(tradedAway.partner) }),
        hero: p.pos === 'G' ? { value: String(tradedAway.a.goalieWins ?? 0), label: 'wins elsewhere' } : { value: String(tradedAway.a.pts ?? 0), label: 'points elsewhere' },
        players: [chip(p)], team: team(tradedAway.partner) ?? user,
        weight: 58,
      })
    } else if (flop) {
      push({
        kind: 'yourWorstCall', section: 'you',
        ...pickCopy(WORST_CALL_POOL, { kind: 'signing' }, key('worst', flop.player.id), { player: flop.player.name, salaryWords: salaryWords(flop.salary) }),
        hero: { value: String(flop.pts), label: 'points' },
        stats: [{ value: `$${(flop.salary / 1e6).toFixed(1)}M`, label: 'cap hit' }, { value: String(flop.gp), label: 'games' }],
        players: [chip(flop.player)], team: user,
        weight: 50,
      })
    }
  }

  /* ═════════════ THE LEAGUE'S YEAR ═════════════ */

  const champ = team(f.championId)
  const finalSeries = f.championId ? f.series.find((s) => s.winnerId === f.championId && s.round === Math.max(...f.series.map((x) => x.round))) : undefined
  if (champ && finalSeries && !wonCup) {
    const cRank = standing.get(champ.id)?.rank ?? 0
    const kind = cRank === 1 ? 'favourite' : cRank >= Math.max(8, Math.round(nTeams * 0.35)) ? 'longshot' : 'normal'
    push({
      kind: 'champion', section: 'league',
      ...pickCopy(CHAMPION_POOL, { kind, sweep: finalSeries.loserWins === 0 }, key('champ', champ.id), {
        teamShort: champ.short, oppShort: short(finalSeries.loserId), rank: ordinal(cRank),
        springWinsCap: cap(numberWord(springWins)),
      }),
      hero: { value: `${finalSeries.winnerWins}–${finalSeries.loserWins}`, label: 'the Final' },
      stats: [{ value: ordinal(cRank), label: 'regular season' }, { value: record(standing.get(champ.id)), label: 'record' }],
      team: champ,
      ...(team(finalSeries.loserId) ? { versus: team(finalSeries.loserId)! } : {}),
      weight: 95,
    })
  }

  // upset — the single biggest series upset (not involving you: your run card has it).
  {
    let best: { s: WSeries; gap: number } | null = null
    for (const s of f.series) {
      if (s.winnerId === f.userTeamId || s.loserId === f.userTeamId) continue
      const w = standing.get(s.winnerId)
      const l = standing.get(s.loserId)
      if (!w || !l) continue
      const gap = l.pts - w.pts
      if (gap >= 14 && (!best || gap > best.gap)) best = { s, gap }
    }
    if (best) {
      const s = best.s
      push({
        kind: 'upset', section: 'league',
        ...pickCopy(UPSET_POOL, {}, key('upset', s.winnerId + s.loserId), {
          teamShort: short(s.winnerId), oppShort: short(s.loserId), result: `${s.winnerWins}–${s.loserWins}`,
          roundName: s.roundName.toLowerCase().startsWith('the ') ? s.roundName : `the ${s.roundName.toLowerCase()}`,
        }),
        hero: { value: `${s.winnerWins}–${s.loserWins}`, label: shortRound(s.roundName) },
        stats: [{ value: `${best.gap}`, label: 'points apart in the standings' }],
        ...(team(s.winnerId) ? { team: team(s.winnerId)! } : {}),
        ...(team(s.loserId) ? { versus: team(s.loserId)! } : {}),
        weight: 48 + Math.min(20, best.gap / 2),
      })
    }
  }

  // awards
  if (f.awards.length > 0) {
    const ordered = AWARD_ORDER.map((a) => f.awards.find((x) => x.award === a)).filter((x): x is WAward => !!x)
    const mvp = ordered.find((a) => a.award === 'Most Valuable Player')
    const userWon = ordered.filter((a) => a.teamId === f.userTeamId)
    const userMvp = !!mvp && mvp.teamId === f.userTeamId
    const others = userWon.filter((a) => a !== mvp)
    push({
      kind: 'awards', section: 'league',
      ...pickCopy(AWARDS_POOL, { userWinner: userWon.length > 0, userMvp }, key('awards', mvp?.player.id ?? ''), {
        mvp: mvp?.player.name ?? 'The MVP',
        userWinners: prosaicList(userWon.map((a) => `${a.player.name} (${awardLabel(a.award)})`)),
        otherWinners: others.length === 0 ? ''
          : `${prosaicList(others.map((a) => `${a.player.name} took the ${awardLabel(a.award)}`))}, too.`,
      }),
      list: ordered.map((a) => ({
        label: awardLabel(a.award), value: a.player.name, sub: `${team(a.teamId)?.abbr ?? ''} · ${a.value}`.replace(/^ · /, ''),
        playerId: a.player.id, ...(a.teamId ? { teamId: a.teamId } : {}),
      })),
      players: mvp ? [chip(mvp.player)] : [],
      ...(mvp && team(mvp.teamId) ? { team: team(mvp.teamId)! } : {}),
      weight: userWon.length > 0 ? 78 : 70,
    })
  }

  // recordBroken
  if (f.records.length > 0) {
    const order: WRecord['stat'][] = ['goals', 'points', 'assists', 'wins', 'shutouts', 'savePct']
    const recs = [...f.records].sort((a, b) => order.indexOf(a.stat) - order.indexOf(b.stat))
    const top = recs[0]!
    const others = recs.slice(1).map((r) => `${r.player.name} also set a new mark for ${STAT_NOUN[r.stat]}.`).join(' ')
    push({
      kind: 'recordBroken', section: 'league',
      ...pickCopy(RECORD_POOL, {}, key('record', top.player.id + top.stat), {
        player: top.player.name, prevName: top.prevName, prevYear: String(top.prevYear), other: others,
      }),
      hero: { value: fmtRecordValue(top.stat, top.value, top.prevValue), label: `single-season ${STAT_NOUN[top.stat]}` },
      stats: [{ value: fmtRecordValue(top.stat, top.prevValue, top.value), label: `old record (${top.prevYear})` }],
      players: [chip(top.player)],
      ...(team(top.teamId) ? { team: team(top.teamId)! } : {}),
      weight: 92,
    })
  }

  // milestones — the majors anywhere, round numbers of your own.
  {
    const noun = (m: WMilestone): string =>
      m.kind === 'g' ? 'career goals' : m.kind === 'p' ? 'career points' : m.kind === 'so' ? 'career shutouts' : 'games'
    const shown = f.milestones
      .filter((m) => m.major || (m.teamId === f.userTeamId && ((m.kind === 'p' && m.n >= 500) || (m.kind === 'g' && m.n >= 300) || (m.kind === 'gp' && m.n >= 800))))
      .sort((a, b) => Number(b.major) - Number(a.major) || b.n - a.n)
    if (shown.length > 0) {
      const lead = shown[0]!
      push({
        kind: 'milestones', section: 'league',
        ...pickCopy(MILESTONE_POOL, {}, key('milestones', lead.player.id), {
          lead: `${lead.player.name} reached ${lead.n.toLocaleString('en-US')} ${noun(lead)}.`,
        }),
        hero: { value: lead.n.toLocaleString('en-US'), label: noun(lead) },
        list: [...new Set(shown.map((m) => m.player.id))].slice(0, 4).map((pid) => {
          const mine = shown.filter((m) => m.player.id === pid)
          const m = mine[0]!
          return {
            label: m.player.name,
            value: mine.map((x) => `${x.n.toLocaleString('en-US')} ${noun(x)}`).join(' · '),
            sub: team(m.teamId)?.abbr ?? '',
            playerId: m.player.id, ...(m.teamId ? { teamId: m.teamId } : {}),
          }
        }),
        players: [chip(lead.player)],
        ...(team(lead.teamId) ? { team: team(lead.teamId)! } : {}),
        weight: lead.major ? 68 : 55,
      })
    }
  }

  // firstOverall — who went #1 (and your own first pick, beneath).
  {
    const first = f.draft.find((d) => d.overall === 1)
    if (first) {
      const isUser = first.teamId === f.userTeamId
      const yourFirst = f.draft.filter((d) => d.teamId === f.userTeamId).sort((a, b) => a.overall - b.overall)[0]
      push({
        kind: 'firstOverall', section: 'league',
        ...pickCopy(FIRST_OVERALL_POOL, { user: isUser, lottery: f.lotteryWinnerId === first.teamId }, key('first', first.player.id), {
          player: first.player.name, teamShort: short(first.teamId),
        }),
        hero: { value: '#1', label: `${Y + 1} draft` },
        stats: [{ value: first.player.pos, label: 'position' }, { value: String(first.player.age), label: 'age' }],
        list: yourFirst && !isUser ? [{ label: 'Your first pick', value: yourFirst.player.name, sub: `#${yourFirst.overall} · ${yourFirst.player.pos}`, playerId: yourFirst.player.id }] : [],
        players: [chip({ ...first.player, teamId: first.teamId })],
        ...(team(first.teamId) ? { team: team(first.teamId)! } : {}),
        weight: isUser ? 85 : 74,
      })
    }
  }

  // leagueBreakout — the jump nobody saw coming (not your player).
  {
    const cands = f.lines.filter((l) =>
      l.teamId !== f.userTeamId && l.player.pos !== 'G' && l.prevPts !== null && (l.prevGp ?? 0) >= 30 &&
      l.pts >= 60 && l.pts - l.prevPts >= 28)
      .sort((a, b) => (b.pts - (b.prevPts ?? 0)) - (a.pts - (a.prevPts ?? 0)))
    const l = cands[0]
    if (l) {
      push({
        kind: 'leagueBreakout', section: 'league',
        ...pickCopy(LEAGUE_BREAKOUT_POOL, { veteran: l.player.age >= 31 }, key('lbreak', l.player.id), {
          player: l.player.name, teamShort: short(l.teamId), age: String(l.player.age),
          posWord: l.player.pos === 'D' ? 'defenceman' : l.player.pos === 'C' ? 'centre' : 'winger',
        }),
        hero: { value: `+${l.pts - (l.prevPts ?? 0)}`, label: 'points on last season' },
        stats: [{ value: `${l.prevPts} → ${l.pts}`, label: 'points' }, { value: String(l.player.age), label: 'age' }],
        players: [chip(l.player)],
        ...(team(l.teamId) ? { team: team(l.teamId)! } : {}),
        weight: 46 + Math.min(14, (l.pts - (l.prevPts ?? 0) - 28) / 2),
      })
    }
  }

  // leagueTrade — the biggest deal you weren't in.
  {
    const others = f.trades.filter((t) => !t.userInvolved)
    const big = [...others].sort((a, b) => tradeMagnitude(b) - tradeMagnitude(a))[0]
    const bigLead = big ? leadOf([...big.received[0], ...big.received[1]]) : undefined
    if (big && bigLead && (bigLead.ovr ?? 0) >= 76 && tradeMagnitude(big) >= 22) {
      // The side that received the headline player is the protagonist.
      const buyerIdx = big.received[0].includes(bigLead) ? 0 : 1
      const buyer = big.teams[buyerIdx]
      const seller = big.teams[1 - buyerIdx]!
      const cup = buyer === f.championId
      push({
        kind: 'leagueTrade', section: 'league',
        ...pickCopy(LEAGUE_TRADE_POOL, { cup }, key('ltrade', big.id), {
          summary: `The ${short(buyer)} landed ${bigLead.player!.name} from the ${short(seller)} for ${sideSummary(big.received[1 - buyerIdx]!)}.`,
          teamShort: short(buyer),
        }),
        list: [
          ...big.received[buyerIdx]!.slice(0, 3).map((a) => ({ label: team(buyer)?.abbr ?? 'IN', value: assetName(a), ...(a.player ? { playerId: a.player.id } : {}) })),
          ...big.received[1 - buyerIdx]!.slice(0, 3).map((a) => ({ label: team(seller)?.abbr ?? 'OUT', value: assetName(a), ...(a.player ? { playerId: a.player.id } : {}) })),
        ],
        players: [chip(bigLead.player!)],
        ...(team(buyer) ? { team: team(buyer)! } : {}),
        ...(team(seller) ? { versus: team(seller)! } : {}),
        weight: cup ? 70 : 47 + Math.min(15, tradeMagnitude(big) / 4),
      })
    }
  }

  // coachingCarousel — consumed if the chronicle recorded firings/GM changes.
  {
    const changes = f.coachChanges.filter((c) => c.kind !== 'coachHired')
    const involvesBig = changes.some((c) => c.teamId === f.userTeamId || c.teamId === f.championId)
    if (changes.length >= 2 || (changes.length === 1 && involvesBig)) {
      push({
        kind: 'coachingCarousel', section: 'league',
        ...pickCopy(COACHING_POOL, {}, key('carousel', String(changes.length)), {
          lead: changes.length === 1 ? `${changes[0]!.headline}.` : `${cap(numberWord(changes.length))} clubs made a change at the top.`,
        }),
        hero: { value: String(changes.length), label: changes.length === 1 ? 'change' : 'changes' },
        list: changes.slice(0, 5).map((c) => ({ label: team(c.teamId)?.abbr ?? '', value: c.headline, teamId: c.teamId })),
        weight: 34 + Math.min(16, changes.length * 3) + (involvesBig ? 8 : 0),
      })
    }
  }

  // retirements — the notable ones.
  {
    const notable = f.retirements
      .filter((r) => r.pts >= 450 || r.gp >= 800 || r.seasons >= 14 || (r.player.pos === 'G' && (r.gp >= 450 || r.shutouts >= 40)))
      .sort((a, b) => b.pts + b.gp * 0.3 - (a.pts + a.gp * 0.3))
    if (notable.length > 0) {
      const lead = notable[0]!
      const rest = notable.slice(1, 3).map((r) => r.player.name)
      push({
        kind: 'retirements', section: 'league',
        ...pickCopy(RETIREMENT_POOL, {}, key('retire', lead.player.id), {
          lead: lead.player.name, leadShort: lastName(lead.player.name),
          seasonsWords: numberWord(lead.seasons), seasonsWordsCap: cap(numberWord(lead.seasons)),
          others: rest.length ? `${prosaicList(rest)} ${rest.length === 1 ? 'also called it a career.' : 'called it a career too.'}` : '',
        }),
        hero: lead.player.pos === 'G' ? { value: String(lead.gp), label: 'career games' } : { value: lead.pts.toLocaleString('en-US'), label: 'career points' },
        list: notable.slice(0, 4).map((r) => ({
          label: r.player.name,
          value: r.player.pos === 'G' ? `${r.gp} GP · ${r.shutouts} SO` : `${r.gp} GP · ${r.pts} PTS`,
          sub: `${r.seasons} seasons`, playerId: r.player.id,
        })),
        players: [chip(lead.player)],
        ...(team(lead.lastTeamId) ? { team: team(lead.lastTeamId)! } : {}),
        weight: 60 + Math.min(20, lead.pts / 80),
      })
    }
  }

  /* ═════════════ HISTORY ═════════════ */

  const priorChamps = [...f.championHistory].filter((c) => c.year < Y).sort((a, b) => b.year - a.year)
  const historyDepth = priorChamps.length
  const isChamp = (c: { teamId: string | null; name: string | null }, t: WrappedTeamChip): boolean =>
    c.teamId === t.id || (!!c.name && c.name === t.name)
  if (champ) {
    // dynasty: consecutive or clustered titles.
    let streak = 1
    for (const c of priorChamps) { if (c.year === Y - streak && isChamp(c, champ)) streak++; else break }
    const window = 6
    const inWindow = 1 + priorChamps.filter((c) => c.year > Y - window && isChamp(c, champ)).length
    const kind = streak >= 3 ? 'threepeat' : streak === 2 ? 'repeat' : inWindow >= 3 ? 'dynasty' : null
    if (kind) {
      push({
        kind: 'dynasty', section: 'history',
        ...pickCopy(DYNASTY_POOL, { kind }, key('dynasty', champ.id), {
          teamShort: champ.short, countWords: numberWord(inWindow), countWordsCap: cap(numberWord(inWindow)), windowWords: numberWord(window),
        }),
        hero: { value: kind === 'dynasty' ? String(inWindow) : String(streak), label: kind === 'dynasty' ? `titles in ${window} years` : 'straight titles' },
        team: champ,
        weight: 88,
      })
    } else {
      const last = priorChamps.find((c) => isChamp(c, champ))
      if (last && Y - last.year >= 15) {
        const gap = Y - last.year
        push({
          kind: 'droughtEnded', section: 'history',
          ...pickCopy(DROUGHT_POOL, {}, key('drought', champ.id), {
            teamShort: champ.short, lastYear: String(last.year), gapWordsCap: cap(yearsWords(gap)),
          }),
          hero: { value: String(gap), label: 'years since the last one' },
          stats: [{ value: String(last.year), label: 'last title' }],
          team: champ,
          weight: 86,
        })
      } else if (!last && historyDepth >= 15) {
        const oldest = priorChamps[priorChamps.length - 1]!.year
        const depth = Y - oldest
        push({
          kind: 'franchiseFirst', section: 'history',
          ...pickCopy(FIRST_CUP_POOL, {}, key('firstcup', champ.id), {
            teamShort: champ.short, depthWords: yearsWords(depth),
          }),
          hero: { value: '1st', label: 'title in franchise history' },
          team: champ,
          weight: 87,
        })
      }
    }
  }

  // historySince — the first 60-goal (or 130-point, 90-assist) season since …
  {
    type Mark = { stat: 'goals' | 'points' | 'assists'; min: number; label: string }
    const MARKS: Mark[] = [
      { stat: 'goals', min: 60, label: '60-goal season' },
      { stat: 'points', min: 130, label: '130-point season' },
      { stat: 'goals', min: 50, label: '50-goal season' },
      { stat: 'assists', min: 90, label: '90-assist season' },
    ]
    const markYears = new Set(f.markHistory.map((m) => m.year))
    const bookDepth = markYears.size
    for (const m of MARKS) {
      const hitter = f.lines
        .filter((l) => l.player.pos !== 'G' && (m.stat === 'goals' ? l.g : m.stat === 'assists' ? l.a : l.pts) >= m.min)
        .sort((a, b) => (m.stat === 'goals' ? b.g - a.g : m.stat === 'assists' ? b.a - a.a : b.pts - a.pts))[0]
      if (!hitter) continue
      const prior = f.markHistory.filter((h) => h.stat === m.stat && h.value >= m.min && h.year < Y).sort((a, b) => b.year - a.year)[0]
      const gap = prior ? Y - prior.year : 0
      // Only history if the wait was real: a mark reached every other year is
      // not a story. 50 goals needs a longer drought than 60 to count.
      const minGap = m.min === 50 ? 8 : 4
      if (prior && gap < minGap) continue
      if (!prior && bookDepth < 10) continue
      if (cards.some((c) => c.kind === 'recordBroken' && c.players?.[0]?.id === hitter.player.id)) continue
      const v = m.stat === 'goals' ? hitter.g : m.stat === 'assists' ? hitter.a : hitter.pts
      push({
        kind: 'historySince', section: 'history',
        ...pickCopy(SINCE_POOL, { found: !!prior }, key('since', hitter.player.id + m.stat), {
          mark: m.label, sinceYear: prior ? String(prior.year) : '', player: hitter.player.name,
          teamShort: short(hitter.teamId), gapWords: yearsWords(gap), gapWordsCap: cap(yearsWords(gap)),
          depthWords: yearsWords(bookDepth),
        }),
        hero: { value: String(v), label: m.stat },
        stats: prior ? [{ value: String(prior.year), label: `last ${m.label}` }] : [],
        players: [chip(hitter.player)],
        ...(team(hitter.teamId) ? { team: team(hitter.teamId)! } : {}),
        weight: 80,
      })
      break
    }
  }

  /* ═════════════ HINDSIGHT ═════════════ */

  const hindsight: WrappedCard[] = []
  const told = new Set(f.told)
  const pushH = (c: Omit<WrappedCard, 'id' | 'kicker' | 'section' | 'subject'> & { subject: string }): void => {
    if (!c.headline || told.has(c.subject)) return
    hindsight.push({ ...c, section: 'hindsight', kicker: KICKER.hindsight, id: `${Y}-${c.kind}` })
  }

  // Draft: regret (someone taken after your pick became the better player) or steal.
  for (const h of f.hindsight.draft) {
    const yours = h.userPick
    const later = h.bestAfter
    const laterAward = later?.award
    // Late picks miss all the time; the bar for a regret rises with the slot.
    const floor = yours.overall <= 15 ? 60 : yours.overall <= 40 ? 90 : 130
    const regret = later && later.gp >= 60 &&
      (later.careerPts >= Math.max(floor, yours.careerPts * 1.8 + 25) || (!!laterAward && later.careerPts > yours.careerPts))
    const steal = !regret && yours.gp >= 60 && yours.overall >= 10 && h.pickedAhead >= 6 &&
      h.outscoredAhead >= Math.ceil(h.pickedAhead * 0.7) && yours.careerPts >= 60
    if (regret && later) {
      pushH({
        kind: 'hindsightDraft', subject: `draft:${yours.player.id}:${later.player.id}${laterAward ? `:${laterAward}:${Y}` : ''}`,
        ...pickCopy(HS_DRAFT_POOL, { kind: 'passed', award: !!laterAward }, key('hsdraft', yours.player.id), {
          userPick: String(yours.overall), userPlayer: yours.player.name, draftYear: String(h.draftYear),
          laterPlayer: later.player.name, laterPick: String(later.overall), laterTeamShort: short(later.teamId),
          laterAward: laterAward ? awardLabel(laterAward) : '',
        }),
        hero: { value: `#${later.overall}`, label: `taken after your #${yours.overall}` },
        stats: [{ value: String(later.careerPts), label: `${lastName(later.player.name)}, career pts` }, { value: String(yours.careerPts), label: `${lastName(yours.player.name)}, career pts` }],
        players: [chip({ ...later.player, teamId: later.teamId }), chip(yours.player)],
        ...(team(later.teamId) ? { team: team(later.teamId)! } : {}),
        weight: laterAward ? 84 : 74,
      })
    } else if (steal) {
      pushH({
        kind: 'hindsightDraft', subject: `steal:${yours.player.id}${yours.award ? `:${yours.award}:${Y}` : ''}`,
        ...pickCopy(HS_DRAFT_POOL, { kind: 'steal', award: !!yours.award }, key('hsdraft', yours.player.id), {
          userPick: String(yours.overall), userPlayer: yours.player.name, draftYear: String(h.draftYear),
          userAward: yours.award ? awardLabel(yours.award) : '',
        }),
        hero: { value: `#${yours.overall}`, label: `${h.draftYear} draft` },
        stats: [{ value: String(yours.careerPts), label: 'career points' }, { value: `${h.outscoredAhead}/${h.pickedAhead}`, label: 'picked ahead, outscored' }],
        players: [chip(yours.player)], team: user,
        weight: yours.award ? 80 : 70,
      })
    }
  }

  // Trades re-graded with everything produced since.
  for (const t of f.hindsight.trades) {
    const diff = t.gotValue - t.gaveValue
    const winner = Math.max(t.gotValue, t.gaveValue)
    if (Math.abs(diff) < 30 || winner < 40) continue
    const verdict = diff > 0 ? 'won' : 'lost'
    // Futures take years: a deal is not "won" against picks that are still
    // teenagers (or not yet used) until the fourth summer.
    const ripe = Y - t.tradeYear >= 4
    if (!ripe && ((verdict === 'won' && t.gaveUnripe) || (verdict === 'lost' && t.gotUnripe))) continue
    pushH({
      kind: 'hindsightTrade', subject: `trade:${t.id}:${verdict}`,
      ...pickCopy(HS_TRADE_POOL, { verdict }, key('hstrade', t.id), {
        tradeYear: String(t.tradeYear), oppShort: short(t.partnerId),
        gotSummary: t.gotSummary, gaveSummary: t.gaveSummary,
        gotName: prosaicList(t.gotNames.slice(0, 2)) || 'the return', gaveName: prosaicList(t.gaveNames.slice(0, 2)) || 'what you gave up',
      }),
      stats: [{ value: String(t.gotValue), label: 'your side since' }, { value: String(t.gaveValue), label: 'their side since' }],
      players: [t.gotLead, t.gaveLead].filter((p): p is WPlayer => !!p).map(chip),
      team: user,
      ...(team(t.partnerId) ? { versus: team(t.partnerId)! } : {}),
      weight: 66 + Math.min(18, Math.abs(diff) / 5),
    })
  }

  // Scout calls vs the outcome.
  for (const s of f.hindsight.scout) {
    const c = s.call
    const years = Y - c.year
    if (years < 2) continue
    const high = c.ceiling >= 80
    const low = c.ceiling <= 70
    const bust = s.nowOvr <= c.ceiling - 12 && s.gp < 80
    const star = s.nowOvr >= 77
    const kind = low && bust && c.overallPick <= 15 && !c.userPick ? 'bustRight'
      : high && star && c.userPick ? 'starRight'
      : high && bust && c.userPick ? 'starWrong'
      : low && star ? 'bustWrong'
      : null
    if (!kind) continue
    pushH({
      kind: 'hindsightScout', subject: `scout:${c.playerId}`,
      ...pickCopy(HS_SCOUT_POOL, { kind }, key('hsscout', c.playerId), {
        scout: c.scoutName, player: c.playerName, calledRole: roleWords(c.role), nowRole: roleWords(s.nowRole),
        pick: String(c.overallPick), draftYear: String(c.year + 1), yearsWordsCap: cap(yearsWords(years)),
      }),
      stats: [{ value: c.role, label: `called in ${c.year + 1}` }, { value: s.nowRole, label: 'today' }],
      players: [chip(s.player)],
      ...(team(s.player.teamId) ? { team: team(s.player.teamId)! } : { team: user }),
      weight: kind === 'bustRight' || kind === 'starRight' ? 76 : 70,
    })
  }

  // Players you let walk.
  for (const w of f.hindsight.walked) {
    const prod = assetProduction({ pts: w.pts, goalieWins: w.goalieWins, pos: w.player.pos })
    const regret = w.gp >= 40 && (prod >= 55 || !!w.award)
    const relief = !regret && w.salary >= 5e6 && w.gp >= 20 && prod < 22
    if (!regret && !relief) continue
    pushH({
      kind: 'hindsightWalked', subject: `walk:${w.player.id}:${Y}`,
      ...pickCopy(HS_WALKED_POOL, { kind: regret ? 'regret' : 'relief' }, key('hswalk', w.player.id), {
        player: w.player.name, teamShort: short(w.newTeamId), salaryWords: salaryWords(w.salary),
      }),
      hero: w.player.pos === 'G' ? { value: String(w.goalieWins), label: 'wins' } : { value: String(w.pts), label: 'points' },
      stats: [{ value: `$${(w.salary / 1e6).toFixed(1)}M`, label: 'his new deal' }],
      players: [chip({ ...w.player, teamId: w.newTeamId })],
      ...(team(w.newTeamId) ? { team: team(w.newTeamId)! } : {}),
      weight: regret ? 72 : 58,
    })
  }
  {
    const perKind = new Set<string>()
    const chosen: WrappedCard[] = []
    for (const h of hindsight.sort((a, b) => b.weight - a.weight)) {
      if (perKind.has(h.kind)) continue
      perKind.add(h.kind)
      chosen.push(h)
      if (chosen.length >= MAX_HINDSIGHT_CARDS) break
    }
    cards.push(...chosen)
  }

  /* ═════════════ OUTRO ═════════════ */
  {
    const mvpCard = cards.find((c) => c.kind === 'yourMvp')
    const yourFirst = f.draft.filter((d) => d.teamId === f.userTeamId).sort((a, b) => a.overall - b.overall)[0]
    const out = pickCopy(OUTRO_POOL, { result }, key('outro', f.userTeamId), { season: seasonLabel(Y) })
    push({
      kind: 'outro', section: 'outro',
      headline: out.headline, body: out.body,
      hero: { value: record(userSt), label: 'W–L–OTL' },
      list: [
        { label: 'Finish', value: userRank ? `${ordinal(userRank)} of ${nTeams}` : '—' },
        { label: 'Playoffs', value: TAGLINE[result] },
        ...(mvpCard?.players?.[0] ? [{ label: 'Your MVP', value: mvpCard.players[0].name, playerId: mvpCard.players[0].id }] : []),
        ...(yourFirst ? [{ label: 'Top pick', value: `${yourFirst.player.name} (#${yourFirst.overall})`, playerId: yourFirst.player.id }] : []),
        ...(champ ? [{ label: 'Champion', value: champ.name, teamId: champ.id }] : []),
      ],
      team: user,
      weight: 100,
    })
  }

  /* ── trim to the strongest content, then order for the reveal ── */
  const structural = cards.filter((c) => c.section === 'cover' || c.section === 'outro')
  const content = cards
    .filter((c) => c.section !== 'cover' && c.section !== 'outro')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_CONTENT_CARDS)
  const ordered = [...structural, ...content].sort((a, b) => {
    const ka = KIND_ORDER.indexOf(a.kind)
    const kb = KIND_ORDER.indexOf(b.kind)
    return ka !== kb ? ka - kb : b.weight - a.weight
  })
  // ids must be unique inside a year (hindsight may repeat a kind).
  const seen = new Map<string, number>()
  for (const c of ordered) {
    const n = seen.get(c.id) ?? 0
    seen.set(c.id, n + 1)
    if (n > 0) c.id = `${c.id}-${n}`
  }

  return {
    year: Y,
    seasonLabel: seasonLabel(Y),
    userTeam: user,
    champion: champ ?? null,
    tagline: TAGLINE[result],
    record: record(userSt),
    cards: ordered,
  }
}

const ROUND_WORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh']

/** "2026 R1 (PHV)" → "a 2026 first-round pick". Unknown shapes pass through. */
export function pickPhrase(label: string): string {
  const m = /^(\d{4}) R(\d+)/.exec(label.trim())
  if (!m) return label
  return `a ${m[1]} ${ROUND_WORD[Number(m[2])] ?? `round-${m[2]}`}-round pick`
}

/** "2026 R1 (PHV)" → "2026 1st-round pick" (compact, for list rows). */
export function pickShort(label: string): string {
  const m = /^(\d{4}) R(\d+)/.exec(label.trim())
  return m ? `${m[1]} ${ordinal(Number(m[2]))}-round pick` : label
}

/**
 * One side of a deal said aloud: players by name, picks grouped by round
 * ("Nick Kane, two first-round picks and a second-round pick"). A pick that
 * has since been used names who it became.
 */
export function tradeSideSummary(assets: Array<{ name?: string; pickLabel?: string; became?: string }>): string {
  const names = assets.filter((a) => a.name).map((a) => a.name!)
  const picks = assets.filter((a) => !a.name && a.pickLabel)
  const used = picks.filter((a) => a.became).map((a) => `${pickPhrase(a.pickLabel!)} (now ${a.became})`)
  const byRound = new Map<number, number>()
  for (const a of picks) {
    if (a.became) continue
    const r = Number(/ R(\d+)/.exec(a.pickLabel!)?.[1] ?? 0)
    byRound.set(r, (byRound.get(r) ?? 0) + 1)
  }
  const grouped = [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([r, n]) => {
    const w = ROUND_WORD[r] ?? `round-${r}`
    if (n > 1) return `${numberWord(n)} ${w}-round picks`
    const one = picks.find((a) => !a.became && Number(/ R(\d+)/.exec(a.pickLabel!)?.[1] ?? 0) === r)
    return one ? pickPhrase(one.pickLabel!) : `a ${w}-round pick`
  })
  const parts = [...names, ...used, ...grouped]
  // A bag of eleven picks is not a sentence: name the headline assets (players
  // first, then the earliest-round pick) and count the rest.
  const total = names.length + picks.length
  if (total > 4) {
    const roundOf = (a: { pickLabel?: string }): number => Number(/ R(\d+)/.exec(a.pickLabel ?? '')?.[1] ?? 9)
    const bestPick = [...picks].sort((x, y) => roundOf(x) - roundOf(y))[0]
    const lead = [...names.slice(0, 2), ...(names.length < 2 && bestPick ? [pickPhrase(bestPick.pickLabel!)] : [])]
    const rest = total - lead.length
    return `${lead.join(', ')} and ${numberWord(rest)} more ${names.length > 2 ? 'pieces' : rest === 1 ? 'pick' : 'picks'}`
  }
  return prosaicList(parts) || 'future considerations'
}

/** "Top-six F" → "a top-six forward"; used inside scout copy. */
export function roleWords(role: string): string {
  const r = role.trim()
  const m: Record<string, string> = {
    'Franchise F': 'a franchise forward', 'First-line F': 'a first-line forward', 'Top-six F': 'a top-six forward',
    'Middle-six F': 'a middle-six forward', 'Bottom-six F': 'a bottom-six forward', 'AHL F': 'a minor-leaguer',
    '#1 D': 'a number-one defenceman', 'Top-pair D': 'a top-pair defenceman', '2nd-pair D': 'a second-pair defenceman',
    '3rd-pair D': 'a third-pair defenceman', 'Depth D': 'a depth defenceman', 'AHL D': 'a minor-leaguer',
    'Franchise G': 'a franchise goalie', Starter: 'a starting goalie', '1B / Tandem': 'a 1B goalie',
    Backup: 'a backup goalie', 'AHL G': 'a minor-league goalie',
  }
  return m[r] ?? r
}

/** A built year as its yearbook tile. */
export function yearbookRow(y: WrappedYear): WrappedYearbookRow {
  return {
    year: y.year, seasonLabel: y.seasonLabel, tagline: y.tagline, record: y.record,
    userTeam: { ...y.userTeam }, champion: y.champion ? { ...y.champion } : null,
    cardCount: y.cards.length,
    headlines: y.cards.filter((c) => c.section !== 'cover' && c.section !== 'outro').slice(0, 3).map((c) => c.headline),
  }
}

/** Ids of every year a save holds, newest first (yearbook order). */
export function yearbookOrder(state: WrappedState): WrappedYear[] {
  return [...state.years].sort((a, b) => b.year - a.year)
}

/** Add (or replace) a built year and mark it pending; bounded. */
export function commitYear(state: WrappedState, built: WrappedYear): void {
  state.years = state.years.filter((y) => y.year !== built.year)
  state.years.push(built)
  state.years.sort((a, b) => a.year - b.year)
  if (state.years.length > MAX_YEARS) state.years.splice(0, state.years.length - MAX_YEARS)
  state.pendingYear = built.year
}

