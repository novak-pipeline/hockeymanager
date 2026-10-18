/**
 * Offside truth (W3 S2, owner's reel-S1 note on ozCycleShot: "he was offside").
 *
 * Judges a sequence of frames (the sim stream, or what the 3D screen DREW) by
 * NHL rule 83 and reports every zone entry the officials should have blown
 * and did not:
 *
 *  - CARRIED in with a team-mate already over the line (both skates past its
 *    outer edge) when the puck crossed: offside, whistle at once.
 *  - PASSED / SHOT / DUMPED / chipped in with a team-mate over the line:
 *    DELAYED offside. Play on while every attacker clears the zone (tags up);
 *    the whistle goes if an attacker touches the puck in the zone first. Over
 *    when the puck leaves the zone or the zone is clear of attackers.
 *  - Only an entry the ATTACKING side propelled counts (a defender who puts
 *    it into his own zone puts nobody offside).
 *
 * The geometry is the drawn line's: the blue line is 1 ft wide centred on
 * ±25 ft. A man is judged offside when his body centre is more than
 * `OFFSIDE.manOverFt` past the line's centre (both skates over the outer edge,
 * with a margin for 4 Hz sampling so a borderline case is never called red).
 */
import { playAbsT } from '@domain'
import type { GameStream } from '@domain'
import { framesFromStream, type TPFrame } from './teamPlay'

export const OFFSIDE = {
  /** Blue line centre, ft from centre ice. */
  blueX: 25,
  /** A skater's body centre this far past the line centre = both skates over the outer edge (+ sampling margin). */
  manOverFt: 2,
  /** The puck is "in" once its centre is this far past the line centre (completely over the 1-ft line). */
  puckInFt: 0.75,
  /** An attacker clear of the zone (tag-up: a skate on the line): body centre no further in than this past the line centre (+ sampling margin). */
  tagUpFt: 1.5,
  /** A whistle this soon after the infraction answers it (s). */
  whistleS: 1.25,
} as const

export interface OffsideWhistle {
  /** Absolute clock (s), the frames' clock. */
  t: number
  reason?: string
}

export interface OffsideCase {
  t: number
  /** When the puck crossed the line (= t for a carried entry). */
  entryT: number
  kind: 'carried' | 'delayedTouch'
  team: 'home' | 'away'
  /** The men over the line ahead of the puck. */
  offenders: string[]
  what: string
}

export interface OffsideReport {
  /** Zone entries judged (the attacking side propelled the puck over its blue line in live play). */
  entries: number
  /** Entries with a man offside (whistled or not). */
  offsideEntries: number
  /** Offside whistles the stream blew. */
  whistles: number
  /** Missed calls: offside with no whistle. */
  missed: OffsideCase[]
}

const clk = (t: number): string => {
  const p = Math.min(4, Math.floor(t / 1200) + 1)
  const r = 1200 - (t - (p - 1) * 1200)
  return `P${p} ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`
}

interface Delayed {
  team: 'home' | 'away'
  since: number
  offenders: string[]
}

/**
 * A touch the frames cannot show: a poke, a block, a save, a tie-up won - the
 * puck came off THAT side's stick or body (a defender who knocks it into his
 * own zone puts nobody offside).
 */
export interface OffsideTouch {
  t: number
  team?: 'home' | 'away'
  id?: string
}

export function judgeOffside(frames0: readonly TPFrame[], whistles: readonly OffsideWhistle[], touches: readonly OffsideTouch[] = []): OffsideReport {
  // Who has the puck: the frame's carrier, or (sim stream) the man receiving
  // it (act 'receive') - a reception names the frame's carrier only once the
  // puck has slid onto his blade, but it is his (and his side's) from the touch.
  const frames = frames0.map((f) => {
    if (f.carrier !== null) return f
    const h = [...f.home, ...f.away].find((s) => s.act === 'receive')
    return h ? { ...f, carrier: h.id } : f
  })
  let ti = 0
  const offWhistles = whistles.filter((w) => w.reason === 'offside').map((w) => w.t)
  const whistled = (t: number): boolean => offWhistles.some((w) => w >= t - 0.25 && w <= t + OFFSIDE.whistleS)
  const rep: OffsideReport = { entries: 0, offsideEntries: 0, whistles: offWhistles.length, missed: [] }
  let lastTouch: 'home' | 'away' | null = null
  let delayed: Delayed | null = null
  const B = OFFSIDE.blueX
  // the puck is in a zone until it COMPLETELY leaves it (over the line's far edge)
  const inZone = { home: false, away: false }
  let aheadAtGain: string | null = null
  let carryTouch: 'home' | 'away' | null = null
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!
    const p = i > 0 ? frames[i - 1]! : null
    if (!f.live || f.homeNetX === 0) {
      delayed = null
      lastTouch = null
      carryTouch = null
      inZone.home = false
      inZone.away = false
      continue
    }
    const teamOf = (id: string | null): 'home' | 'away' | null => (id === null ? null : f.home.some((s) => s.id === id) ? 'home' : f.away.some((s) => s.id === id) ? 'away' : null)
    // attack direction: away from the net the team defends
    const dir = (team: 'home' | 'away'): number => (team === 'home' ? -Math.sign(f.homeNetX) : Math.sign(f.homeNetX))
    // Tag-up: every attacker clear of the zone at the SAME instant - checked at
    // this frame and between it and the last one (men cross at 4 Hz).
    const taggedUp = (team: 'home' | 'away', a: number): boolean => {
      const cur = team === 'home' ? f.home : f.away
      const prv = p && p.live ? (team === 'home' ? p.home : p.away) : null
      for (let k = prv ? 1 : 4; k <= 4; k++) {
        const u = k / 4
        if (cur.every((s) => {
          const q = prv?.find((r) => r.id === s.id)
          const x = q ? q.x + (s.x - q.x) * u : s.x
          return x * a <= B + OFFSIDE.tagUpFt
        })) return true
      }
      return false
    }
    // touches since the last frame came before this frame's picture; one AT
    // this frame's time came after it (the frame is written before the think)
    let touchedNow = carryTouch
    carryTouch = null
    while (ti < touches.length && touches[ti]!.t < f.t - 1e-6) {
      const tc = touches[ti++]!
      const team = tc.team ?? teamOf(tc.id ?? null)
      if (team) lastTouch = touchedNow = team
    }
    const prevTouch = lastTouch
    const ct = teamOf(f.carrier)
    if (ct) lastTouch = ct
    while (ti < touches.length && touches[ti]!.t <= f.t + 1e-6) {
      const tc = touches[ti++]!
      const team = tc.team ?? teamOf(tc.id ?? null)
      if (team) lastTouch = carryTouch = team
    }
    // A man who takes the puck while he is already over the line (reaching
    // back for it from inside the zone) is ahead of it: carrying it in does not
    // make him onside (rule 83.1's exception is for a carrier who crosses WITH it).
    if (f.carrier !== null && f.carrier !== (p?.carrier ?? null) && ct) {
      const me = (ct === 'home' ? f.home : f.away).find((s) => s.id === f.carrier)
      const a = dir(ct)
      aheadAtGain = me && me.x * a > B + OFFSIDE.manOverFt && f.puck.x * a < B ? f.carrier : null
    } else if (f.carrier === null) aheadAtGain = null

    // An open delayed offside: tag-up, puck out, or a touch in the zone.
    if (delayed) {
      const a = dir(delayed.team)
      if (f.puck.x * a < B - OFFSIDE.puckInFt) delayed = null
      else if (taggedUp(delayed.team, a)) delayed = null
      else if (ct === delayed.team) {
        if (!whistled(f.t)) {
          rep.missed.push({
            t: f.t, entryT: delayed.since, kind: 'delayedTouch', team: delayed.team, offenders: delayed.offenders,
            what: `${clk(f.t)} ${delayed.team} ${f.carrier} touched the puck in the zone on a delayed offside (${delayed.offenders.join(', ')} never tagged up since ${clk(delayed.since)}) — no whistle`,
          })
        }
        delayed = null
      }
    }

    if (!p || !p.live || p.homeNetX !== f.homeNetX) {
      // play (re)starts: read where the puck is, no entry
      for (const team of ['home', 'away'] as const) inZone[team] = f.puck.x * dir(team) >= B + OFFSIDE.puckInFt
      continue
    }
    for (const team of ['home', 'away'] as const) {
      const a = dir(team)
      const was = p.puck.x * a
      const now = f.puck.x * a
      if (now < B - OFFSIDE.puckInFt) inZone[team] = false
      if (inZone[team] || !(was < B + OFFSIDE.puckInFt && now >= B + OFFSIDE.puckInFt)) {
        if (now >= B + OFFSIDE.puckInFt) inZone[team] = true
        continue
      }
      inZone[team] = true
      // who propelled it over: the last side to have it (this frame's carrier, else the last one seen)
      const pt = teamOf(p.carrier)
      // a poke / block / save since the last frame took it off the carrier's stick
      const by = touchedNow ?? pt ?? prevTouch
      if (by !== team) continue
      rep.entries++
      // the crossing instant, interpolated between the two frames
      const u = (B + OFFSIDE.puckInFt - was) / Math.max(1e-6, now - was)
      const carrierId = p.carrier !== null && p.carrier === f.carrier ? f.carrier : null
      const carried = carrierId !== null && pt === team
      const prevMine = team === 'home' ? p.home : p.away
      const curMine = team === 'home' ? f.home : f.away
      const offenders: string[] = []
      // the carrier himself: only if he took the puck from inside the zone and is still over the line as it crosses
      if (carried && carrierId === aheadAtGain) {
        const me = curMine.find((s) => s.id === carrierId)
        const q = me ? prevMine.find((r) => r.id === carrierId) : undefined
        if (me && (q ? q.x + (me.x - q.x) * u : me.x) * a > B + OFFSIDE.manOverFt) offenders.push(carrierId)
      }
      for (const s of curMine) {
        if (s.id === carrierId || s.id === p.carrier) continue
        const q = prevMine.find((r) => r.id === s.id)
        const x = q ? q.x + (s.x - q.x) * u : s.x
        if (x * a > B + OFFSIDE.manOverFt) offenders.push(s.id)
      }
      if (offenders.length === 0) continue
      rep.offsideEntries++
      const tCross = p.t + (f.t - p.t) * u
      if (carried) {
        if (!whistled(tCross)) {
          rep.missed.push({
            t: tCross, entryT: tCross, kind: 'carried', team, offenders,
            what: `${clk(tCross)} ${team} ${carrierId} carried the puck in with ${offenders.join(', ')} already over the line — no whistle`,
          })
        }
      } else if (!delayed) {
        delayed = { team, since: tCross, offenders }
      }
    }
  }
  return rep
}

/** The stream's whistles on the same absolute clock as framesFromStream. */
export function whistlesFromStream(stream: GameStream): OffsideWhistle[] {
  const maxT = new Map<number, number>()
  for (const e of stream) maxT.set(e.period, Math.max(maxT.get(e.period) ?? 0, e.t))
  const base = new Map<number, number>()
  let b = 0
  for (const p of [...maxT.keys()].sort((x, y) => x - y)) {
    base.set(p, b)
    b += p <= 3 ? 1200 : (maxT.get(p) ?? 1200)
  }
  const out: OffsideWhistle[] = []
  for (const e of stream) if (e.type === 'whistle') out.push({ t: playAbsT(e, base), ...(e.reason ? { reason: e.reason } : {}) })
  return out
}

/** The stream's touches the frames miss (pokes, blocks, saves, tie-ups won), on the framesFromStream clock. */
export function touchesFromStream(stream: GameStream): OffsideTouch[] {
  const maxT = new Map<number, number>()
  for (const e of stream) maxT.set(e.period, Math.max(maxT.get(e.period) ?? 0, e.t))
  const base = new Map<number, number>()
  let b = 0
  for (const p of [...maxT.keys()].sort((x, y) => x - y)) {
    base.set(p, b)
    b += p <= 3 ? 1200 : (maxT.get(p) ?? 1200)
  }
  const goalies = new Map<string, 'home' | 'away'>()
  const out: OffsideTouch[] = []
  for (const e of stream) {
    const t = playAbsT(e, base)
    if (e.type === 'frame') {
      goalies.set(e.homeGoalie.player as string, 'home')
      goalies.set(e.awayGoalie.player as string, 'away')
      // W3 S6: the puck bounced off a body since the last frame (just before this one)
      if (e.puckTouch !== undefined) {
        const team = goalies.get(e.puckTouch as string)
        out.push(team ? { t: t - 1e-3, team } : { t: t - 1e-3, id: e.puckTouch as string })
      }
    } else if (e.type === 'pokeCheck' && e.success) out.push({ t, id: e.by as string })
    else if (e.type === 'blockedShot') out.push({ t, id: e.blocker as string })
    else if (e.type === 'save') {
      const team = goalies.get(e.goalie as string)
      out.push(team ? { t, team } : { t, id: e.goalie as string })
    } else if (e.type === 'battle' && e.winner) out.push({ t, id: e.winner as string })
  }
  return out
}

/** Judge a sim stream (vitest gates and the measurement harness). */
export function judgeOffsideStream(stream: GameStream): OffsideReport {
  return judgeOffside(framesFromStream(stream), whistlesFromStream(stream), touchesFromStream(stream))
}
