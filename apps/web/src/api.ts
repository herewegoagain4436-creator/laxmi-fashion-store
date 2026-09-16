const TOKEN_KEY = 'laxmi-token'
const API_BASE_KEY = 'laxmi-api-base'

/** Configurable API origin for Capacitor/Android (e.g. http://192.168.1.10:8787). Empty = same-origin / relative. */
export function getApiBase() {
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
  if (token) headers.Authorization = `Bearer ${token}`
  const base = getApiBase()
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
