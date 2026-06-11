/**
 * PixiJS 2D rink renderer (build step #4 — "this proves it's fun").
 *
 * Strictly a VIEW: it is handed a `MatchTimeline` (built from the engine's
 * GameStream) and does nothing but draw it. It owns a Pixi Application, a render
 * loop driven by a wall-clock playback position, and the sprites for skaters,
 * goalies and the puck. It computes no outcomes — that rule is the keystone.
 */
import { Application, Container, Graphics } from 'pixi.js'
// Electron's CSP forbids unsafe-eval; this side-effect import swaps Pixi's
// eval-based shader/uniform codegen for no-eval polyfills. Must load before any
// renderer is created.
import 'pixi.js/unsafe-eval'
import { RINK_ASPECT, type XY } from '@domain'
import type { MatchTimeline } from './timeline'
import type { MatchRenderer, MatchView, RinkColors } from './rendererContract'

export type { MatchRenderer, MatchView, RinkColors } from './rendererContract'

const ICE = 0xf2f6fb
const LINE_RED = 0xd33b3b
const LINE_BLUE = 0x2f6fd8
const PUCK = 0x111418
const SKATER_R = 12
const GOALIE_R = 14
const PUCK_R = 5

export class RinkRenderer implements MatchRenderer {
  private readonly app: Application
  private readonly world = new Container()
  private readonly rink = new Graphics()
  private readonly homeSprites: Graphics[] = []
  private readonly awaySprites: Graphics[] = []
  private homeGoalie = new Graphics()
  private awayGoalie = new Graphics()
  private puck = new Graphics()
  private carrierRing = new Graphics()

  private timeline: MatchTimeline | null = null
  private colors: RinkColors = { home: 0x4aa3ff, away: 0xff6b6b }
  private clockPos = 0 // absolute seconds into the game
  private playing = false
  private speed = 1
  private listener: ((v: MatchView) => void) | null = null

  private px = { w: 0, h: 0, ox: 0, oy: 0 }

  private constructor(app: Application) {
    this.app = app
  }

  static async create(parent: HTMLElement, colors?: RinkColors): Promise<RinkRenderer> {
    const app = new Application()
    const w = parent.clientWidth || 900
    await app.init({
      width: w,
      height: Math.round(w / RINK_ASPECT),
      background: 0x0c1016,
      antialias: true,
      preference: 'webgl',
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    })
    parent.appendChild(app.canvas)
    const r = new RinkRenderer(app)
    if (colors) r.colors = colors
    r.world.addChild(r.rink)
    app.stage.addChild(r.world)
    r.computeMetrics()
    r.drawRink()
    r.app.ticker.add(r.tick)
    return r
  }

  private computeMetrics(): void {
    const pad = 14
    const W = this.app.renderer.width / (window.devicePixelRatio || 1)
    const H = this.app.renderer.height / (window.devicePixelRatio || 1)
    let w = W - pad * 2
    let h = w / RINK_ASPECT
    if (h > H - pad * 2) {
      h = H - pad * 2
      w = h * RINK_ASPECT
    }
    this.px = { w, h, ox: (W - w) / 2, oy: (H - h) / 2 }
  }

  /** Normalized [-1,1] → pixel. */
  private mx(x: number): number {
    return this.px.ox + ((x + 1) / 2) * this.px.w
  }
  private my(y: number): number {
    return this.px.oy + ((y + 1) / 2) * this.px.h
  }

  private drawRink(): void {
    const g = this.rink
    g.clear()
    const { ox, oy, w, h } = this.px
    const radius = Math.min(w, h) * 0.12
    g.roundRect(ox, oy, w, h, radius).fill(ICE).stroke({ color: 0x9fb0c3, width: 2 })

    // Center red line + center circle.
    g.moveTo(this.mx(0), oy).lineTo(this.mx(0), oy + h).stroke({ color: LINE_RED, width: 3 })
    g.circle(this.mx(0), this.my(0), h * 0.11).stroke({ color: LINE_BLUE, width: 2 })

    // Blue lines (±0.25 of half-length).
    for (const bx of [-0.25, 0.25]) {
      g.moveTo(this.mx(bx), oy).lineTo(this.mx(bx), oy + h).stroke({ color: LINE_BLUE, width: 3 })
    }

    // Goal lines + creases + nets near each end (±0.89).
    for (const sign of [-1, 1]) {
      const gx = this.mx(sign * 0.89)
      g.moveTo(gx, oy + h * 0.06).lineTo(gx, oy + h * 0.94).stroke({ color: LINE_RED, width: 2 })
      // crease
      g.circle(gx, this.my(0), h * 0.07).fill({ color: LINE_BLUE, alpha: 0.18 })
      // net
      const nw = w * 0.018
      g.rect(gx - (sign < 0 ? 0 : nw), this.my(0) - h * 0.05, nw, h * 0.1)
        .fill({ color: 0xced8e4, alpha: 0.9 })
        .stroke({ color: 0x6c7989, width: 1 })
    }

    // Faceoff dots in each zone.
    for (const fx of [-0.6, -0.2, 0.2, 0.6]) {
      for (const fy of [-0.55, 0.55]) {
        g.circle(this.mx(fx), this.my(fy), 3).fill(LINE_RED)
      }
    }
  }

  private makeDisc(color: number, r: number, stroke = 0x0c1016): Graphics {
    const g = new Graphics()
    g.circle(0, 0, r).fill(color).stroke({ color: stroke, width: 2 })
    return g
  }

  load(timeline: MatchTimeline, colors?: RinkColors): void {
    if (colors) this.colors = colors
    this.timeline = timeline
    this.clockPos = 0
    this.playing = false

    // Tear down any previous sprites.
    for (const s of [...this.homeSprites, ...this.awaySprites]) s.destroy()
    this.homeSprites.length = 0
    this.awaySprites.length = 0
    for (const s of [this.homeGoalie, this.awayGoalie, this.puck, this.carrierRing]) s.destroy()

    this.carrierRing = new Graphics()
    this.carrierRing.circle(0, 0, SKATER_R + 4).stroke({ color: 0xffd24a, width: 3 })
    this.world.addChild(this.carrierRing)

    // Up to 6 skaters per side (5v5 EV, 5v4/4v5 PP/PK, 3v3 OT, 6-skater pull).
    for (let i = 0; i < 6; i++) {
      const hs = this.makeDisc(this.colors.home, SKATER_R)
      const as = this.makeDisc(this.colors.away, SKATER_R)
      this.homeSprites.push(hs)
      this.awaySprites.push(as)
      this.world.addChild(hs, as)
    }
    this.homeGoalie = this.makeDisc(this.colors.home, GOALIE_R, 0xffffff)
    this.awayGoalie = this.makeDisc(this.colors.away, GOALIE_R, 0xffffff)
    this.puck = this.makeDisc(PUCK, PUCK_R, 0x000000)
    this.world.addChild(this.homeGoalie, this.awayGoalie, this.puck)

    this.renderAt(0)
    this.emit()
  }

  private place(g: Graphics, p: XY): void {
    g.position.set(this.mx(p.x), this.my(p.y))
  }

  private renderAt(absT: number): void {
    const tl = this.timeline
    if (!tl) return
    const snap = tl.sampleAt(absT)
    if (!snap) return
    for (let i = 0; i < this.homeSprites.length; i++) {
      if (snap.home[i]) {
        this.homeSprites[i].visible = true
        this.place(this.homeSprites[i], snap.home[i])
      } else {
        this.homeSprites[i].visible = false
      }
      if (snap.away[i]) {
        this.awaySprites[i].visible = true
        this.place(this.awaySprites[i], snap.away[i])
      } else {
        this.awaySprites[i].visible = false
      }
    }
    this.place(this.homeGoalie, snap.homeGoalie)
    this.place(this.awayGoalie, snap.awayGoalie)
    this.place(this.puck, snap.puck)
    this.carrierRing.position.copyFrom(this.puck.position)
    this.carrierRing.visible = snap.carrier !== null
  }

  private tick = (): void => {
    if (!this.playing || !this.timeline) return
    const dtSec = this.app.ticker.deltaMS / 1000
    this.clockPos += dtSec * this.speed
    if (this.clockPos >= this.timeline.duration) {
      this.clockPos = this.timeline.duration
      this.playing = false
    }
    this.renderAt(this.clockPos)
    this.emit()
  }

  private emit(): void {
    if (!this.listener || !this.timeline) return
    const score = this.timeline.scoreAt(this.clockPos)
    const clock = this.timeline.clockAt(this.clockPos)
    const ended = this.clockPos >= this.timeline.duration
    this.listener({
      period: clock.period,
      clock: clock.text,
      homeScore: ended ? this.timeline.homeFinal : score.home,
      awayScore: ended ? this.timeline.awayFinal : score.away,
      playing: this.playing,
      progress: this.timeline.duration > 0 ? this.clockPos / this.timeline.duration : 0,
      ended
    })
  }

  onUpdate(cb: (v: MatchView) => void): void {
    this.listener = cb
    this.emit()
  }

  play(): void {
    if (!this.timeline) return
    if (this.clockPos >= this.timeline.duration) this.clockPos = 0
    this.playing = true
    this.emit()
  }

  pause(): void {
    this.playing = false
    this.emit()
  }

  toggle(): void {
    this.playing ? this.pause() : this.play()
  }

  setSpeed(x: number): void {
    this.speed = x
  }

  seekFraction(f: number): void {
    if (!this.timeline) return
    this.clockPos = Math.max(0, Math.min(1, f)) * this.timeline.duration
    this.renderAt(this.clockPos)
    this.emit()
  }

  resize(): void {
    const parent = this.app.canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth || 900
    this.app.renderer.resize(w, Math.round(w / RINK_ASPECT))
    this.computeMetrics()
    this.drawRink()
    this.renderAt(this.clockPos)
  }

  destroy(): void {
    this.app.ticker.remove(this.tick)
    this.app.destroy(true, { children: true })
  }
}
