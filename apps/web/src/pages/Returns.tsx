import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../auth'
import { db, enqueue } from '../db'
import { inr, qtyLabel, stockQtyOfLine } from '../lib/format'
import { uid } from '../lib/ids'
import { flushOutbox } from '../sync'
import { writeAudit } from '../lib/audit'
import type { Sale, SaleItem } from '../types'

export function Returns() {
  const { user } = useAuth()
  const sales = useLiveQuery(() => db.sales.orderBy('datetime').reverse().toArray(), []) || []
  const allItems = useLiveQuery(() => db.saleItems.toArray(), []) || []
  const allReturns = useLiveQuery(() => db.returns.toArray(), []) || []
  const allReturnItems = useLiveQuery(() => db.returnItems.toArray(), []) || []
  const [q, setQ] = useState('')
  const [sale, setSale] = useState<Sale | null>(null)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return sales.slice(0, 12)
    return sales.filter(
      (x) =>
        x.billNo.toLowerCase().includes(s) ||
        (x.customerPhone || '').includes(s),
    )
  }, [q, sales])

  function returnedQty(saleItemId: string) {
    return allReturnItems.filter((r) => r.saleItemId === saleItemId).reduce((a, r) => a + r.quantity, 0)
  }

  async function submit() {
    if (!sale) return
    const items = allItems.filter((i) => i.saleId === sale.id)
    const picked: Array<{ saleItem: SaleItem; quantity: number }> = []
    for (const it of items) {
      const n = Number(qty[it.id] || 0)
      const remain = it.quantity - returnedQty(it.id)
      if (n > 0 && n <= remain + 1e-9) picked.push({ saleItem: it, quantity: n })
    }
    if (!picked.length) return
    const refund = picked.reduce((a, p) => {
      const unit = p.saleItem.lineTotal / p.saleItem.quantity
      return a + unit * p.quantity
    }, 0)
    const id = uid()
    const t = new Date().toISOString()
    const recItems = picked.map((p) => ({
      id: uid(),
      returnId: id,
      saleItemId: p.saleItem.id,
      productId: p.saleItem.productId,
      productName: p.saleItem.productName,
      size: p.saleItem.size,
      colour: p.saleItem.colour || 'Default',
      quantity: p.quantity,
      unit: p.saleItem.unit,
      productType: p.saleItem.productType,
    }))
    await db.transaction(
      'rw',
      [db.returns, db.returnItems, db.sales, db.products, db.productSizes, db.outbox, db.auditLog],
      async () => {
        await db.returns.add({
          id,
          saleId: sale.id,
          datetime: t,
          reason,
          refundAmount: Math.round(refund * 100) / 100,
          refundMode: 'cash',
          createdBy: user?.id,
          createdAt: t,
        })
        await db.returnItems.bulkAdd(recItems)
        for (const it of recItems) {
          const delta = stockQtyOfLine(it.unit, it.quantity)
          if (it.productType === 'garment' && it.size) {
            const colour = (it.colour || 'Default').trim() || 'Default'
            let row = await db.productSizes
              .where('productId')
              .equals(it.productId)
              .filter((r) => (r.colour || 'Default') === colour && r.size === it.size)
              .first()
            if (!row) row = await db.productSizes.where({ productId: it.productId, size: it.size! }).first()
            if (row) await db.productSizes.update(row.id, { quantity: Number(row.quantity) + delta })
          } else {
            const p = await db.products.get(it.productId)
            if (p) await db.products.update(it.productId, { quantity: Number(p.quantity) + delta, updatedAt: t })
          }
        }
        await db.sales.update(sale.id, { status: 'partial_return' })
        await writeAudit({
          action: 'return',
          entityType: 'return',
          entityId: id,
          userId: user?.id,
          userName: user?.name,
          detail: { saleId: sale.id, billNo: sale.billNo, refund, reason },
        })
        await enqueue(
          'return',
          {
            id,
            saleId: sale.id,
            datetime: t,
            reason,
            refundAmount: Math.round(refund * 100) / 100,
            refundMode: 'cash',
            createdBy: user?.id,
            createdAt: t,
            items: recItems,
          },
          id,
        )
      },
    )
    void flushOutbox()
    setSale(null)
    setQty({})
    setReason('')
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-3 text-xl font-bold text-brand-800">Returns</h1>
      <input
        className="mb-3 min-h-[48px] w-full rounded-xl border px-3"
        placeholder="Search bill no or phone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="space-y-2">
        {matches.map((s) => (
          <button
            key={s.id}
            type="button"
            className="block w-full lf-card p-3 text-left"
            onClick={() => setSale(s)}
          >
            <div className="flex justify-between">
              <span className="font-semibold">{s.billNo}</span>
              <span>{inr(s.grandTotal)}</span>
            </div>
            <div className="text-xs text-slate-500">
              {new Date(s.datetime).toLocaleString('en-IN')} · {s.status}
            </div>
          </button>
        ))}
      </div>
      {allReturns.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 font-semibold">Recent returns</h2>
          {allReturns
            .slice()
            .reverse()
            .slice(0, 10)
            .map((r) => (
              <div key={r.id} className="mb-1 text-sm text-slate-600">
                {new Date(r.datetime).toLocaleString('en-IN')} · refund {inr(r.refundAmount)}
              </div>
            ))}
        </div>
      )}
      {sale && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3">
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-4">
            <h2 className="mb-2 font-bold">Return {sale.billNo}</h2>
            {allItems
              .filter((i) => i.saleId === sale.id)
              .map((it) => {
                const remain = it.quantity - returnedQty(it.id)
                return (
                  <div key={it.id} className="mb-2 rounded-lg bg-cream p-2 text-sm">
                    <div className="font-medium">
                      {it.productName}{' '}
                      {it.colour && it.colour !== 'Default' ? it.colour : ''}{' '}
                      {it.size ? `(${it.size})` : ''}
                    </div>
                    <div className="text-xs text-slate-500">
                      Sold {qtyLabel(it.quantity, it.unit)} · remaining {qtyLabel(remain, it.unit)}
                    </div>
                    <input
                      className="mt-1 min-h-[40px] w-full rounded-lg border px-2"
                      placeholder="Return qty"
                      value={qty[it.id] || ''}
                      onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))}
                    />
                  </div>
                )
              })}
            <input
              className="mb-2 lf-input"
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="min-h-[44px] rounded-xl border" onClick={() => setSale(null)}>
                Cancel
              </button>
              <button type="button" className="min-h-[44px] rounded-xl bg-brand-600 text-white" onClick={() => void submit()}>
                Process return
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
