/**
 * Mod discovery and face-image IO for the main process.
 *
 * Mods live in <projectRoot>/mods/ (dev) or <userData>/mods/ (packaged).
 * Each mod is a sub-folder containing database.json and an optional faces/
 * directory with PNG files keyed by faceId.
 *
 * All IPC from the renderer is untrusted; faceIds are validated against a
 * strict allowlist pattern before any file access is attempted.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { IpcMain } from 'electron'

/* ─── constants ─── */

/** Only these characters are legal in a faceId (prevents path traversal). */
const FACE_ID_PATTERN = /^[A-Za-z0-9._-]+$/

export interface ModListEntry {
  id: string
  name: string
  season?: string
  teamCount: number
}

/* ─── directory helpers ─── */

/**
 * Candidate directories to scan for mods.  Dev runs from the project root so
 * process.cwd()/mods picks up K:\Hockey Game\mods\nhl-ehm\.  packaged builds
 * use <userData>/mods.
 */
export function modsDirs(): string[] {
  const dirs: string[] = []
  // Project-root mods (dev)
  const devMods = join(process.cwd(), 'mods')
  dirs.push(devMods)
  // User-data mods (packaged / user-installed)
  try {
    const userMods = join(app.getPath('userData'), 'mods')
    if (userMods !== devMods) dirs.push(userMods)
  } catch {
    // app may not be ready yet in test environments
  }
  return dirs
}

/** Absolute path of a named mod folder, or null if not found. */
function locateMod(id: string): string | null {
  for (const dir of modsDirs()) {
    const candidate = join(dir, id)
    if (existsSync(join(candidate, 'database.json'))) return candidate
    }
  return null
}

/* ─── list ─── */

/**
 * Scan all mod directories and return metadata for each valid mod.
 * Tolerate missing / unreadable / corrupt folders — just skip them.
 */
export function listMods(): ModListEntry[] {
  const results: ModListEntry[] = []
  const seen = new Set<string>()

  for (const dir of modsDirs()) {
    if (!existsSync(dir)) continue
    let entries: string[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      continue
    }
    for (const folderName of entries) {
      const id = folderName
      if (seen.has(id)) continue
      const dbPath = join(dir, folderName, 'database.json')
      if (!existsSync(dbPath)) continue
      try {
        const raw = JSON.parse(readFileSync(dbPath, 'utf8')) as Record<string, unknown>
        const meta = raw['meta'] as Record<string, unknown> | undefined
        if (!meta || typeof meta['name'] !== 'string') continue
        // Count total teams
        let teamCount = 0
        const conferences = raw['conferences'] as unknown[] | undefined
        if (Array.isArray(conferences)) {
          for (const conf of conferences) {
            const divs = (conf as Record<string, unknown>)['divisions'] as unknown[] | undefined
            if (!Array.isArray(divs)) continue
            for (const div of divs) {
              const teams = (div as Record<string, unknown>)['teams'] as unknown[] | undefined
              if (Array.isArray(teams)) teamCount += teams.length
            }
          }
        }
        const entry: ModListEntry = {
          id,
          name: meta['name'] as string,
          ...(typeof meta['season'] === 'string' ? { season: meta['season'] as string } : {}),
          teamCount,
        }
        results.push(entry)
        seen.add(id)
      } catch {
        continue
      }
    }
  }
  return results
}

/* ─── read database ─── */

/** Return the parsed database.json for mod `id`. Throws if not found. */
export function readModDatabase(id: string): unknown {
  const folder = locateMod(id)
  if (!folder) throw new Error(`mod "${id}" not found in any mods directory`)
  const dbPath = join(folder, 'database.json')
  try {
    return JSON.parse(readFileSync(dbPath, 'utf8')) as unknown
  } catch (err) {
    throw new Error(`failed to read mod "${id}" database: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/* ─── face images ─── */

/** path-lookup cache: faceId -> absolute PNG path (or null = not found). */
const facePathCache = new Map<string, string | null>()

function assertFaceId(faceId: string): void {
  if (!FACE_ID_PATTERN.test(faceId)) {
    throw new Error(`invalid faceId ${JSON.stringify(faceId)}: only [A-Za-z0-9._-] allowed`)
  }
}

/**
 * Search every mod's faces/ directory for <faceId>.png and return a data URL,
 * or null if not found.  Results are cached per process lifetime.
 */
export async function readFace(faceId: string): Promise<string | null> {
  assertFaceId(faceId)

  if (facePathCache.has(faceId)) {
    const cached = facePathCache.get(faceId)!
    if (cached === null) return null
    try {
      const buf = await readFile(cached)
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      // File disappeared; evict and fall through
      facePathCache.delete(faceId)
    }
  }

  for (const dir of modsDirs()) {
    if (!existsSync(dir)) continue
    let folderNames: string[]
    try {
      folderNames = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      continue
    }
    for (const folderName of folderNames) {
      const candidate = join(dir, folderName, 'faces', `${faceId}.png`)
      if (existsSync(candidate)) {
        facePathCache.set(faceId, candidate)
        try {
          const buf = await readFile(candidate)
          return `data:image/png;base64,${buf.toString('base64')}`
        } catch {
          facePathCache.set(faceId, null)
          return null
        }
      }
    }
  }

  facePathCache.set(faceId, null)
  return null
}

/* ─── IPC registration ─── */

/**
 * Register mods:list / mods:read / mods:face IPC handlers.
 * Mirror the pattern used in saves.ts / registerSaveIpc.
 */
export function registerModIpc(ipcMain: IpcMain): void {
  ipcMain.handle('mods:list', () => listMods())

  ipcMain.handle('mods:read', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('mods:read expects (id: string)')
    return readModDatabase(id)
  })

  ipcMain.handle('mods:face', (_event, faceId: unknown) => {
    if (typeof faceId !== 'string') throw new Error('mods:face expects (faceId: string)')
    return readFace(faceId)
  })
}
