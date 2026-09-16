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
      ? 'border-emerald-200/80 bg-emerald-50 text-emerald-800'
      : label === 'Pending'
        ? 'border-amber-200/80 bg-amber-50 text-amber-900'
        : label === 'Local'
          ? 'border-slate-200/80 bg-white/90 text-slate-600'
          : 'border-slate-300/80 bg-slate-100 text-slate-700'

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={s.lastError || 'Tap to sync'}
      className={`lf-status shadow-soft transition hover:brightness-[0.98] active:scale-95 ${cls}`}
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
          {s.pending > 0 ? ` · ${s.pending}` : ''}
        </span>
      )}
    </button>
  )
}
