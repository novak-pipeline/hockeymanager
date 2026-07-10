/**
 * MediaCircuitScreen (#90) — the GM's standing with each named pundit in the
 * press corps. Every press-conference answer builds or sours a lasting
 * relationship with the reporter who asked; this screen is where you read where
 * you stand. Read-only.
 */
import type { MediaCircuitView, MediaCircuitRowView } from '../../worker/protocol'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/** Colour + tone for each standing band. */
function standingStyle(standing: MediaCircuitRowView['standing']): { color: string; bg: string } {
  switch (standing) {
    case 'Ally':
      return { color: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 16%, transparent)' }
    case 'Friendly':
      return { color: 'var(--cyan, #38bdf8)', bg: 'color-mix(in srgb, var(--cyan, #38bdf8) 16%, transparent)' }
    case 'Neutral':
      return { color: 'var(--muted)', bg: 'var(--bg3)' }
    case 'Critic':
      return { color: 'var(--amber, #f59e0b)', bg: 'color-mix(in srgb, var(--amber, #f59e0b) 16%, transparent)' }
    case 'Feud':
      return { color: 'var(--danger, #ef4444)', bg: 'color-mix(in srgb, var(--danger, #ef4444) 16%, transparent)' }
  }
}

/** Initials monogram for a pundit (no facepack for fictional press personas). */
function monogram(name: string): string {
  const parts = name.replace(/[“"”]/g, '').split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return (first + last).toUpperCase()
}

/** A -100..100 rapport meter centred on 0. */
function RapportBar(props: { rapport: number; color: string }): JSX.Element {
  const pct = Math.abs(props.rapport) / 100 * 50 // 0..50% from centre
  const positive = props.rapport >= 0
  return (
    <div style={{ position: 'relative', height: 8, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
      {/* centre tick */}
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--border)' }} />
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          background: props.color,
          borderRadius: 4,
          left: positive ? '50%' : `${50 - pct}%`,
          width: `${pct}%`,
        }}
      />
    </div>
  )
}

function PunditCard(props: { row: MediaCircuitRowView }): JSX.Element {
  const r = props.row
  const s = standingStyle(r.standing)
  return (
    <div
      className="panel"
      style={{ padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <div
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: s.bg,
            color: s.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 15,
            flexShrink: 0,
            border: `1px solid ${s.color}`,
          }}
        >
          {monogram(r.name)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</div>
          <div className="muted small">{r.outlet}</div>
        </div>
        <span
          className="chip"
          style={{ color: s.color, background: s.bg, border: `1px solid ${s.color}`, fontWeight: 600, fontSize: 11 }}
        >
          {r.standing}
        </span>
      </div>

      <RapportBar rapport={r.rapport} color={s.color} />

      <div className="small" style={{ lineHeight: 1.45 }}>
        {r.read}
      </div>

      <div className="muted small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span>{r.interactions} exchange{r.interactions === 1 ? '' : 's'}</span>
        <span>{r.lastExchange ? `Last: ${r.lastExchange}` : 'Not spoken yet'}</span>
      </div>
    </div>
  )
}

export function MediaCircuitScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<MediaCircuitView>(
    () => client.getMediaCircuit(),
    (r) => (r.type === 'mediaCircuit' ? r.mediaCircuit : null)
  )

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading the press room…</Notice>
  if (!data) return <Notice kind="info">No media data.</Notice>
  const d = data

  const summary =
    d.allyName && d.criticName
      ? `${d.allyName} is your closest ally in the press; ${d.criticName} is your fiercest critic.`
      : d.allyName
        ? `${d.allyName} has become an ally in the press box.`
        : d.criticName
          ? `${d.criticName} has turned critical — watch your answers.`
          : 'The press room is neutral on you — no allies, no enemies yet.'

  return (
    <section className="stack">
      <ScreenHeader title="Media Circuit">
        <span className="muted small">
          How you handle the {d.teamName} beat — every press-conference answer shifts a lasting relationship
        </span>
      </ScreenHeader>

      <Panel title="Where you stand">
        <div className="small" style={{ lineHeight: 1.5 }}>{summary}</div>
        <div className="muted small" style={{ marginTop: 6 }}>
          Tip: praise and measured answers warm reporters up; dodging (“no comment”) sours them. The radio homer
          loves passion, the national columnist sees through spin.
        </div>
      </Panel>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--sp-3)',
        }}
      >
        {d.rows.map((row) => (
          <PunditCard key={row.personaId} row={row} />
        ))}
      </div>
    </section>
  )
}
