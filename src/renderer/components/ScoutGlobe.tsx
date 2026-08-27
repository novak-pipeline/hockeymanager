/**
 * The scouting globe (C4).
 *
 * What this replaces: seven hand-drawn polygons in an equirectangular box, which
 * the playtest called "ugly blobs" and which told you nothing you couldn't read
 * off a table. This is a real orthographic globe — it spins, it has a horizon,
 * and every mark on it is a fact about your department.
 *
 * How it's drawn, and why this way: the landmasses are a DOT FIELD, not filled
 * polygons. Sampling land on a lat/lon grid and projecting each dot means every
 * point is trivially either in front of the horizon or behind it, so the sphere
 * clips itself correctly with no polygon-clipping maths at all — and the dotted
 * treatment happens to be the look that reads as "operations map" rather than
 * "atlas". Everything renders to a canvas so the ~900 land dots, the graticule
 * and the coverage arcs cost one draw call's worth of work per frame instead of
 * a thousand React nodes.
 *
 * What the marks MEAN:
 *   · a filled, haloed node  = a nation your department has eyes on; the halo
 *     grows and brightens with your knowledge there
 *   · a hollow dashed ring   = a real hockey nation with NO eyes on it — the
 *     blind spots, drawn as deliberately as the coverage
 *   · an arc                 = the line from your club to a covered nation
 *
 * Interaction: drag to spin, wheel is left alone (the page scrolls), hover for a
 * readout, click a nation to hand it up to the caller.
 */
import { useEffect, useRef, useState } from 'react'

export interface GlobeNation {
  nation: string
  /** 0–100 department knowledge in that nation. */
  knowledge: number
  /** A scout's brief currently covers it. */
  covered: boolean
  /** Players in that nation's leagues. */
  playerCount: number
  /** Draft-age players there — the reason a blind spot matters. */
  youthCount: number
  /** Scouts whose brief reaches it. */
  scoutNames: string[]
}

/** lon/lat of the hockey world's nations. */
const NATION_COORD: Record<string, [number, number]> = {
  Canada: [-101, 57], USA: [-98, 39], 'United States': [-98, 39],
  Sweden: [15, 62], Finland: [26, 64], Norway: [9, 61], Denmark: [10, 56],
  Russia: [50, 57], Czechia: [15.5, 49.8], 'Czech Republic': [15.5, 49.8],
  Slovakia: [19.5, 48.7], Switzerland: [8, 46.8], Germany: [10.5, 51],
  Austria: [14.5, 47.6], France: [2.5, 46.6], Latvia: [24.6, 56.9],
  Belarus: [28, 53.7], Kazakhstan: [67, 48], 'Great Britain': [-2, 54],
  'United Kingdom': [-2, 54], Slovenia: [14.8, 46.1], Poland: [19, 52],
  Italy: [12, 43], Hungary: [19, 47], Ukraine: [31, 49], Japan: [138, 36],
  China: [104, 35], 'South Korea': [128, 36], Netherlands: [5.5, 52.2],
  Belgium: [4.5, 50.6], Croatia: [16, 45.2], Serbia: [21, 44], Romania: [25, 46],
  Estonia: [25.5, 58.8], Lithuania: [24, 55.2], Iceland: [-19, 65],
  Spain: [-3.7, 40.4], Australia: [134, -25], 'New Zealand': [172, -41],
  'North America': [-100, 45],
}

/* ── land ─────────────────────────────────────────────────────────────────── */
/** Simplified coastlines as lon/lat rings — the source for the dot field. */
const LAND: Array<Array<[number, number]>> = [
  // North America
  [[-168, 66], [-160, 71], [-140, 70], [-128, 70], [-115, 69], [-100, 69], [-95, 74],
   [-85, 73], [-80, 67], [-78, 62], [-95, 60], [-92, 52], [-79, 52], [-70, 60], [-64, 60],
   [-56, 52], [-66, 45], [-70, 42], [-74, 39], [-76, 35], [-81, 31], [-80, 25], [-84, 30],
   [-90, 29], [-95, 29], [-97, 26], [-94, 18], [-88, 21], [-87, 16], [-83, 9], [-79, 9],
   [-83, 15], [-92, 14], [-97, 16], [-106, 23], [-110, 24], [-114, 31], [-121, 34],
   [-124, 41], [-124, 48], [-131, 54], [-141, 60], [-150, 59], [-155, 58], [-162, 59], [-165, 63]],
  // Greenland
  [[-45, 60], [-52, 64], [-53, 68], [-58, 72], [-55, 76], [-62, 78], [-58, 82], [-40, 83],
   [-22, 80], [-20, 74], [-28, 70], [-32, 66], [-40, 62]],
  // South America
  [[-81, -4], [-79, 2], [-77, 8], [-72, 11], [-62, 10], [-52, 5], [-50, 0], [-44, -2],
   [-35, -5], [-38, -13], [-39, -18], [-48, -25], [-53, -34], [-58, -38], [-62, -40],
   [-65, -45], [-68, -50], [-70, -55], [-75, -52], [-73, -45], [-73, -37], [-71, -30],
   [-70, -23], [-70, -18], [-76, -14], [-81, -6]],
  // Africa
  [[-17, 15], [-16, 21], [-10, 26], [0, 32], [10, 37], [20, 32], [32, 31], [35, 24],
   [39, 15], [43, 11], [51, 12], [48, 4], [41, -2], [40, -10], [35, -18], [33, -26],
   [28, -33], [20, -35], [18, -30], [14, -22], [12, -16], [9, -1], [2, 5], [-8, 4], [-13, 8]],
  // Eurasia
  [[-9, 43], [-9, 37], [-2, 36], [3, 42], [8, 44], [12, 38], [18, 40], [24, 38], [28, 41],
   [36, 36], [36, 31], [34, 29], [43, 29], [48, 30], [56, 27], [61, 25], [68, 24], [73, 20],
   [78, 9], [80, 13], [87, 21], [92, 22], [95, 16], [99, 8], [104, 1], [109, 11], [108, 21],
   [117, 23], [122, 31], [122, 40], [128, 42], [130, 48], [135, 54], [142, 59], [150, 59],
   [160, 61], [170, 66], [179, 66], [172, 70], [160, 71], [145, 73], [130, 73], [113, 74],
   [100, 77], [78, 73], [69, 73], [60, 70], [50, 69], [40, 66], [33, 70], [30, 70], [25, 71],
   [21, 70], [17, 69], [12, 65], [5, 58], [8, 54], [4, 52], [0, 50], [-2, 48], [-4, 48]],
  // Great Britain
  [[-5, 58], [-2, 58], [0, 53], [1, 52], [-3, 50], [-5, 50], [-5, 54], [-6, 55]],
  // Ireland
  [[-10, 54], [-6, 55], [-6, 52], [-10, 52]],
  // Japan
  [[130, 31], [132, 34], [136, 35], [141, 41], [141, 45], [145, 44], [140, 38], [137, 37], [135, 34], [131, 31]],
  // Australia
  [[114, -22], [113, -26], [115, -34], [120, -34], [129, -32], [135, -35], [141, -38],
   [147, -38], [150, -37], [153, -28], [153, -25], [146, -19], [142, -11], [136, -12],
   [130, -11], [125, -14], [122, -18]],
  // New Zealand
  [[173, -35], [178, -38], [177, -40], [174, -41], [171, -43], [167, -46], [170, -46]],
  // Iceland
  [[-24, 65], [-22, 66], [-14, 66], [-13, 64], [-18, 63], [-22, 64]],
]

function inRing(lon: number, lat: number, ring: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Sample land on a roughly area-even lat/lon grid. Computed once per module. */
const LAND_DOTS: Array<[number, number]> = (() => {
  const dots: Array<[number, number]> = []
  const STEP = 3.4
  for (let lat = -58; lat <= 84; lat += STEP) {
    const scale = Math.max(0.18, Math.cos((lat * Math.PI) / 180))
    const lonStep = STEP / scale
    for (let lon = -180; lon < 180; lon += lonStep) {
      for (const ring of LAND) {
        if (inRing(lon, lat, ring)) { dots.push([lon, lat]); break }
      }
    }
  }
  return dots
})()

const RAD = Math.PI / 180

/** Orthographic projection. Returns null when the point is over the horizon. */
function project(
  lon: number, lat: number, lam0: number, phi0: number, r: number, cx: number, cy: number,
): { x: number; y: number; depth: number } | null {
  const la = lat * RAD, lo = (lon - lam0) * RAD, p0 = phi0 * RAD
  const cosc = Math.sin(p0) * Math.sin(la) + Math.cos(p0) * Math.cos(la) * Math.cos(lo)
  if (cosc < 0) return null
  const x = cx + r * Math.cos(la) * Math.sin(lo)
  const y = cy - r * (Math.cos(p0) * Math.sin(la) - Math.sin(p0) * Math.cos(la) * Math.cos(lo))
  return { x, y, depth: cosc }
}

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

export function ScoutGlobe({ nations, homeNation, onPick, focusNation, height = 380 }: {
  nations: GlobeNation[]
  /** Your club's home nation — the arcs originate here. */
  homeNation?: string
  onPick?: (nation: string) => void
  /** Spin the globe round to this nation when it changes. */
  focusNation?: string | null
  height?: number
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ nation: string; x: number; y: number } | null>(null)
  const rot = useRef({ lam: 60, phi: 22 })
  const drag = useRef<{ x: number; y: number; lam: number; phi: number } | null>(null)
  const spinning = useRef(true)
  // Live marker screen positions, written by the draw loop and read by the hover
  // hit-test — keeping them out of state avoids a re-render every frame.
  const hits = useRef<Array<{ nation: string; x: number; y: number }>>([])

  const plotted = nations.filter((n) => NATION_COORD[n.nation])

  // Spinning to a nation the user picked from the list beats making him drag
  // the world round until he finds it. Eased toward the target each frame.
  const target = useRef<{ lam: number; phi: number } | null>(null)
  useEffect(() => {
    const c = focusNation ? NATION_COORD[focusNation] : undefined
    if (!c) return
    spinning.current = false
    target.current = { lam: c[0], phi: c[1] }
  }, [focusNation])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let stopped = false

    const draw = (): void => {
      if (stopped) return
      const dpr = window.devicePixelRatio || 1
      const w = wrap.clientWidth
      const h = height
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const accent = cssVar(wrap, '--accent', '#f5b301')
      const text = cssVar(wrap, '--text', '#e8ecf3')
      const line = cssVar(wrap, '--line', '#2a3040')
      const r = Math.min(w * 0.42, h * 0.44)
      const cx = w / 2
      const cy = h / 2

      if (target.current) {
        const t = target.current
        // Take the short way round the sphere.
        let d = ((t.lam - rot.current.lam + 540) % 360) - 180
        rot.current.lam += d * 0.12
        rot.current.phi += (t.phi - rot.current.phi) * 0.12
        if (Math.abs(d) < 0.4 && Math.abs(t.phi - rot.current.phi) < 0.4) target.current = null
      } else if (spinning.current && !drag.current) {
        rot.current.lam = (rot.current.lam + 0.12) % 360
      }
      const { lam, phi } = rot.current

      // Ocean sphere + atmosphere.
      const glow = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.18)
      glow.addColorStop(0, 'rgba(120,170,255,0.16)')
      glow.addColorStop(1, 'rgba(120,170,255,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2); ctx.fill()

      const ocean = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r)
      ocean.addColorStop(0, 'rgba(46,72,112,0.95)')
      ocean.addColorStop(0.62, 'rgba(24,40,66,0.95)')
      ocean.addColorStop(1, 'rgba(9,15,27,0.98)')
      ctx.fillStyle = ocean
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()

      // Graticule — 30° meridians and parallels, the thing that says "sphere".
      ctx.strokeStyle = 'rgba(150,180,220,0.13)'
      ctx.lineWidth = 0.6
      for (let mlon = -180; mlon < 180; mlon += 30) {
        ctx.beginPath()
        let started = false
        for (let mlat = -90; mlat <= 90; mlat += 3) {
          const p = project(mlon, mlat, lam, phi, r, cx, cy)
          if (!p) { started = false; continue }
          if (!started) { ctx.moveTo(p.x, p.y); started = true } else ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
      }
      for (let mlat = -60; mlat <= 60; mlat += 30) {
        ctx.beginPath()
        let started = false
        for (let mlon = -180; mlon <= 180; mlon += 3) {
          const p = project(mlon, mlat, lam, phi, r, cx, cy)
          if (!p) { started = false; continue }
          if (!started) { ctx.moveTo(p.x, p.y); started = true } else ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
      }

      // Land dot field. Dots fade toward the limb, which is what sells the curve.
      for (const [lon, lat] of LAND_DOTS) {
        const p = project(lon, lat, lam, phi, r, cx, cy)
        if (!p) continue
        const a = 0.18 + 0.62 * p.depth
        ctx.fillStyle = `rgba(168,190,220,${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, Math.max(0.7, r * 0.0062 * (0.55 + p.depth * 0.75)), 0, Math.PI * 2)
        ctx.fill()
      }

      // Coverage arcs from home to each covered nation — the department's reach.
      const home = homeNation ? NATION_COORD[homeNation] : undefined
      if (home) {
        for (const n of plotted) {
          if (!n.covered) continue
          const to = NATION_COORD[n.nation]!
          ctx.strokeStyle = `rgba(245,179,1,${(0.10 + (n.knowledge / 100) * 0.35).toFixed(3)})`
          ctx.lineWidth = 1
          ctx.beginPath()
          let started = false
          for (let t = 0; t <= 1.0001; t += 0.02) {
            const lo = home[0] + (to[0] - home[0]) * t
            const la = home[1] + (to[1] - home[1]) * t
            const p = project(lo, la, lam, phi, r, cx, cy)
            if (!p) { started = false; continue }
            if (!started) { ctx.moveTo(p.x, p.y); started = true } else ctx.lineTo(p.x, p.y)
          }
          ctx.stroke()
        }
      }

      // Nation markers.
      const nextHits: Array<{ nation: string; x: number; y: number }> = []
      for (const n of plotted) {
        const [lon, lat] = NATION_COORD[n.nation]!
        const p = project(lon, lat, lam, phi, r, cx, cy)
        if (!p) continue
        nextHits.push({ nation: n.nation, x: p.x, y: p.y })
        const k = Math.max(0, Math.min(100, n.knowledge)) / 100
        if (n.covered || n.knowledge >= 25) {
          const rad = 2.4 + k * 3.2
          const halo = 5 + k * 12
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, halo)
          g.addColorStop(0, `rgba(245,179,1,${(0.30 * p.depth).toFixed(3)})`)
          g.addColorStop(1, 'rgba(245,179,1,0)')
          ctx.fillStyle = g
          ctx.beginPath(); ctx.arc(p.x, p.y, halo, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = accent
          ctx.globalAlpha = 0.35 + 0.65 * p.depth
          ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill()
          ctx.globalAlpha = 1
        } else {
          // A blind spot is drawn as deliberately as coverage — a hollow ring
          // sized by how much draft-age talent is sitting there unwatched.
          const rad = 2.6 + Math.min(4, n.youthCount / 90)
          ctx.strokeStyle = `rgba(226,110,92,${(0.30 + 0.45 * p.depth).toFixed(3)})`
          ctx.lineWidth = 1.2
          ctx.setLineDash([2, 2])
          ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.stroke()
          ctx.setLineDash([])
        }
      }
      hits.current = nextHits

      // Limb.
      ctx.strokeStyle = line
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.7
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
      ctx.globalAlpha = 1
      void text
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { stopped = true; cancelAnimationFrame(raf) }
  }, [plotted, homeNation, height])

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    if (drag.current) {
      rot.current.lam = drag.current.lam - (mx - drag.current.x) * 0.4
      rot.current.phi = Math.max(-80, Math.min(80, drag.current.phi + (my - drag.current.y) * 0.4))
      return
    }
    let best: { nation: string; x: number; y: number } | null = null
    let bestD = 14 * 14
    for (const h of hits.current) {
      const d = (h.x - mx) ** 2 + (h.y - my) ** 2
      if (d < bestD) { bestD = d; best = h }
    }
    setHover(best)
  }

  const hovered = hover ? plotted.find((n) => n.nation === hover.nation) : undefined

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height, cursor: hover ? 'pointer' : 'grab' }}
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          drag.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, lam: rot.current.lam, phi: rot.current.phi }
          spinning.current = false
        }}
        onMouseUp={() => { drag.current = null }}
        onMouseLeave={() => { drag.current = null; setHover(null) }}
        onMouseMove={onMove}
        onClick={() => { if (hover && onPick) onPick(hover.nation) }}
        onDoubleClick={() => { spinning.current = !spinning.current }}
        role="img"
        aria-label="Scouting coverage globe"
      />

      {hovered && hover && (
        <div style={{
          position: 'absolute', left: Math.min(hover.x + 14, 10000), top: hover.y + 12, pointerEvents: 'none',
          background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 10px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.45)', maxWidth: 250, zIndex: 5,
        }}>
          <div style={{ fontWeight: 800, fontSize: 12 }}>{hovered.nation}</div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.45 }}>
            {hovered.playerCount.toLocaleString()} players · {hovered.youthCount.toLocaleString()} draft-age
            <br />
            Read: <b style={{ color: hovered.knowledge >= 50 ? 'var(--success)' : hovered.knowledge >= 25 ? 'var(--accent)' : 'var(--danger)' }}>{hovered.knowledge}%</b>
            <br />
            {hovered.scoutNames.length > 0
              ? `Covered by ${hovered.scoutNames.join(', ')}`
              : 'Nobody is watching this country.'}
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', left: 12, bottom: 10, display: 'flex', gap: 14, fontSize: 10, color: 'var(--muted)', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent, #f5b301)' }} /> eyes on it
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px dashed #e26e5c' }} /> blind spot
        </span>
        <span>drag to spin · double-click to pause</span>
      </div>
    </div>
  )
}
