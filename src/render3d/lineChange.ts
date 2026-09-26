/**
 * Persistent player↔rig binding for the 3D renderer.
 *
 * The timeline hands over skaters by SLOT index, and the player in a slot
 * changes on every line change (~160 times a game). Binding a rig to a slot made
 * the rig fly across the ice to wherever the incoming player was. Rigs are bound
 * to PLAYERS instead: a player who leaves the ice keeps his rig while he skates
 * to the bench gate, and a player who comes on gets a free rig that skates out
 * from the gate. Pure and unit-tested; the renderer owns the movement.
 */

export type RigMode = 'idle' | 'play' | 'arriving' | 'departing'

export interface RigSlot {
  id: string | null
  mode: RigMode
}

export interface Assignment {
  /** Per rig: index into `ids` it follows this frame, or -1 (idle or departing). */
  follow: number[]
  /** Rigs newly bound to a player this frame. */
  entered: number[]
  /** Rigs whose player left the ice this frame. */
  left: number[]
}

/**
 * Bind the on-ice `ids` to rigs, keeping every existing binding stable.
 * A new player takes an idle rig first; if none is idle he takes the departing
 * rig that has been leaving longest (`departOrder`, lower = older). Mutates
 * `slots` (ids/modes) so the caller only needs to apply the movement.
 */
export function assignRigs(
  slots: RigSlot[],
  ids: ReadonlyArray<string | undefined>,
  departOrder: ReadonlyArray<number> = [],
): Assignment {
  const follow = new Array<number>(slots.length).fill(-1)
  const entered: number[] = []
  const left: number[] = []
  const indexOf = new Map<string, number>()
  ids.forEach((id, k) => { if (id !== undefined && !indexOf.has(id)) indexOf.set(id, k) })
  const placed = new Set<number>()

  // 1. Keep existing bindings (a departing player who comes straight back is simply back in play).
  slots.forEach((s, r) => {
    if (s.id === null) return
    const k = indexOf.get(s.id)
    if (k === undefined) return
    follow[r] = k
    placed.add(k)
    if (s.mode === 'departing' || s.mode === 'idle') s.mode = 'play'
  })

  // 2. Players no longer on the ice start skating off.
  const justLeft = new Set<number>()
  slots.forEach((s, r) => {
    if (s.id !== null && follow[r] === -1 && (s.mode === 'play' || s.mode === 'arriving')) {
      s.mode = 'departing'
      left.push(r)
      justLeft.add(r)
    }
  })

  // 3. Newcomers take an idle rig, else the oldest departing one.
  for (const [id, k] of indexOf) {
    if (placed.has(k)) continue
    let r = slots.findIndex((s) => s.mode === 'idle')
    if (r === -1) {
      let best = -1
      let bestOrder = Infinity
      // Never grab a rig that only started skating off this frame (it would
      // vanish mid-ice) unless there is truly nothing else.
      slots.forEach((s, i) => {
        if (s.mode !== 'departing') return
        const o = justLeft.has(i) ? Number.MAX_SAFE_INTEGER - 1 : departOrder[i] ?? 0
        if (o < bestOrder) { bestOrder = o; best = i }
      })
      r = best
    }
    if (r === -1) continue // more players than rigs: shouldn't happen with a big enough pool
    slots[r]!.id = id
    slots[r]!.mode = 'arriving'
    follow[r] = k
    entered.push(r)
  }
  return { follow, entered, left }
}

/**
 * Move (x, z) toward (tx, tz) by at most `maxSpeed * dt`, returning the new point
 * and whether it has arrived (within `arriveFt`). Used for skating on and off.
 */
export function approach(
  x: number, z: number, tx: number, tz: number, dt: number, maxSpeed: number, arriveFt = 1.5,
): { x: number; z: number; arrived: boolean } {
  const dx = tx - x
  const dz = tz - z
  const d = Math.hypot(dx, dz)
  if (d <= arriveFt) return { x: tx, z: tz, arrived: true }
  const step = Math.min(d, maxSpeed * Math.max(0, dt))
  return { x: x + (dx / d) * step, z: z + (dz / d) * step, arrived: false }
}

/** Cap how far a point may move in one frame (turns any residual teleport into a skate). */
export function capStep(
  px: number, pz: number, nx: number, nz: number, dt: number, maxSpeed: number,
): { x: number; z: number; capped: boolean } {
  const dx = nx - px
  const dz = nz - pz
  const d = Math.hypot(dx, dz)
  const maxD = maxSpeed * Math.max(0, dt)
  if (d <= maxD || d === 0) return { x: nx, z: nz, capped: false }
  return { x: px + (dx / d) * maxD, z: pz + (dz / d) * maxD, capped: true }
}
