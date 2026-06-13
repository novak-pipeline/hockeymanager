import { useState } from 'react'
import type { NewsCategory } from '@domain'
import type { InboxView, NewsItem } from '../../worker/protocol'
import { PlayerLink, useNav } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { fmtDate } from '../components/format'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/** Category metadata: icon character and accent color class. */
const CATEGORY_META: Record<
  NewsCategory,
  { icon: string; colorClass: string; label: string; color: string }
> = {
  result: { icon: '⚡', colorClass: 'chip-accent', label: 'Result', color: 'var(--violet)' },
  injury: { icon: '🩹', colorClass: 'chip-danger', label: 'Injury', color: 'var(--red)' },
  trade: { icon: '🔄', colorClass: 'chip-warn', label: 'Trade', color: 'var(--amber)' },
  contract: { icon: '📋', colorClass: 'chip-warn', label: 'Contract', color: 'var(--amber)' },
  draft: { icon: '🎯', colorClass: 'chip-accent', label: 'Draft', color: 'var(--cyan)' },
  award: { icon: '🏅', colorClass: 'chip-warn', label: 'Award', color: 'var(--amber)' },
  league: { icon: '🏒', colorClass: '', label: 'League', color: 'var(--muted)' },
  milestone: { icon: '⭐', colorClass: 'chip-warn', label: 'Milestone', color: 'var(--amber)' },
  playoffs: { icon: '🏆', colorClass: 'chip-warn', label: 'Playoffs', color: 'var(--orange)' },
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

/** Convert a 0xRRGGBB integer to a CSS hex string. */
function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/** Small team-color crest chip — an abbreviated circle. */
function TeamCrest(props: { abbr: string; primaryColor: number; size?: number }): JSX.Element {
  const { abbr, primaryColor, size = 32 } = props
  const bg = hexColor(primaryColor)
  const fontSize = Math.round(size * 0.32)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 800,
        color: '#fff',
        flexShrink: 0,
        userSelect: 'none',
        letterSpacing: -0.5,
        textTransform: 'uppercase',
        boxShadow: `0 0 0 2px ${bg}44`,
      }}
    >
      {abbr.slice(0, 3)}
    </div>
  )
}

/** Fallback circle when neither player nor team info is available. */
function CategoryCircle(props: { category: NewsCategory; size?: number }): JSX.Element {
  const { category, size = 32 } = props
  const meta = CATEGORY_META[category]
  const fontSize = Math.round(size * 0.45)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--bg2)',
        border: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        flexShrink: 0,
      }}
    >
      {meta.icon}
    </div>
  )
}

/**
 * Thumbnail for an inbox list row: PlayerFace if playerId, TeamCrest if teamId,
 * CategoryCircle otherwise.
 */
function RowThumbnail(props: {
  item: NewsItem
  playerInfo?: InboxView['playerInfo']
  teamInfo?: InboxView['teamInfo']
  size?: number
}): JSX.Element {
  const { item, playerInfo, teamInfo, size = 32 } = props
  if (item.playerId && playerInfo) {
    const info = playerInfo[item.playerId]
    if (info) {
      return <PlayerFace faceId={info.faceId} name={info.name} size={size} />
    }
  }
  if (item.teamId && teamInfo) {
    const info = teamInfo[item.teamId]
    if (info) {
      return <TeamCrest abbr={info.abbreviation} primaryColor={info.primaryColor} size={size} />
    }
  }
  return <CategoryCircle category={item.category} size={size} />
}

/**
 * Hero image for the reading pane: PlayerFace at large size if playerId,
 * TeamCrest at large size if teamId, nothing otherwise.
 */
function HeroImage(props: {
  item: NewsItem
  playerInfo?: InboxView['playerInfo']
  teamInfo?: InboxView['teamInfo']
}): JSX.Element | null {
  const { item, playerInfo, teamInfo } = props
  if (item.playerId && playerInfo) {
    const info = playerInfo[item.playerId]
    if (info) {
      return (
        <div style={{ flexShrink: 0 }}>
          <PlayerFace faceId={info.faceId} name={info.name} size={72} />
        </div>
      )
    }
  }
  if (item.teamId && teamInfo) {
    const info = teamInfo[item.teamId]
    if (info) {
      return (
        <div style={{ flexShrink: 0 }}>
          <TeamCrest abbr={info.abbreviation} primaryColor={info.primaryColor} size={72} />
        </div>
      )
    }
  }
  return null
}

/** Format item date: "Day 12 · Oct 2026" style. */
function itemDate(item: NewsItem): string {
  return `Day ${item.day} · ${fmtDate(`${item.year}-10-01`)}`
}

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
          gridTemplateColumns: '300px 1fr',
          gap: 'var(--sp-4)',
          alignItems: 'start',
          minHeight: 0,
        }}
      >
        {/* Left: message list */}
        <div
          className="panel"
          style={{
            padding: 0,
            overflow: 'hidden',
            maxHeight: 'calc(100vh - 220px)',
            overflowY: 'auto',
          }}
        >
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
                      gridTemplateColumns: '36px 1fr',
                      gap: 'var(--sp-2)',
                      alignItems: 'center',
                      padding: 'var(--sp-2) var(--sp-3)',
                      borderBottom: '1px solid var(--line)',
                      background: isSelected
                        ? 'rgba(139,92,246,0.14)'
                        : 'transparent',
                      borderLeft: `3px solid ${
                        isSelected
                          ? 'var(--accent)'
                          : item.read
                          ? 'transparent'
                          : meta.color
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
                    <RowThumbnail
                      item={item}
                      playerInfo={data.playerInfo}
                      teamInfo={data.teamInfo}
                      size={32}
                    />
                    <span style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: item.read ? 400 : 600,
                          lineHeight: 1.3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: item.read ? 'var(--text)' : 'var(--text)',
                        }}
                      >
                        {item.headline}
                      </div>
                      <div
                        className="muted"
                        style={{ fontSize: 10, marginTop: 2, display: 'flex', gap: 4, alignItems: 'center' }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: meta.color,
                            flexShrink: 0,
                            display: 'inline-block',
                          }}
                        />
                        <span>{meta.label}</span>
                        <span>·</span>
                        <span>{itemDate(item)}</span>
                        {item.press && (
                          <>
                            <span>·</span>
                            <span style={{ fontStyle: 'italic' }}>{item.press.byline.split('—')[0]?.trim()}</span>
                          </>
                        )}
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
          <ReadingPane
            item={selected}
            playerInfo={data.playerInfo}
            teamInfo={data.teamInfo}
            navigate={nav.navigate}
          />
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
  playerInfo?: InboxView['playerInfo']
  teamInfo?: InboxView['teamInfo']
  navigate: ReturnType<typeof useNav>['navigate']
}): JSX.Element {
  const { item, playerInfo, teamInfo, navigate } = props

  // Press articles render as a newspaper-style layout.
  if (item.press) {
    return (
      <PressArticlePane
        item={item}
        playerInfo={playerInfo}
        teamInfo={teamInfo}
        navigate={navigate}
      />
    )
  }

  // Coach-quote items render as a styled quote card.
  if (item.speaker) {
    return <CoachQuotePane item={item} navigate={navigate} />
  }

  const meta = CATEGORY_META[item.category]
  const bodyParagraphs = item.body.split('\n').filter((p) => p.trim().length > 0)

  return (
    <Panel>
      <div className="stack">
        {/* Header row: hero image + headline block */}
        <div className="row" style={{ gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
          <HeroImage item={item} playerInfo={playerInfo} teamInfo={teamInfo} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: meta.color,
                marginBottom: 4,
              }}
            >
              {meta.icon} {meta.label}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>
              {item.headline}
            </div>
            <div className="muted small" style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span>{itemDate(item)}</span>
              {item.playerId && playerInfo?.[item.playerId] && (
                <PlayerLink
                  playerId={item.playerId}
                  name={`→ ${playerInfo[item.playerId]!.name}`}
                  className="muted"
                />
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            borderTop: '1px solid var(--line)',
            paddingTop: 'var(--sp-3)',
          }}
        >
          {bodyParagraphs.map((para, i) => (
            <p
              key={i}
              style={{
                margin: 0,
                marginBottom: i < bodyParagraphs.length - 1 ? 'var(--sp-3)' : 0,
                fontSize: 13,
                lineHeight: 1.7,
                maxWidth: '62ch',
              }}
            >
              {para}
            </p>
          ))}
        </div>

        {/* Footer actions */}
        {(item.playerId || item.teamId) && (
          <div
            className="row"
            style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)' }}
          >
            {item.playerId && (
              <PlayerLink
                playerId={item.playerId}
                name="View player profile"
                className="btn btn-ghost"
              />
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

/**
 * Coach quote card — rendered when a NewsItem has a `speaker` field.
 * Shows the coach photo (or placeholder), the quote in large quotation marks,
 * and the attribution line "— {speaker}, Head Coach".
 */
function CoachQuotePane(props: {
  item: NewsItem
  navigate: ReturnType<typeof useNav>['navigate']
}): JSX.Element {
  const { item } = props
  const meta = CATEGORY_META[item.category]

  return (
    <div
      className="panel"
      style={{
        background: 'var(--bg1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      {/* Accent top-bar */}
      <div
        style={{
          height: 3,
          background: 'linear-gradient(90deg, var(--violet), var(--amber))',
        }}
      />

      <div style={{ padding: 'var(--sp-5)' }}>
        {/* Badge + date */}
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            color: meta.color,
            marginBottom: 6,
          }}
        >
          {meta.icon} {meta.label} · PRESS CONFERENCE
        </div>
        <div className="muted" style={{ fontSize: 11, marginBottom: 'var(--sp-4)' }}>
          {itemDate(item)}
        </div>

        {/* Divider */}
        <div style={{ borderTop: '2px solid var(--amber)', marginBottom: 'var(--sp-5)' }} />

        {/* Quote body */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-4)',
            alignItems: 'flex-start',
          }}
        >
          {/* Coach photo */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <PlayerFace
              faceId={item.speakerFaceId}
              name={item.speaker ?? ''}
              size={72}
            />
          </div>

          {/* Quote text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 32,
                lineHeight: 0.8,
                color: 'var(--amber)',
                fontFamily: 'Georgia, serif',
                marginBottom: 6,
                userSelect: 'none',
              }}
            >
              "
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 16,
                lineHeight: 1.65,
                fontStyle: 'italic',
                color: 'var(--text)',
                maxWidth: '54ch',
              }}
            >
              {item.body}
            </p>
            <div
              style={{
                marginTop: 'var(--sp-3)',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--muted)',
              }}
            >
              — {item.speaker}, Head Coach
            </div>
          </div>
        </div>

        {/* Headline below as context */}
        <div
          style={{
            marginTop: 'var(--sp-5)',
            borderTop: '1px solid var(--line)',
            paddingTop: 'var(--sp-3)',
            fontSize: 12,
            color: 'var(--muted)',
          }}
        >
          {item.headline}
        </div>
      </div>
    </div>
  )
}

/**
 * Newspaper-style reading pane for press-corps articles: byline header,
 * large headline, article-styled body with paragraph breaks.
 */
function PressArticlePane(props: {
  item: NewsItem
  playerInfo?: InboxView['playerInfo']
  teamInfo?: InboxView['teamInfo']
  navigate: ReturnType<typeof useNav>['navigate']
}): JSX.Element {
  const { item, playerInfo, teamInfo, navigate } = props
  const press = item.press!
  const [outletAuthor, outlet] = press.byline.includes('—')
    ? [press.byline.split('—')[0]?.trim() ?? press.byline, press.byline.split('—')[1]?.trim() ?? '']
    : [press.byline, '']

  const bodyParagraphs = item.body.split('\n').filter((p) => p.trim().length > 0)

  return (
    <div
      className="panel"
      style={{
        background: 'var(--bg1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      {/* Press article accent top-bar */}
      <div
        style={{
          height: 3,
          background: 'linear-gradient(90deg, var(--violet), var(--cyan))',
        }}
      />

      <div style={{ padding: 'var(--sp-5)' }}>
        {/* Masthead row: kind badge + date + hero image */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--sp-4)',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 1.5,
                color: 'var(--violet-h)',
                marginBottom: 4,
              }}
            >
              {press.kind.toUpperCase().replace(/-/g, ' ')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {outletAuthor}
              {outlet && (
                <span style={{ marginLeft: 6, color: 'var(--violet)', fontStyle: 'italic' }}>
                  {outlet}
                </span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              {itemDate(item)}
            </div>
          </div>
          <HeroImage item={item} playerInfo={playerInfo} teamInfo={teamInfo} />
        </div>

        {/* Divider */}
        <div style={{ borderTop: '2px solid var(--violet)', marginBottom: 'var(--sp-4)' }} />

        {/* Big headline */}
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            lineHeight: 1.2,
            letterSpacing: -0.4,
            color: 'var(--text)',
            marginBottom: 'var(--sp-4)',
            maxWidth: '62ch',
          }}
        >
          {item.headline}
        </div>

        {/* Article body — paragraphs */}
        <div style={{ maxWidth: '62ch' }}>
          {bodyParagraphs.map((para, i) => (
            <p
              key={i}
              style={{
                margin: 0,
                marginBottom: i < bodyParagraphs.length - 1 ? 'var(--sp-4)' : 0,
                fontSize: 14,
                lineHeight: 1.8,
                color: 'var(--text)',
              }}
            >
              {para}
            </p>
          ))}
        </div>

        {/* Footer: player/team links */}
        {(item.playerId || item.teamId) && (
          <div
            className="row"
            style={{ borderTop: '1px solid var(--line)', marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-3)' }}
          >
            {item.playerId && (
              <PlayerLink
                playerId={item.playerId}
                name="View player profile"
                className="btn btn-ghost"
              />
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
    </div>
  )
}
