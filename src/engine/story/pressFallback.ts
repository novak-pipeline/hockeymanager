/**
 * Deterministic press fallback — richly written, persona-voiced articles rendered
 * from the same PressFactSheet the LLM writers get. This is the DEFAULT generation
 * path: the press corps never goes silent, no API key required.
 *
 * Design principles:
 *  - Multiple template variants per kind × persona, selected by a stable hash of
 *    (teamAbbr + year + day + pressCounter) so repeat pieces differ naturally.
 *  - Three distinct voices: Sam Carver (beat — measured/close), Vic Mercer
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
} from './factSheet'

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
function overPerforming(sheet: PressFactSheet): boolean {
  return sheet.team.expectedRank !== undefined && sheet.team.rank < sheet.team.expectedRank
}

/** True when the team is underperforming their preseason projection. */
function underPerforming(sheet: PressFactSheet): boolean {
  return sheet.team.expectedRank !== undefined && sheet.team.rank > sheet.team.expectedRank
}

function expectationBlurb(sheet: PressFactSheet): string | null {
  const t = sheet.team
  if (t.expectedRank === undefined) return null
  const diff = Math.abs(t.rank - t.expectedRank)
  if (overPerforming(sheet)) {
    if (diff >= 5) return `They were projected ${ordinal(t.expectedRank)} before puck drop — they're running ${diff} places ahead of schedule.`
    return `The preseason numbers had them ${ordinal(t.expectedRank)}; they've beaten that projection by ${diff} spots.`
  }
  if (underPerforming(sheet)) {
    if (diff >= 5) return `After a preseason ranking of ${ordinal(t.expectedRank)}, the gap between expectation and reality has grown to ${diff} places.`
    return `The club sits ${diff} ${diff === 1 ? 'spot' : 'spots'} below their preseason projection of ${ordinal(t.expectedRank)}.`
  }
  return `They're running exactly to projection, sitting ${ordinal(t.rank)} as expected.`
}

function topArcBlurb(sheet: PressFactSheet): string | null {
  const arc = sheet.topArcs[0]
  return arc ? arc.summary : null
}

function moraleBlurb(sheet: PressFactSheet): string {
  const m = Math.round(sheet.lockerRoom.roomMorale)
  const cap = sheet.lockerRoom.captainName
  if (m >= 80) return cap ? `The room is running hot — morale sits at ${m}/100 under the steady hand of captain ${cap}.` : `Room morale is at ${m}/100, as high as it's been all season.`
  if (m >= 60) return cap ? `${cap} is keeping the ship steady; morale registers at ${m}/100.` : `Morale is a serviceable ${m}/100 — not inspired, but not broken.`
  if (m >= 40) return cap ? `Captain ${cap} has some work to do: room morale is a below-average ${m}/100.` : `The room reads flat at ${m}/100.`
  return cap ? `The dressing room is in a difficult place. Morale: ${m}/100. A lot rides on ${cap}'s leadership right now.` : `The dressing room is in a difficult place. Morale has fallen to ${m}/100.`
}

function leaderBlurb(sheet: PressFactSheet): string | null {
  const l = sheet.leagueLeaders[0]
  if (!l) return null
  return `${l.name} (${l.teamAbbr}) leads the league with ${l.value} ${l.stat}.`
}

function feudBlurb(sheet: PressFactSheet): string | null {
  const f = sheet.lockerRoom.feuds[0]
  return f ? `Off the ice, friction between ${f} is worth watching.` : null
}

function mentorBlurb(sheet: PressFactSheet): string | null {
  const m = sheet.lockerRoom.mentorships[0]
  return m ? `${m} — a pairing that speaks to the long-term planning here.` : null
}

function rumorBlurb(sheet: PressFactSheet): string | null {
  const r = sheet.rumors[0]
  if (!r) return null
  const heat = r.heat >= 75 ? 'red-hot' : r.heat >= 50 ? 'warm' : 'simmering'
  return `The rumor mill keeps spinning around ${r.playerName} (${r.teamAbbr}) — trade chatter is ${heat} at ${Math.round(r.heat)}/100.`
}

function upNextBlurb(sheet: PressFactSheet): string | null {
  if (sheet.upcomingOpponents.length === 0) return null
  const next = sheet.upcomingOpponents[0]
  if (sheet.upcomingOpponents.length === 1) return `Next up: ${next}.`
  return `Next up: ${sheet.upcomingOpponents.slice(0, 2).join(', ')}.`
}

/* ────────────────────────── WEEKLY templates ────────────────────────── */

type WeeklyTemplateFn = (sheet: PressFactSheet, seed: number) => FallbackArticle

const WEEKLY_BEAT: WeeklyTemplateFn[] = [
  // Template 0 — workmanlike week-in-review
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)
    const allWins = sheet.lastResults.length > 0 && wins === sheet.lastResults.length
    const allLoss = sheet.lastResults.length > 0 && losses === sheet.lastResults.length

    const headline = allWins
      ? `${t.abbr} keeps rolling — ${wins} straight and counting`
      : allLoss
        ? `A rough week at the office for the ${t.name}`
        : wins > losses
          ? `${t.abbr} edges ahead: ${wins}–${losses} through the week`
          : `${t.abbr} splits the week, searching for consistency`

    const lede = allWins
      ? `HARBOR CITY — The ${t.name} are building something. ${wins} wins in the last ${sheet.lastResults.length} outings has the club sitting ${recordStr(sheet)}, and the dressing room feels it.`
      : allLoss
        ? `HARBOR CITY — It was a week to forget. The ${t.name} went ${wins}–${losses} over their last ${sheet.lastResults.length}, and the questions are mounting.`
        : `HARBOR CITY — The ${t.name} are a team trying to find its floor. A ${wins}–${losses} week leaves the club at ${recordStr(sheet)} — good enough for now, but the margin for inconsistency is shrinking.`

    const para2 = recentRunStr(sheet)
      ? `Recent results: ${recentRunStr(sheet)}.`
      : ''

    const expLine = expectationBlurb(sheet) ?? ''
    const arcLine = topArcBlurb(sheet) ?? ''
    const moraleLine = moraleBlurb(sheet)
    const upLine = upNextBlurb(sheet) ?? ''

    const paras = [lede, [para2, expLine].filter(Boolean).join(' '), [arcLine, moraleLine].filter(Boolean).join(' '), upLine].filter(Boolean)

    return {
      headline,
      body: paras.join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },

  // Template 1 — standings focus
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)
    const overExp = overPerforming(sheet)
    const underExp = underPerforming(sheet)

    const headline = overExp
      ? `${t.name} defying expectations at ${ordinal(t.rank)}`
      : underExp
        ? `${t.name} stuck below the line: hard questions after a ${wins}–${losses} week`
        : `${t.abbr} holds at ${ordinal(t.rank)} — ${wins}–${losses} through the week`

    const projection = overExp
      ? 'still running ahead of what anyone predicted back in October'
      : underExp
        ? 'still chasing the form that was expected before puck drop'
        : 'right about where the preseason models had them'
    const lede = `HARBOR CITY — Standings are undefeated. The ${t.name} check in at ${recordStr(sheet)} after going ${wins}–${losses} this week, ${projection}.`

    const expLine = expectationBlurb(sheet) ?? ''
    const arcLine = topArcBlurb(sheet) ?? ''
    const rumorLine = rumorBlurb(sheet) ?? ''
    const leaderLine = leaderBlurb(sheet) ?? ''
    const upLine = upNextBlurb(sheet) ?? ''

    const paras = [
      lede,
      [expLine, arcLine].filter(Boolean).join(' '),
      [rumorLine, leaderLine].filter(Boolean).join(' '),
      upLine,
    ].filter(Boolean)

    return {
      headline,
      body: paras.join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },

  // Template 2 — locker room focus
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)

    const headline = sheet.lockerRoom.roomMorale >= 70
      ? `${t.abbr} room is locked in — ${wins}–${losses} week reflects it`
      : sheet.lockerRoom.roomMorale <= 45
        ? `Off-ice questions shadow a ${wins}–${losses} week for ${t.abbr}`
        : wins > losses
          ? `${t.abbr} week in review: winning on the ice, steady in the room`
          : wins < losses
            ? `${t.abbr} week in review: results and room dynamics under scrutiny`
            : `${t.abbr} week in review: results and room dynamics`

    const lede = `HARBOR CITY — Numbers tell part of the story. The ${t.name} are ${recordStr(sheet)} after a ${wins}–${losses} week. But a lot of what happens on the ice in this building starts long before puck drop.`

    const moraleLine = moraleBlurb(sheet)
    const feudLine = feudBlurb(sheet) ?? ''
    const mentorLine = mentorBlurb(sheet) ?? ''
    const arcLine = topArcBlurb(sheet) ?? ''
    const expLine = expectationBlurb(sheet) ?? ''
    const upLine = upNextBlurb(sheet) ?? ''

    const paras = [
      lede,
      [moraleLine, feudLine].filter(Boolean).join(' '),
      [mentorLine, arcLine].filter(Boolean).join(' '),
      [expLine, upLine].filter(Boolean).join(' '),
    ].filter(Boolean)

    return {
      headline,
      body: paras.join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.beat.name} — ${PRESS_PERSONA_NAMES.beat.outlet}`,
    }
  },
]

const WEEKLY_NATIONAL: WeeklyTemplateFn[] = [
  // Template 0 — analytical big-picture
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)

    const headline = overPerforming(sheet)
      ? `${t.name}: the league's most surprising story`
      : underPerforming(sheet)
        ? `${t.name}'s early promise hasn't materialised — time to ask why`
        : `${t.name} are exactly what they look like — a ${wins}–${losses} week confirms it`

    const lede = `The ${t.name} are ${recordStr(sheet)}. A ${wins}–${losses} week. Make of that what you will — and I'll tell you what I make of it.`

    const expLine = expectationBlurb(sheet)
    const arcLine = topArcBlurb(sheet)
    const leaderLine = leaderBlurb(sheet)
    const rumorLine = rumorBlurb(sheet)
    const upLine = upNextBlurb(sheet)

    const midPara = expLine
      ? `${expLine}${arcLine ? ` Meanwhile: ${arcLine}` : ''}`
      : arcLine ?? ''

    const statPara = [leaderLine, rumorLine].filter(Boolean).join(' ')

    const paras = [lede, midPara, statPara, upLine].filter(Boolean) as string[]

    return {
      headline,
      body: paras.join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },

  // Template 1 — sharp opinion column
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)
    const allWins = sheet.lastResults.length > 0 && wins === sheet.lastResults.length

    const headline = allWins
      ? `Don't look now, but ${t.name} are making a case`
      : wins === 0 && sheet.lastResults.length >= 2
        ? `${t.name} in freefall? Not quite — but the questions are real`
        : `What ${wins}–${losses} week tells us about the ${t.name}`

    const lede = `Here's what we know about the ${t.name}: they are ${recordStr(sheet)} and they just went ${wins}–${losses} over the last ${sheet.lastResults.length || 'several'} games. Here's what we don't know: whether any of it is sustainable.`

    const expLine = expectationBlurb(sheet)
    const arcLine = topArcBlurb(sheet)
    const leaderLine = leaderBlurb(sheet)
    const rumorLine = rumorBlurb(sheet)

    const bodyPara = [expLine, arcLine].filter(Boolean).join(' ')
    const statPara = [leaderLine, rumorLine].filter(Boolean).join(' ')
    const closePara = underPerforming(sheet)
      ? `The front office has decisions to make. What happens next will say a great deal about who this franchise wants to be.`
      : overPerforming(sheet)
        ? `Credit where it's due. This team has outperformed the room's consensus — and in this league, that earns you a look.`
        : `This is a team that knows what it is. Whether that's enough remains the open question.`

    const paras = [lede, bodyPara, statPara, closePara].filter(Boolean)

    return {
      headline,
      body: paras.join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },

  // Template 2 — league-context frame
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)

    const headline = overPerforming(sheet)
      ? `${t.abbr} ahead of the curve: what ${wins}–${losses} means in this league`
      : underPerforming(sheet)
        ? `${t.abbr} below projection: what ${wins}–${losses} means in this league`
        : `${t.abbr} in context: what ${wins}–${losses} means in this league`

    const lede = `Place the ${t.name} on the league map and here's what you get: ${recordStr(sheet)}, a ${wins}–${losses} week, and a club that sits ${t.expectedRank !== undefined ? (overPerforming(sheet) ? 'above' : underPerforming(sheet) ? 'below' : 'exactly at') : 'somewhere around'} where the preseason models expected.`

    const expLine = expectationBlurb(sheet)
    const leaderLine = leaderBlurb(sheet)
    const arcLine = topArcBlurb(sheet)
    const moraleLine = moraleBlurb(sheet)
    const rumorLine = rumorBlurb(sheet)
    const upLine = upNextBlurb(sheet)

    const para2 = [expLine, leaderLine].filter(Boolean).join(' ')
    const para3 = [arcLine, moraleLine].filter(Boolean).join(' ')
    const para4 = [rumorLine, upLine].filter(Boolean).join(' ')

    return {
      headline,
      body: [lede, para2, para3, para4].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.national.name} — ${PRESS_PERSONA_NAMES.national.outlet}`,
    }
  },
]

const WEEKLY_HOMER: WeeklyTemplateFn[] = [
  // Template 0 — boosterish warmth
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)
    const allWins = wins === sheet.lastResults.length && sheet.lastResults.length > 0

    const headline = allWins
      ? `WE ARE ROLLING — ${wins} straight for YOUR ${t.name}!`
      : wins >= losses
        ? `Another week, another step forward for the ${t.name}!`
        : `Tough week, but we're not throwing in the towel — not even close`

    const lede = allWins
      ? `Folks, I'll say it: I have not had this much fun covering this team in years. The ${t.name} are ${recordStr(sheet)} and there is no team in this league I'd rather watch right now.`
      : wins >= losses
        ? `Could we have won more? Sure. But the ${t.name} went ${wins}–${losses} this week, and I've seen worse from teams a lot higher in the standings. We're at ${recordStr(sheet)}.`
        : `Look — ${wins}–${losses} isn't the week we wanted. But I've been around hockey long enough to know that a tough week doesn't define a season. Not for a team with this group.`

    const expLine = expectationBlurb(sheet)
    const arcLine = topArcBlurb(sheet)
    const moraleLine = moraleBlurb(sheet)
    const upLine = upNextBlurb(sheet)

    const para2 = expLine
      ? overPerforming(sheet)
        ? `${expLine} Nobody believed in us — and we've been proving them wrong every night.`
        : underPerforming(sheet)
          ? `${expLine} We'll get there. Trust the process.`
          : expLine
      : arcLine ?? ''

    const para3 = [moraleLine, upLine].filter(Boolean).join(' ')

    return {
      headline,
      body: [lede, para2, para3].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },

  // Template 1 — radio-warm call-in energy
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)

    const headline = sheet.lockerRoom.roomMorale >= 65
      ? `Good vibes only — the ${t.name} room is a special place right now`
      : wins > losses
        ? `We're finding it, folks — ${t.abbr} wins ${wins} of ${sheet.lastResults.length} this week`
        : `Character week for your ${t.name} — we'll look back on this`

    const lede = `I'll tell you what, folks — I've been on the phone all week with people around this league, and nobody is sleeping on the ${t.name} right now. We're ${recordStr(sheet)}, and that record doesn't tell the whole story of what we've been building.`

    const moraleLine = moraleBlurb(sheet)
    const feudLine = feudBlurb(sheet)
    const leaderLine = leaderBlurb(sheet)
    const rumorLine = rumorBlurb(sheet)
    const upLine = upNextBlurb(sheet)

    const para2 = [moraleLine, feudLine ? `And yes, I've heard the whispers — ${feudLine}` : null].filter(Boolean).join(' ')
    const para3 = [leaderLine, rumorLine].filter(Boolean).join(' ')
    const para4 = upLine ? `${upLine} Buckle up.` : ''

    return {
      headline,
      body: [lede, para2, para3, para4].filter(Boolean).join('\n\n'),
      byline: `${PRESS_PERSONA_NAMES.homer.name} — ${PRESS_PERSONA_NAMES.homer.outlet}`,
    }
  },

  // Template 2 — silver-lining specialist
  (sheet) => {
    const t = sheet.team
    const { wins, losses } = recentRecord(sheet)
    const allLoss = losses === sheet.lastResults.length && sheet.lastResults.length > 0

    const headline = allLoss
      ? `Rough week — but here's why I'm still a believer`
      : wins >= losses
        ? `Here's what I saw this week that the scoreboard doesn't show`
        : `You want my honest take? We're closer than you think`

    const lede = allLoss
      ? `Alright, we went ${wins}–${losses}. I know. I watched every game. But I'm going to tell you something: I have seen this team fight, and I am not ready to write them off. Not even close. We're ${recordStr(sheet)}.`
      : `The ${t.name} are ${recordStr(sheet)} after a ${wins}–${losses} week. On paper, fine. On the ice — honestly? We showed some things this week that I think are going to matter come the second half.`

    const expLine = expectationBlurb(sheet)
    const arcLine = topArcBlurb(sheet)
    const upLine = upNextBlurb(sheet)

    const para2 = [expLine, arcLine].filter(Boolean).join(' ')
    const closePara = upLine
      ? `${upLine} And when we're ready, this building is going to be very loud.`
      : `This group has more in the tank. I believe that. I'll keep saying it.`

    return {
      headline,
      body: [lede, para2, closePara].filter(Boolean).join('\n\n'),
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
    const headline = `Deadline day reshapes the league — here's what it means for ${t.name}`
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
    const headline = `Trade deadline winners and losers — where does ${t.name} land?`
    const lede = `Deadline day separates the contenders from the pretenders, and this year's market was no different.`
    const movesLine = trades.length > 0 ? `The defining moves: ${trades.join('. ')}.` : 'The defining feature of this deadline was restraint — or inertia, depending on your read.'
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
    const t = sheet.team
    const trades = sheet.special.slice(0, 3)
    const headline = `Deadline day is DONE — and folks, I like where we sit`
    const lede = `Whew. What a 48 hours. The phones were ringing across the league, deals were flying — and when the dust settled, the ${t.name} are at ${recordStr(sheet)} and ready to make a run.`
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
    const headline = `Draft lottery sets the board — ${t.abbr} watches and waits`
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
    const headline = `Lottery night: the pick that changes everything — and the ones that don't`
    const lede = `Every year the lottery produces a winner and a dozen clubs that nod along and go back to work. This year is no different.`
    const lottoLine = special.length > 0 ? special.join(' ') : `The final order reflects the season's competitive balance — which is to say, there were no great surprises.`
    const contextLine = overPerforming(sheet)
      ? `The ${t.name} (${recordStr(sheet)}) were not in this conversation — which is exactly where you want to be.`
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
    const headline = `Lottery night — and folks, I see opportunity everywhere`
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
    const contextLine = `For the ${t.name} (${recordStr(sheet)}), the combine data lands at a consequential moment — the roster needs address, and the draft class offers options.`
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
    const lede = `Folks, this is where futures get made. Combine week is my favourite time of the year — you get to see what's coming, and I don't know about you, but I am very excited about what's coming.`
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
    const lede = `Every draft reveals a philosophy. The picks you make at the top of the board tell you where a franchise thinks it is — and the picks you make in the late rounds tell you where they think they're going.`
    const picksLine = special.length > 0 ? special.join(' ') : 'The selections spanned the usual mix of upside and safety. Scouts earned their keep this year.'
    const contextLine = underPerforming(sheet)
      ? `The ${t.name} (${recordStr(sheet)}) needed a strong draft. The question of whether they got one will take three years to answer — but the direction reads as intentional.`
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
    const headline = `DRAFT DAY — and WOW, we just got exciting, folks!`
    const lede = `The ${t.name} just added future building blocks, and I am HERE for it. Draft day is pure possibility, and today we got to see ours.`
    const picksLine = special.length > 0 ? special.join(' ') : 'Names called, jerseys handed out, handshakes across the stage — I love this day every single year!'
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
      ? `${t.name} exceeded every forecast — now the real pressure begins`
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
      ? `WHAT A SEASON — ${t.name}, you gave us everything`
      : underPerforming(sheet)
        ? `It wasn't the year we dreamed of — but this team? Still got my heart`
        : `Season done. And folks, I'm proud of this group.`

    const lede = overPerforming(sheet)
      ? `I said at the start of the year that this group had something. I was right. The ${t.name} finish ${recordStr(sheet)}, and if you told me that in October I would have bought every person in this studio a coffee.`
      : underPerforming(sheet)
        ? `${recordStr(sheet)}. Not what we wanted. I'm not going to sugarcoat it — this season had stretches that were genuinely difficult to watch. But I've never stopped believing in this group.`
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
    const headline = `${t.name} raise the cup — and earn it`
    const lede = `Champions are made, not born — and the ${t.name} have made themselves. Final record: ${recordStr(sheet)}. A season that earned this moment.`
    const detailLine = special.length > 0 ? special.join(' ') : 'The finish was everything a championship run should be.'
    const expLine = overPerforming(sheet)
      ? `They were not supposed to win this. That's what makes it worth writing about.`
      : `They won the way they were supposed to win it — systematically, relentlessly.`
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
    const headline = `WE DID IT — ${t.name} ARE CHAMPIONS!!!`
    const lede = `I have been doing this for a long time. I have covered good teams and bad teams, playoff runs and early exits. Nothing — NOTHING — compares to this. The ${t.name} are CHAMPIONS.`
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
    const headline = `${t.abbr} GM faces the media — postgame presser reaction`
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
    const headline = `Presser debrief: what the ${t.name} GM said — and what they didn't`
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
    const t = sheet.team
    const special = sheet.special.slice(0, 2)
    const headline = `GM presser: I liked what I heard — here's why`
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
}

/**
 * Render a deterministic, genuinely written article for any press job.
 *
 * Template selection is seeded off a stable hash of (teamAbbr + year + day +
 * job.id) so successive articles from the same team in the same season vary
 * naturally without any external randomness.
 */
export function renderFallback(job: PressJob): FallbackArticle {
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
