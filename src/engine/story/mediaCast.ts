/**
 * The media CAST — who covers a club, and how loud the market around it is
 * (docs/MEDIA-SIMULATION-RESEARCH.md §2, §5; docs/MEDIA-BEAT.md).
 *
 * Every NHL club gets one local beat outlet with one lead writer: the Pittsburgh
 * Hockey Now model — an independent, credentialed daily outlet that is at every
 * practice, grades every game and answers the mail. Names are fictional and
 * derived from the club id, so a club keeps the same writer for the whole save
 * without any saved state (and two saves of the same league agree).
 *
 * The cast is deliberately small and fixed so identities never collide:
 *   · the club's BEAT WRITER (this module; press persona `beat`)
 *   · Sam Carver, columnist at The Daily Gazette (@CarverNotes — the analyst
 *     account; he writes opinion, not practice notes)
 *   · Vic Mercer, national insider (@MercerHockey; press persona `national`)
 *   · Bobby "Buzz" Doyle, 990 The Fan (press persona `homer`)
 *
 * Market heat scales VOLUME and EDGE, never truth: a big Canadian market gets
 * more pieces a day, faster hot-seat talk and columns that reach the owner's
 * desk; a sunbelt club gets one writer and a quieter building.
 *
 * Pure: no Rng, no clock. Everything is a function of the team.
 */

/* ────────────────────────── types ────────────────────────── */

export interface BeatWriter {
  name: string
  first: string
  last: string
  /** Social handle, no @. */
  handle: string
}

export interface BeatOutlet {
  teamId: string
  /** Masthead name, e.g. "Pittsburgh Puck Report". */
  outlet: string
  /** One-line motto under the masthead. */
  tagline: string
  writer: BeatWriter
  /** Feed author id for the writer's account. */
  authorId: string
}

export type MarketTier = 1 | 2 | 3

export interface MarketProfile {
  tier: MarketTier
  canadian: boolean
  /** Human label for the UI ("Hockey-mad Canadian market"). */
  label: string
  /** Multiplier on how much the media's mood reaches the owner (§5 knob). */
  boardEdge: number
  /** Beat pieces the outlet runs on a game day (1 small … 3 big). */
  piecesPerGameDay: number
  /** Losing streak that brings the GM to the podium. */
  presserSkid: number
  /** Coach seat heat at which the hot-seat talk starts. */
  hotSeatAt: number
}

export interface CastTeam {
  id: string
  name: string
  city: string
  abbreviation: string
}

/* ────────────────────────── helpers ────────────────────────── */

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** "Pittsburgh Penguins" → "Penguins"; "Toronto Maple Leafs" → "Maple Leafs". */
export function clubNickname(team: CastTeam): string {
  const city = team.city.trim()
  if (city && team.name.startsWith(city)) {
    const rest = team.name.slice(city.length).trim()
    if (rest) return rest
  }
  const words = team.name.trim().split(/\s+/)
  return words.length > 1 ? words.slice(1).join(' ') : team.name
}

/* ────────────────────────── the beat outlet ────────────────────────── */

const OUTLET_PATTERNS: Array<(city: string, nick: string) => string> = [
  (city) => `${city} Puck Report`,
  (city) => `${city} Hockey Daily`,
  (_c, nick) => `The ${nick} Beat`,
  (city) => `${city} Ice Desk`,
  (city) => `${city} Rink Report`,
  (_c, nick) => `Inside the ${nick}`,
  (city) => `${city} Hockey Press`,
  (city) => `${city} Blue Line`,
]

const TAGLINES = [
  'Every practice. Every game. Every day.',
  'We cover one team, and we cover it every day.',
  'At the rink before you are awake.',
  'Lines, grades and the stuff the club will not tell you.',
  'Independent. Credentialed. At every skate.',
  'The daily read on your team.',
]

const FIRST_NAMES = [
  'Dana', 'Mike', 'Josh', 'Katie', 'Ryan', 'Seth', 'Nate', 'Emily', 'Chris', 'Jesse',
  'Luke', 'Adam', 'Maria', 'Pat', 'Owen', 'Tessa', 'Greg', 'Dom', 'Colin', 'Jenna',
  'Marty', 'Shawn', 'Kelly', 'Aaron', 'Brooke', 'Tyler', 'Jordan', 'Nick',
]

const LAST_NAMES = [
  'Kowal', 'Brannigan', 'Fenwick', 'Laraque', 'Oduya', 'Heffernan', 'Stasiak', 'Moreau',
  'Tolbert', 'Radulski', 'Vachon', 'Kerrigan', 'Lindqvist', 'Dufresne', 'Mahony', 'Pruitt',
  'Carlin', 'Ostrowski', 'Beaudry', 'Halvorsen', 'Quintal', 'McCaffery', 'Szabo', 'Renaud',
  'Garrow', 'Whitlock', 'Delorme', 'Kaminski',
]

/** Names already in use by the national cast — a beat writer never shares one. */
const RESERVED_LAST = new Set(['Carver', 'Mercer', 'Doyle'])

/** The club's beat outlet and its lead writer. Stable per club for the save. */
export function beatOutletFor(team: CastTeam): BeatOutlet {
  const h = hash(`beat|${team.id}`)
  const nick = clubNickname(team)
  const city = team.city.trim() || nick
  const outlet = OUTLET_PATTERNS[h % OUTLET_PATTERNS.length]!(city, nick)
  const tagline = TAGLINES[(h >>> 5) % TAGLINES.length]!
  const first = FIRST_NAMES[(h >>> 9) % FIRST_NAMES.length]!
  let last = LAST_NAMES[(h >>> 15) % LAST_NAMES.length]!
  if (RESERVED_LAST.has(last)) last = LAST_NAMES[0]!
  const handle = `${first}${last}${team.abbreviation}`.replace(/[^A-Za-z0-9_]/g, '').slice(0, 15)
  return {
    teamId: team.id,
    outlet,
    tagline,
    writer: { name: `${first} ${last}`, first, last, handle },
    authorId: `beat:${team.id}`,
  }
}

/* ────────────────────────── market heat ────────────────────────── */

const CANADIAN = ['toronto', 'montreal', 'montréal', 'vancouver', 'edmonton', 'calgary', 'ottawa', 'winnipeg', 'quebec', 'québec', 'hamilton', 'halifax']
/** Original Six and the other markets where hockey is the first sport in town. */
const BIG = ['boston', 'chicago', 'detroit', 'new york', 'philadelphia']
/** Real hockey towns without the national fishbowl. */
const MID = ['pittsburgh', 'washington', 'st. louis', 'st louis', 'minnesota', 'saint paul', 'st. paul', 'buffalo', 'los angeles', 'denver', 'colorado', 'new jersey', 'newark', 'seattle']
/** Sunbelt and newer markets: a handful of reporters postgame. */
const SMALL = ['sunrise', 'florida', 'tampa', 'raleigh', 'carolina', 'nashville', 'columbus', 'arizona', 'phoenix', 'glendale', 'tempe', 'utah', 'salt lake', 'san jose', 'anaheim', 'dallas', 'las vegas', 'vegas', 'atlanta', 'long island', 'uniondale', 'elmont']

function cityMatches(list: string[], team: CastTeam): boolean {
  const c = `${team.city} ${team.name}`.toLowerCase()
  return list.some((k) => c.includes(k))
}

/** How loud the market around this club is. */
export function marketProfile(team: CastTeam): MarketProfile {
  const canadian = cityMatches(CANADIAN, team)
  let tier: MarketTier
  if (canadian || cityMatches(BIG, team)) tier = 3
  else if (cityMatches(SMALL, team)) tier = 1
  else if (cityMatches(MID, team)) tier = 2
  else {
    // A fictional city: the same stable hash the finances screen uses for its
    // market label, folded onto three tiers.
    const t = hash(team.id) % 5
    tier = t <= 1 ? 1 : t <= 3 ? 2 : 3
  }
  const label = canadian
    ? 'Hockey-mad Canadian market'
    : tier === 3
      ? 'Big, demanding market'
      : tier === 2
        ? 'Established hockey market'
        : 'Quiet, small market'
  return {
    tier,
    canadian,
    label,
    boardEdge: tier === 3 ? 1.5 : tier === 2 ? 1 : 0.5,
    piecesPerGameDay: tier,
    presserSkid: tier === 3 ? 3 : tier === 2 ? 4 : 5,
    hotSeatAt: tier === 3 ? 0.42 : tier === 2 ? 0.5 : 0.58,
  }
}

/* ────────────────────────── fan handles ────────────────────────── */

const FAN_PREFIX = ['', 'Real', 'Old', 'Section', 'Upper', 'Lifelong', 'Frozen', 'Blue', 'Barn', 'Bench']
const FAN_ROOTS = ['Puckhead', 'Grinder', 'Faceoff', 'Glove', 'Crease', 'Slapshot', 'Rink', 'Boards', 'Pylon', 'Zamboni', 'Toe Drag', 'Top Shelf', 'Five Hole', 'Backcheck']

/** A believable mailbag handle, stable for (team, key). */
export function fanHandle(team: CastTeam, key: string): string {
  const h = hash(`fan|${team.id}|${key}`)
  const pre = FAN_PREFIX[h % FAN_PREFIX.length]!
  const root = FAN_ROOTS[(h >>> 4) % FAN_ROOTS.length]!.replace(/\s+/g, '')
  const tail = (h >>> 11) % 3 === 0 ? String(10 + ((h >>> 13) % 90)) : (h >>> 11) % 3 === 1 ? team.abbreviation : ''
  return `@${pre}${root}${tail}`
}
