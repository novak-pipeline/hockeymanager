/**
 * National-team selection (#48). Picks a nation's best available roster from its
 * player pool, position-balanced like a real international squad (14 F / 7 D /
 * 2 G = 23). Used for both the senior team and the U20 (World Juniors) team —
 * the U20 caller just passes maxAge: 19.
 *
 * Pure given its inputs. Selection is purely merit-based (best current ability
 * per position); chemistry/coach preference can layer on later.
 */
import type { Player } from '@domain'
import { ratedOverall } from '@engine/ratings/composites'

export interface NationalTeamPick {
  player: Player
  /** 'F' | 'D' | 'G' bucket the player was selected into. */
  slot: 'F' | 'D' | 'G'
}

export interface SelectNationalTeamOptions {
  /** Inclusive max age (U20 = 19). Omit for the senior team. */
  maxAge?: number
  forwards?: number
  defensemen?: number
  goalies?: number
}

/** Select a position-balanced national-team roster, best-available per slot. */
export function selectNationalTeam(pool: Player[], opts: SelectNationalTeamOptions = {}): NationalTeamPick[] {
  const nF = opts.forwards ?? 14
  const nD = opts.defensemen ?? 7
  const nG = opts.goalies ?? 2
  const eligible = opts.maxAge !== undefined ? pool.filter((p) => p.age <= opts.maxAge!) : pool

  const byRating = (a: Player, b: Player): number => ratedOverall(b) - ratedOverall(a)
  const fwd = eligible.filter((p) => p.position === 'C' || p.position === 'W').sort(byRating).slice(0, nF)
  const def = eligible.filter((p) => p.position === 'D').sort(byRating).slice(0, nD)
  const gol = eligible.filter((p) => p.position === 'G').sort(byRating).slice(0, nG)

  return [
    ...fwd.map((player): NationalTeamPick => ({ player, slot: 'F' })),
    ...def.map((player): NationalTeamPick => ({ player, slot: 'D' })),
    ...gol.map((player): NationalTeamPick => ({ player, slot: 'G' })),
  ]
}

/** Average current ability of a selected roster — a quick squad-strength gauge. */
export function rosterStrength(picks: NationalTeamPick[]): number {
  if (picks.length === 0) return 0
  return Math.round(picks.reduce((s, p) => s + ratedOverall(p.player), 0) / picks.length)
}

/** Display profile for a hockey nation (the EHM nation-page header fields). */
export interface NationInfo {
  capital: string
  continent: string
  languages: string[]
}

/** Built-in profiles for the main hockey nations (source DB has no nation page
 *  data). Keyed by the nationality string the importer writes. */
const NATION_INFO: Record<string, NationInfo> = {
  'Canada': { capital: 'Ottawa', continent: 'North America', languages: ['English', 'French'] },
  'United States': { capital: 'Washington', continent: 'North America', languages: ['English'] },
  'USA': { capital: 'Washington', continent: 'North America', languages: ['English'] },
  'Sweden': { capital: 'Stockholm', continent: 'Europe', languages: ['Swedish'] },
  'Finland': { capital: 'Helsinki', continent: 'Europe', languages: ['Finnish'] },
  'Russia': { capital: 'Moscow', continent: 'Europe', languages: ['Russian'] },
  'Czechia': { capital: 'Prague', continent: 'Europe', languages: ['Czech'] },
  'Czech Republic': { capital: 'Prague', continent: 'Europe', languages: ['Czech'] },
  'Slovakia': { capital: 'Bratislava', continent: 'Europe', languages: ['Slovak'] },
  'Switzerland': { capital: 'Bern', continent: 'Europe', languages: ['German', 'French', 'Italian'] },
  'Germany': { capital: 'Berlin', continent: 'Europe', languages: ['German'] },
  'Latvia': { capital: 'Riga', continent: 'Europe', languages: ['Latvian'] },
  'Denmark': { capital: 'Copenhagen', continent: 'Europe', languages: ['Danish'] },
  'Norway': { capital: 'Oslo', continent: 'Europe', languages: ['Norwegian'] },
  'Austria': { capital: 'Vienna', continent: 'Europe', languages: ['German'] },
  'Belarus': { capital: 'Minsk', continent: 'Europe', languages: ['Belarusian', 'Russian'] },
  'France': { capital: 'Paris', continent: 'Europe', languages: ['French'] },
  'Slovenia': { capital: 'Ljubljana', continent: 'Europe', languages: ['Slovene'] },
}

export function nationInfo(nation: string): NationInfo {
  return NATION_INFO[nation] ?? { capital: '', continent: '', languages: [] }
}
