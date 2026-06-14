/**
 * Scouting hub screen — scout assignment management and league-wide knowledge overview.
 *
 * Scout cards show current assignment with a dropdown to reassign.
 * Knowledge progress bars show per-team intel. Top-gains panel shows
 * recently improved players.
 */
import { useState } from 'react'
import type { ScoutingView } from '../../worker/protocol'
import type { ScoutCardView, TeamKnowledgeSummary, ScoutedPlayerRow } from '../../engine/career/views'
import type { ScoutTarget } from '@domain/scouting'
import { PlayerLink } from '../components/NavContext'
import { fmtMoney, flagEmoji } from '../components/format'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'
import { bumpRefresh } from '../components/store'

/* ── knowledge bar ─────────────────────────────────────────────────────────── */

function KnowledgeBar({ value, small }: { value: number; small?: boolean }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  const color =
    pct >= 80 ? 'var(--success)' :
    pct >= 50 ? 'var(--accent)' :
    pct >= 25 ? 'var(--accent2)' :
    'var(--muted)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="meter" style={{ flex: 1, height: small ? 4 : 6 }}>
        <div className="meter-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="small mono" style={{ color, minWidth: 24, textAlign: 'right' }}>{pct}</span>
    </div>
  )
}

/* ── target label ──────────────────────────────────────────────────────────── */

function targetLabel(target: ScoutTarget, view: ScoutingView): string {
  switch (target.kind) {
    case 'team': {
      const t = view.teams.find((x) => x.teamId === target.teamId)
      return t ? t.teamAbbr : target.teamId
    }
    case 'division': {
      const d = view.divisions.find((x) => x.divisionId === target.divisionId)
      return d ? d.divisionName : target.divisionId
    }
    case 'draftClass':
      return 'Draft class'
    case 'freeAgents':
      return 'Free agents'
  }
}

/* ── assignment dropdown ───────────────────────────────────────────────────── */

function AssignmentDropdown(props: {
  scout: ScoutCardView
  view: ScoutingView
  onAssign: (scoutId: string, target: ScoutTarget) => void
}): JSX.Element {
  const { scout, view, onAssign } = props
  const [open, setOpen] = useState(false)

  const currentLabel = targetLabel(scout.target, view)

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost small"
        onClick={() => setOpen((o) => !o)}
        style={{ minWidth: 160, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span>{currentLabel}</span>
        <span className="muted" style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 50,
            background: 'var(--bg2)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            minWidth: 220,
            maxHeight: 320,
            overflowY: 'auto',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {/* Teams */}
          <div className="muted small" style={{ padding: '6px 10px 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Teams</div>
          {view.teams.map((t) => (
            <button
              key={t.teamId}
              className="btn-ghost"
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 13 }}
              onClick={() => {
                onAssign(scout.scoutId, { kind: 'team', teamId: t.teamId })
                setOpen(false)
              }}
            >
              {t.teamAbbr} — {t.teamName}
            </button>
          ))}

          {/* Divisions */}
          <div className="muted small" style={{ padding: '6px 10px 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Divisions</div>
          {view.divisions.map((d) => (
            <button
              key={d.divisionId}
              className="btn-ghost"
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 13 }}
              onClick={() => {
                onAssign(scout.scoutId, { kind: 'division', divisionId: d.divisionId })
                setOpen(false)
              }}
            >
              {d.divisionName} division
            </button>
          ))}

          {/* Draft class */}
          {view.hasDraftClass && (
            <>
              <div className="muted small" style={{ padding: '6px 10px 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Prospects</div>
              <button
                className="btn-ghost"
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 13 }}
                onClick={() => {
                  onAssign(scout.scoutId, { kind: 'draftClass' })
                  setOpen(false)
                }}
              >
                Draft class
              </button>
            </>
          )}

          {/* Free agents */}
          <div className="muted small" style={{ padding: '6px 10px 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Other</div>
          <button
            className="btn-ghost"
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 13 }}
            onClick={() => {
              onAssign(scout.scoutId, { kind: 'freeAgents' })
              setOpen(false)
            }}
          >
            Free agents
          </button>
        </div>
      )}
    </div>
  )
}

/* ── scout card ────────────────────────────────────────────────────────────── */

function ScoutCard(props: {
  scout: ScoutCardView
  view: ScoutingView
  onAssign: (scoutId: string, target: ScoutTarget) => void
}): JSX.Element {
  const { scout } = props
  const ratingColor =
    scout.rating >= 80 ? 'var(--success)' :
    scout.rating >= 65 ? 'var(--accent)' :
    'var(--muted)'

  return (
    <div className="panel" style={{ background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{scout.name}</div>
          <div className="muted small" style={{ marginTop: 2 }}>{scout.assignmentLabel}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: ratingColor }}>{scout.rating}</div>
          <div className="muted small">Rating</div>
        </div>
      </div>

      <div>
        <div className="muted small" style={{ marginBottom: 4 }}>Assignment</div>
        <AssignmentDropdown {...props} />
      </div>
    </div>
  )
}

/* ── team knowledge row ────────────────────────────────────────────────────── */

function TeamKnowledgeRow({ row }: { row: TeamKnowledgeSummary }): JSX.Element {
  return (
    <tr>
      <td>
        <span className="chip" style={{ fontSize: 11, marginRight: 6 }}>{row.teamAbbr}</span>
        <span className="muted small">{row.teamName}</span>
      </td>
      <td style={{ width: 180 }}>
        <KnowledgeBar value={row.avgKnowledge} small />
      </td>
    </tr>
  )
}

/* ── scouted-players recommendations table ─────────────────────────────────── */

const REC_COLOR: Record<ScoutedPlayerRow['rec'], string> = {
  'A+': 'var(--success)',
  A: 'rgba(52,211,153,0.85)',
  B: 'var(--accent2)',
  C: 'var(--amber, #f59e0b)',
  D: 'var(--muted)',
}

function stars5(v: number): string {
  const full = Math.floor(v)
  return '★'.repeat(full) + (v - full >= 0.5 ? '½' : '')
}

type ScoutSort = 'rec' | 'potential' | 'current' | 'age' | 'knowledge'

function ScoutedTable({ rows }: { rows: ScoutedPlayerRow[] }): JSX.Element {
  const [pos, setPos] = useState<string>('ALL')
  const [topOnly, setTopOnly] = useState(false)
  const [sort, setSort] = useState<ScoutSort>('rec')

  const positions = ['ALL', 'C', 'LW', 'RW', 'D', 'G']
  const recOrder: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4 }
  let view = rows.filter((r) => (pos === 'ALL' || r.position === pos) && (!topOnly || r.rec === 'A+' || r.rec === 'A'))
  view = [...view].sort((a, b) => {
    switch (sort) {
      case 'potential': return b.potentialStars - a.potentialStars
      case 'current': return b.currentStars - a.currentStars
      case 'age': return a.age - b.age
      case 'knowledge': return b.knowledge - a.knowledge
      default: return recOrder[a.rec]! - recOrder[b.rec]! || b.potentialStars - a.potentialStars
    }
  })

  return (
    <Panel title={`Scouting Recommendations (${view.length})`}>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)', alignItems: 'center' }}>
        {positions.map((p) => (
          <button key={p} className={`chip${pos === p ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} onClick={() => setPos(p)}>{p}</button>
        ))}
        <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }} />
        <button className={`chip${topOnly ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} onClick={() => setTopOnly((t) => !t)}>Top targets only</button>
        <label className="small muted" style={{ marginLeft: 'auto' }}>Sort:&nbsp;
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as ScoutSort)} style={{ fontSize: 12 }}>
            <option value="rec">Recommendation</option>
            <option value="potential">Potential</option>
            <option value="current">Current</option>
            <option value="knowledge">Knowledge</option>
            <option value="age">Age</option>
          </select>
        </label>
      </div>
      {view.length === 0 ? (
        <p className="muted small">No scouted players yet — assign scouts to build intel.</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Rec</th><th>Player</th><th className="num">Pos</th><th className="num">Age</th><th>Club</th>
                <th>Current</th><th>Potential</th><th className="num">Know.</th><th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {view.map((r) => (
                <tr key={r.playerId}>
                  <td><span style={{ fontWeight: 800, color: REC_COLOR[r.rec] }}>{r.rec}</span></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {r.nationality && flagEmoji(r.nationality) && <span style={{ fontSize: 11 }}>{flagEmoji(r.nationality)}</span>}
                      <PlayerLink playerId={r.playerId} name={r.name} />
                    </span>
                  </td>
                  <td className="num muted">{r.position}</td>
                  <td className="num muted">{r.age}</td>
                  <td className="muted small">{r.teamAbbr}</td>
                  <td style={{ color: 'var(--muted)', letterSpacing: 1, fontSize: 12 }}>{stars5(r.currentStars) || '–'}</td>
                  <td style={{ color: 'var(--accent, #f5b301)', letterSpacing: 1, fontSize: 12 }}>{stars5(r.potentialStars) || '–'}</td>
                  <td className="num muted small">{r.knowledge}%</td>
                  <td className="num small">{fmtMoney(r.salary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/* ── main screen ───────────────────────────────────────────────────────────── */

export function ScoutingScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error, refetch } = useScreenData<ScoutingView>(
    () => client.getScouting(),
    (r) => (r.type === 'scouting' ? r.scouting : null)
  )

  const handleAssign = async (scoutId: string, target: ScoutTarget): Promise<void> => {
    const res = await client.assignScout(scoutId, target)
    if (res.type === 'error') {
      toast(res.message, 'error')
    } else {
      bumpRefresh()
      refetch()
    }
  }

  return (
    <section className="stack">
      <ScreenHeader title="Scouting" />
      <ScreenStateNotices loading={loading} error={error} />

      {data && (
        <>
          {/* ── Scout cards ── */}
          <div className="grid grid-3" style={{ gap: 'var(--sp-4)' }}>
            {data.scouts.map((scout) => (
              <ScoutCard
                key={scout.scoutId}
                scout={scout}
                view={data}
                onAssign={(id, target) => { void handleAssign(id, target) }}
              />
            ))}
          </div>

          {/* ── Scouting recommendations table ── */}
          <ScoutedTable rows={data.scoutedPlayers} />

          <div className="grid grid-2" style={{ gap: 'var(--sp-4)' }}>
            {/* ── League knowledge overview ── */}
            <Panel title="League Knowledge">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th className="num">Avg knowledge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teamKnowledge.map((row) => (
                      <TeamKnowledgeRow key={row.teamId} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* ── Watch list / top gains ── */}
            <Panel title="Watch List">
              {data.topGains.length === 0 ? (
                <p className="muted small">Assign scouts to start building intelligence.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Pos</th>
                        <th className="num">Knowledge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topGains.map((p) => (
                        <tr key={p.playerId}>
                          <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
                          <td className="muted">{p.position}</td>
                          <td>
                            <KnowledgeBar value={p.knowledge} small />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </section>
  )
}
