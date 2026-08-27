/**
 * CLUB BEATS — the organisation is bigger than the twenty men who dress.
 *
 * Playtest 2026-08-26 §E1: "the game is about the entire club system not just
 * the NHL players." A real GM's year is punctuated by the farm and the draft
 * class — a kid running away with his junior league, a first-rounder who has
 * stopped scoring, a nineteen-year-old's first professional goal, the affiliate
 * making a run. None of that reached the GM's desk.
 *
 * The hard constraint came with the ask: "DONT SPAM IT... keep it balanced and
 * not annoying." So this module is built around restraint rather than coverage:
 *
 *   - A beat must clear a real THRESHOLD. No "so-and-so played a game" filler.
 *   - One beat per subject per KIND per season, ever. The ledger is the memory.
 *   - A hard cooldown between beats, and a season-wide ceiling.
 *   - Ranked by how notable it is, so if two things happen the better one runs.
 *
 * Pure + deterministic + JSON-safe: facts in, at most one beat out. The career
 * layer gathers the facts, owns the ledger, and pushes the news.
 */

import type { NewsCategory } from '@domain/news'

/* ────────────────────────── types ────────────────────────── */

/** Where a prospect is playing. Drives both the threshold and the prose. */
export type ProspectWhere = 'nhl' | 'ahl' | 'junior'

/** One organisation player, digested by the career layer. */
export interface ProspectFact {
  playerId: string
  name: string
  position: string
  age: number
  where: ProspectWhere
  /** The competition he is actually playing in ("AHL", "OHL", "SHL"…). */
  leagueLabel: string
  /** Club he skates for, when it is not the NHL/AHL pair. */
  clubLabel?: string
  gamesPlayed: number
  goals: number
  points: number
  /** Goalie only: season save percentage as a fraction (0.915). */
  savePct?: number
  /** Where the club took him, when the club took him. */
  draftRound?: number
  draftOverall?: number
  draftYear?: number
  /** Scouted ceiling, 0–100. */
  potential: number
  /** Current rated ability, 0–100. */
  overall: number
}

export type ClubBeatKind = 'tear' | 'stalled' | 'firstPro' | 'kickingTheDoor' | 'goalieForm'

export interface ClubBeat {
  /** `<playerId>:<kind>` — the ledger key that stops it ever repeating. */
  key: string
  kind: ClubBeatKind
  category: NewsCategory
  headline: string
  body: string
  playerId: string
  /** 0–100; the cadence classifier reads this to decide on interruptions. */
  salience: number
  /** Internal ranking score — higher wins when several fire on the same day. */
  score: number
}

/** Quiet days between farm beats. A month, near enough. */
export const CLUB_BEAT_COOLDOWN_DAYS = 24
/** Ceiling for one season. The farm is a subplot, not the show. */
export const MAX_CLUB_BEATS_PER_SEASON = 5
/**
 * How often the organisation is actually walked looking for a beat. Gathering
 * every prospect in the world is not free, and nothing about a farm story is
 * urgent enough to justify doing it daily.
 */
export const CLUB_BEAT_CHECK_EVERY_DAYS = 6

/* ────────────────────────── the detectors ────────────────────────── */

const ppg = (f: ProspectFact): number => (f.gamesPlayed > 0 ? f.points / f.gamesPlayed : 0)

/**
 * The scoring pace that counts as "running away with it", by level. A point a
 * game in the AHL at nineteen is a story; in junior it is Tuesday.
 */
function tearThreshold(where: ProspectWhere): number {
  switch (where) {
    case 'junior': return 1.55
    case 'ahl':    return 0.95
    case 'nhl':    return 0.85
  }
}

/** Minimum sample before anybody says anything at all. */
const MIN_GAMES = 18

function pedigree(f: ProspectFact): string {
  if (f.draftOverall !== undefined && f.draftYear !== undefined) {
    return `the ${ordinal(f.draftOverall)} pick in ${f.draftYear}`
  }
  if (f.draftRound !== undefined) return `a ${ordinal(f.draftRound)}-round pick`
  return 'a player in your system'
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

function whereLine(f: ProspectFact): string {
  if (f.where === 'ahl') return `with the affiliate`
  if (f.where === 'junior') return `in the ${f.leagueLabel}${f.clubLabel ? ` with ${f.clubLabel}` : ''}`
  return `in the NHL`
}

/** Build every beat this org has earned today, unranked and unfiltered. */
export function detectClubBeats(args: {
  prospects: readonly ProspectFact[]
  /** Keys already told, this career. */
  told: ReadonlySet<string>
}): ClubBeat[] {
  const out: ClubBeat[] = []
  for (const f of args.prospects) {
    if (f.gamesPlayed < MIN_GAMES) continue

    /* ── the kid is running away with his league ── */
    if (f.position !== 'G' && ppg(f) >= tearThreshold(f.where)) {
      const key = `${f.playerId}:tear`
      if (!args.told.has(key)) {
        out.push({
          key, kind: 'tear', category: 'milestone', playerId: f.playerId, salience: 58,
          score: 40 + (ppg(f) - tearThreshold(f.where)) * 40 + (f.potential - 60) * 0.3,
          headline: `${f.name} is running away with the ${f.leagueLabel}`,
          body:
            `${f.name}, ${f.age}, ${pedigree(f)}, has ${f.points} points in ${f.gamesPlayed} games ` +
            `${whereLine(f)} — ${ppg(f).toFixed(2)} a game. ` +
            `Your development staff have started using the word "ready" in sentences about him. ` +
            `Whether they are right is a different question, and it is yours.`,
        })
      }
    }

    /* ── a real pick who has stopped producing ── */
    const highPick = (f.draftOverall ?? 999) <= 45 || f.potential >= 78
    if (f.position !== 'G' && highPick && f.gamesPlayed >= 25 && ppg(f) <= 0.33) {
      const key = `${f.playerId}:stalled`
      if (!args.told.has(key)) {
        out.push({
          key, kind: 'stalled', category: 'league', playerId: f.playerId, salience: 56,
          score: 34 + (f.potential - 60) * 0.4,
          headline: `${f.name} has stalled ${whereLine(f)}`,
          body:
            `${f.points} points in ${f.gamesPlayed} games from ${pedigree(f)}. ` +
            `The staff are split on whether it is deployment, confidence, or the truth about the player. ` +
            `Nobody in the room wants to be the first to say the third one.`,
        })
      }
    }

    /* ── first professional games ── */
    if (f.where === 'ahl' && f.age <= 21 && f.gamesPlayed >= 20 && f.gamesPlayed <= 34) {
      const key = `${f.playerId}:firstPro`
      if (!args.told.has(key)) {
        out.push({
          key, kind: 'firstPro', category: 'milestone', playerId: f.playerId, salience: 48,
          score: 20 + (f.potential - 60) * 0.35,
          headline: `${f.name} has ${f.gamesPlayed} pro games behind him now`,
          body:
            `The first professional season is the one that tells you what a prospect is. ` +
            `${f.name}, ${f.age}, has ${f.goals} goals and ${f.points} points in ${f.gamesPlayed} games with the affiliate. ` +
            `Coaches down there say the pace has stopped surprising him.`,
        })
      }
    }

    /* ── he is knocking on the door of the big club ── */
    if (f.where === 'ahl' && f.gamesPlayed >= 25 && f.overall >= 70 && ppg(f) >= 0.75) {
      const key = `${f.playerId}:kickingTheDoor`
      if (!args.told.has(key)) {
        out.push({
          key, kind: 'kickingTheDoor', category: 'milestone', playerId: f.playerId, salience: 62,
          score: 45 + (f.overall - 68) * 2,
          headline: `${f.name} has outgrown the AHL`,
          body:
            `${f.points} points in ${f.gamesPlayed} games, and the affiliate's staff have stopped pretending this is ` +
            `a development assignment. He is a better player than at least one man dressing for you on Saturday. ` +
            `The only question left is which one.`,
        })
      }
    }

    /* ── a young goalie holding a league up ── */
    if (f.position === 'G' && f.savePct !== undefined && f.gamesPlayed >= 20 && f.savePct >= 0.925) {
      const key = `${f.playerId}:goalieForm`
      if (!args.told.has(key)) {
        out.push({
          key, kind: 'goalieForm', category: 'milestone', playerId: f.playerId, salience: 56,
          score: 38 + (f.savePct - 0.925) * 600,
          headline: `${f.name} is stopping everything ${whereLine(f)}`,
          body:
            `A .${Math.round(f.savePct * 1000)} save percentage across ${f.gamesPlayed} games from ${pedigree(f)}. ` +
            `Goalies lie to you more than skaters do — but twenty games is twenty games, and your goalie coach is ` +
            `no longer hedging when you ask about him.`,
        })
      }
    }
  }
  return out
}

/**
 * The one beat worth the GM's attention today, or null.
 *
 * `daysSinceLast` and `toldThisSeason` are the whole anti-spam contract: a beat
 * needs a quiet month behind it and a season that has not already had its fill.
 */
export function pickClubBeat(args: {
  prospects: readonly ProspectFact[]
  told: ReadonlySet<string>
  daysSinceLast: number
  toldThisSeason: number
}): ClubBeat | null {
  if (args.daysSinceLast < CLUB_BEAT_COOLDOWN_DAYS) return null
  if (args.toldThisSeason >= MAX_CLUB_BEATS_PER_SEASON) return null
  const beats = detectClubBeats({ prospects: args.prospects, told: args.told })
  if (beats.length === 0) return null
  // Stable order: score first, then key, so the same facts always pick the same
  // story without any Rng at all.
  beats.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
  return beats[0] ?? null
}

/* ────────────────────────── the farm briefing ────────────────────────── */

/**
 * The prospect-group summary a staff meeting opens with — the same facts, read
 * out loud rather than mailed. Returns null when the org has nothing worth a
 * minute of the room's time.
 */
export function farmBriefing(prospects: readonly ProspectFact[]): {
  headline: string
  facts: string[]
} | null {
  const played = prospects.filter((p) => p.gamesPlayed >= 10)
  if (played.length < 3) return null

  const skaters = played.filter((p) => p.position !== 'G')
  const ranked = [...skaters].sort((a, b) => ppg(b) - ppg(a))
  const risers = ranked.slice(0, 2)
  const strugglers = ranked
    .filter((p) => (p.draftOverall ?? 999) <= 60 || p.potential >= 76)
    .slice(-1)
    .filter((p) => ppg(p) <= 0.4)

  const facts: string[] = []
  for (const r of risers) {
    facts.push(
      `${r.name} (${r.age}, ${r.position}) — ${r.points} in ${r.gamesPlayed} ${whereLine(r)}, ${ppg(r).toFixed(2)}/gm.`
    )
  }
  const goalies = played.filter((p) => p.position === 'G' && p.savePct !== undefined)
  if (goalies[0]) {
    const g = goalies[0]
    facts.push(`${g.name} (${g.age}, G) — .${Math.round((g.savePct ?? 0) * 1000)} across ${g.gamesPlayed} ${whereLine(g)}.`)
  }
  for (const s of strugglers) {
    facts.push(`${s.name} (${s.age}, ${s.position}) — ${s.points} in ${s.gamesPlayed}. Below where we projected him.`)
  }
  if (facts.length === 0) return null

  const inJuniors = played.filter((p) => p.where === 'junior').length
  const onFarm = played.filter((p) => p.where === 'ahl').length
  return {
    headline: `The system: ${onFarm} on the farm, ${inJuniors} still in junior`,
    facts,
  }
}
