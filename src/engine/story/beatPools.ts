/**
 * Authored pools for THE DAILY BEAT (docs/MEDIA-BEAT.md) — the local outlet
 * that covers one club every day: practice notebooks, gameday previews,
 * postgame grades, roster moves, injury follow-ups, the mailbag, the morning
 * roundup, prospect reports and the pieces each act of the season calls for.
 *
 * House rules (the same ones inboxBeats.ts learned the hard way, enforced by
 * beatDesk.test.ts):
 *  - Frequent headline pools are 8+ deep at their base; every conditioned
 *    bucket is at least three deep, so most-specific-wins never locks in one
 *    line (the dominance trap).
 *  - A headline carries its content: a name, a score, a number.
 *  - Write what a beat writer at the rink would write. Short sentences, real
 *    numbers, first person only where the format is first person (the Daily,
 *    the mailbag). No stacked adjectives, no "the room" reflex.
 *  - Framing follows RAPPORT (`tilt`): an ally reads a loss as a bad night, a
 *    critic reads it as a management problem. Neutral is the default voice.
 *
 * Pure data. Selection goes through beatDesk.ts (ledger for persisted pieces,
 * pickStable for on-demand views).
 */
import type { ContentVariant } from './contentEngine'

/* ═══════════════════════════════ NOTEBOOK ═══════════════════════════════
 * ctx:   change (bool), absent (bool), camp (bool), chop (bool)
 * slots: {nick} {name} {to} {from} {absent} {n} {chop} {coach}
 */
export const NB_HEAD: ContentVariant[] = [
  { id: 'nb.h.a', conditions: { change: false }, text: `{nick} notebook: lines hold, and {chop} is still waiting` },
  { id: 'nb.h.b', conditions: { change: false }, text: `{nick} practice report: same combinations before {nextOpp}` },
  { id: 'nb.h.c', conditions: { change: false }, text: `Notebook: no changes up front as the {nick} get ready for {nextOpp}` },
  { id: 'nb.h.d', conditions: { change: false }, text: `{nick} notebook: a quiet skate and a familiar lineup at {record}` },
  { id: 'nb.h.e', conditions: { change: false }, text: `Practice notes: the {nick} stick with what they have for {nextOpp}` },
  { id: 'nb.h.f', conditions: { change: false }, text: `{nick} notebook: nothing new on the whiteboard, {chop} still on the outside` },
  { id: 'nb.h.g', conditions: { change: false }, text: `Notebook: {coach} keeps his lines together ahead of {nextOpp}` },
  { id: 'nb.h.h', conditions: { change: false }, text: `{nick} practice: lines, pairs and who is on the outside at {record}` },
  { id: 'nb.h.i', conditions: { change: false }, text: `{nick} notebook: {coach} sees no reason to change before {nextOpp}` },
  { id: 'nb.h.j', conditions: { change: false }, text: `Same four lines at {nick} practice; {chop} watches from the side` },
  { id: 'nb.h.ch.a', conditions: { change: true }, text: `New look for the {nick}: {name} {toPhrase} at practice` },
  { id: 'nb.h.ch.b', conditions: { change: true }, text: `{nick} notebook: {n} changes, starting with {name}` },
  { id: 'nb.h.ch.c', conditions: { change: true }, text: `Lines shuffled at {nick} practice; {name} lands {toPhrase}` },
  { id: 'nb.h.up.a', conditions: { change: true, up: true }, text: `{nick} notebook: {name} moves up to the {to}` },
  { id: 'nb.h.up.b', conditions: { change: true, up: true }, text: `{name} gets a look {toPhrase} at {nick} practice` },
  { id: 'nb.h.up.c', conditions: { change: true, up: true }, text: `{nick} practice: a promotion for {name}` },
  { id: 'nb.h.dn.a', conditions: { change: true, up: false }, text: `{nick} notebook: {name} {downPhrase}` },
  { id: 'nb.h.dn.b', conditions: { change: true, up: false }, text: `A message for {name} at {nick} practice` },
  { id: 'nb.h.dn.c', conditions: { change: true, up: false }, text: `{nick} practice: {name} {downPhrase} as {coach} tinkers` },
  { id: 'nb.h.ab.a', conditions: { absent: true }, text: `{nick} notebook: {absent} not on the ice again` },
  { id: 'nb.h.ab.b', conditions: { absent: true }, text: `{absent} misses practice; {nick} lines stay put` },
  { id: 'nb.h.ab.c', conditions: { absent: true }, text: `{nick} notebook: still no {absent}, and no timeline` },
  { id: 'nb.h.cab.a', conditions: { change: true, absent: true }, text: `{nick} notebook: {absent} out, {name} {toPhrase}` },
  { id: 'nb.h.cab.b', conditions: { change: true, absent: true }, text: `With {absent} out, the {nick} shuffle: {name} {toPhrase}` },
  { id: 'nb.h.cab.c', conditions: { change: true, absent: true }, text: `{nick} practice: {absent} absent, lines reshuffled` },
  { id: 'nb.h.camp.a', conditions: { camp: true }, text: `{nick} camp notebook: day {n}, and the battles on the bubble` },
  { id: 'nb.h.camp.b', conditions: { camp: true }, text: `Camp day {n}: who is winning a job with the {nick}` },
  { id: 'nb.h.camp.c', conditions: { camp: true }, text: `{nick} camp notes: {chop} fighting for a spot` },
]

export const NB_LEDE: ContentVariant[] = [
  { id: 'nb.l.a', conditions: { change: false }, text: `{coach} ran the same four lines and three pairs he has leaned on all week. Nobody on the bubble got a look higher up.` },
  { id: 'nb.l.b', conditions: { change: false }, text: `No surprises at practice. The combinations were the ones we saw last game, and {coach} did not want to talk about changing them.` },
  { id: 'nb.l.c', conditions: { change: false }, text: `A short, sharp skate. The lines stayed together, which tells you {coach} likes what he saw more than the scoreboard might.` },
  { id: 'nb.l.d', conditions: { change: false }, text: `If you were hoping for a shake-up, this was not the day. Here is the group as it lined up.` },
  { id: 'nb.l.e', conditions: { change: false }, text: `Business as usual on the ice. The interesting part is who was not in the main rotation.` },
  { id: 'nb.l.ch.a', conditions: { change: true }, text: `{coach} went to the whiteboard. {name} took reps {toPhrase} after spending the last stretch {fromPhrase}.` },
  { id: 'nb.l.ch.b', conditions: { change: true }, text: `The first thing you noticed was {name}, {toPhrase}. He had been {fromPhrase}.` },
  { id: 'nb.l.ch.c', conditions: { change: true }, text: `Changes today. {name} went from {fromPhrase} to {toPhrase}, and it was not the only one.` },
  { id: 'nb.l.ab.a', conditions: { absent: true }, text: `{absent} was not on the ice. The club lists him with {official}, and nothing more than that.` },
  { id: 'nb.l.ab.b', conditions: { absent: true }, text: `Still no {absent}. Officially it is {official}; the stall stayed empty again today.` },
  { id: 'nb.l.ab.c', conditions: { absent: true }, text: `{absent} did not skate. The club is still calling it {official}.` },
  { id: 'nb.l.camp.a', conditions: { camp: true }, text: `Day {n} of camp. The veterans are going through the motions they know; the interesting hockey is at the bottom of the depth chart.` },
  { id: 'nb.l.camp.b', conditions: { camp: true }, text: `Camp day {n}. There are more bodies than jobs, and everyone on the ice can count.` },
  { id: 'nb.l.camp.c', conditions: { camp: true }, text: `Another camp day, another set of reps for the men trying to stay out of the minors.` },
]

/* Coach explaining a deployment. ctx: move ('up'|'upVet'|'down'|'none'|'camp').
 * slots: {name} {first} {coach} */
export const COACH_QUOTE: ContentVariant[] = [
  { id: 'cq.n.a', conditions: { move: 'none' }, text: `"We like the pairs. We like the lines. We need to finish more, that is the only thing I would change."` },
  { id: 'cq.n.b', conditions: { move: 'none' }, text: `"You don't break up something that is generating chances. The puck will go in."` },
  { id: 'cq.n.c', conditions: { move: 'none' }, text: `"Everybody knows their role right now. That's worth something this time of year."` },
  { id: 'cq.n.d', conditions: { move: 'none' }, text: `"I'm not going to change things for the sake of it. We were fine last game."` },
  { id: 'cq.u.a', conditions: { move: 'up' }, text: `"{first} has earned it. He's been our best player at practice for a week."` },
  { id: 'cq.u.b', conditions: { move: 'up' }, text: `"We want to see what {first} does with more minutes. He's been knocking on the door."` },
  { id: 'cq.u.c', conditions: { move: 'up' }, text: `"{first} is skating well and he's winning battles. That's how you move up here."` },
  { id: 'cq.u.d', conditions: { move: 'up' }, text: `"It's a look. {first} gets a chance to show he belongs there."` },
  { id: 'cq.uv.a', conditions: { move: 'upVet' }, text: `"{first} knows what he is. We needed more from that line, and he can give it."` },
  { id: 'cq.uv.b', conditions: { move: 'upVet' }, text: `"That's where {first} should be. He's played the right way and he gets the minutes."` },
  { id: 'cq.uv.c', conditions: { move: 'upVet' }, text: `"{first} has been around long enough to know nothing is permanent. Right now he's earned it."` },
  { id: 'cq.d.a', conditions: { move: 'down' }, text: `"It's not a demotion, it's a message. {first} knows what I need from him."` },
  { id: 'cq.d.b', conditions: { move: 'down' }, text: `"{first} will be fine. Sometimes you need to simplify your game for a few nights."` },
  { id: 'cq.d.c', conditions: { move: 'down' }, text: `"We talked. {first} understands. He's too good a player to stay down there long."` },
  { id: 'cq.c.a', conditions: { move: 'camp' }, text: `"There are spots open. Whoever takes them, takes them. I've said that to every guy in here."` },
  { id: 'cq.c.b', conditions: { move: 'camp' }, text: `"The young guys are making it hard on us. That's what you want."` },
  { id: 'cq.c.c', conditions: { move: 'camp' }, text: `"Camp is a job interview. Some guys are interviewing better than others."` },
]

/* ═══════════════════════════════ GAMEDAY ═══════════════════════════════
 * ctx:   home (bool), playoff (bool), oppHot (bool), usCold (bool), usHot (bool)
 * slots: {nick} {opp} {oppNick} {city} {record} {oppRecord} {starter}
 */
export const GD_HEAD: ContentVariant[] = [
  { id: 'gd.h.a', text: `Gameday: {nick} ({record}) vs. {oppNick}, projected lineup and what to watch` },
  { id: 'gd.h.b', text: `{nick} gameday: {starter} projected in goal against the {oppNick}` },
  { id: 'gd.h.c', text: `Game preview: {nick} and {oppNick} ({oppRecord}), lines and three things to watch` },
  { id: 'gd.h.d', text: `{nick} vs. {oppNick}: projected lineup, {starter} expected to start` },
  { id: 'gd.h.e', text: `Gameday notes: {record} {nick} take on the {oppNick}` },
  { id: 'gd.h.f', text: `{nick} gameday: the lineup, the matchup, the storylines vs. {oppNick}` },
  { id: 'gd.h.f2', text: `{nick} vs. {oppNick}: who plays, who starts, what matters` },
  { id: 'gd.h.f3', text: `Morning skate notes: {nick} and the {oppNick}` },
  { id: 'gd.h.f4', text: `{nick} at {record} meet a {oppRecord} {oppNick} team: gameday` },
  { id: 'gd.h.f5', text: `{starter} expected to get the call as {nick} face the {oppNick}` },
  { id: 'gd.h.f6', text: `{nick} gameday: {watch} and the rest of what to watch vs. {oppNick}` },
  { id: 'gd.h.f7', text: `{nick}-{oppNick} preview: lines, {starter}, and {watch}` },
  { id: 'gd.h.g', text: `Tonight: {nick} host the {oppNick}. Here's the lineup`, conditions: { home: true } },
  { id: 'gd.h.h', text: `{nick} welcome the {oppNick}: lines and what to watch`, conditions: { home: true } },
  { id: 'gd.h.i', text: `Home ice tonight against the {oppNick}: {nick} gameday`, conditions: { home: true } },
  { id: 'gd.h.j', text: `{nick} in {city} tonight: projected lineup and keys`, conditions: { home: false } },
  { id: 'gd.h.k', text: `On the road in {city}: {nick} gameday`, conditions: { home: false } },
  { id: 'gd.h.l', text: `{nick} visit the {oppNick}. Lineup, starter, storylines`, conditions: { home: false } },
  { id: 'gd.h.hot.a', conditions: { oppHot: true }, text: `{nick} gameday: the {oppNick} are rolling. Here's the lineup` },
  { id: 'gd.h.hot.b', conditions: { oppHot: true }, text: `Gameday: {nick} get a hot {oppNick} team` },
  { id: 'gd.h.hot.c', conditions: { oppHot: true }, text: `{nick} vs. a {oppNick} team that has not lost in a while` },
  { id: 'gd.h.cold.a', conditions: { usCold: true }, text: `{nick} gameday: trying to stop the slide against the {oppNick}` },
  { id: 'gd.h.cold.b', conditions: { usCold: true }, text: `Gameday: {nick} need a win, and the {oppNick} are next` },
  { id: 'gd.h.cold.c', conditions: { usCold: true }, text: `{nick} look to end the skid against the {oppNick}` },
  { id: 'gd.h.po.a', conditions: { playoff: true }, text: `Playoff gameday: {nick} vs. {oppNick}, lineup and keys` },
  { id: 'gd.h.po.b', conditions: { playoff: true }, text: `{nick} playoff notes: {starter} in goal, lines as expected` },
  { id: 'gd.h.po.c', conditions: { playoff: true }, text: `Series gameday: {nick} and {oppNick}` },
]

export const GD_LEDE: ContentVariant[] = [
  { id: 'gd.l.a', text: `The {nick} ({record}) and the {oppNick} ({oppRecord}). Here is how the {nick} should line up, based on the morning skate.` },
  { id: 'gd.l.b', text: `{record} against {oppRecord}. The projected lineup is below, and it looks a lot like the last one.` },
  { id: 'gd.l.c', text: `The {nick} come in at {record}; the {oppNick} are {oppRecord}. {starter} is expected in goal.` },
  { id: 'gd.l.d', text: `A {record} team against a {oppRecord} team. The lines from the morning skate, and what I will be watching.` },
  { id: 'gd.l.op.a', conditions: { opener: true }, text: `Opening night. Everybody is undefeated and everybody is healthy enough to say so. Here is how the {nick} should line up.` },
  { id: 'gd.l.op.b', conditions: { opener: true }, text: `The season starts tonight against the {oppNick}. The lineup below is the one camp built.` },
  { id: 'gd.l.op.c', conditions: { opener: true }, text: `Game one. The projected lineup, the starter, and what I will be watching against the {oppNick}.` },
  { id: 'gd.l.po.a', conditions: { playoff: true }, text: `Playoff hockey. {starter} gets the net and the lines should look like the ones from the last game.` },
  { id: 'gd.l.po.b', conditions: { playoff: true }, text: `Another game in the series. Nobody is saying much about injuries, which is how it goes this time of year.` },
  { id: 'gd.l.po.c', conditions: { playoff: true }, text: `The morning skate was quiet and the lineup looks unchanged. Here is what matters tonight.` },
]

/* What to watch. ctx: kind. slots: {name} {n} {other} {opp} {nick} */
export const WATCH: ContentVariant[] = [
  { id: 'w.slump.a', conditions: { kind: 'slump' }, text: `{name} has gone {n} games without a point. He is getting chances; he needs one to go in.` },
  { id: 'w.slump.b', conditions: { kind: 'slump' }, text: `{name}: {n} games, no points. The longer it goes, the more the other numbers get asked about.` },
  { id: 'w.slump.c', conditions: { kind: 'slump' }, text: `The {name} drought is at {n} games. Watch his shot volume more than the scoresheet.` },
  { id: 'w.streak.a', conditions: { kind: 'streak' }, text: `{name} has points in {n} straight. The {opp} have to figure out how to keep him off the sheet.` },
  { id: 'w.streak.b', conditions: { kind: 'streak' }, text: `{name}'s point streak is at {n}. He has been the best player on the ice most nights.` },
  { id: 'w.streak.c', conditions: { kind: 'streak' }, text: `{n} straight games with a point for {name}. Nobody on the club is hotter.` },
  { id: 'w.ms.a', conditions: { kind: 'milestone' }, text: `{name} is {n} away from {other}. The building will know when it happens.` },
  { id: 'w.ms.b', conditions: { kind: 'milestone' }, text: `Milestone watch: {name} needs {n} for {other}.` },
  { id: 'w.ms.c', conditions: { kind: 'milestone' }, text: `{n} more and {name} reaches {other}.` },
  { id: 'w.rev.a', conditions: { kind: 'revenge' }, text: `{name} faces his old club. He will not say it matters. It matters.` },
  { id: 'w.rev.b', conditions: { kind: 'revenge' }, text: `Old friends: {name} spent time with the {opp} and sees them for the first time in a while.` },
  { id: 'w.rev.c', conditions: { kind: 'revenge' }, text: `{name} against the {opp}, the club that moved him. Watch the first shift.` },
  { id: 'w.inj.a', conditions: { kind: 'injury' }, text: `{nick} are without {name} ({other}). Somebody gets his minutes.` },
  { id: 'w.inj.b', conditions: { kind: 'injury' }, text: `No {name} again tonight: {other}. The lineup around him shifts.` },
  { id: 'w.inj.c', conditions: { kind: 'injury' }, text: `{name} is out ({other}), so the depth gets tested.` },
  { id: 'w.stakes.a', conditions: { kind: 'stakes' }, text: `The {opp} sit {n} {ptWord} away in the standings. This is one of those games that counts twice.` },
  { id: 'w.stakes.b', conditions: { kind: 'stakes' }, text: `{n} {ptWord} between these two clubs. A regulation win matters.` },
  { id: 'w.stakes.c', conditions: { kind: 'stakes' }, text: `Standings check: {n} {ptWord} between the {nick} and the {opp}. Four-point game.` },
  { id: 'w.goalie.a', conditions: { kind: 'heater' }, text: `{name} has stopped {other} in his last {n} starts. The {opp} need traffic in front of him.` },
  { id: 'w.goalie.b', conditions: { kind: 'heater' }, text: `{name} is on a run: {other} over his last {n}. He is the reason for a lot of the recent results.` },
  { id: 'w.goalie.c', conditions: { kind: 'heater' }, text: `Watch {name} in goal. {other} across {n} starts will do that for a team's confidence.` },
  { id: 'w.oppStar.a', conditions: { kind: 'oppStar' }, text: `{name} leads the {opp} with {n} points. Whoever draws that matchup has the night's hardest job.` },
  { id: 'w.oppStar.b', conditions: { kind: 'oppStar' }, text: `The {opp} go through {name}: {n} points so far. Keep him to the outside.` },
  { id: 'w.oppStar.c', conditions: { kind: 'oppStar' }, text: `{name} has {n} points for the {opp}. That is the assignment.` },
]

/* ═══════════════════════════════ GRADES ═══════════════════════════════
 * ctx:   won, ot, blowout, shutout, playoff, tilt ('ally'|'neutral'|'critic')
 * slots: {nick} {opp} {score} {star} {goat}
 */
export const GR_HEAD: ContentVariant[] = [
  { id: 'gr.h.w.a', conditions: { won: true }, text: `{nick} grades: {star} leads the way in {score} win over {opp}` },
  { id: 'gr.h.w.b', conditions: { won: true }, text: `Grades: {star} the difference as {nick} beat {opp} {score}` },
  { id: 'gr.h.w.c', conditions: { won: true }, text: `{nick} player grades: a {score} win, and {star} at the top` },
  { id: 'gr.h.w.d', conditions: { won: true }, text: `Report card: {nick} {score} over {opp}, {star} earns the A` },
  { id: 'gr.h.w.e', conditions: { won: true }, text: `{nick} grades after beating {opp}: {star} shines` },
  { id: 'gr.h.w.f', conditions: { won: true }, text: `Grading the {score} win over {opp}: {star} first, then everyone else` },
  { id: 'gr.h.w.g', conditions: { won: true }, text: `{nick} grades: the good, the fine and {star} vs. {opp}` },
  { id: 'gr.h.w.h', conditions: { won: true }, text: `{score} over {opp}: {nick} grades, led by {star}` },
  { id: 'gr.h.l.a', conditions: { won: false }, text: `{nick} grades: {opp} win {score}, and not many passing marks` },
  { id: 'gr.h.l.b', conditions: { won: false }, text: `Grades: {goat} and the {nick} struggle in {score} loss to {opp}` },
  { id: 'gr.h.l.c', conditions: { won: false }, text: `{nick} player grades from a {score} loss to {opp}` },
  { id: 'gr.h.l.d', conditions: { won: false }, text: `Report card: {nick} fall to {opp}, {score}` },
  { id: 'gr.h.l.e', conditions: { won: false }, text: `Grading the {score} loss to {opp}: {star} was the exception` },
  { id: 'gr.h.l.f', conditions: { won: false }, text: `{nick} grades: a {score} night against {opp} that few will remember fondly` },
  { id: 'gr.h.l.g', conditions: { won: false }, text: `{opp} {score}: {nick} grades and the bad news` },
  { id: 'gr.h.l.h', conditions: { won: false }, text: `{nick} grades after {opp}: short list of positives` },
  { id: 'gr.h.bw.a', conditions: { won: true, blowout: true }, text: `{nick} grades: everyone eats in a {score} rout of {opp}` },
  { id: 'gr.h.bw.b', conditions: { won: true, blowout: true }, text: `Grades from a {score} laugher: {nick} bury {opp}` },
  { id: 'gr.h.bw.c', conditions: { won: true, blowout: true }, text: `A lot of high marks after {nick} blow out {opp} {score}` },
  { id: 'gr.h.bl.a', conditions: { won: false, blowout: true }, text: `{nick} grades: ugly {score} loss to {opp}, and it was earned` },
  { id: 'gr.h.bl.b', conditions: { won: false, blowout: true }, text: `Grades: {opp} run {nick} out of the building, {score}` },
  { id: 'gr.h.bl.c', conditions: { won: false, blowout: true }, text: `{nick} report card after a {score} beating: not pretty` },
  { id: 'gr.h.ot.a', conditions: { won: true, ot: true }, text: `{nick} grades: {star} and a {score} win over {opp} in extra time` },
  { id: 'gr.h.ot.b', conditions: { won: true, ot: true }, text: `Grades: {nick} need extra time to get past {opp}, {score}` },
  { id: 'gr.h.ot.c', conditions: { won: true, ot: true }, text: `{nick} beat {opp} in extra time. Grades, led by {star}` },
  { id: 'gr.h.po.a', conditions: { playoff: true, won: true }, text: `Playoff grades: {star} carries {nick} past {opp}, {score}` },
  { id: 'gr.h.po.b', conditions: { playoff: true, won: true }, text: `{nick} playoff grades: {score} over {opp}, {star} on top` },
  { id: 'gr.h.po.c', conditions: { playoff: true, won: true }, text: `Grades: {nick} take a playoff game from {opp}, {score}` },
  { id: 'gr.h.pl.a', conditions: { playoff: true, won: false }, text: `Playoff grades: {nick} drop a {score} game to {opp}` },
  { id: 'gr.h.pl.b', conditions: { playoff: true, won: false }, text: `{nick} playoff report card after a {score} loss` },
  { id: 'gr.h.pl.c', conditions: { playoff: true, won: false }, text: `Grades: {opp} win the playoff game, {score}` },
]

export const GR_LEDE: ContentVariant[] = [
  { id: 'gr.l.w.a', conditions: { won: true }, text: `Two points, and a few individual nights worth talking about. Grades for everyone who dressed.` },
  { id: 'gr.l.w.b', conditions: { won: true }, text: `The {nick} beat {opp} {score}. Not every player had his best night, but enough of them did.` },
  { id: 'gr.l.w.c', conditions: { won: true }, text: `A win is a win. Here is who earned it and who came along for the ride.` },
  { id: 'gr.l.w.d', conditions: { won: true }, text: `{score} over {opp}. {star} was the best player on the ice and it was not especially close.` },
  { id: 'gr.l.l.a', conditions: { won: false }, text: `The {nick} lost {score} to {opp}. Grades for every player who dressed, and they are not kind.` },
  { id: 'gr.l.l.b', conditions: { won: false }, text: `{opp} took it {score}. A few players can hold their heads up. Most cannot.` },
  { id: 'gr.l.l.c', conditions: { won: false }, text: `A {score} loss. Here is how everybody played.` },
  { id: 'gr.l.l.d', conditions: { won: false }, text: `Not the night the {nick} wanted. {star} did his part; the grades show who did not.` },
  // Rapport frames a loss. An ally reads it as a bad night; a critic reads it as a management problem.
  { id: 'gr.l.la.a', conditions: { won: false, tilt: 'ally' }, text: `A {score} loss to {opp}, and I would not overreact to it. The process was better than the result, and a lot of these players have earned a bad night.` },
  { id: 'gr.l.la.b', conditions: { won: false, tilt: 'ally' }, text: `{opp} {score}. Some nights the bounces go the other way. The grades are honest; the panic, if you are feeling it, is premature.` },
  { id: 'gr.l.la.c', conditions: { won: false, tilt: 'ally' }, text: `The {nick} lost {score}, and it happens. This group has been good enough often enough that one night does not change what they are.` },
  { id: 'gr.l.lc.a', conditions: { won: false, tilt: 'critic' }, text: `The {nick} lost {score} to {opp}, and at some point the grades stop being about the players. This is the roster that was built. This is what it does.` },
  { id: 'gr.l.lc.b', conditions: { won: false, tilt: 'critic' }, text: `{opp} {score}. You can grade the players, and I will, but the problem with this team was on paper before it was on the ice.` },
  { id: 'gr.l.lc.c', conditions: { won: false, tilt: 'critic' }, text: `Another loss, {score} to {opp}. The individual marks are below. The questions for the front office are the same ones as last week.` },
  { id: 'gr.l.wc.a', conditions: { won: true, tilt: 'critic' }, text: `A {score} win over {opp}. Enjoy it. The holes in this lineup did not close tonight; {star} just played over them.` },
  { id: 'gr.l.wc.b', conditions: { won: true, tilt: 'critic' }, text: `The {nick} beat {opp}, {score}. Good night. It does not answer the questions about how this group was put together.` },
  { id: 'gr.l.wc.c', conditions: { won: true, tilt: 'critic' }, text: `Two points against {opp}. The grades are good. The roster still has the same problems it had yesterday.` },
  { id: 'gr.l.wa.a', conditions: { won: true, tilt: 'ally' }, text: `{score} over {opp}, and this is what the plan looks like when it works. Grades below.` },
  { id: 'gr.l.wa.b', conditions: { won: true, tilt: 'ally' }, text: `The {nick} beat {opp} {score}, and the moves made to get here look better every week.` },
  { id: 'gr.l.wa.c', conditions: { won: true, tilt: 'ally' }, text: `A {score} win, and the depth that was added is a big part of why. The grades tell it.` },
]

/* Grade notes, by the one fact that best describes a player's night.
 * ctx: why. slots: {g} {a} {pts} {shots} {hits} {blocks} {pm} {toi} {saves} {sa} {ga} {svp} */
export const GRADE_NOTE: ContentVariant[] = [
  { id: 'gn.multi.a', conditions: { why: 'multi' }, text: `{g} goals. Found the soft spots all night.` },
  { id: 'gn.multi.b', conditions: { why: 'multi' }, text: `{g} goals on {shotsWord}. The best player out there.` },
  { id: 'gn.multi.c', conditions: { why: 'multi' }, text: `Scored {g}. Everything went in, and it was not luck.` },
  { id: 'gn.goal.a', conditions: { why: 'goal' }, text: `Scored, and was involved every shift he took.` },
  { id: 'gn.goal.b', conditions: { why: 'goal' }, text: `A goal on {shotsWord}. Made his minutes count.` },
  { id: 'gn.goal.c', conditions: { why: 'goal' }, text: `Got one. Worked for it.` },
  { id: 'gn.goal.d', conditions: { why: 'goal' }, text: `His goal changed the night.` },
  { id: 'gn.play.a', conditions: { why: 'playmaker' }, text: `{a} assists. Everything went through him.` },
  { id: 'gn.play.b', conditions: { why: 'playmaker' }, text: `{a} helpers and a lot of good decisions with the puck.` },
  { id: 'gn.play.c', conditions: { why: 'playmaker' }, text: `Set up {a}. Saw the ice as well as anybody.` },
  { id: 'gn.pt.a', conditions: { why: 'point' }, text: `An assist and a steady night.` },
  { id: 'gn.pt.b', conditions: { why: 'point' }, text: `Picked up a helper. Did the simple things right.` },
  { id: 'gn.pt.c', conditions: { why: 'point' }, text: `On the scoresheet with an assist.` },
  { id: 'gn.shots.a', conditions: { why: 'shots' }, text: `{shotsWord}, no goal. The effort was there.` },
  { id: 'gn.shots.b', conditions: { why: 'shots' }, text: `Fired {shots} times. The goalie had his number.` },
  { id: 'gn.shots.c', conditions: { why: 'shots' }, text: `{shotsWord} on goal. Kept coming.` },
  { id: 'gn.phys.a', conditions: { why: 'physical' }, text: `{hits} hits. Made the other side pay for every puck.` },
  { id: 'gn.phys.b', conditions: { why: 'physical' }, text: `Physical all night: {hits} hits.` },
  { id: 'gn.phys.c', conditions: { why: 'physical' }, text: `Finished every check he could reach. {hits} hits.` },
  { id: 'gn.blk.a', conditions: { why: 'blocks' }, text: `{blocks} blocked shots. Paid a price for it.` },
  { id: 'gn.blk.b', conditions: { why: 'blocks' }, text: `Got in lanes: {blocks} blocks.` },
  { id: 'gn.blk.c', conditions: { why: 'blocks' }, text: `{blocks} shots blocked, and a lot of quiet defending.` },
  { id: 'gn.minus.a', conditions: { why: 'minus' }, text: `{pm} and on the ice for too much of it.` },
  { id: 'gn.minus.b', conditions: { why: 'minus' }, text: `A {pm} night. Chased it.` },
  { id: 'gn.minus.c', conditions: { why: 'minus' }, text: `{pm}. Tough night in his own end.` },
  { id: 'gn.plus.a', conditions: { why: 'plus' }, text: `{pm}. Good things happened when he was out there.` },
  { id: 'gn.plus.b', conditions: { why: 'plus' }, text: `A {pm} in {toi}. Quietly effective.` },
  { id: 'gn.plus.c', conditions: { why: 'plus' }, text: `{pm} and very little to complain about.` },
  { id: 'gn.minutes.a', conditions: { why: 'minutes' }, text: `{toi} of ice time and no mistakes you could see.` },
  { id: 'gn.minutes.b', conditions: { why: 'minutes' }, text: `Played {toi}. The coaches trust him.` },
  { id: 'gn.minutes.c', conditions: { why: 'minutes' }, text: `Logged {toi}. Heavy night, handled it.` },
  { id: 'gn.quiet.a', conditions: { why: 'quiet' }, text: `Not much to say, good or bad.` },
  { id: 'gn.quiet.b', conditions: { why: 'quiet' }, text: `Invisible most of the night.` },
  { id: 'gn.quiet.c', conditions: { why: 'quiet' }, text: `Kept it simple. Nothing jumped out either way.` },
  { id: 'gn.quiet.d', conditions: { why: 'quiet' }, text: `Hard to find on the ice. That can be good or bad.` },
  { id: 'gn.gw.a', conditions: { why: 'goalieGood' }, text: `{saves} saves on {sa}. Stole a few.` },
  { id: 'gn.gw.b', conditions: { why: 'goalieGood' }, text: `Stopped {saves} of {sa}. Calm and square all night.` },
  { id: 'gn.gw.c', conditions: { why: 'goalieGood' }, text: `{svp} on {sa} shots. Nothing easy got by him.` },
  { id: 'gn.gb.a', conditions: { why: 'goalieBad' }, text: `{ga} goals on {sa} shots. Needed one more save.` },
  { id: 'gn.gb.b', conditions: { why: 'goalieBad' }, text: `Allowed {ga}. At least one he wants back.` },
  { id: 'gn.gb.c', conditions: { why: 'goalieBad' }, text: `{svp} on the night. Not his sharpest.` },
  { id: 'gn.gm.a', conditions: { why: 'goalieFine' }, text: `{saves} saves. Did what was asked.` },
  { id: 'gn.gm.b', conditions: { why: 'goalieFine' }, text: `Stopped {saves} of {sa}. Solid, nothing more.` },
  { id: 'gn.gm.c', conditions: { why: 'goalieFine' }, text: `{svp}. No complaints.` },
]

/* The closing paragraph of a grades piece. ctx: won, tilt. slots: {nick} {opp} {star} {goat} {next} */
export const GR_CLOSE: ContentVariant[] = [
  { id: 'gr.c.w.a', conditions: { won: true }, text: `Next up: {next}.` },
  { id: 'gr.c.w.b', conditions: { won: true }, text: `They will take it and move on. Up next: {next}.` },
  { id: 'gr.c.w.c', conditions: { won: true }, text: `Good night. Next on the schedule: {next}, and that one will ask different questions.` },
  { id: 'gr.c.w.d', conditions: { won: true }, text: `Bank it. Next: {next}.` },
  { id: 'gr.c.l.a', conditions: { won: false }, text: `Next: {next}, and a chance to wash this one out.` },
  { id: 'gr.c.l.b', conditions: { won: false }, text: `Short memory required. Next up: {next}.` },
  { id: 'gr.c.l.c', conditions: { won: false }, text: `Practice tomorrow will be louder than usual. Then {next}.` },
  { id: 'gr.c.l.d', conditions: { won: false }, text: `On to {next}. They need a better start than this one.` },
  { id: 'gr.c.la.a', conditions: { won: false, tilt: 'ally' }, text: `Next up: {next}. I would bet on a response; this group has answered before.` },
  { id: 'gr.c.la.b', conditions: { won: false, tilt: 'ally' }, text: `One loss. The larger picture is still a good one. Next up: {next}.` },
  { id: 'gr.c.la.c', conditions: { won: false, tilt: 'ally' }, text: `Flush it. The {nick} are better than this. Next up: {next}, a chance to show it.` },
  { id: 'gr.c.lc.a', conditions: { won: false, tilt: 'critic' }, text: `Next up: {next}. The front office should be watching as closely as the fans are.` },
  { id: 'gr.c.lc.b', conditions: { won: false, tilt: 'critic' }, text: `The players will be asked about this. They are not the only ones who should be. Next: {next}.` },
  { id: 'gr.c.lc.c', conditions: { won: false, tilt: 'critic' }, text: `Next: {next}. The roster will be the same, which is the problem.` },
]

/* ═══════════════════════════════ ROSTER MOVES ═══════════════════════════════
 * ctx: many (bool, 3+), callup (bool), assign (bool), waiver (bool), camp (bool)
 * slots: {nick} {name} {n} {first}
 */
export const MV_HEAD: ContentVariant[] = [
  { id: 'mv.h.a', text: `{nick} roster moves: {first}` },
  { id: 'mv.h.b', text: `Transactions: {first}` },
  { id: 'mv.h.c', text: `{nick} make a move: {first}` },
  { id: 'mv.h.d', text: `Roster update from {nick}: {first}` },
  { id: 'mv.h.e', text: `{nick} shuffle the roster; {first}` },
  { id: 'mv.h.f', text: `Moves: {first}` },
  { id: 'mv.h.g', text: `{nick} transactions for the day` },
  { id: 'mv.h.h', text: `Today's {nick} roster moves` },
  { id: 'mv.h.m.a', conditions: { many: true }, text: `{nick} roster moves: {n} transactions, starting with {name}` },
  { id: 'mv.h.m.b', conditions: { many: true }, text: `A busy day: {nick} make {n} moves` },
  { id: 'mv.h.m.c', conditions: { many: true }, text: `{n} {nick} moves, including {name}` },
  { id: 'mv.h.camp.a', conditions: { camp: true }, text: `{nick} cuts: {n} moves as camp breaks` },
  { id: 'mv.h.camp.b', conditions: { camp: true }, text: `Camp cuts: {nick} trim the roster, {name} among them` },
  { id: 'mv.h.camp.c', conditions: { camp: true }, text: `{nick} make their cuts: {n} moves` },
]

export const MV_LEDE: ContentVariant[] = [
  { id: 'mv.l.a', text: `The day's transactions, all of them official.` },
  { id: 'mv.l.b', text: `Here is what the club announced today.` },
  { id: 'mv.l.c', text: `Paperwork day. The moves below are official.` },
  { id: 'mv.l.d', text: `The {nick} filed the following with the league.` },
  { id: 'mv.l.camp.a', conditions: { camp: true }, text: `Camp is over for some of them. The cuts, as the club announced them.` },
  { id: 'mv.l.camp.b', conditions: { camp: true }, text: `The hard part of camp: telling people. Here is who got the news.` },
  { id: 'mv.l.camp.c', conditions: { camp: true }, text: `The numbers had to come down to a roster, and now they have.` },
]

/* ═══════════════════════════════ INJURIES ═══════════════════════════════
 * ctx:   beat ('new'|'reveal'|'worse'|'ahead'), key (bool), band
 * slots: {name} {nick} {official} {band} {truth} {missed} {games}
 */
export const INJ_HEAD: ContentVariant[] = [
  { id: 'in.n.a', conditions: { beat: 'new' }, text: `{name} out with {official}` },
  { id: 'in.n.b', conditions: { beat: 'new' }, text: `{nick} injury update: {name}, {band}` },
  { id: 'in.n.c', conditions: { beat: 'new' }, text: `{name} listed {band}; club calls it {official}` },
  { id: 'in.n.d', conditions: { beat: 'new', key: true }, text: `Blow for {nick}: {name} out, {band}` },
  { id: 'in.n.e', conditions: { beat: 'new', key: true }, text: `{name} hurt; {nick} say {band}` },
  { id: 'in.n.f', conditions: { beat: 'new', key: true }, text: `{nick} without {name} for now: {official}` },
  { id: 'in.n.ill.a', conditions: { beat: 'new', illness: true }, text: `{name} sick; {nick} list him {band}` },
  { id: 'in.n.ill.b', conditions: { beat: 'new', illness: true }, text: `Illness keeps {name} out of the {nick} lineup` },
  { id: 'in.n.ill.c', conditions: { beat: 'new', illness: true }, text: `{name} under the weather, {band}` },
  { id: 'in.r.a', conditions: { beat: 'reveal' }, text: `{namePoss} injury is {truth}, per sources` },
  { id: 'in.r.b', conditions: { beat: 'reveal' }, text: `What the club did not say: {name} has {truth}` },
  { id: 'in.r.c', conditions: { beat: 'reveal' }, text: `Sources: {namePoss} "{band}" injury is {truth}` },
  { id: 'in.r.d', conditions: { beat: 'reveal' }, text: `The real diagnosis on {name}: {truth}` },
  { id: 'in.w.a', conditions: { beat: 'worse' }, text: `{name} injury worse than first thought` },
  { id: 'in.w.b', conditions: { beat: 'worse' }, text: `"{band}" was optimistic: {name} still out after {missed} games` },
  { id: 'in.w.c', conditions: { beat: 'worse' }, text: `{name} still sidelined, and the timeline keeps moving` },
  { id: 'in.w.d', conditions: { beat: 'worse' }, text: `The {name} injury is not the short one the club described` },
  { id: 'in.a.a', conditions: { beat: 'ahead' }, text: `{name} back ahead of schedule` },
  { id: 'in.a.b', conditions: { beat: 'ahead' }, text: `Good news for {nick}: {name} returns early` },
  { id: 'in.a.c', conditions: { beat: 'ahead' }, text: `{name} beats the timeline and is back in the lineup` },
]

export const INJ_BODY: ContentVariant[] = [
  { id: 'in.nb.a', conditions: { beat: 'new' }, text: `The {nick} announced {name} with {official}. That is all they are saying, which is all they have to say.` },
  { id: 'in.nb.b', conditions: { beat: 'new' }, text: `Officially: {official}. We will know more when he is seen skating, or when he is not.` },
  { id: 'in.nb.c', conditions: { beat: 'new' }, text: `{name} is listed with {official}. The club did not give a location beyond that, and it rarely does.` },
  { id: 'in.nb.d', conditions: { beat: 'new', key: true }, text: `This one matters. {name} is listed with {official}, and there is no easy way to replace what he does.` },
  { id: 'in.nb.e', conditions: { beat: 'new', key: true }, text: `{name} left the lineup with {official}. The {nick} will spend the next stretch finding out how deep they really are.` },
  { id: 'in.nb.f', conditions: { beat: 'new', key: true }, text: `Officially {official}. Unofficially, the whole lineup shifts until he is back.` },
  { id: 'in.rb.a', conditions: { beat: 'reveal' }, text: `The club has called it {official}. According to people familiar with it, {name} has {truth}. The team has not confirmed that, and will not.` },
  { id: 'in.rb.b', conditions: { beat: 'reveal' }, text: `We can put a name on it now. {name} has {truth}. The club's line is still {official}.` },
  { id: 'in.rb.c', conditions: { beat: 'reveal' }, text: `{name} has {truth}, according to sources. The team has stuck to {official}, which is its right under league policy and tells you nothing.` },
  { id: 'in.wb.a', conditions: { beat: 'worse' }, text: `When {name} went down the club said {official}. He has now missed {missed} games. Nobody is using the word "{band}" any more.` },
  { id: 'in.wb.b', conditions: { beat: 'worse' }, text: `{missed} games and counting. The original description, {official}, looks optimistic at this point, and the team has not updated it.` },
  { id: 'in.wb.c', conditions: { beat: 'worse' }, text: `The "{band}" label has not aged well. {name} has missed {missed} games and is not back on the ice with the group.` },
  { id: 'in.ab.a', conditions: { beat: 'ahead' }, text: `The club had said {official}. {name} missed only {missed} games and is back. Nobody is complaining.` },
  { id: 'in.ab.b', conditions: { beat: 'ahead' }, text: `{name} was listed {band}. He is back after {missed} games. The medical staff played it safe with the timeline and he beat it.` },
  { id: 'in.ab.c', conditions: { beat: 'ahead' }, text: `Back sooner than advertised. The team said {band}; he returned after {missed} games.` },
]

/* National insider breaking another club's injury truth (feed post).
 * slots: {name} {team} {truth} {official} */
export const INSIDER_INJURY: ContentVariant[] = [
  { id: 'ii.a', text: `Hearing {namePoss} injury is {truth}. The {team} are calling it {official}. It is going to be longer than that.` },
  { id: 'ii.b', text: `{name} ({team}): club says {official}. I'm told it's {truth}. Plan accordingly.` },
  { id: 'ii.c', text: `On {name}: the {team} line is {official}. Sources say {truth}. Not a short one.` },
  { id: 'ii.d', text: `Word on {name} of the {team} is {truth}. The official description undersells it.` },
]

/* ═══════════════════════════════ MAILBAG ═══════════════════════════════ */
export const MB_HEAD: ContentVariant[] = [
  { id: 'mb.h.a', text: `{nick} mailbag: {q1}, {q2} and more` },
  { id: 'mb.h.b', text: `Mailbag: {q1}? Plus {q2}` },
  { id: 'mb.h.c', text: `{nick} mailbag: your questions on {q1} and {q2}` },
  { id: 'mb.h.d', text: `You asked: {q1}, {q2}, and what happens next` },
  { id: 'mb.h.e', text: `{nick} mailbag: {q1}, plus a word on {q2}` },
  { id: 'mb.h.f', text: `Mailbag: {q1} and {q2}` },
  { id: 'mb.h.g', text: `Friday mailbag: {q1}, {q2}, more` },
  { id: 'mb.h.h', text: `{nick} mailbag: {q1}, and the rest of your questions` },
]

export const MB_LEDE: ContentVariant[] = [
  { id: 'mb.l.a', text: `The inbox was full this week. Here are the ones I could answer without making things up.` },
  { id: 'mb.l.b', text: `Your questions, my answers. As always, the good ones get in and the rude ones get in if they are funny.` },
  { id: 'mb.l.c', text: `Plenty to get to. Let's go.` },
  { id: 'mb.l.d', text: `Another week, another stack of questions. Some of you are going to like these answers more than others.` },
  { id: 'mb.l.e', text: `Mailbag time. I picked the questions I kept getting in different forms.` },
]

/* Mailbag topics — question + answer per topic, keyed by the verdict the
 * facts support. Slots are documented per topic in beatDesk.ts. */
export const MB_Q: ContentVariant[] = [
  { id: 'q.cap.a', conditions: { topic: 'cap' }, text: `How much cap room is there really if they want to add someone?` },
  { id: 'q.cap.b', conditions: { topic: 'cap' }, text: `Can they afford a real piece, or is the cap going to stop them?` },
  { id: 'q.cap.c', conditions: { topic: 'cap' }, text: `What does the cap sheet actually allow them to do?` },
  { id: 'q.pro.a', conditions: { topic: 'prospect' }, text: `Is {name} ready for the NHL?` },
  { id: 'q.pro.b', conditions: { topic: 'prospect' }, text: `{name} is putting up points in the {league}. Is it time to call him up?` },
  { id: 'q.pro.c', conditions: { topic: 'prospect' }, text: `Should {name} be in the NHL already?` },
  { id: 'q.dep.a', conditions: { topic: 'deployment' }, text: `Why is {name} on the {slot}?` },
  { id: 'q.dep.b', conditions: { topic: 'deployment' }, text: `{name} on the {slot}. What am I missing?` },
  { id: 'q.dep.c', conditions: { topic: 'deployment' }, text: `Does the coach not trust {name}, or is the {slot} the plan?` },
  { id: 'q.g.a', conditions: { topic: 'goalie' }, text: `Should {backup} be starting over {starter}?` },
  { id: 'q.g.b', conditions: { topic: 'goalie' }, text: `Is it time for a change in goal?` },
  { id: 'q.g.c', conditions: { topic: 'goalie' }, text: `Should {backup} get the net for a while?` },
  { id: 'q.sl.a', conditions: { topic: 'slump' }, text: `{name} has gone cold. Should we be worried?` },
  { id: 'q.sl.b', conditions: { topic: 'slump' }, text: `What is wrong with {name}?` },
  { id: 'q.sl.c', conditions: { topic: 'slump' }, text: `Is the {name} slump a real problem or just noise?` },
  { id: 'q.tr.a', conditions: { topic: 'trade' }, text: `Is {name} getting traded?` },
  { id: 'q.tr.b', conditions: { topic: 'trade' }, text: `Will {name} be moved?` },
  { id: 'q.tr.c', conditions: { topic: 'trade' }, text: `Should they move {name} while his value is there?` },
  { id: 'q.po.a', conditions: { topic: 'playoffs' }, text: `Be honest: is this a playoff team?` },
  { id: 'q.po.b', conditions: { topic: 'playoffs' }, text: `Do they make the playoffs?` },
  { id: 'q.po.c', conditions: { topic: 'playoffs' }, text: `Are they getting in this year?` },
  { id: 'q.dr.a', conditions: { topic: 'draft' }, text: `Should we be watching the draft lottery already?` },
  { id: 'q.dr.b', conditions: { topic: 'draft' }, text: `Where are they picking if the season ended today?` },
  { id: 'q.dr.c', conditions: { topic: 'draft' }, text: `Is it time to think about the draft?` },
  { id: 'q.co.a', conditions: { topic: 'coach' }, text: `Is {coach} on the hot seat?` },
  { id: 'q.co.b', conditions: { topic: 'coach' }, text: `Is {coach}'s job in danger?` },
  { id: 'q.co.c', conditions: { topic: 'coach' }, text: `Should {coach} be worried?` },
  { id: 'q.ex.a', conditions: { topic: 'extension' }, text: `Do they re-sign {name}?` },
  { id: 'q.ex.b', conditions: { topic: 'extension' }, text: `Will {name} be back next season?` },
  { id: 'q.ex.c', conditions: { topic: 'extension' }, text: `Should they extend {name}?` },
  { id: 'q.st.a', conditions: { topic: 'special' }, text: `What is going on with the power play?` },
  { id: 'q.st.b', conditions: { topic: 'special' }, text: `Why does the power play look the way it does?` },
  { id: 'q.st.c', conditions: { topic: 'special' }, text: `Is the power play a problem or a strength right now?` },
  { id: 'q.bp.a', conditions: { topic: 'standout' }, text: `Who has been their best player so far?` },
  { id: 'q.bp.b', conditions: { topic: 'standout' }, text: `If you had to pick an MVP for the {nick} right now, who is it?` },
  { id: 'q.bp.c', conditions: { topic: 'standout' }, text: `Who is carrying this team?` },
  { id: 'q.rk.a', conditions: { topic: 'rookie' }, text: `How is {name} doing in his first real look?` },
  { id: 'q.rk.b', conditions: { topic: 'rookie' }, text: `Is {name} going to stick?` },
  { id: 'q.rk.c', conditions: { topic: 'rookie' }, text: `What do you make of {name} so far?` },
  { id: 'q.hs.a', conditions: { topic: 'streak' }, text: `Is the {name} run for real?` },
  { id: 'q.hs.b', conditions: { topic: 'streak' }, text: `Can {name} keep this up?` },
  { id: 'q.hs.c', conditions: { topic: 'streak' }, text: `{name} is on fire. How long does it last?` },
]

export const MB_A: ContentVariant[] = [
  /* cap: {space} {used} {ufas} {nick} */
  { id: 'a.cap.room.a', conditions: { topic: 'cap', verdict: 'room' }, text: `There is room. About {space} under the cap, which buys a real player, not just a depth body. {ufas}The question is what they are willing to give up, not what they can afford.` },
  { id: 'a.cap.room.b', conditions: { topic: 'cap', verdict: 'room' }, text: `{space} in space is enough to take on a contract most teams cannot. {ufas}If they stand still, it will not be because of the cap.` },
  { id: 'a.cap.room.c', conditions: { topic: 'cap', verdict: 'room' }, text: `They have {space}. That is flexibility. {ufas}I expect them to use at least some of it before long.` },
  { id: 'a.cap.tight.a', conditions: { topic: 'cap', verdict: 'tight' }, text: `Not much. They are at {used} of the cap with about {space} left, so any addition means money going the other way. {ufas}` },
  { id: 'a.cap.tight.b', conditions: { topic: 'cap', verdict: 'tight' }, text: `It is tight: {space} of room. Anything bigger than a depth move needs a matching contract going out. {ufas}` },
  { id: 'a.cap.tight.c', conditions: { topic: 'cap', verdict: 'tight' }, text: `They are close to the ceiling, {space} under. Do not expect a big name without a hockey trade. {ufas}` },
  /* prospect: {name} {league} {gp} {pts} {g} {age} {pos} */
  { id: 'a.pro.ready.a', conditions: { topic: 'prospect', verdict: 'ready' }, text: `I think so. {pts} points in {gp} games in the {league} at {age} is not a player who needs more time there, and I think he sees the NHL before long.` },
  { id: 'a.pro.ready.b', conditions: { topic: 'prospect', verdict: 'ready' }, text: `Yes. {pts} points in {gp} games is dominant. The only thing keeping him down is a roster spot, and injuries have a way of opening those.` },
  { id: 'a.pro.ready.c', conditions: { topic: 'prospect', verdict: 'ready' }, text: `He is making the decision easy: {g} goals, {pts} points in {gp} games. Call him up and see.` },
  { id: 'a.pro.close.a', conditions: { topic: 'prospect', verdict: 'close' }, text: `Close. {pts} points in {gp} games is good, not overwhelming. Another stretch like this and the conversation changes.` },
  { id: 'a.pro.close.b', conditions: { topic: 'prospect', verdict: 'close' }, text: `Soon, maybe. He is producing, {pts} in {gp}, and he is {age}. There is no rush, and he will get his look if he keeps this up.` },
  { id: 'a.pro.close.c', conditions: { topic: 'prospect', verdict: 'close' }, text: `Not yet, but not far. {pts} points in {gp} games; I want to see him dominate before he gets called up, and he is almost there.` },
  { id: 'a.pro.not.a', conditions: { topic: 'prospect', verdict: 'notyet' }, text: `Not yet. {pts} points in {gp} games is fine for a {age}-year-old, but he is not forcing anyone's hand.` },
  { id: 'a.pro.not.b', conditions: { topic: 'prospect', verdict: 'notyet' }, text: `Patience. {gp} games, {pts} points. The development plan here is years, not weeks.` },
  { id: 'a.pro.not.c', conditions: { topic: 'prospect', verdict: 'notyet' }, text: `He is learning. {pts} in {gp} does not scream NHL, and rushing him would not do him any favours.` },
  /* deployment: {name} {slot} {pts} {rank} */
  { id: 'a.dep.a', text: `Fair question. {name} has {pts} points and he is one of the better players on the roster on paper. My read: the coach wants him to earn it back, and he has not yet.`, conditions: { topic: 'deployment' } },
  { id: 'a.dep.b', text: `The coach likes the lines above him as they are and does not want to break them up. {name} is the one who pays for that. I do not think it lasts.`, conditions: { topic: 'deployment' } },
  { id: 'a.dep.c', text: `{pts} points, and the {slot}. It is a message. How {name} answers it decides where he is in a month.`, conditions: { topic: 'deployment' } },
  /* goalie: {starter} {backup} {ssv} {bsv} {sgp} {bgp} */
  { id: 'a.g.switch.a', conditions: { topic: 'goalie', verdict: 'switch' }, text: `The numbers say yes. {backup} is at {bsv} in {bgp} games; {starter} is at {ssv} in {sgp}. At some point you go with the hot hand, and I think we are there.` },
  { id: 'a.g.switch.b', conditions: { topic: 'goalie', verdict: 'switch' }, text: `{backup} has earned more starts: {bsv} against {starter}'s {ssv}. I would split it closer to even for a couple of weeks and let them settle it.` },
  { id: 'a.g.switch.c', conditions: { topic: 'goalie', verdict: 'switch' }, text: `It is not a crazy idea. {bsv} to {ssv} is a real gap. Ride {backup} and see what happens.` },
  { id: 'a.g.stay.a', conditions: { topic: 'goalie', verdict: 'stay' }, text: `No. {starter} is at {ssv} and {backup} is at {bsv}. This is the starter's net and it should be.` },
  { id: 'a.g.stay.b', conditions: { topic: 'goalie', verdict: 'stay' }, text: `I get why people ask after a bad night, but {starter}'s {ssv} over {sgp} games is the bigger sample. He is fine.` },
  { id: 'a.g.stay.c', conditions: { topic: 'goalie', verdict: 'stay' }, text: `No. {starter} keeps it: {ssv} against {bsv} is not a big enough gap to hand over the net.` },
  /* slump: {name} {games} {pts} {g} */
  { id: 'a.sl.a', conditions: { topic: 'slump' }, text: `A little. {name} has gone {games} games without a point, which is long for him. The chances are still there, though, and I would rather see that than a guy who is not getting looks at all.` },
  { id: 'a.sl.b', conditions: { topic: 'slump' }, text: `{games} games is a slump, not a crisis. He has {pts} points this season. It will turn; the question is whether the lineup can afford to wait.` },
  { id: 'a.sl.c', conditions: { topic: 'slump' }, text: `He is gripping the stick. {games} games without a point will do that. I would try him with different linemates before anything else.` },
  /* trade: {name} {reason} {aav} {years} */
  { id: 'a.tr.block.a', conditions: { topic: 'trade', verdict: 'block' }, text: `He is available. That part is not a secret around the league. {name} has {years} left at {aav}. What they get depends on who is desperate, and that usually means waiting.` },
  { id: 'a.tr.block.b', conditions: { topic: 'trade', verdict: 'block' }, text: `The phones are on. {name} at {aav} is movable, and I would be surprised if he is here much longer.` },
  { id: 'a.tr.block.c', conditions: { topic: 'trade', verdict: 'block' }, text: `If the right offer comes, yes. {name} is not untouchable and the club has not pretended otherwise.` },
  { id: 'a.tr.req.a', conditions: { topic: 'trade', verdict: 'request' }, text: `He wants out, and those situations rarely fix themselves. The club will not give him away, so this could take a while.` },
  { id: 'a.tr.req.b', conditions: { topic: 'trade', verdict: 'request' }, text: `When a player asks to leave, the leverage goes with him. {name} at {aav}; teams know the situation, and the offers will reflect it.` },
  { id: 'a.tr.req.c', conditions: { topic: 'trade', verdict: 'request' }, text: `I would expect a deal eventually. Whether it is soon depends on how patient the front office wants to be.` },
  { id: 'a.tr.exp.a', conditions: { topic: 'trade', verdict: 'expiring' }, text: `{name} is on an expiring deal. If they are not re-signing him, the deadline is the last time he has value. I think that is a real possibility.` },
  { id: 'a.tr.exp.b', conditions: { topic: 'trade', verdict: 'expiring' }, text: `It depends on the standings. A contender keeps him. Anyone else should at least listen, because in the summer he can walk for nothing.` },
  { id: 'a.tr.exp.c', conditions: { topic: 'trade', verdict: 'expiring' }, text: `Expiring contract, useful player. That is the most tradeable thing in hockey. Keep an eye on it.` },
  /* playoffs: {rank} {gap} {left} {nick} */
  { id: 'a.po.in.a', conditions: { topic: 'playoffs', verdict: 'in' }, text: `Yes. They are {gap} clear of the cut line with {left} to play. Things can go wrong, but I would bet on it.` },
  { id: 'a.po.in.b', conditions: { topic: 'playoffs', verdict: 'in' }, text: `On current form, yes. {gap} above the line is a cushion, not a lock. Do not book anything yet, but I think so.` },
  { id: 'a.po.in.c', conditions: { topic: 'playoffs', verdict: 'in' }, text: `I think they are in. {gap} clear with {left} games left is a lot of hockey for a team to collapse in, and this one has not shown that.` },
  { id: 'a.po.bub.a', conditions: { topic: 'playoffs', verdict: 'bubble' }, text: `Honestly, coin flip. They are within {gap} of the line either way with {left} to go. The next ten games decide it.` },
  { id: 'a.po.bub.b', conditions: { topic: 'playoffs', verdict: 'bubble' }, text: `Bubble team. That is not a knock, that is the standings. {left} games left and nothing is settled.` },
  { id: 'a.po.bub.c', conditions: { topic: 'playoffs', verdict: 'bubble' }, text: `It will go down to the wire. I lean yes, barely, but I would not argue with anyone who leans the other way.` },
  { id: 'a.po.out.a', conditions: { topic: 'playoffs', verdict: 'out' }, text: `I don't see it. {gap} back with {left} to play means passing several teams, and they have not shown that kind of run.` },
  { id: 'a.po.out.b', conditions: { topic: 'playoffs', verdict: 'out' }, text: `Not this year. {gap} is a big hole. The honest conversation now is about next season.` },
  { id: 'a.po.out.c', conditions: { topic: 'playoffs', verdict: 'out' }, text: `The math is not kind: {gap} back, {left} left. Stranger things have happened. Not many.` },
  /* draft: {slot} {nick} */
  { id: 'a.dr.a', text: `If the season ended today they would pick somewhere around {slot}. That is a real prospect, and it is worth watching who is up there.`, conditions: { topic: 'draft' } },
  { id: 'a.dr.b', text: `Around {slot}, give or take the lottery. Nobody wants to root for that, but the draft is how this gets fixed.`, conditions: { topic: 'draft' } },
  { id: 'a.dr.c', text: `The standings put them near {slot}. A pick that high changes a franchise if they hit on it.`, conditions: { topic: 'draft' } },
  /* coach: {coach} {record} */
  { id: 'a.co.hot.a', conditions: { topic: 'coach', verdict: 'hot' }, text: `Yes. {record} is not what anyone expected, and in this league that lands on the coach first. I would not be shocked by a change.` },
  { id: 'a.co.hot.b', conditions: { topic: 'coach', verdict: 'hot' }, text: `The seat is warm, and getting warmer. {coach} needs a run, and soon.` },
  { id: 'a.co.hot.c', conditions: { topic: 'coach', verdict: 'hot' }, text: `I think {coach} has a few weeks to turn it around. {record} does not buy much more time than that.` },
  { id: 'a.co.ok.a', conditions: { topic: 'coach', verdict: 'safe' }, text: `No. The results are what they are, but {coach} has the players' attention and the front office knows the roster has holes.` },
  { id: 'a.co.ok.b', conditions: { topic: 'coach', verdict: 'safe' }, text: `Not right now. It is easy to blame the coach. {record} is closer to what this roster is than people want to admit.` },
  { id: 'a.co.ok.c', conditions: { topic: 'coach', verdict: 'safe' }, text: `I don't think so. A change would be the easy headline, not the fix.` },
  /* special: {pp} {ppRank} {pk} {pkRank} {n} */
  { id: 'a.st.good.a', conditions: { topic: 'special', verdict: 'good' }, text: `It is working. {pp} on the power play, {ppRank} in the league. When it is moving the puck like this, you leave it alone.` },
  { id: 'a.st.good.b', conditions: { topic: 'special', verdict: 'good' }, text: `A strength. {pp}, {ppRank} in the league, and the penalty kill is {pkRank} at {pk}. Special teams are winning them games.` },
  { id: 'a.st.good.c', conditions: { topic: 'special', verdict: 'good' }, text: `Honestly, it is one of the best parts of this team: {pp}, {ppRank}. Enjoy it.` },
  { id: 'a.st.bad.a', conditions: { topic: 'special', verdict: 'bad' }, text: `It is a problem. {pp} on the power play, {ppRank} in the league. Too much passing on the perimeter, not enough traffic.` },
  { id: 'a.st.bad.b', conditions: { topic: 'special', verdict: 'bad' }, text: `{ppRank} in the league at {pp}. The units need a shake-up, and I expect one if it continues.` },
  { id: 'a.st.bad.c', conditions: { topic: 'special', verdict: 'bad' }, text: `Not good enough. {pp} is {ppRank}. Close games are decided on the power play, and this one is costing them.` },
  { id: 'a.st.mid.a', conditions: { topic: 'special', verdict: 'mid' }, text: `Middle of the pack: {pp}, {ppRank}. It is neither the problem nor the solution.` },
  { id: 'a.st.mid.b', conditions: { topic: 'special', verdict: 'mid' }, text: `Average. {pp} on the power play puts them {ppRank}. The penalty kill ({pk}, {pkRank}) matters just as much.` },
  { id: 'a.st.mid.c', conditions: { topic: 'special', verdict: 'mid' }, text: `Fine, not great. {ppRank} at {pp}. One more shooter on the top unit would change that.` },
  /* standout: {name} {line} {n} */
  { id: 'a.bp.a', conditions: { topic: 'standout' }, text: `{name}. {line}. It is not especially close.` },
  { id: 'a.bp.b', conditions: { topic: 'standout' }, text: `It has to be {name}: {line}. Take him out and this is a different team.` },
  { id: 'a.bp.c', conditions: { topic: 'standout' }, text: `{name}, and the numbers back it up: {line}.` },
  /* rookie: {name} {gp} {pts} {age} */
  { id: 'a.rk.up.a', conditions: { topic: 'rookie', verdict: 'up' }, text: `Better than expected. {pts} points in {gp} games at {age}. He is making it hard to send him down.` },
  { id: 'a.rk.up.b', conditions: { topic: 'rookie', verdict: 'up' }, text: `He belongs. {gp} games, {pts} points, and he does not look out of place.` },
  { id: 'a.rk.up.c', conditions: { topic: 'rookie', verdict: 'up' }, text: `I like him a lot. {pts} in {gp} at {age} is real production, not a hot week.` },
  { id: 'a.rk.flat.a', conditions: { topic: 'rookie', verdict: 'flat' }, text: `Learning. {pts} points in {gp} games is about what you expect from a {age}-year-old. The details are there, the finish is not yet.` },
  { id: 'a.rk.flat.b', conditions: { topic: 'rookie', verdict: 'flat' }, text: `It is early. {gp} games, {pts} points. I would give him the rest of the month before deciding anything.` },
  { id: 'a.rk.flat.c', conditions: { topic: 'rookie', verdict: 'flat' }, text: `Mixed. He has {pts} in {gp}. Some nights he looks ready, some nights he looks {age}.` },
  /* streak: {name} {n} {pts} */
  { id: 'a.hs.a', conditions: { topic: 'streak' }, text: `Some of it. {n} straight games with a point is a hot streak, and hot streaks end. The shot volume says he will keep producing, just not like this.` },
  { id: 'a.hs.b', conditions: { topic: 'streak' }, text: `Enjoy it while it lasts. {n} games in a row is great; the percentages will come back to earth eventually.` },
  { id: 'a.hs.c', conditions: { topic: 'streak' }, text: `The streak is at {n}. He is getting to good areas, which is the part that lasts. The streak itself will not.` },
  /* extension: {name} {age} {pts} {status} {aav} */
  { id: 'a.ex.yes.a', conditions: { topic: 'extension', verdict: 'yes' }, text: `I think so. {name} has {pts} points and he is {age}. That is a player you keep, and the cap is manageable if they want to.` },
  { id: 'a.ex.yes.b', conditions: { topic: 'extension', verdict: 'yes' }, text: `They should. He is producing, {pts} points, and replacing him in free agency costs more than keeping him.` },
  { id: 'a.ex.yes.c', conditions: { topic: 'extension', verdict: 'yes' }, text: `Yes, and I would do it before he gets to the open market. {pts} points at {age} will get paid somewhere.` },
  { id: 'a.ex.no.a', conditions: { topic: 'extension', verdict: 'no' }, text: `I have doubts. {name} is {age} and the next contract is the one teams regret. I would let him test the market.` },
  { id: 'a.ex.no.b', conditions: { topic: 'extension', verdict: 'no' }, text: `Probably not at the number he will want. {pts} points is useful, but the money is better spent elsewhere.` },
  { id: 'a.ex.no.c', conditions: { topic: 'extension', verdict: 'no' }, text: `My guess is no. They like him, but the age and the ask do not line up.` },
]

/* ═══════════════════════════════ THE DAILY ═══════════════════════════════
 * ctx:   won (bool), off (bool), trade (bool)
 * slots: {first} {nick} {yesterday} {top}
 */
export const DY_HEAD: ContentVariant[] = [
  { id: 'dy.h.a', text: `{first}'s Daily: {top}` },
  { id: 'dy.h.i', text: `{first}'s Daily: {top}, and the {nick} at {record}` },
  { id: 'dy.h.j', text: `The Daily: {top}; the {nick} sit at {record}` },
  { id: 'dy.h.b', text: `The Daily: {top}, and what it means for the {nick}` },
  { id: 'dy.h.c', text: `{first}'s Daily: {top}; around the division` },
  { id: 'dy.h.d', text: `Morning read: {top}` },
  { id: 'dy.h.e', text: `{first}'s Daily: {top}, plus the league wire` },
  { id: 'dy.h.f', text: `The Daily: {top}. Here's what else happened` },
  { id: 'dy.h.g', text: `{first}'s Daily: {top} and the rest of the news` },
  { id: 'dy.h.h', text: `Daily roundup: {top}` },
]

export const DY_LEDE: ContentVariant[] = [
  { id: 'dy.l.w.a', conditions: { won: true }, text: `Good morning. The {nick} won last night ({yesterday}), so the coffee tastes better. Here is what else you need to know.` },
  { id: 'dy.l.w.b', conditions: { won: true }, text: `Morning. Last night was {yesterday}. On to everything else.` },
  { id: 'dy.l.w.c', conditions: { won: true }, text: `Two points in the bank after {yesterday}. Plenty happened around the league while you were celebrating.` },
  { id: 'dy.l.l.a', conditions: { won: false }, text: `Morning. Last night was {yesterday}, and we will get to what went wrong. First, the rest of the league.` },
  { id: 'dy.l.l.b', conditions: { won: false }, text: `After {yesterday}, the mood around here is about what you would expect. Here is the day.` },
  { id: 'dy.l.l.c', conditions: { won: false }, text: `Not a fun night: {yesterday}. There is other news, though.` },
  { id: 'dy.l.o.a', conditions: { off: true }, text: `An off day for the {nick}. The rest of the league kept busy.` },
  { id: 'dy.l.o.b', conditions: { off: true }, text: `No game for the {nick}, so let's look around the league.` },
  { id: 'dy.l.o.c', conditions: { off: true }, text: `Quiet day at the rink. Not so quiet elsewhere.` },
]

/* Why an item on the league wire matters here. ctx: why. slots: {team} {gap} {nick} {days} */
export const DY_WHY: ContentVariant[] = [
  { id: 'why.div.a', conditions: { why: 'division' }, text: `Why it matters: the {team} are a division rival, {gap} in the standings.` },
  { id: 'why.div.b', conditions: { why: 'division' }, text: `Why it matters here: they are in the division, and {gap}.` },
  { id: 'why.div.c', conditions: { why: 'division' }, text: `Division rival. {gap}. Anything that makes them better makes this harder.` },
  { id: 'why.opp.a', conditions: { why: 'opponent' }, text: `Why it matters: the {nick} see the {team} {days}.` },
  { id: 'why.opp.b', conditions: { why: 'opponent' }, text: `Worth knowing: the {team} are on the schedule {days}.` },
  { id: 'why.opp.c', conditions: { why: 'opponent' }, text: `The {team} are up {days}, so this is not just league news.` },
  { id: 'why.race.a', conditions: { why: 'race' }, text: `Why it matters: the {team} are in the same race, {gap}.` },
  { id: 'why.race.b', conditions: { why: 'race' }, text: `The {team} are {gap} in the playoff picture. Watch them.` },
  { id: 'why.race.c', conditions: { why: 'race' }, text: `Standings neighbours: the {team}, {gap}.` },
  { id: 'why.lg.a', conditions: { why: 'league' }, text: `No direct line to the {nick}, but it moves the market.` },
  { id: 'why.lg.b', conditions: { why: 'league' }, text: `Not our team, but every move like this changes what the rest cost.` },
  { id: 'why.lg.c', conditions: { why: 'league' }, text: `League news. File it away.` },
]

/* ═══════════════════════════════ PROSPECTS ═══════════════════════════════
 * slots: {nick} {name} {league} {pts} {gp}
 */
export const PR_HEAD: ContentVariant[] = [
  { id: 'pr.h.a', text: `{nick} prospect report: {name} leads the way` },
  { id: 'pr.h.b', text: `Prospect watch: {name} and the rest of the {nick} pipeline` },
  { id: 'pr.h.c', text: `{nick} prospects: {name} is the one to watch` },
  { id: 'pr.h.d', text: `Down on the farm: {name} tops the {nick} prospect report` },
  { id: 'pr.h.e', text: `{nick} pipeline update: {name}, {pts} points in {gp}` },
  { id: 'pr.h.f', text: `Prospect report: who is pushing for a look with {nick}` },
  { id: 'pr.h.g', text: `{nick} prospects: {name} heads the list` },
  { id: 'pr.h.h', text: `How the {nick} kids are doing, starting with {name}` },
]

export const PR_LEDE: ContentVariant[] = [
  { id: 'pr.l.a', text: `A check on the players the {nick} have in the system, from the farm to junior. Points first, context after.` },
  { id: 'pr.l.b', text: `Every few weeks we look at the prospects. Here is who is moving and who is not.` },
  { id: 'pr.l.c', text: `The pipeline, updated. Some of these names will matter sooner than you think.` },
  { id: 'pr.l.d', text: `Prospect report time. The farm first, then the kids playing elsewhere.` },
]

/* ═══════════════════════════════ FEATURES (by act) ═══════════════════════════════
 * ctx: feature, plus per-feature verdicts. slots per feature in beatDesk.ts.
 */
export const FT_HEAD: ContentVariant[] = [
  { id: 'ft.tg.in.a', conditions: { feature: 'thanksgiving', inSpot: true }, text: `The Thanksgiving table: {nick} are in a playoff spot, and history likes that` },
  { id: 'ft.tg.in.b', conditions: { feature: 'thanksgiving', inSpot: true }, text: `{nick} at Thanksgiving: in position, and three of four teams here stay there` },
  { id: 'ft.tg.in.c', conditions: { feature: 'thanksgiving', inSpot: true }, text: `Thanksgiving check: {nick} {rank}, and the odds are on their side` },
  { id: 'ft.tg.out.a', conditions: { feature: 'thanksgiving', inSpot: false }, text: `The Thanksgiving table: {nick} are {gap} out, and history is not kind` },
  { id: 'ft.tg.out.b', conditions: { feature: 'thanksgiving', inSpot: false }, text: `{nick} at Thanksgiving: outside the playoff picture, and the clock is running` },
  { id: 'ft.tg.out.c', conditions: { feature: 'thanksgiving', inSpot: false }, text: `Thanksgiving check: {nick} {rank}, and teams in this spot rarely climb out` },
  { id: 'ft.hol.a', conditions: { feature: 'holiday' }, text: `Holiday freeze: no trades for the {nick}, and a {record} team at the break` },
  { id: 'ft.hol.b', conditions: { feature: 'holiday' }, text: `{nick} at the holiday break: {record}, and the roster is frozen` },
  { id: 'ft.hol.c', conditions: { feature: 'holiday' }, text: `The freeze is on. Where the {nick} stand at {record}` },
  { id: 'ft.mid.a', conditions: { feature: 'midseason' }, text: `{nick} midseason report card: {grade}` },
  { id: 'ft.mid.b', conditions: { feature: 'midseason' }, text: `Halfway: grading the {nick} at {record}` },
  { id: 'ft.mid.c', conditions: { feature: 'midseason' }, text: `{nick} at the halfway mark: a {grade}, and here is why` },
  { id: 'ft.dl.buy.a', conditions: { feature: 'deadline', stance: 'buy' }, text: `Deadline primer: the {nick} should be buyers. Here is what they need` },
  { id: 'ft.dl.buy.b', conditions: { feature: 'deadline', stance: 'buy' }, text: `{nick} deadline plan: {need}, and {space} to spend` },
  { id: 'ft.dl.buy.c', conditions: { feature: 'deadline', stance: 'buy' }, text: `Buyers: what the {nick} need before the deadline` },
  { id: 'ft.dl.sell.a', conditions: { feature: 'deadline', stance: 'sell' }, text: `Deadline primer: time for the {nick} to sell. Who goes?` },
  { id: 'ft.dl.sell.b', conditions: { feature: 'deadline', stance: 'sell' }, text: `{nick} at the deadline: sellers, and here is the list` },
  { id: 'ft.dl.sell.c', conditions: { feature: 'deadline', stance: 'sell' }, text: `Sell, but carefully: the {nick} deadline primer` },
  { id: 'ft.dl.hold.a', conditions: { feature: 'deadline', stance: 'hold' }, text: `Deadline primer: the {nick} are in between. What that means` },
  { id: 'ft.dl.hold.b', conditions: { feature: 'deadline', stance: 'hold' }, text: `{nick} deadline: neither buyer nor seller, yet` },
  { id: 'ft.dl.hold.c', conditions: { feature: 'deadline', stance: 'hold' }, text: `The {nick} at the deadline: small moves, or none` },
  { id: 'ft.push.in.a', conditions: { feature: 'push', race: 'in' }, text: `Race math: the {nick} are {gap} clear with {left} to go` },
  { id: 'ft.push.in.b', conditions: { feature: 'push', race: 'in' }, text: `{nick} playoff push: the cushion is {gap}` },
  { id: 'ft.push.in.c', conditions: { feature: 'push', race: 'in' }, text: `{left} games left, {gap} up: the {nick} race` },
  { id: 'ft.push.out.a', conditions: { feature: 'push', race: 'out' }, text: `Race math: the {nick} are {gap} back with {left} to play` },
  { id: 'ft.push.out.b', conditions: { feature: 'push', race: 'out' }, text: `{nick} playoff push: {gap} to make up` },
  { id: 'ft.push.out.c', conditions: { feature: 'push', race: 'out' }, text: `{left} games, {gap}: the {nick} chase` },
  { id: 'ft.exit.a', conditions: { feature: 'exit' }, text: `Exit day: the {nick} season, and what comes next` },
  { id: 'ft.exit.b', conditions: { feature: 'exit' }, text: `The {nick} autopsy: {record}, and the questions for summer` },
  { id: 'ft.exit.c', conditions: { feature: 'exit' }, text: `Season over. What went right and wrong for the {nick}` },
  { id: 'ft.dr.a', conditions: { feature: 'draft' }, text: `{nick} draft: {name} leads a class of {n}` },
  { id: 'ft.dr.b', conditions: { feature: 'draft' }, text: `Who the {nick} took, starting with {name}` },
  { id: 'ft.dr.c', conditions: { feature: 'draft' }, text: `{nick} draft recap: {name} and {n} others` },
  { id: 'ft.j1.busy.a', conditions: { feature: 'july1', busy: true }, text: `Free agency day one: {nick} add {name}` },
  { id: 'ft.j1.busy.b', conditions: { feature: 'july1', busy: true }, text: `July 1 tracker: {name} signs with the {nick}` },
  { id: 'ft.j1.busy.c', conditions: { feature: 'july1', busy: true }, text: `{nick} open free agency with {name}` },
  { id: 'ft.j1.quiet.a', conditions: { feature: 'july1', busy: false }, text: `July 1: a quiet day for the {nick} while the league spends` },
  { id: 'ft.j1.quiet.b', conditions: { feature: 'july1', busy: false }, text: `Free agency opens; the {nick} watch` },
  { id: 'ft.j1.quiet.c', conditions: { feature: 'july1', busy: false }, text: `The {nick} sit out the first day of free agency` },
  { id: 'ft.sum.a', conditions: { feature: 'summer' }, text: `{n} questions for {nick} camp` },
  { id: 'ft.sum.b', conditions: { feature: 'summer' }, text: `Dead of summer: {n} things the {nick} still have to sort out` },
  { id: 'ft.sum.c', conditions: { feature: 'summer' }, text: `Summer file: {n} open questions on the {nick} roster` },
  { id: 'ft.co.a', conditions: { feature: 'campOpen' }, text: `{nick} camp opens: {n} jobs, more candidates` },
  { id: 'ft.co.b', conditions: { feature: 'campOpen' }, text: `The {nick} bubble board as camp opens` },
  { id: 'ft.co.c', conditions: { feature: 'campOpen' }, text: `Camp battles: who is fighting for a {nick} roster spot` },
  { id: 'ft.cc.a', conditions: { feature: 'campCuts' }, text: `Opening-night roster: who made the {nick}, and why` },
  { id: 'ft.cc.b', conditions: { feature: 'campCuts' }, text: `The {nick} roster is set. Surprises and the ones who missed` },
  { id: 'ft.cc.c', conditions: { feature: 'campCuts' }, text: `{nick} break camp: the final roster` },
]

export const FT_LEDE: ContentVariant[] = [
  { id: 'ft.tg.l.in.a', conditions: { feature: 'thanksgiving', inSpot: true }, text: `Every year someone points it out, so it might as well be me: about three of every four teams in a playoff spot at American Thanksgiving are still in one in April. The {nick} are {rank} today with {pts} points from {gp} games.` },
  { id: 'ft.tg.l.in.b', conditions: { feature: 'thanksgiving', inSpot: true }, text: `Thanksgiving is the standings' first honest checkpoint. Roughly 76 percent of the teams holding a spot now make it. The {nick} are one of them, {rank} with {pts} points.` },
  { id: 'ft.tg.l.in.c', conditions: { feature: 'thanksgiving', inSpot: true }, text: `The {nick} sit {rank} at Thanksgiving, {pts} points in {gp} games. History says that holds three times in four.` },
  { id: 'ft.tg.l.out.a', conditions: { feature: 'thanksgiving', inSpot: false }, text: `Here is the uncomfortable number: about three of every four teams in a playoff spot at American Thanksgiving are still there in April. The {nick} are not in one. They are {rank}, {gap} back.` },
  { id: 'ft.tg.l.out.b', conditions: { feature: 'thanksgiving', inSpot: false }, text: `Teams outside the picture at Thanksgiving usually stay outside it. The {nick} are {rank} with {pts} points in {gp} games, {gap} back of a spot.` },
  { id: 'ft.tg.l.out.c', conditions: { feature: 'thanksgiving', inSpot: false }, text: `Thanksgiving is when the standings stop being early. The {nick} are {rank}, {gap} out. It can be done. It is rarely done.` },
  { id: 'ft.hol.l.a', conditions: { feature: 'holiday' }, text: `The league's holiday roster freeze is in effect: no trades, no waivers until after Christmas. The {nick} go into it at {record}.` },
  { id: 'ft.hol.l.b', conditions: { feature: 'holiday' }, text: `Nobody can make a trade for the next week, which gives everyone a chance to look at what they have. The {nick} have a {record} team.` },
  { id: 'ft.hol.l.c', conditions: { feature: 'holiday' }, text: `Holiday break. The phones go quiet by rule, and the {nick} sit at {record}.` },
  { id: 'ft.mid.l.a', conditions: { feature: 'midseason' }, text: `Half a season is enough to grade. The {nick} are {record}, {rank}. My grade is a {grade}. Here is how I got there.` },
  { id: 'ft.mid.l.b', conditions: { feature: 'midseason' }, text: `{record} at the halfway point, {rank}. Grading the team, and the players who have carried it.` },
  { id: 'ft.mid.l.c', conditions: { feature: 'midseason' }, text: `The midseason report card. {record}, {rank}, and a {grade} overall.` },
  { id: 'ft.dl.l.a', conditions: { feature: 'deadline' }, text: `The deadline is close. The {nick} are {rank} with {space} in cap space. The biggest need is {need}.` },
  { id: 'ft.dl.l.b', conditions: { feature: 'deadline' }, text: `Deadline week is coming. What the {nick} have to work with: {space} of room and a roster that needs {need}.` },
  { id: 'ft.dl.l.c', conditions: { feature: 'deadline' }, text: `{rank}, {space} of room, and a clear need at {need}. The {nick} deadline, laid out.` },
  { id: 'ft.push.l.a', conditions: { feature: 'push' }, text: `{left} games left. The {nick} have {pts} points and sit {rank}. Here is the math.` },
  { id: 'ft.push.l.b', conditions: { feature: 'push' }, text: `The stretch run is here. {pts} points, {left} to play, {rank}.` },
  { id: 'ft.push.l.c', conditions: { feature: 'push' }, text: `Every game counts from here. The {nick} have {left} left and a playoff picture that is taking shape.` },
  { id: 'ft.exit.l.a', conditions: { feature: 'exit' }, text: `The {nick} finished {record}. Players cleaned out their stalls today, and some of them finally told us what they played through.` },
  { id: 'ft.exit.l.b', conditions: { feature: 'exit' }, text: `Exit day. {record}. What went right, what did not, and what the summer has to fix.` },
  { id: 'ft.exit.l.c', conditions: { feature: 'exit' }, text: `It is over. {record}. Here is how the season looked from the press box.` },
  { id: 'ft.dr.l.a', conditions: { feature: 'draft' }, text: `The {nick} made {n} picks. Here is who they are.` },
  { id: 'ft.dr.l.b', conditions: { feature: 'draft' }, text: `Draft weekend is done. The {nick} class, pick by pick.` },
  { id: 'ft.dr.l.c', conditions: { feature: 'draft' }, text: `{n} new names in the system. Some will play. The math says most will not.` },
  { id: 'ft.j1.l.a', conditions: { feature: 'july1' }, text: `Free agency opened today. Here is the {nick} tracker, and the biggest names around the league.` },
  { id: 'ft.j1.l.b', conditions: { feature: 'july1' }, text: `The busiest day of the summer. What the {nick} did, and what everyone else did.` },
  { id: 'ft.j1.l.c', conditions: { feature: 'july1' }, text: `Day one of free agency, tracked.` },
  { id: 'ft.sum.l.a', conditions: { feature: 'summer' }, text: `It is the quiet part of the year. The roster is mostly set, which means the questions left are the hard ones.` },
  { id: 'ft.sum.l.b', conditions: { feature: 'summer' }, text: `Nothing much happens in August, so let's talk about what will happen in September.` },
  { id: 'ft.sum.l.c', conditions: { feature: 'summer' }, text: `A few questions I keep coming back to while the rinks are empty.` },
  { id: 'ft.co.l.a', conditions: { feature: 'campOpen' }, text: `Camp is open. Most of the roster is set. These are the spots that are not.` },
  { id: 'ft.co.l.b', conditions: { feature: 'campOpen' }, text: `The bubble board: players fighting for a job, and what each of them needs to show.` },
  { id: 'ft.co.l.c', conditions: { feature: 'campOpen' }, text: `There are more players than jobs. Here is how I see the battles.` },
  { id: 'ft.cc.l.a', conditions: { feature: 'campCuts' }, text: `The roster that opens the season is set. Here is who made it, who did not, and what it says.` },
  { id: 'ft.cc.l.b', conditions: { feature: 'campCuts' }, text: `Camp is over. The final decisions, and a few that surprised me.` },
  { id: 'ft.cc.l.c', conditions: { feature: 'campCuts' }, text: `Cut day is done. The opening-night group, with a word on the ones sent away.` },
]

/* ═══════════════════════════════ HOT SEAT ═══════════════════════════════
 * ctx: stage ('radar'|'backed'|'hedged'|'recovered'|'fired'), tilt
 * slots: {coach} {nick} {record} {gm} {rank} {expected}
 */
export const HS_HEAD: ContentVariant[] = [
  { id: 'hs.r.a', conditions: { stage: 'radar' }, text: `Is {coach} on the hot seat? At {record}, the question is fair` },
  { id: 'hs.r.b', conditions: { stage: 'radar' }, text: `{coach}'s seat is getting warm` },
  { id: 'hs.r.c', conditions: { stage: 'radar' }, text: `{record}, {rank}: the {coach} question arrives` },
  { id: 'hs.b.a', conditions: { stage: 'backed' }, text: `GM backs {coach}: "He has my full support"` },
  { id: 'hs.b.b', conditions: { stage: 'backed' }, text: `Vote of confidence for {coach}` },
  { id: 'hs.b.c', conditions: { stage: 'backed' }, text: `The GM stands behind {coach}, publicly` },
  { id: 'hs.h.a', conditions: { stage: 'hedged' }, text: `No vote of confidence for {coach}` },
  { id: 'hs.h.b', conditions: { stage: 'hedged' }, text: `GM declines to back {coach}: "We evaluate everything"` },
  { id: 'hs.h.c', conditions: { stage: 'hedged' }, text: `What the GM did not say about {coach}` },
  { id: 'hs.rc.a', conditions: { stage: 'recovered' }, text: `{coach} has steadied the ship` },
  { id: 'hs.rc.b', conditions: { stage: 'recovered' }, text: `The {coach} hot seat has cooled` },
  { id: 'hs.rc.c', conditions: { stage: 'recovered' }, text: `{nick} turn it around, and {coach} is off the hook` },
  { id: 'hs.f.a', conditions: { stage: 'fired' }, text: `{coach} out as {nick} coach` },
  { id: 'hs.f.b', conditions: { stage: 'fired' }, text: `{nick} fire {coach}` },
  { id: 'hs.f.c', conditions: { stage: 'fired' }, text: `The {coach} era is over` },
]

export const HS_BODY: ContentVariant[] = [
  { id: 'hs.rb.a', conditions: { stage: 'radar' }, text: `The {nick} are {record} and {rank}. Before the season this was supposed to be a {expected} team. When a gap like that opens up, the coach is the first name people say.` },
  { id: 'hs.rb.b', conditions: { stage: 'radar' }, text: `Nobody inside the building is saying it, so I will: at {record}, {coach} needs results. The preseason expectation was {expected}; they are {rank}.` },
  { id: 'hs.rb.c', conditions: { stage: 'radar' }, text: `{rank} with a roster picked for {expected}. {coach} has not lost the players, as far as I can tell. He has lost games, and that is usually enough.` },
  { id: 'hs.rb.ca', conditions: { stage: 'radar', tilt: 'critic' }, text: `{record}. The easy move is to fire {coach}. The honest question is who built a roster that was supposed to be {expected} and is {rank} instead.` },
  { id: 'hs.rb.cb', conditions: { stage: 'radar', tilt: 'critic' }, text: `{coach}'s seat is hot, and it should be. So should the one above his. {record}, {rank}.` },
  { id: 'hs.rb.cc', conditions: { stage: 'radar', tilt: 'critic' }, text: `If {coach} goes, the problem does not go with him. {record} is a roster result as much as a coaching one.` },
  { id: 'hs.bb.a', conditions: { stage: 'backed' }, text: `Asked about {coach}, the GM did not hedge: full support. It is on the record now, and it will be remembered either way.` },
  { id: 'hs.bb.b', conditions: { stage: 'backed' }, text: `The vote of confidence came without being dragged out of him. {coach} is his coach. Now the results have to back it up.` },
  { id: 'hs.bb.c', conditions: { stage: 'backed' }, text: `A public show of support for {coach}. That buys time. History says it does not buy much.` },
  { id: 'hs.hb.a', conditions: { stage: 'hedged' }, text: `The GM was asked directly whether {coach} is safe. He talked about evaluating everything. He did not say yes.` },
  { id: 'hs.hb.b', conditions: { stage: 'hedged' }, text: `"We evaluate everything, every day." That was the answer on {coach}. In this business, that is an answer.` },
  { id: 'hs.hb.c', conditions: { stage: 'hedged' }, text: `No vote of confidence. The players heard it, {coach} heard it, and so did everyone else.` },
  { id: 'hs.rcb.a', conditions: { stage: 'recovered' }, text: `A few weeks ago the question was whether {coach} would make it to the next month. The {nick} are {record} now, and nobody is asking.` },
  { id: 'hs.rcb.b', conditions: { stage: 'recovered' }, text: `{record}. The run came when it had to, and {coach} is the reason people point to.` },
  { id: 'hs.rcb.c', conditions: { stage: 'recovered' }, text: `The hot-seat talk is gone. {coach} changed a few things, and the results followed.` },
  { id: 'hs.fb.a', conditions: { stage: 'fired' }, text: `{coach} is out. The {nick} were {record}. It was not a surprise to anyone who has watched this team.` },
  { id: 'hs.fb.b', conditions: { stage: 'fired' }, text: `The GM made the change. {coach} leaves with the team at {record}.` },
  { id: 'hs.fb.c', conditions: { stage: 'fired' }, text: `{coach} has been let go. {record}, {rank}. The next man inherits the same roster.` },
]

/* ═══════════════════════════════ CLAIMS CITED BACK ═══════════════════════════════
 * ctx: claim ('playoffs'|'building'|'coachBacked'|'playerCore'), right (bool)
 * slots: {gm} {when} {quote} {name} {coach} {nick} {outcome}
 */
export const CLAIM_HEAD: ContentVariant[] = [
  { id: 'cl.po.w.a', conditions: { claim: 'playoffs', right: false }, text: `In {when}, the GM said playoff team. It was not` },
  { id: 'cl.po.w.b', conditions: { claim: 'playoffs', right: false }, text: `"A playoff team," he said. {outcome}` },
  { id: 'cl.po.w.c', conditions: { claim: 'playoffs', right: false }, text: `The playoff promise, and what happened to it` },
  { id: 'cl.po.r.a', conditions: { claim: 'playoffs', right: true }, text: `He called it in {when}: the {nick} are a playoff team` },
  { id: 'cl.po.r.b', conditions: { claim: 'playoffs', right: true }, text: `"Playoff team." The GM said it and the {nick} delivered` },
  { id: 'cl.po.r.c', conditions: { claim: 'playoffs', right: true }, text: `Credit where due: the GM's playoff call held up` },
  { id: 'cl.bu.r.a', conditions: { claim: 'building', right: true }, text: `The GM said to be patient. {outcome}` },
  { id: 'cl.bu.r.b', conditions: { claim: 'building', right: true }, text: `"Judge us later," he said in {when}. Later came early` },
  { id: 'cl.bu.r.c', conditions: { claim: 'building', right: true }, text: `The {nick} were supposed to be building. They got there sooner` },
  { id: 'cl.bu.w.a', conditions: { claim: 'building', right: false }, text: `The GM asked for patience. {outcome}` },
  { id: 'cl.bu.w.b', conditions: { claim: 'building', right: false }, text: `A building year, as advertised` },
  { id: 'cl.bu.w.c', conditions: { claim: 'building', right: false }, text: `The {nick} were building. It showed` },
  { id: 'cl.cb.w.a', conditions: { claim: 'coachBacked', right: false }, text: `Weeks after "full support", {coach} is gone` },
  { id: 'cl.cb.w.b', conditions: { claim: 'coachBacked', right: false }, text: `The vote of confidence did not last` },
  { id: 'cl.cb.w.c', conditions: { claim: 'coachBacked', right: false }, text: `What "full support" meant for {coach}` },
  { id: 'cl.cb.r.a', conditions: { claim: 'coachBacked', right: true }, text: `The GM backed {coach}, and {coach} delivered` },
  { id: 'cl.cb.r.b', conditions: { claim: 'coachBacked', right: true }, text: `The vote of confidence that held up` },
  { id: 'cl.cb.r.c', conditions: { claim: 'coachBacked', right: true }, text: `Standing by {coach} was the right call` },
  { id: 'cl.pc.w.a', conditions: { claim: 'playerCore', right: false }, text: `"A big part of what we're doing." {name} is gone` },
  { id: 'cl.pc.w.b', conditions: { claim: 'playerCore', right: false }, text: `So much for {name} being in the plans` },
  { id: 'cl.pc.w.c', conditions: { claim: 'playerCore', right: false }, text: `The GM said {name} was core. Then he moved him` },
]

export const CLAIM_BODY: ContentVariant[] = [
  { id: 'cl.b.po.w.a', conditions: { claim: 'playoffs', right: false }, text: `In {when}, the GM told us: "{quote}" The {nick} finished outside the playoffs. Nobody forgets a line like that when it goes wrong, including the people who sign the cheques.` },
  { id: 'cl.b.po.w.b', conditions: { claim: 'playoffs', right: false }, text: `"{quote}" That was the GM in {when}. {outcome} Confidence is part of the job. So is being right.` },
  { id: 'cl.b.po.w.c', conditions: { claim: 'playoffs', right: false }, text: `I went back to my notes from {when}. "{quote}" It did not happen, and he will be asked about it.` },
  { id: 'cl.b.po.r.a', conditions: { claim: 'playoffs', right: true }, text: `In {when}, the GM told us: "{quote}" Plenty of people rolled their eyes, me included. He was right.` },
  { id: 'cl.b.po.r.b', conditions: { claim: 'playoffs', right: true }, text: `"{quote}" That was {when}. The {nick} clinched. Say it with confidence and back it up: that is how you earn the benefit of the doubt.` },
  { id: 'cl.b.po.r.c', conditions: { claim: 'playoffs', right: true }, text: `He said it in {when} and got a lot of grief for it. "{quote}" Nobody is giving him grief now.` },
  { id: 'cl.b.bu.r.a', conditions: { claim: 'building', right: true }, text: `In {when} the GM said: "{quote}" The {nick} made the playoffs anyway. Nobody is complaining about being early.` },
  { id: 'cl.b.bu.r.b', conditions: { claim: 'building', right: true }, text: `"{quote}" That was the pitch. The results came a year ahead of it.` },
  { id: 'cl.b.bu.r.c', conditions: { claim: 'building', right: true }, text: `The GM managed expectations in {when}: "{quote}" Then the team beat them.` },
  { id: 'cl.b.bu.w.a', conditions: { claim: 'building', right: false }, text: `In {when}, the GM said: "{quote}" The {nick} missed the playoffs, which is what he told everyone to expect. The patience he asked for is now being spent.` },
  { id: 'cl.b.bu.w.b', conditions: { claim: 'building', right: false }, text: `"{quote}" He said it, and it played out that way. The question for next season is when building turns into winning.` },
  { id: 'cl.b.bu.w.c', conditions: { claim: 'building', right: false }, text: `No playoffs, as the GM more or less promised in {when}: "{quote}" Year two of that pitch is a harder sell.` },
  { id: 'cl.b.cb.w.a', conditions: { claim: 'coachBacked', right: false }, text: `In {when}, the GM said of {coach}: "{quote}" {coach} has now been fired. Players notice when "full support" has an expiry date.` },
  { id: 'cl.b.cb.w.b', conditions: { claim: 'coachBacked', right: false }, text: `"{quote}" That was the GM on {coach}, in {when}. The next coach will hear the same words one day, and he will know what they are worth.` },
  { id: 'cl.b.cb.w.c', conditions: { claim: 'coachBacked', right: false }, text: `The vote of confidence came in {when}: "{quote}" The firing came after. That order of events is a league tradition, and nobody respects it.` },
  { id: 'cl.b.cb.r.a', conditions: { claim: 'coachBacked', right: true }, text: `When the seat was hottest, in {when}, the GM said: "{quote}" {coach} kept his job and the team found its way. That one aged well.` },
  { id: 'cl.b.cb.r.b', conditions: { claim: 'coachBacked', right: true }, text: `"{quote}" The GM stood by {coach} in {when}. The season since has justified it.` },
  { id: 'cl.b.cb.r.c', conditions: { claim: 'coachBacked', right: true }, text: `Easy to fire the coach. Harder to say "{quote}" and mean it. The GM did, in {when}, and {coach} is still here for a reason.` },
  { id: 'cl.b.pc.w.a', conditions: { claim: 'playerCore', right: false }, text: `In {when} the GM said of {name}: "{quote}" {name} has now been moved. His former teammates were asked about it, and a couple of them had that look.` },
  { id: 'cl.b.pc.w.b', conditions: { claim: 'playerCore', right: false }, text: `"{quote}" That was about {name}, in {when}. Things change in this league. The quote does not.` },
  { id: 'cl.b.pc.w.c', conditions: { claim: 'playerCore', right: false }, text: `Remember {when}? "{quote}" {name} is gone. Every player in that locker room now knows what "core" means here.` },
]

/* ═══════════════════════ RAPPORT FRAMING (weekly column) ═══════════════════════
 * The weekly column's framing paragraph, chosen by the writer's standing with
 * the GM. ctx: tilt ('ally'|'critic'), mood ('win'|'loss'). slots: {team} {gm}
 */
export const TILT_FRAME: ContentVariant[] = [
  { id: 'tf.a.l.a', conditions: { tilt: 'ally', mood: 'loss' }, text: `A losing week is a losing week. I am not ready to hang it on the front office; the process has been sound, and the results have a way of following.` },
  { id: 'tf.a.l.b', conditions: { tilt: 'ally', mood: 'loss' }, text: `It would be easy to turn this into a verdict on how the {team} were built. I don't think it is one. Bad weeks happen to good teams.` },
  { id: 'tf.a.l.c', conditions: { tilt: 'ally', mood: 'loss' }, text: `The {team} earned some patience with how they were put together. This week spent a little of it, not all of it.` },
  { id: 'tf.a.l.d', conditions: { tilt: 'ally', mood: 'loss' }, text: `Some of this is luck, and I will keep saying so until the underlying play tells me otherwise.` },
  { id: 'tf.a.w.a', conditions: { tilt: 'ally', mood: 'win' }, text: `This is what the plan looks like when it works, and it has been working more often than not.` },
  { id: 'tf.a.w.b', conditions: { tilt: 'ally', mood: 'win' }, text: `The moves made to build the {team} look better every week. That is not luck.` },
  { id: 'tf.a.w.c', conditions: { tilt: 'ally', mood: 'win' }, text: `Credit the people who built this. The {team} are what they were designed to be.` },
  { id: 'tf.c.l.a', conditions: { tilt: 'critic', mood: 'loss' }, text: `At some point the losses stop being about the players. This roster was assembled by somebody, and that somebody should be answering questions.` },
  { id: 'tf.c.l.b', conditions: { tilt: 'critic', mood: 'loss' }, text: `I keep hearing about the process. The process is producing a losing hockey team, and that is on the front office.` },
  { id: 'tf.c.l.c', conditions: { tilt: 'critic', mood: 'loss' }, text: `You can fire the coach, you can bench the stars. The man who put the {team} together is the one who has to explain this.` },
  { id: 'tf.c.l.d', conditions: { tilt: 'critic', mood: 'loss' }, text: `This is not bad luck. This is a roster doing what a roster built like this does.` },
  { id: 'tf.c.w.a', conditions: { tilt: 'critic', mood: 'win' }, text: `A good week does not fix the holes in how the {team} were built. It covers them for a few days.` },
  { id: 'tf.c.w.b', conditions: { tilt: 'critic', mood: 'win' }, text: `Enjoy the wins. The questions about this front office did not go anywhere.` },
  { id: 'tf.c.w.c', conditions: { tilt: 'critic', mood: 'win' }, text: `The {team} won some games. I would still like to hear the plan, because I have not.` },
]

/* ═══════════════════════════ LEAGUE HOT-SEAT RADAR (feed) ═══════════════════════════
 * slots: {list} */
export const LEAGUE_RADAR: ContentVariant[] = [
  { id: 'lr.a', text: `Hot seat radar. Coaches whose teams are furthest below where they were picked: {list}. Not all of them will survive the month.` },
  { id: 'lr.b', text: `Coaches under the most pressure right now, by results against expectations: {list}.` },
  { id: 'lr.c', text: `The hot seat list, updated: {list}. Boards are watching.` },
  { id: 'lr.d', text: `If you are a head coach on this list, your phone is not ringing for good reasons: {list}.` },
]
