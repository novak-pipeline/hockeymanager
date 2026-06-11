import { useState } from 'react'
import type { DraftView } from '../../worker/protocol'
import type { DraftPickRowView, ProspectRowView } from '../../engine/career/views'
import { PlayerLink } from '../components/NavContext'
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

// ─── main screen ──────────────────────────────────────────────────────────────

type DraftTab = 'board' | 'available'

export function DraftScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error, refetch } = useScreenData<DraftView>(
    () => client.getDraft(),
    (r) => (r.type === 'draft' ? r.draft : null)
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
        </div>
      )}
    </section>
  )
}
