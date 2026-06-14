/**
 * Draft-class breakdown article — an EliteProspects-style "Breaking down the
 * 20XX NHL Draft" feature, generated from the analyst board. It reads the shape
 * of the class (where the depth is, where it's thin) and names the top prospects
 * by position, so each draft year gets its own narrative scouting piece in the
 * inbox. Pure: deterministic from the board rows.
 */
import type { DraftRankRowView } from './views'

export interface DraftClassArticle {
  headline: string
  body: string
}

function bucket(pos: string): 'C' | 'D' | 'G' | 'W' {
  if (pos === 'C') return 'C'
  if (pos === 'D' || pos === 'LD' || pos === 'RD') return 'D'
  if (pos === 'G') return 'G'
  return 'W'
}

/** A short upside descriptor from a prospect's potential stars. */
function upsideWord(stars: number): string {
  if (stars >= 4.75) return 'franchise upside'
  if (stars >= 4.25) return 'elite upside'
  if (stars >= 3.75) return 'high-end upside'
  if (stars >= 3.25) return 'a projectable top-of-the-lineup ceiling'
  if (stars >= 2.75) return 'a middle-of-the-lineup projection'
  return 'an intriguing long-term profile'
}

function section(title: string, rows: DraftRankRowView[]): string {
  if (rows.length === 0) return ''
  const lines = rows.map((r) =>
    `• ${r.name} (${r.teamAbbr}, ${r.leagueAbbr}) — #${r.rank} overall; ${upsideWord(r.potentialStars)}.`)
  return `${title}\n${lines.join('\n')}`
}

/**
 * Build the article from the published analyst board. Returns null if there
 * aren't enough ranked prospects to write about.
 */
export function buildDraftClassArticle(rankings: DraftRankRowView[], draftYear: number): DraftClassArticle | null {
  if (rankings.length < 8) return null
  const top = rankings.slice(0, 32)
  const by = (b: 'C' | 'D' | 'G' | 'W'): DraftRankRowView[] => top.filter((r) => bucket(r.position) === b)
  const centres = by('C'), d = by('D'), wings = by('W'), goalies = by('G')

  const lead = rankings.slice(0, 2).map((r) => r.name)
  const counts = { C: centres.length, D: d.length, W: wings.length, G: goalies.length }

  // Read the shape of the class from the top-32 position split.
  const shape: string[] = []
  if (counts.W >= 10) shape.push('It is a class deep on the wing')
  else if (counts.W <= 5) shape.push('Wing depth is thinner than usual this year')
  if (counts.D >= 11) shape.push('and an especially strong year to be shopping for a defenceman')
  else if (counts.D <= 6) shape.push('and light on blue-line talent')
  if (counts.C <= 5) shape.push('with a notable lack of depth down the middle')
  else if (counts.C >= 10) shape.push('with enviable centre depth')
  const shapeLine = shape.length > 0 ? `${shape.join(', ')}.` : 'It is a balanced class across positions.'

  const intro =
    `The ${draftYear} NHL Draft class is headlined by ${lead.join(' and ')}, who have traded the top spot on our board through the season. ` +
    `${shapeLine} ` +
    `What follows is our scouts' read on the prospects to know at each position heading toward draft day.`

  const sections = [
    section('TOP CENTRES', centres.slice(0, 4)),
    section('TOP DEFENCEMEN', d.slice(0, 5)),
    section('TOP WINGERS', wings.slice(0, 5)),
    section('TOP GOALTENDERS', goalies.slice(0, 3)),
  ].filter((s) => s.length > 0)

  const outro =
    'Rankings will keep shifting as the season plays out — production, health, and head-to-head viewings all move the board between now and the draft.'

  return {
    headline: `Breaking down the ${draftYear} NHL Draft class`,
    body: [intro, ...sections, outro].join('\n\n'),
  }
}
