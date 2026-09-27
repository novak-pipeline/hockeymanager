/**
 * FM-style match ratings (1–10) from the event stream, each explained by the
 * things that moved it.
 *
 * A rating is 6.0 (an anonymous, did-his-job night) plus a list of DRIVERS —
 * named contributions in rating points ("2 goals +1.9", "3 giveaways −0.5").
 * The number shown is the sum; the explanation is the top two or three drivers
 * by size. Because the rating IS the sum of its drivers, the explanation can
 * never disagree with the number.
 *
 * Skaters: goals, assists, shots and the quality of the chances (xG), hits,
 * blocks, takeaways vs giveaways, plus/minus, penalties taken and drawn,
 * faceoffs (when the engine names the loser), and ice time against his usual
 * share. Goalies: goals saved above expected (save% vs the save% the chances he
 * faced predict), workload, high-danger stops, a clean sheet.
 *
 * Live and final ratings use the same maths on the same fold, so a rating
 * grows through the night the way FM's does.
 *
 * Pure and DOM-free.
 */
import type { MatchStats, PlayerLine, Side } from './matchStats'

export interface RatingDriver {
  /** Short human reason, e.g. "2 goals", "−2 on the ice", ".938 sv% vs .902 expected". */
  label: string
  /** Rating points this contributed (signed). */
  delta: number
}

export interface PlayerRating {
  playerId: string
  name: string
  side: Side
  position: string
  isGoalie: boolean
  /** 1.0–10.0, one decimal. */
  rating: number
  /** Top drivers by size (at most three), biggest first. */
  drivers: RatingDriver[]
  /** Every driver, for a full breakdown. */
  allDrivers: RatingDriver[]
  line: PlayerLine
}

export const BASE_RATING = 6

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')
const sv3 = (f: number): string => {
  const r = Math.round(Math.max(0, f) * 1000)
  return r >= 1000 ? '1.000' : `.${r.toString().padStart(3, '0')}`
}

/**
 * Soft ceiling and floor: FM ratings are hard-won at the ends. Past 8.0 each
 * point of performance buys 0.6 of rating; below 4.0 the same on the way down.
 */
function shape(raw: number): number {
  let r = raw
  if (r > 8) r = 8 + (r - 8) * 0.6
  if (r < 4) r = 4 - (4 - r) * 0.6
  return Math.round(clamp(r, 1, 10) * 10) / 10
}

function finish(drivers: RatingDriver[]): { rating: number; drivers: RatingDriver[]; allDrivers: RatingDriver[] } {
  const live = drivers.filter((d) => Math.abs(d.delta) >= 0.05)
  const sum = live.reduce((a, d) => a + d.delta, 0)
  const sorted = [...live].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return {
    rating: shape(BASE_RATING + sum),
    drivers: sorted.slice(0, 3).map((d) => ({ label: d.label, delta: Math.round(d.delta * 10) / 10 })),
    allDrivers: sorted.map((d) => ({ label: d.label, delta: Math.round(d.delta * 100) / 100 })),
  }
}

/** Typical share of the game a skater plays, by position (NHL: D ~22 min, F ~15). */
function usualShare(position: string): number {
  return position === 'D' ? 0.36 : 0.26
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Drivers for one skater's night so far. `elapsed` = game seconds played. */
export function skaterDrivers(l: PlayerLine, elapsed: number): RatingDriver[] {
  const d: RatingDriver[] = []
  if (l.goals > 0) d.push({ label: plural(l.goals, 'goal'), delta: l.goals * 0.9 })
  if (l.assists > 0) {
    const secondary = l.assists - l.primaryAssists
    d.push({ label: plural(l.assists, 'assist'), delta: l.primaryAssists * 0.55 + secondary * 0.35 })
  }
  // Shot volume and the quality of the looks — a shooter who had five good
  // chances and missed them all still played well; the finish is in "goals".
  const chance = l.shots * 0.04 + Math.min(0.8, l.xg * 1.2)
  if (l.shots > 0) {
    d.push({ label: `${plural(l.shots, 'shot')} (${l.xg.toFixed(1)} xG)`, delta: chance })
  }
  if (l.hits > 0) d.push({ label: plural(l.hits, 'hit'), delta: Math.min(0.45, l.hits * 0.07) })
  if (l.blocks > 0) d.push({ label: plural(l.blocks, 'blocked shot'), delta: Math.min(0.5, l.blocks * 0.1) })
  if (l.takeaways > 0) d.push({ label: plural(l.takeaways, 'takeaway'), delta: Math.min(0.75, l.takeaways * 0.16) })
  if (l.giveaways > 0) d.push({ label: plural(l.giveaways, 'giveaway'), delta: -Math.min(1, l.giveaways * 0.17) })
  if (l.plusMinus !== 0) d.push({ label: `${signed(l.plusMinus)} on the ice`, delta: clamp(l.plusMinus * 0.25, -1, 1) })
  if (l.penaltiesTaken > 0) {
    const pen = l.penaltyMinutes >= 5 * l.penaltiesTaken ? 0.35 : 0.3
    d.push({ label: l.penaltiesTaken === 1 ? 'took a penalty' : `took ${l.penaltiesTaken} penalties`, delta: -l.penaltiesTaken * pen })
  }
  if (l.penaltiesDrawn > 0) {
    d.push({ label: l.penaltiesDrawn === 1 ? 'drew a penalty' : `drew ${l.penaltiesDrawn} penalties`, delta: l.penaltiesDrawn * 0.2 })
  }
  const draws = l.faceoffWins + l.faceoffLosses
  if (l.faceoffLosses > 0 && draws >= 5) {
    d.push({ label: `won ${l.faceoffWins} of ${draws} draws`, delta: clamp((l.faceoffWins - l.faceoffLosses) * 0.05, -0.4, 0.4) })
  }
  // Ice time against what his position usually gets by now: the coach's trust
  // (or lack of it) is part of the night. Only once there's a game to judge.
  if (elapsed >= 600 && l.toi > 0) {
    const expected = elapsed * usualShare(l.position)
    const devMin = (l.toi - expected) / 60
    const delta = clamp(devMin * 0.04, -0.25, 0.25)
    if (Math.abs(delta) >= 0.05) d.push({ label: `${mmss(l.toi)} TOI`, delta })
  }
  return d
}

/**
 * Drivers for a goalie. The anchor is the chances he faced: xGA is what an
 * average goalie concedes on them, so (xGA − GA) is goals saved above
 * expected, and that is most of the rating.
 */
export function goalieDrivers(l: PlayerLine, gameOver: boolean): RatingDriver[] {
  const d: RatingDriver[] = []
  if (l.shotsAgainst === 0) return d
  // Small samples mean little: the first handful of shots count for less.
  const sample = Math.min(1, l.shotsAgainst / 8)
  const gsax = l.xga - l.goalsAgainst
  const svp = l.saves / l.shotsAgainst
  const xsv = 1 - l.xga / l.shotsAgainst
  d.push({
    label: `${sv3(svp)} sv% vs ${sv3(xsv)} expected`,
    delta: clamp(gsax * 0.95, -3.5, 3.5) * sample,
  })
  if (l.shotsAgainst >= 30) {
    d.push({ label: `faced ${l.shotsAgainst} shots`, delta: Math.min(0.45, (l.shotsAgainst - 28) * 0.035) })
  }
  if (l.highDangerSaves > 0) {
    d.push({ label: plural(l.highDangerSaves, 'high-danger stop'), delta: Math.min(0.5, l.highDangerSaves * 0.1) * sample })
  }
  if (l.goalsAgainst === 0 && l.shotsAgainst >= 15) {
    d.push({ label: gameOver ? 'shutout' : 'nothing past him yet', delta: gameOver ? 0.6 : 0.3 })
  }
  return d
}

/** Did this line take part in the game (so it earns a rating)? */
export function played(l: PlayerLine): boolean {
  if (l.isGoalie) return l.shotsAgainst > 0 || l.toi > 0
  return l.toi > 0 || l.goals + l.assists + l.shots + l.hits + l.blocks + l.takeaways + l.giveaways + l.faceoffWins + l.penaltiesTaken > 0
}

export function ratePlayer(l: PlayerLine, elapsed: number, gameOver: boolean): PlayerRating {
  const f = finish(l.isGoalie ? goalieDrivers(l, gameOver) : skaterDrivers(l, elapsed))
  return {
    playerId: l.id,
    name: l.name,
    side: l.side,
    position: l.position,
    isGoalie: l.isGoalie,
    rating: f.rating,
    drivers: f.drivers,
    allDrivers: f.allDrivers,
    line: l,
  }
}

/**
 * Every participant's rating, best first. A goalie who never faced a shot and
 * never took the crease (the backup) is left out.
 */
export function rateMatch(stats: MatchStats): PlayerRating[] {
  return stats.players
    .filter(played)
    .map((l) => ratePlayer(l, stats.elapsed, stats.ended))
    .sort((a, b) => b.rating - a.rating || b.line.goals + b.line.assists - (a.line.goals + a.line.assists) || a.name.localeCompare(b.name))
}

/** "+1.9" / "−0.5" for a driver chip. */
export function formatDelta(delta: number): string {
  const v = Math.round(delta * 10) / 10
  return v > 0 ? `+${v.toFixed(1)}` : v < 0 ? `−${Math.abs(v).toFixed(1)}` : '0.0'
}
