/** "How you stack up" — the club's rank across the league on every axis the
 *  front office tracks. Analytics content, so it lives in the Data Hub. */
import type { LeagueComparisonView, LeagueComparisonCard } from '../../worker/protocol'
import { TeamLink } from './NavContext'

function rankColor(percentile: number): string {
  if (percentile >= 0.66) return 'var(--success)'
  if (percentile >= 0.33) return 'var(--amber, #f59e0b)'
  return 'var(--danger)'
}

export function StacksUpCard({ view }: { view: LeagueComparisonView }): JSX.Element {
  return (
    <div className="list">
      <div className="muted small" style={{ marginBottom: 4, opacity: 0.75 }}>
        Your rank across the NHL — 1 is best.
      </div>
      {view.cards.map((c: LeagueComparisonCard) => {
        const color = rankColor(c.percentile)
        return (
          <div key={c.key} className="row-between small" style={{ alignItems: 'center', gap: 8 }} title={c.blurb}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.label}
              <span className="muted" style={{ marginLeft: 6 }}>{c.display}</span>
            </span>
            <span className="row" style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
              {!c.isUserLeader && (
                <span className="muted" style={{ fontSize: 10 }} title={`League leader: ${c.leaderAbbr} (${c.leaderDisplay})`}>
                  led by <TeamLink teamId={c.leaderTeamId} name={c.leaderAbbr} />
                </span>
              )}
              <span
                className="mono"
                style={{ color, fontWeight: 700, minWidth: 52, textAlign: 'right' }}
              >
                {c.isUserLeader ? '★ ' : ''}{c.rank}<span className="muted" style={{ fontWeight: 400 }}>/{c.outOf}</span>
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
