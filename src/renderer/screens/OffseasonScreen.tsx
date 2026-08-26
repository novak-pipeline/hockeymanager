import { useCallback, useEffect, useState } from 'react'
import { Check, Trophy } from 'lucide-react'
import type { OffseasonView, CampInvitesView } from '../../worker/protocol'
import type { OfferSheetRowView, ResignRowView, CampInviteRow } from '../../engine/career/views'
import { PlayerLink, useNav } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { fmtMoney } from '../components/format'
import { OverallStars } from '../components/Stars'
import { PlayerFace } from '../components/PlayerFace'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

// ─── #182: training-camp PTO invite editor ────────────────────────────────────

/** Bring unsigned veterans to main camp on a pro tryout — they fight for a
 *  league-minimum deal. Curate the AGM's shortlist before camp opens. */
function CampInvitesPanel(): JSX.Element | null {
  const client = useClient()
  const [view, setView] = useState<CampInvitesView | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await client.getCampInvites()
    if (r.type === 'campInvites') setView(r.invites)
  }, [client])
  useEffect(() => { void load() }, [load])

  async function toggle(playerId: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const r = await client.toggleCampInvite(playerId)
      if (r.type === 'campInviteResult') {
        if (!r.ok && r.message) toast(r.message, 'error')
        setView(r.invites)
      }
    } finally { setBusy(false) }
  }

  if (!view) return null
  const Row = ({ p, invited }: { p: CampInviteRow; invited: boolean }): JSX.Element => (
    <div className="row" style={{ alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
      <PlayerFace faceId={p.faceId} name={p.name} size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <PlayerLink playerId={p.playerId} name={p.name} />
        <span className="muted small" style={{ marginLeft: 6 }}>{p.position} · {p.age} · OVR {p.overall}</span>
      </div>
      {!view.locked && (
        <button className={`btn btn-sm ${invited ? 'btn-ghost' : 'btn-primary'}`} disabled={busy} onClick={() => void toggle(p.playerId)}>
          {invited ? 'Withdraw' : 'Invite'}
        </button>
      )}
    </div>
  )
  return (
    <Panel title="Training Camp — Pro Tryout Invites (PTO)">
      {view.locked ? (
        <Notice kind="info">Camp is set — the tryout list is locked for this year.</Notice>
      ) : (
        <div className="muted small" style={{ marginBottom: 8 }}>
          Unsigned veterans you bring to main camp on a tryout. They must earn a league-minimum deal — the coach files a verdict at the end of camp.
        </div>
      )}
      <div className="field-label" style={{ marginTop: 4 }}>Invited ({view.invited.length})</div>
      {view.invited.length === 0
        ? <div className="muted small" style={{ padding: '4px 0' }}>No tryout invites — the AGM will bring a few if you don't.</div>
        : view.invited.map((p) => <Row key={p.playerId} p={p} invited />)}
      {!view.locked && view.available.length > 0 && (
        <>
          <div className="field-label" style={{ marginTop: 10 }}>Available veterans</div>
          {view.available.slice(0, 20).map((p) => <Row key={p.playerId} p={p} invited={false} />)}
        </>
      )}
    </Panel>
  )
}

// ─── arbitration hearings (Season Rhythm M2) ──────────────────────────────────

/** The classic ultimatum: the arbitrator set the number — sign it or lose him. */
function ArbitrationPanel({ view, onRefetch }: { view: OffseasonView; onRefetch: () => void }): JSX.Element | null {
  const client = useClient()
  const [busy, setBusy] = useState(false)
  const cases = view.arbitration ?? []
  if (cases.length === 0) return null

  const act = async (kind: 'accept' | 'walk', playerId: string, name: string): Promise<void> => {
    if (kind === 'walk' && !window.confirm(`Walk away from ${name}'s award? He becomes an unrestricted free agent immediately.`)) return
    setBusy(true)
    const res = kind === 'accept' ? await client.acceptArbitration(playerId) : await client.walkArbitration(playerId)
    setBusy(false)
    if (res.type === 'error') toast(res.message, 'error')
    else { toast(res.type === 'ok' && res.note ? res.note : 'Done', 'success'); onRefetch() }
  }

  return (
    <Panel title={`Arbitration hearings (${cases.length})`}>
      <p className="muted small" style={{ marginTop: -4, marginBottom: 8 }}>
        The arbitrator has ruled. Accept the award and he's signed at that number —
        or walk away and he hits the open market. Unanswered awards bind the club when free agency closes.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Player</th><th className="num">Age</th><th className="num">Award</th><th className="num">Term</th><th></th></tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.playerId}>
                <td><PlayerLink playerId={c.playerId} name={c.name} /> <span className="muted small">{c.position}</span></td>
                <td className="num muted">{c.age}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmtMoney(c.salary)}</td>
                <td className="num muted">{c.years}y</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost small" disabled={busy} onClick={() => { void act('accept', c.playerId, c.name) }}>Accept award</button>
                  <button className="btn btn-ghost small" style={{ color: 'var(--danger)', marginLeft: 4 }} disabled={busy} onClick={() => { void act('walk', c.playerId, c.name) }}>Walk away</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ─── buyout window (Season Rhythm M2) ─────────────────────────────────────────

/** Eat a bad contract: player walks, one-third of his remaining money sticks
 *  to next season's cap. Only multi-year deals qualify (expiring ones walk free). */
function BuyoutPanel({ onRefetch }: { onRefetch: () => void }): JSX.Element | null {
  const client = useClient()
  const [busy, setBusy] = useState(false)
  const { data: squad, refetch: refetchSquad } = useScreenData(
    () => client.getSquad(),
    (r) => (r.type === 'squad' ? r.squad : null)
  )
  if (!squad) return null
  const candidates = squad.rows
    .filter((r) => r.contract.yearsRemaining >= 1 && !r.contract.twoWay)
    .sort((a, b) => b.contract.salary - a.contract.salary)
    .slice(0, 12)
  if (candidates.length === 0) return null

  const doBuyout = async (playerId: string, name: string, charge: number): Promise<void> => {
    if (!window.confirm(`Buy out ${name}? He becomes a free agent and $${(charge / 1e6).toFixed(2)}M dead cap stays on next season's books. This cannot be undone.`)) return
    setBusy(true)
    const res = await client.buyoutPlayer(playerId)
    setBusy(false)
    if (res.type === 'error') toast(res.message, 'error')
    else { toast(res.type === 'ok' && res.note ? res.note : 'Bought out', 'success'); onRefetch(); refetchSquad() }
  }

  return (
    <Panel title="Buyout window">
      <p className="muted small" style={{ marginTop: -4, marginBottom: 8 }}>
        The one time of year you can eat a bad contract: the player becomes a free agent and
        <b> one-third of his remaining money</b> counts against next season's cap as a dead charge.
        Expensive freedom — use it on the deal you regret most.
      </p>
      <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table className="table">
          <thead>
            <tr><th>Player</th><th className="num">Age</th><th className="num">Salary</th><th className="num">Years</th><th className="num">Dead cap</th><th></th></tr>
          </thead>
          <tbody>
            {candidates.map((r) => {
              const charge = Math.round((r.contract.salary * r.contract.yearsRemaining) / 3)
              return (
                <tr key={r.playerId}>
                  <td><PlayerLink playerId={r.playerId} name={r.name} /> <span className="muted small">{r.position}</span></td>
                  <td className="num muted">{r.age}</td>
                  <td className="num">{fmtMoney(r.contract.salary)}</td>
                  <td className="num muted">{r.contract.yearsRemaining}</td>
                  <td className="num" style={{ color: 'var(--danger)' }}>{fmtMoney(charge)}</td>
                  <td className="num">
                    <button className="btn btn-ghost small" disabled={busy}
                      onClick={() => { void doBuyout(r.playerId, r.name, charge) }}>
                      Buy out
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

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
                {past ? <Icon size={14}><Check /></Icon> : i + 1}
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
          <Icon size={24} color="var(--accent2)"><Trophy /></Icon>
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

// ─── re-sign stage: the June window (playtest §B) ─────────────────────────────

/** The offer builder that sits under a re-sign row. Term is PRICED — moving the
 *  years moves the number his camp needs to see (§B4), so the GM can watch the
 *  bill for the cost certainty he's asking for. */
function OfferBuilder(props: { row: ResignRowView; onDone: () => void }): JSX.Element {
  const client = useClient()
  const { row } = props
  const priceFor = useCallback(
    (y: number): number => row.priceByYears?.find((p) => p.years === y)?.salary ?? row.askSalary,
    [row]
  )
  const [years, setYears] = useState(row.askYears)
  const [salary, setSalary] = useState(() => priceFor(row.askYears))
  const [busy, setBusy] = useState(false)

  const asked = priceFor(years)
  const delta = salary - asked
  const maxYears = row.priceByYears?.length ?? 8

  async function table(): Promise<void> {
    setBusy(true)
    const r = await client.submitResignOffer(row.playerId, salary, years)
    setBusy(false)
    if (r.type === 'error') toast(r.message, 'error')
    else {
      if (r.type === 'ok' && r.note) toast(r.note, 'info')
      props.onDone()
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="small muted">Term</label>
        <select
          value={years}
          onChange={(e) => {
            const y = Number(e.target.value)
            setYears(y)
            setSalary(priceFor(y))
          }}
          style={{ background: 'var(--bg1)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px' }}
        >
          {Array.from({ length: maxYears }, (_, i) => i + 1).map((y) => (
            <option key={y} value={y}>{y} yr — {fmtMoney(priceFor(y))}/yr</option>
          ))}
        </select>
        <label className="small muted">AAV</label>
        <input
          type="number"
          step={250000}
          value={salary}
          onChange={(e) => setSalary(Number(e.target.value))}
          style={{ width: 130, background: 'var(--bg1)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px' }}
        />
        <button className="btn btn-primary" disabled={busy} onClick={() => void table()}>Table the offer</button>
      </div>
      <div className="small" style={{ color: delta < 0 ? 'var(--danger)' : 'var(--muted)' }}>
        {years > row.askYears
          ? `He asked for ${row.askYears} years. The ${years - row.askYears} extra ${years - row.askYears > 1 ? 'years are' : 'year is'} your cost certainty, not his — his camp prices ${years} years at ${fmtMoney(asked)}.`
          : years < row.askYears
            ? `Shorter than the ${row.askYears} years he wanted — cheaper per year, but he loses the security he asked for.`
            : `His asking terms: ${fmtMoney(row.askSalary)} × ${row.askYears}.`}
        {delta < 0 ? ` You are ${fmtMoney(-delta)} light.` : ''}
      </div>
    </div>
  )
}

function ResignRow(props: {
  row: ResignRowView
  onRefetch: () => void
}): JSX.Element {
  const nav = useNav()
  const client = useClient()
  const { row } = props
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<{ type: string; message?: string; note?: string }>, tone: 'success' | 'info'): Promise<void> => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (r.type === 'error') toast(r.message ?? 'That did not work.', 'error')
    else {
      if (r.note) toast(r.note, tone)
      props.onRefetch()
    }
  }

  if (row.status === 'signed') {
    return (
      <tr>
        <td>
          <PlayerLink playerId={row.playerId} name={row.name} />
        </td>
        <td style={{ color: 'var(--muted)' }}>{row.position} · {row.age}</td>
        <td className="num"><OverallStars value={row.overall} /></td>
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
        <td className="num"><OverallStars value={row.overall} /></td>
        <td className="num">{fmtMoney(row.currentSalary)}</td>
        <td colSpan={3}>
          <span className="chip chip-danger">Left in FA</span>
        </td>
      </tr>
    )
  }

  const morale = row.morale
  const moraleColor = morale >= 75 ? 'var(--success)' : morale >= 40 ? 'var(--accent2)' : 'var(--danger)'

  return (
    <>
      <tr>
        <td>
          <PlayerLink playerId={row.playerId} name={row.name} />
          {row.rights ? <span className="chip" style={{ marginLeft: 6, fontSize: 10 }}>{row.rights}</span> : null}
        </td>
        <td style={{ color: 'var(--muted)' }}>{row.position} · {row.age}</td>
        <td className="num"><OverallStars value={row.overall} /></td>
        <td className="num">{fmtMoney(row.currentSalary)}</td>
        <td style={{ fontSize: 12 }}>
          {fmtMoney(row.askSalary)} × {row.askYears}yr
          {row.agentName ? <div className="muted" style={{ fontSize: 11 }}>{row.agentName}</div> : null}
        </td>
        <td style={{ color: moraleColor, fontSize: 12 }}>
          {morale >= 75 ? 'Happy' : morale >= 40 ? 'Content' : 'Unsettled'}
          {row.patience !== undefined && row.patience <= 25
            ? <div style={{ color: 'var(--danger)', fontSize: 11 }}>camp losing patience</div>
            : null}
        </td>
        <td>
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <button
              className="btn"
              style={{ padding: '3px 10px', fontSize: 12 }}
              disabled={!!row.pendingOffer}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? 'Close' : 'Offer'}
            </button>
            <button
              className="btn btn-primary"
              style={{ padding: '3px 10px', fontSize: 12 }}
              onClick={() => nav.navigate('negotiation', { playerId: row.playerId })}
            >
              Sit down →
            </button>
          </div>
        </td>
      </tr>

      {/* §B2 — the qualifying offer, and what walking away from it costs. */}
      {row.qoStatus ? (
        <tr>
          <td colSpan={7} style={{ paddingTop: 0, borderTop: 'none' }}>
            <div className="row small" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted">Qualifying offer {row.qualifyingOffer ? fmtMoney(row.qualifyingOffer) : ''}:</span>
              {row.qoStatus === 'tendered' ? (
                <span className="chip chip-success">Tendered — his rights are yours</span>
              ) : row.qoStatus === 'declined' ? (
                <span className="chip chip-danger">Walked away — he'll be unrestricted</span>
              ) : (
                <>
                  <span className="chip chip-warn">Undecided</span>
                  <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy}
                    onClick={() => void act(() => client.tenderQualifyingOffer(row.playerId), 'success')}>Tender</button>
                  <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy}
                    onClick={() => void act(() => client.declineQualifyingOffer(row.playerId), 'info')}>Walk away</button>
                </>
              )}
            </div>
          </td>
        </tr>
      ) : null}

      {/* §B1 — what his camp is doing with the offer you tabled. */}
      {row.pendingOffer ? (
        <tr>
          <td colSpan={7} style={{ paddingTop: 0, borderTop: 'none' }}>
            <div className="small" style={{ color: 'var(--accent2)' }}>
              Tabled: <strong>{fmtMoney(row.pendingOffer.salary)} × {row.pendingOffer.years}</strong> —{' '}
              {row.pendingOffer.daysLeft <= 0
                ? 'his camp answers today.'
                : row.pendingOffer.daysLeft === 1
                  ? 'his camp answers tomorrow.'
                  : `his camp answers in ${row.pendingOffer.daysLeft} days.`}
            </div>
          </td>
        </tr>
      ) : null}

      {row.counter ? (
        <tr>
          <td colSpan={7} style={{ paddingTop: 0, borderTop: 'none' }}>
            <div className="stack" style={{ gap: 4, padding: '6px 8px', background: 'var(--bg1)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
              <div className="small" style={{ fontStyle: 'italic' }}>{row.counter.note}</div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="small">Their counter: <strong>{fmtMoney(row.counter.salary)} × {row.counter.years}</strong></span>
                <button className="btn btn-primary" style={{ padding: '2px 10px', fontSize: 11 }} disabled={busy}
                  onClick={() => void act(() => client.acceptResignCounter(row.playerId), 'success')}>Accept as written</button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}

      {row.lastRefusal && !row.pendingOffer && !row.counter ? (
        <tr>
          <td colSpan={7} style={{ paddingTop: 0, borderTop: 'none' }}>
            <div className="small muted" style={{ fontStyle: 'italic' }}>{row.lastRefusal}</div>
          </td>
        </tr>
      ) : null}

      {open && !row.pendingOffer ? (
        <tr>
          <td colSpan={7} style={{ paddingTop: 0, borderTop: 'none' }}>
            <OfferBuilder row={row} onDone={() => { setOpen(false); props.onRefetch() }} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function OfferSheetPanel(props: { sheets: OfferSheetRowView[]; onRefetch: () => void }): JSX.Element {
  const client = useClient()
  const [busy, setBusy] = useState(false)
  const act = async (kind: 'match' | 'decline', s: OfferSheetRowView): Promise<void> => {
    setBusy(true)
    const r = kind === 'match' ? await client.matchOfferSheet(s.playerId) : await client.declineOfferSheet(s.playerId)
    setBusy(false)
    if (r.type === 'error') toast(r.message, 'error')
    else { if (r.type === 'ok' && r.note) toast(r.note, kind === 'match' ? 'success' : 'info'); props.onRefetch() }
  }
  return (
    <Panel title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={16} color="var(--amber)"><Icons.Warning /></Icon> Offer sheets on your RFAs</span>}>
      <div className="muted small" style={{ marginBottom: 8 }}>
        Rival clubs have tendered offer sheets. Match the price to keep your player, or let him walk for the draft-pick
        compensation. The match window runs on the clock — let it expire and the decision is made for you.
      </div>
      <div className="stack">
        {props.sheets.map((s) => (
          <div key={s.playerId} className="row" style={{ gap: 12, alignItems: 'center', padding: '8px 10px', background: 'var(--bg1)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ flex: 1 }}>
              <PlayerLink playerId={s.playerId} name={s.name} />
              <span className="muted small" style={{ marginLeft: 8 }}>{s.position} · from {s.fromTeamAbbr}</span>
              <div className="small" style={{ marginTop: 2 }}>
                Offer: <strong>{fmtMoney(s.salary)}</strong> × {s.years} · compensation if you pass:{' '}
                {s.compRounds.length ? s.compRounds.map((r) => `R${r}`).join(' + ') : 'none'}
              </div>
              {s.matchDaysLeft !== undefined ? (
                <div className="small" style={{ marginTop: 2, color: s.matchDaysLeft <= 1 ? 'var(--danger)' : 'var(--amber)' }}>
                  {s.matchDaysLeft <= 0
                    ? 'Match window expires today.'
                    : `${s.matchDaysLeft} day${s.matchDaysLeft > 1 ? 's' : ''} left to match.`}
                </div>
              ) : null}
            </div>
            <button className="btn btn-primary" disabled={busy} onClick={() => act('match', s)}>Match</button>
            <button className="btn" disabled={busy} onClick={() => act('decline', s)}>Let him walk</button>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function ResignPanel(props: { view: OffseasonView; onRefetch: () => void }): JSX.Element {
  const { view } = props
  const day = view.resignDay ?? 0
  const total = view.resignWindowDays ?? 0
  const title = total > 0
    ? `Re-sign your players — window day ${day} of ${total}`
    : 'Re-sign players'

  if (view.expiring.length === 0) {
    return (
      <Panel title={title}>
        <Notice kind="info">No expiring contracts to negotiate.</Notice>
      </Panel>
    )
  }

  const waiting = view.expiring.filter((r) => r.pendingOffer).length
  const countered = view.expiring.filter((r) => r.counter).length
  const openQos = view.expiring.filter((r) => r.qoStatus === 'open').length

  return (
    <Panel title={title}>
      {total > 0 ? (
        <div className="muted small" style={{ marginBottom: 8, lineHeight: 1.5 }}>
          Offers are taken away and answered over the next day or two — nobody signs on the spot.
          {' '}July 1 arrives after {Math.max(0, total - day)} more {total - day === 1 ? 'press' : 'presses'} of Continue.
          {waiting > 0 ? ` ${waiting} offer${waiting > 1 ? 's' : ''} out.` : ''}
          {countered > 0 ? ` ${countered} counter${countered > 1 ? 's' : ''} waiting on you.` : ''}
          {openQos > 0 ? ` ${openQos} qualifying offer${openQos > 1 ? 's' : ''} undecided.` : ''}
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos / Age</th>
              <th className="num">OVR</th>
              <th className="num">Current</th>
              <th>Their ask</th>
              <th>Mood</th>
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

// ─── free-agency stage: the market lives in its own Free Agents tab ─────────

/** July 1 window: the desk keeps the cap picture + arbitration; the market
 *  itself is the sidebar's Free Agents tab (like Scouting). */
function FreeAgencyPanel(props: { view: OffseasonView; onRefetch: () => void }): JSX.Element {
  const nav = useNav()
  const { view } = props
  return (
    <div className="stack">
      <CapBar used={view.capUsed} cap={view.salaryCap} />
      <Panel title="The open market">
        <p className="small" style={{ margin: '0 0 8px', lineHeight: 1.5 }}>
          Free agency is open. The full market — filters, shortlists, agent reads,
          decision clocks — runs from the <strong>Free Agents</strong> desk.
        </p>
        <button className="btn btn-primary" onClick={() => nav.navigate('faMarket')}>
          Open the market →
        </button>
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

          {data.stage === 'resign' && data.offerSheets && data.offerSheets.length > 0 && (
            <OfferSheetPanel sheets={data.offerSheets} onRefetch={refetch} />
          )}
          {data.stage === 'resign' && (
            <ResignPanel view={data} onRefetch={refetch} />
          )}
          {(data.stage === 'resign' || data.stage === 'freeAgency') && (
            <BuyoutPanel onRefetch={refetch} />
          )}

          {data.stage === 'freeAgency' && (
            <>
              <ArbitrationPanel view={data} onRefetch={refetch} />
              <FreeAgencyPanel view={data} onRefetch={refetch} />
              <CampInvitesPanel />
            </>
          )}

          {data.stage === 'preseason' && (
            <Panel>
              <Notice kind="info">
                Roster moves are complete. The preseason schedule is being set — the new season begins soon.
              </Notice>
            </Panel>
          )}

          {/* advance button — hidden during the draft: Continue can't sim past
              it, so the only path forward is conducting it via "Go to Draft". */}
          {data.stage !== 'preseason' && data.stage !== 'draft' && (
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
