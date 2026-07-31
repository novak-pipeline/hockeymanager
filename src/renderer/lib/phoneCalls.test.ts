import { describe, expect, it } from 'vitest'
import { DECISION_EVENTS } from '@engine/story/decisionEvents'
import type { InboxView, OwnerRequestView, PlayerInteractionView } from '../../worker/protocol'
import type { StaffView, TradesView } from '@engine/career/views'
import { callFromInteraction, hashStr, pickCall, spokenFromScene } from './phoneCalls'
import { chunkForSpeech } from './kokoroVoice'

/* ── fixtures ───────────────────────────────────────────────────────────── */

const NONE = new Set<string>()

function concern(over: Partial<PlayerInteractionView> = {}): PlayerInteractionView {
  return {
    id: 'i1',
    playerId: 'p1',
    playerName: 'Erik Karlsson',
    kind: 'tradeRequest',
    severity: 'serious',
    message: `I need to be straight with you — I'm not happy here. I want out.`,
    day: 40,
    year: 2026,
    options: [],
    ...over,
  }
}

const STAFF = {
  owner: { name: 'Ronald Burkle', faceId: 'f9' },
} as unknown as StaffView

function inboxOf(...interactions: PlayerInteractionView[]): InboxView {
  return { items: [], unread: 0, interactions }
}

function tradesOf(over: Partial<TradesView['incoming'][number]> = {}): TradesView {
  return {
    incoming: [{
      offerId: 'o7',
      receive: {
        teamId: 't2', teamName: 'Nashville Predators', teamAbbr: 'NSH',
        players: [], picks: [],
      },
      give: {
        teamId: 't1', teamName: 'Pittsburgh Penguins', teamAbbr: 'PIT',
        players: [{ playerId: 'p1', name: 'Erik Karlsson', overall: 84 }],
        picks: [],
      },
      message: 'Nashville Predators are after Erik Karlsson. On the table: a 2027 1st.',
      gmName: 'Barry Trotz',
      spoken: `I'll get straight to it. We want Erik Karlsson. We'll put up a 2027 1st.`,
      expiresOnDay: 50,
      ...over,
    }],
  } as unknown as TradesView
}

const OWNER: OwnerRequestView = {
  kind: 'trimPayroll',
  title: 'The owner wants the payroll trimmed',
  body: 'The owner is looking at the balance sheet and wants the wage bill cut — "We are bleeding money." Moving salary pleases ownership.',
  spoken: `I've got the balance sheet in front of me and we are bleeding money. Find me the salary and move it.`,
  acceptHint: '', declineHint: '',
}

/* ── the rule: only speak what is actually said ─────────────────────────── */

describe('spokenFromScene', () => {
  it('lifts a full quoted utterance out of narrated prose', () => {
    const scene =
      `Karlsson closed the office door behind him. 900 games in this league, and he didn't sit down. ` +
      `"Just tell me straight — am I done here, or am I in your plans? I've earned the truth either way."`
    expect(spokenFromScene(scene)).toBe(
      `Just tell me straight — am I done here, or am I in your plans? I've earned the truth either way.`,
    )
  })

  it('returns null for a scene where nobody speaks — nobody is on the line', () => {
    expect(spokenFromScene(
      `Two clubs have called about Karlsson in as many days, and the second offer was serious. The deadline is Friday.`,
    )).toBeNull()
  })

  it('rejects a quoted fragment lifted out of a sentence', () => {
    // "something to announce" is not an utterance — it's three words inside prose.
    expect(spokenFromScene(
      `The owner's office called. He wants "something to announce." Not a plan — an announcement.`,
    )).toBeNull()
  })

  it('rejects a quoted newspaper phrase (no terminal punctuation)', () => {
    expect(spokenFromScene(
      `A columnist wrote that your club has "no identity and no urgency," and named Karlsson.`,
    )).toBeNull()
  })

  it('takes the LAST speaker when a scene has two, so words land in the right mouth', () => {
    const scene =
      `The question came on the record: "Are you trying to win these games?" You gave an answer. ` +
      `Karlsson read it on the bus: "The guys want to know what that means. I told them I'd ask you instead of guessing."`
    expect(spokenFromScene(scene)).toBe(
      `The guys want to know what that means. I told them I'd ask you instead of guessing.`,
    )
  })

  it('handles curly quotes', () => {
    expect(spokenFromScene(`He shrugged. “I'd like to stay, and I'd like to hear you say the same.”`))
      .toBe(`I'd like to stay, and I'd like to hear you say the same.`)
  })
})

/* ── the authored library must survive the rule ─────────────────────────── */

describe('DECISION_EVENTS against the phone rule', () => {
  it('every scene either has a real spoken line or has nobody on the line', () => {
    // Regression guard: this asserts the split is deliberate. If a new event's
    // dialogue is written so the extractor can't find it, this count moves and
    // the author gets told before the GM hears narration read aloud.
    const rings = DECISION_EVENTS.filter((e) => spokenFromScene(e.scene) !== null)
    expect(rings.length).toBeGreaterThanOrEqual(15)
    expect(DECISION_EVENTS.length - rings.length).toBeLessThanOrEqual(6)
  })

  it('a spoken line is never narration — it never refers to the GM in the second person as prose', () => {
    for (const e of DECISION_EVENTS) {
      const line = spokenFromScene(e.scene)
      if (!line) continue
      // Narration in this library always sits OUTSIDE the quotes, so a lifted
      // line must not carry the scene's stage directions with it.
      expect(line).not.toContain('"')
      expect(line.length).toBeGreaterThan(20)
    }
  })

  it('the scene the GM praised — a shopped man asking to stay — still rings', () => {
    const ev = DECISION_EVENTS.find((e) => e.id === 'ev.room.returning-face')
    expect(ev).toBeDefined()
    expect(spokenFromScene(ev!.scene)).toContain(`I'd like to stay`)
  })

  it('a reporter’s question is attributed to the press, not to the player', () => {
    expect(DECISION_EVENTS.find((e) => e.id === 'ev.media.trade-block-question')?.speaker).toBe('press')
    expect(DECISION_EVENTS.find((e) => e.id === 'ev.owner.streak-ultimatum')?.speaker).toBe('owner')
    expect(DECISION_EVENTS.find((e) => e.id === 'ev.contract.young-star-early-extension')?.speaker).toBe('agent')
  })
})

/* ── who rings, and as whom ─────────────────────────────────────────────── */

describe('callFromInteraction', () => {
  it('speaks a plain concern whole — it is already the player’s own words', () => {
    const c = callFromInteraction(concern(), STAFF)
    expect(c?.spoken).toBe(concern().message)
    expect(c?.callerName).toBe('Erik Karlsson')
    expect(c?.voice).toBe('player')
  })

  it('lifts the dialogue out of an office scene rather than voicing the prose', () => {
    const c = callFromInteraction(concern({
      scene: true,
      message: `Karlsson caught you in the hallway, still in his gear. "Third time this month you've pulled me. I need to know where I stand."`,
    }), STAFF)
    expect(c?.spoken).toBe(`Third time this month you've pulled me. I need to know where I stand.`)
    expect(c?.spoken).not.toContain('hallway')
  })

  it('does not ring at all for a scene that is pure narration', () => {
    expect(callFromInteraction(concern({
      scene: true,
      message: `Karlsson has started 40 of your last 45 and his numbers have quietly fallen off a cliff.`,
    }), STAFF)).toBeNull()
  })

  it('puts the owner’s name, face and voice on an owner-spoken scene', () => {
    const c = callFromInteraction(concern({
      scene: true, speaker: 'owner',
      message: `The owner called at seven in the morning. "I want to hear that somebody is accountable, and I want to hear it today."`,
    }), STAFF)
    expect(c?.callerName).toBe('Ronald Burkle')
    expect(c?.faceId).toBe('f9')
    expect(c?.voice).toBe('owner')
  })

  it('puts an agent’s scene in the agent’s mouth, not the player’s', () => {
    const c = callFromInteraction(concern({
      scene: true, speaker: 'agent',
      message: `His agent floated something unusual. "He likes it here. That discount has an expiry date, and it's June."`,
    }), STAFF)
    expect(c?.callerName).toBe(`Erik Karlsson's agent`)
    expect(c?.voice).toBe('agent')
  })
})

describe('pickCall', () => {
  const base = { ownerReq: null, trades: null, inbox: null, staff: STAFF, seen: NONE }

  it('the owner outranks everyone, and says his ask in the first person', () => {
    const c = pickCall({ ...base, ownerReq: OWNER, trades: tradesOf(), inbox: inboxOf(concern()) })
    expect(c?.callerName).toBe('Ronald Burkle')
    expect(c?.spoken).toBe(OWNER.spoken)
    // The card prose describes him in the third person and must never be voiced.
    expect(c?.spoken).not.toContain('The owner is looking')
  })

  it('never voices an owner directive from a save that predates his spoken line', () => {
    const legacy = { ...OWNER }
    delete (legacy as { spoken?: string }).spoken
    expect(pickCall({ ...base, ownerReq: legacy })).toBeNull()
  })

  it('a rival GM rings as a NAMED man with a first-person pitch', () => {
    const c = pickCall({ ...base, trades: tradesOf() })
    expect(c?.callerName).toBe('Barry Trotz')
    expect(c?.callerRole).toContain('NSH')
    expect(c?.spoken).toContain('We want Erik Karlsson')
    expect(c?.spoken).not.toContain('On the table')
  })

  it('routine offers stay in the Trades tab — only a real piece rings', () => {
    const small = tradesOf()
    small.incoming[0]!.give.players[0]!.overall = 71
    expect(pickCall({ ...base, trades: small })).toBeNull()
  })

  it('a call already dealt with does not ring again', () => {
    const seen = new Set(['trade:o7'])
    expect(pickCall({ ...base, trades: tradesOf(), seen })).toBeNull()
  })

  it('falls through to the next live call when the top one is spent', () => {
    const seen = new Set([`owner:${OWNER.kind}:${hashStr(OWNER.body)}`])
    const c = pickCall({ ...base, ownerReq: OWNER, inbox: inboxOf(concern()), seen })
    expect(c?.callerName).toBe('Erik Karlsson')
  })

  it('a mild concern never rings — the phone is for serious business', () => {
    expect(pickCall({ ...base, inbox: inboxOf(concern({ severity: 'mild' })) })).toBeNull()
  })

  it('skips a narration-only scene and rings the real caller behind it', () => {
    const c = pickCall({
      ...base,
      inbox: inboxOf(
        concern({ id: 'i1', scene: true, message: 'Your coach wants the kid on the top unit. Those minutes belong to somebody.' }),
        concern({ id: 'i2', playerName: 'Sidney Crosby' }),
      ),
    })
    expect(c?.id).toBe('i2')
    expect(c?.callerName).toBe('Sidney Crosby')
  })
})

/* ── latency: the line is chunked so speech starts on the first phrase ──── */

describe('chunkForSpeech', () => {
  it('leaves a short line whole — nothing to gain by splitting it', () => {
    expect(chunkForSpeech('I want out.')).toEqual(['I want out.'])
  })

  it('splits a long call so the first chunk is small enough to start fast', () => {
    const line = OWNER.spoken! + ' ' + `I'm not asking you to gut the team. I am telling you the wage bill comes down. ` +
      `Find me the salary and move it, because I would rather hear it from you than read it in the paper.`
    const chunks = chunkForSpeech(line)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]!.length).toBeLessThan(160)
    // Nothing is lost or duplicated: the words survive the split in order.
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(line.replace(/\s+/g, ' '))
  })

  it('never splits mid-word, even for a sentence with no punctuation to breathe at', () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`)
    const chunks = chunkForSpeech(words.join(' '))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(' ').split(/\s+/)).toEqual(words)
  })

  it('drops nothing on an empty line', () => {
    expect(chunkForSpeech('   ')).toEqual([])
  })
})
