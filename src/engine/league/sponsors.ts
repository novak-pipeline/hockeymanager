/**
 * Club sponsorships: a handful of commercial deals (title, jersey, arena) that
 * contribute to the club's revenue. Pure + deterministic + JSON-safe. Revenue is
 * a finances/display figure — it never feeds the calibrated sim. Deal values scale
 * with the club's stature and, crucially, with fan engagement, so a packed barn
 * is worth more to sponsors (a payoff for winning, a cost of a long tank).
 */

export interface SponsorDeal {
  kind: 'title' | 'jersey' | 'arena'
  sponsor: string
  /** Annual value in dollars. */
  value: number
  /** Seasons left on the deal (display flavour). */
  yearsLeft: number
}

const TITLE_NAMES = ['Northwind Energy', 'Apex Financial', 'Vertex Telecom', 'Summit Air', 'Ironside Steel', 'Cascade Bank']
const JERSEY_NAMES = ['Glacier Insurance', 'Trailhead Outfitters', 'Brightline Health', 'Cobalt Motors', 'Harbor Foods']
const ARENA_NAMES = ['Union Mutual', 'Granite Trust', 'Aurora Wireless', 'Keystone Logistics', 'Beacon Power']

/** Stable 0..1 hash of a string (FNV-1a) — no RNG, so deals are stable per club. */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

function pick<T>(arr: T[], seed: string): T {
  return arr[Math.floor(hash01(seed) * arr.length) % arr.length]!
}

/**
 * Build a club's three sponsorship deals, deterministically from its id/abbrev and
 * stature, scaled by fan interest (0–100, 60 ≈ neutral). Title deals are the
 * biggest; arena naming the smallest. Values land roughly in the low-to-mid
 * eight figures combined — a meaningful but not cap-distorting revenue line.
 */
export function buildSponsors(args: {
  teamKey: string
  /** Club stature 0–100 (e.g. reputation or roster strength). */
  stature: number
  /** Fan interest 0–100. */
  fanInterest: number
}): SponsorDeal[] {
  const { teamKey, stature, fanInterest } = args
  const statureMult = 0.7 + (Math.max(0, Math.min(100, stature)) / 100) * 0.8 // 0.7–1.5
  const fanMult = 0.75 + (Math.max(0, Math.min(100, fanInterest)) / 100) * 0.5 // 0.75–1.25
  const mk = (kind: SponsorDeal['kind'], base: number, names: string[]): SponsorDeal => {
    const jitter = 0.85 + hash01(teamKey + kind) * 0.3 // 0.85–1.15
    return {
      kind,
      sponsor: pick(names, teamKey + kind),
      value: Math.round((base * statureMult * fanMult * jitter) / 100_000) * 100_000,
      yearsLeft: 1 + Math.floor(hash01(teamKey + kind + 'yr') * 4), // 1–4
    }
  }
  return [
    mk('title', 14_000_000, TITLE_NAMES),
    mk('jersey', 8_000_000, JERSEY_NAMES),
    mk('arena', 5_000_000, ARENA_NAMES),
  ]
}

export function sponsorTotal(deals: SponsorDeal[]): number {
  return deals.reduce((s, d) => s + d.value, 0)
}

export function sponsorKindLabel(kind: SponsorDeal['kind']): string {
  return kind === 'title' ? 'Title sponsor' : kind === 'jersey' ? 'Jersey sponsor' : 'Arena naming rights'
}
