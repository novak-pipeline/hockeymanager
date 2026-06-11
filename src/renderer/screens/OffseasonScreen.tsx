import { useState } from 'react'
import type { OffseasonView } from '../../worker/protocol'
import type { FreeAgentRowView, ResignRowView } from '../../engine/career/views'
import { PlayerLink, useNav } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { fmtMoney } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

// ─── stage stepper ────────────────────────────────────────────────────────────

const STAGE_ORDER: OffseasonView['stage'][] = ['awards', 'draft', 'resign', 'freeAgency', 'preseason']
const STAGE_LABELS: Record<OffseasonView['stage'], string> = {
  awards: 'Awards',
  draft: 'Draft',
  resign: 'Re-sign',
  freeAgency: 'Free Agency',
  preseason: 'Preseason',
}

function StageStepper(props: { stage: OffseasonView['stage']; stageLabel: string }): JSX.Element {
  const idx = STAGE_ORDER.indexOf(props.stage)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        overflowX: 'auto',
      }}
    >
      {STAGE_ORDER.map((s, i) => {
        const past = i < idx
        const current = i === idx
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STAGE_ORDER.length - 1 ? '1 1 0' : 'none' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 12,
                  background: past
                    ? 'rgba(95,208,104,0.2)'
                    : current
                      ? 'var(--accent)'
                      : 'var(--bg2)',
                  border: past
                    ? '1px solid rgba(95,208,104,0.5)'
                    : current
                      ? 'none'
                      : '1px solid var(--line)',
                  color: past
                    ? 'var(--success)'
                    : current
                      ? '#04122b'
                      : 'var(--muted)',
                }}
              >
                {past ? '✓' : i + 1}
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: current ? 700 : 400,
                  color: current ? 'var(--text)' : 'var(--muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {STAGE_LABELS[s]}
              </span>
            </div>
            {i < STAGE_ORDER.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: past ? 'rgba(95,208,104,0.4)' : 'var(--line)',
                  margin: '0 6px',
                  marginBottom: 20,
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── cap bar ──────────────────────────────────────────────────────────────────

function CapBar(props: { used: number; cap: number }): JSX.Element {
  const pct = Math.min(100, (props.used / props.cap) * 100)
  const over = props.used > props.cap
  const warn = pct > 88

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Cap space</span>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: over ? 'var(--danger)' : warn ? 'var(--accent2)' : 'var(--text)' }}>
            {fmtMoney(props.used)}
          </span>
          <span style={{ color: 'var(--muted)' }}> / {fmtMoney(props.cap)}</span>
        </span>
      </div>
      <div className="meter">
        <div
          className={`meter-fill${over ? ' over' : warn ? ' warn' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && (
        <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
          Over cap by {fmtMoney(props.used - props.cap)}
        </div>
      )}
    </div>
  )
}

// ─── awards stage ─────────────────────────────────────────────────────────────

function AwardsPanel(props: { view: OffseasonView }): JSX.Element {
  const { view } = props
  return (
    <div className="stack">
      {view.championTeamName && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            background: 'linear-gradient(90deg,rgba(255,210,74,0.18),rgba(255,210,74,0.05))',
            border: '1px solid rgba(255,210,74,0.5)',
            borderRadius: 8,
            color: 'var(--accent2)',
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          <span style={{ fontSize: 28 }}>🏆</span>
          {view.championTeamName} — {view.year} Champions
        </div>
      )}

      {view.awards && view.awards.length > 0 && (
        <Panel title="League awards">
          <div className="grid grid-2" style={{ gap: 10 }}>
            {view.awards.map((a) => (
              <div
                key={a.award}
                style={{
                  padding: '10px 12px',
                  background: 'var(--bg0)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                  {a.award}
                </div>
                <div style={{ fontWeight: 600 }}>
                  <PlayerLink playerId={a.winner.playerId} name={a.winner.name} />
                  <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 12 }}>
                    {a.winner.teamAbbr}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

// ─── re-sign stage ────────────────────────────────────────────────────────────

function ResignRow(props: {
  row: ResignRowView
  onRefetch: () => void
}): JSX.Element {
  const client = useClient()
  const { row } = props

  const [salary, setSalary] = useState(String(Math.round(row.askSalary / 100_000) * 100_000))
  const [years, setYears] = useState(String(row.askYears))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (row.status === 'signed') {
    return (
      <tr>
        <td>
          <PlayerLink playerId={row.playerId} name={row.name} />
        </td>
        <td style={{ color: 'var(--muted)' }}>{row.position} · {row.age}</td>
        <td className="num">{row.overall}</td>
        <td className="num">{fmtMoney(row.currentSalary)}</td>
        <td colSpan={3}>
          <span className="chip chip-success">Signed</span>
        </td>
      </tr>
    )
  }

  if (row.status === 'walked') {
    return (
      <tr style={{ opacity: 0.55 }}>
        <td>
          <PlayerLink playerId={row.playerId} name={row.name} />
        </td>
        <td style={{ color: 'var(--muted)' }}>{row.position} · {row.age}</td>
        <td className="num">{row.overall}</td>
        <td className="num">{fmtMoney(row.currentSalary)}</td>
        <td colSpan={3}>
          <span className="chip chip-danger">Left in FA</span>
        </td>
      </tr>
    )
  }

  async function doResign() {
    setBusy(true)
    setErr(null)
    const salNum = parseFloat(salary)
    const yrNum = parseInt(years, 10)
    if (isNaN(salNum) || isNaN(yrNum) || yrNum < 1) {
      setErr('Invalid salary or years.')
      setBusy(false)
      return
    }
    const r = await client.resignPlayer(row.playerId, salNum, yrNum)
    setBusy(false)
    if (r.type === 'error') {
      setErr(r.message)
    } else {
      toast(`${row.name} re-signed.`, 'success')
      props.onRefetch()
    }
  }

  const morale = row.morale
  const moraleColor = morale >= 75 ? 'var(--success)' : morale >= 40 ? 'var(--accent2)' : 'var(--danger)'

  return (
    <>
      <tr>
        <td>
          <PlayerLink playerId={row.playerId} name={row.name} />
        </td>
        <td style={{ color: 'var(--muted)' }}>{row.position} · {row.age}</td>
        <td className="num">{row.overall}</td>
        <td className="num">{fmtMoney(row.currentSalary)}</td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              className="input"
              type="number"
              min={100000}
              step={50000}
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              style={{ width: 100, padding: '3px 6px', fontSize: 12 }}
            />
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>×</span>
            <input
              className="input"
              type="number"
              min={1}
              max={8}
              value={years}
              onChange={(e) => setYears(e.target.value)}
              style={{ width: 52, padding: '3px 6px', fontSize: 12 }}
            />
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>yr</span>
          </div>
        </td>
        <td style={{ color: moraleColor, fontSize: 12 }}>
          Ask: {fmtMoney(row.askSalary)} / {row.askYears}yr
        </td>
        <td>
          <button
            className="btn btn-primary"
            style={{ padding: '3px 12px', fontSize: 12 }}
            disabled={busy}
            onClick={doResign}
          >
            {busy ? '…' : 'Re-sign'}
          </button>
        </td>
      </tr>
      {err && (
        <tr>
          <td colSpan={7} style={{ paddingTop: 0 }}>
            <Notice kind="warn">{err}</Notice>
          </td>
        </tr>
      )}
    </>
  )
}

function ResignPanel(props: { view: OffseasonView; onRefetch: () => void }): JSX.Element {
  const { view } = props

  if (view.expiring.length === 0) {
    return (
      <Panel title="Re-sign players">
        <Notice kind="info">No expiring contracts to negotiate.</Notice>
      </Panel>
    )
  }

  return (
    <Panel title="Re-sign players">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos / Age</th>
              <th className="num">OVR</th>
              <th className="num">Current</th>
              <th>Offer</th>
              <th>Ask</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {view.expiring.map((row) => (
              <ResignRow key={row.playerId} row={row} onRefetch={props.onRefetch} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ─── free-agency stage ────────────────────────────────────────────────────────

function FARow(props: {
  fa: FreeAgentRowView
  capUsed: number
  salaryCap: number
  onRefetch: () => void
}): JSX.Element {
  const client = useClient()
  const { fa } = props

  const [salary, setSalary] = useState(String(Math.round(fa.askSalary / 100_000) * 100_000))
  const [years, setYears] = useState(String(fa.askYears))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [signed, setSigned] = useState(false)

  const capSpace = props.salaryCap - props.capUsed
  const askNum = parseFloat(salary)
  const capTight = !isNaN(askNum) && askNum > capSpace

  if (signed) {
    return (
      <tr>
        <td>
          <PlayerLink playerId={fa.playerId} name={fa.name} />
        </td>
        <td style={{ color: 'var(--muted)' }}>{fa.position} · {fa.age}</td>
        <td className="num">{fa.overall}</td>
        <td colSpan={4}>
          <span className="chip chip-success">Signed</span>
        </td>
      </tr>
    )
  }

  async function doSign() {
    setBusy(true)
    setErr(null)
    const salNum = parseFloat(salary)
    const yrNum = parseInt(years, 10)
    if (isNaN(salNum) || isNaN(yrNum) || yrNum < 1) {
      setErr('Invalid salary or years.')
      setBusy(false)
      return
    }
    const r = await client.signFreeAgent(fa.playerId, salNum, yrNum)
    setBusy(false)
    if (r.type === 'error') {
      setErr(r.message)
    } else {
      toast(`${fa.name} signed.`, 'success')
      setSigned(true)
      props.onRefetch()
    }
  }

  const daysChip =
    fa.decidesInDays <= 0
      ? <span className="chip chip-danger" style={{ fontSize: 10 }}>Decides today</span>
      : fa.decidesInDays <= 3
        ? <span className="chip chip-warn" style={{ fontSize: 10 }}>~{fa.decidesInDays}d left</span>
        : <span className="chip" style={{ fontSize: 10 }}>~{fa.decidesInDays}d left</span>

  return (
    <>
      <tr>
        <td>
          <PlayerLink playerId={fa.playerId} name={fa.name} />
        </td>
        <td style={{ color: 'var(--muted)' }}>{fa.position} · {fa.age}</td>
        <td className="num">{fa.overall}</td>
        <td>{daysChip}</td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              className="input"
              type="number"
              min={100000}
              step={50000}
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              style={{ width: 100, padding: '3px 6px', fontSize: 12 }}
            />
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>×</span>
            <input
              className="input"
              type="number"
              min={1}
              max={8}
              value={years}
              onChange={(e) => setYears(e.target.value)}
              style={{ width: 52, padding: '3px 6px', fontSize: 12 }}
            />
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>yr</span>
          </div>
        </td>
        <td style={{ color: 'var(--muted)', fontSize: 12 }}>
          Ask: {fmtMoney(fa.askSalary)} / {fa.askYears}yr
        </td>
        <td>
          {capTight ? (
            <span style={{ fontSize: 12, color: 'var(--danger)' }}>Cap full</span>
          ) : (
            <button
              className="btn btn-primary"
              style={{ padding: '3px 12px', fontSize: 12 }}
              disabled={busy}
              onClick={doSign}
            >
              {busy ? '…' : 'Sign'}
            </button>
          )}
        </td>
      </tr>
      {err && (
        <tr>
          <td colSpan={7} style={{ paddingTop: 0 }}>
            <Notice kind="warn">{err}</Notice>
          </td>
        </tr>
      )}
    </>
  )
}

function FreeAgencyPanel(props: { view: OffseasonView; onRefetch: () => void }): JSX.Element {
  const { view } = props

  if (view.freeAgents.length === 0) {
    return (
      <Panel title="Free agents">
        <Notice kind="info">No free agents available.</Notice>
      </Panel>
    )
  }

  return (
    <div className="stack">
      <CapBar used={view.capUsed} cap={view.salaryCap} />
      <Panel title="Free agents">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Pos / Age</th>
                <th className="num">OVR</th>
                <th>Decides</th>
                <th>Offer</th>
                <th>Ask</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.freeAgents.map((fa) => (
                <FARow
                  key={fa.playerId}
                  fa={fa}
                  capUsed={view.capUsed}
                  salaryCap={view.salaryCap}
                  onRefetch={props.onRefetch}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

// ─── main screen ──────────────────────────────────────────────────────────────

export function OffseasonScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const { data, loading, error, refetch } = useScreenData<OffseasonView>(
    () => client.getOffseason(),
    (r) => (r.type === 'offseason' ? r.offseason : null)
  )

  const [advBusy, setAdvBusy] = useState(false)
  const [advErr, setAdvErr] = useState<string | null>(null)

  async function handleAdvance() {
    setAdvBusy(true)
    setAdvErr(null)
    const r = await client.advanceOffseason()
    setAdvBusy(false)
    if (r.type === 'error') {
      setAdvErr(r.message)
    } else {
      refetch()
    }
  }

  return (
    <section>
      <ScreenHeader title="Offseason">
        {data && <span className="chip chip-accent">{data.stageLabel}</span>}
      </ScreenHeader>

      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="The offseason has not started."
      />

      {advErr && <Notice kind="warn">{advErr}</Notice>}

      {data && (
        <div className="stack">
          {/* stepper */}
          <Panel>
            <StageStepper stage={data.stage} stageLabel={data.stageLabel} />
          </Panel>

          {/* stage content */}
          {data.stage === 'awards' && <AwardsPanel view={data} />}

          {data.stage === 'draft' && (
            <Panel>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>
                  The {data.year} Entry Draft is ready.
                </span>
                <button
                  className="btn btn-primary"
                  onClick={() => nav.navigate('draft')}
                >
                  Go to Draft
                </button>
              </div>
            </Panel>
          )}

          {data.stage === 'resign' && (
            <ResignPanel view={data} onRefetch={refetch} />
          )}

          {data.stage === 'freeAgency' && (
            <FreeAgencyPanel view={data} onRefetch={refetch} />
          )}

          {data.stage === 'preseason' && (
            <Panel>
              <Notice kind="info">
                Roster moves are complete. The preseason schedule is being set — the new season begins soon.
              </Notice>
            </Panel>
          )}

          {/* advance button */}
          {data.stage !== 'preseason' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn"
                disabled={advBusy}
                onClick={handleAdvance}
              >
                {advBusy ? 'Advancing…' : `Advance to ${STAGE_LABELS[STAGE_ORDER[STAGE_ORDER.indexOf(data.stage) + 1]] ?? 'next stage'}`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
