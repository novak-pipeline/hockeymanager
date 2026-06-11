import type { ReactNode } from 'react'

/** Shared presentational atoms used by every screen. */

export function ScreenHeader(props: { title: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="screen-header">
      <h1 className="screen-title">{props.title}</h1>
      {props.children}
    </div>
  )
}

export function Panel(props: {
  title?: string
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className={props.className ? `panel ${props.className}` : 'panel'}>
      {props.title !== undefined && <div className="panel-title">{props.title}</div>}
      {props.children}
    </div>
  )
}

/**
 * Inline status banner. 'warn' (amber) is the standard rendering for
 * `{ type: 'error' }` worker responses — e.g. v2 messages answering
 * "not implemented" before integration lands. Never crash on those.
 */
export function Notice(props: {
  kind: 'info' | 'warn' | 'danger'
  children: ReactNode
}): JSX.Element {
  return <div className={`notice notice-${props.kind}`}>{props.children}</div>
}

/** Collapsible raw-JSON dump used by screen stubs until the real UI lands. */
export function RawData(props: { value: unknown }): JSX.Element {
  return (
    <details className="panel raw-data">
      <summary>Raw view data</summary>
      <pre>{JSON.stringify(props.value, null, 2)}</pre>
    </details>
  )
}

/** Standard loading / error / empty wrapper for stubbed screens. */
export function ScreenStateNotices(props: {
  loading: boolean
  error: string | null
  empty: boolean
  emptyText: string
}): JSX.Element | null {
  if (props.error) return <Notice kind="warn">{props.error}</Notice>
  if (props.loading) return <Notice kind="info">Loading…</Notice>
  if (props.empty) return <Notice kind="info">{props.emptyText}</Notice>
  return null
}
