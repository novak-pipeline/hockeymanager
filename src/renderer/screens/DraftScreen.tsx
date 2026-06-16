import { useState } from 'react'
import type { DraftView, TentpoleView } from '../../worker/protocol'
import type { CombineRowView, DraftPickRowView, ProspectRowView } from '../../engine/career/views'
import { PlayerLink, useNav } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

// ─── potential stars ───────────────────────────────────────────────────────────

function PotentialStars(props: { stars: number }): JSX.Element {
  return (
    <span style={{ color: 'var(--accent2)', letterSpacing: 1, fontSize: 13 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ opacity: i < props.stars ? 1 : 0.2 }}>
          ★
        </span>
      ))}
    </span>
  )
}

// ─── draft board ──────────────────────────────────────────────────────────────

function DraftBoard(props: {
  board: DraftPickRowView[]
  onClockIndex: number
}): JSX.Element {
  const { board, onClockIndex } = props

  // group into rounds for display
  const rounds = board.reduce<Map<number, DraftPickRowView[]>>((acc, row) => {
    const arr = acc.get(row.round) ?? []
    arr.push(row)
    acc.set(row.round, arr)
    return acc
  }, new Map())

  const roundNums = [...rounds.keys()].sort((a, b) => a - b)

  return (
    <div className="stack">
      {roundNums.map((rnd) => {
        const rows = rounds.get(rnd)!
        return (
          <Panel key={rnd} title={`Round ${rnd}`}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>Selection</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isClock = onClockIndex >= 0 && board[onClockIndex]?.overallPick === row.overallPick
                    const isUser = row.isUserPick
                    const isDone = row.selection !== null

                    return (
                      <tr
                        key={row.overallPick}
                        className={isUser && !isDone ? 'is-user' : ''}
                        style={{
                          opacity: isDone && !isUser ? 0.6 : 1,
                          background: isClock
                            ? 'rgba(255,210,74,0.10)'
                            : undefined,
                        }}
                      >
                        <td className="num" style={{ color: 'var(--muted)', width: 40 }}>
                          {row.overallPick}
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: isUser ? 700 : 400,
                              color: isUser ? 'var(--accent)' : 'var(--text)',
                            }}
                          >
                            {row.teamAbbr}
                          </span>
                          {isClock && (
                            <span
                              className="chip chip-warn"
                              style={{ marginLeft: 8, fontSize: 10 }}
                            >
                              ON CLOCK
                            </span>
                          )}
                        </td>
                        <td>
                          {isDone ? (
                            <span>
                              <PlayerLink
                                playerId={row.selection!.playerId}
                                name={row.selection!.name}
                              />
                              <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>
                                {row.selection!.position} · #{row.selection!.rank}
                              </span>
                            </span>
                          ) : (
                            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                              {isClock ? '…' : '—'}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )
      })}
    </div>
  )
}

// ─── best available table ─────────────────────────────────────────────────────

function BestAvailable(props: {
  prospects: ProspectRowView[]
  userIsOnClock: boolean
  busy: boolean
  onDraft: (playerId: string) => void
}): JSX.Element {
  const available = props.prospects.filter((p) => !p.drafted)

  if (available.length === 0) {
    return (
      <Panel title="Best available">
        <Notice kind="info">All prospects have been drafted.</Notice>
      </Panel>
    )
  }

  return (
    <Panel title="Best available">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Name</th>
              <th>Pos</th>
              <th>Age</th>
              <th className="num">OVR</th>
              <th>Potential</th>
              <th className="num">Know.</th>
              {props.userIsOnClock && <th />}
            </tr>
          </thead>
          <tbody>
            {available.slice(0, 50).map((p) => (
              <tr key={p.playerId}>
                <td className="num" style={{ color: 'var(--muted)', width: 44 }}>
                  {p.rank}
                </td>
                <td>
                  <PlayerLink playerId={p.playerId} name={p.name} />
                </td>
                <td style={{ color: 'var(--muted)' }}>{p.position}</td>
                <td style={{ color: 'var(--muted)' }}>{p.age}</td>
                <td className="num" style={{ fontWeight: 600, color: p.scouted && !p.scouted.exact ? 'var(--muted)' : undefined }}>
                  {p.scouted && !p.scouted.exact
                    ? `${p.scouted.overallLo}–${p.scouted.overallHi}`
                    : p.overall}
                </td>
                <td>
                  <PotentialStars stars={p.potentialStars} />
                </td>
                <td className="num small" style={{ color: p.knowledge >= 60 ? 'var(--success)' : p.knowledge >= 30 ? 'var(--accent)' : 'var(--muted)' }}
                  title={p.knowledge < 30 ? 'Barely scouted — this read is a guess' : 'How well your scouts know him'}>
                  {p.knowledge}%
                </td>
                {props.userIsOnClock && (
                  <td>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '3px 12px', fontSize: 12 }}
                      disabled={props.busy}
                      onClick={() => props.onDraft(p.playerId)}
                    >
                      Draft
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ─── header clock strip ───────────────────────────────────────────────────────

function ClockStrip(props: { data: DraftView }): JSX.Element {
  const { data } = props
  const onClock = data.onClockIndex >= 0 ? data.board[data.onClockIndex] : null

  if (data.complete) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          background: 'rgba(95,208,104,0.1)',
          border: '1px solid rgba(95,208,104,0.35)',
          borderRadius: 6,
          color: 'var(--success)',
          fontWeight: 700,
        }}
      >
        ✓ {data.year} Draft complete
      </div>
    )
  }

  if (!onClock) return <></>

  const round = onClock.round
  const pick = onClock.overallPick
  const team = onClock.teamAbbr

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        background: data.userIsOnClock
          ? 'rgba(255,210,74,0.10)'
          : 'var(--bg1)',
        border: data.userIsOnClock
          ? '1px solid rgba(255,210,74,0.45)'
          : '1px solid var(--line)',
        borderRadius: 6,
      }}
    >
      <div>
        <span style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          On the clock
        </span>
        <div style={{ fontWeight: 700, fontSize: 15, marginTop: 1 }}>
          {team}
          {data.userIsOnClock && (
            <span className="chip chip-warn" style={{ marginLeft: 10, fontSize: 11 }}>
              Your pick
            </span>
          )}
        </div>
      </div>
      <div style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch' }} />
      <div className="row" style={{ gap: 16 }}>
        <div className="stat">
          <div className="stat-value" style={{ fontSize: 20 }}>{round}</div>
          <div className="stat-label">Round</div>
        </div>
        <div className="stat">
          <div className="stat-value" style={{ fontSize: 20 }}>{pick}</div>
          <div className="stat-label">Overall</div>
        </div>
      </div>
    </div>
  )
}

// ─── lottery banner ───────────────────────────────────────────────────────────

function LotteryBanner(props: { lottery: NonNullable<TentpoleView['lottery']> }): JSX.Element {
  const { lottery } = props
  const { orderAbbrs, movedUp } = lottery

  return (
    <div
      style={{
        padding: '12px 16px',
        background: 'linear-gradient(90deg, rgba(var(--accent-rgb),0.18), rgba(236,72,153,0.10))',
        border: '1px solid rgba(var(--accent-rgb),0.4)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div className="row" style={{ gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>🎰</span>
        <span
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: 'var(--violet-h)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Draft Lottery Results
        </span>
      </div>

      {movedUp && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: 'rgba(var(--accent-rgb),0.14)',
            border: '1px solid rgba(var(--accent-rgb),0.35)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 10,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span className="chip chip-hero" style={{ fontSize: 11 }}>
            {movedUp.teamAbbr}
          </span>
          <span>
            wins the lottery, jumps from{' '}
            <strong style={{ color: 'var(--amber)' }}>{movedUp.from}{getOrdinalSuffixD(movedUp.from)}</strong>
            {' '}to{' '}
            <strong style={{ color: 'var(--green)' }}>1st overall</strong>!
          </span>
        </div>
      )}

      {/* Order strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {orderAbbrs.slice(0, 16).map((abbr, i) => (
          <span
            key={i}
            className={i === 0 ? 'chip chip-hero' : 'chip'}
            style={{ fontSize: 11, fontWeight: i < 3 ? 700 : 500 }}
          >
            <span
              className="muted"
              style={{ marginRight: 3, fontSize: 10 }}
            >
              {i + 1}.
            </span>
            {abbr}
          </span>
        ))}
      </div>
    </div>
  )
}

function getOrdinalSuffixD(n: number): string {
  if (n >= 11 && n <= 13) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

// ─── combine tab ──────────────────────────────────────────────────────────────

function StatBar(props: { value: number; color?: string }): JSX.Element {
  const pct = Math.min(100, Math.max(0, props.value))
  return (
    <div
      style={{
        width: 52,
        height: 5,
        background: 'var(--bg3)',
        borderRadius: 999,
        overflow: 'hidden',
        display: 'inline-block',
        verticalAlign: 'middle',
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: props.color ?? 'var(--cyan)',
          borderRadius: 999,
        }}
      />
    </div>
  )
}

function InterviewChip(props: { result: CombineRowView['interview'] }): JSX.Element {
  const map = {
    impressive: { cls: 'chip chip-success', label: 'Impressive' },
    solid: { cls: 'chip chip-violet', label: 'Solid' },
    concerning: { cls: 'chip chip-danger', label: 'Concerning' },
  } as const
  const { cls, label } = map[props.result]
  return <span className={cls} style={{ fontSize: 10 }}>{label}</span>
}

function CombineTab(props: { combine: CombineRowView[] }): JSX.Element {
  const nav = useNav()
  const rows = [...props.combine].sort((a, b) => a.rank - b.rank)

  return (
    <Panel title="Pre-draft combine">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Name</th>
              <th>Pos</th>
              <th>Sprint</th>
              <th>Agility</th>
              <th>Strength</th>
              <th>Interview</th>
              <th style={{ width: 64 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.playerId}>
                <td className="num muted small">{row.rank}</td>
                <td>
                  <button
                    type="button"
                    className="player-link"
                    onClick={() => nav.navigate('player', { playerId: row.playerId })}
                  >
                    {row.name}
                  </button>
                </td>
                <td className="muted small">{row.position}</td>
                <td>
                  <div className="row" style={{ gap: 5 }}>
                    <StatBar value={row.sprint} color="var(--orange)" />
                    <span className="muted small mono">{row.sprint}</span>
                  </div>
                </td>
                <td>
                  <div className="row" style={{ gap: 5 }}>
                    <StatBar value={row.agility} color="var(--cyan)" />
                    <span className="muted small mono">{row.agility}</span>
                  </div>
                </td>
                <td>
                  <div className="row" style={{ gap: 5 }}>
                    <StatBar value={row.strength} color="var(--violet)" />
                    <span className="muted small mono">{row.strength}</span>
                  </div>
                </td>
                <td>
                  <InterviewChip result={row.interview} />
                </td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {row.riser && (
                      <span
                        className="chip chip-success"
                        style={{ fontSize: 10, padding: '1px 6px' }}
                      >
                        RISER
                      </span>
                    )}
                    {row.faller && (
                      <span
                        className="chip chip-danger"
                        style={{ fontSize: 10, padding: '1px 6px' }}
                      >
                        FALLER
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ─── main screen ──────────────────────────────────────────────────────────────

type DraftTab = 'board' | 'available' | 'combine'

export function DraftScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error, refetch } = useScreenData<DraftView>(
    () => client.getDraft(),
    (r) => (r.type === 'draft' ? r.draft : null)
  )

  const { data: tentpoles } = useScreenData<TentpoleView>(
    () => client.getTentpoles(),
    (r) => (r.type === 'tentpoles' ? r.tentpoles : null)
  )

  const [tab, setTab] = useState<DraftTab>('board')
  const [busy, setBusy] = useState(false)
  const [mutErr, setMutErr] = useState<string | null>(null)

  async function handleDraft(playerId: string) {
    setBusy(true)
    setMutErr(null)
    const r = await client.draftPlayer(playerId)
    setBusy(false)
    if (r.type === 'error') {
      setMutErr(r.message)
    } else {
      toast('Pick submitted.', 'success')
      refetch()
    }
  }

  async function handleSimToMyPick() {
    setBusy(true)
    setMutErr(null)
    const r = await client.advanceDraft()
    setBusy(false)
    if (r.type === 'error') {
      setMutErr(r.message)
    } else {
      refetch()
    }
  }

  return (
    <section>
      <ScreenHeader title={data ? `${data.year} Draft` : 'Draft'}>
        {data && data.userIsOnClock && (
          <span className="chip chip-warn">You are on the clock</span>
        )}
      </ScreenHeader>

      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No draft in progress."
      />

      {mutErr && <Notice kind="warn">{mutErr}</Notice>}

      {/* Lottery banner — show whenever lottery data available (offseason) */}
      {tentpoles?.lottery && (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <LotteryBanner lottery={tentpoles.lottery} />
        </div>
      )}

      {data && (
        <div className="stack">
          {/* clock strip + controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <ClockStrip data={data} />
            </div>
            {!data.complete && !data.userIsOnClock && (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={handleSimToMyPick}
              >
                {busy ? 'Simming…' : 'Sim to my pick'}
              </button>
            )}
          </div>

          {/* tab strip */}
          <div className="tabs" style={{ marginBottom: 0 }}>
            <button
              className={`tab${tab === 'board' ? ' active' : ''}`}
              onClick={() => setTab('board')}
            >
              Draft board
            </button>
            <button
              className={`tab${tab === 'available' ? ' active' : ''}`}
              onClick={() => setTab('available')}
            >
              Best available
              <span className="badge" style={{ marginLeft: 6 }}>
                {data.prospects.filter((p) => !p.drafted).length}
              </span>
            </button>
            {tentpoles?.combine && tentpoles.combine.length > 0 && (
              <button
                className={`tab${tab === 'combine' ? ' active' : ''}`}
                onClick={() => setTab('combine')}
              >
                Combine
                <span className="badge" style={{ marginLeft: 6 }}>
                  {tentpoles.combine.length}
                </span>
              </button>
            )}
          </div>

          {tab === 'board' && (
            <DraftBoard board={data.board} onClockIndex={data.onClockIndex} />
          )}

          {tab === 'available' && (
            <BestAvailable
              prospects={data.prospects}
              userIsOnClock={data.userIsOnClock}
              busy={busy}
              onDraft={handleDraft}
            />
          )}

          {tab === 'combine' && (
            tentpoles?.combine && tentpoles.combine.length > 0 ? (
              <CombineTab combine={tentpoles.combine} />
            ) : (
              <Notice kind="warn">Combine results not available yet.</Notice>
            )
          )}
        </div>
      )}
    </section>
  )
}
