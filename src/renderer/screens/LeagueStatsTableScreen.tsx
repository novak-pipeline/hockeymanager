/**
 * LeagueStatsTableScreen — the full, sortable + filterable league statistics
 * table (Skaters / Goalies). FM "Statistics" parity: every NHL player, every
 * column, sort by any column, filter by position / rookies / your club / min GP.
 */
import { useState } from 'react'
import type { LeagueStatTableView, LeagueSkaterStatRow, LeagueGoalieStatRow } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { fmtToi } from '../components/format'
import { Notice, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

type Mode = 'skaters' | 'goalies'

interface Col<T> {
  key: keyof T
  label: string
  title?: string
  fmt: (r: T) => string
  /** Lower is better (sort asc by default). */
  lowerBetter?: boolean
}

const SKATER_COLS: Col<LeagueSkaterStatRow>[] = [
  { key: 'gp', label: 'GP', title: 'Games played', fmt: (r) => String(r.gp) },
  { key: 'goals', label: 'G', title: 'Goals', fmt: (r) => String(r.goals) },
  { key: 'assists', label: 'A', title: 'Assists', fmt: (r) => String(r.assists) },
  { key: 'points', label: 'P', title: 'Points', fmt: (r) => String(r.points) },
  { key: 'plusMinus', label: '+/-', title: 'Plus/Minus', fmt: (r) => (r.plusMinus > 0 ? `+${r.plusMinus}` : String(r.plusMinus)) },
  { key: 'pim', label: 'PIM', title: 'Penalty minutes', fmt: (r) => String(r.pim) },
  { key: 'shots', label: 'SOG', title: 'Shots on goal', fmt: (r) => String(r.shots) },
  { key: 'shootingPct', label: 'S%', title: 'Shooting %', fmt: (r) => `${(r.shootingPct * 100).toFixed(1)}` },
  { key: 'atoi', label: 'ATOI', title: 'Avg time on ice', fmt: (r) => fmtToi(r.atoi) },
  { key: 'ppGoals', label: 'PPG', title: 'Power-play goals', fmt: (r) => String(r.ppGoals) },
  { key: 'ppAssists', label: 'PPA', title: 'Power-play assists', fmt: (r) => String(r.ppAssists) },
  { key: 'ppPoints', label: 'PPP', title: 'Power-play points', fmt: (r) => String(r.ppPoints) },
  { key: 'hits', label: 'HIT', title: 'Hits', fmt: (r) => String(r.hits) },
  { key: 'blocks', label: 'BLK', title: 'Blocked shots', fmt: (r) => String(r.blocks) },
  { key: 'takeaways', label: 'TKA', title: 'Takeaways', fmt: (r) => String(r.takeaways) },
  { key: 'giveaways', label: 'GVA', title: 'Giveaways', fmt: (r) => String(r.giveaways), lowerBetter: true },
  { key: 'avgRating', label: 'AvR', title: 'Average game rating', fmt: (r) => (r.avgRating == null ? '–' : r.avgRating.toFixed(2)) },
]

const GOALIE_COLS: Col<LeagueGoalieStatRow>[] = [
  { key: 'gp', label: 'GP', title: 'Games played', fmt: (r) => String(r.gp) },
  { key: 'wins', label: 'W', title: 'Wins', fmt: (r) => String(r.wins) },
  { key: 'losses', label: 'L', title: 'Losses', fmt: (r) => String(r.losses), lowerBetter: true },
  { key: 'savePct', label: 'SV%', title: 'Save %', fmt: (r) => r.savePct.toFixed(3).replace(/^0/, '') },
  { key: 'gaa', label: 'GAA', title: 'Goals against average', fmt: (r) => r.gaa.toFixed(2), lowerBetter: true },
  { key: 'shutouts', label: 'SO', title: 'Shutouts', fmt: (r) => String(r.shutouts) },
  { key: 'saves', label: 'SV', title: 'Saves', fmt: (r) => String(r.saves) },
  { key: 'shotsAgainst', label: 'SA', title: 'Shots against', fmt: (r) => String(r.shotsAgainst) },
  { key: 'avgRating', label: 'AvR', title: 'Average game rating', fmt: (r) => (r.avgRating == null ? '–' : r.avgRating.toFixed(2)) },
]

const POS_FILTERS: { id: string; label: string; match: (p: string) => boolean }[] = [
  { id: 'C', label: 'C', match: (p) => p === 'C' },
  { id: 'W', label: 'W', match: (p) => p === 'W' || p === 'LW' || p === 'RW' },
  { id: 'D', label: 'D', match: (p) => p === 'D' },
]

export function LeagueStatsTableScreen(props: { teamId?: string } = {}): JSX.Element {
  const client = useClient()
  const scoped = props.teamId !== undefined
  const { data, loading, error } = useScreenData<LeagueStatTableView>(
    () => client.getLeagueStatTable(props.teamId),
    (r) => (r.type === 'leagueStatTable' ? r.table : null)
  )

  const [mode, setMode] = useState<Mode>('skaters')
  const [sortKey, setSortKey] = useState<string>('points')
  const [sortAsc, setSortAsc] = useState(false)
  const [posFilter, setPosFilter] = useState<Set<string>>(new Set())
  const [rookiesOnly, setRookiesOnly] = useState(false)
  const [myTeamOnly, setMyTeamOnly] = useState(false)
  const [minGp, setMinGp] = useState(0)
  const [query, setQuery] = useState('')

  function handleSort(key: string, lowerBetter?: boolean): void {
    if (key === sortKey) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(!!lowerBetter) }
  }

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading statistics…</Notice>
  if (!data) return <Notice kind="info">No statistics yet.</Notice>

  const cols: Col<LeagueSkaterStatRow | LeagueGoalieStatRow>[] =
    mode === 'skaters'
      ? (SKATER_COLS as Col<LeagueSkaterStatRow | LeagueGoalieStatRow>[])
      : (GOALIE_COLS as Col<LeagueSkaterStatRow | LeagueGoalieStatRow>[])

  const base: Array<LeagueSkaterStatRow | LeagueGoalieStatRow> = mode === 'skaters' ? data.skaters : data.goalies

  const q = query.trim().toLowerCase()
  const filtered = base.filter((r) => {
    if (r.gp < minGp) return false
    if (rookiesOnly && !r.rookie) return false
    if (myTeamOnly && r.teamAbbr !== data.userTeamAbbr) return false
    if (mode === 'skaters' && posFilter.size > 0) {
      const pos = (r as LeagueSkaterStatRow).position
      if (![...posFilter].some((f) => POS_FILTERS.find((pf) => pf.id === f)?.match(pos))) return false
    }
    if (q && !r.name.toLowerCase().includes(q)) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey]
    const bv = (b as unknown as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
    const as_ = String(av ?? ''), bs = String(bv ?? '')
    return sortAsc ? as_.localeCompare(bs) : bs.localeCompare(as_)
  })

  return (
    <section className="stack">
      <ScreenHeader title="Statistics">
        <span className="muted small">{sorted.length} players</span>
      </ScreenHeader>

      {/* Controls */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center' }}>
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden' }}>
          {(['skaters', 'goalies'] as Mode[]).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setSortKey(m === 'skaters' ? 'points' : 'savePct'); setSortAsc(false) }}
              style={{ background: mode === m ? 'var(--violet)' : 'var(--bg2)', border: 'none', color: mode === m ? '#fff' : 'var(--muted)', padding: '4px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
              {m}
            </button>
          ))}
        </div>
        {mode === 'skaters' && POS_FILTERS.map((pf) => (
          <button key={pf.id} type="button"
            className={`chip${posFilter.has(pf.id) ? ' chip-accent' : ''}`}
            style={{ cursor: 'pointer', border: 'none' }}
            onClick={() => setPosFilter((s) => { const n = new Set(s); n.has(pf.id) ? n.delete(pf.id) : n.add(pf.id); return n })}>
            {pf.label}
          </button>
        ))}
        <button type="button" className={`chip${rookiesOnly ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none' }} onClick={() => setRookiesOnly((v) => !v)}>Rookies</button>
        {!scoped && <button type="button" className={`chip${myTeamOnly ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none' }} onClick={() => setMyTeamOnly((v) => !v)}>My club</button>}
        <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          Min GP
          <input type="number" min={0} value={minGp} onChange={(e) => setMinGp(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: 52, background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text)', padding: '2px 4px' }} />
        </label>
        <input placeholder="Search player…" value={query} onChange={(e) => setQuery(e.target.value)}
          style={{ background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text)', padding: '4px 8px', fontSize: 12, minWidth: 140 }} />
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 230px)' }}>
        <table className="table" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ width: 26 }}>#</th>
              <th style={{ minWidth: 150 }}>Player</th>
              {!scoped && <th style={{ width: 40 }}>Tm</th>}
              {mode === 'skaters' && <th style={{ width: 32 }}>Pos</th>}
              <th style={{ width: 32, textAlign: 'right' }}>Age</th>
              {cols.map((c) => (
                <th key={c.key as string} title={c.title} onClick={() => handleSort(c.key as string, c.lowerBetter)}
                  style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none', minWidth: 44, whiteSpace: 'nowrap' }}>
                  {c.label}{sortKey === c.key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.playerId}>
                <td className="num" style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                <td><PlayerLink playerId={r.playerId} name={r.name} /></td>
                {!scoped && <td className="muted small">{r.teamAbbr}</td>}
                {mode === 'skaters' && <td className="muted small">{(r as LeagueSkaterStatRow).position}</td>}
                <td className="num muted">{r.age}</td>
                {cols.map((c) => (
                  <td key={c.key as string} className="num" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: c.key === sortKey ? 700 : 400 }}>
                    {c.fmt(r)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={cols.length + (scoped ? 4 : 5)} className="muted" style={{ textAlign: 'center', padding: 'var(--sp-4)' }}>No players match the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
