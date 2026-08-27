/**
 * DevelopmentScreen — FM-style Development Center: the org's young / high-upside
 * players across the NHL roster and the AHL affiliate, with a current/potential
 * star read, projection tier and a plain-English development note. Read-only.
 */
import { useMemo, useState } from 'react'
import type { DevelopmentCenterView, DevelopmentRow } from '../../worker/protocol'
import type { PracticeFocus } from '../../engine/league/practice'
import { PlayerLink } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { ProgressTable } from '../components/ProgressTable'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'
import { SortHeaders, sortColumns, useTableSort } from '../components/sortable'

/** Stable empty array so the sort hooks do not see a new identity each render. */
const EMPTY_ROWS: DevelopmentRow[] = []

/** Shared prospect columns — the two tables differ only in where the man skates. */
function prospectCols(opts: { where: boolean; devFocus: boolean; growth?: Map<string, number> }) {
  return sortColumns<DevelopmentRow>()([
    { key: 'name', label: 'Player', value: (r) => r.name },
    { key: 'position', label: 'Pos', value: (r) => r.position, align: 'right' },
    { key: 'age', label: 'Age', value: (r) => r.age, align: 'right' },
    opts.where
      ? { key: 'location', label: 'Where', value: (r) => r.location } as const
      : { key: 'location', label: 'Club', value: (r) => r.clubAbbrev ?? null } as const,
    { key: 'currentStars', label: 'Current', value: (r) => r.currentStars },
    { key: 'potentialStars', label: 'Potential', value: (r) => r.potentialStars },
    { key: 'tier', label: 'Projection', value: (r) => r.upside, title: 'Ceiling role — sorts by remaining upside' },
    ...(opts.devFocus
      ? [
          { key: 'focus', label: 'Dev focus', value: (r: DevelopmentRow) => r.focus ?? null } as const,
          {
            key: 'growth',
            label: 'Season',
            align: 'right',
            value: (r: DevelopmentRow) => opts.growth?.get(r.playerId) ?? null,
            title: 'Ability gained or lost so far this season — the payoff, shown next to the lever that drives it',
          } as const,
        ]
      : []),
    { key: 'note', label: 'Development' },
  ])
}

/** #174: the individual-development-focus options offered on a prospect. */
const FOCUS_OPTIONS: Array<{ value: PracticeFocus; label: string }> = [
  { value: 'offense', label: 'Offense' },
  { value: 'defense', label: 'Defense' },
  { value: 'skating', label: 'Skating' },
  { value: 'physical', label: 'Physical' },
  { value: 'goaltending', label: 'Goaltending' },
]

/** Render half-step stars out of 5. */
function Stars(props: { value: number; muted?: boolean }): JSX.Element {
  const full = Math.floor(props.value)
  const half = props.value - full >= 0.5
  const stars = '★'.repeat(full) + (half ? '½' : '')
  return (
    <span
      title={`${props.value} / 5`}
      style={{ color: props.muted ? 'var(--muted)' : 'var(--accent, #f5b301)', letterSpacing: 1, fontSize: 12 }}
    >
      {stars || '–'}
    </span>
  )
}

function tierColor(tier: DevelopmentRow['tier']): string {
  switch (tier) {
    case 'Star':
    case 'Prospect':
      return 'var(--accent, #f5b301)'
    case 'Key':
      return 'var(--violet, #8b5cf6)'
    case 'Core':
      return 'var(--success)'
    default:
      return 'var(--muted)'
  }
}

export function DevelopmentScreen(props: { teamId?: string } = {}): JSX.Element {
  const client = useClient()
  // User-club scoped; teamId accepted for future per-team use.
  void props.teamId
  const { data, loading, error, refetch } = useScreenData<DevelopmentCenterView>(
    () => client.getDevelopment(),
    (r) => (r.type === 'development' ? r.development : null)
  )

  const [tab, setTab] = useState<'prospects' | 'system' | 'progress'>('prospects')
  const [busy, setBusy] = useState(false)

  // The U23 progress rows carry season ability change; index them so the
  // prospects table can show — and sort by — each man's payoff beside his focus.
  const growthById = useMemo(
    () => new Map((data?.progress ?? []).map((g) => [g.playerId, g.overallDelta])),
    [data],
  )
  // Sort state lives above the early returns — hooks cannot hide behind a guard.
  const prospectCols_rows = useMemo(
    () => prospectCols({ where: true, devFocus: true, growth: growthById }),
    [growthById],
  )
  const prospectCols_system = useMemo(() => prospectCols({ where: false, devFocus: false }), [])
  const rowsSort = useTableSort(data?.rows ?? EMPTY_ROWS, prospectCols_rows, { key: null })
  const systemSort = useTableSort(data?.systemElsewhere ?? EMPTY_ROWS, prospectCols_system, { key: null })

  async function setFocus(playerId: string, focus: PracticeFocus | null): Promise<void> {
    if (busy) return
    setBusy(true)
    try { await client.setPlayerFocusDrill(playerId, focus); refetch() } finally { setBusy(false) }
  }
  async function recommendAll(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const r = await client.recommendPlayerFocuses()
      if (r.type !== 'error') { toast('Development plans set across the whole system — NHL, AHL and your junior prospects.', 'success'); refetch() }
    } finally { setBusy(false) }
  }

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading development centre…</Notice>
  if (!data) return <Notice kind="info">No development data.</Notice>
  const d = data

  return (
    <section className="stack">
      <ScreenHeader title="Development Center">
        <span className="muted small">
          {d.count} prospects tracked · {d.highCeiling} high-ceiling · set the NHL roster on the Roster screen
        </span>
      </ScreenHeader>

      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button type="button" className={`btn btn-sm${tab === 'prospects' ? ' btn-primary' : ''}`} onClick={() => setTab('prospects')}>Prospects</button>
        <button type="button" className={`btn btn-sm${tab === 'system' ? ' btn-primary' : ''}`} onClick={() => setTab('system')}>In Your System ({d.systemElsewhere.length})</button>
        <button type="button" className={`btn btn-sm${tab === 'progress' ? ' btn-primary' : ''}`} onClick={() => setTab('progress')}>U23 Progress</button>
      </div>

      {tab === 'progress' && (
        <Panel title="U23 Progress — season ability & ceiling change">
          <div className="muted small" style={{ marginBottom: 8 }}>
            How your under-23 organisation players have developed this season (biggest risers first).
          </div>
          <ProgressTable rows={d.progress} />
        </Panel>
      )}

      {tab === 'prospects' && (
      <Panel title="Prospects (NHL + Affiliate)">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <span className="muted small">Set an individual development focus per prospect — it biases his growth and follows him to the AHL or junior.</span>
          <button className="btn btn-sm" disabled={busy} onClick={() => void recommendAll()}>Auto-set plans</button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortHeaders columns={prospectCols_rows} sortKey={rowsSort.sortKey} dir={rowsSort.dir} onSort={rowsSort.sortBy} />
              </tr>
            </thead>
            <tbody>
              {rowsSort.sorted.map((r) => (
                <tr key={r.playerId}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <PlayerFace faceId={r.faceId} name={r.name} size={22} />
                      <PlayerLink playerId={r.playerId} name={r.name} />
                    </span>
                  </td>
                  <td className="num muted">{r.position}</td>
                  <td className="num muted">{r.age}</td>
                  <td>
                    <span
                      className="chip"
                      style={{ fontSize: 10, background: r.location === 'AHL' ? 'var(--surface-2, #2a2a3a)' : undefined }}
                    >
                      {r.location}
                    </span>
                  </td>
                  <td><Stars value={r.currentStars} muted /></td>
                  <td><Stars value={r.potentialStars} /></td>
                  <td style={{ color: tierColor(r.tier), fontWeight: 600, fontSize: 12 }}>{r.projection}</td>
                  <td>
                    <select className="select" style={{ fontSize: 11 }} value={r.focus ?? ''} disabled={busy}
                      onChange={(e) => void setFocus(r.playerId, e.target.value === '' ? null : (e.target.value as PracticeFocus))}>
                      <option value="">— Default —</option>
                      {FOCUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    {(() => {
                      // Gap #6 payoff receipt: this growth was already computed for
                      // the U23 Progress tab — one click away from the focus control
                      // that drives it, so a GM set a focus and never saw whether it
                      // paid. Same view object, joined by id; no engine change.
                      const g = growthById.get(r.playerId)
                      if (g === undefined) return <span className="muted">—</span>
                      const color = g > 0 ? 'var(--success)' : g < 0 ? 'var(--danger)' : 'var(--muted)'
                      return <span style={{ color, fontWeight: 600 }}>{g > 0 ? `+${g}` : g === 0 ? '–' : g}</span>
                    })()}
                  </td>
                  <td className="small muted">{r.note}</td>
                </tr>
              ))}
              {d.rows.length === 0 && (
                <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 'var(--sp-4)' }}>No prospects in the system.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      )}

      {tab === 'system' && (
      <Panel title="In Your System — rights held, playing elsewhere">
        <div className="muted small" style={{ marginBottom: 8 }}>
          Players whose NHL rights your club holds but who skate outside your NHL/AHL rosters — juniors,
          college, or Europe. They join the farm as they turn pro.
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortHeaders columns={prospectCols_system} sortKey={systemSort.sortKey} dir={systemSort.dir} onSort={systemSort.sortBy} />
              </tr>
            </thead>
            <tbody>
              {systemSort.sorted.map((r) => (
                <tr key={r.playerId}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <PlayerFace faceId={r.faceId} name={r.name} size={22} />
                      <PlayerLink playerId={r.playerId} name={r.name} />
                    </span>
                  </td>
                  <td className="num muted">{r.position}</td>
                  <td className="num muted">{r.age}</td>
                  <td className="muted small">{r.clubAbbrev ?? '—'}</td>
                  <td><Stars value={r.currentStars} muted /></td>
                  <td><Stars value={r.potentialStars} /></td>
                  <td style={{ color: tierColor(r.tier), fontWeight: 600, fontSize: 12 }}>{r.projection}</td>
                  <td className="small muted">{r.note}</td>
                </tr>
              ))}
              {d.systemElsewhere.length === 0 && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 'var(--sp-4)' }}>No rights-held players outside your NHL/AHL rosters yet — they'll appear here as you draft.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      )}
    </section>
  )
}
