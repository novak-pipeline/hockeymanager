/**
 * Save-game serialization. Converts the in-memory LeagueData (which uses Maps)
 * to/from the JSON-safe SerializedLeagueData shape embedded in CareerSnapshot,
 * and structurally validates snapshots loaded from disk before the Career
 * trusts them.
 *
 * Everything produced here must survive structured clone AND JSON.stringify:
 * Maps become entry arrays, values pass through as the plain objects they
 * already are (domain shapes contain no class instances or functions).
 */
import { asPlayerId, asTeamId, type League, type Player, type PlayerId, type Team, type TeamId } from '@domain'
import type { LeagueData } from '@data'
import type { CareerPhase, CareerSnapshot, SerializedLeagueData } from './views'

/* ────────────────────────── map helpers ────────────────────────── */

/** Flatten a string-keyed Map to a JSON-safe entry array. */
export function serializeMap<K extends string, V>(map: Map<K, V>): Array<[K, V]> {
  return [...map.entries()]
}

/** Rebuild a Map from an entry array produced by serializeMap. */
export function deserializeMap<K extends string, V>(entries: Array<[K, V]>): Map<K, V> {
  return new Map(entries)
}

/* ────────────────────────── league data ────────────────────────── */

export function serializeLeagueData(data: LeagueData): SerializedLeagueData {
  return {
    league: data.league,
    teams: serializeMap(data.teams),
    players: serializeMap(data.players)
  }
}

export function deserializeLeagueData(s: SerializedLeagueData): LeagueData {
  const teams = new Map<TeamId, Team>()
  for (const [id, team] of s.teams) teams.set(asTeamId(id), team as Team)
  const players = new Map<PlayerId, Player>()
  for (const [id, player] of s.players) players.set(asPlayerId(id), player as Player)
  return { league: s.league as League, teams, players }
}

/* ────────────────────────── snapshot validation ────────────────────────── */

const PHASES: readonly CareerPhase[] = ['regularSeason', 'playoffs', 'offseason']

function fail(detail: string): never {
  throw new Error(`invalid snapshot: ${detail}`)
}

function asRecord(x: unknown, what: string): Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) {
    fail(`${what} must be an object, got ${x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x}`)
  }
  return x as Record<string, unknown>
}

function requireString(s: Record<string, unknown>, key: string): void {
  if (typeof s[key] !== 'string') fail(`"${key}" must be a string, got ${typeof s[key]}`)
}

function requireNumber(s: Record<string, unknown>, key: string): void {
  if (typeof s[key] !== 'number' || !Number.isFinite(s[key])) {
    fail(`"${key}" must be a finite number, got ${typeof s[key]}`)
  }
}

function requireArray(s: Record<string, unknown>, key: string): unknown[] {
  if (!Array.isArray(s[key])) fail(`"${key}" must be an array, got ${typeof s[key]}`)
  return s[key] as unknown[]
}

/** Entry arrays feed deserializeMap, so every element must be a [string, *] pair. */
function requireEntryArray(s: Record<string, unknown>, key: string): void {
  const arr = requireArray(s, key)
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i]
    if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string') {
      fail(`"${key}"[${i}] must be a [string, value] entry pair`)
    }
  }
}

function requireObjectOrNull(s: Record<string, unknown>, key: string): void {
  const v = s[key]
  if (v !== null && (typeof v !== 'object' || Array.isArray(v))) {
    fail(`"${key}" must be an object or null, got ${typeof v}`)
  }
  if (v === undefined) fail(`"${key}" is missing (must be an object or null)`)
}

/**
 * Structural check on a parsed save file. Verifies the version envelope and
 * every required top-level field of CareerSnapshot; throws a descriptive
 * Error naming the offending field otherwise. Returns the input typed as
 * CareerSnapshot so callers can use it directly.
 */
export function validateSnapshot(x: unknown): CareerSnapshot {
  const s = asRecord(x, 'snapshot')

  if (s['version'] !== 1) {
    fail(`unsupported version ${JSON.stringify(s['version'])} (expected 1)`)
  }

  requireString(s, 'savedAt')
  requireString(s, 'saveName')
  requireNumber(s, 'seed')
  requireString(s, 'userTeamId')
  if (!PHASES.includes(s['phase'] as CareerPhase)) {
    fail(`"phase" must be one of ${PHASES.join(' | ')}, got ${JSON.stringify(s['phase'])}`)
  }
  requireNumber(s, 'currentDay')
  requireNumber(s, 'year')

  const leagueData = asRecord(s['leagueData'], '"leagueData"')
  asRecord(leagueData['league'], '"leagueData.league"')
  requireEntryArray(leagueData, 'teams')
  requireEntryArray(leagueData, 'players')

  requireEntryArray(s, 'standings')
  requireEntryArray(s, 'playerTotals')
  requireEntryArray(s, 'gamesPlayed')
  const gamesPlayed = s['gamesPlayed'] as Array<[string, unknown]>
  for (let i = 0; i < gamesPlayed.length; i++) {
    if (typeof gamesPlayed[i][1] !== 'number') {
      fail(`"gamesPlayed"[${i}] value must be a number`)
    }
  }

  requireArray(s, 'news')
  requireNumber(s, 'newsCounter')
  requireObjectOrNull(s, 'playoffs')
  requireObjectOrNull(s, 'offseason')
  requireArray(s, 'picks')
  requireArray(s, 'history')

  return s as unknown as CareerSnapshot
}
