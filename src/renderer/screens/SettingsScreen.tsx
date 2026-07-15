/**
 * Settings screen — includes the PRESS PASS panel for BYO API key,
 * writer model selection, and feature toggles.
 */
import { useEffect, useRef, useState } from 'react'
import { Panel, ScreenHeader } from '../components/ui'
import { getPressSettings, setPressSettings } from '../lib/press'
import { feedModelBridge, getFeedWriterEnabled, setFeedWriterEnabled, type FeedModelStatus } from '../lib/feedModel'
import { useUiStore } from '../components/store'
import { THEME_OPTIONS } from '../components/themes'
import {
  loadKokoro,
  kokoroState,
  getKokoroEngine,
  readVoiceQuality,
  setVoiceQuality,
  type KokoroLoadState,
  type VoiceQuality,
} from '../lib/kokoroVoice'
import { voiceFor } from '../lib/voiceCast'

type KeyStatus = 'unknown' | 'present' | 'absent' | 'saving' | 'testing'

function pressApi() {
  const hockey = (window as unknown as { hockey?: { press?: {
    setKey(key: string): Promise<{ ok: boolean }>
    keyStatus(): Promise<{ present: boolean }>
  } } }).hockey
  return hockey?.press ?? null
}

const MODEL_OPTIONS: Array<{ value: string; label: string; note: string }> = [
  { value: 'claude-haiku-4-5',  label: 'Haiku (Standard)',  note: 'Fastest · ~1 cent / 10 articles' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet (Premium)',  note: 'Better prose · ~10× cost' },
]

export function SettingsScreen(): JSX.Element {
  const [keyDraft, setKeyDraft] = useState('')
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('unknown')
  const [saveMsg, setSaveMsg] = useState('')
  const api = pressApi()

  const settings = getPressSettings()
  const [model, setModel] = useState(settings.model)
  const [weeklyEnabled, setWeeklyEnabled] = useState(settings.weeklyEnabled)
  const [specialsEnabled, setSpecialsEnabled] = useState(settings.specialsEnabled)
  const [pressersEnabled, setPressersEnabled] = useState(settings.pressersEnabled)

  // Check current key status on mount.
  const didCheck = useRef(false)
  useEffect(() => {
    if (didCheck.current || !api) return
    didCheck.current = true
    api.keyStatus().then((res) => setKeyStatus(res.present ? 'present' : 'absent')).catch(() => setKeyStatus('absent'))
  }, [api])

  function saveToggle(field: 'weeklyEnabled' | 'specialsEnabled' | 'pressersEnabled', value: boolean) {
    setPressSettings({ [field]: value })
    if (field === 'weeklyEnabled') setWeeklyEnabled(value)
    if (field === 'specialsEnabled') setSpecialsEnabled(value)
    if (field === 'pressersEnabled') setPressersEnabled(value)
  }

  function saveModel(m: string) {
    setPressSettings({ model: m })
    setModel(m)
  }

  async function handleSaveKey() {
    if (!api || !keyDraft.trim()) return
    setKeyStatus('saving')
    setSaveMsg('')
    try {
      await api.setKey(keyDraft.trim())
      setKeyStatus('present')
      setKeyDraft('')
      setSaveMsg('Key saved.')
    } catch {
      setKeyStatus('absent')
      setSaveMsg('Failed to save key.')
    }
  }

  async function handleTestKey() {
    if (!api) return
    setKeyStatus('testing')
    setSaveMsg('')
    try {
      const res = await api.keyStatus()
      setKeyStatus(res.present ? 'present' : 'absent')
      setSaveMsg(res.present ? 'Key is active.' : 'No key stored.')
    } catch {
      setKeyStatus('absent')
      setSaveMsg('Could not reach key store.')
    }
  }

  const statusColor = keyStatus === 'present' ? 'var(--green)' : keyStatus === 'absent' ? 'var(--amber)' : 'var(--muted)'
  const statusLabel = keyStatus === 'present' ? 'Key configured' : keyStatus === 'absent' ? 'No key' : keyStatus === 'saving' ? 'Saving…' : keyStatus === 'testing' ? 'Checking…' : '—'

  const themeMode = useUiStore((s) => s.themeMode)
  const setThemeMode = useUiStore((s) => s.setThemeMode)

  return (
    <section className="stack">
      <ScreenHeader title="Settings" />

      {/* ── APPEARANCE ── */}
      <Panel title="Appearance">
        <div className="muted small" style={{ marginBottom: 'var(--sp-3)' }}>
          Theme — colours the whole UI. "Team Colours" follows the club you manage.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          {THEME_OPTIONS.map((opt) => {
            const active = themeMode === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => setThemeMode(opt.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  background: active ? 'var(--violet-dim)' : 'var(--bg2)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                  color: 'var(--text)', font: 'inherit', fontSize: 13, fontWeight: 600,
                }}
              >
                <span style={{ width: 14, height: 14, borderRadius: 4, background: opt.swatch, boxShadow: '0 0 0 1px rgba(0,0,0,0.3)' }} />
                {opt.label}
                {active && <span style={{ color: 'var(--violet-h)' }}>✓</span>}
              </button>
            )
          })}
        </div>
      </Panel>

      {/* ── PRESS PASS ── */}
      <Panel>
        <div className="stack">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
            <span style={{ fontSize: 18 }}>📰</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Press Pass</div>
              <div className="muted small">AI-written articles from the press corps — bring your own Anthropic API key.</div>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: statusColor, fontWeight: 600 }}>
              {statusLabel}
            </span>
          </div>

          {!api && (
            <div className="muted small" style={{ padding: 'var(--sp-3)', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)' }}>
              Press bridge unavailable — requires the desktop app.
            </div>
          )}

          {api && (
            <>
              <div>
                <label className="field-label" htmlFor="api-key-input">Anthropic API key</label>
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <input
                    id="api-key-input"
                    className="input"
                    type="password"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="sk-ant-…"
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn"
                    onClick={handleSaveKey}
                    disabled={!keyDraft.trim() || keyStatus === 'saving'}
                  >
                    Save
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={handleTestKey}
                    disabled={keyStatus === 'testing'}
                  >
                    Test
                  </button>
                </div>
                {saveMsg && (
                  <div className="muted small" style={{ marginTop: 'var(--sp-1)' }}>{saveMsg}</div>
                )}
              </div>

              <div>
                <label className="field-label">Writer model</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  {MODEL_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}
                    >
                      <input
                        type="radio"
                        name="writer-model"
                        value={opt.value}
                        checked={model === opt.value}
                        onChange={() => saveModel(opt.value)}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{opt.label}</div>
                        <div className="muted small">{opt.note}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="field-label">Feature toggles</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  <ToggleRow
                    label="Weekly column"
                    note="A beat-reporter piece after every 7th match day."
                    value={weeklyEnabled}
                    onChange={(v) => saveToggle('weeklyEnabled', v)}
                  />
                  <ToggleRow
                    label="Special editions"
                    note="Deadline, draft, champion recap, and other tentpoles."
                    value={specialsEnabled}
                    onChange={(v) => saveToggle('specialsEnabled', v)}
                  />
                  <ToggleRow
                    label="Press conferences"
                    note="Answer questions after notable results."
                    value={pressersEnabled}
                    onChange={(v) => saveToggle('pressersEnabled', v)}
                  />
                </div>
              </div>

              <div className="muted small" style={{ padding: 'var(--sp-3)', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)' }}>
                Cost estimate: a full 60-game season with weekly columns on Haiku costs approximately a few cents. Keys are stored locally using OS secure storage and never leave your machine except to Anthropic.
              </div>
            </>
          )}
        </div>
      </Panel>

      <FeedModelPanel />
      <VoicePanel />
    </section>
  )
}

/** Voice: fidelity selector + enhanced (Kokoro neural) download + a per-role test.
 *  Max-local, fully offline once downloaded; the system voice is the fallback. */
function VoicePanel(): JSX.Element {
  const [quality, setQuality] = useState<VoiceQuality>(readVoiceQuality())
  const [state, setState] = useState<KokoroLoadState>(kokoroState())
  const [pct, setPct] = useState(0)
  const [errMsg, setErrMsg] = useState('')

  async function download(): Promise<void> {
    if (state === 'downloading' || state === 'ready') return
    setState('downloading'); setErrMsg(''); setPct(0)
    try {
      await loadKokoro((info) => {
        const p = info as { progress?: number; status?: string }
        if (typeof p.progress === 'number') setPct(Math.round(p.progress))
      })
      setState('ready')
    } catch (err) {
      setErrMsg((err as Error)?.message ?? 'unknown error')
      setState('failed')
    }
  }

  function test(role: 'pbp' | 'coach' | 'physio'): void {
    const eng = getKokoroEngine()
    const lines: Record<string, string> = {
      pbp: 'He shoots — and scores! What a finish top corner!',
      coach: "I want us harder on the forecheck tonight. No easy exits.",
      physio: "He's day to day. I'd rest him and not risk it.",
    }
    if (eng) eng.speak({ text: lines[role]!, speech: lines[role]!, importance: 2, voice: voiceFor(role) })
  }

  const QUAL: Array<{ v: VoiceQuality; label: string; note: string }> = [
    { v: 'standard', label: 'Standard', note: '~86 MB · fastest' },
    { v: 'high', label: 'High', note: '~160 MB · recommended' },
    { v: 'ultra', label: 'Ultra', note: '~330 MB · best fidelity' },
  ]

  return (
    <Panel title="AI Voices">
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Neural voices for commentary, staff meetings, and calls — cast per character. They
        download themselves the first time a voice is needed (no button to hunt for) and run
        fully local and offline after that; the system voice covers the gap until then.
      </div>
      <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Fidelity</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {QUAL.map((q) => (
            <button
              key={q.v}
              className={`btn btn-sm${quality === q.v ? ' btn-primary' : ''}`}
              onClick={() => { setVoiceQuality(q.v); setQuality(q.v) }}
              title={q.note}
            >
              {q.label}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {QUAL.find((q) => q.v === quality)?.note}
          {state === 'ready' ? ' · change takes effect after re-downloading the model.' : ''}
        </div>
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {state === 'ready' ? (
          <span className="chip chip-accent" style={{ fontSize: 11 }}>Neural voices ready</span>
        ) : state === 'downloading' ? (
          <span className="chip" style={{ fontSize: 11 }}>Downloading… {pct}%</span>
        ) : state === 'failed' ? (
          <button className="btn btn-sm btn-primary" onClick={() => void download()}>↻ Retry download</button>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={() => void download()}>Download now</button>
        )}
        {state === 'ready' && (
          <>
            <button className="btn btn-sm btn-ghost" onClick={() => test('pbp')}>▶ Commentator</button>
            <button className="btn btn-sm btn-ghost" onClick={() => test('coach')}>▶ Coach</button>
            <button className="btn btn-sm btn-ghost" onClick={() => test('physio')}>▶ Physio</button>
          </>
        )}
      </div>
      {state === 'failed' && (
        <div className="muted" style={{ fontSize: 11, marginTop: 8, color: 'var(--danger)' }}>
          Couldn’t fetch the voice model{errMsg ? `: ${errMsg}` : ''}. Check your internet connection and try again — the weights come from Hugging Face on first use.
        </div>
      )}
    </Panel>
  )
}

/** #149: opt-in local AI Feed writer — download the model + toggle it on. Fully
 *  offline once downloaded; the template writer is always the fallback. */
function FeedModelPanel(): JSX.Element | null {
  const bridge = feedModelBridge()
  const [status, setStatus] = useState<FeedModelStatus | null>(null)
  const [enabled, setEnabled] = useState(getFeedWriterEnabled())
  const [pct, setPct] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!bridge) return
    void bridge.status().then(setStatus).catch(() => {})
    const off = bridge.onProgress((p) => setPct(p))
    return off
  }, [bridge])

  if (!bridge) return null // main-process runtime not present (e.g. web build)

  async function doDownload(): Promise<void> {
    if (busy || !bridge) return
    setBusy(true); setMsg('')
    try {
      const r = await bridge.download()
      const s = await bridge.status()
      setStatus(s)
      setMsg(r.ok ? 'Model ready.' : `Download failed: ${r.message ?? 'unknown'}`)
    } finally { setBusy(false) }
  }

  const ready = status?.ready ?? false
  const bundled = status?.bundled ?? false
  const sizeMb = status?.approxSizeMb ?? 1000

  const statusText = bundled ? 'Included with the app' : ready ? 'Model ready' : busy ? `Downloading… ${pct}%` : 'Not installed'
  const statusColor = ready ? 'var(--green)' : 'var(--amber)'

  return (
    <Panel title="Local AI Feed writer">
      <div className="muted small" style={{ marginBottom: 'var(--sp-3)' }}>
        On by default — the Feed's posts are rewritten into natural prose by a small model
        that runs entirely on your machine (no account, no internet). The template writer
        is always the fallback, so the Feed works even when the model isn't installed.
      </div>
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <span className="chip" style={{ color: statusColor, borderColor: statusColor }}>{statusText}</span>
          {!ready && !bundled && (
            <button className="btn btn-sm" disabled={busy} onClick={() => void doDownload()}>
              {busy ? `Downloading… ${pct}%` : `Download model (~${Math.round(sizeMb)} MB)`}
            </button>
          )}
        </div>
        <ToggleRow
          label="Rewrite Feed posts with the local model"
          note={enabled
            ? (ready ? 'On — posts are being rewritten locally.' : 'On — activates automatically once the model is installed.')
            : 'Off — the Feed uses the deterministic template writer.'}
          value={enabled}
          onChange={(v) => { setEnabled(v); setFeedWriterEnabled(v) }}
        />
        {msg && <div className="muted small">{msg}</div>}
      </div>
    </Panel>
  )
}

function ToggleRow(props: {
  label: string
  note: string
  value: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={props.value}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{props.label}</div>
        <div className="muted small">{props.note}</div>
      </div>
    </label>
  )
}
