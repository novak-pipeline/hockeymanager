/**
 * Keyboard behaviour for <Dropdown>, as a pure function.
 *
 * The component itself can't be unit-tested here — the suite runs in the `node`
 * environment and only picks up `*.test.ts`, so there is no DOM and no
 * react-testing-library (adding either would mean new dependencies). Keeping the
 * key handling as a pure reducer means the part that is actually easy to get
 * wrong — arrow-key wrapping, type-ahead, skipping disabled options — is
 * covered by real tests, and the component stays a thin shell over it.
 *
 * The behaviour deliberately mirrors a native <select> so replacing one with a
 * <Dropdown> is not a downgrade for keyboard users:
 *  - closed + Arrow keys  → move the selection directly, no popup
 *  - closed + Enter/Space/Alt+Down → open at the current selection
 *  - open + Arrow keys    → move the highlight only
 *  - open + Enter/Space   → commit the highlight
 *  - Escape               → close, keeping the previous value
 *  - Home/End             → first/last option
 *  - printable characters → type-ahead to the first option starting with it
 */

/** A viewport-space box. Structural, so tests need no DOM. */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
}

/** Where the menu should be drawn, in viewport coordinates. */
export interface MenuBox {
  left: number
  top: number
  minWidth: number
  maxHeight: number
}

/** Gap between the trigger and its menu. */
const MENU_GAP = 4
/** Smallest distance the menu is allowed to sit from a viewport edge. */
const MENU_MARGIN = 8
/** Tallest a menu ever gets before it scrolls internally. */
export const MENU_MAX_HEIGHT = 320
/** Never squeeze the menu below this, even in a cramped viewport. */
const MENU_MIN_HEIGHT = 80

/**
 * Work out where the menu goes for a given trigger: below it by default,
 * flipped above when that is genuinely roomier, and always clamped inside the
 * viewport so it can never be drawn off-screen (the Roster switcher sits hard
 * against the right margin, and table-cell dropdowns sit near the bottom).
 */
export function measureMenu(
  trigger: Rect,
  align: 'start' | 'end',
  menu: { width: number; height: number },
  viewport: { width: number; height: number }
): MenuBox {
  const width = Math.max(menu.width, trigger.width)
  const below = viewport.height - trigger.bottom - MENU_GAP - MENU_MARGIN
  const above = trigger.top - MENU_GAP - MENU_MARGIN
  const wanted = Math.min(menu.height, MENU_MAX_HEIGHT)
  const flip = below < wanted && above > below
  const maxHeight = Math.min(MENU_MAX_HEIGHT, Math.max(flip ? above : below, MENU_MIN_HEIGHT))
  const height = Math.min(menu.height, maxHeight)

  const rawLeft = align === 'end' ? trigger.right - width : trigger.left
  // Clamp low-edge last so a menu wider than the viewport still starts on-screen.
  const left = Math.max(MENU_MARGIN, Math.min(rawLeft, viewport.width - width - MENU_MARGIN))
  const top = flip
    ? Math.max(MENU_MARGIN, trigger.top - MENU_GAP - height)
    : trigger.bottom + MENU_GAP

  return { left, top, minWidth: trigger.width, maxHeight }
}

/** One entry in a dropdown. `disabled` entries are skipped by every movement. */
export interface DropdownOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

/** Where the dropdown is before a key is pressed. */
export interface DropdownNavState<T extends string = string> {
  open: boolean
  /** The committed value. */
  value: T
  /** Which option the keyboard cursor sits on while open. */
  highlight: number
}

/** What the component should do next. Any field left out means "unchanged". */
export interface DropdownNavResult<T extends string = string> {
  open?: boolean
  /** Set when the value should be committed (fires the caller's onChange). */
  commit?: T
  highlight?: number
  /** True when the key was ours — the component preventDefaults it. */
  handled: boolean
}

const NOT_HANDLED: DropdownNavResult = { handled: false }

/** First selectable index at or after `from`, walking `step`; null if none. */
function seek<T extends string>(
  options: DropdownOption<T>[],
  from: number,
  step: number
): number | null {
  for (let i = from; i >= 0 && i < options.length; i += step) {
    if (!options[i].disabled) return i
  }
  return null
}

/** The first selectable option, or null when every option is disabled. */
export function firstEnabled<T extends string>(options: DropdownOption<T>[]): number | null {
  return seek(options, 0, 1)
}

/** The last selectable option, or null when every option is disabled. */
export function lastEnabled<T extends string>(options: DropdownOption<T>[]): number | null {
  return seek(options, options.length - 1, -1)
}

/**
 * Index of `value`, or the first selectable option when the value is missing
 * (a stale value must never leave the cursor pointing at nothing).
 */
export function indexOfValue<T extends string>(options: DropdownOption<T>[], value: T): number {
  const i = options.findIndex((o) => o.value === value)
  if (i >= 0) return i
  return firstEnabled(options) ?? 0
}

/**
 * Next selectable index in `dir`, stopping at the ends rather than wrapping —
 * this is what a native select does, and wrapping makes it far too easy to
 * shoot past the end of a short list.
 */
function step<T extends string>(
  options: DropdownOption<T>[],
  from: number,
  dir: 1 | -1
): number | null {
  return seek(options, from + dir, dir)
}

/** Type-ahead: first selectable option whose label starts with `ch`, from `after`. */
function typeAhead<T extends string>(
  options: DropdownOption<T>[],
  ch: string,
  after: number
): number | null {
  const c = ch.toLowerCase()
  const matches = (i: number): boolean =>
    !options[i].disabled && options[i].label.toLowerCase().startsWith(c)
  for (let i = after + 1; i < options.length; i++) if (matches(i)) return i
  for (let i = 0; i <= after && i < options.length; i++) if (matches(i)) return i
  return null
}

/**
 * Resolve one keydown. `key` is the raw `KeyboardEvent.key`; `altKey` only
 * matters for the Alt+Arrow open/close shortcuts.
 */
export function dropdownKeyDown<T extends string>(
  state: DropdownNavState<T>,
  options: DropdownOption<T>[],
  key: string,
  altKey = false
): DropdownNavResult<T> {
  if (options.length === 0) return NOT_HANDLED as DropdownNavResult<T>
  const cur = state.open ? state.highlight : indexOfValue(options, state.value)

  switch (key) {
    case 'Escape':
      // Only meaningful while open — let a closed dropdown's Escape bubble so
      // it can still close a surrounding dialog.
      return state.open ? { open: false, handled: true } : (NOT_HANDLED as DropdownNavResult<T>)

    case 'Tab':
      // Tab commits nothing but must not leave an orphaned popup behind.
      return state.open ? { open: false, handled: false } : (NOT_HANDLED as DropdownNavResult<T>)

    case 'Enter':
    case ' ':
      if (!state.open) return { open: true, highlight: cur, handled: true }
      if (options[cur] && !options[cur].disabled) {
        return { open: false, commit: options[cur].value, highlight: cur, handled: true }
      }
      return { open: false, handled: true }

    case 'ArrowDown':
    case 'ArrowUp': {
      const dir = key === 'ArrowDown' ? 1 : -1
      // Alt+Arrow is the platform gesture for "just open/close the popup".
      if (altKey) {
        if (dir === 1 && !state.open) return { open: true, highlight: cur, handled: true }
        if (dir === -1 && state.open) return { open: false, handled: true }
        return { handled: true }
      }
      const next = step(options, cur, dir)
      if (next === null) return { handled: true }
      // Closed: move the value itself, exactly like a native select.
      if (!state.open) return { commit: options[next].value, highlight: next, handled: true }
      return { highlight: next, handled: true }
    }

    case 'Home':
    case 'End': {
      const next = key === 'Home' ? firstEnabled(options) : lastEnabled(options)
      if (next === null) return { handled: true }
      if (!state.open) return { commit: options[next].value, highlight: next, handled: true }
      return { highlight: next, handled: true }
    }

    default: {
      // Type-ahead, but never swallow shortcuts like Ctrl+F.
      if (key.length !== 1 || altKey) return NOT_HANDLED as DropdownNavResult<T>
      const next = typeAhead(options, key, cur)
      if (next === null) return { handled: true }
      if (!state.open) return { commit: options[next].value, highlight: next, handled: true }
      return { highlight: next, handled: true }
    }
  }
}
