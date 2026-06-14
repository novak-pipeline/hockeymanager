/**
 * World: the wider hockey universe beyond the NHL. A strength-ranked board of
 * every imported league, and per-league depth — standings, scoring leaders, the
 * best established players, and the top prospects to scout. Data from
 * getCompetitions (League.competitions). Empty when the active DB is NHL-only.
 */
import { useState } from 'react'
import type { CompetitionNotableView, CompetitionView } from '../../engine/career/views'
import { PlayerLink } from '../components/NavContext'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

const TIER_LABEL: Record<CompetitionView['tier'], string> = {
  active: 'Top flight',
  simulated: 'Full sim',
  background: 'Background',
}
const TIER_COLOR: Record<CompetitionView['tier'], string> = {
  active: 'var(--accent2, #e0b341)',
  simulated: 'var(--good, #4ade80)',
  background: 'var(--muted, #8a93a3)',
}

function hex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0')
}

/** Compact ★ rating (handles halves). */
function Stars({ value }: { value: number }): JSX.Element {
  const full = Math.floor(value)
  const half = value - full >= 0.5
  return (
    <span title={`${value}/5`} style={{ color: 'var(--accent2, #e0b341)', whiteSpace: 'nowrap' }}>
      {'★'.repeat(full)}{half ? '½' : ''}
      <span style={{ color: 'var(--line)' }}>{'★'.repeat(5 - full - (half ? 1 : 0))}</span>
    </span>
  )
}

function StrengthBar({ pct }: { pct: number }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 64, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--accent2, #e0b341)' }} />
      </span>
      <span className="muted small">{pct}</span>
    </span>
  )
}

function NotableTable({ rows, showAge }: { rows: CompetitionNotableView[]; showAge?: boolean }): JSX.Element {
  return (
    <table className="data-table" style={{ width: '100%' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Player</th>
          <th style={{ textAlign: 'left' }}>Team</th>
          <th>Pos</th>
          {showAge && <th>Age</th>}
          <th style={{ textAlign: 'left' }}>Ability</th>
          <th style={{ textAlign: 'left' }}>Potential</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.playerId}>
            <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
            <td className="muted">{p.teamAbbr}</td>
            <td style={{ textAlign: 'center' }}>{p.position}</td>
            {showAge && <td style={{ textAlign: 'center' }}>{p.age}</td>}
            <td><Stars value={p.currentStars} /></td>
            <td><Stars value={p.potentialStars} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function WorldScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData(
    () => client.getCompetitions(),
    (r) => (r.type === 'competitions' ? r.competitions : null)
  )
  const [selected, setSelected] = useState<string | null>(null)

  const comps = [...(data?.competitions ?? [])].sort((a, b) => a.strengthRank - b.strengthRank)
  const current = comps.find((c) => c.id === selected) ?? comps[0] ?? null

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <ScreenHeader title="World">
        <span className="muted small">The wider hockey world — feeders, juniors &amp; international leagues</span>
      </ScreenHeader>
      <ScreenStateNotices
        loading={loading}
        error={error}
        empty={!loading && comps.length === 0}
        emptyText="This database has no additional leagues. Load a multi-league database to follow the OHL, KHL, SHL and others here."
      />

      {comps.length > 0 && (
        <>
          {/* League strength ranking */}
          <Panel title="League strength ranking">
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th style={{ textAlign: 'left' }}>League</th>
                  <th style={{ textAlign: 'left' }}>Nation</th>
                  <th style={{ textAlign: 'left' }}>Tier</th>
                  <th>Teams</th>
                  <th>Players</th>
                  <th style={{ textAlign: 'left' }}>NHL-equivalent strength</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    style={{
                      cursor: 'pointer',
                      background: current?.id === c.id ? 'var(--accent-soft, rgba(120,120,255,0.12))' : undefined,
                    }}
                  >
                    <td className="muted" style={{ textAlign: 'center' }}>{c.strengthRank}</td>
                    <td><span style={{ fontWeight: 700 }}>{c.abbrev}</span> <span className="muted small">{c.name}</span></td>
                    <td className="muted">{c.nation}</td>
                    <td><span style={{ color: TIER_COLOR[c.tier], fontSize: 12 }}>{TIER_LABEL[c.tier]}</span></td>
                    <td style={{ textAlign: 'center' }}>{c.teamCount}</td>
                    <td style={{ textAlign: 'center' }}>{c.playerCount}</td>
                    <td><StrengthBar pct={Math.round(c.strength * 100)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {/* Selected league depth */}
          {current && (
            <>
              <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4 }}>
                {current.name}{' '}
                <span className="muted small" style={{ fontWeight: 400 }}>
                  · {current.nation} · #{current.strengthRank} by strength · {Math.round(current.strength * 100)}% NHL-equivalent
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>
                <Panel title="Standings">
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>#</th><th style={{ textAlign: 'left' }}>Team</th>
                        <th>GP</th><th>W</th><th>L</th><th>OTL</th><th>PTS</th><th>GF</th><th>GA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.standings.map((s, i) => (
                        <tr key={s.teamId}>
                          <td className="muted" style={{ textAlign: 'center' }}>{i + 1}</td>
                          <td>
                            <span style={{
                              display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 6,
                              background: hex(s.colors.primary), border: `1px solid ${hex(s.colors.secondary)}`,
                            }} />
                            {s.name}
                          </td>
                          <td style={{ textAlign: 'center' }}>{s.gamesPlayed}</td>
                          <td style={{ textAlign: 'center' }}>{s.wins}</td>
                          <td style={{ textAlign: 'center' }}>{s.losses}</td>
                          <td style={{ textAlign: 'center' }}>{s.overtimeLosses}</td>
                          <td style={{ textAlign: 'center', fontWeight: 700 }}>{s.points}</td>
                          <td style={{ textAlign: 'center' }}>{s.goalsFor}</td>
                          <td style={{ textAlign: 'center' }}>{s.goalsAgainst}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>

                <Panel title="Scoring leaders">
                  {current.scorers.length === 0 ? (
                    <div className="muted small">No games played yet this season.</div>
                  ) : (
                    <table className="data-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>Player</th><th>Team</th>
                          <th>GP</th><th>G</th><th>A</th><th>P</th>
                        </tr>
                      </thead>
                      <tbody>
                        {current.scorers.map((p) => (
                          <tr key={p.playerId}>
                            <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
                            <td className="muted" style={{ textAlign: 'center' }}>{p.teamAbbr}</td>
                            <td style={{ textAlign: 'center' }}>{p.gamesPlayed}</td>
                            <td style={{ textAlign: 'center' }}>{p.goals}</td>
                            <td style={{ textAlign: 'center' }}>{p.assists}</td>
                            <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Panel>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>
                <Panel title="Notable players">
                  <NotableTable rows={current.notables} />
                </Panel>
                <Panel title="Top prospects to watch">
                  {current.prospects.length === 0 ? (
                    <div className="muted small">No notable young prospects.</div>
                  ) : (
                    <NotableTable rows={current.prospects} showAge />
                  )}
                </Panel>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
