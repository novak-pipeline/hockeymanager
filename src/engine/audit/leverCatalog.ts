/**
 * The catalogue of every lever the GM can move that could plausibly change a
 * game result — the input to the audit in docs/LEVER-AUDIT.md (task #154).
 *
 * Each entry pushes the lever to its extreme on one bench and its opposite on
 * the other, so a single mirror series measures the lever's FULL SPAN. See
 * leverLab.ts for the method and the classification bar.
 *
 * Levers whose fields no engine code reads at all are NOT listed here — they
 * are proven dead statically (grep), not statistically, and are recorded in
 * leverStaticAudit.ts. Development and lineup-selection levers, which do not
 * resolve into a single game, are measured in leverDevLab.ts.
 */
import type { Team } from '@domain'
import {
  orderDressed,
  orderGoalies,
  stackLines,
  stackSpecialTeams,
  type LeverSpec,
} from './leverLab'

const noop = (): void => {}

/** Set a nested tempo slider without disturbing the rest of the object. */
const tempo = (key: 'pace' | 'passRisk' | 'shotEagerness' | 'defensivePinch', v: number) =>
  (t: Team): void => { t.tactics.tempo = { ...t.tactics.tempo, [key]: v } }

/** Set a top-level optional slider. */
const slider = (key: 'aggressiveness' | 'hitting' | 'gapControl' | 'puckPressure' | 'passing' | 'shooting' | 'dumping', v: number) =>
  (t: Team): void => { t.tactics[key] = v }

/* ────────────────────────── quick-sim levers ────────────────────────── */
/* These run in the DEFAULT play path: career.advanceDay sims every game —
 * including the user's — through quickSimGame. Only a game the GM explicitly
 * watches goes through the full engine. A lever that lives only in the full sim
 * therefore does nothing on the path most GMs play most nights. */

export const QUICK_LEVERS: LeverSpec[] = [
  {
    id: 'q-line-assembly',
    name: 'Line assembly (who plays on which line)',
    surface: 'Tactics → line board',
    engine: 'quick',
    contrast: 'best 12F/6D dressed, strongest on L1/D1  vs  worst 12F/6D dressed, weakest on L1/D1',
    max: (t, r) => stackLines(t, r.resolve, 'best-first'),
    min: (t, r) => stackLines(t, r.resolve, 'worst-first'),
  },
  {
    id: 'q-line-order',
    name: 'Line ORDER (same 18 dressed)',
    surface: 'Tactics → line board',
    engine: 'quick',
    contrast: 'same 12F/6D, strongest on L1/D1  vs  same 12F/6D, weakest on L1/D1',
    max: (t, r) => orderDressed(t, r.resolve, 'best-first'),
    min: (t, r) => orderDressed(t, r.resolve, 'worst-first'),
  },
  {
    id: 'q-goalie-start',
    name: 'Goalie depth order (who starts)',
    surface: 'Tactics → line board (goalies)',
    engine: 'quick',
    contrast: 'better goalie listed as starter  vs  worse goalie listed as starter',
    max: (t, r) => orderGoalies(t, r.resolve, 'best'),
    min: (t, r) => orderGoalies(t, r.resolve, 'worst'),
  },
  {
    id: 'q-pp-units',
    name: 'Power-play unit composition',
    surface: 'Tactics → PP1/PP2',
    engine: 'quick',
    contrast: 'best scorers on PP1  vs  worst skaters on PP1',
    max: (t, r) => stackSpecialTeams(t, r.resolve, 'pp', 'best'),
    min: (t, r) => stackSpecialTeams(t, r.resolve, 'pp', 'worst'),
  },
  {
    id: 'q-pk-units',
    name: 'Penalty-kill unit composition',
    surface: 'Tactics → PK1/PK2',
    engine: 'quick',
    contrast: 'best defensive men on PK1  vs  worst on PK1',
    max: (t, r) => stackSpecialTeams(t, r.resolve, 'pk', 'best'),
    min: (t, r) => stackSpecialTeams(t, r.resolve, 'pk', 'worst'),
  },
  {
    id: 'q-line-matching',
    name: 'Line matching (home last change)',
    surface: 'Coach system (not GM-settable)',
    engine: 'quick',
    contrast: 'lineMatching on  vs  off',
    max: (t) => { t.tactics.lineMatching = true },
    min: (t) => { t.tactics.lineMatching = false },
  },
  {
    id: 'q-coach-fit',
    name: 'Coach roster fit',
    surface: 'Staff → hire coach',
    engine: 'quick',
    contrast: 'coachFit 100  vs  coachFit 0',
    max: (t) => { t.coachFit = 100 },
    min: (t) => { t.coachFit = 0 },
  },
  {
    id: 'q-pp-edge',
    name: 'Coach power-play edge (ppEdge)',
    surface: 'Staff → hire coach (PP competence)',
    engine: 'quick',
    contrast: 'ppEdge 1.15  vs  ppEdge 0.85',
    max: (t) => { t.ppEdge = 1.15 },
    min: (t) => { t.ppEdge = 0.85 },
  },
  {
    id: 'q-pk-edge',
    name: 'Coach penalty-kill edge (pkEdge)',
    surface: 'Staff → hire coach (PK competence)',
    engine: 'quick',
    contrast: 'pkEdge 0.85 (strong kill)  vs  pkEdge 1.15 (leaky kill)',
    max: (t) => { t.pkEdge = 0.85 },
    min: (t) => { t.pkEdge = 1.15 },
  },
]

/* ────────────────────────── full-sim tactical levers ────────────────────────── */
/* Everything the tactics model exposes that some engine code actually reads.
 * All of these live in the full (watched) engine only. */

export const FULL_LEVERS: LeverSpec[] = [
  {
    id: 'f-forecheck',
    name: 'Forecheck system',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: "'2-1-2' (aggressive)  vs  'trap'",
    max: (t) => { t.tactics.forecheck = '2-1-2' },
    min: (t) => { t.tactics.forecheck = 'trap' },
  },
  {
    id: 'f-dzone',
    name: 'D-zone coverage',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: "'man'  vs  'zone'",
    max: (t) => { t.tactics.dZoneCoverage = 'man' },
    min: (t) => { t.tactics.dZoneCoverage = 'zone' },
  },
  {
    id: 'f-pp-formation',
    name: 'Power-play formation',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: "'1-3-1'  vs  'overload'",
    max: (t) => { t.tactics.specialTeams = { ...t.tactics.specialTeams, powerPlay: '1-3-1' } },
    min: (t) => { t.tactics.specialTeams = { ...t.tactics.specialTeams, powerPlay: 'overload' } },
  },
  {
    id: 'f-pk-formation',
    name: 'Penalty-kill formation',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: "'aggressive'  vs  'box'",
    max: (t) => { t.tactics.specialTeams = { ...t.tactics.specialTeams, penaltyKill: 'aggressive' } },
    min: (t) => { t.tactics.specialTeams = { ...t.tactics.specialTeams, penaltyKill: 'box' } },
  },
  {
    id: 'f-pace',
    name: 'Tempo: pace',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: 'pace 1.0  vs  pace 0.0',
    max: tempo('pace', 1),
    min: tempo('pace', 0),
  },
  {
    id: 'f-passrisk',
    name: 'Tempo: pass risk',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: 'passRisk 1.0  vs  passRisk 0.0',
    max: tempo('passRisk', 1),
    min: tempo('passRisk', 0),
  },
  {
    id: 'f-shoteager',
    name: 'Tempo: shot eagerness',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: 'shotEagerness 1.0  vs  shotEagerness 0.0',
    max: tempo('shotEagerness', 1),
    min: tempo('shotEagerness', 0),
  },
  {
    id: 'f-pinch',
    name: 'Tempo: defensive pinch',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: 'defensivePinch 1.0  vs  defensivePinch 0.0',
    max: tempo('defensivePinch', 1),
    min: tempo('defensivePinch', 0),
  },
  {
    id: 'f-aggressiveness',
    name: 'Aggressiveness',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: '1.0 (chippy)  vs  0.0 (disciplined)',
    max: slider('aggressiveness', 1),
    min: slider('aggressiveness', 0),
  },
  {
    id: 'f-hitting',
    name: 'Hitting',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: '1.0 (punishing)  vs  0.0 (avoid contact)',
    max: slider('hitting', 1),
    min: slider('hitting', 0),
  },
  {
    id: 'f-gapcontrol',
    name: 'Gap control',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: '1.0 (tight)  vs  0.0 (loose)',
    max: slider('gapControl', 1),
    min: slider('gapControl', 0),
  },
  {
    id: 'f-puckpressure',
    name: 'Puck pressure',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: '1.0 (swarming)  vs  0.0 (passive)',
    max: slider('puckPressure', 1),
    min: slider('puckPressure', 0),
  },
  {
    id: 'f-passing',
    name: 'Passing',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: '1.0 (heavy puck movement)  vs  0.0 (individual)',
    max: slider('passing', 1),
    min: slider('passing', 0),
  },
  {
    id: 'f-shooting',
    name: 'Shooting',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: '1.0 (shoot on sight)  vs  0.0 (patient)',
    max: slider('shooting', 1),
    min: slider('shooting', 0),
  },
  {
    id: 'f-dumping',
    name: 'Dumping',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: '1.0 (always dump)  vs  0.0 (always carry)',
    max: slider('dumping', 1),
    min: slider('dumping', 0),
  },
  {
    id: 'f-line-matching',
    name: 'Line matching (home last change) — full engine',
    surface: 'Coach system (not GM-settable)',
    engine: 'full',
    contrast: 'lineMatching on  vs  off',
    max: (t) => { t.tactics.lineMatching = true },
    min: (t) => { t.tactics.lineMatching = false },
  },
  {
    id: 'f-line-assembly',
    name: 'Line assembly — full engine',
    surface: 'Tactics → line board',
    engine: 'full',
    contrast: 'best 12F/6D dressed, strongest on L1/D1  vs  worst 12F/6D dressed, weakest on L1/D1',
    max: (t, r) => stackLines(t, r.resolve, 'best-first'),
    min: (t, r) => stackLines(t, r.resolve, 'worst-first'),
  },
]

/* ────────────────────────── condition levers ────────────────────────── */
/* Not tactics — the channel through which morale, fatigue and form reach the
 * ice (condition.effectiveResolve, which career.ts wraps every sim in). These
 * calibrate what a GM's man-management decisions are actually worth, because
 * squad-status promises, healthy scratches, the recovery practice week, rest
 * days and the captaincy all cash out here and nowhere else. */

const setAll = (mut: (p: import('@domain').Player) => void) =>
  (t: Team, r: import('./leverLab').Rink): void => {
    for (const id of t.roster) mut(r.resolve(id))
  }

export const CONDITION_LEVERS: LeverSpec[] = [
  {
    id: 'c-morale',
    name: 'Team morale',
    surface: 'Squad status, scratches, meetings, media, winning',
    engine: 'quick',
    condition: true,
    contrast: 'happy room (morale 80)  vs  unhappy room (morale 35)',
    max: setAll((p) => { p.morale = 80 }),
    min: setAll((p) => { p.morale = 35 }),
  },
  {
    id: 'c-fatigue',
    name: 'Team freshness (fatigue)',
    surface: 'Practice focus, rest days, call-ups',
    engine: 'quick',
    condition: true,
    contrast: 'fresh legs (fatigue 2)  vs  worn down (fatigue 18) — the realistic in-season range',
    max: setAll((p) => { p.fatigue = 2 }),
    min: setAll((p) => { p.fatigue = 18 }),
  },
  {
    id: 'c-form',
    name: 'Team form',
    surface: 'Not directly settable — an outcome of results',
    engine: 'quick',
    condition: true,
    contrast: 'hot team (form +2.5)  vs  cold team (form −2.5) — a plausible whole-roster swing',
    max: setAll((p) => { p.form = 2.5 }),
    min: setAll((p) => { p.form = -2.5 }),
  },
]

/** A no-op control: both benches identical. Confirms the rig itself reads zero
 *  — if this comes back significant, the harness is biased and every other
 *  number in the table is suspect. */
export const NULL_LEVER: LeverSpec = {
  id: 'null-control',
  name: 'NULL CONTROL (no lever moved)',
  surface: '—',
  engine: 'quick',
  contrast: 'identical benches — must measure zero',
  max: noop,
  min: noop,
}

export const NULL_LEVER_FULL: LeverSpec = {
  ...NULL_LEVER,
  id: 'null-control-full',
  name: 'NULL CONTROL (no lever moved) — full engine',
  engine: 'full',
}
