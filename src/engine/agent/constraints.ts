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
export const CONSTRAINTS_VERSION = 1

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
     */
    inTightFt: 25,
    inTightMin: 0.35,
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
    /** On the ice (the fall and the get-up) / pinned on the wall, at least this long. */
    knockdown: 1.8,
    pinned: 1.7,
    /** Tie-up on the wall / along the ice: both are actors, held at least this long before somebody wins it. */
    tieUp: 0.7,
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
  stagger: 0.15,
  down: ACTION_FLOOR.contact.knockdown,
  pin: ACTION_FLOOR.contact.pinDoer,
  pinned: ACTION_FLOOR.contact.pinned,
  tieUp: ACTION_FLOOR.contact.tieUp,
  set: ACTION_FLOOR.faceoff.setStill,
  save: ACTION_FLOOR.goalie.saveReaction,
}
