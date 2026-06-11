import { contextBridge, ipcRenderer } from 'electron'

/**
 * The window.hockey bridge. The renderer-side contract lives in
 * src/renderer/lib/saves.ts (HockeyBridge) — keep this shape in sync with it.
 * All disk access happens in the main process behind validated IPC handlers
 * (src/main/saves.ts).
 */
const api = {
  version: '0.0.1',
  saves: {
    write: (slot: string, json: string): Promise<void> =>
      ipcRenderer.invoke('saves:write', slot, json),
    read: (slot: string): Promise<string> => ipcRenderer.invoke('saves:read', slot),
    list: (): Promise<
      Array<{
        slot: string
        mtimeMs: number
        sizeBytes: number
        header: {
          saveName?: string
          teamName?: string
          year?: number
          phase?: string
          savedAt?: string
        }
      }>
    > => ipcRenderer.invoke('saves:list'),
    delete: (slot: string): Promise<void> => ipcRenderer.invoke('saves:delete', slot)
  }
}

contextBridge.exposeInMainWorld('hockey', api)

export type HockeyApi = typeof api
