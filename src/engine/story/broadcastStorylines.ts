/**
 * BROADCAST STORYLINES — what tonight's TV broadcast is ENTITLED to make a fuss
 * about, decided before the puck drops.
 *
 * The presentation layer (src/render2d/broadcast/director.ts) turns these into a
 * rookie lap, a tribute video, a banner raising, a "two points from 1,000" card.
 * Every one of those is a claim about a real career, so the rules live here, in
 * the engine, next to the data — and they are the same evidence rules the rest of
 * the story layer uses (careerLedger.ts): an empty in-sim ledger is NOT proof of a
 * debut, and a veteran whose career we can't see gets no milestone countdown.
 *
 * Pure: the career gathers {@link StorylineFacts} from live state and hands them
 * here; this module never touches Career. No filler: a night with nothing earned
 * yields an empty list and the broadcast simply opens clean.
 */

/** The broadcast storylines the game knows how to earn. */
export type StorylineKind =
  /** First NHL game tonight → rookie lap at warmups. */
  | 'debut'
  /** Long-tenured veteran's first game back in his old building → tribute video
   *  at the first TV timeout, standing ovation. */
  | 'homecoming'
  /** Faces the club that moved him on (recent trade / walk) — a card, no ovation. */
  | 'revenge'
  /** Within reach of a round career number (points/goals) → countdown card, and an
   *  ovation + milestone graphic if he gets there tonight. */
  | 'milestoneWatch'
  /** Plays his Nth career game tonight (500/1000/1500) → recognised at the first
   *  stoppage. */
  | 'milestoneGame'
  /** Home opener after a championship → banner raising before puck drop. */
  | 'bannerNight'
  /** First game back from a long injury layoff. */
  | 'injuryReturn'
  /** A number going to the rafters tonight. Wired end-to-end; NOTHING produces it
   *  yet (the sim never retires numbers in-save) — documented, not faked. */
  | 'jerseyRetirement'

export type BroadcastSide = 'home' | 'away'

export interface BroadcastStoryline {
  /** Stable id (kind + subject) — the director's no-repeat and seed key. */
  id: string
  kind: StorylineKind
  side: BroadcastSide
  playerId?: string
  /** Card title, e.g. "NHL DEBUT". */
  title: string
  /** Card body, e.g. "Ben Kindel, 19, plays his first NHL game". */
  detail: string
  /** Higher leads the pregame; ties keep detection order. */
  priority: number
  /** milestoneWatch / milestoneGame only. */
  milestone?: {
    stat: 'points' | 'goals' | 'games'
    /** Career count BEFORE tonight. */
    before: number
    target: number
  }
  /** homecoming / revenge: the old club. */
  formerTeamName?: string
}

/** One dressed player as the broadcast sees him. */
export interface BroadcastPlayer {
  id: string
  name: string
  side: BroadcastSide
  position: string
  jerseyNumber?: number
  faceId?: string
  nationality?: string
  /** Mod-supplied respelling for the booth ("NEH-chahs"). Optional. */
  pronunciation?: string
  /** Lower-third season line, e.g. "12 G · 18 A · 30 P" or ".915 · 10-5-2". */
  seasonLine: string
  /** Regular-season goals/assists BEFORE tonight (on-ice tag: "12 GOALS"). */
  seasonGoals: number
  seasonAssists: number
  /** Goalies: season saves before tonight. */
  seasonSaves?: number
  /** NHL career goals before tonight — present ONLY when the career is known
   *  (so "his first NHL goal" can never be claimed for an unrecorded veteran). */
  careerGoalsBefore?: number
  captain?: boolean
}

export interface BroadcastLineup {
  /** Starting five + goalie ids in TV order: C, LW, RW, D, D, G. May be short. */
  starters: string[]
  goalieId: string | null
  record: string
}

/**
 * Everything the broadcast package needs about tonight that the event stream
 * does not carry. Built pre-game by Career.buildBroadcastContext and fetched by
 * the renderer via the additive `getBroadcastContext` request.
 */
export interface BroadcastContext {
  /** `${year}:${day}:${homeId}:${awayId}` — also the director's seed. */
  gameKey: string
  year: number
  playoff: boolean
  arenaName: string | null
  homeTeamId: string
  awayTeamId: string
  homeName: string
  awayName: string
  homeAbbr: string
  awayAbbr: string
  homeColors: { primary: number; secondary: number }
  awayColors: { primary: number; secondary: number }
  home: BroadcastLineup
  away: BroadcastLineup
  /** Every dressed player on both benches, by id. */
  players: Record<string, BroadcastPlayer>
  storylines: BroadcastStoryline[]
}

/* ─────────────────────────── facts → storylines ─────────────────────────── */

/** The per-player evidence Career gathers for one dressed player. */
export interface PlayerStoryFacts {
  id: string
  name: string
  age: number
  position: string
  side: BroadcastSide
  /** Starting goalie tonight (backups can't debut or hit games milestones). */
  isStartingGoalie?: boolean
  /** NHL career totals BEFORE tonight: imported + archived + this season. */
  career: { goals: number; points: number; gamesPlayed: number }
  /**
   * Do we actually KNOW this man's career? True when the imported DB carries his
   * history for our league, when the sim has archived NHL seasons for him, or
   * when he's young enough (≤ DEBUT_PLAUSIBLE_MAX_AGE) that nothing can be
   * hiding. False → no debut claim, no milestone countdown.
   */
  careerKnown: boolean
  /** First game back after a long layoff (Career's returns ledger). */
  firstGameBackFromInjury?: boolean
  /**
   * The club he most recently left, when that exit makes tonight a story:
   * `tenureGames` = NHL games he played for them; `firstVisitSinceLeaving` =
   * no completed game yet this season at that building with him on the road.
   */
  formerClub?: {
    teamName: string
    isTonightsHome: boolean
    isTonightsOpponent: boolean
    tenureGames: number
    leftYear: number
    firstVisitSinceLeaving: boolean
    via: 'trade' | 'signing'
  }
}

export interface StorylineFacts {
  year: number
  playoff: boolean
  homeName: string
  /** The home club won the most recent championship on record. */
  homeIsDefendingChampion: boolean
  /** Tonight is the home club's first home game of the regular season. */
  homeOpener: boolean
  /** Name of the championship season, e.g. 2026, for the banner card. */
  championshipYear?: number
  players: PlayerStoryFacts[]
}

/** Point / goal / game marks the broadcast counts down to. Same ladders the
 *  news milestones use (Career.POINT_MILES etc.) so the card and the headline
 *  can never disagree. */
export const BROADCAST_POINT_MILES = [500, 1000, 1250, 1500, 1750, 2000] as const
export const BROADCAST_GOAL_MILES = [100, 200, 300, 400, 500, 600, 700, 800] as const
export const BROADCAST_GAME_MILES = [500, 1000, 1500] as const

/** A countdown card only when he can realistically get there tonight. */
const POINTS_WINDOW = 3
const GOALS_WINDOW = 2
/** Games with a club before a return is a tribute-video homecoming. */
export const HOMECOMING_MIN_TENURE_GAMES = 150

const fmt = (n: number): string => n.toLocaleString('en-US')

function nextMile(value: number, ladder: readonly number[]): number | null {
  for (const m of ladder) if (m > value) return m
  return null
}

/**
 * Decide tonight's storylines from the gathered facts. Deterministic, and only
 * ever returns things that are true: see each branch's evidence rule.
 */
export function detectStorylines(f: StorylineFacts): BroadcastStoryline[] {
  const out: BroadcastStoryline[] = []

  // Banner raising: home opener of the regular season, the home club are the
  // reigning champions on the record book (sim-won OR the imported real past).
  if (!f.playoff && f.homeOpener && f.homeIsDefendingChampion) {
    out.push({
      id: 'banner:home',
      kind: 'bannerNight',
      side: 'home',
      title: 'BANNER NIGHT',
      detail: `${f.homeName} raise the ${f.championshipYear ?? ''} championship banner`.replace('  ', ' '),
      priority: 100,
    })
  }

  for (const p of f.players) {
    const skaterOrStarter = p.position !== 'G' || p.isStartingGoalie === true

    // Debut: no NHL games on any record we trust, and a record we trust exists.
    if (skaterOrStarter && p.careerKnown && p.career.gamesPlayed === 0 && !f.playoff) {
      out.push({
        id: `debut:${p.id}`,
        kind: 'debut',
        side: p.side,
        playerId: p.id,
        title: 'NHL DEBUT',
        detail: `${p.name}, ${p.age}, plays his first NHL game`,
        priority: 90,
      })
    }
    // (A playoff debut is real too, but the rookie lap is a warmup tradition of
    // the regular season — it gets the card without the lap.)
    if (skaterOrStarter && p.careerKnown && p.career.gamesPlayed === 0 && f.playoff) {
      out.push({
        id: `debut:${p.id}`,
        kind: 'debut',
        side: p.side,
        playerId: p.id,
        title: 'NHL DEBUT',
        detail: `${p.name} makes his NHL debut in the playoffs`,
        priority: 85,
      })
    }

    // Homecoming / revenge: he left tonight's opponent, and this is his first trip back.
    const fc = p.formerClub
    if (fc && fc.isTonightsOpponent && fc.firstVisitSinceLeaving && f.year - fc.leftYear <= 1) {
      if (fc.isTonightsHome && fc.tenureGames >= HOMECOMING_MIN_TENURE_GAMES) {
        out.push({
          id: `homecoming:${p.id}`,
          kind: 'homecoming',
          side: p.side,
          playerId: p.id,
          title: 'HOMECOMING',
          detail: `${p.name} returns to ${fc.teamName} ice — ${fmt(fc.tenureGames)} games in this sweater`,
          priority: 80,
          formerTeamName: fc.teamName,
        })
      } else if (fc.via === 'trade') {
        out.push({
          id: `revenge:${p.id}`,
          kind: 'revenge',
          side: p.side,
          playerId: p.id,
          title: 'FIRST MEETING',
          detail: `${p.name} faces the ${fc.teamName}, who traded him ${fc.leftYear === f.year ? 'this season' : `in ${fc.leftYear}`}`,
          priority: 50,
          formerTeamName: fc.teamName,
        })
      }
    }

    // Injury return.
    if (p.firstGameBackFromInjury) {
      out.push({
        id: `return:${p.id}`,
        kind: 'injuryReturn',
        side: p.side,
        playerId: p.id,
        title: 'BACK IN THE LINEUP',
        detail: `${p.name} returns from injury tonight`,
        priority: 40,
      })
    }

    // Milestones — regular season only (NHL milestones count regular-season
    // games), and only for careers we can actually see.
    if (f.playoff || !p.careerKnown) continue
    if (skaterOrStarter) {
      const gm = nextMile(p.career.gamesPlayed, BROADCAST_GAME_MILES)
      if (gm !== null && p.career.gamesPlayed + 1 === gm) {
        out.push({
          id: `games:${p.id}:${gm}`,
          kind: 'milestoneGame',
          side: p.side,
          playerId: p.id,
          title: `${fmt(gm)} GAMES`,
          detail: `${p.name} plays his ${fmt(gm)}th NHL game tonight`,
          priority: 70,
          milestone: { stat: 'games', before: p.career.gamesPlayed, target: gm },
        })
      }
    }
    if (p.position === 'G') continue
    const pm = nextMile(p.career.points, BROADCAST_POINT_MILES)
    if (pm !== null && pm - p.career.points <= POINTS_WINDOW) {
      const need = pm - p.career.points
      out.push({
        id: `points:${p.id}:${pm}`,
        kind: 'milestoneWatch',
        side: p.side,
        playerId: p.id,
        title: `MILESTONE WATCH`,
        detail: `${p.name} is ${need === 1 ? 'one point' : `${need} points`} from ${fmt(pm)}`,
        priority: 60 + (POINTS_WINDOW - need),
        milestone: { stat: 'points', before: p.career.points, target: pm },
      })
    }
    const gl = nextMile(p.career.goals, BROADCAST_GOAL_MILES)
    if (gl !== null && gl - p.career.goals <= GOALS_WINDOW) {
      const need = gl - p.career.goals
      out.push({
        id: `goals:${p.id}:${gl}`,
        kind: 'milestoneWatch',
        side: p.side,
        playerId: p.id,
        title: `MILESTONE WATCH`,
        detail: `${p.name} is ${need === 1 ? 'one goal' : `${need} goals`} from ${fmt(gl)}`,
        priority: 58 + (GOALS_WINDOW - need),
        milestone: { stat: 'goals', before: p.career.goals, target: gl },
      })
    }
  }

  // Highest priority first; stable for equal priorities.
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.priority - a.s.priority || a.i - b.i)
    .map(({ s }) => s)
}
