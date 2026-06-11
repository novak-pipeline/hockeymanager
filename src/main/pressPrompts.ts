/**
 * Pure prompt builders for the AI press corps — no Electron, no SDK imports.
 * All logic is unit-testable; the IPC handler in press.ts calls these and then
 * hands the assembled strings to the Anthropic client.
 */
import type { PressFactSheet, PressPersonaId, PressSheetKind } from '@engine/story/factSheet'

/**
 * Persona display names. Inlined (not imported from the engine) so the main
 * process bundle stays free of engine runtime code — the type still flows from
 * the engine, but this small map is duplicated here on purpose. Keep in sync
 * with PRESS_PERSONA_NAMES in src/engine/story/factSheet.ts.
 */
const PRESS_PERSONA_NAMES: Record<PressPersonaId, { name: string; outlet: string }> = {
  beat: { name: 'Sam Carver', outlet: 'The Daily Gazette' },
  national: { name: 'Vic Mercer', outlet: 'National Hockey Wire' },
  homer: { name: 'Bobby “Buzz” Doyle', outlet: '990 The Fan' },
}

/* ────────────────────────── personas ────────────────────────── */

const PERSONA_VOICES: Record<PressPersonaId, string> = {
  beat: `You are Sam Carver, a beat reporter for The Daily Gazette who covers this team every single
day. Your style is grounded, factual and close to the locker room. You know the players by their
first names, you notice subtle shifts in line-combinations, and you care about the fans who have
been following this team for decades. Your prose is clean, economical and workmanlike — no
florid metaphors. You hold opinions only where the facts clearly support them.

IRONCLAD RULES you must never break:
- Write ONLY from the fact sheet provided. Do NOT invent statistics, player names, injuries,
  trades, game results or any other factual claim not present in the sheet.
- Opinions and analysis are fine; invented facts are not.
- If the sheet has no recent results, say so rather than fabricating a score.
- Maximum 220 words for the article body.`,

  national: `You are Vic Mercer, a national hockey columnist for the National Hockey Wire whose
readers follow the whole league. Your style is authoritative, wide-angle and analytical. You
contextualise this team against the rest of the league, and you are comfortable expressing sharp
opinions — including critical ones — when the numbers back them up. Your prose has a punchy,
magazine quality: tight sentences, vivid verbs, no clichés.

IRONCLAD RULES you must never break:
- Write ONLY from the fact sheet provided. Do NOT invent statistics, player names, injuries,
  trades, game results or any other factual claim not present in the sheet.
- Opinions and analysis are fine; invented facts are not.
- If the sheet has no recent results, say so rather than fabricating a score.
- Maximum 220 words for the article body.`,

  homer: `You are Bobby "Buzz" Doyle, the excitable play-by-play man on 990 The Fan who unambiguously
roots for the home team. Your style is radio-warm, enthusiastic and occasionally breathless. You
find the silver lining in every loss and amplify every win into a dynasty moment. You use the
word "we" about the team. Your prose reads like someone who just downed their third coffee.

IRONCLAD RULES you must never break:
- Write ONLY from the fact sheet provided. Do NOT invent statistics, player names, injuries,
  trades, game results or any other factual claim not present in the sheet.
- Enthusiasm and optimism are fine; invented facts are not.
- If the sheet has no recent results, say so rather than fabricating a score.
- Maximum 220 words for the article body.`,
}

/* ────────────────────────── prompt builders ────────────────────────── */

export function buildSystemPrompt(personaId: PressPersonaId): string {
  return PERSONA_VOICES[personaId]
}

const KIND_TASKS: Record<PressSheetKind, string> = {
  weekly:
    'Write a weekly column covering the team\'s recent results, standings position and the most ' +
    'interesting storylines from the fact sheet.',
  deadline:
    'Write a trade-deadline special covering the moves that shook the league and what they mean ' +
    'for this team going forward.',
  lottery:
    'Write a draft-lottery reaction piece: who moved up, what it means for the top pick, and ' +
    'the ripple effects for this team.',
  combine:
    'Write a scouting-combine notebook: highlight the biggest risers and fallers and what that ' +
    'means for the upcoming draft.',
  draft:
    'Write a draft-day recap: celebrate the selections, put them in context of the team\'s needs, ' +
    'and look ahead.',
  seasonRecap:
    'Write a season-in-review column: honest assessment of what went right, what went wrong, ' +
    'and what the off-season must fix.',
  champion:
    'Write a championship celebration piece: capture the emotion, the key contributors, and what ' +
    'this title means for the franchise.',
  presser:
    'Write a brief post-presser reaction noting the key theme of the press conference and its ' +
    'implications for the dressing room.',
}

export function buildUserPrompt(kind: PressSheetKind, factSheet: PressFactSheet): string {
  const task = KIND_TASKS[kind] ?? KIND_TASKS.weekly
  const sheetJson = JSON.stringify(factSheet, null, 2)
  return (
    `FACT SHEET (the ONLY source of facts you may use):\n\`\`\`json\n${sheetJson}\n\`\`\`\n\n` +
    `YOUR TASK: ${task}\n\n` +
    `FORMAT your response as:\n` +
    `HEADLINE: <single-line headline with no trailing punctuation>\n` +
    `<blank line>\n` +
    `<article body — maximum 220 words>`
  )
}

/* ────────────────────────── article parser ────────────────────────── */

export interface ParsedArticle {
  headline: string
  body: string
}

/**
 * Split an LLM response into headline + body. Robust against minor formatting
 * drift: tries the "HEADLINE:" prefix first, falls back to first non-empty line.
 */
export function parseArticle(raw: string): ParsedArticle {
  const trimmed = raw.trim()
  const headlineMatch = /^HEADLINE:\s*(.+)$/im.exec(trimmed)
  if (headlineMatch) {
    const headline = headlineMatch[1].trim()
    // Body is everything after the headline line + optional blank line.
    const afterHeadline = trimmed.slice(headlineMatch.index + headlineMatch[0].length).trimStart()
    const body = afterHeadline.replace(/^[-—]+\s*/, '').trim()
    return { headline, body: body || trimmed }
  }
  // Fallback: treat first non-empty line as headline.
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0)
  const headline = lines[0]?.trim() ?? trimmed.slice(0, 80)
  const body = lines.slice(1).join('\n').trim() || trimmed
  return { headline, body }
}

/* ────────────────────────── press conference grading ────────────────────────── */

export function buildPresserGradePrompt(question: string, answer: string): string {
  return (
    `A hockey GM was asked at a press conference:\n` +
    `QUESTION: "${question}"\n\n` +
    `The GM answered:\n` +
    `ANSWER: "${answer}"\n\n` +
    `Classify the tone of the GM's answer in one word from this list:\n` +
    `- measured (calm, balanced, professional)\n` +
    `- fiery (emotional, combative, passionate)\n` +
    `- deflecting (evasive, avoiding the question, giving a non-answer)\n` +
    `- praise (complimentary, thanking someone, positive spin)\n\n` +
    `Then write ONE short sentence (max 15 words) describing the room's reaction.\n\n` +
    `FORMAT:\n` +
    `TONE: <one word>\n` +
    `REACTION: <one sentence>`
  )
}

export type PressToneResult = 'measured' | 'fiery' | 'deflecting' | 'praise'

export interface ParsedGrade {
  tone: PressToneResult
  reaction: string
}

const VALID_TONES: PressToneResult[] = ['measured', 'fiery', 'deflecting', 'praise']

/**
 * Parse the tone-classification response from the LLM. Falls back to
 * 'measured' tone if the response can't be cleanly parsed.
 */
export function parseGrade(raw: string): ParsedGrade {
  const trimmed = raw.trim()
  const toneMatch = /^TONE:\s*(\w+)/im.exec(trimmed)
  const reactionMatch = /^REACTION:\s*(.+)$/im.exec(trimmed)

  let tone: PressToneResult = 'measured'
  if (toneMatch) {
    const candidate = toneMatch[1].toLowerCase().trim() as PressToneResult
    if (VALID_TONES.includes(candidate)) tone = candidate
  }

  const reaction = reactionMatch ? reactionMatch[1].trim() : 'The room takes note.'

  return { tone, reaction }
}

/* ────────────────────────── persona display helpers ────────────────────────── */

/** The display byline string used in articles: "Name — Outlet". */
export function personaByline(personaId: PressPersonaId): string {
  const p = PRESS_PERSONA_NAMES[personaId]
  return `${p.name} — ${p.outlet}`
}
