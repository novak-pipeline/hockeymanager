import type { DashboardView } from '../../worker/protocol'
import { useShellActions } from './ActionsContext'
import { Crest } from './Crest'
import { fmtDate } from './format'
import { useNav } from './NavContext'

const PHASE_CHIP: Record<DashboardView['phase'], string> = {
  regularSeason: 'chip chip-violet',
  playoffs:      'chip chip-warn',
  offseason:     'chip',
}

const PHASE_LABEL: Record<DashboardView['phase'], string> = {
  regularSeason: 'Regular season',
  playoffs:      'Playoffs',
  offseason:     'Offseason',
}

/**
 * Slim topbar (sits to the right of the SideNav): club identity | date + phase +
 * next game | back/save/load + sim controls + Continue. All section/screen
 * navigation now lives in the left SideNav.
 */
export function TopNav(props: {
  teamId: string
  clubName: string
  clubAbbr: string
  dashboard: DashboardView | null
  busy: boolean
  engineVersion: string
  onSave: () => void
  onLoad: () => void
}): JSX.Element {
  const nav = useNav()
  const actions = useShellActions()
  const d = props.dashboard
  const standing = d?.userTeam.standing ?? null
  const next = d?.nextGame ?? null

  return (
    <header className="topnav">
      <div className="topnav-row1">
        {/* Club identity */}
        <div className="topnav-club">
          <Crest teamId={props.teamId} abbr={props.clubAbbr} className="topnav-crest" />
          <div>
            <div className="topnav-club-name">{d?.userTeam.name ?? props.clubName}</div>
            <div className="topnav-club-record">
              {standing
                ? `${standing.wins}–${standing.losses}–${standing.overtimeLosses} · ${standing.points} pts`
                : '—'}
            </div>
          </div>
        </div>

        {/* Date + phase + next game (center) */}
        <div className="topnav-date">
          <span className="topnav-date-main">{d ? fmtDate(d.date) : '—'}</span>
          <div className="topnav-date-sub">
            {d && <span>{d.year} season</span>}
            {d && <span className={PHASE_CHIP[d.phase]}>{PHASE_LABEL[d.phase]}</span>}
          </div>
          {next && (
            <div className="topnav-next">
              <span>Next:</span>
              <strong>{next.home ? 'vs' : '@'} {next.opponentName}</strong>
              <span className="chip" style={{ fontSize: 10 }}>#{next.opponentRank}</span>
              <span>{fmtDate(next.date)}</span>
            </div>
          )}
        </div>

        {/* Actions right cluster */}
        <div className="topnav-actions">
          <button
            className="topnav-util-btn"
            onClick={() => nav.goBack()}
            disabled={!nav.canGoBack}
            title="Go back"
            aria-label="Go back"
          >
            ◄ Back
          </button>
          <button className="topnav-util-btn" onClick={props.onSave} disabled={props.busy} title="Save career">
            Save
          </button>
          <button className="topnav-util-btn" onClick={props.onLoad} disabled={props.busy} title="Load career">
            Load
          </button>

          <div className="sim-secondary">
            <button className="btn" onClick={() => actions.advanceDays(1)} disabled={actions.busy} title="Simulate 1 day">
              Sim day
            </button>
            <button className="btn" onClick={() => actions.advanceDays(7)} disabled={actions.busy} title="Simulate 7 days">
              +7d
            </button>
            <button className="btn" onClick={actions.toNextGame} disabled={actions.busy} title="Advance to next fixture">
              To game
            </button>
            {next && (
              <button className="btn" onClick={actions.watchNext} disabled={actions.busy} title="Watch next game in full viewer">
                Watch
              </button>
            )}
          </div>

          <button
            className="topnav-util-btn"
            onClick={() => nav.navigate('settings')}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>

          <span className="topnav-version">v{props.engineVersion}</span>

          <button className="btn btn-hero btn-lg" onClick={actions.continueGame} disabled={actions.busy}>
            {actions.busy ? '…' : (d?.continueLabel ?? 'Continue')}
          </button>
        </div>
      </div>
    </header>
  )
}
