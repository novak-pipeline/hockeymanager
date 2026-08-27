/**
 * Living scouting report — a synthesized, multi-paragraph write-up of a player
 * that REPLACES the thin one-liner prose. It is always present on the profile and
 * evolves as the collective read sharpens:
 *
 *  - At low knowledge it's short and hedged ("early viewings suggest…").
 *  - As your scouts log more looks (knowledge ↑) it deepens — production context,
 *    standout strengths, then candid weaknesses, then a confident projection.
 *  - Its content shifts with the live inputs: production (updates as games sim),
 *    the fog-aware ceiling read, and the scouts' confidence/consensus.
 *
 * A `preDraft` edition reframes the same synthesis as a formal end-of-season
 * pre-draft report (past-tense season recap + a definitive verdict + projected
 * round) for draft-eligible prospects.
 *
 * Pure + deterministic (hash of playerId + seed). No Rng / Date.
 */

import type { Player } from '@domain'
import type { DraftEligibility } from '@engine/league/draftRankings'
import { classifyArchetype, ARCHETYPE_META } from '@engine/league/archetypes'
import { reportCardScores } from '@engine/career/scoutReport'

/* ────────────────────────── deterministic pick ────────────────────────── */

function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0 }
  return (h % 10000) / 10000
}
function pick<T>(arr: T[], key: string): T {
  return arr[Math.max(0, Math.min(arr.length - 1, Math.floor(hash01(key) * arr.length)))]!
}

/* ────────────────────────── inputs / output ────────────────────────── */

export interface ScoutSummaryArgs {
  player: Player
  /** 0–100 collective scouting knowledge — gates depth + confidence. */
  knowledge: number
  /** Current-season production in the league he actually plays in. */
  gamesPlayed: number
  goals: number
  assists: number
  leagueName: string
  /** Scoring rank within his league (1 = top), if known. */
  leagueScoringRank?: number
  /** Our scouts' projected ceiling role, e.g. "Top-six F" (fog-aware). */
  ceilingRole?: string
  /** Boom/bust risk band from scout disagreement. */
  riskBand?: 'Low' | 'Medium' | 'High'
  /** Closest established comparable(s). */
  compNames?: string[]
  /** Draft framing. */
  eligibility?: DraftEligibility | null
  draftLabel?: string
  draftYear?: number
  /** Format as the formal end-of-season pre-draft edition. */
  preDraft?: boolean
}

export interface ScoutSummary {
  paragraphs: string[]
  /** A one-line confidence note shown under the heading. */
  confidence: 'low' | 'medium' | 'high'
}

/* ────────────────────────── builder ────────────────────────── */

export function buildScoutSummary(a: ScoutSummaryArgs): ScoutSummary {
  const p = a.player
  const pid = p.id as string
  const first = p.name.split(' ')[0] ?? p.name
  const k = Math.max(0, Math.min(100, a.knowledge))
  const confidence: ScoutSummary['confidence'] = k >= 70 ? 'high' : k >= 40 ? 'medium' : 'low'
  const isGoalie = p.position === 'G'
  const ppg = a.gamesPlayed > 0 ? (a.goals + a.assists) / a.gamesPlayed : 0

  // Very little to go on yet → a single hedged paragraph.
  if (k < 25) {
    return {
      confidence,
      paragraphs: [
        `Our scouts have only limited viewings of ${p.name} so far. ${pick(
          [
            'Too early to draw firm conclusions — more looks are needed before we can grade him with any confidence.',
            'The early read is impressionistic at best; we want eyes on him in more situations before committing to a projection.',
            'Until our staff logs more games, treat any read here as provisional.',
          ],
          pid + ':sparse',
        )}`,
      ],
    }
  }

  const areas = [...reportCardScores(p)].sort((x, y) => y.score - x.score)
  const strengths = areas.filter((ar) => ar.score >= 60).slice(0, 2)
  const weaknesses = [...areas].reverse().filter((ar) => ar.score <= 46).slice(0, 2)
  const arch = classifyArchetype(p)
  const archLabel = ARCHETYPE_META[arch.archetype].label.toLowerCase()

  const paras: string[] = []

  /* 1 — production / context */
  if (a.gamesPlayed > 0 && !isGoalie) {
    const pts = a.goals + a.assists
    const paceWord = ppg >= 1.1 ? 'a point-per-game-plus pace' : ppg >= 0.8 ? 'a strong scoring pace' : ppg >= 0.45 ? 'a steady contribution' : 'a modest return'
    const rankClause = a.leagueScoringRank && a.leagueScoringRank <= 25
      ? `, ${ordinal(a.leagueScoringRank)} in ${a.leagueName} scoring`
      : ''
    const verb = a.preDraft ? 'finished the season with' : 'has put up'
    paras.push(
      `${first} ${verb} ${pts} points (${a.goals}G, ${a.assists}A) in ${a.gamesPlayed} games in the ${a.leagueName}${rankClause} — ${paceWord}. ${productionColour(ppg, a.draftLabel, pid, a.leagueScoringRank)}`,
    )
  } else if (a.gamesPlayed > 0 && isGoalie) {
    paras.push(`${first} has carried a real workload in the ${a.leagueName} this season, and our staff has built a read off those starts.`)
  }

  /* 2 — strengths */
  if (strengths.length > 0) {
    const s = strengths.map((ar) => ar.label)
    const lead = pick(
      [`The calling card is his ${joinList(s)}.`, `What stands out is his ${joinList(s)}.`, `At his best, it's the ${joinList(s)} that pop.`],
      pid + ':str',
    )
    paras.push(`${lead} He profiles as a ${archLabel}${arch.descriptors[0] ? ` who ${arch.descriptors[0]}` : ''}. ${strengthColour(strengths[0]!.key, pid)}`)
  }

  /* 3 — weaknesses (only once we know him reasonably well) */
  if (k >= 55 && weaknesses.length > 0) {
    const w = weaknesses.map((ar) => ar.label)
    paras.push(
      `${pick(['The concerns center on his', 'Where it gets murkier is the', 'The questions are around his'], pid + ':wk')} ${joinList(w)}. ${weaknessColour(weaknesses[0]!.key, pid)}`,
    )
  } else if (k < 55) {
    paras.push(pick(
      [`Our scouts want more viewings before grading the rougher edges of his game.`, `There are areas still to firm up — the staff is reserving judgment on his weaknesses until they've seen more.`],
      pid + ':wkhedge',
    ))
  }

  /* 4 — projection / verdict */
  paras.push(projectionParagraph(a, confidence, first, pid))

  return { confidence, paragraphs: paras }
}

/* ────────────────────────── prose helpers ────────────────────────── */

function projectionParagraph(a: ScoutSummaryArgs, confidence: ScoutSummary['confidence'], first: string, pid: string): string {
  const role = a.ceilingRole ?? 'a useful pro'
  const conf =
    confidence === 'high' ? 'Our staff is confident in this read'
    : confidence === 'medium' ? 'Our staff likes the projection but wants a few more looks to be sure'
    : 'This remains an early projection'
  const risk = a.riskBand === 'High' ? ' He is a high-variance bet — the gap between his floor and ceiling is wide.'
    : a.riskBand === 'Low' ? ' There is little mystery here; the range of outcomes is narrow.'
    : ''
  const comp = a.compNames && a.compNames.length > 0 ? ` Stylistically, shades of ${a.compNames.join(' and ')}.` : ''
  const draft = a.draftLabel && a.eligibility && a.eligibility !== 'radar'
    ? ` Where the board has him: ${a.draftLabel}${a.draftYear ? ` for the ${a.draftYear} class` : ''}.`
    : ''
  if (a.preDraft) {
    return `Bottom line, our scouts project ${first} as ${role}. ${conf}.${risk}${comp}${draft}`
  }
  return `Our scouts project him as ${role}. ${conf}.${risk}${comp}${draft}`
}

function productionColour(ppg: number, draftLabel: string | undefined, pid: string, scoringRank?: number): string {
  // Finishing near the top of his league trumps the raw rate — a scoring leader is
  // never "unspectacular", even at a modest points-per-game.
  if (scoringRank !== undefined && scoringRank <= 3) return pick(['Leading his league in scoring is a real feather in his cap.', 'You can\'t ignore production at the very top of the league.'], pid + ':prod')
  if (scoringRank !== undefined && scoringRank <= 10) return pick(['Finishing among the league\'s top scorers is a strong marker.', 'That\'s top-of-the-league production for his level.'], pid + ':prod')
  if (ppg >= 1.1) return pick(['That kind of production turns heads.', 'Scoring at that clip at his age is a genuine draft-mover.'], pid + ':prod')
  if (ppg >= 0.6) return pick(['Useful output, even if it does not jump off the page.', 'Solid if unspectacular numbers.'], pid + ':prod')
  return pick(['The scoresheet has not always reflected his minutes.', 'The points have been harder to come by than the talent suggests.'], pid + ':prod')
}

function strengthColour(key: string, pid: string): string {
  const map: Record<string, string[]> = {
    shot: ['When he gets it off from the right spots, it goes in.', 'The release is a real weapon.'],
    puck: ['He makes those around him better with the puck on his stick.', 'He sees plays before they develop and executes them.'],
    skating: ['He covers ice quickly and is tough to contain off the rush.', 'His feet drive the rest of his game.'],
    iq: ['He reads the game at a high level and rarely looks rushed.', 'The hockey sense is the throughline of his game.'],
    defence: ['He can be trusted away from the puck.', 'The detail in his own end is advanced for his age.'],
    physical: ['He plays a heavy, in-your-face game.', 'He competes hard and wins his share of battles.'],
    goalie: ['He is technically sound and rarely beats himself.', 'He tracks pucks cleanly and controls his rebounds.'],
  }
  return pick(map[key] ?? ['It is a real strength.'], pid + ':sc')
}

function weaknessColour(key: string, pid: string): string {
  const map: Record<string, string[]> = {
    skating: ['The skating will need to improve to translate at the next level.', 'His foot speed is a genuine swing factor on his projection.'],
    defence: ['The defensive details lag the offensive flash.', 'He has work to do away from the puck.'],
    physical: ['He can get pushed off pucks against bigger, stronger competition.', 'The physical engagement runs hot and cold.'],
    shot: ['He will need to find more ways to finish.', 'The finishing touch is still a question.'],
    puck: ['His puck management can get loose under pressure.', 'The give-and-go can be a hair predictable.'],
    iq: ['His decision-making can speed up on him in traffic.', 'The reads come and go.'],
    goalie: ['The technique still has holes to clean up.', 'Consistency start-to-start is the question.'],
  }
  return pick(map[key] ?? ['It is something to monitor.'], pid + ':wc')
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!)
}
