'use strict'

const { app, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

const FILE_NAME = 'update-token.bin'
const PLAIN_FALLBACK = 'update-token.txt'

function tokenPath(encrypted) {
  return path.join(app.getPath('userData'), encrypted ? FILE_NAME : PLAIN_FALLBACK)
}

/** Runtime env overrides (advanced). Never committed. */
function envToken() {
  const t =
    (process.env.LAXMI_GH_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim()
  return t || null
}

function readStoredToken() {
  try {
    const encPath = tokenPath(true)
    if (fs.existsSync(encPath) && safeStorage.isEncryptionAvailable()) {
      const buf = fs.readFileSync(encPath)
      return safeStorage.decryptString(buf)
    }
    const plainPath = tokenPath(false)
    if (fs.existsSync(plainPath)) {
      return fs.readFileSync(plainPath, 'utf8').trim()
    }
  } catch (err) {
    console.warn('[token-store] read failed:', err && err.message)
  }
  return null
}

function writeStoredToken(token) {
  const cleaned = String(token || '').trim()
  const encPath = tokenPath(true)
  const plainPath = tokenPath(false)
  if (!cleaned) {
    for (const p of [encPath, plainPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        /* ignore */
      }
    }
    return
  }
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(cleaned)
    fs.writeFileSync(encPath, buf)
    try {
      if (fs.existsSync(plainPath)) fs.unlinkSync(plainPath)
    } catch {
      /* ignore */
    }
    return
  }
  // Fallback when OS encryption unavailable (rare on Windows)
  fs.writeFileSync(plainPath, cleaned, { encoding: 'utf8', mode: 0o600 })
}

function getUpdateToken() {
  return envToken() || readStoredToken()
}

function hasStoredToken() {
  return Boolean(readStoredToken())
}

function hasEnvToken() {
  return Boolean(envToken())
}

function setUpdateToken(token) {
  writeStoredToken(token)
}

function clearUpdateToken() {
  writeStoredToken('')
}

module.exports = {
  getUpdateToken,
  setUpdateToken,
  clearUpdateToken,
  hasStoredToken,
  hasEnvToken,
}
