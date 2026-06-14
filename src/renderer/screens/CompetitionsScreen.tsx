/**
 * Competitions (the wider world): browse the NHL's feeder and international
 * leagues — standings + top scorers per league. Data from getCompetitions
 * (League.competitions). Empty when the active database has no other leagues.
 */
import { useState } from 'react'
import type { CompetitionView } from '../../engine/career/views'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

const TIER_LABEL: Record<CompetitionView['tier'], string> = {
  active: 'Top league',
  simulated: 'Simulated',
  background: 'Background',
}

function hex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0')
}

export function CompetitionsScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData(
    () => client.getCompetitions(),
    (r) => (r.type === 'competitions' ? r.competitions : null)
  )
  const [selected, setSelected] = useState<string | null>(null)

  const comps = data?.competitions ?? []
  const current = comps.find((c) => c.id === selected) ?? comps[0] ?? null

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <ScreenHeader title="Competitions">
        <span className="muted small">The wider hockey world — feeders &amp; international leagues</span>
      </ScreenHeader>
      <ScreenStateNotices
        loading={loading}
        error={error}
        empty={!loading && comps.length === 0}
        emptyText="This database has no additional leagues. Load a multi-league database to follow the OHL, KHL, SHL and others here."
      />

      {comps.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>
          {/* League list */}
          <Panel title={`Leagues (${comps.length})`}>
            <div className="stack" style={{ gap: 2 }}>
              {comps.map((c) => {
                const active = current?.id === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', textAlign: 'left', gap: 8, padding: '6px 8px', borderRadius: 6,
                      border: '1px solid var(--line)',
                      background: active ? 'var(--accent-soft, rgba(120,120,255,0.14))' : 'transparent',
                      cursor: 'pointer', color: 'inherit',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 700 }}>{c.abbrev}</span>{' '}
                      <span className="muted small">{c.nation}</span>
                    </span>
                    <span className="muted small" title="NHL-equivalent strength">
                      {Math.round(c.strength * 100)}
                    </span>
                  </button>
                )
              })}
            </div>
          </Panel>

          {/* Selected league */}
          {current && (
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              <Panel title={current.name}>
                <div className="muted small" style={{ marginBottom: 8 }}>
                  {current.nation} · {TIER_LABEL[current.tier]} · NHL-equivalent strength{' '}
                  {Math.round(current.strength * 100)}%
                </div>
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>#</th>
                      <th style={{ textAlign: 'left' }}>Team</th>
                      <th>GP</th><th>W</th><th>L</th><th>OTL</th><th>PTS</th><th>GF</th><th>GA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.standings.map((s, i) => (
                      <tr key={s.teamId}>
                        <td className="muted">{i + 1}</td>
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

              {current.scorers.length > 0 && (
                <Panel title="Top scorers">
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Player</th>
                        <th style={{ textAlign: 'left' }}>Team</th>
                        <th>GP</th><th>G</th><th>A</th><th>P</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.scorers.map((p) => (
                        <tr key={p.playerId}>
                          <td>{p.name}</td>
                          <td className="muted">{p.teamAbbr}</td>
                          <td style={{ textAlign: 'center' }}>{p.gamesPlayed}</td>
                          <td style={{ textAlign: 'center' }}>{p.goals}</td>
                          <td style={{ textAlign: 'center' }}>{p.assists}</td>
                          <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
