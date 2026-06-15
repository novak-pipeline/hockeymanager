/**
 * Stylised world map for the Scouting hub. Equirectangular projection in a
 * 0 0 360 180 viewBox (x = lon+180, y = 90-lat) so nation markers sit at their
 * real lon/lat over simplified continent shapes. Scouted nations glow orange.
 */
import { FlagIcon } from './FlagIcon'

/** Rough continent silhouettes (viewBox coords) — ambient backdrop, not precise. */
const CONTINENTS: string[] = [
  // North America
  '12,28 30,20 92,18 118,22 122,40 110,53 100,68 82,75 72,66 58,54 44,40 24,36',
  // Greenland
  '106,11 130,11 132,25 114,27 108,18',
  // South America
  '100,96 117,92 125,104 120,129 107,151 97,150 91,128 96,108',
  // Europe
  '175,29 201,25 215,33 210,45 195,49 183,46 177,39',
  // Africa
  '176,58 211,56 223,75 214,105 196,123 186,108 179,82',
  // Asia
  '214,24 300,17 341,30 337,61 300,73 262,66 236,58 219,46 213,34',
  // Oceania
  '300,121 333,116 341,131 326,141 304,137',
]

/** lon/lat for the hockey nations we care about → marker position. */
const NATION_COORD: Record<string, [number, number]> = {
  Canada: [-101, 60], USA: [-98, 39], 'United States': [-98, 39],
  Sweden: [15, 62], Finland: [26, 64], Norway: [9, 61], Denmark: [10, 56],
  Russia: [44, 56], Czechia: [15.5, 49.8], 'Czech Republic': [15.5, 49.8],
  Slovakia: [19.5, 48.7], Switzerland: [8, 46.8], Germany: [10.5, 51],
  Austria: [14.5, 47.6], France: [2.5, 46.6], Latvia: [24.6, 56.9],
  Belarus: [28, 53.7], Kazakhstan: [67, 48], 'Great Britain': [-2, 54],
  'United Kingdom': [-2, 54], Finland2: [26, 64], Slovenia: [14.8, 46.1],
}

export interface WorldMapNation {
  nation: string
  scouted: boolean
  /** 0–100 coverage knowledge, drives the glow intensity. */
  knowledge: number
}

const proj = (lon: number, lat: number): [number, number] => [lon + 180, 90 - lat]

export function WorldMap({ nations, onPick }: {
  nations: WorldMapNation[]
  onPick?: (nation: string) => void
}): JSX.Element {
  const plotted = nations
    .map((n) => ({ ...n, coord: NATION_COORD[n.nation] }))
    .filter((n): n is WorldMapNation & { coord: [number, number] } => !!n.coord)

  return (
    <div style={{ position: 'relative', width: '100%', background: 'var(--bg2)', borderRadius: 'var(--radius)', border: '1px solid var(--line)', overflow: 'hidden' }}>
      <svg viewBox="0 0 360 180" style={{ width: '100%', display: 'block' }} role="img" aria-label="Scouting coverage world map">
        <rect x="0" y="0" width="360" height="180" fill="transparent" />
        {CONTINENTS.map((pts, i) => (
          <polygon key={i} points={pts} fill="rgba(120,130,150,0.16)" stroke="rgba(120,130,150,0.30)" strokeWidth={0.3} />
        ))}
        {plotted.map((n) => {
          const [x, y] = proj(n.coord[0], n.coord[1])
          const r = n.scouted ? 4.2 : 2.4
          const color = n.scouted ? 'var(--accent, #f5b301)' : 'rgba(150,160,180,0.55)'
          return (
            <g key={n.nation} style={{ cursor: onPick ? 'pointer' : 'default' }} onClick={() => onPick?.(n.nation)}>
              {n.scouted && <circle cx={x} cy={y} r={r + 3} fill="var(--accent, #f5b301)" opacity={0.18} />}
              <circle cx={x} cy={y} r={r} fill={color} stroke="rgba(0,0,0,0.4)" strokeWidth={0.3} />
            </g>
          )
        })}
      </svg>
      {/* Scouted-nation chips overlaid bottom-left for legibility. */}
      <div style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: '70%' }}>
        {plotted.filter((n) => n.scouted).map((n) => (
          <span key={n.nation} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, background: 'rgba(245,179,1,0.16)', border: '1px solid var(--accent, #f5b301)' }}>
            <FlagIcon nationality={n.nation} size={13} />{n.nation}
          </span>
        ))}
      </div>
      <div style={{ position: 'absolute', right: 10, bottom: 10, fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent, #f5b301)', display: 'inline-block' }} /> Currently scouting
      </div>
    </div>
  )
}
