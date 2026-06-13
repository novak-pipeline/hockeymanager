/**
 * Player Mindset — plain-English thoughts/outlook per player, derived from
 * existing sim signals. This is what the STAFF can gather, not a mind-read.
 *
 * Signal mapping:
 *   morale         → happy / unsettled / miserable
 *   form           → confident / cold streak
 *   contract       → worried about expiry / secure / loyalty discount mood
 *   role+ambition  → frustrated by limited ice time / content in featured role
 *   fatigue        → worn down / fresh
 *   locker room    → loves the room / tied with a linemate / feuding / mentoring
 *   room morale    → buoyed by team mood / concerned by low room morale
 *
 * FOG: own long-tenured player → full read; newcomer or opponent → fewer lines,
 * hedged language ("the staff sense…", "sources suggest…").
 *
 * Determinism: no Math.random / Date. All choices driven by stable hashes of
 * the playerId + signal key, so the same player always gets the same read for
 * the same underlying data.
 */

import type { Player } from '@domain'
import type { LockerRoomState, Relationship } from '@engine/league/lockerRoom'
import { knowledgeOf } from '@engine/league/scouting'
import type { ScoutingState } from '@domain/scouting'

/* ─────────────────── public shape ─────────────────── */

export type MindsetTone = 'positive' | 'neutral' | 'negative'

export interface MindsetView {
  tone: MindsetTone
  /** 1–4 plain-English lines gathered by the staff. */
  lines: string[]
  /**
   * How confident the staff are in this read.
   * 'clear'  = own long-tenured player (knowledge ≥ 70 or isOwn)
   * 'partial' = moderate knowledge (40–69)
   * 'vague'  = low knowledge (< 40) — fewer lines, hedged language
   */
  clarity: 'clear' | 'partial' | 'vague'
}

/* ─────────────────── deterministic hash ─────────────────── */

/** Stable [0, 1) hash of a string (FNV-1a, same pattern as personalityRead.ts). */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return (h % 10000) / 10000
}

/** Pick a stable item from an array using hash(seed). */
function stablePick<T>(items: T[], seed: string): T {
  const idx = Math.floor(hash01(seed) * items.length)
  return items[Math.max(0, Math.min(items.length - 1, idx))]!
}

/* ─────────────────── signal builders ─────────────────── */

interface Thought {
  tone: MindsetTone
  line: string
}

/**
 * Morale signal.
 * morale 0–35 → negative (unsettled/miserable)
 * 36–65 → neutral/mixed
 * 66–100 → positive (happy)
 */
function moraleThought(p: Player, clarity: 'clear' | 'partial' | 'vague'): Thought | null {
  const m = p.morale
  const pid = p.id as string

  if (m >= 75) {
    const lines = clarity === 'vague'
      ? ['Sources suggest the player is in a positive headspace right now.']
      : [
          'Appears to be in a genuinely happy place at the club.',
          'Morale is strong — enjoying his time here.',
          'Staff report he is settled and content.',
        ]
    return { tone: 'positive', line: stablePick(lines, pid + ':morale-high') }
  }

  if (m <= 35) {
    const lines = clarity === 'vague'
      ? ['The staff sense some underlying dissatisfaction.']
      : [
          'Staff sense some underlying unhappiness — worth monitoring.',
          'Morale appears low; could benefit from a confidence boost.',
          'There are signs of discontent that the coaching staff should address.',
        ]
    return { tone: 'negative', line: stablePick(lines, pid + ':morale-low') }
  }

  // Mid morale — only mention if notably middling (not worth a line otherwise)
  if (m <= 50) {
    if (clarity === 'vague') return null
    const lines = [
      'Seems fairly settled, though not fully at ease yet.',
      'Mood is steady — neither enthused nor disgruntled.',
    ]
    return { tone: 'neutral', line: stablePick(lines, pid + ':morale-mid') }
  }

  return null
}

/**
 * Form (hot/cold streak) signal.
 * form > 3 → on fire / confident
 * form < -3 → cold streak / confidence dip
 */
function formThought(p: Player, clarity: 'clear' | 'partial' | 'vague'): Thought | null {
  const f = p.form
  const pid = p.id as string

  if (f >= 4) {
    const lines = clarity === 'vague'
      ? ['Appears to be playing with confidence of late.']
      : [
          'Riding a hot streak and visibly energised by his recent form.',
          'Confidence is sky-high — he is in the form of his life.',
          'Staff report he is buzzing; the goals are coming easily right now.',
        ]
    return { tone: 'positive', line: stablePick(lines, pid + ':form-hot') }
  }

  if (f <= -4) {
    const lines = clarity === 'vague'
      ? ['Staff sense a slight dip in confidence.']
      : [
          'Battling a confidence dip after a difficult run of games.',
          'Working hard to shake a cold streak — needs a goal to get going.',
          'Privately frustrated by a run of near-misses; staff are keeping a close eye.',
        ]
    return { tone: 'negative', line: stablePick(lines, pid + ':form-cold') }
  }

  return null
}

/**
 * Contract signal.
 * yearsRemaining 0 → worried (UFA/RFA anxiety)
 * yearsRemaining 1 → mildly concerned
 * yearsRemaining ≥ 4 → secure, long deal
 * loyalty ≥ 15 + low salary relative to age → loyalty discount mood
 */
function contractThought(p: Player, year: number, clarity: 'clear' | 'partial' | 'vague'): Thought | null {
  const c = p.contract
  const pid = p.id as string
  const isUfa = c.yearsRemaining <= 0 && p.age >= 27
  const isRfa = c.yearsRemaining <= 0 && p.age < 27

  if (isUfa) {
    if (clarity === 'vague') {
      return { tone: 'negative', line: 'Sources suggest contract status is on his mind heading into free agency.' }
    }
    const lines = [
      'Quietly concerned about his future — heading into unrestricted free agency.',
      'Contract situation weighs on him; clubs will be circling come July.',
      'Aware that this is an important summer for his career.',
    ]
    return { tone: 'negative', line: stablePick(lines, pid + ':contract-ufa') }
  }

  if (isRfa) {
    if (clarity === 'vague') return null
    const lines = [
      'Keeping an eye on contract talks — keen to get his future sorted.',
      'RFA eligibility means negotiations will be in the background this year.',
    ]
    return { tone: 'neutral', line: stablePick(lines, pid + ':contract-rfa') }
  }

  if (c.yearsRemaining === 1) {
    if (clarity === 'vague') return null
    const lines = [
      'With one year left on his deal, contract talks will loom later in the season.',
      'Aware his contract is entering its final year — wants to perform well.',
    ]
    return { tone: 'neutral', line: stablePick(lines, pid + ':contract-expiring') }
  }

  if (c.yearsRemaining >= 4) {
    if (clarity !== 'clear') return null
    const lines = [
      `Locked in on a long-term deal through ${c.expiryYear} — fully committed to the club.`,
      'Security of a long contract means he can focus entirely on hockey.',
    ]
    // Only show this if loyalty is also high (avoids noise)
    if (p.personality.loyalty >= 14) {
      return { tone: 'positive', line: stablePick(lines, pid + ':contract-secure') }
    }
  }

  // Loyalty discount mood: high loyalty + below-market salary
  if (p.personality.loyalty >= 16 && c.salary < 3_000_000 && p.age >= 25 && clarity === 'clear') {
    return {
      tone: 'positive',
      line: 'Known to have taken below-market terms out of loyalty to the club — a genuine organisation man.',
    }
  }

  // noTradeClause — wants stability
  if (c.noTradeClause && clarity === 'clear') {
    return {
      tone: 'positive',
      line: 'The no-trade clause in his deal signals a desire to see out his career here.',
    }
  }

  // Suppress year — track expiry purely by yearsRemaining
  void year

  return null
}

/**
 * Role vs ambition signal.
 * High ambition (≥ 14) + bottom-six/depth role → frustrated
 * High ambition + top-six/featured → content but hungry
 * Low ambition (≤ 6) + any role → content, easygoing
 */
function roleThought(p: Player, clarity: 'clear' | 'partial' | 'vague'): Thought | null {
  const amb = p.personality.ambition
  const pid = p.id as string
  const role = p.role.toLowerCase()

  // Detect "limited" role keywords
  const isLimitedRole =
    role.includes('fourth') ||
    role.includes('depth') ||
    role.includes('checking') ||
    role.includes('bottom') ||
    role.includes('third-pair') ||
    role.includes('backup')

  const isFeaturedRole =
    role.includes('top') ||
    role.includes('first') ||
    role.includes('second') ||
    role.includes('power') ||
    role.includes('starter') ||
    role.includes('number one')

  if (amb >= 14 && isLimitedRole) {
    const lines = clarity === 'vague'
      ? ['The staff sense ambition that the current role may not fully satisfy.']
      : [
          'Frustrated by his limited role — believes he is capable of more.',
          'A highly ambitious player who wants a bigger opportunity.',
          'Staff detect a hunger for more ice time that his current role does not satisfy.',
        ]
    return { tone: 'negative', line: stablePick(lines, pid + ':role-frustrated') }
  }

  if (amb >= 14 && isFeaturedRole) {
    if (clarity === 'vague') return null
    const lines = [
      'Thriving in a featured role — exactly the kind of opportunity he craves.',
      'Loving the responsibility of a top role; ambition is matched by his deployment.',
    ]
    return { tone: 'positive', line: stablePick(lines, pid + ':role-featured') }
  }

  if (amb <= 6 && clarity === 'clear') {
    const lines = [
      'An easygoing character who seems genuinely content in whatever role he is given.',
      'Low-maintenance — adapts without complaint to however the coaching staff use him.',
    ]
    return { tone: 'positive', line: stablePick(lines, pid + ':role-content') }
  }

  return null
}

/**
 * Fatigue signal.
 * fatigue ≥ 75 → worn down
 * fatigue ≤ 20 → fresh
 */
function fatigueThought(p: Player, clarity: 'clear' | 'partial' | 'vague'): Thought | null {
  const f = p.fatigue
  const pid = p.id as string

  if (f >= 75) {
    if (clarity === 'vague') return null
    const lines = [
      'Staff note that accumulated fatigue is beginning to show — may need a rest.',
      'Worn down by a heavy schedule; a game off could help refresh him.',
    ]
    return { tone: 'negative', line: stablePick(lines, pid + ':fatigue-high') }
  }

  if (f <= 15) {
    if (clarity !== 'clear') return null
    return {
      tone: 'positive',
      line: 'Fully rested and ready — condition staff report he is in peak physical shape.',
    }
  }

  return null
}

/**
 * Locker-room relationship signal.
 * Pulls the strongest relationship for this player from the locker room.
 * Named relationships make the read much richer.
 */
function lockerRoomThought(
  p: Player,
  lr: LockerRoomState | null,
  getPlayerName: (id: string) => string | null,
  clarity: 'clear' | 'partial' | 'vague'
): Thought | null {
  if (!lr) return null
  const pid = p.id as string

  // Find relationships involving this player, strongest first
  const relevant = lr.relationships
    .filter((r) => r.a === pid || r.b === pid)
    .sort((a, b) => b.strength - a.strength)

  const best = relevant[0]

  if (!best) {
    // Check if player is captain / alternate — mention leadership role
    if (lr.captainId === pid && clarity === 'clear') {
      return { tone: 'positive', line: 'Leading the room as club captain — a responsibility he embraces.' }
    }
    if (lr.alternateIds.includes(pid) && clarity === 'clear') {
      return { tone: 'positive', line: 'Wearing an alternate captaincy — respected within the group.' }
    }

    // High room morale — player benefits even without a named relationship
    if (lr.roomMorale >= 75 && clarity !== 'vague') {
      return {
        tone: 'positive',
        line: 'The strong team atmosphere is having a positive effect on his outlook.',
      }
    }

    if (lr.roomMorale <= 35 && clarity !== 'vague') {
      return {
        tone: 'negative',
        line: 'The difficult team atmosphere has not gone unnoticed.',
      }
    }

    return null
  }

  const partnerId = best.a === pid ? best.b : best.a
  const partnerName = getPlayerName(partnerId)

  if (best.kind === 'feud') {
    if (clarity === 'vague') {
      return {
        tone: 'negative',
        line: 'Staff sense some tension within the group involving this player.',
      }
    }
    const lines = partnerName
      ? [
          `Ongoing friction with ${partnerName} — staff are managing the relationship carefully.`,
          `Bad blood with ${partnerName} is a dynamic the coaching staff need to keep an eye on.`,
        ]
      : ['In a fractious relationship with a teammate — coaches are aware.']
    return { tone: 'negative', line: stablePick(lines, pid + ':feud') }
  }

  if (best.kind === 'mentorship') {
    const isMentor = best.a === pid
    if (clarity === 'vague') return null

    if (isMentor) {
      const lines = partnerName
        ? [
            `Has taken ${partnerName} under his wing — a natural leader in the room.`,
            `Mentoring ${partnerName} and clearly enjoying the responsibility.`,
          ]
        : ['Taking an active mentoring role with a younger teammate — speaks well of his character.']
      return { tone: 'positive', line: stablePick(lines, pid + ':mentor') }
    } else {
      const lines = partnerName
        ? [
            `Benefiting greatly from ${partnerName}'s guidance — a valuable relationship for his development.`,
            `The mentorship from ${partnerName} is clearly having a positive impact.`,
          ]
        : ['A veteran mentorship is helping him settle and develop.']
      return { tone: 'positive', line: stablePick(lines, pid + ':protege') }
    }
  }

  // friendship
  if (best.kind === 'friendship') {
    if (clarity === 'vague') return null
    const lines = partnerName
      ? [
          `Tight with ${partnerName} — one of the stronger bonds in the room.`,
          `A close friendship with ${partnerName} is a big part of why he feels at home here.`,
          `Staff note a strong personal connection with ${partnerName}.`,
        ]
      : ['Has built real friendships in the group — a popular figure in the room.']
    return { tone: 'positive', line: stablePick(lines, pid + ':friend') }
  }

  return null
}

/**
 * Room morale ambient signal (if no relationship thought was emitted).
 */
function roomMoraleThought(
  p: Player,
  lr: LockerRoomState | null,
  clarity: 'clear' | 'partial' | 'vague'
): Thought | null {
  if (!lr || clarity === 'vague') return null
  const pid = p.id as string

  if (lr.roomMorale >= 80) {
    return {
      tone: 'positive',
      line: stablePick([
        'The buoyant team spirit is clearly infectious.',
        'Loves the atmosphere in the room right now.',
        'Energised by a happy, tight-knit group.',
      ], pid + ':room-high'),
    }
  }

  if (lr.roomMorale <= 30) {
    return {
      tone: 'negative',
      line: stablePick([
        'The difficult atmosphere in the room is weighing on him.',
        'Concerned by the mood in the group — not an easy environment right now.',
      ], pid + ':room-low'),
    }
  }

  return null
}

/* ─────────────────── assembly ─────────────────── */

/**
 * Derive the clarity tier from knowledge/ownership.
 * isOwn: player is on the user's roster (no fog needed; full read).
 * knowledge: scouting knowledge 0–100 (only relevant if !isOwn).
 */
function clarityTier(isOwn: boolean, knowledge: number): 'clear' | 'partial' | 'vague' {
  if (isOwn) return 'clear'
  if (knowledge >= 70) return 'clear'
  if (knowledge >= 40) return 'partial'
  return 'vague'
}

/**
 * Overall tone from an array of thoughts (majority-vote with negative bias).
 */
function overallTone(thoughts: Thought[]): MindsetTone {
  if (thoughts.length === 0) return 'neutral'
  const pos = thoughts.filter((t) => t.tone === 'positive').length
  const neg = thoughts.filter((t) => t.tone === 'negative').length
  // negative bias: tie goes negative
  if (neg > 0 && neg >= pos) return 'negative'
  if (pos > neg) return 'positive'
  return 'neutral'
}

export interface MindsetCtx {
  /** Current season year — used for contract expiry framing. */
  year: number
  /** Locker room state for the team this player is on. Null if not on any team. */
  lockerRoom: LockerRoomState | null
  /**
   * Resolve a player name by id — used to name linemates in locker-room thoughts.
   * Returns null if the player is not found.
   */
  getPlayerName: (id: string) => string | null
  /**
   * True when the player is on the user's own roster (no fog — full read).
   * False for scouted / opponent players.
   */
  isOwn: boolean
  /**
   * Scouting state — only needed when isOwn = false.
   * When isOwn = true, pass undefined.
   */
  scouting?: ScoutingState
}

/**
 * Generate a mindset view for one player.
 *
 * Deterministic: driven by stable hashes of playerId + signal keys.
 * No Math.random / Date / Rng calls.
 */
export function buildMindset(p: Player, ctx: MindsetCtx): MindsetView {
  const pid = p.id as string

  // Determine clarity from fog
  let knowledge = 100
  if (!ctx.isOwn && ctx.scouting) {
    knowledge = knowledgeOf(ctx.scouting, pid)
  }
  const clarity = clarityTier(ctx.isOwn, knowledge)

  // Collect candidate thoughts from each signal
  const candidates: Thought[] = []

  const maybeAdd = (t: Thought | null): void => {
    if (t) candidates.push(t)
  }

  maybeAdd(moraleThought(p, clarity))
  maybeAdd(formThought(p, clarity))
  maybeAdd(roleThought(p, clarity))
  maybeAdd(contractThought(p, ctx.year, clarity))
  maybeAdd(fatigueThought(p, clarity))

  // Locker-room thought (names a relationship if available)
  const lrThought = lockerRoomThought(p, ctx.lockerRoom, ctx.getPlayerName, clarity)
  maybeAdd(lrThought)

  // If no locker-room relationship was named, optionally add room morale ambient
  if (!lrThought) {
    maybeAdd(roomMoraleThought(p, ctx.lockerRoom, clarity))
  }

  // Cap at 4 lines; prefer variety (1 per category, sorted by signal priority)
  // Already gathered in priority order — just take first 4
  const lines = candidates.slice(0, 4).map((t) => t.line)

  // Vague: cap at 1 line for opponent players with low knowledge
  const cappedLines = clarity === 'vague' ? lines.slice(0, 1) : lines

  // Fallback for zero lines (unknown player, no data)
  if (cappedLines.length === 0) {
    return {
      tone: 'neutral',
      lines: clarity === 'vague'
        ? ['The staff have limited information on this player at this stage.']
        : ['Nothing of particular note to report on this player at present.'],
      clarity,
    }
  }

  return {
    tone: overallTone(candidates.slice(0, 4)),
    lines: cappedLines,
    clarity,
  }
}
