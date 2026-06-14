/**
 * Settings screen — includes the PRESS PASS panel for BYO API key,
 * writer model selection, and feature toggles.
 */
import { useEffect, useRef, useState } from 'react'
import { Panel, ScreenHeader } from '../components/ui'
import { getPressSettings, setPressSettings } from '../lib/press'
import { useUiStore } from '../components/store'
import { THEME_OPTIONS } from '../components/themes'

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
    </section>
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
