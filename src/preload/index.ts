import { contextBridge, ipcRenderer } from 'electron'

/**
 * The window.hockey bridge. The renderer-side contract lives in
 * src/renderer/lib/saves.ts (HockeyBridge) and src/renderer/lib/press.ts
 * (PressApi) — keep this shape in sync with them.
 * All disk access happens in the main process behind validated IPC handlers.
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
  },
  press: {
    setKey: (key: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('press:setKey', key),
    keyStatus: (): Promise<{ present: boolean }> =>
      ipcRenderer.invoke('press:keyStatus'),
    generate: (args: {
      personaId: string
      kind: string
      factSheet: unknown
      model?: string
    }): Promise<
      | { ok: true; headline: string; body: string; byline: string }
      | { ok: false; code: string; message: string }
    > => ipcRenderer.invoke('press:generate', args),
    gradeAnswer: (args: {
      question: string
      answer: string
    }): Promise<
      | { ok: true; tone: string; reaction: string }
      | { ok: false; code: string; message: string }
    > => ipcRenderer.invoke('press:gradeAnswer', args),
  }
}

contextBridge.exposeInMainWorld('hockey', api)

export type HockeyApi = typeof api
