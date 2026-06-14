import { describe, expect, it } from 'vitest'
import type { DraftRankRowView } from './views'
import { buildDraftClassArticle } from './draftClassArticle'

function row(rank: number, name: string, position: string, potentialStars = 4): DraftRankRowView {
  return {
    rank, playerId: `p${rank}`, name, teamId: `t${rank}`, teamAbbr: 'TST',
    leagueAbbr: 'WHL', nation: 'Canada', position, age: 18,
    eligibility: 'eligible', currentStars: 2.5, potentialStars,
  }
}

describe('buildDraftClassArticle', () => {
  it('returns null for a thin board', () => {
    expect(buildDraftClassArticle([row(1, 'A', 'C')], 2027)).toBeNull()
  })

  it('headlines the top two and names prospects by position', () => {
    const rows: DraftRankRowView[] = []
    let n = 1
    rows.push(row(n++, 'Gavin McKenna', 'W', 5))
    rows.push(row(n++, 'Ivar Stenberg', 'W', 5))
    for (let i = 0; i < 9; i++) rows.push(row(n++, `Winger ${i}`, 'W'))
    for (let i = 0; i < 6; i++) rows.push(row(n++, `Dman ${i}`, 'D'))
    for (let i = 0; i < 4; i++) rows.push(row(n++, `Centre ${i}`, 'C'))
    for (let i = 0; i < 3; i++) rows.push(row(n++, `Tender ${i}`, 'G'))

    const art = buildDraftClassArticle(rows, 2027)!
    expect(art.headline).toBe('Breaking down the 2027 NHL Draft class')
    expect(art.body).toContain('Gavin McKenna and Ivar Stenberg')
    expect(art.body).toContain('TOP CENTRES')
    expect(art.body).toContain('TOP DEFENCEMEN')
    expect(art.body).toContain('TOP WINGERS')
    expect(art.body).toContain('TOP GOALTENDERS')
    expect(art.body).toContain('Dman 0')
    expect(art.body).toContain('deep on the wing') // 8 wingers in the top 32
  })
})
