/**
 * Scout profile — a staff scout's page: attributes, info & current assignment,
 * and the players he's watching / has surfaced. Reached by clicking a scout name.
 */
import { useState } from 'react'
import type { ScoutProfileView } from '../../engine/career/views'
import { PlayerLink, useNav } from '../components/NavContext'
import { FlagIcon } from '../components/FlagIcon'
import { fmtMoney } from '../components/format'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

function stars5(v: number): string {
  const full = Math.floor(v)
  return '★'.repeat(full) + (v - full >= 0.5 ? '½' : '')
}

function AttrBar({ label, value }: { label: string; value: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / 20) * 100))
  const color = value >= 15 ? 'var(--success)' : value >= 10 ? 'var(--accent)' : value >= 6 ? 'var(--accent2)' : 'var(--muted)'
  return (
    <div className="row" style={{ alignItems: 'center', gap: 8 }}>
      <span className="small" style={{ flex: '0 0 130px' }}>{label}</span>
      <div className="meter" style={{ flex: 1, height: 6 }}><div className="meter-fill" style={{ width: `${pct}%`, background: color }} /></div>
      <span className="mono small" style={{ minWidth: 22, textAlign: 'right', color }}>{value}</span>
    </div>
  )
}

type Tab = 'attributes' | 'info' | 'scouted'

export function ScoutProfileScreen({ scoutId }: { scoutId: string }): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [tab, setTab] = useState<Tab>('attributes')
  const [posFilter, setPosFilter] = useState<'ALL' | 'F' | 'D' | 'G'>('ALL')
  const [minPot, setMinPot] = useState(0)
  const [sortKey, setSortKey] = useState<'potential' | 'current' | 'age' | 'knowledge'>('potential')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const { data, loading, error } = useScreenData<ScoutProfileView | null>(
    () => client.getScoutProfile(scoutId),
    (r) => (r.type === 'scoutProfile' ? r.scoutProfile : null)
  )

  const ratingColor = (v: number): string => v >= 80 ? 'var(--success)' : v >= 65 ? 'var(--accent)' : 'var(--muted)'

  return (
    <section className="stack">
      <div className="row" style={{ alignItems: 'center', gap: 'var(--sp-3)' }}>
        {nav.canGoBack && <button className="btn btn-ghost small" onClick={nav.goBack}>← Back</button>}
        <ScreenHeader title={data?.name ?? 'Scout'} />
      </div>
      <ScreenStateNotices loading={loading} error={error} empty={!data} emptyText="Scout not found." />

      {data && (
        <>
          {/* Header card */}
          <Panel>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{data.name}</div>
                <div className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  Scout
                  {data.specialtyNation && <> · <FlagIcon nationality={data.specialtyNation} size={13} /> {data.specialtyNation} specialist</>}
                  {data.demeanor && <> · {data.demeanor}</>}
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>{data.assignmentLabel} · <span className="chip" style={{ fontSize: 10 }}>{data.focusLabel}</span> · covering {data.coverage}</div>
              </div>
              <div className="row" style={{ gap: 'var(--sp-4)' }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 800, color: ratingColor(data.rating) }}>{data.rating}</div><div className="muted small">Ability</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 800, color: ratingColor(data.judgment) }}>{data.judgment}</div><div className="muted small">Judgment</div></div>
                {data.salary !== undefined && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtMoney(data.salary)}</div><div className="muted small">Salary</div></div>}
              </div>
            </div>
          </Panel>

          {/* Tabs */}
          <div className="row" style={{ gap: 4, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            {([['attributes', 'Attributes'], ['info', 'Info & History'], ['scouted', `Scouted (${data.scouted.length})`]] as Array<[Tab, string]>).map(([id, label]) => (
              <button key={id} className="btn btn-ghost"
                style={{ padding: '8px 14px', borderRadius: 0, fontWeight: tab === id ? 700 : 500, color: tab === id ? 'var(--accent, #f5b301)' : 'var(--muted)', borderBottom: tab === id ? '2px solid var(--accent, #f5b301)' : '2px solid transparent' }}
                onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>

          {tab === 'attributes' && (
            <Panel title="Scouting Attributes">
              {data.attributes.length === 0 ? (
                <p className="muted small">No detailed attributes on file for this scout.</p>
              ) : (
                <div className="stack" style={{ gap: 8, maxWidth: 460 }}>
                  {data.attributes.map((a) => <AttrBar key={a.label} label={a.label} value={a.value} />)}
                </div>
              )}
            </Panel>
          )}

          {tab === 'info' && (
            <Panel title="Information">
              <div className="stack" style={{ gap: 'var(--sp-2)', fontSize: 13 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Current assignment</span><span>{data.assignmentLabel}</span></div>
                <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Focus</span><span>{data.focusLabel}</span></div>
                <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Players in scope</span><span>{data.coverage}</span></div>
                {data.specialtyNation && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Regional expertise</span><span>{data.specialtyNation}</span></div>}
                {data.finds.length > 0 && (
                  <div style={{ marginTop: 'var(--sp-2)' }}>
                    <div className="field-label">Prospects surfaced ({data.finds.length})</div>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {data.finds.slice(0, 12).map((f) => (
                        <li key={f.playerId} style={{ fontSize: 12.5, marginBottom: 3 }}>
                          <b>{f.grade}</b> <PlayerLink playerId={f.playerId} name={f.name} /> — <span className="muted">{f.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {tab === 'scouted' && (() => {
            const isPos = (pos: string, f: 'F' | 'D' | 'G'): boolean => {
              const isG = pos === 'G', isD = pos === 'D' || pos === 'LD' || pos === 'RD'
              return f === 'G' ? isG : f === 'D' ? isD : (!isG && !isD)
            }
            const sortVal = (p: typeof data.scouted[number]): number =>
              sortKey === 'potential' ? p.potentialStars
              : sortKey === 'current' ? p.currentStars
              : sortKey === 'age' ? p.age
              : p.knowledge
            const rows = data.scouted
              .filter((p) => posFilter === 'ALL' || isPos(p.position, posFilter))
              .filter((p) => p.potentialStars >= minPot)
              .sort((a, b) => (sortDir === 'desc' ? sortVal(b) - sortVal(a) : sortVal(a) - sortVal(b)))
            const setSort = (k: typeof sortKey): void => {
              if (k === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
              else { setSortKey(k); setSortDir('desc') }
            }
            const arrow = (k: typeof sortKey): string => (k === sortKey ? (sortDir === 'desc' ? ' ▾' : ' ▴') : '')
            const Th = ({ k, label }: { k: typeof sortKey; label: string }): JSX.Element => (
              <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setSort(k)}>{label}{arrow(k)}</th>
            )
            return (
              <Panel title={`Players Scouted (${data.scouted.length})`}>
                {data.scouted.length === 0 ? (
                  <p className="muted small">No meaningful intel yet — give him time on assignment. Every player he watches is logged here.</p>
                ) : (
                  <>
                    <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
                      <div className="row" style={{ gap: 4 }}>
                        {(['ALL', 'F', 'D', 'G'] as const).map((f) => (
                          <button key={f} className={`chip ${posFilter === f ? 'chip-accent' : ''}`} onClick={() => setPosFilter(f)}>{f}</button>
                        ))}
                      </div>
                      <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                        <span className="muted small">Min potential</span>
                        {[0, 3, 4, 4.5].map((m) => (
                          <button key={m} className={`chip ${minPot === m ? 'chip-accent' : ''}`} onClick={() => setMinPot(m)}>{m === 0 ? 'Any' : `${m}★`}</button>
                        ))}
                      </div>
                      <span className="muted small" style={{ marginLeft: 'auto' }}>{rows.length} shown</span>
                    </div>
                    <div className="table-wrap" style={{ maxHeight: 540, overflowY: 'auto' }}>
                      <table className="table">
                        <thead><tr><th>Player</th><th className="num">Pos</th><Th k="age" label="Age" /><th>Club</th><Th k="current" label="Current" /><Th k="potential" label="Potential" /><Th k="knowledge" label="Know." /></tr></thead>
                        <tbody>
                          {rows.map((p) => (
                            <tr key={p.playerId}>
                              <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{p.nationality && <FlagIcon nationality={p.nationality} size={14} />}<PlayerLink playerId={p.playerId} name={p.name} /></span></td>
                              <td className="num muted">{p.position}</td>
                              <td className="num muted">{p.age}</td>
                              <td className="muted small">{p.teamAbbr}</td>
                              <td style={{ color: 'var(--muted)', letterSpacing: 1, fontSize: 12 }}>{stars5(p.currentStars) || '–'}</td>
                              <td style={{ color: 'var(--accent, #f5b301)', letterSpacing: 1, fontSize: 12 }}>{stars5(p.potentialStars) || '–'}</td>
                              <td className="num muted small">{p.knowledge}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Panel>
            )
          })()}
        </>
      )}
    </section>
  )
}
