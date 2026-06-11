/**
 * NHL play-by-play → calibration targets (dev tool, run manually).
 *
 *   node --experimental-strip-types src/calibrate/importNhl.ts [games] [season]
 *     games   sample size (default 60), spread evenly across the season
 *     season  4-digit start year (default 2023 → 2023-24 regular season)
 *
 * Pulls a sample of regular-season games from the FREE official NHL API,
 * caches raw JSON under `.cache/nhl/` (gitignored — raw data is NOT committed),
 * then derives and writes `src/calibrate/targets.json`: an empirical xG surface
 * (binned by distance/angle to net) plus per-team-per-game rates for every
 * event type the engine models (shots, hits, takeaways, giveaways, blocks,
 * faceoffs, penalties, goals).
 *
 * MoneyPuck must NOT be scraped (their license forbids it). The NHL API carries
 * shot locations + outcomes, which is all we need to derive xG ourselves.
 *
 * SEQUENCE TARGETS — stoppage classification (details.reason field values):
 *   offside:               "offside"
 *   icing:                 "icing"
 *   goalie freeze:         "goalie-stopped-after-sog", "puck-frozen", "skater-puck-frozen"
 *   other:                 "puck-in-netting", "puck-in-crowd", "puck-in-benches",
 *                          "high-stick", "referee-or-linesman", "tv-timeout", etc.
 * Faceoff zone from details.zoneCode: "O" (offensive), "N" (neutral), "D" (defensive)
 * Attacking direction: homeTeamDefendingSide="left" → home attacks right (+x), away attacks left (-x).
 *                      Swaps each period (standard NHL rules, confirmed via shot-coord clustering).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CalibrationTargets, XgSurface, EventRates, SequenceTargets } from './index'

const NET_X = 89 // |xCoord| of the goal line crossing, in feet
const CACHE_DIR = join('.cache', 'nhl')
const OUT_FILE = join('src', 'calibrate', 'targets.json')

// xG surface bins. Distance dominates danger, angle second-order; finer near net.
const DISTANCE_EDGES = [0, 8, 15, 22, 30, 40, 55, 75, 100, 200]
const ANGLE_EDGES = [0, 15, 30, 45, 60, 90, 180]

interface ShotEvent {
  x: number
  y: number
  goal: boolean
}

interface Counts {
  shotsOnGoal: number
  missedShots: number
  blockedShots: number
  goals: number
  hits: number
  takeaways: number
  giveaways: number
  faceoffs: number
  penalties: number
}

const EMPTY_COUNTS = (): Counts => ({
  shotsOnGoal: 0,
  missedShots: 0,
  blockedShots: 0,
  goals: 0,
  hits: 0,
  takeaways: 0,
  giveaways: 0,
  faceoffs: 0,
  penalties: 0
})

/** Build the list of gameIds: season + type 02 (regular) + 4-digit number. */
function gameIds(season: number, sample: number): string[] {
  const total = 1312 // 32 teams × 82 / 2 ≈ regular-season game count since 2021
  const ids: string[] = []
  const step = Math.max(1, Math.floor(total / sample))
  for (let n = 1; n <= total && ids.length < sample; n += step) {
    ids.push(`${season}02${String(n).padStart(4, '0')}`)
  }
  return ids
}

async function fetchPlayByPlay(gameId: string): Promise<any | null> {
  const cachePath = join(CACHE_DIR, `${gameId}.json`)
  if (existsSync(cachePath)) {
    return JSON.parse(await readFile(cachePath, 'utf8'))
  }
  const url = `https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`  ${gameId}: HTTP ${res.status}, skipping`)
      return null
    }
    const json = await res.json()
    await writeFile(cachePath, JSON.stringify(json), 'utf8')
    return json
  } catch (e) {
    console.warn(`  ${gameId}: fetch failed (${(e as Error).message}), skipping`)
    return null
  }
}

/** Distance (ft) and angle (deg, 0 = straight on) of a shot to the near net. */
function geometry(x: number, y: number): { dist: number; angle: number } {
  const dx = NET_X - Math.abs(x) // along-ice distance to goal line (neg = behind net)
  const dist = Math.hypot(dx, y)
  const angle = (Math.atan2(Math.abs(y), Math.max(dx, 0.0001)) * 180) / Math.PI
  return { dist, angle }
}

function binIndex(edges: number[], value: number): number {
  for (let i = 0; i < edges.length - 1; i++) if (value < edges[i + 1]) return i
  return edges.length - 2
}

// ---------------------------------------------------------------------------
// Sequence target extraction
// ---------------------------------------------------------------------------

/** Parse "MM:SS" → total seconds. */
function parseTime(t: string): number {
  const parts = t.split(':')
  return Number(parts[0]) * 60 + Number(parts[1])
}

/**
 * For a given play, determine the attacking team's side of the ice.
 * homeTeamDefendingSide="left" → home defends left (negative x) → home attacks right (positive x).
 * Away always attacks the opposite side from home.
 * The defending side flips each period (OT period also flips from period 3).
 *
 * The homeTeamDefendingSide field is present on every play in the dataset and
 * correctly encodes which side the home team defends for that event, so we
 * read it directly from the play rather than inferring from period number.
 */
function attackingSign(homeTeamDefendingSide: string, teamId: number, homeTeamId: number): number {
  // home defends left → home attacks right (+x direction)
  const homeAttacksRight = homeTeamDefendingSide === 'left'
  const isHome = teamId === homeTeamId
  if (isHome) return homeAttacksRight ? 1 : -1
  return homeAttacksRight ? -1 : 1
}

/**
 * Return the zone ("OZ", "NZ", "DZ") for an event from the attacker's perspective.
 * OZ: |x| > 25 and x-sign matches attackingSign (attacker is in their offensive zone)
 * DZ: |x| > 25 and x-sign opposes attackingSign
 * NZ: |x| <= 25
 * We use a 25-ft threshold from centre ice (the actual blue-line is at |x|=25).
 */
function zoneForTeam(xCoord: number, attackSign: number): 'OZ' | 'NZ' | 'DZ' {
  if (Math.abs(xCoord) <= 25) return 'NZ'
  return Math.sign(xCoord) === attackSign ? 'OZ' : 'DZ'
}

interface SequenceAccum {
  // stoppages
  stoppageOffside: number
  stoppageIcing: number
  stoppageGoalieFreeze: number
  stoppageOther: number
  // zone time (weighted seconds)
  ozSeconds: number
  nzSeconds: number
  dzSeconds: number
  // zone-entry tracking
  totalEntries: number      // OZ entries (first OZ event after being outside OZ)
  totalMinutes: number      // regulation 60-min equivalent denominator (per team)
  shotsInEntry: number      // unblocked attempts during an OZ possession
  entryCount: number        // entries that had at least one event (denominator for shotsPerEntry)
  rushShots: number         // shots within 6s of zone entry
  reboundShots: number      // shots within 3s of previous shot-on-goal/save
  totalShots: number        // unblocked attempts (SOG + missed + goal)
  // faceoff zone mix (home-team perspective collapsed to thirds)
  faceoffOZ: number
  faceoffNZ: number
  faceoffDZ: number
  // stoppage/faceoff gap accumulator
  stoppageGapSum: number
  stoppageGapCount: number
}

interface GameData {
  homeTeamId: number
  awayTeamId: number
  plays: any[]
}

export function buildSequenceTargets(games: GameData[]): SequenceTargets {
  const acc: SequenceAccum = {
    stoppageOffside: 0,
    stoppageIcing: 0,
    stoppageGoalieFreeze: 0,
    stoppageOther: 0,
    ozSeconds: 0,
    nzSeconds: 0,
    dzSeconds: 0,
    totalEntries: 0,
    totalMinutes: 0,
    shotsInEntry: 0,
    entryCount: 0,
    rushShots: 0,
    reboundShots: 0,
    totalShots: 0,
    faceoffOZ: 0,
    faceoffNZ: 0,
    faceoffDZ: 0,
    stoppageGapSum: 0,
    stoppageGapCount: 0,
  }

  for (const game of games) {
    processGameSequences(game, acc)
  }

  const gamesN = games.length
  const stoppageTotal = acc.stoppageOffside + acc.stoppageIcing + acc.stoppageGoalieFreeze + acc.stoppageOther
  const zoneTotal = acc.ozSeconds + acc.nzSeconds + acc.dzSeconds || 1

  // faceoffZoneMix from home-team perspective:
  // zoneCode "O" means offensive for the winner. For home-team perspective we
  // use xCoord sign relative to homeAttacksRight (which varies by period).
  // We already accumulated from the home team's perspective directly.
  const foTotal = acc.faceoffOZ + acc.faceoffNZ + acc.faceoffDZ || 1

  return {
    stoppagesPerGame: {
      offside: acc.stoppageOffside / gamesN,
      icing: acc.stoppageIcing / gamesN,
      goalieFreeze: acc.stoppageGoalieFreeze / gamesN,
      other: acc.stoppageOther / gamesN,
    },
    zoneTimeShare: {
      offensive: acc.ozSeconds / zoneTotal,
      neutral: acc.nzSeconds / zoneTotal,
      defensive: acc.dzSeconds / zoneTotal,
    },
    entriesPerTeamPer60: acc.totalMinutes > 0
      ? (acc.totalEntries / acc.totalMinutes) * 60
      : 0,
    shotsPerEntry: acc.entryCount > 0 ? acc.shotsInEntry / acc.entryCount : 0,
    rushShotShare: acc.totalShots > 0 ? acc.rushShots / acc.totalShots : 0,
    reboundShotShare: acc.totalShots > 0 ? acc.reboundShots / acc.totalShots : 0,
    meanSecondsBetweenStoppages: acc.stoppageGapCount > 0
      ? acc.stoppageGapSum / acc.stoppageGapCount
      : 0,
    faceoffZoneMix: {
      offensive: acc.faceoffOZ / foTotal,
      neutral: acc.faceoffNZ / foTotal,
      defensive: acc.faceoffDZ / foTotal,
    },
  }
}

function processGameSequences(game: GameData, acc: SequenceAccum): void {
  const { homeTeamId, awayTeamId, plays } = game

  // Sort plays by period then sortOrder to ensure chronological order
  const sorted = [...plays].sort((a, b) => {
    const pa = a.periodDescriptor?.number ?? 0
    const pb = b.periodDescriptor?.number ?? 0
    if (pa !== pb) return pa - pb
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  })

  // We track zone-entry state per team.
  // State: "outside" | "inside" (inside the OZ)
  const teamState: Record<number, 'outside' | 'inside'> = {
    [homeTeamId]: 'outside',
    [awayTeamId]: 'outside',
  }
  const entryTime: Record<number, number> = { [homeTeamId]: 0, [awayTeamId]: 0 }
  // shots accumulator during current OZ possession per team
  const ozShots: Record<number, number> = { [homeTeamId]: 0, [awayTeamId]: 0 }
  const ozFirstTime: Record<number, number> = { [homeTeamId]: 0, [awayTeamId]: 0 }

  // Last shot time per team (for rebound detection)
  const lastShotTime: Record<number, number> = { [homeTeamId]: -999, [awayTeamId]: -999 }

  // Zone-time tracking: previous event time/zone per team
  let prevTimeSec = 0
  let prevPeriod = 0

  // Last stoppage/faceoff clock (for gap between stoppages)
  let lastStoppageSec: number | null = null
  let lastStoppagePeriod = 0

  // Regulation time: count minutes played (3 regulation periods = 60 min per team)
  // We'll accumulate per-game: each game contributes 60 min per team (both teams combined = 120 team-min)
  // But for "per team per 60", we want entries / team / 60 min.
  // Count only regulation plays (period <= 3).

  // Zone time accumulation: we aggregate across both teams' views combined,
  // normalised to give a single zone-share figure (offensive-team perspective).
  // For each located event, we compute the attacking team's zone and add the elapsed time.

  let prevEventSec = -1
  let prevEventPeriod = -1

  for (const play of sorted) {
    const period: number = play.periodDescriptor?.number ?? 0
    if (period > 3) continue // skip OT for sequence targets (OT is different hockey)

    const t = play.typeDescKey as string
    const d = play.details ?? {}
    const timeSec = parseTime(play.timeInPeriod ?? '00:00')
    // Absolute game-clock seconds (period * 1200 + timeSec)
    const absSec = (period - 1) * 1200 + timeSec

    // --- Zone time share ---
    // For events with xCoord and eventOwnerTeamId, attribute elapsed time to zone
    if (isNum(d.xCoord) && isNum(d.eventOwnerTeamId) && play.homeTeamDefendingSide) {
      const ownerTeamId = d.eventOwnerTeamId as number
      const atkSign = attackingSign(play.homeTeamDefendingSide, ownerTeamId, homeTeamId)
      const zone = zoneForTeam(d.xCoord, atkSign)

      if (prevEventPeriod === period && prevEventSec >= 0) {
        const gap = absSec - prevEventSec
        const capped = Math.min(gap, 40) // cap at 40s to ignore stoppages/intermissions
        if (capped > 0) {
          if (zone === 'OZ') acc.ozSeconds += capped
          else if (zone === 'NZ') acc.nzSeconds += capped
          else acc.dzSeconds += capped
        }
      }
      prevEventSec = absSec
      prevEventPeriod = period
    }

    // --- Stoppage classification ---
    if (t === 'stoppage') {
      const reason = (d.reason as string | undefined) ?? ''
      if (reason === 'offside') {
        acc.stoppageOffside++
      } else if (reason === 'icing') {
        acc.stoppageIcing++
      } else if (reason === 'goalie-stopped-after-sog' || reason === 'puck-frozen' || reason === 'skater-puck-frozen') {
        acc.stoppageGoalieFreeze++
      } else {
        acc.stoppageOther++
      }
      // Stoppage gap
      if (lastStoppageSec !== null && lastStoppagePeriod === period) {
        const gap = absSec - lastStoppageSec
        if (gap > 0 && gap < 1200) {
          acc.stoppageGapSum += gap
          acc.stoppageGapCount++
        }
      }
      lastStoppageSec = absSec
      lastStoppagePeriod = period
      // Reset zone entry state for both teams on any stoppage
      teamState[homeTeamId] = 'outside'
      teamState[awayTeamId] = 'outside'
    }

    // --- Faceoff zone mix (home-team perspective) ---
    if (t === 'faceoff') {
      // Stoppage gap (faceoffs also count as stoppages from a rhythm perspective)
      if (lastStoppageSec !== null && lastStoppagePeriod === period) {
        const gap = absSec - lastStoppageSec
        if (gap > 0 && gap < 1200) {
          acc.stoppageGapSum += gap
          acc.stoppageGapCount++
        }
      }
      lastStoppageSec = absSec
      lastStoppagePeriod = period

      // Zone from home's perspective
      if (isNum(d.xCoord) && play.homeTeamDefendingSide) {
        const homeAtkSign = attackingSign(play.homeTeamDefendingSide, homeTeamId, homeTeamId)
        const zone = zoneForTeam(d.xCoord, homeAtkSign)
        if (zone === 'OZ') acc.faceoffOZ++
        else if (zone === 'NZ') acc.faceoffNZ++
        else acc.faceoffDZ++
      } else if (d.zoneCode) {
        // fallback: zoneCode relative to eventOwnerTeamId winner
        // If winner is home, "O" = home OZ; if winner is away, "O" = away OZ (home DZ)
        const winnerIsHome = d.eventOwnerTeamId === homeTeamId
        const zc = d.zoneCode as string
        if (zc === 'N') acc.faceoffNZ++
        else if ((zc === 'O' && winnerIsHome) || (zc === 'D' && !winnerIsHome)) acc.faceoffOZ++
        else acc.faceoffDZ++
      }
      // Reset zone entry state on faceoff
      teamState[homeTeamId] = 'outside'
      teamState[awayTeamId] = 'outside'
    }

    // --- Zone entry proxy + shot accumulation ---
    if (isNum(d.xCoord) && isNum(d.eventOwnerTeamId) && play.homeTeamDefendingSide) {
      const ownerTeamId = d.eventOwnerTeamId as number
      if (ownerTeamId === homeTeamId || ownerTeamId === awayTeamId) {
        const atkSign = attackingSign(play.homeTeamDefendingSide, ownerTeamId, homeTeamId)
        const zone = zoneForTeam(d.xCoord, atkSign)
        const isUnblockedAttempt = t === 'shot-on-goal' || t === 'goal' || t === 'missed-shot'

        if (zone === 'OZ') {
          if (teamState[ownerTeamId] === 'outside') {
            // New zone entry
            acc.totalEntries++
            teamState[ownerTeamId] = 'inside'
            ozShots[ownerTeamId] = 0
            ozFirstTime[ownerTeamId] = absSec
            entryTime[ownerTeamId] = absSec
            acc.entryCount++
          }
          if (isUnblockedAttempt) {
            ozShots[ownerTeamId]++
            acc.shotsInEntry++
            acc.totalShots++

            // Rush shot: unblocked attempt within 6s of zone entry
            if (absSec - entryTime[ownerTeamId] <= 6) {
              acc.rushShots++
            }

            // Rebound shot: unblocked attempt within 3s of a previous shot-on-goal/save by same team
            if (absSec - lastShotTime[ownerTeamId] <= 3) {
              acc.reboundShots++
            }

            if (t === 'shot-on-goal') {
              lastShotTime[ownerTeamId] = absSec
            }
          }
        } else {
          // Left the OZ
          if (teamState[ownerTeamId] === 'inside') {
            teamState[ownerTeamId] = 'outside'
          }
        }
      }
    }
  }

  // Add regulation minutes for this game (both teams get 60 min each)
  acc.totalMinutes += 60 * 2
}

async function main(): Promise<void> {
  const sample = Number(process.argv[2] ?? 60)
  const season = Number(process.argv[3] ?? 2023)
  await mkdir(CACHE_DIR, { recursive: true })

  const ids = gameIds(season, sample)
  console.log(`Importing ${ids.length} games from ${season}-${season + 1} regular season...`)

  const totals = EMPTY_COUNTS()
  const shots: ShotEvent[] = []
  const gameDataList: { homeTeamId: number; awayTeamId: number; plays: any[] }[] = []
  let gamesUsed = 0

  for (const id of ids) {
    const pbp = await fetchPlayByPlay(id)
    if (!pbp?.plays) continue
    gamesUsed++
    gameDataList.push({
      homeTeamId: pbp.homeTeam?.id ?? 0,
      awayTeamId: pbp.awayTeam?.id ?? 0,
      plays: pbp.plays,
    })
    for (const play of pbp.plays) {
      const t = play.typeDescKey as string
      const d = play.details ?? {}
      switch (t) {
        case 'faceoff':
          totals.faceoffs++
          break
        case 'hit':
          totals.hits++
          break
        case 'takeaway':
          totals.takeaways++
          break
        case 'giveaway':
          totals.giveaways++
          break
        case 'penalty':
          totals.penalties++
          break
        case 'blocked-shot':
          totals.blockedShots++
          break
        case 'missed-shot':
          totals.missedShots++
          if (isNum(d.xCoord) && isNum(d.yCoord)) shots.push({ x: d.xCoord, y: d.yCoord, goal: false })
          break
        case 'shot-on-goal':
          totals.shotsOnGoal++
          if (isNum(d.xCoord) && isNum(d.yCoord)) shots.push({ x: d.xCoord, y: d.yCoord, goal: false })
          break
        case 'goal':
          totals.goals++
          if (isNum(d.xCoord) && isNum(d.yCoord)) shots.push({ x: d.xCoord, y: d.yCoord, goal: true })
          break
        default:
          break
      }
    }
    if (gamesUsed % 10 === 0) console.log(`  ...${gamesUsed} games`)
  }

  if (gamesUsed === 0) {
    console.error('No games fetched — aborting (no network / API changed?).')
    process.exit(1)
  }

  const sequences = buildSequenceTargets(gameDataList)
  const targets = buildTargets(totals, shots, gamesUsed, season, sequences)
  await writeFile(OUT_FILE, JSON.stringify(targets, null, 2) + '\n', 'utf8')
  console.log(`\nWrote ${OUT_FILE} from ${gamesUsed} games, ${shots.length} located shots.`)
  console.log(
    `  SOG/team/gm ${targets.perTeamPerGame.shotsOnGoal.toFixed(1)}` +
      `  goals/team/gm ${targets.perTeamPerGame.goals.toFixed(2)}` +
      `  sh% ${(targets.shooting.shootingPct * 100).toFixed(1)}`
  )
  const sq = sequences
  console.log('\nSequence targets:')
  console.log(`  stoppages/game: offside=${sq.stoppagesPerGame.offside.toFixed(2)} icing=${sq.stoppagesPerGame.icing.toFixed(2)} goalieFreeze=${sq.stoppagesPerGame.goalieFreeze.toFixed(2)} other=${sq.stoppagesPerGame.other.toFixed(2)}`)
  console.log(`  zone share: OZ=${sq.zoneTimeShare.offensive.toFixed(3)} NZ=${sq.zoneTimeShare.neutral.toFixed(3)} DZ=${sq.zoneTimeShare.defensive.toFixed(3)}`)
  console.log(`  entries/team/60: ${sq.entriesPerTeamPer60.toFixed(1)}  shots/entry: ${sq.shotsPerEntry.toFixed(2)}`)
  console.log(`  rushShotShare: ${sq.rushShotShare.toFixed(3)}  reboundShotShare: ${sq.reboundShotShare.toFixed(3)}`)
  console.log(`  meanSecsBetweenStoppages: ${sq.meanSecondsBetweenStoppages.toFixed(1)}`)
  console.log(`  faceoffZoneMix: OZ=${sq.faceoffZoneMix.offensive.toFixed(3)} NZ=${sq.faceoffZoneMix.neutral.toFixed(3)} DZ=${sq.faceoffZoneMix.defensive.toFixed(3)}`)
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function buildTargets(
  totals: Counts,
  shots: ShotEvent[],
  games: number,
  season: number,
  sequences: SequenceTargets
): CalibrationTargets {
  const perTeam = (n: number): number => n / (games * 2)
  const perTeamPerGame: EventRates = {
    shotsOnGoal: perTeam(totals.shotsOnGoal + totals.goals), // goals are also shots on net
    missedShots: perTeam(totals.missedShots),
    blockedShots: perTeam(totals.blockedShots),
    goals: perTeam(totals.goals),
    hits: perTeam(totals.hits),
    takeaways: perTeam(totals.takeaways),
    giveaways: perTeam(totals.giveaways),
    faceoffs: perTeam(totals.faceoffs),
    penalties: perTeam(totals.penalties)
  }

  const sog = totals.shotsOnGoal + totals.goals
  const shootingPct = sog > 0 ? totals.goals / sog : 0

  // xG surface over UNBLOCKED attempts (SOG + missed + goal), goals as outcome.
  const rows = DISTANCE_EDGES.length - 1
  const cols = ANGLE_EDGES.length - 1
  const attemptGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))
  const goalGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (const s of shots) {
    const { dist, angle } = geometry(s.x, s.y)
    const di = binIndex(DISTANCE_EDGES, dist)
    const ai = binIndex(ANGLE_EDGES, angle)
    attemptGrid[di][ai]++
    if (s.goal) goalGrid[di][ai]++
  }
  const xg: number[][] = attemptGrid.map((row, di) =>
    row.map((att, ai) => (att > 0 ? goalGrid[di][ai] / att : 0))
  )

  const totalGoals = shots.filter((s) => s.goal).length
  const fenwickShootingPct = shots.length > 0 ? totalGoals / shots.length : 0

  const surface: XgSurface = {
    distanceEdges: DISTANCE_EDGES,
    angleEdges: ANGLE_EDGES,
    xg,
    attempts: attemptGrid
  }

  return {
    meta: {
      source: 'NHL API (api-web.nhle.com) play-by-play',
      season: `${season}-${season + 1}`,
      games,
      generated: new Date().toISOString(),
      note: 'Derived aggregates only; raw play-by-play is not committed.'
    },
    shooting: {
      shootingPct,
      savePct: 1 - shootingPct,
      fenwickShootingPct
    },
    perTeamPerGame,
    xgSurface: surface,
    sequences,
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
