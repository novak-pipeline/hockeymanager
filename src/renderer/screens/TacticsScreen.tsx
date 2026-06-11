import { useState } from 'react'
import type { TacticsView, LinesUpdate } from '../../worker/protocol'
import type {
  LinesView,
  LineSlotView,
  PlayerBadge,
} from '../../engine/career/views'
import type {
  TeamTactics,
  ForecheckSystem,
  DefensiveZoneCoverage,
  PowerPlayFormation,
  PenaltyKillFormation,
} from '@domain'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { bumpRefresh, toast } from '../components/store'
import { useClient, useScreenData } from '../hooks/useSim'

/* ── helpers ── */

function linesViewToUpdate(lines: LinesView): LinesUpdate {
  return {
    forwards: lines.forwards.map((line) => line.map((s) => s.player?.playerId ?? '')),
    defensePairs: lines.defensePairs.map((pair) => pair.map((s) => s.player?.playerId ?? '')),
    goalies: lines.goalies.map((s) => s.player?.playerId ?? ''),
    powerPlayUnits: lines.powerPlayUnits.map((unit) => unit.map((s) => s.player?.playerId ?? '')),
    penaltyKillUnits: lines.penaltyKillUnits.map((unit) => unit.map((s) => s.player?.playerId ?? '')),
  }
}

function deepCloneLines(lines: LinesView): LinesView {
  return JSON.parse(JSON.stringify(lines)) as LinesView
}

/* ── OVR dot ── */
function OvrDot({ value }: { value: number }): JSX.Element {
  const color =
    value >= 85 ? 'var(--success)' :
    value >= 75 ? 'var(--accent)' :
    value >= 65 ? 'var(--accent2)' :
    'var(--muted)'
  return (
    <span style={{ color, fontWeight: 700, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </span>
  )
}

/* ── Player picker modal ── */
interface PickerProps {
  slot: string
  current: PlayerBadge | null
  roster: PlayerBadge[]
  onSelect: (p: PlayerBadge | null) => void
  onClose: () => void
}

function PlayerPicker({ slot, current, roster, onSelect, onClose }: PickerProps): JSX.Element {
  const [search, setSearch] = useState('')
  const filtered = roster.filter((p) =>
    !search.trim() || p.name.toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 40,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 380, maxHeight: '70vh', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between">
          <span style={{ fontWeight: 700 }}>Pick {slot}</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px' }}>✕</button>
        </div>
        <input
          className="input"
          placeholder="Search…"
          value={search}
          autoFocus
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {current && (
            <button
              className="btn btn-ghost"
              style={{ width: '100%', textAlign: 'left', marginBottom: 'var(--sp-1)' }}
              onClick={() => { onSelect(null); onClose() }}
            >
              <span className="muted small">Clear slot</span>
            </button>
          )}
          {filtered.map((p) => (
            <button
              key={p.playerId}
              className="btn btn-ghost"
              style={{
                width: '100%', textAlign: 'left', justifyContent: 'flex-start',
                background: current?.playerId === p.playerId ? 'rgba(139,92,246,0.14)' : undefined,
                borderColor: current?.playerId === p.playerId ? 'var(--accent)' : undefined,
                gap: 'var(--sp-3)', marginBottom: 2,
              }}
              onClick={() => { onSelect(p); onClose() }}
            >
              <span className="muted small" style={{ width: 28, textAlign: 'right' }}>{p.position}</span>
              <span style={{ flex: 1 }}>{p.name}</span>
              <OvrDot value={p.overall} />
              <span className="muted small">{p.age}y</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="muted small" style={{ padding: '12px 8px' }}>No players found.</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Slot button ── */
function SlotButton({
  slotDef,
  onClick,
}: {
  slotDef: LineSlotView
  onClick: () => void
}): JSX.Element {
  const p = slotDef.player
  return (
    <button
      className="btn"
      style={{
        minWidth: 120, flexDirection: 'column', alignItems: 'flex-start',
        padding: '6px 10px', gap: 2,
        background: p ? 'var(--bg2)' : 'var(--bg0)',
        borderStyle: p ? 'solid' : 'dashed',
        borderColor: p ? 'var(--line)' : 'rgba(139,149,166,0.4)',
      }}
      onClick={onClick}
      title={`${slotDef.slot} — click to change`}
    >
      <span className="muted" style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {slotDef.slot}
      </span>
      {p ? (
        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 100 }}>
          {p.name}
        </span>
      ) : (
        <span className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>Empty</span>
      )}
      {p && <OvrDot value={p.overall} />}
    </button>
  )
}

/* ── lines sub-sections ── */

interface LinesSectionProps {
  title: string
  lines: LineSlotView[][]
  onClickSlot: (lineIdx: number, slotIdx: number) => void
}

function LinesSection({ title, lines, onClickSlot }: LinesSectionProps): JSX.Element {
  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <div className="panel-title">{title}</div>
      {lines.map((line, li) => (
        <div key={li} className="row" style={{ gap: 'var(--sp-2)', alignItems: 'stretch' }}>
          <span className="muted small" style={{ width: 24, textAlign: 'right', alignSelf: 'center' }}>
            {li + 1}
          </span>
          {line.map((slot, si) => (
            <SlotButton
              key={`${li}-${si}`}
              slotDef={slot}
              onClick={() => onClickSlot(li, si)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── tactics slider ── */
function TacticSlider({
  label, value, onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 30px', alignItems: 'center', gap: 8 }}>
      <span className="muted small" style={{ textAlign: 'right' }}>{label}</span>
      <input
        type="range" min={0} max={1} step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
      <span className="small mono" style={{ textAlign: 'right' }}>{Math.round(value * 100)}</span>
    </div>
  )
}

/* ── main component ── */

export function TacticsScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error, refetch } = useScreenData<TacticsView>(
    () => client.getTactics(),
    (r) => (r.type === 'tactics' ? r.tactics : null)
  )

  // Local draft state for lines + tactics
  const [draftLines, setDraftLines] = useState<LinesView | null>(null)
  const [draftTactics, setDraftTactics] = useState<TeamTactics | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerContext, setPickerContext] = useState<{
    section: 'forwards' | 'defense' | 'goalies' | 'pp' | 'pk'
    lineIdx: number
    slotIdx: number
  } | null>(null)

  // When fresh data arrives and no local draft, sync from server
  const lines = draftLines ?? data?.lines ?? null
  const tactics = draftTactics ?? data?.tactics ?? null

  function markDirty(): void { setDirty(true) }

  // ── lines mutation helpers ──

  function setLines(updater: (l: LinesView) => LinesView): void {
    const base = lines ?? data?.lines
    if (!base) return
    setDraftLines(updater(deepCloneLines(base)))
    markDirty()
  }

  function openPicker(
    section: 'forwards' | 'defense' | 'goalies' | 'pp' | 'pk',
    lineIdx: number,
    slotIdx: number,
  ): void {
    setPickerContext({ section, lineIdx, slotIdx })
    setPickerOpen(true)
  }

  function getPickerSlot(): LineSlotView | null {
    if (!pickerContext || !lines) return null
    const { section, lineIdx, slotIdx } = pickerContext
    if (section === 'forwards') return lines.forwards[lineIdx]?.[slotIdx] ?? null
    if (section === 'defense') return lines.defensePairs[lineIdx]?.[slotIdx] ?? null
    if (section === 'goalies') return lines.goalies[lineIdx] ?? null
    if (section === 'pp') return lines.powerPlayUnits[lineIdx]?.[slotIdx] ?? null
    if (section === 'pk') return lines.penaltyKillUnits[lineIdx]?.[slotIdx] ?? null
    return null
  }

  function handlePickerSelect(player: PlayerBadge | null): void {
    if (!pickerContext) return
    setLines((l) => {
      const { section, lineIdx, slotIdx } = pickerContext
      const target =
        section === 'forwards' ? l.forwards[lineIdx]?.[slotIdx] :
        section === 'defense' ? l.defensePairs[lineIdx]?.[slotIdx] :
        section === 'goalies' ? l.goalies[lineIdx] :
        section === 'pp' ? l.powerPlayUnits[lineIdx]?.[slotIdx] :
        section === 'pk' ? l.penaltyKillUnits[lineIdx]?.[slotIdx] :
        null
      if (target) target.player = player
      return l
    })
  }

  // Build a healthy roster for the picker. Slot lists hold LineSlotView
  // (player: PlayerBadge | null); scratches are already PlayerBadge[].
  function buildRoster(): PlayerBadge[] {
    if (!data) return []
    const fromSlots = [
      ...data.lines.forwards.flat(),
      ...data.lines.defensePairs.flat(),
      ...data.lines.goalies
    ]
      .map((s) => s.player)
      .filter((p): p is PlayerBadge => p != null)
    const healthy = fromSlots.concat(data.lines.scratches)
    // deduplicate
    const seen = new Set<string>()
    return healthy.filter((p) => { if (seen.has(p.playerId)) return false; seen.add(p.playerId); return true })
  }

  // ── tactics mutation helpers ──

  function setTacticsFn(updater: (t: TeamTactics) => TeamTactics): void {
    const base = tactics ?? data?.tactics
    if (!base) return
    setDraftTactics(updater(JSON.parse(JSON.stringify(base)) as TeamTactics))
    markDirty()
  }

  // ── save / revert ──

  async function handleSave(): Promise<void> {
    if (!lines || !tactics || !dirty) return
    setSaving(true)
    try {
      const linesRes = await client.setLines(linesViewToUpdate(lines))
      if (linesRes.type === 'error') {
        toast(linesRes.message, 'error')
        setSaving(false)
        return
      }
      const tacRes = await client.setTactics(tactics)
      if (tacRes.type === 'error') {
        toast(tacRes.message, 'error')
        setSaving(false)
        return
      }
      toast('Tactics saved.', 'success')
      setDraftLines(null)
      setDraftTactics(null)
      setDirty(false)
      bumpRefresh()
    } catch {
      toast('Save failed.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleRevert(): void {
    setDraftLines(null)
    setDraftTactics(null)
    setDirty(false)
    refetch()
  }

  // ── picker data ──
  const pickerSlot = getPickerSlot()
  const roster = buildRoster()

  return (
    <section className="stack" style={{ paddingBottom: dirty ? 72 : 0 }}>
      <ScreenHeader title="Tactics &amp; Lines" />

      {error && <Notice kind="warn">{error}</Notice>}
      {loading && !data && <Notice kind="info">Loading…</Notice>}

      {data && lines && tactics && (
        <>
          {/* ── Issues ── */}
          {lines.issues.length > 0 && (
            <Notice kind="warn">
              <strong>Line issues:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {lines.issues.map((iss, i) => <li key={i}>{iss}</li>)}
              </ul>
            </Notice>
          )}

          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            {/* ── LEFT: lines editor ── */}
            <div className="stack">
              <Panel title="Lines">
                <div className="stack" style={{ gap: 'var(--sp-5)' }}>
                  <LinesSection
                    title="Forwards"
                    lines={lines.forwards}
                    onClickSlot={(li, si) => openPicker('forwards', li, si)}
                  />
                  <LinesSection
                    title="Defence Pairs"
                    lines={lines.defensePairs}
                    onClickSlot={(li, si) => openPicker('defense', li, si)}
                  />

                  {/* Goalies */}
                  <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                    <div className="panel-title">Goalies</div>
                    <div className="row" style={{ gap: 'var(--sp-2)' }}>
                      {lines.goalies.map((slot, si) => (
                        <SlotButton key={si} slotDef={slot} onClick={() => openPicker('goalies', si, 0)} />
                      ))}
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title="Special Teams">
                <div className="stack" style={{ gap: 'var(--sp-5)' }}>
                  <LinesSection
                    title="Power Play"
                    lines={lines.powerPlayUnits}
                    onClickSlot={(li, si) => openPicker('pp', li, si)}
                  />
                  <LinesSection
                    title="Penalty Kill"
                    lines={lines.penaltyKillUnits}
                    onClickSlot={(li, si) => openPicker('pk', li, si)}
                  />
                </div>
              </Panel>

              {/* Scratches */}
              {lines.scratches.length > 0 && (
                <Panel title="Scratches">
                  <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                    {lines.scratches.map((p) => (
                      <span key={p.playerId} className="chip">
                        {p.position} {p.name} <OvrDot value={p.overall} />
                      </span>
                    ))}
                  </div>
                </Panel>
              )}
            </div>

            {/* ── RIGHT: tactics panel ── */}
            <div className="stack">
              <Panel title="System">
                <div className="stack" style={{ gap: 'var(--sp-4)' }}>

                  {/* Forecheck */}
                  <div>
                    <label className="field-label">Forecheck</label>
                    <select
                      className="select"
                      value={tactics.forecheck}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, forecheck: e.target.value as ForecheckSystem }))}
                    >
                      <option value="1-2-2">1-2-2 (passive)</option>
                      <option value="2-1-2">2-1-2 (aggressive)</option>
                      <option value="trap">Trap</option>
                    </select>
                  </div>

                  {/* D-zone coverage */}
                  <div>
                    <label className="field-label">D-zone coverage</label>
                    <select
                      className="select"
                      value={tactics.dZoneCoverage}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, dZoneCoverage: e.target.value as DefensiveZoneCoverage }))}
                    >
                      <option value="man">Man-to-man</option>
                      <option value="zone">Zone</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </div>
                </div>
              </Panel>

              <Panel title="Tempo">
                <div className="stack" style={{ gap: 10 }}>
                  <TacticSlider
                    label="Pace"
                    value={tactics.tempo.pace}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, tempo: { ...t.tempo, pace: v } }))}
                  />
                  <TacticSlider
                    label="Pass risk"
                    value={tactics.tempo.passRisk}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, tempo: { ...t.tempo, passRisk: v } }))}
                  />
                  <TacticSlider
                    label="Shot eagerness"
                    value={tactics.tempo.shotEagerness}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, tempo: { ...t.tempo, shotEagerness: v } }))}
                  />
                  <TacticSlider
                    label="Defensive pinch"
                    value={tactics.tempo.defensivePinch}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, tempo: { ...t.tempo, defensivePinch: v } }))}
                  />
                </div>
              </Panel>

              <Panel title="Special Teams Formations">
                <div className="stack" style={{ gap: 'var(--sp-4)' }}>
                  <div>
                    <label className="field-label">Power play formation</label>
                    <select
                      className="select"
                      value={tactics.specialTeams.powerPlay}
                      onChange={(e) => setTacticsFn((t) => ({
                        ...t, specialTeams: { ...t.specialTeams, powerPlay: e.target.value as PowerPlayFormation }
                      }))}
                    >
                      <option value="umbrella">Umbrella</option>
                      <option value="1-3-1">1-3-1</option>
                      <option value="overload">Overload</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Penalty kill formation</label>
                    <select
                      className="select"
                      value={tactics.specialTeams.penaltyKill}
                      onChange={(e) => setTacticsFn((t) => ({
                        ...t, specialTeams: { ...t.specialTeams, penaltyKill: e.target.value as PenaltyKillFormation }
                      }))}
                    >
                      <option value="box">Box</option>
                      <option value="diamond">Diamond</option>
                      <option value="aggressive">Aggressive</option>
                    </select>
                  </div>
                </div>
              </Panel>

              <Panel title="Matching">
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={tactics.lineMatching}
                    onChange={(e) => setTacticsFn((t) => ({ ...t, lineMatching: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                  />
                  <span>Line matching (shadow opponent's top line)</span>
                </label>
              </Panel>
            </div>
          </div>

          {/* ── Sticky save bar ── */}
          {dirty && (
            <div
              style={{
                position: 'fixed', bottom: 0, left: 210, right: 0, zIndex: 30,
                background: 'var(--bg1)',
                borderTop: '1px solid var(--line)',
                padding: 'var(--sp-3) var(--sp-5)',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                gap: 'var(--sp-3)',
              }}
            >
              <span className="muted small">You have unsaved changes.</span>
              <button className="btn" onClick={handleRevert} disabled={saving}>Revert</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}

          {/* ── Picker modal ── */}
          {pickerOpen && pickerContext && (
            <PlayerPicker
              slot={pickerSlot?.slot ?? pickerContext.section}
              current={pickerSlot?.player ?? null}
              roster={roster}
              onSelect={handlePickerSelect}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </>
      )}
    </section>
  )
}
