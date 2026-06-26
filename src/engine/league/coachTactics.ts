/**
 * Coach-owned tactics + staff-meeting suggestions.
 *
 * The GM no longer edits the tactical system directly — the head coach owns it.
 * The GM can make suggestions in a staff meeting; whether the coach adopts a
 * change depends on his tactical knowledge and demeanour, and on whether the
 * change actually improves how the system fits the roster. This makes the coach
 * you hire genuinely matter.
 *
 * Pure + deterministic: no Rng, no Date. The career layer applies the returned
 * tactics to the team. Calibration-safe: nothing here runs unless the GM makes a
 * suggestion, so default tactics are untouched.
 */

import type { Player, TeamTactics, ForecheckSystem } from '@domain'
import type { StaffMember } from './staff'
import { styleMatch, teamStyleFit } from './archetypes'

export type SuggestionDirection =
  | 'faster'
  | 'defensive'
  | 'physical'
  | 'aggressiveForecheck'
  | 'fitRoster'

export interface CoachSuggestionOption {
  id: SuggestionDirection
  label: string
  detail: string
}

export const COACH_SUGGESTIONS: CoachSuggestionOption[] = [
  { id: 'fitRoster',          label: 'Play to our roster’s strengths', detail: 'Let the coach set the system that best fits the players.' },
  { id: 'faster',             label: 'Play faster',                     detail: 'Push the pace and attack in transition.' },
  { id: 'defensive',          label: 'Tighten up defensively',          detail: 'Lower the tempo and protect our own end.' },
  { id: 'physical',           label: 'Play more physical',              detail: 'Lean on a heavy cycle and win the puck battles.' },
  { id: 'aggressiveForecheck', label: 'Forecheck more aggressively',    detail: 'Pressure the puck high with a 2-1-2.' },
]

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** Produce candidate tactics for a suggestion direction (does not mutate input). */
function applyDirection(tactics: TeamTactics, direction: SuggestionDirection, roster: Player[]): TeamTactics {
  const t: TeamTactics = JSON.parse(JSON.stringify(tactics))
  switch (direction) {
    case 'faster':
      t.tempo.pace = clamp01(t.tempo.pace + 0.2)
      t.tempo.shotEagerness = clamp01(t.tempo.shotEagerness + 0.1)
      if (t.forecheck === 'trap') t.forecheck = '2-1-2'
      break
    case 'defensive':
      t.tempo.pace = clamp01(t.tempo.pace - 0.2)
      t.tempo.defensivePinch = clamp01(t.tempo.defensivePinch - 0.15)
      if (t.tempo.pace <= 0.35) t.forecheck = 'trap'
      break
    case 'physical':
      t.forecheck = '2-1-2'
      t.tempo.pace = clamp01(Math.min(t.tempo.pace, 0.5))
      t.tempo.shotEagerness = clamp01(t.tempo.shotEagerness + 0.05)
      break
    case 'aggressiveForecheck':
      t.forecheck = '2-1-2' as ForecheckSystem
      break
    case 'fitRoster': {
      const fit = teamStyleFit({ roster }).suggestedTactics
      if (fit.forecheck) t.forecheck = fit.forecheck
      if (fit.tempo) t.tempo = { ...t.tempo, ...fit.tempo }
      break
    }
  }
  return t
}

export interface SuggestionEvaluation {
  accepted: boolean
  /** The coach's spoken response. */
  response: string
  /** New tactics to apply (only when accepted). */
  newTactics?: TeamTactics
}

/** Coach openness to being told how to coach, 0–1, from demeanour + knowledge. */
function coachOpenness(coach: StaffMember): number {
  const demeanor = coach.demeanor ?? ''
  let base: number
  switch (demeanor) {
    case 'analytical': base = 0.72; break
    case 'pragmatic':  base = 0.68; break
    case 'calm':       base = 0.60; break
    case 'motivator':  base = 0.52; break
    case 'fiery':      base = 0.40; break
    default:           base = 0.55
  }
  // A very accomplished tactician trusts his own system a little more.
  base -= Math.max(0, (coach.rating - 70)) * 0.004
  return clamp01(base)
}

/**
 * Evaluate a GM suggestion. The coach accepts when the change clearly improves
 * roster fit, or when it's a reasonable idea and he's open to it. Deterministic.
 */
export function evaluateCoachSuggestion(args: {
  coach: StaffMember
  roster: Player[]
  tactics: TeamTactics
  direction: SuggestionDirection
}): SuggestionEvaluation {
  const { coach, roster, tactics, direction } = args
  const candidate = applyDirection(tactics, direction, roster)

  const before = styleMatch(roster, tactics).fit
  const after = styleMatch(roster, candidate).fit
  const fitGain = after - before
  const openness = coachOpenness(coach)

  // A skilled tactician trusts his own read: he still embraces a clear
  // improvement, but resists being pushed AWAY from what fits the roster.
  const knowledge = coach.profile?.tacticsKnowledge ?? clamp01((coach.rating - 40) / 50)
  const stubborn = knowledge >= 0.6

  const accepted =
    fitGain > 6 ||
    (fitGain >= 0 && openness >= 0.55) ||
    (fitGain > -4 && openness >= 0.7 && !stubborn)

  const first = coach.name.split(' ')[0] ?? coach.name
  let response: string
  if (accepted) {
    response =
      fitGain > 6
        ? `${first} agrees — "Good call. That suits this group far better. We'll make the switch."`
        : `${first} nods — "I can work with that. We'll give it a go."`
  } else {
    response =
      fitGain < -4
        ? `${first} pushes back — "With respect, that doesn't fit these players. I'm keeping our system."`
        : `${first} is unconvinced — "I hear you, but I trust what we're running. Let's stay the course."`
  }

  const result: SuggestionEvaluation = { accepted, response }
  if (accepted) result.newTactics = candidate
  return result
}
