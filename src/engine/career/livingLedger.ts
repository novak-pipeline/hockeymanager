/**
 * The Living Ledger — Layer 0 of the Narrative Engine (docs/NARRATIVE-ENGINE.md).
 *
 * Actions have witnesses. Every meaningful GM action is recorded as a
 * WorldAction; the stakeholders who'd plausibly learn of it react in character
 * and on a delay — a leak to the press, a knock on your office door, a quiet
 * word from an agent — always with explicit "because you…" attribution. What
 * doesn't erupt now becomes RESIDUE: a permanent flag the world remembers
 * ("he knows he was shopped") that resurfaces later.
 *
 * Design rules enforced here:
 *  - No omniscience: a player only reacts once he'd plausibly KNOW (a quiet
 *    shop must leak first; an open shop he reads about at breakfast).
 *  - Conservation of drama: at most MAX_OPEN_THREADS scheduled person-scenes
 *    at once — overflow collapses into residue instead of spam.
 *  - Compounding: a second offense against the same man escalates.
 *
 * Pure + deterministic (seeded Rng), JSON-safe (lives in the save).
 */
import type { Player } from '@domain'
import type { Rng } from '@engine/shared/rng'
import type { InteractionOption } from '@engine/league/interactions'

/* ────────────────────────────── types ────────────────────────────── */

export type WorldActionKind = 'shopped' | 'scratched' | 'sentDown' | 'released'

export interface WorldAction {
  id: string
  kind: WorldActionKind
  year: number
  day: number
  playerId: string
  playerName: string
  /** quiet = feelers to a few GMs (can leak); open = league/public knowledge. */
  visibility: 'quiet' | 'open'
}

export type LedgerReactionKind = 'mediaLeak' | 'confrontation' | 'agentNote' | 'roomRipple'

/** A scheduled in-character response to a WorldAction. JSON-safe. */
export interface PendingLedgerReaction {
  id: string
  actionId: string
  kind: LedgerReactionKind
  playerId: string
  dueDay: number
  /** 0 = first offense; 1+ escalates tone and stakes. */
  escalation: number
}

export type ResidueKind = 'wasShopped' | 'wasScratched' | 'wasDemoted'

/** What the world permanently remembers about what you did to a man. */
export interface ResidueFlag {
  playerId: string
  kind: ResidueKind
  year: number
  day: number
  actionId: string
  /** Whether HE knows. A quiet shop that never leaked is residue only you
   *  and three rival GMs carry — until the day it surfaces. */
  known: boolean
}

/* ─────────────────────────── scheduling ─────────────────────────── */

/** Cap on concurrently scheduled person-scenes (confrontations/agent notes)
 *  so consequences land as scenes, not spam. Overflow → residue. */
export const MAX_OPEN_THREADS = 3

export interface ScheduleArgs {
  action: WorldAction
  player: Player
  rng: Rng
  /** Prior residue for this player (compounding check). */
  priorResidue: ResidueFlag[]
  /** Currently scheduled person-scenes for the user club (conservation). */
  openThreads: number
  nextId: () => string
}

export interface ScheduleResult {
  reactions: PendingLedgerReaction[]
  residue: ResidueFlag[]
}

/**
 * Decide who reacts to an action, how, and when. Returns the scheduled
 * reactions plus any immediate residue. Personality shapes everything:
 * a low-temperament vet storms in; a professional asks through his agent;
 * a man who already asked out is quietly relieved (no scene at all).
 */
export function scheduleReactions(args: ScheduleArgs): ScheduleResult {
  const { action, player, rng, priorResidue, openThreads, nextId } = args
  const reactions: PendingLedgerReaction[] = []
  const residue: ResidueFlag[] = []
  const p = player.personality
  const capped = openThreads >= MAX_OPEN_THREADS
  const repeat = priorResidue.some((r) => r.kind === residueFor(action.kind) && r.year === action.year)
  const escalation = repeat ? 1 : 0

  const flag = (known: boolean): ResidueFlag => ({
    playerId: action.playerId, kind: residueFor(action.kind),
    year: action.year, day: action.day, actionId: action.id, known,
  })

  switch (action.kind) {
    case 'shopped': {
      // Quiet feelers leak ~40% (more GMs talk than you'd like); an open shop
      // is known immediately. Once it's known, HE reacts — unless he's the one
      // who wanted out, in which case relief is the whole story (no scene).
      const leaks = action.visibility === 'open' || rng.chance(0.4)
      if (!leaks) {
        residue.push(flag(false))
        // A careful agent still hears things ~25% of the time — a quiet word,
        // not a headline. Costs little today; remembered forever.
        if (!capped && rng.chance(0.25)) {
          reactions.push({ id: nextId(), actionId: action.id, kind: 'agentNote', playerId: action.playerId, dueDay: action.day + 2 + rng.int(3), escalation })
        }
        break
      }
      const leakDay = action.day + (action.visibility === 'open' ? 0 : 1 + rng.int(3))
      reactions.push({ id: nextId(), actionId: action.id, kind: 'mediaLeak', playerId: action.playerId, dueDay: leakDay, escalation })
      const wantsOut = player.morale < 35
      if (!wantsOut && !capped) {
        reactions.push({ id: nextId(), actionId: action.id, kind: 'confrontation', playerId: action.playerId, dueDay: leakDay + 1, escalation })
      } else {
        residue.push(flag(true))
      }
      break
    }
    case 'scratched': {
      // A healthy scratch stings in proportion to pride. First time: he takes
      // it (residue). A repeat, or a proud low-temperament vet: he's at your door.
      const proud = p.temperament < 45 && p.ambition > 55
      if ((repeat || proud) && !capped) {
        reactions.push({ id: nextId(), actionId: action.id, kind: 'confrontation', playerId: action.playerId, dueDay: action.day + 1, escalation })
      } else if (!capped && p.professionalism > 60 && rng.chance(0.5)) {
        reactions.push({ id: nextId(), actionId: action.id, kind: 'agentNote', playerId: action.playerId, dueDay: action.day + 2, escalation })
      }
      residue.push(flag(true))
      break
    }
    case 'sentDown': {
      // He's in Wilkes-Barre now — the reaction arrives by phone, not door.
      if (!capped) {
        reactions.push({ id: nextId(), actionId: action.id, kind: 'agentNote', playerId: action.playerId, dueDay: action.day + 1 + rng.int(2), escalation })
      }
      residue.push(flag(true))
      break
    }
    case 'released': {
      // The man is gone; the ROOM reacts. His friends notice how it was done.
      reactions.push({ id: nextId(), actionId: action.id, kind: 'roomRipple', playerId: action.playerId, dueDay: action.day + 1, escalation })
      break
    }
  }
  return { reactions, residue }
}

function residueFor(kind: WorldActionKind): ResidueKind {
  switch (kind) {
    case 'shopped': return 'wasShopped'
    case 'scratched': return 'wasScratched'
    case 'sentDown': return 'wasDemoted'
    case 'released': return 'wasShopped' // released players hold no future residue; placeholder unused
  }
}

/* ─────────────────────── reaction copy (the product) ─────────────────────── */
/* Written to the NARRATIVE-ENGINE.md standard: specific, in-character,
 * economical, consequence-aware. Selection is seeded, personality-keyed,
 * always attributed to the action ("because you…"). */

export interface ReactionCopy {
  headline: string
  body: string
  /** For confrontations: what he says to your face + the response options. */
  message?: string
  options?: InteractionOption[]
}

const CONFRONT_OPTIONS: InteractionOption[] = [
  { id: 'promise', label: 'Level with him — and promise him clarity', tone: 'promise' },
  { id: 'supportive', label: 'Reassure him: this is how the business works', tone: 'supportive' },
  { id: 'firm', label: 'Tell him straight: everyone is tradeable', tone: 'firm' },
  { id: 'dismissive', label: 'This meeting is over', tone: 'dismissive' },
]

export function reactionCopy(args: {
  kind: LedgerReactionKind
  action: WorldAction
  player: Player
  escalation: number
  rng: Rng
}): ReactionCopy {
  const { kind, action, player, escalation, rng } = args
  const last = player.name.split(' ').slice(-1)[0]
  const p = player.personality

  switch (kind) {
    case 'mediaLeak': {
      const variants = action.visibility === 'open'
        ? [
            { headline: `${player.name} openly available, league sources say`, body: `You put ${player.name} on the market and made no secret of it. Every desk in the league has the memo by lunch — and so does his.` },
            { headline: `${player.name} on the block`, body: `The listing you posted this morning is the league's worst-kept secret by evening. ${last} heard it the way everyone else did: from his phone.` },
          ]
        : [
            { headline: `Sources: ${player.name} quietly available`, body: `You shopped ${player.name} to a handful of front offices. One of them talked. The story is out, and ${last} now knows his name was in other people's mouths before it was in yours.` },
            { headline: `Report: ${player.name} shopped behind the scenes`, body: `The feelers you put out on ${player.name} found their way to a beat writer. Quiet was the plan; quiet is over.` },
          ]
      return variants[rng.int(variants.length)]
    }
    case 'confrontation': {
      // His words, shaped by who he is — and by whether this is the second time.
      const msg = escalation > 0
        ? `"We did this dance already. You shopped me, I stayed, I kept my mouth shut. Now my name's out there again — so either move me or tell me to my face that this is how it ends here."`
        : p.temperament < 45
          ? `"I find out from a REPORTER that I'm on the block? ${p.loyalty > 60 ? "After everything I've given this room? " : ''}You want to trade me, fine — but you look me in the eye first."`
          : p.professionalism > 65
            ? `"I'm not here to blow up. I saw the report. I'd rather hear it from you: am I part of this team's plans, or am I an asset? I can handle either answer — I can't handle reading it."`
            : `"So the rumors are real. Look — I'm not going to pretend that doesn't sting. What's the plan for me here?"`
      return {
        headline: `${player.name} wants a word`,
        body: `He saw the report. He is standing in your office because you shopped him.`,
        message: msg,
        options: CONFRONT_OPTIONS,
      }
    }
    case 'agentNote': {
      const variants = action.kind === 'sentDown'
        ? [
            { headline: `${last}'s agent: a call about the demotion`, body: `"${player.name} cleared and reported — he's a pro. But you sent an ${player.age}-year-old through waivers, and every GM in the league saw it. When his deal is up, we will both remember this week." He hangs up before you answer.` },
            { headline: `A frosty call from ${last}'s camp`, body: `"He'll play hard in the minors because that's who he is. Just understand the message you sent — because he received it." Because you assigned him down, this relationship now has a scar.` },
          ]
        : action.kind === 'scratched'
          ? [
              { headline: `${last}'s agent checks in`, body: `"No drama — but a healthy scratch for a player of his standing gets noticed. If there's a plan, share it with him. If there isn't, we should talk." The message is polite. The subtext is not.` },
            ]
          : [
              { headline: `${last}'s agent has heard whispers`, body: `"I'm not going to ask if you're shopping ${player.name}, because we both know GMs talk. I'll just say: if his name is out there and he learns it from a reporter instead of you, that's a problem you chose." Nothing leaked — but his agent knows, and now you know he knows.` },
            ]
      return variants[rng.int(variants.length)]
    }
    case 'roomRipple': {
      return {
        headline: `The room took notice of ${last}'s exit`,
        body: `Cutting ${player.name} was your call to make — but he had friends in that room, and lockers don't empty quietly. A few players gave one-word answers at practice today. How you handle the next departure will decide whether this becomes a mood or a memory.`,
      }
    }
  }
}
