/**
 * SEASON WRAPPED — the once-a-year card sequence (docs/SEASON-WRAPPED.md).
 *
 * <WrappedPlayer> is the full-screen deck: one bold card at a time, team
 * colours, big numbers, faces and crests, story-style progress segments, and
 * click / swipe / arrow-key / space navigation. Pure presentational — it plays
 * whatever WrappedYear it is handed (the pending event, a yearbook page, or the
 * dev preview), and respects prefers-reduced-motion (opacity only, no count-up).
 *
 * <WrappedHost> lives in the shell: it plays the pending year as an EVENT the
 * moment the engine builds it (the draft closing the league year), and plays
 * any past year the Yearbook asks for. Closing marks the pending year seen; it
 * never blocks the sim and never re-nags.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { motion, useReducedMotion, type PanInfo } from 'framer-motion'
import { create } from 'zustand'
import type { WrappedCard, WrappedPlayerChip, WrappedTeamChip, WrappedYear } from '../../worker/protocol'
import { useClient } from '../hooks/useSim'
import { useUiStore } from './store'
import { CrestView } from './Crest'
import { PlayerFace } from './PlayerFace'
import './wrapped.css'

/* ── open-a-year bus (Yearbook → host) ── */

interface WrappedUi {
  /** A past year the Yearbook asked to replay (null = none). */
  replayYear: number | null
  openYear: (year: number) => void
  close: () => void
}

export const useWrappedUi = create<WrappedUi>((set) => ({
  replayYear: null,
  openYear: (year) => set({ replayYear: year }),
  close: () => set({ replayYear: null }),
}))

/* ── colour helpers ── */

function hex(c: number): string {
  return `#${(c >>> 0).toString(16).padStart(6, '0').slice(-6)}`
}

function luminance(c: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255
  const f = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function lighten(c: number, k: number): number {
  const ch = (shift: number): number => {
    const v = (c >> shift) & 255
    return Math.round(v + (255 - v) * k)
  }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** The team's most vivid usable colour on a near-black card: a club whose
 *  primary is navy/black leads with its secondary instead. */
function accentOf(t: WrappedTeamChip | undefined): { a: string; b: string } {
  if (!t) return { a: '#8b5cf6', b: '#22d3ee' }
  const p = t.primary, s = t.secondary
  const pl = luminance(p), sl = luminance(s)
  // Navy/black/deep-maroon primaries vanish on a near-black card; lead with
  // the partner colour when it is the brighter, still-coloured one.
  const lead = pl < 0.07 && sl > pl && sl < 0.8 ? s : p
  const other = lead === p ? s : p
  // Still too deep to glow (navy on black): lift it toward white a little.
  const lit = luminance(lead) < 0.06 ? lighten(lead, 0.28) : lead
  // A white/near-white partner reads as a glare; reuse the lead instead.
  return { a: hex(lit), b: luminance(other) > 0.8 ? hex(lit) : hex(other) }
}

/* ── count-up for the hero number ── */

function useCountUp(target: string, enabled: boolean): string {
  // Pure counts only ("67", "+28", "20%"): a record or a season label stays put.
  const m = /^([+−-]?)(\d{1,4})(%?)$/.exec(target)
  const [shown, setShown] = useState(enabled && m ? `${m[1]}0${m[3]}` : target)
  useEffect(() => {
    if (!enabled || !m) { setShown(target); return }
    const end = Number(m[2])
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const k = Math.min(1, (now - t0) / 900)
      const eased = 1 - (1 - k) ** 3
      setShown(`${m[1]}${Math.round(end * eased)}${m[3]}`)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, enabled])
  return shown
}

/* ── one card ── */

function Stag(props: {
  i: number
  s: (i: number) => { className: string; style: CSSProperties }
  className?: string
  children: ReactNode
}): JSX.Element {
  const st = props.s(props.i)
  return <div className={`${props.className ?? ''} ${st.className}`} style={st.style}>{props.children}</div>
}

function Faces(props: { players: WrappedPlayerChip[]; team?: WrappedTeamChip | undefined; versus?: WrappedTeamChip | undefined; size: number }): JSX.Element | null {
  // Each avatar in its own club's colour when the card knows it.
  const colorOf = (p: WrappedPlayerChip): number | undefined =>
    p.teamId && props.versus && p.teamId === props.versus.id ? props.versus.primary : props.team?.primary
  if (props.players.length === 0) return null
  return (
    <div className="wr-faces">
      {props.players.slice(0, 3).map((p, i) => (
        <div key={p.id} className="wr-face" style={{ zIndex: 3 - i, marginLeft: i === 0 ? 0 : -props.size * 0.28 }}>
          <PlayerFace faceId={p.faceId} name={p.name} teamColor={colorOf(p)} size={i === 0 ? props.size : Math.round(props.size * 0.72)} />
        </div>
      ))}
    </div>
  )
}

function CardFace(props: { card: WrappedCard; year: WrappedYear; index: number; total: number; reduced: boolean; dir: number }): JSX.Element {
  const { card, reduced } = props
  const team = card.team ?? props.year.userTeam
  const { a, b } = accentOf(team)
  const hero = useCountUp(card.hero?.value ?? '', !reduced && !!card.hero)
  const isCover = card.kind === 'cover'
  const isOutro = card.kind === 'outro'
  // Entrances are CSS keyframes (wrapped.css), not framer initial/animate: a
  // first-mount framer animation can stall under StrictMode's double mount and
  // leave the card invisible. CSS also honours prefers-reduced-motion itself.
  const stagger = (i: number): { className: string; style: CSSProperties } =>
    ({ className: 'wr-in', style: { animationDelay: `${reduced ? 0.04 * i : 0.12 + 0.08 * i}s` } })
  const heroLong = (card.hero?.value.length ?? 0) > 6
  return (
    <div
      className={`wr-card wr-${card.section} wr-kind-${card.kind} ${props.dir < 0 ? 'wr-enter-l' : 'wr-enter-r'}`}
      style={{ ['--wr-a' as string]: a, ['--wr-b' as string]: b }}
    >
      <div className="wr-bg" aria-hidden />
      <div className="wr-watermark" aria-hidden>{isOutro ? props.year.seasonLabel : team.abbr}</div>
      <div className="wr-inner">
        <Stag i={0} s={stagger} className="wr-top">
          <span className="wr-kicker">{card.kicker}</span>
          <span className="wr-count">{props.index + 1} / {props.total}</span>
        </Stag>

        <div className="wr-chips">
          {(card.team || card.versus) && (
            <Stag i={1} s={stagger} className="wr-crests">
              {card.team && <CrestView teamId={card.team.id} abbr={card.team.abbr} colors={{ primary: card.team.primary, secondary: card.team.secondary }} className="wr-crest" />}
              {card.versus && <span className="wr-vs">vs</span>}
              {card.versus && <CrestView teamId={card.versus.id} abbr={card.versus.abbr} colors={{ primary: card.versus.primary, secondary: card.versus.secondary }} className="wr-crest wr-crest-sm" />}
            </Stag>
          )}
          {card.players && card.players.length > 0 && (
            <Stag i={1} s={stagger}>
              <Faces players={card.players} team={team} versus={card.versus} size={isCover ? 88 : 104} />
            </Stag>
          )}
        </div>

        {card.hero && (
          <Stag i={2} s={stagger} className={`wr-hero ${heroLong ? 'wr-hero-long' : ''}`}>
            <div className="wr-hero-value">{hero}</div>
            <div className="wr-hero-label">{card.hero.label}</div>
          </Stag>
        )}

        <h2 className={`wr-headline ${stagger(3).className}`} style={stagger(3).style}>{card.headline}</h2>
        {card.body && <p className={`wr-body ${stagger(4).className}`} style={stagger(4).style}>{card.body}</p>}

        {card.stats && card.stats.length > 0 && (
          <Stag i={5} s={stagger} className="wr-stats">
            {card.stats.map((s, i) => (
              <div key={i} className="wr-stat">
                <div className="wr-stat-v">{s.value}</div>
                <div className="wr-stat-l">{s.label}</div>
              </div>
            ))}
          </Stag>
        )}

        {card.list && card.list.length > 0 && (
          <ol className={`wr-list ${stagger(6).className}`} style={stagger(6).style}>
            {card.list.map((r, i) => (
              <li key={i}>
                <span className="wr-list-l">{r.label}</span>
                <span className="wr-list-v">{r.value}</span>
                {r.sub && <span className="wr-list-s">{r.sub}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="wr-brand" aria-hidden>THE SHOW · SEASON WRAPPED</div>
    </div>
  )
}

/* ── the deck ── */

export function WrappedPlayer(props: {
  year: WrappedYear
  onClose: () => void
  /** Shown on the last card (e.g. "Open the yearbook"). */
  onOutroAction?: (() => void) | undefined
  outroActionLabel?: string | undefined
  /** Open on a given card (yearbook deep-link / dev preview). */
  startIndex?: number | undefined
}): JSX.Element {
  const { year } = props
  const reduced = useReducedMotion() ?? false
  const [idx, setIdx] = useState(() => Math.max(0, Math.min(year.cards.length - 1, props.startIndex ?? 0)))
  const [dir, setDir] = useState(1)
  const total = year.cards.length
  const card = year.cards[Math.min(idx, total - 1)]!
  const idxRef = useRef(idx)
  idxRef.current = idx
  const go = useCallback((d: number) => {
    const n = idxRef.current + d
    if (n >= total) { props.onClose(); return }
    if (n < 0) return
    setDir(d)
    setIdx(n)
  }, [total, props])

  // Keys: capture phase on window, so the shell's Space-to-continue never
  // sees a key meant for the deck.
  const goRef = useRef(go)
  goRef.current = go
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.code === 'Space' || e.key === 'Enter') goRef.current(1)
      else if (e.key === 'ArrowLeft') goRef.current(-1)
      else if (e.key === 'Escape') closeRef.current()
      else return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // A swipe also ends in a click; the click must not advance a second time.
  const draggedRef = useRef(false)
  const onDragEnd = (_: unknown, info: PanInfo): void => {
    draggedRef.current = true
    setTimeout(() => { draggedRef.current = false }, 0)
    if (info.offset.x < -60 || info.velocity.x < -400) go(1)
    else if (info.offset.x > 60 || info.velocity.x > 400) go(-1)
  }

  const { a } = accentOf(card.team ?? year.userTeam)

  return (
    <div className="wr-overlay" role="dialog" aria-modal="true" aria-label={`Season Wrapped ${year.seasonLabel}`}
      style={{ ['--wr-a' as string]: a }}>
      <div className="wr-backdrop" aria-hidden />
      <div className="wr-progress" aria-hidden>
        {year.cards.map((c, i) => (
          <span key={c.id} className={`wr-seg ${i < idx ? 'done' : i === idx ? 'on' : ''}`} />
        ))}
      </div>
      <button className="wr-close" onClick={props.onClose} aria-label="Close Season Wrapped" title="Close (Esc)">
        <span aria-hidden className="wr-x" />
      </button>

      <div className="wr-stage">
        <button className="wr-nav wr-prev" onClick={() => go(-1)} disabled={idx === 0} aria-label="Previous card">
          <span aria-hidden className="wr-chev wr-chev-l" />
        </button>
        <div className="wr-deck">
          {/* No AnimatePresence/exit: under StrictMode (React + framer-motion 12)
            * an exit can fail to complete and strand the old card on the glass
            * (see the SHIP-BLOCKER note in App.tsx). The key swap unmounts the old
            * card at once; the new one makes the entrance. */}
          <motion.div
              key={card.id}
              className="wr-slot"
              drag={reduced ? false : 'x'}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.18}
              onDragEnd={onDragEnd}
              onClick={(e) => {
                if (draggedRef.current) return
                // Tap the left third to go back, anywhere else to go on.
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                go(e.clientX - r.left < r.width / 3 ? -1 : 1)
              }}
            >
              <CardFace card={card} year={year} index={idx} total={total} reduced={reduced} dir={dir} />
            </motion.div>
        </div>
        <button className="wr-nav wr-next" onClick={() => go(1)} aria-label={idx === total - 1 ? 'Finish' : 'Next card'}>
          <span aria-hidden className="wr-chev wr-chev-r" />
        </button>
      </div>

      <div className="wr-foot">
        {idx === total - 1 && props.onOutroAction ? (
          <button className="wr-cta" onClick={props.onOutroAction}>{props.outroActionLabel ?? 'Open the yearbook'}</button>
        ) : (
          <span className="wr-hint">Click, swipe or press → to continue · Esc to close</span>
        )}
        <button className="wr-skip" onClick={props.onClose}>{idx === total - 1 ? 'Done' : 'Skip'}</button>
      </div>
    </div>
  )
}

/* ── shell host: the pending event + yearbook replays ── */

export function WrappedHost(props: { suppressed?: boolean; onOpenYearbook?: () => void }): JSX.Element | null {
  const client = useClient()
  const version = useUiStore((s) => s.version)
  const replayYear = useWrappedUi((s) => s.replayYear)
  const closeReplay = useWrappedUi((s) => s.close)
  const [pending, setPending] = useState<WrappedYear | null>(null)
  const [replay, setReplay] = useState<WrappedYear | null>(null)
  // A pending year dismissed this session is not re-shown even if the
  // markSeen round-trip races a refresh.
  const dismissed = useRef(new Set<number>())

  useEffect(() => {
    let live = true
    void client.getWrapped().then((r) => {
      if (!live || r.type !== 'wrapped') return
      setPending(r.wrapped && !dismissed.current.has(r.wrapped.year) ? r.wrapped : null)
    }).catch(() => { /* non-fatal: no event */ })
    return () => { live = false }
  }, [client, version])

  useEffect(() => {
    if (replayYear === null) { setReplay(null); return }
    let live = true
    void client.getWrapped(replayYear).then((r) => {
      if (live && r.type === 'wrapped') setReplay(r.wrapped)
    }).catch(() => { /* ignore */ })
    return () => { live = false }
  }, [client, replayYear])

  const closePending = useCallback(() => {
    if (!pending) return
    dismissed.current.add(pending.year)
    void client.markWrappedSeen(pending.year).catch(() => { /* ignore */ })
    setPending(null)
  }, [client, pending])

  const showing = useMemo(() => replay ?? (props.suppressed ? null : pending), [replay, pending, props.suppressed])
  if (!showing) return null
  const isReplay = showing === replay
  return (
    <WrappedPlayer
      key={`${showing.year}-${isReplay ? 'r' : 'p'}`}
      year={showing}
      onClose={isReplay ? closeReplay : closePending}
      {...(!isReplay && props.onOpenYearbook ? {
        onOutroAction: () => { closePending(); props.onOpenYearbook?.() },
        outroActionLabel: 'Open the yearbook',
      } : {})}
    />
  )
}
