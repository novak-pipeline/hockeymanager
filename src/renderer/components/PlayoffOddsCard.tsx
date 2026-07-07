/** Monte-Carlo playoff odds, rendered as the user's conference race with the
 *  cut line. Shared by the Data Hub (home) and anywhere else the picture is
 *  worth a panel. */
import type { PlayoffOddsView } from '../../worker/protocol'
import { TeamLink } from './NavContext'

export function oddsColor(pct: number): string {
  if (pct >= 85) return 'var(--success)'
  if (pct >= 45) return 'var(--accent, #f5b301)'
  if (pct >= 15) return 'var(--amber, #f59e0b)'
  return 'var(--danger)'
}

export function PlayoffOddsCard({ view }: { view: PlayoffOddsView }): JSX.Element {
  const user = view.rows.find((r) => r.isUser)
  // The user's conference, by projected points, with the top-4 playoff cut line.
  const conf = user ? view.rows.filter((r) => r.conference === user.conference) : []

  return (
    <div className="list">
      {user && (
        <div className="row-between" style={{ alignItems: 'baseline', marginBottom: 6 }}>
          <span>
            <span style={{ fontSize: 22, fontWeight: 800, color: oddsColor(user.playoffPct) }}>{user.playoffPct}%</span>
            <span className="muted small"> to make the playoffs</span>
          </span>
          <span className="muted small">proj. {user.projectedPoints} pts</span>
        </div>
      )}
      <div className="muted small" style={{ marginBottom: 4, opacity: 0.7 }}>
        {user?.conference} — top 4 make it ({view.simulations} sims)
      </div>
      {conf.map((r, i) => (
        <div key={r.teamId}>
          {i === 4 && <div style={{ borderTop: '1px dashed var(--danger)', opacity: 0.5, margin: '3px 0' }} />}
          <div
            className="row-between small"
            style={{ alignItems: 'center', gap: 8, fontWeight: r.isUser ? 700 : 400, color: r.isUser ? 'var(--violet-h)' : undefined }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {i + 1}. <TeamLink teamId={r.teamId} name={r.abbreviation} /> <span className="muted">{r.points}p · {r.gamesRemaining} left</span>
            </span>
            <span className="mono" style={{ color: oddsColor(r.playoffPct), fontWeight: 700, minWidth: 38, textAlign: 'right' }}>
              {r.playoffPct}%
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
