import { api } from './api'
import { applySnapshot, db, pendingCount } from './db'
import type { Snapshot } from './types'

export type SyncState = {
  online: boolean
  pending: number
  lastSync: string | null
  lastError: string | null
  syncing: boolean
}

const listeners = new Set<(s: SyncState) => void>()
let state: SyncState = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pending: 0,
  lastSync: null,
  lastError: null,
  syncing: false,
}
let started = false

function emit() {
  for (const l of listeners) l(state)
}

export function subscribeSync(fn: (s: SyncState) => void) {
  listeners.add(fn)
  fn(state)
  return () => {
    listeners.delete(fn)
  }
}

export function getSyncState() {
  return state
}

async function refreshPending() {
  state = { ...state, pending: await pendingCount() }
  emit()
}

export async function pullSnapshot() {
  const pending = await pendingCount()
  if (pending > 0) {
    await flushOutbox()
    return
  }
  const snap = await api<Snapshot>('/api/snapshot')
  await applySnapshot(snap)
  state = { ...state, lastSync: new Date().toISOString(), lastError: null, online: true }
  emit()
  return snap
}

export async function flushOutbox() {
  if (state.syncing) return
  const pending = await db.outbox.where('synced').equals(0).sortBy('createdAt')
  if (!pending.length) {
    await refreshPending()
    return
  }
  state = { ...state, syncing: true }
  emit()
  const body: Record<string, unknown> = {
    products: [],
    suppliers: [],
    purchases: [],
    sales: [],
    returns: [],
  }
  const ids: number[] = []
  for (const item of pending) {
    if (item.localId != null) ids.push(item.localId)
    if (item.type === 'store') {
      body.store = item.payload
      continue
    }
    const key =
      item.type === 'sale'
        ? 'sales'
        : item.type === 'purchase'
          ? 'purchases'
          : item.type === 'return'
            ? 'returns'
            : item.type === 'product'
              ? 'products'
              : 'suppliers'
    if (!body[key]) body[key] = []
    ;(body[key] as unknown[]).push(item.payload)
  }
  try {
    const res = await api<{ ok: boolean; snapshot: Snapshot }>('/api/sync', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    await db.transaction('rw', db.outbox, async () => {
      for (const id of ids) await db.outbox.update(id, { synced: 1, error: '' })
    })
    if (res.snapshot) await applySnapshot(res.snapshot)
    state = {
      ...state,
      syncing: false,
      online: true,
      lastSync: new Date().toISOString(),
      lastError: null,
      pending: 0,
    }
    emit()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    state = { ...state, syncing: false, lastError: msg, online: navigator.onLine }
    for (const item of pending) {
      if (item.localId != null) {
        await db.outbox.update(item.localId, { tries: (item.tries || 0) + 1, error: msg })
      }
    }
    await refreshPending()
    emit()
  }
}

export function startSyncLoop() {
  if (started) return
  started = true
  window.addEventListener('online', () => {
    state = { ...state, online: true }
    emit()
    void flushOutbox().then(() => pullSnapshot().catch(() => undefined))
  })
  window.addEventListener('offline', () => {
    state = { ...state, online: false }
    emit()
  })
  void refreshPending()
  window.setInterval(() => {
    if (navigator.onLine) void flushOutbox()
    void refreshPending()
  }, 12000)
}

export async function syncNow() {
  if (!navigator.onLine) {
    state = { ...state, online: false, lastError: 'Offline' }
    emit()
    return
  }
  await flushOutbox()
  try {
    await pullSnapshot()
  } catch (e) {
    state = {
      ...state,
      lastError: e instanceof Error ? e.message : String(e),
    }
    emit()
  }
}
