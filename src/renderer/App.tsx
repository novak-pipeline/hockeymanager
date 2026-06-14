import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SimClient } from '../worker/client'
import type { DashboardView, TeamInfo, WatchedGame, WorkerResponse } from '../worker/protocol'
import { listCareerSaves, loadCareer, saveCareer } from '@renderer/lib/saves'
import { listMods, readModDatabase, type ModListEntry } from '@renderer/lib/mods'
import { MatchViewer } from './MatchViewer'
import { ActionsContext, type ShellActions } from './components/ActionsContext'
import { NavContext, type NavApi, type NavParams, type ScreenId } from './components/NavContext'
import { UserTeamContext } from './components/UserTeamContext'
import { TopNav } from './components/TopNav'
import { SideNav } from './components/SideNav'
import { TeamColorsProvider } from './components/Crest'
import { SubTabBar } from './components/SubTabBar'
import { useGlobalTeamTheme } from './components/ThemeScope'
import { THEME_PRESETS } from './components/themes'
import { ToastStack } from './components/Toast'
import { bumpRefresh, toast, useUiStore } from './components/store'
import { Notice } from './components/ui'
import { SimContext, useClient, useScreenData } from './hooks/useSim'
import { DashboardScreen } from './screens/DashboardScreen'
import { InboxScreen } from './screens/InboxScreen'
import { MatchCenterScreen } from './screens/MatchCenterScreen'
import { PlayerProfileScreen } from './screens/PlayerProfileScreen'
import { CalendarScreen } from './screens/CalendarScreen'
import { ScheduleScreen } from './screens/ScheduleScreen'
import { TradesScreen } from './screens/TradesScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TeamScreen } from './screens/TeamScreen'
import { LeagueScreen } from './screens/LeagueScreen'
import { WorldScreen } from './screens/WorldScreen'
import { BoardScreen } from './screens/BoardScreen'
import { StaffMeetingScreen } from './screens/StaffMeetingScreen'
import { DataHubScreen } from './screens/DataHubScreen'
import { PressConference } from './components/PressConference'
import { pollPress } from './lib/press'

type AppPhase = 'setup' | 'picking' | 'shell'

const SAVE_SLOT = 'slot-1'

/**
 * App root. Owns the single SimClient, the pre-career flow (setup → team
 * picker), and hands the picked club to the Shell, which provides navigation
 * and calendar actions to every screen.
 */
export function App(): JSX.Element {
  const [client, setClient] = useState<SimClient | null>(null)
  const [engine, setEngine] = useState('…')
  const [phase, setPhase] = useState<AppPhase>('setup')
  const [seed, setSeed] = useState(2026)
  const [teams, setTeams] = useState<TeamInfo[]>([])
  const [userTeam, setUserTeam] = useState<TeamInfo | null>(null)
  const [busy, setBusy] = useState(false)
  // Mod picker state
  const [availableMods, setAvailableMods] = useState<ModListEntry[]>([])
  const [selectedModId, setSelectedModId] = useState<string>('') // '' = fictional default

  useEffect(() => {
    const c = new SimClient()
    setClient(c)
    void c.version().then((res) => {
      if (res.type === 'version') setEngine(res.engine)
    })
    // Discover available mods (non-blocking; silently empty on browser/no-mod)
    void listMods().then((mods) => setAvailableMods(mods))
    return () => {
      c.dispose()
      setClient(null)
    }
  }, [])

  const createLeague = async (): Promise<void> => {
    if (!client || busy) return
    setBusy(true)
    let res
    if (selectedModId) {
      // Load the real-roster mod database then send it to the worker.
      const modData = await readModDatabase(selectedModId)
      if (!modData) {
        toast(`Failed to load mod "${selectedModId}"`, 'error')
        setBusy(false)
        return
      }
      res = await client.newLeagueFromMod(modData, seed)
    } else {
      res = await client.newLeague(seed)
    }
    setBusy(false)
    if (res.type === 'teamList') {
      setTeams([...res.teams].sort((a, b) => b.strength - a.strength))
      setPhase('picking')
    } else if (res.type === 'error') {
      toast(res.message, 'error')
    }
  }

  const pickTeam = async (team: TeamInfo): Promise<void> => {
    if (!client || busy) return
    setBusy(true)
    const res = await client.startCareer(team.teamId)
    setBusy(false)
    if (res.type === 'error') {
      toast(res.message, 'error')
      return
    }
    setUserTeam(team)
    setPhase('shell')
  }

  return (
    <>
      {client && (
        <SimContext.Provider value={client}>
          {phase === 'setup' && (
            <SetupHero
              seed={seed}
              setSeed={setSeed}
              busy={busy}
              availableMods={availableMods}
              selectedModId={selectedModId}
              setSelectedModId={setSelectedModId}
              onCreate={() => void createLeague()}
            />
          )}
          {phase === 'picking' && (
            <TeamPicker teams={teams} busy={busy} onPick={(t) => void pickTeam(t)} />
          )}
          {phase === 'shell' && userTeam && <Shell team={userTeam} engineVersion={engine} />}
        </SimContext.Provider>
      )}
      <ToastStack />
    </>
  )
}

/* ────────────────────────── shell ────────────────────────── */

function Shell(props: { team: TeamInfo; engineVersion: string }): JSX.Element {
  const client = useClient()
  const teamTheme = useGlobalTeamTheme(props.team.teamId)
  const themeMode = useUiStore((s) => s.themeMode)
  const baseTheme = themeMode === 'team' ? teamTheme : THEME_PRESETS[themeMode]
  // The hero CTA (Continue) is ALWAYS the club's colour, whatever UI theme is
  // selected, so it reads as "your team". Falls back to the active accent.
  const tt = teamTheme as Record<string, string> | undefined
  const appTheme = {
    ...(baseTheme ?? {}),
    ...(tt?.['--accent-rgb'] ? { '--hero-rgb': tt['--accent-rgb'] } : {}),
    ...(tt?.['--accent-ink'] ? { '--hero-ink': tt['--accent-ink'] } : {}),
  } as typeof baseTheme
  const [nav, setNav] = useState<{ screen: ScreenId; params: NavParams }>({
    screen: 'dashboard',
    params: {},
  })
  const [history, setHistory] = useState<Array<{ screen: ScreenId; params: NavParams }>>([])

  const navigate = useCallback(
    (screen: ScreenId, params?: NavParams) => {
      const nextParams = params ?? {}
      setNav((prev) => {
        // Skip pushing if the destination is identical to current entry.
        const sameScreen = prev.screen === screen
        const prevParamsStr = JSON.stringify(prev.params)
        const nextParamsStr = JSON.stringify(nextParams)
        const sameParams = prevParamsStr === nextParamsStr
        if (!sameScreen || !sameParams) {
          setHistory((h) => {
            const capped = h.length >= 50 ? h.slice(h.length - 49) : h
            return [...capped, prev]
          })
        }
        return { screen, params: nextParams }
      })
    },
    []
  )

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]!
      setNav(prev)
      return h.slice(0, h.length - 1)
    })
  }, [])

  const canGoBack = history.length > 0

  const navApi = useMemo<NavApi>(
    () => ({ screen: nav.screen, params: nav.params, navigate, goBack, canGoBack }),
    [nav, navigate, goBack, canGoBack]
  )

  const [watched, setWatched] = useState<WatchedGame | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  // The shell-level dashboard fetch feeds the top nav; it refetches on every
  // refresh bump like any screen. Errors here are non-fatal.
  const { data: dashboard } = useScreenData<DashboardView>(
    () => client.getDashboard(),
    (r) => (r.type === 'dashboard' ? r.dashboard : null)
  )

  // Press pump: fire on every refresh bump (version change).
  const version = useUiStore((s) => s.version)
  useEffect(() => {
    void pollPress(client)
  }, [version, client])

  /** Serialize world-mutating calls; toast errors; bump the refresh bus. */
  const run = useCallback(
    async (fn: () => Promise<WorkerResponse>): Promise<WorkerResponse | null> => {
      if (busyRef.current) return null
      busyRef.current = true
      setBusy(true)
      try {
        const res = await fn()
        if (res.type === 'error') {
          toast(res.message, 'error')
          return null
        }
        bumpRefresh()
        return res
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    []
  )

  const actions = useMemo<ShellActions>(
    () => ({
      busy,
      continueGame: () => {
        void run(() => client.continueGame())
      },
      advanceDays: (days: number) => {
        void run(() => client.advance(days))
      },
      toNextGame: () => {
        void run(() => client.advanceToNextGame())
      },
      watchNext: () => {
        void (async () => {
          const res = await run(() => client.watch())
          if (res && res.type === 'watch') {
            if (res.game) setWatched(res.game)
            else toast('No user fixture next — simmed the day')
          }
        })()
      },
    }),
    [busy, client, run]
  )

  // Spacebar advances the game (FM-style) — unless a match is open, the user is
  // typing in a field, or a button/link is focused (where space activates it).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.code !== 'Space' && e.key !== ' ') return
      if (watched || e.repeat) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        tag === 'BUTTON' || tag === 'A' ||
        t?.isContentEditable || t?.getAttribute('role') === 'button'
      ) return
      e.preventDefault()
      actions.continueGame()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [watched, actions])

  const closeViewer = useCallback(() => {
    setWatched(null)
    setNav({ screen: 'dashboard', params: {} })
    setHistory([])
    bumpRefresh()
  }, [])

  const onSave = (): void => {
    void (async () => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      try {
        const saveName = dashboard
          ? `${dashboard.userTeam.name} ${dashboard.year}`
          : props.team.name
        const res = await client.exportSave(saveName)
        if (res.type === 'save') {
          await saveCareer(SAVE_SLOT, res.snapshot)
          toast('Career saved', 'success')
        } else if (res.type === 'error') {
          toast(`Save failed: ${res.message}`, 'error')
        } else {
          toast('Save failed: unexpected worker response', 'error')
        }
      } catch (err) {
        toast(`Save failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    })()
  }

  const onLoad = (): void => {
    void (async () => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      try {
        const slots = await listCareerSaves()
        const newest = [...slots].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
        if (!newest) {
          toast('No saved careers found')
          return
        }
        const snapshot = await loadCareer(newest.slot)
        const res = await client.importSave(snapshot)
        if (res.type === 'error') {
          toast(`Load failed: ${res.message}`, 'error')
          return
        }
        setNav({ screen: 'dashboard', params: {} })
        setHistory([])
        bumpRefresh()
        toast(`Loaded "${newest.saveName}"`, 'success')
      } catch (err) {
        toast(`Load failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    })()
  }

  return (
    <UserTeamContext.Provider value={props.team.teamId}>
    <NavContext.Provider value={navApi}>
      <ActionsContext.Provider value={actions}>
        <TeamColorsProvider>
        {watched ? (
          <div className="match-fullbleed">
            <MatchViewer game={watched} onClose={closeViewer} />
          </div>
        ) : (
          <div className="app-shell" style={appTheme}>
            <PressConference />
            <div className="app-body">
              <SideNav dashboard={dashboard} />
              <div className="app-right">
                <TopNav
                  teamId={props.team.teamId}
                  clubName={props.team.name}
                  clubAbbr={props.team.abbreviation}
                  dashboard={dashboard}
                  busy={busy}
                  engineVersion={props.engineVersion}
                  onSave={onSave}
                  onLoad={onLoad}
                />
                <SubTabBar dashboard={dashboard} />
                <div className="shell-main">
                  <ScreenBoundary screen={nav.screen}>
                    <ScreenRouter screen={nav.screen} params={nav.params} />
                  </ScreenBoundary>
                </div>
              </div>
            </div>
          </div>
        )}
        </TeamColorsProvider>
      </ActionsContext.Provider>
    </NavContext.Provider>
    </UserTeamContext.Provider>
  )
}

/**
 * One broken screen must never blank the whole app: catch render errors and
 * show them in place. Keyed remount (via `screen`) clears the error when the
 * user navigates elsewhere.
 */
class ScreenBoundary extends Component<
  { screen: ScreenId; children: ReactNode },
  { error: Error | null; lastScreen: ScreenId }
> {
  constructor(props: { screen: ScreenId; children: ReactNode }) {
    super(props)
    this.state = { error: null, lastScreen: props.screen }
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  static getDerivedStateFromProps(
    props: { screen: ScreenId },
    state: { error: Error | null; lastScreen: ScreenId }
  ): { error: Error | null; lastScreen: ScreenId } | null {
    if (props.screen !== state.lastScreen) return { error: null, lastScreen: props.screen }
    return null
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <Notice kind="danger">
          This screen hit an error: {this.state.error.message}. Navigate elsewhere and back to
          retry.
        </Notice>
      )
    }
    return this.props.children
  }
}

function ScreenRouter(props: { screen: ScreenId; params: NavParams }): JSX.Element {
  switch (props.screen) {
    // ── Front Office ──
    case 'dashboard':
      return <DashboardScreen />
    case 'board':
      return <BoardScreen />
    case 'staffMeeting':
      return <StaffMeetingScreen />

    // ── News ──
    case 'inbox':
      return <InboxScreen />

    // ── Team (mega-screen with sub-tab router) ──
    case 'squad':
    case 'teamStats':
    case 'report':
    case 'personnel':
    case 'practice':
    case 'tactics':
    case 'finances':
    case 'teamInfo':
    case 'teamHistory':
    case 'teamDataHub':
    case 'teamDynamics':
    case 'teamMedical':
    case 'teamDevelopment':
    case 'teamPlanner':
      return <TeamScreen tab={props.screen} />

    // ── League (mega-screen with sub-tab router) ──
    case 'leagueOverview':
    case 'standings':
    case 'leagueSchedule':
    case 'stats':
    case 'leagueLeaders':
    case 'leagueTeamStats':
    case 'leagueTransactions':
    case 'leagueScoreboard':
    case 'leagueHistory':
    case 'scouting':
    case 'draft':
    case 'offseason':
    case 'playoffs':
      return <LeagueScreen tab={props.screen} />

    // ── World (wider-world competitions) ──
    case 'world':
      return <WorldScreen tab="leagues" />
    case 'worldInternational':
      return <WorldScreen tab="international" />

    // ── Data Hub (Analytics) ──
    case 'dataHub':
      return <DataHubScreen />

    // ── Player profile (overlay/shared) ──
    case 'player':
      return props.params.playerId ? (
        <PlayerProfileScreen playerId={props.params.playerId} />
      ) : (
        <Notice kind="warn">No player selected.</Notice>
      )

    // ── Shared screens ──
    case 'matchcenter':
      return <MatchCenterScreen />
    case 'calendar':
      return <CalendarScreen />
    case 'trades':
      return <TradesScreen />
    case 'lockerRoom':
      return <Notice kind="info">Locker room — navigate via Team &gt; Roster.</Notice>
    case 'settings':
      return <SettingsScreen />

    // ── Legacy aliases (redirect to renamed equivalents) ──
    case 'schedule':
      return <ScheduleScreen />
    case 'history':
      return <HistoryScreen />
  }
}

/* ────────────────────────── pre-career ────────────────────────── */

function SetupHero(props: {
  seed: number
  setSeed: (n: number) => void
  busy: boolean
  availableMods: ModListEntry[]
  selectedModId: string
  setSelectedModId: (id: string) => void
  onCreate: () => void
}): JSX.Element {
  return (
    <div className="hero">
      <h1 className="hero-title">HOCKEY MANAGER</h1>
      <p className="hero-sub">
        Generate a league, choose a club, and live the season from behind the bench.
      </p>
      <div className="panel stack">
        {/* Database picker — only shown when at least one mod is installed */}
        {props.availableMods.length > 0 && (
          <div>
            <label className="field-label" htmlFor="db-select">
              Database
            </label>
            <select
              id="db-select"
              className="input"
              value={props.selectedModId}
              onChange={(e) => props.setSelectedModId(e.target.value)}
            >
              <option value="">Fictional (default)</option>
              {props.availableMods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.season ? ` (${m.season})` : ''}
                  {` — ${m.teamCount} teams`}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="field-label" htmlFor="seed-input">
            World seed
          </label>
          <input
            id="seed-input"
            className="input"
            type="number"
            value={props.seed}
            onChange={(e) => props.setSeed(Number(e.target.value))}
          />
        </div>
        <button className="btn btn-hero btn-lg" onClick={props.onCreate} disabled={props.busy}>
          {props.busy ? 'Generating…' : 'Generate league'}
        </button>
      </div>
    </div>
  )
}

function TeamPicker(props: {
  teams: TeamInfo[]
  busy: boolean
  onPick: (team: TeamInfo) => void
}): JSX.Element {
  return (
    <div className="picker">
      <div className="screen-header">
        <h1 className="screen-title">Choose your club</h1>
        <span className="muted small">sorted by squad rating</span>
      </div>
      <div className="grid grid-auto">
        {props.teams.map((t) => (
          <button
            key={t.teamId}
            className="team-card"
            onClick={() => props.onPick(t)}
            disabled={props.busy}
          >
            <div className="crest" style={{ background: 'var(--bg3)', color: 'var(--violet-h)' }}>
              {t.abbreviation}
            </div>
            <div>
              <div className="team-card-name">{t.name}</div>
              <div className="team-card-meta">
                {t.conference} · {t.division}
              </div>
              <div className="team-card-meta">
                Squad rating{' '}
                <strong style={{ color: 'var(--violet-h)' }}>{t.strength}</strong>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
