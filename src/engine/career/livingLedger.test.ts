/**
 * Living Ledger (Narrative Engine layer 0) — actions have witnesses.
 *
 * Covers: the pure scheduler (leak/confrontation/agent/residue paths,
 * personality shaping, compounding, conservation of drama), the career
 * integration (recording, day-pump delivery with attribution, residue
 * flipping to known on a leak), and save/load roundtrip.
 */
import { describe, expect, it } from 'vitest'
import { asPlayerId } from '@domain'
import { generateLeague } from '@data/generate'
import { Rng } from '@engine/shared/rng'
import { Career } from './career'
import { grudgeContext, scheduleReactions, reactionCopy, MAX_OPEN_THREADS, type ResidueFlag, type WorldAction } from './livingLedger'

function makeCareer(seed = 77): { career: Career; c: any } {
  const data = generateLeague({ seed })
  const userId = data.league.teams[0]!
  const career = new Career(data, seed, userId)
  return { career, c: career as any }
}

function actionFor(pid: string, name: string, kind: WorldAction['kind'], visibility: 'quiet' | 'open' = 'quiet'): WorldAction {
  return { id: 'wa-test', kind, year: 2025, day: 10, playerId: pid, playerName: name, visibility }
}

describe('livingLedger — pure scheduler', () => {
  it('an OPEN shop always becomes known: leak scheduled, and a settled player confronts', () => {
    const { c } = makeCareer()
    const player = c.data.players.get(c.userTeam.roster[0])!
    player.morale = 80 // settled — he did NOT want out, so he reacts
    let n = 0
    const { reactions, residue } = scheduleReactions({
      action: actionFor(player.id as string, player.name, 'shopped', 'open'),
      player, rng: new Rng(1), priorResidue: [], openThreads: 0, nextId: () => `r${n++}`,
    })
    expect(reactions.some((r) => r.kind === 'mediaLeak')).toBe(true)
    expect(reactions.some((r) => r.kind === 'confrontation')).toBe(true)
    // The confrontation follows the leak — he can't react before he knows.
    const leak = reactions.find((r) => r.kind === 'mediaLeak')!
    const conf = reactions.find((r) => r.kind === 'confrontation')!
    expect(conf.dueDay).toBeGreaterThan(leak.dueDay)
    expect(residue).toHaveLength(0) // residue comes when the leak FIRES
  })

  it('a player who wanted out is relieved, not confrontational (residue only)', () => {
    const { c } = makeCareer()
    const player = c.data.players.get(c.userTeam.roster[0])!
    player.morale = 20 // he asked for this, effectively
    let n = 0
    const { reactions, residue } = scheduleReactions({
      action: actionFor(player.id as string, player.name, 'shopped', 'open'),
      player, rng: new Rng(1), priorResidue: [], openThreads: 0, nextId: () => `r${n++}`,
    })
    expect(reactions.some((r) => r.kind === 'confrontation')).toBe(false)
    expect(residue.some((f) => f.kind === 'wasShopped' && f.known)).toBe(true)
  })

  it('compounding: a second shop in the same season escalates', () => {
    const { c } = makeCareer()
    const player = c.data.players.get(c.userTeam.roster[0])!
    player.morale = 80
    let n = 0
    const { reactions } = scheduleReactions({
      action: actionFor(player.id as string, player.name, 'shopped', 'open'),
      player, rng: new Rng(1),
      priorResidue: [{ playerId: player.id as string, kind: 'wasShopped', year: 2025, day: 2, actionId: 'wa0', known: true }],
      openThreads: 0, nextId: () => `r${n++}`,
    })
    const conf = reactions.find((r) => r.kind === 'confrontation')
    expect(conf?.escalation).toBe(1)
  })

  it('conservation of drama: at the thread cap, scenes collapse into residue', () => {
    const { c } = makeCareer()
    const player = c.data.players.get(c.userTeam.roster[0])!
    player.morale = 80
    let n = 0
    const { reactions, residue } = scheduleReactions({
      action: actionFor(player.id as string, player.name, 'shopped', 'open'),
      player, rng: new Rng(1), priorResidue: [], openThreads: MAX_OPEN_THREADS, nextId: () => `r${n++}`,
    })
    expect(reactions.some((r) => r.kind === 'confrontation')).toBe(false)
    expect(reactions.some((r) => r.kind === 'mediaLeak')).toBe(true) // press doesn't care about your calendar
    expect(residue.some((f) => f.kind === 'wasShopped')).toBe(true)
  })

  it('demoting a vet draws the agent call; copy carries the attribution', () => {
    const { c } = makeCareer()
    const player = c.data.players.get(c.userTeam.roster[0])!
    let n = 0
    const action = actionFor(player.id as string, player.name, 'sentDown', 'open')
    const { reactions } = scheduleReactions({
      action, player, rng: new Rng(1), priorResidue: [], openThreads: 0, nextId: () => `r${n++}`,
    })
    const note = reactions.find((r) => r.kind === 'agentNote')
    expect(note).toBeDefined()
    const copy = reactionCopy({ kind: 'agentNote', action, player, escalation: 0, rng: new Rng(2) })
    expect(copy.body.length).toBeGreaterThan(40)
  })

  it('confrontation copy is personality-shaped and escalation-aware', () => {
    const { c } = makeCareer()
    const player = c.data.players.get(c.userTeam.roster[0])!
    const action = actionFor(player.id as string, player.name, 'shopped', 'quiet')
    player.personality.temperament = 20
    player.personality.ambition = 80
    const hot = reactionCopy({ kind: 'confrontation', action, player, escalation: 0, rng: new Rng(3) })
    player.personality.temperament = 80
    player.personality.professionalism = 90
    const cool = reactionCopy({ kind: 'confrontation', action, player, escalation: 0, rng: new Rng(3) })
    expect(hot.message).not.toBe(cool.message)
    const again = reactionCopy({ kind: 'confrontation', action, player, escalation: 1, rng: new Rng(3) })
    expect(again.message).toContain('already')
    // Every confrontation offers the full response set (promise…dismissive).
    expect(hot.options?.map((o) => o.tone)).toEqual(['promise', 'supportive', 'firm', 'dismissive'])
  })
})

describe('livingLedger — grudges at the negotiation table', () => {
  const flag = (kind: ResidueFlag['kind'], known: boolean, year: number): ResidueFlag =>
    ({ playerId: 'p1', kind, known, year, day: 10, actionId: 'wa1' })

  it('known residue hardens the ask, shortens patience, and the agent says why', () => {
    const g = grudgeContext([flag('wasShopped', true, 2025)], 'p1', 2025)
    expect(g.askMult).toBeCloseTo(1.04)
    expect(g.patienceHit).toBe(8)
    expect(g.lines[0]).toContain('on the block in 2025')
  })

  it('what he never learned costs nothing; ancient history is forgiven', () => {
    expect(grudgeContext([flag('wasShopped', false, 2025)], 'p1', 2025).askMult).toBe(1)
    expect(grudgeContext([flag('wasShopped', true, 2022)], 'p1', 2025).askMult).toBe(1)
    expect(grudgeContext([flag('wasShopped', true, 2025)], 'OTHER', 2025).askMult).toBe(1)
  })

  it('grudges stack to a cap, one line per kind', () => {
    const g = grudgeContext(
      [flag('wasShopped', true, 2025), flag('wasScratched', true, 2024), flag('wasShopped', true, 2024)],
      'p1', 2025
    )
    expect(g.askMult).toBeCloseTo(1.08) // capped at two grudges
    expect(g.lines).toHaveLength(2)     // shopped line once, scratched line once
  })
})

describe('livingLedger — career integration', () => {
  it('recording an open shop delivers the leak + the office confrontation with attribution', () => {
    const { c } = makeCareer(91)
    const pid = c.userTeam.roster[0] as string
    const player = c.data.players.get(asPlayerId(pid))!
    player.morale = 80
    c.recordWorldAction('shopped', pid, 'open')
    expect(c.worldActions).toHaveLength(1)
    expect(c.ledgerReactions.length).toBeGreaterThan(0)

    const before = c.news.length
    c.processLedgerReactions(30) // beyond every dueDay
    expect(c.ledgerReactions).toHaveLength(0)
    // The leak became a story naming him… (pushNews prepends: new items are at the FRONT)
    const stories = c.news.slice(0, c.news.length - before)
    expect(stories.some((s: any) => s.headline.includes(player.name) || s.body.includes(player.name))).toBe(true)
    // …and he is now standing in your office as a real, answerable interaction.
    const open = c.interactions.filter((i: any) => i.playerId === pid && i.status === 'open')
    expect(open).toHaveLength(1)
    expect(open[0].severity).toBe('serious')
    expect(open[0].options.length).toBe(4)
  })

  it('a fired leak flips residue to known (he knows he was shopped, forever)', () => {
    const { c } = makeCareer(92)
    const pid = c.userTeam.roster[1] as string
    const player = c.data.players.get(asPlayerId(pid))!
    player.morale = 20 // relieved path → immediate residue, known once leak fires
    c.recordWorldAction('shopped', pid, 'open')
    c.processLedgerReactions(30)
    const flags = c.residueFlags.filter((f: any) => f.playerId === pid)
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.every((f: any) => f.known)).toBe(true)
  })

  it('never stacks scenes: an existing open concern folds the confrontation away', () => {
    const { c } = makeCareer(93)
    const pid = c.userTeam.roster[0] as string
    const player = c.data.players.get(asPlayerId(pid))!
    player.morale = 80
    c.interactions.unshift({
      id: 'pre', playerId: pid, teamId: c.userTeamId as string, year: c.year, day: 1,
      kind: 'iceTime', severity: 'mild', message: 'existing', options: [], status: 'open',
    })
    c.recordWorldAction('shopped', pid, 'open')
    c.processLedgerReactions(30)
    const open = c.interactions.filter((i: any) => i.playerId === pid && i.status === 'open')
    expect(open).toHaveLength(1) // still just the pre-existing one
  })

  it('survives save/load: actions, scheduled reactions, and residue roundtrip', () => {
    const { career, c } = makeCareer(94)
    const pid = c.userTeam.roster[0] as string
    c.data.players.get(asPlayerId(pid))!.morale = 80
    c.recordWorldAction('shopped', pid, 'open')
    const snap = career.exportSnapshot('t', 'now')
    const restored = Career.fromSnapshot(structuredClone(snap)) as any
    expect(restored.worldActions).toEqual(c.worldActions)
    expect(restored.ledgerReactions).toEqual(c.ledgerReactions)
    expect(restored.residueFlags).toEqual(c.residueFlags)
    // And the restored career still fires them.
    restored.processLedgerReactions(30)
    expect(restored.ledgerReactions).toHaveLength(0)
  })

  it('is deterministic: same seed, same actions, same scheduled world', () => {
    const a = makeCareer(95)
    const b = makeCareer(95)
    for (const t of [a, b]) {
      const pid = t.c.userTeam.roster[0] as string
      t.c.data.players.get(asPlayerId(pid))!.morale = 80
      t.c.recordWorldAction('shopped', pid, 'quiet')
    }
    expect(a.c.ledgerReactions).toEqual(b.c.ledgerReactions)
    expect(a.c.residueFlags).toEqual(b.c.residueFlags)
  })
})
