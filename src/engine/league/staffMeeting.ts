/**
 * Staff meeting agenda + discussion.
 *
 * The GM can "mark for meeting" a player (with a discussion angle) from anywhere
 * in the UI. Marked items form an agenda; at the staff meeting the GM discusses
 * each one and the relevant staff member (head coach / AGM / scout) gives a
 * deterministic, attribute-flavoured opinion based on the player's actual state.
 *
 * Pure + deterministic: no Rng, no Date. The career layer owns the agenda array
 * and resolves items. Calibration-safe — nothing here touches the sim.
 */

import type { Player } from '@domain'
import type { TeamStaff, StaffMember } from './staff'
import { overall } from '@engine/ratings/composites'
import { classifyArchetype, ARCHETYPE_META } from './archetypes'

export type AgendaTopic = 'form' | 'iceTime' | 'tradeValue' | 'development' | 'role'

export interface AgendaTopicOption {
  id: AgendaTopic
  label: string
}

export const PLAYER_TOPICS: AgendaTopicOption[] = [
  { id: 'form',        label: 'His recent form' },
  { id: 'iceTime',     label: 'His ice time / usage' },
  { id: 'role',        label: 'His best role' },
  { id: 'development', label: 'His development' },
  { id: 'tradeValue',  label: 'His trade value' },
]

export interface AgendaItem {
  id: string
  playerId: string
  playerName: string
  topic: AgendaTopic
  /** Display label, e.g. "Sidney Crosby — His recent form". */
  label: string
  day: number
  year: number
}

export interface DiscussionResult {
  speaker: string
  speakerRole: string
  speakerFaceId?: string
  /** The staff member's spoken opinion / recommendation. */
  opinion: string
}

const topicLabel = (t: AgendaTopic): string =>
  PLAYER_TOPICS.find((o) => o.id === t)?.label ?? t

export function agendaLabel(playerName: string, topic: AgendaTopic): string {
  return `${playerName} — ${topicLabel(topic)}`
}

/** Choose which staff member fields a given topic. */
function speakerFor(topic: AgendaTopic, staff: TeamStaff): { m: StaffMember; role: string } {
  switch (topic) {
    case 'tradeValue':
      return { m: staff.assistantGM, role: 'Assistant GM' }
    case 'development':
      return { m: staff.scouts[0] ?? staff.assistantGM, role: staff.scouts[0] ? 'Scout' : 'Assistant GM' }
    default:
      return { m: staff.headCoach, role: 'Head Coach' }
  }
}

function firstName(m: StaffMember): string {
  return m.name.split(' ')[0] ?? m.name
}

/** Generate the staff member's opinion on a player topic. Deterministic. */
export function discussPlayerTopic(args: {
  player: Player
  topic: AgendaTopic
  staff: TeamStaff
}): DiscussionResult {
  const { player: p, topic, staff } = args
  const { m, role } = speakerFor(topic, staff)
  const ovr = overall(p.composites, p.position)
  const fn = firstName(m)

  let opinion: string
  switch (topic) {
    case 'form': {
      if (p.form <= -4) {
        opinion = `${fn}: "He's in a real rut — confidence looks shot. I'd ease his minutes for a game or two, maybe move him down a line to take the pressure off and let him find it again."`
      } else if (p.form >= 4) {
        opinion = `${fn}: "He's flying right now. Let's ride it — keep him in the same spot and feed him the puck while it's going in."`
      } else {
        opinion = `${fn}: "Steady enough. Nothing to fix here — keep him in his role and let him do his job."`
      }
      break
    }
    case 'iceTime': {
      if (ovr >= 80) {
        opinion = `${fn}: "Frankly he should be playing more. A player of his quality needs to be out there in every key situation."`
      } else if (ovr >= 65) {
        opinion = `${fn}: "His minutes are about right for what he gives us. I wouldn't force more onto his plate."`
      } else {
        opinion = `${fn}: "He's a depth piece — sheltered minutes suit him. Overplaying him would expose him."`
      }
      break
    }
    case 'role': {
      const a = classifyArchetype(p)
      const meta = ARCHETYPE_META[a.archetype]
      opinion = `${fn}: "I see him as a ${meta.label.toLowerCase()}. ${meta.blurb} I'd deploy him accordingly."`
      break
    }
    case 'development': {
      if (p.age <= 23) {
        opinion = ovr >= 75
          ? `${fn}: "Big future. He's already producing young — protect his development, don't rush the hard minutes, and he'll be a cornerstone."`
          : `${fn}: "Raw but worth the patience. Steady reps, the right linemates, and he could take a real step in a year or two."`
      } else if (p.age >= 31) {
        opinion = `${fn}: "He's on the back nine. It's about managing the decline now — keep him fresh, don't lean on him every night."`
      } else {
        opinion = `${fn}: "He is what he is at this stage — a known quantity. Don't expect another level."`
      }
      break
    }
    case 'tradeValue': {
      const years = p.contract.yearsRemaining
      const tier =
        ovr >= 85 ? 'a premium asset — you\'d be asking a first-round pick plus a prospect'
          : ovr >= 78 ? 'genuine trade value — a first-rounder or a good young roster player'
          : ovr >= 68 ? 'a useful piece — think a mid-round pick or a depth swap'
          : 'limited return — a late pick at best'
      const contractNote = years <= 1 ? ' His expiring deal softens what we\'d get.' : ` His ${years} years of term help.`
      opinion = `${fn}: "On the market he's ${tier}.${contractNote}"`
      break
    }
  }

  const result: DiscussionResult = { speaker: m.name, speakerRole: role, opinion }
  if (m.faceId !== undefined) result.speakerFaceId = m.faceId
  return result
}
