/**
 * THE BOOTH'S LINE LIBRARY — name-agnostic stems, keyed by moment + intensity.
 *
 * Two fixed voices (booth.config.json): Graham Whitlock on play-by-play, Dale
 * Brennan on colour. Every line here is PRE-RENDERED to audio at build time
 * (scripts/dev/render-commentary.mjs); nothing is synthesised live during play.
 *
 * NAME SLOT RULES (enforced by commentaryLibrary.test.ts):
 *  - at most one `{name}` per line, and only at the very START ("lead") or the
 *    very END ("tail") — so a line is stitched as [name][stem] or [stem][name]
 *    with no mid-sentence splice;
 *  - a line with a name slot MUST carry `bare`: the same call without the name,
 *    played (as its own clip) when tonight's name clip isn't rendered yet.
 *    A cue never waits for a name.
 *  - `nameForm`: 'surname' by default (the way real booths talk); 'full' only
 *    for introductions and the biggest moments.
 *  - `nameStyle`: the inflection of the name clip, matched to the stem's energy
 *    so a stitched name doesn't sound pasted in.
 *
 * No runtime imports: the Node build script loads this file with plain type
 * stripping.
 */

export type BoothMoment =
  // pregame
  | 'open.welcome'
  | 'open.debut'
  | 'open.homecoming'
  | 'open.milestone'
  | 'open.banner'
  | 'moment.rookieLap'
  | 'moment.tribute'
  | 'moment.ovation'
  | 'moment.banner'
  // play
  | 'puckDrop'
  | 'goal'
  | 'goal.tie'
  | 'goal.goAhead'
  | 'goal.lateTie'
  | 'goal.overtime'
  | 'goal.hatTrick'
  | 'goal.powerPlay'
  | 'goal.shortHanded'
  | 'goal.emptyNet'
  | 'goal.revenge'
  | 'goal.milestone'
  | 'goal.first'
  | 'goal.color'
  | 'save.big'
  | 'save.robbery'
  | 'save.color'
  | 'penalty'
  | 'fight'
  | 'hit.big'
  | 'periodEnd'
  | 'gameEnd'
  | 'gameEnd.close'

export interface BoothLine {
  id: string
  speaker: 'pbp' | 'color'
  moment: BoothMoment
  /** 1 routine · 2 notable · 3 huge. Stems are recorded at this energy. */
  intensity: 1 | 2 | 3
  /** Spoken text. `{name}` only at the very start or very end. */
  text: string
  /** The same call without a name — required when `text` has a slot. */
  bare?: string
  nameForm?: 'surname' | 'full'
  nameStyle?: 'neutral' | 'excited' | 'rising'
}

export const BOOTH_LINES: readonly BoothLine[] = [
  // ── pregame ──────────────────────────────────────────────────────────────
  { id: 'open.welcome.1', speaker: 'pbp', moment: 'open.welcome', intensity: 2,
    text: 'Good evening, and welcome in. The building is full, and we are just about ready for hockey.' },
  { id: 'open.welcome.2', speaker: 'pbp', moment: 'open.welcome', intensity: 2,
    text: 'Hello again, everyone. A big crowd in tonight, and a big one on the ice.' },
  { id: 'open.welcome.3', speaker: 'pbp', moment: 'open.welcome', intensity: 2,
    text: 'Welcome along. The anthem is done, the lines are set, and here we go.' },

  { id: 'open.debut.1', speaker: 'color', moment: 'open.debut', intensity: 2,
    text: 'A night he will never forget. First game in the National Hockey League for {name}.',
    bare: 'A night he will never forget. A first game in the National Hockey League.', nameForm: 'full', nameStyle: 'neutral' },
  { id: 'open.debut.2', speaker: 'color', moment: 'open.debut', intensity: 2,
    text: 'You only get one debut. Tonight it belongs to {name}.',
    bare: 'You only get one debut, and a young man gets his tonight.', nameForm: 'full', nameStyle: 'neutral' },

  { id: 'open.homecoming.1', speaker: 'color', moment: 'open.homecoming', intensity: 2,
    text: 'This building knows him well. Welcome back, {name}.',
    bare: 'This building knows him well. A homecoming tonight.', nameForm: 'full', nameStyle: 'neutral' },
  { id: 'open.homecoming.2', speaker: 'color', moment: 'open.homecoming', intensity: 2,
    text: 'Plenty of history in this rink for {name}.',
    bare: 'Plenty of history in this rink for one man in particular.', nameForm: 'full', nameStyle: 'neutral' },

  { id: 'open.milestone.1', speaker: 'color', moment: 'open.milestone', intensity: 2,
    text: 'Keep an eye on the milestone watch tonight. It is right there for {name}.',
    bare: 'Keep an eye on the milestone watch tonight. It is right there.', nameForm: 'surname', nameStyle: 'neutral' },
  { id: 'open.milestone.2', speaker: 'color', moment: 'open.milestone', intensity: 2,
    text: 'The whole building knows what could happen tonight for {name}.',
    bare: 'The whole building knows what could happen tonight.', nameForm: 'surname', nameStyle: 'neutral' },

  { id: 'open.banner.1', speaker: 'pbp', moment: 'open.banner', intensity: 3,
    text: 'The champions are home, and tonight the banner goes up.' },

  { id: 'moment.rookieLap.1', speaker: 'pbp', moment: 'moment.rookieLap', intensity: 2,
    text: 'The veterans hang back, and out he goes alone. The rookie lap for {name}.',
    bare: 'The veterans hang back, and out he goes alone. The rookie lap.', nameForm: 'full', nameStyle: 'neutral' },
  { id: 'moment.rookieLap.2', speaker: 'pbp', moment: 'moment.rookieLap', intensity: 2,
    text: 'An empty sheet, one lap, and a whole career ahead. Enjoy it, {name}.',
    bare: 'An empty sheet, one lap, and a whole career ahead.', nameForm: 'surname', nameStyle: 'neutral' },

  { id: 'moment.tribute.1', speaker: 'pbp', moment: 'moment.tribute', intensity: 2,
    text: 'Up on the video board, a tribute for {name}.',
    bare: 'Up on the video board, a tribute for an old friend.', nameForm: 'full', nameStyle: 'neutral' },
  { id: 'moment.ovation.1', speaker: 'color', moment: 'moment.ovation', intensity: 2,
    text: 'Listen to this building. They are on their feet.' },
  { id: 'moment.ovation.2', speaker: 'color', moment: 'moment.ovation', intensity: 2,
    text: 'That is a standing ovation, and he has earned every second of it.' },
  { id: 'moment.banner.1', speaker: 'pbp', moment: 'moment.banner', intensity: 3,
    text: 'And up it goes. Champions, forever, in the rafters.' },

  // ── play ─────────────────────────────────────────────────────────────────
  { id: 'puckDrop.1', speaker: 'pbp', moment: 'puckDrop', intensity: 1,
    text: 'The puck is down, and we are underway.' },
  { id: 'puckDrop.2', speaker: 'pbp', moment: 'puckDrop', intensity: 1,
    text: 'And we are away.' },

  { id: 'goal.1', speaker: 'pbp', moment: 'goal', intensity: 2,
    text: '{name}! He shoots, and scores!', bare: 'He shoots, and scores!', nameStyle: 'excited' },
  { id: 'goal.2', speaker: 'pbp', moment: 'goal', intensity: 2,
    text: 'In the back of the net! Goal, {name}!', bare: 'In the back of the net! Goal!', nameStyle: 'excited' },
  { id: 'goal.3', speaker: 'pbp', moment: 'goal', intensity: 2,
    text: 'He buries it! {name}!', bare: 'He buries it!', nameStyle: 'excited' },
  { id: 'goal.4', speaker: 'pbp', moment: 'goal', intensity: 2,
    text: '{name}! And it is in!', bare: 'And it is in!', nameStyle: 'excited' },

  { id: 'goal.tie.1', speaker: 'pbp', moment: 'goal.tie', intensity: 2,
    text: 'And we are all square! {name}!', bare: 'And we are all square!', nameStyle: 'excited' },
  { id: 'goal.tie.2', speaker: 'pbp', moment: 'goal.tie', intensity: 2,
    text: '{name}! He ties it up!', bare: 'All tied up!', nameStyle: 'excited' },
  { id: 'goal.goAhead.1', speaker: 'pbp', moment: 'goal.goAhead', intensity: 2,
    text: '{name}! He puts them in front!', bare: 'And they are in front!', nameStyle: 'excited' },
  { id: 'goal.goAhead.2', speaker: 'pbp', moment: 'goal.goAhead', intensity: 2,
    text: 'He scores, and the lead belongs to them! {name}!', bare: 'He scores, and the lead belongs to them!', nameStyle: 'excited' },

  { id: 'goal.lateTie.1', speaker: 'pbp', moment: 'goal.lateTie', intensity: 3,
    text: 'Scores! Scores! Tied up late, by {name}!', bare: 'Scores! Scores! Tied up late!', nameStyle: 'excited' },
  { id: 'goal.lateTie.2', speaker: 'pbp', moment: 'goal.lateTie', intensity: 3,
    text: 'With time running out! {name}!', bare: 'With time running out, they have tied it!', nameStyle: 'excited' },

  { id: 'goal.overtime.1', speaker: 'pbp', moment: 'goal.overtime', intensity: 3,
    text: 'Overtime winner! It is over, and it is {name}!', bare: 'Overtime winner! It is over!', nameStyle: 'excited' },
  { id: 'goal.overtime.2', speaker: 'pbp', moment: 'goal.overtime', intensity: 3,
    text: 'He scores, and they win it! {name}!', bare: 'He scores, and they win it!', nameStyle: 'excited' },

  { id: 'goal.hatTrick.1', speaker: 'pbp', moment: 'goal.hatTrick', intensity: 3,
    text: 'Here come the hats! A hat trick for {name}!', bare: 'Here come the hats! A hat trick!', nameStyle: 'excited' },

  { id: 'goal.powerPlay.1', speaker: 'pbp', moment: 'goal.powerPlay', intensity: 2,
    text: 'The power play cashes in! {name}!', bare: 'The power play cashes in!', nameStyle: 'excited' },
  { id: 'goal.powerPlay.2', speaker: 'pbp', moment: 'goal.powerPlay', intensity: 2,
    text: '{name}! On the power play, and it is in!', bare: 'On the power play, and it is in!', nameStyle: 'excited' },

  { id: 'goal.shortHanded.1', speaker: 'pbp', moment: 'goal.shortHanded', intensity: 3,
    text: 'Shorthanded, and he scores! {name}!', bare: 'Shorthanded, and he scores!', nameStyle: 'excited' },

  { id: 'goal.emptyNet.1', speaker: 'pbp', moment: 'goal.emptyNet', intensity: 2,
    text: 'Into the empty net, and that one goes to {name}.', bare: 'Into the empty net, and that should seal it.', nameStyle: 'neutral' },
  { id: 'goal.emptyNet.2', speaker: 'pbp', moment: 'goal.emptyNet', intensity: 2,
    text: 'That is the empty netter, from {name}.', bare: 'That is the empty netter.', nameStyle: 'neutral' },

  { id: 'goal.revenge.1', speaker: 'pbp', moment: 'goal.revenge', intensity: 3,
    text: 'Against his old team! {name}!', bare: 'Against his old team! Of course it is him!', nameStyle: 'excited' },

  { id: 'goal.milestone.1', speaker: 'pbp', moment: 'goal.milestone', intensity: 3,
    text: 'There it is! A milestone night for {name}!', bare: 'There it is! A milestone night!', nameForm: 'full', nameStyle: 'excited' },

  { id: 'goal.first.1', speaker: 'pbp', moment: 'goal.first', intensity: 3,
    text: 'His first in the National Hockey League! {name}!', bare: 'His first in the National Hockey League!', nameForm: 'full', nameStyle: 'excited' },

  { id: 'goal.color.1', speaker: 'color', moment: 'goal.color', intensity: 2,
    text: 'What a finish. The goalie had no chance on that one.' },
  { id: 'goal.color.2', speaker: 'color', moment: 'goal.color', intensity: 2,
    text: 'Watch the pass that sets it up. That is the whole play.' },
  { id: 'goal.color.3', speaker: 'color', moment: 'goal.color', intensity: 2,
    text: 'They have been knocking on the door, and it finally opens.' },
  { id: 'goal.color.4', speaker: 'color', moment: 'goal.color', intensity: 2,
    text: 'You leave a man that open in the slot, and this is what happens.' },

  { id: 'save.big.1', speaker: 'pbp', moment: 'save.big', intensity: 2,
    text: 'Big save, {name}!', bare: 'Big save!', nameStyle: 'excited' },
  { id: 'save.big.2', speaker: 'pbp', moment: 'save.big', intensity: 2,
    text: '{name}! And he says no!', bare: 'And the goalie says no!', nameStyle: 'excited' },
  { id: 'save.robbery.1', speaker: 'pbp', moment: 'save.robbery', intensity: 3,
    text: 'Oh, what a save by {name}!', bare: 'Oh, what a save!', nameStyle: 'excited' },
  { id: 'save.robbery.2', speaker: 'pbp', moment: 'save.robbery', intensity: 3,
    text: 'Robbed! Absolutely robbed by {name}!', bare: 'Robbed! Absolutely robbed!', nameStyle: 'excited' },
  { id: 'save.color.1', speaker: 'color', moment: 'save.color', intensity: 2,
    text: 'He had no business getting across for that one.' },
  { id: 'save.color.2', speaker: 'color', moment: 'save.color', intensity: 2,
    text: 'That is a goal ninety nine times out of a hundred.' },

  { id: 'penalty.1', speaker: 'pbp', moment: 'penalty', intensity: 1,
    text: '{name}. He heads to the box.', bare: 'And he heads to the box.', nameStyle: 'neutral' },
  { id: 'penalty.2', speaker: 'pbp', moment: 'penalty', intensity: 1,
    text: 'The arm goes up, and that is a penalty on {name}.', bare: 'The arm goes up, and that is a penalty.', nameStyle: 'neutral' },

  { id: 'fight.1', speaker: 'pbp', moment: 'fight', intensity: 3,
    text: 'And the gloves are off!' },
  { id: 'fight.2', speaker: 'pbp', moment: 'fight', intensity: 3,
    text: 'They drop them, and here we go!' },

  { id: 'hit.big.1', speaker: 'color', moment: 'hit.big', intensity: 1,
    text: 'Oh, he felt that one.' },
  { id: 'hit.big.2', speaker: 'pbp', moment: 'hit.big', intensity: 1,
    text: 'Big hit along the wall!' },

  { id: 'periodEnd.1', speaker: 'pbp', moment: 'periodEnd', intensity: 1,
    text: 'And there is the horn to end the period.' },
  { id: 'periodEnd.2', speaker: 'pbp', moment: 'periodEnd', intensity: 1,
    text: 'That will do it for the period.' },

  { id: 'gameEnd.1', speaker: 'pbp', moment: 'gameEnd', intensity: 2,
    text: 'And that is the final horn.' },
  { id: 'gameEnd.2', speaker: 'pbp', moment: 'gameEnd', intensity: 2,
    text: 'It is over. Handshakes at the benches.' },
  { id: 'gameEnd.close.1', speaker: 'pbp', moment: 'gameEnd.close', intensity: 3,
    text: 'They hang on! That is the final horn!' },
]

/** Lines for a moment, in authored order. */
export function linesFor(moment: BoothMoment): BoothLine[] {
  return BOOTH_LINES.filter((l) => l.moment === moment)
}

/** Where the name sits in a line ('lead' | 'tail'), or null when there's none. */
export function nameSlotPosition(text: string): 'lead' | 'tail' | null {
  if (!text.includes('{name}')) return null
  if (text.startsWith('{name}')) return 'lead'
  // tail: '{name}' followed only by terminal punctuation.
  if (/\{name\}[.!?]*$/.test(text)) return 'tail'
  return null
}

/**
 * The stem that is stitched to the name clip — the line with the slot (and the
 * punctuation that belonged to the name) removed. "{name} shoots, and scores!"
 * → "shoots, and scores!"; "Big save, {name}!" → "Big save,".
 */
export function stemText(line: BoothLine): string {
  const pos = nameSlotPosition(line.text)
  if (pos === 'lead') return line.text.replace(/^\{name\}[,.!?]?\s*/, '').trim()
  if (pos === 'tail') return line.text.replace(/\s*\{name\}[.!?]*$/, '').trim()
  return line.text
}

/**
 * The delivery a line's stem (and bare clip) is recorded at. The colour man is
 * always conversational; the play-by-play man is excited for the calls that
 * matter (goals, saves, fights, a close final, banner nights) and even for the
 * rest. The offline renderer (scripts/booth/) reads this.
 */
export function stemStyle(line: BoothLine): 'excited' | 'neutral' {
  if (line.speaker === 'color') return 'neutral'
  if (line.intensity >= 3) return 'excited'
  if (line.intensity === 2 && /^(goal|save|fight|hit)/.test(line.moment)) return 'excited'
  return 'neutral'
}

/* ─────────────────────────── clip ids ─────────────────────────── */

/** Clip id of a line's stem (or the whole line when it has no name slot). */
export function stemClipId(lineId: string): string {
  return `stem.${lineId}`
}
/** Clip id of a line's name-less fallback. */
export function bareClipId(lineId: string): string {
  return `bare.${lineId}`
}
