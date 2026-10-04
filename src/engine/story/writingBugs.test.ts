/**
 * Writing audit 2026-10 — the ship-blocker text bugs, each pinned so it cannot
 * come back: unfilled scene slots, doubled club names, the wrong person in a
 * scene headline, an outcome that contradicts the button, and the mechanical
 * plural / article bugs.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { clubDisplayName } from '@data/modSchema'
import { Career } from '@engine/career/career'
import { outcomeLine } from '@engine/league/interactions'
import { CLUB_SCENES } from './clubScenes'
import { DECISION_EVENTS, decisionSlots, sceneHeadline } from './decisionEvents'
import { renderTemplate, tidyProse } from './contentEngine'
import { aOrAn, feedPostHeadline, plural } from './prose'

describe('doubled club names (F12)', () => {
  it.each([
    ['Omsk', 'Omsk', 'Omsk'],
    ['Nizhny Novgorod', 'Novgorod', 'Nizhny Novgorod'],
    ['Hradec Kralove', 'Králové', 'Hradec Kralove'],
    ['Ambri', 'Ambrì-Piotta', 'Ambrì-Piotta'],
    ['Toronto', 'Maple Leafs', 'Toronto Maple Leafs'],
    ['Hershey', 'Bears', 'Hershey Bears'],
  ])('%s + %s → %s', (city, nick, want) => {
    expect(clubDisplayName(city, nick)).toBe(want)
  })
})

describe('scene slots and headlines', () => {
  const player = generateLeague({ seed: 7 }).players.values().next().value!
  const slots = decisionSlots(player, 412, 'Florida Panthers')

  it('every scene outcome renders with no unfilled slot (F2: "{last} nodded")', () => {
    for (const ev of [...DECISION_EVENTS, ...CLUB_SCENES]) {
      for (const o of ev.options) expect(renderTemplate(o.outcome, slots), `${ev.id}:${o.id}`).not.toMatch(/\{[a-zA-Z.]+\}/)
    }
  })

  it('the headline names whoever raises it (F3)', () => {
    for (const ev of DECISION_EVENTS) {
      const h = renderTemplate(sceneHeadline(ev), slots)
      expect(h, ev.id).not.toMatch(/\{/)
      if (ev.speaker && ev.speaker !== 'player') expect(h, ev.id).not.toMatch(/is waiting in your office/)
    }
    const owner = DECISION_EVENTS.find((e) => e.id === 'ev.owner.sell-the-fans-a-story')!
    expect(renderTemplate(sceneHeadline(owner), slots)).toMatch(/owner/i)
  })

  it('a resolved club scene receipt never prints a raw slot', () => {
    const data = generateLeague({ seed: 11 })
    const career = new Career(data, 11, data.league.teams[0]!)
    const c = career as unknown as {
      interactions: Array<Record<string, unknown>>
      interactionCounter: number
      decisionEventFor: Map<string, string>
      userTeamId: string
      userTeam: { roster: string[] }
      year: number
      currentDay: number
    }
    const ev = CLUB_SCENES.find((e) => e.options.some((o) => o.outcome.includes('{last}')))!
    const opt = ev.options.find((o) => o.outcome.includes('{last}'))!
    const pid = c.userTeam.roster[0] as string
    const id = `i${c.interactionCounter++}`
    c.interactions.unshift({
      id, playerId: pid, teamId: c.userTeamId, year: c.year, day: c.currentDay,
      kind: 'unhappy', severity: 'serious', message: ev.scene, scene: true,
      options: ev.options.map((o) => ({ id: o.id, label: o.label, tone: 'firm' })), status: 'open',
    })
    c.decisionEventFor.set(id, ev.id)
    const r = career.respondToInteraction(id, opt.id)
    expect(r.ok).toBe(true)
    expect(r.message).not.toMatch(/\{last\}/)
  })
})

describe('concern outcomes agree with the button (F7)', () => {
  it('"Tell him to sort it out himself" never reads as "appreciated being heard"', () => {
    for (const d of [-20, -5, 0, 3, 12]) {
      const line = outcomeLine('feud', 'firm', d, 'Lundell')
      expect(line).not.toMatch(/being heard|reassured/)
      expect(line).toMatch(/Lundell/)
    }
  })
  it('firm and dismissive answers are never narrated as reassurance', () => {
    for (const kind of ['tradeRequest', 'future', 'iceTime', 'unhappy'] as const) {
      for (const tone of ['firm', 'dismissive'] as const) {
        for (const d of [-20, -5, 0, 3, 12]) expect(outcomeLine(kind, tone, d, 'X')).not.toMatch(/being heard|reassured|lighter/)
      }
    }
  })
})

describe('mechanics', () => {
  it('articles by sound', () => {
    expect(aOrAn('8-game')).toBe('an')
    expect(aOrAn('11-game')).toBe('an')
    expect(aOrAn('18-year-old')).toBe('an')
    expect(aOrAn('84')).toBe('an')
    expect(aOrAn('A+')).toBe('an')
    expect(aOrAn('B')).toBe('a')
    expect(aOrAn('7-game')).toBe('a')
    expect(aOrAn('offensive')).toBe('an')
  })
  it('the safety net fixes what a number slot does to a template', () => {
    expect(tidyProse('Weiermair in a 8-game point drought')).toBe('Weiermair in an 8-game point drought')
    expect(tidyProse('filed as a A+.')).toBe('filed as an A+.')
    expect(tidyProse('He has 1 points in 1 games.')).toBe('He has 1 point in 1 game.')
    expect(tidyProse('He has 21 points in 11 games.')).toBe('He has 21 points in 11 games.')
    expect(plural(1, 'point')).toBe('1 point')
  })
  it('a Feed post headline is the story, not the handle', () => {
    const h = feedPostHeadline('Carver Notes', 'Hearing Dallas has asked about Rielly. Nothing close.')
    expect(h).toBe('Carver Notes: Hearing Dallas has asked about Rielly')
    expect(h.startsWith('@')).toBe(false)
  })
})
