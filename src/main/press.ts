/**
 * Press corps IPC handlers — main process only.
 *
 * Lazy imports are used for electron/SDK so this module can be required in
 * tests without triggering Electron bootstrap. The actual Anthropic client is
 * instantiated per-call (no global singleton) so key changes take effect
 * immediately.
 *
 * Error codes returned to the renderer (never throw across IPC):
 *   'no-key'       — no API key stored
 *   'bad-key'      — 401 from Anthropic
 *   'rate-limited' — 429 from Anthropic
 *   'network'      — other network / API error
 */

import type { IpcMain } from 'electron'
import type { PressFactSheet, PressPersonaId, PressSheetKind } from '@engine/story/factSheet'
import {
  buildPresserGradePrompt,
  buildSystemPrompt,
  buildUserPrompt,
  parseArticle,
  parseGrade,
  personaByline,
} from './pressPrompts'

/* ────────────────────────── key storage ────────────────────────── */

function keyPath(): string {
  // Lazy-import app so the module loads in a test context.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron')
  const { join } = require('node:path') as typeof import('node:path')
  return join(app.getPath('userData'), 'press.key')
}

async function storeKey(key: string): Promise<void> {
  const { safeStorage } = require('electron') as typeof import('electron')
  const { promises: fs } = require('node:fs') as typeof import('node:fs')
  const { mkdirSync } = require('node:fs') as typeof import('node:fs')
  const { dirname } = require('node:path') as typeof import('node:path')
  const p = keyPath()
  mkdirSync(dirname(p), { recursive: true })
  const encrypted = safeStorage.encryptString(key)
  await fs.writeFile(p, encrypted)
}

async function loadKey(): Promise<string | null> {
  const { safeStorage } = require('electron') as typeof import('electron')
  const { promises: fs } = require('node:fs') as typeof import('node:fs')
  try {
    const buf = await fs.readFile(keyPath())
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

/* ────────────────────────── Anthropic client ────────────────────────── */

type ErrorCode = 'no-key' | 'bad-key' | 'rate-limited' | 'network'

interface SuccessResult<T> { ok: true; value: T }
interface ErrorResult    { ok: false; code: ErrorCode; message: string }
type ApiResult<T> = SuccessResult<T> | ErrorResult

async function callAnthropic(opts: {
  key: string
  model: string
  systemPrompt: string
  userContent: string
  maxTokens: number
}): Promise<ApiResult<string>> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: opts.key })
    const resp = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: [
        {
          type: 'text',
          text: opts.systemPrompt,
          // Cache the system prompt per-call to save tokens on repeated persona use.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: opts.userContent }],
    })
    const first = resp.content[0]
    if (first?.type !== 'text') return { ok: false, code: 'network', message: 'unexpected response shape' }
    return { ok: true, value: first.text }
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    if (e.status === 401) return { ok: false, code: 'bad-key', message: 'API key rejected (401)' }
    if (e.status === 429) return { ok: false, code: 'rate-limited', message: 'Rate limited (429)' }
    const msg = e.message ?? String(err)
    return { ok: false, code: 'network', message: msg }
  }
}

/* ────────────────────────── IPC registration ────────────────────────── */

export function registerPressIpc(ipcMain: IpcMain): void {
  /* ── press:setKey ── store the API key via safeStorage */
  ipcMain.handle('press:setKey', async (_event, key: unknown) => {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('press:setKey expects a non-empty string key')
    }
    await storeKey(key.trim())
    return { ok: true }
  })

  /* ── press:keyStatus ── returns { present: boolean } */
  ipcMain.handle('press:keyStatus', async () => {
    const k = await loadKey()
    return { present: k !== null && k.trim().length > 0 }
  })

  /* ── press:generate ── produce a press article */
  ipcMain.handle(
    'press:generate',
    async (
      _event,
      args: unknown
    ): Promise<{ ok: true; headline: string; body: string; byline: string } | { ok: false; code: string; message: string }> => {
      const { personaId, kind, factSheet, model } = args as {
        personaId: PressPersonaId
        kind: PressSheetKind
        factSheet: PressFactSheet
        model?: string
      }
      const key = await loadKey()
      if (!key) return { ok: false, code: 'no-key', message: 'No API key configured' }

      const system = buildSystemPrompt(personaId)
      const user = buildUserPrompt(kind, factSheet)
      const result = await callAnthropic({
        key,
        model: model ?? 'claude-haiku-4-5',
        systemPrompt: system,
        userContent: user,
        maxTokens: 700,
      })
      if (!result.ok) return result

      const { headline, body } = parseArticle(result.value)
      const byline = personaByline(personaId)
      return { ok: true, headline, body, byline }
    }
  )

  /* ── press:gradeAnswer ── classify a press-conference answer */
  ipcMain.handle(
    'press:gradeAnswer',
    async (
      _event,
      args: unknown
    ): Promise<{ ok: true; tone: string; reaction: string } | { ok: false; code: string; message: string }> => {
      const { question, answer } = args as { question: string; answer: string }
      const key = await loadKey()
      if (!key) return { ok: false, code: 'no-key', message: 'No API key configured' }

      const userContent = buildPresserGradePrompt(question, answer)
      const result = await callAnthropic({
        key,
        model: 'claude-haiku-4-5',
        systemPrompt: 'You are a press-room tone classifier. Be concise and accurate.',
        userContent,
        maxTokens: 80,
      })
      if (!result.ok) return result

      const { tone, reaction } = parseGrade(result.value)
      return { ok: true, tone, reaction }
    }
  )
}
