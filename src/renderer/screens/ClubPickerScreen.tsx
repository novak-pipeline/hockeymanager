/**
 * CLUB PICKER (playtest F6, step 2) — choosing the job, not scrolling a list.
 *
 * The old picker was a flat grid of 32 identical tiles sorted by rating, with
 * no way to search, no way to group by conference, and nothing that told you
 * what taking that job would actually be like. Picking your club is the single
 * most consequential decision in the game and it should read that way.
 *
 * So: search, sort and conference filter over the grid, and a standing panel
 * that briefs you on the club under the cursor — where the league has them,
 * what the board will therefore expect, and how hard the job is.
 *
 * Everything shown comes from TeamInfo, which the worker already returns; no
 * new engine surface.
 */
import { useMemo, useState } from 'react'
import type { TeamInfo } from '../../worker/protocol'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { useSceneArt } from './TitleScreen'

type Sort = 'rating' | 'name' | 'division'

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/** What the job is, read off where the league has this club. Rank is the
 *  honest input: the board's patience follows the same number. */
function situation(rank: number, total: number): { label: string; tone: string; brief: string } {
  const pct = rank / total
  if (pct <= 0.16) {
    return {
      label: 'Win now',
      tone: 'var(--amber)',
      brief: 'A contender. The room is built, the cap is committed and anything short of a deep run will be called a failure.',
    }
  }
  if (pct <= 0.4) {
    return {
      label: 'Playoff push',
      tone: 'var(--green)',
      brief: 'A playoff club with a hole or two. One good deadline turns this into a real season; one bad month turns it into a rebuild.',
    }
  }
  if (pct <= 0.7) {
    return {
      label: 'On the bubble',
      tone: 'var(--cyan)',
      brief: 'The hardest job in hockey: good enough to chase a spot, not good enough to buy one. Every decision here is a real decision.',
    }
  }
  return {
    label: 'Rebuild',
    tone: 'var(--violet-h)',
    brief: 'Draft capital, patience and a board that will let you use both — for a while. Judge this one in year three.',
  }
}

export function ClubPickerScreen(props: {
  teams: TeamInfo[]
  busy: boolean
  onPick: (team: TeamInfo) => void
  onBack: () => void
}): JSX.Element {
  const art = useSceneArt('arena-night')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('rating')
  const [conf, setConf] = useState<string>('all')
  const [selected, setSelected] = useState<string | null>(props.teams[0]?.teamId ?? null)

  // League rank is fixed by squad rating regardless of how the grid is sorted —
  // "3rd of 32" must not change when you sort the page alphabetically.
  const rankOf = useMemo(() => {
    const m = new Map<string, number>()
    ;[...props.teams].sort((a, b) => b.strength - a.strength).forEach((t, i) => m.set(t.teamId, i + 1))
    return m
  }, [props.teams])

  const conferences = useMemo(
    () => [...new Set(props.teams.map((t) => t.conference).filter(Boolean))].sort(),
    [props.teams]
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = props.teams.filter((t) => {
      if (conf !== 'all' && t.conference !== conf) return false
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) ||
        t.city.toLowerCase().includes(q) ||
        t.abbreviation.toLowerCase().includes(q) ||
        t.division.toLowerCase().includes(q)
      )
    })
    return rows.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'division') {
        return a.conference.localeCompare(b.conference) ||
          a.division.localeCompare(b.division) ||
          b.strength - a.strength
      }
      return b.strength - a.strength
    })
  }, [props.teams, query, sort, conf])

  const club = props.teams.find((t) => t.teamId === selected) ?? shown[0] ?? null
  const rank = club ? rankOf.get(club.teamId) ?? props.teams.length : 0
  const sit = club ? situation(rank, props.teams.length) : null

  return (
    <div className="picker2" style={art ? { backgroundImage: `url(${art})` } : undefined}>
      <div className="title-scrim" />
      <div className="picker2-inner">
        <header className="picker2-head">
          <button className="setup-back" onClick={props.onBack} disabled={props.busy}>
            <Icon size={14}><Icons.Back /></Icon> Back
          </button>
          <div className="setup-step">Step 2 of 2</div>
          <h1 className="setup-title">Choose your club</h1>
        </header>

        <div className="picker2-tools">
          <input
            className="input picker2-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search club, city or division"
            aria-label="Search clubs"
          />
          <select
            className="input picker2-select"
            value={conf}
            onChange={(e) => setConf(e.target.value)}
            aria-label="Filter by conference"
          >
            <option value="all">All conferences</option>
            {conferences.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            className="input picker2-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort clubs"
          >
            <option value="rating">Sort: squad rating</option>
            <option value="name">Sort: name</option>
            <option value="division">Sort: conference &amp; division</option>
          </select>
          <span className="picker2-count">{shown.length} of {props.teams.length}</span>
        </div>

        <div className="picker2-body">
          <div className="picker2-grid">
            {shown.map((t) => {
              const r = rankOf.get(t.teamId) ?? 0
              return (
                <button
                  key={t.teamId}
                  className={`club-card${club?.teamId === t.teamId ? ' on' : ''}`}
                  onClick={() => setSelected(t.teamId)}
                  disabled={props.busy}
                  // No double-click-to-commit here on purpose: a stray second
                  // click on a club you were only inspecting would start a
                  // career you did not choose, and there is no undo. Taking
                  // the job is the brief panel's deliberate CTA.
                >
                  <span
                    className="club-card-crest"
                    style={{ background: hex(t.colors.primary), borderColor: hex(t.colors.secondary) }}
                  >
                    {t.abbreviation}
                  </span>
                  <span className="club-card-id">
                    <span className="club-card-name">{t.name}</span>
                    <span className="club-card-meta">{t.conference} · {t.division}</span>
                  </span>
                  <span className="club-card-rating">
                    <span className="club-card-strength">{t.strength}</span>
                    <span className="club-card-rank">#{r}</span>
                  </span>
                </button>
              )
            })}
            {shown.length === 0 && (
              <p className="savemgr-empty">No club matches “{query}”.</p>
            )}
          </div>

          <aside className="picker2-brief">
            {club && sit ? (
              <>
                <div
                  className="brief-crest"
                  style={{ background: hex(club.colors.primary), borderColor: hex(club.colors.secondary) }}
                >
                  {club.abbreviation}
                </div>
                <h2 className="brief-name">{club.name}</h2>
                <div className="brief-place">{club.city} · {club.conference}, {club.division}</div>

                <div className="brief-stats">
                  <span>
                    <strong>{club.strength}</strong>
                    <span className="brief-stat-label">Squad rating</span>
                  </span>
                  <span>
                    <strong>{rank}<span className="brief-of">/{props.teams.length}</span></strong>
                    <span className="brief-stat-label">League rank</span>
                  </span>
                </div>

                <div className="brief-sit" style={{ color: sit.tone, borderColor: sit.tone }}>
                  {sit.label}
                </div>
                <p className="brief-text">{sit.brief}</p>

                <button
                  className="btn btn-hero btn-lg brief-cta"
                  onClick={() => props.onPick(club)}
                  disabled={props.busy}
                >
                  {props.busy ? 'Taking the job…' : `Take the ${club.name} job`}
                </button>
                {props.busy && (
                  <p className="setup-progress">
                    Simulating the season before your arrival — standings, storylines and a draft
                    class are being written.
                  </p>
                )}
              </>
            ) : (
              <p className="savemgr-empty">Pick a club to read the brief.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
