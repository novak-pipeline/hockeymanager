/**
 * W3 measurement harness (dev only, skipped unless TP_MEASURE=1): sims seeded
 * agent-engine games on the imported real-roster league (mods/nhl-ehm, else
 * the generated league) and prints the team-play detectors (VT13 aimless,
 * VT14 coverage, VT16 crease camping, job flips) next to the calibration
 * numbers a slice must not move the wrong way (goals, shots, PP).
 *
 *   TP_MEASURE=1 TP_GAMES=30 npx vitest run src/engine/agent/teamPlay.measure.test.ts
 *
 * TP_SEED0 offsets the seeds (run chunks in parallel), TP_VANILLA=1 uses the
 * generated league, TP_PAIR=band the pairing of agentSim.test's NHL-band
 * sample, TP_TAG names the output (.cache/tp-measure-<tag>.txt).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { it } from 'vitest'
import type { Player, PlayerId } from '@domain'
import { generateLeague } from '@data/generate'
import { loadModDatabase, validateModDatabase } from '@data'
import { framesFromStream, judgeTeamPlay, per60, SIM_GATES } from '@engine/analysis/teamPlay'
import { judgeOffsideStream } from '@engine/analysis/offside'
import { judgeActionFloor, judgeContacts } from '@engine/analysis/actions'
import { AGENT_TUNING, GOALIE_READ, REBOUND, agentSimGame, emptyAgentTelemetry } from './agentSim'
import { PUCK_PLAY, S6_DEV } from './brain'
import { S6_PHYS } from './physics'
import { PK_PLAY, ST_TILT, S8_DEV } from './specialTeams'
import { judgePuckPlayStream, puckPlayLine } from '@engine/analysis/puckPlay'
import { DEKE, PP_LANE, PROGRESS, RUSH_PLAY, SCREEN, VAL } from './brain'
import { DZ_GAP, MAN_COVER, S4_DEV } from './systems'
import { IN_TIGHT, S5_DEV } from './carrierTilt'
import { judgeGoalGeometry } from '@engine/analysis/goalGeometry'
import { judgeFaceoffDots } from '@engine/analysis/faceoffRule'
import { judgeSystems, legibility, systemFramesFromStream, type SeqCase } from '@engine/analysis/systemPlay'
import { PK_PRESSURE_AGGRESSIVE, buildCoachProfile, coachFit, playbookFor, profileToTactics } from '@engine/league/coachProfile'
import { generateTeamStaff } from '@engine/league/staff'
import { Rng, deriveSeed } from '@engine/shared/rng'
import { carrierPlayLine, judgeCarrierPlay, sumCarrierPlay, type CarrierPlayReport } from '@engine/analysis/carrierPlay'
import { judgeSpecialTeams, specialTeamsLine, sumSpecialTeams, type SpecialTeamsReport } from '@engine/analysis/specialTeams'

function findModDb(): string | null {
  if (process.env.TP_VANILLA) return null
  if (process.env.TP_DB && existsSync(process.env.TP_DB)) return process.env.TP_DB
  let dir = resolve(process.cwd())
  for (let i = 0; i < 6; i++) {
    const p = join(dir, 'mods', 'nhl-ehm', 'database.json')
    if (existsSync(p)) return p
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

it.skipIf(!process.env.TP_MEASURE)('team-play + calibration measurement', () => {
  const games = Number(process.env.TP_GAMES ?? 30)
  const dbPath = findModDb()
  const data = dbPath ? loadModDatabase(validateModDatabase(JSON.parse(readFileSync(dbPath, 'utf8'))), { seed: 2029 }) : generateLeague({ seed: 99 })
  const res = (id: PlayerId): Player => data.players.get(id)!
  const teams = data.league.teams
  // TP_ABLATE=screen,boxOut,... (W3 S4): turn S4 parts off to see what each does to goals
  for (const k of (process.env.TP_ABLATE ?? '').split(',').filter(Boolean)) {
    // W3 S6: TP_ABLATE=s6 turns every S6 part off (the S5 puck), or name parts (path, atFeet, bodies, swept, rebound, misses, goalieRead, phys)
    // W3 S8: TP_ABLATE=s8 turns every S8 part off (the S7 special teams), or name parts (pp, entry, pk, pkUp, flow, lanes, shRush)
    if (k === 's8') {
      for (const j of Object.keys(S8_DEV)) (S8_DEV as Record<string, boolean>)[j] = false
      continue
    }
    if (k in S8_DEV) {
      ;(S8_DEV as Record<string, boolean>)[k] = false
      continue
    }
    if (k === 's6') {
      S6_PHYS.on = false
      for (const j of Object.keys(S6_DEV)) (S6_DEV as Record<string, boolean>)[j] = false
    } else if (k === 'phys') S6_PHYS.on = false
    else if (k in S6_DEV) (S6_DEV as Record<string, boolean>)[k] = false
    else ((k in S5_DEV ? S5_DEV : S4_DEV) as Record<string, boolean>)[k] = false
  }
  // TP_MAN=k,cap,pointFt,urgency: man-coverage variants (systems.ts DZ_GAP.man / MAN_COVER)
  // TP_SET=PROGRESS.noGainK=0.1,RUSH_PLAY.netK=0.5 (W3 S5): try a value without editing the source
  for (const kv of (process.env.TP_SET ?? '').split(',').filter(Boolean)) {
    const [path, v] = kv.split('=') as [string, string]
    const [obj, key] = path.split('.') as [string, string]
    const tbl = ({ PROGRESS, RUSH_PLAY, IN_TIGHT, AGENT_TUNING, SCREEN, VAL, DEKE, REBOUND, GOALIE_READ, PUCK_PLAY, PK_PLAY, ST_TILT, PP_LANE } as Record<string, Record<string, number>>)[obj]
    if (tbl && key in tbl) tbl[key] = Number(v)
  }
  if (process.env.TP_SCREEN) SCREEN.minShotFt = Number(process.env.TP_SCREEN)
  if (process.env.TP_SCREENXG) AGENT_TUNING.screenXg = Number(process.env.TP_SCREENXG)
  if (process.env.TP_MAN) {
    const [k, cap, pointFt, urg] = process.env.TP_MAN.split(',').map(Number) as [number, number, number, number]
    Object.assign(DZ_GAP.man, { k, cap })
    Object.assign(MAN_COVER, { pointFt, urgency: urg })
  }
  // TP_COACH=1 (W3 S4): every team runs its head coach's system, the tactics
  // that system writes and its coach fit, as the career sets them
  // (Career.applyCoachSystems); without it the teams play their DB tactics.
  const systems: Record<string, number> = {}
  if (process.env.TP_COACH) {
    for (const id of teams) {
      const team = data.teams.get(id)!
      const rng = new Rng(deriveSeed(2029, 77, teams.indexOf(id)))
      const coach = data.staffByTeam?.get(id)?.headCoach ?? generateTeamStaff(rng).headCoach
      const profile = coach.profile ?? buildCoachProfile(coach, rng)
      const roster = team.roster.map(res)
      team.tactics = profileToTactics(profile, roster, team.tactics)
      team.coachSystem = profile.system
      team.coachFit = coachFit(profile, roster)
      systems[profile.system] = (systems[profile.system] ?? 0) + 1
    }
  }
  let goals = 0
  let shots = 0
  let ppGoals = 0
  let shGoals = 0
  let pens = 0
  let hits = 0
  let rebounds = 0
  let saves = 0
  let atkNear = 0
  let defNear = 0
  let blocked = 0
  let missed = 0
  let liveMin = 0
  let aimless = 0
  let aimOwn = 0
  let doubles = 0
  let farSide = 0
  let ignored = 0
  let camping = 0
  let flips = 0
  let jobMin = 0
  const ex: string[] = []
  let offEntries = 0
  let offCalls = 0
  let offMissed = 0
  let offMissedCarried = 0
  let entries = 0
  const offEx: string[] = []
  let floorRuns = 0
  let floorShort = 0
  let contactPairs = 0
  let contactApart = 0
  let tieUpEvents = 0
  let geoGoals = 0
  let geoBad = 0
  let foJudged = 0
  let foWrong = 0
  let foUnjudged = 0
  // W3 S4 VT15: every team's forecheck / D-zone / breakout sequences, declared vs read off the positions
  const sysFc: SeqCase<string>[] = []
  const sysDz: SeqCase<string>[] = []
  const sysBo: SeqCase<string>[] = []
  // W3 S8 VT15 for special teams: the PP set-up / entry, the kill's shape / pressure
  // (declared by the frames; on an engine that declares nothing - TP_ABLATE=s8 - by the team's playbook)
  const sysPp: SeqCase<string>[] = []
  const sysPe: SeqCase<string>[] = []
  const sysPk: SeqCase<string>[] = []
  const sysPr: SeqCase<string>[] = []
  // W3 S5: the carrier detectors (ping-pong, breakaways, odd-man rushes, score state)
  const cps: CarrierPlayReport[] = []
  // W3 S8: special teams (PP opportunities, PP% / PK%, goals by strength)
  const sts: SpecialTeamsReport[] = []
  // W3 S6: the puck detectors and telemetry
  const pp = { liveMin: 0, overCap: 0, gained: 0, reboundFast: 0, skateThrough: 0, ignored: 0, intervals: 0 }
  const ppEx: string[] = []
  const s6 = { races: 0, won: 0, sideWon: 0, gained: 0, overCap: 0, swept: 0, freezes: 0, saves: 0, overGlass: 0, icings: 0, contacts: {} as Record<string, number>, maxSpeed: {} as Record<string, number>, rebound: {} as Record<string, number> }
  for (let i = 0; i < games; i++) {
    const k = i + Number(process.env.TP_SEED0 ?? 7000) - 7000
    // TP_PAIR=band: the pairing of agentSim.test's NHL-band sample (team k v k+1, seed 5000+k)
    const band = process.env.TP_PAIR === 'band'
    const home = data.teams.get(teams[(band ? k : k * 7) % teams.length])!
    const away = data.teams.get(teams[(band ? k + 1 : k * 7 + 3 + (k % 5)) % teams.length])!
    const tmx = emptyAgentTelemetry()
    const out = agentSimGame(home, away, res, { seed: (process.env.TP_PAIR === 'band' ? 5000 + k : Number(process.env.TP_SEED0 ?? 7000) + i), agentTelemetry: tmx })
    {
      s6.races += tmx.puck.races
      s6.won += tmx.puck.raceWonPredicted
      s6.sideWon += tmx.puck.raceSideWon
      s6.gained += tmx.puck.gained
      s6.overCap += tmx.puck.overCap
      s6.swept += tmx.puck.swept
      s6.freezes += tmx.stoppages.goalieFreeze
      s6.saves += tmx.saves
      s6.overGlass += tmx.overGlass
      s6.icings += tmx.icings
      for (const [k2, v] of Object.entries(tmx.puck.contacts)) s6.contacts[k2] = (s6.contacts[k2] ?? 0) + v
      for (const [k2, v] of Object.entries(tmx.puck.maxSpeed)) s6.maxSpeed[k2] = Math.max(s6.maxSpeed[k2] ?? 0, v)
      for (const [k2, v] of Object.entries(tmx.dbg)) if (k2.startsWith('rebound:')) s6.rebound[k2] = (s6.rebound[k2] ?? 0) + v
      const r6 = judgePuckPlayStream(out.stream)
      pp.liveMin += r6.liveMin
      pp.intervals += r6.intervals
      pp.overCap += r6.overCap.length
      pp.gained += r6.gained.length
      pp.reboundFast += r6.reboundFast.length
      pp.skateThrough += r6.skateThrough.length
      pp.ignored += r6.ignored.length
      for (const c of [...r6.overCap.slice(0, 1), ...r6.gained.slice(0, 1), ...r6.reboundFast.slice(0, 1), ...r6.skateThrough.slice(0, 1), ...r6.ignored.slice(0, 1)]) if (ppEx.length < 14) ppEx.push(`g${i} ${c.what}`)
    }
    let lastShotT = -99
    let lastPer = 0
    let lastFrame: (typeof out.stream)[number] | null = null
    for (const e of out.stream) {
      if (e.type === 'frame') lastFrame = e
      if (e.type === 'save' && lastFrame && lastFrame.type === 'frame') {
        // who is around the net at the save (within 20 ft of the goalie's net)
        const homeG = lastFrame.homeGoalie.player === e.goalie
        const gx = (homeG ? lastFrame.homeGoalie : lastFrame.awayGoalie).pos.x * 100
        const nx = gx > 0 ? 89 : -89
        const near = (s2: { pos: { x: number; y: number } }): boolean => Math.hypot(s2.pos.x * 100 - nx, s2.pos.y * 42.5) < 20
        saves++
        defNear += (homeG ? lastFrame.home : lastFrame.away).filter(near).length
        atkNear += (homeG ? lastFrame.away : lastFrame.home).filter(near).length
      }
      if (e.type === 'shot') {
        if (e.period === lastPer && e.t - lastShotT <= 3) rebounds++
        lastShotT = e.t
        lastPer = e.period
      } else if (e.type === 'blockedShot') blocked++
      else if (e.type === 'missedShot') missed++
      else if (e.type === 'whistle' || e.type === 'faceoff') lastShotT = -99
      if (e.type === 'goal') {
        goals++
        if (e.strength === 'pp') ppGoals++
        if (e.strength === 'sh') shGoals++
      } else if (e.type === 'shot') shots++
      else if (e.type === 'penalty') pens++
      else if (e.type === 'hit') hits++
    }
    cps.push(judgeCarrierPlay(out.stream))
    sts.push(judgeSpecialTeams(out.stream))
    const gg = judgeGoalGeometry(out.stream)
    geoGoals += gg.goals
    geoBad += gg.bad.length
    for (const b of gg.bad) if (offEx.length < 12) offEx.push(`g${i} GOAL ${b.what}`)
    const fd = judgeFaceoffDots(out.stream)
    foJudged += fd.judged.length
    foWrong += fd.wrong.length
    foUnjudged += fd.unjudged
    for (const w of fd.wrong) if (offEx.length < 12) offEx.push(`g${i} FO ${w.what}`)
    const fl = judgeActionFloor(out.stream)
    floorRuns += fl.runs + fl.shots + fl.passes
    floorShort += fl.short.length
    const ctc = judgeContacts(out.stream)
    contactPairs += ctc.hits + ctc.tieUps
    contactApart += ctc.apart.length
    tieUpEvents += ctc.tieUps
    const off = judgeOffsideStream(out.stream)
    entries += off.entries
    offEntries += off.offsideEntries
    offCalls += off.whistles
    offMissed += off.missed.length
    offMissedCarried += off.missed.filter((m) => m.kind === 'carried').length
    for (const m of off.missed) if (offEx.length < 12) offEx.push(`g${i} ${m.what}`)
    const r = judgeTeamPlay(framesFromStream(out.stream), { gates: SIM_GATES })
    {
      const sf = systemFramesFromStream(out.stream)
      const sr = judgeSystems(sf.frames, sf.passes)
      for (const side of ['home', 'away'] as const) {
        sysFc.push(...sr[side].forecheck)
        sysDz.push(...sr[side].dzone)
        sysBo.push(...sr[side].breakout)
        const tm = side === 'home' ? home : away
        const pb = playbookFor(tm.coachSystem, tm.tactics)
        const fill = <C extends string>(cs: SeqCase<C>[], d: string): SeqCase<string>[] => cs.map((q) => ({ ...q, declared: q.declared ?? d }))
        sysPp.push(...fill(sr[side].pp, pb.pp))
        sysPe.push(...fill(sr[side].ppEntry, '?'))
        sysPk.push(...fill(sr[side].pk, pb.pk))
        sysPr.push(...fill(sr[side].pkPress, pb.pkPressure >= PK_PRESSURE_AGGRESSIVE ? 'aggressive' : 'passive'))
      }
    }
    liveMin += r.liveMin
    aimless += r.aimless.length
    aimOwn += r.aimlessOwn
    doubles += r.doubles.length
    farSide += r.farSide.length
    ignored += r.ignored.length
    camping += r.camping.length
    flips += r.jobFlips
    jobMin += r.jobPlayerMin
    if (i < 2) for (const c of [...r.aimless.slice(0, 2), ...r.doubles.slice(0, 2), ...r.farSide.slice(0, 2), ...r.ignored.slice(0, 2), ...r.camping.slice(0, 1)]) ex.push(`g${i} ${c.what}`)
  }
  const tg = games * 2
  const lines = [
    `league: ${dbPath ? 'imported' : 'generated'} - ${games} games (seeds 7000-${7000 + games - 1})${process.env.TP_COACH ? ` - coach systems ${JSON.stringify(systems)}` : ''}`,
    `calibration/team-game: goals ${(goals / tg).toFixed(2)} shots ${(shots / tg).toFixed(1)} ppGoals ${(ppGoals / tg).toFixed(2)} shGoals ${(shGoals / tg).toFixed(2)} penalties ${(pens / tg).toFixed(2)} hits ${(hits / tg).toFixed(1)} sh% ${((goals / Math.max(1, shots)) * 100).toFixed(2)} PP% ${(pens ? (ppGoals / pens) * 100 : 0).toFixed(1)} rebound-share ${(rebounds / Math.max(1, shots)).toFixed(3)} blocked-share ${(blocked / Math.max(1, shots + blocked + missed)).toFixed(3)} at-save near-net atk ${(atkNear / Math.max(1, saves)).toFixed(2)} def ${(defNear / Math.max(1, saves)).toFixed(2)}`,
    `team play per 60 live min: VT13 aimless ${per60(aimless, liveMin).toFixed(2)} (own net ${per60(aimOwn, liveMin).toFixed(2)}) - VT14 doubles ${per60(doubles, liveMin).toFixed(2)} farSide ${per60(farSide, liveMin).toFixed(2)} ignored ${per60(ignored, liveMin).toFixed(2)} - VT16 camping ${per60(camping, liveMin).toFixed(2)} - job flips ${(flips / Math.max(jobMin, 1e-9)).toFixed(2)}/player-min (live ${liveMin.toFixed(0)} min)`,
    `offside: entries ${entries} offside-entries ${offEntries} whistles ${offCalls} (${(offCalls / tg).toFixed(2)}/team-game) MISSED ${offMissed} (carried ${offMissedCarried}, delayed touch ${offMissed - offMissedCarried})`,
    `VT12 action floor: ${floorShort} short in ${floorRuns} acts/shots/passes - contact pairs: ${contactApart} apart in ${contactPairs} (tie-ups ${(tieUpEvents / tg).toFixed(1)}/team-game)`,
    `goal geometry: ${geoBad} illegal in ${geoGoals} goals - faceoff dots: ${foWrong} off the right painted dot in ${foJudged} judged (${foUnjudged} unjudged)`,
    ...(['forecheck', 'D zone', 'breakouts', 'PP set-up', 'PP entry', 'PK shape', 'PK pressure'] as const).map((k, i) => { const l = legibility([sysFc, sysDz, sysBo, sysPp, sysPe, sysPk, sysPr][i]!); return `VT15 ${k}: ${l.matched}/${l.judged} family (${l.exact} exact) ${JSON.stringify(l.table)}` }),
    specialTeamsLine(sumSpecialTeams(sts), tg),
    carrierPlayLine(sumCarrierPlay(cps), liveMin),
    puckPlayLine(pp),
    `S6 sim: races ${s6.races} wonPredicted ${(s6.won / Math.max(1, s6.races)).toFixed(3)} sideWon ${(s6.sideWon / Math.max(1, s6.races)).toFixed(3)} gained ${s6.gained} overCap ${s6.overCap} swept ${s6.swept} freezeShare ${(s6.freezes / Math.max(1, s6.saves)).toFixed(3)} outOfPlay ${(s6.overGlass / games).toFixed(2)} icings ${(s6.icings / tg).toFixed(2)}`,
    `S6 contacts/game: ${Object.entries(s6.contacts).map(([k2, v]) => `${k2} ${(v / games).toFixed(1)}`).join(' ')} - rebounds ${JSON.stringify(s6.rebound)} - max speed ${JSON.stringify(s6.maxSpeed)}`,
    ...ppEx,
    ...sumCarrierPlay(cps).breakEx.slice(0, 8),
    ...sumCarrierPlay(cps).pingEx.slice(0, 4),
    ...offEx,
    ...ex
  ]
  mkdirSync('.cache', { recursive: true })
  writeFileSync(join('.cache', `tp-measure${process.env.TP_TAG ? '-' + process.env.TP_TAG : ''}.txt`), lines.join('\n') + '\n')
}, 3_600_000)

