/**
 * Deterministic press fallback — readable wire-report articles rendered from
 * the same PressFactSheet the LLM writers get. Used whenever no API key is
 * configured or a generation call fails: the press corps never goes silent.
 *
 * Pure module: no randomness, no wall-clock. Same sheet in → same article out.
 */
import {
  PRESS_PERSONA_NAMES,
  type PressFactSheet,
  type PressJob,
  type PressResultFact,
} from './factSheet'

export interface FallbackArticle {
  headline: string
  body: string
  /** "Name — Outlet" persona byline; the caller may append "(wire report)". */
  byline: string
}

function record(sheet: PressFactSheet): string {
  const t = sheet.team
  return `${t.wins}–${t.losses}–${t.otLosses}, ${t.points} pts, ${t.rank} of ${t.teamsInLeague}`
}

function resultLine(r: PressResultFact): string {
  const wl = r.goalsFor > r.goalsAgainst ? 'W' : 'L'
  const suffix = r.decidedBy === 'overtime' ? ' (OT)' : r.decidedBy === 'shootout' ? ' (SO)' : ''
  return `Day ${r.day}: ${wl} ${r.goalsFor}–${r.goalsAgainst}${suffix} ${r.home ? 'vs' : '@'} ${r.opponentAbbr}`
}

function expectationLine(sheet: PressFactSheet): string | null {
  const t = sheet.team
  if (t.expectedRank === undefined) return null
  if (t.rank < t.expectedRank) {
    return `The ${t.name} sit ${t.expectedRank - t.rank} spots above their preseason projection of ${t.expectedRank}.`
  }
  if (t.rank > t.expectedRank) {
    return `The ${t.name} are ${t.rank - t.expectedRank} spots below their preseason projection of ${t.expectedRank}.`
  }
  return `The ${t.name} are running exactly to their preseason projection of ${t.expectedRank}.`
}

function weeklyHeadline(sheet: PressFactSheet): string {
  const t = sheet.team
  const recent = sheet.lastResults
  const wins = recent.filter((r) => r.goalsFor > r.goalsAgainst).length
  if (recent.length >= 3 && wins === recent.length) return `${t.abbr} rolling: ${wins} straight in the books`
  if (recent.length >= 3 && wins === 0) return `Hard week for the ${t.name}`
  return `${t.abbr} week in review: ${t.points} points and counting`
}

function tentpoleHeadline(sheet: PressFactSheet): string {
  const t = sheet.team
  switch (sheet.kind) {
    case 'deadline':
      return `Deadline day shakes the league`
    case 'lottery':
      return `Lottery night sets the draft board`
    case 'combine':
      return `Combine notebook: risers and fallers`
    case 'draft':
      return `Draft recap: the next wave arrives`
    case 'seasonRecap':
      return `Season in review: where the ${t.name} stand`
    case 'champion':
      return `A champion is crowned`
    default:
      return weeklyHeadline(sheet)
  }
}

function bulletBlock(title: string, lines: string[]): string {
  if (lines.length === 0) return ''
  return `${title}\n${lines.map((l) => `• ${l}`).join('\n')}\n\n`
}

/** Render a deterministic article for any press job. */
export function renderFallback(job: PressJob): FallbackArticle {
  const sheet = job.factSheet
  const persona = PRESS_PERSONA_NAMES[job.personaId]
  const t = sheet.team

  const paragraphs: string[] = []
  paragraphs.push(
    `${t.name} (${record(sheet)}), year ${sheet.year}, day ${sheet.day}.` +
      (expectationLine(sheet) ? ` ${expectationLine(sheet)}` : '')
  )

  let body = paragraphs.join('\n\n') + '\n\n'
  body += bulletBlock('Recent results', sheet.lastResults.map(resultLine))
  if (sheet.special.length > 0) body += bulletBlock('The big story', sheet.special)
  body += bulletBlock(
    'Storylines to watch',
    sheet.topArcs.map((a) => a.summary)
  )
  body += bulletBlock(
    'Around the room',
    [
      `Room morale: ${Math.round(sheet.lockerRoom.roomMorale)}/100` +
        (sheet.lockerRoom.captainName ? `, captained by ${sheet.lockerRoom.captainName}` : ''),
      ...sheet.lockerRoom.feuds.map((f) => `Friction: ${f}`),
      ...sheet.lockerRoom.mentorships.map((m) => `Mentorship: ${m}`),
    ]
  )
  body += bulletBlock(
    'Rumor mill',
    sheet.rumors.map((r) => `${r.playerName} (${r.teamAbbr}) — heat ${Math.round(r.heat)}/100`)
  )
  body += bulletBlock(
    'League leaders',
    sheet.leagueLeaders.map((l) => `${l.name} (${l.teamAbbr}): ${l.value} ${l.stat}`)
  )
  body += bulletBlock('Records watch', sheet.recordsWatch)
  body += bulletBlock(
    'Up next',
    sheet.upcomingOpponents.map((o) => o)
  )

  return {
    headline: sheet.kind === 'weekly' ? weeklyHeadline(sheet) : tentpoleHeadline(sheet),
    body: body.trimEnd(),
    byline: `${persona.name} — ${persona.outlet}`,
  }
}
