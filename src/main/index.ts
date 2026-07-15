import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { registerSaveIpc } from './saves'
import { registerPressIpc } from './press'
import { registerModIpc } from './mods'
import { registerFeedModelIpc } from './feedModel'

const isDev = !app.isPackaged

// Windows GPU drivers frequently crash Electron's GPU process, which cascades
// into a renderer crash and a blank window ("npm run dev doesn't work"). This
// app's UI is 2D (React + PixiJS); software compositing is plenty and rock
// solid. Disable HW acceleration BEFORE app-ready so the GPU is never in the
// loop. (The optional 3D match view is rarely used and degrades gracefully.)
app.disableHardwareAcceleration()

function createWindow(): void {
  const win = new BrowserWindow({
    title: 'The Show: Franchise Hockey Manager',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#0b0e14',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())
  // Fallback: never leave the window invisible. On some Windows GPU drivers a
  // GPU-process hiccup delays or drops first paint, so `ready-to-show` may not
  // fire and the app "runs" with no visible window. Show it anyway after a beat.
  const showGuard = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }, 3000)
  win.once('ready-to-show', () => clearTimeout(showGuard))

  // Surface renderer load failures instead of a silent blank window.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[main] renderer failed to load (${code} ${desc}) at ${url}`)
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  })
  // If the renderer process dies unexpectedly, reload it ONCE so the app can
  // recover — but never loop (a deterministic load crash would reload forever).
  let reloadedAfterCrash = false
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[main] render process gone: ${details.reason}`)
    if (win.isDestroyed() || details.reason === 'clean-exit') return
    if (!reloadedAfterCrash) {
      reloadedAfterCrash = true
      win.reload()
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerSaveIpc(ipcMain)
  registerPressIpc(ipcMain)
  registerModIpc(ipcMain)
  registerFeedModelIpc(ipcMain)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
