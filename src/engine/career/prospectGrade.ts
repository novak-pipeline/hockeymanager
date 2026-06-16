/**
 * Composite prospect grade — an FM-style verdict that weighs MORE than raw
 * potential, so grades spread across the whole letter scale and come with the
 * pros/cons the scouts actually weighed. It blends:
 *
 *   - talent      : projected ceiling (heaviest) + current ability
 *   - position    : centre / defence / goalie scarcity premiums (goalies fade)
 *   - team need   : do we need this position, or are we already deep there?
 *   - system fit  : does his game suit how OUR team plays?
 *   - risk        : boom/bust uncertainty
 *   - value       : cost-controlled young asset vs expensive, hard-to-get veteran
 *
 * It's a grade FOR YOUR TEAM — the same player can grade differently for a club
 * that needs his position / plays his style than for one that doesn't.
 *
 * Pure + deterministic. No Rng / Date.
 */

export type ProspectGradeLetter =
  | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F'

export type NeedLevel = 'urgent' | 'need' | 'ok' | 'surplus'

export interface ProspectGradeArgs {
  potentialStars: number   // 0–5, fog-aware
  currentStars: number     // 0–5
  position: string
  age: number
  riskBand?: 'Low' | 'Medium' | 'High'
  /** How badly OUR roster needs this position group. */
  need?: NeedLevel
  /** 0–100 fit of his game in OUR system (skaters); omit for goalies/unknown. */
  styleFitScore?: number
  styleLabel?: string
}

export interface ProspectGradeResult {
  grade: ProspectGradeLetter
  /** 0–100 composite, for sorting/debug. */
  score: number
  pros: string[]
  cons: string[]
}

function isD(pos: string): boolean { return pos === 'D' || pos === 'LD' || pos === 'RD' }
function posNoun(pos: string): string {
  if (pos === 'G') return 'goaltender'
  if (isD(pos)) return 'defenceman'
  if (pos === 'C') return 'centre'
  return 'winger'
}

export function buildProspectGrade(a: ProspectGradeArgs): ProspectGradeResult {
  const pros: string[] = []
  const cons: string[] = []
  const goalie = a.position === 'G'

  // ── Talent core (the dominant term) ──
  let score = a.potentialStars * 13 + a.currentStars * 5 // 5★/5★ ≈ 90
  if (a.potentialStars >= 4.5) pros.push(`Elite upside — a ${a.potentialStars.toFixed(1)}★ ceiling`)
  else if (a.potentialStars >= 3.5) pros.push(`Real top-end projection (${a.potentialStars.toFixed(1)}★ ceiling)`)
  else if (a.potentialStars <= 2) cons.push('Limited ceiling — projects as a depth piece')
  if (a.currentStars >= 3.5) pros.push('Already an impact player today')
  else if (a.currentStars <= 1.5 && a.age >= 20) cons.push('Still raw for his age — a long way from ready')

  // ── Position scarcity ──
  if (a.position === 'C') { score += 3; pros.push('Premium position — a true centre') }
  else if (isD(a.position)) { score += 2; pros.push('Hard-to-find position — a defenceman') }
  else if (goalie) { score -= 4; cons.push('Goaltender — late to mature and notoriously hard to project') }

  // ── Team need ──
  if (a.need === 'urgent') { score += 8; pros.push(`Fills a glaring hole — we're badly thin at ${posNoun(a.position)}`) }
  else if (a.need === 'need') { score += 4; pros.push(`Addresses a position of need (${posNoun(a.position)})`) }
  else if (a.need === 'surplus') { score -= 5; cons.push(`We're already deep at ${posNoun(a.position)}`) }

  // ── System fit (skaters) ──
  if (!goalie && a.styleFitScore !== undefined) {
    if (a.styleFitScore >= 78) { score += 5; pros.push(`Tailor-made for our system${a.styleLabel ? ` (${a.styleLabel})` : ''}`) }
    else if (a.styleFitScore >= 64) { score += 2; pros.push('Fits how we play') }
    else if (a.styleFitScore < 48) { score -= 6; cons.push(`Awkward fit for our system${a.styleLabel ? ` (${a.styleLabel})` : ''}`) }
  }

  // ── Risk ──
  if (a.riskBand === 'High') { score -= 6; cons.push('High-variance bet — wide range of outcomes') }
  else if (a.riskBand === 'Low') { score += 2; pros.push('Safe, predictable projection') }

  // ── Value / acquirability ──
  if (a.age <= 21 && a.potentialStars - a.currentStars >= 1) { score += 4; pros.push('Cost-controlled, with room to grow') }
  else if (a.age >= 29 && a.currentStars >= 4) { score -= 6; cons.push('Ageing and expensive — costly to pry loose') }
  else if (a.age >= 27 && a.currentStars >= 3.5) { score -= 3; cons.push('On the wrong side of the aging curve') }

  score = Math.max(0, Math.min(99, Math.round(score)))

  const grade: ProspectGradeLetter =
    score >= 90 ? 'A+' :
    score >= 83 ? 'A' :
    score >= 77 ? 'A-' :
    score >= 71 ? 'B+' :
    score >= 64 ? 'B' :
    score >= 58 ? 'B-' :
    score >= 51 ? 'C+' :
    score >= 44 ? 'C' :
    score >= 37 ? 'C-' :
    score >= 27 ? 'D' : 'F'

  return { grade, score, pros, cons }
}
