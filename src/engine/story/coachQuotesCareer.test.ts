/**
 * Integration tests: coach-quote items appear in the inbox after appropriate
 * career events. Simulates a full stretch of regular-season games and checks
 * that at least one coach-quote NewsItem (with speaker set) appears.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'

describe('coach quotes — career integration', () => {
  it('generates at least one coach-quote inbox item over a season stretch', () => {
    // Advance enough days that a big win or bad loss (≥3 goal margin) is likely.
    // We run 30 days; with real NHL odds a 3-goal margin happens ~25% of games.
    const seed = 42
    const data = generateLeague({ seed })
    const userId = data.league.teams[0]!
    const career = new Career(data, seed, userId)

    let days = 0
    while (days < 30 && career.advanceDay()) days++

    const inbox = career.getInbox()
    const coachItems = inbox.items.filter((n) => n.speaker !== undefined)

    // Must have at least one coach quote over 30 match days
    expect(coachItems.length, 'expected at least one coach-quote item').toBeGreaterThan(0)
  })

  it('coach-quote items always have speaker set and a non-empty body', () => {
    const seed = 7
    const data = generateLeague({ seed })
    const userId = data.league.teams[1]!
    const career = new Career(data, seed, userId)

    let days = 0
    while (days < 40 && career.advanceDay()) days++

    const inbox = career.getInbox()
    for (const item of inbox.items.filter((n) => n.speaker !== undefined)) {
      expect(item.speaker, 'speaker should be non-empty').toBeTruthy()
      expect(item.body.length, 'body should be a non-trivial quote').toBeGreaterThan(20)
      // Quote should not have unreplaced template tokens
      expect(item.body).not.toMatch(/\{[a-z]+\}/)
    }
  })

  it('coach-quote items have teamId set to the user team', () => {
    const seed = 13
    const data = generateLeague({ seed })
    const userId = data.league.teams[3]!
    const career = new Career(data, seed, userId)

    let days = 0
    while (days < 25 && career.advanceDay()) days++

    const inbox = career.getInbox()
    for (const item of inbox.items.filter((n) => n.speaker !== undefined)) {
      expect(item.teamId, 'coach items should be scoped to the user team').toBe(userId as string)
    }
  })

  it('two careers with the same seed produce the same coach-quote items (determinism)', () => {
    const seed = 99
    const data1 = generateLeague({ seed })
    const data2 = generateLeague({ seed })
    const userId1 = data1.league.teams[0]!
    const userId2 = data2.league.teams[0]!

    const c1 = new Career(data1, seed, userId1)
    const c2 = new Career(data2, seed, userId2)

    for (let i = 0; i < 15; i++) {
      c1.advanceDay()
      c2.advanceDay()
    }

    const items1 = c1.getInbox().items.filter((n) => n.speaker !== undefined).map((n) => n.body)
    const items2 = c2.getInbox().items.filter((n) => n.speaker !== undefined).map((n) => n.body)
    expect(items1).toEqual(items2)
  })

  it('snapshot round-trip preserves speaker and speakerFaceId on coach-quote items', () => {
    const seed = 55
    const data = generateLeague({ seed })
    const userId = data.league.teams[2]!
    const career = new Career(data, seed, userId)

    // Advance until we have at least one coach-quote item, or 30 days max
    let days = 0
    while (days < 30 && career.advanceDay()) {
      days++
      if (career.getInbox().items.some((n) => n.speaker !== undefined)) break
    }

    const snap = career.exportSnapshot('test')
    const data2 = generateLeague({ seed })
    const restored = Career.fromSnapshot(snap, data2)
    const inbox = restored.getInbox()

    // Every coach-quote item from the original should be in the restored inbox too
    const origItems = career.getInbox().items.filter((n) => n.speaker !== undefined)
    const restoredItems = inbox.items.filter((n) => n.speaker !== undefined)

    expect(restoredItems.length).toBe(origItems.length)
    for (let i = 0; i < origItems.length; i++) {
      const orig = origItems[i]!
      const rest = restoredItems[i]!
      expect(rest.speaker).toBe(orig.speaker)
      expect(rest.body).toBe(orig.body)
      // speakerFaceId may be undefined when coach has no facepack; just check it round-trips
      expect(rest.speakerFaceId).toBe(orig.speakerFaceId)
    }
  })
})
