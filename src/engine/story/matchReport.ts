/**
 * The postgame write-up (A5) — a short story of the game, told from the box
 * score and the event stream.
 *
 * WHERE IT LIVES, and why. It is a field on the postgame receipt, rendered as
 * a lede directly under the score and directly above "The turning point" —
 * NOT a separate screen and NOT an inbox item. Three reasons:
 *
 *  - The receipt is already the ritual the GM stops for. A second surface for
 *    the same game means a second click for something he is already looking at.
 *  - The same playtest that asked for the write-up (A5) asked for the inbox to
 *    be curated by value (A8). Eighty-two automatic match stories a season is
 *    the exact clutter that complaint is about.
 *  - "The turning point" was liked and stays its own labelled one-liner. The
 *    write-up sets the scene; the turning point names the moment. They read as
 *    a pair, and they only read as a pair if they sit together.
 *
 * WHAT IT SAYS. Two sentences, always: the SHAPE of the game (a rally, a
 * collapse, a siege, a track meet, a night the goalie stole) and the man who
 * decided it. Then, occasionally, a third: a RARE thing that actually
 * happened — a shorthanded goal, an empty-netter into a one-goal game, a
 * defenceman winning it in overtime, someone scoring inside the first minute.
 * Those fire only when the stream really contains them, so a wacky sentence is
 * always a receipt for a wacky event, never decoration.
 *
 * Pure and deterministic: a function of the box score plus a stable game key,
 * so re-opening the receipt shows the same story.
 */
import type { ContentVariant } from './contentEngine'
import { renderTemplate } from './contentEngine'
import { pickStable, possessive } from './prose'

export interface MatchReportGoal {
  /** 1..3 regulation, 4+ overtime. */
  period: number
  /** Seconds elapsed WITHIN the period. */
  t: number
  byUser: boolean
  scorerName: string
  /** 'C' | 'W' | 'D' | 'G' — a blue-line or goalie goal is its own story. */
  scorerPosition: string
  strength: 'ev' | 'pp' | 'sh' | 'en'
  /** Positions of the assisting players, for the goalie-assist case. */
  assistPositions: string[]
  assistNames: string[]
}

export interface MatchReportInput {
  /** Stable id for the game — keys which authored frame this game draws. */
  gameId: string
  userAbbr: string
  oppAbbr: string
  won: boolean
  playoff: boolean
  decidedBy: 'regulation' | 'overtime' | 'shootout'
  /** Chronological. Excludes the shootout decider (it is not a stream goal). */
  goals: MatchReportGoal[]
  userGoals: number
  oppGoals: number
  userShots: number
  oppShots: number
  /** The user club's starter, if he faced shots. */
  goalie?: { name: string; saves: number; shotsAgainst: number; goalsAgainst: number }
  /** The opposing starter, for the nights he was the story. */
  oppGoalie?: { name: string; saves: number; shotsAgainst: number }
  /** First star, whoever it belonged to. */
  firstStarName?: string
  firstStarLine?: string
  /** Penalty minutes both ways — a genuinely ugly night is a story. */
  penaltyMinutes?: number
}

/* ────────────────────────── reading the game ────────────────────────── */

interface Shape {
  maxDeficit: number
  maxLead: number
  margin: number
  ledFromFirstGoal: boolean
  neverTrailed: boolean
}

function readShape(inp: MatchReportInput): Shape {
  let us = 0
  let them = 0
  let maxDeficit = 0
  let maxLead = 0
  let neverTrailed = true
  for (const g of inp.goals) {
    if (g.byUser) us++
    else them++
    if (them - us > maxDeficit) maxDeficit = them - us
    if (them > us) neverTrailed = false
    if (us - them > maxLead) maxLead = us - them
  }
  return {
    maxDeficit,
    maxLead,
    margin: Math.abs(inp.userGoals - inp.oppGoals),
    ledFromFirstGoal: inp.goals.length > 0 && inp.goals[0]!.byUser,
    neverTrailed,
  }
}

/** The last goal that changed the lead — the man who actually decided it. */
function decisiveScorer(inp: MatchReportInput): MatchReportGoal | null {
  let us = 0
  let them = 0
  let winner: MatchReportGoal | null = null
  const userWon = inp.userGoals > inp.oppGoals
  for (const g of inp.goals) {
    if (g.byUser) us++
    else them++
    // The goal that put the eventual winner ahead for the last time.
    if (userWon ? us === them + 1 && g.byUser : them === us + 1 && !g.byUser) winner = g
  }
  return winner
}

function clockOf(g: MatchReportGoal): string {
  const m = Math.floor(g.t / 60)
  const s = Math.floor(g.t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/* ────────────────────────── the shape pool ──────────────────────────
 * Slots: {us} {them} {margin} {ourGoals} {theirGoals} {shots} {oppShots}
 *        {goalie} {saves} {shotsAgainst} {oppGoalie} {oppSaves} {deficit}
 *        {lead} {star} {starLine}
 */
const SHAPE_POOL: ContentVariant[] = [
  /* ── rallies ── */
  { id: 'mr.comeback.big', conditions: { won: true, minDeficit: 3 },
    text: `Three down and out of it, and then not. The {us} climbed all the way back to win it {ourGoals}-{theirGoals}, which is not a thing that happens often enough to be blase about.` },
  { id: 'mr.comeback.ot', conditions: { won: true, minDeficit: 2, decidedBy: 'overtime' },
    text: `Down {deficit}, level by the third, and gone in overtime. The {us} had no business being in this one at the intermission and took two points out of it anyway.` },
  { id: 'mr.comeback', conditions: { won: true, minDeficit: 2 },
    text: `A {deficit}-goal hole is a long way back at this level. The {us} dug out of it and won {ourGoals}-{theirGoals}, and the bench knew what it had done.` },
  { id: 'mr.comeback.b', conditions: { won: true, minDeficit: 2 },
    text: `The {us} were {deficit} down and looked it. Then they were not, and then they were in front — {ourGoals}-{theirGoals}, and the building found its voice somewhere in the second.` },
  /* ── collapses ── */
  { id: 'mr.blown.big', conditions: { won: false, minLead: 3 },
    text: `A {lead}-goal lead, and none of it left at the horn. The {us} lose {theirGoals}-{ourGoals}, and this is the kind of night that follows a room around for a week.` },
  { id: 'mr.blown', conditions: { won: false, minLead: 2 },
    text: `The {us} led by {lead} and could not close it. {theirGoals}-{ourGoals} to the {them}, and every man in that room knows exactly which shift it turned on.` },
  { id: 'mr.blown.b', conditions: { won: false, minLead: 2 },
    text: `Two-thirds of a good hockey game. The {us} were {lead} up and gave it back, and {theirGoals}-{ourGoals} is a scoreline that flatters nobody in that dressing room.` },
  /* ── the goalie ── */
  { id: 'mr.steal', conditions: { won: true, minGoalieSteal: 1 },
    text: `{goalie} decided this one on his own. {saves} saves on {shotsAgainst}, most of them under a siege the score does not show, and the {us} take two points they were outplayed for.` },
  { id: 'mr.steal.b', conditions: { won: true, minGoalieSteal: 1 },
    text: `Stolen, plainly. The {them} had {oppShots} shots and the better of the run of play; {goalie} had {saves} saves and the last word.` },
  { id: 'mr.robbed', conditions: { won: false, minOppGoalieSteal: 1 },
    text: `{oppGoalie} was the whole difference. The {us} threw {shots} shots at him and got {ourGoals} back; some nights the other goalie simply says no.` },
  { id: 'mr.shelled', conditions: { won: false, minGoalsAgainst: 6 },
    text: `Nothing worked, in front of the net or behind it. {theirGoals} past {goalie}, and the tape from this one will be short and unpleasant.` },
  /* ── shutouts ── */
  { id: 'mr.shutout.for', conditions: { won: true, cleanSheet: true },
    text: `A clean sheet and a comfortable evening. {goalie} turned aside all {shotsAgainst} and the {us} never let the game get interesting.` },
  { id: 'mr.shutout.against', conditions: { won: false, blanked: true },
    text: `{shots} shots and nothing to show for any of them. The {us} were shut out, and the frustration was visible by the midpoint of the third.` },
  /* ── blowouts ── */
  { id: 'mr.rout.for', conditions: { won: true, minMargin: 4 },
    text: `This one was over early. The {us} put {ourGoals} past the {them} and spent the third period managing the clock rather than the game.` },
  { id: 'mr.rout.against', conditions: { won: false, minMargin: 4 },
    text: `A bad night from the opening faceoff. {theirGoals}-{ourGoals}, and the {us} were second to most of the pucks that mattered.` },
  /* ── track meet ── */
  { id: 'mr.trackmeet', conditions: { minTotalGoals: 10 },
    text: `Neither goaltender enjoyed a minute of this. {ourGoals}-{theirGoals}, end to end all night, the kind of game coaches hate and everyone else remembers.` },
  /* ── the tight ones ── */
  { id: 'mr.so', conditions: { decidedBy: 'shootout' },
    text: `Sixty-five minutes settled nothing, so it came down to the skills competition. {ourGoals}-{theirGoals} on the scoresheet; the standings will not record how close it was.` },
  { id: 'mr.ot.win', conditions: { won: true, decidedBy: 'overtime' },
    text: `Three-on-three, and it did not last long. The {us} win it in overtime, {ourGoals}-{theirGoals}.` },
  { id: 'mr.ot.loss', conditions: { won: false, decidedBy: 'overtime' },
    text: `A point salvaged, a point lost. The {us} fall in overtime, and open ice at three-on-three is a cruel way to end a night this even.` },
  { id: 'mr.playoff.tight', conditions: { playoff: true, maxMargin: 1 },
    text: `Playoff hockey, which is to say two hours of very little space and one mistake. {ourGoals}-{theirGoals}.` },
  { id: 'mr.wire', conditions: { won: true, neverTrailed: true, ledFromFirstGoal: true },
    text: `The {us} scored first and never once had to chase it. A wire-to-wire {ourGoals}-{theirGoals} is the least dramatic way to take two points and the most comfortable.` },
  { id: 'mr.wire.b', conditions: { won: true, neverTrailed: true, ledFromFirstGoal: true },
    text: `Front-running, and no apologies for it. The {us} opened the scoring, held the lead the whole way and closed it out {ourGoals}-{theirGoals}.` },
  { id: 'mr.wire.c', conditions: { won: true, neverTrailed: true, ledFromFirstGoal: true },
    text: `Not once behind. The {us} took the lead early, made the {them} play the game they wanted, and won it {ourGoals}-{theirGoals}.` },
  /* ── generic fallbacks ── */
  { id: 'mr.win.a', conditions: { won: true },
    text: `Two points, honestly earned. The {us} beat the {them} {ourGoals}-{theirGoals} in a game that stayed in doubt longer than the shot clock suggested.` },
  { id: 'mr.win.b', conditions: { won: true },
    text: `The {us} take it {ourGoals}-{theirGoals}. Not a night anyone will frame, but the standings do not ask how.` },
  { id: 'mr.loss.a', conditions: { won: false },
    text: `The {them} leave with both points, {theirGoals}-{ourGoals}. The {us} had their stretches; they did not have enough of them.` },
  { id: 'mr.loss.b', conditions: { won: false },
    text: `A {theirGoals}-{ourGoals} defeat, and not much to argue about. The chances were roughly even and the finishing was not.` },
  { id: 'mr.any',
    text: `{ourGoals}-{theirGoals} against the {them}, on a night that came down to a handful of shifts either way.` },
]

/* ────────────────────────── the decider sentence ────────────────────── */

const DECIDER_POOL: ContentVariant[] = [
  { id: 'mr.dec.ot', conditions: { period: 4 },
    text: `{scorer} ended it in overtime.` },
  { id: 'mr.dec.d', conditions: { pos: 'D' },
    text: `{scorer} — a defenceman — scored the one that decided it, at {clock} of the {ordinal}.` },
  { id: 'mr.dec.pp', conditions: { strength: 'pp' },
    text: `The winner came on the power play, {scorer} at {clock} of the {ordinal}.` },
  { id: 'mr.dec.third', conditions: { period: 3 },
    text: `{scorer} got the decisive one at {clock} of the third, and it held.` },
  { id: 'mr.dec.third.b', conditions: { period: 3 },
    text: `It turned on {scorerPoss} goal at {clock} of the third.` },
  { id: 'mr.dec.early', conditions: { period: 1 },
    text: `{scorer} scored what turned out to be the winner in the first period, which nobody knew at the time.` },
  { id: 'mr.dec.a',
    text: `{scorer} scored the goal that decided it, {clock} into the {ordinal}.` },
  { id: 'mr.dec.b',
    text: `The one that mattered was {scorerPoss}, at {clock} of the {ordinal}.` },
]

const STAR_POOL: ContentVariant[] = [
  { id: 'mr.star.a', text: `{star} was the best player on the ice ({starLine}).` },
  { id: 'mr.star.b', text: `First star went to {star} — {starLine}.` },
  { id: 'mr.star.c', text: `{star} took the first star with {starLine}.` },
]

/* ────────────────────────── the rare beat ──────────────────────────
 * Every one of these is a receipt: it only renders when the stream actually
 * contained the thing. Slots: {name} {clock} {ordinal} {us} {them} {n}
 */
const RARE_POOL: ContentVariant[] = [
  { id: 'mr.rare.goalieAssist', conditions: { kind: 'goalieAssist' },
    text: `Worth noting for the scrapbook: {name} picked up an assist from the crease, which is not something the scoresheet prints often.` },
  { id: 'mr.rare.shorty', conditions: { kind: 'shorthanded' },
    text: `The shorthanded goal at {clock} of the {ordinal} was the low-percentage moment of the night — {name}, a man down, and gone the other way.` },
  { id: 'mr.rare.shortyBoth', conditions: { kind: 'shorthandedBoth' },
    text: `Two shorthanded goals in one game. Special teams coaches on both benches will be watching that tape through their fingers.` },
  { id: 'mr.rare.opener', conditions: { kind: 'openingMinute' },
    text: `{name} scored {clock} into the game — some of the building had not sat down.` },
  { id: 'mr.rare.buzzer', conditions: { kind: 'buzzer' },
    text: `{namePoss} goal came with {n} seconds left in the {ordinal}, which is the cruellest time to concede one.` },
  { id: 'mr.rare.hatTrick4', conditions: { kind: 'fourGoals' },
    text: `{name} scored four. Four. The hats were still coming down when he got the last one.` },
  { id: 'mr.rare.emptyDagger', conditions: { kind: 'emptyDagger' },
    text: `{namePoss} empty-netter ended a one-goal game that had been anyone's for ten minutes.` },
  { id: 'mr.rare.flurry', conditions: { kind: 'flurry' },
    text: `Three goals inside {n} seconds turned this game inside out. Nobody on either bench had time to change the plan.` },
  { id: 'mr.rare.dGoal', conditions: { kind: 'defencemanOtWinner' },
    text: `A defenceman winning it in overtime, {name} pinching on a three-on-three. Bold, and it worked.` },
  { id: 'mr.rare.penalties', conditions: { kind: 'penaltyFest' },
    text: `{n} penalty minutes between them. This one got away from the officials somewhere in the second and never came back.` },
  { id: 'mr.rare.multiOt', conditions: { kind: 'multiOt' },
    text: `Two overtimes. Both teams will feel this one for a week.` },
]

/* ────────────────────────── rare detection ────────────────────────── */

interface RareBeat {
  kind: string
  name: string
  clock: string
  ordinal: string
  n: string
}

const ORDINALS = ['first', 'second', 'third', 'first overtime', 'second overtime', 'third overtime']

function ordinalOf(period: number): string {
  return ORDINALS[Math.min(period, ORDINALS.length) - 1] ?? 'overtime'
}

/**
 * The single most notable low-percentage thing in this game, or null on an
 * ordinary night. Ordered by how rarely each actually happens, so the rarest
 * available beat is the one that gets told.
 */
export function detectRareBeat(inp: MatchReportInput): RareBeat | null {
  const mk = (kind: string, g?: MatchReportGoal, n = ''): RareBeat => ({
    kind,
    name: g?.scorerName ?? '',
    clock: g ? clockOf(g) : '',
    ordinal: g ? ordinalOf(g.period) : '',
    n,
  })

  // A goaltender credited with an assist. Genuinely rare, and delightful.
  const goalieHelper = inp.goals.find((g) => g.assistPositions.includes('G'))
  if (goalieHelper) {
    const idx = goalieHelper.assistPositions.indexOf('G')
    const name = goalieHelper.assistNames[idx] ?? ''
    if (name) return { ...mk('goalieAssist', goalieHelper), name }
  }

  // Four goals by one man.
  const byScorer = new Map<string, MatchReportGoal[]>()
  for (const g of inp.goals) {
    const list = byScorer.get(g.scorerName) ?? []
    list.push(g)
    byScorer.set(g.scorerName, list)
  }
  for (const [name, list] of byScorer) {
    if (list.length >= 4) return { ...mk('fourGoals', list[0]!), name }
  }

  // A defenceman winning it in overtime.
  const otWinner = inp.goals.find((g) => g.period >= 4)
  if (otWinner && otWinner.scorerPosition === 'D') return mk('defencemanOtWinner', otWinner)

  // Multi-overtime (playoffs only produce these).
  if (inp.goals.some((g) => g.period >= 5)) return mk('multiOt')

  // Shorthanded goals.
  const shorties = inp.goals.filter((g) => g.strength === 'sh')
  if (shorties.length >= 2) return mk('shorthandedBoth', shorties[0]!)
  if (shorties.length === 1) return mk('shorthanded', shorties[0]!)

  // Three goals by one side inside two minutes.
  for (let i = 0; i + 2 < inp.goals.length; i++) {
    const a = inp.goals[i]!
    const c = inp.goals[i + 2]!
    const b = inp.goals[i + 1]!
    if (a.period !== c.period || a.byUser !== b.byUser || a.byUser !== c.byUser) continue
    const gap = c.t - a.t
    if (gap >= 0 && gap <= 120) return mk('flurry', a, String(Math.round(gap)))
  }

  // Inside the first minute of the game.
  const opener = inp.goals[0]
  if (opener && opener.period === 1 && opener.t < 60) return mk('openingMinute', opener, String(Math.round(opener.t)))

  // An empty-netter that closed out a one-goal game.
  const empty = inp.goals.find((g) => g.strength === 'en')
  if (empty && Math.abs(inp.userGoals - inp.oppGoals) <= 2) return mk('emptyDagger', empty)

  // A goal in the last ten seconds of a period.
  const buzzer = inp.goals.find((g) => g.period <= 3 && g.t >= 1190)
  if (buzzer) return mk('buzzer', buzzer, String(Math.max(1, Math.round(1200 - buzzer.t))))

  // An ugly night.
  if ((inp.penaltyMinutes ?? 0) >= 60) return mk('penaltyFest', undefined, String(inp.penaltyMinutes))

  return null
}

/* ────────────────────────── assembly ────────────────────────── */

/**
 * The write-up: shape, decider, and — when the game earned one — the rare
 * thing that happened. Empty string is never returned; the shape pool has an
 * unconditional fallback.
 */
export function buildMatchReport(inp: MatchReportInput): string {
  const shape = readShape(inp)
  const g = inp.goalie
  const og = inp.oppGoalie
  const goalieSteal =
    inp.won && g && g.shotsAgainst >= 32 && g.saves / Math.max(1, g.shotsAgainst) >= 0.93 && inp.oppShots > inp.userShots + 5
  const oppSteal =
    !inp.won && og && og.shotsAgainst >= 32 && og.saves / Math.max(1, og.shotsAgainst) >= 0.93 && inp.userShots > inp.oppShots + 5

  const ctx: Record<string, string | number | boolean> = {
    won: inp.won,
    playoff: inp.playoff,
    decidedBy: inp.decidedBy,
    deficit: shape.maxDeficit,
    lead: shape.maxLead,
    margin: shape.margin,
    totalGoals: inp.userGoals + inp.oppGoals,
    goalsAgainst: inp.oppGoals,
    cleanSheet: inp.oppGoals === 0,
    blanked: inp.userGoals === 0,
    neverTrailed: shape.neverTrailed,
    ledFromFirstGoal: shape.ledFromFirstGoal,
    goalieSteal: goalieSteal ? 1 : 0,
    oppGoalieSteal: oppSteal ? 1 : 0,
  }

  const slots: Record<string, string> = {
    us: inp.userAbbr,
    them: inp.oppAbbr,
    ourGoals: String(inp.userGoals),
    theirGoals: String(inp.oppGoals),
    margin: String(shape.margin),
    deficit: String(shape.maxDeficit),
    lead: String(shape.maxLead),
    shots: String(inp.userShots),
    oppShots: String(inp.oppShots),
    goalie: g?.name ?? 'the goaltender',
    saves: String(g?.saves ?? 0),
    shotsAgainst: String(g?.shotsAgainst ?? 0),
    oppGoalie: og?.name ?? 'the other goaltender',
    oppSaves: String(og?.saves ?? 0),
    star: inp.firstStarName ?? '',
    starLine: inp.firstStarLine ?? '',
  }

  const parts: string[] = []
  const shapeV = pickStable(SHAPE_POOL, ctx, `shape|${inp.gameId}`)
  if (shapeV) parts.push(renderTemplate(shapeV.text, slots))

  // The decider, or — when no goal decided it (a shootout, a scoreless
  // regulation) — the first star instead.
  const dec = decisiveScorer(inp)
  if (dec) {
    const decV = pickStable(
      DECIDER_POOL,
      { period: dec.period, pos: dec.scorerPosition, strength: dec.strength },
      `dec|${inp.gameId}`
    )
    if (decV) {
      parts.push(
        renderTemplate(decV.text, {
          scorer: dec.scorerName,
          scorerPoss: possessive(dec.scorerName),
          clock: clockOf(dec),
          ordinal: ordinalOf(dec.period),
        })
      )
    }
  } else if (inp.firstStarName) {
    const starV = pickStable(STAR_POOL, {}, `star|${inp.gameId}`)
    if (starV) parts.push(renderTemplate(starV.text, slots))
  }

  const rare = detectRareBeat(inp)
  if (rare) {
    const rareV = pickStable(RARE_POOL, { kind: rare.kind }, `rare|${inp.gameId}`)
    if (rareV) {
      parts.push(
        renderTemplate(rareV.text, { name: rare.name, namePoss: possessive(rare.name), clock: rare.clock, ordinal: rare.ordinal, n: rare.n })
      )
    }
  }

  return parts.filter((p) => p.trim().length > 0).join(' ')
}
