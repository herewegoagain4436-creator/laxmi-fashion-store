import { db, enqueue } from '../db'
import type { AuditAction, AuditLogEntry } from '../types'
import { uid } from './ids'

export async function writeAudit(opts: {
  action: AuditAction | string
  entityType: string
  entityId: string
  userId?: string
  userName?: string
  detail: Record<string, unknown> | string
}) {
  const entry: AuditLogEntry = {
    id: uid(),
    action: opts.action,
    entityType: opts.entityType,
    entityId: opts.entityId,
    userId: opts.userId,
    userName: opts.userName,
    detail: typeof opts.detail === 'string' ? opts.detail : JSON.stringify(opts.detail),
    createdAt: new Date().toISOString(),
  }
  await db.auditLog.put(entry)
  await enqueue('audit', entry, entry.id)
  return entry
}
