/**
 * Renderer bridge for the opt-in local Feed writer (#149). All heavy lifting
 * (model download + inference) happens in the main process via window.hockey
 * .feedModel; this is just the typed accessor + the on/off preference.
 */

export interface FeedModelStatus {
  ready: boolean
  /** Model shipped with the app (no download needed). */
  bundled?: boolean
  state: string
  pct: number
  error: string
  file: string
  approxSizeMb: number
}

export interface FeedModelBridge {
  status(): Promise<FeedModelStatus>
  download(): Promise<{ ok: boolean; message?: string }>
  /** Run inference on a renderer-built prompt (from @engine/story/feedWriter). */
  infer(prompt: { system: string; user: string; maxTokens?: number }): Promise<{ ok: boolean; text: string; error?: string }>
  onProgress(cb: (pct: number) => void): () => void
}

export function feedModelBridge(): FeedModelBridge | null {
  const hockey = (window as unknown as { hockey?: { feedModel?: FeedModelBridge } }).hockey
  return hockey?.feedModel ?? null
}

const LS_KEY = 'hockey.feed.localWriter'

/** The local writer is ON BY DEFAULT — it's the shipped experience, so it works
 *  out of the box once the model is present (bundled with the app, or downloaded).
 *  Only an explicit opt-OUT disables it; when the model is absent everything
 *  falls back to the template writer, so default-on is always safe. */
export function getFeedWriterEnabled(): boolean {
  return localStorage.getItem(LS_KEY) !== 'false'
}
export function setFeedWriterEnabled(v: boolean): void {
  localStorage.setItem(LS_KEY, String(v))
}
