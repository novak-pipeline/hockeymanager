/**
 * Sortable tables — one implementation, used by every table in the app.
 *
 * Playtest 2026-08-26 §D5: *"There needs to be more options for sorting on a
 * BUNCH of pages. I find myself trying to sort and arrange but its lacking on
 * most of them."* Before this, sorting was re-implemented from scratch on each
 * screen that happened to get attention (Squad, Data Hub, League Stats, Scout
 * Profile), each with its own arrow glyph, its own null handling and its own
 * bugs — so most tables simply never got any.
 *
 * The shape here is deliberately declarative: a screen describes its columns
 * once (label + how to read the sort value off a row) and gets the header row,
 * the click handling and the sorted rows back. Adding a sortable column to a
 * table is then one line, which is the only way a sweep of ~70 tables stays
 * maintained.
 *
 *   const COLS = sortColumns<Row>()([
 *     { key: 'name',   label: 'Player', value: (r) => r.name },
 *     { key: 'points', label: 'P',      value: (r) => r.points, align: 'right' },
 *   ])
 *   const { sorted, sortKey, dir, sortBy } = useTableSort(rows, COLS, { key: 'points' })
 *   <thead><tr><SortHeaders columns={COLS} sortKey={sortKey} dir={dir} onSort={sortBy} /></tr></thead>
 *
 * `th.sortable` is what scripts/dev/ui-audit.mjs presses, so every header built
 * through this helper is automatically covered by the "does this control
 * actually change anything" assertion — the exact failure mode of a sort header
 * that looks live and is not.
 */
import { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

export type SortDir = 'asc' | 'desc'

/** What a column reads off a row. `null`/`undefined` always sinks to the bottom. */
export type SortValue = number | string | boolean | null | undefined

export interface SortColumn<Row, K extends string = string> {
  /** Stable identifier — also the React key. */
  key: K
  /** Header text. */
  label: ReactNode
  /**
   * The value this column sorts on. Omit to make the column a plain,
   * unclickable header (a face, a button, a chip cluster — nothing to compare).
   */
  value?: (row: Row) => SortValue
  align?: 'left' | 'right'
  /** Native tooltip on the header — say what the column means, not what it does. */
  title?: string
  /** Direction applied on the FIRST click. Defaults: numbers desc, text asc. */
  initialDir?: SortDir
  /** Header `style` passthrough (widths, mostly). */
  style?: CSSProperties
  /** Extra classes on the `<th>`. */
  className?: string
}

/**
 * Curried identity that pins `Row` while letting TypeScript infer the literal
 * union of `key`s — so `sortKey` is `'name' | 'points'`, not `string`.
 */
export function sortColumns<Row>() {
  return <K extends string>(cols: ReadonlyArray<SortColumn<Row, K>>): ReadonlyArray<SortColumn<Row, K>> => cols
}

/**
 * Compare two sort values. Absent values sink regardless of direction (a player
 * with no games played belongs at the bottom of a save-percentage sort whether
 * you asked for best-first or worst-first, not at the top of one of them).
 * Strings compare with `localeCompare` so accented names file correctly.
 */
export function compareSortValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aMissing = a === null || a === undefined || (typeof a === 'number' && Number.isNaN(a))
  const bMissing = b === null || b === undefined || (typeof b === 'number' && Number.isNaN(b))
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  const sign = dir === 'asc' ? 1 : -1
  if (typeof a === 'string' || typeof b === 'string') {
    return sign * String(a).localeCompare(String(b))
  }
  const an = typeof a === 'boolean' ? (a ? 1 : 0) : a
  const bn = typeof b === 'boolean' ? (b ? 1 : 0) : b
  return sign * (an - bn)
}

/** Sort a copy of `rows` by one column. Stable — equal rows keep source order. */
export function sortRows<Row, K extends string>(
  rows: readonly Row[],
  columns: ReadonlyArray<SortColumn<Row, K>>,
  sortKey: K | null,
  dir: SortDir,
): Row[] {
  const col = columns.find((c) => c.key === sortKey)
  if (!col?.value) return [...rows]
  const read = col.value
  return rows
    .map((row, i) => ({ row, i, v: read(row) }))
    .sort((x, y) => compareSortValues(x.v, y.v, dir) || x.i - y.i)
    .map((x) => x.row)
}

/** The direction a column takes on its first click. */
export function initialDirFor<Row, K extends string>(
  col: SortColumn<Row, K> | undefined,
  sample: readonly Row[],
): SortDir {
  if (col?.initialDir) return col.initialDir
  if (!col?.value) return 'desc'
  // Text columns read naturally A→Z; numbers read naturally best-first.
  const read = col.value
  for (const row of sample) {
    const v = read(row)
    if (v === null || v === undefined) continue
    return typeof v === 'string' ? 'asc' : 'desc'
  }
  return 'desc'
}

/**
 * Table sort state + the sorted rows. Clicking the active column flips the
 * direction; clicking a new one adopts that column's natural direction.
 */
export function useTableSort<Row, K extends string>(
  rows: readonly Row[],
  columns: ReadonlyArray<SortColumn<Row, K>>,
  initial: { key: K | null; dir?: SortDir },
): { sorted: Row[]; sortKey: K | null; dir: SortDir; sortBy: (k: K) => void } {
  const [sortKey, setSortKey] = useState<K | null>(initial.key)
  const [dir, setDir] = useState<SortDir>(
    initial.dir ?? initialDirFor(columns.find((c) => c.key === initial.key), rows),
  )

  function sortBy(k: K): void {
    if (k === sortKey) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(k)
    setDir(initialDirFor(columns.find((c) => c.key === k), rows))
  }

  // `columns` is in the deps because a few screens build their column set
  // conditionally (a scout-assign column that only exists once you have scouts,
  // a "Move" column that only exists once there is a previous board). Callers
  // must therefore pass a module constant or a `useMemo`'d array — an inline
  // literal would re-sort on every render.
  const sorted = useMemo(() => sortRows(rows, columns, sortKey, dir), [rows, columns, sortKey, dir])

  return { sorted, sortKey, dir, sortBy }
}

/** The active-column arrow. Kept in one place so every table points the same way. */
function SortArrow({ dir }: { dir: SortDir }): JSX.Element {
  return <span style={{ marginLeft: 3, color: 'var(--accent)' }}>{dir === 'asc' ? '↑' : '↓'}</span>
}

/** One header cell. Use when a table hand-places its `<th>`s. */
export function SortTh<Row, K extends string>(props: {
  col: SortColumn<Row, K>
  sortKey: K | null
  dir: SortDir
  onSort: (k: K) => void
}): JSX.Element {
  const { col } = props
  const active = props.sortKey === col.key
  const sortable = !!col.value
  const cls = [col.align === 'right' ? 'num' : '', sortable ? 'sortable' : '', col.className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <th
      className={cls || undefined}
      style={{ whiteSpace: 'nowrap', ...col.style }}
      title={col.title}
      onClick={sortable ? () => props.onSort(col.key) : undefined}
      aria-sort={active ? (props.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {col.label}
      {active && sortable && <SortArrow dir={props.dir} />}
    </th>
  )
}

/** The whole header row's cells, in column order. */
export function SortHeaders<Row, K extends string>(props: {
  columns: ReadonlyArray<SortColumn<Row, K>>
  sortKey: K | null
  dir: SortDir
  onSort: (k: K) => void
}): JSX.Element {
  return (
    <>
      {props.columns.map((col) => (
        <SortTh key={col.key} col={col} sortKey={props.sortKey} dir={props.dir} onSort={props.onSort} />
      ))}
    </>
  )
}
