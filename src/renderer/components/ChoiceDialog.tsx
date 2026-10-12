import { create } from 'zustand'
import { useEffect, useState } from 'react'

/**
 * In-app two-way choice (loop audit F13). The captain and lineup gates, and
 * the irreversible summer calls, used `window.confirm`: a native OS dialog
 * with "OK / Cancel" standing in for two real choices, outside the game's
 * look and on top of whatever monitor the OS picked. This is the same
 * question asked in the game's own modal, with both answers named.
 *
 *   if (await askChoice({ title, body, confirmLabel, cancelLabel })) …
 *
 * Resolves true for the confirm button, false for cancel, Escape or a click
 * outside. One question at a time; asking again replaces an open one (which
 * resolves false).
 */
export interface ChoiceRequest {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  /** Style the confirm button as destructive (a buyout, walking away). */
  danger?: boolean
  /** Ask for a short text answer (a name) instead of a yes/no. */
  input?: { placeholder?: string; initial?: string }
}

interface ChoiceState {
  open: (ChoiceRequest & { resolve: (ok: boolean, text?: string) => void }) | null
  ask: (req: ChoiceRequest, onText?: (text: string | null) => void) => Promise<boolean>
  answer: (ok: boolean, text?: string) => void
}

export const useChoiceDialog = create<ChoiceState>((set, get) => ({
  open: null,
  ask: (req, onText) => new Promise<boolean>((resolve) => {
    get().open?.resolve(false)
    set({ open: { ...req, resolve: (ok, text) => { onText?.(ok ? (text ?? '') : null); resolve(ok) } } })
  }),
  answer: (ok, text) => {
    const cur = get().open
    set({ open: null })
    cur?.resolve(ok, text)
  },
}))

/** Ask the GM a two-way question in the game's own dialog. */
export function askChoice(req: ChoiceRequest): Promise<boolean> {
  return useChoiceDialog.getState().ask(req)
}

/** Ask for a short text answer in the game's own dialog (Electron has no
 *  `window.prompt`: it returns null, so the old call silently did nothing).
 *  Resolves the trimmed text, or null when cancelled or empty. */
export async function askText(req: ChoiceRequest): Promise<string | null> {
  let text: string | null = null
  await useChoiceDialog.getState().ask({ ...req, input: req.input ?? {} }, (t) => { text = t })
  const t = (text as string | null)?.trim() ?? ''
  return t.length > 0 ? t : null
}

/** Mounted once in the shell. */
export function ChoiceDialogHost(): JSX.Element | null {
  const open = useChoiceDialog((s) => s.open)
  const answer = useChoiceDialog((s) => s.answer)
  const [text, setText] = useState('')
  useEffect(() => { setText(open?.input?.initial ?? '') }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(false) }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); answer(true, text) }
    }
    // Capture phase: the shell's Space/Enter-to-continue must not fire under it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, answer, text])

  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={() => answer(false)}>
      <div
        className="modal"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="choice-dialog-title"
      >
        <header className="modal-head">
          <h2 className="modal-title" id="choice-dialog-title">{open.title}</h2>
        </header>
        <div style={{ padding: '14px 18px', lineHeight: 1.5 }}>
          {open.body.split('\n').filter((l) => l.trim().length > 0).map((l, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : 'var(--sp-2) 0 0' }}>{l}</p>
          ))}
          {open.input && (
            <input
              className="input"
              style={{ width: '100%', marginTop: 'var(--sp-3)' }}
              autoFocus
              value={text}
              placeholder={open.input.placeholder}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)', justifyContent: 'flex-end', padding: '0 18px 14px' }}>
          <button className="btn" onClick={() => answer(false)}>{open.cancelLabel}</button>
          <button className={open.danger ? 'btn btn-danger' : 'btn btn-primary'} autoFocus={!open.input} onClick={() => answer(true, text)}>
            {open.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
