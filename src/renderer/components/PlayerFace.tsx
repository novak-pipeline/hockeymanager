/**
 * Renders a player face image, falling back to a coloured-initials avatar when
 * no faceId is provided or the image cannot be loaded.
 *
 * Face images are fetched as data URLs through the mod bridge (main process).
 * data: URLs are already in the app's CSP so no header changes are required.
 */
import { useState, useEffect, useRef } from 'react'
import { getFace } from '../lib/mods'

/* ── avatar fallback ── */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase()
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

/** Convert a 0xRRGGBB integer to a CSS hex string. */
function hexColor(color: number | undefined): string {
  if (color === undefined) return '#4c1d95'
  return `#${color.toString(16).padStart(6, '0')}`
}

function Avatar({
  name,
  teamColor,
  size,
}: {
  name: string
  teamColor?: number
  size: number
}): JSX.Element {
  const bg = hexColor(teamColor)
  const fontSize = Math.round(size * 0.38)
  return (
    <div
      aria-label={name}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 700,
        color: '#fff',
        flexShrink: 0,
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {initials(name)}
    </div>
  )
}

/* ── main component ── */

interface PlayerFaceProps {
  faceId?: string
  name: string
  teamColor?: number
  size?: number
}

/**
 * Shows the player's face image if a faceId is present and the image loads,
 * otherwise shows an initials avatar on the team's primary colour.
 */
export function PlayerFace({ faceId, name, teamColor, size = 40 }: PlayerFaceProps): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Track the faceId this effect was last called for so stale responses are dropped.
  const lastFaceId = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!faceId) {
      setDataUrl(null)
      setFailed(false)
      return
    }
    lastFaceId.current = faceId
    let cancelled = false
    void getFace(faceId).then((url) => {
      if (cancelled || lastFaceId.current !== faceId) return
      if (url) {
        setDataUrl(url)
        setFailed(false)
      } else {
        setFailed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [faceId])

  if (!faceId || failed || !dataUrl) {
    return <Avatar name={name} teamColor={teamColor} size={size} />
  }

  return (
    <img
      src={dataUrl}
      alt={name}
      width={size}
      height={size}
      style={{
        borderRadius: '50%',
        objectFit: 'cover',
        flexShrink: 0,
      }}
      onError={() => setFailed(true)}
    />
  )
}
