import type { IconKey } from './navConfig'

/** Minimal line-art icons for the nav rail (stroke = currentColor). viewBox 24. */
const PATHS: Record<IconKey, JSX.Element> = {
  home: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  inbox: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  squad: <><circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.3" /><path d="M3 19c0-3 2.5-5 5-5s5 2 5 5" /><path d="M14.5 19c0-2.2 1.4-3.6 3.2-3.6S21 16.8 21 19" /></>,
  squadPlanner: <><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="9" x2="9" y2="21" /></>,
  dynamics: <><circle cx="6" cy="7" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="17" r="2" /><path d="M7.6 8.4l3 7M16.4 8.4l-3 7M8 7h8" /></>,
  tactics: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8l3 3-3 3" /><line x1="13" y1="8" x2="16" y2="8" /><line x1="13" y1="14" x2="16" y2="14" /></>,
  dataHub: <><line x1="4" y1="20" x2="20" y2="20" /><rect x="6" y="11" width="3" height="7" /><rect x="11" y="7" width="3" height="11" /><rect x="16" y="13" width="3" height="5" /></>,
  staff: <><circle cx="12" cy="7" r="3.2" /><path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M12 14v3" /></>,
  training: <><circle cx="9" cy="9" r="5" /><path d="M9 6v3l2 1.5" /><path d="M13 13l6 6" /></>,
  medical: <><rect x="3" y="3" width="18" height="18" rx="3" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></>,
  devCenter: <><path d="M4 19c4-1 5-5 5-9" /><path d="M9 10c4 0 7-2 9-6c-5 0-9 1-9 6z" /><path d="M9 13c-3 0-5-2-6-5c4 0 6 1 6 5z" /></>,
  schedule: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2.5" x2="8" y2="6.5" /><line x1="16" y1="2.5" x2="16" y2="6.5" /></>,
  competitions: <><path d="M7 4h10v3a5 5 0 0 1-10 0z" /><path d="M7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3" /><line x1="12" y1="12" x2="12" y2="17" /><path d="M8.5 20h7l-.7-3h-5.6z" /></>,
  world: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="4.5" y1="7.5" x2="19.5" y2="7.5" /><line x1="4.5" y1="16.5" x2="19.5" y2="16.5" /></>,
  scouting: <><circle cx="10.5" cy="10.5" r="6" /><line x1="15" y1="15" x2="20" y2="20" /></>,
  transfers: <><path d="M7 7h12l-3-3" /><path d="M7 7l3 3" /><path d="M17 17H5l3 3" /><path d="M17 17l-3-3" /></>,
  clubInfo: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z" /><line x1="12" y1="10" x2="12" y2="15" /><line x1="12" y1="7.5" x2="12" y2="7.51" /></>,
  clubVision: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /></>,
  finances: <><ellipse cx="12" cy="6.5" rx="7" ry="2.6" /><path d="M5 6.5v11c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-11" /><path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" /></>,
  match: <><ellipse cx="12" cy="9" rx="8" ry="3.2" /><path d="M4 9v6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V9" /></>,
}

export function NavIcon({ name, size = 19 }: { name: IconKey; size?: number }): JSX.Element {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden style={{ display: 'block', flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  )
}
