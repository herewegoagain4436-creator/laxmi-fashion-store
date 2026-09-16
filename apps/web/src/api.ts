const TOKEN_KEY = 'laxmi-token'
const API_BASE_KEY = 'laxmi-api-base'
const SYNC_MODE_KEY = 'laxmi-sync-mode'
const SYNC_TOKEN_KEY = 'laxmi-sync-token'
const CLOUD_URL_KEY = 'laxmi-cloud-url'

export type SyncMode = 'offline' | 'lan' | 'cloud'

/** Configurable API origin for Capacitor/Android (e.g. http://192.168.1.10:8787). Empty = same-origin / relative. */
export function getApiBase() {
  return getEffectiveApiBase()
}

export function getLanApiBase() {
  const fromEnv = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).replace(/\/$/, '')
  try {
    const stored = localStorage.getItem(API_BASE_KEY)
    if (stored && stored.trim()) return stored.replace(/\/$/, '')
  } catch {
    /* ignore */
  }
  return ''
}

export function setApiBase(url: string) {
  const cleaned = url.trim().replace(/\/$/, '')
  if (cleaned) localStorage.setItem(API_BASE_KEY, cleaned)
  else localStorage.removeItem(API_BASE_KEY)
}

export function getCloudUrl() {
  try {
    return (localStorage.getItem(CLOUD_URL_KEY) || '').replace(/\/$/, '')
  } catch {
    return ''
  }
}

export function setCloudUrl(url: string) {
  const cleaned = url.trim().replace(/\/$/, '')
  if (cleaned) localStorage.setItem(CLOUD_URL_KEY, cleaned)
  else localStorage.removeItem(CLOUD_URL_KEY)
}

export function getSyncMode(): SyncMode {
  try {
    const m = localStorage.getItem(SYNC_MODE_KEY)
    if (m === 'offline' || m === 'lan' || m === 'cloud') return m
  } catch {
    /* ignore */
  }
  // Migrate: if LAN URL was set previously, treat as lan; else offline-friendly default
  try {
    if (localStorage.getItem(API_BASE_KEY)?.trim()) return 'lan'
  } catch {
    /* ignore */
  }
  return 'offline'
}

export function setSyncMode(mode: SyncMode) {
  localStorage.setItem(SYNC_MODE_KEY, mode)
}

export function getSyncToken() {
  try {
    return localStorage.getItem(SYNC_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setSyncToken(token: string) {
  const t = token.trim()
  if (t) localStorage.setItem(SYNC_TOKEN_KEY, t)
  else localStorage.removeItem(SYNC_TOKEN_KEY)
}

/** Resolve which origin to call based on sync mode. Offline → no remote (empty). */
export function getEffectiveApiBase() {
  const mode = getSyncMode()
  if (mode === 'offline') return ''
  if (mode === 'cloud') {
    const cloud = getCloudUrl()
    if (cloud) return cloud
  }
  if (mode === 'lan') return getLanApiBase()
  // cloud without URL falls through to lan/empty
  return getLanApiBase()
}

export function isRemoteSyncEnabled() {
  const mode = getSyncMode()
  if (mode === 'offline') return false
  if (mode === 'cloud') return Boolean(getCloudUrl())
  // lan: empty base still means same-origin (desktop local server) — allow
  return true
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...((opts.headers as Record<string, string>) || {}),
  }
  const token = getToken()
  const syncToken = getSyncToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  } else if (syncToken) {
    headers.Authorization = `Bearer ${syncToken}`
  }
  if (syncToken) {
    headers['X-Laxmi-Token'] = syncToken
  }
  const base = getEffectiveApiBase()
  const url = path.startsWith('http') ? path : `${base}${path}`
  const res = await fetch(url, { ...opts, headers })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      msg = j.error || msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export async function checkSyncHealth(): Promise<{ ok: boolean; detail: string }> {
  const mode = getSyncMode()
  if (mode === 'offline') return { ok: true, detail: 'Offline-only — data stays on this device' }
  const base = getEffectiveApiBase()
  if (mode === 'cloud' && !base) return { ok: false, detail: 'Cloud URL not set' }
  if (mode === 'cloud' && !getSyncToken()) return { ok: false, detail: 'Sync token not set' }
  try {
    const url = `${base}/api/health`
    const headers: Record<string, string> = {}
    const syncToken = getSyncToken()
    if (syncToken) headers['X-Laxmi-Token'] = syncToken
    const res = await fetch(url, { headers })
    if (!res.ok) return { ok: false, detail: `Health check failed (${res.status})` }
    const j = (await res.json()) as { ok?: boolean; syncTokenRequired?: boolean }
    if (j.syncTokenRequired && !syncToken) {
      return { ok: false, detail: 'Server requires sync token — paste it in Settings' }
    }
    return { ok: true, detail: mode === 'cloud' ? `Cloud reachable: ${base}` : `Server reachable${base ? `: ${base}` : ' (this device)'}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
