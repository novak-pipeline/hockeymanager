import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import { registerSaveIpc } from './saves'
import { registerPressIpc } from './press'
import { registerModIpc } from './mods'
import { registerFeedModelIpc } from './feedModel'

const { autoUpdater } = electronUpdater

const isDev = !app.isPackaged

// Windows GPU drivers frequently crash Electron's GPU process, which cascades
// into a renderer crash and a blank window ("npm run dev doesn't work"). This
// app's UI is 2D (React + PixiJS); software compositing is plenty and rock
// solid. Disable HW acceleration BEFORE app-ready so the GPU is never in the
// loop. (The optional 3D match view is rarely used and degrades gracefully.)
app.disableHardwareAcceleration()

// Preserve existing careers across the productName rename to "The Show": Electron
// derives userData from the app name, so renaming would silently point the app at
// a fresh, empty saves folder. Pin userData to the original "hockey-manager" path
// so every existing autosave/slot stays exactly where the app looks for it.
app.setPath('userData', join(app.getPath('appData'), 'hockey-manager'))

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

  // Self-update: only in packaged builds (dev never talks to the release feed).
  // checkForUpdatesAndNotify() downloads a newer version in the background and
  // shows a native "restart to update" notification — installs on next quit,
  // so a mid-playtest session is never interrupted. Wrapped so a network/feed
  // failure can never block startup or crash the main process.
  if (app.isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.on('error', (err) => console.error('[updater]', err?.message ?? err))
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('[updater] check failed:', err?.message ?? err)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
