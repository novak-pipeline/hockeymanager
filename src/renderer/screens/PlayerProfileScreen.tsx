import type { PlayerProfileView } from '../../worker/protocol'
import type { SkaterSeasonLine, GoalieSeasonLine } from '../../engine/career/views'
import { useNav } from '../components/NavContext'
import { fmtMoney, fmtToi } from '../components/format'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/* ── sub-components ── */

function PotentialStars({ count }: { count: number }): JSX.Element {
  return (
    <span title={`${count}/5 potential`} style={{ letterSpacing: 2 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ color: i < count ? 'var(--accent2)' : 'var(--line)', fontSize: 13 }}>★</span>
      ))}
    </span>
  )
}

function AttrBar({
  label,
  value,
  lo,
  hi,
  masked,
}: {
  label: string
  value: number
  lo?: number
  hi?: number
  masked?: boolean
}): JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  const color =
    pct >= 85 ? 'var(--success)' :
    pct >= 70 ? 'var(--accent)' :
    pct >= 55 ? 'var(--accent2)' :
    'var(--danger)'

  if (masked && lo !== undefined && hi !== undefined && lo !== hi) {
    // Render a soft band: grey fill for the range, midpoint marker
    const loPct = Math.max(0, Math.min(100, lo))
    const hiPct = Math.max(0, Math.min(100, hi))
    const bandW = hiPct - loPct
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 56px', alignItems: 'center', gap: 8 }}>
        <span className="muted small" style={{ textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <div className="meter" style={{ height: 6, position: 'relative' }}>
          {/* Band fill */}
          <div style={{
            position: 'absolute',
            left: `${loPct}%`,
            width: `${bandW}%`,
            height: '100%',
            background: 'var(--muted)',
            opacity: 0.35,
            borderRadius: 3,
          }} />
          {/* Midpoint marker */}
          <div style={{
            position: 'absolute',
            left: `${pct}%`,
            width: 2,
            height: '100%',
            background: color,
            transform: 'translateX(-50%)',
            borderRadius: 1,
          }} />
        </div>
        <span className="small mono muted" style={{ textAlign: 'right' }}>{lo}–{hi}</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 30px', alignItems: 'center', gap: 8 }}>
      <span className="muted small" style={{ textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <div className="meter" style={{ height: 6 }}>
        <div className="meter-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="small mono" style={{ color, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function PersonalityChip({ label, value }: { label: string; value: number }): JSX.Element {
  // value is 0-100; show as a qualitative chip
  const tier =
    value >= 80 ? { cls: 'chip chip-success', suffix: '+' } :
    value >= 60 ? { cls: 'chip chip-accent', suffix: '' } :
    value >= 40 ? { cls: 'chip', suffix: '' } :
    { cls: 'chip chip-danger', suffix: '−' }
  return <span className={tier.cls}>{label}{tier.suffix}</span>
}

function ConditionBar({ value }: { value: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  const cls = pct < 50 ? 'meter-fill over' : pct < 75 ? 'meter-fill warn' : 'meter-fill'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="meter" style={{ width: 80, height: 6 }}>
        <div className={cls} style={{ width: `${pct}%` }} />
      </div>
      <span className="small muted">{pct}%</span>
    </div>
  )
}

function SkaterHistoryRow({ s }: { s: SkaterSeasonLine }): JSX.Element {
  return (
    <>
      <td className="num">{s.gamesPlayed}</td>
      <td className="num">{s.goals}</td>
      <td className="num">{s.assists}</td>
      <td className="num"><strong>{s.points}</strong></td>
      <td className="num" style={{ color: s.plusMinus > 0 ? 'var(--success)' : s.plusMinus < 0 ? 'var(--danger)' : undefined }}>
        {s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}
      </td>
      <td className="num">{s.penaltyMinutes}</td>
      <td className="num">{fmtToi(s.toiPerGame)}</td>
      <td className="num">{s.ppGoals}+{s.ppAssists}</td>
    </>
  )
}

function GoalieHistoryRow({ g }: { g: GoalieSeasonLine }): JSX.Element {
  return (
    <>
      <td className="num">{g.gamesPlayed}</td>
      <td className="num">{g.wins}</td>
      <td className="num">{g.losses}</td>
      <td className="num">.{Math.round(g.savePct * 1000)}</td>
      <td className="num">{g.goalsAgainstAverage.toFixed(2)}</td>
      <td className="num">{g.shutouts}</td>
      <td className="num"></td>
      <td className="num"></td>
    </>
  )
}

export function PlayerProfileScreen(props: { playerId: string }): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const { data, loading, error } = useScreenData<PlayerProfileView>(
    () => client.getPlayer(props.playerId),
    (r) => (r.type === 'player' ? r.player : null)
  )

  if (error) {
    return (
      <section className="stack">
        <ScreenHeader title="Player">
          <button className="btn btn-ghost" onClick={() => nav.navigate('squad')}>← Squad</button>
        </ScreenHeader>
        <Notice kind="warn">{error}</Notice>
      </section>
    )
  }

  if (!data) {
    return (
      <section className="stack">
        <ScreenHeader title="Player">
          <button className="btn btn-ghost" onClick={() => nav.navigate('squad')}>← Squad</button>
        </ScreenHeader>
        <Notice kind="info">{loading ? 'Loading…' : 'Player not found.'}</Notice>
      </section>
    )
  }

  const d = data
  const isGoalie = d.position === 'G'
  const capPct = d.contract ? Math.max(0, Math.min(100, d.contract.salary / 12_000_000 * 100)) : 0

  return (
    <section className="stack">
      {/* ── header ── */}
      <ScreenHeader title={d.name}>
        <div className="row">
          <button className="btn btn-ghost small" onClick={() => nav.navigate('squad')}>← Squad</button>
        </div>
      </ScreenHeader>

      {/* ── injury banner ── */}
      {d.injury && (
        <Notice kind="danger">
          Injured: {d.injury.description} — {d.injury.gamesRemaining} game{d.injury.gamesRemaining !== 1 ? 's' : ''} remaining
        </Notice>
      )}

      {/* ── hero strip ── */}
      <Panel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--sp-5)', alignItems: 'start' }}>
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {/* Identity chips */}
            <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
              <span className="chip chip-accent">{d.position}</span>
              <span className="chip">{d.handedness} shot</span>
              <span className="chip">{d.age} yrs</span>
              {d.teamName
                ? <span className="chip">{d.teamName}</span>
                : <span className="chip chip-warn">Free agent</span>}
              <span className="chip">{d.role}</span>
              {d.contract?.noTradeClause && <span className="chip chip-warn">NTC</span>}
              {d.contract?.twoWay && <span className="chip">2-way</span>}
            </div>

            {/* Big OVR + potential */}
            <div className="row" style={{ gap: 'var(--sp-5)', alignItems: 'flex-end' }}>
              <div className="stat">
                {d.scouted && !d.scouted.exact ? (
                  <>
                    <div className="stat-value" style={{ fontSize: 36, color: 'var(--muted)' }}>
                      {d.scouted.overallLo}–{d.scouted.overallHi}
                    </div>
                    <div className="stat-label">
                      Overall
                      <span className="chip chip-warn" style={{ marginLeft: 6, fontSize: 9 }}>
                        {d.scouted.knowledge}%
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="stat-value" style={{ fontSize: 42, color: 'var(--accent)' }}>{d.overall}</div>
                    <div className="stat-label">Overall</div>
                  </>
                )}
              </div>
              <div className="stack" style={{ gap: 'var(--sp-1)' }}>
                <PotentialStars count={d.potentialStars} />
                <span className="muted small">Potential</span>
              </div>
              <div className="stack" style={{ gap: 'var(--sp-1)' }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>
                  {d.condition}
                  <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/100</span>
                </span>
                <span className="muted small">Condition</span>
                <ConditionBar value={d.condition} />
              </div>
              <div className="stack" style={{ gap: 'var(--sp-1)' }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{d.morale}</span>
                <span className="muted small">Morale</span>
              </div>
            </div>

            {/* Personality */}
            {d.personality.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
                {d.personality.map((p) => (
                  <PersonalityChip key={p.label} label={p.label} value={p.value} />
                ))}
              </div>
            )}
          </div>

          {/* Contract panel */}
          {d.contract ? (
            <div className="panel" style={{ minWidth: 200, background: 'var(--bg2)' }}>
              <div className="panel-title">Contract</div>
              <div className="stat">
                <div className="stat-value" style={{ fontSize: 22 }}>{fmtMoney(d.contract.salary)}</div>
                <div className="stat-label">per year</div>
              </div>
              <div className="muted small" style={{ marginTop: 'var(--sp-2)' }}>
                {d.contract.yearsRemaining} yr{d.contract.yearsRemaining !== 1 ? 's' : ''} remaining
                · expires {d.contract.expiryYear}
              </div>
              <div className="meter" style={{ marginTop: 'var(--sp-3)' }}>
                <div className="meter-fill" style={{ width: `${capPct}%` }} />
              </div>
              <div className="muted small" style={{ marginTop: 4 }}>
                {((d.contract.salary / 83_500_000) * 100).toFixed(1)}% of cap
              </div>
            </div>
          ) : (
            <div className="panel" style={{ minWidth: 180, background: 'var(--bg2)' }}>
              <div className="panel-title">Contract</div>
              <span className="muted small">No contract</span>
            </div>
          )}
        </div>
      </Panel>

      {/* ── attributes + composites ── */}
      <div className="grid grid-2">
        {/* Attribute groups */}
        <div className="stack">
          {d.attributeGroups.map((group) => (
            <Panel key={group.name} title={group.name}>
              <div className="stack" style={{ gap: 6 }}>
                {group.attributes.map((a) => (
                  <AttrBar
                    key={a.label}
                    label={a.label}
                    value={a.value}
                    lo={a.lo}
                    hi={a.hi}
                    masked={a.masked}
                  />
                ))}
              </div>
            </Panel>
          ))}
        </div>

        {/* Composites */}
        <div className="stack">
          <Panel title="Composites">
            <div className="stack" style={{ gap: 8 }}>
              {d.composites.map((c) => (
                <AttrBar key={c.label} label={c.label} value={c.value} />
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* ── season history ── */}
      {d.seasons.length > 0 && (
        <Panel title="Career Stats">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Team</th>
                  {isGoalie ? (
                    <>
                      <th className="num">GP</th>
                      <th className="num">W</th>
                      <th className="num">L</th>
                      <th className="num">SV%</th>
                      <th className="num">GAA</th>
                      <th className="num">SO</th>
                      <th className="num"></th>
                      <th className="num"></th>
                    </>
                  ) : (
                    <>
                      <th className="num">GP</th>
                      <th className="num">G</th>
                      <th className="num">A</th>
                      <th className="num">P</th>
                      <th className="num">±</th>
                      <th className="num">PIM</th>
                      <th className="num">TOI/g</th>
                      <th className="num">PP</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {d.seasons.map((season, i) => (
                  <tr key={season.year} style={i === 0 ? { fontWeight: 600 } : undefined}>
                    <td>{season.year}–{String(season.year + 1).slice(2)}</td>
                    <td className="muted">{season.teamAbbr}</td>
                    {season.goalie
                      ? <GoalieHistoryRow g={season.goalie} />
                      : season.skater
                        ? <SkaterHistoryRow s={season.skater} />
                        : <td colSpan={8} className="muted">—</td>}
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
