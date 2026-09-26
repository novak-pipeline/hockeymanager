/**
 * Kit palette — derives a believable hockey uniform from ONE team color.
 * Pure (no THREE) so it is unit-testable.
 *
 * NHL convention: the home side wears its dark (color) sweater, the visitors
 * wear WHITE with team-color trim. That is also the single biggest readability
 * win in a 3D view — two teams never read as two similar hues.
 */

export interface Kit {
  /** Sweater body color. */
  jersey: number
  /** Stripe / trim color on hem, sleeves and socks. */
  trim: number
  /** Second (thin) stripe color. */
  trim2: number
  /** Number fill color on the sweater. */
  number: number
  /** Number outline color. */
  numberOutline: number
  /** Breezers (pants) color. */
  pants: number
  /** Helmet shell color. */
  helmet: number
  /** Gloves color. */
  gloves: number
  /** Sock base color. */
  socks: number
}

const WHITE = 0xf4f4f2

export function rgb(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255]
}

export function fromRgb(r: number, g: number, b: number): number {
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return (cl(r) << 16) | (cl(g) << 8) | cl(b)
}

/** Relative luminance 0..1 (sRGB-ish weights, gamma ignored — good enough for picking contrast). */
export function luminance(c: number): number {
  const [r, g, b] = rgb(c)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** Scale a color toward black (f < 1) — per-channel, never produces channel bleed. */
export function shade(c: number, f: number): number {
  const [r, g, b] = rgb(c)
  return fromRgb(r * f, g * f, b * f)
}

/** Mix two colors (t = 0 → a, t = 1 → b). */
export function mix(a: number, b: number, t: number): number {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  return fromRgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

/** Dark "equipment" tone of a team color: pants/helmet/gloves. */
function equipmentTone(c: number): number {
  // Bright colors (yellow, light blue) get a much deeper shade so the
  // breezers still read as breezers; dark colors get only a slight drop.
  const l = luminance(c)
  return shade(c, l > 0.45 ? 0.32 : l > 0.25 ? 0.5 : 0.7)
}

/**
 * Build the kit for one side.
 * @param color team primary color (0xRRGGBB)
 * @param side  'home' → dark sweater, 'away' → white sweater with color trim
 */
export function kitFor(color: number, side: 'home' | 'away'): Kit {
  const eq = equipmentTone(color)
  if (side === 'away') {
    return {
      jersey: WHITE,
      trim: color,
      trim2: eq,
      number: color,
      numberOutline: eq,
      pants: eq,
      helmet: eq,
      gloves: eq,
      socks: WHITE,
    }
  }
  const light = luminance(color) > 0.55
  return {
    jersey: color,
    trim: light ? eq : WHITE,
    trim2: light ? WHITE : eq,
    number: light ? eq : WHITE,
    numberOutline: light ? WHITE : eq,
    pants: eq,
    helmet: eq,
    gloves: eq,
    socks: color,
  }
}

/** CSS hex string for canvas painting. */
export function css(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`
}
