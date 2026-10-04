/**
 * BROADCAST PACKAGE — the presentation-cue vocabulary.
 *
 * Renderer-agnostic. The PresentationDirector (director.ts) reads the game's
 * event stream + the pregame storyline context and emits a timeline of these
 * cues; the host (MatchViewer) routes them:
 *
 *   overlay    → HTML/CSS graphics over the canvas (works over 2D and 3D alike)
 *   shot       → camera shot REQUESTS. The 2D view has one camera and ignores
 *                them; the 3D renderer consumes them through
 *                {@link BroadcastShotConsumer} (see docs/BROADCAST-PACKAGE.md).
 *   moment     → ceremonial moments (rookie lap, ovation, banner…). Captioned by
 *                an overlay today; the 3D skeleton pass animates them later.
 *   commentary → the two-man booth (audio + the text ticker).
 *
 * Types only. No imports with runtime cost, so the Node build script can load
 * sibling modules with plain type-stripping.
 */

/* ───────────────────────────── time ───────────────────────────── */

/**
 * Pregame cues are timed in WALL milliseconds from the start of the open (the
 * renderer is paused, nothing on the ice moves). In-game cues are timed in
 * absolute GAME seconds (timeline absT) so they land on the event regardless
 * of playback speed.
 */
export type CueClock = 'pregame' | 'game'

/* ───────────────────────────── shots ───────────────────────────── */

export type ShotKind =
  | 'establishing'   // wide exterior/interior arena, crowd filing in
  | 'lineups'        // slow push along the blue line during lineup graphics
  | 'anthem'         // blue line, players standing, flag
  | 'faceoffClose'   // tight on the centre-ice dot at a period's first drop
  | 'broadcast'      // return to the main game camera (steady, high side)
  | 'goalReplay'     // replay angle on a goal (window in `replay`)
  | 'saveReplay'     // replay of a big save
  | 'benchReaction'  // cut to a bench (goal, big hit)
  | 'coachCloseup'   // coach at the bench (late tying goal, timeout)
  | 'crowd'          // crowd shot (ovation, goal)
  | 'penaltyBox'     // the offender taking his seat
  | 'jumbotron'      // the video board (tribute video, milestone)

export interface ShotCue {
  channel: 'shot'
  id: string
  clock: CueClock
  at: number
  /** Wall ms after `at` is crossed before the cue fires (post-goal beats). */
  delayMs?: number
  /** How long the shot should hold (wall ms). */
  holdMs: number
  shot: ShotKind
  side?: 'home' | 'away'
  playerId?: string
  /** goalReplay / saveReplay: the game-time window to replay. */
  replay?: { fromAbsT: number; toAbsT: number }
}

/* ───────────────────────────── moments ───────────────────────────── */

export type MomentKind =
  | 'rookieLap'         // debut: solo lap in warmups
  | 'standingOvation'   // homecoming / milestone reached / games milestone
  | 'bannerRaising'     // home opener after a title
  | 'jerseyRetirement'  // number to the rafters (no producer yet)
  | 'tributeVideo'      // homecoming: video board at the first TV timeout

export interface MomentCue {
  channel: 'moment'
  id: string
  clock: CueClock
  at: number
  /** Wall ms after `at` is crossed before the cue fires (post-goal beats). */
  delayMs?: number
  holdMs: number
  moment: MomentKind
  side: 'home' | 'away'
  playerId?: string
  /** The caption line, e.g. "Rookie lap — Ben Kindel, first NHL game". */
  caption: string
  /** The storyline that earned it. */
  storylineId: string
}

/* ───────────────────────────── overlays ───────────────────────────── */

export type OverlayKind =
  | 'arenaTitle'      // pregame: "TONIGHT · ARENA · AWY @ HOM"
  | 'storyCard'       // pregame: one earned storyline
  | 'startingLineup'  // pregame: the starting five + goalie, with faces
  | 'goalieTape'      // pregame: goalie tale-of-the-tape
  | 'playerTag'       // on-ice tag anchored above a player (goal / assist / save)
  | 'lowerThird'      // goal lower-third (face, crest, number, name, time, assists)
  | 'milestone'       // milestone reached graphic
  | 'periodSummary'   // end of period / intermission
  | 'momentCaption'   // caption for a MomentCue
  | 'powerPlay'       // PP strip under the scorebug

export interface GoalDetail {
  scorerId: string
  assistIds: string[]
  strength: 'ev' | 'pp' | 'sh' | 'en'
  /** "14:16" elapsed in the period (broadcast convention). */
  elapsed: string
  period: number
  /** Scorer's goals tonight INCLUDING this one. */
  goalsTonight: number
  side: 'home' | 'away'
}

export interface PeriodDetail {
  period: number
  home: { goals: number; shots: number }
  away: { goals: number; shots: number }
  /** Scorers this period, in order ("KAPRIZOV (PP) 4:12"). */
  goals: Array<{ playerId: string; side: 'home' | 'away'; elapsed: string; strength: GoalDetail['strength'] }>
  final: boolean
}

export type OverlayData =
  | { kind: 'arenaTitle' }
  | { kind: 'storyCard'; storylineId: string; title: string; detail: string; playerId?: string; side: 'home' | 'away' }
  | { kind: 'startingLineup'; side: 'home' | 'away' }
  | { kind: 'goalieTape' }
  | { kind: 'playerTag'; playerId: string; role: 'goal' | 'assist1' | 'assist2' | 'save' | 'milestone'; label: string; stat?: string }
  | { kind: 'lowerThird'; goal: GoalDetail }
  | { kind: 'milestone'; playerId: string; title: string; detail: string }
  | { kind: 'periodSummary'; summary: PeriodDetail }
  | { kind: 'momentCaption'; moment: MomentKind; caption: string; playerId?: string }
  | { kind: 'powerPlay'; side: 'home' | 'away'; offenderId: string; infraction: string }
  /** The call (W2, owner: "there's a penalty and I don't know what it's for"): who, what, how long. */
  | { kind: 'penaltyCall'; playerId: string; infraction: string; minutes: number }

export interface OverlayCue {
  channel: 'overlay'
  id: string
  clock: CueClock
  at: number
  /** Wall ms after `at` is crossed before the cue fires (post-goal beats). */
  delayMs?: number
  holdMs: number
  /** 3 = must show (goal, milestone), 2 = notable, 1 = nice-to-have. The compact
   *  presentation setting drops priority-1 overlays. */
  priority: 1 | 2 | 3
  data: OverlayData
}

/* ───────────────────────────── commentary ───────────────────────────── */

export type Speaker = 'pbp' | 'color'

/** How the name clip should be inflected to match the stem around it. */
export type NameStyle = 'neutral' | 'excited' | 'rising'

/** Surname by default (real broadcasts); full name for introductions and the
 *  biggest moments. */
export type NameForm = 'surname' | 'full'

export interface CommentaryCue {
  channel: 'commentary'
  id: string
  clock: CueClock
  at: number
  /** Wall ms after `at` is crossed before the cue fires (post-goal beats). */
  delayMs?: number
  speaker: Speaker
  /** Library line id, e.g. "goal.lateTie.2". Audio clip ids derive from it. */
  lineId: string
  /** Moment the line was chosen for (library key). */
  moment: string
  /** Display text with the name filled in (ticker + captions). */
  text: string
  /** The name slot, when the line has one. */
  name?: { playerId: string; form: NameForm; style: NameStyle; position: 'lead' | 'tail' }
  /** 3 = must land on the moment (barges in), 2 = notable, 1 = colour/ambient. */
  priority: 1 | 2 | 3
  /** Drop the line if it can't START within this many wall ms of its cue. */
  maxLatencyMs: number
}

export type PresentationCue = ShotCue | MomentCue | OverlayCue | CommentaryCue

/** The director's output. Both lists are sorted by `at`. */
export interface BroadcastPlan {
  /** The pregame open, wall-ms from its start. Empty when presentation is off. */
  pregame: PresentationCue[]
  /** Length of the open in wall ms (skippable). */
  pregameMs: number
  /** Everything after puck drop, keyed by game absT. */
  game: PresentationCue[]
}

/* ───────────────────────────── renderer hooks ───────────────────────────── */

/**
 * What the 3D renderer implements to take the director's camera and moment
 * requests. Optional and additive: a renderer without it (the 2D rink) simply
 * never receives shot cues. See docs/BROADCAST-PACKAGE.md §"3D hand-off".
 *
 * Rules the implementer must keep:
 *  - The main game camera stays STEADY (no shake/jitter). Impact is sold by the
 *    overlays, not by camera wobble.
 *  - A shot request is a request: the renderer may decline one it can't frame
 *    (return false) and the host keeps the broadcast camera.
 *  - `shot: 'broadcast'` always means "back to the main game camera".
 */
export interface BroadcastShotConsumer {
  requestShot(cue: ShotCue): boolean
  /** Play a ceremonial moment (needs the skeleton pass; may no-op until then). */
  playMoment?(cue: MomentCue): boolean
}

/**
 * Screen projection for world-anchored overlays (the on-ice player tag).
 * Returns CSS pixels relative to the renderer's host element, or null when the
 * player isn't on the ice / off camera.
 */
export interface BroadcastProjector {
  projectPlayer(playerId: string): { x: number; y: number } | null
}

/* ───────────────────────────── 3D hand-off tables ───────────────────────────── */

/**
 * How the 3D renderer should frame each shot, matched to its camera rig
 * (src/render3d: CameraPreset 'broadcast' | 'overhead' | 'endzone' | 'follow',
 * critically-damped springs, soft dead-band, NO shake). `preset` names the
 * existing preset to reuse when one fits; `custom` shots are new framings the
 * renderer adds behind requestShot(). All motion is slow: 'hold' = locked off,
 * 'push' = slow dolly-in, 'pan' = slow pan following the subject. Never a whip.
 */
export interface ShotFraming {
  preset: 'broadcast' | 'overhead' | 'endzone' | 'follow' | 'custom'
  subject: 'play' | 'player' | 'centreDot' | 'bench' | 'crowd' | 'penaltyBox' | 'videoBoard' | 'blueLine' | 'arena'
  /** Vertical field of view hint (degrees). The broadcast camera runs ~30°. */
  fovDeg: number
  motion: 'hold' | 'push' | 'pan'
}

export const SHOT_FRAMING: Readonly<Record<ShotKind, ShotFraming>> = {
  establishing: { preset: 'custom', subject: 'arena', fovDeg: 55, motion: 'pan' },
  lineups: { preset: 'custom', subject: 'blueLine', fovDeg: 28, motion: 'pan' },
  anthem: { preset: 'custom', subject: 'blueLine', fovDeg: 35, motion: 'hold' },
  faceoffClose: { preset: 'custom', subject: 'centreDot', fovDeg: 22, motion: 'push' },
  broadcast: { preset: 'broadcast', subject: 'play', fovDeg: 30, motion: 'pan' },
  goalReplay: { preset: 'endzone', subject: 'play', fovDeg: 34, motion: 'hold' },
  saveReplay: { preset: 'endzone', subject: 'player', fovDeg: 26, motion: 'push' },
  benchReaction: { preset: 'custom', subject: 'bench', fovDeg: 24, motion: 'hold' },
  coachCloseup: { preset: 'custom', subject: 'bench', fovDeg: 14, motion: 'hold' },
  crowd: { preset: 'custom', subject: 'crowd', fovDeg: 30, motion: 'pan' },
  penaltyBox: { preset: 'custom', subject: 'penaltyBox', fovDeg: 20, motion: 'hold' },
  jumbotron: { preset: 'custom', subject: 'videoBoard', fovDeg: 26, motion: 'push' },
}

/**
 * Moment choreography for the 3D skeleton (bone names from src/render3d
 * athlete.ts BONE_NAMES: root, hips, spine, chest, neck, head, shoulder_*,
 * upperarm_*, forearm_*, hand_*, thigh_*, shin_*, foot_*, stick, stick_blade).
 * Everything is expressed as existing pose drivers (stride/lean/facing/IK) plus
 * the renderer's crowd + video board, so no new rig is needed:
 */
export interface MomentChoreography {
  /** Which skaters are on the ice for it. */
  cast: 'subjectOnly' | 'subjectAndTeam' | 'bothTeams' | 'none'
  /** Path for the subject in normalized rink space ([-1,1]), skated at `pace`. */
  path?: Array<{ x: number; y: number }>
  pace?: 'glide' | 'stride'
  /** Pose beats on the subject, in order. 'stickRaise' is the existing
   *  celebration pose; 'tap' = stick tapping the ice (teammates' salute). */
  poses: Array<'stickRaise' | 'wave' | 'tap' | 'helmetOff' | 'standStill'>
  crowd: 'seated' | 'cheer' | 'standing'
  videoBoard?: 'tribute' | 'milestone' | 'banner'
}

export const MOMENT_CHOREOGRAPHY: Readonly<Record<MomentKind, MomentChoreography>> = {
  // Warmups: teammates hang back at the bench, the rookie does a solo lap.
  rookieLap: {
    cast: 'subjectAndTeam', pace: 'glide', poses: ['wave'], crowd: 'cheer',
    path: [{ x: 0, y: 0.8 }, { x: 0.85, y: 0.55 }, { x: 0.85, y: -0.55 }, { x: 0, y: -0.8 }, { x: -0.85, y: -0.55 }, { x: -0.85, y: 0.55 }, { x: 0, y: 0.8 }],
  },
  standingOvation: { cast: 'subjectAndTeam', poses: ['stickRaise', 'tap'], crowd: 'standing' },
  bannerRaising: { cast: 'bothTeams', poses: ['standStill'], crowd: 'standing', videoBoard: 'banner' },
  jerseyRetirement: { cast: 'none', poses: [], crowd: 'standing', videoBoard: 'banner' },
  tributeVideo: { cast: 'subjectOnly', poses: ['wave', 'helmetOff'], crowd: 'standing', videoBoard: 'tribute' },
}
