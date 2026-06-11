import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SimClient } from '../worker/client'
import type { DashboardView, TeamInfo, WatchedGame, WorkerResponse } from '../worker/protocol'
import { listCareerSaves, loadCareer, saveCareer } from '@renderer/lib/saves'
import { MatchViewer } from './MatchViewer'
import { ActionsContext, type ShellActions } from './components/ActionsContext'
import { NavContext, type NavApi, type NavParams, type ScreenId } from './components/NavContext'
import { TopNav } from './components/TopNav'
import { ToastStack } from './components/Toast'
import { bumpRefresh, toast } from './components/store'
import { Notice } from './components/ui'
import { SimContext, useClient, useScreenData } from './hooks/useSim'
import { DashboardScreen } from './screens/DashboardScreen'
import { DraftScreen } from './screens/DraftScreen'
import { FinancesScreen } from './screens/FinancesScreen'
import { InboxScreen } from './screens/InboxScreen'
import { MatchCenterScreen } from './screens/MatchCenterScreen'
import { OffseasonScreen } from './screens/OffseasonScreen'
import { PlayerProfileScreen } from './screens/PlayerProfileScreen'
import { PlayoffsScreen } from './screens/PlayoffsScreen'
import { ScheduleScreen } from './screens/ScheduleScreen'
import { ScoutingScreen } from './screens/ScoutingScreen'
import { SquadScreen } from './screens/SquadScreen'
import { StandingsScreen } from './screens/StandingsScreen'
import { StatsScreen } from './screens/StatsScreen'
import { TacticsScreen } from './screens/TacticsScreen'
import { TradesScreen } from './screens/TradesScreen'
import { HistoryScreen } from './screens/HistoryScreen'

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

  useEffect(() => {
    const c = new SimClient()
    setClient(c)
    void c.version().then((res) => {
      if (res.type === 'version') setEngine(res.engine)
    })
    return () => {
      c.dispose()
      setClient(null)
    }
  }, [])

  const createLeague = async (): Promise<void> => {
    if (!client || busy) return
    setBusy(true)
    const res = await client.newLeague(seed)
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
  const [nav, setNav] = useState<{ screen: ScreenId; params: NavParams }>({
    screen: 'dashboard',
    params: {},
  })
  const navigate = useCallback(
    (screen: ScreenId, params?: NavParams) => setNav({ screen, params: params ?? {} }),
    []
  )
  const navApi = useMemo<NavApi>(
    () => ({ screen: nav.screen, params: nav.params, navigate }),
    [nav, navigate]
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

  const closeViewer = useCallback(() => {
    setWatched(null)
    setNav({ screen: 'dashboard', params: {} })
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
    <NavContext.Provider value={navApi}>
      <ActionsContext.Provider value={actions}>
        {watched ? (
          <div className="match-fullbleed">
            <MatchViewer game={watched} onClose={closeViewer} />
          </div>
        ) : (
          <div className="app-shell">
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
            <div className="shell-main">
              <ScreenBoundary screen={nav.screen}>
                <ScreenRouter screen={nav.screen} params={nav.params} />
              </ScreenBoundary>
            </div>
          </div>
        )}
      </ActionsContext.Provider>
    </NavContext.Provider>
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
    case 'inbox':
      return <InboxScreen />
    case 'dashboard':
      return <DashboardScreen />
    case 'squad':
      return <SquadScreen />
    case 'player':
      // Keyed by playerId so navigating player → player remounts + refetches.
      return props.params.playerId ? (
        <PlayerProfileScreen key={props.params.playerId} playerId={props.params.playerId} />
      ) : (
        <Notice kind="warn">No player selected.</Notice>
      )
    case 'tactics':
      return <TacticsScreen />
    case 'schedule':
      return <ScheduleScreen />
    case 'standings':
      return <StandingsScreen />
    case 'stats':
      return <StatsScreen />
    case 'trades':
      return <TradesScreen />
    case 'finances':
      return <FinancesScreen />
    case 'scouting':
      return <ScoutingScreen />
    case 'draft':
      return <DraftScreen />
    case 'offseason':
      return <OffseasonScreen />
    case 'playoffs':
      return <PlayoffsScreen />
    case 'matchcenter':
      return <MatchCenterScreen />
    case 'history':
      return <HistoryScreen />
  }
}

/* ────────────────────────── pre-career ────────────────────────── */

function SetupHero(props: {
  seed: number
  setSeed: (n: number) => void
  busy: boolean
  onCreate: () => void
}): JSX.Element {
  return (
    <div className="hero">
      <h1 className="hero-title">HOCKEY MANAGER</h1>
      <p className="hero-sub">
        Generate a league, choose a club, and live the season from behind the bench.
      </p>
      <div className="panel stack">
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
