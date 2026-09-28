import { useState } from 'react'
import type { GMProfileView, GMJobMarketView, GMRelationshipsView } from '../../worker/protocol'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { useClient, useScreenData } from '../hooks/useSim'
import { bumpRefresh, toast } from '../components/store'
import { SortHeaders, sortColumns, useTableSort } from '../components/sortable'

const INTEREST_RANK: Record<'courting' | 'open' | 'longshot', number> = { longshot: 0, open: 1, courting: 2 }

type GmOpening = GMJobMarketView['openings'][number]
type GmRelationship = GMRelationshipsView['rows'][number]

const OPENING_COLS = sortColumns<GmOpening>()([
  { key: 'club', label: 'Club', value: (o) => o.teamName },
  { key: 'projectedRank', label: 'Proj. finish', value: (o) => o.projectedRank, align: 'right', initialDir: 'asc' },
  { key: 'interest', label: 'Interest', value: (o) => INTEREST_RANK[o.interest], title: 'How keen the club is on you' },
  { key: 'act', label: '' },
])

const RELATIONSHIP_COLS = sortColumns<GmRelationship>()([
  { key: 'club', label: 'Club', value: (r) => r.teamName },
  { key: 'standing', label: 'Standing', value: (r) => r.standing, align: 'right' },
  { key: 'label', label: 'Relationship', value: (r) => r.standing },
])

/** Stable identity so the sort hook is not handed a new array each render. */
const NO_RELATIONSHIPS: GmRelationship[] = []

function interestChip(interest: 'courting' | 'open' | 'longshot'): JSX.Element {
  const cls = interest === 'courting' ? 'chip chip-accent' : interest === 'open' ? 'chip' : 'chip chip-warn'
  const label = interest === 'courting' ? 'Courting you' : interest === 'open' ? 'In the mix' : 'Long shot'
  return <span className={cls}>{label}</span>
}

function JobMarketPanel(props: { market: GMJobMarketView; onRefetch: () => void }): JSX.Element {
  const openingSort = useTableSort(props.market.openings, OPENING_COLS, { key: null })
  const client = useClient()
  const { market } = props
  const [busy, setBusy] = useState(false)

  const accept = async (teamId: string): Promise<void> => {
    setBusy(true)
    const r = await client.acceptGMJob(teamId)
    setBusy(false)
    if (r.type === 'error') toast(r.message, 'error')
    else {
      if (r.type === 'ok' && r.note) toast(r.note, 'success')
      props.onRefetch()
      // The shell's dashboard holds Continue while fired (E3) — refresh it so
      // the gate lifts the moment the new chair is taken.
      bumpRefresh()
    }
  }

  if (!market.available) {
    return (
      <Panel title="GM job market">
        <Notice kind="info">
          You're employed. The job market opens up if your club lets you go — then rival
          openings appear here and your reputation decides who comes calling.
        </Notice>
      </Panel>
    )
  }

  return (
    <Panel title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={16} color="var(--amber)"><Icons.Warning /></Icon> You're a free agent — find your next job</span>}>
      <div className="muted small" style={{ marginBottom: 8 }}>
        Your reputation is <strong>{market.reputation}</strong> ({market.tier}). Clubs courting you or
        with the seat open will take you; long shots need you to rebuild your name first.
      </div>
      {market.openings.length === 0 ? (
        <Notice kind="info">No vacancies right now. Sit tight — seats open up as the league turns over.</Notice>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortHeaders columns={OPENING_COLS} sortKey={openingSort.sortKey} dir={openingSort.dir} onSort={openingSort.sortBy} />
              </tr>
            </thead>
            <tbody>
              {openingSort.sorted.map((o) => (
                <tr key={o.teamId}>
                  <td>
                    <strong>{o.teamAbbr}</strong> <span className="muted small">{o.teamName}</span>
                    <div className="small muted">{o.blurb}</div>
                  </td>
                  <td className="num">#{o.projectedRank}</td>
                  <td>{interestChip(o.interest)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {o.interest === 'longshot' ? (
                      <span className="muted small">Not interested</span>
                    ) : (
                      <button className="btn btn-primary" disabled={busy} onClick={() => accept(o.teamId)}>
                        Take the job
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

export function GMCareerScreen(): JSX.Element {
  const client = useClient()
  const profile = useScreenData<GMProfileView>(
    () => client.getGMProfile(),
    (r) => (r.type === 'gmProfile' ? r.gmProfile : null)
  )
  const market = useScreenData<GMJobMarketView>(
    () => client.getGMJobMarket(),
    (r) => (r.type === 'gmJobMarket' ? r.gmJobMarket : null)
  )
  const rel = useScreenData<GMRelationshipsView>(
    () => client.getGMRelationships(),
    (r) => (r.type === 'gmRelationships' ? r.gmRelationships : null)
  )
  const relSort = useTableSort(rel.data?.rows ?? NO_RELATIONSHIPS, RELATIONSHIP_COLS, { key: null })

  return (
    <section className="stack">
      <ScreenHeader title="GM Career" />
      <ScreenStateNotices loading={profile.loading} error={profile.error} />
      {profile.data && (
        <Panel title={profile.data.name}>
          <div className="row" style={{ gap: 24, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div>
              <div className="muted small">Reputation</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{profile.data.reputation}</div>
              <div className="chip chip-accent">{profile.data.tier}</div>
            </div>
            <div>
              <div className="muted small">Status</div>
              <div style={{ fontWeight: 600 }}>
                {profile.data.fired ? 'Between jobs' : (profile.data.currentClub ?? '—')}
              </div>
            </div>
            <div>
              <div className="muted small">Career record</div>
              <div style={{ fontWeight: 600 }}>{profile.data.wins}-{profile.data.losses} · {profile.data.seasons} seasons</div>
            </div>
            <div>
              <div className="muted small">Honours</div>
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon size={16} color="var(--amber)"><Icons.Trophy /></Icon> {profile.data.cupWins} · {profile.data.playoffApps} playoff berths · {profile.data.presidentsTrophies} Presidents'
              </div>
            </div>
          </div>
        </Panel>
      )}

      {market.data && <JobMarketPanel market={market.data} onRefetch={() => { market.refetch(); profile.refetch() }} />}

      {rel.data?.reputation && (
        <Panel title="Your name around the league">
          <div className="row" style={{ gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 150 }}>
              <div className="muted small">Standing</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{rel.data.reputation.standing}</div>
              <div className={`chip ${rel.data.reputation.standing >= 58 ? 'chip-success' : rel.data.reputation.standing < 43 ? 'chip-danger' : ''}`}>{rel.data.reputation.label}</div>
              <div className="muted small" style={{ marginTop: 6 }}>
                {rel.data.reputation.tilt === 0
                  ? 'No edge either way at the table.'
                  : rel.data.reputation.tilt > 0
                    ? `+${rel.data.reputation.tilt} goodwill at every table.`
                    : `${rel.data.reputation.tilt} goodwill at every table.`}
              </div>
              {rel.data.reputation.strikes30 > 0 && (
                <div className="small" style={{ marginTop: 4, color: 'var(--amber)', display: 'flex', gap: 4, alignItems: 'center' }}>
                  <Icon size={14}><Icons.Warning /></Icon> {rel.data.reputation.strikes30} call{rel.data.reputation.strikes30 === 1 ? '' : 's'} past the line this month
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="muted small" style={{ marginBottom: 4 }}>What people are saying</div>
              {rel.data.reputation.notes.length === 0 ? (
                <div className="muted small">Nothing yet. A name is built one deal and one kept promise at a time.</div>
              ) : rel.data.reputation.notes.map((n, i) => (
                <div key={i} className="small" style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                  <span className="muted" style={{ width: 78, flexShrink: 0 }}>{n.dateISO}</span>
                  <span style={{ width: 34, flexShrink: 0, color: n.delta >= 0 ? 'var(--green)' : 'var(--red)' }}>{n.delta > 0 ? `+${n.delta}` : n.delta}</span>
                  <span>{n.text}</span>
                </div>
              ))}
              <div className="muted small" style={{ marginTop: 8 }}>{rel.data.reputation.rules}</div>
            </div>
          </div>
        </Panel>
      )}

      {rel.data && rel.data.rows.length > 0 && (
        <Panel title="Around the league — GM relationships">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Your standing with rival front offices. Friendly clubs deal with you more readily;
            poaching their players sours things.
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><SortHeaders columns={RELATIONSHIP_COLS} sortKey={relSort.sortKey} dir={relSort.dir} onSort={relSort.sortBy} /></tr>
              </thead>
              <tbody>
                {relSort.sorted.map((r) => (
                  <tr key={r.teamAbbr}>
                    <td><strong>{r.teamAbbr}</strong> <span className="muted small">{r.teamName}</span></td>
                    <td className="num">{r.standing}</td>
                    <td>{r.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {profile.data && profile.data.stints.length > 0 && (
        <Panel title="Career history">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Club</th>
                  <th>Years</th>
                  <th className="num">Seasons</th>
                  <th className="num">Record</th>
                  <th className="num">Cups</th>
                  <th>End</th>
                </tr>
              </thead>
              <tbody>
                {[...profile.data.stints].reverse().map((s, i) => (
                  <tr key={i}>
                    <td><strong>{s.teamAbbr}</strong> <span className="muted small">{s.teamName}</span></td>
                    <td>{s.fromYear}{s.toYear ? `–${s.toYear}` : '–present'}</td>
                    <td className="num">{s.seasons}</td>
                    <td className="num">{s.record}</td>
                    <td className="num">{s.cupWins}</td>
                    <td className="muted small">{s.endReason === 'fired' ? 'Fired' : s.endReason === 'moved' ? 'Moved on' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </section>
  )
}
