/**
 * Crest — a team's placeholder logo (coloured tile with its abbreviation),
 * painted in the team's real { primary, secondary } colours.
 *
 * - <CrestView> is pure: pass `colors` directly. Use it on list screens where
 *   rows already carry colours, so there's no per-crest fetch.
 * - <Crest> resolves a team's colours via useTeamColors (one fetch). Use it for
 *   single crests (topbar, headers) where colours aren't already in hand.
 */
import { createContext, useContext, useMemo, type CSSProperties } from 'react'
import type { LeagueTeamsView } from '../../worker/protocol'
import { crestColor } from './format'
import { crestStyle, useTeamColors } from './ThemeScope'
import { useClient, useScreenData } from '../hooks/useSim'

interface CrestViewProps {
  teamId: string
  abbr: string
  colors?: { primary: number; secondary: number }
  className?: string
  style?: CSSProperties
}

/** Pure crest — no data fetch. Pass `colors` to paint in team colours. */
export function CrestView({ teamId, abbr, colors, className, style }: CrestViewProps): JSX.Element {
  const paint = colors
    ? crestStyle(colors.primary, colors.secondary)
    : { background: crestColor(teamId), color: '#fff', borderColor: 'transparent' }
  return (
    <div
      className={className}
      style={{
        background: paint.background,
        color: paint.color,
        border: `1.5px solid ${paint.borderColor}`,
        ...style,
      }}
    >
      {abbr}
    </div>
  )
}

/** Self-resolving crest — fetches the team's colours (use for single crests). */
export function Crest({ teamId, abbr, className, style }: Omit<CrestViewProps, 'colors'>): JSX.Element {
  const colors = useTeamColors(teamId)
  return <CrestView teamId={teamId} abbr={abbr} {...(colors ? { colors } : {})} {...(className ? { className } : {})} {...(style ? { style } : {})} />
}

/* ── shared league-colour map (one fetch for the whole subtree) ── */

type ColorMap = Map<string, { primary: number; secondary: number }>
const TeamColorsContext = createContext<ColorMap>(new Map())

/**
 * Fetches every team's colours ONCE and provides them to descendants, so list
 * screens can render many <TeamCrest> without each re-fetching. Wrap the app
 * shell in this.
 */
export function TeamColorsProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const client = useClient()
  const { data } = useScreenData<LeagueTeamsView>(
    () => client.getLeagueTeams(),
    (r) => (r.type === 'leagueTeams' ? r.teams : null)
  )
  const map = useMemo<ColorMap>(() => {
    const m: ColorMap = new Map()
    if (data) for (const t of [...data.nhl, ...data.ahl]) {
      if (t.colors) { m.set(t.teamId, t.colors); m.set(t.abbreviation, t.colors) }
    }
    return m
  }, [data])
  return <TeamColorsContext.Provider value={map}>{children}</TeamColorsContext.Provider>
}

/** Crest that reads colours from the shared provider — no per-instance fetch.
 *  `teamId` may be a team id OR an abbreviation (both are indexed). */
export function TeamCrest({ teamId, abbr, className, style }: Omit<CrestViewProps, 'colors'>): JSX.Element {
  const colors = useContext(TeamColorsContext).get(teamId)
  return <CrestView teamId={teamId} abbr={abbr} {...(colors ? { colors } : {})} {...(className ? { className } : {})} {...(style ? { style } : {})} />
}

/** The team's primary colour as a #hex (for accenting panels), from the shared
 *  provider; falls back to the deterministic placeholder hue. Accepts id or abbr. */
export function useTeamCrestColor(key: string): string {
  const colors = useContext(TeamColorsContext).get(key)
  return colors ? crestStyle(colors.primary, colors.secondary).background : crestColor(key)
}

/** The shared colour map (call at the top of a component, before any early
 *  return), then resolve colours with colorFromMap once data is in hand. */
export function useTeamColorMap(): ColorMap {
  return useContext(TeamColorsContext)
}

/** Pure: team primary colour #hex from a map, falling back to the placeholder. */
export function colorFromMap(map: ColorMap, key: string): string {
  const c = map.get(key)
  return c ? crestStyle(c.primary, c.secondary).background : crestColor(key)
}
