/**
 * THE BOOTH's audio files, for the renderer (main process, read-only).
 *
 * Commentary is pre-recorded: nothing here synthesises speech. It only reads
 * files the offline render scripts (scripts/booth/) wrote:
 *
 *   stems        <renderer>/commentary/<pair>/manifest.json + clips/*.ogg
 *                (shipped with the app; src/renderer/public in dev)
 *   name banks   fictional: <renderer>/commentary/<pair>/names/index.json + *.ogg
 *                mods:      <modsDir>/<mod>/commentary/<pair>/index.json + *.ogg
 *                (real player names are mod data, so their audio lives with the mod)
 *   pronunciations  <modsDir>/<mod>/pronunciations.json (merged, first mod wins)
 *
 * Everything from the renderer is untrusted: pair, source and file names are
 * validated against strict patterns / the known source list before any disk
 * access, so no request can walk out of these folders.
 */
import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { IpcMain } from 'electron'
import { modsDirs } from './mods'

const PAIR = /^[a-z0-9-]{1,24}$/
const FILE = /^[a-z0-9][a-z0-9._-]{0,120}\.ogg$/
const STEM_FILE = /^clips\/[a-z0-9][a-zA-Z0-9._-]{0,120}\.ogg$/
const MOD_FOLDER = /^[A-Za-z0-9._-]{1,64}$/

/** Where the shipped commentary folder is: packaged renderer, else the dev tree. */
function commentaryRoots(): string[] {
  const roots: string[] = [join(__dirname, '..', 'renderer', 'commentary')]
  try { roots.push(join(app.getAppPath(), 'src', 'renderer', 'public', 'commentary')) } catch { /* tests */ }
  roots.push(join(process.cwd(), 'src', 'renderer', 'public', 'commentary'))
  return [...new Set(roots)]
}

function shippedPairDir(pair: string): string | null {
  for (const r of commentaryRoots()) {
    const d = join(r, pair)
    if (existsSync(join(d, 'manifest.json'))) return d
  }
  return null
}

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}

async function readBytes(path: string): Promise<Uint8Array | null> {
  try { return new Uint8Array(await readFile(path)) } catch { return null }
}

/** Mod folders that carry a name bank for this pair: source id -> directory. */
function modBankDirs(pair: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const dir of modsDirs()) {
    if (!existsSync(dir)) continue
    let names: string[] = []
    try { names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { continue }
    for (const m of names) {
      if (!MOD_FOLDER.test(m)) continue
      const d = join(dir, m, 'commentary', pair)
      if (!out.has(`mod:${m}`) && existsSync(join(d, 'index.json'))) out.set(`mod:${m}`, d)
    }
  }
  return out
}

function bankDir(pair: string, source: string): string | null {
  if (source === 'fictional') {
    const d = shippedPairDir(pair)
    return d ? join(d, 'names') : null
  }
  return modBankDirs(pair).get(source) ?? null
}

export interface NameBankListing {
  source: string
  entries: Record<string, string>
}

export function registerBoothIpc(ipcMain: IpcMain): void {
  ipcMain.handle('booth:manifest', async (_e, pair: unknown) => {
    if (typeof pair !== 'string' || !PAIR.test(pair)) return null
    const d = shippedPairDir(pair)
    return d ? readJson(join(d, 'manifest.json')) : null
  })

  ipcMain.handle('booth:stem', async (_e, pair: unknown, file: unknown) => {
    if (typeof pair !== 'string' || !PAIR.test(pair) || typeof file !== 'string' || !STEM_FILE.test(file)) return null
    const d = shippedPairDir(pair)
    return d ? readBytes(join(d, ...file.split('/'))) : null
  })

  ipcMain.handle('booth:nameBanks', async (_e, pair: unknown) => {
    if (typeof pair !== 'string' || !PAIR.test(pair)) return []
    const out: NameBankListing[] = []
    const sources: Array<[string, string]> = []
    const fict = bankDir(pair, 'fictional')
    if (fict) sources.push(['fictional', fict])
    for (const [s, d] of modBankDirs(pair)) sources.push([s, d])
    for (const [source, dir] of sources) {
      const idx = (await readJson(join(dir, 'index.json'))) as { entries?: Record<string, string> } | null
      if (idx?.entries && typeof idx.entries === 'object') out.push({ source, entries: idx.entries })
    }
    return out
  })

  ipcMain.handle('booth:nameClip', async (_e, pair: unknown, source: unknown, file: unknown) => {
    if (typeof pair !== 'string' || !PAIR.test(pair)) return null
    if (typeof source !== 'string' || typeof file !== 'string' || !FILE.test(file)) return null
    const d = bankDir(pair, source)
    return d ? readBytes(join(d, file)) : null
  })

  ipcMain.handle('booth:pronunciations', async () => {
    const merged: { version: 1; byExternalId: Record<string, string>; byName: Record<string, string> } =
      { version: 1, byExternalId: {}, byName: {} }
    let any = false
    for (const dir of modsDirs()) {
      if (!existsSync(dir)) continue
      let names: string[] = []
      try { names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { continue }
      for (const m of names) {
        const f = (await readJson(join(dir, m, 'pronunciations.json'))) as
          { byExternalId?: Record<string, string>; byName?: Record<string, string> } | null
        if (!f) continue
        any = true
        for (const [k, v] of Object.entries(f.byExternalId ?? {})) if (typeof v === 'string' && !(k in merged.byExternalId)) merged.byExternalId[k] = v
        for (const [k, v] of Object.entries(f.byName ?? {})) if (typeof v === 'string' && !(k in merged.byName)) merged.byName[k] = v
      }
    }
    return any ? merged : null
  })
}
