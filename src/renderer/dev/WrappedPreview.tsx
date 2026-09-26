/**
 * DEV-ONLY preview of Season Wrapped (docs/SEASON-WRAPPED.md) — renders the
 * Yearbook grid and the card deck from a JSON dump of WrappedYear[] (written by
 * src/engine/story/wrapped.harness.test.ts), with no worker, save or mod bridge.
 * Served by the renderer dev server at /wrapped-preview.html; not a build input.
 *
 *   /wrapped-preview.html#src=<url of years JSON>&year=2027&card=3
 */
import { useEffect, useState } from 'react'
import type { WrappedYear } from '../../worker/protocol'
import { yearbookRow } from '@engine/story/wrapped'
import { WrappedPlayer } from '../components/WrappedOverlay'
import { YearbookGrid } from '../screens/YearbookScreen'

function params(): URLSearchParams {
  return new URLSearchParams(location.hash.replace(/^#/, ''))
}

export function WrappedPreview(): JSX.Element {
  const [years, setYears] = useState<WrappedYear[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const p = params()
  const [open, setOpen] = useState<{ year: number; card: number } | null>(
    p.get('year') ? { year: Number(p.get('year')), card: Number(p.get('card') ?? 0) } : null,
  )
  useEffect(() => {
    const src = params().get('src')
    if (!src) { setError('Pass #src=<url of a WrappedYear[] JSON dump>'); return }
    fetch(src).then((r) => r.json()).then((j: WrappedYear[]) => setYears(j)).catch((e: unknown) => setError(String(e)))
  }, [])
  if (error) return <div style={{ padding: 24, color: '#fff' }}>{error}</div>
  if (!years) return <div style={{ padding: 24, color: '#fff' }}>Loading…</div>
  const showing = open ? years.find((y) => y.year === open.year) : undefined
  return (
    <div style={{ padding: 28, minHeight: '100vh', background: 'var(--bg0)', color: 'var(--text)' }}>
      <h1 className="screen-title" style={{ marginBottom: 16 }}>Yearbook</h1>
      <YearbookGrid
        rows={[...years].sort((a, b) => b.year - a.year).map(yearbookRow)}
        pendingYear={null}
        onOpen={(year) => setOpen({ year, card: 0 })}
      />
      {showing && (
        <WrappedPlayer key={`${showing.year}-${open?.card}`} year={showing} startIndex={open?.card} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}
