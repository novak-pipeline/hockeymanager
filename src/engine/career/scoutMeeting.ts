/**
 * The recurring Scout Meeting — a convened briefing where your recruitment staff
 * present their board and you make real calls on it.
 *
 * Mirrors the bi-weekly Staff Meeting framework, but from the scouting desk: the
 * Head of Scouting walks the room through the department's RISERS and FALLERS
 * (where your board has moved off the public consensus), the flagged prospects
 * awaiting a decision, and the COVERAGE GAPS (positions/regions you're thin on).
 * The GM then acts: track a riser (pins him to the shortlist) or refocus a scout
 * onto a gap. Delegating hands it to the Head of Scouting (safe defaults).
 *
 * This module is PURE: the career layer digests the live scouting state into a
 * `ScoutMeetingInput`; this turns it into a `ScoutMeetingScene` whose options
 * carry an executable `ScoutMeetingAction`. It never mutates and never decides an
 * outcome — the engine applies the chosen action, deterministically.
 */

import type { MeetingSpeaker, MeetingLine } from './boardMeeting'
import type { ScoutTarget, ScoutFocus } from '@domain/scouting'

/* ────────────────────────── the executable action ────────────────────────── */

/** What accepting an option actually does. `none` = leave things as they are. */
export type ScoutMeetingAction =
  | { type: 'none' }
  /** Pin a flagged prospect to the shortlist (career.shortlistProspect). */
  | { type: 'track'; playerId: string }
  /** Re-aim a scout onto a coverage gap (career.assignScoutTarget). */
  | { type: 'refocus'; scoutId: string; target: ScoutTarget; focus: ScoutFocus }

export interface ScoutMeetingProposalOption {
  id: string
  label: string
  /** The receipt preview — what accepting commits you to. */
  detail: string
  action: ScoutMeetingAction
}

export interface ScoutMeetingProposal {
  id: string
  /** Which cast member is pitching (speaker id). */
  speakerId: string
  title: string
  intro: MeetingLine[]
  options: ScoutMeetingProposalOption[]
  /** Option the Head of Scouting applies if you delegate/skip. */
  defaultOptionId: string
}

/** One prospect on the board summary (riser or faller vs the public consensus). */
export interface ScoutBoardLine {
  playerId: string
  name: string
  position: string
  /** e.g. "+14 vs consensus" or "R1 · #8". */
  note: string
}

export interface ScoutMeetingScene {
  day: number
  year: number
  cast: MeetingSpeaker[]
  hostId: string
  opening: MeetingLine[]
  /** Prospects your board has climbed above the public consensus. */
  risers: ScoutBoardLine[]
  /** Prospects your board has slid below the consensus. */
  fallers: ScoutBoardLine[]
  /** Human-readable coverage gaps (positions/regions you're thin on). */
  gaps: string[]
  proposals: ScoutMeetingProposal[]
}

/* ────────────────────────── digested input (from live state) ────────────────────────── */

/** A flagged prospect the GM can pin from the meeting. */
export interface TrackableFind {
  playerId: string
  name: string
  position: string
  grade: string
  reason: string
}

/** A scout who can be re-aimed onto a coverage gap. */
export interface RefocusCandidate {
  scoutId: string
  scoutName: string
  target: ScoutTarget
  focus: ScoutFocus
  /** Where he'd go, e.g. "Sweden" or "the draft class". */
  label: string
  /** Why — the gap he'd close, e.g. "you have no coverage in Sweden". */
  why: string
}

export interface ScoutMeetingInput {
  cast: MeetingSpeaker[]
  hostId: string
  day: number
  year: number
  risers: ScoutBoardLine[]
  fallers: ScoutBoardLine[]
  gaps: string[]
  /** Flagged prospects the GM hasn't triaged (up to a couple become "track" items). */
  trackable: TrackableFind[]
  /** At most one refocus proposal — the biggest gap. */
  refocus: RefocusCandidate | null
}

/* ────────────────────────── scene composition ────────────────────────── */

const MAX_TRACK_PROPOSALS = 2

/** True when there's something worth convening for. */
export function scoutMeetingHasContent(input: ScoutMeetingInput): boolean {
  return input.risers.length > 0
    || input.fallers.length > 0
    || input.trackable.length > 0
    || input.gaps.length > 0
}

/**
 * Compose the scene from digested inputs. Returns `proposals: []` when there's
 * nothing to decide (the board summary can still carry risers/gaps as a briefing).
 */
export function buildScoutMeetingScene(input: ScoutMeetingInput): ScoutMeetingScene {
  const { cast, hostId, day, year, risers, fallers, gaps } = input
  const host = cast.find((c) => c.id === hostId) ?? cast[0]!

  const proposals: ScoutMeetingProposal[] = []

  // Track proposals — pin the best flagged prospects the GM hasn't triaged.
  for (const f of input.trackable.slice(0, MAX_TRACK_PROPOSALS)) {
    const idx = proposals.length
    proposals.push({
      id: `track${idx}`,
      speakerId: host.id,
      title: `${f.name} — worth tracking`,
      intro: [{
        speakerId: host.id,
        text: `We've filed ${f.name} (${f.position}) as a ${f.grade}. ${f.reason} I'd pin him to the shortlist so we keep eyes on him.`,
      }],
      options: [
        { id: 'track', label: '★ Track him', detail: `Add ${f.name} to your shortlist`, action: { type: 'track', playerId: f.playerId } },
        { id: 'leave', label: 'Leave him in the queue', detail: `${f.name} stays in the Scouting Centre queue`, action: { type: 'none' } },
      ],
      defaultOptionId: 'leave',
    })
  }

  // Refocus proposal — close the biggest coverage gap.
  if (input.refocus) {
    const r = input.refocus
    const idx = proposals.length
    proposals.push({
      id: `refocus${idx}`,
      speakerId: host.id,
      title: `Coverage gap — ${r.label}`,
      intro: [{
        speakerId: host.id,
        text: `Right now ${r.why}. I'd send ${r.scoutName} to ${r.label} so we're not flying blind there.`,
      }],
      options: [
        { id: 'send', label: `Send ${r.scoutName}`, detail: `Re-aim ${r.scoutName} onto ${r.label}`, action: { type: 'refocus', scoutId: r.scoutId, target: r.target, focus: r.focus } },
        { id: 'leave', label: 'Leave assignments as they are', detail: 'No change to the scouting deployment', action: { type: 'none' } },
      ],
      defaultOptionId: 'leave',
    })
  }

  const riserNames = risers.slice(0, 2).map((r) => r.name)
  const open = riserNames.length > 0
    ? `Let's go through the board. We're higher than the room on ${riserNames.join(' and ')} — and there's ground to cover.`
    : gaps.length > 0
      ? `Let's go through the board — and there are a couple of gaps I want to close.`
      : `Quick one — here's where the board stands.`

  return {
    day,
    year,
    cast,
    hostId: host.id,
    opening: [{ speakerId: host.id, text: open }],
    risers,
    fallers,
    gaps,
    proposals,
  }
}

/** The delegated choices: apply each item's safe default (Head of Scouting runs it). */
export function delegatedScoutChoices(scene: ScoutMeetingScene): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of scene.proposals) out[p.id] = p.defaultOptionId
  return out
}
