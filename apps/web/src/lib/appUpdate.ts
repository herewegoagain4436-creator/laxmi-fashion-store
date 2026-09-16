import { APP_VERSION } from './appVersion'

export const UPDATE_REPO_OWNER = 'herewegoagain4436-creator'
export const UPDATE_REPO_NAME = 'laxmi-fashion-store'
export const UPDATE_TOKEN_LS_KEY = 'laxmi-gh-update-token'

const API = `https://api.github.com/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}`

export type DesktopBridge = {
  isDesktop: true
  platform: string
  getAppVersion: () => Promise<string>
  getUpdateTokenMeta: () => Promise<{
    hasToken: boolean
    hasStoredToken: boolean
    hasEnvToken: boolean
    source: 'env' | 'stored' | 'none'
  }>
  setUpdateToken: (token: string) => Promise<{ ok: boolean; hasToken: boolean; source: string }>
  clearUpdateToken: () => Promise<{ ok: boolean; hasToken: boolean }>
  checkForUpdates: () => Promise<{ status: string; message: string }>
  getUpdateStatus: () => Promise<{
    status: string
    message: string
    hasToken: boolean
    tokenSource: string
    currentVersion: string
  }>
  onUpdateStatus: (cb: (status: { status: string; message: string }) => void) => () => void
}

declare global {
  interface Window {
    laxmiDesktop?: DesktopBridge
  }
}

export function isElectronDesktop() {
  return Boolean(typeof window !== 'undefined' && window.laxmiDesktop?.isDesktop)
}

export function getWebUpdateToken() {
  try {
    return (localStorage.getItem(UPDATE_TOKEN_LS_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function setWebUpdateToken(token: string) {
  const t = token.trim()
  if (t) localStorage.setItem(UPDATE_TOKEN_LS_KEY, t)
  else localStorage.removeItem(UPDATE_TOKEN_LS_KEY)
}

export function clearWebUpdateToken() {
  localStorage.removeItem(UPDATE_TOKEN_LS_KEY)
}

export function getAppVersion() {
  return APP_VERSION
}

function normalizeVer(v: string) {
  return String(v || '')
    .trim()
    .replace(/^v/i, '')
}

/** Semver-ish compare: a>b → 1, a<b → -1, else 0 */
export function compareVersions(a: string, b: string) {
  const pa = normalizeVer(a)
    .split('.')
    .map((x) => parseInt(x.replace(/\D.*/, ''), 10) || 0)
  const pb = normalizeVer(b)
    .split('.')
    .map((x) => parseInt(x.replace(/\D.*/, ''), 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

export type ReleaseCheckResult =
  | { ok: false; reason: 'no-token'; message: string }
  | { ok: false; reason: 'error'; message: string }
  | {
      ok: true
      currentVersion: string
      latestVersion: string
      newer: boolean
      releaseName: string
      releaseUrl: string
      apk?: { name: string; id: number; size: number; apiUrl: string }
      setup?: { name: string; id: number; size: number; apiUrl: string }
      portable?: { name: string; id: number; size: number; apiUrl: string }
      message: string
    }

export async function checkGitHubRelease(token?: string): Promise<ReleaseCheckResult> {
  const t = (token || getWebUpdateToken()).trim()
  if (!t) {
    return {
      ok: false,
      reason: 'no-token',
      message: 'Add a private update token in Settings',
    }
  }

  try {
    const res = await fetch(`${API}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${t}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: 'error',
        message: 'Update auth failed. Check the private update token (Contents + Releases read).',
      }
    }
    if (res.status === 404) {
      return {
        ok: false,
        reason: 'error',
        message: 'No releases found (or token cannot see this private repo).',
      }
    }
    if (!res.ok) {
      return { ok: false, reason: 'error', message: `GitHub API error: ${res.status}` }
    }
    const data = (await res.json()) as {
      tag_name?: string
      name?: string
      html_url?: string
      assets?: Array<{ id: number; name: string; size: number; url: string }>
    }
    const latestVersion = normalizeVer(data.tag_name || data.name || '')
    const currentVersion = getAppVersion()
    const newer = compareVersions(latestVersion, currentVersion) > 0
    const assets = data.assets || []
    const find = (re: RegExp) => {
      const a = assets.find((x) => re.test(x.name))
      return a
        ? { name: a.name, id: a.id, size: a.size, apiUrl: a.url }
        : undefined
    }
    const apk = find(/LaxmiFashion\.apk$/i)
    const setup = find(/Setup\.exe$/i)
    const portable = find(/Portable\.exe$/i)

    return {
      ok: true,
      currentVersion,
      latestVersion,
      newer,
      releaseName: data.name || data.tag_name || latestVersion,
      releaseUrl: data.html_url || `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases`,
      apk,
      setup,
      portable,
      message: newer
        ? `Update available: ${latestVersion} (you have ${currentVersion})`
        : `You are on the latest version (${currentVersion}).`,
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: String((err as Error)?.message || err),
    }
  }
}

/** Download a private release asset using the PAT (for APK on phone / browser). */
export async function downloadPrivateAsset(
  assetApiUrl: string,
  fileName: string,
  token?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const t = (token || getWebUpdateToken()).trim()
  if (!t) {
    return { ok: false, message: 'Add a private update token in Settings' }
  }
  try {
    const res = await fetch(assetApiUrl, {
      headers: {
        Accept: 'application/octet-stream',
        Authorization: `Bearer ${t}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) {
      return { ok: false, message: `Download failed (${res.status})` }
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: String((err as Error)?.message || err) }
  }
}
