import { useState, useMemo } from 'react'
import type { AhlSquadView, SquadView } from '../../worker/protocol'
import type { SquadRowView, ArchetypeInfo } from '../../engine/career/views'
import { PlayerLink } from '../components/NavContext'
import { OverallStars } from '../components/Stars'
import { fmtMoney, fmtToi, moraleWord, moraleColor } from '../components/format'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { PlayerFace } from '../components/PlayerFace'
import { useUiStore, toast } from '../components/store'

type ScreenTab = 'nhl' | 'ahl'
type PosFilter = 'ALL' | 'F' | 'D' | 'G'
type SortKey =
  | 'name' | 'age' | 'pos' | 'overall' | 'line'
  | 'condition' | 'morale' | 'form'
  | 'salary' | 'years'
  | 'gp' | 'g' | 'a' | 'pts' | 'plusMinus' | 'pim' | 'toi'

const POS_TABS: { label: string; value: PosFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Forwards', value: 'F' },
  { label: 'Defence', value: 'D' },
  { label: 'Goalies', value: 'G' },
]

function posGroup(pos: string): PosFilter {
  if (pos === 'G') return 'G'
  if (pos === 'LD' || pos === 'RD' || pos === 'D') return 'D'
  return 'F'
}

function sortRows(rows: SquadRowView[], key: SortKey, asc: boolean): SquadRowView[] {
  const m = [...rows]
  m.sort((a, b) => {
    let av = 0
    let bv = 0
    switch (key) {
      case 'name':       return asc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      case 'age':        av = a.age; bv = b.age; break
      case 'pos':        return asc ? a.position.localeCompare(b.position) : b.position.localeCompare(a.position)
      case 'overall':    av = a.overall; bv = b.overall; break
      case 'line':       return asc ? a.lineLabel.localeCompare(b.lineLabel) : b.lineLabel.localeCompare(a.lineLabel)
      case 'condition':  av = a.condition; bv = b.condition; break
      case 'morale':     av = a.morale; bv = b.morale; break
      case 'form':       av = a.form; bv = b.form; break
      case 'salary':     av = a.contract.salary; bv = b.contract.salary; break
      case 'years':      av = a.contract.yearsRemaining; bv = b.contract.yearsRemaining; break
      case 'gp':         av = a.skater?.gamesPlayed ?? a.goalie?.gamesPlayed ?? 0; bv = b.skater?.gamesPlayed ?? b.goalie?.gamesPlayed ?? 0; break
      case 'g':          av = a.skater?.goals ?? 0; bv = b.skater?.goals ?? 0; break
      case 'a':          av = a.skater?.assists ?? 0; bv = b.skater?.assists ?? 0; break
      case 'pts':        av = a.skater?.points ?? 0; bv = b.skater?.points ?? 0; break
      case 'plusMinus':  av = a.skater?.plusMinus ?? 0; bv = b.skater?.plusMinus ?? 0; break
      case 'pim':        av = a.skater?.penaltyMinutes ?? 0; bv = b.skater?.penaltyMinutes ?? 0; break
      case 'toi':        av = a.skater?.toiPerGame ?? 0; bv = b.skater?.toiPerGame ?? 0; break
      default: break
    }
    return asc ? av - bv : bv - av
  })
  return m
}

function ArchetypeLabel({ archetype }: { archetype: ArchetypeInfo | undefined }): JSX.Element {
  if (!archetype) {
    return (
      <span className="muted small" style={{ fontStyle: 'italic', fontSize: 10 }}>
        Unknown
      </span>
    )
  }
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--violet-h)',
        background: 'var(--violet-dim)',
        borderRadius: 3,
        padding: '1px 5px',
        whiteSpace: 'nowrap',
      }}
      title={archetype.descriptors.length > 0 ? archetype.descriptors.join(' · ') : archetype.label}
    >
      {archetype.label}
    </span>
  )
}

function CondBar({ value }: { value: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  const cls = pct < 50 ? 'meter-fill over' : pct < 75 ? 'meter-fill warn' : 'meter-fill'
  return (
    <div style={{ width: 60 }}>
      <div className="meter">
        <div className={cls} style={{ width: `${pct}%` }} />
      </div>
      <div className="muted small" style={{ textAlign: 'right', marginTop: 2 }}>{pct}</div>
    </div>
  )
}

function FormArrow({ value }: { value: number }): JSX.Element {
  if (value > 1) return <span style={{ color: 'var(--success)' }}>▲</span>
  if (value < -1) return <span style={{ color: 'var(--danger)' }}>▼</span>
  return <span style={{ color: 'var(--muted)' }}>—</span>
}

function InjuryBadge({ row }: { row: SquadRowView }): JSX.Element | null {
  if (!row.injury) return null
  return (
    <span className="chip chip-danger" style={{ fontSize: 10 }}>
      {row.injury.gamesRemaining}gm
    </span>
  )
}

function SortTh({
  label, sortKey, current, asc, onSort, align = 'left',
}: {
  label: string
  sortKey: SortKey
  current: SortKey
  asc: boolean
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
}): JSX.Element {
  const active = current === sortKey
  return (
    <th
      className={align === 'right' ? 'num' : undefined}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && <span style={{ marginLeft: 3, color: 'var(--accent)' }}>{asc ? '↑' : '↓'}</span>}
    </th>
  )
}

function SkaterCols({ row }: { row: SquadRowView }): JSX.Element {
  const s = row.skater
  if (!s) return <td colSpan={7} className="muted">—</td>
  return (
    <>
      <td className="num">{s.gamesPlayed}</td>
      <td className="num">{s.goals}</td>
      <td className="num">{s.assists}</td>
      <td className="num"><strong>{s.points}</strong></td>
      <td className="num" style={{ color: s.plusMinus > 0 ? 'var(--success)' : s.plusMinus < 0 ? 'var(--danger)' : undefined }}>
        {s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}
      </td>
      <td className="num">{s.penaltyMinutes}</td>
      <td className="num">{fmtToi(s.toiPerGame)}</td>
    </>
  )
}

function GoalieCols({ row }: { row: SquadRowView }): JSX.Element {
  const g = row.goalie
  if (!g) return <td colSpan={7} className="muted">—</td>
  return (
    <>
      <td className="num">{g.gamesPlayed}</td>
      <td className="num">{g.wins}</td>
      <td className="num">.{Math.round(g.savePct * 1000)}</td>
      <td className="num">{g.goalsAgainstAverage.toFixed(2)}</td>
      <td className="num">{g.shutouts}</td>
      <td className="num"></td>
      <td className="num"></td>
    </>
  )
}

export function SquadScreen(props: { teamId?: string } = {}): JSX.Element {
  const client = useClient()
  const bump = useUiStore((s) => s.bump)
  const { teamId } = props
  // When a specific (non-user) teamId is provided, hide write controls
  const isReadOnly = teamId !== undefined

  const [screenTab, setScreenTab] = useState<ScreenTab>('nhl')

  const { data, loading, error } = useScreenData<SquadView>(
    () => (teamId ? client.getTeamSquad(teamId) : client.getSquad()),
    (r) => (r.type === 'squad' ? r.squad : null)
  )
  // AHL tab only shown for the user's own team
  const { data: ahlData, loading: ahlLoading, error: ahlError, refetch: refetchAhl } = useScreenData<AhlSquadView>(
    () => client.getAhlSquad(),
    (r) => (r.type === 'ahlSquad' ? r.squad : null)
  )

  const [posFilter, setPosFilter] = useState<PosFilter>('ALL')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('line')
  const [sortAsc, setSortAsc] = useState(true)
  const [colView, setColView] = useState<'general' | 'contract' | 'stats'>('general')

  const filtered = useMemo(() => {
    if (!data) return []
    let rows = data.rows
    if (posFilter !== 'ALL') rows = rows.filter((r) => posGroup(r.position) === posFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter((r) => r.name.toLowerCase().includes(q))
    }
    return sortRows(rows, sortKey, sortAsc)
  }, [data, posFilter, search, sortKey, sortAsc])

  const isGoalieView = posFilter === 'G'
  const hasGoalies = filtered.some((r) => posGroup(r.position) === 'G')

  function onSort(k: SortKey): void {
    if (sortKey === k) setSortAsc((a) => !a)
    else { setSortKey(k); setSortAsc(false) }
  }

  const sharedSortProps = { current: sortKey, asc: sortAsc, onSort }

  async function handleSendDown(playerId: string): Promise<void> {
    const res = await client.sendDown(playerId)
    if (res.type === 'error') {
      alert(res.message)
    } else {
      bump()
      refetchAhl()
    }
  }

  async function handleCallUp(playerId: string): Promise<void> {
    const res = await client.callUp(playerId)
    if (res.type === 'error') {
      alert(res.message)
    } else {
      bump()
      refetchAhl()
    }
  }

  const [settingRoster, setSettingRoster] = useState(false)
  const [coachMoves, setCoachMoves] = useState<{ promoted: string[]; demoted: string[] } | null>(null)
  async function handleSetCoachRoster(): Promise<void> {
    if (settingRoster) return
    setSettingRoster(true)
    try {
      const res = await client.setCoachRoster()
      if (res.type === 'error') { toast(res.message, 'error'); return }
      if (res.type === 'coachRosterSet') {
        setCoachMoves({ promoted: res.promoted, demoted: res.demoted })
        toast(
          res.promoted.length + res.demoted.length === 0
            ? 'Coach is happy with the roster as set — no moves.'
            : `Coach set the roster: ${res.promoted.length} up, ${res.demoted.length} down.`,
          'success'
        )
      }
      bump()
      refetchAhl()
    } finally {
      setSettingRoster(false)
    }
  }

  return (
    <section className="stack">
      <ScreenHeader title={screenTab === 'nhl' ? (data ? data.teamName : 'Roster') : (ahlData?.teamName ?? 'AHL Affiliate')}>
        <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
          {screenTab === 'nhl' && data && (
            <span className="muted small" style={{ whiteSpace: 'nowrap' }} title="Roster size · cap used vs ceiling">
              {data.rosterCount} players ·{' '}
              <span style={{ color: data.capUsed > data.salaryCap ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                {fmtMoney(data.capUsed)}
              </span>
              {' / '}{fmtMoney(data.salaryCap)}
            </span>
          )}
          {screenTab === 'nhl' && (
            <input
              className="input"
              placeholder="Search player…"
              style={{ width: 200 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          {!isReadOnly && (
            <button
              className="btn btn-sm"
              disabled={settingRoster}
              onClick={() => void handleSetCoachRoster()}
              title="Let the coach auto-set the NHL roster by ability — calls up the best AHL options and sends down those they've bettered"
            >
              {settingRoster ? 'Setting…' : 'Ask coach to set roster'}
            </button>
          )}
        </div>
      </ScreenHeader>

      {/* What the coach just did — explicit report of the auto-set moves. */}
      {!isReadOnly && coachMoves && (
        <Panel title="Coach set the roster">
          {coachMoves.promoted.length + coachMoves.demoted.length === 0 ? (
            <div className="muted small">No changes — the coach was happy with the roster as it stood.</div>
          ) : (
            <div className="grid grid-2" style={{ gap: 'var(--sp-4)' }}>
              <div>
                <div className="field-label" style={{ color: 'var(--success)' }}>Called up ({coachMoves.promoted.length})</div>
                {coachMoves.promoted.length === 0
                  ? <div className="muted small" style={{ marginTop: 4 }}>None.</div>
                  : <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{coachMoves.promoted.map((n) => <li key={n} style={{ fontSize: 13 }}>{n}</li>)}</ul>}
              </div>
              <div>
                <div className="field-label" style={{ color: 'var(--accent2, #e0b341)' }}>Sent down ({coachMoves.demoted.length})</div>
                {coachMoves.demoted.length === 0
                  ? <div className="muted small" style={{ marginTop: 4 }}>None.</div>
                  : <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{coachMoves.demoted.map((n) => <li key={n} style={{ fontSize: 13 }}>{n}</li>)}</ul>}
              </div>
            </div>
          )}
          <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setCoachMoves(null)}>Dismiss</button>
          </div>
        </Panel>
      )}

      {/* Top-level NHL / AHL tab switcher — only shown for own team */}
      {!isReadOnly && (
        <div className="tabs" style={{ borderBottom: '1px solid var(--border)' }}>
          <button
            className={`tab${screenTab === 'nhl' ? ' active' : ''}`}
            onClick={() => setScreenTab('nhl')}
          >
            NHL Roster
          </button>
          <button
            className={`tab${screenTab === 'ahl' ? ' active' : ''}`}
            onClick={() => setScreenTab('ahl')}
          >
            AHL / Farm
            {ahlData && ahlData.hasAffiliate && (
              <span className="muted small" style={{ marginLeft: 4 }}>({ahlData.rosterCount})</span>
            )}
          </button>
        </div>
      )}

      {screenTab === 'nhl' && (
        <>
          {error && <Notice kind="warn">{error}</Notice>}
          {loading && !data && <Notice kind="info">Loading…</Notice>}

          {data && (
            <>
              <div className="tabs">
                {POS_TABS.map((t) => (
                  <button
                    key={t.value}
                    className={`tab${posFilter === t.value ? ' active' : ''}`}
                    onClick={() => setPosFilter(t.value)}
                  >
                    {t.label}
                    {t.value !== 'ALL' && (
                      <span className="muted small" style={{ marginLeft: 4 }}>
                        ({data.rows.filter((r) => posGroup(r.position) === t.value).length})
                      </span>
                    )}
                  </button>
                ))}
                <label className="muted small" style={{ marginLeft: 'auto', alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 4 }}>
                  View:
                  <select className="select" value={colView} onChange={(e) => setColView(e.target.value as 'general' | 'contract' | 'stats')} style={{ fontSize: 12 }}>
                    <option value="general">General</option>
                    <option value="contract">Contract</option>
                    <option value="stats">Statistics</option>
                  </select>
                </label>
                <span className="muted small" style={{ alignSelf: 'center', paddingRight: 8 }}>
                  {filtered.length} player{filtered.length !== 1 ? 's' : ''}
                </span>
              </div>

              <Panel>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <SortTh label="Name" sortKey="name" {...sharedSortProps} />
                        <SortTh label="Age" sortKey="age" {...sharedSortProps} align="right" />
                        <SortTh label="Pos" sortKey="pos" {...sharedSortProps} />
                        <SortTh label="Role" sortKey="line" {...sharedSortProps} />
                        {colView === 'general' && (
                          <>
                            <SortTh label="OVR" sortKey="overall" {...sharedSortProps} align="right" />
                            <SortTh label="Cond" sortKey="condition" {...sharedSortProps} align="right" />
                            <SortTh label="Mor" sortKey="morale" {...sharedSortProps} align="right" />
                            <th title="Form trend">Form</th>
                            <th>Inj</th>
                          </>
                        )}
                        {colView === 'contract' && (
                          <>
                            <SortTh label="Salary" sortKey="salary" {...sharedSortProps} align="right" />
                            <th className="num">Years</th>
                            <th className="num">Expires</th>
                            <th>Clauses</th>
                          </>
                        )}
                        {colView === 'stats' && (
                          <>
                            <SortTh label="GP" sortKey="gp" {...sharedSortProps} align="right" />
                            {isGoalieView || hasGoalies ? (
                              <>
                                <th className="num" title="Wins (G) or Goals (S)">W/G</th>
                                <th className="num" title="SV% (G) or Assists (S)">SV%/A</th>
                                <th className="num" title="GAA (G) or Points (S)">GAA/P</th>
                                <th className="num" title="Shutouts / +/-">SO/±</th>
                                <th className="num">PIM</th>
                                <th className="num">TOI</th>
                              </>
                            ) : (
                              <>
                                <SortTh label="G" sortKey="g" {...sharedSortProps} align="right" />
                                <SortTh label="A" sortKey="a" {...sharedSortProps} align="right" />
                                <SortTh label="P" sortKey="pts" {...sharedSortProps} align="right" />
                                <SortTh label="±" sortKey="plusMinus" {...sharedSortProps} align="right" />
                                <SortTh label="PIM" sortKey="pim" {...sharedSortProps} align="right" />
                                <SortTh label="TOI/g" sortKey="toi" {...sharedSortProps} align="right" />
                              </>
                            )}
                          </>
                        )}
                        <th style={{ width: 80 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => {
                        const isGoalie = posGroup(row.position) === 'G'
                        return (
                          <tr key={row.playerId} style={row.injury ? { opacity: 0.72 } : undefined}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <PlayerFace faceId={row.faceId} name={row.name} size={24} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                                    <PlayerLink playerId={row.playerId} name={row.name} />
                                    {row.contract.noTradeClause && (
                                      <span className="chip chip-warn" style={{ marginLeft: 2, fontSize: 9 }}>NTC</span>
                                    )}
                                    {row.contract.twoWay && (
                                      <span className="chip" style={{ marginLeft: 2, fontSize: 9 }}>2W</span>
                                    )}
                                  </div>
                                  <ArchetypeLabel archetype={row.archetype} />
                                </div>
                              </div>
                            </td>
                            <td className="num muted">{row.age}</td>
                            <td className="muted">{row.position}</td>
                            <td>
                              <span className="chip" style={{ fontSize: 11 }}>{row.lineLabel}</span>
                              {row.role && (
                                <span className="muted small" style={{ marginLeft: 6 }}>{row.role}</span>
                              )}
                            </td>
                            {colView === 'general' && (
                              <>
                                <td className="num"><OverallStars value={row.overall} /></td>
                                <td><CondBar value={row.condition} /></td>
                                <td style={{ color: moraleColor(row.morale), fontWeight: 600, fontSize: 12 }}>{moraleWord(row.morale)}</td>
                                <td style={{ textAlign: 'center' }}><FormArrow value={row.form} /></td>
                                <td><InjuryBadge row={row} /></td>
                              </>
                            )}
                            {colView === 'contract' && (
                              <>
                                <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtMoney(row.contract.salary)}</td>
                                <td className="num muted">{row.contract.yearsRemaining}</td>
                                <td className="num muted">{row.contract.expiryYear}</td>
                                <td>
                                  {row.contract.noTradeClause && <span className="chip chip-warn" style={{ fontSize: 9 }}>NTC</span>}
                                  {row.contract.twoWay && <span className="chip" style={{ fontSize: 9, marginLeft: 2 }}>2-way</span>}
                                  {!row.contract.noTradeClause && !row.contract.twoWay && <span className="muted">—</span>}
                                </td>
                              </>
                            )}
                            {colView === 'stats' && (isGoalie ? <GoalieCols row={row} /> : <SkaterCols row={row} />)}
                            <td>
                              {!isReadOnly && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  style={{ fontSize: 11, padding: '2px 6px' }}
                                  title={row.contract.twoWay ? 'Send down to AHL affiliate' : 'Send down to the AHL (one-way deal — counts against the cap in the minors)'}
                                  onClick={() => void handleSendDown(row.playerId)}
                                >
                                  Send ↓
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={18} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                            No players match.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
        </>
      )}

      {!isReadOnly && screenTab === 'ahl' && (
        <AhlSquadPanel
          data={ahlData}
          loading={ahlLoading}
          error={ahlError}
          onCallUp={handleCallUp}
        />
      )}
    </section>
  )
}

/* ────────────────────────── AHL Farm Panel ────────────────────────── */

function AhlSquadPanel({
  data,
  loading,
  error,
  onCallUp,
}: {
  data: AhlSquadView | null
  loading: boolean
  error: string | null
  onCallUp: (playerId: string) => Promise<void>
}): JSX.Element {
  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading…</Notice>
  if (!data || !data.hasAffiliate) {
    return (
      <Notice kind="info">
        This team has no AHL affiliate configured.
      </Notice>
    )
  }

  const forwards = data.rows.filter((r) => posGroup(r.position) === 'F')
  const defense = data.rows.filter((r) => posGroup(r.position) === 'D')
  const goalies = data.rows.filter((r) => posGroup(r.position) === 'G')

  return (
    <div className="stack">
      <Panel title={`${data.teamName} — ${data.rosterCount} players`}>
        <p className="muted small" style={{ margin: '0 0 var(--sp-2)' }}>
          Use Recall to move a player up to the NHL roster. Two-way contracts can be sent down from the NHL tab.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Age</th>
                <th>Pos</th>
                <th className="num">OVR</th>
                <th className="num">Cond</th>
                <th>Inj</th>
                <th className="num">Contract</th>
                <th className="num">AHL GP</th>
                <th style={{ width: 80 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    No players on AHL roster.
                  </td>
                </tr>
              )}
              {[
                { label: 'Forwards', rows: forwards },
                { label: 'Defence', rows: defense },
                { label: 'Goalies', rows: goalies },
              ].map(({ label, rows }) =>
                rows.length === 0 ? null : (
                  <>
                    <tr key={`hdr-${label}`} style={{ background: 'var(--surface-raised)' }}>
                      <td
                        colSpan={9}
                        style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', padding: '6px 8px' }}
                      >
                        {label}
                      </td>
                    </tr>
                    {rows.map((row) => (
                      <tr key={row.playerId} style={row.injury ? { opacity: 0.72 } : undefined}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <PlayerFace faceId={row.faceId} name={row.name} size={24} />
                            <PlayerLink playerId={row.playerId} name={row.name} />
                          </div>
                        </td>
                        <td className="num muted">{row.age}</td>
                        <td className="muted">{row.position}</td>
                        <td className="num"><OverallStars value={row.overall} /></td>
                        <td><CondBar value={row.condition} /></td>
                        <td><InjuryBadge row={row} /></td>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>
                          <span>{fmtMoney(row.contract.salary)}</span>
                          <span className="muted small" style={{ marginLeft: 4 }}>×{row.contract.yearsRemaining}</span>
                        </td>
                        <td className="num muted">{row.skater?.gamesPlayed ?? row.goalie?.gamesPlayed ?? 0}</td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11, padding: '2px 6px', color: 'var(--success)' }}
                            title="Recall to NHL roster"
                            onClick={() => void onCallUp(row.playerId)}
                          >
                            Recall ↑
                          </button>
                        </td>
                      </tr>
                    ))}
                  </>
                )
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
