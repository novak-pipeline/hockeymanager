import type { DashboardView } from '../../worker/protocol'
import { useShellActions } from './ActionsContext'
import { fmtDate } from './format'

const PHASE_LABEL: Record<DashboardView['phase'], string> = {
  regularSeason: 'Regular season',
  playoffs: 'Playoffs',
  offseason: 'Offseason',
}

const PHASE_CHIP: Record<DashboardView['phase'], string> = {
  regularSeason: 'chip chip-accent',
  playoffs: 'chip chip-warn',
  offseason: 'chip',
}

/**
 * Top bar: calendar position + phase on the left, next-game strip in the
 * middle, and the big CONTINUE plus secondary sim controls on the right.
 */
export function TopBar(props: { dashboard: DashboardView | null }): JSX.Element {
  const actions = useShellActions()
  const d = props.dashboard
  const next = d?.nextGame ?? null

  return (
    <header className="topbar">
      <div className="topbar-date">
        <span className="topbar-date-main">{d ? fmtDate(d.date) : '—'}</span>
        <span className="topbar-date-sub">
          {d && <span>{d.year} season</span>}
          {d && <span className={PHASE_CHIP[d.phase]}>{PHASE_LABEL[d.phase]}</span>}
        </span>
      </div>

      <div className="next-strip">
        {next ? (
          <>
            <span>Next:</span>
            <strong>
              {next.home ? 'vs' : '@'} {next.opponentName}
            </strong>
            <span className="chip">#{next.opponentRank}</span>
            <span>{fmtDate(next.date)}</span>
          </>
        ) : (
          <span>{d?.championTeamName ? `${d.championTeamName} are champions` : 'No upcoming fixture'}</span>
        )}
      </div>

      <div className="topbar-actions">
        {next && (
          <button className="btn btn-ghost" onClick={actions.watchNext} disabled={actions.busy}>
            Watch next game
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => actions.advanceDays(1)} disabled={actions.busy}>
          Sim day
        </button>
        <button className="btn btn-ghost" onClick={() => actions.advanceDays(7)} disabled={actions.busy}>
          +7 days
        </button>
        <button className="btn btn-ghost" onClick={actions.toNextGame} disabled={actions.busy}>
          To next game
        </button>
        <button className="btn btn-primary btn-lg" onClick={actions.continueGame} disabled={actions.busy}>
          {actions.busy ? '…' : d?.continueLabel ?? 'Continue'}
        </button>
      </div>
    </header>
  )
}
