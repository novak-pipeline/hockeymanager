/**
 * Ctrl+K command palette — search-anything navigation (audit QoL #2).
 *
 * One box that jumps to any player, team, or screen: type a few letters,
 * arrow keys + Enter, and you're there. Kills the 3–5-click sidebar hunt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PlayerFace } from './PlayerFace'
import { Icon } from './primitives'
import { Icons } from './icons'
import { useClient } from '../hooks/useSim'
import { useNav, type ScreenId } from './NavContext'

interface PaletteRow {
  key: string
  kind: 'player' | 'team' | 'screen'
  label: string
  sub: string
  faceId?: string
  go: () => void
}

/** Screens worth jumping to by name (label → nav target). */
const SCREEN_TARGETS: Array<{ label: string; screen: ScreenId; keywords: string }> = [
  { label: 'Dashboard', screen: 'dashboard', keywords: 'home office' },
  { label: 'Inbox', screen: 'inbox', keywords: 'news mail messages' },
  { label: 'Roster', screen: 'squad', keywords: 'squad players lineup' },
  { label: 'Tactics', screen: 'tactics', keywords: 'lines systems strategy' },
  { label: 'Trades', screen: 'trades', keywords: 'trade block offers' },
  { label: 'Scouting', screen: 'scoutingCentre' as ScreenId, keywords: 'scouts prospects draft' },
  { label: 'Standings', screen: 'standings' as ScreenId, keywords: 'table league rank' },
  { label: 'Schedule', screen: 'schedule' as ScreenId, keywords: 'calendar fixtures games' },
  { label: 'Finances', screen: 'finances', keywords: 'cap salary money budget' },
  { label: 'Club Vision', screen: 'board', keywords: 'owner board expectations mandate' },
  { label: 'Free Agents', screen: 'offseason' as ScreenId, keywords: 'ufa signing market' },
  { label: 'Draft', screen: 'draft' as ScreenId, keywords: 'prospects picks entry' },
  { label: 'History', screen: 'history' as ScreenId, keywords: 'records legends awards' },
  { label: 'Job Market', screen: 'jobMarket', keywords: 'coach scout hire staff' },
  { label: 'Settings', screen: 'settings', keywords: 'options theme' },
]

export function CommandPalette(): JSX.Element | null {
  const client = useClient()
  const nav = useNav()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ players: PaletteRow[]; teams: PaletteRow[] }>({ players: [], teams: [] })
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)

  const close = useCallback((): void => {
    setOpen(false)
    setQuery('')
    setResults({ players: [], teams: [] })
    setSelected(0)
  }, [])

  /* global hotkey */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape' && open) {
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  /* debounced search */
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) {
      setResults({ players: [], teams: [] })
      setSelected(0)
      return
    }
    const seq = ++seqRef.current
    const t = setTimeout(() => {
      void client.searchAll(q).then((res) => {
        if (seq !== seqRef.current || res.type !== 'searchResults') return
        setResults({
          players: res.results.players.map((p) => ({
            key: `p-${p.playerId}`, kind: 'player' as const,
            label: p.name, sub: `${p.position} · ${p.age} · ${p.teamAbbr}`,
            ...(p.faceId ? { faceId: p.faceId } : {}),
            go: () => nav.navigate('player', { playerId: p.playerId }),
          })),
          teams: res.results.teams.map((t2) => ({
            key: `t-${t2.teamId}`, kind: 'team' as const,
            label: t2.name, sub: t2.abbr,
            go: () => nav.navigate('teamInfo', { teamId: t2.teamId }),
          })),
        })
        setSelected(0)
      })
    }, 120)
    return () => clearTimeout(t)
  }, [query, open, client, nav])

  /* screens are matched locally, instantly */
  const screenRows: PaletteRow[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return SCREEN_TARGETS
      .filter((s) => s.label.toLowerCase().includes(q) || s.keywords.includes(q))
      .slice(0, 4)
      .map((s) => ({
        key: `s-${s.screen}`, kind: 'screen' as const,
        label: s.label, sub: 'Go to screen',
        go: () => nav.navigate(s.screen),
      }))
  }, [query, nav])

  const rows: PaletteRow[] = useMemo(
    () => [...results.players, ...results.teams, ...screenRows],
    [results, screenRows]
  )

  const pick = (row: PaletteRow): void => {
    row.go()
    close()
  }

  const onInputKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(rows.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(0, s - 1)) }
    else if (e.key === 'Enter' && rows[selected]) { e.preventDefault(); pick(rows[selected]!) }
  }

  if (!open) return null

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '90vw', background: 'var(--bg1)',
          border: '1px solid var(--line)', borderRadius: 'var(--radius)',
          boxShadow: '0 18px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Search players, teams, screens…"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '14px 16px',
            background: 'var(--bg0)', border: 'none', borderBottom: '1px solid var(--line)',
            color: 'var(--text)', fontSize: 15, outline: 'none',
          }}
        />
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {rows.length === 0 && query.trim().length >= 2 && (
            <div className="muted small" style={{ padding: '14px 16px' }}>No matches.</div>
          )}
          {rows.length === 0 && query.trim().length < 2 && (
            <div className="muted small" style={{ padding: '14px 16px' }}>
              Type to search the whole world — players, clubs, screens. ↑↓ to move, Enter to go.
            </div>
          )}
          {rows.map((row, i) => (
            <button
              key={row.key}
              type="button"
              onClick={() => pick(row)}
              onMouseEnter={() => setSelected(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '8px 14px', textAlign: 'left', cursor: 'pointer',
                background: i === selected ? 'rgba(var(--accent-rgb, 139 92 246) / 0.14)' : 'transparent',
                border: 'none', color: 'var(--text)',
              }}
            >
              {row.kind === 'player'
                ? <PlayerFace faceId={row.faceId} name={row.label} size={28} />
                : <span style={{ width: 28, display: 'flex', justifyContent: 'center', color: 'var(--muted)' }}><Icon size={16}>{row.kind === 'team' ? <Icons.Health /> : <Icons.ChevronRight />}</Icon></span>}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{row.label}</span>
                <span className="muted" style={{ marginLeft: 8, fontSize: 11.5 }}>{row.sub}</span>
              </span>
              {i === selected && <span className="muted" style={{ fontSize: 10 }}>↵</span>}
            </button>
          ))}
        </div>
        <div className="muted" style={{ padding: '6px 14px', borderTop: '1px solid var(--line)', fontSize: 10.5, display: 'flex', gap: 14 }}>
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span><span style={{ marginLeft: 'auto' }}>Ctrl+K</span>
        </div>
      </div>
    </div>
  )
}
