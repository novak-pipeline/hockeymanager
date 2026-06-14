/**
 * NHL Draft Prospect Rankings — the analyst/media consensus board of the
 * draft-eligible class, modelled on real prospect services (Central Scouting,
 * McKenzie, EliteProspects consensus). Lives under Scouting. Evolves across the
 * season: preliminary → mid-season → final. A separate U17 watch list tracks
 * younger talent that's on the radar but not yet draft-eligible.
 */
import type { DraftRankingsView } from '../../engine/career/views'
import { PlayerLink, TeamLink } from '../components/NavContext'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

const PHASE_BLURB: Record<DraftRankingsView['phase'], string> = {
  preliminary: 'Early-season consensus — projection-led, expect movement.',
  midseason: 'The board firms up as the season’s body of work grows.',
  final: 'The final pre-draft consensus, weighting production and readiness.',
}

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

export function DraftRankingsScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData(
    () => client.getDraftRankings(),
    (r) => (r.type === 'draftRankings' ? r.draftRankings : null)
  )
  const rows = data?.rankings ?? []

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <ScreenHeader title="Draft Prospect Rankings">
        <span className="muted small">Analyst consensus of the draft-eligible class — it shifts as they play out the season</span>
      </ScreenHeader>
      <ScreenStateNotices
        loading={loading}
        error={error}
        empty={!loading && rows.length === 0}
        emptyText="No draft-eligible prospects to rank. Load a multi-league database to scout the class across the NCAA, OHL, USHL, Liiga and beyond."
      />

      {data && rows.length > 0 && (
        <Panel title={`NHL Draft Prospect Rankings — ${data.draftYear} class`}>
          <div className="muted small" style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--accent2, #e0b341)' }}>{data.phaseLabel}</strong>
            {' · '}{PHASE_BLURB[data.phase]}
          </div>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>#</th>
                <th style={{ textAlign: 'left' }}>Player</th>
                <th>Age</th><th>Pos</th>
                <th style={{ textAlign: 'left' }}>Nation</th>
                <th style={{ textAlign: 'left' }}>League</th>
                <th style={{ textAlign: 'left' }}>Team</th>
                <th style={{ textAlign: 'left' }}>Ability</th>
                <th style={{ textAlign: 'left' }}>Potential</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.playerId}>
                  <td className="muted" style={{ textAlign: 'center', fontWeight: 700 }}>{p.rank}</td>
                  <td>
                    <PlayerLink playerId={p.playerId} name={p.name} />
                    {p.eligibility === 'reentry' && (
                      <span className="muted small" title="Re-entry eligible (passed over)"> · RE</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{p.age}</td>
                  <td style={{ textAlign: 'center' }}>{p.position}</td>
                  <td className="muted">{p.nation}</td>
                  <td className="muted">{p.leagueAbbr}</td>
                  <td className="muted"><TeamLink teamId={p.teamId} name={p.teamAbbr} /></td>
                  <td><Stars value={p.currentStars} /></td>
                  <td><Stars value={p.potentialStars} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {data && data.radar.length > 0 && (
        <Panel title="On the radar — U17 watch list (not yet draft-eligible)">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Tracked early (14–16) for future drafts — ranked by projected ceiling.
          </div>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>#</th>
                <th style={{ textAlign: 'left' }}>Player</th>
                <th>Age</th><th>Pos</th>
                <th style={{ textAlign: 'left' }}>Nation</th>
                <th style={{ textAlign: 'left' }}>League</th>
                <th style={{ textAlign: 'left' }}>Team</th>
                <th style={{ textAlign: 'left' }}>Potential</th>
              </tr>
            </thead>
            <tbody>
              {data.radar.map((p) => (
                <tr key={p.playerId}>
                  <td className="muted" style={{ textAlign: 'center' }}>{p.rank}</td>
                  <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
                  <td style={{ textAlign: 'center' }}>{p.age}</td>
                  <td style={{ textAlign: 'center' }}>{p.position}</td>
                  <td className="muted">{p.nation}</td>
                  <td className="muted">{p.leagueAbbr}</td>
                  <td className="muted"><TeamLink teamId={p.teamId} name={p.teamAbbr} /></td>
                  <td><Stars value={p.potentialStars} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  )
}
