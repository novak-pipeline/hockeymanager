import type {
  BoxScoreGoalieRow,
  BoxScoreSkaterRow,
  BoxScoreView,
  GoalLogRow,
  PenaltyLogRow,
} from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { fmtToi } from '../components/format'
import { useTeamColorMap, colorFromMap } from '../components/Crest'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

const PERIOD_LABELS = ['1st', '2nd', '3rd']

function periodLabel(index: number): string {
  return PERIOD_LABELS[index] ?? `OT${index - 2}`
}

const STRENGTH_LABELS: Record<GoalLogRow['strength'], string> = {
  ev: 'EV',
  pp: 'PP',
  sh: 'SH',
  en: 'EN',
}
const STRENGTH_CLASS: Record<GoalLogRow['strength'], string> = {
  ev: '',
  pp: 'chip-accent',
  sh: 'chip-warn',
  en: 'chip-danger',
}

export function MatchCenterScreen(): JSX.Element {
  const client = useClient()
  const colorMap = useTeamColorMap()
  const { data, loading, error } = useScreenData<BoxScoreView>(
    () => client.getLastBoxScore(),
    (r) => (r.type === 'boxScore' ? r.boxScore : null)
  )

  if (error) {
    return (
      <section>
        <ScreenHeader title="Match Center" />
        <Notice kind="warn">{error}</Notice>
      </section>
    )
  }
  if (!data) {
    return (
      <section>
        <ScreenHeader title="Match Center" />
        <Notice kind="info">
          {loading ? 'Loading…' : 'No completed user game yet.'}
        </Notice>
      </section>
    )
  }

  const d = data
  const awayWon = d.awayGoals > d.homeGoals
  const homeWon = d.homeGoals > d.awayGoals
  const awayColor = colorFromMap(colorMap, d.awayAbbr)
  const homeColor = colorFromMap(colorMap, d.homeAbbr)

  const periodCount = Math.max(d.homeByPeriod.length, d.awayByPeriod.length)

  return (
    <section className="stack">
      <ScreenHeader title="Match Center" />

      {/* Scoreline hero */}
      <Panel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            gap: 'var(--sp-5)',
          }}
        >
          {/* Away team */}
          <TeamScore
            abbr={d.awayAbbr}
            name={d.awayName}
            goals={d.awayGoals}
            shots={d.awayShots}
            color={awayColor}
            won={awayWon}
            side="left"
          />

          {/* Center divider */}
          <div style={{ textAlign: 'center' }}>
            <div className="muted small" style={{ marginBottom: 6 }}>Final</div>
            {d.decidedBy !== 'regulation' && (
              <div style={{ marginBottom: 4 }}>
                <span className="chip chip-warn" style={{ fontSize: 11 }}>
                  {d.decidedBy === 'overtime' ? 'OT' : 'SO'}
                </span>
              </div>
            )}
            <div className="muted small">{d.awayAbbr} @ {d.homeAbbr}</div>
          </div>

          {/* Home team */}
          <TeamScore
            abbr={d.homeAbbr}
            name={d.homeName}
            goals={d.homeGoals}
            shots={d.homeShots}
            color={homeColor}
            won={homeWon}
            side="right"
          />
        </div>
      </Panel>

      {/* By-period table */}
      <Panel title="Scoring by period">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Team</th>
                {Array.from({ length: periodCount }).map((_, i) => (
                  <th key={i} className="num">{periodLabel(i)}</th>
                ))}
                <th className="num">T</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  { abbr: d.awayAbbr, byPeriod: d.awayByPeriod, total: d.awayGoals },
                  { abbr: d.homeAbbr, byPeriod: d.homeByPeriod, total: d.homeGoals },
                ] as const
              ).map((row) => (
                <tr key={row.abbr}>
                  <td style={{ fontWeight: 600 }}>{row.abbr}</td>
                  {Array.from({ length: periodCount }).map((_, i) => (
                    <td key={i} className="num">{row.byPeriod[i] ?? 0}</td>
                  ))}
                  <td className="num">
                    <strong>{row.total}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Scoring summary */}
      {d.goals.length > 0 && (
        <Panel title="Goals">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Per</th>
                  <th>Time</th>
                  <th>Team</th>
                  <th>Goal</th>
                  <th>Type</th>
                  <th className="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {d.goals.map((g, i) => (
                  <GoalRow key={i} goal={g} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Penalties */}
      {d.penalties.length > 0 && (
        <Panel title="Penalties">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Per</th>
                  <th>Time</th>
                  <th>Team</th>
                  <th>Player</th>
                  <th>Infraction</th>
                  <th className="num">Min</th>
                </tr>
              </thead>
              <tbody>
                {d.penalties.map((p, i) => (
                  <PenaltyRow key={i} penalty={p} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Skater stats — away then home */}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <SkaterTable abbr={d.awayAbbr} name={d.awayName} rows={d.awaySkaters} />
        <SkaterTable abbr={d.homeAbbr} name={d.homeName} rows={d.homeSkaters} />
      </div>

      {/* Goalie lines */}
      {(d.awayGoalies.length > 0 || d.homeGoalies.length > 0) && (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <GoalieTable abbr={d.awayAbbr} rows={d.awayGoalies} />
          <GoalieTable abbr={d.homeAbbr} rows={d.homeGoalies} />
        </div>
      )}
    </section>
  )
}

function TeamScore(props: {
  abbr: string
  name: string
  goals: number
  shots: number
  color: string
  won: boolean
  side: 'left' | 'right'
}): JSX.Element {
  const { abbr, name, goals, shots, color, won, side } = props
  const isLeft = side === 'left'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isLeft ? 'flex-end' : 'flex-start',
        gap: 6,
      }}
    >
      {/* Crest + name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          flexDirection: isLeft ? 'row-reverse' : 'row',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: color,
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {abbr}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
      </div>

      {/* Score */}
      <div
        style={{
          fontSize: 48,
          fontWeight: 800,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          color: won ? 'var(--text)' : 'var(--muted)',
        }}
      >
        {goals}
      </div>

      {/* Shots */}
      <div className="muted small">{shots} shots</div>
    </div>
  )
}

function GoalRow(props: { goal: GoalLogRow }): JSX.Element {
  const g = props.goal
  const chipClass = STRENGTH_CLASS[g.strength]
  return (
    <tr>
      <td className="muted">{periodLabel(g.period - 1)}</td>
      <td className="mono muted">{g.clock}</td>
      <td style={{ fontWeight: 600 }}>{g.teamAbbr}</td>
      <td>
        <span style={{ fontWeight: 600 }}>{g.scorer}</span>
        {g.assists.length > 0 && (
          <span className="muted"> ({g.assists.join(', ')})</span>
        )}
      </td>
      <td>
        <span className={`chip${chipClass ? ` ${chipClass}` : ''}`} style={{ fontSize: 10 }}>
          {STRENGTH_LABELS[g.strength]}
        </span>
      </td>
      <td className="num mono">
        {g.awayScore}–{g.homeScore}
      </td>
    </tr>
  )
}

function PenaltyRow(props: { penalty: PenaltyLogRow }): JSX.Element {
  const p = props.penalty
  return (
    <tr>
      <td className="muted">{periodLabel(p.period - 1)}</td>
      <td className="mono muted">{p.clock}</td>
      <td style={{ fontWeight: 600 }}>{p.teamAbbr}</td>
      <td>{p.player}</td>
      <td className="muted">{p.infraction}</td>
      <td className="num">{p.minutes}</td>
    </tr>
  )
}

function SkaterTable(props: {
  abbr: string
  name: string
  rows: BoxScoreSkaterRow[]
}): JSX.Element {
  const { abbr, name, rows } = props

  // Sort: most points first, then goals, then TOI
  const sorted = [...rows].sort((a, b) => {
    const aPts = a.goals + a.assists
    const bPts = b.goals + b.assists
    if (bPts !== aPts) return bPts - aPts
    if (b.goals !== a.goals) return b.goals - a.goals
    return b.toi - a.toi
  })

  return (
    <Panel title={`${abbr} — ${name}`}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">Pos</th>
              <th className="num">G</th>
              <th className="num">A</th>
              <th className="num">S</th>
              <th className="num">PIM</th>
              <th className="num">TOI</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <SkaterRow key={r.playerId} row={r} />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: 'center' }}>
                  No data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function SkaterRow(props: { row: BoxScoreSkaterRow }): JSX.Element {
  const r = props.row
  const pts = r.goals + r.assists
  return (
    <tr>
      <td>
        <PlayerLink playerId={r.playerId} name={r.name} />
      </td>
      <td className="num muted">{r.position}</td>
      <td className="num">{r.goals > 0 ? <strong>{r.goals}</strong> : r.goals}</td>
      <td className="num">{r.assists > 0 ? <strong>{r.assists}</strong> : r.assists}</td>
      <td className="num">{r.shots}</td>
      <td className="num">{r.penaltyMinutes > 0 ? r.penaltyMinutes : <span className="muted">—</span>}</td>
      <td className="num mono">{fmtToi(r.toi)}</td>
    </tr>
  )
}

function GoalieTable(props: { abbr: string; rows: BoxScoreGoalieRow[] }): JSX.Element {
  const { abbr, rows } = props
  if (rows.length === 0) return <></>
  return (
    <Panel title={`${abbr} — Goalies`}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Goalie</th>
              <th className="num">SA</th>
              <th className="num">SV</th>
              <th className="num">GA</th>
              <th className="num">SV%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <GoalieRow key={r.playerId} row={r} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function GoalieRow(props: { row: BoxScoreGoalieRow }): JSX.Element {
  const r = props.row
  const svPct = r.shotsAgainst > 0 ? (r.saves / r.shotsAgainst).toFixed(3) : '—'
  return (
    <tr>
      <td>
        <PlayerLink playerId={r.playerId} name={r.name} />
      </td>
      <td className="num">{r.shotsAgainst}</td>
      <td className="num">{r.saves}</td>
      <td className="num">{r.goalsAgainst}</td>
      <td className="num mono">{svPct}</td>
    </tr>
  )
}
