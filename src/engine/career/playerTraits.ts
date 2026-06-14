/**
 * Player trait badges — the EP draft-guide "Hammer / Transition Ace / Play
 * Killer" style hexagon tags. Up to three standout playing-style traits a
 * player flashes, derived from their composites/attributes. Distinct from the
 * single archetype: these are the loud, recognisable calling cards.
 *
 * Pure: deterministic from the player. No RNG.
 */
import type { Player } from '@domain'

export type TraitCategory = 'offense' | 'defense' | 'physical' | 'skating' | 'goalie' | 'intangible'

export interface PlayerTrait {
  key: string
  /** Display name, e.g. "Hammer". */
  label: string
  /** Emoji icon for the badge. */
  icon: string
  /** Category → drives the badge colour. */
  category: TraitCategory
  /** One-line meaning (tooltip). */
  blurb: string
}

interface TraitDef extends PlayerTrait {
  /** 0–100 strength; trait shows when ≥ threshold. Null = not applicable. */
  score: (ctx: TraitCtx) => number | null
  threshold: number
}

interface TraitCtx {
  p: Player
  c: Record<string, number>
  m: Record<string, number>
  phys: Record<string, number>
  g: Record<string, number>
  isF: boolean
  isD: boolean
  isG: boolean
}

const v = (o: Record<string, number>, k: string): number => o[k] ?? 50

const TRAITS: TraitDef[] = [
  // ── Offense ──
  {
    key: 'sniper', label: 'Sniper', icon: '🎯', category: 'offense',
    blurb: 'Elite shot and finishing touch.', threshold: 70,
    score: (x) => x.isG ? null : (v(x.c, 'scoring') * 0.7 + v(x.m, 'offensiveIQ') * 0.3),
  },
  {
    key: 'playmaker', label: 'Playmaker', icon: '🧠', category: 'offense',
    blurb: 'Sees the ice and threads dangerous passes.', threshold: 70,
    score: (x) => x.isG ? null : (v(x.c, 'playmaking') * 0.7 + v(x.m, 'vision') * 0.3),
  },
  {
    key: 'magician', label: 'Magician', icon: '🎩', category: 'offense',
    blurb: 'Dazzling hands and creativity in tight.', threshold: 72,
    score: (x) => x.isG ? null : (v(x.c, 'puckControl') * 0.6 + (x.p.flair ?? 50) * 0.4),
  },
  {
    key: 'quarterback', label: 'Power-Play QB', icon: '♟️', category: 'offense',
    blurb: 'Runs the power play from the back end.', threshold: 70,
    score: (x) => x.isD ? (v(x.c, 'playmaking') * 0.55 + v(x.c, 'scoring') * 0.45) : null,
  },
  // ── Skating / transition ──
  {
    key: 'burner', label: 'Burner', icon: '⚡', category: 'skating',
    blurb: 'Game-breaking speed.', threshold: 74,
    score: (x) => x.isG ? null : v(x.c, 'skating'),
  },
  {
    key: 'transition', label: 'Transition Ace', icon: '🔄', category: 'skating',
    blurb: 'Moves the puck up ice with skating and passing.', threshold: 70,
    score: (x) => x.isD ? (v(x.c, 'skating') * 0.55 + v(x.c, 'playmaking') * 0.45) : null,
  },
  // ── Defense ──
  {
    key: 'playkiller', label: 'Play Killer', icon: '🔒', category: 'defense',
    blurb: 'Smothers chances and strips pucks.', threshold: 70,
    score: (x) => x.isG ? null : (v(x.c, 'defensiveZone') * 0.55 + v(x.c, 'takeaway') * 0.45),
  },
  {
    key: 'shotblocker', label: 'Shot Blocker', icon: '🧱', category: 'defense',
    blurb: 'Sacrifices the body to block shots.', threshold: 72,
    score: (x) => x.isG ? null : v(x.c, 'blocking'),
  },
  // ── Physical ──
  {
    key: 'hammer', label: 'Hammer', icon: '🔨', category: 'physical',
    blurb: 'Punishing, physical presence.', threshold: 72,
    score: (x) => x.isG ? null : (v(x.c, 'hitting') * 0.7 + v(x.phys, 'strength') * 0.3),
  },
  {
    key: 'pest', label: 'Pest', icon: '😈', category: 'physical',
    blurb: 'Gets under the opposition\'s skin.', threshold: 70,
    score: (x) => x.isG ? null : (x.p.agitation ?? 50),
  },
  {
    key: 'workhorse', label: 'Workhorse', icon: '🐴', category: 'physical',
    blurb: 'Relentless motor and conditioning.', threshold: 74,
    score: (x) => x.isG ? null : (v(x.phys, 'stamina') * 0.6 + (x.p.naturalFitness ?? 50) * 0.4),
  },
  // ── Goalie ──
  {
    key: 'acrobat', label: 'Acrobat', icon: '🤸', category: 'goalie',
    blurb: 'Explosive, athletic reflexes.', threshold: 70,
    score: (x) => x.isG ? v(x.g, 'reflexes') : null,
  },
  {
    key: 'wall', label: 'The Wall', icon: '🧱', category: 'goalie',
    blurb: 'Positionally sound — rarely beaten clean.', threshold: 70,
    score: (x) => x.isG ? v(x.g, 'positioningG') : null,
  },
  {
    key: 'rebound', label: 'Rebound Killer', icon: '🧤', category: 'goalie',
    blurb: 'Swallows pucks and controls rebounds.', threshold: 70,
    score: (x) => x.isG ? v(x.g, 'reboundControl') : null,
  },
  // ── Intangible ──
  {
    key: 'leader', label: 'Leader', icon: '🅲', category: 'intangible',
    blurb: 'A leader in the room.', threshold: 72,
    score: (x) => (x.p.leadership ?? 50),
  },
  {
    key: 'raw', label: 'Raw', icon: '🌱', category: 'intangible',
    blurb: 'Big upside, far from finished.', threshold: 1,
    // Only for young players whose ceiling far outstrips current ability.
    score: (x) => {
      const cur = (v(x.c, 'scoring') + v(x.c, 'playmaking') + v(x.c, 'skating') + v(x.c, 'defensiveZone')) / 4
      const pot = x.p.basePotential ?? cur // authoritative potential (0–100)
      return x.p.age <= 20 && pot - cur >= 14 ? 60 : null
    },
  },
]

/** Up to `max` standout trait badges, strongest first. */
export function playerTraits(player: Player, max = 3): PlayerTrait[] {
  const ctx: TraitCtx = {
    p: player,
    c: player.composites as unknown as Record<string, number>,
    m: player.ratings.mental as unknown as Record<string, number>,
    phys: player.ratings.physical as unknown as Record<string, number>,
    g: (player.ratings.goalie ?? {}) as unknown as Record<string, number>,
    isF: player.position !== 'G' && player.position !== 'D',
    isD: player.position === 'D',
    isG: player.position === 'G',
  }
  const scored: Array<{ def: TraitDef; score: number }> = []
  for (const def of TRAITS) {
    const s = def.score(ctx)
    if (s !== null && s >= def.threshold) scored.push({ def, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, max).map(({ def }) => ({
    key: def.key, label: def.label, icon: def.icon, category: def.category, blurb: def.blurb,
  }))
}
