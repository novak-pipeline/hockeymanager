/**
 * TeamScreen — EHM-style mega-screen for the Team section.
 *
 * Sub-tabs: Roster | Statistics | Report | Personnel | Practice | Tactics |
 *           Finances | Team Info | History
 *
 * Most tabs are thin wrappers that re-parent existing screens. The Report tab
 * and the Practice tab have new UI built here.
 */
import { useState } from 'react'
import type {
  AgmReportView,
  PracticeView,
  SquadView,
  StaffView,
} from '../../worker/protocol'
import type { PracticeFocus } from '../../worker/protocol'
import { PlayerLink, useNav } from '../components/NavContext'
import type { ScreenId } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { fmtMoney } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'
import { useUserTeamId } from '../components/UserTeamContext'
import { TeamHeader } from '../components/TeamHeader'
import { SquadScreen } from './SquadScreen'
import { TeamStatsScreen } from './TeamStatsScreen'
import { TacticsScreen } from './TacticsScreen'
import { FinancesScreen } from './FinancesScreen'
import { HistoryScreen } from './HistoryScreen'
import { ScheduleScreen } from './ScheduleScreen'
import { PlayerFace } from '../components/PlayerFace'
import { useShellActions } from '../components/ActionsContext'
import { bumpRefresh, toast } from '../components/store'

type TeamTab =
  | 'squad'
  | 'teamStats'
  | 'report'
  | 'personnel'
  | 'practice'
  | 'tactics'
  | 'finances'
  | 'teamInfo'
  | 'teamHistory'

/* ── tier color mapping ── */
const TIER_COLOR: Record<'nhl' | 'reserve' | 'prospect', string> = {
  nhl:     'var(--violet-h)',
  reserve: 'var(--muted)',
  prospect: 'var(--green)',
}

const FOCUS_LABELS: Record<PracticeFocus, string> = {
  balanced:    'Balanced',
  offense:     'Offense',
  defense:     'Defense',
  skating:     'Skating',
  physical:    'Physical',
  goaltending: 'Goaltending',
  recovery:    'Recovery',
}

const FOCUS_DESC: Record<PracticeFocus, string> = {
  balanced:    'Even effort across all skills; moderate growth.',
  offense:     'Shooting, passing, offensive IQ — skaters only.',
  defense:     'Checking, shot blocking, defensive positioning.',
  skating:     'Speed, acceleration, agility and balance work.',
  physical:    'Strength, stamina, checking — higher fatigue.',
  goaltending: 'Reflex, positioning, rebound control — goalies only.',
  recovery:    'Light skate; less growth but fatigue drops instead of rising.',
}

/* ══════════════════════════════════════════════════════════════
   Root component
   ══════════════════════════════════════════════════════════════ */

/** Management-only tabs: hidden when browsing another team. */
const MANAGEMENT_TABS: ReadonlySet<TeamTab> = new Set([
  'report', 'practice', 'tactics', 'finances',
])

export function TeamScreen(props: { tab: TeamTab }): JSX.Element {
  const { tab } = props
  const nav = useNav()
  const userTeamId = useUserTeamId()

  // The viewed team — absent or equal to userTeamId means own club.
  const viewedTeamId = nav.params.teamId ?? userTeamId
  const isOwnTeam = !nav.params.teamId || nav.params.teamId === userTeamId

  // If a management tab is requested while viewing another team, redirect to squad.
  // (This can happen when navigating via TopNav sub-tabs without clearing teamId.)
  const effectiveTab = (!isOwnTeam && MANAGEMENT_TABS.has(tab)) ? 'squad' : tab

  // Render
  const header = (
    <TeamHeader
      viewedTeamId={viewedTeamId}
      userTeamId={userTeamId}
      currentTab={effectiveTab as ScreenId}
    />
  )

  // For own team: full management. For others: only roster/stats/info/history/schedule.
  function body(): JSX.Element {
    if (!isOwnTeam) {
      // Read-only tabs for other teams
      switch (effectiveTab) {
        case 'squad':       return <SquadScreen teamId={viewedTeamId} />
        case 'teamStats':   return <TeamStatsScreen teamId={viewedTeamId} />
        case 'personnel':   return <PersonnelTab teamId={viewedTeamId} />
        case 'teamInfo':    return <TeamInfoTabReadOnly teamId={viewedTeamId} />
        case 'teamHistory': return <HistoryScreen />
        case 'leagueSchedule':
        default:            return <ScheduleScreen teamId={viewedTeamId} />
      }
    }
    // Own team: full management
    switch (effectiveTab) {
      case 'squad':       return <SquadScreen />
      case 'teamStats':   return <TeamStatsScreen teamId={viewedTeamId} />
      case 'report':      return <ReportTab />
      case 'personnel':   return <PersonnelTab teamId={viewedTeamId} />
      case 'practice':    return <PracticeTab />
      case 'tactics':     return <TacticsScreen />
      case 'finances':    return <FinancesScreen />
      case 'teamInfo':    return <TeamInfoTab />
      case 'teamHistory': return <HistoryScreen />
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {header}
      {/* Key by viewedTeamId so changing teams remounts the tab and refetches. */}
      <div key={viewedTeamId} style={{ flex: 1, overflow: 'auto' }}>
        {body()}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   REPORT TAB — AGM depth chart (EHM Team > Report)
   ══════════════════════════════════════════════════════════════ */

function ReportTab(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<AgmReportView>(
    () => client.getReport(),
    (r) => (r.type === 'report' ? r.report : null)
  )

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading AGM report…</Notice>
  if (!data) return <Notice kind="info">No AGM report yet.</Notice>

  const dc = data.depthChart

  return (
    <section className="stack">
      <ScreenHeader title="AGM Report">
        <span className="muted small">
          {data.agmName} · Rating {data.agmRating}{data.agmSpecialty ? ` · ${data.agmSpecialty}` : ''}
        </span>
      </ScreenHeader>

      {/* Five-column depth chart */}
      <Panel title="Depth chart">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--sp-3)' }}>
          <DepthColumn title="Goalies"    players={dc.goalies} />
          <DepthColumn title="Defence"    players={dc.defensemen} />
          <DepthColumn title="Left Wing"  players={dc.leftWings} />
          <DepthColumn title="Centre"     players={dc.centers} />
          <DepthColumn title="Right Wing" players={dc.rightWings} />
        </div>
      </Panel>

      {/* Category bests + Top prospects side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
        <Panel title="Category bests">
          <div className="list">
            {data.categoryBests.map((cb) => (
              <div key={cb.category} className="row-between small">
                <span className="muted" style={{ minWidth: 120 }}>{cb.category}</span>
                <PlayerLink playerId={cb.playerId} name={cb.playerName} />
              </div>
            ))}
            {data.categoryBests.length === 0 && (
              <span className="muted small">No data yet.</span>
            )}
          </div>
        </Panel>

        <Panel title="Top prospects (U23)">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Pos</th>
                  <th className="num">Age</th>
                  <th className="num">OVR</th>
                  <th className="num">POT</th>
                </tr>
              </thead>
              <tbody>
                {data.topProspects.map((p) => (
                  <tr key={p.playerId}>
                    <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
                    <td className="num muted">{p.position}</td>
                    <td className="num">{p.age}</td>
                    <td className="num">
                      <span style={{ color: TIER_COLOR[p.tier] }}>{p.judgedOverall}</span>
                    </td>
                    <td className="num muted">{p.judgedPotential}</td>
                  </tr>
                ))}
                {data.topProspects.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">No prospects ranked.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </section>
  )
}

function DepthColumn(props: {
  title: string
  players: AgmReportView['depthChart']['goalies']
}): JSX.Element {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          color: 'var(--muted)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        {props.title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {props.players.map((p) => (
          <div
            key={p.playerId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 6px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg2)',
              borderLeft: `3px solid ${TIER_COLOR[p.tier]}`,
            }}
          >
            <PlayerLink
              playerId={p.playerId}
              name={p.name}
              className="small"
            />
            <span
              className="mono small"
              style={{ marginLeft: 'auto', color: TIER_COLOR[p.tier] }}
            >
              {p.judgedOverall}
            </span>
          </div>
        ))}
        {props.players.length === 0 && (
          <span className="muted small">—</span>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   PERSONNEL TAB — full staff listing with photos
   ══════════════════════════════════════════════════════════════ */

const DEMEANOR_COLOR: Record<string, string> = {
  Analytical: 'var(--violet-h)',
  Fiery:      'var(--danger)',
  Calm:       'var(--muted)',
  Motivator:  'var(--green)',
  Pragmatic:  'var(--amber, #f59e0b)',
}

function StaffSection(props: {
  title: string
  members: StaffView['scouts'] // StaffRowView[]
}): JSX.Element {
  if (props.members.length === 0) return <></>
  return (
    <Panel title={props.title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {props.members.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-3)',
              padding: 'var(--sp-2) 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <PlayerFace faceId={m.faceId} name={m.name} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
              <div className="muted small">{m.roleLabel}{m.specialty ? ` · ${m.specialty}` : ''}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
              <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                <span className="small muted">Rating</span>
                <span className="mono small" style={{ color: 'var(--fg)' }}>{m.rating}</span>
                <span className="small muted">Judgment</span>
                <span className="mono small" style={{ color: 'var(--fg)' }}>{m.judgment}</span>
              </div>
              {m.demeanorLabel && (
                <span
                  className="chip"
                  style={{
                    fontSize: 10,
                    color: DEMEANOR_COLOR[m.demeanorLabel] ?? 'var(--muted)',
                    background: 'var(--bg3)',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {m.demeanorLabel}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function PersonnelTab(props: { teamId: string }): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<StaffView>(
    () => client.getTeamStaff(props.teamId),
    (r) => (r.type === 'teamStaff' ? r.staff : null)
  )

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading personnel…</Notice>
  if (!data) return <Notice kind="info">No personnel data.</Notice>

  return (
    <section className="stack">
      <ScreenHeader title="Personnel">
        <span className="muted small">{data.teamName}</span>
      </ScreenHeader>

      <StaffSection title="Head Coach" members={[data.headCoach]} />
      <StaffSection title="Assistant Coaches" members={data.assistantCoaches} />
      <StaffSection title="Assistant General Manager" members={[data.assistantGM]} />
      <StaffSection title="Scouts" members={data.scouts} />
      <StaffSection title="Physios" members={data.physios} />
      <StaffSection title="Owner" members={[data.owner]} />
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════
   PRACTICE TAB — focus picker + per-player overrides + scratches
   ══════════════════════════════════════════════════════════════ */

function PracticeTab(): JSX.Element {
  const client = useClient()
  const actions = useShellActions()
  const { data, loading, error } = useScreenData<PracticeView>(
    () => client.getPractice(),
    (r) => (r.type === 'practice' ? r.practice : null)
  )

  const [savingFocus, setSavingFocus] = useState(false)

  async function setFocus(focus: PracticeFocus): Promise<void> {
    if (!data || savingFocus || actions.busy) return
    setSavingFocus(true)
    const newState = { ...data.state, teamFocus: focus }
    const res = await client.setPractice(newState)
    setSavingFocus(false)
    if (res.type === 'error') {
      toast(res.message, 'error')
    } else {
      bumpRefresh()
    }
  }

  async function toggleScratch(playerId: string): Promise<void> {
    if (actions.busy) return
    const res = await client.toggleScratch(playerId)
    if (res.type === 'error') {
      toast(res.message, 'error')
    } else {
      bumpRefresh()
    }
  }

  const { data: squad } = useScreenData<SquadView>(
    () => client.getSquad(),
    (r) => (r.type === 'squad' ? r.squad : null)
  )

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading practice…</Notice>
  if (!data) return <Notice kind="info">No practice data yet.</Notice>

  const currentFocus = data.state.teamFocus
  const scratchedSet = new Set(data.state.scratched)

  return (
    <section className="stack">
      <ScreenHeader title="Practice" />

      {/* Suggestion */}
      <Panel title="Coaching suggestion">
        <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <div>
            <div className="muted small">Recommended focus</div>
            <div style={{ fontWeight: 700, color: 'var(--violet-h)', marginTop: 2 }}>
              {FOCUS_LABELS[data.suggestion.teamFocus]}
            </div>
          </div>
          <div style={{ flex: 1, color: 'var(--muted)', fontSize: 13 }}>
            {data.suggestion.rationale}
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={savingFocus || currentFocus === data.suggestion.teamFocus}
            onClick={() => void setFocus(data.suggestion.teamFocus)}
          >
            Apply
          </button>
        </div>
      </Panel>

      {/* Focus picker */}
      <Panel title="Team focus">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          {(Object.keys(FOCUS_LABELS) as PracticeFocus[]).map((focus) => (
            <button
              key={focus}
              className={`btn btn-sm${currentFocus === focus ? ' btn-primary' : ''}`}
              onClick={() => void setFocus(focus)}
              disabled={savingFocus}
              title={FOCUS_DESC[focus]}
            >
              {FOCUS_LABELS[focus]}
            </button>
          ))}
        </div>
        <div className="muted small" style={{ marginTop: 'var(--sp-3)' }}>
          {FOCUS_DESC[currentFocus]}
        </div>
      </Panel>

      {/* Roster dress/scratch */}
      {squad && (
        <Panel title={`Lineup — ${squad.dressedCount} dressed / ${squad.rosterCount} on roster`}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Pos</th>
                  <th className="num">OVR</th>
                  <th className="num">Cond</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {squad.rows.map((row) => {
                  const scratched = scratchedSet.has(row.playerId)
                  return (
                    <tr key={row.playerId} style={{ opacity: scratched ? 0.6 : undefined }}>
                      <td><PlayerLink playerId={row.playerId} name={row.name} /></td>
                      <td className="num muted">{row.position}</td>
                      <td className="num">{row.overall}</td>
                      <td className="num">{row.condition}</td>
                      <td>
                        <button
                          className={`btn btn-sm${scratched ? ' btn-danger' : ' btn-ghost'}`}
                          onClick={() => void toggleScratch(row.playerId)}
                          disabled={actions.busy}
                          title={scratched ? 'Click to dress' : 'Click to scratch'}
                        >
                          {scratched ? 'Scratched' : 'Dressed'}
                        </button>
                        {row.injury && (
                          <span className="chip chip-danger" style={{ marginLeft: 6, fontSize: 10 }}>
                            Injured
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════
   TEAM INFO TAB — club facts
   ══════════════════════════════════════════════════════════════ */

function TeamInfoTab(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<SquadView>(
    () => client.getSquad(),
    (r) => (r.type === 'squad' ? r.squad : null)
  )
  const { data: finances } = useScreenData(
    () => client.getFinances(),
    (r) => (r.type === 'finances' ? r.finances : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="Team Info" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No team data."
      />
      {data && (
        <Panel title={data.teamName}>
          <div className="list">
            <div className="row-between small">
              <span className="muted">Roster players</span>
              <strong>{data.rosterCount}</strong>
            </div>
            <div className="row-between small">
              <span className="muted">Dressed players</span>
              <strong>{data.dressedCount}</strong>
            </div>
          </div>
        </Panel>
      )}
      {finances && (
        <Panel title="Finances">
          <div className="list">
            <div className="row-between small">
              <span className="muted">Salary cap</span>
              <strong>{fmtMoney(finances.salaryCap)}</strong>
            </div>
            <div className="row-between small">
              <span className="muted">Cap used</span>
              <strong>{fmtMoney(finances.capUsed)}</strong>
            </div>
            <div className="row-between small">
              <span className="muted">Cap space</span>
              <strong style={{ color: finances.capSpace < 0 ? 'var(--danger)' : 'var(--success)' }}>
                {fmtMoney(finances.capSpace)}
              </strong>
            </div>
          </div>
        </Panel>
      )}
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════
   TEAM INFO (READ-ONLY) — for browsing other teams
   ══════════════════════════════════════════════════════════════ */

function TeamInfoTabReadOnly(props: { teamId: string }): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<SquadView>(
    () => client.getTeamSquad(props.teamId),
    (r) => (r.type === 'squad' ? r.squad : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="Team Info" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No team data."
      />
      {data && (
        <Panel title={data.teamName}>
          <div className="list">
            <div className="row-between small">
              <span className="muted">Roster players</span>
              <strong>{data.rosterCount}</strong>
            </div>
            <div className="row-between small">
              <span className="muted">Dressed players</span>
              <strong>{data.dressedCount}</strong>
            </div>
          </div>
        </Panel>
      )}
    </section>
  )
}
