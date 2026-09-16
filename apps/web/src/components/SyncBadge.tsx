import { useEffect, useState } from 'react'
import { Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { isRemoteSyncEnabled } from '../api'
import { getSyncState, subscribeSync, syncNow, type SyncState } from '../sync'

export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState<SyncState>(getSyncState)
  useEffect(() => subscribeSync(setS), [])

  const remote = isRemoteSyncEnabled()
  const label = !remote
    ? 'Local'
    : !s.online
      ? 'Offline'
      : s.pending > 0 || s.syncing
        ? 'Pending'
        : 'Synced'
  const cls =
    label === 'Synced'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : label === 'Pending'
        ? 'bg-amber-50 text-amber-900 border-amber-200'
        : label === 'Local'
          ? 'bg-slate-50 text-slate-600 border-slate-200'
          : 'bg-slate-100 text-slate-700 border-slate-300'

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={s.lastError || 'Tap to sync'}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      {s.syncing ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      ) : s.online ? (
        <Cloud className="h-3.5 w-3.5" />
      ) : (
        <CloudOff className="h-3.5 w-3.5" />
      )}
      {!compact && (
        <span>
          {label}
          {s.pending > 0 ? ` ${s.pending}` : ''}
        </span>
      )}
    </button>
  )
}
