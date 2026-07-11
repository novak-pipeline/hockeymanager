/**
 * The negotiation room (DEPTH 1) — a stateful, multi-round contract table.
 *
 * Left: the conversation — the agent's opening position, then every round of
 * offer → response, prose with real content (comparables from actual league
 * contracts, barter moves generated from the player's hidden priorities).
 * Right: the offer builder (salary / years / signing bonus / trade clause),
 * live comparables, what you've learned about his priorities, and the mood.
 *
 * Artwork slot: assets/scenes/negotiation-room.png (CSS fallback otherwise).
 */
import { useCallback, useEffect, useState } from 'react'
import type { ContractOffer, NegotiationView } from '../../worker/protocol'
import { Backdrop } from './BoardMeetingScreen'
import { PlayerFace } from '../components/PlayerFace'
import { useNav } from '../components/NavContext'
import { Notice } from '../components/ui'
import { fmtMoney } from '../components/format'
import { useClient } from '../hooks/useSim'
import { bumpRefresh, toast } from '../components/store'
import { feedModelBridge, getFeedWriterEnabled } from '../lib/feedModel'
import { buildOfferPrompt, parseOffer, describeOffer } from '../../engine/story/offerParse'

const LEAGUE_MIN_SALARY = 750_000

const CARD: React.CSSProperties = {
  background: 'rgba(10,12,18,0.88)',
  backdropFilter: 'blur(6px)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
  padding: '10px 14px',
}

const TEMP_META: Record<NegotiationView['temperature'], { label: string; color: string }> = {
  warm: { label: 'Warm — talks are constructive', color: 'var(--success, #4caf7d)' },
  guarded: { label: 'Guarded — he is listening', color: 'var(--accent2, #d8b34c)' },
  testy: { label: 'Testy — patience is thinning', color: '#e08a3c' },
  hostile: { label: 'Hostile — one bad number from done', color: 'var(--danger, #e05555)' },
}

const VERDICT_CHIP: Record<string, { label: string; color: string }> = {
  accept: { label: 'DEAL', color: 'var(--success, #4caf7d)' },
  close: { label: 'COUNTERED', color: 'var(--accent2, #d8b34c)' },
  reject: { label: 'REJECTED', color: 'var(--danger, #e05555)' },
  walk: { label: 'TALKS OFF', color: 'var(--danger, #e05555)' },
}

export function NegotiationScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const playerId = nav.params.playerId

  const [view, setView] = useState<NegotiationView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // The offer on the table (builder state).
  const [salary, setSalary] = useState(0)
  const [years, setYears] = useState(3)
  const [bonusPct, setBonusPct] = useState(0)
  const [clause, setClause] = useState<'none' | 'modified' | 'full'>('none')

  // Freeform "draft an offer in your own words" (local AI). The model only fills
  // the builder below; the engine evaluates and the GM confirms by tabling it.
  const [canDraft, setCanDraft] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draftEcho, setDraftEcho] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    if (!getFeedWriterEnabled()) return
    const bridge = feedModelBridge()
    if (!bridge) return
    void bridge.status().then((s) => {
      if (live) setCanDraft(Boolean(s.ready))
    })
    return () => { live = false }
  }, [])

  async function draftFromWords(): Promise<void> {
    const text = draftText.trim()
    if (!text || drafting || !view) return
    const bridge = feedModelBridge()
    if (!bridge) return
    setDrafting(true)
    setDraftEcho(null)
    const prompt = buildOfferPrompt({
      freeform: text,
      askSalary: view.askSalary,
      askYears: view.askYears,
      playerName: view.player.name,
    })
    const r = await bridge.infer({ system: prompt.system, user: prompt.user, maxTokens: prompt.maxTokens })
    setDrafting(false)
    // Ceiling = cap room, plus the salary being replaced when re-signing your own.
    const maxSalary = view.capSpace + (view.kind === 'resign' ? view.currentSalary : 0)
    const offer = r.ok
      ? parseOffer(r.text, { minSalary: LEAGUE_MIN_SALARY, maxSalary, minYears: 1, maxYears: 8 })
      : null
    if (!offer) {
      toast('Could not read those terms — set them below, or rephrase.', 'info')
      return
    }
    setSalary(offer.salary)
    setYears(offer.years)
    setBonusPct(offer.signingBonusPct)
    setClause(offer.clause)
    setDraftEcho(describeOffer(offer))
  }

  const seedBuilder = useCallback((v: NegotiationView, keepUserNumbers: boolean) => {
    if (!keepUserNumbers) {
      // Open ~8% under the ask — a starting position, not a surrender.
      setSalary(Math.round((v.askSalary * 0.92) / 25_000) * 25_000)
      setYears(v.askYears)
      setBonusPct(0)
      setClause('none')
    }
  }, [])

  useEffect(() => {
    let alive = true
    if (!playerId) { setLoading(false); return }
    void client.startNegotiation(playerId).then((r) => {
      if (!alive) return
      setLoading(false)
      if (r.type === 'negotiation' && r.negotiation) {
        setView(r.negotiation)
        seedBuilder(r.negotiation, false)
      } else if (r.type === 'error') {
        setNote(r.message)
      }
    })
    return () => { alive = false }
  }, [client, playerId, seedBuilder])

  async function tableOffer(): Promise<void> {
    if (!playerId || !view || busy) return
    setBusy(true)
    const offer: ContractOffer = {
      salary,
      years,
      signingBonusPct: bonusPct,
      clause,
      twoWay: false,
    }
    const r = await client.submitNegotiationOffer(playerId, offer)
    setBusy(false)
    if (r.type === 'error') { toast(r.message, 'error'); return }
    if (r.type === 'negotiation') {
      if (r.negotiation) setView(r.negotiation)
      if (r.message) setNote(r.message)
      if (r.signed) {
        toast(r.message ?? 'Signed.', 'success')
        bumpRefresh()
      }
    }
  }

  if (loading) return <Notice kind="info">Setting up the meeting…</Notice>
  if (!playerId || !view) {
    return (
      <section className="stack">
        <Notice kind="info">{note ?? 'No contract talks are open here. Open one from the re-sign list or the free-agent market.'}</Notice>
        <button className="btn btn-ghost" onClick={() => nav.goBack()}>← Back</button>
      </section>
    )
  }

  const temp = TEMP_META[view.temperature]
  const done = view.status !== 'open'

  return (
    <section style={{ height: '100%' }}>
      <Backdrop scene="negotiation-room">
        {/* header: who's across the table */}
        <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 'var(--sp-3)' }}>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <PlayerFace faceId={view.player.faceId} name={view.player.name} size={54} />
            <div>
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--muted)' }}>
                Contract talks · {view.kind === 'resign' ? 're-signing' : view.kind === 'extension' ? 'extension' : 'free agent'} · {view.rightsLabel}
              </div>
              <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800 }}>{view.player.name}</h2>
              <div className="muted" style={{ fontSize: 12 }}>
                {view.player.position} · {view.player.age} · currently {view.currentSalary > 0 ? `${fmtMoney(view.currentSalary)}` : 'unsigned'} · rep&apos;d by <b>{view.agentName}</b> <span style={{ fontStyle: 'italic' }}>({view.agentStyle})</span>
              </div>
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => nav.goBack()}>← Leave the room</button>
        </div>

        <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          {/* ── the conversation ── */}
          <div className="stack" style={{ flex: '1 1 520px', gap: 'var(--sp-2)', minWidth: 0 }}>
            <div style={{ ...CARD }}>
              <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                {view.agentName} opens
              </div>
              {view.openingLines.map((l, i) => (
                <p key={i} style={{ margin: '4px 0', fontSize: 13.5, lineHeight: 1.55 }}>{l}</p>
              ))}
            </div>

            {view.rounds.map((r, i) => {
              const chip = VERDICT_CHIP[r.verdict] ?? VERDICT_CHIP.reject
              return (
                <div key={i} style={{ ...CARD }}>
                  <div className="row-between" style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)' }}>
                      Round {i + 1} — you offered {fmtMoney(r.offerSalary)} × {r.offerYears}
                      {r.offerBonusPct > 0 ? `, ${r.offerBonusPct}% signing bonus` : ''}
                      {r.offerClause !== 'none' ? `, ${r.offerClause === 'full' ? 'no-move' : 'mod. no-trade'}` : ''}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: chip.color }}>{chip.label}</span>
                  </div>
                  {r.agentLines.map((l, j) => (
                    <p key={j} style={{ margin: '4px 0', fontSize: 13.5, lineHeight: 1.55, ...(l.startsWith('(') ? { color: 'var(--muted)', fontStyle: 'italic', fontSize: 12.5 } : {}) }}>{l}</p>
                  ))}
                </div>
              )
            })}

            {done && (
              <div style={{ ...CARD, borderColor: view.status === 'signed' ? 'var(--success, #4caf7d)' : 'var(--danger, #e05555)' }}>
                <b>
                  {view.status === 'signed'
                    ? `Deal. ${view.player.name} signs.`
                    : view.status === 'paused'
                      ? view.pausedNote ?? 'Talks are paused.'
                      : `${view.player.name}'s camp has walked away.`}
                </b>
              </div>
            )}
          </div>

          {/* ── the offer builder + intel ── */}
          <div className="stack" style={{ flex: '0 0 340px', gap: 'var(--sp-2)' }}>
            <div style={{ ...CARD }}>
              <div className="row-between" style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)' }}>Their position</span>
                <span style={{ fontSize: 11, color: temp.color, fontWeight: 700 }}>{temp.label}</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>
                {fmtMoney(view.askSalary)} × {view.askYears} yrs
              </div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {view.askBonusPct > 0 ? `${view.askBonusPct}% as signing bonus · ` : ''}
                {view.askClause === 'full' ? 'wants full no-move protection' : view.askClause === 'modified' ? 'wants a modified no-trade' : 'no clause demands'}
              </div>
            </div>

            {!done && (
              <div style={{ ...CARD }}>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Your offer</div>
                <div className="stack" style={{ gap: 8 }}>
                  {canDraft && (
                    <div className="stack" style={{ gap: 4, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <input
                        className="input"
                        value={draftText}
                        placeholder="Say your terms — “five years, AAV around 6.5, modified no-trade”"
                        disabled={drafting}
                        onChange={(e) => { setDraftText(e.target.value); setDraftEcho(null) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') void draftFromWords() }}
                        style={{ padding: '5px 8px', fontSize: 12.5 }}
                      />
                      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button className="btn btn-sm" disabled={drafting || !draftText.trim()} onClick={() => void draftFromWords()}>
                          {drafting ? 'Drafting…' : '✍️ Draft from my words'}
                        </button>
                        {draftEcho && <span className="muted" style={{ fontSize: 11.5 }}>Parsed: <b>{draftEcho}</b> — review &amp; table below.</span>}
                      </div>
                    </div>
                  )}
                  <label className="row-between" style={{ fontSize: 12.5, gap: 8 }}>
                    <span>Salary (AAV)</span>
                    <input
                      className="input" type="number" min={750_000} step={100_000} value={salary}
                      onChange={(e) => setSalary(parseInt(e.target.value, 10) || 0)}
                      style={{ width: 130, padding: '4px 8px', fontSize: 13 }}
                    />
                  </label>
                  <label className="row-between" style={{ fontSize: 12.5, gap: 8 }}>
                    <span>Years</span>
                    <input
                      className="input" type="number" min={1} max={8} value={years}
                      onChange={(e) => setYears(Math.min(8, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                      style={{ width: 70, padding: '4px 8px', fontSize: 13 }}
                    />
                  </label>
                  <label className="row-between" style={{ fontSize: 12.5, gap: 8 }}>
                    <span>Signing bonus</span>
                    <select
                      className="input" value={bonusPct}
                      onChange={(e) => setBonusPct(parseInt(e.target.value, 10))}
                      style={{ width: 90, padding: '4px 8px', fontSize: 13 }}
                    >
                      {[0, 10, 20, 30].map((b) => <option key={b} value={b}>{b}%</option>)}
                    </select>
                  </label>
                  <div className="row-between" style={{ fontSize: 12.5, gap: 8 }}>
                    <span>Trade clause</span>
                    <div className="row" style={{ gap: 4 }}>
                      {(['none', 'modified', 'full'] as const).map((c) => (
                        <button
                          key={c}
                          className={`chip${clause === c ? ' chip-accent' : ''}`}
                          style={{ cursor: 'pointer', border: 'none', fontSize: 10.5 }}
                          onClick={() => setClause(c)}
                        >
                          {c === 'none' ? 'None' : c === 'modified' ? 'Mod. NTC' : 'NMC'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    Cap space: <b style={{ color: salary > view.capSpace + (view.kind === 'resign' ? view.currentSalary : 0) ? 'var(--danger, #e05555)' : 'inherit' }}>{fmtMoney(view.capSpace)}</b>
                    {' · '}total value {fmtMoney(salary * years)}
                  </div>
                  <button className="btn btn-primary" disabled={busy || salary <= 0} onClick={() => void tableOffer()}>
                    {busy ? 'They are talking it over…' : 'Table the offer'}
                  </button>
                  {note && !done && <div className="muted" style={{ fontSize: 11.5 }}>{note}</div>}
                </div>
              </div>
            )}

            {view.comparables.length > 0 && (
              <div style={{ ...CARD }}>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                  The market (real deals)
                </div>
                {view.comparables.map((c, i) => (
                  <div key={i} className="row-between" style={{ fontSize: 12, padding: '3px 0', borderBottom: i < view.comparables.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                    <span>{c.name} <span className="muted">({c.teamAbbr}, {c.age})</span></span>
                    <span style={{ fontWeight: 700 }}>{fmtMoney(c.salary)} × {c.years}</span>
                  </div>
                ))}
              </div>
            )}

            {view.revealedHints.length > 0 && (
              <div style={{ ...CARD }}>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                  What you&apos;ve learned
                </div>
                {view.revealedHints.map((h, i) => (
                  <p key={i} style={{ margin: '3px 0', fontSize: 12, lineHeight: 1.45 }}>• {h}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      </Backdrop>
    </section>
  )
}
