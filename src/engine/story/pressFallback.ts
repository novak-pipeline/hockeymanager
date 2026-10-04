/**
 * Deterministic press fallback — richly written, persona-voiced articles rendered
 * from the same PressFactSheet the LLM writers get. This is the DEFAULT generation
 * path: the press corps never goes silent, no API key required.
 *
 * Design principles:
 *  - Multiple template variants per kind × persona, selected by a stable hash of
 *    (teamAbbr + year + day + pressCounter) so repeat pieces differ naturally.
 *  - Three distinct voices: the club's beat writer (beat — measured/close;
 *    a different person per club, see mediaCast.ts), Vic Mercer
 *    (national — analytical/sharp), Bobby "Buzz" Doyle (homer — excitable/warm).
 *  - Real prose: a genuine headline + lede + 2-4 body paragraphs, all woven from
 *    the fact sheet. Reads like The Athletic / a real beat desk, not a mad-lib.
 *  - Pure module: no randomness, no wall-clock. Same sheet + counter → same article.
 */
import {
  PRESS_PERSONA_NAMES,
  type PressFactSheet,
  type PressJob,
  type PressPersonaId,
  type PressResultFact,
  type ScheduledReportFactSheet,
} from './factSheet'
import type { ContentVariant } from './contentEngine'
import { pickStable, possessive, renderStable } from './prose'
import { TILT_FRAME } from './beatPools'

export interface FallbackArticle {
  headline: string
  body: string
  /** "Name — Outlet" persona byline. */
  byline: string
}

/* ────────────────────────── shared helpers ────────────────────────── */

/** Stable integer hash of a string, 0-based, never negative. */
function stableHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

/** One of several equivalent phrasings, stable for this piece (team + date +
 *  salt). A weekly column that runs twenty times a season in the same branch
 *  cannot carry one fixed headline — "the league's most surprising story"
 *  every Monday stops being a story. */
function alt(sheet: PressFactSheet, salt: string, options: string[]): string {
  return options[stableHash(`${sheet.team.abbr}|${sheet.year}|${sheet.day}|${salt}`) % options.length]!
}

/** Pick one element from a list using a stable numeric seed. */
function pick<T>(list: T[], seed: number): T {
  return list[seed % list.length]
}

/** Build the "W 4–1 vs OPP" / "L 2–3 (OT) @ OPP" short form. */
function resultShort(r: PressResultFact): string {
  const wl = r.goalsFor > r.goalsAgainst ? 'W' : 'L'
  const suffix = r.decidedBy === 'overtime' ? ' (OT)' : r.decidedBy === 'shootout' ? ' (SO)' : ''
  const loc = r.home ? 'vs' : '@'
  return `${wl} ${r.goalsFor}–${r.goalsAgainst}${suffix} ${loc} ${r.opponentAbbr}`
}

/** "5–2–1, 11 pts, 3rd of 16" compact record string. */
function recordStr(sheet: PressFactSheet): string {
  const t = sheet.team
  return `${t.wins}–${t.losses}–${t.otLosses} (${t.points} pts, ${ordinal(t.rank)} of ${t.teamsInLeague})`
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** Recent results run as a comma list: "W 4-1 vs OPP, L 2-3 (OT) @ NOR". */
function recentRunStr(sheet: PressFactSheet): string {
  return sheet.lastResults.map(resultShort).join(', ')
}

/** Wins / losses count in recent results. */
function recentRecord(sheet: PressFactSheet): { wins: number; losses: number } {
  const wins = sheet.lastResults.filter((r) => r.goalsFor > r.goalsAgainst).length
  return { wins, losses: sheet.lastResults.length - wins }
}

/** True when the team is overperforming their preseason projection. */
/**
 * Games this club has actually played in the season on the books. Derived, not
 * stored: in this sim every game ends in a win, a loss or an OT loss, so the
 * three columns already carry the sample size — and deriving it means no
 * caller can forget to pass it and quietly re-open the hole below.
 */
function gamesPlayed(sheet: PressFactSheet): number {
  const t = sheet.team
  return t.wins + t.losses + t.otLosses
}

/**
 * Below this many games, a standings position is not evidence. A club can sit
 * 2nd or 26th on four results, and "running 11 places ahead of schedule" is a
 * sentence about noise. Above it, the beat writer is allowed his arithmetic.
 */
const VERDICT_SAMPLE = 12

/**
 * True when the team is beating their preseason projection — AND the season
 * has produced at least one result to beat it with. At 0-0-0 every club in the
 * league is sorted by tiebreak alone, so the comparison is meaningless: a
 * career that starts at the summer takeover would otherwise be told, before a
 * puck has dropped, that it had "over-delivered on every expectation" (A2).
 */
function overPerforming(sheet: PressFactSheet): boolean {
  if (gamesPlayed(sheet) === 0) return false
  return sheet.team.expectedRank !== undefined && sheet.team.rank < sheet.team.expectedRank
}

/** True when the team is underperforming their preseason projection. Same
 *  no-games-no-verdict rule as {@link overPerforming}. */
function underPerforming(sheet: PressFactSheet): boolean {
  if (gamesPlayed(sheet) === 0) return false
  return sheet.team.expectedRank !== undefined && sheet.team.rank > sheet.team.expectedRank
}

/**
 * The expectation-vs-reality sentence, in three registers keyed to how much
 * the standings can actually support:
 *  - no games:   a forward-looking statement of the bar (no verdict exists)
 *  - small book: hedged — the projection is named, the gap is not scored
 *  - full book:  the arithmetic, as before
 */
function expectationBlurb(sheet: PressFactSheet): string | null {
  const t = sheet.team
  if (t.expectedRank === undefined) return null
  const gp = gamesPlayed(sheet)
  if (gp === 0) {
    return `The preseason numbers put them ${ordinal(t.expectedRank)}. That's the bar. Nothing has been played yet.`
  }
  const diff = Math.abs(t.rank - t.expectedRank)
  if (gp < VERDICT_SAMPLE) {
    if (diff === 0) return `They sit exactly where the preseason numbers put them, ${ordinal(t.expectedRank)}, on a book this thin.`
    if (overPerforming(sheet)) return `They're ahead of a preseason projection of ${ordinal(t.expectedRank)}, on ${gp} games.`
    return `They're behind a preseason projection of ${ordinal(t.expectedRank)}, though ${gp} games is a small sample.`
  }
  if (overPerforming(sheet)) {
    if (diff >= 5) return `They were projected ${ordinal(t.expectedRank)} before the season. They're ${diff} places better than that.`
    return `The preseason numbers had them ${ordinal(t.expectedRank)}; they've beaten that projection by ${diff} spots.`
  }
  if (underPerforming(sheet)) {
    if (diff >= 5) return `They were projected ${ordinal(t.expectedRank)}. They're ${diff} places worse than that.`
    return `The club sits ${diff} ${diff === 1 ? 'spot' : 'spots'} below their preseason projection of ${ordinal(t.expectedRank)}.`
  }
  return `They're running exactly to projection, sitting ${ordinal(t.rank)} as expected.`
}

/**
 * The storyline the league is watching, as a sentence. The arc summary is a
 * label ("Marchand — 4 away from 200 career goals") and was dropped into the
 * paragraph raw, with no full stop, so the next sentence ran straight on from
 * it. A lead-in and a terminator make it prose.
 */
function topArcBlurb(sheet: PressFactSheet): string | null {
  const arc = sheet.topArcs[0]
  if (!arc) return null
  const s = arc.summary.trim().replace(/[.!]+$/, '')
  const lead = alt(sheet, 'arc', ['Worth watching: ', 'One to keep an eye on: ', 'Elsewhere, ', 'Also on the radar: '])
  return `${lead}${s}.`
}

/**
 * The mood line. It rides in most weekly and monthly pieces, so one sentence
 * per band read identically a dozen times a season — and "the room" in every
 * one of them. Several frames per band, only some of which say "room", keyed
 * by the date so a week's pieces agree and consecutive weeks differ.
 */
const MOOD_POOL: ContentVariant[] = [
  { id: 'mood.hot.a', conditions: { band: 'hot', cap: true }, text: `The room is running hot, spirits sky-high under the steady hand of captain {cap}.` },
  { id: 'mood.hot.b', conditions: { band: 'hot', cap: true }, text: `Spirits are high, and {cap} has had a lot to do with that.` },
  { id: 'mood.hot.c', conditions: { band: 'hot', cap: true }, text: `It is a loose, confident group right now, and {cap} is setting the tone.` },
  { id: 'mood.hot.d', conditions: { band: 'hot' }, text: `The dressing room is as loose and confident as it has been all season.` },
  { id: 'mood.hot.e', conditions: { band: 'hot' }, text: `This is a happy team. It shows in the way they play.` },
  { id: 'mood.hot.f', conditions: { band: 'hot' }, text: `Confidence is not the problem around here.` },
  { id: 'mood.good.a', conditions: { band: 'good', cap: true }, text: `{cap} has the group in a good place. Spirits are up.` },
  { id: 'mood.good.b', conditions: { band: 'good', cap: true }, text: `By all accounts {cap} has them together. The mood is good.` },
  { id: 'mood.good.c', conditions: { band: 'good', cap: true }, text: `The players say the right things, and {cap} is the one saying most of them.` },
  { id: 'mood.good.d', conditions: { band: 'good' }, text: `The mood is upbeat, if not euphoric.` },
  { id: 'mood.good.e', conditions: { band: 'good' }, text: `Spirits are decent. Nobody is panicking about anything.` },
  { id: 'mood.good.f', conditions: { band: 'good' }, text: `It's a settled dressing room.` },
  { id: 'mood.flat.a', conditions: { band: 'flat', cap: true }, text: `{cap} has some work to do: the group feels a little flat right now.` },
  { id: 'mood.flat.b', conditions: { band: 'flat', cap: true }, text: `The energy is not quite there, and {cap} knows it.` },
  { id: 'mood.flat.c', conditions: { band: 'flat', cap: true }, text: `Things are a bit quiet in the dressing room. {cap} will be expected to change that.` },
  { id: 'mood.flat.d', conditions: { band: 'flat' }, text: `The room reads flat. The energy isn't there.` },
  { id: 'mood.flat.e', conditions: { band: 'flat' }, text: `Nobody is unhappy, exactly. Nobody is much of anything.` },
  { id: 'mood.flat.f', conditions: { band: 'flat' }, text: `The mood is flat, and it has been for a while.` },
  { id: 'mood.low.a', conditions: { band: 'low', cap: true }, text: `The dressing room is in a difficult place, and a lot rides on {capPoss} leadership right now.` },
  { id: 'mood.low.b', conditions: { band: 'low', cap: true }, text: `It is a tense group. {cap} has his hands full.` },
  { id: 'mood.low.c', conditions: { band: 'low', cap: true }, text: `Morale is poor, and people are starting to look at {cap} for an answer.` },
  { id: 'mood.low.d', conditions: { band: 'low' }, text: `The dressing room is in a difficult place.` },
  { id: 'mood.low.e', conditions: { band: 'low' }, text: `This is an unhappy team, and it is not hiding it well.` },
  { id: 'mood.low.f', conditions: { band: 'low' }, text: `Morale is as low as it has been in a long time.` },
]

function moraleBlurb(sheet: PressFactSheet): string {
  const m = Math.round(sheet.lockerRoom.roomMorale)
  const cap = sheet.lockerRoom.captainName
  // Prose only — a beat writer describes the mood, he doesn't read out a 0–100 number.
  const band = m >= 80 ? 'hot' : m >= 60 ? 'good' : m >= 40 ? 'flat' : 'low'
  return renderStable(MOOD_POOL, { band, cap: !!cap }, `mood|${sheet.team.abbr}|${sheet.year}|${sheet.day}`, {
    cap: cap ?? '',
    capPoss: cap ? possessive(cap) : '',
  })
}

function leaderBlurb(sheet: PressFactSheet): string | null {
  const l = sheet.leagueLeaders[0]
  if (!l) return null
  return `${l.name} (${l.teamAbbr}) leads the league with ${l.value} ${l.stat}.`
}

function feudBlurb(sheet: PressFactSheet): string | null {
  const f = sheet.lockerRoom.feuds[0]
  if (!f) return null
  // The sheet carries "A vs B"; a sentence wants "A and B".
  const pair = f.replace(/ vs\.? /, ' and ')
  return alt(sheet, 'feud', [
    `Off the ice, there's friction between ${pair}.`,
    `${pair.replace(/^./, (c) => c.toUpperCase())} have not been getting along, and the coaches know it.`,
  ])
}

function mentorBlurb(sheet: PressFactSheet): string | null {
  const m = sheet.lockerRoom.mentorships[0]
  if (!m) return null
  // The sheet carries "A mentoring B".
  const [mentor, kid] = m.split(' mentoring ')
  return mentor && kid ? `${mentor} has taken ${kid} under his wing.` : null
}

function rumorBlurb(sheet: PressFactSheet): string | null {
  const r = sheet.rumors[0]
  if (!r) return null
  return r.heat >= 75
    ? alt(sheet, 'rum', [
        `Around the league, ${r.playerName} (${r.teamAbbr}) is the name on most trade calls.`,
        `${r.teamAbbr} are taking real calls on ${r.playerName}.`,
        `If something big moves before the deadline, ${r.playerName} of ${r.teamAbbr} is the likeliest name.`,
      ])
    : alt(sheet, 'rum', [
        `${r.teamAbbr} are listening on ${r.playerName}.`,
        `Keep an eye on ${r.playerName} in ${r.teamAbbr}; clubs have asked.`,
        `${r.playerName} (${r.teamAbbr}) has come up in trade talk.`,
      ])
}

function upNextBlurb(sheet: PressFactSheet): string | null {
  if (sheet.upcomingOpponents.length === 0) return null
  const next = sheet.upcomingOpponents[0]
  if (sheet.upcomingOpponents.length === 1) return `Next up: ${next}.`
  return `Next up: ${sheet.upcomingOpponents.slice(0, 2).join(', ')}.`
}

/* ────────────────────────── WEEKLY templates ────────────────────────── */

type WeeklyTemplateFn = (sheet: PressFactSheet, seed: number) => FallbackArticle

/*
 * The weekly columns, rewritten in the 2026-10 writing pass. The audit found
 * three personas built from verbal tics ("I'll tell you what, folks", "Make of
 * that what you will", "Here's what we know… Here's what we don't know", "On
 * paper, fine. On the ice, honestly?") and a lede ("Standings are undefeated")
 * that meant nothing. The rules now:
 *  - the stretch is "the last N games" (the fact sheet carries the last five
 *    results, not a calendar week);
 *  - every column has one opinion, and it rests on a number from the sheet
 *    (goals for and against over the stretch, the record, the projection);
 *  - each persona keeps a register, not a catchphrase: the beat writer is
 *    measured, the national writer argues, the homer is a fan with a column.
 */

const NUM_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']
function nWord(n: number): string {
  return NUM_WORD[n] ?? String(n)
}

/** "the last five games" / "the last three games". */
function stretch(sheet: PressFactSheet): string {
  const n = sheet.lastResults.length
  return n === 1 ? 'the last game' : `the last ${nWord(n)} games`
}

/** Goals for and against over the stretch. */
function stretchGoals(sheet: PressFactSheet): { gf: number; ga: number; n: number } {
  let gf = 0
  let ga = 0
  for (const r of sheet.lastResults) {
    gf += r.goalsFor
    ga += r.goalsAgainst
  }
  return { gf, ga, n: sheet.lastResults.length }
}

/**
 * The one opinion a column holds, grounded in the stretch's goals. Returns ''
 * when there is no stretch to judge.
 */
function goalsVerdict(sheet: PressFactSheet, voice: 'beat' | 'national' | 'homer'): string {
  const { gf, ga, n } = stretchGoals(sheet)
  if (n < 2) return ''
  const gfPer = gf / n
  const gaPer = ga / n
  const t = sheet.team
  if (gaPer >= 3.6) {
    return alt(sheet, `v-ga-${voice}`, voice === 'homer'
      ? [`I'll be honest: ${ga} goals against in ${stretch(sheet)} is too many, and everybody in the building knows it.`,
         `We gave up ${ga} in ${stretch(sheet)}. Tighten that up and the rest takes care of itself.`]
      : voice === 'national'
        ? [`${ga} goals against in ${stretch(sheet)}. No team wins regularly giving up ${gaPer.toFixed(1)} a night, and ${t.name} won't either until that changes.`,
           `The number that matters is ${ga}: goals against over ${stretch(sheet)}. Fix that or nothing else on this list matters.`]
        : [`They allowed ${ga} goals over ${stretch(sheet)}, ${gaPer.toFixed(1)} a game.`,
           `${ga} goals against in ${stretch(sheet)} is the number the coaching staff will be talking about.`])
  }
  if (gfPer <= 2) {
    return alt(sheet, `v-gf-${voice}`, voice === 'homer'
      ? [`We need more goals. ${gf} in ${stretch(sheet)} won't cut it, and I think the guys know it.`,
         `${gf} goals in ${stretch(sheet)}. Somebody has to start putting the puck in.`]
      : voice === 'national'
        ? [`${gf} goals in ${stretch(sheet)}. A team that scores like that is asking its goalie to win every night, and that's not a plan.`,
           `${t.name} scored ${gf} times in ${stretch(sheet)}. Until the offence shows up, the record will look like this.`]
        : [`The offence has gone quiet: ${gf} goals in ${stretch(sheet)}.`,
           `${gf} goals over ${stretch(sheet)}, ${gfPer.toFixed(1)} a night.`])
  }
  if (gf - ga >= 5) {
    return alt(sheet, `v-plus-${voice}`, voice === 'homer'
      ? [`${gf} goals for and ${ga} against in ${stretch(sheet)}. That's not luck, folks. That's a good hockey team.`,
         `Outscored the opposition ${gf} to ${ga} over ${stretch(sheet)}. I'll take that every week.`]
      : voice === 'national'
        ? [`${gf} for, ${ga} against over ${stretch(sheet)}. The goal differential backs the record, which is more than most hot starts can say.`,
           `The case for ${t.name} is simple: they've outscored people ${gf} to ${ga} in ${stretch(sheet)}.`]
        : [`They outscored opponents ${gf} to ${ga} over ${stretch(sheet)}.`,
           `${gf} goals for, ${ga} against over ${stretch(sheet)}.`])
  }
  if (Math.abs(gf - ga) <= 1) {
    return alt(sheet, `v-even-${voice}`, voice === 'homer'
      ? [`${gf} for, ${ga} against in ${stretch(sheet)}. Close games, and we're in every one of them.`,
         `Tight hockey lately: ${gf} goals for, ${ga} against over ${stretch(sheet)}.`]
      : voice === 'national'
        ? [`${gf} for and ${ga} against in ${stretch(sheet)}. That's a team living in one-goal games, and those go both ways.`,
           `Over ${stretch(sheet)}, the ${t.name} scored ${gf} and allowed ${ga}. That's a .500 team's goal line, whatever the standings say.`]
        : [`${gf} goals for and ${ga} against over ${stretch(sheet)}.`,
           `Over ${stretch(sheet)} they scored ${gf} and allowed ${ga}.`])
  }
  if (gf > ga) {
    return alt(sheet, `v-up-${voice}`, voice === 'homer'
      ? [`We've outscored people ${gf} to ${ga} over ${stretch(sheet)}. That'll do.`,
         `${gf} for, ${ga} against in ${stretch(sheet)}. Winning hockey.`]
      : voice === 'national'
        ? [`They've outscored opponents ${gf} to ${ga} over ${stretch(sheet)}. Not dominant, but on the right side.`,
           `${gf} for, ${ga} against in ${stretch(sheet)}. The goal line agrees with the record, narrowly.`]
        : [`They outscored opponents ${gf} to ${ga} over ${stretch(sheet)}.`,
           `${gf} goals for and ${ga} against over ${stretch(sheet)}.`])
  }
  return alt(sheet, `v-down-${voice}`, voice === 'homer'
    ? [`We've been outscored ${ga} to ${gf} lately. That has to turn around, and I think it will.`,
       `${ga} against, ${gf} for over ${stretch(sheet)}. Not good enough, and the guys know it.`]
    : voice === 'national'
      ? [`Outscored ${ga} to ${gf} over ${stretch(sheet)}. That's a trend worth watching, and not in a good way.`,
         `${gf} for and ${ga} against in ${stretch(sheet)}. The ${t.name} are giving up more than they score.`]
      : [`They were outscored ${ga} to ${gf} over ${stretch(sheet)}.`,
         `Over ${stretch(sheet)} they scored ${gf} and allowed ${ga}.`])
}

const WEEKLY_BEAT: WeeklyTemplateFn[] = [
  // Template 0: the stretch in review
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)
    const n = sheet.lastResults.length
    const allWins = n > 0 && wins === n
    const allLoss = n > 0 && losses === n

    const headline = allWins
      ? alt(sheet, 'b0h-w', [`${t.abbr} win ${nWord(wins)} straight`, `${nWord(wins).replace(/^./, (c) => c.toUpperCase())} in a row for ${t.abbr}`])
      : allLoss
        ? alt(sheet, 'b0h-l', [`${t.abbr} drop ${nWord(losses)} straight`, `${t.name} winless in ${stretch(sheet)}`])
        : wins > losses
          ? `${t.abbr} go ${wins}–${losses} in ${stretch(sheet)}`
          : `${t.abbr} ${wins}–${losses} in ${stretch(sheet)}, still looking for a run`

    const lede = allWins
      ? `HARBOR CITY — The ${t.name} have won ${nWord(wins)} straight and sit ${recordStr(sheet)}.`
      : allLoss
        ? `HARBOR CITY — The ${t.name} have lost ${nWord(losses)} straight and sit ${recordStr(sheet)}.`
        : `HARBOR CITY — The ${t.name} went ${wins}–${losses} over ${stretch(sheet)} and sit ${recordStr(sheet)}.`

    const para2 = recentRunStr(sheet) ? `Results: ${recentRunStr(sheet)}.` : ''
    const verdict = goalsVerdict(sheet, 'beat')
    const expLine = expectationBlurb(sheet) ?? ''
    const arcLine = topArcBlurb(sheet) ?? ''
    const moraleLine = moraleBlurb(sheet)
    const upLine = upNextBlurb(sheet) ?? ''

    const paras = [lede, [para2, verdict].filter(Boolean).join(' '), [expLine, arcLine].filter(Boolean).join(' '), [moraleLine, upLine].filter(Boolean).join(' ')].filter(Boolean)
    return { headline, body: paras.join('\n\n'), byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}` }
  },

  // Template 1: the standings
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)
    const overExp = overPerforming(sheet)
    const underExp = underPerforming(sheet)

    const headline = overExp
      ? alt(sheet, 'b1o', [
          `${t.name} ${ordinal(t.rank)}, ahead of the forecast`,
          `${t.name} still ${ordinal(t.rank)}, still ahead of schedule`,
          `${wins}–${losses} in ${stretch(sheet)} keeps ${t.name} ahead of the forecast`,
        ])
      : underExp
        ? alt(sheet, 'b1u', [
            `${t.name} ${ordinal(t.rank)} and below the forecast after a ${wins}–${losses} stretch`,
            `${t.name} still searching after going ${wins}–${losses}`,
            `No turnaround yet: ${t.name} go ${wins}–${losses}`,
          ])
        : alt(sheet, 'b1m', [
            `${t.abbr} hold at ${ordinal(t.rank)} after going ${wins}–${losses}`,
            `${wins}–${losses} in ${stretch(sheet)} leaves ${t.name} ${ordinal(t.rank)}`,
            `${t.name} tread water at ${ordinal(t.rank)}`,
          ])

    const lede = alt(sheet, 'b1l', [
      `HARBOR CITY — The ${t.name} are ${recordStr(sheet)} after going ${wins}–${losses} in ${stretch(sheet)}.`,
      `HARBOR CITY — ${ordinal(t.rank).replace(/^./, (c) => c.toUpperCase())} of ${t.teamsInLeague}: that's where a ${wins}–${losses} stretch leaves the ${t.name}, at ${t.wins}–${t.losses}–${t.otLosses}.`,
    ])

    const expLine = expectationBlurb(sheet) ?? ''
    const verdict = goalsVerdict(sheet, 'beat')
    const arcLine = topArcBlurb(sheet) ?? ''
    const rumorLine = rumorBlurb(sheet) ?? ''
    const leaderLine = leaderBlurb(sheet) ?? ''
    const upLine = upNextBlurb(sheet) ?? ''

    const paras = [lede, [expLine, verdict].filter(Boolean).join(' '), [arcLine, rumorLine, leaderLine].filter(Boolean).join(' '), upLine].filter(Boolean)
    return { headline, body: paras.join('\n\n'), byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}` }
  },

  // Template 2: the dressing room
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)

    const headline = sheet.lockerRoom.roomMorale >= 70
      ? `${t.abbr} notebook: a loose room and a ${wins}–${losses} stretch`
      : sheet.lockerRoom.roomMorale <= 45
        ? `${t.abbr} notebook: a tense room after going ${wins}–${losses}`
        : alt(sheet, 'b2', [
            `${t.abbr} notebook: ${wins}–${losses} in ${stretch(sheet)}, and the mood around the group`,
            `${t.abbr} notebook: the record, the room, what's next`,
            `${t.abbr} notebook after a ${wins}–${losses} stretch`,
          ])

    const lede = `HARBOR CITY — The ${t.name} are ${recordStr(sheet)}, ${wins}–${losses} over ${stretch(sheet)}.`
    const moraleLine = moraleBlurb(sheet)
    const feudLine = feudBlurb(sheet) ?? ''
    const mentorLine = mentorBlurb(sheet) ?? ''
    const arcLine = topArcBlurb(sheet) ?? ''
    const verdict = goalsVerdict(sheet, 'beat')
    const upLine = upNextBlurb(sheet) ?? ''

    const expLine = expectationBlurb(sheet) ?? ''
    const paras = [lede, [moraleLine, feudLine].filter(Boolean).join(' '), [mentorLine, arcLine].filter(Boolean).join(' '), [verdict, expLine, upLine].filter(Boolean).join(' ')].filter(Boolean)
    return { headline, body: paras.join('\n\n'), byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}` }
  },
]

const WEEKLY_NATIONAL: WeeklyTemplateFn[] = [
  // Template 0: the big picture
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)

    const headline = overPerforming(sheet)
      ? alt(sheet, 'n1o', [
          `${t.name} are ${ordinal(t.rank)}. I didn't see it coming.`,
          `${t.name} keep making the projections look bad`,
          `Why I'm starting to believe in ${t.name}`,
          `${t.name} at ${ordinal(t.rank)}: here's what's real`,
        ])
      : underPerforming(sheet)
        ? alt(sheet, 'n1u', [
            `${t.name} haven't delivered. Here's why.`,
            `What is wrong with ${t.name}?`,
            `${t.name} were supposed to be better than ${ordinal(t.rank)}`,
          ])
        : alt(sheet, 'n1m', [
            `${t.name} are exactly what they look like`,
            `${t.name}: no surprises, for better and worse`,
            `${t.name} at ${ordinal(t.rank)}, right where I had them`,
          ])

    const lede = alt(sheet, 'n0l', [
      `The ${t.name} are ${recordStr(sheet)}, ${wins}–${losses} over ${stretch(sheet)}.`,
      `${wins}–${losses} in ${stretch(sheet)} and ${recordStr(sheet)} overall. That's the ${t.name}.`,
    ])
    const verdict = goalsVerdict(sheet, 'national')
    const expLine = expectationBlurb(sheet)
    const arcLine = topArcBlurb(sheet)
    const leaderLine = leaderBlurb(sheet)
    const rumorLine = rumorBlurb(sheet)
    const upLine = upNextBlurb(sheet)

    const paras = [lede, verdict, [expLine, arcLine].filter(Boolean).join(' '), [leaderLine, rumorLine].filter(Boolean).join(' '), upLine].filter(Boolean) as string[]
    return { headline, body: paras.join('\n\n'), byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}` }
  },

  // Template 1: the argument
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)
    const n = sheet.lastResults.length
    const allWins = n > 0 && wins === n

    const headline = allWins
      ? `Don't look now, but ${t.name} are making a case`
      : wins === 0 && n >= 2
        ? `${t.name} are in a slide, and the numbers say it's real`
        : `What ${wins}–${losses} tells us about the ${t.name}`

    const lede = `The ${t.name}: ${recordStr(sheet)}, and ${wins}–${losses} over ${stretch(sheet)}.`
    const verdict = goalsVerdict(sheet, 'national')
    const expLine = expectationBlurb(sheet)
    const arcLine = topArcBlurb(sheet)
    const leaderLine = leaderBlurb(sheet)
    const rumorLine = rumorBlurb(sheet)
    const { gf, ga } = stretchGoals(sheet)
    const closePara = underPerforming(sheet)
      ? `They were projected ${ordinal(t.expectedRank ?? t.rank)} and they're ${ordinal(t.rank)}. If the front office still sees a contender, the next move should show it.`
      : overPerforming(sheet)
        ? gf > ga
          ? `They're ahead of the forecast and outscoring people while they do it. I'd believe it.`
          : `They're ahead of the forecast while being outscored ${ga} to ${gf} lately. I'd wait before buying in.`
        : `The ${t.name} are a ${ordinal(t.rank)}-place team playing like one. Nothing in ${stretch(sheet)} says otherwise.`

    const paras = [lede, verdict, [expLine, arcLine].filter(Boolean).join(' '), [leaderLine, rumorLine].filter(Boolean).join(' '), closePara].filter(Boolean)
    return { headline, body: paras.join('\n\n'), byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}` }
  },

  // Template 2: the league context
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)

    const headline = overPerforming(sheet)
      ? `${t.abbr} ahead of projection at ${ordinal(t.rank)}`
      : underPerforming(sheet)
        ? `${t.abbr} below projection at ${ordinal(t.rank)}`
        : `${t.abbr} at ${ordinal(t.rank)}, as projected`

    const where = t.expectedRank !== undefined
      ? overPerforming(sheet) ? 'above where the preseason models had them' : underPerforming(sheet) ? 'below where the preseason models had them' : 'where the preseason models had them'
      : 'with no preseason projection to measure against'
    const lede = `The ${t.name} are ${recordStr(sheet)}, ${where}. They went ${wins}–${losses} over ${stretch(sheet)}.`
    const verdict = goalsVerdict(sheet, 'national')
    const leaderLine = leaderBlurb(sheet)
    const arcLine = topArcBlurb(sheet)
    const moraleLine = moraleBlurb(sheet)
    const rumorLine = rumorBlurb(sheet)
    const upLine = upNextBlurb(sheet)

    return {
      headline,
      body: [lede, verdict, [leaderLine, arcLine].filter(Boolean).join(' '), [moraleLine, rumorLine, upLine].filter(Boolean).join(' ')].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const WEEKLY_HOMER: WeeklyTemplateFn[] = [
  // Template 0: the fan's week
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)
    const n = sheet.lastResults.length
    const allWins = wins === n && n > 0

    const headline = allWins
      ? `${nWord(wins).replace(/^./, (c) => c.toUpperCase())} straight! Your ${t.name} are rolling`
      : wins >= losses
        ? alt(sheet, 'h0w', [
            `${wins}–${losses} and I'll take it`,
            `${wins}–${losses} in ${stretch(sheet)}: the ${t.name} keep climbing`,
            `The ${t.name} are ${recordStr(sheet)}, and I like where this is going`,
          ])
        : alt(sheet, 'h0l', [`${wins}–${losses}. Not good enough, and here's what has to change.`, `A ${wins}–${losses} stretch. I'm not panicking yet.`])

    const lede = allWins
      ? alt(sheet, 'h0l1', [
          `${nWord(wins).replace(/^./, (c) => c.toUpperCase())} wins in a row. The ${t.name} are ${recordStr(sheet)} and I haven't enjoyed watching this team this much in years.`,
          `Win, win, win. The ${t.name} are ${recordStr(sheet)}, and nobody in this league wants to play us right now.`,
        ])
      : wins >= losses
        ? `Could we have won more? Sure. But the ${t.name} went ${wins}–${losses} over ${stretch(sheet)}, and we're ${recordStr(sheet)}.`
        : `${wins}–${losses} over ${stretch(sheet)} isn't what we wanted. We're ${recordStr(sheet)}.`

    const verdict = goalsVerdict(sheet, 'homer')
    const expLine = expectationBlurb(sheet)
    const arcLine = topArcBlurb(sheet)
    const moraleLine = moraleBlurb(sheet)
    const upLine = upNextBlurb(sheet)

    const para2 = expLine
      ? overPerforming(sheet)
        ? `${expLine} The experts picked against us. I'm enjoying that.`
        : expLine
      : arcLine ?? ''
    return {
      headline,
      body: [lede, verdict, para2, [moraleLine, upLine].filter(Boolean).join(' ')].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },

  // Template 1: the call-in show
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)

    const headline = sheet.lockerRoom.roomMorale >= 65 && wins >= losses
      ? `The ${t.name} are having fun, and it shows`
      : wins >= losses
        ? `${t.abbr} win ${nWord(wins)} of ${nWord(sheet.lastResults.length)}, and the phones are ringing`
        : `The callers are worried. Here's what I told them.`

    const lede = wins >= losses
      ? `The phone lines were busy this week, and for once everybody was happy. We're ${recordStr(sheet)}.`
      : `I took a lot of calls this week, and most of them started with "what's wrong with this team." We're ${recordStr(sheet)}. Here's my answer.`

    const verdict = goalsVerdict(sheet, 'homer')
    const moraleLine = moraleBlurb(sheet)
    const feudLine = feudBlurb(sheet)
    const leaderLine = leaderBlurb(sheet)
    const upLine = upNextBlurb(sheet)

    return {
      headline,
      body: [lede, verdict, [moraleLine, feudLine].filter(Boolean).join(' '), leaderLine ?? '', upLine ?? ''].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },

  // Template 2: the silver lining
  (sheet) => {
    const { wins, losses } = recentRecord(sheet)
    const n = sheet.lastResults.length
    const allLoss = losses === n && n > 0
    const { gf, ga } = stretchGoals(sheet)

    const headline = allLoss
      ? alt(sheet, 'h2a', [`${nWord(losses).replace(/^./, (c) => c.toUpperCase())} straight losses. I'm still not jumping off.`, `A bad stretch. Here's why I'm not panicking.`])
      : wins >= losses
        ? alt(sheet, 'h2w', [`What I liked about a ${wins}–${losses} stretch`, `${wins}–${losses}, and it could have been better`])
        : alt(sheet, 'h2l', [`${wins}–${losses}. Hear me out.`, `Not the stretch we wanted. Here's the good news.`])

    const lede = allLoss
      ? `We've lost ${nWord(losses)} straight. I watched every one of them. We're ${recordStr(sheet)}, and I'm not ready to write this team off.`
      : `We're ${recordStr(sheet)} after going ${wins}–${losses} over ${stretch(sheet)}.`
    const silver = ga <= gf
      ? `The goal line is on our side: ${gf} for, ${ga} against.`
      : ga - gf <= 3
        ? `We've been outscored ${ga} to ${gf}, which is a few bounces, not a collapse.`
        : goalsVerdict(sheet, 'homer')

    const expLine = expectationBlurb(sheet)
    const arcLine = topArcBlurb(sheet)
    const upLine = upNextBlurb(sheet)
    return {
      headline,
      body: [lede, silver, [expLine, arcLine].filter(Boolean).join(' '), upLine ?? ''].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── DEADLINE templates ────────────────────────── */

type TentpoleTemplateFn = (sheet: PressFactSheet, seed: number) => FallbackArticle

const DEADLINE_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const trades = sheet.special.slice(0, 3)
    const headline = `Deadline day reshapes the league. What it means for ${t.name}`
    const lede = `HARBOR CITY — The phones went quiet at the deadline, but the league looks different tonight. ${trades.length > 0 ? `The moves that defined the day: ${trades.join('; ')}.` : 'The dust is settling after a frenetic final hours.'}`
    const standing = `The ${t.name} sit at ${recordStr(sheet)} heading into the post-deadline stretch.`
    const arcLine = topArcBlurb(sheet)
    const rumorLine = rumorBlurb(sheet)
    const para3 = [arcLine, rumorLine].filter(Boolean).join(' ')
    return {
      headline,
      body: [lede, standing, para3].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
  (sheet) => {
    const t = sheet.team
    const trades = sheet.special.slice(0, 3)
    const headline = `Trade deadline notebook: what moved, what didn't, and what's next for ${t.abbr}`
    const lede = `HARBOR CITY — Deadline day has a way of clarifying ambitions. Some clubs went all in. Others stood pat.`
    const movesLine = trades.length > 0 ? `On the league wire: ${trades.join('. ')}.` : 'No blockbusters hit the wire, but the rumor fatigue is real.'
    const contextLine = `The ${t.name} (${recordStr(sheet)}) now enter the home stretch with a roster set for the run-in.`
    const moraleBlurbLine = moraleBlurb(sheet)
    return {
      headline,
      body: [lede, movesLine, contextLine, moraleBlurbLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const DEADLINE_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const trades = sheet.special.slice(0, 4)
    const headline = `Trade deadline winners and losers: where do ${t.name} land?`
    const lede = `Deadline day separates the contenders from the pretenders, and this year's market was no different.`
    const movesLine = trades.length > 0 ? `The defining moves: ${trades.join('. ')}.` : 'Nobody made a big move. Call it restraint or call it inertia.'
    const contextLine = overPerforming(sheet)
      ? `The ${t.name} (${recordStr(sheet)}) have been the league's quiet story all season. Deadline day will have given opponents fresh reason to pay attention.`
      : underPerforming(sheet)
        ? `The ${t.name} (${recordStr(sheet)}) have not lived up to billing. The pressure to move is understandable; the question is whether the pieces are better than what they replaced.`
        : `The ${t.name} (${recordStr(sheet)}) are hovering at projection. Their deadline stance will be judged by how the next ten games unfold.`
    const arcLine = topArcBlurb(sheet)
    return {
      headline,
      body: [lede, movesLine, contextLine, arcLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const DEADLINE_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const trades = sheet.special.slice(0, 3)
    const headline = `Deadline day is done, and I like where we sit`
    const lede = `Whew. What a 48 hours. The deals are done, and we're ${recordStr(sheet)} heading into the stretch.`
    const movesLine = trades.length > 0 ? `Here's what moved around us: ${trades.join('. ')}.` : 'We didn\'t blow up the roster. Good. This group has earned the chance to finish what they started.'
    const closePara = `The room is energised. I can hear it. ${moraleBlurb(sheet)}`
    return {
      headline,
      body: [lede, movesLine, closePara].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── LOTTERY templates ────────────────────────── */

const LOTTERY_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const special = sheet.special.slice(0, 3)
    const headline = `Draft lottery sets the board, and ${t.abbr} wait`
    const lede = `HARBOR CITY — The ping-pong balls have spoken. Draft order is set, and with it, the futures market in this league has shifted overnight.`
    const lottoLine = special.length > 0 ? special.join(' ') : 'The final order will be confirmed in the coming days as picks are locked.'
    const contextLine = `For the ${t.name} (${recordStr(sheet)}), the lottery outcome recalibrates the offseason calculus.`
    return {
      headline,
      body: [lede, lottoLine, contextLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const LOTTERY_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const special = sheet.special.slice(0, 3)
    const t = sheet.team
    const headline = `Lottery night: who moved, who didn't`
    const lede = `Every year the lottery produces a winner and a dozen clubs that nod along and go back to work. This year is no different.`
    const lottoLine = special.length > 0 ? special.join(' ') : `The order held. No club jumped more than a spot or two.`
    const contextLine = overPerforming(sheet)
      ? `The ${t.name} (${recordStr(sheet)}) weren't in the lottery. That's where you want to be.`
      : underPerforming(sheet)
        ? `The ${t.name} (${recordStr(sheet)}) are watching with the rest of the league. Draft capital matters now more than ever.`
        : `The ${t.name} (${recordStr(sheet)}) have draft capital in play. Every pick counts.`
    return {
      headline,
      body: [lede, lottoLine, contextLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const LOTTERY_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const special = sheet.special.slice(0, 3)
    const t = sheet.team
    const headline = `Lottery night, and I see opportunity everywhere`
    const lede = `The balls drop, the order gets set, and the future of this league gets a little clearer. ${t.name} fans, here's what you need to know.`
    const lottoLine = special.length > 0 ? special.join(' ') : 'The results are in, and the draft room phone is going to be very busy.'
    const closePara = `We are ${recordStr(sheet)}, we have assets, and the front office has options. I like being in this seat right now.`
    return {
      headline,
      body: [lede, lottoLine, closePara].join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── COMBINE templates ────────────────────────── */

const COMBINE_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const special = sheet.special.slice(0, 4)
    const t = sheet.team
    const headline = `Combine notebook: risers, fallers, and the fine print`
    const lede = `HARBOR CITY — The combine is where scouting reports meet reality, and this year's class gave plenty of talking points.`
    const notesLine = special.length > 0 ? special.join(' ') : 'Reports from the floor indicate a draft class that is deep if unspectacular at the top.'
    const contextLine = `The ${t.name} (${recordStr(sheet)}) will be shopping for answers in the selection room. Combine data will inform which questions get asked.`
    const rumorLine = rumorBlurb(sheet)
    return {
      headline,
      body: [lede, notesLine, contextLine, rumorLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const COMBINE_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const special = sheet.special.slice(0, 4)
    const t = sheet.team
    const headline = `Combine week: separating signal from noise`
    const lede = `The combine is a place where scouts earn their pay. The numbers are useful; the conversations in the hallways are more so.`
    const notesLine = special.length > 0 ? special.join(' ') : 'A few names moved meaningfully on draft boards this week. Several others confirmed what the film already showed.'
    const contextLine = `For the ${t.name} (${recordStr(sheet)}), the combine numbers matter: there are holes on this roster and the class has options.`
    return {
      headline,
      body: [lede, notesLine, contextLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const COMBINE_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const special = sheet.special.slice(0, 4)
    const t = sheet.team
    const headline = `Combine notebook: your ${t.abbr} scouting desk is OPEN`
    const lede = `Folks, this is where futures get made. Combine week is my favourite week of the year. You get a first look at who's coming.`
    const notesLine = special.length > 0 ? special.join(' ') : 'The class looks competitive. There\'s talent here, and our front office has been in every room.'
    const closePara = `The ${t.name} are ${recordStr(sheet)} on the ice. The pipeline is what keeps you competitive for decades. We\'re building both. That's the dream, folks.`
    return {
      headline,
      body: [lede, notesLine, closePara].join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── DRAFT templates ────────────────────────── */

const DRAFT_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const special = sheet.special.slice(0, 4)
    const t = sheet.team
    const headline = `Draft day recap: ${t.abbr} adds to the pipeline`
    const lede = `HARBOR CITY — The next wave has arrived. Draft day is when organisations plant the seeds of futures years from now, and this year's haul gives the ${t.name} something to work with.`
    const picksLine = special.length > 0 ? special.join(' ') : 'Picks were tallied, names were called, and the development staff now has new files to open.'
    const contextLine = `The ${t.name} enter the offseason at ${recordStr(sheet)}, with a draft class that addressed stated needs.`
    const moraleBlurbLine = moraleBlurb(sheet)
    return {
      headline,
      body: [lede, picksLine, contextLine, moraleBlurbLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const DRAFT_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const special = sheet.special.slice(0, 4)
    const t = sheet.team
    const headline = `Draft debrief: grading ${t.name}'s class and what it reveals about their direction`
    const lede = `Every draft reveals a philosophy. The picks you make at the top of the board tell you where a franchise thinks it is. The picks you make in the late rounds tell you where they think they're going.`
    const picksLine = special.length > 0 ? special.join(' ') : 'The selections spanned the usual mix of upside and safety. Scouts earned their keep this year.'
    const contextLine = underPerforming(sheet)
      ? `The ${t.name} (${recordStr(sheet)}) needed a strong draft. The question of whether they got one will take three years to answer.`
      : overPerforming(sheet)
        ? `The ${t.name} (${recordStr(sheet)}) drafted from a position of relative strength. Adding depth to a winning culture is harder than it sounds.`
        : `The ${t.name} (${recordStr(sheet)}) went into the draft room with a plan. Whether it was the right plan, time will tell.`
    return {
      headline,
      body: [lede, picksLine, contextLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const DRAFT_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const special = sheet.special.slice(0, 4)
    const t = sheet.team
    const headline = `Draft day! Let's meet the new guys`
    const lede = `The ${t.name} just added future building blocks, and I am HERE for it. Draft day is pure possibility, and today we got to see ours.`
    const picksLine = special.length > 0 ? special.join(' ') : 'Names called, jerseys handed out, handshakes across the stage. I love this day.'
    const closePara = `The ${t.name} are ${recordStr(sheet)} right now. With this class in the pipeline? In two, three years? The ceiling goes way, way up!`
    return {
      headline,
      body: [lede, picksLine, closePara].join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── SEASON RECAP templates ────────────────────────── */

const SEASON_RECAP_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const special = sheet.special.slice(0, 4)
    const headline = overPerforming(sheet)
      ? `${t.name} season review: a year that exceeded every projection`
      : underPerforming(sheet)
        ? `${t.name} season review: honest answers required after a year that fell short`
        : `${t.name} season review: ${t.wins} wins, ${t.losses + t.otLosses} losses, and a clear road map ahead`

    const lede = `HARBOR CITY — The final horn has sounded on the ${sheet.year}–${sheet.year + 1} season. The ${t.name} finish ${recordStr(sheet)}.`
    const highlightLine = special.length > 0 ? `Key moments: ${special.join('. ')}.` : ''
    const expLine = expectationBlurb(sheet) ?? ''
    const arcLine = topArcBlurb(sheet) ?? ''
    const moraleBlurbLine = moraleBlurb(sheet)
    const closePara = `The offseason starts now. The answers to the questions this season raised will define what this franchise becomes.`

    return {
      headline,
      body: [lede, [highlightLine, expLine].filter(Boolean).join(' '), [arcLine, moraleBlurbLine].filter(Boolean).join(' '), closePara].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const SEASON_RECAP_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const special = sheet.special.slice(0, 4)
    const headline = overPerforming(sheet)
      ? `${t.name} beat every forecast. Next year the bar is higher.`
      : underPerforming(sheet)
        ? `${t.name} had the talent. They didn't have the year. That gap demands answers.`
        : `${t.name} season in review: on the line, as projected`

    const lede = `Season's end. The ${t.name} finish ${recordStr(sheet)} — ${overPerforming(sheet) ? 'a result that exceeded preseason consensus' : underPerforming(sheet) ? 'a result that fell short of preseason consensus' : 'a result that matched preseason consensus almost exactly'}.`
    const highlightLine = special.length > 0 ? special.join(' ') : ''
    const expLine = expectationBlurb(sheet) ?? ''
    const arcLine = topArcBlurb(sheet) ?? ''
    const closePara = underPerforming(sheet)
      ? `The front office faces a pivotal offseason. Hard questions require honest answers.`
      : overPerforming(sheet)
        ? `The front office has earned the benefit of the doubt. The foundation looks solid; the build continues.`
        : `The front office's mandate for next year is clear: take this foundation and add a level.`

    return {
      headline,
      body: [lede, [highlightLine, expLine].filter(Boolean).join(' '), arcLine, closePara].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const SEASON_RECAP_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const special = sheet.special.slice(0, 4)
    const headline = overPerforming(sheet)
      ? `What a season. Thank you, ${t.name}.`
      : underPerforming(sheet)
        ? `Not the year we wanted. Still my team.`
        : `Season done. And folks, I'm proud of this group.`

    const lede = overPerforming(sheet)
      ? `I said at the start of the year that this group had something. I was right. The ${t.name} finish ${recordStr(sheet)}, and if you told me that in October I would have bought every person in this studio a coffee.`
      : underPerforming(sheet)
        ? `${recordStr(sheet)}. Not what we wanted. I'm not going to sugarcoat it. Some of this season was hard to watch.`
        : `The ${t.name} close the books at ${recordStr(sheet)}, and you know what? I'll take it. Solid. Professional. A real team.`

    const highlightLine = special.length > 0 ? `Moments that will stay with me: ${special.join('. ')}.` : ''
    const moraleBlurbLine = moraleBlurb(sheet)
    const closePara = `The offseason is here. The ${t.name} aren't done building. Not even close. See you next year, folks.`

    return {
      headline,
      body: [lede, highlightLine, moraleBlurbLine, closePara].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── CHAMPION templates ────────────────────────── */

const CHAMPION_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const special = sheet.special.slice(0, 4)
    const headline = `${t.name} are champions`
    const lede = `HARBOR CITY — It's over. The ${t.name} are champions. After ${t.wins} wins and everything this season demanded of this group, the cup is here.`
    const detailLine = special.length > 0 ? special.join(' ') : 'The final buzzer sounded and the bench emptied in celebration.'
    const arcLine = topArcBlurb(sheet) ?? ''
    const moraleBlurbLine = moraleBlurb(sheet)
    const closePara = `This is what it's all about. The ${t.name} are champions.`
    return {
      headline,
      body: [lede, detailLine, [arcLine, moraleBlurbLine].filter(Boolean).join(' '), closePara].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const CHAMPION_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const special = sheet.special.slice(0, 4)
    const headline = `${t.name} win the Cup`
    const lede = `The ${t.name} are champions. They finished the regular season ${recordStr(sheet)} and won four rounds.`
    const detailLine = special.length > 0 ? special.join(' ') : 'The finish was everything a championship run should be.'
    const expLine = overPerforming(sheet)
      ? `They were not supposed to win this. That's what makes it worth writing about.`
      : `They won it the way the preseason favourite is supposed to.`
    const closePara = `When the confetti settles, what remains is a championship roster that did something genuinely hard. Respect it.`
    return {
      headline,
      body: [lede, detailLine, expLine, closePara].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const CHAMPION_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const special = sheet.special.slice(0, 4)
    const headline = `WE DID IT! ${t.name} ARE CHAMPIONS!`
    const lede = `I have been doing this for a long time. I have covered good teams and bad teams, playoff runs and early exits. Nothing compares to this. The ${t.name} are CHAMPIONS.`
    const detailLine = special.length > 0 ? special.join(' ') : 'I can barely type. I was screaming. My neighbours definitely heard me.'
    const closePara = `${recordStr(sheet)}. Champions. I'll say it a thousand times and it won't get old. This is the greatest team I have ever had the privilege to cover. Thank you for this.`
    return {
      headline,
      body: [lede, detailLine, closePara].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── PRESSER templates ────────────────────────── */

const PRESSER_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const special = sheet.special.slice(0, 2)
    const headline = `${t.abbr} GM faces the media: presser reaction`
    const lede = `HARBOR CITY — The ${t.name} GM stepped to the podium and answered questions. Here is what the room took away.`
    const detailLine = special.length > 0 ? special.join(' ') : 'The tone in the room was measured; the questions were pointed.'
    const contextLine = `The ${t.name} are ${recordStr(sheet)}. The press conference context reflects where this team stands.`
    const moraleBlurbLine = moraleBlurb(sheet)
    return {
      headline,
      body: [lede, detailLine, contextLine, moraleBlurbLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const PRESSER_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const t = sheet.team
    const special = sheet.special.slice(0, 2)
    const headline = `Presser debrief: what the ${t.name} GM said, and what he didn't`
    const lede = `Press conferences are a negotiation between what a GM wants to say and what the media needs to hear. Today's session at ${t.name} HQ tilted toward the former.`
    const detailLine = special.length > 0 ? special.join(' ') : 'The questions were sharper than the answers.'
    const contextLine = `The subtext: the ${t.name} are ${recordStr(sheet)}, and every answer carries the weight of that standing.`
    return {
      headline,
      body: [lede, detailLine, contextLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const PRESSER_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const special = sheet.special.slice(0, 2)
    const headline = `GM presser: I liked what I heard`
    const lede = `Our GM stepped up. Took questions. And I've gotta say, I came away more confident in this club, not less.`
    const detailLine = special.length > 0 ? special.join(' ') : 'Leadership is about showing up when things are uncomfortable. Today, leadership showed up.'
    const contextLine = `We're ${recordStr(sheet)}. The plan is intact. ${moraleBlurb(sheet)}`
    return {
      headline,
      body: [lede, detailLine, contextLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── helpers for scheduled reports ────────────────────────── */

function asScheduled(sheet: PressFactSheet): ScheduledReportFactSheet {
  const s = sheet as ScheduledReportFactSheet
  return {
    ...s,
    powerRankings: s.powerRankings ?? [],
    preseasonFavorites: s.preseasonFavorites ?? [],
    monthlyHighlights: s.monthlyHighlights ?? [],
    playoffMatchups: s.playoffMatchups ?? [],
    awardFrontrunners: s.awardFrontrunners ?? [],
    seasonChampion: s.seasonChampion ?? '',
    topProspects: s.topProspects ?? [],
    monthLabel: s.monthLabel ?? '',
    playoffRound: s.playoffRound ?? '',
  }
}

function rankingsSection(s: ScheduledReportFactSheet, max = 5): string {
  const top = s.powerRankings.slice(0, max)
  if (top.length === 0) return ''
  // Preseason: printing "0-0-0 (0 pts)" beside every club reads like a bug,
  // not a ranking. A projection is a projection — it shows the order.
  const preseason = top.every((r) => r.wins + r.losses + r.otLosses === 0)
  const lines = top.map((r) => {
    if (preseason) return `${r.rank}. ${r.teamName}`
    const delta = r.delta !== undefined && r.delta !== 0
      ? r.delta > 0 ? ` (↑${r.delta})` : ` (↓${Math.abs(r.delta)})`
      : ''
    return `${r.rank}. ${r.teamName} — ${r.wins}–${r.losses}–${r.otLosses} (${r.points} pts)${delta}`
  })
  return lines.join('\n')
}

function userRankingBlurb(s: ScheduledReportFactSheet): string {
  const entry = s.powerRankings.find((r) => r.teamAbbr === s.team.abbr)
  if (!entry) return `The ${s.team.name} are ranked ${ordinal(s.team.rank)} in the standings.`
  const deltaStr = entry.delta !== undefined && entry.delta !== 0
    ? entry.delta > 0
      ? `, up ${entry.delta} ${entry.delta === 1 ? 'spot' : 'spots'}`
      : `, down ${Math.abs(entry.delta)} ${Math.abs(entry.delta) === 1 ? 'spot' : 'spots'}`
    : ''
  return `The ${s.team.name} check in at ${ordinal(entry.rank)} in the power rankings${deltaStr}.`
}

/* ────────────────────────── POWER RANKINGS templates ────────────────────────── */

/**
 * Headline + lede for an in-season rankings piece: keyed to how far into the
 * season we are (early / middle / stretch) and to the club on top, so fifteen
 * editions a season do not share one headline.
 * Slots: {top} {riser} {faller} {user} {rank}
 */
const RANKINGS_FRAME_POOL: ContentVariant[] = [
  /* beat — measured */
  { id: 'pr.b.early.a', conditions: { voice: 'beat', phase: 'early' }, text: `Power rankings: {top} set the early pace`, text2: `HARBOR CITY — Enough games are in the books to start sorting the contenders from the hot starts. Here is the updated order.` },
  { id: 'pr.b.early.b', conditions: { voice: 'beat', phase: 'early' }, text: `Power rankings refresh: the league's pecking order after the early going`, text2: `HARBOR CITY — It is early, and some of this will not last. Here is where things stand.` },
  { id: 'pr.b.early.c', conditions: { voice: 'beat', phase: 'early' }, text: `Early power rankings: {top} out in front`, text2: `HARBOR CITY — A few weeks in, the table is starting to mean something. Here is the order.` },
  { id: 'pr.b.mid.a', conditions: { voice: 'beat', phase: 'mid' }, text: `Power rankings: {top} still the team to catch`, text2: `HARBOR CITY — We are deep enough into the season that the standings have stopped lying. Here is the updated order.` },
  { id: 'pr.b.mid.b', conditions: { voice: 'beat', phase: 'mid' }, text: `Power rankings: {top} on top as the season turns`, text2: `HARBOR CITY — The middle of the season is where good teams separate. Some have. Here is the order.` },
  { id: 'pr.b.mid.c', conditions: { voice: 'beat', phase: 'mid' }, text: `Midseason power rankings: {top} lead the way`, text2: `HARBOR CITY — Half a season is a real sample. Here is what it says.` },
  { id: 'pr.b.late.a', conditions: { voice: 'beat', phase: 'late' }, text: `Power rankings: {top} lead into the stretch drive`, text2: `HARBOR CITY — The stretch run is here, and the order now matters. Here it is.` },
  { id: 'pr.b.late.b', conditions: { voice: 'beat', phase: 'late' }, text: `Power rankings: the order heading for the playoffs`, text2: `HARBOR CITY — A handful of weeks left. Here is who looks ready for April.` },
  { id: 'pr.b.late.c', conditions: { voice: 'beat', phase: 'late' }, text: `Late-season power rankings: {top} out front`, text2: `HARBOR CITY — Nobody is a hot start any more. This is who these teams are.` },
  { id: 'pr.b.riser.a', conditions: { voice: 'beat', riser: true }, text: `Power rankings: {riser} climb as {top} hold No. 1`, text2: `HARBOR CITY — The top spot did not change hands this week; plenty below it did. Here is the order.` },
  { id: 'pr.b.riser.b', conditions: { voice: 'beat', riser: true }, text: `Power rankings: {riser} on the move`, text2: `HARBOR CITY — One club made a real jump this week. Here is the full order.` },
  { id: 'pr.b.riser.c', conditions: { voice: 'beat', riser: true }, text: `Power rankings: {top} stay first, {faller} slide`, text2: `HARBOR CITY — A lot of movement in the middle this week. Here is where everyone landed.` },
  /* national — opinionated */
  { id: 'pr.n.a', conditions: { voice: 'national' }, text: `Power rankings: the definitive list, explained`, text2: `Every team, in order. Argue with it if you like.` },
  { id: 'pr.n.b', conditions: { voice: 'national' }, text: `My power rankings: {top} first, and it isn't close`, text2: `Somebody has to say it plainly. Here is my order.` },
  { id: 'pr.n.c', conditions: { voice: 'national' }, text: `Power rankings: why I still believe in {top}`, text2: `The standings tell part of it. Here is the rest.` },
  { id: 'pr.n.d', conditions: { voice: 'national' }, text: `Ranking the league: {top} at No. 1, and the rest of my list`, text2: `One through the end of the list, and the reasons for the top of it.` },
  { id: 'pr.n.pre.a', conditions: { voice: 'national', phase: 'pre' }, text: `Preseason power rankings: {top} start on top`, text2: `Nothing has been played, so this is a judgement of rosters, not results. Here is mine.` },
  { id: 'pr.n.pre.b', conditions: { voice: 'national', phase: 'pre' }, text: `My preseason order: {top} first, and here is why`, text2: `Summer is over. Here is how I have the league before a puck drops.` },
  { id: 'pr.n.pre.c', conditions: { voice: 'national', phase: 'pre' }, text: `Before the puck drops: ranking the league`, text2: `Projections, not records. Hold me to them in April.` },
  { id: 'pr.n.late.a', conditions: { voice: 'national', phase: 'late' }, text: `Final stretch power rankings: who is built for April`, text2: `Regular-season points are nice. Here is who I trust when they stop being handed out.` },
  { id: 'pr.n.late.b', conditions: { voice: 'national', phase: 'late' }, text: `Power rankings: {top} the favourite as the playoffs close in`, text2: `The race is nearly run. My order, with the playoffs in mind.` },
  { id: 'pr.n.late.c', conditions: { voice: 'national', phase: 'late' }, text: `Power rankings with the playoff picture forming`, text2: `This is the edition that ages worst, so I will be brave about it.` },
]

/** The homer on the rankings. text = headline; text2 = "lede|closer". {team} {rank} */
const HOMER_RANKINGS_POOL: ContentVariant[] = [
  { id: 'prh.top.a', conditions: { band: 'top' }, text: `Power rankings are out, and the {team} are right there!`, text2: `{rank} in the power rankings. Say it slowly. Let it sink in.|I'll take it. Every week.` },
  { id: 'prh.top.b', conditions: { band: 'top' }, text: `Top five and climbing: the {team} are the real deal`, text2: `The experts have finally caught up. The {team} are {rank}.|Told you so. I'll keep telling you so.` },
  { id: 'prh.top.c', conditions: { band: 'top' }, text: `Look who's near the top: YOUR {team}`, text2: `{rank}! I've been saying it since training camp and nobody listened.|Get used to this view.` },
  { id: 'prh.top.late.a', conditions: { band: 'top', late: true }, text: `The {team} are {rank} with the playoffs in sight`, text2: `This is when it counts, and the {team} are right where they need to be.|Book the parade route. (Kidding. Mostly.)` },
  { id: 'prh.top.late.b', conditions: { band: 'top', late: true }, text: `{rank} and ready: the {team} head for the stretch`, text2: `The rankings have the {team} {rank}. I've never felt better about a spring.|Let's go.` },
  { id: 'prh.top.late.c', conditions: { band: 'top', late: true }, text: `Contenders. Say it. The {team} are contenders`, text2: `{rank} in the rankings this late in the season is not a fluke, folks.|April is going to be fun.` },
  { id: 'prh.mid.a', conditions: { band: 'mid' }, text: `Power rankings: here's where YOUR {team} stand`, text2: `The rankings are out. The {team} come in at {rank}. Is it where we want to be? Not yet.|There's a lot of hockey left.` },
  { id: 'prh.mid.b', conditions: { band: 'mid' }, text: `The {team} at {rank}? Underrated, and I'll die on that hill`, text2: `{rank}. The rankers don't watch every game. I do.|Mark my words.` },
  { id: 'prh.mid.c', conditions: { band: 'mid' }, text: `{rank} in the rankings, and the {team} are knocking on the door`, text2: `Middle of the pack, sure. But you've seen the way this team competes.|One good week changes everything.` },
  { id: 'prh.mid.late.a', conditions: { band: 'mid', late: true }, text: `The {team} at {rank}: it's playoff-race time`, text2: `{rank} in the rankings with the stretch run on. Every game is a big game now.|Let's go.` },
  { id: 'prh.mid.late.b', conditions: { band: 'mid', late: true }, text: `Bubble watch: the {team} sit {rank}`, text2: `Not where I want them this late, but it's not over.|Every point matters from here.` },
  { id: 'prh.mid.late.c', conditions: { band: 'mid', late: true }, text: `{rank} and fighting: the {team} in the race`, text2: `The rankings have them {rank}. The standings will have the final say.|Let's finish strong.` },
  { id: 'prh.low.a', conditions: { band: 'low' }, text: `The {team} are {rank} in the rankings. I'm not panicking. (I'm panicking a little.)`, text2: `{rank}. I'm not going to pretend that's good.|Better days are coming. They have to be.` },
  { id: 'prh.low.b', conditions: { band: 'low' }, text: `Power rankings: the {team} at {rank}, and that hurts`, text2: `I've watched every game. {rank} is fair, and I hate that it's fair.|Chin up. Somebody has to say it.` },
  { id: 'prh.low.c', conditions: { band: 'low' }, text: `{rank}? Ugh. Here's where YOUR {team} stand`, text2: `The rankings are out and the {team} are {rank}. Not a fun read.|We've been here before. We got out of it before.` },
]

function inSeasonRankingsFrame(s: ScheduledReportFactSheet, voice: 'beat' | 'national'): { headline: string; lede: string } {
  const gp = gamesPlayed(s)
  const phase = gp === 0 ? 'pre' : gp < 20 ? 'early' : gp < 55 ? 'mid' : 'late'
  const top = s.powerRankings[0]?.teamName ?? 'the leaders'
  const riser = [...s.powerRankings].filter((r) => (r.delta ?? 0) >= 3).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0]
  const faller = [...s.powerRankings].filter((r) => (r.delta ?? 0) <= -2).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0]
  const v = pickStable(RANKINGS_FRAME_POOL, { voice, phase, riser: !!(riser && faller) }, `pr|${s.team.abbr}|${s.year}|${s.day}|${voice}`)
  const slots = { top, riser: riser?.teamName ?? '', faller: faller?.teamName ?? '' }
  return {
    headline: v ? fillSlots(v.text, slots) : `Power rankings: ${top} on top`,
    lede: v?.text2 ? fillSlots(v.text2, slots) : '',
  }
}

function fillSlots(t: string, slots: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_m, k: string) => slots[k] ?? '')
}

const POWER_RANKINGS_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const headline = `Preseason power rankings: who's built to contend`
    const lede = `HARBOR CITY — A new season, a blank slate. Before a single puck is dropped, here is where every club in the league stands — and why.`
    const tableStr = rankingsSection(s, 8)
    const userBlurb = userRankingBlurb(s)
    const expLine = expectationBlurb(sheet) ?? ''
    return {
      headline,
      body: [lede, tableStr, [userBlurb, expLine].filter(Boolean).join(' ')].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
  (sheet) => {
    const s = asScheduled(sheet)
    // The phase of the season, and the club on top, are the story. The old
    // headline said "after the early going" in February.
    const { headline, lede } = inSeasonRankingsFrame(s, 'beat')
    const tableStr = rankingsSection(s, 8)
    const userBlurb = userRankingBlurb(s)
    const risers = s.powerRankings.filter((r) => (r.delta ?? 0) >= 2).slice(0, 2)
    const fallers = s.powerRankings.filter((r) => (r.delta ?? 0) <= -2).slice(0, 2)
    const movePara = [
      risers.length > 0 ? `Risers: ${risers.map((r) => r.teamName).join(', ')}.` : '',
      fallers.length > 0 ? `Fallers: ${fallers.map((r) => r.teamName).join(', ')}.` : '',
    ].filter(Boolean).join(' ')
    return {
      headline,
      body: [lede, tableStr, movePara, userBlurb].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const POWER_RANKINGS_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const { headline, lede } = inSeasonRankingsFrame(s, 'national')
    const tableStr = rankingsSection(s, 8)
    const risers = s.powerRankings.filter((r) => (r.delta ?? 0) >= 2).slice(0, 2)
    const fallers = s.powerRankings.filter((r) => (r.delta ?? 0) <= -2).slice(0, 2)
    const movePara = [
      risers.length > 0 ? `Biggest movers up: ${risers.map((r) => r.teamName).join(', ')}.` : '',
      fallers.length > 0 ? `Biggest movers down: ${fallers.map((r) => r.teamName).join(', ')}.` : '',
    ].filter(Boolean).join(' ')
    const userBlurb = userRankingBlurb(s)
    const expLine = expectationBlurb(sheet) ?? ''
    return {
      headline,
      body: [lede, tableStr, movePara, [userBlurb, expLine].filter(Boolean).join(' ')].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const POWER_RANKINGS_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const entry = s.powerRankings.find((r) => r.teamAbbr === t.abbr)
    const rankStr = entry ? ordinal(entry.rank) : ordinal(t.rank)
    // The homer's mood follows the number. He used to say "the process is
    // working" from 29th and "we're just getting started" in March.
    const rank = entry?.rank ?? t.rank
    const band = rank <= 5 ? 'top' : rank <= Math.max(8, Math.ceil(s.powerRankings.length / 2)) ? 'mid' : 'low'
    const gp = gamesPlayed(sheet)
    const v = pickStable(
      HOMER_RANKINGS_POOL,
      { band, late: gp >= 55 },
      `prh|${t.abbr}|${sheet.year}|${sheet.day}`
    )
    const slots = { team: t.name, rank: rankStr }
    const headline = v ? fillSlots(v.text, slots) : `Power rankings: here's where YOUR ${t.name} stand`
    const [lede, closer] = (v?.text2 ?? '|').split('|').map((x) => fillSlots(x, slots))
    const tableStr = rankingsSection(s, 6)
    const userBlurb = userRankingBlurb(s)
    return {
      headline,
      body: [lede, tableStr, `${userBlurb} ${closer ?? ''}`.trim()].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── SEASON PREVIEW templates ────────────────────────── */

const SEASON_PREVIEW_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const headline = `${t.name} season preview: what to expect from the ${sheet.year}–${sheet.year + 1} campaign`
    const lede = `HARBOR CITY — The ${t.name} open the ${sheet.year}–${sheet.year + 1} season. Here is where they stand.`
    const favoritesLine = s.preseasonFavorites.length > 0
      ? `League favorites to watch: ${s.preseasonFavorites.join(', ')}.`
      : ''
    const expLine = expectationBlurb(sheet) ?? ''
    const moraleBlurbLine = moraleBlurb(sheet)
    return {
      headline,
      body: [lede, favoritesLine, [expLine, moraleBlurbLine].filter(Boolean).join(' ')].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const SEASON_PREVIEW_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const headline = `${sheet.year}–${sheet.year + 1} season preview: contenders, dark horses, and the teams you'll be watching`
    const lede = `The puck drops on a new season, and the questions are real: who built correctly in the summer, who is operating on borrowed time, and which team will surprise us all?`
    const favoritesLine = s.preseasonFavorites.length > 0
      ? `The preseason consensus favorites: ${s.preseasonFavorites.join('; ')}.`
      : ''
    const expLine = t.expectedRank !== undefined
      ? `For the ${t.name}, the preseason projection is ${ordinal(t.expectedRank)}. That's the bar.`
      : `For the ${t.name}, this season comes without a clear ceiling. The market will figure it out.`
    const arcLine = topArcBlurb(sheet) ?? ''
    return {
      headline,
      body: [lede, favoritesLine, [expLine, arcLine].filter(Boolean).join(' ')].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const SEASON_PREVIEW_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const expFav = t.expectedRank !== undefined && t.expectedRank <= 4
    const headline = expFav
      ? `This is our year! ${t.name} season preview`
      : `Season's here, and I believe in this ${t.name} group`
    const lede = expFav
      ? `I don't want to hear any talk about managing expectations. The ${t.name} are preseason ${ordinal(t.expectedRank ?? 4)} and I am BUYING. IN.`
      : `They said we'd be average. They always say that. And every year, this group finds a way to prove somebody wrong. I believe in this team. I believe in this building.`
    const favoritesLine = s.preseasonFavorites.length > 0
      ? `Sure, some people are talking about ${s.preseasonFavorites.slice(0, 2).join(' and ')}. That's fine. Let them talk.`
      : ''
    const moraleBlurbLine = moraleBlurb(sheet)
    return {
      headline,
      body: [lede, favoritesLine, moraleBlurbLine, `Hockey starts NOW. Let's go, ${t.name}!`].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/** Highlights arrive as labels ("Vilardi — 4 away from 100 career goals");
 *  as prose each becomes its own sentence, with no em-dash. */
function highlightSentences(list: string[]): string {
  return list.map((h) => {
    const t = h.trim().replace(/[.!]+$/, '').replace(/ — /, ': ')
    return `${t}.`
  }).join(' ')
}

/* ────────────────────────── MONTHLY REPORT templates ────────────────────────── */

const MONTHLY_REPORT_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const monthStr = s.monthLabel || `the latest month`
    const headline = `${monthStr} report card: ${t.abbr} graded`
    const lede = `HARBOR CITY — ${monthStr} is in the books. The ${t.name} are ${recordStr(sheet)}.`
    const expLine = expectationBlurb(sheet) ?? ''
    const highlightsStr = s.monthlyHighlights.length > 0
      ? `Month in brief: ${highlightSentences(s.monthlyHighlights)}`
      : ''
    const leaderLine = leaderBlurb(sheet) ?? ''
    const moraleBlurbLine = moraleBlurb(sheet)
    return {
      headline,
      body: [lede, highlightsStr, [expLine, leaderLine].filter(Boolean).join(' '), moraleBlurbLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)
    const headline = `Quarter-pole report card: the league after the first stretch`
    const lede = `HARBOR CITY — We are well into the season now. Patterns are forming. The ${t.name} have settled at ${recordStr(sheet)} through the early going, going ${wins}–${losses} in their most recent stretch.`
    const expLine = expectationBlurb(sheet) ?? ''
    const arcLine = topArcBlurb(sheet) ?? ''
    const highlightsStr = s.monthlyHighlights.length > 0 ? highlightSentences(s.monthlyHighlights) : ''
    return {
      headline,
      body: [lede, highlightsStr, [expLine, arcLine].filter(Boolean).join(' ')].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const MONTHLY_REPORT_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const monthStr = s.monthLabel || 'the latest stretch'
    const headline = `${monthStr} power report: who has separated, and who has fallen off`
    const lede = `${monthStr} is done. Here's how the league looks.`
    const highlightsStr = s.monthlyHighlights.length > 0
      ? highlightSentences(s.monthlyHighlights)
      : ''
    const expLine = expectationBlurb(sheet) ?? ''
    const leaderLine = leaderBlurb(sheet) ?? ''
    const contextLine = `The ${t.name} sit at ${recordStr(sheet)} through ${monthStr}.${expLine ? ` ${expLine}` : ''}`
    return {
      headline,
      body: [lede, highlightsStr, contextLine, leaderLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const MONTHLY_REPORT_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const monthStr = s.monthLabel || 'This month'
    const { wins, losses } = recentRecord(sheet)
    const good = wins >= losses
    const headline = good
      ? `${monthStr} was exactly what we needed`
      : `${monthStr} was tough. I'm still not worried.`
    const lede = good
      ? `${monthStr} is done, and I couldn't be happier with where this team is. We're ${recordStr(sheet)}.`
      : `${monthStr} didn't go the way we wanted. We're ${recordStr(sheet)}, and this group doesn't quit.`
    const highlightsStr = s.monthlyHighlights.length > 0 ? highlightSentences(s.monthlyHighlights) : ''
    const moraleBlurbLine = moraleBlurb(sheet)
    return {
      headline,
      body: [lede, highlightsStr, moraleBlurbLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── PLAYOFF PREVIEW templates ────────────────────────── */

const PLAYOFF_PREVIEW_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const roundStr = s.playoffRound || 'the playoffs'
    const headline = s.playoffMatchups.length > 0
      ? `${roundStr} preview: seeds are set, matchups drawn`
      : `Playoff preview: everything is on the line`
    const lede = `HARBOR CITY — ${roundStr} begins. The ${t.name} enter at ${recordStr(sheet)}.`
    const matchupLines = s.playoffMatchups.slice(0, 4).map(
      // highSeed/lowSeed are team NAMES. They were run through ordinal(), which
      // printed "Florida Panthersth Florida Panthers vs. …" in every preview.
      (m) => `${m.highSeed} vs. ${m.lowSeed}`
    )
    const matchupStr = matchupLines.length > 0 ? `Key matchups: ${matchupLines.join('; ')}.` : ''
    const arcLine = topArcBlurb(sheet) ?? ''
    const moraleBlurbLine = moraleBlurb(sheet)
    return {
      headline,
      body: [lede, matchupStr, [arcLine, moraleBlurbLine].filter(Boolean).join(' ')].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const PLAYOFF_PREVIEW_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const roundStr = s.playoffRound || 'the playoffs'
    const headline = `${roundStr} preview: who wants it more?`
    const lede = `The regular season is a résumé. The playoffs are a referendum. ${roundStr} starts now.`
    const matchupLines = s.playoffMatchups.slice(0, 4).map(
      (m) => `${m.highSeed} vs. ${m.lowSeed}: watch this one.`
    )
    const matchupStr = matchupLines.length > 0 ? matchupLines.join(' ') : ''
    const expLine = overPerforming(sheet)
      ? `The ${t.name} (${recordStr(sheet)}) are here ahead of schedule. The question now is whether they can match it under playoff pressure.`
      : underPerforming(sheet)
        ? `The ${t.name} (${recordStr(sheet)}) have ground to make up. Playoff hockey has a way of resetting the narrative.`
        : `The ${t.name} (${recordStr(sheet)}) arrive right on projection. Clean slates and open questions.`
    return {
      headline,
      body: [lede, matchupStr, expLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const PLAYOFF_PREVIEW_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const roundStr = s.playoffRound || 'Playoff hockey'
    const headline = `${roundStr}. This is what we play for!`
    const lede = `${roundStr} is HERE. This is the moment the ${t.name} have been building toward all season. I am all in, and you should be too.`
    const moraleBlurbLine = moraleBlurb(sheet)
    const upLine = upNextBlurb(sheet) ?? ''
    return {
      headline,
      body: [lede, moraleBlurbLine, upLine ? `${upLine} Time to make it count.` : ''].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── AWARDS NIGHT templates ────────────────────────── */

const AWARDS_NIGHT_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const headline = `Awards season: the front-runners and what they're chasing`
    const lede = `HARBOR CITY — With the season in the books and trophies on the table, here is the state of play for every major award.`
    const awardsLines = s.awardFrontrunners.map(
      (a) => `${a.awardName}: ${a.leaderName} (${a.leaderTeamAbbr}) — ${a.statLine}`
    )
    const awardsStr = awardsLines.length > 0 ? awardsLines.join('\n') : leaderBlurb(sheet) ?? 'Statistics are being compiled.'
    const contextLine = `The ${t.name} finish the year at ${recordStr(sheet)}.`
    return {
      headline,
      body: [lede, awardsStr, contextLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const AWARDS_NIGHT_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const headline = `Awards night preview: who wins, who gets robbed, and what it says about this league`
    const lede = `Trophy season is the last gasp of the hockey calendar before the summer. And this year, the arguments are worth having.`
    const awardsLines = s.awardFrontrunners.slice(0, 3).map(
      (a) => `${a.awardName}: ${a.leaderName} (${a.leaderTeamAbbr}) leads with ${a.statLine}.`
    )
    const awardsStr = awardsLines.length > 0 ? awardsLines.join(' ') : ''
    const expLine = overPerforming(sheet)
      ? `The ${t.name} (${recordStr(sheet)}) over-delivered. That earns the front office goodwill and a long summer of credit.`
      : underPerforming(sheet)
        ? `The ${t.name} (${recordStr(sheet)}) underperformed their billing. The awards ceremony is not a comfortable place to be if you didn't hit your numbers.`
        : `The ${t.name} (${recordStr(sheet)}) met their marks. No drama. On to the next.`
    return {
      headline,
      body: [lede, awardsStr, expLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const AWARDS_NIGHT_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const anyUserAward = s.awardFrontrunners.some((a) => a.leaderTeamAbbr === t.abbr)
    const headline = anyUserAward
      ? `Awards night, and we've got a nominee!`
      : `Awards night: the best of the ${sheet.year}–${sheet.year + 1} season`
    const lede = anyUserAward
      ? `This is a proud night for the ${t.name}. We've got a player on the shortlist, and I want everyone in this building to take a moment and appreciate what that means.`
      : `Awards night. Where the league takes a breath, hands out some hardware, and we remember that hockey, when it's played well, is beautiful. The ${t.name} finish at ${recordStr(sheet)}.`
    const awardsLines = s.awardFrontrunners.slice(0, 3).map(
      (a) => `${a.awardName}: ${a.leaderName} (${a.leaderTeamAbbr}) — ${a.statLine}.`
    )
    const awardsStr = awardsLines.length > 0 ? awardsLines.join(' ') : ''
    return {
      headline,
      body: [lede, awardsStr].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── DRAFT PREVIEW templates ────────────────────────── */

const DRAFT_PREVIEW_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const headline = `Draft preview: scouting the class that could reshape the next decade`
    const lede = `HARBOR CITY — Draft season is a time for optimism. No one has played a game yet. No one has disappointed. Here is the class that will be called this summer — and what to expect.`
    const prospectsStr = s.topProspects.length > 0
      ? `Top prospects: ${s.topProspects.slice(0, 5).join(', ')}.`
      : 'Final rankings will be confirmed at the combine.'
    const contextLine = `The ${t.name} enter the draft at ${recordStr(sheet)}.`
    return {
      headline,
      body: [lede, prospectsStr, contextLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const DRAFT_PREVIEW_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const headline = `The complete draft preview: separating futures from filler`
    const lede = `Draft week separates the organisations that see the game three years ahead from the ones that are still figuring out what they need today.`
    const prospectsStr = s.topProspects.length > 0
      ? `Names to know: ${s.topProspects.slice(0, 6).join(', ')}. The rest of the class fills in around them.`
      : 'This year\'s class has no clear first overall pick, so expect movement down the board.'
    const expLine = underPerforming(sheet)
      ? `The ${t.name} (${recordStr(sheet)}) pick relatively high. In a deep class, that matters.`
      : overPerforming(sheet)
        ? `The ${t.name} (${recordStr(sheet)}) pick late, the price of a good season.`
        : `The ${t.name} (${recordStr(sheet)}) are picking in the middle of the board. No free lunches, but no impossible situations either.`
    return {
      headline,
      body: [lede, prospectsStr, expLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const DRAFT_PREVIEW_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const headline = `Draft preview: who might we bring home?`
    const lede = `Draft week, folks! I genuinely love this time of year. Every prospect is still perfect. Every pick still has the ceiling of a franchise player. Here is who the ${t.name} should be thinking about.`
    const prospectsStr = s.topProspects.length > 0
      ? `The names making noise in the scouting community: ${s.topProspects.slice(0, 5).join(', ')}. Mark them down.`
      : 'The board is still forming.'
    const closePara = `The ${t.name} are ${recordStr(sheet)} and their draft assets are in play. Let's go get someone special.`
    return {
      headline,
      body: [lede, prospectsStr, closePara].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── SEASON REVIEW templates ────────────────────────── */

const SEASON_REVIEW_BEAT: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const champLine = s.seasonChampion ? `${s.seasonChampion} are the champions.` : ''
    const headline = overPerforming(sheet)
      ? `${sheet.year}–${sheet.year + 1} season review: ${t.name} over-delivered on every expectation`
      : underPerforming(sheet)
        ? `${sheet.year}–${sheet.year + 1} season review: hard questions after a year that fell short`
        : `${sheet.year}–${sheet.year + 1} season review: ${t.name} land right on the line`
    const lede = `HARBOR CITY — The ${sheet.year}–${sheet.year + 1} campaign is complete. ${champLine} The ${t.name} finish at ${recordStr(sheet)}.`
    const expLine = expectationBlurb(sheet) ?? ''
    const awardsLines = s.awardFrontrunners.slice(0, 2).map(
      (a) => `${a.awardName}: ${a.leaderName} (${a.leaderTeamAbbr}).`
    )
    const awardsStr = awardsLines.length > 0 ? `Award winners: ${awardsLines.join(' ')}` : ''
    const arcLine = topArcBlurb(sheet) ?? ''
    const closePara = `The offseason starts now. What happens next will define the next chapter of this franchise.`
    return {
      headline,
      body: [lede, [expLine, awardsStr].filter(Boolean).join(' '), arcLine, closePara].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const SEASON_REVIEW_NATIONAL: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const champLine = s.seasonChampion ? `${s.seasonChampion} raised the cup — ` : ''
    const headline = `${sheet.year}–${sheet.year + 1} in review: the league's story, start to finish`
    const lede = `${champLine}and another season goes into the history books. Here is what it meant.`
    const expLine = overPerforming(sheet)
      ? `The ${t.name} (${recordStr(sheet)}) outran their preseason consensus. That earns respect.`
      : underPerforming(sheet)
        ? `The ${t.name} (${recordStr(sheet)}) underperformed. The front office owes the fanbase an explanation.`
        : `The ${t.name} (${recordStr(sheet)}) met expectations almost exactly. A known entity heading into the offseason.`
    const awardsLines = s.awardFrontrunners.slice(0, 2).map(
      (a) => `${a.awardName}: ${a.leaderName} (${a.leaderTeamAbbr}) — ${a.statLine}.`
    )
    const awardsStr = awardsLines.length > 0 ? awardsLines.join(' ') : ''
    const arcLine = topArcBlurb(sheet) ?? ''
    return {
      headline,
      body: [lede, awardsStr, expLine, arcLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const SEASON_REVIEW_HOMER: TentpoleTemplateFn[] = [
  (sheet) => {
    const s = asScheduled(sheet)
    const t = sheet.team
    const won = s.seasonChampion === t.name
    const headline = won
      ? `Season review: we are champions!`
      : overPerforming(sheet)
        ? `What a season from your ${t.name}. I'm proud of this group.`
        : `Season review: this was a learning year, and the ${t.name} are not done growing`
    const lede = won
      ? `I'll keep this simple: the ${t.name} are champions. ${recordStr(sheet)}. Everything I said all year, I meant.`
      : overPerforming(sheet)
        ? `The ${t.name} finish at ${recordStr(sheet)}, above every preseason projection I saw. This group gave us a season to remember.`
        : `${recordStr(sheet)}. We wanted more. I'm not going to pretend otherwise. But I am not, for one second, giving up on this team or this building.`
    const champLine = s.seasonChampion && !won ? `Congratulations to ${s.seasonChampion}. This year. Next year is ours.` : ''
    const moraleBlurbLine = moraleBlurb(sheet)
    return {
      headline,
      body: [lede, champLine, moraleBlurbLine].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },
]

/* ────────────────────────── dispatch ────────────────────────── */

const WEEKLY_TEMPLATES: Record<PressPersonaId, WeeklyTemplateFn[]> = {
  beat: WEEKLY_BEAT,
  national: WEEKLY_NATIONAL,
  homer: WEEKLY_HOMER,
}

const TENTPOLE_TEMPLATES: Record<string, Record<PressPersonaId, TentpoleTemplateFn[]>> = {
  deadline: { beat: DEADLINE_BEAT, national: DEADLINE_NATIONAL, homer: DEADLINE_HOMER },
  lottery: { beat: LOTTERY_BEAT, national: LOTTERY_NATIONAL, homer: LOTTERY_HOMER },
  combine: { beat: COMBINE_BEAT, national: COMBINE_NATIONAL, homer: COMBINE_HOMER },
  draft: { beat: DRAFT_BEAT, national: DRAFT_NATIONAL, homer: DRAFT_HOMER },
  seasonRecap: { beat: SEASON_RECAP_BEAT, national: SEASON_RECAP_NATIONAL, homer: SEASON_RECAP_HOMER },
  champion: { beat: CHAMPION_BEAT, national: CHAMPION_NATIONAL, homer: CHAMPION_HOMER },
  presser: { beat: PRESSER_BEAT, national: PRESSER_NATIONAL, homer: PRESSER_HOMER },
  // Scheduled recurring media reports
  powerRankings: { beat: POWER_RANKINGS_BEAT, national: POWER_RANKINGS_NATIONAL, homer: POWER_RANKINGS_HOMER },
  seasonPreview: { beat: SEASON_PREVIEW_BEAT, national: SEASON_PREVIEW_NATIONAL, homer: SEASON_PREVIEW_HOMER },
  monthlyReport: { beat: MONTHLY_REPORT_BEAT, national: MONTHLY_REPORT_NATIONAL, homer: MONTHLY_REPORT_HOMER },
  playoffPreview: { beat: PLAYOFF_PREVIEW_BEAT, national: PLAYOFF_PREVIEW_NATIONAL, homer: PLAYOFF_PREVIEW_HOMER },
  awardsNight: { beat: AWARDS_NIGHT_BEAT, national: AWARDS_NIGHT_NATIONAL, homer: AWARDS_NIGHT_HOMER },
  draftPreview: { beat: DRAFT_PREVIEW_BEAT, national: DRAFT_PREVIEW_NATIONAL, homer: DRAFT_PREVIEW_HOMER },
  seasonReview: { beat: SEASON_REVIEW_BEAT, national: SEASON_REVIEW_NATIONAL, homer: SEASON_REVIEW_HOMER },
}

/**
 * Render a deterministic, genuinely written article for any press job.
 *
 * Template selection is seeded off a stable hash of (teamAbbr + year + day +
 * job.id) so successive articles from the same team in the same season vary
 * naturally without any external randomness.
 */
export function renderFallback(job: PressJob): FallbackArticle {
  return finishArticle(job, renderFallbackRaw(job))
}

const PARA_BREAK = '\n\n'

/** Kinds where the writer's standing with the GM frames the piece. */
const TILTED_KINDS = new Set(['weekly', 'monthlyReport', 'seasonReview', 'deadline'])

/**
 * The last pass over every fallback article:
 *  - the dateline names the club's real city (the templates were written with
 *    a placeholder "HARBOR CITY" that shipped in every league);
 *  - RAPPORT frames the piece (docs/MEDIA-BEAT.md): an ally's column gives the
 *    front office the benefit of the doubt, a critic's makes the week a
 *    verdict on it. This is the behaviour the Media Circuit promises.
 */
function finishArticle(job: PressJob, art: FallbackArticle): FallbackArticle {
  const sheet = job.factSheet
  let body = art.body
  if (sheet.team.city) body = body.replace(/HARBOR CITY/g, sheet.team.city.toUpperCase())
  const tilt = sheet.tilt
  if (tilt && tilt !== 'neutral' && TILTED_KINDS.has(sheet.kind)) {
    const { wins, losses } = recentRecord(sheet)
    const mood = losses > wins ? 'loss' : 'win'
    const frame = renderStable(TILT_FRAME, { tilt, mood }, `${job.id}|${sheet.year}|${sheet.day}|tilt`, {
      team: sheet.team.name,
    })
    if (frame) {
      const paras = body.split(PARA_BREAK)
      paras.splice(Math.min(1, paras.length), 0, frame)
      body = paras.join(PARA_BREAK)
    }
  }
  return { ...art, body }
}

function renderFallbackRaw(job: PressJob): FallbackArticle {
  const sheet = job.factSheet
  const persona = job.personaId

  // Stable seed: hash the job id together with the team/time coordinates.
  const hashInput = `${sheet.team.abbr}|${sheet.year}|${sheet.day}|${job.id}`
  const seed = stableHash(hashInput)

  if (sheet.kind === 'weekly') {
    const templates = WEEKLY_TEMPLATES[persona]
    return pick(templates, seed)(sheet, seed)
  }

  const kindTemplates = TENTPOLE_TEMPLATES[sheet.kind]
  if (kindTemplates) {
    const templates = kindTemplates[persona]
    if (templates && templates.length > 0) {
      // #5: power rankings must match the calendar. The "preseason projections"
      // template (index 0) is only right before opening night; a date-agnostic
      // pick was firing it mid-season (a December "preseason power rankings"). Force
      // phase-appropriate copy: template[0] preseason, template[1+] in-season refresh.
      if (sheet.kind === 'powerRankings') {
        const t = sheet.team
        const isPreseason = t.wins + t.losses + t.otLosses === 0
        const idx = isPreseason
          ? 0
          : Math.min(templates.length - 1, 1 + (seed % Math.max(1, templates.length - 1)))
        return templates[idx]!(sheet, seed)
      }
      // The beat's second monthly template is a QUARTER-POLE piece ("the league
      // after the first stretch … through the early going"). It was drawn for
      // any month, so March could be the quarter pole. Only offer it then.
      if (sheet.kind === 'monthlyReport' && persona === 'beat' && templates.length > 1) {
        const gp = gamesPlayed(sheet)
        const quarterPole = gp >= 15 && gp <= 30
        return templates[quarterPole ? 1 : 0]!(sheet, seed)
      }
      return pick(templates, seed)(sheet, seed)
    }
  }

  // Absolute fallback for any future kind without a template yet.
  return genericFallback(job)
}

function genericFallback(job: PressJob): FallbackArticle {
  const sheet = job.factSheet
  const persona = PRESS_PERSONA_NAMES[job.personaId]
  const t = sheet.team
  const rec = recordStr(sheet)
  const headline = `${t.abbr} ${sheet.kind} report — ${t.wins}–${t.losses}–${t.otLosses}`
  const lede = `The ${t.name} are ${rec}.`
  const specials = sheet.special.length > 0 ? sheet.special.join(' ') : ''
  const arc = topArcBlurb(sheet) ?? ''
  return {
    headline,
    body: [lede, specials, arc].filter(Boolean).join('\n\n'),
    byline: `${persona.name} — ${persona.outlet}`,
  }
}
