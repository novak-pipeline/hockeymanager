/**
 * GM career: the manager's own identity, reputation, job history, and the rival
 * job market. Pure + deterministic + JSON-safe — the career layer owns the state
 * and feeds in season results; this module computes reputation and openings.
 *
 * Reputation (0–100) is the spine: it grows with playoff runs and Cups, erodes
 * with failure, and gates which clubs will court you when a seat opens up.
 */

export interface GMJobStint {
  teamId: string
  teamAbbr: string
  teamName: string
  fromYear: number
  /** null = the current job. */
  toYear: number | null
  seasons: number
  wins: number
  losses: number
  playoffApps: number
  cupWins: number
  endReason?: 'fired' | 'moved'
}

export interface GMState {
  name: string
  /** 0–100 industry reputation. */
  reputation: number
  // Career totals across every club managed.
  seasons: number
  wins: number
  losses: number
  playoffApps: number
  cupWins: number
  presidentsTrophies: number
  /** Job history, current stint last (toYear === null). */
  stints: GMJobStint[]
}

export function createGMState(
  name: string,
  startYear: number,
  teamId: string,
  teamAbbr: string,
  teamName: string
): GMState {
  return {
    name,
    reputation: 45, // unproven but employable
    seasons: 0,
    wins: 0,
    losses: 0,
    playoffApps: 0,
    cupWins: 0,
    presidentsTrophies: 0,
    stints: [
      { teamId, teamAbbr, teamName, fromYear: startYear, toYear: null, seasons: 0, wins: 0, losses: 0, playoffApps: 0, cupWins: 0 },
    ],
  }
}

/** The open (current) stint, or undefined if between jobs. */
export function currentStint(gm: GMState): GMJobStint | undefined {
  const last = gm.stints[gm.stints.length - 1]
  return last && last.toYear === null ? last : undefined
}

export interface SeasonResultInput {
  wins: number
  losses: number
  madePlayoffs: boolean
  wonCup: boolean
  wonPresidents: boolean
  /** 1 = best. */
  finalRank: number
  /** teams in the league. */
  n: number
}

/**
 * Fold a finished season into the GM's career + reputation. Reputation moves
 * toward what the season "earned": Cups and deep finishes lift it, bottom-feeding
 * erodes it, with a gentle pull toward the middle so one season never defines a
 * career. Mutates `gm` in place.
 */
export function recordSeasonResult(gm: GMState, r: SeasonResultInput): void {
  gm.seasons += 1
  gm.wins += r.wins
  gm.losses += r.losses
  if (r.madePlayoffs) gm.playoffApps += 1
  if (r.wonCup) gm.cupWins += 1
  if (r.wonPresidents) gm.presidentsTrophies += 1

  const stint = currentStint(gm)
  if (stint) {
    stint.seasons += 1
    stint.wins += r.wins
    stint.losses += r.losses
    if (r.madePlayoffs) stint.playoffApps += 1
    if (r.wonCup) stint.cupWins += 1
  }

  // Reputation delta from the season's outcome.
  let delta = 0
  if (r.wonCup) delta += 14
  else if (r.finalRank <= Math.ceil(r.n * 0.1)) delta += 7 // top ~10%
  else if (r.madePlayoffs) delta += 4
  if (r.wonPresidents) delta += 3
  if (!r.madePlayoffs) delta -= 4
  if (r.finalRank > Math.ceil(r.n * 0.8)) delta -= 4 // bottom ~20%

  // Gentle mean-reversion toward 50 so reputation drifts, not ratchets.
  delta += (50 - gm.reputation) * 0.05

  gm.reputation = Math.max(0, Math.min(100, Math.round(gm.reputation + delta)))
}

/** Close the current stint (fired or moved on). */
export function endStint(gm: GMState, year: number, reason: 'fired' | 'moved'): void {
  const stint = currentStint(gm)
  if (!stint) return
  stint.toYear = year
  stint.endReason = reason
  if (reason === 'fired') gm.reputation = Math.max(0, gm.reputation - 6)
}

/** Open a new stint at a club. */
export function startStint(gm: GMState, year: number, teamId: string, teamAbbr: string, teamName: string): void {
  gm.stints.push({ teamId, teamAbbr, teamName, fromYear: year, toYear: null, seasons: 0, wins: 0, losses: 0, playoffApps: 0, cupWins: 0 })
}

export type GMTier = 'Unproven' | 'Journeyman' | 'Respected' | 'Established' | 'Elite' | 'Legendary'

export function reputationTier(rep: number): GMTier {
  if (rep >= 92) return 'Legendary'
  if (rep >= 80) return 'Elite'
  if (rep >= 65) return 'Established'
  if (rep >= 50) return 'Respected'
  if (rep >= 35) return 'Journeyman'
  return 'Unproven'
}

/* ────────────────────────── rival job market ────────────────────────── */

export interface GMJobOpening {
  teamId: string
  teamName: string
  teamAbbr: string
  /** Projected finish (1 = best) — the kind of club this is. */
  projectedRank: number
  marketSize: number
  /** How keen they are on hiring THIS GM, given his reputation. */
  interest: 'courting' | 'open' | 'longshot'
  blurb: string
}

/**
 * Decide a club's appetite for the user given his reputation and the club's
 * stature. Big-market / contending clubs want a proven name; rebuilders will
 * take a flier on an up-and-comer.
 */
function interestFor(rep: number, projectedRank: number, n: number): GMJobOpening['interest'] {
  const eliteClub = projectedRank <= Math.ceil(n * 0.33)
  if (eliteClub) {
    if (rep >= 70) return 'courting'
    if (rep >= 55) return 'open'
    return 'longshot'
  }
  // Mid / rebuilding clubs are more accessible.
  if (rep >= 55) return 'courting'
  if (rep >= 38) return 'open'
  return 'longshot'
}

const BLURB: Record<GMJobOpening['interest'], string> = {
  courting: 'Ownership is actively courting you for the role.',
  open: 'The seat is open and your name is in the mix.',
  longshot: 'A long shot — they would need convincing.',
}

/**
 * Build the GM vacancy list from the clubs that have an opening this offseason
 * (`openTeamIds`), excluding the user's own club. `projectedRankOf` gives each
 * club's strength rank (1 = best). Pure: ordering is by club stature.
 */
export function buildGMJobMarket(args: {
  openings: Array<{ teamId: string; teamName: string; teamAbbr: string; marketSize: number; projectedRank: number }>
  userTeamId: string
  reputation: number
  n: number
}): GMJobOpening[] {
  const { openings, userTeamId, reputation, n } = args
  return openings
    .filter((o) => o.teamId !== userTeamId)
    .map((o) => {
      const interest = interestFor(reputation, o.projectedRank, n)
      return {
        teamId: o.teamId,
        teamName: o.teamName,
        teamAbbr: o.teamAbbr,
        projectedRank: o.projectedRank,
        marketSize: o.marketSize,
        interest,
        blurb: BLURB[interest],
      }
    })
    .sort((a, b) => a.projectedRank - b.projectedRank)
}
