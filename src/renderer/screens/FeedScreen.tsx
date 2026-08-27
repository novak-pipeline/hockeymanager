/**
 * The Feed (docs/THE-FEED.md) — the league's social layer.
 *
 * Playtest F5: this used to be a single filtered column of paragraphs, which
 * reads as a second inbox no matter how good the prose is. What makes a
 * timeline a timeline is not the posts — it's the *accounts*: faces down the
 * left edge, a verified badge that tells you at a glance whether you're
 * reading a player, a beat writer or a club's comms department, a follow
 * button on every one of them, and a rail that suggests who else to follow.
 *
 * So the surface is now built around the author, not the post:
 *   · four timelines — For you / Following / Media / Wire
 *   · every account followable (engine: Career.toggleFollowAuthor), not just
 *     the four pundits that happened to be in the top strip
 *   · a Following view that is genuinely YOUR feed
 *   · click any account to open its profile timeline (bio, followers, posts)
 *   · Who to follow + Trending rails built from real league activity
 *
 * Posts still come from the salience engine — only what genuinely deviates
 * from the recorded expectations gets published. Nothing here invents facts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FeedView, FeedAuthor } from '../../worker/protocol'
import { authorFollowers } from '@engine/story/salience'
import { dayToDateISO } from '../../engine/career/views'
import { feedModelBridge, getFeedWriterEnabled } from '../lib/feedModel'
import { TeamCrest } from '../components/Crest'
import { Linkify } from '../components/Linkify'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { fmtDate } from '../components/format'
import { useNav } from '../components/NavContext'
import { ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

type Tab = 'foryou' | 'following' | 'media' | 'wire'

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'foryou', label: 'For you', hint: 'Everything the league is talking about' },
  { id: 'following', label: 'Following', hint: 'Only the accounts you follow' },
  { id: 'media', label: 'Media', hint: 'Reporters, columnists and models' },
  { id: 'wire', label: 'Wire', hint: 'The GM terminal — official and back-channel' },
]

/** What each account IS, and the colour its verified badge is drawn in. The
 *  badge colour is the whole point of the vocabulary: you should be able to
 *  tell a player from a journalist from a club without reading a word. */
const KIND_META: Record<string, { label: string; color: string }> = {
  player:  { label: 'Player',       color: 'var(--cyan)' },
  club:    { label: 'Club',         color: 'var(--green)' },
  gm:      { label: 'Front Office', color: 'var(--orange)' },
  insider: { label: 'Insider',      color: 'var(--pink)' },
  analyst: { label: 'Journalist',   color: 'var(--amber)' },
  stats:   { label: 'Analytics',    color: 'var(--violet-h)' },
  wire:    { label: 'League',       color: 'var(--muted)' },
}

function kindMeta(kind: string): { label: string; color: string } {
  return KIND_META[kind] ?? { label: kind, color: 'var(--muted)' }
}

/** A club's three-letter abbreviation, read off its official account's outlet
 *  ("Official · GRB"). The crest tile falls back to this text when no logo
 *  pack is installed, and an unlabelled tile is just a coloured square. */
function clubAbbr(feed: FeedView, teamId: string | undefined): string {
  if (!teamId) return ''
  return feed.authors[`club:${teamId}`]?.outlet?.split('· ')[1] ?? ''
}

const LS_LIKES = 'hockeyFeedLikes'

function readLikes(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_LIKES)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

/** Social-media time: recent posts read in days, older ones as a date. */
function stamp(post: { day: number; year: number; dateISO?: string }, today: number, thisYear: number): string {
  if (post.year === thisYear) {
    const ago = today - post.day
    if (ago <= 0) return 'now'
    if (ago === 1) return '1d'
    if (ago < 7) return `${ago}d`
    if (ago < 28) return `${Math.floor(ago / 7)}w`
  }
  const iso = post.dateISO ?? dayToDateISO(post.year, Math.max(1, post.day))
  return fmtDate(iso).replace(/ \d{4}$/, '')
}

export function FeedScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [tab, setTab] = useState<Tab>('foryou')
  const [account, setAccount] = useState<string | null>(null)
  const { data, loading, error, refetch } = useScreenData<FeedView>(
    () => client.getFeed(),
    (r) => (r.type === 'feed' ? r.feed : null)
  )

  const toggleFollow = useCallback(
    (authorId: string): void => {
      void (async () => {
        await client.toggleFollowAuthor(authorId)
        refetch()
      })()
    },
    [client, refetch]
  )

  return (
    <section className="stack">
      <ScreenHeader title="The Feed">
        <span className="muted small">
          {account ? 'Viewing one account' : TABS.find((t) => t.id === tab)?.hint}
        </span>
      </ScreenHeader>
      <ScreenStateNotices loading={loading && !data} error={error} empty={false} emptyText="" />
      {data && (
        <FeedBody
          feed={data}
          tab={tab}
          setTab={(t) => { setTab(t); setAccount(null) }}
          account={account}
          setAccount={setAccount}
          onTeam={(id) => nav.navigate('teamInfo', { teamId: id })}
          onPlayer={(id) => nav.navigate('player', { playerId: id })}
          onFollow={toggleFollow}
        />
      )}
    </section>
  )
}

function FeedBody(props: {
  feed: FeedView
  tab: Tab
  setTab: (t: Tab) => void
  account: string | null
  setAccount: (id: string | null) => void
  onTeam: (teamId: string) => void
  onPlayer: (playerId: string) => void
  onFollow: (authorId: string) => void
}): JSX.Element {
  const { feed, tab, account } = props
  const following = useMemo(() => new Set(feed.following ?? []), [feed.following])

  // "Today" is the newest post on the timeline — the feed has no clock of its
  // own, and every stamp is relative to the top of the stream anyway.
  const newest = feed.posts[0]
  const today = newest?.day ?? 0
  const thisYear = newest?.year ?? 0

  const posts = useMemo(() => {
    if (account) return feed.posts.filter((p) => p.authorId === account)
    switch (tab) {
      case 'following':
        return feed.posts.filter((p) => p.authorId && following.has(p.authorId))
      case 'media':
        return feed.posts.filter((p) => (p.channel ?? 'feed') === 'feed')
      case 'wire':
        return feed.posts.filter((p) => p.channel === 'wire')
      default:
        return feed.posts
    }
  }, [feed.posts, tab, account, following])

  const rewrites = useLocalWriter(posts, feed.authors)

  const [likes, setLikes] = useState<Set<string>>(readLikes)
  const like = useCallback((id: string): void => {
    setLikes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(LS_LIKES, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])

  const authorOf = (id: string | undefined): FeedAuthor | undefined => (id ? feed.authors[id] : undefined)
  const focused = account ? authorOf(account) : undefined

  return (
    <div className="feed-layout">
      <div className="feed-column">
        <nav className="feed-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={!account && tab === t.id}
              className={`feed-tab${!account && tab === t.id ? ' active' : ''}`}
              onClick={() => props.setTab(t.id)}
              title={t.hint}
            >
              {t.label}
              {t.id === 'following' && following.size > 0 && (
                <span className="feed-tab-count">{following.size}</span>
              )}
            </button>
          ))}
        </nav>

        {focused && (
          <AccountHeader
            author={focused}
            posts={feed.posts.filter((p) => p.authorId === focused.id).length}
            following={following.has(focused.id)}
            onFollow={() => props.onFollow(focused.id)}
            onBack={() => props.setAccount(null)}
          />
        )}

        {posts.length === 0 ? (
          <EmptyTimeline tab={tab} account={!!account} followed={following.size} />
        ) : (
          posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              author={authorOf(p.authorId)}
              clubAbbr={clubAbbr(feed, p.teamId)}
              stamp={stamp(p, today, thisYear)}
              body={rewrites[p.id]?.text ?? p.body}
              byModel={rewrites[p.id]?.source === 'model'}
              liked={likes.has(p.id)}
              following={!!p.authorId && following.has(p.authorId)}
              onLike={() => like(p.id)}
              onFollow={() => p.authorId && props.onFollow(p.authorId)}
              onAccount={() => p.authorId && props.setAccount(p.authorId)}
              onTeam={props.onTeam}
              onPlayer={props.onPlayer}
            />
          ))
        )}
      </div>

      <aside className="feed-rail">
        <WhoToFollow
          feed={feed}
          following={following}
          onFollow={props.onFollow}
          onAccount={props.setAccount}
        />
        <Trending feed={feed} onTeam={props.onTeam} />
        {following.size > 0 && (
          <FollowingList
            feed={feed}
            following={following}
            onFollow={props.onFollow}
            onAccount={props.setAccount}
          />
        )}
      </aside>
    </div>
  )
}

/* ────────────────────────── the post ────────────────────────── */

function PostCard(props: {
  post: FeedView['posts'][number]
  author: FeedAuthor | undefined
  /** The subject club's abbreviation, for the crest tile's fallback text. */
  clubAbbr: string
  stamp: string
  body: string
  byModel: boolean
  liked: boolean
  following: boolean
  onLike: () => void
  onFollow: () => void
  onAccount: () => void
  onTeam: (teamId: string) => void
  onPlayer: (playerId: string) => void
}): JSX.Element {
  const { post, author } = props
  const meta = kindMeta(author?.kind ?? 'wire')
  const likes = (post.engagement?.likes ?? 0) + (props.liked ? 1 : 0)
  return (
    <article className="feed-post">
      <button className="feed-avatar-btn" onClick={props.onAccount} title={`Open @${author?.handle ?? ''}`}>
        <AccountAvatar author={author} abbr={props.clubAbbr} size={44} />
      </button>
      <div className="feed-post-main">
        <div className="feed-post-head">
          <button className="feed-name" onClick={props.onAccount}>
            {author?.name ?? 'Unknown'}
          </button>
          <VerifiedBadge kind={author?.kind ?? 'wire'} />
          <span className="feed-handle">@{author?.handle ?? post.authorId}</span>
          <span className="feed-dot">·</span>
          <span className="feed-stamp">{props.stamp}</span>
          <span className="feed-kind" style={{ color: meta.color, borderColor: meta.color }}>
            {meta.label}
          </span>
          {post.rare && <span className="feed-rare">FIRST</span>}
          {post.authorId && (
            <button
              className={`feed-follow sm${props.following ? ' on' : ''}`}
              onClick={props.onFollow}
              title={props.following
                ? `Unfollow @${author?.handle ?? ''} — their posts stop reaching your inbox`
                : `Follow @${author?.handle ?? ''} — their posts land in your inbox`}
            >
              {props.following ? 'Following' : 'Follow'}
            </button>
          )}
        </div>

        <div className={`feed-body${props.byModel ? ' by-model' : ''}`}>
          <Linkify text={props.body} />
          {props.byModel && (
            <span className="feed-model-mark" title="Written by your local AI writer">
              <Icon size={14}><Icons.Sparkle /></Icon>
            </span>
          )}
        </div>

        <div className="feed-actions">
          <button
            className={`feed-action${props.liked ? ' liked' : ''}`}
            onClick={props.onLike}
            title={props.liked ? 'Undo' : 'Like this post'}
          >
            <Icon size={14}><Icons.Heart /></Icon> {fmtCount(likes)}
          </button>
          <span className="feed-action static" title="Reposts">
            <Icon size={14}><Icons.Trade /></Icon> {fmtCount(post.engagement?.reposts ?? 0)}
          </span>
          <span className="feed-spacer" />
          {post.playerId && (
            <button className="feed-link" onClick={() => props.onPlayer(post.playerId!)}>
              <Icon size={14}><Icons.Person /></Icon> profile
            </button>
          )}
          {post.teamId && (
            <button className="feed-link" onClick={() => props.onTeam(post.teamId!)}>
              <TeamCrest
                className="crest"
                teamId={post.teamId}
                abbr={props.clubAbbr}
                style={{ width: 16, height: 16, fontSize: 7 }}
              />
              {props.clubAbbr || 'club'}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

/** The badge. Colour IS the information — see KIND_META. */
function VerifiedBadge({ kind }: { kind: string }): JSX.Element {
  const meta = kindMeta(kind)
  return (
    <span className="feed-verified" style={{ color: meta.color }} title={`Verified ${meta.label.toLowerCase()} account`}>
      <Icon size={14}><Icons.Check /></Icon>
    </span>
  )
}

/** The club wears its crest. Everyone else — including the man who runs the
 *  club — is a person, and wears initials in his account's colour. */
function AccountAvatar(props: {
  author: FeedAuthor | undefined
  abbr?: string
  size: number
}): JSX.Element {
  const { author, size } = props
  const kind = author?.kind ?? 'wire'
  const teamId = kind === 'club' ? author?.id.split(':')[1] : undefined
  if (teamId) {
    return (
      <TeamCrest
        className="crest feed-avatar"
        teamId={teamId}
        abbr={props.abbr ?? author?.outlet?.split('· ')[1] ?? ''}
        style={{ width: size, height: size, fontSize: size * 0.3 }}
      />
    )
  }
  const meta = kindMeta(kind)
  const label = (author?.name ?? '??')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
  return (
    <span
      className="feed-avatar disc"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        color: meta.color,
        borderColor: meta.color,
      }}
    >
      {label}
    </span>
  )
}

/* ────────────────────────── account profile ────────────────────────── */

function AccountHeader(props: {
  author: FeedAuthor
  posts: number
  following: boolean
  onFollow: () => void
  onBack: () => void
}): JSX.Element {
  const { author } = props
  const meta = kindMeta(author.kind)
  return (
    <div className="feed-profile">
      <button className="feed-profile-back" onClick={props.onBack}>
        <Icon size={14}><Icons.Back /></Icon> Back to the timeline
      </button>
      <div className="feed-profile-row">
        <AccountAvatar author={author} size={56} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="feed-post-head">
            <span className="feed-name lg">{author.name}</span>
            <VerifiedBadge kind={author.kind} />
            <span className="feed-kind" style={{ color: meta.color, borderColor: meta.color }}>{meta.label}</span>
          </div>
          <div className="feed-handle">@{author.handle} · {author.outlet}</div>
          {author.bio && <p className="feed-bio">{author.bio}</p>}
          <div className="feed-profile-stats">
            <span><strong>{fmtCount(authorFollowers(author))}</strong> followers</span>
            <span><strong>{props.posts}</strong> posts on your timeline</span>
          </div>
        </div>
        <button className={`feed-follow${props.following ? ' on' : ''}`} onClick={props.onFollow}>
          {props.following ? 'Following' : 'Follow'}
        </button>
      </div>
    </div>
  )
}

/* ────────────────────────── the rails ────────────────────────── */

function AccountRow(props: {
  author: FeedAuthor
  following: boolean
  onFollow: () => void
  onAccount: () => void
}): JSX.Element {
  const meta = kindMeta(props.author.kind)
  return (
    <div className="feed-suggest">
      <button className="feed-suggest-id" onClick={props.onAccount}>
        <AccountAvatar author={props.author} size={32} />
        <span style={{ minWidth: 0 }}>
          <span className="feed-suggest-name">
            <span className="feed-suggest-text">{props.author.name}</span>
            <VerifiedBadge kind={props.author.kind} />
          </span>
          <span className="feed-suggest-sub">
            @{props.author.handle} · <span style={{ color: meta.color }}>{meta.label}</span>
          </span>
        </span>
      </button>
      <button
        className={`feed-follow sm${props.following ? ' on' : ''}`}
        onClick={props.onFollow}
        title={props.following ? 'Unfollow' : 'Follow'}
      >
        {props.following ? 'Following' : 'Follow'}
      </button>
    </div>
  )
}

function WhoToFollow(props: {
  feed: FeedView
  following: Set<string>
  onFollow: (id: string) => void
  onAccount: (id: string) => void
}): JSX.Element {
  // Suggest the loudest accounts you don't already follow: recent activity on
  // your own timeline first, then reach. A directory sorted by nothing is a
  // phone book; this is a recommendation.
  const suggestions = useMemo(() => {
    const activity = new Map<string, number>()
    for (const p of props.feed.posts.slice(0, 80)) {
      if (!p.authorId) continue
      activity.set(p.authorId, (activity.get(p.authorId) ?? 0) + 1)
    }
    return Object.values(props.feed.authors)
      .filter((a) => !props.following.has(a.id))
      .sort((a, b) =>
        (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0) ||
        authorFollowers(b) - authorFollowers(a))
      .slice(0, 6)
  }, [props.feed, props.following])

  if (suggestions.length === 0) return <></>
  return (
    <div className="feed-rail-card">
      <div className="feed-rail-head">Who to follow</div>
      {suggestions.map((a) => (
        <AccountRow
          key={a.id}
          author={a}
          following={false}
          onFollow={() => props.onFollow(a.id)}
          onAccount={() => props.onAccount(a.id)}
        />
      ))}
      <p className="feed-rail-note">
        Followed accounts reach your inbox. The biggest stories reach it either way.
      </p>
    </div>
  )
}

function FollowingList(props: {
  feed: FeedView
  following: Set<string>
  onFollow: (id: string) => void
  onAccount: (id: string) => void
}): JSX.Element {
  const rows = useMemo(
    () => [...props.following].map((id) => props.feed.authors[id]).filter((a): a is FeedAuthor => !!a),
    [props.feed.authors, props.following]
  )
  if (rows.length === 0) return <></>
  return (
    <div className="feed-rail-card">
      <div className="feed-rail-head">You follow {rows.length}</div>
      {rows.slice(0, 10).map((a) => (
        <AccountRow
          key={a.id}
          author={a}
          following
          onFollow={() => props.onFollow(a.id)}
          onAccount={() => props.onAccount(a.id)}
        />
      ))}
    </div>
  )
}

function Trending(props: { feed: FeedView; onTeam: (teamId: string) => void }): JSX.Element {
  // Real trending: which clubs the recent timeline is actually about. The
  // club accounts double as the name/abbr directory — a crest with no label
  // beside it is a coloured square, not a topic.
  const rows = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of props.feed.posts.slice(0, 60)) {
      if (!p.teamId) continue
      counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([teamId, n]) => {
        const club = props.feed.authors[`club:${teamId}`]
        return {
          teamId,
          n,
          name: club?.name ?? teamId,
          abbr: club?.outlet?.split('· ')[1] ?? '',
        }
      })
  }, [props.feed])

  if (rows.length === 0) return <></>
  return (
    <div className="feed-rail-card">
      <div className="feed-rail-head">Trending in the league</div>
      {rows.map((r, i) => (
        <button key={r.teamId} className="feed-trend" onClick={() => props.onTeam(r.teamId)} title={r.name}>
          <span className="feed-trend-rank">{i + 1}</span>
          <TeamCrest className="crest" teamId={r.teamId} abbr={r.abbr} style={{ width: 22, height: 22, fontSize: 9 }} />
          <span className="feed-trend-name">{r.name}</span>
          <span className="feed-trend-n">{r.n}</span>
        </button>
      ))}
    </div>
  )
}

function EmptyTimeline(props: { tab: Tab; account: boolean; followed: number }): JSX.Element {
  if (props.account) {
    return <div className="feed-empty">Nothing from this account on your timeline yet.</div>
  }
  if (props.tab === 'following') {
    return (
      <div className="feed-empty">
        {props.followed === 0
          ? 'You don’t follow anyone yet. Tap Follow on any account — players, clubs, reporters, rival front offices — and their posts collect here.'
          : 'The accounts you follow have been quiet. Follow a few more, or check For you.'}
      </div>
    )
  }
  if (props.tab === 'wire') {
    return <div className="feed-empty">The wire is quiet. Deadline week is when it stops being quiet.</div>
  }
  return (
    <div className="feed-empty">
      Quiet timeline. The feed lights up when something genuinely unexpected happens — keep
      playing; the league will give people something to talk about.
    </div>
  )
}

/* ────────────────────────── local-model rewrite pump ────────────────────────── */

/**
 * #149: opt-in local-model rewrite. When the GM enabled the local writer and
 * the model is downloaded, rewrite each visible post's body into prose in the
 * background; falls back to the template body until (or unless) that lands.
 */
function useLocalWriter(
  posts: FeedView['posts'],
  authors: Record<string, FeedAuthor>
): Record<string, { text: string; source: string }> {
  const [rewrites, setRewrites] = useState<Record<string, { text: string; source: string }>>({})
  const doneRef = useRef<Set<string>>(new Set())
  const key = posts.map((p) => p.id).join(',')
  useEffect(() => {
    const bridge = feedModelBridge()
    if (!bridge || !getFeedWriterEnabled()) return
    let cancelled = false
    void (async () => {
      const s = await bridge.status().catch(() => null)
      if (!s?.ready || cancelled) return
      // Build the prompt + writer on the renderer side (it has @engine); the
      // main process is a pure inference runtime. The writer sanitises + falls
      // back to the template body on any failure.
      const { localModelFeedWriter } = await import('@engine/story/feedWriter')
      const writer = localModelFeedWriter(async (prompt) => {
        const r = await bridge.infer({ system: prompt.system, user: prompt.user, maxTokens: prompt.maxWords * 2 })
        return r.ok ? r.text : ''
      })
      for (const p of posts) {
        if (doneRef.current.has(p.id)) continue
        doneRef.current.add(p.id)
        const post = {
          authorId: p.authorId ?? 'wire',
          channel: (p.channel ?? 'feed') as 'feed' | 'wire',
          text: p.body,
          facts: { kind: p.category, numbers: {} },
        }
        const author = (p.authorId ? authors[p.authorId] : undefined) ?? {
          id: 'wire', name: 'League Wire', handle: 'TheWire', kind: 'wire' as const, outlet: 'league sources',
        }
        const r = await writer.write(post, author).catch(() => null)
        if (r && !cancelled && r.source === 'model') setRewrites((prev) => ({ ...prev, [p.id]: r }))
      }
    })()
    return () => { cancelled = true }
    // Stable key: only re-run when the set of visible posts actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return rewrites
}
