import { useState } from 'react'
import type { NewsCategory } from '@domain'
import type { InboxView, NewsItem, PlayerInteractionView } from '../../worker/protocol'
import { PlayerLink, useNav } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { fmtDate } from '../components/format'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { toast } from '../components/store'
import { useClient, useScreenData } from '../hooks/useSim'

/** Category metadata: icon character and accent color class. */
const CATEGORY_META: Record<
  NewsCategory,
  { icon: string; colorClass: string; label: string; color: string }
> = {
  result:    { icon: '⚡', colorClass: 'chip-accent', label: 'Result',    color: 'var(--violet)' },
  injury:    { icon: '🩹', colorClass: 'chip-danger', label: 'Injury',    color: 'var(--red)' },
  trade:     { icon: '🔄', colorClass: 'chip-warn',   label: 'Trade',     color: 'var(--amber)' },
  contract:  { icon: '📋', colorClass: 'chip-warn',   label: 'Contract',  color: 'var(--amber)' },
  draft:     { icon: '🎯', colorClass: 'chip-accent', label: 'Draft',     color: 'var(--cyan)' },
  award:     { icon: '🏅', colorClass: 'chip-warn',   label: 'Award',     color: 'var(--amber)' },
  league:    { icon: '🏒', colorClass: '',            label: 'League',    color: 'var(--muted)' },
  milestone: { icon: '⭐', colorClass: 'chip-warn',   label: 'Milestone', color: 'var(--amber)' },
  playoffs:  { icon: '🏆', colorClass: 'chip-warn',   label: 'Playoffs',  color: 'var(--orange)' },
}

const ALL_CATEGORIES: NewsCategory[] = [
  'result', 'injury', 'trade', 'contract', 'draft',
  'award', 'league', 'milestone', 'playoffs',
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

  async function handleRespond(interactionId: string, optionId: string) {
    const res = await client.respondToInteraction(interactionId, optionId)
    if (res.type === 'error') {
      toast(res.message, 'error')
    } else {
      refetch()
    }
  }

  const interactions = data.interactions ?? []

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      {/* ── Header ── */}
      <ScreenHeader title="Inbox">
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          {unread > 0 && (
            <span className="chip chip-accent" style={{ fontSize: 11 }}>
              {unread} unread
            </span>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleMarkAllRead}
            disabled={unread === 0}
          >
            Mark all read
          </button>
        </div>
      </ScreenHeader>

      {/* ── Player → GM concerns awaiting a response ── */}
      {interactions.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          {interactions.map((ix) => (
            <InteractionCard key={ix.id} interaction={ix} onRespond={handleRespond} />
          ))}
        </div>
      )}

      {/* ── Category filter chips ── */}
      <div
        className="row"
        style={{ flexWrap: 'wrap', gap: 'var(--sp-1)', paddingBottom: 2 }}
      >
        <button
          className={`chip${categoryFilter === null ? ' chip-accent' : ''}`}
          style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
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
              style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
              onClick={() => setCategoryFilter(active ? null : cat)}
            >
              {meta.icon} {meta.label}
            </button>
          )
        })}
      </div>

      {/* ── Two-column layout ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
          gap: 'var(--sp-3)',
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
            maxHeight: 'calc(100vh - 260px)',
            overflowY: 'auto',
          }}
        >
          {sorted.length === 0 ? (
            <div
              className="muted small"
              style={{ padding: 'var(--sp-4)', textAlign: 'center' }}
            >
              No messages{categoryFilter ? ' in this category' : ''}.
            </div>
          ) : (
            <div style={{ display: 'grid' }}>
              {sorted.map((item, idx) => {
                const meta = CATEGORY_META[item.category]
                const isSelected = selected?.id === item.id
                const isLast = idx === sorted.length - 1

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '34px 1fr',
                      gap: 'var(--sp-2)',
                      alignItems: 'center',
                      padding: '10px var(--sp-3)',
                      borderBottom: isLast ? 'none' : '1px solid var(--line)',
                      background: isSelected
                        ? 'rgba(139,92,246,0.13)'
                        : item.read
                        ? 'transparent'
                        : 'rgba(139,92,246,0.04)',
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
                      transition: 'background 0.1s ease',
                    }}
                  >
                    <RowThumbnail
                      item={item}
                      playerInfo={data.playerInfo}
                      teamInfo={data.teamInfo}
                      size={30}
                    />
                    <span style={{ minWidth: 0 }}>
                      {/* Headline */}
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: item.read ? 400 : 650,
                          lineHeight: 1.35,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: item.read ? 'var(--muted)' : 'var(--text)',
                        }}
                      >
                        {item.headline}
                      </div>
                      {/* Meta row */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          marginTop: 3,
                          fontSize: 10,
                          color: 'var(--muted)',
                          overflow: 'hidden',
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: meta.color,
                            flexShrink: 0,
                            display: 'inline-block',
                          }}
                        />
                        <span style={{ whiteSpace: 'nowrap' }}>{meta.label}</span>
                        <span style={{ opacity: 0.5 }}>·</span>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {itemDate(item)}
                        </span>
                        {item.press && (
                          <>
                            <span style={{ opacity: 0.5 }}>·</span>
                            <span
                              style={{
                                fontStyle: 'italic',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {item.press.byline.split('—')[0]?.trim()}
                            </span>
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
          <div
            className="panel"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 200,
              color: 'var(--muted)',
              fontSize: 13,
              fontStyle: 'italic',
            }}
          >
            Select a message to read it.
          </div>
        )}
      </div>
    </section>
  )
}

const KIND_LABEL: Record<string, string> = {
  iceTime:      'Wants a bigger role',
  future:       'Contract / future',
  unhappy:      'Unsettled',
  feud:         'Dressing-room friction',
  tradeRequest: 'Trade request',
}

/**
 * Player → GM concern card with response options. Compact accent strip on left,
 * small face thumbnail, label + message + buttons on one card row.
 */
function InteractionCard(props: {
  interaction: PlayerInteractionView
  onRespond: (interactionId: string, optionId: string) => void | Promise<void>
}): JSX.Element {
  const { interaction: ix, onRespond } = props
  const [busy, setBusy] = useState(false)
  const accent = ix.severity === 'serious' ? 'var(--danger, #ef4444)' : 'var(--amber, #f59e0b)'

  async function pick(optionId: string) {
    if (busy) return
    setBusy(true)
    await onRespond(ix.id, optionId)
    setBusy(false)
  }

  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--bg1)',
        border: `1px solid ${accent}44`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        gap: 'var(--sp-3)',
        padding: 'var(--sp-3) var(--sp-3)',
        alignItems: 'flex-start',
      }}
    >
      {/* Player face */}
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <PlayerFace faceId={ix.faceId} name={ix.playerName} size={40} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Top row: label + player link */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
            marginBottom: 4,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              color: accent,
              whiteSpace: 'nowrap',
            }}
          >
            {KIND_LABEL[ix.kind] ?? 'Player concern'}
          </span>
          <span style={{ color: 'var(--line)', fontSize: 10 }}>·</span>
          <PlayerLink playerId={ix.playerId} name={ix.playerName} className="small" />
        </div>

        {/* Message */}
        <p
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.55,
            color: 'var(--text)',
            maxWidth: '72ch',
          }}
        >
          {ix.message}
        </p>

        {/* Response buttons */}
        <div
          className="row"
          style={{ flexWrap: 'wrap', gap: 'var(--sp-1)', marginTop: 'var(--sp-2)' }}
        >
          {ix.options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void pick(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Shared accent top-bar used by all three reading pane variants. */
function PaneAccentBar(props: { gradient: string }): JSX.Element {
  return (
    <div style={{ height: 3, background: props.gradient, flexShrink: 0 }} />
  )
}

/** Shared category badge used in all three reading pane variants. */
function PaneBadge(props: { color: string; children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: 1.5,
        color: props.color,
        marginBottom: 4,
      }}
    >
      {props.children}
    </div>
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
    <div
      className="panel"
      style={{ padding: 0, overflow: 'hidden' }}
    >
      <PaneAccentBar gradient={`linear-gradient(90deg, ${meta.color}, ${meta.color}88)`} />

      <div style={{ padding: 'var(--sp-4)' }}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          {/* Header row: hero image + headline block */}
          <div className="row" style={{ gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
            <HeroImage item={item} playerInfo={playerInfo} teamInfo={teamInfo} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <PaneBadge color={meta.color}>
                {meta.icon} {meta.label}
              </PaneBadge>
              <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.25, marginBottom: 6 }}>
                {item.headline}
              </div>
              <div
                className="muted small"
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
              >
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
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)' }}>
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
      </div>
    </div>
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
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <PaneAccentBar gradient="linear-gradient(90deg, var(--violet), var(--amber))" />

      <div style={{ padding: 'var(--sp-4)' }}>
        {/* Badge + date */}
        <PaneBadge color={meta.color}>
          {meta.icon} {meta.label} · PRESS CONFERENCE
        </PaneBadge>
        <div className="muted" style={{ fontSize: 11, marginBottom: 'var(--sp-3)' }}>
          {itemDate(item)}
        </div>

        {/* Divider */}
        <div
          style={{ borderTop: '1px solid var(--amber)', opacity: 0.5, marginBottom: 'var(--sp-4)' }}
        />

        {/* Quote body */}
        <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
          {/* Coach photo */}
          <div style={{ flexShrink: 0 }}>
            <PlayerFace faceId={item.speakerFaceId} name={item.speaker ?? ''} size={60} />
          </div>

          {/* Quote text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 28,
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
                fontSize: 15,
                lineHeight: 1.65,
                fontStyle: 'italic',
                color: 'var(--text)',
                maxWidth: '58ch',
              }}
            >
              {item.body}
            </p>
            <div
              style={{
                marginTop: 'var(--sp-3)',
                fontSize: 12,
                fontWeight: 600,
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
            marginTop: 'var(--sp-4)',
            borderTop: '1px solid var(--line)',
            paddingTop: 'var(--sp-3)',
            fontSize: 11,
            color: 'var(--muted)',
            fontStyle: 'italic',
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
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <PaneAccentBar gradient="linear-gradient(90deg, var(--violet), var(--cyan))" />

      <div style={{ padding: 'var(--sp-4)' }}>
        {/* Masthead row: kind badge + author + date | hero image */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--sp-4)',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <div>
            <PaneBadge color="var(--violet-h)">
              {press.kind.toUpperCase().replace(/-/g, ' ')}
            </PaneBadge>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {outletAuthor}
              {outlet && (
                <span
                  style={{ marginLeft: 6, color: 'var(--violet)', fontStyle: 'italic' }}
                >
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
        <div
          style={{ borderTop: '2px solid var(--violet)', opacity: 0.35, marginBottom: 'var(--sp-3)' }}
        />

        {/* Big headline */}
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            lineHeight: 1.2,
            letterSpacing: -0.3,
            color: 'var(--text)',
            marginBottom: 'var(--sp-3)',
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
                marginBottom: i < bodyParagraphs.length - 1 ? 'var(--sp-3)' : 0,
                fontSize: 13,
                lineHeight: 1.75,
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
            style={{
              borderTop: '1px solid var(--line)',
              marginTop: 'var(--sp-4)',
              paddingTop: 'var(--sp-3)',
            }}
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
