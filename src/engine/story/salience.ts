/**
 * The salience engine — noticing what's interesting (docs/THE-FEED.md).
 *
 * Principle: interesting = deviation from a RECORDED expectation. Nothing is
 * inherently a story; a hot month from the preseason favourite is Tuesday,
 * the same month from the team everyone picked last is news.
 *
 * This module is PURE and JSON-safe. The career layer owns the priors ledger
 * (captured at season start), feeds detectors a context each day, applies the
 * daily budget, and publishes the survivors as feed posts. Detection is
 * deterministic and engine-side — a future LLM writer only restyles what this
 * engine surfaces; it never decides newsworthiness.
 *
 * Phase A ships the framework + two proof detectors (expectation gap, streak
 * outlier). The detector library fans out from here — each detector is a pure
 * function of the context, independently testable.
 */

import type { Rng } from '@engine/shared/rng'

/* ────────────────────────── authors ────────────────────────── */

export type FeedChannel = 'feed' | 'wire'

export interface FeedAuthor {
  id: string
  name: string
  handle: string
  /** Voice: insider = terse facts, analyst = takes, stats = numbers, wire = official. */
  kind: 'insider' | 'analyst' | 'stats' | 'wire'
  outlet: string
}

/** The launch author pool. Names continue the existing press-corps personas
 *  so the world stays coherent (Vic Mercer the byline IS Vic Mercer the account). */
export const FEED_AUTHORS: Record<string, FeedAuthor> = {
  insider: { id: 'insider', name: 'Vic Mercer', handle: 'MercerHockey', kind: 'insider', outlet: 'National Hockey Wire' },
  analyst: { id: 'analyst', name: 'Sam Carver', handle: 'CarverNotes', kind: 'analyst', outlet: 'The Daily Gazette' },
  stats: { id: 'stats', name: 'PuckModel', handle: 'puckmodel', kind: 'stats', outlet: 'model & viz' },
  wire: { id: 'wire', name: 'League Wire', handle: 'TheWire', kind: 'wire', outlet: 'league sources' },
}

/* ────────────────────────── facts & priors ────────────────────────── */

/** Structured payload behind every post — what a template (or later, the
 *  local writer) renders. All facts, no prose. */
export interface PostFacts {
  kind: string
  teamIds?: string[]
  playerIds?: string[]
  /** The numbers: ranks, streaks, gaps — everything the text may cite. */
  numbers: Record<string, number | string>
  /** The receipt: which recorded expectation this deviates from. */
  priorNote?: string
}

/** Priors ledger — captured once per season, persisted in the save, so every
 *  deviation is computable AND citable ("picked 28th in October"). */
export interface StoryPriors {
  year: number
  /** [teamId, preseason strength rank 1..N] for every club. */
  preseasonRanks: Array<[string, number]>
  /** [noveltyKey, timesFired this save] — the self-tuning surprise memory. */
  noveltyCounts: Array<[string, number]>
}

/* ────────────────────────── detection ────────────────────────── */

export interface SalienceCandidate {
  /** Novelty key: fires of the same key dampen each other over the save. */
  key: string
  /** Raw 0-100 before novelty dampening. */
  score: number
  channel: FeedChannel
  authorId: string
  text: string
  facts: PostFacts
  teamId?: string
  playerId?: string
}

export interface SalienceCtx {
  day: number
  year: number
  /** Current overall standings rank per teamId (1 = best). */
  currentRanks: Map<string, number>
  /** Preseason rank per teamId, from the priors ledger. */
  preseasonRanks: Map<string, number>
  /** Signed win(+)/loss(-) streak per teamId. */
  streaks: Map<string, number>
  /** teamId -> display info. */
  teams: Map<string, { name: string; abbreviation: string }>
  userTeamId: string
  teamsInLeague: number
  /** NHL skater season lines (the prior is his rating — deviation = story). */
  skaters?: Array<{
    playerId: string
    name: string
    teamId: string
    gp: number
    points: number
    /** Goals only — for the Rocket Richard (goal-scoring) race. */
    goals: number
    /** The recorded expectation: his current rated overall. */
    ratedOverall: number
    age: number
  }>
  /** NHL goalie season lines. */
  goalies?: Array<{
    playerId: string
    name: string
    teamId: string
    saves: number
    shotsAgainst: number
    ratedOverall: number
  }>
  /** Standings points per teamId — powers the playoff-race detector. */
  teamPoints?: Map<string, number>
  /** Conference id per teamId — the playoff race is fought within a conference. */
  teamConference?: Map<string, string>
  /** Games still to play per teamId (for "with X to go" tension). */
  teamGamesLeft?: Map<string, number>
}

/** Days on which the expectation-gap detector takes its readings. Checkpoints
 *  (not daily) so the story is "a month in, X is not who we thought" — and so
 *  one team's season produces beats, not a drumbeat. */
const EXPECTATION_CHECKPOINT_DAYS = [25, 50, 80]

/** Standings vs the preseason book: gap >= 10 spots either way is a story.
 *  Overachievers get the feel-good write-up, collapses get the autopsy. */
export function detectExpectationGap(ctx: SalienceCtx): SalienceCandidate[] {
  if (!EXPECTATION_CHECKPOINT_DAYS.includes(ctx.day)) return []
  const out: SalienceCandidate[] = []
  for (const [teamId, rank] of ctx.currentRanks) {
    const pre = ctx.preseasonRanks.get(teamId)
    if (pre === undefined) continue
    const gap = pre - rank // positive = outperforming
    if (Math.abs(gap) < 10) continue
    const t = ctx.teams.get(teamId)
    if (!t) continue
    const up = gap > 0
    const text = up
      ? `Nobody had ${t.name} here. Picked ${ordinal(pre)} before the season — they sit ${ordinal(rank)} today. ${gap} spots above the book, and it doesn't look like a heater.`
      : `Time to say it about the ${t.name}: picked ${ordinal(pre)}, currently ${ordinal(rank)}. That's ${-gap} spots below where the league had them, and the schedule isn't getting kinder.`
    out.push({
      key: `expgap-${up ? 'up' : 'down'}-${teamId}`,
      score: Math.min(90, 38 + Math.abs(gap) * 2 + (teamId === ctx.userTeamId ? 10 : 0)),
      channel: 'feed',
      authorId: 'analyst',
      text,
      facts: {
        kind: 'expectationGap',
        teamIds: [teamId],
        numbers: { preseasonRank: pre, currentRank: rank, gap, day: ctx.day },
        priorNote: `preseason media rank ${pre}`,
      },
      teamId,
    })
  }
  return out
}

/** Streak outliers: 6+ wins or losses in a row, re-firing only as the streak
 *  grows (the key includes the length band so day-after-day silence holds). */
export function detectStreakOutlier(ctx: SalienceCtx): SalienceCandidate[] {
  const out: SalienceCandidate[] = []
  for (const [teamId, streak] of ctx.streaks) {
    const len = Math.abs(streak)
    if (len < 6) continue
    // Beat bands: 6, 8, 10, 12... — one post per band per team-season.
    const band = len < 8 ? 6 : len - (len % 2)
    const t = ctx.teams.get(teamId)
    if (!t) continue
    const hot = streak > 0
    const text = hot
      ? `${t.name} have won ${len} straight. ${len >= 10 ? 'This is officially a problem for the rest of the league.' : 'The room believes, and the numbers are starting to agree.'}`
      : `${len} in a row now for the ${t.name} — the wrong kind. ${len >= 10 ? 'Jobs get lost over stretches like this.' : 'Someone in that room needs to say something.'}`
    out.push({
      key: `streak-${hot ? 'w' : 'l'}-${teamId}-${ctx.year}-${band}`,
      score: Math.min(88, 26 + len * 4 + (teamId === ctx.userTeamId ? 8 : 0)),
      channel: 'feed',
      authorId: hot ? 'insider' : 'analyst',
      text,
      facts: {
        kind: 'streakOutlier',
        teamIds: [teamId],
        numbers: { streak, day: ctx.day },
      },
      teamId,
    })
  }
  return out
}

/** Same checkpoint cadence for the player-level readings. Exported so the
 *  career layer only assembles the (700-player) stat arrays on these days.
 *  Day 105 is the stretch-run look — the awards races heat up down the wire. */
export const PLAYER_CHECKPOINT_DAYS = [30, 60, 90, 105]

/** Late-season days when the postseason picture tightens — used by the
 *  playoff-race detector (kept off the daily path so it reads as a beat). */
export const STRETCH_CHECKPOINT_DAYS = [95, 108, 116]

/** The breakout: a skater scoring like a star who isn't rated like one.
 *  The prior is his own rating — a 90-rated player leading the league is
 *  Tuesday; a 71-rated third-liner in the top handful of scorers is news. */
export function detectBreakoutSkater(ctx: SalienceCtx): SalienceCandidate[] {
  if (!ctx.skaters || !PLAYER_CHECKPOINT_DAYS.includes(ctx.day)) return []
  const qualified = ctx.skaters.filter((s) => s.gp >= 10)
  if (qualified.length < 50) return []
  const byPace = [...qualified].sort((a, b) => b.points / b.gp - a.points / a.gp)
  const out: SalienceCandidate[] = []
  for (let i = 0; i < Math.min(12, byPace.length); i++) {
    const s = byPace[i]!
    if (s.ratedOverall > 76) continue // scoring like he's rated — not a story
    const t = ctx.teams.get(s.teamId)
    if (!t) continue
    const pace = (s.points / s.gp) * 82
    out.push({
      key: `breakout-${s.playerId}-${ctx.year}`,
      score: Math.min(92, 46 + (76 - s.ratedOverall) * 1.5 + (12 - i) + (s.age <= 23 ? 8 : 0)),
      channel: 'feed',
      authorId: 'stats',
      text: `${s.name} check-in: ${s.points} points in ${s.gp} games — a ${Math.round(pace)}-point pace, ${ordinal(i + 1)} in the league. Nobody's model had him here. This is what a breakout looks like in the data.`,
      facts: {
        kind: 'breakoutSkater',
        playerIds: [s.playerId],
        teamIds: [s.teamId],
        numbers: { points: s.points, gp: s.gp, pace: Math.round(pace), paceRank: i + 1, ratedOverall: s.ratedOverall, day: ctx.day },
        priorNote: `rated ${s.ratedOverall} overall`,
      },
      teamId: s.teamId,
      playerId: s.playerId,
    })
  }
  return out
}

/** The quiet wall: a goalie stopping everything without the reputation.
 *  Needs a real workload so small samples don't canonize a backup's week. */
export function detectGoalieHeater(ctx: SalienceCtx): SalienceCandidate[] {
  if (!ctx.goalies || !PLAYER_CHECKPOINT_DAYS.includes(ctx.day)) return []
  const out: SalienceCandidate[] = []
  for (const g of ctx.goalies) {
    if (g.shotsAgainst < 250) continue
    const svPct = g.saves / g.shotsAgainst
    if (svPct < 0.93) continue
    const t = ctx.teams.get(g.teamId)
    if (!t) continue
    const unheralded = g.ratedOverall <= 78
    out.push({
      key: `goalieheat-${g.playerId}-${ctx.year}`,
      score: Math.min(90, Math.round((svPct - 0.93) * 2000) + (unheralded ? 52 : 34)),
      channel: 'feed',
      authorId: unheralded ? 'analyst' : 'stats',
      text: unheralded
        ? `Quiet story of the season so far: ${g.name} is at .${Math.round(svPct * 1000)} on ${g.shotsAgainst} shots for ${t.name}. That's elite work from a name nobody circled in September.`
        : `${g.name}: .${Math.round(svPct * 1000)} save percentage on ${g.shotsAgainst} shots. The workload is real and so is the number.`,
      facts: {
        kind: 'goalieHeater',
        playerIds: [g.playerId],
        teamIds: [g.teamId],
        numbers: { svPct: Math.round(svPct * 1000), shotsAgainst: g.shotsAgainst, ratedOverall: g.ratedOverall, day: ctx.day },
        priorNote: `rated ${g.ratedOverall} overall`,
      },
      teamId: g.teamId,
      playerId: g.playerId,
    })
  }
  return out
}

/** The Art Ross race: who leads the league in scoring, and is it a runaway or
 *  a dogfight? Fires at each player checkpoint so the story evolves — a comfy
 *  October lead becoming a March knife-fight is the whole point. */
export function detectScoringRace(ctx: SalienceCtx): SalienceCandidate[] {
  if (!ctx.skaters || !PLAYER_CHECKPOINT_DAYS.includes(ctx.day)) return []
  const qualified = ctx.skaters.filter((s) => s.gp >= 8)
  if (qualified.length < 20) return []
  const byPts = [...qualified].sort((a, b) => b.points - a.points)
  const leader = byPts[0]!
  const second = byPts[1]
  const t = ctx.teams.get(leader.teamId)
  if (!second || !t) return []
  const margin = leader.points - second.points
  const runaway = margin >= 8
  const tight = margin <= 3
  const stretch = ctx.day >= 100
  const text = runaway
    ? `The Art Ross race isn't much of one: ${leader.name} sits on ${leader.points} points, ${margin} clear of the field. ${stretch ? "Start engraving." : "His to lose from here."}`
    : tight
      ? `Art Ross watch — ${leader.name} (${leader.points}) and ${second.name} (${second.points}) are swapping the scoring lead night to night. ${stretch ? "This one runs to the last weekend." : "Long way to go, but what a duel."}`
      : `${leader.name} leads the league in scoring: ${leader.points} points, ${margin} up on ${second.name}. ${stretch ? "The stretch run decides the Art Ross." : "First real separation at the top."}`
  return [{
    key: `scorerace-artross-${ctx.year}-${ctx.day}`,
    score: Math.min(84, 58 + (tight ? 14 : 0) + (stretch ? 10 : 0) + (leader.teamId === ctx.userTeamId ? 8 : 0)),
    channel: 'feed',
    authorId: 'stats',
    text,
    facts: {
      kind: 'scoringRace',
      playerIds: [leader.playerId, second.playerId],
      teamIds: [leader.teamId],
      numbers: { leaderPoints: leader.points, secondPoints: second.points, margin, day: ctx.day },
    },
    teamId: leader.teamId,
    playerId: leader.playerId,
  }]
}

/** The Rocket Richard race: the pure goal-scoring lead. Sniper storylines are
 *  their own thing — a 50-in-50 chase doesn't care who's winning the Art Ross. */
export function detectGoalRace(ctx: SalienceCtx): SalienceCandidate[] {
  if (!ctx.skaters || !PLAYER_CHECKPOINT_DAYS.includes(ctx.day)) return []
  const qualified = ctx.skaters.filter((s) => s.gp >= 8)
  if (qualified.length < 20) return []
  const byGoals = [...qualified].sort((a, b) => b.goals - a.goals)
  const leader = byGoals[0]!
  const second = byGoals[1]
  const t = ctx.teams.get(leader.teamId)
  if (!second || !t || leader.goals < 10) return []
  const margin = leader.goals - second.goals
  const stretch = ctx.day >= 100
  const pace = leader.gp > 0 ? Math.round((leader.goals / leader.gp) * 82) : 0
  const tight = margin <= 2
  const text = tight
    ? `Rocket Richard race is on: ${leader.name} (${leader.goals}) and ${second.name} (${second.goals}) trading goals down the stretch. ${stretch ? "Whoever's hot in April takes it." : `${leader.name} on a ${pace}-goal pace.`}`
    : `${leader.name} owns the goal-scoring lead with ${leader.goals} — ${margin} up on the field, a ${pace}-goal pace. ${stretch ? "The Rocket looks spoken for." : "The league's most dangerous shooter right now."}`
  return [{
    key: `goalrace-rocket-${ctx.year}-${ctx.day}`,
    score: Math.min(84, 54 + Math.min(14, leader.goals - 10) + (tight ? 10 : 0) + (stretch ? 8 : 0) + (leader.teamId === ctx.userTeamId ? 8 : 0)),
    channel: 'feed',
    authorId: 'insider',
    text,
    facts: {
      kind: 'goalRace',
      playerIds: [leader.playerId, second.playerId],
      teamIds: [leader.teamId],
      numbers: { leaderGoals: leader.goals, secondGoals: second.goals, margin, pace, day: ctx.day },
    },
    teamId: leader.teamId,
    playerId: leader.playerId,
  }]
}

/** The Vezina conversation: the best save percentage on a real workload,
 *  reputation aside. Distinct from the goalie heater (which is about the
 *  UNheralded name) — this is simply who's playing the best goal. */
export function detectVezinaRace(ctx: SalienceCtx): SalienceCandidate[] {
  if (!ctx.goalies || !PLAYER_CHECKPOINT_DAYS.includes(ctx.day)) return []
  const qualified = ctx.goalies.filter((g) => g.shotsAgainst >= 200)
  if (qualified.length < 6) return []
  const byPct = [...qualified].sort((a, b) => b.saves / b.shotsAgainst - a.saves / a.shotsAgainst)
  const leader = byPct[0]!
  const second = byPct[1]
  const t = ctx.teams.get(leader.teamId)
  if (!second || !t) return []
  const lead = leader.saves / leader.shotsAgainst
  const nextPct = second.saves / second.shotsAgainst
  if (lead < 0.915) return [] // nobody's separated yet — not a race worth calling
  const margin = Math.round((lead - nextPct) * 1000)
  const stretch = ctx.day >= 100
  const text = margin <= 4
    ? `Vezina race is a coin flip: ${leader.name} (.${Math.round(lead * 1000)}) a hair ahead of ${second.name} (.${Math.round(nextPct * 1000)}). ${stretch ? "Voters will agonize." : "Two walls, one trophy."}`
    : `${leader.name} has the inside track on the Vezina — .${Math.round(lead * 1000)} on ${leader.shotsAgainst} shots, clear of the pack. ${stretch ? "Barring a collapse, it's his." : "The season's steadiest goaltending."}`
  return [{
    key: `vezinarace-${ctx.year}-${ctx.day}`,
    score: Math.min(82, 54 + (margin <= 4 ? 12 : 0) + (stretch ? 8 : 0) + (leader.teamId === ctx.userTeamId ? 8 : 0)),
    channel: 'feed',
    authorId: 'analyst',
    text,
    facts: {
      kind: 'vezinaRace',
      playerIds: [leader.playerId, second.playerId],
      teamIds: [leader.teamId],
      numbers: { leaderSvPct: Math.round(lead * 1000), secondSvPct: Math.round(nextPct * 1000), margin, day: ctx.day },
    },
    teamId: leader.teamId,
    playerId: leader.playerId,
  }]
}

/** The playoff race: within each conference the top four qualify, so the
 *  fourth-vs-fifth points gap late in the year is the league's tensest number.
 *  Fires only on the stretch checkpoints when a cutline battle is genuinely
 *  close — the beat every fanbase lives on in March. */
export function detectPlayoffRace(ctx: SalienceCtx): SalienceCandidate[] {
  if (!ctx.teamPoints || !ctx.teamConference) return []
  if (!STRETCH_CHECKPOINT_DAYS.includes(ctx.day)) return []
  const QUALIFIERS = 4
  const byConf = new Map<string, string[]>()
  for (const [teamId, conf] of ctx.teamConference) {
    if (!byConf.has(conf)) byConf.set(conf, [])
    byConf.get(conf)!.push(teamId)
  }
  const out: SalienceCandidate[] = []
  for (const [conf, members] of byConf) {
    if (members.length <= QUALIFIERS) continue
    const ranked = members
      .map((id) => ({ id, pts: ctx.teamPoints!.get(id) ?? 0 }))
      .sort((a, b) => b.pts - a.pts)
    const inSpot = ranked[QUALIFIERS - 1]
    const bubble = ranked[QUALIFIERS]
    if (!inSpot || !bubble) continue
    const gap = inSpot.pts - bubble.pts
    if (gap > 5) continue // not close enough to be a race
    const inTeam = ctx.teams.get(inSpot.id)
    const bubbleTeam = ctx.teams.get(bubble.id)
    if (!inTeam || !bubbleTeam) continue
    const left = ctx.teamGamesLeft?.get(bubble.id)
    const leftNote = left && left > 0 ? ` with ${left} to play` : ''
    const involvesUser = inSpot.id === ctx.userTeamId || bubble.id === ctx.userTeamId
    const text = gap === 0
      ? `Deadlock for the final playoff spot: ${inTeam.name} and ${bubbleTeam.name} are level on points${leftNote}. Every night is a knife-edge now.`
      : `The race for the last playoff spot is on — ${inTeam.name} cling to it by ${gap} point${gap === 1 ? '' : 's'} over ${bubbleTeam.name}${leftNote}. This is the stretch run that makes seasons.`
    out.push({
      key: `playoffrace-${conf}-${ctx.year}-${ctx.day}`,
      score: Math.min(86, 50 + (5 - gap) * 4 + (involvesUser ? 12 : 0)),
      channel: 'feed',
      authorId: 'wire',
      text,
      facts: {
        kind: 'playoffRace',
        teamIds: [inSpot.id, bubble.id],
        numbers: { gap, day: ctx.day, ...(left !== undefined ? { gamesLeft: left } : {}) },
      },
      teamId: involvesUser ? ctx.userTeamId : inSpot.id,
    })
  }
  return out
}

/** The Phase A detector library. Fan out here (ultracode session). */
export const DETECTORS: Array<(ctx: SalienceCtx) => SalienceCandidate[]> = [
  detectExpectationGap,
  detectStreakOutlier,
  detectBreakoutSkater,
  detectGoalieHeater,
  detectScoringRace,
  detectGoalRace,
  detectVezinaRace,
  detectPlayoffRace,
]

/* ────────────────────────── budget & novelty ────────────────────────── */

/** Max posts published per day — rarity in presentation is what makes a
 *  catch feel special. Everything else still reaches the chronicle/logs. */
export const DAILY_POST_BUDGET = 2
/** Candidates below this (post-dampening) never publish. */
export const MIN_PUBLISH_SCORE = 30

/** Novelty class: fires of the same *pattern* dampen each other save-wide,
 *  so what counts as remarkable evolves with the world's own history. */
export function noveltyClassOf(key: string): string {
  return key.split('-').slice(0, 2).join('-')
}

/**
 * Apply self-tuning novelty dampening + the daily budget. Returns the posts
 * to publish (score-desc) and the novelty keys/classes that fired (caller
 * persists the updated counts). Keys that already fired are dropped outright
 * (a 12-game streak is one post per band, forever).
 */
export function selectPosts(
  candidates: SalienceCandidate[],
  noveltyCounts: Map<string, number>,
  rng: Rng
): SalienceCandidate[] {
  const fresh = candidates.filter((c) => !noveltyCounts.has(c.key))
  const scored = fresh
    .map((c) => {
      const classCount = noveltyCounts.get(noveltyClassOf(c.key)) ?? 0
      // Each prior firing of the same pattern knocks ~12% off; jitter keeps
      // ties from resolving identically forever.
      const damp = Math.pow(0.88, classCount)
      return { c, eff: c.score * damp + rng.float(0, 2) }
    })
    .filter((x) => x.eff >= MIN_PUBLISH_SCORE)
    .sort((a, b) => b.eff - a.eff)
  return scored.slice(0, DAILY_POST_BUDGET).map((x) => x.c)
}

/* ────────────────────────── curation (Phase B) ────────────────────────── */

/** Posts at or above this salience reach the GM's inbox regardless of
 *  follows — you can curate a cozy bubble, but the game never lets a
 *  league-shaking story slip past you. */
export const INBOX_IMPORTANCE_FLOOR = 70

/** Should this post ALSO land in the inbox? Followed author, or important
 *  enough that any GM would hear about it by breakfast. */
export function shouldReachInbox(
  post: { score: number; authorId: string },
  followedAuthorIds: readonly string[]
): boolean {
  return post.score >= INBOX_IMPORTANCE_FLOOR || followedAuthorIds.includes(post.authorId)
}

/** Deterministic engagement numbers — bigger stories travel further. */
export function engagementFor(score: number, rng: Rng): { likes: number; reposts: number } {
  const likes = Math.round(score * rng.float(9, 26))
  return { likes, reposts: Math.round(likes * rng.float(0.12, 0.3)) }
}

function ordinal(n: number): string {
  const s = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'
  return `${n}${s}`
}
