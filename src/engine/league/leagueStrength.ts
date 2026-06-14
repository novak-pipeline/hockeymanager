/**
 * League strength & NHL-equivalency (NHLe).
 *
 * In the multi-league world a prospect can rack up points in the OHL, NCAA, KHL,
 * Liiga, AHL, ECHL, etc. Raw production isn't comparable across those leagues —
 * a point-per-game in a junior league is worth far less than one in the KHL,
 * which is worth less than one in the NHL. To judge development fairly we
 * translate every league's output to an **NHL-equivalent** rate via a per-league
 * factor, the long-established NHLe approach (Desjardins / Vollman-style league
 * translation coefficients).
 *
 * Consumers:
 *  - The importer tags each imported competition with a strength descriptor.
 *  - Development (`developPlayers` / in-season dev) divides a prospect's NHL-
 *    equivalent production by his NHL expectation, so dominating a *strong*
 *    league as a teenager drives real growth + a ceiling boom, while padding
 *    stats in a *weak* league is correctly discounted. This is the mechanism
 *    behind "performance in obscure leagues still factors into development."
 *
 * The factor is in (0, 1]; the NHL is the 1.0 baseline (nothing translates up).
 */

/** What the engine needs to score a league's strength. */
export interface LeagueStrength {
  /** Division level within its nation: 1 = top tier, 2 = second, 3 = third… */
  level: number
  /** EHM league reputation (~0–20 scale; higher = stronger competition). */
  reputation: number
  /** League abbreviation (e.g. "NHL", "OHL", "KHL") for accurate named anchors. */
  abbrev?: string
  /** League full name — a secondary keyword source when the abbrev is unknown. */
  name?: string
}

/**
 * Published-style NHL-equivalency coefficients for the leagues that matter to an
 * NHL pipeline. Forwards' approximate translation factors; defensemen/goalies use
 * the same league factor (position is handled separately in expectations). These
 * are the accurate anchors — anything not listed falls back to the reputation
 * curve below.
 */
const NHLE_BY_ABBREV: Record<string, number> = {
  NHL: 1.0,
  KHL: 0.78,
  SHL: 0.57, // Swedish Hockey League
  NL: 0.5, // Swiss National League
  LIIGA: 0.54, // Finnish Liiga
  'DEL': 0.45, // German DEL
  EXTRALIGA: 0.5, // Czech Extraliga (approx)
  AHL: 0.44,
  VHL: 0.35, // Russian second tier
  NCAA: 0.4,
  MESTIS: 0.3, // Finnish 2nd tier
  ECHL: 0.27,
  OHL: 0.3,
  WHL: 0.29,
  QMJHL: 0.26, // a.k.a. LHJMQ / QMJHL
  USHL: 0.19,
  J20: 0.15, // Swedish/Finnish U20
}

/** Name keywords → abbrev key, for leagues whose abbrev doesn't match cleanly. */
const NAME_KEYWORDS: Array<[RegExp, string]> = [
  [/national hockey league/i, 'NHL'],
  [/kontinental|\bKHL\b/i, 'KHL'],
  [/swedish hockey/i, 'SHL'],
  [/\bliiga\b/i, 'LIIGA'],
  [/american hockey/i, 'AHL'],
  [/\bECHL\b/i, 'ECHL'],
  [/ontario hockey/i, 'OHL'],
  [/western hockey/i, 'WHL'],
  [/quebec|lhjmq|maritimes/i, 'QMJHL'],
  [/united states hockey|\bUSHL\b/i, 'USHL'],
  [/\bNCAA\b|college/i, 'NCAA'],
  [/national league|\bNL\b/i, 'NL'],
  [/extraliga/i, 'EXTRALIGA'],
  [/mestis/i, 'MESTIS'],
]

/**
 * Reputation → NHLe fallback for leagues not in the named table. Fit so the
 * EHM ~0–20 reputation scale lands near the named anchors (rep 20 ≈ 1.0,
 * 17 ≈ 0.57, 15 ≈ 0.44, 13 ≈ 0.28, 11 ≈ 0.18). A power curve captures the
 * steep drop-off from the NHL down through the minors.
 */
function reputationFactor(reputation: number): number {
  const r = Math.max(0, Math.min(20, reputation)) / 20
  return clampFactor(Math.pow(r, 3.4))
}

function clampFactor(f: number): number {
  return Math.max(0.1, Math.min(1, f))
}

/** Resolve a named anchor from abbrev or name keywords, or undefined. */
function namedFactor(s: LeagueStrength): number | undefined {
  if (s.abbrev) {
    const key = s.abbrev.trim().toUpperCase()
    if (key in NHLE_BY_ABBREV) return NHLE_BY_ABBREV[key]
  }
  if (s.name) {
    for (const [re, key] of NAME_KEYWORDS) {
      if (re.test(s.name)) return NHLE_BY_ABBREV[key]
    }
  }
  return undefined
}

/**
 * NHL-equivalency factor for a league, in (0, 1]. Uses an accurate named anchor
 * when the league is recognised, otherwise a reputation-derived fallback,
 * nudged down for lower division levels (a nation's 2nd tier is weaker than its
 * 1st even at similar reputation).
 */
export function leagueTranslationFactor(s: LeagueStrength): number {
  const named = namedFactor(s)
  if (named !== undefined) return named
  let f = reputationFactor(s.reputation)
  // Each division level below the top shaves strength a little.
  if (s.level >= 2) f *= Math.pow(0.85, s.level - 1)
  return clampFactor(f)
}

/** Translate raw production to an NHL-equivalent rate. */
export function nhlEquivalent(value: number, factor: number): number {
  return value * factor
}

/** NHLe factor for a league abbreviation alone (board rows carry only abbrev).
 *  Falls back to a junior-ish 0.30 for unrecognised leagues. */
export function nhleFactorByAbbrev(abbrev: string): number {
  const key = (abbrev || '').trim().toUpperCase()
  return NHLE_BY_ABBREV[key] ?? 0.30
}
