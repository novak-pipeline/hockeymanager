import { useState } from 'react'
import type { AhlStandingsView, StandingRowView, StandingsView } from '../../worker/protocol'
import { crestColor } from '../components/format'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from '../components/NavContext'
import { useUserTeamId } from '../components/UserTeamContext'

type TabId = 'overall' | 'conference' | 'division' | 'ahl'

/** Full league standings: Overall / Conference / Division / AHL tabs. */
export function StandingsScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<StandingsView>(
    () => client.getStandings(),
    (r) => (r.type === 'standings' ? r.standings : null)
  )
  const { data: ahlData, loading: ahlLoading, error: ahlError } = useScreenData<AhlStandingsView>(
    () => client.getAhlStandings(),
    (r) => (r.type === 'ahlStandings' ? r.standings : null)
  )
  const [tab, setTab] = useState<TabId>('overall')
  // per-conference subtab when on "conference" view
  const [confIdx, setConfIdx] = useState(0)
  // per-division subtab when on "division" view
  const [divIdx, setDivIdx] = useState(0)

  return (
    <section className="stack">
      <ScreenHeader title="Standings" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No standings yet."
      />
      {data && (
        <StandingsBody
          data={data}
          tab={tab}
          setTab={setTab}
          confIdx={confIdx}
          setConfIdx={setConfIdx}
          divIdx={divIdx}
          setDivIdx={setDivIdx}
          ahlData={ahlData}
          ahlLoading={ahlLoading}
          ahlError={ahlError}
        />
      )}
    </section>
  )
}

/* ── internal ── */

function StandingsBody(props: {
  data: StandingsView
  tab: TabId
  setTab: (t: TabId) => void
  confIdx: number
  setConfIdx: (i: number) => void
  divIdx: number
  setDivIdx: (i: number) => void
  ahlData: AhlStandingsView | null
  ahlLoading: boolean
  ahlError: string | null
}): JSX.Element {
  const { data, tab, setTab, confIdx, setConfIdx, divIdx, setDivIdx, ahlData, ahlLoading, ahlError } = props

  return (
    <div className="stack">
      <div className="tabs">
        {(['overall', 'conference', 'division', 'ahl'] as TabId[]).map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'overall' ? 'Overall' : t === 'conference' ? 'Conference' : t === 'division' ? 'Division' : 'AHL'}
          </button>
        ))}
      </div>

      {tab === 'overall' && (
        <Panel title="League standings">
          <StandingsTable rows={data.overall} playoffLine={null} />
        </Panel>
      )}

      {tab === 'conference' && (
        <div className="stack">
          {data.conferences.length > 1 && (
            <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
              {data.conferences.map((c, i) => (
                <button
                  key={c.name}
                  className={`tab${confIdx === i ? ' active' : ''}`}
                  onClick={() => setConfIdx(i)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {data.conferences[confIdx] && (
            <Panel title={data.conferences[confIdx].name}>
              <StandingsTable rows={data.conferences[confIdx].rows} playoffLine={4} />
            </Panel>
          )}
        </div>
      )}

      {tab === 'division' && (
        <div className="stack">
          {data.divisions.length > 1 && (
            <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
              {data.divisions.map((d, i) => (
                <button
                  key={d.name}
                  className={`tab${divIdx === i ? ' active' : ''}`}
                  onClick={() => setDivIdx(i)}
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
          {data.divisions[divIdx] && (
            <Panel title={`${data.divisions[divIdx].name} · ${data.divisions[divIdx].conferenceName}`}>
              <StandingsTable rows={data.divisions[divIdx].rows} playoffLine={null} />
            </Panel>
          )}
        </div>
      )}

      {tab === 'ahl' && (
        <div className="stack">
          {ahlError && <Notice kind="warn">{ahlError}</Notice>}
          {ahlLoading && !ahlData && <Notice kind="info">Loading AHL standings…</Notice>}
          {ahlData && ahlData.rows.length === 0 && (
            <Notice kind="info">No AHL affiliates have been generated for this league.</Notice>
          )}
          {ahlData && ahlData.rows.length > 0 && (
            <Panel title="AHL Affiliate League">
              <StandingsTable rows={ahlData.rows} playoffLine={null} />
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}

/** The standings table itself; playoffLine inserts a visual divider after that rank. */
function StandingsTable(props: {
  rows: StandingRowView[]
  playoffLine: number | null
}): JSX.Element {
  const { rows, playoffLine } = props
  const nav = useNav()
  const userTeamId = useUserTeamId()

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>#</th>
            <th>Team</th>
            <th className="num">GP</th>
            <th className="num">W</th>
            <th className="num">L</th>
            <th className="num">OTL</th>
            <th className="num">PTS</th>
            <th className="num">GF</th>
            <th className="num">GA</th>
            <th className="num">DIFF</th>
            <th>Streak</th>
            <th>L5</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <>
              {playoffLine !== null && i === playoffLine && (
                <tr key={`pl-${i}`} style={{ pointerEvents: 'none' }}>
                  <td
                    colSpan={12}
                    style={{
                      padding: 0,
                      borderTop: '2px solid var(--accent)',
                      lineHeight: 0,
                    }}
                  />
                </tr>
              )}
              <tr key={row.teamId}>
                <td className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                <td>
                  <span className="row" style={{ gap: 'var(--sp-2)' }}>
                    <span
                      className="crest"
                      style={{
                        background: crestColor(row.teamId),
                        width: 20,
                        height: 20,
                        fontSize: 9,
                        border: 'none',
                        flexShrink: 0,
                      }}
                    >
                      {row.abbreviation.slice(0, 2)}
                    </span>
                    <button
                      type="button"
                      className="player-link"
                      onClick={() =>
                        row.teamId === userTeamId
                          ? nav.navigate('squad')
                          : nav.navigate('squad', { teamId: row.teamId })
                      }
                    >
                      {row.name}
                    </button>
                    <span className="muted small">{row.abbreviation}</span>
                  </span>
                </td>
                <td className="num">{row.gamesPlayed}</td>
                <td className="num">{row.wins}</td>
                <td className="num">{row.losses}</td>
                <td className="num">{row.overtimeLosses}</td>
                <td className="num"><strong>{row.points}</strong></td>
                <td className="num">{row.goalsFor}</td>
                <td className="num">{row.goalsAgainst}</td>
                <td className="num">
                  <DiffCell diff={row.goalsFor - row.goalsAgainst} />
                </td>
                <td>
                  <StreakChip streak={row.streak} />
                </td>
                <td>
                  <LastFiveDots value={row.lastFive} />
                </td>
              </tr>
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DiffCell(props: { diff: number }): JSX.Element {
  const { diff } = props
  const color = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--muted)'
  return (
    <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
      {diff > 0 ? `+${diff}` : diff}
    </span>
  )
}

function StreakChip(props: { streak: string }): JSX.Element {
  const { streak } = props
  const cls = streak.startsWith('W')
    ? 'chip chip-success'
    : streak.startsWith('L')
    ? 'chip chip-danger'
    : 'chip chip-warn'
  return <span className={cls}>{streak}</span>
}

function LastFiveDots(props: { value: string }): JSX.Element {
  const letters = props.value.split('').filter((c) => c === 'W' || c === 'L' || c === 'O')
  if (letters.length === 0) return <span className="muted">—</span>
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {letters.map((c, i) => {
        const bg =
          c === 'W' ? 'var(--success)' : c === 'L' ? 'var(--danger)' : 'var(--accent2)'
        return (
          <span
            key={i}
            title={c === 'W' ? 'Win' : c === 'L' ? 'Loss' : 'OT Loss'}
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: bg,
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
        )
      })}
    </span>
  )
}
