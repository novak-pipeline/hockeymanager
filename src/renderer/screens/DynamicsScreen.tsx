/**
 * DynamicsScreen — FM-style squad dynamics: cohesion/atmosphere/leadership,
 * a hierarchy pyramid, social groups, and a happiness grid. Read-only.
 */
import { useCallback, useEffect, useState } from 'react'
import type { TeamDynamicsView, DynamicsPlayerView, DynamicsBar, LeadershipView } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { moraleWord, moraleColor } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

function barColor(v: number): string {
  if (v >= 62) return 'var(--success)'
  if (v >= 45) return 'var(--amber, #f59e0b)'
  return 'var(--danger)'
}

function StatBar({ title, bar }: { title: string; bar: DynamicsBar }): JSX.Element {
  const color = barColor(bar.value)
  return (
    <div className="panel" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
      <div className="field-label">{title}</div>
      <div style={{ fontWeight: 800, fontSize: 16, color, margin: '2px 0 6px' }}>{bar.label}</div>
      <div className="meter" style={{ height: 6 }}>
        <div className="meter-fill" style={{ width: `${bar.value}%`, background: color }} />
      </div>
    </div>
  )
}

/** A player chip used in the hierarchy pyramid + social groups. */
function PlayerChip({ p }: { p: DynamicsPlayerView }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'var(--bg2)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius-sm)', padding: '4px 8px', minWidth: 0,
      }}
      title={`${p.personality} · influence ${p.influence}`}
    >
      <PlayerFace faceId={p.faceId} name={p.name} size={22} />
      <div style={{ minWidth: 0 }}>
        <PlayerLink playerId={p.playerId} name={p.name} className="small" />
        <div className="muted" style={{ fontSize: 9 }}>{p.personality}</div>
      </div>
    </div>
  )
}

function PyramidTier({ label, color, players }: { label: string; color: string; players: DynamicsPlayerView[] }): JSX.Element | null {
  if (players.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {players.map((p) => <PlayerChip key={p.playerId} p={p} />)}
      </div>
    </div>
  )
}

function SocialGroup({ title, players }: { title: string; players: DynamicsPlayerView[] }): JSX.Element | null {
  if (players.length === 0) return null
  return (
    <div>
      <div className="field-label" style={{ marginBottom: 6 }}>{title} · {players.length}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {players.map((p) => <PlayerChip key={p.playerId} p={p} />)}
      </div>
    </div>
  )
}

/** #189: leadership bar (leadership + influence, 0–99/0–100). */
function LeadershipBar({ value, max, color }: { value: number; max: number; color: string }): JSX.Element {
  return (
    <div className="meter" style={{ height: 5, width: 54 }} title={`${value}`}>
      <div className="meter-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
    </div>
  )
}

/**
 * #189: captains + jersey numbers editor (user club only). Name a captain, hand
 * out A's within the letter limit, and set sweater numbers — all with the
 * leadership + room-influence reads that inform the choice.
 */
function LeadershipPanel({ client }: { client: ReturnType<typeof useClient> }): JSX.Element | null {
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

  if (!lead) return null
  const altCount = lead.alternateIds.length

  return (
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
  )
}

export function DynamicsScreen(props: { teamId: string }): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<TeamDynamicsView>(
    () => client.getTeamDynamics(props.teamId),
    (r) => (r.type === 'teamDynamics' ? r.dynamics : null)
  )

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading dynamics…</Notice>
  if (!data) return <Notice kind="info">No dynamics data.</Notice>
  const d = data

  return (
    <section className="stack">
      <ScreenHeader title="Dynamics">
        <span className="muted small">Locker room: {d.atmosphere.label}</span>
      </ScreenHeader>

      {/* Summary bars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-3)' }}>
        <StatBar title="Team Cohesion" bar={d.cohesion} />
        <StatBar title="Club Atmosphere" bar={d.atmosphere} />
        <StatBar title="Leadership Support" bar={d.leadership} />
      </div>

      {/* #189: captains + jersey numbers (user club only) */}
      {d.isUserClub && <LeadershipPanel client={client} />}

      {/* Top influencers */}
      {d.topInfluencers.length > 0 && (
        <Panel title="Top Influencers">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
            {d.topInfluencers.map((t) => (
              <div key={t.playerId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <PlayerFace faceId={t.faceId} name={t.name} size={40} />
                <div>
                  <PlayerLink playerId={t.playerId} name={t.name} />
                  <div className="muted small">{t.tierLabel}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* LW5: the promise ledger — your word, in writing, with receipts */}
      {(d.promises ?? []).length > 0 && (
        <Panel title="The Promise Ledger">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Player</th><th>What you said</th><th>When</th><th>Status</th></tr>
              </thead>
              <tbody>
                {d.promises!.map((pr, i) => (
                  <tr key={i}>
                    <td>
                      <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                        <PlayerFace faceId={pr.faceId} name={pr.playerName} size={26} />
                        <PlayerLink playerId={pr.playerId} name={pr.playerName} />
                      </div>
                    </td>
                    <td style={{ fontStyle: 'italic' }}>“{pr.text}”</td>
                    <td className="muted small">{pr.madeLabel}</td>
                    <td>
                      {pr.status === 'open' && <span className="chip chip-warn" style={{ fontSize: 10 }}>Due {pr.dueLabel}</span>}
                      {pr.status === 'kept' && <span className="chip chip-success" style={{ fontSize: 10 }}>Kept</span>}
                      {pr.status === 'broken' && <span className="chip chip-danger" style={{ fontSize: 10 }}>Broken</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted small" style={{ marginTop: 6, fontStyle: 'italic' }}>
            Players remember. A kept promise buys trust; a broken one costs double.
          </div>
        </Panel>
      )}

      {/* Hierarchy pyramid */}
      <Panel title="Squad Hierarchy">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <PyramidTier label="Team Leaders"        color="var(--amber, #f59e0b)" players={d.hierarchy.leaders} />
          <PyramidTier label="Highly Influential"  color="var(--violet-h)"       players={d.hierarchy.highlyInfluential} />
          <PyramidTier label="Influential"         color="var(--accent2, var(--violet-h))" players={d.hierarchy.influential} />
          <PyramidTier label="Other Players"       color="var(--muted)"          players={d.hierarchy.others} />
        </div>
      </Panel>

      {/* Social groups */}
      <Panel title="Social Groups">
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <SocialGroup title="Core Social Group" players={d.socialGroups.core} />
          <SocialGroup title={d.socialGroups.secondaryLabel ?? 'Secondary Social Group'} players={d.socialGroups.secondary} />
          <SocialGroup title="Others" players={d.socialGroups.other} />
        </div>
      </Panel>

      {/* Happiness grid */}
      <Panel title="Happiness">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Pos</th>
                <th>Standing</th>
                <th>Personality</th>
                <th>Morale</th>
              </tr>
            </thead>
            <tbody>
              {d.happinessRows.map((p) => (
                <tr key={p.playerId}>
                  <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
                  <td className="num muted">{p.position}</td>
                  <td className="small muted">{p.tier === 'leader' ? 'Team Leader' : p.tier === 'highlyInfluential' ? 'Highly Influential' : p.tier === 'influential' ? 'Influential' : 'Squad Player'}</td>
                  <td className="small">{p.personality}</td>
                  <td style={{ color: moraleColor(p.morale), fontWeight: 700, fontSize: 13 }}>{moraleWord(p.morale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  )
}
