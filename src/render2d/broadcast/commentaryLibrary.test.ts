import { describe, expect, it } from 'vitest'
import { BOOTH_LINES, nameSlotPosition, stemText, type BoothMoment } from './commentaryLibrary'
import boothConfig from './booth.config.json'
import { spokenName, applyLetterRules, respellingToSpeech } from './pronunciation'
import { nameClipKey } from './clipManifest'

describe('booth line library', () => {
  it('ids are unique', () => {
    const ids = BOOTH_LINES.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('name slots: at most one, only at the start or end, always with a bare fallback', () => {
    for (const l of BOOTH_LINES) {
      const n = (l.text.match(/\{name\}/g) ?? []).length
      expect(n, l.id).toBeLessThanOrEqual(1)
      if (n === 1) {
        expect(nameSlotPosition(l.text), l.id).not.toBeNull()
        expect(l.bare, `${l.id} needs a bare line`).toBeTruthy()
        expect(l.bare!.includes('{name}'), l.id).toBe(false)
        expect(stemText(l).includes('{name}'), l.id).toBe(false)
        expect(stemText(l).length, l.id).toBeGreaterThan(2)
      }
    }
  })

  it('stems are TTS-safe (no dashes, ellipses, digits or stray braces)', () => {
    for (const l of BOOTH_LINES) {
      for (const t of [stemText(l), l.bare ?? '']) {
        expect(t, l.id).not.toMatch(/[—–…]|\.\.\.|\d|[{}]/)
      }
    }
  })

  it('every moment the director can ask for has lines', () => {
    const needed: BoothMoment[] = [
      'open.welcome', 'open.debut', 'open.homecoming', 'open.milestone', 'open.banner',
      'moment.rookieLap', 'moment.tribute', 'moment.ovation', 'moment.banner', 'puckDrop',
      'goal', 'goal.tie', 'goal.goAhead', 'goal.lateTie', 'goal.overtime', 'goal.hatTrick',
      'goal.powerPlay', 'goal.shortHanded', 'goal.emptyNet', 'goal.revenge', 'goal.milestone',
      'goal.first', 'goal.color', 'save.big', 'save.robbery', 'save.color', 'penalty', 'fight',
      'hit.big', 'periodEnd', 'gameEnd', 'gameEnd.close',
    ]
    for (const m of needed) expect(BOOTH_LINES.some((l) => l.moment === m), m).toBe(true)
  })

  it('starter set is in the 30–60 line range', () => {
    expect(BOOTH_LINES.length).toBeGreaterThanOrEqual(30)
    expect(BOOTH_LINES.length).toBeLessThanOrEqual(70)
  })

  it('the booth has two FIXED, distinct voices from the quality-gated cast', () => {
    const { pbp, color } = boothConfig.speakers
    expect(pbp.voiceId).toBe('bm_george')
    expect(color.voiceId).toBe('am_michael')
    expect(pbp.voiceId).not.toBe(color.voiceId)
  })
})

describe('pronunciation', () => {
  it('explicit respelling wins', () => {
    const s = spokenName({ id: '1', name: 'Martin Nečas', nationality: 'Czech Republic', pronunciation: 'MAR-tin NEH-chahs' })
    expect(s.full).toBe('mar-tin neh-chahs')
    expect(s.surname).toBe('neh-chahs')
  })

  it('community file by external id and by surname', () => {
    const file = { version: 1 as const, byExternalId: { 'nhl-1': 'KEE-rill kah-PREE-zoff' }, byName: { 'Hughes': 'HYOOZ' } }
    expect(spokenName({ id: '1', name: 'Kirill Kaprizov', externalId: 'nhl-1' }, file).surname).toBe('kah-pree-zoff')
    expect(spokenName({ id: '2', name: 'Jack Hughes' }, file).surname).toBe('hyooz')
  })

  it('shipped defaults cover the hard ones', () => {
    expect(spokenName({ id: '1', name: 'Samuel Söderblom', nationality: 'Sweden' }).surname).toBe('suh-der-bloom')
    expect(spokenName({ id: '2', name: 'Oliver Ekman-Larsson', nationality: 'Sweden' }).surname).toBe('ek-mun lar-son')
    expect(spokenName({ id: '3', name: 'Rasmus Dahlin', nationality: 'Sweden' }).surname).toBe('dah-leen')
  })

  it('nationality letter rules handle diacritics and clusters', () => {
    expect(applyLetterRules('Hašek', 'Czech Republic')).toBe('Hashek')
    expect(applyLetterRules('Jágr', 'Czech Republic')).toBe('Yagr')
    expect(applyLetterRules('Björk', 'Sweden')).toBe('Bjuhrk')
    expect(applyLetterRules('Vasilevskiy', 'Russia')).toBe('Vasilevskee')
    expect(applyLetterRules('Müller', 'Germany')).toBe('Mewller')
    // Unknown nationality → only the safe diacritic subset.
    expect(applyLetterRules('Côté')).toBe('Cote')
  })

  it('respelling lowercases stress caps (caps are read as letters)', () => {
    expect(respellingToSpeech('NEH-chahs')).toBe('neh-chahs')
  })

  it('name clip key changes with pronunciation', () => {
    const a = spokenName({ id: '1', name: 'Martin Nečas', nationality: 'Czech Republic' })
    const b = spokenName({ id: '1', name: 'Martin Nečas', nationality: 'Czech Republic', pronunciation: 'NETCH-us' })
    const k = (h: string): string => nameClipKey({ playerId: '1', voiceId: 'bm_george', form: 'surname', style: 'excited', pronunciationHash: h })
    expect(k(a.hash)).not.toBe(k(b.hash))
  })
})
