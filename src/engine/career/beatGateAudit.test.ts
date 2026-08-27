/**
 * THE BEAT-GATE AUDIT (Gap #1 / bar B2.2).
 *
 * A previous sweep audited all nine known blocking beats by hand and declared
 * them escapable. It missed one, and the user hit it in a live playthrough:
 * Continue would not advance after development camp. Hand-auditing a gate
 * inventory cannot catch a gate that only locks in COMBINATION with another,
 * so this walks a whole career year pressing Continue through the shell's real
 * routing law ({@link routeContinue}) and asserts the thing that actually
 * matters: **every press either advances the game or walks the GM into a beat
 * he can resolve.** A missed gate fails a run now, not a playthrough.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { generateLeague } from '@data/generate'
import { loadModDatabase, validateModDatabase } from '@data'
import { Career } from './career'
import { routeContinue, type LastRoute } from './beatGates'

/** The whole visible state of the game, as the GM would judge "did anything
 *  happen?" — phase, date, offseason stage, camp day, and the button's promise. */
function stateKey(c: Career): string {
  const d = c.getDashboard()
  const os = c.getOffseason()
  return [d.phase, d.year, d.day, os?.stageLabel ?? '-', c.getDevCamp()?.day ?? '-', d.continueLabel].join('|')
}

interface WalkResult { presses: number; end: string; gatesSeen: Set<string> }

/**
 * Press Continue `presses` times exactly as the shell does, and throw the moment
 * the game stops moving. Models the two things the shell does that the engine
 * cannot see: routing to a beat's screen, and a beat screen bouncing the GM
 * back to the dashboard when it has nothing to render.
 */
function walkPressingContinue(c: Career, presses: number): WalkResult {
  let screen = 'dashboard'
  let lastRoute: LastRoute | null = null
  const recent: string[] = []
  const gatesSeen = new Set<string>()
  const trail: string[] = []
  // 10 identical states in a row is a softlock: no beat legitimately holds the
  // same label, day and stage that long (dev camp, the longest, runs 3).
  const STUCK = 10
  for (let i = 0; i < presses; i++) {
    // Beat screens bounce the GM home when their data has gone (their own
    // mount effects do this) — a gate can therefore be live while the GM can
    // never stand in its room.
    if (screen === 'devCamp' && c.getDevCamp() === null) screen = 'dashboard'
    if (screen === 'trainingCamp' && c.getTrainingCamp() === null) screen = 'dashboard'
    if (screen === 'boardMeeting' && c.getBoardMeeting() === null) screen = 'dashboard'

    const key = stateKey(c)
    recent.push(key)
    trail.push(`#${i} ${key} @${screen}`)
    if (recent.length > STUCK) recent.shift()
    if (recent.length === STUCK && new Set(recent).size === 1) {
      throw new Error(
        `SOFTLOCK: ${STUCK} presses of Continue changed nothing.\n` + trail.slice(-STUCK - 2).join('\n')
      )
    }

    const d = c.getDashboard()
    const dec = routeContinue({ dashboard: d, screen, lastRoute })
    if (dec.kind === 'hardGate') {
      gatesSeen.add(dec.screen)
      lastRoute = null
      screen = dec.screen
      // The escape each hard gate carries on its own screen.
      if (dec.screen === 'draft') c.autoDraft()
      else if (dec.screen === 'squad') {
        const r = c.signEmergencyCover()
        if (!r.ok) throw new Error(`HARD GATE with no escape (lineup): ${r.message}`)
      } else {
        const r = c.nameCaptainByCoach()
        if (!r.ok) throw new Error(`HARD GATE with no escape (captains): ${r.message}`)
      }
      continue
    }
    if (dec.kind === 'route') {
      gatesSeen.add(dec.gate.key)
      lastRoute = { screen: dec.gate.screen, label: d.continueLabel }
      screen = dec.gate.screen
      continue
    }
    if (dec.kind === 'spend') gatesSeen.add(dec.gate.key)
    lastRoute = null
    try {
      c.step()
    } catch (e) {
      throw new Error(`DEAD END at press ${i} (${key}): ${(e as Error).message}`)
    }
  }
  return { presses, end: stateKey(c), gatesSeen }
}

describe('beat gates — a full career year of pressing Continue', () => {
  for (const seed of [313, 414]) {
    it(`seed ${seed}: Continue always advances or offers a way out`, () => {
      const data = generateLeague({ seed })
      const c = new Career(data, seed, data.league.teams[0]!)
      c.startAtOffseason()
      const res = walkPressingContinue(c, 320)
      // The walk must actually have gone somewhere and met real gates on the way.
      expect(res.end).not.toBe(stateKey(new Career(generateLeague({ seed }), seed, data.league.teams[0]!)))
      expect(res.gatesSeen.size).toBeGreaterThan(2)
    }, 60_000)
  }

  it('a development camp with nobody in it is not a beat at all', () => {
    // #182 lets the GM cut every invite. The gate was armed off a pool computed
    // when camp opened, so it stayed lit over a screen that rendered nothing —
    // Continue routed there, the screen bounced back, forever.
    const data = generateLeague({ seed: 313 })
    const c = new Career(data, 313, data.league.teams[0]!)
    c.startAtOffseason()
    expect(c.getDashboard().devCampPending).toBe(true)
    for (const p of c.getDevCampInvites().invited) c.toggleDevCampInvite(p.playerId)
    expect(c.getDevCampInvites().invited).toHaveLength(0)
    // The gate stands down: no camp to show, so the button stops promising one.
    expect(c.getDashboard().devCampPending).toBeFalsy()
    expect(c.getDashboard().continueLabel).not.toMatch(/development camp/i)
    expect(c.getDevCamp()).toBeNull()
    // And the summer moves on under Continue like any other day.
    walkPressingContinue(c, 40)
  })

  it('an illegal lineup names itself and carries a one-click way out', () => {
    // The audit found this one: a club that cannot dress a legal team held the
    // sim by THROWING out of the advance. The message was good advice and no
    // button — Continue simply failed, forever, with nothing on screen to fix.
    const data = generateLeague({ seed: 313 })
    const tid = data.league.teams[0]!
    const team = data.teams.get(tid)!
    const c = new Career(data, 313, tid)
    // Strip the org of goalies: one healthy netminder is not a lineup.
    const isG = (id: string): boolean => data.players.get(id as never)?.position === 'G'
    const affiliate = team.affiliateId ? data.teams.get(team.affiliateId) : undefined
    let kept = 0
    team.roster = team.roster.filter((id) => !isG(id as string) || kept++ === 0)
    if (affiliate) affiliate.roster = affiliate.roster.filter((id) => !isG(id as string))

    // 1. The gate NAMES itself rather than ambushing the GM mid-advance.
    const dash = c.getDashboard()
    expect(dash.lineupShortfall).toMatch(/short 1 more goalie/i)
    expect(dash.continueLabel).toBe('Continue — your lineup is short')

    // 2. Continue routes to the one screen that can fix it, and outranks beats.
    const dec = routeContinue({ dashboard: dash, screen: 'dashboard', lastRoute: null })
    expect(dec).toMatchObject({ kind: 'hardGate', screen: 'squad' })

    // 3. The escape on that screen actually clears it.
    const res = c.signEmergencyCover()
    expect(res.ok).toBe(true)
    expect(res.signed.length).toBeGreaterThan(0)
    expect(c.getDashboard().lineupShortfall).toBeUndefined()
    expect(c.getInbox().items.some((n) => n.headline.startsWith('Emergency cover signed'))).toBe(true)
    // 4. And the game plays on.
    expect(c.step()).toBe(true)
  })

  /**
   * The deep sweep, on the user's own world. Off by default (it plays years):
   *   GATE_SWEEP=1 GATE_DB="K:/Hockey Game/mods/nhl-ehm/database.json"    *     GATE_TEAM=Pittsburgh npx vitest run src/engine/career/beatGateAudit.test.ts --no-file-parallelism
   * The two softlocks the hand-audit missed both showed up here first: the
   * training-camp/boardroom pair on the imported 32-team league, and the
   * scout-meeting/scout-digest pair on the vanilla one.
   */
  it.skipIf(!process.env.GATE_SWEEP)('deep sweep: several years of Continue on the real database', () => {
    const seed = Number(process.env.GATE_SEED ?? 2029)
    const db = process.env.GATE_DB ?? ''
    const data = db && existsSync(db)
      ? loadModDatabase(validateModDatabase(JSON.parse(readFileSync(db, 'utf8'))), { seed })
      : generateLeague({ seed })
    const want = process.env.GATE_TEAM
    const tid = want
      ? data.league.teams.find((t) => (data.teams.get(t)?.name ?? '').toLowerCase().includes(want.toLowerCase())) ?? data.league.teams[0]!
      : data.league.teams[0]!
    const c = new Career(data, seed, tid)
    c.startAtOffseason()
    const res = walkPressingContinue(c, Number(process.env.GATE_PRESSES ?? 1400))
    console.log(`[gate sweep] ${c.getDashboard().userTeam.name}: ${res.presses} presses, ended ${res.end}`)
    console.log(`[gate sweep] gates met: ${[...res.gatesSeen].join(', ')}`)
  }, 1_800_000)
})
