'use strict'

const { dialog, BrowserWindow } = require('electron')
const { autoUpdater } = require('electron-updater')
const { getUpdateToken, hasEnvToken, hasStoredToken } = require('./token-store.cjs')

const GH_OWNER = 'herewegoagain4436-creator'
const GH_REPO = 'laxmi-fashion-store'

let initialized = false
let checking = false
let lastStatus = { status: 'idle', message: '' }

function getMainWindow() {
  const wins = BrowserWindow.getAllWindows()
  return wins[0] || null
}

function setStatus(status, message, extra = {}) {
  lastStatus = { status, message, ...extra, at: new Date().toISOString() }
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('laxmi:update-status', lastStatus)
  }
  return lastStatus
}

function applyTokenToEnv(token) {
  // electron-updater GitHub provider reads GH_TOKEN / GITHUB_TOKEN
  if (token) {
    process.env.GH_TOKEN = token
    process.env.GITHUB_TOKEN = token
  }
}

function configureUpdater() {
  const token = getUpdateToken()
  if (token) applyTokenToEnv(token)

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  // Public GitHub Releases (preferred). Optional token still works for rate limits / private forks.
  const feed = {
    provider: 'github',
    owner: GH_OWNER,
    repo: GH_REPO,
    private: false,
  }
  if (token) {
    feed.token = token
  }
  autoUpdater.setFeedURL(feed)
  return { ok: true, hasToken: Boolean(token) }
}

function wireEventsOnce() {
  if (initialized) return
  initialized = true

  autoUpdater.on('checking-for-update', () => {
    setStatus('checking', 'Checking for updates…')
  })

  autoUpdater.on('update-available', (info) => {
    setStatus('available', `Update ${info.version} available. Downloading…`, {
      version: info.version,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    setStatus('up-to-date', `You are on the latest version (${info.version || 'current'}).`, {
      version: info.version,
    })
  })

  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent || 0)
    setStatus('downloading', `Downloading update… ${pct}%`, {
      percent: pct,
      transferred: p.transferred,
      total: p.total,
    })
  })

  autoUpdater.on('update-downloaded', async (info) => {
    setStatus('downloaded', `Update ${info.version} ready to install.`, {
      version: info.version,
    })
    const win = getMainWindow()
    const result = await dialog.showMessageBox(win || undefined, {
      type: 'info',
      title: 'Update ready',
      message: `Version ${info.version} has been downloaded.`,
      detail:
        'Your shop data (SQLite in AppData) is kept. Restart now to install the update?',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true)
    }
  })

  autoUpdater.on('error', (err) => {
    const msg = String((err && err.message) || err || 'Update error')
    console.error('[updater]', msg)
    if (/401|403|bad credentials|requires authentication|not found/i.test(msg)) {
      setStatus(
        'error',
        'Update check failed. Public releases need no token — if this persists, check network or try again later. Optional: add a GitHub token in Settings for higher API limits.',
      )
    } else {
      setStatus('error', msg)
    }
  })
}

/**
 * @param {{ silent?: boolean }} opts
 * silent=true: startup check — no alert when up-to-date (status only)
 */
async function checkForUpdates(opts = {}) {
  const silent = Boolean(opts.silent)
  if (checking) {
    return setStatus('checking', 'Already checking for updates…')
  }

  configureUpdater()
  wireEventsOnce()
  checking = true
  try {
    setStatus('checking', 'Checking for updates…')
    const result = await autoUpdater.checkForUpdates()
    return lastStatus.status === 'idle'
      ? setStatus('checking', 'Check started', { updateInfo: result && result.updateInfo })
      : lastStatus
  } catch (err) {
    const msg = String((err && err.message) || err)
    if (/401|403|bad credentials|requires authentication/i.test(msg)) {
      const status = setStatus(
        'error',
        'Update auth failed. Public releases should work without a token. Optional: paste a PAT in Settings if needed.',
      )
      if (!silent) {
        const win = getMainWindow()
        await dialog.showMessageBox(win || undefined, {
          type: 'warning',
          title: 'Update check failed',
          message: 'Could not check for updates',
          detail:
            'This app updates from public GitHub Releases (no token required). If checks fail, check your network. Advanced: set GH_TOKEN or LAXMI_GH_TOKEN, or paste a token under Settings.',
        })
      }
      return status
    }
    return setStatus('error', msg)
  } finally {
    checking = false
  }
}

function getUpdateStatus() {
  return {
    ...lastStatus,
    hasToken: Boolean(getUpdateToken()),
    tokenSource: hasEnvToken() ? 'env' : hasStoredToken() ? 'stored' : 'none',
    currentVersion: require('../package.json').version,
  }
}

module.exports = {
  checkForUpdates,
  getUpdateStatus,
  configureUpdater,
  GH_OWNER,
  GH_REPO,
}
