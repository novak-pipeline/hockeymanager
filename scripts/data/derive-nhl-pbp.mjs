#!/usr/bin/env node
/**
 * Derive MATCH-SHAPE aggregates from a LOCAL cache of NHL play-by-play JSON.
 *
 *   node scripts/data/derive-nhl-pbp.mjs [cacheDir]
 *     cacheDir  default: $NHL_CACHE_DIR, else ./.cache/nhl (git-ignored)
 *
 * NO NETWORK ACCESS. This script never fetches. It reads files that the
 * existing calibration importer (src/calibrate/importNhl.ts) cached earlier and
 * writes AGGREGATES ONLY to src/calibrate/nhlPbpAggregates.json.
 *
 * Why no fetcher: the NHL.com Terms of Service (§2 "unauthorized spidering,
 * scraping … or other unauthorized automated means to compile information";
 * §7 "non-commercial, informational, personal use") cover the NHL's public
 * API and NHL EDGE. The M0 brief says to stop automated use of any endpoint
 * whose terms forbid it, so the scorecard work does NOT expand the pull. The
 * 64-game 2023-24 sample that already exists locally (fetched by the earlier
 * importer) is re-read here; its use is flagged for owner/legal review in
 * docs/MATCH-DATA-SOURCES.md. Nothing raw is committed.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? process.env.NHL_CACHE_DIR ?? join('.cache', 'nhl')
const OUT = join('src', 'calibrate', 'nhlPbpAggregates.json')
if (!existsSync(dir)) {
  console.error(`No cache at ${dir}. Nothing to derive (this script never downloads).`)
  process.exit(1)
}

const HALF_L = 100
const HALF_W = 42.5
const CORNER_R = 28
function boardDist(x, y) {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const cx = HALF_L - CORNER_R
  const cy = HALF_W - CORNER_R
  if (ax > cx && ay > cy) return Math.max(0, CORNER_R - Math.hypot(ax - cx, ay - cy))
  return Math.max(0, Math.min(HALF_L - ax, HALF_W - ay))
}
const secs = (t) => {
  const [m, s] = String(t ?? '0:0').split(':')
  return Number(m) * 60 + Number(s)
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

const acc = {
  games: 0,
  hits: 0,
  hitsBoards10: 0,
  hitBoardDistHist: new Array(9).fill(0), // 5-ft bins 0..45
  hitsByPos: { F: 0, D: 0 },
  hitZone: { O: 0, N: 0, D: 0 },
  penalties: 0,
  penaltyTypes: {},
  fights: 0,
  shotTypes: {},
  missedReasons: {},
  unblocked: 0,
  missed: 0,
  faceoffs: 0,
  foFollow10: 0,
  eventGapHist: new Array(31).fill(0), // seconds 0..30+ between consecutive located events
  blockedShots: 0,
  sog: 0,
  goals: 0
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
for (const f of files) {
  let d
  try {
    d = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  } catch {
    continue
  }
  if (!Array.isArray(d.plays)) continue
  acc.games++
  const pos = new Map()
  for (const r of d.rosterSpots ?? []) pos.set(r.playerId, r.positionCode)
  const plays = [...d.plays].sort(
    (a, b) => (a.periodDescriptor?.number ?? 0) - (b.periodDescriptor?.number ?? 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  )
  let pendingFo = null
  let prevAbs = null
  for (const p of plays) {
    const per = p.periodDescriptor?.number ?? 0
    const absT = (per - 1) * 1200 + secs(p.timeInPeriod)
    const t = p.typeDescKey
    const dd = p.details ?? {}
    if (per <= 3 && isNum(dd.xCoord)) {
      if (prevAbs !== null && absT >= prevAbs) acc.eventGapHist[Math.min(30, absT - prevAbs)]++
      prevAbs = absT
    }
    if (t === 'stoppage' || t === 'period-end') prevAbs = null
    switch (t) {
      case 'hit': {
        acc.hits++
        if (isNum(dd.xCoord) && isNum(dd.yCoord)) {
          const bd = boardDist(dd.xCoord, dd.yCoord)
          if (bd <= 10) acc.hitsBoards10++
          acc.hitBoardDistHist[Math.min(8, Math.floor(bd / 5))]++
        }
        const pc = pos.get(dd.hittingPlayerId)
        if (pc === 'D') acc.hitsByPos.D++
        else if (pc) acc.hitsByPos.F++
        if (dd.zoneCode) acc.hitZone[dd.zoneCode] = (acc.hitZone[dd.zoneCode] ?? 0) + 1
        break
      }
      case 'penalty': {
        acc.penalties++
        const k = dd.descKey ?? 'unknown'
        acc.penaltyTypes[k] = (acc.penaltyTypes[k] ?? 0) + 1
        if (k === 'fighting') acc.fights += 0.5 // two majors per fight
        break
      }
      case 'shot-on-goal':
      case 'goal':
      case 'missed-shot': {
        acc.unblocked++
        if (t === 'missed-shot') {
          acc.missed++
          const r = dd.reason ?? 'unknown'
          acc.missedReasons[r] = (acc.missedReasons[r] ?? 0) + 1
        } else if (t === 'goal') acc.goals++
        else acc.sog++
        if (dd.shotType) acc.shotTypes[dd.shotType] = (acc.shotTypes[dd.shotType] ?? 0) + 1
        if (pendingFo && dd.eventOwnerTeamId === pendingFo.team && absT - pendingFo.t <= 10) {
          acc.foFollow10++
          pendingFo = null
        }
        break
      }
      case 'blocked-shot':
        acc.blockedShots++
        break
      case 'faceoff':
        acc.faceoffs++
        pendingFo = { team: dd.eventOwnerTeamId, t: absT }
        break
      default:
        break
    }
    // NHL API: blocked-shot owner is the BLOCKING team; follow-up counts the
    // shooting team's attempt, which for a block is the other team — skip it.
  }
}

const share = (o) => {
  const tot = Object.values(o).reduce((s, v) => s + v, 0) || 1
  return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / tot).toFixed(4)]))
}
const teamGames = acc.games * 2
const out = {
  meta: {
    source: 'NHL API (api-web.nhle.com) play-by-play — local cache re-read, no new fetch',
    season: '2023-2024 regular season (evenly spaced sample)',
    games: acc.games,
    generated: new Date().toISOString(),
    note: 'Aggregates only. See docs/MATCH-DATA-SOURCES.md for the Terms-of-Service flag on this source.'
  },
  hits: {
    perTeamGame: +(acc.hits / teamGames).toFixed(3),
    boardsShare10ft: +(acc.hitsBoards10 / Math.max(1, acc.hits)).toFixed(4),
    boardDistShare5ftBins: acc.hitBoardDistHist.map((v) => +(v / Math.max(1, acc.hits)).toFixed(4)),
    byDShare: +(acc.hitsByPos.D / Math.max(1, acc.hitsByPos.D + acc.hitsByPos.F)).toFixed(4),
    zoneShareHitterPerspective: share(acc.hitZone)
  },
  penalties: {
    perTeamGame: +(acc.penalties / teamGames).toFixed(3),
    distinctTypes: Object.keys(acc.penaltyTypes).length,
    typeShare: share(acc.penaltyTypes),
    fightsPerGame: +(acc.fights / acc.games).toFixed(3)
  },
  shots: {
    missedPerTeamGame: +(acc.missed / teamGames).toFixed(3),
    missedShareOfUnblocked: +(acc.missed / Math.max(1, acc.unblocked)).toFixed(4),
    typeShare: share(acc.shotTypes),
    missedReasonShare: share(acc.missedReasons)
  },
  faceoffs: {
    perGame: +(acc.faceoffs / acc.games).toFixed(2),
    winnerAttemptWithin10s: +(acc.foFollow10 / Math.max(1, acc.faceoffs)).toFixed(4)
  },
  flow: {
    locatedEventGapShare1s: (() => {
      const tot = acc.eventGapHist.reduce((s, v) => s + v, 0) || 1
      return acc.eventGapHist.map((v) => +(v / tot).toFixed(4))
    })()
  }
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`Derived from ${acc.games} games → ${OUT}`)
console.log(JSON.stringify({ hits: out.hits, penalties: { ...out.penalties, typeShare: undefined }, faceoffs: out.faceoffs, shots: { ...out.shots, typeShare: out.shots.typeShare } }, null, 1))
