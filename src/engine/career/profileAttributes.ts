/**
 * The attributes exactly as the player profile shows them: EHM-style 1–20
 * values under the profile's own names and groups. One source for the profile
 * view (buildViews), the profile screen and the player search's attribute
 * filter, so a filter for "Checking ≥ 14" can never disagree with the 14 the
 * profile prints.
 */

/** The profile's attribute groups: [raw rating key, label] per group, in the
 *  profile's order. `source` names the RawAttributes group the keys live in. */
export const PROFILE_ATTRIBUTE_GROUPS: ReadonlyArray<{
  name: string
  source: 'technical' | 'physical' | 'mental' | 'defensive' | 'goalie'
  attributes: ReadonlyArray<readonly [key: string, label: string]>
}> = [
  { name: 'Technical', source: 'technical', attributes: [
    ['wristShot', 'Wrist shot'],
    ['slapShot', 'Slap shot'],
    ['stickhandling', 'Stickhandling'],
    ['passing', 'Passing'],
    ['deflections', 'Deflections'],
    ['faceoffs', 'Faceoffs'],
  ] },
  { name: 'Physical', source: 'physical', attributes: [
    ['speed', 'Speed'],
    ['acceleration', 'Acceleration'],
    ['strength', 'Strength'],
    ['balance', 'Balance'],
    ['stamina', 'Stamina'],
    ['agility', 'Agility'],
    ['height', 'Height'],
  ] },
  { name: 'Mental', source: 'mental', attributes: [
    ['offensiveIQ', 'Offensive IQ'],
    ['defensiveIQ', 'Defensive IQ'],
    ['positioning', 'Positioning'],
    ['vision', 'Vision'],
    ['aggression', 'Aggression'],
    ['composure', 'Composure'],
    ['workRate', 'Work rate'],
    ['discipline', 'Discipline'],
    ['anticipation', 'Anticipation'],
  ] },
  { name: 'Defensive', source: 'defensive', attributes: [
    ['checking', 'Checking'],
    ['shotBlocking', 'Shot blocking'],
    ['stickChecking', 'Stick checking'],
    ['takeaway', 'Takeaways'],
  ] },
  { name: 'Goaltending', source: 'goalie', attributes: [
    ['reflexes', 'Reflexes'],
    ['positioningG', 'Positioning'],
    ['reboundControl', 'Rebound control'],
    ['glove', 'Glove'],
    ['blocker', 'Blocker'],
    ['recovery', 'Recovery'],
    ['puckHandlingG', 'Puck handling'],
  ] },
]

/** 0–99 rating → the profile's 1–20: round(v/5), clamped. */
export function to20(v: number): number {
  return Math.max(1, Math.min(20, Math.round(v / 5)))
}

const BY_KEY = new Map<string, { group: string; source: string; label: string }>()
for (const g of PROFILE_ATTRIBUTE_GROUPS) {
  for (const [key, label] of g.attributes) BY_KEY.set(key, { group: g.name, source: g.source, label })
}

/** The profile's label for an attribute key; a goalie attribute whose name
 *  repeats a skater one ("Positioning") is marked "(G)" so a chip or column
 *  header can't be read as the other. */
export function profileAttributeLabel(key: string): string {
  const hit = BY_KEY.get(key)
  if (!hit) return key
  if (hit.source === 'goalie') {
    for (const [k, v] of BY_KEY) if (k !== key && v.source !== 'goalie' && v.label === hit.label) return `${hit.label} (G)`
  }
  return hit.label
}

/** Which RawAttributes group holds a key (undefined for an unknown key). */
export function profileAttributeSource(key: string): string | undefined {
  return BY_KEY.get(key)?.source
}
