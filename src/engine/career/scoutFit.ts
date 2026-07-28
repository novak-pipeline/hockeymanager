/**
 * Squad-fit notes for the Scouting Centre (playtest #17): a flagged prospect is
 * judged against the USER'S actual squad, not in a vacuum. Would he cause roster
 * friction (his position already stacked with better/younger players)? Would he
 * walk into minutes? Does he suit the coach's system?
 *
 * FOG RULES: the prospect's ceiling arrives already fog-adjusted (his
 * `potentialStars` is the scouts' read, not the truth) and the notes speak only
 * in roles and depth — never his hidden numbers. Our OWN players are fully
 * known, so naming them and their contract years is fair game.
 *
 * Deterministic, no Rng, view-layer only (the sim never reads this).
 */

import type { Player, TeamTactics } from '@domain'
import { ratedOverall, overallToStars } from '@engine/ratings/composites'
import { playerStyleFit } from '@engine/league/archetypes'
import { posGroupOf, type PosGroup } from './squadPlanner'

export interface SquadFitNote {
  /** 'plus' = he'd help here, 'minus' = friction/blocked, 'note' = neutral read. */
  tone: 'plus' | 'minus' | 'note'
  text: string
}

/** How many players a lineup genuinely leans on per position group. */
const LINEUP_SLOTS: Record<PosGroup, number> = { G: 2, LD: 3, RD: 3, C: 4, LW: 3, RW: 3 }

const GROUP_PHRASE: Record<PosGroup, string> = {
  G: 'in the crease',
  LD: 'on the left side of the blue line',
  RD: 'on the right side of the blue line',
  C: 'down the middle',
  LW: 'on the left wing',
  RW: 'on the right wing',
}

/** The lineup tier his ceiling points at, in the words a GM uses. */
function roleWord(group: PosGroup, rankAmongIncumbents: number): string {
  if (group === 'G') return rankAmongIncumbents === 0 ? 'starter' : 'backup'
  if (group === 'LD' || group === 'RD') return rankAmongIncumbents <= 1 ? 'top-four' : 'third-pair'
  return rankAmongIncumbents <= 1 ? 'top-six' : 'bottom-six'
}

export interface BuildSquadFitArgs {
  prospect: Player
  /** Fog-aware ceiling stars — OUR scouts' read of what he becomes. */
  potentialStars: number
  /** The user's NHL roster (fully known). */
  userRoster: Player[]
  /** The user team's current tactics (the coach's system), if any. */
  tactics?: TeamTactics
  /** Current sim year, to phrase "signed through YYYY". */
  currentYear: number
}

/**
 * 1–2 squad-fit notes for one flagged prospect. The first note is always the
 * depth/friction read (would he play HERE?); a second appears only when the
 * coach-system fit is notable either way.
 */
export function buildSquadFitNotes(args: BuildSquadFitArgs): SquadFitNote[] {
  const { prospect, potentialStars, userRoster, tactics } = args
  const notes: SquadFitNote[] = []
  const group = posGroupOf(prospect)
  const slots = LINEUP_SLOTS[group]
  const where = GROUP_PHRASE[group]

  // Incumbents at his position group, best first — with the club's full-known
  // read (stars + age + contract) that fog never applies to.
  const incumbents = userRoster
    .filter((p) => posGroupOf(p) === group)
    .map((p) => ({
      name: p.name,
      age: p.age,
      stars: overallToStars(ratedOverall(p)),
      expiryYear: p.contract.expiryYear,
    }))
    .sort((a, b) => b.stars - a.stars || a.age - b.age)

  // Blockers: incumbents who'd still be ahead of him EVEN AT HIS CEILING —
  // at or above his projected level, young enough to still be here when he
  // arrives, and signed beyond next season.
  const blockers = incumbents.filter(
    (i) => i.stars >= potentialStars && i.age <= 28 && i.expiryYear > args.currentYear + 1,
  )
  // Where he'd slot on arrival at his ceiling: behind everyone currently better.
  const aheadOfHim = incumbents.filter((i) => i.stars > potentialStars - 0.25).length

  if (blockers.length >= slots) {
    // The position is set with players as good or better, young, and signed.
    const wall = blockers.slice(0, 2).map((b) => b.name).join(' and ')
    const setThrough = Math.min(...blockers.slice(0, slots).map((b) => b.expiryYear))
    notes.push({
      tone: 'minus',
      text: `We're set ${where} — ${wall} are at or above his ceiling and signed through ${setThrough}. He'd sit.`,
    })
  } else if (aheadOfHim >= slots) {
    // Not walled off long-term, but no minutes today: a wait, not a never.
    const firstOut = incumbents
      .filter((i) => i.expiryYear <= args.currentYear + 2)
      .sort((a, b) => a.expiryYear - b.expiryYear)[0]
    notes.push({
      tone: 'note',
      text: firstOut
        ? `Minutes ${where} run through ${incumbents[0]!.name} for now — a path opens when ${firstOut.name}'s deal is up in ${firstOut.expiryYear}.`
        : `He'd have to beat out ${incumbents[0]!.name}'s group for minutes ${where} — depth move today, lineup player later.`,
    })
  } else {
    // Real runway: at his ceiling he cracks the lineup's leaned-on group.
    const role = roleWord(group, aheadOfHim)
    notes.push({
      tone: 'plus',
      text:
        incumbents.length === 0 || aheadOfHim === 0
          ? `Nobody ${where} stands between him and real minutes — he'd walk into ${role} duty as soon as he's ready.`
          : `Clear runway ${where}: only ${incumbents
              .slice(0, aheadOfHim)
              .map((i) => i.name)
              .join(' and ')} project ahead of him — ${role} minutes here when he arrives.`,
    })
  }

  // Coach-system fit — only when it's notable either way (keeps cards tight).
  if (tactics) {
    // `fit.reason` already names both the archetype and the system, so the lead-in
    // must NOT repeat the style ("Made for our speed & skill game — a sniper
    // thrives in a speed & skill system" read as a stutter on the card).
    const fit = playerStyleFit(prospect, tactics)
    const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)
    if (fit && fit.score >= 80) {
      notes.push({ tone: 'plus', text: `Made for how we play — ${lower(fit.reason)}` })
    } else if (fit && fit.score < 50) {
      notes.push({ tone: 'minus', text: `A stylistic mismatch — ${lower(fit.reason)}` })
    }
  }

  return notes
}
