import { useState } from 'react'
import type { PlayoffBracketView, SeriesView } from '../../worker/protocol'
import { crestColor } from '../components/format'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

export function PlayoffsScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<PlayoffBracketView>(
    () => client.getPlayoffs(),
    (r) => (r.type === 'playoffs' ? r.playoffs : null)
  )

  if (error) {
    return (
      <section>
        <ScreenHeader title="Playoffs" />
        <Notice kind="warn">{error}</Notice>
      </section>
    )
  }
  if (!data) {
    return (
      <section>
        <ScreenHeader title="Playoffs" />
        <Notice kind="info">{loading ? 'Loading…' : 'The playoffs have not started.'}</Notice>
      </section>
    )
  }

  const winsNeeded = Math.ceil(data.bestOf / 2)

  return (
    <section className="stack">
      <ScreenHeader title={`${data.year} Playoffs`}>
        {data.championTeamName && (
          <span className="chip chip-warn">🏆 {data.championTeamName} — Champions</span>
        )}
      </ScreenHeader>

      {data.championTeamName && (
        <div className="dash-banner">🏆 {data.championTeamName} win the {data.year} championship!</div>
      )}

      {!data.userQualified && !data.championTeamName && (
        <Notice kind="info">Your club did not qualify for the playoffs this season.</Notice>
      )}

      {data.userQualified && !data.userAlive && !data.championTeamName && (
        <Notice kind="warn">Your club has been eliminated from the playoffs.</Notice>
      )}

      {/* Bracket — one column per round */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-4)',
          alignItems: 'flex-start',
          overflowX: 'auto',
          paddingBottom: 'var(--sp-2)',
        }}
      >
        {data.rounds.map((round) => (
          <div
            key={round.round}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--sp-4)',
              minWidth: 240,
              flex: '0 0 240px',
            }}
          >
            <div
              className="muted"
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.7px',
                textAlign: 'center',
              }}
            >
              {round.name}
            </div>
            {round.series.map((series) => (
              <SeriesCard
                key={series.seriesId}
                series={series}
                winsNeeded={winsNeeded}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function SeriesCard(props: { series: SeriesView; winsNeeded: number }): JSX.Element {
  const { series, winsNeeded } = props
  const [expanded, setExpanded] = useState(false)

  const hi = series.highSeed
  const lo = series.lowSeed
  const hiColor = crestColor(hi.teamId)
  const loColor = crestColor(lo.teamId)

  return (
    <div
      style={{
        background: 'var(--bg1)',
        border: `1px solid ${series.involvesUser ? 'rgba(139,92,246,0.45)' : 'var(--line)'}`,
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      {/* Series header */}
      <div style={{ padding: 'var(--sp-3) var(--sp-3) var(--sp-2)' }}>
        <TeamRow
          name={hi.name}
          abbr={hi.abbr}
          seed={hi.seed}
          wins={hi.wins}
          winsNeeded={winsNeeded}
          color={hiColor}
          leader={hi.wins > lo.wins}
          winner={series.finished && hi.wins > lo.wins}
        />
        <div style={{ height: 6 }} />
        <TeamRow
          name={lo.name}
          abbr={lo.abbr}
          seed={lo.seed}
          wins={lo.wins}
          winsNeeded={winsNeeded}
          color={loColor}
          leader={lo.wins > hi.wins}
          winner={series.finished && lo.wins > hi.wins}
        />
      </div>

      {/* Status footer */}
      <div
        style={{
          padding: '6px var(--sp-3)',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--sp-2)',
        }}
      >
        <span
          className="muted"
          style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {series.statusLabel}
        </span>
        {series.games.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide' : 'Games'}
          </button>
        )}
      </div>

      {/* Expandable game results */}
      {expanded && series.games.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line)', padding: 'var(--sp-2) var(--sp-3)' }}>
          {series.games.map((g) => (
            <div
              key={g.gameNumber}
              className="small"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-2)',
                padding: '3px 0',
                borderTop: g.gameNumber > 1 ? '1px solid var(--line)' : 'none',
              }}
            >
              <span className="muted" style={{ width: 24, flexShrink: 0, textAlign: 'center' }}>
                G{g.gameNumber}
              </span>
              <span style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}>
                {g.awayAbbr} {g.awayGoals} @ {g.homeAbbr} {g.homeGoals}
              </span>
              {g.overtime && (
                <span className="chip chip-warn" style={{ fontSize: 10, padding: '0 5px' }}>
                  OT
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TeamRow(props: {
  name: string
  abbr: string
  seed: number
  wins: number
  winsNeeded: number
  color: string
  leader: boolean
  winner: boolean
}): JSX.Element {
  const { name, abbr, seed, wins, winsNeeded, color, leader, winner } = props

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        opacity: winner === false && !leader && wins === 0 ? 0.7 : 1,
      }}
    >
      {/* Crest dot */}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: color,
          fontSize: 9,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {abbr.slice(0, 2)}
      </span>

      {/* Seed + name */}
      <span
        className="muted"
        style={{ fontSize: 11, width: 18, textAlign: 'right', flexShrink: 0 }}
      >
        ({seed})
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: winner || leader ? 600 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>

      {/* Win pips */}
      <WinPips wins={wins} winsNeeded={winsNeeded} winner={winner} />
    </div>
  )
}

function WinPips(props: { wins: number; winsNeeded: number; winner: boolean }): JSX.Element {
  const { wins, winsNeeded, winner } = props
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
      {Array.from({ length: winsNeeded }).map((_, i) => {
        const filled = i < wins
        return (
          <span
            key={i}
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: filled
                ? winner
                  ? 'var(--accent2)'
                  : 'var(--accent)'
                : 'var(--bg2)',
              border: `1px solid ${filled ? 'transparent' : 'var(--line)'}`,
            }}
          />
        )
      })}
    </span>
  )
}
