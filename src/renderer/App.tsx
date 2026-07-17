import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { SimClient } from '../worker/client'
import type { DashboardView, TeamInfo, WatchedGame, WorkerResponse } from '../worker/protocol'
import { listCareerSaves, loadCareer, saveCareer } from '@renderer/lib/saves'
import { listMods, readModDatabase, type ModListEntry } from '@renderer/lib/mods'
import { MatchViewer } from './MatchViewer'
import { ActionsContext, type ShellActions } from './components/ActionsContext'
import { NavContext, type NavApi, type NavParams, type ScreenId } from './components/NavContext'
import { PlayerActionMenu } from './components/PlayerActionMenu'
import { resetNameIndex } from './components/Linkify'
import { UserTeamContext } from './components/UserTeamContext'
import { TopNav } from './components/TopNav'
import { LeagueTicker } from './components/LeagueTicker'
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
import { FeedScreen } from './screens/FeedScreen'
import { DevCampScreen } from './screens/DevCampScreen'
import { TrainingCampScreen } from './screens/TrainingCampScreen'
import { LeadershipScreen } from './screens/LeadershipScreen'
import { NegotiationScreen } from './screens/NegotiationScreen'
import { FreeAgentMarketScreen } from './screens/FreeAgentMarketScreen'
import { ScheduleScreen } from './screens/ScheduleScreen'
import { TradesScreen } from './screens/TradesScreen'
import { WaiverWireScreen } from './screens/WaiverWireScreen'
import { BoardMeetingScreen } from './screens/BoardMeetingScreen'
import { StaffBriefingScreen } from './screens/StaffBriefingScreen'
import { ScoutMeetingScreen } from './screens/ScoutMeetingScreen'
import { CommandPalette } from './components/CommandPalette'
import { PhoneCallOverlay } from './components/PhoneCallOverlay'
import { WarRoomScreen } from './screens/WarRoomScreen'
import { DeadlineDayScreen } from './screens/DeadlineDayScreen'
import { GMCareerScreen } from './screens/GMCareerScreen'
import { MediaCircuitScreen } from './screens/MediaCircuitScreen'
import { MentorshipScreen } from './screens/MentorshipScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TeamScreen } from './screens/TeamScreen'
import { LeagueScreen } from './screens/LeagueScreen'
import { WorldScreen } from './screens/WorldScreen'
import { BoardScreen } from './screens/BoardScreen'
import { StaffMeetingScreen } from './screens/StaffMeetingScreen'
import { JobMarketScreen } from './screens/JobMarketScreen'
import { ScoutProfileScreen } from './screens/ScoutProfileScreen'
import { DataHubScreen } from './screens/DataHubScreen'

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
  // Random world by default — the seed is a knob for players who want a specific
  // world, not something they have to set.
  const [seed, setSeed] = useState(randomSeed)
  const [teams, setTeams] = useState<TeamInfo[]>([])
  const [userTeam, setUserTeam] = useState<TeamInfo | null>(null)
  // The most recent save on disk, if any — powers the one-click Resume on the
  // setup screen so a code reload (dev) or restart drops you back in your game.
  const [resumeInfo, setResumeInfo] = useState<{ slot: string; teamName: string; year: number; phase: string } | null>(null)
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
    // Detect the newest save so the setup screen can offer a one-click Resume
    // (so a dev reload / restart doesn't dump you back to a blank new game).
    void listCareerSaves()
      .then((slots) => {
        const newest = [...slots].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
        if (newest) setResumeInfo({ slot: newest.slot, teamName: newest.teamName, year: newest.year, phase: newest.phase })
      })
      .catch(() => { /* no bridge / no saves — just show the new-game flow */ })
    // NOTE: the neural voices are NOT warmed on startup — running the onnxruntime
    // WASM at launch is heavy and best kept off the critical boot path. They
    // auto-load on the first spoken line instead (see speak.ts), so a fresh
    // launch is always light and stable.
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

  // One-click resume of the newest save — restores the worker and drops straight
  // into the shell, so a dev reload / restart continues your game instead of a
  // blank new one.
  const resumeGame = async (): Promise<void> => {
    if (!client || busy || !resumeInfo) return
    setBusy(true)
    try {
      const snapshot = await loadCareer(resumeInfo.slot)
      const res = await client.importSave(snapshot)
      if (res.type === 'error') { toast(`Resume failed: ${res.message}`, 'error'); return }
      const dashRes = await client.getDashboard()
      const ut = dashRes.type === 'dashboard' ? dashRes.dashboard.userTeam : null
      setUserTeam({
        teamId: ut?.teamId ?? '',
        name: ut?.name ?? resumeInfo.teamName,
        abbreviation: ut?.abbreviation ?? '',
        city: '', conference: '', division: '',
        strength: 0, colors: { primary: 0, secondary: 0 },
      })
      setPhase('shell')
    } catch (err) {
      toast(`Resume failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const pickTeam = async (team: TeamInfo): Promise<void> => {
    if (!client || busy) return
    setBusy(true)
    const res = await client.startCareer(team.teamId, 'offseason')
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
              resume={resumeInfo}
              onResume={() => void resumeGame()}
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
  // #7 cadence: the screen the GM pressed Continue from, so after the calendar
  // preview + day advance we return them there instead of stranding on the calendar.
  const preAdvanceScreenRef = useRef<ScreenId>('dashboard')

  // The shell-level dashboard fetch feeds the top nav; it refetches on every
  // refresh bump like any screen. Errors here are non-fatal.
  const { data: dashboard } = useScreenData<DashboardView>(
    () => client.getDashboard(),
    (r) => (r.type === 'dashboard' ? r.dashboard : null)
  )

  // Press-conference pop-up disabled for now (got in the way of testing).
  // To re-enable: restore the pollPress pump + <PressConference /> render below.

  // Autosave: after world-mutating calls, snapshot to the 'autosave' slot at
  // most once every ~12s. Silent and fire-and-forget — so a code reload (dev) or
  // a crash restores you to seconds ago, not the setup screen. The boot flow
  // auto-resumes this slot; Load also picks the newest slot by mtime.
  const lastAutosaveRef = useRef(0)
  const maybeAutosave = useCallback((): void => {
    const now = Date.now()
    if (now - lastAutosaveRef.current < 12 * 1000) return
    lastAutosaveRef.current = now
    void (async () => {
      try {
        const res = await client.exportSave('Autosave')
        if (res.type === 'save') await saveCareer('autosave', res.snapshot)
      } catch {
        /* autosave is best-effort; the manual Save button reports real errors */
      }
    })()
  }, [client])

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
        maybeAutosave()
        return res
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [maybeAutosave]
  )

  const actions = useMemo<ShellActions>(
    () => ({
      busy,
      continueGame: () => {
        // On draft day the offseason is parked on the entry draft — Continue
        // cannot sim past it. Route the GM into the Draft screen to conduct it.
        if (dashboard?.draftPending) {
          navigate('draft')
          return
        }
        // Preseason: the season can't open until the GM names a captain. Block
        // Continue outright while it's unset — routing to the Leadership screen
        // if you're not already there. (Enforced here, not in the engine, so a
        // headless advance can still roll a season.)
        if (dashboard?.captainsPending) {
          if (nav.screen !== 'leadership') navigate('leadership')
          else toast('Name a captain to open the season — pick the C on this screen.')
          return
        }
        // Cut day: camp's verdicts await before opening night. Continuing from
        // the camp screen itself lets the coach apply his plan.
        if (dashboard?.campPending && nav.screen !== 'trainingCamp') {
          navigate('trainingCamp')
          return
        }
        // Development camp (July): the first Continue after the draft walks you
        // onto the rink. Skipping from there mails the staff report instead.
        if (dashboard?.devCampPending && nav.screen !== 'devCamp') {
          navigate('devCamp')
          return
        }
        // Preseason board meeting: the first Continue of the year walks you into
        // the boardroom. Skipping from there sends the AGM (engine-safe defaults).
        if (dashboard?.boardMeetingPending && nav.screen !== 'boardMeeting') {
          navigate('boardMeeting')
          return
        }
        // End-of-season review: one Continue press walks you in; continuing
        // FROM the review screen (or anywhere twice) lets it lapse engine-side.
        if (dashboard?.reviewPending && nav.screen !== 'seasonReview') {
          navigate('seasonReview')
          return
        }
        // Bi-weekly staff meeting: the coaches convene with live-roster proposals.
        // Skipping (delegate) hands the meeting to the AGM (engine-safe defaults).
        if (dashboard?.staffMeetingDue && nav.screen !== 'staffBriefing') {
          navigate('staffBriefing')
          return
        }
        // Monthly scout meeting: the recruitment desk convenes with the board.
        // Skipping (delegate) hands it to the Head of Scouting (safe defaults).
        if (dashboard?.scoutMeetingDue && nav.screen !== 'scoutMeeting') {
          navigate('scoutMeeting')
          return
        }
        // #7 cadence: a Continue press first previews the CALENDAR — what's ahead —
        // so advancing the season is a deliberate two-beat rhythm instead of mashing
        // Continue while reading the dashboard. The next press (from the calendar)
        // actually ticks the day and returns you to the screen you came from.
        if (nav.screen !== 'calendar') {
          preAdvanceScreenRef.current = nav.screen
          navigate('calendar')
          return
        }
        void (async () => {
          await run(() => client.continueGame())
          const back = preAdvanceScreenRef.current
          navigate(back === 'calendar' ? 'dashboard' : back)
        })()
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
    [busy, client, run, dashboard?.draftPending, dashboard?.captainsPending, dashboard?.campPending, dashboard?.devCampPending, dashboard?.boardMeetingPending, dashboard?.reviewPending, dashboard?.staffMeetingDue, dashboard?.scoutMeetingDue, nav.screen, navigate]
  )

  // Spacebar advances the game (FM-style) — unless a match is open, the user is
  // typing in a field, or a button/link is focused (where space activates it).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.code !== 'Space' && e.key !== ' ') return
      if (watched || e.repeat) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      // Only bail when the GM is actually typing — space must ADVANCE the game
      // (FM-style) even when a button/link happens to hold focus after a click.
      // preventDefault below stops the focused control from also activating.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      // Space sims the next day everywhere — EXCEPT on the inbox screen, where
      // it first steps through the unread mail (the inbox's own handler does
      // that and consumes the key). Once the inbox is all read, Space sims here.
      const unread = dashboard?.unreadNews ?? 0
      if (nav.screen === 'inbox' && unread > 0) return // inbox handler advances messages
      e.preventDefault()
      actions.continueGame()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [watched, actions, nav, dashboard?.unreadNews])

  // Deadline day: when the engine holds the sim, walk the GM into the trade
  // office automatically — the draft-day pattern, once a season.
  const deadlineRoutedRef = useRef(false)
  useEffect(() => {
    if (dashboard?.deadlinePending && !deadlineRoutedRef.current) {
      deadlineRoutedRef.current = true
      navigate('deadlineDay')
      toast('Deadline day — the phones are ringing', 'info')
    }
    if (!dashboard?.deadlinePending) deadlineRoutedRef.current = false
  }, [dashboard?.deadlinePending, navigate])

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
        resetNameIndex() // the loaded world may have different players
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
                {nav.screen === 'dashboard' && <LeagueTicker />}
                <CommandPalette />
                <PhoneCallOverlay />
                <SubTabBar dashboard={dashboard} />
                <div className="shell-main">
                  <MotionConfig reducedMotion="user">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={nav.screen}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <ScreenBoundary screen={nav.screen}>
                          <ScreenRouter screen={nav.screen} params={nav.params} />
                        </ScreenBoundary>
                      </motion.div>
                    </AnimatePresence>
                  </MotionConfig>
                </div>
              </div>
            </div>
          </div>
        )}
        <PlayerActionMenu />
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
    case 'jobMarket':
      return <JobMarketScreen />
    case 'scoutProfile':
      return <ScoutProfileScreen scoutId={props.params.scoutId ?? ''} />

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
    case 'scoutingCentre':
    case 'scoutingPlayers':
    case 'scoutingFocus':
    case 'scoutingCoverage':
    case 'scoutingDraft':
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
      return <MatchCenterScreen gameId={params.gameId as string | undefined} />
    case 'calendar':
      return <CalendarScreen />
    case 'feed':
      return <FeedScreen />
    case 'devCamp':
      return <DevCampScreen />
    case 'trainingCamp':
      return <TrainingCampScreen />
    case 'leadership':
      return <LeadershipScreen />
    case 'negotiation':
      return <NegotiationScreen />
    case 'faMarket':
      return <FreeAgentMarketScreen />
    case 'trades':
      return <TradesScreen />
    case 'waivers':
      return <WaiverWireScreen />
    case 'boardMeeting':
      return <BoardMeetingScreen />
    case 'seasonReview':
      return <BoardMeetingScreen variant="review" />
    case 'staffBriefing':
      return <StaffBriefingScreen />
    case 'scoutMeeting':
      return <ScoutMeetingScreen />
    case 'warRoom':
      return <WarRoomScreen />
    case 'deadlineDay':
      return <DeadlineDayScreen />
    case 'gmCareer':
      return <GMCareerScreen />
    case 'mediaCircuit':
      return <MediaCircuitScreen />
    case 'mentorship':
      return <MentorshipScreen />
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

/** A fresh random world seed (1..1,000,000). */
function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000) + 1
}

function SetupHero(props: {
  seed: number
  setSeed: (n: number) => void
  busy: boolean
  availableMods: ModListEntry[]
  selectedModId: string
  setSelectedModId: (id: string) => void
  onCreate: () => void
  resume: { teamName: string; year: number; phase: string } | null
  onResume: () => void
}): JSX.Element {
  const phaseLabel = (p: string): string =>
    p === 'offseason' ? 'offseason' : p === 'playoffs' ? 'playoffs' : 'regular season'
  return (
    <div className="hero">
      <h1 className="hero-title" style={{ marginBottom: 2 }}>THE SHOW</h1>
      <div style={{ fontSize: 13, letterSpacing: 4, textTransform: 'uppercase', color: 'var(--accent, #f5b301)', fontWeight: 700, marginBottom: 10 }}>
        Franchise Hockey Manager
      </div>
      <p className="hero-sub">
        Generate a league and choose a club. You take over in the summer — the draft,
        free agency and training camp are yours before the puck drops.
      </p>
      {props.resume && (
        <div className="panel" style={{ marginBottom: 'var(--sp-4)', borderColor: 'var(--accent, #f5b301)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <div>
              <div className="muted small">Pick up where you left off</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{props.resume.teamName} · {props.resume.year} <span className="muted" style={{ fontWeight: 500 }}>({phaseLabel(props.resume.phase)})</span></div>
            </div>
            <button className="btn btn-primary btn-lg" autoFocus disabled={props.busy} onClick={props.onResume}>▶ Resume</button>
          </div>
        </div>
      )}
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
            World seed <span className="muted" style={{ fontWeight: 400 }}>— random by default; set one only to replay a specific world</span>
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <input
              id="seed-input"
              className="input"
              type="number"
              style={{ flex: 1 }}
              value={props.seed}
              onChange={(e) => props.setSeed(Number(e.target.value))}
            />
            <button
              type="button"
              className="btn btn-ghost"
              title="Roll a new random world"
              onClick={() => props.setSeed(randomSeed())}
            >
              🎲 Randomize
            </button>
          </div>
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
      {props.busy && (
        <div
          className="panel"
          style={{ padding: '12px 16px', marginBottom: 'var(--sp-3)', fontSize: 14 }}
        >
          ⏳ Simulating the season before your arrival — standings, storylines and a
          draft class are being written. This takes a moment…
        </div>
      )}
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
