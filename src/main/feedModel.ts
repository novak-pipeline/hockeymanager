/**
 * Feed C runtime (#149) — the main-process local-model adapter.
 *
 * node-llama-cpp is an OPTIONAL dependency and is imported LAZILY here, so the
 * base app, the engine and the tests never load a native module. The pure writer
 * logic lives in @engine/story/feedWriter (dependency-free); this file is the
 * only place that touches the runtime + the model file.
 *
 * Steam-ready posture (see docs/THE-FEED.md):
 *  - CPU inference (the Vulkan/GPU prebuilt is optional; getLlama falls back to
 *    CPU), so it runs on any machine.
 *  - Model (~1 GB Qwen2.5-1.5B-Instruct, Apache-2.0) is downloaded ON DEMAND into
 *    userData, gitignored — the base download stays small, only opted-in players
 *    pull it.
 *  - All IPC returns typed results; inference errors fall back to the template
 *    upstream, never throw across the boundary.
 */

import type { IpcMain } from 'electron'

/** A ready-to-run prompt from the renderer (built by @engine/story/feedWriter,
 *  which lives on the renderer side so this main-process module needs NO engine
 *  import — it is a pure inference runtime). */
interface RawPrompt { system: string; user: string; maxTokens?: number }

/* ────────────────────────── pinned model ────────────────────────── */

/** The bundled-by-download model. Apache-2.0 → redistributable for a paid release. */
const MODEL = {
  file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  /** Q4_K_M of a 1.5B model is ≈ 1.0 GB — reject a truncated/HTML-error download. */
  minBytes: 800 * 1024 * 1024,
  /** TODO(before release): pin the real SHA-256 (compute from a verified download)
   *  and enforce it. Until then we size-check only. */
  sha256: '' as string,
}

/** Where a downloaded model is written (user-writable). */
function modelDir(): string {
  const { app } = require('electron') as typeof import('electron')
  const { join } = require('node:path') as typeof import('node:path')
  return join(app.getPath('userData'), 'models')
}
/** Where a BUNDLED model ships (read-only, packaged via electron-builder
 *  extraResources: `resources/models/<file>`). Present in a Steam build so the
 *  writer works out of the box with no download. */
function bundledModelPath(): string {
  const { join } = require('node:path') as typeof import('node:path')
  return join(process.resourcesPath ?? '', 'models', MODEL.file)
}
function downloadedModelPath(): string {
  const { join } = require('node:path') as typeof import('node:path')
  return join(modelDir(), MODEL.file)
}

function fileSize(p: string): number {
  const { statSync } = require('node:fs') as typeof import('node:fs')
  try { return statSync(p).size } catch { return -1 }
}

/** The model to load: prefer the bundled copy (shipped), else the downloaded
 *  one. Empty string when neither is present. */
function modelPath(): string {
  if (fileSize(bundledModelPath()) >= MODEL.minBytes) return bundledModelPath()
  if (fileSize(downloadedModelPath()) >= MODEL.minBytes) return downloadedModelPath()
  return ''
}

/** Model is present and big enough to be the real weights. */
function modelReady(): boolean {
  return modelPath() !== ''
}
/** Whether a bundled model shipped with the app (no download needed). */
function modelBundled(): boolean {
  return fileSize(bundledModelPath()) >= MODEL.minBytes
}

/* ────────────────────────── download ────────────────────────── */

type DownloadState = 'idle' | 'downloading' | 'ready' | 'error'
let downloadState: DownloadState = 'idle'
let downloadPct = 0
let downloadError = ''

async function verifySha256(p: string, expected: string): Promise<boolean> {
  if (!expected) return true // not pinned yet — size-check only (see MODEL.sha256)
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  const { createReadStream } = require('node:fs') as typeof import('node:fs')
  return await new Promise<boolean>((resolve) => {
    const h = createHash('sha256')
    createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex') === expected)).on('error', () => resolve(false))
  })
}

/** Stream the model to a temp file, verify, then move into place. Idempotent:
 *  a good existing file short-circuits. Progress is reported via `onPct`. */
async function downloadModel(onPct: (pct: number) => void): Promise<{ ok: boolean; message?: string }> {
  if (modelReady()) { downloadState = 'ready'; return { ok: true } }
  if (downloadState === 'downloading') return { ok: false, message: 'already downloading' }
  const { promises: fs, createWriteStream, mkdirSync } = require('node:fs') as typeof import('node:fs')
  downloadState = 'downloading'; downloadPct = 0; downloadError = ''
  const dest = modelPath()
  const tmp = `${dest}.part`
  try {
    mkdirSync(modelDir(), { recursive: true })
    const res = await fetch(MODEL.url)
    if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length') ?? 0)
    let got = 0
    const out = createWriteStream(tmp)
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.byteLength
      out.write(Buffer.from(value))
      if (total > 0) { const pct = Math.round((got / total) * 100); if (pct !== downloadPct) { downloadPct = pct; onPct(pct) } }
    }
    await new Promise<void>((r) => out.end(r))
    if (fileSize(tmp) < MODEL.minBytes) throw new Error('downloaded file is too small — likely an error page')
    if (!(await verifySha256(tmp, MODEL.sha256))) throw new Error('checksum mismatch')
    await fs.rename(tmp, dest)
    downloadState = 'ready'; downloadPct = 100
    return { ok: true }
  } catch (err) {
    downloadState = 'error'; downloadError = (err as Error).message
    try { await fs.rm(tmp, { force: true }) } catch { /* ignore */ }
    return { ok: false, message: downloadError }
  }
}

/* ────────────────────────── inference ────────────────────────── */

// Cached across calls — loading the model is the expensive part.
let llamaModel: unknown = null
let loading: Promise<void> | null = null

async function ensureModelLoaded(): Promise<void> {
  if (llamaModel) return
  if (!loading) {
    loading = (async () => {
      const { getLlama } = await import('node-llama-cpp')
      const llama = await getLlama()
      llamaModel = await llama.loadModel({ modelPath: modelPath() })
    })()
  }
  await loading
}

/** Run one grounded completion. Fresh context/session per call (cheap vs model
 *  load); the model stays resident. */
async function infer(prompt: RawPrompt): Promise<string> {
  await ensureModelLoaded()
  const { LlamaChatSession } = await import('node-llama-cpp')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = llamaModel as any
  const context = await model.createContext({ contextSize: 1024 })
  try {
    const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: prompt.system })
    const out = await session.prompt(prompt.user, { maxTokens: prompt.maxTokens ?? 160, temperature: 0.7 })
    return typeof out === 'string' ? out : ''
  } finally {
    await context.dispose()
  }
}

/* ────────────────────────── IPC ────────────────────────── */

export function registerFeedModelIpc(ipcMain: IpcMain): void {
  ipcMain.handle('feedModel:status', () => ({
    ready: modelReady(),
    /** True when the model shipped with the app — no download needed. */
    bundled: modelBundled(),
    state: modelReady() ? 'ready' : downloadState,
    pct: downloadPct,
    error: downloadError,
    file: MODEL.file,
    approxSizeMb: Math.round(MODEL.minBytes / (1024 * 1024)),
  }))

  ipcMain.handle('feedModel:download', async (event) => {
    return await downloadModel((pct) => {
      try { event.sender.send('feedModel:progress', pct) } catch { /* window gone */ }
    })
  })

  /** Run inference on a renderer-built prompt. Returns the raw completion; the
   *  renderer sanitises + falls back to the template (via localModelFeedWriter),
   *  so this never has to know about post shapes and never throws across IPC. */
  ipcMain.handle('feedModel:infer', async (_event, arg: unknown) => {
    const prompt = arg as RawPrompt
    if (!modelReady()) return { ok: false as const, text: '' }
    try {
      const text = await infer(prompt)
      return { ok: true as const, text }
    } catch (err) {
      return { ok: false as const, text: '', error: (err as Error).message }
    }
  })
}
