/**
 * Linkify — turn any prose containing player names into clickable links to
 * their profile. Used wherever the game writes names into free text (inbox
 * news bodies, camp reports, transaction lines, the feed).
 *
 * It matches capitalized multi-word sequences (real names, incl. accents and
 * hyphens) and links only those found in the world's player index — team names
 * and ordinary Capitalized sentence starts fall through untouched. The index
 * is fetched once and cached for the session.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { PlayerLink } from './NavContext'
import { useClient } from '../hooks/useSim'
import type { SimClient } from '../../worker/client'

let CACHE: Map<string, string> | null = null
let INFLIGHT: Promise<Map<string, string>> | null = null

/** Drop the cached index — call when a different career is loaded so names
 *  resolve against the new world. */
export function resetNameIndex(): void {
  CACHE = null
  INFLIGHT = null
}

function loadIndex(client: SimClient): Promise<Map<string, string>> {
  if (CACHE) return Promise.resolve(CACHE)
  if (INFLIGHT) return INFLIGHT
  INFLIGHT = (async () => {
    const m = new Map<string, string>()
    try {
      const r = await client.getNameIndex()
      if (r.type === 'nameIndex') {
        for (const [id, name] of r.entries) {
          const key = name.toLowerCase()
          if (!m.has(key)) m.set(key, id) // first occurrence wins (stable)
        }
      }
    } catch { /* leave the map empty — names simply won't link */ }
    CACHE = m
    return m
  })()
  return INFLIGHT
}

/** The name→id index, loaded lazily and shared across all Linkify instances. */
export function useNameIndex(): Map<string, string> | null {
  const client = useClient()
  const [idx, setIdx] = useState<Map<string, string> | null>(CACHE)
  useEffect(() => {
    if (idx) return
    let alive = true
    void loadIndex(client).then((m) => { if (alive) setIdx(m) })
    return () => { alive = false }
  }, [client, idx])
  return idx
}

// A "name" = two or more capitalized tokens (letters, incl. accents, apostrophes,
// hyphens). Requiring 2+ tokens avoids matching ordinary sentence-start words.
const NAME_RE = /\p{Lu}[\p{L}'.\-]*(?:\s\p{Lu}[\p{L}'.\-]*)+/gu

export function Linkify({ text, className }: { text: string; className?: string }): JSX.Element {
  const index = useNameIndex()
  if (!index || index.size === 0 || !text) return <>{text}</>

  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(NAME_RE)) {
    const raw = m[0]
    const start = m.index ?? 0
    // Strip a trailing possessive so "Tankov's" still links "Tankov".
    const clean = raw.replace(/['’`]s$/u, '')
    const id = index.get(clean.toLowerCase())
    if (!id) continue
    if (start > last) nodes.push(text.slice(last, start))
    nodes.push(<PlayerLink key={key++} playerId={id} name={clean} />)
    if (clean.length < raw.length) nodes.push(raw.slice(clean.length))
    last = start + raw.length
  }
  if (nodes.length === 0) return <>{text}</>
  if (last < text.length) nodes.push(text.slice(last))
  return <span className={className}>{nodes}</span>
}
