/**
 * Personality archetype — a single plain-English "type" derived from a player's
 * 1–20 personality traits (+ optional EHM leadership/pressure). This is the
 * headline character read FM shows: "Born Leader", "Mercenary", "Model
 * Professional", etc. Pure and deterministic; no Rng, no Date.
 *
 * Visibility: the archetype is only as trustworthy as the underlying traits,
 * which are fogged by scouting. The career layer decides whether to show it
 * (own player / high knowledge) — this module just computes it from raw values.
 */

import type { Player } from '@domain'

export interface PersonalityArchetype {
  key: string
  /** Headline label, e.g. "Born Leader". */
  label: string
  /** One-line plain-English description of how the player carries himself. */
  blurb: string
}

function trait(p: Player, key: keyof Player['personality']): number {
  const v = p.personality[key]
  return Math.max(1, Math.min(20, v ?? 10))
}

/** Leadership on a 1–20 feel: prefers the EHM 1–99 rating, else a trait proxy. */
function leadership20(p: Player): number {
  if (p.leadership !== undefined) return Math.max(1, Math.min(20, Math.round(p.leadership / 5)))
  const { professionalism, loyalty, determination } = p.personality
  return Math.max(1, Math.min(20, Math.round((professionalism + loyalty + determination) / 3)))
}

/**
 * Derive the player's dominant personality archetype. Checks run in priority
 * order — the first match wins — so the strongest signal defines the character.
 */
export function personalityArchetype(p: Player): PersonalityArchetype {
  const ambition = trait(p, 'ambition')
  const professionalism = trait(p, 'professionalism')
  const loyalty = trait(p, 'loyalty')
  const temperament = trait(p, 'temperament')
  const determination = trait(p, 'determination')
  const lead = leadership20(p)
  const pressure = p.pressure !== undefined ? Math.max(1, Math.min(20, p.pressure)) : null

  // 1. Born leader — commands the room.
  if (lead >= 16 || (professionalism >= 15 && determination >= 15 && loyalty >= 13)) {
    return {
      key: 'leader',
      label: 'Born Leader',
      blurb: 'A natural leader who sets the tone and earns the room’s respect.',
    }
  }

  // 2. Volatile — can boil over.
  if (temperament <= 6) {
    return {
      key: 'volatile',
      label: 'Volatile',
      blurb: 'Emotional and quick-tempered — capable of brilliance and blow-ups alike.',
    }
  }

  // 3. Mercenary — chases the move and the money.
  if (loyalty <= 5 && ambition >= 14) {
    return {
      key: 'mercenary',
      label: 'Mercenary',
      blurb: 'Ambitious and rootless; his loyalty lasts only as long as the situation suits him.',
    }
  }

  // 4. Model professional — does everything right.
  if (professionalism >= 17) {
    return {
      key: 'modelPro',
      label: 'Model Professional',
      blurb: 'Impeccable habits on and off the ice; a steadying influence on younger players.',
    }
  }

  // 5. Driven winner — relentless ambition.
  if (ambition >= 16 && determination >= 15) {
    return {
      key: 'drivenWinner',
      label: 'Driven Winner',
      blurb: 'Fiercely ambitious and relentless; hates losing more than he loves winning.',
    }
  }

  // 6. Big-game player — thrives under pressure (needs a known pressure read).
  if (pressure !== null && pressure >= 17) {
    return {
      key: 'bigGame',
      label: 'Big-Game Player',
      blurb: 'Rises to the occasion — the bigger the moment, the calmer he gets.',
    }
  }

  // 7. Loyal servant — wedded to the club.
  if (loyalty >= 17) {
    return {
      key: 'loyalServant',
      label: 'Loyal Servant',
      blurb: 'Deeply loyal; the kind of player who’d retire in your colours.',
    }
  }

  // 8. Relentless worker — outworks his talent.
  if (determination >= 15 && professionalism >= 13) {
    return {
      key: 'worker',
      label: 'Relentless Worker',
      blurb: 'Grafts harder than anyone; makes the most of every ounce of ability.',
    }
  }

  // 9. Laid-back — happy where he is.
  if (ambition <= 6 && temperament >= 14) {
    return {
      key: 'laidBack',
      label: 'Laid-Back',
      blurb: 'Easygoing and content; rarely rocks the boat or chases more.',
    }
  }

  // Default — no single trait dominates.
  return {
    key: 'balanced',
    label: 'Balanced Character',
    blurb: 'A level-headed personality with no extremes either way.',
  }
}
