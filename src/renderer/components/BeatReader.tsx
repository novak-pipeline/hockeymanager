/**
 * The Beat — a club's daily outlet as a News reader (docs/MEDIA-BEAT.md).
 *
 * The Feed is where the beat writer POSTS his links; this is where the pieces
 * live: a masthead with the outlet and its writer, section filters, the
 * article list, and a proper article view (byline, dek, body, lines, grades
 * tables, the mailbag's Q&A). Your club's outlet is the persisted archive;
 * switch clubs to read the lighter coverage every other club gets.
 */
import { useEffect, useMemo, useState } from 'react'
import type { BeatArticle, BeatView } from '../../worker/protocol'
import { useClient, useScreenData } from '../hooks/useSim'
import { Icon } from './primitives'
import { Icons } from './icons'
import { Linkify } from './Linkify'
import { fmtDate } from './format'
import { ScreenStateNotices } from './ui'

type Section = 'all' | 'notebook' | 'gameday' | 'grades' | 'mailbag' | 'daily' | 'injury' | 'features'

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'all', label: 'Latest' },
  { id: 'notebook', label: 'Notebooks' },
  { id: 'gameday', label: 'Gameday' },
  { id: 'grades', label: 'Grades' },
  { id: 'mailbag', label: 'Mailbag' },
  { id: 'daily', label: 'The Daily' },
  { id: 'injury', label: 'Injuries' },
  { id: 'features', label: 'Features' },
]

const KIND_LABEL: Record<string, string> = {
  notebook: 'Notebook',
  gameday: 'Gameday',
  grades: 'Grades',
  moves: 'Roster moves',
  injury: 'Injury',
  mailbag: 'Mailbag',
  daily: 'The Daily',
  prospects: 'Prospects',
  feature: 'Feature',
  claim: 'On the record',
  hotSeat: 'Hot seat',
}

function inSection(a: BeatArticle, s: Section): boolean {
  switch (s) {
    case 'all':
      return true
    case 'features':
      return a.kind === 'feature' || a.kind === 'claim' || a.kind === 'hotSeat' || a.kind === 'prospects' || a.kind === 'moves'
    default:
      return a.kind === s
  }
}

function gradeColor(g: string): string {
  if (g.startsWith('A')) return 'var(--green)'
  if (g.startsWith('B')) return 'var(--cyan)'
  if (g.startsWith('C')) return 'var(--amber)'
  return 'var(--red)'
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
}

export function BeatReader(props: {
  /** Open this article on arrival (a Feed link post was clicked). */
  articleId?: string | null
  onArticleShown?: () => void
  /** Open another club's beat on arrival (from its club page). */
  teamId?: string
}): JSX.Element {
  const client = useClient()
  const [teamId, setTeamId] = useState<string | undefined>(props.teamId)
  const [section, setSection] = useState<Section>('all')
  const [openId, setOpenId] = useState<string | null>(props.articleId ?? null)
  const { data, loading, error, refetch } = useScreenData<BeatView>(
    () => client.getBeat(teamId),
    (r) => (r.type === 'beat' ? r.beat : null),
  )
  useEffect(() => {
    refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])
  useEffect(() => {
    if (props.articleId) {
      setTeamId(undefined)
      setOpenId(props.articleId)
      props.onArticleShown?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.articleId])

  const list = useMemo(() => (data ? data.articles.filter((a) => inSection(a, section)) : []), [data, section])
  const open = data?.articles.find((a) => a.id === openId) ?? null

  return (
    <div className="beat-reader">
      <ScreenStateNotices loading={loading && !data} error={error} empty={false} emptyText="" />
      {data && (
        <>
          <header className="beat-masthead">
            <div className="beat-masthead-row">
              <span className="beat-mark">
                <Icon size={18}><Icons.News /></Icon>
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="beat-outlet">{data.outlet}</div>
                <div className="beat-tagline">{data.tagline}</div>
              </div>
              <select
                className="beat-club"
                value={data.teamId}
                onChange={(e) => {
                  setOpenId(null)
                  setTeamId(e.target.value)
                }}
                title="Read another club's beat"
              >
                {data.clubs.map((c) => (
                  <option key={c.teamId} value={c.teamId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="beat-byline-row">
              <span className="beat-avatar">{initials(data.writer.name)}</span>
              <span>
                By <strong>{data.writer.name}</strong> <span className="muted">@{data.writer.handle}</span>
              </span>
              <span className="beat-chip">{data.market.label}</span>
              {data.standing && (
                <span className="beat-chip" title="Your standing with this writer frames how he covers your club (Media Circuit).">
                  With you: {data.standing}
                </span>
              )}
              {data.light && <span className="beat-chip muted">Coverage from around the league</span>}
            </div>
            {!open && (
              <nav className="beat-sections" role="tablist">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    role="tab"
                    aria-selected={section === s.id}
                    className={`beat-section${section === s.id ? ' active' : ''}`}
                    onClick={() => setSection(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </nav>
            )}
          </header>

          {open ? (
            <ArticleView article={open} writer={data.writer.name} outlet={data.outlet} onBack={() => setOpenId(null)} />
          ) : list.length === 0 ? (
            <div className="feed-empty">
              {data.light
                ? 'Nothing filed on this club yet.'
                : 'Nothing in this section yet. The beat files every day once camp opens.'}
            </div>
          ) : (
            <div className="beat-list">
              {list.slice(0, 80).map((a) => (
                <button key={a.id} className="beat-card" onClick={() => setOpenId(a.id)}>
                  <div className="beat-card-meta">
                    <span className="beat-kind">{KIND_LABEL[a.kind] ?? a.kind}</span>
                    <span className="muted">{fmtDate(a.dateISO)}</span>
                    {a.inbox && (
                      <span className="beat-chip" title="This piece also went to your inbox">
                        <Icon size={14}><Icons.Mail /></Icon> Inbox
                      </span>
                    )}
                  </div>
                  <div className="beat-card-head">{a.headline}</div>
                  <div className="beat-card-dek">{a.dek}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ArticleView(props: { article: BeatArticle; writer: string; outlet: string; onBack: () => void }): JSX.Element {
  const a = props.article
  return (
    <article className="beat-article">
      <button className="feed-profile-back" onClick={props.onBack}>
        <Icon size={14}><Icons.Back /></Icon> All stories
      </button>
      <div className="beat-card-meta">
        <span className="beat-kind">{KIND_LABEL[a.kind] ?? a.kind}</span>
        <span className="muted">{fmtDate(a.dateISO)}</span>
      </div>
      <h2 className="beat-article-head">{a.headline}</h2>
      <p className="beat-article-dek">{a.dek}</p>
      <div className="beat-article-byline">
        <span className="beat-avatar sm">{initials(props.writer)}</span>
        {props.writer} <span className="muted">· {props.outlet}</span>
      </div>
      <div className="beat-article-body">
        {a.body.map((p, i) => (
          <p key={i}>
            <Linkify text={p} />
          </p>
        ))}
      </div>

      {a.grades && a.grades.length > 0 && (
        <div className="beat-block">
          <div className="beat-block-title">Player grades</div>
          <table className="beat-grades">
            <tbody>
              {a.grades.map((g) => (
                <tr key={g.playerId}>
                  <td className="beat-grade" style={{ color: gradeColor(g.grade), borderColor: gradeColor(g.grade) }}>
                    {g.grade}
                  </td>
                  <td className="beat-grade-name">
                    <Linkify text={g.name} /> <span className="muted">{g.pos}</span>
                  </td>
                  <td className="beat-grade-note">{g.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {a.qa && a.qa.length > 0 && (
        <div className="beat-block">
          {a.qa.map((q, i) => (
            <div key={i} className="beat-qa">
              <div className="beat-q">
                <span className="beat-handle">{q.handle}</span> <Linkify text={q.question} />
              </div>
              <div className="beat-a">
                <Linkify text={q.answer} />
              </div>
            </div>
          ))}
        </div>
      )}

      {a.sections?.map((s, i) => (
        <div key={i} className="beat-block">
          <div className="beat-block-title">{s.title}</div>
          <ul className="beat-lines">
            {s.lines.map((l, j) => (
              <li key={j}>
                <Linkify text={l} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </article>
  )
}
