import { describe, it, expect } from 'vitest'
import {
  dropdownKeyDown,
  firstEnabled,
  lastEnabled,
  indexOfValue,
  measureMenu,
  type DropdownOption,
  type Rect,
} from './dropdownNav'

const VIEWPORT = { width: 1440, height: 900 }
const rect = (left: number, top: number, width = 94, height = 35): Rect => ({
  left, top, width, right: left + width, bottom: top + height,
})

const VIEWS: DropdownOption[] = [
  { value: 'general', label: 'General' },
  { value: 'contract', label: 'Contract' },
  { value: 'stats', label: 'Statistics' },
]

const closed = (value = 'general'): { open: boolean; value: string; highlight: number } => ({
  open: false,
  value,
  highlight: indexOfValue(VIEWS, value),
})
const open = (value = 'general', highlight = indexOfValue(VIEWS, value)) => ({
  open: true,
  value,
  highlight,
})

describe('dropdown option helpers', () => {
  it('finds the first and last selectable option', () => {
    expect(firstEnabled(VIEWS)).toBe(0)
    expect(lastEnabled(VIEWS)).toBe(2)
  })

  it('skips disabled options at the ends', () => {
    const opts: DropdownOption[] = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C', disabled: true },
    ]
    expect(firstEnabled(opts)).toBe(1)
    expect(lastEnabled(opts)).toBe(1)
  })

  it('returns null when every option is disabled', () => {
    const opts: DropdownOption[] = [{ value: 'a', label: 'A', disabled: true }]
    expect(firstEnabled(opts)).toBeNull()
    expect(lastEnabled(opts)).toBeNull()
  })

  it('falls back to the first selectable option for a value that is gone', () => {
    expect(indexOfValue(VIEWS, 'general')).toBe(0)
    expect(indexOfValue(VIEWS, 'stats')).toBe(2)
    expect(indexOfValue(VIEWS, 'nonsense')).toBe(0)
  })
})

describe('measureMenu', () => {
  const menu = { width: 120, height: 96 }

  it('hangs the menu just below the trigger by default', () => {
    const box = measureMenu(rect(300, 200), 'start', menu, VIEWPORT)
    expect(box.top).toBe(239) // trigger bottom (235) + 4px gap
    expect(box.left).toBe(300)
    expect(box.minWidth).toBe(94)
  })

  it("right-aligns to the trigger's far edge when asked", () => {
    const box = measureMenu(rect(300, 200), 'end', menu, VIEWPORT)
    // trigger right (394) minus the menu's own width (120)
    expect(box.left).toBe(274)
  })

  it('keeps a right-aligned menu on screen at the right margin', () => {
    // The Roster switcher sits hard against the right edge.
    const box = measureMenu(rect(1330, 300), 'end', { width: 200, height: 96 }, VIEWPORT)
    expect(box.left).toBeGreaterThanOrEqual(8)
    expect(box.left + 200).toBeLessThanOrEqual(VIEWPORT.width - 8)
  })

  it('never starts off the left edge', () => {
    const box = measureMenu(rect(4, 300), 'end', { width: 300, height: 96 }, VIEWPORT)
    expect(box.left).toBe(8)
  })

  it('flips above the trigger when there is no room below', () => {
    // A dropdown in the last row of a table, near the bottom of the window.
    const box = measureMenu(rect(300, 860), 'start', menu, VIEWPORT)
    expect(box.top).toBeLessThan(860)
    expect(box.top).toBeGreaterThanOrEqual(8)
  })

  it('stays below when below is the roomier side', () => {
    const box = measureMenu(rect(300, 100), 'start', { width: 120, height: 900 }, VIEWPORT)
    expect(box.top).toBe(139)
  })

  it('caps the height at the space available and scrolls inside', () => {
    const tall = { width: 120, height: 2000 }
    expect(measureMenu(rect(300, 100), 'start', tall, VIEWPORT).maxHeight).toBe(320)
    // A long list near the bottom flips up and still gets its full height.
    expect(measureMenu(rect(300, 700), 'start', tall, VIEWPORT).top).toBeLessThan(700)
    // With neither side roomy, the menu shrinks to the space it does have.
    const cramped = measureMenu(rect(300, 120), 'start', tall, { width: 1440, height: 300 })
    expect(cramped.maxHeight).toBeLessThan(320)
    expect(cramped.maxHeight).toBeGreaterThanOrEqual(80)
  })

  it('keeps a usable height even in a very short viewport', () => {
    const box = measureMenu(rect(300, 180), 'start', menu, { width: 1440, height: 220 })
    expect(box.maxHeight).toBeGreaterThanOrEqual(80)
  })

  it('widens the menu to at least the trigger width', () => {
    const box = measureMenu(rect(300, 200, 260), 'start', { width: 60, height: 96 }, VIEWPORT)
    expect(box.minWidth).toBe(260)
  })
})

describe('dropdownKeyDown — closed', () => {
  it('opens on Enter and Space at the current value', () => {
    for (const key of ['Enter', ' ']) {
      const r = dropdownKeyDown(closed('contract'), VIEWS, key)
      expect(r).toMatchObject({ open: true, highlight: 1, handled: true })
      expect(r.commit).toBeUndefined()
    }
  })

  it('moves the value directly on arrows, like a native select', () => {
    expect(dropdownKeyDown(closed('general'), VIEWS, 'ArrowDown').commit).toBe('contract')
    expect(dropdownKeyDown(closed('stats'), VIEWS, 'ArrowUp').commit).toBe('contract')
  })

  it('stops at the ends instead of wrapping', () => {
    const top = dropdownKeyDown(closed('general'), VIEWS, 'ArrowUp')
    expect(top.commit).toBeUndefined()
    expect(top.handled).toBe(true)
    const bottom = dropdownKeyDown(closed('stats'), VIEWS, 'ArrowDown')
    expect(bottom.commit).toBeUndefined()
  })

  it('jumps to the ends on Home and End', () => {
    expect(dropdownKeyDown(closed('contract'), VIEWS, 'Home').commit).toBe('general')
    expect(dropdownKeyDown(closed('contract'), VIEWS, 'End').commit).toBe('stats')
  })

  it('opens on Alt+ArrowDown without changing the value', () => {
    const r = dropdownKeyDown(closed('general'), VIEWS, 'ArrowDown', true)
    expect(r).toMatchObject({ open: true, handled: true })
    expect(r.commit).toBeUndefined()
  })

  it('lets Escape bubble so it can still close a surrounding dialog', () => {
    expect(dropdownKeyDown(closed(), VIEWS, 'Escape').handled).toBe(false)
  })
})

describe('dropdownKeyDown — open', () => {
  it('moves only the highlight on arrows, committing nothing', () => {
    const r = dropdownKeyDown(open('general'), VIEWS, 'ArrowDown')
    expect(r.highlight).toBe(1)
    expect(r.commit).toBeUndefined()
    expect(r.open).toBeUndefined()
  })

  it('commits the highlight on Enter and closes', () => {
    const r = dropdownKeyDown(open('general', 2), VIEWS, 'Enter')
    expect(r).toMatchObject({ open: false, commit: 'stats', handled: true })
  })

  it('closes on Escape without committing', () => {
    const r = dropdownKeyDown(open('general', 2), VIEWS, 'Escape')
    expect(r).toMatchObject({ open: false, handled: true })
    expect(r.commit).toBeUndefined()
  })

  it('closes on Tab but lets focus move on', () => {
    const r = dropdownKeyDown(open(), VIEWS, 'Tab')
    expect(r).toMatchObject({ open: false, handled: false })
  })

  it('skips disabled options when moving', () => {
    const opts: DropdownOption[] = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true },
      { value: 'c', label: 'C' },
    ]
    const r = dropdownKeyDown({ open: true, value: 'a', highlight: 0 }, opts, 'ArrowDown')
    expect(r.highlight).toBe(2)
  })

  it('never commits a disabled option on Enter', () => {
    const opts: DropdownOption[] = [{ value: 'a', label: 'A', disabled: true }]
    const r = dropdownKeyDown({ open: true, value: 'a', highlight: 0 }, opts, 'Enter')
    expect(r.commit).toBeUndefined()
    expect(r.open).toBe(false)
  })
})

describe('dropdownKeyDown — type-ahead', () => {
  it('jumps to the first option starting with the character', () => {
    expect(dropdownKeyDown(closed('general'), VIEWS, 'c').commit).toBe('contract')
    expect(dropdownKeyDown(closed('general'), VIEWS, 'S').commit).toBe('stats')
  })

  it('cycles through the list rather than sticking at the end', () => {
    // From 'stats' (index 2), 'g' has to wrap around to reach 'General'.
    expect(dropdownKeyDown(closed('stats'), VIEWS, 'g').commit).toBe('general')
  })

  it('moves the highlight only when open', () => {
    const r = dropdownKeyDown(open('general'), VIEWS, 's')
    expect(r.highlight).toBe(2)
    expect(r.commit).toBeUndefined()
  })

  it('ignores a character with no match', () => {
    const r = dropdownKeyDown(closed(), VIEWS, 'z')
    expect(r.commit).toBeUndefined()
    expect(r.handled).toBe(true)
  })

  it('leaves modifier shortcuts and named keys alone', () => {
    expect(dropdownKeyDown(closed(), VIEWS, 'f', true).handled).toBe(false)
    expect(dropdownKeyDown(closed(), VIEWS, 'PageDown').handled).toBe(false)
  })

  it('handles an empty option list without throwing', () => {
    expect(dropdownKeyDown(closed(), [], 'ArrowDown').handled).toBe(false)
  })
})
