'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('laxmiDesktop', {
  isDesktop: true,
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke('laxmi:get-app-version'),
  getUpdateTokenMeta: () => ipcRenderer.invoke('laxmi:get-update-token-meta'),
  setUpdateToken: (token) => ipcRenderer.invoke('laxmi:set-update-token', token),
  clearUpdateToken: () => ipcRenderer.invoke('laxmi:clear-update-token'),
  checkForUpdates: () => ipcRenderer.invoke('laxmi:check-for-updates'),
  getUpdateStatus: () => ipcRenderer.invoke('laxmi:get-update-status'),
  onUpdateStatus: (cb) => {
    const handler = (_event, status) => {
      try {
        cb(status)
      } catch {
        /* ignore */
      }
    }
    ipcRenderer.on('laxmi:update-status', handler)
    return () => ipcRenderer.removeListener('laxmi:update-status', handler)
  },
})
