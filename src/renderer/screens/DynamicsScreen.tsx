/**
 * DynamicsScreen — FM-style squad dynamics: cohesion/atmosphere/leadership,
 * a hierarchy pyramid, social groups, and a happiness grid. Read-only.
 */
import type { TeamDynamicsView, DynamicsPlayerView, DynamicsBar } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { moraleWord, moraleColor } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'

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
