/**
 * E1 end-to-end: the club is bigger than the twenty men who dress.
 *
 * Playtest 2026-08-26 §E1 asked for roleplay beats around the whole
 * organisation — a call after the draft, the affiliate's playoff run mattering,
 * a role conversation with a man you acquire (and the same conversation at the
 * negotiating table beforehand) — all without spamming the GM. These run the
 * real career and check the beats actually reach the desk with teeth on them.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { validateSnapshot } from './serialize'
import { CLUB_SCENES } from '@engine/story/clubScenes'

/** Play the regular season out, then the playoffs, landing in the offseason. */
function toOffseason(career: Career): void {
  let guard = 0
  while (career.getDashboard().phase === 'regularSeason' && guard++ < 400) career.step()
  guard = 0
  while (career.getDashboard().phase === 'playoffs' && guard++ < 200) career.step()
}

const sceneIds = new Set(CLUB_SCENES.map((e) => e.id))

/** Any open conversation on the GM's desk that came from the club-scene pool.
 *  Matched by option ids, which the library owns — the prose is authored and
 *  the ids are the only stable handle. */
function openClubScene(
  career: Career,
): { id: string; message: string; options: Array<{ id: string }> } | null {
  for (const i of career.getInbox().interactions ?? []) {
    const ev = CLUB_SCENES.find((e) => e.options.every((o) => i.options.some((x) => x.id === o.id)))
    if (ev) return { id: i.id, message: i.message, options: i.options }
  }
  return null
}

describe('E1 — the post-draft call', () => {
  it('puts your top pick on the phone the moment the draft is done', () => {
    const data = generateLeague({ seed: 6101 })
    const career = new Career(data, 6101, data.league.teams[0]!)
    toOffseason(career)
    career.advanceOffseason() // awards → draft
    career.autoDraft()
    career.advanceOffseason() // draft → resign; the call is made here

    const scene = openClubScene(career)
    expect(scene).not.toBeNull()
    // It is an authored scene about a real person, not a template shrug.
    expect(scene!.message.length).toBeGreaterThan(80)
    expect(scene!.options.length).toBeGreaterThanOrEqual(3)

    // Answering it applies the AUTHORED receipt, not the generic tone model.
    const res = career.respondToInteraction(scene!.id, scene!.options[0]!.id)
    expect(res.ok).toBe(true)
    expect((res.message ?? '').length).toBeGreaterThan(60)
  })

  it('the scene the career summons by name exists in the library', () => {
    // A rename in one place and not the other would silently kill the beat.
    expect(sceneIds.has('ev.draft.first-pick-call')).toBe(true)
    expect(sceneIds.has('ev.draft.slid-to-us-call')).toBe(true)
  })
})

describe('E1 — the affiliate has a spring of its own', () => {
  it('resolves a farm bracket and tells the GM how his kids did', () => {
    const data = generateLeague({ seed: 6102 })
    const career = new Career(data, 6102, data.league.teams[0]!)
    let guard = 0
    while (career.getDashboard().phase === 'regularSeason' && guard++ < 400) career.step()
    // The bracket resolves the moment the NHL playoffs are seeded.
    const items = career.getInbox().items
    const recap = items.find(
      (n) => /farm-league title|champions|reach the semi-final|lose the final|quarter-final/i.test(n.headline)
    )
    expect(recap, 'the farm played a whole season and nobody reported the ending').toBeDefined()
    expect(recap!.body.length).toBeGreaterThan(60)
  })
})

describe('E1 — the club ledger survives a save', () => {
  it('round-trips the farm-beat memory, so a reload never retells a story', () => {
    const data = generateLeague({ seed: 6103 })
    const career = new Career(data, 6103, data.league.teams[0]!)
    let guard = 0
    while (career.getDashboard().phase === 'regularSeason' && guard++ < 120) career.step()

    const snap = career.exportSnapshot('club', '2026-08-27T00:00:00.000Z')
    expect(snap.clubBeats).toBeDefined()
    const restored = Career.fromSnapshot(validateSnapshot(JSON.parse(JSON.stringify(snap))))
    const back = restored.exportSnapshot('club2', '2026-08-27T00:00:00.000Z')
    expect(back.clubBeats?.told).toEqual(snap.clubBeats?.told)
    expect(back.clubBeats?.thisSeason).toBe(snap.clubBeats?.thisSeason)
  })

  it('an old save with no club-beat ledger loads clean', () => {
    const data = generateLeague({ seed: 6104 })
    const career = new Career(data, 6104, data.league.teams[0]!)
    const snap = career.exportSnapshot('old', '2026-08-27T00:00:00.000Z')
    delete (snap as { clubBeats?: unknown }).clubBeats
    const restored = Career.fromSnapshot(validateSnapshot(JSON.parse(JSON.stringify(snap))))
    expect(restored.exportSnapshot('x', '2026-08-27T00:00:00.000Z').clubBeats?.told).toEqual([])
  })
})

describe('E1 — the role conversation happens BEFORE he signs', () => {
  it('prices the promise at the table and books it as a debt on signing', () => {
    const data = generateLeague({ seed: 6105 })
    const career = new Career(data, 6105, data.league.teams[0]!)
    // Get to the open market, where a GM is actually recruiting.
    toOffseason(career)
    career.advanceOffseason() // awards → draft
    career.autoDraft()
    career.advanceOffseason() // draft → resign
    let guard = 0
    while (career.getOffseason()?.stage === 'resign' && guard++ < 20) career.advanceOffseason()
    expect(career.getOffseason()?.stage).toBe('freeAgency')

    const fa = career.getOffseason()!.freeAgents.find((f) => f.askSalary < 3_000_000)
    expect(fa).toBeDefined()
    const pid = fa!.playerId

    const opened = career.startNegotiation(pid)
    expect(opened.kind).toBe('freeAgent')
    // The conversation the user asked for is right there, at the table.
    expect(opened.roleOptions?.length).toBeGreaterThanOrEqual(4)

    const said = career.setNegotiationRole(pid, 'star')
    expect(said.message.length).toBeGreaterThan(20)
    expect(said.view.rolePitch).toBe('star')
    // It is a round of the conversation, not a hidden flag.
    expect(said.view.rounds.length).toBeGreaterThan(0)
    expect(said.view.rounds.at(-1)!.agentLines.join(' ')).toContain('You told them')

    // Sign him, generously, and the promise appears on the books.
    let signed = false
    for (let i = 0; i < 8 && !signed; i++) {
      const v = career.getNegotiation(pid)!
      if (v.status !== 'open') break
      const r = career.submitNegotiationOffer(pid, {
        salary: Math.round((v.askSalary * (1.05 + i * 0.06)) / 25_000) * 25_000,
        years: Math.min(3, v.askYears),
        signingBonusPct: 0,
        clause: 'none',
        twoWay: false,
      })
      signed = r.signed
    }
    expect(signed).toBe(true)
    const promises = career.getTeamDynamics(career.view().userTeam.teamId).promises ?? []
    expect(
      promises.some((p) => p.playerId === pid && p.text.startsWith('Promised at the table')),
    ).toBe(true)
  })
})
