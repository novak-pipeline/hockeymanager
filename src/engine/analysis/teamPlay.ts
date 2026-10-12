/**
 * W3 team-play detectors (docs/gameplan-2026-09-28/W3-DESIGN.md, slice S1):
 *
 *   VT13 aimless       — a non-carrier standing still in a home-plate area with
 *                        nobody to cover and no screen to set.
 *   VT14 coverage      — defending: two men on the carrier while a man in the
 *                        slot is open; a defender out of the play on the far
 *                        side; the closest man ignoring a carrier next to him.
 *   VT16 crease camping — a carrier holding the puck inside the inner home plate
 *                        past a cap with no shot, pass or walk-out (measured
 *                        here; the cap itself is slice S5's).
 *   target flips        — job changes per player-minute (from the `job` field).
 *
 * Pure geometry on a neutral snapshot (feet, x along the rink, y across), so the
 * SAME rules judge the sim stream (vitest gates, the scorecard) and what the
 * match screen drew (viewerTruth.ts adapts probe frames). No sim, no DOM.
 */
import type { GameStream } from '@domain/events'

export interface TPSkater {
  id: string
  x: number
  y: number
  job?: string | undefined
}

export interface TPFrame {
  /** Absolute game clock, s. */
  t: number
  live: boolean
  home: TPSkater[]
  away: TPSkater[]
  /** x of the net each team DEFENDS (±89), or 0 if unknown this frame. */
  homeNetX: number
  puck: { x: number; y: number }
  carrier: string | null
}

export interface TPOptions {
  /** Bench doors (sim feet): a man near one is changing, not playing. */
  gates?: readonly { x: number; y: number }[]
}

/** Thresholds (design confidence: the eye, not an NHL measurement yet). */
export const TP = {
  goalX: 89,
  /** VT13: a body that stays inside this radius… */
  stillR: 2.5,
  /** …for this long is standing still. */
  stillS: 2,
  /** VT13: engaged = an opponent this close (battle, box-out, being marked). */
  engagedFt: 8,
  /** VT13: a puck this close is a puck battle, not idling. */
  puckNearFt: 15,
  /** VT14: stick reach of the carrier (two of them inside it = a double). */
  doubleFt: 7,
  /** VT14: a slot attacker with no defender this close is open. */
  openFt: 10,
  /** VT14 cases must last this long (a crossing is not a coverage error). */
  sustainS: 0.75,
  /** VT14 far-side defender: this far from the puck… */
  farPuckFt: 35,
  /** …and from every attacker. */
  farManFt: 25,
  /** VT14 ignored carrier: the closest defender inside this range… */
  ignoreFt: 12,
  /** …not closing on him for this long. */
  ignoreS: 1,
  /** VT16: inner home plate (out to the dots), and the hold that counts as camping. */
  creaseCampS: 2.5,
  benchFt: 22,
}

/** Distance out from the goal line toward centre for a point near net `netX`. */
function outFromLine(x: number, netX: number): number {
  return netX > 0 ? netX - x : x - netX
}

/** Inside the home plate in front of the net at `netX` (posts → dots → top of circles). */
export function inHomePlate(x: number, y: number, netX: number, depth = 35): boolean {
  const d = outFromLine(x, netX)
  if (d < -2 || d > depth) return false
  const half = d < 20 ? 3 + (19 * Math.max(0, d)) / 20 : 22
  return Math.abs(y) <= half
}

/** Live 5-on-5 (neither side short, no extra attacker). */
const fiveOnFive = (f: TPFrame): boolean => f.home.length === 5 && f.away.length === 5

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y)

function nearGate(p: { x: number; y: number }, opt: TPOptions): boolean {
  for (const g of opt.gates ?? []) if (Math.abs(p.x - g.x) < TP.benchFt && Math.abs(p.y - g.y) < TP.benchFt) return true
  return false
}

const clk = (t: number): string => {
  const p = Math.min(4, Math.floor(t / 1200) + 1)
  const r = 1200 - (t - (p - 1) * 1200)
  return `P${p} ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`
}

export interface TPCase {
  t: number
  what: string
}

export interface TPReport {
  liveMin: number
  /** VT13 */
  aimless: TPCase[]
  /** …of which in front of his own net. */
  aimlessOwn: number
  /** VT14 split */
  doubles: TPCase[]
  farSide: TPCase[]
  ignored: TPCase[]
  /** VT16 */
  camping: TPCase[]
  /** Job changes in live play, and player-minutes with a job. */
  jobFlips: number
  jobPlayerMin: number
}

/**
 * Run every team-play rule over a frame sequence (any frame rate; time comes
 * from `t`). A case is counted once per spell.
 */
export function judgeTeamPlay(frames: readonly TPFrame[], opt: TPOptions = {}): TPReport {
  const rep: TPReport = { liveMin: 0, aimless: [], aimlessOwn: 0, doubles: [], farSide: [], ignored: [], camping: [], jobFlips: 0, jobPlayerMin: 0 }
  // Per-skater stillness anchor.
  const anchor = new Map<string, { x: number; y: number; t: number; flagged: boolean }>()
  const lastJob = new Map<string, string>()
  // Per-team rolling case spells: key → since, flagged.
  const spell = new Map<string, { since: number; flagged: boolean; d0?: number }>()
  const touch = new Set<string>()
  const hold = (key: string, on: boolean, t: number, need: number, d?: number): { fire: boolean; since: number; d0: number | undefined } => {
    if (!on) return { fire: false, since: t, d0: undefined }
    touch.add(key)
    let s = spell.get(key)
    if (!s) {
      s = { since: t, flagged: false, ...(d !== undefined ? { d0: d } : {}) }
      spell.set(key, s)
    }
    if (!s.flagged && t - s.since >= need) {
      s.flagged = true
      return { fire: true, since: s.since, d0: s.d0 }
    }
    return { fire: false, since: s.since, d0: s.d0 }
  }
  let prevT = -1
  let carrySpell: { id: string; since: number; flagged: boolean } | null = null
  for (const f of frames) {
    const dt = prevT >= 0 && f.t > prevT && f.t - prevT < 1 ? f.t - prevT : 0
    prevT = f.t
    if (!f.live || f.homeNetX === 0) {
      anchor.clear()
      spell.clear()
      lastJob.clear()
      carrySpell = null
      continue
    }
    rep.liveMin += dt / 60
    touch.clear()
    const teams = [
      { mine: f.home, opp: f.away, netX: f.homeNetX, key: 'h' },
      { mine: f.away, opp: f.home, netX: -f.homeNetX, key: 'a' }
    ]
    const carrierTeam = f.carrier === null ? null : f.home.some((s) => s.id === f.carrier) ? 'h' : f.away.some((s) => s.id === f.carrier) ? 'a' : null
    const carrier = f.carrier === null ? null : [...f.home, ...f.away].find((s) => s.id === f.carrier) ?? null

    // --- target flips ---
    for (const s of [...f.home, ...f.away]) {
      if (s.job === undefined) continue
      rep.jobPlayerMin += dt / 60
      const was = lastJob.get(s.id)
      if (was !== undefined && was !== s.job) rep.jobFlips++
      lastJob.set(s.id, s.job)
    }

    // --- VT13 aimless (5v5) ---
    for (const tm of teams) {
      for (const s of tm.mine) {
        let a = anchor.get(s.id)
        if (!a || dist(a, s) > TP.stillR) {
          a = { x: s.x, y: s.y, t: f.t, flagged: false }
          anchor.set(s.id, a)
        }
        if (!fiveOnFive(f) || s.id === f.carrier || a.flagged || f.t - a.t < TP.stillS) continue
        const nets = [tm.netX, -tm.netX]
        const inDanger = nets.some((nx) => inHomePlate(s.x, s.y, nx))
        if (!inDanger) continue
        if (dist(s, f.puck) < TP.puckNearFt) continue
        if (tm.opp.some((o) => dist(o, s) < TP.engagedFt)) continue
        // A screen: in front of the net he attacks, on the puck's line to it.
        const atkNet = -tm.netX
        if (dist(f.puck, { x: atkNet, y: 0 }) > 30 && dist(s, { x: atkNet, y: 0 }) < 15) {
          const lx = atkNet - f.puck.x
          const ly = -f.puck.y
          const L = Math.hypot(lx, ly) || 1
          const off = Math.abs((s.x - f.puck.x) * (ly / L) - (s.y - f.puck.y) * (lx / L))
          if (off < 5) continue
        }
        a.flagged = true
        const own = inHomePlate(s.x, s.y, tm.netX)
        if (own) rep.aimlessOwn++
        rep.aimless.push({ t: f.t, what: `${clk(f.t)} ${s.id} still ${(f.t - a.t).toFixed(1)} s in the home plate ${own ? 'of his own net' : 'he attacks'} at (${s.x.toFixed(0)}, ${s.y.toFixed(0)}), nobody within ${TP.engagedFt} ft, puck ${dist(s, f.puck).toFixed(0)} ft away` })
      }
    }

    // --- VT14 coverage: the defending team (the one without the carrier) ---
    if (carrier && carrierTeam) {
      const def = teams.find((tm) => tm.key !== carrierTeam)!
      const atk = teams.find((tm) => tm.key === carrierTeam)!
      const ownSide = def.netX > 0 ? 1 : -1
      const puckIn = f.puck.x * ownSide
      const defSkaters = def.mine.filter((s) => !nearGate(s, opt))
      // (a) two on the carrier, a man open in the slot.
      if (puckIn > 25 && fiveOnFive(f)) {
        const onC = defSkaters.filter((s) => dist(s, carrier) < TP.doubleFt).length
        const open = atk.mine.find((o) => o.id !== carrier.id && inHomePlate(o.x, o.y, def.netX, 30) && !defSkaters.some((d) => dist(d, o) < TP.openFt))
        const r = hold(`dbl${def.key}`, onC >= 2 && !!open, f.t, TP.sustainS)
        if (r.fire) rep.doubles.push({ t: r.since, what: `${clk(r.since)} ${onC} defenders on carrier ${carrier.id} while ${open!.id} is open in the slot` })
      }
      // (b) a defender out of the play on the far side, in his own half.
      if (puckIn > 0 && Math.abs(f.puck.y) > 10) {
        for (const d of defSkaters) {
          const far =
            d.x * ownSide > 0 &&
            Math.abs(d.y) > 25 &&
            Math.sign(d.y) !== Math.sign(f.puck.y) &&
            dist(d, f.puck) > TP.farPuckFt &&
            !atk.mine.some((o) => dist(o, d) < TP.farManFt)
          const r = hold(`far${d.id}`, far, f.t, 1)
          if (r.fire) rep.farSide.push({ t: r.since, what: `${clk(r.since)} ${d.id} on the far boards at (${d.x.toFixed(0)}, ${d.y.toFixed(0)}), ${dist(d, f.puck).toFixed(0)} ft from the puck, nobody to cover` })
        }
      }
      // (c) the closest defender next to the carrier, not goal-side, not closing.
      {
        let near: TPSkater | null = null
        let nd = Infinity
        for (const d of defSkaters) {
          const q = dist(d, carrier)
          if (q < nd) {
            nd = q
            near = d
          }
        }
        const goalSide = near ? (near.x - carrier.x) * ownSide > 1 : false
        const anyOn = defSkaters.some((d) => dist(d, carrier) < TP.doubleFt)
        const cand = !!near && nd < TP.ignoreFt && !goalSide && !anyOn
        const key = near ? `ign${def.key}${near.id}` : `ign${def.key}`
        const s = cand ? spell.get(key) : undefined
        // closing: he got at least 2 ft nearer since the spell began
        const closing = s?.d0 !== undefined && nd < s.d0 - 2
        if (closing) spell.delete(key)
        else {
          const r = hold(key, cand, f.t, TP.ignoreS, nd)
          if (r.fire) rep.ignored.push({ t: r.since, what: `${clk(r.since)} ${near!.id} ${nd.toFixed(0)} ft from carrier ${carrier.id}, behind him and not closing for ${TP.ignoreS} s; nobody on the puck` })
        }
      }
    }

    // --- VT16 crease camping (carrier inside the inner home plate) ---
    if (carrier && carrierTeam) {
      const atkNet = carrierTeam === 'h' ? -f.homeNetX : f.homeNetX
      const inside = inHomePlate(carrier.x, carrier.y, atkNet, 20)
      if (!inside || !carrySpell || carrySpell.id !== carrier.id) carrySpell = inside ? { id: carrier.id, since: f.t, flagged: false } : null
      else if (!carrySpell.flagged && f.t - carrySpell.since > TP.creaseCampS) {
        carrySpell.flagged = true
        rep.camping.push({ t: carrySpell.since, what: `${clk(carrySpell.since)} ${carrier.id} held it inside the dots for over ${TP.creaseCampS} s` })
      }
    } else carrySpell = null

    // spells not refreshed this frame are over
    for (const k of [...spell.keys()]) if (!touch.has(k)) spell.delete(k)
  }
  return rep
}

/** Per-60 rate. */
export const per60 = (n: number, liveMin: number): number => (liveMin > 0 ? (n / liveMin) * 60 : 0)

/**
 * Adapt a sim stream: frames are live from a faceoff to the next whistle /
 * goal / period end. Positions to feet; the net each team defends comes from
 * the goalies' mean x over the period.
 */
export function framesFromStream(stream: GameStream): TPFrame[] {
  const REG = 1200
  const base = new Map<number, number>()
  {
    const maxT = new Map<number, number>()
    for (const e of stream) maxT.set(e.period, Math.max(maxT.get(e.period) ?? 0, e.t))
    let b = 0
    for (const p of [...maxT.keys()].sort((x, y) => x - y)) {
      base.set(p, b)
      b += p <= 3 ? REG : (maxT.get(p) ?? REG)
    }
  }
  const gsum = new Map<number, number>()
  for (const e of stream) if (e.type === 'frame') gsum.set(e.period, (gsum.get(e.period) ?? 0) + e.homeGoalie.pos.x - e.awayGoalie.pos.x)
  const out: TPFrame[] = []
  let live = false
  for (const e of stream) {
    if (e.type === 'faceoff') live = true
    else if (e.type === 'whistle' || e.type === 'periodEnd' || e.type === 'gameEnd' || e.type === 'goal') live = false
    else if (e.type === 'frame') {
      const g = gsum.get(e.period) ?? 0
      const homeNetX = g > 0 ? 89 : g < 0 ? -89 : 0
      const sk = (s: { player: string; pos: { x: number; y: number }; job?: string | undefined }): TPSkater => ({ id: s.player as string, x: s.pos.x * 100, y: s.pos.y * 42.5, job: s.job })
      out.push({
        t: (base.get(e.period) ?? 0) + e.t,
        live,
        home: e.home.map(sk),
        away: e.away.map(sk),
        homeNetX,
        puck: { x: e.puck.x * 100, y: e.puck.y * 42.5 },
        carrier: (e.puckCarrier as string | null) ?? null
      })
    }
  }
  return out
}

/** The sim's bench doors (agentSim BENCH_GATE, both benches). */
export const SIM_GATES = [
  { x: -22, y: 41 },
  { x: 22, y: 41 }
] as const
