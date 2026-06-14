import type { FinanceView, PayrollRowView } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { fmtMoney } from '../components/format'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/** Cap bar header, payroll table by salary desc, expiring contracts panel. */
export function FinancesScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<FinanceView>(
    () => client.getFinances(),
    (r) => (r.type === 'finances' ? r.finances : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="Finances" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No finance data yet."
      />
      {data && <FinancesBody data={data} />}
    </section>
  )
}

/* ── internal ── */

function FinancesBody(props: { data: FinanceView }): JSX.Element {
  const d = props.data
  const sorted = [...d.payroll].sort((a, b) => b.salary - a.salary)

  return (
    <div className="stack">
      {/* ── cap summary ── */}
      <Panel title="Salary cap">
        <CapHeader
          capUsed={d.capUsed}
          salaryCap={d.salaryCap}
          capSpace={d.capSpace}
          leagueAvg={d.leagueAvgPayroll}
        />
      </Panel>

      {/* ── salary by position + revenue ── */}
      {(d.byPosition || d.revenue) && (
        <div className="grid-2">
          {d.byPosition && (
            <Panel title="Salary by position">
              <BySegment rows={d.byPosition.map((b) => ({ label: `${b.group} (${b.count})`, amount: b.total }))} total={d.capUsed} />
            </Panel>
          )}
          {d.revenue && (
            <Panel title={`Revenue · ${d.revenue.marketSizeLabel}`}>
              <BySegment rows={d.revenue.lines.map((l) => ({ label: l.source, amount: l.amount }))} total={d.revenue.estimatedRevenue} />
              <div className="row-between small" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <span className="muted">Estimated total</span>
                <strong>{fmtMoney(d.revenue.estimatedRevenue)}</strong>
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* ── multi-year wage commitments ── */}
      {d.commitments && (
        <Panel title="Wage commitments">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Season</th><th className="num">Committed</th><th className="num">Players</th><th className="num">Cap space</th></tr>
              </thead>
              <tbody>
                {d.commitments.map((c) => (
                  <tr key={c.year}>
                    <td>{c.year}–{(c.year + 1) % 100}</td>
                    <td className="num"><strong>{fmtMoney(c.committed)}</strong></td>
                    <td className="num muted">{c.players}</td>
                    <td className="num" style={{ color: d.salaryCap - c.committed < 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {fmtMoney(d.salaryCap - c.committed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            Committed = salary still on the books that season (assumes a flat cap). Excludes future re-signings and entry-level deals.
          </p>
        </Panel>
      )}

      {/* ── payroll table ── */}
      <Panel title="Payroll">
        <PayrollTable rows={sorted} />
      </Panel>

      {/* ── expiring panel ── */}
      {d.expiring.length > 0 && (
        <Panel title="Expiring contracts">
          <ExpiringTable rows={d.expiring} />
        </Panel>
      )}
    </div>
  )
}

function CapHeader(props: {
  capUsed: number
  salaryCap: number
  capSpace: number
  leagueAvg: number
}): JSX.Element {
  const { capUsed, salaryCap, capSpace, leagueAvg } = props
  const pct = salaryCap > 0 ? (capUsed / salaryCap) * 100 : 0
  const avgPct = salaryCap > 0 ? (leagueAvg / salaryCap) * 100 : 0
  const fillClass =
    pct > 100 ? 'meter-fill over' : pct > 92 ? 'meter-fill warn' : 'meter-fill'

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      {/* dollar labels */}
      <div className="row-between">
        <div>
          <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fmtMoney(capUsed)}
          </span>{' '}
          <span className="muted">used</span>
        </div>
        <div className="muted small" style={{ textAlign: 'right' }}>
          <div>Cap {fmtMoney(salaryCap)}</div>
          <div>Space <strong style={{ color: capSpace < 0 ? 'var(--danger)' : 'var(--success)' }}>{fmtMoney(capSpace)}</strong></div>
        </div>
      </div>

      {/* bar with league-avg marker */}
      <div style={{ position: 'relative' }}>
        <div className="meter">
          <div className={fillClass} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
        {/* league-avg tick */}
        <div
          title={`League avg ${fmtMoney(leagueAvg)}`}
          style={{
            position: 'absolute',
            top: -3,
            left: `${Math.min(100, Math.max(0, avgPct))}%`,
            width: 2,
            height: 14,
            background: 'var(--muted)',
            borderRadius: 1,
          }}
        />
      </div>

      <div className="row muted small" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <span>Cap: {fmtMoney(salaryCap)}</span>
        <span>Used: {pct.toFixed(1)}%</span>
        <span>League avg: {fmtMoney(leagueAvg)}</span>
      </div>
    </div>
  )
}

/** A simple labelled bar breakdown summing to `total`. */
function BySegment(props: { rows: Array<{ label: string; amount: number }>; total: number }): JSX.Element {
  const max = Math.max(1, ...props.rows.map((r) => r.amount))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 'var(--sp-1)' }}>
      {props.rows.map((r) => {
        const pct = props.total > 0 ? (r.amount / props.total) * 100 : 0
        return (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="small" style={{ width: 110 }}>{r.label}</span>
            <span className="meter" style={{ flex: 1, height: 10 }}>
              <span className="meter-fill" style={{ width: `${(r.amount / max) * 100}%`, background: 'var(--violet, #8b5cf6)' }} />
            </span>
            <span className="small" style={{ width: 86, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount)}</span>
            <span className="small muted" style={{ width: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
          </div>
        )
      })}
    </div>
  )
}

function PayrollTable(props: { rows: PayrollRowView[] }): JSX.Element {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Pos</th>
            <th className="num">Salary</th>
            <th className="num">Yrs</th>
            <th className="num">Expiry</th>
            <th>Clauses</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr key={row.playerId}>
              <td className="muted">{i + 1}</td>
              <td>
                <PlayerLink playerId={row.playerId} name={row.name} />
              </td>
              <td className="muted">{row.position}</td>
              <td className="num">
                <strong>{fmtMoney(row.salary)}</strong>
              </td>
              <td className="num">{row.yearsRemaining}</td>
              <td className="num muted">{row.expiryYear}</td>
              <td>
                <ContractClauses ntc={row.noTradeClause} twoWay={row.twoWay} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ContractClauses(props: { ntc: boolean; twoWay: boolean }): JSX.Element {
  if (!props.ntc && !props.twoWay) return <span className="muted">—</span>
  return (
    <span className="row" style={{ gap: 'var(--sp-1)' }}>
      {props.ntc && <span className="chip chip-warn">NTC</span>}
      {props.twoWay && <span className="chip">2-way</span>}
    </span>
  )
}

function ExpiringTable(props: { rows: PayrollRowView[] }): JSX.Element {
  const sorted = [...props.rows].sort((a, b) => b.salary - a.salary)
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Pos</th>
            <th className="num">Salary</th>
            <th className="num">Expiry</th>
            <th>Clauses</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.playerId}>
              <td>
                <PlayerLink playerId={row.playerId} name={row.name} />
              </td>
              <td className="muted">{row.position}</td>
              <td className="num">
                <strong>{fmtMoney(row.salary)}</strong>
              </td>
              <td className="num muted">{row.expiryYear}</td>
              <td>
                <ContractClauses ntc={row.noTradeClause} twoWay={row.twoWay} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
