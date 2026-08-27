/**
 * SAVE MANAGER (playtest F6) — save/load as a real game does it.
 *
 * Before this, Save wrote a single hard-coded slot and Load silently opened
 * whichever file happened to be newest: you could neither keep two careers
 * nor choose between them, and nothing on screen ever told you what a save
 * contained. This shows every slot with the things you actually pick by —
 * club, season, phase, when it was written — and lets you write a new one,
 * overwrite an old one, or delete it.
 *
 * Used from two places: the title screen (load-only) and the shell's topbar
 * (the full manager). Disk access stays behind lib/saves.ts.
 */
import { useCallback, useEffect, useState } from 'react'
import { deleteCareerSave, listCareerSaves, type CareerSaveInfo } from '../lib/saves'
import { Icon } from './primitives'
import { Icons } from './icons'
import { fmtDate } from './format'

const PHASE_LABEL: Record<string, string> = {
  regularSeason: 'Regular season',
  playoffs: 'Playoffs',
  offseason: 'Offseason',
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function timeLabel(iso: string, mtimeMs: number): string {
  const d = iso || new Date(mtimeMs).toISOString()
  const time = /T(\d{2}:\d{2})/.exec(d)?.[1]
  return `${fmtDate(d)}${time ? ` · ${time}` : ''}`
}

/** A slot name safe for the filesystem, derived from what the GM typed. */
export function slugSlot(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return (base || 'career').slice(0, 40)
}

export function SaveManager(props: {
  /** 'load' hides the write controls (there is no career to write yet). */
  mode: 'load' | 'manage'
  /** Suggested name for a new save — usually "<Club> <year>". */
  suggestedName?: string
  busy?: boolean
  onLoad: (slot: string, label: string) => void
  onSave?: (slot: string, name: string) => Promise<void> | void
  onClose: () => void
}): JSX.Element {
  const [rows, setRows] = useState<CareerSaveInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [name, setName] = useState(props.suggestedName ?? '')
  const [working, setWorking] = useState(false)

  const refresh = useCallback((): void => {
    void listCareerSaves()
      .then((s) => { setRows([...s].sort((a, b) => b.mtimeMs - a.mtimeMs)); setError(null) })
      .catch((err) => { setRows([]); setError(err instanceof Error ? err.message : String(err)) })
  }, [])

  useEffect(refresh, [refresh])

  // Esc closes — a dialog you can't dismiss with the keyboard reads as a bug.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.preventDefault(); props.onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const write = async (slot: string, label: string): Promise<void> => {
    if (!props.onSave || working) return
    setWorking(true)
    try {
      await props.onSave(slot, label)
      refresh()
    } finally {
      setWorking(false)
    }
  }

  const busy = !!props.busy || working

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal savemgr" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-head">
          <h2 className="modal-title">{props.mode === 'load' ? 'Load career' : 'Saved careers'}</h2>
          <button className="modal-close" onClick={props.onClose} aria-label="Close">×</button>
        </header>

        {props.mode === 'manage' && (
          <div className="savemgr-new">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this save"
              aria-label="Save name"
            />
            <button
              className="btn btn-primary"
              disabled={busy || name.trim().length === 0}
              onClick={() => void write(slugSlot(name), name.trim())}
            >
              Save to a new slot
            </button>
          </div>
        )}

        <div className="savemgr-list">
          {error && (
            <p className="savemgr-empty">
              Saves are unavailable here — the desktop app owns the disk. ({error})
            </p>
          )}
          {rows === null && !error && <p className="savemgr-empty">Reading your saves…</p>}
          {rows !== null && rows.length === 0 && !error && (
            <p className="savemgr-empty">No saved careers yet. Start one and the game keeps an autosave for you.</p>
          )}
          {(rows ?? []).map((r) => (
            <div className={`savemgr-row${r.slot === 'autosave' ? ' auto' : ''}`} key={r.slot}>
              <span className="savemgr-icon">
                <Icon size={18}>{r.slot === 'autosave' ? <Icons.Bell /> : <Icons.History />}</Icon>
              </span>
              <span className="savemgr-id">
                <span className="savemgr-name">
                  {r.saveName}
                  {r.slot === 'autosave' && <span className="savemgr-tag">AUTO</span>}
                </span>
                <span className="savemgr-meta">
                  {r.teamName} · {r.year} · {PHASE_LABEL[r.phase] ?? r.phase}
                </span>
                <span className="savemgr-meta dim">
                  {timeLabel(r.savedAt, r.mtimeMs)} · {sizeLabel(r.sizeBytes)}
                </span>
              </span>
              <span className="savemgr-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => props.onLoad(r.slot, r.saveName)}
                >
                  Load
                </button>
                {props.mode === 'manage' && r.slot !== 'autosave' && (
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => void write(r.slot, r.saveName)}
                    title="Overwrite this slot with the current career"
                  >
                    Overwrite
                  </button>
                )}
                {confirmDelete === r.slot ? (
                  <button
                    className="btn btn-sm danger"
                    disabled={busy}
                    onClick={() => {
                      void deleteCareerSave(r.slot).then(() => { setConfirmDelete(null); refresh() })
                    }}
                  >
                    Delete for good?
                  </button>
                ) : (
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={busy}
                    onClick={() => setConfirmDelete(r.slot)}
                    title="Delete this save"
                  >
                    Delete
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        <footer className="savemgr-foot">
          The game autosaves as you play. A manual save is a checkpoint you choose.
        </footer>
      </div>
    </div>
  )
}
