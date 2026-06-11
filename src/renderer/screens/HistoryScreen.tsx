import { useState } from 'react'
import type { HistoryView } from '../../worker/protocol'
import type { AwardRecord, LegendRecord, RecordEntry, SeasonArchive } from '@engine/story/records'
import { PlayerLink } from '../components/NavContext'
import { Notice, Panel, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/* ── tab ids ── */
type TabId = 'records' | 'seasons' | 'awards' | 'legends'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'records', label: 'Records' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'awards',  label: 'Awards' },
  { id: 'legends', label: 'Legends' },
]

/* ── gold accent helpers ── */
const GOLD        = '#d4a017'
const GOLD_DIM    = 'rgba(212,160,23,0.18)'
const GOLD_BORDER = 'rgba(212,160,23,0.35)'
const SILVER      = '#9ba3af'
const BRONZE      = '#c97c3b'

function rankColor(rank: number): string {
  if (rank === 1) return GOLD
  if (rank === 2) return SILVER
  if (rank === 3) return BRONZE
  return 'var(--muted)'
}

/** Format a RecordEntry value: save pct to .000, integers plain */
function fmtValue(stat: string, value: number): string {
  if (stat === 'savePct') return value.toFixed(3)
  return String(value)
}

/* ═══════════════════════════════════════════════════════════════
   Main screen
   ═══════════════════════════════════════════════════════════════ */

export function HistoryScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<HistoryView>(
    () => client.getHistory(),
    (r) => (r.type === 'history' ? r.history : null),
  )
  const [tab, setTab] = useState<TabId>('records')

  return (
    <section className="stack">
      {/* Prestigious header with gold glow */}
      <div
        className="screen-header"
        style={{ borderBottom: `1px solid ${GOLD_BORDER}`, paddingBottom: 'var(--sp-3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>🏆</span>
          <div>
            <h1
              className="screen-title"
              style={{ color: GOLD, letterSpacing: 1 }}
            >
              TROPHY ROOM
            </h1>
            <div
              className="muted small"
              style={{ fontSize: 11, marginTop: 2 }}
            >
              League history · records · legends
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No history recorded yet. Complete a season to see records."
      />

      {data && (
        <>
          {tab === 'records' && <RecordsTab data={data} />}
          {tab === 'seasons' && <SeasonsTab seasons={data.seasons} />}
          {tab === 'awards'  && <AwardsTab awards={data.awards} />}
          {tab === 'legends' && <LegendsTab legends={data.legends} />}
        </>
      )}
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════
   RECORDS TAB
   ═══════════════════════════════════════════════════════════════ */

function RecordsTab(props: { data: HistoryView }): JSX.Element {
  const { data } = props

  const singleSeasonBoards: Array<{ label: string; stat: string; entries: RecordEntry[] }> = [
    { label: 'Goals (Single Season)',   stat: 'goals',   entries: data.singleSeason.goals },
    { label: 'Assists (Single Season)', stat: 'assists', entries: data.singleSeason.assists },
    { label: 'Points (Single Season)',  stat: 'points',  entries: data.singleSeason.points },
    { label: 'Wins (Single Season)',    stat: 'wins',    entries: data.singleSeason.wins },
    { label: 'Save % (Single Season)',  stat: 'savePct', entries: data.singleSeason.savePct },
  ]

  const careerBoards: Array<{ label: string; stat: string; entries: RecordEntry[] }> = [
    { label: 'Goals (Career)',        stat: 'goals',       entries: data.career.goals },
    { label: 'Assists (Career)',      stat: 'assists',     entries: data.career.assists },
    { label: 'Points (Career)',       stat: 'points',      entries: data.career.points },
    { label: 'Games Played (Career)', stat: 'gamesPlayed', entries: data.career.gamesPlayed },
  ]

  const hasAnySingleSeason = singleSeasonBoards.some((b) => b.entries.length > 0)
  const hasAnyCareer = careerBoards.some((b) => b.entries.length > 0)

  return (
    <div className="stack">
      {/* Section: Single Season */}
      <BoardSectionHeader label="Single-Season Records" />
      {!hasAnySingleSeason && (
        <Notice kind="info">No single-season records yet — complete a season to populate these boards.</Notice>
      )}
      <div className="grid grid-3" style={{ gap: 'var(--sp-4)' }}>
        {singleSeasonBoards.map((board) => (
          <RecordBoard key={board.label} label={board.label} stat={board.stat} entries={board.entries} />
        ))}
      </div>

      {/* Section: Career */}
      <BoardSectionHeader label="Career Records" />
      {!hasAnyCareer && (
        <Notice kind="info">No career records yet — players must retire before appearing here.</Notice>
      )}
      <div className="grid grid-3" style={{ gap: 'var(--sp-4)' }}>
        {careerBoards.map((board) => (
          <RecordBoard key={board.label} label={board.label} stat={board.stat} entries={board.entries} />
        ))}
      </div>
    </div>
  )
}

function BoardSectionHeader(props: { label: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        margin: 'var(--sp-3) 0 var(--sp-2)',
      }}
    >
      <span
        style={{
          flex: 'none',
          width: 3,
          height: 18,
          borderRadius: 2,
          background: GOLD,
          opacity: 0.8,
        }}
      />
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: GOLD,
          opacity: 0.85,
        }}
      >
        {props.label}
      </span>
    </div>
  )
}

function RecordBoard(props: { label: string; stat: string; entries: RecordEntry[] }): JSX.Element {
  const { label, stat, entries } = props

  return (
    <div
      className="panel"
      style={{
        padding: 0,
        overflow: 'hidden',
        border: `1px solid ${entries.length > 0 ? GOLD_BORDER : 'var(--line)'}`,
        background: entries.length > 0 ? `linear-gradient(160deg, ${GOLD_DIM} 0%, var(--bg1) 40%)` : 'var(--bg1)',
      }}
    >
      {/* board header */}
      <div
        style={{
          padding: 'var(--sp-3) var(--sp-4)',
          borderBottom: `1px solid ${entries.length > 0 ? GOLD_BORDER : 'var(--line)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            color: entries.length > 0 ? GOLD : 'var(--violet-h)',
          }}
        >
          {label}
        </span>
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: 'var(--sp-4)', color: 'var(--muted)', fontSize: 12 }}>
          No entries yet
        </div>
      ) : (
        <div>
          {entries.slice(0, 10).map((entry, idx) => (
            <RecordRow
              key={`${entry.playerId}-${entry.year}-${idx}`}
              rank={idx + 1}
              entry={entry}
              stat={stat}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RecordRow(props: { rank: number; entry: RecordEntry; stat: string }): JSX.Element {
  const { rank, entry, stat } = props
  const color = rankColor(rank)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        padding: '5px var(--sp-4)',
        borderTop: rank === 1 ? 'none' : '1px solid rgba(42,34,64,0.5)',
        background: rank === 1 ? `rgba(212,160,23,0.06)` : 'transparent',
        transition: 'background 0.1s ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg3)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = rank === 1 ? `rgba(212,160,23,0.06)` : 'transparent' }}
    >
      {/* rank */}
      <span
        style={{
          width: 20,
          textAlign: 'center',
          fontSize: 12,
          fontWeight: 700,
          color,
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {rank === 1 ? '▲' : rank}
      </span>

      {/* player + team */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <PlayerLink playerId={entry.playerId} name={entry.playerName} />
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
          {entry.teamAbbr} · {entry.year}
        </div>
      </div>

      {/* value */}
      <span
        style={{
          fontSize: 15,
          fontWeight: 800,
          fontVariantNumeric: 'tabular-nums',
          color: rank <= 3 ? color : 'var(--text)',
          flexShrink: 0,
        }}
      >
        {fmtValue(stat, entry.value)}
      </span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   SEASONS TAB
   ═══════════════════════════════════════════════════════════════ */

function SeasonsTab(props: { seasons: SeasonArchive[] }): JSX.Element {
  const { seasons } = props

  if (seasons.length === 0) {
    return (
      <Notice kind="info">No completed seasons yet. Finish a season to archive it here.</Notice>
    )
  }

  // Newest first
  const sorted = [...seasons].reverse()

  return (
    <Panel>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Year</th>
              <th>Champion</th>
              <th>Presidents&apos;</th>
              <th>Points Leader</th>
              <th>Goals Leader</th>
              <th>Wins Leader</th>
              <th className="num">Your Rank</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((season) => (
              <SeasonRow key={season.year} season={season} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function SeasonRow(props: { season: SeasonArchive }): JSX.Element {
  const { season } = props
  const isChampion = season.championName !== null
  const championStyle = isChampion
    ? { background: `rgba(212,160,23,0.10)`, borderLeft: `3px solid ${GOLD}` }
    : {}

  return (
    <tr style={championStyle}>
      {/* Year */}
      <td style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {season.year}
      </td>

      {/* Champion */}
      <td>
        {season.championName ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span style={{ fontSize: 13 }}>🏆</span>
            <span style={{ color: GOLD, fontWeight: 600 }}>{season.championName}</span>
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>

      {/* Presidents' */}
      <td>
        {season.presidentsTeamName ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span style={{ fontSize: 11 }}>🥇</span>
            <span style={{ color: 'var(--cyan)', fontSize: 12 }}>{season.presidentsTeamName}</span>
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>

      {/* Leaders */}
      <td><LeaderCell entry={season.leaders.points} /></td>
      <td><LeaderCell entry={season.leaders.goals} /></td>
      <td><LeaderCell entry={season.leaders.wins} /></td>

      {/* Your rank */}
      <td className="num">
        <span
          style={{
            fontWeight: 700,
            color: season.userTeamRank === 1
              ? GOLD
              : season.userTeamRank <= 8
              ? 'var(--green)'
              : season.userTeamRank <= 12
              ? 'var(--amber)'
              : 'var(--muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          #{season.userTeamRank}
        </span>
      </td>
    </tr>
  )
}

function LeaderCell(props: { entry: RecordEntry | null }): JSX.Element {
  if (!props.entry) return <span className="muted">—</span>
  const e = props.entry
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
      <PlayerLink playerId={e.playerId} name={e.playerName} />
      <span style={{ fontSize: 10, color: 'var(--muted)' }}>
        {e.teamAbbr} · <strong style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{e.value}</strong>
      </span>
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════
   AWARDS TAB
   ═══════════════════════════════════════════════════════════════ */

const AWARD_ICONS: Record<string, string> = {
  MVP:           '⭐',
  'Top Scorer':  '🏒',
  'Best Goalie': '🥅',
  'Top Rookie':  '🌟',
  'Best Defender': '🛡️',
  Champion:      '🏆',
}

function awardIcon(award: string): string {
  return AWARD_ICONS[award] ?? '🏅'
}

function AwardsTab(props: { awards: AwardRecord[] }): JSX.Element {
  const { awards } = props

  if (awards.length === 0) {
    return (
      <Notice kind="info">No awards recorded yet. Complete a season to see award history.</Notice>
    )
  }

  // Group by award name, sorted by award name
  const byAward = new Map<string, AwardRecord[]>()
  for (const a of awards) {
    const list = byAward.get(a.award) ?? []
    list.push(a)
    byAward.set(a.award, list)
  }

  const awardNames = [...byAward.keys()].sort()

  return (
    <div className="stack">
      {awardNames.map((awardName) => {
        const entries = byAward.get(awardName)!
        // Newest first
        const sorted = [...entries].sort((a, b) => b.year - a.year)
        return <AwardBoard key={awardName} awardName={awardName} entries={sorted} />
      })}
    </div>
  )
}

function AwardBoard(props: { awardName: string; entries: AwardRecord[] }): JSX.Element {
  const { awardName, entries } = props

  return (
    <Panel>
      {/* Trophy title */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-3)',
          marginBottom: 'var(--sp-4)',
          paddingBottom: 'var(--sp-3)',
          borderBottom: `1px solid ${GOLD_BORDER}`,
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>{awardIcon(awardName)}</span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: GOLD,
            letterSpacing: 0.5,
          }}
        >
          {awardName}
        </span>
        <span
          className="chip"
          style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}
        >
          {entries.length} {entries.length === 1 ? 'season' : 'seasons'}
        </span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Year</th>
              <th>Winner</th>
              <th>Team</th>
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={`${e.year}-${e.playerId}`}>
                <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>
                  {e.year}
                </td>
                <td>
                  <PlayerLink playerId={e.playerId} name={e.playerName} />
                </td>
                <td>
                  <span
                    className="chip chip-violet"
                    style={{ fontSize: 10 }}
                  >
                    {e.teamAbbr}
                  </span>
                </td>
                <td className="num" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {e.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ═══════════════════════════════════════════════════════════════
   LEGENDS TAB
   ═══════════════════════════════════════════════════════════════ */

function LegendsTab(props: { legends: LegendRecord[] }): JSX.Element {
  const { legends } = props

  if (legends.length === 0) {
    return (
      <Notice kind="info">
        No legends yet — players must retire to be enshrined here.
      </Notice>
    )
  }

  // Hall of Famers first, then by career points desc
  const sorted = [...legends].sort((a, b) => {
    if (a.hallOfFame !== b.hallOfFame) return a.hallOfFame ? -1 : 1
    return b.careerPoints - a.careerPoints
  })

  const hofCount = sorted.filter((l) => l.hallOfFame).length

  return (
    <div className="stack">
      {hofCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
            fontSize: 11,
            color: GOLD,
            opacity: 0.8,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
          }}
        >
          <span>🏛</span>
          <span>{hofCount} Hall of Fame inductee{hofCount !== 1 ? 's' : ''}</span>
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 'var(--sp-3)' }}>
        {sorted.map((legend) => (
          <LegendCard key={legend.playerId} legend={legend} />
        ))}
      </div>
    </div>
  )
}

function LegendCard(props: { legend: LegendRecord }): JSX.Element {
  const { legend } = props

  return (
    <div
      className="panel"
      style={{
        padding: 'var(--sp-4)',
        border: legend.hallOfFame ? `1px solid ${GOLD_BORDER}` : '1px solid var(--line)',
        background: legend.hallOfFame
          ? `linear-gradient(135deg, ${GOLD_DIM} 0%, var(--bg1) 50%)`
          : 'var(--bg1)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* HoF shimmer accent */}
      {legend.hallOfFame && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 60,
            height: 60,
            background: `radial-gradient(circle at top right, rgba(212,160,23,0.18) 0%, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Header row: name + HoF badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--sp-3)',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <div>
          <PlayerLink
            playerId={legend.playerId}
            name={legend.name}
            className="legend-name"
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Retired {legend.retiredYear}
          </div>
        </div>
        {legend.hallOfFame && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 999,
              background: GOLD_DIM,
              border: `1px solid ${GOLD_BORDER}`,
              fontSize: 10,
              fontWeight: 700,
              color: GOLD,
              letterSpacing: 0.5,
              flexShrink: 0,
            }}
          >
            🏛 HoF
          </span>
        )}
      </div>

      {/* Career line stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--sp-2)',
        }}
      >
        <LegendStat label="Goals" value={legend.careerGoals} gold={legend.hallOfFame} />
        <LegendStat label="Points" value={legend.careerPoints} gold={legend.hallOfFame} />
        <LegendStat label="Games" value={legend.careerGames} gold={false} />
      </div>
    </div>
  )
}

function LegendStat(props: { label: string; value: number; gold: boolean }): JSX.Element {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 'var(--sp-2)',
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          fontVariantNumeric: 'tabular-nums',
          color: props.gold ? GOLD : 'var(--text)',
          lineHeight: 1.1,
        }}
      >
        {props.value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {props.label}
      </div>
    </div>
  )
}
