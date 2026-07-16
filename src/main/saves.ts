/**
 * Save-file persistence (Electron main process). Saves live as one file per
 * slot under <userData>/saves (still named <slot>.json); writes are atomic
 * (tmp + rename) so a crash mid-write never corrupts an existing save.
 *
 * Payloads are gzip-compressed on disk. A career snapshot is dominated by
 * imported per-season stat lines (careerHistory) — highly repetitive text that
 * compresses ~10x — so a 57 MB JSON snapshot lands as ~5 MB on disk, turning a
 * multi-second autosave into a sub-second one. Compression runs async on the
 * libuv threadpool, off the main thread. Reads are transparent: the gzip magic
 * number distinguishes a compressed file from a legacy plain-JSON one, so saves
 * written before this change still load unchanged.
 *
 * The renderer reaches this module only through the 'saves:*' IPC channels —
 * registerSaveIpc() is the single hook main/index.ts calls. Slot names are
 * validated here because they originate in the renderer and become file names.
 */
import { mkdirSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { IpcMain } from 'electron'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/** First two bytes of any gzip stream (RFC 1952). Used to sniff legacy saves. */
const GZIP_MAGIC_0 = 0x1f
const GZIP_MAGIC_1 = 0x8b

const SLOT_PATTERN = /^[a-z0-9-]{1,40}$/i

/** Optional header fields surfaced in the save list (pulled from the snapshot). */
export interface SaveHeader {
  saveName?: string
  teamName?: string
  year?: number
  phase?: string
  savedAt?: string
}

export interface SaveListEntry {
  slot: string
  mtimeMs: number
  sizeBytes: number
  header: SaveHeader
}

function assertValidSlot(slot: string): void {
  if (typeof slot !== 'string' || !SLOT_PATTERN.test(slot)) {
    throw new Error(
      `invalid save slot ${JSON.stringify(slot)}: must match ${SLOT_PATTERN} (letters, digits, hyphens; max 40 chars)`
    )
  }
}

/** Directory holding all save files; created on first use. */
export function savesDir(): string {
  const dir = join(app.getPath('userData'), 'saves')
  mkdirSync(dir, { recursive: true })
  return dir
}

const slotPath = (slot: string): string => join(savesDir(), `${slot}.json`)

/**
 * Atomic write: gzip the JSON, write to <slot>.json.tmp, then rename over
 * <slot>.json. Compression happens on the libuv threadpool so it never blocks
 * the main thread; the file keeps its .json name (contents are gzip, sniffed on
 * read) so slot handling and the renderer bridge are untouched.
 */
export async function writeSave(slot: string, json: string): Promise<void> {
  assertValidSlot(slot)
  if (typeof json !== 'string') throw new Error('save payload must be a string')
  const dest = slotPath(slot)
  const tmp = `${dest}.tmp`
  const compressed = await gzipAsync(json)
  await fs.writeFile(tmp, compressed)
  await fs.rename(tmp, dest)
}

/** Read a slot file and return its JSON text, gunzipping if it is compressed. */
async function readSlotJson(path: string): Promise<string> {
  const buf = await fs.readFile(path)
  if (buf.length >= 2 && buf[0] === GZIP_MAGIC_0 && buf[1] === GZIP_MAGIC_1) {
    return (await gunzipAsync(buf)).toString('utf8')
  }
  // Legacy save written before compression was introduced: plain UTF-8 JSON.
  return buf.toString('utf8')
}

export async function readSave(slot: string): Promise<string> {
  assertValidSlot(slot)
  try {
    return await readSlotJson(slotPath(slot))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`save slot "${slot}" not found`)
    }
    throw err
  }
}

/** Pull the display header out of a parsed snapshot, tolerating any shape. */
function extractHeader(parsed: unknown): SaveHeader {
  const header: SaveHeader = {}
  if (typeof parsed !== 'object' || parsed === null) return header
  const s = parsed as Record<string, unknown>
  if (typeof s['saveName'] === 'string') header.saveName = s['saveName']
  if (typeof s['savedAt'] === 'string') header.savedAt = s['savedAt']
  if (typeof s['phase'] === 'string') header.phase = s['phase']
  if (typeof s['year'] === 'number') header.year = s['year']
  // Team name lives inside the serialized league data, keyed by userTeamId.
  try {
    const leagueData = s['leagueData'] as { teams?: Array<[string, unknown]> } | undefined
    const entry = leagueData?.teams?.find(([id]) => id === s['userTeamId'])
    const name = (entry?.[1] as { name?: unknown } | undefined)?.name
    if (typeof name === 'string') header.teamName = name
  } catch {
    /* header stays partial — listing must never fail on one odd save */
  }
  return header
}

/** All readable saves, newest first. Corrupt or unparseable files are skipped. */
export async function listSaves(): Promise<SaveListEntry[]> {
  const dir = savesDir()
  const files = await fs.readdir(dir)
  const entries: SaveListEntry[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const slot = file.slice(0, -'.json'.length)
    if (!SLOT_PATTERN.test(slot)) continue
    try {
      const path = join(dir, file)
      const stat = await fs.stat(path)
      const header = extractHeader(JSON.parse(await readSlotJson(path)))
      entries.push({ slot, mtimeMs: stat.mtimeMs, sizeBytes: stat.size, header })
    } catch {
      continue
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return entries
}

/** Idempotent: deleting a slot that does not exist is not an error. */
export async function deleteSave(slot: string): Promise<void> {
  assertValidSlot(slot)
  try {
    await fs.unlink(slotPath(slot))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/**
 * Registers the 'saves:*' IPC handlers. Arguments arrive from the renderer and
 * are untrusted: types are checked here and slot names re-validated inside
 * each operation before touching the filesystem.
 */
export function registerSaveIpc(ipcMain: IpcMain): void {
  ipcMain.handle('saves:write', (_event, slot: unknown, json: unknown) => {
    if (typeof slot !== 'string' || typeof json !== 'string') {
      throw new Error('saves:write expects (slot: string, json: string)')
    }
    return writeSave(slot, json)
  })

  ipcMain.handle('saves:read', (_event, slot: unknown) => {
    if (typeof slot !== 'string') throw new Error('saves:read expects (slot: string)')
    return readSave(slot)
  })

  ipcMain.handle('saves:list', () => listSaves())

  ipcMain.handle('saves:delete', (_event, slot: unknown) => {
    if (typeof slot !== 'string') throw new Error('saves:delete expects (slot: string)')
    return deleteSave(slot)
  })
}
