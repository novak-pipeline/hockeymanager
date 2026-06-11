/**
 * Media Expectations — preseason power rankings, mid-season checkpoints, and
 * season-end verdict. The source of "surprise" in the story layer: surprise only
 * exists if something on record predicted otherwise.
 *
 * Design rules:
 *   - Pure functions, no side effects, no wall-clock, no unseeded randomness.
 *   - All randomness via the seeded Rng passed as an argument.
 *   - Returns news-seed objects; the career layer pushes them.
 *   - JSON-safe: no Maps, no classes, no functions in state.
 *   - Ruleset-aware: draft/trade-deadline presence is NOT assumed; callers supply
 *     any ruleset-specific facts as arguments.
 */

import type { Rng } from '@engine/shared/rng'
import type { NewsCategory } from '@domain/news'

/* ────────────────────────── public types ────────────────────────── */

/** Serializable state; embedded as an optional field in CareerSnapshot. */
export interface ExpectationsState {
  /** Season year this state belongs to. */
  year: number
  /** One entry per team, ordered by predictedRank ascending. */
  preseason: Array<{
    teamId: string
    predictedRank: number
    /** One-liner used in power-rankings blurb, e.g. "Loaded roster, title contender." */
    blurb: string
  }>
  /**
   * Keys that have already been emitted so we never fire the same story twice.
   * Format: `<teamId>:<checkpoint>` e.g. "t3:q1" | "t3:half" | "t3:q3" | "t3:final"
   */
  emittedKeys: string[]
}

/** Minimal team descriptor for ranking calculations. */
export interface TeamDescriptor {
  teamId: string
  name: string
  abbr: string
  /** Mean composite overall of the roster (0–100). */
  strength: number
  /** Where this team finished last season (1 = best). Absent for expansion/unknown. */
  lastYearRank?: number
}

/** A news item seed returned by this module. The career layer stamps id/day/year/read. */
export interface NewsSeed {
  category: NewsCategory
  headline: string
  body: string
  teamId?: string
}

/* ────────────────────────── internal blurb templates ────────────────────────── */

const CHAMPION_BLURBS: ReadonlyArray<string> = [
  'The analytics back it up: this is the team to beat.',
  'On paper, the best roster in the league heading into the season.',
  'Depth up and down the lineup — every forecaster agrees they are the favourite.',
  'When strength ratings say this clearly, you listen.',
  'Consensus No. 1 and it is hard to argue otherwise.',
]

const DARK_HORSE_BLURBS: ReadonlyArray<string> = [
  'Flying under the radar, but the pieces are quietly in place.',
  'Do not sleep on this group — they are better than their seeding suggests.',
  'Ranked lower than they should be: the dark horse of the season.',
  'A team that tends to outperform expectations every year.',
  'The sleeper pick — if things click, watch out.',
]

const BASEMENT_BLURBS: ReadonlyArray<string> = [
  'A rebuild in progress; patience is the word from management.',
  'Projections suggest a long season ahead.',
  'Talent thin up and down the roster.',
  'A season to develop prospects rather than chase points.',
  'It will take more than hope to turn this season around.',
]

const MIDDLE_BLURBS: ReadonlyArray<string> = [
  'Solid middle-of-the-pack outfit with playoff potential.',
  'Enough talent to compete, not quite enough to contend.',
  'A team that will make or break its season on special teams.',
  'Respectable on paper; the question is consistency.',
  'Quietly capable — the kind of team that beats the teams above it.',
  'Playoff bubble territory: every point matters.',
]

/* ────────────────────────── ranking helpers ────────────────────────── */

/**
 * Convert strength + lastYearRank to a blended score for initial sorting.
 * Higher score = better projected team.
 *
 * strength contributes 70 %, lastYearRank contributes 30 % (inverted so rank 1
 * is best). When lastYearRank is absent we fall back to the strength signal only.
 */
function blendScore(
  strength: number,
  lastYearRank: number | undefined,
  totalTeams: number,
): number {
  const strengthScore = strength // 0–100, higher is better
  if (lastYearRank === undefined) {
    return strengthScore
  }
  // Normalise rank so 1st → 100, last → 0
  const rankScore = ((totalTeams - lastYearRank) / Math.max(1, totalTeams - 1)) * 100
  return 0.7 * strengthScore + 0.3 * rankScore
}

function pickBlurb(rng: Rng, pool: ReadonlyArray<string>): string {
  return pool[rng.int(pool.length)]
}

/* ────────────────────────── buildPreseasonOdds ────────────────────────── */

export function buildPreseasonOdds(args: {
  teams: TeamDescriptor[]
  year: number
  rng: Rng
}): { state: ExpectationsState; newsSeeds: NewsSeed[] } {
  const { teams, year, rng } = args
  const n = teams.length

  // Blend scores + small gaussian noise so rankings are not perfectly deterministic.
  const scored = teams.map((t) => ({
    ...t,
    score: blendScore(t.strength, t.lastYearRank, n) + rng.normal(0, 2),
  }))

  // Sort descending: highest score = rank 1.
  scored.sort((a, b) => b.score - a.score)

  // Assign ranks and blurbs.
  const preseason = scored.map((t, i) => {
    const rank = i + 1
    let blurb: string
    if (rank === 1) {
      blurb = pickBlurb(rng, CHAMPION_BLURBS)
    } else if (rank === n) {
      blurb = pickBlurb(rng, BASEMENT_BLURBS)
    } else {
      blurb = pickBlurb(rng, MIDDLE_BLURBS)
    }
    return { teamId: t.teamId, predictedRank: rank, blurb }
  })

  const state: ExpectationsState = { year, preseason, emittedKeys: [] }

  // Dark horse: a team ranked mid-table (roughly 40–65 % of the list) that got
  // bumped a bit higher than its blend score would suggest (i.e. good noise).
  // We define it as the team whose actual predictedRank is lowest (worst) among
  // teams whose blend score is above median — meaning they tested better than
  // their underlying score, making them the "lucky" mid-tier pick.
  const midLo = Math.floor(n * 0.35)
  const midHi = Math.floor(n * 0.65)
  // midRange is the slice by predictedRank (1-based) that counts as "mid-table".
  const midTeams = preseason.filter(
    (p) => p.predictedRank > midLo && p.predictedRank <= midHi,
  )
  // Pick the mid-table team with the best blend score (most likely to be the dark horse).
  const midScoredMap = new Map(scored.map((t) => [t.teamId, t.score]))
  midTeams.sort(
    (a, b) => (midScoredMap.get(b.teamId) ?? 0) - (midScoredMap.get(a.teamId) ?? 0),
  )
  const darkHorse = midTeams.length > 0 ? midTeams[0] : null

  // Override the dark horse blurb in state.
  if (darkHorse !== null) {
    const dh = preseason.find((p) => p.teamId === darkHorse.teamId)
    if (dh !== undefined) {
      dh.blurb = pickBlurb(rng, DARK_HORSE_BLURBS)
    }
  }

  const champion = preseason[0]
  const basement = preseason[n - 1]

  const darkHorseTeam = darkHorse !== null ? teams.find((t) => t.teamId === darkHorse.teamId) : null
  const championTeam = teams.find((t) => t.teamId === champion.teamId)
  const basementTeam = teams.find((t) => t.teamId === basement.teamId)

  const projectedChampionName = championTeam?.name ?? champion.teamId
  const darkHorseName = darkHorseTeam?.name ?? darkHorse?.teamId ?? 'an unnamed club'
  const basementName = basementTeam?.name ?? basement.teamId

  const headline = `${year} Power Rankings: ${projectedChampionName} top the preseason projections`

  const darkHorseLine =
    darkHorse !== null
      ? ` Our dark horse: ${darkHorseName} at No. ${darkHorse.predictedRank}, capable of outrunning their seed.`
      : ''

  const body =
    `The ${year} season is upon us. Our analysts have crunched the numbers and ` +
    `${projectedChampionName} emerge as the clear favourite to claim the title. ` +
    `${preseason[0].blurb}` +
    darkHorseLine +
    ` At the other end, ${basementName} face an uphill battle — projected last in the league.`

  const newsSeeds: NewsSeed[] = [
    {
      category: 'league',
      headline,
      body,
      teamId: champion.teamId,
    },
  ]

  return { state, newsSeeds }
}

/* ────────────────────────── checkExpectations ────────────────────────── */

/** Checkpoint labels used in emittedKeys. */
type Checkpoint = 'q1' | 'half' | 'q3'

/** Game counts that define each checkpoint (team games played crossing these). */
const CHECKPOINT_THRESHOLDS: ReadonlyArray<{ key: Checkpoint; threshold: number }> = [
  { key: 'q1',   threshold: 15 },
  { key: 'half', threshold: 30 },
  { key: 'q3',   threshold: 45 },
]

const OVERACHIEVER_HEADLINES: ReadonlyArray<string> = [
  '{name} defying expectations — and it might be for real',
  '{name} outperforming predictions midway through the season',
  'Surprise package: {name} climbing the table',
  '{name} making forecasters eat their words',
]

const UNDERACHIEVER_HEADLINES: ReadonlyArray<string> = [
  '{name} struggling to meet preseason expectations',
  'What went wrong? {name} lagging behind projections',
  '{name} underperforming — is it time for a change?',
  'The gap widens: {name} not living up to the hype',
]

const OVERACHIEVER_BODIES: ReadonlyArray<string> = [
  'Predicted {predicted}, sitting at {actual}. Something is clicking for this group and the standings show it.',
  'The analysts had {name} at {predicted}. The players clearly disagreed — they sit {actual} right now.',
  'Ranked {predicted} in the preseason. Currently {actual}. Hard to argue with results.',
  '{name} were not supposed to be here at this point. Yet here they are, proving the projections wrong.',
]

const UNDERACHIEVER_BODIES: ReadonlyArray<string> = [
  'Projected {predicted} preseason. Currently {actual}. A gap that the coaching staff will need to explain.',
  'High expectations, disappointing results. {name} sit {actual} — they were meant to be {predicted}.',
  'The preseason optimism has faded. {name} projected {predicted}, currently {actual}.',
  'Something is not working for {name}. Ranked {actual} when everyone expected {predicted}.',
]

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`)
}

export function checkExpectations(args: {
  state: ExpectationsState
  standings: Array<{ teamId: string; name: string; abbr: string; rank: number; gamesPlayed: number }>
  day: number
  year: number
  rng: Rng
}): { newsSeeds: NewsSeed[] } {
  const { state, standings, rng } = args
  const newsSeeds: NewsSeed[] = []

  for (const team of standings) {
    for (const cp of CHECKPOINT_THRESHOLDS) {
      if (team.gamesPlayed < cp.threshold) continue

      const key = `${team.teamId}:${cp.key}`
      if (state.emittedKeys.includes(key)) continue

      const predicted = expectedRankOf(state, team.teamId)
      if (predicted === undefined) continue

      const diff = predicted - team.rank // positive = doing better than predicted
      const isOverachiever = diff >= 5
      const isUnderachiever = diff <= -5

      if (!isOverachiever && !isUnderachiever) {
        // Mark as seen so we do not re-check once crossed — avoids repeated no-ops.
        state.emittedKeys.push(key)
        continue
      }

      state.emittedKeys.push(key)

      const vars: Record<string, string> = {
        name: team.name,
        predicted: ordinal(predicted),
        actual: ordinal(team.rank),
        abbr: team.abbr,
      }

      if (isOverachiever) {
        const headlineTemplate = rng.pick(OVERACHIEVER_HEADLINES)
        const bodyTemplate = rng.pick(OVERACHIEVER_BODIES)
        newsSeeds.push({
          category: 'league',
          headline: fillTemplate(headlineTemplate, vars),
          body: fillTemplate(bodyTemplate, vars),
          teamId: team.teamId,
        })
      } else {
        const headlineTemplate = rng.pick(UNDERACHIEVER_HEADLINES)
        const bodyTemplate = rng.pick(UNDERACHIEVER_BODIES)
        newsSeeds.push({
          category: 'league',
          headline: fillTemplate(headlineTemplate, vars),
          body: fillTemplate(bodyTemplate, vars),
          teamId: team.teamId,
        })
      }
    }
  }

  return { newsSeeds }
}

/* ────────────────────────── seasonVerdict ────────────────────────── */

const CALLED_IT_HEADLINES: ReadonlyArray<string> = [
  'We called it: {name} end the season as projected champions',
  'The forecasters were right — {name} deliver exactly what was promised',
  '{name} deliver on every preseason promise',
  'No surprises from the top: {name} were always going to win this',
]

const CROW_HEADLINES: ReadonlyArray<string> = [
  'Eating crow: the preseason favourite was not {predictedChampion}',
  '{champion} come from nowhere — nobody predicted this',
  'The analysts got it wrong: {champion} are champions, not {predictedChampion}',
  'A season that made a mockery of the preseason rankings',
]

const TEAM_RECAP_OVER: ReadonlyArray<string> = [
  'Predicted {predicted}, finished {actual} — a season to remember.',
  'Nobody saw {actual} coming after a {predicted} preseason projection.',
]

const TEAM_RECAP_UNDER: ReadonlyArray<string> = [
  'Predicted {predicted}, finished {actual} — a disappointing campaign.',
  'The preseason hype was real; the results were not. {predicted} to {actual}.',
]

const TEAM_RECAP_MATCH: ReadonlyArray<string> = [
  'Predicted {predicted}, finished {actual} — right on the money.',
  'Projected {predicted} and delivered exactly that.',
]

export function seasonVerdict(args: {
  state: ExpectationsState
  finalStandings: Array<{ teamId: string; name: string; abbr: string; rank: number }>
  championTeamId: string
  year: number
  rng: Rng
}): { newsSeeds: NewsSeed[] } {
  const { state, finalStandings, championTeamId, year, rng } = args
  const newsSeeds: NewsSeed[] = []

  const predictedChampionEntry = state.preseason.find((p) => p.predictedRank === 1)
  const predictedChampionId = predictedChampionEntry?.teamId

  const championEntry = finalStandings.find((t) => t.teamId === championTeamId)
  const championName = championEntry?.name ?? championTeamId

  const predictedChampionTeam = finalStandings.find((t) => t.teamId === predictedChampionId)
  const predictedChampionName = predictedChampionTeam?.name ?? predictedChampionId ?? 'the preseason favourite'

  const weCalledIt = predictedChampionId === championTeamId

  let headline: string
  let body: string

  const vars: Record<string, string> = {
    champion: championName,
    predictedChampion: predictedChampionName,
    year: String(year),
  }

  if (weCalledIt) {
    const headlineTemplate = rng.pick(CALLED_IT_HEADLINES)
    headline = fillTemplate(headlineTemplate, { name: championName, ...vars })

    // Build per-team recap lines for the notable surprises.
    const surprises = buildSurpriseLines(state, finalStandings, rng, 3)
    body =
      `${championName} were the preseason pick and they delivered. ` +
      `${predictedChampionEntry?.blurb ?? ''} ` +
      (surprises.length > 0
        ? `Elsewhere, the season had its share of surprises: ${surprises.join(' ')}`
        : `A season that went largely according to script.`)
  } else {
    const headlineTemplate = rng.pick(CROW_HEADLINES)
    headline = fillTemplate(headlineTemplate, vars)

    const predictedActualRank = finalStandings.find((t) => t.teamId === predictedChampionId)?.rank
    const predictedActualLine =
      predictedActualRank !== undefined
        ? ` ${predictedChampionName}, the preseason favourite, finished ${ordinal(predictedActualRank)}.`
        : ''

    const surprises = buildSurpriseLines(state, finalStandings, rng, 3)
    body =
      `Few predicted ${championName} would lift the trophy. ` +
      predictedActualLine +
      ` The rankings got this one badly wrong.` +
      (surprises.length > 0 ? ` Other storylines: ${surprises.join(' ')}` : '')
  }

  newsSeeds.push({
    category: 'league',
    headline,
    body,
    teamId: championTeamId,
  })

  return { newsSeeds }
}

/** Build up to `limit` notable per-team lines where prediction vs reality diverged. */
function buildSurpriseLines(
  state: ExpectationsState,
  finalStandings: Array<{ teamId: string; name: string; abbr: string; rank: number }>,
  rng: Rng,
  limit: number,
): string[] {
  const lines: string[] = []
  for (const entry of state.preseason) {
    if (lines.length >= limit) break
    const actual = finalStandings.find((t) => t.teamId === entry.teamId)
    if (actual === undefined) continue
    const diff = entry.predictedRank - actual.rank
    if (Math.abs(diff) < 5) continue

    const vars: Record<string, string> = {
      name: actual.name,
      predicted: ordinal(entry.predictedRank),
      actual: ordinal(actual.rank),
    }

    let template: string
    if (diff >= 5) {
      template = rng.pick(TEAM_RECAP_OVER)
    } else {
      template = rng.pick(TEAM_RECAP_UNDER)
    }
    lines.push(fillTemplate(template, vars))
  }
  return lines
}

/* ────────────────────────── expectedRankOf ────────────────────────── */

/**
 * Return the preseason predicted rank for a team, or undefined if the team was
 * not ranked (e.g. expansion team added mid-career).
 *
 * Exported for the arc engine's cinderella/collapse detectors.
 */
export function expectedRankOf(state: ExpectationsState, teamId: string): number | undefined {
  return state.preseason.find((p) => p.teamId === teamId)?.predictedRank
}
