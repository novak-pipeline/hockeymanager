/**
 * Renderer-side press corps bridge and press pump.
 *
 * The window.hockey.press surface declared here mirrors the preload shape
 * exactly. The press pump (pollPress) calls getPressJob on every refresh-bus
 * bump, generates/fallbacks the article, and submits it back via the worker.
 *
 * No Anthropic SDK here — all network calls go through the main-process IPC.
 */
import type { SimClient } from '@worker/client'
import type { PressPersonaId, PressSheetKind } from '@engine/story/factSheet'
import { renderFallback } from '@engine/story/pressFallback'

/* ────────────────────────── bridge type ────────────────────────── */

export interface PressApi {
  setKey(key: string): Promise<{ ok: boolean }>
  keyStatus(): Promise<{ present: boolean }>
  generate(args: {
    personaId: string
    kind: string
    factSheet: unknown
    model?: string
  }): Promise<
    | { ok: true; headline: string; body: string; byline: string }
    | { ok: false; code: string; message: string }
  >
  gradeAnswer(args: {
    question: string
    answer: string
  }): Promise<
    | { ok: true; tone: string; reaction: string }
    | { ok: false; code: string; message: string }
  >
}

/** Extended HockeyBridge with the press namespace attached. */
export interface HockeyBridgeWithPress {
  version: string
  saves: {
    write(slot: string, json: string): Promise<void>
    read(slot: string): Promise<string>
    list(): Promise<unknown[]>
    delete(slot: string): Promise<void>
  }
  press: PressApi
}

function pressApi(): PressApi | null {
  const hockey = (window as unknown as { hockey?: Partial<HockeyBridgeWithPress> }).hockey
  return hockey?.press ?? null
}

/* ────────────────────────── settings helpers ────────────────────────── */

const LS_PREFIX = 'press_'

export function getPressSettings(): {
  model: string
  weeklyEnabled: boolean
  specialsEnabled: boolean
  pressersEnabled: boolean
} {
  return {
    model: localStorage.getItem(`${LS_PREFIX}model`) ?? 'claude-haiku-4-5',
    weeklyEnabled: localStorage.getItem(`${LS_PREFIX}weekly`) !== 'false',
    specialsEnabled: localStorage.getItem(`${LS_PREFIX}specials`) !== 'false',
    pressersEnabled: localStorage.getItem(`${LS_PREFIX}pressers`) !== 'false',
  }
}

export function setPressSettings(settings: {
  model?: string
  weeklyEnabled?: boolean
  specialsEnabled?: boolean
  pressersEnabled?: boolean
}): void {
  if (settings.model !== undefined) localStorage.setItem(`${LS_PREFIX}model`, settings.model)
  if (settings.weeklyEnabled !== undefined)
    localStorage.setItem(`${LS_PREFIX}weekly`, String(settings.weeklyEnabled))
  if (settings.specialsEnabled !== undefined)
    localStorage.setItem(`${LS_PREFIX}specials`, String(settings.specialsEnabled))
  if (settings.pressersEnabled !== undefined)
    localStorage.setItem(`${LS_PREFIX}pressers`, String(settings.pressersEnabled))
}

/* ────────────────────────── press pump ────────────────────────── */

/** Debounce: one job at a time. */
let pumpInFlight = false

/**
 * Called on every refresh-bus bump from App (or any screen that mounts in the
 * shell). Polls for a pending press job, attempts LLM generation (or falls
 * back to the deterministic writer), then submits the article to the career.
 */
export async function pollPress(client: SimClient): Promise<void> {
  if (pumpInFlight) return
  pumpInFlight = true
  try {
    await runPump(client)
  } finally {
    pumpInFlight = false
  }
}

async function runPump(client: SimClient): Promise<void> {
  // Ask the career for a pending job.
  const jobRes = await client.getPressJob()
  if (jobRes.type !== 'pressJob' || !jobRes.pressJob) return

  const job = jobRes.pressJob
  const settings = getPressSettings()

  // Check feature toggles.
  const isSpecial = (job.kind as PressSheetKind) !== 'weekly' && (job.kind as PressSheetKind) !== 'presser'
  if ((job.kind as PressSheetKind) === 'weekly' && !settings.weeklyEnabled) {
    await client.skipPressJob(job.id)
    return
  }
  if (isSpecial && !settings.specialsEnabled) {
    await client.skipPressJob(job.id)
    return
  }

  // Try LLM generation; on ANY failure fall back to deterministic writer.
  const api = pressApi()
  let headline: string
  let body: string
  let byline: string
  let model = '(wire)'

  if (api) {
    const status = await api.keyStatus().catch(() => ({ present: false }))
    if (status.present) {
      const result = await api
        .generate({
          personaId: job.personaId,
          kind: job.kind,
          factSheet: job.factSheet,
          model: settings.model,
        })
        .catch(() => ({ ok: false as const, code: 'network', message: 'unknown' }))

      if (result.ok) {
        headline = result.headline
        body = result.body
        byline = result.byline
        model = settings.model
      } else {
        // LLM failed — fall through to fallback.
        const fb = renderFallback(job)
        headline = fb.headline
        body = fb.body
        byline = `${fb.byline} (wire report)`
      }
    } else {
      const fb = renderFallback(job)
      headline = fb.headline
      body = fb.body
      byline = `${fb.byline} (wire report)`
    }
  } else {
    const fb = renderFallback(job)
    headline = fb.headline
    body = fb.body
    byline = `${fb.byline} (wire report)`
  }

  await client.submitPressArticle({ jobId: job.id, headline, body, byline, model })
}
