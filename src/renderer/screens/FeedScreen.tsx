/**
 * The Feed (docs/THE-FEED.md, Phase A) — the league's social layer.
 *
 * Posts come from the salience engine: only what genuinely deviates from the
 * recorded expectations gets published, so the stream reads like a feed worth
 * checking, not a firehose. Channel filters split the public feed from the
 * GM wire. Follows/curation land in Phase B; the writer in Phase C.
 */
import { useState } from 'react'
import type { FeedView } from '../../worker/protocol'
import { TeamCrest } from '../components/Crest'
import { useNav } from '../components/NavContext'
import { Notice, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

type Filter = 'all' | 'feed' | 'wire'

const KIND_BADGE: Record<string, string> = {
  insider: 'Insider',
  analyst: 'Analyst',
  stats: 'Model',
  wire: 'Wire',
}

export function FeedScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [filter, setFilter] = useState<Filter>('all')
  const { data, loading, error } = useScreenData<FeedView>(
    () => client.getFeed(),
    (r) => (r.type === 'feed' ? r.feed : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="The Feed">
        <div className="row" style={{ gap: 'var(--sp-1)' }}>
          {(['all', 'feed', 'wire'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`chip${filter === f ? ' chip-accent' : ''}`}
              style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'feed' ? 'Media' : 'GM Wire'}
            </button>
          ))}
        </div>
      </ScreenHeader>
      <ScreenStateNotices loading={loading && !data} error={error} empty={false} emptyText="" />
      {data && <FeedBody feed={data} filter={filter} onTeam={(id) => nav.navigate('teamInfo', { teamId: id })} />}
    </section>
  )
}

function FeedBody({ feed, filter, onTeam }: {
  feed: FeedView
  filter: Filter
  onTeam: (teamId: string) => void
}): JSX.Element {
  const posts = feed.posts.filter((p) => filter === 'all' || p.channel === filter)
  if (posts.length === 0) {
    return (
      <Notice kind="info">
        Quiet timeline. The feed lights up when something genuinely unexpected happens —
        keep playing; the league will give people something to talk about.
      </Notice>
    )
  }
  return (
    <div className="stack" style={{ gap: 'var(--sp-2)', maxWidth: 680 }}>
      {posts.map((p) => {
        const author = p.authorId ? feed.authors[p.authorId] : undefined
        return (
          <article
            key={p.id}
            className="panel"
            style={{ padding: '10px 14px', display: 'flex', gap: 'var(--sp-3)' }}
          >
            {/* avatar: author initials disc */}
            <div
              style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: author?.kind === 'wire' ? 'var(--bg0)' : 'rgba(var(--accent-rgb),0.22)',
                border: '1px solid var(--line)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 14,
              }}
            >
              {(author?.name ?? '??').split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row" style={{ gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{author?.name ?? 'Unknown'}</span>
                <span className="muted small">@{author?.handle ?? p.authorId}</span>
                {author && (
                  <span className="chip" style={{ fontSize: 9, padding: '1px 6px' }}>
                    {KIND_BADGE[author.kind] ?? author.kind}
                  </span>
                )}
                <span className="muted small">· Day {p.day}</span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.5, margin: '4px 0 6px' }}>{p.body}</div>
              <div className="row" style={{ gap: 'var(--sp-4)', alignItems: 'center' }}>
                {p.engagement && (
                  <>
                    <span className="muted small">♡ {fmtCount(p.engagement.likes)}</span>
                    <span className="muted small">⇄ {fmtCount(p.engagement.reposts)}</span>
                  </>
                )}
                {p.teamId && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '0 6px', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => onTeam(p.teamId!)}
                  >
                    <TeamCrest className="crest" teamId={p.teamId} abbr="" style={{ width: 16, height: 16, fontSize: 7 }} />
                    <span className="small">team page</span>
                  </button>
                )}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
