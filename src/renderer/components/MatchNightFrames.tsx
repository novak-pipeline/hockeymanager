/**
 * Match night frames (P6, B6.1/B6.2) — the pregame match-day card and the
 * postgame receipts rendered inside the ProcessingOverlay for SIMMED games.
 *
 * Pure presentation: everything shown comes from MatchDayPreviewView /
 * PostgameReceiptView (engine-built, real numbers). The watched-game path has
 * its own presentation (MatchViewer); these frames give the common simmed path
 * its ritual — opponent + storyline + keys before, receipts after.
 */
import type { CSSProperties } from 'react'
import type { MatchDayPreviewView, PostgameReceiptView } from '@engine/career/views'

const label: CSSProperties = {
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: 'var(--violet-h, #b9a7ff)',
  fontWeight: 800,
}

/* ────────────────────────── pregame (B6.1) ────────────────────────── */

function LinesColumn({ side, align }: { side: MatchDayPreviewView['user']; align: 'left' | 'right' }): JSX.Element {
  const ta = align === 'left' ? 'left' : 'right'
  return (
    <div style={{ minWidth: 0, textAlign: ta as 'left' | 'right' }}>
      <div style={{ fontSize: 14, fontWeight: 800 }}>
        {side.teamAbbr} <span className="muted" style={{ fontWeight: 500 }}>({side.record})</span>
      </div>
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {side.forwardLines.map((l, i) => (
          <div key={`f${i}`} style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span className="muted" style={{ fontWeight: 700, marginRight: 4 }}>L{i + 1}</span>
            {l.map((n) => n.split(' ').slice(-1)[0]).join(' · ')}
          </div>
        ))}
        {side.defensePairs.map((l, i) => (
          <div key={`d${i}`} style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span className="muted" style={{ fontWeight: 700, marginRight: 4 }}>D{i + 1}</span>
            {l.map((n) => n.split(' ').slice(-1)[0]).join(' · ')}
          </div>
        ))}
        {side.starter && (
          <div style={{ fontSize: 11.5, marginTop: 2 }}>
            <span className="muted" style={{ fontWeight: 700, marginRight: 4 }}>G</span>
            {side.starter.name} <span className="muted">({side.starter.seasonLine})</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function PregameFrame({
  preview,
  busy,
  onPlay,
  onWatch,
  onClose,
}: {
  preview: MatchDayPreviewView
  busy: boolean
  onPlay: () => void
  onWatch: () => void
  onClose: () => void
}): JSX.Element {
  const p = preview
  return (
    <div style={{ padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', overflowY: 'auto' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={label}>{p.playoff ? 'Playoff match day' : 'Match day'} · {p.date}</div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.4, lineHeight: 1.1, marginTop: 4 }}>
            {p.home ? 'vs' : '@'} {p.opponentName}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {p.opponentRank > 0 ? `${ordinal(p.opponentRank)} in the league · ` : ''}
            {p.opponent.record}
            {p.rivalryLabel ? ' · ' : ''}
            {p.rivalryLabel && <span style={{ color: 'var(--red, #f87171)', fontWeight: 700 }}>{p.rivalryLabel}</span>}
          </div>
        </div>
        <button className="btn btn-ghost" onClick={onClose} title="Close (return to your screen)" style={{ width: 30, height: 30, padding: 0, borderRadius: 8, fontSize: 18, lineHeight: 1 }}>
          &times;
        </button>
      </div>

      {/* storyline */}
      {(p.allTime || p.storyline) && (
        <div className="card" style={{ padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5 }}>
          {p.allTime && <div>{p.allTime}</div>}
          {p.storyline && <div>{p.storyline}</div>}
        </div>
      )}

      {/* keys to the game */}
      <div>
        <div style={{ ...label, marginBottom: 6 }}>Keys to the game</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {p.keys.map((k) => (
            <div key={k.title} className="card" style={{ padding: '8px 11px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{k.title}</div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.45, marginTop: 2 }}>{k.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* projected lines, yours vs theirs */}
      <div>
        <div style={{ ...label, marginBottom: 6 }}>Projected lines</div>
        <div className="card" style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <LinesColumn side={p.user} align="left" />
          <LinesColumn side={p.opponent} align="right" />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', marginTop: 'auto', paddingTop: 'var(--sp-1)' }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button>
        <button className="btn btn-ghost" onClick={onWatch} disabled={busy}>Watch live</button>
        <button className="btn btn-primary" onClick={onPlay} disabled={busy}>
          {busy ? 'Processing…' : 'Continue — play the game'}
        </button>
      </div>
    </div>
  )
}

/* ────────────────────────── postgame (B6.2) ────────────────────────── */

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function periodLabels(count: number): string[] {
  const out: string[] = []
  for (let i = 1; i <= count; i++) out.push(i <= 3 ? String(i) : count === 4 ? 'OT' : `OT${i - 3}`)
  return out
}

export function PostgameFrame({
  receipt,
  onOpenBoxScore,
}: {
  receipt: PostgameReceiptView
  onOpenBoxScore: () => void
}): JSX.Element {
  const r = receipt
  const suffix = r.decidedBy === 'overtime' ? ' (OT)' : r.decidedBy === 'shootout' ? ' (SO)' : ''
  const cols = periodLabels(r.homeByPeriod.length)
  const starGlyph = ['★', '★★', '★★★']
  return (
    <div className="card" style={{ padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      {/* score banner */}
      <div>
        <div style={label}>{r.playoff ? 'Playoff final' : 'Final'}{suffix ? ` — ${r.decidedBy === 'overtime' ? 'overtime' : 'shootout'}` : ''}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.4 }}>
            {r.awayAbbr} {r.awayGoals} @ {r.homeAbbr} {r.homeGoals}
          </div>
          <span
            style={{
              fontSize: 12, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
              background: r.won ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
              color: r.won ? 'var(--green, #4ade80)' : 'var(--red, #f87171)',
            }}
          >
            {r.won ? 'WIN' : 'LOSS'}{suffix}
          </span>
        </div>
        {/* period breakdown */}
        <table style={{ marginTop: 8, fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr className="muted">
              <th style={{ textAlign: 'left', paddingRight: 12, fontWeight: 700 }}></th>
              {cols.map((c) => (
                <th key={c} style={{ textAlign: 'right', paddingLeft: 12, fontWeight: 700 }}>{c}</th>
              ))}
              <th style={{ textAlign: 'right', paddingLeft: 12, fontWeight: 700 }}>T</th>
              <th style={{ textAlign: 'right', paddingLeft: 14, fontWeight: 700 }}>SOG</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 700 }}>{r.awayAbbr}</td>
              {r.awayByPeriod.map((g, i) => (
                <td key={i} style={{ textAlign: 'right', paddingLeft: 12 }}>{g}</td>
              ))}
              <td style={{ textAlign: 'right', paddingLeft: 12, fontWeight: 800 }}>{r.awayGoals}</td>
              <td className="muted" style={{ textAlign: 'right', paddingLeft: 14 }}>{r.awayShots}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>{r.homeAbbr}</td>
              {r.homeByPeriod.map((g, i) => (
                <td key={i} style={{ textAlign: 'right', paddingLeft: 12 }}>{g}</td>
              ))}
              <td style={{ textAlign: 'right', paddingLeft: 12, fontWeight: 800 }}>{r.homeGoals}</td>
              <td className="muted" style={{ textAlign: 'right', paddingLeft: 14 }}>{r.homeShots}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* turning point */}
      {r.turningPoint && (
        <div style={{ borderLeft: '3px solid var(--violet-h, #7c5ce7)', paddingLeft: 10 }}>
          <div style={label}>The turning point</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 2 }}>{r.turningPoint.text}</div>
        </div>
      )}

      {/* three stars */}
      {r.stars.length > 0 && (
        <div>
          <div style={{ ...label, marginBottom: 4 }}>Three stars</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {r.stars.map((s, i) => (
              <div key={s.playerId} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5 }}>
                <span style={{ color: 'var(--amber, #fbbf24)', fontWeight: 800, width: 34 }}>{starGlyph[i]}</span>
                <span style={{ fontWeight: 700 }}>{s.name}</span>
                <span className="muted">{s.teamAbbr} · {s.statLine} · {s.rating.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* B6.3 storyline */}
      {r.storyline && (
        <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8, padding: '8px 11px' }}>
          <div style={{ ...label, color: 'var(--amber, #fbbf24)' }}>One for the books</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 2 }}>{r.storyline}</div>
        </div>
      )}

      {/* coach's word */}
      {r.quote && (
        <div>
          <div style={label}>From the podium</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, fontStyle: 'italic', marginTop: 2 }}>
            “{r.quote.text}”
          </div>
          <div className="muted small" style={{ marginTop: 3 }}>— {r.quote.speaker}</div>
        </div>
      )}

      {/* top grades */}
      {r.grades.length > 0 && (
        <div className="muted" style={{ fontSize: 11.5 }}>
          Grades: {r.grades.slice(0, 5).map((g) => `${g.name.split(' ').slice(-1)[0]} ${g.rating.toFixed(1)}`).join(' · ')}
        </div>
      )}

      <div>
        <button className="btn btn-ghost" onClick={onOpenBoxScore} style={{ fontSize: 12 }}>
          Full box score
        </button>
      </div>
    </div>
  )
}
