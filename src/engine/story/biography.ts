/**
 * THE BIOGRAPHY — a career told as prose, on the Hades content model.
 *
 * The problem this solves (playtest 2026-08-26, A1): a player profile is a
 * spreadsheet. Football Manager's is too, except it also tells you who the man
 * IS — where he came from, where he slid to on draft day, the year everything
 * turned, the sweater he has worn for a decade. That reads as a life. A stat
 * table reads as a database.
 *
 * There are two ways to write one badly. Stitch a fixed template ("X was born
 * in Y. He has Z points.") and it reads as a mail merge. Generate it freely and
 * it reads as AI, which is the user's stated bar: "I dont want it to feel like
 * it was written by AI i want it immersive and interesting to read."
 *
 * So: the HADES MODEL (docs/EXCELLENCE.md §4, docs/NARRATIVE-ENGINE.md).
 * FACTS come from the sim — every claim traces to a recorded number. VOICE
 * comes from authored variant pools, and the MOST SPECIFIC eligible variant
 * wins, so a 39-year-old one-club goaltender and an undrafted fourth-liner
 * never get the same sentence. Selection is seeded on the player's id: his
 * biography is stable every time it is opened, and unlike the next man's.
 *
 * The discipline that matters most here: **a biography that is wrong is worse
 * than no biography.** Every beat below is a DETECTOR over recorded facts, and
 * a detector that cannot prove its claim returns null, so the sentence never
 * exists. Nothing infers a cause the record does not carry — a 24-game season
 * is reported as a 24-game season, never as "injury-hit" — and nothing counts a
 * career the database never recorded (see {@link BiographyFacts.historyKnown}).
 *
 * Pure + deterministic. No sim state is read here; the career layer assembles
 * {@link BiographyFacts} and calls {@link buildBiography}.
 */
import { Rng } from '@engine/shared/rng'
import {
  markUsed,
  renderTemplate,
  selectVariant,
  type ContentCtx,
  type ContentUse,
  type ContentVariant,
} from '@engine/story/contentEngine'

/* ═════════════════════════════ facts in ═════════════════════════════ */

/** One season on the record — imported from the source DB or simmed by us. */
export interface BioSeason {
  year: number
  /** Club NICKNAME for prose ("Penguins"), already resolved by the caller.
   *  Templates supply the article, so this is never "the Penguins". */
  clubShort: string
  /** League label as the record book spells it. */
  league: string
  /** True when this season was played in the league this save plays. */
  top: boolean
  gamesPlayed: number
  goals: number
  assists: number
  /** Goalie rows only; 0 for skaters. */
  wins: number
  shutouts: number
  /** Goalie rows only, 0–1. Absent when the row records no shots. */
  savePct?: number
}

/** A change of club we can actually attribute. */
export interface BioMove {
  year: number
  /** How he arrived. Absent = the record shows the move but not its cause. */
  via?: 'draft' | 'trade' | 'signing' | 'waiver' | 'expansion'
  toClubShort: string
  fromClubShort?: string
}

export interface BioAward {
  award: string
  /** Absent for honours imported as a count with no year attached. */
  year?: number
}

export interface BiographyFacts {
  playerId: string
  name: string
  age: number
  position: 'C' | 'W' | 'D' | 'G'
  nationality?: string
  birthplace?: string
  heightCm?: number
  weightKg?: number
  /**
   * The year the game is standing in. Required, and never inferred: "he was 19
   * when they put him in the lineup" is arithmetic on his age now and how long
   * ago that season was, so guessing the year here would put a wrong age in
   * print. The sim ages players once per rollover, which makes the subtraction
   * exact rather than approximate.
   */
  currentYear: number
  /** Short label of the league this save plays, for prose ("NHL"). */
  leagueShort: string
  /** Completed seasons, OLDEST FIRST. Excludes the season in progress. */
  seasons: BioSeason[]
  /** The season in progress, if he has dressed for a game in it. */
  current?: {
    year: number
    clubShort: string
    /** True when the club he is playing for is in the league this save plays.
     *  A man on the farm has games this season but no games in THIS league. */
    top: boolean
    gamesPlayed: number
    goals: number
    assists: number
    wins: number
    shutouts: number
  }
  draft?: { year: number; round?: number; overall?: number; club?: string }
  /**
   * Does a career record exist for this man at all? False means the source
   * database shipped no history for him — so an empty `seasons` list means "we
   * do not know", not "he never played", and the prose keeps its mouth shut
   * rather than calling a 34-year-old a newcomer.
   */
  historyKnown: boolean
  awards: BioAward[]
  /** Championships on the record (imported count + those won in this save). */
  cups: number
  intl?: { apps: number; goals: number; assists: number }
  moves: BioMove[]
  /** League records he holds outright, e.g. "single-season goals", "65", 2029. */
  recordsHeld: Array<{ label: string; value: string; year: number }>
  retiredYear?: number
  /** Currently out. Reported as a present fact, never back-projected. */
  injury?: { description: string; gamesRemaining: number }
  /** Club he is on now, as a nickname ("Penguins"); absent = unattached. */
  clubShort?: string
  /** The city half of that club's name ("Pittsburgh"), so prose can say a man
   *  has been somewhere rather than been inside a nickname. */
  clubCity?: string
}

/* ═════════════════════════════ prose out ═════════════════════════════ */

export interface BiographyView {
  /** 1–4 paragraphs. Never empty — callers get null instead. */
  paragraphs: string[]
  /** Which detectors fired, in order. Tests assert on this, not on prose. */
  beats: string[]
  /** Variant ids chosen — the content audit reads these. */
  variantIds: string[]
}

/* ═════════════════════════════ helpers ═════════════════════════════ */

function hashId(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function commas(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** "2029–30" — the way a record book prints a season. */
export function bioSeasonLabel(year: number): string {
  return `${year}–${String((year + 1) % 100).padStart(2, '0')}`
}

function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  const rem10 = n % 10
  return `${n}${rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th'}`
}

function heightLabel(cm: number): string {
  const inches = Math.round(cm / 2.54)
  return `${Math.floor(inches / 12)}'${inches % 12}"`
}

const SMALL_NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
]

/** Hockey writing spells small counts out and prints big ones. */
function spell(n: number): string {
  return n >= 0 && n <= 20 ? SMALL_NUMBERS[n] : commas(n)
}

function cap(s: string): string {
  return s.replace(/^./, (c) => c.toUpperCase())
}

function posWord(pos: BiographyFacts['position']): string {
  return pos === 'G' ? 'goaltender' : pos === 'D' ? 'defenseman' : pos === 'C' ? 'center' : 'winger'
}

function points(s: BioSeason): number {
  return s.goals + s.assists
}

/**
 * Words that belong to the NICKNAME rather than the city, so "Toronto Maple
 * Leafs" splits as Toronto / Maple Leafs and not Toronto Maple / Leafs. A club
 * whose name doesn't match simply splits on the last word, which is how a fan
 * shortens it anyway ("the Lightning", "the Jackets").
 */
const NICKNAME_MODIFIERS = new Set([
  'maple', 'blue', 'golden', 'red', 'mighty', 'black', 'white', 'silver', 'grand',
])

/**
 * Split a club's full name into the two forms prose needs: the nickname a
 * sentence puts an article in front of ("the Penguins") and the city a man can
 * be said to have spent years IN ("Pittsburgh").
 */
export function splitClubName(full: string): { nickname: string; city: string } {
  const words = full.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { nickname: full, city: full }
  if (words.length === 1) return { nickname: words[0], city: words[0] }
  const takeTwo = words.length >= 3 && NICKNAME_MODIFIERS.has(words[words.length - 2].toLowerCase())
  const cut = takeTwo ? words.length - 2 : words.length - 1
  return { nickname: words.slice(cut).join(' '), city: words.slice(0, cut).join(' ') }
}

/* ═══════════════════════════ authored pools ═══════════════════════════

   House rules for anyone adding variants below (biography.test.ts enforces
   the first two, and fails the build when they are broken):
     · No essay connectives and no filler adverbs. The banned list lives in the
       test; that vocabulary is most of what makes prose smell generated.
     · Every {slot} must be filled by its detector. A slot the detector cannot
       prove does not belong in the pool at all.
     · Sentence shapes vary WITHIN a pool. Eight variants that all open "He …"
       are one variant wearing eight coats of paint.
     · State the fact. Never the cause the record does not carry.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── ORIGIN. Slots: {first} {last} {name} {posWord} {age} {birthplace}
      {nationality} {height} {weight} {leagueShort} {seasonCountWord} ── */

const ORIGIN_POOL: ContentVariant[] = [
  // Long career, place known — open on the place, close on the scale.
  { id: 'bio.origin.veteran.place', conditions: { hasBirthplace: true, minSeasonCount: 10 },
    text: `{last} left {birthplace} a long time ago. {SeasonCountWord} seasons of {leagueShort} hockey have happened since.` },
  { id: 'bio.origin.veteran.place2', conditions: { hasBirthplace: true, minSeasonCount: 10 },
    text: `Born in {birthplace}. {SeasonCountWord} seasons later, the {leagueShort} has had plenty of time to form an opinion.` },
  { id: 'bio.origin.veteran.g', conditions: { hasBirthplace: true, minSeasonCount: 8, position: 'G' },
    text: `{first} {last} has been stopping pucks in this league since {firstYear}. He is from {birthplace}.` },
  { id: 'bio.origin.veteran.big', conditions: { hasBirthplace: true, minSeasonCount: 8, minHeightCm: 193 },
    text: `{height}, {weight} pounds, out of {birthplace}. {last} has never been hard to find on the ice.` },

  // Mid-career, place known.
  { id: 'bio.origin.mid.place', conditions: { hasBirthplace: true, minSeasonCount: 4, maxSeasonCount: 9 },
    text: `{first} {last}, {posWord}, out of {birthplace}. {SeasonCountWord} seasons on the record.` },
  { id: 'bio.origin.mid.place2', conditions: { hasBirthplace: true, minSeasonCount: 4, maxSeasonCount: 9 },
    text: `{birthplace} is where {last} is from. The {leagueShort} is where he has spent the last {seasonCountWord} seasons.` },
  { id: 'bio.origin.mid.small', conditions: { hasBirthplace: true, minSeasonCount: 3, maxHeightCm: 178 },
    text: `{height} in skates and out of {birthplace}, {last} has spent his career as the smallest man in most of the photographs.` },

  // Young, place known.
  { id: 'bio.origin.young.place', conditions: { hasBirthplace: true, maxAge: 22 },
    text: `{first} {last} is {age}, plays {posWord}, and comes from {birthplace}.` },
  { id: 'bio.origin.young.place2', conditions: { hasBirthplace: true, maxAge: 22 },
    text: `From {birthplace}: {last}, {age} years old, a {posWord}.` },
  { id: 'bio.origin.young.d', conditions: { hasBirthplace: true, maxAge: 21, position: 'D' },
    text: `{last} is {age} and from {birthplace}, and every scout who files on him files on his feet first.` },
  { id: 'bio.origin.young.g', conditions: { hasBirthplace: true, maxAge: 21, position: 'G' },
    text: `A {age}-year-old goaltender out of {birthplace}. Goalies take longer than anyone to know.` },

  // Nationality but no town.
  { id: 'bio.origin.nation', conditions: { hasNationality: true, minSeasonCount: 1 },
    text: `{first} {last} is a {posWord} out of {nationality}, {age} years old, with {seasonCountWord} seasons behind him.` },
  { id: 'bio.origin.nation2', conditions: { hasNationality: true, minSeasonCount: 1 },
    text: `A {posWord}, {age} years old, playing out of {nationality}. That is {last} in one line, and the rest of this takes longer.` },
  { id: 'bio.origin.nation.young', conditions: { hasNationality: true, maxAge: 21 },
    text: `{last} is {age}, came up through {nationality}, and the file on him is still mostly blank pages.` },

  // Nothing but the man himself.
  { id: 'bio.origin.plain.vet', conditions: { minSeasonCount: 8 },
    text: `{first} {last}, {age}, {posWord}. {SeasonCountWord} seasons of it.` },
  { id: 'bio.origin.plain', conditions: { minSeasonCount: 1 },
    text: `{first} {last} is a {age}-year-old {posWord}.` },
  { id: 'bio.origin.plain.new',
    text: `{first} {last}, {age}, plays {posWord}.` },

  // We hold no record of him, and he is too old for that to mean rookie. Said
  // only when he is not playing right now — a man mid-season has a season, and
  // the "now" beat is a better opening than a shrug. Three variants because in
  // a fresh fictional league this is EVERY veteran until the seasons accrue.
  { id: 'bio.origin.unknown', conditions: { historyKnown: false, minAge: 25, playing: false },
    text: `{first} {last} is {age}. Whatever he did before he got here, nobody wrote it down.` },
  { id: 'bio.origin.unknown2', conditions: { historyKnown: false, minAge: 25, playing: false },
    text: `The file on {first} {last} starts the day he arrived. He was {age} by then, so it is not the whole story.` },
  { id: 'bio.origin.unknown3', conditions: { historyKnown: false, minAge: 25, playing: false, hasBirthplace: true },
    text: `{last} is {age} and from {birthplace}. Everything between those two facts went unrecorded.` },
]

/* ── DRAFT. Slots: {draftYear} {round} {roundOrdinal} {overall}
      {ordinalOverall} {overallBefore} {draftClub} ── */

const DRAFT_POOL: ContentVariant[] = [
  { id: 'bio.draft.first', conditions: { overall: 1 },
    text: `He went first overall in {draftYear}. There is no hiding place attached to that pick and he has never had one.` },
  { id: 'bio.draft.top3', conditions: { maxOverall: 3, minOverall: 2, hasDraftClub: true },
    text: `The {draftClub} took him {ordinalOverall} overall in {draftYear}, which is the range where a club expects to be right.` },
  { id: 'bio.draft.lottery', conditions: { maxOverall: 10, minOverall: 4, hasDraftClub: true },
    text: `Drafted {ordinalOverall} overall by the {draftClub} in {draftYear}.` },
  { id: 'bio.draft.lottery2', conditions: { maxOverall: 10, minOverall: 4, hasDraftClub: true },
    text: `The {draftClub} spent the {ordinalOverall} pick of the {draftYear} draft on him.` },
  { id: 'bio.draft.first-round', conditions: { round: 1, minOverall: 11, hasDraftClub: true },
    text: `A first-round pick: {ordinalOverall} overall to the {draftClub} in {draftYear}.` },
  { id: 'bio.draft.second', conditions: { round: 2, hasDraftClub: true },
    text: `The {draftClub} called his name in the second round in {draftYear}, {ordinalOverall} overall.` },
  { id: 'bio.draft.second2', conditions: { round: 2, becameProducer: true, hasDraftClub: true },
    text: `Second round, {draftYear}, {ordinalOverall} overall to the {draftClub} — and a good deal of that first round has aged worse.` },
  { id: 'bio.draft.slide.made-it', conditions: { minRound: 3, becameProducer: true, hasDraftClub: true },
    text: `Nobody wanted him until the {roundOrdinal} round in {draftYear}, when the {draftClub} finally did — {overallBefore} names ahead of his.` },
  { id: 'bio.draft.slide.made-it3', conditions: { minRound: 3, becameProducer: true, hasDraftClub: true },
    text: `The {draftClub} got him with the {ordinalOverall} pick in {draftYear}, which by now looks like theft.` },
  { id: 'bio.draft.slide.made-it4', conditions: { minRound: 3, becameProducer: true, hasDraftClub: true },
    text: `He sat in that {draftYear} draft hall until the {roundOrdinal} round. The {draftClub} were the ones who stopped it.` },
  { id: 'bio.draft.slide.made-it2', conditions: { minRound: 4, becameProducer: true },
    text: `{ordinalOverall} overall, {draftYear}. Every scout in that building had {overallBefore} players rated above him.` },
  { id: 'bio.draft.late', conditions: { minRound: 3, hasDraftClub: true },
    text: `He was a {roundOrdinal}-round pick in {draftYear}, {ordinalOverall} overall, to the {draftClub}.` },
  { id: 'bio.draft.late2', conditions: { minRound: 5, hasDraftClub: true },
    text: `The {draftClub} took him {ordinalOverall} overall in {draftYear}, deep enough into the day that the room had thinned out.` },
  { id: 'bio.draft.plain.club', conditions: { hasDraftClub: true },
    text: `The {draftClub} drafted him in {draftYear}.` },
  // Club unknown — the pick is still a fact worth stating.
  { id: 'bio.draft.noclub.overall', conditions: { minOverall: 1 },
    text: `He was drafted {ordinalOverall} overall in {draftYear}.` },
  { id: 'bio.draft.noclub.round', conditions: { minRound: 1 },
    text: `A {roundOrdinal}-round pick in {draftYear}.` },
  { id: 'bio.draft.plain',
    text: `He was drafted in {draftYear}.` },
]

/** Drafted, and never dressed for the club that took him. */
const DRAFT_NEVER_PLAYED_POOL: ContentVariant[] = [
  { id: 'bio.draftnever.a', text: `He never dressed for the {draftClub}.` },
  { id: 'bio.draftnever.b', text: `The {draftClub} never got a game out of him.` },
  { id: 'bio.draftnever.c', text: `Not one of his games came in {draftClub} colours.` },
  { id: 'bio.draftnever.d', text: `Whatever the {draftClub} saw in him, they never saw it in their own building.` },
  { id: 'bio.draftnever.e', text: `His {draftClub} career lasted zero games.` },
  { id: 'bio.draftnever.f', text: `That pick bought the {draftClub} nothing — he played his hockey elsewhere.` },
]

/** No draft record, and old enough that this is a fact rather than a gap. */
const UNDRAFTED_POOL: ContentVariant[] = [
  { id: 'bio.undrafted.made-it', conditions: { becameProducer: true },
    text: `No club drafted him. He has since made a fair number of them look foolish.` },
  { id: 'bio.undrafted.a', text: `He was never drafted.` },
  { id: 'bio.undrafted.b', text: `His name was not called at any draft. He got here the long way.` },
]

/* ── DEBUT. Slots: {debutSeason} {debutClub} {debutAge} {debutGp} {leagueShort} ── */

const DEBUT_POOL: ContentVariant[] = [
  { id: 'bio.debut.teen', conditions: { maxDebutAge: 18 },
    text: `He was {debutAge} when the {debutClub} put him in the lineup in {debutSeason}, which is young enough that the league notices.` },
  { id: 'bio.debut.young.full', conditions: { maxDebutAge: 20, minDebutGp: 60 },
    text: `The {debutClub} handed him {debutGp} games in {debutSeason}, at {debutAge}. No easing in.` },
  { id: 'bio.debut.young.full2', conditions: { maxDebutAge: 20, minDebutGp: 60 },
    text: `At {debutAge} he played {debutGp} games for the {debutClub}. Clubs do not do that with players they are unsure about.` },
  { id: 'bio.debut.young.full3', conditions: { maxDebutAge: 20, minDebutGp: 60 },
    text: `{debutSeason} was the first, and it was a full one: {debutGp} games at {debutAge}.` },
  { id: 'bio.debut.young', conditions: { maxDebutAge: 20 },
    text: `His first {leagueShort} season came at {debutAge}: {debutGp} games for the {debutClub} in {debutSeason}.` },
  { id: 'bio.debut.cup-of-coffee', conditions: { maxDebutGp: 12 },
    text: `The {leagueShort} first saw him in {debutSeason} — {debutGp} games for the {debutClub}, and then back down.` },
  { id: 'bio.debut.late', conditions: { minDebutAge: 24 },
    text: `He did not play an {leagueShort} game until {debutSeason}, at {debutAge}. The {debutClub} were the club that finally used him.` },
  { id: 'bio.debut.late2', conditions: { minDebutAge: 24 },
    text: `He was {debutAge} before anyone gave him an {leagueShort} game. The {debutClub} were the ones who did, in {debutSeason}.` },
  { id: 'bio.debut.late3', conditions: { minDebutAge: 24 },
    text: `The {leagueShort} took its time with him — no games until {debutSeason}, when the {debutClub} gave him {debutGp}.` },
  { id: 'bio.debut.full', conditions: { minDebutGp: 70 },
    text: `The {debutClub} dressed him {debutGp} times in {debutSeason}, his first season in the league.` },
  { id: 'bio.debut.g', conditions: { position: 'G' },
    text: `{debutSeason} was his first in the league: {debutGp} appearances for the {debutClub}.` },
  { id: 'bio.debut.a',
    text: `He arrived in {debutSeason} with the {debutClub}, {debutGp} games at {debutAge}.` },
  { id: 'bio.debut.b',
    text: `{debutSeason} was the start of it: {debutGp} games for the {debutClub}.` },
]

/* ── BREAKOUT. Slots: {breakSeason} {breakClub} {breakAge} {breakPts} {breakG}
      {breakA} {breakGp} {breakWins} {priorBest} {priorBestG} ── */

const BREAKOUT_POOL: ContentVariant[] = [
  { id: 'bio.break.huge', conditions: { minBreakPts: 90 },
    text: `Then {breakSeason} happened: {breakPts} points, {breakG} of them goals, in {breakGp} games. His best before that was {priorBest}.` },
  { id: 'bio.break.goals', conditions: { minBreakG: 40 },
    text: `{breakSeason} was the year the goals came — {breakG} of them, on the way to {breakPts} points. He had never scored more than {priorBestG} in a season.` },
  { id: 'bio.break.playmaker', conditions: { minBreakA: 55 },
    text: `In {breakSeason} he put up {breakA} assists. That is a different player from the one who managed {priorBest} points the year before.` },
  { id: 'bio.break.young', conditions: { maxBreakAge: 21 },
    text: `At {breakAge} he jumped from {priorBest} points to {breakPts}. Clubs stop calling that development and start calling it a problem for everyone else.` },
  { id: 'bio.break.d', conditions: { position: 'D', minBreakPts: 45 },
    text: `{breakSeason} rearranged the file: {breakPts} points from the blue line in {breakGp} games, up from {priorBest}.` },
  { id: 'bio.break.g', conditions: { position: 'G', minBreakWins: 30 },
    text: `{breakSeason} was when the {breakClub} stopped rotating him: {breakWins} wins in {breakGp} appearances.` },
  { id: 'bio.break.late', conditions: { minBreakAge: 26 },
    text: `The step came late. He was {breakAge} in {breakSeason} when he went from {priorBest} points to {breakPts}.` },
  { id: 'bio.break.a',
    text: `{breakSeason} was the turn: {breakPts} points in {breakGp} games for the {breakClub}, against a previous best of {priorBest}.` },
  { id: 'bio.break.b',
    text: `He had never cleared {priorBest} points until {breakSeason}, when he finished on {breakPts}.` },
]

/* ── PEAK. Slots: {peakSeason} {peakClub} {peakAge} {peakPts} {peakG} {peakA}
      {peakGp} {peakWins} {peakSo} {peakSv} ── */

const PEAK_POOL: ContentVariant[] = [
  { id: 'bio.peak.elite', conditions: { minPeakPts: 100 },
    text: `The high-water mark is {peakPts} points in {peakSeason}. Very few men in the history of this league have had a season like it.` },
  { id: 'bio.peak.sniper', conditions: { minPeakG: 50 },
    text: `He scored {peakG} goals in {peakSeason}. Fifty is the number that separates the good scorers from the ones people remember.` },
  { id: 'bio.peak.strong', conditions: { minPeakPts: 70 },
    text: `His best season is still {peakSeason}: {peakPts} points in {peakGp} games for the {peakClub}, at {peakAge}.` },
  { id: 'bio.peak.strong2', conditions: { minPeakPts: 70 },
    text: `He was {peakAge} for the best of it — {peakPts} points in {peakSeason}, and the {peakClub} have wanted that season back ever since.` },
  { id: 'bio.peak.strong3', conditions: { minPeakPts: 70 },
    text: `{peakPts} points in {peakSeason}. That is the season on the top of his file and it has stayed there.` },
  { id: 'bio.peak.d', conditions: { position: 'D', minPeakPts: 50 },
    text: `{peakPts} points from a defenseman in {peakSeason} remains the number on his file that people quote.` },
  { id: 'bio.peak.g.wins', conditions: { position: 'G', minPeakWins: 38 },
    text: `{peakSeason} was his year in the crease: {peakWins} wins and {peakSo} shutouts for the {peakClub}.` },
  { id: 'bio.peak.g.sv', conditions: { position: 'G', minPeakSvPct: 925 },
    text: `He stopped {peakSv} of everything he faced in {peakSeason}, and the {peakClub} have measured him against it ever since.` },
  { id: 'bio.peak.modest', conditions: { maxPeakPts: 34, minSeasonCount: 5 },
    text: `He has never had a season bigger than {peakPts} points, and has never been asked for one.` },
  { id: 'bio.peak.a',
    text: `{peakSeason} is the best of them: {peakPts} points in {peakGp} games.` },
  { id: 'bio.peak.b',
    text: `Nothing on the sheet beats {peakSeason} — {peakG} goals, {peakA} assists, {peakGp} games.` },
]

/* ── AWARDS. Slots: {award} {awardYear} {awardCount} {awardCountWord} {awardList} ── */

const AWARD_POOL: ContentVariant[] = [
  { id: 'bio.award.many', conditions: { minAwardCount: 3 },
    text: `The trophy case: {awardList}.` },
  { id: 'bio.award.many2', conditions: { minAwardCount: 3 },
    text: `He has won {awardCountWord} pieces of silverware — {awardList}.` },
  { id: 'bio.award.two', conditions: { awardCount: 2 },
    text: `Two honours sit against his name: {awardList}.` },
  { id: 'bio.award.one.year', conditions: { awardCount: 1, hasAwardYear: true },
    text: `He won the {award} in {awardYear}.` },
  { id: 'bio.award.one',
    text: `There is a {award} against his name.` },
]

/* ── CUPS. Slots: {cups} {cupsWord} ── */

const CUP_POOL: ContentVariant[] = [
  { id: 'bio.cup.dynasty', conditions: { minCups: 3 },
    text: `He has won the Stanley Cup {cupsWord} times. Most men who play a full career never touch it once.` },
  { id: 'bio.cup.two', conditions: { cups: 2 },
    text: `Two Stanley Cups.` },
  { id: 'bio.cup.one.vet', conditions: { cups: 1, minSeasonCount: 10 },
    text: `He got his hands on the Stanley Cup once, which is once more than most of the men he came into the league with.` },
  { id: 'bio.cup.one',
    text: `He has won a Stanley Cup.` },
]

/* ── RECORDS HELD. Slots: {recordLabel} {recordValue} {recordYear} ── */

const RECORD_POOL: ContentVariant[] = [
  { id: 'bio.record.a',
    text: `The league record for {recordLabel} is his: {recordValue}, set in {recordYear}.` },
  { id: 'bio.record.b',
    text: `He still holds the {recordLabel} record — {recordValue}, from {recordYear}.` },
  { id: 'bio.record.c',
    text: `{recordValue}. That is the {recordLabel} record, it is from {recordYear}, and it is his.` },
]

/* ── MOVEMENT. Slots: {clubCount} {clubCountWord} {tradeCount} {tradeCountWord}
      {lastMoveYear} {lastMoveClub} {lastMoveFrom} ── */

const MOVEMENT_POOL: ContentVariant[] = [
  { id: 'bio.move.journeyman.trades', conditions: { minClubCount: 5, minTradeCount: 3 },
    text: `{ClubCountWord} clubs have had him, {tradeCountWord} of those moves by trade. He knows which airports have the good coffee.` },
  { id: 'bio.move.journeyman', conditions: { minClubCount: 5 },
    text: `{ClubCountWord} different sweaters. That is a career of packing.` },
  { id: 'bio.move.four', conditions: { clubCount: 4, hasLastMove: true },
    text: `Four clubs so far, the last move landing him with the {lastMoveClub} in {lastMoveYear}.` },
  { id: 'bio.move.four.noyear', conditions: { clubCount: 4 },
    text: `Four clubs so far. The {clubShort} are the current one.` },
  { id: 'bio.move.traded.recent', conditions: { minClubCount: 2, lastMoveVia: 'trade', hasMoveFrom: true },
    text: `The {lastMoveFrom} traded him to the {lastMoveClub} in {lastMoveYear}.` },
  { id: 'bio.move.traded.recent2', conditions: { minClubCount: 2, lastMoveVia: 'trade' },
    text: `A trade took him to the {lastMoveClub} in {lastMoveYear}.` },
  { id: 'bio.move.signed.recent', conditions: { minClubCount: 2, lastMoveVia: 'signing' },
    text: `He signed with the {lastMoveClub} in {lastMoveYear}.` },
  { id: 'bio.move.waived.recent', conditions: { minClubCount: 2, lastMoveVia: 'waiver' },
    text: `The {lastMoveClub} claimed him off waivers in {lastMoveYear}, which is the league's cheapest way of telling a man what it thinks of him.` },
  { id: 'bio.move.three', conditions: { clubCount: 3, hasLastMove: true },
    text: `Three clubs have carried him, the {lastMoveClub} since {lastMoveYear}.` },
  { id: 'bio.move.three.noyear', conditions: { clubCount: 3 },
    text: `Three clubs have carried him. The {clubShort} have him now.` },
  { id: 'bio.move.three.noyear2', conditions: { clubCount: 3 },
    text: `Three sets of colours, and the {clubShort} are the current set.` },
  { id: 'bio.move.two', conditions: { clubCount: 2, hasLastMove: true },
    text: `He has played for two clubs, the second of them the {lastMoveClub} since {lastMoveYear}.` },
  { id: 'bio.move.two.noyear', conditions: { clubCount: 2 },
    text: `Two clubs, and the {clubShort} are the one he plays for now.` },
  { id: 'bio.move.two.noyear2', conditions: { clubCount: 2 },
    text: `He has changed sweaters once. The {clubShort} have him.` },
  { id: 'bio.move.two.noyear3', conditions: { clubCount: 2 },
    text: `One move, one new dressing room. He is in the {clubShort} one now.` },
  { id: 'bio.move.two.noyear4', conditions: { clubCount: 2 },
    text: `His career splits in two: before the {clubShort}, and since.` },
  { id: 'bio.move.two.noyear5', conditions: { clubCount: 2 },
    text: `Two crests on the record, the {clubShort} being the current one.` },
  { id: 'bio.move.plain',
    text: `{ClubCountWord} clubs have had him.` },
]

const ONE_CLUB_POOL: ContentVariant[] = [
  { id: 'bio.oneclub.long', conditions: { minSeasonCount: 12 },
    text: `{SeasonCountWord} seasons, one sweater. The {clubShort} have never had to explain him to anybody.` },
  { id: 'bio.oneclub.a', conditions: { minSeasonCount: 8 },
    text: `He has worn one sweater for {seasonCountWord} seasons, which in this league is close to extinct.` },
  { id: 'bio.oneclub.b',
    text: `The {clubShort} are the only club he has played for.` },
]

/* ── TENURE at the current club. Slots: {tenureWord} {clubShort} {clubCity}
      {tenureStart} ── */

const TENURE_POOL: ContentVariant[] = [
  { id: 'bio.tenure.decade', conditions: { minTenure: 10 },
    text: `He has been in {clubCity} since {tenureStart}. Ten years is long enough for a building to start calling a player theirs.` },
  { id: 'bio.tenure.long', conditions: { minTenure: 6 },
    text: `{TenureWord} straight seasons in {clubCity} now, going back to {tenureStart}.` },
  // The floor. The beat itself only fires past four seasons, so these need no
  // condition of their own — and every pool having a floor is what stops a beat
  // from silently vanishing when nothing more specific applies.
  { id: 'bio.tenure.a',
    text: `The {clubShort} have had him since {tenureStart}.` },
  { id: 'bio.tenure.b',
    text: `He has been on this roster since {tenureStart}.` },
  { id: 'bio.tenure.c',
    text: `{TenureWord} of those seasons have been in {clubCity}.` },
]

/* ── THE THIN YEAR. A season that stopped short of the full ones on either
      side of it. The record says how many games; it does not say why, so
      neither do we. Slots: {thinSeason} {thinGp} {thinClub} {thinNeighbourGp} ── */

const THIN_YEAR_POOL: ContentVariant[] = [
  { id: 'bio.thin.severe', conditions: { maxThinGp: 20 },
    text: `{thinSeason} stopped at {thinGp} games. He had played {thinNeighbourGp} the year before.` },
  { id: 'bio.thin.a',
    text: `There is a hole in the middle of the sheet: {thinGp} games in {thinSeason}, against {thinNeighbourGp} the season before it.` },
  { id: 'bio.thin.b',
    text: `He dressed {thinGp} times in {thinSeason}. Every season around it is a full one.` },
]

/* ── DECLINE. Slots: {peakSeason} {peakPts} {lastSeason} {lastPts} {age} ── */

const DECLINE_POOL: ContentVariant[] = [
  { id: 'bio.decline.steep', conditions: { minAge: 34 },
    text: `The numbers have come down: {lastPts} points last season at {age}, a long way from the {peakPts} of {peakSeason}.` },
  { id: 'bio.decline.a',
    text: `He is {age} now, and last season's {lastPts} points sit well below the {peakPts} he managed in {peakSeason}.` },
  { id: 'bio.decline.b',
    text: `{peakSeason} is a while back. {lastSeason} finished on {lastPts} points.` },
]

/* ── NOW. Slots: {clubShort} {curSeason} {curGp} {curGpWord} {curPts} {curG}
      {curA} {curWins} {curSo} {age} {leagueShort} ── */

const NOW_POOL: ContentVariant[] = [
  { id: 'bio.now.hot', conditions: { minCurPtsPerGame: 110, minCurGp: 15 },
    text: `He is having a season: {curPts} points in {curGp} games for the {clubShort}.` },
  { id: 'bio.now.cold', conditions: { maxCurPtsPerGame: 25, minCurGp: 20, minAge: 26 },
    text: `{curSeason} has been {curPts} points in {curGp} games, and the {clubShort} are paying for more than that.` },
  { id: 'bio.now.g', conditions: { position: 'G', minCurGp: 10 },
    text: `He is {curWins} wins into {curGp} appearances for the {clubShort} this season.` },
  { id: 'bio.now.rookie-season', conditions: { trueRookie: true, minCurGp: 5 },
    text: `He is in the middle of his first {leagueShort} season: {curGp} games for the {clubShort}, {curPts} points.` },
  { id: 'bio.now.a', conditions: { minCurGp: 5 },
    text: `Through {curGp} games of {curSeason} he has {curPts} points for the {clubShort}.` },
  { id: 'bio.now.b', conditions: { minCurGp: 5 },
    text: `{curSeason} so far: {curGp} games, {curG} goals, {curA} assists, one {clubShort} sweater.` },
  { id: 'bio.now.fresh', conditions: { maxCurGp: 4 },
    text: `He has dressed {curGpWord} times this season for the {clubShort}.` },
]

/* ── INJURED NOW. Slots: {injury} {injuryGames} {clubShort} ── */

const INJURY_NOW_POOL: ContentVariant[] = [
  { id: 'bio.hurt.long', conditions: { minInjuryGames: 20 },
    text: `He is out at the moment with {injury}, and the estimate is another {injuryGames} games in a suit.` },
  { id: 'bio.hurt.a',
    text: `He is currently out with {injury}, roughly {injuryGames} games from returning.` },
  { id: 'bio.hurt.b',
    text: `Right now he is in the press box: {injury}.` },
]

/* ── PROSPECT (no season in this league yet). Slots: {juniorClub}
      {juniorLeague} {juniorSeason} {juniorGp} {juniorPts} {age} {leagueShort} ── */

const PROSPECT_POOL: ContentVariant[] = [
  { id: 'bio.prospect.producing', conditions: { hasJunior: true, minJuniorPtsPerGame: 100 },
    text: `He has not played an {leagueShort} game. He has scored {juniorPts} points in {juniorGp} for the {juniorClub} of the {juniorLeague}, which is why anybody is reading this page.` },
  { id: 'bio.prospect.g', conditions: { hasJunior: true, position: 'G' },
    text: `He has yet to face an {leagueShort} shot. The {juniorClub} of the {juniorLeague} played him {juniorGp} times in {juniorSeason}.` },
  { id: 'bio.prospect.a', conditions: { hasJunior: true },
    text: `No {leagueShort} games yet. {juniorSeason} was {juniorGp} games and {juniorPts} points for the {juniorClub} in the {juniorLeague}.` },
  { id: 'bio.prospect.b', conditions: { hasJunior: true },
    text: `The record so far is a {juniorLeague} record: {juniorPts} points in {juniorGp} games with the {juniorClub}.` },
  { id: 'bio.prospect.blank',
    text: `Nobody has recorded a game of his yet.` },
]

/* ── INTERNATIONAL. Slots: {intlApps} {intlGoals} {intlPts} {nationality} ── */

const INTL_POOL: ContentVariant[] = [
  { id: 'bio.intl.heavy', conditions: { minIntlApps: 40 },
    text: `{nationality} have capped him {intlApps} times, and he has {intlPts} points to show for it.` },
  { id: 'bio.intl.a', conditions: { minIntlApps: 10 },
    text: `He has {intlApps} caps for {nationality}.` },
  { id: 'bio.intl.b', conditions: { minIntlApps: 1 },
    text: `{intlApps} international appearances sit on his record.` },
]

/* ── RETIRED. Slots: {retiredYear} {careerGp} {careerPts} {careerG} {clubShort} ── */

const RETIRED_POOL: ContentVariant[] = [
  { id: 'bio.retired.great', conditions: { minCareerPts: 900 },
    text: `He retired in {retiredYear} with {careerPts} points in {careerGp} games, which is a career people will still be arguing about in twenty years.` },
  { id: 'bio.retired.long', conditions: { minCareerGp: 900 },
    text: `He hung them up in {retiredYear}, {careerGp} games deep.` },
  { id: 'bio.retired.a',
    text: `He retired in {retiredYear} with {careerGp} games and {careerPts} points behind him.` },
  { id: 'bio.retired.b',
    text: `{retiredYear} was the end of it: {careerGp} games, {careerPts} points, done.` },
]

/* ── CAREER TOTALS closer, for a man with no game this season. Slots:
      {careerGp} {careerPts} {careerG} {careerA} {careerWins} {careerSo} ── */

const TOTALS_POOL: ContentVariant[] = [
  { id: 'bio.totals.thousand', conditions: { minCareerGp: 1000 },
    text: `The running total is {careerGp} games and {careerPts} points. A thousand games is a decade of never being hurt badly enough to stop.` },
  { id: 'bio.totals.g', conditions: { position: 'G', minCareerWins: 200 },
    text: `{careerWins} wins and {careerSo} shutouts, and the count is still going up.` },
  { id: 'bio.totals.big', conditions: { minCareerPts: 600 },
    text: `He is at {careerPts} career points in {careerGp} games and still adding.` },
  { id: 'bio.totals.a', conditions: { minCareerGp: 200 },
    text: `{careerGp} games so far, {careerPts} points.` },
  { id: 'bio.totals.b', conditions: { minCareerGp: 200 },
    text: `The career line reads {careerGp} games, {careerG} goals, {careerA} assists.` },
  { id: 'bio.totals.c', conditions: { minCareerGp: 200 },
    text: `He has {careerPts} points from {careerGp} games, and the number is not finished.` },
  { id: 'bio.totals.d', conditions: { minCareerGp: 200 },
    text: `Add it up: {careerGp} games, {careerG} goals, {careerPts} points.` },
  { id: 'bio.totals.e', conditions: { minCareerGp: 200 },
    text: `{careerG} goals and {careerA} assists across {careerGp} games is where the ledger stands.` },
]

/* ═════════════════════════════ detectors ═════════════════════════════ */

/** One resolved beat: which pool speaks, what it knows, where it lands. */
interface Beat {
  key: string
  pool: ContentVariant[]
  ctx: ContentCtx
  slots: Record<string, string>
  /** Which paragraph this sentence belongs to. */
  para: number
}

/** Career sums over seasons played in the league this save plays. */
export interface BioCareerTotals {
  seasons: number
  gamesPlayed: number
  goals: number
  assists: number
  points: number
  wins: number
  shutouts: number
}

export function bioCareerTotals(seasons: BioSeason[]): BioCareerTotals {
  let gamesPlayed = 0, goals = 0, assists = 0, wins = 0, shutouts = 0, n = 0
  for (const s of seasons) {
    if (!s.top) continue
    n++
    gamesPlayed += s.gamesPlayed
    goals += s.goals
    assists += s.assists
    wins += s.wins
    shutouts += s.shutouts
  }
  return { seasons: n, gamesPlayed, goals, assists, points: goals + assists, wins, shutouts }
}

/**
 * Did he actually become somebody in this league? This is the condition behind
 * "thirty clubs got that one wrong", so it has to mean something: a genuine
 * scoring season, a long career of being wanted, or a starter's win column.
 */
function becameProducer(
  position: BiographyFacts['position'],
  tops: BioSeason[],
  totals: BioCareerTotals,
): boolean {
  if (position === 'G') return totals.wins >= 150
  const best = tops.reduce((m, s) => Math.max(m, points(s)), 0)
  return best >= 55 || totals.points >= 400 || totals.gamesPlayed >= 800
}

/**
 * The breakout: the FIRST season that cleared his previous best by half again
 * and landed somewhere a reader would call a real season. It requires a
 * previous season to beat, so a debut is never mislabelled a breakout.
 */
function findBreakout(
  tops: BioSeason[],
  position: BiographyFacts['position'],
): { s: BioSeason; priorBest: number; priorBestG: number } | null {
  let best = 0, bestG = 0
  const floor = position === 'G' ? 25 : position === 'D' ? 35 : 45
  for (let i = 0; i < tops.length; i++) {
    const s = tops[i]
    const val = position === 'G' ? s.wins : points(s)
    if (i > 0 && best > 0 && val >= floor && val >= best * 1.5) {
      return { s, priorBest: best, priorBestG: bestG }
    }
    if (val > best) { best = val; bestG = s.goals }
  }
  return null
}

/** Best season by the measure that fits the position; needs a real sample. */
function findPeak(tops: BioSeason[], position: BiographyFacts['position']): BioSeason | null {
  const eligible = tops.filter((s) => s.gamesPlayed >= (position === 'G' ? 20 : 30))
  if (eligible.length === 0) return null
  const score = (s: BioSeason): number => (position === 'G' ? s.wins * 100 + s.shutouts : points(s))
  return eligible.reduce((best, s) => (score(s) > score(best) ? s : best))
}

/**
 * A season that stopped short, flanked on BOTH sides by full ones. Two full
 * seasons either side is what makes the dip a fact about that season rather
 * than about a call-up year or the end of a career.
 */
function findThinYear(tops: BioSeason[]): { s: BioSeason; neighbour: number } | null {
  for (let i = 1; i < tops.length - 1; i++) {
    const prev = tops[i - 1], cur = tops[i], next = tops[i + 1]
    if (cur.gamesPlayed <= 45 && prev.gamesPlayed >= 65 && next.gamesPlayed >= 65) {
      return { s: cur, neighbour: prev.gamesPlayed }
    }
  }
  return null
}

/** Consecutive seasons at the club he is on now, counting back from the end. */
function tenureAtCurrentClub(
  tops: BioSeason[],
  clubShort?: string,
): { seasons: number; startYear: number } | null {
  if (clubShort === undefined || tops.length === 0) return null
  let n = 0, startYear = 0
  for (let i = tops.length - 1; i >= 0; i--) {
    if (tops[i].clubShort !== clubShort) break
    n++
    startYear = tops[i].year
  }
  return n > 0 ? { seasons: n, startYear } : null
}

/* ═════════════════════════════ the build ═════════════════════════════ */

/** The first two words of a sentence, lowercased — the sameness key. */
export function bioOpening(sentence: string): string {
  return sentence.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ')
}

/**
 * Turn a resolved beat into a sentence: most specific eligible variant, then a
 * re-pick if it opens on the same two words as an earlier sentence. That guard
 * is the cheapest defence against a page of paragraphs that all start "He has",
 * which is exactly what a generated biography looks like.
 *
 * Variety is a preference; the fact is the requirement. If every candidate
 * collides we ship the first one that rendered rather than lose the beat.
 */
function word(
  beat: Beat,
  rng: Rng,
  ledger: ContentUse[],
  openings: Set<string>,
): { text: string; variantId: string } | null {
  let fallback: { text: string; variantId: string } | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    const v = selectVariant({ pool: beat.pool, ctx: beat.ctx, rng, ledger, year: 0 })
    if (v === null) break
    markUsed(ledger, v.id, 0, attempt)
    const text = renderTemplate(v.text, beat.slots)
    // An unfilled slot is a bug, not a sentence — drop it rather than ship it.
    if (/\{[a-zA-Z0-9_.]+\}/.test(text)) continue
    if (fallback === null) fallback = { text, variantId: v.id }
    const key = bioOpening(text)
    if (openings.has(key)) continue
    openings.add(key)
    return { text, variantId: v.id }
  }
  if (fallback !== null) openings.add(bioOpening(fallback.text))
  return fallback
}

/**
 * Write the man's biography from what the game has actually recorded.
 * Returns null when there is nothing honest to say.
 */
export function buildBiography(facts: BiographyFacts): BiographyView | null {
  const nameParts = facts.name.trim().split(/\s+/)
  const first = nameParts[0] ?? facts.name
  const last = nameParts.length > 1 ? nameParts.slice(1).join(' ') : facts.name

  const tops = facts.seasons.filter((s) => s.top && s.gamesPlayed > 0)
  const totals = bioCareerTotals(facts.seasons)
  const producer = becameProducer(facts.position, tops, totals)
  const clubs = [...new Set(tops.map((s) => s.clubShort))]
  const ageIn = (year: number): number =>
    Math.max(15, facts.age - Math.max(0, facts.currentYear - year))
  const playingInLeague = facts.current !== undefined && facts.current.top && facts.current.gamesPlayed > 0
  /**
   * May we call the season he is in his FIRST in this league? The careerLedger
   * rule (isTrueRookieSeason), applied to prose: an empty ledger is only proof
   * of a debut for a man young enough that no unrecorded career can be hiding
   * behind him. Otherwise a 34-year-old in a save with no imported history gets
   * introduced to the league he has played in for a decade.
   */
  const trueRookie = tops.length === 0 && (facts.historyKnown || facts.age <= 24)

  const beats: Beat[] = []

  /* ── paragraph 0: where he came from, and how he got in ── */

  beats.push({
    key: 'origin',
    pool: ORIGIN_POOL,
    para: 0,
    ctx: {
      hasBirthplace: (facts.birthplace ?? '').length > 0,
      hasNationality: (facts.nationality ?? '').length > 0,
      historyKnown: facts.historyKnown,
      playing: playingInLeague,
      position: facts.position,
      age: facts.age,
      seasonCount: totals.seasons,
      ...(facts.heightCm !== undefined ? { heightCm: facts.heightCm } : {}),
    },
    slots: {
      first, last, name: facts.name,
      posWord: posWord(facts.position),
      age: String(facts.age),
      birthplace: facts.birthplace ?? '',
      nationality: facts.nationality ?? '',
      height: facts.heightCm !== undefined ? heightLabel(facts.heightCm) : '',
      weight: facts.weightKg !== undefined ? String(Math.round(facts.weightKg * 2.20462)) : '',
      leagueShort: facts.leagueShort,
      seasonCountWord: spell(totals.seasons),
      SeasonCountWord: cap(spell(totals.seasons)),
      firstYear: tops.length > 0 ? String(tops[0].year) : '',
    },
  })

  const d = facts.draft
  if (d !== undefined && d.year > 0 && ((d.club ?? '').length > 0 || (d.overall ?? 0) > 0)) {
    const overall = d.overall ?? 0
    const round = d.round ?? (overall > 0 ? Math.max(1, Math.ceil(overall / 32)) : 0)
    const draftClub = d.club ?? ''
    beats.push({
      key: 'draft',
      pool: DRAFT_POOL,
      para: 0,
      ctx: {
        ...(overall > 0 ? { overall } : {}),
        ...(round > 0 ? { round } : {}),
        becameProducer: producer,
        hasDraftClub: draftClub.length > 0,
      },
      slots: {
        draftYear: String(d.year),
        round: String(round),
        roundOrdinal: ordinal(round),
        overall: String(overall),
        overallBefore: String(Math.max(0, overall - 1)),
        ordinalOverall: ordinal(overall),
        draftClub,
      },
    })
    // Only claimable when we hold his record: with no history at all we cannot
    // know that he never dressed for them.
    if (draftClub.length > 0 && facts.historyKnown && tops.length > 0 && !clubs.includes(draftClub)) {
      beats.push({
        key: 'draftNeverPlayed',
        pool: DRAFT_NEVER_PLAYED_POOL,
        para: 0,
        ctx: {},
        slots: { draftClub },
      })
    }
  } else if (facts.historyKnown && facts.age >= 23 && tops.length > 0) {
    beats.push({
      key: 'undrafted',
      pool: UNDRAFTED_POOL,
      para: 0,
      ctx: { becameProducer: producer },
      slots: {},
    })
  }

  /* ── paragraph 1: the rise ── */

  if (tops.length > 0) {
    const debut = tops[0]
    const debutAge = ageIn(debut.year)
    beats.push({
      key: 'debut',
      pool: DEBUT_POOL,
      para: 1,
      ctx: { debutAge, debutGp: debut.gamesPlayed, position: facts.position },
      slots: {
        debutSeason: bioSeasonLabel(debut.year),
        debutClub: debut.clubShort,
        debutAge: String(debutAge),
        debutGp: String(debut.gamesPlayed),
        leagueShort: facts.leagueShort,
      },
    })

    const br = findBreakout(tops, facts.position)
    if (br !== null) {
      const breakAge = ageIn(br.s.year)
      beats.push({
        key: 'breakout',
        pool: BREAKOUT_POOL,
        para: 1,
        ctx: {
          breakPts: points(br.s), breakG: br.s.goals, breakA: br.s.assists,
          breakAge, breakWins: br.s.wins, position: facts.position,
        },
        slots: {
          breakSeason: bioSeasonLabel(br.s.year),
          breakClub: br.s.clubShort,
          breakAge: String(breakAge),
          breakPts: String(points(br.s)),
          breakG: String(br.s.goals),
          breakA: String(br.s.assists),
          breakGp: String(br.s.gamesPlayed),
          breakWins: String(br.s.wins),
          priorBest: String(br.priorBest),
          priorBestG: String(br.priorBestG),
        },
      })
    }

    const peak = findPeak(tops, facts.position)
    // Skip the peak when the breakout WAS the peak. The same season told twice
    // is precisely the mail-merge tell this design exists to avoid.
    if (peak !== null && (br === null || br.s.year !== peak.year)) {
      beats.push({
        key: 'peak',
        pool: PEAK_POOL,
        para: 1,
        ctx: {
          peakPts: points(peak), peakG: peak.goals, peakWins: peak.wins,
          peakSvPct: peak.savePct !== undefined ? Math.round(peak.savePct * 1000) : 0,
          position: facts.position, seasonCount: totals.seasons,
        },
        slots: {
          peakSeason: bioSeasonLabel(peak.year),
          peakClub: peak.clubShort,
          peakAge: String(ageIn(peak.year)),
          peakPts: String(points(peak)),
          peakG: String(peak.goals),
          peakA: String(peak.assists),
          peakGp: String(peak.gamesPlayed),
          peakWins: String(peak.wins),
          peakSo: String(peak.shutouts),
          peakSv: peak.savePct !== undefined
            ? `.${String(Math.round(peak.savePct * 1000)).padStart(3, '0')}` : '',
        },
      })
    }
  } else if (!playingInLeague) {
    // No COMPLETED season in this league, and he is not in it right now either.
    // Say what the record does cover, and nothing more. (A man mid-way through
    // his first season is not a man nobody has recorded a game of — the "now"
    // beat has his games, and this would flatly contradict it.)
    const junior = [...facts.seasons].reverse().find((s) => !s.top && s.gamesPlayed > 0)
    // When the origin has ALREADY said we hold no record of him, saying it a
    // second way is not a second fact.
    const originSaidUnrecorded = !facts.historyKnown && facts.age >= 25
    if (junior !== undefined || !originSaidUnrecorded) beats.push({
      key: 'prospect',
      pool: PROSPECT_POOL,
      para: 1,
      ctx: {
        hasJunior: junior !== undefined,
        position: facts.position,
        juniorPtsPerGame: junior !== undefined && junior.gamesPlayed > 0
          ? Math.round(((junior.goals + junior.assists) / junior.gamesPlayed) * 100) : 0,
      },
      slots: {
        juniorClub: junior?.clubShort ?? '',
        juniorLeague: junior?.league ?? '',
        juniorSeason: junior !== undefined ? bioSeasonLabel(junior.year) : '',
        juniorGp: String(junior?.gamesPlayed ?? 0),
        juniorPts: String(junior !== undefined ? junior.goals + junior.assists : 0),
        age: String(facts.age),
        leagueShort: facts.leagueShort,
      },
    })
  }

  /* ── paragraph 2: honours, movement, the hole in the sheet ── */

  if (facts.awards.length > 0) {
    const named = facts.awards.map((a) => (a.year !== undefined ? `${a.award} (${a.year})` : a.award))
    beats.push({
      key: 'awards',
      pool: AWARD_POOL,
      para: 2,
      ctx: { awardCount: facts.awards.length, hasAwardYear: facts.awards[0].year !== undefined },
      slots: {
        award: facts.awards[0].award,
        awardYear: String(facts.awards[0].year ?? ''),
        awardCount: String(facts.awards.length),
        awardCountWord: spell(facts.awards.length),
        awardList: named.join(', '),
      },
    })
  }

  if (facts.cups > 0) {
    beats.push({
      key: 'cups',
      pool: CUP_POOL,
      para: 2,
      ctx: { cups: facts.cups, seasonCount: totals.seasons },
      slots: { cups: String(facts.cups), cupsWord: spell(facts.cups) },
    })
  }

  if (facts.recordsHeld.length > 0) {
    const r = facts.recordsHeld[0]
    beats.push({
      key: 'record',
      pool: RECORD_POOL,
      para: 2,
      ctx: {},
      slots: { recordLabel: r.label, recordValue: r.value, recordYear: String(r.year) },
    })
  }

  const tenure = tenureAtCurrentClub(tops, facts.clubShort)
  if (clubs.length === 1 && totals.seasons >= 5 && facts.clubShort !== undefined) {
    beats.push({
      key: 'oneClub',
      pool: ONE_CLUB_POOL,
      para: 2,
      ctx: { seasonCount: totals.seasons },
      slots: {
        clubShort: facts.clubShort,
        seasonCountWord: spell(totals.seasons),
        SeasonCountWord: cap(spell(totals.seasons)),
      },
    })
  } else if (clubs.length >= 2) {
    const lastMove = facts.moves.length > 0 ? facts.moves[facts.moves.length - 1] : undefined
    const tradeCount = facts.moves.filter((m) => m.via === 'trade').length
    beats.push({
      key: 'movement',
      pool: MOVEMENT_POOL,
      para: 2,
      ctx: {
        clubCount: clubs.length,
        tradeCount,
        // A move is only datable when the chronicle actually witnessed it. The
        // last season on the sheet is NOT the year he moved.
        hasLastMove: lastMove !== undefined,
        hasMoveFrom: (lastMove?.fromClubShort ?? '').length > 0,
        ...(lastMove?.via !== undefined ? { lastMoveVia: lastMove.via } : {}),
      },
      slots: {
        clubCount: String(clubs.length),
        clubCountWord: spell(clubs.length),
        ClubCountWord: cap(spell(clubs.length)),
        tradeCount: String(tradeCount),
        tradeCountWord: spell(tradeCount),
        clubShort: facts.clubShort ?? clubs[clubs.length - 1],
        lastMoveYear: String(lastMove?.year ?? ''),
        lastMoveClub: lastMove?.toClubShort ?? facts.clubShort ?? clubs[clubs.length - 1],
        lastMoveFrom: lastMove?.fromClubShort ?? '',
      },
    })
    // A long stay is worth saying even when it is not his only club.
    if (tenure !== null && tenure.seasons >= 4 && facts.clubShort !== undefined) {
      beats.push({
        key: 'tenure',
        pool: TENURE_POOL,
        para: 2,
        ctx: { tenure: tenure.seasons },
        slots: {
          clubShort: facts.clubShort,
          clubCity: facts.clubCity ?? facts.clubShort,
          tenureWord: spell(tenure.seasons),
          TenureWord: cap(spell(tenure.seasons)),
          tenureStart: String(tenure.startYear),
        },
      })
    }
  }

  const thin = findThinYear(tops)
  // Calling one season both his best and a hole in the sheet is a contradiction,
  // not two beats. The peak wins.
  const peakForThin = findPeak(tops, facts.position)
  if (thin !== null && (peakForThin === null || peakForThin.year !== thin.s.year)) {
    beats.push({
      key: 'thinYear',
      pool: THIN_YEAR_POOL,
      para: 2,
      ctx: { thinGp: thin.s.gamesPlayed },
      slots: {
        thinSeason: bioSeasonLabel(thin.s.year),
        thinGp: String(thin.s.gamesPlayed),
        thinClub: thin.s.clubShort,
        thinNeighbourGp: String(thin.neighbour),
      },
    })
  }

  if (facts.intl !== undefined && facts.intl.apps > 0 && (facts.nationality ?? '').length > 0) {
    beats.push({
      key: 'intl',
      pool: INTL_POOL,
      para: 2,
      ctx: { intlApps: facts.intl.apps },
      slots: {
        intlApps: String(facts.intl.apps),
        intlGoals: String(facts.intl.goals),
        intlPts: String(facts.intl.goals + facts.intl.assists),
        nationality: facts.nationality as string,
      },
    })
  }

  /* ── paragraph 3: where he stands today ── */

  if (facts.retiredYear !== undefined) {
    beats.push({
      key: 'retired',
      pool: RETIRED_POOL,
      para: 3,
      ctx: { careerGp: totals.gamesPlayed, careerPts: totals.points },
      slots: {
        retiredYear: String(facts.retiredYear),
        careerGp: commas(totals.gamesPlayed),
        careerPts: commas(totals.points),
        careerG: commas(totals.goals),
        clubShort: facts.clubShort ?? '',
      },
    })
  } else {
    const peak = findPeak(tops, facts.position)
    const lastFull = [...tops].reverse().find((s) => s.gamesPlayed >= 40)
    if (
      facts.position !== 'G' && facts.age >= 31 &&
      peak !== null && lastFull !== undefined &&
      lastFull.year > peak.year + 1 && points(peak) >= 40 &&
      points(lastFull) * 2 <= points(peak)
    ) {
      beats.push({
        key: 'decline',
        pool: DECLINE_POOL,
        para: 3,
        ctx: { age: facts.age },
        slots: {
          peakSeason: bioSeasonLabel(peak.year),
          peakPts: String(points(peak)),
          lastSeason: bioSeasonLabel(lastFull.year),
          lastPts: String(points(lastFull)),
          age: String(facts.age),
        },
      })
    }

    const c = facts.current
    if (c !== undefined && c.gamesPlayed > 0) {
      const pts = c.goals + c.assists
      beats.push({
        key: 'now',
        pool: NOW_POOL,
        para: 3,
        ctx: {
          curGp: c.gamesPlayed,
          curPtsPerGame: Math.round((pts / c.gamesPlayed) * 100),
          trueRookie,
          position: facts.position,
          seasonCount: totals.seasons,
          age: facts.age,
        },
        slots: {
          clubShort: c.clubShort,
          curSeason: bioSeasonLabel(c.year),
          curGp: String(c.gamesPlayed),
          curGpWord: spell(c.gamesPlayed),
          curPts: String(pts),
          curG: String(c.goals),
          curA: String(c.assists),
          curWins: String(c.wins),
          curSo: String(c.shutouts),
          age: String(facts.age),
          leagueShort: facts.leagueShort,
        },
      })
    } else if (totals.gamesPlayed >= 200) {
      beats.push({
        key: 'totals',
        pool: TOTALS_POOL,
        para: 3,
        ctx: {
          careerGp: totals.gamesPlayed, careerPts: totals.points,
          careerWins: totals.wins, position: facts.position,
        },
        slots: {
          careerGp: commas(totals.gamesPlayed),
          careerPts: commas(totals.points),
          careerG: commas(totals.goals),
          careerA: commas(totals.assists),
          careerWins: commas(totals.wins),
          careerSo: commas(totals.shutouts),
        },
      })
    }

    if (facts.injury !== undefined && facts.injury.gamesRemaining > 0) {
      beats.push({
        key: 'injuryNow',
        pool: INJURY_NOW_POOL,
        para: 3,
        ctx: { injuryGames: facts.injury.gamesRemaining },
        slots: {
          injury: facts.injury.description,
          injuryGames: String(facts.injury.gamesRemaining),
          clubShort: facts.clubShort ?? '',
        },
      })
    }
  }

  /* ── word it ── */

  const rng = new Rng(hashId(facts.playerId) ^ 0x51ab)
  const ledger: ContentUse[] = []
  const openings = new Set<string>()
  const paras: string[][] = [[], [], [], []]
  const fired: string[] = []
  const variantIds: string[] = []

  for (const beat of beats) {
    const out = word(beat, rng, ledger, openings)
    if (out === null) continue
    paras[beat.para].push(out.text)
    fired.push(beat.key)
    variantIds.push(out.variantId)
  }

  const paragraphs = paras.map((p) => p.join(' ')).filter((p) => p.length > 0)
  if (paragraphs.length === 0) return null
  return { paragraphs, beats: fired, variantIds }
}

/** Every authored pool, for the content audit. */
export const BIOGRAPHY_POOLS: Record<string, ContentVariant[]> = {
  origin: ORIGIN_POOL,
  draft: DRAFT_POOL,
  draftNeverPlayed: DRAFT_NEVER_PLAYED_POOL,
  undrafted: UNDRAFTED_POOL,
  debut: DEBUT_POOL,
  breakout: BREAKOUT_POOL,
  peak: PEAK_POOL,
  awards: AWARD_POOL,
  cups: CUP_POOL,
  record: RECORD_POOL,
  movement: MOVEMENT_POOL,
  oneClub: ONE_CLUB_POOL,
  tenure: TENURE_POOL,
  thinYear: THIN_YEAR_POOL,
  decline: DECLINE_POOL,
  now: NOW_POOL,
  injuryNow: INJURY_NOW_POOL,
  prospect: PROSPECT_POOL,
  intl: INTL_POOL,
  retired: RETIRED_POOL,
  totals: TOTALS_POOL,
}
