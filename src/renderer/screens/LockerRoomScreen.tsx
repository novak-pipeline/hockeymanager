import type { LockerRoomView } from '../../worker/protocol'
import type { RelationshipView } from '../../engine/career/views'
import { PlayerLink } from '../components/NavContext'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/* ── helpers ── */

function pct(v: number): string {
  return `${Math.round(Math.max(0, Math.min(100, v)))}%`
}

function moraleColor(v: number): string {
  if (v >= 70) return 'var(--green)'
  if (v >= 40) return 'var(--amber)'
  return 'var(--red)'
}

function familiarityChip(v: number): string {
  if (v >= 70) return 'chip chip-success'
  if (v >= 40) return 'chip chip-warn'
  return 'chip chip-danger'
}

/* ── Leadership panel ── */

function LeadershipPanel({ view }: { view: LockerRoomView }): JSX.Element {
  return (
    <Panel title="Leadership">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {/* Captain + alternates row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--sp-3)' }}>
          {view.captain ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  borderRadius: 4,
                  background: 'var(--amber)',
                  color: '#000',
                  fontWeight: 800,
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                C
              </span>
              <PlayerLink playerId={view.captain.playerId} name={view.captain.name} />
              <span className="muted small">{view.captain.position} · {view.captain.age} yrs · OVR {view.captain.overall}</span>
            </div>
          ) : (
            <span className="muted small">No captain assigned</span>
          )}
          {view.alternates.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center' }}>
              {view.alternates.map((alt) => (
                <div
                  key={alt.playerId}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      background: 'var(--bg3)',
                      border: '1px solid var(--muted)',
                      color: 'var(--text)',
                      fontWeight: 700,
                      fontSize: 11,
                      flexShrink: 0,
                    }}
                  >
                    A
                  </span>
                  <PlayerLink playerId={alt.playerId} name={alt.name} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Influence ladder */}
        {view.influence.length > 0 && (
          <div>
            <div className="panel-title" style={{ marginBottom: 'var(--sp-2)' }}>
              Influence (top {view.influence.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {view.influence.map((p, i) => {
                const bar = Math.max(0, Math.min(100, p.influence))
                return (
                  <div
                    key={p.playerId}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
                  >
                    <span
                      style={{
                        width: 20,
                        color: 'var(--muted)',
                        fontSize: 11,
                        flexShrink: 0,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {i + 1}
                    </span>
                    <div style={{ width: 130, flexShrink: 0 }}>
                      <PlayerLink playerId={p.playerId} name={p.name} />
                    </div>
                    <span className="muted small" style={{ width: 28, flexShrink: 0 }}>
                      {p.position}
                    </span>
                    <div style={{ flex: 1, minWidth: 80 }}>
                      <div className="meter">
                        <div
                          className="meter-fill"
                          style={{
                            width: pct(bar),
                            background:
                              bar >= 70
                                ? 'var(--violet)'
                                : bar >= 40
                                ? 'var(--amber)'
                                : 'var(--muted)',
                          }}
                        />
                      </div>
                    </div>
                    <span
                      style={{
                        width: 32,
                        textAlign: 'right',
                        fontSize: 12,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--violet-h)',
                      }}
                    >
                      {bar}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ── Room morale gauge ── */

function MoralePanel({ morale }: { morale: number }): JSX.Element {
  const clamped = Math.max(0, Math.min(100, morale))
  const label =
    clamped >= 80
      ? 'Excellent'
      : clamped >= 60
      ? 'Good'
      : clamped >= 40
      ? 'Neutral'
      : clamped >= 20
      ? 'Low'
      : 'Crisis'
  const color = moraleColor(clamped)
  return (
    <Panel title="Room Morale">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
        {/* Big number */}
        <div style={{ textAlign: 'center', minWidth: 64 }}>
          <div
            style={{
              fontSize: 36,
              fontWeight: 800,
              lineHeight: 1.1,
              color,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {clamped}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>/ 100</div>
        </div>
        {/* Bar + label */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color,
              marginBottom: 'var(--sp-2)',
            }}
          >
            {label}
          </div>
          <div className="meter" style={{ height: 12 }}>
            <div
              className="meter-fill"
              style={{
                width: pct(clamped),
                background:
                  clamped >= 70
                    ? 'var(--green)'
                    : clamped >= 40
                    ? 'var(--amber)'
                    : 'var(--red)',
              }}
            />
          </div>
        </div>
      </div>
    </Panel>
  )
}

/* ── Relationship card ── */

const REL_ICON: Record<RelationshipView['kind'], string> = {
  friendship: '🤝',
  mentorship: '🎓',
  feud: '⚡',
}

const REL_COLOR: Record<RelationshipView['kind'], string> = {
  friendship: 'var(--green)',
  mentorship: 'var(--cyan)',
  feud: 'var(--red)',
}

const REL_KIND_LABEL: Record<RelationshipView['kind'], string> = {
  friendship: 'Friendship',
  mentorship: 'Mentorship',
  feud: 'Feud',
}

function RelCard({ rel }: { rel: RelationshipView }): JSX.Element {
  const color = REL_COLOR[rel.kind]
  const strength = Math.max(0, Math.min(100, rel.strength))
  return (
    <div
      style={{
        background: 'var(--bg2)',
        border: `1px solid var(--line)`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Header: icon + kind */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          fontSize: 11,
          fontWeight: 700,
          color,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
        }}
      >
        <span>{REL_ICON[rel.kind]}</span>
        <span>{REL_KIND_LABEL[rel.kind]}</span>
      </div>
      {/* Both player names */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <PlayerLink playerId={rel.a.playerId} name={rel.a.name} />
        <span className="muted" style={{ fontSize: 11 }}>
          {rel.kind === 'feud' ? 'vs' : '&'}
        </span>
        <PlayerLink playerId={rel.b.playerId} name={rel.b.name} />
      </div>
      {/* Label / context */}
      {rel.label && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{rel.label}</div>
      )}
      {/* Strength bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
        <div className="meter" style={{ flex: 1 }}>
          <div
            className="meter-fill"
            style={{ width: pct(strength), background: color, opacity: 0.85 }}
          />
        </div>
        <span
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            width: 30,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {strength}
        </span>
      </div>
    </div>
  )
}

function RelationshipsPanel({ relationships }: { relationships: RelationshipView[] }): JSX.Element {
  if (relationships.length === 0) {
    return (
      <Panel title="Relationships">
        <span className="muted small">No notable relationships yet — play more games.</span>
      </Panel>
    )
  }
  return (
    <Panel title="Relationships">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 'var(--sp-3)',
        }}
      >
        {relationships.map((rel, i) => (
          <RelCard key={`${rel.a.playerId}-${rel.b.playerId}-${i}`} rel={rel} />
        ))}
      </div>
    </Panel>
  )
}

/* ── Line chemistry panel ── */

function LineFamiliarityPanel({
  lines,
}: {
  lines: LockerRoomView['lineFamiliarity']
}): JSX.Element {
  if (lines.length === 0) {
    return (
      <Panel title="Line Chemistry">
        <span className="muted small">No lines configured — set lines in Tactics.</span>
      </Panel>
    )
  }
  // Separate forward lines from D pairs
  const fwdLines = lines.filter((l) => l.label.startsWith('Line'))
  const pairs = lines.filter((l) => l.label.startsWith('Pair'))

  function LineRow({ line }: { line: (typeof lines)[0] }): JSX.Element {
    const f = Math.max(0, Math.min(100, line.familiarity))
    const chipCls = familiarityChip(f)
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-3)',
          padding: '5px 0',
          borderBottom: '1px solid rgba(42,34,64,0.5)',
        }}
      >
        {/* Label */}
        <span
          style={{
            width: 54,
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--muted)',
            flexShrink: 0,
          }}
        >
          {line.label}
        </span>
        {/* Players */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            fontSize: 13,
            color: 'var(--text)',
          }}
        >
          {line.players.length === 0 ? (
            <span className="muted small">empty</span>
          ) : (
            line.players.map((name, i) => (
              <span key={i} style={{ whiteSpace: 'nowrap' }}>
                {name}
                {i < line.players.length - 1 && (
                  <span style={{ color: 'var(--muted)', margin: '0 2px' }}>·</span>
                )}
              </span>
            ))
          )}
        </div>
        {/* Familiarity chip + bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexShrink: 0 }}>
          <div className="meter" style={{ width: 60 }}>
            <div className="meter-fill" style={{ width: pct(f) }} />
          </div>
          <span className={chipCls} style={{ minWidth: 40, justifyContent: 'center' }}>
            {f}%
          </span>
        </div>
      </div>
    )
  }

  return (
    <Panel title="Line Chemistry">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
        {fwdLines.length > 0 && (
          <div>
            <div className="panel-title" style={{ marginBottom: 'var(--sp-2)' }}>
              Forward Lines
            </div>
            {fwdLines.map((l, i) => (
              <LineRow key={i} line={l} />
            ))}
          </div>
        )}
        {pairs.length > 0 && (
          <div>
            <div className="panel-title" style={{ marginBottom: 'var(--sp-2)' }}>
              Defence Pairs
            </div>
            {pairs.map((l, i) => (
              <LineRow key={i} line={l} />
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ══════════════════════════════════════════════════════════════
   Main export
   ══════════════════════════════════════════════════════════════ */

export function LockerRoomScreen(): JSX.Element {
  const client = useClient()

  const { data, loading, error } = useScreenData<LockerRoomView>(
    () => client.getLockerRoom(),
    (r) => (r.type === 'lockerRoom' ? r.lockerRoom : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="Locker Room" />

      {error && <Notice kind="warn">{error}</Notice>}
      {loading && !data && <Notice kind="info">Loading…</Notice>}

      {!loading && !error && !data && (
        <Notice kind="warn">Locker room data not available — start a career first.</Notice>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          {/* Row 1: morale + leadership side by side */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '220px 1fr',
              gap: 'var(--sp-4)',
              alignItems: 'start',
            }}
          >
            <MoralePanel morale={data.roomMorale} />
            <LeadershipPanel view={data} />
          </div>

          {/* Row 2: relationships */}
          <RelationshipsPanel relationships={data.relationships} />

          {/* Row 3: line chemistry */}
          <LineFamiliarityPanel lines={data.lineFamiliarity} />
        </div>
      )}
    </section>
  )
}
