import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import {
  dropdownKeyDown, indexOfValue, measureMenu, MENU_MAX_HEIGHT,
  type DropdownOption, type MenuBox,
} from './dropdownNav'

export type { DropdownOption } from './dropdownNav'

/**
 * A select control whose menu is ordinary DOM.
 *
 * Why this exists: the Roster screen's "View:" switcher (a native <select>) was
 * reported dead — clicking it produced no menu, leaving two of three column
 * sets unreachable. Everything a page can inspect about it checked out: the
 * element was present, enabled, not overlaid (elementFromPoint returned the
 * select itself), pointer-events were live, the click landed and focused it,
 * nothing called preventDefault, and driving the same control from the keyboard
 * fired onChange and switched the columns correctly. That leaves the popup
 * itself — drawn by the OS, not the page — as the only surface left, and it is
 * one nothing in the renderer can observe or repair. The trade-partner picker
 * hit the same wall and was rewritten this way (see TradesScreen).
 *
 * Note this is not a blanket claim that native <select> is broken here: the
 * start screen's database picker is one and works. Rather than guess at which
 * ones are affected, this component exists so any control that misbehaves can
 * be moved onto a menu the page fully controls — and can therefore be tested.
 *
 * The menu is portalled to <body> and positioned in viewport coordinates: the
 * app shell animates screens with a transform, and tables scroll inside
 * `.table-wrap`, either of which would clip or mis-anchor an in-flow menu.
 *
 * Keyboard behaviour lives in `dropdownNav.ts` and mirrors a native select, so
 * this is a straight swap rather than a downgrade. See that module for the map.
 */
export function Dropdown<T extends string>(props: {
  value: T
  options: DropdownOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  /** Tooltip on the trigger. */
  title?: string
  /** Accessible name, for when the visible label sits outside the control. */
  ariaLabel?: string
  /** Shown when `value` matches no option (e.g. an intentional "pick one" state). */
  placeholder?: string
  /** Menu edge to line up with the trigger. Use 'end' near the right margin. */
  align?: 'start' | 'end'
  /** Trigger width. Defaults to fitting the content. */
  width?: number | string
  fontSize?: number
  style?: CSSProperties
  className?: string
}): JSX.Element {
  const {
    value, options, onChange, disabled = false, title, ariaLabel, placeholder,
    align = 'start', width, fontSize = 12, style, className,
  } = props

  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(() => indexOfValue(options, value))
  const [box, setBox] = useState<MenuBox | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()

  const selected = options.find((o) => o.value === value)

  const reposition = useCallback((): void => {
    const t = triggerRef.current
    if (!t) return
    const menu = menuRef.current
    setBox(measureMenu(
      t.getBoundingClientRect(),
      align,
      { width: menu?.scrollWidth ?? 0, height: menu?.scrollHeight ?? MENU_MAX_HEIGHT },
      { width: window.innerWidth, height: window.innerHeight }
    ))
  }, [align])

  // Dismiss on an outside press or when the window loses focus. Using mousedown
  // (not click) means the menu is gone before the click lands, so a control
  // underneath still receives it.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onBlur = (): void => setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  // Follow the trigger while open — any ancestor can scroll (capture catches
  // them all), and the window can be resized under us.
  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, reposition])

  // Open at the current value.
  useEffect(() => {
    if (open) setHighlight(indexOfValue(options, value))
    // Re-seeding only on open is the point — moving the highlight must not
    // reset it, so `highlight` is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Measure before paint so the menu never flashes at the wrong place, then
  // measure again once it has real content to size against.
  useLayoutEffect(() => {
    if (!open) { setBox(null); return }
    reposition()
  }, [open, reposition])

  useLayoutEffect(() => {
    if (!open) return
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  const commit = (v: T): void => {
    if (v !== value) onChange(v)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (disabled) return
    const r = dropdownKeyDown({ open, value, highlight }, options, e.key, e.altKey)
    if (r.handled) e.preventDefault()
    if (r.commit !== undefined) commit(r.commit)
    if (r.highlight !== undefined) setHighlight(r.highlight)
    if (r.open !== undefined) {
      setOpen(r.open)
      // Escape/Enter keep focus on the trigger; Tab must be free to move on.
      if (!r.open && r.handled) triggerRef.current?.focus()
    }
  }

  const label = selected ? selected.label : (placeholder ?? '')

  const menu = open && (
    <div
      ref={menuRef}
      id={listId}
      role="listbox"
      className="dropdown-menu"
      style={{
        left: box?.left ?? -9999,
        top: box?.top ?? -9999,
        minWidth: box?.minWidth,
        maxHeight: box?.maxHeight ?? MENU_MAX_HEIGHT,
        visibility: box ? 'visible' : 'hidden',
      }}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="option"
          data-idx={i}
          // The tick glyph is decorative and would otherwise be the only thing
          // some readers announce, so name the option explicitly.
          aria-label={o.label}
          aria-selected={o.value === value}
          disabled={o.disabled}
          className={`dropdown-option${i === highlight ? ' is-highlighted' : ''}${o.value === value ? ' is-selected' : ''}`}
          style={{ fontSize }}
          // Commit on mousedown: the window-level dismisser would otherwise
          // tear the menu down before a click could land.
          onMouseDown={(e) => {
            e.preventDefault()
            if (o.disabled) return
            commit(o.value)
            setOpen(false)
            triggerRef.current?.focus()
          }}
          onMouseEnter={() => { if (!o.disabled) setHighlight(i) }}
        >
          <span className="dropdown-option-check" aria-hidden="true">{o.value === value ? '✓' : ''}</span>
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div
      ref={rootRef}
      className={className}
      style={{ position: 'relative', display: 'inline-block', width, ...style }}
      onKeyDown={onKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="dropdown-trigger"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        title={title}
        style={{ fontSize, width: width === undefined ? undefined : '100%' }}
        onClick={() => { if (!disabled) setOpen((o) => !o) }}
      >
        <span
          className="dropdown-trigger-label"
          style={!selected && placeholder ? { color: 'var(--muted)' } : undefined}
        >
          {label}
        </span>
        <span className="dropdown-caret" aria-hidden="true">▾</span>
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  )
}
