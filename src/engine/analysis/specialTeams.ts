/**
 * SPECIAL TEAMS ON THE STREAM (W3 S8): power-play opportunities, PP% and PK%,
 * shorthanded goals, and goals split by the strength on the ice when they went
 * in (5v5, PP, SH, 4v4, 3v3, the extra attacker, empty net), read from the
 * frames (who is on the ice) and the goal events. Pure; no sim state.
 *
 * An opportunity is a stretch where one side has more skaters than the other
 * (goalie in: a side with six is an extra attacker, not a power play) that
 * holds for `ST.settleFrames` frames; a 5-on-3 that falls back to a 5-on-4 is
 * the same opportunity. PP% = power-play goals / opportunities (the NHL's), so
 * the league-wide PK% is 100 − PP%.
 */
import type { GameStream } from '@domain/events'

export const ST = { settleFrames: 3, frameS: 0.25 }

export type StrengthClass = '5v5' | 'pp' | 'sh' | '4v4' | '3v3' | 'extra' | 'en' | 'other'

export interface SpecialTeamsReport {
  /** Power-play opportunities per side (home, away). */
  opps: { home: number; away: number }
  /** Seconds of live power play per side. */
  ppSeconds: { home: number; away: number }
  /** Goals by the strength on the ice when they went in (scorer's view). */
  goals: Record<StrengthClass, number>
  /** The box score's view: goal events marked pp / sh. */
  ppGoals: number
  shGoals: number
  /** Shots on goal by strength (scorer's view). */
  shots: Record<StrengthClass, number>
  /** Live seconds at each strength (5v5, pp = one side up, 4v4, 3v3, extra). */
  seconds: Record<StrengthClass, number>
}

const zero = (): Record<StrengthClass, number> => ({ '5v5': 0, pp: 0, sh: 0, '4v4': 0, '3v3': 0, extra: 0, en: 0, other: 0 })

/** The strength a side plays at with `us` skaters against `them`. */
export function strengthOf(us: number, them: number): StrengthClass {
  if (us >= 6) return 'extra'
  if (them >= 6) return 'en'
  if (us === them) return us === 5 ? '5v5' : us === 4 ? '4v4' : us === 3 ? '3v3' : 'other'
  return us > them ? 'pp' : 'sh'
}

export function judgeSpecialTeams(stream: GameStream): SpecialTeamsReport {
  const rep: SpecialTeamsReport = { opps: { home: 0, away: 0 }, ppSeconds: { home: 0, away: 0 }, goals: zero(), ppGoals: 0, shGoals: 0, shots: zero(), seconds: zero() }
  const homeIds = new Set<string>()
  const awayIds = new Set<string>()
  for (const e of stream) {
    if (e.type !== 'frame') continue
    for (const s of e.home) homeIds.add(s.player as string)
    for (const s of e.away) awayIds.add(s.player as string)
  }
  let nH = 5
  let nA = 5
  let live = false
  // the advantage being settled: who has it, for how many frames in a row
  let cand: 'home' | 'away' | null = null
  let candN = 0
  let evenN = 0
  let open: 'home' | 'away' | null = null
  for (const e of stream) {
    if (e.type === 'faceoff') live = true
    else if (e.type === 'whistle' || e.type === 'periodEnd' || e.type === 'gameEnd' || e.type === 'goal') live = false
    if (e.type === 'frame') {
      nH = e.home.length
      nA = e.away.length
      const sh = strengthOf(nH, nA)
      if (live) {
        rep.seconds[sh === 'sh' ? 'pp' : sh === 'en' ? 'extra' : sh] += ST.frameS
        if (open && sh !== '5v5') rep.ppSeconds[open] += ST.frameS
      }
      const adv: 'home' | 'away' | null = nH < 6 && nA < 6 && nH !== nA ? (nH > nA ? 'home' : 'away') : null
      if (adv) {
        evenN = 0
        if (adv === cand) candN++
        else {
          cand = adv
          candN = 1
        }
        if (candN >= ST.settleFrames && open !== adv) {
          open = adv
          rep.opps[adv]++
        }
      } else if (nH < 6 && nA < 6) {
        cand = null
        candN = 0
        if (++evenN >= ST.settleFrames) open = null
      }
      continue
    }
    if (e.type === 'goal' || e.type === 'shot') {
      const scorer = (e.type === 'goal' ? e.scorer : e.shooter) as string
      const home = homeIds.has(scorer)
      if (!home && !awayIds.has(scorer)) continue
      const cls = home ? strengthOf(nH, nA) : strengthOf(nA, nH)
      if (e.type === 'goal') {
        rep.goals[cls]++
        if (e.strength === 'pp') rep.ppGoals++
        if (e.strength === 'sh') rep.shGoals++
        // a power-play goal ends the advantage (the minor is over)
        if (cls === 'pp') {
          cand = null
          candN = 0
          open = null
        }
      } else rep.shots[cls]++
    }
  }
  return rep
}

/** Sum reports (the measure harness). */
export function sumSpecialTeams(rs: readonly SpecialTeamsReport[]): SpecialTeamsReport {
  const out: SpecialTeamsReport = { opps: { home: 0, away: 0 }, ppSeconds: { home: 0, away: 0 }, goals: zero(), ppGoals: 0, shGoals: 0, shots: zero(), seconds: zero() }
  for (const r of rs) {
    out.opps.home += r.opps.home
    out.opps.away += r.opps.away
    out.ppSeconds.home += r.ppSeconds.home
    out.ppSeconds.away += r.ppSeconds.away
    out.ppGoals += r.ppGoals
    out.shGoals += r.shGoals
    for (const k of Object.keys(out.goals) as StrengthClass[]) {
      out.goals[k] += r.goals[k]
      out.shots[k] += r.shots[k]
      out.seconds[k] += r.seconds[k]
    }
  }
  return out
}

/** One line for the measure harness: per team-game, PP% and PK%. */
export function specialTeamsLine(r: SpecialTeamsReport, teamGames: number): string {
  const opps = r.opps.home + r.opps.away
  const ppPct = opps ? (r.ppGoals / opps) * 100 : 0
  const ppMin = (r.ppSeconds.home + r.ppSeconds.away) / 60
  const f = (v: number, d = 2): string => (v / teamGames).toFixed(d)
  return [
    `special teams/team-game: PP opps ${f(opps)} PP goals ${f(r.ppGoals)} PP% ${ppPct.toFixed(1)} PK% ${(100 - ppPct).toFixed(1)} SH goals ${f(r.shGoals, 3)}`,
    `goals by strength ${Object.entries(r.goals).map(([k, v]) => `${k} ${f(v)}`).join(' ')}`,
    `shots by strength ${Object.entries(r.shots).map(([k, v]) => `${k} ${f(v, 1)}`).join(' ')}`,
    `PP shots/2min ${ppMin ? ((r.shots.pp / ppMin) * 2).toFixed(2) : '-'} PP goals/60 ${ppMin ? ((r.goals.pp / ppMin) * 60).toFixed(2) : '-'} SH shots/team-game ${f(r.shots.sh)} 5v5 min/team-game ${(r.seconds['5v5'] / 60 / (teamGames / 2)).toFixed(1)} PP min ${(ppMin / (teamGames / 2)).toFixed(1)}`
  ].join('\n')
}
