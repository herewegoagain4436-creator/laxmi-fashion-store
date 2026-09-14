import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, enqueue } from '../db'
import { flushOutbox, syncNow } from '../sync'
import { SyncBadge } from '../components/SyncBadge'

export function Settings() {
  const store = useLiveQuery(() => db.store.get('store-1'), [])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!store) return
    setName(store.name)
    setAddress(store.address)
    setPhone(store.phone)
    setCity(store.city)
  }, [store])

  async function save() {
    const rec = {
      id: 'store-1',
      name,
      address,
      phone,
      city,
      updatedAt: new Date().toISOString(),
    }
    await db.store.put(rec)
    await enqueue('store', rec, rec.id)
    void flushOutbox()
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-bold text-brand-800">Store profile</h1>
      <p className="mb-4 text-sm text-slate-600">Shown on sale receipts. GST is never printed.</p>
      <div className="mb-4">
        <SyncBadge />
        <button type="button" className="ml-2 text-sm underline" onClick={() => void syncNow()}>
          Sync now
        </button>
      </div>
      <label className="mb-2 block text-sm">
        Shop name
        <input className="mt-1 min-h-[44px] w-full rounded-xl border px-3" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="mb-2 block text-sm">
        Address
        <input className="mt-1 min-h-[44px] w-full rounded-xl border px-3" value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="mb-2 block text-sm">
        City
        <input className="mt-1 min-h-[44px] w-full rounded-xl border px-3" value={city} onChange={(e) => setCity(e.target.value)} />
      </label>
      <label className="mb-4 block text-sm">
        Phone
        <input className="mt-1 min-h-[44px] w-full rounded-xl border px-3" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <button type="button" className="min-h-[48px] w-full rounded-xl bg-brand-600 font-semibold text-white" onClick={() => void save()}>
        {saved ? 'Saved' : 'Save profile'}
      </button>
      <p className="mt-6 text-xs text-slate-500">
        Seed logins — Owner: owner / owner123 · Cashier: cashier / cashier123. Cashier can sell and view stock only.
      </p>
    </div>
  )
}
