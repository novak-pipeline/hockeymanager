/**
 * STORY OVERLAYS — the career's story on the watched game (liveStory.ts) and
 * the live game flow (gameFlow.ts), drawn over either renderer:
 *
 *  - StoryLowerThird: the TV graphic for a story beat (reuses the broadcast
 *    package's story card so it reads as the same network).
 *  - BenchCam: a bench-camera vignette from the GM's own bench.
 *  - FlowStrip: the compact momentum bar and live shot map.
 *  - BigChanceAlert: in the condensed modes, a chance the cut skipped, with a
 *    button to go and watch it.
 *
 * Read-only: nothing here changes the game.
 */
import type { CSSProperties } from 'react'
import type { BroadcastContext } from '@engine/story/broadcastStorylines'
import type { LiveBeat } from '@engine/story/liveStory'
import type { BigChance, FlowShot } from '../../lib/gameFlow'
import { FaceCutout, StoryCard, hex } from './BroadcastOverlays'
import './story.css'

function ink(c: { primary: number; secondary: number }): string {
  const lum = (v: number): number => (0.2126 * ((v >> 16) & 0xff) + 0.7152 * ((v >> 8) & 0xff) + 0.0722 * (v & 0xff)) / 255
  const ok = (v: number): boolean => lum(v) > 0.12 && lum(v) < 0.85
  return hex(ok(c.primary) ? c.primary : ok(c.secondary) ? c.secondary : 0x7aa2ff)
}

export function StoryLowerThird(props: { ctx: BroadcastContext; beat: LiveBeat }): JSX.Element {
  const { beat } = props
  return (
    <StoryCard ctx={props.ctx} title={beat.title} detail={beat.text} side={beat.side} {...(beat.playerId ? { playerId: beat.playerId } : {})} />
  )
}

export function BenchCam(props: { ctx: BroadcastContext; beat: LiveBeat }): JSX.Element {
  const { ctx, beat } = props
  const p = beat.playerId ? ctx.players[beat.playerId] : undefined
  const color = ink(beat.side === 'home' ? ctx.homeColors : ctx.awayColors)
  return (
    <div className="st-bench" style={{ '--st-team': color } as CSSProperties} role="status" aria-live="polite">
      <div className="tag"><i className="rec" aria-hidden /> BENCH CAM</div>
      <div className="body">
        {p && <FaceCutout player={p} color={color} className="face" />}
        <div className="txt">{beat.text}</div>
      </div>
    </div>
  )
}

/* ─────────────────────────── flow strip ─────────────────────────── */

const MAP_W = 200
const MAP_H = 85

function MiniRink(props: { shots: FlowShot[]; absT: number; homeInk: string; awayInk: string }): JSX.Element {
  const px = (x: number): number => MAP_W / 2 + x * (MAP_W / 2 - 4)
  const py = (y: number): number => MAP_H / 2 + y * (MAP_H / 2 - 4)
  return (
    <svg className="rink" viewBox={`0 0 ${MAP_W} ${MAP_H}`} width={MAP_W} height={MAP_H} aria-label="Shot map">
      <rect x={1} y={1} width={MAP_W - 2} height={MAP_H - 2} rx={20} className="boards" />
      <line x1={MAP_W / 2} x2={MAP_W / 2} y1={2} y2={MAP_H - 2} className="red" />
      <line x1={px(-0.25)} x2={px(-0.25)} y1={2} y2={MAP_H - 2} className="blue" />
      <line x1={px(0.25)} x2={px(0.25)} y1={2} y2={MAP_H - 2} className="blue" />
      <line x1={px(-0.89)} x2={px(-0.89)} y1={6} y2={MAP_H - 6} className="goal" />
      <line x1={px(0.89)} x2={px(0.89)} y1={6} y2={MAP_H - 6} className="goal" />
      {props.shots.map((s, i) => {
        const fresh = props.absT - s.absT < 150
        const c = s.side === 'home' ? props.homeInk : props.awayInk
        const cx = px(s.x)
        const cy = py(s.y)
        if (s.result === 'goal') {
          return <circle key={i} cx={cx} cy={cy} r={4.2} fill={c} stroke="#fff" strokeWidth={1.4} />
        }
        if (s.result === 'miss' || s.result === 'block') {
          return <circle key={i} cx={cx} cy={cy} r={1.9} fill="none" stroke={c} strokeWidth={1} opacity={fresh ? 0.8 : 0.3} />
        }
        return <circle key={i} cx={cx} cy={cy} r={1.6 + s.danger * 2.2} fill={c} opacity={fresh ? 0.95 : 0.4} />
      })}
    </svg>
  )
}

export function FlowStrip(props: {
  ctx: BroadcastContext
  momentum: number
  shots: FlowShot[]
  absT: number
  /** A big chance in the last few seconds (full mode flash). */
  flash: BigChance | null
}): JSX.Element {
  const { ctx } = props
  const homeInk = ink(ctx.homeColors)
  const awayInk = ink(ctx.awayColors)
  const m = Math.max(-1, Math.min(1, props.momentum))
  const lean = Math.abs(m) < 0.15 ? 'EVEN' : m > 0 ? ctx.homeAbbr : ctx.awayAbbr
  const count = (side: 'home' | 'away'): number => props.shots.filter((s) => s.side === side && (s.result === 'save' || s.result === 'goal')).length
  return (
    <div className="st-flow" aria-label="Game flow">
      <div className="hd">
        <span className="t">MOMENTUM</span>
        <span className="lean bc-num" style={{ color: lean === 'EVEN' ? undefined : m > 0 ? homeInk : awayInk }}>{lean}</span>
      </div>
      <div className="mbar">
        <span className="ab" style={{ color: awayInk }}>{ctx.awayAbbr}</span>
        <div className="track">
          <div className="fill away" style={{ width: `${Math.max(0, -m) * 50}%`, background: awayInk }} />
          <div className="fill home" style={{ width: `${Math.max(0, m) * 50}%`, background: homeInk }} />
          <i className="mid" />
        </div>
        <span className="ab" style={{ color: homeInk }}>{ctx.homeAbbr}</span>
      </div>
      <MiniRink shots={props.shots} absT={props.absT} homeInk={homeInk} awayInk={awayInk} />
      <div className="foot bc-num">
        <span style={{ color: awayInk }}>{count('away')} SOG</span>
        {props.flash ? <span className="flash">BIG CHANCE · {props.flash.label.toUpperCase()}</span> : <span className="muted">shots</span>}
        <span style={{ color: homeInk }}>{count('home')} SOG</span>
      </div>
    </div>
  )
}

/* ─────────────────────────── big-chance alert ─────────────────────────── */

/** The banner over a big chance the condensed cut would have skipped and the
 *  viewer is now watching (a setting, never a button: play just advances). */
export function BigChanceAlert(props: { ctx: BroadcastContext; chance: BigChance }): JSX.Element {
  const { ctx, chance } = props
  const p = ctx.players[chance.playerId]
  const abbr = chance.side === 'home' ? ctx.homeAbbr : ctx.awayAbbr
  const color = ink(chance.side === 'home' ? ctx.homeColors : ctx.awayColors)
  return (
    <div className="st-chance" style={{ '--st-team': color } as CSSProperties} role="status">
      <div className="k">BIG CHANCE</div>
      <div className="d">
        <b>{chance.label}</b> · {abbr}{p ? ` · ${p.name}` : ''}
      </div>
    </div>
  )
}
