import * as THREE from 'three'
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
// ?old=1 mounts the pre-upgrade renderer (scripts/dev/render3d-harness/old-*.ts,
// extracted from git, untracked) for A/B screenshots + perf.
// The path is a variable so Vite's import analysis skips it: the old-*.ts files are
// untracked, and a literal specifier breaks the harness on a clean checkout.
const oldPath = './old-rink3dRenderer.ts'
const Impl: typeof Rink3dRenderer =
  q.get('old') === '1' ? ((await import(/* @vite-ignore */ oldPath)).Rink3dRenderer as typeof Rink3dRenderer) : Rink3dRenderer
const r = await Impl.create(host, colors)
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
// ?fly=1 holds both goalies in the butterfly (pose inspection)
if (q.get('fly') === '1') {
  const g = r as unknown as { homeGoaliePose: { butterflyTimer: number }; awayGoaliePose: { butterflyTimer: number } }
  g.homeGoaliePose.butterflyTimer = 1e6
  g.awayGoaliePose.butterflyTimer = 1e6
  r.setSpeed(0.05)
  r.play()
}
if (q.get('hud') === '0') hud.style.display = 'none'
// ?look=px,py,pz,lx,ly,lz[,fov] pins a debug camera (close-ups of the athletes)
if (q.has('look')) {
  const [px, py, pz, lx, ly, lz, fov] = q.get('look')!.split(',').map(Number)
  const pose = { px: px!, py: py!, pz: pz!, lx: lx!, ly: ly!, lz: lz!, ...(fov ? { fov } : {}) }
  const anyR = r as unknown as {
    setDebugCamera?: (p: typeof pose) => void
    updateCamera: (dt: number) => void
    camera: THREE.PerspectiveCamera
  }
  if (anyR.setDebugCamera) anyR.setDebugCamera(pose)
  else {
    // the pre-upgrade renderer has no debug hook: pin the camera after its update
    const orig = anyR.updateCamera.bind(anyR)
    anyR.updateCamera = (dt: number) => {
      orig(dt)
      anyR.camera.fov = pose.fov ?? 35
      anyR.camera.updateProjectionMatrix()
      anyR.camera.position.set(pose.px, pose.py, pose.pz)
      anyR.camera.lookAt(pose.lx, pose.ly, pose.lz)
    }
  }
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
// Jiggle probe: await __camTrace(ms) → per-frame camera positions + look dirs
win.__camTrace = (ms = 2000) =>
  new Promise((res) => {
    const cam = (r as unknown as { camera: THREE.PerspectiveCamera }).camera
    const out: number[][] = []
    const t0 = performance.now()
    const v = new THREE.Vector3()
    const step = (now: number) => {
      const d = cam.getWorldDirection(v)
      out.push([now - t0, cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z])
      if (now - t0 < ms) requestAnimationFrame(step)
      else res(out)
    }
    requestAnimationFrame(step)
  })
if (hud.textContent === 'loading…') hud.textContent = 'ready'
