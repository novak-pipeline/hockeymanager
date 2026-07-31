import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * An in-DOM dropdown, replacing the native `<select>`.
 *
 * A native `<select>` opens an OS-level popup that Chromium tears down whenever
 * the element re-renders. Every screen here re-renders on the global refresh bus
 * (see useScreenData), so on a busy day the popup can close in the same frame it
 * opened — the control reads as simply not responding to clicks. That is what
 * happened to the Roster "View:" switcher (playtest 2026-07-31, G1): the handler
 * was wired, typed and correct, and the column sets behind it were unreachable
 * anyway. The trade centre had already hit this and grown its own custom partner
 * dropdown; this is that pattern, extracted so there is one of it.
 *
 * The list is a plain absolutely-positioned div, so it survives re-renders,
 * screenshots and the interaction audit alike.
 */
export interface DropdownOption<T extends string> {
  value: T
  label: string
  /** Optional leading element (crest, flag, face). */
  icon?: ReactNode
  /** Optional dimmer trailing label (abbreviation, count). */
  hint?: string
}

export function Dropdown<T extends string>(props: {
  options: ReadonlyArray<DropdownOption<T>>
  value: T
  onChange: (value: T) => void
  /** Shown when `value` matches no option. */
  placeholder?: string
  disabled?: boolean
  /** Width of the closed trigger; the list matches it. */
  width?: number | string
  style?: CSSProperties
  /** Compact variant used inside dense tab strips and table cells. */
  small?: boolean
  title?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cur = props.options.find((o) => o.value === props.value)
  const fontSize = props.small ? 12 : 13

  // `fit-content` on the wrapper matters: .select carries `width: 100%` from
  // index.css, and an inline-block whose only child is width:100% has no
  // intrinsic width to resolve against — exactly the flex/width tangle that makes
  // a control collapse to something too small to hit.
  return (
    <div
      ref={ref}
      className="dropdown"
      style={{ position: 'relative', display: 'inline-block', width: props.width ?? 'fit-content', ...props.style }}
    >
      <button
        type="button"
        className="select"
        disabled={props.disabled}
        title={props.title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          cursor: props.disabled ? 'default' : 'pointer',
          textAlign: 'left',
          fontSize,
          padding: props.small ? '3px 8px' : undefined,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {cur?.icon}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cur?.label ?? props.placeholder ?? 'Select…'}
          </span>
        </span>
        <span className="muted" style={{ fontSize: 9 }}>▾</span>
      </button>
      {open && !props.disabled && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: '100%',
            zIndex: 60,
            maxHeight: 320,
            overflowY: 'auto',
            background: 'var(--bg1)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
          }}
        >
          {props.options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === props.value}
              onClick={() => {
                setOpen(false)
                if (o.value !== props.value) props.onChange(o.value)
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                background: o.value === props.value ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                border: 'none',
                color: 'var(--text)',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize,
                whiteSpace: 'nowrap',
              }}
            >
              {o.icon}
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.hint !== undefined && <span className="muted small">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
