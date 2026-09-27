/**
 * Match-day building blocks shared by the intermission, the postgame and the
 * live side panel: team stat bars, the shot map, player ratings, the scoring
 * summary, three stars and the assistant's read.
 *
 * Presentation only — every number comes from render2d/matchday (the stream
 * fold), never computed here.
 */
import { useState } from 'react'
import type {
  AssistantRead, GoalSummary, PlayerRating, ShotPoint, Side, StarView, TeamStats,
} from '../../../render2d/matchday'
import { formatDelta, periodName } from '../../../render2d/matchday'
import { Icons } from '../icons'
import { Icon } from '../primitives'
import './matchday.css'

/* ─────────────────────────── colours ─────────────────────────── */

export interface SideInks {
  home: string
  away: string
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`
function lum(c: number): number {
  return (0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff)) / 255
}

/**
 * The ice's own convention: the away side wears white, the home side its
 * colour. On a dark panel the home ink must still read, so a colour that is
 * too dark (navy) or too light (it would look like the away white) falls back
 * to the secondary, then to the app accent.
 */
export function sideInks(homeColors: { primary: number; secondary: number }): SideInks {
  const ok = (c: number): boolean => lum(c) > 0.16 && lum(c) < 0.78
  const home = ok(homeColors.primary) ? hex(homeColors.primary) : ok(homeColors.secondary) ? hex(homeColors.secondary) : '#8b5cf6'
  return { home, away: '#dfe4ec' }
}

/* ─────────────────────────── stat bars ─────────────────────────── */

export interface StatRow {
  label: string
  away: number
  home: number
  /** Printed values (default: the numbers). */
  awayText?: string
  homeText?: string
  /** Lower is better (giveaways, PIM) — flips which side reads as "leading". */
  lowerIsBetter?: boolean
}

export function StatBars({ rows, inks }: { rows: StatRow[]; inks: SideInks }): JSX.Element {
  return (
    <div className="md-bars">
      {rows.map((r) => {
        const tot = r.away + r.home
        const a = tot > 0 ? r.away / tot : 0.5
        const better = r.lowerIsBetter ? r.away < r.home : r.away > r.home
        const worse = r.lowerIsBetter ? r.away > r.home : r.away < r.home
        return (
          <div className="md-bar-row" key={r.label}>
            <span className={`v l ${better ? 'lead' : worse ? 'trail' : ''}`}>{r.awayText ?? r.away}</span>
            <div className="md-bar-mid">
              <span className="lab">{r.label}</span>
              <div className="md-bar-track">
                <span style={{ flexGrow: Math.max(0.001, a), background: inks.away }} />
                <span style={{ flexGrow: Math.max(0.001, 1 - a), background: inks.home }} />
              </div>
            </div>
            <span className={`v r ${worse ? 'lead' : better ? 'trail' : ''}`}>{r.homeText ?? r.home}</span>
          </div>
        )
      })}
    </div>
  )
}

const pctText = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '–')

/** The standard team comparison rows, away first (matching the scorebug). */
export function teamRows(away: TeamStats, home: TeamStats, opts: { compact?: boolean } = {}): StatRow[] {
  const rows: StatRow[] = [
    { label: 'Shots on goal', away: away.shots, home: home.shots },
    { label: 'Expected goals', away: away.xg, home: home.xg, awayText: away.xg.toFixed(1), homeText: home.xg.toFixed(1) },
    { label: 'Hits', away: away.hits, home: home.hits },
    {
      label: 'Faceoffs', away: away.faceoffWins, home: home.faceoffWins,
      awayText: pctText(away.faceoffWins, away.faceoffs), homeText: pctText(home.faceoffWins, home.faceoffs),
    },
    {
      label: 'Power play', away: away.powerPlayGoals, home: home.powerPlayGoals,
      awayText: `${away.powerPlayGoals}/${away.powerPlays}`, homeText: `${home.powerPlayGoals}/${home.powerPlays}`,
    },
  ]
  if (!opts.compact) {
    rows.push(
      { label: 'Blocked shots', away: away.blocks, home: home.blocks },
      { label: 'Takeaways', away: away.takeaways, home: home.takeaways },
      { label: 'Giveaways', away: away.giveaways, home: home.giveaways, lowerIsBetter: true },
      { label: 'Penalty minutes', away: away.penaltyMinutes, home: home.penaltyMinutes, lowerIsBetter: true },
    )
  } else {
    rows.push({ label: 'Blocked shots', away: away.blocks, home: home.blocks })
  }
  return rows
}

/* ─────────────────────────── shot map ─────────────────────────── */

/**
 * Where the shots came from. Each team is drawn attacking one fixed end (the
 * user's club attacks right), so a whole game — both ends swapped twice —
 * reads as two clean zones. Goals are the big ringed dots; a saved shot's dot
 * grows with the chance's expected-goal value; misses are hollow, posts amber,
 * blocked attempts faint squares.
 */
export function ShotMap(props: {
  shots: ShotPoint[]
  userSide: Side
  inks: SideInks
  names: Record<string, string>
  abbrs: { home: string; away: string }
  compact?: boolean
}): JSX.Element {
  const { shots, userSide, inks } = props
  const W = 200
  const H = 85
  const X = (x: number): number => (x + 1) * (W / 2)
  const Y = (y: number): number => (1 - y) * (H / 2)
  const desired = (s: Side): 1 | -1 => (s === userSide ? 1 : -1)
  const pts = shots.map((s) => {
    const flip = s.attackSign !== desired(s.side)
    return { s, x: X(flip ? -s.x : s.x), y: Y(flip ? -s.y : s.y) }
  })
  const order: Record<ShotPoint['result'], number> = { block: 0, miss: 1, post: 2, save: 3, goal: 4 }
  pts.sort((a, b) => order[a.s.result] - order[b.s.result])
  const other: Side = userSide === 'home' ? 'away' : 'home'
  return (
    <div>
      <svg className="md-shotmap" viewBox={`-2 -2 ${W + 4} ${H + 4}`} role="img" aria-label="Shot map">
        <rect className="ice" x={0} y={0} width={W} height={H} rx={28} ry={28} />
        <line className="red" x1={100} y1={0} x2={100} y2={H} />
        <line className="blue" x1={75} y1={0} x2={75} y2={H} />
        <line className="blue" x1={125} y1={0} x2={125} y2={H} />
        <line className="red" x1={11} y1={3.5} x2={11} y2={H - 3.5} />
        <line className="red" x1={189} y1={3.5} x2={189} y2={H - 3.5} />
        <circle className="mark" cx={100} cy={H / 2} r={15} />
        {[31, 169].map((cx) => [20.5, 64.5].map((cy) => <circle key={`${cx}-${cy}`} className="mark" cx={cx} cy={cy} r={15} />))}
        <path className="crease" d={`M 11 ${H / 2 - 4} A 6 6 0 0 1 11 ${H / 2 + 4} Z`} />
        <path className="crease" d={`M 189 ${H / 2 - 4} A 6 6 0 0 0 189 ${H / 2 + 4} Z`} />
        <rect x={8} y={H / 2 - 3} width={3} height={6} fill="none" stroke="#b4454f" strokeWidth={0.6} />
        <rect x={189} y={H / 2 - 3} width={3} height={6} fill="none" stroke="#b4454f" strokeWidth={0.6} />
        {pts.map(({ s, x, y }, i) => {
          const ink = inks[s.side]
          const who = props.names[s.shooter] ?? s.shooter
          const title = `${who} · ${periodName(s.period)} · ${s.result === 'goal' ? (s.emptyNet ? 'empty-net goal' : 'goal') : s.result === 'save' ? 'saved' : s.result === 'post' ? 'off the post' : s.result === 'miss' ? 'missed' : 'blocked'}${s.xg > 0 ? ` · ${s.xg.toFixed(2)} xG` : ''}`
          if (s.result === 'goal') {
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={3.4} fill={ink} stroke="#ffffff" strokeWidth={0.9}><title>{title}</title></circle>
              </g>
            )
          }
          if (s.result === 'save') {
            return <circle key={i} cx={x} cy={y} r={1.5 + Math.min(2, s.xg * 10)} fill={ink} fillOpacity={0.55}><title>{title}</title></circle>
          }
          if (s.result === 'block') {
            return <rect key={i} x={x - 1} y={y - 1} width={2} height={2} fill={ink} fillOpacity={0.3}><title>{title}</title></rect>
          }
          return (
            <circle key={i} cx={x} cy={y} r={1.6} fill="none" stroke={s.result === 'post' ? '#fbbf24' : ink} strokeOpacity={0.7} strokeWidth={0.6}>
              <title>{title}</title>
            </circle>
          )
        })}
      </svg>
      <div className="md-legend">
        <span><i style={{ background: inks[other] }} />{props.abbrs[other]} shooting left</span>
        <span><i style={{ background: inks[userSide] }} />{props.abbrs[userSide]} shooting right</span>
        {!props.compact && <span><i style={{ background: 'transparent', border: '1.5px solid #fff', width: 6, height: 6 }} />goal · dot size = chance quality</span>}
      </div>
    </div>
  )
}

/* ─────────────────────────── ratings ─────────────────────────── */

export function ratingClass(r: number): string {
  if (r >= 8) return 'r-top'
  if (r >= 7) return 'r-good'
  if (r >= 6) return 'r-avg'
  if (r >= 5) return 'r-poor'
  return 'r-bad'
}

export function RatingPill({ rating, title }: { rating: number; title?: string }): JSX.Element {
  return <span className={`md-rating ${ratingClass(rating)}`} title={title}>{rating.toFixed(1)}</span>
}

function Drivers({ r, max }: { r: PlayerRating; max: number }): JSX.Element {
  const ds = r.drivers.slice(0, max)
  if (ds.length === 0) return <span>quiet night so far</span>
  return (
    <>
      {ds.map((d, i) => (
        <span key={d.label}>
          {i > 0 && ' · '}
          <span className={d.delta >= 0 ? 'up' : 'down'}>{formatDelta(d.delta)}</span> {d.label}
        </span>
      ))}
    </>
  )
}

export function RatingsList(props: {
  ratings: PlayerRating[]
  side: Side
  maxDrivers?: number | undefined
  limit?: number | undefined
}): JSX.Element {
  const list = props.ratings.filter((r) => r.side === props.side)
  const shown = props.limit ? list.slice(0, props.limit) : list
  if (shown.length === 0) return <div className="muted" style={{ fontSize: 12 }}>No one rated yet.</div>
  return (
    <div>
      {shown.map((r) => (
        <div className="md-rrow" key={r.playerId}>
          <span className="nm">{r.name}<span className="pos">{r.position}</span></span>
          <RatingPill rating={r.rating} title={r.allDrivers.map((d) => `${formatDelta(d.delta)} ${d.label}`).join('\n')} />
          <span className="why"><Drivers r={r} max={props.maxDrivers ?? 3} /></span>
        </div>
      ))}
    </div>
  )
}

/** Ratings with a team switch, the user's club first. */
export function RatingsBoard(props: {
  ratings: PlayerRating[]
  userSide: Side
  abbrs: { home: string; away: string }
  maxDrivers?: number | undefined
  limit?: number | undefined
}): JSX.Element {
  const [side, setSide] = useState<Side>(props.userSide)
  const other: Side = props.userSide === 'home' ? 'away' : 'home'
  return (
    <div>
      <div className="md-seg" style={{ marginBottom: 6 }}>
        {[props.userSide, other].map((s) => (
          <button key={s} className={side === s ? 'on' : ''} onClick={() => setSide(s)}>{props.abbrs[s]}</button>
        ))}
      </div>
      <RatingsList ratings={props.ratings} side={side} maxDrivers={props.maxDrivers} limit={props.limit} />
    </div>
  )
}

/* ─────────────────────────── scoring summary ─────────────────────────── */

const STRENGTH: Record<string, string> = { pp: 'PPG', sh: 'SHG', en: 'ENG' }

export function ScoringSummary(props: { goals: GoalSummary[]; abbrs: { home: string; away: string }; inks: SideInks }): JSX.Element {
  if (props.goals.length === 0) return <div className="muted" style={{ fontSize: 12.5 }}>No scoring.</div>
  const byPeriod = new Map<number, GoalSummary[]>()
  for (const g of props.goals) {
    const list = byPeriod.get(g.period) ?? []
    list.push(g)
    byPeriod.set(g.period, list)
  }
  return (
    <div>
      {[...byPeriod.entries()].map(([p, list]) => (
        <div key={p}>
          <div className="md-per">{periodName(p)} period</div>
          {list.map((g) => g.shootout ? (
            <div className="md-goal" key={`so-${g.absT}`}>
              <span className="clk">SO</span>
              <span className="abbr" style={{ color: props.inks[g.side] }}>{props.abbrs[g.side]}</span>
              <span className="who"><span style={{ fontWeight: 700 }}>Wins the shootout</span></span>
              <span className="sc">{g.away}–{g.home}</span>
            </div>
          ) : (
            <div className="md-goal" key={`${g.absT}-${g.scorerId}`}>
              <span className="clk">{g.clock}</span>
              <span className="abbr" style={{ color: props.inks[g.side] }}>{props.abbrs[g.side]}</span>
              <span className="who">
                <span style={{ fontWeight: 700 }}>{g.scorerName}</span>
                {STRENGTH[g.strength] && <span className="st"> {STRENGTH[g.strength]}</span>}
                <br />
                <span className="ast">{g.assistNames.length > 0 ? `Assists: ${g.assistNames.join(', ')}` : 'Unassisted'}</span>
              </span>
              <span className="sc">{g.away}–{g.home}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ─────────────────────────── stars ─────────────────────────── */

export function StarsList({ stars }: { stars: StarView[] }): JSX.Element {
  if (stars.length === 0) return <div className="muted" style={{ fontSize: 12.5 }}>Too early to call.</div>
  return (
    <div>
      {stars.map((s, i) => (
        <div className="md-star" key={s.playerId}>
          <span className="n" aria-label={`Star ${i + 1}`}>
            {Array.from({ length: i + 1 }, (_, k) => <Icon key={k} size={14}><Icons.Star /></Icon>)}
          </span>
          <span className="who">{s.name} <span className="muted" style={{ fontWeight: 600, fontSize: 11.5 }}>{s.teamAbbr}</span></span>
          <RatingPill rating={s.rating} />
          <span className="line">{s.statLine}{s.drivers.length > 0 ? ` · ${s.drivers.slice(0, 2).join(', ')}` : ''}</span>
        </div>
      ))}
    </div>
  )
}

/* ─────────────────────────── assistant ─────────────────────────── */

export function AssistantCard({ read }: { read: AssistantRead }): JSX.Element {
  return (
    <div className="md-assist">
      <p><span className="k good">What's working</span>{read.working}</p>
      <p><span className="k bad">What isn't</span>{read.notWorking}</p>
      <p style={{ marginBottom: 0 }}><span className="k try">Try this</span>{read.suggestion}</p>
    </div>
  )
}

/** Shots per period, a compact table: 1 · 2 · 3 · (OT) · T. */
export function PeriodTable(props: {
  label: string
  away: number[]
  home: number[]
  abbrs: { home: string; away: string }
  /** A shootout column after the periods (it counts in the total). */
  shootout?: { home: number; away: number } | null | undefined
}): JSX.Element {
  const n = Math.max(props.away.length, props.home.length)
  const cols = Array.from({ length: n }, (_, i) => (i < 3 ? String(i + 1) : i === 3 ? 'OT' : `${i - 2}OT`))
  const so = props.shootout ?? null
  const sum = (a: number[], side: 'home' | 'away'): number => a.reduce((x, y) => x + y, 0) + (so ? so[side] : 0)
  return (
    <table className="md-box" style={{ width: 'auto' }}>
      <thead>
        <tr>
          <th>{props.label}</th>
          {cols.map((c) => <th key={c}>{c}</th>)}
          {so && <th>SO</th>}
          <th>T</th>
        </tr>
      </thead>
      <tbody>
        {(['away', 'home'] as const).map((s) => (
          <tr key={s}>
            <td className="nm">{props.abbrs[s]}</td>
            {cols.map((c, i) => <td key={c}>{props[s][i] ?? 0}</td>)}
            {so && <td>{so[s]}</td>}
            <td style={{ fontWeight: 800 }}>{sum(props[s], s)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
