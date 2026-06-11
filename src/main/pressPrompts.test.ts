/**
 * Unit tests for pressPrompts.ts (pure module — no Electron, no SDK).
 */
import { describe, expect, it } from 'vitest'
import {
  buildPresserGradePrompt,
  buildSystemPrompt,
  buildUserPrompt,
  parseArticle,
  parseGrade,
  personaByline,
} from './pressPrompts'
import type { PressFactSheet } from '@engine/story/factSheet'

/* ──────────────────────────────────────────────────────────
   Fixture fact sheet
   ────────────────────────────────────────────────────────── */

const SHEET: PressFactSheet = {
  kind: 'weekly',
  year: 2026,
  day: 14,
  team: {
    name: 'Riverdale Wolves',
    abbr: 'RW',
    wins: 7,
    losses: 3,
    otLosses: 1,
    points: 15,
    rank: 5,
    teamsInLeague: 16,
    expectedRank: 4,
  },
  lastResults: [
    { day: 12, opponentAbbr: 'AX', home: true, goalsFor: 4, goalsAgainst: 2, decidedBy: 'regulation' },
    { day: 14, opponentAbbr: 'BQ', home: false, goalsFor: 1, goalsAgainst: 3, decidedBy: 'regulation' },
  ],
  topArcs: [
    { kind: 'hotStreak', summary: 'Jake Rivers on a 5-game point streak', tension: 80 },
  ],
  lockerRoom: {
    roomMorale: 72,
    captainName: 'Mike Donovan',
    feuds: [],
    mentorships: ['Mike Donovan mentoring Jake Rivers'],
  },
  rumors: [],
  recordsWatch: [],
  upcomingOpponents: ['vs AX (day 16)', '@CX (day 18)'],
  leagueLeaders: [
    { name: 'Alex Strong', teamAbbr: 'TK', stat: 'points', value: 22 },
  ],
  sagaSoFar: 'Y2026: new GM takes over the Riverdale Wolves.',
  special: [],
}

/* ──────────────────────────────────────────────────────────
   buildSystemPrompt
   ────────────────────────────────────────────────────────── */

describe('buildSystemPrompt', () => {
  it('returns a non-empty string for every persona', () => {
    const personas = ['beat', 'national', 'homer'] as const
    for (const p of personas) {
      const s = buildSystemPrompt(p)
      expect(typeof s).toBe('string')
      expect(s.length).toBeGreaterThan(50)
    }
  })

  it('each persona contains its name and outlet', () => {
    expect(buildSystemPrompt('beat')).toContain('Sam Carver')
    expect(buildSystemPrompt('national')).toContain('Vic Mercer')
    expect(buildSystemPrompt('homer')).toContain('Bobby')
  })

  it('all personas contain the IRONCLAD RULES keyword', () => {
    for (const p of ['beat', 'national', 'homer'] as const) {
      expect(buildSystemPrompt(p)).toContain('IRONCLAD RULES')
    }
  })

  it('all personas prohibit inventing stats', () => {
    for (const p of ['beat', 'national', 'homer'] as const) {
      const s = buildSystemPrompt(p)
      expect(s).toContain('Do NOT invent')
    }
  })
})

/* ──────────────────────────────────────────────────────────
   buildUserPrompt
   ────────────────────────────────────────────────────────── */

describe('buildUserPrompt', () => {
  it('includes the fact sheet as JSON', () => {
    const prompt = buildUserPrompt('weekly', SHEET)
    expect(prompt).toContain('"Riverdale Wolves"')
    expect(prompt).toContain('"points": 15')
  })

  it('includes the task description for the given kind', () => {
    expect(buildUserPrompt('weekly', SHEET)).toContain('weekly column')
    expect(buildUserPrompt('deadline', SHEET)).toContain('trade-deadline')
    expect(buildUserPrompt('champion', SHEET)).toContain('championship')
    expect(buildUserPrompt('draft', SHEET)).toContain('draft-day')
  })

  it('instructs the model to output HEADLINE: prefix', () => {
    const prompt = buildUserPrompt('weekly', SHEET)
    expect(prompt).toContain('HEADLINE:')
  })

  it('falls back to weekly task for unknown kind', () => {
    // presser is a valid kind now
    const prompt = buildUserPrompt('presser', SHEET)
    expect(prompt).toContain('TASK:')
  })
})

/* ──────────────────────────────────────────────────────────
   parseArticle
   ────────────────────────────────────────────────────────── */

describe('parseArticle', () => {
  it('splits a well-formed HEADLINE: response', () => {
    const raw = 'HEADLINE: Wolves roll to third straight win\n\nThe Riverdale Wolves are on a roll.'
    const { headline, body } = parseArticle(raw)
    expect(headline).toBe('Wolves roll to third straight win')
    expect(body).toContain('Riverdale Wolves')
    expect(body).not.toContain('HEADLINE:')
  })

  it('handles HEADLINE: in mid-cased form', () => {
    const raw = 'Headline: A great day for hockey\n\nThe game was intense.'
    const { headline } = parseArticle(raw)
    expect(headline).toBe('A great day for hockey')
  })

  it('falls back to first line as headline when no HEADLINE: prefix present', () => {
    const raw = 'Wolves edge rivals in overtime\n\nA thriller at the rink last night.'
    const { headline, body } = parseArticle(raw)
    expect(headline).toBe('Wolves edge rivals in overtime')
    expect(body).toContain('thriller')
  })

  it('returns the whole text as body when there is only one line', () => {
    const raw = 'HEADLINE: Short article only'
    const { headline } = parseArticle(raw)
    expect(headline).toBe('Short article only')
  })

  it('trims whitespace from headline', () => {
    const raw = 'HEADLINE:   Spaced headline   \n\nBody text here.'
    expect(parseArticle(raw).headline).toBe('Spaced headline')
  })
})

/* ──────────────────────────────────────────────────────────
   buildPresserGradePrompt
   ────────────────────────────────────────────────────────── */

describe('buildPresserGradePrompt', () => {
  it('includes the question and answer verbatim', () => {
    const q = 'Are you satisfied with the defence?'
    const a = 'We have work to do but the effort is there.'
    const prompt = buildPresserGradePrompt(q, a)
    expect(prompt).toContain(q)
    expect(prompt).toContain(a)
  })

  it('lists all four valid tones', () => {
    const prompt = buildPresserGradePrompt('q', 'a')
    expect(prompt).toContain('measured')
    expect(prompt).toContain('fiery')
    expect(prompt).toContain('deflecting')
    expect(prompt).toContain('praise')
  })

  it('instructs the model to output TONE: and REACTION:', () => {
    const prompt = buildPresserGradePrompt('q', 'a')
    expect(prompt).toContain('TONE:')
    expect(prompt).toContain('REACTION:')
  })
})

/* ──────────────────────────────────────────────────────────
   parseGrade
   ────────────────────────────────────────────────────────── */

describe('parseGrade', () => {
  it('parses a well-formed response', () => {
    const raw = 'TONE: fiery\nREACTION: The reporters sit up straight.'
    const { tone, reaction } = parseGrade(raw)
    expect(tone).toBe('fiery')
    expect(reaction).toBe('The reporters sit up straight.')
  })

  it('handles case-insensitive tone', () => {
    expect(parseGrade('TONE: Measured\nREACTION: Calm room.').tone).toBe('measured')
    expect(parseGrade('TONE: PRAISE\nREACTION: Smiles around.').tone).toBe('praise')
  })

  it('falls back to measured tone when tone is unrecognised', () => {
    const { tone } = parseGrade('TONE: sarcastic\nREACTION: Confused faces.')
    expect(tone).toBe('measured')
  })

  it('provides a default reaction when REACTION: is absent', () => {
    const { reaction } = parseGrade('TONE: deflecting')
    expect(reaction).toBeTruthy()
    expect(typeof reaction).toBe('string')
  })

  it('handles a completely unparseable string without throwing', () => {
    const { tone, reaction } = parseGrade('   ')
    expect(tone).toBe('measured')
    expect(reaction).toBeTruthy()
  })
})

/* ──────────────────────────────────────────────────────────
   personaByline
   ────────────────────────────────────────────────────────── */

describe('personaByline', () => {
  it('returns "Name — Outlet" for each persona', () => {
    expect(personaByline('beat')).toBe('Sam Carver — The Daily Gazette')
    expect(personaByline('national')).toBe('Vic Mercer — National Hockey Wire')
    expect(personaByline('homer')).toContain('990 The Fan')
  })

  it('contains an em-dash or similar separator', () => {
    for (const p of ['beat', 'national', 'homer'] as const) {
      expect(personaByline(p)).toContain('—')
    }
  })
})
