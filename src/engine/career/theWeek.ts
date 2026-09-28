/**
 * THE WEEK — the season's week-to-week rhythm (depth audit §3, "one more week").
 *
 * A hockey season is lived a week at a time: who we play, how hard we skate
 * between games, what the coach thinks, and what the week is ABOUT. This module
 * is the pure half of that: the practice LOAD model (a real lever with real
 * costs), the staff's default call, the race arithmetic (magic and tragic
 * numbers), the weekly staff read and the week's storyline.
 *
 * Pure: the career layer supplies facts and applies the effects. Nothing here
 * stops Continue — the week is an agenda on the dashboard, never a gate.
 */

/* ───────────────────────── the practice load ───────────────────────── */

/** How hard the club skates on the days without a game this week. */
export type WeekLoad = 'push' | 'standard' | 'light'

export interface WeekLoadSpec {
  label: string
  /** Fatigue points added to each healthy player per training day (negative
   *  = extra recovery). Fatigue already drives in-game legs and injury risk. */
  fatiguePerDay: number
  /** Multiplier on in-season development for the club's players, averaged
   *  over the training days since the last development pass. */
  devMult: number
  /** One line for the dashboard: what it costs and what it buys. */
  effect: string
}

export const WEEK_LOADS: Record<WeekLoad, WeekLoadSpec> = {
  push: {
    label: 'Push',
    fatiguePerDay: 1.2,
    devMult: 1.15,
    effect: 'Hard practices: faster development, heavier legs and a higher injury risk.',
  },
  standard: {
    label: 'Standard',
    fatiguePerDay: 0,
    devMult: 1,
    effect: 'The normal rhythm: game-day skates and a real practice in between.',
  },
  light: {
    label: 'Light',
    fatiguePerDay: -1.5,
    devMult: 0.88,
    effect: 'Optional skates and rest: fresher legs, slower development.',
  },
}

export const WEEK_LOAD_ORDER: readonly WeekLoad[] = ['push', 'standard', 'light']

/**
 * The staff's call for a week, from its schedule and the room's legs. A crowded
 * week (four games, or a back-to-back on tired legs) is a light week; a quiet
 * one on fresh legs is a chance to work. Everything else is standard.
 *
 * This is what a delegating GM gets every week, so it must be a sound default:
 * it never pushes a tired room and never rests a fresh one into softness.
 */
export function staffWeekLoad(args: {
  games: number
  backToBacks: number
  /** Mean fatigue (0–100) of the dressed roster. */
  avgFatigue: number
}): { load: WeekLoad; why: string } {
  const { games, backToBacks, avgFatigue } = args
  if (games >= 4 || (backToBacks > 0 && avgFatigue >= 25) || avgFatigue >= 40) {
    return {
      load: 'light',
      why: games >= 4
        ? `${games} games in seven days — the legs matter more than the drills.`
        : backToBacks > 0
          ? 'A back-to-back on tired legs. We skate light and save it for the games.'
          : 'The room is carrying real fatigue. We back off before something breaks.',
    }
  }
  if (games <= 2 && avgFatigue < 22) {
    return { load: 'push', why: `Only ${games === 0 ? 'no games' : games === 1 ? 'one game' : 'two games'} and fresh legs — a week to get some work in.` }
  }
  return { load: 'standard', why: 'A normal week. Game-day skates and one real practice.' }
}

/** A back-to-back = games on consecutive days. `days` are sorted day indices. */
export function countBackToBacks(days: readonly number[]): number {
  let n = 0
  for (let i = 1; i < days.length; i++) if (days[i]! - days[i - 1]! === 1) n++
  return n
}

/* ───────────────────────── the race ───────────────────────── */

/**
 * The magic and tragic numbers against the cut line, the way a newspaper
 * prints them (points, not wins, because the standings are points).
 *
 *  - magic: how many points of (our gains + the chaser's dropped points) it
 *    takes before the first team out can no longer catch us. Shown while we
 *    hold a spot.
 *  - tragic: how many points of (our dropped points + the last team in's
 *    gains) before we can no longer catch them. Shown while we chase.
 *
 * An honest simplification — it looks at the ONE club on the other side of
 * the line, not every permutation. The mathematical clinch / elimination is
 * decided separately and soundly; these numbers are the countdown to it.
 */
export function raceNumbers(args: {
  inSpot: boolean
  userPts: number
  userGamesLeft: number
  /** The club on the other side of the line: first out when we are in, last in when we are out. */
  rivalPts: number
  rivalGamesLeft: number
}): { magic?: number; tragic?: number } {
  const { inSpot, userPts, userGamesLeft, rivalPts, rivalGamesLeft } = args
  if (inSpot) {
    const magic = rivalPts + 2 * rivalGamesLeft - userPts + 1
    return { magic: Math.max(0, magic) }
  }
  const tragic = userPts + 2 * userGamesLeft - rivalPts + 1
  return { tragic: Math.max(0, tragic) }
}

/* ───────────────────────── the staff read ───────────────────────── */

export interface StaffReadFacts {
  coachName: string
  /** Last week's results: W / L / O per game, oldest first. */
  lastWeek: Array<'W' | 'L' | 'O'>
  /** The club's best performer over the last week, if anyone stood out. */
  standout?: { name: string; pts: number; gp: number } | undefined
  /** The most worn player, when someone is genuinely tired. */
  tiredest?: { name: string; fatigue: number } | undefined
  injuredCount: number
  load: WeekLoad
  gamesAhead: number
  /** Conference race summary, when the season is far enough along. */
  race?: { inSpot: boolean; gap: number } | undefined
}

/**
 * The head coach's weekly read: three or four plain lines, in his voice,
 * grounded in facts the GM can check. Not a meeting — a note on the board.
 */
export function buildStaffRead(f: StaffReadFacts): { coach: string; lines: string[] } {
  const lines: string[] = []
  const w = f.lastWeek.filter((r) => r === 'W').length
  const l = f.lastWeek.filter((r) => r === 'L').length
  const o = f.lastWeek.filter((r) => r === 'O').length
  const n = f.lastWeek.length
  if (n === 0) lines.push('No games last week. The work was all on the practice ice.')
  else if (w === n) lines.push(`${n} for ${n} last week. I'll take it, and I'll be the one reminding them it gets harder.`)
  else if (w === 0) lines.push(`${n === 1 ? 'The one game' : `All ${n} games`} got away from us last week (${w}-${l}-${o}). I want to see the response, not hear about it.`)
  else if (w > l + o) lines.push(`A good week (${w}-${l}-${o}). Not perfect, but we controlled most of the games.`)
  else lines.push(`A mixed week (${w}-${l}-${o}). There were stretches I liked and stretches I'll be showing them on video.`)

  if (f.standout && f.standout.pts >= 3) lines.push(`${f.standout.name} was our best player: ${f.standout.pts} points in ${f.standout.gp}. He's driving it right now.`)
  if (f.tiredest && f.tiredest.fatigue >= 45) lines.push(`${f.tiredest.name} is running on fumes (fatigue ${Math.round(f.tiredest.fatigue)}). I'd like to manage his minutes.`)
  if (f.injuredCount >= 3) lines.push(`${f.injuredCount} men in the treatment room. Depth is getting tested.`)

  const plan =
    f.load === 'light' ? `${f.gamesAhead} game${f.gamesAhead === 1 ? '' : 's'} this week, so we keep practice light and save the legs.`
    : f.load === 'push' ? `A lighter schedule this week (${f.gamesAhead} game${f.gamesAhead === 1 ? '' : 's'}). I want to use it and put some real work in.`
    : `${f.gamesAhead} game${f.gamesAhead === 1 ? '' : 's'} this week. Normal rhythm.`
  lines.push(plan)
  if (f.race && Math.abs(f.race.gap) <= 4) {
    lines.push(f.race.inSpot
      ? `We're ${f.race.gap === 0 ? 'level with' : `${f.race.gap} clear of`} the line. That's not a cushion, that's a coin.`
      : `${Math.abs(f.race.gap)} back of a spot. Every game this week counts double.`)
  }
  return { coach: f.coachName, lines: lines.slice(0, 4) }
}

/* ───────────────────────── the storyline ───────────────────────── */

export interface StorylineCandidate {
  /** Higher wins. */
  priority: number
  title: string
  text: string
}

/** The one thing the week is about: the highest-priority candidate. */
export function pickStoryline(cands: readonly StorylineCandidate[]): StorylineCandidate | null {
  let best: StorylineCandidate | null = null
  for (const c of cands) if (!best || c.priority > best.priority) best = c
  return best
}
