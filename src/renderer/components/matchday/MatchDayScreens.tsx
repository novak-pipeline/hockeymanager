/**
 * The match-day screens around a watched game (Track P):
 *
 *  - IntermissionScreen — the break after a period: the period's stats, the
 *    scoring summary, three stars so far, the assistant's read. One Continue.
 *  - PostgameScreen — FINAL: score, three stars, turning point, team stats, a
 *    shot map, player ratings that explain themselves, the box score.
 *  - LiveMatchPanel — the side panel on the ice view (stats / ratings / feed).
 *  - DeadAir — what the gap between two highlights shows in the condensed modes.
 *
 * Owner's laws: no "click here for the event" buttons, and Continue always
 * advances (Enter / Space work too).
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  IntermissionDecisionPort, IntermissionReport, MatchIndex, MatchStats, PostgameReport, Side,
} from '../../../render2d/matchday'
import { HIGH_DANGER_XG, periodName, rateMatch } from '../../../render2d/matchday'
import { Icons } from '../icons'
import { Icon } from '../primitives'
import {
  AssistantCard, PeriodTable, RatingPill, RatingsBoard, ScoringSummary, ShotMap, StarsList, StatBars, teamRows,
  type SideInks, type StatRow,
} from './MatchDayPanels'
import './matchday.css'

interface Abbrs { home: string; away: string }

function ScoreLine(props: { home: number; away: number; abbrs: Abbrs; inks: SideInks; userSide: Side }): JSX.Element {
  const team = (s: Side): JSX.Element => (
    <span className={`team ${props.userSide === s ? 'mine' : ''}`}>
      <span className="chip" style={{ background: props.inks[s] }} />
      {props.abbrs[s]}
      <span className="g">{props[s]}</span>
    </span>
  )
  return (
    <div className="md-score">
      {team('away')}
      <span className="dash">–</span>
      {team('home')}
    </div>
  )
}

/** Enter / Space = Continue, while the screen is up. */
function useContinueKeys(onContinue: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); onContinue() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onContinue])
}

function Card(props: { title: ReactNode; right?: ReactNode; children: ReactNode; style?: CSSProperties }): JSX.Element {
  return (
    <div className="md-card" style={props.style}>
      <div className="md-label"><span>{props.title}</span>{props.right}</div>
      {props.children}
    </div>
  )
}

/* ─────────────────────────── intermission ─────────────────────────── */

export function IntermissionScreen(props: {
  report: IntermissionReport
  abbrs: Abbrs
  inks: SideInks
  userSide: Side
  onContinue: () => void
  /**
   * Intermission decisions (lines, tactics, goalie, a word to the room). Only
   * rendered when a segmented sim supplies a LIVE port — never faked.
   */
  decisions?: IntermissionDecisionPort
}): JSX.Element {
  const r = props.report
  const [scope, setScope] = useState<'period' | 'game'>('period')
  useContinueKeys(props.onContinue)
  const st = scope === 'period' ? r.periodStats : r.gameStats
  const livePort = props.decisions?.live ? props.decisions : null
  return (
    <div className="md-overlay" role="dialog" aria-label={r.title}>
      <div className="md-sheet">
        <div className="md-head">
          <div>
            <div className="md-label">Intermission · {r.title}</div>
            <ScoreLine home={r.home} away={r.away} abbrs={props.abbrs} inks={props.inks} userSide={props.userSide} />
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>Next: {r.next}</div>
        </div>

        <div className="md-grid c3">
          <Card
            title={scope === 'period' ? `The ${periodName(r.period)}${r.period >= 4 ? '' : ' period'}` : 'Game so far'}
            right={
              <span className="md-seg">
                <button className={scope === 'period' ? 'on' : ''} onClick={() => setScope('period')}>Period</button>
                <button className={scope === 'game' ? 'on' : ''} onClick={() => setScope('game')}>Game</button>
              </span>
            }
          >
            <StatBars rows={teamRows(st.away, st.home)} inks={props.inks} />
            <div style={{ marginTop: 12 }}>
              <PeriodTable label="Shots" away={r.shotsByPeriod.away} home={r.shotsByPeriod.home} abbrs={props.abbrs} />
            </div>
          </Card>

          <Card title="Scoring summary">
            <ScoringSummary goals={r.goals} abbrs={props.abbrs} inks={props.inks} />
            {r.penalties.length > 0 && (
              <>
                <div className="md-per">Penalties this period</div>
                {r.penalties.map((p) => (
                  <div key={`${p.absT}-${p.playerId}`} className="md-goal" style={{ gridTemplateColumns: '44px 38px 1fr auto' }}>
                    <span className="clk">{p.clock}</span>
                    <span className="abbr" style={{ color: props.inks[p.side] }}>{props.abbrs[p.side]}</span>
                    <span className="who">{p.playerName} <span className="ast">{p.infraction}</span></span>
                    <span className="clk">{p.minutes} min</span>
                  </div>
                ))}
              </>
            )}
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <Card title="Three stars so far">
              <StarsList stars={r.stars} />
            </Card>
            <Card title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={14}><Icons.Interview /></Icon>Assistant coach</span>}>
              <AssistantCard read={r.assistant} />
            </Card>
          </div>
        </div>

        {/* Decisions plug in here once the watched game is simulated period by
            period (decisions.ts). Nothing is offered until then. */}
        {livePort && (
          <Card title="Your decisions">
            <div className="muted" style={{ fontSize: 12 }}>
              {livePort.slots(r.period).filter((s) => s.available).map((s) => s.label).join(' · ')}
            </div>
          </Card>
        )}

        <div className="md-foot">
          <span className="hint">Enter or Space to continue</span>
          <button className="btn btn-primary" onClick={props.onContinue} autoFocus>
            <Icon size={14}><Icons.Play /></Icon> Continue — {r.next}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── postgame ─────────────────────────── */

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const sv3 = (f: number): string => {
  const r = Math.round(Math.max(0, f) * 1000)
  return r >= 1000 ? '1.000' : `.${r.toString().padStart(3, '0')}`
}
const pm = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

function BoxTables(props: { report: PostgameReport; side: Side }): JSX.Element {
  const b = props.report.box[props.side]
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="md-box">
        <thead>
          <tr>
            <th>Skater</th><th>Pos</th><th>G</th><th>A</th><th>P</th><th>+/-</th><th>SOG</th><th>HIT</th><th>BLK</th><th>PIM</th><th>FOW</th><th>TOI</th><th>Rtg</th>
          </tr>
        </thead>
        <tbody>
          {b.skaters.map((s) => (
            <tr key={s.playerId}>
              <td className="nm">{s.name}</td>
              <td>{s.position}</td>
              <td>{s.goals}</td>
              <td>{s.assists}</td>
              <td style={{ fontWeight: 800 }}>{s.points}</td>
              <td>{pm(s.plusMinus)}</td>
              <td>{s.shots}</td>
              <td>{s.hits}</td>
              <td>{s.blocks}</td>
              <td>{s.penaltyMinutes}</td>
              <td>{s.faceoffs}</td>
              <td>{mmss(s.toi)}</td>
              <td><RatingPill rating={s.rating} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="md-box" style={{ marginTop: 10 }}>
        <thead>
          <tr><th>Goalie</th><th>SA</th><th>SV</th><th>GA</th><th>SV%</th><th>xGA</th><th>TOI</th><th>Rtg</th></tr>
        </thead>
        <tbody>
          {b.goalies.map((g) => (
            <tr key={g.playerId}>
              <td className="nm">{g.name}</td>
              <td>{g.shotsAgainst}</td>
              <td>{g.saves}</td>
              <td>{g.goalsAgainst}</td>
              <td>{g.shotsAgainst > 0 ? sv3(g.savePct) : '–'}</td>
              <td>{g.xga.toFixed(1)}</td>
              <td>{mmss(g.toi)}</td>
              <td><RatingPill rating={g.rating} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Where the shots came from, in numbers: attempts, chances, iron. */
function chanceRows(r: PostgameReport): StatRow[] {
  const count = (side: Side, f: (s: PostgameReport['shots'][number]) => boolean): number =>
    r.shots.filter((s) => s.side === side && f(s)).length
  const attempts = (side: Side): number => count(side, () => true)
  const hd = (side: Side): number => count(side, (s) => s.xg >= HIGH_DANGER_XG)
  const iron = (side: Side): number => count(side, (s) => s.result === 'post')
  const rows: StatRow[] = [
    { label: 'Shot attempts', away: attempts('away'), home: attempts('home') },
    { label: 'High-danger chances', away: hd('away'), home: hd('home') },
  ]
  if (iron('away') + iron('home') > 0) rows.push({ label: 'Hit the post', away: iron('away'), home: iron('home') })
  return rows
}

export function PostgameScreen(props: {
  report: PostgameReport
  abbrs: Abbrs
  inks: SideInks
  names: Record<string, string>
  playoff?: boolean
  onBack: () => void
  onStay: () => void
}): JSX.Element {
  const r = props.report
  const [boxSide, setBoxSide] = useState<Side>(r.userSide)
  useContinueKeys(props.onBack)
  const suffix = r.decidedBy === 'overtime' ? ' / OT' : r.decidedBy === 'shootout' ? ' / SO' : ''
  const tied = r.home === r.away
  const other: Side = r.userSide === 'home' ? 'away' : 'home'
  return (
    <div className="md-overlay" role="dialog" aria-label="Final">
      <div className="md-sheet">
        <div className="md-head">
          <div>
            <div className="md-label">{props.playoff ? 'Playoff final' : 'Final'}{suffix}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <ScoreLine home={r.home} away={r.away} abbrs={props.abbrs} inks={props.inks} userSide={r.userSide} />
              {!tied && (
                <span style={{
                  fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 999, letterSpacing: 0.6,
                  background: r.won ? 'rgba(52,211,153,0.15)' : 'rgba(244,63,94,0.15)',
                  color: r.won ? 'var(--green)' : 'var(--red)',
                }}>{r.won ? 'WIN' : 'LOSS'}</span>
              )}
              {tied && <span className="muted" style={{ fontSize: 12.5 }}>Level at the horn</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <PeriodTable label="Goals" away={r.goalsByPeriod.away} home={r.goalsByPeriod.home} abbrs={props.abbrs} shootout={r.shootout} />
            <PeriodTable label="Shots" away={r.shotsByPeriod.away} home={r.shotsByPeriod.home} abbrs={props.abbrs} />
          </div>
        </div>

        <div className="md-grid c3">
          <Card title="Three stars">
            <StarsList stars={r.stars} />
            {r.turningPoint && (
              <div style={{ marginTop: 12 }}>
                <div className="md-label" style={{ marginBottom: 4 }}>The turning point</div>
                <div className="md-tp">{r.turningPoint.text}</div>
              </div>
            )}
          </Card>
          <Card title="Team stats">
            <StatBars rows={teamRows(r.totals.away, r.totals.home)} inks={props.inks} />
          </Card>
          <Card title="Scoring summary">
            <ScoringSummary goals={r.goals} abbrs={props.abbrs} inks={props.inks} />
          </Card>
        </div>

        <div className="md-grid c2">
          <Card title="Shot map">
            <ShotMap shots={r.shots} userSide={r.userSide} inks={props.inks} names={props.names} abbrs={props.abbrs} />
            <div style={{ marginTop: 14 }}>
              <StatBars rows={chanceRows(r)} inks={props.inks} />
            </div>
          </Card>
          <Card title="Player ratings">
            <RatingsBoard ratings={r.ratings} userSide={r.userSide} abbrs={props.abbrs} maxDrivers={3} limit={10} />
          </Card>
        </div>

        <Card
          title="Box score"
          right={
            <span className="md-seg">
              {[r.userSide, other].map((s) => (
                <button key={s} className={boxSide === s ? 'on' : ''} onClick={() => setBoxSide(s)}>{props.abbrs[s]}</button>
              ))}
            </span>
          }
        >
          <BoxTables report={r} side={boxSide} />
        </Card>

        <div className="md-foot">
          <span className="hint">Enter to continue</span>
          <button className="btn btn-ghost" onClick={props.onStay}>Stay on the ice</button>
          <button className="btn btn-primary" onClick={props.onBack} autoFocus>Back to hub</button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── live side panel ─────────────────────────── */

export type SideTab = 'stats' | 'ratings' | 'feed'

export function LiveMatchPanel(props: {
  stats: MatchStats
  index: MatchIndex
  inks: SideInks
  tab: SideTab
  onTab: (t: SideTab) => void
  height: number
  feed: ReactNode
}): JSX.Element {
  const { stats, index } = props
  const abbrs = { home: index.homeAbbr, away: index.awayAbbr }
  const ratings = useMemo(() => (props.tab === 'ratings' ? rateMatch(stats) : []), [stats, props.tab])
  const goalies = stats.players.filter((l) => l.isGoalie && l.shotsAgainst > 0)
  return (
    <aside className="md-side" style={{ height: Math.max(260, props.height) }} aria-label="Match panel">
      <div className="md-side-tabs" role="tablist">
        {(['stats', 'ratings', 'feed'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={props.tab === t} className={props.tab === t ? 'on' : ''} onClick={() => props.onTab(t)}>
            {t === 'stats' ? 'Stats' : t === 'ratings' ? 'Ratings' : 'Feed'}
          </button>
        ))}
      </div>
      <div className="md-side-body">
        {props.tab === 'stats' && (
          <>
            <StatBars rows={teamRows(stats.away, stats.home, { compact: true })} inks={props.inks} />
            <div className="md-sub">Shot map</div>
            <ShotMap shots={stats.shots} userSide={index.userSide} inks={props.inks} names={index.names as Record<string, string>} abbrs={abbrs} compact />
            {goalies.length > 0 && (
              <>
                <div className="md-sub">In goal</div>
                {goalies.map((g) => (
                  <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                    <span><span style={{ color: props.inks[g.side], fontWeight: 800, marginRight: 6 }}>{abbrs[g.side]}</span>{g.name}</span>
                    <span className="md-num muted">{g.saves}/{g.shotsAgainst}</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
        {props.tab === 'ratings' && (
          <RatingsBoard ratings={ratings} userSide={index.userSide} abbrs={abbrs} maxDrivers={2} />
        )}
        {props.tab === 'feed' && props.feed}
      </div>
    </aside>
  )
}

/* ─────────────────────────── dead air ─────────────────────────── */

/**
 * The gap between two highlights (Key / Comprehensive / Extended): the clock
 * spins to the next moment while the screen shows where the game stands and
 * what the bench is saying (UX audit F-8).
 */
export function DeadAir(props: {
  clock: string
  mode: 'key' | 'comprehensive' | 'extended' | 'full'
  stats: MatchStats | null
  abbrs: Abbrs
  line: string | null
}): JSX.Element {
  const s = props.stats
  const fo = (w: number, n: number): string => (n > 0 ? `${Math.round((w / n) * 100)}%` : '–')
  return (
    <div className="md-ff">
      <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon size={14}><Icons.FastForward /></Icon>
        {props.mode === 'key' ? 'TO THE NEXT GOAL' : 'TO THE NEXT HIGHLIGHT'}
      </div>
      <div className="clk">{props.clock}</div>
      {s && (
        <div className="strip">
          <div><b>{props.abbrs.away} {s.away.goals}–{s.home.goals} {props.abbrs.home}</b><span>Score</span></div>
          <div><b>{s.away.shots}–{s.home.shots}</b><span>Shots on goal</span></div>
          <div><b>{s.away.hits}–{s.home.hits}</b><span>Hits</span></div>
          <div><b>{fo(s.away.faceoffWins, s.away.faceoffs)}–{fo(s.home.faceoffWins, s.home.faceoffs)}</b><span>Faceoffs</span></div>
          <div><b>{s.away.powerPlayGoals}/{s.away.powerPlays} · {s.home.powerPlayGoals}/{s.home.powerPlays}</b><span>Power plays</span></div>
        </div>
      )}
      {props.line && (
        <div className="quote">
          <span className="who">Assistant coach</span>
          {props.line}
        </div>
      )}
    </div>
  )
}
