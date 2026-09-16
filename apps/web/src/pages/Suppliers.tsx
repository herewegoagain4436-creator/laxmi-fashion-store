import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, enqueue } from '../db'
import { uid } from '../lib/ids'
import { flushOutbox } from '../sync'
import type { Supplier } from '../types'

export function Suppliers() {
  const list = useLiveQuery(() => db.suppliers.filter((s) => !s.deletedAt).toArray(), []) || []
  const [form, setForm] = useState<Partial<Supplier> | null>(null)

  async function save() {
    if (!form?.name) return
    const t = new Date().toISOString()
    const rec: Supplier = {
      id: form.id || uid(),
      name: form.name,
      phone: form.phone || '',
      address: form.address || '',
      notes: form.notes || '',
      createdAt: form.createdAt || t,
      updatedAt: t,
    }
    await db.suppliers.put(rec)
    await enqueue('supplier', rec, rec.id)
    void flushOutbox()
    setForm(null)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="lf-page-title">Suppliers</h1>
          <p className="text-sm text-slate-500">Vendor list</p>
        </div>
        <button
          type="button"
          className="lf-btn-primary"
          onClick={() => setForm({ name: '', phone: '', address: '', notes: '' })}
        >
          Add supplier
        </button>
      </div>
      <div className="space-y-2">
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            className="block w-full lf-card p-3 text-left"
            onClick={() => setForm(s)}
          >
            <div className="font-semibold">{s.name}</div>
            <div className="text-sm text-slate-500">
              {s.phone} {s.address ? `· ${s.address}` : ''}
            </div>
          </button>
        ))}
      </div>
      {form && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3">
          <div className="w-full max-w-md rounded-2xl bg-white p-4">
            <h2 className="mb-3 font-bold">{form.id ? 'Edit supplier' : 'New supplier'}</h2>
            {['name', 'phone', 'address', 'notes'].map((k) => (
              <input
                key={k}
                className="mb-2 lf-input"
                placeholder={k[0].toUpperCase() + k.slice(1)}
                value={(form as Record<string, string>)[k] || ''}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            ))}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="min-h-[44px] rounded-xl border" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="button" className="min-h-[44px] rounded-xl bg-brand-600 text-white" onClick={() => void save()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
