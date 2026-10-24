import { describe, expect, it } from 'vitest'
import { ReplayCamera } from './replay'
import { projectNdc } from './project'

describe('replay camera — package angles', () => {
  it('auto keeps the two-angle main replay (end zone, then behind the net)', () => {
    const c = new ReplayCamera(100, 1)
    expect(c.angleAt(96)).toBe('endZoneHigh')
    expect(c.angleAt(99)).toBe('behindNet')
  })

  it('the shooter\'s side stands low in the corner on his side and keeps the puck in frame', () => {
    for (const side of [1, -1] as const) {
      const c = new ReplayCamera(100, 1, { mode: 'shooterSide', side })
      const puck = { x: 80, y: 0.2, z: side * 10 }
      let pose = c.step(0, 99, 16 / 9, puck)
      expect(c.cut).toBe(true)
      expect(Math.sign(pose.pz)).toBe(side)
      expect(pose.px).toBeGreaterThan(60)
      for (let i = 0; i < 30; i++) pose = c.step(1 / 60, 99 + i / 60, 16 / 9, puck)
      const n = projectNdc(pose, 16 / 9, puck.x, puck.y, puck.z)
      expect(n.front).toBe(true)
      expect(Math.abs(n.x)).toBeLessThan(1)
      expect(Math.abs(n.y)).toBeLessThan(1)
    }
  })

  it('tight locks off near the man and follows him without cutting', () => {
    const c = new ReplayCamera(50, 1, { mode: 'tight' })
    let pose = c.step(0, 48, 16 / 9, { x: 20, y: 3, z: -30 })
    const stand = { x: pose.px, z: pose.pz }
    expect(Math.hypot(stand.x - 20, stand.z + 30)).toBeLessThan(40)
    for (let i = 1; i < 60; i++) {
      pose = c.step(1 / 60, 48 + i / 60, 16 / 9, { x: 20 + i * 0.2, y: 3, z: -30 })
      expect(c.cut).toBe(false)
    }
    expect(pose.px).toBe(stand.x)
    expect(pose.pz).toBe(stand.z)
  })
})
