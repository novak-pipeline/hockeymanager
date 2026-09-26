/**
 * THE DAILY BEAT — article builders (docs/MEDIA-BEAT.md).
 *
 * The Pittsburgh Hockey Now model: one credentialed outlet covering one club
 * every day. Each builder here takes a FACT PAYLOAD the career assembled from
 * live sim state (lines, box scores, the transaction ledger, injuries, cap,
 * prospects, standings) and returns a typed article. Nothing is invented: a
 * builder that cannot fill its facts returns null and the piece is not run.
 *
 * Words come from beatPools.ts through the Content Engine:
 *  - persisted articles (the user's club) select through the save's shared
 *    no-repeat ledger, so a season of notebooks never reads the same twice;
 *  - on-demand coverage of other clubs uses pickStable (view text, rebuilt on
 *    every open, never ledgered).
 *
 * Pure + deterministic: no sim Rng is touched, so coverage can never change
 * an outcome.
 */
import { Rng } from '@engine/shared/rng'
import { isEligible, markUsed, selectVariant, type ContentCtx, type ContentUse, type ContentVariant } from './contentEngine'
import { pickStable, stableSeed } from './prose'
import type { BeatOutlet, MarketProfile } from './mediaCast'
import {
  COACH_QUOTE, CLAIM_BODY, CLAIM_HEAD, DY_HEAD, DY_LEDE, DY_WHY, FT_HEAD, FT_LEDE, GD_HEAD, GD_LEDE,
  GRADE_NOTE, GR_CLOSE, GR_HEAD, GR_LEDE, HS_BODY, HS_HEAD, INJ_BODY, INJ_HEAD, MB_A, MB_HEAD, MB_LEDE,
  MB_Q, MV_HEAD, MV_LEDE, NB_HEAD, NB_LEDE, PR_HEAD, PR_LEDE, WATCH,
} from './beatPools'

/* ═══════════════════════════════ types ═══════════════════════════════ */

export type BeatKind =
  | 'notebook'
  | 'gameday'
  | 'grades'
  | 'moves'
  | 'injury'
  | 'mailbag'
  | 'daily'
  | 'prospects'
  | 'feature'
  | 'claim'
  | 'hotSeat'

/** The part of the hockey year a piece belongs to. */
export type SeasonAct =
  | 'camp'
  | 'early'
  | 'thanksgiving'
  | 'winter'
  | 'holiday'
  | 'midseason'
  | 'deadline'
  | 'push'
  | 'playoffs'
  | 'exit'
  | 'draft'
  | 'july1'
  | 'summer'

export type Tilt = 'ally' | 'neutral' | 'critic'

export interface BeatSection {
  title: string
  lines: string[]
}

export interface BeatGrade {
  playerId: string
  name: string
  pos: string
  grade: string
  note: string
}

export interface BeatQA {
  handle: string
  question: string
  answer: string
}

/** One published beat article. JSON-safe; persisted for the user's club. */
export interface BeatArticle {
  id: string
  teamId: string
  kind: BeatKind
  year: number
  day: number
  dateISO: string
  headline: string
  /** One-line summary under the headline. */
  dek: string
  /** Paragraphs. */
  body: string[]
  sections?: BeatSection[]
  grades?: BeatGrade[]
  qa?: BeatQA[]
  playerIds?: string[]
  tilt?: Tilt
  act?: SeasonAct
  /** True when this piece was also the week's beat item in the GM's inbox. */
  inbox?: boolean
}

/** The beat outlet as the News reader shows it. */
export interface BeatView {
  teamId: string
  teamName: string
  outlet: string
  tagline: string
  writer: { name: string; handle: string }
  authorId: string
  market: { tier: number; label: string }
  isUserClub: boolean
  /** On-demand coverage of another club (not persisted, lighter). */
  light: boolean
  /** The GM's standing with this writer (user club only). */
  standing?: string
  articles: BeatArticle[]
  /** Clubs the reader can switch to: [teamId, name] (NHL only). */
  clubs: Array<{ teamId: string; name: string; abbreviation: string }>
}

/* ═══════════════════════════════ desk context ═══════════════════════════════ */

export interface DeskCtx {
  outlet: BeatOutlet
  teamId: string
  teamName: string
  nick: string
  city: string
  market: MarketProfile
  act: SeasonAct
  tilt: Tilt
  year: number
  day: number
  dateISO: string
  /** The save's shared no-repeat ledger — null for on-demand views. */
  ledger: ContentUse[] | null
  /** Stable key for this article (kind + club + date). */
  key: string
}

/** One pooled line. Ledgered when the desk has a ledger, stable otherwise. */
export function say(c: DeskCtx, pool: ContentVariant[], ctx: ContentCtx, slots: Record<string, string>, salt: string): string {
  const key = `${c.key}|${salt}`
  if (c.ledger) {
    // Meaning first, freshness second: choose among the MOST SPECIFIC eligible
    // variants only, fresh ones before used ones. (The shared selectVariant
    // prefers any fresh line over a used specific one, which let an exhausted
    // "he moved up" bucket fall through to "lines hold" on a day he moved.)
    // Pools are authored so every eligible line is TRUE for the ctx; the
    // cascade only trades specificity for freshness, never meaning.
    const eligible = pool.filter((v) => isEligible(v, ctx))
    if (eligible.length === 0) return ''
    const spec = (v: ContentVariant): number => Object.keys(v.conditions ?? {}).length
    const used = new Set(c.ledger.filter((u) => u.year === c.year).map((u) => u.variantId))
    const levels = [...new Set(eligible.map(spec))].sort((a, b) => b - a)
    const level = levels.find((l) => eligible.some((v) => spec(v) === l && !used.has(v.id))) ?? levels[0]!
    const best = eligible.filter((v) => spec(v) === level)
    const v = selectVariant({ pool: best, ctx, rng: new Rng(stableSeed(key)), ledger: c.ledger, year: c.year })
    if (!v) return ''
    markUsed(c.ledger, v.id, c.year, c.day)
    return tidy(fill(v.text, slots))
  }
  const v = pickStable(pool, ctx, key)
  return v ? tidy(fill(v.text, slots)) : ''
}

/**
 * Slot fill for beat prose. The shared renderTemplate pulls any space before a
 * full stop, which turns "at .912" into "at.912"; hockey writes save
 * percentages with a leading point, so this keeps a space before a point that
 * starts a number.
 */
export function fill(text: string, slots: Record<string, string>): string {
  return text
    .replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, k: string) => slots[k] ?? `{${k}}`)
    .replace(/ {2,}/g, ' ')
    .replace(/ ([,;!?])/g, '$1')
    .replace(/ \.(?!\d)/g, '.')
    // "a 8-4 loss" -> "an 8-4 loss" (also 11, 18 and the 80s).
    .replace(/\b([Aa]) (?=(?:8|11|18)(?!\d)|8\d)/g, '$1n ')
    .trim()
}

/** View text: stable pick, never ledgered (grade notes, watch bullets). */
function sayStable(pool: ContentVariant[], ctx: ContentCtx, slots: Record<string, string>, key: string): string {
  const v = pickStable(pool, ctx, key)
  return v ? tidy(fill(v.text, slots)) : ''
}

function tidy(s: string): string {
  const t = s.replace(/\s{2,}/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function article(c: DeskCtx, kind: BeatKind, headline: string, dek: string, body: string[], extra: Partial<BeatArticle> = {}): BeatArticle {
  return {
    id: '',
    teamId: c.teamId,
    kind,
    year: c.year,
    day: c.day,
    dateISO: c.dateISO,
    headline,
    dek,
    body: body.filter((p) => p.trim().length > 0),
    ...(c.tilt !== 'neutral' ? { tilt: c.tilt } : {}),
    act: c.act,
    ...extra,
  }
}

/* ═══════════════════════════════ small helpers ═══════════════════════════════ */

export function lastName(full: string): string {
  const parts = full.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : full
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full
}

export function ordinalWord(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  const r = n % 10
  return `${n}${r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th'}`
}

const LINE_WORDS = ['top line', 'second line', 'third line', 'fourth line']
const PAIR_WORDS = ['top pair', 'second pair', 'third pair']

/** "on the top line" / "in the press box" — a slot as a sentence needs it. */
export function slotPhrase(slot: string): string {
  return slot === 'press box' ? 'in the press box' : `on the ${slot}`
}

export function slotWord(kind: 'F' | 'D', index: number): string {
  if (kind === 'F') return LINE_WORDS[index] ?? 'press box'
  return PAIR_WORDS[index] ?? 'press box'
}

/** "$4.5 million" — one decimal at most, as the writing pass requires. */
export function moneyShort(dollars: number): string {
  const m = dollars / 1_000_000
  if (m >= 1) return `$${(Math.round(m * 10) / 10).toString()} million`
  return `$${Math.round(dollars / 1000)}K`
}

export function svpText(saves: number, shots: number): string {
  if (shots <= 0) return '1.000'
  const v = saves / shots
  return v >= 1 ? '1.000' : `.${Math.round(v * 1000).toString().padStart(3, '0')}`
}

function toiText(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Letter grade from the beat's game score (see beatScore). */
export function letterGrade(score: number): string {
  if (score >= 8.6) return 'A+'
  if (score >= 8.1) return 'A'
  if (score >= 7.7) return 'A-'
  if (score >= 7.3) return 'B+'
  if (score >= 6.95) return 'B'
  if (score >= 6.6) return 'B-'
  if (score >= 6.3) return 'C+'
  if (score >= 6.0) return 'C'
  if (score >= 5.7) return 'C-'
  if (score >= 5.2) return 'D'
  return 'F'
}

/**
 * The beat's score for one night: the box score a writer sees from the press
 * box (goals, assists, plus/minus, shots, hits, blocks; save percentage for a
 * goalie), with the engine's game rating as a light seasoning, and the result
 * leaning on everyone (a writer grades harder after a loss). Every letter is
 * therefore something the note beside it can justify — a minus-four night is
 * never an A.
 */
export function beatScore(l: GradeLine, won: boolean): number {
  const result = won ? 0.25 : -0.25
  const ratingLean = (l.rating - 7.0) * 0.3
  if (l.pos === 'G') {
    // Centred on the sim's league save percentage (~.890), not the real NHL's:
    // an .880 night in a one-goal loss is a C-, not an F. The engine rating
    // leans at half weight so a goalie is graded on his saves first.
    const sv = l.sa > 0 ? l.saves / l.sa : 0.89
    return 6.2 + (sv - 0.89) * 30 + result + ratingLean * 0.5 + (l.sa >= 35 && sv >= 0.92 ? 0.4 : 0)
  }
  return (
    6.2 +
    0.9 * l.goals +
    0.5 * l.assists +
    0.3 * l.pm +
    0.07 * Math.min(8, l.shots) +
    0.04 * Math.min(8, l.hits) +
    0.08 * Math.min(6, l.blocks) +
    result +
    ratingLean
  )
}

/* ═══════════════════════════════ lines ═══════════════════════════════ */

export interface LinesFacts {
  forwards: string[][]
  defence: string[][]
  goalies: string[]
  pp: string[][]
  pk: string[][]
}

function lineSections(l: LinesFacts, withSpecial: boolean): BeatSection[] {
  const out: BeatSection[] = []
  out.push({
    title: 'Forwards',
    lines: l.forwards.map((f) => f.map(lastName).join(' – ')),
  })
  out.push({ title: 'Defence', lines: l.defence.map((d) => d.map(lastName).join(' – ')) })
  if (l.goalies.length > 0) {
    out.push({
      title: 'Goalies',
      lines: [l.goalies.map(lastName).join(', ') + (l.goalies.length > 1 ? ' (starter first)' : '')],
    })
  }
  if (withSpecial) {
    const pp = l.pp.filter((u) => u.length > 0)
    if (pp.length > 0) out.push({ title: 'Power play', lines: pp.map((u, i) => `PP${i + 1}: ${u.map(lastName).join(', ')}`) })
    const pk = l.pk.filter((u) => u.length > 0)
    if (pk.length > 0) out.push({ title: 'Penalty kill', lines: pk.map((u, i) => `PK${i + 1}: ${u.map(lastName).join(', ')}`) })
  }
  return out
}

/* ═══════════════════════════════ NOTEBOOK ═══════════════════════════════ */

export interface NotebookFacts {
  lines: LinesFacts
  /** Players who changed slot since the last notebook. */
  /** `vet`: an established player (28+), so "knocking on the door" is wrong. */
  changes: Array<{ name: string; from: string; to: string; up: boolean; vet?: boolean }>
  /** Out of the lineup: the club's official line, never the truth. */
  absent: Array<{ name: string; official: string }>
  scratches: string[]
  /** Who is on the chopping block, with the fact that put him there. */
  chopping: Array<{ name: string; why: string }>
  /** A farm player forcing the issue. */
  pushing?: { name: string; league: string; line: string }
  coachName: string
  /** "the Bruins on Saturday" — the next game, when there is one. */
  nextOpp?: string
  /** The club's record, "12-8-3". */
  record?: string
  /** Training camp: day number + bubble battles. */
  camp?: {
    day: number
    battles: Array<{ name: string; age: number; pos: string; plan: 'nhl' | 'ahl'; waivers: boolean; tryout: boolean }>
    scrimmage?: string
  }
}

export function buildNotebook(c: DeskCtx, f: NotebookFacts): BeatArticle | null {
  if (f.lines.forwards.length === 0) return null
  const camp = f.camp !== undefined
  const top = f.changes[0]
  const absent = f.absent[0]
  const chop = f.chopping[0]
  const ctx: ContentCtx = {
    change: top !== undefined,
    absent: absent !== undefined,
    camp,
    chop: chop !== undefined,
    ...(top ? { up: top.up } : {}),
  }
  const slots: Record<string, string> = {
    nick: c.nick,
    coach: f.coachName,
    name: top?.name ?? '',
    to: top?.to ?? '',
    from: top?.from ?? '',
    toPhrase: top ? slotPhrase(top.to) : '',
    fromPhrase: top ? slotPhrase(top.from) : '',
    downPhrase: top ? (top.to === 'press box' ? 'comes out of the lineup' : `drops to the ${top.to}`) : '',
    absent: absent?.name ?? '',
    official: absent?.official ?? '',
    n: camp ? String(f.camp!.day) : String(f.changes.length),
    chop: chop ? chop.name : camp && f.camp!.battles[0] ? f.camp!.battles[0].name : f.scratches[0] ?? 'the extra forward',
    nextOpp: f.nextOpp ?? 'the next game',
    record: f.record ?? '',
  }
  const headline = say(c, NB_HEAD, ctx, slots, 'h')
  const lede = say(c, NB_LEDE, ctx, slots, 'l')
  const move = camp ? 'camp' : top ? (top.up ? (top.vet ? 'upVet' : 'up') : 'down') : 'none'
  const quote = say(c, COACH_QUOTE, { move }, { name: top?.name ?? '', first: top ? firstName(top.name) : '', coach: f.coachName }, 'q')
  const body: string[] = [lede]
  if (f.changes.length > 1) {
    body.push(
      `Other changes: ${f.changes
        .slice(1, 4)
        .map((ch) =>
          ch.to === 'press box'
            ? `${ch.name} out of the lineup`
            : ch.from === 'press box'
              ? `${ch.name} back in, on the ${ch.to}`
              : `${ch.name} ${ch.up ? 'up' : 'down'} to the ${ch.to}`,
        )
        .join('; ')}.`,
    )
  }
  if (quote) body.push(`${f.coachName} on it: ${quote}`)
  if (f.pushing) body.push(`Down on the farm, ${f.pushing.name} (${f.pushing.league}) is ${f.pushing.line}. That does not go unnoticed.`)

  const sections = lineSections(f.lines, !camp)
  if (f.absent.length > 0) sections.push({ title: 'Absent', lines: f.absent.map((a) => `${a.name}: ${a.official}`) })
  if (f.scratches.length > 0) sections.push({ title: 'Extras', lines: [f.scratches.join(', ')] })
  if (f.chopping.length > 0) sections.push({ title: 'On the chopping block', lines: f.chopping.map((ch) => `${ch.name}: ${ch.why}`) })
  if (camp && f.camp!.battles.length > 0) {
    sections.push({
      title: 'Bubble board',
      lines: f.camp!.battles.slice(0, 8).map(
        (b) =>
          `${b.name} (${b.pos}, ${b.age}): ${b.plan === 'nhl' ? 'trending toward a roster spot' : 'trending toward the farm'}` +
          (b.tryout ? ', on a tryout' : b.waivers ? ', would need waivers' : ''),
      ),
    })
    if (f.camp!.scrimmage) body.push(`Scrimmage result: ${f.camp!.scrimmage}.`)
  }
  const dek = camp
    ? `Camp day ${f.camp!.day}: lines, the bubble board and what ${f.coachName} said.`
    : top
      ? `${top.name} to the ${top.to}${absent ? `; ${absent.name} still out` : ''}.`
      : absent
        ? `${absent.name} still out; the rest of the lineup holds.`
        : `Lines, pairs, special teams and who is on the outside.`
  return article(c, 'notebook', headline, dek, body, { sections })
}

/* ═══════════════════════════════ GAMEDAY ═══════════════════════════════ */

export interface WatchItem {
  kind: 'slump' | 'streak' | 'milestone' | 'revenge' | 'injury' | 'stakes' | 'heater' | 'oppStar'
  name?: string
  n?: number
  other?: string
  playerId?: string
}

export interface GamedayFacts {
  opp: { name: string; nick: string; city: string; record: string; streak: number }
  home: boolean
  usRecord: string
  usStreak: number
  lines: LinesFacts
  starter: { name: string; line: string } | null
  /** The backup's name, for the "other option" line. */
  backup?: string
  watch: WatchItem[]
  playoff: boolean
}

/** The lead "what to watch" item as a headline phrase. */
function watchLabel(w: WatchItem | undefined): string {
  if (!w || !w.name) return w?.kind === 'stakes' ? 'the standings' : 'the special teams'
  switch (w.kind) {
    case 'slump': return `${possessiveOf(w.name)} drought`
    case 'streak': return `${possessiveOf(w.name)} streak`
    case 'injury': return `life without ${w.name}`
    case 'revenge': return `${w.name} against his old club`
    case 'oppStar': return `stopping ${w.name}`
    case 'milestone': return `${possessiveOf(w.name)} milestone chase`
    default: return w.name
  }
}

function possessiveOf(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

export function buildGameday(c: DeskCtx, f: GamedayFacts): BeatArticle | null {
  if (f.lines.forwards.length === 0) return null
  const ctx: ContentCtx = {
    home: f.home,
    playoff: f.playoff,
    oppHot: f.opp.streak >= 4,
    usCold: f.usStreak <= -3,
    usHot: f.usStreak >= 4,
    opener: f.usRecord === '0-0-0' && !f.playoff,
  }
  const slots: Record<string, string> = {
    nick: c.nick,
    opp: f.opp.name,
    oppNick: f.opp.nick,
    city: f.opp.city,
    record: f.usRecord,
    oppRecord: f.opp.record,
    starter: f.starter ? lastName(f.starter.name) : 'the starter',
    watch: watchLabel(f.watch[0]),
  }
  const headline = say(c, GD_HEAD, ctx, slots, 'h')
  const lede = say(c, GD_LEDE, ctx, slots, 'l')
  const body = [lede]
  if (f.starter) body.push(`Expected in goal: ${f.starter.name} (${f.starter.line}).${f.backup ? ` ${f.backup} is the other option.` : ''}`)
  const watchLines = f.watch.slice(0, 3).map((w, i) =>
    sayStable(
      WATCH,
      { kind: w.kind },
      { name: w.name ?? '', n: String(w.n ?? ''), other: w.other ?? '', opp: f.opp.nick, nick: c.nick },
      `${c.key}|w${i}|${w.kind}|${w.name ?? ''}`,
    ),
  ).filter(Boolean)
  const sections = lineSections(f.lines, true)
  if (watchLines.length > 0) sections.unshift({ title: 'What to watch', lines: watchLines })
  const dek = `${f.home ? 'vs.' : 'at'} ${f.opp.name}. ${f.starter ? `${lastName(f.starter.name)} ${f.playoff ? 'in goal' : 'expected in goal'}.` : ''} Projected lines inside.`
  return article(c, 'gameday', headline, dek.replace(/\s+/g, ' ').trim(), body, {
    sections,
    playerIds: f.watch.map((w) => w.playerId).filter((x): x is string => !!x).slice(0, 3),
  })
}

/* ═══════════════════════════════ GRADES ═══════════════════════════════ */

export interface GradeLine {
  playerId: string
  name: string
  pos: string
  goals: number
  assists: number
  shots: number
  hits: number
  blocks: number
  pm: number
  toi: number
  saves: number
  sa: number
  ga: number
  rating: number
}

export interface GradesFacts {
  opp: { name: string; nick: string }
  gf: number
  ga: number
  decidedBy: 'regulation' | 'overtime' | 'shootout'
  playoff: boolean
  lines: GradeLine[]
  /** "Boston on Thursday". */
  next: string
}

function gradeWhy(l: GradeLine, score?: number): string {
  if (l.pos === 'G') {
    // With a score, the note follows the letter so an F never reads "did what
    // was asked" and an A never reads "needed one more save".
    if (score !== undefined) return score >= 7.7 ? 'goalieGood' : score < 5.7 ? 'goalieBad' : 'goalieFine'
    const sv = l.sa > 0 ? l.saves / l.sa : 1
    if (sv >= 0.93 && l.sa >= 20) return 'goalieGood'
    if (sv < 0.88 || l.ga >= 4) return 'goalieBad'
    return 'goalieFine'
  }
  if (l.goals >= 2) return 'multi'
  if (l.goals === 1) return 'goal'
  if (l.assists >= 2) return 'playmaker'
  if (l.pm <= -2) return 'minus'
  if (l.assists === 1) return 'point'
  if (l.shots >= 5) return 'shots'
  if (l.hits >= 4) return 'physical'
  if (l.blocks >= 3) return 'blocks'
  if (l.pm >= 2) return 'plus'
  if (l.toi >= 22 * 60) return 'minutes'
  return 'quiet'
}

export function gradeNote(l: GradeLine, key: string, score?: number): string {
  const pm = l.pm > 0 ? `+${l.pm}` : String(l.pm)
  return sayStable(
    GRADE_NOTE,
    { why: gradeWhy(l, score) },
    {
      shotsWord: `${l.shots} shot${l.shots === 1 ? '' : 's'}`,
      g: String(l.goals),
      a: String(l.assists),
      pts: String(l.goals + l.assists),
      shots: String(l.shots),
      hits: String(l.hits),
      blocks: String(l.blocks),
      pm,
      toi: toiText(l.toi),
      saves: String(l.saves),
      sa: String(l.sa),
      ga: String(l.ga),
      svp: svpText(l.saves, l.sa),
    },
    `${key}|${l.playerId}`,
  )
}

export function buildGrades(c: DeskCtx, f: GradesFacts): BeatArticle | null {
  const dressed = f.lines.filter((l) => l.toi > 0)
  if (dressed.length < 6) return null
  const won = f.gf > f.ga
  const score = new Map(dressed.map((l) => [l.playerId, beatScore(l, won)]))
  const sc = (l: GradeLine): number => score.get(l.playerId) ?? 6
  const byRating = [...dressed].sort((a, b) => sc(b) - sc(a) || a.name.localeCompare(b.name))
  const star = byRating[0]!
  const goat = byRating[byRating.length - 1]!
  const hi = Math.max(f.gf, f.ga)
  const lo = Math.min(f.gf, f.ga)
  const scoreline = `${hi}-${lo}`
  const ctx: ContentCtx = {
    won,
    ot: f.decidedBy !== 'regulation',
    blowout: hi - lo >= 3,
    shutout: lo === 0,
    playoff: f.playoff,
    tilt: c.tilt,
  }
  const slots: Record<string, string> = {
    nick: c.nick,
    opp: f.opp.name,
    score: scoreline,
    star: star.name,
    goat: goat.name,
    next: f.next,
  }
  const headline = say(c, GR_HEAD, ctx, slots, 'h')
  const lede = say(c, GR_LEDE, ctx, slots, 'l')
  const grades: BeatGrade[] = byRating.map((l) => ({
    playerId: l.playerId,
    name: l.name,
    pos: l.pos,
    grade: letterGrade(sc(l)),
    note: gradeNote(l, c.key, sc(l)),
  }))
  const gradeOf = (l: GradeLine): string => letterGrade(sc(l))
  const good = byRating.slice(0, 3)
  const bad = byRating.slice(-2).reverse().filter((l) => !good.includes(l))
  const body = [lede]
  const alsoGood = good.slice(1).map((l) => `${l.name} (${gradeOf(l)})`)
  body.push(
    `The good: ${star.name}, ${gradeOf(star)}. ${grades[0]!.note}` +
      (alsoGood.length > 0 ? ` Also on the right side of it: ${alsoGood.join(' and ')}.` : ''),
  )
  if (bad.length > 0) {
    const worst = grades.find((g) => g.playerId === bad[0]!.playerId)
    body.push(
      `The bad: ${bad[0]!.name}, ${gradeOf(bad[0]!)}. ${worst?.note ?? ''}` +
        (bad[1] ? ` ${bad[1].name} (${gradeOf(bad[1])}) was not much better.` : ''),
    )
  }
  const close = say(c, GR_CLOSE, { won, tilt: c.tilt }, slots, 'c')
  if (close) body.push(close)
  const dek = `${won ? 'Win' : 'Loss'} ${f.gf}-${f.ga}${f.decidedBy === 'overtime' ? ' (OT)' : f.decidedBy === 'shootout' ? ' (SO)' : ''} ${won ? 'over' : 'to'} ${f.opp.name}. Best: ${star.name}.`
  return article(c, 'grades', headline, dek, body, { grades, playerIds: [star.playerId, goat.playerId] })
}

/* ═══════════════════════════════ ROSTER MOVES ═══════════════════════════════ */

export interface MovesFacts {
  items: Array<{ kind: string; summary: string; name?: string }>
  camp: boolean
}

export function buildMoves(c: DeskCtx, f: MovesFacts): BeatArticle | null {
  if (f.items.length === 0) return null
  const first = f.items[0]!
  const firstShort = first.summary.replace(/\.$/, '')
  const ctx: ContentCtx = { many: f.items.length >= 3, camp: f.camp }
  const slots = { nick: c.nick, n: String(f.items.length), name: first.name ?? firstShort, first: firstShort }
  const headline = say(c, MV_HEAD, ctx, slots, 'h')
  const lede = say(c, MV_LEDE, ctx, slots, 'l')
  return article(c, 'moves', headline, `${f.items.length} transaction${f.items.length === 1 ? '' : 's'}.`, [lede], {
    sections: [{ title: 'Transactions', lines: f.items.map((i) => i.summary) }],
  })
}

/* ═══════════════════════════════ INJURY ═══════════════════════════════ */

export interface InjuryFacts {
  beat: 'new' | 'reveal' | 'worse' | 'ahead'
  playerId: string
  name: string
  official: string
  band: string
  truth: string
  missed: number
  key: boolean
}

export function buildInjury(c: DeskCtx, f: InjuryFacts): BeatArticle {
  const ctx: ContentCtx = { beat: f.beat, key: f.key, illness: f.official.includes('illness') }
  const slots = {
    namePoss: /s$/i.test(f.name) ? `${f.name}'` : `${f.name}'s`,
    name: f.name,
    nick: c.nick,
    official: f.official,
    band: f.band,
    truth: f.truth,
    missed: String(f.missed),
  }
  const headline = say(c, INJ_HEAD, ctx, slots, 'h')
  const body = say(c, INJ_BODY, ctx, slots, 'b')
  const dek =
    f.beat === 'new'
      ? `Officially: ${f.official}.`
      : f.beat === 'reveal'
        ? `The club says ${f.official}. The diagnosis is ${f.truth}.`
        : f.beat === 'worse'
          ? `Listed ${f.band}; ${f.missed} games missed and counting.`
          : `Back after ${f.missed} games.`
  return article(c, 'injury', headline, dek, [body], { playerIds: [f.playerId] })
}

/* ═══════════════════════════════ MAILBAG ═══════════════════════════════ */

export type MailTopic = 'cap' | 'prospect' | 'deployment' | 'goalie' | 'slump' | 'trade' | 'playoffs' | 'draft' | 'coach' | 'extension' | 'special' | 'standout' | 'rookie' | 'streak'

export interface MailItem {
  topic: MailTopic
  /** Answer bucket the facts support (topic-specific; '' for single-bucket topics). */
  verdict: string
  /** Slot values for the question and answer. */
  slots: Record<string, string>
  /** Short label for the headline ("Rakell's slump"). */
  label: string
  playerId?: string
  /** Higher = more pressing; the desk takes the top few. */
  weight: number
}

export function buildMailbag(c: DeskCtx, items: MailItem[], handleFor: (key: string) => string): BeatArticle | null {
  const picked = [...items].sort((a, b) => b.weight - a.weight || a.topic.localeCompare(b.topic)).slice(0, 5)
  if (picked.length < 3) return null
  const handles = new Set<string>()
  const qa: BeatQA[] = picked.map((it, i) => {
    const ctxQ: ContentCtx = { topic: it.topic }
    const ctxA: ContentCtx = it.verdict ? { topic: it.topic, verdict: it.verdict } : { topic: it.topic }
    // Five different readers: re-salt until the handle is new to this mailbag.
    let handle = handleFor(`${c.key}|${i}|${it.topic}`)
    for (let salt = 1; handles.has(handle) && salt < 8; salt++) handle = handleFor(`${c.key}|${i}|${it.topic}|${salt}`)
    handles.add(handle)
    return {
      handle,
      question: say(c, MB_Q, ctxQ, it.slots, `q${i}`),
      answer: say(c, MB_A, ctxA, it.slots, `a${i}`),
    }
  })
  const slots = { nick: c.nick, q1: picked[0]!.label, q2: picked[1]!.label }
  const headline = say(c, MB_HEAD, {}, slots, 'h')
  const lede = say(c, MB_LEDE, {}, slots, 'l')
  return article(c, 'mailbag', headline, `${qa.length} questions: ${picked.map((p) => p.label).join(', ')}.`, [lede], {
    qa,
    playerIds: picked.map((p) => p.playerId).filter((x): x is string => !!x),
  })
}

/* ═══════════════════════════════ THE DAILY ═══════════════════════════════ */

export interface WireItem {
  source: string
  text: string
  why: 'division' | 'opponent' | 'race' | 'league'
  team?: string
  gap?: string
  days?: string
}

export interface DailyFacts {
  /** The club's record, for the masthead line. */
  record?: string
  /** A short label for the day's lead item ("the Predators-Sabres trade"). */
  top?: string
  /** "a 4-2 win over Boston"; absent on an off day. */
  yesterday?: { text: string; won: boolean }
  todayLine?: string
  division: string[]
  wire: WireItem[]
}

export function buildDaily(c: DeskCtx, f: DailyFacts): BeatArticle | null {
  if (f.wire.length === 0 && !f.yesterday) return null
  const topLabel = f.top ?? (f.yesterday ? (f.yesterday.won ? 'the morning after a win' : 'the morning after') : 'the league wire')
  const ctx: ContentCtx = f.yesterday ? { won: f.yesterday.won } : { off: true }
  const slots = { first: c.outlet.writer.first, nick: c.nick, yesterday: f.yesterday?.text ?? '', top: topLabel, record: f.record ?? '' }
  const headline = say(c, DY_HEAD, {}, slots, 'h')
  const lede = say(c, DY_LEDE, ctx, slots, 'l')
  const body = [lede]
  if (f.todayLine) body.push(f.todayLine)
  const sections: BeatSection[] = []
  if (f.division.length > 0) sections.push({ title: 'Around the division', lines: f.division })
  if (f.wire.length > 0) {
    sections.push({
      title: 'Around the league',
      lines: f.wire.slice(0, 5).map((w, i) => {
        const why = sayStable(DY_WHY, { why: w.why }, { team: w.team ?? '', gap: w.gap ?? '', nick: c.nick, days: w.days ?? '' }, `${c.key}|why${i}`)
        return `${w.source}: ${w.text.replace(/[.\s]+$/, '')}. ${why}`.trim()
      }),
    })
  }
  return article(c, 'daily', headline, `${c.outlet.writer.first}'s morning roundup.`, body, { sections })
}

/* ═══════════════════════════════ PROSPECTS ═══════════════════════════════ */

export interface ProspectLine {
  playerId: string
  name: string
  age: number
  pos: string
  where: 'ahl' | 'junior' | 'nhl'
  league: string
  club?: string
  gp: number
  g: number
  pts: number
  svPct?: number
}

export function buildProspects(c: DeskCtx, list: ProspectLine[]): BeatArticle | null {
  const playing = list.filter((p) => p.gp >= 3)
  if (playing.length < 2) return null
  const ranked = [...playing].sort((a, b) => {
    const ra = a.pos === 'G' ? (a.svPct ?? 0.9) * 2 - 1.2 : a.pts / a.gp
    const rb = b.pos === 'G' ? (b.svPct ?? 0.9) * 2 - 1.2 : b.pts / b.gp
    return rb - ra || a.name.localeCompare(b.name)
  })
  const top = ranked[0]!
  const slots = { nick: c.nick, name: top.name, league: top.league, pts: String(top.pts), gp: String(top.gp) }
  const headline = say(c, PR_HEAD, {}, slots, 'h')
  const lede = say(c, PR_LEDE, {}, slots, 'l')
  const line = (p: ProspectLine): string =>
    p.pos === 'G'
      ? `${p.name} (G, ${p.age}), ${p.club ?? p.league}: ${p.gp} GP, ${p.svPct !== undefined ? svpText(Math.round(p.svPct * 1000), 1000) : '—'} save percentage`
      : `${p.name} (${p.pos}, ${p.age}), ${p.club ?? p.league}: ${p.g}-${p.pts - p.g}-${p.pts} in ${p.gp}`
  const farm = ranked.filter((p) => p.where === 'ahl').slice(0, 6)
  const away = ranked.filter((p) => p.where === 'junior').slice(0, 6)
  const sections: BeatSection[] = []
  if (farm.length > 0) sections.push({ title: 'On the farm', lines: farm.map(line) })
  if (away.length > 0) sections.push({ title: 'Junior, college and Europe', lines: away.map(line) })
  const body = [lede]
  if (top.pos !== 'G' && top.pts / top.gp >= 1) body.push(`${top.name} is the headline: ${top.pts} points in ${top.gp} games is more than a point a game in the ${top.league}.`)
  else body.push(`${top.name} leads the group, ${top.pos === 'G' ? `stopping pucks at a ${top.svPct !== undefined ? svpText(Math.round(top.svPct * 1000), 1000) : 'good'} clip` : `with ${top.pts} points in ${top.gp}`}.`)
  return article(c, 'prospects', headline, `${top.name} leads the pipeline update.`, body, { sections, playerIds: [top.playerId] })
}

/* ═══════════════════════════════ FEATURES ═══════════════════════════════ */

export interface FeatureFacts {
  feature: 'thanksgiving' | 'holiday' | 'midseason' | 'deadline' | 'push' | 'exit' | 'draft' | 'july1' | 'summer' | 'campOpen' | 'campCuts'
  /** Conditions for the pools (inSpot, stance, race, busy …). */
  ctx: ContentCtx
  /** Slots for the pools (rank, gap, record, pts, gp, grade, need, space …). */
  slots: Record<string, string>
  /** Extra paragraphs built by the career from facts. */
  paragraphs: string[]
  sections?: BeatSection[]
  dek: string
  playerIds?: string[]
}

export function buildFeature(c: DeskCtx, f: FeatureFacts): BeatArticle | null {
  const ctx: ContentCtx = { feature: f.feature, ...f.ctx }
  const slots = { nick: c.nick, ...f.slots }
  const headline = say(c, FT_HEAD, ctx, slots, 'h')
  const lede = say(c, FT_LEDE, ctx, slots, 'l')
  if (!headline) return null
  return article(c, 'feature', headline, f.dek, [lede, ...f.paragraphs], {
    ...(f.sections ? { sections: f.sections } : {}),
    ...(f.playerIds ? { playerIds: f.playerIds } : {}),
  })
}

/* ═══════════════════════════════ HOT SEAT ═══════════════════════════════ */

export function buildHotSeat(
  c: DeskCtx,
  stage: 'radar' | 'backed' | 'hedged' | 'recovered' | 'fired',
  slots: { coach: string; record: string; rank: string; expected: string; gm: string },
): BeatArticle {
  const all = { nick: c.nick, ...slots }
  const headline = say(c, HS_HEAD, { stage }, all, 'h')
  const body = say(c, HS_BODY, { stage, tilt: c.tilt }, all, 'b')
  return article(c, 'hotSeat', headline, `${slots.coach}: ${slots.record}, ${slots.rank}.`, [body])
}

/* ═══════════════════════════════ CLAIMS ═══════════════════════════════ */

export function buildClaimPiece(
  c: DeskCtx,
  claim: 'playoffs' | 'building' | 'coachBacked' | 'playerCore',
  right: boolean,
  slots: { gm: string; when: string; quote: string; name: string; coach: string; outcome: string },
): BeatArticle {
  const all = { nick: c.nick, ...slots }
  const headline = say(c, CLAIM_HEAD, { claim, right }, all, 'h')
  const body = say(c, CLAIM_BODY, { claim, right }, all, 'b')
  return article(c, 'claim', headline, `On the record, ${slots.when}: "${slots.quote}"`, [body])
}
