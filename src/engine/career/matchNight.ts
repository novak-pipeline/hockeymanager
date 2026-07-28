/**
 * Match night (P6, B6.1–B6.3) — the pure presentation logic behind the
 * pregame frame and the postgame receipts for SIMMED user games.
 *
 * Everything here is a deterministic function of real sim state: the keys to
 * the game cite actual special-teams percentages, form and streaks; the turning
 * point is picked from the goals that actually happened; the persistent-moment
 * detector decides what tonight wrote into the World Chronicle. No Rng, no
 * wall-clock — the career layer supplies the facts, this module ranks and
 * phrases them.
 */

import type { MatchKeyView, ThreeStarView, TurningPointView } from './views'

/* ────────────────────────── keys to the game (B6.1) ────────────────────────── */

/** One club's aggregates for key derivation — all real season numbers. */
export interface MatchKeySide {
  abbr: string
  gamesPlayed: number
  goalsFor: number
  goalsAgainst: number
  /** Special teams as 0–1 fractions with sample sizes. */
  ppPct: number
  ppOpportunities: number
  pkPct: number
  timesShorthanded: number
  /** Win/loss streak: +3 = won 3 straight, -2 = lost 2 straight. */
  streak: number
}

export interface MatchKeysArgs {
  user: MatchKeySide
  opp: MatchKeySide
  /** Opponent's most dangerous scorer right now (top points, form-weighted). */
  oppHotScorer: { name: string; goals: number; assists: number; form: number } | null
  /** Projected starters with season save % and recent game-rating average. */
  userGoalie: { name: string; svPct: number; shotsFaced: number; last5Avg: number | null } | null
  oppGoalie: { name: string; svPct: number; shotsFaced: number; last5Avg: number | null } | null
  home: boolean
}

const pct = (f: number): string => `${(f * 100).toFixed(1)}%`
const sv = (f: number): string => `.${Math.round(f * 1000).toString().padStart(3, '0')}`

/**
 * Rank every real, sample-backed delta between the clubs and return the top
 * 2–3 as "keys to the game". Deterministic; every detail cites the numbers it
 * was derived from (asserted by tests).
 */
export function buildMatchKeys(args: MatchKeysArgs): MatchKeyView[] {
  const { user, opp } = args
  const cands: Array<{ score: number; key: MatchKeyView }> = []

  // Special-teams collision: their PP vs our PK (and the reverse) — cite both
  // percentages. Needs a real sample on both sides of the matchup.
  if (opp.ppOpportunities >= 8 && user.timesShorthanded >= 8) {
    const heat = opp.ppPct - (1 - user.pkPct) // + = their PP outruns what our PK concedes
    cands.push({
      score: 2 + Math.abs(heat) * 8 + opp.ppPct * 4,
      key: {
        title: `Their power play vs your kill`,
        detail:
          `${opp.abbr} convert ${pct(opp.ppPct)} of their chances; your penalty kill holds ${pct(user.pkPct)}. ` +
          (opp.ppPct >= 0.22 ? `Stay out of the box — this is where they hurt you.` : `Discipline keeps this a non-factor.`),
      },
    })
  }
  if (user.ppOpportunities >= 8 && opp.timesShorthanded >= 8) {
    cands.push({
      score: 2 + user.ppPct * 6 + (1 - opp.pkPct) * 6,
      key: {
        title: `Your power play vs their kill`,
        detail:
          `Your unit runs at ${pct(user.ppPct)}; ${opp.abbr}'s kill survives ${pct(opp.pkPct)}. ` +
          (opp.pkPct < 0.78 ? `Draw penalties — their kill leaks.` : `Five-on-five may decide it; their kill is stingy.`),
      },
    })
  }

  // The hot hand on the other bench.
  const hs = args.oppHotScorer
  if (hs && (hs.form >= 2 || hs.goals + hs.assists >= 10)) {
    cands.push({
      score: 1.5 + Math.max(0, hs.form) + (hs.goals + hs.assists) / 20,
      key: {
        title: `Contain ${hs.name}`,
        detail:
          `${hs.name} has ${hs.goals} goals and ${hs.assists} assists this season` +
          (hs.form >= 2 ? ` — and he's running hot right now. Hard-match him.` : `. He drives their offense.`),
      },
    })
  }

  // Goalie form, both creases (recent game-rating window over a real sample).
  const g = args.userGoalie
  if (g && g.shotsFaced >= 60 && g.last5Avg !== null) {
    const hot = g.last5Avg >= 7
    const cold = g.last5Avg < 5.5
    if (hot || cold) {
      cands.push({
        score: 1 + Math.abs(g.last5Avg - 6.2),
        key: {
          title: hot ? `${g.name} is standing tall` : `Your crease is shaky`,
          detail:
            `${g.name} carries a ${sv(g.svPct)} save percentage, rating ${g.last5Avg.toFixed(1)} over his last starts. ` +
            (hot ? `He's been the backbone — lean on him.` : `He needs goal support tonight.`),
        },
      })
    }
  }
  const og = args.oppGoalie
  if (og && og.shotsFaced >= 60 && og.last5Avg !== null && (og.last5Avg >= 7 || og.last5Avg < 5.5)) {
    const hot = og.last5Avg >= 7
    cands.push({
      score: 0.9 + Math.abs(og.last5Avg - 6.2),
      key: {
        title: hot ? `Beating ${og.name} won't be easy` : `Test ${og.name} early`,
        detail:
          `${og.name} sits at ${sv(og.svPct)} on the season, rating ${og.last5Avg.toFixed(1)} over his last starts. ` +
          (hot ? `Traffic and second chances — clean looks die in his glove.` : `He's been beatable — shoot from everywhere.`),
      },
    })
  }

  // Streaks — either bench arriving on a run (or a skid).
  if (Math.abs(opp.streak) >= 3) {
    const w = opp.streak > 0
    cands.push({
      score: 0.8 + Math.abs(opp.streak) * 0.4,
      key: {
        title: w ? `${opp.abbr} arrive on a heater` : `${opp.abbr} are wounded`,
        detail: w
          ? `They've won ${opp.streak} straight. Weather the first ten minutes — confidence like that feeds on early goals.`
          : `They've lost ${Math.abs(opp.streak)} in a row. Bury them early before belief creeps back in.`,
      },
    })
  }
  if (Math.abs(user.streak) >= 3) {
    const w = user.streak > 0
    cands.push({
      score: 0.7 + Math.abs(user.streak) * 0.35,
      key: {
        title: w ? `Protect the run` : `Stop the slide`,
        detail: w
          ? `Your club has won ${user.streak} straight — keep the recipe identical: start on time, defend the middle.`
          : `${Math.abs(user.streak)} losses in a row. The first goal tonight is worth double to this room.`,
      },
    })
  }

  // Fallback: the five-on-five margins — always citable once games exist.
  if (user.gamesPlayed >= 3 && opp.gamesPlayed >= 3) {
    const uGf = user.goalsFor / user.gamesPlayed
    const oGa = opp.goalsAgainst / opp.gamesPlayed
    cands.push({
      score: 0.5 + Math.abs(uGf - oGa) * 0.3,
      key: {
        title: `The margins`,
        detail: `You score ${uGf.toFixed(1)} a game; ${opp.abbr} concede ${oGa.toFixed(2)}. ${
          uGf > oGa ? `The chances will be there — finish them.` : `Expect a tight-checking night; special teams may decide it.`
        }`,
      },
    })
  }

  // Opening stretch: nothing sample-backed yet — say so honestly.
  if (cands.length === 0) {
    cands.push({
      score: 1,
      key: {
        title: `No tape yet`,
        detail: `${user.gamesPlayed} games played — no book on either side. ${
          args.home ? `Use home ice: last change and the matchups are yours.` : `On the road, keep the first period simple.`
        }`,
      },
    })
  }

  return cands
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => c.key)
}

/* ────────────────────────── turning point (B6.2) ────────────────────────── */

export interface TurningPointGoal {
  period: number
  /** Seconds elapsed within the period. */
  t: number
  scorerName: string
  byUser: boolean
}

function clockOf(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * The biggest goal of the night by score-state swing: state transitions are
 * weighted (breaking a tie > extending a lead), lateness multiplies, and the
 * eventual game-winner gets a bonus. Ties go to the later goal. Returns null
 * only for a goalless game (shootout decisions cite the SO itself).
 */
export function findTurningPoint(
  goals: TurningPointGoal[],
  won: boolean,
  decidedBy: 'regulation' | 'overtime' | 'shootout'
): TurningPointView | null {
  if (goals.length === 0) return null

  // Identify the game-winning goal (regulation/OT): the goal that put the
  // winning side ahead for good. Under a shootout the score ends level — none.
  let gwgIndex = -1
  if (decidedBy !== 'shootout') {
    let us = 0
    let them = 0
    const finalUs = goals.filter((g) => g.byUser).length
    const finalThem = goals.length - finalUs
    const winnerIsUser = finalUs > finalThem
    for (let i = 0; i < goals.length; i++) {
      if (goals[i]!.byUser) us++
      else them++
      const winnerLeads = winnerIsUser ? us > them : them > us
      if (winnerLeads && gwgIndex === -1) gwgIndex = i
      if (!winnerLeads) gwgIndex = -1
    }
  }

  let best = -1
  let bestScore = -Infinity
  let us = 0
  let them = 0
  for (let i = 0; i < goals.length; i++) {
    const g = goals[i]!
    const before = us - them // user-perspective diff before this goal
    if (g.byUser) us++
    else them++
    const after = us - them
    // Transition weight, from the scoring side's perspective.
    const diffBefore = g.byUser ? before : -before
    let w: number
    if (diffBefore === 0) w = 3 // broke a tie
    else if (diffBefore === -1) w = 2.5 // equalizer
    else if (diffBefore < -1) w = 1.2 // cutting into a deficit
    else if (diffBefore === 1) w = 1.5 // 1 → 2, the insurance goal
    else w = 0.5 // padding
    const lateness = g.period >= 4 ? 3 : g.period === 3 ? 2 : g.period === 2 ? 1.3 : 1
    let score = w * lateness
    if (i === gwgIndex) score += 2
    if (score >= bestScore) {
      // >= : the later of equal swings is the one people remember
      bestScore = score
      best = i
    }
    void after
  }

  const g = goals[best]!
  // Reconstruct the state before the chosen goal for phrasing.
  let u = 0
  let t = 0
  for (let i = 0; i < best; i++) {
    if (goals[i]!.byUser) u++
    else t++
  }
  const scoringSideDiff = g.byUser ? u - t : t - u
  const where = g.period >= 4 ? 'in overtime' : `${clockOf(g.t)} into period ${g.period}`
  const phrase =
    g.period >= 4
      ? `${g.scorerName} ended it in overtime.`
      : best === gwgIndex && scoringSideDiff === 0
        ? `${g.scorerName}'s go-ahead goal ${where} broke the ${u}–${t} tie — the goal that decided it.`
        : scoringSideDiff === 0
          ? `${g.scorerName} broke the ${u}–${t} tie ${where}.`
          : scoringSideDiff === -1
            ? `${g.scorerName}'s equalizer ${where} flipped the night.`
            : scoringSideDiff < -1
              ? `${g.scorerName} started the pushback ${where}, down ${Math.abs(scoringSideDiff)}.`
              : `${g.scorerName}'s insurance goal ${where} put it out of reach.`
  void won
  return { period: g.period, clock: clockOf(g.t), scorerName: g.scorerName, text: phrase }
}

/* ────────────────────────── three stars (B6.2) ────────────────────────── */

export interface RatedGameLine {
  playerId: string
  name: string
  teamAbbr: string
  isGoalie: boolean
  goals: number
  assists: number
  shots: number
  saves: number
  shotsAgainst: number
  /** Game rating 0–10 (same scale the squad screen shows). */
  rating: number
}

function statLineOf(l: RatedGameLine): string {
  if (l.isGoalie) {
    const svp = l.shotsAgainst > 0 ? l.saves / l.shotsAgainst : 0
    return `${l.saves} sv on ${l.shotsAgainst} (${sv(svp)})`
  }
  const parts: string[] = []
  if (l.goals > 0) parts.push(`${l.goals} G`)
  if (l.assists > 0) parts.push(`${l.assists} A`)
  if (parts.length === 0) parts.push(`${l.shots} shots`)
  return parts.join(', ')
}

/** Rank every participant by game rating (points as tiebreak) → three stars. */
export function threeStars(lines: RatedGameLine[]): ThreeStarView[] {
  return [...lines]
    .sort(
      (a, b) =>
        b.rating - a.rating ||
        b.goals + b.assists - (a.goals + a.assists) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 3)
    .map((l) => ({
      playerId: l.playerId,
      name: l.name,
      teamAbbr: l.teamAbbr,
      statLine: statLineOf(l),
      rating: Math.round(l.rating * 10) / 10,
    }))
}

/* ────────────────────────── persistent moment (B6.3) ────────────────────────── */

export interface PersistentMomentArgs {
  won: boolean
  oppAbbr: string
  /** True when tonight carried rivalry heat (gameIntensity factor > 0). */
  rivalry: boolean
  /** User players who scored tonight with ZERO prior NHL goals. */
  firstGoalScorers: Array<{ playerId: string; name: string; age: number }>
  /** The user's goalie tonight (most shots faced). */
  goalie: { playerId: string; name: string; saves: number; shotsAgainst: number } | null
  /** A fight involving one of ours, when one happened. */
  fight: { ourId: string; ourName: string; theirName: string } | null
}

export interface PersistentMoment {
  kind: 'firstGoal' | 'goalieSteal' | 'rivalScrap'
  playerIds: string[]
  /** Chronicle headline — one factual line. */
  headline: string
  /** Receipt storyline — the "this one goes in the books" phrasing. */
  storyline: string
}

/**
 * Decide whether tonight earned a PERSISTENT storyline (B6.3) — one per game,
 * highest priority wins: a first NHL goal outranks a goalie steal outranks a
 * scrap in a rivalry game. Returns null on an ordinary night.
 */
export function detectPersistentMoment(args: PersistentMomentArgs): PersistentMoment | null {
  const fg = args.firstGoalScorers[0]
  if (fg) {
    return {
      kind: 'firstGoal',
      playerIds: [fg.playerId],
      headline: `${fg.name} scores his first NHL goal vs ${args.oppAbbr}`,
      storyline: `${fg.name}, ${fg.age}, buried his first NHL goal tonight — the puck is going in the case. Nights like this get retold.`,
    }
  }
  const g = args.goalie
  if (
    args.won &&
    g &&
    g.shotsAgainst >= 30 &&
    g.saves / g.shotsAgainst >= 0.95
  ) {
    const svp = sv(g.saves / g.shotsAgainst)
    return {
      kind: 'goalieSteal',
      playerIds: [g.playerId],
      headline: `${g.name} steals one vs ${args.oppAbbr} — ${g.saves} of ${g.shotsAgainst} (${svp})`,
      storyline: `${g.name} stopped ${g.saves} of ${g.shotsAgainst} (${svp}) to steal the two points. A performance the room will bring up for months.`,
    }
  }
  const f = args.fight
  if (f && args.rivalry) {
    return {
      kind: 'rivalScrap',
      playerIds: [f.ourId],
      headline: `${f.ourName} drops the gloves with ${f.theirName} as tempers boil vs ${args.oppAbbr}`,
      storyline: `${f.ourName} answered the bell against ${f.theirName} — bad blood with ${args.oppAbbr} just got worse, and nobody in either room will forget it.`,
    }
  }
  return null
}
