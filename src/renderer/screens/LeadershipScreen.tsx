/**
 * Leadership — name your captain, hand out the A's, set sweater numbers.
 *
 * Pulled OUT of the Dynamics screen (where it buried the hierarchy pyramid) into
 * its own room, and wired as a preseason GATE: the season can't open until a
 * captain is named (the dashboard's `captainsPending` routes Continue here). The
 * editor itself is unchanged — the same getLeadership / setCaptain /
 * toggleAlternate / setJerseyNumber calls.
 */
import { useCallback, useEffect, useState } from 'react'
import type { LeadershipView } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient } from '../hooks/useSim'
import { toast } from '../components/store'

function LeadershipBar({ value, max, color }: { value: number; max: number; color: string }): JSX.Element {
  return (
    <div className="meter" style={{ height: 5, width: 54 }} title={`${value}`}>
      <div className="meter-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
    </div>
  )
}

export function LeadershipScreen(): JSX.Element {
  const client = useClient()
  const [lead, setLead] = useState<LeadershipView | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await client.getLeadership()
    if (res.type === 'leadership') setLead(res.leadership)
  }, [client])
  useEffect(() => { void load() }, [load])

  const apply = useCallback((res: { type: string; leadership?: LeadershipView; ok?: boolean; message?: string }) => {
    if (res.type === 'leadership' && res.leadership) setLead(res.leadership)
    if (res.ok === false && res.message) toast(res.message, 'error')
  }, [])

  async function setCaptain(playerId: string | null): Promise<void> {
    if (busy) return; setBusy(true)
    try { apply(await client.setCaptain(playerId)) } finally { setBusy(false) }
  }
  async function toggleAlt(playerId: string): Promise<void> {
    if (busy) return; setBusy(true)
    try { apply(await client.toggleAlternate(playerId)) } finally { setBusy(false) }
  }
  async function setNumber(playerId: string, raw: string): Promise<void> {
    const n = raw.trim() === '' ? null : Number(raw)
    if (n !== null && !Number.isInteger(n)) return
    if (busy) return; setBusy(true)
    try { apply(await client.setJerseyNumber(playerId, n)) } finally { setBusy(false) }
  }

  const altCount = lead?.alternateIds.length ?? 0
  const noCaptain = lead !== null && (lead.captainId == null || !lead.rows.some((r) => r.playerId === lead.captainId))

  return (
    <section className="stack">
      <ScreenHeader title="Leadership Group & Sweater Numbers" />
      {noCaptain && (
        <Notice kind="warn">
          Name a captain before the season opens — the room needs a leader in the letter. Alternates
          and numbers are up to you; the C is the one call you have to make.
        </Notice>
      )}
      {!lead ? (
        <Notice kind="info">Loading the room…</Notice>
      ) : (
        <Panel title="Leadership Group & Sweater Numbers">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Name your captain (C) and up to {lead.maxAlternates} alternates (A){' '}
            <span style={{ opacity: 0.8 }}>— {altCount}/{lead.maxAlternates} A's assigned</span>.
            A well-chosen leadership group steadies the room. Numbers default from the roster; change them freely.
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Pos</th>
                  <th>Leadership</th>
                  <th>Influence</th>
                  <th style={{ textAlign: 'center' }}>Letter</th>
                  <th className="num">#</th>
                </tr>
              </thead>
              <tbody>
                {lead.rows.map((r) => {
                  const isCap = lead.captainId === r.playerId
                  const isAlt = lead.alternateIds.includes(r.playerId)
                  const isGoalie = r.position === 'G'
                  return (
                    <tr key={r.playerId}>
                      <td>
                        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <PlayerFace faceId={r.faceId} name={r.name} size={24} />
                          <PlayerLink playerId={r.playerId} name={r.name} />
                          {!r.captainEligible && !isGoalie && (
                            <span className="muted" style={{ fontSize: 9 }} title="Lacks the standing to wear the C">(not C-eligible)</span>
                          )}
                        </div>
                      </td>
                      <td className="num muted">{r.position}</td>
                      <td>
                        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <LeadershipBar value={r.leadership} max={99} color="var(--violet-h)" />
                          <span className="small muted">{r.leadership}</span>
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <LeadershipBar value={r.influence} max={100} color="var(--accent, var(--violet-h))" />
                          <span className="small muted">{r.influence}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {isGoalie ? (
                          <span className="muted small">—</span>
                        ) : (
                          <div className="row" style={{ gap: 4, justifyContent: 'center' }}>
                            <button
                              className={`btn btn-xs ${isCap ? 'btn-primary' : 'btn-ghost'}`}
                              disabled={busy || (!r.captainEligible && !isCap)}
                              title={isCap ? 'Strip the C' : 'Name captain'}
                              onClick={() => void setCaptain(isCap ? null : r.playerId)}
                            >C</button>
                            <button
                              className={`btn btn-xs ${isAlt ? 'btn-primary' : 'btn-ghost'}`}
                              disabled={busy || isCap || (!isAlt && altCount >= lead.maxAlternates)}
                              title={isAlt ? 'Remove the A' : 'Name alternate'}
                              onClick={() => void toggleAlt(r.playerId)}
                            >A</button>
                          </div>
                        )}
                      </td>
                      <td className="num">
                        <input
                          className="input"
                          style={{ width: 48, fontSize: 12, textAlign: 'center' }}
                          type="number" min={1} max={98}
                          defaultValue={r.jerseyNumber ?? ''}
                          disabled={busy}
                          onBlur={(e) => void setNumber(r.playerId, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {lead.retiredNumbers.length > 0 && (
            <div className="muted small" style={{ marginTop: 6 }}>
              Retired at the club: {lead.retiredNumbers.map((n) => `#${n}`).join(', ')}
            </div>
          )}
        </Panel>
      )}
    </section>
  )
}
