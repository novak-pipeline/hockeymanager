/**
 * Compact "mark for meeting" control for dense table rows (stats, Data Hub).
 * A small ⊕ trigger opens a topic menu; picking one adds the player to the
 * staff-meeting agenda (career.markForMeeting). Mirrors the profile screen's
 * menu but sized for inline use.
 */
import { useState } from 'react'
import { useClient } from '../hooks/useSim'
import { toast } from './store'

const MEETING_TOPICS: Array<{ id: string; label: string }> = [
  { id: 'form', label: 'His recent form' },
  { id: 'iceTime', label: 'His ice time / usage' },
  { id: 'role', label: 'His best role' },
  { id: 'development', label: 'His development' },
  { id: 'tradeValue', label: 'His trade value' },
]

export function MarkForMeetingButton(props: { playerId: string }): JSX.Element {
  const client = useClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function mark(topic: string): Promise<void> {
    setBusy(true)
    try {
      const res = await client.markForMeeting(props.playerId, topic)
      if (res.type === 'error') toast(res.message, 'error')
      else toast('Added to the staff-meeting agenda.', 'success')
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        title="Mark for staff meeting"
        aria-label="Mark for staff meeting"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: open ? 'var(--accent, #f5b301)' : 'var(--muted)',
          fontSize: 13, lineHeight: 1, padding: '0 2px',
        }}
      >
        ⊕
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 20, top: '100%', right: 0, marginTop: 4,
            background: 'var(--bg1)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)', minWidth: 190, textAlign: 'left',
          }}
        >
          {MEETING_TOPICS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={(e) => { e.stopPropagation(); void mark(t.id) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '7px 11px',
                background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 12,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg2)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
