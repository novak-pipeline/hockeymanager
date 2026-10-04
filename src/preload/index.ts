import { contextBridge, ipcRenderer } from 'electron'

/**
 * The window.hockey bridge. The renderer-side contract lives in
 * src/renderer/lib/saves.ts (HockeyBridge) and src/renderer/lib/press.ts
 * (PressApi) — keep this shape in sync with them.
 * All disk access happens in the main process behind validated IPC handlers.
 */
const api = {
  version: '0.0.1',
  /** DEV ONLY: true when the main process enabled the viewer-truth probe (never packaged). */
  devViewerProbe: ipcRenderer.sendSync('dev:viewerProbe') === true,
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
  mods: {
    list: (): Promise<
      Array<{
        id: string
        name: string
        season?: string
        teamCount: number
      }>
    > => ipcRenderer.invoke('mods:list'),
    read: (id: string): Promise<unknown> => ipcRenderer.invoke('mods:read', id),
    face: (faceId: string): Promise<string | null> => ipcRenderer.invoke('mods:face', faceId),
    scene: (name: string): Promise<string | null> => ipcRenderer.invoke('mods:scene', name),
    logo: (logoId: string): Promise<string | null> => ipcRenderer.invoke('mods:logo', logoId),
  },
  /** The commentary booth's pre-recorded audio (read-only; see src/main/booth.ts). */
  booth: {
    manifest: (pair: string): Promise<unknown> => ipcRenderer.invoke('booth:manifest', pair),
    stem: (pair: string, file: string): Promise<Uint8Array | null> => ipcRenderer.invoke('booth:stem', pair, file),
    nameBanks: (pair: string): Promise<Array<{ source: string; entries: Record<string, string> }>> =>
      ipcRenderer.invoke('booth:nameBanks', pair),
    nameClip: (pair: string, source: string, file: string): Promise<Uint8Array | null> =>
      ipcRenderer.invoke('booth:nameClip', pair, source, file),
    pronunciations: (): Promise<unknown> => ipcRenderer.invoke('booth:pronunciations'),
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
  },
  /** #149: the opt-in local Feed writer (model download + prose rewrite). */
  feedModel: {
    status: (): Promise<{ ready: boolean; state: string; pct: number; error: string; file: string; approxSizeMb: number }> =>
      ipcRenderer.invoke('feedModel:status'),
    download: (): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('feedModel:download'),
    infer: (prompt: { system: string; user: string; maxTokens?: number }): Promise<{ ok: boolean; text: string; error?: string }> =>
      ipcRenderer.invoke('feedModel:infer', prompt),
    onProgress: (cb: (pct: number) => void): (() => void) => {
      const handler = (_e: unknown, pct: number): void => cb(pct)
      ipcRenderer.on('feedModel:progress', handler)
      return () => ipcRenderer.removeListener('feedModel:progress', handler)
    },
  },
}

contextBridge.exposeInMainWorld('hockey', api)

export type HockeyApi = typeof api
