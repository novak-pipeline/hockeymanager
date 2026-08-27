/**
 * NHL Draft Prospect Rankings — the analyst/media consensus board of the
 * draft-eligible class, modelled on real prospect services (Central Scouting,
 * McKenzie, EliteProspects consensus). Lives under Scouting. Evolves across the
 * season: preliminary → mid-season → final. A separate U17 watch list tracks
 * younger talent that's on the radar but not yet draft-eligible.
 */
import { useMemo, useState } from 'react'
import type { DraftRankRowView, DraftRankingsView, ScoutBoardRowView } from '../../engine/career/views'
import { PlayerLink, TeamLink } from '../components/NavContext'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { SortHeaders, sortColumns, useTableSort } from '../components/sortable'

/** The analyst board. "Move" only exists once there is a previous board. */
function analystCols(showMove: boolean) {
  return sortColumns<DraftRankRowView>()([
    { key: 'rank', label: '#', value: (p) => p.rank, initialDir: 'asc' },
    ...(showMove
      ? [{ key: 'movement', label: 'Move', value: (p: DraftRankRowView) => p.movement ?? 0, title: 'Movement since the last ranking' } as const]
      : []),
    { key: 'name', label: 'Player', value: (p) => p.name, style: { textAlign: 'left' } },
    { key: 'age', label: 'Age', value: (p) => p.age, initialDir: 'asc' },
    { key: 'position', label: 'Pos', value: (p) => p.position },
    { key: 'nation', label: 'Nation', value: (p) => p.nation, style: { textAlign: 'left' } },
    { key: 'league', label: 'League', value: (p) => p.leagueAbbr, style: { textAlign: 'left' } },
    { key: 'team', label: 'Team', value: (p) => p.teamName || p.teamAbbr, style: { textAlign: 'left' } },
    { key: 'currentStars', label: 'Ability', value: (p) => p.currentStars, style: { textAlign: 'left' } },
    { key: 'potentialStars', label: 'Potential', value: (p) => p.potentialStars, style: { textAlign: 'left' } },
    { key: 'pNHLer', label: 'NHLer', value: (p) => p.pNHLer ?? null, title: 'NHLe projection: chance of becoming a regular NHLer' },
    { key: 'pStar', label: 'Star', value: (p) => p.pStar ?? null, title: 'NHLe projection: chance of becoming an impact/star player' },
  ])
}

const RADAR_COLS = sortColumns<DraftRankRowView>()([
  { key: 'rank', label: '#', value: (p) => p.rank, initialDir: 'asc' },
  { key: 'name', label: 'Player', value: (p) => p.name, style: { textAlign: 'left' } },
  { key: 'age', label: 'Age', value: (p) => p.age, initialDir: 'asc' },
  { key: 'position', label: 'Pos', value: (p) => p.position },
  { key: 'nation', label: 'Nation', value: (p) => p.nation, style: { textAlign: 'left' } },
  { key: 'league', label: 'League', value: (p) => p.leagueAbbr, style: { textAlign: 'left' } },
  { key: 'team', label: 'Team', value: (p) => p.teamName || p.teamAbbr, style: { textAlign: 'left' } },
  { key: 'potentialStars', label: 'Potential', value: (p) => p.potentialStars, style: { textAlign: 'left' } },
])

const SCOUT_BOARD_COLS = sortColumns<ScoutBoardRowView>()([
  { key: 'rank', label: '#', value: (p) => p.rank, initialDir: 'asc' },
  { key: 'consensusRank', label: 'Cons.', value: (p) => p.consensusRank, initialDir: 'asc', title: 'Analyst consensus rank' },
  { key: 'movement', label: 'Move', value: (p) => p.movement, title: 'How far your staff has him from the public board' },
  { key: 'name', label: 'Player', value: (p) => p.name, style: { textAlign: 'left' } },
  { key: 'age', label: 'Age', value: (p) => p.age, initialDir: 'asc' },
  { key: 'position', label: 'Pos', value: (p) => p.position },
  { key: 'league', label: 'League', value: (p) => p.leagueAbbr, style: { textAlign: 'left' } },
  { key: 'team', label: 'Team', value: (p) => p.teamName || p.teamAbbr, style: { textAlign: 'left' } },
  { key: 'potentialStars', label: 'Potential', value: (p) => p.potentialStars, style: { textAlign: 'left' } },
])

/** Stable identity so the sort hooks are not handed a new array each render. */
const NO_RANK_ROWS: DraftRankRowView[] = []

const PHASE_BLURB: Record<DraftRankingsView['phase'], string> = {
  preliminary: 'Early-season consensus — projection-led, expect movement.',
  midseason: 'The board firms up as the season’s body of work grows.',
  final: 'The final pre-draft consensus, weighting production and readiness.',
}

function Stars({ value }: { value: number }): JSX.Element {
  const full = Math.floor(value)
  const half = value - full >= 0.5
  return (
    <span title={`${value}/5`} style={{ color: 'var(--accent2, #e0b341)', whiteSpace: 'nowrap' }}>
      {'★'.repeat(full)}{half ? '½' : ''}
      <span style={{ color: 'var(--line)' }}>{'★'.repeat(5 - full - (half ? 1 : 0))}</span>
    </span>
  )
}

export function DraftRankingsScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData(
    () => client.getDraftRankings(),
    (r) => (r.type === 'draftRankings' ? r.draftRankings : null)
  )
  const allRows = data?.rankings ?? NO_RANK_ROWS
  const [board, setBoard] = useState<'analyst' | 'scouts'>('analyst')
  const [scoutId, setScoutId] = useState<string>('') // '' = staff consensus
  const [moveFilter, setMoveFilter] = useState<'all' | 'risers' | 'drops'>('all')
  const rows = useMemo(() => (moveFilter === 'risers'
    ? allRows.filter((r) => (r.movement ?? 0) > 0).sort((a, b) => (b.movement ?? 0) - (a.movement ?? 0))
    : moveFilter === 'drops'
    ? allRows.filter((r) => (r.movement ?? 0) < 0).sort((a, b) => (a.movement ?? 0) - (b.movement ?? 0))
    : allRows), [allRows, moveFilter])
  const analystColumns = useMemo(() => analystCols(data?.phase !== 'preliminary'), [data?.phase])
  const analystSort = useTableSort(rows, analystColumns, { key: null })
  const radarSort = useTableSort(data?.radar ?? NO_RANK_ROWS, RADAR_COLS, { key: null })

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <ScreenHeader title="Draft Prospect Rankings">
        <span className="muted small">Analyst consensus of the draft-eligible class — it shifts as they play out the season</span>
      </ScreenHeader>
      <ScreenStateNotices
        loading={loading}
        error={error}
        empty={!loading && allRows.length === 0}
        emptyText="No draft-eligible prospects to rank. Load a multi-league database to scout the class across the NCAA, OHL, USHL, Liiga and beyond."
      />

      {data && allRows.length > 0 && (
        <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className={`btn btn-sm${board === 'analyst' ? ' btn-primary' : ''}`} onClick={() => setBoard('analyst')}>
            Analyst Consensus
          </button>
          <button type="button" className={`btn btn-sm${board === 'scouts' ? ' btn-primary' : ''}`} onClick={() => setBoard('scouts')}>
            Your Scouts’ Board
          </button>
          {board === 'analyst' && data.phase !== 'preliminary' && (
            <span className="row" style={{ gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
              <span className="muted small">Show:</span>
              {(['all', 'risers', 'drops'] as const).map((f) => (
                <button key={f} type="button" className={`btn btn-sm${moveFilter === f ? ' btn-primary' : ''}`} onClick={() => setMoveFilter(f)}>
                  {f === 'all' ? 'All' : f === 'risers' ? '▲ Risers' : '▼ Drops'}
                </button>
              ))}
            </span>
          )}
        </div>
      )}

      {data && board === 'scouts' && (() => {
        const picked = scoutId ? data.scoutBoards.find((b) => b.scoutId === scoutId) : null
        const rows = picked ? picked.rows : data.scoutBoard
        const who = picked ? picked.scoutName : 'Staff consensus'
        return (
          <>
            {data.scoutBoards.length > 0 && (
              <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                <span className="muted small">Board:</span>
                <select className="select select-sm" value={scoutId} onChange={(e) => setScoutId(e.target.value)}>
                  <option value="">Staff consensus</option>
                  {data.scoutBoards.map((b) => (
                    <option key={b.scoutId} value={b.scoutId}>{b.scoutName}</option>
                  ))}
                </select>
              </div>
            )}
            <ScoutBoardPanel rows={rows} draftYear={data.draftYear} who={who} />
          </>
        )
      })()}

      {data && board === 'analyst' && allRows.length > 0 && (
        <Panel title={`NHL Draft Prospect Rankings — ${data.draftYear} class`}>
          <div className="muted small" style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--accent2, #e0b341)' }}>{data.phaseLabel}</strong>
            {' · '}{PHASE_BLURB[data.phase]}
            {moveFilter !== 'all' && ` · ${moveFilter === 'risers' ? 'biggest risers' : 'biggest drops'} since the last ranking`}
          </div>
          {rows.length === 0 && (
            <div className="muted small">No {moveFilter} to show at this stage.</div>
          )}
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <SortHeaders columns={analystColumns} sortKey={analystSort.sortKey} dir={analystSort.dir} onSort={analystSort.sortBy} />
              </tr>
            </thead>
            <tbody>
              {analystSort.sorted.map((p) => (
                <tr key={p.playerId}>
                  <td className="muted" style={{ textAlign: 'center', fontWeight: 700 }}>{p.rank}</td>
                  {data.phase !== 'preliminary' && (
                    <td style={{ textAlign: 'center' }}><Movement value={p.movement ?? 0} /></td>
                  )}
                  <td>
                    <PlayerLink playerId={p.playerId} name={p.name} />
                    {p.eligibility === 'reentry' && (
                      <span className="muted small" title="Re-entry eligible (passed over)"> · RE</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{p.age}</td>
                  <td style={{ textAlign: 'center' }}>{p.position}</td>
                  <td className="muted">{p.nation}</td>
                  <td className="muted">{p.leagueAbbr}</td>
                  <td className="muted" title={p.teamName || p.teamAbbr}><TeamLink teamId={p.teamId} name={p.teamName || p.teamAbbr} /></td>
                  <td><Stars value={p.currentStars} /></td>
                  <td><Stars value={p.potentialStars} /></td>
                  <td style={{ textAlign: 'center' }}><Pct value={p.pNHLer} /></td>
                  <td style={{ textAlign: 'center' }}><Pct value={p.pStar} accent /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {data && board === 'analyst' && data.radar.length > 0 && (
        <Panel title="On the radar — U17 watch list (not yet draft-eligible)">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Tracked early (14–16) for future drafts — ranked by projected ceiling.
          </div>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <SortHeaders columns={RADAR_COLS} sortKey={radarSort.sortKey} dir={radarSort.dir} onSort={radarSort.sortBy} />
              </tr>
            </thead>
            <tbody>
              {radarSort.sorted.map((p) => (
                <tr key={p.playerId}>
                  <td className="muted" style={{ textAlign: 'center' }}>{p.rank}</td>
                  <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
                  <td style={{ textAlign: 'center' }}>{p.age}</td>
                  <td style={{ textAlign: 'center' }}>{p.position}</td>
                  <td className="muted">{p.nation}</td>
                  <td className="muted">{p.leagueAbbr}</td>
                  <td className="muted" title={p.teamName || p.teamAbbr}><TeamLink teamId={p.teamId} name={p.teamName || p.teamAbbr} /></td>
                  <td><Stars value={p.potentialStars} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  )
}

/** NHLe projection percentage (blank for goalies / unknown). */
function Pct({ value, accent }: { value: number | undefined; accent?: boolean }): JSX.Element {
  if (value === undefined) return <span className="muted" style={{ fontSize: 11 }}>—</span>
  const color = accent
    ? (value >= 50 ? 'var(--success, #4caf72)' : value >= 25 ? 'var(--accent2, #e0b341)' : 'var(--muted)')
    : (value >= 80 ? 'var(--success, #4caf72)' : value >= 50 ? 'var(--accent2, #e0b341)' : 'var(--muted)')
  return <span style={{ color, fontWeight: 700, fontSize: 12 }}>{value}%</span>
}

/** Movement chip: ▲N if your scouts have him higher than consensus, ▼N lower. */
function Movement({ value }: { value: number }): JSX.Element {
  if (value === 0) return <span className="muted" style={{ fontSize: 11 }}>—</span>
  const up = value > 0
  return (
    <span style={{ color: up ? 'var(--success, #4caf72)' : 'var(--danger, #d8584f)', fontWeight: 700, fontSize: 12 }}>
      {up ? '▲' : '▼'}{Math.abs(value)}
    </span>
  )
}

function ScoutBoardPanel({ rows, draftYear, who }: { rows: ScoutBoardRowView[]; draftYear: number; who: string }): JSX.Element {
  const { sorted, sortKey, dir, sortBy } = useTableSort(rows, SCOUT_BOARD_COLS, { key: null })
  if (rows.length === 0) {
    return (
      <Panel title="Your Scouts’ Board">
        <div className="muted small">
          Your scouts haven’t built a board yet. Assign scouts to the prospect pool to develop your own rankings —
          they’ll diverge from the consensus the more your staff sees.
        </div>
      </Panel>
    )
  }
  return (
    <Panel title={`${who} — ${draftYear} class`}>
      <div className="muted small" style={{ marginBottom: 8 }}>
        {who === 'Staff consensus' ? 'Your staff’s' : `${who}’s`} own ranking, re-ordered from the consensus by what they’ve
        seen — intangibles, interviews, and the underlying game. <strong style={{ color: 'var(--success, #4caf72)' }}>▲</strong> means
        higher than the board; <strong style={{ color: 'var(--danger, #d8584f)' }}>▼</strong> lower. Unseen prospects sit at consensus.
      </div>
      <table className="data-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <SortHeaders columns={SCOUT_BOARD_COLS} sortKey={sortKey} dir={dir} onSort={sortBy} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.playerId} style={p.verdict === 'higher'
              ? { background: 'rgba(76,175,114,0.07)' }
              : p.verdict === 'lower' ? { background: 'rgba(216,88,79,0.07)' } : undefined}>
              <td className="muted" style={{ textAlign: 'center', fontWeight: 700 }}>{p.rank}</td>
              <td className="muted" style={{ textAlign: 'center' }}>{p.consensusRank}</td>
              <td style={{ textAlign: 'center' }}><Movement value={p.movement} /></td>
              <td>
                <PlayerLink playerId={p.playerId} name={p.name} />
                {!p.seen && <span className="muted small" title="Not yet scouted"> · unseen</span>}
                {p.eligibility === 'reentry' && <span className="muted small" title="Re-entry eligible"> · RE</span>}
                {/* E2: an arrow on its own reads as a contradiction next to a high
                    potential grade — the staff's position is stated in words. */}
                {p.verdict !== 'inline' && (
                  <div className="muted" style={{ fontSize: 10, lineHeight: 1.3 }}>{p.note}</div>
                )}
              </td>
              <td style={{ textAlign: 'center' }}>{p.age}</td>
              <td style={{ textAlign: 'center' }}>{p.position}</td>
              <td className="muted">{p.leagueAbbr}</td>
              <td className="muted" title={p.teamName || p.teamAbbr}><TeamLink teamId={p.teamId} name={p.teamName || p.teamAbbr} /></td>
              <td><Stars value={p.potentialStars} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}
