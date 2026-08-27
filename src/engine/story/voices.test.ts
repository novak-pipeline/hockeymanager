/**
 * The Voices (FEED-V2-1) — the player-facing claims are TESTS, not hopes:
 * posts fire on the real event, trace back to it, respect the locked scope
 * (user club always, elsewhere only stars), read like real social media in a
 * personality-scaled register, and never repeat verbatim within a season.
 */
import { describe, expect, it } from 'vitest'
import type { Player } from '@domain'
import { Rng } from '@engine/shared/rng'
import { renderTemplate, type ContentUse } from './contentEngine'
import {
  CLUB_DAILY_CAP,
  CLUB_POOL_LIST,
  GM_CONFIDENCE_POOL,
  GM_DEADLINE_POOL,
  VOICE_CTX_KEYS,
  VOICE_DAILY_CAP,
  VOICE_POOLS,
  buildClubPosts,
  buildVoicePosts,
  clubAuthorFor,
  clubHandle,
  gmAuthorFor,
  playerHandle,
  type VoiceEvent,
  type VoiceSubject,
} from './voices'
import type { GmPersona } from '@engine/league/gmPersona'

/* ────────────────────────── fixtures ────────────────────────── */

function makePlayer(over: {
  id?: string
  name?: string
  age?: number
  jersey?: number
  ambition?: number
  professionalism?: number
  loyalty?: number
  temperament?: number
  determination?: number
} = {}): Player {
  return {
    id: over.id ?? 'p1',
    name: over.name ?? 'Tobias Dahl',
    age: over.age ?? 27,
    position: 'C',
    morale: 60,
    jerseyNumber: over.jersey ?? 91,
    personality: {
      ambition: over.ambition ?? 50,
      professionalism: over.professionalism ?? 55,
      loyalty: over.loyalty ?? 55,
      temperament: over.temperament ?? 60,
      determination: over.determination ?? 55,
    },
  } as unknown as Player
}

function subjectFor(p: Player, over: Partial<VoiceSubject> = {}): VoiceSubject {
  return {
    player: p,
    teamId: 't1',
    teamName: 'Harborview Admirals',
    abbr: 'HVA',
    city: 'Harborview',
    isUserClub: true,
    isStar: false,
    ...over,
  }
}

function makePersona(over: Partial<GmPersona> = {}): GmPersona {
  return {
    id: 'gm-t2', teamId: 't2', name: 'Marcus Webb',
    aggression: 0.5, patience: 0.5, riskTolerance: 0.5, pickHoarding: 0.5,
    loyalty: 0.5, capDiscipline: 0.5, analyticsLean: 0.5,
    styleLabel: 'cautious operator', sinceYear: 2025,
    ...over,
  }
}

/** Run one event through the builder with a private ledger. */
function run(ev: Partial<VoiceEvent> & { kind: VoiceEvent['kind'] }, subject: VoiceSubject | null, opts: {
  ledger?: ContentUse[]
  seed?: number
} = {}) {
  return buildVoicePosts({
    events: [{ playerId: 'p1', day: 40, year: 2026, ...ev } as VoiceEvent],
    resolve: () => subject,
    resolveGm: (teamId) => teamId === 't2'
      ? { persona: makePersona(), teamId: 't2', teamName: 'Ridgeline Wolves', abbr: 'RLW', city: 'Ridgeline' }
      : null,
    rng: new Rng(opts.seed ?? 7),
    ledger: opts.ledger ?? [],
    year: 2026,
    day: 40,
  })
}

/** Every slot any voice variant may reference, filled. */
const ALL_SLOTS: Record<string, string> = {
  name: 'Tobias Dahl', first: 'Tobias', last: 'Dahl',
  team: 'Harborview Admirals', abbr: 'HVA', city: 'Harborview',
  n: '500', stat: 'career goals', goals: '3', ahl: 'SPR',
  fromCity: 'Harborview', fromAbbr: 'HVA', toCity: 'Ridgeline', toAbbr: 'RLW',
  years: '4', rust: '3', playerName: 'Tobias Dahl', streak: '6', gmName: 'Marcus Webb',
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u

/** One emoji, counted as a HUMAN sees it: a base pictograph plus its optional
 *  variation selector and any ZWJ-joined parts is ONE. Without this, the heart
 *  and the shrug read as two and three characters and every count is nonsense. */
const EMOJI_CLUSTER = /\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/gu

/* ────────────────────────── library integrity ────────────────────────── */

describe('voices — library integrity', () => {
  it('no variant conditions on a ctx key the builder never populates (dead-content guard)', () => {
    const known = new Set<string>(VOICE_CTX_KEYS)
    for (const [kind, pool] of Object.entries(VOICE_POOLS)) {
      for (const v of pool) {
        for (const key of Object.keys(v.conditions ?? {})) {
          const base = /^(min|max)[A-Z]/.test(key) ? key[3].toLowerCase() + key.slice(4) : key
          expect(known.has(base), `${kind}/${v.id} conditions on unknown ctx key "${base}"`).toBe(true)
        }
      }
    }
  })

  it('every trigger has 8+ authored variants and ids are globally unique', () => {
    const allIds: string[] = []
    for (const [kind, pool] of Object.entries(VOICE_POOLS)) {
      expect(pool.length, `${kind} pool too thin`).toBeGreaterThanOrEqual(8)
      allIds.push(...pool.map((v) => v.id))
    }
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('every pool keeps an unconditional fallback (no personality ever goes silent) AND real personality keys', () => {
    for (const [kind, pool] of Object.entries(VOICE_POOLS)) {
      const unconditional = pool.filter((v) => !v.conditions || Object.keys(v.conditions).length === 0)
      expect(unconditional.length, `${kind} has no fallback — some personality would go silent`).toBeGreaterThanOrEqual(1)
      const keyed = pool.filter((v) => v.conditions && Object.keys(v.conditions).length > 0)
      expect(keyed.length, `${kind} is not personality-keyed — every man would sound the same`).toBeGreaterThanOrEqual(3)
    }
  })

  it('the ambient GM pools hold the same bar: 8+ variants, keyed, and deadline lines never cross stances', () => {
    for (const [label, pool] of [['gmConfidence', GM_CONFIDENCE_POOL], ['gmDeadline', GM_DEADLINE_POOL]] as const) {
      expect(pool.length, `${label} pool too thin`).toBeGreaterThanOrEqual(8)
      for (const v of pool) {
        for (const key of Object.keys(v.conditions ?? {})) {
          const base = /^(min|max)[A-Z]/.test(key) ? key[3].toLowerCase() + key.slice(4) : key
          expect(new Set<string>(VOICE_CTX_KEYS).has(base), `${label}/${v.id} conditions on unknown key "${base}"`).toBe(true)
        }
        const filled = renderTemplate(v.text, ALL_SLOTS)
        expect(filled, `${label}/${v.id} leaves an unfilled slot`).not.toMatch(/\{[a-zA-Z]+\}/)
      }
    }
    // A buyer's line must never serve a seller: every deadline variant declares
    // its stance, and each stance keeps a stance-only fallback.
    for (const v of GM_DEADLINE_POOL) {
      expect(v.conditions?.stance, `${v.id} has no stance — it could fire for the wrong club`).toMatch(/^(buy|sell)$/)
    }
    for (const stance of ['buy', 'sell']) {
      const fallback = GM_DEADLINE_POOL.some((v) => Object.keys(v.conditions ?? {}).length === 1 && v.conditions?.stance === stance)
      expect(fallback, `stance "${stance}" has no fallback`).toBe(true)
    }
  })

  it('every variant renders slot-clean with the documented slots', () => {
    for (const [kind, pool] of Object.entries(VOICE_POOLS)) {
      for (const v of pool) {
        const filled = renderTemplate(v.text, ALL_SLOTS)
        expect(filled, `${kind}/${v.id} leaves an unfilled slot`).not.toMatch(/\{[a-zA-Z]+\}/)
        // >20 chars is the shipped feed's own gate (see salienceHarness) —
        // a rendered post must read as a post, not a fragment.
        expect(filled.length, `${kind}/${v.id} is a stub, not a post`).toBeGreaterThan(20)
      }
    }
  })

// A6 (playtest 2026-08-26): "a bit tooo corny", emoji-heavy. Two rules,
  // enforced here so a future line cannot quietly put the volume back up.
  it('at most ONE emoji per post — nobody stacks them but a parody', () => {
    for (const [kind, pool] of Object.entries(VOICE_POOLS)) {
      for (const v of pool) {
        const clusters = [...v.text.matchAll(EMOJI_CLUSTER)]
        expect(clusters.length, `${kind}/${v.id} stacks emoji: ${clusters.map((c) => c[0]).join('')}`)
          .toBeLessThanOrEqual(1)
      }
    }
  })

  it('a 19-year-old and a 35-year-old do not post alike: every player pool has a veteran register', () => {
    const playerKinds = ['milestone', 'hatTrick', 'firstNhlGoal', 'callup', 'traded', 'signed', 'clinch', 'injuryReturn', 'scratchGripe', 'shopSubtweet', 'meetingGood'] as const
    for (const kind of playerKinds) {
      const pool = VOICE_POOLS[kind]
      const vets = pool.filter((v) => typeof v.conditions?.minAge === 'number' && (v.conditions.minAge as number) >= 29)
      expect(vets.length, `${kind} has no veteran voice — every man in the league sounds 22`).toBeGreaterThanOrEqual(1)
      // And a veteran writes in sentences, not in emoji.
      for (const v of vets) {
        expect(EMOJI_CLUSTER.test(v.text), `${kind}/${v.id} is a veteran line wearing emoji`).toBe(false)
        EMOJI_CLUSTER.lastIndex = 0
      }
    }
  })

  it('the register is real social media: emoji posts AND straight-faced posts coexist in every player pool', () => {
    const playerKinds = ['milestone', 'hatTrick', 'firstNhlGoal', 'callup', 'traded', 'signed', 'clinch', 'injuryReturn', 'scratchGripe', 'shopSubtweet', 'meetingGood'] as const
    for (const kind of playerKinds) {
      const pool = VOICE_POOLS[kind]
      const withEmoji = pool.filter((v) => EMOJI.test(v.text))
      const without = pool.filter((v) => !EMOJI.test(v.text))
      expect(withEmoji.length, `${kind} has no emoji register`).toBeGreaterThanOrEqual(2)
      expect(without.length, `${kind} has no straight register (the quiet vet exists)`).toBeGreaterThanOrEqual(1)
    }
  })
})

/* ────────────────────────── behaviour ────────────────────────── */

describe('voices — buildVoicePosts', () => {
  it('a post fires on the event and traces back to it (facts carry the receipt)', () => {
    const posts = run(
      { kind: 'milestone', numbers: { n: 500, stat: 'career goals' } },
      subjectFor(makePlayer())
    )
    expect(posts.length).toBe(1)
    const p = posts[0]!
    expect(p.authorId).toBe('p:p1')
    expect(p.facts.kind).toBe('voice.milestone')
    expect(p.facts.playerIds).toContain('p1')
    expect(p.facts.numbers.n).toBe(500)
    expect(p.facts.numbers.day).toBe(40)
    expect(p.handle).toBe('TDahl91')
    expect(p.text.length).toBeGreaterThan(12)
  })

  it('scope is the law: user club always, other clubs only stars, relevant overrides', () => {
    const other = (star: boolean) => subjectFor(makePlayer(), { isUserClub: false, isStar: star })
    expect(run({ kind: 'hatTrick', numbers: { goals: 3 } }, other(false)).length).toBe(0)
    expect(run({ kind: 'hatTrick', numbers: { goals: 3 } }, other(true)).length).toBe(1)
    expect(run({ kind: 'hatTrick', numbers: { goals: 3 } }, subjectFor(makePlayer())).length).toBe(1)
    // The queue site can vouch (your traded-away depth man still says goodbye).
    expect(run({ kind: 'hatTrick', numbers: { goals: 3 }, relevant: true }, other(false)).length).toBe(1)
  })

  it('personality scales the voice: a cocky sniper and a quiet vet do not sound alike', () => {
    const cocky = subjectFor(makePlayer({ id: 'a', ambition: 90, professionalism: 30, age: 24 }))
    const vet = subjectFor(makePlayer({ id: 'b', professionalism: 90, age: 33 }))
    const a = run({ kind: 'milestone', playerId: 'a', numbers: { n: 300, stat: 'career goals' } }, cocky)[0]!
    const b = run({ kind: 'milestone', playerId: 'b', numbers: { n: 300, stat: 'career goals' } }, vet)[0]!
    expect(a.text).not.toBe(b.text)
    expect(EMOJI.test(a.text), 'the cocky sniper posts with attitude').toBe(true)
  })

  it('no verbatim repeats within a season — and an exhausted pool recycles rather than going silent', () => {
    const ledger: ContentUse[] = []
    // A personality that unlocks most of the pool (rookie, cocky, fiery,
    // loyal, determined all at once) so freshness is what's under test.
    const subject = subjectFor(makePlayer({
      age: 21, ambition: 90, professionalism: 30, temperament: 30, loyalty: 80, determination: 80,
    }))
    const seen: string[] = []
    // 6 hat tricks in a season: every text distinct while variants last.
    for (let i = 0; i < 6; i++) {
      const posts = run({ kind: 'hatTrick', numbers: { goals: 3 } }, subject, { ledger, seed: 100 + i })
      expect(posts.length, `hat trick #${i + 1} went silent`).toBe(1)
      seen.push(posts[0]!.text)
    }
    expect(new Set(seen).size).toBe(seen.length)
    // Far beyond the pool size, the LRU recycles — the voice never dies.
    for (let i = 0; i < 12; i++) {
      expect(run({ kind: 'hatTrick', numbers: { goals: 3 } }, subject, { ledger, seed: 200 + i }).length).toBe(1)
    }
  })

  it('the daily cap holds — a wild day cannot flood the feed', () => {
    const events: VoiceEvent[] = Array.from({ length: 10 }, (_, i) => ({
      kind: 'hatTrick', playerId: `p${i}`, day: 40, year: 2026, numbers: { goals: 3 },
    }))
    const posts = buildVoicePosts({
      events,
      resolve: (pid) => subjectFor(makePlayer({ id: pid })),
      resolveGm: () => null,
      rng: new Rng(1), ledger: [], year: 2026, day: 40,
    })
    expect(posts.length).toBe(VOICE_DAILY_CAP)
  })

  it('a rival front office announces its acquisition in the GM persona register', () => {
    const posts = run({ kind: 'gmTrade', teamId: 't2', playerId: 'p1', numbers: { playerName: 'Tobias Dahl' } },
      subjectFor(makePlayer(), { isUserClub: false, isStar: true }))
    expect(posts.length).toBe(1)
    const p = posts[0]!
    expect(p.authorId).toBe('gm:t2')
    expect(p.facts.kind).toBe('voice.gmTrade')
    expect(p.facts.teamIds).toContain('t2')
    expect(p.text).toContain('Tobias Dahl')
  })

  it('selection is deterministic for a given seed', () => {
    const subject = subjectFor(makePlayer())
    const a = run({ kind: 'callup', numbers: { ahl: 'SPR' } }, subject, { seed: 9 })[0]!.text
    const b = run({ kind: 'callup', numbers: { ahl: 'SPR' } }, subject, { seed: 9 })[0]!.text
    expect(a).toBe(b)
  })

  it('handles read like real handles', () => {
    expect(playerHandle('Tobias Dahl', 91)).toBe('TDahl91')
    expect(playerHandle('Jean-Pierre Van Dorp', 4)).toBe('JVanDorp4')
    expect(playerHandle('Ilya K', undefined)).toBe('IK')
    const gm = gmAuthorFor(makePersona(), { name: 'Ridgeline Wolves', abbreviation: 'RLW' })
    expect(gm.handle).toBe('WebbRLW')
    expect(gm.kind).toBe('gm')
  })
})

/* ────────────────────────── career integration ────────────────────────── */

describe('voices — career integration', () => {
  it('a call-up queues a voice event and the next story tick publishes his post', async () => {
    const { generateLeague } = await import('@data/generate')
    const { Career } = await import('@engine/career/career')
    const data = generateLeague({ seed: 21 })
    const userId = data.league.teams[0]!
    const c = new Career(data, 21, userId) as unknown as Record<string, any>

    const ahl = [...c.data.teams.values()].find(
      (t: any) => t.tier === 'ahl' && t.parentTeamId === userId
    )
    expect(ahl, 'user org needs an AHL affiliate').toBeDefined()
    // Generated AHL rosters sit exactly at the position minimums, so send a
    // man down first — the real round trip a GM actually makes. A one-way vet
    // can be claimed off waivers on the way, so take the first who lands.
    let forward: any = null
    for (const cand of c.userTeam.roster
      .map((id: any) => c.data.players.get(id))
      .filter((p: any) => p && (p.position === 'C' || p.position === 'W'))
      .reverse()) {
      c.sendDown(cand.id as string)
      if ((ahl as any).roster.includes(cand.id)) { forward = cand; break }
    }
    expect(forward, 'no forward could be assigned to the farm').not.toBeNull()
    c.pendingVoiceEvents = [] // isolate: only the recall's voice is under test

    const res = c.callUp(forward.id as string)
    expect(res.ok, `recall rejected: ${JSON.stringify(res)}`).toBe(true)
    const queued = c.pendingVoiceEvents.filter((e: VoiceEvent) => e.kind === 'callup')
    expect(queued.length).toBe(1)
    expect(queued[0].playerId).toBe(forward.id as string)

    c.runVoices(c.currentDay + 1)
    const post = c.feedPosts.find((p: any) => p.authorId === `p:${forward.id as string}`)
    expect(post, 'the man should have posted about the call').toBeDefined()
    expect(post.headline.startsWith('@')).toBe(true)
    expect(post.channel).toBe('feed')

    // The author directory serves him as a real account.
    const feed = c.getFeed()
    const author = feed.authors[`p:${forward.id as string}`]
    expect(author).toBeDefined()
    expect(author.kind).toBe('player')
    expect(author.name).toBe(forward.name)
  })

  it('the scratch gripe fires ONLY for the fiery or checked-out — the pros eat it in silence', async () => {
    const { generateLeague } = await import('@data/generate')
    const { Career } = await import('@engine/career/career')
    const data = generateLeague({ seed: 22 })
    const userId = data.league.teams[0]!
    const c = new Career(data, 22, userId) as unknown as Record<string, any>

    const [a, b] = c.userTeam.roster.slice(0, 2).map((id: any) => c.data.players.get(id))
    a.personality.temperament = 30 // fiery — he posts
    a.personality.loyalty = 60
    b.personality.temperament = 80 // pro — he doesn't
    b.personality.loyalty = 80

    c.recordWorldAction('scratched', a.id as string)
    c.recordWorldAction('scratched', b.id as string)
    const gripes = c.pendingVoiceEvents.filter((e: VoiceEvent) => e.kind === 'scratchGripe')
    expect(gripes.map((e: VoiceEvent) => e.playerId)).toContain(a.id as string)
    expect(gripes.map((e: VoiceEvent) => e.playerId)).not.toContain(b.id as string)
  })

  it('the shopped man subtweets once the leak breaks — grounded in the Living Ledger', async () => {
    const { generateLeague } = await import('@data/generate')
    const { Career } = await import('@engine/career/career')
    const data = generateLeague({ seed: 23 })
    const userId = data.league.teams[0]!
    const c = new Career(data, 23, userId) as unknown as Record<string, any>

    const p = c.data.players.get(c.userTeam.roster[0])!
    p.morale = 70 // he does NOT want out — the leak will sting
    c.recordWorldAction('shopped', p.id as string, 'open') // open shop leaks immediately
    c.processLedgerReactions(c.currentDay + 1)
    const tweets = c.pendingVoiceEvents.filter((e: VoiceEvent) => e.kind === 'shopSubtweet')
    expect(tweets.length, 'the leak should have produced the subtweet event').toBeGreaterThanOrEqual(1)
    expect(tweets[0].playerId).toBe(p.id as string)
  })

  it('queued voice events survive save/load — a reload cannot swallow a reaction', async () => {
    const { generateLeague } = await import('@data/generate')
    const { Career } = await import('@engine/career/career')
    const data = generateLeague({ seed: 24 })
    const userId = data.league.teams[0]!
    const c = new Career(data, 24, userId) as unknown as Record<string, any>

    const p = c.data.players.get(c.userTeam.roster[0])!
    p.personality.temperament = 25
    c.recordWorldAction('scratched', p.id as string)
    expect(c.pendingVoiceEvents.length).toBeGreaterThanOrEqual(1)

    const snap = c.exportSnapshot('t', 'now')
    const restored = Career.fromSnapshot(structuredClone(snap)) as unknown as Record<string, any>
    expect(restored.pendingVoiceEvents.length).toBe(c.pendingVoiceEvents.length)
    expect(restored.pendingVoiceEvents[0].kind).toBe(c.pendingVoiceEvents[0].kind)
    expect(restored.pendingVoiceEvents[0].playerId).toBe(c.pendingVoiceEvents[0].playerId)
  })
})

/* ────────────────────────── the club accounts (F5) ────────────────────────── */

describe('voices — the official club accounts', () => {
  function runClub(ev: Partial<VoiceEvent> & { kind: VoiceEvent['kind'] }, subject: VoiceSubject | null, opts: {
    ledger?: ContentUse[]
    seed?: number
  } = {}) {
    return buildClubPosts({
      events: [{ playerId: 'p1', day: 40, year: 2026, ...ev } as VoiceEvent],
      resolve: () => subject,
      rng: new Rng(opts.seed ?? 7),
      ledger: opts.ledger ?? [],
      year: 2026,
      day: 40,
    })
  }

  it('the club announces the transaction under its own account, not the player’s', () => {
    const posts = runClub({ kind: 'signed', numbers: { years: 4 } }, subjectFor(makePlayer()))
    expect(posts.length).toBe(1)
    const p = posts[0]!
    expect(p.authorId).toBe('club:t1')
    expect(p.handle).toBe('AdmiralsPR')
    expect(p.facts.kind).toBe('club.signed')
    expect(p.facts.teamIds).toContain('t1')
    expect(p.text).toContain('Tobias Dahl')
  })

  it('a club account and the man himself are two different voices on one event', () => {
    const subject = subjectFor(makePlayer())
    const mine = run({ kind: 'signed', numbers: { years: 4 } }, subject)[0]!
    const club = runClub({ kind: 'signed', numbers: { years: 4 } }, subject)[0]!
    expect(mine.authorId).not.toBe(club.authorId)
    expect(mine.text).not.toBe(club.text)
    // The club always ranks below the man — his post leads the timeline.
    expect(club.score).toBeLessThan(mine.score)
  })

  it('scope holds for clubs too: elsewhere only its stars', () => {
    const other = (star: boolean) => subjectFor(makePlayer(), { isUserClub: false, isStar: star })
    expect(runClub({ kind: 'callup', numbers: { ahl: 'SPR' } }, other(false)).length).toBe(0)
    expect(runClub({ kind: 'callup', numbers: { ahl: 'SPR' } }, other(true)).length).toBe(1)
  })

  it('kinds a comms department would never post stay the player’s own business', () => {
    expect(runClub({ kind: 'scratchGripe' }, subjectFor(makePlayer())).length).toBe(0)
    expect(runClub({ kind: 'shopSubtweet' }, subjectFor(makePlayer())).length).toBe(0)
    expect(runClub({ kind: 'meetingGood' }, subjectFor(makePlayer())).length).toBe(0)
  })

  it('the club cap holds, and every club pool renders slot-clean', () => {
    const events: VoiceEvent[] = Array.from({ length: 8 }, (_, i) => ({
      kind: 'hatTrick', playerId: `p${i}`, day: 40, year: 2026, numbers: { goals: 3 },
    }))
    const posts = buildClubPosts({
      events,
      resolve: (pid) => subjectFor(makePlayer({ id: pid }), { teamId: `t${pid}` }),
      rng: new Rng(3), ledger: [], year: 2026, day: 40,
    })
    expect(posts.length).toBe(CLUB_DAILY_CAP)

    const ids: string[] = []
    const known = new Set<string>(VOICE_CTX_KEYS)
    for (const pool of CLUB_POOL_LIST) {
      // Four is the floor measured against a live timeline: with two, one club
      // ran the same announcement three times in a week.
      expect(pool.length, 'a club pool this thin repeats within a week').toBeGreaterThanOrEqual(4)
      const unconditional = pool.filter((v) => !v.conditions || Object.keys(v.conditions).length === 0)
      expect(unconditional.length, 'a club pool with no fallback could go silent').toBeGreaterThanOrEqual(1)
      for (const v of pool) {
        ids.push(v.id)
        for (const key of Object.keys(v.conditions ?? {})) {
          const base = /^(min|max)[A-Z]/.test(key) ? key[3].toLowerCase() + key.slice(4) : key
          expect(known.has(base), `${v.id} conditions on unknown ctx key "${base}"`).toBe(true)
        }
        const filled = renderTemplate(v.text, ALL_SLOTS)
        expect(filled, `${v.id} leaves an unfilled slot`).not.toMatch(/\{[a-zA-Z]+\}/)
        expect(filled.length, `${v.id} is a stub, not a post`).toBeGreaterThan(20)
      }
    }
    expect(new Set(ids).size, 'club variant ids must be globally unique').toBe(ids.length)
  })

  it('club handles read like real club accounts', () => {
    expect(clubHandle('Harborview Admirals', 'HVA')).toBe('AdmiralsPR')
    expect(clubHandle('Ridgeline Wolves', 'RLW')).toBe('WolvesPR')
    const a = clubAuthorFor({ teamId: 't1', name: 'Harborview Admirals', abbreviation: 'HVA', city: 'Harborview' })
    expect(a.id).toBe('club:t1')
    expect(a.kind).toBe('club')
    expect(a.bio && a.bio.length).toBeGreaterThan(10)
  })
})
