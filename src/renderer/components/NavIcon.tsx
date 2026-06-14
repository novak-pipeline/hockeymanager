import type { IconKey } from './navConfig'

/** Minimal line-art icons for the nav rail (stroke = currentColor). */
const PATHS: Record<IconKey, JSX.Element> = {
  // building / front office
  frontOffice: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <line x1="8" y1="7" x2="8" y2="7.01" /><line x1="12" y1="7" x2="12" y2="7.01" /><line x1="16" y1="7" x2="16" y2="7.01" />
      <line x1="8" y1="11" x2="8" y2="11.01" /><line x1="12" y1="11" x2="12" y2="11.01" /><line x1="16" y1="11" x2="16" y2="11.01" />
      <line x1="10" y1="21" x2="10" y2="16" /><line x1="14" y1="21" x2="14" y2="16" />
    </>
  ),
  // envelope / news
  news: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  // hockey stick + puck / team
  team: (
    <>
      <path d="M6 4l8 13" />
      <path d="M14 17h4" />
      <ellipse cx="7" cy="19" rx="3" ry="1.4" />
    </>
  ),
  // globe / league
  league: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c3 3 3 15 0 18c-3-3-3-15 0-18z" />
    </>
  ),
  // puck / match
  match: (
    <>
      <ellipse cx="12" cy="9" rx="8" ry="3.2" />
      <path d="M4 9v6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V9" />
    </>
  ),
  // calendar
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="2.5" x2="8" y2="6.5" /><line x1="16" y1="2.5" x2="16" y2="6.5" />
    </>
  ),
  // swap arrows / trades
  trades: (
    <>
      <path d="M7 7h12l-3-3" /><path d="M7 7l3 3" />
      <path d="M17 17H5l3 3" /><path d="M17 17l-3-3" />
    </>
  ),
}

export function NavIcon({ name, size = 20 }: { name: IconKey; size?: number }): JSX.Element {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden style={{ display: 'block' }}
    >
      {PATHS[name]}
    </svg>
  )
}
