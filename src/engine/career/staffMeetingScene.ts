/**
 * The bi-weekly Staff Meeting — a convened, interactive war-room.
 *
 * Your hockey-ops staff read the LIVE roster (form, injuries, fatigue, prospect
 * readiness, tactical fit) and table concrete proposals. You accept one option
 * per item and the career layer applies the REAL consequence (moves a line, rests
 * a player, calls up a prospect, shifts the system). Delegating the meeting to the
 * AGM applies each item's safe default instead.
 *
 * This module is PURE: the career layer detects `StaffFinding`s from live state
 * and supplies the staff `cast`; this turns them into a `StaffMeetingScene` whose
 * options carry an executable `StaffAction`. It never mutates anything and never
 * decides an outcome — the engine applies the chosen action, deterministically.
 * (LLM voice is layered on top later; the template prose here is the floor.)
 */

import type { MeetingSpeaker, MeetingLine } from './boardMeeting'
import type { SuggestionDirection } from '@engine/league/coachTactics'

/* ────────────────────────── the executable action ────────────────────────── */

/** What accepting an option actually does. The career layer dispatches each to a
 *  real mutation method; `none` = leave things as they are. */
export type StaffAction =
  | { type: 'none' }
  | { type: 'moveLine'; playerId: string; toLine: number } // forward line index 0..3
  | { type: 'scratch'; playerId: string }
  | { type: 'rest'; playerId: string }
  | { type: 'ltir'; playerId: string }
  | { type: 'callUp'; playerId: string }
  | { type: 'tactic'; direction: SuggestionDirection }

export interface StaffProposalOption {
  id: string
  /** Short imperative label. */
  label: string
  /** The receipt preview — what accepting commits you to. */
  detail: string
  action: StaffAction
}

export interface StaffProposal {
  id: string
  /** Which cast member is pitching (speaker id). */
  speakerId: string
  /** Headline for the item ("Nyberg has gone cold"). */
  title: string
  /** The pitch, including the WHY (grounded in the finding). */
  intro: MeetingLine[]
  options: StaffProposalOption[]
  /** Option the AGM applies if you delegate/skip the meeting. */
  defaultOptionId: string
}

export interface StaffMeetingScene {
  day: number
  year: number
  cast: MeetingSpeaker[]
  opening: MeetingLine[]
  proposals: StaffProposal[]
}

/* ────────────────────────── findings (from live state) ────────────────────────── */

/** A digested observation the career layer produces from the live roster. */
export type StaffFinding =
  | { kind: 'coldTopSix'; playerId: string; name: string; lineIdx: number; form: number }
  | { kind: 'hotDepth'; playerId: string; name: string; lineIdx: number; form: number }
  | { kind: 'injuryRisk'; playerId: string; name: string; risk: number; ltirEligible: boolean }
  | { kind: 'fatigued'; playerId: string; name: string; condition: number }
  | { kind: 'prospectReady'; playerId: string; name: string; overall: number; weakestName?: string }
  | { kind: 'tacticMisfit'; coachFit: number; direction: SuggestionDirection }

/** The four staff voices a meeting can draw on. Built by the career layer from
 *  real hired staff (with sensible fallback names). Speaker ids are stable. */
export interface StaffCast {
  headCoach: MeetingSpeaker
  asstCoach: MeetingSpeaker
  physio: MeetingSpeaker
  asstGM: MeetingSpeaker
}

/** Severity for ordering/capping — the meeting shows the most pressing first. */
function severity(f: StaffFinding): number {
  switch (f.kind) {
    case 'injuryRisk':
      return 100 + f.risk
    case 'fatigued':
      return 80 + (100 - f.condition)
    case 'coldTopSix':
      return 60 - f.form
    case 'prospectReady':
      return 50 + f.overall / 4
    case 'hotDepth':
      return 45 + f.form
    case 'tacticMisfit':
      return 40 + (65 - f.coachFit)
  }
}

const MAX_PROPOSALS = 6

/**
 * Compose the scene. Findings are ordered by severity and capped so the meeting
 * never becomes a wall of items. Returns `proposals: []` when nothing is pressing
 * (the career layer then skips convening a meeting).
 */
export function buildStaffMeetingScene(args: {
  findings: StaffFinding[]
  cast: StaffCast
  day: number
  year: number
  record: { w: number; l: number; otl: number }
}): StaffMeetingScene {
  const { cast, day, year, record } = args
  const ranked = [...args.findings].sort((a, b) => severity(b) - severity(a)).slice(0, MAX_PROPOSALS)
  const proposals = ranked.map((f, i) => proposalFor(f, cast, i))

  const cw = cast.headCoach
  const open = record.w + record.l + record.otl > 0
    ? `${record.w}-${record.l}-${record.otl}. Let's go through the group before the next one.`
    : `Camp's behind us — let's set the room before puck drop.`
  return {
    day,
    year,
    cast: [cast.headCoach, cast.asstCoach, cast.physio, cast.asstGM],
    opening: [{ speakerId: cw.id, text: open }],
    proposals,
  }
}

/** The AGM-delegated choices: apply each item's safe default. */
export function delegatedChoices(scene: StaffMeetingScene): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of scene.proposals) out[p.id] = p.defaultOptionId
  return out
}

/* ────────────────────────── per-finding composers ────────────────────────── */

function proposalFor(f: StaffFinding, cast: StaffCast, idx: number): StaffProposal {
  const id = `sm${idx}`
  switch (f.kind) {
    case 'coldTopSix':
      return {
        id,
        speakerId: cast.asstCoach.id,
        title: `${f.name} has gone cold`,
        intro: [
          {
            speakerId: cast.asstCoach.id,
            text: `${f.name}'s been invisible at five-on-five — he's pressing and it's dragging the ${lineName(f.lineIdx)} down. I'd shake it up.`,
          },
        ],
        options: [
          { id: 'drop', label: 'Drop him to the third line', detail: `Move ${f.name} to the 3rd line to reset him`, action: { type: 'moveLine', playerId: f.playerId, toLine: 2 } },
          { id: 'sit', label: 'Sit him a game', detail: `Scratch ${f.name} for the next game`, action: { type: 'scratch', playerId: f.playerId } },
          { id: 'keep', label: 'Leave it — give him time', detail: 'No change; trust him to play out of it', action: { type: 'none' } },
        ],
        defaultOptionId: 'keep',
      }
    case 'injuryRisk':
      return {
        id,
        speakerId: cast.physio.id,
        title: `${f.name} is an injury risk`,
        intro: [
          {
            speakerId: cast.physio.id,
            text: `I'm not comfortable with ${f.name} — he's flagging at ${Math.round(f.risk)}% re-injury risk. Push him and we could lose him for weeks.`,
          },
        ],
        options: [
          { id: 'rest', label: 'Rest him', detail: `Sit ${f.name} until he's right`, action: { type: 'rest', playerId: f.playerId } },
          ...(f.ltirEligible
            ? [{ id: 'ltir', label: 'Put him on LTIR', detail: `Move ${f.name} to LTIR and free the cap space`, action: { type: 'ltir', playerId: f.playerId } as StaffAction }]
            : []),
          { id: 'play', label: 'Play him', detail: `Keep ${f.name} in the lineup and manage it`, action: { type: 'none' } },
        ],
        defaultOptionId: 'rest',
      }
    case 'fatigued':
      return {
        id,
        speakerId: cast.physio.id,
        title: `${f.name} is running on empty`,
        intro: [
          {
            speakerId: cast.physio.id,
            text: `${f.name}'s down to ${Math.round(f.condition)}% condition. He's a passenger out there right now — a night off would bring him back.`,
          },
        ],
        options: [
          { id: 'rest', label: 'Rest him', detail: `Give ${f.name} recovery time`, action: { type: 'rest', playerId: f.playerId } },
          { id: 'sit', label: 'Scratch him tonight', detail: `Sit ${f.name} for the next game`, action: { type: 'scratch', playerId: f.playerId } },
          { id: 'push', label: 'Ride him', detail: 'No change; he plays through it', action: { type: 'none' } },
        ],
        defaultOptionId: 'push',
      }
    case 'hotDepth':
      return {
        id,
        speakerId: cast.asstCoach.id,
        title: `${f.name} is heating up`,
        intro: [
          {
            speakerId: cast.asstCoach.id,
            text: `${f.name} has been our best forward on the ${lineName(f.lineIdx)} — he's earned a longer look with better linemates. I'd bump him up.`,
          },
        ],
        options: [
          { id: 'promote', label: 'Promote him to the second line', detail: `Move ${f.name} up to the 2nd line`, action: { type: 'moveLine', playerId: f.playerId, toLine: 1 } },
          { id: 'keep', label: 'Keep him where he is', detail: 'No change; let the run continue in his role', action: { type: 'none' } },
        ],
        defaultOptionId: 'keep',
      }
    case 'prospectReady':
      return {
        id,
        speakerId: cast.asstGM.id,
        title: `${f.name} is ready`,
        intro: [
          {
            speakerId: cast.asstGM.id,
            text: `${f.name} has nothing left to prove in the minors${f.weakestName ? ` — he's better than ${f.weakestName} right now` : ''}. He's earned a look.`,
          },
        ],
        options: [
          { id: 'up', label: 'Call him up', detail: `Recall ${f.name} to the NHL roster`, action: { type: 'callUp', playerId: f.playerId } },
          { id: 'wait', label: 'Leave him in the AHL', detail: 'Keep developing him in the minors', action: { type: 'none' } },
        ],
        defaultOptionId: 'wait',
      }
    case 'tacticMisfit':
      return {
        id,
        speakerId: cast.headCoach.id,
        title: `Our system doesn't fit this roster`,
        intro: [
          {
            speakerId: cast.headCoach.id,
            text: `We're getting caved in out there — the system and the personnel just aren't talking. I'd adjust how we play to suit what we've got.`,
          },
        ],
        options: [
          { id: 'shift', label: 'Adjust to the roster', detail: 'Shift the system toward what the players do well', action: { type: 'tactic', direction: f.direction } },
          { id: 'stand', label: 'Stand pat', detail: 'Trust the system; make the players fit it', action: { type: 'none' } },
        ],
        defaultOptionId: 'stand',
      }
  }
}

function lineName(idx: number): string {
  return idx === 0 ? 'top line' : idx === 1 ? 'second line' : idx === 2 ? 'third line' : 'fourth line'
}
