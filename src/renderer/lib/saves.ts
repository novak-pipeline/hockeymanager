/**
 * Renderer-side save helpers. All disk access happens in the main process;
 * this module talks to it through the window.hockey bridge the preload script
 * exposes (ipcRenderer.invoke under the hood) and layers snapshot validation
 * on top so screens only ever see a structurally sound CareerSnapshot.
 *
 * The bridge surface declared here is the contract the preload must satisfy.
 */
import { validateSnapshot } from '@engine/career/serialize'
import type { CareerSnapshot, SaveSlotInfo } from '@engine/career/views'

/** Header fields the main process lifts out of each save for listing. */
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

/** What this module expects preload to expose as window.hockey. */
export interface HockeyBridge {
  version: string
  saves: {
    write(slot: string, json: string): Promise<void>
    read(slot: string): Promise<string>
    list(): Promise<SaveListEntry[]>
    delete(slot: string): Promise<void>
  }
}

/** Save-slot list rows for the load screen, enriched with file metadata. */
export type CareerSaveInfo = SaveSlotInfo & { mtimeMs: number; sizeBytes: number }

function bridge(): HockeyBridge['saves'] {
  const hockey = (window as unknown as { hockey?: Partial<HockeyBridge> }).hockey
  if (!hockey?.saves) {
    throw new Error(
      'save bridge unavailable: window.hockey.saves is missing — preload script not loaded (saving requires the desktop app)'
    )
  }
  return hockey.saves as HockeyBridge['saves']
}

export async function saveCareer(slot: string, snapshot: CareerSnapshot): Promise<void> {
  await bridge().write(slot, JSON.stringify(snapshot))
}

export async function loadCareer(slot: string): Promise<CareerSnapshot> {
  const json = await bridge().read(slot)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error(`save "${slot}" is corrupt: file is not valid JSON`)
  }
  return validateSnapshot(parsed)
}

const PHASES = ['regularSeason', 'playoffs', 'offseason'] as const

export async function listCareerSaves(): Promise<CareerSaveInfo[]> {
  const entries = await bridge().list()
  return entries.map(({ slot, mtimeMs, sizeBytes, header }) => ({
    slot,
    mtimeMs,
    sizeBytes,
    saveName: header.saveName ?? slot,
    savedAt: header.savedAt ?? new Date(mtimeMs).toISOString(),
    teamName: header.teamName ?? 'Unknown club',
    year: header.year ?? 0,
    phase: PHASES.includes(header.phase as (typeof PHASES)[number])
      ? (header.phase as SaveSlotInfo['phase'])
      : 'regularSeason'
  }))
}

export async function deleteCareerSave(slot: string): Promise<void> {
  await bridge().delete(slot)
}
