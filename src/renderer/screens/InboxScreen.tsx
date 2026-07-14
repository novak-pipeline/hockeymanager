import { useEffect, useRef, useState } from 'react'
import type { NewsCategory } from '@domain'
import type { InboxView, NewsItem } from '../../worker/protocol'
import { PlayerLink, useNav } from '../components/NavContext'
import { Linkify } from '../components/Linkify'
import { PlayerFace } from '../components/PlayerFace'
import { fmtDate } from '../components/format'
import { dayToDateISO } from '../../engine/career/views'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { toast } from '../components/store'
import { useClient, useScreenData } from '../hooks/useSim'
import { feedModelBridge, getFeedWriterEnabled } from '../lib/feedModel'
import { buildIntentPrompt, parseIntentChoice, type IntentOption } from '../../engine/story/interactionIntent'
import { buildReactionPrompt, sanitizeReactionLine } from '../../engine/story/reactionVoice'
import { speakAs } from '../lib/speak'

/** Category metadata: icon, accent color, label, and FM-style "from" sender. */
const CATEGORY_META: Record<
  NewsCategory,
  { icon: string; colorClass: string; label: string; color: string; sender: string }
> = {
  result:    { icon: '⚡', colorClass: 'chip-accent', label: 'Result',    color: 'var(--violet)', sender: 'Match Report' },
  injury:    { icon: '🩹', colorClass: 'chip-danger', label: 'Injury',    color: 'var(--red)',    sender: 'Medical Staff' },
  trade:     { icon: '🔄', colorClass: 'chip-warn',   label: 'Trade',     color: 'var(--amber)',  sender: 'Front Office' },
  contract:  { icon: '📋', colorClass: 'chip-warn',   label: 'Contract',  color: 'var(--amber)',  sender: 'Front Office' },
  draft:     { icon: '🎯', colorClass: 'chip-accent', label: 'Draft',     color: 'var(--cyan)',   sender: 'Scouting Dept' },
  award:     { icon: '🏅', colorClass: 'chip-warn',   label: 'Award',     color: 'var(--amber)',  sender: 'League Office' },
  league:    { icon: '🏒', colorClass: '',            label: 'League',    color: 'var(--muted)',  sender: 'League Office' },
  milestone: { icon: '⭐', colorClass: 'chip-warn',   label: 'Milestone', color: 'var(--amber)',  sender: 'Club News' },
  playoffs:  { icon: '🏆', colorClass: 'chip-warn',   label: 'Playoffs',  color: 'var(--orange)', sender: 'League Office' },
  scouting:  { icon: '🔍', colorClass: 'chip-accent', label: 'Scouting',  color: 'var(--cyan)',   sender: 'Scouting Dept' },
}

/** FM-style "from" line: a press byline source or coach speaker wins over the
 *  generic department sender for the category. */
function senderOf(item: NewsItem): string {
  if (item.speaker) return item.speaker
  if (item.press?.byline) return item.press.byline.split('—')[0]!.trim()
  return CATEGORY_META[item.category].sender
}

const ALL_CATEGORIES: NewsCategory[] = [
  'result', 'injury', 'trade', 'contract', 'draft',
  'award', 'league', 'milestone', 'playoffs', 'scouting',
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
  return fmtDate(item.dateISO ?? dayToDateISO(item.year, item.day))
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

  // Spacebar advances to the next message. These hooks must run on every render
  // (before any early return) to keep React's hook order stable; the ref is
  // pointed at the live selectNext once data is available, below.
  const selectNextRef = useRef<() => boolean>(() => false)
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.code !== 'Space' && e.key !== ' ') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // Only consume Space if there's an unread to step to; otherwise let the
      // global handler advance the day (the inbox is clear).
      if (selectNextRef.current()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Deep-link: a dashboard message click arrives with the exact item to open.
  const openedFromParam = useRef(false)
  useEffect(() => {
    if (openedFromParam.current) return
    const id = nav.params.newsId
    if (!id || !data) return
    const item = data.items.find((i) => i.id === id)
    if (item) {
      openedFromParam.current = true
      setSelected(item)
    }
  }, [data, nav.params.newsId])

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

  // Unread first, then newest first. Read messages fall to the bottom (greyed
  // out) — the same order drives Space-to-advance through the feed.
  const ordered = [...visible].sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1
    if (b.day !== a.day) return b.day - a.day
    return b.id.localeCompare(a.id)
  })
  const unreadItems = ordered.filter((i) => !i.read)
  const readItems = ordered.filter((i) => i.read)

  // Open a message WITHOUT marking it read — instead mark the one you're
  // LEAVING as read. The message you're currently reading stays in the Unread
  // section (highlighted) until you move on, so it's clear where you are in the
  // list; advancing shrinks the unread pile one at a time.
  async function handleSelect(item: NewsItem) {
    const leaving = selected
    setSelected(item)
    if (leaving && leaving.id !== item.id && !leaving.read) {
      await client.markNewsRead([leaving.id])
      refetch()
    }
  }

  async function handleMarkAllRead() {
    const unreadIds = items.filter((it) => !it.read).map((it) => it.id)
    if (unreadIds.length === 0) return
    await client.markNewsRead(unreadIds)
    refetch()
  }

  // Unread, OLDEST first — Space works the pile from the bottom of the list up
  // to the newest. (unreadItems is newest-first, so reverse for traversal.)
  const unreadOldestFirst = [...unreadItems].reverse()

  // Advance to the next unread (oldest remaining, excluding the current one).
  // Opening it via handleSelect marks the one you LEFT read, so the pile shrinks
  // bottom-up. When only the open message is left unread, this Space clears it
  // (so the count hits zero and the NEXT Space can sim). Returns true if it
  // handled the key (so the global sim hotkey stays out of the way).
  function selectNext(): boolean {
    const next = unreadOldestFirst.find((i) => i.id !== selected?.id)
    if (next) { void handleSelect(next); return true }
    if (selected && !selected.read) { void client.markNewsRead([selected.id]).then(() => refetch()); return true }
    return false
  }

  // Point the keyboard handler (registered above, before the guards) at the
  // current selectNext closure.
  selectNextRef.current = selectNext

  /** One message row. Read rows are greyed; the selected row is highlighted. */
  function renderRow(item: NewsItem): JSX.Element {
    const meta = CATEGORY_META[item.category]
    const isSelected = selected?.id === item.id
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleSelect(item)}
        style={{
          display: 'grid',
          gridTemplateColumns: '44px 1fr',
          gap: 'var(--sp-2)',
          alignItems: 'center',
          padding: '10px var(--sp-3)',
          borderBottom: '1px solid var(--line)',
          background: isSelected
            ? 'rgba(var(--accent-rgb),0.13)'
            : item.read
            ? 'transparent'
            : 'rgba(var(--accent-rgb),0.04)',
          borderLeft: `3px solid ${isSelected ? 'var(--accent)' : item.read ? 'transparent' : meta.color}`,
          color: 'var(--text)',
          textAlign: 'left',
          cursor: 'pointer',
          font: 'inherit',
          width: '100%',
          borderTop: 'none',
          borderRight: 'none',
          opacity: item.read && !isSelected ? 0.55 : 1,
          transition: 'background 0.1s ease',
        }}
      >
        <RowThumbnail item={item} playerInfo={data.playerInfo} teamInfo={data.teamInfo} size={38} />
        <span style={{ minWidth: 0 }}>
          <div
            title={item.headline}
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
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, flexShrink: 0, display: 'inline-block' }} />
            <span
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontWeight: item.read ? 500 : 700,
                color: item.read ? 'var(--muted)' : 'var(--text)',
              }}
            >
              {senderOf(item)}
            </span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{itemDate(item)}</span>
          </div>
        </span>
      </button>
    )
  }

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
            className="btn btn-sm"
            onClick={selectNext}
            disabled={ordered.length === 0}
            title="Open the next unread message (Space)"
          >
            Next unread ▶
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleMarkAllRead}
            disabled={unread === 0}
          >
            Mark all read
          </button>
        </div>
      </ScreenHeader>

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

      {/* ── LW5: open player concerns — the knock on your office door ── */}
      {(data.interactions ?? []).map((concern) => (
        <ConcernCard key={concern.id} concern={concern} client={client} onDone={refetch} />
      ))}

      {/* ── Two-column layout (fills the viewport so the reading pane is large) ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '340px 1fr',
          gap: 'var(--sp-3)',
          alignItems: 'stretch',
          height: 'calc(100vh - 210px)',
          minHeight: 360,
        }}
      >
        {/* Left: message list — unread on top, read greyed at the bottom */}
        <div
          className="panel"
          style={{ padding: 0, overflow: 'hidden', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
        >
          {ordered.length === 0 ? (
            <div className="muted small" style={{ padding: 'var(--sp-4)', textAlign: 'center' }}>
              No messages{categoryFilter ? ' in this category' : ''}.
            </div>
          ) : (
            <div style={{ display: 'grid' }}>
              {unreadItems.length > 0 && <SectionHeader label={`Unread · ${unreadItems.length}`} />}
              {unreadItems.map((item) => renderRow(item))}
              {readItems.length > 0 && <SectionHeader label="Earlier" muted />}
              {readItems.map((item) => renderRow(item))}
            </div>
          )}
        </div>

        {/* Right: reading pane (fills the full column height) */}
        {selected ? (
          <div style={{ overflowY: 'auto', minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <ReadingPane
              item={selected}
              playerInfo={data.playerInfo}
              teamInfo={data.teamInfo}
              navigate={nav.navigate}
            />
          </div>
        ) : (
          <div
            className="panel"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              fontSize: 13,
              fontStyle: 'italic',
            }}
          >
            Select a message to read it · press Space for the next unread.
          </div>
        )}
      </div>
    </section>
  )
}

/** LW5: an open player concern — face, his words, and your response options.
 *  Rare by design (hard rate limits in the engine), so it can afford presence. */
function ConcernCard({
  concern,
  client,
  onDone,
}: {
  concern: NonNullable<InboxView['interactions']>[number]
  client: ReturnType<typeof useClient>
  onDone: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const serious = concern.severity === 'serious'

  // ── Freeform reply (local AI). The model only CLASSIFIES your words into one
  // of the same options the buttons offer; the deterministic engine resolves it.
  // Gated on the local writer being enabled + the model actually being ready.
  const [canType, setCanType] = useState(false)
  const [typing, setTyping] = useState(false)
  const [gmText, setGmText] = useState('')
  const [reading, setReading] = useState(false)
  const [readAs, setReadAs] = useState<IntentOption | null>(null)
  // The player's in-character spoken reply, authored after the engine resolves.
  const [voiced, setVoiced] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    if (!getFeedWriterEnabled()) return
    const bridge = feedModelBridge()
    if (!bridge) return
    void bridge.status().then((s) => {
      if (live) setCanType(Boolean(s.ready))
    })
    return () => {
      live = false
    }
  }, [])

  // Options carry only {id,label} in the view; in this engine the option id IS
  // the tone (promise/supportive/firm/dismissive), so we reuse it as the tone.
  const intentOptions: IntentOption[] = concern.options.map((o) => ({ id: o.id, label: o.label, tone: o.id }))

  async function respond(optionId: string): Promise<void> {
    if (busy) return
    setBusy(true)
    const res = await client.respondToInteraction(concern.id, optionId)
    if (res.type === 'error') {
      setBusy(false)
      toast(res.message ?? 'Could not respond.', 'error')
      return
    }
    // The engine has already resolved (morale/escalation decided). When the model
    // is available, voice the player's spoken reply in-character; the line is pure
    // presentation over the deterministic result and never alters it.
    const reaction = res.type === 'ok' ? res.reaction : undefined
    if (canType && reaction) {
      const bridge = feedModelBridge()
      if (bridge) {
        const p = buildReactionPrompt(reaction)
        const r = await bridge.infer({ system: p.system, user: p.user, maxTokens: p.maxTokens })
        const line = r.ok ? sanitizeReactionLine(r.text, reaction.playerName) : ''
        setBusy(false)
        const reply = line || reaction.outcome // fall back to the engine's prose
        setVoiced(reply)
        // The player answers back aloud, in his own cast voice.
        speakAs('player', reply, { seed: reaction.playerName })
        return
      }
    }
    setBusy(false)
    toast(res.type === 'ok' && res.note ? res.note : 'Message delivered.', 'info')
    onDone()
  }

  /** Send the freeform reply to the model, classify it, and show how it read. */
  async function readReply(): Promise<void> {
    const text = gmText.trim()
    if (!text || reading) return
    const bridge = feedModelBridge()
    if (!bridge) {
      // The opt-in local writer isn't loaded — say so rather than silently
      // doing nothing, so it's clear whether the AI is running.
      toast('The local AI writer isn\'t running — turn it on in Settings, or pick a response below.', 'info')
      return
    }
    setReading(true)
    setReadAs(null)
    try {
      const prompt = buildIntentPrompt({
        playerMessage: concern.message,
        gmReply: text,
        options: intentOptions,
      })
      const r = await bridge.infer({ system: prompt.system, user: prompt.user, maxTokens: prompt.maxTokens })
      const choice = r.ok ? parseIntentChoice(r.text, intentOptions) : null
      if (!choice) {
        toast('Could not read that clearly — pick a response below, or rephrase.', 'info')
        return
      }
      setReadAs(choice)
    } catch {
      // A hung or failed model must never leave the button stuck on "Reading…".
      toast('The writer hit a snag — pick a response below, or try again.', 'info')
    } finally {
      setReading(false)
    }
  }

  // Resolved: show the player's in-character spoken reply and let the GM close it.
  if (voiced !== null) {
    return (
      <div
        className="panel"
        style={{ borderLeft: '3px solid var(--success, #4caf7d)', padding: 'var(--sp-3) var(--sp-4)' }}
      >
        <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <PlayerFace faceId={concern.faceId} name={concern.playerName} size={44} />
          <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
            <PlayerLink playerId={concern.playerId} name={concern.playerName} />
            <div style={{ fontSize: 13.5, lineHeight: 1.55, fontStyle: 'italic' }}>“{voiced}”</div>
            <div className="row" style={{ marginTop: 2, gap: 'var(--sp-2)' }}>
              <button className="btn btn-sm" onClick={onDone}>Close</button>
              <button
                className="btn btn-sm btn-ghost"
                title="Hear it again"
                onClick={() => voiced && speakAs('player', voiced, { seed: concern.playerName })}
              >🔊</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="panel"
      style={{
        borderLeft: `3px solid ${serious ? 'var(--danger, #e05555)' : 'var(--amber, #d6a056)'}`,
        padding: 'var(--sp-3) var(--sp-4)',
      }}
    >
      <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
        <PlayerFace faceId={concern.faceId} name={concern.playerName} size={44} />
        <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
            <PlayerLink playerId={concern.playerId} name={concern.playerName} />
            <span className={`chip ${serious ? 'chip-danger' : 'chip-warn'}`} style={{ fontSize: 10 }}>
              {serious ? 'Serious' : 'Wants a word'}
            </span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}><Linkify text={concern.message} /></div>
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 2 }}>
            {concern.options.map((o) => (
              <button
                key={o.id}
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void respond(o.id)}
                title={o.id === 'promise' ? 'Promises go in the book — break one and he will remember.' : undefined}
              >
                {o.label}
              </button>
            ))}
            {canType && !typing && (
              <button
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => setTyping(true)}
                title="Reply in your own words — the local AI reads which response you mean."
              >
                ✍️ Reply in your own words
              </button>
            )}
          </div>

          {canType && typing && (
            <div className="stack" style={{ gap: 6, marginTop: 4 }}>
              <textarea
                className="input"
                rows={2}
                value={gmText}
                placeholder="Say it your way — “You’ll be on the top line by December, you have my word.”"
                disabled={busy || reading}
                onChange={(e) => {
                  setGmText(e.target.value)
                  setReadAs(null)
                }}
                style={{ resize: 'vertical', fontSize: 13, lineHeight: 1.5 }}
              />
              {readAs ? (
                <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Read as: <strong style={{ color: 'var(--text)' }}>{readAs.label}</strong>
                    {readAs.id === 'promise' ? ' — this goes in the book.' : ''}
                  </span>
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void respond(readAs.id)}>
                    Say it
                  </button>
                  <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setReadAs(null)}>
                    Rethink
                  </button>
                </div>
              ) : (
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  <button
                    className="btn btn-sm"
                    disabled={busy || reading || !gmText.trim()}
                    onClick={() => void readReply()}
                  >
                    {reading ? 'Reading…' : 'Read my reply'}
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={busy || reading}
                    onClick={() => {
                      setTyping(false)
                      setGmText('')
                      setReadAs(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** A small sticky divider between the Unread and Earlier (read) sections. */
function SectionHeader({ label, muted }: { label: string; muted?: boolean }): JSX.Element {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1,
        padding: '5px var(--sp-3)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: muted ? 'var(--muted)' : 'var(--accent)',
        background: 'var(--panel, #1a1a24)',
        borderBottom: '1px solid var(--line)',
        opacity: muted ? 0.8 : 1,
      }}
    >
      {label}
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
      style={{ padding: 0, overflow: 'hidden', minHeight: '100%' }}
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
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{senderOf(item)}</span>
                <span style={{ opacity: 0.5 }}>·</span>
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
                <Linkify text={para} />
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
    <div className="panel" style={{ padding: 0, overflow: 'hidden', minHeight: '100%' }}>
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
    <div className="panel" style={{ padding: 0, overflow: 'hidden', minHeight: '100%' }}>
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
              <Linkify text={para} />
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
