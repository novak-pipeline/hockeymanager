import { nationIso } from './format'

/**
 * Offline, dependency-free country flags drawn as inline SVG (viewBox 0 0 3 2).
 * Emoji flags don't render on Windows/Chromium (they show the letters), so we
 * draw simplified-but-recognisable flags for the hockey nations. Unknown nations
 * return null so callers can fall back to a text label.
 */

const W = 3, H = 2

function bands(colors: string[], vertical = false): JSX.Element[] {
  const n = colors.length
  return colors.map((c, i) =>
    vertical
      ? <rect key={i} x={(W / n) * i} y={0} width={W / n} height={H} fill={c} />
      : <rect key={i} x={0} y={(H / n) * i} width={W} height={H / n} fill={c} />,
  )
}

/** Nordic cross: field + cross offset toward the hoist. */
function nordic(field: string, cross: string, inner?: string): JSX.Element[] {
  const els = [<rect key="f" x={0} y={0} width={W} height={H} fill={field} />]
  const vx = 0.7, vw = 0.42, hy = 0.79, hh = 0.42
  els.push(<rect key="cv" x={vx} y={0} width={vw} height={H} fill={cross} />)
  els.push(<rect key="ch" x={0} y={hy} width={W} height={hh} fill={cross} />)
  if (inner) {
    const iw = 0.16, ih = 0.16
    els.push(<rect key="iv" x={vx + (vw - iw) / 2} y={0} width={iw} height={H} fill={inner} />)
    els.push(<rect key="ih" x={0} y={hy + (hh - ih) / 2} width={W} height={ih} fill={inner} />)
  }
  return els
}

type FlagFn = () => JSX.Element[]

const FLAGS: Record<string, FlagFn> = {
  RU: () => bands(['#fff', '#0039A6', '#D52B1E']),
  SE: () => nordic('#006AA7', '#FECC00'),
  FI: () => nordic('#fff', '#003580'),
  NO: () => nordic('#BA0C2F', '#fff', '#00205B'),
  DK: () => nordic('#C8102E', '#fff'),
  IS: () => nordic('#02529C', '#fff', '#DC1E35'),
  DE: () => bands(['#000', '#DD0000', '#FFCE00']),
  AT: () => bands(['#ED2939', '#fff', '#ED2939']),
  NL: () => bands(['#AE1C28', '#fff', '#21468B']),
  PL: () => bands(['#fff', '#DC143C']),
  RU2: () => bands(['#fff', '#0039A6', '#D52B1E']),
  EE: () => bands(['#0072CE', '#000', '#fff']),
  LT: () => bands(['#FDB913', '#006A44', '#C1272D']),
  LV: () => [
    <rect key="a" x={0} y={0} width={W} height={H} fill="#9E3039" />,
    <rect key="b" x={0} y={H * 0.4} width={W} height={H * 0.2} fill="#fff" />,
  ],
  UA: () => [
    <rect key="a" x={0} y={0} width={W} height={H / 2} fill="#0057B7" />,
    <rect key="b" x={0} y={H / 2} width={W} height={H / 2} fill="#FFDD00" />,
  ],
  BY: () => [
    <rect key="a" x={0} y={0} width={W} height={H * 0.66} fill="#C8313E" />,
    <rect key="b" x={0} y={H * 0.66} width={W} height={H * 0.34} fill="#4AA657" />,
  ],
  FR: () => bands(['#0055A4', '#fff', '#EF4135'], true),
  IT: () => bands(['#009246', '#fff', '#CE2B37'], true),
  SK: () => bands(['#fff', '#0B4EA2', '#EE1C25']),
  SI: () => bands(['#fff', '#0000A0', '#ED1C24']),
  CZ: () => [
    <rect key="a" x={0} y={0} width={W} height={H / 2} fill="#fff" />,
    <rect key="b" x={0} y={H / 2} width={W} height={H / 2} fill="#D7141A" />,
    <polygon key="c" points={`0,0 ${W * 0.5},${H / 2} 0,${H}`} fill="#11457E" />,
  ],
  CH: () => [
    <rect key="a" x={0} y={0} width={W} height={H} fill="#D52B1E" />,
    <rect key="v" x={W / 2 - 0.18} y={H / 2 - 0.55} width={0.36} height={1.1} fill="#fff" />,
    <rect key="h" x={W / 2 - 0.55} y={H / 2 - 0.18} width={1.1} height={0.36} fill="#fff" />,
  ],
  CA: () => [
    <rect key="a" x={0} y={0} width={W} height={H} fill="#fff" />,
    <rect key="l" x={0} y={0} width={W * 0.25} height={H} fill="#D80621" />,
    <rect key="r" x={W * 0.75} y={0} width={W * 0.25} height={H} fill="#D80621" />,
    <path key="m" d="M1.5 0.55 l0.1 0.28 0.26 -0.08 -0.1 0.26 0.22 0.05 -0.18 0.16 0.05 0.12 -0.28 -0.05 0 0.31 -0.14 0 0 -0.31 -0.28 0.05 0.05 -0.12 -0.18 -0.16 0.22 -0.05 -0.1 -0.26 0.26 0.08 z" fill="#D80621" />,
  ],
  US: () => [
    ...Array.from({ length: 13 }, (_, i) => (
      <rect key={i} x={0} y={(H / 13) * i} width={W} height={H / 13} fill={i % 2 === 0 ? '#B22234' : '#fff'} />
    )),
    <rect key="canton" x={0} y={0} width={W * 0.4} height={(H / 13) * 7} fill="#3C3B6E" />,
  ],
  GB: () => [
    <rect key="a" x={0} y={0} width={W} height={H} fill="#012169" />,
    <path key="d1" d={`M0,0 L${W},${H} M${W},0 L0,${H}`} stroke="#fff" strokeWidth="0.4" />,
    <path key="d2" d={`M0,0 L${W},${H} M${W},0 L0,${H}`} stroke="#C8102E" strokeWidth="0.18" />,
    <rect key="vh" x={W / 2 - 0.25} y={0} width={0.5} height={H} fill="#fff" />,
    <rect key="hh" x={0} y={H / 2 - 0.25} width={W} height={0.5} fill="#fff" />,
    <rect key="vr" x={W / 2 - 0.12} y={0} width={0.24} height={H} fill="#C8102E" />,
    <rect key="hr" x={0} y={H / 2 - 0.12} width={W} height={0.24} fill="#C8102E" />,
  ],
  JP: () => [
    <rect key="a" x={0} y={0} width={W} height={H} fill="#fff" />,
    <circle key="c" cx={W / 2} cy={H / 2} r={0.6} fill="#BC002D" />,
  ],
  KR: () => [
    <rect key="a" x={0} y={0} width={W} height={H} fill="#fff" />,
    <circle key="t" cx={W / 2} cy={H / 2} r={0.45} fill="#CD2E3A" />,
    <path key="b" d={`M${W / 2 - 0.45},${H / 2} a0.225 0.225 0 0 1 0.45 0 a0.225 0.225 0 0 0 0.45 0 Z`} fill="#0047A0" />,
  ],
  CN: () => [
    <rect key="a" x={0} y={0} width={W} height={H} fill="#DE2910" />,
    <text key="s" x={0.5} y={0.75} fontSize="0.6" fill="#FFDE00" textAnchor="middle">★</text>,
  ],
  CH2: () => [],
}

export function FlagIcon({ nationality, size = 16 }: { nationality?: string; size?: number }): JSX.Element | null {
  const iso = nationIso(nationality)
  if (!iso) return null
  const fn = FLAGS[iso]
  if (!fn) return null
  return (
    <svg
      viewBox="0 0 3 2" width={size} height={(size * 2) / 3}
      style={{ borderRadius: 2, display: 'inline-block', verticalAlign: 'middle', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }}
      aria-label={nationality}
    >
      {fn()}
    </svg>
  )
}
