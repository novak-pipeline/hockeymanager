import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { fullSimGame } from '@engine/full/fullSim'
import { MatchTimeline } from '@render2d/timeline'
import { Rink3dRenderer, type CameraPreset } from '@render3d'

type Win = Record<string, unknown>
const q = new URLSearchParams(location.search)
const seed = Number(q.get('seed') ?? 3)
const w = Number(q.get('w') ?? 1280)
const h = Number(q.get('h') ?? 720)
const host = document.getElementById('host')!
host.style.width = `${w}px`
host.style.height = `${h}px`
const hud = document.getElementById('hud')!

const data = generateLeague({ seed })
const resolve = (id: PlayerId): Player => data.players.get(id)!
const home = data.teams.get(data.league.teams[0]!)!
const away = data.teams.get(data.league.teams[1]!)!
const out = fullSimGame(home, away, resolve, { seed: seed * 7 })
const homeIds = new Set<PlayerId>(home.roster)
const tl = new MatchTimeline(out.stream, (id) => homeIds.has(id))
const labels: Record<string, { lastName: string }> = {}
for (const [id, p] of data.players) labels[id] = { lastName: p.name.split(' ').pop() ?? p.name }

const colors = { home: Number(q.get('home') ?? 0x1f4fbf), away: Number(q.get('away') ?? 0xc8102e) }
const r = await Rink3dRenderer.create(host, colors)
r.setEventStream(out.stream)
r.setCamera((q.get('cam') ?? 'broadcast') as CameraPreset)
let last = ''
r.onUpdate((v) => {
  const s = `P${v.period} ${v.clock}  ${v.homeScore}-${v.awayScore}`
  if (s !== last) { hud.textContent = s; last = s }
})
r.load(tl, colors, labels)
r.setSpeed(Number(q.get('speed') ?? 1))
if (q.has('t')) r.seekFraction(Number(q.get('t')))
// ?goal=N&lead=3 → start playing `lead` seconds before the Nth goal
// (&ev=save|shot|hit picks another event type)
if (q.has('goal')) {
  const kind = q.get('ev') ?? 'goal'
  const goals = out.stream
    .filter((e) => e.type === kind)
    .map((e) => {
      const g = e as unknown as { period: number; t: number }
      return (g.period - 1) * 1200 + g.t
    })
  const at = goals[Number(q.get('goal'))] ?? 0
  r.seekFraction(Math.max(0, at - Number(q.get('lead') ?? 3)) / tl.duration)
  r.play()
}
if (q.get('play') === '1') r.play()
if (q.get('hud') === '0') hud.style.display = 'none'
// ?look=px,py,pz,lx,ly,lz[,fov] pins a debug camera (close-ups of the athletes)
if (q.has('look')) {
  const [px, py, pz, lx, ly, lz, fov] = q.get('look')!.split(',').map(Number)
  r.setDebugCamera({ px: px!, py: py!, pz: pz!, lx: lx!, ly: ly!, lz: lz!, ...(fov ? { fov } : {}) })
}

if (q.get('nobloom') === '1') (r as unknown as { bloom: { enabled: boolean } }).bloom.enabled = false
const win = window as unknown as Win
win.__r3d = r
win.__duration = tl.duration
win.__goals = out.stream
  .filter((e) => e.type === 'goal')
  .map((e) => {
    const g = e as unknown as { period: number; t: number }
    return (g.period - 1) * 1200 + g.t
  })
// Perf probe: await __perf(3000) → frame-time stats over a window.
win.__perf = (ms = 3000) =>
  new Promise((res) => {
    const times: number[] = []
    let prev = performance.now()
    const t0 = prev
    const step = (now: number) => {
      times.push(now - prev)
      prev = now
      if (now - t0 < ms) requestAnimationFrame(step)
      else {
        times.sort((a, b) => a - b)
        const avg = times.reduce((a, b) => a + b, 0) / times.length
        res({ frames: times.length, avgMs: +avg.toFixed(2), p95Ms: +times[Math.floor(times.length * 0.95)]!.toFixed(2) })
      }
    }
    requestAnimationFrame(step)
  })
if (hud.textContent === 'loading…') hud.textContent = 'ready'
