/**
 * Player interviews — the scouting-roleplay layer.
 *
 * The GM sits down with a player (a prospect, a target, or one of his own) and
 * picks questions to ask. Each question probes a specific personality trait; the
 * player's spoken reply is generated deterministically from his real trait value,
 * and asking it sharpens what the GM knows (the career layer bumps scouting
 * knowledge). Over an interview the GM forms a read on the hidden qualities that
 * raw ratings never show.
 *
 * Pure + deterministic: prose is chosen by a stable hash of playerId+questionId,
 * never Math.random. The career layer owns which questions have been asked.
 */

import type { Player } from '@domain'

export interface InterviewQuestion {
  id: string
  /** What the GM asks. */
  prompt: string
  /** Trait probed: a key on personality (1–20) or a hidden 1–20 player field. */
  trait: string
  /** True when the trait lives on player.personality; false = top-level field. */
  inPersonality: boolean
}

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  { id: 'goals',      prompt: 'Where do you want to be in five years?',            trait: 'ambition',        inPersonality: true },
  { id: 'training',   prompt: 'Talk me through your commitment to your craft.',     trait: 'professionalism', inPersonality: true },
  { id: 'future',     prompt: 'How do you feel about this club long term?',         trait: 'loyalty',         inPersonality: true },
  { id: 'adversity',  prompt: 'How do you handle a tough loss?',                    trait: 'temperament',     inPersonality: true },
  { id: 'drive',      prompt: 'What pushes you to keep improving?',                 trait: 'determination',   inPersonality: true },
  { id: 'bigMoments', prompt: 'How do you feel when the game is on the line?',      trait: 'pressure',        inPersonality: false },
  { id: 'newSystem',  prompt: 'How quickly do you adjust to a new system?',         trait: 'adaptability',    inPersonality: false },
]

export interface InterviewAnswer {
  questionId: string
  prompt: string
  trait: string
  /** The player's spoken reply. */
  answer: string
  /** Plain-English read the GM takes away, e.g. "Highly ambitious". */
  reveal: string
}

/* ─────────────────────── band model ─────────────────────── */

type BandKey = 'low' | 'mid' | 'high' | 'elite'

function bandOf(v: number): BandKey {
  if (v <= 6) return 'low'
  if (v <= 12) return 'mid'
  if (v <= 16) return 'high'
  return 'elite'
}

/** Reveal label + 1–2 candidate replies per trait per band. */
const REPLIES: Record<string, Record<BandKey, { reveal: string; lines: string[] }>> = {
  ambition: {
    low:   { reveal: 'Content, low ambition',   lines: ['“Honestly, I’m happy just to keep playing the game I love.”', '“I don’t look too far ahead — I take it year by year.”'] },
    mid:   { reveal: 'Balanced ambition',       lines: ['“I want to keep getting better and see where that takes me.”', '“A steady career and some good memories — that’d do me fine.”'] },
    high:  { reveal: 'Ambitious',               lines: ['“I want to be a top player on a winning team. That’s the goal.”', '“Five years? Lifting a cup, ideally more than one.”'] },
    elite: { reveal: 'Driven to be the best',   lines: ['“I want to be the best in the league. Nothing less interests me.”', '“I think about legacy. I want my name in the record books.”'] },
  },
  professionalism: {
    low:   { reveal: 'Casual approach',         lines: ['“I do what’s asked, but I’m not living in the gym, you know?”', '“I play my best on instinct — I don’t overthink the prep.”'] },
    mid:   { reveal: 'Solid pro',               lines: ['“I put the work in. I know what the job demands.”', '“I take care of myself well enough to compete.”'] },
    high:  { reveal: 'Diligent professional',   lines: ['“First in, last out. I take the details seriously.”', '“My routine is dialled in — recovery, video, all of it.”'] },
    elite: { reveal: 'Model professional',      lines: ['“Every habit, every meal, every rep — it all matters. I leave nothing to chance.”', '“I hold myself to a standard most people would find exhausting.”'] },
  },
  loyalty: {
    low:   { reveal: 'Mercenary streak',        lines: ['“I go where the opportunity is. It’s a business.”', '“Loyalty’s nice, but I look after myself first.”'] },
    mid:   { reveal: 'Pragmatic',               lines: ['“I’ll give everything while I’m here — but I keep my options open.”', '“The right situation matters more than the badge.”'] },
    high:  { reveal: 'Loyal',                   lines: ['“I want to build something here. I’m not chasing the door.”', '“This club’s been good to me and I don’t forget that.”'] },
    elite: { reveal: 'Devoted club man',        lines: ['“I’d retire in these colours if you’ll have me.”', '“This isn’t just a club to me — it’s home.”'] },
  },
  temperament: {
    low:   { reveal: 'Volatile',                lines: ['“A bad loss eats at me. Sometimes I can’t let it go.”', '“I’ll be honest — I’ve smashed a stick or two.”'] },
    mid:   { reveal: 'Emotional',               lines: ['“Losses hurt. I feel them, then I move on.”', '“I wear my heart on my sleeve, for better or worse.”'] },
    high:  { reveal: 'Composed',                lines: ['“You learn from it and turn the page. No use sulking.”', '“I stay even. Highs and lows are the enemy.”'] },
    elite: { reveal: 'Unflappable',             lines: ['“Nothing rattles me. Next shift, next game, clean slate.”', '“I’ve never let a result get inside my head.”'] },
  },
  determination: {
    low:   { reveal: 'Coasts on talent',        lines: ['“I rely on what comes naturally to me, mostly.”', '“When it’s not going my way, I don’t always force it.”'] },
    mid:   { reveal: 'Steady drive',            lines: ['“I keep grinding. You have to in this league.”', '“I push myself, within reason.”'] },
    high:  { reveal: 'Determined',              lines: ['“I outwork people. That’s always been my edge.”', '“When it gets hard is exactly when I dig in.”'] },
    elite: { reveal: 'Iron will',               lines: ['“I will not be outworked. Ever. Full stop.”', '“Obstacles just tell me how hard to push.”'] },
  },
  pressure: {
    low:   { reveal: 'Wilts under pressure',    lines: ['“Big moments… I’ll be honest, the nerves get to me.”', '“I’d rather the quiet games. The spotlight’s a lot.”'] },
    mid:   { reveal: 'Handles it',              lines: ['“I manage the nerves. Everyone has them.”', '“Tight games are part of it — I cope.”'] },
    high:  { reveal: 'Clutch',                  lines: ['“Give me the puck with the game on the line. I want it.”', '“The bigger the moment, the more locked in I get.”'] },
    elite: { reveal: 'Ice in the veins',        lines: ['“Pressure? That’s when I’m at my absolute best.”', '“Overtime, game seven — that’s the stuff I live for.”'] },
  },
  adaptability: {
    low:   { reveal: 'Set in his ways',         lines: ['“I play my game. New systems take me a while.”', '“I’m a creature of habit, I won’t lie.”'] },
    mid:   { reveal: 'Adaptable',               lines: ['“Give me a few weeks and I’ll have it down.”', '“I can adjust — I just need the reps.”'] },
    high:  { reveal: 'Flexible',                lines: ['“New system, new role — I pick it up fast.”', '“I pride myself on fitting whatever the coach needs.”'] },
    elite: { reveal: 'Adapts to anything',      lines: ['“Drop me into any system and I’ll thrive by week one.”', '“Change doesn’t faze me — I read it and go.”'] },
  },
}

/** Stable [0,1) hash of a string (FNV-1a). */
function stableHash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return (h % 10000) / 10000
}

function traitValue(player: Player, q: InterviewQuestion): number {
  const raw = q.inPersonality
    ? (player.personality as unknown as Record<string, number>)[q.trait]
    : (player as unknown as Record<string, number | undefined>)[q.trait]
  return Math.max(1, Math.min(20, raw ?? 10))
}

/** Generate the deterministic answer to one interview question. */
export function answerInterviewQuestion(player: Player, questionId: string): InterviewAnswer | null {
  const q = INTERVIEW_QUESTIONS.find((x) => x.id === questionId)
  if (!q) return null
  const band = bandOf(traitValue(player, q))
  const bank = REPLIES[q.trait]?.[band]
  if (!bank) return null
  const idx = Math.floor(stableHash01(`${player.id as unknown as string}:${questionId}`) * bank.lines.length)
  return {
    questionId: q.id,
    prompt: q.prompt,
    trait: q.trait,
    answer: bank.lines[Math.min(idx, bank.lines.length - 1)]!,
    reveal: bank.reveal,
  }
}
