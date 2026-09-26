/**
 * The INJURY DISCLOSURE layer (docs/MEDIA-SIMULATION-RESEARCH.md §1.5, S3).
 *
 * The NHL asks clubs for the location, nature and severity of an injury, and
 * lets them give "a general overview" when detail could endanger the player.
 * The result is the league's house style: "upper-body, day-to-day". The truth
 * — a separated shoulder, five weeks — comes out later, usually through the
 * beat ("worse than first thought"), sometimes through a national insider.
 *
 * This module never touches the injury model. The sim decides what is wrong
 * with a man and for how long (`Injury.description`, `totalGames`); this layer
 * only decides what the club SAYS about it, and tracks the distance between
 * the two so the media can close it:
 *
 *   official line  ── the club's statement (region + band), posted on day one
 *   reveal         ── the beat reports the real diagnosis a few days later
 *   worse          ── he is still out past the announced band
 *   ahead          ── a cautious club brings him back before its own band
 *
 * The stance (optimistic / straight / cautious) is a stable function of the
 * club and the injury, so replaying a save tells the same lies. Playoff
 * disclosure gets vaguer, as it does in the real league.
 *
 * Pure + JSON-safe.
 */

export type OfficialRegion = 'upper-body' | 'lower-body' | 'illness' | 'undisclosed'
export type OfficialBand = 'day-to-day' | 'week-to-week' | 'month-to-month' | 'indefinitely'
export type DisclosureStance = 'optimistic' | 'straight' | 'cautious'

export interface InjuryDisclosure {
  playerId: string
  playerName: string
  teamId: string
  year: number
  /** Day the injury was announced. */
  day: number
  /** The engine's injury kind ('lowerBody' | 'upperBody' | 'illness' | 'concussion'). */
  kind: string
  /** The true diagnosis as a noun phrase ("a separated shoulder"). */
  truth: string
  /** True when the diagnosis is specific enough to be news when revealed. */
  specific: boolean
  region: OfficialRegion
  band: OfficialBand
  stance: DisclosureStance
  /** Games the sim will actually keep him out (never shown until it is true). */
  truthGames: number
  /** Games he has missed so far (the career updates this each match day). */
  gamesMissed: number
  playoff: boolean
  revealed: boolean
  worse: boolean
  ahead: boolean
  returned: boolean
  /** Day he came back, once he has. */
  returnDay?: number
}

/** Games each band promises, inclusive. "Indefinitely" has no ceiling. */
export const BAND_RANGE: Record<OfficialBand, [number, number]> = {
  'day-to-day': [0, 3],
  'week-to-week': [4, 12],
  'month-to-month': [13, 30],
  indefinitely: [31, 999],
}

const BANDS: OfficialBand[] = ['day-to-day', 'week-to-week', 'month-to-month', 'indefinitely']

export function bandForGames(games: number): OfficialBand {
  for (const b of BANDS) if (games <= BAND_RANGE[b][1]) return b
  return 'indefinitely'
}

/** Where the club says it hurts. Concussions are "upper-body" — as in the NHL. */
export function officialRegion(kind: string): OfficialRegion {
  if (kind === 'lowerBody') return 'lower-body'
  if (kind === 'illness') return 'illness'
  return 'upper-body'
}

/** Vague engine notes ("upper-body injury", "illness") carry no diagnosis to reveal. */
export function isSpecificDiagnosis(description: string): boolean {
  const d = description.toLowerCase().trim()
  return !/^(upper-body injury|lower-body injury|illness)$/.test(d)
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** How guarded a club is with the press, 0 (open book) … 1 (a vault). Stable. */
export function clubSecrecy(teamId: string): number {
  return (hash(`secrecy|${teamId}`) % 1000) / 1000
}

/**
 * The club's statement on day one. The stance draws on the club's secrecy and
 * a stable per-injury hash: a guarded club shades light more often.
 */
export function discloseInjury(args: {
  playerId: string
  playerName: string
  teamId: string
  year: number
  day: number
  kind: string
  truth: string
  description: string
  totalGames: number
  playoff: boolean
}): InjuryDisclosure {
  const trueBand = bandForGames(args.totalGames)
  const roll = (hash(`disc|${args.teamId}|${args.playerId}|${args.year}|${args.day}`) % 1000) / 1000
  const optimisticP = 0.22 + clubSecrecy(args.teamId) * 0.3 // 22–52 %
  const cautiousP = 0.12
  let stance: DisclosureStance = 'straight'
  const i = BANDS.indexOf(trueBand)
  if (roll < optimisticP && i > 0) stance = 'optimistic'
  else if (roll > 1 - cautiousP && i < BANDS.length - 1 && args.totalGames >= 2) stance = 'cautious'
  const band = stance === 'optimistic' ? BANDS[i - 1]! : stance === 'cautious' ? BANDS[i + 1]! : trueBand
  // Playoff hockey: the location goes dark about half the time.
  const region: OfficialRegion =
    args.playoff && hash(`po|${args.playerId}|${args.day}`) % 2 === 0 ? 'undisclosed' : officialRegion(args.kind)
  return {
    playerId: args.playerId,
    playerName: args.playerName,
    teamId: args.teamId,
    year: args.year,
    day: args.day,
    kind: args.kind,
    truth: args.truth,
    specific: isSpecificDiagnosis(args.description),
    region,
    band,
    stance,
    truthGames: args.totalGames,
    gamesMissed: 0,
    playoff: args.playoff,
    revealed: false,
    worse: false,
    ahead: false,
    returned: false,
  }
}

/** "upper-body injury, day-to-day" — the club's words. */
export function officialLine(d: Pick<InjuryDisclosure, 'region' | 'band'>): string {
  const where =
    d.region === 'undisclosed'
      ? 'an undisclosed injury'
      : d.region === 'illness'
        ? 'an illness'
        : d.region === 'upper-body'
          ? 'an upper-body injury'
          : 'a lower-body injury'
  return `${where}, ${d.band}`
}

export type DisclosureBeat = 'reveal' | 'worse' | 'ahead'

/**
 * Which follow-up story, if any, this injury has earned today. At most one per
 * call; the caller marks it told. `daysSince` is match days since the
 * announcement; `gamesRemaining` is the sim's live count (0 once healed).
 */
export function nextDisclosureBeat(d: InjuryDisclosure, daysSince: number, gamesRemaining: number): DisclosureBeat | null {
  const [bandMin, bandMax] = BAND_RANGE[d.band]
  // Still out past everything the club said: the worst read, and it wins.
  if (!d.worse && !d.returned && gamesRemaining > 0 && d.gamesMissed > bandMax && d.band !== 'indefinitely') return 'worse'
  // The diagnosis the club would not give. Only worth a story when it is a
  // real diagnosis and the absence is more than a knock.
  if (!d.revealed && d.specific && d.truthGames >= 4 && daysSince >= 2 && d.region !== 'illness') return 'reveal'
  // Back early against a cautious band.
  if (!d.ahead && d.returned && d.stance === 'cautious' && d.gamesMissed < bandMin) return 'ahead'
  return null
}
