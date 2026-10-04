/**
 * Authored pools for the inbox's recurring beats — the lines the GM reads
 * dozens of times a season: the result mail, individual nights, injuries and
 * returns, delegated meetings, the scouting digest, report cards, ceiling
 * re-reads, anniversaries, ironman games.
 *
 * Written against a measured complaint (docs/WRITING-PASS-2026-09.md): one
 * headline per trigger, fired 10–60 times a season, read like a form letter.
 *
 * House rules, all of them learned the hard way (docs/WRITING-PASS-2026-08-26.md):
 *  - Every frequent trigger has 8+ variants at its BASE specificity, and every
 *    conditioned bucket that fires often is at least three deep (the dominance
 *    trap: under most-specific-wins, a lone conditioned line wins every time).
 *  - A headline carries its content. "Weekly scouting digest" tells the GM
 *    nothing; "Scouts flag Parekh and Cowan" tells him whether to open it.
 *  - Say what a beat writer would say. Numbers where a writer would use them,
 *    words where he would not. No stacked adjectives, no "the room" as a
 *    reflex, no sentence that only sounds like something.
 *
 * Selection goes through writeBeat (beatWriter.ts): most-specific, no-repeat
 * ledger, LRU when a pool runs dry. Pure data — no engine imports.
 */
import type { ContentVariant } from './contentEngine'

/* ═══════════════════════ the result mail: team stories ═══════════════════════
 * ctx:   kind ('comeback'|'blownLead'|'goalieRobbery'|'goalieShelled'),
 *        ot (bool — decided past regulation), playoff (bool), deficit, lead
 * slots: {us} {opp} {score} {deficit} {lead} {goalie} {saves} {shotsAgainst}
 *        {goalsAgainst} {oppShots}
 * Headline only; the body is the scoreline plus the match write-up.
 */
export const GAME_STORY_POOL: ContentVariant[] = [
  /* ── comebacks ── */
  { id: 'gs.cb.a', conditions: { kind: 'comeback' }, text: `Down {deficit}, back to win it: {score} over {opp}` },
  { id: 'gs.cb.b', conditions: { kind: 'comeback' }, text: `Rally past {opp} after falling behind by {deficit}` },
  { id: 'gs.cb.c', conditions: { kind: 'comeback' }, text: `{us} climb out of a {deficit}-goal hole against {opp}` },
  { id: 'gs.cb.d', conditions: { kind: 'comeback' }, text: `From {deficit} down to a {score} win` },
  { id: 'gs.cb.e', conditions: { kind: 'comeback' }, text: `{opp} let a {deficit}-goal lead get away` },
  { id: 'gs.cb.f', conditions: { kind: 'comeback' }, text: `Comeback win over {opp}, {score}` },
  { id: 'gs.cb.g', conditions: { kind: 'comeback' }, text: `Nobody left early: {us} erase {deficit}-goal deficit` },
  { id: 'gs.cb.h', conditions: { kind: 'comeback' }, text: `Two points from nowhere against {opp}` },
  { id: 'gs.cb.i', conditions: { kind: 'comeback' }, text: `Trailing {opp} by {deficit}, then not` },
  { id: 'gs.cb.ot.a', conditions: { kind: 'comeback', ot: true }, text: `Down {deficit}, won in overtime: {score} over {opp}` },
  { id: 'gs.cb.ot.b', conditions: { kind: 'comeback', ot: true }, text: `Rally forces extra time, and {us} take the extra point` },
  { id: 'gs.cb.ot.c', conditions: { kind: 'comeback', ot: true }, text: `{deficit}-goal deficit, overtime winner, {score}` },
  { id: 'gs.cb.big.a', conditions: { kind: 'comeback', minDeficit: 3 }, text: `Three down against {opp} and still won it` },
  { id: 'gs.cb.big.b', conditions: { kind: 'comeback', minDeficit: 3 }, text: `The comeback of the season so far: {score} over {opp}` },
  { id: 'gs.cb.big.c', conditions: { kind: 'comeback', minDeficit: 3 }, text: `{us} spot {opp} a {deficit}-goal lead and win anyway` },
  { id: 'gs.cb.po.a', conditions: { kind: 'comeback', playoff: true }, text: `Playoff comeback: {us} recover from {deficit} down to beat {opp}` },
  { id: 'gs.cb.po.b', conditions: { kind: 'comeback', playoff: true }, text: `Down {deficit} in a playoff game, and they came back` },
  { id: 'gs.cb.po.c', conditions: { kind: 'comeback', playoff: true }, text: `Playoff rally stuns {opp}, {score}` },

  /* ── collapses ── */
  { id: 'gs.bl.a', conditions: { kind: 'blownLead' }, text: `{lead}-goal lead gone in {score} loss to {opp}` },
  { id: 'gs.bl.b', conditions: { kind: 'blownLead' }, text: `{opp} come back from {lead} down to win` },
  { id: 'gs.bl.c', conditions: { kind: 'blownLead' }, text: `Up {lead}, beaten {score}` },
  { id: 'gs.bl.d', conditions: { kind: 'blownLead' }, text: `The one that got away: {score} to {opp}` },
  { id: 'gs.bl.e', conditions: { kind: 'blownLead' }, text: `A {lead}-goal cushion wasn't enough against {opp}` },
  { id: 'gs.bl.f', conditions: { kind: 'blownLead' }, text: `{us} let {opp} off the hook` },
  { id: 'gs.bl.g', conditions: { kind: 'blownLead' }, text: `Lead squandered, points gone: {score} loss to {opp}` },
  { id: 'gs.bl.h', conditions: { kind: 'blownLead' }, text: `How did that get away? {opp} win {score}` },
  { id: 'gs.bl.i', conditions: { kind: 'blownLead' }, text: `{opp} rally from {lead} behind` },
  { id: 'gs.bl.ot.a', conditions: { kind: 'blownLead', ot: true }, text: `{lead}-goal lead gone, then the extra point with it` },
  { id: 'gs.bl.ot.b', conditions: { kind: 'blownLead', ot: true }, text: `A point salvaged from a game they led by {lead}` },
  { id: 'gs.bl.ot.c', conditions: { kind: 'blownLead', ot: true }, text: `Led by {lead}, lost in extra time to {opp}` },
  { id: 'gs.bl.big.a', conditions: { kind: 'blownLead', minLead: 3 }, text: `A {lead}-goal lead, and nothing to show for it` },
  { id: 'gs.bl.big.b', conditions: { kind: 'blownLead', minLead: 3 }, text: `{opp} erase a {lead}-goal deficit to stun {us}` },
  { id: 'gs.bl.big.c', conditions: { kind: 'blownLead', minLead: 3 }, text: `Up {lead} and lost: the night everything unravelled` },
  { id: 'gs.bl.po.a', conditions: { kind: 'blownLead', playoff: true }, text: `A {lead}-goal playoff lead gets away against {opp}` },
  { id: 'gs.bl.po.b', conditions: { kind: 'blownLead', playoff: true }, text: `{opp} steal a playoff game they trailed by {lead}` },
  { id: 'gs.bl.po.c', conditions: { kind: 'blownLead', playoff: true }, text: `{us} blow a {lead}-goal playoff lead` },

  /* ── the goalie steals one ── */
  { id: 'gs.gr.a', conditions: { kind: 'goalieRobbery' }, text: `{goalie} makes {saves} saves in {score} win over {opp}` },
  { id: 'gs.gr.b', conditions: { kind: 'goalieRobbery' }, text: `Outshot, not outscored: {goalie} holds off {opp}` },
  { id: 'gs.gr.c', conditions: { kind: 'goalieRobbery' }, text: `{goalie} steals two points from {opp}` },
  { id: 'gs.gr.d', conditions: { kind: 'goalieRobbery' }, text: `{saves} saves, and {goalie} gets the win` },
  { id: 'gs.gr.e', conditions: { kind: 'goalieRobbery' }, text: `{opp} pepper {goalie} and come up short` },
  { id: 'gs.gr.f', conditions: { kind: 'goalieRobbery' }, text: `A goalie's win: {goalie} stops {saves} of {shotsAgainst}` },
  { id: 'gs.gr.g', conditions: { kind: 'goalieRobbery' }, text: `{goalie} the difference in {score} win` },
  { id: 'gs.gr.h', conditions: { kind: 'goalieRobbery' }, text: `{oppShots} shots, not enough: {goalie} frustrates {opp}` },
  { id: 'gs.gr.po.a', conditions: { kind: 'goalieRobbery', playoff: true }, text: `{goalie} stands tall in playoff win over {opp}` },
  { id: 'gs.gr.po.b', conditions: { kind: 'goalieRobbery', playoff: true }, text: `{saves} playoff saves from {goalie}` },
  { id: 'gs.gr.po.c', conditions: { kind: 'goalieRobbery', playoff: true }, text: `{goalie} wins a playoff game nearly on his own` },

  /* ── a hard night in net ──
   * Mixes goalie-framed and team-framed lines on purpose: when a club gives up
   * six, a real writer blames the goalie about half the time. */
  { id: 'gs.gs.a', conditions: { kind: 'goalieShelled' }, text: `{opp} put {goalsAgainst} past {goalie}` },
  { id: 'gs.gs.b', conditions: { kind: 'goalieShelled' }, text: `Long night in net for {goalie} in {score} loss` },
  { id: 'gs.gs.c', conditions: { kind: 'goalieShelled' }, text: `{opp} run away with it, {score}` },
  { id: 'gs.gs.d', conditions: { kind: 'goalieShelled' }, text: `Blown out by {opp}: {score}` },
  { id: 'gs.gs.e', conditions: { kind: 'goalieShelled' }, text: `{goalsAgainst} goals against, and no answers` },
  { id: 'gs.gs.f', conditions: { kind: 'goalieShelled' }, text: `{goalie} left exposed as {opp} win {score}` },
  { id: 'gs.gs.g', conditions: { kind: 'goalieShelled' }, text: `{opp} score at will in {score} rout` },
  { id: 'gs.gs.h', conditions: { kind: 'goalieShelled' }, text: `One to forget: {score} to {opp}` },
  { id: 'gs.gs.i', conditions: { kind: 'goalieShelled' }, text: `Nothing stopped {opp} tonight — {goalsAgainst} goals on {shotsAgainst} shots` },
  { id: 'gs.gs.po.a', conditions: { kind: 'goalieShelled', playoff: true }, text: `{opp} rout {us} in playoff game, {score}` },
  { id: 'gs.gs.po.b', conditions: { kind: 'goalieShelled', playoff: true }, text: `A playoff beating: {goalsAgainst} past {goalie}` },
  { id: 'gs.gs.po.c', conditions: { kind: 'goalieShelled', playoff: true }, text: `Series pressure after a {score} hammering` },
]

/* ═══════════════════════ one man's night ═══════════════════════
 * ctx:   kind ('hatTrick'|'bigNight'|'shutout'), won, minGoals (via goals), playoff,
 *        setup (assists ≥ 3 and no goals)
 * slots: {name} {namePoss} {opp} {score} {goals} {assists} {pts} {saves} {shotsAgainst}
 */
export const PLAYER_NIGHT_POOL: ContentVariant[] = [
  /* ── hat tricks, in a win ── */
  { id: 'pn.ht.a', conditions: { kind: 'hatTrick', won: true }, text: `Hat trick for {name} in {score} win over {opp}`,
    text2: `Three goals for {name}, and the {opp} spent the night trying to find him.` },
  { id: 'pn.ht.b', conditions: { kind: 'hatTrick', won: true }, text: `{name} scores three as {opp} fall {score}`,
    text2: `Three goals for {name}, and the {opp} never found a way to take him out of the game.` },
  { id: 'pn.ht.c', conditions: { kind: 'hatTrick', won: true }, text: `{namePoss} three-goal night sinks {opp}`,
    text2: `{name} had a hat trick by the end of the night, and the {opp} spent most of it trying to work out where he was going to be next.` },
  { id: 'pn.ht.d', conditions: { kind: 'hatTrick', won: true }, text: `Three for {name}`,
    text2: `{name} completed his hat trick against {opp}. Hard to ask for more from one player.` },
  { id: 'pn.ht.e', conditions: { kind: 'hatTrick', won: true }, text: `{name} does it all against {opp}`,
    text2: `A hat trick from {name} in a {score} win. He was the best player on the ice and it wasn't close.` },
  { id: 'pn.ht.f', conditions: { kind: 'hatTrick', won: true }, text: `{name} completes the hat trick`,
    text2: `{name} found the net three times against {opp}. The hats came down; the two points went in the bank.` },
  { id: 'pn.ht.g', conditions: { kind: 'hatTrick', won: true }, text: `{namePoss} hat trick carries {score} win`,
    text2: `Three goals from {name}. On a night when not much else went in, he made the difference.` },
  { id: 'pn.ht.h', conditions: { kind: 'hatTrick', won: true }, text: `{name} torches {opp} for three`,
    text2: `{name} scored three against {opp}. Their goalie will not enjoy the video session.` },
  /* ── hat tricks, wasted ── */
  { id: 'pn.htl.a', conditions: { kind: 'hatTrick', won: false }, text: `{name} scores three, and it still isn't enough`,
    text2: `A hat trick from {name}, and a loss anyway. {score} to the {opp}.` },
  { id: 'pn.htl.b', conditions: { kind: 'hatTrick', won: false }, text: `Hat trick wasted as {opp} win {score}`,
    text2: `{name} scored three. The rest of the lineup could not find a fourth, and the {opp} took the points.` },
  { id: 'pn.htl.c', conditions: { kind: 'hatTrick', won: false }, text: `{namePoss} three goals come in a losing effort`,
    text2: `It will be a strange hat trick for {name} to remember: three goals, no points, {score} to the {opp}.` },
  /* ── four or more ── */
  { id: 'pn.four.a', conditions: { kind: 'hatTrick', minGoals: 4, four: true }, text: `Four goals for {name}`,
    text2: `{name} scored {goals} against {opp}. Four-goal games come around a handful of times a season across the whole league.` },
  { id: 'pn.four.b', conditions: { kind: 'hatTrick', minGoals: 4, four: true }, text: `{name} scores {goals} against {opp}`,
    text2: `{goals} goals in one night for {name}. The {opp} had no answer for him.` },
  { id: 'pn.four.c', conditions: { kind: 'hatTrick', minGoals: 4, four: true }, text: `{goals} goals, one night: {name} runs riot`,
    text2: `{goals} goals for {name} in one night. That does not happen often.` },

  /* ── big points nights ── */
  { id: 'pn.bn.a', conditions: { kind: 'bigNight' }, text: `{pts}-point night for {name}`,
    text2: `{name} had {goals} goals and {assists} assists against {opp}.` },
  { id: 'pn.bn.b', conditions: { kind: 'bigNight' }, text: `{name} in on {pts} goals against {opp}`,
    text2: `{name} finished {goals}G, {assists}A — involved in almost everything that went right.` },
  { id: 'pn.bn.c', conditions: { kind: 'bigNight' }, text: `{name} fills the scoresheet`,
    text2: `{pts} points for {name} against {opp}: {goals} goals, {assists} assists.` },
  { id: 'pn.bn.d', conditions: { kind: 'bigNight' }, text: `{namePoss} {pts} points lead the way`,
    text2: `A {pts}-point night from {name}, who was on the ice for most of the damage against {opp}.` },
  { id: 'pn.bn.e', conditions: { kind: 'bigNight' }, text: `{name} runs the show against {opp}`,
    text2: `{goals} goals and {assists} assists for {name}. The {opp} could not find anyone to match up with him.` },
  { id: 'pn.bn.f', conditions: { kind: 'bigNight' }, text: `{name}: {goals}G, {assists}A`,
    text2: `The box score says {pts} points for {name}, and it undersells how much of the game went through him.` },
  { id: 'pn.bn.g', conditions: { kind: 'bigNight' }, text: `Big night for {name} as {opp} are handled`,
    text2: `{name} had {pts} points. When he plays like that the top of the lineup looks very different.` },
  { id: 'pn.bn.h', conditions: { kind: 'bigNight' }, text: `{name} has {pts} points in one game`,
    text2: `{name} was in on {pts} goals against {opp} — {goals} of his own, {assists} set up.` },
  { id: 'pn.bnl.a', conditions: { kind: 'bigNight', won: false }, text: `{pts} points for {name}, none for the team`,
    text2: `{name} had {goals} goals and {assists} assists and still went home with a loss. {score} to the {opp}.` },
  { id: 'pn.bnl.b', conditions: { kind: 'bigNight', won: false }, text: `{namePoss} big night ends in a loss`,
    text2: `{pts} points from {name} were not enough. The {opp} won it {score}.` },
  { id: 'pn.bnl.c', conditions: { kind: 'bigNight', won: false }, text: `{name} does his part in {score} defeat`,
    text2: `{name} was in on {pts} goals. The problem was at the other end of the ice.` },
  { id: 'pn.set.a', conditions: { kind: 'bigNight', setup: true }, text: `{name} sets up {assists} goals against {opp}`,
    text2: `No goals for {name} and it did not matter: {assists} assists, every one of them a pass somebody only had to finish.` },
  { id: 'pn.set.b', conditions: { kind: 'bigNight', setup: true }, text: `{assists} assists for {name}`,
    text2: `{name} made {assists} goals against {opp} without scoring one himself.` },
  { id: 'pn.set.c', conditions: { kind: 'bigNight', setup: true }, text: `{name} the provider against {opp}`,
    text2: `{assists} assists from {name}, who kept finding the open man all night.` },

  /* ── shutouts ── */
  { id: 'pn.so.a', conditions: { kind: 'shutout' }, text: `{name} blanks {opp}`,
    text2: `{saves} saves, no goals against. The {opp} never solved {name}.` },
  { id: 'pn.so.b', conditions: { kind: 'shutout' }, text: `Shutout for {name}: {saves} saves against {opp}`,
    text2: `{name} stopped all {saves} shots he faced for the shutout.` },
  { id: 'pn.so.c', conditions: { kind: 'shutout' }, text: `{name} stops all {saves}`,
    text2: `A shutout for {name}. The {opp} had their looks and he had an answer for every one.` },
  { id: 'pn.so.d', conditions: { kind: 'shutout' }, text: `{name} perfect in {score} win`,
    text2: `{saves} shots, {saves} saves. {name} earned his zero against {opp}.` },
  { id: 'pn.so.e', conditions: { kind: 'shutout' }, text: `Zero for {opp}`,
    text2: `{name} made {saves} saves and the {opp} never got on the board.` },
  { id: 'pn.so.f', conditions: { kind: 'shutout' }, text: `{name} shuts the door on {opp}`,
    text2: `{name} was not tested often, and when he was he stopped it. {saves} saves, shutout.` },
  { id: 'pn.so.g', conditions: { kind: 'shutout' }, text: `A {saves}-save shutout for {name}`,
    text2: `{name} kept the {opp} off the board in a {score} win.` },
  { id: 'pn.so.h', conditions: { kind: 'shutout' }, text: `{name} earns the shutout`,
    text2: `No goals allowed on {saves} shots. {name} gets the zero against {opp}.` },
  { id: 'pn.sob.a', conditions: { kind: 'shutout', minSaves: 35 }, text: `{name} stops all {saves} in a shutout`,
    text2: `{saves} saves and a shutout for {name}. The {opp} had plenty of the puck and nothing to show for it.` },
  { id: 'pn.sob.b', conditions: { kind: 'shutout', minSaves: 35 }, text: `{saves} saves, zero goals: {name} stonewalls {opp}`,
    text2: `The {opp} threw {saves} shots at {name}. He had an answer for all of them.` },
  { id: 'pn.sob.c', conditions: { kind: 'shutout', minSaves: 35 }, text: `{name} withstands {saves} shots for the shutout`,
    text2: `A busy night, and a clean one. {name} stopped {saves} against {opp}.` },
]

/* ═══════════════════════ injuries ═══════════════════════
 * ctx:   band ('dtd' ≤2 games, 'short' ≤7, 'weeks' ≤20, 'long' 21+), inGame (bool)
 * slots: {name} {games} {weeks} {injury} {area} ('upper-body'/'lower-body'/…) {opp}
 */
export const INJURY_POOL: ContentVariant[] = [
  { id: 'inj.dtd.a', conditions: { band: 'dtd' }, text: `{name} day-to-day`, text2: `{name} has {injury} and will miss {games}. Nothing the staff are worried about.` },
  { id: 'inj.dtd.b', conditions: { band: 'dtd' }, text: `{name} to miss {games}`, text2: `{name} is dealing with {injury}. Expect him back after {games}.` },
  { id: 'inj.dtd.c', conditions: { band: 'dtd' }, text: `{name} sits with {area}`, text2: `{name} is out for {games} with {injury}. Short-term.` },
  { id: 'inj.dtd.d', conditions: { band: 'dtd' }, text: `Short absence for {name}`, text2: `{injury} will keep {name} out for {games}.` },
  { id: 'inj.short.a', conditions: { band: 'short' }, text: `{name} out {games}`, text2: `{name} has {injury}. The medical staff have him missing {games}.` },
  { id: 'inj.short.b', conditions: { band: 'short' }, text: `{name} sidelined with {area}`, text2: `{name} is out with {injury} and is expected to miss {games}.` },
  { id: 'inj.short.c', conditions: { band: 'short' }, text: `{name} expected to miss {games}`, text2: `It is {injury}. {name} should be back in a week or two.` },
  { id: 'inj.short.d', conditions: { band: 'short' }, text: `{name} week-to-week`, text2: `{name} has {injury}; the estimate is {games}.` },
  { id: 'inj.weeks.a', conditions: { band: 'weeks' }, text: `{name} out about {weeks} weeks`, text2: `{name} has {injury}. The club expects him to miss {games}.` },
  { id: 'inj.weeks.b', conditions: { band: 'weeks' }, text: `Blow for the lineup: {name} out {games}`, text2: `{name} will miss {games} with {injury}, which is roughly {weeks} weeks on the calendar.` },
  { id: 'inj.weeks.c', conditions: { band: 'weeks' }, text: `{name} faces a {weeks}-week absence`, text2: `{injury} for {name}. Someone else will have to take his minutes for a while.` },
  { id: 'inj.weeks.d', conditions: { band: 'weeks' }, text: `{area} sidelines {name} for weeks`, text2: `{name} is out with {injury}. The timeline is {games}.` },
  { id: 'inj.long.a', conditions: { band: 'long' }, text: `{name} out long-term`, text2: `{name} has {injury} and is expected to miss {games}. That is a big part of the season.` },
  { id: 'inj.long.b', conditions: { band: 'long' }, text: `Serious injury for {name}`, text2: `{name} will miss {games} with {injury}. The club will need a plan for the months without him.` },
  { id: 'inj.long.c', conditions: { band: 'long' }, text: `{name} faces a long road back`, text2: `{injury}, and a projected {games} on the sidelines for {name}.` },
  { id: 'inj.long.d', conditions: { band: 'long' }, text: `{name} lost for {games}`, text2: `{name} has {injury}. Roughly {weeks} weeks before he is back.` },
  /* went down during the game — the headline says so */
  { id: 'inj.ig.a', conditions: { inGame: true }, text: `{name} hurt against {opp}, out {games}`, text2: `{name} left the game and did not return. It is {injury}; he is expected to miss {games}.` },
  { id: 'inj.ig.b', conditions: { inGame: true }, text: `{name} leaves game with {area}`, text2: `{name} went down the tunnel and did not come back. It is {injury}; he is out {games}.` },
  { id: 'inj.ig.c', conditions: { inGame: true }, text: `{name} did not finish the game`, text2: `{name} came off hurt against {opp}. The diagnosis is {injury}, and the estimate is {games}.` },
]

/** Turn the engine's injury description into words that sit in a sentence.
 *  The raw strings are notes ("blocked a shot — bruised foot", "tweaked his
 *  back", "flu"): put straight after "a" they produced "suffered a flu" and
 *  "suffered a tweaked his back". */
const INJURY_NOUNS: Record<string, string> = {
  'blocked a shot — bruised foot': 'a bruised foot from a blocked shot',
  'knee-on-knee collision — sprained MCL': 'a sprained MCL from a knee-on-knee hit',
  'caught a rut — sprained ankle': 'a sprained ankle',
  'groin strain on a stretch save': 'a groin strain',
  'hip pointer after a hit': 'a hip pointer',
  'tweaked a knee on an awkward fall': 'a knee injury',
  'charley horse from a slash': 'a charley horse',
  'lower-body injury': 'a lower-body injury',
  'separated shoulder on a hit': 'a separated shoulder',
  'broken finger blocking a shot': 'a broken finger',
  'wrist injury after a slash': 'a wrist injury',
  'hand injury in a fight': 'a hand injury',
  'bruised ribs from a hit': 'bruised ribs',
  'tweaked his back': 'a back injury',
  'upper-body injury': 'an upper-body injury',
  flu: 'the flu',
  'a virus': 'a virus',
  'food poisoning': 'food poisoning',
  illness: 'an illness',
  'concussion after a blindside hit': 'a concussion',
  'concussion protocol following a fight': 'a concussion',
  'concussion from a hit to the head': 'a concussion',
  concussion: 'a concussion',
}

export function injuryNoun(description: string): string {
  const known = INJURY_NOUNS[description]
  if (known) return known
  const d = description.trim()
  if (/^(a|an|the)\s/i.test(d)) return d
  return /^[aeiou]/i.test(d) ? `an ${d}` : `a ${d}`
}

/** What a club says publicly: body region, not diagnosis. */
export function injuryArea(kind: string): string {
  return kind === 'upperBody' ? 'upper-body injury' : kind === 'lowerBody' ? 'lower-body injury' : kind === 'concussion' ? 'head injury' : 'illness'
}

export function injuryBand(games: number): 'dtd' | 'short' | 'weeks' | 'long' {
  return games <= 2 ? 'dtd' : games <= 7 ? 'short' : games <= 20 ? 'weeks' : 'long'
}

/** The Scouting screen's projection chip ("Top-six F", "#1 D", "1B / Tandem")
 *  in the words a scout would say out loud. A UI label is not prose. */
export function roleInWords(short: string): string {
  const MAP: Record<string, string> = {
    'Franchise G': 'a franchise goalie',
    Starter: 'a starting goalie',
    '1B / Tandem': 'a 1B goalie',
    Backup: 'a backup goalie',
    'AHL G': 'an AHL goalie',
    '#1 D': 'a No. 1 defenceman',
    'Top-pair D': 'a top-pair defenceman',
    '2nd-pair D': 'a second-pair defenceman',
    '3rd-pair D': 'a third-pair defenceman',
    'Depth D': 'a depth defenceman',
    'AHL D': 'an AHL defenceman',
    'Franchise F': 'a franchise forward',
    'First-line F': 'a first-line forward',
    'Top-six F': 'a top-six forward',
    'Middle-six F': 'a middle-six forward',
    'Bottom-six F': 'a bottom-six forward',
    'AHL F': 'an AHL forward',
  }
  return MAP[short] ?? `a ${short.toLowerCase()}`
}

/* ═══════════════════════ back from injury ═══════════════════════
 * ctx: rusty (bool — expect games to shake it off), long (bool — out 8+)
 * slots: {name} {rust}
 */
export const RETURN_POOL: ContentVariant[] = [
  { id: 'ret.a', text: `{name} cleared to play`, text2: `{name} has been cleared and is available again.` },
  { id: 'ret.b', text: `{name} back in the lineup`, text2: `{name} is healthy and ready to go.` },
  { id: 'ret.c', text: `{name} returns from injury`, text2: `The medical staff have signed off on {name}. He is available tonight.` },
  { id: 'ret.d', text: `{name} good to go`, text2: `{name} is off the injury report.` },
  { id: 'ret.r.a', conditions: { rusty: true }, text: `{name} back, and a little rusty`, text2: `{name} is cleared. After that much time off, expect about {rust} before he looks like himself.` },
  { id: 'ret.r.b', conditions: { rusty: true }, text: `{name} returns, rust and all`, text2: `{name} is available again. The staff think it will take {rust} to get his timing back.` },
  { id: 'ret.r.c', conditions: { rusty: true }, text: `{name} cleared after weeks out`, text2: `{name} has been given the all-clear. He has not played in a while — give him {rust}.` },
  { id: 'ret.r.d', conditions: { rusty: true }, text: `Welcome back, {name}`, text2: `{name} is healthy. Match fitness is another matter: figure {rust} before he is at full speed.` },
]

/* ═══════════════════════ the delegated meeting ═══════════════════════
 * The headline is the first thing the staff actually did.
 * ctx: meeting ('staff'|'scout'), more (bool — more than one decision)
 * slots: {first} {n} {delegate}
 */
export const DELEGATED_MEETING_POOL: ContentVariant[] = [
  { id: 'dm.st.a', conditions: { meeting: 'staff' }, text: `Staff meeting: {first}` },
  { id: 'dm.st.b', conditions: { meeting: 'staff' }, text: `From the staff meeting — {first}` },
  { id: 'dm.st.c', conditions: { meeting: 'staff' }, text: `{delegate} ran the meeting: {first}` },
  { id: 'dm.st.d', conditions: { meeting: 'staff' }, text: `Handled in your absence: {first}` },
  { id: 'dm.st.m.a', conditions: { meeting: 'staff', more: true }, text: `Staff meeting: {first}, and {n} more` },
  { id: 'dm.st.m.b', conditions: { meeting: 'staff', more: true }, text: `{delegate} made {total} calls, starting with {first}` },
  { id: 'dm.st.m.c', conditions: { meeting: 'staff', more: true }, text: `Staff decisions: {first} (+{n})` },
  { id: 'dm.sc.a', conditions: { meeting: 'scout' }, text: `Scouting meeting: {first}` },
  { id: 'dm.sc.b', conditions: { meeting: 'scout' }, text: `{delegate} ran the scouts' meeting: {first}` },
  { id: 'dm.sc.c', conditions: { meeting: 'scout' }, text: `Recruitment call made for you: {first}` },
  { id: 'dm.sc.m.a', conditions: { meeting: 'scout', more: true }, text: `Scouting meeting: {first}, and {n} more` },
  { id: 'dm.sc.m.b', conditions: { meeting: 'scout', more: true }, text: `{delegate} settled {total} scouting items` },
  { id: 'dm.sc.m.c', conditions: { meeting: 'scout', more: true }, text: `Scouts' decisions: {first} (+{n})` },
]

/* ═══════════════════════ the weekly scouting digest ═══════════════════════
 * Only written when the week actually produced a name.
 * ctx: count (new names), star (bool — an A+ among them)
 * slots: {a} {b} {n} {rest} {total}
 */
export const SCOUT_DIGEST_POOL: ContentVariant[] = [
  { id: 'sd.one.a', conditions: { count: 1 }, text: `Scouts flag {a}` },
  { id: 'sd.one.b', conditions: { count: 1 }, text: `One new name this week: {a}` },
  { id: 'sd.one.c', conditions: { count: 1 }, text: `{a} added to the list` },
  { id: 'sd.one.d', conditions: { count: 1 }, text: `Scouting week: {a} gets a look` },
  { id: 'sd.two.a', conditions: { count: 2 }, text: `Scouts flag {a} and {b}` },
  { id: 'sd.two.b', conditions: { count: 2 }, text: `{a}, {b} added to the scouting list` },
  { id: 'sd.two.c', conditions: { count: 2 }, text: `Two new names: {a} and {b}` },
  { id: 'sd.many.a', conditions: { minCount: 3 }, text: `{a}, {b} and {rest} more flagged this week` },
  { id: 'sd.many.b', conditions: { minCount: 3 }, text: `Scouting week: {total} new names, led by {a}` },
  { id: 'sd.many.c', conditions: { minCount: 3 }, text: `{a} heads this week's {total} scouting finds` },
  { id: 'sd.many.d', conditions: { minCount: 3 }, text: `Busy week for the scouts: {a}, {b} and others` },
  { id: 'sd.star.a', conditions: { star: true }, text: `Scouts are excited about {a}` },
  { id: 'sd.star.b', conditions: { star: true }, text: `Top grade for {a} in this week's scouting` },
  { id: 'sd.star.c', conditions: { star: true }, text: `{a} is the name from the scouting trail this week` },
]

/* ═══════════════════════ a scout's full report on one player ═══════════════════════
 * ctx:   group ('F'|'D'|'G'), young (bool — 23 and under)
 * slots: {name} {pos} {age} {role} {club}
 * {role} is the scout's projection in words ("a top-six forward").
 */
export const SCOUT_REPORT_POOL: ContentVariant[] = [
  { id: 'sr.a', text: `Scout report: {name}` },
  { id: 'sr.b', text: `Full report in on {name}` },
  { id: 'sr.c', text: `{name} ({pos}, {club}): the report` },
  { id: 'sr.d', text: `Our read on {name}: {role}` },
  { id: 'sr.e', text: `{name}, {age}, scouted in full` },
  { id: 'sr.f', text: `The scouts have seen enough of {name}` },
  { id: 'sr.g', text: `{name} projects as {role}, says the report` },
  { id: 'sr.h', text: `Report filed: {name}, {club}` },
  { id: 'sr.y.a', conditions: { young: true }, text: `{name}, {age}: the ceiling is {role}` },
  { id: 'sr.y.b', conditions: { young: true }, text: `Scouting {name}, {age}, of {club}` },
  { id: 'sr.y.c', conditions: { young: true }, text: `Young {pos} {name} gets the full report` },
  { id: 'sr.g.a', conditions: { group: 'G' }, text: `Goalie report: {name}, {club}` },
  { id: 'sr.g.b', conditions: { group: 'G' }, text: `The goalie scouts on {name}` },
  { id: 'sr.g.c', conditions: { group: 'G' }, text: `{name} in net: the full read` },
]

/* ═══════════════════════ the ceiling re-read ═══════════════════════
 * Only a young player has a ceiling to move; a 33-year-old's is his level.
 * ctx: dir ('up'|'down'), own (bool — our organisation)
 * slots: {name} {role} {age}
 */
export const CEILING_POOL: ContentVariant[] = [
  { id: 'cl.up.a', conditions: { dir: 'up' }, text: `Scouts raise their ceiling on {name}`,
    text2: `The read on {name} has moved up. The staff now see {role} in him.` },
  { id: 'cl.up.b', conditions: { dir: 'up' }, text: `{name} is better than we thought`,
    text2: `Another look at {name}, {age}, and the projection is higher: {role}.` },
  { id: 'cl.up.c', conditions: { dir: 'up' }, text: `Stock rising: {name}`,
    text2: `{name} has given the scouts reason to revise upward. They now have him as {role}.` },
  { id: 'cl.up.d', conditions: { dir: 'up' }, text: `New projection for {name}: {role}`,
    text2: `The latest reports on {name} are the best yet.` },
  { id: 'cl.upo.a', conditions: { dir: 'up', own: true }, text: `{name} is outgrowing his projection`,
    text2: `The development staff have bumped their long-term read on {name}. They now see {role}.` },
  { id: 'cl.upo.b', conditions: { dir: 'up', own: true }, text: `Good news on {name}`,
    text2: `{name}, {age}, has moved his own ceiling. The staff's projection is now {role}.` },
  { id: 'cl.upo.c', conditions: { dir: 'up', own: true }, text: `Staff revise {name} upward`,
    text2: `The progress is real: {name} now projects as {role}.` },
  { id: 'cl.dn.a', conditions: { dir: 'down' }, text: `Doubts grow over {namePoss} ceiling`,
    text2: `The staff have tempered their long-term read on {name}. {role} is now the projection.` },
  { id: 'cl.dn.b', conditions: { dir: 'down' }, text: `Scouts cool on {name}`,
    text2: `A closer look at {name} has brought the projection down to {role}.` },
  { id: 'cl.dn.c', conditions: { dir: 'down' }, text: `{name} projection revised down`,
    text2: `The reports on {name} have been less encouraging. The staff now have him as {role}.` },
  { id: 'cl.dn.d', conditions: { dir: 'down' }, text: `Lower ceiling for {name}`,
    text2: `{name}, {age}, is not tracking the way the scouts hoped. Revised projection: {role}.` },
  { id: 'cl.dno.a', conditions: { dir: 'down', own: true }, text: `{name} has stalled`,
    text2: `The development staff have lowered their long-term read on {name}. They now see {role}.` },
  { id: 'cl.dno.b', conditions: { dir: 'down', own: true }, text: `Staff temper expectations for {name}`,
    text2: `{name} has not taken the step the staff expected. Projection: {role}.` },
  { id: 'cl.dno.c', conditions: { dir: 'down', own: true }, text: `Concern over {namePoss} development`,
    text2: `The staff have revised {name} down to {role}. There is time, but the curve has flattened.` },
]

/* ═══════════════════════ the anniversary ═══════════════════════
 * The headline IS the memory. ctx: kind (chronicle kind), years (1, or more)
 * slots: {what} (the chronicle headline) {years}
 */
export const ANNIVERSARY_POOL: ContentVariant[] = [
  { id: 'an.a', text: `A year ago today: {what}`, text2: `{what}. It has been a year.` },
  { id: 'an.b', text: `On this day last season: {what}`, text2: `{what}. One year on.` },
  { id: 'an.c', text: `Remember this? {what}`, text2: `{what} — a year ago today.` },
  { id: 'an.d', text: `One year ago: {what}`, text2: `{what}. Twelve months later, it still comes up.` },
  { id: 'an.m.a', conditions: { minYears: 2 }, text: `{years} years ago today: {what}`, text2: `{what}. {years} years on.` },
  { id: 'an.m.b', conditions: { minYears: 2 }, text: `On this day, {years} years back: {what}`, text2: `{what}. {years} years, already.` },
  { id: 'an.m.c', conditions: { minYears: 2 }, text: `From the archive, {years} years ago: {what}`, text2: `{what}, {years} years ago today.` },
  { id: 'an.c.a', conditions: { kind: 'championship' }, text: `Cup anniversary: {what}`, text2: `{what}. The banner is still up there.` },
  { id: 'an.c.b', conditions: { kind: 'championship' }, text: `On this day: {what}`, text2: `{what}. Nobody in this building has forgotten.` },
  { id: 'an.c.c', conditions: { kind: 'championship' }, text: `Anniversary: {what}`, text2: `{what}. Some nights stay with a club.` },
]

/* ═══════════════════════ games-played milestones ═══════════════════════
 * ctx: n (500 / 1000 / 1500), own (bool)
 * slots: {name} {n} {pos} {team}
 */
export const GAMES_MILESTONE_POOL: ContentVariant[] = [
  { id: 'gm.a', text: `{name} plays his {nth} NHL game`, text2: `{name} ({pos}, {team}) reached {n} NHL games.` },
  { id: 'gm.b', text: `Game {n} for {name}`, text2: `{name} of the {team} has now played {n} games in the NHL.` },
  { id: 'gm.c', text: `{name} hits {n} games`, text2: `{n} NHL games for {name}. It takes durability and a coach who keeps putting you out there.` },
  { id: 'gm.d', text: `{n} and counting for {name}`, text2: `{name} ({team}) dressed for his {nth} NHL game.` },
  { id: 'gm.k.a', conditions: { minN: 1000 }, text: `{name} reaches {n} games`, text2: `{name} became the latest to reach {n} NHL games. It is a short list, and a long career.` },
  { id: 'gm.k.b', conditions: { minN: 1000 }, text: `{nth} game for {name}`, text2: `{n} games. {name} ({pos}, {team}) has been in the league long enough to see most of it change around him.` },
  { id: 'gm.k.c', conditions: { minN: 1000 }, text: `{name} joins the {n}-game club`, text2: `{name} played his {nth} NHL game. Not many get there.` },
  { id: 'gm.o.a', conditions: { own: true }, text: `{nth} NHL game for {name}`, text2: `{name} reached {n} NHL games tonight.` },
  { id: 'gm.o.b', conditions: { own: true }, text: `{name} marks game {n}`, text2: `{n} NHL games for {name}. He has earned every one.` },
  { id: 'gm.o.c', conditions: { own: true }, text: `Milestone night: {name} plays game {n}`, text2: `{name} played his {nth} NHL game, and the club made a point of noticing.` },
]

/* ═══════════════════════ a marquee free agent signs elsewhere ═══════════════════════
 * Avoid "signs with": the inbox curation reads it as depth-signing churn.
 * ctx: long (bool — 6+ years), big (bool — $9M+ a season)
 * slots: {team} {name} {pos} {age} {years} {aav} {total}  ({aav} like "$7.95 million"; {total}, the deal's
 *        whole value rounded the way a headline rounds it: "$56 million")
 */
export const UFA_SIGNING_POOL: ContentVariant[] = [
  { id: 'ufa.a', text: `{team} land {name}`, text2: `{team} have signed {name} ({pos}, {age}) for {term} at {aav} a season. One of the summer's bigger names is gone.` },
  { id: 'ufa.b', text: `{name} picks {team}`, text2: `{name} ({pos}, {age}) has chosen {team}: {term}, {aav} a season.` },
  { id: 'ufa.c', text: `Done deal: {name} to {team}`, text2: `{term} at {aav} per season for {name}, {age}. That is one fewer name on the market.` },
  { id: 'ufa.d', text: `{team} add {name} on a {years}-year deal`, text2: `{name} ({pos}, {age}) joins {team} at {aav} a season.` },
  { id: 'ufa.e', text: `{name} off the market`, text2: `{team} got him: {term}, {aav} a year for the {age}-year-old {pos}.` },
  { id: 'ufa.f', text: `{team} win the race for {name}`, text2: `{name} ({pos}, {age}) is going to {team} on a {years}-year contract worth {aav} a season.` },
  { id: 'ufa.g', text: `{name} to {team}: {term}, {total}`, text2: `{aav} a season. One of the names every contender called about has made his choice.` },
  { id: 'ufa.h', text: `{team} make their summer splash with {name}`, text2: `{name}, {age}, signs on for {term} at {aav} a season.` },
  { id: 'ufa.long.a', conditions: { long: true }, text: `{team} commit {term} to {name}`, text2: `A long one: {term} at {aav} a season for {name}, who is {age}.` },
  { id: 'ufa.long.b', conditions: { long: true }, text: `{name} signs long-term with {team}`, text2: `{term}, {aav} a year. {team} are betting on {name} for a long time.` },
  { id: 'ufa.long.c', conditions: { long: true }, text: `{name} gets his term — {term} from {team}`, text2: `{name} ({pos}, {age}) wanted term and got it: {term} at {aav} a season.` },
]

/* ═══════════════════════ the trade column: where the new man slots in ═══════════════════════
 * ctx: tier ('top' — top-six / top-pair or better; 'mid' — everyone else)
 * slots: {name} {caliber}  ({caliber} like "a top-six forward")
 */
export const TRADE_SLOT_POOL: ContentVariant[] = [
  { id: 'ts.top.a', conditions: { tier: 'top' }, text: `{name} — {caliber} — walks straight into the top of the lineup.` },
  { id: 'ts.top.b', conditions: { tier: 'top' }, text: `{name} is {caliber}, and he will play like one here from his first shift.` },
  { id: 'ts.top.c', conditions: { tier: 'top' }, text: `They added {caliber} in {name}, and the top of the lineup looks different tonight.` },
  { id: 'ts.mid.a', conditions: { tier: 'mid' }, text: `{name} is {caliber}: not a headline act, but a real piece of the lineup.` },
  { id: 'ts.mid.b', conditions: { tier: 'mid' }, text: `{name}, {caliber}, fills a hole they have been talking about for weeks.` },
  { id: 'ts.mid.c', conditions: { tier: 'mid' }, text: `{name} is {caliber}. Useful, dependable, and exactly the kind of player contenders go looking for.` },
]

/** Money the way a reporter prints it: "$7.95 million", "$850,000" — not a
 *  spreadsheet cell ("$7.95M × 7"). */
export function moneyWords(dollars: number): string {
  // One decimal: the owner has objected to two-decimal figures in prose more
  // than once ("a spreadsheet leaking"); the exact number is on the contract
  // screen, and "$8.97 million" reads as a cell, "$9 million" as a sentence.
  if (dollars >= 1_000_000) return `$${Number((dollars / 1e6).toFixed(1))} million`
  return `$${Math.round(dollars / 1000) * 1000 >= 1000 ? (Math.round(dollars / 1000) * 1000).toLocaleString('en-US') : Math.round(dollars)}`
}

/** A deal's headline number: total value, rounded the way a headline rounds
 *  it ("$56 million"). The exact per-season figure lives in the body. */
export function moneyTotal(dollars: number): string {
  if (dollars >= 1_000_000) return `$${Math.round(dollars / 1e6)} million`
  return moneyWords(dollars)
}

/* ═══════════════════════ your contract offer is out ═══════════════════════
 * slots: {name} {namePoss} {years} {aav} {total} {agent}   ({aav} like "$4.25 million", {total} "$13 million")
 */
export const OFFER_TABLED_POOL: ContentVariant[] = [
  { id: 'ot.a', text: `Offer tabled to {name}` },
  { id: 'ot.b', text: `{term}, {total} on the table for {name}` },
  { id: 'ot.c', text: `{agent} takes your offer to {name}` },
  { id: 'ot.d', text: `{namePoss} camp has your offer` },
  { id: 'ot.e', text: `Waiting on {name}: {term}, {total}` },
  { id: 'ot.f', text: `{name} weighing a {years}-year offer` },
  { id: 'ot.g', text: `The ball is in {namePoss} court` },
  { id: 'ot.h', text: `Your offer to {name} is in` },
]

/* ═══════════════════════ another club calls with a trade ═══════════════════════
 * ctx: swap (bool — they offer a named player), pickOnly (bool — they want a pick, no player)
 * slots: {club} {target} {theirs}
 */
export const INCOMING_OFFER_POOL: ContentVariant[] = [
  { id: 'io.a', text: `{club} call about {target}` },
  { id: 'io.b', text: `{club} want {target}` },
  { id: 'io.c', text: `Trade offer from {club} for {target}` },
  { id: 'io.d', text: `Interest in {target} from {club}` },
  { id: 'io.e', text: `{club} make a pitch for {target}` },
  { id: 'io.s.a', conditions: { swap: true }, text: `{club} offer {theirs} for {target}` },
  { id: 'io.s.b', conditions: { swap: true }, text: `{theirs} for {target}? {club} are asking` },
  { id: 'io.s.c', conditions: { swap: true }, text: `{club} dangle {theirs} in a call about {target}` },
  { id: 'io.p.a', conditions: { pickOnly: true }, text: `{club} ask about your {target}` },
  { id: 'io.p.b', conditions: { pickOnly: true }, text: `{club} want your {target}` },
  { id: 'io.p.c', conditions: { pickOnly: true }, text: `Trade offer from {club} for your {target}` },
]

/* ═══════════════════════ the AGM clears the trade desk ═══════════════════════
 * ctx: many (bool)
 * slots: {agm} {club} {clubPoss} {n} {clubs}
 */
export const AGM_PASS_POOL: ContentVariant[] = [
  { id: 'ap.a', text: `{agm} passes on {clubPoss} offer` },
  { id: 'ap.b', text: `{agm} turns down {club}` },
  { id: 'ap.c', text: `No deal with {club}, says {agm}` },
  { id: 'ap.d', text: `{club} offer declined` },
  { id: 'ap.m.a', conditions: { many: true }, text: `{agm} passes on {n} offers` },
  { id: 'ap.m.b', conditions: { many: true }, text: `{agm} clears the desk: {clubs} turned away` },
  { id: 'ap.m.c', conditions: { many: true }, text: `{n} offers, no deals — {agm} handled the phones` },
]

/* ═══════════════════════ a fight, told inside the result mail ═══════════════════════
 * slots: {ours} {theirs} {opp}
 */
export const FIGHT_LINE_POOL: ContentVariant[] = [
  { id: 'fl.a', text: `{ours} and {theirs} fought; five minutes each.` },
  { id: 'fl.b', text: `{ours} dropped the gloves with {theirs}.` },
  { id: 'fl.c', text: `There was a fight, too: {ours} against {theirs}.` },
  { id: 'fl.d', text: `{ours} and {theirs} went at it, and both sat for five.` },
  { id: 'fl.e', text: `{ours} took on {theirs} at one point; both got majors.` },
]

/* ═══════════════════════ a scout's note on a flagged prospect ═══════════════════════
 * Stored on the recommendation and read back in digests and the Centre, so it
 * is chosen with pickStable (by player id), never the ledger.
 * ctx: band ('elite'|'high'|'solid'), draft (bool), group ('F'|'D'|'G')
 * slots: {role}
 */
export const SCOUT_NOTE_POOL: ContentVariant[] = [
  { id: 'sn.e.a', conditions: { band: 'elite' }, text: `Projects as {role}. One of the better ones we have seen this year.` },
  { id: 'sn.e.b', conditions: { band: 'elite' }, text: `Ceiling: {role}. Worth a lot of travel to see again.` },
  { id: 'sn.e.c', conditions: { band: 'elite' }, text: `The real thing: {role} if he stays on track.` },
  { id: 'sn.e.d', conditions: { band: 'elite' }, text: `{age} and already doing it against older players. {role} is the ceiling.` },
  { id: 'sn.e.e', conditions: { band: 'elite' }, text: `Best player on the ice most nights for {club}. Projects as {role}.` },
  { id: 'sn.h.a', conditions: { band: 'high' }, text: `Projects as {role}. Worth following closely.` },
  { id: 'sn.h.b', conditions: { band: 'high' }, text: `The tools say {role}. The consistency isn't there yet.` },
  { id: 'sn.h.d', conditions: { band: 'high' }, text: `{age}, with {club}. Has the tools for {role}.` },
  { id: 'sn.h.e', conditions: { band: 'high' }, text: `A fair projection at {age}: {role}. Keep watching.` },
  { id: 'sn.h.c', conditions: { band: 'high' }, text: `We see {role} in him.` },
  { id: 'sn.s.a', conditions: { band: 'solid' }, text: `Projects as {role}. A useful player if not a star.` },
  { id: 'sn.s.b', conditions: { band: 'solid' }, text: `Likely {role}. Safe more than spectacular.` },
  { id: 'sn.s.c', conditions: { band: 'solid' }, text: `The realistic outcome is {role}, and that has value.` },
  { id: 'sn.s.d', conditions: { band: 'solid' }, text: `{age}-year-old with {club}. Ceiling of {role}.` },
  { id: 'sn.s.e', conditions: { band: 'solid' }, text: `Not flashy. Looks like {role} down the line.` },
  { id: 'sn.d.a', conditions: { band: 'elite', draft: true }, text: `Top of the draft conversation. Projects as {role}.` },
  { id: 'sn.d.b', conditions: { band: 'elite', draft: true }, text: `A first-round talent with the ceiling of {role}.` },
  { id: 'sn.d.c', conditions: { band: 'elite', draft: true }, text: `If he's there when we pick, we take him. Looks like {role} in the making.` },
  { id: 'sn.dh.a', conditions: { band: 'high', draft: true }, text: `Draft-eligible, projects as {role}.` },
  { id: 'sn.dh.b', conditions: { band: 'high', draft: true }, text: `One for the draft list: could be {role}.` },
  { id: 'sn.dh.c', conditions: { band: 'high', draft: true }, text: `Should go early. Reaching {role} is realistic.` },
]
