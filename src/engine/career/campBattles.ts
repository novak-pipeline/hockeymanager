/**
 * Training camp BATTLES — the pure half of camp (docs/depth-audit-2026-09,
 * audit-gameplay-loop.md §5 "Battles").
 *
 * Camp used to be theatre over a decision made before it started: the farm sort
 * fixed every verdict on ratings, then a week of dice "scrimmages" was quoted in
 * the prose. Here the decision is a set of named, contested roster spots:
 *
 *  1. {@link detectBattles} reads the org's depth (NHL + AHL + tryouts) at camp
 *     open, lays out the coach's opening depth chart, and names the slots that
 *     are genuinely contested — "3 forwards for the last 2 spots", "Backup
 *     goalie", "The 7th D". A slot is contested when the man outside is within a
 *     few points of the man inside, or when the man inside needs waivers and the
 *     one outside doesn't (the waiver trap).
 *  2. Camp games are played by the real quick-sim; each contender's lines land
 *     here, and {@link evidenceFor} turns them into a bounded swing on the
 *     coach's prior. {@link rankBattle} re-ranks the battle after every game —
 *     the coach's plan is re-evaluated from what happened, not fixed at camp open.
 *  3. {@link citeCamp} writes the evidence back as sentences the verdicts quote
 *     ("scored twice in the Blue-Red game", "−3 in two preseason games").
 *
 * Pure and deterministic: no Rng, no Date, no career state.
 */
import type { CampBattle, CampBattleContender, CampGameLine } from './views'

export type CampGroup = 'F' | 'D' | 'G'

/** One body in camp, as the battle logic sees him. The career layer fills it. */
export interface CampCandidate {
  playerId: string
  name: string
  position: string
  age: number
  faceId?: string
  group: CampGroup
  /** Current ability on the overall scale. */
  ability: number
  /** The coach's roster-keep score (the opening depth chart sorts by this). It
   *  is ability plus his eye plus the protection a proven one-way pro enjoys. */
  keep: number
  /** The coach's read on top of ability (form, morale, specialty, habits, and
   *  a lean toward keeping a man he'd otherwise lose on waivers). */
  coachEye: number
  current: 'nhl' | 'ahl'
  tryout?: boolean
  waiverRequired: boolean
  /** Abbreviation of the club first in line to claim him if he goes down. */
  claimedBy?: string
  /** How many clubs would put in a claim. */
  claimants?: number
}

export const CAMP_TARGETS: Record<CampGroup, number> = { F: 14, D: 7, G: 2 }

/** Ability gap (overall points) inside which a spot is a real contest. */
export const BATTLE_BAND = 3
/** A waiver-exempt challenger contests a waiver-bound incumbent from further out. */
const WAIVER_TRAP_BAND = 5
/** No contest at all this close? Take the nearest pair within this as a long shot. */
const LONG_SHOT_BAND = 6
const MAX_CONTENDERS = 5

export interface CampDepth {
  /** The coach's opening depth chart: who is in, per group, by keep score. */
  opening: Record<CampGroup, string[]>
  battles: CampBattle[]
}

/**
 * Name the contested roster spots. The opening depth chart is the top
 * {@link CAMP_TARGETS} of each group by keep score; the battles sit on its
 * cut line. At most one battle per group (the cut line is the thing cut day
 * decides), each with 2–5 contenders.
 */
export function detectBattles(candidates: CampCandidate[], targets: Record<CampGroup, number> = CAMP_TARGETS): CampDepth {
  const opening: Record<CampGroup, string[]> = { F: [], D: [], G: [] }
  const battles: CampBattle[] = []
  for (const group of ['G', 'D', 'F'] as const) {
    const list = candidates
      .filter((c) => c.group === group)
      .sort((a, b) => b.keep - a.keep || (a.playerId < b.playerId ? -1 : 1))
    const target = targets[group]
    const ins = list.slice(0, target)
    const outs = list.slice(target)
    opening[group] = ins.map((c) => c.playerId)
    if (outs.length === 0 || ins.length < target) continue

    const bubbleIn = ins.slice(-3)
    const bubbleOut = outs.slice(0, 3)
    const contested = new Set<string>()
    let trap = false
    for (const i of bubbleIn) {
      for (const o of bubbleOut) {
        const close = o.ability >= i.ability - BATTLE_BAND
        const trapPair = i.waiverRequired && !o.waiverRequired && o.ability >= i.ability - WAIVER_TRAP_BAND
        if (close || trapPair) {
          contested.add(i.playerId)
          contested.add(o.playerId)
          if (trapPair) trap = true
        }
      }
    }
    if (contested.size === 0) {
      // Nobody within the band: the nearest challenger still gets his shot if
      // he is within a long-shot distance of the last man in.
      const lastIn = ins[ins.length - 1]!
      const firstOut = [...bubbleOut].sort((a, b) => b.ability - a.ability)[0]!
      if (firstOut.ability >= lastIn.ability - LONG_SHOT_BAND) {
        contested.add(lastIn.playerId)
        contested.add(firstOut.playerId)
      }
    }
    if (contested.size < 2) continue

    // Keep the contenders nearest the cut line (by keep score distance).
    const cutKeep = (ins[ins.length - 1]!.keep + outs[0]!.keep) / 2
    let members = list.filter((c) => contested.has(c.playerId))
    if (members.length > MAX_CONTENDERS) {
      members = [...members].sort((a, b) => Math.abs(a.keep - cutKeep) - Math.abs(b.keep - cutKeep)).slice(0, MAX_CONTENDERS)
    }
    const insSet = new Set(ins.map((c) => c.playerId))
    const slots = members.filter((m) => insSet.has(m.playerId)).length
    // A contest needs someone inside AND someone outside.
    if (slots === 0 || slots === members.length) continue
    const firstRank = Math.min(...members.filter((m) => insSet.has(m.playerId)).map((m) => ins.findIndex((c) => c.playerId === m.playerId))) + 1
    battles.push({
      id: `battle-${group}`,
      group,
      label: battleLabel(group, members.length, slots, firstRank, target),
      slots,
      ...(trap ? { waiverTrap: true } : {}),
      contenders: members
        .sort((a, b) => b.keep - a.keep)
        .map((m) => contenderFrom(m, insSet.has(m.playerId))),
    })
  }
  // Forwards first — the headline battle — then D, then the crease.
  const order: Record<CampGroup, number> = { F: 0, D: 1, G: 2 }
  battles.sort((a, b) => order[a.group] - order[b.group])
  return { opening, battles }
}

function contenderFrom(c: CampCandidate, inside: boolean): CampBattleContender {
  const prior = Math.round((c.ability + c.coachEye) * 10) / 10
  return {
    playerId: c.playerId,
    name: c.name,
    position: c.position,
    age: c.age,
    ...(c.faceId !== undefined ? { faceId: c.faceId } : {}),
    current: c.current,
    ...(c.tryout ? { tryout: true } : {}),
    waiverRequired: c.waiverRequired,
    ...(c.claimedBy ? { claimedBy: c.claimedBy } : {}),
    ...(c.claimants !== undefined ? { claimants: c.claimants } : {}),
    prior,
    evidence: 0,
    score: prior,
    winning: inside,
    lines: [],
  }
}

const NUM_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
const numWord = (n: number): string => NUM_WORDS[n] ?? String(n)

/** "3 forwards for the last 2 spots" / "Backup goalie" / "The 7th D". */
export function battleLabel(group: CampGroup, contenders: number, slots: number, firstRank: number, target: number): string {
  if (group === 'G') {
    if (slots === 1) return firstRank <= 1 ? 'The starting job' : 'Backup goalie'
    return `The crease: ${contenders} goalies, ${slots} spots`
  }
  if (group === 'D') {
    if (slots === 1 && firstRank === target) return `The 7th D: ${contenders} men, one spot`
    return `${contenders} defensemen for the last ${slots === 1 ? 'spot' : `${slots} spots`}`
  }
  return `${contenders} forwards for the last ${slots === 1 ? 'spot' : `${slots} spots`}`
}

/* ─────────────────────────── evidence ─────────────────────────── */

/** The largest swing camp evidence can put on the coach's prior. */
export const EVIDENCE_CAP = 6
/** A bubble skater's normal camp game on the evidence scale (about 0.2
 *  points, even, a shot or so) — camp games mix in farm and tryout bodies, so
 *  this sits below an NHL regular's night. */
const SKATER_BASELINE = 0.35
/** Camp goaltending runs behind the season's (split squads, farm skaters). */
const GOALIE_BASELINE = 0.89

/**
 * What camp showed, as a bounded swing on the overall scale. Skaters: goals,
 * assists, on-ice goal difference and shots per game, against what a bubble
 * player normally produces. Goalies: save percentage against .900, weighted by
 * the shots he actually faced. Confidence grows with games played, so one hot
 * night is worth less than four good ones.
 */
export function evidenceFor(lines: CampGameLine[], group: CampGroup): number {
  if (lines.length === 0) return 0
  if (group === 'G') {
    const sa = lines.reduce((s, l) => s + (l.sa ?? 0), 0)
    const ga = lines.reduce((s, l) => s + (l.ga ?? 0), 0)
    if (sa <= 0) return 0
    const sv = (sa - ga) / sa
    const conf = Math.min(1, sa / 50)
    return round1(clamp((sv - GOALIE_BASELINE) * 80, -EVIDENCE_CAP, EVIDENCE_CAP) * conf)
  }
  const gp = lines.length
  const v = lines.reduce((s, l) => s + 2 * l.g + 1.2 * l.a + 0.7 * l.pm + 0.15 * l.sog, 0) / gp
  const conf = Math.min(1, gp / 3)
  return round1(clamp((v - SKATER_BASELINE) * 3.2, -EVIDENCE_CAP, EVIDENCE_CAP) * conf)
}

/**
 * Re-rank a battle from everything camp has shown so far. Returns a NEW battle
 * whose contenders carry their evidence, score and `winning` flag (the top
 * `slots` by score). This is the coach's plan, re-evaluated.
 */
export function rankBattle(b: CampBattle): CampBattle {
  const contenders = b.contenders.map((c) => {
    const evidence = evidenceFor(c.lines, b.group)
    return { ...c, evidence, score: round1(c.prior + evidence) }
  })
  const order = [...contenders].sort((x, y) => y.score - x.score || y.prior - x.prior || (x.playerId < y.playerId ? -1 : 1))
  const winners = new Set(order.slice(0, b.slots).map((c) => c.playerId))
  return {
    ...b,
    contenders: order.map((c) => ({ ...c, winning: winners.has(c.playerId), ...(c.lines.length > 0 ? { cite: citeCamp(c.lines, b.group) } : {}) })),
  }
}

/** Who the coach has winning right now. */
export function battleWinners(b: CampBattle): string[] {
  return b.contenders.filter((c) => c.winning).map((c) => c.playerId)
}

/* ─────────────────────────── citations ─────────────────────────── */

const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times']
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : 'even')

/**
 * The camp's evidence as one short clause, built from the real box score.
 * Picks the most telling one or two facts: a multi-goal game, points across
 * camp, a plus/minus story over the preseason, a quiet camp; for goalies, the
 * saves in his best game and his camp save percentage.
 */
export function citeCamp(lines: CampGameLine[], group: CampGroup): string {
  if (lines.length === 0) return 'has not played yet'
  const facts: Array<[number, string]> = []
  const gp = lines.length
  if (group === 'G') {
    const sa = lines.reduce((s, l) => s + (l.sa ?? 0), 0)
    const ga = lines.reduce((s, l) => s + (l.ga ?? 0), 0)
    const best = [...lines].sort((a, b) => ((b.sa ?? 0) - (b.ga ?? 0)) - ((a.sa ?? 0) - (a.ga ?? 0)))[0]!
    if (sa > 0) {
      const sv = (sa - ga) / sa
      facts.push([Math.abs(sv - 0.9) * 100, `${sv >= 0.9 ? 'stopped' : 'let in'} ${sv >= 0.9 ? `${sa - ga} of ${sa}` : `${ga} on ${sa} shots`} across ${gp === 1 ? 'his one game' : `${numWord(gp)} games`} (${sv.toFixed(3).replace(/^0/, '')})`])
    }
    if (best && (best.sa ?? 0) >= 15 && lines.length > 1) {
      facts.push([2, `made ${(best.sa ?? 0) - (best.ga ?? 0)} saves ${best.game}`])
    }
    if (ga === 0 && sa > 0) facts.unshift([9, `did not allow a goal in ${gp === 1 ? 'his game' : `${numWord(gp)} games`}`])
  } else {
    const multi = lines.filter((l) => l.g >= 2).sort((a, b) => b.g - a.g)[0]
    if (multi) facts.push([6 + multi.g, `scored ${TIMES[multi.g] ?? `${multi.g} times`} ${multi.game}`])
    const g = lines.reduce((s, l) => s + l.g, 0)
    const a = lines.reduce((s, l) => s + l.a, 0)
    const pts = g + a
    if (pts >= 3) facts.push([pts + 1, `had ${pts} points (${g}G ${a}A) in ${gp === 1 ? 'his one game' : `${numWord(gp)} camp games`}`])
    else if (pts === 0 && gp >= 2) facts.push([3, `was held off the scoresheet in ${numWord(gp)} games`])
    else if (pts > 0 && !multi) facts.push([pts, `${g > 0 ? `scored ${g === 1 ? 'once' : TIMES[g]}` : `picked up ${a === 1 ? 'an assist' : `${a} assists`}`} in ${gp === 1 ? 'his one game' : `${numWord(gp)} games`}`])
    const pre = lines.filter((l) => l.kind === 'preseason')
    const prePm = pre.reduce((s, l) => s + l.pm, 0)
    if (pre.length > 0 && Math.abs(prePm) >= 2) {
      facts.push([Math.abs(prePm) + 1.5, `was ${signed(prePm)} in ${pre.length === 1 ? 'the preseason game' : `${numWord(pre.length)} preseason games`}`])
    } else {
      const pm = lines.reduce((s, l) => s + l.pm, 0)
      if (Math.abs(pm) >= 3) facts.push([Math.abs(pm), `finished camp ${signed(pm)}`])
    }
  }
  if (facts.length === 0) return `played ${numWord(gp)} quiet game${gp === 1 ? '' : 's'}`
  const top = facts.sort((x, y) => y[0] - x[0]).slice(0, 2).map((f) => f[1])
  return top.join(' and ')
}

/**
 * The coach's one-line read on a battle, argued by the evidence. It names who
 * is winning and why, and says so plainly when camp has overturned his opening
 * depth chart (an upset).
 */
export function battleRead(b: CampBattle, coachName: string): string {
  const winners = b.contenders.filter((c) => c.winning)
  const losers = b.contenders.filter((c) => !c.winning)
  const played = b.contenders.some((c) => c.lines.length > 0)
  if (!played) {
    const lead = winners.map((w) => w.name).join(' and ')
    return `${coachName} opens camp with ${lead} holding the spot${winners.length > 1 ? 's' : ''}. It is theirs to lose.`
  }
  const upsets = winners.filter((w) => w.current === 'ahl')
  const top = upsets[0] ?? winners[0]
  const chaser = losers[0]
  const parts: string[] = []
  if (top) {
    // Did CAMP decide it, or the coach's read? Compare what the games showed.
    const campEdge = chaser ? top.evidence - chaser.evidence : top.evidence
    if (upsets.length > 0) {
      parts.push(campEdge >= 1 && top.evidence > 0
        ? `${top.name} is taking it from the outside: he ${top.cite ?? 'has earned it'}.`
        : campEdge >= 1
          ? `${top.name} leads from the outside, though nobody has seized the job: he ${top.cite ?? 'has held his own'}.`
          : `${top.name} gets the nod from the outside on the coach's read — camp has not separated them. He ${top.cite ?? 'has held his own'}.`)
    } else {
      parts.push(campEdge >= 0 && top.evidence >= 0
        ? `${top.name} is holding on: he ${top.cite ?? 'has done enough'}.`
        : campEdge >= 0
          ? `${top.name} is holding on, though nobody has seized the job: he ${top.cite ?? 'has been quiet'}.`
          : `${top.name} is holding on, but not because of camp: he ${top.cite ?? 'has been quiet'}.`)
    }
  }
  if (chaser) {
    const gap = (winners[winners.length - 1]?.score ?? 0) - chaser.score
    parts.push(gap <= 1.5
      ? `${chaser.name} is right on his heels; he ${chaser.cite ?? 'is pushing'}.`
      : `${chaser.name} has fallen back; he ${chaser.cite ?? 'has not shown enough'}.`)
  }
  return parts.join(' ')
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
