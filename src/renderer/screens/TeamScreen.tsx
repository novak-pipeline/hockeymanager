/**
 * TeamScreen — EHM-style mega-screen for the Team section.
 *
 * Sub-tabs: Roster | Statistics | Report | Personnel | Practice | Tactics |
 *           Finances | Team Info | History
 *
 * Most tabs are thin wrappers that re-parent existing screens. The Report tab
 * and the Practice tab have new UI built here.
 */
import { useMemo, useState } from 'react'
import { overallToStars } from '../../engine/ratings/composites'
import type {
  AgmReportView,
  ClubInfoView,
  PracticePlanView,
  PracticeView,
  SquadView,
  StaffView,
} from '../../worker/protocol'
import type { PracticeFocus } from '../../worker/protocol'
import type { AgmRankedPlayerView, SquadRowView } from '../../engine/career/views'
import { PlayerLink, useNav } from '../components/NavContext'
import type { ScreenId } from '../components/NavContext'
import { OverallStars } from '../components/Stars'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { fmtMoney } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'
import { useUserTeamId } from '../components/UserTeamContext'
import { TeamHeader } from '../components/TeamHeader'
import { SquadScreen } from './SquadScreen'
import { LeagueStatsTableScreen } from './LeagueStatsTableScreen'
import { TeamDataHubBody } from './DataHubScreen'
import { DynamicsScreen } from './DynamicsScreen'
import { MedicalScreen } from './MedicalScreen'
import { DevelopmentScreen } from './DevelopmentScreen'
import { SquadPlannerScreen } from './SquadPlannerScreen'
import { TacticsScreen } from './TacticsScreen'
import { FinancesScreen } from './FinancesScreen'
import { HistoryScreen } from './HistoryScreen'
import { ScheduleScreen } from './ScheduleScreen'
import { PlayerFace } from '../components/PlayerFace'
import { useShellActions } from '../components/ActionsContext'
import { bumpRefresh, toast } from '../components/store'
import { ThemeScope, useTeamColors } from '../components/ThemeScope'
import { SortHeaders, sortColumns, useTableSort } from '../components/sortable'

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
  | 'teamDataHub'
  | 'teamDynamics'
  | 'teamMedical'
  | 'teamDevelopment'
  | 'teamPlanner'

/* ── tier color mapping ── */
const TIER_COLOR: Record<'nhl' | 'reserve' | 'prospect', string> = {
  nhl:     'var(--violet-h)',
  reserve: 'var(--muted)',
  prospect: 'var(--green)',
}

/** Where a player sits in the org → colour + short tag. NHL / AHL / elsewhere. */
function locationStyle(location?: string): { color: string; tag: string } {
  const loc = (location ?? 'NHL').toUpperCase()
  if (loc === 'NHL') return { color: 'var(--violet-h)', tag: 'NHL' }
  if (loc === 'AHL') return { color: 'var(--green, #22c55e)', tag: 'AHL' }
  return { color: 'var(--amber, #f59e0b)', tag: loc.slice(0, 3) }
}

/** Fog-friendly star string from a 0–99 judged rating (no raw numbers shown),
 *  on the canonical NHL-calibrated star scale. */
function starStr(judged0to99: number): string {
  const n = Math.max(1, Math.min(5, Math.round(overallToStars(judged0to99))))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
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

/** Raw-attribute key → readable label (e.g. "wristShot" → "Wrist Shot"). */
function attrLabel(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').replace(/\bG\b/, '').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const COACH_TIER_COLOR: Record<PracticePlanView['coachTier'], string> = {
  elite:    'var(--success, #4caf7d)',
  strong:   'var(--success, #4caf7d)',
  adequate: 'var(--amber, #d6a056)',
  weak:     'var(--danger, #e0575b)',
}

/** #170: the effect preview — what the active focus actually does to development
 *  and fatigue, so the choice is a visible tradeoff rather than a blind toggle. */
function PracticePlanPanel({ plan }: { plan: PracticePlanView }): JSX.Element {
  const fatigueUp = plan.fatiguePerWeek > 0
  return (
    <Panel title="What this focus does">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--sp-3)' }}>
        {/* Development gains */}
        <div>
          <div className="muted small" style={{ marginBottom: 6 }}>Sharpens (per dev pass)</div>
          {plan.targeted.length === 0 ? (
            <div className="muted small">
              {plan.focus === 'recovery'
                ? 'Nothing — recovery trades development for fresh legs.'
                : 'Even, balanced development across the board.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {plan.targeted.map((t) => (
                <span
                  key={t.attr}
                  className="chip"
                  style={{ fontSize: 11, background: 'rgba(76,175,125,0.12)', color: 'var(--success, #4caf7d)' }}
                >
                  {attrLabel(t.attr)} +{t.boost}%
                </span>
              ))}
            </div>
          )}
          {plan.opportunityCostPct > 0 && (
            <div className="muted small" style={{ marginTop: 6 }}>
              Everything else develops ~{plan.opportunityCostPct}% slower — the cost of specialising.
            </div>
          )}
        </div>

        {/* Coach effectiveness */}
        <div>
          <div className="muted small" style={{ marginBottom: 6 }}>Coach delivery</div>
          <div style={{ fontWeight: 700, color: COACH_TIER_COLOR[plan.coachTier], textTransform: 'capitalize' }}>
            {plan.coachTier} · {plan.coachMult}%
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            {plan.coachName} {plan.coachMult >= 100 ? 'amplifies' : 'blunts'} how well this focus lands.
          </div>
        </div>

        {/* Fatigue tradeoff */}
        <div>
          <div className="muted small" style={{ marginBottom: 6 }}>Fatigue / week</div>
          <div style={{ fontWeight: 700, color: fatigueUp ? 'var(--amber, #d6a056)' : 'var(--success, #4caf7d)' }}>
            {fatigueUp ? '+' : ''}{plan.fatiguePerWeek} {fatigueUp ? '· heavier legs' : '· fresher'}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            {fatigueUp
              ? 'Harder practices tire the roster for game nights.'
              : 'Lighter load keeps the team fresh for the games that count.'}
          </div>
        </div>

        {/* #154: who the regimen actually reaches. The lever audit found the
            focus pointed only at the NHL club — the group with the least room
            left to grow — so who it covers is now part of the receipt. */}
        {plan.reach && (
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>Who it reaches</div>
            <div style={{ fontWeight: 700 }}>
              {plan.reach.developing} developing{' '}
              <span className="muted" style={{ fontWeight: 400 }}>of {plan.reach.players}</span>
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>
              {plan.reach.label} — those {plan.reach.developing} have{' '}
              <strong>{plan.reach.headroom.toFixed(1)}</strong> rating points left to their ceiling on
              average. Training only moves players with room to grow.
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ══════════════════════════════════════════════════════════════
   Root component
   ══════════════════════════════════════════════════════════════ */

/** Management-only tabs: hidden when browsing another team. */
const MANAGEMENT_TABS: ReadonlySet<TeamTab> = new Set([
  'report', 'practice', 'tactics', 'finances', 'teamMedical', 'teamDevelopment', 'teamPlanner',
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

  // Resolve the viewed team's colors for scoped accent tinting.
  const teamColors = useTeamColors(viewedTeamId)

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
        case 'teamStats':   return <LeagueStatsTableScreen teamId={viewedTeamId} />
        case 'teamDataHub': return <TeamDataHubBody teamId={viewedTeamId} />
        case 'teamDynamics': return <DynamicsScreen teamId={viewedTeamId} />
        case 'personnel':   return <PersonnelTab teamId={viewedTeamId} />
        case 'teamInfo':    return <TeamInfoTabReadOnly teamId={viewedTeamId} />
        case 'teamHistory': return <TeamHistoryTab teamId={viewedTeamId} />
        case 'leagueSchedule':
        default:            return <ScheduleScreen teamId={viewedTeamId} />
      }
    }
    // Own team: full management
    switch (effectiveTab) {
      case 'squad':       return <SquadScreen />
      case 'teamStats':   return <LeagueStatsTableScreen teamId={viewedTeamId} />
      case 'teamDataHub': return <TeamDataHubBody teamId={viewedTeamId} />
      case 'teamDynamics': return <DynamicsScreen teamId={viewedTeamId} />
      case 'teamMedical': return <MedicalScreen />
      case 'teamDevelopment': return <DevelopmentScreen />
      case 'teamPlanner': return <SquadPlannerScreen />
      case 'report':      return <ReportTab />
      case 'personnel':   return <PersonnelTab teamId={viewedTeamId} />
      case 'practice':    return <PracticeTab />
      case 'tactics':     return <TacticsScreen />
      case 'finances':    return <FinancesScreen />
      case 'teamInfo':    return <TeamInfoTab />
      case 'teamHistory': return <HistoryScreen />
      default:            return <SquadScreen />
    }
  }

  return (
    <ThemeScope
      colors={teamColors}
      className="team-scope"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {header}
      {/* Key by viewedTeamId so changing teams remounts the tab and refetches. */}
      <div key={viewedTeamId} style={{ flex: 1, overflow: 'auto' }}>
        {body()}
      </div>
    </ThemeScope>
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
        <div className="row" style={{ gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)', fontSize: 11 }}>
          <span className="muted">Where based:</span>
          {(['NHL', 'AHL', 'Junior/Other'] as const).map((l) => {
            const s = locationStyle(l === 'Junior/Other' ? 'WHL' : l)
            return (
              <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                <span className="muted">{l}</span>
              </span>
            )
          })}
        </div>
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
              <span className="muted small">No club records set yet — they start accruing once games are played.</span>
            )}
          </div>
        </Panel>

        <Panel title="Top Prospects (by scout value)">
          <TopProspectsTable rows={data.topProspects} />
        </Panel>
      </div>
    </section>
  )
}

/** Board place travels with the row so "#" survives a re-sort. */
type RankedProspectRow = AgmRankedPlayerView & { rank: number }

const TOP_PROSPECT_COLS = sortColumns<RankedProspectRow>()([
  { key: 'rank', label: '#', value: (p) => p.rank, initialDir: 'asc', align: 'right', title: "Your scouts' ranking" },
  { key: 'name', label: 'Player', value: (p) => p.name },
  { key: 'position', label: 'Pos', value: (p) => p.position, align: 'right' },
  { key: 'age', label: 'Age', value: (p) => p.age, align: 'right', initialDir: 'asc' },
  { key: 'location', label: 'Based', value: (p) => p.location ?? null },
  { key: 'judgedOverall', label: 'OVR', value: (p) => p.judgedOverall, align: 'right' },
  { key: 'judgedPotential', label: 'POT', value: (p) => p.judgedPotential, align: 'right' },
])

function TopProspectsTable(props: { rows: AgmRankedPlayerView[] }): JSX.Element {
  const ranked = useMemo<RankedProspectRow[]>(
    () => props.rows.map((p, i) => ({ ...p, rank: i + 1 })),
    [props.rows],
  )
  const { sorted, sortKey, dir, sortBy } = useTableSort(ranked, TOP_PROSPECT_COLS, { key: null })
  return (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortHeaders columns={TOP_PROSPECT_COLS} sortKey={sortKey} dir={dir} onSort={sortBy} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const loc = locationStyle(p.location)
                  return (
                  <tr key={p.playerId}>
                    <td className="num muted">{p.rank}</td>
                    <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
                    <td className="num muted">{p.position}</td>
                    <td className="num">{p.age}</td>
                    <td><span style={{ fontSize: 10, fontWeight: 800, color: loc.color }}>{loc.tag}</span></td>
                    <td className="num">
                      <span style={{ color: TIER_COLOR[p.tier], letterSpacing: -1 }}>{starStr(p.judgedOverall)}</span>
                    </td>
                    <td className="num muted" style={{ letterSpacing: -1 }}>{starStr(p.judgedPotential)}</td>
                  </tr>
                  )
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">No prospects ranked.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
        {props.players.map((p) => {
          const loc = locationStyle(p.location)
          return (
          <div
            key={p.playerId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 6px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg2)',
              borderLeft: `3px solid ${loc.color}`,
            }}
          >
            <span
              title={`Based: ${loc.tag}`}
              style={{ fontSize: 8, fontWeight: 800, color: loc.color, width: 22, flexShrink: 0 }}
            >
              {loc.tag}
            </span>
            <PlayerLink
              playerId={p.playerId}
              name={p.name}
              className="small"
            />
            <span
              className="small"
              style={{ marginLeft: 'auto', color: 'var(--muted)', letterSpacing: -1 }}
              title="Scouted projection"
            >
              {starStr(p.judgedOverall)}
            </span>
          </div>
          )
        })}
        {props.players.length === 0 && (
          <span className="muted small">—</span>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   HISTORY TAB — club legends ("where are they now") + season history
   ══════════════════════════════════════════════════════════════ */

function TeamHistoryTab(props: { teamId: string }): JSX.Element {
  const client = useClient()
  const { data } = useScreenData(
    () => client.getTeamLegends(props.teamId),
    (r) => (r.type === 'teamLegends' ? r.legends : null)
  )

  return (
    <section className="stack">
      {data && data.legends.length > 0 && (
        <Panel title="Club Legends">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {data.legends.map((l) => (
              <div
                key={l.playerId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-3)',
                  padding: 'var(--sp-2) 0',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <PlayerFace faceId={l.faceId} name={l.name} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    <PlayerLink playerId={l.playerId} name={l.name} /> <span className="muted small">({l.position})</span>
                  </div>
                  <div className="muted small">{l.blurb}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div title="Peak ability"><OverallStars value={l.peakOverall} /></div>
                  <div className="muted small">Retired {l.retiredYear}</div>
                  <div className="small" style={{ color: l.status === 'Retired' ? 'var(--muted)' : 'var(--success)' }}>{l.status}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <HistoryScreen />
    </section>
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

/* Staff attribute groups (EHM 1–20), shown when a staff member is expanded. */
const STAFF_ATTR_GROUPS: Array<{ title: string; attrs: Array<[keyof NonNullable<StaffView['scouts'][number]['attributes']>, string]> }> = [
  { title: 'Coaching', attrs: [['coachingForwards', 'Forwards'], ['coachingDefensemen', 'Defensemen'], ['coachingGoaltenders', 'Goaltenders'], ['coachingTechnique', 'Technique'], ['attacking', 'Attacking'], ['physical', 'Physical'], ['powerplay', 'Power Play'], ['penaltyKill', 'Penalty Kill'], ['tactics', 'Tactics'], ['lineMatching', 'Line Matching'], ['freeRoles', 'Free Roles'], ['directness', 'Directness']] },
  { title: 'Evaluation', attrs: [['judgingPlayers', 'Judging Players'], ['judgingPotential', 'Judging Potential']] },
  { title: 'Management', attrs: [['manManagement', 'Man Management'], ['motivating', 'Motivating'], ['discipline', 'Discipline'], ['developingYoungsters', 'Developing Youngsters']] },
  { title: 'Medical & Business', attrs: [['physiotherapy', 'Physiotherapy'], ['business', 'Business'], ['patience', 'Patience'], ['resources', 'Resources']] },
]

function staffAttrColor(v: number): string {
  if (v >= 17) return 'var(--success)'
  if (v >= 14) return 'rgba(52,211,153,0.85)'
  if (v >= 8) return 'var(--accent2)'
  return 'var(--danger)'
}

/* ── §D4: the staff room, not one giant list ───────────────────────────────
 *
 * Playtest 2026-08-26 §D4: *"the Staff tab is one giant list."* It was six
 * stacked panels of identical grey rows: the head coach — the single most
 * consequential hire a GM makes — rendered exactly like the fourth scout, and
 * nothing could be compared across departments because nothing could be sorted.
 *
 * The rebuild separates the two questions a GM actually asks here. "Who runs my
 * club?" is answered by three cards at the top (coach, AGM, owner) that read as
 * people. "Who is any good?" is answered by one sortable, filterable table of
 * everybody else, where ability and judgment are columns you can order by and
 * a click still opens the full EHM attribute sheet.
 */

/** A staff member plus the department heading he files under. */
type DeptStaffRow = StaffView['scouts'][number] & { dept: string }

const STAFF_TABLE_COLS = sortColumns<DeptStaffRow>()([
  { key: 'name', label: 'Name', value: (m) => m.name },
  { key: 'dept', label: 'Department', value: (m) => m.dept },
  { key: 'role', label: 'Role', value: (m) => m.roleLabel },
  { key: 'specialty', label: 'Specialty', value: (m) => m.specialty ?? null },
  { key: 'demeanor', label: 'Demeanour', value: (m) => m.demeanorLabel ?? null },
  { key: 'rating', label: 'Ability', value: (m) => m.rating, align: 'right' },
  { key: 'judgment', label: 'Judgment', value: (m) => m.judgment, align: 'right', title: 'How well he reads a player' },
])

const STAFF_FILTERS = ['All', 'Coaches', 'Scouts', 'Medical'] as const
type StaffFilter = (typeof STAFF_FILTERS)[number]

/** One of the three men whose individual quality shapes the whole club. */
function KeyStaffCard({ m, role }: { m: StaffView['scouts'][number]; role: string }): JSX.Element {
  const attrs = m.attributes
  // The three attributes he's actually best at — what he's FOR, at a glance.
  const best = Object.entries(attrs ?? {})
    .filter((e): e is [string, number] => typeof e[1] === 'number')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  const labelOf = (key: string): string =>
    STAFF_ATTR_GROUPS.flatMap((g) => g.attrs).find(([k]) => k === key)?.[1] ?? key
  return (
    <div
      style={{
        flex: '1 1 240px', minWidth: 0, display: 'flex', gap: 'var(--sp-3)',
        padding: 'var(--sp-3)', background: 'var(--bg2)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <PlayerFace faceId={m.faceId} name={m.name} size={52} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' }}>{role}</div>
        <div style={{ fontWeight: 700, fontSize: 15, marginTop: 1 }}>{m.name}</div>
        <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          {m.demeanorLabel && (
            <span className="chip" style={{ fontSize: 10, color: DEMEANOR_COLOR[m.demeanorLabel] ?? 'var(--muted)' }}>
              {m.demeanorLabel}
            </span>
          )}
          {m.specialty && <span className="chip" style={{ fontSize: 10 }}>{m.specialty}</span>}
        </div>
        {best.length > 0 && (
          <div className="muted small" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Best at:{' '}
            {best.map(([k, v], i) => (
              <span key={k}>
                {i > 0 && ' · '}
                <span style={{ color: staffAttrColor(v) }}>{labelOf(k)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PersonnelTab(props: { teamId: string }): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<StaffView>(
    () => client.getTeamStaff(props.teamId),
    (r) => (r.type === 'teamStaff' ? r.staff : null)
  )
  const [filter, setFilter] = useState<StaffFilter>('All')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  // Everyone who isn't one of the three headline hires, tagged by department.
  const staff = useMemo<DeptStaffRow[]>(() => {
    if (!data) return EMPTY_STAFF
    return [
      ...data.assistantCoaches.map((m) => ({ ...m, dept: 'Coaches' })),
      ...data.scouts.map((m) => ({ ...m, dept: 'Scouts' })),
      ...data.physios.map((m) => ({ ...m, dept: 'Medical' })),
    ]
  }, [data])

  const filtered = useMemo(
    () => staff.filter((m) =>
      (filter === 'All' || m.dept === filter) &&
      (search === '' || m.name.toLowerCase().includes(search.toLowerCase()))),
    [staff, filter, search],
  )
  const { sorted, sortKey, dir, sortBy } = useTableSort(filtered, STAFF_TABLE_COLS, { key: 'rating' })

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading personnel…</Notice>
  if (!data) return <Notice kind="info">No personnel data.</Notice>

  const countIn = (f: StaffFilter): number => (f === 'All' ? staff.length : staff.filter((m) => m.dept === f).length)

  return (
    <section className="stack">
      <ScreenHeader title="Personnel">
        <span className="muted small">{data.teamName} · {staff.length + 3} on the payroll</span>
      </ScreenHeader>

      <Panel title="Who runs the club">
        <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'stretch' }}>
          <KeyStaffCard m={data.headCoach} role="Head Coach" />
          <KeyStaffCard m={data.assistantGM} role="Assistant General Manager" />
          <KeyStaffCard m={data.owner} role="Owner" />
        </div>
      </Panel>

      <Panel title="The rest of the staff">
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
          {STAFF_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`chip${filter === f ? ' chip-accent' : ''}`}
              style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
              onClick={() => setFilter(f)}
            >
              {f} ({countIn(f)})
            </button>
          ))}
          <input
            className="input"
            placeholder="Search name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginLeft: 'auto', width: 170, padding: '4px 10px', fontSize: 12 }}
          />
        </div>
        {sorted.length === 0 ? (
          <span className="muted small">Nobody on the books matches that.</span>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortHeaders columns={STAFF_TABLE_COLS} sortKey={sortKey} dir={dir} onSort={sortBy} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <StaffTableRow
                    key={m.id}
                    m={m}
                    open={openId === m.id}
                    onToggle={() => setOpenId((id) => (id === m.id ? null : m.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  )
}

/** Stable identity so the sort hook is not handed a new array each render. */
const EMPTY_STAFF: DeptStaffRow[] = []

/** One staff row; clicking opens his full EHM attribute sheet underneath. */
function StaffTableRow({ m, open, onToggle }: { m: DeptStaffRow; open: boolean; onToggle: () => void }): JSX.Element {
  const attrs = m.attributes
  const hasAttrs = !!attrs && Object.keys(attrs).length > 0
  // A1: a prose sketch expands with the attribute sheet — the numbers say what
  // he scores, the sketch says what he is like to work with.
  const bio = m.biography
  const hasBio = bio !== undefined && bio.length > 0
  const hasDetail = hasAttrs || hasBio
  return (
    <>
      <tr
        onClick={hasDetail ? onToggle : undefined}
        style={{ cursor: hasDetail ? 'pointer' : undefined }}
        title={hasDetail ? 'Open his full attribute sheet' : undefined}
      >
        <td>
          <span className="row" style={{ gap: 8, alignItems: 'center' }}>
            <PlayerFace faceId={m.faceId} name={m.name} size={26} />
            <span style={{ fontWeight: 600 }}>{m.name}</span>
            {hasDetail && <span className="muted" style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>}
          </span>
        </td>
        <td className="muted small">{m.dept}</td>
        <td className="small">{m.roleLabel}</td>
        <td className="muted small">{m.specialty ?? '—'}</td>
        <td>
          {m.demeanorLabel
            ? <span className="chip" style={{ fontSize: 10, color: DEMEANOR_COLOR[m.demeanorLabel] ?? 'var(--muted)' }}>{m.demeanorLabel}</span>
            : <span className="muted small">—</span>}
        </td>
        <td className="num" style={{ fontWeight: 700 }}>{m.rating}</td>
        <td className="num muted">{m.judgment}</td>
      </tr>
      {open && hasDetail && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--bg0)' }}>
            {hasBio && (
              <div className="stack" style={{ gap: 8, padding: 'var(--sp-2) 0', maxWidth: 760 }}>
                {bio!.map((para, i) => (
                  <p key={i} style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: 'var(--text)' }}>{para}</p>
                ))}
              </div>
            )}
            {hasAttrs && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-3)', padding: 'var(--sp-2) 0' }}>
              {STAFF_ATTR_GROUPS.map((g) => {
                const rows = g.attrs.filter(([k]) => attrs![k] !== undefined)
                if (rows.length === 0) return null
                return (
                  <div key={g.title}>
                    <div className="pp-attr-head">{g.title}</div>
                    {rows.map(([k, label]) => (
                      <div key={k} className="pp-attr-row">
                        <span className="pp-attr-name">{label}</span>
                        <span className="pp-attr-val" style={{ color: staffAttrColor(attrs![k]!) }}>{attrs![k]}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

/* ══════════════════════════════════════════════════════════════
   PRACTICE TAB — focus picker + per-player overrides + scratches
   ══════════════════════════════════════════════════════════════ */

const LINEUP_COLS = sortColumns<SquadRowView>()([
  { key: 'name', label: 'Player', value: (r) => r.name },
  { key: 'position', label: 'Pos', value: (r) => r.position, align: 'right' },
  { key: 'overall', label: 'OVR', value: (r) => r.overall, align: 'right' },
  { key: 'condition', label: 'Cond', value: (r) => r.condition, align: 'right', initialDir: 'asc', title: 'Freshness — the tired men first' },
  { key: 'status', label: 'Status' },
])

/** Stable identity so the sort hook is not handed a new array each render. */
const EMPTY_SQUAD_ROWS: SquadRowView[] = []

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

  async function recommendIndividual(): Promise<void> {
    if (savingFocus || actions.busy) return
    setSavingFocus(true)
    const res = await client.recommendPlayerFocuses()
    setSavingFocus(false)
    if (res.type === 'error') toast(res.message, 'error')
    else {
      if (res.type === 'ok' && res.note) toast(res.note, 'success')
      bumpRefresh()
    }
  }

  const { data: squad } = useScreenData<SquadView>(
    () => client.getSquad(),
    (r) => (r.type === 'squad' ? r.squad : null)
  )
  const lineupSort = useTableSort(squad?.rows ?? EMPTY_SQUAD_ROWS, LINEUP_COLS, { key: null })

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
        <div className="row" style={{ marginTop: 'var(--sp-3)', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <div style={{ flex: 1, color: 'var(--muted)', fontSize: 13 }}>
            Or target each player individually — assign every skater a drill for his weakest area (goalies → goaltending).
          </div>
          <button className="btn btn-sm" disabled={savingFocus} onClick={() => void recommendIndividual()}>
            Recommend individual focuses
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

      {/* #170 Effect preview — the tradeoff, made visible */}
      {data.plan && <PracticePlanPanel plan={data.plan} />}

      {/* Roster dress/scratch */}
      {squad && (
        <Panel title={`Lineup — ${squad.dressedCount} dressed / ${squad.rosterCount} on roster`}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortHeaders columns={LINEUP_COLS} sortKey={lineupSort.sortKey} dir={lineupSort.dir} onSort={lineupSort.sortBy} />
                </tr>
              </thead>
              <tbody>
                {lineupSort.sorted.map((row) => {
                  const scratched = scratchedSet.has(row.playerId)
                  return (
                    <tr key={row.playerId} style={{ opacity: scratched ? 0.6 : undefined }}>
                      <td><PlayerLink playerId={row.playerId} name={row.name} /></td>
                      <td className="num muted">{row.position}</td>
                      <td className="num"><OverallStars value={row.overall} /></td>
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
  const nav = useNav()
  const { data: club, loading, error } = useScreenData<ClubInfoView>(
    () => client.getClubInfo(),
    (r) => (r.type === 'clubInfo' ? r.clubInfo : null)
  )
  const { data: finances } = useScreenData(
    () => client.getFinances(),
    (r) => (r.type === 'finances' ? r.finances : null)
  )

  const ordinal = (n: number): string => {
    if (n <= 0) return '—'
    const s = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!)
  }
  // Never surface the raw mandate enum ("developYouth") — map to a readable
  // label, falling back to de-camelCasing any unknown code.
  const humanizeMandate = (m: string): string => {
    const LABELS: Record<string, string> = {
      cupOrBust: 'Win the Cup', contend: 'Contend', makePlayoffs: 'Make the playoffs',
      competeRespectably: 'Compete respectably', developYouth: 'Develop the youth',
      rebuild: 'Rebuild', cutCosts: 'Cut costs',
    }
    return LABELS[m] ?? m.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  }

  return (
    <section className="stack">
      <ScreenHeader title="Club Info" />
      <ScreenStateNotices
        loading={loading && !club}
        error={error}
        empty={!loading && !error && !club}
        emptyText="No club data."
      />
      {club && (
        <>
          <Panel title={club.name}>
            <div className="list">
              <div className="row-between small"><span className="muted">City</span><strong>{club.city}</strong></div>
              <div className="row-between small"><span className="muted">Conference</span><strong>{club.conferenceName}</strong></div>
              <div className="row-between small"><span className="muted">Division</span><strong>{club.divisionName}</strong></div>
              <div className="row-between small"><span className="muted">League position</span><strong>{ordinal(club.leagueRank)}</strong></div>
              <div className="row-between small"><span className="muted">Division position</span><strong>{ordinal(club.divisionRank)}</strong></div>
              <div className="row-between small">
                <span className="muted">Record</span>
                <strong>{club.record.wins}–{club.record.losses}–{club.record.overtimeLosses} · {club.record.points} pts</strong>
              </div>
            </div>
          </Panel>

          {(club.arena || (club.retiredNumbers && club.retiredNumbers.length > 0)) && (
            <Panel title="Arena & Honours">
              {club.arena && (
                <div className="row-between small"><span className="muted">Home arena</span><strong>{club.arena}</strong></div>
              )}
              {club.arenaCapacity !== undefined && club.arenaCapacity > 0 && (
                <div className="row-between small"><span className="muted">Capacity</span><strong>{club.arenaCapacity.toLocaleString()}</strong></div>
              )}
              {club.retiredNumbers && club.retiredNumbers.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="pp-band-label">Retired numbers</div>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {club.retiredNumbers.slice().sort((a, b) => a.number - b.number).map((r) => (
                      <span key={r.number} className="chip" style={{ fontSize: 11 }} title={r.player}>
                        #{r.number} {r.player}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          )}

          <Panel title="Vision & Objectives">
            <div className="list">
              <div className="row-between small"><span className="muted">Board mandate</span><strong>{humanizeMandate(club.mandate)}</strong></div>
              <p className="small muted" style={{ margin: '4px 0' }}>{club.mandateText}</p>
              <div className="row-between small"><span className="muted">Target finish</span><strong>{ordinal(club.targetRank)}</strong></div>
              <div className="row-between small"><span className="muted">Board confidence</span><strong>{club.confidenceLabel}</strong></div>
            </div>
          </Panel>

          <Panel title="Affiliate">
            {club.affiliate ? (
              <button
                className="row-between small"
                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                onClick={() => nav.navigate('squad', { teamId: club.affiliate!.teamId })}
              >
                <span className="muted">AHL affiliate</span>
                <strong style={{ color: 'var(--violet, #8b5cf6)' }}>{club.affiliate.name} ({club.affiliate.abbreviation}) ›</strong>
              </button>
            ) : (
              <p className="small muted">No affiliate club.</p>
            )}
          </Panel>

          {club.rivals.length > 0 && (
            <Panel title="Rivals">
              <div className="list">
                {club.rivals.map((r) => (
                  <div key={r.teamId} className="row-between small">
                    <span className="muted">{r.abbreviation}</span>
                    <span className="chip" style={{ fontSize: 10 }}>{r.label}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
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
