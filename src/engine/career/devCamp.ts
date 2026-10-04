/**
 * Development camp, the pure half (owner: "we never changed dev camp — click a
 * button to see the event and basically skip through it").
 *
 * Camp is three days that matter:
 *  - Day 1, testing: every prospect runs the same drills. Results come from his
 *    real current ratings (skating, shot, hands, compete — or a goalie's
 *    tracking and positioning), ranked against the camp. No potential leaks in.
 *  - Day 2, the scrimmages: played by the quick sim (career.ts), box scores and
 *    all.
 *  - Day 3, the reads and the calls: the staff argue each kid's showing from
 *    the evidence, say where he belongs next season, and recommend a call. The
 *    GM makes the calls that matter — sign an entry-level deal or keep his
 *    rights, return him to junior/Europe or assign him to the AHL, release or
 *    sign a tryout — and picks up to three summer development programmes.
 *
 * Everything here is deterministic and free of career state.
 */
import type { CampGameLine, DevCampChoice } from './views'
import { citeCamp, evidenceFor } from './campBattles'
import { stableSeed } from '@engine/story/prose'

export type DevGroup = 'F' | 'D' | 'G'

/** One drill, as the testing sheet records it. */
export interface DrillResult {
  drill: string
  /** 1 = best in camp. */
  rank: number
  of: number
}

/** The drills and the rating each one reads. */
export const SKATER_DRILLS: Array<{ drill: string; read: (c: DrillRatings) => number }> = [
  { drill: 'Skating test', read: (c) => c.skating },
  { drill: 'Shot', read: (c) => c.scoring },
  { drill: 'Puck skills', read: (c) => (c.playmaking + c.puckControl) / 2 },
  { drill: 'Battle drill', read: (c) => (c.hitting + c.takeaway + c.defensiveZone) / 3 },
]
export const GOALIE_DRILLS: Array<{ drill: string; read: (c: DrillRatings) => number }> = [
  { drill: 'Tracking', read: (c) => c.goaltending },
  { drill: 'Lateral movement', read: (c) => (c.goaltending * 2 + c.skating) / 3 },
]

export interface DrillRatings {
  skating: number; scoring: number; playmaking: number; puckControl: number
  hitting: number; takeaway: number; defensiveZone: number; goaltending: number
}

export interface DrillEntrant {
  playerId: string
  group: DevGroup
  ratings: DrillRatings
}

/** Rank every entrant on every drill of his group. Ties break by id. */
export function runDrills(entrants: DrillEntrant[]): Map<string, DrillResult[]> {
  const out = new Map<string, DrillResult[]>()
  for (const e of entrants) out.set(e.playerId, [])
  const skaters = entrants.filter((e) => e.group !== 'G')
  const goalies = entrants.filter((e) => e.group === 'G')
  for (const [pool, drills] of [[skaters, SKATER_DRILLS], [goalies, GOALIE_DRILLS]] as const) {
    for (const d of drills) {
      const ranked = [...pool].sort((a, b) => d.read(b.ratings) - d.read(a.ratings) || (a.playerId < b.playerId ? -1 : 1))
      ranked.forEach((e, i) => out.get(e.playerId)!.push({ drill: d.drill, rank: i + 1, of: ranked.length }))
    }
  }
  return out
}

/** Drills as a swing: top of camp +2, middle 0, bottom −2 (mean over drills). */
export function drillScore(results: DrillResult[]): number {
  if (results.length === 0) return 0
  const pct = results.reduce((s, r) => s + (r.of <= 1 ? 0.5 : 1 - (r.rank - 1) / (r.of - 1)), 0) / results.length
  return Math.round((pct - 0.5) * 4 * 10) / 10
}

/**
 * The week's showing: the testing sheet plus what the scrimmages showed (the
 * same evidence scale training camp uses, halved — a prospect scrimmage is a
 * looser game). Bounded to ±5.
 */
export function showingOf(drills: DrillResult[], lines: CampGameLine[], group: DevGroup): number {
  const s = drillScore(drills) + evidenceFor(lines, group) / 2
  return Math.round(Math.max(-5, Math.min(5, s)) * 10) / 10
}

export function gradeOf(showing: number): 'A' | 'B' | 'C' {
  return showing >= 1.2 ? 'A' : showing <= -1.2 ? 'C' : 'B'
}

const ORD = (n: number): string => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

/** "fastest in the skating test (1st of 24)" — the drills worth quoting. */
/** The drill as an object of "in the …": "the shooting test", not "the shot". */
function drillPhrase(drill: string): string {
  const d = drill.toLowerCase()
  return /test|drill$/.test(d) ? `the ${d}` : `the ${d} test`
}

export function citeDrills(results: DrillResult[]): string | null {
  const best = [...results].sort((a, b) => a.rank / a.of - b.rank / b.of)[0]
  const worst = [...results].sort((a, b) => b.rank / b.of - a.rank / a.of)[0]
  if (!best) return null
  if (best.rank <= Math.max(1, Math.ceil(best.of * 0.15))) return `finished ${ORD(best.rank)} of ${best.of} in ${drillPhrase(best.drill)}`
  if (worst && worst.rank >= Math.floor(worst.of * 0.85) && worst.of >= 4) return `finished ${ORD(worst.rank)} of ${worst.of} in ${drillPhrase(worst.drill)}`
  return `was mid-pack in testing (his best: ${ORD(best.rank)} of ${best.of} in ${drillPhrase(best.drill)})`
}

/** The whole week's evidence as one clause. */
export function citeWeek(drills: DrillResult[], lines: CampGameLine[], group: DevGroup): string {
  const parts = [citeDrills(drills), lines.length > 0 ? citeCamp(lines, group) : null].filter((x): x is string => !!x)
  return parts.length > 0 ? parts.join('; he ') : 'did not get on the ice'
}

/* ───────────────────────── where he belongs, and the call ───────────────────────── */

export type Readiness = 'nhl' | 'ahl' | 'junior'

/** Where the staff think he should play next season. */
export function readinessOf(args: { ovr: number; age: number; nhlBar: number; ahlBar: number }): Readiness {
  if (args.ovr >= args.nhlBar - 1) return 'nhl'
  // Ready for the AHL = he would be a regular there now, or his junior days
  // are over and he is within reach of one.
  if (args.ovr >= args.ahlBar - 1 || (args.age >= 20 && args.ovr >= args.ahlBar - 4)) return 'ahl'
  return 'junior'
}

/** What kind of camper he is — which calls exist for him. */
export type CamperStatus = 'signed' | 'amateur' | 'tryout'

export interface ChoiceSet {
  options: DevCampChoice[]
  recommended: DevCampChoice | null
  /** Why a call you might expect is not available (the CHL rule). */
  blocked?: string
}

/**
 * The calls available for one camper, and the staff's recommendation.
 *  - an AMATEUR whose rights you hold: keep his rights and send him back,
 *    sign his entry-level deal and send him back (the ELC slides), or sign him
 *    and assign him to the AHL. A CHL player under 20 cannot play in the AHL
 *    (the real NHL–CHL agreement), so that option is blocked for him.
 *  - a TRYOUT: sign an entry-level deal (to the AHL) or release him.
 *  - a man already SIGNED to the organisation: training camp places him; no
 *    call here.
 */
export function choicesFor(args: { status: CamperStatus; readiness: Readiness; grade: 'A' | 'B' | 'C'; age: number; chlJunior: boolean }): ChoiceSet {
  const { status, readiness, grade, age, chlJunior } = args
  if (status === 'signed') return { options: [], recommended: null }
  if (status === 'tryout') {
    return { options: ['signElc', 'release'], recommended: grade === 'A' && readiness !== 'junior' ? 'signElc' : 'release' }
  }
  const ahlBlocked = chlJunior && age < 20
  const options: DevCampChoice[] = ahlBlocked ? ['returnUnsigned', 'signReturn'] : ['returnUnsigned', 'signReturn', 'signAhl']
  const recommended: DevCampChoice = readiness === 'junior'
    ? (grade === 'A' && age >= 19 ? 'signReturn' : 'returnUnsigned')
    : ahlBlocked ? 'signReturn' : 'signAhl'
  return {
    options,
    recommended,
    ...(ahlBlocked ? { blocked: 'A CHL player under 20 cannot be assigned to the AHL — it is the NHL or back to junior.' } : {}),
  }
}

export const CHOICE_LABEL: Record<DevCampChoice, string> = {
  returnUnsigned: 'Keep his rights, send him back',
  signReturn: 'Sign his ELC, send him back',
  signAhl: 'Sign his ELC, assign to the AHL',
  signElc: 'Sign an ELC (AHL)',
  release: 'Release him',
}

/** The staff's read on a camper, in one or two sentences, from the evidence. */
export function staffRead(args: { name: string; cite: string; grade: 'A' | 'B' | 'C'; readiness: Readiness; status: CamperStatus; club?: string }): string {
  const { cite, grade, readiness, status } = args
  // The lead must agree with the evidence it introduces: "A steady week: 27th
  // of 31" was the B-grade default whatever the rank (audit F11). The first
  // "Nth of M" in the cite decides between solid, steady and mixed.
  const m = cite.match(/(\d+)(?:st|nd|rd|th) of (\d+)/)
  const pct = m ? (Number(m[1]) - 1) / Math.max(1, Number(m[2]) - 1) : 0.5
  const lead = grade === 'A'
    ? 'Turned heads'
    : grade === 'C'
      ? 'A hard week'
      : pct <= 0.2 ? 'A solid week' : pct >= 0.75 ? 'A mixed week' : 'A steady week'
  // One camp reports on dozens of kids; a single "where" sentence per level
  // read 42 times in one inbox item. A stable pick per player.
  const pickFor = (opts: string[]): string => opts[stableSeed(`camp|${args.name}`) % opts.length]!
  const junior = args.club ? `with ${args.club}` : 'in junior'
  const where = readiness === 'nhl'
    ? pickFor(['He is pushing for an NHL look at main camp.', 'Bring him to main camp and see.', 'He belongs at main camp with the pros.'])
    : readiness === 'ahl'
      ? status === 'signed'
        ? pickFor(['The AHL is the right level for him next season.', 'He goes to the AHL and plays big minutes.', 'Pro hockey in the AHL is the next step.'])
        : pickFor(['He is ready for pro hockey, and the AHL would push him.', 'Sign him and send him to the AHL.', 'He has outgrown his level. The AHL is next.', 'Pro-ready. The AHL would test him.'])
      : pickFor([`Another year ${junior} is what he needs.`, `Send him back ${junior} and let him play.`, `One more season ${junior}, then we look again.`, `He needs more time ${junior}.`])
  return `${lead}: ${cite}. ${where}`
}
