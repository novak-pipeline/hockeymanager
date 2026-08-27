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
  | { type: 'setDevFocus'; playerId: string } // apply the coach's recommended development plan

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
  /** True for an INFO briefing — a staff member reporting real numbers with no
   *  decision to make. Info items carry `facts` and an empty `options` array. */
  info?: boolean
  /** Cited, data-grounded bullet points shown under an INFO briefing's pitch. */
  facts?: string[]
}

export interface StaffMeetingScene {
  day: number
  year: number
  cast: MeetingSpeaker[]
  opening: MeetingLine[]
  proposals: StaffProposal[]
}

/* ────────────────────────── findings (from live state) ────────────────────────── */

/** A digested observation the career layer produces from the live roster.
 *
 *  Two families: DECISION findings (the GM picks an option that mutates the sim)
 *  and `*Info` INFO briefings (a staff member reports real, cited numbers — no
 *  decision). The career layer computes both from live state; this module only
 *  renders them, so all display numbers arrive pre-computed on the finding. */
export type StaffFinding =
  // ── decisions (mutate the sim) ──
  | { kind: 'coldTopSix'; playerId: string; name: string; lineIdx: number; form: number }
  | { kind: 'hotDepth'; playerId: string; name: string; lineIdx: number; form: number }
  | { kind: 'injuryRisk'; playerId: string; name: string; risk: number; ltirEligible: boolean }
  | { kind: 'fatigued'; playerId: string; name: string; condition: number }
  | { kind: 'prospectReady'; playerId: string; name: string; overall: number; weakestName?: string }
  | { kind: 'tacticMisfit'; coachFit: number; direction: SuggestionDirection }
  | { kind: 'devFocusUnset'; playerId: string; name: string; potential: number; suggested: string; where: string }
  // ── info briefings (no decision; cite real numbers) ──
  | { kind: 'teamFormInfo'; record: string; points: number; lastTen: string; gfPer: number; gaPer: number; streakText: string; trend: 'up' | 'down' | 'flat' }
  | { kind: 'injuryOutlookInfo'; count: number; items: Array<{ name: string; weeks: number; desc: string }> }
  | { kind: 'toughStretchInfo'; games: number; oppNames: string[]; toughCount: number; avgRank: number; totalTeams: number }
  | { kind: 'lineChemistryInfo'; bestLine: string; bestScore: number; bestReason: string; worstLine: string; worstScore: number; worstReason: string }
  | { kind: 'capRosterInfo'; capSpaceM: number; usedPct: number; rosterSize: number }
  | { kind: 'slumpingStarInfo'; name: string; ppg: number; expectedPpg: number; games: number; pointsBehind: number }
  // E1: the org's prospects, read out loud. A club is bigger than the twenty
  // men who dress, and the room should sound like it knows that.
  | { kind: 'farmReportInfo'; headline: string; facts: string[] }

/** Info briefings are titled `*Info`; everything else is a decision the GM makes. */
export function isInfoFinding(f: StaffFinding): boolean {
  return f.kind.endsWith('Info')
}

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
    case 'teamFormInfo':
      return 76
    case 'toughStretchInfo':
      return 68
    case 'coldTopSix':
      return 60 - f.form
    case 'injuryOutlookInfo':
      return 58 + Math.min(20, f.count * 4)
    case 'slumpingStarInfo':
      return 56 + Math.min(12, f.pointsBehind)
    case 'prospectReady':
      return 50 + f.overall / 4
    case 'hotDepth':
      return 45 + f.form
    case 'lineChemistryInfo':
      return 43
    case 'tacticMisfit':
      return 40 + (65 - f.coachFit)
    case 'capRosterInfo':
      return 36
    case 'devFocusUnset':
      return 35 + f.potential / 4
    // The system report is real content, not filler, but it never outranks a
    // decision the GM has to make about this Saturday.
    case 'farmReportInfo':
      return 41
  }
}

/** Caps: keep the meeting substantial but not a wall. Decisions can fill up to
 *  MAX_DECISIONS on their own (the historic behaviour); info briefings ride
 *  alongside up to MAX_INFO, and the whole agenda is trimmed to MAX_ITEMS. */
const MAX_DECISIONS = 6
const MAX_INFO = 3
const MAX_ITEMS = 7

/**
 * Compose the scene as an EHM-style sequence of agenda items — a mix of INFO
 * briefings (real numbers, no decision) and DECISIONS (grounded options that
 * mutate the sim). The team-form briefing always opens; the rest follow by
 * severity. Returns `proposals: []` when there's nothing to raise (the career
 * layer then skips convening a meeting).
 */
export function buildStaffMeetingScene(args: {
  findings: StaffFinding[]
  cast: StaffCast
  day: number
  year: number
  record: { w: number; l: number; otl: number }
}): StaffMeetingScene {
  const { cast, day, year, record } = args
  const byImportance = (a: StaffFinding, b: StaffFinding): number => severity(b) - severity(a)
  const infos = args.findings.filter(isInfoFinding).sort(byImportance).slice(0, MAX_INFO)
  const decisions = args.findings.filter((f) => !isInfoFinding(f)).sort(byImportance).slice(0, MAX_DECISIONS)
  const ranked = [...infos, ...decisions]
    .sort((a, b) => {
      // The state-of-the-team briefing always opens the meeting.
      if (a.kind === 'teamFormInfo') return -1
      if (b.kind === 'teamFormInfo') return 1
      return byImportance(a, b)
    })
    .slice(0, MAX_ITEMS)
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
    case 'hotDepth': {
      // Promote ONE line up — never leap a 4th-liner onto the 2nd line, which
      // was the old nonsensical prompt. A 3rd-liner earns the 2nd line; a
      // 4th-liner earns the 3rd.
      const toLine = Math.max(1, f.lineIdx - 1)
      const dest = lineName(toLine)
      return {
        id,
        speakerId: cast.asstCoach.id,
        title: `${f.name} is heating up`,
        intro: [
          {
            speakerId: cast.asstCoach.id,
            text: `${f.name} has been our best forward on the ${lineName(f.lineIdx)} — he's earned a longer look with better linemates. I'd move him up to the ${dest}.`,
          },
        ],
        options: [
          { id: 'promote', label: `Promote him to the ${dest}`, detail: `Move ${f.name} up to the ${dest}`, action: { type: 'moveLine', playerId: f.playerId, toLine } },
          { id: 'keep', label: 'Keep him where he is', detail: 'No change; let the run continue in his role', action: { type: 'none' } },
        ],
        defaultOptionId: 'keep',
      }
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
    case 'devFocusUnset':
      return {
        id,
        speakerId: cast.asstCoach.id,
        title: `No development plan for ${f.name}`,
        intro: [
          {
            speakerId: cast.asstCoach.id,
            text: `We've got ${f.name} ${f.where} and nobody's steering his work. He's worth developing — I'd put his practice on ${f.suggested} and actually build something.`,
          },
        ],
        options: [
          { id: 'set', label: `Focus his game on ${f.suggested}`, detail: `Set ${f.name}'s development plan to ${f.suggested}`, action: { type: 'setDevFocus', playerId: f.playerId } },
          { id: 'leave', label: 'Leave it to the staff', detail: `No plan set — ${f.name} develops on the general program`, action: { type: 'none' } },
        ],
        defaultOptionId: 'set',
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

    /* ── INFO briefings: a staff voice reports real numbers; no decision ── */
    case 'teamFormInfo': {
      const lead =
        f.trend === 'up'
          ? `We're trending the right way — ${f.streakText}. Here's where the group sits.`
          : f.trend === 'down'
            ? `We've cooled off — ${f.streakText}. Let me lay out where we are.`
            : `Steady as she goes. Here's the state of the group.`
      return info(id, cast.headCoach.id, 'Where we stand', lead, [
        `Record ${f.record} · ${f.points} pts`,
        `Last 10: ${f.lastTen}`,
        `${f.gfPer.toFixed(1)} goals for / ${f.gaPer.toFixed(1)} against per game`,
      ])
    }
    case 'injuryOutlookInfo': {
      const lead =
        f.count === 0
          ? `Good news — the room's healthy right now.`
          : `${f.count} ${f.count === 1 ? 'man' : 'men'} on the shelf. Here's the outlook.`
      return info(id, cast.physio.id, 'Injury outlook', lead,
        f.items.map((it) => `${it.name} — ${it.desc} (${outlookText(it.weeks)})`))
    }
    case 'toughStretchInfo': {
      const lead = `Heads up — the next ${f.games} won't be easy. ${f.toughCount} of them are top-10 clubs.`
      return info(id, cast.asstCoach.id, 'The road ahead', lead, [
        `Next up: ${f.oppNames.join(', ')}`,
        `${f.toughCount} of ${f.games} opponents rank top-10 (of ${f.totalTeams})`,
        `Average opponent rank: ${f.avgRank} of ${f.totalTeams}`,
      ])
    }
    case 'lineChemistryInfo':
      return info(id, cast.asstCoach.id, 'Line chemistry', `One line's clicking, one isn't. Worth a look.`, [
        `Best: ${f.bestLine} — ${f.bestScore}/100 · ${f.bestReason}`,
        `Watch: ${f.worstLine} — ${f.worstScore}/100 · ${f.worstReason}`,
      ])
    case 'capRosterInfo': {
      const lead =
        f.capSpaceM < 1
          ? `We're right up against the cap — no room to add without moving money.`
          : `We've got some flexibility. Here's the cap picture.`
      return info(id, cast.asstGM.id, 'Cap & roster', lead, [
        `Cap space: $${f.capSpaceM.toFixed(1)}M`,
        `Cap used: ${f.usedPct}%`,
        `Active roster: ${f.rosterSize}`,
      ])
    }
    case 'slumpingStarInfo':
      return info(id, cast.headCoach.id, `${f.name} is pressing`, `${f.name} isn't producing like he should — worth watching.`, [
        `${f.ppg.toFixed(2)} pts/game over ${f.games} games`,
        `We'd expect closer to ${f.expectedPpg.toFixed(2)} — about ${f.pointsBehind} points light of pace`,
      ])
    case 'farmReportInfo':
      // E1: the AGM owns the system, so the system report is his.
      return info(
        id,
        cast.asstGM.id,
        f.headline,
        `Before we get to Saturday — the kids. This is where the next roster comes from.`,
        f.facts,
      )
  }
}

/** Build an INFO briefing proposal (no options; `facts` render as cited bullets). */
function info(id: string, speakerId: string, title: string, lead: string, facts: string[]): StaffProposal {
  return { id, speakerId, title, intro: [{ speakerId, text: lead }], options: [], defaultOptionId: '', info: true, facts }
}

/** A return-timeline phrase from a games-remaining estimate. */
function outlookText(weeks: number): string {
  if (weeks <= 0) return 'day-to-day'
  if (weeks === 1) return 'out ~1 week'
  return `out ~${weeks} weeks`
}

function lineName(idx: number): string {
  return idx === 0 ? 'top line' : idx === 1 ? 'second line' : idx === 2 ? 'third line' : 'fourth line'
}
