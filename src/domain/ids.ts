/**
 * Branded ID types. Nominal typing prevents passing a TeamId where a PlayerId
 * is expected even though both are strings at runtime.
 */

declare const brand: unique symbol

type Brand<T, B extends string> = T & { readonly [brand]: B }

export type PlayerId = Brand<string, 'PlayerId'>
export type TeamId = Brand<string, 'TeamId'>
export type LeagueId = Brand<string, 'LeagueId'>
export type GameId = Brand<string, 'GameId'>
export type SeasonId = Brand<string, 'SeasonId'>

export const asPlayerId = (s: string): PlayerId => s as PlayerId
export const asTeamId = (s: string): TeamId => s as TeamId
export const asLeagueId = (s: string): LeagueId => s as LeagueId
export const asGameId = (s: string): GameId => s as GameId
export const asSeasonId = (s: string): SeasonId => s as SeasonId

/**
 * References embedded in the event stream. Kept as bare ids so the stream stays
 * compact; renderers resolve names/jersey numbers via lookup tables.
 */
export type PlayerRef = PlayerId
export type TeamRef = TeamId
