/**
 * W3 S7 — DIRECTOR CUTS, at stoppages only (W3-DESIGN item 7; SPEC §7.4).
 *
 * The live game stays on the broadcast camera. The director may cut away only
 * while the play is dead (a whistle until the drop, the goal sequence): to a
 * goal close-up, the penalised man on his way to the box, the faceoff
 * close-up, a fight close-up. A request that arrives in live play waits for
 * the next stoppage (up to `waitMs`), and every cut-away ends before the next
 * drop, so the cut back to the game is at the stoppage too. Never a cut
 * mid-play.
 *
 * THE CUT-REQUEST API (for any presenter, e.g. the fight module):
 *
 *   const r = renderer as Partial<CameraCutConsumer>
 *   r.requestCut?.({ kind: 'fight', players: [a, b], holdMs: 6000 })
 *
 * `requestCut` returns true when the cut is taken now or queued for the next
 * stoppage, false when it is declined (nobody to frame, a live request with
 * waitMs 0, or the stoppage it was queued for never came within waitMs).
 */

export type CutKind = 'goal' | 'penalty' | 'faceoff' | 'fight'

export interface CameraCutRequest {
  kind: CutKind
  /**
   * Who the shot is about (player ids): the scorer, the penalised man, the two
   * fighters (framed together). Ignored for 'faceoff'.
   */
  players?: readonly string[]
  /** A world point (ft) to frame instead (default for 'faceoff': the next faceoff dot). */
  at?: { x: number; z: number }
  /** How long the shot holds, wall ms (it still ends before the next drop). */
  holdMs: number
  /** How long a request made in live play may wait for a stoppage, wall ms (default 4000; 0 = now or never). */
  waitMs?: number
}

export interface CameraCutConsumer {
  requestCut(req: CameraCutRequest): boolean
}

/** A cut-away ends this long (game s) before the drop, so the cut back is at the stoppage. */
export const CUT_END_BEFORE_DROP_S = 0.6
export const CUT_WAIT_MS = 4000

/**
 * Where a close-up stands for a subject at (x, z) (world ft): from the
 * broadcast side (−z), a little toward centre ice, at eye level.
 */
export function closeUpPose(kind: CutKind, x: number, z: number): { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov: number } {
  const toward = x === 0 ? 0 : -Math.sign(x)
  const S = {
    faceoff: { side: 4, back: 21, y: 5.5, ly: 1.4, fov: 22 },
    fight: { side: 8, back: 24, y: 6.5, ly: 3.6, fov: 26 },
    penalty: { side: 6, back: 26, y: 7, ly: 3.4, fov: 28 },
    goal: { side: 14, back: 10, y: 5.5, ly: 3.4, fov: 30 },
  }[kind]
  // a subject on the near boards is shot from the ice side (the lens never stands in the crowd)
  const pz = z - S.back < -40 ? z + S.back * 0.9 : z - S.back
  const px = Math.max(-95, Math.min(95, x + toward * S.side))
  return { px, py: S.y, pz, lx: x, ly: S.ly, lz: z, fov: S.fov }
}
