/**
 * CLUB SCENES — the roleplay beats of running a whole organisation.
 *
 * Playtest 2026-08-26 §E1. The GM's year has moments that have nothing to do
 * with tonight's lineup: the call you make to a kid an hour after you draft
 * him, the first conversation with a player you just acquired, the decision
 * whether to fly out for your affiliate's playoff run the way Kyle Dubas does.
 * They were all missing.
 *
 * These reuse the decision-event model exactly — a character-driven situation,
 * options with real tradeoffs, effects that map to levers the engine already
 * has — but they are raised BY NAME at a specific moment rather than scanned
 * for. That is the only difference, and it is why they live in their own pool:
 * a scanned event needs conditions the runner populates; a summoned one does
 * not, and pretending otherwise would put dead conditions in the library.
 *
 * Pure data. The career layer summons them and applies the effects.
 */

import type { DecisionEvent } from './decisionEvents'

/* ────────────────────────── post-draft calls ────────────────────────── */

/**
 * The call to your first pick, made from the draft floor. What you say here is
 * a real commitment: promise him a look and the room will check whether he gets
 * one; tell him he is going back to junior and you have bought yourself a year
 * of patience at the cost of his.
 *
 * Slots: {name} {last} {age} {team} {pick}.
 */
export const DRAFT_CALL_EVENTS: DecisionEvent[] = [
  {
    id: 'ev.draft.first-pick-call',
    speaker: 'player',
    scene:
      `An hour after the pick, someone hands you a phone. {last} is still in the building somewhere, ` +
      `still wearing the sweater, and he has clearly been told to sound composed. ` +
      `"Thank you. Genuinely. I just — what do you want from me? Tell me what the year looks like and I'll go do it."`,
    options: [
      {
        id: 'camp-shot',
        label: `"Come to camp and take a job off somebody."`,
        effects: { morale: 12, promise: 'iceTime', roomRespect: -2 },
        outcome:
          `You told an eighteen-year-old he can win an NHL job in September. He believed you, which means ` +
          `camp is now a promise with his name on it, and every veteran on the bubble just got a rival.`,
      },
      {
        id: 'go-back',
        label: `"Go back to junior. Dominate it. We'll be watching."`,
        effects: { morale: -4, roomRespect: 4 },
        outcome:
          `Honest, unglamorous, and the right answer more often than not. He heard "not yet", and the next ` +
          `time you call him he will want a reason that is better than the last one.`,
      },
      {
        id: 'no-promises',
        label: `"I don't make promises to players I've never coached."`,
        effects: { morale: -10, roomRespect: 8, residue: 'wasDismissed' },
        outcome:
          `A cold thing to say to a kid on the best day of his life, and a policy the whole room will hear about ` +
          `by Tuesday. Nobody in your organisation will ever accuse you of selling something you can't deliver.`,
      },
    ],
  },
  {
    id: 'ev.draft.slid-to-us-call',
    speaker: 'player',
    scene:
      `{last} went later than anyone had him, and by the time you called his name the cameras had stopped ` +
      `pointing at him. On the phone he is not composed at all. ` +
      `"Everyone had a reason. Nobody told me the reason. Do you know what it is?"`,
    options: [
      {
        id: 'tell-him',
        label: `Tell him exactly what the reports said`,
        effects: { morale: -8, roomRespect: 7, promise: 'iceTime' },
        outcome:
          `You read him his own scouting file. It was not kind and it was not wrong, and he now knows precisely ` +
          `what he has to disprove — to you, in writing, this season.`,
      },
      {
        id: 'chip',
        label: `"I don't care what it was. Play like it still bothers you."`,
        effects: { morale: 10, roomMorale: 2, roomRespect: -3, leakChance: 0.25 },
        outcome:
          `He will carry it. Your development staff would rather you had coached him than motivated him, and a ` +
          `general manager telling a teenager to play angry is the kind of line that gets repeated.`,
      },
      {
        id: 'brush-off',
        label: `"Don't worry about it. Get some sleep."`,
        effects: { morale: -3, roomRespect: -4, residue: 'wasDismissed' },
        outcome:
          `You had one moment to say something that mattered to him and you filled it with nothing. ` +
          `He will remember the length of the call more than the words.`,
      },
    ],
  },
]

/* ────────────────────────── the arrival meeting ────────────────────────── */

/**
 * The first meeting with a player you have just acquired. He wants to know what
 * he is here to do — and the honest version of this conversation is one you can
 * also have BEFORE you sign him, at the negotiation table (see roleTalk.ts).
 *
 * Slots: {name} {last} {age} {team} {via}.
 */
export const ARRIVAL_EVENTS: DecisionEvent[] = [
  {
    id: 'ev.arrival.role-and-wants',
    speaker: 'player',
    scene:
      `{last} came in the morning after the paperwork cleared, still living out of a hotel. ` +
      `"I've been somewhere I was a fourth option and somewhere I was the guy, and the second one was easier ` +
      `even when it was harder. So — which am I here? Say it plainly and I'll be fine with either."`,
    options: [
      {
        id: 'top-role',
        label: `"You're a top-six player here. I'll deploy you like one."`,
        effects: { morale: 12, promise: 'iceTime', roomRespect: -3 },
        outcome:
          `He relaxed for the first time since the trade call. That sentence is now a commitment the lineup card ` +
          `has to honour, and the men currently in those minutes did not get a vote.`,
      },
      {
        id: 'earn-it',
        label: `"You're here to compete for it. Nothing is handed out."`,
        effects: { morale: -2, roomRespect: 6 },
        outcome:
          `Unromantic and defensible. He knows the terms, the room hears that nobody arrives with minutes ` +
          `pre-paid, and if he wins the job nobody can call it a gift.`,
      },
      {
        id: 'specific-job',
        label: `Give him a specific job — kill penalties, play hard minutes`,
        effects: { morale: 6, roomRespect: 4, roomMorale: -3, promise: 'iceTime' },
        outcome:
          `A defined role is worth more to some players than a bigger vague one. He left knowing exactly what ` +
          `"a good night" means here — and so did the man who has been doing that job all season.`,
      },
    ],
  },
]

/* ────────────────────────── the affiliate's run ────────────────────────── */

/**
 * The Dubas beat: your farm club is deep in its own playoffs, and you can be in
 * the building or you can be at your desk. Neither is free.
 *
 * Slots: {team} {ahl} {round} {name} {last}.
 */
export const FARM_TRIP_EVENTS: DecisionEvent[] = [
  {
    id: 'ev.farm.playoff-trip',
    speaker: 'agent',
    scene:
      `Your director of player development called about the {ahl}. They are through to {round}, and the group ` +
      `down there is largely the group you are counting on in three years. ` +
      `"You should be here. Not for them — for you. You cannot draft your way out of not knowing your own players."`,
    options: [
      {
        id: 'go',
        label: `Go. Watch the run in person.`,
        effects: { roomRespect: 3, promise: 'iceTime' },
        outcome:
          `You spent the week in a half-full building watching nineteen-year-olds play the biggest games of their ` +
          `lives. You now have opinions about them that no report could have given you — and the ones who ` +
          `played well know you saw it.`,
      },
      {
        id: 'send-agm',
        label: `Send the AGM and read the reports`,
        effects: { roomRespect: -1 },
        outcome:
          `The sensible allocation of a general manager's week. The reports were good. They are still reports.`,
      },
      {
        id: 'stay',
        label: `Stay at your desk. The NHL club is the job.`,
        effects: { roomRespect: -4, residue: 'wasDismissed' },
        outcome:
          `Defensible, and the development staff have now learned exactly where the farm sits on your list. ` +
          `They will keep telling you about these players. You will keep hearing it secondhand.`,
      },
    ],
  },
]

/** Every summoned scene, for lookup by id when a response comes back. */
export const CLUB_SCENES: DecisionEvent[] = [
  ...DRAFT_CALL_EVENTS,
  ...ARRIVAL_EVENTS,
  ...FARM_TRIP_EVENTS,
]
