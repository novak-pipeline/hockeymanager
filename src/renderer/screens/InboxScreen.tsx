import { useState } from 'react'
import type { NewsCategory } from '@domain'
import type { InboxView, NewsItem } from '../../worker/protocol'
import { PlayerLink, useNav } from '../components/NavContext'
import { fmtDate } from '../components/format'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/** Category metadata: icon character and accent color class. */
const CATEGORY_META: Record<
  NewsCategory,
  { icon: string; colorClass: string; label: string }
> = {
  result: { icon: '⚡', colorClass: 'chip-accent', label: 'Result' },
  injury: { icon: '🩹', colorClass: 'chip-danger', label: 'Injury' },
  trade: { icon: '🔄', colorClass: 'chip-warn', label: 'Trade' },
  contract: { icon: '📋', colorClass: 'chip-warn', label: 'Contract' },
  draft: { icon: '🎯', colorClass: 'chip-accent', label: 'Draft' },
  award: { icon: '🏅', colorClass: 'chip-warn', label: 'Award' },
  league: { icon: '🏒', colorClass: '', label: 'League' },
  milestone: { icon: '⭐', colorClass: 'chip-warn', label: 'Milestone' },
  playoffs: { icon: '🏆', colorClass: 'chip-warn', label: 'Playoffs' },
}

const ALL_CATEGORIES: NewsCategory[] = [
  'result',
  'injury',
  'trade',
  'contract',
  'draft',
  'award',
  'league',
  'milestone',
  'playoffs',
]

export function InboxScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const { data, loading, error, refetch } = useScreenData<InboxView>(
    () => client.getInbox(),
    (r) => (r.type === 'inbox' ? r.inbox : null)
  )

  const [selected, setSelected] = useState<NewsItem | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<NewsCategory | null>(null)

  if (error) {
    return (
      <section>
        <ScreenHeader title="Inbox" />
        <Notice kind="warn">{error}</Notice>
      </section>
    )
  }
  if (!data) {
    return (
      <section>
        <ScreenHeader title="Inbox" />
        <Notice kind="info">{loading ? 'Loading…' : 'No messages.'}</Notice>
      </section>
    )
  }

  const items = data.items
  const unread = data.unread

  // Apply category filter
  const visible = categoryFilter
    ? items.filter((it) => it.category === categoryFilter)
    : items

  // Sort: unread first, then newest day first, then id desc
  const sorted = [...visible].sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1
    if (b.day !== a.day) return b.day - a.day
    return b.id.localeCompare(a.id)
  })

  async function handleSelect(item: NewsItem) {
    setSelected(item)
    if (!item.read) {
      await client.markNewsRead([item.id])
      refetch()
    }
  }

  async function handleMarkAllRead() {
    const unreadIds = items.filter((it) => !it.read).map((it) => it.id)
    if (unreadIds.length === 0) return
    await client.markNewsRead(unreadIds)
    refetch()
  }

  return (
    <section className="stack">
      <ScreenHeader title="Inbox">
        <div className="row">
          {unread > 0 && <span className="chip chip-accent">{unread} unread</span>}
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={handleMarkAllRead}
            disabled={unread === 0}
          >
            Mark all read
          </button>
        </div>
      </ScreenHeader>

      {/* Category filter chips */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <button
          className={`chip${categoryFilter === null ? ' chip-accent' : ''}`}
          style={{ cursor: 'pointer', border: 'none' }}
          onClick={() => setCategoryFilter(null)}
        >
          All
        </button>
        {ALL_CATEGORIES.filter((cat) => items.some((it) => it.category === cat)).map((cat) => {
          const meta = CATEGORY_META[cat]
          const active = categoryFilter === cat
          return (
            <button
              key={cat}
              className={`chip${active ? ` ${meta.colorClass}` : ''}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setCategoryFilter(active ? null : cat)}
            >
              {meta.icon} {meta.label}
            </button>
          )
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
          gap: 'var(--sp-4)',
          alignItems: 'start',
        }}
      >
        {/* Left: message list */}
        <div className="panel inbox-list" style={{ padding: 0 }}>
          {sorted.length === 0 ? (
            <div className="muted small" style={{ padding: 'var(--sp-4)' }}>
              No messages{categoryFilter ? ' in this category' : ''}.
            </div>
          ) : (
            <div style={{ display: 'grid' }}>
              {sorted.map((item) => {
                const meta = CATEGORY_META[item.category]
                const isSelected = selected?.id === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '24px 1fr',
                      gap: 'var(--sp-2)',
                      alignItems: 'start',
                      padding: 'var(--sp-3) var(--sp-4)',
                      borderBottom: '1px solid var(--line)',
                      background: isSelected
                        ? 'rgba(139,92,246,0.14)'
                        : 'transparent',
                      borderLeft: `3px solid ${
                        isSelected
                          ? 'var(--accent)'
                          : item.read
                          ? 'transparent'
                          : 'var(--accent2)'
                      }`,
                      color: 'var(--text)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      font: 'inherit',
                      width: '100%',
                      borderTop: 'none',
                      borderRight: 'none',
                    }}
                  >
                    <span style={{ fontSize: 15, lineHeight: 1.4 }}>{meta.icon}</span>
                    <span style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: item.read ? 400 : 600,
                          lineHeight: 1.3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.headline}
                      </div>
                      <div
                        className="muted"
                        style={{ fontSize: 11, marginTop: 2, display: 'flex', gap: 6 }}
                      >
                        <span>Day {item.day}</span>
                        <span>·</span>
                        <span>{fmtDate(`${item.year}-10-01`)}</span>
                        <span>·</span>
                        <span>{meta.label}</span>
                      </div>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: reading pane */}
        {selected ? (
          <ReadingPane item={selected} navigate={nav.navigate} />
        ) : (
          <Panel>
            <span className="muted small">Select a message to read it.</span>
          </Panel>
        )}
      </div>
    </section>
  )
}

function ReadingPane(props: {
  item: NewsItem
  navigate: ReturnType<typeof useNav>['navigate']
}): JSX.Element {
  const { item, navigate } = props
  const meta = CATEGORY_META[item.category]

  return (
    <Panel>
      <div className="stack">
        <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <span style={{ fontSize: 22 }}>{meta.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
              {item.headline}
            </div>
            <div className="muted small" style={{ marginTop: 4, display: 'flex', gap: 8 }}>
              <span className={`chip ${meta.colorClass}`} style={{ fontSize: 10 }}>
                {meta.label}
              </span>
              <span>Day {item.day}</span>
              <span>·</span>
              <span>{fmtDate(`${item.year}-10-01`)}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            borderTop: '1px solid var(--line)',
            paddingTop: 'var(--sp-3)',
            lineHeight: 1.6,
            fontSize: 13,
          }}
        >
          {item.body}
        </div>

        {(item.playerId || item.teamId) && (
          <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)' }}>
            {item.playerId && (
              <PlayerLink playerId={item.playerId} name="View player profile" className="btn btn-ghost" />
            )}
            {!item.playerId && item.teamId && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => navigate('squad')}
              >
                View squad
              </button>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
