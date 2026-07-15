/**
 * AI GM personas — Living World LW2 (docs/LIVING-WORLD.md).
 *
 * Every AI club gets a NAMED general manager with a persistent personality:
 * trait axes that will drive trade initiation, free-agency style, draft
 * philosophy and deadline behaviour (wired in LW3). The league becomes a cast
 * of characters — "Marcus Webb always overpays at the deadline" — instead of
 * 31 copies of the same logic.
 *
 * Pure + deterministic: personas derive from (seed, teamId) so the same career
 * always meets the same GMs; state is JSON-safe and persisted in the snapshot
 * so names/styles never drift mid-save.
 */
import { Rng, deriveSeed } from '@engine/shared/rng'
import { FIRST_NAMES, LAST_NAMES } from '@data/names'

/* ────────────────────────── types ────────────────────────── */

export interface GmPersona {
  /** Stable id: `gm-${teamId}`. */
  id: string
  teamId: string
  name: string
  /** Trait axes, 0–1. 0.5 is league-average. */
  aggression: number     // initiation frequency + overpay willingness
  patience: number       // resists panic moves, tolerates long rebuilds
  riskTolerance: number  // boom/bust prospects, variance in offers
  pickHoarding: number   // values draft capital above the curve
  loyalty: number        // resists trading own draftees, re-signs veterans
  capDiscipline: number  // avoids cap tightness, prizes contract surplus
  analyticsLean: number  // 0 = old-school scout gut, 1 = model-driven
  /** Short public reputation used by news ("aggressive win-now dealer"). */
  styleLabel: string
  /** Year he took the job (for tenure references). */
  sinceYear: number
}

/** A club's seasonal stance — recomputed from roster shape, not hand-set. */
export type PostureKind = 'contend' | 'retool' | 'rebuild'

export interface ClubPosture {
  posture: PostureKind
  /** One factual line explaining the read ("aging core, bottom-third strength"). */
  reason: string
}

/** [teamId, persona] — snapshot-friendly. */
export type GmPersonaState = Array<[string, GmPersona]>

/* ────────────────────────── generation ────────────────────────── */

const GM_NS = 8311

/** Deterministically build the persona for one club. */
export function buildGmPersona(args: {
  seed: number
  teamId: string
  year: number
  /** Names already in use (coaches etc.) so the GM doesn't collide. */
  takenNames?: ReadonlySet<string>
}): GmPersona {
  const rng = new Rng(deriveSeed(args.seed, GM_NS, hashId(args.teamId)))
  let name = `${FIRST_NAMES[rng.int(FIRST_NAMES.length)]!} ${LAST_NAMES[rng.int(LAST_NAMES.length)]!}`
  for (let i = 0; args.takenNames?.has(name) && i < 20; i++) {
    name = `${FIRST_NAMES[rng.int(FIRST_NAMES.length)]!} ${LAST_NAMES[rng.int(LAST_NAMES.length)]!}`
  }
  const axis = (): number => Math.round(rng.float(0.08, 0.92) * 100) / 100
  const persona: GmPersona = {
    id: `gm-${args.teamId}`,
    teamId: args.teamId,
    name,
    aggression: axis(),
    patience: axis(),
    riskTolerance: axis(),
    pickHoarding: axis(),
    loyalty: axis(),
    capDiscipline: axis(),
    analyticsLean: axis(),
    styleLabel: '',
    sinceYear: args.year,
  }
  persona.styleLabel = styleLabel(persona)
  return persona
}

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

/** Human-readable style from the two most extreme axes. */
export function styleLabel(p: GmPersona): string {
  const traits: Array<{ v: number; hi: string; lo: string }> = [
    { v: p.aggression, hi: 'aggressive dealer', lo: 'cautious operator' },
    { v: p.pickHoarding, hi: 'draft-capital hoarder', lo: 'picks-for-players trader' },
    { v: p.loyalty, hi: 'loyal to his own', lo: 'sentiment-free mover' },
    { v: p.capDiscipline, hi: 'cap surgeon', lo: 'cap gambler' },
    { v: p.analyticsLean, hi: 'analytics believer', lo: 'old-school scout' },
    { v: p.riskTolerance, hi: 'swing-for-the-fences type', lo: 'floor-over-ceiling type' },
  ]
  // Most extreme axis defines the label; second-most adds colour when strong.
  const scored = traits
    .map((t) => ({ label: t.v >= 0.5 ? t.hi : t.lo, extremity: Math.abs(t.v - 0.5) }))
    .sort((a, b) => b.extremity - a.extremity)
  const first = scored[0]!
  const second = scored[1]!
  return second.extremity > 0.3 ? `${first.label}, ${second.label}` : first.label
}

/* ────────────────────────── club posture ────────────────────────── */

/**
 * Derive a club's competitive stance from observable roster facts.
 * Inputs are precomputed by the career layer so this stays pure.
 */
export function deriveClubPosture(args: {
  /** Average age of the club's top-6 by overall ("the core"). */
  coreAge: number
  /** 1 = strongest roster in the league. */
  strengthRank: number
  teamCount: number
}): ClubPosture {
  const third = args.teamCount / 3
  const strongThird = args.strengthRank <= third
  const weakThird = args.strengthRank > args.teamCount - third
  if (strongThird) {
    return {
      posture: 'contend',
      reason: args.coreAge >= 30
        ? 'top-third roster with an aging core — the window is now'
        : 'top-third roster in its prime',
    }
  }
  if (weakThird) {
    return args.coreAge >= 29
      ? { posture: 'rebuild', reason: 'bottom-third strength and an old core — time to tear down' }
      : { posture: 'rebuild', reason: 'bottom-third strength, accumulating young assets' }
  }
  if (args.coreAge >= 31) {
    return { posture: 'retool', reason: 'mid-pack with an aging core — retooling on the fly' }
  }
  return { posture: 'retool', reason: 'mid-pack, keeping options open' }
}

/* ────────────────────────── future wiring (LW3) ────────────────────────── */

/**
 * Map persona + posture onto the existing trade-AI philosophy enum.
 * NOT wired yet — LW3 swaps the hash-based teamPhilosophy for this, with its
 * own behaviour tests. Exported now so the mapping is designed alongside the
 * persona and stays stable.
 */
export function personaPhilosophy(
  p: GmPersona,
  posture: PostureKind
): 'WinNow' | 'FavorYoung' | 'RebuildProspects' | 'RebuildDraft' | 'Balanced' {
  if (posture === 'contend') return p.aggression >= 0.4 ? 'WinNow' : 'Balanced'
  if (posture === 'rebuild') return p.pickHoarding >= 0.5 ? 'RebuildDraft' : 'RebuildProspects'
  return p.analyticsLean >= 0.6 || p.riskTolerance >= 0.6 ? 'FavorYoung' : 'Balanced'
}
