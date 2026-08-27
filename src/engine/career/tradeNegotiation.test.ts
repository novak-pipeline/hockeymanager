/**
 * End-to-end: a trade negotiation is a conversation with memory.
 *
 * The playtest bug: "when receiving a counter offer in a trade it uses the same
 * base dialogue for 'we want this player'." These drive the real Career API and
 * check that round two sounds like round two, that a GM ground down long enough
 * walks, and that a negotiation in progress survives a reload.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { playerValue } from '@engine/league/trades'
import { Career } from './career'

interface Deal {
  pid: string
  give: string
  recv: string
}

/**
 * Find a package that draws a COUNTER rather than a handshake. The evaluation
 * folds in philosophy, posture and a mood wiggle, so a value ratio alone won't
 * do it — we use the non-binding gauge (which never mutates) to spot a "tepid"
 * read, then send it for real and require it to be taken under advisement.
 */
function findLiveTalks(c: Career, data: ReturnType<typeof generateLeague>, userId: string): Deal | null {
  const userPlayers = data.teams
    .get(userId as never)!
    .roster.map((id) => data.players.get(id)!)
    .filter((p) => p && !p.contract.noTradeClause && p.injuryStatus === null)
  for (const pid of data.league.teams) {
    if ((pid as string) === userId) continue
    const partner = data.teams.get(pid)!
    for (const R of partner.roster.map((id) => data.players.get(id)!).filter(Boolean)) {
      if (R.contract.noTradeClause || R.injuryStatus !== null) continue
      const rv = playerValue(R)
      for (const give of userPlayers) {
        const v = playerValue(give)
        if (v < rv * 0.85 || v > rv * 1.15) continue
        const proposal = {
          partnerTeamId: pid as string,
          givePlayerIds: [give.id as string],
          givePickIds: [] as string[],
          receivePlayerIds: [R.id as string],
          receivePickIds: [] as string[],
        }
        // 'tepid' is the counter lean — he wants more, he isn't shaking on it.
        if (c.gaugeTradeInterest(proposal).lean !== 'tepid') continue
        if (c.proposeTrade(proposal).verdict !== 'pending') continue
        return { pid: pid as string, give: give.id as string, recv: R.id as string }
      }
    }
  }
  return null
}

/** Run the days until the partner's answer lands, and hand back what he said. */
function hearBack(c: Career, seenOfferIds: Set<string>): { message: string | null; offerId: string | null } {
  for (let g = 0; g < 6; g++) {
    c.advanceOffseason()
    const fresh = c.getTrades().incoming.find((o) => !seenOfferIds.has(o.offerId))
    if (fresh) {
      seenOfferIds.add(fresh.offerId)
      return { message: fresh.message, offerId: fresh.offerId }
    }
  }
  return { message: null, offerId: null }
}

const SPEAKER_PREFIX = /^[A-Z][\w.'-]*(\s[A-Z][\w.'-]*)*:\s/

describe('a negotiation remembers the last call', () => {
  it('never says the same thing twice in one conversation', () => {
    let checked = 0
    for (const seed of [4242, 3131, 909, 55, 616]) {
      const data = generateLeague({ seed })
      const userId = data.league.teams[0]! as string
      const c = new Career(data, seed, userId as never)
      c.startAtOffseason()
      const deal = findLiveTalks(c, data, userId)
      if (!deal) continue

      const seen = new Set(c.getTrades().incoming.map((o) => o.offerId))
      const said: string[] = []
      const first = hearBack(c, seen)
      if (first.message) said.push(first.message)

      // Keep pushing the SAME pursuit back at him. Each answer must be new.
      for (let r = 0; r < 4; r++) {
        const ev = c.proposeTrade({
          partnerTeamId: deal.pid,
          givePlayerIds: [deal.give],
          givePickIds: [],
          receivePlayerIds: [deal.recv],
          receivePickIds: [],
        })
        if (ev.verdict === 'reject') {
          said.push(ev.message)
          continue
        }
        const answer = hearBack(c, seen)
        if (answer.message) said.push(answer.message)
      }

      expect(said.length, `seed ${seed}`).toBeGreaterThanOrEqual(2)
      expect(new Set(said).size, `seed ${seed} repeated a line`).toBe(said.length)
      for (const line of said) {
        // It is SPOKEN — no "Marcus Webb:" prefix for the phone to read aloud,
        // and no unfilled template slots.
        expect(line, `seed ${seed}`).not.toMatch(SPEAKER_PREFIX)
        expect(line, `seed ${seed}`).not.toMatch(/[{}]/)
        expect(line.length).toBeGreaterThan(15)
      }
      checked++
    }
    expect(checked, 'no seed produced live trade talks').toBeGreaterThan(0)
  })

  it('a GM who is wasted long enough walks away, and stays gone', () => {
    let walkedSomewhere = false
    for (const seed of [4242, 3131, 909, 55, 616, 777]) {
      const data = generateLeague({ seed })
      const userId = data.league.teams[0]! as string
      const c = new Career(data, seed, userId as never)
      c.startAtOffseason()
      const deal = findLiveTalks(c, data, userId)
      if (!deal) continue

      const seen = new Set(c.getTrades().incoming.map((o) => o.offerId))
      hearBack(c, seen)
      // Send the identical package back at him over and over: stalling drains
      // patience fastest, which is the whole point of tracking it.
      let walkLine: string | null = null
      for (let r = 0; r < 10 && !walkLine; r++) {
        c.proposeTrade({
          partnerTeamId: deal.pid,
          givePlayerIds: [deal.give],
          givePickIds: [],
          receivePlayerIds: [deal.recv],
          receivePickIds: [],
        })
        hearBack(c, seen)
        const news = c.getInbox().items.find((n) => /walks away/i.test(n.headline))
        if (news) walkLine = news.body
      }
      if (!walkLine) continue
      walkedSomewhere = true
      expect(walkLine.length).toBeGreaterThan(20)
      // A news CARD attributes the speaker (news is never read aloud); the
      // quoted words inside it are the spoken line and carry no prefix.
      expect(walkLine).toMatch(/^[^:]+: “.+”$/)
      expect(/“(.+)”/.exec(walkLine)![1]!).not.toMatch(SPEAKER_PREFIX)

      // Dial him straight back and he tells you where to go — in different
      // words from the ones he hung up on.
      const again = c.proposeTrade({
        partnerTeamId: deal.pid,
        givePlayerIds: [deal.give],
        givePickIds: [],
        receivePlayerIds: [deal.recv],
        receivePickIds: [],
      })
      expect(again.verdict).toBe('reject')
      expect(again.message).not.toBe(walkLine)
      expect(again.message.length).toBeGreaterThan(15)
      break
    }
    expect(walkedSomewhere, 'no GM ever walked away').toBe(true)
  })

  it('a negotiation in progress survives a reload with its round intact', () => {
    for (const seed of [4242, 3131, 909, 55]) {
      const data = generateLeague({ seed })
      const userId = data.league.teams[0]! as string
      const c = new Career(data, seed, userId as never)
      c.startAtOffseason()
      const deal = findLiveTalks(c, data, userId)
      if (!deal) continue

      const live = (c as unknown as { tradeThreads: Array<{ key: string; round: number }> })
        .tradeThreads
      const spent = live.filter((t) => t.round > 0)
      // A package he'd simply accept ends the conversation rather than
      // advancing it — that seed has nothing in progress to reload.
      if (spent.length === 0) continue

      const snap = c.exportSnapshot('save', '2030-01-01')
      expect(snap.tradeThreads).toBeTruthy()
      const reloaded = Career.fromSnapshot(JSON.parse(JSON.stringify(snap)))
      const after = (reloaded as unknown as { tradeThreads: Array<{ key: string; round: number }> })
        .tradeThreads
      expect(after).toEqual(live)
      // The rounds he already spent are still spent — a reload is not a reset.
      for (const t of spent) {
        expect(after.find((x) => x.key === t.key)?.round).toBe(t.round)
      }
      return
    }
    throw new Error('no seed produced live trade talks')
  })
})
