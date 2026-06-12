/**
 * Renderer-side helpers for the mod bridge exposed by the preload script.
 * Falls back gracefully when running in a plain browser (no window.hockey.mods).
 */

export interface ModListEntry {
  id: string
  name: string
  season?: string
  teamCount: number
}

// Minimal shape of the bridge surface this module needs.
interface ModsBridge {
  list(): Promise<ModListEntry[]>
  read(id: string): Promise<unknown>
  face(faceId: string): Promise<string | null>
}

function bridge(): ModsBridge | null {
  const hockey = (window as unknown as { hockey?: { mods?: ModsBridge } }).hockey
  return hockey?.mods ?? null
}

/** Returns [] when bridge is absent (browser dev / tests). */
export async function listMods(): Promise<ModListEntry[]> {
  try {
    return (await bridge()?.list()) ?? []
  } catch {
    return []
  }
}

/** Returns null when bridge is absent or the mod is not found. */
export async function readModDatabase(id: string): Promise<unknown> {
  try {
    return (await bridge()?.read(id)) ?? null
  } catch {
    return null
  }
}

/** Returns a data URL string or null if the face image is absent / bridge unavailable. */
export async function getFace(faceId: string): Promise<string | null> {
  try {
    return (await bridge()?.face(faceId)) ?? null
  } catch {
    return null
  }
}
