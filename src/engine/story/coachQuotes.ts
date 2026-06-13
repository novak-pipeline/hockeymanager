/**
 * Coach quote library — deterministic press-conference lines.
 *
 * coachQuote(coach, situation, facts, seed) returns a string that reads like
 * a real bench boss at the podium. Tone is governed by demeanor:
 *   fiery      — raw, confrontational, emotional
 *   calm       — measured, process-focused
 *   analytical — structured, evidence-driven
 *   motivator  — rallying, belief-forward
 *   pragmatic  — deflecting, expectation-managing
 *
 * All randomness flows through a stable hash of the seed + situation so the
 * same scenario always produces the same quote for the same coach.
 *
 * No side-effects, no wall-clock, no Math.random.
 */

import type { StaffMember } from '@engine/league/staff'

/* ─────────────────────────── public API ─────────────────────────── */

export type CoachSituation =
  | 'postBigWin'
  | 'postBadLoss'
  | 'winStreak'
  | 'losingStreak'
  | 'milestone'
  | 'signing'
  | 'tradeAdd'
  | 'slumpingStar'

export interface CoachQuoteFacts {
  /** Opponent abbreviation (for win/loss context). */
  opponentAbbr?: string
  /** Score line e.g. "4-1". */
  score?: string
  /** Name of the player who reached a milestone, signed, was traded in, or is slumping. */
  playerName?: string
  /** Current win/loss streak count (positive = wins, negative = losses). */
  streakCount?: number
  /** Goal differential for a big win or bad loss. */
  goalDiff?: number
}

/**
 * Return a deterministic coach press quote for the given situation.
 *
 * @param coach   - The head coach speaking (demeanor drives tone).
 * @param situation - Which event triggered the quote.
 * @param facts   - Optional factual context to fill placeholders.
 * @param seed    - Career-level seed; mixed with situation for line selection.
 */
export function coachQuote(
  coach: StaffMember,
  situation: CoachSituation,
  facts: CoachQuoteFacts,
  seed: number
): string {
  const demeanor = coach.demeanor ?? 'calm'
  const pool = QUOTE_POOL[situation][demeanor]
  const idx = stableIndex(seed, situation, pool.length)
  const template = pool[idx]!
  return fillTemplate(template, facts)
}

/* ─────────────────────────── template filler ─────────────────────────── */

/**
 * Simple template substitution. Tokens: {opp}, {score}, {player},
 * {streak}, {diff}, {rating} (a generic superlative adjective from seed).
 */
function fillTemplate(template: string, facts: CoachQuoteFacts): string {
  const opp = facts.opponentAbbr ?? 'them'
  const score = facts.score ?? 'the final'
  const player = facts.playerName ?? 'the player'
  const streak = facts.streakCount !== undefined ? Math.abs(facts.streakCount) : 0
  const diff = facts.goalDiff !== undefined ? Math.abs(facts.goalDiff) : 0

  return template
    .replace(/{opp}/g, opp)
    .replace(/{score}/g, score)
    .replace(/{player}/g, player)
    .replace(/{streak}/g, String(streak))
    .replace(/{diff}/g, String(diff))
}

/* ─────────────────────────── stable index ─────────────────────────── */

/** Hash seed + situation string into a stable index within [0, length). */
function stableIndex(seed: number, situation: string, length: number): number {
  let h = (seed >>> 0) ^ 0x45d9f3b
  for (let i = 0; i < situation.length; i++) {
    h = Math.imul(h ^ situation.charCodeAt(i), 0x9e3779b1)
    h = ((h << 13) | (h >>> 19)) >>> 0
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h % length
}

/* ─────────────────────────── quote pool ─────────────────────────── */

type DemeanorPool = Record<NonNullable<StaffMember['demeanor']>, string[]>

const QUOTE_POOL: Record<CoachSituation, DemeanorPool> = {

  /* ═══════════ postBigWin ═══════════ */
  postBigWin: {
    fiery: [
      "That's what we're capable of when we play with some fire. Every shift, every line — I don't want them to ever let up like that.",
      "We wanted a statement tonight and we got one. That's the standard. That's what I expect from this group every single night.",
      "{diff} goals — and it could've been more. We were ruthless. I want that edge to stay with us.",
      "We owed {opp} nothing and gave them nothing. That's the mentality we need to carry into every rink in this league.",
      "Nobody outworks us when we're locked in like that. I don't care who we play next — bring them on.",
    ],
    calm: [
      "A pleasing performance. We executed the game plan with real discipline and the results followed.",
      "We stayed composed through all three periods. That's a good sign for where this group is heading.",
      "I was pleased with the structure today. Both ends of the ice were organized and we made it difficult for {opp}.",
      "The {score} result was fair. We controlled large stretches, and when we needed to tighten up we did.",
      "Good hockey tonight. Everyone contributed. We'll review the tape and look to replicate the good things.",
    ],
    analytical: [
      "Our shot attempts at 5v5 were significantly above our season average — that's the underlying number I care about most.",
      "We generated from all four lines, which is what you need to sustain pressure in a game like this.",
      "The penalty kill was excellent — holding {opp} to zero on the power play was a decisive factor.",
      "Our zone exits were clean and our transition game created most of the danger. That's process producing results.",
      "I'll point to our neutral-zone play. We won a high percentage of those battles and it showed in our zone time.",
    ],
    motivator: [
      "I couldn't be prouder of how this group showed up tonight. That's what belief in each other looks like.",
      "Every line gave me something tonight. That's a team. That's what we're building here.",
      "When we play together and trust the system, we're a hard team to beat. Nights like this prove it.",
      "This group refused to let off the gas. That's character. That's heart. Carry it with you.",
      "Winning like that builds confidence. I want the guys to enjoy it tonight, because we've earned it.",
    ],
    pragmatic: [
      "We got the two points, which is all that matters. We'll move on and prepare for the next one.",
      "One game. We'll take it and focus on recovering well.",
      "{opp} had some dangerous sequences. We need to stay sharp — there are no easy nights in this league.",
      "The scoreboard looked good. The tape will tell me more. We can't lose our humility.",
      "Good result. The schedule doesn't give you time to dwell — we're back at it shortly.",
    ],
  },

  /* ═══════════ postBadLoss ═══════════ */
  postBadLoss: {
    fiery: [
      "That is not acceptable. Not the effort, not the compete level. {diff} goals — that's embarrassing.",
      "I told them in the room: that can't happen again. Period. No excuses. We play with pride or we don't play.",
      "I won't sugarcoat it. We were outworked, outcompeted, and out-everything. I'm furious and I should be.",
      "Some guys out there tonight need to look themselves in the mirror. Hard truths. That's my job to say it.",
      "We gave {opp} the game. Mistakes that had no business happening at this level. It ends now.",
    ],
    calm: [
      "A difficult night. We didn't execute the way we prepared to, but I'm not going to panic. We'll fix it.",
      "There are elements to address on both ends of the ice. We'll handle it with clear heads in the film session.",
      "We respect {opp} — they played well. We didn't match their level. That's an honest assessment.",
      "Not our best work. These nights happen. The key is how we respond in the next one.",
      "We'll regroup, watch the tape without emotion, and put together a better performance next time.",
    ],
    analytical: [
      "Our defensive-zone breakdowns in the second period cost us the game. That's clear on the tape.",
      "The underlying numbers weren't where they needed to be. We struggled to generate quality from the inside.",
      "Shot quality against was too high. Our coverage at the back post was inconsistent throughout.",
      "We turned the puck over in transition {diff} times more than our season average. Those margins matter.",
      "Structurally we were a step slow. I've already identified the areas to address before the next game.",
    ],
    motivator: [
      "I believe in this group. Tonight wasn't us at our best, but I've seen what this team is capable of.",
      "We're going to use this. Pain is a teacher. I want them hungry coming into the next practice.",
      "Nobody in that room should feel good about that result. Good. Use it. Channel it the right way.",
      "We've bounced back before and we will again. This group has the character — I've seen it.",
      "One game doesn't define us. How we respond defines us. I'll be watching closely.",
    ],
    pragmatic: [
      "We got beat tonight. {opp} was the better team. We regroup and move on.",
      "The margin is what it is. These games happen over a long season. We stay the course.",
      "Not much to say other than we need to be better. We will be.",
      "I'm not in the business of over-reacting. We'll look at the tape and correct the mistakes.",
      "We lost. We assess it, fix what we can, and get back to work. That's the job.",
    ],
  },

  /* ═══════════ winStreak ═══════════ */
  winStreak: {
    fiery: [
      "{streak} in a row. We're not stopping. I want more. This team is hungry and we're going to feed it.",
      "We've built some momentum and I don't want this group to let it slip. Stay aggressive. Stay relentless.",
      "Keep the foot on the gas. {streak} wins is a number. The next game is the only one that counts.",
      "The boys are playing with swagger right now and that's dangerous — in a good way. Keep feeding the wolf.",
      "We win because we compete harder. {streak} games of that. I'm not letting up on them.",
    ],
    calm: [
      "We're playing well. {streak} wins is a good stretch and the team deserves credit. We stay disciplined.",
      "Consistency has been the theme. We've stuck to our structure and it's paying off.",
      "A run like this builds habits. Good habits. We want to make this the expectation, not the exception.",
      "I'm pleased with the process. The results are following the work. That's how it should go.",
      "{streak} games now where we've executed the plan. The group is in a good place.",
    ],
    analytical: [
      "During this {streak}-game run our Corsi is among the best in the league. The underlying game is strong.",
      "We've held opponents below their expected goal output in each of those wins. Defensive structure is excellent.",
      "The power play has contributed in consecutive games — that's a big factor in the streak.",
      "Zone time has been exceptional. When we control the puck we win. Simple as that.",
      "Our defensive-zone coverage has been airtight. That consistency over {streak} games is encouraging.",
    ],
    motivator: [
      "{streak} wins and I genuinely believe the best hockey is still ahead of us. This group is growing.",
      "What a run by these guys. Every night someone steps up. That's the sign of a real team.",
      "I told them before the season: if they trust each other, they'll surprise people. They're doing it.",
      "The energy in the building, the energy in the room — it's real. This team believes. Keep going.",
      "Each win adds a brick to the wall we're building. {streak} bricks and we're just getting started.",
    ],
    pragmatic: [
      "We're winning games. That's the goal. We stay focused on the next one and don't overthink it.",
      "{streak} consecutive wins is a good number. We'll enjoy the standings position and keep working.",
      "The streak is a byproduct of preparation. We prepare the same way every game. That won't change.",
      "People want to talk about the streak. I just want to talk about the next game.",
      "Good stretch. Means nothing if we drop the next one. Full attention on preparation.",
    ],
  },

  /* ═══════════ losingStreak ═══════════ */
  losingStreak: {
    fiery: [
      "{streak} losses. I'm not accepting that. Changes are coming — in mindset, in compete, in everything.",
      "I called them out today. Straight to their faces. This ends now. I guarantee it ends now.",
      "We need some guys to stand up in that room. Enough analysis. We need some fire and we need it tonight.",
      "This is a crisis of compete, not a crisis of talent. I will not let this group quit on itself.",
      "I've been coaching long enough to know when a team needs a wake-up call. They got one today.",
    ],
    calm: [
      "{streak} losses is a difficult stretch, but I've been through these before. We address it methodically.",
      "We're not panicking. We identify the issues, we correct them in practice, and we execute better.",
      "The answers are on the tape. They always are. We focus on the controllables and we get back to work.",
      "This group has the capability to turn this around. I've seen it. We stay the course with adjustments.",
      "Adversity reveals character. I'm watching how this team responds and I'll have a better read on that.",
    ],
    analytical: [
      "Over this {streak}-game run our shot quality against has doubled. We need to close passing lanes faster.",
      "We're giving up too many grade-A chances from the slot. The system breakdown is specific and fixable.",
      "I've mapped out the sequence failures. Our transition defense has been the root cause. We address it today.",
      "The data is clear: we're getting outworked on puck battles in the defensive zone. That's a culture fix.",
      "Our 5v5 possession numbers have dropped sharply. We're spending too much time in our own end.",
    ],
    motivator: [
      "{streak} losses doesn't change what I know about this group. We've got the people. We get back up.",
      "I've seen this team at its best and I know what it can do. Rough patch. We come out of it together.",
      "Every one of us in that room owns a piece of this. And every one of us will fix it together.",
      "I genuinely believe in these players. That's not a line — it's why I'm not throwing them under the bus.",
      "Winning streaks end. Losing streaks end. Our job is to end this one with the next game.",
    ],
    pragmatic: [
      "{streak} in a row is not ideal. We make adjustments and put it behind us. That's the job.",
      "We haven't played well. I won't deny it. We also won't catastrophize. We fix it and move on.",
      "Every team goes through stretches like this. How you respond is what separates organizations.",
      "I've identified the tactical areas to address. We make those corrections and get back to winning hockey.",
      "We're still very much in the picture. {streak} losses isn't a death sentence. It's a challenge.",
    ],
  },

  /* ═══════════ milestone ═══════════ */
  milestone: {
    fiery: [
      "{player} has earned every bit of this. Hard-nosed, never quits, plays the right way. Proud of him.",
      "Milestones like this don't happen by accident. {player} puts in the work that nobody sees.",
      "{player} is one of the best in this league at what he does. This milestone just makes it official.",
      "I've coached some great players. {player} is right up there in terms of compete and professionalism.",
      "That number means {player} has been doing it the right way for a long time. Couldn't be happier for him.",
    ],
    calm: [
      "{player} is a fine player who has handled this season with real maturity. A well-deserved recognition.",
      "A milestone worth celebrating. {player} has been consistent and reliable throughout.",
      "I'm pleased for {player}. It reflects sustained quality over a long period.",
      "Well earned. {player} has contributed in many ways this season and this moment reflects that.",
      "{player} does things the right way. Milestones like this are a natural outcome of that approach.",
    ],
    analytical: [
      "{player} has been exceptional at the details — zone exits, positioning, board battles. The numbers reflect it.",
      "What stands out about {player}'s game is how little he gives away at the other end. That's elite awareness.",
      "When you look at {player}'s underlying numbers over this stretch, the milestone is no surprise.",
      "{player}'s possession metrics have been consistently strong. The points follow from that foundation.",
      "The data backs up what we see every night: {player} is one of the most productive players in the league.",
    ],
    motivator: [
      "{player} is an inspiration to everyone in that room. This milestone is for him and for the whole team.",
      "I told the group today: this is what happens when you dedicate yourself the way {player} has.",
      "Moments like this remind you why the game is beautiful. {player} has worked so hard for this.",
      "When a teammate achieves something like this, it lifts everyone. {player} makes us all better.",
      "I couldn't be prouder of {player}. The whole organisation is celebrating with him tonight.",
    ],
    pragmatic: [
      "Well earned by {player}. He's had a solid season and this is a fair reflection of that.",
      "Good for {player}. He'll move on and keep working — that's who he is.",
      "A nice milestone. We acknowledge it, but the schedule doesn't slow down. {player} knows that.",
      "{player} has been a quality contributor. The milestone is deserved and we move on from here.",
      "Pleased for {player}. These moments are important. Now we focus on the next game.",
    ],
  },

  /* ═══════════ signing ═══════════ */
  signing: {
    fiery: [
      "{player} is a warrior. We wanted him in this room and we got him. He's going to make us harder to beat.",
      "I pushed hard for {player}. He competes, he battles, he'll fit right in with how we play.",
      "Signing {player} sends a message. We're not satisfied with where we are. We're pushing for more.",
      "{player} has the mindset I want in this locker room. Physical, accountable, never takes a night off.",
      "We added a player who will make life miserable for the opposition. That's exactly what I asked for.",
    ],
    calm: [
      "{player} brings real experience and professionalism. He understands his role and he'll contribute.",
      "We're pleased to add {player} to the group. He brings qualities that complement what we already have.",
      "{player} fits our system well. He's a reliable player and we're looking forward to integrating him.",
      "A thoughtful addition. {player} gives us depth and options in a position where we needed it.",
      "We did our due diligence and {player} was the right fit. I'm confident he'll settle in quickly.",
    ],
    analytical: [
      "{player}'s underlying numbers translate well to our system. His possession and transition metrics are exactly what we needed.",
      "We identified {player} through our process. His defensive deployment numbers are elite and that was the priority.",
      "{player} excels in the areas our model flagged. Off-the-rush offense and defensive-zone coverage stand out.",
      "The analytics supported the decision. {player} brings measurable value in zone exit and entry percentages.",
      "We looked at {player} for some time. His shot suppression numbers are among the best at his position.",
    ],
    motivator: [
      "Having {player} in the room is going to energize this group. He's a proven winner and that matters.",
      "{player} believes in what we're building here. That's why he's here. That means everything.",
      "Adding {player} tells the locker room we're serious. Management backed us and the players see that.",
      "{player} is the kind of person who makes teams better just by being there. We're excited to have him.",
      "This is a statement that we're not standing still. {player} raises everyone's level around him.",
    ],
    pragmatic: [
      "{player} fills a specific need in our roster. We assessed the market and he was the best available fit.",
      "Solid addition. {player} knows his role and will deliver on it. That's what we needed.",
      "The signing makes sense from a depth perspective. {player} gives the coaching staff more options.",
      "We identified a need, we found the right player in {player}, we moved. Simple process.",
      "{player} adds a capable piece. We don't need him to be the saviour — just to do his job. He will.",
    ],
  },

  /* ═══════════ tradeAdd ═══════════ */
  tradeAdd: {
    fiery: [
      "{player} is coming here to compete and to win. We don't make moves like this to play it safe.",
      "I demanded a player who can go to the hard areas. Management delivered with {player}. Now we perform.",
      "When {player} is in the lineup every opponent knows about it. That changes how games are played.",
      "We acquired {player} because we want to win now. No apologies for that mindset. Let's go.",
      "This trade tells everyone in this room that the organization wants to win. {player} makes us better immediately.",
    ],
    calm: [
      "{player} adds valuable versatility. He's a measured, reliable professional and we're glad to have him.",
      "The addition of {player} improves our depth without disrupting what's already working.",
      "We've tracked {player} for some time. He fits the style we want to play and he knows how to win.",
      "A calculated move. {player} gives us quality at a position we identified as a need.",
      "We feel good about adding {player}. He'll integrate well and contribute in a number of ways.",
    ],
    analytical: [
      "{player}'s shot suppression numbers are excellent — that's what drove the decision from a coaching perspective.",
      "We acquired {player} specifically for his deployment flexibility. He can play multiple situations for us.",
      "The data on {player} was compelling. His zone exits under pressure and his defensive-zone structure are top-tier.",
      "{player} adds shot volume from the point — an area our models identified as an opportunity for improvement.",
      "We looked at {player}'s adjusted scoring rates in his previous role. The translation should be positive.",
    ],
    motivator: [
      "Adding {player} at this stage sends a signal: we believe in this room and we're going all in.",
      "{player} is a winner. Having that DNA in our locker room elevates everyone around him.",
      "The guys are energized. {player} is a high-character player who makes everything around him better.",
      "This is an exciting addition. {player} brings experience and winning habits. We're fired up.",
      "{player} wanted to come here. He chose this group. That says something and I hope the team feels that.",
    ],
    pragmatic: [
      "{player} addresses a gap in our roster. Straightforward move — we needed it and we made it.",
      "We gave up fair value and we got fair value. {player} makes us more competitive. That's the goal.",
      "Trades at this stage are about solving problems. {player} solves one for us. We move forward.",
      "He knows the role, he's played the role, and he'll do it here. Clear-eyed on what we're adding.",
      "A professional acquisition. {player} comes with the right experience and the right mindset for what we need.",
    ],
  },

  /* ═══════════ slumpingStar ═══════════ */
  slumpingStar: {
    fiery: [
      "I've spoken to {player} directly. He knows my expectations. That conversation is done and it's time to perform.",
      "{player} is too good to be going through a drought this long. I'm pushing him harder and he knows it.",
      "A player of {player}'s caliber shouldn't accept this stretch. I've told him that. The rest is on him.",
      "We all see it. {player} sees it. We need him back. The pushback stops and the production has to start.",
      "I've challenged {player} publicly — in the room first, now here. He has to answer on the ice.",
    ],
    calm: [
      "{player} is a proven player and I have complete confidence this will turn around. We're patient.",
      "Every elite player goes through stretches like this. We're managing {player}'s ice time carefully.",
      "I'm not concerned in the long run. {player} is working on it, I can see it in practice. It'll come.",
      "We've discussed it quietly. {player} is his own harshest critic and that's actually a good sign.",
      "Slumps are part of hockey. {player} understands that and he's handling it with professionalism.",
    ],
    analytical: [
      "{player}'s shot volume has stayed consistent — the goals will come. This is a variance issue, not a skill issue.",
      "The underlying numbers for {player} are still strong. Puck luck has been against him. We expect regression.",
      "We've looked at {player}'s chances during this stretch — the quality is there, the finishing isn't. Temporary.",
      "{player}'s ice time and usage aren't the issue. His zone-entry success rate is actually up. Trust the process.",
      "I track this closely. {player} is generating at his normal rate. The puck isn't going in right now. It will.",
    ],
    motivator: [
      "{player} is a cornerstone of this team and we're in this with him completely. He has our full support.",
      "I told {player}: slumps don't last but character does. This moment will make him stronger.",
      "Every player on this team knows {player} works harder than anybody. The belief in him has not wavered.",
      "We lift {player} up, not tear him down. That's this locker room. That's why he'll come out of it.",
      "{player} is too mentally tough to stay down for long. I've seen this before with elite players. Watch this space.",
    ],
    pragmatic: [
      "We've managed through slumps before. {player} is a quality player — we adjust his deployment and wait.",
      "The drought is real but {player} has earned the right to work through it. We give him that space.",
      "I'll protect {player} publicly. Privately we're working on it. That's how it should be handled.",
      "These things resolve themselves with a quality player. {player} is a quality player. We stay the course.",
      "{player}'s value isn't only in points. He's still contributing in ways that don't show in the box score.",
    ],
  },
}
