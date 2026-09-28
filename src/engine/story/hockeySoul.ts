/**
 * HOCKEY SOUL — the sport-specific story structures FM cannot have
 * (owner-approved Phase 3 epic): the code, line nicknames, the Conn Smythe,
 * the handshake line, playoff beards, a day with the Cup, the EBUG.
 *
 * Pure: facts in, choices and words out. The career layer decides when each
 * one happens (always off real sim state) and applies any consequence.
 */

/* ───────────────────────── the code ───────────────────────── */

export interface HitterCandidate {
  id: string
  name: string
  /** Hits credited in tonight's game. */
  hits: number
  /** 1–99 aggression rating. */
  aggression: number
}

/**
 * Who laid the hit? The opponent who threw the most hits tonight, with his
 * aggression as the tie-break — and only if he is a genuinely physical,
 * aggressive player. A fragile man going down on his own is an injury, not a
 * debt; the code only exists when somebody did something.
 */
export function pickHitter(cands: readonly HitterCandidate[]): HitterCandidate | null {
  const physical = cands.filter((c) => c.hits >= 2 && c.aggression >= 62)
  if (physical.length === 0) return null
  return [...physical].sort((a, b) => b.hits - a.hits || b.aggression - a.aggression || (a.id < b.id ? -1 : 1))[0]!
}

/** Player Safety takes a look when the hitter is a repeat-type player. */
export function playerSafetyFine(aggression: number): number | null {
  if (aggression < 85) return null
  return aggression >= 90 ? 5000 : 2500
}

/* ───────────────────────── line nicknames ───────────────────────── */

export interface LineMate {
  id: string
  name: string
  age: number
  nationality?: string | undefined
}

/** A trio earns a name when it has played together long enough and produced. */
export const NICKNAME_MIN_GP = 15
export const NICKNAME_MIN_PPG = 2.0

const DEMONYM: Record<string, string> = {
  SWE: 'Swedish', FIN: 'Finnish', RUS: 'Russian', CZE: 'Czech', SVK: 'Slovak', USA: 'American',
  CAN: 'Canadian', GER: 'German', SUI: 'Swiss', LAT: 'Latvian', DEN: 'Danish', NOR: 'Norwegian',
  AUT: 'Austrian', BLR: 'Belarusian', FRA: 'French',
}

const surname = (name: string): string => name.trim().split(/\s+/).slice(-1)[0] ?? name

/**
 * The name the dressing room (or the city) gives a line that clicks. The
 * young one gets the oldest name in hockey; a line of countrymen gets its
 * flag; otherwise the initials, the way the papers do it.
 */
export function lineNickname(mates: readonly LineMate[]): string {
  if (mates.length === 3 && mates.every((m) => m.age <= 22)) return 'the Kid Line'
  const nat = new Map<string, number>()
  for (const m of mates) if (m.nationality) nat.set(m.nationality, (nat.get(m.nationality) ?? 0) + 1)
  for (const [n, c] of nat) {
    if (c === 3 && DEMONYM[n]) return `the ${DEMONYM[n]} Line`
  }
  if (mates.length === 3 && mates.every((m) => m.age >= 31)) return 'the Old Guard'
  const initials = mates.map((m) => surname(m.name).charAt(0).toUpperCase()).join('')
  return `the ${initials} Line`
}

/* ───────────────────────── the Conn Smythe ───────────────────────── */

export interface PlayoffLine {
  id: string
  name: string
  teamId: string
  position: string
  gp: number
  goals: number
  assists: number
  saves: number
  shotsAgainst: number
}

/**
 * The playoff MVP. A goalie who stole the spring (heavy workload, .925+) is
 * weighed against the leading scorer; the winner comes from the champion
 * unless someone elsewhere was simply undeniable (the Giguère exception).
 */
export function connSmythe(lines: readonly PlayoffLine[], championId: string): { winner: PlayoffLine; why: string } | null {
  const score = (l: PlayoffLine): number => {
    if (l.position === 'G') {
      if (l.gp < 10 || l.shotsAgainst < 250) return 0
      const sv = l.saves / l.shotsAgainst
      return Math.max(0, (sv - 0.9) * 1000) + l.gp * 0.6
    }
    return (l.goals + l.assists) * 1.0 + l.goals * 0.25
  }
  const ranked = [...lines].filter((l) => l.gp > 0).sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1))
  if (ranked.length === 0) return null
  const champ = ranked.find((l) => l.teamId === championId)
  const top = ranked[0]!
  const winner = champ && score(top) < score(champ) * 1.35 ? champ : top
  if (score(winner) <= 0) return null
  const why = winner.position === 'G'
    ? `${winner.gp} games, a ${(winner.saves / winner.shotsAgainst).toFixed(3).replace(/^0/, '')} save percentage`
    : `${winner.goals} goals and ${winner.goals + winner.assists} points in ${winner.gp} games`
  return { winner, why }
}

/* ───────────────────────── Cup traditions ───────────────────────── */

/** The handshake line after a series, win or lose — the sport's best ritual. */
export function handshakeLine(args: {
  won: boolean
  ourCaptain: string
  theirCaptain: string
  oppName: string
  games: string
}): string {
  return args.won
    ? `Then the handshake line. ${args.ourCaptain} was first in it, and he held on to ${args.theirCaptain} a second longer than the cameras expected. ${args.games} against the ${args.oppName}, and whatever was said in the corners stayed there.`
    : `Then the handshake line, which is the hardest thing the sport asks of anyone. ${args.ourCaptain} went down it first, ${args.theirCaptain} said something nobody else could hear, and the ${args.oppName} went on without them.`
}

/** Playoff beards: the razors go in the drawer when the club qualifies. */
export function beardsLine(captain: string): string {
  return `The razors went into the drawer this morning. ${captain} set the tone the way captains do: nobody shaves until it is over, one way or another.`
}

/** A day with the Cup, for the champions' summer. */
export function dayWithTheCup(name: string, nationality: string | undefined, idx: number): string {
  const where = nationality && DEMONYM[nationality] ? `home to ${DEMONYM[nationality]} soil` : 'home'
  const scenes = [
    `took the Cup ${where}: the rink he learned on, a line of kids around the block, and his first coach allowed to hold it for exactly as long as he wanted.`,
    `took the Cup ${where} and ate cereal out of it, which has been done before and will be done again, and is still the right call.`,
    `took the Cup ${where}, to the hospital ward he visits every summer, and stayed until the last visitor had gone.`,
  ]
  return `${name} ${scenes[idx % scenes.length]}`
}

/* ───────────────────────── the EBUG ───────────────────────── */

const EBUG_JOBS = ['an accountant', 'a Zamboni driver', 'a high-school teacher', 'a beer-league regular', 'a building-operations manager']

/** The emergency backup goaltender: a local who dresses when the club is down to one. */
export function ebugVignette(args: { club: string; city: string; seed: number }): { name: string; text: string } {
  const first = ['Dave', 'Scott', 'Tom', 'Chris', 'Matt'][args.seed % 5]!
  const last = ['Ayres', 'Foster', 'Hartley', 'Morris', 'Keller'][Math.floor(args.seed / 5) % 5]!
  const job = EBUG_JOBS[Math.floor(args.seed / 25) % EBUG_JOBS.length]!
  const name = `${first} ${last}`
  return {
    name,
    text: `With one healthy goaltender in the building, the ${args.club} dressed their emergency backup: ${name}, ${job} from ${args.city}, who signed an amateur tryout in the afternoon and sat at the end of the bench in a borrowed mask. He did not play. He will tell the story for the rest of his life anyway.`,
  }
}
