/**
 * AUTOPILOT — an autonomous GM that plays the real career engine toward the
 * Stanley Cup, logging every decision (with its drivers) and every anomaly it
 * trips. It drives the SAME `Career` API the worker/UI use, so what it exercises
 * is what a human plays. Output is a machine-readable {@link AutopilotTrace} that
 * the reporter layer turns into the journal / ratings / bug audit / AI-GM notes.
 *
 * Design: pure deterministic heuristics (no LLM, no RNG of its own) — the "GM
 * thoughts" are the real decision drivers the policy weighed. Cheap enough to run
 * whole 15-season campaigns; the policy itself is a reusable AI-GM brain.
 */
import { Career } from '../career'
import type { CareerPhase } from '../views'

/* ────────────────────────────── trace shapes ────────────────────────────── */

export interface DecisionRecord {
  seq: number
  season: number
  phase: string
  day: number
  kind: string
  summary: string
  drivers: string[]
  result: string
  ok: boolean
}

export interface IssueRecord {
  seq: number
  season: number
  day: number
  severity: 'critical' | 'major' | 'minor'
  category: string
  message: string
  context?: string
}

export interface SeasonRecord {
  year: number
  rank?: number
  conferenceRank?: number
  record?: string
  points?: number
  madePlayoffs: boolean
  playoffResult: string
  wonCup: boolean
  champion?: string
  decisions: number
  trades: number
  signings: number
  drafted: number
  critical: number
  major: number
  minor: number
  /** A sample of the season's most salient news headlines — raw material for the
   *  fun-judging persona to assess whether the world felt alive and dramatic. */
  newsSample?: string[]
}

export interface AutopilotTrace {
  meta: {
    seed: number
    userTeamId: string
    userTeamName: string
    leagueName: string
    teams: number
    seasonsRequested: number
    seasonsPlayed: number
    source: string
  }
  decisions: DecisionRecord[]
  issues: IssueRecord[]
  seasons: SeasonRecord[]
  /** The GM's experience notes as it USED each feature — was the information there,
   *  sufficient, well-organised? Friction, not just data. The persona reporter turns
   *  these into per-feature UX/feel judgments. One note per feature per campaign. */
  featureNotes: string[]
  /** Raw snapshots of what each major screen actually serves (scouting, trades, FA,
   *  draft, a player profile, the dashboard), trimmed. Lets the persona reporter
   *  critique each screen's information design directly, as a player would see it. */
  viewSamples: Record<string, unknown>
  summary: {
    cups: number
    bestFinish: string
    totalTrades: number
    totalSignings: number
    totalDrafted: number
    critical: number
    major: number
    minor: number
    endedEarly: boolean
    endReason?: string
  }
}

/* ────────────────────────────── run context ────────────────────────────── */

type EventSink = (ev:
  | { type: 'decision'; data: DecisionRecord }
  | { type: 'issue'; data: IssueRecord }
  | { type: 'season'; data: SeasonRecord }) => void

type Plan = 'contend' | 'retool' | 'rebuild'

interface Ctx {
  career: Career
  trace: AutopilotTrace
  seq: number
  onEvent?: EventSink
  /** Players we've already tabled a trade offer on — so we don't re-spam the same
   *  target while an offer is pending (proposeTrade returns 'pending' by design). */
  offered: Set<string>
  /** The GM's multi-year plan this season (contend / retool / rebuild), computed
   *  once per season and driving every decision the way a real GM's does. */
  plan: Plan
  planYear: number
}

function log(ctx: Ctx, d: Omit<DecisionRecord, 'seq' | 'season' | 'day' | 'phase'>): void {
  const rec: DecisionRecord = { seq: ctx.seq++, season: ctx.career.year, day: safeDay(ctx), phase: phaseLabel(ctx), ...d }
  ctx.trace.decisions.push(rec)
  ctx.onEvent?.({ type: 'decision', data: rec })
}

function issue(ctx: Ctx, severity: IssueRecord['severity'], category: string, message: string, context?: string): void {
  const rec: IssueRecord = { seq: ctx.seq++, season: ctx.career.year, day: safeDay(ctx), severity, category, message, ...(context !== undefined ? { context } : {}) }
  ctx.trace.issues.push(rec)
  ctx.onEvent?.({ type: 'issue', data: rec })
}

/** The first few stack frames of a thrown error, trimmed to project files —
 *  enough to name the function and line without dumping node internals. */
function firstFrames(e: unknown, n = 4): string {
  const stack = (e as Error)?.stack
  if (typeof stack !== 'string') return ''
  const frames = stack
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') && l.includes('src'))
    .slice(0, n)
    .map((l) => l.replace(/^at /, '').replace(/^.*[\\/]src[\\/]/, 'src/'))
  return frames.length > 0 ? ` [${frames.join(' <- ')}]` : ''
}

function safeDay(ctx: Ctx): number {
  try { return ctx.career.getDashboard().day } catch { return -1 }
}
function phaseLabel(ctx: Ctx): string {
  try {
    const p = ctx.career.seasonPhase
    if (p === 'offseason') return `offseason:${ctx.career.getOffseason()?.stage ?? '?'}`
    return p
  } catch { return '?' }
}

/** Call an engine method that should be legal now; a throw is itself a bug. */
function guarded<T>(ctx: Ctx, label: string, fn: () => T): T | undefined {
  try { return fn() } catch (e) {
    issue(ctx, 'critical', 'throw', `${label} threw when it should have been legal: ${(e as Error).message}`, `phase=${phaseLabel(ctx)}`)
    return undefined
  }
}

/* ────────────────────────────── sanity battery ────────────────────────────── */
/* Adapted from seasonSanity.test.ts — the invariants that must hold every time. */

function checkStandings(ctx: Ctx): void {
  const s = guarded(ctx, 'getStandings', () => ctx.career.getStandings())
  if (!s) return
  let leagueW = 0, leagueLOtl = 0, gf = 0, ga = 0
  for (const row of s.overall) {
    if (row.points !== 2 * row.wins + row.overtimeLosses) issue(ctx, 'major', 'standings', `${row.abbreviation} points ${row.points} ≠ 2*W(${row.wins})+OTL(${row.overtimeLosses})`)
    if (row.wins + row.losses + row.overtimeLosses !== row.gamesPlayed) issue(ctx, 'major', 'standings', `${row.abbreviation} W+L+OTL ${row.wins + row.losses + row.overtimeLosses} ≠ GP ${row.gamesPlayed}`)
    leagueW += row.wins; leagueLOtl += row.losses + row.overtimeLosses
    gf += row.goalsFor; ga += row.goalsAgainst
  }
  if (leagueW !== leagueLOtl) issue(ctx, 'major', 'standings', `league wins ${leagueW} ≠ losses+OTL ${leagueLOtl}`)
  if (gf > 0 && Math.abs(gf - ga) / gf > 0.02) issue(ctx, 'minor', 'standings', `league GF ${gf} vs GA ${ga} imbalance >2%`)
}

function checkRostersAndCap(ctx: Ctx): void {
  const fin = guarded(ctx, 'getFinances', () => ctx.career.getFinances())
  if (fin && fin.capUsed > fin.salaryCap * 1.05) issue(ctx, 'major', 'cap', `over the cap: used ${money(fin.capUsed)} vs ceiling ${money(fin.salaryCap)}`)
  // Roster SIZE is only meaningful in-season — the offseason legitimately runs a
  // sub-full roster while contracts expire and camp hasn't opened.
  if (ctx.career.seasonPhase !== 'regularSeason') return
  const squad = guarded(ctx, 'getSquad', () => ctx.career.getSquad())
  if (squad) {
    const goalies = squad.rows.filter((p) => p.position === 'G').length
    if (squad.rosterCount < 18 || squad.rosterCount > 26) issue(ctx, 'major', 'roster', `NHL roster size ${squad.rosterCount} outside 18–26`)
    if (goalies < 2) issue(ctx, 'major', 'roster', `only ${goalies} goalies on the NHL roster`)
  }
}

function checkPlayerStats(ctx: Ctx): void {
  const table = guarded(ctx, 'getLeagueStatTable', () => ctx.career.getLeagueStatTable())
  if (!table) return
  for (const r of table.skaters.slice(0, 400)) {
    if (r.goals < 0 || r.assists < 0) { issue(ctx, 'major', 'stats', `${r.name} negative G/A`); break }
    if (r.gp > 0 && r.goals > r.gp + 5) { issue(ctx, 'major', 'stats', `${r.name} ${r.goals}G in ${r.gp}GP (implausible)`); break }
  }
  for (const g of table.goalies.slice(0, 120)) {
    if (g.savePct < 0 || g.savePct > 1) { issue(ctx, 'major', 'stats', `${g.name} save% ${g.savePct} out of [0,1]`); break }
  }
}

function checkInboxText(ctx: Ctx): void {
  const inbox = guarded(ctx, 'getInbox', () => ctx.career.getInbox())
  if (!inbox) return
  const bad = /(undefined|NaN|\[object Object\]|\$NaN|NaN%)/
  for (const it of inbox.items.slice(0, 60)) {
    if (!it.headline) { issue(ctx, 'minor', 'inbox', 'inbox item with an empty headline'); break }
    if (bad.test(`${it.headline} ${it.body ?? ''}`)) { issue(ctx, 'major', 'inbox', `inbox text leaks a placeholder: "${it.headline}"`); break }
  }
}

function runSanity(ctx: Ctx): void {
  checkStandings(ctx); checkRostersAndCap(ctx); checkPlayerStats(ctx); checkInboxText(ctx)
}

/* ────────────────────────────── helpers ────────────────────────────── */

const money = (n: number): string => `$${(n / 1e6).toFixed(1)}M`
const POS_GROUP = (p: string): 'F' | 'D' | 'G' => (p === 'G' ? 'G' : p === 'D' ? 'D' : 'F')
/** Deterministic non-negative string hash (for varying choices reproducibly). */
function stableHash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0)
}

/** Record a one-per-feature experience observation (information sufficiency /
 *  friction), tagged so the reporter can group by feature. Deduped by tag. */
const noted = new Set<string>()
function noteFeature(ctx: Ctx, feature: string, note: string): void {
  if (noted.has(feature)) return
  noted.add(feature)
  ctx.trace.featureNotes.push(`[${feature}] ${note}`)
}

/** Trim an array field to `n` entries so the raw view snapshot stays small. */
function trim<T>(arr: T[] | undefined, n: number): T[] { return (arr ?? []).slice(0, n) }

/** Snapshot what the major screens actually serve, so the persona reporter can
 *  critique each screen's information design directly. Called once, mid-season-1. */
function snapshotViews(ctx: Ctx): void {
  if (Object.keys(ctx.trace.viewSamples).length) return
  const s = ctx.trace.viewSamples
  const grab = (key: string, fn: () => unknown): void => { try { s[key] = fn() } catch (e) { s[key] = { error: (e as Error).message } } }
  grab('dashboard', () => ctx.career.getDashboard())
  grab('squad', () => { const v = ctx.career.getSquad(); return { ...v, rows: trim(v.rows, 6) } })
  grab('trades', () => { const v = ctx.career.getTrades(); return { tradingOpen: v.tradingOpen, myCapSpace: v.myCapSpace, myPlayers: trim(v.myPlayers, 4), myPicks: trim(v.myPicks, 4), partners: trim(v.partners, 2).map((p) => ({ ...p, players: trim(p.players, 3), picks: trim(p.picks, 2) })), incoming: trim(v.incoming, 2) } })
  grab('scoutingDraftBoard', () => { const v = ctx.career.getDraftRankings(); return { phase: v.phaseLabel, draftYear: v.draftYear, rankings: trim(v.rankings, 6), scoutBoard: trim(v.scoutBoard, 6), scoutBoards: trim(v.scoutBoards, 2).map((b) => ({ scoutName: b.scoutName, rows: trim(b.rows, 3) })) } })
  grab('standings', () => { const v = ctx.career.getStandings(); return { overall: trim(v.overall, 8) } })
  grab('playoffOdds', () => { const v = ctx.career.getPlayoffOdds(); return { available: v.available, qualifiers: v.qualifiers, rows: trim(v.rows, 6) } })
  grab('finances', () => ctx.career.getFinances())
  grab('leaders', () => ctx.career.getStats())
  // A representative player profile — the deepest single screen.
  grab('playerProfile', () => { const first = ctx.career.getSquad().rows[0]; return first ? ctx.career.getPlayer(first.playerId) : null })
  ctx.trace.featureNotes.push('[snapshot] captured raw view outputs for dashboard, squad, trades, scouting/draft board, standings, playoff odds, finances, leaders, and a player profile — for UX critique')
}

/* ────────────────────────────── GM policy ────────────────────────────── */

/** Classify the franchise's window from roster quality + age + standing — the
 *  same read a real GM makes before deciding whether to buy, hold, or tear down. */
function assessPlan(ctx: Ctx): Plan {
  const squad = guarded(ctx, 'getSquad', () => ctx.career.getSquad())
  const dash = guarded(ctx, 'getDashboard', () => ctx.career.getDashboard())
  const skaters = (squad?.rows ?? []).filter((p) => p.position !== 'G').sort((a, b) => b.overall - a.overall)
  const top6 = skaters.slice(0, 6)
  const coreQ = top6.length ? top6.reduce((s, p) => s + p.overall, 0) / top6.length : 72
  const coreAge = top6.length ? top6.reduce((s, p) => s + p.age, 0) / top6.length : 27
  const cRank = dash?.userTeam.conferenceRank ?? 8
  let score = 0
  if (coreQ >= 83) score += 2; else if (coreQ >= 79) score += 1; else if (coreQ < 76) score -= 2
  if (cRank <= 4) score += 2; else if (cRank <= 8) score += 1; else if (cRank >= 20) score -= 2
  if (coreAge >= 31) score -= 1              // aging core → lean away from all-in
  if (coreAge <= 25 && coreQ >= 78) score += 1 // young and good → window opening
  return score >= 2 ? 'contend' : score <= -2 ? 'rebuild' : 'retool'
}

/** The plan for the current season, computed once and logged as a GM decision. */
function getPlan(ctx: Ctx): Plan {
  if (ctx.planYear === ctx.career.year) return ctx.plan
  ctx.plan = assessPlan(ctx)
  ctx.planYear = ctx.career.year
  const blurb: Record<Plan, string> = {
    contend: 'the window is open — spend to the cap, buy at the deadline, protect the core',
    retool: 'stay competitive but selective — keep the core, add cheap upside, no panic moves',
    rebuild: 'out of the window — sell veterans for futures, hoard picks, give the kids runway',
  }
  log(ctx, { kind: 'plan', summary: `Season plan: ${ctx.plan.toUpperCase()}`, drivers: [blurb[ctx.plan]], result: ctx.plan, ok: true })
  return ctx.plan
}

function doCaptain(ctx: Ctx): void {
  const squad = guarded(ctx, 'getSquad', () => ctx.career.getSquad())
  if (!squad) return
  const cap = [...squad.rows].filter((p) => p.position !== 'G').sort((a, b) => b.overall - a.overall)[0]
  if (!cap) { issue(ctx, 'critical', 'softlock', 'captainsPending but no eligible skater to name captain'); return }
  const res = guarded(ctx, 'setCaptain', () => ctx.career.setCaptain(cap.playerId))
  log(ctx, { kind: 'captain', summary: `Named ${cap.name} (${cap.overall} OVR) captain`, drivers: ['highest-overall skater', 'captains gate blocks the season opener'], result: res?.ok ? 'named' : (res?.message ?? 'failed'), ok: !!res?.ok })
}

/** Opportunistically keep NHL depth by recalling from the farm when the dressable
 *  pool gets thin. NOT a bug detector — the engine auto-recalls at game time and
 *  only a genuine step() throw (caught in the driver) is a real lineup softlock. */
function maintainRoster(ctx: Ctx): void {
  const squad = guarded(ctx, 'getSquad', () => ctx.career.getSquad())
  if (!squad) return
  const healthy = squad.rows.filter((p) => !p.injury)
  const skaters = healthy.filter((p) => p.position !== 'G').length
  const goalies = healthy.filter((p) => p.position === 'G').length
  if (skaters >= 16 && goalies >= 2) return
  const ahl = guarded(ctx, 'getAhlSquadView', () => ctx.career.getAhlSquadView())
  const pool = ahl?.rows ? [...ahl.rows] : []
  const wantG = goalies < 2
  pool.sort((a, b) => {
    if (wantG) { if (a.position === 'G' && b.position !== 'G') return -1; if (b.position === 'G' && a.position !== 'G') return 1 }
    return b.overall - a.overall
  })
  let recalled = 0
  for (const p of pool) {
    if (squad.rosterCount + recalled >= 23) break
    const r = ctx.career.callUp(p.playerId)
    if (r.ok) {
      recalled++
      log(ctx, { kind: 'callup', summary: `Recalled ${p.name} (${p.overall} OVR ${p.position})`, drivers: ['keeping NHL depth', wantG ? 'needed a goalie' : 'thin up front'], result: 'recalled', ok: true })
      if (skaters + recalled >= 16 && !wantG) break
    }
  }
}

function clearMeetings(ctx: Ctx, dash: ReturnType<Career['getDashboard']>): void {
  if (dash.staffMeetingDue) {
    const r = guarded(ctx, 'delegateStaffMeeting', () => ctx.career.delegateStaffMeeting())
    log(ctx, { kind: 'meeting', summary: 'Delegated the staff meeting to the AGM', drivers: ['bi-weekly staff meeting was blocking Continue'], result: r?.summary ?? 'delegated', ok: !!r })
  }
  if (dash.scoutMeetingDue) {
    const r = guarded(ctx, 'delegateScoutMeeting', () => ctx.career.delegateScoutMeeting())
    log(ctx, { kind: 'meeting', summary: 'Delegated the scout meeting', drivers: ['recurring scout meeting was blocking Continue'], result: r?.summary ?? 'delegated', ok: !!r })
  }
  // Board meeting + season review are SOFT gates (the AGM sits them if you sim
  // past), so the autopilot just lets them auto-resolve rather than answering.
}

function clearInteractions(ctx: Ctx): void {
  const inbox = guarded(ctx, 'getInbox', () => ctx.career.getInbox())
  for (const it of (inbox?.interactions ?? []).slice(0, 4)) {
    if (!it.options?.length) continue
    // Vary the response like a real GM instead of always taking the first option —
    // deterministic per interaction id so runs stay reproducible.
    const opt = it.options[stableHash(it.id) % it.options.length]
    const r = ctx.career.respondToInteraction(it.id, opt.id)
    log(ctx, { kind: 'interaction', summary: `Answered ${it.playerName}: "${opt.label}"`, drivers: [it.kind], result: r.ok ? (r.message ?? 'handled') : 'no-op', ok: r.ok })
  }
}

function contention(ctx: Ctx): { contending: boolean; note: string } {
  const dash = guarded(ctx, 'getDashboard', () => ctx.career.getDashboard())
  const confRank = dash?.userTeam.conferenceRank ?? 99
  let pct: number | undefined
  const odds = guarded(ctx, 'getPlayoffOdds', () => ctx.career.getPlayoffOdds())
  if (odds?.available) pct = odds.rows.find((t) => t.isUser)?.playoffPct
  return { contending: confRank <= 6 || (pct ?? 0) >= 55, note: `conf #${confRank}${pct != null ? `, ${Math.round(pct)}% playoff odds` : ''}` }
}

interface Pkg { playerIds: string[]; pickIds: string[] }

function buildPackage(tv: ReturnType<Career['getTrades']>, targetVal: number, need: string): Pkg | null {
  // The AI values its OWN outgoing player ~8% above par (endowment), so a paper-even
  // package always reads as a lowball. Target a modest overpay to actually close —
  // that's what a real GM does when he wants the player.
  const target = targetVal * 1.12
  const picks = [...tv.myPicks].sort((a, b) => a.value - b.value)
  // The trade view now lists the whole organisation (A4); the GM's own lineup
  // math is about the men who actually dress, so read the NHL roster only.
  const surplus = tv.myPlayers.filter((p) => (p.assetClass ?? 'nhl') === 'nhl' && POS_GROUP(p.position) !== need && p.tradeValue != null && !p.noTradeClause).sort((a, b) => (a.tradeValue ?? 0) - (b.tradeValue ?? 0))
  const playerIds: string[] = []; const pickIds: string[] = []; let acc = 0
  for (const pk of [...picks].reverse()) { if (acc >= target) break; pickIds.push(pk.id); acc += pk.value }
  let si = 0
  while (acc < target && si < surplus.length && playerIds.length < 2) { const s = surplus[si++]; playerIds.push(s.playerId); acc += s.tradeValue ?? 0 }
  return acc < targetVal ? null : { playerIds, pickIds }
}

function tryTradeUpgrade(ctx: Ctx, aggressive: boolean): boolean {
  // Rebuilders don't trade futures for win-now upgrades — they're sellers.
  if (getPlan(ctx) === 'rebuild') return false
  const tv = guarded(ctx, 'getTrades', () => ctx.career.getTrades())
  if (!tv || !tv.tradingOpen) return false
  noteFeature(ctx, 'trades', `Every partner's roster comes with per-player tradeValue + cap space + posture, and evaluateTradeDraft gives a side-effect-free partner verdict — enough to value a deal. Friction: to price a target I query getTrades then a separate evaluateTradeDraft; the value isn't on the roster screen. Partners seen: ${tv.partners.length}, my cap space ${money(tv.myCapSpace)}.`)
  const byGroup: Record<string, number[]> = { F: [], D: [], G: [] }
  // NHL roster only — a farm full of prospects must not read as blue-line depth.
  for (const p of tv.myPlayers) if ((p.assetClass ?? 'nhl') === 'nhl') byGroup[POS_GROUP(p.position)].push(p.overall)
  for (const k of Object.keys(byGroup)) byGroup[k].sort((a, b) => b - a)
  const weakStarter = (g: string, n: number): number => byGroup[g][n - 1] ?? 0
  const needScore: Record<string, number> = { F: 90 - weakStarter('F', 9), D: 90 - weakStarter('D', 5), G: 90 - weakStarter('G', 1) }
  const need = Object.keys(needScore).sort((a, b) => needScore[b] - needScore[a])[0]
  const myFloor = weakStarter(need, need === 'G' ? 1 : need === 'D' ? 5 : 9)

  interface Cand { partnerId: string; partnerName: string; posture: string; pid: string; name: string; ovr: number; val: number; salary: number; years: number }
  const cands: Cand[] = []
  for (const partner of tv.partners) {
    for (const p of partner.players) {
      if (POS_GROUP(p.position) !== need || p.noTradeClause || p.tradeValue == null) continue
      if (p.overall < myFloor + 3) continue
      if (p.salary > tv.myCapSpace + 1.5e6) continue
      cands.push({ partnerId: partner.teamId, partnerName: partner.teamName, posture: partner.posture ?? '', pid: p.playerId, name: p.name, ovr: p.overall, val: p.tradeValue, salary: p.salary, years: p.yearsRemaining })
    }
  }
  cands.sort((a, b) => b.ovr - a.ovr)
  const limit = aggressive ? 6 : 2
  let made = 0
  for (const c of cands.slice(0, 12)) {
    if (made >= 1) break
    if (ctx.offered.has(c.pid)) continue // already tabled an offer on him — don't re-spam while it's pending
    const pkg = buildPackage(tv, c.val, need)
    if (!pkg) continue
    const proposal = { partnerTeamId: c.partnerId, givePlayerIds: pkg.playerIds, givePickIds: pkg.pickIds, receivePlayerIds: [c.pid], receivePickIds: [] as string[] }
    const draft = guarded(ctx, 'evaluateTradeDraft', () => ctx.career.evaluateTradeDraft(proposal))
    if (!draft || draft.partnerVerdict === 'blocked') continue
    if (draft.partnerVerdict === 'accept' || (aggressive && draft.partnerVerdict === 'counter')) {
      const res = guarded(ctx, 'proposeTrade', () => ctx.career.proposeTrade(proposal))
      ctx.offered.add(c.pid) // whether accepted or slept-on ('pending'), the offer is out — don't re-table it
      const ok = res?.verdict === 'accept'
      const verb = ok ? 'Acquired' : res?.verdict === 'pending' ? 'Made an offer for' : 'Offered for'
      log(ctx, {
        kind: 'trade',
        summary: `${verb} ${c.name} (${c.ovr} OVR ${need})`,
        drivers: [`need at ${need} (my tier ~${myFloor} OVR)`, `${c.name} is ${c.ovr} OVR, ${c.years}yr @ ${money(c.salary)}`, `paper value ${draft.net >= 0 ? '+' : ''}${draft.net} my way`, `${c.partnerName}${c.posture ? ` (${c.posture})` : ''} → ${res?.verdict ?? 'error'}`],
        result: res ? `${res.verdict}: ${res.message}` : 'error', ok,
      })
      if (ok) return true
      made++
      if (made >= limit) break
    }
  }
  return false
}

function reviewIncoming(ctx: Ctx): void {
  const tv = guarded(ctx, 'getTrades', () => ctx.career.getTrades())
  if (!tv) return
  const sideValue = (side: { players: Array<{ tradeValue?: number }>; picks: Array<{ value: number }> }): number =>
    side.players.reduce((n, p) => n + (p.tradeValue ?? 0), 0) + side.picks.reduce((n, p) => n + p.value, 0)
  for (const offer of tv.incoming.slice(0, 6)) {
    // A deal the club can't legally complete isn't on the table, however good the
    // paper value looks — the view says why, so a real GM would move on.
    if (offer.blockedReason) continue
    const get = sideValue(offer.receive)
    const give = sideValue(offer.give)
    if (get >= give * 1.15 && get - give >= 3) {
      const res = guarded(ctx, 'acceptTrade', () => ctx.career.acceptTrade(offer.offerId))
      log(ctx, {
        kind: 'trade-in',
        summary: res?.ok ? `Accepted an offer from ${offer.receive.teamName}` : `Tried to accept ${offer.receive.teamName}'s offer, too late`,
        drivers: [`we get ${get.toFixed(0)} value for ${give.toFixed(0)}`, 'clear win on paper'],
        result: res?.ok ? 'accepted' : (res?.message ?? 'error'),
        ok: !!res?.ok,
      })
      // One deal per pass. Taking a player off this roster can kill the offers
      // below (two clubs bidding for the same man is normal), and no GM works a
      // list he already knows is out of date.
      return
    }
  }
}

function doDeadline(ctx: Ctx): void {
  const dd = guarded(ctx, 'getDeadlineDay', () => ctx.career.getDeadlineDay())
  if (!dd) return
  const plan = getPlan(ctx)
  const { contending: inRace, note: raceNote } = contention(ctx)
  // A contender buys; a rebuilder sells; a retooler follows the race.
  const contending = plan === 'contend' || (plan === 'retool' && inRace)
  const note = `${plan}, ${raceNote}`
  if (contending) {
    const tv = guarded(ctx, 'getTrades', () => ctx.career.getTrades())
    const target = [...dd.shopped].sort((a, b) => b.value - a.value).find((s) => s.value <= 60)
    if (target && tv) {
      const pkg = buildPackage(tv, target.value, POS_GROUP(target.position))
      if (pkg) {
        const proposal = { partnerTeamId: target.teamId, givePlayerIds: pkg.playerIds, givePickIds: pkg.pickIds, receivePlayerIds: [target.playerId], receivePickIds: [] }
        const res = guarded(ctx, 'proposeTrade(deadline)', () => ctx.career.proposeTrade(proposal))
        log(ctx, { kind: 'deadline-buy', summary: `Deadline: went for ${target.name} (${target.value} val, asking "${target.asking}")`, drivers: [`contending (${note})`, 'buying for a playoff run'], result: res ? `${res.verdict}: ${res.message}` : 'error', ok: res?.verdict === 'accept' })
        return
      }
    }
    log(ctx, { kind: 'deadline-buy', summary: 'Deadline: shopped the board but stood pat', drivers: [`contending (${note})`, 'no affordable fit / package'], result: 'no move', ok: true })
  } else {
    const tv = guarded(ctx, 'getTrades', () => ctx.career.getTrades())
    const rental = tv?.myPlayers.filter((p) => (p.assetClass ?? 'nhl') === 'nhl' && p.yearsRemaining <= 1 && p.age >= 27 && !p.noTradeClause).sort((a, b) => (b.tradeValue ?? 0) - (a.tradeValue ?? 0))[0]
    if (rental) {
      const r = guarded(ctx, 'shopPlayer', () => ctx.career.shopPlayer(rental.playerId))
      log(ctx, { kind: 'deadline-sell', summary: `Deadline: shopped rental ${rental.name} (${rental.overall} OVR, expiring)`, drivers: [`out of it (${note})`, 'selling futures for picks'], result: r?.message ?? 'shopped', ok: !!r })
    } else {
      log(ctx, { kind: 'deadline-sell', summary: 'Deadline: seller with nothing to move', drivers: [`out of it (${note})`], result: 'no rentals', ok: true })
    }
  }
}

/** Count picks already made on the board (the progress signal). */
function picksMade(ctx: Ctx): number {
  const d = guarded(ctx, 'getDraft', () => ctx.career.getDraft())
  return d ? d.board.filter((b) => b.selection).length : -1
}

function doDraft(ctx: Ctx): void {
  let guard = 0
  let noProgress = 0
  const MAX = 300 // 224 slots + AI-sim rounds is plenty; a real draft never needs more
  while (guard++ < MAX) {
    const d = guarded(ctx, 'getDraft', () => ctx.career.getDraft())
    if (!d || d.complete) break
    if (!d.userIsOnClock) {
      // advanceDraft() is void — sim AI to our next pick and gauge progress by the
      // board, NOT by the (always-undefined) return value.
      const before = picksMade(ctx)
      ctx.career.advanceDraft()
      const after = picksMade(ctx)
      const nowOnClock = guarded(ctx, 'getDraft', () => ctx.career.getDraft())?.userIsOnClock
      if (after <= before && !nowOnClock) { // no AI picks made and we're still not up — done/stuck
        break
      }
      continue
    }
    const ranks = guarded(ctx, 'getDraftRankings', () => ctx.career.getDraftRankings())
    noteFeature(ctx, 'scouting/draft', `The board serves an analyst ranking, my own scouts' re-ranked board, per-scout boards, potential-stars + pNHLer projections, and a fullRankById so off-board prospects still get a slot. Rich fog-of-war.`)
    const rankOf = (pid: string): number => ranks?.fullRankById[pid] ?? 9999
    // The board serves the WHOLE class incl. already-drafted names (flagged
    // `drafted`); a real UI greys those out — filter them or draftPlayer rejects them.
    const ordered = d.prospects.filter((p) => !p.drafted).sort((a, b) => rankOf(a.playerId) - rankOf(b.playerId))
    if (!ordered.length) { issue(ctx, 'critical', 'draft', 'user on the clock but the board serves NO available (undrafted) prospect'); break }
    // Try candidates until one is accepted. draftPlayer() is void and authoritative:
    // if it does NOT throw, the selection registered. (Don't diff board counts — that
    // reads a rebuilt/memoised board and can false-negative, forcing a needless auto.)
    let landed = false
    let lastErr = ''
    for (const cand of ordered.slice(0, 12)) {
      try {
        ctx.career.draftPlayer(cand.playerId)
        const s = ctx.trace.seasons.at(-1); if (s) s.drafted++
        log(ctx, { kind: 'draft', summary: `Drafted ${cand.name} (analyst #${rankOf(cand.playerId)})`, drivers: ['best available on the scouts’ board'], result: 'selected', ok: true })
        landed = true; break
      } catch (e) { lastErr = (e as Error).message }
    }
    if (!landed) {
      noProgress++
      if (noProgress >= 2) {
        issue(ctx, 'critical', 'draft', `draftPlayer() rejected every top board prospect (last error: ${lastErr || 'none'}) — the user pick will not register`, `season ${ctx.career.year} draft`)
        break
      }
    } else noProgress = 0
  }
}

/** Attempt a contract only when it fits the cap — a real GM never tables an
 *  offer he can't fit. Returns the outcome; a THROW here is a genuine engine bug
 *  (the fit was checked), so it surfaces as such via `guarded`. */
function trySign(ctx: Ctx, remaining: number, salary: number, fn: () => { signed: boolean; message: string }, label: string):
  { signed: boolean; message: string } | null {
  if (salary > remaining) return { signed: false, message: `skipped — ${money(salary)} doesn't fit ${money(remaining)} space` }
  return guarded(ctx, label, fn) ?? null
}

function doResign(ctx: Ctx): void {
  const os = guarded(ctx, 'getOffseason', () => ctx.career.getOffseason())
  if (!os || os.stage !== 'resign') return
  const plan = getPlan(ctx)
  // Contenders protect the core; retoolers keep good-and-not-old; rebuilders keep
  // only young keepers and let veterans walk for cap and futures.
  const wants = (r: { overall: number; age: number }): boolean =>
    plan === 'contend' ? r.overall >= 70 && r.age <= 36
      : plan === 'rebuild' ? r.overall >= 74 && r.age <= 27
        : r.overall >= 74 && r.age <= 33
  let remaining = os.salaryCap - os.capUsed
  const keep = os.expiring.filter((r) => r.status === 'pending' && wants(r)).sort((a, b) => b.overall - a.overall)
  for (const r of keep.slice(0, 10)) {
    if (remaining < 1e6) break
    const res = trySign(ctx, remaining, r.askSalary, () => ctx.career.resignPlayer(r.playerId, r.askSalary, r.askYears), 'resignPlayer')
    const s = ctx.trace.seasons.at(-1); if (res?.signed && s) { s.signings++; remaining -= r.askSalary }
    log(ctx, { kind: 'resign', summary: `${res?.signed ? 'Re-signed' : 'Passed on'} ${r.name} (${r.overall} OVR) ${r.askYears}yr @ ${money(r.askSalary)}`, drivers: ['core piece worth keeping', `${money(remaining)} cap room`], result: res?.message ?? 'no', ok: !!res?.signed })
  }
}

function doFreeAgency(ctx: Ctx): void {
  const hub = guarded(ctx, 'getFaHub', () => ctx.career.getFaHub())
  if (!hub) return
  const squad = guarded(ctx, 'getSquad', () => ctx.career.getSquad())
  if (squad && squad.rosterCount >= 23) return
  noteFeature(ctx, 'free-agency', `The FA hub shows each UFA's ask, his camp's read on us (keen/warm/cold), rival clubs circling, a "decides in N days" market clock, and whether his ask has softened as summer drags — legible two-way market. ${hub.rows.length} names, ${money(hub.capSpace)} to spend.`)
  const plan = getPlan(ctx)
  let remaining = hub.capSpace
  const affordable = hub.rows
    // A rebuilder doesn't hand term/money to win-now vets — only cheap young upside.
    .filter((r) => !r.pendingOffer && !r.inTalks && (plan !== 'rebuild' || r.age <= 25))
    .sort((a, b) => b.overall - a.overall)
  for (const fa of affordable.slice(0, 8)) {
    if (remaining < 1e6) break
    if (fa.askSalary > remaining) continue
    if (hub.windowOpen) {
      const res = guarded(ctx, 'submitFaOffer', () => ctx.career.submitFaOffer(fa.playerId, fa.askSalary, fa.askYears))
      if (res?.ok) remaining -= fa.askSalary
      log(ctx, { kind: 'sign-fa', summary: `Tabled ${money(fa.askSalary)}×${fa.askYears} for UFA ${fa.name} (${fa.overall} OVR)`, drivers: ['roster spot open', `fits cap (${money(remaining)} left)`], result: res?.message ?? 'tabled', ok: !!res?.ok })
    } else {
      const res = trySign(ctx, remaining, fa.askSalary, () => ctx.career.signFreeAgent(fa.playerId, fa.askSalary, fa.askYears), 'signFreeAgent')
      const s = ctx.trace.seasons.at(-1); if (res?.signed && s) { s.signings++; remaining -= fa.askSalary }
      log(ctx, { kind: 'sign-fa', summary: `${res?.signed ? 'Signed' : 'Passed on'} UFA ${fa.name} (${fa.overall} OVR) ${fa.askYears}yr @ ${money(fa.askSalary)}`, drivers: ['roster spot open', 'best affordable body'], result: res?.message ?? 'no', ok: !!res?.signed })
    }
    if (remaining < 1e6) break
  }
}

/* ────────────────────────────── season driver ────────────────────────────── */

function recordSeasonEnd(ctx: Ctx, s: SeasonRecord): void {
  const dash = guarded(ctx, 'getDashboard', () => ctx.career.getDashboard())
  if (dash) {
    s.rank = dash.userTeam.rank
    s.conferenceRank = dash.userTeam.conferenceRank
    const st = dash.userTeam.standing
    s.record = `${st.wins}-${st.losses}-${st.overtimeLosses}`
    s.points = st.points
  }
  const po = guarded(ctx, 'getPlayoffs', () => ctx.career.getPlayoffs())
  if (po) {
    s.madePlayoffs = !!po.userQualified
    if (po.championTeamName) s.champion = po.championTeamName
    s.wonCup = !!po.championTeamName && po.championTeamName === dash?.userTeam.name
    s.playoffResult = s.wonCup ? 'Champion' : (deriveRound(po) ?? (s.madePlayoffs ? 'Playoffs' : 'Missed'))
  }
  s.critical = ctx.trace.issues.filter((i) => i.season === s.year && i.severity === 'critical').length
  s.major = ctx.trace.issues.filter((i) => i.season === s.year && i.severity === 'major').length
  s.minor = ctx.trace.issues.filter((i) => i.season === s.year && i.severity === 'minor').length
  s.decisions = ctx.trace.decisions.filter((d) => d.season === s.year).length
  s.trades = ctx.trace.decisions.filter((d) => d.season === s.year && (d.kind === 'trade' || d.kind === 'trade-in' || d.kind === 'deadline-buy') && d.ok).length
  // Narrative sample: the season's headlines, so the fun-judging persona can read
  // whether the world felt alive (rivalries, streaks, records, drama) or flat.
  const inbox = guarded(ctx, 'getInbox', () => ctx.career.getInbox())
  if (inbox) {
    const heads: string[] = []
    const seen = new Set<string>()
    for (const it of inbox.items) {
      if (!it.headline || seen.has(it.headline)) continue
      seen.add(it.headline); heads.push(it.headline)
    }
    if (heads.length) s.newsSample = heads.slice(0, 16)
  }
  ctx.onEvent?.({ type: 'season', data: s })
}

function deriveRound(po: NonNullable<ReturnType<Career['getPlayoffs']>>): string | undefined {
  let last: string | undefined
  const names = ['Round 1', 'Round 2', 'Conf. Final', 'Cup Final']
  po.rounds.forEach((rd, i) => { if ((rd.series ?? []).some((sr) => sr.involvesUser)) last = rd.name ?? names[i] ?? `Round ${i + 1}` })
  return last
}

export function runAutopilot(career: Career, opts: { seasons: number; source: string; onEvent?: EventSink }): AutopilotTrace {
  const dash0 = career.getDashboard()
  const trace: AutopilotTrace = {
    meta: { seed: career.seed, userTeamId: career.userTeamId as unknown as string, userTeamName: dash0.userTeam.name, leagueName: dash0.leagueName, teams: career.data.league.teams.length, seasonsRequested: opts.seasons, seasonsPlayed: 0, source: opts.source },
    decisions: [], issues: [], seasons: [], featureNotes: [], viewSamples: {},
    summary: { cups: 0, bestFinish: '—', totalTrades: 0, totalSignings: 0, totalDrafted: 0, critical: 0, major: 0, minor: 0, endedEarly: false },
  }
  const ctx: Ctx = { career, trace, seq: 0, offered: new Set(), plan: 'retool', planYear: -1 }
  if (opts.onEvent) ctx.onEvent = opts.onEvent

  const targetYear = career.year + opts.seasons
  let curYear = career.year
  let season = beginSeason(ctx, curYear)
  const recorded = new Set<number>()
  let stallKey = ''; let stalls = 0; let hardGuard = 0
  const HARD_LIMIT = 400_000

  while (career.year < targetYear && hardGuard++ < HARD_LIMIT) {
    // Capture the season's results the moment the playoffs end (offseason begins),
    // while standings + champion are still live — NOT after the year rolls over
    // (when standings reset to 0-0-0).
    if (career.seasonPhase === 'offseason' && !recorded.has(curYear)) {
      recordSeasonEnd(ctx, season); recorded.add(curYear)
    }
    if (career.year !== curYear) {
      if (!recorded.has(curYear)) { recordSeasonEnd(ctx, season); recorded.add(curYear) }
      curYear = career.year
      if (career.year >= targetYear) break
      season = beginSeason(ctx, curYear)
    }

    const dash = guarded(ctx, 'getDashboard', () => ctx.career.getDashboard())
    if (!dash) { issue(ctx, 'critical', 'softlock', 'getDashboard() failed — cannot read state'); trace.summary.endedEarly = true; trace.summary.endReason = 'dashboard unreadable'; break }

    if (career.draftPending()) {
      doDraft(ctx)
      // Safety net: if the GM-style draft couldn't complete it, force it via
      // autoDraft so the campaign never spins. If even that leaves it pending,
      // it's a genuine engine softlock — record it and abandon the run.
      if (career.draftPending()) {
        guarded(ctx, 'autoDraft', () => ctx.career.autoDraft())
        if (career.draftPending()) {
          issue(ctx, 'critical', 'softlock', 'draft will not complete even via autoDraft() — hard dead-lock on draft day', `season ${career.year}`)
          trace.summary.endedEarly = true; trace.summary.endReason = `draft dead-lock ${career.year}`
          break
        }
        log(ctx, { kind: 'draft', summary: 'Auto-completed the rest of the draft', drivers: ['manual picks were not registering — fell back to auto to keep the campaign moving'], result: 'auto', ok: true })
      }
      continue
    }
    if (dash.captainsPending) { doCaptain(ctx); continue }

    const phase: CareerPhase = career.seasonPhase
    if (phase === 'regularSeason') {
      getPlan(ctx) // set + log the season's contend/retool/rebuild plan (once per year)
      if (dash.day >= 30) snapshotViews(ctx) // one mid-season capture of what the screens serve
      clearMeetings(ctx, dash)
      clearInteractions(ctx)
      maintainRoster(ctx)
      if (dash.deadlinePending) doDeadline(ctx)
      else if (dash.day % 14 === 0) { reviewIncoming(ctx); tryTradeUpgrade(ctx, false) }
    } else if (phase === 'offseason') {
      const stage = guarded(ctx, 'getOffseason', () => ctx.career.getOffseason())?.stage
      if (stage === 'resign') doResign(ctx)
      else if (stage === 'freeAgency') doFreeAgency(ctx)
      // No roster recalls in the offseason — the roster is legitimately in flux.
    }

    const beforeKey = `${career.year}|${phase}|${dash.day}|${phaseLabel(ctx)}`
    let advanced = false
    try { advanced = ctx.career.step() }
    catch (e) {
      // Capture WHERE, not just what: a bare message ("reading 'id'") is what let
      // a season-ending crash survive an earlier autopilot session undiagnosed.
      issue(ctx, 'critical', 'throw', `step() threw: ${(e as Error).message}${firstFrames(e)}`, `at ${beforeKey}`)
      maintainRoster(ctx)
      try { advanced = ctx.career.step() }
      catch (e2) { issue(ctx, 'critical', 'softlock', `step() threw again after recovery: ${(e2 as Error).message}${firstFrames(e2)} — season abandoned`, `at ${beforeKey}`); trace.summary.endedEarly = true; trace.summary.endReason = `step threw: ${(e2 as Error).message}${firstFrames(e2)}`; break }
    }

    if (hardGuard % 25 === 0) runSanity(ctx)

    const afterKey = `${career.year}|${career.seasonPhase}|${safeDay(ctx)}|${phaseLabel(ctx)}`
    if (!advanced && afterKey === beforeKey) {
      if (afterKey === stallKey) stalls++; else { stallKey = afterKey; stalls = 1 }
      if (stalls >= 8) { issue(ctx, 'critical', 'softlock', `stuck: step() will not advance past ${afterKey} (Continue would be dead)`, 'progress guard tripped'); trace.summary.endedEarly = true; trace.summary.endReason = `stalled at ${afterKey}`; break }
    } else { stalls = 0; stallKey = afterKey }
  }

  if (hardGuard >= HARD_LIMIT) { issue(ctx, 'critical', 'softlock', 'hit the hard iteration limit — likely an infinite loop'); trace.summary.endedEarly = true; trace.summary.endReason = 'hard limit' }

  if (season && !recorded.has(season.year)) recordSeasonEnd(ctx, season)
  runSanity(ctx)

  trace.meta.seasonsPlayed = trace.seasons.length
  trace.summary.cups = trace.seasons.filter((s) => s.wonCup).length
  trace.summary.totalTrades = trace.seasons.reduce((n, s) => n + s.trades, 0)
  trace.summary.totalSignings = trace.seasons.reduce((n, s) => n + s.signings, 0)
  trace.summary.totalDrafted = trace.seasons.reduce((n, s) => n + s.drafted, 0)
  trace.summary.critical = trace.issues.filter((i) => i.severity === 'critical').length
  trace.summary.major = trace.issues.filter((i) => i.severity === 'major').length
  trace.summary.minor = trace.issues.filter((i) => i.severity === 'minor').length
  trace.summary.bestFinish = bestOf(trace.seasons.map((s) => s.playoffResult))
  return trace
}

function beginSeason(ctx: Ctx, year: number): SeasonRecord {
  const s: SeasonRecord = { year, madePlayoffs: false, playoffResult: '—', wonCup: false, decisions: 0, trades: 0, signings: 0, drafted: 0, critical: 0, major: 0, minor: 0 }
  ctx.trace.seasons.push(s)
  return s
}

function bestOf(results: string[]): string {
  const order = ['Missed', '—', 'Playoffs', 'Round 1', 'Round 2', 'Conf. Final', 'Cup Final', 'Champion']
  let best = '—'; let bi = 0
  for (const r of results) { const i = order.indexOf(r); if (i > bi) { bi = i; best = r } }
  return best
}
