/**
 * World: the wider hockey universe beyond the NHL. A strength-ranked board of
 * every imported league, and per-league depth — standings, scoring leaders, the
 * best established players, and the top prospects to scout. Data from
 * getCompetitions (League.competitions). Empty when the active DB is NHL-only.
 */
import { useMemo, useState } from 'react'
import { PotentialStars, StarRating } from '../components/Stars'
import type { CompetitionNotableView, CompetitionView, NationView, WorldJuniorsView } from '../../engine/career/views'
import type { IntlEventView, WorldHistoryView, WorldLeagueHistoryView } from '../../engine/career/worldHistoryView'
import type { IntlPlayerLine, WorldSeasonRecord } from '../../domain'
import { PlayerLink, TeamLink } from '../components/NavContext'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { useClient, useScreenData } from '../hooks/useSim'
import { SortHeaders, sortColumns, useTableSort } from '../components/sortable'

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
function Stars({ value, potential }: { value: number; potential?: boolean }): JSX.Element {
  return potential ? <PotentialStars stars={value} /> : <StarRating value={value} />
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

function notableCols(showAge: boolean, hideRatings: boolean) {
  return sortColumns<CompetitionNotableView>()([
    { key: 'name', label: 'Player', value: (p) => p.name, style: { textAlign: 'left' } },
    { key: 'team', label: 'Team', value: (p) => p.teamAbbr, style: { textAlign: 'left' } },
    { key: 'position', label: 'Pos', value: (p) => p.position },
    ...(showAge ? [{ key: 'age', label: 'Age', value: (p: CompetitionNotableView) => p.age } as const] : []),
    ...(hideRatings
      ? []
      : [
          { key: 'currentStars', label: 'Ability', value: (p: CompetitionNotableView) => p.currentStars, style: { textAlign: 'left' } } as const,
          { key: 'potentialStars', label: 'Potential', value: (p: CompetitionNotableView) => p.potentialStars, style: { textAlign: 'left' } } as const,
        ]),
  ])
}

function NotableTable({ rows, showAge, hideRatings }: { rows: CompetitionNotableView[]; showAge?: boolean; hideRatings?: boolean }): JSX.Element {
  const cols = useMemo(() => notableCols(!!showAge, !!hideRatings), [showAge, hideRatings])
  const { sorted, sortKey, dir, sortBy } = useTableSort(rows, cols, { key: null })
  return (
    <table className="data-table" style={{ width: '100%' }}>
      <thead>
        <tr>
          <SortHeaders columns={cols} sortKey={sortKey} dir={dir} onSort={sortBy} />
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.playerId}>
            <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
            <td className="muted"><TeamLink teamId={p.teamId} name={p.teamAbbr} /></td>
            <td style={{ textAlign: 'center' }}>{p.position}</td>
            {showAge && <td style={{ textAlign: 'center' }}>{p.age}</td>}
            {!hideRatings && <td><Stars value={p.currentStars} /></td>}
            {!hideRatings && <td><Stars value={p.potentialStars} potential /></td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function WorldScreen(props: { tab?: 'leagues' | 'international' }): JSX.Element {
  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <ScreenHeader title="World">
        <span className="muted small">The wider hockey world — leagues, juniors &amp; international</span>
      </ScreenHeader>
      {props.tab === 'international' ? <InternationalPanel /> : <LeaguesPanel />}
    </div>
  )
}

function LeaguesPanel(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData(
    () => client.getCompetitions(),
    (r) => (r.type === 'competitions' ? r.competitions : null)
  )
  const [selected, setSelected] = useState<string | null>(null)
  const history = useWorldHistory()

  const comps = [...(data?.competitions ?? [])].sort((a, b) => a.strengthRank - b.strengthRank)
  const current = comps.find((c) => c.id === selected) ?? comps[0] ?? null

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
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
            <LeagueStrengthTable comps={comps} currentId={current?.id ?? null} onSelect={setSelected} />
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
                  <CompetitionStandingsTable rows={current.standings} />
                </Panel>

                <Panel title="Scoring leaders">
                  {current.scorers.length === 0 ? (
                    <div className="muted small">No games played yet this season.</div>
                  ) : (
                    <CompetitionScorersTable rows={current.scorers} />
                  )}
                </Panel>
              </div>
              <SelectedLeagueRest current={current} />
              <LeagueHistoryPanel
                league={history?.leagues.find((l) => l.competitionId === current.id) ?? null}
                memorialCup={['OHL', 'WHL', 'QMJHL', 'LHJMQ'].includes(current.abbrev.toUpperCase()) ? history?.memorialCup ?? [] : []}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

const LEAGUE_STRENGTH_COLS = sortColumns<CompetitionView>()([
  { key: 'strengthRank', label: '#', value: (c) => c.strengthRank, initialDir: 'asc' },
  { key: 'league', label: 'League', value: (c) => c.abbrev, style: { textAlign: 'left' } },
  { key: 'nation', label: 'Nation', value: (c) => c.nation, style: { textAlign: 'left' } },
  { key: 'tier', label: 'Tier', value: (c) => c.tier, style: { textAlign: 'left' } },
  { key: 'teamCount', label: 'Teams', value: (c) => c.teamCount },
  { key: 'playerCount', label: 'Players', value: (c) => c.playerCount },
  { key: 'strength', label: 'NHL-equivalent strength', value: (c) => c.strength, style: { textAlign: 'left' } },
])

function LeagueStrengthTable(props: {
  comps: CompetitionView[]
  currentId: string | null
  onSelect: (id: string) => void
}): JSX.Element {
  const { sorted, sortKey, dir, sortBy } = useTableSort(props.comps, LEAGUE_STRENGTH_COLS, { key: null })
  const { currentId, onSelect } = props
  return (
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <SortHeaders columns={LEAGUE_STRENGTH_COLS} sortKey={sortKey} dir={dir} onSort={sortBy} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => onSelect(c.id)}
                    style={{
                      cursor: 'pointer',
                      background: currentId === c.id ? 'var(--accent-soft, rgba(120,120,255,0.12))' : undefined,
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
  )
}

type CompStandingRow = CompetitionView['standings'][number]
type RankedCompStandingRow = CompStandingRow & { rank: number }

const COMP_STANDINGS_COLS = sortColumns<RankedCompStandingRow>()([
  { key: 'rank', label: '#', value: (s) => s.rank, initialDir: 'asc' },
  { key: 'name', label: 'Team', value: (s) => s.name, style: { textAlign: 'left' } },
  { key: 'gamesPlayed', label: 'GP', value: (s) => s.gamesPlayed },
  { key: 'wins', label: 'W', value: (s) => s.wins },
  { key: 'losses', label: 'L', value: (s) => s.losses },
  { key: 'overtimeLosses', label: 'OTL', value: (s) => s.overtimeLosses },
  { key: 'points', label: 'PTS', value: (s) => s.points },
  { key: 'goalsFor', label: 'GF', value: (s) => s.goalsFor },
  { key: 'goalsAgainst', label: 'GA', value: (s) => s.goalsAgainst },
])

function CompetitionStandingsTable(props: { rows: CompStandingRow[] }): JSX.Element {
  const ranked = useMemo<RankedCompStandingRow[]>(
    () => props.rows.map((r, i) => ({ ...r, rank: i + 1 })),
    [props.rows],
  )
  const { sorted, sortKey, dir, sortBy } = useTableSort(ranked, COMP_STANDINGS_COLS, { key: null })
  return (
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <SortHeaders columns={COMP_STANDINGS_COLS} sortKey={sortKey} dir={dir} onSort={sortBy} />
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((s) => (
                        <tr key={s.teamId}>
                          <td className="muted" style={{ textAlign: 'center' }}>{s.rank}</td>
                          <td>
                            <span style={{
                              display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 6,
                              background: hex(s.colors.primary), border: `1px solid ${hex(s.colors.secondary)}`,
                            }} />
                            <TeamLink teamId={s.teamId} name={s.name} />
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
  )
}

type CompScorerRow = CompetitionView['scorers'][number]

const COMP_SCORER_COLS = sortColumns<CompScorerRow>()([
  { key: 'name', label: 'Player', value: (p) => p.name, style: { textAlign: 'left' } },
  { key: 'team', label: 'Team', value: (p) => p.teamAbbr },
  { key: 'gamesPlayed', label: 'GP', value: (p) => p.gamesPlayed },
  { key: 'goals', label: 'G', value: (p) => p.goals },
  { key: 'assists', label: 'A', value: (p) => p.assists },
  { key: 'points', label: 'P', value: (p) => p.points },
])

function CompetitionScorersTable(props: { rows: CompScorerRow[] }): JSX.Element {
  const { sorted, sortKey, dir, sortBy } = useTableSort(props.rows, COMP_SCORER_COLS, { key: null })
  return (
                    <table className="data-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <SortHeaders columns={COMP_SCORER_COLS} sortKey={sortKey} dir={dir} onSort={sortBy} />
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((p) => (
                          <tr key={p.playerId}>
                            <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
                            <td className="muted" style={{ textAlign: 'center' }}><TeamLink teamId={p.teamId} name={p.teamAbbr} /></td>
                            <td style={{ textAlign: 'center' }}>{p.gamesPlayed}</td>
                            <td style={{ textAlign: 'center' }}>{p.goals}</td>
                            <td style={{ textAlign: 'center' }}>{p.assists}</td>
                            <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
  )
}

/** The lower half of a selected league's page. */
function SelectedLeagueRest({ current }: { current: CompetitionView }): JSX.Element {
  return (
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
  )
}

/** Stable identity so the sort hook is not handed a fresh array each render. */
const EMPTY_NATIONS: NationView[] = []

const NATION_COLS = sortColumns<NationView>()([
  { key: 'rank', label: '#', value: (n) => n.rank, initialDir: 'asc' },
  { key: 'nation', label: 'Nation', value: (n) => n.nation, style: { textAlign: 'left' } },
  { key: 'playerCount', label: 'Players', value: (n) => n.playerCount },
  { key: 'rating', label: 'Strength', value: (n) => n.rating, style: { textAlign: 'left' } },
])

function InternationalPanel(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData(
    () => client.getInternational(),
    (r) => (r.type === 'international' ? r.international : null)
  )
  const [selected, setSelected] = useState<string | null>(null)

  const nations = data?.nations ?? EMPTY_NATIONS
  const current = nations.find((n) => n.nation === selected) ?? nations[0] ?? null
  const nationSort = useTableSort(nations, NATION_COLS, { key: null })

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <ScreenStateNotices
        loading={loading}
        error={error}
        empty={!loading && nations.length === 0}
        emptyText="No nationality data in this database. Load a multi-league database to see national-team power rankings."
      />

      {nations.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>
          {/* National-team power rankings */}
          <Panel title="National team power rankings">
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <SortHeaders columns={NATION_COLS} sortKey={nationSort.sortKey} dir={nationSort.dir} onSort={nationSort.sortBy} />
                </tr>
              </thead>
              <tbody>
                {nationSort.sorted.map((n) => (
                  <tr
                    key={n.nation}
                    onClick={() => setSelected(n.nation)}
                    style={{ cursor: 'pointer', background: current?.nation === n.nation ? 'var(--accent-soft, rgba(120,120,255,0.12))' : undefined }}
                  >
                    <td className="muted" style={{ textAlign: 'center' }}>{n.rank}</td>
                    <td style={{ fontWeight: 700 }}>{n.nation}</td>
                    <td style={{ textAlign: 'center' }} className="muted">{n.playerCount}</td>
                    <td><NationStrengthBar rating={n.rating} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {/* Selected nation: profile + senior / U20 squads */}
          {current && <NationDetail nation={current} />}
        </div>
      )}

      <TournamentResultsPanel />
      {data?.worldJuniors && <WorldJuniorsPanel wj={data.worldJuniors} />}
    </div>
  )
}

/* ───────────────────────── World Renewal: history + tournaments ───────────────────────── */

function useWorldHistory(): WorldHistoryView | null {
  const client = useClient()
  const { data } = useScreenData(
    () => client.getWorldHistory(),
    (r) => (r.type === 'worldHistory' ? r.worldHistory : null)
  )
  return data ?? null
}

const seasonLabel = (y: number): string => `${y}–${String((y + 1) % 100).padStart(2, '0')}`

type Ref = { playerId: string; name: string; teamAbbr: string; value: string }

function RefCell({ r }: { r: Ref | undefined }): JSX.Element {
  if (!r) return <td className="muted">—</td>
  return (
    <td>
      <PlayerLink playerId={r.playerId} name={r.name} />{' '}
      <span className="muted small">{r.teamAbbr} · {r.value}</span>
    </td>
  )
}

/** A league's roll of honour: every champion + award slate on file. */
function LeagueHistoryPanel({ league, memorialCup }: { league: WorldLeagueHistoryView | null; memorialCup: WorldSeasonRecord[] }): JSX.Element {
  if (!league) {
    return (
      <Panel title="Champions & awards">
        <div className="muted small">No season has finished yet. Each league crowns its champion during the NHL postseason.</div>
      </Panel>
    )
  }
  const rec = league.records
  return (
    <Panel title={`${league.trophy} — champions & awards`}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 18, marginBottom: 10, fontSize: 13 }}>
        {league.titles.slice(0, 4).map((t) => (
          <span key={t.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon size={14} color="var(--accent, #f5b301)"><Icons.Award /></Icon>
            <b>{t.name}</b> <span className="muted">×{t.titles}</span>
          </span>
        ))}
        {rec.points && (
          <span className="muted">
            League record: {rec.points.value} pts, {rec.points.name} ({seasonLabel(rec.points.year)})
          </span>
        )}
      </div>
      <table className="data-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Season</th>
            <th style={{ textAlign: 'left' }}>Champion</th>
            <th>Final</th>
            <th style={{ textAlign: 'left' }}>Playoff MVP</th>
            <th style={{ textAlign: 'left' }}>MVP</th>
            <th style={{ textAlign: 'left' }}>Top scorer</th>
            <th style={{ textAlign: 'left' }}>Top goalie</th>
            <th style={{ textAlign: 'left' }}>Rookie</th>
          </tr>
        </thead>
        <tbody>
          {league.seasons.map((s) => (
            <tr key={s.year}>
              <td className="muted">{seasonLabel(s.year)}</td>
              <td>
                {s.championTeamId ? <TeamLink teamId={s.championTeamId} name={s.championName ?? '—'} /> : '—'}
                {s.runnerUpName && <span className="muted small"> over {s.runnerUpName}</span>}
              </td>
              <td style={{ textAlign: 'center' }}>{s.finalScore ?? '—'}</td>
              <RefCell r={s.playoffMvp} />
              <RefCell r={s.mvp} />
              <RefCell r={s.topScorer} />
              <RefCell r={s.topGoalie} />
              <RefCell r={s.rookie} />
            </tr>
          ))}
        </tbody>
      </table>
      {memorialCup.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>Memorial Cup</div>
          <table className="data-table" style={{ width: '100%' }}>
            <tbody>
              {memorialCup.map((s) => (
                <tr key={s.year}>
                  <td className="muted">{s.year + 1}</td>
                  <td>{s.championTeamId ? <TeamLink teamId={s.championTeamId} name={s.championName ?? '—'} /> : '—'}</td>
                  <td className="muted">def. {s.runnerUpName ?? '—'} {s.finalScore ?? ''}</td>
                  <td className="muted small">host: {s.regularSeasonWinner ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

const lineStat = (l: IntlPlayerLine): string =>
  l.position === 'G' && l.sa
    ? `${((l.sv ?? 0) / l.sa).toFixed(3).replace(/^0/, '')} SV%, ${l.gp} GP`
    : `${l.g}G ${l.a}A ${l.g + l.a}P, ${l.gp} GP`

/** Played tournaments (World Juniors, Olympics, Nations Cup), newest first. */
function TournamentResultsPanel(): JSX.Element | null {
  const history = useWorldHistory()
  const [sel, setSel] = useState(0)
  const events = history?.international ?? []
  if (events.length === 0) return null
  const e: IntlEventView = events[Math.min(sel, events.length - 1)]!
  const medal = (n: string | null, label: string, color: string): JSX.Element => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon size={18} color={color}><Icons.Award /></Icon>
      <span className="muted small" style={{ width: 48 }}>{label}</span>
      <span style={{ fontWeight: 800 }}>{n ?? '—'}</span>
    </div>
  )
  return (
    <Panel title="Tournament results">
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {events.map((ev, i) => (
          <button
            key={`${ev.kind}-${ev.year}`}
            onClick={() => setSel(i)}
            style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--line)', color: 'inherit',
              background: i === sel ? 'var(--accent-soft, rgba(120,120,255,0.16))' : 'transparent',
              fontWeight: i === sel ? 700 : 400,
            }}
          >{ev.year + 1} {ev.name}</button>
        ))}
      </div>
      {e.yours.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'var(--accent-soft, rgba(120,120,255,0.12))', border: '1px solid var(--accent, var(--violet-h))' }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>Your players at the tournament ({e.yours.length})</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            {e.yours.map((l) => (
              <span key={l.playerId} className="small">
                <PlayerLink playerId={l.playerId} name={l.name} /> <span className="muted">({l.nation}, {lineStat(l)})</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 'var(--sp-4)', alignItems: 'start' }}>
        <div className="stack" style={{ gap: 6 }}>
          {medal(e.gold, 'Gold', 'var(--accent, #f5b301)')}
          {medal(e.silver, 'Silver', 'var(--muted)')}
          {e.bronze !== null && medal(e.bronze, 'Bronze', '#cd7f32')}
          {e.finalLine && <div className="muted small" style={{ marginTop: 4 }}>Final: {e.finalLine}</div>}
          <div className="small" style={{ marginTop: 8 }}>
            {e.mvp && <div><span className="muted">MVP</span> <PlayerLink playerId={e.mvp.playerId} name={e.mvp.name} /> <span className="muted">({e.mvp.nation}, {lineStat(e.mvp)})</span></div>}
            {e.topScorer && <div><span className="muted">Top scorer</span> <PlayerLink playerId={e.topScorer.playerId} name={e.topScorer.name} /> <span className="muted">({lineStat(e.topScorer)})</span></div>}
            {e.bestGoalie && <div><span className="muted">Best goalie</span> <PlayerLink playerId={e.bestGoalie.playerId} name={e.bestGoalie.name} /> <span className="muted">({lineStat(e.bestGoalie)})</span></div>}
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>Final standings</div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
            {e.standings.map((n) => <li key={n}>{n}</li>)}
          </ol>
        </div>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div>
            <div className="muted small" style={{ marginBottom: 4 }}>All-tournament team</div>
            <table className="data-table" style={{ width: '100%' }}>
              <tbody>
                {e.allStars.map((l) => (
                  <tr key={l.playerId}>
                    <td className="muted" style={{ textAlign: 'center', width: 32 }}>{l.position}</td>
                    <td style={{ fontWeight: 700 }}><PlayerLink playerId={l.playerId} name={l.name} /></td>
                    <td className="muted">{l.nation}</td>
                    <td className="muted" style={{ textAlign: 'right' }}>{lineStat(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 4 }}>Scoring leaders</div>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr><th style={{ textAlign: 'left' }}>Player</th><th style={{ textAlign: 'left' }}>Nation</th><th>GP</th><th>G</th><th>A</th><th>P</th></tr>
              </thead>
              <tbody>
                {e.leaders.map((l) => (
                  <tr key={l.playerId}>
                    <td><PlayerLink playerId={l.playerId} name={l.name} /></td>
                    <td className="muted">{l.nation}</td>
                    <td style={{ textAlign: 'center' }}>{l.gp}</td>
                    <td style={{ textAlign: 'center' }}>{l.g}</td>
                    <td style={{ textAlign: 'center' }}>{l.a}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{l.g + l.a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Panel>
  )
}

/** #48/P5: projected World Juniors medal table + all-tournament team, with the
 *  user's own prospects highlighted — the marquee prospect showcase. */
function WorldJuniorsPanel({ wj }: { wj: WorldJuniorsView }): JSX.Element {
  const medal = (n: string | null, color: string): JSX.Element => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon size={18} color={color}><Icons.Award /></Icon>
      <span style={{ fontWeight: 800, color }}>{n ?? '—'}</span>
    </div>
  )
  return (
    <Panel title="Next World Juniors (U20) — projected">
      <div className="muted small" style={{ marginBottom: 10 }}>
        If the World Juniors were held now, here's how the U20 field would shake out — the marquee
        prospect showcase.
      </div>

      {wj.yours && wj.yours.length > 0 && (
        <div
          style={{
            marginBottom: 12, padding: '8px 12px', borderRadius: 8,
            background: 'var(--accent-soft, rgba(120,120,255,0.12))',
            border: '1px solid var(--accent, var(--violet-h))',
          }}
        >
          <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
            ★ Your prospects on show ({wj.yours.length})
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            {wj.yours.map((s) => (
              <span key={s.playerId} className="small">
                <PlayerLink playerId={s.playerId} name={s.name} /> <span className="muted">({s.nation}, {s.position})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 'var(--sp-4)', alignItems: 'start' }}>
        {/* Medal table + standings */}
        <div>
          <div className="stack" style={{ gap: 4, marginBottom: 10 }}>
            {medal(wj.gold, 'var(--accent, #f5b301)')}
            {medal(wj.silver, 'var(--muted)')}
            {medal(wj.bronze, '#cd7f32')}
          </div>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr><th>#</th><th style={{ textAlign: 'left' }}>Nation</th><th>Pool</th></tr>
            </thead>
            <tbody>
              {wj.standings.map((s) => (
                <tr key={s.nation}>
                  <td className="muted" style={{ textAlign: 'center' }}>{s.finish}</td>
                  <td style={{ fontWeight: 700 }}>{s.nation}</td>
                  <td className="muted" style={{ textAlign: 'center' }}>{s.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* All-tournament team */}
        <div>
          <div className="muted small" style={{ marginBottom: 4 }}>All-tournament team</div>
          <table className="data-table" style={{ width: '100%' }}>
            <tbody>
              {wj.allStars.map((s) => (
                <tr key={s.playerId} style={s.isYours ? { background: 'var(--accent-soft, rgba(120,120,255,0.12))' } : undefined}>
                  <td style={{ fontWeight: 700 }}>
                    <PlayerLink playerId={s.playerId} name={s.name} />
                    {s.isYours && <span className="chip" style={{ marginLeft: 6, fontSize: 9, color: 'var(--accent, var(--violet-h))', borderColor: 'var(--accent, var(--violet-h))' }}>YOURS</span>}
                  </td>
                  <td className="muted">{s.nation}</td>
                  <td className="muted" style={{ textAlign: 'center' }}>{s.position}</td>
                  <td className="muted" style={{ textAlign: 'right' }}>{'★'.repeat(Math.round(s.stars))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  )
}

function NationDetail({ nation }: { nation: NationView }): JSX.Element {
  const [tab, setTab] = useState<'overview' | 'senior' | 'u20'>('overview')
  const tabBtn = (id: 'overview' | 'senior' | 'u20', label: string): JSX.Element => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
        border: '1px solid var(--line)',
        background: tab === id ? 'var(--accent-soft, rgba(120,120,255,0.16))' : 'transparent',
        color: 'inherit', fontWeight: tab === id ? 700 : 400,
      }}
    >{label}</button>
  )
  return (
    <Panel title={`${nation.nation}${tab === 'senior' ? ' — Team' : tab === 'u20' ? ' — Under-20' : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <span className="muted small">
          #{nation.rank} in the world · strength {nation.rating} · {nation.playerCount} players
        </span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {tabBtn('overview', 'Overview')}
          {tabBtn('senior', 'Team')}
          {tabBtn('u20', 'Under-20')}
        </span>
      </div>

      {tab === 'overview' && (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          {/* Nation profile */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <span><span className="muted">Capital</span> {nation.capital || '—'}</span>
            <span><span className="muted">Continent</span> {nation.continent || '—'}</span>
            <span><span className="muted">World ranking</span> #{nation.rank}</span>
            <span><span className="muted">Languages</span> {nation.languages.length ? nation.languages.join(', ') : '—'}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>
            {/* Top leagues */}
            <div>
              <div className="muted small" style={{ marginBottom: 4 }}>Top leagues</div>
              {nation.topLeagues.length === 0 ? (
                <div className="muted small">No domestic leagues modelled.</div>
              ) : (
                <table className="data-table" style={{ width: '100%' }}>
                  <tbody>
                    {nation.topLeagues.map((l) => (
                      <tr key={l.id}>
                        <td style={{ fontWeight: 700 }}>{l.abbrev}</td>
                        <td className="muted">{l.name}</td>
                        <td className="muted" style={{ textAlign: 'right' }} title="NHL-equivalent strength">{Math.round(l.strength * 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {/* Major clubs */}
            <div>
              <div className="muted small" style={{ marginBottom: 4 }}>Major clubs</div>
              {nation.majorClubs.length === 0 ? (
                <div className="muted small">No clubs modelled.</div>
              ) : (
                <table className="data-table" style={{ width: '100%' }}>
                  <tbody>
                    {nation.majorClubs.map((c) => (
                      <tr key={c.teamId}>
                        <td><TeamLink teamId={c.teamId} name={c.name} /></td>
                        <td className="muted" style={{ textAlign: 'right' }}>{c.leagueAbbr}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>
            <div>
              <div className="muted small" style={{ marginBottom: 4 }}>Top players</div>
              <NotableTable rows={nation.topPlayers} hideRatings />
            </div>
            <div>
              <div className="muted small" style={{ marginBottom: 4 }}>Top youth players</div>
              {nation.topYouth.length === 0
                ? <div className="muted small">No notable youth.</div>
                : <NotableTable rows={nation.topYouth} showAge hideRatings />}
            </div>
          </div>
        </div>
      )}

      {tab !== 'overview' && (() => {
        const rows = tab === 'senior' ? nation.seniorSquad : nation.u20Squad
        return rows.length === 0
          ? <div className="muted small">Not enough eligible players to ice this team.</div>
          : <NotableTable rows={rows} showAge />
      })()}
    </Panel>
  )
}

function NationStrengthBar({ rating }: { rating: number }): JSX.Element {
  // Map a 0–100 ability average onto a bar; elite pools sit ~70+.
  const pct = Math.max(4, Math.min(100, Math.round(((rating - 40) / 50) * 100)))
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 72, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--accent2, #e0b341)' }} />
      </span>
      <span className="muted small">{rating}</span>
    </span>
  )
}
