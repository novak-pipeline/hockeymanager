/**
 * Arc Engine — ongoing storylines as first-class state.
 *
 * This is the spine that kills repetitive-news-feed syndrome. Instead of
 * emitting a news item every time something happens, the arc engine tracks
 * multi-game narratives (hot streaks, cinderella runs, rookie races, etc.) and
 * only fires news at meaningful story beats: arc creation, escalation past a
 * tension threshold, and resolution.
 *
 * Design constraints:
 *  - JSON-safe state (no Maps / classes / functions) — embeds in CareerSnapshot.
 *  - All randomness via seeded Rng — no Math.random, no wall-clock.
 *  - Ruleset-aware: draft/trade-deadline existence taken as arguments, not
 *    hardcoded. Pass seasonLength from the caller.
 *  - Returns NewsSeed objects; never pushes news itself.
 *  - Cap at MAX_LIVE_ARCS; evict lowest-tension resolved arcs first.
 */

import type { NewsCategory } from '@domain'
import type { Rng } from '@engine/shared/rng'

/* ─────────────────────────── public types ─────────────────────────── */

export type ArcKind =
  | 'hotStreak'
  | 'coldSpell'
  | 'breakoutSeason'
  | 'bustWatch'
  | 'milestoneWatch'
  | 'feud'
  | 'mentorship'
  | 'tradeRumor'
  | 'contractStandoff'
  | 'cinderellaTeam'
  | 'collapseTeam'
  | 'goalieDuel'
  | 'rookieRace'

export interface ArcBeat {
  day: number
  year: number
  /** One factual line referencing what happened. */
  summary: string
}

export interface Arc {
  id: string
  kind: ArcKind
  actors: {
    playerIds: string[]
    teamIds: string[]
  }
  /** 0–100. Rises as story escalates; drops on resolution. */
  tension: number
  startedDay: number
  startedYear: number
  beats: ArcBeat[]
  status: 'building' | 'peak' | 'resolved'
  /** Human-readable resolution note, set when status becomes 'resolved'. */
  resolution?: string
}

/** Full arcs state — JSON-safe, goes into CareerSnapshot as optional field. */
export interface ArcsState {
  arcs: Arc[]
  /** Monotonically increasing; used to generate stable arc IDs. */
  counter: number
}

/**
 * A news seed returned by tickArcs. The career layer converts these to
 * NewsItem objects (assigning IDs, marking unread, etc.) and pushes them into
 * the inbox. Never pushed here.
 */
export interface NewsSeed {
  category: NewsCategory
  headline: string
  body: string
  playerId?: string
  teamId?: string
}

/**
 * Per-match-day fact bundle supplied by the career layer to the arc engine.
 *
 * Design: the career already holds all the data; this interface just says
 * which fields the arc engine needs.  The caller populates it after resolving
 * all match results for the day, then calls tickArcs().
 */
export interface ArcInputs {
  day: number
  year: number
  /** Total match days in the regular season — for "late season" checks. */
  seasonLength: number
  /** Results for every game played on this match day. */
  results: Array<{
    teamId: string
    oppId: string
    won: boolean
    goalsFor: number
    goalsAgainst: number
  }>
  /** Per-player line scores for today's games. */
  playerLines: Array<{
    playerId: string
    teamId: string
    goals: number
    assists: number
    points: number
    /** True for forwards playing >=10 minutes — filters "expected producers". */
    isForward: boolean
    /** True when this is a rookie (first full NHL season). */
    isRookie: boolean
    /**
     * Number of consecutive games (including today) in which this player
     * has scored at least one point.  Provided by the career layer when it
     * tracks per-player streaks.  Required for hotStreak new-arc detection.
     */
    consecutivePointGames?: number
    /**
     * Number of consecutive games (including today) this forward has gone
     * without a point.  Required for coldSpell new-arc detection.
     */
    scorelessStreak?: number
  }>
  /** How each team's rank shifted (negative = improved). */
  standingsDelta: Array<{
    teamId: string
    rank: number
    prevRank: number
    /** Pre-season projection; used for cinderella/collapse detection. */
    expectedRank?: number
  }>
  /**
   * Season-to-date totals for a player.
   * The arc engine calls this lazily; the career passes a closure that reads
   * from its playerTotals map.
   */
  seasonTotals: (playerId: string) => {
    goals: number
    assists: number
    points: number
    gamesPlayed: number
  }
  /**
   * Career totals (all seasons combined) — used for milestone detection.
   * Optional: if absent, milestoneWatch arcs are not created.
   */
  careerTotals?: (playerId: string) => {
    goals: number
    points: number
    gamesPlayed: number
  }
  /**
   * Expected-production baseline for breakout/bust detection.
   * Optional: if absent those detectors are skipped.
   */
  expectedPoints?: (playerId: string) => number | undefined

  /** Per-player name lookup (for headline text). */
  playerName: (playerId: string) => string
  /** Per-team name lookup. */
  teamName: (teamId: string) => string
}

/* ─────────────────────────── constants ─────────────────────────── */

/** Hard cap on live arcs to keep state size bounded. */
const MAX_LIVE_ARCS = 24

/** Tension thresholds that trigger escalation news. */
const TENSION_THRESHOLD_MID = 40
const TENSION_THRESHOLD_HIGH = 70

/* ─────────────────────────── helpers ─────────────────────────── */

function makeId(counter: number): string {
  return `arc${counter}`
}

function addBeat(arc: Arc, day: number, year: number, summary: string): void {
  arc.beats.push({ day, year, summary })
}

/**
 * Clamp tension to [0, 100] and promote status:
 *   tension > 70 → 'peak'
 *   tension > 0  → 'building'
 */
function setTension(arc: Arc, t: number): void {
  arc.tension = Math.max(0, Math.min(100, t))
  if (arc.status !== 'resolved') {
    arc.status = arc.tension >= TENSION_THRESHOLD_HIGH ? 'peak' : 'building'
  }
}

/** Evict arcs to stay under MAX_LIVE_ARCS cap. Resolved + lowest-tension go first. */
function enforceCapInPlace(state: ArcsState): void {
  if (state.arcs.length <= MAX_LIVE_ARCS) return

  // Sort: resolved first, then by tension ascending within each status group.
  state.arcs.sort((a, b) => {
    const statusScore = (s: Arc['status']): number =>
      s === 'resolved' ? 0 : s === 'building' ? 1 : 2
    const ss = statusScore(a.status) - statusScore(b.status)
    if (ss !== 0) return ss
    return a.tension - b.tension
  })

  state.arcs = state.arcs.slice(state.arcs.length - MAX_LIVE_ARCS)
}

/* ─────────────────────────── public initializer ─────────────────────────── */

export function createInitialArcsState(): ArcsState {
  return { arcs: [], counter: 0 }
}

/* ─────────────────────────── external arc management helpers ─────────────────────────── */

/**
 * Create an arc externally (locker-room, tentpole, trade-rumor modules).
 * Returns the new Arc so callers can reference its id.
 */
export function createArc(
  state: ArcsState,
  kind: ArcKind,
  actors: Arc['actors'],
  summary: string,
  day: number,
  year: number,
): Arc {
  state.counter += 1
  const arc: Arc = {
    id: makeId(state.counter),
    kind,
    actors,
    tension: 30,
    startedDay: day,
    startedYear: year,
    beats: [{ day, year, summary }],
    status: 'building',
  }
  state.arcs.push(arc)
  enforceCapInPlace(state)
  return arc
}

/** Add a beat and adjust tension. */
export function escalateArc(
  state: ArcsState,
  arcId: string,
  beatSummary: string,
  tensionDelta: number,
  day: number,
  year: number,
): Arc | undefined {
  const arc = state.arcs.find(a => a.id === arcId)
  if (!arc || arc.status === 'resolved') return undefined
  addBeat(arc, day, year, beatSummary)
  setTension(arc, arc.tension + tensionDelta)
  return arc
}

/** Mark an arc resolved; sets resolution text and freezes tension. */
export function resolveArc(
  state: ArcsState,
  arcId: string,
  beatSummary: string,
  day: number,
  year: number,
): Arc | undefined {
  const arc = state.arcs.find(a => a.id === arcId)
  if (!arc || arc.status === 'resolved') return undefined
  addBeat(arc, day, year, beatSummary)
  arc.status = 'resolved'
  arc.resolution = beatSummary
  return arc
}

/* ─────────────────────────── ordinal helper ─────────────────────────── */

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/* ─────────────────────────── detector: hot streak ─────────────────────────── */

/**
 * hotStreak: a player has recorded a point in 4 or more consecutive games.
 *  - Created at 4-game mark.
 *  - Escalates (news) each time tension crosses 40/70.
 *  - Resolved when the player goes scoreless.
 */
function detectHotStreak(
  state: ArcsState,
  inputs: ArcInputs,
  seeds: NewsSeed[],
): void {
  // Build per-player game-by-game point flags from today's lines.
  const scorersToday = new Set(
    inputs.playerLines
      .filter(pl => pl.points > 0)
      .map(pl => pl.playerId),
  )

  // Find existing hotStreak arcs.
  const existing = state.arcs.filter(
    a => a.kind === 'hotStreak' && a.status !== 'resolved',
  )

  const handled = new Set<string>()

  for (const arc of existing) {
    const pid = arc.actors.playerIds[0]
    if (!pid) continue
    handled.add(pid)

    if (!scorersToday.has(pid)) {
      // Streak broken — resolve. Only a genuinely long run earns a "snapped"
      // story; quiet resolution otherwise keeps the feed signal-dense.
      const streak = arc.beats.length
      const name = inputs.playerName(pid)
      const summary = `Streak ends at ${streak} games`
      addBeat(arc, inputs.day, inputs.year, summary)
      arc.status = 'resolved'
      arc.resolution = summary
      if (streak >= 7) {
        seeds.push({
          category: 'league',
          headline: `${name}'s ${streak}-game point streak snapped`,
          body: `${name} went scoreless today, ending a ${streak}-game run. The streak had put them among the league's hottest players over that span.`,
          playerId: pid,
        })
      }
    } else {
      // Streak continues.
      const streak = arc.beats.length + 1
      const totals = inputs.seasonTotals(pid)
      const summary = `${ordinal(streak)} straight game with a point`
      addBeat(arc, inputs.day, inputs.year, summary)

      const prevTension = arc.tension
      // Tension climbs: +8 per game, capped at 95.
      setTension(arc, Math.min(95, arc.tension + 8))

      const name = inputs.playerName(pid)

      if (
        (prevTension < TENSION_THRESHOLD_MID && arc.tension >= TENSION_THRESHOLD_MID) ||
        (prevTension < TENSION_THRESHOLD_HIGH && arc.tension >= TENSION_THRESHOLD_HIGH)
      ) {
        seeds.push({
          category: 'league',
          headline: `${name}'s heater hits ${streak} games`,
          body: `${name} extended their point streak to ${streak} consecutive games. They have ${totals.points} points in ${totals.gamesPlayed} games this season.`,
          playerId: pid,
          ...((): Partial<{ teamId: string }> => {
            const t = inputs.playerLines.find(pl => pl.playerId === pid)?.teamId
            return t !== undefined ? { teamId: t } : {}
          })(),
        })
      }
    }
  }

  // Check for new streaks starting (arc created at exactly 4 games).
  // We track streak length via seasonTotals — approximation: if a player
  // scored today and has no existing arc, we detect new 4+ streaks by
  // checking that this is their 4th straight game with points. Since we
  // don't have per-game history in inputs, we create an arc with 4 beats
  // pre-populated when a player explicitly enters with a 4-game run.
  // The caller is expected to call tickArcs every match day, so existing
  // arcs track ongoing streaks. For cold-start or newly qualifying players
  // the caller may pass `hotStreakSeed` via playerLines (see below).
  //
  // We use the consec field if provided; otherwise fall back to a heuristic
  // (points/gamesPlayed ratio check is too noisy — just skip new detection
  // when no explicit streak length is provided).
  for (const pl of inputs.playerLines) {
    if (handled.has(pl.playerId)) continue
    const streak = pl.consecutivePointGames ?? 0
    if (!pl.points) continue
    // A heater is only a story when it is unusual: prominent scorers earn an
    // arc at 5 straight, anyone else needs 8. Without this, a quarter of the
    // league is "on fire" at any given moment and the feed becomes noise.
    const expected = inputs.expectedPoints?.(pl.playerId)
    const threshold = expected !== undefined && expected >= 0.55 ? 5 : 8
    if (streak < threshold) continue

    state.counter += 1
    const arc: Arc = {
      id: makeId(state.counter),
      kind: 'hotStreak',
      actors: { playerIds: [pl.playerId], teamIds: [pl.teamId] },
      tension: 30 + Math.min(40, (streak - 4) * 6),
      startedDay: inputs.day - (streak - 1),
      startedYear: inputs.year,
      beats: [],
      status: 'building',
    }
    for (let i = streak - 1; i >= 0; i--) {
      arc.beats.push({
        day: inputs.day - i,
        year: inputs.year,
        summary: i === 0 ? `${ordinal(streak)} straight game with a point` : `Point in game ${streak - i}`,
      })
    }
    if (arc.tension >= TENSION_THRESHOLD_HIGH) arc.status = 'peak'
    state.arcs.push(arc)
    handled.add(pl.playerId)

    const name = inputs.playerName(pl.playerId)
    seeds.push({
      category: 'league',
      headline: `${name} on fire — ${streak}-game point streak`,
      body: `${name} has recorded a point in each of their last ${streak} games, emerging as one of the hottest players in the league.`,
      playerId: pl.playerId,
      teamId: pl.teamId,
    })
  }

  enforceCapInPlace(state)
}

/* ─────────────────────────── detector: cold spell ─────────────────────────── */

/**
 * coldSpell: a top-6 forward goes 6+ games without a point.
 * Uses isForward flag and a passed-in scorelessStreak.
 */
function detectColdSpell(
  state: ArcsState,
  inputs: ArcInputs,
  seeds: NewsSeed[],
): void {
  const existing = state.arcs.filter(
    a => a.kind === 'coldSpell' && a.status !== 'resolved',
  )
  const handled = new Set<string>()

  for (const arc of existing) {
    const pid = arc.actors.playerIds[0]
    if (!pid) continue
    handled.add(pid)

    const pl = inputs.playerLines.find(p => p.playerId === pid)
    const scoredToday = pl && pl.points > 0

    if (scoredToday) {
      const drought = arc.beats.length
      const name = inputs.playerName(pid)
      const summary = `Ended ${drought}-game drought with a point`
      addBeat(arc, inputs.day, inputs.year, summary)
      arc.status = 'resolved'
      arc.resolution = summary
      seeds.push({
        category: 'league',
        headline: `${name} breaks out of ${drought}-game slump`,
        body: `${name} finally registered a point today after going ${drought} straight games without one. The slump had raised questions about their form this season.`,
        playerId: pid,
        teamId: arc.actors.teamIds[0],
      })
    } else {
      const games = arc.beats.length + 1
      const summary = `${ordinal(games)} straight game without a point`
      addBeat(arc, inputs.day, inputs.year, summary)
      const prevTension = arc.tension
      setTension(arc, Math.min(95, arc.tension + 7))
      const name = inputs.playerName(pid)

      if (
        (prevTension < TENSION_THRESHOLD_MID && arc.tension >= TENSION_THRESHOLD_MID) ||
        (prevTension < TENSION_THRESHOLD_HIGH && arc.tension >= TENSION_THRESHOLD_HIGH)
      ) {
        seeds.push({
          category: 'league',
          headline: `${name} in a ${games}-game slump`,
          body: `${name} has gone ${games} consecutive games without a point. For a player expected to produce in the top 6, the drought is becoming a real concern.`,
          playerId: pid,
          teamId: arc.actors.teamIds[0],
        })
      }
    }
  }

  // New cold spells: check scorelessStreak field on playerLines. Only
  // PROMINENT scorers qualify — a fourth-liner going six games without a
  // point is not a story, and without this gate the feed drowns in droughts.
  for (const pl of inputs.playerLines) {
    if (handled.has(pl.playerId)) continue
    if (!pl.isForward) continue
    const expected = inputs.expectedPoints?.(pl.playerId)
    if (expected === undefined || expected < 0.55) continue
    const drought = pl.scorelessStreak ?? 0
    if (drought < 6) continue

    state.counter += 1
    const arc: Arc = {
      id: makeId(state.counter),
      kind: 'coldSpell',
      actors: { playerIds: [pl.playerId], teamIds: [pl.teamId] },
      tension: 35 + Math.min(35, (drought - 6) * 5),
      startedDay: inputs.day - (drought - 1),
      startedYear: inputs.year,
      beats: [],
      status: 'building',
    }
    for (let i = drought - 1; i >= 0; i--) {
      arc.beats.push({
        day: inputs.day - i,
        year: inputs.year,
        summary: `Game ${drought - i} without a point`,
      })
    }
    if (arc.tension >= TENSION_THRESHOLD_HIGH) arc.status = 'peak'
    state.arcs.push(arc)
    handled.add(pl.playerId)

    const name = inputs.playerName(pl.playerId)
    seeds.push({
      category: 'league',
      headline: `${name} in a ${drought}-game point drought`,
      body: `${name}, expected to be a key forward, has gone ${drought} games without a point. The slump is raising eyebrows around the league.`,
      playerId: pl.playerId,
      teamId: pl.teamId,
    })
  }

  enforceCapInPlace(state)
}

/* ─────────────────────────── detector: breakout / bust ─────────────────────────── */

const BREAKOUT_GAMES_MIN = 15
const BREAKOUT_PACE_MULTIPLIER = 1.4
const BUST_PACE_MULTIPLIER = 0.55

function detectBreakoutBust(
  state: ArcsState,
  inputs: ArcInputs,
  seeds: NewsSeed[],
): void {
  if (!inputs.expectedPoints) return

  const existingBreakout = new Set(
    state.arcs
      .filter(a => a.kind === 'breakoutSeason' && a.status !== 'resolved')
      .flatMap(a => a.actors.playerIds),
  )
  const existingBust = new Set(
    state.arcs
      .filter(a => a.kind === 'bustWatch' && a.status !== 'resolved')
      .flatMap(a => a.actors.playerIds),
  )

  // Check escalation / resolution on existing arcs.
  for (const arc of state.arcs.filter(
    a => (a.kind === 'breakoutSeason' || a.kind === 'bustWatch') && a.status !== 'resolved',
  )) {
    const pid = arc.actors.playerIds[0]
    if (!pid) continue
    const totals = inputs.seasonTotals(pid)
    if (totals.gamesPlayed < BREAKOUT_GAMES_MIN) continue

    const expected = inputs.expectedPoints(pid)
    if (expected === undefined) continue
    const pace = totals.gamesPlayed > 0
      ? (totals.points / totals.gamesPlayed) * inputs.seasonLength
      : 0

    const name = inputs.playerName(pid)

    if (arc.kind === 'breakoutSeason') {
      if (pace < expected * 1.2) {
        // Pace has regressed to normal — resolve.
        const summary = `Production pace normalized — breakout slowed`
        addBeat(arc, inputs.day, inputs.year, summary)
        arc.status = 'resolved'
        arc.resolution = summary
        seeds.push({
          category: 'league',
          headline: `${name}'s breakout pace cools`,
          body: `${name}'s scoring pace has settled after a hot start. They sit at ${totals.points} points in ${totals.gamesPlayed} games.`,
          playerId: pid,
        })
      } else {
        const prevTension = arc.tension
        setTension(arc, Math.min(95, arc.tension + 5))
        const summary = `On pace for ${Math.round(pace)} points (expected ${Math.round(expected)})`
        addBeat(arc, inputs.day, inputs.year, summary)
        if (
          (prevTension < TENSION_THRESHOLD_MID && arc.tension >= TENSION_THRESHOLD_MID) ||
          (prevTension < TENSION_THRESHOLD_HIGH && arc.tension >= TENSION_THRESHOLD_HIGH)
        ) {
          seeds.push({
            category: 'league',
            headline: `${name}'s breakout season continues`,
            body: `${name} is on pace for ${Math.round(pace)} points this season, well above the expected ${Math.round(expected)}. After ${arc.beats.length} beats of this arc, the breakout looks real.`,
            playerId: pid,
            teamId: arc.actors.teamIds[0],
          })
        }
      }
    } else {
      // bustWatch
      if (pace > expected * 0.75) {
        const summary = `Production recovering — bust watch lifted`
        addBeat(arc, inputs.day, inputs.year, summary)
        arc.status = 'resolved'
        arc.resolution = summary
        seeds.push({
          category: 'league',
          headline: `${name} quiets the bust talk`,
          body: `${name}'s numbers have improved after a slow start. They now sit at ${totals.points} points in ${totals.gamesPlayed} games.`,
          playerId: pid,
        })
      } else {
        const prevTension = arc.tension
        setTension(arc, Math.min(95, arc.tension + 5))
        const summary = `On pace for ${Math.round(pace)} points (expected ${Math.round(expected)})`
        addBeat(arc, inputs.day, inputs.year, summary)
        if (
          (prevTension < TENSION_THRESHOLD_MID && arc.tension >= TENSION_THRESHOLD_MID) ||
          (prevTension < TENSION_THRESHOLD_HIGH && arc.tension >= TENSION_THRESHOLD_HIGH)
        ) {
          seeds.push({
            category: 'league',
            headline: `${name} falling far short of expectations`,
            body: `${name} is on pace for only ${Math.round(pace)} points, versus an expectation of ${Math.round(expected)}. The story is getting harder to ignore.`,
            playerId: pid,
            ...(arc.actors.teamIds[0] !== undefined ? { teamId: arc.actors.teamIds[0] } : {}),
          })
        }
      }
    }
  }

  // New breakout/bust — scan all players in today's lines.
  const playersInGame = new Set(inputs.playerLines.map(pl => pl.playerId))
  for (const pid of playersInGame) {
    if (existingBreakout.has(pid) || existingBust.has(pid)) continue
    const totals = inputs.seasonTotals(pid)
    if (totals.gamesPlayed < BREAKOUT_GAMES_MIN) continue

    const expected = inputs.expectedPoints?.(pid)
    if (expected === undefined || expected <= 0) continue
    const pace = (totals.points / totals.gamesPlayed) * inputs.seasonLength
    const name = inputs.playerName(pid)
    const pl = inputs.playerLines.find(p => p.playerId === pid)
    // pl is always found since pid comes from playerLines; teamId is always string.
    const teamId: string | undefined = pl?.teamId

    if (pace >= expected * BREAKOUT_PACE_MULTIPLIER) {
      state.counter += 1
      const arc: Arc = {
        id: makeId(state.counter),
        kind: 'breakoutSeason',
        actors: { playerIds: [pid], teamIds: teamId !== undefined ? [teamId] : [] },
        tension: 40,
        startedDay: inputs.day,
        startedYear: inputs.year,
        beats: [
          {
            day: inputs.day,
            year: inputs.year,
            summary: `On pace for ${Math.round(pace)} points — ${Math.round((pace / expected - 1) * 100)}% above expectations`,
          },
        ],
        status: 'building',
      }
      state.arcs.push(arc)
      seeds.push({
        category: 'league',
        headline: `Breakout season: ${name} defying expectations`,
        body: `${name} is on pace for ${Math.round(pace)} points, ${Math.round((pace / expected - 1) * 100)}% above preseason projections. Is this the real thing?`,
        playerId: pid,
        ...(teamId !== undefined ? { teamId } : {}),
      })
    } else if (pace <= expected * BUST_PACE_MULTIPLIER) {
      state.counter += 1
      const arc: Arc = {
        id: makeId(state.counter),
        kind: 'bustWatch',
        actors: { playerIds: [pid], teamIds: teamId !== undefined ? [teamId] : [] },
        tension: 40,
        startedDay: inputs.day,
        startedYear: inputs.year,
        beats: [
          {
            day: inputs.day,
            year: inputs.year,
            summary: `On pace for only ${Math.round(pace)} points — ${Math.round((1 - pace / expected) * 100)}% below expectations`,
          },
        ],
        status: 'building',
      }
      state.arcs.push(arc)
      seeds.push({
        category: 'league',
        headline: `${name} off to a costly slow start`,
        body: `${name} is on pace for only ${Math.round(pace)} points, far below the expected ${Math.round(expected)}. Questions are mounting.`,
        playerId: pid,
        ...(teamId !== undefined ? { teamId } : {}),
      })
    }
  }

  enforceCapInPlace(state)
}

/* ─────────────────────────── detector: milestone watch ─────────────────────────── */

/** Milestone numbers we watch for (goals, points, games). */
const MILESTONE_NUMBERS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 50, 150, 250, 350]
const MILESTONE_APPROACH_WINDOW = 10

function nearestMilestone(current: number): number | null {
  for (const m of MILESTONE_NUMBERS.sort((a, b) => a - b)) {
    if (current < m && m - current <= MILESTONE_APPROACH_WINDOW) return m
    if (current >= m && current - m < MILESTONE_APPROACH_WINDOW) return m
  }
  return null
}

function detectMilestone(
  state: ArcsState,
  inputs: ArcInputs,
  seeds: NewsSeed[],
): void {
  if (!inputs.careerTotals) return

  const existingMilestoneIds = new Set(
    state.arcs
      .filter(a => a.kind === 'milestoneWatch' && a.status !== 'resolved')
      .flatMap(a => a.actors.playerIds),
  )

  for (const pl of inputs.playerLines) {
    const ct = inputs.careerTotals(pl.playerId)
    const name = inputs.playerName(pl.playerId)

    // Goals milestone.
    const goalMilestone = nearestMilestone(ct.goals)
    // Points milestone.
    const pointsMilestone = nearestMilestone(ct.points)

    for (const [stat, milestone, currentVal] of [
      ['goals', goalMilestone, ct.goals],
      ['points', pointsMilestone, ct.points],
    ] as Array<[string, number | null, number]>) {
      if (!milestone) continue

      const existingArc = state.arcs.find(
        a =>
          a.kind === 'milestoneWatch' &&
          a.status !== 'resolved' &&
          a.actors.playerIds[0] === pl.playerId &&
          a.beats[0]?.summary.includes(`${milestone} career ${stat}`),
      )

      if (currentVal >= milestone) {
        // Hit the milestone — resolve existing arc or create+resolve.
        if (existingArc) {
          const summary = `Reached ${milestone} career ${stat}`
          addBeat(existingArc, inputs.day, inputs.year, summary)
          existingArc.status = 'resolved'
          existingArc.resolution = summary
          existingArc.tension = 100
          seeds.push({
            category: 'milestone',
            headline: `${name} reaches ${milestone} career ${stat}!`,
            body: `${name} has now recorded ${currentVal} career ${stat}, crossing the ${milestone} mark in a storied career.`,
            playerId: pl.playerId,
            teamId: pl.teamId,
          })
        } else if (currentVal - milestone < 5) {
          // Just crossed it this week, no prior arc — still fire milestone news.
          seeds.push({
            category: 'milestone',
            headline: `${name} reaches ${milestone} career ${stat}`,
            body: `${name} has now recorded ${currentVal} career ${stat}, crossing the ${milestone} mark.`,
            playerId: pl.playerId,
            teamId: pl.teamId,
          })
        }
      } else if (!existingMilestoneIds.has(pl.playerId) && !existingArc && milestone - currentVal <= MILESTONE_APPROACH_WINDOW) {
        // Approaching — create arc.
        const remaining = milestone - currentVal
        state.counter += 1
        const arc: Arc = {
          id: makeId(state.counter),
          kind: 'milestoneWatch',
          actors: { playerIds: [pl.playerId], teamIds: [pl.teamId] },
          tension: 50 + Math.round((1 - remaining / MILESTONE_APPROACH_WINDOW) * 40),
          startedDay: inputs.day,
          startedYear: inputs.year,
          beats: [
            {
              day: inputs.day,
              year: inputs.year,
              summary: `${remaining} away from ${milestone} career ${stat}`,
            },
          ],
          status: 'building',
        }
        state.arcs.push(arc)
        seeds.push({
          category: 'milestone',
          headline: `${name} closing in on ${milestone} career ${stat}`,
          body: `${name} needs just ${remaining} more ${stat} to reach the ${milestone} career milestone. It could happen within the next few games.`,
          playerId: pl.playerId,
          teamId: pl.teamId,
        })
      } else if (existingArc) {
        // Update the approach arc.
        const remaining = milestone - currentVal
        const summary = `${remaining} away from ${milestone} career ${stat}`
        addBeat(existingArc, inputs.day, inputs.year, summary)
        setTension(existingArc, Math.min(95, existingArc.tension + 6))
      }
    }
  }

  enforceCapInPlace(state)
}

/* ─────────────────────────── detector: cinderella / collapse ─────────────────────────── */

const OVERPERFORM_RANKS = 6   // ranked X spots above expected
const UNDERPERFORM_RANKS = 6
const CINDERELLA_DAYS_MIN = 10

function detectCinderellaCollapse(
  state: ArcsState,
  inputs: ArcInputs,
  seeds: NewsSeed[],
): void {
  const existingCinderella = new Map(
    state.arcs
      .filter(a => a.kind === 'cinderellaTeam' && a.status !== 'resolved')
      .map(a => [a.actors.teamIds[0], a]),
  )
  const existingCollapse = new Map(
    state.arcs
      .filter(a => a.kind === 'collapseTeam' && a.status !== 'resolved')
      .map(a => [a.actors.teamIds[0], a]),
  )

  for (const sd of inputs.standingsDelta) {
    if (sd.expectedRank === undefined) continue
    const name = inputs.teamName(sd.teamId)
    const overperforming = sd.rank <= sd.expectedRank - OVERPERFORM_RANKS
    const underperforming = sd.rank >= sd.expectedRank + UNDERPERFORM_RANKS

    // Cinderella.
    const cArc = existingCinderella.get(sd.teamId)
    if (cArc) {
      const daysRunning = inputs.day - cArc.startedDay
      if (!overperforming) {
        const summary = `Fell back to expected range (rank ${sd.rank})`
        addBeat(cArc, inputs.day, inputs.year, summary)
        cArc.status = 'resolved'
        cArc.resolution = summary
        seeds.push({
          category: 'league',
          headline: `${name}'s cinderella run comes to an end`,
          body: `${name} have dropped back to their expected range after a remarkable ${daysRunning}-day run above expectations. The dream is over — for now.`,
          teamId: sd.teamId,
        })
      } else {
        const summary = `Still ${sd.expectedRank - sd.rank} places above expected rank`
        addBeat(cArc, inputs.day, inputs.year, summary)
        const prevTension = cArc.tension
        setTension(cArc, Math.min(95, cArc.tension + 4))
        if (
          (prevTension < TENSION_THRESHOLD_MID && cArc.tension >= TENSION_THRESHOLD_MID) ||
          (prevTension < TENSION_THRESHOLD_HIGH && cArc.tension >= TENSION_THRESHOLD_HIGH)
        ) {
          seeds.push({
            category: 'league',
            headline: `${name}'s improbable run now at ${daysRunning} days`,
            body: `${name} remain ${sd.expectedRank - sd.rank} places above their preseason projection, and the hockey world is starting to take notice.`,
            teamId: sd.teamId,
          })
        }
      }
    } else if (overperforming && inputs.day >= CINDERELLA_DAYS_MIN) {
      state.counter += 1
      const arc: Arc = {
        id: makeId(state.counter),
        kind: 'cinderellaTeam',
        actors: { playerIds: [], teamIds: [sd.teamId] },
        tension: 45,
        startedDay: inputs.day,
        startedYear: inputs.year,
        beats: [
          {
            day: inputs.day,
            year: inputs.year,
            summary: `Ranked ${sd.rank}, expected ${sd.expectedRank} — ${sd.expectedRank - sd.rank} above projection`,
          },
        ],
        status: 'building',
      }
      state.arcs.push(arc)
      seeds.push({
        category: 'league',
        headline: `${name} beating all expectations`,
        body: `${name} sit at rank ${sd.rank}, a full ${sd.expectedRank - sd.rank} spots above their preseason projection of ${sd.expectedRank}. Is this the real deal?`,
        teamId: sd.teamId,
      })
    }

    // Collapse.
    const colArc = existingCollapse.get(sd.teamId)
    if (colArc) {
      const daysRunning = inputs.day - colArc.startedDay
      if (!underperforming) {
        const summary = `Climbed back to expected range (rank ${sd.rank})`
        addBeat(colArc, inputs.day, inputs.year, summary)
        colArc.status = 'resolved'
        colArc.resolution = summary
        seeds.push({
          category: 'league',
          headline: `${name} steadies the ship after ${daysRunning}-day collapse`,
          body: `${name} have climbed back to their expected range after a rough ${daysRunning}-day stretch where they fell well below preseason projections.`,
          teamId: sd.teamId,
        })
      } else {
        const summary = `Still ${sd.rank - sd.expectedRank} places below expected rank`
        addBeat(colArc, inputs.day, inputs.year, summary)
        const prevTension = colArc.tension
        setTension(colArc, Math.min(95, colArc.tension + 4))
        if (
          (prevTension < TENSION_THRESHOLD_MID && colArc.tension >= TENSION_THRESHOLD_MID) ||
          (prevTension < TENSION_THRESHOLD_HIGH && colArc.tension >= TENSION_THRESHOLD_HIGH)
        ) {
          seeds.push({
            category: 'league',
            headline: `${name}'s collapse deepens — ${daysRunning} days below par`,
            body: `${name} remain ${sd.rank - sd.expectedRank} places below where they were projected, and questions are mounting about the organisation's direction.`,
            teamId: sd.teamId,
          })
        }
      }
    } else if (underperforming && inputs.day >= CINDERELLA_DAYS_MIN) {
      state.counter += 1
      const arc: Arc = {
        id: makeId(state.counter),
        kind: 'collapseTeam',
        actors: { playerIds: [], teamIds: [sd.teamId] },
        tension: 45,
        startedDay: inputs.day,
        startedYear: inputs.year,
        beats: [
          {
            day: inputs.day,
            year: inputs.year,
            summary: `Ranked ${sd.rank}, expected ${sd.expectedRank} — ${sd.rank - sd.expectedRank} below projection`,
          },
        ],
        status: 'building',
      }
      state.arcs.push(arc)
      seeds.push({
        category: 'league',
        headline: `${name} in freefall — ${sd.rank - sd.expectedRank} places below projection`,
        body: `${name} were projected to finish around ${sd.expectedRank} but sit at rank ${sd.rank}. Something has gone seriously wrong.`,
        teamId: sd.teamId,
      })
    }
  }

  enforceCapInPlace(state)
}

/* ─────────────────────────── detector: rookie race ─────────────────────────── */

const ROOKIE_RACE_SEASON_FRACTION = 0.6   // last 40% of season
const ROOKIE_RACE_GAP_MAX = 5             // within 5 points

function detectRookieRace(
  state: ArcsState,
  inputs: ArcInputs,
  seeds: NewsSeed[],
): void {
  const lateSeason = inputs.day / inputs.seasonLength >= ROOKIE_RACE_SEASON_FRACTION
  if (!lateSeason) return

  const rookies = inputs.playerLines.filter(pl => pl.isRookie)
  if (rookies.length < 2) return

  // Gather season totals for all rookies.
  const rookieStats = rookies.map(pl => ({
    ...pl,
    totals: inputs.seasonTotals(pl.playerId),
  }))

  // Sort by points desc.
  rookieStats.sort((a, b) => b.totals.points - a.totals.points)

  const leader = rookieStats[0]
  const second = rookieStats[1]
  if (!leader || !second) return

  const gap = leader.totals.points - second.totals.points
  if (gap > ROOKIE_RACE_GAP_MAX) return

  const existing = state.arcs.find(
    a => a.kind === 'rookieRace' && a.status !== 'resolved',
  )

  if (existing) {
    const summary = `${inputs.playerName(leader.playerId)} leads ${leader.totals.points}–${second.totals.points} (${gap}-pt gap)`
    addBeat(existing, inputs.day, inputs.year, summary)
    const prevTension = existing.tension
    setTension(existing, Math.min(98, existing.tension + 6))

    if (
      (prevTension < TENSION_THRESHOLD_MID && existing.tension >= TENSION_THRESHOLD_MID) ||
      (prevTension < TENSION_THRESHOLD_HIGH && existing.tension >= TENSION_THRESHOLD_HIGH)
    ) {
      seeds.push({
        category: 'league',
        headline: `Rookie race tightens: ${gap}-point gap with ${inputs.seasonLength - inputs.day} days left`,
        body: `${inputs.playerName(leader.playerId)} leads rookie scoring with ${leader.totals.points} points, just ${gap} ahead of ${inputs.playerName(second.playerId)} (${second.totals.points}). The award race is on.`,
        playerId: leader.playerId,
      })
    }
  } else {
    // Create the arc.
    state.counter += 1
    const arc: Arc = {
      id: makeId(state.counter),
      kind: 'rookieRace',
      actors: {
        playerIds: rookieStats.slice(0, 3).map(r => r.playerId),
        teamIds: [...new Set(rookieStats.slice(0, 3).map(r => r.teamId))],
      },
      tension: 55,
      startedDay: inputs.day,
      startedYear: inputs.year,
      beats: [
        {
          day: inputs.day,
          year: inputs.year,
          summary: `${inputs.playerName(leader.playerId)} leads ${leader.totals.points}–${second.totals.points}`,
        },
      ],
      status: 'building',
    }
    state.arcs.push(arc)
    seeds.push({
      category: 'league',
      headline: `Rookie race is on — just ${gap} points separate the leaders`,
      body: `With ${inputs.seasonLength - inputs.day} days left, ${inputs.playerName(leader.playerId)} (${leader.totals.points} pts) leads ${inputs.playerName(second.playerId)} (${second.totals.points} pts) in the rookie scoring race.`,
      playerId: leader.playerId,
    })
  }

  enforceCapInPlace(state)
}

/* ─────────────────────────── detector: goalie duel ─────────────────────────── */

/**
 * goalieDuel: two goalies on teams playing today are both on hot runs
 * (e.g. both in top-N SV% over last N games). Since per-game goalie splits
 * aren't in ArcInputs, this detector triggers when the result data shows a
 * low-scoring game (both teams held to 1 goal or fewer) — the implicit
 * narrative that the goalies were dominant.
 */
function detectGoalieDuel(
  state: ArcsState,
  inputs: ArcInputs,
  seeds: NewsSeed[],
  rng: Rng,
): void {
  const existing = state.arcs.find(
    a => a.kind === 'goalieDuel' && a.status !== 'resolved',
  )

  // Find low-scoring, closely contested games today.
  const duels = inputs.results.filter(
    r => r.goalsFor <= 2 && r.goalsAgainst <= 2,
  )
  if (duels.length === 0) {
    // No duel today — tick down existing arc.
    if (existing) {
      setTension(existing, existing.tension - 10)
      if (existing.tension <= 10) {
        const summary = `Duel arc faded without further drama`
        addBeat(existing, inputs.day, inputs.year, summary)
        existing.status = 'resolved'
        existing.resolution = summary
      }
    }
    return
  }

  // Pick one duel to spotlight (rng keeps it deterministic).
  const duel = rng.pick(duels)
  const homeTeam = inputs.teamName(duel.teamId)
  const awayTeam = inputs.teamName(duel.oppId)

  if (existing) {
    const summary = `Another low-scoring battle: ${homeTeam} ${duel.goalsFor}–${duel.goalsAgainst} ${awayTeam}`
    addBeat(existing, inputs.day, inputs.year, summary)
    const prevTension = existing.tension
    setTension(existing, Math.min(95, existing.tension + 8))
    if (
      (prevTension < TENSION_THRESHOLD_MID && existing.tension >= TENSION_THRESHOLD_MID) ||
      (prevTension < TENSION_THRESHOLD_HIGH && existing.tension >= TENSION_THRESHOLD_HIGH)
    ) {
      seeds.push({
        category: 'league',
        headline: `Goaltending masterclass: ${homeTeam} and ${awayTeam} in another tight battle`,
        body: `The latest matchup between ${homeTeam} and ${awayTeam} ended ${duel.goalsFor}–${duel.goalsAgainst} — part of a string of goalie-dominated games this season.`,
        teamId: duel.teamId,
      })
    }
  } else if (rng.chance(0.4)) {
    // Only create ~40% of the time to avoid noise.
    state.counter += 1
    const arc: Arc = {
      id: makeId(state.counter),
      kind: 'goalieDuel',
      actors: { playerIds: [], teamIds: [duel.teamId, duel.oppId] },
      tension: 35,
      startedDay: inputs.day,
      startedYear: inputs.year,
      beats: [
        {
          day: inputs.day,
          year: inputs.year,
          summary: `${homeTeam} ${duel.goalsFor}–${duel.goalsAgainst} ${awayTeam} — goalies dominate`,
        },
      ],
      status: 'building',
    }
    state.arcs.push(arc)
  }

  enforceCapInPlace(state)
}

/* ─────────────────────────── main tick ─────────────────────────── */

export interface TickArcsArgs {
  state: ArcsState
  inputs: ArcInputs
  rng: Rng
}

export interface TickArcsResult {
  newsSeeds: NewsSeed[]
}

/**
 * Main entry point. Call once per match day after all results for the day are
 * resolved. Returns news seeds; mutates state in-place.
 *
 * Deterministic: given the same state + inputs + rng sequence, always produces
 * the same output.
 */
export function tickArcs({ state, inputs, rng }: TickArcsArgs): TickArcsResult {
  const seeds: NewsSeed[] = []

  detectHotStreak(state, inputs, seeds)
  detectColdSpell(state, inputs, seeds)
  detectBreakoutBust(state, inputs, seeds)
  detectMilestone(state, inputs, seeds)
  detectCinderellaCollapse(state, inputs, seeds)
  detectRookieRace(state, inputs, seeds)
  detectGoalieDuel(state, inputs, seeds, rng)

  // Final cap enforcement across all detectors.
  enforceCapInPlace(state)

  // A reader can absorb only so much per match day: cap the day's arc news.
  // Detectors run goal-stories-first, so truncation drops the least vital.
  if (seeds.length > 4) seeds.length = 4

  return { newsSeeds: seeds }
}
