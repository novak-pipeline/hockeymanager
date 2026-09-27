// Top-down 2D playback of a watched game for engine eye tests (no PixiJS, no
// worker): ?engine=agent|director &seed=3 &t=<seconds from puck drop> &play=1.
// Shows skaters (numbered by slot, D as squares), velocity ticks, the puck,
// the carrier ring, and a rolling event log — enough to judge the hockey.
import { generateLeague } from '@data/generate'
import type { FrameEvent, GameEvent, Player, PlayerId } from '@domain'
import { fullSimGame } from '@engine/full/fullSim'
import { agentSimGame } from '@engine/agent/agentSim'

const q = new URLSearchParams(location.search)
const seed = Number(q.get('seed') ?? 3)
const data = generateLeague({ seed })
const resolve = (id: PlayerId): Player => data.players.get(id)!
const home = data.teams.get(data.league.teams[0]!)!
const away = data.teams.get(data.league.teams[1]!)!
const sim = q.get('engine') === 'director' ? fullSimGame : agentSimGame
const t0 = performance.now()
const out = sim(home, away, resolve, { seed: seed * 7 })
const simMs = performance.now() - t0
const abs = (e: GameEvent): number => (e.period - 1) * 1200 + e.t
const frames = out.stream.filter((e): e is FrameEvent => e.type === 'frame')
const events = out.stream.filter((e) => e.type !== 'frame')
const dur = abs(frames[frames.length - 1]!)
const name = (id: string | null | undefined): string => (id ? (data.players.get(id as PlayerId)?.name.split(' ').pop() ?? id) : '-')
const pos = (id: string): string => data.players.get(id as PlayerId)?.position ?? '?'

const cv = document.getElementById('c') as HTMLCanvasElement
const g = cv.getContext('2d')!
const W = cv.width
const H = cv.height
const sx = (x: number): number => W / 2 + (x * W) / 2.06
const sy = (y: number): number => H / 2 - (y * H) / 2.1
let tNow = Number(q.get('t') ?? 0)
let playing = q.get('play') === '1'
let speed = 1

function frameAt(t: number): [FrameEvent, FrameEvent, number] {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1
    if (abs(frames[m]!) <= t) lo = m
    else hi = m - 1
  }
  const a = frames[lo]!
  const b = frames[Math.min(lo + 1, frames.length - 1)]!
  const span = abs(b) - abs(a)
  return [a, b, span > 0 && span < 1 ? (t - abs(a)) / span : 0]
}

function draw(): void {
  g.clearRect(0, 0, W, H)
  g.strokeStyle = '#c9ced6'
  g.lineWidth = 2
  g.beginPath()
  g.roundRect(sx(-1), sy(1), sx(1) - sx(-1), sy(-1) - sy(1), 70)
  g.stroke()
  for (const [x, c] of [[0, '#c8323c'], [-0.25, '#2f5fd0'], [0.25, '#2f5fd0'], [-0.89, '#c8323c'], [0.89, '#c8323c']] as const) {
    g.strokeStyle = c
    g.beginPath()
    g.moveTo(sx(x), sy(1))
    g.lineTo(sx(x), sy(-1))
    g.stroke()
  }
  for (const [x, y] of [[-0.6, 0.55], [-0.6, -0.55], [0.6, 0.55], [0.6, -0.55]]) {
    g.beginPath()
    g.arc(sx(x), sy(y), 36, 0, Math.PI * 2)
    g.stroke()
  }
  const [a, b, f] = frameAt(tNow)
  const lerp = (p: { x: number; y: number }, qq: { x: number; y: number } | undefined) =>
    qq ? { x: p.x + (qq.x - p.x) * f, y: p.y + (qq.y - p.y) * f } : p
  const drawSide = (arr: FrameEvent['home'], barr: FrameEvent['home'], col: string): void => {
    arr.forEach((s, i) => {
      const nb = barr.find((z) => z.player === s.player)
      const p = lerp(s.pos, nb?.pos)
      g.fillStyle = col
      const X = sx(p.x)
      const Y = sy(p.y)
      if (pos(s.player) === 'D') g.fillRect(X - 7, Y - 7, 14, 14)
      else {
        g.beginPath()
        g.arc(X, Y, 8, 0, Math.PI * 2)
        g.fill()
      }
      if (nb) {
        g.strokeStyle = col
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(X, Y)
        g.lineTo(sx(p.x + (nb.pos.x - s.pos.x) * 2), sy(p.y + (nb.pos.y - s.pos.y) * 2))
        g.stroke()
      }
      g.fillStyle = '#fff'
      g.font = '9px sans-serif'
      g.fillText(String(i + 1), X - 3, Y + 3)
      if (a.puckCarrier === s.player) {
        g.strokeStyle = '#111'
        g.lineWidth = 2
        g.beginPath()
        g.arc(X, Y, 12, 0, Math.PI * 2)
        g.stroke()
      }
    })
  }
  drawSide(a.home, b.home, '#1f6feb')
  drawSide(a.away, b.away, '#d9480f')
  for (const [gl, gb, col] of [[a.homeGoalie, b.homeGoalie, '#0b3d91'], [a.awayGoalie, b.awayGoalie, '#8a2c00']] as const) {
    const p = lerp(gl.pos, gb.pos)
    g.fillStyle = col
    g.fillRect(sx(p.x) - 5, sy(p.y) - 9, 10, 18)
  }
  const pk = lerp(a.puck, b.puck)
  g.fillStyle = '#000'
  g.beginPath()
  g.arc(sx(pk.x), sy(pk.y), 4, 0, Math.PI * 2)
  g.fill()
  const per = Math.floor(tNow / 1200) + 1
  const t = tNow % 1200
  ;(document.getElementById('clock') as HTMLElement).textContent =
    `P${per} ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}  sim ${simMs.toFixed(0)} ms  ${out.homeGoals}-${out.awayGoals}`
  const recent = events.filter((e) => abs(e) <= tNow && abs(e) > tNow - 12).slice(-7)
  ;(document.getElementById('log') as HTMLElement).textContent = recent
    .map((e) => {
      const r = e as unknown as Record<string, string>
      const who = name(r.shooter ?? r.scorer ?? (typeof r.from === 'string' ? r.from : undefined) ?? r.by ?? r.player ?? r.goalie ?? r.winner)
      const to = r.to ? ` → ${name(r.to)}${(e as { completed?: boolean }).completed === false ? ' ✗' : ''}` : r.on ? ` on ${name(r.on)}` : ''
      return `${(abs(e) % 1200).toFixed(1).padStart(7)}  ${e.type.padEnd(11)} ${who}${to}${r.infraction ? ' ' + r.infraction : ''}${(e as { reason?: string }).reason ? ' (' + (e as { reason?: string }).reason + ')' : ''}`
    })
    .join('\n')
  ;(document.getElementById('seek') as HTMLInputElement).value = String(tNow / dur)
}

let last = performance.now()
function tick(now: number): void {
  const dt = (now - last) / 1000
  last = now
  if (playing) tNow = Math.min(dur, tNow + dt * speed)
  draw()
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
document.getElementById('play')!.onclick = () => {
  playing = !playing
}
;(document.getElementById('speed') as HTMLSelectElement).onchange = (e) => {
  speed = Number((e.target as HTMLSelectElement).value)
}
;(document.getElementById('seek') as HTMLInputElement).oninput = (e) => {
  tNow = Number((e.target as HTMLInputElement).value) * dur
}
;(window as unknown as Record<string, unknown>).__top = {
  seek: (t: number) => {
    tNow = t
  },
  play: (p: boolean) => {
    playing = p
  },
  events: () => events.map((e) => ({ t: abs(e), type: e.type }))
}
