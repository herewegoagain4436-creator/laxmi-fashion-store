'use strict'

const { app, BrowserWindow, shell, dialog, ipcMain, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const {
  getUpdateToken,
  setUpdateToken,
  clearUpdateToken,
  hasStoredToken,
  hasEnvToken,
} = require('./token-store.cjs')
const { checkForUpdates, getUpdateStatus } = require('./updater.cjs')

const DEFAULT_PORT = Number(process.env.PORT || 8787)
let mainWindow = null
let starting = false

function resolveResource(...parts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...parts)
  }
  return path.join(__dirname, '..', ...parts)
}

function waitForHealth(port, tries = 60) {
  return new Promise((resolve, reject) => {
    let n = 0
    const tick = () => {
      n++
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume()
        if (res.statusCode === 200) resolve()
        else if (n >= tries) reject(new Error('Server health check failed'))
        else setTimeout(tick, 200)
      })
      req.on('error', () => {
        if (n >= tries) reject(new Error('Server did not start'))
        else setTimeout(tick, 200)
      })
    }
    tick()
  })
}

async function startBackend() {
  const userData = app.getPath('userData')
  const dbDir = path.join(userData, 'data')
  fs.mkdirSync(dbDir, { recursive: true })

  // SQLite always under userData — app updates must never wipe this path
  process.env.LAXMI_DB = path.join(dbDir, 'laxmi.db')
  process.env.LAXMI_WEB_DIST = app.isPackaged
    ? path.join(process.resourcesPath, 'web-dist')
    : path.join(__dirname, '..', '..', 'web', 'dist')
  process.env.PORT = String(DEFAULT_PORT)
  process.env.HOST = '127.0.0.1'
  process.env.LAXMI_SECRET = process.env.LAXMI_SECRET || 'laxmi-fashion-desktop-secret'

  const serverEntryPackaged = path.join(process.resourcesPath, 'server', 'index.js')
  const serverEntryDev = path.join(__dirname, '..', '..', 'server', 'dist', 'index.js')
  const serverEntry = app.isPackaged ? serverEntryPackaged : serverEntryDev

  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `Server bundle missing at ${serverEntry}. Run npm run build in the monorepo first.`,
    )
  }

  if (app.isPackaged) {
    const serverNodeModules = path.join(process.resourcesPath, 'server', 'node_modules')
    module.paths.unshift(serverNodeModules)
    process.env.NODE_PATH = [serverNodeModules, process.env.NODE_PATH || '']
      .filter(Boolean)
      .join(path.delimiter)
  }

  const { pathToFileURL } = require('url')
  const mod = await import(pathToFileURL(serverEntry).href)
  if (typeof mod.startServer === 'function') {
    await mod.startServer({ port: DEFAULT_PORT, host: '127.0.0.1' })
  }
  await waitForHealth(DEFAULT_PORT)
  return DEFAULT_PORT
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for updates…',
          click: () => {
            void checkForUpdates({ silent: false })
          },
        },
        {
          label: 'Open Settings (in app)',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.loadURL(`http://127.0.0.1:${DEFAULT_PORT}/settings`)
            }
          },
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            const ver = require('../package.json').version
            dialog.showMessageBox(mainWindow || undefined, {
              type: 'info',
              title: 'About',
              message: 'Laxmi Fashion Wholesale Mart',
              detail: `Version ${ver}\nData folder: ${app.getPath('userData')}\nUpdates: private GitHub Releases`,
            })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc() {
  ipcMain.handle('laxmi:get-app-version', () => require('../package.json').version)

  ipcMain.handle('laxmi:get-update-token-meta', () => ({
    hasToken: Boolean(getUpdateToken()),
    hasStoredToken: hasStoredToken(),
    hasEnvToken: hasEnvToken(),
    source: hasEnvToken() ? 'env' : hasStoredToken() ? 'stored' : 'none',
  }))

  ipcMain.handle('laxmi:set-update-token', (_e, token) => {
    setUpdateToken(typeof token === 'string' ? token : '')
    return {
      ok: true,
      hasToken: Boolean(getUpdateToken()),
      source: hasEnvToken() ? 'env' : hasStoredToken() ? 'stored' : 'none',
    }
  })

  ipcMain.handle('laxmi:clear-update-token', () => {
    clearUpdateToken()
    return { ok: true, hasToken: Boolean(getUpdateToken()) }
  })

  ipcMain.handle('laxmi:check-for-updates', async () => {
    return checkForUpdates({ silent: false })
  })

  ipcMain.handle('laxmi:get-update-status', () => getUpdateStatus())
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Laxmi Fashion Wholesale Mart',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.loadURL(`http://127.0.0.1:${port}/`)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function boot() {
  if (starting) return
  starting = true
  try {
    registerIpc()
    buildMenu()
    const port = await startBackend()
    createWindow(port)
    // Private update check on startup (quiet if no token / already latest)
    if (app.isPackaged) {
      setTimeout(() => {
        void checkForUpdates({ silent: true })
      }, 4000)
    }
  } catch (err) {
    console.error(err)
    dialog.showErrorBox(
      'Laxmi Fashion failed to start',
      String(err && err.message ? err.message : err),
    )
    app.quit()
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(boot)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void boot()
  })
}
