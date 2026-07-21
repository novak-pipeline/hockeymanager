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
import { markUsed, type ContentUse } from '@engine/story/contentEngine'

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
  seed: number,
  /** Content-engine no-repeat ledger: with it, a line used this season is
   *  skipped (rotating through the pool before any repeat — EXCELLENCE.md
   *  B4.5). Without it, behaviour is the original pure hash pick. */
  noRepeat?: { ledger: ContentUse[]; year: number; day: number }
): string {
  const demeanor = coach.demeanor ?? 'calm'
  const pool = QUOTE_POOL[situation][demeanor]
  const idx = stableIndex(seed, situation, pool.length)
  if (!noRepeat) return fillTemplate(pool[idx]!, facts)
  // Walk forward from the hash pick to the first line unused this season; if
  // the coach has said all five, the hash pick repeats (LRU-ish via rotation).
  const usedThisSeason = new Set(
    noRepeat.ledger.filter((u) => u.year === noRepeat.year).map((u) => u.variantId)
  )
  let chosen = idx
  for (let step = 0; step < pool.length; step++) {
    const cand = (idx + step) % pool.length
    if (!usedThisSeason.has(quoteVariantId(situation, demeanor, cand))) {
      chosen = cand
      break
    }
  }
  markUsed(noRepeat.ledger, quoteVariantId(situation, demeanor, chosen), noRepeat.year, noRepeat.day)
  return fillTemplate(pool[chosen]!, facts)
}

/** Stable ledger key for one authored line. */
function quoteVariantId(situation: CoachSituation, demeanor: string, idx: number): string {
  return `coach.${situation}.${demeanor}.${idx}`
}

/**
 * Inbox HEADLINE for a coach-quote item — pooled and no-repeat-rotated like
 * the body, because the headline is what the GM actually scans: one line per
 * demeanor meant every big win read identically all season.
 */
export function coachHeadline(
  coach: StaffMember,
  situation: CoachSituation,
  facts: CoachQuoteFacts,
  seed: number,
  noRepeat?: { ledger: ContentUse[]; year: number; day: number }
): string {
  const demeanor = coach.demeanor ?? 'calm'
  const bySituation = HEADLINE_POOL[situation]
  const pool = Array.isArray(bySituation) ? bySituation : bySituation[demeanor]
  const key = Array.isArray(bySituation) ? 'any' : demeanor
  const idx = stableIndex(seed ^ 0x51ed, situation, pool.length)
  if (!noRepeat) return fillTemplate(pool[idx]!, facts)
  const usedThisSeason = new Set(
    noRepeat.ledger.filter((u) => u.year === noRepeat.year).map((u) => u.variantId)
  )
  let chosen = idx
  for (let step = 0; step < pool.length; step++) {
    const cand = (idx + step) % pool.length
    if (!usedThisSeason.has(`hl.${situation}.${key}.${cand}`)) {
      chosen = cand
      break
    }
  }
  markUsed(noRepeat.ledger, `hl.${situation}.${key}.${chosen}`, noRepeat.year, noRepeat.day)
  return fillTemplate(pool[chosen]!, facts)
}

/** Demeanor-keyed for the podium reactions; situation-flat for streak beats. */
const HEADLINE_POOL: Record<CoachSituation, DemeanorPool | string[]> = {
  postBigWin: {
    fiery: [
      `{opp} routed: "We were ruthless" — Coach after {diff}-goal win`,
      `Statement made against {opp} — Coach postgame`,
      `"That's the standard" — Coach after {diff}-goal rout`,
    ],
    calm: [
      `"A pleasing performance" — Coach on the {opp} win`,
      `Composed and clinical — Coach postgame`,
      `"The plan, executed" — Coach after beating {opp}`,
    ],
    analytical: [
      `"The underlying numbers were excellent" — Coach postgame`,
      `Process meets result: Coach on the {diff}-goal win`,
      `"All four lines generated" — Coach postgame`,
    ],
    motivator: [
      `"Proud of the group" — Coach postgame`,
      `"That's what belief looks like" — Coach after the {opp} win`,
      `"Everyone gave me something" — Coach postgame`,
    ],
    pragmatic: [
      `"Two points is all that matters" — Coach postgame`,
      `Good night, next game — Coach after {opp}`,
      `"We can't lose our humility" — Coach postgame`,
    ],
  },
  postBadLoss: {
    fiery: [
      `"Not acceptable" — Coach after {diff}-goal loss`,
      `Hard truths in the room — Coach after {opp} defeat`,
      `"It ends now" — Coach fumes postgame`,
    ],
    calm: [
      `"We'll fix it" — Coach postgame`,
      `A difficult night, clear heads — Coach on the {opp} loss`,
      `"We didn't match their level" — Coach's honest read`,
    ],
    analytical: [
      `"Structural issues to address" — Coach postgame`,
      `"The tape will not be kind" — Coach after {opp}`,
      `Breakdowns cost us — Coach postgame`,
    ],
    motivator: [
      `"We'll respond" — Coach postgame`,
      `"Pain is a teacher" — Coach after the {opp} loss`,
      `"This group will answer" — Coach postgame`,
    ],
    pragmatic: [
      `"We assess and move on" — Coach postgame`,
      `Beaten tonight, back tomorrow — Coach`,
      `"No catastrophe, just corrections" — Coach postgame`,
    ],
  },
  winStreak: [
    `{streak}-game win streak — Coach speaks`,
    `Streak hits {streak}: "Nobody here is satisfied" — Coach`,
    `{streak} straight — Coach credits the process`,
    `Rolling: Coach on the {streak}-game heater`,
  ],
  losingStreak: [
    `{streak} in a row — Coach addresses the slump`,
    `Coach faces the slide head-on`,
    `{streak} straight losses: "The answers are on the tape" — Coach`,
    `A team searching: Coach on the skid`,
  ],
  slumpingStar: [
    `{player} slump ({streak} games) — Coach speaks`,
    `Coach backs {player} through the drought`,
    `{streak} games without: Coach on {player}'s dry spell`,
  ],
  milestone: [
    `Coach on {player}'s milestone night`,
    `"{player} earned every bit of it" — Coach`,
    `A number worth stopping for: Coach salutes {player}`,
  ],
  signing: [
    `Coach welcomes {player}`,
    `"Exactly what we asked for" — Coach on the {player} signing`,
    `New face, clear role: Coach on adding {player}`,
  ],
  tradeAdd: [
    `Coach on the {player} acquisition`,
    `"He makes us harder to play against" — Coach on {player}`,
    `The bench boss got his wish: Coach on landing {player}`,
  ],
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
      "You saw the first shift — we hit everything that moved and the game bent to us from there. That's not luck. That's intent.",
      "I've been asking for sixty minutes of teeth. Tonight I got sixty-two, because the boys didn't stop when it was decided. Love it.",
      "{opp} wanted a track meet and we made it an alley. You pick the fight you can win. We picked right.",
    ],
    calm: [
      "A pleasing performance. We executed the game plan with real discipline and the results followed.",
      "We stayed composed through all three periods. That's a good sign for where this group is heading.",
      "I was pleased with the structure today. Both ends of the ice were organized and we made it difficult for {opp}.",
      "The {score} result was fair. We controlled large stretches, and when we needed to tighten up we did.",
      "Good hockey tonight. Everyone contributed. We'll review the tape and look to replicate the good things.",
      "I liked our patience most of all. We didn't force anything, and when {opp} cracked we were positioned to take everything they gave us.",
      "Wins like this are quiet wins — no drama, no heroics, just details done properly for sixty minutes. Those travel well.",
      "We asked the fourth line to set a tone and they did. When your depth leads, nights like this follow.",
    ],
    analytical: [
      "Our shot attempts at 5v5 were significantly above our season average — that's the underlying number I care about most.",
      "We generated from all four lines, which is what you need to sustain pressure in a game like this.",
      "The penalty kill was excellent — holding {opp} to zero on the power play was a decisive factor.",
      "Our zone exits were clean and our transition game created most of the danger. That's process producing results.",
      "I'll point to our neutral-zone play. We won a high percentage of those battles and it showed in our zone time.",
      "Look at the shot map: everything from the slot, almost nothing conceded from the middle. When the game is played in the right places, the score takes care of itself.",
      "We denied {opp}'s controlled entries all night and forced them to dump. Take away the blue line and you take away their offense — that was the whole plan.",
      "Faceoffs, forecheck retrievals, second touches — we won the small-number battles, and the big number followed. That's how this works.",
    ],
    motivator: [
      "I couldn't be prouder of how this group showed up tonight. That's what belief in each other looks like.",
      "Every line gave me something tonight. That's a team. That's what we're building here.",
      "When we play together and trust the system, we're a hard team to beat. Nights like this prove it.",
      "This group refused to let off the gas. That's character. That's heart. Carry it with you.",
      "Winning like that builds confidence. I want the guys to enjoy it tonight, because we've earned it.",
      "The bench was the best part. Every goal, twenty guys on their feet for each other. You can't coach that in — but you can build a room where it grows.",
      "Somebody asked me if this was a statement. It's better than a statement — it's evidence. This group is becoming what it believes it is.",
      "Nights like tonight are why you play. I told them: remember this feeling, bottle it, and bring it to the next building.",
    ],
    pragmatic: [
      "We got the two points, which is all that matters. We'll move on and prepare for the next one.",
      "One game. We'll take it and focus on recovering well.",
      "{opp} had some dangerous sequences. We need to stay sharp — there are no easy nights in this league.",
      "The scoreboard looked good. The tape will tell me more. We can't lose our humility.",
      "Good result. The schedule doesn't give you time to dwell — we're back at it shortly.",
      "Big margin, sure. I promise you {opp} will be a different animal next time — file the win and forget the score.",
      "We executed, they didn't, and the league table gives the same two points either way. On to recovery.",
      "I'd rather win ugly than lose pretty, and tonight we happened to do both halves of the winning part. Moving on.",
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
      "Don't ask me about systems. Systems didn't lose that game — battles did. We lost the wall, we lost the net-front, we lost the fifty-fifties. All of it.",
      "The first ten minutes told you everything. They were ready and we were still stretching. That's on the room, and I let the room hear it.",
      "I don't do moral victories and I don't do 'we'll flush it.' You don't flush {diff} goals. You wear it until you fix it.",
    ],
    calm: [
      "A difficult night. We didn't execute the way we prepared to, but I'm not going to panic. We'll fix it.",
      "There are elements to address on both ends of the ice. We'll handle it with clear heads in the film session.",
      "We respect {opp} — they played well. We didn't match their level. That's an honest assessment.",
      "Not our best work. These nights happen. The key is how we respond in the next one.",
      "We'll regroup, watch the tape without emotion, and put together a better performance next time.",
      "I'm going to resist the urge to say much tonight. The players know. Sometimes the quietest room is the one that learned the most.",
      "There's a version of this press conference where I throw people under the bus. You won't get it. We win as a group and we lose as one.",
      "The margin flatters {opp} a little — but only a little. We earned most of what happened to us tonight.",
    ],
    analytical: [
      "Our defensive-zone breakdowns in the second period cost us the game. That's clear on the tape.",
      "The underlying numbers weren't where they needed to be. We struggled to generate quality from the inside.",
      "Shot quality against was too high. Our coverage at the back post was inconsistent throughout.",
      "We turned the puck over in transition {diff} times more than our season average. Those margins matter.",
      "Structurally we were a step slow. I've already identified the areas to address before the next game.",
      "Strip out the empty-netter and the story is still the same: they generated from the middle, we generated from the perimeter. That gap IS the score.",
      "Our forecheck retrieval rate fell off a cliff in the second period, and every goal against traces back to it. One fixable number.",
      "I'm less worried than the scoreline suggests. The expected-goals gap was narrow — but 'close on paper' doesn't pay the bills, so we correct it anyway.",
    ],
    motivator: [
      "I believe in this group. Tonight wasn't us at our best, but I've seen what this team is capable of.",
      "We're going to use this. Pain is a teacher. I want them hungry coming into the next practice.",
      "Nobody in that room should feel good about that result. Good. Use it. Channel it the right way.",
      "We've bounced back before and we will again. This group has the character — I've seen it.",
      "One game doesn't define us. How we respond defines us. I'll be watching closely.",
      "I looked around that room after the horn and I didn't see quit — I saw anger. Good. Anger is fuel if you point it the right way.",
      "Every team I've ever loved got embarrassed once on the way to becoming itself. Tonight was our once. Watch what we do with it.",
      "I'll take the blame for this one publicly, and privately the room knows the standard. That's the deal between us — and it works.",
    ],
    pragmatic: [
      "We got beat tonight. {opp} was the better team. We regroup and move on.",
      "The margin is what it is. These games happen over a long season. We stay the course.",
      "Not much to say other than we need to be better. We will be.",
      "I'm not in the business of over-reacting. We'll look at the tape and correct the mistakes.",
      "We lost. We assess it, fix what we can, and get back to work. That's the job.",
      "Eighty-two of these. You're going to take a few beatings. The teams that go anywhere are the ones that keep the beatings boring — correct, don't combust.",
      "{opp} played a good game and we played a bad one. It happens roughly ten times a season to everyone. The trick is not letting one become three.",
      "No speeches tonight. Video at ten tomorrow, practice at eleven, and the schedule gives us a chance to fix the taste in our mouths within the week.",
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
      "Everybody's asking when it ends. Wrong question. Ask the other twenty-nine teams how they plan to end it — because we sure won't.",
      "You know what I told them this morning? Great. Now win tonight. That's the whole speech. Streaks die from admiring themselves.",
      "I've seen hot runs turn soft when guys start protecting them. Not here. We play every night like we're the ones chasing.",
    ],
    calm: [
      "We're playing well. {streak} wins is a good stretch and the team deserves credit. We stay disciplined.",
      "Consistency has been the theme. We've stuck to our structure and it's paying off.",
      "A run like this builds habits. Good habits. We want to make this the expectation, not the exception.",
      "I'm pleased with the process. The results are following the work. That's how it should go.",
      "{streak} games now where we've executed the plan. The group is in a good place.",
      "The mark of this run isn't the wins — it's that the game plan has barely changed. We're not riding luck. We're repeating ourselves, deliberately.",
      "I keep the same message on night {streak} as on night one: play our structure, respect the opponent, let the table sort itself out.",
      "People use the word 'streak' like it's magic. It's not. It's rest, preparation, and players buying what we're selling. All renewable resources.",
    ],
    analytical: [
      "During this {streak}-game run our Corsi is among the best in the league. The underlying game is strong.",
      "We've held opponents below their expected goal output in each of those wins. Defensive structure is excellent.",
      "The power play has contributed in consecutive games — that's a big factor in the streak.",
      "Zone time has been exceptional. When we control the puck we win. Simple as that.",
      "Our defensive-zone coverage has been airtight. That consistency over {streak} games is encouraging.",
      "Here's the number I watch: high-danger chances against, down 30% across the run. The wins are the shadow — that number is the object.",
      "Sustainability is the only question worth asking about a streak, and our shooting percentage is NOT inflated. This is real.",
      "Every one of the {streak} wins had a different top line on the score sheet. Distributed offense doesn't slump all at once — that's the moat.",
    ],
    motivator: [
      "{streak} wins and I genuinely believe the best hockey is still ahead of us. This group is growing.",
      "What a run by these guys. Every night someone steps up. That's the sign of a real team.",
      "I told them before the season: if they trust each other, they'll surprise people. They're doing it.",
      "The energy in the building, the energy in the room — it's real. This team believes. Keep going.",
      "Each win adds a brick to the wall we're building. {streak} bricks and we're just getting started.",
      "You know what I love most? The guys on the bench celebrating harder than the guys on the ice. That's a team falling in love with itself, the healthy way.",
      "Somebody in that room said 'why not us?' about three weeks ago. Nobody laughed. {streak} wins later, nobody's laughing anywhere.",
      "Streaks are stories teams tell themselves. Ours is simple: nobody gets left behind, nobody skips the hard part. Chapter {streak} tonight.",
    ],
    pragmatic: [
      "We're winning games. That's the goal. We stay focused on the next one and don't overthink it.",
      "{streak} consecutive wins is a good number. We'll enjoy the standings position and keep working.",
      "The streak is a byproduct of preparation. We prepare the same way every game. That won't change.",
      "People want to talk about the streak. I just want to talk about the next game.",
      "Good stretch. Means nothing if we drop the next one. Full attention on preparation.",
      "Streaks buy you standings points and nothing else. We'll bank the points and skip the poetry.",
      "You know when I'll get excited about {streak} wins? When it's sixteen of them in May and June.",
      "The league doesn't hand out anything for a hot month. Ask me about this run again at the deadline — if it still matters, I'll have more to say.",
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
      "Practice today was not pleasant, and it was not supposed to be. Comfort is how you get to {streak} — discomfort is how you get out.",
      "Somebody leaked that the room is 'tense.' Good. It should be tense. Relaxed teams lose {streak} in a row and sleep fine. Not here.",
      "I don't need heroes tomorrow. I need twelve forwards who win their wall battles. Do the ugly thing first and the pretty thing comes back.",
    ],
    calm: [
      "{streak} losses is a difficult stretch, but I've been through these before. We address it methodically.",
      "We're not panicking. We identify the issues, we correct them in practice, and we execute better.",
      "The answers are on the tape. They always are. We focus on the controllables and we get back to work.",
      "This group has the capability to turn this around. I've seen it. We stay the course with adjustments.",
      "Adversity reveals character. I'm watching how this team responds and I'll have a better read on that.",
      "The worst thing I could do right now is rip up a system the players believe in because of {streak} bad results. We refine; we don't reinvent.",
      "I've shortened practice, not lengthened it. Tired teams in a skid press harder and think slower. Fresh legs make brave plays.",
      "There's a difference between losing and being lost. Watch our last two third periods — this team is not lost. The results will catch up.",
    ],
    analytical: [
      "Over this {streak}-game run our shot quality against has doubled. We need to close passing lanes faster.",
      "We're giving up too many grade-A chances from the slot. The system breakdown is specific and fixable.",
      "I've mapped out the sequence failures. Our transition defense has been the root cause. We address it today.",
      "The data is clear: we're getting outworked on puck battles in the defensive zone. That's a culture fix.",
      "Our 5v5 possession numbers have dropped sharply. We're spending too much time in our own end.",
      "Strip the emotion out and the skid is two problems: entry defense and second-save recovery. Two problems is a Tuesday, not a crisis.",
      "Our underlying numbers during the {streak} games are better than the results — which sounds like an excuse until you realize it tells us exactly what NOT to change.",
      "I showed the group ten clips this morning. Same structural error in seven of them. When the mistake is that repeatable, so is the fix.",
    ],
    motivator: [
      "{streak} losses doesn't change what I know about this group. We've got the people. We get back up.",
      "I've seen this team at its best and I know what it can do. Rough patch. We come out of it together.",
      "Every one of us in that room owns a piece of this. And every one of us will fix it together.",
      "I genuinely believe in these players. That's not a line — it's why I'm not throwing them under the bus.",
      "Winning streaks end. Losing streaks end. Our job is to end this one with the next game.",
      "I stood in front of them today and read out what people are saying about us. Then I said: 'They might be right about yesterday. They know nothing about tomorrow.'",
      "The easiest thing in sport is to splinter during a skid. This room refuses to. That, more than any tactic, is why I know we're coming out of it.",
      "Careers are made in stretches like this one. Somebody in that room is about to become a leader. I'm looking forward to finding out who.",
    ],
    pragmatic: [
      "{streak} in a row is not ideal. We make adjustments and put it behind us. That's the job.",
      "We haven't played well. I won't deny it. We also won't catastrophize. We fix it and move on.",
      "Every team goes through stretches like this. How you respond is what separates organizations.",
      "I've identified the tactical areas to address. We make those corrections and get back to winning hockey.",
      "We're still very much in the picture. {streak} losses isn't a death sentence. It's a challenge.",
      "Every season has a stretch you'd rather forget. Ours is now. Better November than April.",
      "No, I'm not going to blow up the lines because of {streak} results. Panic is a decision, and I'm declining to make it.",
      "The math is boring: play .500 hockey the rest of the way and we're in the conversation. Skids feel apocalyptic. They rarely are.",
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
