/**
 * Live story layer, end to end on a real career: the facts the career hands
 * the watched game are the facts the save holds, and every beat the planner
 * places on a real stream is backed by them.
 */
import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { asPlayerId } from '@domain'
import { planLiveStory } from '@engine/story/liveStory'
import { Career } from './career'

describe('Career — live story facts', () => {
  it('gathers true facts and the planner places backed beats on real streams', () => {
    const data = generateLeague({ seed: 7171 })
    const userId = data.league.teams[2]!
    const career = new Career(data, 7171, userId)
    const self = career as unknown as {
      pointStreaks: Map<string, number>
      scorelessStreaks: Map<string, number>
      shutoutRuns: Map<string, number>
    }
    const samples: string[] = []
    let watched = 0
    let beatsSeen = 0
    // Into the season first, so streaks, series and contract years exist.
    career.advance(35)
    const { user, others } = career.devClubIds()
    for (let i = 0; i < 8; i++) {
      const opp = others[(i * 5) % others.length]!
      const home = i % 2 === 0 ? user : opp
      const away = i % 2 === 0 ? opp : user
      const game = career.devExhibition(home, away, 900 + i, 'classic')
      const ctx = career.getBroadcastContext()
      if (!ctx?.liveStory) continue
      watched++
      const f = ctx.liveStory
      // The facts are the save's own numbers (an exhibition applies nothing,
      // so the counters still stand as they were before the puck dropped).
      expect(f.userSide).not.toBeNull()
      for (const p of f.players) {
        if (p.position === 'G') {
          expect(p.goalie!.shutoutRun).toBe(self.shutoutRuns.get(p.id) ?? 0)
          continue
        }
        expect(p.pointStreak, p.name).toBe(self.pointStreaks.get(p.id) ?? 0)
        expect(p.scorelessStreak, p.name).toBe(self.scorelessStreaks.get(p.id) ?? 0)
        const pl = data.players.get(asPlayerId(p.id))!
        expect(!!p.contractYear).toBe(pl.contract.yearsRemaining <= 1 && pl.contract.salary > 0)
      }
      expect(f.bench?.side).toBe(f.userSide)
      for (const p of f.players) {
        expect(ctx.players[p.id], p.id).toBeDefined()
        expect(p.name).toBe(data.players.get(asPlayerId(p.id))?.name)
        if (p.contractYear) expect(f.playoff).toBe(false)
        if (p.position === 'G') expect(p.pointStreak).toBe(0)
      }
      for (const id of f.bench?.debutIds ?? []) {
        const p = f.players.find((x) => x.id === id)!
        expect(p.careerKnown).toBe(true)
        expect(p.career.gamesPlayed).toBe(0)
      }
      for (const s of f.seasonSeries) {
        expect([f.homeAbbr, f.awayAbbr]).toContain(s.homeAbbr)
        expect([f.homeAbbr, f.awayAbbr]).toContain(s.awayAbbr)
      }

      const plan = planLiveStory(game.stream, f)
      for (const b of plan.beats) {
        beatsSeen++
        expect(b.text, b.id).not.toMatch(/\{|\}|undefined|NaN|\b1 games\b|\b1 points\b/)
        if (b.playerId) expect(f.players.find((p) => p.id === b.playerId), b.id).toBeDefined()
        if (b.channel === 'bench') expect(b.side).toBe(f.userSide)
        if (b.playerId && b.channel === 'lowerThird') {
          // The name on the card is the man the card is about.
          expect(b.text).toContain(f.players.find((p) => p.id === b.playerId)!.name.split(' ').pop()!)
        }
        samples.push(`[${b.channel === 'bench' ? 'BENCH' : b.title}] ${b.text}`)
      }
      for (const [p, beats] of Object.entries(plan.room)) {
        for (const r of beats) {
          expect(r.text).not.toMatch(/\{|\}|undefined|NaN/)
          samples.push(`[ROOM after P${p} · ${r.speaker}] ${r.text}`)
        }
      }
    }
    expect(watched).toBeGreaterThan(5)
    expect(beatsSeen).toBeGreaterThan(0)
    // Streak maps exist and carry the counters the cards quote.
    expect(self.pointStreaks.size + self.scorelessStreaks.size).toBeGreaterThan(0)
    if (process.env.LIVE_STORY_SAMPLES) writeFileSync(process.env.LIVE_STORY_SAMPLES, samples.join('\n') + '\n')
  }, 240_000)
})
