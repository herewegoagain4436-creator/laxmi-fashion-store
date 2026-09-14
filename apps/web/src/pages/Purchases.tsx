import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, enqueue, productsWithSizes } from '../db'
import { useAuth } from '../auth'
import { inr, qtyLabel, typeLabel } from '../lib/format'
import { uid } from '../lib/ids'
import { flushOutbox } from '../sync'
import { SizeChips } from '../components/SizeChips'
import type { Product } from '../types'

type Line = {
  key: string
  productId: string
  productName: string
  type: string
  size?: string
  quantity: number
  unit: string
  unitCost: number
  lineTotal: number
}

export function Purchases() {
  const { user } = useAuth()
  const suppliers = useLiveQuery(() => db.suppliers.filter((s) => !s.deletedAt).toArray(), []) || []
  const products = useLiveQuery(() => productsWithSizes(), []) || []
  const purchases = useLiveQuery(() => db.purchases.orderBy('createdAt').reverse().toArray(), []) || []
  const items = useLiveQuery(() => db.purchaseItems.toArray(), []) || []
  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [billNo, setBillNo] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [pick, setPick] = useState<Product | null>(null)
  const [size, setSize] = useState('')
  const [qty, setQty] = useState('1')
  const [cost, setCost] = useState('')
  const [q, setQ] = useState('')

  const total = lines.reduce((a, l) => a + l.lineTotal, 0)

  function addLine() {
    if (!pick) return
    const quantity = Number(qty)
    const unitCost = Number(cost) || pick.costPrice
    if (!quantity) return
    if (pick.type === 'garment' && !size) return
    const unit = pick.type === 'fabric' ? 'metre' : 'piece'
    setLines((ls) => [
      ...ls,
      {
        key: uid(),
        productId: pick.id,
        productName: pick.name,
        type: pick.type,
        size: pick.type === 'garment' ? size : undefined,
        quantity,
        unit,
        unitCost,
        lineTotal: Math.round(quantity * unitCost * 100) / 100,
      },
    ])
    setPick(null)
    setQty('1')
    setSize('')
  }

  async function save() {
    if (!lines.length) return
    const id = uid()
    const t = new Date().toISOString()
    const recItems = lines.map((l) => ({
      id: uid(),
      purchaseId: id,
      productId: l.productId,
      productName: l.productName,
      size: l.size,
      quantity: l.quantity,
      unit: l.unit,
      unitCost: l.unitCost,
      lineTotal: l.lineTotal,
    }))
    await db.transaction('rw', db.purchases, db.purchaseItems, db.products, db.productSizes, db.outbox, async () => {
      await db.purchases.add({
        id,
        supplierId,
        billNo,
        date,
        total,
        notes,
        createdBy: user?.id,
        createdAt: t,
      })
      await db.purchaseItems.bulkAdd(recItems)
      for (const it of recItems) {
        if (it.size) {
          const row = await db.productSizes.where({ productId: it.productId, size: it.size }).first()
          if (row) await db.productSizes.update(row.id, { quantity: Number(row.quantity) + it.quantity })
          else
            await db.productSizes.add({
              id: `${it.productId}-${it.size}`,
              productId: it.productId,
              size: it.size,
              quantity: it.quantity,
            })
        } else {
          const p = await db.products.get(it.productId)
          if (p) await db.products.update(it.productId, { quantity: Number(p.quantity) + it.quantity, updatedAt: t })
        }
      }
      await enqueue('purchase', { id, supplierId, billNo, date, total, notes, createdBy: user?.id, createdAt: t, items: recItems }, id)
    })
    void flushOutbox()
    setOpen(false)
    setLines([])
    setBillNo('')
    setNotes('')
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand-800">Purchase bills</h1>
        <button
          type="button"
          className="min-h-[44px] rounded-xl bg-brand-600 px-3 font-semibold text-white"
          onClick={() => setOpen(true)}
        >
          New purchase
        </button>
      </div>
      <div className="space-y-2">
        {purchases.map((p) => {
          const its = items.filter((i) => i.purchaseId === p.id)
          const sup = suppliers.find((s) => s.id === p.supplierId)
          return (
            <div key={p.id} className="rounded-xl border bg-white p-3">
              <div className="flex justify-between">
                <div>
                  <div className="font-semibold">{p.billNo || p.id.slice(0, 8)}</div>
                  <div className="text-xs text-slate-500">
                    {p.date} · {sup?.name || 'Supplier'}
                  </div>
                </div>
                <div className="font-bold">{inr(p.total)}</div>
              </div>
              <ul className="mt-2 text-sm text-slate-600">
                {its.map((i) => (
                  <li key={i.id}>
                    {i.productName}
                    {i.size ? ` (${i.size})` : ''} · {qtyLabel(i.quantity, i.unit)}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-40 overflow-auto bg-black/40 p-3">
          <div className="mx-auto max-w-lg rounded-2xl bg-white p-4">
            <h2 className="mb-3 font-bold">Stock in — purchase</h2>
            <select
              className="mb-2 min-h-[44px] w-full rounded-xl border px-2"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Select supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <input className="min-h-[44px] rounded-xl border px-3" placeholder="Supplier bill no" value={billNo} onChange={(e) => setBillNo(e.target.value)} />
              <input type="date" className="min-h-[44px] rounded-xl border px-3" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <input
              className="mb-2 min-h-[44px] w-full rounded-xl border px-3"
              placeholder="Search product to add"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="mb-2 max-h-32 overflow-auto">
              {products
                .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase()))
                .slice(0, 8)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-cream"
                    onClick={() => {
                      setPick(p)
                      setCost(String(p.costPrice))
                      setSize('')
                    }}
                  >
                    {p.name} · {typeLabel(p.type)}
                  </button>
                ))}
            </div>
            {pick && (
              <div className="mb-2 rounded-xl bg-cream p-2">
                <div className="mb-1 text-sm font-semibold">{pick.name}</div>
                {pick.type === 'garment' && (
                  <SizeChips sizes={pick.sizes || []} value={size} onChange={setSize} allowCustom />
                )}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input className="min-h-[40px] rounded-lg border px-2" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={pick.type === 'fabric' ? 'Metres' : 'Qty'} />
                  <input className="min-h-[40px] rounded-lg border px-2" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Unit cost" />
                </div>
                <button type="button" className="mt-2 min-h-[40px] w-full rounded-lg bg-brand-700 text-white" onClick={addLine}>
                  Add line
                </button>
              </div>
            )}
            <ul className="mb-2 text-sm">
              {lines.map((l) => (
                <li key={l.key} className="flex justify-between border-b py-1">
                  <span>
                    {l.productName} {l.size || ''} × {l.quantity}
                  </span>
                  <span>{inr(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <div className="mb-2 font-bold">Total {inr(total)}</div>
            <textarea className="mb-2 w-full rounded-xl border p-2 text-sm" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="min-h-[44px] rounded-xl border" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="min-h-[44px] rounded-xl bg-brand-600 font-semibold text-white" onClick={() => void save()}>
                Save purchase
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
