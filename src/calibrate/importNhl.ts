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
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CalibrationTargets, XgSurface, EventRates } from './index'

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

async function main(): Promise<void> {
  const sample = Number(process.argv[2] ?? 60)
  const season = Number(process.argv[3] ?? 2023)
  await mkdir(CACHE_DIR, { recursive: true })

  const ids = gameIds(season, sample)
  console.log(`Importing ${ids.length} games from ${season}-${season + 1} regular season...`)

  const totals = EMPTY_COUNTS()
  const shots: ShotEvent[] = []
  let gamesUsed = 0

  for (const id of ids) {
    const pbp = await fetchPlayByPlay(id)
    if (!pbp?.plays) continue
    gamesUsed++
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

  const targets = buildTargets(totals, shots, gamesUsed, season)
  await writeFile(OUT_FILE, JSON.stringify(targets, null, 2) + '\n', 'utf8')
  console.log(`\nWrote ${OUT_FILE} from ${gamesUsed} games, ${shots.length} located shots.`)
  console.log(
    `  SOG/team/gm ${targets.perTeamPerGame.shotsOnGoal.toFixed(1)}` +
      `  goals/team/gm ${targets.perTeamPerGame.goals.toFixed(2)}` +
      `  sh% ${(targets.shooting.shootingPct * 100).toFixed(1)}`
  )
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function buildTargets(
  totals: Counts,
  shots: ShotEvent[],
  games: number,
  season: number
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
    xgSurface: surface
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
