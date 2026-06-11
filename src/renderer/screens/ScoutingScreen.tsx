/**
 * Scouting hub screen — scout assignment management and league-wide knowledge overview.
 *
 * Scout cards show current assignment with a dropdown to reassign.
 * Knowledge progress bars show per-team intel. Top-gains panel shows
 * recently improved players.
 */
import { useState } from 'react'
import type { ScoutingView } from '../../worker/protocol'
import type { ScoutCardView, TeamKnowledgeSummary } from '../../engine/career/views'
import type { ScoutTarget } from '@domain/scouting'
import { PlayerLink } from '../components/NavContext'
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
