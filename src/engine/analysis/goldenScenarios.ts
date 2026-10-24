/**
 * Golden-scenario finder (W0/W1 viewer-truth reel, docs/gameplan-2026-09-28).
 *
 * Locates, in one simulated game's stream, the first clean instance of each of
 * the ten moments the owner judges a watched game by. A scenario is pinned as
 * (save, home, away, seed, engine, absT) so every build replays the SAME ten
 * moments; this module only reads the stream (engine-agnostic: both engines
 * emit the same GameEvent contract, the agent engine just adds richer fields,
 * which are preferred when present).
 *
 * Pure: no sim, no DOM. The worker runs it over freshly simmed games (dev only).
 */
import { playAbsT } from '@domain'
import type { GameEvent, GameStream } from '@domain/events'
import { judgeSystems, systemFramesFromStream } from './systemPlay'

export type ScenarioKind =
  | 'breakaway'
  | 'twoOnOne'
  | 'ozCycleShot'
  | 'ppSetPlay'
  | 'goalReplay'
  | 'lineChangeOnFly'
  | 'faceoffWinPlay'
  | 'bigHit'
  | 'saveRebound'
  | 'emptyNetLate'
  | 'dZoneCoverage'
  | 'offsideCall'
  | 'faceoffNeutral'
  | 'faceoffDefensive'
  | 'breakoutPlay'
  | 'forecheckTurnover'
  | 'nzRegroup'
  | 'systemHome'
  | 'systemAway'
  | 'trailingPush'
  | 'rimAround'
  | 'offGlass'
  | 'looseRace'
  | 'dumpInRace'
  | 'boardCheckNear'
  | 'endToEndRush'
  | 'fightDown'
  | 'fightDecision'
  | 'periodReel'
  | 'rivalryHeat'

export const SCENARIO_KINDS: readonly ScenarioKind[] = [
  'breakaway', 'twoOnOne', 'ozCycleShot', 'ppSetPlay', 'goalReplay',
  'lineChangeOnFly', 'faceoffWinPlay', 'bigHit', 'saveRebound', 'emptyNetLate',
  'dZoneCoverage', 'offsideCall', 'faceoffNeutral', 'faceoffDefensive',
  'breakoutPlay', 'forecheckTurnover', 'nzRegroup', 'systemHome', 'systemAway',
  'trailingPush', 'rimAround', 'offGlass', 'looseRace', 'dumpInRace',
  'boardCheckNear', 'endToEndRush', 'fightDown', 'fightDecision', 'periodReel', 'rivalryHeat',
]

/** Human label + how much game time to show around the moment (lead before, tail after).
 *  Full mode plays live hockey at 2×, so 16 game-s of lead is ~8 s on screen. */
export const SCENARIO_META: Record<ScenarioKind, { label: string; lead: number; tail: number }> = {
  breakaway:       { label: 'Breakaway',                      lead: 16,  tail: 5 },
  twoOnOne:        { label: '2-on-1 rush',                    lead: 14,  tail: 5 },
  ozCycleShot:     { label: 'Offensive-zone cycle into a shot', lead: 20, tail: 5 },
  ppSetPlay:       { label: 'Power-play set play',            lead: 22, tail: 5 },
  // the goal clip must cover the celebration and the instant replay (wall-timed)
  goalReplay:      { label: 'Goal + celebration + replay',    lead: 12,  tail: 8 },
  lineChangeOnFly: { label: 'Line change on the fly',         lead: 10,  tail: 12 },
  faceoffWinPlay:  { label: 'Faceoff win into play',          lead: 4,  tail: 16 },
  bigHit:          { label: 'Big hit',                        lead: 12,  tail: 8 },
  saveRebound:     { label: 'Goalie save + rebound',          lead: 10,  tail: 8 },
  emptyNetLate:    { label: 'Empty net / late game',          lead: 10,  tail: 20 },
  // W3: a long spell in one zone ending in a shot, judged on the DEFENDING side's coverage
  dZoneCoverage:   { label: 'Defensive-zone coverage',        lead: 20,  tail: 5 },
  // W3 S2 (owner, reel S1: "he was offside"): a zone entry the linesman blows offside
  offsideCall:     { label: 'Zone entry: offside called',     lead: 10,  tail: 5 },
  // W3 S3 (owner, reel S2: "not dropping on the faceoff dot"): a draw in each zone
  faceoffNeutral:  { label: 'Neutral-zone faceoff',           lead: 6,  tail: 8 },
  faceoffDefensive: { label: 'Defensive-zone faceoff',        lead: 6,  tail: 8 },
  // W3 S4 (5-on-5 systems from the coach): the system's plays, and the two
  // teams' forechecks side by side (picked only when the two systems differ)
  breakoutPlay:    { label: 'Breakout (the system\'s pattern)', lead: 3, tail: 9 },
  forecheckTurnover: { label: 'Forecheck forces a turnover',  lead: 8,  tail: 6 },
  nzRegroup:       { label: 'Neutral-zone regroup',           lead: 3,  tail: 9 },
  systemHome:      { label: 'Our system: the forecheck',      lead: 2,  tail: 10 },
  systemAway:      { label: 'Their system: the forecheck',    lead: 2,  tail: 10 },
  // W3 S5 (the carrier's score tilt): down a goal or two in the last five minutes, a shot
  trailingPush:    { label: 'Trailing late: the push',        lead: 16, tail: 5 },
  // W3 S6 (puck path and bounces): the puck off the boards and the glass, and the races for it
  rimAround:       { label: 'Rim around the boards',          lead: 4,  tail: 6 },
  offGlass:        { label: 'Puck off the glass',             lead: 4,  tail: 6 },
  looseRace:       { label: 'Loose-puck race',                lead: 3,  tail: 6 },
  dumpInRace:      { label: 'Dump-in and the race to it',     lead: 4,  tail: 7 },
  // W3 S7 (the camera; owner: the near boards were cropped on the board check):
  // a hit on the camera's boards, and a rush from one end to a shot at the other
  boardCheckNear:  { label: 'Board check on the near boards', lead: 8,  tail: 6 },
  endToEndRush:    { label: 'End-to-end rush',                lead: 12, tail: 4 },
  // fights (agent engine `fight` event): one where a man goes down, one that ends with both spent
  fightDown:       { label: 'Fight: a man goes down',         lead: 3,  tail: 42 },
  fightDecision:   { label: 'Fight: both spent, linesmen in', lead: 3,  tail: 48 },
  // the replay package: the end of the first period, its highlight reel, and the intermission
  periodReel:      { label: 'First-period highlight reel',    lead: 10, tail: 0.5 },
  // rivalry heat: a rematch (pinned with the earlier meeting's seed) and its BAD BLOOD card
  rivalryHeat:     { label: 'Rematch: bad blood from the last meeting', lead: 24, tail: 14 },
}

export interface ScenarioHit {
  kind: ScenarioKind
  /** Absolute game second of the moment itself (the shot, the hit, the goal…). */
  absT: number
  period: number
  /** Which side the moment belongs to (attacking / hitting / changing team). */
  side: 'home' | 'away'
  /** Short description for the reel ("2-on-1, #id shoots, saved"). */
  note: string
  /** Higher = cleaner instance (used to pick between candidates). */
  quality: number
}

const REG = 1200

/** Absolute clock base of each period (regulation 1200 s; OT length from the stream). */
export function periodBaseMap(stream: GameStream): Map<number, number> {
  const maxT = new Map<number, number>()
  for (const ev of stream) maxT.set(ev.period, Math.max(maxT.get(ev.period) ?? 0, ev.t))
  const out = new Map<number, number>()
  let base = 0
  for (const p of [...maxT.keys()].sort((a, b) => a - b)) {
    out.set(p, base)
    base += p <= 3 ? REG : (maxT.get(p) ?? REG)
  }
  if (!out.has(1)) out.set(1, 0)
  return out
}

interface Timed { ev: GameEvent; abs: number }

/**
 * Every scenario instance in one game (all candidates, best first per kind).
 * `isHome` classifies a player id; `prefer` (optional) is the side whose
 * moments rank first (the user's club — the team the owner watches).
 */
export function findScenarios(
  stream: GameStream,
  isHome: (id: string) => boolean,
  prefer?: 'home' | 'away',
  homeTeamId?: string,
): ScenarioHit[] {
  const bases = periodBaseMap(stream)
  const evs: Timed[] = []
  for (const ev of stream) {
    if (ev.type === 'frame') continue
    evs.push({ ev, abs: playAbsT(ev, bases) })
  }
  evs.sort((a, b) => a.abs - b.abs)
  const sideOf = (id: string): 'home' | 'away' => (isHome(id) ? 'home' : 'away')
  const out: ScenarioHit[] = []
  const push = (h: ScenarioHit): void => {
    out.push({ ...h, quality: h.quality + (prefer && h.side === prefer ? 0.5 : 0) })
  }
  const stopBetween = (from: number, to: number): boolean =>
    evs.some((x) => x.abs > from && x.abs < to && (x.ev.type === 'whistle' || x.ev.type === 'periodEnd' || x.ev.type === 'faceoff' || x.ev.type === 'goal'))
  const passesBy = (side: 'home' | 'away', from: number, to: number, ozSign?: number): number =>
    evs.filter((x) => x.abs >= from && x.abs <= to && x.ev.type === 'pass' && x.ev.completed && sideOf(x.ev.from) === side &&
      (ozSign === undefined || (x.ev.a.x * ozSign > 0.25 && x.ev.b.x * ozSign > 0.25))).length

  // Power-play windows: a penalty puts the OTHER side on the power play.
  const pp: Array<{ side: 'home' | 'away'; from: number; to: number }> = []
  for (const x of evs) {
    if (x.ev.type !== 'penalty') continue
    const to = x.abs + Math.max(2, x.ev.minutes) * 60
    pp.push({ side: sideOf(x.ev.player) === 'home' ? 'away' : 'home', from: x.abs, to })
  }
  const onPP = (side: 'home' | 'away', t: number): boolean => pp.some((w) => w.side === side && t > w.from && t < w.to)

  // Outcome of a shot (the next save / goal within 2 s).
  const outcome = (i: number): string => {
    const t = evs[i]!.abs
    for (let j = i + 1; j < evs.length && evs[j]!.abs <= t + 2; j++) {
      const ty = evs[j]!.ev.type
      if (ty === 'goal') return 'goal'
      if (ty === 'save') return 'saved'
    }
    return 'no save/goal'
  }

  // Puck position over live frames (for zone time): abs t and x in rink units.
  const puckTrack: Array<{ abs: number; x: number }> = []
  for (const ev of stream) if (ev.type === 'frame') puckTrack.push({ abs: playAbsT(ev, bases), x: ev.puck.x })
  /** Seconds the puck has spent continuously in the zone at sign `sign` before `t` (≤ 40). */
  const zoneTime = (t: number, sign: number): number => {
    let lo = 0
    let hi = puckTrack.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (puckTrack[mid]!.abs <= t) lo = mid
      else hi = mid - 1
    }
    let k = lo
    while (k > 0 && puckTrack[k]!.x * sign > 0.25 && t - puckTrack[k]!.abs < 40) k--
    return t - puckTrack[k]!.abs
  }

  // the score as the stream runs (W3 S5 trailingPush)
  let goalsH = 0
  let goalsA = 0
  evs.forEach((x, i) => {
    const ev = x.ev
    const t = x.abs
    if (ev.type === 'goal') {
      if (sideOf(ev.scorer) === 'home') goalsH++
      else goalsA++
    }
    if (ev.type === 'shot') {
      const side = sideOf(ev.shooter)
      // W3 S7: the puck came out of the shooters' own zone and went the length
      // of the ice to this shot within 12 s, no whistle, no turnover
      if (puckTrack.length) {
        const sgn = Math.sign(ev.target.x) || 1
        let lo = 0
        let hi = puckTrack.length - 1
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1
          if (puckTrack[mid]!.abs <= t) lo = mid
          else hi = mid - 1
        }
        let k = lo
        while (k > 0 && t - puckTrack[k]!.abs < 12 && puckTrack[k]!.x * sgn > -0.25) k--
        const t0 = puckTrack[k]!.abs
        const turnover = evs.some((y) => y.abs > t0 && y.abs < t && (y.ev.type === 'takeaway' || y.ev.type === 'giveaway' || (y.ev.type === 'pass' && !y.ev.completed)))
        if (puckTrack[k]!.x * sgn <= -0.25 && t - t0 < 12 && t - t0 > 3 && !stopBetween(t0, t) && !turnover) {
          push({ kind: 'endToEndRush', absT: t, period: ev.period, side, note: `own zone to a shot in ${(t - t0).toFixed(1)} s, ${outcome(i)}`, quality: 1 + (outcome(i) === 'goal' ? 0.5 : 0) + (12 - (t - t0)) / 24 })
        }
      }
      // W3 S5: down one or two in the last five minutes of the third
      const lead = side === 'home' ? goalsH - goalsA : goalsA - goalsH
      if (ev.period === 3 && ev.t >= REG - 300 && lead < 0 && lead >= -2) {
        push({ kind: 'trailingPush', absT: t, period: 3, side, note: `down ${-lead} with ${Math.round((REG - ev.t) / 60)} min left, ${ev.origin ?? 'shot'}`, quality: 1 + (REG - ev.t < 150 ? 0.3 : 0) + (ev.origin === 'cycle' || ev.origin === 'rush' ? 0.2 : 0) })
      }
      const sign = Math.sign(ev.target.x) || 1
      const res = outcome(i)
      const scored = res === 'goal' ? 1 : 0
      if (ev.oddMan?.attackers === 1 && ev.oddMan.defenders === 0) {
        push({ kind: 'breakaway', absT: t, period: ev.period, side, note: `breakaway, ${res}`, quality: 1 + scored * 0.3 })
      }
      if (ev.oddMan?.attackers === 2 && ev.oddMan.defenders === 1) {
        push({ kind: 'twoOnOne', absT: t, period: ev.period, side, note: `2-on-1, ${res}`, quality: 1 + scored * 0.3 })
      }
      // Cycle: sustained OZ possession — ≥3 completed OZ passes in 12 s, no whistle.
      const ozPasses = passesBy(side, t - 12, t, sign)
      if (!stopBetween(t - 12, t) && (ev.origin === 'cycle' || ozPasses >= 3)) {
        push({ kind: 'ozCycleShot', absT: t, period: ev.period, side, note: `OZ cycle (${ozPasses} passes${ev.origin ? `, origin ${ev.origin}` : ''}), ${res}`, quality: 0.6 + Math.min(ozPasses, 6) * 0.1 + (ev.origin === 'cycle' ? 0.3 : 0) })
      }
      // D-zone coverage: ≥ 12 s of the puck in this zone without a whistle, a
      // shot at the end — the clip is about the DEFENDING side's coverage.
      if (!onPP(side, t) && !stopBetween(t - 12, t)) {
        const zt = zoneTime(t, sign)
        if (zt >= 12) push({ kind: 'dZoneCoverage', absT: t, period: ev.period, side: side === 'home' ? 'away' : 'home', note: `${zt.toFixed(0)} s in the zone, then a shot, ${res}`, quality: 0.8 + Math.min(zt, 30) / 30 })
      }
      // PP set play: on the power play, ≥3 completed OZ passes in 15 s, no whistle.
      if (onPP(side, t)) {
        const ppPasses = passesBy(side, t - 15, t, sign)
        if (ppPasses >= 3 && !stopBetween(t - 15, t)) {
          push({ kind: 'ppSetPlay', absT: t, period: ev.period, side, note: `PP set play (${ppPasses} OZ passes), ${res}`, quality: 0.8 + Math.min(ppPasses, 6) * 0.1 + scored * 0.3 })
        }
      }
    } else if (ev.type === 'goal') {
      const side = sideOf(ev.scorer)
      if (ev.strength === 'en') {
        push({ kind: 'emptyNetLate', absT: t, period: ev.period, side, note: 'empty-net goal', quality: 1.2 })
      } else {
        push({ kind: 'goalReplay', absT: t, period: ev.period, side, note: `${ev.strength} goal`, quality: ev.strength === 'ev' ? 1 : 0.8 })
      }
    } else if (ev.type === 'lineChange') {
      const side = homeTeamId !== undefined ? ((ev.team as string) === homeTeamId ? 'home' : 'away') : isHome((ev.onIce[0] as string | undefined) ?? '') ? 'home' : 'away'
      // classic engine: no onTheFly flag — a change away from any whistle/faceoff is on the fly
      const fly = ev.onTheFly ?? !stopBetween(t - 3, t + 1)
      if (fly && ev.period <= 3) {
        push({ kind: 'lineChangeOnFly', absT: t, period: ev.period, side, note: `on-the-fly change${ev.onTheFly === undefined ? ' (inferred)' : ''}`, quality: 1 })
      }
    } else if (ev.type === 'faceoff') {
      const side = sideOf(ev.winner)
      // the draw goes back and a play follows: a completed pass by the winners
      // within 4 s and a shot within 12 s, uninterrupted
      const pass = evs.find((y) => y.abs > t && y.abs <= t + 4 && y.ev.type === 'pass' && y.ev.completed && sideOf(y.ev.from) === side)
      const shot = evs.find((y) => y.abs > t && y.abs <= t + 12 && y.ev.type === 'shot' && sideOf(y.ev.shooter) === side)
      if (pass && shot && !stopBetween(t, shot.abs)) {
        push({ kind: 'faceoffWinPlay', absT: t, period: ev.period, side, note: `${ev.zone} faceoff win → shot in ${(shot.abs - t).toFixed(1)} s`, quality: 1 + (ev.zone === 'offensive' ? 0.2 : 0) })
      }
      // a draw in each zone (the dot it is on is what the owner judges): a
      // neutral-zone dot (not centre ice), and one in the winner's own end
      const clean = pass && !stopBetween(t, t + 6) ? 0.3 : 0
      if (ev.zone === 'neutral' && Math.abs(ev.pos.x) > 0.05) push({ kind: 'faceoffNeutral', absT: t, period: ev.period, side, note: 'neutral-zone faceoff', quality: 1 + clean })
      if (ev.zone === 'defensive') push({ kind: 'faceoffDefensive', absT: t, period: ev.period, side, note: 'defensive-zone faceoff', quality: 1 + clean })
    } else if (ev.type === 'fight') {
      const side = ev.winner ? sideOf(ev.winner) : 'home'
      const how = ev.down ? `${ev.ending}, ${ev.landed.home}-${ev.landed.away} landed` : `${ev.winner ? 'decision' : 'draw'}, ${ev.landed.home}-${ev.landed.away} landed`
      // the whole bout must fit the clip: shorter ones rank first
      push({ kind: ev.down ? 'fightDown' : 'fightDecision', absT: t, period: ev.period, side, note: `fight (${ev.cause}): ${how}, ${ev.boxAt.toFixed(0)} s to the box`, quality: 1 + (ev.down && ev.ending === 'knockdown' ? 0.3 : 0) - Math.max(0, ev.boxAt - 35) * 0.05 })
    } else if (ev.type === 'hit') {
      const side = sideOf(ev.by)
      const q = (ev.force ?? 0.5) + (ev.knockdown ? 1 : 0) + (ev.kind === 'openIce' ? 0.3 : 0) + (ev.targetHadPuck ? 0.2 : 0)
      push({ kind: 'bigHit', absT: t, period: ev.period, side, note: `${ev.kind ?? 'hit'}${ev.force !== undefined ? ` force ${ev.force.toFixed(2)}` : ''}${ev.knockdown ? ', knockdown' : ''}`, quality: q })
      // W3 S7: a check into the near boards (the broadcast camera's side, world −z)
      if (ev.pos.y < -0.8 && (ev.kind === 'boards' || ev.pinned)) {
        push({ kind: 'boardCheckNear', absT: t, period: ev.period, side, note: `near-boards ${ev.kind ?? 'hit'}${ev.pinned ? ', pinned' : ''}${ev.force !== undefined ? ` force ${ev.force.toFixed(2)}` : ''}`, quality: q + (ev.pinned ? 0.5 : 0) })
      }
    } else if (ev.type === 'whistle' && ev.reason === 'offside' && ev.pos) {
      // The offending side attacks the zone the puck is in. Which way each side
      // attacks this period: away from its own goalie.
      const f = stream.find((y) => y.type === 'frame' && y.period === ev.period)
      const homeDefendsSign = f && f.type === 'frame' ? Math.sign(f.homeGoalie.pos.x) || 1 : 1
      const side: 'home' | 'away' = Math.sign(ev.pos.x) === -homeDefendsSign ? 'home' : 'away'
      // a delayed call (the puck went in and someone touched it after a beat) reads best
      const touch = evs.find((y) => y.abs >= t - 4 && y.abs < t && (y.ev.type === 'pass' || y.ev.type === 'shot'))
      push({ kind: 'offsideCall', absT: t, period: ev.period, side, note: `offside${touch ? ` after a ${touch.ev.type}` : ''}`, quality: 1 + (touch ? 0.3 : 0) })
    } else if (ev.type === 'save' && ev.rebound) {
      const side = sideOf(ev.goalie)
      const shooting: 'home' | 'away' = side === 'home' ? 'away' : 'home'
      const again = evs.find((y) => y.abs > t && y.abs <= t + 4 && (y.ev.type === 'shot' || y.ev.type === 'missedShot') && sideOf(y.ev.shooter) === shooting)
      if (again) push({ kind: 'saveRebound', absT: t, period: ev.period, side: shooting, note: `save, rebound, second attempt ${(again.abs - t).toFixed(1)} s later`, quality: 1.2 })
    }
  })

  // Late game with the goalie pulled (no empty-net goal needed): a team with
  // six skaters on the ice in the last 3 minutes of regulation.
  if (!out.some((h) => h.kind === 'emptyNetLate')) {
    for (const ev of stream) {
      if (ev.type !== 'frame' || ev.period !== 3 || ev.t < REG - 180) continue
      const side = ev.home.length >= 6 ? 'home' : ev.away.length >= 6 ? 'away' : null
      if (!side) continue
      push({ kind: 'emptyNetLate', absT: playAbsT(ev, bases), period: 3, side, note: 'goalie pulled, extra attacker', quality: 1 })
      break
    }
  }

  // W3 S4: the system plays, read off the positions (systemPlay: what the
  // classifier sees must be what the team declared, so the clip shows it).
  {
    const { frames, passes } = systemFramesFromStream(stream)
    if (frames.some((f) => f.homeSystem || f.awaySystem)) {
      const sys = judgeSystems(frames, passes)
      const periodAt = (t: number): number => {
        let p = 1
        for (const [k, b] of bases) if (t >= b && k > p) p = k
        return p
      }
      const family = (c: string | null): string => (c === '2-1-2' || c === '1-2-2' ? 'pressure' : c === '1-3-1' || c === '1-4' ? 'back' : '?')
      const modeOf = (xs: readonly (string | null)[]): string | null => {
        const n = new Map<string, number>()
        for (const x of xs) if (x) n.set(x, (n.get(x) ?? 0) + 1)
        return [...n.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null
      }
      const homeFc = modeOf(sys.home.forecheck.map((c) => c.declared))
      const awayFc = modeOf(sys.away.forecheck.map((c) => c.declared))
      for (const side of ['home', 'away'] as const) {
        for (const c of sys[side].forecheck) {
          if (!c.declared || family(c.classified) !== family(c.declared)) continue
          const exact = c.classified === c.declared ? 0.4 : 0
          // the two teams' forechecks side by side, when their systems differ
          if (homeFc && awayFc && family(homeFc) !== family(awayFc)) {
            push({ kind: side === 'home' ? 'systemHome' : 'systemAway', absT: c.t, period: periodAt(c.t), side, note: `${c.declared} forecheck (reads ${c.classified})`, quality: 1 + exact })
          }
          // a pressure forecheck that wins the puck back in their end
          if (family(c.declared) === 'pressure') {
            const win = evs.find((y) => y.abs > c.t && y.abs <= c.t + 8 && y.ev.type === 'takeaway' && sideOf(y.ev.by) === side)
            if (win) push({ kind: 'forecheckTurnover', absT: win.abs, period: win.ev.period, side, note: `${c.declared} forecheck, takeaway ${(win.abs - c.t).toFixed(1)} s in`, quality: 1 + exact })
          }
        }
        for (const c of sys[side].breakout) {
          if (!c.declared || c.classified !== c.declared) continue
          push({ kind: 'breakoutPlay', absT: c.t, period: periodAt(c.t), side, note: `${c.declared} breakout`, quality: 1 + (c.declared === 'reverse' || c.declared === 'stretch' || c.declared === 'wheel' ? 0.3 : 0) })
        }
      }
      // the regroup: the side back through its D in the neutral zone for ≥ 2 s, then into their zone
      for (const side of ['home', 'away'] as const) {
        let start = -1
        for (const f of frames) {
          const lab = side === 'home' ? f.homeSystem : f.awaySystem
          if (f.live && lab === 'regroup:controlled') {
            if (start < 0) start = f.t
          } else if (start >= 0) {
            if (f.t - start >= 2 && f.live) {
              const ownNet = side === 'home' ? f.homeNetX : -f.homeNetX
              const into = ownNet !== 0 && f.puck.x * (ownNet > 0 ? -1 : 1) > 25
              push({ kind: 'nzRegroup', absT: start, period: periodAt(start), side, note: `regroup through the D ${(f.t - start).toFixed(1)} s${into ? ', then the entry' : ''}`, quality: 1 + (into ? 0.4 : 0) })
            }
            start = -1
          }
        }
      }
    }
  }

  // W3 S6: the free puck along the boards, off the glass, and the races to it
  {
    const fr: { abs: number; period: number; x: number; y: number; z: number; carrier: string | null; live: boolean }[] = []
    let live = false
    for (const ev of stream) {
      if (ev.type === 'faceoff') live = true
      else if (ev.type === 'whistle' || ev.type === 'goal' || ev.type === 'periodEnd') live = false
      else if (ev.type === 'frame') fr.push({ abs: playAbsT(ev, bases), period: ev.period, x: ev.puck.x * 100, y: ev.puck.y * 42.5, z: ev.puckZ ?? 0, carrier: (ev.puckCarrier as string | null) ?? null, live })
    }
    const lastSide = (i: number): 'home' | 'away' | null => {
      for (let k = i; k >= 0 && fr[i]!.abs - fr[k]!.abs < 6; k--) if (fr[k]!.carrier) return sideOf(fr[k]!.carrier!)
      return null
    }
    const boardsD = (x: number, y: number): number => {
      const ax = Math.abs(x)
      const ay = Math.abs(y)
      if (ax > 72 && ay > 14.5) return 28 - Math.hypot(ax - 72, ay - 14.5)
      return Math.min(100 - ax, 42.5 - ay)
    }
    for (let i = 1; i < fr.length; i++) {
      const f = fr[i]!
      if (!f.live || f.carrier) continue
      // a rim: a free puck riding the boards from one side of the net round to the other (behind the goal line)
      if (Math.abs(f.x) > 89 && boardsD(f.x, f.y) < 4) {
        let j = i
        while (j > 0 && i - j < 12 && fr[j - 1]!.live && !fr[j - 1]!.carrier && boardsD(fr[j - 1]!.x, fr[j - 1]!.y) < 5) j--
        let k = i
        while (k + 1 < fr.length && k - i < 12 && fr[k + 1]!.live && !fr[k + 1]!.carrier && boardsD(fr[k + 1]!.x, fr[k + 1]!.y) < 5) k++
        const a = fr[j]!
        const b = fr[k]!
        if (Math.abs(a.y) > 14 && Math.abs(b.y) > 14 && Math.sign(a.y) !== Math.sign(b.y)) {
          const side = lastSide(j) ?? 'home'
          push({ kind: 'rimAround', absT: a.abs, period: f.period, side, note: `rim round the end boards (${(b.abs - a.abs).toFixed(1)} s from the half-wall to the other side)`, quality: 1 + Math.min(0.5, (b.abs - a.abs) / 4) })
          i = k
          continue
        }
      }
      // off the glass: in the air at the boards
      if (f.z > 3.5 && boardsD(f.x, f.y) < 4) {
        push({ kind: 'offGlass', absT: f.abs, period: f.period, side: lastSide(i) ?? 'home', note: `puck off the glass ${f.z.toFixed(1)} ft up`, quality: 1 + Math.min(0.4, (f.z - 3.5) / 5) })
        while (i + 1 < fr.length && !fr[i + 1]!.carrier && fr[i + 1]!.abs - f.abs < 2) i++
      }
    }
    // races: a free puck (not a pass or a shot) for >= 1 s, ending in a carrier; a dump-in when it went in over the blue line free
    for (let i = 1; i < fr.length; i++) {
      const f = fr[i]!
      if (!f.live || f.carrier || !fr[i - 1]!.carrier) continue
      const t0 = fr[i - 1]!.abs
      const flightEv = evs.find((x) => x.abs >= t0 - 0.05 && x.abs <= f.abs + 0.05 && (x.ev.type === 'pass' || x.ev.type === 'shot' || x.ev.type === 'missedShot'))
      let k = i
      while (k + 1 < fr.length && fr[k + 1]!.live && !fr[k + 1]!.carrier) k++
      const end = fr[k + 1]
      if (!end || !end.live || !end.carrier) { i = k; continue }
      const dur = end.abs - f.abs
      const from = lastSide(i - 1)
      const won = sideOf(end.carrier)
      const enterZone = Math.abs(fr[i - 1]!.x) < 25 && fr.slice(i, k + 1).some((q) => Math.abs(q.x) > 26)
      if (enterZone && dur >= 1 && dur <= 8) {
        push({ kind: 'dumpInRace', absT: f.abs, period: f.period, side: from ?? won, note: `dump-in, ${won === from ? 'recovered by the dumping side' : 'the defenders got there first'} ${dur.toFixed(1)} s later`, quality: 1 + (won === from ? 0.3 : 0) + Math.min(0.3, dur / 10) })
      } else if (!flightEv && dur >= 1 && dur <= 6) {
        push({ kind: 'looseRace', absT: f.abs, period: f.period, side: won, note: `loose puck, ${dur.toFixed(1)} s to a stick (${won === from ? 'kept' : 'turned over'})`, quality: 1 + Math.min(0.4, dur / 6) })
      }
      i = k
    }
  }

  // The end of the first period, when it had something for the highlight reel.
  {
    const end = evs.find((x) => x.ev.type === 'periodEnd' && x.ev.period === 1)
    if (end) {
      const p1 = evs.filter((x) => x.ev.period === 1)
      const goals = p1.filter((x) => x.ev.type === 'goal').length
      const fights = p1.filter((x) => x.ev.type === 'fight').length
      const bigHits = p1.filter((x) => x.ev.type === 'hit' && (x.ev.force ?? 0) >= 0.7).length
      if (goals > 0) push({ kind: 'periodReel', absT: end.abs, period: 1, side: 'home', note: `P1: ${goals} goal(s), ${fights} fight(s), ${bigHits} big hit(s)`, quality: 1 + Math.min(3, goals) * 0.3 + fights * 0.3 + Math.min(3, bigHits) * 0.1 })
    }
  }

  // best first per kind; ties → earliest
  return out.sort((a, b) => (a.kind === b.kind ? b.quality - a.quality || a.absT - b.absT : SCENARIO_KINDS.indexOf(a.kind) - SCENARIO_KINDS.indexOf(b.kind)))
}

/** The single best instance of each kind in one game. */
export function bestPerKind(hits: readonly ScenarioHit[]): Map<ScenarioKind, ScenarioHit> {
  const m = new Map<ScenarioKind, ScenarioHit>()
  for (const h of hits) {
    const cur = m.get(h.kind)
    if (!cur || h.quality > cur.quality || (h.quality === cur.quality && h.absT < cur.absT)) m.set(h.kind, h)
  }
  return m
}

/** A scenario pinned for the reel: replaying (pair, seed, engine) on the same save reproduces it. */
export interface PinnedScenario extends ScenarioHit {
  label: string
  engine: 'classic' | 'agent'
  homeId: string
  awayId: string
  homeAbbr: string
  awayAbbr: string
  seed: number
  /** Stream fingerprint (event count · final score) — the replay must match it. */
  fingerprint: string
  /** Clip window, absolute game seconds. */
  clipFrom: number
  clipTo: number
  /** A rematch: the seed of the earlier meeting whose heat it carries (dev exhibitions only). */
  priorSeed?: number
}

/** Event count + final score: cheap proof that a re-simmed game is the pinned one. */
export function streamFingerprint(stream: GameStream, isHome: (id: string) => boolean): string {
  let h = 0
  let a = 0
  for (const ev of stream) if (ev.type === 'goal') { if (isHome(ev.scorer)) h++; else a++ }
  return `${stream.length}·${h}-${a}`
}
