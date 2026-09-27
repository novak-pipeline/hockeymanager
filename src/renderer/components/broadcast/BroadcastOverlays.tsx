/**
 * BROADCAST OVERLAYS — the TV graphics package, drawn in HTML/CSS over the match
 * canvas so the same graphics sit over the 2D rink and the 3D arena.
 *
 * Each graphic is a small pure component fed by the director's OverlayCue data
 * + the BroadcastContext. <BroadcastOverlayLayer> mounts whichever cues are live
 * and animates them in/out (framer-motion; App's MotionConfig honours
 * prefers-reduced-motion). Layout never jitters: fixed-width scorebug cells,
 * tabular numerals, and the on-ice tag moves by transform only, smoothed and
 * clamped to the frame.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { BroadcastContext, BroadcastPlayer } from '@engine/story/broadcastStorylines'
import type { BroadcastProjector, OverlayCue, PeriodDetail } from '../../../render2d/broadcast/types'
import type { PowerPlayWindow } from '../../../render2d/broadcast/director'
import type { MatchView } from '@render2d'
import { getFace } from '../../lib/mods'
import { CrestView } from '../Crest'
import './broadcast.css'

/* ─────────────────────────── helpers ─────────────────────────── */

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

function luminance(c: number): number {
  return (0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff)) / 255
}
/** A team colour that reads on a dark panel (swap to secondary if too dark/light). */
function teamInk(colors: { primary: number; secondary: number }): { main: string; alt: string } {
  const p = colors.primary
  const s = colors.secondary
  const pOk = luminance(p) > 0.08 && luminance(p) < 0.85
  const main = pOk ? p : s
  const alt = main === p ? s : p
  return { main: hex(main), alt: hex(luminance(alt) > 0.85 ? 0x2a3550 : alt) }
}

function split(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] ?? name }
}

function initialLast(name: string): string {
  const { first, last } = split(name)
  return first ? `${first[0]}. ${last}` : last
}

const posLabel = (p: string): string => (p === 'LW' || p === 'RW' ? p : p)

/* ─────────────────────────── face cut-out ─────────────────────────── */

const faceCache = new Map<string, string | null>()

/** Facepack cut-out when the mod has one; a clean silhouette otherwise. Never a
 *  broken image. */
export function FaceCutout(props: { player: BroadcastPlayer | undefined; color: string; className?: string; style?: CSSProperties }): JSX.Element {
  const { player } = props
  const faceId = player?.faceId
  const [url, setUrl] = useState<string | null>(faceId ? faceCache.get(faceId) ?? null : null)
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    if (!faceId || faceCache.has(faceId)) return
    let live = true
    void getFace(faceId).then((u) => {
      faceCache.set(faceId, u)
      if (live) setUrl(u)
    })
    return () => { live = false }
  }, [faceId])
  const initials = player ? player.name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() : ''
  return (
    <div className={`bc-face ${props.className ?? ''}`} style={props.style}>
      {url && !broken ? (
        <img src={url} alt="" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <svg viewBox="0 0 100 106" aria-hidden>
          <defs>
            <linearGradient id="bcsil" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#5b6680" />
              <stop offset="1" stopColor="#2b3346" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="38" r="22" fill="url(#bcsil)" />
          <path d="M8 106c2-26 20-40 42-40s40 14 42 40z" fill="url(#bcsil)" />
          <path d="M8 106c2-26 20-40 42-40s40 14 42 40z" fill={props.color} opacity="0.35" />
          <text x="50" y="96" textAnchor="middle" fontSize="18" fontWeight="800" fill="#fff" opacity="0.85">{initials}</text>
        </svg>
      )}
    </div>
  )
}

/* ─────────────────────────── scorebug ─────────────────────────── */

export function Scorebug(props: {
  ctx: BroadcastContext
  view: MatchView | null
  pp: PowerPlayWindow | null
  ppRemaining: string | null
  /** An instant replay is on screen: tag it (the caller holds the live score/clock). */
  replay?: boolean
}): JSX.Element {
  const { ctx, view } = props
  const per = view ? (view.period > 3 ? 'OT' : `${view.period}${['ST', 'ND', 'RD'][view.period - 1] ?? 'TH'}`) : '1ST'
  const away = teamInk(ctx.awayColors)
  const home = teamInk(ctx.homeColors)
  return (
    <div className="bc-scorebug bc-num">
      <div className="team" style={{ '--bc-team': away.main } as CSSProperties}>
        <span className="chip" />
        <span className="abbr">{ctx.awayAbbr}</span>
        <span className="score">{view?.awayScore ?? 0}</span>
      </div>
      <div className="team" style={{ '--bc-team': home.main } as CSSProperties}>
        <span className="chip" />
        <span className="abbr">{ctx.homeAbbr}</span>
        <span className="score">{view?.homeScore ?? 0}</span>
      </div>
      <div className="clock">
        <span className="per">{per}</span>
        <span>{view?.clock ?? '20:00'}</span>
      </div>
      {props.pp && (
        <div className="pp">PP {props.pp.side === 'home' ? ctx.homeAbbr : ctx.awayAbbr} {props.ppRemaining ?? ''}</div>
      )}
      {props.replay && <div className="replay">REPLAY</div>}
    </div>
  )
}

/* ─────────────────────────── graphics ─────────────────────────── */

type Colors = { main: string; alt: string }

function colorsFor(ctx: BroadcastContext, side: 'home' | 'away'): Colors {
  return teamInk(side === 'home' ? ctx.homeColors : ctx.awayColors)
}

export function ArenaTitle({ ctx }: { ctx: BroadcastContext }): JSX.Element {
  const a = colorsFor(ctx, 'away')
  const h = colorsFor(ctx, 'home')
  return (
    <div className="bc-full" style={{ '--bc-away': a.main, '--bc-home': h.main } as CSSProperties}>
      <div className="bc-title">
        <div className="kicker">{ctx.playoff ? 'PLAYOFF HOCKEY · TONIGHT' : 'TONIGHT'}</div>
        {ctx.arenaName && <div className="arena bc-caps">{ctx.arenaName}</div>}
        <div className="matchup">
          <div className="side">
            <CrestView teamId={ctx.awayTeamId} abbr={ctx.awayAbbr} colors={ctx.awayColors} className="bc-crest" style={{ width: 84, height: 84, fontSize: 24 }} />
            <div className="nm">{ctx.awayName}</div>
            <div className="rec bc-num">{ctx.away.record}</div>
          </div>
          <div className="at">@</div>
          <div className="side">
            <CrestView teamId={ctx.homeTeamId} abbr={ctx.homeAbbr} colors={ctx.homeColors} className="bc-crest" style={{ width: 84, height: 84, fontSize: 24 }} />
            <div className="nm">{ctx.homeName}</div>
            <div className="rec bc-num">{ctx.home.record}</div>
          </div>
        </div>
        <div className="bar" />
      </div>
    </div>
  )
}

export function StoryCard(props: { ctx: BroadcastContext; title: string; detail: string; playerId?: string; side: 'home' | 'away' }): JSX.Element {
  const c = colorsFor(props.ctx, props.side)
  const p = props.playerId ? props.ctx.players[props.playerId] : undefined
  return (
    <div className="bc-card bc-texture" style={{ '--bc-team': c.main } as CSSProperties}>
      {p && <FaceCutout player={p} color={c.main} className="face" />}
      <div className="txt">
        <div className="k">{props.title}</div>
        <div className="d">{props.detail}</div>
      </div>
    </div>
  )
}

export function StartingLineup({ ctx, side }: { ctx: BroadcastContext; side: 'home' | 'away' }): JSX.Element {
  const c = colorsFor(ctx, side)
  const lu = side === 'home' ? ctx.home : ctx.away
  const order = ['C', 'LW', 'RW', 'D', 'D', 'G']
  return (
    <div className="bc-full">
      <div className="bc-lineup bc-texture" style={{ '--bc-team': c.main } as CSSProperties}>
        <div className="hd">
          <CrestView teamId={side === 'home' ? ctx.homeTeamId : ctx.awayTeamId} abbr={side === 'home' ? ctx.homeAbbr : ctx.awayAbbr}
            colors={side === 'home' ? ctx.homeColors : ctx.awayColors} className="bc-crest" style={{ width: 38, height: 38, fontSize: 11 }} />
          <div>
            <div className="t">STARTING LINEUP</div>
            <div className="n">{side === 'home' ? ctx.homeName : ctx.awayName}</div>
          </div>
        </div>
        <div className="row">
          {lu.starters.map((id, i) => {
            const p = ctx.players[id]
            if (!p) return null
            return (
              <div className="pl" key={id}>
                <FaceCutout player={p} color={c.main} className="face" />
                <div className="pos">{p.position === 'G' ? 'G' : order[i] ?? p.position}{p.jerseyNumber !== undefined ? ` · #${p.jerseyNumber}` : ''}</div>
                <div className="ln bc-caps">{split(p.name).last}</div>
                <div className="sl bc-num">{p.seasonLine}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function GoalieTape({ ctx }: { ctx: BroadcastContext }): JSX.Element {
  const g = (side: 'home' | 'away'): JSX.Element => {
    const id = side === 'home' ? ctx.home.goalieId : ctx.away.goalieId
    const p = id ? ctx.players[id] : undefined
    const c = colorsFor(ctx, side)
    return (
      <div className="g">
        <FaceCutout player={p} color={c.main} className="face" />
        <div className="nm bc-caps">{p ? split(p.name).last : '—'}</div>
        <div className="stat bc-num">{p?.seasonLine ?? ''}</div>
      </div>
    )
  }
  return (
    <div className="bc-full">
      <div className="bc-tape bc-texture">
        {g('away')}
        <div className="mid">IN GOAL<br />TONIGHT</div>
        {g('home')}
      </div>
    </div>
  )
}

export function GoalLowerThird(props: { ctx: BroadcastContext; cue: Extract<OverlayCue['data'], { kind: 'lowerThird' }> }): JSX.Element {
  const { ctx } = props
  const goal = props.cue.goal
  const p = ctx.players[goal.scorerId]
  const c = colorsFor(ctx, goal.side)
  const { first, last } = split(p?.name ?? '')
  const assists = goal.assistIds.map((a) => initialLast(ctx.players[a]?.name ?? a).toUpperCase()).join(', ')
  const tag = goal.strength === 'pp' ? 'PPG' : goal.strength === 'sh' ? 'SHG' : goal.strength === 'en' ? 'EN' : goal.goalsTonight === 3 ? 'HAT TRICK' : null
  const per = goal.period > 3 ? 'OT' : `${goal.period}${['ST', 'ND', 'RD'][goal.period - 1] ?? 'TH'}`
  return (
    <div className="bc-lt" style={{ '--bc-team': c.main } as CSSProperties}>
      <div className="panel bc-texture" />
      <FaceCutout player={p} color={c.main} className="face" />
      <CrestView teamId={goal.side === 'home' ? ctx.homeTeamId : ctx.awayTeamId} abbr={goal.side === 'home' ? ctx.homeAbbr : ctx.awayAbbr}
        colors={goal.side === 'home' ? ctx.homeColors : ctx.awayColors} className="crest bc-crest" />
      <div className="body">
        <div className="numpos bc-num">
          <span className="n">{p?.jerseyNumber ?? '—'}</span>
          <span className="p">{posLabel(p?.position ?? '')}</span>
        </div>
        <div className="who">
          <div className="name bc-caps">
            {first && <span className="first">{first}</span>}
            <span className="last">{last}</span>
          </div>
          <div className="rule" />
          <div className="facts">
            <div className="fact"><div className="k">GOAL</div><div className="v bc-num">{goal.elapsed} {per}</div></div>
            <div className="fact"><div className="k">{goal.assistIds.length > 1 ? 'ASSISTS' : 'ASSIST'}</div><div className="v">{assists || 'UNASSISTED'}</div></div>
          </div>
        </div>
        {tag && <div className="tag">{tag}</div>}
      </div>
    </div>
  )
}

export function MilestoneCard(props: { ctx: BroadcastContext; playerId: string; title: string; detail: string }): JSX.Element {
  const p = props.ctx.players[props.playerId]
  const c = colorsFor(props.ctx, p?.side ?? 'home')
  return (
    <div className="bc-milestone">
      <div className="top">MILESTONE</div>
      <div className="mid">
        <FaceCutout player={p} color={c.main} className="face" />
        <div className="big">{props.title}</div>
      </div>
      <div className="d">{props.detail}</div>
    </div>
  )
}

export function MomentCaption(props: { caption: string }): JSX.Element {
  return (
    <div className="bc-caption">
      <span className="dot">★</span>
      <span className="c">{props.caption}</span>
    </div>
  )
}

export function PeriodSummary({ ctx, s }: { ctx: BroadcastContext; s: PeriodDetail }): JSX.Element {
  const label = s.final ? 'FINAL' : `END OF ${s.period > 3 ? 'OT' : `${s.period}${['ST', 'ND', 'RD'][s.period - 1] ?? 'TH'} PERIOD`}`
  const goals = s.goals.map((g) => {
    const n = split(ctx.players[g.playerId]?.name ?? '').last.toUpperCase()
    const tag = g.strength === 'pp' ? ' (PP)' : g.strength === 'sh' ? ' (SH)' : g.strength === 'en' ? ' (EN)' : ''
    return `${g.side === 'home' ? ctx.homeAbbr : ctx.awayAbbr} · ${n}${tag} ${g.elapsed}`
  })
  return (
    <div className="bc-summary bc-texture">
      <div className="hd">{label}</div>
      <table className="bc-num">
        <tbody>
          <tr><td>{ctx.awayName}</td><td className="n">{s.away.goals}</td><td className="n" style={{ color: 'var(--bc-muted)' }}>{s.away.shots} SOG</td></tr>
          <tr><td>{ctx.homeName}</td><td className="n">{s.home.goals}</td><td className="n" style={{ color: 'var(--bc-muted)' }}>{s.home.shots} SOG</td></tr>
        </tbody>
      </table>
      {goals.length > 0 && <div className="goals">{goals.join('  ·  ')}</div>}
    </div>
  )
}

/* ─────────────────────────── on-ice tag ─────────────────────────── */

/**
 * World-anchored player tag. Position is read from the projector every frame
 * and eased (critically damped) toward the target, then clamped inside the
 * frame — smooth follow, no jitter, and it never leaves the picture.
 */
export function PlayerTag(props: {
  ctx: BroadcastContext
  cue: Extract<OverlayCue['data'], { kind: 'playerTag' }>
  projector: BroadcastProjector | null
  bounds: { w: number; h: number }
  /** Static position when no projector is available (screenshots, 3D pending). */
  fallback?: { x: number; y: number }
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const pos = useRef<{ x: number; y: number } | null>(null)
  const { ctx, cue, projector, bounds } = props
  const p = ctx.players[cue.playerId]
  const side = p?.side ?? 'home'
  const c = colorsFor(ctx, side)
  const big = cue.role === 'goal' || cue.role === 'save' || cue.role === 'milestone'
  useEffect(() => {
    let raf = 0
    const step = (): void => {
      const target = projector?.projectPlayer(cue.playerId) ?? props.fallback ?? null
      const el = ref.current
      if (target && el) {
        const cur = pos.current ?? target
        const k = pos.current ? 0.18 : 1
        const next = { x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k }
        pos.current = next
        const w = el.offsetWidth
        const h = el.offsetHeight
        const x = Math.max(6, Math.min(bounds.w - w - 6, next.x - w / 2))
        // Big tags ride above the player; assist chips sit just below theirs so a
        // goal-mouth scrum never stacks three graphics on one spot.
        const y = Math.max(6, Math.min(bounds.h - h - 6, big ? next.y - h - 18 : next.y + 16))
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
        el.style.opacity = '1'
      } else if (el && !target) {
        el.style.opacity = '0'
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [projector, cue.playerId, bounds.w, bounds.h, props.fallback, big])
  if (!p) return null
  const num = p.jerseyNumber !== undefined ? `${p.position === 'G' ? 'G' : p.position}#${p.jerseyNumber}` : p.position
  return (
    <div ref={ref} className={`bc-tag ${big ? '' : 'small'}`} style={{ opacity: 0, zIndex: big ? 3 : 1, '--bc-team': c.main, '--bc-team2': c.alt } as CSSProperties}>
      {big ? (
        <div className="inner">
          <FaceCutout player={p} color={c.main} className="face" />
          <div className="row1">
            <span className="goal">{cue.label}</span>
            {cue.stat && <span className="stat bc-num">{cue.stat}</span>}
          </div>
          <div className="row2">
            <span className="nm bc-caps">{initialLast(p.name)}</span>
            <span className="np bc-num">{num}</span>
          </div>
        </div>
      ) : (
        <span className="chip">{cue.label}</span>
      )}
    </div>
  )
}

/* ─────────────────────────── the layer ─────────────────────────── */

type Variant = { initial: Record<string, number>; animate: Record<string, number>; exit: Record<string, number> }
const enter: Variant = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 8 } }
const fade: Variant = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
const ease = { duration: 0.32, ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number] }

export function BroadcastOverlayLayer(props: {
  ctx: BroadcastContext
  live: OverlayCue[]
  projector: BroadcastProjector | null
  bounds: { w: number; h: number }
  tagFallback?: (playerId: string) => { x: number; y: number } | undefined
}): JSX.Element {
  const { ctx } = props
  return (
    <AnimatePresence>
      {props.live.map((cue) => {
        const d = cue.data
        let node: JSX.Element | null = null
        let variant: Variant = enter
        switch (d.kind) {
          case 'arenaTitle': node = <ArenaTitle ctx={ctx} />; variant = fade; break
          case 'storyCard': node = <StoryCard ctx={ctx} title={d.title} detail={d.detail} side={d.side} {...(d.playerId ? { playerId: d.playerId } : {})} />; break
          case 'startingLineup': node = <StartingLineup ctx={ctx} side={d.side} />; variant = fade; break
          case 'goalieTape': node = <GoalieTape ctx={ctx} />; variant = fade; break
          case 'lowerThird': node = <GoalLowerThird ctx={ctx} cue={d} />; break
          case 'milestone': node = <MilestoneCard ctx={ctx} playerId={d.playerId} title={d.title} detail={d.detail} />; break
          case 'momentCaption': node = <MomentCaption caption={d.caption} />; break
          case 'periodSummary': node = <PeriodSummary ctx={ctx} s={d.summary} />; break
          case 'playerTag': {
            const fb = props.tagFallback?.(d.playerId)
            node = <PlayerTag ctx={ctx} cue={d} projector={props.projector} bounds={props.bounds} {...(fb ? { fallback: fb } : {})} />
            variant = fade
            break
          }
          case 'powerPlay': node = null; break
        }
        if (!node) return null
        return (
          <motion.div key={cue.id} style={{ position: 'absolute', inset: 0, zIndex: d.kind === 'playerTag' && d.role !== 'assist1' && d.role !== 'assist2' ? 3 : 1 }} transition={ease} {...variant}>
            {node}
          </motion.div>
        )
      })}
    </AnimatePresence>
  )
}
