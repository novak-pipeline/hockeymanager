/**
 * The playtester's FLAVOUR AUDIT.
 *
 * The autopilot already proves the game does not crash and that the numbers are
 * sane. This module asks the harder question the user actually cares about: does
 * the world feel ALIVE? A management game can be mechanically perfect and still
 * be dead on the page, and that failure is invisible to every other check here.
 *
 * The bar is deliberately high. The genre's audience has thousands of hours in
 * Football Manager, and the closest comparable title (Esports Manager 2026) was
 * dragged to Mixed on Steam almost entirely by "the stats are just there for
 * show" — depth that could not be felt. See docs/LESSONS-ESPORTS-MANAGER.md.
 *
 * Everything here is MEASURED, not judged. "The prose felt repetitive" is an
 * opinion; "the same headline template fired 47 times in one season" is a bug
 * report. The findings feed the persona reporter, which supplies the judgement.
 */

/** One flavour finding: something the world failed to dramatise, or overdid. */
export interface FlavourFinding {
  kind: 'repetition' | 'silence' | 'undramatised' | 'raw-number' | 'vocabulary'
  detail: string
  /** How many times it happened — a single instance is noise, a pattern is a bug. */
  count: number
}

export interface FlavourReport {
  season: number
  /** Every story the world told this season. */
  newsItems: number
  distinctHeadlines: number
  /** Distinct headline SHAPES — names and numbers stripped. The honest measure of
   *  variety: fifty headlines from one template is one story told fifty times. */
  distinctTemplates: number
  /** Days the world said nothing at all. A season is ~180 days; a world that is
   *  silent for most of them is not a world. */
  quietDays: number
  findings: FlavourFinding[]
}

/** Strip the specifics so two instances of one template collapse together.
 *  "Crosby scores 40th" and "Malkin scores 30th" are the same sentence. */
export function templateOf(headline: string): string {
  return headline
    .replace(/\d+/g, '#')
    .replace(/\b[A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)*\b/g, 'X')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Words whose overuse the user has already flagged by ear — "the board" turned
 *  up in nearly every scouting string. Counting them is cheap; noticing them by
 *  reading a season of prose is not. */
const WATCHED = ['the board', 'intrigue', 'upside', 'the room', 'a real', 'quietly', 'the numbers']

export interface DayText { day: number; headline: string; body: string }

/**
 * Judge one season's prose. `notable` carries games the sim itself called
 * dramatic (overtime, a shutout, a comeback, a rout) so we can ask the question
 * that matters: did anything get WRITTEN about them?
 */
export function auditSeason(
  season: number,
  texts: DayText[],
  notable: Array<{ day: number; what: string }>,
): FlavourReport {
  const findings: FlavourFinding[] = []
  const headlines = texts.map((t) => t.headline).filter(Boolean)
  const distinct = new Set(headlines)

  const byTemplate = new Map<string, number>()
  for (const h of headlines) {
    const t = templateOf(h)
    byTemplate.set(t, (byTemplate.get(t) ?? 0) + 1)
  }

  // A template is allowed to recur — results and signings SHOULD. It becomes a
  // flavour bug when one shape dominates the season's voice.
  for (const [tpl, n] of [...byTemplate.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    if (n >= 12) findings.push({ kind: 'repetition', count: n, detail: `one headline shape fired ${n}x: "${tpl.slice(0, 90)}"` })
  }

  // Verbatim repeats are worse than a shared shape: the same sentence twice.
  for (const [h, n] of countBy(headlines).slice(0, 5)) {
    if (n >= 4) findings.push({ kind: 'repetition', count: n, detail: `identical headline ${n}x: "${h.slice(0, 90)}"` })
  }

  const corpus = texts.map((t) => `${t.headline} ${t.body}`).join(' ').toLowerCase()
  for (const w of WATCHED) {
    const n = corpus.split(w).length - 1
    if (n >= 15) findings.push({ kind: 'vocabulary', count: n, detail: `"${w}" appears ${n}x in one season's prose` })
  }

  // Numbers a human would read as a word. The user has objected to bare decimals
  // twice now; anything with two decimal places in prose is a spreadsheet leaking.
  const rawNums = (corpus.match(/\b\d+\.\d{2,}\b/g) ?? []).length
  if (rawNums >= 5) findings.push({ kind: 'raw-number', count: rawNums, detail: `${rawNums} bare multi-decimal numbers in player-facing prose` })

  const daysWithNews = new Set(texts.map((t) => t.day))
  const span = texts.length ? Math.max(...texts.map((t) => t.day)) : 0
  let quiet = 0
  for (let d = 1; d <= span; d++) if (!daysWithNews.has(d)) quiet++
  if (span > 0 && quiet / span > 0.5) {
    findings.push({ kind: 'silence', count: quiet, detail: `${quiet} of ${span} days produced no story at all` })
  }

  // The core question: the sim knew something dramatic happened. Did anyone say so?
  let undramatised = 0
  const examples: string[] = []
  for (const ev of notable) {
    if (!daysWithNews.has(ev.day)) {
      undramatised++
      if (examples.length < 3) examples.push(`d${ev.day} ${ev.what}`)
    }
  }
  if (undramatised > 0) {
    findings.push({
      kind: 'undramatised',
      count: undramatised,
      detail: `${undramatised} dramatic game(s) passed with no story written — e.g. ${examples.join('; ')}`,
    })
  }

  return {
    season,
    newsItems: texts.length,
    distinctHeadlines: distinct.size,
    distinctTemplates: byTemplate.size,
    quietDays: quiet,
    findings,
  }
}

function countBy(xs: string[]): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
