import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { warmNeuralVoices } from './lib/speak'
import { runVoiceBench } from './lib/voiceBench'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)

// "Downloaded by default": warm the neural (Kokoro) voices in the background once
// the UI is up, so they're ready before the first match/trade line — rather than
// paying the download on first use. Opt-out (Settings → AI Voices) and one-time;
// a failure silently leaves the stable system voice in place. Deferred a beat so
// it never competes with first paint / league boot.
setTimeout(() => { try { warmNeuralVoices() } catch { /* system voice stays */ } }, 1500)

// Dev ruler for the TTS work: `await window.hockeyVoiceBench()` in the console
// speaks a multi-chunk line and reports latency to first sound plus the total
// main-thread time it stole. See src/renderer/lib/voiceBench.ts.
;(window as unknown as { hockeyVoiceBench: typeof runVoiceBench }).hockeyVoiceBench = runVoiceBench
