/**
 * THE BODY LIMITS (W3 S2, docs/gameplan-2026-09-28/W3-DESIGN.md item 1; SPEC
 * §1.2-1.3). One versioned table of how long a hockey action takes. Physics,
 * brain and the period loop read it; nobody else hard-codes a duration.
 *
 * Rule: no action completes faster than its row. An action is a sim STATE (the
 * man is committed: he cannot start another until it runs out) and it is
 * written on every frame (`SkaterSnapshot.act` / `actT`), so the renderer can
 * time a clip to it and VT12 can check the floor on what was drawn.
 *
 * Contact is a PAIR: an actor and a receiver, each committed for his share.
 * A pair only happens when both bodies are within `contactFt` of each other
 * when it starts (hits already come from real body collisions; tie-ups and
 * battles are gated on it).
 *
 * Every number is "calibrate". Sources: NHL EDGE public shot-speed and skating
 * pages for the speeds the durations imply, and broadcast video timed by hand
 * for the wind-ups, releases, settles, falls and the goalie's recovery. The
 * shot wind-ups are the W2 values the engine was calibrated with (a longer
 * wind-up costs goals: 0.5 / 0.75 s took goals 2.94 → 2.28, see VAL_WINDUP's
 * history), so changing a row here is a calibration change: log it.
 */
import type { PassKind, ShotType } from '@domain'

/** Bump when a row changes: an old match input replays with the table that made it (SPEC §1.5). */
export const CONSTRAINTS_VERSION = 4

/**
 * W3 S6 (version 4): how the puck comes off what it hits. Plain contact
 * physics, one row per surface:
 *   - `eSlow` / `eFast`: the normal restitution (bounce) of a slow and of a hard
 *     impact. A frozen puck is viscoelastic: it bounces more off a soft knock
 *     than off a hard one, so e falls from eSlow to eFast as the speed INTO the
 *     surface rises past `vRef` ft/s (e = eFast + (eSlow - eFast)·exp(-vn/vRef)).
 *   - `mu`: tangential (Coulomb) friction. The along-the-surface speed loses
 *     mu × the normal impulse, so a glancing rim (small normal impulse) keeps
 *     its pace around a corner while a head-on dump dies.
 *   - `cap`: the most speed (ft/s) the puck keeps after the contact, relative
 *     to the surface (bodies and pads: it drops near the man).
 *
 * Calibrated by hand against public NHL broadcast video (timed frame by frame,
 * no other game's data): a hard wide shot straight into the end boards comes
 * back out to about the hash marks (~30-40 ft: e ≈ 0.18 at ~100 ft/s); a soft
 * dump against the boards stops within a stride or two; a rim from the point
 * around the end boards reaches the far half-wall in ~2-2.5 s, still at a pace
 * the winger has to handle (the corner keeps ~75% of it); a puck off the
 * glass drops at the base of the boards; a puck off the post rings out
 * lively; a puck into skates or shin pads drops at the man's feet. The
 * friction of the ice itself (PUCK_FRICTION in physics.ts) is unchanged.
 */
export interface PuckSurface {
  eSlow: number
  eFast: number
  vRef: number
  mu: number
  cap?: number
}
export const PUCK_SURFACE = {
  /** The boards at ice level (the kickplate) and up to the top of the dasher (3.5 ft). Lively. */
  boards: { eSlow: 0.5, eFast: 0.18, vRef: 40, mu: 0.12 },
  /** The glass above the boards (3.5-8 ft): flexes, deader; the puck drops. */
  glass: { eSlow: 0.3, eFast: 0.1, vRef: 30, mu: 0.3 },
  /** The posts and the crossbar (steel): rings out. */
  post: { eSlow: 0.65, eFast: 0.55, vRef: 60, mu: 0.08 },
  /** The back and sides of the cage (frame and mesh): a dull knock. */
  cage: { eSlow: 0.3, eFast: 0.15, vRef: 30, mu: 0.3 },
  /** Skates, shin pads, a body: the puck dies at his feet. */
  body: { eSlow: 0.15, eFast: 0.06, vRef: 20, mu: 0.5, cap: 9 },
  /** The goalie's pads (a loose puck sliding in, and a pad save's rebound). */
  pad: { eSlow: 0.28, eFast: 0.14, vRef: 60, mu: 0.4, cap: 34 },
  /** The blocker: deflects the save wide, livelier than a pad. */
  blocker: { eSlow: 0.32, eFast: 0.2, vRef: 60, mu: 0.3, cap: 40 },
  /** Chest and glove side that is not a catch: drops in front of him. */
  chest: { eSlow: 0.12, eFast: 0.05, vRef: 40, mu: 0.6, cap: 12 },
} as const satisfies Record<string, PuckSurface>
export type PuckSurfaceName = keyof typeof PUCK_SURFACE

/** Restitution of a surface for an impact `vn` ft/s into it. */
export function surfaceE(s: PuckSurface, vn: number): number {
  return s.eFast + (s.eSlow - s.eFast) * Math.exp(-Math.max(0, vn) / s.vRef)
}

/**
 * W3 S6: physically plausible puck speeds by action (ft/s), the puck-speed
 * sanity detector's caps. Shot: the hardest shots on the NHL EDGE public
 * shot-speed pages are ~105-110 mph (~155-161 ft/s). Pass / rim / dump / clear:
 * hand-timed broadcast stretch passes and hard rims run ~60-90 ft/s. A carried
 * puck moves with the man: his top speed (~35 ft/s) plus the blade working.
 * Nothing that is not a stick (a board, a body, the goalie) gives the puck
 * speed: it leaves a contact no faster than it came in.
 */
export const PUCK_SPEED = { shot: 161, pass: 95, carried: 55, gainFt: 3 } as const

export const ACTION_FLOOR = {
  shot: {
    /** Committed → release, with the puck on the blade (the set and the load). One-timers and tips are catch-and-release. */
    windup: { wrist: 0.25, snap: 0.25, backhand: 0.25, slap: 0.5, oneTimer: 0, tip: 0 } satisfies Record<ShotType, number>,
    /** A wind-up from distance (> farFt from the net) is a slapper's: the long row. */
    farFt: 45,
    /** After the release the shooter follows through: no new action. */
    followThrough: 0.2,
    /**
     * Release speed in tight: inside this many feet a shot is a quick jam or
     * tuck, not a full release - its speed scales down to `inTightMin` of a
     * full one at the crease (so the drawn puck travels to the pads on screen:
     * VT3 flight). A backhand leaves at `backhand` of a forehand (NHL EDGE
     * shot-speed pages: backhands well under wristers). Calibrate.
     * W3 S5 (version 3): the in-tight curve is a power inTightPow of the
     * distance (it was linear from 0.35): a jam from 5 ft left at ~46 ft/s and
     * crossed the last 2 ft to the goalie in under 3 drawn frames (VT3, reel S4
     * goalReplay); a tuck now leaves at ~30 ft/s, a 10-ft snap at ~43.
     */
    inTightFt: 25,
    inTightMin: 0.25,
    inTightPow: 2,
    backhand: 0.75,
  },
  pass: {
    /** The passer's release (the sweep of the blade) is drawn before the puck leaves; he is committed through it. */
    release: { tape: 0.15, saucer: 0.2, stretch: 0.2, dToD: 0.15, drop: 0.1, rim: 0.2, oneTimerFeed: 0.15 } satisfies Record<PassKind, number>,
    /** Receive and settle: the puck is on the blade but not his to use yet (one-timers exempt). */
    settle: { soft: 0.15, hard: 0.3 },
    /** A pass faster than this (ft/s) is a hard one to settle; good hands take some of it off. */
    hardFtS: 70,
  },
  stick: {
    /** A deke plays out over this window (brain.ts DEKE.minS / maxS). */
    deke: { min: 0.4, max: 0.7 },
    /** A poke check: the lunge, then the reload before the next real attempt. */
    poke: { commit: 0.25, recover: 1.4 },
    /** A man whose stick is lifted has lost the puck and gets his stick back after this. */
    stickLift: 0.3,
  },
  goalie: {
    /** After a save the goalie cannot move to a new spot until his reaction runs out (shot → save pair). */
    saveReaction: 0.3,
    /** A frozen puck: the cover, then the whistle. */
    freeze: 0.6,
  },
  faceoff: {
    /** Every skater set (stationary) on his spot before the linesman squares the centres up (VT7: 0.5 s). */
    setStill: 0.5,
    /** From set to the drop (the linesman holds it over the dot). */
    hold: [0.6, 1.2] as [number, number],
  },
  contact: {
    /** Centre to centre: a hit's two bodies at contact (VT11 draws them ≤ 4.5 ft). */
    hitFt: 4.5,
    /** A battle / tie-up: within stick and shoulder reach. */
    battleFt: 6,
    /** Body check: the hitter drives through, then picks his next job. */
    hitDoer: 0.4,
    /** Board pin: the pinning man holds for this long. */
    pinDoer: 0.6,
    /**
     * A body check that does not drop him: staggered, coasting with no edge,
     * at least this long (W3 S4, version 2: it was the force-scaled stun alone,
     * as short as 0.15 s, and a man stood up by a check skated straight back
     * into the hitter inside VT11's 0.4 s window).
     */
    stagger: 0.45,
    /** On the ice (the fall and the get-up) / pinned on the wall, at least this long. */
    knockdown: 1.8,
    pinned: 1.7,
    /** Tie-up on the wall / along the ice: both are actors, held at least this long before somebody wins it. */
    tieUp: 0.7,
    /**
     * W3 S4, the net-front box-out pair (both are actors): the defender on the
     * screener within `boxOutFt`, inside `boxOutNetFt` of the net, at most every
     * `boxOutEvery` s; both committed `boxOut` s; the loser of the shove is
     * moved `boxOutPush` ft/s off the spot (the screener off the shot line, or
     * the defender back onto his crease).
     */
    boxOut: 0.5,
    boxOutFt: 4,
    boxOutNetFt: 14,
    boxOutEvery: 2,
    boxOutPush: 5,
  },
} as const

/** Wind-up floor for a shot about to be taken from `distFt` (the shot type is set at the release). */
export function windupFloor(distFt: number): number {
  return distFt > ACTION_FLOOR.shot.farFt ? ACTION_FLOOR.shot.windup.slap : ACTION_FLOOR.shot.windup.wrist
}

/** Receive-and-settle for a pass arriving at `speedFtS`, by the receiver's hands (0..1). */
export function settleFloor(speedFtS: number, hands: number): number {
  const s = ACTION_FLOOR.pass.settle
  const hard = Math.min(1, Math.max(0, speedFtS / ACTION_FLOOR.pass.hardFtS))
  return s.soft + (s.hard - s.soft) * hard * (1.2 - 0.4 * Math.max(0, Math.min(1, hands)))
}

/**
 * The action vocabulary written on frames (`SkaterSnapshot.act`). Short names
 * the renderer's picker (W5) and VT12 key on.
 */
export type ActName =
  | 'windup' | 'release'            // shot: the set and load, the follow-through
  | 'pass' | 'receive'              // pass release, receive-and-settle
  | 'deke' | 'poke' | 'lifted'      // stickwork; 'lifted': his stick was lifted
  | 'hit' | 'stagger' | 'down' | 'pin' | 'pinned' // contact pairs
  | 'tieUp'                         // a wall / ice tie-up (both men)
  | 'boxOut' | 'boxedOut'           // the net-front box-out (W3 S4): won it (stick free) / lost it (stick tied up)
  | 'set'                           // faceoff: set on his spot
  | 'save'                          // goalie: the save reaction

/** The floor each act is held for at least (VT12): the minimum of its row. */
export const ACT_FLOOR: Record<ActName, number> = {
  windup: ACTION_FLOOR.shot.windup.wrist,
  release: ACTION_FLOOR.shot.followThrough,
  pass: ACTION_FLOOR.pass.release.drop,
  receive: ACTION_FLOOR.pass.settle.soft,
  deke: ACTION_FLOOR.stick.deke.min,
  poke: ACTION_FLOOR.stick.poke.commit,
  lifted: ACTION_FLOOR.stick.stickLift,
  hit: ACTION_FLOOR.contact.hitDoer,
  stagger: ACTION_FLOOR.contact.stagger,
  down: ACTION_FLOOR.contact.knockdown,
  pin: ACTION_FLOOR.contact.pinDoer,
  pinned: ACTION_FLOOR.contact.pinned,
  tieUp: ACTION_FLOOR.contact.tieUp,
  boxOut: ACTION_FLOOR.contact.boxOut,
  boxedOut: ACTION_FLOOR.contact.boxOut,
  set: ACTION_FLOOR.faceoff.setStill,
  save: ACTION_FLOOR.goalie.saveReaction,
}
