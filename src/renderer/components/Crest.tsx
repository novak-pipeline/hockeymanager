/**
 * Crest — a team's placeholder logo (coloured tile with its abbreviation),
 * painted in the team's real { primary, secondary } colours.
 *
 * - <CrestView> is pure: pass `colors` directly. Use it on list screens where
 *   rows already carry colours, so there's no per-crest fetch.
 * - <Crest> resolves a team's colours via useTeamColors (one fetch). Use it for
 *   single crests (topbar, headers) where colours aren't already in hand.
 */
import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { LeagueTeamsView } from '../../worker/protocol'
import { crestColor } from './format'
import { crestStyle, useTeamColors } from './ThemeScope'
import { getLogo, logoIdFor } from '../lib/mods'
import { useClient, useScreenData } from '../hooks/useSim'

/* ── real logo resolution (mod logo packs) ──
 * Team names come from the shared provider; the logo PNG (if the user has
 * imported a pack into mods/<mod>/logos/) is fetched once per name and cached
 * for the process lifetime. No pack -> null -> the coloured tile fallback. */
const logoCache = new Map<string, string | null | Promise<string | null>>()

function resolveLogo(name: string): string | null | Promise<string | null> {
  const cached = logoCache.get(name)
  if (cached !== undefined) return cached
  const p = getLogo(logoIdFor(name)).then((url) => {
    logoCache.set(name, url)
    return url
  })
  logoCache.set(name, p)
  return p
}

/** Data URL of the team's real logo, or null (placeholder tile). `name` may be
 *  undefined when the provider has no entry (world teams, tests). */
function useLogo(name: string | undefined): string | null {
  const initial = name ? logoCache.get(name) : undefined
  const [url, setUrl] = useState<string | null>(typeof initial === 'string' ? initial : null)
  useEffect(() => {
    if (!name) return
    let live = true
    const r = resolveLogo(name)
    if (typeof r === 'string' || r === null) setUrl(r)
    else void r.then((u) => { if (live) setUrl(u) })
    return () => { live = false }
  }, [name])
  return name ? url : null
}

interface CrestViewProps {
  teamId: string
  abbr: string
  colors?: { primary: number; secondary: number }
  className?: string
  style?: CSSProperties
}

/** Crest — the team's real logo when a mod logo pack supplies one, else the
 *  coloured placeholder tile. Pass `colors` to paint the fallback tile. */
export function CrestView({ teamId, abbr, colors, className, style }: CrestViewProps): JSX.Element {
  const name = useContext(TeamNamesContext).get(teamId)
  const logo = useLogo(name)
  if (logo) {
    return (
      <div
        className={className}
        style={{ background: 'transparent', border: 'none', padding: 1, ...style }}
        title={name}
      >
        <img
          src={logo}
          alt={name ?? abbr}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>
    )
  }
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
/** teamId AND abbreviation -> full team name, for logo-pack resolution. */
const TeamNamesContext = createContext<Map<string, string>>(new Map())

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
  const names = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>()
    if (data) for (const t of [...data.nhl, ...data.ahl]) {
      m.set(t.teamId, t.name)
      m.set(t.abbreviation, t.name)
    }
    return m
  }, [data])
  return (
    <TeamColorsContext.Provider value={map}>
      <TeamNamesContext.Provider value={names}>{children}</TeamNamesContext.Provider>
    </TeamColorsContext.Provider>
  )
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
