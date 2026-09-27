/**
 * Screen-space name-label de-confliction, shared by both renderers (3D E1 /
 * F-18, 2D F-21). Pure and DOM-free.
 *
 * Every label asks for a spot centred above its anchor (the player's head in
 * 3D, the top of his disc in 2D). Labels are placed greedily in priority order
 * (the puck carrier first); a label that would overlap one already placed
 * tries the alternative spots it was given (nudged up, flipped below the body,
 * slid sideways), and is DROPPED if none is free — a missing name beats an
 * unreadable pile of them. Rects are clamped inside the viewport.
 */

export interface LabelRequest {
  key: string
  /** Anchor in px: the label's default spot is centred on x, bottom edge at y. */
  x: number
  y: number
  w: number
  h: number
  /** Higher places first (and so wins the free spot). */
  priority: number
  /**
   * Alternative offsets (px, applied to the default rect) tried in order when
   * the default spot is taken. Defaults to a nudge up, then either side.
   */
  alternatives?: ReadonlyArray<{ dx: number; dy: number }>
}

export interface PlacedLabel {
  key: string
  /** Top-left corner of the placed rect (px). */
  left: number
  top: number
  w: number
  h: number
  /** Offset from the default spot (0,0 = where it asked to be). */
  dx: number
  dy: number
}

export function defaultAlternatives(w: number, h: number, gap = 2): Array<{ dx: number; dy: number }> {
  return [
    { dx: 0, dy: -(h + gap) },
    { dx: -(w / 2 + gap), dy: -(h / 2 + gap) },
    { dx: w / 2 + gap, dy: -(h / 2 + gap) },
    { dx: 0, dy: -2 * (h + gap) },
  ]
}

function overlaps(a: PlacedLabel, b: PlacedLabel, pad: number): boolean {
  return a.left < b.left + b.w + pad && b.left < a.left + a.w + pad && a.top < b.top + b.h + pad && b.top < a.top + a.h + pad
}

export function layoutLabels(
  reqs: ReadonlyArray<LabelRequest>,
  bounds: { w: number; h: number },
  pad = 1,
): PlacedLabel[] {
  const order = [...reqs].sort((a, b) => b.priority - a.priority)
  const placed: PlacedLabel[] = []
  for (const r of order) {
    const base = { left: r.x - r.w / 2, top: r.y - r.h }
    const tries = [{ dx: 0, dy: 0 }, ...(r.alternatives ?? defaultAlternatives(r.w, r.h))]
    for (const t of tries) {
      const left = Math.max(0, Math.min(bounds.w - r.w, base.left + t.dx))
      const top = Math.max(0, Math.min(bounds.h - r.h, base.top + t.dy))
      const cand: PlacedLabel = { key: r.key, left, top, w: r.w, h: r.h, dx: left - base.left, dy: top - base.top }
      if (!placed.some((p) => overlaps(p, cand, pad))) {
        placed.push(cand)
        break
      }
    }
  }
  return placed
}
